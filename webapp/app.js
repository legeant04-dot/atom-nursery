/* app.js — UI shell + 3 portals on the mock API (revamped). */
(function () {
  const $ = s => document.querySelector(s);
  const app = $('#app'), nav = $('#bottomnav');
  const baht = n => (Number(n)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const esc = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const p2 = n => String(n).padStart(2,'0');
  const todayStr = () => { const d=new Date(); return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate()); };
  const monthStr = () => todayStr().slice(0,7);
  const nowTime = () => { const d=new Date(); return p2(d.getHours())+':'+p2(d.getMinutes()); };
  const initialEN = name => { let s=String(name||'?').replace(/^(Ms\.|Mr\.|Mrs\.|Miss|Master)\s*/i,'').trim(); const m=s.match(/[A-Za-z]/); return (m?m[0]:s[0]||'?').toUpperCase(); };
  const nm = o => o ? (LANG()==='en' ? (o.NameEN||o.NameTH||'') : (o.NameTH||o.NameEN||'')) : '';
  // language-aware nickname (EN nickname shown in English mode, Thai otherwise)
  const nick = o => o ? (LANG()==='en' ? (o.NicknameEN||o.Nickname||'') : (o.Nickname||o.NicknameEN||'')) : '';
  const dn = o => o ? (LANG()==='en' ? (o.nameEN||o.name||'') : (o.name||o.nameEN||'')) : '';
  const EN = () => LANG()==='en';
  // round photo avatar (Group C) — student Photo as a circle, else initials. Same size as .avatar-sm.
  const studentAvatar = s => s&&s.Photo ? `<span class="avatar-sm photo" style="background-image:url('${esc(s.Photo)}')"></span>` : `<span class="avatar-sm">${esc(initialEN(s?s.NameEN:'?'))}</span>`;
  // generic round avatar for any person record with a Photo + NameEN
  const personAvatar = o => o&&o.Photo ? `<span class="avatar-sm photo" style="background-image:url('${esc(o.Photo)}')"></span>` : `<span class="avatar-sm">${esc(initialEN(o?o.NameEN:'?'))}</span>`;
  // age as "X ปี Y เดือน" / "X y Y m" from a DOB
  function ageYM(dob){ const m=window.AGEMONTHS?AGEMONTHS(dob):0; return ageYMfromMonths(m); }
  function ageYMfromMonths(m){ m=Math.max(0,Math.round(m)); const y=Math.floor(m/12), mo=m%12;
    return EN()? `${y}y ${mo}m` : `${y} ปี ${mo} เดือน`; }
  window.GROWTH_PT = lbl => toast(lbl);
  // staff tenure (years/months since StartDate)
  function tenure(startDate){ if(!startDate) return '-'; const d=new Date(startDate),n=new Date();
    let m=(n.getFullYear()-d.getFullYear())*12+(n.getMonth()-d.getMonth()); if(n.getDate()<d.getDate())m--; m=Math.max(0,m);
    return ageYMfromMonths(m); }
  const planLabel = id => { const p=(MOCK.config.Plans||[]).find(x=>x.id===id); return p?(EN()?p.labelEN:p.labelTH):(id||'-'); };
  const groupLabel = name => { const g=(MOCK.staffGroups||[]).find(x=>x.GroupName===name); return g?(EN()?g.GroupNameEN:g.GroupName):(name||''); };
  // scope for parent data calls (uid → links for isolation; parentId as fallback)
  const parentScope = () => ({ parentId:USER&&USER.parentId, uid:USER&&USER.uid });
  // translate a stored status (leave code / payment / dspm result) for display
  const STAT = { PENDING_LEADER:'s.pending_leader', PENDING_ADMIN:'s.pending_admin', APPROVED:'s.approved', REJECTED:'s.rejected', PAID:'s.paid', UNPAID:'s.unpaid', PENDING_VERIFY:'s.verify', 'ผ่าน':'s.pass','ไม่ผ่าน':'s.fail','ยังไม่ได้รับการทดสอบ':'s.nottested' };
  const tStat = s => STAT[s] ? t(STAT[s]) : s;
  const MONEY_TR = { 'ค่าเทอม':'Tuition', 'ค่าอาหาร':'Meals', 'ค่ากิจกรรม':'Activities' };
  const trItem = s => EN() && MONEY_TR[s] ? MONEY_TR[s] : s;
  const tLeaveType = s => ({ 'ลาป่วย':'leaveType.sick','ลากิจ':'leaveType.personal','ลาพักร้อน':'leaveType.vacation' }[s] ? t({ 'ลาป่วย':'leaveType.sick','ลากิจ':'leaveType.personal','ลาพักร้อน':'leaveType.vacation' }[s]) : s);
  let toastT; function toast(m){ if(window.trPhrase) m=trPhrase(m); let t=$('.toast'); if(!t){t=document.createElement('div');t.className='toast';document.body.appendChild(t);} t.textContent=m; t.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),2400); }
  // runtime translator hook: auto-translate any remaining Thai in #app when EN
  let _mo=null,_translating=false;
  function ensureTranslateObserver(){ if(_mo||!window.translateTree)return; _mo=new MutationObserver(()=>{ if(_translating||LANG()!=='en')return; _translating=true; try{translateTree(app);}finally{_translating=false;} }); _mo.observe(app,{childList:true,subtree:true,characterData:true}); }
  function applyLangNow(){ if(window.translateTree&&LANG()==='en'){ _translating=true; try{translateTree(app);}finally{_translating=false;} } }
  function err(e){ toast('⚠️ '+(e&&e.message||e)); }
  function modal(html){ const m=document.createElement('div'); m.className='modal'; m.innerHTML=`<div class="sheet">${html}</div>`; m.onclick=e=>{ if(e.target===m)m.remove(); }; document.body.appendChild(m); if(window.translateTree) translateTree(m); return m; }

  let USER = null;

  let CURRENT = 'home';
  const ROLE_KEY = r => ({Parent:'role.Parent',Teacher:'role.Teacher',Admin:'role.Admin'}[r]||r);
  function setHeader(){
    $('#devbar').textContent = t('devbar') + ' · v30';
    $('#langBtn').textContent = LANG()==='en' ? 'EN' : 'TH';
    $('#userName').textContent = USER ? USER.nameEN : '–';
    $('#userRole').textContent = USER ? t(ROLE_KEY(USER.role)) : '';
    $('#avatar').textContent = USER ? initialEN(USER.nameEN) : '–';
    $('#logoutBtn').hidden = !USER; $('#logoutBtn').textContent = t('c.logout');
    $('#bellBtn').hidden = !USER;
    if(USER) refreshBell();
  }
  function notifParams(){ return {role:USER.role, parentId:USER.parentId}; }
  async function refreshBell(){ try{ const ns=await api('notifications',notifParams()); const n=ns.filter(x=>!x.read).length; const b=$('#bellBadge'); b.hidden=!n; b.textContent=n; }catch(e){} }
  window.BELL = async () => { const ns=await api('notifications',notifParams()); modal(`<div class="spread"><h3>🔔 ${t('c.notifications')}</h3><button class="btn-ghost" onclick="this.closest('.modal').remove()">${t('c.close')}</button></div>
    ${ns.map(n=>`<div class="list-item"><span>${n.read?'':'🔵 '}${esc(EN()&&n.textEN?n.textEN:n.text)}</span><small class="muted">${esc(n.time)}</small></div>`).join('')||'<p class="muted">—</p>'}
    <button class="btn block outline" style="margin-top:10px" onclick="MARKREAD(this)">${t('c.markread')}</button>`); };
  window.MARKREAD = async (btn)=>{ await api('markNotifsRead',notifParams()); btn.closest('.modal').remove(); refreshBell(); };
  // remembers which pre-login screen we're on, so the language toggle re-renders THAT screen
  let AUTH_RENDER = null;
  window.TOGGLE_LANG = () => { setLang(LANG()==='en'?'th':'en'); setHeader(); if(USER) GO(CURRENT); else (AUTH_RENDER||loginScreen)(); ensureTranslateObserver(); applyLangNow(); };

  const NAVS = {
    Parent:[['home','🏠','nav.home'],['checkin','📍','nav.checkin'],['payment','💳','nav.payment'],['journal','📒','nav.journal'],['dspm','📈','nav.dspm'],['chat','💬','nav.chat']],
    Teacher:[['home','🏠','nav.home'],['class','👶','nav.class'],['injury','🚑','inj.nav'],['leave','📩','nav.leave'],['schedule','📅','nav.schedule'],['slip','💵','nav.slip']],
    Admin:[['home','📊','nav.home'],['leaves','✅','nav.leaves'],['payroll','💵','nav.payroll'],['dspm','📈','nav.analytics'],['manage','🗂️','nav.manage'],['chat','💬','nav.chat']],
  };
  function setNav(active){ if(!USER){nav.hidden=true;return;} nav.hidden=false;
    nav.innerHTML = NAVS[USER.role].map(([k,ic,l])=>`<button class="${k===active?'active':''}" onclick="GO('${k}')"><span class="ic">${ic}</span>${esc(t(l))}</button>`).join(''); }

  window.GO = function(screen){ CURRENT=screen; setNav(screen); const fn=(SCREENS[USER.role]||{})[screen]; if(fn)fn(); else app.innerHTML=`<div class="card">หน้านี้กำลังพัฒนา</div>`; window.scrollTo(0,0); };
  function confirmSaved(msg){ msg=msg||t('c.saved'); if(window.trPhrase)msg=trPhrase(msg); const b=document.createElement('div'); b.className='savebar'; b.innerHTML=`✅ ${esc(msg)}`; document.body.appendChild(b); requestAnimationFrame(()=>b.classList.add('show')); setTimeout(()=>{b.classList.remove('show');setTimeout(()=>b.remove(),300);},1800); }

  function chooser(){ USER=null; AUTH_RENDER=chooser; setHeader(); nav.hidden=true;
    const rc=(r,ic)=>`<button class="role-card" onclick="LOGIN('${r}')"><span class="ic">${ic}</span><span><b>${esc(t('role.'+r))}</b><br><small>${esc(t('desc.'+r))}</small></span></button>`;
    app.innerHTML = `<div class="rolewrap"><img src="assets/logo.png" class="logo-lg" alt="logo"/>
      <h2 class="page" style="text-align:center">${esc(t('chooser.title'))}</h2>
      <p class="muted">${esc(t('chooser.sub'))}</p>
      ${rc('Parent','👪')}${rc('Teacher','👩‍🏫')}${rc('Admin','🛠️')}${rc('Leader','⭐')}
      <button class="btn-ghost block" style="margin-top:8px" onclick="accountStage()">${esc(t('c.back'))}</button>
      <button class="btn outline block" id="installBtn" style="margin-top:10px" hidden onclick="DO_INSTALL()">📲 ${esc(t('install'))}</button></div>`;
    if(deferredInstall) $('#installBtn').hidden=false;
  }
  let deferredInstall=null;
  window.addEventListener('beforeinstallprompt', e=>{ e.preventDefault(); deferredInstall=e; const b=document.getElementById('installBtn'); if(b)b.hidden=false; });
  window.DO_INSTALL = async ()=>{ if(!deferredInstall){toast('เปิดเมนูเบราว์เซอร์ → Add to Home Screen');return;} deferredInstall.prompt(); deferredInstall=null; };
  const DEMO_USERS = {
    Parent:{role:'Parent',nameTH:'กานต์ ดีงาม',nameEN:'Ms.Karn',parentId:'PAR-1',uid:'U_p1'},
    Teacher:{role:'Teacher',nameTH:'เอ มานะ',nameEN:'A Mana',staffId:'STF-T1'},
    Leader:{role:'Teacher',nameTH:'แนน ใจดี',nameEN:'Nan J.',staffId:'STF-L1'},
    Admin:{role:'Admin',nameTH:'อารยา ผ่องใส',nameEN:'Araya P.',staffId:'STF-ADM'},
  };
  window.LOGIN = function(roleKey){ USER=Object.assign({},DEMO_USERS[roleKey]); USER._roleKey=roleKey;
    try{ localStorage.setItem('atom_session', JSON.stringify({roleKey, provider:PENDING_PROVIDER||'demo'})); }catch(e){}
    setHeader(); GO('home');
  };
  // log in as a freshly registered/linked parent (carries its own uid for data isolation)
  window.LOGIN_PARENT = function(u){ USER=Object.assign({role:'Parent',_roleKey:'Parent'},u);
    try{ localStorage.setItem('atom_session', JSON.stringify({roleKey:'Parent', provider:PENDING_PROVIDER||'demo', parent:u})); }catch(e){}
    setHeader(); GO('home');
  };
  // log in with real GAS auth result (LIFF flow)
  window.LOGIN_REAL = function(role, linkedId, displayName, pictureUrl) {
    const roleKey = role === 'Admin' ? 'Admin' : role === 'Leader' ? 'Leader' : role === 'Teacher' ? 'Teacher' : 'Parent';
    USER = { role, _roleKey: roleKey, nameEN: displayName || roleKey, nameTH: displayName || roleKey };
    if (role === 'Parent') { USER.parentId = linkedId; USER.uid = PENDING_LINE_UID || linkedId; }
    else USER.staffId = linkedId;
    if (pictureUrl) USER.pictureUrl = pictureUrl;
    PENDING_LINE_UID = null;
    setHeader(); GO('home');
  };
  function logout(){
    try{ localStorage.removeItem('atom_session'); }catch(e){}
    USER=null; PENDING_PROVIDER=null; PENDING_LINE_UID=null;
    if (CONFIG.MODE === 'gas' && CONFIG.LIFF_ID && window.liff && liff.isLoggedIn()) { liff.logout(); }
    loginScreen();
  }
  $('#logoutBtn').onclick = logout;

  // ---- LINE / LIFF auth ----
  let PENDING_PROVIDER=null;
  let PENDING_LINE_UID=null; // real LINE userId from liff.getProfile() — used during registration
  function loginScreen(){ USER=null; AUTH_RENDER=loginScreen; setHeader(); nav.hidden=true;
    app.innerHTML = `<div class="rolewrap"><img src="assets/logo.png" class="logo-lg" alt="logo"/>
      <h2 class="page" style="text-align:center">${esc(t('login.title'))}</h2>
      <p class="muted">${esc(t('login.lineOnly'))}</p>
      <button class="role-card" onclick="LIFF_LOGIN()"><span class="ic" style="background:#06C755;color:#fff;font-weight:800">L</span><span><b>${esc(t('login.lineBtn'))}</b><br><small>${esc(t('login.lineSub'))}</small></span></button>
      <label style="display:flex;align-items:center;gap:8px;justify-content:center;margin-top:10px;font-size:13px"><input type="checkbox" id="rememberMe" checked style="width:auto"/> ${esc(t('login.remember'))}</label>
      <button class="btn outline block" id="installBtn" style="margin-top:14px" hidden onclick="DO_INSTALL()">📲 ${esc(t('install'))}</button></div>`;
    if(deferredInstall) $('#installBtn').hidden=false;
  }
  // In gas+LIFF mode: trigger real LINE login; otherwise fall through to demo chooser
  window.LIFF_LOGIN = () => {
    if (CONFIG.MODE === 'gas' && CONFIG.LIFF_ID && window.liff) { liff.login(); return; }
    PROVIDER('LINE');
  };
  window.PROVIDER = (id) => { PENDING_PROVIDER = id; accountStage(); };

  // ---- after provider: new vs existing user ----
  function accountStage(){ USER=null; AUTH_RENDER=accountStage; setHeader(); nav.hidden=true;
    app.innerHTML = `<div class="rolewrap"><img src="assets/logo.png" class="logo-lg" alt="logo"/>
      <h2 class="page" style="text-align:center">${esc(t('acct.title'))}</h2>
      <p class="muted">${esc(t('acct.sub'))}</p>
      <button class="role-card" onclick="REG_START()"><span class="ic">📝</span><span><b>${esc(t('acct.new'))}</b><br><small>${esc(t('acct.newSub'))}</small></span></button>
      <button class="role-card" onclick="chooserExisting()"><span class="ic">✅</span><span><b>${esc(t('acct.existing'))}</b><br><small>${esc(t('acct.existingSub'))}</small></span></button>
      <button class="btn-ghost block" style="margin-top:8px" onclick="loginScreen()">${esc(t('c.back'))}</button></div>`;
  }
  window.chooserExisting = ()=> chooser();
  // expose auth screens so inline Back buttons (onclick="...") can reach them
  window.loginScreen = loginScreen; window.accountStage = accountStage; window.chooser = chooser;

  function boot(){ ensureTranslateObserver();
    // LIFF path: gas mode + LIFF_ID set + SDK loaded → real LINE auth
    if (CONFIG.MODE === 'gas' && CONFIG.LIFF_ID && window.liff) {
      liff.init({ liffId: CONFIG.LIFF_ID }).then(() => {
        if (liff.isLoggedIn()) {
          liff.getProfile().then(profile => {
            PENDING_LINE_UID = profile.userId;
            // send the verifiable access token (NOT the raw userId): GAS verifies it server-side
            // via LINE's profile endpoint and trusts the resulting userId — prevents UID spoofing.
            api('auth', { accessToken: liff.getAccessToken(), displayName: profile.displayName, pictureUrl: profile.pictureUrl }).then(u => {
              LOGIN_REAL(u.role, u.linkedId, u.displayName || profile.displayName, u.pictureUrl || profile.pictureUrl);
              applyLangNow();
            }).catch(e => {
              if (e.code === 'NOT_REGISTERED') { PENDING_PROVIDER = 'LINE'; accountStage(); }
              else { toast('⚠️ ' + (e.message || e)); loginScreen(); }
              applyLangNow();
            });
          }).catch(() => { loginScreen(); applyLangNow(); });
        } else { loginScreen(); applyLangNow(); }
      }).catch(() => { loginScreen(); applyLangNow(); });
      return;
    }
    // Demo/mock path: restore session from localStorage
    try{ const s=JSON.parse(localStorage.getItem('atom_session')||'null');
      if(s&&s.parent){ PENDING_PROVIDER=s.provider; LOGIN_PARENT(s.parent); applyLangNow(); return; }
      if(s&&DEMO_USERS[s.roleKey]){ PENDING_PROVIDER=s.provider; LOGIN(s.roleKey); applyLangNow(); return; } }catch(e){}
    loginScreen(); applyLangNow(); }

  // ================= REGISTRATION =================
  // New-user signup captures the PARENT only; children are added/linked afterward
  // (so a 2nd parent of the same child never gets blocked — they just link by NationalID).
  let REG_PICKUPS=0;
  window.REG_START = ()=> REG_FORM();
  const fld_=(id,label,type,ph)=>`<label class="field"><span>${esc(label)}</span><input id="${id}" type="${type||'text'}" placeholder="${esc(ph||'')}"/></label>`;
  window.REG_FORM = ()=>{ AUTH_RENDER=REG_FORM;
    app.innerHTML=`<h2 class="page">${esc(t('reg.titleParent'))}</h2>
      <div class="card" style="background:#f7f9fc"><small class="muted">${esc(t('reg.parentFirstNote'))}</small></div>
      <div class="card"><h3>👪 ${esc(t('reg.parent'))}</h3>
        <div class="grid2">${fld_('rPNameTH',t('reg.nameTH'))}${fld_('rPNameEN',t('reg.nameEN'))}</div>
        <div class="grid2"><label class="field"><span>${esc(t('reg.relationship'))}</span><select id="rRel"><option>${esc(t('reg.father'))}</option><option>${esc(t('reg.mother'))}</option><option>${esc(t('reg.guardian'))}</option></select></label>${fld_('rPNID',t('reg.nationalIdParent'))}</div>
        <div class="grid2">${fld_('rPPhone',t('reg.mobile'))}${fld_('rPOffice',t('reg.officePhone'))}</div>
        <div class="grid2">${fld_('rPOcc',t('reg.occupation'))}${fld_('rPWork',t('reg.workplace'))}</div>
        ${fld_('rPAddr',t('reg.address'))}
        <label class="field"><span>📸 ${esc(t('reg.photoCapture'))}</span><input id="rPPhoto" type="file" accept="image/*" capture="user" onchange="REG_photoPrev(this)"/></label>
        <div style="text-align:center"><img id="rPPhotoPrev" alt="" style="max-height:160px;border-radius:10px;border:1px solid #eee;margin:4px 0" hidden/></div>
        <small class="muted" style="font-size:12px">🔒 ${esc(t('reg.photoCaptureNote'))}</small></div>
      <div class="card"><label style="display:flex;gap:8px;align-items:flex-start;font-size:13px"><input type="checkbox" id="rPDPA" style="width:auto;margin-top:3px"/><span>${esc(t('reg.pdpa'))}</span></label></div>
      <button class="btn block" onclick="REG_submit()">${esc(t('reg.submit'))}</button>
      <button class="btn-ghost block" style="margin-top:8px" onclick="REG_BACK()">${esc(t('c.back'))}</button>`;
  };
  window.REG_BACK = ()=>{ if(USER) GO('home'); else accountStage(); };
  window.REG_photoPrev=(inp)=>{ const f=inp.files[0]; const img=$('#rPPhotoPrev'); if(!f||!img)return; const fr=new FileReader(); fr.onload=()=>{ img.src=fr.result; img.hidden=false; }; fr.readAsDataURL(f); };
  window.REG_submit = async ()=>{ const v=id=>{ const e=$(id); return e?e.value.trim():''; };
    if(!v('#rPNameTH')&&!v('#rPNameEN')){toast(EN()?'Enter your name':'กรอกชื่อผู้ปกครอง');return;}
    if(!$('#rPDPA').checked){toast(EN()?'Please accept PDPA consent':'กรุณายอมรับ PDPA');return;}
    const pf=$('#rPPhoto')&&$('#rPPhoto').files[0];
    if(!pf){ toast(t('reg.photoRequired')); return; } // photo is now mandatory (login security)
    const parentPhoto=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(pf);});
    const uid=PENDING_LINE_UID||(PENDING_PROVIDER||'LINE')+'_'+Date.now();
    const parent={NameTH:v('#rPNameTH'),NameEN:v('#rPNameEN'),Relationship:$('#rRel').value,NationalID:v('#rPNID'),Phone:v('#rPPhone'),OfficePhone:v('#rPOffice'),Occupation:v('#rPOcc'),Workplace:v('#rPWork'),Address:v('#rPAddr'),Photo:parentPhoto,LineUID:uid};
    try{ const r=await api('registerParent',{uid,parent});
      confirmSaved(EN()?'Registered — now add your child':'ลงทะเบียนแล้ว — เพิ่มข้อมูลบุตรหลานต่อ');
      LOGIN_PARENT({nameTH:parent.NameTH,nameEN:parent.NameEN||parent.NameTH,parentId:r.parentId,uid});
      setTimeout(()=>P_addChild(),300); // prompt to add/link a child right after
    }catch(e){err(e);} };

  // ----- add a NEW child (student-only form) — used from P_addChild -----
  window.REG_CHILD_FORM = ()=>{ REG_PICKUPS=1;
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('home')">${t('c.back')}</button><h2 class="page">👶 ${esc(t('reg.childTitle'))}</h2>
      <div class="card" style="background:#f7f9fc"><small class="muted">${esc(t('reg.planByAdmin'))}</small></div>
      <div class="card"><h3>👶 ${esc(t('reg.student'))}</h3>
        <div class="grid2">${fld_('rNameTH',t('reg.nameTH'))}${fld_('rNameEN',t('reg.nameEN'))}</div>
        <div class="grid2">${fld_('rNick',t('reg.nickname'))}${fld_('rNickEN',t('reg.nicknameEN'))}</div>
        <label class="field"><span>${esc(t('reg.gender'))}</span><select id="rGender"><option value="M">${esc(t('reg.male'))}</option><option value="F">${esc(t('reg.female'))}</option></select></label>
        <div class="grid2"><label class="field"><span>${esc(t('reg.dob'))}</span><input id="rDOB" type="date" onchange="REG_age()"/></label><label class="field"><span>${esc(t('reg.age'))}</span><input id="rAge" disabled placeholder="–"/></label></div>
        <label class="field"><span>${esc(t('reg.nationalIdStudent'))}</span><input id="rSNID" inputmode="numeric" placeholder="x-xxxx-xxxxx-xx-x"/></label>
        <div class="grid2">${fld_('rW',t('reg.weight'),'number')}${fld_('rH',t('reg.height'),'number')}</div>
        <div class="grid2">${fld_('rBlood',t('reg.bloodType'))}${fld_('rRH','RH')}</div>
        <label class="field"><span>${esc(t('reg.photo'))}</span><input id="rPhoto" type="file" accept="image/*"/></label>
        <label class="field"><span>${esc(t('reg.allergy'))}</span><input id="rAllergy" placeholder="${esc(t('reg.allergyPh'))}"/></label>
        <label class="field"><span>${esc(t('reg.chronic'))}</span><input id="rChronic"/></label></div>
      <div class="card"><div class="spread"><h3>🚗 ${esc(t('reg.pickupPersons'))}</h3><button class="btn sm outline" onclick="REG_addPickup()">+ ${esc(t('reg.addPickup'))}</button></div>
        <div id="rPickups"></div></div>
      <button class="btn block" onclick="REG_childSubmit()">${esc(t('reg.saveChild'))}</button>`;
    REG_renderPickups();
  };
  window.REG_age = ()=>{ const v=$('#rDOB').value; if(v) $('#rAge').value=ageYM(v); };
  window.REG_addPickup = ()=>{ if(REG_PICKUPS>=4){toast(EN()?'Max 4':'สูงสุด 4 คน');return;} REG_PICKUPS++; REG_renderPickups(true); };
  function REG_renderPickups(keep){ const box=$('#rPickups'); if(!box)return; const old=keep?[...box.querySelectorAll('input')].map(i=>i.value):[];
    let h=''; for(let i=0;i<REG_PICKUPS;i++) h+=`<div class="grid3" style="margin-bottom:6px"><input id="pkN${i}" placeholder="${esc(t('reg.name'))}"/><input id="pkP${i}" placeholder="${esc(t('reg.phone'))}"/><input id="pkR${i}" placeholder="${esc(t('reg.relation'))}"/></div>`;
    box.innerHTML=h; if(keep) old.forEach((v,idx)=>{ const el=box.querySelectorAll('input')[idx]; if(el)el.value=v; }); }
  window.REG_childSubmit = async ()=>{ const v=id=>{ const e=$(id); return e?e.value.trim():''; };
    if(!v('#rNameTH')&&!v('#rNameEN')){toast(EN()?'Enter student name':'กรอกชื่อนักเรียน');return;}
    const photo=$('#rPhoto')&&$('#rPhoto').files[0]?await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL($('#rPhoto').files[0]);}):'';
    const pickups=[]; for(let i=0;i<REG_PICKUPS;i++){ const n=v('#pkN'+i); if(n) pickups.push({Name:n,Phone:v('#pkP'+i),Relation:v('#pkR'+i)}); }
    const student={NationalID:v('#rSNID'),NameTH:v('#rNameTH'),NameEN:v('#rNameEN'),Nickname:v('#rNick'),NicknameEN:v('#rNickEN'),Gender:$('#rGender').value,DOB:v('#rDOB'),Plan:'',Weight:+v('#rW')||'',Height:+v('#rH')||'',Photo:photo,BloodType:v('#rBlood'),RH:v('#rRH'),Allergy:v('#rAllergy')||'-',MedicalHistory:v('#rChronic')||'-',Class:'Nursery 1'};
    try{ await api('addChildNew',{uid:USER.uid,parentId:USER.parentId,student,pickupPersons:pickups}); confirmSaved(t('c.saved')); GO('home'); }catch(e){err(e);} };

  const SCREENS = { Parent:{}, Teacher:{}, Admin:{} };

  // ===== shared: journal checklist render =====
  const MOODS={Happy:'😀',Cheerful:'😄',Calm:'🙂',Active:'🤩',Tired:'😴',Sensitive:'😢'};
  const HEALTHS=['Well','Runny Nose','Cough','Under Observation','Medication Given'];
  const WATERS=['Good','Fair','Needs Encouragement'];
  const MEAL_AMT=['All','Most','Some','Refused'];
  const ACTS=['Circle Time','Story Time','Music & Movement','Art & Craft','Outdoor Play','Sensory Play','Language','Mathematics','Science','Free Play'];
  const SKILLS=['Communication','Social Skills','Self-Help Skills','Fine Motor Skills','Gross Motor Skills','Creativity'];
  const URI=['Normal','More','Less'], BOWEL=['None','1','2','3+'], STOOL=['Normal','Loose','Hard'], TT=['Yes','No'];
  // 17 standard injury types from the official แบบบันทึกการบาดเจ็บรายบุคคล (bilingual; code stored in the record)
  const INJURY_TYPES=[
    {n:1, th:'พลัดตกหกล้ม', en:'Fall / slip'},
    {n:2, th:'ถูกแรงกระทำโดยวัตถุ เช่น ถูกชน กระแทก ของหล่นใส่ ถูกกด หนีบ บีบทับ บาด ตำ ทิ่มแทง (ยกเว้นการจราจร)', en:'Struck/cut/pierced by an object (excl. traffic)'},
    {n:3, th:'ถูกแรงระเบิดโดยไม่ตั้งใจ เช่น เล่นปืน ดอกไม้ไฟ พลุ ประทัด วัตถุระเบิดอื่น', en:'Unintentional explosion (fireworks, firecrackers, etc.)'},
    {n:4, th:'ถูกแรงกระทำจากสัตว์ เช่น กัด ชน กระแทก (ยกเว้นแมลง สัตว์มีพิษ–งู)', en:'Animal impact/bite (excl. insects, venomous, snake)'},
    {n:5, th:'ตกน้ำ จมน้ำ', en:'Fall into water / drowning'},
    {n:6, th:'สิ่งแปลกปลอมเข้าหู จมูก ตา คอ เช่น ก้างปลา ลูกปัด (ยกเว้นอุดตันทางเดินหายใจ)', en:'Foreign body in ear/nose/eye/throat (excl. airway)'},
    {n:7, th:'ถูกควันไฟและเปลวไฟ', en:'Smoke & flame'},
    {n:8, th:'ขาดอากาศหายใจแบบอื่น รวมสิ่งแปลกปลอมอุดตันหลอดลมและการสำลักควันไฟ (ยกเว้นการจมน้ำ)', en:'Other suffocation / airway obstruction (excl. drowning)'},
    {n:9, th:'ถูกไฟฟ้าดูด', en:'Electric shock'},
    {n:10,th:'ถูกน้ำร้อนลวกหรือวัตถุร้อน', en:'Scald / hot-object burn'},
    {n:11,th:'ได้รับสารพิษ เช่น น้ำยาเคมี สารเคมี ยาเกินขนาด ไอระเหย รวมทั้งสัตว์มีพิษ พืชมีพิษ', en:'Poisoning (chemicals, overdose, venomous/toxic)'},
    {n:12,th:'การจราจร เช่น ถูกรถชน', en:'Traffic (e.g. hit by a vehicle)'},
    {n:13,th:'ถูกกระทำจากคนโดยไม่ตั้งใจ เช่น ชนกระแทก เล่นผลักแล้วล้ม', en:'Unintentional human impact (bump, push)'},
    {n:14,th:'จากการออกแรงมากเกินไป เช่น ดึง ดันของหนักมากเกินไป', en:'Overexertion (pulling/pushing heavy loads)'},
    {n:15,th:'ถูกทำร้ายร่างกาย หรือน่าจะถูกทำร้ายร่างกาย', en:'Assault / suspected assault'},
    {n:16,th:'ทำร้ายตนเอง', en:'Self-harm'},
    {n:17,th:'อื่นๆ', en:'Other'},
  ];
  const PLACE_OPTS=[['home','inj.place.home'],['school','inj.place.school'],['center','inj.place.center'],['road','inj.place.road'],['park','inj.place.park'],['other','inj.place.other']];
  const chk=(label,on)=>`<span class="chk ${on?'on':''}"><span class="box">${on?'✓':''}</span><b>${esc(label)}</b></span>`;
  // Journal is authored in English; show Thai labels when LANG=th (values stay English in the record).
  const JTR={ 'MY DAY AT ATOM':'วันของฉันที่ Atom', "Today's Mood":'อารมณ์วันนี้','Mood':'อารมณ์','Health Update':'สุขภาพ','Health':'สุขภาพ',
    'Milk & Water':'นม & น้ำ','Meals & Snacks':'มื้ออาหาร & ของว่าง','Meals':'มื้ออาหาร','Sleep Record':'การนอน','Sleep':'การนอน',
    'Toileting':'การขับถ่าย','Learning Journey':'การเรียนรู้','Skills Practiced':'ทักษะที่ฝึก','Skills':'ทักษะ',"Today's Highlight":'ไฮไลต์วันนี้','Highlight':'ไฮไลต์',
    'Breakfast':'มื้อเช้า','Lunch':'มื้อกลางวัน','Dinner':'มื้อเย็น','Urination':'ปัสสาวะ','Bowel':'อุจจาระ (ครั้ง)','Stool':'ลักษณะอุจจาระ','Toilet Training':'ฝึกขับถ่าย','Training':'ฝึกขับถ่าย',
    'Theme':'หัวข้อ','Total':'รวม','Water':'น้ำ',
    'Happy':'อารมณ์ดี','Cheerful':'ร่าเริง','Calm':'สงบ','Active':'กระตือรือร้น','Tired':'ง่วง','Sensitive':'งอแง',
    'Well':'แข็งแรงดี','Runny Nose':'น้ำมูกไหล','Cough':'ไอ','Under Observation':'เฝ้าสังเกต','Medication Given':'ให้ยาแล้ว',
    'Good':'ดี','Fair':'พอใช้','Needs Encouragement':'ต้องกระตุ้น','All':'หมด','Most':'เกือบหมด','Some':'บางส่วน','Refused':'ไม่ทาน',
    'Normal':'ปกติ','More':'มากขึ้น','Less':'น้อยลง','None':'ไม่มี','Loose':'เหลว','Hard':'แข็ง','Yes':'ใช่','No':'ไม่',
    'Circle Time':'กิจกรรมวงกลม','Story Time':'เล่านิทาน','Music & Movement':'ดนตรี & เคลื่อนไหว','Art & Craft':'ศิลปะ & งานประดิษฐ์','Outdoor Play':'เล่นกลางแจ้ง','Sensory Play':'เล่นสัมผัส','Language':'ภาษา','Mathematics':'คณิตศาสตร์','Science':'วิทยาศาสตร์','Free Play':'เล่นอิสระ',
    'Communication':'การสื่อสาร','Social Skills':'ทักษะสังคม','Self-Help Skills':'ช่วยเหลือตัวเอง','Fine Motor Skills':'กล้ามเนื้อมัดเล็ก','Gross Motor Skills':'กล้ามเนื้อมัดใหญ่','Creativity':'ความคิดสร้างสรรค์' };
  const jt = s => EN()? s : (JTR[s]||s);
  function journalChecklist(j){ j=j||{};
    const meals=j.Meals||{}; const milk=Array.isArray(j.Milk)?j.Milk:[];
    const tl=j.Toilet||{}; const acts=j.Activity||[], sk=j.Skills||[];
    const sleep=Array.isArray(j.Sleep)?j.Sleep:[];
    const dt=EN()?'Details':'รายละเอียด', tot=EN()?'Total':'รวม';
    return `<div class="card">
      <div class="spread"><b>🌈 ${esc(jt('MY DAY AT ATOM'))}</b><span class="muted">${esc(j.Date||todayStr())}</span></div>
      <div class="jsec"><h4>😊 ${esc(jt("Today's Mood"))}</h4>${Object.keys(MOODS).map(m=>chk(MOODS[m]+' '+jt(m), j.Mood===m)).join('')}</div>
      <div class="jsec"><h4>❤️ ${esc(jt('Health Update'))}</h4>${HEALTHS.map(h=>chk(jt(h), j.Health===h)).join('')}${j.HealthDetail?`<div class="muted" style="font-size:12px">${esc(dt)}: ${esc(j.HealthDetail)}</div>`:''}</div>
      <div class="jsec"><h4>🍼 ${esc(jt('Milk & Water'))}</h4>
        <div>${[0,1,2,3,4,5].map(i=>`<span class="chk ${milk[i]!=null?'on':''}"><b>${i+1}.</b> ${milk[i]!=null?esc(milk[i])+'oz':'__oz'}</span>`).join('')}</div>
        <div class="muted" style="font-size:12px">${esc(tot)}: ${esc(j.MilkTotal||'-')} oz</div>
        <div>${WATERS.map(w=>chk(jt(w), j.Water===w)).join('')}</div></div>
      <div class="jsec"><h4>🍽 ${esc(jt('Meals & Snacks'))}</h4>
        ${['Breakfast','Lunch','Dinner'].map(m=>`<div><b style="font-size:13px">${esc(jt(m))}:</b> ${MEAL_AMT.map(a=>chk(jt(a), meals[m]===a)).join('')}</div>`).join('')}</div>
      <div class="jsec"><h4>😴 ${esc(jt('Sleep Record'))}</h4>${[0,1,2,3].map(i=>`<span class="chk ${sleep[i]?'on':''}"><b>${i+1}:</b> ${sleep[i]?esc(sleep[i].from+'–'+sleep[i].to):'__:__'}</span>`).join('')}<div class="muted" style="font-size:12px">${esc(tot)}: ${esc(j.SleepTotal||'-')}</div></div>
      <div class="jsec"><h4>🚽 ${esc(jt('Toileting'))}</h4>
        <div><b style="font-size:13px">${esc(jt('Urination'))}:</b> ${URI.map(x=>chk(jt(x),tl.Urination===x)).join('')}</div>
        <div><b style="font-size:13px">${esc(jt('Bowel'))}:</b> ${BOWEL.map(x=>chk(jt(x),tl.Bowel===x)).join('')}</div>
        <div><b style="font-size:13px">${esc(jt('Stool'))}:</b> ${STOOL.map(x=>chk(jt(x),tl.Stool===x)).join('')}</div>
        <div><b style="font-size:13px">${esc(jt('Toilet Training'))}:</b> ${TT.map(x=>chk(jt(x),tl.Training===x)).join('')}</div></div>
      <div class="jsec"><h4>🎨 ${esc(jt('Learning Journey'))}</h4>${ACTS.map(a=>chk(jt(a),acts.indexOf(a)>=0)).join('')}${j.Theme?`<div class="muted" style="font-size:12px">${esc(jt('Theme'))}: ${esc(j.Theme)}</div>`:''}</div>
      <div class="jsec"><h4>🌟 ${esc(jt('Skills Practiced'))}</h4>${SKILLS.map(s=>chk(jt(s),sk.indexOf(s)>=0)).join('')}</div>
      <div class="jsec"><h4>⭐ ${esc(jt("Today's Highlight"))}</h4><div style="background:#fff8e1;border-radius:10px;padding:10px;font-size:14px">${esc(j.Highlight||'-')}</div></div>
    </div>`;
  }
  function ddmmyyyy(s){ const d=new Date(s||todayStr()); return p2(d.getDate())+'-'+p2(d.getMonth()+1)+'-'+d.getFullYear(); }
  function waitCard(date){ return `<div class="card" style="text-align:center;color:#8a6d00;background:#fff8e1;border-color:#f0e3b0">⏳ รอคุณครูส่งข้อมูลของวันที่ ${ddmmyyyy(date)}</div>`; }
  function annRow(a){ const ti=EN()?(a.TitleEN||a.Title):(a.Title||a.TitleEN); const co=EN()?(a.ContentEN||a.Content):(a.Content||a.ContentEN);
    return `<div class="list-item"><div><b>${esc(ti)}</b><br><small class="muted">${esc(co)}</small>${a.Image?`<br><img src="${esc(a.Image)}" style="max-width:160px;border-radius:8px;margin-top:6px"/>`:''}</div><small class="muted">${esc(a.Date)}</small></div>`; }
  function socialFooter(){ const L=MOCK.config.Links||{}; return `<div class="social">
    <a href="${esc(L.line||'#')}" target="_blank"><span class="ic line">L</span>LINE OA</a>
    <a href="${esc(L.facebook||'#')}" target="_blank"><span class="ic fb">f</span>Facebook</a>
    <a href="${esc(L.website||'#')}" target="_blank"><span class="ic web">🌐</span>Website</a></div>`; }
  function calendarWidget(events, checkins, planEnd){ checkins=checkins||[]; const now=new Date(); const y=now.getFullYear(),mo=now.getMonth();
    const first=new Date(y,mo,1).getDay(); const days=new Date(y,mo+1,0).getDate(); const evByDay={},ioByDay={};
    const grace=Number(MOCK.config.OTGraceMinutes||21); const toMin=hhmm=>{const[h,m]=String(hhmm||'0:0').split(':').map(Number);return (h||0)*60+(m||0);};
    const lateOut = out => planEnd && out && (toMin(out)-toMin(planEnd))>grace; // pickup past plan end + grace
    events.forEach(e=>{ const d=new Date(e.date); if(d.getFullYear()===y&&d.getMonth()===mo) (evByDay[d.getDate()]=evByDay[d.getDate()]||[]).push(e); });
    checkins.forEach(c=>{ const d=new Date(c.Date); if(d.getFullYear()===y&&d.getMonth()===mo) ioByDay[d.getDate()]=c; });
    let cells=''; const wd=['อา','จ','อ','พ','พฤ','ศ','ส'];
    cells+=wd.map(w=>`<div style="text-align:center;font-size:11px;color:#94a3b8">${w}</div>`).join('');
    for(let i=0;i<first;i++) cells+=`<div class="d dim"></div>`;
    for(let d=1;d<=days;d++){ const ev=evByDay[d]; const io=ioByDay[d]; const cls=ev?(ev[0].type==='holiday'?'ho':'ev'):''; const today=d===now.getDate()?'today':'';
      const outRed=io&&lateOut(io.OutTime); const outHtml=io?`<span style="${outRed?'color:#d50000;font-weight:800':''}">${esc(io.OutTime||'-')}</span>`:'';
      cells+=`<div class="d ${cls} ${today}">${d}${ev?`<span class="dot">${esc(ev[0].title)}</span>`:''}${io?`<span class="io">${esc(io.InTime||'-')}<br>${outHtml}</span>`:''}</div>`; }
    const months=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const monthsEN=['January','February','March','April','May','June','July','August','September','October','November','December'];
    const head = EN()? (monthsEN[mo]+' '+y) : (months[mo]+' '+(y+543));
    const legend = EN()? 'Drop-off / Pick-up times (for OT check)' : 'เวลาส่ง / รับ (ใช้ตรวจสอบ OT)';
    return `<div class="card"><h3>📅 ${EN()?'Calendar':'ปฏิทิน'} ${head}</h3><div class="cal">${cells}</div><small class="muted">${legend}</small></div>`; }

  // forced announcement popup for parents (must close before check-in/out); "don't show again" per id
  async function showAnnPopups(onDone){ let anns=[]; try{ anns=await api('activeAnnouncements'); }catch(e){}
    let dismissed={}; try{ dismissed=JSON.parse(localStorage.getItem('atom_ann_dismissed')||'{}'); }catch(e){}
    const queue=anns.filter(a=>!dismissed[a.AnnID]);
    if(!queue.length){ if(onDone)onDone(); return; }
    let idx=0;
    const showOne=()=>{ const a=queue[idx]; const ti=EN()?(a.TitleEN||a.Title):(a.Title||a.TitleEN); const co=EN()?(a.ContentEN||a.Content):(a.Content||a.ContentEN);
      const m=modal(`<div style="text-align:center"><div style="font-size:34px">📢</div><h3>${esc(ti)}</h3>
        <p style="font-size:14px">${esc(co)}</p>${a.Image?`<img src="${esc(a.Image)}" style="max-width:100%;border-radius:10px;margin:6px 0"/>`:''}
        <label style="display:flex;align-items:center;gap:8px;justify-content:center;font-size:12.5px;margin:8px 0"><input type="checkbox" id="annHide" style="width:auto"/> ${esc(t('ann.hide'))}</label>
        <button class="btn block" id="annClose">${esc(t('ann.ok'))}</button></div>`);
      m.querySelector('#annClose').onclick=()=>{ if(m.querySelector('#annHide').checked){ dismissed[a.AnnID]=true; try{localStorage.setItem('atom_ann_dismissed',JSON.stringify(dismissed));}catch(e){} }
        m.remove(); idx++; if(idx<queue.length) showOne(); else if(onDone)onDone(); };
      m.onclick=null; // force using the button (cannot dismiss by backdrop)
    };
    showOne();
  }

  // ================= PARENT =================
  SCREENS.Parent.home = async () => {
    showAnnPopups();
    const kids = await api('parentChildren',parentScope());
    const addBtn = `<button class="btn sm outline" onclick="P_addChild()">+ ${esc(t('p.addChild'))}</button>`;
    if(!kids.length){ app.innerHTML=`<h2 class="page">${esc(t('p.greeting'))}${esc(EN()?USER.nameEN:USER.nameTH)} 👋</h2>
      <div class="card" style="text-align:center"><p>${esc(t('p.noChild'))}</p><div class="row" style="justify-content:center">${addBtn}</div></div>${socialFooter()}`; return; }
    const k0 = kids[0];
    const [j, sl, anns, cal, ci] = await Promise.all([
      api('getJournal',{studentId:k0.StudentID}), api('studentLeaves',{studentId:k0.StudentID}),
      api('announcements'), api('calendar'), api('studentCheckinHistory',{studentId:k0.StudentID})
    ]);
    const kidsHtml = kids.map(k=>`<div class="card"><div class="spread"><div><b>${esc(nm(k))}</b>${nick(k)?` <span class="pill info">${esc(nick(k))}</span>`:''} <small class="muted">(${esc(EN()?k.NameTH:k.NameEN)})</small><br><small class="muted">${esc(k.Class)} · ${esc(ageYM(k.DOB))} · ${esc(planLabel(k.Plan))}<br>${EN()?'allergy':'แพ้'}: ${esc(k.Allergy||'-')}</small></div>${studentAvatar(k)}</div>
      <div class="row" style="margin-top:10px"><button class="btn sm" onclick="GO('checkin')">📍 ${esc(t('nav.checkin'))}</button><button class="btn sm outline" onclick="P_journal('${k.StudentID}')">📒 ${esc(t('nav.journal'))}</button><button class="btn sm outline" onclick="P_dspm('${k.StudentID}')">📈 ${esc(t('nav.dspm'))}</button></div></div>`).join('');
    const slHtml = sl.map(l=>`<div class="list-item"><span>${esc(l.Date)} · ${esc(l.Reason)}</span><span class="pill info">${esc(tStat(l.Status))}</span></div>`).join('')||'<small class="muted">ไม่มีรายการ</small>';
    app.innerHTML = `<div class="spread"><h2 class="page">${esc(t('p.greeting'))}${esc(EN()?USER.nameEN:USER.nameTH)} 👋</h2>${addBtn}</div>
      ${kidsHtml}
      <h3 style="margin:6px 2px">📒 บันทึกของ ${esc(nm(k0))} วันนี้</h3>${j?journalChecklist(j):waitCard()}
      <div class="card"><div class="spread"><h3>🏠 แจ้งลาบุตรหลาน</h3><button class="btn sm outline" onclick="P_absence()">+ แจ้งลา</button></div>${slHtml}
        <div class="row" style="margin-top:10px"><button class="btn sm outline pink" onclick="P_withdraw()">${esc(t('wd.btn'))}</button></div></div>
      <div class="card" id="insCard"></div>
      <div class="card"><h3>📢 ประกาศจากโรงเรียน</h3>${anns.map(annRow).join('')}</div>
      ${calendarWidget(cal, ci, (MOCK.config.Plans.find(p=>p.id===k0.Plan)||{}).end)}
      ${socialFooter()}`;
    // insurance status per child (parent fills once; shows "กรอกแล้ว" if done)
    try{ const sts=await Promise.all(kids.map(k=>api('insuranceStatus',{studentId:k.StudentID})));
      $('#insCard').innerHTML=`<h3>🛡️ ${esc(t('ins2.manage'))}</h3>`+kids.map((k,i)=>{ const f=sts[i].filled;
        return `<div class="list-item"><span><b>${esc(nm(k))}</b> <span class="pill ${f?'ok':'wait'}">${f?'✓ '+esc(t('ins2.filled')):esc(t('ins2.notFilled'))}</span></span>
          <button class="btn sm ${f?'outline':''}" onclick="P_insurance('${k.StudentID}')">${f?esc(t('lbl.view')):esc(t('ins2.btn'))}</button></div>`; }).join('');
    }catch(e){ const c=$('#insCard'); if(c)c.remove(); }
  };
  // add another child: always ask "new student" vs "existing (verify by NationalID)"
  window.P_addChild = ()=>{ modal(`<h3>👶 ${esc(t('p.addChild'))}</h3>
    <p class="muted" style="font-size:13px">${esc(t('p.addChildSub'))}</p>
    <button class="btn block" onclick="this.closest('.modal').remove();REG_CHILD_FORM()">📝 ${esc(t('p.childNew'))}</button>
    <div style="height:10px"></div>
    <label class="field"><span>${esc(t('p.childExistingNID'))}</span><input id="lnNID" inputmode="numeric" placeholder="x-xxxx-xxxxx-xx-x"/></label>
    <button class="btn block outline" onclick="P_linkChild(this)">🔗 ${esc(t('p.childLink'))}</button>`); };
  window.P_linkChild = async (btn)=>{ const m=btn.closest('.modal'); const nid=m.querySelector('#lnNID').value.trim(); if(!nid){toast(EN()?'Enter National ID':'กรอกเลขบัตร');return;}
    try{ const r=await api('linkExisting',{uid:USER.uid,nationalId:nid}); m.remove(); confirmSaved((EN()?'Linked: ':'เชื่อมข้อมูลแล้ว: ')+(EN()?r.nameEN:r.name)); GO('home'); }catch(e){err(e);} };
  window.P_absence = async () => { const kids=await api('parentChildren',parentScope());
    const m=modal(`<h3>🏠 แจ้งลาบุตรหลาน</h3>
      <label class="field"><span>บุตรหลาน</span><select id="aKid">${kids.map(k=>`<option value="${k.StudentID}">${esc(nm(k))}</option>`).join('')}</select></label>
      <label class="field"><span>วันที่ลา</span><input type="date" id="aDate" value="${todayStr()}"/></label>
      <label class="field"><span>เหตุผล</span><textarea id="aReason" placeholder="เช่น ลากิจ / ไม่สบาย"></textarea></label>
      <button class="btn block" onclick="P_absenceDo(this)">ส่งแจ้งลา</button>`);
  };
  window.P_absenceDo = async (btn) => { const m=btn.closest('.modal');
    await api('studentAbsence',{studentId:m.querySelector('#aKid').value,date:m.querySelector('#aDate').value,reason:m.querySelector('#aReason').value});
    m.remove(); toast('✅ แจ้งลาแล้ว — ครูได้รับทราบ'); GO('home'); };

  // shared withdrawal reason picker (4 standard reasons; "other" reveals a long-text box)
  const WD_REASONS=['graduated','moved','transferred','other'];
  const withdrawReasonField=(selId,detId)=>`<label class="field"><span>${esc(t('wd.reason'))}</span>
      <select id="${selId}" onchange="WD_toggleDetail('${selId}','${detId}')">${WD_REASONS.map(r=>`<option value="${r}">${esc(t('wd.reason.'+r))}</option>`).join('')}</select></label>
    <label class="field" id="${detId}_wrap" hidden><span>${esc(t('wd.detail'))}</span><textarea id="${detId}" placeholder="${esc(t('wd.reason.other'))}"></textarea></label>`;
  window.WD_toggleDetail=(selId,detId)=>{ const w=document.getElementById(detId+'_wrap'); if(w)w.hidden=(document.getElementById(selId).value!=='other'); };
  // parent: self-service withdrawal / cancel enrolment request
  window.P_withdraw = async ()=>{ const kids=await api('parentChildren',parentScope());
    if(!kids.length){toast(t('p.noChild'));return;}
    const m=modal(`<h3>🚪 ${esc(t('wd.title'))}</h3><p class="muted" style="font-size:12px">${esc(t('wd.parentNote'))}</p>
      <label class="field"><span>${esc(t('lbl.selectChild'))}</span><select id="wdKid">${kids.map(k=>`<option value="${k.StudentID}">${esc(nm(k))}</option>`).join('')}</select></label>
      ${withdrawReasonField('wdReason','wdDetail')}
      <label class="field"><span>${esc(t('wd.effective'))}</span><input type="date" id="wdDate" value="${todayStr()}"/></label>
      <button class="btn block pink" onclick="P_withdrawDo(this)">${esc(t('wd.submit'))}</button>`); };
  window.P_withdrawDo = async (btn)=>{ const m=btn.closest('.modal'); const reason=m.querySelector('#wdReason').value; const detEl=m.querySelector('#wdDetail');
    try{ await api('requestWithdrawal',{parentId:USER.parentId,uid:USER.uid,studentId:m.querySelector('#wdKid').value,reason,detail:detEl?detEl.value.trim():'',effectiveDate:m.querySelector('#wdDate').value});
      m.remove(); confirmSaved(t('wd.submitted')); GO('home'); }catch(e){err(e);} };

  // ---- PCHI insurance form (shared by parent fill + admin edit) ----
  const insSel=(id,label,opts,val,req)=>`<label class="field"><span>${esc(label)}${req?' *':''}</span><select id="ins_${id}">${['',...(opts||[])].map(o=>`<option ${String(val||'')===String(o)?'selected':''}>${esc(o)}</option>`).join('')}</select></label>`;
  const insInp=(id,label,val,type,req)=>`<label class="field"><span>${esc(label)}${req?' *':''}</span><input id="ins_${id}" type="${type||'text'}" value="${esc(val!=null?val:'')}"/></label>`;
  function insuranceFormHTML(o,s,rec){ rec=rec||{}; const g=s.Gender==='M'?'Male':s.Gender==='F'?'Female':'';
    return `<div class="card"><h3>👶 ${esc(t('inj.child'))}</h3>
      <div class="grid2">${insSel('Title',t('ins2.titlePre'),o.Titles,rec.Title,1)}${insSel('MemberStatus',t('ins2.memberStatus'),o.MemberStatuses,rec.MemberStatus||'Child')}</div>
      <div class="grid2">${insInp('InsuredName',t('ins2.fname'),rec.InsuredName||s.NameEN||s.NameTH,'',1)}${insInp('InsuredMiddleName',t('ins2.mname'),rec.InsuredMiddleName)}</div>
      <div class="grid2">${insInp('InsuredLastName',t('ins2.lname'),rec.InsuredLastName,'',1)}${insSel('Gender',t('ins2.gender'),o.Genders,rec.Gender||g,1)}</div>
      <div class="grid2">${insInp('NationalID',t('ins2.nid'),rec.NationalID||s.NationalID,'',1)}${insInp('Passport',t('ins2.passport'),rec.Passport)}</div>
      <div class="grid2">${insInp('DOB',t('ins2.dob'),rec.DOB||s.DOB,'date',1)}${insSel('MaritalStatus',t('ins2.marital'),o.MaritalStatuses,rec.MaritalStatus||'Single')}</div>
      <div class="grid2">${insInp('Occupation',t('ins2.occupation'),rec.Occupation)}${insInp('EffectiveDate',t('ins2.effective'),rec.EffectiveDate,'date',1)}</div>
      ${insSel('Plan',t('ins2.plan'),o.Plans,rec.Plan,1)}</div>
    <div class="card"><h3>📞 ${esc(t('ins2.mobile'))} / ${esc(t('ins2.bankName'))}</h3>
      <div class="grid2">${insInp('Mobile',t('ins2.mobile'),rec.Mobile)}${insInp('Email',t('ins2.email'),rec.Email)}</div>
      <div class="grid2">${insInp('BankAccountName',t('ins2.bankName'),rec.BankAccountName)}${insInp('BankAccountNumber',t('ins2.bankNo'),rec.BankAccountNumber)}</div></div>
    <div class="card"><h3>🧑‍🤝‍🧑 ${esc(t('ins2.beneName'))}</h3>
      <div class="grid2">${insInp('BeneficiaryName',t('ins2.beneName'),rec.BeneficiaryName)}${insInp('BeneficiaryLastName',t('ins2.beneLast'),rec.BeneficiaryLastName)}</div>
      ${insSel('BeneficiaryRelationship',t('ins2.beneRel'),o.Relationships,rec.BeneficiaryRelationship)}
      <label class="field"><span>${esc(t('ins2.remarks'))}</span><textarea id="ins_Remarks">${esc(rec.Remarks||'')}</textarea></label></div>`; }
  function readInsuranceForm(){ const keys=['Title','MemberStatus','InsuredName','InsuredMiddleName','InsuredLastName','Gender','NationalID','Passport','DOB','MaritalStatus','Occupation','EffectiveDate','Plan','Mobile','Email','BankAccountName','BankAccountNumber','BeneficiaryName','BeneficiaryLastName','BeneficiaryRelationship','Remarks'];
    const d={}; keys.forEach(k=>{ const e=document.getElementById('ins_'+k); if(e)d[k]=e.value.trim(); }); return d; }
  function insValid(d){ return d.Title&&d.InsuredName&&d.InsuredLastName&&d.Plan&&d.EffectiveDate; }
  // parent: fill once / view if already filled
  window.P_insurance = async (sid)=>{ const st=await api('insuranceStatus',{studentId:sid}); const o=await api('insuranceOptions'); const s=MOCK.students.find(x=>x.StudentID===sid)||{};
    if(st.filled){ const r=st.record;
      app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('home')">${t('c.back')}</button><h2 class="page">🛡️ ${esc(t('ins2.title'))}</h2>
        <div class="card" style="background:#eaf7ee;border-color:#bfe3c9"><b style="color:#2e7d32">✓ ${esc(t('ins2.filledMsg'))}</b><br><small class="muted">${esc(t('ins2.filledBy'))}: ${esc(r.FilledBy||'')} · ${esc(r.FilledDate||'')}</small></div>
        <div class="card"><table style="width:100%;font-size:13px">
          ${[['ins2.titlePre',r.Title],['ins2.fname',r.InsuredName],['ins2.lname',r.InsuredLastName],['ins2.nid',r.NationalID],['ins2.dob',r.DOB],['ins2.plan',r.Plan],['ins2.effective',r.EffectiveDate],['ins2.beneName',(r.BeneficiaryName||'')+' '+(r.BeneficiaryLastName||'')],['ins2.beneRel',r.BeneficiaryRelationship]].map(x=>`<tr><td class="muted">${esc(t(x[0]))}</td><td style="text-align:right"><b>${esc(x[1]||'-')}</b></td></tr>`).join('')}
        </table></div>`; window.scrollTo(0,0); return; }
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('home')">${t('c.back')}</button><h2 class="page">🛡️ ${esc(t('ins2.title'))}</h2>
      <div class="card" style="background:#f7f9fc"><small class="muted">${esc(t('ins2.note'))}</small></div>
      ${insuranceFormHTML(o,s,null)}
      <button class="btn block" onclick="P_insuranceSave('${sid}')">${esc(t('ins2.save'))}</button>`; window.scrollTo(0,0); };
  window.P_insuranceSave = async (sid)=>{ const d=readInsuranceForm(); if(!insValid(d)){toast(t('ins2.required'));return;}
    try{ await api('submitInsurance',{studentId:sid,parentId:USER.parentId,uid:USER.uid,data:d}); confirmSaved(t('ins2.saved')); GO('home'); }catch(e){err(e);} };

  SCREENS.Parent.checkin = async () => {
    showAnnPopups(); // must close active announcements before checking in/out
    const kids=await api('parentChildren',parentScope());
    app.innerHTML = `<h2 class="page">${esc(t('title.checkin'))}</h2><div class="card">
      <label class="field"><span>เลือกบุตรหลาน</span><select id="kid">${kids.map(k=>`<option value="${k.StudentID}">${esc(nm(k))}</option>`).join('')}</select></label>
      <div class="seg"><button class="active" id="tIN" onclick="P_type('IN')">ส่งเข้าเรียน (IN)</button><button id="tOUT" onclick="P_type('OUT')">รับกลับ (OUT)</button></div>
      <button class="btn block green" onclick="P_do(true)">✅ ยืนยันที่โรงเรียน (จำลองในรัศมี)</button>
      <button class="btn block gray" style="margin-top:8px" onclick="P_do(false)">🧪 ทดสอบนอกรัศมี</button>
      <p class="muted" style="font-size:12px;margin-top:8px">รัศมี ${MOCK.config.Radius} ม. · ${MOCK.config.GPS_Lat}, ${MOCK.config.GPS_Lng}</p></div>
      <div class="card"><div class="spread"><h3>🗓️ ประวัติการรับ-ส่ง</h3><button class="btn sm outline" onclick="GO('home')">ดูในปฏิทิน →</button></div><div id="ciHist"></div></div>`;
    const hist=await api('studentCheckinHistory',{studentId:kids[0].StudentID});
    $('#ciHist').innerHTML=hist.map(h=>`<div class="list-item"><span>${esc(ddmmyyyy(h.Date))}</span><span><span class="pill ok">↓ ${esc(h.InTime||'--:--')}</span> <span class="pill info">↑ ${esc(h.OutTime||'--:--')}</span></span></div>`).join('')||'<small class="muted">ยังไม่มีประวัติ</small>';
  };
  let P_TYPE='IN'; window.P_type=t=>{P_TYPE=t;$('#tIN').classList.toggle('active',t==='IN');$('#tOUT').classList.toggle('active',t==='OUT');};
  window.P_do=async(inside)=>{ const studentId=$('#kid').value; const lat=inside?MOCK.config.GPS_Lat:13.80,lng=inside?MOCK.config.GPS_Lng:100.66;
    try{ const r=await api('parentCheckin',{parentId:USER.parentId,uid:USER.uid,studentId,type:P_TYPE,lat,lng});
      toast(`✅ ${P_TYPE==='IN'?(EN()?'Drop off':'ส่งเข้าเรียน'):(EN()?'Pick up':'รับกลับ')} ${r.time} (${EN()?'distance':'ระยะ'} ${r.distance} ${EN()?'m':'ม.'}) — ${EN()?'teacher notified':'แจ้งครูแล้ว'}`);
      if(r.ot){ P_otQR(r.ot); } // late pickup → OT charge: pop the KTB QR
    }catch(e){err(e);} };
  // OT charge popup after late pickup
  window.P_otQR=(ot)=>{ qrModalHTML({ title:'⏰ '+t('ot.title'),
      note:`${t('ot.late')} ${ot.lateMinutes} ${t('lbl.min')} · ${ot.hours} ${EN()?'hr':'ชม.'} × ${baht(MOCK.config.OTRatePerHour)} = `,
      amount:ot.amount, img:MOCK.config.QRCode_OT, imgName:'OT-'+ot.otId+'.png',
      extra:`<button class="btn block outline" style="margin-top:8px" onclick="this.closest('.modal').remove();GO('payment')">${esc(t('ot.goPay'))}</button>` }); };

  // generic PromptPay QR modal with a Save-image button
  function qrModalHTML(o){ const qr=o.img||'';
    // image when present (tap to zoom); a clean dashed placeholder otherwise. onerror swaps to placeholder via JS (no inline HTML).
    const imgEl = `<img id="qrImg" src="${esc(qr)}" alt="QR" style="width:210px;border-radius:8px;cursor:zoom-in" onclick="ZOOM_IMG('${esc(qr)}')" onerror="QR_PH(this)"/>`;
    const phEl = `<div class="qr-ph">QR</div>`;
    modal(`<div style="text-align:center"><h3>${esc(o.title||t('lbl.qr'))}</h3>
      ${qr?imgEl:phEl}
      <p>${o.note?`<span class="muted" style="font-size:12px">${esc(o.note)}</span><br>`:''}<b>${esc(t('c.total'))} ${baht(o.amount)} ${esc(EN()?'THB':'บาท')}</b></p>
      <button class="btn block" onclick="SAVE_IMG('${esc(qr)}','${esc(o.imgName||'qr.png')}')">💾 ${esc(t('lbl.saveQR'))}</button>
      ${o.extra||''}
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button></div>`); }
  window.QR_PH=(img)=>{ const d=document.createElement('div'); d.className='qr-ph'; img.replaceWith(d); };
  window.ZOOM_IMG=(url)=>{ if(!url)return; const m=document.createElement('div'); m.className='modal imgzoom'; m.innerHTML=`<img src="${esc(url)}" alt="QR"/>`; m.onclick=()=>m.remove(); document.body.appendChild(m); };
  window.SAVE_IMG=(url,name)=>{ if(!url){toast(EN()?'No QR image set yet (add it in config)':'ยังไม่ได้ตั้งรูป QR (เพิ่มใน config)');return;} const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); toast(EN()?'Saved '+name:'บันทึกรูปแล้ว'); };

  SCREENS.Parent.payment = async () => {
    const kids=await api('parentChildren',parentScope()); const sid=kids[0].StudentID; window._PAY_SID=sid;
    const [ps, ot, pre] = await Promise.all([api('payments',{studentId:sid}), api('otDaily',{studentId:sid}), api('prepayments',{studentId:sid})]);
    const per=EN()?'Period ':'งวด ';
    const verifyPill=`<span class="pill wait">${esc(t('pay.pendingVerify'))}</span>`;
    const preHtml=`<div class="card"><div class="spread"><h3>💰 ${esc(t('prepay.title'))}</h3><button class="btn sm" onclick="P_prepay('${sid}')">+ ${esc(t('prepay.pay'))}</button></div>
      <p class="muted" style="font-size:12px">${esc(t('prepay.note'))}</p>
      ${pre.length?pre.map(p=>{ const paid=p.Status==='PAID',pend=p.Status==='PENDING_VERIFY';
        return `<div class="list-item"><span>${esc(t('prepay.months').replace('{n}',p.Months))} <span class="pill ok">-${p.Discount}%</span> <small class="muted">${esc(p.Covered[0])}→${esc(p.Covered[p.Covered.length-1])}</small></span>
        <span><b>${baht(p.Amount)}</b> ${paid?`<span class="pill ok">${esc(t('prepay.paidAhead'))}</span>`:pend?verifyPill:`<button class="btn sm" onclick="P_payPrepay('${p.PrepayID}',${p.Amount})">${esc(t('lbl.pay'))}</button> <button class="btn sm gray" onclick="P_cash('prepay','${p.PrepayID}',${p.Amount})">💵</button>`}</span></div>`; }).join(''):''}</div>`;
    const otOpen=ot.filter(o=>o.Status!=='PAID'&&o.Status!=='PENDING_VERIFY');
    const otHtml = ot.length?`<div class="card"><h3>⏰ ${esc(t('ot.daily'))}</h3>
      ${ot.map(o=>{ const paid=o.Status==='PAID',pend=o.Status==='PENDING_VERIFY'; return `<div class="list-item"><span>${esc(ddmmyyyy(o.Date))} · ${esc(o.PickupTime)} <small class="muted">(${EN()?'late':'สาย'} ${o.LateMinutes}${esc(t('lbl.min'))} · ${o.Hours}${EN()?'h':'ชม.'})</small></span>
        <span><b>${baht(o.Amount)}</b> ${paid?`<span class="pill ok">${esc(t('s.paid'))}</span>`:pend?verifyPill:`<button class="btn sm" onclick="P_payOT('${o.OTID}',${o.Amount})">${esc(t('lbl.pay'))}</button> <button class="btn sm gray" onclick="P_cash('ot','${o.OTID}',${o.Amount})">💵</button>`}</span></div>`; }).join('')}
      ${otOpen.length?`<div class="spread" style="margin-top:8px"><b>${esc(t('ot.unpaidTotal'))}</b><b style="color:#c62828">${baht(otOpen.reduce((a,o)=>a+o.Amount,0))}</b></div><small class="muted">${esc(t('ot.rollNote'))}</small>`:''}</div>`:'';
    app.innerHTML = `<h2 class="page">${esc(t('title.payment'))}</h2>${preHtml}${otHtml}${ps.map(b=>{
      const paid=b.Status==='PAID',pend=b.Status==='PENDING_VERIFY'; const due=b.TotalDue!=null?b.TotalDue:b.Amount;
      const prepaid=b.VerifiedStatus==='PREPAID';
      return `<div class="card"><div class="spread"><b>${per}${esc(b.Month)}</b><span class="pill ${paid?'ok':pend?'wait':'bad'}">${prepaid?esc(t('prepay.paidAhead')):pend?esc(t('pay.pendingVerify')):esc(tStat(b.Status))}</span></div>
      <table style="width:100%;font-size:14px;margin:8px 0">${b.Items.map(it=>`<tr><td>${esc(trItem(it[0]))}</td><td style="text-align:right">${baht(it[1])}</td></tr>`).join('')}
      ${b.OTRollover?`<tr><td>${esc(t('ot.rollover'))}</td><td style="text-align:right">${baht(b.OTRollover)}</td></tr>`:''}
      <tr style="border-top:1px solid #ddd"><td><b>${esc(t('c.total'))}</b></td><td style="text-align:right"><b>${baht(due)}</b></td></tr></table>
      <small class="muted">${esc(t('c.due'))} ${esc(b.DueDate)}${b.PaidDate?' · '+esc(t('c.paid'))+' '+esc(b.PaidDate):''}</small>
      ${pend?`<div class="muted" style="margin-top:6px;font-size:12px">📎 ${esc(t('pay.submitted'))} ${baht(b.SlipAmount)} · ${esc(t('pay.awaitAdmin'))}</div>`:''}
      ${paid?`<div class="row" style="margin-top:10px"><button class="btn sm outline" onclick="P_receipt('${b.BillingID}')">🧾 ${esc(t('pay.receipt'))}</button></div>`:pend?'':`<div class="row" style="margin-top:10px"><button class="btn sm" onclick="P_qr('${b.BillingID}',${due})">${esc(t('lbl.qr'))}</button><button class="btn sm outline" onclick="P_slip('${b.BillingID}',${due})">${esc(t('lbl.attachSlip'))}</button><button class="btn sm gray" onclick="P_cash('bill','${b.BillingID}',${due})">💵 ${esc(t('pay.cash'))}</button></div>`}</div>`;
    }).join('')}`;
  };
  // prepay with discount: 2mo -5%, 3mo -10%, 6mo -20%, 12mo -30%
  window.P_prepay=async(sid)=>{ const s=MOCK.students.find(x=>x.StudentID===sid)||{}; const plan=MOCK.config.Plans.find(p=>p.id===s.Plan)||{price:0};
    const opt=(mo,disc)=>{ const gross=plan.price*mo, amt=Math.round(gross*(100-disc)/100); return `<button class="role-card" onclick="P_prepayDo('${sid}',${mo})"><span class="ic">${mo}</span><span><b>${esc(t('prepay.months').replace('{n}',mo))} · -${disc}%</b><br><small>${baht(gross)} → <b>${baht(amt)}</b></small></span></button>`; };
    modal(`<h3>💰 ${esc(t('prepay.title'))}</h3><p class="muted" style="font-size:12px">${esc(planLabel(s.Plan))} · ${baht(plan.price)}/${EN()?'mo':'เดือน'}</p>
      ${opt(2,5)}${opt(3,10)}${opt(6,20)}${opt(12,30)}
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.P_prepayDo=async(sid,months)=>{ try{ const r=await api('prepay',{studentId:sid,months}); const m=document.querySelector('.modal'); if(m)m.remove();
    confirmSaved(t('prepay.added').replace('{n}',months).replace('{d}',r.Discount)); GO('payment'); }catch(e){err(e);} };
  // pay a prepay charge: SCB QR + attach slip (kind 'prepay')
  window.P_payPrepay=(prepayId,amt)=>{ qrModalHTML({ title:'💰 '+t('prepay.title'), amount:amt,
    img:MOCK.config.QRCode_Monthly||MOCK.config.QRCode, imgName:'prepay-'+prepayId+'.png',
    extra:`<button class="btn block" style="margin-top:8px" onclick="this.closest('.modal').remove();P_slip('${prepayId}',${amt},'prepay')">📎 ${esc(t('lbl.attachSlip'))}</button>` }); };
  // printable receipt
  window.P_receipt=async(billingId)=>{ const ps=await api('payments',{studentId:window._PAY_SID}); const b=ps.find(x=>x.BillingID===billingId); if(!b)return;
    const s=MOCK.students.find(x=>x.StudentID===b.StudentID)||{}; openOrDownload(buildReceiptHTML(b,s),'receipt-'+billingId+'.html'); };
  // monthly QR = SCB (config.QRCode_Monthly, fallback legacy QRCode/PromptPayQR)
  window.P_qr=(id,amt)=>{ qrModalHTML({ title:'📲 '+t('pay.scanMonthly'), amount:amt,
    img:MOCK.config.QRCode_Monthly||MOCK.config.QRCode||MOCK.config.PromptPayQR, imgName:'monthly-'+id+'.png' }); };
  // paying OT: show the KTB QR (tap to zoom, save) + an "attach slip" button → then the slip modal
  window.P_payOT=(otId,amt)=>{ qrModalHTML({ title:'⏰ '+t('ot.title'), amount:amt,
    img:MOCK.config.QRCode_OT, imgName:'OT-'+otId+'.png',
    extra:`<button class="btn block" style="margin-top:8px" onclick="this.closest('.modal').remove();P_slip('${otId}',${amt},'ot')">📎 ${esc(t('lbl.attachSlip'))}</button>` }); };
  // attach slip + enter the transferred amount → system verifies amount matches before marking paid
  window.P_slip=(id,due,kind)=>{ modal(`<h3>📎 ${esc(t('slip.title'))}</h3><p class="muted" style="font-size:12px">${esc(t('slip.note'))}</p>
    <label class="field"><span>${esc(t('slip.amountDue'))}</span><input id="slipDue" value="${due}" data-due="${due}" disabled style="font-weight:700"/></label>
    <label class="field"><span>${esc(t('slip.file'))}</span><input type="file" id="slipF" accept="image/*" onchange="P_slipDetect(this)"/></label>
    <div style="text-align:center"><img id="slipPrev" alt="" style="max-height:200px;border-radius:8px;border:1px solid #eee;margin:4px 0;cursor:zoom-in" hidden onclick="ZOOM_IMG(this.src)"/></div>
    <label class="field"><span>${esc(t('slip.amountPaid'))}</span><input id="slipAmt" type="number" inputmode="decimal" placeholder="${esc(t('slip.amountPh'))}"/></label>
    <div id="qrDetect" class="muted" style="font-size:12px"></div>
    <button class="btn block" onclick="P_slipDo('${id}',this,'${kind||'monthly'}')">${esc(t('slip.upload'))}</button>`); };
  // try to read the QR in the attached slip image and extract the amount (EMVCo tag 54)
  window.P_slipDetect=async(inp)=>{ const f=inp.files[0]; const out=document.getElementById('qrDetect'); if(!f||!out)return;
    // show a preview of the chosen slip so the parent can review it
    const prev=document.getElementById('slipPrev'); if(prev){ const fr=new FileReader(); fr.onload=()=>{ prev.src=fr.result; prev.hidden=false; }; fr.readAsDataURL(f); }
    // Preferred: SlipOK server-side verification (available once GAS is deployed). Mock → falls back to BarcodeDetector.
    try{ const dataUrl=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(f);});
      const vk=await api('verifySlip',{slipData:dataUrl});
      if(vk&&vk.available&&vk.amount!=null){ const aEl=document.getElementById('slipAmt'); aEl.value=vk.amount; aEl.dataset.fromqr='1';
        const due=Number(document.getElementById('slipDue').dataset.due||0);
        out.innerHTML = vk.amount>=due? `✅ SlipOK ${esc(t('slip.qrMatch'))} ${baht(vk.amount)}` : `⚠️ SlipOK ${esc(t('slip.qrMismatch'))} ${baht(vk.amount)} / ${baht(due)}`; return; }
    }catch(e){}
    if(!('BarcodeDetector' in window)){ out.textContent='ℹ️ '+t('slip.qrUnsupported'); return; }
    out.textContent='⏳ '+t('slip.qrReading');
    try{ const bmp=await createImageBitmap(f); const det=new window.BarcodeDetector({formats:['qr_code']}); const codes=await det.detect(bmp);
      if(!codes.length){ out.textContent='ℹ️ '+t('slip.qrNone'); return; }
      const amt=parseEMVAmount(codes[0].rawValue);
      const due=Number(document.getElementById('slipDue').dataset.due||0);
      if(amt!=null){ const aEl=document.getElementById('slipAmt'); aEl.value=amt; aEl.dataset.fromqr='1';
        out.innerHTML = amt>=due? `✅ ${esc(t('slip.qrMatch'))} ${baht(amt)}` : `⚠️ ${esc(t('slip.qrMismatch'))} ${baht(amt)} / ${baht(due)}`;
      } else out.textContent='ℹ️ '+t('slip.qrNoAmount');
    }catch(e){ out.textContent='ℹ️ '+t('slip.qrNone'); } };
  // minimal EMVCo TLV parser → transaction amount (tag 54)
  function parseEMVAmount(s){ if(!s||typeof s!=='string')return null; let i=0;
    while(i+4<=s.length){ const tag=s.substr(i,2), len=parseInt(s.substr(i+2,2),10); if(isNaN(len))break; const val=s.substr(i+4,len);
      if(tag==='54'){ const n=parseFloat(val); return isNaN(n)?null:n; } i+=4+len; }
    return null; }
  window.P_slipDo=async(id,btn,kind)=>{ const m=btn.closest('.modal'); const aEl=m.querySelector('#slipAmt'); const f=m.querySelector('#slipF').files[0]; const amt=Number(aEl.value||0); const fromQR=aEl.dataset.fromqr==='1';
    if(!f){toast(EN()?'Please choose a slip file':'กรุณาเลือกไฟล์สลิป');return;}
    if(!amt){toast(EN()?'Enter the transferred amount':'กรอกยอดที่โอน');return;}
    const dataUrl=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(f);});
    try{ const slips=JSON.parse(localStorage.getItem('atom_slips')||'{}'); slips[id]={name:f.name,data:dataUrl,date:todayStr(),amount:amt}; localStorage.setItem('atom_slips',JSON.stringify(slips)); }catch(e){}
    try{ const args={slipName:f.name,slipAmount:amt,fromQR,slipData:dataUrl}; // slipData → stored centrally (Drive folder in GAS)
      const r= kind==='ot' ? await api('payOT',Object.assign({otId:id},args)) : kind==='prepay' ? await api('payPrepay',Object.assign({prepayId:id},args)) : await api('uploadSlip',Object.assign({billingId:id},args));
      m.remove();
      confirmSaved(r.amountMatch?t('slip.submittedMatch'):t('slip.submittedReview')); // both go to Admin for confirmation
      GO('payment'); }catch(e){err(e);} };
  // notify a CASH payment — staff confirm + record the payment date afterward
  window.P_cash=(kind,id,amt)=>{ modal(`<div style="text-align:center"><h3>💵 ${esc(t('pay.payCash'))}</h3>
    <p class="muted" style="font-size:12.5px">${esc(t('pay.cashNote'))}</p>
    <p><b>${esc(t('c.total'))} ${baht(amt)} ${esc(EN()?'THB':'บาท')}</b></p>
    <button class="btn block" onclick="P_cashDo('${kind}','${id}',${amt},this)">${esc(t('c.confirm'))}</button>
    <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button></div>`); };
  window.P_cashDo=async(kind,id,amt,btn)=>{ const m=btn.closest('.modal');
    try{ await api('notifyCash',{kind,id,amount:amt,parentId:USER.parentId,uid:USER.uid}); m.remove(); confirmSaved(t('pay.cashNotified')); GO('payment'); }catch(e){err(e);} };

  SCREENS.Parent.journal = async () => { const kids=await api('parentChildren',parentScope()); P_journal(kids[0].StudentID); };
  window.P_journal = async (sid) => { setNav('journal'); let j=await api('getJournal',{studentId:sid}); const hist=await api('journalHistory',{studentId:sid});
    app.innerHTML=`<h2 class="page">${esc(t('title.journal'))}</h2>${j?journalChecklist(j):waitCard()}
      <h3 class="page" style="font-size:16px">ย้อนหลัง</h3>${hist.map(h=>`<div class="list-item"><span>${esc(h.Date)} · ${esc(MOODS[h.Mood]||'')} ${esc(h.Mood||'')}</span><button class="btn sm outline" onclick="P_showJ('${h.StudentID}','${h.Date}')">ดู</button></div>`).join('')||'<small class="muted">ไม่มี</small>'}`;
  };
  window.P_showJ=async(sid,date)=>{ const j=await api('getJournal',{studentId:sid,date}); app.innerHTML=`<h2 class="page">📒 ${esc(date)}</h2>${journalChecklist(j)}<button class="btn outline" onclick="GO('journal')">← กลับ</button>`; window.scrollTo(0,0); };

  SCREENS.Parent.dspm = async () => { const kids=await api('parentChildren',parentScope()); P_dspm(kids[0].StudentID); };
  const DSPM_PILL=r=>{const c=r==='ผ่าน'?'ok':r==='ไม่ผ่าน'?'bad':'wait';return `<span class="pill ${c}">${esc(tStat(r))}</span>`;};
  const DT_KEY={GM:'dom.GM',FM:'dom.FM',RL:'dom.RL',EL:'dom.EL',PS:'dom.PS'};
  const DT=new Proxy({},{get:(_,k)=>t(DT_KEY[k]||k)});
  window.P_dspm = async (sid) => { setNav('dspm'); const [s,all,g,vsched,vrecs]=await Promise.all([api('dspmStatus',{studentId:sid}),api('studentAllBands',{studentId:sid}),api('growthHistory',{studentId:sid}),api('vaccineSchedule'),api('studentVaccines',{studentId:sid})]); const st=MOCK.students.find(x=>x.StudentID===sid)||{};
    const past=all.bands.filter(b=>b.label!==s.ageLabel);
    app.innerHTML=`<h2 class="page">${esc(t('title.dspm'))}</h2>
      <div class="card"><h3>📈 ${esc(t('growth.chartTitle'))}</h3><p class="muted" style="font-size:12px">${esc(t('growth.chartSub'))}</p>
        ${growthChartSVG(t('growth.weight'),g.records.map(r=>({x:r.AgeMonth,y:r.Weight})),g.weightBand,'kg')}
        ${growthChartSVG(t('growth.height'),g.records.map(r=>({x:r.AgeMonth,y:r.Height})),g.heightBand,'cm')}
        <div class="row" style="font-size:11px;justify-content:center;margin-top:6px"><span>🟦 ${esc(t('growth.actual'))}</span><span>🟩 ${esc(t('growth.normalBand'))}</span></div>
        ${growthRecordsList(g.records)}</div>
      ${vaccineCard(vsched,vrecs,sid,true)}
      <div class="card"><div class="spread"><b>${esc(nm(st)||sid)}</b><span class="muted">${s.ageMonth} เดือน</span></div>
        <div class="spread"><b style="color:#1565C0">⭐ ช่วงวัยปัจจุบัน: ${esc(s.ageLabel)}</b></div>
        <p class="muted" style="font-size:12.5px">แสดงทุกข้อของช่วงวัยนี้ ที่ยังไม่ประเมินจะขึ้น "ยังไม่ได้รับการทดสอบ"</p>
        ${s.manualUrl?`<a class="btn sm outline" href="${esc(s.manualUrl)}" target="_blank">⬇️ ดาวน์โหลดคู่มือ DSPM</a>`:''}
        ${s.items.map(i=>`<div class="list-item"><span><b>ข้อ ${i.itemNo}</b> <span class="pill info">${i.skill}</span> · ${DT[i.skill]||''}<br><small>${esc(EN()&&i.descriptionEN?i.descriptionEN:i.description)}</small></span>${DSPM_PILL(i.result)}</div>`).join('')}</div>
      ${past.length?`<h3 class="page" style="font-size:16px">📜 ผลย้อนหลัง (ช่วงวัยก่อนหน้า)</h3>`+past.reverse().map(b=>`<div class="card"><h3 style="font-size:14px">${esc(b.label)}</h3>${b.items.map(i=>`<div class="list-item"><span><b>ข้อ ${i.itemNo}</b> <span class="pill info">${i.skill}</span> <small>${esc(EN()&&i.descriptionEN?i.descriptionEN:i.description)}</small></span>${DSPM_PILL(i.result)}</div>`).join('')}</div>`).join(''):''}`;
  };

  SCREENS.Parent.chat = async () => { const line=MOCK.config.Links.line||'#';
    app.innerHTML=`<h2 class="page">${esc(t('title.chat'))}</h2>
      <div class="card" style="text-align:center"><div style="font-size:48px">💬</div>
        <p>${esc(t('chat.lineMsg'))}</p>
        <a class="btn block green" href="${esc(line)}" target="_blank">${esc(t('chat.openLine'))} →</a>
        <p class="muted" style="font-size:12px;margin-top:10px">${esc(t('chat.lineNote'))}</p></div>`;
  };
  function bubble(c){ const me=c.SenderRole==='Parent'; return `<div style="display:flex;justify-content:${me?'flex-end':'flex-start'};margin:6px 0"><div style="max-width:80%;background:${me?'#e3f2fd':'#f1f1f1'};padding:8px 12px;border-radius:12px"><div style="font-size:11px;color:#888">${esc(c.SenderName||c.SenderRole)}</div><div style="font-size:14px">${esc(c.Message)}</div><div class="muted" style="font-size:10px;text-align:right">${esc(c.Timestamp)}</div></div></div>`; }
  window.P_send=async(sid)=>{ const v=$('#msg').value.trim(); if(!v)return; await api('addComment',{studentId:sid,parentId:USER.parentId,senderRole:'Parent',senderName:USER.nameEN,message:v}); SCREENS.Parent.chat(); };

  // ================= TEACHER =================
  SCREENS.Teacher.home = async () => {
    const me0=MOCK.staff.find(s=>s.StaffID===USER.staffId);
    if(me0 && me0.MustChangePassword){ T_changePw(true); return; } // force password change on first login
    const [att,recent,cl,quota] = await Promise.all([api('myAttendanceToday',{staffId:USER.staffId}),api('recentAttendance',{staffId:USER.staffId}),api('classList',{staffId:USER.staffId}),api('leaveQuota',{staffId:USER.staffId})]);
    const isLeader = MOCK.staff.find(s=>s.StaffID===USER.staffId).PositionLevel==='Leader';
    const recentRows = recent.map((a,i)=>`<div class="list-item"><span>${i===0?'<b>'+esc(t('c.today'))+'</b>':esc(ddmmyyyy(a.date))}</span><span style="font-size:13px">${esc(t('lbl.checkIn'))} <b>${a.checkIn||'--:--'}</b> · ${esc(t('lbl.checkOut'))} <b>${a.checkOut||'--:--'}</b> · ${a.late?`<span class="pill bad">${esc(t('lbl.late'))} ${a.late} ${esc(t('lbl.min'))}</span>`:`<span class="pill ok">${esc(t('lbl.onTime'))}</span>`}</span></div>`).join('');
    app.innerHTML = `<h2 class="page">${esc(t('t.greeting'))}${esc(EN()?USER.nameEN:USER.nameTH)} 👩‍🏫</h2>
      <div class="card"><h3>⏱️ ${esc(t('lbl.worktime'))} (${esc(att.date)})</h3>
        ${me0.RequireCheckin===false?`<div style="background:#eef6ff;border-radius:8px;padding:8px;color:#1565C0;font-size:13px">ℹ️ ${esc(t('ci.notRequired'))}</div>`:`
        <div class="spread" style="font-size:15px"><span>${esc(t('lbl.checkIn'))} <b>${att.checkIn||'--:--'}</b></span><span>${esc(t('lbl.checkOut'))} <b>${att.checkOut||'--:--'}</b></span><span>${esc(t('lbl.late'))} <b style="color:${att.late?'#c62828':'#2e7d32'}">${att.late||0}</b> ${esc(t('lbl.min'))}</span></div>
        <div class="row" style="margin-top:10px"><button class="btn green sm" onclick="T_punch('in',true)">${esc(t('lbl.checkIn'))}</button><button class="btn pink sm" onclick="T_punch('out',true)">${esc(t('lbl.checkOut'))}</button><button class="btn gray sm" onclick="T_punch('in',false)">🧪 ${esc(t('lbl.testOutside'))}</button></div>
        <div style="margin-top:10px"><b style="font-size:13px">📅 ${esc(t('lbl.recentDays'))}</b>${recentRows}</div>`}</div>
      <div class="card"><h3>📩 การลาของฉัน · สิทธิคงเหลือ</h3>
        <div class="quota">${quota.map(q=>`<div class="q"><div class="n">${q.remain}</div><div class="l">${esc(q.type)}<br>${q.used}/${q.quota}</div></div>`).join('')}</div>
        <div id="ml" style="margin-top:8px"></div><button class="btn sm outline" style="margin-top:6px" onclick="GO('leave')">+ ยื่น/ดูใบลา</button></div>
      ${isLeader?`<div class="card"><div class="spread"><h3>⭐ คำขอลาของลูกน้อง (รออนุมัติ)</h3></div><div id="tp"></div></div>`:''}
      <div class="card"><div class="row"><button class="btn sm outline" onclick="GO('absence')">🔎 ${esc(t('abs.title'))}</button></div></div>
      <div class="card"><div class="spread"><h3>👶 ${esc(cl.class.ClassName)}</h3><span class="muted">${cl.students.length} คน</span></div>
        ${cl.students.map(s=>`<div class="list-item"><span>${studentAvatar(s)} ${esc(nm(s))}</span><span><button class="btn sm outline" onclick="T_journal('${s.StudentID}')">บันทึก</button> <button class="btn sm outline" onclick="T_assess('${s.StudentID}')">ประเมิน</button></span></div>`).join('')}</div>`;
    const ml=await api('myLeaves',{staffId:USER.staffId}); $('#ml').innerHTML=ml.map(leaveRow).join('')||'<small class="muted">ยังไม่มีรายการ</small>';
    if(isLeader){ const tp=await api('teamPendingLeaves',{staffId:USER.staffId}); $('#tp').innerHTML=tp.map(l=>teamLeaveRow(l)).join('')||'<small class="muted">ไม่มีคำขอรออนุมัติ</small>'; }
  };
  window.T_punch=async(kind,inside)=>{ const lat=inside?MOCK.config.GPS_Lat:13.80,lng=inside?MOCK.config.GPS_Lng:100.66;
    try{ const r=await api(kind==='in'?'staffCheckin':'staffCheckout',{staffId:USER.staffId,lat,lng}); toast(kind==='in'?`✅ ${t('lbl.checkIn')} ${r.time}${r.lateMinutes>0?` (${t('lbl.late')} ${r.lateMinutes} ${t('lbl.min')})`:' ('+t('lbl.onTime')+')'}`:`✅ ${t('lbl.checkOut')} ${r.time}${r.otHours>0?` · OT ${r.otHours} ${EN()?'hr':'ชม.'}`:''}`); GO('home'); }catch(e){err(e);} };

  SCREENS.Teacher.class = async () => { const cl=await api('classList',{staffId:USER.staffId});
    app.innerHTML=`<h2 class="page">👶 ${esc(cl.class.ClassName)}</h2>`+cl.students.map(s=>`<div class="card spread"><div style="display:flex;gap:10px;align-items:center">${studentAvatar(s)}<div><b>${esc(nm(s))}</b>${nick(s)?` <span class="pill info">${esc(nick(s))}</span>`:''} <small class="muted">(${esc(EN()?s.NameTH:s.NameEN)})</small><br><small class="muted">${esc(ageYM(s.DOB))} · ${EN()?'allergy':'แพ้'}: ${esc(s.Allergy||'-')}</small></div></div><div class="row"><button class="btn sm" onclick="T_journal('${s.StudentID}')">📒</button><button class="btn sm outline" onclick="T_assess('${s.StudentID}')">📝</button></div></div>`).join(''); };

  SCREENS.Teacher.journal = async () => { const cl=await api('classList',{staffId:USER.staffId}); T_journal(cl.students[0].StudentID); };
  let JSEL={};
  window.T_journal = async (sid) => { setNav('class'); JSEL={Mood:'',Health:'',Water:'',Meals:{},Toilet:{},Activity:new Set(),Skills:new Set()};
    const s=(await api('classList',{staffId:USER.staffId})).students.find(x=>x.StudentID===sid)||{NameTH:sid};
    const seg=(group,arr,multi)=>arr.map(v=>`<button type="button" onclick="J_pick('${group}','${v.replace(/'/g,"\\'")}',this,${multi})">${esc(jt(v))}</button>`).join('');
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('class')">${t('c.back')}</button><h2 class="page">📒 กรอกบันทึก — ${esc(nm(s))}</h2><div class="card">
      <div class="jsec"><h4>😊 ${esc(jt('Mood'))} *</h4><div class="choice" id="g_Mood">${Object.keys(MOODS).map(m=>`<button type="button" onclick="J_pick('Mood','${m}',this,false)">${MOODS[m]} ${esc(jt(m))}</button>`).join('')}</div></div>
      <div class="jsec"><h4>❤️ ${esc(jt('Health'))}</h4><div class="choice">${seg('Health',HEALTHS,false)}</div>
        <div class="row" style="margin-top:6px"><input id="jHealthD" placeholder="รายละเอียดสุขภาพ/ยา" style="flex:1"/><button class="micbtn" onclick="J_mic('jHealthD',this)">🎤</button></div></div>
      <div class="jsec"><h4>🍼 ${esc(jt('Milk & Water'))}</h4><input id="jMilk" placeholder="ปริมาณนม oz คั่นด้วย , เช่น 6,4"/>
        <div class="choice" style="margin-top:6px">${seg('Water',WATERS,false)}</div></div>
      <div class="jsec"><h4>🍽 ${esc(jt('Meals'))}</h4>${['Breakfast','Lunch','Dinner'].map(m=>`<div style="margin:4px 0"><b style="font-size:13px">${esc(jt(m))}:</b> <span class="choice" style="display:inline-flex">${MEAL_AMT.map(a=>`<button type="button" onclick="J_meal('${m}','${a}',this)">${esc(jt(a))}</button>`).join('')}</span></div>`).join('')}</div>
      <div class="jsec"><h4>😴 ${esc(jt('Sleep'))}</h4><input id="jSleep" placeholder="เช่น 12:30-14:00 (คั่นหลายช่วงด้วย ,)"/></div>
      <div class="jsec"><h4>🚽 ${esc(jt('Toileting'))}</h4>
        <div><b style="font-size:13px">${esc(jt('Urination'))}:</b> <span class="choice" style="display:inline-flex">${URI.map(x=>`<button type="button" onclick="J_tl('Urination','${x}',this)">${esc(jt(x))}</button>`).join('')}</span></div>
        <div><b style="font-size:13px">${esc(jt('Bowel'))}:</b> <span class="choice" style="display:inline-flex">${BOWEL.map(x=>`<button type="button" onclick="J_tl('Bowel','${x}',this)">${esc(jt(x))}</button>`).join('')}</span></div>
        <div><b style="font-size:13px">${esc(jt('Stool'))}:</b> <span class="choice" style="display:inline-flex">${STOOL.map(x=>`<button type="button" onclick="J_tl('Stool','${x}',this)">${esc(jt(x))}</button>`).join('')}</span></div>
        <div><b style="font-size:13px">${esc(jt('Toilet Training'))}:</b> <span class="choice" style="display:inline-flex">${TT.map(x=>`<button type="button" onclick="J_tl('Training','${x}',this)">${esc(jt(x))}</button>`).join('')}</span></div></div>
      <div class="jsec"><h4>🎨 ${esc(jt('Learning Journey'))}</h4><div class="choice">${seg('Activity',ACTS,true)}</div><input id="jTheme" placeholder="Theme / Topic" style="margin-top:6px"/></div>
      <div class="jsec"><h4>🌟 ${esc(jt('Skills'))}</h4><div class="choice">${seg('Skills',SKILLS,true)}</div></div>
      <div class="jsec"><h4>⭐ ${esc(jt('Highlight'))}</h4><div class="row"><textarea id="jHi" placeholder="เหตุการณ์น่าประทับใจ... (กดไมค์เพื่อพูด)" style="flex:1"></textarea><button class="micbtn" onclick="J_mic('jHi',this)">🎤</button></div></div>
      <button class="btn block" onclick="T_saveJournal('${sid}')">บันทึก & แจ้งผู้ปกครอง</button></div>`;
  };
  window.J_pick=(g,v,el,multi)=>{ if(multi){ JSEL[g].has(v)?JSEL[g].delete(v):JSEL[g].add(v); el.classList.toggle('pass'); }
    else { JSEL[g]=v; [...el.parentElement.children].forEach(b=>b.classList.remove('pass')); el.classList.add('pass'); } };
  window.J_meal=(m,a,el)=>{ JSEL.Meals[m]=a; [...el.parentElement.children].forEach(b=>b.classList.remove('pass')); el.classList.add('pass'); };
  window.J_tl=(k,v,el)=>{ JSEL.Toilet[k]=v; [...el.parentElement.children].forEach(b=>b.classList.remove('pass')); el.classList.add('pass'); };
  window.J_mic=(targetId,btn)=>{ const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){ toast('เบราว์เซอร์นี้ไม่รองรับ Voice — ใช้ Chrome บนมือถือ/คอม'); return; }
    const rec=new SR(); rec.lang='th-TH'; rec.interimResults=false; btn.classList.add('rec'); btn.textContent='● ฟัง...';
    rec.onresult=e=>{ const t=e.results[0][0].transcript; const el=document.getElementById(targetId); el.value=(el.value?el.value+' ':'')+t; };
    rec.onerror=()=>toast('ฟังไม่สำเร็จ ลองใหม่'); rec.onend=()=>{ btn.classList.remove('rec'); btn.textContent='🎤'; }; rec.start(); };
  window.T_saveJournal=async(sid)=>{ const milk=($('#jMilk').value||'').split(',').map(x=>+x.trim()).filter(x=>x);
    const sleep=($('#jSleep').value||'').split(',').map(x=>x.trim()).filter(Boolean).map(s=>({from:(s.split('-')[0]||'').trim(),to:(s.split('-')[1]||'').trim()}));
    try{ const r=await api('submitJournal',{studentId:sid,staffId:USER.staffId,Mood:JSEL.Mood,Health:JSEL.Health,HealthDetail:$('#jHealthD').value,Milk:milk,MilkTotal:milk.reduce((a,b)=>a+b,0),Water:JSEL.Water,Meals:JSEL.Meals,Sleep:sleep,Toilet:JSEL.Toilet,Activity:[...JSEL.Activity],Theme:$('#jTheme').value,Skills:[...JSEL.Skills],Highlight:$('#jHi').value});
      confirmSaved(r.updated?'อัปเดตบันทึกแล้ว — แจ้งผู้ปกครอง':'บันทึกแล้ว — แจ้งผู้ปกครอง'); GO('class'); }catch(e){err(e);} };

  // ===== injury / accident report (แบบบันทึกการบาดเจ็บรายบุคคล) — teacher & leader =====
  SCREENS.Teacher.injury = async () => {
    const [cl,recent]=await Promise.all([api('classList',{staffId:USER.staffId}),api('injuryReports',{})]);
    const radio=(name,val,label,checked)=>`<label class="chk-inline"><input type="radio" name="${name}" value="${val}" ${checked?'checked':''}/> ${esc(label)}</label>`;
    app.innerHTML=`<h2 class="page">🚑 ${esc(t('inj.title'))}</h2>
      <div class="card">
        <div class="grid2"><label class="field"><span>${esc(t('inj.date'))}</span><input type="date" id="injDate" value="${todayStr()}"/></label>
          <label class="field"><span>${esc(t('inj.time'))}</span><input type="time" id="injTime" value="${nowTime()}"/></label></div>
        <label class="field"><span>${esc(t('inj.center'))}</span><input id="injCenter" value="${esc(MOCK.config.SchoolName||'')}"/></label>
        <div class="jsec"><h4>${esc(t('inj.affiliation'))}</h4>
          ${radio('injAff','social',t('inj.aff.social'),true)} ${radio('injAff','other',t('inj.aff.other'),false)}
          <input id="injAffOther" placeholder="${esc(t('inj.aff.other'))}" style="margin-top:6px"/>
          <label class="field" style="margin-top:6px"><span>${esc(t('inj.district'))}</span><input id="injDistrict"/></label></div>
        <label class="field"><span>${esc(t('inj.recorder'))}</span><input id="injRecorder" value="${esc(EN()?USER.nameEN:USER.nameTH)}"/></label>
      </div>
      <div class="card"><h3>👶 ${esc(t('inj.child'))}</h3>
        <label class="field"><span>${esc(t('inj.selectChild'))}</span><select id="injChild">${cl.students.map(s=>`<option value="${s.StudentID}">${esc(nm(s))} (${esc(ageYM(s.DOB))})</option>`).join('')}</select></label>
        <div class="jsec"><h4>${esc(t('inj.sex'))}</h4>${radio('injSex','M',t('inj.male'),false)} ${radio('injSex','F',t('inj.female'),false)}</div>
        <div class="grid2"><label class="field"><span>${esc(t('inj.age'))} (${esc(t('inj.years'))})</span><input type="number" id="injAgeY" placeholder="–"/></label><label class="field"><span>${esc(t('inj.age'))} (${esc(t('inj.months'))})</span><input type="number" id="injAgeM" placeholder="–"/></label></div>
        <div class="jsec"><h4>${esc(t('inj.edu'))}</h4>${radio('injEdu','none',t('inj.edu.none'),false)} ${radio('injEdu','grade',t('inj.edu.grade'),true)}
          <input id="injGrade" placeholder="${esc(t('inj.edu.grade'))}" style="margin-top:6px"/></div>
      </div>
      <div class="card"><h3>📝 ${esc(t('inj.narrative'))}</h3><p class="muted" style="font-size:12px">${esc(t('inj.narrativeHint'))}</p>
        <textarea id="injNarr" rows="3"></textarea>
        <label class="field" style="margin-top:8px"><span>${esc(t('inj.cause'))}</span><input id="injCause" placeholder="${esc(t('inj.causePh'))}"/></label>
        <div class="jsec"><h4>${esc(t('inj.witness'))}</h4>${radio('injWit','yes',t('inj.witness.yes'),false)} ${radio('injWit','no',t('inj.witness.no'),false)} ${radio('injWit','unsure',t('inj.witness.unsure'),true)}</div>
      </div>
      <div class="card"><h3>📍 ${esc(t('inj.place'))}</h3>
        ${PLACE_OPTS.map((p,i)=>radio('injPlace',p[0],t(p[1]),i===1)).join(' ')}
        <input id="injPlaceOther" placeholder="${esc(t('inj.place.other'))}" style="margin-top:6px"/></div>
      <div class="card"><h3>🩹 ${esc(t('inj.types'))}</h3>
        ${INJURY_TYPES.map(it=>`<label class="chk-inline" style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-bottom:1px solid #f0f0f0"><input type="checkbox" class="injType" value="${it.n}" style="width:auto;margin-top:3px"/> <span><b>${it.n}.</b> ${esc(EN()?it.en:it.th)}</span></label>`).join('')}</div>
      <button class="btn block pink" onclick="T_injurySave()">${esc(t('inj.save'))}</button>
      <div class="card" style="margin-top:12px"><h3>🗒️ ${esc(t('inj.recent'))}</h3><div id="injRecent">${injuryListHTML(recent)}</div></div>`;
  };
  function injuryListHTML(rows){ if(!rows||!rows.length)return `<small class="muted">${esc(t('c.noItems'))}</small>`;
    return rows.slice(0,10).map(r=>{ const types=(r.InjuryTypes||[]).map(n=>{const it=INJURY_TYPES.find(x=>x.n===n);return it?(EN()?it.en:it.th):n;}).join(', ');
      return `<div class="list-item"><span><b>${esc(EN()?(r.nameEN||r.ChildName):r.ChildName)}</b> <small class="muted">${esc(r.Date)} ${esc(r.Time)}</small><br><small class="muted">${esc(types)}</small></span></div>`; }).join(''); }
  window.T_injurySave = async ()=>{ const v=id=>{ const e=$(id); return e?e.value.trim():''; };
    const rad=name=>{ const e=document.querySelector(`input[name="${name}"]:checked`); return e?e.value:''; };
    const types=[...document.querySelectorAll('.injType:checked')].map(c=>Number(c.value));
    const studentId=$('#injChild')&&$('#injChild').value;
    if(!studentId){toast(t('inj.needChild'));return;}
    if(!types.length){toast(t('inj.needType'));return;}
    try{ await api('submitInjury',{staffId:USER.staffId,date:v('#injDate'),time:v('#injTime'),centerName:v('#injCenter'),
      affiliationType:rad('injAff'),affiliationOther:v('#injAffOther'),district:v('#injDistrict'),recorderName:v('#injRecorder'),
      studentId,sex:rad('injSex'),ageYears:v('#injAgeY')!==''?+v('#injAgeY'):undefined,ageMonths:v('#injAgeM')!==''?+v('#injAgeM'):undefined,
      eduStatus:rad('injEdu'),eduGrade:v('#injGrade'),narrative:v('#injNarr'),causeObject:v('#injCause'),witness:rad('injWit'),
      place:rad('injPlace'),placeOther:v('#injPlaceOther'),injuryTypes:types});
      confirmSaved(t('inj.saved')); GO('injury'); }catch(e){err(e);} };

  SCREENS.Teacher.dspm = async () => { const cl=await api('classList',{staffId:USER.staffId}); T_assess(cl.students[0].StudentID); };
  let ASEL={};
  window.T_assess = async (sid) => { setNav('class'); ASEL={};
    const due=await api('growthDue',{studentId:sid});
    let c; try{ c=await api('dspmStatus',{studentId:sid}); }catch(e){ app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('class')">${t('c.back')}</button><h2 class="page">📝 ประเมิน DSPM</h2><div class="card muted">${esc(e.message)}</div>`; return; }
    const s=(await api('classList',{staffId:USER.staffId})).students.find(x=>x.StudentID===sid)||{NameTH:sid};
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('class')">${t('c.back')}</button><h2 class="page">📝 ประเมิน DSPM — ${esc(nm(s))}</h2>
      <div class="card"><div class="spread"><span>ช่วงอายุ: <b>${esc(c.ageLabel)}</b></span><span class="muted">${c.ageMonth} เดือน</span></div>
      <p class="muted" style="font-size:12px">เลือก "ยังไม่ได้ประเมิน" ได้ เพื่อให้ผู้ปกครองทราบว่ายังมีหัวข้อที่ต้องประเมิน · เทียบกับคู่มือที่ดาวน์โหลด</p>
      ${c.manualUrl?`<a class="btn sm outline" href="${esc(c.manualUrl)}" target="_blank">⬇️ ดาวน์โหลดคู่มือ DSPM</a>`:''}</div>
      ${c.items.map(i=>`<div class="card"><div style="margin-bottom:8px"><b>${EN()?'Item':'ข้อ'} ${i.itemNo}</b> <span class="pill info">${i.skill}</span> ${i.result!=='ยังไม่ได้รับการทดสอบ'?`<span class="pill ${i.result==='ผ่าน'?'ok':'bad'}">${EN()?'prev':'เดิม'}: ${esc(tStat(i.result))}</span>`:''}<br>${esc(EN()&&i.descriptionEN?i.descriptionEN:i.description)}</div>
        <div class="choice"><button id="p${i.itemNo}" onclick="A_set(${i.itemNo},'pass')">✅ ${esc(t('s.pass'))}</button><button id="f${i.itemNo}" onclick="A_set(${i.itemNo},'fail')">❌ ${esc(t('s.fail'))}</button><button id="n${i.itemNo}" onclick="A_set(${i.itemNo},'nottested')">⊘ ${EN()?'Not assessed':'ยังไม่ได้ประเมิน'}</button></div></div>`).join('')}
      <div class="card"><h3>📏 ${esc(t('growth.section'))}</h3>
        ${due.due?`<div style="background:#fff8e1;border-radius:8px;padding:8px;color:#8a6d00;font-size:12.5px;margin-bottom:8px">⚠️ ${esc(t('growth.gate'))}</div>`:''}
        <div style="text-align:center;margin-bottom:8px">${studentAvatar(s)}</div>
        <div class="grid2"><label class="field"><span>${esc(t('reg.weight'))} (kg)</span><input id="guW" type="number" value="${esc(s.Weight||'')}"/></label>
          <label class="field"><span>${esc(t('reg.height'))} (cm)</span><input id="guH" type="number" value="${esc(s.Height||'')}"/></label></div>
        <label class="field"><span>${esc(t('growth.photo'))}</span><input id="guPhoto" type="file" accept="image/*"/></label></div>
      <button class="btn block" onclick="T_saveAssess('${sid}')">${esc(t('growth.saveBoth'))}</button>`;
  };
  window.A_set=(item,val)=>{ ASEL[item]=val; ['p','f','n'].forEach(pre=>{const el=document.getElementById(pre+item);if(el)el.classList.remove('pass','fail');});
    if(val==='pass')$('#p'+item).classList.add('pass'); if(val==='fail')$('#f'+item).classList.add('fail'); if(val==='nottested')$('#n'+item).classList.add('pass'); };

  // Group C: bi-monthly growth update (height/weight/photo). gate=true when blocking assessment.
  window.T_growthUpdate = async (sid, gate)=>{ setNav('class');
    const s=(await api('classList',{staffId:USER.staffId})).students.find(x=>x.StudentID===sid)||{NameTH:sid};
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('class')">${t('c.back')}</button>
      <h2 class="page">📏 ${esc(t('growth.update'))} — ${esc(nm(s))}</h2>
      ${gate?`<div class="card" style="background:#fff8e1;border-color:#f0e3b0;color:#8a6d00">⚠️ ${esc(t('growth.gate'))}</div>`:''}
      <div class="card">
        <div style="text-align:center;margin-bottom:8px">${studentAvatar(s)}</div>
        <div class="grid2"><label class="field"><span>${esc(t('reg.weight'))} (kg)</span><input id="guW" type="number" value="${esc(s.Weight||'')}"/></label>
          <label class="field"><span>${esc(t('reg.height'))} (cm)</span><input id="guH" type="number" value="${esc(s.Height||'')}"/></label></div>
        <label class="field"><span>${esc(t('growth.photo'))}</span><input id="guPhoto" type="file" accept="image/*"/></label>
        <button class="btn block" onclick="T_growthSave('${sid}',${gate?'true':'false'})">${esc(t('c.save'))}</button></div>`;
  };
  window.T_growthSave = async (sid, gate)=>{ const w=+$('#guW').value||null, h=+$('#guH').value||null;
    if(!w||!h){toast(EN()?'Enter weight & height':'กรอกน้ำหนักและส่วนสูง');return;}
    const pf=$('#guPhoto').files[0]; let photo=''; if(pf) photo=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(pf);});
    try{ await api('updateGrowth',{studentId:sid,weight:w,height:h,photo}); confirmSaved(t('growth.saved'));
      if(gate) T_assess(sid); else GO('class'); }catch(e){err(e);} };
  window.T_saveAssess=async(sid)=>{ const results=Object.keys(ASEL).map(k=>({itemNo:Number(k),result:ASEL[k]}));
    // also persist the growth fields shown below the assessment (weight/height/photo)
    const w=+$('#guW').value||null, h=+$('#guH').value||null; const pf=$('#guPhoto')&&$('#guPhoto').files[0];
    let photo=''; if(pf) photo=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(pf);});
    if(!results.length && !(w&&h)){toast(EN()?'Assess at least 1 item or enter weight/height':'เลือกผลอย่างน้อย 1 ข้อ หรือกรอกน้ำหนัก/ส่วนสูง');return;}
    try{ if(results.length) await api('submitAssessment',{studentId:sid,staffId:USER.staffId,results});
      if(w&&h) await api('updateGrowth',{studentId:sid,weight:w,height:h,photo});
      confirmSaved(EN()?'Saved — parent notified':'บันทึกแล้ว — แจ้งผู้ปกครอง'); GO('class'); }catch(e){err(e);} };

  SCREENS.Teacher.leave = async () => {
    const me=MOCK.staff.find(s=>s.StaffID===USER.staffId); const isLeader=me.PositionLevel==='Leader';
    const quota=await api('leaveQuota',{staffId:USER.staffId});
    app.innerHTML=`<h2 class="page">${esc(t('title.leave'))}</h2>
      <div class="card"><h3>สิทธิคงเหลือ</h3><div class="quota">${quota.map(q=>`<div class="q"><div class="n">${q.remain}</div><div class="l">${esc(q.type)} ${q.used}/${q.quota}</div></div>`).join('')}</div></div>
      <div class="card"><h3>ยื่นใบลา</h3>
        <label class="field"><span>ประเภท</span><select id="lType"><option>ลาป่วย</option><option>ลากิจ</option><option>ลาพักร้อน</option></select></label>
        <div class="grid2"><label class="field"><span>วันที่เริ่ม</span><input type="date" id="lStart" value="${todayStr()}"/></label><label class="field"><span>ถึงวันที่</span><input type="date" id="lEnd" value="${todayStr()}"/></label></div>
        <label class="field"><span>เหตุผล</span><textarea id="lReason"></textarea></label><button class="btn block" onclick="T_submitLeave()">ส่งคำขอ</button></div>
      <div class="card"><h3>📋 คำขอของฉัน</h3><div id="ml"></div></div>
      ${isLeader?`<div class="card"><h3>⭐ รออนุมัติ — คำขอของลูกน้อง</h3><div id="tp"></div></div>`:''}`;
    $('#ml').innerHTML=(await api('myLeaves',{staffId:USER.staffId})).map(leaveRow).join('')||'<small class="muted">ยังไม่มี</small>';
    if(isLeader) $('#tp').innerHTML=(await api('teamPendingLeaves',{staffId:USER.staffId})).map(teamLeaveRow).join('')||'<small class="muted">ไม่มีคำขอรออนุมัติ</small>';
  };
  window.T_submitLeave=async()=>{ try{ const r=await api('submitLeave',{staffId:USER.staffId,type:$('#lType').value,startDate:$('#lStart').value,endDate:$('#lEnd').value,reason:$('#lReason').value}); toast(`✅ ส่งคำขอ ${r.leaveId} (${r.days} วัน)`); GO('leave'); }catch(e){err(e);} };
  window.T_teamApprove=async(id,dec)=>{ try{ const r=await api('approveLeave',{staffId:USER.staffId,leaveId:id,decision:dec}); toast(`✅ ${dec==='approve'?'อนุมัติ(ส่งต่อ Admin)':'ปฏิเสธ'} — ${r.status}`); GO('leave'); }catch(e){err(e);} };
  function leaveStatusPill(st){ const c={PENDING_LEADER:'wait',PENDING_ADMIN:'wait',APPROVED:'ok',REJECTED:'bad'}[st]||'info'; return `<span class="pill ${c}">${esc(tStat(st))}</span>`; }
  function leaveRow(l){ return `<div class="list-item"><div><b>${esc(l.Type)}</b> ${esc(l.StartDate)}→${esc(l.EndDate)} (${l.Days}ว.)<br><small class="muted">${esc(l.LeaveID)}${l.Step1ApproverName?' · ขั้น1: '+esc(l.Step1ApproverName)+(l.Step1CrossDept==='YES'?' (ข้ามแผนก)':''):''}${l.Step2ApproverName?' · ขั้น2: '+esc(l.Step2ApproverName):''}</small></div>${leaveStatusPill(l.Status)}</div>`; }
  function teamLeaveRow(l){ return `<div class="card" style="margin:8px 0"><div class="spread"><div><b>${esc(staffName(l.StaffID))}</b> <small class="muted">(${esc(l.Department)})</small><br>${esc(l.Type)} ${esc(l.StartDate)}→${esc(l.EndDate)} (${l.Days}ว.)<br><small class="muted">${esc(l.Reason||'')}</small></div>${leaveStatusPill(l.Status)}</div><div class="row" style="margin-top:8px"><button class="btn sm green" onclick="T_teamApprove('${l.LeaveID}','approve')">อนุมัติ</button><button class="btn sm pink" onclick="T_teamApprove('${l.LeaveID}','reject')">ปฏิเสธ</button></div></div>`; }

  const firstName = s => (nm(s)||'').split(' ')[0];
  function staffSchedCalendar(history){ const now=new Date(),y=now.getFullYear(),mo=now.getMonth();
    const first=new Date(y,mo,1).getDay(),days=new Date(y,mo+1,0).getDate(); const byDay={};
    const p2=n=>String(n).padStart(2,'0');
    history.forEach(h=>{ const d=new Date(h.Date); if(d.getFullYear()===y&&d.getMonth()===mo){ const s=MOCK.staff.find(x=>x.StaffID===h.StaffID); (byDay[d.getDate()]=byDay[d.getDate()]||[]).push((s?firstName(s):'?')+(h.In?' '+h.In:'')); } });
    // approved leaves overlapping each day -> "FirstName (LeaveType)"
    (MOCK.leaves||[]).filter(l=>l.Status==='APPROVED').forEach(l=>{ const st=new Date(l.StartDate),en=new Date(l.EndDate); for(let dt=new Date(st); dt<=en; dt.setDate(dt.getDate()+1)){ if(dt.getFullYear()===y&&dt.getMonth()===mo){ const s=MOCK.staff.find(x=>x.StaffID===l.StaffID); (byDay[dt.getDate()]=byDay[dt.getDate()]||[]).push((s?firstName(s):'?')+' ('+tLeaveType(l.Type)+')'); } } });
    let cells=['อา','จ','อ','พ','พฤ','ศ','ส'].map(w=>`<div style="text-align:center;font-size:11px;color:#94a3b8">${EN()?({'อา':'Su','จ':'Mo','อ':'Tu','พ':'We','พฤ':'Th','ศ':'Fr','ส':'Sa'}[w]):w}</div>`).join('');
    for(let i=0;i<first;i++) cells+='<div class="d dim"></div>';
    for(let dd=1;dd<=days;dd++){ const ppl=byDay[dd]; const today=dd===now.getDate()?'today':''; cells+=`<div class="d ${ppl?'ev':''} ${today}" style="min-height:64px">${dd}${ppl?`<span class="io" style="color:#2e7d32;text-align:left">${esc(ppl.join('\n'))}</span>`:''}</div>`; }
    const M=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'], ME=['January','February','March','April','May','June','July','August','September','October','November','December'];
    return `<div class="card"><h3>${esc(t('lbl.calendar'))} ${EN()?ME[mo]+' '+y:M[mo]+' '+(y+543)}</h3><div class="cal">${cells}</div><small class="muted">${EN()?'Name + check-in time; leave type shown after name':'ชื่อ + เวลาเข้างาน; ถ้าลาจะมีประเภทลาต่อท้ายชื่อ'}</small></div>`; }
  SCREENS.Teacher.schedule = async () => { const d=await api('schedule');
    const todayDuty=d.duty.filter(x=>x.Date===todayStr());
    const staffing=d.staffing||[];
    const ratioHtml = staffing.length?`<div class="card"><h3>👥 ${esc(t('lbl.staffingByNursery'))} (${esc(todayStr())})</h3>
      <div class="row">${staffing.map(x=>`<span class="pill ${x.present>=x.total?'ok':x.present>0?'wait':'bad'}" style="font-size:13px">${esc(x.dept)} ${x.present}/${x.total}</span>`).join('')}</div></div>`:'';
    app.innerHTML=`<h2 class="page">${esc(t('title.schedule'))}</h2>
      ${ratioHtml}
      ${staffSchedCalendar(d.history)}
      <div class="card"><h3>🧑‍🏫 ${esc(t('lbl.dutyRoster'))} (${esc(todayStr())})</h3>${todayDuty.map(x=>`<div class="list-item"><span>${esc(x.ClassName)}</span><span><span class="avatar-sm">${esc(initialEN((MOCK.staff.find(s=>s.StaffID===x.StaffID)||{}).NameEN))}</span> ${esc(staffName(x.StaffID))}</span></div>`).join('')||`<small class="muted">${esc(t('c.noItems'))}</small>`}</div>
      <div class="card"><h3>📋 ${esc(t('lbl.dailySummary'))} (${esc(todayStr())})</h3>${d.attendance.map(a=>{const s=MOCK.staff.find(x=>x.StaffID===a.StaffID)||{};const cls=a.Status==='IN'?'dot-in':a.Status==='OUT'?'dot-out':a.Status==='LEAVE'?'dot-leave':'dot-absent';return `<div class="att"><span class="dot-s ${cls}"></span> ${esc(nm(s)||a.StaffID)} — ${a.Status==='LEAVE'?(EN()?'Leave':'ลา')+' ('+esc(a.Reason||'')+')':a.Status+(a.CheckIn?' '+a.CheckIn:'')}</span></div>`;}).join('')||`<small class="muted">${esc(t('c.noItems'))}</small>`}
        <div style="margin-top:8px"><b style="font-size:13px">${EN()?'Approved leave (for coverage)':'การลาที่อนุมัติแล้ว (วางแผนสับเปลี่ยน)'}:</b>${d.leavesToday.map(l=>`<div class="list-item"><span>${esc(staffName(l.StaffID))} · ${esc(tLeaveType(l.Type))}</span><span class="muted">${esc(l.StartDate)}→${esc(l.EndDate)}</span></div>`).join('')||`<small class="muted">${esc(t('c.noItems'))}</small>`}</div></div>`;
  };

  let SLIP_UNLOCKED=false;
  SCREENS.Teacher.slip = async () => {
    if(!SLIP_UNLOCKED){ app.innerHTML=`<h2 class="page">💵 เงินเดือนของฉัน</h2>
      <div class="card" style="text-align:center"><div style="font-size:42px">🔒</div><p>ข้อมูลเงินเดือนเป็นความลับ — กรุณาใส่รหัสผ่านของคุณ</p>
      <label class="field"><span>${esc(t('lbl.password'))}</span><input type="password" id="slipPw" placeholder="1234"/></label>
      <button class="btn block" onclick="T_slipUnlock()">${esc(t('lbl.openSlip'))}</button>
      <button class="btn-ghost block" style="margin-top:8px" onclick="T_changePw(false)">🔑 ${esc(t('pw.title'))}</button></div>`; return; }
    const month=monthStr(); let pay=await api('getPayslip',{staffId:USER.staffId,month}); if(!pay) pay=await api('computePayroll',{staffId:USER.staffId,month,attendanceEligible:true});
    app.innerHTML=`<h2 class="page">💵 เงินเดือนของฉัน</h2>
      <div class="seg"><span class="muted" style="align-self:center">งวด:</span><input type="month" id="slipMonth" value="${month}" style="width:auto" onchange="T_slipMonth(this.value)"/>
      <button class="btn sm outline" onclick="SLIP_LOCK()">🔒 ล็อก</button></div>
      <div id="slipBox">${payslipCard(pay)}</div>
      <button class="btn outline block" onclick="T_slipDownload()">⬇️ ${esc(t('lbl.downloadSlip'))}</button>`;
  };
  window.T_slipUnlock=()=>{ const me=MOCK.staff.find(s=>s.StaffID===USER.staffId)||{}; if($('#slipPw').value===(me.Password||'1234')){ SLIP_UNLOCKED=true; GO('slip'); } else toast(EN()?'Wrong password':'รหัสผ่านไม่ถูกต้อง'); };
  // teacher password change (forced on first login; validation 8-15 incl upper/lower/digit)
  window.T_changePw=(forced)=>{ setNav('home');
    app.innerHTML=`<h2 class="page">🔑 ${esc(t('pw.title'))}</h2>
      <div class="card">${forced?`<div style="background:#fff8e1;border-radius:8px;padding:8px;color:#8a6d00;font-size:13px;margin-bottom:8px">⚠️ ${esc(t('pw.forced'))}</div>`:''}
        <p class="muted" style="font-size:12px">${esc(t('pw.user'))}: <b>${esc((MOCK.staff.find(s=>s.StaffID===USER.staffId)||{}).NationalID||'')}</b></p>
        <label class="field"><span>${esc(t('pw.new'))}</span><input type="password" id="pwNew" placeholder="8-15 chars"/></label>
        <label class="field"><span>${esc(t('pw.confirm'))}</span><input type="password" id="pwConfirm"/></label>
        <p class="muted" style="font-size:11.5px">${esc(t('pw.rule'))}</p>
        <button class="btn block" onclick="T_changePwDo()">${esc(t('c.save'))}</button>
        ${forced?'':`<button class="btn-ghost block" style="margin-top:8px" onclick="GO('home')">${esc(t('c.back'))}</button>`}</div>`;
  };
  window.T_changePwDo=async()=>{ const a=$('#pwNew').value, b=$('#pwConfirm').value;
    if(a!==b){toast(EN()?'Passwords do not match':'รหัสผ่านไม่ตรงกัน');return;}
    try{ await api('changeStaffPassword',{staffId:USER.staffId,newPassword:a}); const me=MOCK.staff.find(s=>s.StaffID===USER.staffId); if(me){me.Password=a;me.MustChangePassword=false;} confirmSaved(t('c.saved')); GO('home'); }catch(e){err(e);} };
  window.SLIP_LOCK=()=>{ SLIP_UNLOCKED=false; GO('slip'); };
  window.T_slipMonth=async(m)=>{ let pay=await api('getPayslip',{staffId:USER.staffId,month:m}); if(!pay)pay=await api('computePayroll',{staffId:USER.staffId,month:m,attendanceEligible:true}); $('#slipBox').innerHTML=payslipCard(pay); };
  window.T_slipDownload=async(m)=>{ m=m||($('#slipMonth')&&$('#slipMonth').value)||monthStr(); let pay=await api('getPayslip',{staffId:USER.staffId,month:m}); if(!pay)pay=await api('computePayroll',{staffId:USER.staffId,month:m,attendanceEligible:true}); openOrDownload(buildSlipsHTML([pay],m), 'payslip-'+USER.staffId+'-'+m+'.html'); };
  function payslipCard(r){ return `<div class="card"><h3>สลิป ${esc(staffName(r.StaffID))} · ${esc(r.Month)}</h3>
    <table style="width:100%;font-size:14px;border-collapse:collapse">
    <tr><td>เงินเดือน</td><td style="text-align:right">${baht(r.BaseSalary)}</td></tr>
    <tr><td>เบี้ยขยัน (มาครบ ${baht(r.DiligenceAttendance)} + FB ${baht(r.DiligenceFacebook)})</td><td style="text-align:right">${baht(r.DiligenceTotal)}</td></tr>
    <tr><td>รายได้อื่นๆ${r.ChildCount?` <small class="muted">(เด็ก ${r.ChildCount} คน × ${baht(r.ChildMultiplier)})</small>`:''}</td><td style="text-align:right">${baht(r.OtherIncome)}</td></tr>
    <tr><td>ค่าสวงเวลาตอนเย็น</td><td style="text-align:right">${baht(r.OTEvening)}</td></tr>
    <tr><td>เงินพิเศษวันพักผ่อน</td><td style="text-align:right">${baht(r.HolidayBonus)}</td></tr>
    <tr style="border-top:1px solid #ddd"><td><b>รวมรายได้</b></td><td style="text-align:right"><b>${baht(r.GrossIncome)}</b></td></tr>
    <tr><td>หัก ประกันสังคม</td><td style="text-align:right">-${baht(r.SocialSecurity)}</td></tr>
    <tr><td>หัก เงินสมทบ/อื่นๆ</td><td style="text-align:right">-${baht(r.Contribution+r.OtherDeductions)}</td></tr>
    ${(r.Adjustments||[]).map(a=>`<tr><td>${esc(a.label||'-')}</td><td style="text-align:right;color:${Number(a.amount)<0?'#c62828':'#2e7d32'}">${Number(a.amount)<0?'':'+'}${baht(a.amount)}</td></tr>`).join('')}
    <tr style="border-top:2px solid #1565C0"><td><b>โอนเข้า ${esc(r.BankAccount)} (สุทธิ)</b></td><td style="text-align:right;color:#1565C0;font-size:18px"><b>${baht(r.NetPay)}</b></td></tr>
    </table></div>`; }

  // ================= ADMIN =================
  SCREENS.Admin.home = async () => { const [d,rem,lrem,pend]=await Promise.all([api('dashboard'),api('payrollReminderDue'),api('leaveResetReminder'),api('pendingPayments')]);
    const pendN=pend.length;
    const remHtml = rem.due?`<div class="card" style="background:#fff3e0;border-color:#ffcc80;color:#e65100"><div class="spread"><b>🔔 ${esc(t('admin.payrollReminder'))}</b><button class="btn sm" onclick="GO('payroll')">${esc(t('admin.goPayroll'))}</button></div><small>${esc(t('admin.payrollReminderSub').replace('{d}',rem.lastDay-1).replace('{last}',rem.lastDay))}</small></div>`:'';
    const leaveRemHtml = lrem.due?`<div class="card" style="background:#e8f5e9;border-color:#a5d6a7;color:#2e7d32"><div class="spread"><b>🗓️ ${esc(t('admin.leaveReset'))}</b><button class="btn sm" onclick="A_settings()">${esc(t('manage.settings'))}</button></div><small>${esc(t('admin.leaveResetSub'))}</small></div>`:'';
    app.innerHTML=`<h2 class="page">${esc(t('title.dashboard'))} (${esc(todayStr())})</h2>
      ${remHtml}${leaveRemHtml}
      <div class="card"><div class="row"><button class="btn sm" onclick="GO('finance')">💰 ${esc(t('fin.title'))}</button><button class="btn sm ${pendN?'':'outline'}" onclick="GO('verify')">✅ ${esc(t('verify.title'))}${pendN?` (${pendN})`:''}</button><button class="btn sm" onclick="GO('daily')">📋 ${esc(t('daily.title'))}</button><button class="btn sm outline" onclick="GO('absence')">🔎 ${esc(t('abs.title'))}</button><button class="btn sm outline" onclick="A_addAnn()">+ ${esc(t('lbl.addAnn'))}</button></div></div>
      <div class="card"><div class="spread"><h3>👶 นักเรียนแต่ละชั้นวันนี้</h3><button class="btn sm outline" onclick="A_addAnn()">+ ประกาศ</button></div>
        ${d.classes.map(c=>`<div style="margin-bottom:10px"><div class="spread"><b>${esc(c.className)}</b><span class="muted">มา ${c.in} · กลับ ${c.out} · ลา ${c.leave} · ขาด ${c.absent} / ${c.total}</span></div>
          <div>${c.students.map(s=>{const cls=s.status==='IN'?'dot-in':s.status==='OUT'?'dot-out':s.status==='LEAVE'?'dot-leave':'dot-absent';return `<span class="att" style="display:inline-flex;margin-right:10px"><span class="dot-s ${cls}"></span>${esc(dn(s))}${s.status==='LEAVE'?' (ลา)':s.status==='ABSENT'?' (ยังไม่มา)':''}</span>`;}).join('')}</div></div>`).join('')}</div>
      <div class="card"><h3>👩‍🏫 พนักงานวันนี้</h3>${d.staff.map(s=>{const cls=s.status==='IN'?'dot-in':s.status==='OUT'?'dot-out':s.status==='LEAVE'?'dot-leave':'dot-absent';
        return `<div class="att" style="align-items:flex-start"><span class="dot-s ${cls}" style="margin-top:5px"></span><span><b>${esc(dn(s))}</b> <small class="muted">${esc(s.dept||'')}</small><br><small>IN ${esc(s.checkIn||'--:--')} · OUT ${esc(s.checkOut||'--:--')}${s.late?` · สาย ${s.late}น.`:''} · Remark: ${esc(s.remark||'-')}</small></span></div>`;}).join('')}</div>
      <div class="card"><h3>📢 ประกาศ</h3><div id="anns"></div></div>`;
    $('#anns').innerHTML=(await api('announcements')).map(a=>{ const ti=EN()?(a.TitleEN||a.Title):(a.Title||a.TitleEN);
      return `<div class="list-item"><div><b>${esc(ti)}</b>${a.Popup?` <span class="pill info" style="font-size:10px">Pop-up</span>`:''}<br><small class="muted">${esc(a.StartDate||a.Date)}${a.EndDate?'→'+esc(a.EndDate):''}</small></div><span class="row"><button class="btn sm outline" onclick="A_editAnn('${a.AnnID}')">✏️</button><button class="btn sm pink" onclick="A_delAnn('${a.AnnID}')">🗑️</button></span></div>`; }).join('')||`<small class="muted">${esc(t('c.noItems'))}</small>`;
  };
  window.A_addAnn=(annId)=>{ const a=annId?(MOCK.announcements.find(x=>x.AnnID===annId)||{}):{};
    modal(`<h3>📢 ${annId?esc(t('ann.edit')):'เพิ่มประกาศ / Add announcement'}</h3>
    <label class="field"><span>หัวข้อ (ไทย)</span><input id="anT" value="${esc(a.Title||'')}"/></label>
    <label class="field"><span>Title (English)</span><input id="anTE" value="${esc(a.TitleEN||'')}"/></label>
    <label class="field"><span>รายละเอียด (ไทย)</span><textarea id="anC">${esc(a.Content||'')}</textarea></label>
    <label class="field"><span>Content (English)</span><textarea id="anCE">${esc(a.ContentEN||'')}</textarea></label>
    <label class="field"><span>แนบรูป / Attach image (optional)</span><input type="file" id="anImg" accept="image/*"/>${a.Image?`<br><img src="${esc(a.Image)}" style="max-width:120px;border-radius:8px;margin-top:6px"/>`:''}</label>
    <label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="anPopup" ${a.Popup!==false?'checked':''} style="width:auto"/> ${esc(t('ann.popup'))}</label>
    <div class="grid2"><label class="field"><span>${esc(t('ann.start'))}</span><input type="date" id="anStart" value="${esc(a.StartDate||todayStr())}"/></label><label class="field"><span>${esc(t('ann.end'))}</span><input type="date" id="anEnd" value="${esc(a.EndDate||'')}"/></label></div>
    <button class="btn block" onclick="A_addAnnDo(this,'${annId||''}')">บันทึกประกาศ / Save</button>`); };
  window.A_addAnnDo=async(btn,annId)=>{ const m=btn.closest('.modal'); const q=s=>m.querySelector(s).value.trim();
    const title=q('#anT'), titleEN=q('#anTE'); if(!title&&!titleEN){toast('ใส่หัวข้อ / Enter a title');return;}
    const f=m.querySelector('#anImg').files[0]; let image=''; if(f) image=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(f);});
    const data={title:title||titleEN,titleEN:titleEN||title,content:q('#anC'),contentEN:q('#anCE'),image,popup:m.querySelector('#anPopup').checked,startDate:q('#anStart'),endDate:q('#anEnd')};
    if(annId) await api('editAnnouncement',Object.assign({annId},data)); else await api('addAnnouncement',data);
    m.remove(); confirmSaved(t('c.saved')); GO('home'); };
  window.A_editAnn=(annId)=>A_addAnn(annId);
  window.A_delAnn=async(annId)=>{ if(!confirm(t('manage.confirmDel')))return; try{ await api('deleteAnnouncement',{annId}); toast(t('manage.deleted')); GO('home'); }catch(e){err(e);} };

  SCREENS.Admin.leaves = async () => { const pend=await api('pendingLeaves',{staffId:USER.staffId});
    app.innerHTML=`<h2 class="page">✅ อนุมัติการลา (ขั้นสุดท้าย)</h2>${pend.length?pend.map(l=>`<div class="card"><div class="spread"><div><b>${esc(staffName(l.StaffID))}</b> <small class="muted">(${esc(l.Department||'-')})</small><br>${esc(l.Type)} ${esc(l.StartDate)}→${esc(l.EndDate)} (${l.Days} วัน)<br><small class="muted">${esc(l.Reason||'')}</small>${l.Step1ApproverName?`<br><small>ผ่านหัวหน้างาน: ${esc(l.Step1ApproverName)}${l.Step1CrossDept==='YES'?' ⚠️ ข้ามแผนก':''}</small>`:''}</div>${leaveStatusPill(l.Status)}</div><div class="row" style="margin-top:8px"><button class="btn sm green" onclick="A_leave('${l.LeaveID}','approve')">อนุมัติ</button><button class="btn sm pink" onclick="A_leave('${l.LeaveID}','reject')">ปฏิเสธ</button></div></div>`).join(''):'<div class="card muted">ไม่มีคำขอรออนุมัติ</div>'}`;
  };
  window.A_leave=async(id,dec)=>{ try{ const r=await api('approveLeave',{staffId:USER.staffId,leaveId:id,decision:dec}); toast(`✅ ${dec==='approve'?'อนุมัติ':'ปฏิเสธ'}แล้ว (${r.status})`); GO('leaves'); }catch(e){err(e);} };

  let PAY_ADJ=[];
  SCREENS.Admin.payroll = async () => { const [staff,rate]=await Promise.all([api('listStaff'),api('ratedChildCount')]); PAY_ADJ=[]; window._RATED=rate;
    app.innerHTML=`<h2 class="page">${esc(t('title.payroll'))}</h2><div class="card">
      <div class="grid2"><label class="field"><span>${esc(t('c.staff'))}</span><select id="pStaff" onchange="A_payStaff()">${staff.map(s=>`<option value="${s.StaffID}">${esc(nm(s))}</option>`).join('')}</select></label>
        <label class="field"><span>${esc(t('c.month'))}</span><input id="pMonth" type="month" value="${monthStr()}" onchange="A_payStaff()"/></label></div>
      <label class="field"><span>${esc(t('pay.payType'))}</span><select id="pType" onchange="A_payTypeToggle()"><option value="monthly">${esc(t('pay.monthly'))}</option><option value="daily">${esc(t('pay.dailyType'))}</option></select></label>
      <div class="grid2" id="pMonthlyBox"><label class="field"><span>${esc(t('pay.baseSalary'))}</span><input id="pBase" type="number"/></label></div>
      <div class="grid2" id="pDailyBox" hidden><label class="field"><span>${esc(t('pay.dailyRate'))}</span><input id="pDaily" type="number" value="0"/></label>
        <label class="field"><span>${esc(t('pay.daysWorked'))}</span><input id="pDays" type="number" value="0"/></label></div>
      <label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="pSS" style="width:auto"/> ${esc(t('pay.ssDeduct'))}</label>
      <div class="card" style="background:#f7f9fc;padding:8px"><b style="font-size:13px">⭐ ${esc(t('set.diligence'))} <small class="muted">(${esc(t('pay.perStaff'))})</small></b>
        <div class="grid2" style="margin-top:6px"><label class="field" style="margin:0"><span style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="pAtt" checked style="width:auto"/> ${esc(t('pay.attend'))}</span><input id="pAttendAmt" type="number"/></label>
          <label class="field" style="margin:0"><span style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="pFb" style="width:auto"/> ${esc(t('pay.fb'))}</span><input id="pFbAmt" type="number"/></label></div></div>
      <div class="card" style="background:#eef6ff;padding:8px"><b style="font-size:13px">👶 ${esc(t('pay.childRate'))}</b>
        <div class="grid2" style="margin-top:6px"><label class="field" style="margin:0"><span>${esc(t('pay.childThreshold'))}</span><input id="pThreshold" type="number" onchange="A_recalcChild()"/></label>
          <label class="field" style="margin:0"><span>${esc(t('pay.childMultiplier'))} (฿)</span><input id="pChildMul2" type="number"/></label></div>
        <div id="childCalc" class="muted" style="font-size:12px;margin-top:6px"></div>
        <label class="field" style="margin:6px 0 0"><span>${esc(t('pay.childCount'))} <small class="muted">(${esc(t('pay.autoEditable'))})</small></span><input id="pChild" type="number" value="0"/></label></div>
      <div class="grid2"><label class="field"><span>${esc(t('pay.cert'))}</span><input id="pCert" type="number" value="0"/></label>
        <label class="field"><span>${esc(t('pay.otEvening'))} <small id="otNote" class="muted"></small></span><input id="pOt" type="number" value="0"/></label></div>
      <div class="grid2"><label class="field"><span>${esc(t('pay.holidayBonus'))}</span><input id="pHb" type="number" value="0"/></label></div>
      <div class="card" style="background:#f7f9fc"><div class="spread"><b style="font-size:13px">➕ ${esc(t('pay.adjustments'))}</b><button class="btn sm outline" onclick="A_addAdj()">+ ${esc(t('pay.addAdj'))}</button></div>
        <p class="muted" style="font-size:11.5px">${esc(t('pay.adjNote'))}</p><div id="adjList"></div></div>
      <button class="btn block" onclick="A_calc()">${esc(t('c.calc'))}</button></div><div id="slipResult"></div>`;
    A_payStaff();
  };
  window.A_payStaff = async ()=>{ const sid=$('#pStaff').value; const s=MOCK.staff.find(x=>x.StaffID===sid)||{}; const pc=await api('payrollConfig',{staffId:sid});
    $('#pBase').value=s.BaseSalary||0; $('#pChildMul2').value=pc.ChildMultiplier; $('#pSS').checked=pc.SocialSecurityDeduct!==false;
    $('#pType').value=pc.PayType||'monthly'; $('#pDaily').value=pc.DailyRate||0;
    $('#pAttendAmt').value=pc.DiligenceAttendanceAmount!=null?pc.DiligenceAttendanceAmount:MOCK.config.DiligenceAttendanceAmount;
    $('#pFbAmt').value=pc.DiligenceFacebookAmount!=null?pc.DiligenceFacebookAmount:MOCK.config.DiligenceFacebookAmount;
    $('#pThreshold').value=pc.ChildThreshold||31; A_payTypeToggle(); A_recalcChild();
    // auto-pull this staff's OT hours for the selected month into the OT field
    try{ const ot=await api('staffMonthlyOT',{staffId:sid,month:$('#pMonth').value}); $('#pOt').value=ot.amount;
      const n=$('#otNote'); if(n) n.innerHTML=`(${EN()?'auto':'อัตโนมัติ'} ${ot.hours} ${EN()?'hr':'ชม.'} × ${baht(ot.rate)})`; }catch(e){} };
  window.A_payTypeToggle=()=>{ const daily=$('#pType').value==='daily'; $('#pMonthlyBox').hidden=daily; $('#pDailyBox').hidden=!daily; };
  // auto child-rate count from DB: children from #threshold onward = rated − (threshold−1)
  window.A_recalcChild=()=>{ const r=window._RATED||{}; const th=+$('#pThreshold').value||31; const cnt=Math.max(0,(r.rated||0)-(th-1)); $('#pChild').value=cnt;
    $('#childCalc').innerHTML=`${esc(t('abs.rated'))} <b>${r.rated||0}</b> <span class="muted">(${esc(t('abs.rateNote').replace('{n}',r.excludeDays||6).replace('{x}',r.excluded||0))})</span> − ${esc(t('pay.fromChild'))} #${th} → <b style="color:#1565C0">${cnt} ${EN()?'children':'คน'}</b>`; };
  window.A_addAdj=()=>{ PAY_ADJ.push({label:'',amount:0}); A_renderAdj(); };
  window.A_delAdj=(i)=>{ PAY_ADJ.splice(i,1); A_renderAdj(); };
  function A_renderAdj(){ const box=$('#adjList'); if(!box)return;
    box.innerHTML=PAY_ADJ.map((a,i)=>`<div class="grid3" style="margin-bottom:6px;grid-template-columns:1fr 90px 36px"><input value="${esc(a.label)}" placeholder="${esc(t('pay.adjLabel'))}" oninput="PAY_ADJ_SET(${i},'label',this.value)"/><input type="number" value="${a.amount}" placeholder="±0" oninput="PAY_ADJ_SET(${i},'amount',this.value)"/><button class="btn sm pink" onclick="A_delAdj(${i})">✕</button></div>`).join(''); }
  window.PAY_ADJ_SET=(i,k,v)=>{ PAY_ADJ[i][k]= k==='amount'?Number(v||0):v; };
  window.A_calc=async()=>{ const payType=$('#pType').value; const p={staffId:$('#pStaff').value,month:$('#pMonth').value,payType,baseSalary:+$('#pBase').value,dailyRate:+$('#pDaily').value,daysWorked:+$('#pDays').value,childMultiplier:+$('#pChildMul2').value,childThreshold:+$('#pThreshold').value,diligenceAttend:+$('#pAttendAmt').value,diligenceFb:+$('#pFbAmt').value,socialSecurityDeduct:$('#pSS').checked,facebookPosted:$('#pFb').checked,attendanceEligible:$('#pAtt').checked,extraChildCount:+$('#pChild').value,trainingCertCount:+$('#pCert').value,otEvening:+$('#pOt').value,holidayBonus:+$('#pHb').value,adjustments:PAY_ADJ.filter(a=>a.label||a.amount)};
    await api('setPayrollConfig',{staffId:p.staffId,config:{PayType:payType,DailyRate:p.dailyRate,ChildMultiplier:p.childMultiplier,ChildThreshold:p.childThreshold,DiligenceAttendanceAmount:p.diligenceAttend,DiligenceFacebookAmount:p.diligenceFb,SocialSecurityDeduct:p.socialSecurityDeduct}});
    const r=await api('computePayroll',p); $('#slipResult').innerHTML=payslipCard(r)+`<div class="row"><button class="btn outline" onclick="A_dlSlip('${r.StaffID}','${r.Month}')">⬇️ ${esc(t('pay.download'))}</button><button class="btn outline" onclick="A_print('${r.Month}')">🖨️ ${esc(t('pay.print3'))}</button></div>`; toast('✅ '+t('pay.calcSaved')); };
  window.A_dlSlip=(staffId,month)=>{ const r=MOCK.payroll.find(p=>p.StaffID===staffId&&p.Month===month); if(!r){toast('ยังไม่มีสลิป');return;} openOrDownload(buildSlipsHTML([r],month),'payslip-'+staffId+'-'+month+'.html'); };
  window.A_print=(month)=>{ const rows=MOCK.payroll.filter(p=>p.Month===month); if(!rows.length){toast('ยังไม่มีสลิป');return;} openOrDownload(buildSlipsHTML(rows,month), 'payslips-'+month+'.html'); };

  SCREENS.Admin.dspm = async () => { const classes=await api('listClasses');
    app.innerHTML=`<h2 class="page">${esc(t('title.analytics'))}</h2><div class="seg">${classes.map((c,i)=>`<button class="${i===0?'active':''}" onclick="A_cls('${c.ClassName}',this)">${esc(c.ClassName)}</button>`).join('')}</div><div id="clsRes"></div>`; A_cls(classes[0].ClassName);
  };
  window.A_cls=async(name,el)=>{ if(el){[...el.parentElement.children].forEach(b=>b.classList.remove('active'));el.classList.add('active');} const r=await api('classAssessment',{className:name});
    $('#clsRes').innerHTML=`<div class="card"><div class="spread"><b>${esc(r.class)}</b><span class="pill ${r.passRate>=70?'ok':'wait'}">ผ่านเฉลี่ย ${r.passRate}%</span></div><small class="muted">${r.studentCount} คน</small>
      ${r.perStudent.map(s=>`<div class="list-item"><span>${esc(dn(s))} <small class="muted">(${s.ageMonth} ${EN()?'m.':'ด.'})</small></span><span><span class="pill ok">${s.pass}</span> <span class="pill bad">${s.fail}</span> <button class="btn sm outline" onclick="A_student('${s.studentId}')">ดูราย นร.</button></span></div>`).join('')}</div>`; };
  window.A_student=async(sid)=>{ const [d,g]=await Promise.all([api('studentAllBands',{studentId:sid}),api('growthHistory',{studentId:sid})]); const pill=DSPM_PILL;
    app.innerHTML=`<h2 class="page">📈 ${esc(dn(d))} <small class="muted">(${esc(EN()?d.name:d.nameEN)})</small></h2>
      <div class="row"><button class="btn sm outline" onclick="GO('dspm')">← ${esc(t('c.back'))}</button><button class="btn sm" onclick="A_editAssess('${sid}')">📝 ${esc(t('assess.edit'))}</button></div>
      <div class="card"><div class="spread"><b>อายุปัจจุบัน ${d.ageMonth} เดือน</b><span class="muted">เข้าเรียน ${esc(d.enrollDate||'-')}</span></div>
      <p class="muted" style="font-size:12px">แสดงทุกช่วงวัยที่เด็กผ่านมา (ตั้งแต่เข้าเรียน) เพื่อดูพัฒนาการต่อเนื่อง</p></div>
      <div class="card"><h3>📈 ${esc(t('growth.chartTitle'))}</h3>
        <p class="muted" style="font-size:12px">${esc(t('growth.chartSub'))}</p>
        ${growthChartSVG(t('growth.weight'),g.records.map(r=>({x:r.AgeMonth,y:r.Weight})),g.weightBand,'kg')}
        ${growthChartSVG(t('growth.height'),g.records.map(r=>({x:r.AgeMonth,y:r.Height})),g.heightBand,'cm')}
        <div class="row" style="font-size:11px;justify-content:center;margin-top:6px"><span>🟦 ${esc(t('growth.actual'))}</span><span>🟩 ${esc(t('growth.normalBand'))}</span></div>
        ${growthRecordsList(g.records)}</div>
      ${d.bands.map(b=>`<div class="card"><h3>${esc(b.label)}</h3>${b.items.map(i=>`<div class="list-item"><span><b>ข้อ ${i.itemNo}</b> <span class="pill info">${i.skill}</span> <small>${esc(EN()&&i.descriptionEN?i.descriptionEN:i.description)}</small></span>${pill(i.result)}</div>`).join('')}</div>`).join('')}
      <button class="btn outline" onclick="GO('dspm')">← กลับหน้าวิเคราะห์</button>`; window.scrollTo(0,0); };
  // measurement history list (date · age-at-measurement · weight/height)
  function growthRecordsList(records, dob){ if(!records||!records.length) return '';
    const rows=records.slice().sort((a,b)=>b.Date.localeCompare(a.Date)).map(r=>`<div class="list-item"><span>${esc(r.Date)} <small class="muted">(${esc(ageYMfromMonths(r.AgeMonth))})</small></span><span>${r.Weight?baht(r.Weight).replace('.00','')+' kg':''} ${r.Height?'· '+(baht(r.Height).replace('.00',''))+' cm':''}</span></div>`).join('');
    return `<div style="margin-top:8px"><b style="font-size:13px">📋 ${esc(t('growth.records'))}</b>${rows}</div>`; }
  // read-only vaccine record card (parent view): schedule grouped by age, ✓ date or "not yet"
  // editable=true → parent/Admin can tick + date each dose (uses A_vacToggle/A_vacDate → setVaccine/removeVaccine)
  function vaccineCard(sched, recs, sid, editable){ const got=k=>(recs||[]).find(r=>r.Key===k);
    return `<div class="card"><h3>💉 ${esc(t('vac.title'))}</h3>
      ${editable?`<p class="muted" style="font-size:12px">${esc(t('vac.note'))}</p>`:''}
      ${sched.map(grp=>`<div style="margin-bottom:6px"><b style="font-size:13px">${esc(EN()?grp.ageEN:grp.ageTH)}</b>
        ${grp.items.map(it=>{ const r=got(it.key);
          if(editable) return `<div class="list-item" style="gap:6px"><label style="display:flex;gap:6px;align-items:flex-start;flex:1;font-size:12.5px"><input type="checkbox" ${r?'checked':''} style="width:auto;margin-top:3px" onchange="A_vacToggle('${sid}','${it.key}',this.checked)"/><span>${esc(EN()?it.en:it.th)}</span></label><input type="date" id="vd_${it.key}" value="${esc(r?r.Date:'')}" style="width:140px" onchange="A_vacDate('${sid}','${it.key}',this.value)"/></div>`;
          return `<div class="list-item"><span style="font-size:12.5px">${esc(EN()?it.en:it.th)}</span>${r?`<span class="pill ok">✓ ${esc(r.Date)}</span>`:`<span class="pill wait">${esc(t('vac.notYet'))}</span>`}</div>`; }).join('')}</div>`).join('')}</div>`; }
  // inline SVG line chart: child's measurements (line) vs the standard normal band (shaded)
  function growthChartSVG(title, pts, band, unit){ const W=320,H=170,pl=34,pr=10,pt=24,pb=22;
    const xs=pts.map(p=>p.x).concat(band.map(b=>b.ageMonth)); const ys=pts.map(p=>p.y).concat(band.map(b=>b.min),band.map(b=>b.max)).filter(v=>v!=null);
    if(!ys.length) return `<div class="muted" style="font-size:12px">${esc(title)}: ${EN()?'no data':'ยังไม่มีข้อมูล'}</div>`;
    const xmin=Math.min.apply(0,xs),xmax=Math.max.apply(0,xs)||1,ymin=Math.min.apply(0,ys),ymax=Math.max.apply(0,ys);
    const xR=(xmax-xmin)||1, yR=(ymax-ymin)||1;
    const X=v=>pl+(v-xmin)/xR*(W-pl-pr), Y=v=>H-pb-(v-ymin)/yR*(H-pt-pb);
    const bandPts=band.filter(b=>b.min!=null);
    const top=bandPts.map(b=>X(b.ageMonth)+','+Y(b.max)).join(' ');
    const bot=bandPts.slice().reverse().map(b=>X(b.ageMonth)+','+Y(b.min)).join(' ');
    const bandPoly = bandPts.length?`<polygon points="${top} ${bot}" fill="#43a04722" stroke="#43a047" stroke-width="0.5"/>`:'';
    const line = pts.map((p,i)=>(i?'L':'M')+X(p.x)+' '+Y(p.y)).join(' ');
    // each point: a value label above it + native hover tooltip + tap shows age+value
    const dots = pts.map(p=>{ const lbl=`${ageYMfromMonths(p.x)} · ${p.y} ${unit}`; const cy=Y(p.y);
      return `<circle cx="${X(p.x)}" cy="${cy}" r="4.5" fill="#1565C0" style="cursor:pointer" onclick="GROWTH_PT('${esc(lbl)}')"><title>${esc(lbl)}</title></circle>
        <text x="${X(p.x)}" y="${cy-7}" font-size="8.5" font-weight="700" fill="#0D47A1" text-anchor="middle">${p.y}</text>`; }).join('');
    const yt=[ymin,(ymin+ymax)/2,ymax].map(v=>`<text x="2" y="${Y(v)+3}" font-size="8" fill="#94a3b8">${v.toFixed(0)}</text>`).join('');
    return `<div style="margin:6px 0"><b style="font-size:13px">${esc(title)} (${unit})</b><br>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:420px;height:auto">
        <line x1="${pl}" y1="${H-pb}" x2="${W-pr}" y2="${H-pb}" stroke="#cbd5e1" stroke-width="0.7"/>
        <line x1="${pl}" y1="${pt}" x2="${pl}" y2="${H-pb}" stroke="#cbd5e1" stroke-width="0.7"/>
        ${bandPoly}<path d="${line}" fill="none" stroke="#1565C0" stroke-width="1.6"/>${dots}${yt}
        <text x="${pl}" y="${H-6}" font-size="8" fill="#94a3b8">${xmin}${EN()?'m':'ด'}</text>
        <text x="${W-pr-16}" y="${H-6}" font-size="8" fill="#94a3b8">${xmax}${EN()?'m':'ด'}</text>
      </svg></div>`; }

  window.A_reqCI = async (id,val) => { await api('setRequireCheckin',{staffId:id,value:val}); toast((val?'เปิด':'ปิด')+'การบังคับลงเวลา'); };
  // Admin can edit a student's DSPM assessment (all items in the current band)
  window.A_editAssess=async(sid)=>{ ASEL={}; let c; try{ c=await api('dspmStatus',{studentId:sid}); }catch(e){ app.innerHTML=`<button class="btn sm outline backbtn" onclick="A_student('${sid}')">${t('c.back')}</button><div class="card muted">${esc(e.message)}</div>`; return; }
    const s=MOCK.students.find(x=>x.StudentID===sid)||{NameTH:sid};
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="A_student('${sid}')">${t('c.back')}</button><h2 class="page">📝 ${esc(t('assess.edit'))} — ${esc(nm(s))}</h2>
      <div class="card"><div class="spread"><span>${esc(t('growth.section').split('/')[0])}: <b>${esc(c.ageLabel)}</b></span><span class="muted">${c.ageMonth} ${EN()?'mo':'เดือน'}</span></div></div>
      ${c.items.map(i=>`<div class="card"><div style="margin-bottom:8px"><b>${EN()?'Item':'ข้อ'} ${i.itemNo}</b> <span class="pill info">${i.skill}</span> ${i.result!=='ยังไม่ได้รับการทดสอบ'?`<span class="pill ${i.result==='ผ่าน'?'ok':'bad'}">${EN()?'now':'ปัจจุบัน'}: ${esc(tStat(i.result))}</span>`:''}<br>${esc(EN()&&i.descriptionEN?i.descriptionEN:i.description)}</div>
        <div class="choice"><button id="p${i.itemNo}" onclick="A_set(${i.itemNo},'pass')">✅ ${esc(t('s.pass'))}</button><button id="f${i.itemNo}" onclick="A_set(${i.itemNo},'fail')">❌ ${esc(t('s.fail'))}</button><button id="n${i.itemNo}" onclick="A_set(${i.itemNo},'nottested')">⊘ ${EN()?'Not assessed':'ยังไม่ได้ประเมิน'}</button></div></div>`).join('')}
      <button class="btn block" onclick="A_saveAssess('${sid}')">${esc(t('lbl.saveAssess'))}</button>`;
  };
  window.A_saveAssess=async(sid)=>{ const results=Object.keys(ASEL).map(k=>({itemNo:Number(k),result:ASEL[k]})); if(!results.length){toast(EN()?'Select at least 1':'เลือกอย่างน้อย 1 ข้อ');return;}
    try{ await api('submitAssessment',{studentId:sid,staffId:USER.staffId,results}); confirmSaved(t('c.saved')); A_student(sid); }catch(e){err(e);} };
  window.A_perm = async (role,cap,val) => { await api('setPerm',{role,cap,value:val}); toast(t('c.saved')); };
  SCREENS.Admin.manage = async () => {
    const [staff,students,parents,pm,groups,exported,wds]=await Promise.all([api('listStaff'),api('listStudents'),api('listParents'),api('permMatrix'),api('listStaffGroups'),api('listExportedStudents'),api('listWithdrawals',{pending:true})]);
    const CAPS=[['students','perm.students'],['staff','perm.staff'],['payroll','perm.payroll'],['parentPII','perm.parentPII'],['edit','perm.edit'],['approve','perm.approve']];
    const ROLES=['Admin','Leader','Teacher','Parent'];
    app.innerHTML=`<h2 class="page">${esc(t('title.manage'))}</h2>
      <div class="card"><div class="row">
        <button class="btn sm" onclick="GO_('organize')">🔁 ${esc(t('manage.organize'))}</button>
        <button class="btn sm outline" onclick="A_departments()">🏫 ${esc(t('manage.departments'))}</button>
        <button class="btn sm outline" onclick="GO_('holidays')">🗓️ ${esc(t('manage.holidays'))}</button>
        <button class="btn sm outline" onclick="GO_('importExport')">📥 ${esc(t('manage.importExport'))}</button>
        <button class="btn sm outline" onclick="A_groups()">🕑 ${esc(t('manage.groups'))}</button>
        <button class="btn sm outline" onclick="A_settings()">⚙️ ${esc(t('manage.settings'))}</button>
        <button class="btn sm outline" onclick="A_otVerify()">⏱️ ${esc(t('manage.otVerify'))}</button>
        <button class="btn sm outline" onclick="A_insurance()">🛡️ ${esc(t('ins2.manage'))}</button>
        <button class="btn sm outline" onclick="A_activityLog()">${esc(t('act.open'))}</button></div></div>
      ${wds.length?`<div class="card" style="background:#fff8e1;border-color:#f0e3b0"><h3>🚪 ${esc(t('wd.requests'))} (${wds.length})</h3>
        ${wds.map(w=>`<div class="list-item"><span><b>${esc(EN()?w.nameEN:w.name)}</b> <small class="muted">${esc(w.class||'')}</small><br><small class="muted">${esc(t('wd.reason.'+w.Reason)||w.Reason)}${w.Detail?' · '+esc(w.Detail):''} · ${esc(w.CreatedDate)}</small></span>
          <button class="btn sm pink" onclick="A_processWithdraw('${w.WithdrawID}','${w.StudentID}','${w.Reason}')">${esc(t('wd.process'))}</button></div>`).join('')}</div>`:''}
      <div class="card"><h3>🔐 ${esc(t('lbl.perms'))}</h3><p class="muted" style="font-size:12px">${esc(t('perm.note'))}</p>
        <div style="overflow:auto"><table style="width:100%;font-size:12px;border-collapse:collapse">
        <tr style="background:#1565C0;color:#fff"><th style="padding:4px 6px;text-align:left">${esc(t('perm.role'))}</th>${CAPS.map(c=>`<th style="padding:4px 3px">${esc(t(c[1]))}</th>`).join('')}</tr>
        ${ROLES.map(r=>`<tr style="border-bottom:1px solid #eee"><td style="padding:4px 6px"><b>${esc(t('role.'+r)||r)}</b></td>${CAPS.map(c=>`<td style="text-align:center"><input type="checkbox" style="width:auto" ${pm[r]&&pm[r][c[0]]?'checked':''} onchange="A_perm('${r}','${c[0]}',this.checked)"/></td>`).join('')}</tr>`).join('')}
        </table></div></div>
      <div class="card"><h3>⏱️ ${esc(t('lbl.requireCI'))}</h3><p class="muted" style="font-size:12px">ปิดสำหรับตำแหน่งที่ไม่ต้องลงเวลา (เช่น หัวหน้างาน)</p>
        ${staff.map(s=>`<div class="list-item"><span><b>${esc(nm(s))}</b> <small class="muted">${esc(s.PositionLevel)}</small></span>
          <label class="switch"><input type="checkbox" ${s.RequireCheckin!==false?'checked':''} onchange="A_reqCI('${s.StaffID}',this.checked)"><span class="slider"></span></label></div>`).join('')}</div>
      <div class="card"><div class="spread"><h3>👩‍🏫 ${esc(t('c.staff'))} (${staff.length})</h3><button class="btn sm" onclick="A_staffForm()">+ ${esc(t('manage.add'))}</button></div>
        ${staff.map(s=>`<div class="list-item"><span style="display:flex;gap:8px;align-items:center">${personAvatar(s)}<span><b>${esc(nm(s))}</b> <small class="muted">(${esc(EN()?s.NameTH:s.NameEN)})</small><br><small class="muted">${esc(s.Position||'')} · ${esc(s.Department||'-')} · ${esc(groupLabel(s.StaffGroup))}</small><br><small class="muted">${esc(t('staff.start'))} ${esc(s.StartDate||'-')} · ${esc(t('staff.tenure'))} ${esc(tenure(s.StartDate))}</small></span></span><span class="row"><button class="btn sm outline" onclick="A_staffForm('${s.StaffID}')">✏️</button><button class="btn sm pink" onclick="A_delStaff('${s.StaffID}')">🗑️</button></span></div>`).join('')}</div>
      <div class="card"><div class="spread"><h3>👪 ${esc(t('manage.parents'))} (${parents.length})</h3><button class="btn sm" onclick="A_parentForm()">+ ${esc(t('manage.add'))}</button></div>
        ${parents.map(p=>`<div class="list-item"><span style="display:flex;gap:8px;align-items:center">${personAvatar(p)}<span><b>${esc(nm(p))}</b> <small class="muted">${esc(p.Relationship||'')} · ${esc(p.Phone||'')}</small></span></span><span class="row"><button class="btn sm outline" onclick="A_parentForm('${p.ParentID}')">✏️</button><button class="btn sm pink" onclick="A_delParent('${p.ParentID}')">🗑️</button></span></div>`).join('')}</div>
      <div class="card"><div class="spread"><h3>👶 ${EN()?'Students':'นักเรียน'} (${students.length})</h3><button class="btn sm" onclick="A_genBills()">📅 ${esc(t('bill.genTitle'))}</button></div>${students.map(s=>`<div class="list-item"><span>${studentAvatar(s)} <b>${esc(nm(s))}</b> <small class="muted">${esc(s.Class)} · ${esc(ageYM(s.DOB))}${s.InsuranceHas?' · 🛡️':''}</small><br><small class="muted">${EN()?'ID':'บัตร'}: ${esc(s.NationalID||'-')}</small></span><span class="row"><button class="btn sm outline" onclick="A_studentForm('${s.StudentID}')">✏️</button><button class="btn sm" onclick="A_issueBill('${s.StudentID}')">🧾</button><button class="btn sm" onclick="A_charges('${s.StudentID}')">💵</button><button class="btn sm outline" onclick="A_vaccines('${s.StudentID}')">💉</button><button class="btn sm gray" onclick="A_exportStudent('${s.StudentID}')">📤</button><button class="btn sm pink" onclick="A_removeStudent('${s.StudentID}')" title="${esc(t('wd.remove'))}">🚪</button></span></div>`).join('')}</div>`;
  };
  // navigate to an admin sub-screen (kept off the bottom nav)
  var ADMIN_SUB_organize, ADMIN_SUB_holidays, ADMIN_SUB_importExport;
  const ADMIN_SUB = { organize:()=>ADMIN_SUB_organize(), holidays:()=>ADMIN_SUB_holidays(), importExport:()=>ADMIN_SUB_importExport() };
  window.GO_=(k)=>{ CURRENT='manage'; setNav('manage'); (ADMIN_SUB[k]||(()=>{}))(); window.scrollTo(0,0); };

  // ---- Staff CRUD ----
  window.A_staffForm=(id)=>{ const s=id?(MOCK.staff.find(x=>x.StaffID===id)||{}):{}; const groups=MOCK.staffGroups;
    const f=(k,label,val,type)=>`<label class="field"><span>${esc(label)}</span><input id="sf_${k}" type="${type||'text'}" value="${esc(val!=null?val:'')}"/></label>`;
    modal(`<h3>${id?'✏️':'➕'} ${esc(t('c.staff'))}</h3>
      <div class="grid2">${f('NameTH',t('reg.nameTH'),s.NameTH)}${f('NameEN',t('reg.nameEN'),s.NameEN)}</div>
      <div class="grid2">${f('Position',t('manage.position'),s.Position)}
        <label class="field"><span>${esc(t('manage.dept'))}</span><select id="sf_Department">${['',...MOCK.config.Departments].map(d=>`<option ${s.Department===d?'selected':''}>${esc(d)}</option>`).join('')}</select></label></div>
      <div class="grid2"><label class="field"><span>${esc(t('manage.group'))}</span><select id="sf_StaffGroup">${groups.map(g=>`<option ${s.StaffGroup===g.GroupName?'selected':''}>${esc(g.GroupName)}</option>`).join('')}</select></label>
        <label class="field"><span>${esc(t('manage.level'))}</span><select id="sf_PositionLevel">${['Admin','Leader','Officer','Assistant','Staff'].map(l=>`<option ${s.PositionLevel===l?'selected':''}>${esc(l)}</option>`).join('')}</select></label></div>
      <div class="grid2">${f('Phone',t('reg.phone'),s.Phone)}${f('NationalID',t('reg.nationalIdParent'),s.NationalID)}</div>
      <div class="grid2">${f('StartDate',t('staff.startDate'),s.StartDate,'date')}${f('BaseSalary',t('pay.baseSalary'),s.BaseSalary,'number')}</div>
      <label class="field"><span>${esc(t('manage.photo'))}</span><input id="sf_Photo" type="file" accept="image/*"/>${s.Photo?`<br><img src="${esc(s.Photo)}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;margin-top:6px"/>`:''}</label>
      <button class="btn block" onclick="A_saveStaff(this,'${id||''}')">${esc(t('c.save'))}</button>`);
  };
  window.A_saveStaff=async(btn,id)=>{ const m=btn.closest('.modal'); const v=k=>{ const e=m.querySelector('#sf_'+k); return e?e.value.trim():''; };
    const data={NameTH:v('NameTH'),NameEN:v('NameEN'),Position:v('Position'),Department:v('Department'),StaffGroup:v('StaffGroup'),PositionLevel:v('PositionLevel'),Phone:v('Phone'),NationalID:v('NationalID'),StartDate:v('StartDate'),BaseSalary:+v('BaseSalary')||0};
    const pf=m.querySelector('#sf_Photo').files[0]; if(pf) data.Photo=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(pf);});
    try{ await api('saveStaff',{staffId:id||null,data}); m.remove(); confirmSaved(t('c.saved')); GO('manage'); }catch(e){err(e);} };
  window.A_delStaff=async(id)=>{ if(!confirm(t('manage.confirmDel')))return; try{ await api('deleteStaff',{staffId:id}); toast(t('manage.deleted')); GO('manage'); }catch(e){err(e);} };

  // ---- Parent CRUD ----
  window.A_parentForm=(id)=>{ const p=id?(MOCK.parents.find(x=>x.ParentID===id)||{}):{};
    const f=(k,label,val)=>`<label class="field"><span>${esc(label)}</span><input id="pf_${k}" value="${esc(val!=null?val:'')}"/></label>`;
    modal(`<h3>${id?'✏️':'➕'} ${esc(t('manage.parents'))}</h3>
      <div class="grid2">${f('NameTH',t('reg.nameTH'),p.NameTH)}${f('NameEN',t('reg.nameEN'),p.NameEN)}</div>
      <div class="grid2">${f('Relationship',t('reg.relationship'),p.Relationship)}${f('NationalID',t('reg.nationalIdParent'),p.NationalID)}</div>
      <div class="grid2">${f('Phone',t('reg.mobile'),p.Phone)}${f('OfficePhone',t('reg.officePhone'),p.OfficePhone)}</div>
      <div class="grid2">${f('Occupation',t('reg.occupation'),p.Occupation)}${f('Workplace',t('reg.workplace'),p.Workplace)}</div>
      <label class="field"><span>${esc(t('reg.parentPhoto'))}</span><input id="pf_Photo" type="file" accept="image/*"/>${p.Photo?`<br><img src="${esc(p.Photo)}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;margin-top:6px"/>`:''}</label>
      <button class="btn block" onclick="A_saveParent(this,'${id||''}')">${esc(t('c.save'))}</button>`);
  };
  window.A_saveParent=async(btn,id)=>{ const m=btn.closest('.modal'); const v=k=>{ const e=m.querySelector('#pf_'+k); return e?e.value.trim():''; };
    const data={NameTH:v('NameTH'),NameEN:v('NameEN'),Relationship:v('Relationship'),NationalID:v('NationalID'),Phone:v('Phone'),OfficePhone:v('OfficePhone'),Occupation:v('Occupation'),Workplace:v('Workplace')};
    const pf=m.querySelector('#pf_Photo').files[0]; if(pf) data.Photo=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(pf);});
    try{ await api('saveParent',{parentId:id||null,data}); m.remove(); confirmSaved(t('c.saved')); GO('manage'); }catch(e){err(e);} };
  window.A_delParent=async(id)=>{ if(!confirm(t('manage.confirmDel')))return; try{ await api('deleteParent',{parentId:id}); toast(t('manage.deleted')); GO('manage'); }catch(e){err(e);} };

  // ---- Student edit (incl. insurance) ----
  window.A_studentForm=(id)=>{ const s=MOCK.students.find(x=>x.StudentID===id)||{};
    const f=(k,label,val,type)=>`<label class="field"><span>${esc(label)}</span><input id="stf_${k}" type="${type||'text'}" value="${esc(val!=null?val:'')}"/></label>`;
    modal(`<h3>✏️ ${esc(nm(s))}</h3>
      <div class="grid2">${f('NameTH',t('reg.nameTH'),s.NameTH)}${f('NameEN',t('reg.nameEN'),s.NameEN)}</div>
      <div class="grid2">${f('Nickname',t('reg.nickname'),s.Nickname)}${f('NicknameEN',t('reg.nicknameEN'),s.NicknameEN)}</div>
      <div class="grid2">${f('NationalID',t('reg.nationalIdStudent'),s.NationalID)}
        <label class="field"><span>${esc(t('manage.class'))}</span><select id="stf_Class">${MOCK.classes.map(c=>`<option ${s.Class===c.ClassName?'selected':''}>${esc(c.ClassName)}</option>`).join('')}</select></label></div>
      <div class="grid2"><label class="field"><span>${esc(t('reg.plan'))}</span><select id="stf_Plan"><option value="">${esc(t('manage.noPlan'))}</option>${(MOCK.config.Plans||[]).map(p=>`<option value="${p.id}" ${s.Plan===p.id?'selected':''}>${esc(EN()?p.labelEN:p.labelTH)} · ${baht(p.price)}</option>`).join('')}</select></label>
        <label class="field"><span>${esc(t('growth.photo'))}</span><input id="stf_Photo" type="file" accept="image/*"/></label></div>
      <div class="grid2">${f('Allergy',t('reg.allergy'),s.Allergy)}${f('MedicalHistory',t('reg.chronic'),s.MedicalHistory)}</div>
      <hr style="border:none;border-top:1px solid #eee;margin:8px 0">
      <label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="stf_Ins" ${s.InsuranceHas?'checked':''} style="width:auto" onchange="document.getElementById('insBox').hidden=!this.checked"/> 🛡️ ${esc(t('ins.has'))}</label>
      <div id="insBox" ${s.InsuranceHas?'':'hidden'}>
        <div class="grid2">${f('InsurancePolicyNo',t('ins.policy'),s.InsurancePolicyNo)}${f('InsuranceCompany',t('ins.company'),s.InsuranceCompany)}</div>
        ${f('InsuranceExpiry',t('ins.expiry'),s.InsuranceExpiry,'date')}
        <label class="field"><span>${esc(t('ins.card'))}</span><input id="stf_InsCard" type="file" accept="image/*"/>${s.InsuranceCardImage?`<br><img src="${esc(s.InsuranceCardImage)}" style="max-width:120px;border-radius:8px;margin-top:6px"/>`:''}</label></div>
      ${s.DriveFolderUrl?`<div class="card" style="background:#f7f9fc;padding:8px"><small class="muted">📁 ${esc(t('folder.student'))}<br><code style="font-size:11px">${esc(s.DriveFolderUrl)}</code><br>${esc(t('folder.note'))}</small></div>`:''}
      <button class="btn block" onclick="A_saveStudent(this,'${id}')">${esc(t('c.save'))}</button>`);
  };
  window.A_saveStudent=async(btn,id)=>{ const m=btn.closest('.modal'); const v=k=>{ const e=m.querySelector('#stf_'+k); return e?e.value.trim():''; };
    const data={NameTH:v('NameTH'),NameEN:v('NameEN'),Nickname:v('Nickname'),NicknameEN:v('NicknameEN'),NationalID:v('NationalID'),Class:v('Class'),Plan:v('Plan'),Allergy:v('Allergy'),MedicalHistory:v('MedicalHistory'),
      InsuranceHas:m.querySelector('#stf_Ins').checked,InsurancePolicyNo:v('InsurancePolicyNo'),InsuranceCompany:v('InsuranceCompany'),InsuranceExpiry:v('InsuranceExpiry')};
    const pf=m.querySelector('#stf_Photo').files[0]; if(pf) data.Photo=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(pf);});
    const cf=m.querySelector('#stf_InsCard').files[0]; if(cf) data.InsuranceCardImage=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(cf);});
    try{ await api('saveStudent',{studentId:id,data}); m.remove(); confirmSaved(t('c.saved')); GO('manage'); }catch(e){err(e);} };

  // ---- vaccine records (Admin/teacher) ----
  window.A_vaccines=async(sid)=>{ const s=MOCK.students.find(x=>x.StudentID===sid)||{}; const [sched,recs]=await Promise.all([api('vaccineSchedule'),api('studentVaccines',{studentId:sid})]);
    const got=k=>recs.find(r=>r.Key===k);
    modal(`<h3>💉 ${esc(t('vac.title'))} — ${esc(nm(s))}</h3><p class="muted" style="font-size:12px">${esc(t('vac.note'))}</p>
      ${sched.map(g=>`<div class="card" style="padding:8px"><b style="font-size:13px">${esc(EN()?g.ageEN:g.ageTH)}</b>
        ${g.items.map(it=>{ const r=got(it.key); return `<div class="list-item" style="gap:6px"><label style="display:flex;gap:6px;align-items:flex-start;flex:1;font-size:13px"><input type="checkbox" ${r?'checked':''} style="width:auto;margin-top:3px" onchange="A_vacToggle('${sid}','${it.key}',this.checked)"/><span>${esc(EN()?it.en:it.th)}</span></label><input type="date" id="vd_${it.key}" value="${esc(r?r.Date:'')}" style="width:140px" onchange="A_vacDate('${sid}','${it.key}',this.value)"/></div>`; }).join('')}</div>`).join('')}
      <button class="btn outline block" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_vacToggle=async(sid,key,on)=>{ if(on){ const d=document.getElementById('vd_'+key); await api('setVaccine',{studentId:sid,key,date:(d&&d.value)||todayStr()}); if(d&&!d.value)d.value=todayStr(); } else { await api('removeVaccine',{studentId:sid,key}); } toast(t('c.saved')); };
  window.A_vacDate=async(sid,key,date)=>{ if(date) await api('setVaccine',{studentId:sid,key,date}); toast(t('c.saved')); };

  // ---- Admin issues a bill to a parent (custom amount for mid-month proration / ad-hoc) ----
  window.A_issueBill=async(sid)=>{ const s=MOCK.students.find(x=>x.StudentID===sid)||{}; const base=await api('studentBillBase',{studentId:sid});
    modal(`<h3>🧾 ${esc(t('bill.issue'))} — ${esc(nm(s))}</h3><p class="muted" style="font-size:12px">${esc(t('bill.issueNote'))}</p>
      <div class="grid2"><label class="field"><span>${esc(t('c.month'))}</span><input type="month" id="biMonth" value="${monthStr()}"/></label>
        <label class="field"><span>${esc(t('bill.amount'))}</span><input type="number" id="biAmt" value="${base.price}"/></label></div>
      <p class="muted" style="font-size:11.5px">${esc(t('bill.planFull'))}: ${esc(EN()?base.labelEN:base.labelTH)} · ${baht(base.price)} — ${esc(t('bill.prorateHint'))}</p>
      <label class="field"><span>${esc(t('bill.label'))}</span><input id="biLabel" value="${esc((EN()?'Tuition ':'ค่าเทอม ')+(EN()?base.labelEN:base.labelTH))}"/></label>
      <label class="field"><span>${esc(t('c.reason')) } (${esc(t('bill.optional'))})</span><input id="biNote" placeholder="${esc(t('bill.notePh'))}"/></label>
      <label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="biPaid" style="width:auto" onchange="document.getElementById('biPaidBox').hidden=!this.checked"/> 💵 ${esc(t('bill.markPaid'))}</label>
      <div id="biPaidBox" hidden><small class="muted" style="font-size:11.5px">${esc(t('bill.advanceHint'))}</small>
        <label class="field"><span>${esc(t('bill.paidDate'))}</span><input type="date" id="biPaidDate" value="${todayStr()}"/></label></div>
      <button class="btn block" onclick="A_issueBillDo('${sid}',this)">${esc(t('bill.send'))}</button>`);
  };
  window.A_issueBillDo=async(sid,btn)=>{ const m=btn.closest('.modal'); const amt=+m.querySelector('#biAmt').value;
    if(!amt){toast(t('bill.amount'));return;} const paid=m.querySelector('#biPaid').checked; const paidDate=m.querySelector('#biPaidDate').value;
    try{ await api('issueBill',{studentId:sid,month:m.querySelector('#biMonth').value,amount:amt,label:m.querySelector('#biLabel').value.trim(),note:m.querySelector('#biNote').value.trim(),paid,paidDate});
      m.remove(); confirmSaved(t('bill.sent')); GO('manage'); }catch(e){err(e);} };
  // auto-generate the month's bills for all active students (recurring monthly)
  window.A_genBills=()=>{ modal(`<h3>📅 ${esc(t('bill.genTitle'))}</h3><p class="muted" style="font-size:12px">${esc(t('bill.genNote'))}</p>
    <label class="field"><span>${esc(t('c.month'))}</span><input type="month" id="gbMonth" value="${monthStr()}"/></label>
    <button class="btn block" onclick="A_genBillsDo(this)">${esc(t('bill.genBtn'))}</button>`); };
  window.A_genBillsDo=async(btn)=>{ const m=btn.closest('.modal'); const r=await api('generateMonthlyBills',{month:m.querySelector('#gbMonth').value});
    m.remove(); confirmSaved(t('bill.genDone').replace('{n}',r.created).replace('{m}',r.month)); };

  // ---- per-student extra charges (auto-merged into monthly bill) ----
  window.A_charges=async(sid)=>{ const s=MOCK.students.find(x=>x.StudentID===sid)||{}; const month=monthStr(); const list=await api('studentCharges',{studentId:sid,month});
    modal(`<h3>💵 ${esc(t('charge.title'))} — ${esc(nm(s))}</h3><p class="muted" style="font-size:12px">${esc(t('charge.note'))} (${esc(month)})</p>
      <div id="chList">${list.map(c=>`<div class="list-item"><span>${esc(c.Label)}</span><span><b>${baht(c.Amount)}</b> <button class="btn sm pink" onclick="A_delCharge('${c.ChargeID}','${sid}')">✕</button></span></div>`).join('')||`<small class="muted">${esc(t('c.noItems'))}</small>`}</div>
      <div class="grid2" style="margin-top:8px"><input id="chLabel" placeholder="${esc(t('charge.label'))}"/><input id="chAmt" type="number" placeholder="${esc(t('charge.amount'))}"/></div>
      <button class="btn block" style="margin-top:6px" onclick="A_addCharge('${sid}')">+ ${esc(t('charge.add'))}</button>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_addCharge=async(sid)=>{ const label=$('#chLabel').value.trim(), amt=+$('#chAmt').value; if(!label||!amt){toast(t('charge.label'));return;}
    await api('addStudentCharge',{studentId:sid,month:monthStr(),label,amount:amt}); const m=document.querySelector('.modal'); if(m)m.remove(); A_charges(sid); toast(t('c.saved')); };
  window.A_delCharge=async(id,sid)=>{ await api('removeStudentCharge',{chargeId:id}); const m=document.querySelector('.modal'); if(m)m.remove(); A_charges(sid); toast(t('manage.deleted')); };

  // ---- Import / Export students ----
  window.A_exportStudent=async(id)=>{ if(!confirm(t('manage.confirmExport')))return;
    try{ const r=await api('exportStudent',{studentId:id});
      if(window.XLSXMin) XLSXMin.download(r.filename, r.rows, 'Student');
      confirmSaved((EN()?'Exported & removed: ':'นำออกแล้ว: ')+r.filename); GO('manage'); }catch(e){err(e);} };
  // ---- Admin: remove a student from the system (with required reason) ----
  window.A_removeStudent=(id,withdrawId,preset)=>{ const s=MOCK.students.find(x=>x.StudentID===id)||{};
    const m=modal(`<h3>🚪 ${esc(t('wd.remove'))} — ${esc(nm(s))}</h3><p class="muted" style="font-size:12px">${esc(t('wd.adminNote'))}</p>
      ${withdrawReasonField('rmReason','rmDetail')}
      <button class="btn block pink" onclick="A_removeStudentDo('${id}',this,'${withdrawId||''}')">${esc(t('wd.remove'))}</button>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
    if(preset){ const sel=m.querySelector('#rmReason'); if(sel){ sel.value=preset; WD_toggleDetail('rmReason','rmDetail'); } } };
  window.A_removeStudentDo=async(id,btn,withdrawId)=>{ if(!confirm(t('wd.confirmRemove')))return; const m=btn.closest('.modal');
    const reason=m.querySelector('#rmReason').value; const detEl=m.querySelector('#rmDetail');
    try{ await api('removeStudent',{studentId:id,reason,detail:detEl?detEl.value.trim():'',adminId:USER.staffId,withdrawId:withdrawId||undefined});
      m.remove(); confirmSaved(t('wd.removed')); GO('manage'); }catch(e){err(e);} };
  // process a parent withdrawal request → opens the removal modal pre-filled with the requested reason
  window.A_processWithdraw=(withdrawId,studentId,reason)=>A_removeStudent(studentId,withdrawId,reason);

  // ---- Admin: PCHI insurance review / edit ----
  window.A_insurance = async ()=>{ const list=await api('insuranceList');
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('manage')">${t('c.back')}</button><h2 class="page">🛡️ ${esc(t('ins2.manage'))}</h2>
      <div class="card"><p class="muted" style="font-size:12px">${esc(t('ins2.manageNote'))}</p>
      ${list.map(x=>`<div class="list-item"><span><b>${esc(EN()?(x.nameEN||x.name):x.name)}</b> <small class="muted">${esc(x.class||'')} · ${EN()?'ID':'บัตร'} ${esc(x.nationalId||'-')}</small> <span class="pill ${x.filled?'ok':'wait'}">${x.filled?'✓ '+esc(t('ins2.filled')):esc(t('ins2.notFilled'))}</span></span>
        <button class="btn sm ${x.filled?'outline':''}" onclick="A_insuranceEdit('${x.studentId}')">${x.filled?'✏️':esc(t('ins2.btn'))}</button></div>`).join('')}</div>`;
    window.scrollTo(0,0); };
  window.A_insuranceEdit = async (sid)=>{ const st=await api('insuranceStatus',{studentId:sid}); const o=await api('insuranceOptions'); const s=MOCK.students.find(x=>x.StudentID===sid)||{};
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="A_insurance()">${t('c.back')}</button><h2 class="page">🛡️ ${esc(t('ins2.adminEdit'))}</h2>
      <div class="card" style="background:#f7f9fc"><b>${esc(nm(s))}</b> <span class="pill ${st.filled?'ok':'wait'}">${st.filled?esc(t('ins2.filled')):esc(t('ins2.notFilled'))}</span></div>
      ${insuranceFormHTML(o,s,st.record)}
      <button class="btn block" onclick="A_insuranceSave('${sid}')">${esc(t('c.save'))}</button>`; window.scrollTo(0,0); };
  window.A_insuranceSave = async (sid)=>{ const d=readInsuranceForm(); if(!insValid(d)){toast(t('ins2.required'));return;}
    try{ await api('saveInsuranceAdmin',{studentId:sid,adminId:USER.staffId,data:d}); confirmSaved(t('c.saved')); A_insurance(); }catch(e){err(e);} };

  // ---- Admin: activity log (who did what) ----
  window.A_activityLog=async()=>{ const rows=await api('activityLog',{limit:200});
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('manage')">${t('c.back')}</button><h2 class="page">📜 ${esc(t('act.title'))}</h2>
      <div class="card"><p class="muted" style="font-size:12px">${esc(t('act.note'))}</p>
      ${rows.length?rows.map(r=>`<div class="list-item"><span><b>${esc(r.Action)}</b> <small class="muted">${esc(r.Target||'')}</small><br><small class="muted">${esc(r.Detail||'')}</small></span>
        <small class="muted" style="text-align:right">${esc(r.UserName||r.UserRole||'')}<br>${esc(r.Timestamp)}</small></div>`).join(''):`<small class="muted">${esc(t('c.noItems'))}</small>`}</div>`;
  };

  ADMIN_SUB_importExport = async ()=>{ const exported=await api('listExportedStudents');
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('manage')">${t('c.back')}</button><h2 class="page">📥 ${esc(t('manage.importExport'))}</h2>
      <div class="card"><h3>📤 ${esc(t('ie.exportedFolder'))}</h3><p class="muted" style="font-size:12px">${esc(t('ie.folderNote'))}</p>
        ${exported.length?exported.map(s=>`<div class="list-item"><span><b>${esc(nm(s))}</b> <small class="muted">${esc(s.NationalID||'')} · ${EN()?'exported':'นำออก'} ${esc(s.ExportedDate||'')}</small></span><button class="btn sm green" onclick="A_reimport('${s.StudentID}')">↩️ ${esc(t('ie.reimport'))}</button></div>`).join(''):`<small class="muted">${esc(t('c.noItems'))}</small>`}</div>
      <div class="card"><h3>📂 ${esc(t('ie.importFile'))}</h3><p class="muted" style="font-size:12px">${esc(t('ie.importNote'))}</p>
        <label class="field"><span>${esc(t('ie.chooseXlsx'))}</span><input type="file" id="impF" accept=".xlsx"/></label>
        <button class="btn block" onclick="A_importFile()">${esc(t('ie.import'))}</button></div>`;
  };
  window.A_reimport=async(id)=>{ try{ await api('importStudent',{studentId:id}); confirmSaved(t('ie.imported')); GO_('importExport'); }catch(e){err(e);} };
  window.A_importFile=async()=>{ const f=$('#impF').files[0]; if(!f){toast(t('ie.chooseXlsx'));return;}
    try{ const rows=await XLSXMin.parse(f); await api('importStudent',{rows}); confirmSaved(t('ie.imported')); GO_('importExport'); }catch(e){err(e);} };

  // ---- Staff groups & hours ----
  window.A_groups=async()=>{ const groups=await api('listStaffGroups');
    modal(`<h3>🕑 ${esc(t('manage.groups'))}</h3><p class="muted" style="font-size:12px">${esc(t('manage.groupsNote'))}</p>
      <div id="grpList">${groups.map(g=>`<div class="card" style="padding:10px"><div class="spread"><b>${esc(EN()?g.GroupNameEN:g.GroupName)}</b><button class="btn sm pink" onclick="A_delGroup('${esc(g.GroupName)}')">🗑️</button></div>
        <div class="grid2" style="margin-top:6px"><label class="field"><span>${esc(t('lbl.checkIn'))}</span><input type="time" value="${esc(g.CheckInTime)}" onchange="A_setGroup('${esc(g.GroupName)}','in',this.value)"/></label>
          <label class="field"><span>${esc(t('lbl.checkOut'))}</span><input type="time" value="${esc(g.CheckOutTime)}" onchange="A_setGroup('${esc(g.GroupName)}','out',this.value)"/></label></div></div>`).join('')}</div>
      <div class="card" style="background:#f7f9fc;padding:10px"><b style="font-size:13px">➕ ${esc(t('grp.add'))}</b>
        <div class="grid2" style="margin-top:6px"><input id="ngName" placeholder="${esc(t('grp.nameTH'))}"/><input id="ngNameEN" placeholder="${esc(t('grp.nameEN'))}"/></div>
        <div class="grid2" style="margin-top:6px"><input id="ngIn" type="time" value="08:00"/><input id="ngOut" type="time" value="17:00"/></div>
        <button class="btn block" style="margin-top:6px" onclick="A_addGroup(this)">${esc(t('grp.add'))}</button></div>
      <button class="btn block outline" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_setGroup=async(group,which,val)=>{ await api('setStaffGroupHours',{group,checkIn:which==='in'?val:undefined,checkOut:which==='out'?val:undefined}); toast(t('c.saved')); };

  // ---- departments (Nursery) add / rename / remove ----
  window.A_departments=async()=>{ const deps=await api('listDepartments');
    modal(`<h3>🏫 ${esc(t('manage.departments'))}</h3>
      <div id="depList">${deps.map(d=>`<div class="list-item"><input value="${esc(d)}" id="dep_${esc(d)}" style="flex:1"/><span class="row"><button class="btn sm" onclick="A_renameDep('${esc(d)}')">💾</button><button class="btn sm pink" onclick="A_delDep('${esc(d)}')">🗑️</button></span></div>`).join('')}</div>
      <div class="grid2" style="margin-top:8px"><input id="newDep" placeholder="${esc(t('dep.name'))}"/><button class="btn" onclick="A_addDep()">+ ${esc(t('manage.add'))}</button></div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_addDep=async()=>{ const n=$('#newDep').value.trim(); if(!n){toast(t('dep.name'));return;} try{ await api('addDepartment',{name:n}); const m=document.querySelector('.modal'); if(m)m.remove(); A_departments(); toast(t('c.saved')); }catch(e){err(e);} };
  window.A_renameDep=async(old)=>{ const nv=document.getElementById('dep_'+old).value.trim(); if(!nv||nv===old)return; try{ await api('renameDepartment',{old,'new':nv}); const m=document.querySelector('.modal'); if(m)m.remove(); A_departments(); toast(t('c.saved')); }catch(e){err(e);} };
  window.A_delDep=async(name)=>{ if(!confirm(t('manage.confirmDel')))return; try{ await api('removeDepartment',{name}); const m=document.querySelector('.modal'); if(m)m.remove(); A_departments(); toast(t('manage.deleted')); }catch(e){err(e);} };

  // ---- settings: diligence amounts + leave quota (Admin-editable) ----
  window.A_settings=async()=>{ const q=await api('getLeaveQuota'); const cfg=MOCK.config;
    modal(`<h3>⚙️ ${esc(t('manage.settings'))}</h3>
      <h4 style="margin:6px 0">${esc(t('set.diligence'))}</h4>
      <div class="grid2"><label class="field"><span>${esc(t('set.attendAmt'))}</span><input id="setAtt" type="number" value="${cfg.DiligenceAttendanceAmount}"/></label>
        <label class="field"><span>${esc(t('set.fbAmt'))}</span><input id="setFb" type="number" value="${cfg.DiligenceFacebookAmount}"/></label></div>
      <h4 style="margin:6px 0">${esc(t('set.leaveQuota'))}</h4>
      ${Object.keys(q).map(k=>`<label class="field"><span>${esc(tLeaveType(k))}</span><input type="number" id="lq_${esc(k)}" value="${q[k]}"/></label>`).join('')}
      <button class="btn block" onclick="A_saveSettings(this)">${esc(t('c.save'))}</button>`);
  };
  window.A_saveSettings=async(btn)=>{ const m=btn.closest('.modal');
    await api('setConfigVal',{key:'DiligenceAttendanceAmount',value:+m.querySelector('#setAtt').value});
    await api('setConfigVal',{key:'DiligenceFacebookAmount',value:+m.querySelector('#setFb').value});
    for(const k of Object.keys(MOCK.config.LeaveQuota)){ const el=m.querySelector('#lq_'+k); if(el) await api('setLeaveQuota',{type:k,days:+el.value}); }
    m.remove(); confirmSaved(t('c.saved')); };

  // ---- OT verification (check the ≥50min→1hr rule on attendance) ----
  window.A_otVerify=async()=>{ const rows=await api('otVerification',{});
    modal(`<h3>⏱️ ${esc(t('manage.otVerify'))}</h3><p class="muted" style="font-size:12px">${esc(t('ot.verifyNote'))}</p>
      <div style="overflow:auto"><table style="width:100%;font-size:12px;border-collapse:collapse">
      <tr style="background:#1565C0;color:#fff"><th style="padding:3px 5px">${esc(t('hol.date'))}</th><th>${esc(t('c.staff'))}</th><th>${esc(t('lbl.checkOut'))}</th><th>OT (${esc(t('lbl.min'))})</th><th>OT (ชม.)</th></tr>
      ${rows.map(r=>`<tr style="border-bottom:1px solid #eee"><td style="padding:3px 5px">${esc(r.date)}</td><td>${esc(staffName(r.staffId))}</td><td>${esc(r.out)} <small class="muted">/${esc(r.schedOut)}</small></td><td style="text-align:center">${r.otMinutes}</td><td style="text-align:center"><b>${r.otHours}</b></td></tr>`).join('')}
      </table></div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_addGroup=async(btn)=>{ const m=btn.closest('.modal'); const name=m.querySelector('#ngName').value.trim(); if(!name){toast(t('grp.nameTH'));return;}
    try{ await api('addStaffGroup',{name,nameEN:m.querySelector('#ngNameEN').value.trim()||name,checkIn:m.querySelector('#ngIn').value,checkOut:m.querySelector('#ngOut').value}); m.remove(); confirmSaved(t('c.saved')); A_groups(); }catch(e){err(e);} };
  window.A_delGroup=async(name)=>{ if(!confirm(t('manage.confirmDel')))return; try{ await api('deleteStaffGroup',{name}); toast(t('manage.deleted')); const m=document.querySelector('.modal'); if(m)m.remove(); A_groups(); }catch(e){err(e);} };

  // ---- Organize: move teachers/students between Nurseries (drag-drop + dropdown fallback) ----
  ADMIN_SUB_organize = async ()=>{ const [staff,students]=await Promise.all([api('listStaff'),api('listStudents')]);
    const deps=MOCK.config.Departments.filter(d=>d);
    const opts=cur=>deps.map(d=>`<option ${cur===d?'selected':''}>${esc(d)}</option>`).join('');
    const col=dep=>{ const ts=staff.filter(s=>s.Department===dep&&s.Role==='Teacher'); const ss=students.filter(s=>s.Class===dep);
      return `<div class="card org-col" ondragover="event.preventDefault()" ondrop="A_drop(event,'${esc(dep)}')"><h3>${esc(dep)} <small class="muted">${ts.length}👩‍🏫 · ${ss.length}👶</small></h3>
        ${ts.map(s=>`<div class="org-chip" draggable="true" ondragstart="A_drag(event,'teacher','${s.StaffID}')"><span>👩‍🏫 ${esc(nm(s))}</span><select onchange="A_moveSel('teacher','${s.StaffID}',this.value)">${opts(dep)}</select></div>`).join('')}
        ${ss.map(s=>`<div class="org-chip" draggable="true" ondragstart="A_drag(event,'student','${s.StudentID}')"><span>${studentAvatar(s)} ${esc(nm(s))}</span><select onchange="A_moveSel('student','${s.StudentID}',this.value)">${opts(dep)}</select></div>`).join('')}</div>`; };
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('manage')">${t('c.back')}</button>
      <h2 class="page">🔁 ${esc(t('manage.organize'))}</h2>
      <p class="muted" style="font-size:12px">${esc(t('org.note'))}</p>
      <div class="org-grid">${deps.map(col).join('')}</div>`;
  };
  window.A_drag=(e,type,id)=>{ e.dataTransfer.setData('text/plain',type+':'+id); };
  window.A_drop=async(e,dep)=>{ e.preventDefault(); const d=(e.dataTransfer.getData('text/plain')||'').split(':'); if(d.length<2)return; await A_moveSel(d[0],d[1],dep); };
  window.A_moveSel=async(type,id,dep)=>{ try{ if(type==='teacher')await api('moveTeacher',{staffId:id,toDept:dep}); else await api('moveStudent',{studentId:id,toClass:dep}); toast(t('org.moved')); GO_('organize'); }catch(e){err(e);} };

  // ---- Holiday DB ----
  ADMIN_SUB_holidays = async ()=>{ const hs=await api('holidays');
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('manage')">${t('c.back')}</button><h2 class="page">🗓️ ${esc(t('manage.holidays'))}</h2>
      <div class="card"><h3>➕ ${esc(t('hol.add'))}</h3>
        <div class="grid2"><label class="field"><span>${esc(t('hol.date'))}</span><input type="date" id="hDate"/></label>
          <label class="field" style="display:flex;align-items:center;gap:8px;margin-top:22px"><input type="checkbox" id="hRec" style="width:auto"/> ${esc(t('hol.recurring'))}</label></div>
        <div class="grid2"><label class="field"><span>${esc(t('hol.nameTH'))}</span><input id="hNameTH"/></label><label class="field"><span>${esc(t('hol.nameEN'))}</span><input id="hNameEN"/></label></div>
        <button class="btn block" onclick="A_addHoliday()">${esc(t('hol.add'))}</button></div>
      <div class="card"><h3>📋 ${esc(t('hol.list'))}</h3>${hs.map(h=>`<div class="list-item"><span><b>${esc(h.Date)}</b> · ${esc(EN()?h.NameEN:h.NameTH)}${h.Recurring?` <span class="pill info">${esc(t('hol.yearly'))}</span>`:''}</span><button class="btn sm pink" onclick="A_removeHoliday('${h.Date}','${esc(h.NameTH)}')">🗑️</button></div>`).join('')}</div>`;
  };
  window.A_addHoliday=async()=>{ const d=$('#hDate').value; if(!d){toast(t('hol.date'));return;}
    await api('addHoliday',{date:d,nameTH:$('#hNameTH').value,nameEN:$('#hNameEN').value,recurring:$('#hRec').checked}); confirmSaved(t('c.saved')); GO_('holidays'); };
  window.A_removeHoliday=async(date,nameTH)=>{ await api('removeHoliday',{date,nameTH}); toast(t('manage.deleted')); GO_('holidays'); };

  // Admin finance dashboard — tuition collection + salary payout + income/expense
  let FIN_MONTH=null;
  SCREENS.Admin.finance = async () => { const month=FIN_MONTH||monthStr(); const f=await api('financeSummary',{month});
    const stat=(cls,n,l)=>`<div class="stat ${cls}"><div class="n">${n}</div><div class="l">${esc(l)}</div></div>`;
    app.innerHTML=`<h2 class="page">💰 ${esc(t('fin.title'))}</h2>
      <div class="card"><label class="field"><span>${esc(t('c.month'))}</span><input type="month" value="${month}" onchange="FIN_set(this.value)"/></label>
        <div class="grid2"><div class="grid2" style="grid-template-columns:1fr 1fr;gap:8px">${stat('green',baht(f.income),t('fin.income'))}${stat('pink',baht(f.expense),t('fin.expense'))}</div>
          <div class="grid2" style="grid-template-columns:1fr 1fr;gap:8px">${stat(f.net>=0?'':'amber',baht(f.net),t('fin.net'))}${stat('amber',baht(f.tuitionOutstanding),t('fin.outstanding'))}</div></div></div>
      <div class="card"><div class="spread"><h3>👶 ${esc(t('fin.tuition'))}</h3><span class="pill ${f.studentsPaid>=f.studentsTotal?'ok':'wait'}">${f.studentsPaid}/${f.studentsTotal} ${esc(t('fin.paid'))}</span></div>
        ${f.students.map(s=>`<div class="list-item"><span>${esc(EN()?s.nameEN:s.name)} <small class="muted">${esc(planLabel(s.plan))}</small></span><span>${baht(s.due||s.amount)} ${s.paid?`<span class="pill ok">${esc(t('s.paid'))}</span>`:s.status==='NO_BILL'?`<span class="pill info">${esc(t('fin.noBill'))}</span>`:`<span class="pill bad">${esc(t('s.unpaid'))}</span>`}</span></div>`).join('')}
        <div class="spread" style="margin-top:8px"><b>${esc(t('fin.collected'))}</b><b style="color:#2e7d32">${baht(f.tuitionCollected+f.otCollected)}</b></div></div>
      <div class="card"><div class="spread"><h3>👩‍🏫 ${esc(t('fin.salary'))}</h3><span class="pill ${f.staffPaid>=f.staffTotal?'ok':'wait'}">${f.staffPaid}/${f.staffTotal} ${esc(t('fin.computed'))}</span></div>
        ${f.staff.map(s=>`<div class="list-item"><span>${esc(EN()?s.nameEN:s.name)}</span><span>${baht(s.net)} ${s.computed?`<span class="pill ok">${esc(t('fin.done'))}</span>`:`<span class="pill bad">${esc(t('fin.pending'))}</span>`}</span></div>`).join('')}
        <div class="spread" style="margin-top:8px"><b>${esc(t('fin.totalSalary'))}</b><b style="color:#c62828">${baht(f.expense)}</b></div></div>`;
  };
  window.FIN_set=(m)=>{ FIN_MONTH=m; GO('finance'); };

  // ---- Admin Daily Report (web + send to LINE OA) ----
  SCREENS.Admin.daily = async () => { const r=await api('dailyReport');
    const dot=st=>st==='IN'?'dot-in':st==='OUT'?'dot-out':st==='LEAVE'?'dot-leave':'dot-absent';
    app.innerHTML=`<h2 class="page">📋 ${esc(t('daily.title'))} (${esc(r.date)})</h2>
      <div class="card"><div class="spread"><b>${esc(t('daily.overall'))}</b><span class="muted">${esc(t('lbl.present'))} ${r.totals.in} · ${esc(t('lbl.left'))} ${r.totals.out} · ${esc(t('lbl.onleave'))} ${r.totals.leave} · ${esc(t('lbl.absent'))} ${r.totals.absent} / ${r.totals.total}</span></div></div>
      ${r.classes.map(c=>`<div class="card"><div class="spread"><b>${esc(c.className)}</b><span class="muted">${esc(t('lbl.present'))} ${c.in}·${esc(t('lbl.onleave'))} ${c.leave}·${esc(t('lbl.absent'))} ${c.absent}/${c.total}</span></div>
        <div>${c.students.map(s=>`<span class="att" style="display:inline-flex;margin-right:10px"><span class="dot-s ${dot(s.status)}"></span>${esc(dn(s))}${s.status==='LEAVE'?' ('+esc(t('lbl.onleave'))+')':s.status==='ABSENT'?' ('+esc(t('lbl.absent'))+')':''}</span>`).join('')}</div></div>`).join('')}
      <div class="card"><h3>⏰ ${esc(t('daily.lateStaff'))}</h3>${r.lateStaff.length?r.lateStaff.map(s=>`<div class="list-item"><span>${esc(EN()?s.nameEN:s.name)}</span><span class="pill bad">${esc(t('lbl.late'))} ${s.late} ${esc(t('lbl.min'))}</span></div>`).join(''):`<small class="muted">${esc(t('c.noItems'))}</small>`}</div>
      <div class="card" style="background:#fff8e1;border-color:#f0e3b0"><h3>🚨 ${esc(t('daily.absenceAlert'))}</h3>
        <p class="muted" style="font-size:12px">${esc(t('daily.alertNote'))}</p>
        ${r.absent2.map(s=>`<div class="list-item"><span>${esc(EN()?s.nameEN:s.name)} <small class="muted">${esc(s.class)}</small></span><span class="pill ${s.count>=5?'bad':'wait'}">${esc(t('abs.days').replace('{n}',s.count))}</span></div>`).join('')||`<small class="muted">${esc(t('c.noItems'))}</small>`}
        <button class="btn sm outline" style="margin-top:8px" onclick="GO('absence')">${esc(t('abs.title'))} →</button></div>
      ${(r.injuries&&r.injuries.length)?`<div class="card" style="background:#fdecea;border-color:#f5b7b1"><h3 style="color:#c0392b">${esc(t('daily.injuryAlert'))} (${r.injuries.length})</h3>
        <p class="muted" style="font-size:12px">${esc(t('daily.injuryNote'))}</p>${injuryListHTML(r.injuries)}</div>`:''}
      <button class="btn block green" onclick="A_sendLine()">📤 ${esc(t('daily.sendLine'))}</button>`;
  };
  window.A_sendLine=()=>{ toast(EN()?'Daily report sent to LINE OA (demo)':'ส่งสรุปไป LINE OA แล้ว (เดโม)'); };

  // ---- Admin: confirm parent payments (slips await admin verification) ----
  SCREENS.Admin.verify = async () => { const list=await api('pendingPayments');
    let slips={}; try{ slips=JSON.parse(localStorage.getItem('atom_slips')||'{}'); }catch(e){}
    app.innerHTML=`<h2 class="page">✅ ${esc(t('verify.title'))}</h2>
      <p class="muted" style="font-size:12px">${esc(t('verify.note'))}</p>
      ${list.length?list.map(x=>{ const s=slips[x.id]; const img=(x.slip&&/^(data:|https?:)/.test(x.slip))?x.slip:(s&&s.data); const kindLbl={bill:t('verify.monthly'),ot:'OT',prepay:t('prepay.title')}[x.kind];
        const cash=x.method==='cash'; const methodPill=`<span class="pill ${cash?'wait':'info'}">${cash?'💵 '+esc(t('pay.cash')):'🏦 '+esc(t('pay.transfer'))}</span>`;
        return `<div class="card"><div class="spread"><div><b>${esc(EN()?x.nameEN:x.name)}</b> <span class="pill info">${esc(kindLbl)}</span> ${methodPill}<br><small class="muted">${esc(x.label)}${x.transactionDate?' · '+esc(t('pay.txnDate'))+' '+esc(x.transactionDate):''}</small></div>
          <span class="pill ${x.match?'ok':'bad'}">${x.match?'✓ '+esc(t('verify.match')):'✗ '+esc(t('verify.mismatch'))}</span></div>
          <table style="width:100%;font-size:13px;margin:6px 0"><tr><td>${esc(t('slip.amountDue'))}</td><td style="text-align:right"><b>${baht(x.due)}</b></td></tr>
          <tr><td>${esc(cash?t('pay.cash'):t('slip.amountPaid'))} ${x.fromQR?`<span class="pill info" style="font-size:10px">QR</span>`:''}</td><td style="text-align:right"><b style="color:${x.match?'#2e7d32':'#c62828'}">${baht(x.slipAmount)}</b></td></tr></table>
          ${cash?`<div style="background:#fffbe6;border-radius:8px;padding:6px 8px;font-size:12.5px;color:#8a6d00">💵 ${esc(t('verify.cashPending'))}</div>`:(img?`<img src="${esc(img)}" style="max-height:140px;border-radius:8px;border:1px solid #eee;cursor:zoom-in" onclick="ZOOM_IMG('${esc(img)}')"/>`:`<small class="muted">📎 ${esc(x.slipName||x.slip||'slip')}</small>`)}
          <label class="field" style="margin-top:8px"><span>${esc(t('pay.paidDate'))}</span><input type="date" id="pd_${esc(x.id)}" value="${todayStr()}"/></label>
          <div class="row" style="margin-top:6px"><button class="btn sm green" onclick="A_confirmPay('${x.kind}','${x.id}','${cash?'cash':'transfer'}')">✅ ${esc(t('verify.confirm'))}</button><button class="btn sm pink" onclick="A_rejectPay('${x.kind}','${x.id}')">✗ ${esc(t('verify.reject'))}</button></div></div>`;
      }).join(''):`<div class="card muted">${esc(t('verify.empty'))}</div>`}`;
  };
  window.A_confirmPay=async(kind,id,method)=>{ const d=document.getElementById('pd_'+id); const paidDate=(d&&d.value)||todayStr();
    try{ await api('confirmPayment',{kind,id,adminId:USER.staffId,paidDate,method}); confirmSaved(t('verify.confirmed')); GO('verify'); }catch(e){err(e);} };
  window.A_rejectPay=async(kind,id)=>{ if(!confirm(t('verify.rejectConfirm')))return; try{ await api('rejectPayment',{kind,id}); toast(t('verify.rejected')); GO('verify'); }catch(e){err(e);} };

  // ---- absence tracking (Teacher / Leader / Admin) ----
  async function absenceScreen(){ setNav(CURRENT);
    const [r2,r5,rate]=await Promise.all([api('absenceReport',{minDays:2}),api('absenceReport',{minDays:5}),api('ratedChildCount')]);
    const STATUSES=['','กำลังติดตาม','ติดตามแล้ว','ลายาว','ออกกลางคัน'];
    const row=(s,withReason)=>`<div class="list-item" style="flex-wrap:wrap"><span>${esc(EN()?s.nameEN:s.name)} <small class="muted">${esc(s.class)} · ${esc(t('abs.days').replace('{n}',s.count))}${withReason&&s.reasons?' · '+esc(s.reasons):''}</small></span>
      <span class="row" style="width:100%;margin-top:6px"><input id="fn_${s.studentId}" placeholder="${esc(t('abs.note'))}" value="${esc(s.note)}" style="flex:1"/>
        <select id="fs_${s.studentId}">${STATUSES.map(st=>`<option ${s.status===st?'selected':''}>${esc(st||'-')}</option>`).join('')}</select>
        <button class="btn sm" onclick="A_followup('${s.studentId}')">${esc(t('c.save'))}</button></span></div>`;
    const back = USER.role==='Admin'?'manage':'home';
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('${back}')">${t('c.back')}</button><h2 class="page">🔎 ${esc(t('abs.title'))}</h2>
      <div class="card" style="background:#eef6ff"><div class="spread"><b>${esc(t('abs.rated'))}</b><b>${rate.rated}/${rate.total}</b></div><small class="muted">${esc(t('abs.rateNote').replace('{n}',rate.excludeDays).replace('{x}',rate.excluded))}</small></div>
      <div class="card"><h3>⚠️ ${esc(t('abs.ge2'))}</h3>${r2.length?r2.map(s=>row(s,false)).join(''):`<small class="muted">${esc(t('c.noItems'))}</small>`}</div>
      <div class="card"><h3>🚨 ${esc(t('abs.ge5'))}</h3>${r5.length?r5.map(s=>row(s,true)).join(''):`<small class="muted">${esc(t('c.noItems'))}</small>`}</div>`;
  }
  SCREENS.Teacher.absence = absenceScreen; SCREENS.Admin.absence = absenceScreen;
  window.A_followup=async(sid)=>{ await api('setAbsenceFollowup',{studentId:sid,note:$('#fn_'+sid).value,status:$('#fs_'+sid).value==='-'?'':$('#fs_'+sid).value}); confirmSaved(t('c.saved')); };

  // Admin chat -> LINE OA (manage all conversations in one place)
  SCREENS.Admin.chat = async () => { const line=MOCK.config.Links.line||'#';
    app.innerHTML=`<h2 class="page">💬 ${esc(t('title.chat'))}</h2>
      <div class="card" style="text-align:center"><div style="font-size:48px">💬</div>
        <p>${esc(t('chat.lineMsg'))}</p>
        <a class="btn block green" href="${esc(line)}" target="_blank">${esc(t('chat.openLine'))} →</a>
        <p class="muted" style="font-size:12px;margin-top:10px">${esc(t('chat.lineNote'))}</p></div>`;
  };

  function staffName(id){ const s=MOCK.staff.find(x=>x.StaffID===id); return s?(LANG()==='en'?s.NameEN:s.NameTH):id; }
  // open in a new tab to print; if popups blocked, download as .html so there is always a file
  function openOrDownload(html, filename){
    if(window.trPhrase) html=trPhrase(html);
    let w=null; try{ w=window.open('','_blank'); }catch(e){}
    if(w){ w.document.write(html); w.document.close(); return; }
    const blob=new Blob([html],{type:'text/html'}); const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000); toast(LANG()==='en'?'Downloaded '+filename:'ดาวน์โหลด '+filename+' แล้ว');
  }

  // parent payment receipt (printable / downloadable)
  function buildReceiptHTML(b,s){ const logo=window._LOGO||(location.origin+'/assets/logo.png'); const corner=window._LOGOCORNER||(location.origin+'/assets/logo-corner.jpg');
    const due=b.TotalDue!=null?b.TotalDue:b.Amount;
    const rows=(b.Items||[]).map(it=>`<tr><td>${esc(trItem(it[0]))}</td><td style="text-align:right">${baht(it[1])}</td></tr>`).join('')+(b.OTRollover?`<tr><td>OT</td><td style="text-align:right">${baht(b.OTRollover)}</td></tr>`:'');
    return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(b.BillingID)}</title><link href="https://fonts.googleapis.com/css2?family=Sarabun&display=swap" rel="stylesheet">
      <style>@page{size:A5}body{font-family:Sarabun,sans-serif;margin:0;padding:18px;color:#222}.hd{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #1565C0;padding-bottom:8px}
      .hd img{height:46px} h1{font-size:20px;color:#1565C0;margin:0} .meta{font-size:13px;margin:10px 0} table{width:100%;border-collapse:collapse;font-size:14px;margin-top:8px}td{padding:5px 6px;border-bottom:1px solid #eee}
      .tot{font-size:18px;font-weight:bold;color:#1565C0} .paid{margin-top:10px;color:#2e7d32;font-weight:bold} .bar{padding:8px;text-align:center}@media print{.bar{display:none}}</style></head>
      <body><div class="bar"><button onclick="window.print()">🖨️ ${esc(t('c.print'))}</button></div>
      <div class="hd"><img src="${logo}"/><div style="text-align:center"><h1>Atom Nursery</h1><div style="font-size:12px">${esc(t('pay.receipt'))} / Receipt</div></div><img src="${corner}" style="border-radius:6px"/></div>
      <div class="meta"><b>${esc(t('reg.student'))}:</b> ${esc(s.NameTH||'')} (${esc(s.NameEN||'')})<br><b>${esc(t('c.month'))}:</b> ${esc(b.Month)} · <b>No.</b> ${esc(b.BillingID)} · <b>${esc(t('c.paid'))}:</b> ${esc(b.PaidDate||todayStr())}</div>
      <table>${rows}<tr><td class="tot">${esc(t('c.total'))}</td><td class="tot" style="text-align:right">${baht(due)}</td></tr></table>
      <div class="paid">✅ ${esc(t('s.paid'))}${b.VerifiedStatus==='PREPAID'?' ('+esc(t('prepay.paidAhead'))+')':''}</div></body></html>`; }

  function buildSlipsHTML(rows,month){ const logo=window._LOGO||(location.origin+'/assets/logo.png'); const corner=window._LOGOCORNER||(location.origin+'/assets/logo-corner.jpg');
    const card=p=>`<div class="slip"><div class="hd"><img src="${logo}" style="height:34px"/><span class="conf">CONFIDENTIAL</span><span class="school">Atom Nursery</span><span>งวด ${esc(p.Month)}</span><img src="${corner}" style="height:34px;border-radius:6px"/></div>
      <div class="meta"><span>ชื่อ: <b>${esc(staffName(p.StaffID))}</b></span><span>รหัส: ${esc(p.StaffID)}</span><span>พิมพ์: ${todayStr()}</span></div>
      <table class="grid"><thead><tr><th colspan="2">รายได้</th><th colspan="2">รายการหัก</th><th>โอนเข้า ${esc(p.BankAccount)}</th></tr></thead><tbody>
      <tr><td>เงินเดือน</td><td class="n">${baht(p.BaseSalary)}</td><td>ประกันสังคม</td><td class="n">${baht(p.SocialSecurity)}</td><td rowspan="3" class="net">${baht(p.NetPay)}</td></tr>
      <tr><td>เบี้ยขยัน¹</td><td class="n">${baht(p.DiligenceTotal)}</td><td>เงินสมทบ</td><td class="n">${baht(p.Contribution)}</td></tr>
      <tr><td>อื่นๆ²</td><td class="n">${baht(p.OtherIncome)}</td><td>อื่นๆ</td><td class="n">${baht(p.OtherDeductions)}</td></tr>
      <tr><td>ค่าสวงเวลาตอนเย็น</td><td class="n">${baht(p.OTEvening)}</td><td class="lbl">รวมหัก</td><td class="n">${baht(p.TotalDeductions)}</td><td class="lbl">สุทธิ</td></tr>
      <tr><td>เงินพิเศษวันพักผ่อนปี 68</td><td class="n">${baht(p.HolidayBonus)}</td><td class="lbl">รวมรายได้</td><td class="n">${baht(p.GrossIncome)}</td><td></td></tr>
      </tbody></table><div class="fn">¹ มาครบ ไม่ลา ไม่สาย (500)+โพสต์ FB (500) &nbsp; ² เด็กคนที่ 31+ (300/คน)+ใบประกาศ (100/ใบ สูงสุด 2)</div></div>`;
    let pages=''; for(let i=0;i<rows.length;i+=3) pages+=`<div class="sheet">${rows.slice(i,i+3).map(card).join('<div class="cut"></div>')}</div>`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>Slips ${month}</title><link href="https://fonts.googleapis.com/css2?family=Sarabun&display=swap" rel="stylesheet"><style>
      @page{size:A4 landscape;margin:6mm}*{box-sizing:border-box}body{font-family:Sarabun,sans-serif;margin:0}.bar{padding:8px;text-align:center;background:#eee}
      .sheet{width:285mm;height:198mm;display:flex;flex-direction:column;justify-content:space-between;page-break-after:always;padding:2mm}.slip{border:1px solid #1565C0;border-radius:4px;padding:4mm;height:62mm}.cut{border-top:1px dashed #999;margin:1mm 0}
      .hd{display:flex;justify-content:space-between;align-items:center;gap:6px;border-bottom:1px solid #1565C0;padding-bottom:2px}.conf{color:#c00;border:1px solid #c00;padding:0 4px;font-size:11px;font-weight:bold}.school{font-weight:bold;font-size:16px;flex:1}
      .meta{display:flex;justify-content:space-between;font-size:12px;margin:3px 0}.grid{width:100%;border-collapse:collapse;font-size:12px}.grid th,.grid td{border:1px solid #bbb;padding:2px 5px}.grid th{background:#1565C0;color:#fff}
      .grid td.n{text-align:right}.grid td.lbl{text-align:right;font-weight:bold;background:#f3f6fb}.grid td.net{text-align:center;font-size:18px;font-weight:bold;color:#1565C0}.fn{font-size:10px;color:#555;margin-top:3px}@media print{.bar{display:none}}</style></head>
      <body><div class="bar"><button onclick="window.print()">🖨️ พิมพ์ (3 สลิป/แผ่น A4 แนวนอน)</button></div>${pages}</body></html>`; }

  // preload logos as dataURLs so printed/downloaded slips & receipts always show them
  (async function preloadLogos(){ const map={_LOGO:'assets/logo.png',_LOGOCORNER:'assets/logo-corner.jpg'};
    for(const k in map){ try{ const r=await fetch(map[k]); const b=await r.blob(); window[k]=await new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.readAsDataURL(b);}); }catch(e){} } })();
  boot();
})();
