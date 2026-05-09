export function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/g, '``')}\``;
}

export function likePattern(pattern?: string): string | null {
  if (!pattern) {
    return null;
  }
  return pattern.replace(/\*/g, '%').replace(/\?/g, '_');
}
