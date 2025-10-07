import { db } from '../db/connection.js';
import { cache } from '../db/cache.js';
import { logger } from '../utils/logger.js';
import { buildGetViewDefinitionQuery } from '../db/queries.js';
import { validateDatabaseObject } from './validation.js';

interface ViewColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  ordinal: number;
}

interface ViewDefinition {
  schema: string;
  name: string;
  type: string;
  createDate: Date;
  modifyDate: Date;
  description?: string;
  definition?: string;
  columns?: ViewColumn[];
}

/**
 * Get view definition with SQL source code
 */
export async function getViewDefinition(args: {
  database: string;
  view: string;
  schema?: string;
}): Promise<ViewDefinition> {
  const { database, view, schema } = args;

  try {
    // Auto-detect schema if not specified
    let resolvedSchema = schema;
    if (!resolvedSchema) {
      const detectQuery = `
        USE [${database}];
        SELECT DISTINCT SCHEMA_NAME(v.schema_id) AS schemaName
        FROM sys.views v
        WHERE v.name = '${view.replace(/'/g, "''")}'
      `;
      const detectResult = await db.query(detectQuery);

      if (detectResult.recordset.length === 0) {
        // Try validation to get suggestions
        const validation = await validateDatabaseObject(database, view, undefined);
        if (!validation.valid) {
          throw new Error(
            `View '${view}' not found in database '${database}'. ${validation.message}`
          );
        }
        throw new Error(`View '${view}' not found in database '${database}'.`);
      }

      if (detectResult.recordset.length > 1) {
        const schemas = detectResult.recordset.map((r: any) => r.schemaName);
        throw new Error(
          `Ambiguous view name '${view}'. Found in multiple schemas: ${schemas.join(', ')}. ` +
            `Please specify schema parameter with one of: ${schemas.map(s => `${s}.${view}`).join(', ')}`
        );
      }

      resolvedSchema = detectResult.recordset[0].schemaName;
      logger.info(`Auto-detected schema '${resolvedSchema}' for view '${view}'`);
    }

    // At this point, resolvedSchema must be defined (either from parameter or auto-detection)
    if (!resolvedSchema) {
      throw new Error(`Schema could not be determined for view '${view}'`);
    }

    // Check cache
    const cacheKey = `view:${database}:${resolvedSchema}:${view}`;
    const cached = cache.get<ViewDefinition>(cacheKey);
    if (cached) {
      logger.debug(`Cache hit for view ${resolvedSchema}.${view}`);
      return cached;
    }

    // Query view definition
    const query = buildGetViewDefinitionQuery(database, resolvedSchema, view);
    const result = await db.query(query);

    if (result.recordset.length === 0) {
      throw new Error(`View '${resolvedSchema}.${view}' not found in database '${database}'.`);
    }

    // Parse JSON result
    const row: any = result.recordset[0];
    const jsonKey = Object.keys(row)[0];
    const viewData: ViewDefinition = JSON.parse(row[jsonKey]);

    // Cache the result
    cache.set(cacheKey, viewData);

    logger.info(`Retrieved view definition for ${resolvedSchema}.${view} from ${database}`);
    return viewData;
  } catch (error) {
    logger.error(`Error getting view definition for ${view} in ${database}:`, error);
    throw error;
  }
}
