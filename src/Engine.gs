/** Engine.gs — AUTO-GENERATED from webapp/engine.js by tools/build_engine.js — DO NOT EDIT HERE.
 *  Shared business logic (all api handlers). GasEngine.gs hydrates M from Sheets, calls
 *  createAtomAPI(M, GROWTH_STD).H[action](payload), then persists the changes back.
 */
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

  function haversine(la1,ln1,la2,ln2){ const R=6371000,r=x=>x*Math.PI/180;
    const dLa=r(la2-la1),dLn=r(ln2-ln1); const a=Math.sin(dLa/2)**2+Math.cos(r(la1))*Math.cos(r(la2))*Math.sin(dLn/2)**2;
    return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))); }
  function ageMonths(dob){ const d=new Date(dob),n=new Date(); let m=(n.getFullYear()-d.getFullYear())*12+(n.getMonth()-d.getMonth()); if(n.getDate()<d.getDate())m--; return Math.max(0,m); }
  function geo(lat,lng){ const dist=haversine(cfg.GPS_Lat,cfg.GPS_Lng,lat,lng); if(dist>cfg.Radius) fail('OUT_OF_RANGE',`อยู่นอกรัศมีโรงเรียน (${dist} ม. เกิน ${cfg.Radius} ม.)`); return dist; }
  const studentById = id => M.students.find(s=>s.StudentID===id);
  const staffById = id => M.staff.find(s=>s.StaffID===id)||{};
  const lateVs = (hhmm,t)=>{ const [h,m]=hhmm.split(':').map(Number); return Math.max(0,(t.getHours()*60+t.getMinutes())-(h*60+m)); };
  const toMin = hhmm => { const [h,m]=String(hhmm||'0:0').split(':').map(Number); return (h||0)*60+(m||0); };

  // ---- plans / OT ----
  const planById = id => (cfg.Plans||[]).find(p=>p.id===id) || null;
  const studentPlan = s => planById(s&&s.Plan) || (cfg.Plans||[])[0] || {end:'17:00',price:0};
  // teacher OT hours: ≥OTRoundUpMinutes within an hour rounds up to a full hour
  function otHoursRule(min){ if(min<=0)return 0; const h=Math.floor(min/60), rem=min%60; return h+(rem>=Number(cfg.OTRoundUpMinutes||50)?1:0); }
  // OT for a pickup time (HH:MM) vs the student's plan end + grace; 100/started hour
  function otFor(student, pickupHHMM){
    const plan=studentPlan(student); const late=Math.max(0, toMin(pickupHHMM)-toMin(plan.end));
    const grace=Number(cfg.OTGraceMinutes||21);
    if(late<=grace) return {late, hours:0, amount:0, planEnd:plan.end};
    const hours=Math.ceil(late/60); return {late, hours, amount:hours*Number(cfg.OTRatePerHour||100), planEnd:plan.end};
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
  const activeStudents = () => M.students.filter(s=>!INACTIVE[s.Status]);

  // latest assessment per item for a student
  function latestByItem(sid){ const map={}; M.assessments.filter(a=>a.StudentID===sid).forEach(a=>{ if(!map[a.ItemNo]||a.Date>=map[a.ItemNo].Date)map[a.ItemNo]=a; }); return map; }
  function summarize(sid){ const s=studentById(sid); const latest=latestByItem(sid);
    const dom={GM:{pass:0,fail:0},FM:{pass:0,fail:0},RL:{pass:0,fail:0},EL:{pass:0,fail:0},PS:{pass:0,fail:0}}; let tp=0,tf=0;
    Object.values(latest).forEach(r=>{ if(dom[r.Skill])dom[r.Skill][r.Result==='ผ่าน'?'pass':'fail']++; r.Result==='ผ่าน'?tp++:tf++; });
    return {studentId:sid,name:s?s.NameTH:sid,nameEN:s?s.NameEN:sid,ageMonth:s?ageMonths(s.DOB):0,byDomain:dom,totalPass:tp,totalFail:tf}; }

  // ---- activity log (who did what) ----
  // append a row to the full activity trail. `by` = {role,id,name} of the actor (best-effort from payload).
  function logAct(action, target, detail, by){ by=by||{};
    M.activityLog.push({ LogID:'LOG-'+(M.activityLog.length+1), Timestamp:stampLocal(),
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
    parentCheckin: p => { const d=geo(p.lat,p.lng); const t=timeLocal();
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
    getJournal: p => M.journals.find(x=>x.StudentID===p.studentId && x.Date===(p.date||todayLocal())) || null,
    journalHistory: p => M.journals.filter(x=>x.StudentID===p.studentId).sort((a,b)=>b.Date.localeCompare(a.Date)).slice(0,p.limit||14),
    studentAbsence: p => { const id='LVS-'+String(Date.now()).slice(-4); M.studentLeaves.push({LeaveID:id,StudentID:p.studentId,Date:p.date,Reason:p.reason,Status:'Notified'}); return {leaveId:id,teacherNotified:true}; },
    studentLeaves: p => M.studentLeaves.filter(l=>l.StudentID===p.studentId).sort((a,b)=>b.Date.localeCompare(a.Date)),
    comments: p => M.comments.filter(c=>c.StudentID===p.studentId),
    addComment: p => { const c={CommentID:'CM-'+(M.comments.length+1),StudentID:p.studentId,ParentID:p.parentId||'',SenderRole:p.senderRole,SenderName:p.senderName||'',Message:p.message,Timestamp:stampLocal(),ReadStatus:'unread'}; M.comments.push(c); return c; },
    // monthly bill = base items + per-student extra charges + any unpaid OT rolled over
    payments: p => M.payments.filter(b=>b.StudentID===p.studentId).map(b=>{
        const charges=M.studentCharges.filter(c=>c.StudentID===p.studentId&&c.Month===b.Month);
        // Items may be absent (sheet has no Items column) or a JSON string — normalise to an array, default to one tuition line
        let base = Array.isArray(b.Items) ? b.Items : (typeof b.Items==='string' && b.Items ? (()=>{try{return JSON.parse(b.Items)}catch(e){return null}})() : null);
        if(!Array.isArray(base)) base = [['ค่าเทอม', b.Amount||0]];
        const items=base.concat(charges.map(c=>[c.Label,c.Amount]));
        const baseAmt=b.Amount+charges.reduce((a,c)=>a+c.Amount,0);
        const otOpen=M.otDaily.filter(o=>o.StudentID===p.studentId&&o.Status!=='PAID'&&o.Date.slice(0,7)===b.Month);
        const roll=otOpen.reduce((a,o)=>a+o.Amount,0);
        return Object.assign({},b,{Items:items,Amount:baseAmt,OTRollover:roll,TotalDue:baseAmt+roll}); })
      .sort((a,b)=>b.Month.localeCompare(a.Month)),
    // per-student extra charges (Admin)
    studentCharges: p => M.studentCharges.filter(c=>c.StudentID===p.studentId && (!p.month||c.Month===p.month)),
    addStudentCharge: p => { const c={ChargeID:'CH-'+(M.studentCharges.length+1),StudentID:p.studentId,Month:p.month||todayLocal().slice(0,7),Label:p.label,Amount:Number(p.amount||0)}; M.studentCharges.push(c); return c; },
    removeStudentCharge: p => { const i=M.studentCharges.findIndex(c=>c.ChargeID===p.chargeId); if(i>=0)M.studentCharges.splice(i,1); return {ok:true}; },

    // ---- billing generation (Admin) ----
    // monthly tuition base for a student (from their Plan)
    studentBillBase: p => { const s=studentById(p.studentId)||{}; const plan=studentPlan(s); return {planId:plan.id,labelTH:plan.labelTH||'',labelEN:plan.labelEN||'',price:plan.price||0}; },
    // Admin issues a bill for one student (custom amount → mid-month proration / ad-hoc). Parent sees it; pays + Admin verifies.
    // Admin issues a bill for one student. Pass paid:true to record it as ALREADY PAID (e.g. collected in advance
    // for a future month → that month shows "ชำระแล้ว"); paidDate/method optional, defaults today/cash.
    issueBill: p => { const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน'); const month=p.month||todayLocal().slice(0,7);
      const plan=studentPlan(s); const amount=p.amount!=null?Number(p.amount):(plan.price||0);
      const label=p.label||('ค่าเทอม '+((plan&&plan.labelTH)||'')); const items=p.items||[[label,amount]];
      const paid=!!p.paid; const paidDate=p.paidDate||todayLocal(); const method=p.method||(paid?'cash':'');
      let b=M.payments.find(x=>x.StudentID===p.studentId&&x.Month===month);
      const fields={Items:items,Amount:amount,Status:paid?'PAID':'UNPAID',SlipAmount:paid?amount:0,VerifiedStatus:paid?'CONFIRMED':'',PaidDate:paid?paidDate:'',PaymentMethod:method,Note:p.note||''};
      if(b){ Object.assign(b,fields); }
      else { b=Object.assign({BillingID:'BL-'+month+'-'+p.studentId,StudentID:p.studentId,Month:month,OTRollover:0,DueDate:month+'-05',SlipUrl:'',TransactionDate:paid?stampLocal():''},fields); M.payments.push(b); }
      logAct('issueBill',b.BillingID,month+' '+amount+(paid?' (ชำระล่วงหน้า)':''),actorOf(p));
      return b; },
    // auto-generate the month's bill for all active students from Plan price (skip if already billed)
    generateMonthlyBills: p => { const month=p.month||todayLocal().slice(0,7); let created=0;
      activeStudents().forEach(s=>{ if(M.payments.find(x=>x.StudentID===s.StudentID&&x.Month===month))return; const plan=studentPlan(s);
        M.payments.push({BillingID:'BL-'+month+'-'+s.StudentID,StudentID:s.StudentID,Month:month,Items:[['ค่าเทอม '+((plan&&plan.labelTH)||''),plan.price||0]],Amount:plan.price||0,OTRollover:0,DueDate:month+'-05',PaidDate:'',Status:'UNPAID',SlipUrl:'',SlipAmount:0,VerifiedStatus:'',Auto:true}); created++; });
      return {month,created}; },
    // attach a monthly slip → goes to PENDING_VERIFY (Admin must confirm). amountMatch flags whether slip amount = due.
    uploadSlip: p => { const b=M.payments.find(x=>x.BillingID===p.billingId); if(!b)fail('NOT_FOUND','ไม่พบรายการ');
      const otOpen=M.otDaily.filter(o=>o.StudentID===b.StudentID&&o.Status!=='PAID'&&o.Date.slice(0,7)===b.Month);
      const charges=M.studentCharges.filter(c=>c.StudentID===b.StudentID&&c.Month===b.Month).reduce((a,c)=>a+c.Amount,0);
      const due=b.Amount+charges+otOpen.reduce((a,o)=>a+o.Amount,0);
      // SlipUrl: in GAS the slip image is saved to the Drive folder (SlipsFolderName) and this holds its URL; in mock it's the dataURL
      b.SlipUrl=p.slipData||p.slipName||'slip.jpg'; b.SlipName=p.slipName||''; b.SlipAmount=Number(p.slipAmount||0); b.SlipFromQR=!!p.fromQR; b.SubmittedDate=todayLocal();
      b.PaymentMethod='transfer'; b.TransactionDate=stampLocal();
      b.Status='PENDING_VERIFY'; b.VerifiedStatus= b.SlipAmount>=due?'MATCH':(b.SlipAmount>0?'UNDERPAID':'PENDING');
      logAct('uploadSlip',b.BillingID,'โอน '+b.SlipAmount,actorOf(p));
      return Object.assign({},b,{due,outstanding:Math.max(0,due-b.SlipAmount),amountMatch:b.SlipAmount>=due}); },

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

    // ---- daily OT (parent) ----
    otDaily: p => M.otDaily.filter(o=>o.StudentID===p.studentId).sort((a,b)=>b.Date.localeCompare(a.Date)),
    // attach OT slip → PENDING_VERIFY (Admin confirms)
    payOT: p => { const o=M.otDaily.find(x=>x.OTID===p.otId); if(!o)fail('NOT_FOUND','ไม่พบรายการ OT');
      o.SlipRef=p.slipData||p.slipName||'slip.jpg'; o.SlipName=p.slipName||''; o.SlipAmount=Number(p.slipAmount||0); o.SlipFromQR=!!p.fromQR; o.SubmittedDate=todayLocal();
      o.PaymentMethod='transfer'; o.TransactionDate=stampLocal();
      o.Status='PENDING_VERIFY'; o.VerifiedStatus= o.SlipAmount>=o.Amount?'MATCH':(o.SlipAmount>0?'UNDERPAID':'PENDING');
      logAct('payOT',o.OTID,'โอน '+o.SlipAmount,actorOf(p));
      return Object.assign({},o,{amountMatch:o.SlipAmount>=o.Amount}); },

    calendar: () => M.calendar.concat((M.holidays||[]).map(h=>({date:h.Date,title:(h.NameTH||h.NameEN),titleEN:(h.NameEN||h.NameTH),type:'holiday'})))
      .slice().sort((a,b)=>a.date.localeCompare(b.date)),
    announcements: () => M.announcements,

    // DSPM status for a student's current band (all items + status)
    dspmStatus: p => { const s=studentById(p.studentId); const age=p.ageMonth??ageMonths(s.DOB);
      const band=M.dspmCriteria.filter(c=>c.AgeFrom<=age&&age<=c.AgeTo).sort((a,b)=>a.ItemNo-b.ItemNo);
      if(!band.length) fail('NO_CRITERIA',`ยังไม่มีเกณฑ์สำหรับอายุ ${age} เดือน`);
      const latest=latestByItem(p.studentId);
      return {studentId:p.studentId,ageMonth:age,ageLabel:band[0].AgeLabelTH,manualUrl:cfg.DspmManualUrl,
        items:band.map(c=>({itemNo:c.ItemNo,skill:c.Skill,description:c.Description,descriptionEN:(M.dspmEN&&M.dspmEN[c.ItemNo])||'',result:latest[c.ItemNo]?latest[c.ItemNo].Result:'ยังไม่ได้รับการทดสอบ',date:latest[c.ItemNo]?latest[c.ItemNo].Date:''}))}; },

    // ---------- Teacher / staff ----------
    classList: p => { const cls=M.classes.find(c=>c.TeacherID===p.staffId)||M.classes[0];
      return {class:cls, students:activeStudents().filter(s=>s.Class===cls.ClassName).map(s=>Object.assign({ageMonth:ageMonths(s.DOB)},s))}; },
    myAttendanceToday: p => { const r=M.staffAttendanceToday.find(x=>x.StaffID===p.staffId);
      const sch=M.workSchedule.find(w=>w.StaffID===p.staffId)||{CheckInTime:cfg.DefaultCheckInTime,CheckOutTime:'17:00'};
      return {date:todayLocal(), schedule:sch, checkIn:r?r.CheckIn:'', checkOut:r?r.CheckOut:'', late:r?r.Late||0:0, status:r?r.Status:'NONE'}; },
    // today + previous working days (with late status) for the teacher work-time card
    recentAttendance: p => { const sch=M.workSchedule.find(w=>w.StaffID===p.staffId)||{CheckInTime:'08:00'};
      const lateOf=hhmm=>{ if(!hhmm)return 0; const raw=Math.max(0,toMin(hhmm)-toMin(sch.CheckInTime)); return raw<=Number(cfg.LateGraceMinutes||0)?0:raw; };
      const today=M.staffAttendanceToday.find(x=>x.StaffID===p.staffId);
      const out=[{date:todayLocal(), checkIn:today?today.CheckIn:'', checkOut:today?today.CheckOut:'', late:today?today.Late||0:0, status:today?today.Status:'NONE'}];
      M.staffAttendanceHistory.filter(h=>h.StaffID===p.staffId).sort((a,b)=>b.Date.localeCompare(a.Date)).slice(0,3)
        .forEach(h=>out.push({date:h.Date, checkIn:h.In||'', checkOut:h.Out||'', late:lateOf(h.In), status:h.In?'IN':'ABSENT'}));
      return out; },
    staffCheckin: p => { const d=geo(p.lat,p.lng); const t=new Date(); const sch=M.workSchedule.find(w=>w.StaffID===p.staffId)||{CheckInTime:'08:00'};
      // check-in within the grace window (≤LateGraceMinutes) counts as on-time
      const raw=lateVs(sch.CheckInTime,t); const late=raw<=Number(cfg.LateGraceMinutes||0)?0:raw;
      let r=M.staffAttendanceToday.find(x=>x.StaffID===p.staffId);
      if(!r){r={StaffID:p.staffId,CheckIn:'',CheckOut:'',Status:'NONE',Late:0};M.staffAttendanceToday.push(r);} r.CheckIn=timeLocal();r.Late=late;r.Status='IN';
      return {time:r.CheckIn,lateMinutes:late,rawLate:raw,distance:d}; },
    staffCheckout: p => { const d=geo(p.lat,p.lng); const t=new Date(); const sch=M.workSchedule.find(w=>w.StaffID===p.staffId)||{CheckOutTime:'17:00'};
      const ot=Math.max(0,(t.getHours()*60+t.getMinutes())-toMin(sch.CheckOutTime));
      // OT rule: ≥OTRoundUpMinutes (50) within an hour rounds up to a full hour
      let r=M.staffAttendanceToday.find(x=>x.StaffID===p.staffId); if(!r)fail('NOT_CHECKED_IN','ยังไม่ได้ลงเวลาเข้างาน'); r.CheckOut=timeLocal();r.Status='OUT';r.OTHours=otHoursRule(ot);
      return {time:r.CheckOut,otHours:r.OTHours,otMinutes:ot,distance:d}; },
    submitJournal: p => { if(!p.Mood)fail('MISSING_FIELDS','กรุณาเลือกอารมณ์ (Mood)');
      const i=M.journals.findIndex(x=>x.StudentID===p.studentId&&x.Date===(p.date||todayLocal()));
      const rec=Object.assign({Date:p.date||todayLocal(),TeacherID:p.staffId},p); delete rec.staffId;
      if(i>=0){M.journals[i]=rec;return{updated:true};} M.journals.push(rec); return{updated:false}; },
    dspmCriteria: p => H.dspmStatus(p),
    submitAssessment: p => { const s=studentById(p.studentId); const age=ageMonths(s.DOB); const id='DA-'+String(Date.now()).slice(-4); let n=0;
      p.results.forEach(r=>{ if(r.result==='nottested'){ // remove any existing latest for this item (mark not tested)
          M.assessments=M.assessments.filter(a=>!(a.StudentID===p.studentId&&a.ItemNo===r.itemNo)); return; }
        const norm=(r.result==='pass'||r.result==='ผ่าน')?'ผ่าน':(r.result==='fail'||r.result==='ไม่ผ่าน')?'ไม่ผ่าน':null; if(!norm)return;
        const sk=(M.dspmCriteria.find(c=>c.ItemNo===r.itemNo)||{}).Skill||'';
        M.assessments.push({AssessmentID:id,StudentID:p.studentId,AgeMonth:age,ItemNo:r.itemNo,Skill:sk,Result:norm,Date:todayLocal(),TeacherID:p.staffId}); n++; });
      return {assessmentId:id,saved:n}; },
    studentAssessment: p => { const sum=summarize(p.studentId); sum.items=Object.values(latestByItem(p.studentId)).map(r=>({itemNo:r.ItemNo,skill:r.Skill,result:r.Result,date:r.Date})).sort((a,b)=>a.itemNo-b.itemNo); return sum; },
    // all bands the child has reached (enroll age -> now), each band with items + status
    studentAllBands: p => { const s=studentById(p.studentId); const age=ageMonths(s.DOB); const latest=latestByItem(p.studentId);
      const bands={}; M.dspmCriteria.filter(c=>c.AgeFrom<=age).forEach(c=>{ (bands[c.AgeLabelTH]=bands[c.AgeLabelTH]||{label:c.AgeLabelTH,from:c.AgeFrom,items:[]}).items.push({itemNo:c.ItemNo,skill:c.Skill,description:c.Description,descriptionEN:(M.dspmEN&&M.dspmEN[c.ItemNo])||'',result:latest[c.ItemNo]?latest[c.ItemNo].Result:'ยังไม่ได้รับการทดสอบ'}); });
      return {studentId:p.studentId,name:s.NameTH,nameEN:s.NameEN,ageMonth:age,enrollDate:s.EnrollDate,
        bands:Object.values(bands).sort((a,b)=>a.from-b.from)}; },

    myLeaves: p => M.leaves.filter(l=>l.StaffID===p.staffId),
    teamPendingLeaves: p => { const me=staffById(p.staffId); if(me.PositionLevel!=='Leader'&&me.PositionLevel!=='Admin')return [];
      return M.leaves.filter(l=>l.Status==='PENDING_LEADER'); },
    leaveQuota: p => { const used=M.leaveUsed[p.staffId]||{}; const q=cfg.LeaveQuota;
      return Object.keys(q).map(t=>({type:t,quota:q[t],used:used[t]||0,remain:q[t]-(used[t]||0)})); },
    submitLeave: p => { const st=staffById(p.staffId); const id='LV2026-'+String(M.leaves.length+1).padStart(3,'0');
      // leave entitlement does not carry across the year — a request may not span 31 Dec → next year
      if(String(p.startDate).slice(0,4)!==String(p.endDate).slice(0,4)) fail('CROSS_YEAR','ใช้สิทธิลาข้ามปีไม่ได้ — กรุณาแยกใบลาภายในปีเดียวกัน');
      const lead=(st.PositionLevel==='Leader'||st.PositionLevel==='Admin'); const days=Math.floor((new Date(p.endDate)-new Date(p.startDate))/864e5)+1;
      M.leaves.push({LeaveID:id,StaffID:p.staffId,Department:st.Department,Type:p.type,StartDate:p.startDate,EndDate:p.endDate,Days:days,Reason:p.reason,Status:lead?'PENDING_ADMIN':'PENDING_LEADER',Step1ApproverName:'',Step1Status:lead?'Skipped':'Pending',Step1CrossDept:'',Step2ApproverName:'',Step2Status:'Pending',CreatedDate:todayLocal()});
      return {leaveId:id,status:lead?'PENDING_ADMIN':'PENDING_LEADER',days}; },
    approveLeave: p => { const ap=staffById(p.staffId); const l=M.leaves.find(x=>x.LeaveID===p.leaveId); if(!l)fail('NOT_FOUND','ไม่พบคำขอ'); const yes=p.decision==='approve';
      if(l.Status==='PENDING_LEADER'){ if(ap.PositionLevel!=='Leader'&&ap.PositionLevel!=='Admin')fail('NO_PERMISSION','เฉพาะหัวหน้างาน'); l.Step1ApproverName=ap.NameTH;l.Step1Status=yes?'Approved':'Rejected';l.Step1CrossDept=(ap.Department!==l.Department)?'YES':'NO';l.Status=yes?'PENDING_ADMIN':'REJECTED'; return {status:l.Status,crossDept:l.Step1CrossDept==='YES'}; }
      if(l.Status==='PENDING_ADMIN'){ if(ap.PositionLevel!=='Admin')fail('NO_PERMISSION','เฉพาะผู้บังคับบัญชา'); l.Step2ApproverName=ap.NameTH;l.Step2Status=yes?'Approved':'Rejected';l.Status=yes?'APPROVED':'REJECTED'; return {status:l.Status}; }
      fail('ALREADY_RESOLVED','คำขอนี้ดำเนินการแล้ว'); },
    schedule: () => ({ staff:M.staff.filter(s=>s.Role==='Teacher'), schedule:M.workSchedule,
      leavesToday: M.leaves.filter(l=>l.Status==='APPROVED'), attendance:M.staffAttendanceToday,
      history:M.staffAttendanceHistory, duty:M.dutyRoster, staffing:H.staffingByNursery() }),
    // present-staff / total-staff per Nursery for the daily summary (e.g. "Nursery 1 2/2")
    staffingByNursery: () => (cfg.Departments||[]).filter(d=>d).map(dep=>{
      const team=M.staff.filter(s=>s.Department===dep&&s.Role==='Teacher');
      const present=team.filter(s=>{ const a=M.staffAttendanceToday.find(x=>x.StaffID===s.StaffID); return a&&(a.Status==='IN'||a.Status==='OUT'); }).length;
      return {dept:dep, present, total:team.length}; }).filter(x=>x.total>0),

    payrollConfig: p => Object.assign({SocialSecurityDeduct:true,ChildThreshold:cfg.ExtraChildThreshold||31,ChildMultiplier:cfg.ExtraChildRate,TaxDeduct:false}, M.payrollConfig[p.staffId]||{}),
    setPayrollConfig: p => { M.payrollConfig[p.staffId]=Object.assign(M.payrollConfig[p.staffId]||{},p.config||{}); return M.payrollConfig[p.staffId]; },
    computePayroll: p => { const st=staffById(p.staffId); const pc=Object.assign({PayType:'monthly',DailyRate:0,SocialSecurityDeduct:true,ChildMultiplier:cfg.ExtraChildRate,TaxDeduct:false}, M.payrollConfig[p.staffId]||{});
      // base = monthly salary, OR daily-rate × days worked (new/special teachers)
      const payType=p.payType||pc.PayType||'monthly'; const dailyRate=p.dailyRate!=null?Number(p.dailyRate):pc.DailyRate; const daysWorked=Number(p.daysWorked||0);
      const base= payType==='daily' ? dailyRate*daysWorked : (p.baseSalary!=null?Number(p.baseSalary):(st.BaseSalary||0));
      // diligence amounts: per-staff override (payrollConfig) → else global config
      const attendAmt=p.diligenceAttend!=null?Number(p.diligenceAttend):(pc.DiligenceAttendanceAmount!=null?pc.DiligenceAttendanceAmount:cfg.DiligenceAttendanceAmount);
      const fbAmt=p.diligenceFb!=null?Number(p.diligenceFb):(pc.DiligenceFacebookAmount!=null?pc.DiligenceFacebookAmount:cfg.DiligenceFacebookAmount);
      const dA=p.attendanceEligible!==false?attendAmt:0; const dF=p.facebookPosted?fbAmt:0; const dT=dA+dF;
      const childMult=p.childMultiplier!=null?Number(p.childMultiplier):pc.ChildMultiplier;
      // child-rate count is AUTO from the DB unless overridden: children from #ChildThreshold onward
      const threshold=p.childThreshold!=null?Number(p.childThreshold):(pc.ChildThreshold||cfg.ExtraChildThreshold||31);
      const ratedTotal=H.ratedChildCount().rated; const autoChild=Math.max(0, ratedTotal-(threshold-1));
      const childCount=p.extraChildCount!=null?Math.max(0,p.extraChildCount):autoChild;
      const ec=childCount*childMult; const tc=Math.min(cfg.TrainingCertMaxPerMonth,Math.max(0,p.trainingCertCount||0))*cfg.TrainingCertRate;
      const oi=ec+tc+(p.otherIncome||0); const ot=p.otEvening||0; const hb=p.holidayBonus||0; const gross=base+dT+oi+ot+hb;
      // signed adjustment lines (e.g. {label:'มาสาย',amount:-200}); applied directly to net
      const adj=Array.isArray(p.adjustments)?p.adjustments:[]; const adjSum=adj.reduce((a,x)=>a+Number(x.amount||0),0);
      const ssDeduct=(p.socialSecurityDeduct!=null?p.socialSecurityDeduct:pc.SocialSecurityDeduct)!==false;
      const ss=p.socialSecurity!=null?p.socialSecurity:(ssDeduct?Math.min(Math.round(base*cfg.SocialSecurityRate),cfg.SocialSecurityMax):0);
      const dd=(p.contribution||0)+(p.otherDeductions||0); const total=ss+dd; const net=gross-total+adjSum;
      const rec={PayrollID:'PR-'+String(M.payroll.length+1).padStart(4,'0'),StaffID:p.staffId,Month:p.month,PayType:payType,DailyRate:dailyRate,DaysWorked:daysWorked,BaseSalary:base,DiligenceAttendance:dA,DiligenceFacebook:dF,DiligenceTotal:dT,ExtraChildAmount:ec,ChildCount:childCount,ChildThreshold:threshold,RatedTotal:ratedTotal,ChildMultiplier:childMult,TrainingCertAmount:tc,OTEvening:ot,HolidayBonus:hb,OtherIncome:oi,GrossIncome:gross,SocialSecurity:ss,Contribution:p.contribution||0,OtherDeductions:p.otherDeductions||0,TotalDeductions:total,Adjustments:adj,AdjustmentsTotal:adjSum,NetPay:net,BankAccount:cfg.BankName};
      const i=M.payroll.findIndex(x=>x.StaffID===p.staffId&&x.Month===p.month); if(i>=0)M.payroll[i]=rec; else M.payroll.push(rec); return rec; },
    getPayslip: p => M.payroll.find(x=>x.StaffID===p.staffId&&x.Month===p.month) || null,
    // Admin alert: payroll should be summarized 1 day before month-end
    payrollReminderDue: () => { const n=new Date(); const last=new Date(n.getFullYear(),n.getMonth()+1,0).getDate();
      return {due:n.getDate()===last-1, today:n.getDate(), lastDay:last, month:todayLocal().slice(0,7)}; },

    // Admin finance dashboard: tuition collection per student + salary payout per teacher + income/expense
    financeSummary: p => { const month=p.month||todayLocal().slice(0,7);
      const students=activeStudents().map(s=>{ const b=M.payments.find(x=>x.StudentID===s.StudentID&&x.Month===month);
        const otOpen=M.otDaily.filter(o=>o.StudentID===s.StudentID&&o.Date.slice(0,7)===month&&o.Status!=='PAID').reduce((a,o)=>a+o.Amount,0);
        const due=(b?b.Amount:0)+otOpen; const paid=b&&b.Status==='PAID';
        return {studentId:s.StudentID,name:s.NameTH,nameEN:s.NameEN,plan:s.Plan,amount:b?b.Amount:0,otOpen,due,paid,status:b?b.Status:'NO_BILL',slipAmount:b?b.SlipAmount||0:0}; });
      const staff=M.staff.filter(s=>s.Role==='Teacher').map(s=>{ const pr=M.payroll.find(x=>x.StaffID===s.StaffID&&x.Month===month);
        return {staffId:s.StaffID,name:s.NameTH,nameEN:s.NameEN,net:pr?pr.NetPay:0,paid:!!pr&&pr.SlipSent==='YES',computed:!!pr}; });
      const tuitionCollected=students.filter(s=>s.paid).reduce((a,s)=>a+s.amount,0);
      const otCollected=M.otDaily.filter(o=>o.Date.slice(0,7)===month&&o.Status==='PAID').reduce((a,o)=>a+o.Amount,0);
      const tuitionOutstanding=students.filter(s=>!s.paid).reduce((a,s)=>a+s.due,0);
      const salaryExpense=staff.reduce((a,s)=>a+s.net,0);
      const income=tuitionCollected+otCollected;
      return {month, students, staff, income, tuitionCollected, otCollected, tuitionOutstanding, expense:salaryExpense, net:income-salaryExpense,
        studentsPaid:students.filter(s=>s.paid).length, studentsTotal:students.length,
        staffPaid:staff.filter(s=>s.computed).length, staffTotal:staff.length}; },

    // ---------- Admin ----------
    dashboard: () => { const cls=M.classes.map(c=>{ const studs=activeStudents().filter(s=>s.Class===c.ClassName);
        const stat=studs.map(s=>{ const a=M.studentAttendanceToday.find(x=>x.StudentID===s.StudentID); return {name:s.NameTH,nameEN:s.NameEN, status:a?a.Status:'ABSENT', reason:a?a.Reason:''}; });
        return {className:c.ClassName,total:studs.length,in:stat.filter(s=>s.status==='IN').length,out:stat.filter(s=>s.status==='OUT').length,leave:stat.filter(s=>s.status==='LEAVE').length,absent:stat.filter(s=>s.status==='ABSENT').length,students:stat}; });
      const staffStat=M.staff.filter(s=>s.Role==='Teacher').map(s=>{ const a=M.staffAttendanceToday.find(x=>x.StaffID===s.StaffID)||{};
        const onLeave=a.Status==='LEAVE'; return {name:s.NameTH,nameEN:s.NameEN,dept:s.Department, status:a.Status||'ABSENT',
          checkIn:onLeave?'':(a.CheckIn||''), checkOut:onLeave?'':(a.CheckOut||''), late:onLeave?0:(a.Late||0), remark:onLeave?(a.Reason||'ลา'):''}; });
      return {classes:cls, staff:staffStat, pendingLeaves:M.leaves.filter(l=>l.Status.startsWith('PENDING')).length}; },
    pendingLeaves: p => { const lv=staffById(p.staffId).PositionLevel; if(lv==='Admin')return M.leaves.filter(l=>l.Status==='PENDING_ADMIN'); if(lv==='Leader')return M.leaves.filter(l=>l.Status==='PENDING_LEADER'); fail('NO_PERMISSION','ตำแหน่งนี้ไม่มีสิทธิ์อนุมัติ'); },
    listStaff: () => M.staff.map(s=>Object.assign({RequireCheckin: s.RequireCheckin!==false}, s)),
    setRequireCheckin: p => { const s=M.staff.find(x=>x.StaffID===p.staffId); if(s) s.RequireCheckin=!!p.value; return {staffId:p.staffId, value:!!p.value}; },
    listStudents: () => activeStudents().map(s=>Object.assign({ageMonth:ageMonths(s.DOB)},s)),
    listClasses: () => M.classes,
    classAssessment: p => { const ss=M.students.filter(s=>s.Class===p.className); const per=ss.map(s=>{const x=summarize(s.StudentID);return{studentId:s.StudentID,name:s.NameTH,nameEN:s.NameEN,ageMonth:x.ageMonth,pass:x.totalPass,fail:x.totalFail};});
      const pass=per.reduce((a,b)=>a+b.pass,0),fl=per.reduce((a,b)=>a+b.fail,0); return {class:p.className,studentCount:ss.length,passRate:(pass+fl)?Math.round(pass/(pass+fl)*100):0,perStudent:per}; },
    addAnnouncement: p => { const a={AnnID:'ANN-'+(M.announcements.length+1),Title:p.title,TitleEN:p.titleEN||'',Content:p.content,ContentEN:p.contentEN||'',Image:p.image||'',Date:todayLocal(),Type:p.type||'news',TargetGroup:p.target||'all',Popup:!!p.popup,StartDate:p.startDate||todayLocal(),EndDate:p.endDate||''}; M.announcements.unshift(a); return a; },
    editAnnouncement: p => { const a=M.announcements.find(x=>x.AnnID===p.annId); if(!a)fail('NOT_FOUND','ไม่พบประกาศ');
      ['Title','TitleEN','Content','ContentEN','Popup','StartDate','EndDate'].forEach(k=>{ const kk=k.charAt(0).toLowerCase()+k.slice(1); if(p[kk]!==undefined)a[k]=p[kk]; });
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
    registerNew: p => { const sid='STD-'+String(M.students.length+1).padStart(3,'0'); const pid='PAR-'+String(M.parents.length+1).padStart(3,'0');
      const st=Object.assign({StudentID:sid,ParentID:pid,Status:'ACTIVE',CreatedDate:todayLocal(),EnrollDate:todayLocal(),LastGrowthUpdate:''}, p.student||{});
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
    registerParent: p => { const pid='PAR-'+String(M.parents.length+1).padStart(3,'0');
      const par=Object.assign({ParentID:pid,LineUID:p.uid||''}, p.parent||{});
      if(par.Photo) par.RegisterPhotoUrl=registerPhotoUrl(pid); // mandatory live-capture ID photo → "New Register Photo" Drive folder
      M.parents.push(par);
      logAct('registerParent',pid,par.NameTH||pid,{role:'Parent',id:pid,name:par.NameTH||pid});
      return {parentId:pid}; },
    // add a NEW child under an existing parent + link to this user (no parent re-entry)
    addChildNew: p => { const sid='STD-'+String(M.students.length+1).padStart(3,'0');
      const st=Object.assign({StudentID:sid,ParentID:p.parentId||'',Status:'ACTIVE',CreatedDate:todayLocal(),EnrollDate:todayLocal(),LastGrowthUpdate:''}, p.student||{});
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
      const id='STF-'+String(M.staff.length+1).padStart(2,'0'); const rec=Object.assign({StaffID:id,Role:'Teacher',Status:'ACTIVE'},d); M.staff.push(rec); return rec; },
    deleteStaff: p => { const i=M.staff.findIndex(s=>s.StaffID===p.staffId); if(i<0)fail('NOT_FOUND','ไม่พบพนักงาน'); M.staff.splice(i,1); return {ok:true}; },
    listParents: () => M.parents,
    saveParent: p => { const d=p.data||{};
      if(p.parentId){ const pa=M.parents.find(x=>x.ParentID===p.parentId); if(!pa)fail('NOT_FOUND','ไม่พบผู้ปกครอง'); Object.assign(pa,d); return pa; }
      const id='PAR-'+String(M.parents.length+1).padStart(3,'0'); const rec=Object.assign({ParentID:id},d); M.parents.push(rec); return rec; },
    deleteParent: p => { const i=M.parents.findIndex(x=>x.ParentID===p.parentId); if(i<0)fail('NOT_FOUND','ไม่พบผู้ปกครอง'); M.parents.splice(i,1); return {ok:true}; },
    saveStudent: p => { const d=p.data||{}; const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน'); Object.assign(s,d); return s; },

    holidays: () => M.holidays.slice().sort((a,b)=>a.Date.localeCompare(b.Date)),
    addHoliday: p => { M.holidays.push({Date:p.date,NameTH:p.nameTH||p.nameEN||'',NameEN:p.nameEN||p.nameTH||'',Recurring:!!p.recurring}); return {ok:true}; },
    removeHoliday: p => { const i=M.holidays.findIndex(h=>h.Date===p.date&&(h.NameTH===p.nameTH||!p.nameTH)); if(i>=0)M.holidays.splice(i,1); return {ok:true}; },

    // ---- vaccines ----
    vaccineSchedule: () => M.vaccineSchedule,
    studentVaccines: p => M.vaccineRecords.filter(v=>v.StudentID===p.studentId),
    setVaccine: p => { let v=M.vaccineRecords.find(x=>x.StudentID===p.studentId&&x.Key===p.key);
      if(!v){ v={StudentID:p.studentId,Key:p.key}; M.vaccineRecords.push(v); } v.Date=p.date||todayLocal(); return v; },
    removeVaccine: p => { const i=M.vaccineRecords.findIndex(x=>x.StudentID===p.studentId&&x.Key===p.key); if(i>=0)M.vaccineRecords.splice(i,1); return {ok:true}; },

    // ---- absence tracking + rate rule ----
    // students with total absence (leave+no-show) >= minDays, with follow-up note/status
    absenceReport: p => { const min=p.minDays||2;
      const byStu={}; M.absenceLog.forEach(a=>{ (byStu[a.StudentID]=byStu[a.StudentID]||[]).push(a); });
      return activeStudents().map(s=>{ const days=(byStu[s.StudentID]||[]); const fu=M.absenceFollowups.find(f=>f.StudentID===s.StudentID)||{};
          return {studentId:s.StudentID,name:s.NameTH,nameEN:s.NameEN,class:s.Class,count:days.length,
            reasons:[...new Set(days.map(d=>d.Reason).filter(Boolean))].join(', '),
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

    // ========== withdrawal / cancel enrolment (parent self-service + Admin direct) ==========
    // valid reason codes (config-driven): graduated | moved | transferred | other
    withdrawReasons: () => (cfg.WithdrawReasons||['graduated','moved','transferred','other']).slice(),
    // parent requests withdrawal — creates a PENDING request (Admin processes it later). Student stays ACTIVE meanwhile.
    requestWithdrawal: p => { const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน');
      if(!p.reason)fail('MISSING','กรุณาเลือกเหตุผล');
      if(p.reason==='other'&&!String(p.detail||'').trim())fail('MISSING','กรุณาระบุเหตุผลอื่น ๆ');
      const id='WD-'+String(M.withdrawals.length+1).padStart(3,'0'); const by=actorOf(p);
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
      else { const id='WD-'+String(M.withdrawals.length+1).padStart(3,'0'); M.withdrawals.push({WithdrawID:id,StudentID:p.studentId,RequestedBy:by.id,RequesterRole:by.role||'Admin',Reason:p.reason,Detail:p.detail||'',EffectiveDate:todayLocal(),Status:'DONE',ProcessedBy:by.name||by.id,ProcessedDate:todayLocal(),CreatedDate:todayLocal()}); }
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

    // ========== departments (Nursery) ==========
    listDepartments: () => (cfg.Departments||[]).slice(),
    addDepartment: p => { const n=(p.name||'').trim(); if(!n)fail('MISSING','ใส่ชื่อแผนก'); if(cfg.Departments.indexOf(n)>=0)fail('DUP','มีแผนกนี้แล้ว');
      cfg.Departments.push(n); if(!M.classes.find(c=>c.ClassName===n)) M.classes.push({ClassID:'CL'+(M.classes.length+1),ClassName:n,TeacherID:'',AgeRange:'',Capacity:15}); return {ok:true}; },
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
    leaveResetReminder: () => { const n=new Date(); return {due:n.getMonth()===0, month:n.getMonth()+1, year:n.getFullYear()}; }, // every January
    // verify the teacher OT computation across the attendance history (schedule out vs actual out)
    otVerification: p => { const rows=M.staffAttendanceHistory.filter(h=>!p.staffId||h.StaffID===p.staffId).filter(h=>h.Out);
      return rows.map(h=>{ const sch=M.workSchedule.find(w=>w.StaffID===h.StaffID)||{CheckOutTime:'17:00'};
        const min=Math.max(0,toMin(h.Out)-toMin(sch.CheckOutTime)); return {date:h.Date,staffId:h.StaffID,out:h.Out,schedOut:sch.CheckOutTime,otMinutes:min,otHours:otHoursRule(min)}; }); },
    // sum a staff's OT hours for a month (auto-pulled into payroll); amount = hours × StaffOTHourlyRate
    staffMonthlyOT: p => { const sch=M.workSchedule.find(w=>w.StaffID===p.staffId)||{CheckOutTime:'17:00'};
      const rows=M.staffAttendanceHistory.filter(h=>h.StaffID===p.staffId&&h.Out&&(!p.month||h.Date.slice(0,7)===p.month));
      const hours=rows.reduce((a,h)=>a+otHoursRule(Math.max(0,toMin(h.Out)-toMin(sch.CheckOutTime))),0);
      const rate=Number(cfg.StaffOTHourlyRate||cfg.OTRatePerHour||100); return {staffId:p.staffId,month:p.month,hours,rate,amount:hours*rate,days:rows.length}; },

    // ========== prepayment (advance tuition with discount) ==========
    // months: 2→5%, 3→10%, 6→20%, 12→30%
    prepayDiscount: m => ({2:5,3:10,6:20,12:30}[m]||0),
    // create a PENDING prepay charge (summarized on the payment screen) — paid via QR + slip like the monthly bill
    prepay: p => { const s=studentById(p.studentId); if(!s)fail('NOT_FOUND','ไม่พบนักเรียน');
      const months=Number(p.months); const disc=H.prepayDiscount(months); const plan=studentPlan(s); const monthly=plan.price||0;
      const gross=monthly*months; const amount=Math.round(gross*(100-disc)/100);
      const start=p.startMonth||todayLocal().slice(0,7); const covered=[]; let [y,mo]=start.split('-').map(Number);
      for(let i=0;i<months;i++){ covered.push(y+'-'+String(mo).padStart(2,'0')); mo++; if(mo>12){mo=1;y++;} }
      const rec={PrepayID:'PP-'+(M.prepayments.length+1),StudentID:p.studentId,Months:months,Discount:disc,Gross:gross,Amount:amount,Covered:covered,Status:'UNPAID',SlipUrl:'',SlipAmount:0,Date:todayLocal()};
      M.prepayments.push(rec); return rec; },
    // attach prepay slip → PENDING_VERIFY (Admin confirms)
    payPrepay: p => { const pp=M.prepayments.find(x=>x.PrepayID===p.prepayId); if(!pp)fail('NOT_FOUND','ไม่พบรายการชำระล่วงหน้า');
      pp.SlipUrl=p.slipData||p.slipName||'slip.jpg'; pp.SlipName=p.slipName||''; pp.SlipAmount=Number(p.slipAmount||0); pp.SlipFromQR=!!p.fromQR; pp.SubmittedDate=todayLocal();
      pp.PaymentMethod='transfer'; pp.TransactionDate=stampLocal();
      pp.Status='PENDING_VERIFY'; pp.VerifiedStatus= pp.SlipAmount>=pp.Amount?'MATCH':(pp.SlipAmount>0?'UNDERPAID':'PENDING');
      logAct('payPrepay',pp.PrepayID,'โอน '+pp.SlipAmount,actorOf(p));
      return Object.assign({},pp,{amountMatch:pp.SlipAmount>=pp.Amount}); },
    cancelPrepay: p => { const i=M.prepayments.findIndex(x=>x.PrepayID===p.prepayId); if(i>=0&&M.prepayments[i].Status==='UNPAID')M.prepayments.splice(i,1); return {ok:true}; },
    prepayments: p => M.prepayments.filter(x=>x.StudentID===p.studentId),

    // ---- Admin payment verification (confirm slips) ----
    pendingPayments: () => { const nm=id=>{ const s=studentById(id)||{}; return {name:s.NameTH,nameEN:s.NameEN}; };
      const bills=M.payments.filter(b=>b.Status==='PENDING_VERIFY').map(b=>{ const otOpen=M.otDaily.filter(o=>o.StudentID===b.StudentID&&o.Status==='PAID'?false:o.Date.slice(0,7)===b.Month&&o.Status!=='PAID'); const charges=M.studentCharges.filter(c=>c.StudentID===b.StudentID&&c.Month===b.Month).reduce((a,c)=>a+c.Amount,0); const due=b.Amount+charges+otOpen.reduce((a,o)=>a+o.Amount,0);
        return Object.assign({kind:'bill',id:b.BillingID,studentId:b.StudentID,label:b.Month,due,slipAmount:b.SlipAmount,slip:b.SlipUrl,match:b.SlipAmount>=due,fromQR:!!b.SlipFromQR,method:b.PaymentMethod||'transfer',transactionDate:b.TransactionDate||''},nm(b.StudentID)); });
      const ots=M.otDaily.filter(o=>o.Status==='PENDING_VERIFY').map(o=>Object.assign({kind:'ot',id:o.OTID,studentId:o.StudentID,label:o.Date+' OT',due:o.Amount,slipAmount:o.SlipAmount,slip:o.SlipRef,match:o.SlipAmount>=o.Amount,fromQR:!!o.SlipFromQR,method:o.PaymentMethod||'transfer',transactionDate:o.TransactionDate||''},nm(o.StudentID)));
      const pps=M.prepayments.filter(x=>x.Status==='PENDING_VERIFY').map(pp=>Object.assign({kind:'prepay',id:pp.PrepayID,studentId:pp.StudentID,label:pp.Months+'mo ('+pp.Covered[0]+'→'+pp.Covered[pp.Covered.length-1]+')',due:pp.Amount,slipAmount:pp.SlipAmount,slip:pp.SlipUrl,match:pp.SlipAmount>=pp.Amount,fromQR:!!pp.SlipFromQR,method:pp.PaymentMethod||'transfer',transactionDate:pp.TransactionDate||''},nm(pp.StudentID)));
      return bills.concat(ots,pps); },
    // Admin confirms a payment. paidDate = the actual payment date (defaults today); recorded for retro audit.
    confirmPayment: p => { const paid=p.paidDate||todayLocal(); const method=p.method||'';
      if(p.kind==='bill'){ const b=M.payments.find(x=>x.BillingID===p.id); if(!b)fail('NOT_FOUND','ไม่พบบิล'); b.Status='PAID'; b.PaidDate=paid; if(method)b.PaymentMethod=method; b.VerifiedStatus='CONFIRMED'; b.VerifiedBy=p.adminId||'admin';
        M.otDaily.filter(o=>o.StudentID===b.StudentID&&o.Date.slice(0,7)===b.Month&&o.Status!=='PAID').forEach(o=>{o.Status='PAID';o.SlipRef=b.SlipUrl;o.PaidDate=paid;}); logAct('confirmPayment',b.BillingID,'ยืนยัน ('+(b.PaymentMethod||'transfer')+') '+b.SlipAmount+' จ่าย '+paid,actorOf(p)); return b; }
      if(p.kind==='ot'){ const o=M.otDaily.find(x=>x.OTID===p.id); if(!o)fail('NOT_FOUND','ไม่พบ OT'); o.Status='PAID'; o.PaidDate=paid; if(method)o.PaymentMethod=method; o.VerifiedStatus='CONFIRMED'; logAct('confirmPayment',o.OTID,'ยืนยัน ('+(o.PaymentMethod||'transfer')+') '+o.Amount+' จ่าย '+paid,actorOf(p)); return o; }
      if(p.kind==='prepay'){ const pp=M.prepayments.find(x=>x.PrepayID===p.id); if(!pp)fail('NOT_FOUND','ไม่พบรายการ'); pp.Status='PAID'; pp.PaidDate=paid; if(method)pp.PaymentMethod=method; pp.VerifiedBy=p.adminId||'admin';
        M.payments.forEach(b=>{ if(b.StudentID===pp.StudentID&&pp.Covered.indexOf(b.Month)>=0){ b.Status='PAID'; b.PaidDate=paid; b.VerifiedStatus='PREPAID'; } }); logAct('confirmPayment',pp.PrepayID,'ยืนยันชำระล่วงหน้า ('+(pp.PaymentMethod||'transfer')+') '+pp.Amount+' จ่าย '+paid,actorOf(p)); return pp; }
      fail('BAD_KIND','ไม่ทราบประเภท'); },
    rejectPayment: p => {
      if(p.kind==='bill'){ const b=M.payments.find(x=>x.BillingID===p.id); if(b){b.Status='UNPAID';b.VerifiedStatus='REJECTED';b.SlipAmount=0;} }
      if(p.kind==='ot'){ const o=M.otDaily.find(x=>x.OTID===p.id); if(o){o.Status='UNPAID';o.VerifiedStatus='REJECTED';o.SlipAmount=0;} }
      if(p.kind==='prepay'){ const pp=M.prepayments.find(x=>x.PrepayID===p.id); if(pp){pp.Status='UNPAID';pp.VerifiedStatus='REJECTED';pp.SlipAmount=0;} }
      return {ok:true}; },

    // ========== announcements (popup + date range) ==========
    activeAnnouncements: () => { const today=todayLocal();
      return M.announcements.filter(a=>a.Popup && (!a.StartDate||a.StartDate<=today) && (!a.EndDate||a.EndDate>=today)); },

    // ========== injury / accident report (teacher / leader) ==========
    // file an individual injury report; pushes an Admin+Leader notification + activity-log row.
    submitInjury: p => { const s=studentById(p.studentId)||{};
      if(!p.studentId)fail('MISSING','กรุณาเลือกเด็กที่บาดเจ็บ');
      if(!Array.isArray(p.injuryTypes)||!p.injuryTypes.length)fail('MISSING','กรุณาเลือกชนิดการบาดเจ็บอย่างน้อย 1 ข้อ');
      const id='INJ-'+todayLocal().replace(/-/g,'')+'-'+String(M.injuryReports.length+1).padStart(2,'0');
      const rec={InjuryID:id,Date:p.date||todayLocal(),Time:p.time||timeLocal(),CenterName:p.centerName||cfg.SchoolName||'',
        AffiliationType:p.affiliationType||'',AffiliationOther:p.affiliationOther||'',District:p.district||'',
        RecorderName:p.recorderName||'',StudentID:p.studentId,ChildName:s.NameTH||p.childName||'',Sex:s.Gender||p.sex||'',
        AgeYears:p.ageYears!=null?p.ageYears:(s.DOB?Math.floor(ageMonths(s.DOB)/12):''),AgeMonths:p.ageMonths!=null?p.ageMonths:(s.DOB?ageMonths(s.DOB)%12:''),
        EduStatus:p.eduStatus||'',EduGrade:p.eduGrade||'',Narrative:p.narrative||'',CauseObject:p.causeObject||'',
        Witness:p.witness||'',Place:p.place||'',PlaceOther:p.placeOther||'',InjuryTypes:p.injuryTypes,TeacherID:p.staffId||'',CreatedDate:todayLocal()};
      M.injuryReports.push(rec);
      const nm=s.NameTH||p.childName||p.studentId;
      M.feed.unshift({id:'INJ-N'+M.injuryReports.length,text:'⚠️ บันทึกอุบัติเหตุ: '+nm+' ('+rec.InjuryTypes.length+' รายการ)',
        textEN:'⚠️ Injury logged: '+(s.NameEN||nm)+' ('+rec.InjuryTypes.length+' item(s))',time:rec.Time,roles:['Admin','Leader'],read:false,studentId:p.studentId});
      logAct('submitInjury',p.studentId,nm+' — types '+rec.InjuryTypes.join(','),actorOf(p));
      return {injuryId:id}; },
    // injury reports (Admin/teacher), optional date filter; newest first
    injuryReports: p => M.injuryReports.filter(r=>!p||!p.date||r.Date===p.date)
      .map(r=>{ const s=studentById(r.StudentID)||{}; return Object.assign({nameEN:s.NameEN,className:s.Class},r); })
      .sort((a,b)=>(b.Date+b.Time).localeCompare(a.Date+a.Time)),

    // ========== PCHI insurance member form ==========
    insuranceOptions: () => Object.assign({}, cfg.Insurance||{}),
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
      const rec=Object.assign({InsuranceID:'INS-'+String(M.insurancePCHI.length+1).padStart(3,'0')}, d, base,
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
      const lateStaff=d.staff.filter(s=>s.late>0).map(s=>({name:s.name,nameEN:s.nameEN,late:s.late}));
      const totals=d.classes.reduce((a,c)=>({in:a.in+c.in,out:a.out+c.out,leave:a.leave+c.leave,absent:a.absent+c.absent,total:a.total+c.total}),{in:0,out:0,leave:0,absent:0,total:0});
      const injuries=H.injuryReports({date:todayLocal()}); // today's injuries → shown + flagged in the report
      return {date:todayLocal(), classes:d.classes, totals, lateStaff, absent2:abs2, absent5:abs5, injuries}; },
  };

  return { H: H, ageMonths: ageMonths };
}

// Make available to GAS global scope (no-op in the browser where it's already global via <script>).
if (typeof module !== 'undefined' && module.exports) module.exports = { createAtomAPI };
