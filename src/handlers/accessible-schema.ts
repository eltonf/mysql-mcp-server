/**
 * Accessible Schema Handlers
 *
 * Provides tools to introspect which tables and columns are accessible
 * based on the query access control configuration. These tools help LLMs
 * understand what they can query BEFORE attempting execute_query.
 */

import { db } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import {
  isAccessControlInitialized,
  getAccessControlConfig,
  getTableConfigForSchema,
} from '../security/access-control.js';
import { AccessControlConfig, ColumnAccessPolicy, TableConfig } from '../security/types.js';
import { getTableInfo } from './schema.js';
import { findTables } from './search.js';

// ============================================================================
// Type Definitions
// ============================================================================

export interface AccessibleColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  isIdentity: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  description?: string;
}

export interface AccessibleTable {
  schema: string;
  name: string;
  type: 'TABLE' | 'VIEW';
  columnAccessMode?: 'inclusion' | 'exclusion'; // undefined = all columns allowed
  accessibleColumns: AccessibleColumn[];
  blockedColumns?: string[]; // For exclusion mode (informational)
  allowedColumnsList?: string[]; // For inclusion mode (shows config)
}

export interface AccessibleSchemaResult {
  database: string;
  requireExplicitColumns: boolean;
  configuredSchemas: string[];
  tables: AccessibleTable[];
  notes?: string[];
}

export interface AccessibleColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  isIdentity: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  description?: string;
  isAccessible: boolean;
  accessDeniedReason?: string;
}

export interface AccessibleTableIndex {
  name: string;
  type: string;
  isUnique: boolean;
  isPrimaryKey: boolean;
  columns: string;
}

export interface AccessibleTableForeignKey {
  constraintName: string;
  fromColumns: string;
  toSchema: string;
  toTable: string;
  toColumns: string;
}

