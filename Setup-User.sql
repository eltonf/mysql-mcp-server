/*******************************************************************************
 * SQL Server MCP User Setup Script
 *
 * Creates a read-only user for the MCP server with permissions to:
 * - View database metadata and object definitions
 * - Read data from specified databases
 * - Query system catalog views
 *
 * This script is idempotent - safe to run multiple times.
 *
 *******************************************************************************
 * USAGE OPTION 1: SQLCMD (Command Line)
 *******************************************************************************
 *
 * sqlcmd -S your-server -E -i Setup-User.sql -v LoginName="mcp_readonly" Password="YourStrongPassword123!" DatabaseList="LASSO,PRISM,PRISMCollege"
 *
 * Or with SQL Auth:
 * sqlcmd -S your-server -U admin -P adminpass -i Setup-User.sql -v LoginName="mcp_readonly" Password="YourStrongPassword123!" DatabaseList="LASSO,PRISM"
 *
 *******************************************************************************
 * USAGE OPTION 2: SSMS / Azure Data Studio
 *******************************************************************************
 *
 * 1. Edit the variables in the T-SQL section below
 * 2. Select all and execute (F5)
 *
 ******************************************************************************/

-- Uncomment this section for SQLCMD mode
/*
:setvar LoginName "mcp_readonly"
:setvar Password "YourStrongPassword123!"
:setvar DatabaseList "LASSO,PRISM,PRISMCollege"
*/

-- T-SQL version for SSMS/Azure Data Studio
-- Edit these variables, then select all and execute
DECLARE @LoginName NVARCHAR(128) = N'mcp_readonly';
DECLARE @Password NVARCHAR(128) = N'YourStrongPassword123!';
DECLARE @DatabaseList NVARCHAR(MAX) = N'LASSO,PRISM,PRISMCollege'; -- Comma-separated list

/*******************************************************************************
 * DO NOT EDIT BELOW THIS LINE
 ******************************************************************************/

SET NOCOUNT ON;

PRINT '';
PRINT '========================================';
PRINT 'SQL Server MCP User Setup';
PRINT '========================================';
PRINT 'Login: ' + @LoginName;
PRINT 'Databases: ' + @DatabaseList;
PRINT '';

-- Create table to hold database names
DECLARE @Databases TABLE (DatabaseName NVARCHAR(128));

-- Parse comma-separated database list
DECLARE @Pos INT, @Database NVARCHAR(128);
SET @DatabaseList = @DatabaseList + ',';

WHILE CHARINDEX(',', @DatabaseList) > 0
BEGIN
    SET @Pos = CHARINDEX(',', @DatabaseList);
    SET @Database = LTRIM(RTRIM(LEFT(@DatabaseList, @Pos - 1)));
    SET @DatabaseList = SUBSTRING(@DatabaseList, @Pos + 1, LEN(@DatabaseList));

    IF @Database <> ''
    BEGIN
        -- Validate database exists
        IF EXISTS (SELECT 1 FROM sys.databases WHERE name = @Database)
        BEGIN
            INSERT INTO @Databases (DatabaseName) VALUES (@Database);
            PRINT '  ✓ Found database: ' + @Database;
        END
        ELSE
        BEGIN
            PRINT '  ✗ WARNING: Database not found: ' + @Database;
        END
    END
END

PRINT '';

/*******************************************************************************
 * STEP 1: Create Server Login
 ******************************************************************************/
USE master;

