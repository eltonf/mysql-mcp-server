import { appConfig, resolveDatabase } from '../core/config.js';
import { logger } from '../core/logger.js';
import {
  QueryModificationResult,
  enforceRowLimit,
  validateQuerySafety,
} from '../core/query-safety.js';
import {
  getAccessControlConfig,
  isAccessControlInitialized,
  validateQueryAccess,
} from '../core/security/access-control.js';
import { db } from '../mysql/connection.js';

export interface DataQueryResult {
  originalQuery: string;
  executedQuery: string;
  wasModified: boolean;
  modifications: string[];
  rows: unknown[];
  rowCount: number;
  executionTimeMs: number;
  limitReached: boolean;
  columnNames?: string[];
}

export async function executeQuery(args: {
  database?: string;
  query: string;
  parameters?: Record<string, unknown>;
}): Promise<DataQueryResult> {
  const database = resolveDatabase(args.database);
  const startTime = Date.now();

  logger.info(`Executing read query on database: ${database}`);

  validateQuerySafety(args.query);

  if (!isAccessControlInitialized()) {
    throw new Error(
      'Access control not configured. Data queries are blocked until QUERY_ACCESS_CONFIG is set.',
    );
  }

  validateQueryAccess(args.query, database, getAccessControlConfig());

  const modResult: QueryModificationResult = enforceRowLimit(
    args.query,
    appConfig.query.maxRows,
  );

  const rows = await db.query<any>(modResult.modifiedQuery, args.parameters);
  const executionTimeMs = Date.now() - startTime;

  return {
    originalQuery: args.query,
    executedQuery: modResult.modifiedQuery,
    wasModified: modResult.wasModified,
    modifications: modResult.modifications,
    rows,
    rowCount: rows.length,
    executionTimeMs,
    limitReached: rows.length === modResult.appliedLimitValue,
    columnNames: rows.length ? Object.keys(rows[0]) : [],
  };
}
