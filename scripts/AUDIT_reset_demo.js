// Deletes the local database and loads the demo data again.
const fs = require('node:fs');
const path = require('node:path');
const { AUDIT_openDb, AUDIT_createSchema } = require('../src/db/AUDIT_db');
const { AUDIT_seedDemo, DEMO_PASSWORD } = require('../src/db/AUDIT_seed');

const file = process.env.AUDIT_DB || path.join(__dirname, '..', 'data', 'AUDIT_demo.db');
for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
const db = AUDIT_openDb(file);
AUDIT_createSchema(db);
AUDIT_seedDemo(db);
console.log(`Demo data loaded into ${file}. Every demo user's password is "${DEMO_PASSWORD}".`);
