// Business rules of the audit module.
// Each exported AUDIT_* function plays the part of one database procedure in the ERP
// style (AUDIT_PLAN_SUBMIT, AUDIT_OBS_RESPOND, ...). Pages only call these functions,
// so they can later be moved into stored procedures one for one.
//
// Every function takes ctx = { db, org_code, user, today? } and checks the user's
// permission and office scope itself.

class AuditError extends Error {}

const AUDIT_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  RETURNED: 'RETURNED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  APPROVED: 'APPROVED',
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTED: 'SUBMITTED',
  REPORT_APPROVED: 'REPORT_APPROVED',
  UNDER_RESPONSE: 'UNDER_RESPONSE',
  CLOSED: 'CLOSED',
};

const AUDIT_OBS_STATUS = {
  OPEN: 'OPEN',
  SENT: 'SENT',
  REPLIED: 'REPLIED',
  REISSUED: 'REISSUED',
  PARTLY: 'PARTLY',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
  CARRIED_FORWARD: 'CARRIED_FORWARD',
};

const OBS_AWAITING_REPLY = ['SENT', 'REISSUED', 'PARTLY'];
const OBS_FINISHED = ['CLOSED', 'CARRIED_FORWARD'];
const HO_ROLES = ['ADMIN', 'ED', 'CAO'];
const MANAGER_ROLES = ['DM', 'ZM', 'AM'];
const ROLE_LEVEL = { CAO: 'IA', AUDITOR: 'IA', ED: 'IA', ADMIN: 'IA', DM: 'DIVISION', ZM: 'ZONE', AM: 'AREA' };
const OFFICE_RANK = { HO: 0, DIVISION: 1, ZONE: 2, AREA: 3, BRANCH: 4 };

// ------------------------------------------------------------------ small helpers

function today(ctx) {
  return ctx.today || new Date().toISOString().slice(0, 10);
}

function now(ctx) {
  return ctx.today ? `${ctx.today} 10:00:00` : new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Friday and Saturday are the weekend in Bangladesh.
function AUDIT_addWorkingDays(date, n) {
  let d = date;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 5 && wd !== 6) left--;
  }
  return d;
}

