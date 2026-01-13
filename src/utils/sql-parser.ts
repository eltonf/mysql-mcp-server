/**
 * SQL Parser Utility for Access Control
 *
 * Uses node-sql-parser to parse SQL and extract:
 * - Tables (including JOINs, subqueries, CTEs)
 * - Columns being selected
 * - SELECT * detection
 * - Alias resolution
 */

import pkg from 'node-sql-parser';
const { Parser } = pkg;
import { ParsedQueryInfo, QualifiedTableRef, QualifiedColumnRef } from '../security/types.js';
import { logger } from './logger.js';

// Initialize parser with T-SQL (SQL Server) dialect
const parser = new Parser();
const PARSER_OPTIONS = { database: 'TransactSQL' };

/**
 * Parse a SQL query and extract tables, columns, and SELECT * usage
 */
export function parseQuery(sql: string, database: string): ParsedQueryInfo {
  const result: ParsedQueryInfo = {
    tables: [],
    columns: [],
    hasSelectStar: false,
    selectStarTables: [],
    aliases: new Map(),
  };

  try {
    const ast = parser.astify(sql, PARSER_OPTIONS);
    logger.debug(`Parsed SQL AST: ${JSON.stringify(ast, null, 2)}`);

    // Handle both single statement and array of statements
    const statements = Array.isArray(ast) ? ast : [ast];

    for (const stmt of statements) {
      if (stmt && stmt.type === 'select') {
        processSelectStatement(stmt, database, 'dbo', result);
      }
    }
  } catch (error: any) {
    logger.warn(`SQL parsing failed, falling back to regex: ${error.message}`);
    // Fallback to regex-based parsing for queries the parser can't handle
    return parseQueryWithRegex(sql, database);
  }

  return result;
}

/**
 * Process a SELECT statement and extract table/column info
 */
function processSelectStatement(
  stmt: any,
  database: string,
  defaultSchema: string,
  result: ParsedQueryInfo
): void {
  // Process CTEs (WITH clause)
  if (stmt.with) {
    for (const cte of stmt.with) {
      if (cte.stmt) {
        processSelectStatement(cte.stmt, database, defaultSchema, result);
      }
    }
  }

  // Process FROM clause (tables)
  if (stmt.from) {
    processFromClause(stmt.from, database, defaultSchema, result);
  }

  // Process SELECT columns
  if (stmt.columns) {
    processColumns(stmt.columns, database, defaultSchema, result);
  }

  // Process subqueries in WHERE, HAVING, etc.
  if (stmt.where) {
    processExpression(stmt.where, database, defaultSchema, result);
  }
}

/**
 * Process FROM clause to extract tables
 */
function processFromClause(
  from: any[],
  database: string,
  defaultSchema: string,
  result: ParsedQueryInfo
): void {
  for (const item of from) {
    if (!item) continue;

    // Handle regular table reference
    if (item.table) {
      const tableRef = extractTableRef(item, database, defaultSchema);
      result.tables.push(tableRef);

      // Track alias
      if (item.as) {
        result.aliases.set(item.as.toLowerCase(), tableRef);
      }
    }

    // Handle subquery in FROM
    if (item.expr && item.expr.ast) {
      processSelectStatement(item.expr.ast, database, defaultSchema, result);
      // Track subquery alias
      if (item.as) {
        // Subquery alias doesn't map to a real table
        result.aliases.set(item.as.toLowerCase(), {
          database,
          schema: '__subquery__',
          table: item.as,
          alias: item.as,
        });
      }
    }

    // Handle JOINs
    if (item.join) {
      // The join target is in item itself after the join keyword
      // Recursively process the joined table
    }
  }
}

/**
 * Extract table reference from AST node
 */
function extractTableRef(item: any, database: string, defaultSchema: string): QualifiedTableRef {
  // node-sql-parser may provide schema as 'db' property
  const schema = item.db || defaultSchema;
  const table = item.table;
  const alias = item.as || undefined;

  return {
    database,
    schema: schema.toLowerCase(),
    table: table,
    alias: alias?.toLowerCase(),
  };
}

/**
 * Process SELECT columns
 */
function processColumns(
  columns: any,
  database: string,
  defaultSchema: string,
  result: ParsedQueryInfo
): void {
  // Handle SELECT *
  if (columns === '*') {
    result.hasSelectStar = true;
    result.selectStarTables.push('*');
    return;
  }

  if (!Array.isArray(columns)) {
    return;
  }

  for (const col of columns) {
    if (!col) continue;

    // Handle column expressions
    if (col.expr) {
      processColumnExpression(col.expr, database, defaultSchema, result);
    }
  }
}

