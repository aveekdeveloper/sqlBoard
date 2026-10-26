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
  switch (item.blockType) {
    case 'metric':
      return <MetricBody item={item} filterValues={filterValues} />;
    case 'table':
      return <TableBody item={item} filterValues={filterValues} />;
    case 'text':
      return <TextBody item={item} />;
    default:
      return <ChartBody item={item} filterValues={filterValues} />;
  }
}
