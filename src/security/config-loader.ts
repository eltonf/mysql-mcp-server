/**
 * Access Control Configuration Loader
 *
 * Loads configuration from JSON file specified by QUERY_ACCESS_CONFIG env var.
 * Validates configuration structure and provides helpful error messages.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  AccessControlConfig,
  DatabaseConfig,
  TableConfig,
  SchemaConfig,
  ColumnAccessPolicy,
} from './types.js';
import { logger } from '../utils/logger.js';

// Environment variable for config file path
const CONFIG_ENV_VAR = 'QUERY_ACCESS_CONFIG';

/**
 * Load and validate access control configuration
 * @throws Error if config is invalid or missing (restrictive default)
 */
export function loadAccessControlConfig(): AccessControlConfig {
  const configPath = process.env[CONFIG_ENV_VAR];

  if (!configPath) {
    throw new Error(
      `Access control configuration not found. ` +
        `Set ${CONFIG_ENV_VAR} environment variable to the path of your config file. ` +
        `Example: ${CONFIG_ENV_VAR}=/path/to/query-access.json`
    );
  }

  // Resolve path (handle relative paths)
  const resolvedPath = path.resolve(configPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Access control config file not found at: ${resolvedPath}. ` +
        `Create the config file or update ${CONFIG_ENV_VAR} to point to the correct location.`
    );
  }

  logger.info(`Loading access control config from: ${resolvedPath}`);

  let rawConfig: any;
  try {
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    rawConfig = JSON.parse(content);
  } catch (error: any) {
    throw new Error(`Failed to parse access control config: ${error.message}`);
  }

  // Validate and normalize the configuration
  const config = validateConfig(rawConfig);

  logger.info(
    `Access control config loaded: ${Object.keys(config.databases).length} database(s) configured`
  );

  return config;
}

/**
 * Validate configuration structure
 */
function validateConfig(raw: any): AccessControlConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Access control config must be a JSON object');
  }

  // Validate requireExplicitColumns
  if (typeof raw.requireExplicitColumns !== 'boolean') {
    throw new Error("Access control config must have 'requireExplicitColumns' (boolean)");
  }

  // Validate databases
  if (typeof raw.databases !== 'object' || raw.databases === null) {
    throw new Error("Access control config must have 'databases' object");
  }

  const databases: Record<string, DatabaseConfig> = {};

  for (const [dbName, dbConfig] of Object.entries(raw.databases)) {
    databases[dbName.toUpperCase()] = validateDatabaseConfig(dbName, dbConfig);
  }

  return {
    requireExplicitColumns: raw.requireExplicitColumns,
    databases,
  };
}

/**
 * Validate database configuration
 */
function validateDatabaseConfig(dbName: string, raw: any): DatabaseConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Database config for '${dbName}' must be an object`);
  }

  // Error on deprecated columnExclusions format
  if (raw.columnExclusions) {
    throw new Error(
      `Database '${dbName}' uses deprecated 'columnExclusions' format. ` +
        `Please migrate to 'columnAccess' with { mode: 'exclusion' | 'inclusion', columns: [...] } per table. ` +
        `See documentation for the new format.`
    );
  }

  const result: DatabaseConfig = {};

  // Check for schema-level config (full format)
  if (raw.schemas) {
    if (typeof raw.schemas !== 'object') {
      throw new Error(`'schemas' in database '${dbName}' must be an object`);
    }

    result.schemas = {};
    for (const [schemaName, schemaConfig] of Object.entries(raw.schemas)) {
      result.schemas[schemaName.toLowerCase()] = validateSchemaConfig(
        dbName,
        schemaName,
        schemaConfig
      );
    }
  }

  // Check for compact format (tables at database level)
  if (raw.tables) {
    result.tables = validateTableConfig(dbName, '_default_', raw.tables);
  }

  // Must have either schemas or tables
  if (!result.schemas && !result.tables) {
    throw new Error(
      `Database '${dbName}' must have either 'schemas' or 'tables' configuration`
    );
  }

  return result;
}

/**
 * Validate schema configuration
 */