/**
 * Process a column expression to extract column references
 */
function processColumnExpression(
  expr: any,
  database: string,
  defaultSchema: string,
  result: ParsedQueryInfo
): void {
  if (!expr) return;

  // Handle star expression (SELECT * or table.*)
  if (expr.type === 'star') {
    result.hasSelectStar = true;
    if (expr.table) {
      result.selectStarTables.push(expr.table);
    } else {
      result.selectStarTables.push('*');
    }
    return;
  }

  // Handle column reference
  if (expr.type === 'column_ref') {
    const colRef = extractColumnRef(expr, database, defaultSchema, result);
    if (colRef) {
      result.columns.push(colRef);
    }
    return;
  }

  // Handle function calls - extract column references from arguments
  if (expr.type === 'function' || expr.type === 'aggr_func') {
    if (expr.args) {
      if (expr.args.type === 'expr_list') {
        for (const arg of expr.args.value || []) {
          processColumnExpression(arg, database, defaultSchema, result);
        }
      } else if (expr.args.expr) {
        processColumnExpression(expr.args.expr, database, defaultSchema, result);
      }
    }
    return;
  }

  // Handle binary expressions (e.g., col1 + col2)
  if (expr.type === 'binary_expr') {
    processColumnExpression(expr.left, database, defaultSchema, result);
    processColumnExpression(expr.right, database, defaultSchema, result);
    return;
  }

  // Handle CASE expressions
  if (expr.type === 'case') {
    if (expr.args) {
      for (const arg of expr.args) {
        if (arg.cond) processColumnExpression(arg.cond, database, defaultSchema, result);
        if (arg.result) processColumnExpression(arg.result, database, defaultSchema, result);
      }
    }
    return;
  }

  // Handle subqueries in SELECT
  if (expr.type === 'select' || expr.ast) {
    const subStmt = expr.ast || expr;
    processSelectStatement(subStmt, database, defaultSchema, result);
  }
}

/**
 * Extract column reference from AST node
 */
function extractColumnRef(
  expr: any,
  database: string,
  defaultSchema: string,
  result: ParsedQueryInfo
): QualifiedColumnRef | null {
  const column = expr.column;
  const tableOrAlias = expr.table;

  if (!column) return null;

  // If table/alias is specified, resolve it
  if (tableOrAlias) {
    const aliasLower = tableOrAlias.toLowerCase();
    const resolved = result.aliases.get(aliasLower);

    if (resolved) {
      // Skip subquery columns - we can't validate them against config
      if (resolved.schema === '__subquery__') {
        return null;
      }
      return {
        database: resolved.database,
        schema: resolved.schema,
        table: resolved.table,
        column: column,
      };
    }

    // Table name used directly (not alias)
    const tableRef = result.tables.find(
      t => t.table.toLowerCase() === aliasLower || t.alias?.toLowerCase() === aliasLower
    );

    if (tableRef) {
      return {
        database: tableRef.database,
        schema: tableRef.schema,
        table: tableRef.table,
        column: column,
      };
    }

    // Unknown table reference - use as-is
    return {
      database,
      schema: defaultSchema,
      table: tableOrAlias,
      column: column,
    };
  }

  // No table specified - try to infer from single table query
  if (result.tables.length === 1) {
    const tableRef = result.tables[0];
    return {
      database: tableRef.database,
      schema: tableRef.schema,
      table: tableRef.table,
      column: column,
    };
  }

  // Ambiguous - column without table in multi-table query
  // Return with unknown table marker
  return {
    database,
    schema: defaultSchema,
    table: '__unknown__',
    column: column,
  };
}

/**
 * Process expressions (WHERE, HAVING, etc.) for subqueries
 */
function processExpression(
  expr: any,
  database: string,
  defaultSchema: string,
  result: ParsedQueryInfo
): void {
  if (!expr) return;

  // Handle subqueries
  if (expr.type === 'select' || expr.ast) {
    const subStmt = expr.ast || expr;
    processSelectStatement(subStmt, database, defaultSchema, result);
    return;
  }

  // Handle binary expressions
  if (expr.left) processExpression(expr.left, database, defaultSchema, result);
  if (expr.right) processExpression(expr.right, database, defaultSchema, result);

  // Handle IN clause with subquery
  if (expr.value && Array.isArray(expr.value)) {
    for (const v of expr.value) {
      processExpression(v, database, defaultSchema, result);
    }
  }
}

