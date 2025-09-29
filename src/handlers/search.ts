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
    const result = await db.query<TableSearchResult>(query);

    // Parse JSON result - SQL Server returns JSON in various formats
    let tables: TableSearchResult[];
    if (result.recordset.length === 0) {
      tables = [];
    } else if (result.recordset.length === 1) {
      const row: any = result.recordset[0];
      // Check for special JSON column name (SQL Server's default)
      const jsonKey = Object.keys(row).find(k => k.startsWith('JSON_'));
      if (jsonKey && typeof row[jsonKey] === 'string') {
        tables = JSON.parse(row[jsonKey]);
      } else if (typeof row === 'string') {
        tables = JSON.parse(row);
      } else {
        tables = result.recordset;
      }
    } else {
      tables = result.recordset;
    }

    logger.info(`Found ${tables.length} tables matching criteria in ${database}`);
    return tables;
  } catch (error) {
    logger.error(`Error finding tables in ${database}:`, error);
    throw error;
  }
}