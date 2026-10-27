const test = require('node:test');
const assert = require('node:assert/strict');
const { AUDIT_openDb, AUDIT_createSchema } = require('../src/db/AUDIT_db');
const { AUDIT_seedDemo } = require('../src/db/AUDIT_seed');
const { AUDIT_createApp } = require('../src/AUDIT_server');

test('every main page renders for every role in both languages', async () => {
  const db = AUDIT_openDb(':memory:');
  AUDIT_createSchema(db);
  AUDIT_seedDemo(db);
  const server = AUDIT_createApp(db).listen(0);
  const base = `http://localhost:${server.address().port}`;
  try {
    const pages = ['/', '/notifications', '/my-observations', '/plans', '/plans/new', '/plans/1', '/teams', '/audits', '/audits/new', '/workplan', '/approvals',
      '/reports', '/reports/observations', '/reports/pending', '/reports/ratios', '/reports/plan/1', '/setup',
      ...['overview', 'followup', 'checklist', 'data', 'fraud', 'observations', 'submit'].map((t) => `/audits/5?tab=${t}`),
      '/reports/audit/3', '/reports/order-letter/3', '/reports/show-cause/3', '/observations/6', '/audits/5/observations/new'];
    for (const user of ['admin', 'ed', 'cao', 'auditor1', 'zm_joy', 'am_jsa', 'bm_b201', 'fo_b201', 'coast_cao']) {
      const login = await fetch(`${base}/login`, { method: 'POST', body: new URLSearchParams({ username: user, password: 'demo123' }), redirect: 'manual' });
      assert.equal(login.headers.get('location'), '/', `login ${user}`);
      const cookie = login.headers.get('set-cookie').split(';')[0];
      for (const lang of ['en', 'bn']) {
        await fetch(`${base}/lang/${lang}`, { headers: { cookie }, redirect: 'manual' });
        for (const p of pages) {
          const r = await fetch(base + p, { headers: { cookie }, redirect: 'manual' });
          assert.ok(r.status < 500, `${user} ${lang} ${p} -> ${r.status}`);
        }
      }
    }
    const bad = await fetch(`${base}/login`, { method: 'POST', body: new URLSearchParams({ username: 'ed', password: 'wrong' }), redirect: 'manual' });
    assert.equal(bad.headers.get('location'), '/login');
  } finally {
    server.close();
  }
});