function validateSchemaConfig(dbName: string, schemaName: string, raw: any): SchemaConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Schema config for '${dbName}.${schemaName}' must be an object`);
  }

  if (!raw.tables) {
    throw new Error(`Schema '${dbName}.${schemaName}' must have 'tables' configuration`);
  }

  return {
    tables: validateTableConfig(dbName, schemaName, raw.tables),
  };
}

/**
 * Validate table configuration
 */
function validateTableConfig(dbName: string, schemaName: string, raw: any): TableConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Table config for '${dbName}.${schemaName}' must be an object`);
  }

  // Error on deprecated columnExclusions format
  if (raw.columnExclusions) {
    throw new Error(
      `Table config for '${dbName}.${schemaName}' uses deprecated 'columnExclusions' format. ` +
        `Please migrate to 'columnAccess' with { mode: 'exclusion' | 'inclusion', columns: [...] } per table. ` +
        `See documentation for the new format.`
    );
  }

  // Validate mode
  const validModes = ['whitelist', 'blacklist', 'none'];
  if (!validModes.includes(raw.mode)) {
    throw new Error(
      `Table mode for '${dbName}.${schemaName}' must be one of: ${validModes.join(', ')}`
    );
  }

  // Validate list
  if (!Array.isArray(raw.list)) {
    throw new Error(`Table list for '${dbName}.${schemaName}' must be an array`);
  }

  const list = raw.list.map((t: any) => {
    if (typeof t !== 'string') {
      throw new Error(`Table list for '${dbName}.${schemaName}' must contain only strings`);
    }
    return t; // Keep original case for display, but compare case-insensitively
  });

  const result: TableConfig = {
    mode: raw.mode as 'whitelist' | 'blacklist' | 'none',
    list,
  };

  // Optional column access policies
  if (raw.columnAccess) {
    result.columnAccess = validateColumnAccess(`${dbName}.${schemaName}`, raw.columnAccess);
  }

  return result;
}

/**
 * Validate column access policies
 */
function validateColumnAccess(
  context: string,
  raw: any
): Record<string, ColumnAccessPolicy> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Column access for '${context}' must be an object`);
  }

  const result: Record<string, ColumnAccessPolicy> = {};

  for (const [tableName, policy] of Object.entries(raw)) {
    if (typeof policy !== 'object' || policy === null) {
      throw new Error(
        `Column access for '${context}.${tableName}' must be an object with 'mode' and 'columns'`
      );
    }

    const p = policy as any;

    // Validate mode
    const validModes = ['inclusion', 'exclusion'];
    if (!validModes.includes(p.mode)) {
      throw new Error(
        `Column access mode for '${context}.${tableName}' must be 'inclusion' or 'exclusion'`
      );
    }

    // Validate columns
    if (!Array.isArray(p.columns)) {
      throw new Error(`Column access for '${context}.${tableName}' must have 'columns' array`);
    }

    const columns = p.columns.map((c: any) => {
      if (typeof c !== 'string') {
        throw new Error(
          `Column access for '${context}.${tableName}' columns must contain only strings`
        );
      }
      return c;
    });

    result[tableName] = {
      mode: p.mode as 'inclusion' | 'exclusion',
      columns,
    };
  }

  return result;
}

/**
 * Get the effective table config for a database/schema combination
 */
export function getTableConfigForSchema(
  config: AccessControlConfig,
  database: string,
  schema: string
): { tableConfig: TableConfig; columnAccess: Record<string, ColumnAccessPolicy> } | null {
  const dbConfig = config.databases[database.toUpperCase()];
  if (!dbConfig) {
    return null;
  }

  const schemaLower = schema.toLowerCase();

  // Check schema-level config first
  if (dbConfig.schemas) {
    // Try exact match
    if (dbConfig.schemas[schemaLower]) {
      const schemaConfig = dbConfig.schemas[schemaLower];
      return {
        tableConfig: schemaConfig.tables,
        columnAccess: schemaConfig.tables.columnAccess || {},
      };
    }

    // Try wildcard
    if (dbConfig.schemas['*']) {
      const schemaConfig = dbConfig.schemas['*'];
      return {
        tableConfig: schemaConfig.tables,
        columnAccess: schemaConfig.tables.columnAccess || {},
      };
    }

    // No matching schema config
    return null;
  }

  // Use compact format (database-level tables config)
  if (dbConfig.tables) {
    return {
      tableConfig: dbConfig.tables,
      columnAccess: dbConfig.tables.columnAccess || {},
    };
  }

  return null;
}
