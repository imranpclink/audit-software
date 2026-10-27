// The audit file: overview, previous follow-up, checklist, branch data comparison, fraud register,
// observations and submission, plus review, release and closure.
const P = require('../AUDIT_procedures');
const { ok } = require('./AUDIT_main_routes');

const TABS = ['overview', 'followup', 'checklist', 'data', 'fraud', 'observations', 'submit'];

module.exports = (app, db) => {
  const load = (req) => {
    const a = P.AUDIT_GET(req.ctx, Number(req.params.id));
    if (!P.AUDIT_canView(req.ctx, a)) throw new P.AuditError('You cannot open this audit');
    return a;
  };

  app.get('/audits/:id', (req, res) => {
    const a = load(req);
    const ctx = req.ctx;
    const tab = TABS.includes(req.query.tab) ? req.query.tab : 'overview';
    const team = db.all(
      `SELECT m.member_role, e.* FROM AUDIT_TEAM_MEMBER m JOIN AUDIT_EMPLOYEE e ON e.emp_id = m.emp_id WHERE m.team_id = ? ORDER BY CASE m.member_role WHEN 'LEADER' THEN 0 ELSE 1 END`, a.team_id,
    );
    const isTeam = P.isTeamMember(ctx, a);
    const approval = req.query.approval
      ? db.get(`SELECT * FROM AUDIT_APPROVAL WHERE appr_id = ? AND approver_user_id = ? AND action = 'PENDING'`, Number(req.query.approval), ctx.user.user_id)
      : null;
    const data = {
      a, tab, team, approval, isTeam,
      isLeader: P.isTeamLeader(ctx, a),
      canManage: P.canManageAudit(ctx, a),
      editable: isTeam && a.status === 'IN_PROGRESS',
      history: [...P.AUDIT_APPROVAL_HISTORY(ctx, 'SCHEDULE', a.audit_id), ...P.AUDIT_APPROVAL_HISTORY(ctx, 'REPORT', a.audit_id)],
      prev: a.prev_audit_id ? db.get('SELECT audit_id, audit_no, start_date, end_date FROM AUDIT_SCHEDULE WHERE audit_id = ?', a.prev_audit_id) : null,
      followup: P.AUDIT_PREVIOUS_OPEN(ctx, a),
      obs: P.AUDIT_OBS_LIST(ctx, a.audit_id),
    };
    if (tab === 'checklist') data.checklist = P.AUDIT_CHECKLIST(ctx, a);
    if (tab === 'data') data.comparison = P.AUDIT_COMPARISON(ctx, a);
    if (tab === 'fraud') {
      data.fraud = P.AUDIT_FRAUD_LIST(ctx, a.audit_id);
      data.staff = db.all('SELECT * FROM AUDIT_EMPLOYEE WHERE org_code = ? AND office_id = ? ORDER BY name_en', ctx.org_code, a.office_id);
    }
    if (tab === 'submit') data.problems = P.AUDIT_SUBMIT_CHECK(ctx, a);
    if (tab === 'overview') {
      data.workplan = db.all(
        `SELECT w.*, u.username, e.name_en, e.name_bn FROM AUDIT_WORK_PLAN w JOIN AUDIT_USER u ON u.user_id = w.user_id
           LEFT JOIN AUDIT_EMPLOYEE e ON e.emp_id = u.emp_id WHERE w.audit_id = ? ORDER BY w.plan_date, e.name_en`, a.audit_id,
      );
      data.conflicts = P.AUDIT_TEAM_CONFLICTS(ctx, a.team_id, a.office_id);
    }
    // Branch users never see confidential observations or observations before release.
    if (['BM', 'STAFF'].includes(ctx.user.role)) data.obs = data.obs.filter((b) => P.AUDIT_OBS_canView(ctx, b));
    res.render('AUDIT_audit', data);
  });

  app.post('/audits/:id/start', (req, res) => {
    P.AUDIT_START(req.ctx, Number(req.params.id));
    ok(req, 'Audit started. Begin with the follow-up of the previous audit.');
    res.redirect(`/audits/${req.params.id}?tab=followup`);
  });

  app.post('/audits/:id/checklist', (req, res) => {
    P.AUDIT_CHECK_SAVE(req.ctx, Number(req.params.id), req.body.cp || {});
    ok(req, 'Checklist saved');
    res.redirect(`/audits/${req.params.id}?tab=checklist`);
  });

  app.post('/audits/:id/followup', (req, res) => {
    const newId = P.AUDIT_FOLLOWUP_SAVE(req.ctx, Number(req.params.id), Number(req.body.obs_id), req.body.current_status, req.body.note);
    ok(req, newId ? 'Not resolved: carried forward into this audit as a new observation' : 'Marked resolved and closed');
    res.redirect(`/audits/${req.params.id}?tab=followup`);
  });

  app.post('/audits/:id/fraud', (req, res) => {
    P.AUDIT_FRAUD_ADD(req.ctx, Number(req.params.id), { ...req.body, emp_id: Number(req.body.emp_id) });
    ok(req, 'Added to the fraud register');
    res.redirect(`/audits/${req.params.id}?tab=fraud`);
  });

  app.get('/audits/:id/observations/new', (req, res) => {
    const a = load(req);
    const cp = req.query.cp_id ? db.get('SELECT * FROM AUDIT_CHECKPOINT WHERE cp_id = ? AND org_code = ?', Number(req.query.cp_id), req.ctx.org_code) : null;
    res.render('AUDIT_obs_new', {
      a, cp,
      areas: db.all('SELECT * FROM AUDIT_AREA WHERE org_code = ? AND active = 1 ORDER BY serial', req.ctx.org_code),
      staff: db.all('SELECT * FROM AUDIT_EMPLOYEE WHERE org_code = ? AND office_id = ? ORDER BY name_en', req.ctx.org_code, a.office_id),
      prefillTitle: req.query.title || '',
    });
  });

  app.post('/audits/:id/observations', (req, res) => {
    const f = req.body;
    const persons = Object.values(f.persons || {}).filter((p) => p.emp_id).map((p) => ({ emp_id: Number(p.emp_id), person_role: p.person_role }));
    const id = P.AUDIT_OBS_CREATE(req.ctx, Number(req.params.id), {
      ...f, area_id: f.area_id ? Number(f.area_id) : null, cp_id: f.cp_id ? Number(f.cp_id) : null,
      is_financial: f.is_financial === '1', corrected_on_spot: f.corrected_on_spot === '1', confidential: f.confidential === '1', show_cause: f.show_cause === '1',
    }, persons);
    const b = P.AUDIT_OBS_GET(req.ctx, id);
    ok(req, `Observation ${b.obs_no} saved`);
    res.redirect(f.again ? `/audits/${req.params.id}/observations/new` : `/audits/${req.params.id}?tab=observations`);
  });

  app.post('/audits/:id/submit-audit', (req, res) => {
    P.AUDIT_SUBMIT(req.ctx, Number(req.params.id), req.body);
    ok(req, 'Audit submitted for review');
    res.redirect(`/audits/${req.params.id}`);
  });

  app.post('/audits/:id/release', (req, res) => {
    P.AUDIT_RELEASE(req.ctx, Number(req.params.id));
    ok(req, 'Report released. Responsible persons and the branch manager are notified.');
    res.redirect(`/audits/${req.params.id}?tab=observations`);
  });

  app.post('/audits/:id/close', (req, res) => {
    P.AUDIT_CLOSE(req.ctx, Number(req.params.id));
    ok(req, 'Audit closed and the branch risk rating updated');
    res.redirect(`/audits/${req.params.id}`);
  });
};
