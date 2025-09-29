#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { config } from 'dotenv';
import { db } from './db/connection.js';
import { logger } from './utils/logger.js';
import { getSchema, getTableInfo } from './handlers/schema.js';
import { findTables } from './handlers/search.js';
import { getRelationships } from './handlers/relationships.js';
import { generateQuery } from './handlers/query.js';
import { validateDatabaseObject } from './handlers/validation.js';

config();

const SERVER_NAME = process.env.MCP_SERVER_NAME || 'sql-server-tools';
const SERVER_VERSION = process.env.MCP_SERVER_VERSION || '1.0.0';

// Define available tools
const tools: Tool[] = [
  {
    name: 'get_schema',
    description: 'Retrieves comprehensive schema information for one or more tables in a single efficient query. PREFERRED for batch operations - much faster than multiple get_table_info calls. Returns full table metadata including columns, data types, primary keys, foreign keys, indexes, and constraints. Example: tables=["Player", "PlayerAgent", "PlayerTeam"] gets all three tables in one query.',
    inputSchema: {
      type: 'object',
      properties: {
        database: {
          type: 'string',
          description: 'Database name (e.g., "LASSO", "PRISM")',
        },
        tables: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of table names to retrieve. For best performance with multiple tables, pass them all here instead of making separate calls. Leave empty to get all tables in schema.',
        },
        schema: {
          type: 'string',
          description: 'Database schema name (default: "dbo")',
          default: 'dbo',
        },
        includeRelationships: {
          type: 'boolean',
          description: 'Include foreign key relationships (default: true)',
          default: true,
        },
        includeStatistics: {
          type: 'boolean',
          description: 'Include table statistics like row counts and sizes (default: false)',
          default: false,
        },
      },
      required: ['database'],
    },
  },
  {
    name: 'get_table_info',
    description: 'Quick lookup for a single table. For multiple tables, use get_schema with tables array instead - it\'s much faster (one query vs N queries). IMPORTANT: If you get an error about table not found, use validate_objects first to find the correct table name.',
    inputSchema: {
      type: 'object',
      properties: {
        database: {
          type: 'string',
          description: 'Database name (e.g., "LASSO", "PRISM")',
        },
        table: {
          type: 'string',
          description: 'Table name',
        },
        schema: {
          type: 'string',
          description: 'Database schema name (default: "dbo")',
          default: 'dbo',
        },
      },
      required: ['database', 'table'],
    },
  },
  {
    name: 'find_tables',
    description: 'Search for tables by name pattern or containing specific columns. Returns list of table names with schema, row counts, and create dates. Examples: pattern="*player*" finds all tables with "player" in the name, hasColumn="PlayerID" finds tables with that column.',
    inputSchema: {
      type: 'object',
      properties: {
        database: {
          type: 'string',
          description: 'Database name (e.g., "LASSO", "PRISM")',
        },
        pattern: {
          type: 'string',
          description: 'Table name pattern using wildcards: * (any characters) or ? (single character). Examples: "*player*", "tbl*", "dict*". Case-insensitive.',
        },
        hasColumn: {
          type: 'string',
          description: 'Find tables containing this column name (exact match, case-insensitive)',
        },
        schema: {
          type: 'string',
          description: 'Filter by schema name (default: search all schemas)',
        },
      },
      required: ['database'],
    },
  },
  {
    name: 'get_relationships',
    description: 'Map relationships between tables for JOIN path discovery.',
    inputSchema: {
      type: 'object',
      properties: {
        database: {
          type: 'string',
          description: 'Database name (e.g., "LASSO", "PRISM")',
        },
        fromTable: {
          type: 'string',
          description: 'Source table name',
        },
        toTable: {
          type: 'string',
          description: 'Target table name (optional - if not provided, returns all relationships from source table)',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum relationship traversal depth (default: 2)',
          default: 2,
        },
        schema: {
          type: 'string',
          description: 'Database schema name (default: "dbo")',
          default: 'dbo',
        },
      },
      required: ['database', 'fromTable'],
    },
  },
  {
    name: 'generate_query',
    description: 'Generate SQL query from natural language description. Returns query template with explanation.',
    inputSchema: {
      type: 'object',
      properties: {
        database: {
          type: 'string',
          description: 'Database name (e.g., "LASSO", "PRISM")',
        },
        description: {
          type: 'string',
          description: 'Natural language description of the desired query',
        },
        tables: {
          type: 'array',
          items: { type: 'string' },
          description: 'Hint about relevant tables (optional)',
        },
        outputFormat: {
          type: 'string',
          enum: ['sql', 'json'],
          description: 'Output format (default: "sql")',
          default: 'sql',
        },
        schema: {
          type: 'string',
          description: 'Database schema name (default: "dbo")',
          default: 'dbo',
        },
      },
      required: ['database', 'description'],
    },
  },
  {
    name: 'validate_objects',
    description: 'Validates that database, schema, and table names exist. Provides helpful suggestions and fuzzy matching if names are misspelled, case is incorrect, or plural/singular. ALWAYS use this FIRST when you get "not found" errors from other tools. Example: if "Players" fails, this will suggest "Player".',
    inputSchema: {
      type: 'object',
      properties: {
        database: {
          type: 'string',
          description: 'Database name to validate (e.g., "LASSO", "PRISM")',
        },
        table: {
          type: 'string',
          description: 'Table name to validate (optional)',
        },
        schema: {
          type: 'string',
          description: 'Schema name to validate (optional, default: "dbo")',
        },
      },
      required: ['database'],
    },
  },
];

// Create server instance
const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    logger.info(`Tool called: ${name}`, args);

    switch (name) {
      case 'get_schema': {
        const result = await getSchema(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_table_info': {
        const result = await getTableInfo(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'find_tables': {
        const result = await findTables(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_relationships': {
        const result = await getRelationships(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'generate_query': {
        const result = await generateQuery(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'validate_objects': {
        const result = await validateDatabaseObject(
          (args as any).database,
          (args as any).table,
          (args as any).schema
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    logger.error(`Error executing tool ${name}:`, error);

    // If error has validation details, return them in a user-friendly format
    if (error.validation) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: error.message,
              suggestions: error.validation.table?.suggestions || error.validation.database?.suggestions || [],
              availableObjects: error.validation.table?.tables || error.validation.database?.databases || [],
              validationDetails: error.validation
            }, null, 2),
          },
        ],
        isError: true,
      };
    }

    // Return regular error
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message || String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  try {
    // Test database connection
    await db.connect();
    logger.info('Database connection established');

    // Start MCP server
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info(`${SERVER_NAME} v${SERVER_VERSION} started`);
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  await db.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down...');
  await db.close();
  process.exit(0);
});

main();