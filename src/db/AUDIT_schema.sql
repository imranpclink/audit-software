-- AUDIT module schema.
-- One central database for every client organization: every table carries
-- org_code and every query filters on it. All objects are prefixed AUDIT_.

-- ---------------------------------------------------------------- Master data
CREATE TABLE IF NOT EXISTS AUDIT_ORG (
  org_code      TEXT PRIMARY KEY,
  name_en       TEXT NOT NULL,
  name_bn       TEXT NOT NULL,
  address_en    TEXT,
  address_bn    TEXT,
  data_source   TEXT NOT NULL DEFAULT 'MANUAL' CHECK (data_source IN ('ERP','MANUAL')),
  memo_format   TEXT NOT NULL DEFAULT '{ORG}/IA/Office Order/{YYYY}/{SL}',
  active        INTEGER NOT NULL DEFAULT 1
);

-- Office tree: HO > DIVISION > ZONE > AREA > BRANCH
CREATE TABLE IF NOT EXISTS AUDIT_OFFICE (
  office_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  office_code   TEXT NOT NULL,
  name_en       TEXT NOT NULL,
  name_bn       TEXT NOT NULL,
  office_level  TEXT NOT NULL CHECK (office_level IN ('HO','DIVISION','ZONE','AREA','BRANCH')),
  parent_id     INTEGER REFERENCES AUDIT_OFFICE(office_id),
  open_date     TEXT,
  risk_rating   TEXT NOT NULL DEFAULT 'MEDIUM',
  data_source   TEXT NOT NULL DEFAULT 'MANUAL',
  active        INTEGER NOT NULL DEFAULT 1,
  UNIQUE (org_code, office_code)
);

CREATE TABLE IF NOT EXISTS AUDIT_EMPLOYEE (
  emp_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  pin           TEXT NOT NULL,
  name_en       TEXT NOT NULL,
  name_bn       TEXT NOT NULL,
  designation   TEXT NOT NULL,
  office_id     INTEGER NOT NULL REFERENCES AUDIT_OFFICE(office_id),
  data_source   TEXT NOT NULL DEFAULT 'MANUAL',
  active        INTEGER NOT NULL DEFAULT 1,
  UNIQUE (org_code, pin)
);

-- user_type is the office level of the login (Admin, HO, Division, Zone, Area, Branch).
-- role is what the user does in the audit module.
CREATE TABLE IF NOT EXISTS AUDIT_USER (
  user_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  emp_id        INTEGER REFERENCES AUDIT_EMPLOYEE(emp_id),
  user_type     TEXT NOT NULL CHECK (user_type IN ('ADMIN','HO','DIVISION','ZONE','AREA','BRANCH')),
  role          TEXT NOT NULL CHECK (role IN ('ADMIN','ED','CAO','AUDITOR','DM','ZM','AM','BM','STAFF')),
  office_id     INTEGER NOT NULL REFERENCES AUDIT_OFFICE(office_id),
  lang          TEXT NOT NULL DEFAULT 'en',
  active        INTEGER NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------- Setup
CREATE TABLE IF NOT EXISTS AUDIT_TYPE (
  type_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  code          TEXT NOT NULL,
  name_en       TEXT NOT NULL,
  name_bn       TEXT NOT NULL,
  default_days  INTEGER NOT NULL DEFAULT 5,
  full_checklist INTEGER NOT NULL DEFAULT 1,
  active        INTEGER NOT NULL DEFAULT 1,
  UNIQUE (org_code, code)
);

-- Who audits whom: IA (head office audit cell), DIVISION, ZONE, AREA managers.
CREATE TABLE IF NOT EXISTS AUDIT_LEVEL (
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  level_code    TEXT NOT NULL CHECK (level_code IN ('IA','DIVISION','ZONE','AREA')),
  name_en       TEXT NOT NULL,
  name_bn       TEXT NOT NULL,
  can_audit     TEXT NOT NULL,             -- comma list of office levels
  max_per_month INTEGER NOT NULL DEFAULT 2,
  PRIMARY KEY (org_code, level_code)
);

CREATE TABLE IF NOT EXISTS AUDIT_RISK_LEVEL (
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  risk_code     TEXT NOT NULL,
  name_en       TEXT NOT NULL,
  name_bn       TEXT NOT NULL,
  score         INTEGER NOT NULL,
  colour        TEXT NOT NULL,
  reply_days    INTEGER NOT NULL DEFAULT 5,  -- working days to reply
  needs_ed      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_code, risk_code)
);

