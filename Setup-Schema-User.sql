/*******************************************************************************
 * SQL Server MCP Schema-Only User Setup Script
 *
 * Creates a SCHEMA-ONLY user for the MCP server with permissions to:
 * - View database metadata and object definitions
 * - Query system catalog views
 * - NO DATA ACCESS - cannot read table data
 *
 * Use this script when you ONLY want schema introspection without data queries.
 * For full access including data queries, use Setup-Full-User.sql instead.
 *
 * This script is idempotent - safe to run multiple times.
 *
 *******************************************************************************
 * USAGE OPTION 1: SQLCMD (Command Line)
 *******************************************************************************
 *
 * sqlcmd -S your-server -E -i Setup-Schema-User.sql -v LoginName="mcp_schema_only" Password="YourStrongPassword123!" DatabaseList="LASSO,PRISM,PRISMCollege"
 *
 * Or with SQL Auth:
 * sqlcmd -S your-server -U admin -P adminpass -i Setup-Schema-User.sql -v LoginName="mcp_schema_only" Password="YourStrongPassword123!" DatabaseList="LASSO,PRISM"
 *
 *******************************************************************************
 * USAGE OPTION 2: SSMS / Azure Data Studio
 *******************************************************************************
 *
 * 1. Enable SQLCMD Mode: Query menu > SQLCMD Mode
 * 2. Uncomment and edit the :setvar lines below
 * 3. Select all and execute (F5)
 *
 ******************************************************************************/

-- Configuration variables
-- For SQLCMD CLI: use -v flags, e.g., -v LoginName="myuser"
-- For SSMS: enable SQLCMD Mode, uncomment and edit the :setvar lines below
-- :setvar LoginName "mcp_schema_only"
-- :setvar Password "YourStrongPassword123!"
-- :setvar DatabaseList "LASSO,PRISM,PRISMCollege"
-- :setvar Verbose "1"

-- Map SQLCMD variables to T-SQL variables (do not edit)
DECLARE @LoginName NVARCHAR(128) = N'$(LoginName)';
DECLARE @Password NVARCHAR(128) = N'$(Password)';
DECLARE @DatabaseList NVARCHAR(MAX) = N'$(DatabaseList)';
DECLARE @Verbose INT = $(Verbose);

/*******************************************************************************
 * DO NOT EDIT BELOW THIS LINE
 ******************************************************************************/

SET NOCOUNT ON;

-- Create table to hold database names and track results
DECLARE @Databases TABLE (DatabaseName NVARCHAR(128));
DECLARE @Results TABLE (Action NVARCHAR(50), Detail NVARCHAR(256));

-- Parse comma-separated database list
DECLARE @Pos INT, @Database NVARCHAR(128);
DECLARE @OriginalList NVARCHAR(MAX) = @DatabaseList;
SET @DatabaseList = @DatabaseList + ',';

WHILE CHARINDEX(',', @DatabaseList) > 0
BEGIN
    SET @Pos = CHARINDEX(',', @DatabaseList);
    SET @Database = LTRIM(RTRIM(LEFT(@DatabaseList, @Pos - 1)));
    SET @DatabaseList = SUBSTRING(@DatabaseList, @Pos + 1, LEN(@DatabaseList));

    IF @Database <> ''
    BEGIN
        IF EXISTS (SELECT 1 FROM sys.databases WHERE name = @Database)
        BEGIN
            INSERT INTO @Databases (DatabaseName) VALUES (@Database);
        END
        ELSE
        BEGIN
            PRINT '  WARNING: Database not found: ' + @Database;
        END
    END
END

/*******************************************************************************
 * STEP 1: Create Server Login
 ******************************************************************************/
