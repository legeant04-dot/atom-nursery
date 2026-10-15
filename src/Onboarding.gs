/**
 * src/Onboarding.gs — PHASE 4.1: BRINGING UP A SECOND SCHOOL IN AN HOUR.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 THE FINDING THAT MADE THIS FILE WORTH WRITING
 *
 * `setupAll` already creates all 46 sheets and seeds all 80 SCHOOL_CONFIG keys, so "onboarding a
 * school" looked like a solved problem. It is not, and the reason is not missing code — it is that
 * the seed in Config.gs IS ATOM NURSERY. A second school brought up from it would start life with:
 *
 *   SlipOK_Url / SlipOK_ApiKey   🔴 Atom Nursery's SlipOK ACCOUNT. Every parent's transfer at the
 *                                new school would be verified against Atom's branch, spending
 *                                Atom's quota — and Atom's API key would be sitting in a sheet
 *                                owned by a different company. Neither school would see anything
 *                                wrong until the quota ran out.
 *   GPS_Lat / GPS_Lng            🔴 Atom's car park. Nobody at the new school can check in, and
 *                                anyone standing at Atom's gate can.
 *   SchoolName · Links_* · LineOAId · InsuranceCompanyName
 *                                Atom's name and Atom's LINE account, shown to the new school's
 *                                own parents.
 *
 * None of that is hypothetical: those are the literal values in SCHOOL_CONFIG_DEFAULTS today. The
 * seeds for them are now BLANK (safe for the live school — `setupAll` only ADDS missing keys and
 * never overwrites, and every one of these already has a row on live, verified 2026-10-15 against
 * the real export). A new school therefore starts with nothing rather than with someone else's
 * account, and the check below says exactly what is still missing.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 WHY A CHECK AND NOT A CHECKLIST
 *
 * A written checklist is a hand-kept list, and this project has now been bitten four times by one
 * of those (the guessed row key, the money-column guesses, the shadow route list, the export's own
 * table list). A human ticking "GPS set ✓" is asserting a thing nobody verified. This asks the
 * SYSTEM: is the row there, is it still a placeholder, is it still Atom's value.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * AND THE HOUR IS MOSTLY NOT CODE. See docs/ONBOARDING.md — the steps that need a human in a
 * browser (LINE OA, LIFF, SlipOK, the school's Google account) are the long pole, and no amount of
 * scripting removes them. What this file does is make sure none of them is silently skipped.
 */

/* ── EVERY SEEDED KEY, CLASSIFIED. A key with no entry here fails tools/test_onboarding.js ──────
 *
 * DECLARED, not pattern-matched, for the reason written at the top of src/Portability.gs: a name
 * pattern cannot answer a question about meaning. `BankName` and `SchoolName` both end in "Name"
 * and one of them is a per-school identity and the other is a payroll default.
 *
 *   BLOCKER   🔴 the new school is BROKEN or is using someone else's account until this is set.
 *   REQUIRED     must be set before go-live, but a blank one fails visibly rather than silently.
 *   CONFIRM      has a sane default that is a BUSINESS DECISION — the school must say yes to it.
 *                (Inheriting Atom's ฿100/hr OT rate is not dangerous. It is just wrong.)
 *   UNIVERSAL    the same for every school. Nobody needs to look at it.
 */
