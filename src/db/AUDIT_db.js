// Database connection and small query helpers.
// Uses the SQLite engine built into Node.js 22+, so there is nothing to install.
// The SQL is kept plain so the same schema can move to SQL Server, Oracle or PostgreSQL.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function AUDIT_openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') raw.exec('PRAGMA journal_mode = WAL;');

  let depth = 0;
  const db = {
    raw,
    all: (sql, ...params) => raw.prepare(sql).all(...params),
    get: (sql, ...params) => raw.prepare(sql).get(...params),
    run: (sql, ...params) => raw.prepare(sql).run(...params),
    exec: (sql) => raw.exec(sql),
    // Runs fn in one transaction. Nested calls join the outer transaction.
    tx(fn) {
      if (depth > 0) return fn();
      depth++;
      raw.exec('BEGIN');
      try {
        const result = fn();
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      } finally {
        depth--;
      }
    },
  };
  return db;
}

function AUDIT_createSchema(db) {
  db.exec(fs.readFileSync(path.join(__dirname, 'AUDIT_schema.sql'), 'utf8'));
}

module.exports = { AUDIT_openDb, AUDIT_createSchema };
