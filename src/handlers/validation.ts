import { resolveDatabase, resolveSchema } from '../core/config.js';
import { logger } from '../core/logger.js';
import { db } from '../mysql/connection.js';

export interface ValidationResult {
  exists: boolean;
  actualName?: string;
  suggestions?: string[];
  message: string;
}

export interface DatabaseValidation extends ValidationResult {
  databases?: string[];
}

export interface SchemaValidation extends ValidationResult {
  schemas?: string[];
}

export interface TableValidation extends ValidationResult {
  tables?: Array<{ schema: string; table: string; fullName: string; type?: string; rowCount?: number | null }>;
}

export async function validateDatabase(database?: string): Promise<DatabaseValidation> {
  const actualName = resolveDatabase(database);
  return {
    exists: true,
    actualName,
    message: database && database !== actualName
      ? `Database found (case mismatch): '${actualName}' (you provided '${database}')`
      : `Database '${actualName}' is configured for this server`,
  };
}

export async function validateSchema(database: string | undefined, schema?: string): Promise<SchemaValidation> {
  const actualDatabase = resolveDatabase(database);
  const actualSchema = resolveSchema(schema);
  return {
    exists: true,
    actualName: actualSchema,
    message: `Schema '${actualSchema}' is available in database '${actualDatabase}'`,
  };
}

export async function validateTable(
  database: string | undefined,
  table: string,
  schema?: string,
): Promise<TableValidation> {
  const actualDatabase = resolveDatabase(database);
  resolveSchema(schema);

  try {
    const matches = await db.query<any>(
      `
SELECT
  TABLE_SCHEMA AS schemaName,
  TABLE_NAME AS tableName,
  CONCAT(TABLE_SCHEMA, '.', TABLE_NAME) AS fullName,
  TABLE_TYPE AS objectType,
  TABLE_ROWS AS rowCount
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = :database
  AND LOWER(TABLE_NAME) = LOWER(:table)
  AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
ORDER BY TABLE_NAME
`,
      { database: actualDatabase, table },
    );

    if (matches.length === 1) {
      const match = matches[0];
      return {
        exists: true,
        actualName: match.fullName,
        message: match.tableName === table
          ? `Table '${match.fullName}' exists`
          : `Table found (case mismatch): '${match.fullName}' (you provided '${table}')`,
      };
    }

    const suggestions = await db.query<any>(
      `
SELECT
  TABLE_SCHEMA AS schemaName,
  TABLE_NAME AS tableName,
  CONCAT(TABLE_SCHEMA, '.', TABLE_NAME) AS fullName,
  TABLE_TYPE AS objectType,
  TABLE_ROWS AS rowCount
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = :database
  AND LOWER(TABLE_NAME) LIKE CONCAT('%', LOWER(:table), '%')
  AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
ORDER BY TABLE_NAME
LIMIT 10
`,
      { database: actualDatabase, table },
    );

    const tables = suggestions.map((row) => ({
      schema: row.schemaName,
      table: row.tableName,
      fullName: row.fullName,
      type: row.objectType,
      rowCount: row.rowCount,
    }));

    return {
      exists: false,
      tables,
      suggestions: tables.slice(0, 5).map((row) => row.fullName),
      message: tables.length
        ? `Table '${table}' not found in database '${actualDatabase}'. Did you mean: ${tables.slice(0, 5).map((row) => row.fullName).join(', ')}?`
        : `Table '${table}' not found in database '${actualDatabase}'. No similar tables found.`,
    };
  } catch (error) {
    logger.error('Table validation failed:', error);
    throw error;
  }
}

export async function validateDatabaseObject(
  database?: string,
  table?: string,
  schema?: string,
): Promise<{
  valid: boolean;
  database: DatabaseValidation;
  schema?: SchemaValidation;
  table?: TableValidation;
  message: string;
}> {
  const databaseValidation = await validateDatabase(database);
  const schemaValidation = schema
    ? await validateSchema(databaseValidation.actualName, schema)
    : undefined;

  if (table) {
    const tableValidation = await validateTable(databaseValidation.actualName, table, schemaValidation?.actualName);
    if (!tableValidation.exists) {
      return {
        valid: false,
        database: databaseValidation,
        schema: schemaValidation,
        table: tableValidation,
        message: tableValidation.message,
      };
    }

    return {
      valid: true,
      database: databaseValidation,
      schema: schemaValidation,
      table: tableValidation,
      message: `Validation successful: ${tableValidation.actualName}`,
    };
  }

  return {
    valid: true,
    database: databaseValidation,
    schema: schemaValidation,
    message: 'Validation successful',
  };
}