/**
 * Fallback regex-based parsing for queries the AST parser can't handle
 */
function parseQueryWithRegex(sql: string, database: string): ParsedQueryInfo {
  const result: ParsedQueryInfo = {
    tables: [],
    columns: [],
    hasSelectStar: false,
    selectStarTables: [],
    aliases: new Map(),
  };

  const normalizedSql = sql.replace(/\s+/g, ' ').trim();

  // Detect SELECT *
  const selectStarPattern = /SELECT\s+(DISTINCT\s+)?(\*|[\w.]+\.\*)/gi;
  let match;
  while ((match = selectStarPattern.exec(normalizedSql)) !== null) {
    result.hasSelectStar = true;
    const starExpr = match[2];
    if (starExpr === '*') {
      result.selectStarTables.push('*');
    } else {
      // table.* format
      const tablePart = starExpr.replace('.*', '');
      result.selectStarTables.push(tablePart);
    }
  }

  // Extract tables from FROM clause (basic pattern)
  const fromPattern = /FROM\s+(\[?[\w.]+\]?(?:\s+(?:AS\s+)?[\w]+)?)/gi;
  while ((match = fromPattern.exec(normalizedSql)) !== null) {
    const tableExpr = match[1].trim();
    const parts = tableExpr.split(/\s+/);
    const tableName = parts[0].replace(/[\[\]]/g, '');
    const alias = parts.length > 1 ? parts[parts.length - 1] : undefined;

    // Handle schema.table format
    const tableParts = tableName.split('.');
    const table = tableParts.length > 1 ? tableParts[1] : tableParts[0];
    const schema = tableParts.length > 1 ? tableParts[0] : 'dbo';

    const tableRef: QualifiedTableRef = {
      database,
      schema: schema.toLowerCase(),
      table: table,
      alias: alias?.toLowerCase(),
    };

    result.tables.push(tableRef);
    if (alias) {
      result.aliases.set(alias.toLowerCase(), tableRef);
    }
  }

  // Extract tables from JOIN clauses
  const joinPattern = /JOIN\s+(\[?[\w.]+\]?(?:\s+(?:AS\s+)?[\w]+)?)/gi;
  while ((match = joinPattern.exec(normalizedSql)) !== null) {
    const tableExpr = match[1].trim();
    const parts = tableExpr.split(/\s+/);
    const tableName = parts[0].replace(/[\[\]]/g, '');
    const alias = parts.length > 1 ? parts[parts.length - 1] : undefined;

    const tableParts = tableName.split('.');
    const table = tableParts.length > 1 ? tableParts[1] : tableParts[0];
    const schema = tableParts.length > 1 ? tableParts[0] : 'dbo';

    const tableRef: QualifiedTableRef = {
      database,
      schema: schema.toLowerCase(),
      table: table,
      alias: alias?.toLowerCase(),
    };

    result.tables.push(tableRef);
    if (alias) {
      result.aliases.set(alias.toLowerCase(), tableRef);
    }
  }

  logger.debug(`Regex parsing result: ${JSON.stringify(result, replacer, 2)}`);

  return result;
}

/**
 * JSON replacer to handle Map serialization
 */
function replacer(_key: string, value: any): any {
  if (value instanceof Map) {
    return Object.fromEntries(value);
  }
  return value;
}

/**
 * Check if a query contains SELECT * or table.*
 */
export function hasSelectStar(sql: string): boolean {
  const pattern = /SELECT\s+(DISTINCT\s+)?(\*|[\w.]+\.\*)/i;
  return pattern.test(sql);
}

/**
 * Extract table names from a simple SQL query (utility function)
 */
export function extractTableNames(sql: string): string[] {
  const tables: string[] = [];
  const normalizedSql = sql.replace(/\s+/g, ' ').trim();

  // FROM clause
  const fromMatch = normalizedSql.match(/FROM\s+(\[?[\w.]+\]?)/i);
  if (fromMatch) {
    const tableName = fromMatch[1].replace(/[\[\]]/g, '');
    const parts = tableName.split('.');
    tables.push(parts[parts.length - 1]);
  }

  // JOIN clauses
  const joinPattern = /JOIN\s+(\[?[\w.]+\]?)/gi;
  let match;
  while ((match = joinPattern.exec(normalizedSql)) !== null) {
    const tableName = match[1].replace(/[\[\]]/g, '');
    const parts = tableName.split('.');
    tables.push(parts[parts.length - 1]);
  }

  return tables;
}
