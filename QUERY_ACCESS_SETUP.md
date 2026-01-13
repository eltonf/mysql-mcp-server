# Query Access Control Setup

This guide explains how to configure table and column access control for the `execute_query` tool.

## Overview

Access control is **restrictive by default** - data queries are blocked until you configure which tables and columns the LLM can access. This prevents accidental exposure of sensitive data.

## Quick Start

1. Copy the example config:
   ```bash
   cp query-access.example.json query-access.json
   ```

2. Edit `query-access.json` to match your needs

3. Set the environment variable:
   ```bash
   QUERY_ACCESS_CONFIG=/path/to/query-access.json
   ```

4. Restart the MCP server

## Configuration Structure

The config uses a hierarchical structure: **database → schema → table → column**

```json
{
  "requireExplicitColumns": true,
  "databases": {
    "DATABASE_NAME": {
      "schemas": {
        "SCHEMA_NAME": {
          "tables": {
            "mode": "whitelist",
            "list": ["Table1", "Table2"],
            "columnExclusions": {
              "Table1": ["SensitiveColumn1", "SensitiveColumn2"]
            }
          }
        }
      }
    }
  }
}
```

## Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `requireExplicitColumns` | boolean | Yes | Block `SELECT *` and `table.*` syntax |
| `databases` | object | Yes | Map of database names to their configs |
| `schemas` | object | No | Map of schema names to their configs (use `"*"` for all schemas) |
| `tables.mode` | string | Yes | `"whitelist"`, `"blacklist"`, or `"none"` |
| `tables.list` | array | Yes | Table names for whitelist/blacklist |
| `columnExclusions` | object | No | Map of table names to arrays of excluded columns |

## Table Modes

| Mode | Behavior |
|------|----------|
| `whitelist` | Only tables in `list` can be queried |
| `blacklist` | Tables in `list` are blocked, all others allowed |
| `none` | No table restrictions (column exclusions still apply) |

## Examples

### Whitelist specific tables

Allow only certain tables to be queried:

```json
{
  "requireExplicitColumns": true,
  "databases": {
    "LASSO": {
      "schemas": {
        "dbo": {
          "tables": {
            "mode": "whitelist",
            "list": ["Player", "Team", "Game", "School"]
          }
        }
      }
    }
  }
}
```

### Blacklist sensitive tables

Block specific tables, allow everything else:

```json
{
  "requireExplicitColumns": true,
  "databases": {
    "LASSO": {
      "schemas": {
        "dbo": {
          "tables": {
            "mode": "blacklist",
            "list": ["AuditLog", "UserCredentials", "PaymentInfo"]
          }
        }
      }
    }
  }
}
```

### Exclude sensitive columns

Allow a table but hide specific columns:

```json
{
  "requireExplicitColumns": true,
  "databases": {
    "LASSO": {
      "schemas": {
        "dbo": {
          "tables": {
            "mode": "whitelist",
            "list": ["Player", "Coach", "Employee"],
            "columnExclusions": {
              "Player": ["SSN", "DateOfBirth", "MedicalInfo", "Grade"],
              "Coach": ["Salary", "SSN"],
              "Employee": ["Salary", "SSN", "HomeAddress"]
            }
          }
        }
      }
    }
  }
}
```

### Apply rules to all schemas

Use `"*"` to apply rules to every schema in a database:

```json
{
  "requireExplicitColumns": true,
  "databases": {
    "PRISM": {
      "schemas": {
        "*": {
          "tables": {
            "mode": "whitelist",
            "list": ["Player", "School", "Evaluation"]
          }
        }
      }
    }
  }
}
```

### Compact format (single database, all schemas)

For simpler setups, omit the `schemas` level:

```json
{
  "requireExplicitColumns": true,
  "databases": {
    "LASSO": {
      "tables": {
        "mode": "whitelist",
        "list": ["Player", "Team", "Game"]
      },
      "columnExclusions": {
        "Player": ["Grade", "Medical"]
      }
    }
  }
}
```

### Permissive mode (no restrictions)

To allow all queries on a database:

```json
{
  "requireExplicitColumns": false,
  "databases": {
    "LASSO": {
      "tables": {
        "mode": "none",
        "list": []
      }
    }
  }
}
```

## Error Messages

When access is denied, the LLM receives clear error messages:

| Scenario | Error Message |
|----------|---------------|
| No config | `Access control not configured. Data queries are blocked until QUERY_ACCESS_CONFIG is set.` |
| Unknown database | `Database 'X' is not configured for query access. Add it to QUERY_ACCESS_CONFIG.` |
| SELECT * | `SELECT * is not allowed. All SELECT statements must explicitly list columns.` |
| Table not allowed | `Table 'DB.schema.Table' is not in the allowed tables list.` |
| Blocked table | `Table 'DB.schema.Table' cannot be queried. This table is in the exclusion list.` |
| Excluded column | `Column 'X' from 'DB.schema.Table' cannot be selected.` |

## Troubleshooting

### "Access control not configured"

The `QUERY_ACCESS_CONFIG` environment variable is not set or the file doesn't exist.

**Fix:** Set the environment variable to point to your config file:
```bash
QUERY_ACCESS_CONFIG=/path/to/query-access.json
```

### "Database 'X' is not configured"

The database is not listed in your config file.

**Fix:** Add the database to your config:
```json
{
  "databases": {
    "YOUR_DATABASE": {
      "tables": { "mode": "whitelist", "list": ["..."] }
    }
  }
}
```

### "SELECT * is not allowed"

Your config has `requireExplicitColumns: true` and the query used `SELECT *`.

**Fix:** Either:
- Tell the LLM to list specific columns: `SELECT Name, TeamID FROM Player`
- Or set `"requireExplicitColumns": false` in your config

### LLM can't query a table I expected to work

Check that:
1. The table is in your whitelist (if using whitelist mode)
2. The table is NOT in your blacklist (if using blacklist mode)
3. The schema matches (or use `"*"` for all schemas)
4. Table names are case-insensitive but must match

## Best Practices

1. **Start restrictive** - Use whitelist mode and add tables as needed
2. **Always exclude sensitive columns** - SSN, salary, medical info, etc.
3. **Use `requireExplicitColumns: true`** - Prevents accidental data exposure via `SELECT *`
4. **One database at a time** - Configure and test each database before adding more
5. **Review the example** - See `query-access.example.json` for a real-world config