CREATE TABLE IF NOT EXISTS AUDIT_AREA (
  area_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  serial        INTEGER NOT NULL,
  name_en       TEXT NOT NULL,
  name_bn       TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS AUDIT_CHECKPOINT (
  cp_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  area_id       INTEGER NOT NULL REFERENCES AUDIT_AREA(area_id),
  question_en   TEXT NOT NULL,
  question_bn   TEXT NOT NULL,
  answer_type   TEXT NOT NULL DEFAULT 'YNP',   -- YN, YNP (Yes/No/Partly/NA), NUMBER, TEXT
  expected      TEXT NOT NULL DEFAULT 'YES',
  default_risk  TEXT NOT NULL DEFAULT 'MEDIUM',
  weight        INTEGER NOT NULL DEFAULT 1,
  active        INTEGER NOT NULL DEFAULT 1
);

-- Indicators and PKSF/MRA standards, organization-wise and editable by the org admin.
-- An edit closes the old row (effective_to) and inserts a new one, so old reports
-- keep the standard that applied at their cut-off date.
CREATE TABLE IF NOT EXISTS AUDIT_INDICATOR (
  ind_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  code          TEXT NOT NULL,
  name_en       TEXT NOT NULL,
  name_bn       TEXT NOT NULL,
  grp           TEXT NOT NULL,
  unit          TEXT NOT NULL,                 -- NUMBER, PCT, RATIO
  std_source    TEXT NOT NULL DEFAULT 'PKSF',
  std_min       REAL,
  std_max       REAL,
  tolerance_pct REAL NOT NULL DEFAULT 10,      -- outside standard by up to this % = Medium, beyond = High
  show_in_report INTEGER NOT NULL DEFAULT 1,
  report_order  INTEGER NOT NULL DEFAULT 0,
  effective_from TEXT NOT NULL,
  effective_to  TEXT,
  changed_by    INTEGER,
  changed_at    TEXT,
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS AUDIT_APPROVAL_POLICY (
  policy_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  applies_to    TEXT NOT NULL CHECK (applies_to IN ('PLAN','SCHEDULE','WORK_PLAN','REPORT')),
  audit_level   TEXT NOT NULL,
  required      INTEGER NOT NULL,
  approver      TEXT NOT NULL DEFAULT 'NONE' CHECK (approver IN ('NONE','ED','CAO','SUPERVISOR')),
  UNIQUE (org_code, applies_to, audit_level)
);

-- ---------------------------------------------------------------- Planning
CREATE TABLE IF NOT EXISTS AUDIT_TEAM (
  team_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  team_code     TEXT NOT NULL,
  name          TEXT NOT NULL,
  audit_level   TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS AUDIT_TEAM_MEMBER (
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  team_id       INTEGER NOT NULL REFERENCES AUDIT_TEAM(team_id),
  emp_id        INTEGER NOT NULL REFERENCES AUDIT_EMPLOYEE(emp_id),
  member_role   TEXT NOT NULL DEFAULT 'MEMBER' CHECK (member_role IN ('LEADER','MEMBER')),
  PRIMARY KEY (team_id, emp_id)
);

CREATE TABLE IF NOT EXISTS AUDIT_PLAN (
  plan_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  plan_no       TEXT NOT NULL,
  plan_year     TEXT NOT NULL,
  period        TEXT NOT NULL DEFAULT 'YEARLY',
  audit_level   TEXT NOT NULL,
  remarks       TEXT,
  status        TEXT NOT NULL DEFAULT 'DRAFT',
  created_by    INTEGER NOT NULL REFERENCES AUDIT_USER(user_id),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS AUDIT_PLAN_ITEM (
  item_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  plan_id       INTEGER NOT NULL REFERENCES AUDIT_PLAN(plan_id),
  plan_month    TEXT NOT NULL,                 -- YYYY-MM
  office_id     INTEGER NOT NULL REFERENCES AUDIT_OFFICE(office_id),
  type_id       INTEGER NOT NULL REFERENCES AUDIT_TYPE(type_id),
  team_id       INTEGER REFERENCES AUDIT_TEAM(team_id),
  remarks       TEXT
);

-- One row per audit (the schedule and, later, the audit file).
CREATE TABLE IF NOT EXISTS AUDIT_SCHEDULE (
  audit_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  audit_no      TEXT NOT NULL,
  plan_item_id  INTEGER REFERENCES AUDIT_PLAN_ITEM(item_id),
  type_id       INTEGER NOT NULL REFERENCES AUDIT_TYPE(type_id),
  audit_level   TEXT NOT NULL,
  office_id     INTEGER NOT NULL REFERENCES AUDIT_OFFICE(office_id),
  team_id       INTEGER NOT NULL REFERENCES AUDIT_TEAM(team_id),
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  period_from   TEXT NOT NULL,
  period_to     TEXT NOT NULL,
  prev_audit_id INTEGER REFERENCES AUDIT_SCHEDULE(audit_id),
  plan_kind     TEXT NOT NULL DEFAULT 'PLANNED' CHECK (plan_kind IN ('PLANNED','SURPRISE')),
  notify_branch INTEGER NOT NULL DEFAULT 1,
  instruction   TEXT,
  memo_no       TEXT,
  status        TEXT NOT NULL DEFAULT 'DRAFT',
  branch_ack_name TEXT,
  branch_ack_comment TEXT,
  created_by    INTEGER NOT NULL REFERENCES AUDIT_USER(user_id),
  created_at    TEXT NOT NULL,
  started_at    TEXT,
  submitted_at  TEXT,
  released_at   TEXT,
  closed_at     TEXT,
  UNIQUE (org_code, audit_no)
);

CREATE TABLE IF NOT EXISTS AUDIT_WORK_PLAN (
  wp_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  user_id       INTEGER NOT NULL REFERENCES AUDIT_USER(user_id),
  plan_date     TEXT NOT NULL,
  office_id     INTEGER NOT NULL REFERENCES AUDIT_OFFICE(office_id),
  audit_id      INTEGER REFERENCES AUDIT_SCHEDULE(audit_id),
  night_stay    TEXT,
  morning_plan  TEXT,
  afternoon_plan TEXT,
  status        TEXT NOT NULL DEFAULT 'APPROVED'
);

-- Every approval step for plans, schedules, work plans and reports.
CREATE TABLE IF NOT EXISTS AUDIT_APPROVAL (
  appr_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  item_type     TEXT NOT NULL,                 -- PLAN, SCHEDULE, REPORT
  item_id       INTEGER NOT NULL,
  approver_user_id INTEGER REFERENCES AUDIT_USER(user_id),
  action        TEXT NOT NULL DEFAULT 'PENDING' CHECK (action IN ('PENDING','APPROVED','RETURNED','REJECTED','AUTO')),
  comment       TEXT,
  submitted_by  INTEGER REFERENCES AUDIT_USER(user_id),
  submitted_at  TEXT NOT NULL,
  acted_at      TEXT
);

-- ---------------------------------------------------------------- Field audit
CREATE TABLE IF NOT EXISTS AUDIT_CHECK_ANSWER (
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  audit_id      INTEGER NOT NULL REFERENCES AUDIT_SCHEDULE(audit_id),
  cp_id         INTEGER NOT NULL REFERENCES AUDIT_CHECKPOINT(cp_id),
  answer        TEXT,
  comment       TEXT,
  answered_by   INTEGER,
  answered_at   TEXT,
  PRIMARY KEY (audit_id, cp_id)
);

-- Branch indicator values as on a date (pulled from the ERP or entered by hand).
CREATE TABLE IF NOT EXISTS AUDIT_BRANCH_DATA (
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  office_id     INTEGER NOT NULL REFERENCES AUDIT_OFFICE(office_id),
  as_on         TEXT NOT NULL,
  ind_code      TEXT NOT NULL,
  value         REAL NOT NULL,
  data_source   TEXT NOT NULL DEFAULT 'ERP',
  PRIMARY KEY (office_id, as_on, ind_code)
);

CREATE TABLE IF NOT EXISTS AUDIT_FRAUD (
  fraud_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  audit_id      INTEGER NOT NULL REFERENCES AUDIT_SCHEDULE(audit_id),
  emp_id        INTEGER NOT NULL REFERENCES AUDIT_EMPLOYEE(emp_id),
  fraud_type    TEXT NOT NULL,                 -- MISAPPROPRIATED, CASH_IN_HAND, GRACE_COLLECTION, OTHER
  amount        REAL NOT NULL,
  found_date    TEXT NOT NULL,
  how_found     TEXT,
  recovered_spot REAL NOT NULL DEFAULT 0,
  remarks       TEXT
);

-- ---------------------------------------------------------------- Observations
CREATE TABLE IF NOT EXISTS AUDIT_OBSERVATION (
  obs_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  obs_no        TEXT NOT NULL,
  audit_id      INTEGER NOT NULL REFERENCES AUDIT_SCHEDULE(audit_id),
  area_id       INTEGER REFERENCES AUDIT_AREA(area_id),
  cp_id         INTEGER REFERENCES AUDIT_CHECKPOINT(cp_id),
  is_financial  INTEGER NOT NULL DEFAULT 0,
  title         TEXT NOT NULL,
  details       TEXT NOT NULL,
  auditor_comment TEXT,
  recommendation TEXT,
  risk_code     TEXT NOT NULL,
  amount        REAL NOT NULL DEFAULT 0,
  corrected_on_spot INTEGER NOT NULL DEFAULT 0,
  correction_note TEXT,
  confidential  INTEGER NOT NULL DEFAULT 0,
  show_cause    INTEGER NOT NULL DEFAULT 0,
  deadline      TEXT,
  status        TEXT NOT NULL DEFAULT 'OPEN',
  carried_from_obs_id INTEGER REFERENCES AUDIT_OBSERVATION(obs_id),
  created_by    INTEGER NOT NULL REFERENCES AUDIT_USER(user_id),
  created_at    TEXT NOT NULL,
  closed_by     INTEGER,
  closed_at     TEXT,
  UNIQUE (org_code, obs_no)
);

CREATE TABLE IF NOT EXISTS AUDIT_OBS_PERSON (
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  obs_id        INTEGER NOT NULL REFERENCES AUDIT_OBSERVATION(obs_id),
  emp_id        INTEGER NOT NULL REFERENCES AUDIT_EMPLOYEE(emp_id),
  person_role   TEXT NOT NULL DEFAULT 'MAIN' CHECK (person_role IN ('MAIN','SUPERVISORY')),
  PRIMARY KEY (obs_id, emp_id)
);

-- Discussion history of an observation: replies, supervisor comments, verification, closure.
CREATE TABLE IF NOT EXISTS AUDIT_OBS_RESPONSE (
  resp_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  obs_id        INTEGER NOT NULL REFERENCES AUDIT_OBSERVATION(obs_id),
  user_id       INTEGER NOT NULL REFERENCES AUDIT_USER(user_id),
  kind          TEXT NOT NULL,                 -- REPLY, SUPERVISOR, ACCEPT, PARTLY, REISSUE, CLOSE, CARRY, FOLLOWUP
  response_type TEXT,                          -- EXPLANATION, ACTION_TAKEN, DISAGREE, MORE_TIME
  text          TEXT NOT NULL,
  action_taken  TEXT,
  amount_recovered REAL NOT NULL DEFAULT 0,
  new_deadline  TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS AUDIT_RECOVERY (
  rec_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  obs_id        INTEGER NOT NULL REFERENCES AUDIT_OBSERVATION(obs_id),
  rec_date      TEXT NOT NULL,
  amount        REAL NOT NULL,
  mode          TEXT NOT NULL DEFAULT 'CASH',
  voucher_no    TEXT,
  entered_by    INTEGER NOT NULL REFERENCES AUDIT_USER(user_id)
);

-- ---------------------------------------------------------------- Control
CREATE TABLE IF NOT EXISTS AUDIT_NOTIFICATION (
  notif_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code      TEXT NOT NULL REFERENCES AUDIT_ORG(org_code),
  user_id       INTEGER NOT NULL REFERENCES AUDIT_USER(user_id),
  message       TEXT NOT NULL,
  link          TEXT,
  is_read       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS AUDIT_LOG (
  log_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  org_code      TEXT NOT NULL,
  user_id       INTEGER,
  action        TEXT NOT NULL,
  entity        TEXT NOT NULL,
  entity_id     INTEGER,
  detail        TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS AUDIT_IX_SCHEDULE_OFFICE ON AUDIT_SCHEDULE(org_code, office_id);
CREATE INDEX IF NOT EXISTS AUDIT_IX_OBS_AUDIT ON AUDIT_OBSERVATION(org_code, audit_id);
CREATE INDEX IF NOT EXISTS AUDIT_IX_APPROVAL_USER ON AUDIT_APPROVAL(approver_user_id, action);
CREATE INDEX IF NOT EXISTS AUDIT_IX_NOTIF_USER ON AUDIT_NOTIFICATION(user_id, is_read);
