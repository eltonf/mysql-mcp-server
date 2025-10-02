/**
 * Inline SQL queries for schema introspection
 * These queries work on any SQL Server database without requiring stored procedures
 * All queries use USE [Database] to switch context dynamically
 */

/**
 * Get comprehensive schema metadata for tables
 * Returns single JSON object with all metadata
 */
export function buildGetSchemaMetadataQuery(
  database: string,
  schemaName: string,
  tableNames: string[] | null,
  includeRelationships: boolean,
  includeStatistics: boolean
): string {
  const tableNameList = tableNames && tableNames.length > 0
    ? tableNames.map(t => `'${t.replace(/'/g, "''")}'`).join(',')
    : null;

  const tableFilter = tableNameList ? `AND t.name IN (${tableNameList})` : '';
  const viewFilter = tableNameList ? `AND v.name IN (${tableNameList})` : '';

  return `
USE [${database}];

WITH TableList AS (
  SELECT
    s.name AS SchemaName,
    t.name AS TableName,
    t.object_id AS ObjectId,
    CASE WHEN t.type = 'U' THEN 'TABLE' WHEN t.type = 'V' THEN 'VIEW' END AS ObjectType
  FROM sys.tables t
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = '${schemaName.replace(/'/g, "''")}'
  ${tableFilter}

  UNION ALL

  SELECT
    s.name AS SchemaName,
    v.name AS TableName,
    v.object_id AS ObjectId,
    'VIEW' AS ObjectType
  FROM sys.views v
  INNER JOIN sys.schemas s ON v.schema_id = s.schema_id
  WHERE s.name = '${schemaName.replace(/'/g, "''")}'
  ${viewFilter}
)
SELECT (
  SELECT
    tl.SchemaName AS 'schema',
    tl.TableName AS 'name',
    tl.ObjectType AS 'type',

    -- Columns with full metadata
    (
      SELECT
        c.name AS 'name',
        TYPE_NAME(c.user_type_id) +
        CASE
          WHEN TYPE_NAME(c.user_type_id) IN ('varchar', 'char', 'nvarchar', 'nchar')
            THEN '(' + CASE WHEN c.max_length = -1 THEN 'MAX'
                            WHEN TYPE_NAME(c.user_type_id) LIKE 'n%'
                            THEN CAST(c.max_length/2 AS VARCHAR)
                            ELSE CAST(c.max_length AS VARCHAR) END + ')'
          WHEN TYPE_NAME(c.user_type_id) IN ('decimal', 'numeric')
            THEN '(' + CAST(c.precision AS VARCHAR) + ',' + CAST(c.scale AS VARCHAR) + ')'
          ELSE ''
        END AS 'dataType',
        c.is_nullable AS 'nullable',
        c.is_identity AS 'isIdentity',
        CAST(ISNULL(c.is_computed, 0) AS BIT) AS 'isComputed',

        -- Default value
        (SELECT definition FROM sys.default_constraints
         WHERE parent_object_id = c.object_id AND parent_column_id = c.column_id) AS 'defaultValue',

        -- Description
        (SELECT value FROM sys.extended_properties ep
         WHERE ep.major_id = c.object_id AND ep.minor_id = c.column_id
         AND ep.name = 'MS_Description') AS 'description',

        -- Key information
        CASE WHEN EXISTS (
          SELECT 1 FROM sys.index_columns ic
          INNER JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
          WHERE i.is_primary_key = 1 AND ic.object_id = c.object_id AND ic.column_id = c.column_id
        ) THEN 1 ELSE 0 END AS 'isPrimaryKey',

        CASE WHEN EXISTS (
          SELECT 1 FROM sys.foreign_key_columns fkc
          WHERE fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
        ) THEN 1 ELSE 0 END AS 'isForeignKey'

      FROM sys.columns c
      WHERE c.object_id = tl.ObjectId
      ORDER BY c.column_id
      FOR JSON PATH
    ) AS 'columns',

    -- Primary key
    (
      SELECT
        i.name AS 'constraintName',
        STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS 'columns'
      FROM sys.indexes i
      INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
      INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      WHERE i.object_id = tl.ObjectId AND i.is_primary_key = 1
      GROUP BY i.name
      FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS 'primaryKey',

    ${includeRelationships ? `
    -- Foreign keys
    (
      SELECT
        fk.name AS 'constraintName',
        OBJECT_SCHEMA_NAME(fk.parent_object_id) AS 'fromSchema',
        OBJECT_NAME(fk.parent_object_id) AS 'fromTable',
        STRING_AGG(COL_NAME(fkc.parent_object_id, fkc.parent_column_id), ',')
          WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS 'fromColumns',
        OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS 'toSchema',
        OBJECT_NAME(fk.referenced_object_id) AS 'toTable',
        STRING_AGG(COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id), ',')
          WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS 'toColumns',
        fk.delete_referential_action_desc AS 'onDelete',
        fk.update_referential_action_desc AS 'onUpdate'
      FROM sys.foreign_keys fk
      INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
      WHERE fk.parent_object_id = tl.ObjectId
      GROUP BY fk.name, fk.parent_object_id, fk.referenced_object_id,
              fk.delete_referential_action_desc, fk.update_referential_action_desc
      FOR JSON PATH
    ) AS 'foreignKeys',
    ` : 'NULL AS foreignKeys,'}

    -- Indexes
    (
      SELECT
        i.name AS 'name',
        i.type_desc AS 'type',
        i.is_unique AS 'isUnique',
        i.is_primary_key AS 'isPrimaryKey',
        STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS 'columns'
      FROM sys.indexes i
      INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
      INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      WHERE i.object_id = tl.ObjectId AND i.type > 0
      GROUP BY i.name, i.type_desc, i.is_unique, i.is_primary_key, i.index_id
      FOR JSON PATH
    ) AS 'indexes'

    ${includeStatistics ? `
    ,
    -- Statistics
    (
      SELECT
        SUM(p.rows) AS 'rowCount',
        SUM(a.total_pages) * 8 AS 'totalSizeKB',
        SUM(a.used_pages) * 8 AS 'usedSizeKB'
      FROM sys.partitions p
      INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
      WHERE p.object_id = tl.ObjectId AND p.index_id IN (0, 1)
      FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS 'statistics'
    ` : ''}

  FROM TableList tl
  FOR JSON PATH, ROOT('schema')
) AS MetadataJson;
`;
}

