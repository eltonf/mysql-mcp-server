import winston from 'winston';

const logLevel = process.env.LOG_LEVEL || 'info';
const logFile = process.env.LOG_FILE || 'mcp-server.log';

// When running as MCP server, stdout is reserved for JSON-RPC protocol
// All logging must go to files only, never to console
export const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: logFile }),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
  ],
});