/* engine.js — SHARED API logic (browser + Google Apps Script). ONE source of truth for all handlers.
 * createAtomAPI(M, GROWTH_STD) -> { H, ageMonths }.  M = data object (mock arrays in the browser;
 * hydrated-from-Sheets on GAS). Handlers in H read/mutate M.* and return plain data — no DOM/window.
 * Browser loads this via <script>; GAS uses the generated copy src/Engine.gs (run tools/build_engine.js).
 */
function createAtomAPI(M, GROWTH_STD) {
  const cfg = M.config;
  const p2 = n => String(n).padStart(2,'0');
  const todayLocal = () => { const d=new Date(); return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate()); };
  const timeLocal = () => { const d=new Date(); return p2(d.getHours())+':'+p2(d.getMinutes()); };
  const stampLocal = () => todayLocal()+' '+timeLocal();
  const fail = (code,msg)=>{ const e=new Error(msg); e.code=code; throw e; };
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
  function ageMonths(dob){ const d=new Date(dob),n=new Date(); let m=(n.getFullYear()-d.getFullYear())*12+(n.getMonth()-d.getMonth()); if(n.getDate()<d.getDate())m--; return Math.max(0,m); }
  function geo(lat,lng){ const dist=haversine(cfg.GPS_Lat,cfg.GPS_Lng,lat,lng); if(dist>cfg.Radius) fail('OUT_OF_RANGE',`อยู่นอกรัศมีโรงเรียน (${dist} ม. เกิน ${cfg.Radius} ม.)`); return dist; }
  // distance without enforcing the fence — used for parent CHECK-IN (allowed from anywhere; check-out still fenced)
  function geoSafe(lat,lng){ return haversine(cfg.GPS_Lat,cfg.GPS_Lng,lat,lng); }
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
  // Big Cleaning Day: a monthly mandatory workday the admin sets. Counts as work but has NO fixed
  // check-in/out time (no lateness), and attendance credits a diligence bonus (เบี้ยขยัน).
  function bigCleaningList_(){ const v=cfg.BigCleaningDays; return (Array.isArray(v)?v:String(v||'').split(',')).map(x=>String(x).trim()).filter(Boolean); }
  const isBigCleaning_ = date => bigCleaningList_().indexOf(String(date))>=0;
  // enrich an OT record with the staff's names + that day's check-in / check-out (so the approver can see
  // when they arrived vs when they left — the leave time is what drove the OT).
  function otView_(r){ const s=staffById_(r.StaffID); let ci='', co='';
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
  function mealSlotsFor_(className) {
    const c = String(className || '');
    // keys match the journal's own field names, so no mapping layer can drift out of step
    const all = [
      { key: 'Breakfast', th: 'อาหารเช้า', en: 'Breakfast' },
      { key: 'Lunch', th: 'อาหารกลางวัน', en: 'Lunch' },
      { key: 'Dinner', th: 'อาหารเย็น', en: 'Dinner' },
      { key: 'Snack', th: 'อาหารว่าง', en: 'Snack' }
    ];
    // "Nursery 1" and the baby class eat dinner here; 2 / 3 / Premium go home before it.
    const staysForDinner = /(^|\s)(1|baby|เบบี้)(\s|$)/i.test(c) || /nursery\s*1\b/i.test(c);
    return staysForDinner ? all : all.filter(s => s.key !== 'Dinner');
  }

  // ---- survey row -> the shape every screen reads (Options is stored as JSON in one cell) ----
  function surveyView_(s){ let opts=[]; try{ opts=JSON.parse(s.Options||'[]')||[]; }catch(e){ opts=[]; }
    return { surveyId:s.SurveyID, title:s.Title||'', description:s.Description||'', type:s.Type||'rating',
      options:opts, scope:s.Scope||'all', target:s.Target||'', startDate:ymd(s.StartDate||''),
      endDate:ymd(s.EndDate||''), status:s.Status||'OPEN', anonymous:String(s.Anonymous||'')==='YES',
      createdAt:s.CreatedAt||'' }; }
  // Re-settle an OT row against its slips after its AMOUNT changed. Only when it actually has slips:
  // recomputeTarget_'s "nothing submitted" branch stamps VerifiedStatus='REJECTED', which would be a
  // lie on a row nobody has ever paid towards. Returns the new status if it moved, else null.
  function otResettle_(o){ if(!o) return null;
    try{ if(sumSlips_('ot',o.OTID,['SUBMITTED','CONFIRMED'])<=0) return null;
      const before=String(o.Status||''); recomputeTarget_('ot',o.OTID);
      const after=String(o.Status||''); return after===before?null:after; }catch(e){ return null; } }
  function leaveView_(l){ const s=staffById_(l.StaffID); return Object.assign({}, l,
    {name:s.NameTH,nameEN:s.NameEN,nick:s.Nickname,nickEN:s.NicknameEN,
     days:Number(l.Days)||0, halfDay:halfDay_(l.HalfDay)}); }
  // enrich a manual-attendance request with the requester's names
  function atrView_(r){ const s=staffById_(r.StaffID); return Object.assign({}, r,
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
  function coveredClasses_(staff){ staff=staff||{}; const all=allClassObjs_();
    const lvl=String(staff.PositionLevel||''), role=String(staff.Role||'');
    // Admin/Leader (or Classes/Department = '*') → ALL classes students are in
    const dept=String(staff.Department||''), list=String(staff.Classes||'').split(',').map(x=>x.trim()).filter(Boolean);
    if(lvl==='Admin'||lvl==='Leader'||role==='Admin'||list.indexOf('*')>=0||dept==='*') return all.slice();
    const names={};
    all.forEach(c=>{ if(c.TeacherID===staff.StaffID) names[c.ClassName]=1; });
    list.forEach(n=>names[n]=1);
    // Department may be a comma list of the department(s) this staff is responsible for
    dept.split(',').map(x=>x.trim()).filter(Boolean).forEach(n=>names[n]=1);
    const cls=all.filter(c=>names[c.ClassName]);
    return cls.length?cls:[all.find(c=>c.TeacherID===staff.StaffID)||all[0]].filter(Boolean); }
  // May this staff drag/move teachers & students between classes (the admin organize tool)? Admin/Leader
  // always; a plain teacher only when the admin flags CanClassOrg on their record.
  function canOrganize_(staff){ if(!staff||!staff.StaffID) return false;
    const lvl=String(staff.PositionLevel||''), role=String(staff.Role||'');
    if(lvl==='Admin'||lvl==='Leader'||role==='Admin') return true;
    const v=staff.CanClassOrg; return v===true||v==='YES'||v===1||String(v).toUpperCase()==='TRUE'; }
  // OT for a pickup time (HH:MM) vs the student's plan end + grace; 100/started hour
  // OT that is PAID or CANCELLED is settled — it must never roll into a bill or count as outstanding.
  const OT_CLOSED = { PAID:1, CANCELLED:1 };
  const otOpenRec = o => !OT_CLOSED[o.Status];
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
  function studentPaused_(s, onDate){ if(!s || String(s.Status)!==PAUSED_STATUS) return false;
    const d=ymd(onDate||todayLocal()), from=ymd(s.PauseFrom||''), to=ymd(s.PauseTo||'');
    if(from && d<from) return false;
    if(to && d>to) return false;                 // the return date has passed → back on the roster
    return true; }
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
  const activeStudents = () => M.students.filter(s=>!INACTIVE[s.Status] && !studentPaused_(s));

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
    paySlips_().push({ SlipID:'SL-'+Date.now()+'-'+Math.floor(Math.random()*10000), RefKind:kind, RefID:refId, StudentID:tgt.studentId,
      Amount:amt, Url:p.slipData||p.slipName||'', FileId:'', Verified:'', TransRef:'', Receiver:'', SubmittedDate:stampLocal(), Status:'SUBMITTED', SlipGroup:p.slipGroup||'' });
    const submitted=sumSlips_(kind, refId, ['SUBMITTED','CONFIRMED']); const confirmed=sumSlips_(kind, refId, ['CONFIRMED']);
    tgt.obj.Status='PENDING_VERIFY'; tgt.obj.SlipUrl=p.slipData||p.slipName||''; tgt.obj.SlipAmount=submitted; tgt.obj.PaymentMethod='transfer'; tgt.obj.SubmittedDate=todayLocal();
    logAct('uploadSlip',refId,'โอน '+amt,actorOf(p));
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
  function summarize(sid){ const s=studentById(sid); const latest=latestByItem(sid);
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
    if(p.staffId){ const s=staffById(p.staffId); return {role:s.Role||'Staff',id:p.staffId,name:s.NameTH||p.staffId}; }
    if(p.adminId){ const s=staffById(p.adminId); return {role:'Admin',id:p.adminId,name:s.NameTH||p.adminId}; }
    if(p.parentId||p.uid){ const pa=M.parents.find(x=>x.ParentID===p.parentId)||{}; return {role:'Parent',id:p.parentId||p.uid,name:pa.NameTH||p.parentId||'ผู้ปกครอง'}; }
    return {role:'',id:'',name:''}; }

  const H = {
    getConfig: () => cfg,
    // full activity log, newest first (Admin)
    activityLog: p => M.activityLog.slice().sort((a,b)=>b.Timestamp.localeCompare(a.Timestamp)).slice(0,(p&&p.limit)||200),

    // ---------- Parent ----------
    parentChildren: p => visibleStudents(p).map(s=>Object.assign({ageMonth:ageMonths(s.DOB)},s)),
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
    parentCheckin: p => { const d=(String(p.type||'IN').toUpperCase()==='OUT')?geo(p.lat,p.lng):geoSafe(p.lat,p.lng); const t=timeLocal();
      // de-dup a rapid repeat (same student+type today within CheckinDedupMinutes) → keep only the latest time
      const win=Number(cfg.CheckinDedupMinutes||10); const nowMin=toMin(t);
      const recent=(M.checkinStudent||[]).find(r=>r.StudentID===p.studentId&&String(r.Type).toUpperCase()===String(p.type).toUpperCase()&&ymd(r.Date)===todayLocal()&&Math.abs(nowMin-toMin(r.Time))<=win);
      if(recent){ recent.Time=t; const ex0=M.studentAttendanceToday.find(x=>x.StudentID===p.studentId); if(ex0)ex0.Time=t; return {studentId:p.studentId,type:p.type,time:t,distance:d,duplicate:true}; }
      M.checkinStudent.push({Date:todayLocal(),Time:t,StudentID:p.studentId,ParentID:p.parentId,Type:p.type,Status:'OK'});
      const ex=M.studentAttendanceToday.find(x=>x.StudentID===p.studentId); if(ex){ex.Status=p.type;ex.Time=t;} else M.studentAttendanceToday.push({StudentID:p.studentId,Status:p.type,Time:t});
      let h=M.studentCheckins.find(c=>c.StudentID===p.studentId&&c.Date===todayLocal()); if(!h){h={Date:todayLocal(),StudentID:p.studentId,InTime:'',OutTime:''};M.studentCheckins.push(h);} if(p.type==='IN')h.InTime=t; else h.OutTime=t;
      let ot=null;
      if(p.type==='OUT'){ const st=studentById(p.studentId); const o=otFor(st,t);
        if(o.amount>0){ const id='OT-'+todayLocal().replace(/-/g,'')+'-'+p.studentId;
          let rec=M.otDaily.find(x=>x.OTID===id);
          if(!rec){ rec={OTID:id,Date:todayLocal(),StudentID:p.studentId,PickupTime:t,PlanEnd:o.planEnd,LateMinutes:o.late,Hours:o.hours,Amount:o.amount,Status:'UNPAID',SlipRef:'',SlipAmount:0}; M.otDaily.push(rec); }
          else { rec.PickupTime=t; rec.LateMinutes=o.late; rec.Hours=o.hours; rec.Amount=o.amount; }
          ot={otId:id,lateMinutes:o.late,hours:o.hours,amount:o.amount,planEnd:o.planEnd}; }
      }
      return {type:p.type,time:t,distance:d,ot}; },

    // Teacher/Leader checks a student in/out on behalf of a pickup person who isn't a registered
    // parent. A Remark (who dropped off / picked up) is MANDATORY. No geofence (staff are at school).
    staffStudentCheckin: p => { const remark=String(p.remark||'').trim();
      if(!remark) fail('REMARK_REQUIRED','ต้องระบุหมายเหตุ (ใครมารับ-ส่ง) ก่อนบันทึก');
      const st=studentById(p.studentId); if(!st) fail('NOT_FOUND','ไม่พบนักเรียน');
      const type=String(p.type||'').toUpperCase(); if(type!=='IN'&&type!=='OUT') fail('BAD_INPUT','ระบุ IN หรือ OUT');
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
      let ot=null;
      if(type==='OUT'){ const o=otFor(st,t);
        if(o.amount>0){ const id='OT-'+todayLocal().replace(/-/g,'')+'-'+st.StudentID;
          let rec=M.otDaily.find(x=>x.OTID===id);
          if(!rec){ rec={OTID:id,Date:todayLocal(),StudentID:st.StudentID,PickupTime:t,PlanEnd:o.planEnd,LateMinutes:o.late,Hours:o.hours,Amount:o.amount,Status:'UNPAID',SlipRef:'',SlipAmount:0}; M.otDaily.push(rec); }
          else { rec.PickupTime=t; rec.LateMinutes=o.late; rec.Hours=o.hours; rec.Amount=o.amount; }
          ot={otId:id,lateMinutes:o.late,hours:o.hours,amount:o.amount,planEnd:o.planEnd}; } }
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
        const all=String(me.Department||'')==='*';
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
      // OT follows the pick-up time: cleared → the charge goes with it; changed → recompute
      const otId='OT-'+date.replace(/-/g,'')+'-'+st.StudentID;
      const oi=M.otDaily.findIndex(x=>x.OTID===otId);
      let ot=null;
      if(outT!==null){
        if(!outT){ if(oi>=0 && String(M.otDaily[oi].Status||'')!=='PAID') M.otDaily.splice(oi,1); }
        else { const o=otFor(st,outT);
          // correcting the pick-up time recomputes the CHARGE, but must keep any discount granted
          if(o.amount>0){ if(oi>=0){ const r=M.otDaily[oi]; const d=otDiscOf_(r,o.amount);
              r.PickupTime=outT; r.PlanEnd=o.planEnd; r.LateMinutes=o.late; r.Hours=o.hours;
              r.FullAmount=o.amount; r.Discount=d; r.Amount=Math.max(0,o.amount-d); }
            else M.otDaily.push({OTID:otId,Date:date,StudentID:st.StudentID,PickupTime:outT,PlanEnd:o.planEnd,LateMinutes:o.late,Hours:o.hours,FullAmount:o.amount,Discount:0,Amount:o.amount,Status:'UNPAID',SlipRef:'',SlipAmount:0});
            ot={otId,amount:o.amount,lateMinutes:o.late}; }
          else if(oi>=0 && String(M.otDaily[oi].Status||'')!=='PAID') M.otDaily.splice(oi,1); }
      }
      logAct('editStudentAttendance',st.StudentID,date+' เข้า '+(h.InTime||'-')+' ออก '+(h.OutTime||'-')+' — '+remark,actorOf(p));
      return {studentId:st.StudentID,date,checkIn:h.InTime||'',checkOut:h.OutTime||'',ot}; },
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
    // Teacher files a leave for a student (notifies the linked parents). Shows in that student's parent calendar only.
    teacherStudentLeave: p => { const dup=(M.studentLeaves||[]).find(l=>l.StudentID===p.studentId&&ymd(l.Date)===ymd(p.date)); if(dup) return {leaveId:dup.LeaveID,parentNotified:false,duplicate:true};
      const id=nextSeqId_(M.studentLeaves,'LeaveID','LVS',4);
      M.studentLeaves.push({LeaveID:id,StudentID:p.studentId,Date:p.date,Reason:p.reason||'',Type:p.type||'',Status:'Notified',FiledBy:p.staffId}); return {leaveId:id,parentNotified:true}; },
    // ---- Admin: manage student leaves (list all / edit / delete). On GAS the mutations are in-place ROUTES. ----
    allStudentLeaves: p => (M.studentLeaves||[]).slice().sort((a,b)=>String(b.Date).localeCompare(String(a.Date))).map(l=>{ const s=studentById(l.StudentID)||{};
      return Object.assign({},l,{name:s.NameTH||s.Name,nameEN:s.NameEN,nick:s.Nickname,class:s.Class}); }),
    editStudentLeave: p => { const ap=staffById(p.staffId); if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะแอดมิน');
      const l=(M.studentLeaves||[]).find(x=>x.LeaveID===p.leaveId); if(!l)fail('NOT_FOUND','ไม่พบการลา');
      if(p.date!=null)l.Date=p.date; if(p.reason!=null)l.Reason=p.reason; if(p.type!=null)l.Type=p.type; return {ok:true,leaveId:l.LeaveID}; },
    deleteStudentLeave: p => { const ap=staffById(p.staffId); if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะแอดมิน');
      const i=(M.studentLeaves||[]).findIndex(x=>x.LeaveID===p.leaveId); if(i<0)fail('NOT_FOUND','ไม่พบการลา'); M.studentLeaves.splice(i,1); return {ok:true}; },
    // batch delete (admin ticks several leaves → one call)
    deleteStudentLeaves: p => { const ap=staffById(p.staffId); if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะแอดมิน');
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
      else { b=Object.assign({BillingID:'BL-'+month+'-'+p.studentId,StudentID:p.studentId,Month:month,OTRollover:0,DueDate:month+'-05',SlipUrl:'',TransactionDate:paid?stampLocal():''},fields); M.payments.push(b); }
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
        catch(e){ skipped.push({studentId:sid,nick:s.Nickname,name:s.NameTH,reason:(e&&e.message)||String(e)}); } });
      logAct('issueBillsFor','', out.length+' คน เดือน '+month+(skipped.length?' (ข้าม '+skipped.length+')':''), actorOf(p));
      return {ok:true, month, created:out.length, students:out, skipped}; },
    // Admin deletes a bill (ยอดเรียกเก็บ). Removes the BILLING row; leaves any slip history in PAYMENT_SLIPS.
    deleteBill: p => { const i=M.payments.findIndex(x=>x.BillingID===p.billingId); if(i<0)fail('NOT_FOUND','ไม่พบบิล'); const b=M.payments[i]; M.payments.splice(i,1); logAct('deleteBill',p.billingId,'ลบบิล '+ym(b&&b.Month),actorOf(p)); return {ok:true}; },
    // auto-generate the month's bill for all active students from Plan price (skip if already billed)
    generateMonthlyBills: p => { const month=p.month||todayLocal().slice(0,7); let created=0; const noPlan=[], notYet=[], prorated=[], paused=[];
      // enrolledStudents, not activeStudents: a child paused only PART of this month is still billed,
      // and the paused-all-month check below is what actually excludes them (with a reason).
      enrolledStudents().forEach(s=>{ if(M.payments.find(x=>x.StudentID===s.StudentID&&ym(x.Month)===month))return;
        if(pausedWholeMonth_(s, month)){ paused.push({studentId:s.StudentID, name:s.NameTH||s.Name||'', nick:s.Nickname||'', from:ymd(s.PauseFrom||''), to:ymd(s.PauseTo||'')}); return; }
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
        M.payments.push({BillingID:'BL-'+month+'-'+s.StudentID,StudentID:s.StudentID,Month:month,Items:[['ค่าเทอม '+((plan&&plan.labelTH)||'')+note,pr.amount]],Amount:pr.amount,OTRollover:0,DueDate:month+'-05',PaidDate:'',Status:'UNPAID',SlipUrl:'',SlipAmount:0,VerifiedStatus:'',Auto:true}); created++; });
      return {month,created,noPlan,notYet,prorated,paused}; },
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
      items.forEach(x=>{ recordSlip_(x.kind, x.id, {slipAmount:x.out, slipData:p.slipData, slipName:p.slipName, slipGroup:groupId, uid:p.uid, parentId:p.parentId, role:p.role}); });
      logAct('payCombined', groupId, items.length+' รายการ รวม ฿'+total, actorOf(p));
      return {ok:true, groupId, total, count:items.length}; },
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
    recordCashPayment: p => { const ap=staffById(p.staffId); if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะแอดมิน');
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
      .map(s=>({ SlipID:s.SlipID, RefKind:s.RefKind, RefID:s.RefID, Amount:Number(s.Amount||0), Url:s.Url, Verified:s.Verified, TransRef:s.TransRef, Receiver:s.Receiver, SubmittedDate:s.SubmittedDate, Status:s.Status, SlipGroup:s.SlipGroup||'', Method:s.Method||'', TransDate:s.TransDate||'', TransTime:s.TransTime||'', Sender:s.Sender||'' })),
    /**
     * Is slip verification actually working, and what has it been saying? A 'NO:<code>' is SlipOK's
     * VERDICT, not a broken connection — it read the slip and then objected. Mirrors handleSlipDiag.
     */
    slipDiag: p => { const ap=staffById(p&&p.staffId); if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะแอดมิน');
      const rows=paySlips_(); const counts={total:rows.length,verified:0,rejected:0,unchecked:0,manual:0}; const byCode={};
      rows.forEach(s=>{ const v=String(s.Verified||'');
        if(v.slice(0,3)==='YES')counts.verified++;
        else if(v==='MANUAL')counts.manual++;
        else if(v.slice(0,2)==='NO'){ counts.rejected++; const c=v.slice(3)||'?'; byCode[c]=(byCode[c]||0)+1; }
        else counts.unchecked++; });
      return { configured:!!(cfg.SlipOK_Url&&cfg.SlipOK_ApiKey), url:'', counts,
        byCode:Object.keys(byCode).map(c=>({code:c,count:byCode[c]})).sort((a,b)=>b.count-a.count) }; },
    // Admin: delete a payment record. Only ever a row with NO slip image — a double-tap that left an
    // empty entry, or a cash receipt entered by mistake. A real slip is evidence and stays; reject it
    // instead. Recomputes what is owed afterwards, so the balance is right either way.
    deleteSlip: p => { const ap=staffById(p.staffId); if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะแอดมิน');
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
        bigCleaningList_().map(d=>({date:d,title:'Big Cleaning Day 🧹',titleEN:'Big Cleaning Day 🧹',type:'bigclean'})))
      .slice().sort((a,b)=>a.date.localeCompare(b.date)),
    // admin-managed Big Cleaning Days (read + add/remove) — stored in SCHOOL_CONFIG on GAS
    bigCleaningDays: () => ({ days: bigCleaningList_(), amount: Number(cfg.BigCleaningAmount||0) }),
    addBigCleaning: p => { const l=bigCleaningList_(); if(p.date && l.indexOf(p.date)<0) l.push(p.date); cfg.BigCleaningDays=l.slice().sort(); return {ok:true,days:cfg.BigCleaningDays}; },
    removeBigCleaning: p => { cfg.BigCleaningDays=bigCleaningList_().filter(d=>d!==p.date); return {ok:true,days:cfg.BigCleaningDays}; },
    announcements: () => M.announcements,

    // DSPM status for a student's current band (all items + status)
    dspmStatus: p => { const s=studentById(p.studentId); const age=p.ageMonth??ageMonths(s.DOB);
      const band=M.dspmCriteria.filter(c=>c.AgeFrom<=age&&age<=c.AgeTo).sort((a,b)=>a.ItemNo-b.ItemNo);
      if(!band.length) fail('NO_CRITERIA',`ยังไม่มีเกณฑ์สำหรับอายุ ${age} เดือน`);
      const latest=latestByItem(p.studentId);
      return {studentId:p.studentId,ageMonth:age,ageLabel:band[0].AgeLabelTH,manualUrl:cfg.DspmManualUrl,
        items:band.map(c=>({itemNo:c.ItemNo,skill:c.Skill,description:c.Description,descriptionEN:(M.dspmEN&&M.dspmEN[c.ItemNo])||'',result:latest[c.ItemNo]?latest[c.ItemNo].Result:'ยังไม่ได้รับการทดสอบ',date:latest[c.ItemNo]?latest[c.ItemNo].Date:''}))}; },

    // ---------- Teacher / staff ----------
    // classes a staff member is responsible for: Admin/Leader (or Classes='*') → all; else homeroom
    // (CLASSES.TeacherID) ∪ the explicit Classes list ∪ the class matching their Department.
    classList: p => { const s=staffById(p.staffId); const covered=coveredClasses_(s);
      let cls = p.className ? covered.find(c=>c.ClassName===p.className) : null;
      if(!cls) cls = covered[0] || M.classes[0];
      // today's attendance per student — the journal can only be filled once a child is checked IN,
      // and the on-behalf check-in button fades once IN/OUT is already recorded for the day.
      const today=todayLocal();
      const attOf=sid=>{ const a=M.studentAttendanceToday.find(x=>x.StudentID===sid);
        const h=M.studentCheckins.find(c=>c.StudentID===sid&&ymd(c.Date)===today)||{};
        return {status:a?a.Status:'NONE', inTime:h.InTime||(a&&a.Status==='IN'?a.Time:'')||'', outTime:h.OutTime||(a&&a.Status==='OUT'?a.Time:'')||''}; };
      return {class:cls, classes:covered.map(c=>({className:c.ClassName,classNameEN:c.ClassNameEN||c.ClassName})),
        students:activeStudents().filter(s2=>s2.Class===cls.ClassName).map(s2=>{ const at=attOf(s2.StudentID);
          return Object.assign({ageMonth:ageMonths(s2.DOB), attStatus:at.status, inToday:!!at.inTime, outToday:!!at.outTime, inTime:at.inTime, outTime:at.outTime}, s2); })}; },
    // the class names this staff can pick between (used to show/hide a class switcher)
    myClasses: p => { const s=staffById(p.staffId); const covered=coveredClasses_(s);
      return {classes:covered.map(c=>({className:c.ClassName,classNameEN:c.ClassNameEN||c.ClassName})), all:covered.length===M.classes.length}; },
    myAttendanceToday: p => { const r=M.staffAttendanceToday.find(x=>x.StaffID===p.staffId);
      const sch=M.workSchedule.find(w=>w.StaffID===p.staffId)||{CheckInTime:cfg.DefaultCheckInTime,CheckOutTime:'17:00'};
      return {date:todayLocal(), schedule:sch, checkIn:r?r.CheckIn:'', checkOut:r?r.CheckOut:'', late:r?r.Late||0:0, status:r?r.Status:'NONE',
        manualIn:!!(r&&r.InManual&&String(r.InManual).toUpperCase()==='YES'), manualOut:!!(r&&r.OutManual&&String(r.OutManual).toUpperCase()==='YES')}; },
    // today + previous working days (with late status) for the teacher work-time card
    recentAttendance: p => { const sch=M.workSchedule.find(w=>w.StaffID===p.staffId)||{CheckInTime:'08:00'};
      const lateOf=hhmm=>{ if(!hhmm)return 0; const raw=Math.max(0,toMin(hhmm)-toMin(sch.CheckInTime)); return raw<=Number(cfg.LateGraceMinutes||0)?0:raw; };
      const yes=v=>!!(v&&String(v).toUpperCase()==='YES');
      const today=M.staffAttendanceToday.find(x=>x.StaffID===p.staffId);
      const out=[{date:todayLocal(), checkIn:today?today.CheckIn:'', checkOut:today?today.CheckOut:'', late:today?today.Late||0:0, status:today?today.Status:'NONE', manualIn:yes(today&&today.InManual), manualOut:yes(today&&today.OutManual)}];
      M.staffAttendanceHistory.filter(h=>h.StaffID===p.staffId).sort((a,b)=>b.Date.localeCompare(a.Date)).slice(0,3)
        .forEach(h=>out.push({date:h.Date, checkIn:h.In||'', checkOut:h.Out||'', late:lateOf(h.In), status:h.In?'IN':'ABSENT', manualIn:yes(h.InManual), manualOut:yes(h.OutManual)}));
      return out; },
    staffCheckin: p => { const d=geo(p.lat,p.lng); const t=new Date(); const sch=M.workSchedule.find(w=>w.StaffID===p.staffId)||{CheckInTime:'08:00'};
      // A Big Cleaning Day is a special workday with fixed hours 08:30–17:00 (config BigCleaningIn) — late is
      // measured against 08:30 that day, not the staff's group time.
      const bc=isBigCleaning_(todayLocal()); const inT=bc?(cfg.BigCleaningIn||'08:30'):sch.CheckInTime;
      const raw=lateVs(inT,t); const late=raw<=Number(cfg.LateGraceMinutes||0)?0:raw;
      let r=M.staffAttendanceToday.find(x=>x.StaffID===p.staffId);
      if(!r){r={StaffID:p.staffId,CheckIn:'',CheckOut:'',Status:'NONE',Late:0};M.staffAttendanceToday.push(r);} r.CheckIn=timeLocal();r.Late=late;r.Status='IN';
      return {time:r.CheckIn,lateMinutes:late,rawLate:raw,distance:d}; },
    staffCheckout: p => { const d=geo(p.lat,p.lng); const t=new Date(); const sch=M.workSchedule.find(w=>w.StaffID===p.staffId)||{CheckOutTime:'17:00'};
      const outT=isBigCleaning_(todayLocal())?(cfg.BigCleaningOut||'17:00'):sch.CheckOutTime;
      const ot=Math.max(0,(t.getHours()*60+t.getMinutes())-toMin(outT));
      // OT rule: ≥OTRoundUpMinutes (50) within an hour rounds up to a full hour
      let r=M.staffAttendanceToday.find(x=>x.StaffID===p.staffId); if(!r)fail('NOT_CHECKED_IN','ยังไม่ได้ลงเวลาเข้างาน'); r.CheckOut=timeLocal();r.Status='OUT';r.OTHours=otHoursRule(ot);
      return {time:r.CheckOut,otHours:r.OTHours,otMinutes:ot,distance:d}; },
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
    saveDspmCriteria: p => { const ap=staffById(p.staffId); if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะแอดมิน');
      const d=p.data||{}; const track=d.Track||p.track||'Teacher'; const key=(p.itemNo!=null)?p.itemNo:d.ItemNo;
      let r=(key!=null)?(M.dspmCriteria||[]).find(x=>Number(x.ItemNo)===Number(key)&&String(x.Track||'Teacher')===String(track)):null;
      if(r){ ['AgeFrom','AgeTo','AgeLabelTH','Skill','Description','DescriptionEN','Method','PassCriteria'].forEach(k=>{ if(d[k]!==undefined)r[k]=(k==='AgeFrom'||k==='AgeTo')?(Number(d[k])||0):d[k]; }); r.Track=track; return {ok:true,itemNo:Number(r.ItemNo),updated:true}; }
      let mx=0; (M.dspmCriteria||[]).forEach(x=>{const n=Number(x.ItemNo)||0; if(n>mx)mx=n;});
      const rec=Object.assign({ItemNo:mx+1,Track:track},d); rec.AgeFrom=Number(rec.AgeFrom)||0; rec.AgeTo=Number(rec.AgeTo)||0;
      (M.dspmCriteria=M.dspmCriteria||[]).push(rec); return {ok:true,itemNo:rec.ItemNo,updated:false}; },
    deleteDspmCriteria: p => { const ap=staffById(p.staffId); if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะแอดมิน');
      const track=p.track||'Teacher'; const i=(M.dspmCriteria||[]).findIndex(x=>Number(x.ItemNo)===Number(p.itemNo)&&String(x.Track||'Teacher')===String(track));
      if(i<0)fail('NOT_FOUND','ไม่พบเกณฑ์'); M.dspmCriteria.splice(i,1); return {ok:true}; },
    submitAssessment: p => { const s=studentById(p.studentId); const age=ageMonths(s.DOB); const id='DA-'+String(Date.now()).slice(-4); let n=0;
      p.results.forEach(r=>{ if(r.result==='nottested'){ // remove any existing latest for this item (mark not tested)
          M.assessments=M.assessments.filter(a=>!(a.StudentID===p.studentId&&a.ItemNo===r.itemNo)); return; }
        const norm=(r.result==='pass'||r.result==='ผ่าน')?'ผ่าน':(r.result==='fail'||r.result==='ไม่ผ่าน')?'ไม่ผ่าน':(r.result==='notenrolled'||r.result==='ยังไม่เข้าโรงเรียน')?'ยังไม่เข้าโรงเรียน':null; if(!norm)return;
        const sk=(M.dspmCriteria.find(c=>c.ItemNo===r.itemNo)||{}).Skill||'';
        M.assessments.push({AssessmentID:id,StudentID:p.studentId,AgeMonth:age,ItemNo:r.itemNo,Skill:sk,Result:norm,Date:todayLocal(),TeacherID:p.staffId}); n++; });
      return {assessmentId:id,saved:n}; },
    studentAssessment: p => { const sum=summarize(p.studentId); sum.items=Object.values(latestByItem(p.studentId)).map(r=>({itemNo:r.ItemNo,skill:r.Skill,result:r.Result,date:r.Date})).sort((a,b)=>a.itemNo-b.itemNo); return sum; },
    // all bands the child has reached (enroll age -> now), each band with items + status
    studentAllBands: p => { const s=studentById(p.studentId); const age=ageMonths(s.DOB); const latest=latestByItem(p.studentId);
      const bands={}; M.dspmCriteria.filter(c=>c.AgeFrom<=age).forEach(c=>{ (bands[c.AgeLabelTH]=bands[c.AgeLabelTH]||{label:c.AgeLabelTH,from:c.AgeFrom,items:[]}).items.push({itemNo:c.ItemNo,skill:c.Skill,description:c.Description,descriptionEN:(M.dspmEN&&M.dspmEN[c.ItemNo])||'',result:latest[c.ItemNo]?latest[c.ItemNo].Result:'ยังไม่ได้รับการทดสอบ'}); });
      return {studentId:p.studentId,name:s.NameTH,nameEN:s.NameEN,nick:s.Nickname,nickEN:s.NicknameEN,ageMonth:age,enrollDate:s.EnrollDate,
        bands:Object.values(bands).sort((a,b)=>a.from-b.from)}; },

    myLeaves: p => M.leaves.filter(l=>l.StaffID===p.staffId).map(leaveView_),
    // Admin: every leave request (for the list split into pending vs resolved) + the calendar
    allLeaves: p => (M.leaves||[]).slice().sort((a,b)=>String(b.CreatedDate||b.StartDate).localeCompare(String(a.CreatedDate||a.StartDate))).map(leaveView_),
    // Admin edits a leave in place (dates/type/reason); recomputes Days
    editLeave: p => { const ap=staffById(p.staffId); if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะแอดมิน');
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
    cancelLeave: p => { const ap=staffById(p.staffId); if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะแอดมิน');
      const i=M.leaves.findIndex(x=>x.LeaveID===p.leaveId); if(i<0)fail('NOT_FOUND','ไม่พบคำขอ'); M.leaves.splice(i,1); return {ok:true}; },
    teamPendingLeaves: p => { const me=staffById(p.staffId); if(me.PositionLevel!=='Leader'&&me.PositionLevel!=='Admin')return [];
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
    approveLeave: p => { const ap=staffById(p.staffId); const l=M.leaves.find(x=>x.LeaveID===p.leaveId); if(!l)fail('NOT_FOUND','ไม่พบคำขอ'); const yes=p.decision==='approve';
      if(l.Status==='PENDING_LEADER'){ if(ap.PositionLevel!=='Leader'&&ap.PositionLevel!=='Admin')fail('NO_PERMISSION','เฉพาะหัวหน้างาน'); l.Step1ApproverName=ap.NameTH;l.Step1Status=yes?'Approved':'Rejected';l.Step1CrossDept=(ap.Department!==l.Department)?'YES':'NO';l.Status=yes?'PENDING_ADMIN':'REJECTED'; return {status:l.Status,crossDept:l.Step1CrossDept==='YES'}; }
      if(l.Status==='PENDING_ADMIN'){ if(ap.PositionLevel!=='Admin')fail('NO_PERMISSION','เฉพาะผู้บังคับบัญชา'); l.Step2ApproverName=ap.NameTH;l.Step2Status=yes?'Approved':'Rejected';l.Status=yes?'APPROVED':'REJECTED'; return {status:l.Status}; }
      fail('ALREADY_RESOLVED','คำขอนี้ดำเนินการแล้ว'); },
    // `staff` is a sanitized directory of ALL staff (name/nickname) so screens never need client MOCK.staff.
    // `holidays` lets the schedule calendar mark school closures.
    schedule: () => ({
      staff: M.staff.map(s=>({StaffID:s.StaffID, NameTH:s.NameTH, NameEN:s.NameEN, Nickname:s.Nickname, NicknameEN:s.NicknameEN,
        Role:s.Role, Department:s.Department, RequireCheckin:s.RequireCheckin!==false})),
      schedule:M.workSchedule,
      leavesToday: M.leaves.filter(l=>l.Status==='APPROVED'), attendance:M.staffAttendanceToday,
      history:M.staffAttendanceHistory, staffing:H.staffingByNursery(),
      holidays: (M.holidays||[]).map(h=>({Date:h.Date, NameTH:h.NameTH, NameEN:h.NameEN})), bigCleaning: bigCleaningList_() }),
    // present-staff / total-staff per Nursery for the daily summary (e.g. "Nursery 1 2/2")
    // a staff's Department may be a comma list of the department(s) they cover (or '*' = all) → count in each
    staffingByNursery: () => { const deps=(Array.isArray(cfg.Departments)?cfg.Departments:String(cfg.Departments||'').split(',')).map(d=>String(d).trim()).filter(Boolean);
      const covers=(s,dep)=>{ const d=String(s.Department||''); return d==='*'||d.split(',').map(x=>x.trim()).indexOf(dep)>=0; };
      return deps.map(dep=>{
        const team=M.staff.filter(s=>covers(s,dep)&&s.Role==='Teacher'&&s.RequireCheckin!==false);
        const present=team.filter(s=>{ const a=M.staffAttendanceToday.find(x=>x.StaffID===s.StaffID); return a&&(a.Status==='IN'||a.Status==='OUT'); }).length;
        return {dept:dep, present, total:team.length}; }).filter(x=>x.total>0); },

    payrollConfig: p => Object.assign({SocialSecurityDeduct:true,ChildThreshold:cfg.ExtraChildThreshold||31,ChildMultiplier:cfg.ExtraChildRate,TaxDeduct:false}, M.payrollConfig[p.staffId]||{}),
    setPayrollConfig: p => { M.payrollConfig[p.staffId]=Object.assign(M.payrollConfig[p.staffId]||{},p.config||{}); return M.payrollConfig[p.staffId]; },
    computePayroll: p => { const st=staffById(p.staffId); const pc=Object.assign({PayType:'monthly',DailyRate:0,SocialSecurityDeduct:true,ChildMultiplier:cfg.ExtraChildRate,TaxDeduct:false}, M.payrollConfig[p.staffId]||{});
      // base = monthly salary, OR daily-rate × days worked (new/special teachers)
      const payType=p.payType||pc.PayType||'monthly'; const dailyRate=p.dailyRate!=null?Number(p.dailyRate):pc.DailyRate; const daysWorked=Number(p.daysWorked||0);
      const base= payType==='daily' ? dailyRate*daysWorked : (p.baseSalary!=null?Number(p.baseSalary):(st.BaseSalary||0));
      // diligence amounts: per-staff override (payrollConfig) → else global config
      const attendAmt=p.diligenceAttend!=null?Number(p.diligenceAttend):(pc.DiligenceAttendanceAmount!=null?pc.DiligenceAttendanceAmount:cfg.DiligenceAttendanceAmount);
      const fbAmt=p.diligenceFb!=null?Number(p.diligenceFb):(pc.DiligenceFacebookAmount!=null?pc.DiligenceFacebookAmount:cfg.DiligenceFacebookAmount);
      // any-type leave over the monthly limit (default 3) forfeits the CHILD-RATE income (เรทจำนวนเด็ก),
      // applied to autoChild below. เบี้ยขยัน is untouched here (its own "ไม่ลา" rule already covers leave).
      const ls=H.staffLeaveSummary({staffId:p.staffId,month:p.month}); const leaveExceeds=ls.exceeds;
      const dA=p.attendanceEligible!==false?attendAmt:0; const dF=p.facebookPosted?fbAmt:0; const dT=dA+dF;
      const childMult=p.childMultiplier!=null?Number(p.childMultiplier):pc.ChildMultiplier;
      // child-rate count is AUTO from the DB unless overridden: children from #ChildThreshold onward
      const threshold=p.childThreshold!=null?Number(p.childThreshold):(pc.ChildThreshold||cfg.ExtraChildThreshold||31);
      // leave over the limit → child-rate auto-count drops to 0 (Admin can still type a count to override).
      const ratedTotal=H.ratedChildCount().rated; const autoChild=leaveExceeds?0:Math.max(0, ratedTotal-(threshold-1));
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
      const gross=base+dT+oi+ot+otCarry+hb;
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
      const rec={PayrollID:nextSeqId_(M.payroll,'PayrollID','PR',4),StaffID:p.staffId,Month:p.month,PayType:payType,DailyRate:dailyRate,DaysWorked:daysWorked,BaseSalary:base,DiligenceAttendance:dA,DiligenceFacebook:dF,DiligenceTotal:dT,ExtraChildAmount:ec,ChildCount:childCount,ChildThreshold:threshold,RatedTotal:ratedTotal,ChildMultiplier:childMult,TrainingCertAmount:tc,OTEvening:ot,OTCarry:otCarry,OTCarryDetail:JSON.stringify(carry.detail||[]),HolidayBonus:hb,OtherIncome:oi,GrossIncome:gross,SocialSecurity:ss,Contribution:contrib,ContributionEmployer:contribEmp,ContributionAccum:accum,OtherDeductions:od,TotalDeductions:total,Adjustments:adj,AdjustmentsTotal:adjSum,NetPay:net,BankAccount:cfg.BankName,LeaveDays:ls.days,LeaveLimit:ls.limit,LeaveExceeds:leaveExceeds};
      const i=M.payroll.findIndex(x=>x.StaffID===p.staffId&&ym(x.Month)===ym(p.month));
      // preview → return the numbers without persisting (see the GAS route)
      if(p.preview){ rec.PayrollID=i>=0?M.payroll[i].PayrollID:''; rec.Preview=true; rec.Saved=i>=0; return rec; }
      rec.Saved=true;
      if(i>=0)M.payroll[i]=rec; else M.payroll.push(rec); return rec; },
    getPayslip: p => M.payroll.find(x=>x.StaffID===p.staffId&&ym(x.Month)===ym(p.month)) || null,
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
      const students=activeStudents().map(s=>{
        // a student may (wrongly) have >1 bill for a month — prefer the PAID/PARTIAL one over duplicates
        const bills=M.payments.filter(x=>x.StudentID===s.StudentID&&ym(x.Month)===month);
        const b=bills.find(x=>x.Status==='PAID')||bills.find(x=>x.Status==='PARTIAL')||bills[0];
        // OT: subtract what has actually been confirmed, exactly as extra charges do below. This used
        // to count the WHOLE amount of any non-PAID row, so a family who had transferred and had the
        // slip approved still read as owing the full sum until the row happened to flip to PAID.
        const otRows=M.otDaily.filter(o=>o.StudentID===s.StudentID&&ym(o.Date)===month);
        const otOpen=otRows.filter(otOpenRec)
          .reduce((a,o)=>a+Math.max(0,Number(o.Amount||0)-sumSlips_('ot',o.OTID,['CONFIRMED'])),0);
        const otCollected=otRows.reduce((a,o)=>a+(o.Status==='PAID'?Number(o.Amount||0):sumSlips_('ot',o.OTID,['CONFIRMED'])),0);
        // extra charges (now separate payables): open = still owed, collected = confirmed slips
        const chs=M.studentCharges.filter(c=>c.StudentID===s.StudentID&&ym(c.Month)===month);
        const chOpen=chs.reduce((a,c)=>a+Math.max(0,Number(c.Amount||0)-sumSlips_('charge',c.ChargeID,['CONFIRMED'])),0);
        const chCollected=chs.reduce((a,c)=>a+sumSlips_('charge',c.ChargeID,['CONFIRMED']),0);
        // Money the parent HAS sent that is only waiting for the school to check the slip. It is not
        // collected yet, but calling it "ค้างชำระ" blames the family for the school's own queue.
        const otPending=otRows.filter(otOpenRec).reduce((a,o)=>a+sumSlips_('ot',o.OTID,['SUBMITTED','PENDING_VERIFY']),0);
        const chPending=chs.reduce((a,c)=>a+sumSlips_('charge',c.ChargeID,['SUBMITTED','PENDING_VERIFY']),0);
        const amount=b?Number(b.Amount||0):0;
        // advance payment covers this month's tuition IN FULL → counts as collected (extras/OT are
        // tracked separately and are still owed). Capping this at the current plan price left the
        // difference showing as an unpaid balance the moment a package price changed.
        const prepay = prepayInfo_(s.StudentID, month);
        const prepaidTuition = (prepay && b) ? billTuition_(b) : 0;
        const billConfirmed = b ? sumSlips_('bill', b.BillingID, ['CONFIRMED']) : 0;
        const billPending = b ? sumSlips_('bill', b.BillingID, ['SUBMITTED', 'PENDING_VERIFY']) : 0;
        // tuition still owed, after the advance-payment credit and any confirmed slips
        const tuitionOpen = Math.max(0, amount - prepaidTuition - billConfirmed);
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
        return {studentId:s.StudentID,name:s.NameTH,nameEN:s.NameEN,nick:s.Nickname,nickEN:s.NicknameEN,plan:s.Plan,
          amount,collected,otOpen,chOpen,tuitionOpen,otherOpen,due,paid,
          tuitionPending,otherPending,pendingVerify:tuitionPending+otherPending,
          prepaid:!!prepay,prepay:prepay||null,prepaidTuition,
          partial:!b?false:(tuitionOpen>0 && (billConfirmed>0||prepaidTuition>0)),
          status:b?b.Status:'NO_BILL',slipAmount:b?b.SlipAmount||0:0}; });
      const staff=M.staff.filter(s=>s.Role==='Teacher').map(s=>{ const pr=M.payroll.find(x=>x.StaffID===s.StaffID&&ym(x.Month)===month);
        return {staffId:s.StaffID,name:s.NameTH,nameEN:s.NameEN,nick:s.Nickname,nickEN:s.NicknameEN,net:pr?pr.NetPay:0,paid:!!pr&&pr.SlipSent==='YES',computed:!!pr}; });
      const tuitionCollected=students.reduce((a,s)=>a+(s.collected||0),0);
      const otCollected=M.otDaily.filter(o=>ym(o.Date)===month&&o.Status==='PAID').reduce((a,o)=>a+o.Amount,0);
      // TUITION outstanding means tuition — it used to be (due − collected), which folded OT and extra
      // charges into a tile labelled "ค้างค่าเทอม". They are reported separately as otherOutstanding.
      const tuitionOutstanding=students.reduce((a,s)=>a+Number(s.tuitionOpen||0),0);
      const otherOutstanding=students.reduce((a,s)=>a+Number(s.otherOpen||0),0);
      const salaryExpense=staff.reduce((a,s)=>a+s.net,0);
      const income=tuitionCollected+otCollected;
      return {month, students, staff, income, tuitionCollected, otCollected, tuitionOutstanding, otherOutstanding,
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
        const stat=studs.map(s=>{ const a=M.studentAttendanceToday.find(x=>x.StudentID===s.StudentID); return {studentId:s.StudentID,name:s.NameTH,nameEN:s.NameEN,nick:s.Nickname,nickEN:s.NicknameEN, status:a?a.Status:'ABSENT', in:a?a.CheckIn||'':'', out:a?a.CheckOut||'':'', reason:a?a.Reason:''}; });
        return {className:name,total:studs.length,in:stat.filter(s=>s.status==='IN').length,out:stat.filter(s=>s.status==='OUT').length,leave:stat.filter(s=>s.status==='LEAVE').length,absent:stat.filter(s=>s.status==='ABSENT').length,students:stat}; })
        .filter(c=>c.total>0 || (M.classes||[]).some(mc=>mc.ClassName===c.className)); // hide empty extra depts, keep real classes
      // staff with check-in turned OFF never clock in — exclude them entirely (not counted, not "absent")
      const staffStat=M.staff.filter(s=>s.Role==='Teacher'&&s.RequireCheckin!==false).map(s=>{ const a=M.staffAttendanceToday.find(x=>x.StaffID===s.StaffID)||{};
        const onLeave=a.Status==='LEAVE'; return {staffId:s.StaffID,name:s.NameTH,nameEN:s.NameEN,nick:s.Nickname,nickEN:s.NicknameEN,dept:s.Department, status:a.Status||'ABSENT',
          checkIn:onLeave?'':(a.CheckIn||''), checkOut:onLeave?'':(a.CheckOut||''), late:onLeave?0:(a.Late||0), remark:onLeave?(a.Reason||'ลา'):''}; });
      return {classes:cls, staff:staffStat, pendingLeaves:M.leaves.filter(l=>l.Status.startsWith('PENDING')).length,
        holidays:(M.holidays||[]).map(h=>({Date:h.Date,NameTH:h.NameTH,NameEN:h.NameEN})), bigCleaning:bigCleaningList_()}; },
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
    listStaff: () => M.staff.map(s=>Object.assign({RequireCheckin: s.RequireCheckin!==false}, s)),
    // the caller's own staff record (sanitized — no PasswordHash) so screens don't rely on client MOCK.staff.
    staffSelf: p => { const s=staffById(p.staffId); if(!s.StaffID)return null;
      const grp=(M.staffGroups||[]).find(g=>g.GroupName===s.StaffGroup)||null;
      return { StaffID:s.StaffID, NameTH:s.NameTH, NameEN:s.NameEN, Nickname:s.Nickname, NicknameEN:s.NicknameEN,
        Role:s.Role, PositionLevel:s.PositionLevel, Position:s.Position, Department:s.Department,
        StaffGroup:s.StaffGroup, Phone:s.Phone, DOB:s.DOB, StartDate:s.StartDate, NationalID:s.NationalID,
        RequireCheckin: s.RequireCheckin!==false, MustChangePassword: !!s.MustChangePassword,
        CanClassOrg: canOrganize_(s),
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
    setStudentPause: p => { const ap=staffById(p.staffId); if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะแอดมิน');
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
    pausedStudents: () => M.students.filter(s=>String(s.Status)===PAUSED_STATUS)
      .map(s=>({studentId:s.StudentID,name:s.NameTH||s.Name,nameEN:s.NameEN,nick:s.Nickname,className:s.Class,
        from:ymd(s.PauseFrom||''), to:ymd(s.PauseTo||''), reason:s.PauseReason||'',
        active:studentPaused_(s), due:!!(s.PauseTo && ymd(s.PauseTo)<todayLocal())}))
      .sort((a,b)=>String(a.from).localeCompare(String(b.from))),
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
      const a={AnnID:'ANN-'+(mx+1),Title:p.title,TitleEN:p.titleEN||'',Content:p.content,ContentEN:p.contentEN||'',Image:p.image||'',Date:todayLocal(),Type:p.type||'news',TargetGroup:p.target||'all',Popup:!!p.popup,StartDate:p.startDate||todayLocal(),EndDate:p.endDate||'',Priority:Number(p.priority)||0}; M.announcements.unshift(a); return a; },
    editAnnouncement: p => { const a=M.announcements.find(x=>x.AnnID===p.annId); if(!a)fail('NOT_FOUND','ไม่พบประกาศ');
      ['Title','TitleEN','Content','ContentEN','Popup','StartDate','EndDate','Priority'].forEach(k=>{ const kk=k.charAt(0).toLowerCase()+k.slice(1); if(p[kk]!==undefined)a[k]=(k==='Priority'?(Number(p[kk])||0):p[kk]); });
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
    parentLinkCounts: () => { const cnt={}; const uidToPid={}; (M.parents||[]).forEach(pa=>{ if(pa.LineUID)uidToPid[pa.LineUID]=pa.ParentID; cnt[pa.ParentID]=0; });
      const seen={}; const active=activeStudents();
      active.forEach(s=>{ (M.userLinks||[]).filter(l=>String(l.StudentID)===String(s.StudentID)).forEach(l=>{ const pid=uidToPid[l.UserUID]; if(!pid)return; const k=pid+'|'+s.StudentID; if(seen[k])return; seen[k]=1; cnt[pid]=(cnt[pid]||0)+1; });
        if(s.ParentID){ const k=s.ParentID+'|'+s.StudentID; if(!seen[k]){ seen[k]=1; cnt[s.ParentID]=(cnt[s.ParentID]||0)+1; } } });
      return cnt; },
    // Admin: {parentId: [child, ...]} for every parent — same link resolution as parentLinkCounts
    // (USER_LINKS by LINE UID first, then the legacy STUDENTS.ParentID), active children only.
    // Keys stay PascalCase so the client can feed these straight into parentDisp()/dispNick().
    // Kept SEPARATE from parentLinkCounts on purpose: that one is consumed as a plain number.
    parentKidsMap: () => { const out={}; const uidToPid={}; (M.parents||[]).forEach(pa=>{ if(pa.LineUID)uidToPid[pa.LineUID]=pa.ParentID; out[pa.ParentID]=[]; });
      const seen={}; const push=(pid,s)=>{ const k=pid+'|'+s.StudentID; if(seen[k])return; seen[k]=1;
        (out[pid]=out[pid]||[]).push({StudentID:s.StudentID, NameTH:s.NameTH, NameEN:s.NameEN, Nickname:s.Nickname, NicknameEN:s.NicknameEN, Class:s.Class}); };
      activeStudents().forEach(s=>{
        (M.userLinks||[]).filter(l=>String(l.StudentID)===String(s.StudentID)).forEach(l=>{ const pid=uidToPid[l.UserUID]; if(pid)push(pid,s); });
        if(s.ParentID) push(s.ParentID,s); });
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
    updateGrowth: p => { const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน');
      if(p.weight!=null) s.Weight=+p.weight; if(p.height!=null) s.Height=+p.height; if(p.photo) s.Photo=p.photo;
      s.LastGrowthUpdate=todayLocal();
      M.growthRecords.push({Date:todayLocal(),StudentID:s.StudentID,AgeMonth:ageMonths(s.DOB),Weight:s.Weight||0,Height:s.Height||0});
      return {ok:true,lastUpdate:s.LastGrowthUpdate}; },

    // ========== Group E: growth history vs standard band ==========
    growthHistory: p => { const s=studentById(p.studentId)||{}; const recs=M.growthRecords.filter(r=>r.StudentID===p.studentId).sort((a,b)=>a.AgeMonth-b.AgeMonth);
      const std=GROWTH_STD; const ages=recs.map(r=>r.AgeMonth);
      const band=k=> ages.map(a=>{ const at=std?std.at(s.Gender,a,k):null; return {ageMonth:a,min:at?at.min:null,max:at?at.max:null}; });
      return {studentId:p.studentId,name:s.NameTH,nameEN:s.NameEN,gender:s.Gender,ageMonth:ageMonths(s.DOB),
        records:recs, weightBand:band('weight'), heightBand:band('height')}; },

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
      const rows=(M.foodMenus||[]).filter(r=>String(r.Class)===cls && ym(r.Date)===month)
        .sort((a,b)=>String(a.Date).localeCompare(String(b.Date)));
      return { className:cls, month,
        days: rows.map(r=>({ date:ymd(r.Date), breakfast:r.Breakfast||'', snackAM:r.SnackAM||'',
          lunch:r.Lunch||'', snackPM:r.SnackPM||'', note:r.Note||'' })),
        updatedAt: rows.reduce((a,r)=>String(r.UpdatedAt||'')>a?String(r.UpdatedAt):a,'') }; },

    /** Parent view: resolve the child's class for them, so the menu is never the wrong one. */
    myFoodMenu: p => { const kids=visibleStudents(p);
      const kid = p.studentId ? kids.find(s=>s.StudentID===p.studentId) : kids[0];
      if(!kid) fail('NOT_FOUND','ไม่พบนักเรียน');
      const r=H.foodMenu({ className:kid.Class, month:p.month });
      r.studentId=kid.StudentID; r.nick=kid.Nickname||''; r.name=kid.NameTH||'';
      r.kids=kids.map(s=>({studentId:s.StudentID, nick:s.Nickname||'', name:s.NameTH||'', cls:s.Class}));
      return r; },

    /** Admin saves a whole month for one class in one go (one round trip, one consistent picture). */
    saveFoodMenu: p => { const ap=staffById(p.staffId)||{};
      if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin') fail('NO_PERMISSION','เฉพาะแอดมิน');
      const cls=String(p.className||''); if(!cls) fail('BAD_INPUT','ระบุชั้นเรียน');
      const month=ym(p.month||todayLocal().slice(0,7));
      M.foodMenus=M.foodMenus||[];
      const stamp=stampLocal();
      (p.days||[]).forEach(d=>{
        const date=ymd(d.date); if(!date || ym(date)!==month) return;      // never write outside the month being edited
        const blank=!(d.breakfast||d.snackAM||d.lunch||d.snackPM||d.note);
        const i=M.foodMenus.findIndex(r=>String(r.Class)===cls && ymd(r.Date)===date);
        if(blank){ if(i>=0) M.foodMenus.splice(i,1); return; }             // clearing a day removes it
        const rec={ MenuID:'FM-'+cls.replace(/\s+/g,'')+'-'+date, Class:cls, Date:date,
          Breakfast:d.breakfast||'', SnackAM:d.snackAM||'', Lunch:d.lunch||'', SnackPM:d.snackPM||'',
          Note:d.note||'', UpdatedBy:p.staffId||'', UpdatedAt:stamp };
        if(i>=0) M.foodMenus[i]=Object.assign(M.foodMenus[i],rec); else M.foodMenus.push(rec);
      });
      logAct('saveFoodMenu',cls,month+' ('+(p.days||[]).length+' วัน)',actorOf(p));
      return H.foodMenu({className:cls, month}); },

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
          category:i.Category||'other', active:String(i.Active||'YES')!=='NO' }))
        .sort((a,b)=>(order[a.category]-order[b.category])||String(a.nameTH).localeCompare(String(b.nameTH),'th')); },

    /** Add or edit one item. Teachers may ADD (that is the point); only admin may edit or retire. */
    saveFoodItem: p => { const me=staffById(p.staffId)||{};
      const isAdmin = me.PositionLevel==='Admin'||me.Role==='Admin';
      const nameTH=String((p.item||{}).nameTH||'').trim();
      if(!nameTH) fail('BAD_INPUT','ใส่ชื่อเมนู (ภาษาไทย)');
      const cat=['savoury','dessert','fruit','other'].indexOf(String((p.item||{}).category))>=0?String(p.item.category):'other';
      M.foodItems=M.foodItems||[];
      if(p.item.itemId){ if(!isAdmin) fail('NO_PERMISSION','แก้ไขรายการหลักได้เฉพาะแอดมิน');
        const it=M.foodItems.find(x=>x.ItemID===p.item.itemId); if(!it)fail('NOT_FOUND','ไม่พบเมนู');
        it.NameTH=nameTH; it.NameEN=String(p.item.nameEN||'').trim(); it.Category=cat;
        it.Active=p.item.active===false?'NO':'YES';
        logAct('editFoodItem',it.ItemID,nameTH,actorOf(p)); return {itemId:it.ItemID}; }
      // adding the same dish twice is a data problem, not a new item — return the one that exists
      const dup=M.foodItems.find(x=>String(x.NameTH||'').trim()===nameTH);
      if(dup){ if(String(dup.Active||'YES')==='NO'){ dup.Active='YES'; } return {itemId:dup.ItemID, existed:true}; }
      const it={ ItemID:nextSeqId_(M.foodItems,'ItemID','FI',4), NameTH:nameTH,
        NameEN:String(p.item.nameEN||'').trim(), Category:cat, Active:'YES',
        CreatedBy:p.staffId||'', CreatedAt:stampLocal() };
      M.foodItems.push(it); logAct('addFoodItem',it.ItemID,nameTH,actorOf(p));
      return {itemId:it.ItemID, existed:false}; },

    deleteFoodItem: p => { const me=staffById(p.staffId)||{};
      if(me.PositionLevel!=='Admin'&&me.Role!=='Admin') fail('NO_PERMISSION','เฉพาะแอดมิน');
      const it=(M.foodItems||[]).find(x=>x.ItemID===p.itemId); if(!it)fail('NOT_FOUND','ไม่พบเมนู');
      // retire rather than delete: journals already written refer to it by name
      it.Active='NO'; logAct('retireFoodItem',it.ItemID,it.NameTH,actorOf(p));
      return {itemId:it.ItemID, active:false}; },

    /** One-off seed of the school's own list, so nobody has to type 30 dishes to get started. */
    seedFoodItems: p => { const me=staffById(p.staffId)||{};
      if(me.PositionLevel!=='Admin'&&me.Role!=='Admin') fail('NO_PERMISSION','เฉพาะแอดมิน');
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
    mealSlots: p => ({ className:String(p.className||''), slots: mealSlotsFor_(p.className) }),

    /* ================= Phase 7b: satisfaction survey ====================================
     * Three shapes, because a school asks three different kinds of question:
     *   rating  — 1..5 faces ("how happy are you with…")
     *   vote    — pick one of the school's own options
     *   comment — free text only
     * Scope decides who is asked: everyone, one class, or one child's family.
     */
    surveys: p => { const ap=staffById(p.staffId)||{};
      if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin') fail('NO_PERMISSION','เฉพาะแอดมิน');
      return (M.surveys||[]).slice().sort((a,b)=>String(b.CreatedAt||'').localeCompare(String(a.CreatedAt||'')))
        .map(s=>Object.assign(surveyView_(s), { responses:(M.surveyResponses||[]).filter(r=>r.SurveyID===s.SurveyID).length })); },

    saveSurvey: p => { const ap=staffById(p.staffId)||{};
      if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin') fail('NO_PERMISSION','เฉพาะแอดมิน');
      const d=p.survey||{}; if(!String(d.title||'').trim()) fail('BAD_INPUT','ใส่หัวข้อแบบสอบถาม');
      const type=['rating','vote','comment'].indexOf(String(d.type))>=0?String(d.type):'rating';
      if(type==='vote' && !(d.options||[]).filter(x=>String(x).trim()).length) fail('BAD_INPUT','ใส่ตัวเลือกอย่างน้อย 1 ข้อ');
      M.surveys=M.surveys||[];
      const rec={ Title:String(d.title).trim(), Description:String(d.description||''), Type:type,
        Options:JSON.stringify((d.options||[]).map(x=>String(x).trim()).filter(Boolean)),
        Scope:['all','class','student'].indexOf(String(d.scope))>=0?String(d.scope):'all',
        Target:String(d.target||''), StartDate:ymd(d.startDate||todayLocal()), EndDate:ymd(d.endDate||''),
        Status:d.status==='CLOSED'?'CLOSED':'OPEN', Anonymous:d.anonymous?'YES':'' };
      if(d.surveyId){ const s=(M.surveys||[]).find(x=>x.SurveyID===d.surveyId); if(!s)fail('NOT_FOUND','ไม่พบแบบสอบถาม');
        Object.assign(s,rec); logAct('editSurvey',s.SurveyID,s.Title,actorOf(p)); return surveyView_(s); }
      const s=Object.assign({ SurveyID:nextSeqId_(M.surveys,'SurveyID','SV',3), CreatedBy:p.staffId||'', CreatedAt:stampLocal() },rec);
      M.surveys.push(s); logAct('addSurvey',s.SurveyID,s.Title,actorOf(p)); return surveyView_(s); },

    setSurveyStatus: p => { const ap=staffById(p.staffId)||{};
      if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin') fail('NO_PERMISSION','เฉพาะแอดมิน');
      const s=(M.surveys||[]).find(x=>x.SurveyID===p.surveyId); if(!s)fail('NOT_FOUND','ไม่พบแบบสอบถาม');
      s.Status = p.reopen ? 'OPEN' : 'CLOSED';
      logAct('setSurveyStatus',s.SurveyID,s.Status,actorOf(p)); return surveyView_(s); },

    // Deleting a survey deletes the answers people gave it — say how many, and log it.
    deleteSurvey: p => { const ap=staffById(p.staffId)||{};
      if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin') fail('NO_PERMISSION','เฉพาะแอดมิน');
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
          myAnswer: answered.length?{rating:Number(answered[0].Rating)||0, choice:answered[0].Choice||'', comment:answered[0].Comment||''}:null }); }); },

    /** One answer per family per survey — re-submitting EDITS it rather than stuffing the ballot. */
    submitSurvey: p => { const s=(M.surveys||[]).find(x=>x.SurveyID===p.surveyId);
      if(!s) fail('NOT_FOUND','ไม่พบแบบสอบถาม');
      if(String(s.Status)!=='OPEN') fail('CLOSED','แบบสอบถามนี้ปิดรับคำตอบแล้ว');
      const kids=visibleStudents(p); const sid=p.studentId||(kids[0]&&kids[0].StudentID)||'';
      if(kids.length && !kids.some(k=>k.StudentID===sid)) fail('NO_ACCESS','ไม่มีสิทธิ์ตอบแทนนักเรียนคนนี้');
      const rating=Math.max(0,Math.min(5,Math.round(Number(p.rating)||0)));
      if(s.Type==='rating' && !rating) fail('BAD_INPUT','เลือกระดับความพึงพอใจ');
      if(s.Type==='vote' && !String(p.choice||'').trim()) fail('BAD_INPUT','เลือกคำตอบ');
      if(s.Type==='comment' && !String(p.comment||'').trim()) fail('BAD_INPUT','กรุณาเขียนความคิดเห็น');
      M.surveyResponses=M.surveyResponses||[];
      const mine=M.surveyResponses.find(r=>r.SurveyID===p.surveyId &&
        (p.parentId ? r.ParentID===p.parentId : r.StudentID===sid));
      const rec={ SurveyID:p.surveyId, StudentID:sid, ParentID:p.parentId||'',
        Rating:rating, Choice:String(p.choice||''), Comment:String(p.comment||'').slice(0,1000), SubmittedAt:stampLocal() };
      if(mine){ Object.assign(mine,rec); return {ok:true, updated:true}; }
      M.surveyResponses.push(Object.assign({ResponseID:nextSeqId_(M.surveyResponses,'ResponseID','SR',4)},rec));
      return {ok:true, updated:false}; },

    surveyResults: p => { const ap=staffById(p.staffId)||{};
      if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin') fail('NO_PERMISSION','เฉพาะแอดมิน');
      const s=(M.surveys||[]).find(x=>x.SurveyID===p.surveyId); if(!s)fail('NOT_FOUND','ไม่พบแบบสอบถาม');
      const rs=(M.surveyResponses||[]).filter(r=>r.SurveyID===p.surveyId);
      const dist=[0,0,0,0,0];                                   // how many gave 1..5
      let sum=0, rated=0;
      rs.forEach(r=>{ const v=Number(r.Rating)||0; if(v>=1&&v<=5){ dist[v-1]++; sum+=v; rated++; } });
      const tally={}; JSON.parse(s.Options||'[]').forEach(o=>tally[o]=0);
      rs.forEach(r=>{ const c=String(r.Choice||''); if(c) tally[c]=(tally[c]||0)+1; });
      const anon=String(s.Anonymous||'')==='YES';
      return Object.assign(surveyView_(s), {
        responses:rs.length, rated, average: rated?Math.round(sum/rated*10)/10:null, dist, tally,
        // an anonymous survey must not hand back who said what — that is the promise made to parents
        comments: rs.filter(r=>String(r.Comment||'').trim()).map(r=>({
          comment:r.Comment, rating:Number(r.Rating)||0, at:r.SubmittedAt,
          who: anon ? '' : (studentById(r.StudentID)||{}).Nickname || '' })) }); },

    /** Monthly rollup across every survey — what the school reads at the end of a month. */
    surveySummary: p => { const ap=staffById(p.staffId)||{};
      if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin') fail('NO_PERMISSION','เฉพาะแอดมิน');
      const month=ym(p.month||todayLocal().slice(0,7));
      const rs=(M.surveyResponses||[]).filter(r=>ym(r.SubmittedAt)===month);
      const byS={}; rs.forEach(r=>{ (byS[r.SurveyID]=byS[r.SurveyID]||[]).push(r); });
      let sum=0, rated=0;
      rs.forEach(r=>{ const v=Number(r.Rating)||0; if(v>=1&&v<=5){ sum+=v; rated++; } });
      return { month, responses:rs.length, rated, average: rated?Math.round(sum/rated*10)/10:null,
        surveys: Object.keys(byS).map(id=>{ const s=(M.surveys||[]).find(x=>x.SurveyID===id)||{};
          const g=byS[id]; let ss=0, sn=0;
          g.forEach(r=>{ const v=Number(r.Rating)||0; if(v>=1&&v<=5){ ss+=v; sn++; } });
          return { surveyId:id, title:s.Title||id, type:s.Type||'', responses:g.length,
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
    addHoliday: p => { M.holidays.push({Date:p.date,NameTH:p.nameTH||p.nameEN||'',NameEN:p.nameEN||p.nameTH||'',Recurring:!!p.recurring}); return {ok:true}; },
    removeHoliday: p => { const i=M.holidays.findIndex(h=>h.Date===p.date&&(h.NameTH===p.nameTH||!p.nameTH)); if(i>=0)M.holidays.splice(i,1); return {ok:true}; },

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
    // children counted for the teacher child-rate = active students minus those absent >= AbsenceRateExcludeDays
    ratedChildCount: () => { const excl=Number(cfg.AbsenceRateExcludeDays||6); const byStu={};
      M.absenceLog.forEach(a=>{ byStu[a.StudentID]=(byStu[a.StudentID]||0)+1; });
      const total=activeStudents().length; const excluded=activeStudents().filter(s=>(byStu[s.StudentID]||0)>=excl).length;
      return {total, excluded, rated:total-excluded, excludeDays:excl}; },

    // move a student to another Nursery (class) / a teacher to another department
    moveStudent: p => { const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน'); s.Class=p.toClass; return s; },
    moveTeacher: p => { const s=staffById(p.staffId); if(!s.StaffID)fail('NOT_FOUND','ไม่พบพนักงาน'); s.Department=p.toDept; return s; },
    // Class-organize moves for a NON-admin caller granted the capability. The caller's staffId is injected
    // server-side (never the target — so applyIdentity_ can't clobber the target id). Admin/Leader always
    // qualify; a plain teacher needs CanClassOrg=true set by the admin on their staff record.
    orgMoveTeacher: p => { const me=staffById(p.staffId)||{};
      if(!canOrganize_(me)) fail('NO_PERMISSION','ไม่มีสิทธิ์จัดชั้นเรียน (ต้องได้รับสิทธิ์จากแอดมิน)');
      const s=staffById(p.targetId); if(!s.StaffID)fail('NOT_FOUND','ไม่พบพนักงาน'); s.Department=p.toDept||'';
      logAct('moveTeacher',p.targetId,'→ '+(p.toDept||'-'),actorOf(p)); return {ok:true}; },
    orgMoveStudent: p => { const me=staffById(p.staffId)||{};
      if(!canOrganize_(me)) fail('NO_PERMISSION','ไม่มีสิทธิ์จัดชั้นเรียน (ต้องได้รับสิทธิ์จากแอดมิน)');
      const s=studentById(p.targetId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน'); s.Class=p.toClass||'';
      logAct('moveStudent',p.targetId,'→ '+(p.toClass||'-'),actorOf(p)); return {ok:true}; },

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
    staffMonthlyOT: p => { const recs=(M.otRecords||[]).filter(r=>r.StaffID===p.staffId && String(r.Status||'').toUpperCase()==='APPROVED' && (!p.month||ym(r.Month||r.Date)===p.month));
      const hours=recs.reduce((a,r)=>a+(Number(r.Hours)||0),0); const amount=recs.reduce((a,r)=>a+(Number(r.Amount)||0),0);
      const rate=staffOtRate(staffById_(p.staffId)); return {staffId:p.staffId,month:p.month,hours,rate,amount:Math.round(amount),days:recs.length}; },
    // OT approved AFTER an earlier month's payroll was already saved, and therefore never paid — e.g. a
    // 31/07 late check-out approved in August once July's salary had gone out. Each earlier month owes
    //   approved(m) − what that month's saved payslip paid − what later payslips already carried
    // so nothing is paid twice and nothing is dropped. A month with NO saved payslip is not carried:
    // its own payroll run pays it normally. Mirrors otCarryOver_ in src/Payroll.gs.
    otCarryOver: p => { const mm=ym(p.month); const approved={};
      (M.otRecords||[]).forEach(r=>{ if(r.StaffID!==p.staffId)return;
        const st=String(r.Status||'').toUpperCase(); if(st&&st!=='APPROVED')return;
        const m=ym(r.Month||r.Date); if(!m)return; approved[m]=(approved[m]||0)+(Number(r.Amount)||0); });
      const paidFor={}, carriedFor={};
      (M.payroll||[]).forEach(r=>{ if(r.StaffID!==p.staffId)return; const m=ym(r.Month);
        if(!m||m>=mm)return;                       // this month's own row (and any later one) must not count
        paidFor[m]=(paidFor[m]||0)+(Number(r.OTEvening)||0);
        let d=r.OTCarryDetail; if(typeof d==='string'&&d){ try{d=JSON.parse(d);}catch(e){d=null;} }
        (Array.isArray(d)?d:[]).forEach(c=>{ const cm=ym(c&&c.month); if(cm) carriedFor[cm]=(carriedFor[cm]||0)+(Number(c&&c.amount)||0); }); });
      const detail=[]; let total=0;
      Object.keys(paidFor).forEach(m=>{ const unpaid=Math.round(((approved[m]||0)-paidFor[m]-(carriedFor[m]||0))*100)/100;
        if(unpaid>0.5){ detail.push({month:m,amount:unpaid}); total+=unpaid; } });
      detail.sort((a,b)=>a.month<b.month?-1:(a.month>b.month?1:0));
      return {staffId:p.staffId,month:p.month,total:Math.round(total*100)/100,detail}; },

    // ===== staff OT approval workflow (teacher → Leader → Admin) — OT_RECORDS is the source of truth =====
    // full-hour amount helper (rounded), used everywhere an OT amount is (re)computed
    // reads:
    myOT: p => (M.otRecords||[]).filter(r=>r.StaffID===p.staffId && (!p.month||ym(r.Month||r.Date)===p.month)).sort((a,b)=>String(b.Date).localeCompare(String(a.Date))),
    // Leader/Admin: OT awaiting the first (Leader) approval
    teamPendingOT: p => { const me=staffById(p.staffId); if(me.PositionLevel!=='Leader'&&me.PositionLevel!=='Admin'&&me.Role!=='Admin')return [];
      return (M.otRecords||[]).filter(r=>String(r.Status).toUpperCase()==='PENDING_LEADER').map(otView_); },
    // Admin: OT the Leader approved, awaiting Admin confirmation
    pendingAdminOT: () => (M.otRecords||[]).filter(r=>String(r.Status).toUpperCase()==='PENDING_ADMIN').map(otView_),
    // Admin: everything for a month (any status) — the manage screen
    adminOTList: p => (M.otRecords||[]).filter(r=>!p.month||ym(r.Month||r.Date)===p.month).sort((a,b)=>String(b.Date).localeCompare(String(a.Date))).map(otView_),
    // Leader step-1 decision
    approveOT: p => { const ap=staffById(p.staffId); const r=(M.otRecords||[]).find(x=>x.OTRecordID===p.otId); if(!r)fail('NOT_FOUND','ไม่พบรายการ OT');
      if(String(r.Status).toUpperCase()!=='PENDING_LEADER')fail('BAD_STATE','รายการนี้ไม่ได้รออนุมัติจากหัวหน้า');
      if(ap.PositionLevel!=='Leader'&&ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะหัวหน้าครู');
      const yes=p.decision==='approve'; r.Step1By=ap.NameTH; r.Step1Status=yes?'Approved':'Rejected'; r.Status=yes?'PENDING_ADMIN':'REJECTED';
      return {otId:r.OTRecordID,status:r.Status}; },
    // Admin step-2 confirm (optionally editing hours/amount), or reject
    confirmOT: p => { const ap=staffById(p.staffId); if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะแอดมิน');
      const r=(M.otRecords||[]).find(x=>x.OTRecordID===p.otId); if(!r)fail('NOT_FOUND','ไม่พบรายการ OT');
      const yes=p.decision!=='reject';
      if(yes){ if(p.hours!=null) r.Hours=Number(p.hours)||0;
        // re-price at approval time so a rate correction reaches everything not yet paid
        r.Rate=staffOtRate(staffById_(r.StaffID)); r.Amount=Math.round((Number(r.Hours)||0)*r.Rate);
        if(p.amount!=null&&p.amount!=='') r.Amount=Number(p.amount)||0;
        if(p.note!=null) r.Note=p.note; r.Step2By=ap.NameTH; r.Step2Status='Approved'; r.ApprovedBy=ap.NameTH; r.Status='APPROVED'; }
      else { r.Step2By=ap.NameTH; r.Step2Status='Rejected'; r.Status='REJECTED'; }
      return {otId:r.OTRecordID,status:r.Status,hours:r.Hours,amount:r.Amount}; },
    // Admin adds an OT directly (already approved). date + hours (+optional amount/note)
    adminAddOT: p => { const ap=staffById(p.staffId); if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะแอดมิน');
      const target=p.targetStaffId||p.forStaffId; const st=staffById_(target); if(!st.StaffID)fail('NOT_FOUND','ไม่พบพนักงาน');
      const hours=Number(p.hours)||0; if(hours<=0)fail('BAD_INPUT','ระบุจำนวนชั่วโมง');
      const amount=(p.amount!=null&&p.amount!=='')?Number(p.amount):Math.round(hours*staffOtRate(st));
      const id='OTR-'+String(Date.now()).slice(-6); const date=p.date||todayLocal();
      M.otRecords.push({OTRecordID:id,StaffID:target,Date:date,Hours:hours,Rate:staffOtRate(st),Amount:amount,ApprovedBy:ap.NameTH,Status:'APPROVED',Minutes:hours*60,PlanOut:'',ActualOut:'',Month:ym(date),Step1By:ap.NameTH,Step1Status:'Approved',Step2By:ap.NameTH,Step2Status:'Approved',Note:p.note||''});
      return {otId:id,status:'APPROVED'}; },
    // Admin edits any OT (hours/amount/note). Recomputes amount from hours unless amount is given.
    adminEditOT: p => { const ap=staffById(p.staffId); if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะแอดมิน');
      const r=(M.otRecords||[]).find(x=>x.OTRecordID===p.otId); if(!r)fail('NOT_FOUND','ไม่พบรายการ OT');
      if(p.hours!=null){ r.Hours=Number(p.hours)||0; r.Amount=Math.round(r.Hours*staffOtRate(staffById_(r.StaffID))); }
      if(p.amount!=null&&p.amount!=='') r.Amount=Number(p.amount)||0;
      if(p.note!=null) r.Note=p.note; if(p.date) { r.Date=p.date; r.Month=ym(p.date); }
      return {otId:r.OTRecordID,hours:r.Hours,amount:r.Amount}; },
    adminDeleteOT: p => { const ap=staffById(p.staffId); if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะแอดมิน');
      const i=(M.otRecords||[]).findIndex(x=>x.OTRecordID===p.otId); if(i<0)fail('NOT_FOUND','ไม่พบรายการ OT'); M.otRecords.splice(i,1); return {ok:true}; },

    // ===== class-management change requests (ย้ายครูประจำชั้น/แผนก): Leader submits → Admin approves (applies+logs) =====
    // NOTE: on GAS the mutations (submit/decide) are in-place ROUTES (ClassOrg.gs) that win over these
    // engine handlers — these serve MOCK mode. The READS (myClassChanges/pendingClassChanges) run here.
    submitClassChange: p => { const ap=staffById(p.staffId); const isAdmin=ap.PositionLevel==='Admin'||ap.Role==='Admin';
      if(!isAdmin&&ap.PositionLevel!=='Leader')fail('NO_PERMISSION','เฉพาะหัวหน้าครูหรือแอดมิน');
      const changes=(p.changes||[]).filter(c=>c&&c.staffId&&c.after!==c.before);
      if(!changes.length)fail('BAD_INPUT','ไม่มีการเปลี่ยนแปลง');
      const id='CCR-'+String(((M.classChangeReq||[]).length)+1).padStart(3,'0');
      (M.classChangeReq=M.classChangeReq||[]).push({ReqID:id,RequestBy:p.staffId,RequestByName:ap.NameTH||ap.Name||p.staffId,CreatedDate:todayLocal(),Status:isAdmin?'APPROVED':'PENDING_ADMIN',Changes:changes,Note:p.note||'',Step2By:isAdmin?(ap.NameTH||p.staffId):'',DecidedDate:isAdmin?todayLocal():''});
      if(isAdmin){ changes.forEach(c=>{ const s=staffById_(c.staffId); if(s.StaffID){ s.Department=c.after; s.Classes=c.after; } }); logAct('classChange',id,changes.map(c=>c.name+':'+c.before+'→'+c.after).join(', '),actorOf(p)); }
      return {reqId:id,status:isAdmin?'APPROVED':'PENDING_ADMIN'}; },
    myClassChanges: p => (M.classChangeReq||[]).filter(r=>r.RequestBy===p.staffId).sort((a,b)=>String(b.CreatedDate).localeCompare(String(a.CreatedDate))),
    pendingClassChanges: p => { const ap=staffById(p.staffId); if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะแอดมิน');
      return (M.classChangeReq||[]).filter(r=>String(r.Status).toUpperCase()==='PENDING_ADMIN').sort((a,b)=>String(a.CreatedDate).localeCompare(String(b.CreatedDate))); },
    decideClassChange: p => { const ap=staffById(p.staffId); if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะแอดมิน');
      const r=(M.classChangeReq||[]).find(x=>x.ReqID===p.reqId); if(!r)fail('NOT_FOUND','ไม่พบคำขอ');
      if(String(r.Status).toUpperCase()!=='PENDING_ADMIN')fail('ALREADY_RESOLVED','คำขอนี้ดำเนินการแล้ว');
      const yes=p.decision==='approve';
      if(yes){ (r.Changes||[]).forEach(c=>{ const s=staffById_(c.staffId); if(s.StaffID){ s.Department=c.after; s.Classes=c.after; } }); logAct('classChange',r.ReqID,(r.Changes||[]).map(c=>c.name+':'+c.before+'→'+c.after).join(', '),actorOf(p)); }
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
    teamPendingTimeRequests: p => { const me=staffById(p.staffId); if(me.PositionLevel!=='Leader'&&me.PositionLevel!=='Admin'&&me.Role!=='Admin')return [];
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
    pendingAdminTimeRequests: p => { const ap=staffById(p.staffId); if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะแอดมิน');
      return (M.attendanceReq||[])
        .filter(r=>{ const s=String(r.Status).toUpperCase(); return s==='PENDING_ADMIN'||s==='PENDING_LEADER'; })
        .sort((a,b)=>String(a.CreatedDate||'').localeCompare(String(b.CreatedDate||'')))
        .map(r=>Object.assign(atrView_(r), { stage: String(r.Status).toUpperCase()==='PENDING_LEADER'?'leader':'admin' })); },
    approveTimeRequest: p => { const ap=staffById(p.staffId); const r=(M.attendanceReq||[]).find(x=>x.ReqID===p.reqId); if(!r)fail('NOT_FOUND','ไม่พบคำขอ');
      if(String(r.Status).toUpperCase()!=='PENDING_LEADER')fail('BAD_STATE','ไม่ได้รออนุมัติจากหัวหน้า');
      if(ap.PositionLevel!=='Leader'&&ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะหัวหน้าครู');
      const yes=p.decision==='approve'; r.Step1By=ap.NameTH||ap.Name; r.Step1Status=yes?'Approved':'Rejected'; r.Status=yes?'PENDING_ADMIN':'REJECTED';
      return {reqId:r.ReqID,status:r.Status}; },
    confirmTimeRequest: p => { const ap=staffById(p.staffId); if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะแอดมิน');
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
    savePrepayTiers: p => { const ap=staffById(p.staffId); if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะแอดมิน');
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
    editPrepay: p => { const ap=staffById(p.staffId); if(ap.PositionLevel!=='Admin'&&ap.Role!=='Admin')fail('NO_PERMISSION','เฉพาะแอดมิน');
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

    // ========== announcements (popup + date range) ==========
    activeAnnouncements: () => { const today=todayLocal(); const on=v=>v===true||String(v).toUpperCase()==='TRUE'||v==='1';
      return M.announcements.filter(a=>on(a.Popup) && (!a.StartDate||ymd(a.StartDate)<=today) && (!a.EndDate||ymd(a.EndDate)>=today))
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
        Witness:p.witness||'',Place:p.place||'',PlaceOther:p.placeOther||'',InjuryTypes:p.injuryTypes,TeacherID:p.staffId||'',NotifyParent:p.notifyParent?'YES':'',CreatedDate:todayLocal()};
      M.injuryReports.push(rec);
      const nm=s.NameTH||p.childName||p.studentId;
      M.feed.unshift({id:'INJ-N'+M.injuryReports.length,text:'⚠️ บันทึกอุบัติเหตุ: '+nm+' ('+rec.InjuryTypes.length+' รายการ)',
        textEN:'⚠️ Injury logged: '+(s.NameEN||nm)+' ('+rec.InjuryTypes.length+' item(s))',time:rec.Time,roles:['Admin','Leader'],read:false,studentId:p.studentId,
        category:'emergency',ref:'injury|'+id});   // ref = deep link so tapping opens THIS report
      logAct('submitInjury',p.studentId,nm+' — types '+rec.InjuryTypes.join(','),actorOf(p));
      return {injuryId:id}; },
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
    // parent submits the insurance form ONCE per student (blocked if already filled, unless adminEdit).
    // Insurance data is written ONLY here (INSURANCE_PCHI sheet).
    submitInsurance: p => { const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน');
      const existing=M.insurancePCHI.find(x=>x.StudentID===p.studentId || (s.NationalID&&String(x.NationalID)===String(s.NationalID)));
      if(existing && !p.adminEdit) fail('ALREADY_FILLED','ข้อมูลประกันของนักเรียนคนนี้ถูกกรอกแล้ว');
      const by=actorOf(p); const d=p.data||{};
      const base={ StudentID:p.studentId, InsuredName:d.InsuredName||s.NameEN||s.NameTH, InsuredLastName:d.InsuredLastName||'',
        Gender:d.Gender|| (s.Gender==='M'?'Male':s.Gender==='F'?'Female':''), NationalID:d.NationalID||s.NationalID, DOB:d.DOB||s.DOB,
        MemberStatus:d.MemberStatus||'Child', CompanyName:cfg.InsuranceCompanyName||(cfg.Insurance&&cfg.Insurance.CompanyName)||'', PolicyNo:cfg.InsurancePolicyNo||'' };
      if(existing){ Object.assign(existing, d, base, {UpdatedBy:by.name||by.id, UpdatedDate:todayLocal()}); logAct('updateInsurance',p.studentId,(s.NameTH||p.studentId),by); return {ok:true, updated:true, record:existing}; }
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
