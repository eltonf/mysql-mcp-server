# Testing SQL Server MCP Tools Locally

## Prerequisites

1. **SQL Server Access**
   - SQL Server instance running (local or remote)
   - At least one database with tables (e.g., LASSO, PRISM)
   - Credentials with read access to system catalog views

2. **Node.js Environment**
   - Node.js >= 18.0.0
   - npm installed

## Setup Steps

### 1. Configure Environment

Copy the example environment file:
```bash
cp .env.example .env
```

Edit `.env` with your SQL Server credentials:
```env
# For SQL Server Authentication
DB_SERVER=localhost
DB_USER=your_username
DB_PASSWORD=your_password
DB_TRUSTED_CONNECTION=false

# OR for Windows Authentication
DB_SERVER=localhost
DB_DOMAIN=YOUR_DOMAIN
DB_TRUSTED_CONNECTION=true

# Optional settings
CACHE_TTL=3600
CACHE_ENABLED=true
LOG_LEVEL=debug
```

**Note**: Do NOT specify `DB_DATABASE` - you'll specify the database in each tool call!

### 2. Install Dependencies

```bash
npm install
```

### 3. Build the Project

```bash
npm run build
```

## Testing Methods

### Method 1: Direct MCP Server Test (Recommended)

This tests the MCP server directly using stdio.

**Create a test script** `test-server.js`:

```javascript
const { spawn } = require('child_process');
const readline = require('readline');

// Start the MCP server
const server = spawn('node', ['dist/index.js'], {
  env: { ...process.env },
  stdio: ['pipe', 'pipe', 'pipe']
});

const rl = readline.createInterface({
  input: server.stdout,
  crlfDelay: Infinity
});

// Listen for responses
rl.on('line', (line) => {
  console.log('Server response:', line);
});

server.stderr.on('data', (data) => {
  console.error('Server error:', data.toString());
});

// Send a list_tools request
const listToolsRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list'
};

server.stdin.write(JSON.stringify(listToolsRequest) + '\n');

// Send a get_table_info request
setTimeout(() => {
  const getTableRequest = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'get_table_info',
      arguments: {
        database: 'LASSO',  // Change to your database
        table: 'Players',    // Change to your table
        schema: 'dbo'
      }
    }
  };

  server.stdin.write(JSON.stringify(getTableRequest) + '\n');
}, 1000);

// Cleanup after 5 seconds
setTimeout(() => {
  server.kill();
  process.exit(0);
}, 5000);
```

Run it:
```bash
node test-server.js
```

### Method 2: Create Unit Tests

**Create** `test/connection.test.ts`:

```typescript
import { db } from '../src/db/connection';

async function testConnection() {
  try {
    console.log('Testing SQL Server connection...');
    const pool = await db.connect();
    console.log('✅ Connected successfully');

    // Test query
    const result = await db.query('SELECT @@VERSION AS Version');
    console.log('✅ SQL Server Version:', result.recordset[0].Version);

    await db.close();
    console.log('✅ Connection closed');
  } catch (error) {
    console.error('❌ Connection failed:', error);
    process.exit(1);
  }
}

testConnection();
```

Run it:
```bash
npx tsx test/connection.test.ts
```

### Method 3: Test Individual Handlers

**Create** `test/handlers.test.ts`:

```typescript
import { getTableInfo, getSchema } from '../src/handlers/schema';
import { findTables } from '../src/handlers/search';

async function testHandlers() {
  try {
    // Test 1: Get single table info
    console.log('\n📋 Test 1: Get table info from LASSO database');
    const tableInfo = await getTableInfo({
      database: 'LASSO',
      table: 'Players',  // Change to your table
      schema: 'dbo'
    });
    console.log('✅ Retrieved table:', tableInfo.name);
    console.log('   Columns:', tableInfo.columns.length);

    // Test 2: Get schema for multiple tables
    console.log('\n📋 Test 2: Get schema for multiple tables');
    const schema = await getSchema({
      database: 'LASSO',
      tables: ['Players', 'Teams'],  // Change to your tables
      schema: 'dbo',
      includeRelationships: true
    });
    console.log('✅ Retrieved schema for', schema.schema.length, 'tables');

    // Test 3: Find tables by pattern
    console.log('\n📋 Test 3: Find tables with pattern');
    const tables = await findTables({
      database: 'LASSO',
      pattern: 'tbl*',
      schema: 'dbo'
    });
    console.log('✅ Found', tables.length, 'tables matching pattern');

    // Test 4: Switch databases
    console.log('\n📋 Test 4: Switch to PRISM database');
    const prismTables = await findTables({
      database: 'PRISM',  // Different database!
      schema: 'dbo'
    });
    console.log('✅ Found', prismTables.length, 'tables in PRISM');

    console.log('\n✅ All tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testHandlers();
```

Run it:
```bash
npx tsx test/handlers.test.ts
```

### Method 4: Test with Claude Desktop

