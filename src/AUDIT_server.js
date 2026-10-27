// Web server for the AUDIT module.
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const { AUDIT_openDb, AUDIT_createSchema } = require('./db/AUDIT_db');
const { AUDIT_seedDemo } = require('./db/AUDIT_seed');
const { AUDIT_i18n } = require('./AUDIT_i18n');
const { AuditError } = require('./AUDIT_procedures');
const { AUDIT_LOGIN } = require('./AUDIT_auth');

function AUDIT_createApp(db) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use('/static', express.static(path.join(__dirname, '..', 'public')));
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: process.env.AUDIT_SESSION_SECRET || 'audit-demo-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
  }));

  // Logged-in user, org, language and helpers for every page.
  app.use((req, res, next) => {
    const lang = req.session.lang || 'en';
    const i = AUDIT_i18n(lang);
    Object.assign(res.locals, i, { path: req.path, flash: req.session.flash || null, query: req.query });
    req.session.flash = null;
    if (req.session.userId) {
      const user = db.get('SELECT u.*, e.name_en, e.name_bn, e.designation, e.pin FROM AUDIT_USER u LEFT JOIN AUDIT_EMPLOYEE e ON e.emp_id = u.emp_id WHERE u.user_id = ? AND u.active = 1', req.session.userId);
      if (user) {
        req.ctx = { db, org_code: user.org_code, user };
        res.locals.user = user;
        res.locals.org = db.get('SELECT * FROM AUDIT_ORG WHERE org_code = ?', user.org_code);
        res.locals.unread = db.get('SELECT COUNT(*) n FROM AUDIT_NOTIFICATION WHERE user_id = ? AND is_read = 0', user.user_id).n;
        res.locals.pendingApprovals = db.get(`SELECT COUNT(*) n FROM AUDIT_APPROVAL WHERE approver_user_id = ? AND action = 'PENDING'`, user.user_id).n;
        res.locals.risks = Object.fromEntries(db.all('SELECT * FROM AUDIT_RISK_LEVEL WHERE org_code = ?', user.org_code).map((r) => [r.risk_code, r]));
      }
    }
    res.locals.badge = (code) => `<span class="AUDIT_badge AUDIT_st_${code}">${i.st(code)}</span>`;
    res.locals.riskBadge = (code) => {
      const r = (res.locals.risks || {})[code];
      return code ? `<span class="AUDIT_risk" style="background:${r ? r.colour : '#777'}">${i.st(code)}</span>` : '';
    };
    next();
  });

  app.get('/login', (req, res) => {
    const demo = db.all(
      `SELECT u.username, u.role, u.org_code, e.name_en, e.name_bn, o.name_en office_en, o.name_bn office_bn
         FROM AUDIT_USER u LEFT JOIN AUDIT_EMPLOYEE e ON e.emp_id = u.emp_id JOIN AUDIT_OFFICE o ON o.office_id = u.office_id
        ORDER BY u.org_code DESC, u.user_id`,
    );
    res.render('AUDIT_login', { demo });
  });

  app.post('/login', (req, res) => {
    const user = AUDIT_LOGIN(db, req.body.username, req.body.password);
    if (!user) {
      req.session.flash = { type: 'error', text: 'Wrong username or password' };
      return res.redirect('/login');
    }
    req.session.regenerate(() => {
      req.session.userId = user.user_id;
      req.session.lang = user.lang;
      res.redirect('/');
    });
  });

  app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

  app.get('/lang/:lang', (req, res) => {
    req.session.lang = req.params.lang === 'bn' ? 'bn' : 'en';
    if (req.session.userId) db.run('UPDATE AUDIT_USER SET lang = ? WHERE user_id = ?', req.session.lang, req.session.userId);
    res.redirect(req.get('Referer') || '/');
  });

  app.use((req, res, next) => (req.ctx ? next() : res.redirect('/login')));

  require('./routes/AUDIT_main_routes')(app, db);
  require('./routes/AUDIT_setup_routes')(app, db);
  require('./routes/AUDIT_planning_routes')(app, db);
  require('./routes/AUDIT_field_routes')(app, db);
  require('./routes/AUDIT_report_routes')(app, db);

  app.use((req, res) => res.status(404).render('AUDIT_error', { message: 'Page not found' }));

  // Rule violations go back to the form with the message; anything else is a server error.
  app.use((err, req, res, next) => {
    if (err instanceof AuditError) {
      req.session.flash = { type: 'error', text: err.message };
      return res.redirect(req.method === 'GET' ? '/' : req.get('Referer') || '/');
    }
    console.error(err);
    res.status(500).render('AUDIT_error', { message: 'Something went wrong. The error is logged on the server.' });
  });
  return app;
}

if (require.main === module) {
  const file = process.env.AUDIT_DB || path.join(__dirname, '..', 'data', 'AUDIT_demo.db');
  const db = AUDIT_openDb(file);
  AUDIT_createSchema(db);
  if (!db.get('SELECT COUNT(*) n FROM AUDIT_ORG').n) {
    AUDIT_seedDemo(db);
    console.log('Empty database: demo data loaded (password for every demo user: demo123).');
  }
  const port = Number(process.env.PORT) || 3000;
  AUDIT_createApp(db).listen(port, () => console.log(`AUDIT module running at http://localhost:${port}`));
}

module.exports = { AUDIT_createApp };
