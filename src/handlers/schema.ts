import { db } from '../db/connection.js';
import { cache } from '../db/cache.js';
import { logger } from '../utils/logger.js';
import { buildGetSchemaMetadataQuery, buildGetTableSchemaQuery } from '../db/queries.js';
import { validateDatabaseObject } from './validation.js';

// JSON-based interfaces matching the inline query output
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
  database: string;
  tables?: string[];
  schema?: string;
  includeRelationships?: boolean;
  includeStatistics?: boolean;
}): Promise<SchemaResult> {
  const {
    database,
    tables,
    schema = 'dbo',
    includeRelationships = true,
    includeStatistics = false,
  } = args;

  const cacheKey = `schema:${database}:${schema}:${tables?.join(',') || 'all'}:${includeRelationships}:${includeStatistics}`;
  const cached = cache.get<SchemaResult>(cacheKey);
  if (cached) {
    logger.info('Returning cached schema data');
    return cached;
  }

  try {
    // Build inline SQL query
    const query = buildGetSchemaMetadataQuery(
      database,
      schema,
      tables || null,
      includeRelationships,
      includeStatistics
    );

    const queryResult = await db.query(query);

    // The inline query returns a single row with a JSON string
    const jsonRow = queryResult.recordset[0];
    if (!jsonRow || !jsonRow.MetadataJson) {
      logger.warn('No metadata returned from query');
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
    logger.info(`Retrieved schema for ${result.schema?.length || 0} tables from ${database}`);
    return result;
  } catch (error) {
    logger.error(`Error getting schema from ${database}:`, error);
    throw error;
  }
}

export async function getTableInfo(args: {
  database: string;
  table: string;
  schema?: string;
}): Promise<TableMetadata> {
  const { database, table, schema } = args;

  // Validate the database and table exist first
  const validation = await validateDatabaseObject(database, table, schema);

  if (!validation.valid) {
    // Check if this is an ambiguity error (multiple schemas with same table)
    if (validation.table && validation.table.suggestions && validation.table.suggestions.length > 1) {
      // Throw error with strong language to prompt user interaction
      const options = validation.table.tables || [];
      const optionsList = options
        .map((opt: any) => `  - ${opt.fullName}${opt.rowCount ? ` (${opt.rowCount.toLocaleString()} rows)` : ''}`)
        .join('\n');

      const errorMsg = `❌ AMBIGUOUS TABLE NAME - USER INPUT REQUIRED

Table '${table}' exists in ${options.length} different schemas in database '${database}'.

Please ask the user which table they want:

${optionsList}

DO NOT automatically query all versions. Ask the user: "Which schema do you want: ${options.map((o: any) => o.fullName).join(' or ')}?"`;

      const error: any = new Error(errorMsg);
      error.validation = validation;
      error.isAmbiguous = true;
      throw error;
    }

    // For other validation errors (table not found, etc), throw error
    const error: any = new Error(validation.message);
    error.validation = validation;
    throw error;
  }

  const cacheKey = `table:${database}:${schema}:${table}`;
  const cached = cache.get<TableMetadata>(cacheKey);
  if (cached) {
    logger.info('Returning cached table info');
    return cached;
  }

  try {
    // Use validated names (handles case mismatches)
    const actualDatabase = validation.database.actualName || database;
    const fullTableName = validation.table?.actualName || table;

    // Parse schema and table name from validation result
    // If validation returned "dbo.tblCollegeStats", split it
    // If validation returned just "tblCollegeStats", use provided schema or undefined
    let actualSchema: string;
    let actualTable: string;

    if (fullTableName.includes('.')) {
      const parts = fullTableName.split('.');
      actualSchema = parts[0];
      actualTable = parts[1];
    } else {
      actualSchema = validation.schema?.actualName || schema || 'dbo';
      actualTable = fullTableName;
    }

    // Build inline SQL query
    const query = buildGetTableSchemaQuery(actualDatabase, actualSchema, actualTable);

    const result = await db.query(query);

    if (!result.recordset[0]?.JsonResult) {
      throw new Error(`Table ${actualSchema}.${actualTable} not found in database ${actualDatabase}`);
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
    logger.info(`Retrieved info for table ${database}.${schema}.${table}`);
    return tableInfo;
  } catch (error) {
    logger.error(`Error getting table info from ${database}:`, error);
    throw error;
  }
}