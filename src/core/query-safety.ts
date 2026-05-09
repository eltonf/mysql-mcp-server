export interface QueryModificationResult {
  wasModified: boolean;
  modifiedQuery: string;
  modifications: string[];
  originalLimitValue?: number;
  appliedLimitValue: number;
}

export function validateQuerySafety(query: string): void {
  const normalizedQuery = query.trim().toUpperCase();
  const dangerousPatterns = [
    { pattern: /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|CREATE|ALTER|CALL|GRANT|REVOKE)\b/i, type: 'DML/DDL' },
    { pattern: /\b(LOAD\s+DATA|INTO\s+OUTFILE|INTO\s+DUMPFILE)\b/i, type: 'file access' },
    { pattern: /\bLOCK\s+TABLES\b/i, type: 'table lock' },
  ];

  for (const { pattern, type } of dangerousPatterns) {
    if (pattern.test(query)) {
      throw new Error(`Query contains forbidden ${type} operation. Only read-only SELECT queries are allowed.`);
    }
  }

  if (!normalizedQuery.startsWith('SELECT') && !normalizedQuery.startsWith('WITH')) {
    throw new Error('Query must start with SELECT or WITH. Only read-only SELECT queries are allowed.');
  }
}

export function enforceRowLimit(query: string, maxRows: number): QueryModificationResult {
  const trimmedQuery = query.trim().replace(/;+\s*$/, '');
  const modifications: string[] = [];
  const limitPattern = /\s+LIMIT\s+(\d+)(\s*,\s*\d+|\s+OFFSET\s+\d+)?\s*$/i;
  const limitMatch = trimmedQuery.match(limitPattern);

  if (!limitMatch) {
    modifications.push(`Added LIMIT ${maxRows} for safety`);
    return {
      wasModified: true,
      modifiedQuery: `${trimmedQuery} LIMIT ${maxRows}`,
      modifications,
      appliedLimitValue: maxRows,
    };
  }

  const originalLimitValue = Number.parseInt(limitMatch[1], 10);
  if (originalLimitValue > maxRows) {
    modifications.push(`Reduced LIMIT from ${originalLimitValue} to ${maxRows} (safety maximum)`);
    return {
      wasModified: true,
      modifiedQuery: trimmedQuery.replace(limitPattern, ` LIMIT ${maxRows}`),
      modifications,
      originalLimitValue,
      appliedLimitValue: maxRows,
    };
  }

  return {
    wasModified: false,
    modifiedQuery: trimmedQuery,
    modifications,
    originalLimitValue,
    appliedLimitValue: originalLimitValue,
  };
}
