import { appConfig } from '../core/config.js';
import {
  ColumnMetadata,
  ForeignKeyMetadata,
  IndexMetadata,
  PrimaryKeyMetadata,
  StatisticsMetadata,
} from '../core/schema-types.js';
import { db } from './connection.js';
import { likePattern } from './identifiers.js';

interface TableRow {
  schemaName: string;
  tableName: string;
  tableType: 'BASE TABLE' | 'VIEW';
  createDate: Date | null;
  rowCount: number | null;
}

export interface TableSearchResult {
  schemaName: string;
  tableName: string;
  rowCount?: number;
  createDate?: Date | null;
}

export interface ObjectSearchResult {
  schemaName: string;
  tableName?: string;
  columnName?: string;
}

export interface Relationship {
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
  constraintName: string;
  deleteAction: string;
  updateAction: string;
}

export async function listTables(tableNames?: string[]): Promise<TableRow[]> {
  const tableFilter = tableNames?.length
    ? 'AND t.TABLE_NAME IN (:tableNames)'
    : '';
  return db.query<TableRow & any>(
    `
SELECT
  t.TABLE_SCHEMA AS schemaName,
  t.TABLE_NAME AS tableName,
  t.TABLE_TYPE AS tableType,
  t.CREATE_TIME AS createDate,
  t.TABLE_ROWS AS rowCount
FROM information_schema.TABLES t
WHERE t.TABLE_SCHEMA = :database
  AND t.TABLE_TYPE IN ('BASE TABLE', 'VIEW')
  ${tableFilter}
ORDER BY t.TABLE_NAME
`,
    { database: appConfig.db.name, tableNames },
  );
}

export async function getColumns(tableNames?: string[]): Promise<ColumnMetadata[]> {
  const tableFilter = tableNames?.length
    ? 'AND c.TABLE_NAME IN (:tableNames)'
    : '';
  return db.query<ColumnMetadata & any>(
    `
SELECT
  c.COLUMN_NAME AS name,
  c.ORDINAL_POSITION AS ordinal,
  c.COLUMN_TYPE AS dataType,
  CASE WHEN c.IS_NULLABLE = 'YES' THEN true ELSE false END AS nullable,
  CASE WHEN c.EXTRA LIKE '%auto_increment%' THEN true ELSE false END AS isIdentity,
  CASE WHEN c.EXTRA LIKE '%VIRTUAL GENERATED%' OR c.EXTRA LIKE '%STORED GENERATED%' THEN true ELSE false END AS isComputed,
  c.COLUMN_DEFAULT AS defaultValue,
  c.COLUMN_COMMENT AS description,
  CASE WHEN kcu.CONSTRAINT_NAME = 'PRIMARY' THEN true ELSE false END AS isPrimaryKey,
  CASE WHEN fk.CONSTRAINT_NAME IS NOT NULL THEN true ELSE false END AS isForeignKey,
  c.TABLE_SCHEMA AS \`schema\`,
  c.TABLE_NAME AS tableName
FROM information_schema.COLUMNS c
LEFT JOIN information_schema.KEY_COLUMN_USAGE kcu
  ON kcu.TABLE_SCHEMA = c.TABLE_SCHEMA
  AND kcu.TABLE_NAME = c.TABLE_NAME
  AND kcu.COLUMN_NAME = c.COLUMN_NAME
  AND kcu.CONSTRAINT_NAME = 'PRIMARY'
LEFT JOIN information_schema.KEY_COLUMN_USAGE fk
  ON fk.TABLE_SCHEMA = c.TABLE_SCHEMA
  AND fk.TABLE_NAME = c.TABLE_NAME
  AND fk.COLUMN_NAME = c.COLUMN_NAME
  AND fk.REFERENCED_TABLE_NAME IS NOT NULL
WHERE c.TABLE_SCHEMA = :database
  ${tableFilter}
ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
`,
    { database: appConfig.db.name, tableNames },
  );
}

