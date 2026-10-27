# AUDIT module

Standalone internal audit software for microfinance organizations (PKSF partner organizations).
One central database serves every client organization; each record carries `org_code`.
Every database and front-end object is prefixed `AUDIT_`. Screens and printed reports work in Bangla and English.

This is the first build, with demo data. It covers the core cycle from the design document:
**plan → approve → order letter → field audit → observations → review → release → reply → verify → close → carry forward.**

## Stack

| Part | Choice | Why |
|---|---|---|
| Server | Node.js 22.13 or later, Express 4 | Small, widely known, runs on Windows or Linux |
| Pages | Server-rendered EJS templates | No build step; works on slow branch internet |
| Database | SQLite (built into Node, nothing to install) | Zero setup for the demo |
| Business rules | `src/AUDIT_procedures.js` | One function per database procedure (`AUDIT_PLAN_SUBMIT`, `AUDIT_OBS_RESPOND`, ...) so they can be moved into SQL Server / Oracle / PostgreSQL stored procedures one for one |

The schema (`src/db/AUDIT_schema.sql`) is plain SQL, so moving to SQL Server, Oracle or PostgreSQL later means porting the procedures file, not redesigning.

## Run it

```bash
npm install
npm run seed     # (re)load the demo data into data/AUDIT_demo.db
npm start        # http://localhost:3000
npm test         # flow and page tests
```

On first start with an empty database the demo data loads by itself.
The login page lists every demo user; the password for all of them is `demo123`.

## Demo data

Two organizations in the one database:

- **ASO** (Ahead Social Organization, Joypurhat): an existing ERP client. Offices, staff and branch figures are marked as pulled from the ERP.
  Head office, Rajshahi division, 2 zones, 3 areas, 7 branches, ED, Chief Audit Officer, 4 auditors, managers at every level, branch managers and branch staff with their own logins.
- **COAST** (COAST Foundation): a client that enters data by hand, with its own stricter PAR standard (8% instead of PKSF's 10%).

Every demo audit was pushed through the real business rules, so each one is in a state the software itself produces:

| Audit | Branch | State | Try it as |
|---|---|---|---|
| AUD-REG-2025-0001 | Panchbibi | Closed, all observations settled | `cao` |
| AUD-REG-2026-0001 | Joypurhat Sadar | Under response; 2 items still open (one partly recovered, one reissued and overdue) | `fo_b101`, `acc_b101` |
| AUD-REG-2026-0002 | Panchbibi | Under response: overdue, replied (to verify), resolved (to close), partly recovered fraud, confidential item for the ED | `auditor1`, `cao`, `fo_b201`, `bm_b201`, `ed` |
| AUD-REG-2026-0003 | Shibganj | Submitted, waiting for the Chief Audit Officer's review | `cao` |
| AUD-REG-2026-0004 | Joypurhat Sadar | In progress; the previous audit's 2 open items wait in the follow-up tab | `auditor1`, `auditor2` |
| AUD-REG-2026-0005 | Khetlal | Approved, branch notified | `auditor1`, `bm_b102` |
| AUD-SCC-2026-0006 | Kalai | Surprise cash count, hidden from the branch until it starts | `auditor3`; `bm_b202` cannot see it |
| AUD-REG-2026-0007 | Bogura Sadar | Waiting for ED approval | `ed` |
| AUD-MON-2026-0008 | Akkelpur | Area Manager's own audit, waiting for the Zonal Manager | `am_jsa`, `zm_joy` |
| Zone plan | Joypurhat Zone | Zonal Manager's plan, waiting for the Divisional Manager | `zm_joy`, `dm_raj` |

## Confirmed rules built in

- **User types**: Admin, HO, Division, Zone, Area, Branch. Roles: ED, Chief Audit Officer, Auditor, Divisional/Zonal/Area Manager, Branch Manager, branch staff, admin.
- **Office scope**: a manager plans and sees audits only inside their own office tree; head office auditors cover all offices.
- **Approval policy** (Setup → Approval Policy, admin-editable):
  Internal Audit plan and schedule need the ED; Area/Zone/Division manager audits need the direct supervisor (manager of the next office up); work plans need none; IA reports are reviewed by the Chief Audit Officer.
  Turning approval off auto-approves.
- **Planned or surprise**: a planned audit can notify the branch or not; a surprise audit is hidden from the branch and its managers until the team starts it.
- **Indicators and PKSF standards**: kept per organization and editable only by that organization's admin. An edit creates a new row from its effective date, so older audit reports keep the standard that applied then. Outside the standard by up to the tolerance % is Medium risk, beyond is High.
- **Reply deadline**: release date plus the risk level's reply days (5 working days by default for every level, editable in Setup → Risk Levels), skipping Friday and Saturday.
- **Branch staff** have their own logins and see only observations naming them; a Branch Manager sees all of their branch's released observations.
- **Confidential observations** are visible only to the ED, the Chief Audit Officer and the audit team.
- **Financial observations** close only when the full amount is recovered.
- **Follow-up first**: open observations of the previous audit are reviewed at the start of the next one; resolved items close, the rest are carried forward as new observations. An audit closes only when every observation is closed or carried forward, and closing recalculates the branch risk rating.
- **Audit period** is filled automatically: day after the last audit's cut-off (or the branch open date) to the month-end before the start.
- **Conflict check**: warns when a team member works in the audited office tree. Plans warn when a team has more branches in a month than its level allows (2 for IA, per the TOR).

## Pages

| Menu | Pages |
|---|---|
| Dashboard | Plan vs done, pending approvals, open observations by risk, overdue replies, fraud found vs recovered, branch risk and days since last audit |
| Audit Planning | Annual audit plan (branch grid with last audit, days since and risk), audit teams, audit schedule, work plan, approval inbox |
| Audit workspace | Overview, previous follow-up, 28-area TOR checklist, branch data vs PKSF standards, fraud register, observations, submit (completeness check and branch acknowledgement) |
| Response | My observations (inbox with days left), reply, supervisor comment, verify (accept / partly / reissue), recovery entry, close |
| Reports | Annual plan (R1), audit order letter (R3), audit report in chapter format (R5), show-cause letter (R6), observation register (R7), pending / overdue (R9), branch ratio vs PKSF and risk rating (R14, R15). All print or save as PDF in Bangla or English |
| Audit Setup | Indicators and PKSF standards (with history), approval policy, risk levels, audit areas and checkpoints, audit types, audit levels, offices, employees, users (manual entry for non-ERP clients) |

## Not in this build yet

These are in the design document and come in the next phases:

- ERP connector: the demo marks ASO data as pulled from the ERP; the actual pull from your ERP database is the next step once the ERP's database and procedure names are shared.
- Workspace tabs for member exceptions, samity and passbook check, cash and bank count, overdue and budget trend, daily diary.
- Letter template setup (memo format is per organization today), policy and circular library, holiday calendar, escalation rules.
- Disciplinary action register, Excel export, the remaining reports (R2, R4, R8, R10 to R13, R16 to R18).
- Extra features X1 to X13 (ERP exception scan, risk-based selection, SMS/email alerts, mobile field entry and so on). In-app notifications are already in place.
- Production hardening: a real session store, HTTPS, password change and reset.