PRINT 'Step 1: Creating server login...';

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = @LoginName)
BEGIN
    DECLARE @CreateLoginSQL NVARCHAR(MAX);
    SET @CreateLoginSQL = N'CREATE LOGIN [' + @LoginName + N'] WITH PASSWORD = ''' + @Password + N''', CHECK_POLICY = OFF;';
    EXEC sp_executesql @CreateLoginSQL;
    PRINT '  ✓ Created login: ' + @LoginName;
END
ELSE
BEGIN
    PRINT '  → Login already exists: ' + @LoginName;
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
    PRINT '  ✓ Granted VIEW ANY DEFINITION permission';
END
ELSE
BEGIN
    PRINT '  → VIEW ANY DEFINITION already granted';
END

PRINT '';

/*******************************************************************************
 * STEP 2: Create Users and Grant Permissions in Each Database
 ******************************************************************************/

DECLARE @CurrentDB NVARCHAR(128);
DECLARE @SQL NVARCHAR(MAX);

DECLARE db_cursor CURSOR FOR
SELECT DatabaseName FROM @Databases;

OPEN db_cursor;
FETCH NEXT FROM db_cursor INTO @CurrentDB;

WHILE @@FETCH_STATUS = 0
BEGIN
    PRINT 'Step 2: Configuring database: ' + @CurrentDB;

    -- Build dynamic SQL for this database
    SET @SQL = N'
    USE [' + @CurrentDB + N'];

    -- Create user if not exists
    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = ''' + @LoginName + N''')
    BEGIN
        CREATE USER [' + @LoginName + N'] FOR LOGIN [' + @LoginName + N'];
        PRINT ''  ✓ Created user in ' + @CurrentDB + N''';
    END
    ELSE
    BEGIN
        PRINT ''  → User already exists in ' + @CurrentDB + N''';
    END

    -- Add to db_datareader role
    IF NOT EXISTS (
        SELECT 1 FROM sys.database_role_members rm
        JOIN sys.database_principals rp ON rm.role_principal_id = rp.principal_id
        JOIN sys.database_principals mp ON rm.member_principal_id = mp.principal_id
        WHERE rp.name = ''db_datareader'' AND mp.name = ''' + @LoginName + N'''
    )
    BEGIN
        ALTER ROLE db_datareader ADD MEMBER [' + @LoginName + N'];
        PRINT ''  ✓ Added to db_datareader role'';
    END
    ELSE
    BEGIN
        PRINT ''  → Already member of db_datareader'';
    END

    -- Grant VIEW DEFINITION
    IF NOT EXISTS (
        SELECT 1 FROM sys.database_permissions dp
        JOIN sys.database_principals p ON dp.grantee_principal_id = p.principal_id
        WHERE p.name = ''' + @LoginName + N''' AND dp.permission_name = ''VIEW DEFINITION''
    )
    BEGIN
        GRANT VIEW DEFINITION TO [' + @LoginName + N'];
        PRINT ''  ✓ Granted VIEW DEFINITION permission'';
    END
    ELSE
    BEGIN
        PRINT ''  → VIEW DEFINITION already granted'';
    END

    PRINT '''';
    ';

    EXEC sp_executesql @SQL;

    FETCH NEXT FROM db_cursor INTO @CurrentDB;
END

CLOSE db_cursor;
DEALLOCATE db_cursor;

/*******************************************************************************
 * STEP 3: Summary
 ******************************************************************************/

PRINT '========================================';
PRINT 'Setup Complete!';
PRINT '========================================';
PRINT '';
PRINT 'Login: ' + @LoginName;
PRINT '';
PRINT 'Permissions granted:';
PRINT '  • VIEW ANY DEFINITION (server-level)';
PRINT '  • db_datareader role (per database)';
PRINT '  • VIEW DEFINITION (per database)';
PRINT '';
PRINT 'Databases configured:';

SELECT DatabaseName FROM @Databases;

PRINT '';
PRINT 'Test connection with:';
PRINT '  DB_SERVER=your-server';
PRINT '  DB_USER=' + @LoginName;
PRINT '  DB_PASSWORD=<your_password>';
PRINT '';

/*******************************************************************************
 * OPTIONAL: Cleanup Script
 *
 * Uncomment and run this section to remove the user and login
 ******************************************************************************/
/*
PRINT '';
PRINT '========================================';
PRINT 'CLEANUP: Removing user and login';
PRINT '========================================';

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
        PRINT ''  ✓ Removed user from ' + @CurrentDB + N''';
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
    PRINT '  ✓ Removed login: ' + @LoginName;
END

PRINT 'Cleanup complete!';
*/
