import { db } from '../db/connection.js';
import { cache } from '../db/cache.js';
import { logger } from '../utils/logger.js';
import {
  buildFindRoutinesQuery,
  buildGetRoutineDefinitionQuery,
  buildGetRoutinesSchemaQuery,
} from '../db/queries.js';
import { validateDatabaseObject } from './validation.js';

interface RoutineSearchResult {
  schemaName: string;
  routineName: string;
  routineType: string;
  createDate: Date;
  modifyDate: Date;
  description?: string;
}

interface RoutineParameter {
  name: string;
  dataType: string;
  isOutput: boolean;
  hasDefaultValue: boolean;
  defaultValue?: string;
  ordinal: number;
}

interface RoutineDefinition {
  schema: string;
  name: string;
  type: string;
  createDate: Date;
  modifyDate: Date;
  description?: string;
  definition?: string;
  parameters?: RoutineParameter[];
}

interface RoutinesSchemaResult {
  routines: RoutineDefinition[];
}

/**
 * Find routines (stored procedures and functions) by pattern
 */
export async function findRoutines(args: {
  database: string;
  pattern?: string;
  type?: string;
  schema?: string;
}): Promise<RoutineSearchResult[]> {
  const { database, pattern, type, schema } = args;

  try {
    const query = buildFindRoutinesQuery(database, schema || null, pattern || null, type || null);
    const result = await db.query<RoutineSearchResult>(query);

    // Parse JSON result
    let routines: RoutineSearchResult[];
    if (result.recordset.length === 0) {
      routines = [];
    } else if (result.recordset.length === 1) {
      const row: any = result.recordset[0];
      const jsonKey = Object.keys(row).find(k => k.startsWith('JSON_'));
      if (jsonKey && typeof row[jsonKey] === 'string') {
        routines = JSON.parse(row[jsonKey]);
      } else if (typeof row === 'string') {
        routines = JSON.parse(row);
      } else {
        routines = result.recordset;
      }
    } else {
      routines = result.recordset;
    }

    logger.info(`Found ${routines.length} routines matching criteria in ${database}`);
    return routines;
  } catch (error) {
    logger.error(`Error finding routines in ${database}:`, error);
    throw error;
  }
}

/**
 * Get single routine definition with parameters
 */
export async function getRoutineDefinition(args: {
  database: string;
  routine: string;
  schema?: string;
}): Promise<RoutineDefinition> {
  const { database, routine, schema } = args;

  try {
    // Auto-detect schema if not specified
    let resolvedSchema = schema;
    if (!resolvedSchema) {
      const detectQuery = `
        USE [${database}];
        SELECT DISTINCT SCHEMA_NAME(o.schema_id) AS schemaName
        FROM sys.objects o
        WHERE o.name = '${routine.replace(/'/g, "''")}'
        AND o.type IN ('P', 'FN', 'IF', 'TF', 'FS', 'FT', 'PC', 'X')
      `;
      const detectResult = await db.query(detectQuery);

      if (detectResult.recordset.length === 0) {
        // Try validation to get suggestions
        const validation = await validateDatabaseObject(database, routine, undefined);
        if (!validation.valid) {
          throw new Error(
            `Routine '${routine}' not found in database '${database}'. ${validation.message}`
          );
        }
        throw new Error(`Routine '${routine}' not found in database '${database}'.`);
      }

      if (detectResult.recordset.length > 1) {
        const schemas = detectResult.recordset.map((r: any) => r.schemaName);
        throw new Error(
          `Ambiguous routine name '${routine}'. Found in multiple schemas: ${schemas.join(', ')}. ` +
            `Please specify schema parameter with one of: ${schemas.map(s => `${s}.${routine}`).join(', ')}`
        );
      }

      resolvedSchema = detectResult.recordset[0].schemaName;
      logger.info(`Auto-detected schema '${resolvedSchema}' for routine '${routine}'`);
    }

    // At this point, resolvedSchema must be defined (either from parameter or auto-detection)
    if (!resolvedSchema) {
      throw new Error(`Schema could not be determined for routine '${routine}'`);
    }

    // Check cache
    const cacheKey = `routine:${database}:${resolvedSchema}:${routine}`;
    const cached = cache.get<RoutineDefinition>(cacheKey);
    if (cached) {
      logger.debug(`Cache hit for routine ${resolvedSchema}.${routine}`);
      return cached;
    }

    // Query routine definition
    const query = buildGetRoutineDefinitionQuery(database, resolvedSchema, routine);
    const result = await db.query(query);

    if (result.recordset.length === 0) {
      throw new Error(`Routine '${resolvedSchema}.${routine}' not found in database '${database}'.`);
    }

    // Parse JSON result
    const row: any = result.recordset[0];
    const jsonKey = Object.keys(row)[0];
    const routineData: RoutineDefinition = JSON.parse(row[jsonKey]);

    // Cache the result
    cache.set(cacheKey, routineData);

    logger.info(`Retrieved routine definition for ${resolvedSchema}.${routine} from ${database}`);
    return routineData;
  } catch (error) {
    logger.error(`Error getting routine definition for ${routine} in ${database}:`, error);
    throw error;
  }
}

/**
 * Get multiple routine definitions in one query (batch operation)
 */
export async function getRoutinesSchema(args: {
  database: string;
  routines?: string[];
  schema?: string;
}): Promise<RoutineDefinition[]> {
  const { database, routines, schema } = args;

  try {
    // Auto-detect schema if not specified (use dbo as fallback, but query will handle missing routines)
    let resolvedSchema = schema || 'dbo';

    if (!schema && routines && routines.length > 0) {
      // Try to auto-detect schema from first routine
      const detectQuery = `
        USE [${database}];
        SELECT DISTINCT TOP 1 SCHEMA_NAME(o.schema_id) AS schemaName
        FROM sys.objects o
        WHERE o.name = '${routines[0].replace(/'/g, "''")}'
        AND o.type IN ('P', 'FN', 'IF', 'TF', 'FS', 'FT', 'PC', 'X')
      `;
      const detectResult = await db.query(detectQuery);

      if (detectResult.recordset.length > 0) {
        resolvedSchema = detectResult.recordset[0].schemaName;
        logger.info(`Auto-detected schema '${resolvedSchema}' for routines query`);
      }
    }

    // Check cache for full result (only if specific routines requested)
    const cacheKey = routines && routines.length > 0
      ? `routines:${database}:${resolvedSchema}:${routines.sort().join(',')}`
      : null;

    if (cacheKey) {
      const cached = cache.get<RoutineDefinition[]>(cacheKey);
      if (cached) {
        logger.debug(`Cache hit for routines batch query`);
        return cached;
      }
    }

    // Query routines
    const query = buildGetRoutinesSchemaQuery(database, resolvedSchema, routines || null);
    const result = await db.query(query);

    if (result.recordset.length === 0) {
      return [];
    }

    // Parse JSON result
    const row: any = result.recordset[0];
    const jsonKey = Object.keys(row)[0];
    const parsed: RoutinesSchemaResult = JSON.parse(row[jsonKey]);
    const routinesData = parsed.routines || [];

    // Cache the result
    if (cacheKey) {
      cache.set(cacheKey, routinesData);
    }

    logger.info(`Retrieved ${routinesData.length} routines from ${database}.${resolvedSchema}`);
    return routinesData;
  } catch (error) {
    logger.error(`Error getting routines schema from ${database}:`, error);
    throw error;
  }
}
