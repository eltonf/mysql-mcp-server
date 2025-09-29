import { db } from '../db/connection.js';
import { cache } from '../db/cache.js';
import { logger } from '../utils/logger.js';
import sql from 'mssql';

// New JSON-based interfaces matching the stored procedure output
interface Column {
  name: string;
  dataType: string;
  nullable: boolean;
  isIdentity: boolean;
  isComputed: boolean;
  defaultValue?: string;
  description?: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
}

interface PrimaryKey {
  constraintName: string;
  columns: string;
}

interface ForeignKey {
  constraintName: string;
  fromSchema: string;
  fromTable: string;
  fromColumns: string;
  toSchema: string;
  toTable: string;
  toColumns: string;
  onDelete: string;
  onUpdate: string;
}

interface Index {
  name: string;
  type: string;
  isUnique: boolean;
  isPrimaryKey: boolean;
  columns: string;
}

interface Statistics {
  rowCount: number;
  totalSizeKB: number;
  usedSizeKB: number;
}

interface TableMetadata {
  schema: string;
  name: string;
  type: 'TABLE' | 'VIEW';
  columns: Column[];
  primaryKey?: PrimaryKey;
  foreignKeys?: ForeignKey[];
  indexes: Index[];
  statistics?: Statistics;
  sampleData?: any[];
}

interface SchemaResult {
  schema: TableMetadata[];
}

export async function getSchema(args: {
  tables?: string[];
  schema?: string;
  includeRelationships?: boolean;
  includeStatistics?: boolean;
}): Promise<SchemaResult> {
  const {
    tables,
    schema = 'dbo',
    includeRelationships = true,
    includeStatistics = false,
  } = args;

  const cacheKey = `schema:${schema}:${tables?.join(',') || 'all'}:${includeRelationships}:${includeStatistics}`;
  const cached = cache.get<SchemaResult>(cacheKey);
  if (cached) {
    logger.info('Returning cached schema data');
    return cached;
  }

  try {
    const pool = await db.connect();
    const request = pool.request();

    // Convert array to comma-separated string
    const tableNames = tables && tables.length > 0 ? tables.join(',') : null;

    request.input('TableNames', sql.NVarChar(sql.MAX), tableNames);
    request.input('SchemaName', sql.NVarChar(128), schema);
    request.input('IncludeRelationships', sql.Bit, includeRelationships ? 1 : 0);
    request.input('IncludeSampleData', sql.Bit, 0); // Don't include sample data by default
    request.input('IncludeStatistics', sql.Bit, includeStatistics ? 1 : 0);

    const queryResult = await request.execute('dbo.GetSchemaMetadata');

    // The stored procedure returns a single row with a JSON string
    const jsonRow = queryResult.recordset[0];
    if (!jsonRow || !jsonRow.MetadataJson) {
      logger.warn('No metadata returned from stored procedure');
      return { schema: [] };
    }

    // Parse the JSON result
    const result: SchemaResult = JSON.parse(jsonRow.MetadataJson);

    // Parse nested JSON arrays if they're strings
    if (result.schema) {
      result.schema = result.schema.map(table => ({
        ...table,
        columns: typeof table.columns === 'string' ? JSON.parse(table.columns) : table.columns,
        foreignKeys: table.foreignKeys && typeof table.foreignKeys === 'string'
          ? JSON.parse(table.foreignKeys)
          : table.foreignKeys,
        indexes: typeof table.indexes === 'string' ? JSON.parse(table.indexes) : table.indexes,
      }));
    }

    cache.set(cacheKey, result);
    logger.info(`Retrieved schema for ${result.schema?.length || 0} tables`);
    return result;
  } catch (error) {
    logger.error('Error getting schema:', error);
    throw error;
  }
}

export async function getTableInfo(args: {
  table: string;
  schema?: string;
}): Promise<TableMetadata> {
  const { table, schema = 'dbo' } = args;

  const cacheKey = `table:${schema}:${table}`;
  const cached = cache.get<TableMetadata>(cacheKey);
  if (cached) {
    logger.info('Returning cached table info');
    return cached;
  }

  try {
    // Use the scalar function which returns JSON
    const query = `SELECT dbo.GetTableSchema(@SchemaName, @TableName) AS JsonResult`;
    const result = await db.query(query, {
      SchemaName: schema,
      TableName: table,
    });

    if (!result.recordset[0]?.JsonResult) {
      throw new Error(`Table ${schema}.${table} not found`);
    }

    // Parse the JSON result
    const tableInfo: TableMetadata = JSON.parse(result.recordset[0].JsonResult);

    // Parse nested JSON arrays if they're strings
    if (typeof tableInfo.columns === 'string') {
      tableInfo.columns = JSON.parse(tableInfo.columns);
    }
    if (tableInfo.foreignKeys && typeof tableInfo.foreignKeys === 'string') {
      tableInfo.foreignKeys = JSON.parse(tableInfo.foreignKeys);
    }
    if (typeof tableInfo.indexes === 'string') {
      tableInfo.indexes = JSON.parse(tableInfo.indexes);
    }

    cache.set(cacheKey, tableInfo);
    logger.info(`Retrieved info for table ${schema}.${table}`);
    return tableInfo;
  } catch (error) {
    logger.error('Error getting table info:', error);
    throw error;
  }
}