/**
 * Get quick table schema information
 * Returns JSON with column metadata, keys, indexes
 */
export function buildGetTableSchemaQuery(
  database: string,
  schemaName: string,
  tableName: string
): string {
  return `
USE [${database}];

DECLARE @ObjectId INT = OBJECT_ID('[${schemaName.replace(/'/g, "''")}].[${tableName.replace(/'/g, "''")}]');

SELECT (
  SELECT
    '${schemaName.replace(/'/g, "''")}' AS 'schema',
    '${tableName.replace(/'/g, "''")}' AS 'table',
    CASE WHEN o.type = 'U' THEN 'TABLE' WHEN o.type = 'V' THEN 'VIEW' END AS 'type',

    -- Columns
    (
      SELECT
        c.name AS 'name',
        c.column_id AS 'ordinal',
        TYPE_NAME(c.user_type_id) +
        CASE
          WHEN TYPE_NAME(c.user_type_id) IN ('varchar', 'char', 'nvarchar', 'nchar')
            THEN '(' + CASE WHEN c.max_length = -1 THEN 'MAX'
                            WHEN TYPE_NAME(c.user_type_id) LIKE 'n%'
                            THEN CAST(c.max_length/2 AS VARCHAR)
                            ELSE CAST(c.max_length AS VARCHAR) END + ')'
          WHEN TYPE_NAME(c.user_type_id) IN ('decimal', 'numeric')
            THEN '(' + CAST(c.precision AS VARCHAR) + ',' + CAST(c.scale AS VARCHAR) + ')'
          ELSE ''
        END AS 'dataType',
        c.is_nullable AS 'nullable',
        c.is_identity AS 'isIdentity',
        CAST(ISNULL(c.is_computed, 0) AS BIT) AS 'isComputed',

        (SELECT definition FROM sys.default_constraints
         WHERE parent_object_id = c.object_id AND parent_column_id = c.column_id) AS 'defaultValue',

        (SELECT value FROM sys.extended_properties ep
         WHERE ep.major_id = c.object_id AND ep.minor_id = c.column_id
         AND ep.name = 'MS_Description') AS 'description',

        CASE WHEN EXISTS (
          SELECT 1 FROM sys.index_columns ic
          INNER JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
          WHERE i.is_primary_key = 1 AND ic.object_id = c.object_id AND ic.column_id = c.column_id
        ) THEN 1 ELSE 0 END AS 'isPrimaryKey',

        CASE WHEN EXISTS (
          SELECT 1 FROM sys.foreign_key_columns fkc
          WHERE fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
        ) THEN 1 ELSE 0 END AS 'isForeignKey'

      FROM sys.columns c
      WHERE c.object_id = @ObjectId
      ORDER BY c.column_id
      FOR JSON PATH
    ) AS 'columns',

    -- Primary key
    (
      SELECT
        i.name AS 'constraintName',
        STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS 'columns'
      FROM sys.indexes i
      INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
      INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      WHERE i.object_id = @ObjectId AND i.is_primary_key = 1
      GROUP BY i.name
      FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS 'primaryKey',

    -- Foreign keys
    (
      SELECT
        fk.name AS 'constraintName',
        STRING_AGG(COL_NAME(fkc.parent_object_id, fkc.parent_column_id), ',')
          WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS 'columns',
        OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS 'referencedSchema',
        OBJECT_NAME(fk.referenced_object_id) AS 'referencedTable',
        STRING_AGG(COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id), ',')
          WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS 'referencedColumns'
      FROM sys.foreign_keys fk
      INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
      WHERE fk.parent_object_id = @ObjectId
      GROUP BY fk.name, fk.referenced_object_id
      FOR JSON PATH
    ) AS 'foreignKeys',

    -- Indexes
    (
      SELECT
        i.name AS 'name',
        i.type_desc AS 'type',
        i.is_unique AS 'isUnique',
        i.is_primary_key AS 'isPrimaryKey',
        STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS 'columns'
      FROM sys.indexes i
      INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
      INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      WHERE i.object_id = @ObjectId AND i.type > 0
      GROUP BY i.name, i.type_desc, i.is_unique, i.is_primary_key, i.index_id
      FOR JSON PATH
    ) AS 'indexes'

  FROM sys.objects o
  WHERE o.object_id = @ObjectId
  FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS JsonResult;
`;
}

