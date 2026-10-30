const path = require('path');
const dataDir = process.env.DATA_DIR || './data';
const { loadConfig } = require('../dist/config.js');
// use dynamic import in async
(async () => {
  const { openDatabase } = await import('../dist/db/client.js');
  const { eq } = await import('drizzle-orm');
  const { dashboards, dashboardItems, connections } = await import('../dist/db/schema.js');
  const { applyDashboardState } = await import('../dist/core/dashboard-service.js');
  const config = loadConfig();
  const { db } = await openDatabase(config);
  const tenantId = '00000000-0000-0000-0000-000000000000';

  // find duckdb connection
  const conns = await db.select().from(connections);
  const duck = conns.find((c) => c.type === 'duckdb');
  if (!duck) { console.error('No DuckDB connection found. Run seed first.'); process.exit(1); }
  const C = duck.id;

  // Ingest geo sample into DuckDB
  const duckdb = require('duckdb');
  const duckPath = require('path').join(dataDir, 'sqlboard.duckdb');
  const duckDb = new duckdb.Database(duckPath);
  const duckConn = duckDb.connect();
  function runSql(sql) { return new Promise((resolve, reject) => { duckConn.run(sql, (err) => err ? reject(err) : resolve()); }); }
  await runSql('DROP TABLE IF EXISTS geo_points');
  await runSql('CREATE TABLE geo_points (city VARCHAR, country VARCHAR, latitude DOUBLE, longitude DOUBLE, value DOUBLE)');
  const geoRows = [
    ['New York','USA',40.7128,-74.006,120],
    ['London','UK',51.5074,-0.1278,95],
    ['Tokyo','Japan',35.6762,139.6503,110],
    ['Sydney','Australia',-33.8688,151.2093,80],
    ['Sao Paulo','Brazil',-23.5505,-46.6333,70],
    ['Cairo','Egypt',30.0444,31.2357,60],
    ['Mumbai','India',19.076,72.8777,85],
    ['Berlin','Germany',52.52,13.405,75],
  ];
  for (const r of geoRows) {
    await runSql(`INSERT INTO geo_points VALUES ('${r[0]}','${r[1]}',${r[2]},${r[3]},${r[4]})`);
  }
  await new Promise((resolve) => duckDb.close(resolve));

  // skip if exists
  const existing = await db.select().from(dashboards);
  if (existing.find((d) => d.name === 'Viz Showcase')) {
    console.log('Viz Showcase already exists, skipping.');
    process.exit(0);
  }

  const now = new Date().toISOString();
  const [inserted] = await db.insert(dashboards).values({
    name: 'Viz Showcase',
    description: 'Sample visualizations covering many chart types',
    tenantId,
    createdAt: now,
    updatedAt: now,
  }).returning();

  const items = [
    { title: 'Revenue by Month (Bar)', sql: '-- @viz: bar\n-- @x: month\n-- @y: revenue\n-- @groupby: region\n-- @stack: true\n-- @theme: powerbi-light\nSELECT month, region, SUM(revenue) AS revenue FROM sales GROUP BY month, region ORDER BY month, region;', blockType: 'chart', layout: { x: 0, y: 0, w: 6, h: 4 } },
    { title: 'User Growth (Line)', sql: '-- @viz: line\n-- @x: month\n-- @y: users\n-- @groupby: region\nSELECT month, region, SUM(users) AS users FROM users GROUP BY month, region ORDER BY month, region;', blockType: 'chart', layout: { x: 6, y: 0, w: 6, h: 4 } },
    { title: 'Revenue Trend (Area)', sql: '-- @viz: area\n-- @x: month\n-- @y: revenue\nSELECT month, SUM(revenue) AS revenue FROM sales GROUP BY month ORDER BY month;', blockType: 'chart', layout: { x: 0, y: 4, w: 6, h: 4 } },
    { title: 'Revenue vs Users (Scatter)', sql: '-- @viz: scatter\n-- @x: revenue\n-- @y: users\nSELECT revenue, users FROM sales s JOIN users u ON s.month=u.month AND s.region=u.region;', blockType: 'chart', layout: { x: 6, y: 4, w: 6, h: 4 } },
    { title: 'Sales by Category (Pie)', sql: '-- @viz: pie\n-- @x: category\n-- @y: sales\nSELECT category, SUM(sales) AS sales FROM products GROUP BY category;', blockType: 'chart', layout: { x: 0, y: 8, w: 4, h: 4 } },
    { title: 'Revenue Waterfall', sql: '-- @viz: waterfall\n-- @x: month\n-- @y: revenue\nSELECT month, SUM(revenue) AS revenue FROM sales GROUP BY month ORDER BY month;', blockType: 'chart', layout: { x: 4, y: 8, w: 4, h: 4 } },
    { title: 'Total Revenue (Gauge)', sql: '-- @viz: gauge\n-- @size: revenue\nSELECT SUM(revenue) AS revenue FROM sales;', blockType: 'chart', layout: { x: 8, y: 8, w: 4, h: 4 } },
    { title: 'Sales Radar', sql: '-- @viz: radar chart\n-- @x: category\n-- @y: sales\nSELECT category, SUM(sales) AS sales FROM products GROUP BY category;', blockType: 'chart', layout: { x: 0, y: 12, w: 6, h: 4 } },
    { title: 'Total Revenue (Metric)', sql: '-- @metric: revenue\n-- @format: currency\nSELECT SUM(revenue) AS revenue FROM sales;', blockType: 'metric', config: { metricColumn: 'revenue', format: 'currency' }, layout: { x: 6, y: 12, w: 3, h: 3 } },
    { title: 'Total Users (Metric)', sql: '-- @metric: users\n-- @format: number\nSELECT SUM(users) AS users FROM users;', blockType: 'metric', config: { metricColumn: 'users', format: 'number' }, layout: { x: 9, y: 12, w: 3, h: 3 } },
    { title: 'Geo Values (Map)', sql: '-- @viz: map\nSELECT city, country, latitude, longitude, value FROM geo_points;', blockType: 'chart', config: { viz: 'map' }, layout: { x: 0, y: 15, w: 12, h: 6 } },
  ].map((it) => ({
    title: it.title,
    sql: it.sql,
    connectionId: C,
    blockType: it.blockType,
    config: it.config ?? null,
    layout: it.layout,
    savedQueryId: null,
  }));

  await (await import('../dist/core/dashboard-service.js')).applyDashboardState(db, inserted.id, {
    name: 'Viz Showcase',
    description: 'Sample visualizations covering many chart types',
    items,
    kind: 'apply',
  }, null, tenantId);

  console.log('Viz Showcase dashboard created:', inserted.id);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
