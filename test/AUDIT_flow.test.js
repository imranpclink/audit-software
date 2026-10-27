const test = require('node:test');
const assert = require('node:assert/strict');
const { AUDIT_openDb, AUDIT_createSchema } = require('../src/db/AUDIT_db');
const { AUDIT_seedDemo } = require('../src/db/AUDIT_seed');
const P = require('../src/AUDIT_procedures');

const BASE = '2026-10-27';

function fresh() {
  const db = AUDIT_openDb(':memory:');
  AUDIT_createSchema(db);
  AUDIT_seedDemo(db, BASE);
  const as = (username, today = BASE) => {
    const user = db.get('SELECT * FROM AUDIT_USER WHERE username = ?', username);
    return { db, org_code: user.org_code, user, today };
  };
  const office = (code) => db.get('SELECT office_id FROM AUDIT_OFFICE WHERE office_code = ?', code).office_id;
  const emp = (username) => db.get('SELECT emp_id FROM AUDIT_USER WHERE username = ?', username).emp_id;
  const type = (code, org = 'ASO') => db.get('SELECT type_id FROM AUDIT_TYPE WHERE org_code = ? AND code = ?', org, code).type_id;
  const team = (name) => db.get('SELECT team_id FROM AUDIT_TEAM WHERE name LIKE ?', `${name}%`).team_id;
  const auditOf = (code, status) => db.get('SELECT s.* FROM AUDIT_SCHEDULE s JOIN AUDIT_OFFICE o USING (office_id) WHERE o.office_code = ? AND s.status = ?', code, status);
  const pendingFor = (username, itemType, itemId) => P.AUDIT_APPROVAL_INBOX(as(username)).find((x) => x.item_type === itemType && x.item_id === itemId);
  return { db, as, office, emp, type, team, auditOf, pendingFor };
}

test('demo data covers every stage of the flow', () => {
  const { db } = fresh();
  const statuses = db.all('SELECT DISTINCT status FROM AUDIT_SCHEDULE').map((r) => r.status).sort();
  assert.deepEqual(statuses, ['APPROVED', 'CLOSED', 'IN_PROGRESS', 'PENDING_APPROVAL', 'SUBMITTED', 'UNDER_RESPONSE']);
  const obs = db.all('SELECT DISTINCT status FROM AUDIT_OBSERVATION').map((r) => r.status);
  for (const s of ['OPEN', 'SENT', 'REPLIED', 'REISSUED', 'PARTLY', 'RESOLVED', 'CLOSED']) assert.ok(obs.includes(s), s);
  // every table name carries the prefix
  const tables = db.all(`SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%'`).map((r) => r.name);
  assert.ok(tables.every((n) => n.startsWith('AUDIT_')), tables.join(','));
  // every data table has org_code
  for (const { name } of db.all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)) {
    assert.ok(db.all(`PRAGMA table_info(${name})`).some((c) => c.name === 'org_code'), name);
  }
});