/**
 * Find tables by pattern or column name
 */
export function buildFindTablesQuery(
  database: string,
  schemaName: string | null,
  pattern: string | null,
  hasColumn: string | null
): string {
  const schemaFilter = schemaName ? `AND s.name = '${schemaName.replace(/'/g, "''")}'` : '';
  const patternFilter = pattern
    ? `AND t.name LIKE '${pattern.replace(/\*/g, '%').replace(/\?/g, '_').replace(/'/g, "''")}'`
    : '';
  const columnFilter = hasColumn
    ? `AND c.name LIKE '${hasColumn.replace(/\*/g, '%').replace(/\?/g, '_').replace(/'/g, "''")}'`
    : '';
  const columnJoin = hasColumn
    ? `INNER JOIN sys.columns c ON t.object_id = c.object_id`
    : '';

  return `
USE [${database}];

SELECT (
  SELECT
    s.name AS schemaName,
    t.name AS tableName,
    t.create_date AS createDate,
    MAX(p.rows) AS [rowCount]
  FROM sys.tables t
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  LEFT JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0, 1)
  ${columnJoin}
  WHERE 1=1
  ${schemaFilter}
  ${patternFilter}
  ${columnFilter}
  GROUP BY s.name, t.name, t.create_date
  ORDER BY s.name, t.name
  FOR JSON PATH
) AS JsonResult;
`;
}

/**
 * Get all relationships in a database
 */
export function buildGetRelationshipsQuery(
  database: string,
  schemaName: string
): string {
  return `
USE [${database}];

SELECT
  s.name AS fromSchema,
  t.name AS fromTable,
  c.name AS fromColumn,
  rs.name AS toSchema,
  rt.name AS toTable,
  rc.name AS toColumn,
  fk.name AS constraintName,
  fk.delete_referential_action_desc AS deleteAction,
  fk.update_referential_action_desc AS updateAction
FROM sys.foreign_keys fk
INNER JOIN sys.tables t ON fk.parent_object_id = t.object_id
INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
INNER JOIN sys.columns c ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
INNER JOIN sys.tables rt ON fk.referenced_object_id = rt.object_id
INNER JOIN sys.schemas rs ON rt.schema_id = rs.schema_id
INNER JOIN sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id
WHERE s.name = '${schemaName.replace(/'/g, "''")}' OR rs.name = '${schemaName.replace(/'/g, "''")}'
ORDER BY t.name, fk.name
FOR JSON PATH;
`;
}