var ONBOARD_SCOPE_ = {
  /* 🔴 BLOCKERS — wrong or missing here and the school does not work, or works on Atom's account */
  GPS_Lat:                'BLOCKER',   // check-in fence — blank refuses everyone, which is the safe direction
  GPS_Lng:                'BLOCKER',
  SlipOK_Url:             'BLOCKER',   // the school's OWN SlipOK branch
  SlipOK_ApiKey:          'BLOCKER',   // ...and its own key. Never shared, never inherited.
  LiffID:                 'BLOCKER',   // no LIFF = nobody can sign in at all
  LineChannelAccessToken: 'BLOCKER',   // no token = no LINE message ever leaves
  LineChannelSecret:      'BLOCKER',
  SchoolName:             'BLOCKER',   // appears on every slip, certificate and notification
  /* 🔴 GoogleClientId IS A BLOCKER THAT CANNOT BE SEEDED BLANK YET — and that is itself the finding.
   * Atom's live SCHOOL_CONFIG has NO GoogleClientId row (verified 2026-10-15 against the real
   * export): sign-in-with-Google runs entirely off the value hard-coded in SCHOOL_CONFIG_DEFAULTS,
   * through googleClientIdDefault_ in Auth.gs. Blanking the seed would switch Google login off for
   * the school that is live today.
   * So the value stays, and the check below reports it as inherited-from-code rather than
   * configured — which is the honest state, and names the one action that fixes it: write Atom's
   * client id into Atom's own SCHOOL_CONFIG row, then the seed can go blank. */
  GoogleClientId:         'BLOCKER',

  /* REQUIRED — needed before parents are let in, but their absence is visible */
  PromptPayID:            'REQUIRED',
  QRCode:                 'REQUIRED',
  QRCode_Monthly:         'REQUIRED',
  QRCode_OT:              'REQUIRED',
  AdminLineUID:           'REQUIRED',
  Links_LINE:             'REQUIRED',
  LineOAId:               'REQUIRED',
  InsuranceCompanyName:   'REQUIRED',
  DspmManualFileId:       'REQUIRED',

  /* CONFIRM — a default that is a business decision. Safe to inherit, usually wrong to. */
  Plans:                  'CONFIRM',   // 🔴 the price list. Inheriting another school's is a money bug.
  PrepayTiers:            'CONFIRM',
  OTRatePerHour:          'CONFIRM',  StaffOTHourlyRate:     'CONFIRM',
  OTRate:                 'CONFIRM',  OTEveningRate:         'CONFIRM',
  OTGraceMinutes:         'CONFIRM',
  DiligenceAttendanceAmount: 'CONFIRM', DiligenceFacebookAmount: 'CONFIRM',
  ExtraChildThreshold:    'CONFIRM',  ExtraChildRate:        'CONFIRM',
  TrainingCertRate:       'CONFIRM',  TrainingCertMaxPerMonth: 'CONFIRM',
  SocialSecurityRate:     'CONFIRM',  SocialSecurityMax:     'CONFIRM',
  ContributionMatchRate:  'CONFIRM',
  BankName:               'CONFIRM',
  Departments:            'CONFIRM',  // the school's own class names
  PositionLevels:         'CONFIRM',
  DefaultCheckInTime:     'CONFIRM',  DefaultCheckOutTime:   'CONFIRM',
  WithdrawReasons:        'CONFIRM',
  GrowthUpdateMonths:     'CONFIRM',
  /* 🔴 HolidayList is UNIVERSAL, not CONFIRM — it was noise on the first live run. Holidays are
   * entered through the HOLIDAYS SHEET (จัดการ › วันหยุด), and isSchoolClosed_ reads "the config
   * list OR the sheet". Atom has 19 holidays on file and a blank config key, which is the normal,
   * correct state — so asking an admin to confirm an empty setting they are right to leave empty is
   * exactly the kind of line that teaches people to skim the report. */
  HolidayList:            'UNIVERSAL',
  ParentPrepayEnabled:    'CONFIRM',
  SchoolSlogan:           'CONFIRM',
  Links_Facebook:         'CONFIRM',  Links_Website:         'CONFIRM',
  InsurancePolicyNo:      'CONFIRM',
  /* folder names carry the school's own name. Not dangerous — they are created inside the school's
   * OWN Drive — but a folder called "AtomNursery_Slips" in another company's Drive is the kind of
   * detail that tells a customer they were not thought about. */
  SlipsFolderName:        'CONFIRM',  StudentFolderRoot:     'CONFIRM',
  BackupFolderName:       'CONFIRM',  RegisterPhotoFolderName: 'CONFIRM',
  LineLoginChannelId:     'CONFIRM',  LineLoginChannelSecret: 'CONFIRM',  // browser sign-in — optional
  Radius:                 'CONFIRM',  // 🔴 Atom's is 30m and FIXED by the school's decision; a new
                                      // site may need another. Never changed without being asked.

  /* UNIVERSAL — identical everywhere */
  Timezone: 'UNIVERSAL', GpsAccuracySlack: 'UNIVERSAL', LateGraceMinutes: 'UNIVERSAL',
  EarlyLeaveMinutes: 'UNIVERSAL', HolidayReopenWindowMinutes: 'UNIVERSAL',
  ForgotCheckInNotify: 'UNIVERSAL', ForgotCheckOutNotify: 'UNIVERSAL',
  CacheTTL: 'UNIVERSAL', BackupRetentionDays: 'UNIVERSAL', SchemaVersion: 'UNIVERSAL',
  SeedMockKey: 'UNIVERSAL',
  /* the 15 notification switches: unset means OFF, which is the right starting state for a school
   * whose parents have not been told anything yet. Deliberately not REQUIRED — a new school that
   * sends nothing is calm; one that sends everything on day one is a support ticket. */
  NotifyParentCheckin: 'UNIVERSAL', NotifyParentJournal: 'UNIVERSAL',
  NotifyParentJournalReply: 'UNIVERSAL', NotifyParentDspm: 'UNIVERSAL',
  NotifyParentLeave: 'UNIVERSAL', NotifyParentOt: 'UNIVERSAL', NotifyParentBill: 'UNIVERSAL',
  NotifyStaffArrival: 'UNIVERSAL', NotifyStaffLeave: 'UNIVERSAL', NotifyStaffComment: 'UNIVERSAL',
  NotifyStaffApproval: 'UNIVERSAL', NotifyStaffApprovalQueue: 'UNIVERSAL',
  NotifyStaffPunch: 'UNIVERSAL', NotifyStaffOrg: 'UNIVERSAL', NotifyAdminApproval: 'UNIVERSAL'
};

