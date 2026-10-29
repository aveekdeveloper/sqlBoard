const fs = require('fs');
const path = require('path');
const { scryptSync, randomBytes } = require('crypto');

// Minimal seed: ensures an admin user exists. Works against libSQL and Postgres.
// Requires `npm run build -w packages/api` first.
const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000000';
const dataDir = process.env.DATA_DIR || './data';
fs.mkdirSync(dataDir, { recursive: true });

(async () => {
  const { loadConfig } = await import('../dist/config.js');
  const { openDatabase } = await import('../dist/db/client.js');
  const { eq } = await import('drizzle-orm');
  const { users } = await import('../dist/db/schema.js');

  const config = loadConfig();
  const { db, client } = await openDatabase(config);

  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD || 'admin';
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');

  const existing = await db.select().from(users).where(eq(users.email, email));
  if (existing.length > 0) {
    await db.update(users).set({ passwordHash: `${salt}:${hash}`, role: 'admin' }).where(eq(users.email, email));
    console.log(`Admin user updated: ${email}`);
  } else {
    await db.insert(users).values({
      email,
      passwordHash: `${salt}:${hash}`,
      role: 'admin',
      tenantId: DEFAULT_TENANT,
      createdAt: new Date().toISOString(),
    });
    console.log(`Admin user seeded: ${email} / ${password} (role: admin)`);
  }

  try {
    if (typeof client.close === 'function') await client.close();
    if (typeof client.end === 'function') await client.end();
  } catch {
    // best effort
  }
  process.exit(0);
})().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
