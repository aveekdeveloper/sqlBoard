const path = require('path');
const fs = require('fs');
const { scryptSync, randomBytes } = require('crypto');

// Demo seed: creates the admin user, a DuckDB connection, and sample dashboard
// data. Works against both libSQL and Postgres because it reuses the API's
// database bootstrap. Requires `npm run build -w packages/api` first.
const dataDir = process.env.DATA_DIR || './data';
fs.mkdirSync(dataDir, { recursive: true });
const uploadsDir = path.join(dataDir, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000000';

(async () => {
  const { loadConfig } = await import('../dist/config.js');
  const { openDatabase } = await import('../dist/db/client.js');
  const { encryptJson } = await import('../dist/crypto.js');
  const { eq } = await import('drizzle-orm');
  const { users, connections, savedQueries, dashboards, dashboardItems } = await import(
    '../dist/db/schema.js'
  );

  const config = loadConfig();
  const { db, client } = await openDatabase(config);

  // --- Admin user (skip if any users exist) ---
  const existingUsers = await db.select().from(users);
  if (existingUsers.length === 0) {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync('admin', salt, 64).toString('hex');
    await db.insert(users).values({
      email: 'admin@example.com',
      passwordHash: `${salt}:${hash}`,
      role: 'admin',
      tenantId: DEFAULT_TENANT,
      createdAt: new Date().toISOString(),
    });
    console.log('Admin user: admin@example.com / admin');
  } else {
    console.log('Users already exist, skipping admin seed.');
  }

  const now = new Date().toISOString();

  // --- DuckDB connection (the built-in uploads database) ---
  const existingConns = await db.select().from(connections).where(eq(connections.type, 'duckdb'));
  let connId;
  if (existingConns.length > 0) {
    connId = existingConns[0].id;
  } else {
    const [inserted] = await db
      .insert(connections)
      .values({
        name: 'Sample Data (DuckDB)',
        type: 'duckdb',
        configEnc: encryptJson({ builtIn: true }, config.secretKey),
        tenantId: DEFAULT_TENANT,
        createdAt: now,
      })
      .returning();
    connId = inserted.id;
  }
  console.log('DuckDB connection id:', connId);

  // --- DuckDB data ---
  const duckdb = require('duckdb');
  const duckPath = path.join(dataDir, 'sqlboard.duckdb');
  const duckDb = new duckdb.Database(duckPath);
  const duckConn = duckDb.connect();

  function runSql(sql) {
    return new Promise((resolve, reject) => {
      duckConn.run(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  function runAll(sql) {
    return new Promise((resolve, reject) => {
      duckConn.all(sql, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  const samplesDir = path.join(__dirname, '..', 'data', 'samples');

  function parseCsv(raw) {
    const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) return { columns: [], rows: [] };
    const parseRow = (line) => {
      const cells = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (inQuotes) {
          if (char === '"') {
            if (line[i + 1] === '"') {
              current += '"';
              i++;
            } else inQuotes = false;
          } else current += char;
        } else {
          if (char === '"') inQuotes = true;
          else if (char === ',') {
            cells.push(current);
            current = '';
          } else current += char;
        }
      }
      cells.push(current);
      return cells;
    };
    const columns = parseRow(lines[0]).map((h) => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = parseRow(lines[i]);
      const row = {};
      for (let j = 0; j < columns.length; j++) {
        const trimmed = (cells[j] ?? '').trim();
        if (trimmed === '') row[columns[j]] = null;
        else if (/^-?\d+$/.test(trimmed)) row[columns[j]] = Number(trimmed);
        else if (/^-?\d+\.\d+$/.test(trimmed)) row[columns[j]] = Number(trimmed);
        else row[columns[j]] = trimmed;
      }
      rows.push(row);
    }
    return { columns, rows };
  }

  async function seedTable(filename, tableName) {
    const raw = fs.readFileSync(path.join(samplesDir, filename), 'utf8');
    const { columns, rows } = parseCsv(raw);
    await runSql(`DROP TABLE IF EXISTS ${tableName}`);
    const colDefs = columns.map((c) => `"${c}" ${typeof rows[0]?.[c] === 'number' ? 'DOUBLE' : 'VARCHAR'}`).join(', ');
    await runSql(`CREATE TABLE ${tableName} (${colDefs})`);
    const batchSize = 100;
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const batch = rows.slice(offset, offset + batchSize);
      const placeholders = batch.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
      const params = [];
      for (const row of batch) for (const col of columns) params.push(row[col] ?? null);
      await new Promise((resolve, reject) => {
        duckConn.run(`INSERT INTO ${tableName} VALUES ${placeholders}`, ...params, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    const countRows = await runAll(`SELECT COUNT(*) AS c FROM ${tableName}`);
    console.log(`  ${tableName}: ${countRows[0].c} rows`);
  }

  console.log('Seeding sample data into DuckDB...');
  await seedTable('sales.csv', 'sales');
  await seedTable('users.csv', 'users');
  await seedTable('products.csv', 'products');

  const q1 = `-- @viz: bar
-- @x: month
-- @y: revenue
-- @groupby: region
-- @stack: true
-- @theme: powerbi-light
SELECT month, region, SUM(revenue) AS revenue FROM sales WHERE ({Region} IS NULL OR region = {Region}) GROUP BY month, region ORDER BY month, region;`;
  const q2 = `-- @viz: line
-- @x: month
-- @y: users
-- @groupby: region
SELECT month, region, SUM(users) AS users FROM users WHERE ({Region} IS NULL OR region = {Region}) GROUP BY month, region ORDER BY month, region;`;
  const q3 = `-- @viz: pie
-- @x: category
-- @y: sales
SELECT category, SUM(sales) AS sales FROM products WHERE ({Category} IS NULL OR category = {Category}) GROUP BY category;`;
  const q4 = `-- @viz: bar
-- @x: subcategory
-- @y: sales
-- @groupby: category
SELECT subcategory, category, SUM(sales) AS sales FROM products WHERE ({Category} IS NULL OR category = {Category}) GROUP BY subcategory, category ORDER BY sales DESC;`;

  const existingQueries = await db.select().from(savedQueries);
  if (existingQueries.length === 0) {
    const now2 = new Date().toISOString();
    const samples = [
      ['Monthly Revenue by Region', q1],
      ['User Growth by Region', q2],
      ['Sales by Category', q3],
      ['Sales by Subcategory', q4],
    ];
    for (const [name, sql] of samples) {
      await db.insert(savedQueries).values({
        name,
        connectionId: connId,
        sql,
        latestVersion: 0,
        tenantId: DEFAULT_TENANT,
        createdAt: now2,
        updatedAt: now2,
      });
    }
    console.log('Saved 4 sample queries.');
  }

  const existingDashboards = await db.select().from(dashboards);
  if (existingDashboards.length === 0) {
    const now3 = new Date().toISOString();
    const filters = [
      { name: 'Region', type: 'select', connectionId: connId, sql: 'SELECT DISTINCT region FROM sales ORDER BY region', defaultValue: 'NA' },
      { name: 'Category', type: 'select', connectionId: connId, sql: 'SELECT DISTINCT category FROM products ORDER BY category', defaultValue: null },
    ];
    const [dash] = await db
      .insert(dashboards)
      .values({
        name: 'Sample Sales Dashboard',
        description: 'Revenue, users, and product sales overview',
        filtersJson: JSON.stringify(filters),
        tenantId: DEFAULT_TENANT,
        createdAt: now3,
        updatedAt: now3,
      })
      .returning();

    const items = [
      { title: 'Monthly Revenue by Region', sql: q1, layout: { x: 0, y: 0, w: 6, h: 4 } },
      { title: 'User Growth by Region', sql: q2, layout: { x: 6, y: 0, w: 6, h: 4 } },
      { title: 'Sales by Category', sql: q3, layout: { x: 0, y: 4, w: 4, h: 4 } },
      { title: 'Sales by Subcategory', sql: q4, layout: { x: 4, y: 4, w: 8, h: 4 } },
    ];
    for (const item of items) {
      await db.insert(dashboardItems).values({
        dashboardId: dash.id,
        title: item.title,
        sql: item.sql,
        connectionId: connId,
        blockType: 'chart',
        layoutJson: JSON.stringify(item.layout),
        createdAt: now3,
      });
    }
    console.log('Created sample dashboard with 4 charts.');
  }

  console.log('Seeding complete!');
  duckConn.close();
  duckDb.close(async () => {
    try {
      if (typeof client.close === 'function') await client.close();
      if (typeof client.end === 'function') await client.end();
    } catch {
      // best effort
    }
    process.exit(0);
  });
})().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