/**
 * Find stored procedures and functions by pattern
 */
export function buildFindRoutinesQuery(
  database: string,
  schemaName: string | null,
  pattern: string | null,
  routineType: string | null
): string {
  const schemaFilter = schemaName ? `AND s.name = '${schemaName.replace(/'/g, "''")}'` : '';
  const patternFilter = pattern
    ? `AND o.name LIKE '${pattern.replace(/\*/g, '%').replace(/\?/g, '_').replace(/'/g, "''")}'`
    : '';

  // Type filter: P=Stored Proc, FN=Scalar Function, IF=Inline Table Function, TF=Table Function, FS/FT=CLR Functions
  const typeFilter = routineType
    ? `AND o.type = '${routineType.replace(/'/g, "''")}'\n`
    : `AND o.type IN ('P', 'FN', 'IF', 'TF', 'FS', 'FT', 'PC', 'X')\n`;

  return `
USE [${database}];

SELECT
  s.name AS schemaName,
  o.name AS routineName,
  CASE o.type
    WHEN 'P' THEN 'PROCEDURE'
    WHEN 'PC' THEN 'CLR_PROCEDURE'
    WHEN 'X' THEN 'EXTENDED_PROCEDURE'
    WHEN 'FN' THEN 'SCALAR_FUNCTION'
    WHEN 'IF' THEN 'INLINE_TABLE_FUNCTION'
    WHEN 'TF' THEN 'TABLE_FUNCTION'
    WHEN 'FS' THEN 'CLR_SCALAR_FUNCTION'
    WHEN 'FT' THEN 'CLR_TABLE_FUNCTION'
    ELSE o.type
  END AS routineType,
  o.create_date AS createDate,
  o.modify_date AS modifyDate,
  (SELECT value FROM sys.extended_properties ep
   WHERE ep.major_id = o.object_id AND ep.minor_id = 0
   AND ep.name = 'MS_Description') AS description
FROM sys.objects o
INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
WHERE 1=1
${typeFilter}${schemaFilter}
${patternFilter}
ORDER BY s.name, o.name
FOR JSON PATH;
`;
}

/**
 * Get single routine definition with parameters
 */
export function buildGetRoutineDefinitionQuery(
  database: string,
  schemaName: string,
  routineName: string
): string {
  return `
USE [${database}];

DECLARE @ObjectId INT = OBJECT_ID('[${schemaName.replace(/'/g, "''")}].[${routineName.replace(/'/g, "''")}]');

SELECT (
  SELECT
    '${schemaName.replace(/'/g, "''")}' AS 'schema',
    '${routineName.replace(/'/g, "''")}' AS 'name',
    CASE o.type
      WHEN 'P' THEN 'PROCEDURE'
      WHEN 'PC' THEN 'CLR_PROCEDURE'
      WHEN 'X' THEN 'EXTENDED_PROCEDURE'
      WHEN 'FN' THEN 'SCALAR_FUNCTION'
      WHEN 'IF' THEN 'INLINE_TABLE_FUNCTION'
      WHEN 'TF' THEN 'TABLE_FUNCTION'
      WHEN 'FS' THEN 'CLR_SCALAR_FUNCTION'
      WHEN 'FT' THEN 'CLR_TABLE_FUNCTION'
      ELSE o.type
    END AS 'type',
    o.create_date AS 'createDate',
    o.modify_date AS 'modifyDate',

    -- Description from extended properties
    (SELECT value FROM sys.extended_properties ep
     WHERE ep.major_id = @ObjectId AND ep.minor_id = 0
     AND ep.name = 'MS_Description') AS 'description',

    -- Source code definition
    sm.definition AS 'definition',

    -- Parameters
    (
      SELECT
        p.name AS 'name',
        TYPE_NAME(p.user_type_id) +
        CASE
          WHEN TYPE_NAME(p.user_type_id) IN ('varchar', 'char', 'nvarchar', 'nchar')
            THEN '(' + CASE WHEN p.max_length = -1 THEN 'MAX'
                            WHEN TYPE_NAME(p.user_type_id) LIKE 'n%'
                            THEN CAST(p.max_length/2 AS VARCHAR)
                            ELSE CAST(p.max_length AS VARCHAR) END + ')'
          WHEN TYPE_NAME(p.user_type_id) IN ('decimal', 'numeric')
            THEN '(' + CAST(p.precision AS VARCHAR) + ',' + CAST(p.scale AS VARCHAR) + ')'
          ELSE ''
        END AS 'dataType',
        p.is_output AS 'isOutput',
        p.has_default_value AS 'hasDefaultValue',
        p.default_value AS 'defaultValue',
        p.parameter_id AS 'ordinal'
      FROM sys.parameters p
      WHERE p.object_id = @ObjectId
      ORDER BY p.parameter_id
      FOR JSON PATH
    ) AS 'parameters'

  FROM sys.objects o
  LEFT JOIN sys.sql_modules sm ON o.object_id = sm.object_id
  WHERE o.object_id = @ObjectId
  FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS JsonResult;
`;
}