/**
 * 🔴 VALUES THAT BELONG TO ATOM NURSERY AND MUST NEVER APPEAR IN ANOTHER SCHOOL'S CONFIG.
 *
 * The seed no longer contains them, but a school can also be brought up by COPYING an existing
 * workbook, which is the fastest way to do it and therefore the way it will actually be done. A
 * copy carries everything. This is the net under that.
 *
 * Matched as whole values, and only for the key they belong to — so a new school legitimately
 * called "Atom Nursery 2" is not accused of anything.
 */
/**
 * 🔴 WHOSE VALUES THOSE ARE — AND WHY THE FIRST RUN ON THE REAL SCHOOL CRIED WOLF (2026-10-15).
 *
 * The check below was written for the copy-the-workbook case and ran straight into the obvious
 * thing: **Atom Nursery is itself a school using this app.** Its `LineOAId` IS `@atomnursery` and
 * that is correct, not inherited — but the first live run flagged `Links_LINE`, `LineOAId` and
 * `Links_Facebook` in red and told the school to change its own LINE account.
 *
 * Three false alarms out of four findings, and the real one (GoogleClientId) was sitting among
 * them. That is precisely the failure the speed report taught: **a report that cries wolf stops
 * being read**, and the next time it is right nobody looks.
 *
 * So the net only applies to a school that is NOT the one those values belong to. A workbook copied
 * from Atom and renamed still trips it — which is the case it was built for — and Atom itself is
 * left alone.
 */
var ONBOARD_ORIGIN_SCHOOL_ = 'Atom Nursery';

