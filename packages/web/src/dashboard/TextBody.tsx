import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { BlockEmpty } from './BlockState.js';
import type { ManifestItem } from './model.js';

const components: Components = {
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="overflow-auto">
        <table>{children}</table>
      </div>
    );
  },
};

export default function TextBody({ item }: { item: ManifestItem }) {
  const markdown = String((item.config as { markdown?: string } | null)?.markdown ?? '');
  if (!markdown.trim()) {
    return <BlockEmpty title="Empty note" hint="Add markdown in the block editor or the code panel." />;
  }

  return (
    <div className="md-body h-full overflow-auto pr-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
