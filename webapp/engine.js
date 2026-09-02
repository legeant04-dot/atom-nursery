/* engine.js — SHARED API logic (browser + Google Apps Script). ONE source of truth for all handlers.
 * createAtomAPI(M, GROWTH_STD) -> { H, ageMonths }.  M = data object (mock arrays in the browser;
 * hydrated-from-Sheets on GAS). Handlers in H read/mutate M.* and return plain data — no DOM/window.
 * Browser loads this via <script>; GAS uses the generated copy src/Engine.gs (run tools/build_engine.js).
 */
/* ============================================================================================
 * WHAT HOURS DOES THIS PERSON WORK, ON THIS DAY — one answer, for everything that asks.
 *
 * Five places used to work this out for themselves: the check-in (lateness), the check-out (OT), the
 * recompute tool, the approval of a back-dated attendance request, and the teacher's own history
 * card. Big Cleaning was already special-cased in some of them and not others.
 *
 * Then a HALF-DAY HOLIDAY made the disagreement expensive. "07:00–12:00" shuts the school until
 * noon; a teacher who arrives the moment it reopens was recorded 241 minutes late — and
 * attendanceEligible_ drops the whole month's เบี้ยขยัน (฿500) on a single late minute. Nobody was
 * late. The school was shut.
 *
 * The rule the school gave (2026-08-18):
 *   - start work at the END of the holiday window, when that window covers their normal start
 *   - finish at their OWN normal time, and OT still runs from that same time
 *   - a window that swallows the whole shift is a day off — not a late mark, not an absence
 *
 * Two more decisions, because a rule that is right on paper and unusable in the doorway is not
 * right: clocking in opens WINDOW minutes before the school does, and the same WINDOW minutes are
 * forgiven after it. Otherwise a teacher standing at the gate at 11:58 has to wait, tap at 12:01,
 * and lose ฿500 to the loading spinner.
 *
 * This function is PURE — times in, times out, no sheets, no M. That is what lets the Apps Script
 * routes (Checkin.gs, AttReq.gs) and the engine handlers share it instead of keeping five opinions.
 * It lives at the top level of engine.js so the generated Engine.gs makes it a GAS global.
 *
 *   o.checkIn/checkOut   the person's normal shift (from WORK_SCHEDULE, their group, or the default)
 *   o.bigCleaning        + bigCleanIn/bigCleanOut — that day's own hours replace the shift entirely
 *   o.holStart/holEnd    the holiday window on this date; BOTH blank = a whole-day holiday, which is
 *                        not this function's business (nobody works, so nobody is late)
 *   o.grace              the school's normal lateness grace (LateGraceMinutes)
 *   o.window             minutes either side of a reopening (HolidayReopenWindowMinutes, default 15)
 *
 * -> { checkIn, checkOut, grace, dayOff, reopened, openFrom, holEnd }
 * ========================================================================================== */
function atomStaffHours_(o) {
  o = o || {};
  var hhmm = function (v) { var s = String(v == null ? '' : v).trim();
    var m = /^(\d{1,2}):(\d{2})/.exec(s); return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : ''; };
  var toMin = function (v) { var t = hhmm(v); if (!t) return null;
    return parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10); };
  var addMin = function (v, n) { var m = toMin(v); if (m == null) return '';
    m = Math.max(0, Math.min(24 * 60 - 1, m + n));
    return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); };

  var inT  = hhmm(o.bigCleaning ? (o.bigCleanIn  || o.checkIn)  : o.checkIn)  || '08:00';
  var outT = hhmm(o.bigCleaning ? (o.bigCleanOut || o.checkOut) : o.checkOut) || '17:00';
  var grace = Math.max(0, Number(o.grace) || 0);
  var win = (o.window == null || o.window === '') ? 15 : Math.max(0, Number(o.window) || 0);
  var res = { checkIn: inT, checkOut: outT, grace: grace, dayOff: false, reopened: false, openFrom: '', holEnd: '' };

  var hs = hhmm(o.holStart), he = hhmm(o.holEnd);
  if (!hs && !he) return res;                       // no window on this day (or a whole-day holiday)
  var hsM = hs ? toMin(hs) : 0, heM = he ? toMin(he) : 24 * 60 - 1;
  var inM = toMin(inT), outM = toMin(outT);
  // The window only moves the start when it actually COVERS the start. An afternoon closure
  // (13:00–15:00 on an 08:00 shift) must not push a teacher's start time to 15:00 — they worked
  // the morning. Leaving early because the school shut is not measured here: nothing in the app
  // penalises an early finish, and OT still runs from the person's own end time.
  if (hsM > inM || heM < inM) return res;
  if (heM >= outM) { res.dayOff = true; res.holEnd = he; return res; }   // the window ate the shift

  res.checkIn = he;
  res.reopened = true;
  res.holEnd = he;
  res.openFrom = win > 0 ? addMin(he, -win) : he;   // clocking in opens before the school does
  res.grace = Math.max(grace, win);                 // ...and the same minutes are forgiven after
  return res;
}

function createAtomAPI(M, GROWTH_STD) {
  const cfg = M.config;
  const p2 = n => String(n).padStart(2,'0');
  const todayLocal = () => { const d=new Date(); return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate()); };
  const timeLocal = () => { const d=new Date(); return p2(d.getHours())+':'+p2(d.getMinutes()); };
  const stampLocal = () => todayLocal()+' '+timeLocal();
  /* EVERY BUSINESS RULE THE ENGINE ENFORCES WAS BEING REPORTED AS A CRASH.
   *
   * This set `e.code`. src/Code.gs's dispatch_ reads `err.apiCode` — the property apiError_ sets in
   * the .gs handlers — and falls back to 'INTERNAL' when it is missing. So an engine refusal left
   * here with the right Thai message and the code 'INTERNAL' attached to it.
   *
   * The parent still read the right sentence, so nothing looked broken from the outside. What broke
   * was the one report the school makes decisions from: "registerParent 82% INTERNALx9" in the
   * health report of 2026-08-30 was nine parents being told they were ALREADY REGISTERED — the
   * idempotency guard doing exactly its job — filed as nine server crashes. It is what sent this
   * session looking for an outage that was never there.
   *
   * Both names are set. `code` is what the engine and the mock browser path have always used;
   * `apiCode` is what GAS reads. Reproduced end to end through doPost before changing anything.
   */
  const fail = (code,msg)=>{ const e=new Error(msg); e.code=code; e.apiCode=code; throw e; };
  // month normalizer: Sheets coerces a 'YYYY-MM' cell to the date 'YYYY-MM-01', so ALWAYS compare
  // months via ym() (first 7 chars) — never raw ===, or bills/finance/OT-rollover silently mismatch.
  const ym = v => String(v==null?'':v).slice(0,7);
  // same idea one level down: a date cell may decode as 'YYYY-MM-DD HH:mm:ss' — compare the date part only
  const ymd = v => String(v==null?'':v).slice(0,10);
  // journal lifecycle: DRAFT = editable, parent not notified. Blank Status = legacy row, already sent.
  const jStatus_ = r => String((r&&r.Status)||'').toUpperCase()==='DRAFT' ? 'DRAFT' : 'SUBMITTED';
  const staffViewer_ = p => { const r=String((p&&p.role)||''); return !!r && r!=='Parent' && r!=='guest'; };
  // normalize a vaccine record's dose dates to an array (accepts new `Dates` array / JSON string /
  // comma-joined string, or a legacy single `Date`). GAS decodeCell may already parse a JSON array.
  const vacDates_ = v => { let d = (v.Dates!=null) ? v.Dates : v.Date;
    if(Array.isArray(d)) return d.map(x=>String(x||'').trim()).filter(Boolean);
    if(d==null || d==='') return [];
    const s=String(d).trim();
    if(s[0]==='['){ try{ return JSON.parse(s).map(x=>String(x||'').trim()).filter(Boolean); }catch(e){} }
    return s.split(',').map(x=>x.trim()).filter(Boolean); };

  function haversine(la1,ln1,la2,ln2){ const R=6371000,r=x=>x*Math.PI/180;
    const dLa=r(la2-la1),dLn=r(ln2-ln1); const a=Math.sin(dLa/2)**2+Math.cos(r(la1))*Math.cos(r(la2))*Math.sin(dLn/2)**2;
    return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))); }
  // age in whole months, TODAY by default — `on` gives the age on another day, which is what a
  // growth record needs: the age when they were measured, not when the numbers were typed in
  function ageMonths(dob,on){ const d=new Date(dob),n=on?new Date(String(on).slice(0,10)+'T00:00:00'):new Date();
    let m=(n.getFullYear()-d.getFullYear())*12+(n.getMonth()-d.getMonth()); if(n.getDate()<d.getDate())m--; return Math.max(0,m); }
  // A phone reports a point AND its own margin of error. Asking "is the dot inside?" instead of
  // "could they be inside?" told parents standing at the gate they were outside the school — 14% of
  // pickups in the 2026-08-11 report. The slack is capped (GpsAccuracySlack, default 50 m) so a
  // useless fix can never wave through someone at home. Mirrors assertWithinGeofence_ in Checkin.gs.
  function gpsSlack(acc){ const cap=Number(cfg.GpsAccuracySlack!=null?cfg.GpsAccuracySlack:50);
    const a=Number(acc); if(!isFinite(a)||a<=0) return 0;
    return Math.min(Math.round(a), (isFinite(cap)&&cap>=0)?cap:50); }
  function geo(lat,lng,acc){ const dist=haversine(cfg.GPS_Lat,cfg.GPS_Lng,lat,lng); const slack=gpsSlack(acc);
    // the phone's OWN accuracy belongs in the message — `slack` is that figure already capped, so a
    // phone guessing to the nearest 2 km printed the same "50 ม." as one with a perfect fix. See
    // assertWithinGeofence_ in Checkin.gs (2026-08-24: a teacher inside the school, 620 m out).
    const a=Number(acc);
    const accTxt=(isFinite(a)&&a>0)
      ? ` · ความแม่นยำที่เครื่องแจ้ง ±${Math.round(a)} ม.${a>cfg.Radius*3?' (ต่ำมาก — โทรศัพท์อาจส่งตำแหน่งแบบคร่าวๆ)':''}`
      : ' · เครื่องไม่แจ้งความแม่นยำ';
    if(dist-slack>cfg.Radius) fail('OUT_OF_RANGE',`อยู่นอกรัศมีโรงเรียน (${dist} ม. เกิน ${cfg.Radius} ม.${slack?` · เผื่อความคลาดเคลื่อน GPS ${slack} ม.`:''}${accTxt})`);
    return dist; }
  /**
   * WHERE DOES THIS PHONE THINK IT IS — asked without punching anything.
   *
   * A teacher standing inside the school was told she was 620 m outside it (2026-08-24). Nobody
   * could tell whether the fence was wrong, the phone was wrong, or she really was down the road,
   * because the only way to ask was to attempt a check-in and read the refusal. This answers the
   * question on its own: the distance, the phone's own margin of error, and which of the two is the
   * problem. It changes nothing and records nothing.
   */
  function geoCheck_(lat,lng,acc){
    const la=Number(lat), ln=Number(lng), a=Number(acc);
    if(!isFinite(la)||!isFinite(ln)) return {ok:false, reason:'NO_FIX'};
    const dist=haversine(cfg.GPS_Lat,cfg.GPS_Lng,la,ln), slack=gpsSlack(a), radius=Number(cfg.Radius)||0;
    const inside=(dist-slack)<=radius;
    /* WHY it failed, which is the whole point. A fix this vague is not a location, it is a postcode:
     * Android's "approximate location" permission and a Wi-Fi/cell-tower fallback both land here,
     * and both are settings on the phone rather than anything about where the person is standing. */
    const vague = isFinite(a) && a > Math.max(150, radius*3);
    return {ok:inside, distance:dist, radius, slack, accuracy:isFinite(a)&&a>0?Math.round(a):null,
      vague, reason: inside?'OK':(vague?'VAGUE_FIX':'TOO_FAR'),
      // how far they would still be over even after every allowance
      over: Math.max(0, dist - slack - radius) };
  }
  // distance without enforcing the fence — used for parent CHECK-IN (allowed from anywhere; check-out still fenced)
  function geoSafe(lat,lng){ return haversine(cfg.GPS_Lat,cfg.GPS_Lng,lat,lng); }
  /**
   * ...and for the ONE CHILD at a time whose pick-up is exempt from the fence too.
   *
   * A phone that states its own accuracy as ±2000 m cannot be fenced by anything, and nothing in its
   * settings changes that — on 2026-08-29 one put a parent standing at the gate 620 m away. The
   * school confirms the family in person and an admin ticks STUDENTS.GeoExempt for that child.
   * Per child, recorded, and off by default: everybody else is fenced exactly as before.
   */
  const studentGeoExempt_ = sid => { const s=studentById(sid);
    return !!(s && /^(yes|true|1|y)$/i.test(String(s.GeoExempt==null?'':s.GeoExempt).trim())); };
  const studentById = id => M.students.find(s=>s.StudentID===id);
  const staffById = id => M.staff.find(s=>s.StaffID===id)||{};
  // Sequential id = MAX existing number + 1.
  // NEVER use list.length+1: after a delete — or on a non-contiguous imported list — length+1 reuses an
  // id that already exists. Two records sharing an id means find-by-id returns the WRONG one, so an edit
  // or delete silently hits the wrong person. (This is what put two parents on PAR-056.)
  function nextSeqId_(list, field, prefix, pad, sep){ sep = (sep===undefined?'-':sep); let mx=0;
    const re=new RegExp('^'+prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'-?(\\d+)$');
    (list||[]).forEach(x=>{ const m=re.exec(String((x&&x[field])||'')); if(m){ const n=parseInt(m[1],10); if(n>mx)mx=n; } });
    return prefix+sep+String(mx+1).padStart(pad||0,'0'); }
  // duplicate-person detection for registration: an EXACT National-ID match, or (when the id is blank)
  // name+DOB for a student / name+phone for a parent. Prevents a re-submit creating a second row.
  const _nm=s=>String(s||'').trim().replace(/\s+/g,' ').toLowerCase();
  const _dig=s=>String(s==null?'':s).replace(/\D/g,'');
  const dupStudent_ = s2 => { const st=s2||{}; const nid=_dig(st.NationalID); const nm=_nm(st.NameTH||st.Name); const dob=String(st.DOB||'').slice(0,10);
    return (M.students||[]).find(x=> nid ? _dig(x.NationalID)===nid : (nm && _nm(x.NameTH||x.Name)===nm && String(x.DOB||'').slice(0,10)===dob)); };
  const dupParent_ = p2 => { const par=p2||{}; const nid=_dig(par.NationalID); const nm=_nm(par.NameTH||par.Name); const ph=_dig(par.Phone);
    return (M.parents||[]).find(x=> nid ? _dig(x.NationalID)===nid : (nm && _nm(x.NameTH||x.Name)===nm && _dig(x.Phone)===ph)); };
  const lateVs = (hhmm,t)=>{ const [h,m]=hhmm.split(':').map(Number); return Math.max(0,(t.getHours()*60+t.getMinutes())-(h*60+m)); };
  const toMin = hhmm => { const [h,m]=String(hhmm||'0:0').split(':').map(Number); return (h||0)*60+(m||0); };

  // Bank list for the PCHI insurance claim account — reference data from the insurer's own
  // "AtomNursery - PCHI Members Form" workbook (Setting sheet, column P "BANK CODE"). Their sample
  // row fills this field as "KBANK: ธนาคารกสิกรไทย จำกัด (มหาชน)", so the stored VALUE is
  // "<code>: <Thai name>"; the EN label is only for display. Embedded here (not SCHOOL_CONFIG)
  // because the engine never persists config — this way mock and GAS serve the identical list.
  const INSURANCE_BANKS = [
    {code:'AMERICA',th:'ธนาคารแห่งอเมริกา เนชั่นแนล แอสโซซิเอชั่น',en:'BANK OF AMERICA NATIONAL ASSOCIATION'},
    {code:'ANZ',th:'ธนาคารเอเอ็นแซด (ไทย) จำกัด (มหาชน)',en:'ANZ BANK (THAI) PUBLIC COMPANY LIMITED'},
    {code:'BAAC',th:'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร',en:'BANK FOR AGRICULTURE AND AGRICULTURAL COOPERATIVES'},
    {code:'BAY',th:'ธนาคารกรุงศรีอยุธยา จำกัด (มหาชน)',en:'BANK OF AYUDHYA PUBLIC COMPANY LIMITED'},
    {code:'BBL',th:'ธนาคารกรุงเทพ จำกัด (มหาชน)',en:'BANGKOK BANK PUBLIC COMPANY LIMITED'},
    {code:'BNPP',th:'ธนาคารบีเอ็นพี พารีบาส์ สาขากรุงเทพฯ',en:'BNP PARIBAS, BANGKOK BRANCH'},
    {code:'BOC',th:'ธนาคารแห่งประเทศจีน สาขากรุงเทพฯ',en:'BANK OF CHINA'},
    {code:'BOT',th:'ธนาคารแห่งประเทศไทย',en:'BANK OF THAILAND'},
    {code:'BTMU',th:'ธนาคารแห่งโตเกียว-มิตซูบิชิ ยูเอฟเจ สาขากรุงเทพฯ',en:'THE BANK OF TOKYO-MITSUBISHI UFJ, LIMITED, BANGKOK BRANCH'},
    {code:'CIMBT',th:'ธนาคาร ซีไอเอ็มบี ไทย จำกัด (มหาชน)',en:'CIMB THAI BANK PUBLIC COMPANY LIMITED'},
    {code:'CITI',th:'ธนาคารซิตี้แบงก์',en:'CITIBANK, N.A., BANGKOK BRANCH'},
    {code:'DB',th:'ธนาคารดอยซ์แบงก์',en:'DEUTSCHE BANK AKTIENGESELLSCHAFT'},
    {code:'GSB',th:'ธนาคารออมสิน',en:'GOVERNMENT SAVINGS BANK'},
    {code:'HSBC',th:'ธนาคารฮ่องกงและเซี่ยงไฮ้แบงกิ้งคอร์ปอเรชั่น จำกัด',en:'THE HONGKONG AND SHANGHAI BANKING CORPORATION LIMITED'},
    {code:'ICBC(Thai)',th:'ธนาคารไอซีบีซี (ไทย) จำกัด (มหาชน)',en:'INDUSTRIAL AND COMMERCIAL BANK OF CHINA (THAI) PUBLIC COMPANY LIMITED'},
    {code:'ISBT',th:'ธนาคารอิสลามแห่งประเทศไทย',en:'ISLAMIC BANK OF THAILAND'},
    {code:'KBANK',th:'ธนาคารกสิกรไทย จำกัด (มหาชน)',en:'KASIKORNBANK PUBLIC COMPANY LIMITED'},
    {code:'KK',th:'ธนาคารเกียรตินาคิน จำกัด (มหาชน)',en:'KIATNAKIN BANK PUBLIC COMPANY LIMITED'},
    {code:'KTB',th:'ธนาคารกรุงไทย จำกัด (มหาชน)',en:'KRUNG THAI BANK PUBLIC COMPANY LIMITED'},
    {code:'LH BANK',th:'ธนาคารแลนด์ แอนด์ เฮ้าส์ จำกัด (มหาชน)',en:'LAND AND HOUSES RETAIL BANK PUBLIC COMPANY LIMITED'},
    {code:'MEGA ICBC',th:'ธนาคาร เมกะ สากลพาณิชย์ จำกัด (มหาชน)',en:'MEGA INTERNATIONAL COMMERCIAL BANK PUBLIC COMPANY LIMITED'},
    {code:'MHCB',th:'ธนาคารมิซูโฮ คอร์ปอเรต จำกัด',en:'MIZUHO CORPORATE BANK LIMITED'},
    {code:'RBS',th:'ธนาคารเดอะรอยัลแบงก์อ๊อฟสกอตแลนด์ เอ็น.วี. สาขากรุงเทพฯ',en:'THE ROYAL BANK OF SCOTLAND N.V. , BANGKOK BRANCH'},
    {code:'SCB',th:'ธนาคารไทยพาณิชย์ จำกัด (มหาชน)',en:'SIAM COMMERCIAL BANK PUBLIC COMPANY LIMITED'},
    {code:'SCBT',th:'ธนาคารสแตนดาร์ดชาร์เตอร์ด (ไทย) จำกัด (มหาชน)',en:'STANDARD CHARTERED BANK (THAI) PUBLIC COMPANY LIMITED'},
    {code:'SCIB',th:'ธนาคารนครหลวงไทยจำกัด (มหาชน)',en:'City Bank Public Company Limited'},
    {code:'SMBC',th:'ธนาคารชูมิโตโม มิตซุย แบงกิ้ง คอร์ปอเรชั่น',en:'SUMITOMO MITSUI BANKING CORPORATION'},
    {code:'TBANK',th:'ธนาคารธนชาต จำกัด (มหาชน)',en:'THANACHART BANK PUBLIC COMPANY LIMITED'},
    {code:'TCRB',th:'ธนาคารไทยเครดิต เพื่อรายย่อย จำกัด (มหาชน)',en:'THAI CREDIT RETAIL BANK PUBLIC COMPANY LIMITED'},
    {code:'TISCO',th:'ธนาคารทิสโก้ จำกัด (มหาชน)',en:'TISCO BANK PUBLIC COMPANY LIMITED'},
    {code:'TTB',th:'ธนาคารทหารไทย จำกัด (มหาชน)',en:'TMB BANK PUBLIC COMPANY LIMITED'},
    {code:'UOBT',th:'ธนาคารยูโอบี จำกัด (มหาชน)',en:'UNITED OVERSEAS BANK (THAI) PUBLIC COMPANY LIMITED'},
  ];

  // ---- plans / OT ----
  const planById = id => (cfg.Plans||[]).find(p=>p.id===id) || null;
  // A child with NO package must cost NOTHING and show NOTHING. This used to fall back to the first
  // plan in the list, so every unassigned child silently inherited it — on live that is the 3,000
  // monthly package, and it reached the bills, the payment screens and prepay, not just a label.
  // Only the END TIME still falls back (OT has to be measured against something, and the school-wide
  // default is the honest answer there); the price is 0 and the labels are blank.
  const NO_PLAN = () => ({ id:'', labelTH:'', labelEN:'', price:0,
    end:String(cfg.DefaultCheckOutTime || ((cfg.Plans||[])[0]||{}).end || '17:00').slice(0,5) });
  const studentPlan = s => planById(s&&s.Plan) || NO_PLAN();
  // Per-student leave time (individual schedule) overrides the plan end. OT is measured against THIS,
  // so a child whose day ends 18:00/19:00 is never charged OT from 17:00. Blank → fall back to plan end.
  const studentEndTime = s => { const e=String((s&&(s.EndTime||s.LeaveTime))||'').trim(); return /^\d{1,2}:\d{2}/.test(e) ? e.slice(0,5) : studentPlan(s).end; };
  // OT is measured against OTGraceUntil when set (a child on the 17:00 rate may be allowed to be
  // picked up until 18:00 with NO OT), otherwise the nominal end time. Decoupled from EndTime so the
  // plan price/schedule stays put while the OT-free cutoff moves per student.
  const otThreshold = s => { const g=String((s&&s.OTGraceUntil)||'').trim(); return /^\d{1,2}:\d{2}/.test(g) ? g.slice(0,5) : studentEndTime(s); };
  /**
   * WHICH DAY OF THE MONTH THIS FAMILY PAYS ON, and the date that makes for a given month.
   *
   * Every bill was stamped DueDate = the 5th, for everybody, because that is what the code said. But
   * families are not all paid on the same day, and the school agrees a date with each of them — "ทุก
   * วันที่ 15". Everyone whose day was not the 5th was overdue on paper from the 6th of every month.
   *
   * Blank falls back to the school-wide BillingDueDay (5). A day later than the month is short —
   * the 31st in November — becomes the LAST day of that month rather than rolling into the next one,
   * which would move the due date past the month the bill is for.
   */
  const billingDayOf = s => { const d=parseInt(String((s&&s.BillingDay)||'').trim(),10);
    if(d>=1&&d<=31) return d;
    const c=parseInt(String(cfg.BillingDueDay!=null?cfg.BillingDueDay:5),10);
    return (c>=1&&c<=31)?c:5; };
  const billDueDate = (s, month) => { const m=ym(month||todayLocal().slice(0,7));
    const [Y,Mo]=m.split('-').map(Number);
    const last=new Date(Y,Mo,0).getDate();
    return m+'-'+String(Math.min(billingDayOf(s), last)).padStart(2,'0'); };
  // per-student monthly discount (MASTER on the student) applied to the tuition base. Unit '%' or 'บาท'.
  // Deducted silently at bill generation → the parent just sees a lower tuition, never a discount line.
  const studentDiscount_ = (s, base) => { const amt=Number(s&&s.DiscountAmount||0); if(!(amt>0))return 0;
    const pct=/%|percent/i.test(String((s&&s.DiscountUnit)||'')); const d=pct ? (Number(base)||0)*amt/100 : amt;
    return Math.min(Math.max(0,Math.round(d)), Number(base)||0); };
  const studentStartTime = s => { const e=String((s&&s.StartTime)||'').trim(); return /^\d{1,2}:\d{2}/.test(e) ? e.slice(0,5) : (cfg.DefaultStudentIn||'08:00'); };

  // ---- enrolment date vs billing --------------------------------------------------------------
  // A child is billed from the month they actually START, not from the month their record was typed
  // in: a new student entered in August who starts in September must not get an August bill, and a
  // returning child who comes back mid-month is charged by the school's chosen rule for that month.
  // 'YYYY-MM-DD' of the first real day at school; blank = no restriction (bill as before).
  const enrolDate_ = s => { const d=String((s&&s.EnrollDate)||'').trim(); const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    return m ? m[0] : (d ? (function(){ const x=new Date(d); return isNaN(x)?'':ymd(x); })() : ''); };
  // has this student started by the given MONTH? used for billing, which is monthly
  function enrolledBy_(s, month){ const e=enrolDate_(s); return !e || e.slice(0,7) <= ym(month); }
  // has this student started by the given DAY? used wherever "is this child here right now" is the
  // question — a child starting on the 15th is not on today's class list on the 3rd. Billing and
  // attendance genuinely need different granularities; using the monthly one for both made the DSPM
  // tab (day rule, client-side) and the DSPM card (month rule) disagree — 9 vs 11 in Nursery 1.
  function enrolledOn_(s, date){ const e=enrolDate_(s); return !e || e <= ymd(date||todayLocal()); }
  const daysInMonth_ = mm => { const [y,m]=String(mm).split('-').map(Number); return new Date(y, m, 0).getDate(); };
  /**
   * Tuition for `month` after the mid-month rule. Full price for every month except the one the
   * child actually starts in, and only when they start after the 1st. Modes (STUDENTS.ProrateMode):
   *   FULL (default) · HALF · DAILY (price x remaining days / days in month) · MANUAL (ProrateAmount)
   * Returns {amount, prorated, mode, days, ofDays} so the bill can say WHY it is not the full price.
   */
  function tuitionForMonth_(s, month, fullPrice){
    const full=Math.max(0, Number(fullPrice)||0);
    const e=enrolDate_(s), mm=ym(month);
    if(!e || e.slice(0,7)!==mm) return {amount:full, prorated:false, mode:'FULL', days:0, ofDays:0};
    const startDay=Number(e.slice(8,10))||1, total=daysInMonth_(mm);
    if(startDay<=1) return {amount:full, prorated:false, mode:'FULL', days:total, ofDays:total};
    const remain=total-startDay+1;
    const mode=String((s&&s.ProrateMode)||'FULL').toUpperCase();
    let amount=full;
    if(mode==='HALF') amount=Math.round(full/2);
    else if(mode==='DAILY') amount=Math.round(full*remain/total);
    else if(mode==='MANUAL') amount=Math.max(0, Number((s&&s.ProrateAmount)||0));
    return {amount, prorated:mode!=='FULL', mode, days:remain, ofDays:total};
  }
  // how the mid-month charge was worked out, in words the parent can read on the bill
  const prorateLabel_ = pr => pr.mode==='HALF' ? 'ครึ่งเดือน'
    : pr.mode==='DAILY' ? ('เฉลี่ยตามวัน '+pr.days+'/'+pr.ofDays+' วัน')
    : pr.mode==='MANUAL' ? 'ยอดที่กำหนดเอง' : 'เต็มเดือน';
  // Default class for a NEW student by age band (Premium is never auto — school assigns it manually):
  //   0–1y → Nursery Baby · 1–2y → Nursery 1 · 2–3y → Nursery 2 · 3y+ → Nursery 3.
  // Only a class present in the department master is used; otherwise blank (school assigns manually).
  function defaultClassByAge_(dob){ const m=ageMonths(dob); if(!(m>=0)) return '';
    const name = m<12?'Nursery Baby' : m<24?'Nursery 1' : m<36?'Nursery 2' : 'Nursery 3';
    const deps=(Array.isArray(cfg.Departments)?cfg.Departments:String(cfg.Departments||'').split(',')).map(x=>String(x).trim());
    return deps.indexOf(name)>=0 ? name : ''; }
  // teacher OT hours: ≥OTRoundUpMinutes within an hour rounds up to a full hour
  function otHoursRule(min){ if(min<=0)return 0; const h=Math.floor(min/60), rem=min%60; return h+(rem>=Number(cfg.OTRoundUpMinutes||50)?1:0); }
  // FLAT hourly rate for teacher OT — StaffOTHourlyRate (default 100), editable in Settings. It used
  // to be derived per salary from the Thai labour-law formula (1.5 × salary ÷ 30 ÷ 8), which is why
  // the payroll screen printed "× 89.38". The word 'auto' restores that derivation.
  function staffOtRate(staff){ const c=String(cfg.StaffOTHourlyRate==null?100:cfg.StaffOTHourlyRate).trim();
    if(c.toLowerCase()==='auto'){ const sal=Number((staff&&staff.BaseSalary)||0);
      if(sal>0) return Math.round(sal/30/8*1.5*100)/100; }
    return Number(parseFloat(c)||cfg.OTRatePerHour||100); }
  function staffById_(id){ return M.staff.find(x=>x.StaffID===id)||{}; }
  /* Big Cleaning Day: a monthly mandatory workday the admin sets. It COUNTS AS WORK — it is not a
   * holiday even when it lands on a Saturday — but it is worked to its OWN hours rather than each
   * staff group's normal schedule, so lateness and OT that day are measured against these two and
   * nobody is marked late for keeping to the day they were actually asked to work. Attendance also
   * credits a diligence bonus (เบี้ยขยัน). Set by the admin; the defaults are the school's usual ones.
   */
  function bigCleaningList_(){ const v=cfg.BigCleaningDays; return (Array.isArray(v)?v:String(v||'').split(',')).map(x=>String(x).trim()).filter(Boolean); }
  /**
   * This person's hours on this date — the shift, what a Big Cleaning day or a half-day holiday does
   * to it, and how late counts as late. Gathers the facts out of M and hands them to atomStaffHours_,
   * which holds the rule (see the block above createAtomAPI). Nothing here decides anything.
   */
  function staffHoursOn_(staffId, date){
    const d=ymd(date||todayLocal());
    const w=(M.workSchedule||[]).find(x=>String(x.StaffID)===String(staffId))||{};
    const s=staffById_(staffId)||{};
    const g=(M.staffGroups||[]).find(x=>x.GroupName===s.StaffGroup)||{};
    const hol=(M.holidays||[]).find(h=>ymd(h.Date)===d)||null;
    return atomStaffHours_({
      checkIn:  cfgTime_(w.CheckInTime,'')  || cfgTime_(g.CheckInTime,'')  || cfgTime_(cfg.DefaultCheckInTime,'08:00'),
      checkOut: cfgTime_(w.CheckOutTime,'') || cfgTime_(g.CheckOutTime,'') || cfgTime_(cfg.DefaultCheckOutTime,'17:00'),
      bigCleaning: isBigCleaning_(d), bigCleanIn: bigCleaningIn_(), bigCleanOut: bigCleaningOut_(),
      holStart: hol?cfgTime_(hol.StartTime,''):'', holEnd: hol?cfgTime_(hol.EndTime,''):'',
      grace: Number(cfg.LateGraceMinutes||0), window: cfg.HolidayReopenWindowMinutes });
  }
  const isBigCleaning_ = date => bigCleaningList_().indexOf(String(date))>=0;
  /**
   * Is the school open, and OPEN TO WHOM — the one answer, computed once and served to every screen.
   *
   * There are two questions here and they have different answers on a Big Cleaning day: the teachers
   * are in and being paid, the nursery is shut to the families. Anything that re-derives this on the
   * client gets it wrong sooner or later — the Admin dashboard did exactly that and, on a holiday
   * that was also a Big Cleaning day, marked all 31 children ขาด. So the rule lives HERE and the
   * handlers (schoolDay, dashboard) hand it out; no screen works it out for itself.
   */
  const schoolDayFor_ = (d, atTime) => { const date=ymd(d||todayLocal());
    const bc=isBigCleaning_(date);
    const hol=(M.holidays||[]).find(h=>ymd(h.Date)===date);
    const g=new Date(date+'T00:00:00').getDay(); const weekend=(g===0||g===6);
    /* A HOLIDAY CAN BE HALF A DAY. "19/08 08:00–12:30" means the school is shut for that window and
     * open around it: no check-in or pick-up while it lasts, and the calendar says so. Both times
     * blank means the whole day, which is how every holiday entered before this behaved — and an
     * unreadable cell (Sheets can hand a time back as an 1899 Date) falls back to blank, i.e. the
     * whole day, rather than to midnight, which would silently un-close the afternoon.
     * A weekend and a Big Cleaning day are whole-day facts and are not affected. */
    const hs=hol?cfgTime_(hol.StartTime,''):'', he=hol?cfgTime_(hol.EndTime,''):'';
    const partial=!!(hol&&(hs||he));
    // "now" only means something for TODAY. Asked about another date, the honest answer is whether
    // that day is off ALL day; the window is reported separately for the calendar to draw.
    const isToday=(date===todayLocal());
    const now=cfgTime_(atTime, timeLocal());
    const holNow=!!hol && (!partial || !isToday || ((!hs||now>=hs) && (!he||now<=he)));
    const holAllDay=!!hol && !partial;
    const closed=!bc && (weekend || holNow);              // shut RIGHT NOW, for STAFF
    const closedStd=!!(weekend || holNow);                // ...and for the CHILDREN
    return { date, closed, closedForStudents:closedStd, bigCleaning:bc, weekend,
      // the whole day off, as opposed to shut for part of it — what a calendar cell needs to know
      closedAllDay: !bc && (weekend || holAllDay),
      partial, holStart:hs, holEnd:he,
      // a Big Cleaning day is worked to ITS OWN hours, so the screen can say which ones apply
      bcIn: bc ? bigCleaningIn_() : '', bcOut: bc ? bigCleaningOut_() : '',
      // the reason follows whoever is shut out — on a Big Cleaning Saturday the staff are in but the
      // families are not, and their card still has to say why
      reason: (weekend||hol) ? (hol?(hol.NameTH||hol.NameEN||hol.Name||'วันหยุด'):'วันหยุดสุดสัปดาห์') : '',
      reasonEN: (weekend||hol) ? (hol?(hol.NameEN||hol.NameTH||hol.Name||'Holiday'):'Weekend') : '' }; };
  // A time that isn't a real HH:mm falls back to the default rather than becoming midnight — a
  // config cell can come back from Sheets as a Date, and 'Sat Dec 30 1899…' must never be treated
  // as a working time (see getConfigTime_ / hydrateConfig_ on the GAS side).
  const cfgTime_ = (v, dflt) => { const s=String(v==null?'':v).trim().slice(0,5);
    return /^\d{2}:\d{2}$/.test(s) ? s : dflt; };
  /**
   * WHEN is an announcement on show — one answer, for every screen.
   *
   * A school announcement now has a time as well as a date: "19/08 from 06:00 until 19/08 12:30".
   * A missing time means the whole of that day — 00:00 at the start, 23:59 at the end — so every
   * announcement written before this existed keeps behaving exactly as it did.
   *
   * The parent's list used to apply the date rule itself, in the browser, while the popup applied it
   * here. Two copies of a rule is how a screen ends up showing something the server thinks is over
   * (it has happened twice this month with "is the school open"), so the phase is computed HERE and
   * sent with each row: 'soon' (not started) · 'live' (showing) · 'ended'.
   *
   * A Sheets cell may hand back a time as a 1899 Date; cfgTime_ turns anything unparseable into the
   * default rather than into midnight, which would silently end an announcement a day early.
   */
  const annPhase_ = (a, nowD, nowT) => {
    const d = nowD || todayLocal(), t = nowT || timeLocal();
    const s = ymd(a && a.StartDate), e = ymd(a && a.EndDate);
    if (s) { const st = cfgTime_(a.StartTime, '00:00');
      if (d < s || (d === s && t < st)) return 'soon'; }
    if (e) { const et = cfgTime_(a.EndTime, '23:59');
      if (d > e || (d === e && t > et)) return 'ended'; }
    return 'live';
  };
  // newest first, by the day it was created and then by id — two announcements written on the same
  // day still come back in the order they were written, because AnnID counts up
  const annNum_ = a => { const m=/^ANN-?(\d+)$/.exec(String((a&&a.AnnID)||'')); return m?Number(m[1]):0; };
  const annSort_ = (a,b) => String(ymd(b.Date||b.StartDate)).localeCompare(String(ymd(a.Date||a.StartDate))) || (annNum_(b)-annNum_(a));
  /**
   * Is this child away today, and why? ONE answer, used by the teacher's class list, the parent's
   * home screen and the check-in guard — a leave that one screen honours and another does not is
   * worse than no leave at all.
   */
  function studentLeaveToday_(sid, onDate){
    const d=ymd(onDate||todayLocal());
    const lv=(M.studentLeaves||[]).find(l=>String(l.StudentID)===String(sid)&&ymd(l.Date)===d)||null;
    return {onLeave:!!lv, leaveType:lv?(lv.Type||'ลา'):'', leaveReason:lv?(lv.Reason||''):''};
  }
  const bigCleaningIn_  = () => cfgTime_(cfg.BigCleaningIn,  '08:30');
  const bigCleaningOut_ = () => cfgTime_(cfg.BigCleaningOut, '17:00');
  // enrich an OT record with the staff's names + that day's check-in / check-out (so the approver can see
  // when they arrived vs when they left — the leave time is what drove the OT).
  // OT วันหยุด is a lump sum with no hours behind it — asked in one place so no re-pricing path
  // (approval, edit, a rate correction) can quietly turn an agreed amount into hours × rate = 0.
  const isHolidayOT_ = r => String((r&&r.Kind)||'').toUpperCase()==='HOLIDAY';
  function otView_(r){ const s=staffById_(r.StaffID)||{}; let ci='', co='';
    if(ymd(r.Date)===todayLocal()){ const a=(M.staffAttendanceToday||[]).find(x=>x.StaffID===r.StaffID); if(a){ci=a.CheckIn||'';co=a.CheckOut||'';} }
    else { const a=(M.staffAttendanceHistory||[]).find(x=>x.StaffID===r.StaffID&&ymd(x.Date)===ymd(r.Date)); if(a){ci=a.In||a.CheckIn||'';co=a.Out||a.CheckOut||'';} }
    return Object.assign({}, r, {name:s.NameTH,nameEN:s.NameEN,nick:s.Nickname,nickEN:s.NicknameEN,dept:s.Department,
      CheckIn:ci, CheckOutActual:co||r.ActualOut||''}); }
  // enrich a leave request with the requester's names (so lists show a nickname, not STF-xxx)
  // '' | 'AM' (ครึ่งวันเช้า) | 'PM' (ครึ่งวันบ่าย) — anything else is a full day
  function halfDay_(v){ const s=String(v||'').toUpperCase().trim(); return (s==='AM'||s==='PM')?s:''; }
  // Canonical Thai leave type. Rows written while the app was in English hold the translated label
  // ("Sick Leave"), because the old dropdown had no value attribute and i18n_tr.js rewrote the option
  // text in place. The entitlement counter is keyed by the Thai name, so those rows counted as zero
  // days used. Normalise on the way in and on the way out so old rows heal themselves.
  const LEAVE_ALIAS_={'sick leave':'ลาป่วย','sick':'ลาป่วย','leave of absence':'ลากิจ','personal leave':'ลากิจ',
    'personal':'ลากิจ','business leave':'ลากิจ','holiday leave':'ลาพักร้อน','vacation':'ลาพักร้อน',
    'vacation leave':'ลาพักร้อน','annual leave':'ลาพักร้อน','absent':'ขาด'};
  function leaveTypeTH_(v){ const s=String(v==null?'':v).trim(); return s?(LEAVE_ALIAS_[s.toLowerCase()]||s):''; }
  // ---- student OT: charge vs goodwill discount (see adminUpdateOT) ----
  // Amount is always the NET payable. FullAmount is the charge before any waiver; rows written
  // before discounts existed have none, in which case their Amount IS the full charge.
  const otNum_=v=>{ const n=Number(v); return isFinite(n)&&n>0?n:0; };
  const otFullOf_=o=>{ const f=Number(o&&o.FullAmount); return (isFinite(f)&&f>0)?f:otNum_(o&&o.Amount); };
  const otDiscOf_=(o,full)=>Math.min(otNum_(o&&o.Discount), otNum_(full));
  /* ---- the school's own food list, used to seed FOOD_ITEMS on first use --------------------
   * [ชื่อไทย, English, category]. English names are what a parent reading the app in English sees,
   * so they are written as a person would say them, not transliterated.
   */
  const FOOD_SEED_ = [
    ['ข้าวต้มไก่', 'Chicken rice porridge', 'savoury'],
    ['ข้าวต้มปลา', 'Fish rice porridge', 'savoury'],
    ['ต้มจืดผักรวมไก่สับ', 'Clear soup with mixed vegetables and minced chicken', 'savoury'],
    ['ข้าวผัดใส่ผัก', 'Fried rice with vegetables', 'savoury'],
    ['ข้าวต้มจืดผักกาดขาวไก่สับ', 'Clear soup with napa cabbage and minced chicken', 'savoury'],
    ['ข้าวผัดคะน้าใส่ไข่ + ไก่สับ', 'Fried rice with kale, egg and minced chicken', 'savoury'],
    ['ข้าวผัดฟัก', 'Fried rice with winter melon', 'savoury'],
    ['ข้าวต้มจืดฟัก', 'Clear winter melon soup with rice', 'savoury'],
    ['ข้าวผัดรวมมิตร', 'Mixed fried rice', 'savoury'],
    ['ก๋วยเตี๋ยวเส้นใหญ่น้ำใส', 'Wide rice noodles in clear broth', 'savoury'],
    ['ผัดวุ้นเส้น', 'Stir-fried glass noodles', 'savoury'],
    ['ข้าวไข่ตุ๋น', 'Steamed egg with rice', 'savoury'],
    ['ข้าวไข่พะโล้', 'Five-spice stewed egg with rice', 'savoury'],
    ['ข้าวไก่ทอด', 'Fried chicken with rice', 'savoury'],
    ['ข้าวไก่หวาน', 'Sweet braised chicken with rice', 'savoury'],
    ['ข้าวตุ๋นปลากะพง', 'Steamed sea bass with rice', 'savoury'],
    ['ข้าวตุ๋นปลาซาลมอน', 'Steamed salmon with rice', 'savoury'],
    ['ข้าวตุ๋นไข่', 'Steamed egg custard with rice', 'savoury'],
    ['ข้าวมันไก่', 'Hainanese chicken rice', 'savoury'],
    ['เกี๊ยวน้ำใส', 'Wonton in clear soup', 'savoury'],
    ['ข้าวต้มจืดหัวไชเท้า', 'Clear radish soup with rice', 'savoury'],
    ['ผัดผักรวมมิตร', 'Stir-fried mixed vegetables', 'savoury'],
    ['ผลไม้', 'Fruit', 'fruit'],
    ['กล้วย', 'Banana', 'fruit'],
    ['ส้ม', 'Orange', 'fruit'],
    ['แก้วมังกร', 'Dragon fruit', 'fruit'],
    ['แอปเปิ้ล', 'Apple', 'fruit'],
    ['มะม่วง', 'Mango', 'fruit'],
    ['ฝรั่ง', 'Guava', 'fruit'],
    ['อโวคาโด้', 'Avocado', 'fruit'],
    ['องุ่น', 'Grapes', 'fruit'],
    ['มะละกอ', 'Papaya', 'fruit'],
    ['กีวี', 'Kiwi', 'fruit']
  ];

  /**
   * Which meals a class records in the daily journal.
   * The school's rule: Nursery 1 (the youngest) stay for dinner and record all four; Nursery 2, 3
   * and Premium record breakfast, lunch and a snack only.
   */
  // keys match the journal's own field names, so no mapping layer can drift out of step
  function allMealSlots_() {
    return [
      { key: 'Breakfast', th: 'อาหารเช้า', en: 'Breakfast' },
      { key: 'Lunch', th: 'อาหารกลางวัน', en: 'Lunch' },
      { key: 'Dinner', th: 'อาหารเย็น', en: 'Dinner' },
      { key: 'Snack', th: 'อาหารว่าง', en: 'Snack' }
    ];
  }
  function mealSlotsFor_(className) {
    const c = String(className || '');
    const all = allMealSlots_();
    // The babies are fed on their own schedule, recorded as milk feeds rather than meals, so the
    // meal section is empty for them — an empty list, not "all of them".
    if (isBabyClass_(c)) return [];
    // Nursery 1 stays for dinner; 2 / 3 / Premium go home before it.
    return staysForDinner_(c) ? all : all.filter(s => s.key !== 'Dinner');
  }
  // "Nursery Baby" / "เบบี้". Matched on the word, so "Nursery 1" can never fall in here.
  function isBabyClass_(c) { return /baby|เบบี้|เบบี|ทารก/i.test(String(c || '')); }
  // Only Nursery 1 — NOT Nursery 10 or Nursery 12, hence the boundary after the digit.
  function staysForDinner_(c) { return /(^|[^\d])1([^\d]|$)/.test(String(c || '')) && !isBabyClass_(c); }

  /**
   * ONE menu a day, for the whole school.
   *
   * The kitchen cooks once and every class eats the same food, so the menu is entered once per day.
   * WHO eats which meal stays a class rule, applied where the menu is SHOWN (mealSlotsFor_ above):
   * Nursery Baby records no meals at all, Nursery 1 stays for dinner, Nursery 2 / 3 / Premium go
   * home before it. Planning per class only ever meant typing the same dish four times.
   *
   * Menus written before this change are keyed by class. They are still read, as a FALLBACK for any
   * day with no shared menu, so nothing typed in the past disappears — and where several classes
   * have a row for the same day, the fullest one wins, because that loses the least. A shared menu
   * always beats a legacy one; and clearing a day deletes BOTH, or "I deleted it" would be followed
   * by the old class menu reappearing in its place.
   */
  const MENU_ALL_ = 'ALL';
  const MENU_FIELDS_ = ['Breakfast', 'SnackAM', 'Lunch', 'SnackPM', 'Dinner'];
  function menuRowsByDate_(M, month) {
    const shared = {}, legacy = {};
    (M.foodMenus || []).forEach(r => {
      const d = ymd(r.Date); if (!d || ym(d) !== month) return;
      if (String(r.Class) === MENU_ALL_) shared[d] = r; else (legacy[d] || (legacy[d] = [])).push(r);
    });
    const filled = r => MENU_FIELDS_.reduce((a, k) => a + (String(r[k] || '').trim() ? 1 : 0), 0);
    const out = {};
    Object.keys(legacy).forEach(d => {
      out[d] = legacy[d].slice().sort((a, b) => (filled(b) - filled(a)) ||
        String(a.Class || '').localeCompare(String(b.Class || '')))[0];
    });
    Object.keys(shared).forEach(d => { out[d] = shared[d]; });
    return out;
  }

  // ---- survey row -> the shape every screen reads (Options is stored as JSON in one cell) ----
  const SURVEY_MAX_Q = 5;                       // the school's cap — more than this and nobody answers
  const SURVEY_TYPES = ['rating', 'vote', 'comment'];
  /**
   * A survey holds up to five questions, stored as JSON in one cell.
   *
   * Surveys written before this existed have a single Type/Options at the survey level and use the
   * TITLE as the question. They are read back as a one-question survey rather than migrated, so an
   * already-answered survey keeps working and nothing has to be rewritten in the sheet.
   */
  function surveyQuestions_(s){
    let qs=[]; try{ qs=JSON.parse(s.Questions||'[]')||[]; }catch(e){ qs=[]; }
    if(Array.isArray(qs) && qs.length){
      return qs.slice(0,SURVEY_MAX_Q).map((q,i)=>({ id:'q'+(i+1), text:String(q.text||'').trim(),
        type:SURVEY_TYPES.indexOf(String(q.type))>=0?String(q.type):'rating',
        options:(Array.isArray(q.options)?q.options:[]).map(x=>String(x).trim()).filter(Boolean) }));
    }
    let opts=[]; try{ opts=JSON.parse(s.Options||'[]')||[]; }catch(e){ opts=[]; }
    return [{ id:'q1', text:s.Title||'', type:s.Type||'rating', options:opts }];   // legacy shape
  }
  function surveyView_(s){ const qs=surveyQuestions_(s);
    return { surveyId:s.SurveyID, title:s.Title||'', description:s.Description||'',
      questions:qs, questionCount:qs.length,
      // kept so older screens and the legacy single-question path still read the same fields
      type:qs[0]?qs[0].type:'rating', options:qs[0]?qs[0].options:[],
      scope:s.Scope||'all', target:s.Target||'', startDate:ymd(s.StartDate||''),
      endDate:ymd(s.EndDate||''), status:s.Status||'OPEN', anonymous:String(s.Anonymous||'')==='YES',
      createdAt:s.CreatedAt||'' }; }
  /** One family's answers, as an array aligned to the questions. */
  function surveyAnswers_(r){ let a=[]; try{ a=JSON.parse(r.Answers||'[]')||[]; }catch(e){ a=[]; }
    if(Array.isArray(a) && a.length) return a.map(x=>({rating:Number(x.rating)||0, choice:String(x.choice||''), comment:String(x.comment||'')}));
    return [{rating:Number(r.Rating)||0, choice:String(r.Choice||''), comment:String(r.Comment||'')}]; }
  // Re-settle an OT row against its slips after its AMOUNT changed. Only when it actually has slips:
  // recomputeTarget_'s "nothing submitted" branch stamps VerifiedStatus='REJECTED', which would be a
  // lie on a row nobody has ever paid towards. Returns the new status if it moved, else null.
  function otResettle_(o){ if(!o) return null;
    try{ if(sumSlips_('ot',o.OTID,['SUBMITTED','CONFIRMED'])<=0) return null;
      const before=String(o.Status||''); recomputeTarget_('ot',o.OTID);
      const after=String(o.Status||''); return after===before?null:after; }catch(e){ return null; } }
  function leaveView_(l){ const s=staffById_(l.StaffID)||{}; return Object.assign({}, l,
    // a staff row that has been deleted leaves the id as the name — a row with no name at all is
    // indistinguishable from a bug, and the admin still needs to know WHOSE leave this is
    {name:s.NameTH||l.StaffID,nameEN:s.NameEN||l.StaffID,nick:s.Nickname,nickEN:s.NicknameEN,
     days:Number(l.Days)||0, halfDay:halfDay_(l.HalfDay)}); }
  // enrich a manual-attendance request with the requester's names
  function atrView_(r){ const s=staffById_(r.StaffID)||{}; return Object.assign({}, r,
    {name:s.NameTH,nameEN:s.NameEN,nick:s.Nickname,nickEN:s.NicknameEN}); }
  // MOCK apply of an approved manual-attendance request: write the check-in/out into the day's record
  // (create it if absent), recompute late/OT vs the staff's schedule, and flag the value as manual.
  function applyTimeRequest_(r){ const sch=M.workSchedule.find(w=>w.StaffID===r.StaffID)||{CheckInTime:cfg.DefaultCheckInTime||'08:00',CheckOutTime:cfg.DefaultCheckOutTime||'17:00'};
    if(ymd(r.Date)===todayLocal()){ let rec=M.staffAttendanceToday.find(x=>x.StaffID===r.StaffID);
      if(!rec){rec={StaffID:r.StaffID,CheckIn:'',CheckOut:'',Status:'NONE',Late:0};M.staffAttendanceToday.push(rec);}
      if(r.Type==='IN'){ const raw=Math.max(0,toMin(r.RequestTime)-toMin(sch.CheckInTime)); rec.CheckIn=r.RequestTime; rec.Late=raw<=Number(cfg.LateGraceMinutes||0)?0:raw; rec.InManual='YES'; if(rec.Status==='NONE')rec.Status='IN'; }
      else { rec.CheckOut=r.RequestTime; rec.OTHours=otHoursRule(Math.max(0,toMin(r.RequestTime)-toMin(sch.CheckOutTime))); rec.OutManual='YES'; rec.Status='OUT'; } }
    else { M.staffAttendanceHistory=M.staffAttendanceHistory||[]; let rec=M.staffAttendanceHistory.find(x=>x.StaffID===r.StaffID&&ymd(x.Date)===ymd(r.Date));
      if(!rec){rec={Date:ymd(r.Date),StaffID:r.StaffID,In:'',Out:''};M.staffAttendanceHistory.push(rec);}
      if(r.Type==='IN'){rec.In=r.RequestTime;rec.InManual='YES';} else {rec.Out=r.RequestTime;rec.OutManual='YES';} } }
  // EVERY class students are actually in: CLASSES rows ∪ departments master ∪ distinct student Class.
  // A department-only class (no CLASSES row) is synthesized as {ClassName}. Never build a class list
  // from M.classes alone — students live in departments (Nursery Baby/Premium) that have no CLASSES row.
  function allClassObjs_(){ const names=[]; const add=n=>{ n=String(n||'').trim(); if(n&&names.indexOf(n)<0)names.push(n); };
    (M.classes||[]).forEach(c=>add(c.ClassName));
    (Array.isArray(cfg.Departments)?cfg.Departments:String(cfg.Departments||'').split(',')).forEach(add);
    activeStudents().forEach(s=>add(s.Class));
    return names.map(n=>(M.classes||[]).find(c=>c.ClassName===n)||{ClassName:n}); }
  // classes a staff covers (see classList). Returns an array of class objects, never empty when classes exist.
  /**
   * COVERING A CLASS FOR A FEW DAYS IS NOT THE SAME AS BEING MOVED TO IT.
   *
   * "วันนี้คุณครูลา และมีครูไม่เพียงพอต่อชั้นเรียน … ครูก้อยดูแล Nursery 1 และ 2 เป็นปกติ ต้องการเพิ่ม
   *  Nursery Baby สำหรับวันนี้ แต่พรุ่งนี้ก็กลับไปเป็นปกติ" (2026-08-29).
   *
   * Editing Classes on the staff record would have done it — and then somebody has to remember to
   * edit it back. Nobody does, on the day somebody was off sick. So cover is a ROW WITH TWO DATES
   * that stops applying on its own: the permanent assignment is never touched, and there is nothing
   * to undo tomorrow.
   *
   * Reading it is what makes it expire — no trigger to schedule and none to forget, the same shape
   * as EndDate on a staff record and PauseFrom/PauseTo on a student.
   */
  const classCover_ = () => (M.classCover = M.classCover || []);
  function coverClassesOn_(staffId, date){ const d=ymd(date||todayLocal());
    return classCover_().filter(r=>String(r.StaffID)===String(staffId) &&
        ymd(r.From)<=d && (!String(r.To||'').trim() || ymd(r.To)>=d))
      .map(r=>String(r.ClassName||'').trim()).filter(Boolean); }
  /**
   * `onDate` exists so a screen ABOUT a past day can ask who was covering THAT day. Left out it
   * means today, which is what "whose class is this" means on every live screen.
   */
  function coveredClasses_(staff, onDate){ staff=staff||{}; const all=allClassObjs_();
    const lvl=String(staff.PositionLevel||''), role=String(staff.Role||'');
    // Admin/Leader (or Classes/Department = '*') → ALL classes students are in
    const dept=String(staff.Department||''), list=String(staff.Classes||'').split(',').map(x=>x.trim()).filter(Boolean);
    if(lvl==='Admin'||lvl==='Leader'||role==='Admin'||list.indexOf('*')>=0||dept==='*') return all.slice();
    const names={};
    all.forEach(c=>{ if(c.TeacherID===staff.StaffID) names[c.ClassName]=1; });
    list.forEach(n=>names[n]=1);
    // Department may be a comma list of the department(s) this staff is responsible for
    dept.split(',').map(x=>x.trim()).filter(Boolean).forEach(n=>names[n]=1);
    // ...plus anything they are covering today. ADDED to what they already have, never instead of
    // it: a teacher asked to take Nursery Baby as well still has Nursery 1 and 2.
    coverClassesOn_(staff.StaffID, onDate).forEach(n=>names[n]=1);
    const cls=all.filter(c=>names[c.ClassName]);
    return cls.length?cls:[all.find(c=>c.TeacherID===staff.StaffID)||all[0]].filter(Boolean); }
  // May this staff drag/move teachers & students between classes (the admin organize tool)? Admin/Leader
  // always; a plain teacher only when the admin flags CanClassOrg on their record.
  function canOrganize_(staff){ if(!staff||!staff.StaffID) return false;
    const lvl=String(staff.PositionLevel||''), role=String(staff.Role||'');
    if(lvl==='Admin'||lvl==='Leader'||role==='Admin') return true;
    const v=staff.CanClassOrg; return v===true||v==='YES'||v===1||String(v).toUpperCase()==='TRUE'; }
  /**
   * ...and who may LEND a teacher to another class for a few days (classCoverAdd).
   *
   * canOrganize_ plus the HEAD TEACHER, who the school named directly: "ให้หัวหน้าครู ติ๊กเพิ่ม
   * เหมือนแอดมิน" (2026-08-29). A head teacher already sees every class, every child and every
   * journal (Department='*'), so this gives away nothing they could not already read — but it is a
   * separate function rather than a widening of canOrganize_, because that one also opens the drag
   * tool that MOVES people permanently, and nobody asked for that.
   */
  const canCover_ = staff => canOrganize_(staff) || headTeacher_(staff);
  /**
   * ...and who may move a CHILD from one room to another permanently.
   *
   * Named by the school on 2026-09-02: "ผู้ที่ดำเนินการได้คือ หัวหน้าครูและ Admin เท่านั้น" — so the
   * head teacher is IN, which canOrganize_ alone did not give them, and a plain teacher is out. The
   * teacher the admin explicitly ticked CanClassOrg for stays in: that tick is itself an admin
   * decision ("ย้ายครู/นักเรียน เหมือนแอดมิน"), and silently revoking a granted permission is not
   * something a screen change should do.
   *
   * Deliberately NOT the same right as moving a TEACHER, which stays canOrganize_. A head teacher
   * arranging which room a child sits in is the daily business of running a nursery; deciding which
   * staff member is responsible for a room is not.
   */
  const canMoveStudent_ = staff => canCover_(staff);
  // OT for a pickup time (HH:MM) vs the student's plan end + grace; 100/started hour
  // OT that is PAID or CANCELLED is settled — it must never roll into a bill or count as outstanding.
  const OT_CLOSED = { PAID:1, CANCELLED:1 };
  const otOpenRec = o => !OT_CLOSED[o.Status];
  /**
   * HAS MONEY ACTUALLY BEEN RECEIVED against this charge?
   *
   * 'PAID' was being used for two different things: a family who paid, and a charge waived in full
   * (adminUpdateOT marks a zero amount PAID — "nothing to collect"). Nothing could tell them apart,
   * so a waived row was frozen for ever: when the pick-up time was corrected back to a genuinely
   * late one, the charge could not come back, the family was never billed and never told. Reported
   * on ธันวา, 18/08: cancelled at 16:40, then re-entered as 18:09 — and nothing happened.
   *
   * Money received is the only thing that must never be recomputed. A waiver is a decision about a
   * charge, and a charge that turns out to be real again is chargeable again.
   */
  function otSettled_(o){ if(!o) return false;
    if(Number(o.SlipAmount||0)>0) return true;
    if(String(o.Status||'')==='PAID' && Number(o.Amount||0)>0) return true;
    try{ if(paySlipSum_('ot', o.OTID, ['SUBMITTED','CONFIRMED'])>0) return true; }catch(e){}
    return false; }
  /**
   * RECONCILE a day's late-pickup charge WITH THE PICK-UP TIME. The only way any of them may.
   *
   * Three handlers used to do this for themselves — the parent's check-out, the teacher's on-behalf
   * check-out, and the correction form — and each stopped at `if (amount > 0)`. So a pick-up time
   * corrected DOWNWARD created no charge and removed none: on 18/08 ธันวา was recorded home at 16:40
   * and still billed 2 hours against 18:09, the moment the teacher happened to tap. Money that a
   * teacher had already put right, still on the family's bill.
   *
   * The rule, in one place:
   *   nothing owed  -> an existing charge is CANCELLED (kept, at zero, so the correction is visible)
   *   something owed-> created or recomputed, keeping any discount the school granted
   *   PAID          -> never touched here
   *   CANCELLED by an ADMIN -> stays cancelled; that was a decision about money
   *   CANCELLED by this rule -> comes back if the time changes again; that was only arithmetic
   */
  function otReconcile_(student, date, pickupHHMM){
    const d=ymd(date), sid=student.StudentID;
    const otId='OT-'+d.replace(/-/g,'')+'-'+sid;
    const i=M.otDaily.findIndex(x=>x.OTID===otId);
    const r=i>=0?M.otDaily[i]:null;
    const status=r?String(r.Status||''):'';
    if(otSettled_(r)) return null;
    const o=pickupHHMM?otFor(student,pickupHHMM):{amount:0,late:0,hours:0,planEnd:otThreshold(student)};
    if(o.amount<=0){
      if(!r) return null;
      r.PickupTime=pickupHHMM||''; r.PlanEnd=o.planEnd; r.LateMinutes=o.late||0; r.Hours=0;
      r.FullAmount=0; r.Amount=0; r.Status='CANCELLED'; r.CancelledBy='AUTO_TIME';
      r.CancelNote=pickupHHMM?('แก้เวลารับกลับเป็น '+pickupHHMM+' — ไม่เข้าเงื่อนไข OT'):'ล้างเวลารับกลับ — ไม่เข้าเงื่อนไข OT';
      return null;
    }
    if(r){
      if(status==='CANCELLED' && String(r.CancelledBy||'')!=='AUTO_TIME') return null;
      // a row marked PAID with no money behind it is a WAIVER, not a payment — it may be re-charged
      if(status==='PAID'){ r.Status='UNPAID'; r.PaidDate=''; }
      const disc=otDiscOf_(r,o.amount);
      r.PickupTime=pickupHHMM; r.PlanEnd=o.planEnd; r.LateMinutes=o.late; r.Hours=o.hours;
      r.FullAmount=o.amount; r.Discount=disc; r.Amount=Math.max(0,o.amount-disc);
      if(status==='CANCELLED'){ r.Status='UNPAID'; r.CancelledBy=''; r.CancelNote=''; }
      // `amount` is the CHARGE (what the late pick-up costs), matching the Apps Script route and what
      // every caller has always been handed; `net` is what is actually billed after a waiver.
      return {otId, lateMinutes:o.late, hours:o.hours, amount:o.amount, net:r.Amount, planEnd:o.planEnd};
    }
    M.otDaily.push({OTID:otId,Date:d,StudentID:sid,PickupTime:pickupHHMM,PlanEnd:o.planEnd,
      LateMinutes:o.late,Hours:o.hours,FullAmount:o.amount,Discount:0,Amount:o.amount,
      Status:'UNPAID',SlipRef:'',SlipAmount:0});
    return {otId, lateMinutes:o.late, hours:o.hours, amount:o.amount, net:o.amount, planEnd:o.planEnd};
  }
  // A month's TUITION is covered when the student has a CONFIRMED (PAID) advance payment whose Covered
  // months include it. Advance payment covers ONLY the monthly tuition (plan price) — food/activity/
  // special-class charges are still billed each of those months (they are NOT waived by the prepay).
  function prepayCoveredMonths_(pp){ let c=pp&&pp.Covered; if(typeof c==='string'){ try{c=JSON.parse(c);}catch(e){c=[];} } return (Array.isArray(c)?c:[]).map(ym); }
  function monthTuitionPrepaid_(studentId, month){ const mm=ym(month);
    return (M.prepayments||[]).some(pp=> String(pp.StudentID)===String(studentId) && String(pp.Status)==='PAID' && prepayCoveredMonths_(pp).indexOf(mm)>=0); }
  /**
   * The PAID advance payment covering this month, with what it bought — so a screen can say
   * "6 เดือน (ส.ค. 2569 – ม.ค. 2570) · เหลืออีก 5 เดือน" instead of just "prepaid".
   * `left` counts the covered months from this one onward, this month included.
   */
  function prepayInfo_(studentId, month){ const mm=ym(month);
    const pp=(M.prepayments||[]).find(x=> String(x.StudentID)===String(studentId) && String(x.Status)==='PAID' && prepayCoveredMonths_(x).indexOf(mm)>=0);
    if(!pp) return null;
    const cov=prepayCoveredMonths_(pp);
    return { prepayId:pp.PrepayID, months:Number(pp.Months)||cov.length, discount:Number(pp.Discount)||0,
      amount:Number(pp.Amount||0), covered:cov, from:cov[0]||'', to:cov[cov.length-1]||'',
      left:cov.filter(m=>m>=mm).length, index:cov.indexOf(mm)+1 }; }
  /**
   * How much of a bill is TUITION. Advance payment covers tuition and nothing else, so this is what
   * it may credit. It used to be capped at the student's CURRENT plan price, which meant that as soon
   * as a package price changed (or the bill had been issued at another price) the difference turned
   * into a debt the family had already paid — the bill showed "ค่าเทอม 7,500 − ชำระล่วงหน้า 5,500 =
   * ค้าง 2,000". A prepaid month owes no tuition, whatever the tuition happens to be.
   */
  function billTuition_(b){ if(!b) return 0;
    let items=b.Items;
    if(typeof items==='string' && items){ try{ items=JSON.parse(items); }catch(e){ items=null; } }
    if(Array.isArray(items) && items.length){
      const tui=items.filter(it=>Array.isArray(it) && /ค่าเทอม|tuition/i.test(String(it[0]||'')) && Number(it[1])>0)
        .reduce((a,it)=>a+Number(it[1]||0),0);
      if(tui>0) return Math.min(tui, Number(b.Amount||0)||tui);
    }
    return Number(b.Amount||0); }
  // Advance-tuition discount tiers, Admin-editable (SCHOOL_CONFIG.PrepayTiers, JSON or array).
  // Falls back to the school's current published table; a saved tier list always wins.
  const PREPAY_TIERS_DEFAULT = [{months:3,discount:5},{months:6,discount:10},{months:12,discount:15}];
  function prepayTiers_(){ let t=cfg.PrepayTiers;
    if(typeof t==='string' && t.trim()){ try{ t=JSON.parse(t); }catch(e){ t=null; } }
    if(!Array.isArray(t)||!t.length) return PREPAY_TIERS_DEFAULT.slice();
    return t.map(x=>({months:Number(x.months)||0, discount:Number(x.discount)||0}))
            .filter(x=>x.months>0).sort((a,b)=>a.months-b.months); }
  // per-student OT rate overrides the global OTRatePerHour when set (> 0)
  const otRateFor = student => { const r=Number(student&&student.OTRate); return r>0?r:Number(cfg.OTRatePerHour||100); };
  function otFor(student, pickupHHMM){
    const planEnd=otThreshold(student); const late=Math.max(0, toMin(pickupHHMM)-toMin(planEnd));
    const grace=Number(cfg.OTGraceMinutes||21);
    if(late<=grace) return {late, hours:0, amount:0, planEnd, rate:otRateFor(student)};
    const hours=Math.ceil(late/60); return {late, hours, amount:hours*otRateFor(student), planEnd, rate:otRateFor(student)};
  }

  // ---- data-access links (a user sees only linked students) ----
  function linkedStudentIds(uid){ const ids=M.userLinks.filter(l=>l.UserUID===uid).map(l=>l.StudentID);
    return ids.length?ids:null; }
  // resolve the students a parent user may see: links first, else legacy ParentID
  function visibleStudents(p){ const uid=p.uid||p.lineUID; const ids=uid?linkedStudentIds(uid):null;
    let list = ids ? M.students.filter(s=>ids.indexOf(s.StudentID)>=0)
                   : M.students.filter(s=>s.ParentID===p.parentId);
    return list.filter(s=>!INACTIVE[s.Status]); }
  const INACTIVE = { EXPORTED:1, WITHDRAWN:1 };
  /**
   * A child can be paused: away for a while (family abroad, a long illness) and coming back. They
   * keep their record, their history and their parent link, but while paused they are not billed,
   * not marked absent, and not on any class or activity list. Only an Admin sets this.
   * PauseFrom/PauseTo bound it, so the child comes back on their own date without anyone
   * remembering to flip a switch; a pause with no PauseTo runs until the Admin ends it.
   */
  const PAUSED_STATUS = 'PAUSED';
  /**
   * PauseTo is the day the child COMES BACK, not the last day away. "กลับมาเรียนวันที่ 20/08" means
   * they walk in on the 20th — so the 20th is a school day and check-in must work. It used to keep
   * them paused through the whole of that date and let them back on the 21st, which is a day of the
   * parent tapping a button that refuses them.
   */
  function studentPaused_(s, onDate){ if(!s || String(s.Status)!==PAUSED_STATUS) return false;
    const d=ymd(onDate||todayLocal()), from=ymd(s.PauseFrom||''), to=ymd(s.PauseTo||'');
    if(from && d<from) return false;
    if(to && d>=to) return false;                // the return date IS a school day → back on the roster
    return true; }
  /* ===== A REGULAR DAY OFF IN THE WEEK ==========================================================
   * Asked 2026-08-30: a new child comes four days a week and is away every Wednesday. They are not
   * absent, nobody checks them in, no teacher owes a daily report for them, and they do not appear
   * on Wednesday's lists at all.
   *
   * STORED AS THE DAYS THEY DO NOT COME, not the days they do. The school's own answer, and the
   * safer one: 34 children already come Monday to Friday, so blank means "here every day" and no
   * existing record has to be touched or migrated. Recording attendance days instead would mean
   * filling in Mon–Fri for all 34 first, and any record that was missed would silently turn a child
   * into someone who never comes.
   *
   * Monday–Friday only (1–5). The weekend is already closed for everyone by schoolDayFor_, and
   * letting anyone tick Saturday would create a rule that can never fire — a setting that looks like
   * it does something and does not is worse than no setting.
   *
   * THE SCHOOL'S HOLIDAY WINS. Both mean "not expected today", so they cannot contradict each other
   * on whether the child attends; what differs is the REASON shown, and a school holiday is the one
   * that applies to everybody. Callers ask schoolDayFor_ first — see journalStatus / classList.
   *
   * The field is a list so that "Wednesday and Friday" needs no new code, and so the next family
   * with a different pattern is a data change rather than a release.
   */
  const OFF_DAY_NAMES_TH = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
  const OFF_DAY_NAMES_EN = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  /** The weekday numbers a child is regularly away, cleaned: 1–5 only, unique, sorted. */
  function offDays_(s){
    const raw=(s&&(s.OffDays!=null?s.OffDays:s.offDays));
    if(raw==null||raw==='') return [];
    const out=[];
    String(raw).split(/[,\s]+/).forEach(x=>{ const n=parseInt(x,10);
      // 1..5 only, and never twice — a stray 0/6/7 in the sheet is ignored rather than obeyed
      if(n>=1&&n<=5&&out.indexOf(n)<0) out.push(n); });
    return out.sort();
  }
  /** Is this child regularly away on this date? (Says nothing about school holidays.) */
  function studentOffDay_(s, onDate){
    const days=offDays_(s); if(!days.length) return false;
    const d=new Date(ymd(onDate||todayLocal())+'T00:00:00');
    if(isNaN(d)) return false;
    return days.indexOf(d.getDay())>=0;
  }
  /** 'วันพุธ' / 'วันพุธ, วันศุกร์' — for a screen, never for storage. */
  const offDaysLabel_ = (s,en) => offDays_(s).map(n=>(en?OFF_DAY_NAMES_EN[n]:'วัน'+OFF_DAY_NAMES_TH[n])).join(en?', ':', ');
  /** Not expected at school on this date, for ANY standing reason (paused, or a regular day off). */
  const studentAway_ = (s, onDate) => studentPaused_(s, onDate) || studentOffDay_(s, onDate);

  // Still flagged PAUSED, but the return date has come: back in every list, and the admin is asked to
  // confirm the child really did come back (which clears the pause for good).
  const pauseDue_ = (s, onDate) => !!(s && String(s.Status)===PAUSED_STATUS && ymd(s.PauseTo||'') &&
    ymd(onDate||todayLocal()) >= ymd(s.PauseTo));
  // paused for EVERY day of this month → no bill for it (a partly-paused month is still billed,
  // and the Admin can adjust that bill by hand rather than have the system guess)
  function pausedWholeMonth_(s, month){ if(!s || String(s.Status)!==PAUSED_STATUS) return false;
    const mm=ym(month); const first=mm+'-01';
    const last=mm+'-'+String(new Date(Number(mm.slice(0,4)), Number(mm.slice(5,7)), 0).getDate()).padStart(2,'0');
    const from=ymd(s.PauseFrom||''), to=ymd(s.PauseTo||'');
    if(from && from>first) return false;
    if(to && to<last) return false;
    return true; }
  // everyone still enrolled, INCLUDING the currently paused — the roster the Admin manages
  const enrolledStudents = () => M.students.filter(s=>!INACTIVE[s.Status]);
  // everyone actually attending today: drives attendance, class lists, billing and the dashboard
  /**
   * May this person SEE what an admin sees? Observer may — that is the whole point of the role: the
   * same four whole-school screens, every record openable, nothing changeable.
   *
   * This gate is about visibility. What stops an Observer WRITING is dispatch_ in src/Code.gs, which
   * refuses every mutating action for that role before any handler runs — one gate on the one path
   * every request takes, rather than a rule each of these thirty-five checks would have to repeat.
   */
  const adminLike_ = s => !!s && (s.PositionLevel==='Admin' || s.Role==='Admin' || s.Role==='Observer');
  /**
   * A HEAD TEACHER — Department '*', i.e. over every nursery rather than one of them.
   *
   * The test was written out three times (the attendance correction, the attendance audit, and now
   * the working-time screen) as `String(me.Department||'')==='*'`. Three copies of a permission rule
   * is two chances for one of them to be relaxed on its own.
   */
  const headTeacher_ = s => String((s&&s.Department)||'')==='*';
  /**
   * May this person edit the monthly food menu? An admin, or the teacher the admin ticked
   * "ให้ครูคนนี้จัดการเมนูอาหารรายเดือนได้" (CanFoodMenu) — the kitchen is usually run by one teacher.
   *
   * ONE rule, used by both the screen that shows the button and the handler that accepts the save.
   * They were two rules before, and the two disagreed: the button was never shown, because
   * staffSelf did not return the flag at all.
   */
  function canFoodMenu_(staff){ if(!staff||!staff.StaffID) return false;
    if(adminLike_(staff)) return true;
    const v=staff.CanFoodMenu;
    return v===true||v===1||['YES','TRUE','1'].indexOf(String(v).toUpperCase())>=0; }
  /**
   * Has this person actually started yet?
   *
   * A teacher hired to begin on the 13th exists in the system from the day they are entered, and
   * until now the days in between counted against them: no check-in row meant "absent", which is
   * both wrong and awkward to explain on a first payslip. Before their start date they are simply
   * not part of attendance at all — they cannot check in, and nothing counts them.
   */
  const staffStarted_ = (s, onDate) => { const d=ymd((s&&s.StartDate)||''); return !d || d <= ymd(onDate||todayLocal()); };
  /**
   * Nobody clocks in on a day the school is shut — the SAME rule the screens ask about (schoolDay)
   * and the GAS routes enforce (assertSchoolOpen_ in Checkin.gs). It lives here as well so the two
   * halves cannot drift: an action that ever reaches the engine directly must refuse it too.
   * Big Cleaning is a WORKING day that happens to fall at the weekend.
   */
  /* A BIG CLEANING DAY IS FOR THE STAFF, NOT THE CHILDREN. It is a working Saturday: teachers clock
   * in and are paid, and nobody's child comes to school. Treating it as "open" full stop left the
   * children's drop-off / pick-up buttons live on a day the nursery was shut to them — reported
   * 2026-08-15, a Saturday. `forStudents` is the whole difference, and it is the only difference. */
  const schoolClosedFor_ = (d, forStudents, atTime) => {
    if(!forStudents && isBigCleaning_(d)) return null;         // staff work it
    const hol=(M.holidays||[]).find(h=>ymd(h.Date)===d);
    if(hol){
      // a half-day holiday only refuses DURING its window — the same window schoolDayFor_ reports,
      // so the button a screen offers and the answer the server gives cannot disagree
      const hs=cfgTime_(hol.StartTime,''), he=cfgTime_(hol.EndTime,'');
      if(hs||he){ const now=cfgTime_(atTime, timeLocal());
        const inWindow=(!hs||now>=hs)&&(!he||now<=he);
        if(!inWindow) return null;
        const nm=hol.NameTH||hol.NameEN||hol.Name||'วันหยุด';
        return nm+' '+(hs||'00:00')+'-'+(he||'23:59'); }
      return hol.NameTH||hol.NameEN||hol.Name||'วันหยุด';
    }
    const g=new Date(d+'T00:00:00').getDay();
    if(g===0||g===6) return 'วันหยุดสุดสัปดาห์';
    return null;
  };
  /**
   * `openFrom` — staff only, and only on a day the school REOPENS partway through: clocking in is
   * allowed from that time even though the school is still shut, so a teacher standing at the gate
   * does not have to wait for the minute hand and then be marked late for tapping at 12:01.
   */
  function assertSchoolOpen_(date, forStudents, openFrom){ const d=ymd(date||todayLocal());
    if(!forStudents && openFrom && d===todayLocal() && timeLocal()>=openFrom) return;
    const why=schoolClosedFor_(d, forStudents);
    if(!why) return;
    fail('SCHOOL_CLOSED', forStudents
      ? 'วันนี้โรงเรียนหยุด ('+why+') — ไม่มีการรับ-ส่งนักเรียน'
      : 'วันนี้โรงเรียนหยุด ('+why+') — ไม่ต้องลงเวลา'); }

  /* ---- a closed day that is open to SOME people ------------------------------------------------
   * A teacher comes in on a holiday (OT วันหยุด) and a few children come with her. For those
   * children the day has to behave like any other — check in, check out, the journal, the history,
   * and the late-pickup charge if somebody is collected late — while the school stays shut to
   * everyone else.
   *
   * It is an ALLOWLIST, not a plan. "Who is coming" is the only thing that makes opening a closed
   * day safe: a child nobody expected has nobody responsible for them. A teacher can add a name on
   * the spot when a family turns up, which is a decision someone takes, not a gap someone falls
   * through.
   */
  /**
   * IS THIS DATE A HOLIDAY AT ALL? — a weekend, or a day the school put in HOLIDAYS.
   *
   * OT วันหยุด is payment for coming in on a day off. Recording it against an ordinary Tuesday is
   * not a small mistake: it is a lump sum with no hours behind it, approved on the spot, that
   * bypasses the hourly OT the day should have produced. Nothing stopped it before — the date box
   * accepted any date at all.
   *
   * A HALF-day holiday counts. The school shut for part of it and asked someone to come in anyway,
   * which is exactly the case the payment is for.
   */
  function isHolidayDate_(date){ const d=ymd(date||todayLocal());
    if((M.holidays||[]).some(h=>ymd(h.Date)===d)) return true;
    const g=new Date(d+'T00:00:00').getDay();
    return g===0||g===6; }
  function assertHolidayDate_(date){ const d=ymd(date||'');
    if(!d) fail('BAD_INPUT','ระบุวันที่');
    if(isHolidayDate_(d)) return;
    fail('NOT_A_HOLIDAY','วันที่ '+d+' ไม่ใช่วันหยุด — OT วันหยุดเลือกได้เฉพาะเสาร์-อาทิตย์ หรือวันหยุดที่โรงเรียนกำหนดไว้ · หากเป็นวันทำงานปกติให้ใช้ OT รายชั่วโมงแทน'); }

  const holidayAttend_ = () => (M.holidayAttend = M.holidayAttend || []);
  const holidayAttendIds_ = date => { const d=ymd(date||todayLocal());
    return holidayAttend_().filter(r=>ymd(r.Date)===d).map(r=>String(r.StudentID)); };
  const isHolidayAttendee_ = (sid, date) => holidayAttendIds_(date).indexOf(String(sid))>=0;
  /** Staff who were given OT วันหยุด on this date — the day is a working day for them, and only them. */
  const holidayOTStaff_ = date => { const d=ymd(date||todayLocal());
    return (M.otRecords||[]).filter(r=>isHolidayOT_(r) && ymd(r.Date)===d &&
      String(r.Status||'').toUpperCase()!=='REJECTED').map(r=>String(r.StaffID)); };
  const hasHolidayOT_ = (staffId, date) => holidayOTStaff_(date).indexOf(String(staffId))>=0;
  /**
   * ...and WHO they are, with the money and the reason — plus whether they have clocked in yet.
   *
   * 2026-08-22 (a Saturday): ครูจอย was given OT วันหยุด to look after น้องโมน่า. The server had been
   * taught to open that day for exactly those two — and every SCREEN still asked the day-level
   * question (`closed`) and hid the buttons. The teacher's work-time card printed "วันนี้โรงเรียนหยุด"
   * instead of clock-in, so she filed a คำขอลงเวลา; the children's card printed the same, so the
   * child had to be timed by hand; and no dashboard named either of them, so from the outside the
   * arrangement did not exist. The rule was right and invisible, which is the same as absent.
   */
  const holidayOTStaffInfo_ = date => { const d=ymd(date||todayLocal());
    const today=(d===todayLocal());
    return (M.otRecords||[]).filter(r=>isHolidayOT_(r) && ymd(r.Date)===d &&
        String(r.Status||'').toUpperCase()!=='REJECTED')
      .map(r=>{ const s=staffById(r.StaffID)||{};
        const a=today ? (M.staffAttendanceToday||[]).find(x=>String(x.StaffID)===String(r.StaffID))
                      : (M.staffAttendanceHistory||[]).find(x=>String(x.StaffID)===String(r.StaffID)&&ymd(x.Date)===d);
        return { staffId:String(r.StaffID), nick:s.Nickname||s.NameTH||s.Name||String(r.StaffID),
          nickEN:s.NicknameEN||s.NameEN||'', name:s.NameTH||s.Name||'', dept:s.Department||'',
          amount:Number(r.Amount)||0, note:String(r.Note||''), status:String(r.Status||''),
          checkIn:a?String(a.CheckIn||a.In||''):'', checkOut:a?String(a.CheckOut||a.Out||''):'' }; })
      .sort((x,y)=>String(x.nick).localeCompare(String(y.nick))); };
  /**
   * May this CHILD be checked in or out on this date? The one place that answers it, for the parent's
   * button, the teacher's on-behalf button and the correction form alike.
   */
  function assertStudentDayOpen_(studentId, date){ const d=ymd(date||todayLocal());
    /* NOT STARTED YET. The record exists so the deposit and the first month can be billed, but the
     * child does not come here until EnrollDate — so the button is closed and the refusal names the
     * DAY rather than saying no. Checked before the calendar: "the school is shut today" would be
     * the wrong reason and the wrong date to give somebody. */
    { const s=studentById(studentId);
      if(s && studentNotStarted_(s, d)) fail('NOT_STARTED',
        'วันแรกของการมาเรียนคือ '+ymd(s.EnrollDate)+' — ยังลงเวลาไม่ได้จนกว่าจะถึงวันนั้น'); }
    const why=schoolClosedFor_(d, true);
    if(why){
      if(isHolidayAttendee_(studentId, d)) return;        // expected today, by name
      /* THE SCHOOL'S HOLIDAY IS REPORTED FIRST, as the school asked (2026-08-30): it applies to
       * everybody, and "the school is shut" is the more useful thing to be told. A child's own
       * standing day off is only reached on a day the school is actually open. */
      fail('SCHOOL_CLOSED', 'วันนี้โรงเรียนหยุด ('+why+') — '+
        'นักเรียนคนนี้ไม่ได้อยู่ในรายชื่อที่มาโรงเรียนวันนี้ · หากมาจริง ให้คุณครูเพิ่มชื่อก่อนจึงจะลงเวลาได้');
    }
    /* ...AND THIS CHILD'S OWN REGULAR DAY OFF. The buttons are hidden on that day, so reaching here
     * means a stale screen, a second device, or the teacher's on-behalf button — the same door, so
     * the same answer. A named holiday attendee above still gets through: putting a child on the
     * list for one particular date is a decision about that date, and it beats a standing weekly
     * pattern. */
    { const s2=studentById(studentId);
      if(s2 && studentOffDay_(s2, d)) fail('STUDENT_DAY_OFF',
        'วันนี้เป็นวันหยุดประจำของ '+(s2.Nickname||s2.NameTH||s2.Name||'นักเรียนคนนี้')+
        ' ('+offDaysLabel_(s2)+') — ไม่ต้องลงเวลา และไม่นับเป็นวันขาด'); } }
  /**
   * Has this person's employment ENDED yet?
   *
   * EndDate is a LAST WORKING DAY the admin records in advance, so somebody leaving on the 30th is
   * still on the roster on the 11th — still clocking in, still paid. Reading the date is what
   * retires them, on the day, with nothing scheduled to run and nothing to forget. An explicitly
   * INACTIVE status still counts, so a record ended before this existed keeps behaving.
   */
  const staffEnded_ = (s, onDate) => { if(!s) return false;
    if(String(s.Status||'').toUpperCase()==='INACTIVE') return true;
    // the last WORKING day still counts as working — they are in until the end of it, which is also
    // what the check-in guard says (assertStaffStarted_ refuses only when today > end)
    const d=ymd(s.EndDate||''); return !!d && d < ymd(onDate||todayLocal()); };

  /* ===== STAFF ON TEMPORARY LEAVE (ลาชั่วคราว) ==================================================
   * Asked 2026-09-02: the same thing a child already has, for staff — "ไม่นับเป็นขาด/ลา/มาสาย ...
   * ไม่ต้องนำมาแสดงในข้อมูล Check-in/out โรงเรียน ไม่เอาชื่ออยู่ในการจัดชั้นเรียน".
   *
   * NOT stored as Status like the student version. A student's PAUSED status is read by code that
   * only ever asks "is this child attending"; Status on a staff row is read by staffEnded_, by the
   * login gate, by payroll and by half the reports, and INACTIVE there means "no longer employed".
   * A person on maternity leave is still employed, so the fact lives in its own columns and nothing
   * that already works has to learn a new status value.
   *
   * PauseTo is the day they COME BACK, matching the student rule exactly — the school should not
   * have to remember which end of the range each screen means.
   */
  function staffPaused_(s, onDate){ if(!s) return false;
    const from=ymd(s.PauseFrom||''); if(!from) return false;
    const d=ymd(onDate||todayLocal()), to=ymd(s.PauseTo||'');
    if(d<from) return false;
    if(to && d>=to) return false;              // the return date is a working day again
    return true; }
  // ...still on temporary leave TODAY, and the return date has come — the admin is asked to confirm
  const staffPauseDue_ = (s, onDate) => !!(s && ymd(s.PauseFrom||'') && ymd(s.PauseTo||'') &&
    ymd(onDate||todayLocal()) >= ymd(s.PauseTo));
  /** Was this person on temporary leave for any day of this month? — what the salary rule keys on. */
  function staffPausedInMonth_(s, month){ if(!s || !ymd(s.PauseFrom||'')) return false;
    const mm=ym(month), first=mm+'-01';
    const last=mm+'-'+String(new Date(Number(mm.slice(0,4)), Number(mm.slice(5,7)), 0).getDate()).padStart(2,'0');
    const from=ymd(s.PauseFrom||''), to=ymd(s.PauseTo||'');
    if(from>last) return false;
    if(to && to<=first) return false;
    return true; }
  /* WHAT THEY ARE PAID WHILE AWAY — the admin's decision, never the system's.
   * 'NONE' | 'HALF' | 'CUSTOM' (with PauseSalaryAmount). Anything else, including a blank, means the
   * school has not decided, and an undecided rule must pay the FULL salary rather than quietly
   * paying nothing: a wrong zero on a payslip is the kind of mistake that costs a school its staff.
   */
  function staffPauseSalary_(s, month, fullBase){
    if(!staffPausedInMonth_(s, month)) return null;
    const mode=String(s.PauseSalaryMode||'').toUpperCase();
    if(mode==='NONE')   return {mode:'NONE',   amount:0};
    if(mode==='HALF')   return {mode:'HALF',   amount:Math.round(Number(fullBase||0)/2*100)/100};
    if(mode==='CUSTOM') return {mode:'CUSTOM', amount:Math.max(0, Number(s.PauseSalaryAmount||0))};
    return null;                                // not decided → paid as normal
  }

  /* The parts of an injury report that are not plain scalars, normalised in ONE place so filing
   * (submitInjury) and correcting (editInjury) can never disagree about how they are stored.
   *  · photos → Photo1..3. Sent as data URLs; on GAS Db.gs writes them to Drive and keeps only the
   *    short link, because a photo's base64 is far past a cell's 50,000-char limit.
   *  · wounds / treatmentPlaces → a JSON STRING, never a raw array: an array lands in a sheet cell as
   *    "[object Object]" and the report reads back as nonsense.
   * Only keys the caller actually sent come back, so an edit never blanks a field it didn't touch.
   */
  const injJson_ = v => { if(v==null) return undefined;
    if(typeof v==='string') return v;
    try{ return JSON.stringify(v); }catch(e){ return ''; } };
  const injExtras_ = p => { const o={};
    if(p.shareJournal!==undefined) o.ShareJournal = p.shareJournal ? 'YES' : '';
    if(Array.isArray(p.photos)) for(let i=0;i<3;i++) o['Photo'+(i+1)] = p.photos[i]||'';
    const w=injJson_(p.wounds); if(w!==undefined) o.Wounds=w;
    const tp=injJson_(p.treatmentPlaces); if(tp!==undefined) o.TreatmentPlaces=tp;
    if(p.treatmentType!==undefined) o.TreatmentType=String(p.treatmentType||'');
    if(p.treatmentPlaceOther!==undefined) o.TreatmentPlaceOther=String(p.treatmentPlaceOther||'');
    if(p.treatmentBy!==undefined) o.TreatmentBy=String(p.treatmentBy||'');
    return o; };
  /**
   * A CHILD WHO HAS NOT STARTED YET IS NOT ABSENT — they are not here.
   *
   * A family is entered days or weeks before the first day (EnrollDate) so the deposit and the first
   * month can be billed; that part already worked. But the child was on the class list from the
   * moment the record was typed in — counted against the class's attendance percentage, marked ขาด
   * every morning, and their parent had a live check-in button for a nursery the child does not go
   * to yet. The same treatment as a temporary leave, and for the same reason: they stay on the
   * BILLING lists, and off every list about who is here.
   *
   * Asked 2026-08-24: "หากยังไม่ถึงวันเริ่มเรียนยังไม่เอารายชื่อเข้ามาในระบบ ... มาวันที่ 01/10/26
   * ก็เปิดระบบการใช้งานของผู้ปกครองวันที่ 01/10/26" — so the test is `<`, and the first day itself
   * is a school day.
   */
  const studentNotStarted_ = (s, onDate) => { const d=ymd((s&&s.EnrollDate)||'');
    return !!d && ymd(onDate||todayLocal()) < d; };

  /**
   * WHOSE HANDWRITING IS THIS — a staff member's NICKNAME, resolved on the server.
   *
   * "แสดงชื่อเล่นของคุณครูที่ประเมิน" (2026-08-25). A name has to come from somewhere: the client's
   * staff directory is an ADMIN cache, empty on a teacher's screen and on a parent's, so a nickname
   * looked up there is a nickname that appears for one role and shows a raw id to everyone else.
   * Resolved here, once, next to the record it belongs to.
   *
   * `fallback` is the full name stored on the row itself (DSPM keeps TeacherName). Rows written
   * before ids were recorded have only that, and a full name is a better answer than "STF-011".
   */
  const staffNickOf_ = (id, fallback) => signedBy_(id, fallback).nick;
  /**
   * ...and whether they still work here.
   *
   * A record keeps the name of whoever wrote it for as long as the record exists, which is longer
   * than some people stay. The school asked (2026-08-25) for a teacher who has left to be marked
   * "(ออกแล้ว)" in red rather than quietly dropped: the assessment was still theirs, and somebody
   * reading it needs to know they cannot go and ask them about it.
   *
   * `left` is true when the staff record says so (INACTIVE, or an EndDate that has passed) AND when
   * the id matches nobody at all — a record whose author is not on the staff list is not somebody
   * you can walk down the corridor to.
   */
  function signedBy_(id, fallback){
    if(!id) return {nick:String(fallback||''), left:false, unknown:!fallback};
    const s=staffById(id);
    if(!s || !s.StaffID) return {nick:String(fallback||id), left:true, unknown:true};
    return {nick:(s.Nickname||s.NameTH||s.Name||String(id)), left:staffEnded_(s), unknown:false};
  }

  // ---- growth records: correcting a measurement -------------------------------------------------
  /** One child's measurements, oldest first — the ORDER growthHistory hands out `idx` against. */
  const growthRowsOf_ = sid => (M.growthRecords||[]).filter(r=>String(r.StudentID)===String(sid))
    .sort((a,b)=>(Number(a.AgeMonth)||0)-(Number(b.AgeMonth)||0));
  /**
   * The row the caller means — by POSITION, checked against what they saw.
   *
   * These rows have no id and Date+StudentID is not unique (น้องเบรฟ has three identical 2026-08-14
   * rows, which is the whole reason this exists). So the position is the handle, and the values the
   * caller was looking at are the proof that the list has not moved under them. If somebody else
   * edited it first, the correction is REFUSED rather than landing on whatever is in that slot now —
   * silently rewriting a different measurement is not an acceptable way to fail on a chart a nurse
   * reads.
   */
  function growthFind_(p){
    const rows=growthRowsOf_(p&&p.studentId);
    const i=Number(p&&p.idx);
    if(!isFinite(i)||i<0||i>=rows.length) fail('NOT_FOUND','ไม่พบบันทึกการเจริญเติบโตรายการนี้');
    const row=rows[i];
    const same=(a,b)=>String(a==null?'':a)===String(b==null?'':b);
    if(p.wasDate!=null && !same(ymd(row.Date),ymd(p.wasDate))) fail('CONFLICT','ข้อมูลถูกแก้ไขไปแล้ว — กรุณาเปิดหน้านี้ใหม่แล้วลองอีกครั้ง');
    if(p.wasWeight!=null && Number(row.Weight||0)!==Number(p.wasWeight)) fail('CONFLICT','ข้อมูลถูกแก้ไขไปแล้ว — กรุณาเปิดหน้านี้ใหม่แล้วลองอีกครั้ง');
    if(p.wasHeight!=null && Number(row.Height||0)!==Number(p.wasHeight)) fail('CONFLICT','ข้อมูลถูกแก้ไขไปแล้ว — กรุณาเปิดหน้านี้ใหม่แล้วลองอีกครั้ง');
    return {row, idx:i, rows};
  }
  /** The teacher who recorded it, a head teacher, or an admin — and nobody else. */
  function growthCanEdit_(p, row){
    const role=String((p&&p.role)||'');
    if(role==='Admin') return;
    if(role==='Observer') fail('READ_ONLY','บัญชีนี้ดูได้อย่างเดียว');
    const me=staffById(p&&p.staffId)||{};
    if(!me.StaffID) fail('NO_PERMISSION','เฉพาะคุณครูหรือแอดมิน');
    if(adminLike_(me) || me.PositionLevel==='Leader' || headTeacher_(me)) return;
    /* A row written before RecordedBy existed belongs to NOBODY. A teacher must not be able to claim
     * an old measurement simply by being the one who opened the screen, so those are for a head
     * teacher or an admin to sort out. */
    const owner=String(row&&row.RecordedBy||'');
    if(!owner) fail('NO_PERMISSION','บันทึกนี้ไม่มีชื่อผู้บันทึก — ให้หัวหน้าครูหรือแอดมินเป็นผู้แก้ไข');
    if(owner!==String(me.StaffID)) fail('NO_PERMISSION','แก้ไขได้เฉพาะบันทึกที่ตนเองเป็นผู้บันทึก');
  }
  /**
   * The child's CURRENT weight/height follow their newest measurement.
   *
   * STUDENTS.Weight/Height are a copy of the last row, and deleting or re-dating a measurement can
   * change which row that is — leaving the profile quoting a figure that is no longer in the history
   * behind it. Recomputed from what is actually there, so the two can never disagree. With no rows
   * left the fields are cleared rather than frozen at a number nothing supports.
   */
  function growthSyncLatest_(s){ if(!s||!s.StudentID) return;
    const rows=(M.growthRecords||[]).filter(r=>String(r.StudentID)===String(s.StudentID))
      .sort((a,b)=>String(ymd(a.Date)).localeCompare(String(ymd(b.Date))));
    const last=rows[rows.length-1];
    if(!last){ s.Weight=''; s.Height=''; s.LastGrowthUpdate=''; return; }
    s.Weight=last.Weight; s.Height=last.Height; s.LastGrowthUpdate=ymd(last.Date);
  }
  const activeStudents = () => M.students.filter(s=>!INACTIVE[s.Status] && !studentPaused_(s) && !studentNotStarted_(s));

  // ---- payment-slip helpers (multiple slips per bill/OT/prepay + partial payments) ----
  const paySlips_ = () => (M.paymentSlips = M.paymentSlips || []);
  // A monthly bill covers TUITION ONLY now. Extra charges (STUDENT_CHARGES) and late-pickup OT are each
  // their own payable item (parent can tick/pay them individually) — so they are NOT folded into the bill.
  function billDue_(b){ return Number(b.Amount||0); }
  function chargeOpen_(c){ const st=String(c.Status||'UNPAID').toUpperCase(); return st!=='PAID'&&st!=='CANCELLED'; }
  function slipTarget_(kind, refId){
    if(kind==='bill'){ const b=M.payments.find(x=>x.BillingID===refId); return b?{obj:b, due:billDue_(b), studentId:b.StudentID}:null; }
    if(kind==='ot'){ const o=M.otDaily.find(x=>x.OTID===refId); return o?{obj:o, due:Number(o.Amount||0), studentId:o.StudentID}:null; }
    if(kind==='charge'){ const c=M.studentCharges.find(x=>x.ChargeID===refId); return c?{obj:c, due:Number(c.Amount||0), studentId:c.StudentID}:null; }
    if(kind==='prepay'){ const pp=M.prepayments.find(x=>x.PrepayID===refId); return pp?{obj:pp, due:Number(pp.Amount||0), studentId:pp.StudentID}:null; }
    return null; }
  function sumSlips_(kind, refId, statuses){ return paySlips_().filter(s=>s.RefKind===kind&&s.RefID===refId&&statuses.indexOf(s.Status)>=0).reduce((a,s)=>a+Number(s.Amount||0),0); }
  // append a slip (mock stores the dataURL directly in Url; GAS routes override to save the image to Drive + run SlipOK)
  function recordSlip_(kind, refId, p){ const tgt=slipTarget_(kind, refId); if(!tgt)fail('NOT_FOUND','ไม่พบรายการ');
    const amt=Number(p.slipAmount||0);
    // cash leaves no slip to read, so the day the parent names IS the payment date. It still waits
    // for the school to confirm the money arrived — see payCombinedCash.
    const method=p.method==='cash'?'cash':'transfer';
    paySlips_().push({ SlipID:'SL-'+Date.now()+'-'+Math.floor(Math.random()*10000), RefKind:kind, RefID:refId, StudentID:tgt.studentId,
      Amount:amt, Url:p.slipData||p.slipName||'', FileId:'', Verified:'', TransRef:'', Receiver:'',
      // what the parent says about when they transferred — kept apart from a bank-verified TransDate
      StatedDate:ymd(p.statedDate||''), StatedTime:String(p.statedTime||'').slice(0,5),
      TransDate:method==='cash'?ymd(p.statedDate||''):'', TransTime:'', Method:method,
      SubmittedDate:stampLocal(), Status:'SUBMITTED', SlipGroup:p.slipGroup||'' });
    const submitted=sumSlips_(kind, refId, ['SUBMITTED','CONFIRMED']); const confirmed=sumSlips_(kind, refId, ['CONFIRMED']);
    tgt.obj.Status='PENDING_VERIFY'; tgt.obj.SlipUrl=p.slipData||p.slipName||''; tgt.obj.SlipAmount=submitted; tgt.obj.PaymentMethod=method; tgt.obj.SubmittedDate=todayLocal();
    logAct(method==='cash'?'payCash':'uploadSlip',refId,(method==='cash'?'เงินสด ':'โอน ')+amt,actorOf(p));
    return { ok:true, due:tgt.due, paidSoFar:submitted, outstanding:Math.max(0,tgt.due-confirmed), amountMatch:submitted>=tgt.due }; }
  // after confirm/reject a slip, recompute the target's Status + outstanding
  function recomputeTarget_(kind, refId, paidDate){ const tgt=slipTarget_(kind, refId); if(!tgt)return;
    const confirmed=sumSlips_(kind, refId, ['CONFIRMED']); const submitted=sumSlips_(kind, refId, ['SUBMITTED','CONFIRMED']);
    tgt.obj.SlipAmount=submitted;
    if(confirmed>=tgt.due && tgt.due>0){ tgt.obj.Status='PAID'; tgt.obj.PaidDate=paidDate||tgt.obj.PaidDate||todayLocal(); tgt.obj.VerifiedStatus='CONFIRMED';
      // bill now covers TUITION ONLY — do NOT cascade OT/charges to PAID (each is paid on its own).
      // prepay: do NOT mark the covered months' bills PAID — advance payment covers tuition only. The
      // monthly bills for those months then credit the tuition (see payments handler) and still bill extras.
    } else if(confirmed>0 || submitted>0){ tgt.obj.Status= confirmed>0?'PARTIAL':'PENDING_VERIFY'; }
    else { tgt.obj.Status='UNPAID'; tgt.obj.VerifiedStatus='REJECTED'; }
    return { confirmed, submitted, due:tgt.due, outstanding:Math.max(0,tgt.due-confirmed) }; }

  // latest assessment per item for a student
  function latestByItem(sid){ const map={}; M.assessments.filter(a=>a.StudentID===sid).forEach(a=>{ if(!map[a.ItemNo]||a.Date>=map[a.ItemNo].Date)map[a.ItemNo]=a; }); return map; }
  function summarize(sid){ const s=studentById(sid)||{}; const latest=latestByItem(sid);
    const dom={GM:{pass:0,fail:0},FM:{pass:0,fail:0},RL:{pass:0,fail:0},EL:{pass:0,fail:0},PS:{pass:0,fail:0}}; let tp=0,tf=0;
    Object.values(latest).forEach(r=>{ if(r.Result!=='ผ่าน'&&r.Result!=='ไม่ผ่าน')return;   // 'ยังไม่เข้าโรงเรียน' etc. not counted as pass/fail
      if(dom[r.Skill])dom[r.Skill][r.Result==='ผ่าน'?'pass':'fail']++; r.Result==='ผ่าน'?tp++:tf++; });
    return {studentId:sid,name:s?s.NameTH:sid,nameEN:s?s.NameEN:sid,ageMonth:s?ageMonths(s.DOB):0,byDomain:dom,totalPass:tp,totalFail:tf}; }

  // ---- activity log (who did what) ----
  // append a row to the full activity trail. `by` = {role,id,name} of the actor (best-effort from payload).
  function logAct(action, target, detail, by){ by=by||{};
    M.activityLog.push({ LogID:nextSeqId_(M.activityLog,'LogID','LOG',0), Timestamp:stampLocal(),
      UserRole:by.role||'', UserID:by.id||'', UserName:by.name||'', Action:action, Target:target||'', Detail:detail||'' });
  }
  // mock Drive helpers — in GAS these create real folders/files and return getUrl().
  // per-student folder named after the child under StudentFolderRoot (holds all their docs/photos/assessments).
  function studentFolderUrl(st){ const root=cfg.StudentFolderRoot||'AtomNursery_Students'; const name=(st.NameTH||st.NameEN||st.StudentID||'student').trim();
    return 'drive://'+root+'/'+name.replace(/\s+/g,'_'); }
  // registration ID photo stored in the "New Register Photo" folder (login security)
  function registerPhotoUrl(pid){ const root=cfg.RegisterPhotoFolderName||'New Register Photo'; return 'drive://'+root+'/'+pid+'.jpg'; }

  // resolve the actor from a payload's common id fields (for logging)
  function actorOf(p){ p=p||{};
    // who DID this, for the activity log. A staff row that has since been deleted must still
    // produce a log line naming the id — losing the whole entry would be worse than losing the name.
    if(p.staffId){ const s=staffById(p.staffId)||{}; return {role:s.Role||'Staff',id:p.staffId,name:s.NameTH||p.staffId}; }
    if(p.adminId){ const s=staffById(p.adminId)||{}; return {role:'Admin',id:p.adminId,name:s.NameTH||p.adminId}; }
    if(p.parentId||p.uid){ const pa=M.parents.find(x=>x.ParentID===p.parentId)||{}; return {role:'Parent',id:p.parentId||p.uid,name:pa.NameTH||p.parentId||'ผู้ปกครอง'}; }
    return {role:'',id:'',name:''}; }

  const H = {
    getConfig: () => cfg,
    // full activity log, newest first (Admin)
    activityLog: p => M.activityLog.slice().sort((a,b)=>b.Timestamp.localeCompare(a.Timestamp)).slice(0,(p&&p.limit)||200),

    // ---------- Parent ----------
    // A paused child is STILL returned — the family keeps their record, the menu, the bills and their
    // own details. The flags let the screen drop only the drop-off/pick-up buttons, which would have
    // nothing to record.
    /**
     * The caller's children. Carries TODAY'S LEAVE for each of them.
     *
     * A parent with two children could have one away and one at school, and the away child's
     * drop-off / pick-up buttons stayed live: the server refused the tap (ON_LEAVE), but only after
     * it had been made. The leave is the record of that child's day, and the card should say so
     * instead of offering a button that cannot work — the same rule the teacher's class list uses.
     */
    parentChildren: p => visibleStudents(p).map(s=>Object.assign({ageMonth:ageMonths(s.DOB),
      paused:studentPaused_(s), pauseFrom:ymd(s.PauseFrom||''), pauseTo:ymd(s.PauseTo||''), pauseReason:s.PauseReason||'',
      // ...and a child whose first day has not come yet: the card says the DATE instead of offering a
      // drop-off button the server would refuse (see assertStudentDayOpen_)
      notStarted:studentNotStarted_(s), startDate:ymd(s.EnrollDate||''),
      // ...and a child whose standing arrangement is to be away today. Same reason as the two above:
      // the card says so rather than offering a button the server would only refuse.
      dayOff:studentOffDay_(s), offDays:offDaysLabel_(s), offDaysEN:offDaysLabel_(s,true),
      offDaysRaw:offDays_(s).join(',')},
      studentLeaveToday_(s.StudentID), s)),
    /**
     * THE WHOLE PARENT HOME SCREEN, IN ONE REQUEST.
     *
     * Asked for 2026-08-26 after a parent — who evidently writes software — told the school we were
     * making far too many calls for what they were being shown. They were right.
     *
     * Apps Script runs ONE execution at a time per user, so requests do not overlap, they QUEUE: the
     * count of round trips IS the wait. The home screen cost five of them, and it could not be fixed
     * on the client, because each batch depended on the answer to the one before:
     *
     *   1. parentChildren                      ← everything else needs the child ids
     *   2. journal · announcements · calendar · familyProfile · plans · schoolDay · parentDue
     *      · per-child check-in history · per-child leaves
     *   3. per-child insuranceStatus           ← needed the ids, so it could not join #2
     *   4. openSurveys                         ← issued after #3's await, so its own tick
     *   5. PREFETCH re-asking for several of the same things
     *
     * All of it is one pass over data this server has already hydrated. The client asks once.
     *
     * Every field is produced by the SAME handler the screen used before — this composes them, it
     * does not reimplement them, so the home screen and the screens it links to cannot drift apart.
     * A section that throws must not take the whole home down with it: each is guarded, and anything
     * that fails comes back null exactly as the client's own .catch() used to make it.
     */
    parentHome: p => {
      const soft = (fn, dflt) => { try { return fn(); } catch (e) { return dflt; } };
      const kids = H.parentChildren(p);
      // No children linked yet — the screen shows a card and nothing else, so fetch nothing else.
      if (!kids.length) return { children: [], familyProfile: soft(()=>H.familyProfile(p), {parents:[]}) };
      const ids = kids.map(k => k.StudentID);
      return {
        children: kids,
        // the caller's payload is carried through, not replaced: getJournal decides whether a DRAFT
        // is visible from the ROLE on it, and a parent must never be handed one
        journal:        soft(()=>H.getJournal(Object.assign({}, p, {studentId: ids[0]})), null),
        announcements:  soft(()=>H.announcements(p), []),
        calendar:       soft(()=>H.calendar(p), []),
        familyProfile:  soft(()=>H.familyProfile(p), {parents:[]}),
        plans:          soft(()=>H.getPlans(p), []),
        schoolDay:      soft(()=>H.schoolDay({}), null),
        due:            soft(()=>H.parentDue(p), null),
        // per child, IN THE SAME ORDER as `children` — the screen reads them by index
        checkins:  ids.map(id => soft(()=>H.studentCheckinHistory(Object.assign({}, p, {studentId:id})), [])),
        leaves:    ids.map(id => soft(()=>H.studentLeaves(Object.assign({}, p, {studentId:id})), [])),
        insurance: ids.map(id => soft(()=>H.insuranceStatus(Object.assign({}, p, {studentId:id})), {filled:false})),
        surveys:        soft(()=>H.openSurveys(p), [])
      }; },
    /**
     * What this family still owes, in ONE call — so the home screen can say it without fanning out
     * three requests per child. A parent should not have to open the payment screen to find out
     * whether they owe anything; the answer belongs where they already are.
     *
     * It reads through the SAME handlers the payment screen uses (payments / studentCharges /
     * otDaily), so the figure here and the figure there cannot disagree.
     */
    parentDue: p => { const children=[]; let total=0;
      visibleStudents(p).forEach(s=>{ const sid=s.StudentID; let due=0, n=0;
        (H.payments({studentId:sid})||[]).forEach(b=>{
          const o=Number(b.Outstanding!=null?b.Outstanding:(b.TotalDue!=null?b.TotalDue:b.Amount))||0;
          if(b.Status!=='PAID' && b.VerifiedStatus!=='PREPAID' && o>0){ due+=o; n++; } });
        (H.studentCharges({studentId:sid})||[]).forEach(c=>{
          const o=Number(c.Outstanding!=null?c.Outstanding:c.Amount)||0;
          if(c.Status!=='PAID' && o>0){ due+=o; n++; } });
        (H.otDaily({studentId:sid})||[]).forEach(o2=>{ const a=Number(o2.Amount||0);
          if(o2.Status!=='PAID' && o2.Status!=='PENDING_VERIFY' && o2.Status!=='PARTIAL' && a>0){ due+=a; n++; } });
        total+=due;
        if(due>0) children.push({studentId:sid, nick:s.Nickname||'', name:s.NameTH||s.Name||'',
          due:Math.round(due*100)/100, count:n}); });
      return { total:Math.round(total*100)/100, children, count:children.reduce((a,c)=>a+c.count,0) }; },
    getPlans: () => cfg.Plans||[],
    // Admin package (Plan) CRUD: the client sends the FULL plans array (add/edit/delete applied client-side).
    // Each plan: {id, labelTH, labelEN, price, start:'HH:MM', end:'HH:MM'}. On GAS a route persists the JSON
    // to SCHOOL_CONFIG (in-place); in mock this just replaces cfg.Plans in memory.
    savePlans: p => { const arr=Array.isArray(p.plans)?p.plans:[];
      arr.forEach(pl=>{ if(!pl.id) pl.id='pkg_'+Math.random().toString(36).slice(2,8); pl.price=Number(pl.price||0); });
      cfg.Plans=arr; return {ok:true, plans:cfg.Plans}; },
    // QR-code MASTER: a list of bank QR images the school collects into different accounts. A plan can be
    // bound to one (plan.qrId) and OT to another (OTQRId), so tuition vs OT go to separate bank accounts.
    getQRCodes: () => ({ qrs: cfg.QRCodes||[], otQrId: cfg.OTQRId||'' }),
    saveQRCodes: p => { const arr=Array.isArray(p.qrs)?p.qrs:[]; arr.forEach(q=>{ if(!q.id) q.id='qr_'+Math.random().toString(36).slice(2,8); });
      cfg.QRCodes=arr; if(p.otQrId!==undefined) cfg.OTQRId=String(p.otQrId||''); return {ok:true, qrs:cfg.QRCodes, otQrId:cfg.OTQRId||''}; },
    parentCheckin: p => {
      // A child on temporary leave has no attendance to record; the buttons are hidden, and this
      // makes sure a stale screen (or a second device) cannot slip one through anyway.
      { const _s=studentById(p.studentId); if(_s && studentPaused_(_s))
          fail('STUDENT_PAUSED','นักเรียนอยู่ระหว่างลาชั่วคราว — ยังไม่ถึงกำหนดเข้าเรียน'); }
      // a regular day off is checked in assertStudentDayOpen_ below — the ONE gate both the parent's
      // button and the teacher's on-behalf button go through, so neither can drift from the other
      // told us they are away today → the leave IS the record. The GAS route has refused this for a
      // while (ON_LEAVE); the engine did not, so mock and live disagreed about the same tap.
      { const _lv=studentLeaveToday_(p.studentId);
        if(_lv.onLeave) fail('ON_LEAVE','นักเรียนแจ้งลาวันนี้แล้ว ('+_lv.leaveType+(_lv.leaveReason?' · '+_lv.leaveReason:'')+') — หากมาจริงให้ยกเลิกใบลาก่อน'); }
      // a Big Cleaning day is a working day for STAFF, not for children — and a holiday is open to
      // the children who were named for it (assertStudentDayOpen_)
      assertStudentDayOpen_(p.studentId);
      // OUT is fenced — unless this child is the named exception (studentGeoExempt_), in which case
      // the distance is still measured and stored, just not used to refuse.
      const _out=String(p.type||'IN').toUpperCase()==='OUT';
      const d=(_out && !studentGeoExempt_(p.studentId)) ? geo(p.lat,p.lng,p.acc) : geoSafe(p.lat,p.lng); const t=timeLocal();
      // de-dup a rapid repeat (same student+type today within CheckinDedupMinutes) → keep only the latest time
      const win=Number(cfg.CheckinDedupMinutes||10); const nowMin=toMin(t);
      const recent=(M.checkinStudent||[]).find(r=>r.StudentID===p.studentId&&String(r.Type).toUpperCase()===String(p.type).toUpperCase()&&ymd(r.Date)===todayLocal()&&Math.abs(nowMin-toMin(r.Time))<=win);
      if(recent){ recent.Time=t; const ex0=M.studentAttendanceToday.find(x=>x.StudentID===p.studentId); if(ex0)ex0.Time=t; return {studentId:p.studentId,type:p.type,time:t,distance:d,duplicate:true}; }
      M.checkinStudent.push({Date:todayLocal(),Time:t,StudentID:p.studentId,ParentID:p.parentId,Type:p.type,Status:'OK'});
      const ex=M.studentAttendanceToday.find(x=>x.StudentID===p.studentId); if(ex){ex.Status=p.type;ex.Time=t;} else M.studentAttendanceToday.push({StudentID:p.studentId,Status:p.type,Time:t});
      let h=M.studentCheckins.find(c=>c.StudentID===p.studentId&&c.Date===todayLocal()); if(!h){h={Date:todayLocal(),StudentID:p.studentId,InTime:'',OutTime:''};M.studentCheckins.push(h);} if(p.type==='IN')h.InTime=t; else h.OutTime=t;
      // one rule for the charge — see otReconcile_
      const ot = p.type==='OUT' ? otReconcile_(studentById(p.studentId)||{StudentID:p.studentId}, todayLocal(), t) : null;
      return {type:p.type,time:t,distance:d,ot}; },

    // Teacher/Leader checks a student in/out on behalf of a pickup person who isn't a registered
    // parent. A Remark (who dropped off / picked up) is MANDATORY. No geofence (staff are at school).
    staffStudentCheckin: p => { const remark=String(p.remark||'').trim();
      if(!remark) fail('REMARK_REQUIRED','ต้องระบุหมายเหตุ (ใครมารับ-ส่ง) ก่อนบันทึก');
      const st=studentById(p.studentId); if(!st) fail('NOT_FOUND','ไม่พบนักเรียน');
      const type=String(p.type||'').toUpperCase(); if(type!=='IN'&&type!=='OUT') fail('BAD_INPUT','ระบุ IN หรือ OUT');
      // the same door as the parent's button. This path never had the check at all — a teacher could
      // record a child on any closed day — and now that a closed day CAN be open to some children,
      // "who is expected today" has to be asked here too.
      assertStudentDayOpen_(st.StudentID, p.date);
      // The parent already told us the child is away today. Recording an arrival would contradict
      // the leave and quietly make the attendance figures wrong, so refuse and say why.
      { const d=ymd(p.date||todayLocal());
        const lv=(M.studentLeaves||[]).find(l=>l.StudentID===p.studentId&&ymd(l.Date)===d);
        if(lv) fail('ON_LEAVE','นักเรียนแจ้งลาวันนี้แล้ว ('+(lv.Type||'ลา')+(lv.Reason?' · '+lv.Reason:'')+') — หากมาจริงให้ยกเลิกใบลาก่อน'); }
      // the teacher must record the ACTUAL drop-off / pick-up time (a child picked up at 12:57 must NOT
      // read 17:26 and wrongly trigger OT). Accept an override HH:mm; blank → now.
      const t=/^\d{1,2}:\d{2}$/.test(String(p.time||'').trim()) ? String(p.time).trim() : timeLocal();
      // if a same-type record exists today, UPDATE its time (correct it) instead of blocking — a teacher
      // can fix a wrong pickup time and can always check a present child OUT.
      const prev=M.checkinStudent.find(c=>c.StudentID===st.StudentID&&ymd(c.Date)===todayLocal()&&String(c.Type).toUpperCase()===type);
      if(prev){ prev.Time=t; prev.Remark=remark; prev.ByStaffID=p.staffId||''; }
      else M.checkinStudent.push({Date:todayLocal(),Time:t,StudentID:st.StudentID,ParentID:st.ParentID||'',Type:type,Status:'OK',Remark:remark,ByStaffID:p.staffId||''});
      const ex=M.studentAttendanceToday.find(x=>x.StudentID===st.StudentID); if(ex){ex.Status=type;ex.Time=t;} else M.studentAttendanceToday.push({StudentID:st.StudentID,Status:type,Time:t});
      let h=M.studentCheckins.find(c=>c.StudentID===st.StudentID&&c.Date===todayLocal()); if(!h){h={Date:todayLocal(),StudentID:st.StudentID,InTime:'',OutTime:''};M.studentCheckins.push(h);} if(type==='IN')h.InTime=t; else h.OutTime=t;
      // The charge follows the time the TEACHER entered, not the moment they tapped — and a corrected
      // time that owes nothing cancels the charge the old one made. See otReconcile_.
      const ot = type==='OUT' ? otReconcile_(st, todayLocal(), t) : null;
      logAct('staffStudentCheckin',st.StudentID,type+' @'+t+' — '+remark,actorOf(p));
      return {studentId:st.StudentID,type,time:t,remark,ot}; },
    // Correct a wrong check-in / pick-up — a parent tapping "picked up" mid-morning by mistake used to be
    // permanent, and it also raised an OT charge. Clearing the OUT time puts the child back to "at
    // school" and removes any OT that pick-up created. Scope: a teacher may only touch the classes they
    // cover; a head teacher (Department '*') and Admin may touch anyone.
    editStudentAttendance: p => {
      const st=studentById(p.studentId); if(!st) fail('NOT_FOUND','ไม่พบนักเรียน');
      if(String(p.role||'')!=='Admin'){
        const me=staffById(p.staffId)||{};
        const all=headTeacher_(me);
        const cov=(coveredClasses_(me)||[]).map(c=>c.ClassName);
        if(!all && cov.indexOf(st.Class)<0) fail('NO_ACCESS','แก้ไขได้เฉพาะนักเรียนในชั้นที่ดูแล');
      }
      const date=ymd(p.date||todayLocal());
      const hhmm=v=>{ const t=String(v==null?'':v).trim(); return /^\d{1,2}:\d{2}$/.test(t)?t:''; };
      const inT=p.checkIn!=null?hhmm(p.checkIn):null, outT=p.checkOut!=null?hhmm(p.checkOut):null;
      const remark=String(p.remark||'').trim()||'แก้ไขโดยเจ้าหน้าที่';
      const put=(type,t)=>{ const i=M.checkinStudent.findIndex(c=>c.StudentID===st.StudentID&&ymd(c.Date)===date&&String(c.Type).toUpperCase()===type);
        if(!t){ if(i>=0) M.checkinStudent.splice(i,1); return; }
        if(i>=0){ M.checkinStudent[i].Time=t; M.checkinStudent[i].Remark=remark; M.checkinStudent[i].ByStaffID=p.staffId||''; }
        else M.checkinStudent.push({Date:date,Time:t,StudentID:st.StudentID,ParentID:st.ParentID||'',Type:type,Status:'OK',Remark:remark,ByStaffID:p.staffId||''}); };
      if(inT!==null) put('IN',inT);
      if(outT!==null) put('OUT',outT);
      // the day's roll-up the app reads everywhere
      let h=M.studentCheckins.find(c=>c.StudentID===st.StudentID&&ymd(c.Date)===date);
      if(!h){ h={Date:date,StudentID:st.StudentID,InTime:'',OutTime:''}; M.studentCheckins.push(h); }
      if(inT!==null) h.InTime=inT; if(outT!==null) h.OutTime=outT;
      if(date===todayLocal()){
        const status=(outT!==null?outT:h.OutTime)?'OUT':((inT!==null?inT:h.InTime)?'IN':'ABSENT');
        const time=status==='OUT'?h.OutTime:h.InTime;
        const ex=M.studentAttendanceToday.find(x=>x.StudentID===st.StudentID);
        if(status==='ABSENT'){ if(ex){ ex.Status='ABSENT'; ex.Time=''; } }
        else if(ex){ ex.Status=status; ex.Time=time; } else M.studentAttendanceToday.push({StudentID:st.StudentID,Status:status,Time:time});
      }
      /* OT follows the pick-up time — and a charge that no longer applies is CANCELLED, not deleted.
       *
       * This used to splice the row out of existence, while the Apps Script path (otUpsertForPickup_,
       * which the teacher's on-behalf button uses) left the old charge standing untouched. Two ways to
       * correct the same pick-up, two different answers about money — and the one that ran live is
       * how ธันวา was billed 2 hours against 18:09 after a teacher had recorded 16:40.
       *
       * Both now do the same thing, and keep the row: a correction that removes a charge is something
       * the school should be able to SEE afterwards, not something that leaves no trace. */
      const ot = (outT!==null) ? otReconcile_(st, date, outT) : null;
      logAct('editStudentAttendance',st.StudentID,date+' เข้า '+(h.InTime||'-')+' ออก '+(h.OutTime||'-')+' — '+remark,actorOf(p));
      return {studentId:st.StudentID,date,checkIn:h.InTime||'',checkOut:h.OutTime||'',ot}; },
    /**
     * WHO IS STILL UNACCOUNTED FOR — one day, every child, and what is missing.
     *
     * A pick-up that nobody tapped is not a small thing: the child is left showing "at school"
     * forever, the day's attendance is wrong, and the late-pickup OT that the family owes is never
     * raised. The app knew this per child, on the class screen, one at a time; nobody could see the
     * whole day at once, which is exactly the view you need to close it out at 18:00.
     *
     * A missing OUT is left OPEN on purpose — the system must NOT invent a going-home time. A teacher
     * or head teacher enters the real one (editStudentAttendance), and the OT is then charged from
     * that time like any other pick-up: dropped off 07:50, entered as 18:40 → 1 hour of OT.
     *
     * Scope is the same rule as everywhere else: Admin (and a head teacher, Department '*') sees the
     * school; a teacher sees the classes they cover — the same classes they are allowed to correct.
     */
    attendanceAudit: p => {
      const date=ymd(p.date||todayLocal());
      const day=schoolDayFor_(date);
      const isAdmin=String(p.role||'')==='Admin'||String(p.role||'')==='Observer';
      const me=staffById(p.staffId)||{};
      const all=isAdmin || headTeacher_(me);
      const cov=all?null:(coveredClasses_(me)||[]).map(c=>c.ClassName);
      const rows=activeStudents()
        // studentAway_ = paused OR a regular day off. This screen chases missing check-outs, and a
        // child who was never expected today cannot have one.
        .filter(s=>!studentAway_(s,date))
        .filter(s=>all || cov.indexOf(s.Class)>=0)
        .filter(s=>!p.className || s.Class===p.className)
        .map(s=>{
          const h=(M.studentCheckins||[]).find(c=>String(c.StudentID)===String(s.StudentID)&&ymd(c.Date)===date)||{};
          const inT=String(h.InTime||'').slice(0,5), outT=String(h.OutTime||'').slice(0,5);
          const lv=studentLeaveToday_(s.StudentID, date);
          // a leave answers for the day: a child the family told us about is not "missing"
          const status = lv.onLeave ? 'LEAVE' : (inT&&outT) ? 'DONE' : inT ? 'OPEN' : 'NONE';
          const ot=(M.otDaily||[]).find(o=>String(o.StudentID)===String(s.StudentID)&&ymd(o.Date)===date)||null;
          return { studentId:s.StudentID, nick:s.Nickname, nickEN:s.NicknameEN, name:s.NameTH, nameEN:s.NameEN,
            class:s.Class, photo:s.PhotoURL||'', status, inTime:inT, outTime:outT,
            planEnd:otThreshold(s), leaveType:lv.leaveType, leaveReason:lv.leaveReason,
            otAmount:ot?Number(ot.Amount||0):0, otLate:ot?Number(ot.LateMinutes||0):0, otStatus:ot?String(ot.Status||''):'' }; })
        .sort((a,b)=>String(a.class).localeCompare(String(b.class))||String(a.nick||a.name).localeCompare(String(b.nick||b.name)));
      const n=st=>rows.filter(r=>r.status===st).length;
      return { date, scope:all?'school':'myClasses', canEdit:!!(isAdmin||p.staffId),
        closed:!!day.closedForStudents, closedAllDay:!!day.closedAllDay, holiday:day.partial?{start:day.holStart,end:day.holEnd}:null,
        classes:[...new Set(rows.map(r=>r.class))],
        counts:{ total:rows.length, done:n('DONE'), open:n('OPEN'), none:n('NONE'), leave:n('LEAVE') },
        rows }; },

    // Admin audit: every on-behalf student check-in/out (who recorded it, the time entered, the reason,
    // and whether it produced an OT charge) — so a disputed pick-up time can be verified.
    staffCheckinLog: p => { const days=Number(p.days||14); const cutoff=(()=>{ const d=new Date(); d.setDate(d.getDate()-days); return ymd(d.toISOString?d.toISOString():d); })();
      const nameStaff=id=>{ const s=staffById(id)||{}; return s.Nickname||s.NameTH||id||''; };
      return (M.checkinStudent||[]).filter(r=>r.ByStaffID&&ymd(r.Date)>=cutoff).map(r=>{ const st=studentById(r.StudentID)||{};
          const otId='OT-'+ymd(r.Date).replace(/-/g,'')+'-'+r.StudentID; const ot=r.Type==='OUT'?(M.otDaily.find(o=>o.OTID===otId)||null):null;
          return {date:ymd(r.Date),time:r.Time,type:r.Type,studentId:r.StudentID,nick:st.Nickname,nickEN:st.NicknameEN,name:st.NameTH,
            byStaff:nameStaff(r.ByStaffID),byStaffId:r.ByStaffID,remark:r.Remark||'',otAmount:ot?ot.Amount:0,planEnd:ot?ot.PlanEnd:''}; })
        .sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time)); },
    // a DRAFT is visible to staff only — the parent sees nothing until the teacher submits.
    // `role` is overwritten from the session token on GAS, so a parent client cannot forge it.
    getJournal: p => { const r=M.journals.find(x=>x.StudentID===p.studentId && ymd(x.Date)===(p.date||todayLocal()));
      return (!r || (jStatus_(r)==='DRAFT' && !staffViewer_(p))) ? null : r; },
    journalHistory: p => M.journals.filter(x=>x.StudentID===p.studentId && (jStatus_(x)==='SUBMITTED' || staffViewer_(p)))
      .sort((a,b)=>ymd(b.Date).localeCompare(ymd(a.Date))).slice(0,p.limit||14),
    // Parent adds/updates their comment on a submitted daily report (does not touch teacher fields)
    saveParentComment: p => { const date=p.date||todayLocal();
      const j=M.journals.find(x=>x.StudentID===p.studentId&&ymd(x.Date)===date); if(!j)fail('NOT_FOUND','ยังไม่มีบันทึกของวันนี้');
      j.ParentComment=String(p.comment||''); return {ok:true,studentId:p.studentId,date}; },
    // Teacher replies to the parent's comment on a daily report (does not touch the parent's comment)
    saveTeacherReply: p => { const date=p.date||todayLocal();
      const j=M.journals.find(x=>x.StudentID===p.studentId&&ymd(x.Date)===date); if(!j)fail('NOT_FOUND','ยังไม่มีบันทึกของวันนี้');
      j.TeacherReply=String(p.reply||''); return {ok:true,studentId:p.studentId,date}; },
    // which students already have a journal for `date`, and whether it is a DRAFT or SUBMITTED —
    // feeds the teacher's badge. Read-only, so it runs through the engine on GAS too (no route needed).
    journalStatus: p => { const date=p.date||todayLocal();
      const only = Array.isArray(p.studentIds)&&p.studentIds.length ? p.studentIds.map(String) : null;
      return { date, done: M.journals.filter(x=>ymd(x.Date)===date && (!only||only.indexOf(String(x.StudentID))>=0))
        .map(x=>({studentId:x.StudentID, teacherId:x.TeacherID, status:jStatus_(x),
                  submittedAt:x.SubmittedAt||'', updatedAt:x.UpdatedAt||''})) }; },
    // idempotent: a re-submit for the same student+date returns the existing leave, no duplicate
    studentAbsence: p => { const dup=(M.studentLeaves||[]).find(l=>l.StudentID===p.studentId&&ymd(l.Date)===ymd(p.date)); if(dup) return {leaveId:dup.LeaveID,teacherNotified:false,duplicate:true};
      const id=nextSeqId_(M.studentLeaves,'LeaveID','LVS',4); M.studentLeaves.push({LeaveID:id,StudentID:p.studentId,Date:p.date,Reason:p.reason,Type:p.type||'',Status:'Notified'}); return {leaveId:id,teacherNotified:true}; },
    /**
     * A PARENT CORRECTS OR WITHDRAWS THEIR OWN NOTICE.
     *
     * Filing a leave was one-way: a family who wrote the wrong date, picked the wrong child, or
     * whose plans changed had to ring the school and ask someone to go and fix a spreadsheet. Asked
     * 2026-08-29.
     *
     * TWO LIMITS, and both of them matter more than the convenience does:
     *
     *  1. TODAY OR LATER, NEVER THE PAST. A leave for a day that has already happened is not a plan
     *     any more, it is the ATTENDANCE RECORD of a day the school taught — the register, the
     *     absence count, and the teacher's own account of who was there. Letting it be rewritten
     *     afterwards would let a family quietly change history. A past date needs the school.
     *
     *  2. ONLY WHAT THE FAMILY THEMSELVES FILED. A leave a TEACHER entered (FiledBy) is the school
     *     saying a child was not here; that is the school's record to correct, not the family's.
     *
     * Both refusals name the reason, because "ไม่สามารถแก้ไขได้" tells nobody what to do next.
     */
    parentEditLeave: p => { const l=(M.studentLeaves||[]).find(x=>String(x.LeaveID)===String(p.leaveId));
      if(!l) fail('NOT_FOUND','ไม่พบใบลานี้');
      if(String(l.StudentID)!==String(p.studentId)) fail('NO_ACCESS','ใบลานี้ไม่ใช่ของบุตรหลานท่าน');
      if(String(l.FiledBy||'').trim()) fail('FILED_BY_SCHOOL','ใบลานี้คุณครูเป็นผู้บันทึก — กรุณาติดต่อโรงเรียนเพื่อแก้ไข');
      if(ymd(l.Date) < todayLocal()) fail('LEAVE_PAST','ใบลาของวันที่ผ่านมาแล้วแก้ไขไม่ได้ — เป็นบันทึกการมาเรียนของวันนั้น · กรุณาติดต่อโรงเรียน');
      // ...and it may not be MOVED into the past either, for the same reason
      if(p.date!=null && ymd(p.date) < todayLocal()) fail('LEAVE_PAST','เลือกวันที่ย้อนหลังไม่ได้ — กรุณาเลือกวันนี้หรือวันถัดไป');
      // moving it onto a day this child already has a leave for would make two rows for one day
      if(p.date!=null && ymd(p.date)!==ymd(l.Date)){
        const clash=(M.studentLeaves||[]).find(x=>String(x.StudentID)===String(l.StudentID)&&ymd(x.Date)===ymd(p.date)&&String(x.LeaveID)!==String(l.LeaveID));
        if(clash) fail('DUPLICATE','วันที่นี้แจ้งลาไว้แล้ว'); }
      if(p.date!=null) l.Date=ymd(p.date); if(p.reason!=null) l.Reason=p.reason; if(p.type!=null) l.Type=p.type;
      logAct('parentEditLeave',l.LeaveID,ymd(l.Date),actorOf(p));
      return {ok:true, leaveId:l.LeaveID}; },
    parentCancelLeave: p => { const i=(M.studentLeaves||[]).findIndex(x=>String(x.LeaveID)===String(p.leaveId));
      if(i<0) fail('NOT_FOUND','ไม่พบใบลานี้');
      const l=M.studentLeaves[i];
      if(String(l.StudentID)!==String(p.studentId)) fail('NO_ACCESS','ใบลานี้ไม่ใช่ของบุตรหลานท่าน');
      if(String(l.FiledBy||'').trim()) fail('FILED_BY_SCHOOL','ใบลานี้คุณครูเป็นผู้บันทึก — กรุณาติดต่อโรงเรียนเพื่อยกเลิก');
      if(ymd(l.Date) < todayLocal()) fail('LEAVE_PAST','ใบลาของวันที่ผ่านมาแล้วยกเลิกไม่ได้ — เป็นบันทึกการมาเรียนของวันนั้น · กรุณาติดต่อโรงเรียน');
      M.studentLeaves.splice(i,1);
      logAct('parentCancelLeave',l.LeaveID,ymd(l.Date),actorOf(p));
      return {ok:true}; },
    // Teacher files a leave for a student (notifies the linked parents). Shows in that student's parent calendar only.
    teacherStudentLeave: p => { const dup=(M.studentLeaves||[]).find(l=>l.StudentID===p.studentId&&ymd(l.Date)===ymd(p.date)); if(dup) return {leaveId:dup.LeaveID,parentNotified:false,duplicate:true};
      const id=nextSeqId_(M.studentLeaves,'LeaveID','LVS',4);
      M.studentLeaves.push({LeaveID:id,StudentID:p.studentId,Date:p.date,Reason:p.reason||'',Type:p.type||'',Status:'Notified',FiledBy:p.staffId}); return {leaveId:id,parentNotified:true}; },
    // ---- Admin: manage student leaves (list all / edit / delete). On GAS the mutations are in-place ROUTES. ----
    allStudentLeaves: p => (M.studentLeaves||[]).slice().sort((a,b)=>String(b.Date).localeCompare(String(a.Date))).map(l=>{ const s=studentById(l.StudentID)||{};
      return Object.assign({},l,{name:s.NameTH||s.Name,nameEN:s.NameEN,nick:s.Nickname,class:s.Class}); }),
    editStudentLeave: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const l=(M.studentLeaves||[]).find(x=>x.LeaveID===p.leaveId); if(!l)fail('NOT_FOUND','ไม่พบการลา');
      if(p.date!=null)l.Date=p.date; if(p.reason!=null)l.Reason=p.reason; if(p.type!=null)l.Type=p.type; return {ok:true,leaveId:l.LeaveID}; },
    deleteStudentLeave: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const i=(M.studentLeaves||[]).findIndex(x=>x.LeaveID===p.leaveId); if(i<0)fail('NOT_FOUND','ไม่พบการลา'); M.studentLeaves.splice(i,1); return {ok:true}; },
    // batch delete (admin ticks several leaves → one call)
    deleteStudentLeaves: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const ids=new Set((p.leaveIds||[]).map(String)); let n=0;
      for(let i=(M.studentLeaves||[]).length-1;i>=0;i--){ if(ids.has(String(M.studentLeaves[i].LeaveID))){ M.studentLeaves.splice(i,1); n++; } }
      return {ok:true,deleted:n}; },
    studentLeaves: p => M.studentLeaves.filter(l=>l.StudentID===p.studentId).sort((a,b)=>b.Date.localeCompare(a.Date)),
    comments: p => M.comments.filter(c=>c.StudentID===p.studentId),
    addComment: p => { const c={CommentID:nextSeqId_(M.comments,'CommentID','CM',0),StudentID:p.studentId,ParentID:p.parentId||'',SenderRole:p.senderRole,SenderName:p.senderName||'',Message:p.message,Timestamp:stampLocal(),ReadStatus:'unread'}; M.comments.push(c); return c; },
    // monthly bill = TUITION ONLY. Extra charges + late-pickup OT are separate payable items (see
    // studentCharges / otDaily) so the parent can tick and pay them individually.
    payments: p => M.payments.filter(b=>b.StudentID===p.studentId).map(b=>{
        const bm=ym(b.Month);
        // Items may be absent (sheet has no Items column) or a JSON string — normalise to an array, default to one tuition line
        let base = Array.isArray(b.Items) ? b.Items : (typeof b.Items==='string' && b.Items ? (()=>{try{return JSON.parse(b.Items)}catch(e){return null}})() : null);
        if(!Array.isArray(base)) base = [['ค่าเทอม', b.Amount||0]];
        const total=Number(b.Amount||0);   // tuition only
        // partial-payment view: sum of confirmed slips vs submitted-but-pending
        const confirmed=sumSlips_('bill', b.BillingID, ['CONFIRMED']); const submitted=sumSlips_('bill', b.BillingID, ['SUBMITTED']);
        // advance payment covers this month's TUITION in full → credit it (extras are still billed)
        const prepay = prepayInfo_(p.studentId, bm);
        const prepaidTuition = prepay ? billTuition_(b) : 0;
        const items2 = prepaidTuition>0 ? base.concat([['ค่าเทอม (ชำระล่วงหน้าแล้ว)', -prepaidTuition]]) : base;
        const net = Math.max(0, total - prepaidTuition);              // due after the tuition credit
        const outstanding = Math.max(0, net - confirmed);
        let st = b.Status;
        if((net>0 && outstanding===0) || (net===0 && prepaidTuition>0)) st='PAID';
        else if(confirmed>0) st='PARTIAL';
        // receipt "ชำระ" date = the slip's ACTUAL transfer date (SlipOK transDate) when we have it
        const paidSlip=paySlips_().find(s=>s.RefKind==='bill'&&s.RefID===b.BillingID&&s.Status==='CONFIRMED'&&s.TransDate);
        const paidDate=(paidSlip&&paidSlip.TransDate)||b.PaidDate||'';
        return Object.assign({},b,{Month:bm,Items:items2,Amount:total,OTRollover:0,TotalDue:net,GrossDue:total,Status:st,PaidDate:paidDate,
          PrepaidTuition:prepaidTuition,Prepay:prepay,PaidConfirmed:confirmed,PendingSubmitted:submitted,Outstanding:outstanding}); })
      .sort((a,b)=>String(b.Month).localeCompare(String(a.Month))),
    // per-student extra charges (Admin) — each is its own payable item (parent pays like OT).
    studentCharges: p => M.studentCharges.filter(c=>c.StudentID===p.studentId && (!p.month||ym(c.Month)===ym(p.month)))
      .map(c=>{ const confirmed=sumSlips_('charge',c.ChargeID,['CONFIRMED']); const submitted=sumSlips_('charge',c.ChargeID,['SUBMITTED']);
        const amt=Number(c.Amount||0); let st=c.Status||'UNPAID'; if(confirmed>=amt&&amt>0)st='PAID'; else if(confirmed>0)st='PARTIAL'; else if(submitted>0)st='PENDING_VERIFY';
        return Object.assign({},c,{Amount:amt,Status:st,PaidConfirmed:confirmed,PendingSubmitted:submitted,Outstanding:Math.max(0,amt-confirmed)}); }),
    addStudentCharge: p => { const c={ChargeID:nextSeqId_(M.studentCharges,'ChargeID','CH',0),StudentID:p.studentId,Month:p.month||todayLocal().slice(0,7),Label:p.label,Amount:Number(p.amount||0),Status:'UNPAID'}; M.studentCharges.push(c); return c; },
    removeStudentCharge: p => { const i=M.studentCharges.findIndex(c=>c.ChargeID===p.chargeId); if(i>=0)M.studentCharges.splice(i,1); return {ok:true}; },
    // parent pays a single extra charge (SCB QR + attach slip), like payOT
    payCharge: p => recordSlip_('charge', p.chargeId, p),

    // ---- billing generation (Admin) ----
    // monthly tuition base for a student (from their Plan)
    studentBillBase: p => { const s=studentById(p.studentId)||{}; const plan=studentPlan(s); return {planId:plan.id,labelTH:plan.labelTH||'',labelEN:plan.labelEN||'',price:plan.price||0}; },
    // Admin issues a bill for one student (custom amount → mid-month proration / ad-hoc). Parent sees it; pays + Admin verifies.
    // Admin issues a bill for one student. Pass paid:true to record it as ALREADY PAID (e.g. collected in advance
    // for a future month → that month shows "ชำระแล้ว"); paidDate/method optional, defaults today/cash.
    issueBill: p => { const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน'); const month=p.month||todayLocal().slice(0,7);
      const plan=studentPlan(s); const planPrice=plan.price||0; const disc=studentDiscount_(s, planPrice);
      // no package and no custom amount would silently issue a 0-baht bill; say so instead
      if(p.amount==null && !p.items && planPrice<=0) fail('NO_PLAN_PRICE','นักเรียนคนนี้ยังไม่ได้เลือกแพ็กเกจ — กรุณาตั้งแพ็กเกจก่อนออกบิล');
      // billing follows the child's real START DATE, not the day their record was created
      if(p.amount==null && !p.items && !enrolledBy_(s, month))
        fail('NOT_ENROLLED_YET','นักเรียนคนนี้เริ่มเรียน '+enrolDate_(s)+' — ยังไม่ถึงเดือนที่ต้องเรียกเก็บ');
      // a child on temporary leave for the whole month is not charged for it
      if(p.amount==null && !p.items && pausedWholeMonth_(s, month))
        fail('STUDENT_PAUSED','นักเรียนคนนี้ลาชั่วคราวตลอดเดือนนี้ — ไม่เรียกเก็บค่าเทอม');
      /* ALREADY PAID FOR, MONTHS AGO.
       *
       * A family who pays 6 months up front has bought this month's TUITION, and this handler issues
       * exactly that. The bill netted to zero (payments credits it back), so nobody was overcharged
       * — but it was still a bill, it still went out with notifyBills, and being asked to pay for
       * something you paid for in advance is the kind of thing that costs a school its credibility
       * even when the arithmetic is right.
       *
       * Food, activity and special-class charges are NOT covered by a prepay and are NOT part of
       * this bill — they are studentCharges rows, issued and paid separately, so refusing here takes
       * nothing away from the school. `amount`/`items` (an admin writing a bill by hand) still go
       * through: the rule is "do not re-bill the tuition automatically", not "never bill".
       */
      if(p.amount==null && !p.items && monthTuitionPrepaid_(p.studentId, month)){
        const _pi=prepayInfo_(p.studentId, month)||{};
        fail('PREPAID_MONTH','นักเรียนคนนี้ชำระค่าเทอมล่วงหน้าแล้ว'+(_pi.months?' '+_pi.months+' เดือน':'')+
          (_pi.index?' (เดือนที่ '+_pi.index+'/'+(_pi.months||_pi.covered.length)+')':'')+' — ไม่ต้องออกบิลซ้ำ'); }
      // custom amount → respect as-is; default → (plan price − the student's monthly discount),
      // then the mid-month rule for the month they actually start (see tuitionForMonth_)
      const pr=tuitionForMonth_(s, month, Math.max(0, planPrice-disc));
      const amount=p.amount!=null?Number(p.amount):pr.amount;
      const prNote=(p.amount==null && pr.prorated) ? ` (เริ่มเรียน ${enrolDate_(s)} · ${prorateLabel_(pr)})` : '';
      const label=p.label||('ค่าเทอม '+((plan&&plan.labelTH)||'')+prNote); const items=p.items||[[label,amount]];
      const paid=!!p.paid; const paidDate=p.paidDate||todayLocal(); const method=p.method||(paid?'cash':'');
      let b=M.payments.find(x=>x.StudentID===p.studentId&&ym(x.Month)===month);
      const fields={Items:items,Amount:amount,Status:paid?'PAID':'UNPAID',SlipAmount:paid?amount:0,VerifiedStatus:paid?'CONFIRMED':'',PaidDate:paid?paidDate:'',PaymentMethod:method,Note:p.note||''};
      if(b){ Object.assign(b,fields); }
      else { b=Object.assign({BillingID:'BL-'+month+'-'+p.studentId,StudentID:p.studentId,Month:month,OTRollover:0,DueDate:billDueDate(studentById(p.studentId),month),SlipUrl:'',TransactionDate:paid?stampLocal():''},fields); M.payments.push(b); }
      logAct('issueBill',b.BillingID,month+' '+amount+(paid?' (ชำระล่วงหน้า)':''),actorOf(p));
      return b; },
    // Admin: issue this month's bill for SEVERAL selected students at once (each = tuition − discount).
    // The parent then sees each child's bill and can pay them combined (one slip) or separately.
    issueBillsFor: p => { const month=p.month||todayLocal().slice(0,7); const ids=Array.isArray(p.studentIds)?p.studentIds.filter(Boolean):[];
      if(!ids.length)fail('BAD_INPUT','ยังไม่ได้เลือกนักเรียน'); const out=[], skipped=[];
      // one child who has no package (or has not started yet) must not abort the whole batch —
      // bill everyone who can be billed and hand back the reason for each one that was skipped
      ids.forEach(sid=>{ const s=studentById(sid)||{};
        try{ const b=H.issueBill({studentId:sid,month});
          out.push({studentId:sid,nick:s.Nickname,name:s.NameTH,amount:b.Amount}); }
        // the CODE, not just the sentence — a screen that wants to group "already prepaid" apart
        // from "no package yet" should not have to read Thai prose to tell them apart
        catch(e){ skipped.push({studentId:sid,nick:s.Nickname,name:s.NameTH,code:(e&&e.code)||'',
          prepay:prepayInfo_(sid, month), reason:(e&&e.message)||String(e)}); } });
      logAct('issueBillsFor','', out.length+' คน เดือน '+month+(skipped.length?' (ข้าม '+skipped.length+')':''), actorOf(p));
      return {ok:true, month, created:out.length, students:out, skipped}; },
    // Admin deletes a bill (ยอดเรียกเก็บ). Removes the BILLING row; leaves any slip history in PAYMENT_SLIPS.
    deleteBill: p => { const i=M.payments.findIndex(x=>x.BillingID===p.billingId); if(i<0)fail('NOT_FOUND','ไม่พบบิล'); const b=M.payments[i]; M.payments.splice(i,1); logAct('deleteBill',p.billingId,'ลบบิล '+ym(b&&b.Month),actorOf(p)); return {ok:true}; },
    // auto-generate the month's bill for all active students from Plan price (skip if already billed)
    generateMonthlyBills: p => { const month=p.month||todayLocal().slice(0,7); let created=0; const noPlan=[], notYet=[], prorated=[], paused=[], prepaid=[];
      // enrolledStudents, not activeStudents: a child paused only PART of this month is still billed,
      // and the paused-all-month check below is what actually excludes them (with a reason).
      enrolledStudents().forEach(s=>{ if(M.payments.find(x=>x.StudentID===s.StudentID&&ym(x.Month)===month))return;
        if(pausedWholeMonth_(s, month)){ paused.push({studentId:s.StudentID, name:s.NameTH||s.Name||'', nick:s.Nickname||'', from:ymd(s.PauseFrom||''), to:ymd(s.PauseTo||'')}); return; }
        /* Bought and paid for in advance — see issueBill for why this is not just harmless noise.
         * Reported back BY NAME AND BY POSITION ("เดือนที่ 1/6"), because "ข้าม 3 คน" tells the
         * admin a number and not whether it was the right three. */
        { const pi=prepayInfo_(s.StudentID, month);
          if(pi){ prepaid.push({studentId:s.StudentID, name:s.NameTH||s.Name||'', nick:s.Nickname||'',
            months:pi.months, index:pi.index, left:pi.left, from:pi.from, to:pi.to}); return; } }
        const plan=studentPlan(s);
        const price=plan.price||0;
        // a child with no package gets NO bill rather than a phantom 0-baht one — reported back so the
        // admin can see exactly who still needs a package assigned
        if(price<=0){ noPlan.push({studentId:s.StudentID, name:s.NameTH||s.Name||'', nick:s.Nickname||''}); return; }
        // and a child whose first day is still in the future is not billed at all yet
        if(!enrolledBy_(s, month)){ notYet.push({studentId:s.StudentID, name:s.NameTH||s.Name||'', nick:s.Nickname||'', enrolDate:enrolDate_(s)}); return; }
        const net0=Math.max(0, price-studentDiscount_(s, price));   // the student's monthly discount, applied silently
        const pr=tuitionForMonth_(s, month, net0);                  // mid-month rule for their starting month
        const note=pr.prorated?` (เริ่มเรียน ${enrolDate_(s)} · ${prorateLabel_(pr)})`:'';
        if(pr.prorated) prorated.push({studentId:s.StudentID, nick:s.Nickname||'', name:s.NameTH||s.Name||'', mode:pr.mode, full:net0, amount:pr.amount});
        M.payments.push({BillingID:'BL-'+month+'-'+s.StudentID,StudentID:s.StudentID,Month:month,Items:[['ค่าเทอม '+((plan&&plan.labelTH)||'')+note,pr.amount]],Amount:pr.amount,OTRollover:0,DueDate:billDueDate(s,month),PaidDate:'',Status:'UNPAID',SlipUrl:'',SlipAmount:0,VerifiedStatus:'',Auto:true}); created++; });
      return {month,created,noPlan,notYet,prorated,paused,prepaid}; },
    // attach a monthly slip → records a PAYMENT_SLIPS row (multiple allowed), bill → PENDING_VERIFY.
    uploadSlip: p => recordSlip_('bill', p.billingId, p),
    // ONE transfer slip paying several siblings' bills. The ticked bills are summed; the slip amount MUST
    // equal that total (else AMOUNT_MISMATCH → the client shows a red overlay and blocks). Each bill gets
    // its own slip row (its share) sharing a SlipGroup so Admin sees they are one transfer. Ownership is
    // enforced — every bill's student must belong to the caller's children.
    // items: [{kind:'bill'|'charge'|'ot', id}] (legacy: p.bills = bill ids). Each item's outstanding is
    // summed; the slip amount MUST equal the total. Every item's student must belong to the caller.
    payCombined: p => { let list=Array.isArray(p.items)?p.items:(Array.isArray(p.bills)?p.bills.map(id=>({kind:'bill',id})):[]);
      list=list.filter(x=>x&&x.id); if(!list.length)fail('BAD_INPUT','ยังไม่ได้เลือกรายการ');
      const mine=new Set(visibleStudents(p).map(s=>s.StudentID));
      const items=list.map(it=>{ const kind=it.kind||'bill'; const tgt=slipTarget_(kind,it.id); if(!tgt)fail('NOT_FOUND','ไม่พบรายการ '+it.id);
        if(!mine.has(tgt.studentId))fail('NO_PERMISSION','รายการนี้ไม่ใช่ของบุตรหลานท่าน');
        const confirmed=sumSlips_(kind,it.id,['CONFIRMED']); return {kind,id:it.id,studentId:tgt.studentId,out:Math.max(0,tgt.due-confirmed)}; });
      const total=Math.round(items.reduce((a,x)=>a+x.out,0)); const amt=Math.round(Number(p.slipAmount||0));
      if(Math.abs(amt-total)>0.5) fail('AMOUNT_MISMATCH','ยอดชำระ ฿'+amt+' ไม่ตรงกับยอดรวมในระบบ ฿'+total);
      const groupId='SG-'+Date.now();
      items.forEach(x=>{ recordSlip_(x.kind, x.id, {slipAmount:x.out, slipData:p.slipData, slipName:p.slipName, slipGroup:groupId, uid:p.uid, parentId:p.parentId, role:p.role,
        statedDate:p.statedDate, statedTime:p.statedTime}); });
      logAct('payCombined', groupId, items.length+' รายการ รวม ฿'+total, actorOf(p));
      return {ok:true, groupId, total, count:items.length}; },

    /**
     * The same selection, paid in CASH at the school. Money changes hands at the door as often as it
     * goes through the bank, and the parent had no way to say so — they were left staring at a QR
     * for something they had already handed over, and the school had to remember it by hand.
     *
     * It records exactly what a slip does, minus the slip: one row per item, the amount, and THE DAY
     * THE MONEY WAS HANDED OVER (not today — a parent may be telling us on Monday about Friday).
     * It is NOT marked paid: it goes to the admin as PENDING_VERIFY, method=cash, and stays there
     * until someone at the school confirms they have the money. Saying "paid" on the parent's word
     * alone would put a hole in the accounts that nobody would notice.
     *
     * The amount must equal the total, exactly as a transfer must — the same rule, so cash is not a
     * way around it.
     */
    payCombinedCash: p => { let list=Array.isArray(p.items)?p.items:[];
      list=list.filter(x=>x&&x.id); if(!list.length)fail('BAD_INPUT','ยังไม่ได้เลือกรายการ');
      const mine=new Set(visibleStudents(p).map(s=>s.StudentID));
      const items=list.map(it=>{ const kind=it.kind||'bill'; const tgt=slipTarget_(kind,it.id); if(!tgt)fail('NOT_FOUND','ไม่พบรายการ '+it.id);
        if(!mine.has(tgt.studentId))fail('NO_PERMISSION','รายการนี้ไม่ใช่ของบุตรหลานท่าน');
        const confirmed=sumSlips_(kind,it.id,['CONFIRMED']); return {kind,id:it.id,studentId:tgt.studentId,out:Math.max(0,tgt.due-confirmed)}; });
      const total=Math.round(items.reduce((a,x)=>a+x.out,0)); const amt=Math.round(Number(p.amount||0));
      if(Math.abs(amt-total)>0.5) fail('AMOUNT_MISMATCH','ยอดชำระ ฿'+amt+' ไม่ตรงกับยอดรวมในระบบ ฿'+total);
      const paidOn=ymd(p.paidDate||todayLocal());
      if(paidOn>todayLocal()) fail('BAD_INPUT','วันที่ชำระต้องไม่เป็นวันในอนาคต');
      const groupId='CG-'+Date.now();
      items.forEach(x=>{ recordSlip_(x.kind, x.id, {slipAmount:x.out, slipName:'', slipGroup:groupId,
        uid:p.uid, parentId:p.parentId, role:p.role, method:'cash', statedDate:paidOn}); });
      logAct('payCombinedCash', groupId, items.length+' รายการ เงินสด ฿'+total+' · ชำระ '+paidOn, actorOf(p));
      return {ok:true, groupId, total, count:items.length, paidDate:paidOn, method:'cash'}; },
    /**
     * Payment history for a family — every amount that came in, when, for what, and the slip.
     * One entry per SLIP (that is what "ยอดที่ชำระเข้ามาวันไหน" actually means), plus an entry for
     * anything settled in cash, which leaves no slip behind. Each entry carries refKind/refId so the
     * screen can jump straight to the bill or advance payment it belongs to.
     * Scope: p.studentId (one child) or the caller's own children. Access is enforced by the route.
     */
    paymentLog: p => { p=p||{};
      const ids = p.studentId ? [p.studentId] : visibleStudents(p).map(s=>s.StudentID);
      const idSet = ids.reduce((a,x)=>(a[x]=1,a),{});
      const kidOf = sid => { const s=studentById(sid)||{}; return {studentId:sid, name:s.NameTH||s.Name||'', nick:s.Nickname||''}; };
      const labelFor = (kind, refId) => {
        if(kind==='bill'){ const b=M.payments.find(x=>x.BillingID===refId); return {label:'ค่าเทอมรายเดือน', month:b?ym(b.Month):'', due:b?Number(b.Amount||0):0}; }
        if(kind==='prepay'){ const pp=M.prepayments.find(x=>x.PrepayID===refId); const cov=pp?prepayCoveredMonths_(pp):[];
          return {label:'ชำระล่วงหน้า '+(pp?pp.Months:'?')+' เดือน'+(cov.length?' ('+cov[0]+' → '+cov[cov.length-1]+')':''),
            month:cov[0]||'', due:pp?Number(pp.Amount||0):0}; }
        if(kind==='ot'){ const o=M.otDaily.find(x=>x.OTID===refId);
          // Show the waiver on the parent's line. Billing only 100 with no explanation reads like a
          // miscalculation; saying so is what turns the school's goodwill into something felt.
          const d=o?otDiscOf_(o,otFullOf_(o)):0;
          return {label:'OT รับช้า'+(o?' '+ymd(o.Date):'')+(d>0?' (ปกติ '+otFullOf_(o)+' · ส่วนลดพิเศษ −'+d+')':''),
            month:o?ym(o.Date):'', due:o?Number(o.Amount||0):0,
            fullAmount:o?otFullOf_(o):0, discount:d, discountReason:(o&&o.DiscountReason)||''}; }
        if(kind==='charge'){ const c=M.studentCharges.find(x=>x.ChargeID===refId); return {label:(c&&c.Label)||'ค่าใช้จ่ายเพิ่มเติม', month:c?ym(c.Month):'', due:c?Number(c.Amount||0):0}; }
        return {label:kind, month:'', due:0}; };
      const out=[];
      paySlips_().forEach(s=>{ if(!idSet[s.StudentID])return;
        if(!p.includeRejected && s.Status==='REJECTED')return;
        const L=labelFor(s.RefKind, s.RefID);
        // date = when the money MOVED (off the slip), falling back to the upload time only when
        // SlipOK could not read one — the upload time is not what anyone is looking for
        out.push(Object.assign({ id:s.SlipID, via:String(s.Method||'')==='cash'?'cash':'slip', date:ymd(s.TransDate||s.SubmittedDate), submittedAt:s.SubmittedDate||'',
          transDate:ymd(s.TransDate||''), transTime:String(s.TransTime||'').slice(0,5), refKind:s.RefKind, refId:s.RefID, amount:Number(s.Amount||0),
          status:s.Status, slipUrl:s.Url||'', transRef:s.TransRef||'', receiver:s.Receiver||'',
          label:L.label, month:L.month, due:L.due }, kidOf(s.StudentID))); });
      // Cash settled through notifyCash leaves NO payment row at all, so it would otherwise be
      // invisible here. Anything an Admin recorded with recordCashPayment DOES have a row (above) and
      // must be skipped, or the same money would be listed — and totalled — twice.
      const hasRows = (kind, refId) => paySlips_().some(s=>s.RefKind===kind && s.RefID===refId);
      const cash = (rows, kind, idKey, dateKey) => rows.forEach(r=>{ if(!idSet[r.StudentID])return;
        if(String(r.Status)!=='PAID' || String(r.PaymentMethod||'')!=='cash')return;
        if(hasRows(kind, r[idKey])) return;
        const L=labelFor(kind, r[idKey]);
        out.push(Object.assign({ id:r[idKey], via:'cash', date:ymd(r[dateKey]||r.PaidDate||''), submittedAt:'',
          transDate:'', transTime:'', refKind:kind, refId:r[idKey], amount:Number(r.SlipAmount||L.due||0), status:'CONFIRMED',
          slipUrl:'', transRef:'', receiver:'', label:L.label+' (เงินสด)', month:L.month, due:L.due }, kidOf(r.StudentID))); });
      cash(M.payments||[], 'bill', 'BillingID', 'PaidDate');
      cash(M.prepayments||[], 'prepay', 'PrepayID', 'PaidDate');
      cash(M.otDaily||[], 'ot', 'OTID', 'PaidDate');
      cash(M.studentCharges||[], 'charge', 'ChargeID', 'PaidDate');
      out.sort((a,b)=>String(b.date+b.submittedAt).localeCompare(String(a.date+a.submittedAt)));
      const confirmed=out.filter(x=>x.status==='CONFIRMED').reduce((a,x)=>a+x.amount,0);
      const pending=out.filter(x=>x.status==='SUBMITTED').reduce((a,x)=>a+x.amount,0);
      return { students:ids.map(kidOf), entries:out, totalConfirmed:Math.round(confirmed*100)/100,
        totalPending:Math.round(pending*100)/100, count:out.length }; },
    /**
     * Admin records money received OUTSIDE the app — cash at the desk, or a transfer already seen in
     * the bank. It lands as a CONFIRMED payment row with no image, so the outstanding balance drops
     * immediately and it shows up in the payment history like everything else.
     *
     * This is what makes a mixed payment work: a family pays the enrolment fee in cash and transfers
     * the rest, so the slip they upload will never equal the whole bill. Record the cash part here
     * first and the transfer then matches what is actually left.
     * { kind:'bill'|'ot'|'charge'|'prepay', refId, amount, date?, note?, method? }
     */
    recordCashPayment: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const kind=String(p.kind||''); const tgt=slipTarget_(kind, p.refId); if(!tgt)fail('NOT_FOUND','ไม่พบรายการที่จะรับชำระ');
      const amt=Math.round(Number(p.amount||0)*100)/100; if(!(amt>0))fail('BAD_INPUT','ระบุจำนวนเงินที่รับมา');
      const already=sumSlips_(kind, p.refId, ['CONFIRMED']);
      if(already+amt > tgt.due+0.5) fail('OVERPAY','รับชำระเกินยอด — ค้างอยู่ '+Math.max(0,tgt.due-already)+' บาท');
      const method=String(p.method||'cash');
      paySlips_().push({ SlipID:'SL-'+Date.now()+'-'+Math.floor(Math.random()*10000), RefKind:kind, RefID:p.refId,
        StudentID:tgt.studentId, Amount:amt, Url:'', FileId:'', Verified:'MANUAL', TransRef:p.note||'',
        Receiver:ap.NameTH||ap.Name||'admin', SubmittedDate:stampLocal(), TransDate:ymd(p.date||todayLocal()),
        Status:'CONFIRMED', SlipGroup:'', Method:method });
      const r=recomputeTarget_(kind, p.refId, ymd(p.date||todayLocal()));
      if(tgt.obj) tgt.obj.PaymentMethod = method;
      logAct('recordCashPayment', p.refId, (method==='cash'?'รับเงินสด ':'บันทึกรับชำระ ')+amt+(p.note?(' · '+p.note):''), actorOf(p));
      const confirmed=sumSlips_(kind, p.refId, ['CONFIRMED']);
      return Object.assign({ok:true, kind, refId:p.refId, amount:amt, due:tgt.due, paidSoFar:confirmed,
        outstanding:Math.max(0, tgt.due-confirmed)}, r||{}); },
    // all slips for a bill/OT/prepay (or a student) — history shown to parent + admin (rejected hidden)
    paymentSlips: p => paySlips_().filter(s=> (p.refKind?s.RefKind===p.refKind:true) && (p.refId?s.RefID===p.refId:true) && (p.studentId?s.StudentID===p.studentId:true) && (p.includeRejected?true:s.Status!=='REJECTED'))
      .map(s=>({ SlipID:s.SlipID, RefKind:s.RefKind, RefID:s.RefID, Amount:Number(s.Amount||0), Url:s.Url, Verified:s.Verified, TransRef:s.TransRef, Receiver:s.Receiver, SubmittedDate:s.SubmittedDate, Status:s.Status, SlipGroup:s.SlipGroup||'', Method:s.Method||'', TransDate:s.TransDate||'', TransTime:s.TransTime||'', StatedDate:s.StatedDate||'', StatedTime:s.StatedTime||'', Sender:s.Sender||'' })),
    /**
     * Is slip verification actually working, and what has it been saying? A 'NO:<code>' is SlipOK's
     * VERDICT, not a broken connection — it read the slip and then objected. Mirrors handleSlipDiag.
     */
    slipDiag: p => { const ap=staffById(p&&p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const rows=paySlips_(); const counts={total:rows.length,verified:0,rejected:0,unchecked:0,manual:0}; const byCode={};
      rows.forEach(s=>{ const v=String(s.Verified||'');
        if(v.slice(0,3)==='YES')counts.verified++;
        else if(v==='MANUAL')counts.manual++;
        else if(v.slice(0,2)==='NO'){ counts.rejected++; const c=v.slice(3)||'?'; byCode[c]=(byCode[c]||0)+1; }
        else counts.unchecked++; });
      // the last few slips with what SlipOK said about each — a total cannot tell "never checked"
      // apart from "checked and objected", and that is the question being asked (see handleSlipDiag)
      const recent=rows.slice(-6).reverse().map(s=>{ const v=String(s.Verified||'');
        return { date:String(s.SubmittedDate||'').slice(0,16), kind:String(s.RefKind||''), amount:Number(s.Amount||0),
          method:String(s.Method||'transfer'), hasImage:!!s.Url,
          verdict: v.slice(0,3)==='YES'?'YES':(v==='MANUAL'?'MANUAL':(v.slice(0,2)==='NO'?v:'')) }; });
      const url=String(cfg.SlipOK_Url||''), key=String(cfg.SlipOK_ApiKey||''), on=!!(url&&key);
      // No network here — mock reports the CONFIGURED branch so the screen can be exercised offline.
      return { configured:on, working:on, url:'', counts, recent, hasPrevKey:!!cfg.SlipOK_ApiKeyPrev,
        live:{ checked:on, alive:on, code:null, message:'', branch:url.replace(/\/+$/,'').split('/').pop(),
          badBranch:false, badKey:false, expired:false, quota:null, overQuota:null, endDate:'',
          keyTail:key.length>4?('••••'+key.slice(-4)):'••••' },
        byCode:Object.keys(byCode).map(c=>({code:c,count:byCode[c]})).sort((a,b)=>b.count-a.count) }; },
    /**
     * Point the app at the right SlipOK branch. A school that renews on a NEW branch gets a new id,
     * and until this existed the only way to follow it was editing code — every slip meanwhile came
     * back "package expired". A blank key means "keep the current one".
     */
    saveSlipOk: p => { const ap=staffById(p&&p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      if(p&&p.restorePrev){ if(!cfg.SlipOK_ApiKeyPrev)fail('BAD_INPUT','ไม่มีคีย์เดิมให้ย้อนกลับ');
        cfg.SlipOK_ApiKey=cfg.SlipOK_ApiKeyPrev; cfg.SlipOK_ApiKeyPrev=''; return H.slipDiag(p); }
      const raw=String((p&&p.branch)==null?'':p.branch).trim().replace(/\/+$/,'');
      const branch=/^https?:\/\//i.test(raw)?raw.split('/').pop():raw;   // only a real URL is trimmed
      if(!/^[A-Za-z0-9_-]+$/.test(branch))fail('BAD_INPUT','เลขสาขาไม่ถูกต้อง — ใส่เฉพาะเลขสาขาจากหน้า SlipOK');
      cfg.SlipOK_Url='https://api.slipok.com/api/line/apikey/'+branch;
      const k=String((p&&p.apiKey)==null?'':p.apiKey).trim();
      if(k){ if(cfg.SlipOK_ApiKey&&cfg.SlipOK_ApiKey!==k)cfg.SlipOK_ApiKeyPrev=cfg.SlipOK_ApiKey; cfg.SlipOK_ApiKey=k; }
      return H.slipDiag(p); },
    // Admin: delete a payment record. Only ever a row with NO slip image — a double-tap that left an
    // empty entry, or a cash receipt entered by mistake. A real slip is evidence and stays; reject it
    // instead. Recomputes what is owed afterwards, so the balance is right either way.
    deleteSlip: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const i=paySlips_().findIndex(s=>String(s.SlipID)===String(p.slipId)); if(i<0)fail('NOT_FOUND','ไม่พบรายการชำระ');
      const s=paySlips_()[i];
      if(s.Url) fail('HAS_SLIP','รายการนี้มีสลิปแนบอยู่ — ใช้ปุ่มปฏิเสธสลิปแทนการลบ');
      const kind=s.RefKind, refId=s.RefID; paySlips_().splice(i,1);
      const r=recomputeTarget_(kind, refId);
      logAct('deleteSlip', refId, 'ลบรายการรับชำระ '+s.Amount, actorOf(p));
      return Object.assign({ok:true, kind, refId}, r||{}); },
    // Admin confirms ONE slip; when confirmed total ≥ due the whole bill flips to PAID (else PARTIAL).
    confirmSlip: p => { const s=paySlips_().find(x=>x.SlipID===p.slipId); if(!s)fail('NOT_FOUND','ไม่พบสลิป'); s.Status='CONFIRMED'; s.VerifiedBy=p.adminId||'admin';
      const r=recomputeTarget_(s.RefKind, s.RefID, p.paidDate); logAct('confirmSlip',s.SlipID,'ยืนยัน '+s.Amount,actorOf(p)); return Object.assign({ok:true},r); },
    rejectSlip: p => { const s=paySlips_().find(x=>x.SlipID===p.slipId); if(!s)fail('NOT_FOUND','ไม่พบสลิป'); s.Status='REJECTED';
      const r=recomputeTarget_(s.RefKind, s.RefID); logAct('rejectSlip',s.SlipID,'ปฏิเสธสลิป',actorOf(p)); return Object.assign({ok:true},r); },

    // notify a CASH payment (parent or Admin) for a bill/OT/prepay → PENDING_VERIFY with method=cash.
    // Admin later confirms and sets the actual payment date. kind = bill | ot | prepay.
    notifyCash: p => { const today=todayLocal();
      const mark=rec=>{ rec.PaymentMethod='cash'; rec.TransactionDate=stampLocal(); rec.Status='PENDING_VERIFY'; rec.VerifiedStatus='CASH'; rec.SlipAmount=Number(p.amount||rec.Amount||0); rec.SubmittedDate=today; };
      let rec,id;
      if(p.kind==='ot'){ rec=M.otDaily.find(x=>x.OTID===p.id); id=p.id; }
      else if(p.kind==='prepay'){ rec=M.prepayments.find(x=>x.PrepayID===p.id); id=p.id; }
      else { rec=M.payments.find(x=>x.BillingID===p.id); id=p.id; }
      if(!rec)fail('NOT_FOUND','ไม่พบรายการ'); mark(rec);
      logAct('notifyCash',id,'เงินสด '+(rec.SlipAmount||rec.Amount),actorOf(p));
      return Object.assign({},rec,{method:'cash'}); },

    // ---- daily OT (parent) ---- cancelled OT is not shown to the parent and never billed
    otDaily: p => M.otDaily.filter(o=>o.StudentID===p.studentId && o.Status!=='CANCELLED').sort((a,b)=>b.Date.localeCompare(a.Date)),

    // ---- Admin OT management (student late-pickup OT) ----
    // list a month's OT with the student's name + the rate actually used
    studentOtList: p => { const month=ym(p.month||todayLocal().slice(0,7));
      return M.otDaily.filter(o=>ym(o.Date)===month).sort((a,b)=>String(b.Date).localeCompare(String(a.Date))).map(o=>{
        const s=studentById(o.StudentID)||{};
        return { otId:o.OTID, date:o.Date, studentId:o.StudentID, name:s.NameTH, nameEN:s.NameEN,
          nick:s.Nickname, nickEN:s.NicknameEN, class:s.Class, endTime:studentEndTime(s),
          planEnd:o.PlanEnd, pickupTime:o.PickupTime, lateMinutes:Number(o.LateMinutes||0), hours:Number(o.Hours||0),
          amount:Number(o.Amount||0), status:o.Status||'UNPAID', rate:otRateFor(s),
          fullAmount:otFullOf_(o), discount:otDiscOf_(o,otFullOf_(o)),
          discountReason:o.DiscountReason||'', discountBy:o.DiscountBy||'' }; }); },
    // Teacher OT follow-up: outstanding student OT the teacher may act on. A homeroom teacher sees ONLY
    // the students in the class(es) they cover; a head teacher / Leader / Admin sees all. Grouped by
    // student with a running outstanding total so the teacher can chase payment or add a slip on behalf.
    teacherStudentOtList: p => { const me=staffById(p.staffId)||{};
      const covered=coveredClasses_(me).map(c=>c.ClassName);
      const seeAll = me.PositionLevel==='Admin'||me.PositionLevel==='Leader'||me.Role==='Admin';
      const canSee = s => seeAll || covered.indexOf(String(s.Class||''))>=0;
      const month = p.month ? ym(p.month) : null;   // null = every month (all outstanding)
      const rows=(M.otDaily||[]).filter(o=>{ if(month && ym(o.Date)!==month) return false;
        const s=studentById(o.StudentID); return s && canSee(s); })
        .sort((a,b)=>String(b.Date).localeCompare(String(a.Date)));
      const byStudent={};
      rows.forEach(o=>{ const s=studentById(o.StudentID)||{}; const sid=o.StudentID;
        const confirmed=sumSlips_('ot',o.OTID,['CONFIRMED']); const submitted=sumSlips_('ot',o.OTID,['SUBMITTED','PENDING_VERIFY']);
        const outstanding=OT_CLOSED[o.Status]?0:Math.max(0,Number(o.Amount||0)-confirmed);
        const g=byStudent[sid]||(byStudent[sid]={studentId:sid,name:s.NameTH,nameEN:s.NameEN,nick:s.Nickname,nickEN:s.NicknameEN,class:s.Class,outstanding:0,items:[]});
        g.outstanding+=outstanding;
        g.items.push({otId:o.OTID,date:o.Date,pickupTime:o.PickupTime,planEnd:o.PlanEnd,hours:Number(o.Hours||0),
          amount:Number(o.Amount||0),status:o.Status||'UNPAID',confirmed,submitted,outstanding,
          fullAmount:otFullOf_(o),discount:otDiscOf_(o,otFullOf_(o))}); });
      const list=Object.keys(byStudent).map(k=>byStudent[k]).sort((a,b)=>b.outstanding-a.outstanding);
      return { seeAll, classes:covered, totalOutstanding:list.reduce((a,s)=>a+s.outstanding,0), students:list }; },
    // Teacher records a transfer slip for a student's OT on behalf of the parent — same slip pipeline
    // as payOT, but gated to students the teacher covers (a homeroom teacher can't pay another class's OT).
    teacherPayOT: p => { const me=staffById(p.staffId)||{}; const o=(M.otDaily||[]).find(x=>x.OTID===p.otId);
      if(!o)fail('NOT_FOUND','ไม่พบรายการ OT'); const s=studentById(o.StudentID)||{};
      const seeAll = me.PositionLevel==='Admin'||me.PositionLevel==='Leader'||me.Role==='Admin';
      const covered=coveredClasses_(me).map(c=>c.ClassName);
      if(!(seeAll || covered.indexOf(String(s.Class||''))>=0)) fail('NO_ACCESS','ครูดูแลได้เฉพาะนักเรียนในชั้นของตน');
      return recordSlip_('ot', p.otId, p); },
    // recompute from a corrected pickup time, and/or override the amount outright. PAID rows are locked.
    // Correct the pickup time and/or grant a goodwill discount. The charge (FullAmount) and the
    // waiver (Discount) are stored separately so a recompute can never wipe the discount, and so a
    // discount is always distinguishable from a miscalculation. Amount stays the NET payable, which
    // is what billing, slips and the parent's payables all read.
    adminUpdateOT: p => { const o=M.otDaily.find(x=>x.OTID===p.otId); if(!o)fail('NOT_FOUND','ไม่พบรายการ OT');
      if(o.Status==='PAID')fail('ALREADY_PAID','รายการนี้ชำระแล้ว แก้ไขไม่ได้');
      let full=otFullOf_(o), touched=false;
      if(p.pickupTime){ const s=studentById(o.StudentID)||{}; const c=otFor(s,p.pickupTime);
        o.PickupTime=p.pickupTime; o.PlanEnd=c.planEnd; o.LateMinutes=c.late; o.Hours=c.hours; full=c.amount; touched=true; }
      const had=otDiscOf_(o,otFullOf_(o));
      let disc=Math.min(had,full);                                  // a smaller charge caps an old discount
      if(p.discount!=null && p.discount!==''){ disc=Math.min(otNum_(p.discount),full); touched=true; }
      else if(p.amount!=null && p.amount!==''){ disc=Math.min(Math.max(0,full-otNum_(p.amount)),full); touched=true; }
      if(!touched){
        // nothing to change, but the row may still be mis-settled against its slips — heal it
        const healed=otResettle_(o); if(healed) return { otId:o.OTID, resettled:true, status:o.Status, amount:Number(o.Amount||0) };
        fail('BAD_INPUT','ไม่มีข้อมูลให้แก้ไข');
      }
      o.FullAmount=full; o.Discount=disc; o.Amount=Math.max(0,full-disc);
      if(disc!==had){ o.DiscountReason=disc>0?String(p.discountReason||'').slice(0,200):'';
        o.DiscountBy=disc>0?(p.staffId||p.adminId||'ADMIN'):''; o.DiscountAt=disc>0?todayLocal():''; }
      if(o.Status==='CANCELLED') o.Status='UNPAID';                  // editing revives a cancelled row
      // waiving the whole charge leaves nothing to collect — settled, not "owing 0"
      if(o.Amount===0){ o.Status='PAID'; o.PaidDate=o.PaidDate||todayLocal(); }
      // A row is only re-settled when a SLIP changes, never when the AMOUNT does. A parent who had
      // paid 100 against a 200 charge stayed PARTIAL after the discount made 100 the whole amount,
      // and finance kept listing them as owing. This is what makes the two screens agree.
      otResettle_(o);
      logAct(disc!==had?'otDiscount':'adminUpdateOT',o.OTID,'เต็ม '+full+' ลด '+disc+' สุทธิ '+o.Amount+(o.DiscountReason?' ('+o.DiscountReason+')':''),actorOf(p));
      return { otId:o.OTID, pickupTime:o.PickupTime, lateMinutes:o.LateMinutes, hours:o.Hours,
        fullAmount:full, discount:disc, amount:o.Amount, status:o.Status }; },
    adminCancelOT: p => { const o=M.otDaily.find(x=>x.OTID===p.otId); if(!o)fail('NOT_FOUND','ไม่พบรายการ OT');
      if(o.Status==='PAID')fail('ALREADY_PAID','รายการนี้ชำระแล้ว ยกเลิกไม่ได้');
      o.Status='CANCELLED'; logAct('adminCancelOT',o.OTID,'ยกเลิก OT',actorOf(p)); return {otId:o.OTID,status:'CANCELLED'}; },
    adminRestoreOT: p => { const o=M.otDaily.find(x=>x.OTID===p.otId); if(!o)fail('NOT_FOUND','ไม่พบรายการ OT');
      if(o.Status!=='CANCELLED')fail('BAD_INPUT','รายการนี้ไม่ได้ถูกยกเลิก');
      o.Status='UNPAID'; logAct('adminRestoreOT',o.OTID,'คืนค่า OT',actorOf(p)); return {otId:o.OTID,status:'UNPAID'}; },
    // attach OT slip → records a PAYMENT_SLIPS row, OT → PENDING_VERIFY (Admin confirms per slip)
    payOT: p => recordSlip_('ot', p.otId, p),

    calendar: () => M.calendar.concat((M.holidays||[]).map(h=>({date:h.Date,title:(h.NameTH||h.NameEN),titleEN:(h.NameEN||h.NameTH),type:'holiday'})),
        // the label the calendar prints. The config key and the type stay 'bigclean' — the day was
        // renamed on screen, not in the data (see BC_NAME in app.js)
        bigCleaningList_().map(d=>({date:d,title:'วันประชุม 👥',titleEN:'Meeting day 👥',type:'bigclean'})))
      .slice().sort((a,b)=>a.date.localeCompare(b.date)),
    // admin-managed Big Cleaning Days (read + add/remove) — stored in SCHOOL_CONFIG on GAS
    /**
     * Is the school open today, and if not, why?
     *
     * ONE answer, read by every screen that shows a check-in button — the parent's kid card and the
     * teacher's work-time card — so the button and the server can never disagree. The server refuses
     * a check-in on a closed day (assertSchoolOpen_ / parentCheckin); this is what lets the screen
     * say so instead of offering a button that will fail.
     * A Big Cleaning day is a WORKING day that happens to fall at the weekend, so it is NOT closed.
     */
    schoolDay: p => schoolDayFor_((p&&p.date)||todayLocal()),
    bigCleaningDays: () => ({ days: bigCleaningList_(), amount: Number(cfg.BigCleaningAmount||0),
      checkIn: bigCleaningIn_(), checkOut: bigCleaningOut_() }),
    addBigCleaning: p => { const l=bigCleaningList_(); if(p.date && l.indexOf(p.date)<0) l.push(p.date); cfg.BigCleaningDays=l.slice().sort(); return {ok:true,days:cfg.BigCleaningDays}; },
    removeBigCleaning: p => { cfg.BigCleaningDays=bigCleaningList_().filter(d=>d!==p.date); return {ok:true,days:cfg.BigCleaningDays}; },
    // newest created first, each row already told whether it is showing right now — so no screen has
    // to work the window out for itself (see annPhase_)
    announcements: () => M.announcements.slice().sort(annSort_)
      .map(a => Object.assign({}, a, { Phase: annPhase_(a), Active: annPhase_(a)==='live' })),

    // DSPM status for a student's current band (all items + status)
    /* A child who is not on the roll any more — withdrawn, or an id kept open in a tab that has since
     * been deleted — used to crash here: studentById returns undefined and .DOB threw a TypeError,
     * which reached the teacher as "INTERNAL" and told them nothing (4 of these in one day's log).
     * Say which child could not be found instead; the caller can act on that. */
    dspmStatus: p => { const s=studentById(p.studentId);
      if(!s) fail('NOT_FOUND','ไม่พบนักเรียนรายนี้ (อาจถูกย้ายหรือลาออกแล้ว)');
      const age=p.ageMonth??ageMonths(s.DOB);
      const band=M.dspmCriteria.filter(c=>c.AgeFrom<=age&&age<=c.AgeTo).sort((a,b)=>a.ItemNo-b.ItemNo);
      if(!band.length) fail('NO_CRITERIA',`ยังไม่มีเกณฑ์สำหรับอายุ ${age} เดือน`);
      const latest=latestByItem(p.studentId);
      return {studentId:p.studentId,ageMonth:age,ageLabel:band[0].AgeLabelTH,manualUrl:cfg.DspmManualUrl,
        // who judged it and when, plus the admin's note — the result alone does not say whose it is
        items:band.map(c=>{ const r=latest[c.ItemNo]||null;
          return {itemNo:c.ItemNo,skill:c.Skill,description:c.Description,descriptionEN:(M.dspmEN&&M.dspmEN[c.ItemNo])||'',
            result:r?r.Result:'ยังไม่ได้รับการทดสอบ', date:r?r.Date:'',
            // the nickname is how the school names its teachers; the full name stays for a report
            by:r?(r.TeacherName||''):'', byNick:r?signedBy_(r.TeacherID,r.TeacherName).nick:'', byLeft:!!(r&&signedBy_(r.TeacherID,r.TeacherName).left), at:r?(r.Timestamp||''):'',
            comment:r?(r.AdminComment||''):'', commentBy:r?(r.CommentBy||''):'', commentAt:r?(r.CommentAt||''):''}; })}; },

    /**
     * The two things about a child that nobody should have to go looking for: a BIRTHDAY this month,
     * and a DSPM assessment that has come due.
     *
     * One call, because both are "what needs attention about these children" and a screen that shows
     * one should not pay twice to show the other.
     *
     * SCOPE: an admin sees the whole school; a teacher sees the classes they actually cover. A head
     * teacher covers more, so they see more — the same rule the class list already uses.
     *
     * DSPM DUE means: this child's age falls in a band, and at least one item in that band has never
     * been given a real result. "ยังไม่ได้ประเมิน" is a real answer to record but NOT an assessment,
     * so it keeps the reminder up — which is the point of being able to record it.
     * Finish the band and the reminder goes, on its own, with nothing to dismiss.
     */
    studentAlerts: p => {
      const me = staffById(p&&p.staffId);
      const all = adminLike_(me) || String((p&&p.role)||'')==='Admin';
      const mine = all ? null : new Set(coveredClasses_(me).map(c=>c.ClassName));
      const kids = activeStudents().filter(s=>all || mine.has(s.Class));
      const month = ym((p&&p.month)||todayLocal());
      const mo = Number(month.slice(5,7));
      const thisYear = Number(month.slice(0,4));

      const birthdays = kids.filter(s=>{ const d=ymd(s.DOB); return d && Number(d.slice(5,7))===mo; })
        .map(s=>{ const d=ymd(s.DOB), day=Number(d.slice(8,10));
          return { studentId:s.StudentID, name:s.NameTH||s.Name||'', nameEN:s.NameEN||'', nick:s.Nickname||'',
                   nickEN:s.NicknameEN||'', class:s.Class||'', dob:d, day,
                   turning: thisYear - Number(d.slice(0,4)) };})
        .sort((a,b)=>a.day-b.day || String(a.nick||a.name).localeCompare(String(b.nick||b.name)));

      const ASSESSED = { 'ผ่าน':1, 'ไม่ผ่าน':1 };
      const dspmDue = [];
      kids.forEach(s=>{
        const age = ageMonths(s.DOB);
        const band = (M.dspmCriteria||[]).filter(c=>c.AgeFrom<=age && age<=c.AgeTo);
        if(!band.length) return;                                  // no criteria for this age yet
        const latest = latestByItem(s.StudentID);
        const done = band.filter(c=>{ const r=latest[c.ItemNo]; return r && ASSESSED[r.Result]; }).length;
        if(done >= band.length) return;                           // finished — say nothing
        dspmDue.push({ studentId:s.StudentID, name:s.NameTH||s.Name||'', nameEN:s.NameEN||'',
          nick:s.Nickname||'', nickEN:s.NicknameEN||'', class:s.Class||'', ageMonth:age,
          ageLabel: band[0].AgeLabelTH||'', band: band[0].AgeFrom+'-'+band[0].AgeTo,
          done, total: band.length });
      });
      dspmDue.sort((a,b)=>String(a.class).localeCompare(String(b.class)) || a.ageMonth-b.ageMonth);
      return { month, scope: all?'school':'myClasses', birthdays, dspmDue,
               counts:{ birthdays:birthdays.length, dspmDue:dspmDue.length } };
    },

    // ---------- Teacher / staff ----------
    // classes a staff member is responsible for: Admin/Leader (or Classes='*') → all; else homeroom
    // (CLASSES.TeacherID) ∪ the explicit Classes list ∪ the class matching their Department.
    classList: p => { const s=staffById(p.staffId); const covered=coveredClasses_(s);
      let cls = p.className ? covered.find(c=>c.ClassName===p.className) : null;
      if(!cls) cls = covered[0] || M.classes[0];
      // today's attendance per student — the journal can only be filled once a child is checked IN,
      // and the on-behalf check-in button fades once IN/OUT is already recorded for the day.
      /* `date` is accepted so this can be ASKED ABOUT A DAY, rather than only ever answering for the
       * moment it happens to run. Every caller in the app omits it and gets today, exactly as before;
       * what it buys is a test of "who is on the list on a Wednesday" that does not depend on the
       * day the test is run — the trap that made two suites go red on a Saturday. */
      const today=ymd(p.date||todayLocal());
      const attOf=sid=>{ const a=M.studentAttendanceToday.find(x=>x.StudentID===sid);
        const h=M.studentCheckins.find(c=>c.StudentID===sid&&ymd(c.Date)===today)||{};
        // A child whose parent told us they are away today must not be checked in by mistake — the
        // leave itself is the record. Carry the type and reason so the class list can say why.
        const lv=studentLeaveToday_(sid);
        /* THE FACT AND THE TIME ARE TWO DIFFERENT QUESTIONS, and only the fact may decide whether a
         * teacher can work. Reported 2026-09-01: อิงใจ was 'อยู่ที่โรงเรียน' on the dashboard, but her
         * บันทึก button was dead on the class list and refreshing did nothing.
         *
         * Everything else in the app asks "is there a check-in event today?" — the dashboard
         * (`a?a.Status:'ABSENT'`) and the journal's own server-side guard (`a.Status==='IN'||'OUT'`).
         * This one line asked "...and do we also have a time string for it", so a row whose Time cell
         * came back blank read as NOT CHECKED IN. The server would have accepted the journal; only
         * the button refused it. Two definitions of the same fact in one engine, and the stricter one
         * was on the button.
         *
         * `checkedIn` is the fact. inTime/outTime stay exactly what they were — a time to print, or
         * '' when we do not have one — and a missing time now costs a label, not the teacher's day. */
        const seen = !lv.onLeave && a && (a.Status==='IN' || a.Status==='OUT');
        return Object.assign({status: lv.onLeave?'LEAVE':(a?a.Status:'NONE'),
          checkedIn: !!seen, pickedUp: !!(!lv.onLeave && a && a.Status==='OUT'),
          inTime:h.InTime||(a&&a.Status==='IN'?a.Time:'')||'', outTime:h.OutTime||(a&&a.Status==='OUT'?a.Time:'')||''}, lv); };
      /* A CHILD IS NOT ON THE LIST ON THEIR OWN DAY OFF. Asked 2026-08-30: "รายชื่อนักเรียนคนนี้
       * ไม่ถูกนับวันพุธ คุณครูไม่ต้องบันทึก". Leaving them on the list greyed out would still put a
       * name in front of a teacher who has nothing to do about it, and would still count against the
       * class's "everyone recorded?" total — so they come off it. */
      return {class:cls, classes:covered.map(c=>({className:c.ClassName,classNameEN:c.ClassNameEN||c.ClassName})),
        students:activeStudents().filter(s2=>s2.Class===cls.ClassName && !studentOffDay_(s2, today)).map(s2=>{ const at=attOf(s2.StudentID);
          return Object.assign({ageMonth:ageMonths(s2.DOB), attStatus:at.status,
            inToday:at.checkedIn||!!at.inTime, outToday:at.pickedUp||!!at.outTime,
            inTime:at.inTime, outTime:at.outTime, onLeave:at.onLeave, leaveType:at.leaveType, leaveReason:at.leaveReason}, s2); }),
        // who is away today by standing arrangement, so the screen can say so instead of the class
        // silently being one child short
        offToday:activeStudents().filter(s2=>s2.Class===cls.ClassName && studentOffDay_(s2, today))
          .map(s2=>({studentId:s2.StudentID, nick:s2.Nickname||'', name:s2.NameTH||s2.Name||'', days:offDaysLabel_(s2)}))}; },
    // the class names this staff can pick between (used to show/hide a class switcher)
    myClasses: p => { const s=staffById(p.staffId); const covered=coveredClasses_(s);
      return {classes:covered.map(c=>({className:c.ClassName,classNameEN:c.ClassNameEN||c.ClassName})), all:covered.length===M.classes.length}; },
    myAttendanceToday: p => { const r=M.staffAttendanceToday.find(x=>x.StaffID===p.staffId);
      const me=staffById(p.staffId)||{};
      // the hours that apply TODAY, not the ones on the person's row — on a day the school reopens at
      // noon the teacher's card must say 12:00, or they will read 08:00 and think they are hours late
      const h=staffHoursOn_(p.staffId, todayLocal());
      const sch={CheckInTime:h.checkIn, CheckOutTime:h.checkOut};
      /* OT วันหยุด makes a closed day a working day FOR THIS PERSON. staffCheckin has known that
       * since 2026-08-21; the card that draws the button did not, so it kept printing
       * "วันนี้โรงเรียนหยุด" and there was no button to press (see holidayOTStaffInfo_). The card
       * cannot work this out from `schoolDay` — that answers for the school, not for one teacher —
       * so the answer travels with the person's own attendance. */
      /* Only asked on a day that IS shut to staff — OT วันหยุด cannot exist on any other
       * (assertHolidayDate_), and reading OT_RECORDS on every ordinary morning would put a whole
       * sheet on the teacher home screen's critical path for an answer that is always false. */
      const _hot=(h.dayOff||schoolDayFor_(todayLocal()).closed)
        ? (holidayOTStaffInfo_(todayLocal()).find(x=>String(x.staffId)===String(p.staffId))||null) : null;
      return {date:todayLocal(), schedule:sch, hours:h, checkIn:r?r.CheckIn:'', checkOut:r?r.CheckOut:'', late:r?r.Late||0:0, status:r?r.Status:'NONE',
        holidayOT:!!_hot, holidayOTAmount:_hot?_hot.amount:0, holidayOTNote:_hot?_hot.note:'',
        // before the first working day the buttons are locked and the date is shown instead
        notStarted:!staffStarted_(me), startDate:ymd(me.StartDate||''),
        manualIn:!!(r&&r.InManual&&String(r.InManual).toUpperCase()==='YES'), manualOut:!!(r&&r.OutManual&&String(r.OutManual).toUpperCase()==='YES')}; },
    // today + previous working days (with late status) for the teacher work-time card
    /**
     * One month of working time for every teacher: the day-by-day record, and the totals.
     *
     * The admin could see who is on leave (the approval calendar) and who is in TODAY (the dashboard),
     * but nowhere could they answer "how was this teacher's month" without reading the sheet. This
     * gives both halves the school asked for: a summary per person, and every day behind it.
     *
     * Late minutes and OT come from what was RECORDED on the day, against that day's schedule — a
     * Big Cleaning day has different hours, so recomputing them afterwards would quietly disagree
     * with the payslip. Days before someone started, weekends and holidays are not absences.
     */
    /**
     * One month of every class: how each child attended, and where they stand on growth and DSPM.
     *
     * The school had the pieces — today's attendance on the dashboard, absences in the leave
     * calendar, DSPM and growth one child at a time — but nothing that answers "how is Nursery 2
     * doing this month" on one page. This is that page, and it is what the PDF prints.
     *
     * CONSECUTIVE ABSENCE is the number the school actually acts on: a child missing several days in
     * a row is a phone call home, and counting it needs the days in order, skipping weekends and
     * holidays so a Friday-then-Monday absence reads as two in a row rather than four.
     */
    studentMonthReport: p => {
      { const me=staffById(p&&p.staffId); if(!adminLike_(me)) fail('NO_PERMISSION','เฉพาะแอดมิน'); }
      const month = ym((p&&p.month)||todayLocal().slice(0,7));
      const [Y,Mo] = month.split('-').map(Number);
      const days = new Date(Y, Mo, 0).getDate();
      const today = todayLocal();
      const hol={}; (M.holidays||[]).forEach(h=>{ const d=ymd(h.Date); if(d.slice(0,7)===month) hol[d]=1; });
      // the school days of this month, in order — the only days a child can be present or absent
      const schoolDays=[];
      for(let dd=1; dd<=days; dd++){
        const ds = Y+'-'+String(Mo).padStart(2,'0')+'-'+String(dd).padStart(2,'0');
        const dow = new Date(ds).getDay();
        if(dow===0||dow===6||hol[ds]||ds>today) continue;
        schoolDays.push(ds);
      }
      const inOn={}; (M.checkinStudent||[]).forEach(c=>{ const d=ymd(c.Date);
        if(d.slice(0,7)===month && String(c.Type).toUpperCase()==='IN') inOn[c.StudentID+'|'+d]=1; });
      const leaveOn={}; (M.studentLeaves||[]).forEach(l=>{ const d=ymd(l.Date);
        if(d.slice(0,7)===month) leaveOn[l.StudentID+'|'+d]={type:String(l.Type||''), reason:l.Reason||''}; });
      // 'ลาป่วย' vs anything else the school records; an unlabelled leave counts as ลากิจ
      const isSick = t => /ป่วย|sick/i.test(String(t||''));

      const rows = enrolledStudents().map(s=>{
        let present=0, absent=0, sick=0, personal=0, run=0, worstRun=0, lastAbsent='';
        // days this child could actually have attended — the report says how many, because
        // "ขาด 0" for a child who joined on the 22nd means something different from "ขาด 0"
        // for one who has been here all month
        let owed=0;
        schoolDays.forEach(ds=>{
          /* THE FIRST DAY HAS NOT COME YET.
           *
           * Reported 2026-08-26: น้องเอ็นเจ, whose first day was the 22nd, was listed as
           * "ขาด 16 · ขาดต่อเนื่อง 16 · ต้องติดตาม" — 16 being exactly the school days BEFORE they
           * started. The child had not missed anything; they had not arrived.
           *
           * studentNotStarted_ is the rule the check-in guard, the class roster and the billing all
           * already use. This screen was the one place still counting from the first of the month,
           * and it is the screen that decides whose parents get chased.
           */
          if(studentNotStarted_(s, ds)) { run=0; return; }
          // a child on temporary leave for that day is not expected in, so it is not an absence
          if(studentPaused_(s, ds)) { run=0; return; }
          /* ...NOR ON THEIR OWN REGULAR DAY OFF. A child who comes four days a week must not read as
           * "ขาด 4 · ขาดต่อเนื่อง 4 · ต้องติดตาม" by the end of a month for coming exactly as agreed.
           * `owed` is below this line on purpose: a day they never owed cannot be a day they missed,
           * and the denominator has to agree with the numerator or the percentage is a fiction. */
          if(studentOffDay_(s, ds)) { run=0; return; }
          /* TODAY IS NOT OVER. A child who has not been dropped off by the time an admin opens this
           * at 09:00 is not absent — they are on their way. The staff version of this screen has
           * always refused to call today an absence (status TODAY); the children's did not, so a
           * class report read one absence heavier every morning, and a child two days behind was
           * shown as three and crossed the "ต้องติดตาม" line on nothing at all.
           *
           * The run is NOT reset, only left alone: a real five-day run that is still going must not
           * read as four because today has not finished. Arriving today still counts as present. */
          owed++;   // counted BEFORE the today rule: they were due in today, we just do not know yet
          if(ds===today && !inOn[s.StudentID+'|'+ds] && !leaveOn[s.StudentID+'|'+ds]) return;
          if(inOn[s.StudentID+'|'+ds]) { present++; run=0; return; }
          const lv=leaveOn[s.StudentID+'|'+ds];
          if(lv){ if(isSick(lv.type)) sick++; else personal++; run=0; return; }
          absent++; run++; if(run>worstRun){ worstRun=run; } lastAbsent=ds;
        });
        const g=(M.growthRecords||[]).filter(r=>r.StudentID===s.StudentID)
          .sort((a,b)=>String(a.Date).localeCompare(String(b.Date)));
        const last=g[g.length-1]||null;
        // DSPM: how many of the items for this child's age have been assessed, and how many passed
        const age=ageMonths(s.DOB);
        const band=(M.dspmCriteria||[]).filter(c=>c.AgeFrom<=age&&age<=c.AgeTo);
        const latest=latestByItem(s.StudentID);
        let done=0, pass=0;
        band.forEach(c=>{ const r=latest[c.ItemNo]; if(!r||!r.Result||r.Result==='ยังไม่ได้รับการทดสอบ') return;
          done++; if(/ผ่าน|pass/i.test(String(r.Result)) && !/ไม่ผ่าน|not/i.test(String(r.Result))) pass++; });
        return {studentId:s.StudentID, name:s.NameTH||s.Name||'', nameEN:s.NameEN||'', nick:s.Nickname||'', nickEN:s.NicknameEN||'',
          class:s.Class||'', ageMonth:age, paused:studentPaused_(s),
          // ...and say so on the row, so a short month reads as a late start rather than a mystery
          notStarted:studentNotStarted_(s), startDate:ymd(s.EnrollDate||''), schoolDays:owed,
          present, absent, sick, personal, maxConsecutive:worstRun, lastAbsent,
          weight:last?Number(last.Weight)||0:0, height:last?Number(last.Height)||0:0, measuredAt:last?ymd(last.Date):'',
          dspmTotal:band.length, dspmDone:done, dspmPass:pass};
      });

      // grouped by class, because that is the unit a teacher and a head teacher think in
      const byClass={};
      rows.forEach(r=>{ const c=r.class||'(ยังไม่จัดชั้น)'; (byClass[c]=byClass[c]||[]).push(r); });
      const classes=Object.keys(byClass).map(c=>{
        const list=byClass[c];
        const sum=k=>list.reduce((a,x)=>a+(x[k]||0),0);
        return {className:c, count:list.length, students:list,
          present:sum('present'), absent:sum('absent'), sick:sum('sick'), personal:sum('personal'),
          watch:list.filter(x=>x.maxConsecutive>=3).length,
          noGrowth:list.filter(x=>!x.measuredAt).length,
          dspmPending:list.filter(x=>x.dspmTotal>0 && x.dspmDone<x.dspmTotal).length};
      });
      return {month, schoolDays:schoolDays.length, today, classes,
        totals:{students:rows.length, present:rows.reduce((a,x)=>a+x.present,0), absent:rows.reduce((a,x)=>a+x.absent,0),
          sick:rows.reduce((a,x)=>a+x.sick,0), personal:rows.reduce((a,x)=>a+x.personal,0),
          watch:rows.filter(x=>x.maxConsecutive>=3).length}}; },
    /** Your OWN month. Same rows as the admin's view, narrowed to you — see staffAttendanceMonth. */
    myAttendanceMonth: p => H.staffAttendanceMonth(Object.assign({}, p, {onlySelf:true})),
    staffAttendanceMonth: p => {
      // EVERYONE's working time is not a teacher's business — admin (or a read-only Observer) only.
      // Your own is a different question, and the answer is yes: onlySelf narrows this to the caller.
      { const me=staffById(p&&p.staffId); if(!adminLike_(me) && !(p&&p.onlySelf)) fail('NO_PERMISSION','เฉพาะแอดมิน'); }
      /* A MONTH IS JUST A RANGE. It was hard-coded as one — the loop counted 1..daysInMonth and every
       * lookup filtered on .slice(0,7) — so "this week" and "this year" could not be asked at all,
       * and each screen that wanted them was going to invent its own arithmetic. Pass `from`/`to`
       * for any span; pass `month` (or nothing) and it behaves exactly as it always did.
       * `day` stays the day OF THE MONTH, because the calendar lays its cells out by it. */
      const month = ym((p&&p.month)||todayLocal().slice(0,7));
      const [Y,Mo] = month.split('-').map(Number);
      const mFrom = Y+'-'+String(Mo).padStart(2,'0')+'-01';
      const mTo = Y+'-'+String(Mo).padStart(2,'0')+'-'+String(new Date(Y,Mo,0).getDate()).padStart(2,'0');
      const from = (p&&p.from) ? ymd(p.from) : mFrom;
      const to   = (p&&p.to)   ? ymd(p.to)   : mTo;
      const inRange = d => !!d && d>=from && d<=to;
      const dayList = []; {
        const stop=new Date(to+'T00:00:00');
        for(let d=new Date(from+'T00:00:00'); d<=stop; d.setDate(d.getDate()+1))
          dayList.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'));
      }
      const days = dayList.length;
      const today = todayLocal();
      /* A HALF-DAY HOLIDAY IS STILL A WORKING DAY.
       *
       * Reported 2026-08-26: August read "ต้องมาทำงาน 20 วัน" where the school counts 21. The
       * meeting day was in it all along — what was missing was 19/08, a holiday that only ran
       * 07:00–12:00 (the power cut). Everybody was in that afternoon, and the target said they owed
       * the school nothing that day.
       *
       * `hol` is what a cell PRINTS; `holAll` is whether the school was shut. They were the same
       * object, so every question ("is this a working day", "is this person absent") got the
       * whole-day answer for a day that was only half off — the exact distinction schoolDayFor_
       * already draws with `closedAllDay`, which this had not been taught.
       */
      const hol = {}, holAll = {};
      (M.holidays||[]).forEach(h=>{ const d=ymd(h.Date); if(!inRange(d)) return;
        hol[d]=h.NameTH||h.NameEN||'วันหยุด';
        const hs=cfgTime_(h.StartTime,''), he=cfgTime_(h.EndTime,'');
        if(!(hs||he)) holAll[d]=1;                         // blank times = the whole day, as always
        else hol[d] += ' ('+(hs||'00:00')+'-'+(he||'23:59')+')';
      });
      const bc = {}; bigCleaningList_().forEach(s=>{ const d=ymd(s); if(inRange(d)) bc[d]=1; });
      /**
       * DAYS THE SCHOOL EXPECTS PEOPLE IN — the target the whole summary is measured against.
       *
       * Asked for 2026-08-24: "สรุปเป็นโจทย์คือวันที่ต้องมาทำงาน เช่น เดือน 8 ต้องมาทำงาน 21 วัน
       * ไม่นับเสาร์อาทิตย์และวันหยุดของโรงเรียน แต่นับวัน Meeting ให้เป็นวันทำงานด้วย".
       *
       * Weekday, minus the school's holidays, PLUS a Meeting day — which is a working day that
       * happens to fall on a Saturday, and is the whole reason this cannot be counted by looking at
       * the calendar. The school's decision: ONE target for everybody, with leave reported in its
       * own column rather than quietly reducing what a person owed.
       *
       * `toDate` stops the month accusing anybody of being behind at 09:00 on the 12th: days that
       * have not happened yet are in the target but not yet in what is owed.
       */
      const requiredDates = dayList.filter(ds=>{
        /* ORDER IS THE SCHOOL'S DECISION, and it is the other way round from schoolDayFor_ on
         * purpose: a holiday declared over a meeting day CANCELS it (test_required_days pins this),
         * so nobody owes a day the school has since closed. Do not "fix" this to match
         * schoolDayFor_ — that helper answers "is the door open right now", which is a different
         * question from "did this person owe us this day". */
        if(holAll[ds]) return false;                         // the school is shut ALL day
        if(bc[ds]) return true;                              // ...unless it called everybody in
        const g = new Date(ds+'T00:00:00').getDay();
        return g!==0 && g!==6;
      });
      const requiredToDate = requiredDates.filter(ds=>ds<today).length;
      // approved leave, expanded across its date range so a 3-day leave marks all three days
      const leaveOn = {};
      (M.leaves||[]).filter(l=>String(l.Status||'').toUpperCase()==='APPROVED').forEach(l=>{
        const s=ymd(l.StartDate), e=ymd(l.EndDate||l.StartDate); if(!s) return;
        for(let d=new Date(s); ymd(d.toISOString?d.toISOString():d)<=e; d.setDate(d.getDate()+1)){
          const ds=ymd(d.toISOString?d.toISOString():d); if(!inRange(ds)) continue;
          leaveOn[l.StaffID+'|'+ds]={type:l.Type||'ลา', half:halfDay_(l.HalfDay), reason:l.Reason||''};
        }
      });
      const hist={}; (M.staffAttendanceHistory||[]).forEach(h=>{ const d=ymd(h.Date); if(inRange(d)) hist[h.StaffID+'|'+d]=h; });
      const yes=v=>!!(v&&String(v).toUpperCase()==='YES');
      /* OT HOURS THAT SURVIVED APPROVAL.
       *
       * The hours on a CHECKIN_STAFF row are what the clock-out computed, before anybody decided
       * anything about them. An OT the leader or the admin REJECTED still sat in the month's total —
       * "OT 15 ชม." for a teacher who was told no. The OT_RECORDS row is where the decision lives, so
       * the month reads its hours from there: approved and pending count, rejected does not.
       * A HOLIDAY OT is a lump sum with no hours behind it (v257) and adds nothing here.
       */
      /* ...and the OT the month is made of, DAY BY DAY.
       *
       * "OT 14 ชม." was a total with nothing behind it: no way to see which days it came from, how
       * many hours each was, or whether the school had said yes to them. A figure on a payslip that
       * cannot be traced to days is a figure that has to be trusted. Every row is carried through
       * (rejected ones too, marked as such) so the screen can show the whole story and the total can
       * be checked against it.
       *
       * OT วันหยุด is a lump sum with no hours behind it (v257), so it adds nothing to the HOURS —
       * but it is still work that was done and money that was agreed, and the day it falls on must
       * say so. On 22/08/26 ครูจอย's per-person month printed a blank Saturday for a day she had
       * been paid ฿500 to work: the combined calendar knew, and her own page did not.
       */
      const otOn={}, otRowsOn={}, holOtOn={};
      (M.otRecords||[]).forEach(r=>{ const d=ymd(r.Date); if(!inRange(d)) return;
        const k=r.StaffID+'|'+d, st=String(r.Status||'').toUpperCase(), holi=isHolidayOT_(r);
        (otRowsOn[k]=otRowsOn[k]||[]).push({otId:r.OTRecordID||'', date:d, kind:holi?'HOLIDAY':'DAILY',
          hours:Number(r.Hours)||0, amount:Number(r.Amount)||0, status:st, note:String(r.Note||''),
          counted: !holi && st!=='REJECTED'});
        if(holi){ if(st!=='REJECTED') holOtOn[k]={amount:(holOtOn[k]?holOtOn[k].amount:0)+(Number(r.Amount)||0), note:String(r.Note||'')}; return; }
        if(st==='REJECTED') return;
        otOn[k]=(otOn[k]||0)+(Number(r.Hours)||0); });

      // onlySelf → just the caller, and someone who is exempt from clocking in still gets their own
      // (mostly empty) month rather than a screen that looks broken
      const self = !!(p && p.onlySelf);
      const people = M.staff
        .filter(s=>!self || String(s.StaffID)===String(p.staffId))
        .filter(s=>!staffEnded_(s) && (self || s.RequireCheckin!==false))
        .map(s=>{
          const rows=[], missingOut=[], otDays=[]; let present=0, lateDays=0, lateMin=0, leaveDays=0, absent=0, ot=0;
          let holOtDays=0, holOtAmount=0;
          for(let di=0; di<dayList.length; di++){
            const ds = dayList[di], dd = Number(ds.slice(8,10));
            const dow = new Date(ds).getDay();
            const weekend = (dow===0||dow===6) && !bc[ds];
            // someone who had not started yet is simply not part of this month
            const beforeStart = !staffStarted_(s, ds);
            const lv = leaveOn[s.StaffID+'|'+ds] || null;
            let inT='', outT='', lt=0, oth=0, manual=false;
            if(ds===today){ const a=(M.staffAttendanceToday||[]).find(x=>x.StaffID===s.StaffID);
              if(a){ inT=a.CheckIn||''; outT=a.CheckOut||''; lt=Number(a.Late||0); manual=yes(a.InManual)||yes(a.OutManual); } }
            else { const h=hist[s.StaffID+'|'+ds];
              if(h){ inT=h.In||''; outT=h.Out||''; lt=Number(h.Late||0); manual=yes(h.InManual)||yes(h.OutManual); } }
            // ...and the OT hours come from the DECISION, not from what the clock-out worked out
            oth = otOn[s.StaffID+'|'+ds] || 0;
            let status;
            if(beforeStart) status='BEFORE';
            // on temporary leave: not here, and not counted as anything — see staffPaused_
            else if(staffPaused_(s, ds)) status='PAUSED';
            else if(inT) status='IN';
            else if(lv) status='LEAVE';
            // ...and the same distinction here: a day the school was shut for a MORNING is a day
            // somebody was expected in, so not turning up is an absence like any other. The cell
            // still prints the holiday's name (below) — it just no longer excuses the day.
            else if(holAll[ds]) status='HOLIDAY';
            else if(weekend) status='OFF';
            else if(ds>today) status='FUTURE';
            // Today is not over. Someone who has not checked in by the time an admin opens this is
            // not yet an absence — the dashboard is where "who is missing right now" belongs, and
            // counting it here would put a red mark against a teacher at 07:30.
            else if(ds===today) status='TODAY';
            else status='ABSENT';
            /* CAME IN AND NEVER CLOCKED OUT. The month read "ครบ" for ก้อย while two of her days —
             * 07/08 and 19/08 — had an arrival and no departure. A day with no end time has no OT
             * and no hours behind it, and nobody was told: not her, not the head teacher, not the
             * admin. It is only counted once the day is OVER, because an open day at 15:00 is
             * simply someone still at work. */
            const openDay = (status==='IN') && !outT && ds < today;
            if(openDay) missingOut.push(ds);
            /* The OT total is the sum of the APPROVED-OT days, full stop — not "the OT on days that
             * also have a check-in row". An OT the admin entered by hand for a day with no punch
             * (adminAddOT takes any date) was silently missing from the month while appearing on the
             * payslip. Now the total and the day-by-day breakdown below it are the same arithmetic. */
            ot += oth;
            if(status==='IN'){ present++; if(lt>0){ lateDays++; lateMin+=lt; } }
            else if(status==='LEAVE') leaveDays += (lv&&lv.half) ? 0.5 : 1;
            else if(status==='ABSENT') absent++;
            // the day's OT, in full — including a holiday lump sum, which has no hours and is still
            // the reason somebody was at work on a Saturday
            const _otRows = otRowsOn[s.StaffID+'|'+ds] || [];
            _otRows.forEach(r=>otDays.push(r));
            const _hot = holOtOn[s.StaffID+'|'+ds] || null;
            if(_hot){ holOtDays++; holOtAmount += _hot.amount; }
            rows.push({date:ds, day:dd, status, in:inT, out:outT, late:lt, otHours:oth, manual, missingOut:openDay,
              holidayOT:_hot?_hot.amount:0, holidayOTNote:_hot?_hot.note:'',
              holiday:hol[ds]||'', bigCleaning:!!bc[ds],
              leaveType:lv?lv.type:'', leaveHalf:lv?lv.half:'', leaveReason:lv?lv.reason:''});
          }
          return {staffId:s.StaffID, name:s.NameTH||s.Name||'', nameEN:s.NameEN||'', nick:s.Nickname||'', nickEN:s.NicknameEN||'',
            dept:s.Department||'', startDate:ymd(s.StartDate||''),
            /* The target, and this person's share of it. It is the SAME target for everybody (the
             * school's decision) — except that somebody who had not started yet, or had already
             * left, cannot owe the days either side of their employment. When those differ from the
             * school's figure the screen says so rather than printing a shortfall nobody owes. */
            requiredDays: requiredDates.length,
            requiredToDate,
            myRequiredDays: requiredDates.filter(ds=>staffStarted_(s,ds) && !staffEnded_(s,ds) && !staffPaused_(s,ds)).length,
            myRequiredToDate: requiredDates.filter(ds=>ds<today && staffStarted_(s,ds) && !staffEnded_(s,ds) && !staffPaused_(s,ds)).length,
            present, lateDays, lateMinutes:lateMin, leaveDays, absent, otHours:Math.round(ot*100)/100,
            // what the "OT n ชม." total is actually made of, so it can be checked rather than trusted
            otDays:otDays.sort((a,b)=>a.date.localeCompare(b.date)),
            holidayOTDays:holOtDays, holidayOTAmount:holOtAmount,
            missingOut:missingOut.length, missingOutDays:missingOut, days:rows};
        });
      return {month, from, to, daysInMonth:days, today,
        // the answer to "เดือน 8 ต้องมาทำงานกี่วัน", once, for the whole screen
        requiredDays:requiredDates.length, requiredToDate, requiredDates,
        holidays:Object.keys(hol).map(d=>({date:d,name:hol[d]})), bigCleaning:Object.keys(bc),
        missingOut:people.filter(x=>x.missingOut>0).map(x=>({staffId:x.staffId,nick:x.nick,nickEN:x.nickEN,name:x.name,days:x.missingOutDays})),
        staff:people}; },
    /**
     * Days somebody clocked IN and never clocked OUT — the thing the monthly screen used to call
     * "ครบ". Answered on its own so the teacher's home card, the admin's alert and the evening digest
     * all ask the same question rather than three approximations of it.
     *
     * `staffId` narrows it to one person (a teacher may only ask about themselves; the check is the
     * caller's, since a teacher's own home screen is the main user of this).
     */
    staffMissingCheckout: p => {
      const month = ym((p&&p.month)||todayLocal().slice(0,7));
      const d = H.staffAttendanceMonth({month, staffId:(p&&p.staffId)||'', onlySelf:true});
      const list = (d.missingOut||[]).filter(x=>!p||!p.staffId||String(x.staffId)===String(p.staffId));
      return { month, count:list.reduce((a,x)=>a+x.days.length,0), staff:list }; },
    recentAttendance: p => {
      // per DAY, not per person: a half-day holiday or a Big Cleaning day two days ago had different
      // hours, and re-measuring those mornings against today's shift is how a teacher's own history
      // card ended up disagreeing with what was recorded on the day
      const lateOf=(hhmm,onDate)=>{ if(!hhmm)return 0; const h=staffHoursOn_(p.staffId,onDate);
        if(h.dayOff) return 0;
        const raw=Math.max(0,toMin(hhmm)-toMin(h.checkIn)); return Math.max(0, raw-h.grace); };
      const yes=v=>!!(v&&String(v).toUpperCase()==='YES');
      const today=M.staffAttendanceToday.find(x=>x.StaffID===p.staffId);
      const out=[{date:todayLocal(), checkIn:today?today.CheckIn:'', checkOut:today?today.CheckOut:'', late:today?today.Late||0:0, status:today?today.Status:'NONE', manualIn:yes(today&&today.InManual), manualOut:yes(today&&today.OutManual)}];
      M.staffAttendanceHistory.filter(h=>h.StaffID===p.staffId).sort((a,b)=>b.Date.localeCompare(a.Date)).slice(0,3)
        .forEach(h=>out.push({date:h.Date, checkIn:h.In||'', checkOut:h.Out||'', late:lateOf(h.In,h.Date), status:h.In?'IN':'ABSENT', manualIn:yes(h.InManual), manualOut:yes(h.OutManual)}));
      return out; },
    staffCheckin: p => { const _me=staffById(p.staffId)||{};
      if(!staffStarted_(_me)) fail('NOT_STARTED','วันแรกของการทำงานคือ '+ymd(_me.StartDate||'')+' — ยังลงเวลาไม่ได้');
      const hrs=staffHoursOn_(p.staffId, todayLocal());
      // On a day the school reopens at noon, clocking in opens 15 minutes before it does — see
      // atomStaffHours_. Outside that, a closed school still refuses.
      /* OT วันหยุด opens the day for the person who was given it, and for nobody else. The money was
       * agreed as a LUMP SUM, so the punch is a record of when they were here — not a second thing to
       * be paid for: no lateness (a holiday has no shift to be late for) and no hourly OT on top.
       * The school's decision, 2026-08-21. */
      const holOT=hasHolidayOT_(p.staffId, todayLocal());
      if(!holOT){
        if(hrs.dayOff) fail('SCHOOL_CLOSED','วันนี้เป็นวันหยุดของโรงเรียน — ไม่ต้องลงเวลา');
        assertSchoolOpen_(null, false, hrs.openFrom);
      }
      const d=geo(p.lat,p.lng,p.acc); const t=new Date();
      // A Big Cleaning day is worked to ITS OWN hours, and a half-day holiday moves the start to the
      // moment the school opens. Both live in atomStaffHours_, so lateness has ONE definition.
      // Grace is SUBTRACTED, not a threshold: 15 minutes of grace and an arrival 40 minutes after the
      // start is 25 minutes late, not 40. The engine used to treat it as a threshold and Apps Script
      // (handleStaffCheckin, which is what runs live) subtracted it — the two agreed only because the
      // school's grace was 0. Raising it to 15 for a reopening would have made them differ by the
      // grace itself, on the very rows that decide a month's เบี้ยขยัน.
      const raw=lateVs(hrs.checkIn,t); const late=holOT?0:Math.max(0, raw-hrs.grace);
      let r=M.staffAttendanceToday.find(x=>x.StaffID===p.staffId);
      if(!r){r={StaffID:p.staffId,CheckIn:'',CheckOut:'',Status:'NONE',Late:0};M.staffAttendanceToday.push(r);} r.CheckIn=timeLocal();r.Late=late;r.Status='IN';
      return {time:r.CheckIn,lateMinutes:late,rawLate:raw,distance:d,holidayOT:holOT}; },
    /* Clocking OUT is never refused, on any day. Someone who is here and going home must be able to
     * say so — an afternoon closure (13:00–17:00) used to trap every teacher who was already at work,
     * leaving the day with no end time at all. The school's decision, 2026-08-18. */
    staffCheckout: p => { const d=geo(p.lat,p.lng,p.acc); const t=new Date();
      const outT=staffHoursOn_(p.staffId, todayLocal()).checkOut;
      // A day already paid as a LUMP SUM produces no hourly OT — the punch records when they were
      // here, it does not price it a second time.
      const holOT=hasHolidayOT_(p.staffId, todayLocal());
      const ot=holOT?0:Math.max(0,(t.getHours()*60+t.getMinutes())-toMin(outT));
      // OT rule: ≥OTRoundUpMinutes (50) within an hour rounds up to a full hour
      let r=M.staffAttendanceToday.find(x=>x.StaffID===p.staffId); if(!r)fail('NOT_CHECKED_IN','ยังไม่ได้ลงเวลาเข้างาน'); r.CheckOut=timeLocal();r.Status='OUT';r.OTHours=otHoursRule(ot);
      return {time:r.CheckOut,otHours:r.OTHours,otMinutes:ot,distance:d,holidayOT:holOT}; },
    // submit=false → DRAFT (editable, parent not notified); submit=true → sent to the parent and locked
    submitJournal: p => { const date=p.date||todayLocal();
      const submit = p.submit===true || String(p.submit)==='true';
      // the daily journal can only be filled once the child has been checked IN that day (teacher
      // must confirm attendance first). Only enforced for today; back-filling past days is allowed.
      if(date===todayLocal()){ const a=M.studentAttendanceToday.find(x=>x.StudentID===p.studentId);
        const inToday=a&&(a.Status==='IN'||a.Status==='OUT'); if(!inToday) fail('NOT_CHECKED_IN','ยังไม่ได้เช็คอินนักเรียนวันนี้ — กรุณาเช็คอินก่อนจึงจะบันทึกสมุดรายวันได้'); }
      const i=M.journals.findIndex(x=>x.StudentID===p.studentId&&ymd(x.Date)===date);
      if(i>=0 && jStatus_(M.journals[i])==='SUBMITTED') fail('JOURNAL_LOCKED','บันทึกของวันที่ '+date+' ส่งให้ผู้ปกครองแล้ว แก้ไขไม่ได้');
      if(submit && !p.Mood) fail('MISSING_FIELDS','กรุณาเลือกอารมณ์ (Mood)');
      const now=stampLocal();
      // store sheet-cased keys — the payload carries studentId/staffId/date, the record needs StudentID/TeacherID/Date.
      // TeacherID keeps the original author when someone else (an admin after unlocking) edits the entry.
      const rec=Object.assign({},p,{Date:date,StudentID:p.studentId,
        TeacherID:(i>=0&&M.journals[i].TeacherID)||p.staffId,
        ParentComment:(i>=0&&M.journals[i].ParentComment)||'',  // preserve the parent's comment across teacher edits
        TeacherReply:(i>=0&&M.journals[i].TeacherReply)||'',     // preserve the teacher's reply too
        Status:submit?'SUBMITTED':'DRAFT',UpdatedAt:now,SubmittedAt:submit?now:''});
      delete rec.staffId; delete rec.studentId; delete rec.date; delete rec.submit;
      const out={updated:i>=0,submitted:submit,status:rec.Status,submittedAt:rec.SubmittedAt,updatedAt:now};
      if(i>=0) M.journals[i]=rec; else M.journals.push(rec);
      return out; },
    // admin-only (ADMIN_ONLY guard on GAS): reopen a submitted entry for correction. It returns to
    // DRAFT, so it also leaves the parent's view until a teacher submits it again.
    unlockJournal: p => { const date=p.date||todayLocal();
      const i=M.journals.findIndex(x=>x.StudentID===p.studentId&&ymd(x.Date)===date);
      if(i<0) fail('NOT_FOUND','ยังไม่มีบันทึกของวันที่ '+date);
      M.journals[i].Status='DRAFT'; M.journals[i].SubmittedAt='';
      return {studentId:p.studentId,date,status:'DRAFT'}; },
    dspmCriteria: p => H.dspmStatus(p),
    // Admin DSPM-criteria management (all rows for the editor). On GAS the mutations are in-place
    // ROUTES (DspmAdmin.gs); these serve MOCK. Identify a row by (ItemNo, Track).
    dspmAllCriteria: () => (M.dspmCriteria||[]).slice().sort((a,b)=>Number(a.ItemNo)-Number(b.ItemNo))
      .map(r=>({AgeFrom:r.AgeFrom,AgeTo:r.AgeTo,AgeLabelTH:r.AgeLabelTH,ItemNo:r.ItemNo,Skill:r.Skill,Description:r.Description,DescriptionEN:r.DescriptionEN,Method:r.Method,PassCriteria:r.PassCriteria,Track:r.Track||'Teacher'})),
    saveDspmCriteria: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const d=p.data||{}; const track=d.Track||p.track||'Teacher'; const key=(p.itemNo!=null)?p.itemNo:d.ItemNo;
      let r=(key!=null)?(M.dspmCriteria||[]).find(x=>Number(x.ItemNo)===Number(key)&&String(x.Track||'Teacher')===String(track)):null;
      if(r){ ['AgeFrom','AgeTo','AgeLabelTH','Skill','Description','DescriptionEN','Method','PassCriteria'].forEach(k=>{ if(d[k]!==undefined)r[k]=(k==='AgeFrom'||k==='AgeTo')?(Number(d[k])||0):d[k]; }); r.Track=track; return {ok:true,itemNo:Number(r.ItemNo),updated:true}; }
      let mx=0; (M.dspmCriteria||[]).forEach(x=>{const n=Number(x.ItemNo)||0; if(n>mx)mx=n;});
      const rec=Object.assign({ItemNo:mx+1,Track:track},d); rec.AgeFrom=Number(rec.AgeFrom)||0; rec.AgeTo=Number(rec.AgeTo)||0;
      (M.dspmCriteria=M.dspmCriteria||[]).push(rec); return {ok:true,itemNo:rec.ItemNo,updated:false}; },
    deleteDspmCriteria: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const track=p.track||'Teacher'; const i=(M.dspmCriteria||[]).findIndex(x=>Number(x.ItemNo)===Number(p.itemNo)&&String(x.Track||'Teacher')===String(track));
      if(i<0)fail('NOT_FOUND','ไม่พบเกณฑ์'); M.dspmCriteria.splice(i,1); return {ok:true}; },
    /**
     * A result is not just a tick — it is SOMEONE'S JUDGEMENT, ON A DAY. The row now carries who
     * made it and the moment it was recorded, so a parent (or a nurse, or the next teacher) reading
     * it in six months can tell whose opinion they are looking at without decoding a staff id.
     * A re-assessment appends; the latest wins, and the earlier one keeps its own name and time.
     */
    submitAssessment: p => { const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียนรายนี้'); const age=ageMonths(s.DOB); const id='DA-'+String(Date.now()).slice(-4); let n=0;
      const who=staffById(p.staffId)||{}; const at=stampLocal();
      p.results.forEach(r=>{ if(r.result==='nottested'){ // remove any existing latest for this item (mark not tested)
          M.assessments=M.assessments.filter(a=>!(a.StudentID===p.studentId&&a.ItemNo===r.itemNo)); return; }
        const norm=(r.result==='pass'||r.result==='ผ่าน')?'ผ่าน':(r.result==='fail'||r.result==='ไม่ผ่าน')?'ไม่ผ่าน':(r.result==='notenrolled'||r.result==='ยังไม่เข้าโรงเรียน')?'ยังไม่เข้าโรงเรียน':null; if(!norm)return;
        const sk=(M.dspmCriteria.find(c=>c.ItemNo===r.itemNo)||{}).Skill||'';
        M.assessments.push({AssessmentID:id,StudentID:p.studentId,AgeMonth:age,ItemNo:r.itemNo,Skill:sk,Result:norm,
          Date:todayLocal(), TeacherID:p.staffId||'', TeacherName:who.NameTH||who.Name||'', Timestamp:at,
          AdminComment:'', CommentBy:'', CommentAt:''}); n++; });
      return {assessmentId:id,saved:n,by:who.NameTH||who.Name||'',at}; },
    /**
     * The admin's note on ONE assessed item. It sits BESIDE the teacher's result and never replaces
     * it: a second reader disagreeing, or asking for a re-check, is information — overwriting the
     * result would destroy the thing being discussed.
     * Admin only, and it goes on the LATEST result for that item, which is the one on screen.
     */
    commentAssessment: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const rows=(M.assessments||[]).filter(a=>String(a.StudentID)===String(p.studentId)&&String(a.ItemNo)===String(p.itemNo));
      if(!rows.length)fail('NOT_FOUND','ยังไม่มีผลประเมินของข้อนี้');
      const latest=rows.reduce((a,b)=>(String(b.Date||'')>=String(a.Date||'')?b:a));
      const text=String(p.comment==null?'':p.comment).trim();
      latest.AdminComment=text;
      latest.CommentBy = text ? (ap.NameTH||ap.Name||ap.StaffID||'') : '';
      latest.CommentAt = text ? stampLocal() : '';
      logAct('commentAssessment', p.studentId, 'ข้อ '+p.itemNo+(text?': '+text:' (ลบความเห็น)'), actorOf(p));
      return {ok:true, itemNo:Number(p.itemNo), comment:latest.AdminComment, by:latest.CommentBy, at:latest.CommentAt}; },
    studentAssessment: p => { const sum=summarize(p.studentId); sum.items=Object.values(latestByItem(p.studentId)).map(r=>({itemNo:r.ItemNo,skill:r.Skill,result:r.Result,date:r.Date})).sort((a,b)=>a.itemNo-b.itemNo); return sum; },
    // all bands the child has reached (enroll age -> now), each band with items + status
    studentAllBands: p => { const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียนรายนี้'); const age=ageMonths(s.DOB); const latest=latestByItem(p.studentId);
      /* WHO ASSESSED IT, and when. A result with no assessor is a judgement about a child that
       * nobody put their name to — and when a parent asks about one, the first question is who
       * tested it. By NICKNAME, which is how this school refers to its teachers everywhere else. */
      const bands={}; M.dspmCriteria.filter(c=>c.AgeFrom<=age).forEach(c=>{ const r=latest[c.ItemNo];
        (bands[c.AgeLabelTH]=bands[c.AgeLabelTH]||{label:c.AgeLabelTH,from:c.AgeFrom,items:[]}).items.push({itemNo:c.ItemNo,skill:c.Skill,description:c.Description,descriptionEN:(M.dspmEN&&M.dspmEN[c.ItemNo])||'',result:r?r.Result:'ยังไม่ได้รับการทดสอบ',
          by:r?(r.TeacherName||''):'', byNick:r?signedBy_(r.TeacherID,r.TeacherName).nick:'', byLeft:!!(r&&signedBy_(r.TeacherID,r.TeacherName).left), date:r?ymd(r.Date||''):''}); });
      return {studentId:p.studentId,name:s.NameTH,nameEN:s.NameEN,nick:s.Nickname,nickEN:s.NicknameEN,ageMonth:age,enrollDate:s.EnrollDate,
        bands:Object.values(bands).sort((a,b)=>a.from-b.from)}; },

    myLeaves: p => M.leaves.filter(l=>l.StaffID===p.staffId).map(leaveView_),
    // Admin: every leave request (for the list split into pending vs resolved) + the calendar
    allLeaves: p => (M.leaves||[]).slice().sort((a,b)=>String(b.CreatedDate||b.StartDate).localeCompare(String(a.CreatedDate||a.StartDate))).map(leaveView_),
    // Admin edits a leave in place (dates/type/reason); recomputes Days
    editLeave: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const l=M.leaves.find(x=>x.LeaveID===p.leaveId); if(!l)fail('NOT_FOUND','ไม่พบคำขอ');
      // Work out the whole result FIRST, then commit. This used to assign straight onto the stored
      // record and only validate afterwards, so a rejected edit left the row half-changed — a
      // refused "half day over 3 days" still turned a 0.5-day leave into a 3-day one.
      const nStart=p.startDate||l.StartDate, nEnd=p.endDate||l.EndDate;
      const nHalf=(p.halfDay===undefined)?halfDay_(l.HalfDay):halfDay_(p.halfDay);
      let nDays=l.Days;
      if(p.startDate||p.endDate||p.halfDay!==undefined){
        nDays=Math.floor((new Date(nEnd)-new Date(nStart))/864e5)+1;
        if(nHalf){ if(nDays!==1) fail('BAD_INPUT','ลาครึ่งวันได้เฉพาะใบลาวันเดียว'); nDays=0.5; } }
      if(p.type!=null)l.Type=leaveTypeTH_(p.type); if(p.reason!=null)l.Reason=p.reason;
      l.StartDate=nStart; l.EndDate=nEnd; l.HalfDay=nHalf; l.Days=nDays;
      return leaveView_(l); },
    // Admin cancels/deletes a leave request
    cancelLeave: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const i=M.leaves.findIndex(x=>x.LeaveID===p.leaveId); if(i<0)fail('NOT_FOUND','ไม่พบคำขอ'); M.leaves.splice(i,1); return {ok:true}; },
    teamPendingLeaves: p => { const me=staffById(p.staffId)||{}; if(me.PositionLevel!=='Leader'&&me.PositionLevel!=='Admin')return [];
      return M.leaves.filter(l=>l.Status==='PENDING_LEADER').map(leaveView_); },
    leaveQuota: p => { const raw=M.leaveUsed[p.staffId]||{}; const q=cfg.LeaveQuota;
      // Fold any English-labelled total back onto the Thai key it belongs to, or a teacher who used
      // the app in English reads "0 days used" however much leave they have actually taken.
      const used={}; Object.keys(raw).forEach(k=>{ const n=leaveTypeTH_(k); used[n]=(used[n]||0)+(Number(raw[k])||0); });
      return Object.keys(q).map(t=>({type:t,quota:q[t],used:used[t]||0,remain:q[t]-(used[t]||0)})); },
    submitLeave: p => { const st=staffById(p.staffId); const id=nextSeqId_(M.leaves,'LeaveID','LV2026',3);
      // leave entitlement does not carry across the year — a request may not span 31 Dec → next year
      if(String(p.startDate).slice(0,4)!==String(p.endDate).slice(0,4)) fail('CROSS_YEAR','ใช้สิทธิลาข้ามปีไม่ได้ — กรุณาแยกใบลาภายในปีเดียวกัน');
      const lead=(st.PositionLevel==='Leader'||st.PositionLevel==='Admin');
      let days=Math.floor((new Date(p.endDate)-new Date(p.startDate))/864e5)+1;
      // half a day off is half a day of entitlement — 30 days of sick leave becomes 29.5, not 29
      const half=halfDay_(p.halfDay);
      if(half && days!==1) fail('BAD_INPUT','ลาครึ่งวันได้เฉพาะใบลาวันเดียว');
      if(half) days=0.5;
      M.leaves.push({LeaveID:id,StaffID:p.staffId,Department:st.Department,Type:leaveTypeTH_(p.type),StartDate:p.startDate,EndDate:p.endDate,Days:days,HalfDay:half,Reason:p.reason,Status:lead?'PENDING_ADMIN':'PENDING_LEADER',Step1ApproverName:'',Step1Status:lead?'Skipped':'Pending',Step1CrossDept:'',Step2ApproverName:'',Step2Status:'Pending',CreatedDate:todayLocal(),Attachment:p.attachment||''});
      return {leaveId:id,status:lead?'PENDING_ADMIN':'PENDING_LEADER',days,halfDay:half}; },
    approveLeave: p => { const ap=staffById(p.staffId)||{}; const l=M.leaves.find(x=>x.LeaveID===p.leaveId); if(!l)fail('NOT_FOUND','ไม่พบคำขอ'); const yes=p.decision==='approve';
      if(l.Status==='PENDING_LEADER'){ if(ap.PositionLevel!=='Leader'&&ap.PositionLevel!=='Admin')fail('NO_PERMISSION','เฉพาะหัวหน้างาน'); l.Step1ApproverName=ap.NameTH;l.Step1Status=yes?'Approved':'Rejected';l.Step1CrossDept=(ap.Department!==l.Department)?'YES':'NO';l.Status=yes?'PENDING_ADMIN':'REJECTED'; return {status:l.Status,crossDept:l.Step1CrossDept==='YES'}; }
      if(l.Status==='PENDING_ADMIN'){ if(ap.PositionLevel!=='Admin')fail('NO_PERMISSION','เฉพาะผู้บังคับบัญชา'); l.Step2ApproverName=ap.NameTH;l.Step2Status=yes?'Approved':'Rejected';l.Status=yes?'APPROVED':'REJECTED'; return {status:l.Status}; }
      fail('ALREADY_RESOLVED','คำขอนี้ดำเนินการแล้ว'); },
    // `staff` is a sanitized directory of ALL staff (name/nickname) so screens never need client MOCK.staff.
    // `holidays` lets the schedule calendar mark school closures.
    /**
     * 📅 ตาราง — WHOSE working time is this screen about?
     *
     * It used to be everybody's, for everybody: this handler took no payload at all, so any teacher
     * who opened the screen was sent the whole staff's arrivals, departures and approved leave. The
     * school's answer (2026-08-24) is that a person's working time is between them, the head teacher
     * and the admin: a plain teacher sees THEIR OWN times and nobody else's leave.
     *
     * Scoped HERE, not on the screen. Hiding a card still ships the data to the device it was hidden
     * on — the network tab is not a permission model.
     *
     * "Head teacher" is Department='*' (headTeacher_), the same rule the injury and journal scopes
     * already use.
     */
    schedule: p => { const me=staffById(p&&p.staffId)||{};
      const all = adminLike_(me) || me.PositionLevel==='Leader' || headTeacher_(me);
      /* ...and somebody the system does not recognise is a STRANGER, not a colleague. The leave
       * roster and the staff directory go to the STAFF; an id that matches nobody gets an empty
       * screen rather than the school's week. staffById returns {} for an unknown id, never null,
       * so the test has to be on the ID itself. */
      const isStaff = !!me.StaffID || all;
      const mine = id => String(id)===String((p&&p.staffId)||'');
      const view = s=>({StaffID:s.StaffID, NameTH:s.NameTH, NameEN:s.NameEN, Nickname:s.Nickname, NicknameEN:s.NicknameEN,
        Role:s.Role, Department:s.Department, RequireCheckin:s.RequireCheckin!==false});
      const keep = (list, idOf) => all ? list : list.filter(x=>mine(idOf(x)));
      return {
        // the screen needs to know which of the two it is looking at — it must not re-derive it
        canSeeAll: all, staffId: (p&&p.staffId)||'',
        /* A NAME IS NOT A SECRET; A CLOCK IS.
         * Phase C scoped this whole handler to the caller, and took "who is off on Thursday" away
         * from the teachers along with everybody's arrival times. The school corrected that on
         * 2026-08-24: cover is a question the staff answer between them, so the LEAVE goes to
         * everyone — the name and the KIND, never the reason — while the TIMES stay private.
         * A plain teacher therefore gets a name-only directory: enough to print "ก้อย (ลาป่วย)",
         * and not the department, role or clock-in requirement of every colleague. */
        staff: all ? M.staff.map(view)
          : !isStaff ? []
          : M.staff.map(s=>({StaffID:s.StaffID, NameTH:s.NameTH, NameEN:s.NameEN,
              Nickname:s.Nickname, NicknameEN:s.NicknameEN})),
        schedule: keep(M.workSchedule||[], w=>w.StaffID),
        leavesToday: (!isStaff?[]:(M.leaves||[]).filter(l=>l.Status==='APPROVED')).map(l=> all ? l : ({
          // the reason can be a medical detail — it is the approver's business, not the roster's
          LeaveID:l.LeaveID, StaffID:l.StaffID, Type:l.Type, Status:l.Status,
          StartDate:l.StartDate, EndDate:l.EndDate, HalfDay:l.HalfDay })),
        attendance: keep(M.staffAttendanceToday||[], a=>a.StaffID),
        /* TODAY IS MISSING FROM `history` BY CONSTRUCTION — hydration splits CHECKIN_STAFF into
         * "today" and "everything else", so the calendar drew a blank square for the day somebody
         * had just clocked in on. Fold today's rows back in, in the same shape, so the calendar is
         * about the whole month rather than the month up to yesterday. */
        history: keep((M.staffAttendanceHistory||[]).concat(
          (M.staffAttendanceToday||[]).filter(a=>a.CheckIn||a.CheckOut).map(a=>({
            Date:todayLocal(), StaffID:a.StaffID, In:a.CheckIn||'', Out:a.CheckOut||'',
            InManual:a.InManual, OutManual:a.OutManual, Late:Number(a.Late)||0, OTHours:Number(a.OTHours)||0 }))
        ), h=>h.StaffID),
        // a staffing ratio is a fact about other people; it belongs to whoever covers for them
        staffing: all ? H.staffingByNursery() : [],
        holidays: (M.holidays||[]).map(h=>({Date:h.Date, NameTH:h.NameTH, NameEN:h.NameEN})), bigCleaning: bigCleaningList_() }; },
    // present-staff / total-staff per Nursery for the daily summary (e.g. "Nursery 1 2/2")
    // a staff's Department may be a comma list of the department(s) they cover (or '*' = all) → count in each
    staffingByNursery: () => { const deps=(Array.isArray(cfg.Departments)?cfg.Departments:String(cfg.Departments||'').split(',')).map(d=>String(d).trim()).filter(Boolean);
      const covers=(s,dep)=>{ const d=String(s.Department||''); return d==='*'||d.split(',').map(x=>x.trim()).indexOf(dep)>=0; };
      return deps.map(dep=>{
        const team=M.staff.filter(s=>covers(s,dep)&&s.Role==='Teacher'&&s.RequireCheckin!==false&&staffStarted_(s));
        const present=team.filter(s=>{ const a=M.staffAttendanceToday.find(x=>x.StaffID===s.StaffID); return a&&(a.Status==='IN'||a.Status==='OUT'); }).length;
        return {dept:dep, present, total:team.length}; }).filter(x=>x.total>0); },

    payrollConfig: p => Object.assign({SocialSecurityDeduct:true,ChildThreshold:cfg.ExtraChildThreshold||31,ChildMultiplier:cfg.ExtraChildRate,TaxDeduct:false}, M.payrollConfig[p.staffId]||{}),
    setPayrollConfig: p => { M.payrollConfig[p.staffId]=Object.assign(M.payrollConfig[p.staffId]||{},p.config||{}); return M.payrollConfig[p.staffId]; },
    computePayroll: p => { const st=staffById(p.staffId); const pc=Object.assign({PayType:'monthly',DailyRate:0,SocialSecurityDeduct:true,ChildMultiplier:cfg.ExtraChildRate,TaxDeduct:false}, M.payrollConfig[p.staffId]||{});
      // base = monthly salary, OR daily-rate × days worked (new/special teachers)
      const payType=p.payType||pc.PayType||'monthly'; const dailyRate=p.dailyRate!=null?Number(p.dailyRate):pc.DailyRate; const daysWorked=Number(p.daysWorked||0);
      let base= payType==='daily' ? dailyRate*daysWorked : (p.baseSalary!=null?Number(p.baseSalary):(st.BaseSalary||0));
      /* On temporary leave this month → the admin's rule replaces the salary. AFTER the payload,
       * because the payroll screen writes its base-salary box straight back to STAFF.BaseSalary:
       * reducing it through the payload would overwrite the person's real salary with half of it. */
      const pauseSalary = staffPauseSalary_(st, p.month, base);
      if(pauseSalary) base = pauseSalary.amount;
      /* diligence amounts: per-staff override (payrollConfig) → else the school-wide figure.
       * BLANK IS NOT AN OVERRIDE OF ZERO. Clearing the box to go back to the school default writes
       * '' into the config, and `'' != null` is true — so the old test took the override, and
       * Number('') is 0. Somebody who removed their per-person figure would have been paid no
       * เบี้ยขยัน at all, silently. Asked in one place so no caller can get it wrong. */
      const perStaff=(v)=> (v!=null && v!=='' && isFinite(Number(v))) ? Number(v) : null;
      const attendAmt=p.diligenceAttend!=null?Number(p.diligenceAttend):(perStaff(pc.DiligenceAttendanceAmount)!=null?perStaff(pc.DiligenceAttendanceAmount):cfg.DiligenceAttendanceAmount);
      const fbAmt=p.diligenceFb!=null?Number(p.diligenceFb):(perStaff(pc.DiligenceFacebookAmount)!=null?perStaff(pc.DiligenceFacebookAmount):cfg.DiligenceFacebookAmount);
      // any-type leave over the monthly limit (default 3) forfeits the CHILD-RATE income (เรทจำนวนเด็ก),
      // applied to autoChild below. เบี้ยขยัน is untouched here (its own "ไม่ลา" rule already covers leave).
      const ls=H.staffLeaveSummary({staffId:p.staffId,month:p.month}); const leaveExceeds=ls.exceeds;
      const dA=p.attendanceEligible!==false?attendAmt:0; const dF=p.facebookPosted?fbAmt:0; const dT=dA+dF;
      // ...and the same rule for the child rate: a blank per-staff figure is not a rate of zero
      const childMult=p.childMultiplier!=null?Number(p.childMultiplier)
        :(perStaff(pc.ChildMultiplier)!=null?perStaff(pc.ChildMultiplier):cfg.ExtraChildRate);
      // child-rate count is AUTO from the DB unless overridden: children from #ChildThreshold onward
      const threshold=p.childThreshold!=null?Number(p.childThreshold):(pc.ChildThreshold||cfg.ExtraChildThreshold||31);
      // leave over the limit → child-rate auto-count drops to 0 (Admin can still type a count to override).
      // FOR THE MONTH BEING PAID. ratedChildCount used to ignore the month entirely and count every
      // absence ever recorded, so an old absence kept a child out of the rate for good.
      const ratedTotal=H.ratedChildCount({month:p.month}).rated; const autoChild=leaveExceeds?0:Math.max(0, ratedTotal-(threshold-1));
      const childCount=p.extraChildCount!=null?Math.max(0,p.extraChildCount):autoChild;
      const ec=childCount*childMult; const tc=Math.min(cfg.TrainingCertMaxPerMonth,Math.max(0,p.trainingCertCount||0))*cfg.TrainingCertRate;
      // signed adjustment lines (e.g. {label:'มาสาย',amount:-200}). A positive line is income and a
      // negative one is a deduction, folded INTO the two totals — applying them to the net separately
      // made the slip print an "อื่นๆ" figure that was not inside รวมรายได้ / รวมหัก.
      const adj=(Array.isArray(p.adjustments)?p.adjustments:[]).filter(a=>a&&(String(a.label||'').trim()||Number(a.amount||0)));
      let adjPlus=0, adjMinus=0; adj.forEach(a=>{ const v=Number(a.amount||0); if(v>0) adjPlus+=v; else adjMinus+=-v; });
      const adjSum=adjPlus-adjMinus;
      // OT approved too late to make an earlier month's salary is paid here on its own line, so the
      // teacher is never short-paid and the earlier slip stays exactly as it was signed off.
      const carry=H.otCarryOver({staffId:p.staffId,month:p.month});
      const otCarry=p.otCarry!=null?Number(p.otCarry):carry.total;
      const oi=ec+tc+(p.otherIncome||0)+adjPlus; const ot=p.otEvening||0; const hb=p.holidayBonus||0;
      // OT วันหยุด — its own line, so the slip says what the money was for
      const otHol=p.otHoliday!=null?Number(p.otHoliday):H.staffMonthlyOT({staffId:p.staffId,month:p.month}).holiday;
      const gross=base+dT+oi+ot+otCarry+otHol+hb;
      const ssDeduct=(p.socialSecurityDeduct!=null?p.socialSecurityDeduct:pc.SocialSecurityDeduct)!==false;
      const ss=p.socialSecurity!=null?p.socialSecurity:(ssDeduct?Math.min(Math.round(base*cfg.SocialSecurityRate),cfg.SocialSecurityMax):0);
      // เงินสมทบ is a savings fund: the teacher's half is deducted, the school matches it, and the
      // fund grows by BOTH halves. Only the teacher's half is a deduction.
      const contrib=Number(p.contribution||0);
      const matchRate=Number(cfg.ContributionMatchRate!=null?cfg.ContributionMatchRate:1);
      const contribEmp=Math.round(contrib*matchRate*100)/100;
      let accum=Number(st.ContributionOpening||0)+contrib+contribEmp;
      (M.payroll||[]).forEach(r=>{ if(r.StaffID!==p.staffId||ym(r.Month)===ym(p.month))return;
        const own=Number(r.Contribution||0);
        const emp=(r.ContributionEmployer==null||r.ContributionEmployer==='')?Math.round(own*matchRate*100)/100:Number(r.ContributionEmployer);
        accum+=own+emp; });
      accum=Math.round(accum*100)/100;
      const od=(p.otherDeductions||0)+adjMinus; const dd=contrib+od; const total=ss+dd; const net=gross-total;
      const rec={PayrollID:nextSeqId_(M.payroll,'PayrollID','PR',4),StaffID:p.staffId,Month:p.month,PayType:payType,DailyRate:dailyRate,DaysWorked:daysWorked,BaseSalary:base,DiligenceAttendance:dA,DiligenceFacebook:dF,DiligenceTotal:dT,ExtraChildAmount:ec,ChildCount:childCount,ChildThreshold:threshold,RatedTotal:ratedTotal,ChildMultiplier:childMult,TrainingCertAmount:tc,OTEvening:ot,OTCarry:otCarry,OTCarryDetail:JSON.stringify(carry.detail||[]),OTHoliday:otHol,HolidayBonus:hb,OtherIncome:oi,GrossIncome:gross,SocialSecurity:ss,Contribution:contrib,ContributionEmployer:contribEmp,ContributionAccum:accum,OtherDeductions:od,TotalDeductions:total,Adjustments:adj,AdjustmentsTotal:adjSum,NetPay:net,BankAccount:cfg.BankName,LeaveDays:ls.days,LeaveLimit:ls.limit,LeaveExceeds:leaveExceeds,PauseSalaryMode:pauseSalary?pauseSalary.mode:'',PauseFrom:pauseSalary?ymd(st.PauseFrom||''):'',PauseTo:pauseSalary?ymd(st.PauseTo||''):'',PauseReason:pauseSalary?(st.PauseReason||''):''};
      const i=M.payroll.findIndex(x=>x.StaffID===p.staffId&&ym(x.Month)===ym(p.month));
      // preview → return the numbers without persisting (see the GAS route)
      if(p.preview){ rec.PayrollID=i>=0?M.payroll[i].PayrollID:''; rec.Preview=true; rec.Saved=i>=0; return rec; }
      rec.Saved=true;
      if(i>=0)M.payroll[i]=rec; else M.payroll.push(rec); return rec; },
    /**
     * The slip, with the accumulated fund WORKED OUT rather than read back.
     *
     * เงินสมทบ is a savings fund: the teacher's half is deducted and the school matches it, so the
     * fund grows by BOTH halves — 200 deducted means 400 added. The running total used to be stored
     * on the payroll row when it was calculated, and a row saved before the employer half was
     * recorded therefore holds a total that is short by the school's share for every such month.
     * That is exactly what "35,200 where it should say 35,400" is.
     *
     * The total is derivable — opening balance plus both halves of every month — so it is derived
     * here, every time, and a stale stored figure can no longer be shown to anyone. Months whose
     * employer half was never written down have it reconstructed at the current match rate: the
     * school did pay it, the app simply did not record it.
     */
    /**
     * The months this person actually HAS a payslip for — newest first.
     *
     * A teacher needs an old slip for a loan or a bank account, and the screen offered a bare month
     * box: every month since the dawn of time, almost all empty, with no way to tell which existed
     * without opening them one at a time. (Opening them was also what wrote the duplicate rows —
     * see handleComputePayroll.) Asked 2026-08-29.
     *
     * ONE ENTRY PER MONTH even where the sheet has several: a teacher's own history is the last
     * place a duplicate should surface, since they cannot act on it and it only makes them doubt the
     * rest. The one shown is the one with the strongest evidence — paid, then sent, then the larger.
     */
    myPayslipMonths: p => { const sid=String((p&&p.staffId)||'');
      if(!sid) fail('BAD_INPUT','ต้องระบุ StaffID');
      const seen={};
      (M.payroll||[]).forEach(r=>{ if(String(r.StaffID)!==sid) return;
        const m=ym(r.Month); if(!m) return;
        const cand={ month:m, netPay:Number(r.NetPay||0),
          slipSent:String(r.SlipSent||'').toUpperCase()==='YES',
          paidDate:r.PaidDate?ymd(r.PaidDate):'' };
        const cur=seen[m]; if(!cur){ seen[m]=cand; return; }
        const better=(!!cand.paidDate && !cur.paidDate) ||
          (!!cand.paidDate===!!cur.paidDate && cand.slipSent && !cur.slipSent) ||
          (!!cand.paidDate===!!cur.paidDate && cand.slipSent===cur.slipSent && cand.netPay>cur.netPay);
        if(better) seen[m]=cand; });
      const months=Object.keys(seen).sort().reverse().map(m=>seen[m]);
      return { staffId:sid, count:months.length, months }; },
    getPayslip: p => { const r=M.payroll.find(x=>x.StaffID===p.staffId&&ym(x.Month)===ym(p.month)); if(!r) return null;
      const st=staffById(p.staffId)||{};
      const matchRate=Number(cfg.ContributionMatchRate!=null?cfg.ContributionMatchRate:1);
      const empOf=x=>{ const own=Number(x.Contribution||0);
        return (x.ContributionEmployer==null||x.ContributionEmployer==='')?Math.round(own*matchRate*100)/100:Number(x.ContributionEmployer); };
      let accum=Number(st.ContributionOpening||0);
      (M.payroll||[]).forEach(x=>{ if(x.StaffID!==p.staffId)return; accum+=Number(x.Contribution||0)+empOf(x); });
      return Object.assign({},r,{ContributionEmployer:empOf(r), ContributionAccum:Math.round(accum*100)/100}); },
    markSalaryPaid: p => { const r=M.payroll.find(x=>x.StaffID===p.staffId&&ym(x.Month)===ym(p.month));
      if(!r) fail('NOT_FOUND','ยังไม่มีรายการจ่ายของเดือนนี้ — กดบันทึกเงินเดือนก่อน');
      const paid=p.paid!==false; r.SlipSent=paid?'YES':'NO'; r.PaidDate=paid?todayLocal():''; r.SlipUrl=paid?(p.slipUrl||r.SlipUrl||''):'';
      logAct('markSalaryPaid',p.staffId,(paid?'จ่ายเงินเดือนแล้ว ':'ยกเลิกสถานะจ่าย ')+ym(p.month),actorOf(p));
      return {ok:true,paid}; },
    // Rebuild every staff member's accumulated เงินสมทบ from source (opening + both halves of every
    // month). ALWAYS preview first — nothing is written until preview:false. Mirrors src/Payroll.gs.
    recomputeContributions: p => { const preview=p.preview!==false;
      const matchRate=Number(cfg.ContributionMatchRate!=null?cfg.ContributionMatchRate:1);
      const rows=[]; let written=0;
      M.staff.forEach(s=>{ const opening=Number(s.ContributionOpening||0); let own=0,emp=0,months=0;
        (M.payroll||[]).forEach(r=>{ if(r.StaffID!==s.StaffID)return;
          const c=Number(r.Contribution||0), e=Number(r.ContributionEmployer||0); if(!c&&!e)return;
          months++; own+=c; emp+=(r.ContributionEmployer==null||r.ContributionEmployer==='')?Math.round(c*matchRate*100)/100:e; });
        const after=Math.round((opening+own+emp)*100)/100, before=Number(s.ContributionAccum||0);
        if(Math.abs(after-before)<0.005)return;
        // ContributionLocked ('YES') locks the manually-entered OPENING balance, not this derived total
        const lk=String(s.ContributionLocked||'').toUpperCase(); const locked=lk==='YES'||lk==='TRUE'||s.ContributionLocked===true;
        rows.push({staffId:s.StaffID,name:s.NameTH||s.Name||s.StaffID,opening,months,employee:Math.round(own*100)/100,
          employer:Math.round(emp*100)/100,before,after,diff:Math.round((after-before)*100)/100,locked});
        if(!preview){ s.ContributionAccum=after; written++; } });
      return {preview,matchRate,changed:rows.length,written,rows}; },
    // approved leave DAYS of EVERY type (sick + personal + vacation …) in a month, and whether it
    // passes the child-rate limit (leave > limit → the child-rate income เรทจำนวนเด็ก is not calculated)
    staffLeaveSummary: p => { const month=ym(p.month||todayLocal().slice(0,7));
      const days=(M.leaves||[]).filter(l=>String(l.StaffID)===String(p.staffId)&&String(l.Status||'').toUpperCase()==='APPROVED'
          &&ym(l.StartDate||l.Date)===month)
        .reduce((a,l)=>a+(Number(l.Days)||1),0);
      const limit=Number(cfg.DiligenceLeaveMaxDays||3);
      return {month, days, limit, exceeds:days>limit}; },
    // Admin alert: payroll should be summarized 1 day before month-end
    payrollReminderDue: () => { const n=new Date(); const last=new Date(n.getFullYear(),n.getMonth()+1,0).getDate();
      return {due:n.getDate()===last-1, today:n.getDate(), lastDay:last, month:todayLocal().slice(0,7)}; },

    // Admin finance dashboard: tuition collection per student + salary payout per teacher + income/expense
    financeSummary: p => { const month=ym(p.month||todayLocal().slice(0,7));
      /* Group ONCE, then look up — instead of re-scanning every collection for every child.
       *
       * The work used to be shaped like this: for each child, scan all bills, then all OT rows, then
       * all charges, and for each of THOSE items scan the whole slip book again. At the live school's
       * size that is 806 passes over PAYMENT_SLIPS and 424,000 rows visited for 31 children
       * (measured — tools/bench_finance.js). It grows with students × slips, so it gets worse every
       * term. Grouping first makes it one pass over each collection, whatever the roll.
       *
       * The arithmetic below is untouched — only where the rows come from changed. RefKind/RefID/
       * Status are ids and enums (strings on the sheet), which is what makes a keyed sum equivalent
       * to the filter it replaces; tools/test_finance_index.js checks the two agree student by
       * student, including duplicate bills, rejected slips and part payments.
       */
      const groupBy=(arr,key,keep)=>{ const m={}; (arr||[]).forEach(r=>{ if(keep&&!keep(r)) return;
        const k=String(r[key]||''); (m[k]||(m[k]=[])).push(r); }); return m; };
      const billsBy=groupBy(M.payments,'StudentID',x=>ym(x.Month)===month);
      const otBy=groupBy(M.otDaily,'StudentID',o=>ym(o.Date)===month);
      const chBy=groupBy(M.studentCharges,'StudentID',c=>ym(c.Month)===month);
      const slipSum={};                                   // 'kind|refId|STATUS' -> total amount
      paySlips_().forEach(s=>{ const k=s.RefKind+'|'+s.RefID+'|'+s.Status; slipSum[k]=(slipSum[k]||0)+Number(s.Amount||0); });
      const sum=(kind,refId,statuses)=>statuses.reduce((a,st)=>a+(slipSum[kind+'|'+refId+'|'+st]||0),0);
      // enrolledStudents, not activeStudents: a child on temporary leave still has to be billable —
      // this is how the school collects a deposit or a first month BEFORE the child starts. They are
      // listed last (see the sort below) so they never crowd the children currently attending.
      const students=enrolledStudents().map(s=>{
        // a student may (wrongly) have >1 bill for a month — prefer the PAID/PARTIAL one over duplicates
        const bills=billsBy[String(s.StudentID)]||[];
        const b=bills.find(x=>x.Status==='PAID')||bills.find(x=>x.Status==='PARTIAL')||bills[0];
        // OT: subtract what has actually been confirmed, exactly as extra charges do below. This used
        // to count the WHOLE amount of any non-PAID row, so a family who had transferred and had the
        // slip approved still read as owing the full sum until the row happened to flip to PAID.
        const otRows=otBy[String(s.StudentID)]||[];
        const otOpenRows=otRows.filter(otOpenRec);
        const otOpen=otOpenRows
          .reduce((a,o)=>a+Math.max(0,Number(o.Amount||0)-sum('ot',o.OTID,['CONFIRMED'])),0);
        const otCollected=otRows.reduce((a,o)=>a+(o.Status==='PAID'?Number(o.Amount||0):sum('ot',o.OTID,['CONFIRMED'])),0);
        // extra charges (now separate payables): open = still owed, collected = confirmed slips
        const chs=chBy[String(s.StudentID)]||[];
        // chargeOpen_ — a charge that is PAID or CANCELLED is settled. Without it a waived fee stayed
        // on the family's balance for ever, which is the same class of mistake as the cash one below.
        const chOpen=chs.filter(chargeOpen_).reduce((a,c)=>a+Math.max(0,Number(c.Amount||0)-sum('charge',c.ChargeID,['CONFIRMED'])),0);
        const chCollected=chs.reduce((a,c)=>a+sum('charge',c.ChargeID,['CONFIRMED']),0);
        // Money the parent HAS sent that is only waiting for the school to check the slip. It is not
        // collected yet, but calling it "ค้างชำระ" blames the family for the school's own queue.
        const otPending=otOpenRows.reduce((a,o)=>a+sum('ot',o.OTID,['SUBMITTED','PENDING_VERIFY']),0);
        const chPending=chs.reduce((a,c)=>a+sum('charge',c.ChargeID,['SUBMITTED','PENDING_VERIFY']),0);
        const amount=b?Number(b.Amount||0):0;
        // advance payment covers this month's tuition IN FULL → counts as collected (extras/OT are
        // tracked separately and are still owed). Capping this at the current plan price left the
        // difference showing as an unpaid balance the moment a package price changed.
        const prepay = prepayInfo_(s.StudentID, month);
        /* A PREPAID MONTH NO LONGER HAS A BILL AT ALL (v285) — and the money is still the school's.
         *
         * This read the credit off the bill, so the day issueBill started refusing to re-bill a
         * month that was already paid for, every covered month would have quietly dropped out of
         * "รายได้รวม". The school would have seen its own takings shrink by one month's tuition per
         * prepaid child, for a change that was supposed to be about not sending a duplicate.
         *
         * With a bill, the figure is unchanged (billTuition_, so a bill issued at an old price still
         * settles in full). Without one, it is the tuition that month WOULD have been — the same
         * arithmetic issueBill would have used, proration and monthly discount included.
         */
        const prepaidTuition = !prepay ? 0 : (b ? billTuition_(b)
          : (()=>{ const pl=studentPlan(s), pp=pl.price||0;
              return tuitionForMonth_(s, month, Math.max(0, pp-studentDiscount_(s,pp))).amount; })());
        const billConfirmed = b ? sum('bill', b.BillingID, ['CONFIRMED']) : 0;
        const billPending = b ? sum('bill', b.BillingID, ['SUBMITTED', 'PENDING_VERIFY']) : 0;
        /* Tuition still owed, after the advance-payment credit and any confirmed slips — and after
         * the bill's own Status.
         *
         * CASH. A bill settled in cash is stamped PAID and has no slip, so `amount − prepaid −
         * confirmedSlips` still came to the whole bill: the same money was counted as COLLECTED (the
         * line below reads Status==='PAID') and as OUTSTANDING, at the same time, and `paid` read
         * false so the family was in neither the paid count nor honestly in the unpaid one. A school
         * that takes cash saw its own takings as a debt. Reported 2026-08-24.
         */
        const billPaid = !!b && String(b.Status||'').toUpperCase()==='PAID';
        const tuitionOpen = billPaid ? 0 : Math.max(0, amount - prepaidTuition - billConfirmed);
        const otherOpen = otOpen + chOpen;                 // OT + extra charges — NOT tuition
        // of what is still open, how much is already sitting in the admin's slip queue
        const tuitionPending = Math.min(tuitionOpen, billPending);
        const otherPending = Math.min(otherOpen, otPending + chPending);
        const due = tuitionOpen + otherOpen;               // what this family actually still owes
        // money actually IN = tuition (full if PAID else confirmed slips) + prepaid tuition + confirmed charges + paid OT
        const collected = (b ? (b.Status==='PAID'?amount:billConfirmed) : 0) + prepaidTuition + chCollected + otCollected;
        // "paid" now means the TUITION is settled — by transfer, in cash, or in advance. The raw sheet
        // Status alone said UNPAID for a prepaid month, so the finance list showed a debt that was
        // already paid months ago.
        const paid = tuitionOpen<=0 && (!!b || !!prepay);
        // the PARTS of `collected`, named. `collected` itself is every baht received from this family
        // this month — tuition, extra charges and OT together — which is not what a line labelled
        // "ค่าเทอม" may show. Splitting it is what lets each be reported as itself.
        const tuitionIn = (b ? (b.Status==='PAID'?amount:billConfirmed) : 0) + prepaidTuition;
        return {studentId:s.StudentID,name:s.NameTH,nameEN:s.NameEN,nick:s.Nickname,nickEN:s.NicknameEN,plan:s.Plan,
          amount,collected,tuitionIn,chCollected,otCollected,otOpen,chOpen,tuitionOpen,otherOpen,due,paid,
          tuitionPending,otherPending,pendingVerify:tuitionPending+otherPending,
          prepaid:!!prepay,prepay:prepay||null,prepaidTuition,
          partial:!b?false:(tuitionOpen>0 && (billConfirmed>0||prepaidTuition>0)),
          /* `paused` = away RIGHT NOW. `pauseScheduled` = a leave is on record and has not started,
           * which is the same distinction staff already have (endScheduled). A child whose leave
           * begins on the 4th is at school on the 2nd: still billed, still on the class list, still
           * expected — and the finance screen showed NOTHING about her at all while the dashboard
           * card listed her under "นักเรียนลาชั่วคราว". Two screens, two answers (2026-09-02). */
          paused:studentPaused_(s), pauseFrom:ymd(s.PauseFrom||''), pauseTo:ymd(s.PauseTo||''),
          pauseScheduled: !studentPaused_(s) && !!ymd(s.PauseFrom||'') && todayLocal() < ymd(s.PauseFrom),
          status:b?b.Status:'NO_BILL',slipAmount:b?b.SlipAmount||0:0}; })
        // children currently attending first, those on temporary leave at the bottom
        .sort((a,b2)=>(a.paused?1:0)-(b2.paused?1:0));
      const staff=M.staff.filter(s=>s.Role==='Teacher').map(s=>{ const pr=M.payroll.find(x=>x.StaffID===s.StaffID&&ym(x.Month)===month);
        return {staffId:s.StaffID,name:s.NameTH,nameEN:s.NameEN,nick:s.Nickname,nickEN:s.NicknameEN,net:pr?pr.NetPay:0,paid:!!pr&&pr.SlipSent==='YES',computed:!!pr}; });
      /* THREE KINDS OF MONEY, KEPT APART.
       *
       * `tuitionCollected` has never been tuition: it is Σ collected — tuition, extra charges and OT
       * added together. The dashboard printed it under "ค่าเทอมรายเดือน · เก็บได้", and then added
       * otCollected to it for the month's total, counting OT twice. Reported 2026-08-24 as "ระบบแสดง
       * ยอดเงินไม่ถูกต้อง": a ฿2,000 entry fee was nowhere on the screen while the totals were quietly
       * over by the OT.
       *
       * The name is kept (older callers) but every screen now uses the precise ones below.
       */
      const collectedTuition=students.reduce((a,s)=>a+Number(s.tuitionIn||0),0);
      const collectedCharges=students.reduce((a,s)=>a+Number(s.chCollected||0),0);
      const collectedOT=students.reduce((a,s)=>a+Number(s.otCollected||0),0);
      const collectedAll=collectedTuition+collectedCharges+collectedOT;
      const tuitionCollected=collectedAll;                 // legacy name — it always meant "everything"
      const otCollected=collectedOT;
      // TUITION outstanding means tuition — it used to be (due − collected), which folded OT and extra
      // charges into a tile labelled "ค้างค่าเทอม". They are reported separately as otherOutstanding.
      const tuitionOutstanding=students.reduce((a,s)=>a+Number(s.tuitionOpen||0),0);
      const otherOutstanding=students.reduce((a,s)=>a+Number(s.otherOpen||0),0);
      // otherOutstanding is OT + extra charges TOGETHER, which is why an entry fee could hide inside
      // it without ever appearing on a screen. Each is now also reported on its own.
      const chargesOutstanding=students.reduce((a,s)=>a+Number(s.chOpen||0),0);
      const otOutstanding=students.reduce((a,s)=>a+Number(s.otOpen||0),0);
      const salaryExpense=staff.reduce((a,s)=>a+s.net,0);
      const income=collectedAll;                           // was collectedAll + OT again
      return {month, students, staff, income, tuitionCollected, otCollected, tuitionOutstanding, otherOutstanding,
        collectedTuition, collectedCharges, collectedOT, collectedAll, chargesOutstanding, otOutstanding,
        expense:salaryExpense, net:income-salaryExpense,
        prepaidStudents:students.filter(s=>s.prepaid).length,
        studentsPaid:students.filter(s=>s.paid).length, studentsTotal:students.length,
        staffPaid:staff.filter(s=>s.computed).length, staffTotal:staff.length}; },

    // ---------- Admin ----------
    dashboard: () => { const std=activeStudents();
        // class list = CLASSES rows ∪ departments master ∪ every class a student is actually in,
        // so students in a department without a CLASSES row are never hidden from the dashboard.
        const names=[]; const add=n=>{ if(n&&names.indexOf(n)<0)names.push(n); };
        (M.classes||[]).forEach(c=>add(c.ClassName)); (Array.isArray(cfg.Departments)?cfg.Departments:String(cfg.Departments||'').split(',')).forEach(d=>add(String(d).trim())); std.forEach(s=>add(s.Class));
        const cls=names.map(name=>{ const studs=std.filter(s=>s.Class===name);
        const stat=studs.map(s=>{ const a=M.studentAttendanceToday.find(x=>x.StudentID===s.StudentID); return {studentId:s.StudentID,name:s.NameTH,nameEN:s.NameEN,nick:s.Nickname,nickEN:s.NicknameEN,           // ...||a.Time: on GAS deriveStudentToday_ only ever sets Status and Time, so CheckIn alone
          // was always blank here — the same fallback teacherClassAttendance has always had.
          status:a?a.Status:'ABSENT', in:a?(a.CheckIn||(a.Status==='IN'?a.Time:'')||''):'', out:a?(a.CheckOut||(a.Status==='OUT'?a.Time:'')||''):'', reason:a?a.Reason:'',
          // back on the list because the return date has come — still marked, until someone confirms
          pauseDue:pauseDue_(s), pauseTo:ymd(s.PauseTo||'')}; });
        return {className:name,total:studs.length,in:stat.filter(s=>s.status==='IN').length,out:stat.filter(s=>s.status==='OUT').length,leave:stat.filter(s=>s.status==='LEAVE').length,absent:stat.filter(s=>s.status==='ABSENT').length,students:stat}; })
        .filter(c=>c.total>0 || (M.classes||[]).some(mc=>mc.ClassName===c.className)); // hide empty extra depts, keep real classes
      /* staff with check-in turned OFF never clock in — exclude them entirely (not counted, not
       * "absent") — and NOR DOES ANYONE WHOSE LAST DAY HAS PASSED.
       *
       * Reported 2026-09-01: a teacher whose EndDate was 31/08 was still on this card the next
       * morning, counted as ขาด/ลา, dragging the school's attendance to 83% (5/6). The check-in
       * itself has always refused her (assertStaffStarted_ throws ENDED), and the monthly report has
       * always filtered her out — this one screen, the one an admin opens every morning, did not.
       * It asked staffStarted_ and never the other end of the same question. */
      const staffStat=M.staff.filter(s=>s.Role==='Teacher'&&s.RequireCheckin!==false&&staffStarted_(s)&&!staffEnded_(s)&&!staffPaused_(s)).map(s=>{ const a=M.staffAttendanceToday.find(x=>x.StaffID===s.StaffID)||{};
        const onLeave=a.Status==='LEAVE'; return {staffId:s.StaffID,name:s.NameTH,nameEN:s.NameEN,nick:s.Nickname,nickEN:s.NicknameEN,dept:s.Department, status:a.Status||'ABSENT',
          checkIn:onLeave?'':(a.CheckIn||''), checkOut:onLeave?'':(a.CheckOut||''), late:onLeave?0:(a.Late||0), remark:onLeave?(a.Reason||'ลา'):''}; });
      return {classes:cls, staff:staffStat, pendingLeaves:M.leaves.filter(l=>l.Status.startsWith('PENDING')).length,
        // Children on a temporary leave, and the ones whose return date has come. They used to be
        // invisible on the one screen the admin looks at every morning: away for a month with nothing
        // to say so, and back with nothing to say that either.
        paused:H.pausedStudents(),
        /* ...and the children who START soon. They are off every list about who is here (they are
         * not here), which is right — and would leave an admin with no sign that three families
         * join on Monday. Named on the one screen they open every morning, in date order. */
        starting:H.startingStudents(),
        /* ...and the STAFF whose last day has gone. Asked 2026-09-01: "ควรขึ้นแจ้งเตือน Admin ว่าให้
         * นำชื่อออกจากระบบ". Taking them off the attendance card above is right, but a record that
         * quietly stops appearing is a record nobody ever tidies up — and they still hold a login.
         * Named here, on the screen the admin opens every morning, until somebody deals with them.
         * NOT deleted automatically: the school's own reason is that people come back, and the
         * record carries their whole payroll and attendance history. */
        endedStaff:H.endedStaff(),
        holidays:(M.holidays||[]).map(h=>({Date:h.Date,NameTH:h.NameTH,NameEN:h.NameEN})), bigCleaning:bigCleaningList_(),
        // whether today is open, and TO WHOM — travels with the dashboard so the screen never has to
        // work it out from holidays/bigCleaning and get the Big Cleaning case wrong again
        day: schoolDayFor_(todayLocal())}; },
    // Teacher home attendance card: today's มา/ลา/ขาด per class, scoped to the classes this teacher covers
    // (homeroom teacher = own class; multi-class teacher = those; Leader/Admin-equivalent = every class).
    teacherClassAttendance: p => { const me=staffById(p.staffId)||{};
      const covered=coveredClasses_(me).map(c=>c.ClassName); const std=activeStudents();
      const cls=covered.map(name=>{ const studs=std.filter(s=>String(s.Class)===String(name));
        const stat=studs.map(s=>{ const a=M.studentAttendanceToday.find(x=>x.StudentID===s.StudentID);
          return {studentId:s.StudentID,name:s.NameTH,nameEN:s.NameEN,nick:s.Nickname,nickEN:s.NicknameEN,
            status:a?a.Status:'ABSENT', in:a?(a.CheckIn||a.Time||''):'', out:a?a.CheckOut||'':''}; });
        return {className:name,total:studs.length,in:stat.filter(s=>s.status==='IN').length,out:stat.filter(s=>s.status==='OUT').length,
          leave:stat.filter(s=>s.status==='LEAVE').length,absent:stat.filter(s=>s.status==='ABSENT').length,students:stat}; })
        .filter(c=>c.total>0);
      return {classes:cls, seeAll:(me.PositionLevel==='Admin'||me.PositionLevel==='Leader'||me.Role==='Admin')}; },
    pendingLeaves: p => { const lv=staffById(p.staffId).PositionLevel; if(lv==='Admin')return M.leaves.filter(l=>l.Status==='PENDING_ADMIN').map(leaveView_); if(lv==='Leader')return M.leaves.filter(l=>l.Status==='PENDING_LEADER').map(leaveView_); fail('NO_PERMISSION','ตำแหน่งนี้ไม่มีสิทธิ์อนุมัติ'); },
    // `ended` = employment is over TODAY (status INACTIVE, or a last working day that has passed);
    // `endScheduled` = a leaving date is on record but has not arrived, so they are still staff.
    listStaff: () => M.staff.map(s=>Object.assign({RequireCheckin: s.RequireCheckin!==false,
      ended: staffEnded_(s), endScheduled: !staffEnded_(s) && !!ymd(s.EndDate||''),
      paused: staffPaused_(s), pauseFrom: ymd(s.PauseFrom||''), pauseTo: ymd(s.PauseTo||''),
      pauseReason: s.PauseReason||'', pauseRemark: s.PauseRemark||'',
      pauseSalaryMode: String(s.PauseSalaryMode||''), pauseSalaryAmount: Number(s.PauseSalaryAmount||0),
      pauseDue: staffPauseDue_(s)}, s)),
    /** Staff whose last working day has passed and who are still on the roster — the admin's list of
     *  records to close out. Kept, never auto-deleted: people come back, and the row carries their
     *  payroll and attendance history. Sorted by who left longest ago. */
    endedStaff: () => M.staff.filter(s=>staffEnded_(s))
      .map(s=>({staffId:s.StaffID, nick:s.Nickname||s.NameTH||s.Name||s.StaffID,
        name:s.NameTH||s.Name||'', role:s.Role||'',
        // de-duplicated: rows written by the old joined-value checkbox hold each department twice
        dept:String(s.Department||'')==='*'?'*':(function(){ const seen={},k=[];
          String(s.Department||'').split(',').forEach(x=>{ const n=x.trim(); if(n&&!seen[n]){seen[n]=1;k.push(n);} }); return k.join(','); })(),
        endDate:ymd(s.EndDate||''), reason:s.EndReason||'',
        // still holding a login is the part that needs acting on, not the tidiness
        hasLogin: !!(s.LineUID||s.PasswordHash),
        status:String(s.Status||'')}))
      .sort((a,b)=>String(a.endDate).localeCompare(String(b.endDate))),
    // the caller's own staff record (sanitized — no PasswordHash) so screens don't rely on client MOCK.staff.
    staffSelf: p => { const s=staffById(p.staffId); if(!s.StaffID)return null;
      const grp=(M.staffGroups||[]).find(g=>g.GroupName===s.StaffGroup)||null;
      return { StaffID:s.StaffID, NameTH:s.NameTH, NameEN:s.NameEN, Nickname:s.Nickname, NicknameEN:s.NicknameEN,
        Role:s.Role, PositionLevel:s.PositionLevel, Position:s.Position, Department:s.Department,
        StaffGroup:s.StaffGroup, Phone:s.Phone, DOB:s.DOB, StartDate:s.StartDate, NationalID:s.NationalID,
        RequireCheckin: s.RequireCheckin!==false, MustChangePassword: !!s.MustChangePassword,
        CanClassOrg: canOrganize_(s), CanFoodMenu: canFoodMenu_(s),
        /* THE FACT, NEVER THE DATE. The screen needs to know not to draw two clock-in buttons the
         * server will refuse — but a leaving date is the admin's to give, and nobody learns their
         * last day from an app (the rule this whitelist exists for). `ended` is only ever true once
         * the day has PASSED, which they discover anyway the moment they are signed out; a date set
         * in advance and not yet arrived stays invisible here, as it always has. */
        ended: staffEnded_(s),
        GroupIn: grp&&grp.CheckInTime||'', GroupOut: grp&&grp.CheckOutTime||'' }; },
    setRequireCheckin: p => { const s=M.staff.find(x=>x.StaffID===p.staffId); if(s) s.RequireCheckin=!!p.value; return {staffId:p.staffId, value:!!p.value}; },
    // staff edits their OWN record, whitelisted fields only (staffId injected server-side)
    saveStaffSelf: p => { const s=staffById(p.staffId); if(!s.StaffID)fail('NOT_FOUND','ไม่พบพนักงาน');
      const d=p.data||{}; ['NameEN','Nickname','NicknameEN','Phone','DOB','Photo'].forEach(k=>{ if(d[k]!==undefined) s[k]=d[k]; }); return {ok:true, staffId:p.staffId}; },
    // the Admin roster keeps paused children visible (with a flag) — hiding them would leave no way
    // to see who is away, or to bring them back
    listStudents: () => enrolledStudents().map(s=>Object.assign({ageMonth:ageMonths(s.DOB),
      paused:studentPaused_(s), pauseFrom:ymd(s.PauseFrom||''), pauseTo:ymd(s.PauseTo||''), pauseReason:s.PauseReason||''}, s)),
    /**
     * Admin puts a child on temporary leave, or brings them back. Admin only.
     * { studentId, paused:true, from?, to?, reason? } | { studentId, paused:false }
     */
    /* Staff temporary leave. On GAS this is SHADOWED by the setStaffPause route (src/Staff.gs), which
     * writes one row in place — the engine persists whole collections and must not be the live path
     * for a STAFF write. This version is what the local/mock build and the client tests run on, and
     * it is the shared statement of the rule. Admin only.
     * { staffId (the admin), targetId, from, to?, reason, remark?, salaryMode?, salaryAmount? }
     * | { targetId, paused:false } */
    setStaffPause: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const s=staffById(p.targetId||p.staffId); if(!s||!s.StaffID)fail('NOT_FOUND','ไม่พบพนักงาน');
      if(p.paused===false){ s.PauseFrom=''; s.PauseTo=''; s.PauseReason=''; s.PauseRemark='';
        s.PauseSalaryMode=''; s.PauseSalaryAmount='';
        logAct('setStaffPause',s.StaffID,'กลับมาทำงานตามปกติ',actorOf(p));
        return {ok:true,staffId:s.StaffID,paused:false}; }
      const from=ymd(p.from||''); if(!from)fail('BAD_INPUT','กรุณาระบุวันที่เริ่มลาชั่วคราว');
      const to=p.to?ymd(p.to):''; if(to && to<from)fail('BAD_INPUT','วันที่กลับมาทำงานต้องไม่ก่อนวันที่เริ่มลา');
      // the reason is the admin's own words and is REQUIRED — a pause with no reason is a mystery
      // six months later when somebody asks why this person was not paid
      const reason=String(p.reason||'').trim(); if(!reason)fail('BAD_INPUT','กรุณาระบุเหตุผลการลาชั่วคราว');
      const mode=String(p.salaryMode||'').toUpperCase();
      if(['','NONE','HALF','CUSTOM'].indexOf(mode)<0)fail('BAD_INPUT','รูปแบบการจ่ายเงินเดือนไม่ถูกต้อง');
      if(mode==='CUSTOM' && String(p.salaryAmount==null?'':p.salaryAmount).trim()==='')
        fail('BAD_INPUT','กรุณากรอกจำนวนเงินเดือนที่จะจ่ายระหว่างลาชั่วคราว');
      s.PauseFrom=from; s.PauseTo=to; s.PauseReason=reason; s.PauseRemark=String(p.remark||'');
      s.PauseSalaryMode=mode; s.PauseSalaryAmount=mode==='CUSTOM'?Math.max(0,Number(p.salaryAmount)||0):'';
      logAct('setStaffPause',s.StaffID,'ลาชั่วคราว '+from+(to?(' – '+to):' เป็นต้นไป')+' · '+reason+' · '+(mode||'จ่ายตามปกติ'),actorOf(p));
      return {ok:true,staffId:s.StaffID,paused:staffPaused_(s),from,to,reason,salaryMode:mode}; },
    setStudentPause: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน');
      if(INACTIVE[s.Status])fail('BAD_STATE','นักเรียนคนนี้ออกจากโรงเรียนแล้ว — ใช้เมนูรับกลับเข้าเรียนแทน');
      if(p.paused===false){ s.Status='ACTIVE'; s.PauseFrom=''; s.PauseTo=''; s.PauseReason='';
        logAct('setStudentPause',p.studentId,'กลับมาเรียนตามปกติ',actorOf(p));
        return {ok:true,studentId:p.studentId,status:'ACTIVE',paused:false}; }
      if(!p.from)fail('BAD_INPUT','ระบุวันที่เริ่มลาชั่วคราว');
      if(p.to && ymd(p.to)<ymd(p.from))fail('BAD_INPUT','วันที่กลับมาต้องไม่ก่อนวันที่เริ่มลา');
      s.Status=PAUSED_STATUS; s.PauseFrom=ymd(p.from); s.PauseTo=p.to?ymd(p.to):''; s.PauseReason=p.reason||'';
      logAct('setStudentPause',p.studentId,'ลาชั่วคราว '+s.PauseFrom+(s.PauseTo?(' – '+s.PauseTo):' เป็นต้นไป')+(s.PauseReason?(' · '+s.PauseReason):''),actorOf(p));
      return {ok:true,studentId:p.studentId,status:PAUSED_STATUS,paused:studentPaused_(s),from:s.PauseFrom,to:s.PauseTo,reason:s.PauseReason}; },
    // children currently away, so the Admin can see them in one place and bring them back
    /** Children whose first day has not come yet — enrolled, billable, and not here (studentNotStarted_). */
    startingStudents: () => M.students.filter(s=>!INACTIVE[s.Status] && studentNotStarted_(s))
      .map(s=>({studentId:s.StudentID, nick:s.Nickname, nickEN:s.NicknameEN, name:s.NameTH, nameEN:s.NameEN,
        className:s.Class||'', startDate:ymd(s.EnrollDate||''),
        // "in 5 days" is the thing an admin acts on; the date alone makes them count on their fingers
        days:Math.round((new Date(ymd(s.EnrollDate)+'T00:00:00')-new Date(todayLocal()+'T00:00:00'))/86400000)}))
      .sort((a,b)=>String(a.startDate).localeCompare(String(b.startDate))),
    /**
     * Who has ALREADY PAID this month's tuition in advance — asked for 2026-08-26, so the "ออกบิล
     * (เลือก)" list can grey those children out instead of letting an admin tick a bill that the
     * server is only going to refuse.
     *
     * Keyed by month, because the answer changes with the month in the picker: the same child is
     * prepaid in September and not in March. Returned as a map so a checkbox can look itself up.
     */
    prepaidStudents: p => { const month=ym((p&&p.month)||todayLocal().slice(0,7)); const by={};
      enrolledStudents().forEach(s=>{ const pi=prepayInfo_(s.StudentID, month); if(pi) by[s.StudentID]=pi; });
      return {month, count:Object.keys(by).length, byStudent:by}; },
    pausedStudents: () => M.students.filter(s=>String(s.Status)===PAUSED_STATUS)
      .map(s=>({studentId:s.StudentID,name:s.NameTH||s.Name,nameEN:s.NameEN,nick:s.Nickname,nickEN:s.NicknameEN,className:s.Class,
        from:ymd(s.PauseFrom||''), to:ymd(s.PauseTo||''), reason:s.PauseReason||'',
        // `active` = away right now. `due` = the return date has come (or passed) and nobody has
        // confirmed the child is back — they are already on every list, waiting to be tidied up.
        // ...and `scheduled` = recorded but not started, so the card can stop telling the admin that a
        // child who is at school today is not being billed and not on any list.
        active:studentPaused_(s), due:pauseDue_(s), dueToday:!!(s.PauseTo && ymd(s.PauseTo)===todayLocal()),
        scheduled: !!ymd(s.PauseFrom||'') && todayLocal() < ymd(s.PauseFrom)}))
      .sort((a,b)=>String(a.from).localeCompare(String(b.from))),
    /* ---- children expected on a closed day (OT วันหยุด) -----------------------------------------
     * Who is coming, by name, on a day the school is otherwise shut. See assertStudentDayOpen_ for
     * why this is an allowlist rather than a plan.
     */
    holidayAttendList: p => { const d=ymd((p&&p.date)||todayLocal());
      const ids=holidayAttendIds_(d);
      const rows=enrolledStudents().filter(s=>ids.indexOf(String(s.StudentID))>=0).map(s=>{
        const h=(M.studentCheckins||[]).find(c=>String(c.StudentID)===String(s.StudentID)&&ymd(c.Date)===d)||{};
        const ot=(M.otDaily||[]).find(o=>String(o.StudentID)===String(s.StudentID)&&ymd(o.Date)===d)||null;
        return { studentId:s.StudentID, nick:s.Nickname, nickEN:s.NicknameEN, name:s.NameTH, nameEN:s.NameEN,
          class:s.Class||'', inTime:String(h.InTime||'').slice(0,5), outTime:String(h.OutTime||'').slice(0,5),
          planEnd:otThreshold(s), otAmount:ot?Number(ot.Amount||0):0, otStatus:ot?String(ot.Status||''):'' };
      }).sort((a,b)=>String(a.class).localeCompare(String(b.class)));
      const day=schoolDayFor_(d);
      const otStaff=holidayOTStaffInfo_(d);
      return { date:d, closed:!!day.closedForStudents, closedForStaff:!!day.closed, count:rows.length,
               reason:day.reason||'', staffCount:otStaff.length,
               // the ids stay for anything asking "is this person on it"; the rows are what a screen prints
               staffIds:holidayOTStaff_(d), staff:otStaff, students:rows }; },
    /**
     * OT วันหยุด THAT HAS NOT HAPPENED YET — today and the days ahead, for the caller.
     *
     * The admin agrees a Saturday weeks in advance and the teacher is told once, in a notification
     * that scrolls away. After that it lived in a payslip and in a screen you have to go looking
     * for, so the person expected at work on a day the school is shut had no reminder that they
     * were. This is the heads-up, and it belongs on the home screen because that is the screen
     * somebody opens on a Friday.
     *
     * Small on purpose: the caller's own rows, a window of days, nothing else. `myOT` with no month
     * would answer this too, at the cost of sending a career's worth of OT to a home screen.
     */
    myHolidayOTNext: p => { const from=todayLocal();
      const win=Math.min(90, Math.max(1, Number((p&&p.days)||45)));
      const to=ymd(new Date(new Date(from+'T00:00:00').getTime()+win*86400000));
      const rows=(M.otRecords||[]).filter(r=>String(r.StaffID)===String(p&&p.staffId) && isHolidayOT_(r) &&
          String(r.Status||'').toUpperCase()!=='REJECTED')
        .map(r=>({date:ymd(r.Date), amount:Number(r.Amount)||0, note:String(r.Note||''), status:String(r.Status||'')}))
        .filter(r=>r.date>=from && r.date<=to)
        .sort((a,b)=>a.date.localeCompare(b.date));
      // "today" is what changes the home screen's buttons; the rest is a reminder
      return { today:from, count:rows.length, rows,
               students:rows.length?holidayAttendIds_(rows[0].date).length:0 }; },
    /**
     * ประวัตินักเรียน — EVERYTHING THE FAMILY WROTE DOWN, back where somebody can read it.
     *
     * Asked 2026-08-24: "ประวัตินักเรียน ต้องมีข้อมูลแสดงเหมือนกับตอนที่ผู้ปกครองลงทะเบียนมา
     * วันเกิด/กรุ๊ปเลือด/ข้อมูลทั้งหมดที่ลงทะเบียนของนักเรียนต้องแสดงในประวัตินักเรียนทั้งหมด".
     *
     * A family fills in a blood type, an allergy, a medical history and an emergency contact at
     * registration — and then the only thing anybody could see afterwards was the age and the
     * allergy on a class card. Information collected and never shown again is information the school
     * does not really have: the moment it is needed, nobody knows where to look.
     *
     * TWO AUDIENCES, ONE RECORD (the school's decision when asked):
     *   · Admin / Leader / head teacher — the whole record, including the things that identify a
     *     family: national ID, address, insurance, the plan they pay for.
     *   · A teacher — CARE INFORMATION ONLY. Everything needed to look after the child and to act in
     *     an emergency, and nothing that is simply the family's business. A teacher covering the
     *     class, at that.
     * Decided HERE. A profile screen that fetched the row and hid half of it would still have put a
     * national ID on a phone in a classroom.
     */
    studentProfile: p => {
      const s = studentById(p&&p.studentId); if(!s) fail('NOT_FOUND','ไม่พบนักเรียนรายนี้');
      const isAdmin = String((p&&p.role)||'')==='Admin' || String((p&&p.role)||'')==='Observer';
      const me = staffById(p&&p.staffId)||{};
      const full = isAdmin || adminLike_(me) || me.PositionLevel==='Leader' || headTeacher_(me);
      if(!full){
        // a teacher may read the children they actually cover — the same scope as everything else
        if(!me.StaffID) fail('NO_PERMISSION','เฉพาะคุณครูหรือแอดมิน');
        const cov=(coveredClasses_(me)||[]).map(c=>c.ClassName);
        if(cov.indexOf(s.Class)<0) fail('NO_ACCESS','ดูได้เฉพาะนักเรียนในชั้นที่ดูแล');
      }
      const g=(pl,st)=>(M.growthRecords||[]).filter(r=>String(r.StudentID)===String(s.StudentID));
      const latestGrowth=(M.growthRecords||[]).filter(r=>String(r.StudentID)===String(s.StudentID))
        .sort((a,b)=>String(b.Date).localeCompare(String(a.Date)))[0]||null;
      const care = {
        studentId:s.StudentID, nick:s.Nickname||'', nickEN:s.NicknameEN||'', name:s.NameTH||s.Name||'', nameEN:s.NameEN||'',
        class:s.Class||'', status:s.Status||'', photo:s.Photo||'',
        gender:s.Gender||'', dob:ymd(s.DOB||''), ageMonths:s.DOB?ageMonths(s.DOB):null,
        bloodType:s.BloodType||'', rh:s.RH||'',
        allergy:s.Allergy||'', medicalHistory:s.MedicalHistory||'', vaccine:s.Vaccine||'',
        emergencyContact:s.EmergencyContact||'',
        weight:s.Weight||'', height:s.Height||'',
        measuredAt: latestGrowth?ymd(latestGrowth.Date):'',
        enrollDate:ymd(s.EnrollDate||''),
        // the day of the month this family pays on, and whether it is theirs or the school's
        billingDay:billingDayOf(s), billingDayOwn:!!String(s.BillingDay||'').trim(),
        // WHICH DAYS THIS CHILD COMES. In the `care` half on purpose: it is not a private detail and
        // it is exactly what a teacher needs to know before wondering where a child is on a Wednesday.
        offDays:offDays_(s).join(','), offDaysLabel:offDaysLabel_(s), offDaysLabelEN:offDaysLabel_(s,true),
        // a teacher is told THAT there is cover, never the policy number — it is what they would need
        // to say at a hospital door, and nothing more
        insuranceHas: !!s.InsuranceHas
      };
      if(!full) return Object.assign({scope:'care'}, care);
      const parents=(M.parents||[]).filter(x=>String(x.ParentID)===String(s.ParentID) ||
          (M.userLinks||[]).some(l=>String(l.StudentID)===String(s.StudentID)&&String(l.ParentID)===String(x.ParentID)))
        .map(x=>({parentId:x.ParentID, name:x.NameTH||x.Name||'', nameEN:x.NameEN||'', nick:x.Nickname||'',
          relationship:x.Relationship||'', phone:x.Phone||'', officePhone:x.OfficePhone||'',
          occupation:x.Occupation||'', workplace:x.Workplace||'', address:x.Address||'', nationalId:x.NationalID||''}));
      return Object.assign({scope:'full'}, care, {
        nationalId:s.NationalID||'', address:s.Address||'',
        race:s.Race||'', nationality:s.Nationality||'', religion:s.Religion||'',
        plan:s.Plan||'', otRate:s.OTRate||'',
        parentId:s.ParentID||'', parents,
        insurancePolicyNo:s.InsurancePolicyNo||'', insuranceCompany:s.InsuranceCompany||'',
        insuranceExpiry:ymd(s.InsuranceExpiry||''), insuranceCardImage:s.InsuranceCardImage||'',
        driveFolderUrl:s.DriveFolderUrl||'', createdDate:ymd(s.CreatedDate||''),
        withdrawReason:s.WithdrawReason||'', withdrawDate:ymd(s.WithdrawDate||'') });
    },
    /** "ทำไมลงเวลาไม่ได้ ทั้งที่ยืนอยู่ในโรงเรียน" — answered without punching anything. See geoCheck_. */
    geoCheck: p => geoCheck_(p&&p.lat, p&&p.lng, p&&p.acc),
    /** Is a date eligible for OT วันหยุด? Asked by the form before it lets the admin save. */
    holidayDateCheck: p => { const d=ymd((p&&p.date)||todayLocal());
      const hol=(M.holidays||[]).find(h=>ymd(h.Date)===d);
      const g=new Date(d+'T00:00:00').getDay();
      return { date:d, holiday:isHolidayDate_(d), weekend:(g===0||g===6),
               name:hol?(hol.NameTH||hol.NameEN||''):'' }; },
    /** Admin: replace the whole list for a date (the tick-boxes on the OT วันหยุด form). */
    holidayAttendSet: p => { const me=staffById(p&&p.staffId); if(!adminLike_(me)) fail('NO_PERMISSION','เฉพาะแอดมิน');
      const d=ymd((p&&p.date)||''); if(!d) fail('BAD_INPUT','ระบุวันที่');
      assertHolidayDate_(d);
      let ids=(p&&p.studentIds)||[]; if(!Array.isArray(ids)) ids=[ids];
      ids=[...new Set(ids.map(x=>String(x||'').trim()).filter(Boolean))];
      ids.forEach(id=>{ if(!studentById(id)) fail('NOT_FOUND','ไม่พบนักเรียน '+id); });
      const keep=holidayAttend_().filter(r=>ymd(r.Date)!==d);
      M.holidayAttend=keep.concat(ids.map(id=>({Date:d,StudentID:id,AddedBy:(p&&p.staffId)||'',AddedAt:stampLocal()})));
      logAct('holidayAttendSet',d,'นักเรียนที่มาวันหยุด '+ids.length+' คน',actorOf(p));
      return { date:d, count:ids.length, studentIds:ids }; },
    /** Teacher or admin: one more name, because a family turned up. */
    holidayAttendAdd: p => { const d=ymd((p&&p.date)||todayLocal());
      /* STAFF ONLY. This action decides whether a child may be checked in on a day the school is
       * shut — in a parent's hands it would be a button that lets them open their own child's day,
       * which is the one thing the allowlist exists to prevent.
       * staffById returns {} for an unknown id, never null, so the test has to be on the ID. */
      if(!staffById(p&&p.staffId).StaffID) fail('NO_PERMISSION','เฉพาะคุณครูหรือแอดมิน');
      const st=studentById(p&&p.studentId); if(!st) fail('NOT_FOUND','ไม่พบนักเรียน');
      if(isHolidayAttendee_(st.StudentID,d)) return { date:d, studentId:st.StudentID, already:true };
      holidayAttend_().push({Date:d,StudentID:st.StudentID,AddedBy:(p&&p.staffId)||'',AddedAt:stampLocal()});
      logAct('holidayAttendAdd',st.StudentID,'เพิ่มชื่อมาโรงเรียนวันหยุด '+d,actorOf(p));
      return { date:d, studentId:st.StudentID, added:true }; },
    /** ...and take one off again (ticked by mistake, or the family cancelled). */
    holidayAttendRemove: p => { const d=ymd((p&&p.date)||todayLocal());
      if(!staffById(p&&p.staffId).StaffID) fail('NO_PERMISSION','เฉพาะคุณครูหรือแอดมิน');   // {} is truthy
      const i=holidayAttend_().findIndex(r=>ymd(r.Date)===d&&String(r.StudentID)===String(p&&p.studentId));
      if(i<0) return { date:d, removed:false };
      // a child already checked in that day is a FACT — removing the name would leave a record nobody
      // can explain, so the attendance has to be corrected first
      const h=(M.studentCheckins||[]).find(c=>String(c.StudentID)===String(p.studentId)&&ymd(c.Date)===d);
      if(h&&(h.InTime||h.OutTime)) fail('BAD_STATE','นักเรียนคนนี้ลงเวลาไปแล้วในวันนั้น — แก้ไขเวลารับ-ส่งก่อน');
      M.holidayAttend.splice(i,1);
      logAct('holidayAttendRemove',String(p.studentId),'เอาออกจากรายชื่อวันหยุด '+d,actorOf(p));
      return { date:d, studentId:p.studentId, removed:true }; },

    listClasses: () => M.classes,
    /**
     * DSPM by class. Two different questions, which were being answered with one number:
     *   passRate = of the items that HAVE been assessed, how many passed
     *   coverage = how much of the class has been assessed at all
     * A class where one child of six was assessed and passed everything used to read "ผ่านเฉลี่ย
     * 100%", which says the class is done when five children have not been looked at. Coverage is
     * the honest headline and starts at 0.
     * Children who are not at school are left out entirely — paused (ลาชั่วคราว) or not started yet.
     * Individual items marked 'ยังไม่เข้าโรงเรียน' are already skipped by summarize().
     */
    classAssessment: p => {
      const ss=activeStudents().filter(s=>s.Class===p.className && enrolledOn_(s));
      const per=ss.map(s=>{ const x=summarize(s.StudentID); const done=x.totalPass+x.totalFail;
        return {studentId:s.StudentID,name:s.NameTH,nameEN:s.NameEN,nick:s.Nickname,nickEN:s.NicknameEN,
          ageMonth:x.ageMonth,pass:x.totalPass,fail:x.totalFail,assessed:done>0,
          rate:done?Math.round(x.totalPass/done*100):null}; });
      const pass=per.reduce((a,b)=>a+b.pass,0), fl=per.reduce((a,b)=>a+b.fail,0);
      const assessed=per.filter(x=>x.assessed).length;
      // how many enrolled children were left out of the count, so the number can be explained
      const skipped=M.students.filter(s=>s.Class===p.className && !INACTIVE[s.Status] &&
        (studentPaused_(s) || !enrolledOn_(s))).length;
      return {class:p.className, studentCount:ss.length, assessed, notAssessed:ss.length-assessed, skipped,
        passRate:(pass+fl)?Math.round(pass/(pass+fl)*100):0,
        coverage: ss.length?Math.round(assessed/ss.length*100):0,
        totalPass:pass, totalFail:fl, perStudent:per}; },
    // unique AnnID = max existing numeric +1 (length+1 collided after a delete → duplicate ids hid popups)
    addAnnouncement: p => { let mx=0; M.announcements.forEach(x=>{ const m=/^ANN-?(\d+)$/.exec(String(x.AnnID||'')); if(m){const n=+m[1]; if(n>mx)mx=n;} });
      const a={AnnID:'ANN-'+(mx+1),Title:p.title,TitleEN:p.titleEN||'',Content:p.content,ContentEN:p.contentEN||'',Image:p.image||'',Date:todayLocal(),Type:p.type||'news',TargetGroup:p.target||'all',Popup:!!p.popup,StartDate:p.startDate||todayLocal(),EndDate:p.endDate||'',
        // blank = the whole day, which is how every announcement written before this behaved
        StartTime:cfgTime_(p.startTime,''),EndTime:cfgTime_(p.endTime,''),Priority:Number(p.priority)||0}; M.announcements.unshift(a); return a; },
    editAnnouncement: p => { const a=M.announcements.find(x=>x.AnnID===p.annId); if(!a)fail('NOT_FOUND','ไม่พบประกาศ');
      ['Title','TitleEN','Content','ContentEN','Popup','StartDate','EndDate','Priority'].forEach(k=>{ const kk=k.charAt(0).toLowerCase()+k.slice(1); if(p[kk]!==undefined)a[k]=(k==='Priority'?(Number(p[kk])||0):p[kk]); });
      // a time is CLEARABLE — sending '' must mean "the whole day" again, not "leave it as it was"
      if(p.startTime!==undefined)a.StartTime=cfgTime_(p.startTime,'');
      if(p.endTime!==undefined)a.EndTime=cfgTime_(p.endTime,'');
      if(p.image!==undefined&&p.image!=='')a.Image=p.image; return a; },
    deleteAnnouncement: p => { const i=M.announcements.findIndex(x=>x.AnnID===p.annId); if(i>=0)M.announcements.splice(i,1); return {ok:true}; },
    notifications: p => M.feed.filter(n=> n.roles.includes(p.role) && (!n.parentId || n.parentId===p.parentId)),
    markNotifsRead: p => { M.feed.forEach(n=>{ if(n.roles.includes(p.role)) n.read=true; }); return {ok:true}; },
    studentCheckinHistory: p => M.studentCheckins.filter(c=>c.StudentID===p.studentId).sort((a,b)=>b.Date.localeCompare(a.Date)),
    permissions: () => M.permissions,
    allChats: () => { const by={}; M.comments.forEach(c=>{ (by[c.StudentID]=by[c.StudentID]||[]).push(c); });
      return Object.keys(by).map(sid=>{ const s=studentById(sid)||{}; const last=by[sid][by[sid].length-1]; return {studentId:sid,name:s.NameTH,nameEN:s.NameEN,last:last.Message,time:last.Timestamp,count:by[sid].length}; }); },

    // ========== Group A: registration / linking ==========
    // look up a student by NationalID (used when an existing parent links a child)
    findStudentByNationalID: p => { const s=M.students.find(x=>String(x.NationalID)===String(p.nationalId).trim()); if(!s)fail('NOT_FOUND','ไม่พบนักเรียนจากเลขบัตรนี้'); return {StudentID:s.StudentID,name:s.NameTH,nameEN:s.NameEN,class:s.Class}; },
    // register a brand-new student + parent and link to this user
    registerNew: p => {
      // Reject a re-submit (slow network) instead of creating a duplicate person. Match on National ID
      // (or name+DOB / name+phone when the ID is blank). Notify the user; do NOT write.
      const exSt=dupStudent_(p.student); if(exSt) fail('ALREADY_REGISTERED','ข้อมูลนักเรียนนี้มีอยู่ในระบบแล้ว ('+(exSt.NameTH||exSt.Name||'')+') — ระบบไม่สร้างข้อมูลซ้ำ หากเคยลงทะเบียนแล้วให้เลือก "เคยลงทะเบียนแล้ว"');
      const exPar=dupParent_(p.parent); if(exPar) fail('ALREADY_REGISTERED','ข้อมูลผู้ปกครองนี้ ('+(exPar.NameTH||exPar.Name||'')+') มีอยู่ในระบบแล้ว — ระบบไม่สร้างข้อมูลซ้ำ');
      const sid=nextSeqId_(M.students,'StudentID','STD',3); const pid=nextSeqId_(M.parents,'ParentID','PAR',3);
      const st=Object.assign({StudentID:sid,ParentID:pid,Status:'ACTIVE',CreatedDate:todayLocal(),EnrollDate:todayLocal(),LastGrowthUpdate:''}, p.student||{});
      if(!String(st.Class||'').trim()) st.Class=defaultClassByAge_(st.DOB); // auto-assign class by age (school can move later)
      st.DriveFolderUrl=studentFolderUrl(st); // per-student Drive folder (GAS: DriveApp.createFolder under StudentFolderRoot)
      const par=Object.assign({ParentID:pid,StudentID:sid,LineUID:p.uid||''}, p.parent||{});
      if(par.Photo) par.RegisterPhotoUrl=registerPhotoUrl(pid); // mandatory ID photo saved to the "New Register Photo" folder
      M.students.push(st); M.parents.push(par);
      if(p.uid) M.userLinks.push({UserUID:p.uid,StudentID:sid,VerifiedBy:'register',Date:todayLocal()});
      (p.pickupPersons||[]).forEach(pp=>M.pickupPersons.push(Object.assign({StudentID:sid},pp)));
      if(st.Weight||st.Height) M.growthRecords.push({Date:todayLocal(),StudentID:sid,AgeMonth:ageMonths(st.DOB),Weight:+st.Weight||0,Height:+st.Height||0});
      logAct('registerStudent',sid,(st.NameTH||sid)+' + Drive folder',actorOf(p));
      return {studentId:sid,parentId:pid,driveFolder:st.DriveFolderUrl}; },
    // register the PARENT only (children added/linked afterward) — LINE signup
    registerParent: p => {
      const exPar=dupParent_(p.parent); if(exPar) fail('ALREADY_REGISTERED','ข้อมูลผู้ปกครองนี้ ('+(exPar.NameTH||exPar.Name||'')+') มีอยู่ในระบบแล้ว — ระบบไม่สร้างข้อมูลซ้ำ');
      const pid=nextSeqId_(M.parents,'ParentID','PAR',3);
      const par=Object.assign({ParentID:pid,LineUID:p.uid||''}, p.parent||{});
      if(par.Photo) par.RegisterPhotoUrl=registerPhotoUrl(pid); // mandatory live-capture ID photo → "New Register Photo" Drive folder
      M.parents.push(par);
      logAct('registerParent',pid,par.NameTH||pid,{role:'Parent',id:pid,name:par.NameTH||pid});
      return {parentId:pid}; },
    // add a NEW child under an existing parent + link to this user (no parent re-entry)
    addChildNew: p => {
      const exSt=dupStudent_(p.student); if(exSt) fail('ALREADY_REGISTERED','ข้อมูลนักเรียนนี้มีอยู่ในระบบแล้ว ('+(exSt.NameTH||exSt.Name||'')+') — ระบบไม่สร้างข้อมูลซ้ำ');
      const sid=nextSeqId_(M.students,'StudentID','STD',3);
      const st=Object.assign({StudentID:sid,ParentID:p.parentId||'',Status:'ACTIVE',CreatedDate:todayLocal(),EnrollDate:todayLocal(),LastGrowthUpdate:''}, p.student||{});
      if(!String(st.Class||'').trim()) st.Class=defaultClassByAge_(st.DOB); // auto-assign class by age (school can move later)
      st.DriveFolderUrl=studentFolderUrl(st); // per-student Drive folder
      M.students.push(st);
      if(p.uid) M.userLinks.push({UserUID:p.uid,StudentID:sid,VerifiedBy:'register',Date:todayLocal()});
      (p.pickupPersons||[]).forEach(pp=>M.pickupPersons.push(Object.assign({StudentID:sid},pp)));
      if(st.Weight||st.Height) M.growthRecords.push({Date:todayLocal(),StudentID:sid,AgeMonth:ageMonths(st.DOB),Weight:+st.Weight||0,Height:+st.Height||0});
      logAct('registerStudent',sid,(st.NameTH||sid)+' + Drive folder',actorOf(p));
      return {studentId:sid,driveFolder:st.DriveFolderUrl}; },
    // link an existing student to this user after verifying NationalID
    linkExisting: p => { const s=M.students.find(x=>String(x.NationalID)===String(p.nationalId).trim()); if(!s)fail('NOT_FOUND','เลขบัตรไม่ตรงกับนักเรียนในระบบ');
      if(p.uid && !M.userLinks.find(l=>l.UserUID===p.uid&&l.StudentID===s.StudentID)) M.userLinks.push({UserUID:p.uid,StudentID:s.StudentID,VerifiedBy:'verify',Date:todayLocal()});
      return {studentId:s.StudentID,name:s.NameTH,nameEN:s.NameEN}; },
    // First LINE sign-in of a parent the school ALREADY has on file (imported, or entered by the admin):
    // claim that existing record instead of registering a second one. This is the gap that produced 84
    // duplicate parents. Verified by the CHILD's National ID plus the parent's own National ID or the
    // phone the school recorded — never by name, and never on a record that has neither field filled.
    claimParent: p => {
      const uid=String(p.uid||'').trim(); if(!uid) fail('NO_IDENTITY','ไม่พบบัญชี LINE — กรุณาเข้าผ่าน LINE อีกครั้ง');
      const nid=_dig(p.nationalId); if(nid.length!==13) fail('BAD_INPUT','กรอกเลขบัตรประชาชนนักเรียน 13 หลัก');
      const ver=_dig(p.verify); if(ver.length<9) fail('BAD_INPUT','กรอกเลขบัตรประชาชนของผู้ปกครอง หรือเบอร์โทรที่แจ้งกับโรงเรียน');
      const s=(M.students||[]).find(x=>_dig(x.NationalID)===nid); if(!s) fail('NOT_FOUND','ไม่พบนักเรียนจากเลขบัตรนี้ — ตรวจสอบเลขบัตร หรือติดต่อแอดมิน');
      // every parent record the school has attached to this child (both legacy pointers)
      const cands=(M.parents||[]).filter(x=>String(x.StudentID||'')===String(s.StudentID) || (s.ParentID&&String(x.ParentID)===String(s.ParentID)));
      if(!cands.length) fail('NO_RECORD','ยังไม่มีข้อมูลผู้ปกครองของนักเรียนคนนี้ในระบบ — กรุณาเลือก "ลงทะเบียนใหม่"');
      const same9=(a,b)=>a.length>=9&&b.length>=9&&a.slice(-9)===b.slice(-9);   // tolerate 0-prefix / +66
      const hit=cands.find(x=>{ const n=_dig(x.NationalID), ph=_dig(x.Phone);
        return (n && n===ver) || (ph && same9(ph,ver)); });
      if(!hit) fail('VERIFY_FAILED','ข้อมูลยืนยันไม่ตรงกับที่โรงเรียนมี — กรุณาติดต่อแอดมิน');
      const own=String(hit.LineUID||'').trim();
      if(own && own!==uid) fail('ALREADY_CLAIMED','ข้อมูลผู้ปกครองนี้ผูกกับบัญชี LINE อื่นอยู่แล้ว — กรุณาติดต่อแอดมิน');
      hit.LineUID=uid;
      // bring along EVERY child on that record, not just the one used to verify
      const kids=(M.students||[]).filter(x=>String(x.ParentID||'')===String(hit.ParentID));
      if(!kids.some(x=>String(x.StudentID)===String(s.StudentID))) kids.push(s);
      kids.forEach(k=>{ if(!(M.userLinks||[]).some(l=>String(l.UserUID)===uid&&String(l.StudentID)===String(k.StudentID)))
        (M.userLinks=M.userLinks||[]).push({UserUID:uid,StudentID:k.StudentID,VerifiedBy:'claim',Date:todayLocal()}); });
      logAct('claimParent',hit.ParentID,'ผูกบัญชี LINE เข้ากับข้อมูลเดิม '+(hit.NameTH||hit.Name||hit.ParentID)+' · '+kids.length+' คน',{role:'Parent',id:hit.ParentID,name:hit.NameTH||hit.Name||hit.ParentID});
      return {parentId:hit.ParentID, name:hit.NameTH||hit.Name||'', nameEN:hit.NameEN||'', nick:hit.Nickname||'',
        students:kids.map(k=>({studentId:k.StudentID, name:k.NameTH||k.Name||'', nick:k.Nickname||''}))}; },
    // Admin: parents currently linked to a student — via USER_LINKS (LINE uid) or legacy STUDENTS.ParentID.
    studentLinkedParents: p => { const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน');
      const out=[], seen={};
      (M.userLinks||[]).filter(l=>String(l.StudentID)===String(p.studentId)).forEach(l=>{
        const pa=(M.parents||[]).find(x=>String(x.LineUID)===String(l.UserUID));
        if(seen['uid:'+l.UserUID])return; seen['uid:'+l.UserUID]=1;
        out.push({parentId:pa?pa.ParentID:'', uid:l.UserUID, name:pa?(pa.NameTH||pa.Name):'', nick:pa?pa.Nickname:'', phone:pa?pa.Phone:'',
          rel:pa?(pa.Relationship||''):'', title:pa?(pa.Title||''):'', via:'link'}); });
      (M.parents||[]).filter(pa=>String(pa.StudentID)===String(p.studentId)||pa.ParentID===s.ParentID).forEach(pa=>{
        if(seen['pid:'+pa.ParentID]||(pa.LineUID&&seen['uid:'+pa.LineUID]))return; seen['pid:'+pa.ParentID]=1;
        out.push({parentId:pa.ParentID, uid:pa.LineUID||'', name:pa.NameTH||pa.Name, nick:pa.Nickname, phone:pa.Phone,
          rel:pa.Relationship||'', title:pa.Title||'', via:'legacy'}); });
      return {studentId:p.studentId, name:s.NameTH, nick:s.Nickname, parents:out}; },
    // Admin: the students a parent is linked to — reverse of studentLinkedParents (USER_LINKS by the
    // parent's LineUID ∪ legacy STUDENTS.ParentID). Feeds the "how many children" view.
    parentLinkedStudents: p => { const pa=(M.parents||[]).find(x=>String(x.ParentID)===String(p.parentId)); if(!pa)fail('NOT_FOUND','ไม่พบผู้ปกครอง');
      const out=[], seen={};
      if(pa.LineUID) (M.userLinks||[]).filter(l=>String(l.UserUID)===String(pa.LineUID)).forEach(l=>{ const s=studentById(l.StudentID); if(!s||seen[l.StudentID])return; seen[l.StudentID]=1;
        out.push({studentId:s.StudentID, name:s.NameTH, nameEN:s.NameEN, nick:s.Nickname, nickEN:s.NicknameEN, class:s.Class, status:s.Status||'Active', via:'link'}); });
      (M.students||[]).filter(s=>String(s.ParentID)===String(p.parentId)).forEach(s=>{ if(seen[s.StudentID])return; seen[s.StudentID]=1;
        out.push({studentId:s.StudentID, name:s.NameTH, nameEN:s.NameEN, nick:s.Nickname, nickEN:s.NicknameEN, class:s.Class, status:s.Status||'Active', via:'legacy'}); });
      return {parentId:p.parentId, name:pa.NameTH||pa.Name, nick:pa.Nickname, students:out}; },
    // Admin: {parentId: linked-children-count} for every parent (active children only) — for the list badge.
    /**
     * How many children each parent has, for the admin's lists.
     *
     * enrolledStudents, NOT activeStudents: a child on temporary leave still belongs to their
     * parent. Counting only the active ones made a linked family read as "👶 0" on the admin screen
     * while the parent themselves was looking at that very child — the parent side resolves links
     * through visibleStudents, which has always kept paused children. Withdrawn children are still
     * excluded, by both.
     */
    parentLinkCounts: () => { const cnt={}; const uidToPid={}; (M.parents||[]).forEach(pa=>{ if(pa.LineUID)uidToPid[pa.LineUID]=pa.ParentID; cnt[pa.ParentID]=0; });
      const seen={}; const active=enrolledStudents();
      active.forEach(s=>{ (M.userLinks||[]).filter(l=>String(l.StudentID)===String(s.StudentID)).forEach(l=>{ const pid=uidToPid[l.UserUID]; if(!pid)return; const k=pid+'|'+s.StudentID; if(seen[k])return; seen[k]=1; cnt[pid]=(cnt[pid]||0)+1; });
        if(s.ParentID){ const k=s.ParentID+'|'+s.StudentID; if(!seen[k]){ seen[k]=1; cnt[s.ParentID]=(cnt[s.ParentID]||0)+1; } } });
      // Third link: PARENTS.StudentID. It is the oldest of the three and these lists never consulted
      // it, yet the server trusts it for ACCESS (parentOwnsStudent_) — so a family linked that way
      // could open the child while the admin's list called them unlinked.
      (M.parents||[]).forEach(pa=>{ if(!pa.StudentID)return; const s=studentById(pa.StudentID);
        if(!s||INACTIVE[s.Status])return; const k=pa.ParentID+'|'+s.StudentID; if(seen[k])return; seen[k]=1;
        cnt[pa.ParentID]=(cnt[pa.ParentID]||0)+1; });
      return cnt; },
    // Admin: {parentId: [child, ...]} for every parent — same link resolution as parentLinkCounts
    // (USER_LINKS by LINE UID first, then the legacy STUDENTS.ParentID), active children only.
    // Keys stay PascalCase so the client can feed these straight into parentDisp()/dispNick().
    // Kept SEPARATE from parentLinkCounts on purpose: that one is consumed as a plain number.
    parentKidsMap: () => { const out={}; const uidToPid={}; (M.parents||[]).forEach(pa=>{ if(pa.LineUID)uidToPid[pa.LineUID]=pa.ParentID; out[pa.ParentID]=[]; });
      const seen={}; const push=(pid,s)=>{ const k=pid+'|'+s.StudentID; if(seen[k])return; seen[k]=1;
        (out[pid]=out[pid]||[]).push({StudentID:s.StudentID, NameTH:s.NameTH, NameEN:s.NameEN, Nickname:s.Nickname, NicknameEN:s.NicknameEN, Class:s.Class,
          paused:studentPaused_(s)}); };
      // enrolledStudents, not activeStudents — see parentLinkCounts above: a child on temporary leave
      // still belongs to their parent, and leaving them out made a linked family read as unlinked.
      enrolledStudents().forEach(s=>{
        (M.userLinks||[]).filter(l=>String(l.StudentID)===String(s.StudentID)).forEach(l=>{ const pid=uidToPid[l.UserUID]; if(pid)push(pid,s); });
        if(s.ParentID) push(s.ParentID,s); });
      // and the oldest linkage of the three — see parentLinkCounts
      (M.parents||[]).forEach(pa=>{ if(!pa.StudentID)return; const s=studentById(pa.StudentID);
        if(s && !INACTIVE[s.Status]) push(pa.ParentID,s); });
      return out; },
    // Admin bypass: link a parent's LINE UID to a student (found by the student's National ID) when the
    // parent can't self-register. Optionally fills the parent's personal info. UID + National ID always required.
    // The parent may be identified three ways, in this order: an existing PARENTS row (parentId — what
    // the admin picks from a list), a LINE UID, or new info to create a row with. The student likewise by
    // studentId or National ID. A parent who has never signed in with LINE has no UID to link, so they
    // get the LEGACY linkage (STUDENTS.ParentID / PARENTS.StudentID) that the readers already understand.
    linkParentAdmin: p => { const uid0=String(p.uid||'').trim(); const nid=String(p.nationalId||'').trim(); const sid=String(p.studentId||'').trim();
      const s = sid ? studentById(sid) : (nid ? (M.students||[]).find(x=>String(x.NationalID||'').trim()===nid) : null);
      if(!s) fail(sid||nid?'NOT_FOUND':'BAD_INPUT', sid?'ไม่พบนักเรียน':nid?'ไม่พบนักเรียนจากเลขบัตรนี้':'ต้องเลือกนักเรียน');
      const d=p.data||{}; const hasInfo=!!(d.NameTH||d.NameEN||d.Phone||d.Nickname);
      let pa = p.parentId ? (M.parents||[]).find(x=>String(x.ParentID)===String(p.parentId)) : null;
      if(p.parentId && !pa) fail('NOT_FOUND','ไม่พบผู้ปกครอง');
      let uid = uid0 || (pa?String(pa.LineUID||'').trim():'');
      if(!pa && uid) pa=(M.parents||[]).find(x=>String(x.LineUID)===uid);
      if(!pa && !uid && !hasInfo) fail('BAD_INPUT','ต้องเลือกผู้ปกครอง หรือกรอกข้อมูลผู้ปกครองใหม่');
      if(!pa && hasInfo){ pa={ParentID:nextSeqId_(M.parents,'ParentID','PAR',0),LineUID:uid}; M.parents.push(pa); }
      if(pa){ ['NameTH','NameEN','Nickname','NicknameEN','Phone','Relationship','Title'].forEach(k=>{ if(d[k]!=null&&d[k]!=='')pa[k]=d[k]; }); }
      let via='';
      if(uid){ if(!(M.userLinks||[]).find(l=>String(l.UserUID)===uid&&String(l.StudentID)===String(s.StudentID))) (M.userLinks=M.userLinks||[]).push({UserUID:uid,StudentID:s.StudentID,VerifiedBy:'admin',Date:todayLocal()});
        via='link'; if(pa && !s.ParentID) s.ParentID=pa.ParentID; }
      else { if(!s.ParentID) s.ParentID=pa.ParentID;
        else if(String(s.ParentID)!==String(pa.ParentID)){ if(!pa.StudentID) pa.StudentID=s.StudentID;
          else fail('LINK_TAKEN','นักเรียนคนนี้ผูกกับผู้ปกครองรายอื่นแบบไม่มี LINE อยู่แล้ว — ยกเลิกการผูกเดิมก่อน'); }
        via='legacy'; }
      logAct('linkParentAdmin', s.StudentID, 'ผูก '+(pa?pa.ParentID:uid)+' → '+s.StudentID+' ('+via+')'+(hasInfo?' (+ข้อมูล)':''), actorOf(p));
      return {ok:true, studentId:s.StudentID, name:s.NameTH, nick:s.Nickname, parentId:pa?pa.ParentID:'', via:via, needInfo:!pa}; },
    // Admin: detach ONE parent from a child (keeps the child enrolled). GAS routes this to an in-place
    // handler (USER_LINKS is a no-shrink sheet — the engine's full rewrite would be blocked by WRITE_GUARD).
    unlinkStudent: p => { const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน');
      let uid=p.uid||''; if(!uid&&p.parentId){ const pa=(M.parents||[]).find(x=>x.ParentID===p.parentId); if(pa)uid=pa.LineUID; }
      const before=(M.userLinks||[]).length; let extra=0;
      M.userLinks=(M.userLinks||[]).filter(l=>!(String(l.StudentID)===String(p.studentId) && uid && String(l.UserUID)===String(uid)));
      if(p.parentId && s.ParentID===p.parentId){ s.ParentID=''; extra++; }
      // the other legacy pointer: PARENTS.StudentID (used when a child already had a legacy parent)
      if(p.parentId){ const pa=(M.parents||[]).find(x=>String(x.ParentID)===String(p.parentId)); if(pa && String(pa.StudentID||'')===String(p.studentId)){ pa.StudentID=''; extra++; } }
      logAct('unlinkStudent',p.studentId,'ยกเลิกผูก '+(p.parentId||uid),actorOf(p));
      return {ok:true, removed:before-(M.userLinks||[]).length+extra}; },

    // ========== Group C: growth update ==========
    growthDue: p => { const s=studentById(p.studentId); if(!s)return{due:false};
      const months=cfg.GrowthUpdateMonths||[]; const m=new Date().getMonth()+1; const period=todayLocal().slice(0,7);
      const updatedThisPeriod=(s.LastGrowthUpdate||'').slice(0,7)===period;
      return {due: months.indexOf(m)>=0 && !updatedThisPeriod, month:m, lastUpdate:s.LastGrowthUpdate||''}; },
    /**
     * Weight / height, and THE DAY THEY WERE MEASURED.
     *
     * The date used to be "whenever this was typed in". A class is weighed on one day and the
     * numbers are entered later, so the growth chart plotted a measurement on a day nobody stood on
     * the scales — and that chart is what a nurse reads. The teacher now says when, defaulting to
     * today; a future date is refused, because it cannot have happened yet.
     */
    updateGrowth: p => { const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน');
      const on=ymd(p.date||todayLocal());
      if(on>todayLocal()) fail('BAD_INPUT','วันที่ชั่ง/วัด ต้องไม่เป็นวันในอนาคต');
      if(p.weight!=null) s.Weight=+p.weight; if(p.height!=null) s.Height=+p.height; if(p.photo) s.Photo=p.photo;
      s.LastGrowthUpdate=on;
      // age at the time of MEASUREMENT, not at the time of typing — the chart is plotted against it
      M.growthRecords.push({Date:on,StudentID:s.StudentID,AgeMonth:ageMonths(s.DOB,on),Weight:s.Weight||0,Height:s.Height||0,
        // WHO took this measurement. Without it, "the teacher who recorded it may fix it" cannot be
        // asked, and the only options are "anybody" or "nobody".
        RecordedBy:String((p&&p.staffId)||''), RecordedAt:stampLocal()});
      return {ok:true,lastUpdate:s.LastGrowthUpdate,date:on}; },

    // ========== Group E: growth history vs standard band ==========
    growthHistory: p => { const s=studentById(p.studentId)||{}; const recs=growthRowsOf_(p.studentId);
      const std=GROWTH_STD; const ages=recs.map(r=>r.AgeMonth);
      const band=k=> ages.map(a=>{ const at=std?std.at(s.Gender,a,k):null; return {ageMonth:a,min:at?at.min:null,max:at?at.max:null}; });
      return {studentId:p.studentId,name:s.NameTH,nameEN:s.NameEN,gender:s.Gender,ageMonth:ageMonths(s.DOB),
        // `idx` is the handle a correction comes back with (see growthFind_) — the rows themselves
        // have no id, and Date+Student is not unique: น้องเบรฟ has three identical 2026-08-14 rows.
        // ...and WHO took each measurement, by nickname, resolved here (see staffNickOf_)
        records:recs.map((r,i)=>{ const by=r.RecordedBy?signedBy_(r.RecordedBy):null;
          return Object.assign({idx:i, byNick:by?by.nick:'', byLeft:!!(by&&by.left)},r); }),
        weightBand:band('weight'), heightBand:band('height')}; },

    /**
     * CORRECTING A MEASUREMENT — เพิ่ม / แก้ไข / ลบ.
     *
     * น้องเบรฟ has the same 10 kg · 76 cm recorded three times on 2026-08-14, and until now there was
     * no way to remove two of them: growth rows are only ever appended, and a chart a nurse reads was
     * stuck with whatever had been typed. Reported 2026-08-25.
     *
     * WHO. The teacher who recorded it (their own), a head teacher, or an admin. A row written before
     * RecordedBy existed belongs to nobody, so only a head teacher or an admin may touch it — a
     * teacher cannot claim an old measurement by being the one who opened the screen.
     *
     * WHICH ROW. There is no id on these rows and Date+StudentID is not unique, so the caller sends
     * the POSITION in the list growthHistory gave them, together with what they saw in it. If those
     * do not match any more — somebody else edited it first — the correction is refused instead of
     * landing on whatever is now in that slot. The wrong child's weight is not an acceptable failure.
     */
    editGrowth: p => { const f=growthFind_(p); growthCanEdit_(p, f.row);
      const s=studentById(f.row.StudentID)||{};
      if(p.date!=null){ const on=ymd(p.date); if(!on) fail('BAD_INPUT','วันที่ไม่ถูกต้อง');
        if(on>todayLocal()) fail('BAD_INPUT','วันที่ชั่ง/วัด ต้องไม่เป็นวันในอนาคต');
        f.row.Date=on; f.row.AgeMonth=ageMonths(s.DOB,on); }
      if(p.weight!=null){ const w=Number(p.weight); if(!isFinite(w)||w<=0) fail('BAD_INPUT','น้ำหนักต้องมากกว่า 0'); f.row.Weight=w; }
      if(p.height!=null){ const h=Number(p.height); if(!isFinite(h)||h<=0) fail('BAD_INPUT','ส่วนสูงต้องมากกว่า 0'); f.row.Height=h; }
      /* WHOEVER TOUCHED IT LAST OWNS IT. The school's rule (2026-08-25): a record keeps the name of
       * the person who left it until somebody corrects it, and then it carries theirs. Otherwise a
       * figure a head teacher fixed last week still reads as the work of a teacher who left in May,
       * and the person to ask about it is the wrong one. It also gives an ownerless legacy row an
       * owner the first time anybody corrects it. */
      if(p.staffId){ f.row.RecordedBy=String(p.staffId); f.row.RecordedAt=stampLocal(); }
      growthSyncLatest_(s);
      logAct('editGrowth',f.row.StudentID,ymd(f.row.Date)+' '+f.row.Weight+'kg '+f.row.Height+'cm',actorOf(p));
      return {ok:true, record:f.row}; },
    deleteGrowth: p => { const f=growthFind_(p); growthCanEdit_(p, f.row);
      const s=studentById(f.row.StudentID)||{};
      M.growthRecords.splice(M.growthRecords.indexOf(f.row),1);
      growthSyncLatest_(s);
      logAct('deleteGrowth',f.row.StudentID,'ลบบันทึก '+ymd(f.row.Date)+' '+f.row.Weight+'kg '+f.row.Height+'cm',actorOf(p));
      return {ok:true}; },

    /**
     * Everything one child's printable report card needs, in ONE round trip.
     *
     * The file itself is built on the reader's own device (see webapp/report_card.js) and never
     * touches a server — this holds a child's health and development data, so there is deliberately
     * no stored copy and no shareable link to leak. This handler only returns what the caller is
     * already allowed to see: a parent is scoped to their own children by applyIdentity_, and a
     * teacher to the classes they cover.
     *
     * Growth BANDS are not computed here: the reference tables (growth_standard.js) ship with the
     * app, not with the server engine, so the client derives them from these records.
     */
    studentReportCard: p => {
      const s=studentById(p.studentId); if(!s) fail('NOT_FOUND','ไม่พบนักเรียน');
      if(p.staffId){ const me=staffById(p.staffId)||{};
        const seeAll = me.PositionLevel==='Admin'||me.PositionLevel==='Leader'||me.Role==='Admin';
        const covered=coveredClasses_(me).map(c=>c.ClassName);
        if(!seeAll && covered.indexOf(String(s.Class||''))<0) fail('NO_ACCESS','ดูได้เฉพาะนักเรียนในชั้นที่ดูแล'); }

      const recs=(M.growthRecords||[]).filter(r=>String(r.StudentID)===String(p.studentId))
        .sort((a,b)=>Number(a.AgeMonth)-Number(b.AgeMonth))
        .map(r=>({ageMonth:Number(r.AgeMonth)||0, weight:Number(r.Weight)||0, height:Number(r.Height)||0, date:ymd(r.Date)}));

      const age=ageMonths(s.DOB);
      const band=(M.dspmCriteria||[]).filter(c=>Number(c.AgeFrom)<=age && age<=Number(c.AgeTo))
        .sort((a,b)=>Number(a.ItemNo)-Number(b.ItemNo));
      const latest=latestByItem(p.studentId);
      const items=band.map(c=>{ const a=latest[c.ItemNo];
        return {itemNo:c.ItemNo, skill:c.Skill, description:c.Description,
          result:a?a.Result:'', date:a?ymd(a.Date):''}; });
      // "assessed" is what has actually been judged — an item nobody has looked at yet is not a fail.
      const passed=items.filter(i=>i.result==='ผ่าน').length;
      const failed=items.filter(i=>i.result==='ไม่ผ่าน').length;
      const done=passed+failed;

      return {
        student:{ studentId:s.StudentID, nick:s.Nickname||'', nickEN:s.NicknameEN||'',
          name:s.NameTH||s.Name||'', nameEN:s.NameEN||'', cls:s.Class||'', dob:ymd(s.DOB),
          gender:s.Gender||'', ageMonth:age, photo:s.Photo||'', allergy:s.Allergy||'' },
        growth: recs,
        dspm:{ ageLabel: band.length?band[0].AgeLabelTH:'', items,
          passed, failed, pending: items.length-done, total: items.length,
          coverage: items.length?Math.round(done/items.length*100):0,
          passRate: done?Math.round(passed/done*100):null },
        school:{ name: cfg.SchoolName||'Atom Nursery' },
        generatedAt: stampLocal()
      }; },

    /* ================= Phase 7a: food menu, per class, per month =========================
     * The kitchen plans by class (the babies do not eat what Nursery 3 eats), so the menu is stored
     * one row per class per DAY. A parent is shown ONLY their own child's class — they should not
     * have to work out which of five menus applies to them.
     */
    foodMenu: p => { const cls=String(p.className||''); const month=ym(p.month||todayLocal().slice(0,7));
      // ONE menu a day for the whole school (see menuRowsByDate_). A className is no longer WHICH
      // menu — it only says which meals that class eats, so the parent screen shows a Nursery 2
      // family lunch and not dinner. No class given = the planning screen, which shows every meal.
      const byDate=menuRowsByDate_(M, month);
      const rows=Object.keys(byDate).sort().map(d=>byDate[d]);
      return { className:cls, month, shared:true,
        slots: cls?mealSlotsFor_(cls):allMealSlots_(),
        days: rows.map(r=>({ date:ymd(r.Date), breakfast:r.Breakfast||'', snackAM:r.SnackAM||'',
          lunch:r.Lunch||'', dinner:r.Dinner||'', snackPM:r.SnackPM||'', note:r.Note||'',
          // a day still coming from an old per-class row, so the screen can say so
          legacyClass: String(r.Class)===MENU_ALL_?'':String(r.Class||'') })),
        updatedAt: rows.reduce((a,r)=>String(r.UpdatedAt||'')>a?String(r.UpdatedAt):a,'') }; },

    /** Parent view: resolve the child's class for them, so the menu is never the wrong one. */
    myFoodMenu: p => { const kids=visibleStudents(p);
      const kid = p.studentId ? kids.find(s=>s.StudentID===p.studentId) : kids[0];
      if(!kid) fail('NOT_FOUND','ไม่พบนักเรียน');
      const r=H.foodMenu({ className:kid.Class, month:p.month });
      r.studentId=kid.StudentID; r.nick=kid.Nickname||''; r.name=kid.NameTH||'';
      r.kids=kids.map(s=>({studentId:s.StudentID, nick:s.Nickname||'', name:s.NameTH||'', cls:s.Class}));
      return r; },

    /** A whole month for the WHOLE SCHOOL in one go (one round trip, one consistent picture). */
    saveFoodMenu: p => { const ap=staffById(p.staffId)||{};
      if(!canFoodMenu_(ap)) fail('NO_PERMISSION','ไม่มีสิทธิ์จัดการเมนูอาหาร');
      const month=ym(p.month||todayLocal().slice(0,7));
      M.foodMenus=M.foodMenus||[];
      const stamp=stampLocal();
      (p.days||[]).forEach(d=>{
        const date=ymd(d.date); if(!date || ym(date)!==month) return;      // never write outside the month being edited
        const blank=!(d.breakfast||d.snackAM||d.lunch||d.dinner||d.snackPM||d.note);
        // clearing a day means CLEARED: the old per-class rows go too, or the legacy fallback would
        // put yesterday's class menu straight back on a day somebody had just emptied
        if(blank){ for(let i=M.foodMenus.length-1;i>=0;i--){ if(ymd(M.foodMenus[i].Date)===date) M.foodMenus.splice(i,1); } return; }
        const i=M.foodMenus.findIndex(r=>String(r.Class)===MENU_ALL_ && ymd(r.Date)===date);
        const rec={ MenuID:'FM-'+MENU_ALL_+'-'+date, Class:MENU_ALL_, Date:date,
          Breakfast:d.breakfast||'', SnackAM:d.snackAM||'', Lunch:d.lunch||'', Dinner:d.dinner||'', SnackPM:d.snackPM||'',
          Note:d.note||'', UpdatedBy:p.staffId||'', UpdatedAt:stamp };
        if(i>=0) M.foodMenus[i]=Object.assign(M.foodMenus[i],rec); else M.foodMenus.push(rec);
      });
      logAct('saveFoodMenu',MENU_ALL_,month+' ('+(p.days||[]).length+' วัน)',actorOf(p));
      return H.foodMenu({month}); },

    /* ---- master food list (ของคาว / ของหวาน / ผลไม้ / อื่นๆ) ---------------------------------
     * This is what the teacher's daily journal picks from. It is deliberately NOT a fixed list: a
     * dish typed into the journal that is not here yet is added on submit, so the catalogue grows
     * from what the kitchen actually cooks instead of having to be complete on day one.
     * Every item carries both names — the app is bilingual and a parent reading in English should
     * not be shown Thai they cannot read.
     */
    foodItems: p => { p=p||{};
      const rows=(M.foodItems||[]).filter(i=>p.all?true:String(i.Active||'YES')!=='NO');
      const order={savoury:0,dessert:1,fruit:2,other:3};
      return rows.map(i=>({ itemId:i.ItemID, nameTH:i.NameTH||'', nameEN:i.NameEN||'',
          category:i.Category||'other', active:String(i.Active||'YES')!=='NO', photo:i.Photo||'' }))
        .sort((a,b)=>(order[a.category]-order[b.category])||String(a.nameTH).localeCompare(String(b.nameTH),'th')); },

    /**
     * JUST THE PICTURES, keyed by the name the journal actually stores.
     *
     * A journal records what a child ate as free TEXT ("ข้าวต้มไก่"), not as an item id — deliberately,
     * because a teacher may type a dish that is not in the master list yet. So the parent's screen
     * cannot look a photo up by id; it has to match on the name, and this is that lookup.
     *
     * A SEPARATE, TINY ACTION rather than part of foodItems, because the audience is different: this
     * is read by every parent on every journal, and foodItems carries categories, English names and
     * retired dishes that a parent screen has no use for. Only items that HAVE a photo are returned,
     * so a school that has uploaded none pays for an empty object.
     *
     * Both names are keys, so an English-language parent reading "Chicken rice porridge" gets the
     * same picture as the Thai one.
     */
    foodPhotos: () => { const out={};
      (M.foodItems||[]).forEach(i=>{ const u=String(i.Photo||'').trim(); if(!u) return;
        const th=String(i.NameTH||'').trim(), en=String(i.NameEN||'').trim();
        if(th) out[th]=u; if(en) out[en]=u; });
      return out; },

    /**
     * Add or edit one item. Teachers may ADD (that is the point); only admin may edit or retire.
     *
     * ...EXCEPT THE PHOTO, which follows canFoodMenu_ — the same flag that decides who may plan the
     * month's menu. The person who knows what a dish looks like is the one in the kitchen, and the
     * admin already delegates the menu to them; making them ask for a picture to be uploaded would
     * mean the pictures never get uploaded. Asked 2026-08-29.
     *
     * A photo is only WRITTEN when one was actually sent (`photo !== undefined`). Sending it always
     * would mean the edit dialog — which does not have to include the picture — silently cleared it
     * every time somebody fixed a spelling.
     */
    saveFoodItem: p => { const me=staffById(p.staffId)||{};
      const isAdmin = me.PositionLevel==='Admin'||me.Role==='Admin';
      const nameTH=String((p.item||{}).nameTH||'').trim();
      if(!nameTH) fail('BAD_INPUT','ใส่ชื่อเมนู (ภาษาไทย)');
      const cat=['savoury','dessert','fruit','other'].indexOf(String((p.item||{}).category))>=0?String(p.item.category):'other';
      const photo=(p.item||{}).photo;
      if(photo!==undefined && !canFoodMenu_(me)) fail('NO_PERMISSION','ไม่มีสิทธิ์แนบรูปอาหาร');
      M.foodItems=M.foodItems||[];
      if(p.item.itemId){
        const it=M.foodItems.find(x=>x.ItemID===p.item.itemId); if(!it)fail('NOT_FOUND','ไม่พบเมนู');
        /* A KITCHEN TEACHER MAY ATTACH A PICTURE WITHOUT BEING ABLE TO RENAME THE DISH. Editing the
         * master list is still the admin's — but refusing the whole call would have meant a teacher
         * with the menu flag could not add a photo to a dish that already exists, which is every
         * dish. So the photo is applied, and the rest of the edit is ignored for them. */
        if(!isAdmin){
          if(photo===undefined) fail('NO_PERMISSION','แก้ไขรายการหลักได้เฉพาะแอดมิน');
          it.Photo=String(photo||'');
          logAct('foodItemPhoto',it.ItemID,nameTH,actorOf(p)); return {itemId:it.ItemID, photoOnly:true}; }
        it.NameTH=nameTH; it.NameEN=String(p.item.nameEN||'').trim(); it.Category=cat;
        it.Active=p.item.active===false?'NO':'YES';
        if(photo!==undefined) it.Photo=String(photo||'');
        logAct('editFoodItem',it.ItemID,nameTH,actorOf(p)); return {itemId:it.ItemID}; }
      // adding the same dish twice is a data problem, not a new item — return the one that exists
      const dup=M.foodItems.find(x=>String(x.NameTH||'').trim()===nameTH);
      if(dup){ if(String(dup.Active||'YES')==='NO'){ dup.Active='YES'; }
        if(photo) dup.Photo=String(photo);   // a picture is new information even when the dish is not
        return {itemId:dup.ItemID, existed:true}; }
      const it={ ItemID:nextSeqId_(M.foodItems,'ItemID','FI',4), NameTH:nameTH,
        NameEN:String(p.item.nameEN||'').trim(), Category:cat, Active:'YES',
        Photo:String(photo||''),
        CreatedBy:p.staffId||'', CreatedAt:stampLocal() };
      M.foodItems.push(it); logAct('addFoodItem',it.ItemID,nameTH,actorOf(p));
      return {itemId:it.ItemID, existed:false}; },

    deleteFoodItem: p => { const me=staffById(p.staffId)||{};
      if(!adminLike_(me)) fail('NO_PERMISSION','เฉพาะแอดมิน');
      const it=(M.foodItems||[]).find(x=>x.ItemID===p.itemId); if(!it)fail('NOT_FOUND','ไม่พบเมนู');
      // retire rather than delete: journals already written refer to it by name
      it.Active='NO'; logAct('retireFoodItem',it.ItemID,it.NameTH,actorOf(p));
      return {itemId:it.ItemID, active:false}; },

    /** One-off seed of the school's own list, so nobody has to type 30 dishes to get started. */
    seedFoodItems: p => { const me=staffById(p.staffId)||{};
      if(!adminLike_(me)) fail('NO_PERMISSION','เฉพาะแอดมิน');
      M.foodItems=M.foodItems||[];
      let added=0;
      (FOOD_SEED_||[]).forEach(row=>{
        if(M.foodItems.some(x=>String(x.NameTH||'').trim()===row[0])) return;
        M.foodItems.push({ ItemID:nextSeqId_(M.foodItems,'ItemID','FI',4), NameTH:row[0], NameEN:row[1],
          Category:row[2], Active:'YES', CreatedBy:p.staffId||'', CreatedAt:stampLocal() });
        added++; });
      logAct('seedFoodItems','-','เพิ่ม '+added+' รายการ',actorOf(p));
      return {added, total:M.foodItems.length}; },

    /**
     * Which meals a class records. The youngest stay for dinner; the older classes and Premium do
     * not, and showing them an empty dinner box every day is just noise.
     */
    /**
     * Which meals this class records — and what the kitchen planned for that day.
     *
     * The monthly menu already says what is being served; making a teacher type it again into every
     * child's journal is both wasted work and a way for the two to disagree. The planned dish comes
     * back as the DEFAULT: it fills an empty slot, and never overwrites something a teacher wrote.
     */
    mealSlots: p => {
      const cls=String(p.className||''), slots=mealSlotsFor_(cls);
      const out={ className:cls, slots, planned:{} };
      if(!slots.length || !p.date) return out;                 // the baby class records no meals
      const date=ymd(p.date);
      // ONE menu a day for the whole school; `slots` above is what decides which of it this class
      // actually eats, so a Nursery 2 journal never pre-fills a dinner nobody served them.
      const m=menuRowsByDate_(M, ym(date))[date];
      if(!m) return out;
      // SnackAM is the morning snack the school plans; the journal has one snack slot, so that is
      // the one it defaults from, falling back to the afternoon one when only that is planned.
      const byKey={ Breakfast:m.Breakfast, Lunch:m.Lunch, Dinner:m.Dinner, Snack:(m.SnackAM||m.SnackPM) };
      slots.forEach(s=>{ const v=String(byKey[s.key]||'').trim(); if(v) out.planned[s.key]=v; });
      return out; },

    /* ================= Phase 7b: satisfaction survey ====================================
     * Three shapes, because a school asks three different kinds of question:
     *   rating  — 1..5 faces ("how happy are you with…")
     *   vote    — pick one of the school's own options
     *   comment — free text only
     * Scope decides who is asked: everyone, one class, or one child's family.
     */
    surveys: p => { const ap=staffById(p.staffId)||{};
      if(!adminLike_(ap)) fail('NO_PERMISSION','เฉพาะแอดมิน');
      return (M.surveys||[]).slice().sort((a,b)=>String(b.CreatedAt||'').localeCompare(String(a.CreatedAt||'')))
        .map(s=>Object.assign(surveyView_(s), { responses:(M.surveyResponses||[]).filter(r=>r.SurveyID===s.SurveyID).length })); },

    saveSurvey: p => { const ap=staffById(p.staffId)||{};
      if(!adminLike_(ap)) fail('NO_PERMISSION','เฉพาะแอดมิน');
      const d=p.survey||{}; if(!String(d.title||'').trim()) fail('BAD_INPUT','ใส่หัวข้อแบบสอบถาม');
      // One to five questions. A caller still sending the old single type/options is accepted and
      // turned into one question, so nothing that already works has to change.
      let raw = Array.isArray(d.questions) && d.questions.length ? d.questions
              : [{ text:d.title, type:d.type, options:d.options }];
      raw = raw.filter(q=>String((q&&q.text)||'').trim());
      if(!raw.length) fail('BAD_INPUT','ใส่คำถามอย่างน้อย 1 ข้อ');
      if(raw.length>SURVEY_MAX_Q) fail('BAD_INPUT','ใส่คำถามได้ไม่เกิน '+SURVEY_MAX_Q+' ข้อ');
      const questions = raw.map((q,i)=>{
        const ty=SURVEY_TYPES.indexOf(String(q.type))>=0?String(q.type):'rating';
        const opts=(Array.isArray(q.options)?q.options:[]).map(x=>String(x).trim()).filter(Boolean);
        if(ty==='vote' && !opts.length) fail('BAD_INPUT','ข้อ '+(i+1)+': ใส่ตัวเลือกอย่างน้อย 1 ข้อ');
        return { text:String(q.text).trim(), type:ty, options:opts };
      });
      M.surveys=M.surveys||[];
      const rec={ Title:String(d.title).trim(), Description:String(d.description||''),
        Questions:JSON.stringify(questions),
        // the first question is mirrored into the old columns so anything still reading them agrees
        Type:questions[0].type, Options:JSON.stringify(questions[0].options),
        Scope:['all','class','student'].indexOf(String(d.scope))>=0?String(d.scope):'all',
        Target:String(d.target||''), StartDate:ymd(d.startDate||todayLocal()), EndDate:ymd(d.endDate||''),
        Status:d.status==='CLOSED'?'CLOSED':'OPEN', Anonymous:d.anonymous?'YES':'' };
      if(d.surveyId){ const s=(M.surveys||[]).find(x=>x.SurveyID===d.surveyId); if(!s)fail('NOT_FOUND','ไม่พบแบบสอบถาม');
        Object.assign(s,rec); logAct('editSurvey',s.SurveyID,s.Title,actorOf(p)); return surveyView_(s); }
      const s=Object.assign({ SurveyID:nextSeqId_(M.surveys,'SurveyID','SV',3), CreatedBy:p.staffId||'', CreatedAt:stampLocal() },rec);
      M.surveys.push(s); logAct('addSurvey',s.SurveyID,s.Title,actorOf(p)); return surveyView_(s); },

    setSurveyStatus: p => { const ap=staffById(p.staffId)||{};
      if(!adminLike_(ap)) fail('NO_PERMISSION','เฉพาะแอดมิน');
      const s=(M.surveys||[]).find(x=>x.SurveyID===p.surveyId); if(!s)fail('NOT_FOUND','ไม่พบแบบสอบถาม');
      s.Status = p.reopen ? 'OPEN' : 'CLOSED';
      logAct('setSurveyStatus',s.SurveyID,s.Status,actorOf(p)); return surveyView_(s); },

    // Deleting a survey deletes the answers people gave it — say how many, and log it.
    deleteSurvey: p => { const ap=staffById(p.staffId)||{};
      if(!adminLike_(ap)) fail('NO_PERMISSION','เฉพาะแอดมิน');
      const i=(M.surveys||[]).findIndex(x=>x.SurveyID===p.surveyId); if(i<0)fail('NOT_FOUND','ไม่พบแบบสอบถาม');
      const s=M.surveys[i];
      const kept=(M.surveyResponses||[]).filter(r=>r.SurveyID!==p.surveyId);
      const removed=(M.surveyResponses||[]).length-kept.length;
      M.surveyResponses=kept; M.surveys.splice(i,1);
      logAct('deleteSurvey',p.surveyId,s.Title+' (ลบคำตอบ '+removed+')',actorOf(p));
      return {ok:true, removedResponses:removed}; },

    /** What THIS family is being asked right now, with anything they already answered. */
    openSurveys: p => { const kids=visibleStudents(p); const today=todayLocal();
      const mine=(M.surveys||[]).filter(s=>{
        if(String(s.Status)!=='OPEN') return false;
        if(s.StartDate && ymd(s.StartDate)>today) return false;
        if(s.EndDate && ymd(s.EndDate)<today) return false;
        if(s.Scope==='class') return kids.some(k=>String(k.Class)===String(s.Target));
        if(s.Scope==='student') return kids.some(k=>k.StudentID===String(s.Target));
        return true; });
      return mine.map(s=>{
        const answered=(M.surveyResponses||[]).filter(r=>r.SurveyID===s.SurveyID &&
          (p.parentId ? r.ParentID===p.parentId : kids.some(k=>k.StudentID===r.StudentID)));
        return Object.assign(surveyView_(s), { answered:answered.length>0,
          myAnswers: answered.length?surveyAnswers_(answered[0]):null,
          // kept for anything still reading a single answer
          myAnswer: answered.length?surveyAnswers_(answered[0])[0]:null }); }); },

    /** One answer per family per survey — re-submitting EDITS it rather than stuffing the ballot. */
    submitSurvey: p => { const s=(M.surveys||[]).find(x=>x.SurveyID===p.surveyId);
      if(!s) fail('NOT_FOUND','ไม่พบแบบสอบถาม');
      if(String(s.Status)!=='OPEN') fail('CLOSED','แบบสอบถามนี้ปิดรับคำตอบแล้ว');
      const kids=visibleStudents(p); const sid=p.studentId||(kids[0]&&kids[0].StudentID)||'';
      if(kids.length && !kids.some(k=>k.StudentID===sid)) fail('NO_ACCESS','ไม่มีสิทธิ์ตอบแทนนักเรียนคนนี้');
      // Answers arrive as an array aligned to the questions. A caller sending the old single
      // rating/choice/comment is treated as answering question 1.
      const qs=surveyQuestions_(s);
      const given=Array.isArray(p.answers)&&p.answers.length ? p.answers
                : [{rating:p.rating, choice:p.choice, comment:p.comment}];
      const answers=qs.map((q,i)=>{
        const a=given[i]||{};
        const rating=Math.max(0,Math.min(5,Math.round(Number(a.rating)||0)));
        const choice=String(a.choice||'').trim(), comment=String(a.comment||'').slice(0,1000);
        const where='ข้อ '+(i+1)+': ';
        if(q.type==='rating' && !rating) fail('BAD_INPUT',(qs.length>1?where:'')+'เลือกระดับความพึงพอใจ');
        if(q.type==='vote' && !choice) fail('BAD_INPUT',(qs.length>1?where:'')+'เลือกคำตอบ');
        if(q.type==='comment' && !comment.trim()) fail('BAD_INPUT',(qs.length>1?where:'')+'กรุณาเขียนความคิดเห็น');
        return {rating, choice, comment};
      });
      M.surveyResponses=M.surveyResponses||[];
      const mine=M.surveyResponses.find(r=>r.SurveyID===p.surveyId &&
        (p.parentId ? r.ParentID===p.parentId : r.StudentID===sid));
      const rec={ SurveyID:p.surveyId, StudentID:sid, ParentID:p.parentId||'',
        Answers:JSON.stringify(answers),
        // question 1 mirrored into the old columns, so the sheet stays readable at a glance
        Rating:answers[0].rating, Choice:answers[0].choice, Comment:answers[0].comment, SubmittedAt:stampLocal() };
      if(mine){ Object.assign(mine,rec); return {ok:true, updated:true}; }
      M.surveyResponses.push(Object.assign({ResponseID:nextSeqId_(M.surveyResponses,'ResponseID','SR',4)},rec));
      return {ok:true, updated:false}; },

    surveyResults: p => { const ap=staffById(p.staffId)||{};
      if(!adminLike_(ap)) fail('NO_PERMISSION','เฉพาะแอดมิน');
      const s=(M.surveys||[]).find(x=>x.SurveyID===p.surveyId); if(!s)fail('NOT_FOUND','ไม่พบแบบสอบถาม');
      const rs=(M.surveyResponses||[]).filter(r=>r.SurveyID===p.surveyId);
      const qs=surveyQuestions_(s);
      const anon=String(s.Anonymous||'')==='YES';
      // an anonymous survey must not hand back who said what — that is the promise made to parents
      const whoOf=r=> anon ? '' : ((studentById(r.StudentID)||{}).Nickname || '');

      const perQ=qs.map((q,i)=>{
        const dist=[0,0,0,0,0]; let sum=0, rated=0;
        const tally={}; q.options.forEach(o=>tally[o]=0);
        const comments=[];
        rs.forEach(r=>{ const a=surveyAnswers_(r)[i]; if(!a) return;
          if(a.rating>=1&&a.rating<=5){ dist[a.rating-1]++; sum+=a.rating; rated++; }
          if(a.choice) tally[a.choice]=(tally[a.choice]||0)+1;
          if(String(a.comment||'').trim()) comments.push({comment:a.comment, rating:a.rating, at:r.SubmittedAt, who:whoOf(r)});
        });
        return { id:q.id, text:q.text, type:q.type, options:q.options,
          dist, tally, rated, average: rated?Math.round(sum/rated*10)/10:null, comments };
      });

      // survey-level headline: every rating answer across every question
      let sum=0, rated=0;
      perQ.forEach(q=>{ q.dist.forEach((n,i)=>{ sum+=n*(i+1); rated+=n; }); });
      return Object.assign(surveyView_(s), {
        responses:rs.length, rated, average: rated?Math.round(sum/rated*10)/10:null,
        perQuestion: perQ,
        // question 1, so the older single-question view keeps working unchanged
        dist: perQ[0]?perQ[0].dist:[0,0,0,0,0], tally: perQ[0]?perQ[0].tally:{},
        comments: perQ.reduce((a,q)=>a.concat(q.comments),[]) }); },

    /** Monthly rollup across every survey — what the school reads at the end of a month. */
    surveySummary: p => { const ap=staffById(p.staffId)||{};
      if(!adminLike_(ap)) fail('NO_PERMISSION','เฉพาะแอดมิน');
      const month=ym(p.month||todayLocal().slice(0,7));
      const rs=(M.surveyResponses||[]).filter(r=>ym(r.SubmittedAt)===month);
      const byS={}; rs.forEach(r=>{ (byS[r.SurveyID]=byS[r.SurveyID]||[]).push(r); });
      // average over EVERY rating answer, not just question 1 — otherwise four of five questions
      // would be silently left out of the school's monthly number
      const ratings=r=>surveyAnswers_(r).map(a=>Number(a.rating)||0).filter(v=>v>=1&&v<=5);
      let sum=0, rated=0;
      rs.forEach(r=>ratings(r).forEach(v=>{ sum+=v; rated++; }));
      return { month, responses:rs.length, rated, average: rated?Math.round(sum/rated*10)/10:null,
        surveys: Object.keys(byS).map(id=>{ const s=(M.surveys||[]).find(x=>x.SurveyID===id)||{};
          const g=byS[id]; let ss=0, sn=0;
          g.forEach(r=>ratings(r).forEach(v=>{ ss+=v; sn++; }));
          return { surveyId:id, title:s.Title||id, type:s.Type||'', responses:g.length,
            questionCount: s.SurveyID?surveyQuestions_(s).length:1,
            average: sn?Math.round(ss/sn*10)/10:null }; })
          .sort((a,b)=>b.responses-a.responses) }; },

    // ========== Group D: staff/parent CRUD, groups, holidays, move, import/export ==========
    listStaffGroups: () => M.staffGroups,
    setStaffGroupHours: p => { const g=M.staffGroups.find(x=>x.GroupName===p.group); if(!g)fail('NOT_FOUND','ไม่พบกลุ่ม'); if(p.checkIn)g.CheckInTime=p.checkIn; if(p.checkOut)g.CheckOutTime=p.checkOut; return g; },
    addStaffGroup: p => { if(!p.name)fail('MISSING','ใส่ชื่อกลุ่ม'); if(M.staffGroups.find(g=>g.GroupName===p.name))fail('DUP','มีกลุ่มนี้แล้ว'); M.staffGroups.push({GroupName:p.name,GroupNameEN:p.nameEN||p.name,CheckInTime:p.checkIn||'08:00',CheckOutTime:p.checkOut||'17:00'}); return {ok:true}; },
    deleteStaffGroup: p => { const i=M.staffGroups.findIndex(g=>g.GroupName===p.name); if(i<0)fail('NOT_FOUND','ไม่พบกลุ่ม'); M.staffGroups.splice(i,1); return {ok:true}; },

    // editable PDPA capability matrix
    permMatrix: () => M.permMatrix,
    setPerm: p => { if(!M.permMatrix[p.role])M.permMatrix[p.role]={}; M.permMatrix[p.role][p.cap]=!!p.value; return M.permMatrix[p.role]; },
    saveStaff: p => { const d=p.data||{};
      if(p.staffId){ const s=staffById(p.staffId); if(!s.StaffID)fail('NOT_FOUND','ไม่พบพนักงาน'); Object.assign(s,d); return s; }
      const id=nextSeqId_(M.staff,'StaffID','STF',2); const rec=Object.assign({StaffID:id,Role:'Teacher',Status:'ACTIVE'},d); M.staff.push(rec); return rec; },
    deleteStaff: p => { const i=M.staff.findIndex(s=>s.StaffID===p.staffId); if(i<0)fail('NOT_FOUND','ไม่พบพนักงาน'); M.staff.splice(i,1); return {ok:true}; },
    listParents: () => M.parents,
    // family profile for the "My info" screen: ALL parents linked to the caller's children (co-parents
    // included) + the children themselves. Identity (uid/parentId) is injected server-side.
    familyProfile: p => { const kids=visibleStudents(p); const kidIds=kids.map(s=>s.StudentID); const seen={}; const parents=[];
      M.parents.forEach(pa=>{ if((kidIds.indexOf(pa.StudentID)>=0 || pa.ParentID===p.parentId) && !seen[pa.ParentID]){ seen[pa.ParentID]=1;
        // Photo = an uploaded picture (wins); LinePictureUrl = their current LINE profile picture (fallback)
        parents.push({ ParentID:pa.ParentID, NameTH:pa.NameTH||pa.Name, NameEN:pa.NameEN, Nickname:pa.Nickname, NicknameEN:pa.NicknameEN, Title:pa.Title, NationalID:pa.NationalID, Relationship:pa.Relationship, Phone:pa.Phone, Occupation:pa.Occupation, Workplace:pa.Workplace, OfficePhone:pa.OfficePhone, Address:pa.Address, Photo:pa.Photo, LinePictureUrl:pa.LinePictureUrl, StudentID:pa.StudentID, isMe: pa.ParentID===p.parentId }); } });
      return { parents, myParentId:p.parentId, students: kids.map(s=>({ StudentID:s.StudentID, NameTH:s.NameTH, NameEN:s.NameEN, Nickname:s.Nickname, NicknameEN:s.NicknameEN, Class:s.Class, DOB:s.DOB, Plan:s.Plan, NationalID:s.NationalID, Gender:s.Gender, BloodType:s.BloodType, RH:s.RH, Allergy:s.Allergy, MedicalHistory:s.MedicalHistory, EmergencyContact:s.EmergencyContact, Address:s.Address, Race:s.Race, Nationality:s.Nationality, Religion:s.Religion, Photo:s.Photo })) }; },
    // edit a parent that is either the caller or a co-parent of the caller's child (server validates); whitelisted.
    saveFamilyParent: p => { const kids=visibleStudents(p); const kidIds=kids.map(s=>s.StudentID); const tid=p.targetParentId||p.parentId;
      const pa=M.parents.find(x=>x.ParentID===tid); if(!pa)fail('NOT_FOUND','ไม่พบผู้ปกครอง');
      if(!(pa.ParentID===p.parentId || kidIds.indexOf(pa.StudentID)>=0))fail('NO_ACCESS','ไม่มีสิทธิ์แก้ไขผู้ปกครองนี้');
      // Photo: '' clears the upload -> the display falls back to their LINE profile picture
      const d=p.data||{}; ['NameTH','NameEN','Nickname','NicknameEN','Title','Relationship','Phone','Occupation','Workplace','OfficePhone','Address','Photo'].forEach(k=>{ if(d[k]!==undefined) pa[k]=d[k]; }); return {ok:true, parentId:tid}; },
    // parent edits their own child's safe fields (studentId ownership is enforced by applyIdentity_ on GAS).
    saveStudentSelf: p => { const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน');
      const d=p.data||{}; ['Nickname','NicknameEN','BloodType','RH','Allergy','MedicalHistory','EmergencyContact','Address','Race','Nationality','Religion','Photo'].forEach(k=>{ if(d[k]!==undefined) s[k]=d[k]; }); return {ok:true, studentId:p.studentId}; },
    saveParent: p => { const d=p.data||{};
      if(p.parentId){ const pa=M.parents.find(x=>x.ParentID===p.parentId); if(!pa)fail('NOT_FOUND','ไม่พบผู้ปกครอง'); Object.assign(pa,d); return pa; }
      const id=nextSeqId_(M.parents,'ParentID','PAR',3); const rec=Object.assign({ParentID:id},d); M.parents.push(rec); return rec; },
    deleteParent: p => { const i=M.parents.findIndex(x=>x.ParentID===p.parentId); if(i<0)fail('NOT_FOUND','ไม่พบผู้ปกครอง'); M.parents.splice(i,1); return {ok:true}; },
    saveStudent: p => { const d=p.data||{}; const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน'); Object.assign(s,d); return s; },

    holidays: () => M.holidays.slice().sort((a,b)=>a.Date.localeCompare(b.Date)),
    // blank times = the whole day. cfgTime_ turns anything unreadable into blank rather than into
    // midnight, which would leave the afternoon quietly open.
    addHoliday: p => { M.holidays.push({Date:p.date,NameTH:p.nameTH||p.nameEN||'',NameEN:p.nameEN||p.nameTH||'',Recurring:!!p.recurring,
      StartTime:cfgTime_(p.startTime,''),EndTime:cfgTime_(p.endTime,'')}); return {ok:true}; },
    removeHoliday: p => { const i=M.holidays.findIndex(h=>h.Date===p.date&&(h.NameTH===p.nameTH||!p.nameTH)); if(i>=0)M.holidays.splice(i,1); return {ok:true}; },
    /**
     * Correct a holiday IN PLACE. A wrong date or a wrong half-day window used to mean delete-then-
     * add: two writes, and if the second one failed the school was left with no holiday at all —
     * on a day the check-in guard had already been told to close.
     *
     * `date`+`nameTH` identify the row as they do for removeHoliday; anything else given is the new
     * value, and anything omitted is left alone. Blank times mean the whole day, exactly as they do
     * on the way in — passing '' is how you turn a half day back into a full one.
     */
    editHoliday: p => { const from=ymd(p.date||''), name=String(p.nameTH==null?'':p.nameTH);
      const h=M.holidays.find(x=>ymd(x.Date)===from&&(String(x.NameTH||'')===name||!name));
      if(!h) fail('NOT_FOUND','ไม่พบวันหยุดที่ต้องการแก้ไข');
      const to=ymd(p.newDate||'')||from;
      if(to!==from && M.holidays.some(x=>x!==h&&ymd(x.Date)===to)) fail('DUPLICATE','มีวันหยุดของวันนี้อยู่แล้ว');
      const s=cfgTime_(p.startTime,''), e=cfgTime_(p.endTime,'');
      if(s&&e&&e<s) fail('BAD_INPUT','เวลาสิ้นสุดอยู่ก่อนเวลาเริ่ม');
      h.Date=to;
      if(p.newNameTH!=null||p.newNameEN!=null){
        const th=String(p.newNameTH!=null?p.newNameTH:(h.NameTH||'')), en=String(p.newNameEN!=null?p.newNameEN:(h.NameEN||''));
        h.NameTH=th||en; h.NameEN=en||th; }
      if(p.recurring!=null) h.Recurring=!!p.recurring;
      if(p.startTime!=null) h.StartTime=s;
      if(p.endTime!=null) h.EndTime=e;
      return {ok:true, date:h.Date, nameTH:h.NameTH, startTime:h.StartTime||'', endTime:h.EndTime||''}; },

    // ---- vaccines ----
    // A vaccine record holds MULTIPLE dose dates per (StudentID, Key) — some vaccines need several shots.
    // Stored as `Dates` (array). Old records had a single `Date`; vacDates_ normalizes both shapes.
    vaccineSchedule: () => M.vaccineSchedule,
    studentVaccines: p => M.vaccineRecords.filter(v=>v.StudentID===p.studentId)
      .map(v=>({ StudentID:v.StudentID, Key:v.Key, VaccineName:v.VaccineName||'', Dates:vacDates_(v) })),
    // batch save (the "Save" button): replace ALL of this student's vaccine rows in place.
    // Other students' rows are preserved, so persist never truncates the collection.
    saveVaccines: p => { const sid=p.studentId;
      M.vaccineRecords = M.vaccineRecords.filter(x=>x.StudentID!==sid);
      (p.records||[]).forEach(rec=>{ const dates=(rec.dates||[]).map(d=>String(d||'').trim()).filter(Boolean);
        if(dates.length) M.vaccineRecords.push({ StudentID:sid, Key:rec.key, VaccineName:rec.name||'', Dates:dates }); });
      return { ok:true, count:M.vaccineRecords.filter(x=>x.StudentID===sid).length }; },
    // legacy single-dose helpers (kept for back-compat; UI now uses saveVaccines)
    setVaccine: p => { let v=M.vaccineRecords.find(x=>x.StudentID===p.studentId&&x.Key===p.key);
      if(!v){ v={StudentID:p.studentId,Key:p.key}; M.vaccineRecords.push(v); }
      const d=p.date||todayLocal(); v.Dates=[d]; v.Date=d; return v; },
    removeVaccine: p => { const i=M.vaccineRecords.findIndex(x=>x.StudentID===p.studentId&&x.Key===p.key); if(i>=0)M.vaccineRecords.splice(i,1); return {ok:true}; },

    // ---- absence tracking + rate rule ----
    // students with total absence (leave+no-show) >= minDays, with follow-up note/status
    // absence follow-up. Real sources: ABSENCE_LOG (no-shows) ∪ studentLeaves (parent/teacher-filed
    // leave/absence). Distinct dates per student → count; group 2–5 vs >5; if the child later checked
    // IN after the last absence, annotate the return date ("มาวันที่ …"). >5 days is flagged strongly.
    absenceReport: p => { const min=p.minDays||2;
      const byStu={};
      const add=(sid,date,reason)=>{ if(!sid)return; const d=ymd(date); if(!d)return; const b=byStu[sid]=byStu[sid]||{dates:{},reasons:{}}; b.dates[d]=1; if(reason)b.reasons[String(reason)]=1; };
      (M.absenceLog||[]).forEach(a=>add(a.StudentID,a.Date,a.Reason));
      (M.studentLeaves||[]).forEach(l=>add(l.StudentID,l.Date,l.Reason||l.Type));
      const lastIn=sid=>{ const ins=(M.studentCheckins||[]).filter(c=>c.StudentID===sid&&c.InTime).map(c=>ymd(c.Date)).sort(); return ins.length?ins[ins.length-1]:''; };
      return activeStudents().map(s=>{ const b=byStu[s.StudentID]||{dates:{},reasons:{}}; const dates=Object.keys(b.dates).sort(); const count=dates.length;
          const fu=M.absenceFollowups.find(f=>f.StudentID===s.StudentID)||{};
          const lastAbs=dates[dates.length-1]||''; const li=lastIn(s.StudentID); const returned=(li&&lastAbs&&li>lastAbs)?li:'';
          return {studentId:s.StudentID,name:s.NameTH,nameEN:s.NameEN,nick:s.Nickname,nickEN:s.NicknameEN,class:s.Class,count,
            group:(count>5?'over5':'range'), firstDate:dates[0]||'', lastDate:lastAbs, returnedDate:returned,
            reasons:Object.keys(b.reasons).join(', '),
            note:fu.Note||'',status:fu.Status||'',followDate:fu.Date||''}; })
        .filter(x=>x.count>=min).sort((a,b)=>b.count-a.count); },
    setAbsenceFollowup: p => { let f=M.absenceFollowups.find(x=>x.StudentID===p.studentId);
      if(!f){f={StudentID:p.studentId};M.absenceFollowups.push(f);} f.Note=p.note; f.Status=p.status; f.Date=todayLocal(); return f; },
    /* CHILDREN COUNTED FOR THE TEACHER CHILD-RATE = active students, minus those absent
     * AbsenceRateExcludeDays or more — i.e. the ones who were not really here for the month.
     *
     * IT NEVER LOOKED AT THE MONTH. The old body was `M.absenceLog.forEach(...)` with no filter, so
     * every absence ever recorded counted for ever: a child who missed six days in March was still
     * excluded from August's rate, and from every month after that, permanently. The rate could
     * only go DOWN. Payroll asks about one month at a time, so this now answers about one month.
     *
     * It also hands back the LIST, not only the totals — asked 2026-08-30: "จำนวนที่ระบบคิดมาว่าคิด
     * เรทได้ 4 คน และเด็กที่ยังไม่นับเรทคือใคร". A count that decides part of somebody's pay and that
     * nobody can check is a count the school has to take on trust. ~30 children is a few hundred
     * bytes, and sending it with the count costs no extra round trip (which on GAS is ~5s).
     *
     * WHAT COUNTS AS A DAY AWAY. Until 2026-08-30 only ABSENCE_LOG did. Nothing in the app has ever
     * WRITTEN to ABSENCE_LOG — every day a child is away is filed as ลา, through studentAbsence or
     * the parent leave form — so the exclusion had never fired once on live data and every child was
     * counted every month however little they attended. The list this now returns is what made that
     * visible: 34 children, ขาด 0 straight down the column, and one child with ลา 8.
     *
     * The school's rule is "เด็กที่มาอยู่เต็มเดือน", so ขาด + ลา is the number that decides
     * (confirmed 2026-08-30). Both are still reported separately: a planned trip and a no-show are
     * different things to a teacher even when they cost the same.
     */
    ratedChildCount: p => { p=p||{}; const excl=Number(cfg.AbsenceRateExcludeDays||6);
      const mm=String(p.month||todayLocal()).slice(0,7);
      const inM=d=>String(ymd(d)||'').slice(0,7)===mm;
      const abs={}, lv={};
      (M.absenceLog||[]).forEach(a=>{ if(inM(a.Date)) abs[a.StudentID]=(abs[a.StudentID]||0)+1; });
      (M.studentLeaves||[]).forEach(l=>{ if(inM(l.Date)) lv[l.StudentID]=(lv[l.StudentID]||0)+1; });
      const students=activeStudents().map(s=>{ const a=abs[s.StudentID]||0, l=lv[s.StudentID]||0;
        return {studentId:s.StudentID, name:s.NameTH||s.NameEN||'', nick:s.Nickname||s.NicknameEN||'',
          class:s.Class||'', absent:a, leave:l, away:a+l, rated:(a+l)<excl}; })
        // the ones NOT counted first, most days away first — that is the list an admin came to check
        .sort((x,y)=> (x.rated!==y.rated) ? (x.rated?1:-1) : (y.away-x.away));
      const excluded=students.filter(x=>!x.rated).length;
      return {month:mm, total:students.length, excluded, rated:students.length-excluded, excludeDays:excl, students}; },

    // move a student to another Nursery (class) / a teacher to another department
    moveStudent: p => { const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน'); s.Class=p.toClass; return s; },
    moveTeacher: p => { const s=staffById(p.staffId); if(!s.StaffID)fail('NOT_FOUND','ไม่พบพนักงาน'); s.Department=p.toDept; return s; },
    // Class-organize moves for a NON-admin caller granted the capability. The caller's staffId is injected
    // server-side (never the target — so applyIdentity_ can't clobber the target id). Admin/Leader always
    // qualify; a plain teacher needs CanClassOrg=true set by the admin on their staff record.
    orgMoveTeacher: p => { const me=staffById(p.staffId)||{};
      if(!canOrganize_(me)) fail('NO_PERMISSION','ไม่มีสิทธิ์จัดชั้นเรียน (ต้องได้รับสิทธิ์จากแอดมิน)');
      const s=staffById(p.targetId); if(!s.StaffID)fail('NOT_FOUND','ไม่พบพนักงาน');
      // dropping a leaver into a Nursery would put them back on a class list — the screen no longer
      // offers them, and this is what makes that true rather than merely tidy
      if(staffEnded_(s)) fail('ENDED','สิ้นสุดการทำงานแล้ว — จัดเข้าชั้นเรียนไม่ได้');
      // an Observer is a read-only auditor, not somebody a room can be given to
      if(String(s.Role||'')==='Observer') fail('NO_PERMISSION','ผู้ตรวจสอบ (Observer) ไม่ต้องจัดเข้าชั้นเรียน');
      /* CLASSES TOO, OR TAKING A ROOM AWAY DOES NOTHING.
       *
       * coveredClasses_ is the UNION of Department, Classes and today's cover — and the staff form
       * has always written the same value to BOTH columns. This handler only ever wrote Department,
       * so moving a teacher out of Nursery 2 left 'Nursery 2' sitting in Classes and she still
       * covered it: the screen said she had moved, the class lists said she had not. It could only
       * ever ADD a room, never remove one, which is exactly the half of the job the tick boxes are
       * for. Found while building the teacher tab (2026-09-02); it would have made every un-tick
       * look like it had not saved. */
      s.Department=p.toDept||''; s.Classes=p.toDept||'';
      logAct('moveTeacher',p.targetId,'→ '+(p.toDept||'-'),actorOf(p)); return {ok:true}; },
    orgMoveStudent: p => { const me=staffById(p.staffId)||{};
      if(!canMoveStudent_(me)) fail('NO_PERMISSION','ย้ายชั้นเรียนนักเรียนได้เฉพาะแอดมินและหัวหน้าครู');
      const s=studentById(p.targetId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน'); s.Class=p.toClass||'';
      logAct('moveStudent',p.targetId,'→ '+(p.toClass||'-'),actorOf(p)); return {ok:true}; },

    /* ---- temporary class cover (หัวหน้าครูเพิ่มชั้นเรียนให้ครูรายคน) --------------------------
     *
     * Who may grant it: the same people who may reorganise classes at all (canOrganize_ — admin,
     * leader, head teacher, or a teacher the admin flagged). Deliberately NOT a new permission:
     * "you may move a teacher into a class permanently, but not lend them to one for a day" would
     * be a strange line to draw, and a second flag is a second thing to get wrong.
     */
    classCoverList: p => { p=p||{}; const me=staffById(p.staffId)||{};
      if(!canCover_(me)) fail('NO_PERMISSION','ไม่มีสิทธิ์จัดชั้นเรียน (เฉพาะแอดมิน / หัวหน้าครู)');
      const today=todayLocal();
      return classCover_().slice()
        .sort((a,b)=>String(a.From).localeCompare(String(b.From))||String(a.StaffID).localeCompare(String(b.StaffID)))
        .map(r=>{ const s=staffById(r.StaffID)||{};
          const from=ymd(r.From), to=String(r.To||'').trim()?ymd(r.To):'';
          return { coverId:r.CoverID, staffId:r.StaffID,
            staffName:s.NameTH||s.Name||r.StaffID, staffNick:s.Nickname||'',
            className:r.ClassName, from, to, reason:r.Reason||'',
            // three states, so the screen never has to work out a date range itself
            active: from<=today && (!to||to>=today), upcoming: from>today, ended: !!to && to<today }; }); },
    classCoverAdd: p => { const me=staffById(p.staffId)||{};
      if(!canCover_(me)) fail('NO_PERMISSION','ไม่มีสิทธิ์จัดชั้นเรียน (เฉพาะแอดมิน / หัวหน้าครู)');
      const s=staffById(p.targetId); if(!s||!s.StaffID) fail('NOT_FOUND','ไม่พบคุณครู');
      const cls=String(p.className||'').trim(); if(!cls) fail('BAD_INPUT','เลือกชั้นเรียน');
      if(!allClassObjs_().some(c=>c.ClassName===cls)) fail('NOT_FOUND','ไม่พบชั้นเรียนนี้');
      const from=ymd(p.from||todayLocal());
      /* A BLANK END DATE MEANS "UNTIL SOMEBODY REMOVES IT" — which is exactly the state this feature
       * exists to avoid, so it is refused. The school's own words were "ไม่ได้ทุกวัน": cover with no
       * end is not cover, it is a permanent reassignment made by the back door. Same day = one day. */
      const to=ymd(p.to||from);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)) fail('BAD_INPUT','วันที่ไม่ถูกต้อง');
      if(to<from) fail('BAD_INPUT','วันสิ้นสุดต้องไม่ก่อนวันเริ่ม');
      // ...and a class this teacher already has permanently is not cover; saying so is more use
      // than a row that changes nothing
      const perm=coveredClasses_(Object.assign({},s,{StaffID:s.StaffID}),'1900-01-01').map(c=>c.ClassName);
      if(perm.indexOf(cls)>=0) fail('ALREADY','คุณครูดูแลชั้นเรียนนี้อยู่แล้วตามปกติ');
      const dup=classCover_().find(r=>String(r.StaffID)===String(s.StaffID)&&String(r.ClassName)===cls
        && ymd(r.From)<=to && (!String(r.To||'').trim()||ymd(r.To)>=from));
      if(dup) fail('DUPLICATE','ช่วงวันที่นี้ทับกับรายการที่มีอยู่แล้ว');
      const rec={ CoverID:nextSeqId_(classCover_(),'CoverID','CV',4), StaffID:s.StaffID, ClassName:cls,
        From:from, To:to, Reason:String(p.reason||'').trim(), AddedBy:p.staffId||'', AddedAt:stampLocal() };
      classCover_().push(rec);
      logAct('classCoverAdd',s.StaffID,cls+' '+from+(to!==from?'–'+to:''),actorOf(p));
      return { coverId:rec.CoverID, staffId:s.StaffID, className:cls, from, to }; },
    classCoverRemove: p => { const me=staffById(p.staffId)||{};
      if(!canCover_(me)) fail('NO_PERMISSION','ไม่มีสิทธิ์จัดชั้นเรียน (เฉพาะแอดมิน / หัวหน้าครู)');
      const i=classCover_().findIndex(r=>String(r.CoverID)===String(p.coverId));
      if(i<0) fail('NOT_FOUND','ไม่พบรายการ');
      const r=classCover_()[i]; classCover_().splice(i,1);
      logAct('classCoverRemove',r.StaffID,r.ClassName+' '+ymd(r.From),actorOf(p));
      return {ok:true}; },
    /** What a teacher is covering right now — shown on their own home screen, so it is never a surprise. */
    myClassCover: p => { const me=staffById(p.staffId)||{}; if(!me.StaffID) return [];
      const today=todayLocal();
      return classCover_().filter(r=>String(r.StaffID)===String(me.StaffID))
        .filter(r=>{ const to=String(r.To||'').trim(); return !to || ymd(to)>=today; })
        .sort((a,b)=>String(a.From).localeCompare(String(b.From)))
        .map(r=>({ coverId:r.CoverID, className:r.ClassName, from:ymd(r.From),
          to:String(r.To||'').trim()?ymd(r.To):'', reason:r.Reason||'',
          active: ymd(r.From)<=today })); },

    // ========== withdrawal / cancel enrolment (parent self-service + Admin direct) ==========
    // valid reason codes (config-driven): graduated | moved | transferred | other
    withdrawReasons: () => (cfg.WithdrawReasons||['graduated','moved','transferred','other']).slice(),
    // parent requests withdrawal — creates a PENDING request (Admin processes it later). Student stays ACTIVE meanwhile.
    requestWithdrawal: p => { const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน');
      if(!p.reason)fail('MISSING','กรุณาเลือกเหตุผล');
      if(p.reason==='other'&&!String(p.detail||'').trim())fail('MISSING','กรุณาระบุเหตุผลอื่น ๆ');
      const id=nextSeqId_(M.withdrawals,'WithdrawID','WD',3); const by=actorOf(p);
      M.withdrawals.push({WithdrawID:id,StudentID:p.studentId,RequestedBy:by.id,RequesterRole:by.role||'Parent',Reason:p.reason,Detail:p.detail||'',EffectiveDate:p.effectiveDate||'',Status:'PENDING',ProcessedBy:'',ProcessedDate:'',CreatedDate:todayLocal()});
      logAct('requestWithdrawal',p.studentId,p.reason+(p.detail?' — '+p.detail:''),by);
      return {withdrawId:id,status:'PENDING'}; },
    // withdrawals list (Admin); pass {pending:true} for only-open requests
    listWithdrawals: p => M.withdrawals.filter(w=>!p||!p.pending||w.Status==='PENDING')
      .map(w=>{ const s=studentById(w.StudentID)||{}; return Object.assign({name:s.NameTH,nameEN:s.NameEN,class:s.Class},w); })
      .sort((a,b)=>(b.CreatedDate||'').localeCompare(a.CreatedDate||'')),
    // Admin removes a student from the system — direct, or by processing a pending request (pass withdrawId).
    // Records the reason (required) so the exit is auditable; student becomes WITHDRAWN (excluded from active lists).
    removeStudent: p => { const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน');
      if(!p.reason)fail('MISSING','กรุณาเลือกเหตุผลในการนำข้อมูลออก');
      if(p.reason==='other'&&!String(p.detail||'').trim())fail('MISSING','กรุณาระบุเหตุผลอื่น ๆ');
      const by=actorOf(p); s.Status='WITHDRAWN'; s.WithdrawReason=p.reason; s.WithdrawDetail=p.detail||''; s.WithdrawDate=todayLocal(); s.WithdrawBy=by.name||by.id;
      // close the originating request (or record this direct removal as a processed request)
      let w=p.withdrawId?M.withdrawals.find(x=>x.WithdrawID===p.withdrawId):M.withdrawals.find(x=>x.StudentID===p.studentId&&x.Status==='PENDING');
      if(w){ w.Status='DONE'; w.ProcessedBy=by.name||by.id; w.ProcessedDate=todayLocal(); }
      else { const id=nextSeqId_(M.withdrawals,'WithdrawID','WD',3); M.withdrawals.push({WithdrawID:id,StudentID:p.studentId,RequestedBy:by.id,RequesterRole:by.role||'Admin',Reason:p.reason,Detail:p.detail||'',EffectiveDate:todayLocal(),Status:'DONE',ProcessedBy:by.name||by.id,ProcessedDate:todayLocal(),CreatedDate:todayLocal()}); }
      logAct('removeStudent',p.studentId,(s.NameTH||p.studentId)+' — '+p.reason+(p.detail?' ('+p.detail+')':''),by);
      return {ok:true,status:'WITHDRAWN'}; },

    // export = return rows for the .xlsx + remove the student from active lists
    exportStudent: p => { const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน');
      const cols=Object.keys(s); const rows=[cols, cols.map(c=>{ const v=s[c]; return (v&&typeof v==='object')?JSON.stringify(v):(v==null?'':v); })];
      s.Status='EXPORTED'; s.ExportedDate=todayLocal();
      const fname=(s.NameTH||s.StudentID).trim().replace(/\s+/g,'-')+'.xlsx';
      return {filename:fname, rows, folder:'ข้อมูลนักเรียนที่ Export'}; },
    listExportedStudents: () => M.students.filter(s=>s.Status==='EXPORTED').map(s=>Object.assign({ageMonth:ageMonths(s.DOB)},s)),
    importStudent: p => { // p.rows = [headers, values] from a previously exported .xlsx
      if(p.studentId){ const s=studentById(p.studentId); if(s){ s.Status='ACTIVE'; delete s.ExportedDate; return s; } }
      const rows=p.rows||[]; if(rows.length<2)fail('BAD_FILE','ไฟล์ไม่ถูกต้อง'); const obj={}; rows[0].forEach((h,i)=>{ let v=rows[1][i];
        try{ if(typeof v==='string'&&/^[\[{]/.test(v))v=JSON.parse(v); }catch(e){}
        if(v==='true')v=true; else if(v==='false')v=false;   // restore booleans (NationalID etc stay strings)
        obj[h]=v; });
      obj.Status='ACTIVE'; const ex=studentById(obj.StudentID); if(ex){Object.assign(ex,obj);return ex;} M.students.push(obj); return obj; },

    // ========== staff auth + password (national ID login) ==========
    staffAuth: p => { const s=M.staff.find(x=>String(x.NationalID)===String(p.nationalId).trim()); if(!s)fail('NOT_FOUND','ไม่พบพนักงานจากเลขบัตรนี้');
      if(String(s.Password||'1234')!==String(p.password))fail('BAD_PW','รหัสผ่านไม่ถูกต้อง');
      return {staffId:s.StaffID, role:s.Role, name:s.NameTH, nameEN:s.NameEN, mustChange:!!s.MustChangePassword}; },
    changeStaffPassword: p => { const s=staffById(p.staffId); if(!s.StaffID)fail('NOT_FOUND','ไม่พบพนักงาน');
      const pw=String(p.newPassword||''); const okLen=pw.length>=8&&pw.length<=15, hasLo=/[a-z]/.test(pw), hasUp=/[A-Z]/.test(pw), hasNum=/[0-9]/.test(pw);
      if(!(okLen&&hasLo&&hasUp&&hasNum))fail('WEAK_PW','รหัสผ่านต้อง 8-15 ตัว มีพิมพ์เล็ก พิมพ์ใหญ่ และตัวเลข');
      s.Password=pw; s.MustChangePassword=false; return {ok:true}; },
    // slip-unlock check + admin view/reset + forgot-request (GAS routes override these; here = mock mode)
    checkStaffPassword: p => ({ ok: String(staffById(p.staffId).Password||'1234')===String(p.password||'') }),
    getStaffPassword: p => ({ password: String(staffById(p.staffId).Password||'1234') }),
    adminResetPassword: p => { const s=staffById(p.staffId); if(!s.StaffID)fail('NOT_FOUND','ไม่พบพนักงาน');
      const tmp=p.password?String(p.password):(String(s.NationalID||'').slice(-8)||'1234'); s.Password=tmp; s.MustChangePassword=true; return {ok:true, tempPassword:tmp}; },
    requestPasswordReset: p => { const s=staffById(p.staffId); if(!s.StaffID)fail('NOT_FOUND','ไม่พบพนักงาน');
      if(M.feed) M.feed.unshift({id:'PWR-'+s.StaffID+'-'+Date.now(),text:'🔑 ขอรีเซ็ตรหัสผ่าน: '+(s.NameTH||s.StaffID),textEN:'🔑 Password reset requested: '+(s.NameEN||s.StaffID),time:timeLocal(),roles:['Admin'],read:false});
      logAct('requestPasswordReset',s.StaffID,(s.NameTH||s.StaffID),actorOf(p)); return {ok:true}; },

    // ========== departments (Nursery) ==========
    listDepartments: () => (cfg.Departments||[]).slice(),
    addDepartment: p => { const n=(p.name||'').trim(); if(!n)fail('MISSING','ใส่ชื่อแผนก'); if(cfg.Departments.indexOf(n)>=0)fail('DUP','มีแผนกนี้แล้ว');
      cfg.Departments.push(n); if(!M.classes.find(c=>c.ClassName===n)) M.classes.push({ClassID:nextSeqId_(M.classes,'ClassID','CL',0,''),ClassName:n,TeacherID:'',AgeRange:'',Capacity:15}); return {ok:true}; },
    renameDepartment: p => { const i=cfg.Departments.indexOf(p.old); if(i<0)fail('NOT_FOUND','ไม่พบแผนก'); cfg.Departments[i]=p.new;
      M.classes.forEach(c=>{ if(c.ClassName===p.old)c.ClassName=p.new; }); M.students.forEach(s=>{ if(s.Class===p.old)s.Class=p.new; }); M.staff.forEach(s=>{ if(s.Department===p.old)s.Department=p.new; }); return {ok:true}; },
    removeDepartment: p => { const i=cfg.Departments.indexOf(p.name); if(i<0)fail('NOT_FOUND','ไม่พบแผนก');
      if(activeStudents().some(s=>s.Class===p.name))fail('HAS_STUDENTS','ยังมีนักเรียนในแผนกนี้ ย้ายออกก่อน');
      cfg.Departments.splice(i,1); const ci=M.classes.findIndex(c=>c.ClassName===p.name); if(ci>=0)M.classes.splice(ci,1); return {ok:true}; },

    // ========== generic config setter (diligence amounts, etc.) ==========
    getConfigVal: p => cfg[p.key],
    setConfigVal: p => { cfg[p.key]=p.value; return {key:p.key, value:cfg[p.key]}; },

    // ========== leave: quota, January reminder, OT verification ==========
    setLeaveQuota: p => { cfg.LeaveQuota=cfg.LeaveQuota||{}; cfg.LeaveQuota[p.type]=Number(p.days||0); return cfg.LeaveQuota; },
    getLeaveQuota: () => cfg.LeaveQuota,
    // admin edits whitelisted config (geofence etc.) — GAS route persists to SCHOOL_CONFIG; here = mock
    schoolConfig: () => ({ GPS_Lat:cfg.GPS_Lat, GPS_Lng:cfg.GPS_Lng, Radius:cfg.Radius, LateGraceMinutes:cfg.LateGraceMinutes, OTRatePerHour:cfg.OTRatePerHour, StaffOTHourlyRate:cfg.StaffOTHourlyRate, ContributionMatchRate:cfg.ContributionMatchRate }),
    setSchoolConfig: p => { const W={GPS_Lat:1,GPS_Lng:1,Radius:1,LateGraceMinutes:1,OTRatePerHour:1,OTGraceMinutes:1,StaffOTHourlyRate:1,OTRoundUpMinutes:1,DefaultCheckInTime:1,DefaultCheckOutTime:1,BigCleaningAmount:1,BigCleaningIn:1,BigCleaningOut:1,ContributionMatchRate:1}; const v=p.values||{};
      Object.keys(v).forEach(k=>{ if(W[k]) cfg[k]=isNaN(Number(v[k]))?v[k]:Number(v[k]); }); return {ok:true, wrote:v}; },
    leaveResetReminder: () => { const n=new Date(); return {due:n.getMonth()===0, month:n.getMonth()+1, year:n.getFullYear()}; }, // every January
    // verify the teacher OT computation across the attendance history (schedule out vs actual out)
    otVerification: p => { const rows=M.staffAttendanceHistory.filter(h=>!p.staffId||h.StaffID===p.staffId).filter(h=>h.Out);
      return rows.map(h=>{ const sch=M.workSchedule.find(w=>w.StaffID===h.StaffID)||{CheckOutTime:'17:00'};
        const min=Math.max(0,toMin(h.Out)-toMin(sch.CheckOutTime)); const rate=staffOtRate(staffById_(h.StaffID));
        const otH=Math.round(min/60*100)/100; return {date:h.Date,staffId:h.StaffID,out:h.Out,schedOut:sch.CheckOutTime,otMinutes:min,otHours:otHoursRule(min),otRate:rate,otPay:Math.round(otH*rate)}; }); },
    // sum a staff's APPROVED OT for a month (auto-pulled into payroll). Source of truth = OT_RECORDS.
    // The total is what payroll uses; hours/holiday are split out so the payroll screen can SAY what
    // the number is made of — holiday OT has no hours, so "5 ชม. × ฿100 = ฿2,300" would look wrong.
    staffMonthlyOT: p => { const recs=(M.otRecords||[]).filter(r=>r.StaffID===p.staffId && String(r.Status||'').toUpperCase()==='APPROVED' && (!p.month||ym(r.Month||r.Date)===p.month));
      const isHol=r=>String(r.Kind||'').toUpperCase()==='HOLIDAY';
      const hours=recs.reduce((a,r)=>a+(isHol(r)?0:(Number(r.Hours)||0)),0); const amount=recs.reduce((a,r)=>a+(Number(r.Amount)||0),0);
      const holRecs=recs.filter(isHol); const holiday=holRecs.reduce((a,r)=>a+(Number(r.Amount)||0),0);
      const rate=staffOtRate(staffById_(p.staffId));
      /* WHICH EVENINGS. Asked 2026-08-30: "เดือนนี้ OT วันไหนบ้าง". The payroll screen could say
       * "อัตโนมัติ 5 ชม. × ฿100" and no more, so an admin checking a teacher's OT against what she
       * remembered working had to open the sheet. `days` is the count (kept — callers use it);
       * `entries` is the list. Both ride in the request the screen already makes. */
      const entries=recs.map(r=>({date:String(r.Date||'').slice(0,10), hours:Number(r.Hours)||0,
        amount:Math.round(Number(r.Amount)||0), kind:isHol(r)?'HOLIDAY':'DAILY', note:String(r.Note||'')}))
        .sort((a,b)=>a.date<b.date?-1:(a.date>b.date?1:0));
      return {staffId:p.staffId,month:p.month,hours,rate,amount:Math.round(amount),days:recs.length,
        holiday:Math.round(holiday),holidayDays:holRecs.length,daily:Math.round(amount-holiday),entries}; },
    // OT approved AFTER an earlier month's payroll was already saved, and therefore never paid — e.g. a
    // 31/07 late check-out approved in August once July's salary had gone out. Each earlier month owes
    //   approved(m) − what that month's saved payslip paid − what later payslips already carried
    // so nothing is paid twice and nothing is dropped. A month with NO saved payslip is not carried:
    // its own payroll run pays it normally. Mirrors otCarryOver_ in src/Payroll.gs.
    otCarryOver: p => { const mm=ym(p.month); const approved={}, approvedHrs={}, approvedDays={};
      (M.otRecords||[]).forEach(r=>{ if(r.StaffID!==p.staffId)return;
        const st=String(r.Status||'').toUpperCase(); if(st&&st!=='APPROVED')return;
        // holiday OT is paid on its OWN payslip line, so it must not be counted here against what
        // OTEvening paid — every month would look short-paid and carry the same amount for ever
        if(isHolidayOT_(r))return;
        const m=ym(r.Month||r.Date); if(!m)return; approved[m]=(approved[m]||0)+(Number(r.Amount)||0);
        approvedHrs[m]=(approvedHrs[m]||0)+(Number(r.Hours)||0);
        // which evenings that month was made of — see otApprovedDaysByMonth_ in src/Payroll.gs for
        // why these are ALL the month's approved evenings and not "the unpaid ones"
        (approvedDays[m]=approvedDays[m]||[]).push({date:String(r.Date||'').slice(0,10),
          hours:Number(r.Hours)||0, amount:Math.round(Number(r.Amount)||0), note:String(r.Note||'')}); });
      Object.keys(approvedDays).forEach(m=>approvedDays[m].sort((a,b)=>a.date<b.date?-1:(a.date>b.date?1:0)));
      const paidFor={}, carriedFor={};
      (M.payroll||[]).forEach(r=>{ if(r.StaffID!==p.staffId)return; const m=ym(r.Month);
        if(!m||m>=mm)return;                       // this month's own row (and any later one) must not count
        paidFor[m]=(paidFor[m]||0)+(Number(r.OTEvening)||0);
        let d=r.OTCarryDetail; if(typeof d==='string'&&d){ try{d=JSON.parse(d);}catch(e){d=null;} }
        (Array.isArray(d)?d:[]).forEach(c=>{ const cm=ym(c&&c.month); if(cm) carriedFor[cm]=(carriedFor[cm]||0)+(Number(c&&c.amount)||0); }); });
      /* HOW MANY HOURS is the carry-over? The carry is an AMOUNT — that is how it is paid — and the
       * slip only ever said baht, so a teacher could not check it against the evenings they
       * remember working. The hours behind it are that amount's share of the month it came from. */
      const detail=[]; let total=0, hrs=0;
      Object.keys(paidFor).forEach(m=>{ const unpaid=Math.round(((approved[m]||0)-paidFor[m]-(carriedFor[m]||0))*100)/100;
        if(unpaid>0.5){ const share=(approved[m]>0)?(unpaid/approved[m]):0;
          const h=Math.round((approvedHrs[m]||0)*share*100)/100;
          detail.push({month:m,amount:unpaid,hours:h,approved:Math.round((approved[m]||0)*100)/100,paid:Math.round((paidFor[m]||0)*100)/100,days:approvedDays[m]||[]}); total+=unpaid; hrs+=h; } });
      detail.sort((a,b)=>a.month<b.month?-1:(a.month>b.month?1:0));
      return {staffId:p.staffId,month:p.month,total:Math.round(total*100)/100,
              hours:Math.round(hrs*100)/100,detail}; },

    // ===== staff OT approval workflow (teacher → Leader → Admin) — OT_RECORDS is the source of truth =====
    // full-hour amount helper (rounded), used everywhere an OT amount is (re)computed
    // reads:
    myOT: p => (M.otRecords||[]).filter(r=>r.StaffID===p.staffId && (!p.month||ym(r.Month||r.Date)===p.month)).sort((a,b)=>String(b.Date).localeCompare(String(a.Date))),
    // Leader/Admin: OT awaiting the first (Leader) approval
    teamPendingOT: p => { const me=staffById(p.staffId)||{}; if(me.PositionLevel!=='Leader'&&!adminLike_(me))return [];
      return (M.otRecords||[]).filter(r=>String(r.Status).toUpperCase()==='PENDING_LEADER').map(otView_); },
    // Admin: OT the Leader approved, awaiting Admin confirmation
    pendingAdminOT: () => (M.otRecords||[]).filter(r=>String(r.Status).toUpperCase()==='PENDING_ADMIN').map(otView_),
    // Admin: everything for a month (any status) — the manage screen
    adminOTList: p => (M.otRecords||[]).filter(r=>!p.month||ym(r.Month||r.Date)===p.month).sort((a,b)=>String(b.Date).localeCompare(String(a.Date))).map(otView_),
    // Leader step-1 decision
    approveOT: p => { const ap=staffById(p.staffId)||{}; const r=(M.otRecords||[]).find(x=>x.OTRecordID===p.otId); if(!r)fail('NOT_FOUND','ไม่พบรายการ OT');
      if(String(r.Status).toUpperCase()!=='PENDING_LEADER')fail('BAD_STATE','รายการนี้ไม่ได้รออนุมัติจากหัวหน้า');
      if(ap.PositionLevel!=='Leader'&&!adminLike_(ap))fail('NO_PERMISSION','เฉพาะหัวหน้าครู');
      const yes=p.decision==='approve'; r.Step1By=ap.NameTH; r.Step1Status=yes?'Approved':'Rejected'; r.Status=yes?'PENDING_ADMIN':'REJECTED';
      return {otId:r.OTRecordID,status:r.Status}; },
    // Admin step-2 confirm (optionally editing hours/amount), or reject
    confirmOT: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const r=(M.otRecords||[]).find(x=>x.OTRecordID===p.otId); if(!r)fail('NOT_FOUND','ไม่พบรายการ OT');
      const yes=p.decision!=='reject';
      if(yes){ if(p.hours!=null) r.Hours=Number(p.hours)||0;
        // re-price at approval time so a rate correction reaches everything not yet paid — but a
        // holiday OT is an agreed SUM with no hours behind it, and hours×rate would zero it
        if(!isHolidayOT_(r)){ r.Rate=staffOtRate(staffById_(r.StaffID)); r.Amount=Math.round((Number(r.Hours)||0)*r.Rate); }
        if(p.amount!=null&&p.amount!=='') r.Amount=Number(p.amount)||0;
        if(p.note!=null) r.Note=p.note; r.Step2By=ap.NameTH; r.Step2Status='Approved'; r.ApprovedBy=ap.NameTH; r.Status='APPROVED'; }
      else { r.Step2By=ap.NameTH; r.Step2Status='Rejected'; r.Status='REJECTED'; }
      return {otId:r.OTRecordID,status:r.Status,hours:r.Hours,amount:r.Amount}; },
    // Admin adds an OT directly (already approved). date + hours (+optional amount/note)
    adminAddOT: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const target=p.targetStaffId||p.forStaffId; const st=staffById_(target); if(!st.StaffID)fail('NOT_FOUND','ไม่พบพนักงาน');
      const hours=Number(p.hours)||0; if(hours<=0)fail('BAD_INPUT','ระบุจำนวนชั่วโมง');
      const amount=(p.amount!=null&&p.amount!=='')?Number(p.amount):Math.round(hours*staffOtRate(st));
      const id='OTR-'+String(Date.now()).slice(-6); const date=p.date||todayLocal();
      M.otRecords.push({OTRecordID:id,StaffID:target,Date:date,Hours:hours,Rate:staffOtRate(st),Amount:amount,ApprovedBy:ap.NameTH,Status:'APPROVED',Minutes:hours*60,PlanOut:'',ActualOut:'',Month:ym(date),Step1By:ap.NameTH,Step1Status:'Approved',Step2By:ap.NameTH,Step2Status:'Approved',Note:p.note||''});
      return {otId:id,status:'APPROVED'}; },
    // OT วันหยุด — Admin ticks several staff, picks the day, writes WHY, and sets one amount each.
    // No hours: a day off worked is agreed as a sum, not clocked. One row PER person so each payslip
    // and OT history carries its own line and one can be corrected without touching the others.
    // Approved on the spot — the Admin granting it IS the approval. Mirrors handleAdminAddHolidayOT
    // in src/OtStaff.gs, which is the route that actually runs on GAS.
    adminAddHolidayOT: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      let ids=p.staffIds||p.targetStaffIds||(p.targetStaffId?[p.targetStaffId]:[]); if(!Array.isArray(ids))ids=[ids];
      const targets=[]; ids.map(x=>String(x||'').trim()).filter(x=>x).forEach(id=>{ if(targets.indexOf(id)<0)targets.push(id); });
      if(!targets.length)fail('BAD_INPUT','เลือกพนักงานอย่างน้อย 1 คน');
      const amount=Number(p.amount)||0; if(amount<=0)fail('BAD_INPUT','ระบุจำนวนเงิน OT');
      const note=String(p.note==null?'':p.note).trim(); if(!note)fail('BAD_INPUT','ระบุรายละเอียดการทำงานวันหยุด');
      const date=p.date||todayLocal(); const added=[];
      targets.forEach((target,i)=>{ const st=staffById_(target); if(!st.StaffID)fail('NOT_FOUND','ไม่พบพนักงาน '+target);
        M.otRecords.push({OTRecordID:'OTR-'+String(Date.now()).slice(-6)+'-'+i,StaffID:target,Date:date,Hours:0,Rate:0,Amount:amount,
          ApprovedBy:ap.NameTH,Status:'APPROVED',Minutes:0,PlanOut:'',ActualOut:'',Month:ym(date),
          Step1By:ap.NameTH,Step1Status:'Approved',Step2By:ap.NameTH,Step2Status:'Approved',Note:note,Kind:'HOLIDAY'});
        added.push(target); });
      return {count:added.length,date,amount,staffIds:added,status:'APPROVED'}; },
    // Admin edits any OT (hours/amount/note). Recomputes amount from hours unless amount is given.
    adminEditOT: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const r=(M.otRecords||[]).find(x=>x.OTRecordID===p.otId); if(!r)fail('NOT_FOUND','ไม่พบรายการ OT');
      if(p.hours!=null){ r.Hours=Number(p.hours)||0; if(!isHolidayOT_(r)) r.Amount=Math.round(r.Hours*staffOtRate(staffById_(r.StaffID))); }
      if(p.amount!=null&&p.amount!=='') r.Amount=Number(p.amount)||0;
      if(p.note!=null) r.Note=p.note; if(p.date) { r.Date=p.date; r.Month=ym(p.date); }
      return {otId:r.OTRecordID,hours:r.Hours,amount:r.Amount}; },
    adminDeleteOT: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const i=(M.otRecords||[]).findIndex(x=>x.OTRecordID===p.otId); if(i<0)fail('NOT_FOUND','ไม่พบรายการ OT'); M.otRecords.splice(i,1); return {ok:true}; },

    // ===== class-management change requests (ย้ายครูประจำชั้น/แผนก): Leader submits → Admin approves (applies+logs) =====
    // NOTE: on GAS the mutations (submit/decide) are in-place ROUTES (ClassOrg.gs) that win over these
    // engine handlers — these serve MOCK mode. The READS (myClassChanges/pendingClassChanges) run here.
    submitClassChange: p => { const ap=staffById(p.staffId)||{}; const isAdmin=ap.PositionLevel==='Admin'||ap.Role==='Admin';
      if(!isAdmin&&ap.PositionLevel!=='Leader')fail('NO_PERMISSION','เฉพาะหัวหน้าครูหรือแอดมิน');
      const changes=(p.changes||[]).filter(c=>c&&c.staffId&&c.after!==c.before);
      if(!changes.length)fail('BAD_INPUT','ไม่มีการเปลี่ยนแปลง');
      const id='CCR-'+String(((M.classChangeReq||[]).length)+1).padStart(3,'0');
      (M.classChangeReq=M.classChangeReq||[]).push({ReqID:id,RequestBy:p.staffId,RequestByName:ap.NameTH||ap.Name||p.staffId,CreatedDate:todayLocal(),Status:isAdmin?'APPROVED':'PENDING_ADMIN',Changes:changes,Note:p.note||'',Step2By:isAdmin?(ap.NameTH||p.staffId):'',DecidedDate:isAdmin?todayLocal():''});
      if(isAdmin){ changes.forEach(c=>{ const s=staffById_(c.staffId)||{}; if(s.StaffID){ s.Department=c.after; s.Classes=c.after; } }); logAct('classChange',id,changes.map(c=>c.name+':'+c.before+'→'+c.after).join(', '),actorOf(p)); }
      return {reqId:id,status:isAdmin?'APPROVED':'PENDING_ADMIN'}; },
    myClassChanges: p => (M.classChangeReq||[]).filter(r=>r.RequestBy===p.staffId).sort((a,b)=>String(b.CreatedDate).localeCompare(String(a.CreatedDate))),
    /**
     * HOW MANY THINGS ARE WAITING FOR THE ADMIN, per tool on the ดำเนินการ screen.
     *
     * Asked for 2026-08-26: "หัวข้อหลักไม่มีสถานะบอกว่ามีคำร้องหรือรอการอนุมัติ". Every one of those
     * tools already knew its own count — but only once you had opened it, which is precisely the
     * wrong way round. Two time requests sat unanswered because nothing on the screen said they
     * were there.
     *
     * ONE handler and ONE round trip for all of them: six separate counts would be six queued
     * executions on the busiest admin screen (Apps Script runs one at a time per user).
     *
     * The rule for what counts: things waiting for THE ADMIN TO DECIDE. A student OT that is simply
     * unpaid is waiting for a PARENT, so it is not a badge — putting a permanent red number on a
     * screen is how people learn to stop seeing red numbers. A submitted slip IS the admin's move.
     */
    opsPending: p => { const ap=staffById(p&&p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const pend=s=>{ const u=String(s||'').toUpperCase(); return u==='PENDING'||u.indexOf('PENDING_')===0; };
      /* AN OT ROW IS NEVER JUST "PENDING".
       *
       * A late check-out creates it as PENDING_LEADER (or PENDING_ADMIN when the person IS the
       * leader — Checkin.gs), and the leader's approval moves it to PENDING_ADMIN. This line asked
       * for an exact 'PENDING', so both OT badges were permanently zero: a request arrived one
       * morning, sat in the queue all day, and the screen said nothing at all (reported 2026-08-27).
       *
       * The `pend` helper directly above already knew this and was used for the OTHER three counts.
       * Using it here too is the fix; the test that let this through had invented a status the
       * system does not produce, which is why it passed.
       */
      const ot=(M.otRecords||[]).filter(r=>pend(r.Status));
      const o={
        // a teacher's OT and a holiday OT are approved on two different screens, so they are two counts
        staffOT:      ot.filter(r=>!isHolidayOT_(r)).length,
        holidayOT:    ot.filter(r=>isHolidayOT_(r)).length,
        timeRequests: (M.attendanceReq||[]).filter(r=>pend(r.Status)).length,
        classChanges: (M.classChangeReq||[]).filter(r=>String(r.Status||'').toUpperCase()==='PENDING_ADMIN').length,
        studentOT:    (M.otDaily||[]).filter(r=>String(r.Status||'').toUpperCase()==='PENDING_VERIFY').length,
        leaves:       (M.leaves||[]).filter(l=>pend(l.Status)).length };
      o.total=Object.keys(o).reduce((a,k)=>a+o[k],0);
      return o; },
    pendingClassChanges: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      return (M.classChangeReq||[]).filter(r=>String(r.Status).toUpperCase()==='PENDING_ADMIN').sort((a,b)=>String(a.CreatedDate).localeCompare(String(b.CreatedDate))); },
    decideClassChange: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const r=(M.classChangeReq||[]).find(x=>x.ReqID===p.reqId); if(!r)fail('NOT_FOUND','ไม่พบคำขอ');
      if(String(r.Status).toUpperCase()!=='PENDING_ADMIN')fail('ALREADY_RESOLVED','คำขอนี้ดำเนินการแล้ว');
      const yes=p.decision==='approve';
      if(yes){ (r.Changes||[]).forEach(c=>{ const s=staffById_(c.staffId)||{}; if(s.StaffID){ s.Department=c.after; s.Classes=c.after; } }); logAct('classChange',r.ReqID,(r.Changes||[]).map(c=>c.name+':'+c.before+'→'+c.after).join(', '),actorOf(p)); }
      r.Status=yes?'APPROVED':'REJECTED'; r.Step2By=ap.NameTH||ap.Name||p.staffId; r.DecidedDate=todayLocal();
      return {reqId:r.ReqID,status:r.Status}; },

    // ===== manual attendance request (ขอลงเวลา): 2-step (leader→admin). Admin approval WRITES the real
    //       check-in/out into attendance and recomputes late/OT; the written time is flagged manual (blue). =====
    submitTimeRequest: p => { const st=staffById(p.staffId); const type=String(p.type||'').toUpperCase();
      if(type!=='IN'&&type!=='OUT')fail('BAD_TYPE','เลือกเข้างานหรือเลิกงาน');
      if(!p.date||!p.time)fail('BAD_INPUT','ระบุวันและเวลา');
      const lead=(st.PositionLevel==='Leader'||st.PositionLevel==='Admin'||st.Role==='Admin');
      const id='ATR-'+String(((M.attendanceReq||[]).length)+1).padStart(3,'0');
      (M.attendanceReq=M.attendanceReq||[]).push({ReqID:id,StaffID:p.staffId,Date:p.date,Type:type,RequestTime:p.time,Reason:p.reason||'',Status:lead?'PENDING_ADMIN':'PENDING_LEADER',Step1By:'',Step1Status:lead?'Skipped':'Pending',Step2By:'',Step2Status:'Pending',CreatedDate:todayLocal()});
      return {reqId:id,status:lead?'PENDING_ADMIN':'PENDING_LEADER'}; },
    myTimeRequests: p => (M.attendanceReq||[]).filter(r=>r.StaffID===p.staffId).sort((a,b)=>String(b.CreatedDate).localeCompare(String(a.CreatedDate))).map(atrView_),
    teamPendingTimeRequests: p => { const me=staffById(p.staffId)||{}; if(me.PositionLevel!=='Leader'&&!adminLike_(me))return [];
      return (M.attendanceReq||[]).filter(r=>String(r.Status).toUpperCase()==='PENDING_LEADER').map(atrView_); },
    /**
     * Everything still waiting, at EITHER step.
     *
     * This used to return only PENDING_ADMIN, so a request sitting with the head teacher was
     * invisible to the admin — while the admin had already been notified about it. They were told
     * about something they could not open, could not see, and could not unblock if the head teacher
     * was away. An admin is fully trusted everywhere else in this app; the queue is now shown whole,
     * labelled by which step it is on.
     */
    pendingAdminTimeRequests: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      return (M.attendanceReq||[])
        .filter(r=>{ const s=String(r.Status).toUpperCase(); return s==='PENDING_ADMIN'||s==='PENDING_LEADER'; })
        .sort((a,b)=>String(a.CreatedDate||'').localeCompare(String(b.CreatedDate||'')))
        .map(r=>Object.assign(atrView_(r), { stage: String(r.Status).toUpperCase()==='PENDING_LEADER'?'leader':'admin' })); },
    approveTimeRequest: p => { const ap=staffById(p.staffId)||{}; const r=(M.attendanceReq||[]).find(x=>x.ReqID===p.reqId); if(!r)fail('NOT_FOUND','ไม่พบคำขอ');
      if(String(r.Status).toUpperCase()!=='PENDING_LEADER')fail('BAD_STATE','ไม่ได้รออนุมัติจากหัวหน้า');
      if(ap.PositionLevel!=='Leader'&&!adminLike_(ap))fail('NO_PERMISSION','เฉพาะหัวหน้าครู');
      const yes=p.decision==='approve'; r.Step1By=ap.NameTH||ap.Name; r.Step1Status=yes?'Approved':'Rejected'; r.Status=yes?'PENDING_ADMIN':'REJECTED';
      return {reqId:r.ReqID,status:r.Status}; },
    confirmTimeRequest: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const r=(M.attendanceReq||[]).find(x=>x.ReqID===p.reqId); if(!r)fail('NOT_FOUND','ไม่พบคำขอ');
      const done=String(r.Status).toUpperCase();
      if(done==='APPROVED'||done==='REJECTED') fail('BAD_STATE','คำขอนี้ตัดสินไปแล้ว');
      const yes=p.decision==='approve';
      // An admin may settle a request still sitting with the head teacher — but the record must say
      // so, or the sheet would claim a step-1 approval that never happened.
      if(done==='PENDING_LEADER'){ r.Step1By=(ap.NameTH||ap.Name)+' (แอดมินอนุมัติแทน)'; r.Step1Status=yes?'Approved':'Rejected'; }
      r.Step2By=ap.NameTH||ap.Name; r.Step2Status=yes?'Approved':'Rejected'; r.Status=yes?'APPROVED':'REJECTED';
      if(yes) applyTimeRequest_(r);
      logAct('confirmTimeRequest',r.ReqID,r.Type+' '+r.Date+' '+r.RequestTime+(done==='PENDING_LEADER'?' (ข้ามขั้นหัวหน้า)':''),actorOf(p));
      return {reqId:r.ReqID,status:r.Status}; },

    // ========== prepayment (advance tuition with discount) ==========
    // Advance-tuition discount tiers (school policy): 2→5% · 3→10% · 6→15% · 12→20%.
    // amount = monthlyPlanPrice × months × (100 − discount)/100. e.g. plan 6,900/mo:
    //   2mo 5% = 13,110 (6,555/mo) · 3mo 10% = 18,630 (6,210/mo) · 6mo 15% = 35,190 (5,865/mo) · 12mo 20% = 66,240 (5,520/mo).
    // Advance-tuition tiers are the school's own pricing, so they live in SCHOOL_CONFIG (PrepayTiers)
    // and are edited from the Packages screen — they used to be hard-coded here, which meant a change
    // of policy needed a release. Defaults match the school's current sheet: 3→5% · 6→10% · 12→15%.
    prepayTiers: () => prepayTiers_(),
    savePrepayTiers: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const tiers=(Array.isArray(p.tiers)?p.tiers:[]).map(x=>({months:Number(x.months)||0,discount:Math.max(0,Math.min(100,Number(x.discount)||0))}))
        .filter(x=>x.months>0).sort((a,b)=>a.months-b.months);
      if(!tiers.length)fail('BAD_INPUT','ต้องมีอย่างน้อย 1 ระดับ');
      cfg.PrepayTiers=tiers; logAct('savePrepayTiers','',tiers.map(t=>t.months+'ด -'+t.discount+'%').join(' · '),actorOf(p));
      return {ok:true,tiers}; },
    prepayDiscount: m => { const t=prepayTiers_().find(x=>Number(x.months)===Number(m)); return t?Number(t.discount)||0:0; },
    // create a PENDING prepay charge (summarized on the payment screen) — paid via QR + slip like the monthly bill
    prepay: p => { const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน');
      const months=Number(p.months); const plan=studentPlan(s); const monthly=Number(plan.price||0);
      if(!(months>0)) fail('BAD_INPUT','ระบุจำนวนเดือนที่ชำระล่วงหน้า');
      // An Admin may price a one-off deal (e.g. 2 months at 10% this month only); a parent may only
      // pick a published tier. Whatever is agreed is FROZEN onto the record below, so changing the
      // tier table later never re-prices a payment that has already been quoted or made.
      // On GAS the session role is stamped onto the payload for everyone EXCEPT an Admin (who is
      // returned untouched), so an absent role plus a staffId that resolves to an Admin is the Admin
      // path. A parent always arrives with role='Parent', so they can never reach it.
      const admin = (function(){ const r=String(p.role||'');
        if(r==='Admin') return true;
        if(r) return false;                       // any other stamped role is explicitly not an Admin
        const ap=p.staffId?staffById(p.staffId):null;
        return !!(ap && (ap.PositionLevel==='Admin'||ap.Role==='Admin')); })();
      let disc;
      if(admin && p.discount!=null && p.discount!==''){ disc=Math.max(0, Math.min(100, Number(p.discount)||0)); }
      else { disc=H.prepayDiscount(months);
        if(!disc) fail('BAD_INPUT','เลือกจำนวนเดือนที่ชำระล่วงหน้า ('+prepayTiers_().map(t=>t.months).join(', ')+' เดือน)'); }
      // Advance payment is priced off the student's monthly plan price — it MUST be set, or the amount is meaningless.
      if(!(monthly>0)) fail('NO_PLAN_PRICE','นักเรียนคนนี้ยังไม่ได้ตั้งแผนการเรียน/ราคาต่อเดือน — กรุณาให้แอดมินตั้งค่าแผนก่อนชำระล่วงหน้า');
      const gross=monthly*months; const amount=Math.round(gross*(100-disc)/100);
      const start=p.startMonth||todayLocal().slice(0,7); const covered=[]; let [y,mo]=start.split('-').map(Number);
      for(let i=0;i<months;i++){ covered.push(y+'-'+String(mo).padStart(2,'0')); mo++; if(mo>12){mo=1;y++;} }
      const rec={PrepayID:nextSeqId_(M.prepayments,'PrepayID','PP',0),StudentID:p.studentId,Months:months,Discount:disc,Gross:gross,Amount:amount,Covered:covered,Status:'UNPAID',SlipUrl:'',SlipAmount:0,Date:todayLocal()};
      M.prepayments.push(rec); return rec; },
    // attach prepay slip → records a PAYMENT_SLIPS row, prepay → PENDING_VERIFY (Admin confirms per slip)
    payPrepay: p => recordSlip_('prepay', p.prepayId, p),
    /**
     * Admin corrects an advance payment.
     *  - NOT yet paid → everything: months, discount, and the month it starts from.
     *  - Already PAID → the START MONTH only. Which months a payment applies to is bookkeeping and
     *    does get entered wrong (a payment made on 31 July belongs to August, not July); re-pricing
     *    money that has already changed hands is not, and would turn a settled family into a debtor.
     */
    editPrepay: p => { const ap=staffById(p.staffId); if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const pp=(M.prepayments||[]).find(x=>x.PrepayID===p.prepayId); if(!pp)fail('NOT_FOUND','ไม่พบรายการชำระล่วงหน้า');
      const paid=String(pp.Status)==='PAID';
      if(paid && ((p.months!=null && Number(p.months)!==Number(pp.Months)) ||
                  (p.discount!=null && p.discount!=='' && Number(p.discount)!==Number(pp.Discount||0))))
        fail('ALREADY_PAID','รายการนี้ชำระแล้ว — แก้ได้เฉพาะเดือนที่มีผล ไม่สามารถแก้จำนวนเดือนหรือส่วนลด');
      const s=studentById(pp.StudentID)||{}; const monthly=Number(studentPlan(s).price||0);
      const months=(!paid && p.months!=null)?Math.max(1,Number(p.months)||0):Number(pp.Months);
      const disc=(!paid && p.discount!=null && p.discount!=='')?Math.max(0,Math.min(100,Number(p.discount)||0)):(Number(pp.Discount)||0);
      const start=ym(p.startMonth||(prepayCoveredMonths_(pp)[0])||todayLocal());
      if(!/^\d{4}-\d{2}$/.test(start))fail('BAD_INPUT','ระบุเดือนที่เริ่มมีผล');
      const covered=[]; let [y,mo]=start.split('-').map(Number);
      for(let i=0;i<months;i++){ covered.push(y+'-'+String(mo).padStart(2,'0')); mo++; if(mo>12){mo=1;y++;} }
      pp.Months=months; pp.Discount=disc; pp.Covered=covered;
      // the amount a PAID family actually transferred is never recalculated
      if(!paid){ if(!(monthly>0))fail('NO_PLAN_PRICE','นักเรียนคนนี้ยังไม่ได้ตั้งแพ็กเกจ/ราคาต่อเดือน');
        pp.Gross=monthly*months; pp.Amount=Math.round(pp.Gross*(100-disc)/100); }
      logAct('editPrepay',pp.PrepayID,(paid?'แก้เดือนที่มีผล ':'')+months+' เดือน -'+disc+'% = '+pp.Amount+' · '+covered[0]+' – '+covered[covered.length-1],actorOf(p));
      return pp; },
    cancelPrepay: p => { const i=M.prepayments.findIndex(x=>x.PrepayID===p.prepayId); if(i>=0&&M.prepayments[i].Status==='UNPAID')M.prepayments.splice(i,1); return {ok:true}; },
    prepayments: p => M.prepayments.filter(x=>x.StudentID===p.studentId),

    // ---- Admin payment verification (confirm slips) ----
    // Admin verify queue: one entry per bill/OT/prepay that has unverified slips OR is a cash notice.
    // Each entry carries its SUBMITTED slips (image + amount + SlipOK verified flag) + confirmed/outstanding.
    pendingPayments: () => { const nm=id=>{ const s=studentById(id)||{}; return {name:s.NameTH,nameEN:s.NameEN,nick:s.Nickname,nickEN:s.NicknameEN,class:s.Class}; };
      const out=[]; const add=(kind, rec, id, due, label)=>{
        const subs=paySlips_().filter(s=>s.RefKind===kind&&s.RefID===id&&s.Status==='SUBMITTED');
        const isCash = (rec.PaymentMethod==='cash') && (rec.Status==='PENDING_VERIFY');
        if(!subs.length && !isCash) return;
        const confirmed=sumSlips_(kind, id, ['CONFIRMED']);
        out.push(Object.assign({ kind, id, studentId:rec.StudentID, label, due, confirmedPaid:confirmed, outstanding:Math.max(0,due-confirmed),
          method:rec.PaymentMethod||'transfer', transactionDate:rec.TransactionDate||'', cash:isCash, slipAmount:subs.reduce((a,s)=>a+Number(s.Amount||0),0),
          slips: subs.map(s=>({ slipId:s.SlipID, amount:Number(s.Amount||0), url:s.Url, verified:s.Verified, receiver:s.Receiver, transRef:s.TransRef, transDate:s.TransDate||'', date:s.SubmittedDate })) }, nm(rec.StudentID))); };
      M.payments.filter(b=>b.Status==='PENDING_VERIFY'||b.Status==='PARTIAL').forEach(b=>add('bill', b, b.BillingID, billDue_(b), ym(b.Month)));
      M.otDaily.filter(o=>o.Status==='PENDING_VERIFY'||o.Status==='PARTIAL').forEach(o=>add('ot', o, o.OTID, Number(o.Amount||0), o.Date+' OT'));
      // extra charges are now their own payable → they must appear in the verify queue too
      M.studentCharges.forEach(c=>add('charge', c, c.ChargeID, Number(c.Amount||0), c.Label||'ค่าใช้จ่ายเพิ่มเติม'));
      M.prepayments.filter(pp=>pp.Status==='PENDING_VERIFY'||pp.Status==='PARTIAL').forEach(pp=>add('prepay', pp, pp.PrepayID, Number(pp.Amount||0), pp.Months+'mo ('+pp.Covered[0]+'→'+pp.Covered[pp.Covered.length-1]+')'));
      return out; },
    // Admin confirms a payment. paidDate = the actual payment date (defaults today); recorded for retro audit.
    confirmPayment: p => { const paid=p.paidDate||todayLocal(); const method=p.method||'';
      if(p.kind==='bill'){ const b=M.payments.find(x=>x.BillingID===p.id); if(!b)fail('NOT_FOUND','ไม่พบบิล'); b.Status='PAID'; b.PaidDate=paid; if(method)b.PaymentMethod=method; b.VerifiedStatus='CONFIRMED'; b.VerifiedBy=p.adminId||'admin';
        logAct('confirmPayment',b.BillingID,'ยืนยัน ('+(b.PaymentMethod||'transfer')+') '+b.SlipAmount+' จ่าย '+paid,actorOf(p)); return b; }  // bill = tuition only; no OT cascade
      if(p.kind==='ot'){ const o=M.otDaily.find(x=>x.OTID===p.id); if(!o)fail('NOT_FOUND','ไม่พบ OT'); o.Status='PAID'; o.PaidDate=paid; if(method)o.PaymentMethod=method; o.VerifiedStatus='CONFIRMED'; logAct('confirmPayment',o.OTID,'ยืนยัน ('+(o.PaymentMethod||'transfer')+') '+o.Amount+' จ่าย '+paid,actorOf(p)); return o; }
      if(p.kind==='charge'){ const c=M.studentCharges.find(x=>x.ChargeID===p.id); if(!c)fail('NOT_FOUND','ไม่พบรายการ'); c.Status='PAID'; c.PaidDate=paid; if(method)c.PaymentMethod=method; c.VerifiedStatus='CONFIRMED'; logAct('confirmPayment',c.ChargeID,'ยืนยัน ('+(c.PaymentMethod||'transfer')+') '+c.Amount+' จ่าย '+paid,actorOf(p)); return c; }
      if(p.kind==='prepay'){ const pp=M.prepayments.find(x=>x.PrepayID===p.id); if(!pp)fail('NOT_FOUND','ไม่พบรายการ'); pp.Status='PAID'; pp.PaidDate=paid; if(method)pp.PaymentMethod=method; pp.VerifiedBy=p.adminId||'admin';
        // tuition-only: don't flip the covered bills to PAID — the payments handler credits tuition per month.
        logAct('confirmPayment',pp.PrepayID,'ยืนยันชำระล่วงหน้า (ค่าเทอม) ('+(pp.PaymentMethod||'transfer')+') '+pp.Amount+' จ่าย '+paid,actorOf(p)); return pp; }
      fail('BAD_KIND','ไม่ทราบประเภท'); },
    rejectPayment: p => {
      if(p.kind==='bill'){ const b=M.payments.find(x=>x.BillingID===p.id); if(b){b.Status='UNPAID';b.VerifiedStatus='REJECTED';b.SlipAmount=0;} }
      if(p.kind==='ot'){ const o=M.otDaily.find(x=>x.OTID===p.id); if(o){o.Status='UNPAID';o.VerifiedStatus='REJECTED';o.SlipAmount=0;} }
      if(p.kind==='prepay'){ const pp=M.prepayments.find(x=>x.PrepayID===p.id); if(pp){pp.Status='UNPAID';pp.VerifiedStatus='REJECTED';pp.SlipAmount=0;} }
      return {ok:true}; },

    // ========== announcements (popup + date/time window) ==========
    activeAnnouncements: () => { const on=v=>v===true||String(v).toUpperCase()==='TRUE'||v==='1';
      return M.announcements.filter(a=>on(a.Popup) && annPhase_(a)==='live')
        // most important first (Priority desc), then newest (StartDate/Date desc)
        .sort((a,b)=>(Number(b.Priority||0)-Number(a.Priority||0)) || String(ymd(b.StartDate||b.Date)).localeCompare(String(ymd(a.StartDate||a.Date)))); },

    // ========== injury / accident report (teacher / leader) ==========
    // file an individual injury report; pushes an Admin+Leader notification + activity-log row.
    submitInjury: p => { const s=studentById(p.studentId)||{};
      if(!p.studentId)fail('MISSING','กรุณาเลือกเด็กที่บาดเจ็บ');
      if(!Array.isArray(p.injuryTypes)||!p.injuryTypes.length)fail('MISSING','กรุณาเลือกชนิดการบาดเจ็บอย่างน้อย 1 ข้อ');
      const id=nextSeqId_(M.injuryReports,'InjuryID','INJ-'+todayLocal().replace(/-/g,''),2);
      const rec={InjuryID:id,Date:p.date||todayLocal(),Time:p.time||timeLocal(),CenterName:p.centerName||cfg.SchoolName||'',
        AffiliationType:p.affiliationType||'',AffiliationOther:p.affiliationOther||'',District:p.district||'',
        RecorderName:p.recorderName||'',StudentID:p.studentId,ChildName:s.NameTH||p.childName||'',Sex:s.Gender||p.sex||'',
        AgeYears:p.ageYears!=null?p.ageYears:(s.DOB?Math.floor(ageMonths(s.DOB)/12):''),AgeMonths:p.ageMonths!=null?p.ageMonths:(s.DOB?ageMonths(s.DOB)%12:''),
        EduStatus:p.eduStatus||'',EduGrade:p.eduGrade||'',Narrative:p.narrative||'',CauseObject:p.causeObject||'',
        Witness:p.witness||'',Place:p.place||'',PlaceOther:p.placeOther||'',InjuryTypes:p.injuryTypes,TeacherID:p.staffId||'',NotifyParent:p.notifyParent?'YES':'',CreatedDate:todayLocal(),
        // filed, not finished: หัวหน้าครู reads it first, then แอดมิน (see approveInjury)
        Status:'PENDING_LEADER',LeaderBy:'',LeaderAt:'',AdminBy:'',AdminAt:'',RejectReason:''};
      // a NEW record carries every column, blank when unused — an absent key reads back as
      // undefined and the report screen cannot tell "not shared" from "column missing"
      Object.assign(rec, {ShareJournal:'',Photo1:'',Photo2:'',Photo3:'',Wounds:'',
        TreatmentType:'',TreatmentPlaces:'',TreatmentPlaceOther:'',TreatmentBy:''}, injExtras_(p));
      M.injuryReports.push(rec);
      const nm=s.NameTH||p.childName||p.studentId;
      M.feed.unshift({id:'INJ-N'+M.injuryReports.length,text:'⚠️ บันทึกอุบัติเหตุ: '+nm+' ('+rec.InjuryTypes.length+' รายการ)',
        textEN:'⚠️ Injury logged: '+(s.NameEN||nm)+' ('+rec.InjuryTypes.length+' item(s))',time:rec.Time,roles:['Admin','Leader'],read:false,studentId:p.studentId,
        category:'emergency',ref:'injury|'+id});   // ref = deep link so tapping opens THIS report
      logAct('submitInjury',p.studentId,nm+' — types '+rec.InjuryTypes.join(','),actorOf(p));
      return {injuryId:id, status:rec.Status}; },

    /* ---- injury: two-step approval, like a leave request ------------------------------------
     * teacher files → หัวหน้าครู approves → แอดมิน approves → the record is final.
     *
     * The APPROVAL IS PAPERWORK, NOT A GATE ON TELLING PEOPLE. The emergency notification to admins,
     * leaders and (if ticked) the parents still goes out the moment the teacher saves — waiting for
     * a signature before saying a child is hurt would be indefensible. What the chain adds is that
     * the document sent to the authority has been read and agreed by two people.
     *
     * The report stays EDITABLE until it is final: the person who filed it and any leader/admin may
     * correct it while it is still moving, and an admin may correct, unlock or delete it at any
     * time. Each change is logged, because this is the record of an accident to a child.
     */
    approveInjury: p => { const ap=staffById(p.staffId)||{};
      const r=(M.injuryReports||[]).find(x=>String(x.InjuryID)===String(p.injuryId));
      if(!r)fail('NOT_FOUND','ไม่พบรายงานอุบัติเหตุ');
      const yes=p.decision==='approve', st=String(r.Status||'PENDING_LEADER').toUpperCase();
      const isAdmin=adminLike_(ap), isLeader=ap.PositionLevel==='Leader'||isAdmin;
      const stamp=stampLocal();
      if(st==='PENDING_LEADER'){
        if(!isLeader)fail('NO_PERMISSION','เฉพาะหัวหน้าครูหรือแอดมิน');
        r.LeaderBy=ap.NameTH||ap.StaffID||''; r.LeaderAt=stamp;
        r.Status=yes?'PENDING_ADMIN':'REJECTED';
      } else if(st==='PENDING_ADMIN'){
        if(!isAdmin)fail('NO_PERMISSION','เฉพาะแอดมิน');
        r.AdminBy=ap.NameTH||ap.StaffID||''; r.AdminAt=stamp;
        r.Status=yes?'APPROVED':'REJECTED';
      } else fail('ALREADY_RESOLVED','รายงานนี้ดำเนินการเรียบร้อยแล้ว');
      if(!yes) r.RejectReason=String(p.reason||'');
      logAct('approveInjury',r.InjuryID,(yes?'อนุมัติ':'ตีกลับ')+' → '+r.Status,actorOf(p));
      return {injuryId:r.InjuryID, status:r.Status}; },

    /** Correct a report. Anyone involved while it is still moving; an admin whenever. */
    editInjury: p => { const ap=staffById(p.staffId)||{};
      const r=(M.injuryReports||[]).find(x=>String(x.InjuryID)===String(p.injuryId));
      if(!r)fail('NOT_FOUND','ไม่พบรายงานอุบัติเหตุ');
      const isAdmin=adminLike_(ap);
      const st=String(r.Status||'PENDING_LEADER').toUpperCase();
      if(!isAdmin){
        if(st==='APPROVED')fail('LOCKED','รายงานนี้อนุมัติครบแล้ว — ให้แอดมินปลดล็อกก่อนแก้ไข');
        const mine=String(r.TeacherID||'')===String(p.staffId);
        if(!mine && ap.PositionLevel!=='Leader')fail('NO_PERMISSION','แก้ไขได้เฉพาะผู้บันทึกหรือหัวหน้าครู');
      }
      const d=p.data||{};
      // whitelisted: the form's own fields. Status and the approval trail are NOT editable here.
      ['Date','Time','CenterName','AffiliationType','AffiliationOther','District','RecorderName',
       'ChildName','Sex','AgeYears','AgeMonths','EduStatus','EduGrade','Narrative','CauseObject',
       'Witness','Place','PlaceOther'].forEach(k=>{ if(d[k]!==undefined) r[k]=d[k]; });
      if(Array.isArray(d.InjuryTypes)&&d.InjuryTypes.length) r.InjuryTypes=d.InjuryTypes;
      if(d.NotifyParent!==undefined) r.NotifyParent=d.NotifyParent?'YES':'';
      // photos, the journal tick and page 2 — same normalisation as filing it (injExtras_).
      // These ride at the TOP level of the call (p.photos, p.wounds…), not inside p.data, so that
      // filing and editing send them in exactly the same shape.
      Object.assign(r, injExtras_(p));
      r.UpdatedBy=ap.NameTH||ap.StaffID||''; r.UpdatedAt=stampLocal();
      logAct('editInjury',r.InjuryID,'แก้ไขรายงาน',actorOf(p));
      return {injuryId:r.InjuryID, status:r.Status}; },

    /** Admin sends a finished report back for correction. */
    unlockInjury: p => { const ap=staffById(p.staffId)||{};
      if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const r=(M.injuryReports||[]).find(x=>String(x.InjuryID)===String(p.injuryId));
      if(!r)fail('NOT_FOUND','ไม่พบรายงานอุบัติเหตุ');
      r.Status='PENDING_LEADER'; r.LeaderBy=''; r.LeaderAt=''; r.AdminBy=''; r.AdminAt=''; r.RejectReason='';
      r.UpdatedBy=ap.NameTH||ap.StaffID||''; r.UpdatedAt=stampLocal();
      logAct('unlockInjury',r.InjuryID,'ปลดล็อกให้แก้ไข',actorOf(p));
      return {injuryId:r.InjuryID, status:r.Status}; },

    deleteInjury: p => { const ap=staffById(p.staffId)||{};
      if(!adminLike_(ap))fail('NO_PERMISSION','เฉพาะแอดมิน');
      const i=(M.injuryReports||[]).findIndex(x=>String(x.InjuryID)===String(p.injuryId));
      if(i<0)fail('NOT_FOUND','ไม่พบรายงานอุบัติเหตุ');
      const r=M.injuryReports[i]; M.injuryReports.splice(i,1);
      logAct('deleteInjury',r.InjuryID,(r.ChildName||'')+' '+ymd(r.Date),actorOf(p));
      return {ok:true, injuryId:p.injuryId}; },

    /** Reports waiting for THIS person to act — the leader's queue, then the admin's. */
    pendingInjuries: p => { const ap=staffById(p&&p.staffId)||{};
      const isAdmin=adminLike_(ap), isLeader=ap.PositionLevel==='Leader'||isAdmin;
      if(!isLeader) return [];
      const want = isAdmin ? ['PENDING_LEADER','PENDING_ADMIN'] : ['PENDING_LEADER'];
      return (M.injuryReports||[])
        .filter(r=>want.indexOf(String(r.Status||'PENDING_LEADER').toUpperCase())>=0)
        .map(r=>{ const s=studentById(r.StudentID)||{};
          return Object.assign({nameEN:s.NameEN,nick:s.Nickname,className:s.Class},r); })
        .sort((a,b)=>(String(b.Date)+b.Time).localeCompare(String(a.Date)+a.Time)); },
    /**
     * The injury reports attached to one child's สมุดรายวัน for one day — the parent's view.
     *
     * ONLY the ones the teacher ticked to share. A report kept in the system is for the school and
     * the authority; putting it in front of the family anyway would break the promise the tick makes.
     * Approval is deliberately NOT required: the tick means "tell the parents", and a family waiting
     * on two signatures to hear their child was hurt is exactly what we refuse to build.
     * Narrative, photos and the day are shared; the official-form scaffolding is not.
     */
    journalInjuries: p => (M.injuryReports||[])
      .filter(r=>String(r.StudentID)===String(p.studentId) && ymd(r.Date)===ymd(p.date||todayLocal())
                 && String(r.ShareJournal||'').toUpperCase()==='YES')
      .map(r=>({injuryId:r.InjuryID, date:ymd(r.Date), time:r.Time||'', narrative:r.Narrative||'',
                types:r.InjuryTypes, place:r.Place||'', placeOther:r.PlaceOther||'',
                photos:[r.Photo1,r.Photo2,r.Photo3].filter(Boolean),
                treatmentType:r.TreatmentType||'', treatmentBy:r.TreatmentBy||''}))
      .sort((a,b)=>String(a.time).localeCompare(String(b.time))),
    // injury reports (Admin/teacher). Optional date OR month filter; newest first.
    injuryReports: p => M.injuryReports
      .filter(r=>!p||((!p.date||ymd(r.Date)===ymd(p.date)) && (!p.month||ym(r.Date)===ym(p.month))))
      .map(r=>{ const s=studentById(r.StudentID)||{}; return Object.assign({nameEN:s.NameEN,nick:s.Nickname,className:s.Class},r); })
      .sort((a,b)=>(String(b.Date)+b.Time).localeCompare(String(a.Date)+a.Time)),
    // one report, for the deep link from an emergency notification
    injuryReport: p => { const r=(M.injuryReports||[]).find(x=>String(x.InjuryID)===String(p.injuryId));
      if(!r)fail('NOT_FOUND','ไม่พบรายงานอุบัติเหตุ');
      const s=studentById(r.StudentID)||{}; const t=(M.staff||[]).find(x=>x.StaffID===r.TeacherID)||{};
      return Object.assign({nameEN:s.NameEN,nick:s.Nickname,className:s.Class,
        teacherName:t.NameTH||t.Name||'',teacherNick:t.Nickname||''},r); },
    /**
     * Monthly injury summary: how many, and broken down by injury type and by class, so the school
     * can see whether one classroom or one kind of accident keeps recurring. Types are stored as the
     * numeric codes of the official แบบบันทึกการบาดเจ็บ form; the labels live in the client.
     */
    injurySummary: p => { const month=ym(p&&p.month||todayLocal());
      const rows=(M.injuryReports||[]).filter(r=>ym(r.Date)===month);
      const byType={}, byClass={}, byDay={};
      rows.forEach(r=>{ const s=studentById(r.StudentID)||{};
        let types=r.InjuryTypes; if(typeof types==='string'){ try{types=JSON.parse(types);}catch(e){ types=String(types).split(/[,\s]+/).filter(Boolean); } }
        (Array.isArray(types)?types:[]).forEach(n=>{ byType[n]=(byType[n]||0)+1; });
        const cl=s.Class||r.EduGrade||'—'; byClass[cl]=(byClass[cl]||0)+1;
        const d=ymd(r.Date); byDay[d]=(byDay[d]||0)+1; });
      const asList=o=>Object.keys(o).map(k=>({key:k,count:o[k]})).sort((a,b)=>b.count-a.count||String(a.key).localeCompare(String(b.key)));
      return {month, total:rows.length, students:Object.keys(rows.reduce((a,r)=>(a[r.StudentID]=1,a),{})).length,
        byType:asList(byType), byClass:asList(byClass), byDay:asList(byDay),
        reports:rows.map(r=>{ const s=studentById(r.StudentID)||{};
          return {injuryId:r.InjuryID,date:ymd(r.Date),time:r.Time,studentId:r.StudentID,
            name:s.NameTH||r.ChildName||'',nick:s.Nickname||'',className:s.Class||'',
            types:r.InjuryTypes,narrative:r.Narrative||''}; })
          .sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time))}; },

    // ========== PCHI insurance member form ==========
    // Banks always come from the embedded reference list (cfg is SEED-only in gas mode), so the
    // dropdown is identical in mock and on GAS.
    insuranceOptions: () => Object.assign({}, cfg.Insurance||{}, {Banks: INSURANCE_BANKS}),
    // status for a student: has the insurance form been filled? (one record per student / NationalID)
    insuranceStatus: p => { const s=studentById(p.studentId)||{};
      const rec=M.insurancePCHI.find(x=>x.StudentID===p.studentId || (s.NationalID&&String(x.NationalID)===String(s.NationalID)))||null;
      return {studentId:p.studentId, filled:!!rec, record:rec,
        student:{name:s.NameTH,nameEN:s.NameEN,nationalId:s.NationalID,gender:s.Gender,dob:s.DOB}}; },
    // Parent submits the insurance form and may CORRECT it at any time afterwards (2026-08-29) — the
    // facts change, and a mistyped claim account number used to be permanent. แผนประกัน and
    // วันมีผลบังคับ stay the school's: they are stripped from a parent's patch, never from an admin's.
    // Insurance data is written ONLY here (INSURANCE_PCHI sheet).
    submitInsurance: p => { const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน');
      const existing=M.insurancePCHI.find(x=>x.StudentID===p.studentId || (s.NationalID&&String(x.NationalID)===String(s.NationalID)));
      const by=actorOf(p); const d=Object.assign({}, p.data||{});
      if(existing && !p.adminEdit){ delete d.Plan; delete d.EffectiveDate; }
      const base={ StudentID:p.studentId, InsuredName:d.InsuredName||s.NameEN||s.NameTH, InsuredLastName:d.InsuredLastName||'',
        Gender:d.Gender|| (s.Gender==='M'?'Male':s.Gender==='F'?'Female':''), NationalID:d.NationalID||s.NationalID, DOB:d.DOB||s.DOB,
        MemberStatus:d.MemberStatus||'Child', CompanyName:cfg.InsuranceCompanyName||(cfg.Insurance&&cfg.Insurance.CompanyName)||'', PolicyNo:cfg.InsurancePolicyNo||'' };
      if(existing){ Object.assign(existing, d, base, {UpdatedBy:by.name||by.id, UpdatedDate:todayLocal()});
        if(!p.adminEdit) M.feed.unshift({id:'INS-U'+M.insurancePCHI.length,text:'🛡️ ผู้ปกครองแก้ไขข้อมูลประกัน: '+(s.NameTH||p.studentId),textEN:'🛡️ Insurance form edited: '+(s.NameEN||p.studentId),time:timeLocal(),roles:['Admin'],read:false,studentId:p.studentId});
        logAct('updateInsurance',p.studentId,(s.NameTH||p.studentId),by); return {ok:true, updated:true, record:existing}; }
      const rec=Object.assign({InsuranceID:nextSeqId_(M.insurancePCHI,'InsuranceID','INS',3)}, d, base,
        {FilledBy:by.name||by.id, FilledByRole:by.role||'Parent', FilledDate:todayLocal()});
      M.insurancePCHI.push(rec);
      M.feed.unshift({id:'INS-N'+M.insurancePCHI.length,text:'🛡️ ผู้ปกครองกรอกข้อมูลประกัน: '+(s.NameTH||p.studentId),textEN:'🛡️ Insurance form filled: '+(s.NameEN||p.studentId),time:timeLocal(),roles:['Admin'],read:false,studentId:p.studentId});
      logAct('submitInsurance',p.studentId,(s.NameTH||p.studentId),by);
      return {ok:true, updated:false, record:rec}; },
    // Admin: every active student with insurance filled/not-filled + the record
    insuranceList: () => activeStudents().map(s=>{ const rec=M.insurancePCHI.find(x=>x.StudentID===s.StudentID)||null;
      return {studentId:s.StudentID, name:s.NameTH, nameEN:s.NameEN, nationalId:s.NationalID, class:s.Class, filled:!!rec, record:rec}; }),
    // Admin edit/override (bypasses the once-only rule)
    saveInsuranceAdmin: p => H.submitInsurance(Object.assign({adminEdit:true}, p)),

    // ========== SlipOK slip verification (GAS deploy) ==========
    // In 'gas' mode this routes to the backend which POSTs the slip to SlipOK_Url with SlipOK_ApiKey and returns the
    // verified amount/ref. In mock mode it's unavailable → UI falls back to the in-browser BarcodeDetector reader.
    verifySlip: p => ({ ok:false, available:false, provider:'SlipOK', note:'SlipOK runs at GAS deploy; using local QR reader in mock mode' }),

    // ========== admin daily report ==========
    dailyReport: () => { const d=H.dashboard(); const abs2=H.absenceReport({minDays:2}); const abs5=H.absenceReport({minDays:5});
      // carry the nickname through — the daily report shows staff by nickname like everywhere else
      const lateStaff=d.staff.filter(s=>s.late>0).map(s=>({name:s.name,nameEN:s.nameEN,nick:s.nick,nickEN:s.nickEN,late:s.late}));
      const totals=d.classes.reduce((a,c)=>({in:a.in+c.in,out:a.out+c.out,leave:a.leave+c.leave,absent:a.absent+c.absent,total:a.total+c.total}),{in:0,out:0,leave:0,absent:0,total:0});
      const injuries=H.injuryReports({date:todayLocal()}); // today's injuries → shown + flagged in the report
      return {date:todayLocal(), classes:d.classes, totals, lateStaff, absent2:abs2, absent5:abs5, injuries}; },
  };

  return { H: H, ageMonths: ageMonths };
}

// Make available to GAS global scope (no-op in the browser where it's already global via <script>).
if (typeof module !== 'undefined' && module.exports) module.exports = { createAtomAPI };
