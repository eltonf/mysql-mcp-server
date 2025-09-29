# macOS Setup Guide - Kerberos Authentication

This guide explains how to set up SQL Server MCP Tools on macOS using Kerberos authentication (the same method used by VS Code).

## Why Kerberos on macOS?

- **Same as VS Code**: Uses the same `kinit` authentication you're already using
- **No password storage**: Uses Kerberos tickets, more secure
- **Active Directory integration**: Works seamlessly with domain-joined SQL Servers
- **Automatic renewal**: Tickets can be renewed without restarting

## Prerequisites

1. **Access to Active Directory domain**
2. **SQL Server with Windows Authentication enabled**
3. **Kerberos client installed** (usually pre-installed on macOS)
4. **Network access to SQL Server**

## Step-by-Step Setup

### 1. Configure Kerberos

Create or edit `~/.krb5.conf`:

```ini
[libdefaults]
    default_realm = YOUR-DOMAIN.COM
    dns_lookup_kdc = true
    dns_lookup_realm = true
    ticket_lifetime = 24h
    renew_lifetime = 7d
    forwardable = true

[realms]
    YOUR-DOMAIN.COM = {
        kdc = your-dc.your-domain.com
        admin_server = your-dc.your-domain.com
    }

[domain_realm]
    .your-domain.com = YOUR-DOMAIN.COM
    your-domain.com = YOUR-DOMAIN.COM
```

**Replace**:
- `YOUR-DOMAIN.COM` with your Active Directory domain (uppercase)
- `your-dc.your-domain.com` with your domain controller hostname

### 2. Obtain Kerberos Ticket

Run `kinit` with your domain username:

```bash
kinit username@YOUR-DOMAIN.COM
```

**Example**:
```bash
kinit efaggett@MYDOMAIN.COM
```

You'll be prompted for your password. After successful authentication:

```bash
# Verify ticket
klist

# Output should show:
# Ticket cache: FILE:/tmp/krb5cc_501
# Default principal: efaggett@MYDOMAIN.COM
#
# Valid starting     Expires            Service principal
# 09/29/24 16:00:00  09/30/24 02:00:00  krbtgt/MYDOMAIN.COM@MYDOMAIN.COM
```

### 3. Configure MCP Server

Create `.env` file:

```bash
cp .env.example .env
```

Edit `.env` for Kerberos:

```env
# SQL Server hostname (FQDN recommended)
DB_SERVER=your-sqlserver.your-domain.com

# Enable Kerberos authentication
DB_USE_KERBEROS=true

# Your Active Directory domain (uppercase)
DB_DOMAIN=YOUR-DOMAIN.COM

# Optional: Cache and logging
CACHE_TTL=3600
CACHE_ENABLED=true
LOG_LEVEL=info
```

**Important**:
- Use **FQDN** for `DB_SERVER` (e.g., `sqlserver.domain.com`, not just `sqlserver`)
- Domain should be **UPPERCASE**
- Do NOT set `DB_USER` or `DB_PASSWORD` when using Kerberos

### 4. Build and Test

```bash
# Install dependencies
npm install

# Build project
npm run build

# Test connection
node -e "
const { db } = require('./dist/db/connection');
db.connect()
  .then(() => {
    console.log('✅ Kerberos authentication successful!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Connection failed:', err.message);
    process.exit(1);
  });
"
```

