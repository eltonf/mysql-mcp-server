import { db } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import {
  validateQuerySafety,
  enforceRowLimit,
  buildDataQuerySQL,
  QueryModificationResult,
} from '../db/queries.js';

// Get max rows from environment or default to 50
const MAX_QUERY_ROWS = parseInt(process.env.MAX_QUERY_ROWS || '50', 10);
// Note: QUERY_TIMEOUT_MS is available for future use with mssql request.timeout()
// const QUERY_TIMEOUT_MS = parseInt(process.env.QUERY_TIMEOUT_MS || '30000', 10);

/**
 * Result from data query execution
 */
export interface DataQueryResult {
  originalQuery: string;
  executedQuery: string;
  wasModified: boolean;
  modifications: string[];
  rows: any[];
  rowCount: number;
  executionTimeMs: number;
  limitReached: boolean;
  columnNames?: string[];
}

/**
 * Execute a SELECT query with safety controls
 * - Validates query is SELECT-only
 * - Enforces row limit (TOP clause)
 * - Returns detailed modification info
 */
export async function executeQuery(args: {
  database: string;
  query: string;
  parameters?: Record<string, any>;
}): Promise<DataQueryResult> {
  const { database, query, parameters } = args;
  const startTime = Date.now();

  logger.info(`Executing query on database: ${database}`);
  logger.debug(`Original query: ${query}`);

  try {
    // Step 1: Validate query safety (SELECT-only)
    validateQuerySafety(query);
    logger.debug('Query passed safety validation');

    // Step 2: Enforce row limit
    const modResult: QueryModificationResult = enforceRowLimit(query, MAX_QUERY_ROWS);
    logger.debug(`Query modification result: ${JSON.stringify({
      wasModified: modResult.wasModified,
      modifications: modResult.modifications,
    })}`);

    // Step 3: Wrap with database context
    const finalQuery = buildDataQuerySQL(database, modResult.modifiedQuery);
    logger.debug(`Final query with USE statement: ${finalQuery}`);

    // Step 4: Execute query with timeout
    const result = await db.query(finalQuery, parameters);
    const endTime = Date.now();
    const executionTimeMs = endTime - startTime;

    // Step 5: Extract results
    const rows = result.recordset || [];
    const rowCount = rows.length;

    // Determine if we hit the limit (means there might be more data)
    const limitReached = rowCount === modResult.appliedTopValue;

    // Extract column names from first row if available
    const columnNames = rows.length > 0 ? Object.keys(rows[0]) : [];

    logger.info(`Query executed successfully: ${rowCount} rows returned in ${executionTimeMs}ms`);

    return {
      originalQuery: query,
      executedQuery: modResult.modifiedQuery,
      wasModified: modResult.wasModified,
      modifications: modResult.modifications,
      rows,
      rowCount,
      executionTimeMs,
      limitReached,
      columnNames,
    };
  } catch (error: any) {
    const executionTimeMs = Date.now() - startTime;
    logger.error(`Query execution failed after ${executionTimeMs}ms:`, error);

    // Re-throw with more context
    const errorMessage = error.message || String(error);
    throw new Error(`Query execution failed: ${errorMessage}`);
  }
}
