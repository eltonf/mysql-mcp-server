# SQL Server MCP Authentication Guide

## Overview

The Node.js `mssql` library (which uses the `tedious` driver) has **limited authentication support** compared to .NET-based tools like VS Code's SQL Server extension.

## Authentication Methods

### 1. SQL Server Authentication (Recommended for macOS/Linux)

**Works on:** macOS, Windows, Linux

This is the most reliable cross-platform authentication method.

```env
DB_SERVER=your-server.domain.com
DB_USER=your_username
DB_PASSWORD=your_password
```

**Setup:**
1. Ask your DBA to create a SQL Server login:
   ```sql
   -- Run on SQL Server (requires admin privileges)
   CREATE LOGIN [your_username] WITH PASSWORD = 'YourSecurePassword123!';

   -- Grant server-level permissions (adjust as needed)
   GRANT VIEW ANY DEFINITION TO [your_username];
   GRANT VIEW SERVER STATE TO [your_username];

   -- Grant database access (for each database you need)
   USE [YourDatabase];
   CREATE USER [your_username] FOR LOGIN [your_username];
   ALTER ROLE db_datareader ADD MEMBER [your_username];
   ALTER ROLE db_datawriter ADD MEMBER [your_username];
   ```

2. Configure your `.env` file with the username and password

3. Test the connection:
   ```bash
   npm run build
   node -e "require('./dist/db/connection').db.connect().then(() => console.log('✅ Connected')).catch(err => console.error('❌ Failed:', err.message))"
   ```

### 2. Windows NTLM Authentication (Windows Only)

**Works on:** Windows only

```env
DB_SERVER=your-server.domain.com
DB_TRUSTED_CONNECTION=true
DB_DOMAIN=YOURDOMAIN
```

This uses your Windows domain credentials automatically.

### 3. Kerberos Authentication - NOT SUPPORTED ❌

**The `tedious`/`mssql` driver does NOT support Kerberos authentication on macOS/Linux.**

While VS Code can use Kerberos (because it uses a .NET-based driver), the Node.js `mssql` library cannot leverage `kinit` tickets or system Kerberos authentication.

**Why doesn't it work?**
- VS Code uses Microsoft's .NET-based SQL Tools Service, which has native Kerberos support
- The `mssql` npm package uses the `tedious` driver written in pure JavaScript
- `tedious` does not implement the GSSAPI/Kerberos protocol

**Alternatives:**
- Use SQL Server Authentication (see above)
- Run the MCP server on a Windows machine where NTLM authentication works
- Use a reverse proxy/gateway that handles Kerberos authentication

## Comparing Authentication Methods

| Method | macOS | Windows | Linux | Requires Server Changes |
|--------|-------|---------|-------|------------------------|
| SQL Server Auth | ✅ | ✅ | ✅ | Yes (create login) |
| Windows NTLM | ❌ | ✅ | ❌ | No |
| Kerberos | ❌ | ❌ | ❌ | Not supported |

## Security Best Practices

### For SQL Server Authentication

1. **Use strong passwords** - At least 12 characters with mixed case, numbers, and symbols
2. **Use environment variables** - Never commit credentials to git
3. **Restrict permissions** - Grant only the minimum permissions needed
4. **Enable SSL/TLS** - The connection is encrypted by default (see `encrypt: true` in connection.ts)
5. **Rotate passwords regularly** - Change passwords every 90 days
6. **Use separate accounts** - Don't share credentials between users or applications

### For Windows NTLM

1. **Use service accounts** - Create dedicated domain accounts for applications
2. **Restrict permissions** - Grant only necessary database access
3. **Monitor access** - Enable SQL Server auditing

## Troubleshooting

### Connection Fails with "Login failed for user ''"

This error typically means:
- No credentials were provided
- The authentication method isn't properly configured
- Check your `.env` file has `DB_USER` and `DB_PASSWORD` set

### Connection Fails with "Cannot open server"

This usually means:
- Wrong server name in `DB_SERVER`
- Network connectivity issues
- SQL Server not listening on the default port (1433)
- Firewall blocking the connection

**Solutions:**
```bash
# Test network connectivity
ping your-server.domain.com

# Test SQL Server port
nc -zv your-server.domain.com 1433

# Check if SQL Server is using a custom port
# Add port to connection string if needed
DB_SERVER=your-server.domain.com,1435
```

### Connection Succeeds but Query Fails with "The server principal is not able to access the database"

This means your SQL Server login exists but doesn't have access to the specific database.

**Solution:**
```sql
-- Run on SQL Server for each database
USE [DatabaseName];
CREATE USER [your_username] FOR LOGIN [your_username];
ALTER ROLE db_datareader ADD MEMBER [your_username];
```

## Getting Help

If you're having authentication issues:

1. **Verify your credentials work** using SQL Server Management Studio (SSMS) or Azure Data Studio
2. **Check SQL Server logs** for detailed error messages
3. **Enable debug logging** in the MCP server:
   ```env
   LOG_LEVEL=debug
   ```
4. **Contact your DBA** for help creating appropriate logins and permissions

## References

- [mssql npm package documentation](https://www.npmjs.com/package/mssql)
- [tedious driver documentation](https://tediousjs.github.io/tedious/)
- [SQL Server Authentication Modes](https://learn.microsoft.com/en-us/sql/relational-databases/security/choose-an-authentication-mode)