test('full cycle: schedule, ED approval, field audit, review, release, reply, verify, close', () => {
  const { as, office, emp, type, team, pendingFor, db } = fresh();
  const id = P.AUDIT_SCHEDULE_CREATE(as('cao'), {
    type_id: type('REG'), office_id: office('B103'), team_id: team('IA Team North'), start_date: '2026-11-15', end_date: '2026-11-20', plan_kind: 'PLANNED', notify_branch: true,
  });
  assert.equal(P.AUDIT_SCHEDULE_SUBMIT(as('cao'), id), 'PENDING_APPROVAL');
  const ap = pendingFor('ed', 'SCHEDULE', id);
  assert.ok(ap, 'IA schedule goes to the ED');
  assert.throws(() => P.AUDIT_APPROVAL_ACT(as('cao'), ap.appr_id, 'APPROVED'), /not waiting for you/);
  P.AUDIT_APPROVAL_ACT(as('ed'), ap.appr_id, 'APPROVED');
  let a = P.AUDIT_GET(as('cao'), id);
  assert.equal(a.status, 'APPROVED');
  assert.match(a.memo_no, /^ASO\/JOY\/Office Order\/2026\/\d{3}$/);
  assert.equal(a.period_from, '2014-01-01', 'new branch: audit period starts at branch open date');
  assert.equal(a.period_to, '2026-10-31');

  assert.throws(() => P.AUDIT_START(as('auditor3', '2026-11-15'), id), /Only the audit team/);
  P.AUDIT_START(as('auditor1', '2026-11-15'), id);
  const obsId = P.AUDIT_OBS_CREATE(as('auditor2', '2026-11-16'), id, {
    title: 'Cash shortage', details: 'Cash in hand Tk 3,000 less than the cash book', risk_code: 'HIGH', is_financial: true, amount: 3000,
  }, [{ emp_id: emp('bm_b103'), person_role: 'MAIN' }]);
  assert.throws(() => P.AUDIT_SUBMIT(as('auditor1', '2026-11-20'), id), /checklist question/);
  const answers = Object.fromEntries(db.all(`SELECT cp_id FROM AUDIT_CHECKPOINT WHERE org_code = 'ASO'`).map((r) => [r.cp_id, { answer: 'YES' }]));
  P.AUDIT_CHECK_SAVE(as('auditor2', '2026-11-17'), id, answers);
  assert.throws(() => P.AUDIT_SUBMIT(as('auditor2', '2026-11-20'), id), /team leader/);
  P.AUDIT_SUBMIT(as('auditor1', '2026-11-20'), id, { ack_name: 'BM' });

  const rep = pendingFor('cao', 'REPORT', id);
  assert.ok(rep, 'IA report goes to the Chief Audit Officer');
  P.AUDIT_APPROVAL_ACT(as('cao', '2026-11-22'), rep.appr_id, 'APPROVED');
  // the branch sees nothing before release
  assert.equal(P.AUDIT_MY_OBSERVATIONS(as('bm_b103')).length, 0);
  P.AUDIT_RELEASE(as('cao', '2026-11-23'), id);
  let b = P.AUDIT_OBS_GET(as('cao'), obsId);
  assert.equal(b.status, 'SENT');
  assert.equal(b.deadline, '2026-11-30', '5 working days, Friday and Saturday skipped');
  assert.equal(P.AUDIT_MY_OBSERVATIONS(as('bm_b103')).length, 1);

  P.AUDIT_OBS_RESPOND(as('bm_b103', '2026-11-25'), obsId, { response_type: 'ACTION_TAKEN', text: 'Deposited', amount_recovered: 1000 });
  assert.equal(P.AUDIT_OBS_VERIFY(as('auditor1', '2026-11-26'), obsId, 'ACCEPT', 'Seen the voucher'), 'RESOLVED');
  assert.throws(() => P.AUDIT_OBS_CLOSE(as('cao', '2026-11-27'), obsId), /fully recovered/);
  P.AUDIT_RECOVERY_ADD(as('auditor1', '2026-11-27'), obsId, { amount: 2000 });
  assert.throws(() => P.AUDIT_OBS_CLOSE(as('auditor1', '2026-11-27'), obsId), /authorised user/);
  P.AUDIT_OBS_CLOSE(as('cao', '2026-11-27'), obsId, 'Recovered in full');
  P.AUDIT_CLOSE(as('cao', '2026-11-28'), id);
  a = P.AUDIT_GET(as('cao'), id);
  assert.equal(a.status, 'CLOSED');
  assert.equal(db.get('SELECT risk_rating FROM AUDIT_OFFICE WHERE office_code = ?', 'B103').risk_rating, 'MEDIUM');
});

test('previous open observations are followed up and carried forward', () => {
  const { as, auditOf, db } = fresh();
  const cur = auditOf('B101', 'IN_PROGRESS');
  const prev = auditOf('B101', 'UNDER_RESPONSE');
  const open = P.AUDIT_PREVIOUS_OPEN(as('auditor1'), P.AUDIT_GET(as('auditor1'), cur.audit_id));
  assert.equal(open.length, 2);
  const [fin, vouch] = open;
  const newId = P.AUDIT_FOLLOWUP_SAVE(as('auditor1'), cur.audit_id, fin.obs_id, 'PARTLY', 'Tk 10,500 still due');
  const carried = P.AUDIT_OBS_GET(as('auditor1'), newId);
  assert.equal(carried.carried_from_obs_id, fin.obs_id);
  assert.equal(carried.amount, 18500);
  assert.equal(carried.persons.length, 2);
  assert.equal(P.AUDIT_OBS_GET(as('cao'), fin.obs_id).status, 'CARRIED_FORWARD');
  assert.throws(() => P.AUDIT_CLOSE(as('cao'), prev.audit_id), /still open/);
  assert.equal(P.AUDIT_FOLLOWUP_SAVE(as('auditor1'), cur.audit_id, vouch.obs_id, 'RESOLVED', 'Vouchers approved'), null);
  P.AUDIT_CLOSE(as('cao'), prev.audit_id);
  assert.equal(db.get('SELECT status FROM AUDIT_SCHEDULE WHERE audit_id = ?', prev.audit_id).status, 'CLOSED');
});

