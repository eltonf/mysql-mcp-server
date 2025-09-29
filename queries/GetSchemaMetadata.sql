CREATE OR ALTER PROCEDURE [dbo].[GetSchemaMetadata]
    @TableNames NVARCHAR(MAX) = NULL,  -- Comma-separated list or NULL for all
    @SchemaName NVARCHAR(128) = 'dbo',
    @IncludeRelationships BIT = 1,
    @IncludeSampleData BIT = 0,
    @IncludeStatistics BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    BEGIN TRY
        -- Validate schema exists
        IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = @SchemaName)
        BEGIN
            DECLARE @ErrorMsg NVARCHAR(500) = 'Schema "' + @SchemaName + '" does not exist';
            THROW 50001, @ErrorMsg, 1;
        END

        -- Parse table names into temp table
        CREATE TABLE #RequestedTables (
            SchemaName NVARCHAR(128),
            TableName NVARCHAR(256),
            ObjectType NVARCHAR(50)
        )

        -- If specific tables requested, parse them
        IF @TableNames IS NOT NULL
        BEGIN
            INSERT INTO #RequestedTables
            SELECT
                ISNULL(PARSENAME(LTRIM(RTRIM(value)), 2), @SchemaName),
                PARSENAME(LTRIM(RTRIM(value)), 1),
                CASE
                    WHEN o.type = 'U' THEN 'TABLE'
                    WHEN o.type = 'V' THEN 'VIEW'
                    ELSE NULL
                END
            FROM STRING_SPLIT(@TableNames, ',') s
            CROSS APPLY (
                SELECT type FROM sys.objects
                WHERE name = PARSENAME(LTRIM(RTRIM(s.value)), 1)
                AND schema_id = SCHEMA_ID(ISNULL(PARSENAME(LTRIM(RTRIM(s.value)), 2), @SchemaName))
                AND type IN ('U', 'V')
            ) o

            -- Check if any requested tables were not found
            IF NOT EXISTS (SELECT 1 FROM #RequestedTables)
            BEGIN
                THROW 50002, 'None of the requested tables were found', 1;
            END
        END
        ELSE
        BEGIN
            -- Get all tables/views in schema
            INSERT INTO #RequestedTables
            SELECT
                s.name,
                o.name,
                CASE
                    WHEN o.type = 'U' THEN 'TABLE'
                    WHEN o.type = 'V' THEN 'VIEW'
                END
            FROM sys.objects o
            INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
            WHERE s.name = @SchemaName
            AND o.type IN ('U', 'V')
        END

    -- Main query returning JSON
    SELECT (
        SELECT
            -- Basic table info
            t.SchemaName AS 'schema',
            t.TableName AS 'name',
            t.ObjectType AS 'type',

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
                    (
                        SELECT definition
                        FROM sys.default_constraints
                        WHERE parent_object_id = c.object_id
                        AND parent_column_id = c.column_id
                    ) AS 'defaultValue',

                    -- Extended properties (descriptions)
                    (
                        SELECT value
                        FROM sys.extended_properties ep
                        WHERE ep.major_id = c.object_id
                        AND ep.minor_id = c.column_id
                        AND ep.name = 'MS_Description'
                    ) AS 'description',

                    -- Key information
                    CASE
                        WHEN EXISTS (
                            SELECT 1 FROM sys.index_columns ic
                            INNER JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
                            WHERE i.is_primary_key = 1
                            AND ic.object_id = c.object_id
                            AND ic.column_id = c.column_id
                        ) THEN 1 ELSE 0
                    END AS 'isPrimaryKey',

                    CASE
                        WHEN EXISTS (
                            SELECT 1 FROM sys.foreign_key_columns fkc
                            WHERE fkc.parent_object_id = c.object_id
                            AND fkc.parent_column_id = c.column_id
                        ) THEN 1 ELSE 0
                    END AS 'isForeignKey'

                FROM sys.columns c
                WHERE c.object_id = OBJECT_ID(t.SchemaName + '.' + t.TableName)
                ORDER BY c.column_id
                FOR JSON PATH
            ) AS 'columns',

            -- Primary key info
            (
                SELECT
                    i.name AS 'constraintName',
                    STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS 'columns'
                FROM sys.indexes i
                INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                WHERE i.object_id = OBJECT_ID(t.SchemaName + '.' + t.TableName)
                AND i.is_primary_key = 1
                GROUP BY i.name
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
            ) AS 'primaryKey',

            -- Foreign keys (relationships)
            CASE WHEN @IncludeRelationships = 1 THEN
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
                WHERE fk.parent_object_id = OBJECT_ID(t.SchemaName + '.' + t.TableName)
                GROUP BY fk.name, fk.parent_object_id, fk.referenced_object_id,
                        fk.delete_referential_action_desc, fk.update_referential_action_desc
                FOR JSON PATH
            ) ELSE NULL END AS 'foreignKeys',

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
                WHERE i.object_id = OBJECT_ID(t.SchemaName + '.' + t.TableName)
                AND i.type > 0  -- Exclude heaps
                GROUP BY i.name, i.type_desc, i.is_unique, i.is_primary_key, i.index_id
                FOR JSON PATH
            ) AS 'indexes',

            -- Statistics (row count, size)
            CASE WHEN @IncludeStatistics = 1 THEN
            (
                SELECT
                    SUM(p.rows) AS 'rowCount',
                    SUM(a.total_pages) * 8 AS 'totalSizeKB',
                    SUM(a.used_pages) * 8 AS 'usedSizeKB'
                FROM sys.partitions p
                INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
                WHERE p.object_id = OBJECT_ID(t.SchemaName + '.' + t.TableName)
                AND p.index_id IN (0, 1)
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
            ) ELSE NULL END AS 'statistics',

            -- Sample data
            CASE WHEN @IncludeSampleData = 1 AND t.ObjectType = 'TABLE' THEN
            (
                SELECT TOP 5 *
                FROM sys.tables st
                WHERE st.object_id = OBJECT_ID(t.SchemaName + '.' + t.TableName)
                FOR JSON AUTO
            ) ELSE NULL END AS 'sampleData'

        FROM #RequestedTables t
        FOR JSON PATH, ROOT('schema')
    ) AS MetadataJson

        DROP TABLE #RequestedTables
    END TRY
    BEGIN CATCH
        IF OBJECT_ID('tempdb..#RequestedTables') IS NOT NULL
            DROP TABLE #RequestedTables;

        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
        DECLARE @ErrorState INT = ERROR_STATE();

        RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
    END CATCH
END
GO