// Printable letters and reports. Each one takes ?rl=bn or ?rl=en to print in Bangla or English
// regardless of the screen language.
const P = require('../AUDIT_procedures');
const { AUDIT_i18n } = require('../AUDIT_i18n');

module.exports = (app, db) => {
  // Switch the helpers to the report language for this page only.
  const reportLang = (req, res) => {
    const rl = req.query.rl === 'bn' || req.query.rl === 'en' ? req.query.rl : res.locals.lang;
    Object.assign(res.locals, AUDIT_i18n(rl), { rl });
  };

  const noBranch = (req, res) => {
    if (req.ctx.user.role === 'STAFF') {
      res.status(403).render('AUDIT_error', { message: 'Reports are not available for branch staff' });
      return true;
    }
    return false;
  };

  const officeChain = (officeId) => {
    const chain = {};
    let o = db.get('SELECT * FROM AUDIT_OFFICE WHERE office_id = ?', officeId);
    while (o) {
      chain[o.office_level] = o;
      o = o.parent_id ? db.get('SELECT * FROM AUDIT_OFFICE WHERE office_id = ?', o.parent_id) : null;
    }
    return chain;
  };

  const loadAudit = (req) => {
    const a = P.AUDIT_GET(req.ctx, Number(req.params.id));
    if (!P.AUDIT_canView(req.ctx, a)) throw new P.AuditError('You cannot open this audit');
    return a;
  };

  const teamOf = (a) => db.all(
    `SELECT m.member_role, e.* FROM AUDIT_TEAM_MEMBER m JOIN AUDIT_EMPLOYEE e ON e.emp_id = m.emp_id WHERE m.team_id = ? ORDER BY CASE m.member_role WHEN 'LEADER' THEN 0 ELSE 1 END`, a.team_id,
  );

  app.get('/reports', (req, res) => {
    if (noBranch(req, res)) return;
    res.render('AUDIT_reports', {
      audits: P.AUDIT_LIST(req.ctx),
      plans: db.all(`SELECT * FROM AUDIT_PLAN WHERE org_code = ? ORDER BY plan_id DESC`, req.ctx.org_code),
    });
  });

  // R1 Annual audit plan
  app.get('/reports/plan/:id', (req, res) => {
    if (noBranch(req, res)) return;
    reportLang(req, res);
    const plan = db.get('SELECT * FROM AUDIT_PLAN WHERE plan_id = ? AND org_code = ?', Number(req.params.id), req.ctx.org_code);
    if (!plan) return res.status(404).render('AUDIT_error', { message: 'Plan not found' });
    const items = db.all(
      `SELECT i.*, o.name_en office_en, o.name_bn office_bn, o.office_code, ty.name_en type_en, ty.name_bn type_bn, t.name team_name
         FROM AUDIT_PLAN_ITEM i JOIN AUDIT_OFFICE o ON o.office_id = i.office_id JOIN AUDIT_TYPE ty ON ty.type_id = i.type_id
         LEFT JOIN AUDIT_TEAM t ON t.team_id = i.team_id WHERE i.plan_id = ? ORDER BY i.plan_month, o.office_code`, plan.plan_id,
    );
    res.render('AUDIT_rpt_plan', { plan, items, history: P.AUDIT_APPROVAL_HISTORY(req.ctx, 'PLAN', plan.plan_id) });
  });

  // R3 Audit order letter
  app.get('/reports/order-letter/:id', (req, res) => {
    reportLang(req, res);
    const a = loadAudit(req);
    if (!a.memo_no) throw new P.AuditError('The order letter is available once the schedule is approved');
    const ed = db.get(`SELECT e.* FROM AUDIT_USER u JOIN AUDIT_EMPLOYEE e ON e.emp_id = u.emp_id WHERE u.org_code = ? AND u.role = 'ED'`, req.ctx.org_code);
    const cao = db.get(`SELECT e.* FROM AUDIT_USER u JOIN AUDIT_EMPLOYEE e ON e.emp_id = u.emp_id WHERE u.org_code = ? AND u.role = 'CAO'`, req.ctx.org_code);
    const approvedAt = db.get(`SELECT acted_at FROM AUDIT_APPROVAL WHERE item_type = 'SCHEDULE' AND item_id = ? AND action IN ('APPROVED','AUTO') ORDER BY appr_id DESC`, a.audit_id);
    res.render('AUDIT_rpt_order', { a, team: teamOf(a), ed, cao, chain: officeChain(a.office_id), letterDate: approvedAt ? approvedAt.acted_at : a.created_at });
  });

  // R5 Audit report
  app.get('/reports/audit/:id', (req, res) => {
    if (noBranch(req, res)) return;
    reportLang(req, res);
    const a = loadAudit(req);
    if (['DRAFT', 'PENDING_APPROVAL', 'RETURNED', 'REJECTED', 'APPROVED'].includes(a.status)) throw new P.AuditError('The report is available once field work has started');
    const obs = P.AUDIT_OBS_LIST(req.ctx, a.audit_id);
    const prevObs = a.prev_audit_id ? db.all('SELECT * FROM AUDIT_OBSERVATION WHERE audit_id = ? ORDER BY obs_id', a.prev_audit_id) : [];
    const checklist = P.AUDIT_CHECKLIST(req.ctx, a);
    res.render('AUDIT_rpt_audit', {
      a, team: teamOf(a), chain: officeChain(a.office_id), obs, prevObs,
      exceptions: checklist.filter((c) => c.answer && c.answer !== c.expected),
      answered: checklist.filter((c) => c.answer).length, total: checklist.length,
      comparison: P.AUDIT_COMPARISON(req.ctx, a), fraud: P.AUDIT_FRAUD_LIST(req.ctx, a.audit_id),
      carried: Object.fromEntries(obs.filter((b) => b.carried_from_obs_id).map((b) => [b.carried_from_obs_id, b])),
    });
  });

  // R6 Show-cause letter
  app.get('/reports/show-cause/:id', (req, res) => {
    if (noBranch(req, res)) return;
    reportLang(req, res);
    const a = loadAudit(req);
    const obs = P.AUDIT_OBS_LIST(req.ctx, a.audit_id).filter((b) => b.show_cause && !b.confidential);
    const ed = db.get(`SELECT e.* FROM AUDIT_USER u JOIN AUDIT_EMPLOYEE e ON e.emp_id = u.emp_id WHERE u.org_code = ? AND u.role = 'ED'`, req.ctx.org_code);
    const bm = db.get(`SELECT e.* FROM AUDIT_USER u JOIN AUDIT_EMPLOYEE e ON e.emp_id = u.emp_id WHERE u.office_id = ? AND u.role = 'BM'`, a.office_id);
    res.render('AUDIT_rpt_showcause', { a, obs, ed, bm, fraud: P.AUDIT_FRAUD_LIST(req.ctx, a.audit_id), chain: officeChain(a.office_id) });
  });

  // R7 Observation register and R9 pending / overdue replies
  const allVisibleObs = (req) => {
    const audits = P.AUDIT_LIST(req.ctx);
    const rows = [];
    for (const a of audits) {
      for (const b of P.AUDIT_OBS_LIST(req.ctx, a.audit_id)) {
        if (P.AUDIT_OBS_canView(req.ctx, b)) rows.push({ ...b, audit_no: a.audit_no, office_en: a.office_en, office_bn: a.office_bn });
      }
    }
    return rows;
  };

  app.get('/reports/observations', (req, res) => {
    if (noBranch(req, res)) return;
    reportLang(req, res);
    let rows = allVisibleObs(req);
    if (req.query.status) rows = rows.filter((b) => b.status === req.query.status);
    if (req.query.risk) rows = rows.filter((b) => b.risk_code === req.query.risk);
    res.render('AUDIT_rpt_observations', { rows, title: 'Observation Register', pending: false });
  });

  app.get('/reports/pending', (req, res) => {
    if (noBranch(req, res)) return;
    reportLang(req, res);
    const rows = allVisibleObs(req).filter((b) => ['SENT', 'REISSUED', 'PARTLY', 'REPLIED'].includes(b.status));
    res.render('AUDIT_rpt_observations', { rows, title: 'Pending Response / Overdue', pending: true });
  });

  // R14 / R15 Branch risk rating and ratios against PKSF standards
  app.get('/reports/ratios', (req, res) => {
    if (noBranch(req, res)) return;
    reportLang(req, res);
    const asOn = db.get('SELECT MAX(as_on) d FROM AUDIT_BRANCH_DATA WHERE org_code = ?', req.ctx.org_code).d;
    const indicators = asOn ? P.AUDIT_INDICATORS_AT(req.ctx, asOn) : [];
    const branches = P.AUDIT_officesInScope(req.ctx).filter((o) => o.office_level === 'BRANCH').map((o) => {
      const values = {};
      for (const ind of indicators) {
        const r = db.get('SELECT value FROM AUDIT_BRANCH_DATA WHERE office_id = ? AND ind_code = ? AND as_on <= ? ORDER BY as_on DESC LIMIT 1', o.office_id, ind.code, asOn);
        values[ind.code] = r ? { value: r.value, risk: P.AUDIT_RISK_OF(ind, r.value) } : null;
      }
      const last = db.get(`SELECT MAX(end_date) d FROM AUDIT_SCHEDULE WHERE office_id = ? AND status IN ('SUBMITTED','REPORT_APPROVED','UNDER_RESPONSE','CLOSED')`, o.office_id).d;
      const highs = Object.values(values).filter((v) => v && v.risk === 'HIGH').length;
      return { ...o, values, last_audit: last, highs };
    });
    res.render('AUDIT_rpt_ratios', { asOn, indicators, branches });
  });
};
