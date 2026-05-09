import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { appConfig } from '../core/config.js';
import { logger } from '../core/logger.js';

class MySqlConnection {
  private static instance: MySqlConnection;
  private pool: Pool | null = null;

  private constructor() {}

  static getInstance(): MySqlConnection {
    if (!MySqlConnection.instance) {
      MySqlConnection.instance = new MySqlConnection();
    }
    return MySqlConnection.instance;
  }

  private createPool(): Pool {
    logger.info(`Creating MySQL pool for ${appConfig.db.host}:${appConfig.db.port}/${appConfig.db.name}`);
    return mysql.createPool({
      host: appConfig.db.host,
      port: appConfig.db.port,
      database: appConfig.db.name,
      user: appConfig.db.user,
      password: appConfig.db.password,
      ssl: appConfig.db.ssl ? { rejectUnauthorized: true } : undefined,
      namedPlaceholders: true,
      waitForConnections: true,
      connectionLimit: 10,
      maxIdle: 10,
      idleTimeout: 30000,
      queueLimit: 0,
    });
  }

  async connect(): Promise<Pool> {
    if (!this.pool) {
      this.pool = this.createPool();
      await this.pool.query('SELECT 1');
      logger.info('Connected to MySQL successfully');
    }
    return this.pool;
  }

  async query<T extends RowDataPacket = RowDataPacket>(
    sql: string,
    params?: Record<string, unknown>,
  ): Promise<T[]> {
    const pool = await this.connect();
    logger.debug(`Executing query: ${sql}`);
    const [rows] = await pool.query<T[]>(sql, (params || {}) as any);
    return rows;
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.info('MySQL connection pool closed');
    }
  }

  isConnected(): boolean {
    return this.pool !== null;
  }
}

export const db = MySqlConnection.getInstance();
