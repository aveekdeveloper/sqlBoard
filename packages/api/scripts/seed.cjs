const Database = require('better-sqlite3');
const { scryptSync, randomBytes } = require('crypto');
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR || './data';
fs.mkdirSync(dataDir, { recursive: true });
const uploadsDir = path.join(dataDir, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// --- SQLite metadata ---
const db = new Database(path.join(dataDir, 'sqlboard.db'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at TEXT NOT NULL)`);
db.exec(`CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`);
db.exec(`CREATE TABLE IF NOT EXISTS connections (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL, config_enc TEXT NOT NULL, created_at TEXT NOT NULL)`);
db.exec(`CREATE TABLE IF NOT EXISTS uploads (id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, filename TEXT NOT NULL, row_count INTEGER NOT NULL DEFAULT 0, size_bytes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`);
db.exec(`CREATE TABLE IF NOT EXISTS saved_queries (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, connection_id INTEGER NOT NULL, sql TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
db.exec(`CREATE TABLE IF NOT EXISTS dashboards (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
db.exec(`CREATE TABLE IF NOT EXISTS dashboard_items (id INTEGER PRIMARY KEY AUTOINCREMENT, dashboard_id INTEGER NOT NULL, title TEXT NOT NULL, sql TEXT NOT NULL, connection_id INTEGER NOT NULL, block_type TEXT NOT NULL DEFAULT 'chart', config_json TEXT, layout_json TEXT NOT NULL, created_at TEXT NOT NULL)`);
db.exec(`CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT, created_at TEXT NOT NULL)`);

// Seed admin user
const salt = randomBytes(16).toString('hex');
const hash = scryptSync('admin', salt, 64).toString('hex');
const now = new Date().toISOString();
db.prepare('INSERT OR REPLACE INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)').run('admin@example.com', salt + ':' + hash, 'admin', now);
console.log('Admin user: admin@example.com / admin');

// Seed DuckDB connection
const existingConn = db.prepare("SELECT id FROM connections WHERE type = 'duckdb'").get();
let connId;
if (existingConn) {
  connId = existingConn.id;
} else {
  const crypto = require('crypto');
  const key = crypto.scryptSync(process.env.SECRET_KEY || 'dev-secret-change-me', 'sqlboard-salt', 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify({ builtIn: true }), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const configEnc = Buffer.concat([iv, tag, encrypted]).toString('base64');
  const result = db.prepare('INSERT INTO connections (name, type, config_enc, created_at) VALUES (?, ?, ?, ?)').run('Sample Data (DuckDB)', 'duckdb', configEnc, now);
  connId = result.lastInsertRowid;
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

(async () => {
  console.log('Seeding sample data into DuckDB...');
  await seedTable('sales.csv', 'sales');
  await seedTable('users.csv', 'users');
  await seedTable('products.csv', 'products');

  // Seed saved queries
  const q1 = `-- @viz: bar
-- @x: month
-- @y: revenue
-- @groupby: region
-- @stack: true
-- @theme: powerbi-light
SELECT month, region, SUM(revenue) AS revenue FROM sales GROUP BY month, region ORDER BY month, region;`;
  const q2 = `-- @viz: line
-- @x: month
-- @y: users
-- @groupby: region
SELECT month, region, SUM(users) AS users FROM users GROUP BY month, region ORDER BY month, region;`;
  const q3 = `-- @viz: pie
-- @x: category
-- @y: sales
SELECT category, SUM(sales) AS sales FROM products GROUP BY category;`;
  const q4 = `-- @viz: bar
-- @x: subcategory
-- @y: sales
-- @groupby: category
SELECT subcategory, category, SUM(sales) AS sales FROM products GROUP BY subcategory, category ORDER BY sales DESC;`;

  const existingQueries = db.prepare('SELECT COUNT(*) AS c FROM saved_queries').get();
  if (existingQueries.c === 0) {
    const now2 = new Date().toISOString();
    db.prepare('INSERT INTO saved_queries (name, connection_id, sql, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('Monthly Revenue by Region', connId, q1, now2, now2);
    db.prepare('INSERT INTO saved_queries (name, connection_id, sql, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('User Growth by Region', connId, q2, now2, now2);
    db.prepare('INSERT INTO saved_queries (name, connection_id, sql, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('Sales by Category', connId, q3, now2, now2);
    db.prepare('INSERT INTO saved_queries (name, connection_id, sql, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('Sales by Subcategory', connId, q4, now2, now2);
    console.log('Saved 4 sample queries.');
  }

  // Seed a sample dashboard
  const existingDashboards = db.prepare('SELECT COUNT(*) AS c FROM dashboards').get();
  if (existingDashboards.c === 0) {
    const now3 = new Date().toISOString();
    const filters = [{ name: 'Region', type: 'select', connectionId: connId, sql: 'SELECT DISTINCT region FROM sales ORDER BY region', defaultValue: 'NA' }, { name: 'Category', type: 'select', connectionId: connId, sql: 'SELECT DISTINCT category FROM products ORDER BY category', defaultValue: null }];
     const dashResult = db.prepare('INSERT INTO dashboards (name, description, filters_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('Sample Sales Dashboard', 'Revenue, users, and product sales overview', JSON.stringify(filters), now3, now3);
    const dashId = dashResult.lastInsertRowid;

    const items = [
      { title: 'Monthly Revenue by Region', sql: q1, layout: { x: 0, y: 0, w: 6, h: 4 } },
      { title: 'User Growth by Region', sql: q2, layout: { x: 6, y: 0, w: 6, h: 4 } },
      { title: 'Sales by Category', sql: q3, layout: { x: 0, y: 4, w: 4, h: 4 } },
      { title: 'Sales by Subcategory', sql: q4, layout: { x: 4, y: 4, w: 8, h: 4 } },
    ];
    for (const item of items) {
      db.prepare('INSERT INTO dashboard_items (dashboard_id, title, sql, connection_id, block_type, layout_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(dashId, item.title, item.sql, connId, 'chart', JSON.stringify(item.layout), now3);
    }
    console.log('Created sample dashboard with 4 charts.');
  }

  console.log('Seeding complete!');
  duckDb.close(() => process.exit(0));
})();
