// Audit Setup: types, levels, risk levels, areas and checkpoints, indicators and PKSF standards,
// approval policy, offices, employees and users. Rows are always filtered to the user's organization.
const P = require('../AUDIT_procedures');
const { ok } = require('./AUDIT_main_routes');
const { AUDIT_hashPassword } = require('../AUDIT_auth');

const TABS = ['indicators', 'policy', 'risks', 'checkpoints', 'types', 'levels', 'offices', 'employees', 'users'];

module.exports = (app, db) => {
  const adminOnly = (req) => {
    if (req.ctx.user.role !== 'ADMIN') throw new P.AuditError('Only the organization admin can change setup');
  };

  app.get('/setup', (req, res) => {
    if (!['ADMIN', 'ED', 'CAO'].includes(req.ctx.user.role)) return res.status(403).render('AUDIT_error', { message: 'Setup is for head office users' });
    const org = req.ctx.org_code;
    const tab = TABS.includes(req.query.tab) ? req.query.tab : 'indicators';
    const data = { tab, canEdit: req.ctx.user.role === 'ADMIN' };
    if (tab === 'indicators') data.rows = db.all('SELECT * FROM AUDIT_INDICATOR WHERE org_code = ? AND effective_to IS NULL ORDER BY report_order, ind_id', org);
    if (tab === 'policy') data.rows = db.all(`SELECT * FROM AUDIT_APPROVAL_POLICY WHERE org_code = ? ORDER BY CASE audit_level WHEN 'IA' THEN 0 WHEN 'DIVISION' THEN 1 WHEN 'ZONE' THEN 2 ELSE 3 END, policy_id`, org);
    if (tab === 'risks') data.rows = db.all('SELECT * FROM AUDIT_RISK_LEVEL WHERE org_code = ? ORDER BY score', org);
    if (tab === 'checkpoints') {
      data.areas = db.all('SELECT * FROM AUDIT_AREA WHERE org_code = ? ORDER BY serial', org);
      data.rows = db.all('SELECT * FROM AUDIT_CHECKPOINT WHERE org_code = ? ORDER BY area_id, cp_id', org);
    }
    if (tab === 'types') data.rows = db.all('SELECT * FROM AUDIT_TYPE WHERE org_code = ? ORDER BY type_id', org);
    if (tab === 'levels') data.rows = db.all('SELECT * FROM AUDIT_LEVEL WHERE org_code = ?', org);
    if (tab === 'offices') data.rows = db.all('SELECT o.*, p.name_en parent_en, p.name_bn parent_bn FROM AUDIT_OFFICE o LEFT JOIN AUDIT_OFFICE p ON p.office_id = o.parent_id WHERE o.org_code = ? ORDER BY o.office_id', org);
    if (tab === 'employees' || tab === 'users') {
      data.offices = db.all('SELECT * FROM AUDIT_OFFICE WHERE org_code = ? ORDER BY office_id', org);
      data.rows = db.all('SELECT e.*, o.name_en office_en, o.name_bn office_bn, u.username, u.role FROM AUDIT_EMPLOYEE e JOIN AUDIT_OFFICE o ON o.office_id = e.office_id LEFT JOIN AUDIT_USER u ON u.emp_id = e.emp_id WHERE e.org_code = ? ORDER BY e.office_id, e.pin', org);
      data.users = db.all('SELECT u.*, e.name_en, e.name_bn, o.name_en office_en, o.name_bn office_bn FROM AUDIT_USER u LEFT JOIN AUDIT_EMPLOYEE e ON e.emp_id = u.emp_id JOIN AUDIT_OFFICE o ON o.office_id = u.office_id WHERE u.org_code = ? ORDER BY u.user_id', org);
    }
    res.render('AUDIT_setup', data);
  });

  app.post('/setup/indicators', (req, res) => {
    P.AUDIT_INDICATOR_SAVE(req.ctx, req.body.ind_id ? Number(req.body.ind_id) : null, req.body);
    ok(req, 'Indicator saved. The old standard is kept in history for earlier audits.');
    res.redirect('/setup?tab=indicators');
  });

  app.get('/setup/indicators/:code/history', (req, res) => {
    const rows = db.all(
      `SELECT i.*, u.username FROM AUDIT_INDICATOR i LEFT JOIN AUDIT_USER u ON u.user_id = i.changed_by
        WHERE i.org_code = ? AND i.code = ? ORDER BY i.effective_from DESC`, req.ctx.org_code, req.params.code,
    );
    res.render('AUDIT_indicator_history', { rows });
  });

  app.post('/setup/policy/:id', (req, res) => {
    P.AUDIT_POLICY_SAVE(req.ctx, Number(req.params.id), req.body.required === '1', req.body.approver);
    ok(req, 'Approval policy saved');
    res.redirect('/setup?tab=policy');
  });

  app.post('/setup/risks/:code', (req, res) => {
    P.AUDIT_RISK_SAVE(req.ctx, req.params.code, req.body);
    ok(req, 'Risk level saved');
    res.redirect('/setup?tab=risks');
  });

  app.post('/setup/checkpoints', (req, res) => {
    adminOnly(req);
    const f = req.body;
    if (!f.area_id || !f.question_en || !f.question_bn) throw new P.AuditError('Area and both questions are required');
    db.run('INSERT INTO AUDIT_CHECKPOINT (org_code, area_id, question_en, question_bn, answer_type, expected, default_risk) VALUES (?,?,?,?,?,?,?)',
      req.ctx.org_code, Number(f.area_id), f.question_en, f.question_bn, 'YNP', 'YES', f.default_risk || 'MEDIUM');
    ok(req, 'Checkpoint added');
    res.redirect('/setup?tab=checkpoints');
  });

  app.post('/setup/checkpoints/:id/toggle', (req, res) => {
    adminOnly(req);
    db.run('UPDATE AUDIT_CHECKPOINT SET active = 1 - active WHERE cp_id = ? AND org_code = ?', Number(req.params.id), req.ctx.org_code);
    res.redirect('/setup?tab=checkpoints');
  });

  // Manual entry for organizations that do not use our ERP.
  app.post('/setup/offices', (req, res) => {
    adminOnly(req);
    const f = req.body;
    if (!f.office_code || !f.name_en || !f.name_bn || !f.office_level) throw new P.AuditError('Code, level and both names are required');
    db.run('INSERT INTO AUDIT_OFFICE (org_code, office_code, name_en, name_bn, office_level, parent_id, open_date, data_source) VALUES (?,?,?,?,?,?,?,?)',
      req.ctx.org_code, f.office_code, f.name_en, f.name_bn, f.office_level, f.parent_id ? Number(f.parent_id) : null, f.open_date || null, 'MANUAL');
    ok(req, 'Office added');
    res.redirect('/setup?tab=offices');
  });

  app.post('/setup/employees', (req, res) => {
    adminOnly(req);
    const f = req.body;
    if (!f.pin || !f.name_en || !f.name_bn || !f.designation || !f.office_id) throw new P.AuditError('PIN, names, designation and office are required');
    db.run('INSERT INTO AUDIT_EMPLOYEE (org_code, pin, name_en, name_bn, designation, office_id, data_source) VALUES (?,?,?,?,?,?,?)',
      req.ctx.org_code, f.pin, f.name_en, f.name_bn, f.designation, Number(f.office_id), 'MANUAL');
    ok(req, 'Employee added');
    res.redirect('/setup?tab=employees');
  });

  app.post('/setup/users', (req, res) => {
    adminOnly(req);
    const f = req.body;
    const e = db.get('SELECT * FROM AUDIT_EMPLOYEE WHERE emp_id = ? AND org_code = ?', Number(f.emp_id), req.ctx.org_code);
    if (!e || !f.username || !f.password || !f.role) throw new P.AuditError('Employee, username, password and role are required');
    const o = db.get('SELECT * FROM AUDIT_OFFICE WHERE office_id = ?', e.office_id);
    if (db.get('SELECT 1 FROM AUDIT_USER WHERE username = ?', f.username.toLowerCase())) throw new P.AuditError('This username is taken');
    db.run('INSERT INTO AUDIT_USER (org_code, username, password_hash, emp_id, user_type, role, office_id) VALUES (?,?,?,?,?,?,?)',
      req.ctx.org_code, f.username.toLowerCase(), AUDIT_hashPassword(f.password), e.emp_id, o.office_level === 'HO' ? 'HO' : o.office_level, f.role, e.office_id);
    ok(req, 'Login created');
    res.redirect('/setup?tab=users');
  });
};
