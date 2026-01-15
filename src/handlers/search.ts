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

// Result type for search_objects - null fields omitted
interface ObjectSearchResult {
  schemaName: string;
  tableName?: string;
  columnName?: string;
  routineName?: string;
}

export async function searchObjects(args: {
  database: string;
  search: string;
  schema?: string;
  type?: string; // single type filter: 'table', 'column', or 'routine'
}): Promise<ObjectSearchResult[]> {
  const { database, search, schema, type } = args;

  // Convert single type to array for query builder
  const types = type ? [type] : null;

  try {
    const query = buildSearchObjectsQuery(database, schema || null, search, types);
    const result = await db.query(query);

    // Parse JSON result - SQL Server returns JSON as JsonResult column
    const jsonRow: any = result.recordset[0];
    if (!jsonRow?.JsonResult) {
      logger.info('No objects found matching search');
      return [];
    }

    const rawResults: Array<{
      schemaName: string;
      tableName: string | null;
      columnName: string | null;
      routineName: string | null;
    }> = JSON.parse(jsonRow.JsonResult);

    // Strip null fields for cleaner output
    const results: ObjectSearchResult[] = rawResults.map((row) => {
      const result: ObjectSearchResult = { schemaName: row.schemaName };
      if (row.tableName !== null) result.tableName = row.tableName;
      if (row.columnName !== null) result.columnName = row.columnName;
      if (row.routineName !== null) result.routineName = row.routineName;
      return result;
    });

    logger.info(`Found ${results.length} matches for '${search}' in ${database}`);
    return results;
  } catch (error) {
    logger.error(`Error searching objects in ${database}:`, error);
    throw error;
  }
}