export async function getPrimaryKeys(tableNames?: string[]): Promise<(PrimaryKeyMetadata & { tableName: string })[]> {
  const tableFilter = tableNames?.length
    ? 'AND kcu.TABLE_NAME IN (:tableNames)'
    : '';
  return db.query<PrimaryKeyMetadata & { tableName: string } & any>(
    `
SELECT
  kcu.TABLE_NAME AS tableName,
  kcu.CONSTRAINT_NAME AS constraintName,
  GROUP_CONCAT(kcu.COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION SEPARATOR ',') AS columns
FROM information_schema.KEY_COLUMN_USAGE kcu
WHERE kcu.TABLE_SCHEMA = :database
  AND kcu.CONSTRAINT_NAME = 'PRIMARY'
  ${tableFilter}
GROUP BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME
`,
    { database: appConfig.db.name, tableNames },
  );
}

export async function getForeignKeys(tableNames?: string[]): Promise<(ForeignKeyMetadata & { tableName: string })[]> {
  const tableFilter = tableNames?.length
    ? 'AND kcu.TABLE_NAME IN (:tableNames)'
    : '';
  return db.query<ForeignKeyMetadata & { tableName: string } & any>(
    `
SELECT
  kcu.TABLE_NAME AS tableName,
  kcu.CONSTRAINT_NAME AS constraintName,
  kcu.TABLE_SCHEMA AS fromSchema,
  kcu.TABLE_NAME AS fromTable,
  GROUP_CONCAT(kcu.COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION SEPARATOR ',') AS fromColumns,
  kcu.REFERENCED_TABLE_SCHEMA AS toSchema,
  kcu.REFERENCED_TABLE_NAME AS toTable,
  GROUP_CONCAT(kcu.REFERENCED_COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION SEPARATOR ',') AS toColumns,
  rc.DELETE_RULE AS onDelete,
  rc.UPDATE_RULE AS onUpdate
FROM information_schema.KEY_COLUMN_USAGE kcu
JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
  ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
  AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
WHERE kcu.TABLE_SCHEMA = :database
  AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
  ${tableFilter}
GROUP BY
  kcu.TABLE_NAME,
  kcu.CONSTRAINT_NAME,
  kcu.TABLE_SCHEMA,
  kcu.REFERENCED_TABLE_SCHEMA,
  kcu.REFERENCED_TABLE_NAME,
  rc.DELETE_RULE,
  rc.UPDATE_RULE
`,
    { database: appConfig.db.name, tableNames },
  );
}

export async function getIndexes(tableNames?: string[]): Promise<(IndexMetadata & { tableName: string })[]> {
  const tableFilter = tableNames?.length
    ? 'AND s.TABLE_NAME IN (:tableNames)'
    : '';
  return db.query<IndexMetadata & { tableName: string } & any>(
    `
SELECT
  s.TABLE_NAME AS tableName,
  s.INDEX_NAME AS name,
  s.INDEX_TYPE AS type,
  CASE WHEN s.NON_UNIQUE = 0 THEN true ELSE false END AS isUnique,
  CASE WHEN s.INDEX_NAME = 'PRIMARY' THEN true ELSE false END AS isPrimaryKey,
  GROUP_CONCAT(s.COLUMN_NAME ORDER BY s.SEQ_IN_INDEX SEPARATOR ',') AS columns
FROM information_schema.STATISTICS s
WHERE s.TABLE_SCHEMA = :database
  ${tableFilter}
GROUP BY s.TABLE_NAME, s.INDEX_NAME, s.INDEX_TYPE, s.NON_UNIQUE
`,
    { database: appConfig.db.name, tableNames },
  );
}

