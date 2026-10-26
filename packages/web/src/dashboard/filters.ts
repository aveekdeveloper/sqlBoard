export type FilterValue = string | number | null | Array<string | number>;

export function escapeSqlLiteral(value: string | number | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${value.replace(/'/g, "''")}'`;
}

export function applyFilters(sql: string, values: Record<string, FilterValue>): string {
  return sql.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => {
    const value = values[name];
    if (value === undefined) return match;
    if (Array.isArray(value)) {
      if (value.length === 0) return '(NULL)';
      return `(${value.map((item) => escapeSqlLiteral(item as string | number | null)).join(', ')})`;
    }
    return escapeSqlLiteral(value as string | number | null);
  });
}

export function extractFilterRefs(sql: string): string[] {
  const refs = new Set<string>();
  for (const match of sql.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
    refs.add(match[1]);
  }
  return [...refs];
}

export function formatFilterValue(value: FilterValue): string {
  if (value === null) return 'All';
  if (Array.isArray(value)) return value.length === 0 ? 'All' : value.join(', ');
  return String(value);
}