var ONBOARD_ATOM_VALUES_ = {
  GPS_Lat: '13.792472', GPS_Lng: '100.646389',
  SlipOK_ApiKey: 'SLIPOKKR8B249',
  SlipOK_Url: 'https://api.slipok.com/api/line/apikey/69307',
  LineOAId: '@atomnursery',
  Links_LINE: 'https://line.me/R/ti/p/@atomnursery',
  Links_Facebook: 'https://www.facebook.com/AtomNursery1',
  GoogleClientId: '120486339414-6auhdq0a1fur2ihu24rr8po58vgci3s1.apps.googleusercontent.com'
};

/** Is this cell still the seed's own "please fill me in" text? */
function onboardIsPlaceholder_(v) { return /^<FILL\b/i.test(String(v || '').trim()); }

/**
 * WHAT IS STILL MISSING BEFORE THIS SCHOOL CAN OPEN.
 *
 * Read-only, admin-only. Reports STATUS, never a value — the same rule as the export checker: a
 * readiness report that quotes the API key has published it to whoever is looking at the screen.
 */
function handleOnboardingCheck(p) {
  p = p || {};
  var sh = getMainSpreadsheet_().getSheetByName('SCHOOL_CONFIG');
  var have = {}, rowOf = {};
  if (sh) {
    var last = sh.getLastRow();
    if (last > 1) {
      var vals = sh.getRange(2, 1, last - 1, 2).getValues();
      for (var i = 0; i < vals.length; i++) {
        var k = String(vals[i][0] || '').trim(); if (!k) continue;
        have[k] = true; rowOf[k] = String(vals[i][1] == null ? '' : vals[i][1]).trim();
      }
    }
  }

  // see ONBOARD_ORIGIN_SCHOOL_ — Atom's own values are not an inheritance when the school IS Atom
  var isOrigin = String(rowOf.SchoolName || '').trim() === ONBOARD_ORIGIN_SCHOOL_;

  var out = { BLOCKER: [], REQUIRED: [], CONFIRM: [] }, okCount = 0;
  Object.keys(ONBOARD_SCOPE_).forEach(function (key) {
    var scope = ONBOARD_SCOPE_[key];
    if (scope === 'UNIVERSAL') return;
    var present = !!have[key], val = rowOf[key] || '';
    var why = '';
    if (!present) {
      /* 🔴 NO ROW AT ALL IS NOT THE SAME AS AN EMPTY ROW, and this is the distinction that found the
       * GoogleClientId problem. A missing row falls through to whatever the CODE says, so the school
       * is running on a value it never chose and cannot see. An empty row is a decision. */
      why = 'ไม่มีแถวนี้ในชีต — ระบบจะใช้ค่าที่ฝังอยู่ในโค้ดแทน ซึ่งโรงเรียนไม่ได้เป็นคนตั้ง';
    } else if (!val) {
      why = 'ยังว่าง';
    } else if (onboardIsPlaceholder_(val)) {
      why = 'ยังเป็นข้อความตัวอย่าง (<FILL …>) ไม่ใช่ค่าจริง';
    } else if (!isOrigin && ONBOARD_ATOM_VALUES_[key] && val === ONBOARD_ATOM_VALUES_[key]) {
      why = '🔴 ยังเป็นค่าของ Atom Nursery — ต้องเปลี่ยนเป็นของโรงเรียนนี้';
    } else { okCount++; return; }
    out[scope].push({ key: key, why: why });
  });

  var ready = out.BLOCKER.length === 0;
  return {
    ready: ready,
    school: rowOf.SchoolName || '',
    checked: Object.keys(ONBOARD_SCOPE_).length,
    ok: okCount,
    blockers: out.BLOCKER, required: out.REQUIRED, confirm: out.CONFIRM,
    /* The structural things setupAll cannot decide for anybody: a school with no classes and no
     * price list is not ready however complete its config is. Counted, never listed — the names are
     * the school's own data. */
    counts: {
      /* 🔴 DEPARTMENTS FIRST, because that is what the app actually organises by. The first live run
       * reported "ชั้นเรียน 2" for a school that plainly has more than two — the CLASSES sheet is
       * largely vestigial (Line.gs and one parent lookup read it), while the class list every screen
       * uses is the Departments config. Reporting only the sheet made a healthy school look
       * half-configured, which is the same cry-wolf problem as the LINE flags above. */
      departments: onboardDeptCount_(),
      classes: onboardCount_(getMainSpreadsheet_(), 'CLASSES'),
      staff: onboardCount_(getHrSpreadsheet_(), 'STAFF'),
      students: onboardCount_(getMainSpreadsheet_(), 'STUDENTS'),
      staffGroups: onboardCount_(getHrSpreadsheet_(), 'STAFF_GROUPS'),
      plans: onboardPlanCount_(),
      // ...and the holidays that HolidayList above deliberately no longer asks about
      holidays: onboardCount_(getMainSpreadsheet_(), 'HOLIDAYS')
    }
  };
}