export interface AccessibleTableInfo {
  database: string;
  schema: string;
  table: string;
  type: 'TABLE' | 'VIEW';
  isAccessible: boolean;
  accessDeniedReason?: string;
  columnAccessMode?: 'inclusion' | 'exclusion';
  columns?: AccessibleColumnInfo[];
  indexes?: AccessibleTableIndex[];
  foreignKeys?: AccessibleTableForeignKey[];
  accessibleColumnCount?: number;
  totalColumnCount?: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get all schemas that have configuration for a database
 */
function getConfiguredSchemas(config: AccessControlConfig, database: string): string[] {
  const dbConfig = config.databases[database.toUpperCase()];
  if (!dbConfig) {
    return [];
  }

  if (dbConfig.schemas) {
    return Object.keys(dbConfig.schemas);
  }

  // Compact format - no specific schemas, use wildcard
  return ['*'];
}

/**
 * Get all user schemas from the database
 */
async function getAllSchemasFromDatabase(database: string): Promise<string[]> {
  const query = `
USE [${database}];
SELECT name
FROM sys.schemas
WHERE schema_id BETWEEN 5 AND 16383
  AND name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest')
ORDER BY name;
`;
  try {
    const result = await db.query(query);
    return result.recordset.map((row: any) => row.name);
  } catch (error) {
    logger.error(`Error getting schemas from ${database}:`, error);
    return ['dbo']; // Fallback to dbo
  }
}

/**
 * Check if a table is accessible based on table config
 */
function isTableAccessible(
  tableName: string,
  tableConfig: TableConfig
): { accessible: boolean; reason?: string } {
  const tableNameLower = tableName.toLowerCase();
  const listLower = tableConfig.list.map((t) => t.toLowerCase());

  switch (tableConfig.mode) {
    case 'whitelist':
      if (!listLower.includes(tableNameLower)) {
        return {
          accessible: false,
          reason: `Table not in whitelist. Allowed tables: ${tableConfig.list.join(', ') || '(none)'}`,
        };
      }
      return { accessible: true };

    case 'blacklist':
      if (listLower.includes(tableNameLower)) {
        return {
          accessible: false,
          reason: 'Table is in blacklist',
        };
      }
      return { accessible: true };

    case 'none':
      return { accessible: true };

    default:
      return { accessible: false, reason: 'Unknown table access mode' };
  }
}

/**
 * Filter columns based on column access policy
 */
function filterColumns(
  columns: any[],
  tableName: string,
  columnAccess: Record<string, ColumnAccessPolicy>
): {
  accessibleColumns: AccessibleColumn[];
  blockedColumns?: string[];
  allowedColumnsList?: string[];
  mode?: 'inclusion' | 'exclusion';
} {
  // Find policy for this table (case-insensitive)
  let policy: ColumnAccessPolicy | null = null;
  for (const [table, tablePolicy] of Object.entries(columnAccess)) {
    if (table.toLowerCase() === tableName.toLowerCase()) {
      policy = tablePolicy;
      break;
    }
  }

  // No policy = all columns accessible
  if (!policy) {
    return {
      accessibleColumns: columns.map((col) => ({
        name: col.name,
        dataType: col.dataType,
        nullable: col.nullable,
        isIdentity: col.isIdentity,
        isPrimaryKey: col.isPrimaryKey,
        isForeignKey: col.isForeignKey,
        description: col.description,
      })),
    };
  }

  const columnsLower = policy.columns.map((c) => c.toLowerCase());

  if (policy.mode === 'inclusion') {
    // Whitelist: only columns in the list are accessible
    const accessibleColumns = columns
      .filter((col) => columnsLower.includes(col.name.toLowerCase()))
      .map((col) => ({
        name: col.name,
        dataType: col.dataType,
        nullable: col.nullable,
        isIdentity: col.isIdentity,
        isPrimaryKey: col.isPrimaryKey,
        isForeignKey: col.isForeignKey,
        description: col.description,
      }));

    return {
      accessibleColumns,
      allowedColumnsList: policy.columns,
      mode: 'inclusion',
    };
  } else {
    // Exclusion: columns in the list are blocked
    const accessibleColumns = columns
      .filter((col) => !columnsLower.includes(col.name.toLowerCase()))
      .map((col) => ({
        name: col.name,
        dataType: col.dataType,
        nullable: col.nullable,
        isIdentity: col.isIdentity,
        isPrimaryKey: col.isPrimaryKey,
        isForeignKey: col.isForeignKey,
        description: col.description,
      }));

    return {
      accessibleColumns,
      blockedColumns: policy.columns,
      mode: 'exclusion',
    };
  }
}

/**
 * Annotate columns with access status
 */
function annotateColumnsWithAccess(
  columns: any[],
  tableName: string,
  columnAccess: Record<string, ColumnAccessPolicy>
): {
  annotatedColumns: AccessibleColumnInfo[];
  mode?: 'inclusion' | 'exclusion';
} {
  // Find policy for this table (case-insensitive)
  let policy: ColumnAccessPolicy | null = null;
  for (const [table, tablePolicy] of Object.entries(columnAccess)) {
    if (table.toLowerCase() === tableName.toLowerCase()) {
      policy = tablePolicy;
      break;
    }
  }

  // No policy = all columns accessible
  if (!policy) {
    return {
      annotatedColumns: columns.map((col) => ({
        name: col.name,
        dataType: col.dataType,
        nullable: col.nullable,
        isIdentity: col.isIdentity,
        isPrimaryKey: col.isPrimaryKey,
        isForeignKey: col.isForeignKey,
        description: col.description,
        isAccessible: true,
      })),
    };
  }

  const columnsLower = policy.columns.map((c) => c.toLowerCase());

  if (policy.mode === 'inclusion') {
    // Whitelist: only columns in the list are accessible
    return {
      annotatedColumns: columns.map((col) => {
        const isAccessible = columnsLower.includes(col.name.toLowerCase());
        return {
          name: col.name,
          dataType: col.dataType,
          nullable: col.nullable,
          isIdentity: col.isIdentity,
          isPrimaryKey: col.isPrimaryKey,
          isForeignKey: col.isForeignKey,
          description: col.description,
          isAccessible,
          accessDeniedReason: isAccessible
            ? undefined
            : `Column not in inclusion list. Allowed: ${policy!.columns.join(', ')}`,
        };
      }),
      mode: 'inclusion',
    };
  } else {
    // Exclusion: columns in the list are blocked
    return {
      annotatedColumns: columns.map((col) => {
        const isBlocked = columnsLower.includes(col.name.toLowerCase());
        return {
          name: col.name,
          dataType: col.dataType,
          nullable: col.nullable,
          isIdentity: col.isIdentity,
          isPrimaryKey: col.isPrimaryKey,
          isForeignKey: col.isForeignKey,
          description: col.description,
          isAccessible: !isBlocked,
          accessDeniedReason: isBlocked
            ? `Column in exclusion list: ${policy!.columns.join(', ')}`
            : undefined,
        };
      }),
      mode: 'exclusion',
    };
  }
}

// ============================================================================
// Main Handlers
// ============================================================================

/**
 * Get all accessible tables and columns for a database
 */
export async function getAccessibleSchema(args: {
  database: string;
  schema?: string;
}): Promise<AccessibleSchemaResult> {
  const { database, schema: filterSchema } = args;

  // Check if access control is initialized
  if (!isAccessControlInitialized()) {
    throw new Error(
      'Access control not configured. Set QUERY_ACCESS_CONFIG environment variable to enable accessible schema introspection.'
    );
  }

  const config = getAccessControlConfig();

  // Validate database is in config
  const dbUpper = database.toUpperCase();
  if (!config.databases[dbUpper]) {
    const configuredDbs = Object.keys(config.databases);
    throw new Error(
      `Database '${database}' is not configured in query access control. ` +
        `Configured databases: ${configuredDbs.join(', ') || '(none)'}`
    );
  }

  const notes: string[] = [];
  const allTables: AccessibleTable[] = [];

  // Determine which schemas to process
  let schemasToProcess: string[];
  const configuredSchemas = getConfiguredSchemas(config, database);

  if (filterSchema) {
    // User specified a schema - use just that one
    schemasToProcess = [filterSchema];
  } else if (configuredSchemas.includes('*')) {
    // Wildcard schema - get all schemas from database
    schemasToProcess = await getAllSchemasFromDatabase(database);
    notes.push(`Wildcard schema (*) in config - checking all ${schemasToProcess.length} schemas`);
  } else {
    // Use explicitly configured schemas
    schemasToProcess = configuredSchemas;
  }

  // Process each schema
  for (const schemaName of schemasToProcess) {
    const schemaConfig = getTableConfigForSchema(config, database, schemaName);

    if (!schemaConfig) {
      // Schema not configured - skip with note
      if (filterSchema) {
        throw new Error(
          `Schema '${schemaName}' is not configured for query access in database '${database}'. ` +
            `Configured schemas: ${configuredSchemas.join(', ')}`
        );
      }
      continue;
    }

    const { tableConfig, columnAccess } = schemaConfig;

    // Get list of accessible tables for this schema
    let accessibleTableNames: string[];

    if (tableConfig.mode === 'whitelist') {
      // Whitelist: use the configured list directly
      accessibleTableNames = tableConfig.list;
    } else {
      // Blacklist or none: get all tables from DB, then filter
      const dbTables = await findTables({ database, schema: schemaName });
      const allTableNames = dbTables.map((t) => t.tableName);

      if (tableConfig.mode === 'blacklist') {
        const blacklistLower = tableConfig.list.map((t) => t.toLowerCase());
        accessibleTableNames = allTableNames.filter(
          (t) => !blacklistLower.includes(t.toLowerCase())
        );
        if (tableConfig.list.length > 0) {
          notes.push(
            `Schema '${schemaName}' uses blacklist mode - ${tableConfig.list.length} tables blocked: ${tableConfig.list.join(', ')}`
          );
        }
      } else {
        // mode === 'none'
        accessibleTableNames = allTableNames;
      }
    }

    // Get column info for each accessible table
    for (const tableName of accessibleTableNames) {
      try {
        const tableInfo = await getTableInfo({ database, table: tableName, schema: schemaName });

        const { accessibleColumns, blockedColumns, allowedColumnsList, mode } = filterColumns(
          tableInfo.columns,
          tableName,
          columnAccess
        );

        const accessibleTable: AccessibleTable = {
          schema: schemaName,
          name: tableName,
          type: tableInfo.type,
          accessibleColumns,
        };

        if (mode) {
          accessibleTable.columnAccessMode = mode;
        }
        if (blockedColumns && blockedColumns.length > 0) {
          accessibleTable.blockedColumns = blockedColumns;
        }
        if (allowedColumnsList && allowedColumnsList.length > 0) {
          accessibleTable.allowedColumnsList = allowedColumnsList;
        }

        allTables.push(accessibleTable);
      } catch (error: any) {
        // Table might not exist in DB (whitelist has stale entry)
        logger.warn(`Could not get info for table ${schemaName}.${tableName}: ${error.message}`);
      }
    }
  }

  return {
    database,
    requireExplicitColumns: config.requireExplicitColumns,
    configuredSchemas,
    tables: allTables,
    notes: notes.length > 0 ? notes : undefined,
  };
}

/**
 * Get accessible schema for a specific table
 */
export async function getAccessibleTableInfo(args: {
  database: string;
  table: string;
  schema?: string;
}): Promise<AccessibleTableInfo> {
  const { database, table, schema } = args;

  // Check if access control is initialized
  if (!isAccessControlInitialized()) {
    throw new Error(
      'Access control not configured. Set QUERY_ACCESS_CONFIG environment variable to enable accessible schema introspection.'
    );
  }

  const config = getAccessControlConfig();

  // Validate database is in config
  const dbUpper = database.toUpperCase();
  if (!config.databases[dbUpper]) {
    const configuredDbs = Object.keys(config.databases);
    throw new Error(
      `Database '${database}' is not configured in query access control. ` +
        `Configured databases: ${configuredDbs.join(', ') || '(none)'}`
    );
  }

  // Get full table info first (this will auto-detect schema if needed)
  let tableInfo: any;
  let actualSchema: string;

  try {
    tableInfo = await getTableInfo({ database, table, schema });
    actualSchema = tableInfo.schema || schema || 'dbo';
  } catch (error: any) {
    // Table not found or ambiguous
    return {
      database,
      schema: schema || 'unknown',
      table,
      type: 'TABLE',
      isAccessible: false,
      accessDeniedReason: error.message,
    };
  }

  // Get schema config
  const schemaConfig = getTableConfigForSchema(config, database, actualSchema);

  if (!schemaConfig) {
    return {
      database,
      schema: actualSchema,
      table: tableInfo.name,
      type: tableInfo.type,
      isAccessible: false,
      accessDeniedReason: `Schema '${actualSchema}' is not configured for query access in database '${database}'`,
    };
  }

  const { tableConfig, columnAccess } = schemaConfig;

  // Use actual table name from DB result, or fall back to input parameter
  const actualTableName = tableInfo.name || table;

  // Check if table is accessible
  const tableAccessResult = isTableAccessible(actualTableName, tableConfig);

  if (!tableAccessResult.accessible) {
    return {
      database,
      schema: actualSchema,
      table: actualTableName,
      type: tableInfo.type || 'TABLE',
      isAccessible: false,
      accessDeniedReason: tableAccessResult.reason,
    };
  }

  // Annotate columns with access status
  const { annotatedColumns, mode } = annotateColumnsWithAccess(
    tableInfo.columns,
    actualTableName,
    columnAccess
  );

  const accessibleCount = annotatedColumns.filter((c) => c.isAccessible).length;

  const result: AccessibleTableInfo = {
    database,
    schema: actualSchema,
    table: actualTableName,
    type: tableInfo.type || 'TABLE',
    isAccessible: true,
    columns: annotatedColumns,
    accessibleColumnCount: accessibleCount,
    totalColumnCount: annotatedColumns.length,
  };

  if (mode) {
    result.columnAccessMode = mode;
  }

  // Include indexes and foreign keys if available
  if (tableInfo.indexes) {
    result.indexes = tableInfo.indexes.map((idx: any) => ({
      name: idx.name,
      type: idx.type,
      isUnique: idx.isUnique,
      isPrimaryKey: idx.isPrimaryKey,
      columns: idx.columns,
    }));
  }

  if (tableInfo.foreignKeys) {
    result.foreignKeys = tableInfo.foreignKeys.map((fk: any) => ({
      constraintName: fk.constraintName,
      fromColumns: fk.fromColumns,
      toSchema: fk.toSchema,
      toTable: fk.toTable,
      toColumns: fk.toColumns,
    }));
  }

  return result;
}
