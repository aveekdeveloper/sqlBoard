const Database = require('better-sqlite3');
const { scryptSync, randomBytes } = require('crypto');
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR || './data';
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'sqlboard.db'));
db.pragma('journal_mode = WAL');
db.exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at TEXT NOT NULL)");

const email = process.env.ADMIN_EMAIL || 'admin@example.com';
const password = process.env.ADMIN_PASSWORD || 'admin';
const salt = randomBytes(16).toString('hex');
const hash = scryptSync(password, salt, 64).toString('hex');
const now = new Date().toISOString();
db.prepare('INSERT OR REPLACE INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)').run(email, salt + ':' + hash, 'admin', now);
console.log(`Admin user seeded: ${email} / ${password} (role: admin)`);
db.close();