function lastMonthEnd(date) {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

function fail(msg) {
  throw new AuditError(msg);
}

function need(cond, msg) {
  if (!cond) fail(msg);
}

function log(ctx, action, entity, id, detail) {
  ctx.db.run(
    'INSERT INTO AUDIT_LOG (org_code, user_id, action, entity, entity_id, detail, created_at) VALUES (?,?,?,?,?,?,?)',
    ctx.org_code, ctx.user ? ctx.user.user_id : null, action, entity, id, detail ? JSON.stringify(detail) : null, now(ctx),
  );
}

function notify(ctx, userId, message, link) {
  if (!userId) return;
  ctx.db.run(
    'INSERT INTO AUDIT_NOTIFICATION (org_code, user_id, message, link, created_at) VALUES (?,?,?,?,?)',
    ctx.org_code, userId, message, link || null, now(ctx),
  );
}

function hasRole(ctx, ...roles) {
  return roles.includes(ctx.user.role);
}

// ------------------------------------------------------------------ office scope

function office(ctx, officeId) {
  const o = ctx.db.get('SELECT * FROM AUDIT_OFFICE WHERE office_id = ? AND org_code = ?', officeId, ctx.org_code);
  need(o, 'Office not found');
  return o;
}

function ancestors(ctx, officeId) {
  const ids = [];
  let o = office(ctx, officeId);
  while (o.parent_id) {
    ids.push(o.parent_id);
    o = office(ctx, o.parent_id);
  }
  return ids;
}

function isInside(ctx, officeId, rootId) {
  return officeId === rootId || ancestors(ctx, officeId).includes(rootId);
}

function AUDIT_officesInScope(ctx, user = ctx.user) {
  const all = ctx.db.all('SELECT * FROM AUDIT_OFFICE WHERE org_code = ? AND active = 1 ORDER BY office_code', ctx.org_code);
  if (HO_ROLES.includes(user.role) || user.role === 'AUDITOR') return all;
  return all.filter((o) => isInside(ctx, o.office_id, user.office_id));
}

function userByRole(ctx, role) {
  return ctx.db.get('SELECT * FROM AUDIT_USER WHERE org_code = ? AND role = ? AND active = 1 ORDER BY user_id LIMIT 1', ctx.org_code, role);
}

function userOfEmp(ctx, empId) {
  return ctx.db.get('SELECT * FROM AUDIT_USER WHERE org_code = ? AND emp_id = ? AND active = 1', ctx.org_code, empId);
}

// Direct supervisor: the manager of the next office up the tree, or the ED at head office.
function AUDIT_supervisorOf(ctx, user) {
  for (const id of ancestors(ctx, user.office_id)) {
    const o = office(ctx, id);
    if (o.office_level === 'HO') break;
    const mgr = ctx.db.get(
      `SELECT * FROM AUDIT_USER WHERE org_code = ? AND office_id = ? AND role IN ('DM','ZM','AM') AND active = 1`,
      ctx.org_code, id,
    );
    if (mgr) return mgr;
  }
  return userByRole(ctx, 'ED');
}

function branchManager(ctx, officeId) {
  return ctx.db.get(`SELECT * FROM AUDIT_USER WHERE org_code = ? AND office_id = ? AND role = 'BM' AND active = 1`, ctx.org_code, officeId);
}

function userLevel(ctx) {
  const level = ROLE_LEVEL[ctx.user.role];
  need(level, 'Your role cannot plan audits');
  return level;
}

function checkCanAuditOffice(ctx, level, officeId) {
  const lv = ctx.db.get('SELECT * FROM AUDIT_LEVEL WHERE org_code = ? AND level_code = ?', ctx.org_code, level);
  need(lv, `Audit level ${level} is not set up`);
  const o = office(ctx, officeId);
  need(lv.can_audit.split(',').includes(o.office_level), `${lv.name_en} cannot audit a ${o.office_level.toLowerCase()} office`);
  if (level !== 'IA') need(isInside(ctx, officeId, ctx.user.office_id), `${o.name_en} is outside your office scope`);
}

// ------------------------------------------------------------------ approval routing

function policyFor(ctx, appliesTo, level) {
  return ctx.db.get(
    'SELECT * FROM AUDIT_APPROVAL_POLICY WHERE org_code = ? AND applies_to = ? AND audit_level = ?',
    ctx.org_code, appliesTo, level,
  );
}

function approverFor(ctx, policy, submitter) {
  if (policy.approver === 'ED') return userByRole(ctx, 'ED');
  if (policy.approver === 'CAO') return userByRole(ctx, 'CAO');
  if (policy.approver === 'SUPERVISOR') return AUDIT_supervisorOf(ctx, submitter);
  return null;
}

// Creates the approval row. Returns true when the item is auto-approved.
function route(ctx, itemType, itemId, level, label, link) {
  const policy = policyFor(ctx, itemType, level);
  if (!policy || !policy.required) {
    ctx.db.run(
      `INSERT INTO AUDIT_APPROVAL (org_code, item_type, item_id, action, comment, submitted_by, submitted_at, acted_at)
       VALUES (?,?,?,'AUTO','Approval not required by policy',?,?,?)`,
      ctx.org_code, itemType, itemId, ctx.user.user_id, now(ctx), now(ctx),
    );
    return true;
  }
  const approver = approverFor(ctx, policy, ctx.user);
  need(approver, `No approver found for ${itemType.toLowerCase()} (${policy.approver})`);
  ctx.db.run(
    `INSERT INTO AUDIT_APPROVAL (org_code, item_type, item_id, approver_user_id, submitted_by, submitted_at)
     VALUES (?,?,?,?,?,?)`,
    ctx.org_code, itemType, itemId, approver.user_id, ctx.user.user_id, now(ctx),
  );
  notify(ctx, approver.user_id, `${label} is waiting for your approval`, '/approvals');
  return false;
}

// ------------------------------------------------------------------ planning

function AUDIT_PLAN_CREATE(ctx, { plan_year, period = 'YEARLY', remarks = '', items = [] }) {
  const level = userLevel(ctx);
  need(plan_year, 'Plan year is required');
  need(items.length > 0, 'Add at least one branch to the plan');
  return ctx.db.tx(() => {
    const seq = ctx.db.get('SELECT COUNT(*) n FROM AUDIT_PLAN WHERE org_code = ?', ctx.org_code).n + 1;
    const planNo = `PLAN-${level}-${plan_year}-${String(seq).padStart(3, '0')}`;
    const { lastInsertRowid: planId } = ctx.db.run(
      `INSERT INTO AUDIT_PLAN (org_code, plan_no, plan_year, period, audit_level, remarks, status, created_by, created_at)
       VALUES (?,?,?,?,?,?,'DRAFT',?,?)`,
      ctx.org_code, planNo, plan_year, period, level, remarks, ctx.user.user_id, now(ctx),
    );
    for (const it of items) {
      checkCanAuditOffice(ctx, level, Number(it.office_id));
      ctx.db.run(
        'INSERT INTO AUDIT_PLAN_ITEM (org_code, plan_id, plan_month, office_id, type_id, team_id, remarks) VALUES (?,?,?,?,?,?,?)',
        ctx.org_code, planId, it.plan_month, it.office_id, it.type_id, it.team_id || null, it.remarks || null,
      );
    }
    log(ctx, 'CREATE', 'PLAN', planId, { planNo });
    return Number(planId);
  });
}

// Warns when a team is planned for more branches in a month than its level allows.
function AUDIT_PLAN_WARNINGS(ctx, planId) {
  return ctx.db.all(
    `SELECT i.plan_month, t.name team, COUNT(*) n, l.max_per_month
       FROM AUDIT_PLAN_ITEM i JOIN AUDIT_TEAM t ON t.team_id = i.team_id
       JOIN AUDIT_PLAN p ON p.plan_id = i.plan_id
       JOIN AUDIT_LEVEL l ON l.org_code = p.org_code AND l.level_code = p.audit_level
      WHERE i.plan_id = ? AND i.org_code = ?
      GROUP BY i.plan_month, i.team_id HAVING COUNT(*) > l.max_per_month`,
    planId, ctx.org_code,
  );
}

function AUDIT_PLAN_SUBMIT(ctx, planId) {
  const plan = ctx.db.get('SELECT * FROM AUDIT_PLAN WHERE plan_id = ? AND org_code = ?', planId, ctx.org_code);
  need(plan, 'Plan not found');
  need(plan.created_by === ctx.user.user_id, 'Only the planner can submit this plan');
  need(['DRAFT', 'RETURNED'].includes(plan.status), 'This plan is already submitted');
  return ctx.db.tx(() => {
    const auto = route(ctx, 'PLAN', planId, plan.audit_level, `Audit plan ${plan.plan_no}`);
    ctx.db.run('UPDATE AUDIT_PLAN SET status = ? WHERE plan_id = ?', auto ? 'APPROVED' : 'PENDING_APPROVAL', planId);
    log(ctx, 'SUBMIT', 'PLAN', planId);
    return auto ? 'APPROVED' : 'PENDING_APPROVAL';
  });
}

function AUDIT_TEAM_CREATE(ctx, { name, members }) {
  const level = userLevel(ctx);
  need(name, 'Team name is required');
  need(members && members.some((m) => m.member_role === 'LEADER'), 'Pick a team leader');
  return ctx.db.tx(() => {
    const seq = ctx.db.get('SELECT COUNT(*) n FROM AUDIT_TEAM WHERE org_code = ?', ctx.org_code).n + 1;
    const { lastInsertRowid: teamId } = ctx.db.run(
      'INSERT INTO AUDIT_TEAM (org_code, team_code, name, audit_level) VALUES (?,?,?,?)',
      ctx.org_code, `TEAM-${String(seq).padStart(2, '0')}`, name, level,
    );
    for (const m of members) {
      ctx.db.run('INSERT INTO AUDIT_TEAM_MEMBER (org_code, team_id, emp_id, member_role) VALUES (?,?,?,?)',
        ctx.org_code, teamId, m.emp_id, m.member_role);
    }
    log(ctx, 'CREATE', 'TEAM', teamId, { name });
    return Number(teamId);
  });
}

// Conflict check: a team member who works (or worked) in the office being audited.
function AUDIT_TEAM_CONFLICTS(ctx, teamId, officeId) {
  return ctx.db.all(
    `SELECT e.* FROM AUDIT_TEAM_MEMBER m JOIN AUDIT_EMPLOYEE e ON e.emp_id = m.emp_id
      WHERE m.team_id = ? AND m.org_code = ?`, teamId, ctx.org_code,
  ).filter((e) => e.office_id === officeId || (office(ctx, e.office_id).office_level !== 'HO' && isInside(ctx, officeId, e.office_id)));
}

function previousAudit(ctx, officeId, excludeId = 0) {
  return ctx.db.get(
    `SELECT * FROM AUDIT_SCHEDULE WHERE org_code = ? AND office_id = ? AND audit_id <> ?
        AND status IN ('IN_PROGRESS','SUBMITTED','REPORT_APPROVED','UNDER_RESPONSE','CLOSED')
      ORDER BY period_to DESC, audit_id DESC LIMIT 1`,
    ctx.org_code, officeId, excludeId,
  );
}

// Audit period runs from the day after the last audit's cut-off (or the branch open date)
// to the month-end before the audit starts.
function AUDIT_PERIOD(ctx, officeId, startDate) {
  const prev = previousAudit(ctx, officeId);
  const o = office(ctx, officeId);
  return {
    period_from: prev ? addDays(prev.period_to, 1) : (o.open_date || addDays(startDate, -365)),
    period_to: lastMonthEnd(startDate),
    prev_audit_id: prev ? prev.audit_id : null,
  };
}

function AUDIT_SCHEDULE_CREATE(ctx, f) {
  const level = userLevel(ctx);
  need(f.type_id && f.office_id && f.team_id, 'Audit type, office and team are required');
  need(f.start_date && f.end_date && f.end_date >= f.start_date, 'Give a valid start and end date');
  const officeId = Number(f.office_id);
  checkCanAuditOffice(ctx, level, officeId);
  const type = ctx.db.get('SELECT * FROM AUDIT_TYPE WHERE type_id = ? AND org_code = ?', f.type_id, ctx.org_code);
  need(type, 'Audit type not found');
  const kind = f.plan_kind === 'SURPRISE' ? 'SURPRISE' : 'PLANNED';
  const period = AUDIT_PERIOD(ctx, officeId, f.start_date);
  return ctx.db.tx(() => {
    const year = f.start_date.slice(0, 4);
    const seq = ctx.db.get(`SELECT COUNT(*) n FROM AUDIT_SCHEDULE WHERE org_code = ? AND audit_no LIKE ?`, ctx.org_code, `AUD-%-${year}-%`).n + 1;
    const auditNo = `AUD-${type.code}-${year}-${String(seq).padStart(4, '0')}`;
    const { lastInsertRowid: auditId } = ctx.db.run(
      `INSERT INTO AUDIT_SCHEDULE (org_code, audit_no, plan_item_id, type_id, audit_level, office_id, team_id, start_date, end_date,
         period_from, period_to, prev_audit_id, plan_kind, notify_branch, instruction, status, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT',?,?)`,
      ctx.org_code, auditNo, f.plan_item_id || null, type.type_id, level, officeId, f.team_id, f.start_date, f.end_date,
      f.period_from || period.period_from, f.period_to || period.period_to, period.prev_audit_id, kind,
      kind === 'SURPRISE' ? 0 : (f.notify_branch ? 1 : 0), f.instruction || null, ctx.user.user_id, now(ctx),
    );
    log(ctx, 'CREATE', 'SCHEDULE', auditId, { auditNo, kind });
    return Number(auditId);
  });
}

function AUDIT_SCHEDULE_SUBMIT(ctx, auditId) {
  const a = AUDIT_GET(ctx, auditId);
  need(a.created_by === ctx.user.user_id, 'Only the planner can submit this schedule');
  need(['DRAFT', 'RETURNED'].includes(a.status), 'This schedule is already submitted');
  return ctx.db.tx(() => {
    const auto = route(ctx, 'SCHEDULE', auditId, a.audit_level, `Audit schedule ${a.audit_no}`);
    ctx.db.run(`UPDATE AUDIT_SCHEDULE SET status = 'PENDING_APPROVAL' WHERE audit_id = ?`, auditId);
    if (auto) scheduleApproved(ctx, a);
    log(ctx, 'SUBMIT', 'SCHEDULE', auditId);
    return auto ? 'APPROVED' : 'PENDING_APPROVAL';
  });
}

function teamUsers(ctx, teamId) {
  return ctx.db.all(
    `SELECT u.*, m.member_role FROM AUDIT_TEAM_MEMBER m JOIN AUDIT_USER u ON u.emp_id = m.emp_id
      WHERE m.team_id = ? AND m.org_code = ?`, teamId, ctx.org_code,
  );
}

function scheduleApproved(ctx, a) {
  const org = ctx.db.get('SELECT * FROM AUDIT_ORG WHERE org_code = ?', ctx.org_code);
  const year = a.start_date.slice(0, 4);
  const sl = ctx.db.get(`SELECT COUNT(*) n FROM AUDIT_SCHEDULE WHERE org_code = ? AND memo_no IS NOT NULL AND start_date LIKE ?`, ctx.org_code, `${year}%`).n + 1;
  const memo = org.memo_format.replace('{ORG}', org.org_code).replace('{YYYY}', year).replace('{SL}', String(sl).padStart(3, '0'));
  ctx.db.run(`UPDATE AUDIT_SCHEDULE SET status = 'APPROVED', memo_no = ? WHERE audit_id = ?`, memo, a.audit_id);
  for (const u of teamUsers(ctx, a.team_id)) notify(ctx, u.user_id, `Audit ${a.audit_no} is approved. You are in the team.`, `/audits/${a.audit_id}`);
  if (a.plan_kind === 'PLANNED' && a.notify_branch) {
    const bm = branchManager(ctx, a.office_id);
    if (bm) notify(ctx, bm.user_id, `Your branch will be audited from ${a.start_date} to ${a.end_date} (${a.audit_no}).`, `/audits/${a.audit_id}`);
  }
}

function AUDIT_WORKPLAN_SAVE(ctx, rows) {
  const level = userLevel(ctx);
  return ctx.db.tx(() => {
    const policy = policyFor(ctx, 'WORK_PLAN', level);
    const status = policy && policy.required ? 'PENDING_APPROVAL' : 'APPROVED';
    for (const r of rows) {
      need(r.plan_date && r.office_id, 'Each work plan row needs a date and an office');
      ctx.db.run(
        `INSERT INTO AUDIT_WORK_PLAN (org_code, user_id, plan_date, office_id, audit_id, night_stay, morning_plan, afternoon_plan, status)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        ctx.org_code, ctx.user.user_id, r.plan_date, r.office_id, r.audit_id || null, r.night_stay || null,
        r.morning_plan || null, r.afternoon_plan || null, status,
      );
    }
    log(ctx, 'SAVE', 'WORK_PLAN', null, { rows: rows.length });
    return status;
  });
}

// ------------------------------------------------------------------ approval inbox

function AUDIT_APPROVAL_INBOX(ctx) {
  return ctx.db.all(
    `SELECT a.*, u.username submitted_by_name,
            CASE a.item_type
              WHEN 'PLAN' THEN (SELECT plan_no FROM AUDIT_PLAN WHERE plan_id = a.item_id)
              ELSE (SELECT audit_no FROM AUDIT_SCHEDULE WHERE audit_id = a.item_id) END reference
       FROM AUDIT_APPROVAL a JOIN AUDIT_USER u ON u.user_id = a.submitted_by
      WHERE a.org_code = ? AND a.approver_user_id = ? AND a.action = 'PENDING'
      ORDER BY a.submitted_at`,
    ctx.org_code, ctx.user.user_id,
  );
}

function AUDIT_APPROVAL_HISTORY(ctx, itemType, itemId) {
  return ctx.db.all(
    `SELECT a.*, s.username submitted_by_name, p.username approver_name
       FROM AUDIT_APPROVAL a LEFT JOIN AUDIT_USER s ON s.user_id = a.submitted_by
       LEFT JOIN AUDIT_USER p ON p.user_id = a.approver_user_id
      WHERE a.org_code = ? AND a.item_type = ? AND a.item_id = ? ORDER BY a.appr_id`,
    ctx.org_code, itemType, itemId,
  );
}

function AUDIT_APPROVAL_ACT(ctx, apprId, action, comment = '') {
  const ap = ctx.db.get('SELECT * FROM AUDIT_APPROVAL WHERE appr_id = ? AND org_code = ?', apprId, ctx.org_code);
  need(ap, 'Approval item not found');
  need(ap.approver_user_id === ctx.user.user_id, 'This item is not waiting for you');
  need(ap.action === 'PENDING', 'This item is already decided');
  need(['APPROVED', 'RETURNED', 'REJECTED'].includes(action), 'Unknown action');
  need(action === 'APPROVED' || comment.trim(), 'Write a comment when you return or reject');
  return ctx.db.tx(() => {
    ctx.db.run('UPDATE AUDIT_APPROVAL SET action = ?, comment = ?, acted_at = ? WHERE appr_id = ?', action, comment, now(ctx), apprId);
    if (ap.item_type === 'PLAN') {
      ctx.db.run('UPDATE AUDIT_PLAN SET status = ? WHERE plan_id = ?', action, ap.item_id);
      notify(ctx, ap.submitted_by, `Your audit plan was ${action.toLowerCase()}`, `/plans/${ap.item_id}`);
    } else if (ap.item_type === 'SCHEDULE') {
      const a = AUDIT_GET(ctx, ap.item_id);
      if (action === 'APPROVED') scheduleApproved(ctx, a);
      else ctx.db.run('UPDATE AUDIT_SCHEDULE SET status = ? WHERE audit_id = ?', action, ap.item_id);
      notify(ctx, ap.submitted_by, `Audit schedule ${a.audit_no} was ${action.toLowerCase()}`, `/audits/${a.audit_id}`);
    } else if (ap.item_type === 'REPORT') {
      const a = AUDIT_GET(ctx, ap.item_id);
      const status = action === 'APPROVED' ? 'REPORT_APPROVED' : 'IN_PROGRESS';
      ctx.db.run('UPDATE AUDIT_SCHEDULE SET status = ? WHERE audit_id = ?', status, ap.item_id);
      for (const u of teamUsers(ctx, a.team_id)) {
        notify(ctx, u.user_id, action === 'APPROVED' ? `Report of ${a.audit_no} is approved` : `Report of ${a.audit_no} was returned: ${comment}`, `/audits/${a.audit_id}`);
      }
    }
    log(ctx, action, ap.item_type, ap.item_id, { comment });
    return action;
  });
}

// ------------------------------------------------------------------ audit file access

function AUDIT_GET(ctx, auditId) {
  const a = ctx.db.get(
    `SELECT s.*, o.name_en office_en, o.name_bn office_bn, o.office_code, o.office_level, t.name team_name,
            ty.name_en type_en, ty.name_bn type_bn, ty.code type_code, ty.full_checklist
       FROM AUDIT_SCHEDULE s JOIN AUDIT_OFFICE o ON o.office_id = s.office_id
       JOIN AUDIT_TEAM t ON t.team_id = s.team_id JOIN AUDIT_TYPE ty ON ty.type_id = s.type_id
      WHERE s.audit_id = ? AND s.org_code = ?`, auditId, ctx.org_code,
  );
  need(a, 'Audit not found');
  return a;
}

function isTeamMember(ctx, a) {
  if (!ctx.user.emp_id) return false;
  return !!ctx.db.get('SELECT 1 FROM AUDIT_TEAM_MEMBER WHERE team_id = ? AND emp_id = ?', a.team_id, ctx.user.emp_id);
}

function isTeamLeader(ctx, a) {
  if (!ctx.user.emp_id) return false;
  return !!ctx.db.get(`SELECT 1 FROM AUDIT_TEAM_MEMBER WHERE team_id = ? AND emp_id = ? AND member_role = 'LEADER'`, a.team_id, ctx.user.emp_id);
}

const BRANCH_VISIBLE = ['IN_PROGRESS', 'SUBMITTED', 'REPORT_APPROVED', 'UNDER_RESPONSE', 'CLOSED'];

// Can the logged-in user open this audit at all?
function AUDIT_canView(ctx, a) {
  const u = ctx.user;
  if (HO_ROLES.includes(u.role)) return true;
  if (isTeamMember(ctx, a) || a.created_by === u.user_id) return true;
  if (MANAGER_ROLES.includes(u.role)) {
    // A manager sees audits in their tree, but a surprise audit only once it has started.
    return isInside(ctx, a.office_id, u.office_id) && (a.plan_kind === 'PLANNED' || BRANCH_VISIBLE.includes(a.status));
  }
  if (u.role === 'BM') {
    if (a.office_id !== u.office_id) return false;
    if (BRANCH_VISIBLE.includes(a.status)) return true;
    return a.status === 'APPROVED' && a.plan_kind === 'PLANNED' && !!a.notify_branch;
  }
  return false;
}

function AUDIT_LIST(ctx, { status } = {}) {
  const rows = ctx.db.all(
    `SELECT s.*, o.name_en office_en, o.name_bn office_bn, ty.name_en type_en, ty.name_bn type_bn, t.name team_name,
            (SELECT COUNT(*) FROM AUDIT_OBSERVATION b WHERE b.audit_id = s.audit_id) obs_count
       FROM AUDIT_SCHEDULE s JOIN AUDIT_OFFICE o ON o.office_id = s.office_id
       JOIN AUDIT_TYPE ty ON ty.type_id = s.type_id JOIN AUDIT_TEAM t ON t.team_id = s.team_id
      WHERE s.org_code = ? ${status ? 'AND s.status = ?' : ''}
      ORDER BY s.start_date DESC, s.audit_id DESC`,
    ...[ctx.org_code, ...(status ? [status] : [])],
  );
  return rows.filter((a) => AUDIT_canView(ctx, a));
}

function needTeam(ctx, a, statuses) {
  need(isTeamMember(ctx, a), 'Only the audit team can do this');
  need(statuses.includes(a.status), `Not allowed while the audit is ${a.status.replace(/_/g, ' ').toLowerCase()}`);
}

// ------------------------------------------------------------------ field audit

function AUDIT_START(ctx, auditId) {
  const a = AUDIT_GET(ctx, auditId);
  needTeam(ctx, a, ['APPROVED']);
  ctx.db.tx(() => {
    ctx.db.run(`UPDATE AUDIT_SCHEDULE SET status = 'IN_PROGRESS', started_at = ? WHERE audit_id = ?`, now(ctx), auditId);
    const bm = branchManager(ctx, a.office_id);
    if (bm) notify(ctx, bm.user_id, `Audit ${a.audit_no} has started at your office`, `/audits/${a.audit_id}`);
    log(ctx, 'START', 'SCHEDULE', auditId);
  });
}

function AUDIT_CHECKLIST(ctx, a) {
  return ctx.db.all(
    `SELECT c.*, ar.serial area_serial, ar.name_en area_en, ar.name_bn area_bn, ans.answer, ans.comment
       FROM AUDIT_CHECKPOINT c JOIN AUDIT_AREA ar ON ar.area_id = c.area_id
       LEFT JOIN AUDIT_CHECK_ANSWER ans ON ans.cp_id = c.cp_id AND ans.audit_id = ?
      WHERE c.org_code = ? AND c.active = 1 ORDER BY ar.serial, c.cp_id`,
    a.audit_id, ctx.org_code,
  );
}

function AUDIT_CHECK_SAVE(ctx, auditId, answers) {
  const a = AUDIT_GET(ctx, auditId);
  needTeam(ctx, a, ['IN_PROGRESS']);
  ctx.db.tx(() => {
    for (const [cpId, v] of Object.entries(answers)) {
      if (!v.answer && !v.comment) continue;
      ctx.db.run(
        `INSERT INTO AUDIT_CHECK_ANSWER (org_code, audit_id, cp_id, answer, comment, answered_by, answered_at) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT (audit_id, cp_id) DO UPDATE SET answer = excluded.answer, comment = excluded.comment,
           answered_by = excluded.answered_by, answered_at = excluded.answered_at`,
        ctx.org_code, auditId, Number(cpId), v.answer || null, v.comment || null, ctx.user.user_id, now(ctx),
      );
    }
    log(ctx, 'SAVE', 'CHECKLIST', auditId);
  });
}

// Open observations of earlier audits of the same office, to be followed up first.
function AUDIT_PREVIOUS_OPEN(ctx, a) {
  return ctx.db.all(
    `SELECT b.*, s.audit_no FROM AUDIT_OBSERVATION b JOIN AUDIT_SCHEDULE s ON s.audit_id = b.audit_id
      WHERE b.org_code = ? AND s.office_id = ? AND s.audit_id <> ? AND s.start_date < ?
        AND s.status IN ('UNDER_RESPONSE','CLOSED') AND b.status NOT IN ('CLOSED','CARRIED_FORWARD') ORDER BY b.obs_id`,
    ctx.org_code, a.office_id, a.audit_id, a.start_date,
  );
}

function AUDIT_FOLLOWUP_SAVE(ctx, auditId, prevObsId, currentStatus, note) {
  const a = AUDIT_GET(ctx, auditId);
  needTeam(ctx, a, ['IN_PROGRESS']);
  const prev = AUDIT_PREVIOUS_OPEN(ctx, a).find((b) => b.obs_id === Number(prevObsId));
  need(prev, 'That observation is not open for follow-up');
  need(['RESOLVED', 'PARTLY', 'NOT_RESOLVED'].includes(currentStatus), 'Pick the current status');
  need(note && note.trim(), 'Write the current position');
  return ctx.db.tx(() => {
    if (currentStatus === 'RESOLVED') {
      ctx.db.run(`UPDATE AUDIT_OBSERVATION SET status = 'CLOSED', closed_by = ?, closed_at = ? WHERE obs_id = ?`, ctx.user.user_id, now(ctx), prev.obs_id);
      addResponse(ctx, prev.obs_id, 'FOLLOWUP', `Resolved, found in follow-up of ${a.audit_no}: ${note}`);
      return null;
    }
    const newId = insertObservation(ctx, a, {
      area_id: prev.area_id, cp_id: prev.cp_id, is_financial: prev.is_financial, title: prev.title,
      details: `${prev.details}\n\n[${currentStatus === 'PARTLY' ? 'Partly resolved' : 'Not resolved'} at follow-up] ${note}`,
      auditor_comment: prev.auditor_comment, recommendation: prev.recommendation, risk_code: prev.risk_code,
      amount: prev.amount, carried_from_obs_id: prev.obs_id, show_cause: prev.show_cause, confidential: prev.confidential,
    });
    for (const p of ctx.db.all('SELECT * FROM AUDIT_OBS_PERSON WHERE obs_id = ?', prev.obs_id)) {
      ctx.db.run('INSERT INTO AUDIT_OBS_PERSON (org_code, obs_id, emp_id, person_role) VALUES (?,?,?,?)', ctx.org_code, newId, p.emp_id, p.person_role);
    }
    ctx.db.run(`UPDATE AUDIT_OBSERVATION SET status = 'CARRIED_FORWARD' WHERE obs_id = ?`, prev.obs_id);
    addResponse(ctx, prev.obs_id, 'CARRY', `Carried forward to ${a.audit_no}: ${note}`);
    return newId;
  });
}

function insertObservation(ctx, a, f) {
  const n = ctx.db.get('SELECT COUNT(*) n FROM AUDIT_OBSERVATION WHERE audit_id = ?', a.audit_id).n + 1;
  const { lastInsertRowid } = ctx.db.run(
    `INSERT INTO AUDIT_OBSERVATION (org_code, obs_no, audit_id, area_id, cp_id, is_financial, title, details, auditor_comment,
       recommendation, risk_code, amount, corrected_on_spot, correction_note, confidential, show_cause, status,
       carried_from_obs_id, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'OPEN',?,?,?)`,
    ctx.org_code, `${a.audit_no}/${String(n).padStart(2, '0')}`, a.audit_id, f.area_id || null, f.cp_id || null,
    f.is_financial ? 1 : 0, f.title, f.details, f.auditor_comment || null, f.recommendation || null, f.risk_code,
    Number(f.amount) || 0, f.corrected_on_spot ? 1 : 0, f.correction_note || null, f.confidential ? 1 : 0,
    f.show_cause ? 1 : 0, f.carried_from_obs_id || null, ctx.user.user_id, now(ctx),
  );
  return Number(lastInsertRowid);
}

function AUDIT_OBS_CREATE(ctx, auditId, f, persons = []) {
  const a = AUDIT_GET(ctx, auditId);
  needTeam(ctx, a, ['IN_PROGRESS']);
  need(f.title && f.title.trim(), 'Title is required');
  need(f.details && f.details.trim(), 'Observation details are required');
  need(ctx.db.get('SELECT 1 FROM AUDIT_RISK_LEVEL WHERE org_code = ? AND risk_code = ?', ctx.org_code, f.risk_code), 'Pick a risk level');
  if (f.is_financial) need(Number(f.amount) > 0, 'A financial irregularity needs the amount involved');
  return ctx.db.tx(() => {
    const id = insertObservation(ctx, a, f);
    for (const p of persons) {
      ctx.db.run('INSERT INTO AUDIT_OBS_PERSON (org_code, obs_id, emp_id, person_role) VALUES (?,?,?,?)',
        ctx.org_code, id, p.emp_id, p.person_role || 'MAIN');
    }
    log(ctx, 'CREATE', 'OBSERVATION', id, { title: f.title });
    return id;
  });
}

function AUDIT_OBS_DELETE(ctx, obsId) {
  const obs = AUDIT_OBS_GET(ctx, obsId);
  const a = AUDIT_GET(ctx, obs.audit_id);
  needTeam(ctx, a, ['IN_PROGRESS']);
  need(!obs.carried_from_obs_id, 'A carried-forward observation cannot be deleted');
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM AUDIT_OBS_PERSON WHERE obs_id = ?', obsId);
    ctx.db.run('DELETE FROM AUDIT_OBS_RESPONSE WHERE obs_id = ?', obsId);
    ctx.db.run('DELETE FROM AUDIT_OBSERVATION WHERE obs_id = ?', obsId);
    log(ctx, 'DELETE', 'OBSERVATION', obsId, { title: obs.title });
  });
}

function AUDIT_FRAUD_ADD(ctx, auditId, f) {
  const a = AUDIT_GET(ctx, auditId);
  needTeam(ctx, a, ['IN_PROGRESS']);
  need(f.emp_id && Number(f.amount) > 0, 'Staff and amount are required');
  const { lastInsertRowid } = ctx.db.run(
    `INSERT INTO AUDIT_FRAUD (org_code, audit_id, emp_id, fraud_type, amount, found_date, how_found, recovered_spot, remarks)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    ctx.org_code, auditId, f.emp_id, f.fraud_type || 'MISAPPROPRIATED', Number(f.amount), f.found_date || today(ctx),
    f.how_found || null, Number(f.recovered_spot) || 0, f.remarks || null,
  );
  log(ctx, 'CREATE', 'FRAUD', Number(lastInsertRowid));
  return Number(lastInsertRowid);
}

function AUDIT_FRAUD_LIST(ctx, auditId) {
  return ctx.db.all(
    `SELECT f.*, e.pin, e.name_en, e.name_bn, e.designation FROM AUDIT_FRAUD f JOIN AUDIT_EMPLOYEE e ON e.emp_id = f.emp_id
      WHERE f.audit_id = ? AND f.org_code = ? ORDER BY f.fraud_id`, auditId, ctx.org_code,
  );
}

// What still blocks submission of an audit.
function AUDIT_SUBMIT_CHECK(ctx, a) {
  const problems = [];
  if (a.full_checklist) {
    const unanswered = AUDIT_CHECKLIST(ctx, a).filter((c) => !c.answer).length;
    if (unanswered) problems.push(`${unanswered} checklist question(s) are not answered`);
  }
  const pending = AUDIT_PREVIOUS_OPEN(ctx, a).length;
  if (pending) problems.push(`${pending} observation(s) of the previous audit are not followed up`);
  for (const b of AUDIT_OBS_LIST(ctx, a.audit_id)) {
    if (b.is_financial && !(b.amount > 0)) problems.push(`${b.obs_no} needs the amount involved`);
    if (!b.persons.length && !b.corrected_on_spot) problems.push(`${b.obs_no} needs at least one responsible person`);
  }
  return problems;
}

function AUDIT_SUBMIT(ctx, auditId, { ack_name, ack_comment } = {}) {
  const a = AUDIT_GET(ctx, auditId);
  needTeam(ctx, a, ['IN_PROGRESS']);
  need(isTeamLeader(ctx, a), 'Only the team leader can submit the audit');
  const problems = AUDIT_SUBMIT_CHECK(ctx, a);
  need(!problems.length, `Cannot submit yet: ${problems.join('; ')}`);
  return ctx.db.tx(() => {
    ctx.db.run(
      `UPDATE AUDIT_SCHEDULE SET status = 'SUBMITTED', submitted_at = ?, branch_ack_name = ?, branch_ack_comment = ? WHERE audit_id = ?`,
      now(ctx), ack_name || null, ack_comment || null, auditId,
    );
    const auto = route(ctx, 'REPORT', auditId, a.audit_level, `Audit report ${a.audit_no}`);
    if (auto) ctx.db.run(`UPDATE AUDIT_SCHEDULE SET status = 'REPORT_APPROVED' WHERE audit_id = ?`, auditId);
    log(ctx, 'SUBMIT', 'REPORT', auditId);
  });
}

// Who may release the report, verify replies' closure and close the audit:
// head office for IA audits, the auditing manager or their supervisor for manager audits.
function canManageAudit(ctx, a) {
  if (hasRole(ctx, 'ED', 'CAO')) return true;
  if (a.audit_level === 'IA') return false;
  if (a.created_by === ctx.user.user_id) return true;
  const creator = ctx.db.get('SELECT * FROM AUDIT_USER WHERE user_id = ?', a.created_by);
  const sup = AUDIT_supervisorOf(ctx, creator);
  return !!sup && sup.user_id === ctx.user.user_id;
}

function AUDIT_RELEASE(ctx, auditId) {
  const a = AUDIT_GET(ctx, auditId);
  need(canManageAudit(ctx, a), 'You cannot release this report');
  need(a.status === 'REPORT_APPROVED', 'The report must be approved before release');
  return ctx.db.tx(() => {
    const risks = Object.fromEntries(ctx.db.all('SELECT * FROM AUDIT_RISK_LEVEL WHERE org_code = ?', ctx.org_code).map((r) => [r.risk_code, r]));
    const bm = branchManager(ctx, a.office_id);
    for (const b of ctx.db.all(`SELECT * FROM AUDIT_OBSERVATION WHERE audit_id = ? AND status = 'OPEN'`, auditId)) {
      if (b.corrected_on_spot) {
        ctx.db.run(`UPDATE AUDIT_OBSERVATION SET status = 'RESOLVED' WHERE obs_id = ?`, b.obs_id);
        addResponse(ctx, b.obs_id, 'ACCEPT', `Corrected on the spot during audit: ${b.correction_note || ''}`.trim());
        continue;
      }
      const deadline = AUDIT_addWorkingDays(today(ctx), (risks[b.risk_code] || { reply_days: 5 }).reply_days);
      ctx.db.run(`UPDATE AUDIT_OBSERVATION SET status = 'SENT', deadline = ? WHERE obs_id = ?`, deadline, b.obs_id);
      if (b.confidential) continue;
      const people = ctx.db.all('SELECT * FROM AUDIT_OBS_PERSON WHERE obs_id = ?', b.obs_id);
      for (const p of people) {
        const u = userOfEmp(ctx, p.emp_id);
        if (u) notify(ctx, u.user_id, `Observation ${b.obs_no} names you. Reply by ${deadline}.`, `/observations/${b.obs_id}`);
      }
      if (bm) notify(ctx, bm.user_id, `Observation ${b.obs_no} sent to your branch. Reply by ${deadline}.`, `/observations/${b.obs_id}`);
    }
    ctx.db.run(`UPDATE AUDIT_SCHEDULE SET status = 'UNDER_RESPONSE', released_at = ? WHERE audit_id = ?`, now(ctx), auditId);
    log(ctx, 'RELEASE', 'REPORT', auditId);
  });
}

// ------------------------------------------------------------------ observations and responses

function AUDIT_OBS_GET(ctx, obsId) {
  const b = ctx.db.get(
    `SELECT b.*, r.name_en risk_en, r.name_bn risk_bn, r.colour risk_colour, ar.name_en area_en, ar.name_bn area_bn
       FROM AUDIT_OBSERVATION b LEFT JOIN AUDIT_RISK_LEVEL r ON r.org_code = b.org_code AND r.risk_code = b.risk_code
       LEFT JOIN AUDIT_AREA ar ON ar.area_id = b.area_id WHERE b.obs_id = ? AND b.org_code = ?`, obsId, ctx.org_code,
  );
  need(b, 'Observation not found');
  b.persons = ctx.db.all(
    `SELECT p.*, e.pin, e.name_en, e.name_bn, e.designation FROM AUDIT_OBS_PERSON p JOIN AUDIT_EMPLOYEE e ON e.emp_id = p.emp_id
      WHERE p.obs_id = ?`, obsId,
  );
  b.recovered = ctx.db.get('SELECT COALESCE(SUM(amount),0) s FROM AUDIT_RECOVERY WHERE obs_id = ?', obsId).s;
  b.overdue = OBS_AWAITING_REPLY.includes(b.status) && b.deadline && b.deadline < today(ctx);
  return b;
}

function AUDIT_OBS_LIST(ctx, auditId) {
  const ids = ctx.db.all('SELECT obs_id FROM AUDIT_OBSERVATION WHERE audit_id = ? AND org_code = ? ORDER BY obs_id', auditId, ctx.org_code);
  return ids.map((r) => AUDIT_OBS_GET(ctx, r.obs_id)).filter((b) => !b.confidential || hasRole(ctx, 'ED', 'CAO') || isTeamMemberOfObs(ctx, b));
}

function isTeamMemberOfObs(ctx, b) {
  return isTeamMember(ctx, AUDIT_GET(ctx, b.audit_id));
}

function isNamed(ctx, b) {
  return !!ctx.user.emp_id && b.persons.some((p) => p.emp_id === ctx.user.emp_id);
}

function AUDIT_OBS_canView(ctx, b) {
  const a = AUDIT_GET(ctx, b.audit_id);
  if (b.confidential) return hasRole(ctx, 'ED', 'CAO') || isTeamMember(ctx, a);
  if (isNamed(ctx, b) && b.status !== 'OPEN') return true;
  if (!AUDIT_canView(ctx, a)) return false;
  // Branch side only sees observations after the report is released.
  if (['BM', 'STAFF'].includes(ctx.user.role)) return b.status !== 'OPEN';
  return true;
}

// Observations waiting for the logged-in auditee: those naming them, plus all of their branch for a BM.
function AUDIT_MY_OBSERVATIONS(ctx) {
  const rows = ctx.db.all(
    `SELECT DISTINCT b.obs_id FROM AUDIT_OBSERVATION b JOIN AUDIT_SCHEDULE s ON s.audit_id = b.audit_id
       LEFT JOIN AUDIT_OBS_PERSON p ON p.obs_id = b.obs_id
      WHERE b.org_code = ? AND b.confidential = 0 AND b.status NOT IN ('OPEN')
        AND (p.emp_id = ? OR (? = 'BM' AND s.office_id = ?))
      ORDER BY b.deadline`,
    ctx.org_code, ctx.user.emp_id || -1, ctx.user.role, ctx.user.office_id,
  );
  return rows.map((r) => AUDIT_OBS_GET(ctx, r.obs_id)).map((b) => {
    const mine = b.persons.find((p) => p.emp_id === ctx.user.emp_id);
    b.my_role = mine ? mine.person_role : 'BM';
    return b;
  });
}

function addResponse(ctx, obsId, kind, text, extra = {}) {
  ctx.db.run(
    `INSERT INTO AUDIT_OBS_RESPONSE (org_code, obs_id, user_id, kind, response_type, text, action_taken, amount_recovered, new_deadline, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ctx.org_code, obsId, ctx.user.user_id, kind, extra.response_type || null, text, extra.action_taken || null,
    Number(extra.amount_recovered) || 0, extra.new_deadline || null, now(ctx),
  );
}

function AUDIT_OBS_HISTORY(ctx, obsId) {
  return ctx.db.all(
    `SELECT r.*, u.username, u.role, e.name_en, e.name_bn, e.designation FROM AUDIT_OBS_RESPONSE r
       JOIN AUDIT_USER u ON u.user_id = r.user_id LEFT JOIN AUDIT_EMPLOYEE e ON e.emp_id = u.emp_id
      WHERE r.obs_id = ? AND r.org_code = ? ORDER BY r.resp_id`, obsId, ctx.org_code,
  );
}

function AUDIT_OBS_canRespond(ctx, b) {
  if (!OBS_AWAITING_REPLY.includes(b.status) || b.confidential) return false;
  const a = AUDIT_GET(ctx, b.audit_id);
  return isNamed(ctx, b) || (ctx.user.role === 'BM' && a.office_id === ctx.user.office_id);
}

function AUDIT_OBS_RESPOND(ctx, obsId, f) {
  const b = AUDIT_OBS_GET(ctx, obsId);
  need(AUDIT_OBS_canRespond(ctx, b), 'You cannot reply to this observation now');
  need(f.text && f.text.trim(), 'Write your reply');
  need(f.response_type !== 'MORE_TIME' || f.new_deadline, 'Give the proposed completion date');
  return ctx.db.tx(() => {
    addResponse(ctx, obsId, 'REPLY', f.text, f);
    ctx.db.run(`UPDATE AUDIT_OBSERVATION SET status = 'REPLIED' WHERE obs_id = ?`, obsId);
    const a = AUDIT_GET(ctx, b.audit_id);
    for (const u of teamUsers(ctx, a.team_id)) notify(ctx, u.user_id, `${b.obs_no} has a reply to verify`, `/observations/${obsId}`);
    log(ctx, 'REPLY', 'OBSERVATION', obsId);
  });
}

function AUDIT_OBS_canSupervise(ctx, b) {
  if (!MANAGER_ROLES.includes(ctx.user.role) || b.status === 'OPEN') return false;
  const a = AUDIT_GET(ctx, b.audit_id);
  return a.office_id !== ctx.user.office_id && isInside(ctx, a.office_id, ctx.user.office_id) && !b.confidential;
}

function AUDIT_OBS_SUPERVISOR_COMMENT(ctx, obsId, text) {
  const b = AUDIT_OBS_GET(ctx, obsId);
  need(AUDIT_OBS_canSupervise(ctx, b), 'Only the supervisor of this branch can comment');
  need(text && text.trim(), 'Write a comment');
  ctx.db.tx(() => {
    addResponse(ctx, obsId, 'SUPERVISOR', text);
    log(ctx, 'COMMENT', 'OBSERVATION', obsId);
  });
}

function AUDIT_OBS_canVerify(ctx, b) {
  if (b.status !== 'REPLIED') return false;
  const a = AUDIT_GET(ctx, b.audit_id);
  return isTeamMember(ctx, a) || canManageAudit(ctx, a);
}

function AUDIT_OBS_VERIFY(ctx, obsId, decision, comment, newDeadline) {
  const b = AUDIT_OBS_GET(ctx, obsId);
  need(AUDIT_OBS_canVerify(ctx, b), 'You cannot verify this reply');
  need(['ACCEPT', 'PARTLY', 'REISSUE'].includes(decision), 'Pick a decision');
  need(comment && comment.trim(), 'Write a verification comment');
  return ctx.db.tx(() => {
    const lastReply = ctx.db.get(`SELECT * FROM AUDIT_OBS_RESPONSE WHERE obs_id = ? AND kind = 'REPLY' ORDER BY resp_id DESC LIMIT 1`, obsId);
    if (decision !== 'REISSUE' && lastReply && lastReply.amount_recovered > 0) {
      ctx.db.run(
        'INSERT INTO AUDIT_RECOVERY (org_code, obs_id, rec_date, amount, mode, voucher_no, entered_by) VALUES (?,?,?,?,?,?,?)',
        ctx.org_code, obsId, today(ctx), lastReply.amount_recovered, 'CASH', 'From reply', ctx.user.user_id,
      );
    }
    const status = { ACCEPT: 'RESOLVED', PARTLY: 'PARTLY', REISSUE: 'REISSUED' }[decision];
    const deadline = decision === 'ACCEPT' ? b.deadline : (newDeadline || AUDIT_addWorkingDays(today(ctx), 5));
    ctx.db.run('UPDATE AUDIT_OBSERVATION SET status = ?, deadline = ? WHERE obs_id = ?', status, deadline, obsId);
    addResponse(ctx, obsId, decision, comment, { new_deadline: decision === 'ACCEPT' ? null : deadline });
    if (lastReply) notify(ctx, lastReply.user_id, `Your reply on ${b.obs_no}: ${status.toLowerCase()}`, `/observations/${obsId}`);
    log(ctx, decision, 'OBSERVATION', obsId);
    return status;
  });
}

function AUDIT_RECOVERY_ADD(ctx, obsId, f) {
  const b = AUDIT_OBS_GET(ctx, obsId);
  const a = AUDIT_GET(ctx, b.audit_id);
  need(isTeamMember(ctx, a) || canManageAudit(ctx, a), 'You cannot record recovery here');
  need(Number(f.amount) > 0, 'Amount is required');
  ctx.db.run(
    'INSERT INTO AUDIT_RECOVERY (org_code, obs_id, rec_date, amount, mode, voucher_no, entered_by) VALUES (?,?,?,?,?,?,?)',
    ctx.org_code, obsId, f.rec_date || today(ctx), Number(f.amount), f.mode || 'CASH', f.voucher_no || null, ctx.user.user_id,
  );
  log(ctx, 'RECOVERY', 'OBSERVATION', obsId, { amount: f.amount });
}

function AUDIT_OBS_canClose(ctx, b) {
  return b.status === 'RESOLVED' && canManageAudit(ctx, AUDIT_GET(ctx, b.audit_id));
}

function AUDIT_OBS_CLOSE(ctx, obsId, comment) {
  const b = AUDIT_OBS_GET(ctx, obsId);
  need(AUDIT_OBS_canClose(ctx, b), 'Only a resolved observation can be closed, by an authorised user');
  need(!b.is_financial || b.recovered >= b.amount, `Recovered ${b.recovered} of ${b.amount}. A financial observation closes only when fully recovered.`);
  ctx.db.tx(() => {
    ctx.db.run(`UPDATE AUDIT_OBSERVATION SET status = 'CLOSED', closed_by = ?, closed_at = ? WHERE obs_id = ?`, ctx.user.user_id, now(ctx), obsId);
    addResponse(ctx, obsId, 'CLOSE', comment || 'Closed');
    log(ctx, 'CLOSE', 'OBSERVATION', obsId);
  });
}

// Branch risk rating from the observations of its latest audit.
function riskRating(ctx, auditId) {
  const counts = Object.fromEntries(
    ctx.db.all('SELECT risk_code, COUNT(*) n FROM AUDIT_OBSERVATION WHERE audit_id = ? GROUP BY risk_code', auditId).map((r) => [r.risk_code, r.n]),
  );
  const fraud = ctx.db.get('SELECT COUNT(*) n FROM AUDIT_FRAUD WHERE audit_id = ?', auditId).n;
  if ((counts.CRITICAL || 0) > 0 || (counts.HIGH || 0) >= 3 || fraud > 0) return 'HIGH';
  if ((counts.HIGH || 0) >= 1 || (counts.MEDIUM || 0) >= 3) return 'MEDIUM';
  return 'LOW';
}

function AUDIT_CLOSE(ctx, auditId) {
  const a = AUDIT_GET(ctx, auditId);
  need(canManageAudit(ctx, a), 'You cannot close this audit');
  need(a.status === 'UNDER_RESPONSE', 'Only a released audit can be closed');
  const pending = ctx.db.get(`SELECT COUNT(*) n FROM AUDIT_OBSERVATION WHERE audit_id = ? AND status NOT IN ('CLOSED','CARRIED_FORWARD')`, auditId).n;
  need(!pending, `${pending} observation(s) are still open. Close them, or carry them forward in the next audit.`);
  ctx.db.tx(() => {
    const rating = riskRating(ctx, auditId);
    ctx.db.run(`UPDATE AUDIT_SCHEDULE SET status = 'CLOSED', closed_at = ? WHERE audit_id = ?`, now(ctx), auditId);
    ctx.db.run('UPDATE AUDIT_OFFICE SET risk_rating = ? WHERE office_id = ?', rating, a.office_id);
    log(ctx, 'CLOSE', 'SCHEDULE', auditId, { rating });
  });
}

// ------------------------------------------------------------------ indicators and branch data

function AUDIT_INDICATORS_AT(ctx, date) {
  return ctx.db.all(
    `SELECT * FROM AUDIT_INDICATOR WHERE org_code = ? AND active = 1 AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?) ORDER BY report_order, ind_id`,
    ctx.org_code, date, date,
  );
}

function AUDIT_RISK_OF(ind, value) {
  if (value === null || value === undefined) return null;
  const tol = (ind.tolerance_pct || 0) / 100;
  if (ind.std_min !== null && value < ind.std_min) return value >= ind.std_min * (1 - tol) ? 'MEDIUM' : 'HIGH';
  if (ind.std_max !== null && value > ind.std_max) return value <= ind.std_max * (1 + tol) ? 'MEDIUM' : 'HIGH';
  return 'LOW';
}

function branchValue(ctx, officeId, code, asOn) {
  const r = ctx.db.get(
    'SELECT value FROM AUDIT_BRANCH_DATA WHERE office_id = ? AND ind_code = ? AND as_on <= ? ORDER BY as_on DESC LIMIT 1',
    officeId, code, asOn,
  );
  return r ? r.value : null;
}

// Current cut-off vs last audit vs standard, with the automatic risk level.
function AUDIT_COMPARISON(ctx, a) {
  const prev = a.prev_audit_id ? ctx.db.get('SELECT * FROM AUDIT_SCHEDULE WHERE audit_id = ?', a.prev_audit_id) : null;
  return AUDIT_INDICATORS_AT(ctx, a.period_to).map((ind) => {
    const current = branchValue(ctx, a.office_id, ind.code, a.period_to);
    const last = prev ? branchValue(ctx, a.office_id, ind.code, prev.period_to) : null;
    return { ...ind, current, last, risk: AUDIT_RISK_OF(ind, current) };
  });
}

function AUDIT_INDICATOR_SAVE(ctx, indId, f) {
  need(ctx.user.role === 'ADMIN', 'Only the organization admin can change indicators');
  need(f.code && f.name_en && f.name_bn, 'Code and names are required');
  const num = (v) => (v === '' || v === undefined || v === null ? null : Number(v));
  return ctx.db.tx(() => {
    const from = f.effective_from || today(ctx);
    if (indId) {
      const old = ctx.db.get('SELECT * FROM AUDIT_INDICATOR WHERE ind_id = ? AND org_code = ?', indId, ctx.org_code);
      need(old && !old.effective_to, 'Only the current row of an indicator can be edited');
      need(from > old.effective_from, 'The new standard must start after the current one');
      ctx.db.run('UPDATE AUDIT_INDICATOR SET effective_to = ? WHERE ind_id = ?', addDays(from, -1), indId);
    } else {
      need(!ctx.db.get('SELECT 1 FROM AUDIT_INDICATOR WHERE org_code = ? AND code = ? AND effective_to IS NULL', ctx.org_code, f.code), 'This indicator code already exists');
    }
    const { lastInsertRowid } = ctx.db.run(
      `INSERT INTO AUDIT_INDICATOR (org_code, code, name_en, name_bn, grp, unit, std_source, std_min, std_max, tolerance_pct,
         show_in_report, report_order, effective_from, changed_by, changed_at, active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ctx.org_code, f.code, f.name_en, f.name_bn, f.grp || 'Others', f.unit || 'NUMBER', f.std_source || 'PKSF',
      num(f.std_min), num(f.std_max), num(f.tolerance_pct) ?? 10, f.show_in_report ? 1 : 0, Number(f.report_order) || 0,
      from, ctx.user.user_id, now(ctx), f.active === undefined || f.active ? 1 : 0,
    );
    log(ctx, indId ? 'UPDATE' : 'CREATE', 'INDICATOR', Number(lastInsertRowid), { code: f.code, from });
    return Number(lastInsertRowid);
  });
}

function AUDIT_POLICY_SAVE(ctx, policyId, required, approver) {
  need(ctx.user.role === 'ADMIN', 'Only the organization admin can change approval policy');
  need(['NONE', 'ED', 'CAO', 'SUPERVISOR'].includes(approver), 'Unknown approver');
  ctx.db.run('UPDATE AUDIT_APPROVAL_POLICY SET required = ?, approver = ? WHERE policy_id = ? AND org_code = ?',
    required ? 1 : 0, required ? approver : 'NONE', policyId, ctx.org_code);
  log(ctx, 'UPDATE', 'APPROVAL_POLICY', policyId, { required, approver });
}

function AUDIT_RISK_SAVE(ctx, riskCode, f) {
  need(ctx.user.role === 'ADMIN', 'Only the organization admin can change risk levels');
  ctx.db.run('UPDATE AUDIT_RISK_LEVEL SET reply_days = ?, colour = ?, needs_ed = ? WHERE org_code = ? AND risk_code = ?',
    Number(f.reply_days) || 5, f.colour, f.needs_ed ? 1 : 0, ctx.org_code, riskCode);
  log(ctx, 'UPDATE', 'RISK_LEVEL', null, { riskCode, ...f });
}

// ------------------------------------------------------------------ dashboard

function AUDIT_DASHBOARD(ctx) {
  const audits = AUDIT_LIST(ctx);
  const byStatus = {};
  for (const a of audits) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
  const ids = audits.map((a) => a.audit_id);
  const obs = ids.length
    ? ctx.db.all(`SELECT b.* FROM AUDIT_OBSERVATION b WHERE b.org_code = ? AND b.audit_id IN (${ids.map(() => '?').join(',')})`, ctx.org_code, ...ids)
      .filter((b) => !b.confidential || hasRole(ctx, 'ED', 'CAO'))
    : [];
  const open = obs.filter((b) => !['CLOSED', 'CARRIED_FORWARD', 'RESOLVED'].includes(b.status));
  const openByRisk = {};
  for (const b of open) openByRisk[b.risk_code] = (openByRisk[b.risk_code] || 0) + 1;
  const overdue = open.filter((b) => OBS_AWAITING_REPLY.includes(b.status) && b.deadline && b.deadline < today(ctx)).length;
  const fraud = ids.length
    ? ctx.db.get(`SELECT COALESCE(SUM(amount),0) found, COALESCE(SUM(recovered_spot),0) spot FROM AUDIT_FRAUD WHERE audit_id IN (${ids.map(() => '?').join(',')})`, ...ids)
    : { found: 0, spot: 0 };
  const recovered = obs.length
    ? ctx.db.get(`SELECT COALESCE(SUM(amount),0) s FROM AUDIT_RECOVERY WHERE obs_id IN (${obs.map(() => '?').join(',')})`, ...obs.map((b) => b.obs_id)).s
    : 0;
  const year = today(ctx).slice(0, 4);
  const planned = ctx.db.get(
    `SELECT COUNT(*) n FROM AUDIT_PLAN_ITEM i JOIN AUDIT_PLAN p ON p.plan_id = i.plan_id
      WHERE p.org_code = ? AND p.status = 'APPROVED' AND i.plan_month LIKE ?`, ctx.org_code, `${year}%`,
  ).n;
  const done = audits.filter((a) => a.start_date.startsWith(year) && ['SUBMITTED', 'REPORT_APPROVED', 'UNDER_RESPONSE', 'CLOSED'].includes(a.status)).length;
  const branches = AUDIT_officesInScope(ctx).filter((o) => o.office_level === 'BRANCH').map((o) => {
    const last = ctx.db.get(`SELECT MAX(end_date) d FROM AUDIT_SCHEDULE WHERE office_id = ? AND status IN ('SUBMITTED','REPORT_APPROVED','UNDER_RESPONSE','CLOSED')`, o.office_id).d;
    const days = last ? Math.round((Date.parse(today(ctx)) - Date.parse(last)) / 86400000) : null;
    return { ...o, last_audit: last, days_since: days };
  });
  return { byStatus, openByRisk, overdue, fraud, recovered, planned, done, branches, total: audits.length, openCount: open.length };
}

module.exports = {
  AuditError,
  AUDIT_STATUS,
  AUDIT_OBS_STATUS,
  OBS_FINISHED,
  ROLE_LEVEL,
  OFFICE_RANK,
  AUDIT_addWorkingDays,
  AUDIT_officesInScope,
  AUDIT_supervisorOf,
  AUDIT_PLAN_CREATE,
  AUDIT_PLAN_WARNINGS,
  AUDIT_PLAN_SUBMIT,
  AUDIT_TEAM_CREATE,
  AUDIT_TEAM_CONFLICTS,
  AUDIT_PERIOD,
  AUDIT_SCHEDULE_CREATE,
  AUDIT_SCHEDULE_SUBMIT,
  AUDIT_WORKPLAN_SAVE,
  AUDIT_APPROVAL_INBOX,
  AUDIT_APPROVAL_HISTORY,
  AUDIT_APPROVAL_ACT,
  AUDIT_GET,
  AUDIT_LIST,
  AUDIT_canView,
  AUDIT_START,
  AUDIT_CHECKLIST,
  AUDIT_CHECK_SAVE,
  AUDIT_PREVIOUS_OPEN,
  AUDIT_FOLLOWUP_SAVE,
  AUDIT_OBS_CREATE,
  AUDIT_OBS_DELETE,
  AUDIT_FRAUD_ADD,
  AUDIT_FRAUD_LIST,
  AUDIT_SUBMIT_CHECK,
  AUDIT_SUBMIT,
  AUDIT_RELEASE,
  AUDIT_OBS_GET,
  AUDIT_OBS_LIST,
  AUDIT_OBS_canView,
  AUDIT_MY_OBSERVATIONS,
  AUDIT_OBS_HISTORY,
  AUDIT_OBS_canRespond,
  AUDIT_OBS_RESPOND,
  AUDIT_OBS_canSupervise,
  AUDIT_OBS_SUPERVISOR_COMMENT,
  AUDIT_OBS_canVerify,
  AUDIT_OBS_VERIFY,
  AUDIT_RECOVERY_ADD,
  AUDIT_OBS_canClose,
  AUDIT_OBS_CLOSE,
  AUDIT_CLOSE,
  AUDIT_INDICATORS_AT,
  AUDIT_RISK_OF,
  AUDIT_COMPARISON,
  AUDIT_INDICATOR_SAVE,
  AUDIT_POLICY_SAVE,
  AUDIT_RISK_SAVE,
  AUDIT_DASHBOARD,
  isTeamMember,
  isTeamLeader,
  canManageAudit,
};
