-- Hybrid function: Returns JSON string with comprehensive table metadata
CREATE OR ALTER FUNCTION [dbo].[GetTableSchema](
    @SchemaName NVARCHAR(128),
    @TableName NVARCHAR(256)
)
RETURNS NVARCHAR(MAX)
AS
BEGIN
    DECLARE @Json NVARCHAR(MAX)
    DECLARE @ObjectId INT = OBJECT_ID(@SchemaName + '.' + @TableName)

    -- Validate table exists
    IF @ObjectId IS NULL
        RETURN NULL

    SELECT @Json = (
        SELECT
            @SchemaName AS 'schema',
            @TableName AS 'table',
            CASE
                WHEN o.type = 'U' THEN 'TABLE'
                WHEN o.type = 'V' THEN 'VIEW'
            END AS 'type',

            -- Columns with comprehensive metadata
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

                    -- Default value
                    (
                        SELECT definition
                        FROM sys.default_constraints
                        WHERE parent_object_id = c.object_id
                        AND parent_column_id = c.column_id
                    ) AS 'defaultValue',

                    -- Description
                    (
                        SELECT value
                        FROM sys.extended_properties ep
                        WHERE ep.major_id = c.object_id
                        AND ep.minor_id = c.column_id
                        AND ep.name = 'MS_Description'
                    ) AS 'description',

                    -- Key flags
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
                WHERE i.object_id = @ObjectId
                AND i.is_primary_key = 1
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
                WHERE i.object_id = @ObjectId
                AND i.type > 0
                GROUP BY i.name, i.type_desc, i.is_unique, i.is_primary_key, i.index_id
                FOR JSON PATH
            ) AS 'indexes'

        FROM sys.objects o
        WHERE o.object_id = @ObjectId
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    )

    RETURN @Json
END
GO

/*
Usage Examples:

-- Get schema for single table (returns JSON)
SELECT dbo.GetTableSchema('dbo', 'tblLocalScoutingReport')

-- Get schema for multiple tables (use stored procedure)
EXEC GetSchemaMetadata
    @TableNames = 'tblLocalScoutingReport,vwScoutInfo,vwPlayerCoreInfo',
    @IncludeRelationships = 1,
    @IncludeStatistics = 1

-- Get all tables in schema
EXEC GetSchemaMetadata
    @SchemaName = 'dbo',
    @IncludeRelationships = 1
*/