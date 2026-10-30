import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router-dom';

const SECTIONS = [
  {
    id: 'quickstart',
    title: 'Quick start',
    body: `## Quick start

1. Connect data: \`POST /api/connections\`
2. Run SQL: \`POST /api/connections/:id/query\`
3. Compile chart: \`POST /api/compile\`
4. Create dashboard: \`POST /api/dashboards\`
5. Apply blocks: \`PUT /api/dashboards/:id/state\`
6. Commit version: \`POST /api/dashboards/:id/versions\`

Authenticate with \`Authorization: Bearer sb_...\`. Writes require member role.`,
  },
  {
    id: 'chart',
    title: 'Chart grammar',
    body: `## Chart grammar (SQL annotations)

\`\`\`sql
-- @viz: bar | line | area | scatter | pie | heatmap
-- @x: column
-- @y: column
-- @groupby: column
-- @stack: true | false | name
-- @title: Title
-- @theme: powerbi-light | nyt | economist
-- @colors: #006BA2, #DB444B
-- @semantic: col: Type, other: Type
-- @xFormat: compact
-- @yFormat: number
-- @timeFormat: %Y-%m
-- @rotate: 45
-- @xRotate: 45
-- @yRotate: 0
-- @barWidth: 20
-- @flint: { "chart_spec": { "title": "Custom" } }
\`\`\`

sql-to-flint ships 37 templates: Bar Chart, Grouped Bar Chart, Stacked Bar Chart, Line Chart, Area Chart, Scatter Plot, Pie Chart, Heatmap, Funnel Chart, Treemap, Sunburst Chart, Radar Chart, Gauge Chart, Sankey Diagram, Network Graph, and more. Use \`-- @viz: <template name>\`.`,
  },
  {
    id: 'dashboard',
    title: 'Dashboard manifest',
    body: `## Dashboard manifest

\`\`\`sql
-- @dashboard: My Dashboard
-- @description: Optional description
-- @grid: 12
-- @theme: powerbi-light
-- @colors: #006BA2, #DB444B

-- @filter: Region
-- @type: select
-- @connection: 1
-- @sql: SELECT DISTINCT region FROM sales ORDER BY region
-- @default: NA

-- @block: Revenue by Month
-- @type: chart
-- @layout: 0,0,6,4
-- @connection: 1
SELECT month, SUM(revenue) AS revenue FROM sales GROUP BY month;

-- @block: Total Revenue
-- @type: metric
-- @layout: 6,0,3,3
-- @connection: 1
-- @metric: revenue
-- @format: currency
SELECT SUM(revenue) AS revenue FROM sales;

-- @block: Top Products
-- @type: table
-- @layout: 0,4,6,5
-- @connection: 1
-- @columns: product, sales
-- @pageSize: 10
SELECT product, SUM(sales) AS sales FROM products GROUP BY product;

-- @block: Notes
-- @type: text
-- @layout: 6,4,6,5
/*
Markdown notes here.
*/
\`\`\`

Filter SQL contract: \`WHERE ({FilterName} IS NULL OR col = {FilterName})\`. "All" maps to \`NULL\`.`,
  },
  {
    id: 'metric',
    title: 'Metric & table config',
    body: `## Metric config

\`\`\`sql
-- @metric: column
-- @prior: column
-- @sparkline: column
-- @format: number | currency | percent | compact
-- @higherIsBetter: true
-- @target: 100
-- @targetDirection: above | below
-- @targetAmber: 80
-- @targetRed: 50
\`\`\`

## Table config

\`\`\`sql
-- @columns: col1, col2
-- @pageSize: 10
-- @density: comfortable | compact
-- @maxRows: 1000
-- @format: col: currency, other: number
-- @rowNumbers: true
\`\`\``,
  },
];

export default function Docs() {
  const [active, setActive] = useState('quickstart');
  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  return (
    <div className="min-h-screen bg-paper">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <Link to="/" className="font-semibold text-ink">sqlboard</Link>
        <span className="text-[12px] text-ink-muted">Docs</span>
      </header>
      <div className="mx-auto flex max-w-5xl gap-6 p-4 md:p-6">
        <nav className="hidden w-48 shrink-0 space-y-1 md:block">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={`block w-full rounded-md px-3 py-2 text-left text-[12.5px] font-medium ${
                active === s.id ? 'bg-accent-soft text-accent-ink' : 'text-ink-muted hover:bg-[#f1eee7] hover:text-ink'
              }`}
            >
              {s.title}
            </button>
          ))}
        </nav>
        <main className="min-w-0 flex-1">
          <div className="mb-4 flex gap-2 overflow-x-auto md:hidden">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                className={`shrink-0 rounded-md px-3 py-1.5 text-[12px] font-medium ${
                  active === s.id ? 'bg-accent-soft text-accent-ink' : 'text-ink-muted hover:bg-[#f1eee7]'
                }`}
              >
                {s.title}
              </button>
            ))}
          </div>
          <article className="prose prose-sm max-w-none">
            <ReactMarkdown>{section.body}</ReactMarkdown>
          </article>
        </main>
      </div>
    </div>
  );
}