export async function getStatistics(tableNames?: string[]): Promise<(StatisticsMetadata & { tableName: string })[]> {
  const tableFilter = tableNames?.length
    ? 'AND t.TABLE_NAME IN (:tableNames)'
    : '';
  return db.query<StatisticsMetadata & { tableName: string } & any>(
    `
SELECT
  t.TABLE_NAME AS tableName,
  t.TABLE_ROWS AS rowCount,
  ROUND(((t.DATA_LENGTH + t.INDEX_LENGTH) / 1024), 0) AS totalSizeKB,
  ROUND((t.DATA_LENGTH / 1024), 0) AS usedSizeKB
FROM information_schema.TABLES t
WHERE t.TABLE_SCHEMA = :database
  ${tableFilter}
`,
    { database: appConfig.db.name, tableNames },
  );
}

export async function findTables(pattern?: string, hasColumn?: string): Promise<TableSearchResult[]> {
  const params = {
    database: appConfig.db.name,
    pattern: likePattern(pattern),
    hasColumn: likePattern(hasColumn),
  };
  return db.query<TableSearchResult & any>(
    `
SELECT DISTINCT
  t.TABLE_SCHEMA AS schemaName,
  t.TABLE_NAME AS tableName,
  t.TABLE_ROWS AS rowCount,
  t.CREATE_TIME AS createDate
FROM information_schema.TABLES t
${hasColumn ? `JOIN information_schema.COLUMNS c
  ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME` : ''}
WHERE t.TABLE_SCHEMA = :database
  AND t.TABLE_TYPE IN ('BASE TABLE', 'VIEW')
  ${pattern ? 'AND t.TABLE_NAME LIKE :pattern' : ''}
  ${hasColumn ? 'AND c.COLUMN_NAME LIKE :hasColumn' : ''}
ORDER BY t.TABLE_NAME
LIMIT 100
`,
    params,
  );
}

export async function searchObjects(search: string, type?: string): Promise<ObjectSearchResult[]> {
  const pattern = likePattern(search) || `%${search}%`;
  const includeTables = !type || type === 'table';
  const includeColumns = !type || type === 'column';
  const parts: string[] = [];

  if (includeTables) {
    parts.push(`
SELECT t.TABLE_SCHEMA AS schemaName, t.TABLE_NAME AS tableName, NULL AS columnName
FROM information_schema.TABLES t
WHERE t.TABLE_SCHEMA = :database
  AND t.TABLE_NAME LIKE :pattern`);
  }

  if (includeColumns) {
    parts.push(`
SELECT c.TABLE_SCHEMA AS schemaName, c.TABLE_NAME AS tableName, c.COLUMN_NAME AS columnName
FROM information_schema.COLUMNS c
WHERE c.TABLE_SCHEMA = :database
  AND c.COLUMN_NAME LIKE :pattern`);
  }

  if (parts.length === 0) {
    return [];
  }

  return db.query<ObjectSearchResult & any>(
    `${parts.join('\nUNION ALL\n')}\nORDER BY tableName, columnName\nLIMIT 100`,
    { database: appConfig.db.name, pattern },
  );
}

export async function getRelationships(): Promise<Relationship[]> {
  return db.query<Relationship & any>(
    `
SELECT
  kcu.TABLE_SCHEMA AS fromSchema,
  kcu.TABLE_NAME AS fromTable,
  kcu.COLUMN_NAME AS fromColumn,
  kcu.REFERENCED_TABLE_SCHEMA AS toSchema,
  kcu.REFERENCED_TABLE_NAME AS toTable,
  kcu.REFERENCED_COLUMN_NAME AS toColumn,
  kcu.CONSTRAINT_NAME AS constraintName,
  rc.DELETE_RULE AS deleteAction,
  rc.UPDATE_RULE AS updateAction
FROM information_schema.KEY_COLUMN_USAGE kcu
JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
  ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
  AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
WHERE kcu.TABLE_SCHEMA = :database
  AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY kcu.TABLE_NAME, kcu.ORDINAL_POSITION
`,
    { database: appConfig.db.name },
  );
}
