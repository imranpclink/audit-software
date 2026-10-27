// Default setup rows loaded for every new organization. The org admin can change them later.

const AUDIT_DEFAULT_TYPES = [
  ['REG', 'Regular audit', 'নিয়মিত অডিট', 6, 1],
  ['SPC', 'Special / ad-hoc audit', 'বিশেষ অডিট', 3, 0],
  ['FUP', 'Follow-up audit', 'ফলোআপ অডিট', 2, 0],
  ['SCC', 'Surprise cash count', 'আকস্মিক নগদ গণনা', 1, 0],
  ['MON', 'Monitoring visit', 'মনিটরিং পরিদর্শন', 1, 0],
];

const AUDIT_DEFAULT_LEVELS = [
  ['IA', 'Internal Audit', 'অভ্যন্তরীণ নিরীক্ষা', 'DIVISION,ZONE,AREA,BRANCH', 2],
  ['DIVISION', 'Divisional Manager', 'বিভাগীয় ব্যবস্থাপক', 'ZONE,AREA,BRANCH', 4],
  ['ZONE', 'Zonal Manager', 'জোনাল ব্যবস্থাপক', 'AREA,BRANCH', 4],
  ['AREA', 'Area Manager', 'এরিয়া ব্যবস্থাপক', 'BRANCH', 6],
];

const AUDIT_DEFAULT_RISKS = [
  ['LOW', 'Low', 'নিম্ন', 1, '#2e7d32', 5, 0],
  ['MEDIUM', 'Medium', 'মধ্যম', 2, '#e0a100', 5, 0],
  ['HIGH', 'High', 'উচ্চ', 3, '#d84315', 5, 0],
  ['CRITICAL', 'Critical', 'অতি উচ্চ', 4, '#8e0000', 5, 1],
];

// Confirmed default approval policy:
// IA plan and schedule need the ED; manager audits need the direct supervisor; work plans need none.
// Reports of IA audits are reviewed by the Chief Audit Officer, manager audits by the supervisor.
const AUDIT_DEFAULT_POLICY = [
  ['PLAN', 'IA', 1, 'ED'],
  ['SCHEDULE', 'IA', 1, 'ED'],
  ['WORK_PLAN', 'IA', 0, 'NONE'],
  ['REPORT', 'IA', 1, 'CAO'],
  ...['DIVISION', 'ZONE', 'AREA'].flatMap((lv) => [
    ['PLAN', lv, 1, 'SUPERVISOR'],
    ['SCHEDULE', lv, 1, 'SUPERVISOR'],
    ['WORK_PLAN', lv, 0, 'NONE'],
    ['REPORT', lv, 1, 'SUPERVISOR'],
  ]),
];

// PKSF standards as used in the ASO draft audit report.
// [code, name_en, name_bn, group, unit, min, max, order]
const AUDIT_DEFAULT_INDICATORS = [
  ['MEMBERS_PER_BRANCH', 'Members per branch', 'শাখা প্রতি সদস্য', 'Productivity', 'NUMBER', 1500, 2000, 1],
  ['MEMBERS_PER_CO', 'Members per credit officer', 'ঋণ কর্মকর্তা প্রতি সদস্য', 'Productivity', 'NUMBER', 300, 400, 2],
  ['BORROWERS_PER_CO', 'Borrowers per credit officer', 'ঋণ কর্মকর্তা প্রতি ঋণী', 'Productivity', 'NUMBER', 240, 350, 3],
  ['BORROWER_COVERAGE', 'Borrower coverage (%)', 'ঋণী আওতা (%)', 'Productivity', 'PCT', 70, null, 4],
  ['PAR', 'Portfolio at risk (%)', 'ঝুঁকিপূর্ণ পোর্টফোলিও (%)', 'Portfolio quality', 'PCT', null, 10, 5],
  ['OTR', 'On-time recovery (%)', 'নিয়মিত আদায় হার (%)', 'Portfolio quality', 'PCT', 92, null, 6],
  ['ME_LOAN_SHARE', 'Microenterprise loans in portfolio (%)', 'মোট ঋণে ক্ষুদ্র উদ্যোগ ঋণ (%)', 'Portfolio quality', 'PCT', null, 60, 7],
  ['SUFOLON_SHARE', 'Sufolon loans in portfolio (%)', 'মোট ঋণে সুফলন ঋণ (%)', 'Portfolio quality', 'PCT', null, 40, 8],
  ['GOOD_LOAN_SHARE', 'Good loans in portfolio (%)', 'মোট ঋণে উত্তম ঋণ (%)', 'Portfolio quality', 'PCT', 95, null, 9],
  ['DEBT_CAPITAL', 'Debt to capital (x:1)', 'ঋণ মূলধন অনুপাত (x:১)', 'Financial leverage', 'RATIO', null, 9, 10],
  ['CAPITAL_ADEQUACY', 'Capital adequacy (%)', 'মূলধন পর্যাপ্ততা (%)', 'Financial leverage', 'PCT', 10, null, 11],
];

