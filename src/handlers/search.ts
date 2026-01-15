import { db } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import { buildFindTablesQuery, buildSearchObjectsQuery } from '../db/queries.js';

interface TableSearchResult {
  schemaName: string;
  tableName: string;
  rowCount?: number;
  createDate: Date;
}

export async function findTables(args: {
  database: string;
  pattern?: string;
  hasColumn?: string;
  schema?: string;
}): Promise<TableSearchResult[]> {
  const { database, pattern, hasColumn, schema } = args;

  try {
    const query = buildFindTablesQuery(database, schema || null, pattern || null, hasColumn || null);
    const result = await db.query(query);

    // Parse JSON result - SQL Server returns JSON as JsonResult column
    const jsonRow: any = result.recordset[0];
    if (!jsonRow?.JsonResult) {
      logger.info('No tables found matching criteria');
      return [];
    }

    const tables: TableSearchResult[] = JSON.parse(jsonRow.JsonResult);

    logger.info(`Found ${tables.length} tables matching criteria in ${database}`);
    return tables;
  } catch (error) {
    logger.error(`Error finding tables in ${database}:`, error);
    throw error;
  }
}

// Result type for search_objects - columnName omitted when null
interface ObjectSearchResult {
  schemaName: string;
  tableName: string;
  columnName?: string;
}

export async function searchObjects(args: {
  database: string;
  search: string;
  schema?: string;
}): Promise<ObjectSearchResult[]> {
  const { database, search, schema } = args;

  try {
    const query = buildSearchObjectsQuery(database, schema || null, search);
    const result = await db.query(query);

    // Parse JSON result - SQL Server returns JSON as JsonResult column
    const jsonRow: any = result.recordset[0];
    if (!jsonRow?.JsonResult) {
      logger.info('No tables or columns found matching search');
      return [];
    }

    const rawResults: Array<{ schemaName: string; tableName: string; columnName: string | null }> =
      JSON.parse(jsonRow.JsonResult);

    // Strip null columnName fields
    const results: ObjectSearchResult[] = rawResults.map((row) => {
      if (row.columnName === null) {
        return { schemaName: row.schemaName, tableName: row.tableName };
      }
      return { schemaName: row.schemaName, tableName: row.tableName, columnName: row.columnName };
    });

    logger.info(`Found ${results.length} matches for '${search}' in ${database}`);
    return results;
  } catch (error) {
    logger.error(`Error searching objects in ${database}:`, error);
    throw error;
  }
}