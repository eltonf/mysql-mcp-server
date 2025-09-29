import { db } from '../db/connection.js';
import { logger } from '../utils/logger.js';

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
  tables?: Array<{ schema: string; table: string; fullName: string }>;
}

/**
 * Validates if a database exists and provides suggestions if not found
 */
export async function validateDatabase(database: string): Promise<DatabaseValidation> {
  try {
    const query = `
      SELECT name
      FROM sys.databases
      WHERE name = @dbName
      OR LOWER(name) = LOWER(@dbName)
    `;

    const result = await db.query(query, { dbName: database });

    if (result.recordset.length > 0) {
      const actualName = result.recordset[0].name;
      return {
        exists: true,
        actualName,
        message: actualName === database
          ? `Database '${database}' exists`
          : `Database found (case mismatch): '${actualName}' (you provided '${database}')`,
      };
    }

    // Get all databases for suggestions
    const allDbsResult = await db.query(`
      SELECT name
      FROM sys.databases
      WHERE database_id > 4  -- Exclude system databases
      ORDER BY name
    `);

    const allDatabases = allDbsResult.recordset.map((row: any) => row.name);

    // Find similar database names (fuzzy matching)
    const suggestions = allDatabases.filter((dbName: string) =>
      dbName.toLowerCase().includes(database.toLowerCase()) ||
      database.toLowerCase().includes(dbName.toLowerCase())
    ).slice(0, 5);

    return {
      exists: false,
      databases: allDatabases,
      suggestions: suggestions.length > 0 ? suggestions : allDatabases.slice(0, 5),
      message: suggestions.length > 0
        ? `Database '${database}' not found. Did you mean: ${suggestions.join(', ')}?`
        : `Database '${database}' not found. Available databases: ${allDatabases.slice(0, 5).join(', ')}`,
    };
  } catch (error) {
    logger.error('Database validation failed:', error);
    throw error;
  }
}

/**
 * Validates if a schema exists in a database
 */
export async function validateSchema(database: string, schema: string): Promise<SchemaValidation> {
  try {
    const query = `
      USE [${database}];

      SELECT name
      FROM sys.schemas
      WHERE name = @schemaName
      OR LOWER(name) = LOWER(@schemaName)
    `;

    const result = await db.query(query, { schemaName: schema });

    if (result.recordset.length > 0) {
      const actualName = result.recordset[0].name;
      return {
        exists: true,
        actualName,
        message: actualName === schema
          ? `Schema '${schema}' exists in database '${database}'`
          : `Schema found (case mismatch): '${actualName}' (you provided '${schema}')`,
      };
    }

    // Get all schemas for suggestions
    const allSchemasResult = await db.query(`
      USE [${database}];
      SELECT name FROM sys.schemas ORDER BY name
    `);

    const allSchemas = allSchemasResult.recordset.map((row: any) => row.name);

    return {
      exists: false,
      schemas: allSchemas,
      suggestions: allSchemas.slice(0, 5),
      message: `Schema '${schema}' not found in database '${database}'. Available schemas: ${allSchemas.join(', ')}`,
    };
  } catch (error) {
    logger.error('Schema validation failed:', error);
    throw error;
  }
}

/**
 * Validates if a table exists and provides smart suggestions
 * Handles partial matches, case insensitivity, and schema-qualified names
 * When schema not specified, searches all schemas and handles disambiguation
 */
