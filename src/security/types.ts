/**
 * Access Control Types for execute_query
 *
 * Hierarchical configuration structure:
 * database → schema → table → column
 */

// Column-level access policy (per table)
export interface ColumnAccessPolicy {
  mode: 'inclusion' | 'exclusion';
  columns: string[];
}

// Table-level configuration
export interface TableConfig {
  mode: 'whitelist' | 'blacklist' | 'none';
  list: string[];
  columnAccess?: Record<string, ColumnAccessPolicy>;
}

// Schema-level configuration
export interface SchemaConfig {
  tables: TableConfig;
}

// Database-level configuration (supports both formats)
export interface DatabaseConfig {
  // Full format: per-schema rules
  schemas?: Record<string, SchemaConfig>;
  // Compact format: applies to all schemas
  tables?: TableConfig;
}

// Root configuration
export interface AccessControlConfig {
  requireExplicitColumns: boolean;
  databases: Record<string, DatabaseConfig>;
}

// Violation types for error messages
export type ViolationType =
  | 'select_star'
  | 'table_not_allowed'
  | 'column_excluded'
  | 'column_not_allowed'
  | 'database_not_configured'
  | 'schema_not_configured';

// Access violation with full context
export interface AccessViolation {
  type: ViolationType;
  message: string;
  database?: string;
  schema?: string;
  table?: string;
  column?: string;
}

// Validation result
export interface AccessValidationResult {
  allowed: boolean;
  violations: AccessViolation[];
}

// Fully qualified table reference (extracted from parsed SQL)
export interface QualifiedTableRef {
  database: string; // From execute_query args
  schema: string; // From SQL or default 'dbo'
  table: string; // Table name
  alias?: string; // If aliased (e.g., Player p → alias='p')
}

// Column reference with table context
export interface QualifiedColumnRef {
  database: string;
  schema: string;
  table: string;
  column: string;
}

// Parsed query information
export interface ParsedQueryInfo {
  tables: QualifiedTableRef[];
  columns: QualifiedColumnRef[];
  hasSelectStar: boolean;
  selectStarTables: string[]; // Tables referenced in SELECT * or table.*
  aliases: Map<string, QualifiedTableRef>; // alias → table mapping
}

// Custom error class for access control violations
export class AccessControlError extends Error {
  public readonly violations: AccessViolation[];

  constructor(violations: AccessViolation[]) {
    const message = formatAccessViolations(violations);
    super(message);
    this.name = 'AccessControlError';
    this.violations = violations;
  }
}

// Format violations into user-friendly error messages
export function formatAccessViolations(violations: AccessViolation[]): string {
  if (violations.length === 0) {
    return 'No access violations';
  }

  if (violations.length === 1) {
    return violations[0].message;
  }

  const lines = violations.map((v, i) => `  ${i + 1}. ${v.message}`);
  return `Multiple access control violations:\n${lines.join('\n')}`;
}
