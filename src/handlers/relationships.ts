import { cache } from '../core/cache.js';
import { resolveDatabase, resolveSchema } from '../core/config.js';
import { logger } from '../core/logger.js';
import {
  getRelationships as getMysqlRelationships,
  Relationship,
} from '../mysql/queries.js';

interface RelationshipPath {
  path: Relationship[];
  joinCondition: string;
}

export async function getRelationships(args: {
  database?: string;
  fromTable: string;
  toTable?: string;
  maxDepth?: number;
  schema?: string;
}): Promise<RelationshipPath[]> {
  const database = resolveDatabase(args.database);
  resolveSchema(args.schema);
  const { fromTable, toTable, maxDepth = 2 } = args;

  const cacheKey = `relationships:${database}:${fromTable}:${toTable || 'all'}:${maxDepth}`;
  const cached = cache.get<RelationshipPath[]>(cacheKey);
  if (cached) {
    return cached;
  }

  const relationships = await getMysqlRelationships();
  const paths = toTable
    ? findPaths(fromTable, toTable, relationships, maxDepth)
    : relationships
        .filter((rel) => rel.fromTable === fromTable || rel.toTable === fromTable)
        .map((rel) => ({
          path: [rel],
          joinCondition: buildJoinCondition([rel]),
        }));

  cache.set(cacheKey, paths);
  logger.info(`Found ${paths.length} relationship path(s) for ${fromTable}`);
  return paths;
}

function findPaths(
  fromTable: string,
  toTable: string,
  relationships: Relationship[],
  maxDepth: number,
): RelationshipPath[] {
  const paths: RelationshipPath[] = [];
  const visited = new Set<string>();

  function dfs(currentTable: string, currentPath: Relationship[], depth: number): void {
    if (depth > maxDepth) {
      return;
    }

    if (currentTable === toTable && currentPath.length > 0) {
      paths.push({
        path: [...currentPath],
        joinCondition: buildJoinCondition(currentPath),
      });
      return;
    }

    visited.add(currentTable);

    for (const rel of relationships) {
      if (rel.fromTable === currentTable && !visited.has(rel.toTable)) {
        currentPath.push(rel);
        dfs(rel.toTable, currentPath, depth + 1);
        currentPath.pop();
      }

      if (rel.toTable === currentTable && !visited.has(rel.fromTable)) {
        currentPath.push(rel);
        dfs(rel.fromTable, currentPath, depth + 1);
        currentPath.pop();
      }
    }

    visited.delete(currentTable);
  }

  dfs(fromTable, [], 0);
  return paths;
}

function buildJoinCondition(path: Relationship[]): string {
  if (path.length === 0) {
    return '';
  }

  const conditions: string[] = [];
  let currentTable = path[0].fromTable;

  for (const rel of path) {
    if (rel.fromTable === currentTable) {
      conditions.push(
        `JOIN ${rel.toTable} ON ${rel.fromTable}.${rel.fromColumn} = ${rel.toTable}.${rel.toColumn}`,
      );
      currentTable = rel.toTable;
    } else {
      conditions.push(
        `JOIN ${rel.fromTable} ON ${rel.toTable}.${rel.toColumn} = ${rel.fromTable}.${rel.fromColumn}`,
      );
      currentTable = rel.fromTable;
    }
  }

  return conditions.join('\n');
}