// 28 audit areas of the ASO TOR with their default checkpoints.
// [area_en, area_bn, [[question_en, question_bn, default_risk], ...]]
const AUDIT_DEFAULT_AREAS = [
  ['Cash in hand and cash book', 'নগদ তহবিল ও ক্যাশ বই', [
    ['Is cash in hand equal to the cash book balance?', 'হাতে নগদ টাকা কি ক্যাশ বইয়ের স্থিতির সমান?', 'HIGH'],
    ['Is the cash book closed and signed every day?', 'ক্যাশ বই কি প্রতিদিন সমাপ্ত ও স্বাক্ষরিত হয়?', 'MEDIUM'],
  ]],
  ['Bank account and reconciliation', 'ব্যাংক হিসাব ও সমন্বয়', [
    ['Does the bank statement agree with the bank book?', 'ব্যাংক স্টেটমেন্ট কি ব্যাংক বইয়ের সাথে মিলে?', 'HIGH'],
    ['Is the bank reconciliation done every month?', 'প্রতি মাসে কি ব্যাংক সমন্বয় করা হয়?', 'MEDIUM'],
  ]],
  ['Follow-up of previous audit', 'পূর্ববর্তী অডিটের ফলোআপ', [
    ['Have the previous audit observations been settled?', 'পূর্ববর্তী অডিটের পর্যবেক্ষণসমূহ কি নিষ্পত্তি হয়েছে?', 'MEDIUM'],
  ]],
  ['Samity meetings and attendance', 'সমিতি সভা ও উপস্থিতি', [
    ['Are samity meetings held on the fixed day?', 'নির্ধারিত দিনে কি সমিতির সভা হয়?', 'MEDIUM'],
    ['Is member attendance above 80%?', 'সদস্য উপস্থিতি কি ৮০% এর বেশি?', 'LOW'],
  ]],
  ['Member admission and records', 'সদস্য ভর্তি ও রেকর্ড', [
    ['Does every member have an admission form with NID and photo?', 'প্রত্যেক সদস্যের কি এনআইডি ও ছবিসহ ভর্তি ফরম আছে?', 'MEDIUM'],
  ]],
  ['Loan proposal and appraisal', 'ঋণ প্রস্তাব ও মূল্যায়ন', [
    ['Is every loan appraised and approved by the right authority?', 'প্রতিটি ঋণ কি যথাযথ কর্তৃপক্ষ দ্বারা মূল্যায়িত ও অনুমোদিত?', 'HIGH'],
    ['Are loans within the product ceiling?', 'ঋণ কি প্রোডাক্টের সর্বোচ্চ সীমার মধ্যে?', 'MEDIUM'],
  ]],
  ['Loan disbursement', 'ঋণ বিতরণ', [
    ['Are loans disbursed on the samity day in front of the members?', 'ঋণ কি সমিতির দিনে সদস্যদের সামনে বিতরণ করা হয়?', 'MEDIUM'],
  ]],
  ['Passbook verification', 'পাসবই যাচাই', [
    ['Do passbook balances agree with the ledger?', 'পাসবইয়ের স্থিতি কি খতিয়ানের সাথে মিলে?', 'HIGH'],
    ['Does every borrower hold a passbook signed by the officer?', 'প্রত্যেক ঋণীর কাছে কি কর্মকর্তার স্বাক্ষরসহ পাসবই আছে?', 'MEDIUM'],
  ]],
  ['Loan recovery and overdue', 'ঋণ আদায় ও বকেয়া', [
    ['Is the overdue list updated and followed up weekly?', 'বকেয়া তালিকা কি হালনাগাদ ও সাপ্তাহিক ফলোআপ করা হয়?', 'HIGH'],
    ['Is there any collection during the grace period?', 'গ্রেস পিরিয়ডে কি কোনো আদায় হয়েছে?', 'HIGH'],
  ]],
  ['Savings collection and refund', 'সঞ্চয় আদায় ও ফেরত', [
    ['Are savings refunds made only on written application?', 'সঞ্চয় ফেরত কি শুধুমাত্র লিখিত আবেদনে দেওয়া হয়?', 'HIGH'],
  ]],
  ['Loan ledger and collection sheet', 'ঋণ খতিয়ান ও আদায় শিট', [
    ['Are collection sheets posted to the ledger the same day?', 'আদায় শিট কি একই দিনে খতিয়ানে পোস্ট করা হয়?', 'MEDIUM'],
  ]],
  ['Loan classification and provision', 'ঋণ শ্রেণীকরণ ও সঞ্চিতি', [
    ['Is loan classification and provision as per MRA rule 44?', 'ঋণ শ্রেণীকরণ ও সঞ্চিতি কি এমআরএ বিধি ৪৪ অনুযায়ী?', 'MEDIUM'],
  ]],
  ['Loan write-off and rescheduling', 'ঋণ অবলোপন ও পুনঃতফসিল', [
    ['Are rescheduled and written-off loans approved by head office?', 'পুনঃতফসিল ও অবলোপনকৃত ঋণ কি প্রধান কার্যালয় অনুমোদিত?', 'MEDIUM'],
  ]],
  ['Microenterprise loans', 'ক্ষুদ্র উদ্যোগ ঋণ', [
    ['Do microenterprise loans have a business visit report?', 'ক্ষুদ্র উদ্যোগ ঋণে কি ব্যবসা পরিদর্শন প্রতিবেদন আছে?', 'MEDIUM'],
  ]],
  ['Sufolon (seasonal) loans', 'সুফলন ঋণ', [
    ['Does the land size match the Sufolon loan amount?', 'জমির পরিমাণ কি সুফলন ঋণের পরিমাণের সাথে মিলে?', 'MEDIUM'],
  ]],
  ['Member welfare fund', 'সদস্য কল্যাণ তহবিল', [
    ['Are welfare fund claims settled within the time limit?', 'কল্যাণ তহবিলের দাবি কি সময়মতো নিষ্পত্তি হয়?', 'LOW'],
  ]],
  ['Head office fund and inter-office transfers', 'প্রধান কার্যালয় তহবিল ও আন্তঃঅফিস লেনদেন', [
    ['Does the head office fund balance agree with head office records?', 'প্রধান কার্যালয় তহবিলের স্থিতি কি প্রধান কার্যালয়ের রেকর্ডের সাথে মিলে?', 'HIGH'],
  ]],
  ['Budget vs achievement', 'বাজেট বনাম অর্জন', [
    ['Is the branch achieving at least 90% of its budget?', 'শাখা কি বাজেটের অন্তত ৯০% অর্জন করছে?', 'LOW'],
  ]],
  ['Bills, vouchers and expenses', 'বিল, ভাউচার ও ব্যয়', [
    ['Is every expense supported by an approved voucher?', 'প্রতিটি ব্যয়ের কি অনুমোদিত ভাউচার আছে?', 'MEDIUM'],
    ['Are expenses within the approved budget limit?', 'ব্যয় কি অনুমোদিত বাজেট সীমার মধ্যে?', 'LOW'],
  ]],
  ['Field visit by branch manager', 'শাখা ব্যবস্থাপকের মাঠ পরিদর্শন', [
    ['Does the BM visit each samity at least once a month?', 'শাখা ব্যবস্থাপক কি প্রতি মাসে প্রতিটি সমিতি অন্তত একবার পরিদর্শন করেন?', 'LOW'],
  ]],
  ['Staff personal files and attendance', 'কর্মীদের ব্যক্তিগত নথি ও হাজিরা', [
    ['Are staff personal files complete (CV, guarantor, deed)?', 'কর্মীদের ব্যক্তিগত নথি কি পূর্ণাঙ্গ (জীবনবৃত্তান্ত, জামিনদার, দলিল)?', 'LOW'],
  ]],
  ['Registers and files', 'রেজিস্টার ও নথিপত্র', [
    ['Are all prescribed registers kept up to date?', 'সকল নির্ধারিত রেজিস্টার কি হালনাগাদ?', 'LOW'],
  ]],
  ['Fixed assets and inventory', 'স্থায়ী সম্পদ ও মজুদ', [
    ['Do fixed assets agree with the asset register?', 'স্থায়ী সম্পদ কি সম্পদ রেজিস্টারের সাথে মিলে?', 'LOW'],
  ]],
  ['Branch automation and software data', 'শাখা অটোমেশন ও সফটওয়্যার তথ্য', [
    ['Does software data agree with the manual records?', 'সফটওয়্যারের তথ্য কি ম্যানুয়াল রেকর্ডের সাথে মিলে?', 'MEDIUM'],
  ]],
  ['Security of cash and documents', 'নগদ ও দলিলের নিরাপত্তা', [
    ['Is cash kept in the safe with dual-key control?', 'নগদ টাকা কি দ্বৈত চাবি নিয়ন্ত্রিত সিন্দুকে রাখা হয়?', 'HIGH'],
  ]],
  ['Compliance with MRA and PKSF rules', 'এমআরএ ও পিকেএসএফ বিধি পরিপালন', [
    ['Are interest rate and service charge within MRA limits?', 'সুদের হার ও সার্ভিস চার্জ কি এমআরএ সীমার মধ্যে?', 'HIGH'],
  ]],
  ['Complaint handling', 'অভিযোগ ব্যবস্থাপনা', [
    ['Is the complaint box opened and the register kept?', 'অভিযোগ বাক্স কি খোলা হয় ও রেজিস্টার রাখা হয়?', 'LOW'],
  ]],
  ['Office premises and signboard', 'অফিস প্রাঙ্গণ ও সাইনবোর্ড', [
    ['Are the signboard, MRA licence and service charge chart displayed?', 'সাইনবোর্ড, এমআরএ সনদ ও সার্ভিস চার্জ তালিকা কি প্রদর্শিত?', 'LOW'],
  ]],
];

