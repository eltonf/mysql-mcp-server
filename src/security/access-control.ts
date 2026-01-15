/**
 * Access Control Validation for execute_query
 *
 * Validates SQL queries against access control configuration:
 * - Database access (must be configured)
 * - Table whitelist/blacklist
 * - Column access (inclusion/exclusion modes)
 * - SELECT * blocking
 */

import {
  AccessControlConfig,
  AccessViolation,
  AccessControlError,
  QualifiedTableRef,
  QualifiedColumnRef,
} from './types.js';
import { getTableConfigForSchema } from './config-loader.js';
import { parseQuery } from '../utils/sql-parser.js';
import { logger } from '../utils/logger.js';

/**
 * Validate a query against access control configuration
 * @throws AccessControlError if validation fails
 */
export function validateQueryAccess(
  query: string,
  database: string,
  config: AccessControlConfig
): void {
  const violations: AccessViolation[] = [];

  // Step 1: Check if database is configured
  const dbViolation = validateDatabaseAccess(database, config);
  if (dbViolation) {
    throw new AccessControlError([dbViolation]);
  }

  // Step 2: Parse the query
  const parsed = parseQuery(query, database);
  logger.debug(`Parsed query info: tables=${parsed.tables.length}, columns=${parsed.columns.length}, hasSelectStar=${parsed.hasSelectStar}`);

  // Step 3: Validate SELECT * usage
  if (config.requireExplicitColumns && parsed.hasSelectStar) {
    violations.push(...validateSelectStar(parsed.selectStarTables));
  }

  // Step 4: Validate table access
  for (const table of parsed.tables) {
    const tableViolation = validateTableAccess(table, config);
    if (tableViolation) {
      violations.push(tableViolation);
    }
  }

  // Step 5: Validate column access (only if no SELECT *)
  // If SELECT * is used, we can't know which columns will be returned
  // so we already blocked it above
  if (!parsed.hasSelectStar) {
    for (const column of parsed.columns) {
      const columnViolation = validateColumnAccess(column, config);
      if (columnViolation) {
        violations.push(columnViolation);
      }
    }
  }

  // Throw if any violations found
  if (violations.length > 0) {
    logger.warn(`Access control violations: ${violations.map(v => v.message).join('; ')}`);
    throw new AccessControlError(violations);
  }

  logger.debug('Query passed access control validation');
}

/**
 * Validate database is configured
 */
function validateDatabaseAccess(
  database: string,
  config: AccessControlConfig
): AccessViolation | null {
  const dbUpper = database.toUpperCase();
  if (!config.databases[dbUpper]) {
    return {
      type: 'database_not_configured',
      database,
      message:
        `Database '${database}' is not configured for query access. ` +
        `Add it to QUERY_ACCESS_CONFIG to enable queries.`,
    };
  }
  return null;
}

/**
 * Validate SELECT * usage
 */
function validateSelectStar(selectStarTables: string[]): AccessViolation[] {
  const violations: AccessViolation[] = [];

  for (const tableRef of selectStarTables) {
    if (tableRef === '*') {
      violations.push({
        type: 'select_star',
        message:
          'SELECT * is not allowed. All SELECT statements must explicitly list columns. ' +
          'Example: SELECT Name, TeamID FROM Player',
      });
    } else {
      violations.push({
        type: 'select_star',
        table: tableRef,
        message:
          `SELECT ${tableRef}.* is not allowed. ` +
          `Please specify columns explicitly instead of using table.* syntax.`,
      });
    }
  }

  return violations;
}

/**
 * Validate table access against whitelist/blacklist
 */
