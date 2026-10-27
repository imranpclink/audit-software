// Demo data. Two organizations in the one central database:
//   ASO   - an existing ERP client (branches, staff and branch figures marked as pulled from the ERP)
//   COAST - a client entering data by hand
// Every audit below is pushed through the real business rules (AUDIT_procedures), so the
// demo data is in exactly the state the software itself would produce.
const P = require('../AUDIT_procedures');
const { AUDIT_hashPassword } = require('../AUDIT_auth');
const { AUDIT_loadOrgDefaults, AUDIT_DEFAULT_INDICATORS } = require('./AUDIT_seed_setup');

const DEMO_PASSWORD = 'demo123';

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function monthEnds(fromDate, count) {
  const out = [];
  const d = new Date(`${fromDate.slice(0, 7)}-01T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    const end = new Date(d);
    end.setUTCDate(0);
    out.unshift(end.toISOString().slice(0, 10));
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

function AUDIT_seedDemo(db, base = new Date().toISOString().slice(0, 10)) {
  const day = (n) => addDays(base, n);
  const hash = AUDIT_hashPassword(DEMO_PASSWORD);

  db.tx(() => {
    // ============================================================ ASO
    db.run(`INSERT INTO AUDIT_ORG (org_code, name_en, name_bn, address_en, address_bn, data_source, memo_format)
            VALUES ('ASO','Ahead Social Organization','আহেড সোশ্যাল অর্গানাইজেশন','Joypurhat, Bangladesh','জয়পুরহাট, বাংলাদেশ','ERP','ASO/JOY/Office Order/{YYYY}/{SL}')`);
    AUDIT_loadOrgDefaults(db, 'ASO', '2020-01-01');

    const off = {};
    const addOffice = (org, code, en, bn, level, parent, open, src) => {
      off[code] = Number(db.run(
        'INSERT INTO AUDIT_OFFICE (org_code, office_code, name_en, name_bn, office_level, parent_id, open_date, data_source) VALUES (?,?,?,?,?,?,?,?)',
        org, code, en, bn, level, parent ? off[parent] : null, open, src,
      ).lastInsertRowid);
    };
    const aso = (code, en, bn, level, parent, open) => addOffice('ASO', code, en, bn, level, parent, open, 'ERP');
    aso('HO', 'Head Office', 'প্রধান কার্যালয়', 'HO', null, '2005-01-01');
    aso('RAJ', 'Rajshahi Division', 'রাজশাহী বিভাগ', 'DIVISION', 'HO', '2008-01-01');
    aso('JOY', 'Joypurhat Zone', 'জয়পুরহাট জোন', 'ZONE', 'RAJ', '2008-01-01');
    aso('BOG', 'Bogura Zone', 'বগুড়া জোন', 'ZONE', 'RAJ', '2012-01-01');
    aso('JSA', 'Joypurhat Sadar Area', 'জয়পুরহাট সদর এরিয়া', 'AREA', 'JOY', '2008-01-01');
    aso('PNB', 'Panchbibi Area', 'পাঁচবিবি এরিয়া', 'AREA', 'JOY', '2010-01-01');
    aso('BSA', 'Bogura Sadar Area', 'বগুড়া সদর এরিয়া', 'AREA', 'BOG', '2012-01-01');
    aso('B101', 'Joypurhat Sadar Branch', 'জয়পুরহাট সদর শাখা', 'BRANCH', 'JSA', '2008-03-01');
    aso('B102', 'Khetlal Branch', 'ক্ষেতলাল শাখা', 'BRANCH', 'JSA', '2011-07-01');
    aso('B103', 'Akkelpur Branch', 'আক্কেলপুর শাখা', 'BRANCH', 'JSA', '2014-01-01');
    aso('B201', 'Panchbibi Branch', 'পাঁচবিবি শাখা', 'BRANCH', 'PNB', '2010-02-01');
    aso('B202', 'Kalai Branch', 'কালাই শাখা', 'BRANCH', 'PNB', '2016-09-01');
    aso('B301', 'Bogura Sadar Branch', 'বগুড়া সদর শাখা', 'BRANCH', 'BSA', '2012-05-01');
    aso('B302', 'Shibganj Branch', 'শিবগঞ্জ শাখা', 'BRANCH', 'BSA', '2018-01-01');

    const emp = {};
    const user = {};
    const person = (org, username, pin, en, bn, desig, officeCode, userType, role, src) => {
      const empId = Number(db.run(
        'INSERT INTO AUDIT_EMPLOYEE (org_code, pin, name_en, name_bn, designation, office_id, data_source) VALUES (?,?,?,?,?,?,?)',
        org, pin, en, bn, desig, off[officeCode], src,
      ).lastInsertRowid);
      emp[username] = empId;
      if (role) {
        user[username] = Number(db.run(
          'INSERT INTO AUDIT_USER (org_code, username, password_hash, emp_id, user_type, role, office_id) VALUES (?,?,?,?,?,?,?)',
          org, username, hash, empId, userType, role, off[officeCode],
        ).lastInsertRowid);
      }
    };
    const asoP = (username, pin, en, bn, desig, officeCode, userType, role) => person('ASO', username, pin, en, bn, desig, officeCode, userType, role, 'ERP');

    db.run(`INSERT INTO AUDIT_USER (org_code, username, password_hash, user_type, role, office_id) VALUES ('ASO','admin',?,'ADMIN','ADMIN',?)`, hash, off.HO);
    asoP('ed', '0001', 'Md. Abdul Karim', 'মোঃ আব্দুল করিম', 'Executive Director', 'HO', 'HO', 'ED');
    asoP('cao', '0012', 'Md. Rafiqul Islam', 'মোঃ রফিকুল ইসলাম', 'Chief Audit Officer', 'HO', 'HO', 'CAO');
    asoP('auditor1', '0145', 'Nasrin Akter', 'নাসরিন আক্তার', 'Senior Auditor', 'HO', 'HO', 'AUDITOR');
    asoP('auditor2', '0167', 'Habibur Rahman', 'হাবিবুর রহমান', 'Auditor', 'HO', 'HO', 'AUDITOR');
    asoP('auditor3', '0172', 'Sharmin Sultana', 'শারমিন সুলতানা', 'Senior Auditor', 'HO', 'HO', 'AUDITOR');
    asoP('auditor4', '0188', 'Kamrul Hasan', 'কামরুল হাসান', 'Assistant Auditor', 'HO', 'HO', 'AUDITOR');
    asoP('dm_raj', '0040', 'Md. Shahidul Alam', 'মোঃ শহিদুল আলম', 'Divisional Manager', 'RAJ', 'DIVISION', 'DM');
    asoP('zm_joy', '0061', 'Md. Mizanur Rahman', 'মোঃ মিজানুর রহমান', 'Zonal Manager', 'JOY', 'ZONE', 'ZM');
    asoP('zm_bog', '0066', 'Fatema Begum', 'ফাতেমা বেগম', 'Zonal Manager', 'BOG', 'ZONE', 'ZM');
    asoP('am_jsa', '0210', 'Md. Jahangir Alam', 'মোঃ জাহাঙ্গীর আলম', 'Area Manager', 'JSA', 'AREA', 'AM');
    asoP('am_pnb', '0233', 'Rokeya Khatun', 'রোকেয়া খাতুন', 'Area Manager', 'PNB', 'AREA', 'AM');
    asoP('am_bsa', '0241', 'Md. Selim Reza', 'মোঃ সেলিম রেজা', 'Area Manager', 'BSA', 'AREA', 'AM');
    asoP('bm_b101', '0512', 'Md. Abu Bakar Siddique', 'মোঃ আবু বকর সিদ্দিক', 'Branch Manager', 'B101', 'BRANCH', 'BM');
    asoP('acc_b101', '0688', 'Md. Aminul Islam', 'মোঃ আমিনুল ইসলাম', 'Accountant', 'B101', 'BRANCH', 'STAFF');
    asoP('fo_b101', '0921', 'Shirin Akter', 'শিরিন আক্তার', 'Field Officer', 'B101', 'BRANCH', 'STAFF');
    asoP('bm_b102', '0533', 'Md. Rashedul Hasan', 'মোঃ রাশেদুল হাসান', 'Branch Manager', 'B102', 'BRANCH', 'BM');
    asoP('bm_b103', '0547', 'Md. Nurul Amin', 'মোঃ নুরুল আমিন', 'Branch Manager', 'B103', 'BRANCH', 'BM');
    asoP('bm_b201', '0551', 'Md. Golam Mostofa', 'মোঃ গোলাম মোস্তফা', 'Branch Manager', 'B201', 'BRANCH', 'BM');
    asoP('acc_b201', '0702', 'Md. Sohel Rana', 'মোঃ সোহেল রানা', 'Accountant', 'B201', 'BRANCH', 'STAFF');
    asoP('fo_b201', '0944', 'Md. Rakibul Hasan', 'মোঃ রাকিবুল হাসান', 'Field Officer', 'B201', 'BRANCH', 'STAFF');
    asoP('fo2_b201', '0951', 'Mst. Moriom Begum', 'মোসাঃ মরিয়ম বেগম', 'Field Officer', 'B201', 'BRANCH', 'STAFF');
    asoP('bm_b202', '0566', 'Md. Ashraful Islam', 'মোঃ আশরাফুল ইসলাম', 'Branch Manager', 'B202', 'BRANCH', 'BM');
    asoP('bm_b301', '0578', 'Md. Mahbub Alam', 'মোঃ মাহবুব আলম', 'Branch Manager', 'B301', 'BRANCH', 'BM');
    asoP('bm_b302', '0590', 'Md. Ariful Haque', 'মোঃ আরিফুল হক', 'Branch Manager', 'B302', 'BRANCH', 'BM');
    asoP('fo_b302', '0960', 'Md. Tanvir Ahmed', 'মোঃ তানভীর আহমেদ', 'Field Officer', 'B302', 'BRANCH', 'STAFF');

    // Branch figures by month-end, as the ERP would return them.
    const profiles = {
      B101: { MEMBERS_PER_BRANCH: 1850, MEMBERS_PER_CO: 370, BORROWERS_PER_CO: 300, BORROWER_COVERAGE: 78, PAR: 6.5, OTR: 94, ME_LOAN_SHARE: 48, SUFOLON_SHARE: 18, GOOD_LOAN_SHARE: 96, DEBT_CAPITAL: 6.8, CAPITAL_ADEQUACY: 14, drift: { PAR: 0.15, OTR: -0.1 } },
      B102: { MEMBERS_PER_BRANCH: 1620, MEMBERS_PER_CO: 330, BORROWERS_PER_CO: 260, BORROWER_COVERAGE: 76, PAR: 4.2, OTR: 96, ME_LOAN_SHARE: 41, SUFOLON_SHARE: 22, GOOD_LOAN_SHARE: 97.5, DEBT_CAPITAL: 5.9, CAPITAL_ADEQUACY: 16, drift: {} },
      B103: { MEMBERS_PER_BRANCH: 1380, MEMBERS_PER_CO: 290, BORROWERS_PER_CO: 225, BORROWER_COVERAGE: 72, PAR: 8.9, OTR: 92.5, ME_LOAN_SHARE: 55, SUFOLON_SHARE: 30, GOOD_LOAN_SHARE: 95.2, DEBT_CAPITAL: 7.5, CAPITAL_ADEQUACY: 12, drift: { PAR: 0.1 } },
      B201: { MEMBERS_PER_BRANCH: 2150, MEMBERS_PER_CO: 420, BORROWERS_PER_CO: 365, BORROWER_COVERAGE: 68, PAR: 9.5, OTR: 91, ME_LOAN_SHARE: 63, SUFOLON_SHARE: 35, GOOD_LOAN_SHARE: 93.5, DEBT_CAPITAL: 9.6, CAPITAL_ADEQUACY: 9.4, drift: { PAR: 0.3, OTR: -0.25 } },
      B202: { MEMBERS_PER_BRANCH: 1210, MEMBERS_PER_CO: 305, BORROWERS_PER_CO: 245, BORROWER_COVERAGE: 80, PAR: 3.1, OTR: 97, ME_LOAN_SHARE: 38, SUFOLON_SHARE: 25, GOOD_LOAN_SHARE: 98, DEBT_CAPITAL: 5.2, CAPITAL_ADEQUACY: 18, drift: {} },
      B301: { MEMBERS_PER_BRANCH: 1990, MEMBERS_PER_CO: 395, BORROWERS_PER_CO: 330, BORROWER_COVERAGE: 74, PAR: 7.8, OTR: 93, ME_LOAN_SHARE: 58, SUFOLON_SHARE: 28, GOOD_LOAN_SHARE: 95.6, DEBT_CAPITAL: 8.2, CAPITAL_ADEQUACY: 11, drift: { PAR: 0.1 } },
      B302: { MEMBERS_PER_BRANCH: 1540, MEMBERS_PER_CO: 352, BORROWERS_PER_CO: 281, BORROWER_COVERAGE: 75, PAR: 10.5, OTR: 90.5, ME_LOAN_SHARE: 52, SUFOLON_SHARE: 42, GOOD_LOAN_SHARE: 94, DEBT_CAPITAL: 7.9, CAPITAL_ADEQUACY: 10.5, drift: { PAR: 0.2, OTR: -0.1 } },
    };
    const months = monthEnds(base, 24);
    for (const [code, p] of Object.entries(profiles)) {
      months.forEach((m, i) => {
        for (const [ind] of AUDIT_DEFAULT_INDICATORS) {
          const wobble = Math.sin(i * 1.7 + ind.length) * (p[ind] > 100 ? 15 : 0.4);
          const raw = p[ind] + (p.drift[ind] || 0) * (i - 23) + wobble;
          const value = p[ind] > 100 ? Math.round(raw) : Math.round(raw * 100) / 100;
          db.run('INSERT INTO AUDIT_BRANCH_DATA (org_code, office_id, as_on, ind_code, value, data_source) VALUES (?,?,?,?,?,?)', 'ASO', off[code], m, ind, value, 'ERP');
        }
      });
    }

    // ------------------------------------------------------------ helpers to act as a user on a date
    const as = (username, date) => ({
      db, org_code: db.get('SELECT org_code FROM AUDIT_USER WHERE username = ?', username).org_code,
      user: db.get('SELECT * FROM AUDIT_USER WHERE username = ?', username), today: date,
    });
    const approve = (username, date, itemType, itemId, action = 'APPROVED', comment = '') => {
      const c = as(username, date);
      const ap = P.AUDIT_APPROVAL_INBOX(c).find((x) => x.item_type === itemType && x.item_id === itemId);
      if (!ap) throw new Error(`seed: no pending ${itemType} ${itemId} for ${username}`);
      P.AUDIT_APPROVAL_ACT(c, ap.appr_id, action, comment);
    };
    const type = (org, code) => db.get('SELECT type_id FROM AUDIT_TYPE WHERE org_code = ? AND code = ?', org, code).type_id;
    const cps = (org) => db.all('SELECT cp_id FROM AUDIT_CHECKPOINT WHERE org_code = ? ORDER BY cp_id', org).map((r) => r.cp_id);
    const answerAll = (c, auditId, noList = [], comment = {}) => {
      const answers = {};
      for (const id of cps(c.org_code)) answers[id] = { answer: noList.includes(id) ? 'NO' : 'YES', comment: comment[id] || '' };
      P.AUDIT_CHECK_SAVE(c, auditId, answers);
    };
    const area = (org, serial) => db.get('SELECT area_id FROM AUDIT_AREA WHERE org_code = ? AND serial = ?', org, serial).area_id;
    const cpOf = (org, serial) => db.get('SELECT c.cp_id FROM AUDIT_CHECKPOINT c JOIN AUDIT_AREA a ON a.area_id = c.area_id WHERE a.org_code = ? AND a.serial = ? ORDER BY c.cp_id LIMIT 1', org, serial).cp_id;
    const lastReplyStatus = (obsId) => db.get('SELECT status FROM AUDIT_OBSERVATION WHERE obs_id = ?', obsId).status;

    // ------------------------------------------------------------ teams
    const team1 = P.AUDIT_TEAM_CREATE(as('cao', day(-420)), { name: 'IA Team North (Nasrin)', members: [{ emp_id: emp.auditor1, member_role: 'LEADER' }, { emp_id: emp.auditor2, member_role: 'MEMBER' }] });
    const team2 = P.AUDIT_TEAM_CREATE(as('cao', day(-420)), { name: 'IA Team South (Sharmin)', members: [{ emp_id: emp.auditor3, member_role: 'LEADER' }, { emp_id: emp.auditor4, member_role: 'MEMBER' }] });
    const teamAm = P.AUDIT_TEAM_CREATE(as('am_jsa', day(-60)), { name: 'Joypurhat Sadar Area visit team', members: [{ emp_id: emp.am_jsa, member_role: 'LEADER' }] });
    const teamZm = P.AUDIT_TEAM_CREATE(as('zm_joy', day(-60)), { name: 'Joypurhat Zone team', members: [{ emp_id: emp.zm_joy, member_role: 'LEADER' }] });

    // ------------------------------------------------------------ annual plan (approved by ED)
    const fy = Number(base.slice(0, 4)) - (Number(base.slice(5, 7)) < 7 ? 1 : 0);
    const fyLabel = `${fy}-${String(fy + 1).slice(2)}`;
    const planItems = [
      ['B201', 0, team1], ['B302', 2, team2], ['B101', 3, team1], ['B102', 4, team1], ['B301', 4, team2], ['B202', 5, team2],
      ['B103', 6, team1], ['B201', 8, team1], ['B302', 9, team2], ['B101', 10, team1], ['B301', 11, team2],
    ].map(([b, m, t]) => ({
      plan_month: `${fy + (m + 7 > 12 ? 1 : 0)}-${String(((m + 6) % 12) + 1).padStart(2, '0')}`,
      office_id: off[b], type_id: type('ASO', 'REG'), team_id: t,
    }));
    const planDate = `${fy}-06-10`;
    const planId = P.AUDIT_PLAN_CREATE(as('cao', planDate), { plan_year: fyLabel, period: 'YEARLY', remarks: 'Each branch is covered every 6 to 10 months as per TOR.', items: planItems });
    P.AUDIT_PLAN_SUBMIT(as('cao', planDate), planId);
    approve('ed', addDays(planDate, 3), 'PLAN', planId);

    // Zone plan by the Zonal Manager, waiting for the Divisional Manager (direct supervisor).
    const zPlan = P.AUDIT_PLAN_CREATE(as('zm_joy', day(-4)), {
      plan_year: fyLabel, period: 'QUARTERLY', remarks: 'Zonal visits for this quarter',
      items: [{ plan_month: day(20).slice(0, 7), office_id: off.B103, type_id: type('ASO', 'MON'), team_id: teamZm },
        { plan_month: day(45).slice(0, 7), office_id: off.B202, type_id: type('ASO', 'MON'), team_id: teamZm }],
    });
    P.AUDIT_PLAN_SUBMIT(as('zm_joy', day(-4)), zPlan);

    // ------------------------------------------------------------ helper: run an IA audit to "in progress"
    const scheduleIA = (branch, teamId, typeCode, start, days, opts = {}) => {
      const c = as('cao', addDays(start, -20));
      const id = P.AUDIT_SCHEDULE_CREATE(c, {
        type_id: type('ASO', typeCode), office_id: off[branch], team_id: teamId, start_date: start, end_date: addDays(start, days),
        plan_kind: opts.surprise ? 'SURPRISE' : 'PLANNED', notify_branch: opts.surprise ? 0 : 1, instruction: opts.instruction,
      });
      P.AUDIT_SCHEDULE_SUBMIT(c, id);
      if (opts.pending) return id;
      approve('ed', addDays(start, -18), 'SCHEDULE', id);
      return id;
    };

    // ============ Panchbibi: an older audit that is fully closed
    const leaderOf = (teamId) => (teamId === team1 ? 'auditor1' : 'auditor3');
    const memberOf = (teamId) => (teamId === team1 ? 'auditor2' : 'auditor4');
    const old201 = scheduleIA('B201', team1, 'REG', day(-400), 5);
    {
      const s = day(-400);
      P.AUDIT_START(as('auditor1', s), old201);
      answerAll(as('auditor2', s), old201, [cpOf('ASO', 22)]);
      const o1 = P.AUDIT_OBS_CREATE(as('auditor2', addDays(s, 2)), old201, {
        area_id: area('ASO', 22), title: 'Registers not updated', details: 'Visitor and complaint registers were not updated for 3 months.',
        auditor_comment: 'Weak branch supervision.', recommendation: 'Update all registers and keep them up to date.', risk_code: 'LOW',
      }, [{ emp_id: emp.bm_b201, person_role: 'MAIN' }]);
      P.AUDIT_SUBMIT(as('auditor1', addDays(s, 5)), old201, { ack_name: 'Md. Golam Mostofa', ack_comment: 'Agreed' });
      approve('cao', addDays(s, 8), 'REPORT', old201);
      P.AUDIT_RELEASE(as('cao', addDays(s, 9)), old201);
      P.AUDIT_OBS_RESPOND(as('bm_b201', addDays(s, 12)), o1, { response_type: 'ACTION_TAKEN', text: 'All registers have been updated.', action_taken: 'Registers updated and checked weekly.' });
      P.AUDIT_OBS_VERIFY(as('auditor1', addDays(s, 15)), o1, 'ACCEPT', 'Checked the registers, now updated.');
      P.AUDIT_OBS_CLOSE(as('cao', addDays(s, 16)), o1, 'Closed after verification');
      P.AUDIT_CLOSE(as('cao', addDays(s, 17)), old201);
    }

    // ============ Joypurhat Sadar: previous audit still under response (two items stay open)
    const prev101 = scheduleIA('B101', team1, 'REG', day(-230), 6);
    let prevOpen = [];
    {
      const s = day(-230);
      P.AUDIT_START(as('auditor1', s), prev101);
      answerAll(as('auditor1', s), prev101, [cpOf('ASO', 1), cpOf('ASO', 8), cpOf('ASO', 19)]);
      const fin = P.AUDIT_OBS_CREATE(as('auditor1', addDays(s, 2)), prev101, {
        area_id: area('ASO', 8), cp_id: cpOf('ASO', 8), is_financial: 1, title: 'Passbook and ledger mismatch in 3 members',
        details: 'সমিতি নং ১২ এর ৩ জন সদস্যের পাসবইয়ের স্থিতি খতিয়ানের চেয়ে বেশি। মোট পার্থক্য ১৮,৫০০ টাকা।',
        auditor_comment: 'মাঠকর্মী আদায়কৃত টাকা যথাসময়ে জমা দেননি।', recommendation: 'Recover the amount from the field officer and correct the ledger.',
        risk_code: 'HIGH', amount: 18500, show_cause: 1,
      }, [{ emp_id: emp.fo_b101, person_role: 'MAIN' }, { emp_id: emp.bm_b101, person_role: 'SUPERVISORY' }]);
      const vouch = P.AUDIT_OBS_CREATE(as('auditor2', addDays(s, 3)), prev101, {
        area_id: area('ASO', 19), cp_id: cpOf('ASO', 19), title: 'Expense vouchers without approval',
        details: '7 expense vouchers worth Tk 12,300 had no BM approval signature.', recommendation: 'Get every voucher approved before payment.',
        risk_code: 'MEDIUM',
      }, [{ emp_id: emp.acc_b101, person_role: 'MAIN' }]);
      const cash = P.AUDIT_OBS_CREATE(as('auditor1', addDays(s, 1)), prev101, {
        area_id: area('ASO', 1), cp_id: cpOf('ASO', 1), title: 'Cash book not closed daily',
        details: 'Cash book was not closed and signed on 4 days.', recommendation: 'Close and sign the cash book every day.',
        risk_code: 'LOW', corrected_on_spot: 1, correction_note: 'BM closed and signed the cash book in front of the auditor.',
      }, []);
      const samity = P.AUDIT_OBS_CREATE(as('auditor2', addDays(s, 4)), prev101, {
        area_id: area('ASO', 4), title: 'Samity meeting held on a different day',
        details: 'Samity 7 and 15 met on Monday instead of the fixed Sunday for two months.', recommendation: 'Hold samity meetings on the fixed day.',
        risk_code: 'LOW',
      }, [{ emp_id: emp.fo_b101, person_role: 'MAIN' }]);
      P.AUDIT_SUBMIT(as('auditor1', addDays(s, 6)), prev101, { ack_name: 'Md. Abu Bakar Siddique', ack_comment: 'Observations noted.' });
      approve('cao', addDays(s, 9), 'REPORT', prev101);
      P.AUDIT_RELEASE(as('cao', addDays(s, 10)), prev101);
      // replies
      P.AUDIT_OBS_RESPOND(as('fo_b101', addDays(s, 14)), fin, { response_type: 'ACTION_TAKEN', text: 'আমি ৮,০০০ টাকা জমা দিয়েছি। বাকি টাকা আগামী মাসে জমা দেব।', action_taken: 'Part deposit made', amount_recovered: 8000 });
      P.AUDIT_OBS_VERIFY(as('auditor1', addDays(s, 18)), fin, 'PARTLY', 'Tk 8,000 deposit seen in the cash book. Tk 10,500 still due.');
      P.AUDIT_OBS_RESPOND(as('acc_b101', addDays(s, 13)), vouch, { response_type: 'EXPLANATION', text: 'The BM was on leave, the vouchers were paid on urgent need.' });
      P.AUDIT_OBS_VERIFY(as('auditor2', addDays(s, 17)), vouch, 'REISSUE', 'Explanation not accepted. Get the vouchers approved now and send copies.', addDays(s, 25));
      P.AUDIT_OBS_RESPOND(as('fo_b101', addDays(s, 12)), samity, { response_type: 'ACTION_TAKEN', text: 'Both samity now meet on Sunday.' });
      P.AUDIT_OBS_VERIFY(as('auditor2', addDays(s, 16)), samity, 'ACCEPT', 'Confirmed with the samity attendance register.');
      P.AUDIT_OBS_CLOSE(as('cao', addDays(s, 20)), samity, 'Closed');
      P.AUDIT_OBS_CLOSE(as('cao', addDays(s, 20)), cash, 'Corrected during audit');
      prevOpen = [fin, vouch];
    }

    // ============ Panchbibi: current audit under response (overdue, replied, resolved, partly)
    const cur201 = scheduleIA('B201', team1, 'REG', day(-26), 6);
    {
      const s = day(-26);
      P.AUDIT_START(as('auditor1', s), cur201);
      answerAll(as('auditor1', s), cur201, [cpOf('ASO', 9), cpOf('ASO', 6), cpOf('ASO', 10), cpOf('ASO', 25)]);
      P.AUDIT_FRAUD_ADD(as('auditor2', addDays(s, 3)), cur201, { emp_id: emp.fo_b201, fraud_type: 'MISAPPROPRIATED', amount: 45000, found_date: addDays(s, 3), how_found: 'Passbook verification in samity 4 and 9', recovered_spot: 5000 });
      P.AUDIT_FRAUD_ADD(as('auditor2', addDays(s, 3)), cur201, { emp_id: emp.fo2_b201, fraud_type: 'GRACE_COLLECTION', amount: 6200, found_date: addDays(s, 4), how_found: 'Member interview', recovered_spot: 0 });
      const fraud = P.AUDIT_OBS_CREATE(as('auditor2', addDays(s, 3)), cur201, {
        area_id: area('ASO', 9), cp_id: cpOf('ASO', 9), is_financial: 1, title: 'Field officer misappropriated loan instalments',
        details: 'সমিতি নং ৪ ও ৯ এর ১১ জন ঋণীর কাছ থেকে আদায়কৃত কিস্তির ৪৫,০০০ টাকা খতিয়ানে জমা হয়নি। পাসবইয়ে আদায় দেখানো আছে।',
        auditor_comment: 'গুরুতর আর্থিক অনিয়ম। মাঠকর্মীর বিরুদ্ধে কারণ দর্শানো প্রয়োজন।', recommendation: 'Recover Tk 45,000 and take disciplinary action as per HR policy.',
        risk_code: 'CRITICAL', amount: 45000, show_cause: 1,
      }, [{ emp_id: emp.fo_b201, person_role: 'MAIN' }, { emp_id: emp.bm_b201, person_role: 'SUPERVISORY' }]);
      const grace = P.AUDIT_OBS_CREATE(as('auditor2', addDays(s, 4)), cur201, {
        area_id: area('ASO', 9), title: 'Collection during grace period',
        details: '6 borrowers paid instalments during the grace period; Tk 6,200 was kept outside the books.', recommendation: 'Deposit the amount and stop grace-period collection.',
        risk_code: 'HIGH', amount: 6200, is_financial: 1, show_cause: 1,
      }, [{ emp_id: emp.fo2_b201, person_role: 'MAIN' }]);
      const loanCeil = P.AUDIT_OBS_CREATE(as('auditor1', addDays(s, 2)), cur201, {
        area_id: area('ASO', 6), cp_id: cpOf('ASO', 6), title: 'Loans disbursed above product ceiling',
        details: '4 loans of the Jagoron product were disbursed above the Tk 50,000 ceiling without head office approval.', recommendation: 'Take head office approval for any loan above ceiling.',
        risk_code: 'MEDIUM',
      }, [{ emp_id: emp.bm_b201, person_role: 'MAIN' }]);
      const refund = P.AUDIT_OBS_CREATE(as('auditor1', addDays(s, 4)), cur201, {
        area_id: area('ASO', 10), cp_id: cpOf('ASO', 10), title: 'Savings refunded without application',
        details: 'Savings of 3 members were refunded without a written application.', recommendation: 'Keep the written application with every refund voucher.',
        risk_code: 'MEDIUM',
      }, [{ emp_id: emp.acc_b201, person_role: 'MAIN' }]);
      P.AUDIT_OBS_CREATE(as('auditor1', addDays(s, 2)), cur201, {
        area_id: area('ASO', 25), cp_id: cpOf('ASO', 25), title: 'Safe key kept by one person',
        details: 'Both safe keys were with the accountant.', recommendation: 'BM and accountant must each keep one key.',
        risk_code: 'HIGH', corrected_on_spot: 1, correction_note: 'One key handed to the BM during the audit.',
      }, []);
      P.AUDIT_OBS_CREATE(as('auditor1', addDays(s, 5)), cur201, {
        area_id: area('ASO', 9), title: 'Possible collusion of BM in field officer fraud',
        details: 'The BM signed the weekly collection checks for samity 4 and 9 without visiting. Needs ED decision on inquiry.',
        recommendation: 'Form an inquiry committee.', risk_code: 'HIGH', confidential: 1,
      }, [{ emp_id: emp.bm_b201, person_role: 'MAIN' }]);
      P.AUDIT_SUBMIT(as('auditor1', addDays(s, 6)), cur201, { ack_name: 'Md. Golam Mostofa', ack_comment: 'Received the observation list.' });
      approve('cao', addDays(s, 10), 'REPORT', cur201);
      P.AUDIT_RELEASE(as('cao', addDays(s, 12)), cur201);
      P.AUDIT_OBS_RESPOND(as('fo_b201', addDays(s, 16)), fraud, { response_type: 'ACTION_TAKEN', text: 'আমি ২০,০০০ টাকা ফেরত দিয়েছি। বাকি টাকা বেতন থেকে কর্তন করার অনুরোধ করছি।', action_taken: 'Deposited Tk 20,000', amount_recovered: 20000 });
      P.AUDIT_OBS_VERIFY(as('auditor1', addDays(s, 18)), fraud, 'PARTLY', 'Tk 20,000 deposited (voucher 4471). Tk 20,000 still due after Tk 5,000 recovered on the spot.');
      P.AUDIT_RECOVERY_ADD(as('auditor1', addDays(s, 18)), fraud, { amount: 5000, mode: 'CASH', voucher_no: 'On the spot', rec_date: addDays(s, 3) });
      P.AUDIT_OBS_RESPOND(as('bm_b201', addDays(s, 17)), loanCeil, { response_type: 'EXPLANATION', text: 'These were old members with good repayment. We will take approval from now.' });
      P.AUDIT_OBS_RESPOND(as('acc_b201', addDays(s, 16)), refund, { response_type: 'ACTION_TAKEN', text: 'Applications collected from the 3 members and attached to the vouchers.' });
      P.AUDIT_OBS_VERIFY(as('auditor1', addDays(s, 19)), refund, 'ACCEPT', 'Applications seen.');
      void grace;
    }

    // ============ Shibganj: audit submitted, waiting for the Chief Audit Officer's review
    const sub302 = scheduleIA('B302', team2, 'REG', day(-12), 5);
    {
      const s = day(-12);
      P.AUDIT_START(as('auditor3', s), sub302);
      answerAll(as('auditor4', s), sub302, [cpOf('ASO', 15), cpOf('ASO', 9)]);
      P.AUDIT_OBS_CREATE(as('auditor3', addDays(s, 2)), sub302, {
        area_id: area('ASO', 15), cp_id: cpOf('ASO', 15), title: 'Sufolon loan above land size',
        details: '5 Sufolon loans were given for more land than the borrower holds.', recommendation: 'Verify land documents before disbursement.',
        risk_code: 'MEDIUM',
      }, [{ emp_id: emp.fo_b302, person_role: 'MAIN' }]);
      P.AUDIT_OBS_CREATE(as('auditor4', addDays(s, 3)), sub302, {
        area_id: area('ASO', 9), cp_id: cpOf('ASO', 9), title: 'PAR above PKSF standard',
        details: 'Portfolio at risk is 10.9% against the PKSF maximum of 10%.', recommendation: 'Make an overdue recovery plan per field officer.',
        risk_code: 'HIGH',
      }, [{ emp_id: emp.bm_b302, person_role: 'MAIN' }]);
      P.AUDIT_SUBMIT(as('auditor3', addDays(s, 5)), sub302, { ack_name: 'Md. Ariful Haque', ack_comment: 'Agreed' });
    }

    // ============ Joypurhat Sadar: current audit in progress, previous items waiting for follow-up
    const cur101 = scheduleIA('B101', team1, 'REG', day(-2), 6, { instruction: 'Check recovery of the passbook mismatch found in the last audit.' });
    {
      const s = day(-2);
      P.AUDIT_START(as('auditor1', s), cur101);
      const first = cps('ASO').slice(0, 8);
      const answers = {};
      first.forEach((id, i) => { answers[id] = { answer: i === 2 ? 'NO' : 'YES', comment: i === 2 ? 'Reconciliation of last month not done' : '' }; });
      P.AUDIT_CHECK_SAVE(as('auditor2', s), cur101, answers);
      P.AUDIT_OBS_CREATE(as('auditor2', day(-1)), cur101, {
        area_id: area('ASO', 2), cp_id: cpOf('ASO', 2), title: 'Bank reconciliation pending',
        details: 'Bank reconciliation for last month is not done. Difference of Tk 2,350 not explained.', recommendation: 'Complete the reconciliation and explain the difference.',
        risk_code: 'MEDIUM',
      }, [{ emp_id: emp.acc_b101, person_role: 'MAIN' }, { emp_id: emp.bm_b101, person_role: 'SUPERVISORY' }]);
      P.AUDIT_WORKPLAN_SAVE(as('auditor1', day(-5)), [0, 1, 2, 3, 4, 5].map((i) => ({
        plan_date: day(-2 + i), office_id: off.B101, audit_id: cur101, night_stay: 'Branch guest room, Joypurhat Sadar',
        morning_plan: ['Cash count and cash book', 'Previous audit follow-up', 'Samity visit 4, 7', 'Passbook check samity 12', 'Ledger and vouchers', 'Exit meeting'][i],
        afternoon_plan: ['Bank book and reconciliation', 'Loan files', 'Samity visit 12, 15', 'Staff files and registers', 'Observation entry', 'Submit audit'][i],
      })));
    }
    void prevOpen;

    // ============ Khetlal: approved, starts in 3 days (branch notified)
    scheduleIA('B102', team1, 'REG', day(3), 5);
    // ============ Kalai: surprise cash count, hidden from the branch until it starts
    scheduleIA('B202', team2, 'SCC', day(5), 0, { surprise: true, instruction: 'Surprise cash count ordered by the ED.' });
    // ============ Bogura Sadar: schedule waiting for ED approval
    scheduleIA('B301', team2, 'REG', day(10), 5, { pending: true });

    // ============ Akkelpur: Area Manager's own audit, waiting for the Zonal Manager (direct supervisor)
    {
      const c = as('am_jsa', day(-3));
      const id = P.AUDIT_SCHEDULE_CREATE(c, { type_id: type('ASO', 'MON'), office_id: off.B103, team_id: teamAm, start_date: day(6), end_date: day(6), plan_kind: 'PLANNED', notify_branch: 1 });
      P.AUDIT_SCHEDULE_SUBMIT(c, id);
    }

    // ============================================================ COAST (manual data entry client)
    db.run(`INSERT INTO AUDIT_ORG (org_code, name_en, name_bn, address_en, address_bn, data_source, memo_format)
            VALUES ('COAST','COAST Foundation','কোস্ট ফাউন্ডেশন','Cox''s Bazar, Bangladesh','কক্সবাজার, বাংলাদেশ','MANUAL','COAST/IAD/{YYYY}/{SL}')`);
    // COAST keeps a stricter own-policy PAR limit, to show org-wise standards.
    AUDIT_loadOrgDefaults(db, 'COAST', '2020-01-01', { PAR: { max: 8, std_source: 'OWN' } });
    const coast = (code, en, bn, level, parent, open) => addOffice('COAST', code, en, bn, level, parent, open, 'MANUAL');
    coast('C-HO', 'Head Office', 'প্রধান কার্যালয়', 'HO', null, '2000-01-01');
    coast('C-Z1', 'Cox\'s Bazar Zone', 'কক্সবাজার জোন', 'ZONE', 'C-HO', '2005-01-01');
    coast('C-A1', 'Cox\'s Bazar Sadar Area', 'কক্সবাজার সদর এরিয়া', 'AREA', 'C-Z1', '2005-01-01');
    coast('C101', 'Cox\'s Bazar Sadar Branch', 'কক্সবাজার সদর শাখা', 'BRANCH', 'C-A1', '2005-06-01');
    coast('C102', 'Teknaf Branch', 'টেকনাফ শাখা', 'BRANCH', 'C-A1', '2009-01-01');
    const coastP = (username, pin, en, bn, desig, officeCode, userType, role) => person('COAST', username, pin, en, bn, desig, officeCode, userType, role, 'MANUAL');
    db.run(`INSERT INTO AUDIT_USER (org_code, username, password_hash, user_type, role, office_id) VALUES ('COAST','coast_admin',?,'ADMIN','ADMIN',?)`, hash, off['C-HO']);
    coastP('coast_ed', 'C001', 'Rezaul Karim Chowdhury', 'রেজাউল করিম চৌধুরী', 'Executive Director', 'C-HO', 'HO', 'ED');
    coastP('coast_cao', 'C010', 'Md. Mostafizur Rahman', 'মোঃ মোস্তাফিজুর রহমান', 'Head of Internal Audit', 'C-HO', 'HO', 'CAO');
    coastP('coast_auditor', 'C055', 'Tahmina Akter', 'তাহমিনা আক্তার', 'Auditor', 'C-HO', 'HO', 'AUDITOR');
    coastP('coast_am', 'C120', 'Md. Hasan Mahmud', 'মোঃ হাসান মাহমুদ', 'Area Manager', 'C-A1', 'AREA', 'AM');
    coastP('coast_bm', 'C301', 'Md. Nur Hossain', 'মোঃ নূর হোসেন', 'Branch Manager', 'C101', 'BRANCH', 'BM');
    for (const m of monthEnds(base, 6)) {
      for (const [code, v] of Object.entries({ MEMBERS_PER_BRANCH: 1720, MEMBERS_PER_CO: 344, BORROWERS_PER_CO: 290, BORROWER_COVERAGE: 79, PAR: 8.6, OTR: 93.5, ME_LOAN_SHARE: 44, SUFOLON_SHARE: 15, GOOD_LOAN_SHARE: 96, DEBT_CAPITAL: 6.1, CAPITAL_ADEQUACY: 15 })) {
        db.run('INSERT INTO AUDIT_BRANCH_DATA (org_code, office_id, as_on, ind_code, value, data_source) VALUES (?,?,?,?,?,?)', 'COAST', off.C101, m, code, v, 'MANUAL');
      }
    }
    const cTeam = P.AUDIT_TEAM_CREATE(as('coast_cao', day(-30)), { name: 'COAST IA Team 1', members: [{ emp_id: emp.coast_auditor, member_role: 'LEADER' }] });
    const cId = P.AUDIT_SCHEDULE_CREATE(as('coast_cao', day(-7)), { type_id: type('COAST', 'REG'), office_id: off.C101, team_id: cTeam, start_date: day(8), end_date: day(13), plan_kind: 'PLANNED', notify_branch: 1 });
    P.AUDIT_SCHEDULE_SUBMIT(as('coast_cao', day(-7)), cId);
    void lastReplyStatus;
  });
}

module.exports = { AUDIT_seedDemo, DEMO_PASSWORD };
