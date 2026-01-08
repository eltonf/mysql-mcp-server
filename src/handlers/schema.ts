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

/**
 * Find ALL schema locations for each table (supports cross-schema discovery).
 * Returns tables grouped by schema and any tables not found.
 */
async function findTablesAcrossSchemas(
  database: string,
  tables: string[]
): Promise<{
  tablesBySchema: Map<string, string[]>;
  notFound: { table: string; message: string; suggestions?: string[] }[];
}> {
  const tablesBySchema = new Map<string, string[]>();
  const notFound: { table: string; message: string; suggestions?: string[] }[] = [];

  for (const table of tables) {
    const validation = await validateDatabaseObject(database, table);

    if (validation.valid && validation.table?.actualName) {
      // Single match - extract schema from "schema.table"
      const fullName = validation.table.actualName;
      const [detectedSchema, actualTable] = fullName.includes('.')
        ? fullName.split('.')
        : ['dbo', fullName];

      if (!tablesBySchema.has(detectedSchema)) {
        tablesBySchema.set(detectedSchema, []);
      }
      tablesBySchema.get(detectedSchema)!.push(actualTable);
    } else if (validation.table?.tables && validation.table.tables.length > 1) {
      // Multiple matches across schemas - add ALL of them
      for (const match of validation.table.tables) {
        const schemaName = match.schema || 'dbo';
        const tableName = match.table || table;

        if (!tablesBySchema.has(schemaName)) {
          tablesBySchema.set(schemaName, []);
        }
        tablesBySchema.get(schemaName)!.push(tableName);
      }
    } else {
      // Not found
      notFound.push({
        table,
        message: validation.message,
        suggestions: validation.table?.suggestions
      });
    }
  }

  return { tablesBySchema, notFound };
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
    schema,  // undefined triggers auto-detection
    includeRelationships = true,
    includeStatistics = false,
  } = args;

  // Helper to parse nested JSON in table metadata
  const parseTableMetadata = (table: TableMetadata): TableMetadata => ({
    ...table,
    columns: typeof table.columns === 'string' ? JSON.parse(table.columns) : table.columns,
    foreignKeys: table.foreignKeys && typeof table.foreignKeys === 'string'
      ? JSON.parse(table.foreignKeys)
      : table.foreignKeys,
    indexes: typeof table.indexes === 'string' ? JSON.parse(table.indexes) : table.indexes,
  });

  // Helper to execute schema query and parse results
  const executeSchemaQuery = async (
    schemaName: string,
    tableNames: string[] | null
  ): Promise<TableMetadata[]> => {
    const query = buildGetSchemaMetadataQuery(
      database,
      schemaName,
      tableNames,
      includeRelationships,
      includeStatistics
    );

    const queryResult = await db.query(query);
    const jsonRow = queryResult.recordset[0];

    if (!jsonRow || !jsonRow.MetadataJson) {
      return [];
    }

    const result: SchemaResult = JSON.parse(jsonRow.MetadataJson);
    return (result.schema || []).map(parseTableMetadata);
  };

  try {
    // Case 1: Schema explicitly provided - use existing single-query logic
    if (schema) {
      const cacheKey = `schema:${database}:${schema}:${tables?.join(',') || 'all'}:${includeRelationships}:${includeStatistics}`;
      const cached = cache.get<SchemaResult>(cacheKey);
      if (cached) {
        logger.info('Returning cached schema data');
        return cached;
      }

      const schemaData = await executeSchemaQuery(schema, tables || null);
      const result: SchemaResult = { schema: schemaData };

      cache.set(cacheKey, result);
      logger.info(`Retrieved schema for ${schemaData.length} tables from ${database}.${schema}`);
      return result;
    }

    // Case 2: Tables provided, no schema - find ALL matches across schemas
    if (tables && tables.length > 0) {
      const cacheKey = `schema:${database}:auto:${tables.join(',')}:${includeRelationships}:${includeStatistics}`;
      const cached = cache.get<SchemaResult>(cacheKey);
      if (cached) {
        logger.info('Returning cached schema data (auto-detected)');
        return cached;
      }

      const { tablesBySchema, notFound } = await findTablesAcrossSchemas(database, tables);

      // Handle not found tables
      if (notFound.length > 0) {
        const errorLines = notFound.map(e =>
          `  - ${e.table}: ${e.suggestions?.length ? `Did you mean: ${e.suggestions.join(', ')}?` : 'No matches found'}`
        );
        throw new Error(`Tables not found:\n${errorLines.join('\n')}`);
      }

      // Query each schema and merge results
      const allResults: TableMetadata[] = [];
      for (const [schemaName, schemaTables] of tablesBySchema) {
        const schemaData = await executeSchemaQuery(schemaName, schemaTables);
        allResults.push(...schemaData);
      }

      const result: SchemaResult = { schema: allResults };
      cache.set(cacheKey, result);
      logger.info(`Retrieved schema for ${allResults.length} tables from ${database} (auto-detected across ${tablesBySchema.size} schemas)`);
      return result;
    }

    // Case 3: No tables, no schema - require schema parameter
    throw new Error('Schema parameter is required when no tables are specified. Use find_tables to discover available tables first.');

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