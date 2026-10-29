/**
 * tools/schema_inventory.js — every table the app actually has, read out of the source.
 *   node tools/schema_inventory.js            → the inventory, as a table
 *   node tools/schema_inventory.js --sql      → PostgreSQL DDL on stdout
 *   node tools/schema_inventory.js --write    → write docs/schema/ and docs/schema/INVENTORY.md
 *
 * WHY THIS IS A TOOL AND NOT A DOCUMENT.
 *
 * The migration has to describe what the app has TODAY, and "today" moves: three sheets gained
 * columns this week (DateTo/GroupID on the leaves, EndDate/EndReason/EndRemark on the students,
 * ByAt on the check-ins, Pause* on the staff). A schema typed out by hand is a snapshot that starts
 * drifting the moment it is saved, and the drift is invisible — a column that exists in Sheets and
 * not in Postgres is data that silently stops being written the day we switch.
 *
 * So the schema is GENERATED from the three places the app already declares it:
 *   1. SCHEMA in src/Config.gs          — the columns of every declared sheet, per workbook
 *   2. COLLECTION_MAP in src/GasEngine.gs — which collections the engine reads, and from where
 *   3. RUNTIME_SHEETS below             — the handful created on demand, never declared
 * Re-run it and the diff tells you what changed.
 *
 * WHAT IT WILL NOT DO IS GUESS AT MONEY. Every column that holds an amount is listed by name in
 * MONEY and typed `numeric(12,2)`. Sheets stores every number as a float64, so today the prepay
 * discounts, the OT, the provident fund and the payroll all run on binary fractions — the defect
 * reported to the ผอ. Inferring "this looks like money" from a column name would carry that
 * uncertainty into the new database, which is the one place it must not go.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------------------------------------
// 1. read the declarations
// ---------------------------------------------------------------------------------------------
const cfg = R('src/Config.gs'), gas = R('src/GasEngine.gs');
/** Strip comments so a column name quoted inside a note is never read as a column. */
const decomment = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** SCHEMA[WB.MAIN] / SCHEMA[WB.HR] → { SHEET: [cols] }, tagged with the workbook it came from. */
function readSheets() {
  const out = [];
  const src = decomment(cfg);
  // each workbook block starts at `SCHEMA[WB.X] = {` and ends at the matching `};`
  for (const wb of ['MAIN', 'HR']) {
    const start = src.indexOf(`SCHEMA[WB.${wb}] = {`);
    if (start < 0) continue;
    const end = src.indexOf('\n};', start);
    const block = src.slice(start, end < 0 ? undefined : end);
    /* The trailing comma is OPTIONAL — the LAST entry in each workbook block has none, and requiring
     * it silently dropped INSURANCE_PCHI (83 columns of a real insurance policy) from the migration.
     * A parser that loses a table without saying so is worse than no parser, which is why the run
     * also prints anything mapped-but-empty rather than only what it found. */
    const re = /^\s{2}([A-Z][A-Z0-9_]*):\s*\[([\s\S]*?)\],?\s*$/gm;
    let m;
    while ((m = re.exec(block))) {
      const cols = (m[2].match(/'([^']+)'/g) || []).map(s => s.slice(1, -1));
      if (cols.length) out.push({ sheet: m[1], wb, cols });
    }
  }
  return out;
}

