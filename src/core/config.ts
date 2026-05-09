import { config as dotenvConfig } from 'dotenv';
import { parseDatabaseUrl } from './database-url.js';

dotenvConfig();

export interface AppConfig {
  db: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    ssl: boolean;
  };
  server: {
    name: string;
    version: string;
    schemaOnlyMode: boolean;
  };
  query: {
    maxRows: number;
    timeoutMs: number;
  };
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function intEnv(env: NodeJS.ProcessEnv, name: string, defaultValue: number): number {
  const value = env[name];
  if (!value) {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function buildAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const urlConfig = env.DATABASE_URL ? parseDatabaseUrl(env.DATABASE_URL) : null;

  return {
    db: {
      host: env.DB_HOST || urlConfig?.host || 'localhost',
      port: intEnv(env, 'DB_PORT', urlConfig?.port || 3306),
      name: env.DB_NAME || urlConfig?.name || requiredEnv(env, 'DB_NAME'),
      user: env.DB_USER || urlConfig?.user || requiredEnv(env, 'DB_USER'),
      password: env.DB_PASSWORD || urlConfig?.password || requiredEnv(env, 'DB_PASSWORD'),
      ssl: env.DB_SSL ? env.DB_SSL === 'true' : Boolean(urlConfig?.ssl),
    },
    server: {
      name: env.MCP_SERVER_NAME || 'mysql-mcp-server',
      version: env.MCP_SERVER_VERSION || '1.0.0',
      schemaOnlyMode: env.SCHEMA_ONLY_MODE !== 'false',
    },
    query: {
      maxRows: intEnv(env, 'MAX_QUERY_ROWS', 100),
      timeoutMs: intEnv(env, 'QUERY_TIMEOUT_MS', 30000),
    },
  };
}

export const appConfig: AppConfig = buildAppConfig();

export function resolveDatabase(input?: string): string {
  if (input && /^\s*(SELECT|WITH)\b/i.test(input)) {
    throw new Error(
      'The SQL statement was passed as the database argument. ' +
        'Leave database blank and put the SQL in the execute_query query field.',
    );
  }

  if (input && input !== appConfig.db.name) {
    throw new Error(
      `This server is configured for database '${appConfig.db.name}'. ` +
        `Received '${input}'. Start a separate MCP server instance for another database.`,
    );
  }
  return appConfig.db.name;
}

export function resolveSchema(input?: string): string {
  if (input && input !== appConfig.db.name) {
    throw new Error(
      `MySQL uses the configured database as the schema for this server. ` +
        `Received schema '${input}', expected '${appConfig.db.name}'.`,
    );
  }
  return appConfig.db.name;
}
