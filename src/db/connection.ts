import sql from 'mssql';
import { config as dotenvConfig } from 'dotenv';
import { logger } from '../utils/logger.js';

dotenvConfig();

interface DBConfig {
  server: string;
  user?: string;
  password?: string;
  domain?: string;
  options: {
    encrypt: boolean;
    trustServerCertificate: boolean;
    enableArithAbort: boolean;
  };
  pool: {
    min: number;
    max: number;
    idleTimeoutMillis: number;
  };
}

class DatabaseConnection {
  private static instance: DatabaseConnection;
  private pool: sql.ConnectionPool | null = null;
  private config: DBConfig;

  private constructor() {
    const trustedConnection = process.env.DB_TRUSTED_CONNECTION === 'true';

    this.config = {
      server: process.env.DB_SERVER || 'localhost',
      options: {
        encrypt: true,
        trustServerCertificate: true,
        enableArithAbort: true,
      },
      pool: {
        min: 2,
        max: 10,
        idleTimeoutMillis: 30000,
      },
    };

    if (trustedConnection && process.env.DB_DOMAIN) {
      // Windows authentication
      (this.config as any).domain = process.env.DB_DOMAIN;
      (this.config as any).authentication = {
        type: 'ntlm',
        options: {
          domain: process.env.DB_DOMAIN,
        },
      };
    } else if (process.env.DB_USER && process.env.DB_PASSWORD) {
      // SQL Server authentication
      this.config.user = process.env.DB_USER;
      this.config.password = process.env.DB_PASSWORD;
    } else {
      throw new Error('Database authentication not configured properly');
    }
  }

  public static getInstance(): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection();
    }
    return DatabaseConnection.instance;
  }

  public async connect(): Promise<sql.ConnectionPool> {
    if (this.pool && this.pool.connected) {
      return this.pool;
    }

    try {
      logger.info('Connecting to SQL Server...');
      this.pool = await sql.connect(this.config as sql.config);
      logger.info('Connected to SQL Server successfully');

      // Set up error handlers
      this.pool.on('error', (err) => {
        logger.error('Database pool error:', err);
      });

      return this.pool;
    } catch (error) {
      logger.error('Failed to connect to SQL Server:', error);
      throw error;
    }
  }

  public async query<T = any>(queryString: string, params?: Record<string, any>): Promise<sql.IResult<T>> {
    const pool = await this.connect();
    const request = pool.request();

    // Add parameters if provided
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        request.input(key, value);
      });
    }

    try {
      logger.debug(`Executing query: ${queryString}`);
      const result = await request.query<T>(queryString);
      logger.debug(`Query returned ${result.recordset.length} rows`);
      return result;
    } catch (error) {
      logger.error('Query execution failed:', error);
      throw error;
    }
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
      logger.info('Database connection closed');
    }
  }

  public isConnected(): boolean {
    return this.pool !== null && this.pool.connected;
  }
}

export const db = DatabaseConnection.getInstance();
export default db;