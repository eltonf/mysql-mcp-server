import { db } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import { buildFindTablesQuery } from '../db/queries.js';

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