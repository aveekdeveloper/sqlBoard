const { createClient } = require('@libsql/client');
const { scryptSync, randomBytes } = require('crypto');
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR || './data';
fs.mkdirSync(dataDir, { recursive: true });
const uploadsDir = path.join(dataDir, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const rawDatabaseUrl = process.env.DATABASE_URL || `file:${path.join(dataDir, 'sqlboard.db')}`;
// libsql:// forces HTTPS/TLS which fails on internal Docker networks (plain HTTP).
// Convert to http:// for internal connections.
let databaseUrl = rawDatabaseUrl.startsWith('libsql://')
  ? rawDatabaseUrl.replace(/^libsql:\/\//, 'http://')
  : rawDatabaseUrl;

// Extract embedded credentials from URL (libSQL client rejects URLs with credentials)
let authToken = process.env.LIBSQL_AUTH_TOKEN || null;
try {
  const parsed = new URL(databaseUrl);
  if (parsed.username || parsed.password) {
    if (!authToken) {
      authToken = parsed.password || parsed.username;
    }
    parsed.username = '';
    parsed.password = '';
    databaseUrl = parsed.toString();
  }
} catch {
  // Not a valid URL, leave as-is
}

// If the auth token is a plain password (not a JWT), generate a JWT.
if (authToken && !authToken.includes('.')) {
  try {
    const jwt = require('jsonwebtoken');
    authToken = jwt.sign({ sub: 'sqlboard' }, authToken, { expiresIn: '365d' });
  } catch {
    // jsonwebtoken not available, use as-is
  }
}

const client = createClient({
  url: databaseUrl,
  authToken: authToken || undefined,
});

async function exec(sql) {
  await client.execute(sql);
}

async function run(sql, ...params) {
  return client.execute({ sql, args: params });
}

(async () => {
  // Wait for libSQL server to be ready (retry up to 30 times)
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await client.execute('SELECT 1');
      break;
    } catch (err) {
      if (attempt === 30) throw err;
      console.log(`Waiting for database... (${attempt}/30)`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // --- SQLite/libSQL metadata ---
  await exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at TEXT NOT NULL)`);
  await exec(`CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`);
  await exec(`CREATE TABLE IF NOT EXISTS connections (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL, config_enc TEXT NOT NULL, created_at TEXT NOT NULL)`);
  await exec(`CREATE TABLE IF NOT EXISTS uploads (id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, filename TEXT NOT NULL, row_count INTEGER NOT NULL DEFAULT 0, size_bytes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`);
  await exec(`CREATE TABLE IF NOT EXISTS saved_queries (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, connection_id INTEGER NOT NULL, sql TEXT NOT NULL, latest_version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  await exec(`CREATE TABLE IF NOT EXISTS saved_query_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, saved_query_id INTEGER NOT NULL, version INTEGER NOT NULL, parent_version INTEGER, message TEXT, author_id INTEGER, kind TEXT NOT NULL DEFAULT 'manual', sql TEXT NOT NULL, created_at TEXT NOT NULL)`);
  await exec(`CREATE TABLE IF NOT EXISTS dashboards (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, filters_json TEXT, theme TEXT, colors_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  await exec(`CREATE TABLE IF NOT EXISTS dashboard_items (id INTEGER PRIMARY KEY AUTOINCREMENT, dashboard_id INTEGER NOT NULL, title TEXT NOT NULL, sql TEXT NOT NULL, connection_id INTEGER NOT NULL, saved_query_id INTEGER, block_type TEXT NOT NULL DEFAULT 'chart', config_json TEXT, layout_json TEXT NOT NULL, created_at TEXT NOT NULL)`);
  await exec(`CREATE TABLE IF NOT EXISTS dashboard_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, dashboard_id INTEGER NOT NULL, version INTEGER NOT NULL, parent_version INTEGER, message TEXT, author_id INTEGER, kind TEXT NOT NULL DEFAULT 'manual', snapshot_json TEXT NOT NULL, code_text TEXT NOT NULL, created_at TEXT NOT NULL)`);
  await exec(`CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT, created_at TEXT NOT NULL)`);
  await exec(`CREATE TABLE IF NOT EXISTS api_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL, prefix TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'viewer', expires_at TEXT, last_used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL)`);

  // Check if DB already has data (skip seeding entirely if so)
  const existingUsers = await client.execute({ sql: 'SELECT COUNT(*) AS c FROM users' });
  const alreadySeeded = Number(existingUsers.rows[0].c) > 0;

  if (!alreadySeeded) {
    // Seed admin user
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync('admin', salt, 64).toString('hex');
    const now = new Date().toISOString();
    await run(`INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)`, 'admin@example.com', salt + ':' + hash, 'admin', now);
    console.log('Admin user: admin@example.com / admin');
  } else {
    console.log('Users already exist, skipping admin seed.');
  }

  const now = new Date().toISOString();

  // Seed DuckDB connection (only if no duckdb connection exists)
  const existingConn = await client.execute({ sql: "SELECT id FROM connections WHERE type = 'duckdb'" });
  let connId;
  if (existingConn.rows.length > 0) {
    connId = existingConn.rows[0].id;
  } else {
    const crypto = require('crypto');
    const key = crypto.scryptSync(process.env.SECRET_KEY || 'dev-secret-change-me', 'sqlboard-salt', 32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plaintext = Buffer.from(JSON.stringify({ builtIn: true }), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const configEnc = Buffer.concat([iv, tag, encrypted]).toString('base64');
    const result = await run(`INSERT INTO connections (name, type, config_enc, created_at) VALUES (?, ?, ?, ?)`, 'Sample Data (DuckDB)', 'duckdb', configEnc, now);
    connId = Number(result.lastInsertRowid);
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
    const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim() !== '');
    if (lines.length === 0) return { columns: [], rows: [] };
    const parseRow = (line) => {
      const cells = []; let current = ''; let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (inQuotes) {
          if (char === '"') { if (line[i+1] === '"') { current += '"'; i++; } else inQuotes = false; }
          else current += char;
        } else {
          if (char === '"') inQuotes = true;
          else if (char === ',') { cells.push(current); current = ''; }
          else current += char;
        }
      }
      cells.push(current);
      return cells;
    };
    const columns = parseRow(lines[0]).map(h => h.trim());
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
    const colDefs = columns.map(c => `"${c}" ${typeof rows[0]?.[c] === 'number' ? 'DOUBLE' : 'VARCHAR'}`).join(', ');
    await runSql(`CREATE TABLE ${tableName} (${colDefs})`);
    const batchSize = 100;
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const batch = rows.slice(offset, offset + batchSize);
      const placeholders = batch.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
      const params = [];
      for (const row of batch) for (const col of columns) params.push(row[col] ?? null);
      await new Promise((resolve, reject) => {
        duckConn.run(`INSERT INTO ${tableName} VALUES ${placeholders}`, ...params, (err) => {
          if (err) reject(err); else resolve();
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

  const existingQueries = await client.execute({ sql: 'SELECT COUNT(*) AS c FROM saved_queries' });
  if (Number(existingQueries.rows[0].c) === 0) {
    const now2 = new Date().toISOString();
    await run(`INSERT INTO saved_queries (name, connection_id, sql, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, 'Monthly Revenue by Region', connId, q1, now2, now2);
    await run(`INSERT INTO saved_queries (name, connection_id, sql, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, 'User Growth by Region', connId, q2, now2, now2);
    await run(`INSERT INTO saved_queries (name, connection_id, sql, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, 'Sales by Category', connId, q3, now2, now2);
    await run(`INSERT INTO saved_queries (name, connection_id, sql, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, 'Sales by Subcategory', connId, q4, now2, now2);
    console.log('Saved 4 sample queries.');
  }

  const existingDashboards = await client.execute({ sql: 'SELECT COUNT(*) AS c FROM dashboards' });
  if (Number(existingDashboards.rows[0].c) === 0) {
    const now3 = new Date().toISOString();
    const filters = [{ name: 'Region', type: 'select', connectionId: connId, sql: 'SELECT DISTINCT region FROM sales ORDER BY region', defaultValue: 'NA' }, { name: 'Category', type: 'select', connectionId: connId, sql: 'SELECT DISTINCT category FROM products ORDER BY category', defaultValue: null }];
     const dashResult = await run(`INSERT INTO dashboards (name, description, filters_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, 'Sample Sales Dashboard', 'Revenue, users, and product sales overview', JSON.stringify(filters), now3, now3);
    const dashId = Number(dashResult.lastInsertRowid);

    const items = [
      { title: 'Monthly Revenue by Region', sql: q1, layout: { x: 0, y: 0, w: 6, h: 4 } },
      { title: 'User Growth by Region', sql: q2, layout: { x: 6, y: 0, w: 6, h: 4 } },
      { title: 'Sales by Category', sql: q3, layout: { x: 0, y: 4, w: 4, h: 4 } },
      { title: 'Sales by Subcategory', sql: q4, layout: { x: 4, y: 4, w: 8, h: 4 } },
    ];
    for (const item of items) {
      await run(`INSERT INTO dashboard_items (dashboard_id, title, sql, connection_id, block_type, layout_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, dashId, item.title, item.sql, connId, 'chart', JSON.stringify(item.layout), now3);
    }
    console.log('Created sample dashboard with 4 charts.');
  }

  console.log('Seeding complete!');
  duckDb.close(() => process.exit(0));
})();