function AUDIT_loadOrgDefaults(db, orgCode, effectiveFrom, overrides = {}) {
  for (const [code, en, bn, days, full] of AUDIT_DEFAULT_TYPES) {
    db.run('INSERT INTO AUDIT_TYPE (org_code, code, name_en, name_bn, default_days, full_checklist) VALUES (?,?,?,?,?,?)', orgCode, code, en, bn, days, full);
  }
  for (const [code, en, bn, can, max] of AUDIT_DEFAULT_LEVELS) {
    db.run('INSERT INTO AUDIT_LEVEL (org_code, level_code, name_en, name_bn, can_audit, max_per_month) VALUES (?,?,?,?,?,?)', orgCode, code, en, bn, can, max);
  }
  for (const [code, en, bn, score, colour, days, ed] of AUDIT_DEFAULT_RISKS) {
    db.run('INSERT INTO AUDIT_RISK_LEVEL (org_code, risk_code, name_en, name_bn, score, colour, reply_days, needs_ed) VALUES (?,?,?,?,?,?,?,?)',
      orgCode, code, en, bn, score, colour, days, ed);
  }
  for (const [applies, level, req, approver] of AUDIT_DEFAULT_POLICY) {
    db.run('INSERT INTO AUDIT_APPROVAL_POLICY (org_code, applies_to, audit_level, required, approver) VALUES (?,?,?,?,?)', orgCode, applies, level, req, approver);
  }
  for (const [code, en, bn, grp, unit, min, max, order] of AUDIT_DEFAULT_INDICATORS) {
    const o = overrides[code] || {};
    db.run(
      `INSERT INTO AUDIT_INDICATOR (org_code, code, name_en, name_bn, grp, unit, std_source, std_min, std_max, report_order, effective_from)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      orgCode, code, en, bn, grp, unit, o.std_source || 'PKSF', o.min !== undefined ? o.min : min, o.max !== undefined ? o.max : max, order, effectiveFrom,
    );
  }
  AUDIT_DEFAULT_AREAS.forEach(([en, bn, cps], i) => {
    const { lastInsertRowid: areaId } = db.run('INSERT INTO AUDIT_AREA (org_code, serial, name_en, name_bn) VALUES (?,?,?,?)', orgCode, i + 1, en, bn);
    for (const [qen, qbn, risk] of cps) {
      db.run('INSERT INTO AUDIT_CHECKPOINT (org_code, area_id, question_en, question_bn, answer_type, expected, default_risk) VALUES (?,?,?,?,?,?,?)',
        orgCode, areaId, qen, qbn, 'YNP', 'YES', risk);
    }
  });
}

module.exports = { AUDIT_loadOrgDefaults, AUDIT_DEFAULT_INDICATORS };
