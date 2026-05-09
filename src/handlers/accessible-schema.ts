import { resolveDatabase, resolveSchema } from '../core/config.js';
import { logger } from '../core/logger.js';
import {
  getAccessControlConfig,
  getTableConfigForSchema,
  isAccessControlInitialized,
} from '../core/security/access-control.js';
import {
  AccessControlConfig,
  ColumnAccessPolicy,
  TableConfig,
} from '../core/security/types.js';
import { getTableInfo } from './schema.js';
import { findTables } from './search.js';

export interface AccessibleColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  isIdentity: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  description?: string | null;
}

export interface AccessibleTable {
  schema: string;
  name: string;
  type: 'TABLE' | 'VIEW';
  columnAccessMode?: 'inclusion' | 'exclusion';
  accessibleColumns: AccessibleColumn[];
  blockedColumns?: string[];
  allowedColumnsList?: string[];
}

export interface AccessibleSchemaResult {
  database: string;
  requireExplicitColumns: boolean;
  configuredSchemas: string[];
  tables: AccessibleTable[];
  notes?: string[];
}

export interface AccessibleColumnInfo extends AccessibleColumn {
  isAccessible: boolean;
  accessDeniedReason?: string;
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
  indexes?: unknown[];
  foreignKeys?: unknown[];
  accessibleColumnCount?: number;
  totalColumnCount?: number;
}

function requireAccessConfig(database: string): AccessControlConfig {
  if (!isAccessControlInitialized()) {
    throw new Error(
      'Access control not configured. Set QUERY_ACCESS_CONFIG to enable accessible schema introspection.',
    );
  }

  const config = getAccessControlConfig();
  if (!config.databases[database.toUpperCase()]) {
    throw new Error(
      `Database '${database}' is not configured in query access control. ` +
        `Configured databases: ${Object.keys(config.databases).join(', ') || '(none)'}`,
    );
  }

  return config;
}

function getConfiguredSchemas(config: AccessControlConfig, database: string): string[] {
  const dbConfig = config.databases[database.toUpperCase()];
  if (!dbConfig) {
    return [];
  }
  return dbConfig.schemas ? Object.keys(dbConfig.schemas) : [database];
}

function isTableAccessible(
  tableName: string,
  tableConfig: TableConfig,
): { accessible: boolean; reason?: string } {
  const listLower = tableConfig.list.map((table) => table.toLowerCase());
  const tableNameLower = tableName.toLowerCase();

  if (tableConfig.mode === 'whitelist' && !listLower.includes(tableNameLower)) {
    return {
      accessible: false,
      reason: `Table not in whitelist. Allowed tables: ${tableConfig.list.join(', ') || '(none)'}`,
    };
  }

  if (tableConfig.mode === 'blacklist' && listLower.includes(tableNameLower)) {
    return { accessible: false, reason: 'Table is in blacklist' };
  }

  return { accessible: true };
}

function findColumnPolicy(
  tableName: string,
  columnAccess: Record<string, ColumnAccessPolicy>,
): ColumnAccessPolicy | null {
  for (const [table, policy] of Object.entries(columnAccess)) {
    if (table.toLowerCase() === tableName.toLowerCase()) {
      return policy;
    }
  }
  return null;
}

function filterColumns(
  columns: AccessibleColumn[],
  tableName: string,
  columnAccess: Record<string, ColumnAccessPolicy>,
): {
  accessibleColumns: AccessibleColumn[];
  blockedColumns?: string[];
  allowedColumnsList?: string[];
  mode?: 'inclusion' | 'exclusion';
} {
  const policy = findColumnPolicy(tableName, columnAccess);
  if (!policy) {
    return { accessibleColumns: columns };
  }

  const policyColumns = policy.columns.map((column) => column.toLowerCase());
  if (policy.mode === 'inclusion') {
    return {
      accessibleColumns: columns.filter((column) => policyColumns.includes(column.name.toLowerCase())),
      allowedColumnsList: policy.columns,
      mode: 'inclusion',
    };
  }

  return {
    accessibleColumns: columns.filter((column) => !policyColumns.includes(column.name.toLowerCase())),
    blockedColumns: policy.columns,
    mode: 'exclusion',
  };
}

