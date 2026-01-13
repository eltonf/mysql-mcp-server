#!/bin/bash
# SQL Server MCP User Setup Script
# Usage: ./scripts/setup-user.sh [--verbose]
# Sources .env file for configuration

set -e

# Default options
VERBOSE=0

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -v|--verbose) VERBOSE=1; shift ;;
        -h|--help)
            echo "Usage: ./scripts/setup-user.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -v, --verbose  Show detailed output"
            echo "  -h, --help     Show this help message"
            exit 0
            ;;
        *) echo "Unknown option: $1. Use --help for usage."; exit 1 ;;
    esac
done

# Change to project root directory
cd "$(dirname "$0")/.."

# Source .env file
if [ -f .env ]; then
    # shellcheck source=/dev/null
    source .env
else
    echo "Error: .env file not found. Copy .env.example to .env and configure it."
    exit 1
fi

# Validate required vars
: "${DB_SERVER:?DB_SERVER is required in .env}"
: "${DB_USER:?DB_USER is required in .env}"
: "${DB_PASSWORD:?DB_PASSWORD is required in .env}"
: "${DB_DATABASE_LIST:?DB_DATABASE_LIST is required in .env}"

# Determine which script to run based on SCHEMA_ONLY_MODE
if [ "$SCHEMA_ONLY_MODE" = "true" ]; then
    SCRIPT="Setup-Schema-User.sql"
    ACCESS_TYPE="schema-only"
else
    SCRIPT="Setup-Full-User.sql"
    ACCESS_TYPE="full"
fi

echo "SQL Server MCP User Setup"
echo "========================="
echo "Server: $DB_SERVER"
echo "Login: $DB_USER"
echo "Access: $ACCESS_TYPE"
echo "Databases: $DB_DATABASE_LIST"
echo ""

sqlcmd -S "$DB_SERVER" -E -C -i "$SCRIPT" \
    -v LoginName="$DB_USER" \
    -v Password="$DB_PASSWORD" \
    -v DatabaseList="$DB_DATABASE_LIST" \
    -v Verbose="$VERBOSE"
