// Dashboard, notifications, auditee inbox and the observation page (reply, verify, close).
const P = require('../AUDIT_procedures');

function ok(req, text) {
  req.session.flash = { type: 'ok', text };
}

module.exports = (app, db) => {
  app.get('/', (req, res) => {
    const d = P.AUDIT_DASHBOARD(req.ctx);
    const inbox = P.AUDIT_APPROVAL_INBOX(req.ctx);
    const mine = ['BM', 'STAFF'].includes(req.ctx.user.role) ? P.AUDIT_MY_OBSERVATIONS(req.ctx) : [];
    const audits = P.AUDIT_LIST(req.ctx).filter((a) => !['CLOSED', 'REJECTED', 'CANCELLED'].includes(a.status)).slice(0, 8);
    res.render('AUDIT_dashboard', { d, inbox, mine, audits });
  });

  app.get('/notifications', (req, res) => {
    const rows = db.all('SELECT * FROM AUDIT_NOTIFICATION WHERE user_id = ? ORDER BY notif_id DESC LIMIT 100', req.ctx.user.user_id);
    db.run('UPDATE AUDIT_NOTIFICATION SET is_read = 1 WHERE user_id = ?', req.ctx.user.user_id);
    res.render('AUDIT_notifications', { rows });
  });

  app.get('/my-observations', (req, res) => {
    res.render('AUDIT_my_observations', { rows: P.AUDIT_MY_OBSERVATIONS(req.ctx) });
  });

  app.get('/observations/:id', (req, res) => {
    const b = P.AUDIT_OBS_GET(req.ctx, Number(req.params.id));
    if (!P.AUDIT_OBS_canView(req.ctx, b)) return res.status(403).render('AUDIT_error', { message: 'You cannot see this observation' });
    const a = P.AUDIT_GET(req.ctx, b.audit_id);
    res.render('AUDIT_observation', {
      b, a,
      history: P.AUDIT_OBS_HISTORY(req.ctx, b.obs_id),
      recoveries: db.all('SELECT * FROM AUDIT_RECOVERY WHERE obs_id = ? ORDER BY rec_date', b.obs_id),
      carriedFrom: b.carried_from_obs_id ? db.get('SELECT obs_id, obs_no FROM AUDIT_OBSERVATION WHERE obs_id = ?', b.carried_from_obs_id) : null,
      can: {
        respond: P.AUDIT_OBS_canRespond(req.ctx, b),
        supervise: P.AUDIT_OBS_canSupervise(req.ctx, b),
        verify: P.AUDIT_OBS_canVerify(req.ctx, b),
        close: P.AUDIT_OBS_canClose(req.ctx, b),
        recovery: b.is_financial && !P.OBS_FINISHED.includes(b.status) && a.status === 'UNDER_RESPONSE' && (P.isTeamMember(req.ctx, a) || P.canManageAudit(req.ctx, a)),
      },
    });
  });

  app.post('/observations/:id/respond', (req, res) => {
    P.AUDIT_OBS_RESPOND(req.ctx, Number(req.params.id), req.body);
    ok(req, 'Your reply is sent to the auditor');
    res.redirect(`/observations/${req.params.id}`);
  });

  app.post('/observations/:id/supervisor', (req, res) => {
    P.AUDIT_OBS_SUPERVISOR_COMMENT(req.ctx, Number(req.params.id), req.body.text);
    ok(req, 'Comment added');
    res.redirect(`/observations/${req.params.id}`);
  });

  app.post('/observations/:id/verify', (req, res) => {
    const status = P.AUDIT_OBS_VERIFY(req.ctx, Number(req.params.id), req.body.decision, req.body.text, req.body.new_deadline);
    ok(req, `Observation marked ${status.toLowerCase()}`);
    res.redirect(`/observations/${req.params.id}`);
  });

  app.post('/observations/:id/recovery', (req, res) => {
    P.AUDIT_RECOVERY_ADD(req.ctx, Number(req.params.id), req.body);
    ok(req, 'Recovery recorded');
    res.redirect(`/observations/${req.params.id}`);
  });

  app.post('/observations/:id/close', (req, res) => {
    P.AUDIT_OBS_CLOSE(req.ctx, Number(req.params.id), req.body.text);
    ok(req, 'Observation closed');
    res.redirect(`/observations/${req.params.id}`);
  });

  app.post('/observations/:id/delete', (req, res) => {
    const b = P.AUDIT_OBS_GET(req.ctx, Number(req.params.id));
    P.AUDIT_OBS_DELETE(req.ctx, b.obs_id);
    ok(req, `${b.obs_no} deleted`);
    res.redirect(`/audits/${b.audit_id}?tab=observations`);
  });
};

module.exports.ok = ok;
