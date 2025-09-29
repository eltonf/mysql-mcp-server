import { db } from '../db/connection.js';
import { logger } from '../utils/logger.js';

interface TableSearchResult {
  schemaName: string;
  tableName: string;
  rowCount?: number;
  createDate: Date;
}

export async function findTables(args: {
  pattern?: string;
  hasColumn?: string;
  schema?: string;
}): Promise<TableSearchResult[]> {
  const { pattern, hasColumn, schema } = args;

  try {
    let query = `
      SELECT DISTINCT
        s.name AS schemaName,
        t.name AS tableName,
        t.create_date AS createDate,
        p.rows AS rowCount
      FROM sys.tables t
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      LEFT JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0, 1)
    `;

    const conditions: string[] = [];
    const params: Record<string, any> = {};

    if (schema) {
      conditions.push('s.name = @schema');
      params.schema = schema;
    }

    if (pattern) {
      // Convert wildcards to SQL LIKE pattern
      const sqlPattern = pattern.replace(/\*/g, '%').replace(/\?/g, '_');
      conditions.push('t.name LIKE @pattern');
      params.pattern = sqlPattern;
    }

    if (hasColumn) {
      query += `
        INNER JOIN sys.columns c ON t.object_id = c.object_id
      `;
      conditions.push('c.name = @columnName');
      params.columnName = hasColumn;
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY s.name, t.name';

    const result = await db.query<TableSearchResult>(query, params);
    logger.info(`Found ${result.recordset.length} tables matching criteria`);
    return result.recordset;
  } catch (error) {
    logger.error('Error finding tables:', error);
    throw error;
  }
}