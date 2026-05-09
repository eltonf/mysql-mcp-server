import { config as dotenvConfig } from 'dotenv';

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

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function intEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export const appConfig: AppConfig = {
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: intEnv('DB_PORT', 3306),
    name: requiredEnv('DB_NAME'),
    user: requiredEnv('DB_USER'),
    password: requiredEnv('DB_PASSWORD'),
    ssl: process.env.DB_SSL === 'true',
  },
  server: {
    name: process.env.MCP_SERVER_NAME || 'mysql-mcp-server',
    version: process.env.MCP_SERVER_VERSION || '1.0.0',
    schemaOnlyMode: process.env.SCHEMA_ONLY_MODE === 'true',
  },
  query: {
    maxRows: intEnv('MAX_QUERY_ROWS', 100),
    timeoutMs: intEnv('QUERY_TIMEOUT_MS', 30000),
  },
};

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