test('approval policy: manager audits go to the direct supervisor, work plan needs none', () => {
  const { as, db, pendingFor, type, office, team } = fresh();
  const amAudit = db.get(`SELECT audit_id FROM AUDIT_SCHEDULE WHERE audit_level = 'AREA'`).audit_id;
  assert.ok(pendingFor('zm_joy', 'SCHEDULE', amAudit), 'Area Manager audit waits for the Zonal Manager');
  const zPlan = db.get(`SELECT plan_id FROM AUDIT_PLAN WHERE audit_level = 'ZONE'`).plan_id;
  assert.ok(pendingFor('dm_raj', 'PLAN', zPlan), 'Zonal plan waits for the Divisional Manager');
  assert.equal(P.AUDIT_WORKPLAN_SAVE(as('auditor1'), [{ plan_date: '2026-11-01', office_id: office('B102') }]), 'APPROVED');
  // an Area Manager cannot schedule a branch outside their area
  assert.throws(() => P.AUDIT_SCHEDULE_CREATE(as('am_jsa'), {
    type_id: type('MON'), office_id: office('B201'), team_id: team('Joypurhat Sadar Area'), start_date: '2026-11-10', end_date: '2026-11-10',
  }), /outside your office scope/);
  // turning approval off auto-approves
  const pol = db.get(`SELECT policy_id FROM AUDIT_APPROVAL_POLICY WHERE org_code = 'ASO' AND applies_to = 'SCHEDULE' AND audit_level = 'AREA'`).policy_id;
  P.AUDIT_POLICY_SAVE(as('admin'), pol, false, 'NONE');
  const id = P.AUDIT_SCHEDULE_CREATE(as('am_jsa'), { type_id: type('MON'), office_id: office('B102'), team_id: team('Joypurhat Sadar Area'), start_date: '2026-11-10', end_date: '2026-11-10' });
  assert.equal(P.AUDIT_SCHEDULE_SUBMIT(as('am_jsa'), id), 'APPROVED');
});

test('surprise audits stay hidden from the branch and its managers until started', () => {
  const { as, db } = fresh();
  const s = db.get(`SELECT * FROM AUDIT_SCHEDULE WHERE plan_kind = 'SURPRISE'`);
  const a = P.AUDIT_GET(as('cao'), s.audit_id);
  assert.equal(P.AUDIT_canView(as('bm_b202'), a), false);
  assert.equal(P.AUDIT_canView(as('am_pnb'), a), false);
  assert.equal(P.AUDIT_canView(as('ed'), a), true);
  const bmNotes = db.all('SELECT message FROM AUDIT_NOTIFICATION WHERE user_id = (SELECT user_id FROM AUDIT_USER WHERE username = ?)', 'bm_b202');
  assert.equal(bmNotes.length, 0, 'no advance notice to the branch');
  P.AUDIT_START(as('auditor3'), s.audit_id);
  assert.equal(P.AUDIT_canView(as('bm_b202'), P.AUDIT_GET(as('cao'), s.audit_id)), true);
});

test('confidential observations and organizations are kept apart', () => {
  const { as, db } = fresh();
  const conf = db.get('SELECT obs_id FROM AUDIT_OBSERVATION WHERE confidential = 1').obs_id;
  assert.equal(P.AUDIT_OBS_canView(as('bm_b201'), P.AUDIT_OBS_GET(as('bm_b201'), conf)), false);
  assert.equal(P.AUDIT_OBS_canView(as('ed'), P.AUDIT_OBS_GET(as('ed'), conf)), true);
  assert.ok(!P.AUDIT_MY_OBSERVATIONS(as('bm_b201')).some((b) => b.obs_id === conf));
  const asoAudit = db.get(`SELECT audit_id FROM AUDIT_SCHEDULE WHERE org_code = 'ASO'`).audit_id;
  assert.throws(() => P.AUDIT_GET(as('coast_ed'), asoAudit), /not found/);
  assert.equal(P.AUDIT_LIST(as('coast_cao')).length, 1);
});

test('indicator standards are org-wise and an edit keeps history for older audits', () => {
  const { as, db } = fresh();
  const par = (org) => db.get(`SELECT * FROM AUDIT_INDICATOR WHERE org_code = ? AND code = 'PAR' AND effective_to IS NULL`, org);
  assert.equal(par('ASO').std_max, 10);
  assert.equal(par('COAST').std_max, 8);
  assert.throws(() => P.AUDIT_INDICATOR_SAVE(as('cao'), par('ASO').ind_id, {}), /Only the organization admin/);
  const old = par('ASO');
  P.AUDIT_INDICATOR_SAVE(as('admin'), old.ind_id, { ...old, std_max: 8, effective_from: '2026-11-01', show_in_report: 1 });
  assert.equal(par('ASO').std_max, 8);
  assert.equal(P.AUDIT_INDICATORS_AT(as('admin'), '2026-09-30').find((i) => i.code === 'PAR').std_max, 10);
  assert.equal(P.AUDIT_RISK_OF({ std_min: null, std_max: 10, tolerance_pct: 10 }, 10.5), 'MEDIUM');
  assert.equal(P.AUDIT_RISK_OF({ std_min: null, std_max: 10, tolerance_pct: 10 }, 12), 'HIGH');
  assert.equal(P.AUDIT_RISK_OF({ std_min: 92, std_max: null, tolerance_pct: 10 }, 95), 'LOW');
});
