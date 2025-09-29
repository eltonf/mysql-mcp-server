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

    // Parse JSON result if needed
    let tables: TableSearchResult[];
    if (result.recordset.length === 1 && typeof result.recordset[0] === 'string') {
      tables = JSON.parse(result.recordset[0] as any);
    } else if (result.recordset.length === 1 && (result.recordset[0] as any).JSON_F52E2B61_18A1_11d1_B105_00805F49916B) {
      // SQL Server returns JSON in a special column
      tables = JSON.parse((result.recordset[0] as any).JSON_F52E2B61_18A1_11d1_B105_00805F49916B);
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