### 5. Configure Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sql-server-tools": {
      "command": "node",
      "args": ["/Users/YOUR-USERNAME/path/to/sql-server-mcp-tools/dist/index.js"],
      "env": {
        "DB_SERVER": "your-sqlserver.your-domain.com",
        "DB_USE_KERBEROS": "true",
        "DB_DOMAIN": "YOUR-DOMAIN.COM",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

**Replace**:
- `/Users/YOUR-USERNAME/path/to/sql-server-mcp-tools` with actual absolute path
- Server and domain values

### 6. Start Claude Desktop

1. **Ensure kinit is active**: Run `klist` to verify ticket
2. **Restart Claude Desktop** completely (Cmd+Q, then reopen)
3. **Test**: Ask Claude "Get the table definition for Players in LASSO"

## Workflow

### Daily Usage

```bash
# Morning: Get Kerberos ticket
kinit username@YOUR-DOMAIN.COM

# Use Claude Desktop normally
# MCP server will use your Kerberos ticket automatically

# Check ticket expiration
klist

# Before ticket expires (typically 10 hours), renew:
kinit -R
```

### Automatic Ticket Renewal

Create a script to auto-renew tickets:

**Save as** `~/bin/renew-kerberos.sh`:

```bash
#!/bin/bash
# Auto-renew Kerberos tickets

while true; do
    # Check if ticket exists and is renewable
    if klist -s 2>/dev/null; then
        # Renew ticket
        kinit -R 2>/dev/null && echo "✅ Kerberos ticket renewed at $(date)"
    else
        echo "⚠️  No valid ticket. Run: kinit username@DOMAIN.COM"
    fi

    # Sleep for 8 hours (renew before 10-hour expiration)
    sleep 28800
done
```

Make it executable:
```bash
chmod +x ~/bin/renew-kerberos.sh
```

Run in background:
```bash
~/bin/renew-kerberos.sh &
```

Or create a LaunchAgent for automatic startup.

## Troubleshooting

### Issue: "Login failed" or "Cannot generate SSPI context"

**Cause**: Kerberos ticket expired or invalid

**Solution**:
```bash
# Destroy old ticket
kdestroy

# Get new ticket
kinit username@YOUR-DOMAIN.COM

# Verify
klist

# Restart Claude Desktop
```

### Issue: "Could not find SPN" or "Target principal name is incorrect"

**Cause**: SQL Server SPN not registered or wrong server name

**Solution**:
```bash
# Use FQDN in DB_SERVER
DB_SERVER=sqlserver.domain.com  # ✅ Good
DB_SERVER=sqlserver              # ❌ Bad

# Verify SPN exists (on Windows, as domain admin):
setspn -L SQLSERVER-HOSTNAME
# Should show: MSSQLSvc/sqlserver.domain.com:1433
```

### Issue: "KDC has no support for encryption type"

**Cause**: Encryption type mismatch

**Solution**: Add to `~/.krb5.conf`:
```ini
[libdefaults]
    default_tgs_enctypes = aes256-cts-hmac-sha1-96 rc4-hmac des-cbc-crc des-cbc-md5
    default_tkt_enctypes = aes256-cts-hmac-sha1-96 rc4-hmac des-cbc-crc des-cbc-md5
    permitted_enctypes = aes256-cts-hmac-sha1-96 rc4-hmac des-cbc-crc des-cbc-md5
```

### Issue: "Ticket cache not found"

**Cause**: Kerberos not configured or ticket expired

**Solution**:
```bash
# Check Kerberos config
cat ~/.krb5.conf

# Check for tickets
klist

# If no tickets:
kinit username@YOUR-DOMAIN.COM
```

### Issue: "Connection timeout"

**Cause**: Network/firewall or wrong server name

**Solution**:
```bash
# Test network connectivity
ping your-sqlserver.your-domain.com

# Test SQL Server port
nc -zv your-sqlserver.your-domain.com 1433

# Check if server is reachable
nslookup your-sqlserver.your-domain.com
```

### Issue: "User does not have permission"

**Cause**: Your domain account doesn't have access to SQL Server

**Solution**: Ask your DBA to grant access:
```sql
-- On SQL Server (DBA runs this)
USE [LASSO];
CREATE LOGIN [DOMAIN\username] FROM WINDOWS;
CREATE USER [DOMAIN\username] FOR LOGIN [DOMAIN\username];
GRANT SELECT TO [DOMAIN\username];
GRANT VIEW DEFINITION TO [DOMAIN\username];
```

## Debugging Tips

### Enable Debug Logging

In `.env` or Claude config:
```env
LOG_LEVEL=debug
```

This shows:
- Kerberos ticket detection
- Connection attempts
- SQL queries
- Authentication method used

### Check Kerberos Ticket Details

```bash
# List all tickets with details
klist -v

# Check ticket expiration
klist | grep "Expires"

# Test Kerberos authentication
kvno MSSQLSvc/your-sqlserver.your-domain.com:1433
```

### Test SQL Connection Manually

```bash
# Using sqlcmd with Kerberos (if installed)
sqlcmd -S your-sqlserver.your-domain.com -E -Q "SELECT @@VERSION"

# Using Python (if you have pyodbc)
python3 << EOF
import pyodbc
conn = pyodbc.connect(
    'DRIVER={ODBC Driver 17 for SQL Server};'
    'SERVER=your-sqlserver.your-domain.com;'
    'Trusted_Connection=yes;'
)
print("✅ Connected!")
EOF
```

## Comparison: Authentication Methods

| Method | Platform | Setup | Security | Use Case |
|--------|----------|-------|----------|----------|
| **Kerberos** | macOS/Linux | Medium | High | ✅ Recommended for Mac |
| **NTLM** | Windows | Easy | Medium | Windows machines |
| **SQL Auth** | All | Easy | Low | Dev/test only |

## VS Code Connection Settings

For reference, your VS Code `settings.json` might look like:

```json
{
    "mssql.connections": [
        {
            "server": "your-sqlserver.your-domain.com",
            "database": "",
            "authenticationType": "Integrated",
            "profileName": "SQL Server"
        }
    ]
}
```

The MCP server uses the same authentication mechanism!

## Security Best Practices

1. **Never commit `.env` file** - Already in `.gitignore`
2. **Use ticket cache securely** - Kerberos stores tickets in `/tmp/krb5cc_*`
3. **Set ticket lifetime appropriately** - 10 hours is typical
4. **Use renewable tickets** - Allows refresh without password
5. **Destroy tickets when done** - `kdestroy` on shared machines

## Advanced: Multiple Domains

If you have multiple AD domains:

```ini
# ~/.krb5.conf
[realms]
    DOMAIN1.COM = {
        kdc = dc1.domain1.com
    }
    DOMAIN2.COM = {
        kdc = dc2.domain2.com
    }

[domain_realm]
    .domain1.com = DOMAIN1.COM
    .domain2.com = DOMAIN2.COM
```

Then:
```bash
# Get ticket for specific domain
kinit username@DOMAIN1.COM

# Connect to SQL Server in that domain
DB_SERVER=sqlserver.domain1.com
DB_DOMAIN=DOMAIN1.COM
```

## Quick Reference

```bash
# Get ticket
kinit username@DOMAIN.COM

# Check ticket
klist

# Renew ticket
kinit -R

# Destroy ticket
kdestroy

# Test connection
npm run build && node -e "require('./dist/db/connection').db.connect().then(() => console.log('OK'))"

# View logs
tail -f mcp-server.log
```

## Success Checklist

- ✅ `~/.krb5.conf` configured with your domain
- ✅ `kinit username@DOMAIN.COM` succeeds
- ✅ `klist` shows valid ticket
- ✅ `.env` has `DB_USE_KERBEROS=true`
- ✅ `DB_SERVER` uses FQDN
- ✅ `npm run build` succeeds
- ✅ Test connection works
- ✅ Claude Desktop config has absolute path
- ✅ Claude Desktop restarted
- ✅ Can query databases from Claude

## Next Steps

Once Kerberos auth works:
1. Test with: "Get table Players from LASSO database"
2. Try switching databases: "Now show me Teams from PRISM"
3. Search tables: "Find all tables in LASSO with 'Player' in the name"

You're all set! 🎉