function annotateColumnsWithAccess(
  columns: AccessibleColumn[],
  tableName: string,
  columnAccess: Record<string, ColumnAccessPolicy>,
): {
  annotatedColumns: AccessibleColumnInfo[];
  mode?: 'inclusion' | 'exclusion';
} {
  const policy = findColumnPolicy(tableName, columnAccess);
  if (!policy) {
    return {
      annotatedColumns: columns.map((column) => ({ ...column, isAccessible: true })),
    };
  }

  const policyColumns = policy.columns.map((column) => column.toLowerCase());
  return {
    annotatedColumns: columns.map((column) => {
      const listed = policyColumns.includes(column.name.toLowerCase());
      const isAccessible = policy.mode === 'inclusion' ? listed : !listed;
      return {
        ...column,
        isAccessible,
        accessDeniedReason: isAccessible
          ? undefined
          : policy.mode === 'inclusion'
            ? `Column not in inclusion list. Allowed: ${policy.columns.join(', ')}`
            : `Column in exclusion list: ${policy.columns.join(', ')}`,
      };
    }),
    mode: policy.mode,
  };
}

export async function getAccessibleSchema(args: {
  database?: string;
  schema?: string;
}): Promise<AccessibleSchemaResult> {
  const database = resolveDatabase(args.database);
  const schema = resolveSchema(args.schema);
  const config = requireAccessConfig(database);
  const notes: string[] = [];

  const schemaConfig = getTableConfigForSchema(config, database, schema);
  if (!schemaConfig) {
    throw new Error(`Schema '${schema}' is not configured for query access in database '${database}'.`);
  }

  const { tableConfig, columnAccess } = schemaConfig;
  const tableNames = tableConfig.mode === 'whitelist'
    ? tableConfig.list
    : (await findTables({ database })).map((table) => table.tableName);
  const blacklist = tableConfig.mode === 'blacklist'
    ? new Set(tableConfig.list.map((table) => table.toLowerCase()))
    : new Set<string>();
  const accessibleTableNames = tableNames.filter((table) => !blacklist.has(table.toLowerCase()));

  if (tableConfig.mode === 'blacklist' && tableConfig.list.length > 0) {
    notes.push(`${tableConfig.list.length} table(s) blocked by blacklist: ${tableConfig.list.join(', ')}`);
  }

  const tables: AccessibleTable[] = [];
  for (const tableName of accessibleTableNames) {
    try {
      const tableInfo = await getTableInfo({ database, table: tableName });
      const { accessibleColumns, blockedColumns, allowedColumnsList, mode } = filterColumns(
        tableInfo.columns,
        tableInfo.name,
        columnAccess,
      );

      tables.push({
        schema,
        name: tableInfo.name,
        type: tableInfo.type,
        accessibleColumns,
        columnAccessMode: mode,
        blockedColumns,
        allowedColumnsList,
      });
    } catch (error) {
      logger.warn(`Could not get info for table ${tableName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    database,
    requireExplicitColumns: config.requireExplicitColumns,
    configuredSchemas: getConfiguredSchemas(config, database),
    tables,
    notes: notes.length ? notes : undefined,
  };
}

export async function getAccessibleTableInfo(args: {
  database?: string;
  table: string;
  schema?: string;
}): Promise<AccessibleTableInfo> {
  const database = resolveDatabase(args.database);
  const schema = resolveSchema(args.schema);
  const config = requireAccessConfig(database);

  let tableInfo;
  try {
    tableInfo = await getTableInfo({ database, table: args.table });
  } catch (error) {
    return {
      database,
      schema,
      table: args.table,
      type: 'TABLE',
      isAccessible: false,
      accessDeniedReason: error instanceof Error ? error.message : String(error),
    };
  }

  const schemaConfig = getTableConfigForSchema(config, database, schema);
  if (!schemaConfig) {
    return {
      database,
      schema,
      table: tableInfo.name,
      type: tableInfo.type,
      isAccessible: false,
      accessDeniedReason: `Schema '${schema}' is not configured for query access in database '${database}'`,
    };
  }

  const tableAccess = isTableAccessible(tableInfo.name, schemaConfig.tableConfig);
  if (!tableAccess.accessible) {
    return {
      database,
      schema,
      table: tableInfo.name,
      type: tableInfo.type,
      isAccessible: false,
      accessDeniedReason: tableAccess.reason,
    };
  }

  const { annotatedColumns, mode } = annotateColumnsWithAccess(
    tableInfo.columns,
    tableInfo.name,
    schemaConfig.columnAccess,
  );

  return {
    database,
    schema,
    table: tableInfo.name,
    type: tableInfo.type,
    isAccessible: true,
    columnAccessMode: mode,
    columns: annotatedColumns,
    indexes: tableInfo.indexes,
    foreignKeys: tableInfo.foreignKeys,
    accessibleColumnCount: annotatedColumns.filter((column) => column.isAccessible).length,
    totalColumnCount: annotatedColumns.length,
  };
}