1. **Add to Claude Desktop config** (`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac):

```json
{
  "mcpServers": {
    "sql-server-tools": {
      "command": "node",
      "args": ["/absolute/path/to/sql-server-mcp/dist/index.js"],
      "env": {
        "DB_SERVER": "localhost",
        "DB_USER": "your_username",
        "DB_PASSWORD": "your_password",
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

2. **Restart Claude Desktop**

3. **Test in Claude**:
   - "Get the table definition for Players in LASSO"
   - "Show me all tables in PRISM database"
   - "What's the schema for Teams table in LASSO?"

### Method 5: Manual SQL Query Test

Test the inline SQL queries directly:

```sql
-- This is what the tool generates internally
USE [LASSO];

DECLARE @ObjectId INT = OBJECT_ID('[dbo].[Players]');

SELECT (
  SELECT
    'dbo' AS 'schema',
    'Players' AS 'table',
    CASE WHEN o.type = 'U' THEN 'TABLE' WHEN o.type = 'V' THEN 'VIEW' END AS 'type',
    (
      SELECT
        c.name AS 'name',
        TYPE_NAME(c.user_type_id) AS 'dataType',
        c.is_nullable AS 'nullable'
      FROM sys.columns c
      WHERE c.object_id = @ObjectId
      ORDER BY c.column_id
      FOR JSON PATH
    ) AS 'columns'
  FROM sys.objects o
  WHERE o.object_id = @ObjectId
  FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS JsonResult;
```

Run this in **SQL Server Management Studio** or **Azure Data Studio** to verify:
- Your credentials work
- The database exists
- Tables are accessible
- JSON output is generated correctly

## Common Test Scenarios

### Scenario 1: Test Database Switching

```typescript
// Query LASSO
const lassoTable = await getTableInfo({
  database: 'LASSO',
  table: 'Players'
});
console.log('LASSO table:', lassoTable.name);

// Query PRISM (different database!)
const prismTable = await getTableInfo({
  database: 'PRISM',
  table: 'Teams'
});
console.log('PRISM table:', prismTable.name);

// Query master (system database)
const masterTable = await getTableInfo({
  database: 'master',
  table: 'spt_values'
});
console.log('Master table:', masterTable.name);
```

### Scenario 2: Test Without Stored Procedures

This should work on **any** SQL Server:

```typescript
const result = await getTableInfo({
  database: 'tempdb',  // Built-in database
  table: 'spt_values', // System table (exists in master, but testing)
  schema: 'dbo'
});
// Should work without any setup!
```

### Scenario 3: Test Caching

```typescript
console.time('First call');
await getTableInfo({ database: 'LASSO', table: 'Players' });
console.timeEnd('First call');

console.time('Cached call');
await getTableInfo({ database: 'LASSO', table: 'Players' });
console.timeEnd('Cached call');
// Second call should be much faster
```

## Troubleshooting

### Issue: "Login failed for user"

**Solution**: Check your credentials in `.env`:
```bash
# Test connection with sqlcmd
sqlcmd -S localhost -U your_username -P your_password -Q "SELECT @@VERSION"
```

### Issue: "Database does not exist"

**Solution**: Verify database name:
```sql
-- List all databases
SELECT name FROM sys.databases;
```

### Issue: "Cannot open database requested in login"

**Solution**: User doesn't have access to that database:
```sql
-- Grant access
USE [LASSO];
CREATE USER [your_username] FOR LOGIN [your_username];
GRANT SELECT TO [your_username];
```

### Issue: "Connection timeout"

**Solution**: Check SQL Server is running and accessible:
```bash
# Test network connectivity
ping your_server

# Test SQL Server port (default 1433)
telnet your_server 1433
```

### Issue: "Invalid object name 'sys.tables'"

**Solution**: You don't have permission to read system views:
```sql
-- Grant view definition permission
GRANT VIEW DEFINITION TO [your_username];
```

## Debugging Tips

### Enable Debug Logging

In `.env`:
```env
LOG_LEVEL=debug
```

This will show:
- Connection attempts
- SQL queries being executed
- Query results
- Cache hits/misses

### View Logs

Check the log files:
```bash
tail -f mcp-server.log
tail -f error.log
```

### Test Raw SQL

Copy the generated SQL from logs and run in SSMS to debug:

```sql
-- Enable query results as text
-- Run the generated query
-- Check for errors
```

## Success Criteria

✅ **Connection works**: `npm start` runs without errors
✅ **Queries execute**: Test script returns data
✅ **Database switching works**: Can query LASSO, then PRISM
✅ **No setup required**: Works without stored procedures
✅ **Caching works**: Second call is faster
✅ **Claude Desktop integration**: Tools appear in Claude

## Next Steps

Once local testing works:
1. Configure Claude Desktop (Method 4)
2. Test with real queries
3. Monitor performance
4. Adjust cache settings if needed

## Quick Start Script

Save this as `quick-test.sh`:

```bash
#!/bin/bash

echo "🧪 SQL Server MCP Tools - Quick Test"
echo "===================================="
echo ""

# Check environment
if [ ! -f .env ]; then
  echo "❌ .env file not found. Copy .env.example to .env first."
  exit 1
fi

# Build
echo "📦 Building..."
npm run build || exit 1

# Test connection
echo ""
echo "🔌 Testing SQL Server connection..."
node -e "
const { db } = require('./dist/db/connection.js');
db.connect()
  .then(() => console.log('✅ Connection successful'))
  .catch(err => {
    console.error('❌ Connection failed:', err.message);
    process.exit(1);
  });
"

echo ""
echo "✅ All tests passed! Ready to use."
echo ""
echo "Next steps:"
echo "1. Configure Claude Desktop with your path"
echo "2. Restart Claude Desktop"
echo "3. Ask Claude to query your databases"
```

Make it executable:
```bash
chmod +x quick-test.sh
./quick-test.sh
```

## Example Test Output

```
🧪 SQL Server MCP Tools - Quick Test
====================================

📦 Building...
> tsc
✅ Build successful

🔌 Testing SQL Server connection...
✅ Connection successful
✅ Connected to: Microsoft SQL Server 2019

📋 Testing handlers...
✅ Retrieved table: Players (15 columns)
✅ Retrieved schema for 2 tables
✅ Found 8 tables matching pattern
✅ Switched to PRISM database successfully

✅ All tests passed! Ready to use.
```