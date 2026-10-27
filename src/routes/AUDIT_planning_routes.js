// Audit Planning: annual plans, teams, schedules, work plans and the approval inbox.
const P = require('../AUDIT_procedures');
const { ok } = require('./AUDIT_main_routes');

const PLANNER_ROLES = ['CAO', 'ED', 'DM', 'ZM', 'AM'];

module.exports = (app, db) => {
  const lookups = (ctx) => {
    const level = P.ROLE_LEVEL[ctx.user.role];
    const lv = level && db.get('SELECT * FROM AUDIT_LEVEL WHERE org_code = ? AND level_code = ?', ctx.org_code, level);
    const allowed = lv ? lv.can_audit.split(',') : [];
    return {
      level,
      offices: P.AUDIT_officesInScope(ctx).filter((o) => allowed.includes(o.office_level)),
      types: db.all('SELECT * FROM AUDIT_TYPE WHERE org_code = ? AND active = 1 ORDER BY type_id', ctx.org_code),
      teams: db.all('SELECT * FROM AUDIT_TEAM WHERE org_code = ? AND audit_level = ? AND active = 1 ORDER BY team_id', ctx.org_code, level || ''),
    };
  };

  const lastAudit = (officeId) => db.get(
    `SELECT MAX(end_date) d FROM AUDIT_SCHEDULE WHERE office_id = ? AND status IN ('SUBMITTED','REPORT_APPROVED','UNDER_RESPONSE','CLOSED')`, officeId,
  ).d;

  // ------------------------------------------------------------ plans
  app.get('/plans', (req, res) => {
    const rows = db.all(
      `SELECT p.*, u.username, (SELECT COUNT(*) FROM AUDIT_PLAN_ITEM i WHERE i.plan_id = p.plan_id) items
         FROM AUDIT_PLAN p JOIN AUDIT_USER u ON u.user_id = p.created_by WHERE p.org_code = ? ORDER BY p.plan_id DESC`, req.ctx.org_code,
    ).filter((p) => ['ED', 'CAO', 'ADMIN'].includes(req.ctx.user.role) || p.created_by === req.ctx.user.user_id);
    res.render('AUDIT_plans', { rows, canPlan: PLANNER_ROLES.includes(req.ctx.user.role) });
  });

  app.get('/plans/new', (req, res) => {
    const l = lookups(req.ctx);
    const offices = l.offices.map((o) => {
      const last = lastAudit(o.office_id);
      return { ...o, last_audit: last, days_since: last ? Math.round((Date.now() - Date.parse(last)) / 86400000) : null };
    });
    const y = new Date().getFullYear();
    const fy = new Date().getMonth() < 6 ? y - 1 : y;
    const months = Array.from({ length: 12 }, (_, i) => `${fy + (i >= 6 ? 1 : 0)}-${String(((i + 6) % 12) + 1).padStart(2, '0')}`);
    res.render('AUDIT_plan_new', { ...l, offices, months, fyLabel: `${fy}-${String(fy + 1).slice(2)}` });
  });

  app.post('/plans', (req, res) => {
    const items = [];
    for (const r of Object.values(req.body.rows || {})) {
      for (const m of [r.month1, r.month2]) if (m) items.push({ plan_month: m, office_id: Number(r.office_id), type_id: Number(r.type_id), team_id: r.team_id ? Number(r.team_id) : null });
    }
    const id = P.AUDIT_PLAN_CREATE(req.ctx, { plan_year: req.body.plan_year, period: req.body.period, remarks: req.body.remarks, items });
    if (req.body.submit) {
      const st = P.AUDIT_PLAN_SUBMIT(req.ctx, id);
      ok(req, st === 'APPROVED' ? 'Plan saved and auto-approved by policy' : 'Plan submitted for approval');
    } else ok(req, 'Plan saved as draft');
    res.redirect(`/plans/${id}`);
  });

  app.get('/plans/:id', (req, res) => {
    const plan = db.get('SELECT p.*, u.username FROM AUDIT_PLAN p JOIN AUDIT_USER u ON u.user_id = p.created_by WHERE p.plan_id = ? AND p.org_code = ?', Number(req.params.id), req.ctx.org_code);
    if (!plan) return res.status(404).render('AUDIT_error', { message: 'Plan not found' });
    const items = db.all(
      `SELECT i.*, o.name_en office_en, o.name_bn office_bn, o.office_code, o.risk_rating, ty.name_en type_en, ty.name_bn type_bn, t.name team_name
         FROM AUDIT_PLAN_ITEM i JOIN AUDIT_OFFICE o ON o.office_id = i.office_id JOIN AUDIT_TYPE ty ON ty.type_id = i.type_id
         LEFT JOIN AUDIT_TEAM t ON t.team_id = i.team_id WHERE i.plan_id = ? ORDER BY i.plan_month, o.office_code`, plan.plan_id,
    );
    const approval = req.query.approval
      ? db.get(`SELECT * FROM AUDIT_APPROVAL WHERE appr_id = ? AND approver_user_id = ? AND action = 'PENDING'`, Number(req.query.approval), req.ctx.user.user_id)
      : null;
    res.render('AUDIT_plan_view', {
      plan, items, approval, warnings: P.AUDIT_PLAN_WARNINGS(req.ctx, plan.plan_id), history: P.AUDIT_APPROVAL_HISTORY(req.ctx, 'PLAN', plan.plan_id),
      canSubmit: plan.created_by === req.ctx.user.user_id && ['DRAFT', 'RETURNED'].includes(plan.status),
      canSchedule: plan.status === 'APPROVED' && PLANNER_ROLES.includes(req.ctx.user.role) && P.ROLE_LEVEL[req.ctx.user.role] === plan.audit_level,
    });
  });

  app.post('/plans/:id/submit', (req, res) => {
    const st = P.AUDIT_PLAN_SUBMIT(req.ctx, Number(req.params.id));
    ok(req, st === 'APPROVED' ? 'Plan auto-approved by policy' : 'Plan submitted for approval');
    res.redirect(`/plans/${req.params.id}`);
  });

  // ------------------------------------------------------------ teams
  app.get('/teams', (req, res) => {
    const teams = db.all('SELECT * FROM AUDIT_TEAM WHERE org_code = ? ORDER BY team_id', req.ctx.org_code).map((t) => ({
      ...t,
      members: db.all(`SELECT m.member_role, e.* FROM AUDIT_TEAM_MEMBER m JOIN AUDIT_EMPLOYEE e ON e.emp_id = m.emp_id WHERE m.team_id = ? ORDER BY CASE m.member_role WHEN 'LEADER' THEN 0 ELSE 1 END`, t.team_id),
    }));
    const level = P.ROLE_LEVEL[req.ctx.user.role];
    // Head office audit cell picks auditors; a manager picks staff of their own office.
    const staff = level === 'IA'
      ? db.all(`SELECT e.* FROM AUDIT_EMPLOYEE e JOIN AUDIT_USER u ON u.emp_id = e.emp_id WHERE e.org_code = ? AND u.role IN ('AUDITOR','CAO') ORDER BY e.name_en`, req.ctx.org_code)
      : db.all('SELECT * FROM AUDIT_EMPLOYEE WHERE org_code = ? AND office_id = ? ORDER BY name_en', req.ctx.org_code, req.ctx.user.office_id);
    res.render('AUDIT_teams', { teams, staff, canPlan: PLANNER_ROLES.includes(req.ctx.user.role) });
  });

  app.post('/teams', (req, res) => {
    const memberIds = [].concat(req.body.members || []).map(Number).filter((id) => id !== Number(req.body.leader));
    P.AUDIT_TEAM_CREATE(req.ctx, {
      name: req.body.name,
      members: [{ emp_id: Number(req.body.leader), member_role: 'LEADER' }, ...memberIds.map((id) => ({ emp_id: id, member_role: 'MEMBER' }))].filter((m) => m.emp_id),
    });
    ok(req, 'Team created');
    res.redirect('/teams');
  });

  // ------------------------------------------------------------ schedules
  app.get('/audits', (req, res) => {
    res.render('AUDIT_audits', { rows: P.AUDIT_LIST(req.ctx, { status: req.query.status || undefined }), canPlan: PLANNER_ROLES.includes(req.ctx.user.role) });
  });

  app.get('/audits/new', (req, res) => {
    if (!PLANNER_ROLES.includes(req.ctx.user.role)) return res.status(403).render('AUDIT_error', { message: 'Your role cannot schedule audits' });
    const l = lookups(req.ctx);
    const item = req.query.plan_item ? db.get('SELECT * FROM AUDIT_PLAN_ITEM WHERE item_id = ? AND org_code = ?', Number(req.query.plan_item), req.ctx.org_code) : null;
    res.render('AUDIT_audit_new', { ...l, item, conflicts: null });
  });

  app.post('/audits', (req, res) => {
    const f = req.body;
    const id = P.AUDIT_SCHEDULE_CREATE(req.ctx, { ...f, notify_branch: f.notify_branch === '1' });
    const conflicts = P.AUDIT_TEAM_CONFLICTS(req.ctx, Number(f.team_id), Number(f.office_id));
    const warn = conflicts.length ? ` Warning: ${conflicts.map((e) => e.name_en).join(', ')} works in this office tree.` : '';
    if (f.submit) {
      const st = P.AUDIT_SCHEDULE_SUBMIT(req.ctx, id);
      ok(req, (st === 'APPROVED' ? 'Schedule auto-approved by policy.' : 'Schedule submitted for approval.') + warn);
    } else ok(req, `Schedule saved as draft.${warn}`);
    res.redirect(`/audits/${id}`);
  });

  app.post('/audits/:id/submit-schedule', (req, res) => {
    const st = P.AUDIT_SCHEDULE_SUBMIT(req.ctx, Number(req.params.id));
    ok(req, st === 'APPROVED' ? 'Schedule auto-approved by policy' : 'Schedule submitted for approval');
    res.redirect(`/audits/${req.params.id}`);
  });

  // ------------------------------------------------------------ work plan
  app.get('/workplan', (req, res) => {
    const rows = db.all(
      `SELECT w.*, o.name_en office_en, o.name_bn office_bn, s.audit_no FROM AUDIT_WORK_PLAN w JOIN AUDIT_OFFICE o ON o.office_id = w.office_id
         LEFT JOIN AUDIT_SCHEDULE s ON s.audit_id = w.audit_id WHERE w.user_id = ? ORDER BY w.plan_date DESC`, req.ctx.user.user_id,
    );
    const myAudits = P.AUDIT_LIST(req.ctx).filter((a) => ['APPROVED', 'IN_PROGRESS'].includes(a.status) && P.isTeamMember(req.ctx, a));
    res.render('AUDIT_workplan', { rows, myAudits, offices: P.AUDIT_officesInScope(req.ctx).filter((o) => o.office_level === 'BRANCH') });
  });

  app.post('/workplan', (req, res) => {
    const rows = Object.values(req.body.rows || {}).filter((r) => r.plan_date && r.office_id);
    if (!rows.length) throw new P.AuditError('Fill at least one day');
    const st = P.AUDIT_WORKPLAN_SAVE(req.ctx, rows.map((r) => ({ ...r, office_id: Number(r.office_id), audit_id: r.audit_id ? Number(r.audit_id) : null })));
    ok(req, st === 'APPROVED' ? 'Work plan saved (no approval needed)' : 'Work plan sent for approval');
    res.redirect('/workplan');
  });

  // ------------------------------------------------------------ approval inbox
  app.get('/approvals', (req, res) => {
    res.render('AUDIT_approvals', { rows: P.AUDIT_APPROVAL_INBOX(req.ctx) });
  });

  app.get('/approvals/:id', (req, res) => {
    const ap = db.get('SELECT a.*, u.username submitted_by_name FROM AUDIT_APPROVAL a JOIN AUDIT_USER u ON u.user_id = a.submitted_by WHERE a.appr_id = ? AND a.org_code = ?', Number(req.params.id), req.ctx.org_code);
    if (!ap || ap.approver_user_id !== req.ctx.user.user_id) return res.status(404).render('AUDIT_error', { message: 'Approval item not found' });
    if (ap.item_type === 'PLAN') return res.redirect(`/plans/${ap.item_id}?approval=${ap.appr_id}`);
    return res.redirect(`/audits/${ap.item_id}?approval=${ap.appr_id}${ap.item_type === 'REPORT' ? '&tab=observations' : ''}`);
  });

  app.post('/approvals/:id', (req, res) => {
    const action = P.AUDIT_APPROVAL_ACT(req.ctx, Number(req.params.id), req.body.action, req.body.comment || '');
    ok(req, `Item ${action.toLowerCase()}`);
    res.redirect('/approvals');
  });
};
