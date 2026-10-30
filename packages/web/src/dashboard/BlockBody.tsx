import ChartBody from './ChartBody.js';
import MetricBody from './MetricBody.js';
import TableBody from './TableBody.js';
import TextBody from './TextBody.js';
import type { ManifestItem } from './model.js';

import type { FilterValue } from './filters.js';

export default function BlockBody({
  item,
  filters,
  filterValues,
}: {
  item: ManifestItem;
  filters?: any[];
  filterValues?: Record<string, FilterValue>;
}) {
  const effectiveFilterValues =
    filterValues && Object.keys(filterValues).length > 0
      ? filterValues
      : Object.fromEntries((filters ?? []).map((f: any) => [f.name, f.defaultValue ?? null]));
  switch (item.blockType) {
    case 'metric':
      return <MetricBody item={item} filterValues={effectiveFilterValues} />;
    case 'table':
      return <TableBody item={item} filterValues={effectiveFilterValues} />;
    case 'text':
      return <TextBody item={item} />;
    default:
      return <ChartBody item={item} filterValues={effectiveFilterValues} />;
  }
}