function validateTableAccess(
  table: QualifiedTableRef,
  config: AccessControlConfig
): AccessViolation | null {
  // Skip subquery pseudo-tables
  if (table.schema === '__subquery__') {
    return null;
  }

  const schemaConfig = getTableConfigForSchema(config, table.database, table.schema);

  if (!schemaConfig) {
    return {
      type: 'schema_not_configured',
      database: table.database,
      schema: table.schema,
      table: table.table,
      message:
        `Schema '${table.schema}' in database '${table.database}' is not configured for query access. ` +
        `Add schema rules to QUERY_ACCESS_CONFIG.`,
    };
  }

  const { tableConfig } = schemaConfig;
  const tableNameLower = table.table.toLowerCase();

  // Check whitelist/blacklist
  const listLower = tableConfig.list.map(t => t.toLowerCase());

  switch (tableConfig.mode) {
    case 'whitelist':
      if (!listLower.includes(tableNameLower)) {
        return {
          type: 'table_not_allowed',
          database: table.database,
          schema: table.schema,
          table: table.table,
          message:
            `Table '${table.database}.${table.schema}.${table.table}' is not in the allowed tables list. ` +
            `Allowed tables for ${table.database}.${table.schema}: ${tableConfig.list.join(', ') || '(none)'}`,
        };
      }
      break;

    case 'blacklist':
      if (listLower.includes(tableNameLower)) {
        return {
          type: 'table_not_allowed',
          database: table.database,
          schema: table.schema,
          table: table.table,
          message:
            `Table '${table.database}.${table.schema}.${table.table}' cannot be queried. ` +
            `This table is in the exclusion list for database '${table.database}', schema '${table.schema}'.`,
        };
      }
      break;

    case 'none':
      // No table-level restrictions
      break;
  }

  return null;
}

/**
 * Validate column access against inclusion/exclusion rules
 */
function validateColumnAccess(
  column: QualifiedColumnRef,
  config: AccessControlConfig
): AccessViolation | null {
  // Skip unknown table columns (can't validate)
  if (column.table === '__unknown__') {
    return null;
  }

  const schemaConfig = getTableConfigForSchema(config, column.database, column.schema);
  if (!schemaConfig) {
    // Schema not configured - already caught in table validation
    return null;
  }

  const { columnAccess } = schemaConfig;
  const tableNameLower = column.table.toLowerCase();
  const columnNameLower = column.column.toLowerCase();

  // Find policy for this table (case-insensitive)
  let policy = null;
  let policyTableName = '';
  for (const [table, tablePolicy] of Object.entries(columnAccess)) {
    if (table.toLowerCase() === tableNameLower) {
      policy = tablePolicy;
      policyTableName = table;
      break;
    }
  }

  // No policy = allow all columns
  if (!policy) {
    return null;
  }

  const columnsLower = policy.columns.map(c => c.toLowerCase());

  if (policy.mode === 'inclusion') {
    // Whitelist: column must be in the list
    if (!columnsLower.includes(columnNameLower)) {
      return {
        type: 'column_not_allowed',
        database: column.database,
        schema: column.schema,
        table: column.table,
        column: column.column,
        message:
          `Column '${column.column}' from '${column.database}.${column.schema}.${column.table}' cannot be selected. ` +
          `Allowed columns for ${policyTableName}: ${policy.columns.join(', ')}`,
      };
    }
  } else {
    // Blacklist: column must NOT be in the list
    if (columnsLower.includes(columnNameLower)) {
      return {
        type: 'column_excluded',
        database: column.database,
        schema: column.schema,
        table: column.table,
        column: column.column,
        message:
          `Column '${column.column}' from '${column.database}.${column.schema}.${column.table}' cannot be selected. ` +
          `Excluded columns: ${policy.columns.join(', ')}`,
      };
    }
  }

  return null;
}

// Singleton config holder
let globalConfig: AccessControlConfig | null = null;

/**
 * Initialize the global access control config
 * Called once at startup from index.ts
 */
export function initAccessControl(config: AccessControlConfig): void {
  globalConfig = config;
  logger.info('Access control initialized');
}

/**
 * Get the global access control config
 * @throws Error if not initialized
 */
export function getAccessControlConfig(): AccessControlConfig {
  if (!globalConfig) {
    throw new Error(
      'Access control not initialized. Ensure QUERY_ACCESS_CONFIG is set and valid.'
    );
  }
  return globalConfig;
}

/**
 * Check if access control is initialized
 */
export function isAccessControlInitialized(): boolean {
  return globalConfig !== null;
}

// Re-export types for convenience
export { AccessControlConfig, AccessControlError } from './types.js';
export { loadAccessControlConfig, getTableConfigForSchema } from './config-loader.js';