/**
 * Get comprehensive schema metadata for multiple routines
 */
export function buildGetRoutinesSchemaQuery(
  database: string,
  schemaName: string,
  routineNames: string[] | null
): string {
  const routineNameList = routineNames && routineNames.length > 0
    ? routineNames.map(r => `'${r.replace(/'/g, "''")}'`).join(',')
    : null;

  const routineFilter = routineNameList ? `AND o.name IN (${routineNameList})` : '';

  return `
USE [${database}];

WITH RoutineList AS (
  SELECT
    s.name AS SchemaName,
    o.name AS RoutineName,
    o.object_id AS ObjectId,
    o.type AS ObjectType,
    o.create_date AS CreateDate,
    o.modify_date AS ModifyDate
  FROM sys.objects o
  INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
  WHERE s.name = '${schemaName.replace(/'/g, "''")}'
  AND o.type IN ('P', 'FN', 'IF', 'TF', 'FS', 'FT', 'PC', 'X')
  ${routineFilter}
)
SELECT (
  SELECT
    rl.SchemaName AS 'schema',
    rl.RoutineName AS 'name',
    CASE rl.ObjectType
      WHEN 'P' THEN 'PROCEDURE'
      WHEN 'PC' THEN 'CLR_PROCEDURE'
      WHEN 'X' THEN 'EXTENDED_PROCEDURE'
      WHEN 'FN' THEN 'SCALAR_FUNCTION'
      WHEN 'IF' THEN 'INLINE_TABLE_FUNCTION'
      WHEN 'TF' THEN 'TABLE_FUNCTION'
      WHEN 'FS' THEN 'CLR_SCALAR_FUNCTION'
      WHEN 'FT' THEN 'CLR_TABLE_FUNCTION'
      ELSE rl.ObjectType
    END AS 'type',
    rl.CreateDate AS 'createDate',
    rl.ModifyDate AS 'modifyDate',

    -- Description
    (SELECT value FROM sys.extended_properties ep
     WHERE ep.major_id = rl.ObjectId AND ep.minor_id = 0
     AND ep.name = 'MS_Description') AS 'description',

    -- Source code definition
    (SELECT definition FROM sys.sql_modules WHERE object_id = rl.ObjectId) AS 'definition',

    -- Parameters
    (
      SELECT
        p.name AS 'name',
        TYPE_NAME(p.user_type_id) +
        CASE
          WHEN TYPE_NAME(p.user_type_id) IN ('varchar', 'char', 'nvarchar', 'nchar')
            THEN '(' + CASE WHEN p.max_length = -1 THEN 'MAX'
                            WHEN TYPE_NAME(p.user_type_id) LIKE 'n%'
                            THEN CAST(p.max_length/2 AS VARCHAR)
                            ELSE CAST(p.max_length AS VARCHAR) END + ')'
          WHEN TYPE_NAME(p.user_type_id) IN ('decimal', 'numeric')
            THEN '(' + CAST(p.precision AS VARCHAR) + ',' + CAST(p.scale AS VARCHAR) + ')'
          ELSE ''
        END AS 'dataType',
        p.is_output AS 'isOutput',
        p.has_default_value AS 'hasDefaultValue',
        p.default_value AS 'defaultValue',
        p.parameter_id AS 'ordinal'
      FROM sys.parameters p
      WHERE p.object_id = rl.ObjectId
      ORDER BY p.parameter_id
      FOR JSON PATH
    ) AS 'parameters'

  FROM RoutineList rl
  FOR JSON PATH, ROOT('routines')
) AS MetadataJson;
`;
}