function onboardCount_(ss, name) {
  try { var sh = ss.getSheetByName(name); return sh ? Math.max(0, sh.getLastRow() - 1) : 0; }
  catch (e) { return 0; }
}
/**
 * ADD THE SCHOOL_CONFIG ROWS THAT ARE MISSING — and nothing else.
 *
 * 🔴 WHY THIS EXISTS. The first live run of the check found `GoogleClientId` with NO ROW AT ALL:
 * sign-in-with-Google has been running off the value baked into SCHOOL_CONFIG_DEFAULTS, through
 * googleClientIdDefault_ in Auth.gs. The school is using a setting it never made and cannot see, and
 * the seed cannot be blanked for the next school until that row exists.
 *
 * `setupAll()` already does this, but it also creates sheets and columns, and "run the whole setup
 * on the live school" is a much larger sentence than the problem deserves. This does the one thing.
 *
 * 🔴 PREVIEW FIRST, LIKE EVERY OTHER ADMIN TOOL HERE. Nothing is written until preview:false, and
 * it only ever APPENDS a key that has no row — an existing row, blank included, is a decision
 * somebody made and is never touched. That is the same rule setupAll follows, and it is the reason
 * blanking the seed was safe in the first place.
 */
function handleBackfillConfig(p) {
  p = p || {};
  var preview = p.preview !== false;
  var sh = getMainSpreadsheet_().getSheetByName('SCHOOL_CONFIG');
  if (!sh) throw apiError_('NOT_FOUND', 'ไม่พบชีต SCHOOL_CONFIG');
  var have = {}, last = sh.getLastRow();
  if (last > 1) {
    var keys = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) have[String(keys[i][0] || '').trim()] = true;
  }
  var toAdd = SCHOOL_CONFIG_DEFAULTS.filter(function (r) { return !have[r[0]]; });
  // the KEYS are reported, never the values — a settings screen must not print a credential
  var names = toAdd.map(function (r) { return r[0]; });
  if (preview) return { preview: true, wouldAdd: names, count: names.length };
  if (toAdd.length) {
    sh.getRange(sh.getLastRow() + 1, 1, toAdd.length, 2).setValues(toAdd);
    try { CacheService.getScriptCache().removeAll(['cfg']); } catch (e) {}
    _configCache = null;
    try { logAudit(p.adminId || 'admin', 'CONFIG_BACKFILL', 'SCHOOL_CONFIG', names.join(',')); } catch (e) {}
  }
  return { preview: false, added: names, count: names.length };
}

/** The class/department list the app organises by (SCHOOL_CONFIG Departments, a comma list). */
function onboardDeptCount_() {
  try {
    return String(getConfig_('Departments', '') || '').split(',')
      .map(function (s) { return s.trim(); }).filter(Boolean).length;
  } catch (e) { return 0; }
}
function onboardPlanCount_() {
  try { var v = JSON.parse(getConfig_('Plans', '[]')); return Array.isArray(v) ? v.length : 0; }
  catch (e) { return 0; }
}