/** COLLECTION_MAP → which engine collection reads which sheet. */
function readCollections() {
  const m = /var COLLECTION_MAP = \{([\s\S]*?)\n\};/.exec(gas);
  return [...m[1].matchAll(/(\w+):\s*\{ wb: '(\w+)', sheet: '([A-Z0-9_]+)'/g)]
    .map(x => ({ collection: x[1], wb: x[2], sheet: x[3] }));
}

/* SHEETS THE APP CREATES ON DEMAND and never declares in SCHEMA. Every one of them is real and
 * carries live data; leaving them out of the migration would lose it. Columns are taken from the
 * ensureColumns_/insertSheet call that creates each one — quoted here because there is nowhere else
 * to read them from, and checked by tools/test_schema_inventory.js against those call sites. */
const RUNTIME_SHEETS = [
  { sheet: 'ADMIN_INBOX', wb: 'MAIN', cols: ['InboxID', 'Date', 'Category', 'Text', 'Read', 'Ref', 'StaffID', 'StudentID'],
    note: 'the 🔔 in-app inbox — built when the LINE quota ran out' },
  { sheet: 'PERF_LOG', wb: 'MAIN', cols: ['Ts', 'Sid', 'Role', 'Type', 'Action', 'Ms', 'Ok', 'Code', 'Batch', 'Screen', 'Dev', 'Net', 'Pwa', 'Ver', 'Os'],
    note: 'Phase 0 telemetry. NOT migrated — see the note in the DDL' },
  { sheet: 'LINE_RECIPIENTS', wb: 'MAIN', cols: ['Topic', 'StaffID', 'Enabled'],
    note: 'who is pushed for which topic' },
  { sheet: 'FOOD_MENU', wb: 'MAIN', cols: ['MenuID', 'Month', 'Day', 'Slot', 'ItemID', 'Note'],
    note: 'engine-managed (ensureCollectionSheet_ creates it from first write)' },
  { sheet: 'FOOD_ITEMS', wb: 'MAIN', cols: ['ItemID', 'Name', 'NameEN', 'Category', 'Allergens', 'Active'],
    note: 'engine-managed' },
  { sheet: 'CLASS_COVER', wb: 'MAIN', cols: ['CoverID', 'StaffID', 'ClassName', 'FromDate', 'ToDate', 'Note'],
    note: 'engine-managed — a teacher lent to another class' },
  { sheet: 'SURVEYS', wb: 'MAIN', cols: ['SurveyID', 'Title', 'Question', 'Options', 'Target', 'StartDate', 'EndDate', 'Status'],
    note: 'engine-managed' },
  { sheet: 'SURVEY_RESPONSES', wb: 'MAIN', cols: ['ResponseID', 'SurveyID', 'RespondentID', 'Answer', 'Date'],
    note: 'engine-managed' },
  { sheet: 'STAFF', wb: 'HR', cols: null, note: 'declared in SCHEMA — listed here only to show it is HR' }
];

// ---------------------------------------------------------------------------------------------
// 2. build the inventory
// ---------------------------------------------------------------------------------------------
/* ── WHAT A SHEET IS CALLED IN POSTGRES ──────────────────────────────────────────────────────────
 *
 * 🔴 TWO WORKBOOKS, ONE SCHEMA — AND ONE NAME WAS USED TWICE (found 2026-10-10, Phase 2.2).
 *
 * `AUDIT_LOG` exists in BOTH workbooks and they are not the same log. The MAIN one records access to
 * school data; the HR one was created deliberately as "PDPA access log dedicated to the confidential
 * workbook" — salaries, national IDs, leave. Both snake() to `audit_log`, so the generator emitted
 *
 *     create table if not exists audit_log ( … );      -- MAIN
 *     create table if not exists audit_log ( … );      -- HR, and `if not exists` makes it a no-op
 *
 * …which runs cleanly and merges four years of two different audit trails into one table with
 * nothing to tell them apart. The file even looked right: 54 create statements, 53 tables.
 *
 * 🔴 THE TWO WORKBOOKS ARE AN ACCESS BOUNDARY, NOT JUST STORAGE. That is the thing a flat schema
 * loses by default. Somebody who may read the school's audit log must not thereby learn who has been
 * looking at payroll. So the HR copy becomes its own table, and the boundary survives the move —
 * where merging it would have quietly dissolved a PDPA control into a convenience.
 *
 * Only the colliding sheet is prefixed: renaming all ten HR tables would churn every name for a
 * problem one of them has.
 */
function tableName(t) {
  const base = snake(t.sheet);
  return (t.wb === 'HR' && HR_PREFIXED.has(t.sheet)) ? 'hr_' + base : base;
}
const HR_PREFIXED = new Set(['AUDIT_LOG']);

/* ...and the generator refuses to emit the same table twice ever again. A duplicate `create table
 * if not exists` does not fail, it merges — the worst available outcome, and invisible in the file.
 * Checked on the names actually emitted, so a future collision is caught by the thing that causes
 * it rather than by somebody counting create statements by hand. */
function assertNoTableCollision(tables) {
  const by = {};
  tables.forEach(t => { const n = tableName(t); (by[n] = by[n] || []).push(t.wb + '.' + t.sheet); });
  const clash = Object.keys(by).filter(n => by[n].length > 1);
  if (!clash.length) return;
  console.error('\n❌ two sheets would become the same Postgres table.');
  console.error('   `create table if not exists` would silently MERGE them — add the sheet to');
  console.error('   HR_PREFIXED, or rename it, so each one keeps its own table:\n');
  clash.forEach(n => console.error('     ' + n + '  ←  ' + by[n].join('  +  ')));
  console.error('');
  process.exit(1);
}

function inventory() {
  const sheets = readSheets(), cols = readCollections();
  const byKey = new Map();
  const key = t => t.wb + '.' + t.sheet;
  sheets.forEach(s => byKey.set(key(s), { ...s, source: 'SCHEMA', collection: null }));
  RUNTIME_SHEETS.forEach(s => {
    if (!s.cols) return;
    if (byKey.has(key(s))) { byKey.get(key(s)).note = s.note; return; }
    byKey.set(key(s), { ...s, source: 'runtime' });
  });
  cols.forEach(c => {
    const t = byKey.get(key(c));
    if (t) t.collection = c.collection;
    else byKey.set(key(c), { sheet: c.sheet, wb: c.wb, cols: [], source: 'COLLECTION_MAP only', collection: c.collection });
  });
  return [...byKey.values()].sort((a, b) => a.wb.localeCompare(b.wb) || a.sheet.localeCompare(b.sheet));
}

// ---------------------------------------------------------------------------------------------
// 3. types — explicit where it matters, inferred where it does not
// ---------------------------------------------------------------------------------------------
/* EVERY COLUMN THAT HOLDS AN AMOUNT, BY NAME. numeric(12,2), never float. This list is the whole
 * reason the tool exists rather than a hand-typed file: it is checked, it is complete, and adding a
 * money column without adding it here is a test failure (tools/test_schema_inventory.js). */
const MONEY = new Set([
  'Amount', 'Price', 'SlipAmount', 'Rate', 'DailyRate', 'OTRate', 'OTAmount',
  'Discount', 'DiscountAmount', 'Gross', 'ProrateAmount',
  // the OT charge BEFORE a discount — `Amount` is what is billed, this is what it would have been,
  // and the difference is the discount an admin gave and has to be able to justify
  'FullAmount',
  // payroll — every one of these is a figure on somebody's payslip
  'BaseSalary', 'NetPay', 'GrossIncome', 'AdjustmentsTotal', 'DiligenceTotal', 'ExtraChildAmount',
  'HolidayBonus', 'OtherDeductions', 'TotalDeductions', 'TrainingCertAmount',
  'Contribution', 'ContributionOpening', 'ContributionAccum', 'PauseSalaryAmount',
  'DiligenceAttendanceAmount', 'DiligenceFacebookAmount', 'SocialSecurityDeduct', 'TaxDeduct',
  /* ─── ADDED 2026-10-09. EVERY ONE OF THESE WAS `text` IN THE GENERATED MIGRATION ───────────────
   * Found by inverting the default on the money sheets (see MONEY_SHEETS below). They are not
   * borderline: these are the lines of a payslip, read off `gross = base + dT + oi + ot + otCarry
   * + otHol + hb` and `net = gross - ss - contrib - od`.
   *   OTEvening/OTHoliday/OTCarry  the three overtime lines, separate on purpose
   *   OtherIncome                  the admin's free line on the slip
   *   SocialSecurity               ประกันสังคม — a DEDUCTION, and text held it just as happily
   *   DiligenceAttendance/Facebook เบี้ยขยัน, ฿500 each
   *   ContributionEmployer         the school's half of the provident fund, as paid that month
   *   ChildMultiplier              ฿ per extra child (ec = childCount × childMult), not a ratio
   *   OTRollover                   unpaid OT rolled into a family's bill */
  'OTEvening', 'OTHoliday', 'OTCarry', 'OtherIncome', 'SocialSecurity',
  'DiligenceAttendance', 'DiligenceFacebook', 'ContributionEmployer', 'ChildMultiplier',
  'OTRollover'
]);
/* WHAT ONLY LOOKS LIKE MONEY. Listed as explicitly as the money itself, because the check below
 * refuses to let a column matching the money pattern go through unclassified — and "not money" is a
 * decision somebody has to have made, not a default.
 *
 * MilkTotal and Water were in MONEY in the first draft of this file. They are millilitres of milk
 * and water a baby drank. A money type on a child's feed is the same class of mistake as a float on
 * a payslip, pointing the other way, and the audit is what caught it. */
const NOT_MONEY = new Set([
  /* EnableChildRate (2026-10-29) — สวิตช์ว่าครูคนนี้ได้ "เรทจำนวนเด็ก" หรือไม่ ไม่ใช่จำนวนเงิน
     ตั้งชื่อขึ้นต้นด้วย Enable เพื่อให้ BOOL_PREFIX จับได้เองและลงเป็น boolean —
     ไม่ใช่ numeric(12,2) ที่จะเก็บคำว่า 'true' ไม่ได้ · ชื่อที่ตรงกติกาดีกว่าข้อยกเว้นที่ต้องจำ */
  'EnableChildRate',
  'PaidDate', 'PaymentMethod', 'GeneratedBy', 'GeneratedDate', 'PaidBy', 'PayType', 'PayrollID',
  'PrepayID', 'ChargeID', 'PauseSalaryMode', 'ContributionLocked', 'MilkTotal', 'Water',
  /* 🔴 InsuranceSum: MONEY → NOT_MONEY (Phase 2.3, 2026-10-13). It is not an amount this school
   * computes — it is a figure TRANSCRIBED from the insurer's document, '500,000.00' exactly as the
   * policy prints it, and the app only ever displays it. Typed numeric, Postgres normalises it to
   * 500000, and the parent's insurance card would read "จำนวนเงินเอาประกันภัย 500000" directly above
   * a benefits line still saying "(อ.บ.1) 500,000.00" — the same figure, twice, differently, on the
   * card a family is holding at a hospital counter and being asked to match against the policy.
   * Nothing adds it up, so numeric buys nothing and costs that. Same distinction as MilkTotal
   * above, pointing the other way: a number is not money just because it is large. */
  'InsuranceSum',
  // ...and the rest of the OT discount/cancel trail: who, why and when — words and a timestamp,
  // never an amount. Only FullAmount and Discount beside them are figures.
  'DiscountReason', 'DiscountBy', 'DiscountAt', 'CancelledBy', 'CancelNote',
  'Net',  // PERF_LOG: the connection class, '4g' / '3g' — caught by "net" in the pattern

  /* ─── EVERY OTHER COLUMN ON A MONEY SHEET, SAID OUT LOUD (2026-10-09) ──────────────────────────
   * Long, and deliberately so. On the sheets in MONEY_SHEETS the default is inverted: a column that
   * nobody has classified refuses the whole run. So this list is not noise — it is the record that
   * somebody looked at each of these and decided it is not an amount. The cost of that is typing;
   * the cost of the alternative was `social_security text`. */
  // ids, periods and keys
  'StaffID', 'StudentID', 'BillingID', 'OTID', 'OTRecordID', 'AdjID', 'SlipID', 'Month',
  // state machines and approval trails
  'Status', 'VerifiedStatus', 'Verified', 'Approved', 'ApprovedBy', 'ApprovedAt', 'ApprovedBy',
  'Step1By', 'Step1Status', 'Step2By', 'Step2Status', 'SlipSent', 'LeaveExceeds',
  // dates, times and the clock readings OT is computed FROM (not amounts)
  'Date', 'DueDate', 'TransactionDate', 'TransDate', 'TransTime', 'SubmittedDate', 'CreatedAt',
  'PickupTime', 'PlanEnd', 'PlanOut', 'ActualOut', 'PauseFrom', 'PauseTo',
  // references to money that are not money: a QR payload, a bank slip's ref, a Drive url
  'QRRef', 'SlipRef', 'SlipUrl', 'Url', 'FileId', 'TransRef', 'BankAccount', 'BankName',
  'BillRun', 'SlipGroup', 'RefKind', 'RefID', 'Receiver', 'Sender', 'Method',
  // words: who, why, and what about
  'Position', 'StaffName', 'ByName', 'ByStaffID', 'Reason', 'PauseReason', 'Note', 'Label',
  'Field', 'Kind',
  /* FromValue / ToValue are TEXT and must stay text. PAY_ADJUSTMENTS holds one row per FIELD
   * changed, so the same two columns carry '18000' on a salary row and 'ครู' → 'หัวหน้าครู' on a
   * promotion row. Typing them numeric would make the promotion unstorable. */
  'FromValue', 'ToValue',
  /* JSON, both of them. Adjustments is the list of ad-hoc lines on this slip; OTCarryDetail is the
   * OT rows the carry-over came from — otCarryOver_ parses it to tell paid from unpaid. */
  'Adjustments', 'OTCarryDetail',
  'Covered',    // PREPAYMENTS: the JSON list of months this payment covers, not an amount
  // ...and the four outside a money sheet that the name pattern flagged
  'NoPayroll',    // STAFF: 'YES' = on the roster, not on the payroll
  'DiscountUnit', // STUDENTS: 'baht' or '%' — the unit, not the figure
  'ProrateMode',  // STUDENTS: FULL | NONE | DAILY | CUSTOM
  'RateNote'      // STUDENTS: why this family's figures differ, in words
]);
/* ...and the ones that are a COUNT or a MEASUREMENT. Separated deliberately: `Weight` and `Hours`
 * look numeric in the same way and must not become numeric(12,2) by accident. */
const NUMERIC_OTHER = new Set(['Weight', 'Height', 'Hours', 'OTHours', 'Days', 'LateMinutes', 'Minutes',
  'Count', 'Qty', 'Priority', 'AgeMonth', 'ItemNo', 'BillingDay', 'Ms', 'Batch', 'Year',
  'MilkTotal', 'Water',
  /* counts and limits on the payslip — a number, never an amount (2026-10-09). DaysWorked decides a
   * daily-rate salary and LeaveLimit decides whether leave is unpaid, so they are not decorative:
   * they were `text`, and 'text' compares as a string the moment anyone sorts or sums it. */
  'DaysWorked', 'ExtraChildCount', 'LeaveDays', 'LeaveLimit', 'TrainingCertCount',
  'ChildThreshold',
  /* PAYROLL.RatedTotal (2026-10-14) — how many children counted toward the child rate that month,
   * i.e. "4 คน จาก 32". It sits beside ExtraChildAmount, which is the baht; the guard stopped on
   * "Total" in the name and stopping was right, because one of that pair IS money. A count belongs
   * here and not in NOT_MONEY, or it types as `text` next to a numeric ChildThreshold and the two
   * halves of one explanation sort differently.
   *
   * ('ChildCount' was removed from this list on the same day: the engine used that name for the
   * same quantity the sheet has always called ExtraChildCount, and the rename is what closed the
   * Phase 2.6 payslip gap. Left out rather than kept "just in case" — if the name ever reappears,
   * the guard above stops the build and says so, which is the outcome we want.) */
  'RatedTotal',
  'Months'   // PREPAYMENTS: how many months were bought (2 | 3 | 6 | 12)
]);

/* THE GUARD, and the reason the money list can be trusted. Any column whose NAME looks like money
 * must appear in MONEY or in NOT_MONEY — never in neither. The first version of this tool had
 * fifteen payroll columns (GrossIncome, TotalDeductions, DailyRate, the two Diligence amounts, the
 * tax and social-security deductions…) in neither, so they were silently typed `text`: the exact
 * defect this migration exists to end, reproduced in the thing meant to end it.
 *
 * A new money column added to a sheet now fails this run until somebody says which it is. */
const MONEY_LIKE = /(amount|price|salary|pay|total|rate|discount|deduct|bonus|allow|contribut|fee|charge|sum|balance|owed|cost|baht|net|gross|paid)/i;

/* 🔴 THE SHEETS WHERE A NAME PATTERN IS NOT GOOD ENOUGH, AND WHY (2026-10-09).
 *
 * The pattern above was the guard, and on 2026-10-09 it was caught doing exactly what it was written
 * to prevent. These were in the generated migration as `text`, every one of them a figure on a
 * teacher's payslip:
 *
 *     OTEvening · OTHoliday        baht. `gross = base + dT + oi + ot + otCarry + otHol + hb`
 *     OTCarry                      baht, in that same sum
 *     OtherIncome                  baht  — 'income' is not in the pattern
 *     SocialSecurity               baht, DEDUCTED — 'security' is not in the pattern
 *     DiligenceAttendance/Facebook baht, ฿500 each — 'diligence' is not in the pattern
 *
 * The pattern cannot be extended its way out of this. The failure is structural: it asks what a
 * column is CALLED, and money is a question about what a column MEANS. The first version of this
 * tool missed fifteen columns, the pattern was added to fix that, and the pattern then missed seven
 * more of the same kind on the same sheet.
 *
 * So on the sheets that are made entirely of money, the DEFAULT IS INVERTED: every column must be
 * classified by name, money or not, and an unclassified one refuses the whole run. A new column on a
 * payslip cannot be typed by accident any more — somebody has to say which it is. That is more
 * typing and it is the correct amount of typing, because "เรื่องเงินเป็นเรื่องละเอียดและสำคัญมาก
 * ต่อความน่าเชื่อถือของ Application เรา" and a float on a payslip is how an application stops being
 * believed. */
const MONEY_SHEETS = new Set(['PAYROLL', 'PAYROLL_CONFIG', 'BILLING', 'OT_DAILY', 'OT_RECORDS',
  'PREPAYMENTS', 'STUDENT_CHARGES', 'PAY_ADJUSTMENTS', 'PAYMENT_SLIPS']);

/* ── WHICH COLUMN IDENTIFIES A ROW ────────────────────────────────────────────────────────────────
 *
 * 🔴 FOUND BY PHASE 2.3 (2026-10-13), AND IT WOULD HAVE DESTROYED THE SCHOOL'S HISTORY.
 *
 * This used to be guessed: "the first column ending in ID whose name starts like the sheet's".
 * A unique index is not a naming convention — it is an assertion that the school never has two of
 * something — and the guess asserted, in a live schema already applied to staging:
 *
 *     checkin_staff   (tenant_id, staff_id)     one clock-in per teacher. EVER.
 *     checkin_student (tenant_id, student_id)   one check-in per child. EVER.
 *     daily_journal   (tenant_id, student_id)   one journal entry per child. EVER.
 *     growth_records  (tenant_id, student_id)   one weight and height per child. EVER.
 *     audit_log       (tenant_id, user_id)      one PDPA audit line per person. EVER.
 *     student_terms   (tenant_id, student_id)   one summer term per child — which the engine
 *                                               explicitly allows two of, and a suite proves
 *     … 17 of the 48 were wrong, the same way.
 *
 * On migration day `pg_migrate.js` would have inserted the first journal for each child and been
 * refused every one after it. Four years of journals, every measurement, every check-in and the
 * whole audit log, gone — and the money report, which compares column totals, would have said
 * nothing, because it never looks at the rows that failed to arrive.
 *
 * So it is DECLARED, and every table must appear. `null` means "this table has no unique key", which
 * is the correct answer for anything keyed by a person AND a date. A new sheet forces a decision
 * rather than inheriting a guess — the same rule as MONEY above and DB_SUITES in test_all.js.
 */
const ROW_KEY_ = {
  // ── one row per generated id ────────────────────────────────────────────────────────────────
  STUDENTS: 'StudentID', PARENTS: 'ParentID', STAFF: 'StaffID', USERS: 'UserID', CLASSES: 'ClassID',
  /* 🔴 USER_LINKS has NO unique key, and declaring one on UserUID was wrong for the same reason the
   * guess it replaced was wrong — just by hand this time. A row is (LINE uid → child), so a parent
   * with two children at the school has two rows with the same uid, and three suites said so the
   * first time they ran against the real index. The lesson repeats: the key is a fact about the
   * school, and no amount of looking at the column name will tell you it. */
  USER_LINKS: null,
  BILLING: 'BillingID', PAYMENT_SLIPS: 'SlipID', PREPAYMENTS: 'PrepayID', STUDENT_CHARGES: 'ChargeID',
  WITHDRAWALS: 'WithdrawID', STUDENT_TERMS: 'TermID', INSURANCE_PCHI: 'InsuranceID',
  ANNOUNCEMENTS: 'AnnID', COMMENTS: 'CommentID', ADMIN_INBOX: 'InboxID', INJURY_REPORTS: 'InjuryID',
  DSPM_ASSESSMENT: 'AssessmentID', OT_DAILY: 'OTID', LEAVE_REQUEST_STD: 'LeaveID',
  ABSENCE_FOLLOWUP_LOG: 'LogID', ACTIVITY_LOG: 'LogID',
  FOOD_ITEMS: 'ItemID', FOOD_MENU: 'MenuID', CLASS_COVER: 'CoverID',
  SURVEYS: 'SurveyID', SURVEY_RESPONSES: 'ResponseID',   // NOT SurveyID — a survey has many answers
  LEAVE_REQUEST: 'LeaveID', OT_RECORDS: 'OTRecordID', PAYROLL: 'PayrollID',
  PAY_ADJUSTMENTS: 'AdjID', TRAINING: 'TrainingID',
  ATTENDANCE_REQUEST: 'ReqID', CLASS_CHANGE_REQ: 'ReqID',
  PAYROLL_CONFIG: 'StaffID',                              // one pay configuration per person

  // ── no unique key: these hold MANY rows for the same person ─────────────────────────────────
  CHECKIN_STAFF: null,        // one per staff per DAY
  CHECKIN_STUDENT: null,      // one per child per day, and in/out are separate rows
  WORK_SCHEDULE: null,        // one per staff per day of the week
  DAILY_JOURNAL: null,        // one per child per day, for years
  GROWTH_RECORDS: null,       // every measurement ever taken
  VACCINE_RECORDS: null,      // one per vaccine
  PICKUP_PERSONS: null,       // a child may have several authorised adults
  ABSENCE_LOG: null, ABSENCE_FOLLOWUP: null, HOLIDAY_ATTEND: null,
  LINE_RECIPIENTS: null,      // one per staff per TOPIC
  AUDIT_LOG: null, BACKUP_LOG: null, PERF_LOG: null,      // logs. The whole point is many rows.
  // ── reference / key-value sheets with no id column at all ───────────────────────────────────
  HOLIDAYS: null, DSPM_CRITERIA: null, SCHOOL_CONFIG: null, STAFF_GROUPS: null
};

/** Every table must have been thought about. A new sheet stops the generator instead of inheriting
 *  a guess — see the note above for what the guess cost. */
function assertRowKeysDeclared(tables) {
  const missing = tables.filter(t => !(t.sheet in ROW_KEY_)).map(t => t.sheet);
  const wrong = [];
  tables.forEach(t => {
    const k = ROW_KEY_[t.sheet];
    if (k && !(t.cols || []).includes(k)) wrong.push(t.sheet + '.' + k);
  });
  if (!missing.length && !wrong.length) return;
  if (missing.length) {
    console.error('\n❌ these sheets are not in ROW_KEY_:\n');
    missing.sort().forEach(s => console.error('     ' + s));
    console.error('\n   Name the column that identifies ONE row, or null if the sheet holds many');
    console.error('   rows per person (a journal, a check-in, a log). Do not guess from the name.\n');
  }
  if (wrong.length) {
    console.error('\n❌ ROW_KEY_ names a column that does not exist:\n');
    wrong.sort().forEach(s => console.error('     ' + s));
    console.error('');
  }
  process.exit(1);
}

function assertMoneyClassified(tables) {
  const unclassified = [], strict = [];
  tables.forEach(t => (t.cols || []).forEach(c => {
    if (MONEY.has(c) || NOT_MONEY.has(c) || NUMERIC_OTHER.has(c)) return;
    if (MONEY_SHEETS.has(t.sheet)) { strict.push(t.sheet + '.' + c); return; }
    if (MONEY_LIKE.test(c)) unclassified.push(t.sheet + '.' + c);
  }));
  if (!unclassified.length && !strict.length) return;
  console.error('\n❌ columns on a money sheet that are classified nowhere.');
  console.error('   Add each to MONEY (numeric) or NOT_MONEY (it is not an amount):\n');
  if (strict.length) {
    console.error('   on a MONEY_SHEET — every column must be classified, pattern or no pattern:');
    strict.sort().forEach(c => console.error('     ' + c));
  }
  if (unclassified.length) {
    console.error('\n   elsewhere — these match the money name pattern:');
    unclassified.sort().forEach(c => console.error('     ' + c));
  }
  console.error('\n   Refusing to generate a schema that guesses at money.\n');
  process.exit(1);
}

/* 🔴 THE PREFIX MUST END ON A WORD BOUNDARY (Phase 2.3, 2026-10-13).
 *
 * Without the lookahead, `Can` matches **Can**celledBy and **Can**celNote — so OT_DAILY's two
 * cancellation columns were generated as `boolean`. CancelledBy holds 'AUTO_TIME' or an admin's
 * name and CancelNote holds a sentence in Thai explaining why a family was not charged; both would
 * have become NULL on migration day, which is the answer to "why was this OT charge cancelled"
 * for every OT charge ever cancelled.
 *
 * `(?=[A-Z]|$)` says the prefix is a whole word in CamelCase: CanClassOrg still matches, Cancel…
 * no longer does. Third time in two days that a name pattern has answered a question about meaning
 * and got it wrong — see MONEY_SHEETS and ROW_KEY_ for the other two. */
const BOOL_PREFIX = /^(Is|Has|Can|Require|Notify|Allow|Enabled?|Active|Read|Locked?|Verified?|Anonymous|Popup|GeoExempt|MustChange)(?=[A-Z]|$)/;
/* `From`/`To` are STUDENT_TERMS' first and last day — real dates, typed `text` until Phase 2.3
 * because the pattern looks for a suffix and these have none. The same shape of miss as the money
 * columns in Phase 2.2: a name-based guard cannot see a column that does not follow the naming. */
const DATE_EXACT = /(Date|DOB|Expiry|Birthday)$|^(From|To)$/;
const TIME_EXACT = /(Time|CheckIn|CheckOut|In|Out)$/;
const STAMP_EXACT = /(At|Timestamp|Ts)$/;

function sqlType(col) {
  if (MONEY.has(col)) return 'numeric(12,2)';
  if (NUMERIC_OTHER.has(col)) return 'numeric';
  if (/^(Month)$/.test(col)) return 'text';                 // 'YYYY-MM', a period not a date
  if (STAMP_EXACT.test(col) && col !== 'SubmittedAt') return 'timestamptz';
  if (col === 'SubmittedAt' || col === 'UpdatedAt' || col === 'ByAt') return 'timestamptz';
  if (DATE_EXACT.test(col)) return 'date';
  if (TIME_EXACT.test(col) && !/ID$/.test(col)) return 'time';
  if (BOOL_PREFIX.test(col)) return 'boolean';
  return 'text';
}
const snake = s => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase();

/* ── SQL KEYWORDS ────────────────────────────────────────────────────────────────────────────────
 *
 * 🔴 STUDENT_TERMS declares `From` and `To`, which snake down to `from` and `to`. Both are RESERVED
 * in Postgres, so `create table student_terms (… from text, to text …)` is a syntax error and the
 * statement never ran — which is why the table was missing from staging while sitting in the
 * generated file, and why Phase 2.3's first run against the summer-term suites failed with
 * `relation "student_terms" does not exist`.
 *
 * The header of this file already records that migration 001 "had never been runnable at all" once
 * before, for a different reason. That guard was written for the four columns it knew about; this
 * is the general case, so every identifier is quoted and the class of fault closes. Quoting a plain
 * lower-case name changes nothing about it, so this is free everywhere else.
 *
 * ANYTHING THAT WRITES SQL FROM THESE NAMES MUST DO THE SAME — see q() in tools/pg_engine.js. */
const q = name => '"' + String(name).replace(/"/g, '""') + '"';

// ---------------------------------------------------------------------------------------------
// 4. output
// ---------------------------------------------------------------------------------------------
const inv = inventory();
const withCols = inv.filter(t => t.cols && t.cols.length);
assertMoneyClassified(withCols);   // refuse to go further if any amount is unclassified
assertNoTableCollision(withCols);  // ...or if two sheets would quietly become one table
assertRowKeysDeclared(withCols);   // ...or if a unique index would be guessed from a column name

if (process.argv.includes('--sql') || process.argv.includes('--write')) {
  const L = [];
  L.push('-- Atom Nursery → PostgreSQL, migration 001 (generated: node tools/schema_inventory.js --sql)');
  L.push('-- DO NOT EDIT BY HAND. Change the source declarations and re-generate, or the schema and');
  L.push('-- the app drift apart silently — which is the failure this whole file exists to prevent.');
  L.push('--');
  L.push('-- THREE DECISIONS ARE BAKED IN HERE, all taken before a line of it was written:');
  L.push('--   1. tenant_id on EVERY table, from migration 001. Adding it later means rewriting every');
  L.push('--      row, every index and every policy in a live database. It costs nothing now.');
  L.push('--   2. numeric for money, never float. Sheets stores every number as a float64, so the');
  L.push('--      prepay discounts, the OT, the provident fund and the payroll all run on binary');
  L.push('--      fractions today. This is the migration that ends that, and it only ends if the');
  L.push('--      column type says so.');
  L.push('--   3. the sheet id (STD-001, STF-011) is KEPT as `code`, not thrown away. Four years of');
  L.push('--      LINE messages, slips and audit rows refer to those strings; a uuid primary key with');
  L.push('--      no code column would orphan all of it.');
  L.push('');
  L.push('create extension if not exists "pgcrypto";');
  L.push('');
  L.push('-- ── tenancy ───────────────────────────────────────────────────────────────────────────');
  L.push('create table if not exists tenant (');
  L.push('  id          uuid primary key default gen_random_uuid(),');
  L.push('  code        text not null unique,      -- "atom" — short, used in URLs and support');
  L.push('  name_th     text not null,');
  L.push('  name_en     text,');
  L.push('  status      text not null default \'ACTIVE\',');
  L.push('  created_at  timestamptz not null default now()');
  L.push(');');
  L.push('');
  /* 🔴 ตารางนี้เคยเป็นตารางเดียวที่ RLS ปิดอยู่ — และนั่นคือรูจริง (พบ 2026-10-23)
   *
   * มันถูกกันออกจากลูปข้างล่างอย่างถูกต้อง เพราะมันไม่มีคอลัมน์ `tenant_id` (แถวของมัน *คือ*
   * tenant) แต่ "ไม่มีนโยบาย tenant_isolation" ไม่ได้แปลว่า "ไม่ต้องมี RLS" — และสองอย่างนี้ถูก
   * สับสนกันจนตารางนี้เปิดโล่ง
   *
   * ยิงทดสอบด้วยบทบาท `anon` จริง (ซึ่งคือสิ่งที่ anon key ในแอปใช้ และ anon key เป็นของสาธารณะ
   * เพราะมันถูกส่งไปกับหน้าเว็บ) ผลคือ **อ่านได้ · เพิ่มได้ · แก้ได้ · และลบได้ทุกแถว**
   * แปลว่าใครก็ตามที่เปิด DevTools ดู key ก็ลบทะเบียนโรงเรียนทั้งหมดได้
   *
   * 🔴 มีแค่นโยบาย SELECT ตัวเดียว และตั้งใจให้เป็นแบบนั้น
   * เมื่อ RLS เปิดแล้ว คำสั่งที่ **ไม่มี** นโยบายรองรับ จะถูกปฏิเสธทั้งหมด → insert/update/delete
   * จึงทำไม่ได้เลยจากฝั่ง client · การสร้างโรงเรียนใหม่เป็นงานของเซิร์ฟเวอร์ด้วย service_role
   * ซึ่งข้าม RLS โดยการออกแบบอยู่แล้ว ไม่ใช่สิ่งที่หน้าเว็บควรทำได้ */
  L.push('alter table tenant enable row level security;');
  L.push('drop policy if exists tenant_self_read on tenant;');
  L.push('-- อ่านได้เฉพาะแถวของโรงเรียนตัวเอง · ไม่มีนโยบาย insert/update/delete = ทำไม่ได้เลย');
  L.push('create policy tenant_self_read on tenant');
  L.push('  for select using (id = (auth.jwt() ->> \'tenant_id\')::uuid);');
  L.push('');

  withCols.forEach(t => {
    const tbl = tableName(t);
    L.push(`-- ── ${t.sheet}  (${t.wb} workbook${t.collection ? ', engine: ' + t.collection : ''})${t.note ? ' — ' + t.note : ''}`);
    L.push(`create table if not exists ${tbl} (`);
    L.push('  id          uuid primary key default gen_random_uuid(),');
    /* 🔴 THE ROW'S PLACE IN THE SHEET, KEPT.
     *
     * A spreadsheet has an order and the app shows it: lists appear in the order rows were added,
     * and the engine takes `[0]` of a filtered list in forty-two places. Order by a uuid primary key
     * and that order is random — on the first run of tools/test_pg_engine.js, listStudents came back
     * with the second child first and two handler comparisons failed for no other reason.
     *
     * A bigserial is one column and it is exact. Added 2026-10-09, while the database was still
     * empty: doing this later means rewriting every row in every table of a live system. */
    L.push('  seq         bigserial not null,');
    L.push('  tenant_id   uuid not null references tenant(id) on delete restrict,');
    /* 🔴 A COLUMN MAY ONLY BE DECLARED ONCE, and until 2026-10-09 three tables broke that rule —
     * which means migration 001 had never been runnable at all. Postgres rejects the whole
     * `create table`, so Phase 2 would have stopped on its first command.
     *
     * TWO SEPARATE CAUSES, and both are the generator's to absorb:
     *
     *   1. RESERVED NAMES. Every table gets id / tenant_id / created_at / updated_at from here.
     *      DAILY_JOURNAL has an `UpdatedAt` column and INJURY_REPORTS and PAY_ADJUSTMENTS have
     *      `CreatedAt` — all of which snake down onto those. Only `id` was being guarded.
     *      The sheet's value is the one that matters (when the thing was RECORDED, not when the row
     *      was inserted), and it lands in the reserved column during migration — same name, same
     *      type, and `default now()` is then exactly right for rows created afterwards.
     *
     *   2. A NAME DECLARED TWICE IN THE SHEET ITSELF. STAFF lists the six Pause* columns in two
     *      places in SCHEMA. Harmless to ensureColumns_, fatal here. Deduplicated rather than
     *      reported, because the declaration is correct for the purpose it was written for.
     */
    const RESERVED = new Set(['id', 'seq', 'tenant_id', 'created_at', 'updated_at']);
    const emitted = new Set();
    const absorbed = [];
    t.cols.forEach(c => {
      const name = snake(c);
      if (RESERVED.has(name)) { absorbed.push(c); return; }   // provided below, once
      if (emitted.has(name)) return;                          // the sheet named it twice
      emitted.add(name);
      L.push(`  ${q(name).padEnd(28)} ${sqlType(c)},`);
    });
    if (absorbed.length) {
      L.push(`  -- ${absorbed.join(', ')}: the sheet's own column${absorbed.length > 1 ? 's' : ''}, carried by the`);
      L.push('  -- reserved column of the same name below — same meaning, and never declared twice.');
    }
    L.push('  created_at  timestamptz not null default now(),');
    L.push('  updated_at  timestamptz not null default now()');
    L.push(');');
    /* The sheet's own id column becomes a per-tenant unique code — DECLARED, never guessed. See
     * ROW_KEY_ for what the guess asserted about the school's journals and attendance. A null there
     * means this table genuinely holds many rows per person and gets no unique index at all. */
    const idCol = ROW_KEY_[t.sheet] || null;
    if (idCol) L.push(`create unique index if not exists ${tbl}_code_uq on ${tbl}(tenant_id, ${q(snake(idCol))});`);
    L.push(`create index if not exists ${tbl}_tenant_ix on ${tbl}(tenant_id);`);
    // every read is scoped to one school AND ordered by sheet position, so one index serves both
    L.push(`create index if not exists ${tbl}_seq_ix on ${tbl}(tenant_id, seq);`);
    L.push(`alter table ${tbl} enable row level security;`);
    L.push('');
  });

  L.push('-- ── row-level security ────────────────────────────────────────────────────────────────');
  L.push('-- One policy per table, all identical, all reading the SAME claim. A per-table exception is');
  L.push('-- how one table ends up readable across tenants, so there are none.');
  L.push('-- The app connects with the anon key plus a JWT we mint; the service-role key bypasses ALL');
  L.push('-- of this by design and must never leave the server.');
  /* 🔴 RE-RUNNABLE. Until Phase 2.3 this block said `create policy` only, so the SECOND time the
   * file was applied it raised "policy already exists" on the first table and stopped — leaving
   * every table after it unpoliced. That is what happened to `student_terms`: it was added, RLS was
   * enabled on it, and the policy never arrived, which in Postgres means the table denies everyone.
   * A migration file that cannot be applied twice is a migration file that silently half-applies. */
  L.push('do $$ declare t text; begin');
  L.push('  for t in select tablename from pg_tables where schemaname = \'public\' and tablename <> \'tenant\' loop');
  L.push('    execute format($f$drop policy if exists tenant_isolation on %I$f$, t);');
  L.push('    execute format($f$');
  L.push('      create policy tenant_isolation on %I');
  L.push('        using (tenant_id = (auth.jwt() ->> \'tenant_id\')::uuid)');
  L.push('        with check (tenant_id = (auth.jwt() ->> \'tenant_id\')::uuid);');
  L.push('    $f$, t);');
  L.push('  end loop;');
  L.push('end $$;');
  L.push('');

  /* 🔴 --write AND --sql MUST PRODUCE THE SAME BYTES (2026-10-09).
   * console.log adds a trailing newline and writeFileSync does not, so the two modes of the same
   * generator differed by exactly one byte — and test_schema_inventory compares the committed file
   * against the `--sql` form. The result: `--write` produced a file the staleness check called
   * STALE, with no visible difference to read in the diff. One '\n', and the only way to get an
   * answer was to compare them by hand. The newline is now part of the document either way. */
  const sql = L.join('\n') + '\n';
  if (process.argv.includes('--write')) {
    const dir = path.join(ROOT, 'docs', 'schema');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '001_init.sql'), sql, 'utf8');
    console.log('docs/schema/001_init.sql written —', withCols.length, 'tables,',
      withCols.reduce((a, t) => a + t.cols.length, 0), 'columns');
  } else {
    process.stdout.write(sql);          // NOT console.log — that would re-add the newline above
  }
} else {
  const money = [];
  withCols.forEach(t => t.cols.forEach(c => { if (MONEY.has(c)) money.push(t.sheet + '.' + c); }));
  console.log('TABLES:', withCols.length, ' COLUMNS:', withCols.reduce((a, t) => a + t.cols.length, 0));
  console.log('MONEY COLUMNS (numeric, never float):', money.length);
  console.log('');
  console.log('sheet'.padEnd(26) + 'wb'.padEnd(6) + 'cols'.padEnd(6) + 'engine collection');
  console.log('-'.repeat(78));
  withCols.forEach(t => console.log(
    t.sheet.padEnd(26) + t.wb.padEnd(6) + String(t.cols.length).padEnd(6) + (t.collection || '—')));
  const orphan = inv.filter(t => !t.cols || !t.cols.length);
  if (orphan.length) { console.log('\n⚠️  mapped but no columns found:'); orphan.forEach(t => console.log('   ', t.sheet)); }
}
