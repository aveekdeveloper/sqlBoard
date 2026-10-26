import ChartBody from './ChartBody.js';
import MetricBody from './MetricBody.js';
import TableBody from './TableBody.js';
import TextBody from './TextBody.js';
import type { ManifestItem } from './model.js';

export default function BlockBody({ item }: { item: ManifestItem }) {
  switch (item.blockType) {
    case 'metric':
      return <MetricBody item={item} />;
    case 'table':
      return <TableBody item={item} />;
    case 'text':
      return <TextBody item={item} />;
    default:
      return <ChartBody item={item} />;
  }
}