export async function validateTable(
  database: string,
  table: string,
  schema?: string
): Promise<TableValidation> {
  try {
    const query = `
      USE [${database}];

      -- Search for exact table name matches (with row counts for disambiguation)
      SELECT
        s.name AS SchemaName,
        t.name AS TableName,
        s.name + '.' + t.name AS FullName,
        'TABLE' AS ObjectType,
        (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = t.object_id AND p.index_id IN (0,1)) AS [RowCount]
      FROM sys.tables t
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      WHERE
        (t.name = @tableName OR LOWER(t.name) = LOWER(@tableName))
        ${schema ? "AND (s.name = @schemaName OR LOWER(s.name) = LOWER(@schemaName))" : ""}

      UNION ALL

      -- Also check views
      SELECT
        s.name AS SchemaName,
        v.name AS TableName,
        s.name + '.' + v.name AS FullName,
        'VIEW' AS ObjectType,
        NULL AS [RowCount]
      FROM sys.views v
      INNER JOIN sys.schemas s ON v.schema_id = s.schema_id
      WHERE
        (v.name = @tableName OR LOWER(v.name) = LOWER(@tableName))
        ${schema ? "AND (s.name = @schemaName OR LOWER(s.name) = LOWER(@schemaName))" : ""}

      ORDER BY SchemaName, TableName
    `;

    const params: Record<string, any> = { tableName: table };
    if (schema) {
      params.schemaName = schema;
    }

    const result = await db.query(query, params);

    if (result.recordset.length === 1) {
      // Exactly one match - use it automatically
      const match = result.recordset[0];
      const schemaNote = !schema ? ` (auto-detected schema: ${match.SchemaName})` : '';
      return {
        exists: true,
        actualName: match.FullName,
        message: match.TableName === table
          ? `Table '${match.FullName}' exists in database '${database}'${schemaNote}`
          : `Table found (case mismatch): '${match.FullName}' (you provided '${table}')${schemaNote}`,
      };
    } else if (result.recordset.length > 1) {
      // Multiple matches across different schemas - need disambiguation
      const matches = result.recordset.map((row: any) => ({
        schema: row.SchemaName,
        table: row.TableName,
        fullName: row.FullName,
        type: row.ObjectType,
        rowCount: row.RowCount,
      }));

      const matchList = matches
        .map(m => `${m.fullName} (${m.type}${m.rowCount !== null ? `, ${m.rowCount} rows` : ''})`)
        .join(', ');

      return {
        exists: false,
        tables: matches,
        suggestions: matches.map(m => m.fullName),
        message: `Ambiguous: Table '${table}' exists in multiple schemas in database '${database}'. Please specify which one: ${matchList}`,
      };
    }

    // No exact match - find similar tables
    const fuzzyQuery = `
      USE [${database}];

      SELECT TOP 10
        s.name AS SchemaName,
        t.name AS TableName,
        s.name + '.' + t.name AS FullName,
        'table' AS ObjectType
      FROM sys.tables t
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      WHERE
        LOWER(t.name) LIKE '%' + LOWER(@searchTerm) + '%'
        ${schema ? "AND (s.name = @schemaName OR LOWER(s.name) = LOWER(@schemaName))" : ""}

      UNION ALL

      SELECT TOP 10
        s.name AS SchemaName,
        v.name AS TableName,
        s.name + '.' + v.name AS FullName,
        'view' AS ObjectType
      FROM sys.views v
      INNER JOIN sys.schemas s ON v.schema_id = s.schema_id
      WHERE
        LOWER(v.name) LIKE '%' + LOWER(@searchTerm) + '%'
        ${schema ? "AND (s.name = @schemaName OR LOWER(s.name) = LOWER(@schemaName))" : ""}

      ORDER BY TableName
    `;

    const fuzzyParams: Record<string, any> = { searchTerm: table };
    if (schema) {
      fuzzyParams.schemaName = schema;
    }

    const fuzzyResult = await db.query(fuzzyQuery, fuzzyParams);

    const suggestions = fuzzyResult.recordset.map((row: any) => ({
      schema: row.SchemaName,
      table: row.TableName,
      fullName: row.FullName,
    }));

    if (suggestions.length > 0) {
      return {
        exists: false,
        tables: suggestions,
        suggestions: suggestions.slice(0, 5).map(s => s.fullName),
        message: `Table '${table}' not found in database '${database}'. Did you mean: ${suggestions.slice(0, 5).map(s => s.fullName).join(', ')}?`,
      };
    }

    return {
      exists: false,
      message: `Table '${table}' not found in database '${database}'${schema ? ` (schema: ${schema})` : ''}. No similar tables found.`,
    };
  } catch (error) {
    logger.error('Table validation failed:', error);
    throw error;
  }
}

/**
 * Comprehensive validation that checks database, schema, and table in sequence
 */
export async function validateDatabaseObject(
  database: string,
  table?: string,
  schema?: string
): Promise<{
  valid: boolean;
  database: DatabaseValidation;
  schema?: SchemaValidation;
  table?: TableValidation;
  message: string;
}> {
  // Step 1: Validate database
  const dbValidation = await validateDatabase(database);

  if (!dbValidation.exists) {
    return {
      valid: false,
      database: dbValidation,
      message: dbValidation.message,
    };
  }

  // Use actual database name (in case of case mismatch)
  const actualDatabase = dbValidation.actualName || database;

  // Step 2: Validate schema if provided
  let schemaValidation: SchemaValidation | undefined;
  let actualSchema: string | undefined = schema;

  if (schema) {
    schemaValidation = await validateSchema(actualDatabase, schema);
    if (!schemaValidation.exists) {
      return {
        valid: false,
        database: dbValidation,
        schema: schemaValidation,
        message: schemaValidation.message,
      };
    }
    actualSchema = schemaValidation.actualName || schema;
  }
  // Note: When schema not provided, actualSchema is undefined
  // validateTable will search all schemas and auto-detect or require disambiguation

  // Step 3: Validate table if provided
  let tableValidation: TableValidation | undefined;

  if (table) {
    tableValidation = await validateTable(actualDatabase, table, actualSchema);
    if (!tableValidation.exists) {
      return {
        valid: false,
        database: dbValidation,
        schema: schemaValidation,
        table: tableValidation,
        message: tableValidation.message,
      };
    }
  }

  return {
    valid: true,
    database: dbValidation,
    schema: schemaValidation,
    table: tableValidation,
    message: 'All objects validated successfully',
  };
}