USE master;

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = @LoginName)
BEGIN
    DECLARE @CreateLoginSQL NVARCHAR(MAX);
    SET @CreateLoginSQL = N'CREATE LOGIN [' + @LoginName + N'] WITH PASSWORD = ''' + @Password + N''', CHECK_POLICY = OFF;';
    EXEC sp_executesql @CreateLoginSQL;
    INSERT INTO @Results VALUES ('Login', 'Created: ' + @LoginName);
END
ELSE
BEGIN
    IF @Verbose = 1 INSERT INTO @Results VALUES ('Login', 'Already exists: ' + @LoginName);
END

-- Grant server-level permissions
IF NOT EXISTS (
    SELECT 1 FROM sys.server_permissions sp
    JOIN sys.server_principals sl ON sp.grantee_principal_id = sl.principal_id
    WHERE sl.name = @LoginName AND sp.permission_name = 'VIEW ANY DEFINITION'
)
BEGIN
    DECLARE @GrantServerSQL NVARCHAR(MAX);
    SET @GrantServerSQL = N'GRANT VIEW ANY DEFINITION TO [' + @LoginName + N'];';
    EXEC sp_executesql @GrantServerSQL;
    INSERT INTO @Results VALUES ('Permission', 'Granted VIEW ANY DEFINITION');
END
ELSE
BEGIN
    IF @Verbose = 1 INSERT INTO @Results VALUES ('Permission', 'VIEW ANY DEFINITION already granted');
END

/*******************************************************************************
 * STEP 2: Create Users and Grant SCHEMA-ONLY Permissions in Each Database
 ******************************************************************************/

DECLARE @CurrentDB NVARCHAR(128);
DECLARE @SQL NVARCHAR(MAX);
DECLARE @DbCount INT = 0;

DECLARE db_cursor CURSOR FOR
SELECT DatabaseName FROM @Databases;

OPEN db_cursor;
FETCH NEXT FROM db_cursor INTO @CurrentDB;

WHILE @@FETCH_STATUS = 0
BEGIN
    SET @DbCount = @DbCount + 1;

    -- Build dynamic SQL for this database
    SET @SQL = N'
    USE [' + @CurrentDB + N'];

    -- Create user if not exists
    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = ''' + @LoginName + N''')
    BEGIN
        CREATE USER [' + @LoginName + N'] FOR LOGIN [' + @LoginName + N'];
    END

    -- Grant VIEW DEFINITION (schema metadata only)
    IF NOT EXISTS (
        SELECT 1 FROM sys.database_permissions dp
        JOIN sys.database_principals p ON dp.grantee_principal_id = p.principal_id
        WHERE p.name = ''' + @LoginName + N''' AND dp.permission_name = ''VIEW DEFINITION''
    )
    BEGIN
        GRANT VIEW DEFINITION TO [' + @LoginName + N'];
    END

    -- Check for unexpected db_datareader access
    IF EXISTS (
        SELECT 1 FROM sys.database_role_members rm
        JOIN sys.database_principals rp ON rm.role_principal_id = rp.principal_id
        JOIN sys.database_principals mp ON rm.member_principal_id = mp.principal_id
        WHERE rp.name = ''db_datareader'' AND mp.name = ''' + @LoginName + N'''
    )
    BEGIN
        PRINT ''  WARNING: ' + @CurrentDB + N' - User has db_datareader role (grants data access)'';
    END
    ';

    EXEC sp_executesql @SQL;

    FETCH NEXT FROM db_cursor INTO @CurrentDB;
END

CLOSE db_cursor;
DEALLOCATE db_cursor;

/*******************************************************************************
 * STEP 3: Output Results
 ******************************************************************************/

-- Print results
IF @Verbose = 1
BEGIN
    PRINT '';
    PRINT 'Actions performed:';
    DECLARE @Action NVARCHAR(50), @Detail NVARCHAR(256);
    DECLARE result_cursor CURSOR FOR SELECT Action, Detail FROM @Results;
    OPEN result_cursor;
    FETCH NEXT FROM result_cursor INTO @Action, @Detail;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        PRINT '  ' + @Action + ': ' + @Detail;
        FETCH NEXT FROM result_cursor INTO @Action, @Detail;
    END
    CLOSE result_cursor;
    DEALLOCATE result_cursor;
    PRINT '';
END

-- Final summary
PRINT '';
PRINT 'Setup complete: ' + @LoginName + ' (schema-only)';
PRINT 'Databases configured:';

DECLARE @DbList NVARCHAR(MAX) = '';
SELECT @DbList = @DbList + '  ' + DatabaseName + CHAR(13) + CHAR(10) FROM @Databases;
PRINT @DbList;

/*******************************************************************************
 * OPTIONAL: Cleanup Script
 *
 * Uncomment and run this section to remove the user and login
 ******************************************************************************/
/*
PRINT '';
PRINT 'CLEANUP: Removing user and login';

-- Remove users from each database
DECLARE cleanup_cursor CURSOR FOR
SELECT DatabaseName FROM @Databases;

OPEN cleanup_cursor;
FETCH NEXT FROM cleanup_cursor INTO @CurrentDB;

WHILE @@FETCH_STATUS = 0
BEGIN
    SET @SQL = N'
    USE [' + @CurrentDB + N'];
    IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = ''' + @LoginName + N''')
    BEGIN
        DROP USER [' + @LoginName + N'];
        PRINT ''  Removed user from ' + @CurrentDB + N''';
    END
    ';
    EXEC sp_executesql @SQL;

    FETCH NEXT FROM cleanup_cursor INTO @CurrentDB;
END

CLOSE cleanup_cursor;
DEALLOCATE cleanup_cursor;

-- Remove server login
USE master;
IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name = @LoginName)
BEGIN
    SET @SQL = N'DROP LOGIN [' + @LoginName + N'];';
    EXEC sp_executesql @SQL;
    PRINT '  Removed login: ' + @LoginName;
END

PRINT 'Cleanup complete!';
*/
