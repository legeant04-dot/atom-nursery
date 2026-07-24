/* app.js — UI shell + 3 portals on the mock API (revamped). */
(function () {
  const $ = s => document.querySelector(s);
  // Deferred writes (after an await) must tolerate the user having navigated away — the target node
  // is gone and `el.innerHTML=` would throw "Cannot set properties of null" and clobber the new screen.
  const setHTML = (sel, html) => { const el = $(sel); if (el) el.innerHTML = html; };
  const app = $('#app'), nav = $('#bottomnav');
  const baht = n => (Number(n)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  // ---- global "processing" overlay + double-submit guard ----------------------------------------
  // Any MUTATING api() call covers the screen with "ระบบกำลังดำเนินการ" (pointer-events blocked) so the
  // user can't double-tap a button or resubmit while the request is in flight. Reads are never covered
  // (they paint from cache instantly). Wraps window.api once, after api.js has defined it.
  const _mutRe = /^(submit|save|add|remove|delete|set|register|pay|upload|confirm|reject|issue|generate|move|export|import|compute|cancel|prepay|link|notify|request|mark|approve|edit|rename|update|change|seed|dedup|reindex)/i;
  const _isMut = a => _mutRe.test(a) || /check(in|out)|absence|payOT$|^orgMove|^unlink/i.test(a);
  const _EN = () => (typeof EN==='function' && EN());
  const _busyTxt = () => _EN() ? 'Processing…' : 'ระบบกำลังดำเนินการ…';
  let _busyN = 0, _busyEl = null, _busyFail = false, _busyOkT = null;
  function _busyEnsure(){ if(!_busyEl){ _busyEl=document.createElement('div'); _busyEl.id='busyOverlay';
      _busyEl.innerHTML='<div class="busy-box"><div class="busy-spin"></div><div class="busy-check">✓</div><div class="busy-txt"></div></div>';
      document.body.appendChild(_busyEl); } return _busyEl; }
  function _busyShow(){ if(++_busyN!==1) return; clearTimeout(_busyOkT); const el=_busyEnsure();
    el.classList.remove('ok'); el.querySelector('.busy-txt').textContent=_busyTxt(); el.classList.add('on'); }
  // On the LAST in-flight mutation finishing: flash a green ✓ "สำเร็จ" for feedback (unless something failed),
  // then hide. Any role, any add/edit/delete → the user always sees "processing" then "done".
  function _busyDone(ok){ if(!ok) _busyFail=true; if(_busyN>0)_busyN--; if(_busyN!==0||!_busyEl) return;
    if(_busyFail){ _busyFail=false; _busyEl.classList.remove('on','ok'); return; }
    _busyFail=false; _busyEl.classList.add('ok'); _busyEl.querySelector('.busy-txt').textContent=_EN()?'Done':'สำเร็จ';
    clearTimeout(_busyOkT); _busyOkT=setTimeout(()=>{ if(_busyN===0&&_busyEl){ _busyEl.classList.remove('on','ok'); _busyEl.querySelector('.busy-txt').textContent=_busyTxt(); } }, 750); }
  if(window.api && !window.__apiBusyWrapped){ window.__apiBusyWrapped=true; const _rawApi=window.api;
    window.api=function(action,payload,opts){ if(!_isMut(action)) return _rawApi(action,payload,opts);
      _busyShow(); let pr; try{ pr=_rawApi(action,payload,opts); }catch(e){ _busyDone(false); throw e; }
      return Promise.resolve(pr).then(v=>{ _busyDone(true); return v; }, e=>{ _busyDone(false); throw e; }); }; }
  const APP_VERSION = 'Version 1.105'; // bump each webapp change; shown only at the bottom of the Chat screen
  const verTag = () => `<div style="text-align:center;color:#c3c9d4;font-size:10px;margin-top:24px">${APP_VERSION}</div>`;
  // phones are stored as numbers in Sheets so the leading 0 is lost — re-add it for Thai mobiles + make it a tap-to-call link
  const phoneFmt = p => { let d=String(p==null?'':p).replace(/\D/g,''); if(d.length===9) d='0'+d; return d; };
  const phoneLink = p => { const d=phoneFmt(p); return d?`<a href="tel:${d}" onclick="event.stopPropagation()" style="color:inherit;text-decoration:underline dotted">${esc(d)}</a>`:'-'; };
  const esc = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  // password input with a 👁️ show/hide toggle
  const pwField = (id,label,ph)=>`<label class="field"><span>${esc(label)}</span><div class="row" style="gap:6px"><input type="password" id="${id}" placeholder="${esc(ph||'')}" style="flex:1"/><button type="button" class="btn sm outline" onclick="PW_toggle('${id}',this)" title="show/hide">👁️</button></div></label>`;
  window.PW_toggle=(id,btn)=>{ const e=document.getElementById(id); if(!e)return; const show=e.type==='password'; e.type=show?'text':'password'; if(btn)btn.textContent=show?'🙈':'👁️'; };
  const p2 = n => String(n).padStart(2,'0');
  const todayStr = () => { const d=new Date(); return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate()); };
  const monthStr = () => todayStr().slice(0,7);
  const ymd = v => String(v==null?'':v).slice(0,10);   // date part 'YYYY-MM-DD' (dates arrive as strings from the engine)
  const ym = v => String(v==null?'':v).slice(0,7);      // month part 'YYYY-MM'
  const nowTime = () => { const d=new Date(); return p2(d.getHours())+':'+p2(d.getMinutes()); };
  const initialEN = name => { let s=String(name||'?').replace(/^(Ms\.|Mr\.|Mrs\.|Miss|Master)\s*/i,'').trim(); const m=s.match(/[A-Za-z]/); return (m?m[0]:s[0]||'?').toUpperCase(); };
  const nm = o => o ? (LANG()==='en' ? (o.NameEN||o.NameTH||'') : (o.NameTH||o.NameEN||'')) : '';
  // language-aware nickname (EN nickname shown in English mode, Thai otherwise)
  const nick = o => o ? (LANG()==='en' ? (o.NicknameEN||o.Nickname||'') : (o.Nickname||o.NicknameEN||'')) : '';
  // full name + nickname, for plain-text spots (<option>, chips, headings) where a pill can't be used
  const nmn = o => { const n=nm(o), k=nick(o); return k ? `${n} (${k})` : n; };
  // the same as an inline pill, for list rows
  const nickPill = o => nick(o) ? ` <span class="pill info">${esc(nick(o))}</span>` : '';
  const dn = o => o ? (LANG()==='en' ? (o.nameEN||o.name||'') : (o.name||o.nameEN||'')) : '';
  // nickname-first for lowercase DTOs (engine projections: name/nameEN/nick/nickEN)
  const dnick = o => o ? (LANG()==='en' ? (o.nickEN||o.nick||o.nameEN||o.name||'') : (o.nick||o.nickEN||o.name||o.nameEN||'')) : '';

  // ---- display names: nickname-first everywhere; formal name kept for payroll/records ----
  const REL_DAD = /บิดา|father|พ่อ|^นาย|mr/i, REL_MOM = /มารดา|mother|แม่|^นาง|ms|mrs|miss/i;
  // title (คำนำหน้า) prefixed to a formal name; defaults from relationship when unset
  const titleOf = p => p ? (p.Title || (REL_DAD.test(p.Relationship||'')?'นาย':(REL_MOM.test(p.Relationship||'')?'นางสาว':''))) : '';
  const titledName = p => { const ti=EN()?'':titleOf(p); const n=nm(p); return ti?`${ti} ${n}`:n; };
  // student / staff: nickname first, else full name
  const dispNick = o => nick(o) || nm(o);
  // a staff's department(s) for display — '*' = all, comma-list joined with ·
  const deptLabel = s => { const d=String((s&&s.Department)||''); if(d==='*')return EN()?'All depts':'ทุกแผนก'; return d.split(',').map(x=>x.trim()).filter(Boolean).join(' · ')||'-'; };
  // look up a student we already fetched (admin caches; parent scope has kids on the page)
  const findKid = id => (window.A_CACHE&&(A_CACHE.students||[]).find(s=>s.StudentID===id)) || (window._KIDS&&_KIDS.find(s=>s.StudentID===id)) || null;
  // parent display: nickname → "คุณพ่อ/แม่ น้อง<child>" (by relationship) → title + full name
  function parentDisp(p, kid){
    if(!p) return '';
    const k=nick(p); if(k) return k;
    const dad=REL_DAD.test(p.Relationship||'')||REL_DAD.test(p.Title||''), mom=REL_MOM.test(p.Relationship||'')||REL_MOM.test(p.Title||'');
    const child = kid || findKid(p.StudentID);
    const kn = child ? dispNick(child) : '';
    if(kn && (dad||mom)) return EN() ? `${kn}'s ${dad?'dad':'mom'}` : `${dad?'คุณพ่อน้อง':'คุณแม่น้อง'}${kn}`;
    return titledName(p);
  }
  const EN = () => LANG()==='en';
  // OT duration as "X ชม. Y นาที" / "Xh Ym" (e.g. 0.77 hr → "46 นาที"); drops a zero part
  const hmMin = total => { total=Math.max(0,Math.round(Number(total)||0)); const h=Math.floor(total/60), m=total%60;
    const H=EN()?'h':'ชม.', M=EN()?'min':'นาที'; return (h&&m)?`${h} ${H} ${m} ${M}`:(h?`${h} ${H}`:`${m} ${M}`); };
  const hmHours = hours => hmMin((Number(hours)||0)*60);
  // round photo avatar — Photo as a circle, else initials. Tapping a photo zooms it (IMG_zoom).
  const studentAvatar = s => s&&s.Photo ? `<span class="avatar-sm photo" style="background-image:url('${esc(s.Photo)}')" onclick="IMG_zoom('${esc(s.Photo)}')"></span>` : `<span class="avatar-sm">${esc(initialEN(s?s.NameEN:'?'))}</span>`;
  // A parent's picture: an uploaded Photo always wins; otherwise fall back to their current LINE
  // profile picture (PARENTS.LinePictureUrl, refreshed on every login by handleAuth).
  const photoOf = o => (o && (o.Photo || o.LinePictureUrl)) || '';
  const personAvatar = o => photoOf(o) ? `<span class="avatar-sm photo" style="background-image:url('${esc(photoOf(o))}')" onclick="IMG_zoom('${esc(photoOf(o))}')"></span>` : `<span class="avatar-sm">${esc(initialEN(o?o.NameEN:'?'))}</span>`;
  // full-screen image lightbox (reuses the .modal.imgzoom styling; tap to close)
  window.IMG_zoom = (url)=>{ if(!url)return; const d=document.createElement('div'); d.className='modal imgzoom';
    d.onclick=()=>d.remove(); d.innerHTML=`<img src="${esc(url)}" alt=""/>`; document.body.appendChild(d); };

  // ---- photo picker: downscale + JPEG-compress so a photo fits a sheet cell and posts fast ----
  // The old forms sent a raw multi-MB base64 → the sheet cell overflowed / the GAS POST hung ("freeze").
  function compressImage(file, maxDim, quality){ maxDim=maxDim||640; quality=quality||0.82;
    return new Promise((resolve)=>{ if(!file||!/^image\//.test(file.type)){ resolve(''); return; }
      const fr=new FileReader(); fr.onerror=()=>resolve('');
      fr.onload=()=>{ const img=new Image(); img.onerror=()=>resolve('');
        img.onload=()=>{ let w=img.width,h=img.height; const sc=Math.min(1,maxDim/Math.max(w,h));
          w=Math.max(1,Math.round(w*sc)); h=Math.max(1,Math.round(h*sc));
          const c=document.createElement('canvas'); c.width=w; c.height=h;
          c.getContext('2d').drawImage(img,0,0,w,h);
          try{ resolve(c.toDataURL('image/jpeg',quality)); }catch(e){ resolve(String(fr.result||'')); } };
        img.src=String(fr.result||''); };
      fr.readAsDataURL(file); }); }
  // HTML for a photo field: file input + status line + preview thumb. The compressed dataURL is stashed
  // on the input's dataset by PHOTO_pick, so save handlers read photoVal() (no second, uncompressed read).
  const photoField = (id,label,cur,round)=>`<label class="field"><span>${esc(label)}</span>
    <input id="${id}" type="file" accept="image/*" onchange="PHOTO_pick(this)"/>
    <span id="${id}_st" class="muted" style="font-size:12px"></span>
    <div id="${id}_pv" style="margin-top:6px">${cur?`<img src="${esc(cur)}" onclick="IMG_zoom('${esc(cur)}')" style="width:${round?'56px':'120px'};height:${round?'56px':'auto'};border-radius:${round?'50%':'8px'};object-fit:cover;cursor:zoom-in"/>`:''}</div></label>`;
  window.PHOTO_pick = async (inp)=>{ const f=inp.files&&inp.files[0]; const st=document.getElementById(inp.id+'_st'), pv=document.getElementById(inp.id+'_pv');
    if(!f){ return; } if(st){ st.textContent='⏳ '+(EN()?'Processing image…':'กำลังประมวลผลรูป…'); st.style.color='#e65100'; }
    const url=await compressImage(f); inp.dataset.url=url||'';
    if(st){ st.textContent = url?('✅ '+(EN()?'Ready':'พร้อมแล้ว')):('⚠️ '+(EN()?'Not an image':'ไม่ใช่ไฟล์รูป')); st.style.color=url?'#2e7d32':'#c62828'; }
    if(pv&&url) pv.innerHTML=`<img src="${url}" onclick="IMG_zoom('${url}')" style="width:120px;border-radius:8px;object-fit:cover;cursor:zoom-in"/>`; };
  // read a picked+compressed photo from a form; returns '' if none picked (caller keeps the old value)
  const photoVal = (scope,id)=>{ const el=(scope||document).querySelector('#'+id); return el&&el.dataset&&el.dataset.url?el.dataset.url:''; };
  // age as "X ปี Y เดือน" / "X y Y m" from a DOB
  function ageYM(dob){ const m=window.AGEMONTHS?AGEMONTHS(dob):0; return ageYMfromMonths(m); }
  function ageYMfromMonths(m){ m=Math.max(0,Math.round(m)); const y=Math.floor(m/12), mo=m%12;
    return EN()? `${y}y ${mo}m` : `${y} ปี ${mo} เดือน`; }
  window.GROWTH_PT = lbl => toast(lbl);
  // staff tenure (years/months since StartDate)
  function tenure(startDate){ if(!startDate) return '-'; const d=new Date(startDate),n=new Date();
    let m=(n.getFullYear()-d.getFullYear())*12+(n.getMonth()-d.getMonth()); if(n.getDate()<d.getDate())m--; m=Math.max(0,m);
    return ageYMfromMonths(m); }
  // MOCK.config.Plans holds only SEED plans in gas mode, so a live id like "p_6900" isn't found →
  // format it as "Plan 6900" instead of showing the raw id.
  const planLabel = id => { const p=(MOCK.config.Plans||[]).find(x=>x.id===id); if(p) return EN()?p.labelEN:p.labelTH;
    const m=String(id||'').match(/(\d{3,})/); return m?('Plan '+m[1]):(id||'-'); };
  const groupsSrc = () => (window.A_CACHE&&A_CACHE.groups&&A_CACHE.groups.length?A_CACHE.groups:MOCK.staffGroups)||[];
  const groupLabel = name => { const g=groupsSrc().find(x=>x.GroupName===name); return g?(EN()?g.GroupNameEN:g.GroupName):(name||''); };
  const groupHours = name => { const g=groupsSrc().find(x=>x.GroupName===name); return g&&(g.CheckInTime||g.CheckOutTime)?`${g.CheckInTime||'--'}–${g.CheckOutTime||'--'}`:''; };
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
    // version is shown only at the bottom of the Chat screen now (see verTag / APP_VERSION)
    $('#langBtn').textContent = LANG()==='en' ? 'EN' : 'TH';
    $('#userName').textContent = USER ? USER.nameEN : '–';
    $('#userRole').textContent = USER ? t(ROLE_KEY(USER.role)) : '';
    // show the signed-in user's LINE profile picture in the header; fall back to their initial
    const av=$('#avatar'), pic=USER&&USER.pictureUrl;
    av.textContent = pic ? '' : (USER ? initialEN(USER.nameEN) : '–');
    av.style.backgroundImage = pic ? `url('${pic}')` : '';
    av.classList.toggle('photo', !!pic);
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
  // tapping the left logo goes Home; tapping the right name/avatar → parent profile (else Home)
  window.HOME_TAP = () => { if(USER) GO('home'); };
  // tapping the name/avatar opens THIS account's own profile (parent or staff/admin)
  window.NAME_TAP = () => { if(!USER) return;
    if(USER.role==='Parent'){ if(typeof P_profile==='function') P_profile(); return; }
    if(USER.staffId && typeof T_profile==='function'){ T_profile(); return; }
    GO('home'); };

  const NAVS = {
    Parent:[['home','🏠','nav.home'],['checkin','📍','nav.checkin'],['payment','💳','nav.payment'],['journal','📒','nav.journal'],['dspm','📈','nav.dspm'],['chat','💬','nav.chat']],
    Teacher:[['home','🏠','nav.home'],['class','👶','nav.class'],['injury','🚑','inj.nav'],['leave','📩','nav.leave'],['schedule','📅','nav.schedule'],['slip','💵','nav.slip']],
    Admin:[['home','📊','nav.home'],['leaves','✅','nav.leaves'],['payroll','💵','nav.payroll'],['dspm','📈','nav.analytics'],['manage','🗂️','nav.manage'],['chat','💬','nav.chat']],
  };
  function setNav(active){ if(!USER){nav.hidden=true;return;} nav.hidden=false;
    nav.innerHTML = NAVS[USER.role].map(([k,ic,l])=>`<button class="${k===active?'active':''}" onclick="GO('${k}')"><span class="ic">${ic}</span>${esc(t(l))}</button>`).join(''); }

  // header quick-actions slot (before the language toggle); each screen fills it or it clears on nav
  window.setTopActions = html => { const el=document.getElementById('topActions'); if(el) el.innerHTML=html||''; };
  window.GO = function(screen, opts){ CURRENT=screen; setNav(screen); if(!(opts&&opts.silent)){ setTopActions(''); CAL_OFF=0; window._CALRENDER=null; } const fn=(SCREENS[USER.role]||{})[screen];
    // paint an instant placeholder so a tap feels responsive instead of "stuck" on the old screen
    // while the first (uncached) fetch runs; skip on silent background re-renders to avoid flicker.
    if(fn && !(opts&&opts.silent)) app.innerHTML=`<div class="card" style="text-align:center;color:#94a3b8;padding:28px">⏳ ${EN()?'Loading…':'กำลังโหลด…'}</div>`;
    if(fn){ const r=fn(); // a screen that throws must not leave the loading skeleton stuck forever
      // only show the error if STILL on this screen — a slow screen the user already left must not
      // clobber the new one (e.g. home's deferred #anns write firing after navigating to leaves).
      if(r&&r.catch) r.catch(e=>{ if(CURRENT!==screen)return; app.innerHTML=`<div class="card"><b>⚠️ ${EN()?'Could not load':'โหลดไม่สำเร็จ'}</b><br><small class="muted">${esc((e&&e.message)||e)}</small></div><button class="btn outline block" style="margin-top:10px" onclick="GO('${screen}')">🔄 ${EN()?'Retry':'ลองใหม่'}</button>`; });
    } else app.innerHTML=`<div class="card">หน้านี้กำลังพัฒนา</div>`; window.scrollTo(0,0); };
  // SWR hook: api.js calls this when a background refresh found newer data than what's shown.
  // Re-render the current screen (silently, no skeleton), but never interrupt an open modal or active typing.
  window.__atomRevalidate = () => { if(!USER||!CURRENT) return; if(document.querySelector('.modal')) return;
    const ae=document.activeElement; if(ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return; GO(CURRENT,{silent:true}); };
  // Warm the SWR cache for the other tabs right after login so navigating to them is instant
  // (the home screen loads first; these fire ~0.5s later and micro-batch into one request).
  window.PREFETCH = () => {
    if (CONFIG.MODE!=='gas' || !USER) return;
    const jobs = USER.role==='Parent'
        ? [['parentChildren',parentScope()],['announcements'],['calendar'],['notifications',notifParams()]]
      : USER.role==='Admin'
        ? [['dashboard'],['pendingLeaves',{staffId:USER.staffId}],['pendingPayments'],['listStudents'],['listStaff'],['listParents']]
        : [['classList',{staffId:USER.staffId}],['schedule'],['myLeaves',{staffId:USER.staffId}]];
    setTimeout(()=>{ jobs.forEach(j=>{ try{ api(j[0], j[1]||{}); }catch(e){} }); }, 500);
  };
  function confirmSaved(msg){ msg=msg||t('c.saved'); if(window.trPhrase)msg=trPhrase(msg); const b=document.createElement('div'); b.className='savebar'; b.innerHTML=`✅ ${esc(msg)}`; document.body.appendChild(b); requestAnimationFrame(()=>b.classList.add('show')); setTimeout(()=>{b.classList.remove('show');setTimeout(()=>b.remove(),300);},1800); }

  function chooser(){ USER=null; AUTH_RENDER=chooser; setHeader(); nav.hidden=true;
    if(!CONFIG.DEMO_MODE){ app.innerHTML=`<div class="rolewrap"><img src="assets/logo.png" class="logo-lg" alt="logo"/>
      <h2 class="page" style="text-align:center">${esc(t('login.title'))}</h2>
      <p class="muted">${EN()?'Please sign in with your LINE account.':'กรุณาเข้าสู่ระบบด้วยบัญชี LINE ของท่าน'}</p>
      <button class="btn block" onclick="loginScreen()">${esc(t('c.back'))}</button></div>`; return; }
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
  window.LOGIN = function(roleKey){ if(!CONFIG.DEMO_MODE){ toast(EN()?'Demo login is disabled':'ปิดการเข้าสู่ระบบทดลองแล้ว'); return; } USER=Object.assign({},DEMO_USERS[roleKey]); USER._roleKey=roleKey;
    try{ localStorage.setItem('atom_session', JSON.stringify({roleKey, provider:PENDING_PROVIDER||'demo'})); }catch(e){}
    setHeader(); GO('home'); PREFETCH();
  };
  // log in as a freshly registered/linked parent (carries its own uid for data isolation)
  window.LOGIN_PARENT = function(u){ USER=Object.assign({role:'Parent',_roleKey:'Parent'},u);
    try{ localStorage.setItem('atom_session', JSON.stringify({roleKey:'Parent', provider:PENDING_PROVIDER||'demo', parent:u})); }catch(e){}
    setHeader(); GO('home'); PREFETCH();
  };
  // log in with real GAS auth result (LIFF flow)
  window.LOGIN_REAL = function(role, linkedId, displayName, pictureUrl) {
    // different LINE account on this device → drop the previous user's cached data
    try{ const uid=PENDING_LINE_UID||linkedId; const last=localStorage.getItem('atom_last_uid');
      if(last && last!==uid && window.__atomCacheClear) window.__atomCacheClear(); localStorage.setItem('atom_last_uid', uid); }catch(e){}
    const roleKey = role === 'Admin' ? 'Admin' : role === 'Leader' ? 'Leader' : role === 'Teacher' ? 'Teacher' : 'Parent';
    USER = { role, _roleKey: roleKey, nameEN: displayName || roleKey, nameTH: displayName || roleKey };
    if (role === 'Parent') { USER.parentId = linkedId; USER.uid = PENDING_LINE_UID || linkedId; }
    else USER.staffId = linkedId;
    if (pictureUrl) USER.pictureUrl = pictureUrl;
    PENDING_LINE_UID = null;
    setHeader(); GO('home'); PREFETCH();
  };
  function logout(){
    try{ localStorage.removeItem('atom_session'); }catch(e){}
    USER=null; PENDING_PROVIDER=null; PENDING_LINE_UID=null;
    if (window.__atomCacheClear) window.__atomCacheClear(); // don't leave one account's data for the next login
    if (window.__atomClearSession) window.__atomClearSession();
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
    if (!CONFIG.DEMO_MODE) { toast(EN()?'Please open via LINE to sign in':'กรุณาเปิดผ่าน LINE เพื่อเข้าสู่ระบบ'); return; }
    PROVIDER('LINE');
  };
  window.PROVIDER = (id) => { PENDING_PROVIDER = id; accountStage(); };
  // After a guest registers, re-auth to swap the limited guest token for a full Parent token
  // (so data screens work). No-op outside gas+LIFF.
  window.UPGRADE_SESSION = async () => {
    if (CONFIG.MODE === 'gas' && CONFIG.LIFF_ID && window.liff && liff.isLoggedIn()) {
      try { await api('auth', { accessToken: liff.getAccessToken() }); } catch (e) {}
    }
  };

  // ---- after provider: new vs existing user ----
  function accountStage(){ USER=null; AUTH_RENDER=accountStage; setHeader(); nav.hidden=true;
    app.innerHTML = `<div class="rolewrap"><img src="assets/logo.png" class="logo-lg" alt="logo"/>
      <h2 class="page" style="text-align:center">${esc(t('acct.title'))}</h2>
      <p class="muted">${esc(t('acct.sub'))}</p>
      <button class="role-card" onclick="REG_START()"><span class="ic">📝</span><span><b>${esc(t('acct.new'))}</b><br><small>${esc(t('acct.newSub'))}</small></span></button>
      <button class="role-card" onclick="chooserExisting()"><span class="ic">✅</span><span><b>${esc(t('acct.existing'))}</b><br><small>${esc(t('acct.existingSub'))}</small></span></button>
      ${PENDING_LINE_UID?`<div class="card" style="background:#f7f9fc;margin-top:10px"><small class="muted">${EN()?'Your LINE ID (give this to the admin to link your staff account):':'LINE ID ของคุณ (ส่งให้แอดมินเพื่อผูกบัญชีพนักงาน):'}</small><br><code style="font-size:12px;word-break:break-all" onclick="navigator.clipboard&&navigator.clipboard.writeText('${esc(PENDING_LINE_UID)}')">${esc(PENDING_LINE_UID)}</code></div>`:''}
      <button class="btn-ghost block" style="margin-top:8px" onclick="loginScreen()">${esc(t('c.back'))}</button></div>`;
  }
  window.chooserExisting = ()=> chooser();
  // expose auth screens so inline Back buttons (onclick="...") can reach them
  window.loginScreen = loginScreen; window.accountStage = accountStage; window.chooser = chooser;

  // restore a stored demo session (role chooser / registered parent) so a reload doesn't drop the
  // user back to the login screen. Returns true if a session was restored.
  function restoreDemoOrLogin(){
    if(!CONFIG.DEMO_MODE) return false; // production: no demo sessions, LINE login only
    try{ const s=JSON.parse(localStorage.getItem('atom_session')||'null');
      if(s&&s.parent){ PENDING_PROVIDER=s.provider; LOGIN_PARENT(s.parent); applyLangNow(); return true; }
      if(s&&DEMO_USERS[s.roleKey]){ PENDING_PROVIDER=s.provider; LOGIN(s.roleKey); applyLangNow(); return true; } }catch(e){}
    return false;
  }
  function boot(){ ensureTranslateObserver();
    // LIFF path: gas mode + LIFF_ID set + SDK loaded → real LINE auth
    if (CONFIG.MODE === 'gas' && CONFIG.LIFF_ID && window.liff) {
      // not logged in / init failed (e.g. opened outside LINE) → keep an existing demo session if any,
      // else show login. Stops a reload from wiping a testing session.
      const fallback = () => { if(!restoreDemoOrLogin()){ loginScreen(); applyLangNow(); } };
      liff.init({ liffId: CONFIG.LIFF_ID }).then(() => {
        if (liff.isLoggedIn()) {
          liff.getProfile().then(profile => {
            PENDING_LINE_UID = profile.userId;
            // send the verifiable access token (NOT the raw userId): GAS verifies it server-side
            // via LINE's profile endpoint and trusts the resulting userId — prevents UID spoofing.
            api('auth', { accessToken: liff.getAccessToken(), displayName: profile.displayName, pictureUrl: profile.pictureUrl }).then(u => {
              if (u.role === 'guest') { PENDING_PROVIDER = 'LINE'; accountStage(); applyLangNow(); return; } // unregistered → onboarding
              LOGIN_REAL(u.role, u.linkedId, u.displayName || profile.displayName, u.pictureUrl || profile.pictureUrl);
              applyLangNow();
            }).catch(e => { toast('⚠️ ' + (e.message || e)); fallback(); });
          }).catch(fallback);
        } else { fallback(); }
      }).catch(fallback);
      return;
    }
    // Demo/mock path
    if(!restoreDemoOrLogin()){ loginScreen(); applyLangNow(); } }

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
        <div class="grid2"><label class="field"><span>${esc(t('reg.title'))}</span><select id="rTitle">${['นาย','นาง','นางสาว'].map(x=>`<option>${x}</option>`).join('')}</select></label>${fld_('rPNameTH',t('reg.nameTH'))}</div>
        <div class="grid2">${fld_('rPNameEN',t('reg.nameEN'))}${fld_('rPNick',t('reg.nickname'))}</div>
        <div class="grid2">${fld_('rPNickEN',t('reg.nicknameEN'))}${fld_('rPNID',t('reg.nationalIdParent'))}</div>
        <div class="grid2"><label class="field"><span>${esc(t('reg.relationship'))}</span><select id="rRel" onchange="REG_titleFromRel()"><option>${esc(t('reg.father'))}</option><option>${esc(t('reg.mother'))}</option><option>${esc(t('reg.guardian'))}</option></select></label></div>
        <div class="grid2">${fld_('rPPhone',t('reg.mobile'))}${fld_('rPOffice',t('reg.officePhone'))}</div>
        <div class="grid2">${fld_('rPOcc',t('reg.occupation'))}${fld_('rPWork',t('reg.workplace'))}</div>
        ${fld_('rPAddr',t('reg.address'))}
        <label class="field"><span>📸 ${esc(t('reg.photoCapture'))}</span><input id="rPPhoto" type="file" accept="image/*" capture="user" onchange="REG_photoPrev(this)"/><span id="rPPhoto_st" class="muted" style="font-size:12px"></span></label>
        <div style="text-align:center"><img id="rPPhotoPrev" alt="" style="max-height:160px;border-radius:10px;border:1px solid #eee;margin:4px 0;cursor:zoom-in" hidden onclick="IMG_zoom(this.src)"/></div>
        <small class="muted" style="font-size:12px">🔒 ${esc(t('reg.photoCaptureNote'))}</small></div>
      <div class="card"><label style="display:flex;gap:8px;align-items:flex-start;font-size:13px"><input type="checkbox" id="rPDPA" style="width:auto;margin-top:3px"/><span>${esc(t('reg.pdpa'))}</span></label></div>
      <button class="btn block" onclick="REG_submit()">${esc(t('reg.submit'))}</button>
      <button class="btn-ghost block" style="margin-top:8px" onclick="REG_BACK()">${esc(t('c.back'))}</button>`;
  };
  // relationship sets a sensible default title (father→นาย, mother→นางสาว); guardian leaves it alone
  window.REG_titleFromRel = ()=>{ const rel=$('#rRel').value, ti=$('#rTitle'); if(!ti)return;
    if(/บิดา|father/i.test(rel)) ti.value='นาย'; else if(/มารดา|mother/i.test(rel)) ti.value='นางสาว'; };
  window.REG_BACK = ()=>{ if(USER) GO('home'); else accountStage(); };
  window.REG_photoPrev=async(inp)=>{ const f=inp.files[0]; const img=$('#rPPhotoPrev'), st=$('#rPPhoto_st'); if(!f)return;
    if(st){ st.textContent='⏳ '+(EN()?'Processing…':'กำลังประมวลผล…'); st.style.color='#e65100'; }
    const url=await compressImage(f); inp.dataset.url=url||'';
    if(st){ st.textContent = url?('✅ '+(EN()?'Ready':'พร้อมแล้ว')):('⚠️ '+(EN()?'Not an image':'ไม่ใช่ไฟล์รูป')); st.style.color=url?'#2e7d32':'#c62828'; }
    if(img&&url){ img.src=url; img.hidden=false; } };
  window.REG_submit = async ()=>{ const v=id=>{ const e=$(id); return e?e.value.trim():''; };
    if(!v('#rPNameTH')&&!v('#rPNameEN')){toast(EN()?'Enter your name':'กรอกชื่อผู้ปกครอง');return;}
    if(!$('#rPDPA').checked){toast(EN()?'Please accept PDPA consent':'กรุณายอมรับ PDPA');return;}
    const inp=$('#rPPhoto');
    if(!inp||!inp.files[0]){ toast(t('reg.photoRequired')); return; } // photo is mandatory (login security)
    const parentPhoto=inp.dataset.url||await compressImage(inp.files[0]); // compressed on pick; fall back if not
    const uid=PENDING_LINE_UID||(PENDING_PROVIDER||'LINE')+'_'+Date.now();
    const parent={Title:$('#rTitle').value,NameTH:v('#rPNameTH'),NameEN:v('#rPNameEN'),Nickname:v('#rPNick'),NicknameEN:v('#rPNickEN'),Relationship:$('#rRel').value,NationalID:v('#rPNID'),Phone:v('#rPPhone'),OfficePhone:v('#rPOffice'),Occupation:v('#rPOcc'),Workplace:v('#rPWork'),Address:v('#rPAddr'),Photo:parentPhoto,LineUID:uid};
    try{ const r=await api('registerParent',{uid,parent});
      await UPGRADE_SESSION(); // guest token → Parent token now that a PARENTS row exists
      confirmSaved(EN()?'Registered — now add your child':'ลงทะเบียนแล้ว — เพิ่มข้อมูลบุตรหลานต่อ');
      LOGIN_PARENT({nameTH:parent.NameTH,nameEN:parent.NameEN||parent.NameTH,parentId:r.parentId,uid});
      setTimeout(()=>P_addChild(),300); // prompt to add/link a child right after
    }catch(e){err(e);} };

  // ----- add a NEW child (student-only form) — used from P_addChild -----
  window.REG_CHILD_FORM = ()=>{ REG_PICKUPS=1;
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('home')">${t('c.back')}</button><h2 class="page">👶 ${esc(t('reg.childTitle'))}</h2>
      <div class="card" style="background:#f7f9fc"><small class="muted">${esc(t('reg.planByAdmin'))}</small></div>
      <div class="card"><h3>👶 ${esc(t('reg.student'))}</h3>
        <p class="muted" style="font-size:11.5px">${EN()?'Fields marked * are required (incl. English name & nickname).':'ช่องที่มี * จำเป็นต้องกรอก (รวมชื่อจริงและชื่อเล่นภาษาอังกฤษ)'}</p>
        <div class="grid2">${fld_('rNameTH',t('reg.nameTH')+' *')}${fld_('rNameEN',t('reg.nameEN')+' *')}</div>
        <div class="grid2">${fld_('rNick',t('reg.nickname'))}${fld_('rNickEN',t('reg.nicknameEN')+' *')}</div>
        <label class="field"><span>${esc(t('reg.gender'))}</span><select id="rGender"><option value="M">${esc(t('reg.male'))}</option><option value="F">${esc(t('reg.female'))}</option></select></label>
        <div class="grid2"><label class="field"><span>${esc(t('reg.dob'))}</span><input id="rDOB" type="date" onchange="REG_age()"/></label><label class="field"><span>${esc(t('reg.age'))}</span><input id="rAge" disabled placeholder="–"/></label></div>
        <label class="field"><span>${esc(t('reg.nationalIdStudent'))}</span><input id="rSNID" inputmode="numeric" placeholder="x-xxxx-xxxxx-xx-x"/></label>
        <div class="grid2">${fld_('rW',t('reg.weight'),'number')}${fld_('rH',t('reg.height'),'number')}</div>
        <div class="grid2">${fld_('rBlood',t('reg.bloodType'))}${fld_('rRH','RH')}</div>
        ${photoField('rPhoto',t('reg.photo'),'',true)}
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
  // red inline overlay for incomplete registration + highlight the empty required fields
  function REG_flashError(msg){ let el=document.getElementById('regErr'); if(!el){ el=document.createElement('div'); el.id='regErr';
      el.style.cssText='position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:100000;background:#c62828;color:#fff;padding:12px 18px;border-radius:10px;box-shadow:0 6px 22px rgba(0,0,0,.28);font-weight:600;max-width:92%;text-align:center;font-size:14px'; document.body.appendChild(el); }
    el.textContent='⚠️ '+msg; el.style.display='block'; clearTimeout(el._t); el._t=setTimeout(()=>{ el.style.display='none'; },3800); }
  function REG_require(reqs){ let missing=[]; let first=null;
    reqs.forEach(([id,label])=>{ const el=$('#'+id); if(!el)return; const empty=!el.value.trim();
      el.style.borderColor=empty?'#c62828':''; el.style.background=empty?'#fdecec':'';
      if(empty){ missing.push(label); if(!first)first=el; } });
    if(first){ try{ first.scrollIntoView({behavior:'smooth',block:'center'}); first.focus(); }catch(e){} }
    return missing; }
  window.REG_childSubmit = async ()=>{ const v=id=>{ const e=$(id); return e?e.value.trim():''; };
    const missing=REG_require([['rNameTH',t('reg.nameTH')],['rNameEN',t('reg.nameEN')],['rNickEN',t('reg.nicknameEN')]]);
    if(missing.length){ REG_flashError((EN()?'Incomplete — please fill: ':'ใส่ข้อมูลไม่ครบ — กรุณากรอก: ')+missing.join(', ')); return; }
    const photo=photoVal(document,'rPhoto');
    const pickups=[]; for(let i=0;i<REG_PICKUPS;i++){ const n=v('#pkN'+i); if(n) pickups.push({Name:n,Phone:v('#pkP'+i),Relation:v('#pkR'+i)}); }
    const student={NationalID:v('#rSNID'),NameTH:v('#rNameTH'),NameEN:v('#rNameEN'),Nickname:v('#rNick'),NicknameEN:v('#rNickEN'),Gender:$('#rGender').value,DOB:v('#rDOB'),Plan:'',Weight:+v('#rW')||'',Height:+v('#rH')||'',Photo:photo,BloodType:v('#rBlood'),RH:v('#rRH'),Allergy:v('#rAllergy')||'-',MedicalHistory:v('#rChronic')||'-',Class:''};
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
  // Daily report — a clean SUMMARY that shows ONLY what the teacher actually filled in (empty
  // sections are hidden, not shown as rows of unchecked boxes). opts.student frames the child's info.
  function journalChecklist(j,opts){ j=j||{}; opts=opts||{};
    const meals=j.Meals||{};
    const milkQty=Array.isArray(j.Milk)?j.Milk.reduce((a,b)=>a+(+b||0),0):(j.Milk!=null&&j.Milk!==''?Number(j.Milk):(j.MilkTotal!=null?Number(j.MilkTotal):''));
    const milkUnitL=(j.MilkUnit==='box')?(EN()?'boxes':'กล่อง'):'oz';
    const tl=j.Toilet||{}; const acts=j.Activity||[], sk=j.Skills||[];
    const sleep=(Array.isArray(j.Sleep)?j.Sleep:[]).filter(x=>x&&(x.from||x.to));
    // one row per section, rendered ONLY when it has a value
    const rows=[];
    const row=(ic,label,val)=>{ if(val==null||val==='')return; rows.push(`<div class="jr-row"><span class="jr-ic">${ic}</span><span class="jr-lbl">${esc(label)}</span><span class="jr-val">${val}</span></div>`); };
    const pill=x=>`<span class="jr-pill">${esc(x)}</span>`;
    row('😊', jt("Today's Mood"), j.Mood?`${MOODS[j.Mood]||''} ${esc(jt(j.Mood))}`:'');
    row('❤️', jt('Health Update'), j.Health?(esc(jt(j.Health))+(j.HealthDetail?` <span class="muted">· ${esc(j.HealthDetail)}</span>`:'')):'');
    row('🍼', jt('Milk & Water'), (milkQty&&milkQty!==0?`<b>${esc(milkQty)} ${esc(milkUnitL)}</b>`:'')+(j.Water?(milkQty?' · ':'')+esc(jt(j.Water)):''));
    { const ms=['Breakfast','Lunch','Dinner'].filter(m=>meals[m]).map(m=>`${esc(jt(m))}: ${pill(jt(meals[m]))}`);
      row('🍽', jt('Meals & Snacks'), ms.length?ms.join(' '):''); }
    { const parts=sleep.map(x=>x.from+'–'+x.to); row('😴', jt('Sleep Record'), parts.length?parts.join(', ')+(j.SleepTotal?` <span class="muted">(${EN()?'total':'รวม'} ${esc(j.SleepTotal)})</span>`:''):''); }
    { const tp=[]; if(tl.Urination)tp.push(`${esc(jt('Urination'))}: ${pill(jt(tl.Urination))}`);
      if(tl.Bowel)tp.push(`${esc(jt('Bowel'))}: ${pill(jt(tl.Bowel))}`);
      if(tl.Stool)tp.push(`${esc(jt('Stool'))}: ${pill(jt(tl.Stool))}`);
      if(tl.Training)tp.push(`${esc(jt('Toilet Training'))}: ${pill(jt(tl.Training))}`);
      row('🚽', jt('Toileting'), tp.length?tp.join(' '):''); }
    row('🎨', jt('Learning Journey'), acts.length?acts.map(a=>pill(jt(a))).join('')+(j.Theme?` <span class="muted">· ${esc(jt('Theme'))}: ${esc(j.Theme)}</span>`:''):'');
    row('🌟', jt('Skills Practiced'), sk.length?sk.map(x=>pill(jt(x))).join(''):'');
    // framed student header (nickname-first) when the caller passes the child
    const st=opts.student; const head=st?`<div class="jr-head"><div><b>👶 ${esc(dispNick(st))}</b>${st.Class?` <span class="muted">· ${esc(st.Class)}</span>`:''}</div><span class="muted">${esc(j.Date||opts.date||todayStr())}</span></div>`
      : `<div class="jr-head"><b>🌈 ${esc(jt('MY DAY AT ATOM'))}</b><span class="muted">${esc(j.Date||opts.date||todayStr())}</span></div>`;
    return `<div class="card jrpt">${head}
      ${rows.length?`<div class="jr-rows">${rows.join('')}</div>`:`<div class="muted" style="text-align:center;padding:10px">${EN()?'The teacher has not filled in details yet.':'คุณครูยังไม่ได้กรอกรายละเอียด'}</div>`}
      ${j.Highlight?`<div class="jr-hl"><span>⭐ ${esc(jt("Today's Highlight"))}</span><div>${esc(j.Highlight)}</div></div>`:''}
      <div class="jr-cmt"><h4>💬 ${EN()?"Parent's comment":'ความคิดเห็นผู้ปกครอง'}</h4>${opts.parentEditable
        ? `<div class="row"><textarea id="jPC" placeholder="${EN()?'Write a comment… (tap mic to speak)':'พิมพ์ความคิดเห็น... (กดไมค์เพื่อพูด)'}" style="flex:1">${esc(j.ParentComment||'')}</textarea><button class="micbtn" onclick="J_mic('jPC',this)">🎤</button></div>
           <button class="btn sm block" style="margin-top:6px" onclick="P_saveComment('${esc(j.StudentID||opts.studentId||'')}','${esc(j.Date||opts.date||'')}',this)">💾 ${EN()?'Save comment':'บันทึกความคิดเห็น'}</button>`
        : `<div class="jr-cmt-box">${esc(j.ParentComment||(EN()?'— no comment —':'— ยังไม่มีความคิดเห็น —'))}</div>`}</div>
      ${(!opts.parentEditable && typeof USER!=='undefined' && USER && USER.role!=='Parent')
        ? `<div class="jr-cmt"><h4>↩️ ${EN()?'Reply to parent':'ตอบกลับผู้ปกครอง'}</h4><textarea id="jTR" style="width:100%" placeholder="${EN()?'Reply to the parent…':'พิมพ์คำตอบถึงผู้ปกครอง...'}">${esc(j.TeacherReply||'')}</textarea><button class="btn sm block" style="margin-top:6px" onclick="T_saveReply('${esc(j.StudentID||opts.studentId||'')}','${esc(j.Date||opts.date||'')}',this)">💾 ${EN()?'Send reply':'ส่งคำตอบ'}</button></div>`
        : (j.TeacherReply?`<div class="jr-cmt"><h4>↩️ ${EN()?'Teacher’s reply':'ครูตอบกลับ'}</h4><div class="jr-cmt-box">${esc(j.TeacherReply)}</div></div>`:'')}
    </div>`;
  }
  window.T_saveReply=async(sid,date,btn)=>{ const el=document.getElementById('jTR'); const reply=el?el.value:'';
    if(btn)btn.disabled=true; try{ await api('saveTeacherReply',{staffId:USER.staffId,studentId:sid,date:date||undefined,reply}); confirmSaved(EN()?'Reply sent':'ส่งคำตอบแล้ว'); }catch(e){err(e);}finally{ if(btn)btn.disabled=false; } };
  window.P_saveComment=async(sid,date,btn)=>{ const el=document.getElementById('jPC'); const comment=el?el.value:'';
    if(btn)btn.disabled=true; try{ await api('saveParentComment',{parentId:USER.parentId,uid:USER.uid,studentId:sid,date:date||undefined,comment}); confirmSaved(EN()?'Comment saved':'บันทึกความคิดเห็นแล้ว'); }catch(e){err(e);}finally{ if(btn)btn.disabled=false; } };
  function ddmmyyyy(s){ const d=new Date(s||todayStr()); return p2(d.getDate())+'-'+p2(d.getMonth()+1)+'-'+d.getFullYear(); }
  // student leave label: "ประเภท — เหตุผล" (type first, reason appended when present)
  const stdLeaveDesc = l => { const ty=(l&&l.Type||'').trim(), rs=(l&&l.Reason||'').trim(); return ty&&rs ? ty+' — '+rs : (ty||rs||'-'); };
  function waitCard(date){ return `<div class="card" style="text-align:center;color:#8a6d00;background:#fff8e1;border-color:#f0e3b0">⏳ รอคุณครูส่งข้อมูลของวันที่ ${ddmmyyyy(date)}</div>`; }
  function annRow(a){ const ti=EN()?(a.TitleEN||a.Title):(a.Title||a.TitleEN); const co=EN()?(a.ContentEN||a.Content):(a.Content||a.ContentEN);
    return `<div class="list-item"><div><b>${esc(ti)}</b><br><small class="muted">${esc(co)}</small>${a.Image?`<br><img src="${esc(a.Image)}" style="max-width:160px;border-radius:8px;margin-top:6px"/>`:''}</div><small class="muted">${esc(a.Date)}</small></div>`; }
  const SCHOOL_MAP_URL = 'https://maps.app.goo.gl/jQhGb3KQj59RV2wXA';
  function socialFooter(){ const L=MOCK.config.Links||{}; return `<div class="social">
    <a href="${esc(L.line||'#')}" target="_blank"><span class="ic line">L</span>LINE OA</a>
    <a href="${esc(L.facebook||'#')}" target="_blank"><span class="ic fb">f</span>Facebook</a>
    <a href="${esc(L.map||SCHOOL_MAP_URL)}" target="_blank"><span class="ic web">📍</span>${EN()?'Map':'แผนที่'}</a></div>`; }
  // ---- navigable month calendar (all roles: browse ahead/back) ----
  let CAL_OFF=0;  // month offset from the current month; reset on screen nav (GO)
  window.CAL_nav=(d)=>{ CAL_OFF+=d; const w=document.getElementById('calWrap'); if(w&&window._CALRENDER) w.innerHTML=window._CALRENDER(); };
  window.CAL_today=()=>{ CAL_OFF=0; const w=document.getElementById('calWrap'); if(w&&window._CALRENDER) w.innerHTML=window._CALRENDER(); };
  const CAL_MTH=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'], CAL_MTHE=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const calBase=()=>{ const b=new Date(); b.setDate(1); b.setMonth(b.getMonth()+CAL_OFF); return b; };
  function calNavHeader(y,mo){ const head=EN()?CAL_MTHE[mo]+' '+y:CAL_MTH[mo]+' '+(y+543);
    return `<div class="spread" style="margin-bottom:6px"><button class="btn sm outline" onclick="CAL_nav(-1)">◀</button><b style="font-size:14px">📅 ${esc(head)}</b><span class="row"><button class="btn sm outline" onclick="CAL_today()">${EN()?'Today':'วันนี้'}</button><button class="btn sm outline" onclick="CAL_nav(1)">▶</button></span></div>`; }

  // Parent calendar: check-in/out times + school holidays + the LINKED student's leave days only.
  function calendarWidget(events, checkins, planEnd, studentLeaves){ checkins=checkins||[]; studentLeaves=studentLeaves||[];
    const grace=Number(MOCK.config.OTGraceMinutes||21); const toMin=hhmm=>{const[h,m]=String(hhmm||'0:0').split(':').map(Number);return (h||0)*60+(m||0);};
    const lateOut = out => planEnd && out && (toMin(out)-toMin(planEnd))>grace;
    const render=()=>{ const b=calBase(),y=b.getFullYear(),mo=b.getMonth(); const now=new Date(); const isCur=CAL_OFF===0;
      const first=new Date(y,mo,1).getDay(); const days=new Date(y,mo+1,0).getDate(); const evByDay={},ioByDay={},lvByDay={};
      // parents don't see Big Cleaning — only holidays
      events.filter(e=>e.type!=='bigclean').forEach(e=>{ const d=new Date(e.date); if(d.getFullYear()===y&&d.getMonth()===mo) (evByDay[d.getDate()]=evByDay[d.getDate()]||[]).push(e); });
      checkins.forEach(c=>{ const d=new Date(c.Date); if(d.getFullYear()===y&&d.getMonth()===mo) ioByDay[d.getDate()]=c; });
      studentLeaves.forEach(l=>{ const d=new Date(l.Date); if(d.getFullYear()===y&&d.getMonth()===mo) (lvByDay[d.getDate()]=lvByDay[d.getDate()]||[]).push(l); });
      let cells=['อา','จ','อ','พ','พฤ','ศ','ส'].map(w=>`<div style="text-align:center;font-size:11px;color:#94a3b8">${EN()?({'อา':'Su','จ':'Mo','อ':'Tu','พ':'We','พฤ':'Th','ศ':'Fr','ส':'Sa'}[w]):w}</div>`).join('');
      for(let i=0;i<first;i++) cells+=`<div class="d dim"></div>`;
      for(let d=1;d<=days;d++){ const ev=evByDay[d]; const io=ioByDay[d]; const lv=lvByDay[d]; const et=ev?ev[0].type:''; const today=(isCur&&d===now.getDate())?'today':'';
        const outRed=io&&lateOut(io.OutTime); const outHtml=io?`<span style="${outRed?'color:#d50000;font-weight:800':''}">${esc(io.OutTime||'-')}</span>`:'';
        cells+=`<div class="d ${ev?'ho':''} ${lv?'ev':''} ${today}" style="${lv?'background:#fff3e0;border-color:#f0c48a;':''}">${d}${ev?`<span class="dot" style="color:#c62828">🏖️ ${esc(EN()?(ev[0].titleEN||ev[0].title):ev[0].title)}</span>`:''}${lv?`<span class="dot" style="color:#e65100">🏠 ${esc(lv[0].Type||lv[0].Reason||(EN()?'leave':'ลา'))}</span>`:''}${io?`<span class="io">${esc(io.InTime||'-')}<br>${outHtml}</span>`:''}</div>`; }
      return `${calNavHeader(y,mo)}<div class="cal">${cells}</div><small class="muted">${EN()?'↓in ↑out · 🏖️ holiday · 🏠 child on leave':'↓เข้า ↑ออก · 🏖️ วันหยุด · 🏠 ลา'}</small>`; };
    window._CALRENDER=render;
    return `<div class="card"><div id="calWrap">${render()}</div></div>`; }

  // Forced announcement popup for parents (must close before check-in/out). Fetched FRESH (opts.fresh)
  // so a stale cached-empty from an earlier session can't suppress it. If there is more than one active
  // announcement it becomes an auto-advancing CAROUSEL: the most important (Priority) shows first and it
  // rotates to the next every 5s. "Don't show again" is per-announcement id. NOTE the dismissed key is
  // `_v2` — the old `atom_ann_dismissed` was polluted by duplicate AnnIDs (a delete reused an id), so an
  // earlier dismissal was hiding brand-new announcements; v2 starts everyone fresh.
  const ANN_DISMISS_KEY='atom_ann_dismissed_v2';
  let ANN_SHOWING=false;
  async function showAnnPopups(onDone){
    if(ANN_SHOWING){ if(onDone)onDone(); return; }                    // already open → don't stack duplicates
    let anns=[]; try{ anns=await api('activeAnnouncements',{},{fresh:true}); }catch(e){}
    let dismissed={}; try{ dismissed=JSON.parse(localStorage.getItem(ANN_DISMISS_KEY)||'{}'); }catch(e){}
    // dedupe by AnnID (defensive) + drop dismissed; server already sorts by Priority, re-sort defensively
    const seen={}; const queue=(anns||[]).filter(a=>{ if(!a||dismissed[a.AnnID]||seen[a.AnnID])return false; seen[a.AnnID]=1; return true; })
      .sort((a,b)=>(Number(b.Priority||0)-Number(a.Priority||0)) || String(b.StartDate||b.Date||'').localeCompare(String(a.StartDate||a.Date||'')));
    if(!queue.length){ if(onDone)onDone(); return; }
    ANN_SHOWING=true;
    let idx=0, timer=null;
    const prPill=a=>Number(a.Priority||0)>=2?`<span class="annpop-pri">⭐ ${EN()?'Important':'สำคัญ'}</span>`:'';
    const slide=a=>{ const ti=EN()?(a.TitleEN||a.Title):(a.Title||a.TitleEN); const co=EN()?(a.ContentEN||a.Content):(a.Content||a.ContentEN);
      return `${prPill(a)}<h3>${esc(ti)}</h3>${co?`<p class="annpop-body">${esc(co)}</p>`:''}${a.Image?`<img class="annpop-img" src="${esc(a.Image)}" onclick="IMG_zoom('${esc(a.Image)}')" alt=""/>`:''}`; };
    const m=modal(`<div class="annpop"><div class="annpop-ic">📢</div><div class="annpop-badge">${esc(t('ann.badge'))}</div>
      <div id="annSlide"></div>
      <div class="annpop-dots" id="annDots"></div>
      <label class="annpop-hide"><input type="checkbox" id="annHide"/> <span>${esc(t('ann.hide'))}</span></label>
      <button class="btn block" id="annClose">${esc(t('ann.ok'))}</button></div>`);
    m.onclick=null;                                                    // force the button (no backdrop-dismiss)
    const render=()=>{ const s=m.querySelector('#annSlide'); if(s)s.innerHTML=slide(queue[idx]);
      const d=m.querySelector('#annDots'); if(d)d.innerHTML=queue.length>1?queue.map((_,i)=>`<span class="annpop-dot${i===idx?' on':''}"></span>`).join(''):''; };
    render();
    if(queue.length>1) timer=setInterval(()=>{ idx=(idx+1)%queue.length; render(); },5000);   // rotate to the next every 5s
    m.querySelector('#annClose').onclick=()=>{ if(timer)clearInterval(timer);
      if(m.querySelector('#annHide').checked){ dismissed[queue[idx].AnnID]=true; try{localStorage.setItem(ANN_DISMISS_KEY,JSON.stringify(dismissed));}catch(e){} }
      m.remove(); ANN_SHOWING=false; if(onDone)onDone(); };
  }

  // ================= PARENT =================
  SCREENS.Parent.home = async () => {
    showAnnPopups();
    const kids = await api('parentChildren',parentScope());
    const addBtn = `<button class="btn sm outline" onclick="P_addChild()">+ ${esc(t('p.addChild'))}</button>`;
    const profileBtn = `<button class="btn sm outline" onclick="P_profile()">👤 ${EN()?'My info':'ข้อมูลของฉัน'}</button>`;
    if(!kids.length){ app.innerHTML=`<h2 class="page">${esc(t('p.greeting'))}${esc(EN()?USER.nameEN:USER.nameTH)} 👋</h2>
      <div class="card" style="text-align:center"><p>${esc(t('p.noChild'))}</p><div class="row" style="justify-content:center">${addBtn}${profileBtn}</div></div>${socialFooter()}`; return; }
    const k0 = kids[0];
    // one batched round-trip: journal/leaves/announcements/calendar + each kid's check-in history (for today's status)
    const _res = await Promise.all([
      api('getJournal',{studentId:k0.StudentID}), api('studentLeaves',{studentId:k0.StudentID}),
      api('announcements'), api('calendar'),
      ...kids.map(k=>api('studentCheckinHistory',{studentId:k.StudentID}))
    ]);
    const [j, sl, anns, cal] = _res; const ciAll=_res.slice(4); const ci=ciAll[0]||[];
    // today's IN/OUT time per kid → disable the button once done (one drop-off / one pick-up per day)
    const todayCI={}; kids.forEach((k,i)=>{ const r=(ciAll[i]||[]).find(x=>ymd(x.Date)===todayStr())||{}; todayCI[k.StudentID]={in:r.InTime||'',out:r.OutTime||''}; });
    const doneBtn=(done,txt)=> done ? `disabled style="flex:1;padding:18px;font-size:18px;font-weight:700;opacity:.45;cursor:not-allowed"` : `style="flex:1;padding:18px;font-size:18px;font-weight:700"`;
    // рับ-ส่งเด็ก (GPS) is now on the home kid card: big IN/OUT buttons like the teacher's, no location bar
    const kidsHtml = kids.map(k=>{ const din=todayCI[k.StudentID].in, dout=todayCI[k.StudentID].out;
      return `<div class="card"><div class="spread"><div><b style="font-size:17px">${esc(dispNick(k))}</b> <small class="muted">${esc(nm(k))}</small><br><small class="muted">🏫 ${esc(k.Class||(EN()?'no class':'ยังไม่จัดชั้น'))} · ${esc(ageYM(k.DOB))} · ${esc(planLabel(k.Plan))}<br>${EN()?'allergy':'แพ้'}: ${esc(k.Allergy||'-')}</small>${k.RateNote?`<br><small style="color:#1565C0">🕕 ${esc(k.RateNote)}</small>`:''}</div>${studentAvatar(k)}</div>
      <div class="row" style="margin-top:12px;gap:10px"><button class="btn green" ${doneBtn(din)} onclick="P_punch('${k.StudentID}','IN',this)">🟢 ${din?(EN()?'Dropped off ':'ส่งแล้ว ')+esc(din):(EN()?'Drop off':'ส่งเข้าเรียน')}</button><button class="btn pink" ${doneBtn(dout)} onclick="P_punch('${k.StudentID}','OUT',this)">🔴 ${dout?(EN()?'Picked up ':'รับแล้ว ')+esc(dout):(EN()?'Pick up':'รับกลับ')}</button></div></div>`; }).join('');
    // header quick-actions: บันทึก / พัฒนาการ. (แจ้งลาออก removed — only Admin may withdraw a student.)
    setTopActions(`<button class="btn sm outline" onclick="P_journal('${k0.StudentID}')" title="${esc(t('nav.journal'))}">📒<span class="lbl"> ${esc(t('nav.journal'))}</span></button>
      <button class="btn sm outline" onclick="P_dspm('${k0.StudentID}')" title="${esc(t('nav.dspm'))}">📈<span class="lbl"> ${esc(t('nav.dspm'))}</span></button>`);
    const slHtml = sl.map(l=>`<div class="list-item"><span>${esc(ddmmyyyy(l.Date))} · <b>${esc(stdLeaveDesc(l))}</b></span><span class="pill info">${esc(tStat(l.Status))}</span></div>`).join('')||'<small class="muted">ไม่มีรายการ</small>';
    app.innerHTML = `<div class="spread"><h2 class="page">${esc(t('p.greeting'))}${esc(EN()?USER.nameEN:USER.nameTH)} 👋</h2><div class="row">${profileBtn}${addBtn}</div></div>
      ${kidsHtml}
      <h3 style="margin:6px 2px">📒 ${EN()?'Journal of':'บันทึกของ'} ${esc(dispNick(k0))} ${EN()?'today':'วันนี้'}</h3>${j?journalChecklist(j,{parentEditable:true,student:k0}):waitCard()}
      <div class="card"><div class="spread"><h3>🏠 แจ้งลาบุตรหลาน</h3><button class="btn sm outline" onclick="P_absence()">+ แจ้งลา</button></div>${slHtml}</div>
      <div class="card" id="insCard"></div>
      <div class="card"><h3>📢 ประกาศจากโรงเรียน</h3>${anns.map(annRow).join('')}</div>
      ${calendarWidget(cal, ci, (MOCK.config.Plans.find(p=>p.id===k0.Plan)||{}).end, sl)}
      ${socialFooter()}`;
    // insurance status per child (parent fills once; shows "กรอกแล้ว" if done)
    try{ const sts=await Promise.all(kids.map(k=>api('insuranceStatus',{studentId:k.StudentID})));
      setHTML('#insCard', `<h3>🛡️ ${esc(t('ins2.manage'))}</h3>`+kids.map((k,i)=>{ const f=sts[i].filled;
        return `<div class="list-item"><span><b>${esc(dispNick(k))}</b> <span class="pill ${f?'ok':'wait'}">${f?'✓ '+esc(t('ins2.filled')):esc(t('ins2.notFilled'))}</span></span>
          <button class="btn sm ${f?'outline':''}" onclick="P_insurance('${k.StudentID}')">${f?esc(t('lbl.view')):esc(t('ins2.btn'))}</button></div>`; }).join(''));
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
  // parent's own profile: view + edit personal info, and see linked children
  // profile field helper (id is namespaced per record so many forms coexist)
  const ppFld=(pre,id,label,val,type)=>`<label class="field"><span>${esc(label)}</span><input id="${pre}_${id}" type="${type||'text'}" value="${esc(val==null?'':val)}"/></label>`;
  window.P_profile = async () => { setNav('home');
    const d = await api('familyProfile', parentScope()); const parents=d.parents||[]; const kids=d.students||[];
    const parentCard=p=>{ const pre='pa_'+p.ParentID;
      // picture: uploaded Photo wins, else their LINE profile picture (no upload needed)
      const pic=photoOf(p), usingLine=!p.Photo&&!!p.LinePictureUrl;
      return `<div class="card"><div class="spread"><h3>${p.isMe?'👤':'👥'} ${esc(parentDisp(p)||(EN()?'Parent':'ผู้ปกครอง'))} ${p.isMe?`<span class="pill ok" style="font-size:10px">${EN()?'me':'ฉัน'}</span>`:''}</h3></div>
        <div class="ppic">
          ${pic?`<img class="ppic-img" src="${esc(pic)}" alt="" onclick="IMG_zoom('${esc(pic)}')"/>`:`<span class="ppic-none">${esc(initialEN(p.NameEN))}</span>`}
          <div class="ppic-side">
            <span class="pill ${usingLine?'info':'ok'}" style="font-size:10px">${usingLine?('LINE '+(EN()?'picture':'โปรไฟล์')):(p.Photo?(EN()?'uploaded':'รูปที่อัปโหลด'):(EN()?'no picture':'ยังไม่มีรูป'))}</span>
            <small class="muted" style="font-size:11px">${EN()?'Uses your LINE picture automatically. Upload one to replace it.':'ใช้รูปโปรไฟล์ LINE อัตโนมัติ · อัปโหลดรูปเพื่อใช้แทนได้'}</small>
            ${photoField(pre+'_PhotoUp',(EN()?'Upload a picture':'อัปโหลดรูป'),'',false)}
            ${p.Photo?`<button class="btn sm outline" onclick="P_useLinePic('${p.ParentID}',this)">↩︎ ${EN()?'Use my LINE picture':'ใช้รูป LINE แทน'}</button>`:''}
          </div>
        </div>
        <div class="grid2"><label class="field"><span>${esc(t('reg.title'))}</span><select id="${pre}_Title">${['','นาย','นาง','นางสาว'].map(x=>`<option ${(p.Title||titleOf(p))===x?'selected':''}>${x}</option>`).join('')}</select></label>${ppFld(pre,'NameTH',EN()?'Name (TH)':'ชื่อ-สกุล (ไทย)',p.NameTH)}</div>
        <div class="grid2">${ppFld(pre,'NameEN',EN()?'Name (EN)':'ชื่อ-สกุล (อังกฤษ)',p.NameEN)}${ppFld(pre,'Nickname',EN()?'Nickname (TH)':'ชื่อเล่น (ไทย)',p.Nickname)}</div>
        <div class="grid2">${ppFld(pre,'NicknameEN',EN()?'Nickname (EN)':'ชื่อเล่น (อังกฤษ)',p.NicknameEN)}<label class="field"><span>${EN()?'Relationship':'ความสัมพันธ์'}</span><input id="${pre}_Relationship" value="${esc(p.Relationship||'')}"/></label></div>
        <div class="grid2">${ppFld(pre,'Phone',EN()?'Phone':'เบอร์โทร',phoneFmt(p.Phone))}${ppFld(pre,'OfficePhone',EN()?'Office phone':'เบอร์ที่ทำงาน',phoneFmt(p.OfficePhone))}</div>
        <div class="grid2">${ppFld(pre,'Occupation',EN()?'Occupation':'อาชีพ',p.Occupation)}${ppFld(pre,'Workplace',EN()?'Workplace':'ที่ทำงาน',p.Workplace)}</div>
        <label class="field"><span>${EN()?'Address':'ที่อยู่'}</span><textarea id="${pre}_Address">${esc(p.Address||'')}</textarea></label>
        <p class="muted" style="font-size:11.5px">${EN()?'National ID':'เลขบัตรประชาชน'}: <b>${esc(p.NationalID||'-')}</b> · ${EN()?'contact admin to change':'ติดต่อแอดมินเพื่อแก้ไข'}</p>
        <button class="btn block green" onclick="P_saveParent('${p.ParentID}',this)">💾 ${EN()?'Save':'บันทึก'}</button></div>`; };
    const studentCard=s=>{ const pre='st_'+s.StudentID;
      return `<div class="card"><div class="spread"><h3>👶 ${esc(nm(s))}${nick(s)?` <span class="pill info" style="font-size:11px">${esc(nick(s))}</span>`:''}</h3><span class="muted" style="font-size:12px">🏫 ${esc(s.Class||(EN()?'no class':'ยังไม่จัดชั้น'))} · ${esc(ageYM(s.DOB))}</span></div>
        <p class="muted" style="font-size:11.5px">${EN()?'ID':'เลขบัตร'}: <b>${esc(s.NationalID||'-')}</b> · ${EN()?'class/plan/ID: contact admin':'ชั้นเรียน/แพ็กเกจ/เลขบัตร: ติดต่อแอดมิน'}</p>
        <div class="grid2">${ppFld(pre,'Nickname',EN()?'Nickname (TH)':'ชื่อเล่น (ไทย)',s.Nickname)}${ppFld(pre,'NicknameEN',EN()?'Nickname (EN)':'ชื่อเล่น (อังกฤษ)',s.NicknameEN)}</div>
        <div class="grid2">${ppFld(pre,'BloodType',EN()?'Blood type':'กรุ๊ปเลือด',s.BloodType)}${ppFld(pre,'RH',EN()?'Rh':'Rh',s.RH)}</div>
        <label class="field"><span>${EN()?'Allergies':'ประวัติแพ้ (อาหาร/ยา)'}</span><input id="${pre}_Allergy" value="${esc(s.Allergy||'')}"/></label>
        <label class="field"><span>${EN()?'Medical history':'ประวัติสุขภาพ/โรคประจำตัว'}</span><textarea id="${pre}_MedicalHistory">${esc(s.MedicalHistory||'')}</textarea></label>
        <label class="field"><span>${EN()?'Emergency contact':'ติดต่อฉุกเฉิน'}</span><input id="${pre}_EmergencyContact" value="${esc(s.EmergencyContact||'')}"/></label>
        <label class="field"><span>${EN()?'Home address':'ที่อยู่'}</span><textarea id="${pre}_Address">${esc(s.Address||'')}</textarea></label>
        <button class="btn block green" onclick="P_saveStudent('${s.StudentID}',this)">💾 ${EN()?'Save child info':'บันทึกข้อมูลเด็ก'}</button></div>`; };
    app.innerHTML=`<div class="spread"><h2 class="page">👤 ${EN()?'My info':'ข้อมูลของฉัน'}</h2><button class="btn sm outline" onclick="GO('home')">← ${esc(t('c.back'))}</button></div>
      <h3 class="page" style="font-size:15px">${EN()?'Parents':'ผู้ปกครอง'} (${parents.length})</h3>
      ${parents.map(parentCard).join('')||`<div class="card muted">${EN()?'none':'ยังไม่มี'}</div>`}
      <h3 class="page" style="font-size:15px">👶 ${EN()?'Children':'บุตรหลาน'} (${kids.length})</h3>
      ${kids.map(studentCard).join('')||`<div class="card muted">${EN()?'none':'ยังไม่มี'}</div>`}
      <button class="btn sm outline block" style="margin-top:8px" onclick="P_addChild()">+ ${esc(t('p.addChild'))}</button>`;
    window.scrollTo(0,0); };
  window.P_saveParent = async (parentId,btn)=>{ const g=id=>{ const e=document.getElementById('pa_'+parentId+'_'+id); return e?e.value.trim():undefined; };
    const data={ Title:g('Title'), NameTH:g('NameTH'), NameEN:g('NameEN'), Nickname:g('Nickname'), NicknameEN:g('NicknameEN'), Relationship:g('Relationship'), Phone:g('Phone'), OfficePhone:g('OfficePhone'), Occupation:g('Occupation'), Workplace:g('Workplace'), Address:g('Address') };
    if(!data.NameTH){ toast(EN()?'Name is required':'กรุณากรอกชื่อ'); return; }
    // only send Photo when they actually picked one — otherwise leave the existing value alone
    const up=photoVal(document,'pa_'+parentId+'_PhotoUp'); if(up) data.Photo=up;
    if(btn)btn.disabled=true;
    try{ await api('saveFamilyParent',Object.assign({parentId:USER.parentId,uid:USER.uid,targetParentId:parentId},{data})); confirmSaved(t('c.saved')); if(up) P_profile(); }catch(e){err(e);}finally{ if(btn)btn.disabled=false; } };
  // clear the uploaded photo -> the display falls back to their LINE profile picture
  window.P_useLinePic = async (parentId,btn)=>{ if(!confirm(EN()?'Use your LINE profile picture instead?':'ใช้รูปโปรไฟล์ LINE แทนรูปที่อัปโหลดไว้?'))return;
    if(btn)btn.disabled=true;
    try{ await api('saveFamilyParent',{parentId:USER.parentId,uid:USER.uid,targetParentId:parentId,data:{Photo:''}}); confirmSaved(t('c.saved')); P_profile(); }catch(e){err(e);}finally{ if(btn)btn.disabled=false; } };
  window.P_saveStudent = async (studentId,btn)=>{ const g=id=>{ const e=document.getElementById('st_'+studentId+'_'+id); return e?e.value.trim():undefined; };
    const data={ Nickname:g('Nickname'), NicknameEN:g('NicknameEN'), BloodType:g('BloodType'), RH:g('RH'), Allergy:g('Allergy'), MedicalHistory:g('MedicalHistory'), EmergencyContact:g('EmergencyContact'), Address:g('Address') };
    if(btn)btn.disabled=true;
    try{ await api('saveStudentSelf',{studentId,data}); confirmSaved(t('c.saved')); }catch(e){err(e);}finally{ if(btn)btn.disabled=false; } };
  window.P_absence = async () => { const kids=await api('parentChildren',parentScope());
    const m=modal(`<h3>🏠 แจ้งลาบุตรหลาน</h3>
      <label class="field"><span>บุตรหลาน</span><select id="aKid">${kids.map(k=>`<option value="${k.StudentID}">${esc(dispNick(k))}</option>`).join('')}</select></label>
      <label class="field"><span>วันที่ลา</span><input type="date" id="aDate" value="${todayStr()}"/></label>
      <label class="field"><span>ประเภทการลา</span><select id="aType"><option>ลาป่วย</option><option>ลากิจ</option><option>ลาพักร้อน</option><option>อื่นๆ</option></select></label>
      <label class="field"><span>สาเหตุ (ถ้ามี)</span><textarea id="aReason" placeholder="เช่น เป็นไข้ / มีธุระครอบครัว"></textarea></label>
      <button class="btn block" onclick="P_absenceDo(this)">ส่งแจ้งลา</button>`);
  };
  window.P_absenceDo = async (btn) => { const m=btn.closest('.modal');
    await api('studentAbsence',{studentId:m.querySelector('#aKid').value,date:m.querySelector('#aDate').value,type:m.querySelector('#aType').value,reason:m.querySelector('#aReason').value});
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
  // Bank dropdown for the claim account (PCHI Setting!P "BANK CODE"). The stored value is
  // "<code>: <Thai name>" — the format the insurer's own form uses; the EN label is display-only.
  // A pre-existing value that isn't in the list is kept as an option so an edit never silently drops it.
  const insBankSel=(id,label,banks,val)=>{ const list=(banks||[]).map(b=>({v:b.code+': '+b.th, l:b.code+': '+(EN()?b.en:b.th)}));
    const cur=String(val||''); if(cur && !list.some(x=>x.v===cur)) list.unshift({v:cur,l:cur});
    return `<label class="field"><span>${esc(label)}</span><select id="ins_${id}"><option value=""></option>${
      list.map(x=>`<option value="${esc(x.v)}" ${cur===x.v?'selected':''}>${esc(x.l)}</option>`).join('')}</select></label>`; };
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
      <div class="grid2">${insBankSel('BankAccountName',t('ins2.bankName'),o.Banks,rec.BankAccountName)}${insInp('BankAccountNumber',t('ins2.bankNo'),rec.BankAccountNumber)}</div></div>
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
    showAnnPopups();
    const kids=await api('parentChildren',parentScope()); if(!kids.length){GO('home');return;}
    // The send/pick-up BUTTONS live only on the home kid card now — this screen is the history view.
    app.innerHTML = `<h2 class="page">${esc(t('title.checkin'))}</h2>
      <div class="card" style="background:#eef6ff;border-color:#cfe3fb"><div class="spread"><small class="muted" style="font-size:12.5px">${EN()?'Drop-off / pick-up buttons are on the Home page (on each child’s card).':'ปุ่มส่งเข้าเรียน / รับกลับ อยู่ที่หน้าหลัก (บนการ์ดของบุตรหลานแต่ละคน)'}</small><button class="btn sm" onclick="GO('home')">🏠 ${EN()?'Home':'ไปหน้าหลัก'}</button></div></div>
      <div class="card"><h3>🗓️ ประวัติการรับ-ส่ง</h3><div id="ciHist"></div></div>`;
    const hist=await api('studentCheckinHistory',{studentId:kids[0].StudentID});
    setHTML('#ciHist', hist.map(h=>`<div class="list-item"><span>${esc(ddmmyyyy(h.Date))}</span><span><span class="pill ok">↓ ${esc(h.InTime||'--:--')}</span> <span class="pill info">↑ ${esc(h.OutTime||'--:--')}</span></span></div>`).join('')||'<small class="muted">ยังไม่มีประวัติ</small>');
  };
  let P_TYPE='IN'; window.P_type=t=>{P_TYPE=t;$('#tIN').classList.toggle('active',t==='IN');$('#tOUT').classList.toggle('active',t==='OUT');};
  // real device geolocation → {lat,lng}. Backend enforces the school geofence (OUT_OF_RANGE).
  function getPosition(){ return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){ reject(new Error(EN()?'This device does not support GPS':'อุปกรณ์นี้ไม่รองรับ GPS')); return; }
    navigator.geolocation.getCurrentPosition(
      pos=>resolve({lat:pos.coords.latitude,lng:pos.coords.longitude}),
      e=>reject(new Error(EN()?'Cannot get your location — please allow location access and try again':'ระบุตำแหน่งไม่ได้ — กรุณาอนุญาตการเข้าถึงตำแหน่ง แล้วลองใหม่')),
      {enableHighAccuracy:true,timeout:10000,maximumAge:0}); }); }
  window.P_do=async(btn)=>{ const studentId=$('#kid').value; P_TYPE=P_TYPE; return P_punch(studentId,P_TYPE,btn); };
  // one-tap check-in/out from the home kid card (or checkin screen): read GPS → parentCheckin directly
  window.P_punch=async(studentId,type,btn)=>{ if(btn)btn.disabled=true; const done=()=>{ if(btn)btn.disabled=false; };
    try{ let lat=null,lng=null;
      // Check-in works from ANYWHERE — GPS is optional (tolerate denial). Check-out still needs a location (school enforces the radius).
      if(type==='OUT'){ ({lat,lng}=await getPosition()); }
      else { try{ ({lat,lng}=await getPosition()); }catch(e){ lat=null; lng=null; } }
      const r=await api('parentCheckin',{parentId:USER.parentId,uid:USER.uid,studentId,type,lat,lng});
      const distTxt=(r.distance!=null)?` (${EN()?'distance':'ระยะ'} ${r.distance} ${EN()?'m':'ม.'})`:'';
      toast(`✅ ${type==='IN'?(EN()?'Drop off':'ส่งเข้าเรียน'):(EN()?'Pick up':'รับกลับ')} ${r.time}${distTxt} — ${EN()?'teacher notified':'แจ้งครูแล้ว'}`);
      // keep the button faded + un-clickable for the rest of the day (prevents double-submit; one per day)
      if(btn){ btn.disabled=true; btn.style.opacity='.45'; btn.style.cursor='not-allowed';
        btn.textContent=(type==='IN'?'🟢 '+(EN()?'Dropped off ':'ส่งแล้ว '):'🔴 '+(EN()?'Picked up ':'รับแล้ว '))+r.time; }
      if(r.ot){ P_otQR(r.ot); } // late pickup → OT charge: pop the KTB QR
    }catch(e){ err(e); done(); } };
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

  // ---- slip history rendering (shared parent + admin) ----
  function slipVerBadge(v){ v=String(v||''); if(v.slice(0,3)==='YES')return `<span class="pill ok" style="font-size:10px">✓ ${EN()?'verified':'สลิปแท้'}</span>`; if(v.slice(0,2)==='NO')return `<span class="pill bad" style="font-size:10px">⚠ ${EN()?'not verified':'ตรวจไม่ผ่าน'}</span>`; return `<span class="pill info" style="font-size:10px">${EN()?'not checked':'ยังไม่ตรวจ'}</span>`; }
  function slipStatusPill(s){ const c={SUBMITTED:'wait',CONFIRMED:'ok',PARTIAL:'wait',REJECTED:'bad'}[s]||'info'; const lbl={SUBMITTED:EN()?'pending':'รอตรวจ',CONFIRMED:EN()?'confirmed':'ยืนยันแล้ว',REJECTED:EN()?'rejected':'ปฏิเสธ'}[s]||s; return `<span class="pill ${c}" style="font-size:10px">${esc(lbl)}</span>`; }
  function slipThumb(url){ return url?`<img src="${esc(url)}" alt="slip" style="width:46px;height:46px;object-fit:cover;border-radius:6px;border:1px solid #eee;cursor:zoom-in" onclick="ZOOM_IMG('${esc(url)}')" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'pill info',textContent:'📎',style:'font-size:10px'}))"/>`:`<span class="pill info" style="font-size:11px">📎</span>`; }
  function slipHistoryHTML(slips){ if(!slips||!slips.length)return '';
    return `<div style="margin-top:8px"><small class="muted">📎 ${EN()?'Submitted slips':'สลิปที่ส่งมา'}</small>${slips.map(s=>`<div class="list-item" style="gap:8px;align-items:center">${slipThumb(s.Url)}<span style="flex:1"><b>${baht(s.Amount)}</b> ${slipStatusPill(s.Status)} ${slipVerBadge(s.Verified)}${s.SlipGroup?` <span class="pill info" style="font-size:10px" title="${esc(s.SlipGroup)}">🔗 ${EN()?'combined':'สลิปรวมหลายคน'}</span>`:''}${s.Receiver?`<br><small class="muted">→ ${esc(s.Receiver)}</small>`:''}<br><small class="muted">${esc(String(s.SubmittedDate||'').slice(0,16))}</small></span></div>`).join('')}</div>`; }

  SCREENS.Parent.payment = async () => {
    const kids=await api('parentChildren',parentScope()); if(!kids.length){GO('home');return;} const sid=kids[0].StudentID; window._PAY_SID=sid;
    const [ps, ot, pre, allSlips] = await Promise.all([api('payments',{studentId:sid}), api('otDaily',{studentId:sid}), api('prepayments',{studentId:sid}), api('paymentSlips',{studentId:sid})]);
    const slipsOf=(kind,id)=>(allSlips||[]).filter(s=>s.RefKind===kind&&s.RefID===id);
    const per=EN()?'Period ':'งวด ';
    const verifyPill=`<span class="pill wait">${esc(t('pay.pendingVerify'))}</span>`;
    const preShow=pre.filter(p=>p.Status!=='UNPAID'); // in-progress / paid only; the discount options live behind the button
    const preHtml=`<div class="card"><div class="spread"><h3>💰 ${esc(t('prepay.title'))}</h3><button class="btn sm" onclick="P_prepay('${sid}')">💰 ${esc(t('prepay.pay'))}</button></div>
      <p class="muted" style="font-size:12px">${EN()?'Pay several months ahead for a discount — tap the button to see the options.':'จ่ายล่วงหน้าหลายเดือนรับส่วนลด — กดปุ่มเพื่อดูตัวเลือก'}</p>
      ${preShow.length?preShow.map(p=>{ const paid=p.Status==='PAID',partial=p.Status==='PARTIAL'; const sl=slipsOf('prepay',p.PrepayID); const pend=sl.some(s=>s.Status==='SUBMITTED');
        return `<div style="border-bottom:1px solid #f0f0f0;padding:4px 0"><div class="list-item"><span>${esc(t('prepay.months').replace('{n}',p.Months))} <span class="pill ok">-${p.Discount}%</span> <small class="muted">${esc(p.Covered[0])}→${esc(p.Covered[p.Covered.length-1])}</small></span>
        <span><b>${baht(p.Amount)}</b> ${paid?`<span class="pill ok">${esc(t('prepay.paidAhead'))}</span>`:partial?`<span class="pill wait">${EN()?'partial':'บางส่วน'}</span>`:pend?verifyPill:''} ${paid?'':`<button class="btn sm" onclick="P_payPrepay('${p.PrepayID}',${p.Amount})">${pend||partial?'📎':esc(t('lbl.pay'))}</button> <button class="btn sm gray" onclick="P_cash('prepay','${p.PrepayID}',${p.Amount})">💵</button>`}</span></div>${slipHistoryHTML(sl)}</div>`; }).join(''):''}</div>`;
    const otOpen=ot.filter(o=>o.Status!=='PAID'&&o.Status!=='PENDING_VERIFY'&&o.Status!=='PARTIAL');
    const otHtml = ot.length?`<div class="card"><h3>⏰ ${esc(t('ot.daily'))}</h3>
      ${ot.map(o=>{ const paid=o.Status==='PAID',partial=o.Status==='PARTIAL'; const sl=slipsOf('ot',o.OTID); const pend=sl.some(s=>s.Status==='SUBMITTED'); return `<div style="border-bottom:1px solid #f0f0f0;padding:4px 0"><div class="list-item"><span>${esc(ddmmyyyy(o.Date))} · ${esc(o.PickupTime)} <small class="muted">(${EN()?'late':'สาย'} ${o.LateMinutes}${esc(t('lbl.min'))} · ${o.Hours}${EN()?'h':'ชม.'})</small></span>
        <span><b>${baht(o.Amount)}</b> ${paid?`<span class="pill ok">${esc(t('s.paid'))}</span>`:partial?`<span class="pill wait">${EN()?'partial':'บางส่วน'}</span>`:pend?verifyPill:''} ${paid?'':`<button class="btn sm" onclick="P_payOT('${o.OTID}',${o.Amount})">${pend||partial?'📎':esc(t('lbl.pay'))}</button> <button class="btn sm gray" onclick="P_cash('ot','${o.OTID}',${o.Amount})">💵</button>`}</span></div>${slipHistoryHTML(sl)}</div>`; }).join('')}
      ${otOpen.length?`<div class="spread" style="margin-top:8px"><b>${esc(t('ot.unpaidTotal'))}</b><b style="color:#c62828">${baht(otOpen.reduce((a,o)=>a+o.Amount,0))}</b></div><small class="muted">${esc(t('ot.rollNote'))}</small>`:''}</div>`:'';
    const multiBtn = kids.length>1 ? `<div class="card" style="background:#eef6ff;border-color:#bbdefb"><div class="spread"><div><b>👨‍👩‍👧‍👦 ${EN()?'Pay for several children in one slip':'จ่ายรวมหลายคนในสลิปเดียว'}</b><br><small class="muted">${EN()?'One transfer covering more than one child — the system checks the total.':'โอนครั้งเดียวครอบคลุมลูกหลายคน ระบบจะตรวจยอดรวมให้'}</small></div><button class="btn sm" onclick="P_combinedPay()">💳 ${EN()?'Combined':'จ่ายรวม'}</button></div></div>` : '';
    app.innerHTML = `<h2 class="page">${esc(t('title.payment'))} · <span style="color:#1565C0">${esc(dispNick(kids[0]))}</span></h2>${multiBtn}${preHtml}${otHtml}${ps.map(b=>{
      const paid=b.Status==='PAID',partial=b.Status==='PARTIAL'; const due=b.TotalDue!=null?b.TotalDue:b.Amount;
      const prepaid=b.VerifiedStatus==='PREPAID'; const confirmed=Number(b.PaidConfirmed||0); const outstanding=b.Outstanding!=null?Number(b.Outstanding):Math.max(0,due-confirmed);
      const billSlips=slipsOf('bill',b.BillingID); const hasPending=billSlips.some(s=>s.Status==='SUBMITTED');
      const topUp = outstanding>0?outstanding:due;
      const statusPill = prepaid?`<span class="pill ok">${esc(t('prepay.paidAhead'))}</span>`
        : paid?`<span class="pill ok">${esc(tStat('PAID'))}</span>`
        : partial?`<span class="pill wait">${EN()?'Partially paid':'ชำระบางส่วน'}</span>`
        : hasPending?`<span class="pill wait">${esc(t('pay.pendingVerify'))}</span>`
        : `<span class="pill bad">${esc(tStat(b.Status))}</span>`;
      return `<div class="card"><div class="spread"><b>${per}${esc(b.Month)}</b>${statusPill}</div>
      <table style="width:100%;font-size:14px;margin:8px 0">${b.Items.map(it=>`<tr><td>${esc(trItem(it[0]))}</td><td style="text-align:right">${baht(it[1])}</td></tr>`).join('')}
      ${b.OTRollover?`<tr><td>${esc(t('ot.rollover'))}</td><td style="text-align:right">${baht(b.OTRollover)}</td></tr>`:''}
      <tr style="border-top:1px solid #ddd"><td><b>${esc(t('c.total'))}</b></td><td style="text-align:right"><b>${baht(due)}</b></td></tr>
      ${confirmed>0&&!paid?`<tr><td>${EN()?'Paid':'ชำระแล้ว'}</td><td style="text-align:right;color:#2e7d32">−${baht(confirmed)}</td></tr><tr><td><b>${EN()?'Remaining':'คงค้าง'}</b></td><td style="text-align:right"><b style="color:#c62828">${baht(outstanding)}</b></td></tr>`:''}</table>
      <small class="muted">${esc(t('c.due'))} ${esc(b.DueDate)}${b.PaidDate?' · '+esc(t('c.paid'))+' '+esc(b.PaidDate):''}</small>
      ${slipHistoryHTML(billSlips)}
      ${paid||prepaid?`<div class="row" style="margin-top:10px"><button class="btn sm outline" onclick="P_receipt('${b.BillingID}')">🧾 ${esc(t('pay.receipt'))}</button></div>`
        :`<div class="row" style="margin-top:10px"><button class="btn sm" onclick="P_qr('${b.BillingID}',${topUp})">${esc(t('lbl.qr'))}</button><button class="btn sm outline" onclick="P_slip('${b.BillingID}',${topUp})">📎 ${hasPending||partial?(EN()?'Add another slip':'แนบสลิปเพิ่ม'):esc(t('lbl.attachSlip'))}</button><button class="btn sm gray" onclick="P_cash('bill','${b.BillingID}',${topUp})">💵 ${esc(t('pay.cash'))}</button></div>`}</div>`;
    }).join('')}`;
  };
  // prepay with discount: 2mo -5%, 3mo -10%, 6mo -20%, 12mo -30%
  // Advance-tuition tiers must MATCH the engine (prepayDiscount): 2→5% · 3→10% · 6→15% · 12→20%.
  // The monthly price is fetched from the server (studentBillBase) so the preview equals the real charge
  // — never computed from the local MOCK seed, which differs from the student's real plan in gas mode.
  const PREPAY_TIERS=[[2,5],[3,10],[6,15],[12,20]];
  window.P_prepay=async(sid)=>{ const base=await api('studentBillBase',{studentId:sid}); const price=Number(base&&base.price||0);
    const label=(EN()?(base&&base.labelEN):(base&&base.labelTH))||planLabel((MOCK.students.find(x=>x.StudentID===sid)||{}).Plan);
    const opt=([mo,disc])=>{ const gross=price*mo, amt=Math.round(gross*(100-disc)/100), per=Math.round(amt/mo);
      return `<button class="role-card" onclick="P_prepayDo('${sid}',${mo})"><span class="ic">${mo}</span><span><b>${esc(t('prepay.months').replace('{n}',mo))} · -${disc}%</b><br><small>${baht(gross)} → <b>${baht(amt)}</b> <span class="muted">(${EN()?'avg':'เฉลี่ย'} ${baht(per)}/${EN()?'mo':'เดือน'})</span></small></span></button>`; };
    const body = price>0 ? PREPAY_TIERS.map(opt).join('')
      : `<div class="card" style="background:#fff3e0;border-color:#ffcc80;color:#e65100">⚠️ ${EN()?'This child has no monthly plan price set yet — please ask the admin to set the plan before paying in advance.':'นักเรียนคนนี้ยังไม่ได้ตั้งราคาแผนรายเดือน — กรุณาติดต่อแอดมินให้ตั้งค่าแผนก่อนชำระล่วงหน้า'}</div>`;
    modal(`<h3>💰 ${esc(t('prepay.title'))}</h3><p class="muted" style="font-size:12px">${esc(label)} · ${baht(price)}/${EN()?'mo':'เดือน'}</p>
      ${body}
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.P_prepayDo=async(sid,months)=>{ try{ const r=await api('prepay',{studentId:sid,months}); const m=document.querySelector('.modal'); if(m)m.remove();
    // one-shot: go straight to the QR + attach-slip flow for the chosen plan (no clutter on the payment screen)
    P_payPrepay(r.PrepayID, r.Amount); }catch(e){err(e);} };
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
    const due=Number(document.getElementById('slipDue').dataset.due||0);
    const setAmt=amt=>{ const aEl=document.getElementById('slipAmt'); if(aEl){ aEl.value=amt; aEl.dataset.fromqr='1'; } };
    const verdict=(label,amt)=>`${amt>=due?'✅':'⚠️'} ${label} ${amt>=due?esc(t('slip.qrMatch')):esc(t('slip.qrMismatch'))} ${baht(amt)}${amt>=due?'':' / '+baht(due)}`;
    out.textContent='⏳ '+t('slip.qrReading');
    // 1) read the slip's verification QR locally (the "สแกนตรวจสอบสลิป" code encodes the transaction ref)
    let qr=null;
    if('BarcodeDetector' in window){ try{ const bmp=await createImageBitmap(f); const det=new window.BarcodeDetector({formats:['qr_code']}); const codes=await det.detect(bmp); if(codes.length) qr=codes[0].rawValue; }catch(e){} }
    // 2) SlipOK: server verifies the slip against the bank + cross-checks the amount (we send the due).
    try{ const dataUrl=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(f);});
      const slipBase64=String(dataUrl).split(',')[1]||'';
      const vk=await api('verifySlip', Object.assign(qr?{qrData:qr}:{slipBase64}, {amount:due, log:false})); // log:false = pre-check only, don't consume the slip
      if(vk&&vk.available){
        if(vk.ok && vk.amount!=null){ setAmt(vk.amount); out.innerHTML=`✅ SlipOK ${esc(t('slip.qrMatch'))} ${baht(vk.amount)}${vk.receiver&&vk.receiver.name?` → ${esc(vk.receiver.name)}`:''}`; return; }
        if(vk.code===1013){ if(vk.amount!=null)setAmt(vk.amount); out.innerHTML=`⚠️ SlipOK ${esc(t('slip.qrMismatch'))} ${vk.amount!=null?baht(vk.amount):'?'} / ${baht(due)}`; return; }
        if(vk.code===1014){ if(vk.amount!=null)setAmt(vk.amount); const rcv=vk.receiver&&vk.receiver.name?esc(vk.receiver.name):'';
          out.innerHTML=`⚠️ SlipOK: ${EN()?'the slip receiver':'บัญชีผู้รับในสลิป'}${rcv?` (<b>${rcv}</b>)`:''} ${EN()?"doesn't match the account registered in SlipOK — you can still submit; the admin will verify":'ยังไม่ตรงกับบัญชีที่ลงทะเบียนไว้ใน SlipOK — ส่งได้เลย แอดมินจะตรวจสอบอีกครั้ง'}`; return; }
        if(vk.code===1012){ out.innerHTML=`⚠️ ${EN()?'Duplicate slip (already used)':'สลิปนี้เคยใช้แล้ว (สลิปซ้ำ)'}`; return; }
        if(vk.message){ out.innerHTML=`ℹ️ SlipOK: ${esc(vk.message)}`; }
      }
    }catch(e){}
    // 3) fallback: parse an EMVCo PAYMENT QR amount locally (a verification QR usually has none)
    if(qr){ const amt=parseEMVAmount(qr); if(amt!=null){ setAmt(amt); out.innerHTML=verdict('',amt); return; } }
    if(!out.innerHTML || out.textContent.indexOf('⏳')>=0) out.textContent = qr? ('ℹ️ '+t('slip.qrNoAmount')) : (('BarcodeDetector' in window)? ('ℹ️ '+t('slip.qrNone')) : ('ℹ️ '+t('slip.qrUnsupported'))); };
  // minimal EMVCo TLV parser → transaction amount (tag 54)
  function parseEMVAmount(s){ if(!s||typeof s!=='string')return null; let i=0;
    while(i+4<=s.length){ const tag=s.substr(i,2), len=parseInt(s.substr(i+2,2),10); if(isNaN(len))break; const val=s.substr(i+4,len);
      if(tag==='54'){ const n=parseFloat(val); return isNaN(n)?null:n; } i+=4+len; }
    return null; }
  window.P_slipDo=async(id,btn,kind)=>{ const m=btn.closest('.modal'); const aEl=m.querySelector('#slipAmt'); const f=m.querySelector('#slipF').files[0]; const amt=Number(aEl.value||0); const fromQR=aEl.dataset.fromqr==='1';
    if(!f){toast(EN()?'Please choose a slip file':'กรุณาเลือกไฟล์สลิป');return;}
    if(!amt){toast(EN()?'Enter the transferred amount':'กรอกยอดที่โอน');return;}
    const dataUrl=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(f);});
    if(btn)btn.disabled=true;
    try{ const args={slipName:f.name,slipAmount:amt,fromQR,slipData:dataUrl}; // slipData → saved to the Drive folder in GAS; SlipOK verifies it
      const r= kind==='teacherOt' ? await api('teacherPayOT',Object.assign({staffId:USER.staffId,otId:id},args))
             : kind==='ot' ? await api('payOT',Object.assign({otId:id},args))
             : kind==='prepay' ? await api('payPrepay',Object.assign({prepayId:id},args))
             : await api('uploadSlip',Object.assign({billingId:id},args));
      m.remove();
      const out=Number(r&&r.outstanding||0);
      confirmSaved(out>0 ? (EN()?`Slip submitted. Remaining balance ${baht(out)} — you can attach more.`:`ส่งสลิปแล้ว ยอดค้าง ${baht(out)} — แนบสลิปเพิ่มได้`) : t('slip.submittedReview'));
      if(kind==='teacherOt'){ if(window.T_studentOT) T_studentOT(); } else GO('payment'); }catch(e){err(e);} finally{ if(btn)btn.disabled=false; } };
  // notify a CASH payment — staff confirm + record the payment date afterward
  window.P_cash=(kind,id,amt)=>{ modal(`<div style="text-align:center"><h3>💵 ${esc(t('pay.payCash'))}</h3>
    <p class="muted" style="font-size:12.5px">${esc(t('pay.cashNote'))}</p>
    <p><b>${esc(t('c.total'))} ${baht(amt)} ${esc(EN()?'THB':'บาท')}</b></p>
    <button class="btn block" onclick="P_cashDo('${kind}','${id}',${amt},this)">${esc(t('c.confirm'))}</button>
    <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button></div>`); };
  window.P_cashDo=async(kind,id,amt,btn)=>{ const m=btn.closest('.modal');
    try{ await api('notifyCash',{kind,id,amount:amt,parentId:USER.parentId,uid:USER.uid}); m.remove(); confirmSaved(t('pay.cashNotified')); GO('payment'); }catch(e){err(e);} };

  // ---- combined payment: one slip, several children (2-level tick: child → outstanding bill) ----
  let _COMB={ids:[],due:0};
  window.P_combinedPay=async()=>{ const kids=await api('parentChildren',parentScope());
    const per=await Promise.all(kids.map(k=>api('payments',{studentId:k.StudentID})));
    // an outstanding bill = not PAID / not prepaid, with a positive remaining balance (tuition+extras+OT rolled in)
    const groups=kids.map((k,i)=>{ const bills=(per[i]||[]).filter(b=>{ const out=b.Outstanding!=null?Number(b.Outstanding):Number(b.TotalDue!=null?b.TotalDue:b.Amount); return b.Status!=='PAID'&&b.VerifiedStatus!=='PREPAID'&&out>0; })
        .map(b=>({billingId:b.BillingID, month:b.Month, out:Number(b.Outstanding!=null?b.Outstanding:(b.TotalDue!=null?b.TotalDue:b.Amount)), items:(b.Items||[])}));
      return {kid:k, bills}; }).filter(g=>g.bills.length);
    if(!groups.length){ toast(EN()?'No outstanding bills':'ไม่มีบิลค้างชำระ'); return; }
    const body=groups.map(g=>`<div class="card" style="padding:8px;margin:6px 0"><b>${esc(dispNick(g.kid))}</b> <small class="muted">${esc(nm(g.kid))}</small>
      ${g.bills.map(b=>`<label class="field" style="display:block;background:#fafafa;border-radius:8px;padding:6px;margin:6px 0">
        <span style="display:flex;align-items:center;gap:8px"><input type="checkbox" class="combCb" data-id="${esc(b.billingId)}" data-out="${b.out}" checked onchange="P_combRecalc()" style="width:auto"/> <b>${EN()?'Bill ':'บิล '}${esc(b.month)}</b> <b style="margin-left:auto;color:#1565C0">${baht(b.out)}</b></span>
        <div style="font-size:11.5px;color:#888;margin:2px 0 0 26px">${(b.items||[]).map(it=>`${esc(trItem(it[0]))} ${baht(it[1])}`).join(' · ')}</div></label>`).join('')}</div>`).join('');
    modal(`<h3>💳 ${EN()?'Combined payment':'จ่ายรวมหลายคน'}</h3>
      <p class="muted" style="font-size:12px">${EN()?'Tick the children / bills paid in this one transfer. The system sums them and checks the slip total.':'ติ๊กลูก/บิลที่จ่ายรวมในการโอนครั้งนี้ ระบบจะรวมยอดและตรวจกับสลิป'}</p>
      ${body}
      <div class="card" style="background:#e8f5e9;padding:8px"><div class="spread"><b>${EN()?'Total to transfer':'ยอดรวมที่ต้องโอน'}</b><b id="combTotal" style="font-size:18px;color:#2e7d32">฿0</b></div></div>
      <button class="btn block green" id="combNext" onclick="P_combinedNext()">📎 ${EN()?'Next: attach slip':'ถัดไป: แนบสลิป'}</button>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
    P_combRecalc(); };
  window.P_combRecalc=()=>{ const cbs=[...document.querySelectorAll('.combCb')]; let sum=0; const ids=[];
    cbs.forEach(c=>{ if(c.checked){ sum+=Number(c.dataset.out||0); ids.push(c.dataset.id); } });
    _COMB={ids, due:Math.round(sum)}; const tEl=document.getElementById('combTotal'); if(tEl)tEl.textContent=baht(_COMB.due);
    const nx=document.getElementById('combNext'); if(nx) nx.disabled=!ids.length; };
  window.P_combinedNext=()=>{ if(!_COMB.ids.length){ toast(EN()?'Select at least one bill':'เลือกอย่างน้อย 1 บิล'); return; }
    const cur=document.querySelector('.modal'); if(cur)cur.remove();
    modal(`<h3>📎 ${EN()?'Attach one slip':'แนบสลิปเดียว'} · <span style="color:#1565C0">${_COMB.ids.length} ${EN()?'bills':'บิล'}</span></h3>
      <label class="field"><span>${EN()?'Total to transfer':'ยอดที่ต้องโอน'}</span><input id="slipDue" value="${_COMB.due}" data-due="${_COMB.due}" disabled style="font-weight:700"/></label>
      <label class="field"><span>${esc(t('slip.file'))}</span><input type="file" id="slipF" accept="image/*" onchange="P_slipDetect(this)"/></label>
      <div style="text-align:center"><img id="slipPrev" alt="" style="max-height:200px;border-radius:8px;border:1px solid #eee;margin:4px 0;cursor:zoom-in" hidden onclick="ZOOM_IMG(this.src)"/></div>
      <label class="field"><span>${esc(t('slip.amountPaid'))}</span><input id="slipAmt" type="number" inputmode="decimal" placeholder="${esc(t('slip.amountPh'))}"/></label>
      <div id="qrDetect" class="muted" style="font-size:12px"></div>
      <button class="btn block green" onclick="P_combinedSlipDo(this)">${esc(t('slip.upload'))}</button>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`); };
  window.P_combinedSlipDo=async(btn)=>{ const m=btn.closest('.modal'); const aEl=m.querySelector('#slipAmt'); const f=m.querySelector('#slipF').files[0]; const amt=Number(aEl.value||0); const fromQR=aEl.dataset.fromqr==='1';
    if(!f){ toast(EN()?'Please choose a slip file':'กรุณาเลือกไฟล์สลิป'); return; }
    if(!amt){ toast(EN()?'Enter the transferred amount':'กรอกยอดที่โอน'); return; }
    // hard block: the transferred amount MUST equal the system total (owner rule) → red overlay
    if(Math.round(amt)!==Math.round(_COMB.due)){
      modal(`<div style="text-align:center;padding:6px"><div style="font-size:40px">⛔</div><h3 style="color:#c62828">${EN()?'Amount does not match':'ยอดชำระไม่ตรงกับระบบ'}</h3>
        <p style="font-size:14px">${EN()?'You entered':'คุณกรอก'} <b>${baht(amt)}</b><br>${EN()?'System total':'ยอดรวมในระบบ'} <b style="color:#c62828">${baht(_COMB.due)}</b></p>
        <p class="muted" style="font-size:12px">${EN()?'Transfer the exact total, or go back and change which bills are ticked.':'กรุณาโอนยอดให้ตรง หรือย้อนกลับไปแก้บิลที่ติ๊ก'}</p>
        <button class="btn block" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button></div>`);
      return; }
    const dataUrl=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(f);});
    if(btn)btn.disabled=true;
    try{ const r=await api('payCombined',{bills:_COMB.ids, slipAmount:amt, fromQR, slipName:f.name, slipData:dataUrl});
      m.remove(); confirmSaved(EN()?`Slip submitted for ${r.count} children (฿${r.total}) — admin will verify.`:`ส่งสลิปแล้ว สำหรับ ${r.count} คน (฿${r.total}) — แอดมินจะตรวจสอบ`); GO('payment'); }
    catch(e){ err(e); if(btn)btn.disabled=false; } };

  SCREENS.Parent.journal = async () => { const kids=await api('parentChildren',parentScope()); if(!kids.length){GO('home');return;} P_journal(kids[0].StudentID); };
  window.P_journal = async (sid) => { setNav('journal');
    const [kids,j,hist]=await Promise.all([api('parentChildren',parentScope()),api('getJournal',{studentId:sid}),api('journalHistory',{studentId:sid})]);
    const kid=(kids||[]).find(k=>k.StudentID===sid)||{};
    app.innerHTML=`<h2 class="page">${esc(t('title.journal'))} · <span style="color:#1565C0">${esc(dispNick(kid)||sid)}</span></h2>${j?journalChecklist(j,{parentEditable:true}):waitCard()}
      <h3 class="page" style="font-size:16px">ย้อนหลัง</h3>${hist.map(h=>`<div class="list-item"><span>${esc(h.Date)} · ${esc(MOODS[h.Mood]||'')} ${esc(h.Mood||'')}</span><button class="btn sm outline" onclick="P_showJ('${h.StudentID}','${h.Date}')">ดู</button></div>`).join('')||'<small class="muted">ไม่มี</small>'}`;
  };
  window.P_showJ=async(sid,date)=>{ const j=await api('getJournal',{studentId:sid,date}); app.innerHTML=`<h2 class="page">📒 ${esc(date)}</h2>${journalChecklist(j,{parentEditable:true})}<button class="btn outline" onclick="GO('journal')">← กลับ</button>`; window.scrollTo(0,0); };

  SCREENS.Parent.dspm = async () => { const kids=await api('parentChildren',parentScope()); if(!kids.length){GO('home');return;} P_dspm(kids[0].StudentID); };
  const DSPM_PILL=r=>{const c=r==='ผ่าน'?'ok':r==='ไม่ผ่าน'?'bad':'wait';return `<span class="pill ${c}">${esc(tStat(r))}</span>`;};
  const DT_KEY={GM:'dom.GM',FM:'dom.FM',RL:'dom.RL',EL:'dom.EL',PS:'dom.PS'};
  const DT=new Proxy({},{get:(_,k)=>t(DT_KEY[k]||k)});
  window.P_dspm = async (sid) => { setNav('dspm');
    // growth chart + vaccine card always render; the age-band assessment may be absent
    // (no DSPM_CRITERIA seeded for this age) — guard each call so the page never blanks.
    // all calls created in one tick → micro-batched into ONE GAS round-trip; allSettled so a
    // NO_CRITERIA from dspmStatus (no band for this age) doesn't blank the page.
    const [rg,rvs,rvr,rs,rall,rk]=await Promise.allSettled([
      api('growthHistory',{studentId:sid}),api('vaccineSchedule'),api('studentVaccines',{studentId:sid}),
      api('dspmStatus',{studentId:sid}),api('studentAllBands',{studentId:sid}),api('parentChildren',parentScope())]);
    const kidsD=rk.status==='fulfilled'?rk.value:[];
    const st=(kidsD||[]).find(k=>k.StudentID===sid)||MOCK.students.find(x=>x.StudentID===sid)||{};
    const g=rg.status==='fulfilled'?rg.value:{records:[]};
    const vsched=rvs.status==='fulfilled'?rvs.value:[]; const vrecs=rvr.status==='fulfilled'?rvr.value:[];
    const s=rs.status==='fulfilled'?rs.value:null;            // NO_CRITERIA for this age → null
    const all=rall.status==='fulfilled'?rall.value:{bands:[]};
    const ageMo = (window.AGEMONTHS&&st.DOB)?window.AGEMONTHS(st.DOB):(s?s.ageMonth:'');
    const past=(all.bands||[]).filter(b=>!s||b.label!==s.ageLabel);
    const itemRow=i=>`<div class="list-item"><span><b>ข้อ ${i.itemNo}</b> <span class="pill info">${i.skill}</span> · ${DT[i.skill]||''}<br><small>${esc(EN()&&i.descriptionEN?i.descriptionEN:i.description)}</small></span>${DSPM_PILL(i.result)}</div>`;
    const assessCard = s
      ? `<div class="card"><div class="spread"><b>${esc(dispNick(st)||sid)}</b><span class="muted">${s.ageMonth} เดือน</span></div>
          <div class="spread"><b style="color:#1565C0">⭐ ช่วงวัยปัจจุบัน: ${esc(s.ageLabel)}</b></div>
          <p class="muted" style="font-size:12.5px">แสดงทุกข้อของช่วงวัยนี้ ที่ยังไม่ประเมินจะขึ้น "ยังไม่ได้รับการทดสอบ"</p>
          ${s.manualUrl?`<a class="btn sm outline" href="${esc(s.manualUrl)}" target="_blank">⬇️ ดาวน์โหลดคู่มือ DSPM</a>`:''}
          ${s.items.map(itemRow).join('')}</div>`
      : `<div class="card"><div class="spread"><b>${esc(dispNick(st)||sid)}</b><span class="muted">${ageMo} เดือน</span></div>
          <p class="muted" style="font-size:13px">ℹ️ ยังไม่มีเกณฑ์ประเมินพัฒนาการสำหรับช่วงวัยนี้ (อายุ ${ageMo} เดือน) — เมื่อโรงเรียนเพิ่มเกณฑ์ตามคู่มือ DSPM ของช่วงวัยนี้แล้ว รายการประเมินจะแสดงที่นี่</p></div>`;
    app.innerHTML=`<h2 class="page">${esc(t('title.dspm'))} · <span style="color:#1565C0">${esc(dispNick(st)||sid)}</span></h2>
      <div class="card"><h3>📈 ${esc(t('growth.chartTitle'))}</h3><p class="muted" style="font-size:12px">${esc(t('growth.chartSub'))}</p>
        ${growthChartSVG(t('growth.weight'),g.records.map(r=>({x:r.AgeMonth,y:r.Weight})),gBand(g.weightBand,g.gender,g.records,'weight'),'kg')}
        ${growthChartSVG(t('growth.height'),g.records.map(r=>({x:r.AgeMonth,y:r.Height})),gBand(g.heightBand,g.gender,g.records,'height'),'cm')}
        <div class="row" style="font-size:11px;justify-content:center;margin-top:6px"><span>🟦 ${esc(t('growth.actual'))}</span><span>🟩 ${esc(t('growth.normalBand'))}</span></div>
        ${growthRecordsList(g.records)}</div>
      ${vaccineCard(vsched,vrecs,sid,true)}
      ${assessCard}
      ${past.length?`<h3 class="page" style="font-size:16px">📜 ผลย้อนหลัง (ช่วงวัยก่อนหน้า)</h3>`+past.reverse().map(b=>`<div class="card"><h3 style="font-size:14px">${esc(b.label)}</h3>${b.items.map(i=>`<div class="list-item"><span><b>ข้อ ${i.itemNo}</b> <span class="pill info">${i.skill}</span> <small>${esc(EN()&&i.descriptionEN?i.descriptionEN:i.description)}</small></span>${DSPM_PILL(i.result)}</div>`).join('')}</div>`).join(''):''}`;
  };

  SCREENS.Parent.chat = async () => { const line=MOCK.config.Links.line||'#';
    app.innerHTML=`<h2 class="page">${esc(t('title.chat'))}</h2>
      <div class="card" style="text-align:center"><div style="font-size:48px">💬</div>
        <p>${esc(t('chat.lineMsg'))}</p>
        <a class="btn block green" href="${esc(line)}" target="_blank">${esc(t('chat.openLine'))} →</a>
        <p class="muted" style="font-size:12px;margin-top:10px">${esc(t('chat.lineNote'))}</p></div>${verTag()}`;
  };
  function bubble(c){ const me=c.SenderRole==='Parent'; return `<div style="display:flex;justify-content:${me?'flex-end':'flex-start'};margin:6px 0"><div style="max-width:80%;background:${me?'#e3f2fd':'#f1f1f1'};padding:8px 12px;border-radius:12px"><div style="font-size:11px;color:#888">${esc(c.SenderName||c.SenderRole)}</div><div style="font-size:14px">${esc(c.Message)}</div><div class="muted" style="font-size:10px;text-align:right">${esc(c.Timestamp)}</div></div></div>`; }
  window.P_send=async(sid)=>{ const v=$('#msg').value.trim(); if(!v)return; await api('addComment',{studentId:sid,parentId:USER.parentId,senderRole:'Parent',senderName:USER.nameEN,message:v}); SCREENS.Parent.chat(); };

  // ================= TEACHER =================
  // a teacher/leader may cover several classes; T_CLASS is the one currently in view (undefined = default)
  window.T_CLASS = window.T_CLASS || undefined;
  const tc = () => ({ staffId:USER.staffId, className: window.T_CLASS });
  // a switcher bar shown only when the staff covers more than one class
  function classSwitcher(cl){ const list=(cl&&cl.classes)||[]; if(list.length<2) return '';
    const cur=(cl.class&&cl.class.ClassName); const scr=CURRENT;
    return `<div class="clsw" style="display:flex;gap:6px;overflow-x:auto;padding:2px 0 8px">${list.map(c=>`<button class="btn sm ${c.className===cur?'':'outline'}" onclick="T_pickClass('${esc(c.className)}','${esc(scr)}')">${esc(c.className)}</button>`).join('')}</div>`; }
  window.T_pickClass = (name,scr)=>{ window.T_CLASS=name; GO(scr||'class'); };
  // teacher home attendance card — today's มา/ลา/ขาด per covered class + check-in-on-behalf for absentees
  function tcaHtml(d){ if(!d||!d.classes||!d.classes.length) return '';
    const cards=d.classes.map(c=>{ const present=c.in+c.out; const pct=c.total?Math.round(present/c.total*100):100;
      const inb=(c.students||[]).filter(s=>s.status==='IN'||s.status==='OUT');
      const lv=(c.students||[]).filter(s=>s.status==='LEAVE');
      const ab=(c.students||[]).filter(s=>s.status==='ABSENT');
      return `<div style="margin-bottom:12px"><div class="spread"><b>${esc(c.className)}</b><span style="font-weight:700;color:${pctColor(pct)}">${pct}% <small class="muted" style="font-weight:400">(${present}/${c.total})</small></span></div>
        <div style="height:6px;background:#eee;border-radius:4px;overflow:hidden;margin:4px 0"><div style="height:100%;width:${pct}%;background:${pctColor(pct)}"></div></div>
        ${inb.length?`<div><span class="pill ok">✅ ${EN()?'in':'มา'} (${inb.length})</span> <small class="muted">${inb.map(s=>esc(dnick(s))+(s.in?' '+esc(s.in):'')).join(', ')}</small></div>`:''}
        ${lv.length?`<div style="margin-top:2px"><span class="pill wait">🌴 ${EN()?'leave':'ลา'} (${lv.length})</span> <small class="muted">${lv.map(s=>esc(dnick(s))).join(', ')}</small></div>`:''}
        ${ab.length?`<div style="margin-top:4px"><span class="pill bad">⛔ ${EN()?'absent':'ขาด'} (${ab.length})</span> <small class="muted">${EN()?'tap to check in':'แตะเพื่อเช็คอินแทน'}</small><br>${ab.map(s=>`<button class="btn sm outline" style="margin:3px 3px 0 0" onclick="T_studentCheckin('${s.studentId}','${esc(dnick(s))}')">📍 ${esc(dnick(s))}</button>`).join('')}</div>`:''}
        ${!lv.length&&!ab.length&&c.total?`<small style="color:#2e7d32">✓ ${EN()?'All present':'มาครบทุกคน'}</small>`:''}</div>`; }).join('');
    const ts=d.classes.reduce((a,c)=>{a.p+=c.in+c.out;a.t+=c.total;return a;},{p:0,t:0}); const tp=ts.t?Math.round(ts.p/ts.t*100):100;
    return `<div class="card"><div class="spread"><h3>👶 ${EN()?'Class attendance today':'การมาเรียนวันนี้'}</h3><b style="color:${pctColor(tp)}">${tp}% <small class="muted" style="font-weight:400">(${ts.p}/${ts.t})</small></b></div>
      <p class="muted" style="font-size:11.5px">${d.seeAll?(EN()?'All classes (head teacher)':'ทุกชั้นเรียน (หัวหน้าครู)'):(EN()?'Your class(es) only':'เฉพาะชั้นที่ดูแล')}</p>
      ${cards}</div>`; }
  SCREENS.Teacher.home = async () => {
    const [att,recent,cl,quota,me0raw,jstat] = await Promise.all([api('myAttendanceToday',{staffId:USER.staffId}),api('recentAttendance',{staffId:USER.staffId}),api('classList',tc()),api('leaveQuota',{staffId:USER.staffId}),api('staffSelf',{staffId:USER.staffId}),api('journalStatus',{})]);
    const jdone = journalDoneMap(jstat);
    const me0=me0raw||{};
    if(me0.MustChangePassword){ T_changePw(true); return; } // force password change on first login
    const isLeader = me0.PositionLevel==='Leader' || me0.Role==='Leader' || USER.role==='Leader';
    const canOrg = !!me0.CanClassOrg || isLeader;   // may use the drag class-organize tool (admin-granted)
    // a manually-requested time (ขอลงเวลา, approved) shows blue+bold to distinguish it from a normal GPS clock-in
    const mtime=(v,manual)=>manual?`<b style="color:#1565C0" title="${EN()?'manual (requested)':'ขอลงเวลา'}">${v||'--:--'} •</b>`:`<b>${v||'--:--'}</b>`;
    const recentRows = recent.map((a,i)=>`<div class="list-item"><span>${i===0?'<b>'+esc(t('c.today'))+'</b>':esc(ddmmyyyy(a.date))}</span><span style="font-size:13px">${esc(t('lbl.checkIn'))} ${mtime(a.checkIn,a.manualIn)} · ${esc(t('lbl.checkOut'))} ${mtime(a.checkOut,a.manualOut)} · ${a.late?`<span class="pill bad">${esc(t('lbl.late'))} ${a.late} ${esc(t('lbl.min'))}</span>`:`<span class="pill ok">${esc(t('lbl.onTime'))}</span>`}</span></div>`).join('');
    app.innerHTML = `<h2 class="page">${esc(t('t.greeting'))}${esc(EN()?USER.nameEN:USER.nameTH)} 👩‍🏫</h2>
      <div class="card"><h3>⏱️ ${esc(t('lbl.worktime'))} (${esc(att.date)})</h3>
        ${me0.RequireCheckin===false?`<div style="background:#eef6ff;border-radius:8px;padding:8px;color:#1565C0;font-size:13px">ℹ️ ${esc(t('ci.notRequired'))}</div>`:`
        <div class="spread" style="font-size:15px"><span>${esc(t('lbl.checkIn'))} ${mtime(att.checkIn,att.manualIn)}</span><span>${esc(t('lbl.checkOut'))} ${mtime(att.checkOut,att.manualOut)}</span><span>${esc(t('lbl.late'))} <b style="color:${att.late?'#c62828':'#2e7d32'}">${att.late||0}</b> ${esc(t('lbl.min'))}</span></div>
        <div class="row" style="margin-top:12px;gap:10px"><button class="btn green" ${att.checkIn?'disabled':''} style="flex:1;padding:18px;font-size:18px;font-weight:700${att.checkIn?';opacity:.45;cursor:not-allowed':''}" onclick="T_punch('in',this)">🟢 ${att.checkIn?(EN()?'Checked in ':'เข้างานแล้ว ')+esc(att.checkIn):esc(t('lbl.checkIn'))}</button><button class="btn pink" ${att.checkOut?'disabled':''} style="flex:1;padding:18px;font-size:18px;font-weight:700${att.checkOut?';opacity:.45;cursor:not-allowed':''}" onclick="T_punch('out',this)">🔴 ${att.checkOut?(EN()?'Checked out ':'เลิกงานแล้ว ')+esc(att.checkOut):esc(t('lbl.checkOut'))}</button></div>
        <div style="margin-top:10px"><b style="font-size:13px">📅 ${esc(t('lbl.recentDays'))}</b>${recentRows}</div>`}</div>
      <div id="tcatt"></div>
      <div class="card"><h3>📩 การลาของฉัน · สิทธิคงเหลือ</h3>
        <div class="quota">${quota.map(q=>`<div class="q"><div class="n">${q.remain}</div><div class="l">${esc(q.type)}<br>${q.used}/${q.quota}</div></div>`).join('')}</div>
        <div id="ml" style="margin-top:8px"></div><button class="btn sm outline" style="margin-top:6px" onclick="GO('leave')">+ ยื่น/ดูใบลา</button></div>
      ${isLeader?`<div class="card"><div class="spread"><h3>⭐ คำขอลาของลูกน้อง (รออนุมัติ)</h3></div><div id="tp"></div></div>`:''}
      <div class="card"><h3>${esc(t('ot.myOT'))}</h3><div id="myot"></div></div>
      ${isLeader?`<div class="card"><h3>${esc(t('ot.teamOT'))}</h3><div id="teamot"></div></div>`:''}
      ${isLeader?`<div class="card"><div class="spread"><h3>${esc(t('corg.title'))}</h3><button class="btn sm" onclick="T_classOrg()">🔁 ${esc(t('corg.manage'))}</button></div><small class="muted">${esc(t('corg.leaderNote'))}</small><div id="myccr" style="margin-top:8px"></div></div>`:''}
      <div class="card"><div class="row"><button class="btn sm outline" onclick="GO('absence')">🔎 ${esc(t('abs.title'))}</button>
        <button class="btn sm outline" onclick="T_studentOT()">⏰ ${EN()?'Student OT (follow-up)':'OT นักเรียน (ติดตามชำระ)'}</button>
        ${canOrg?`<button class="btn sm outline" onclick="T_organize()">🔁 ${EN()?'Organize classes':'จัดชั้นเรียน'}</button>`:''}</div></div>
      <div class="card"><div class="spread"><h3>👶 ${esc(cl.class.ClassName)}</h3><span class="muted">${cl.students.length} ${EN()?'kids':'คน'}</span></div>${classSwitcher(cl)}
        ${cl.students.map(s=>`<div class="list-item"><span>${studentAvatar(s)} <b>${esc(dispNick(s))}</b> ${journalPill(jdone[s.StudentID])}</span><span><button class="btn sm outline" onclick="T_journal('${s.StudentID}')">${esc(journalBtnLabel(jdone[s.StudentID]))}</button> <button class="btn sm outline" onclick="T_assess('${s.StudentID}')">${esc(t('lbl.assess'))}</button></span></div>`).join('')}</div>`;
    const tca=await api('teacherClassAttendance',{staffId:USER.staffId}); setHTML('#tcatt', tcaHtml(tca));
    const ml=await api('myLeaves',{staffId:USER.staffId}); setHTML('#ml', ml.map(leaveRow).join('')||'<small class="muted">ยังไม่มีรายการ</small>');
    const myot=await api('myOT',{staffId:USER.staffId}); setHTML('#myot', myot.map(otRow).join('')||`<small class="muted">${esc(t('ot.none'))}</small>`);
    if(isLeader){ const tp=await api('teamPendingLeaves',{staffId:USER.staffId}); setHTML('#tp', tp.map(l=>teamLeaveRow(l)).join('')||'<small class="muted">ไม่มีคำขอรออนุมัติ</small>');
      const to=await api('teamPendingOT',{staffId:USER.staffId}); setHTML('#teamot', to.map(otApproveRow).join('')||`<small class="muted">${esc(t('ot.none'))}</small>`);
      const ccr=await api('myClassChanges',{staffId:USER.staffId}); setHTML('#myccr', ccr.slice(0,4).map(ccrRow).join('')||`<small class="muted">${esc(t('corg.noReq'))}</small>`); }
  };
  // OT status badge + row renderers (shared)
  // a blank Status is a legacy pre-workflow OT row → treat it as approved
  const otStatusPill = st => { const k=String(st||'').toUpperCase()||'APPROVED'; const cls=k==='APPROVED'?'ok':(k==='REJECTED'?'bad':'wait');
    return `<span class="pill ${cls}">${esc(t('ot.st.'+k)||k)}</span>`; };
  function otRow(o){ return `<div class="list-item"><span>${esc(ddmmyyyy(o.Date))} · <b>${o.Hours} ${EN()?'h':'ชม.'}</b> ${esc(baht(o.Amount))}${o.Minutes?` <small class="muted">(${esc(hmMin(o.Minutes))})</small>`:''}</span>${otStatusPill(o.Status)}</div>`; }
  // leader approval row (approve / reject)
  function otApproveRow(o){ return `<div class="list-item"><span><b>${esc(dnick(o))}</b> · ${esc(ddmmyyyy(o.Date))} · ${o.Hours} ${EN()?'h':'ชม.'} ${esc(baht(o.Amount))}<br><small class="muted">${esc(o.PlanOut||'')}→${esc(o.ActualOut||'')} (${esc(hmMin(o.Minutes))})</small></span><span class="row"><button class="btn sm green" onclick="T_approveOT('${o.OTRecordID}','approve')">✔</button><button class="btn sm pink" onclick="T_approveOT('${o.OTRecordID}','reject')">✕</button></span></div>`; }
  window.T_approveOT=async(otId,decision)=>{ try{ await api('approveOT',{staffId:USER.staffId,otId,decision}); toast(decision==='approve'?(EN()?'Approved':'อนุมัติแล้ว'):(EN()?'Rejected':'ปฏิเสธแล้ว')); GO('home'); }catch(e){err(e);} };
  // Teacher OT follow-up: outstanding student OT (own class only; head teacher sees all) → chase or attach a slip on behalf.
  window.T_studentOT=async()=>{ const d=await api('teacherStudentOtList',{staffId:USER.staffId});
    const stLbl=st=>({UNPAID:EN()?'unpaid':'ค้างชำระ',PENDING_VERIFY:EN()?'pending':'รอตรวจ',PARTIAL:EN()?'partial':'บางส่วน',PAID:EN()?'paid':'ชำระแล้ว',CANCELLED:EN()?'cancelled':'ยกเลิก'}[st]||st);
    const stPill=st=>({UNPAID:'bad',PENDING_VERIFY:'wait',PARTIAL:'wait',PAID:'ok',CANCELLED:'info'}[st]||'info');
    const stud=g=>`<div class="card" style="padding:8px">
      <div class="spread"><b>${esc((EN()?(g.nickEN||g.nick||g.nameEN):(g.nick||g.name))||g.studentId)}</b>
        <span class="pill ${g.outstanding>0?'bad':'ok'}">${g.outstanding>0?(EN()?'owes ':'ค้าง ')+baht(g.outstanding):(EN()?'clear':'ครบแล้ว')}</span></div>
      <small class="muted">${esc(g.class||'')}</small>
      ${g.items.map(o=>{ const closed=o.status==='PAID'||o.status==='CANCELLED';
        return `<div class="list-item"><span>${esc(String(o.date).slice(0,10))} · ${esc(String(o.pickupTime||'').slice(0,5))} <small class="muted">(${EN()?'leave':'เลิก'} ${esc(o.planEnd||'-')})</small><br>
          <b>${baht(o.amount)}</b> <span class="pill ${stPill(o.status)}" style="font-size:10px">${esc(stLbl(o.status))}</span>${o.submitted>0&&o.status!=='PAID'?` <small class="muted">(${EN()?'slip sent':'ส่งสลิปแล้ว'})</small>`:''}</span>
          ${closed?'':`<button class="btn sm" onclick="T_payOT('${esc(o.otId)}',${o.outstanding||o.amount})">📎 ${EN()?'Add slip':'แนบสลิป'}</button>`}</div>`; }).join('')}</div>`;
    modal(`<h3>⏰ ${EN()?'Student OT — follow-up':'OT นักเรียน — ติดตามชำระ'}</h3>
      <p class="muted" style="font-size:12px">${d.seeAll?(EN()?'All classes (head teacher).':'ทุกชั้นเรียน (หัวหน้าครู)'):(EN()?'Your class only.':'เฉพาะชั้นเรียนที่ดูแล')} ${EN()?'Total outstanding':'ยอดค้างรวม'} <b>${baht(d.totalOutstanding)}</b></p>
      <div style="max-height:64vh;overflow:auto">${(d.students||[]).length?d.students.map(stud).join(''):`<div class="card muted">${EN()?'No OT to follow up':'ไม่มีรายการ OT ค้างชำระ'}</div>`}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.T_payOT=(otId,amt)=>{ const x=document.querySelector('.modal'); if(x)x.remove(); P_slip(otId,amt,'teacherOt'); };
  window.T_punch=async(kind,btn)=>{ if(btn){ btn.disabled=true; btn.style.opacity='.45'; btn.style.cursor='not-allowed'; }  // prevent double-tap immediately
    try{ const {lat,lng}=await getPosition();
      const r=await api(kind==='in'?'staffCheckin':'staffCheckout',{staffId:USER.staffId,lat,lng}); toast(kind==='in'?`✅ ${t('lbl.checkIn')} ${r.time}${r.lateMinutes>0?` (${t('lbl.late')} ${r.lateMinutes} ${t('lbl.min')})`:' ('+t('lbl.onTime')+')'}`:`✅ ${t('lbl.checkOut')} ${r.time}${r.otHours>0?` · OT ${hmHours(r.otHours)}${r.otPay?' ≈ '+baht(r.otPay):''}`:''}`); GO('home'); }
    catch(e){ err(e); if(btn){ btn.disabled=false; btn.style.opacity=''; btn.style.cursor=''; } } };  // re-enable on error (GO('home') re-renders disabled on success)

  // daily-report badge — journalStatus returns every student with an entry for `date` + its DRAFT/SUBMITTED state
  function journalDoneMap(st){ const m={}; ((st&&st.done)||[]).forEach(d=>{ m[d.studentId]=d; }); return m; }
  // journalStatus returns `submittedAt`; getJournal returns the raw row (`SubmittedAt`)
  const jTime = d => { const s=String((d&&(d.submittedAt||d.SubmittedAt))||''); return s.length>=16 ? s.slice(11,16) : ''; };
  const jIsDraft = d => !!d && String(d.status||d.Status||'').toUpperCase()==='DRAFT';
  function journalPill(d){
    if(!d) return `<span class="pill wait">⏳ ${esc(t('jr.notSent'))}</span>`;
    if(jIsDraft(d)) return `<span class="pill info">📝 ${esc(t('jr.draft'))}</span>`;
    const tm=jTime(d); return `<span class="pill ok">✅ ${esc(t('jr.sent'))}${tm?' '+esc(tm):''}</span>`; }
  // no entry → write it; draft → keep editing; submitted → read-only
  const journalBtnLabel = d => !d ? t('lbl.record') : (jIsDraft(d) ? t('jr.edit') : t('jr.view'));

  SCREENS.Teacher.class = async () => {
    const [cl,jstat]=await Promise.all([api('classList',tc()),api('journalStatus',{})]);
    const jdone=journalDoneMap(jstat);
    app.innerHTML=`<h2 class="page">👶 ${esc(cl.class.ClassName)}</h2>${classSwitcher(cl)}`+cl.students.map(s=>{
      // the journal can only be filled once the child is checked IN today (unless one already exists)
      const canJ = s.inToday || !!jdone[s.StudentID];
      const jBtn = canJ
        ? `<button class="btn sm ${jdone[s.StudentID]?'outline':''}" onclick="T_journal('${s.StudentID}')" title="${esc(journalBtnLabel(jdone[s.StudentID]))}">${!jdone[s.StudentID]?'📒':(jIsDraft(jdone[s.StudentID])?'✏️':'👁️')}</button>`
        : `<button class="btn sm outline" disabled style="opacity:.45" title="${EN()?'Check the child in first':'เช็คอินนักเรียนก่อนจึงจะบันทึกได้'}">📒</button>`;
      const bothDone = s.inToday && s.outToday;
      const ciBtn = bothDone
        ? `<button class="btn sm green" disabled style="opacity:.45" title="${EN()?'In & out already recorded':'เช็คอิน-เอาท์ครบแล้ววันนี้'}">📍</button>`
        : `<button class="btn sm green" onclick="T_studentCheckin('${s.StudentID}','${esc(nm(s))}',${s.inToday?1:0},${s.outToday?1:0})" title="${EN()?'Check in/out on behalf':'เช็คอิน/เอาท์แทน'}">📍</button>`;
      const attTag = s.inToday?`<small class="pill ok" style="margin-left:4px">${EN()?'in':'มา'} ${esc(s.inTime||'')}</small>`:'';
      return `<div class="card spread"><div style="display:flex;gap:10px;align-items:center">${studentAvatar(s)}<div><b>${esc(dispNick(s))}</b> <small class="muted">${esc(nm(s))}</small>${attTag}<br><small class="muted">${esc(ageYM(s.DOB))} · ${EN()?'allergy':'แพ้'}: ${esc(s.Allergy||'-')}</small><br>${journalPill(jdone[s.StudentID])}</div></div><div class="row">${jBtn}<button class="btn sm outline" onclick="T_assess('${s.StudentID}')">📝</button>${ciBtn}<button class="btn sm outline" onclick="T_studentLeave('${s.StudentID}','${esc(dispNick(s))}')" title="${EN()?'File leave for this student':'แจ้งลาให้นักเรียน'}">🏖️</button></div></div>`; }).join(''); };
  // Teacher files a leave for a student → notifies the linked parents; shows in that student's parent calendar
  window.T_studentLeave=(sid,name)=>{ modal(`<h3>🏖️ ${EN()?'File student leave':'แจ้งลานักเรียน'} — ${esc(name)}</h3>
    <label class="field"><span>${EN()?'Type':'ประเภท'}</span><select id="tslType"><option>${EN()?'Sick leave':'ลาป่วย'}</option><option>${EN()?'Personal leave':'ลากิจ'}</option><option>${EN()?'Absent':'ขาด'}</option></select></label>
    <label class="field"><span>${esc(t('inj.date'))}</span><input type="date" id="tslDate" value="${todayStr()}"/></label>
    <label class="field"><span>${EN()?'Reason':'เหตุผล'}</span><textarea id="tslReason" placeholder="${EN()?'reason…':'เหตุผล...'}"></textarea></label>
    <button class="btn block" onclick="T_studentLeaveDo('${sid}',this)">${EN()?'Notify parents':'แจ้งผู้ปกครอง'}</button>`); };
  window.T_studentLeaveDo=async(sid,btn)=>{ const m=btn.closest('.modal'); const g=x=>{const e=m.querySelector('#'+x);return e?e.value:'';};
    btn.disabled=true; try{ await api('teacherStudentLeave',{staffId:USER.staffId,studentId:sid,date:g('tslDate'),type:g('tslType'),reason:g('tslReason')}); m.remove(); confirmSaved(EN()?'Leave filed — parents notified':'แจ้งลาแล้ว — แจ้งผู้ปกครอง'); }catch(e){err(e);btn.disabled=false;} };
  // Teacher checks a student in/out on behalf of a pickup person who isn't a registered parent.
  // The ACTUAL time and the remark (who it was) are BOTH mandatory — Save stays disabled until filled.
  // inDone/outDone fade the type that's already recorded so it can't be double-entered.
  window.T_studentCheckin=(sid,name,inDone,outDone)=>{ inDone=!!inDone; outDone=!!outDone;
    const nowHM=(()=>{const d=new Date();return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');})();
    SC_TYPE = inDone ? 'OUT' : 'IN';
    modal(`<h3>📍 ${EN()?'Check in / out for':'เช็คอิน-เอาท์แทน'} ${esc(name)}</h3>
    <p class="muted" style="font-size:12px">${EN()?'Record the REAL drop-off / pick-up time. Time + remark are required.':'บันทึกเวลาจริงที่มารับ-ส่ง · ต้องกรอกเวลาจริงและหมายเหตุเสมอ'}</p>
    <div class="seg"><button class="${SC_TYPE==='IN'?'active':''}" id="scIN" ${inDone?'disabled style="opacity:.4"':`onclick="T_scType('IN')"`}>${EN()?'Drop off (IN)':'ส่งเข้าเรียน (IN)'}${inDone?' ✓':''}</button><button class="${SC_TYPE==='OUT'?'active':''}" id="scOUT" ${outDone?'disabled style="opacity:.4"':`onclick="T_scType('OUT')"`}>${EN()?'Pick up (OUT)':'รับกลับ (OUT)'}${outDone?' ✓':''}</button></div>
    <label class="field"><span>${EN()?'Actual time (required)':'เวลาจริง (บังคับ)'}</span>
      <input type="time" id="scTime" value="${nowHM}" oninput="T_scCheck()"/></label>
    <label class="field"><span>${EN()?'Remark — who dropped off / picked up? (required)':'หมายเหตุ — ใครมารับ-ส่ง? (บังคับ)'}</span>
      <textarea id="scRemark" placeholder="${EN()?'e.g. Grandmother Somsri, phone 08x-xxx-xxxx':'เช่น คุณยายสมศรี เบอร์ 08x-xxx-xxxx'}" oninput="T_scCheck()"></textarea></label>
    <button class="btn block green" id="scSave" disabled onclick="T_studentCheckinDo('${sid}',this)">💾 ${EN()?'Save':'บันทึก'}</button>
    <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`); };
  let SC_TYPE='IN';
  window.T_scType=(v)=>{ SC_TYPE=v; const i=document.getElementById('scIN'),o=document.getElementById('scOUT'); if(i)i.classList.toggle('active',v==='IN'); if(o)o.classList.toggle('active',v==='OUT'); };
  window.T_scCheck=()=>{ const r=document.getElementById('scRemark'), tm=document.getElementById('scTime'), b=document.getElementById('scSave');
    if(b) b.disabled = !(r && r.value.trim() && tm && /^\d{1,2}:\d{2}$/.test(tm.value)); };
  window.T_studentCheckinDo=async(sid,btn)=>{ const m=btn.closest('.modal'); const remark=(m.querySelector('#scRemark').value||'').trim();
    const time=(m.querySelector('#scTime').value||'').trim();
    if(!time){ toast(EN()?'Time is required':'ต้องกรอกเวลาจริงก่อน'); return; }
    if(!remark){ toast(EN()?'Remark is required':'ต้องกรอกหมายเหตุก่อน'); return; }
    btn.disabled=true;
    try{ const r=await api('staffStudentCheckin',{staffId:USER.staffId,studentId:sid,type:SC_TYPE,remark,time});
      m.remove(); confirmSaved(`✅ ${SC_TYPE==='IN'?(EN()?'Dropped off':'ส่งเข้าเรียน'):(EN()?'Picked up':'รับกลับ')} ${r.time}`);
      if(r.ot) toast(`⏰ ${EN()?'Late pickup OT':'OT รับช้า'} ${baht(r.ot.amount)}`);
      // re-render so the journal unlocks + the check-in button fades for this child
      try{ if(SCREENS[USER.role]&&SCREENS[USER.role][CURRENT]) SCREENS[USER.role][CURRENT](); }catch(_){}
    }catch(e){ err(e); btn.disabled=false; } };

  SCREENS.Teacher.journal = async () => { const cl=await api('classList',tc()); T_journal(cl.students[0].StudentID); };
  let JSEL={};
  // an Admin reaches this form from A_journals, where the student is outside their own class
  const J_isAdmin = () => USER.role==='Admin';
  window.J_exit = () => { if(J_isAdmin()){ GO('manage'); setTimeout(()=>A_journals(),120); } else GO('class'); };
  window.T_journal = async (sid) => { if(!J_isAdmin()) setNav('class'); JSEL={Mood:'',Health:'',Water:'',Meals:{},Toilet:{},Activity:new Set(),Skills:new Set()};
    // role lets the engine hand a DRAFT to staff (a parent gets null until it is submitted)
    const [cl,j]=await Promise.all([api('classList',tc()),api('getJournal',{studentId:sid,role:USER.role})]);
    const s=cl.students.find(x=>x.StudentID===sid)||(A_CACHE.students||[]).find(x=>x.StudentID===sid)||{NameTH:sid};
    const sent=jTime(j), draft=jIsDraft(j), jv=journalValues(j);

    // once submitted the entry is final — show it read-only rather than a form that cannot save
    if(j && !draft){ app.innerHTML=`<button class="btn sm outline backbtn" onclick="J_exit()">${t('c.back')}</button>
      <h2 class="page">📒 ${esc(nm(s))}</h2>
      <div class="card" style="background:#e8f5e9;color:#2e7d32;font-size:13px">🔒 ${esc(t('jr.locked'))}${sent?` · ${esc(t('jr.sent'))} ${esc(sent)}`:''}</div>
      ${journalChecklist(j)}`; window.scrollTo(0,0); return; }

    const seg=(group,arr,multi)=>arr.map(v=>`<button type="button" data-g="${esc(group)}" data-v="${esc(v)}" onclick="J_pick('${group}','${v.replace(/'/g,"\\'")}',this,${multi})">${esc(jt(v))}</button>`).join('');
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="J_exit()">${t('c.back')}</button><h2 class="page">${draft?'✏️':'📒'} ${esc(draft?t('jr.edit'):t('lbl.record'))} — ${esc(nm(s))}</h2><div class="card">
      <div style="background:#fff3e0;border-radius:8px;padding:8px;color:#e65100;font-size:13px;margin-bottom:8px">📝 ${esc(t('jr.draftHint'))}</div>
      <div class="jsec"><h4>😊 ${esc(jt('Mood'))} *</h4><div class="choice" id="g_Mood">${Object.keys(MOODS).map(m=>`<button type="button" data-g="Mood" data-v="${esc(m)}" onclick="J_pick('Mood','${m}',this,false)">${MOODS[m]} ${esc(jt(m))}</button>`).join('')}</div></div>
      <div class="jsec"><h4>❤️ ${esc(jt('Health'))}</h4><div class="choice">${seg('Health',HEALTHS,false)}</div>
        <div class="row" style="margin-top:6px"><input id="jHealthD" value="${esc(jv.healthDetail)}" placeholder="รายละเอียดสุขภาพ/ยา" style="flex:1"/><button class="micbtn" onclick="J_mic('jHealthD',this)">🎤</button></div></div>
      <div class="jsec"><h4>🍼 ${esc(jt('Milk & Water'))}</h4>
        <div class="row" style="gap:8px;align-items:center"><select id="jMilkUnit" style="flex:0 0 auto">${[['box',EN()?'Box':'กล่อง'],['oz','Oz.']].map(([u,l])=>`<option value="${u}" ${jv.milkUnit===u?'selected':''}>${esc(l)}</option>`).join('')}</select>
          <select id="jMilkQty" style="flex:1">${['',...Array.from({length:20},(_,i)=>i+1)].map(n=>`<option value="${n}" ${String(jv.milkQty)===String(n)?'selected':''}>${n||'-'}</option>`).join('')}</select></div>
        <div class="choice" style="margin-top:6px">${seg('Water',WATERS,false)}</div></div>
      <div class="jsec"><h4>🍽 ${esc(jt('Meals'))}</h4>${['Breakfast','Lunch','Dinner'].map(m=>`<div style="margin:4px 0"><b style="font-size:13px">${esc(jt(m))}:</b> <span class="choice" style="display:inline-flex">${MEAL_AMT.map(a=>`<button type="button" data-meal="${esc(m)}" data-v="${esc(a)}" onclick="J_meal('${m}','${a}',this)">${esc(jt(a))}</button>`).join('')}</span></div>`).join('')}</div>
      <div class="jsec"><h4>😴 ${esc(jt('Sleep'))}</h4><input id="jSleep" value="${esc(jv.sleep)}" placeholder="เช่น 12:30-14:00 (คั่นหลายช่วงด้วย ,)"/></div>
      <div class="jsec"><h4>🚽 ${esc(jt('Toileting'))}</h4>
        ${[['Urination',URI],['Bowel',BOWEL],['Stool',STOOL],['Training',TT]].map(([k,opts])=>`<div><b style="font-size:13px">${esc(jt(k==='Training'?'Toilet Training':k))}:</b> <span class="choice" style="display:inline-flex">${opts.map(x=>`<button type="button" data-tl="${esc(k)}" data-v="${esc(x)}" onclick="J_tl('${k}','${x}',this)">${esc(jt(x))}</button>`).join('')}</span></div>`).join('')}</div>
      <div class="jsec"><h4>🎨 ${esc(jt('Learning Journey'))}</h4><div class="choice">${seg('Activity',ACTS,true)}</div><input id="jTheme" value="${esc(jv.theme)}" placeholder="Theme / Topic" style="margin-top:6px"/></div>
      <div class="jsec"><h4>🌟 ${esc(jt('Skills'))}</h4><div class="choice">${seg('Skills',SKILLS,true)}</div></div>
      <div class="jsec"><h4>⭐ ${esc(jt('Highlight'))}</h4><div class="row"><textarea id="jHi" placeholder="เหตุการณ์น่าประทับใจ... (กดไมค์เพื่อพูด)" style="flex:1">${esc(jv.highlight)}</textarea><button class="micbtn" onclick="J_mic('jHi',this)">🎤</button></div></div>
      <button class="btn block outline" onclick="T_saveJournal('${sid}',false)">${esc(t('jr.saveDraft'))}</button>
      <button class="btn block green" style="margin-top:8px" onclick="T_saveJournal('${sid}',true)">${esc(t('jr.submit'))}</button></div>`;
    if(j) J_prefill(j);
  };
  // Re-select the choice buttons of an existing entry. Values are carried on data-g/data-meal/data-tl
  // + data-v so a saved record maps straight back onto the rendered buttons.
  const jArr = v => Array.isArray(v) ? v : [];
  const cssq = v => String(v).replace(/["\\]/g,'\\$&');
  function J_prefill(j){
    const mark=(sel)=>{ const el=document.querySelector(sel); if(el) el.classList.add('pass'); return el; };
    ['Mood','Health','Water'].forEach(g=>{ if(j[g]){ JSEL[g]=j[g]; mark(`[data-g="${g}"][data-v="${cssq(j[g])}"]`); } });
    ['Activity','Skills'].forEach(g=>jArr(j[g]).forEach(v=>{ JSEL[g].add(v); mark(`[data-g="${g}"][data-v="${cssq(v)}"]`); }));
    Object.keys(j.Meals||{}).forEach(m=>{ const a=j.Meals[m]; if(!a)return; JSEL.Meals[m]=a; mark(`[data-meal="${cssq(m)}"][data-v="${cssq(a)}"]`); });
    Object.keys(j.Toilet||{}).forEach(k=>{ const v=j.Toilet[k]; if(!v)return; JSEL.Toilet[k]=v; mark(`[data-tl="${cssq(k)}"][data-v="${cssq(v)}"]`); });
  }
  // text/number inputs are prefilled inline via value="" — flatten the record's shapes first
  function journalValues(j){ j=j||{};
    // milk is now qty + unit (box|oz). Legacy journals stored Milk as an oz array → derive the total.
    const mq = Array.isArray(j.Milk) ? (j.Milk.reduce((a,b)=>a+(+b||0),0)||'') : (j.Milk!=null&&j.Milk!==''?Number(j.Milk):(j.MilkTotal||''));
    return { healthDetail: j.HealthDetail||'', theme: j.Theme||'', highlight: j.Highlight||'',
      milkQty: mq===0?'':mq, milkUnit: j.MilkUnit || (Array.isArray(j.Milk)?'oz':'box'),
      sleep: jArr(j.Sleep).map(s=>`${s.from||''}-${s.to||''}`).filter(x=>x!=='-').join(', ') }; }
  window.J_pick=(g,v,el,multi)=>{ if(multi){ JSEL[g].has(v)?JSEL[g].delete(v):JSEL[g].add(v); el.classList.toggle('pass'); }
    else { JSEL[g]=v; [...el.parentElement.children].forEach(b=>b.classList.remove('pass')); el.classList.add('pass'); } };
  window.J_meal=(m,a,el)=>{ JSEL.Meals[m]=a; [...el.parentElement.children].forEach(b=>b.classList.remove('pass')); el.classList.add('pass'); };
  window.J_tl=(k,v,el)=>{ JSEL.Toilet[k]=v; [...el.parentElement.children].forEach(b=>b.classList.remove('pass')); el.classList.add('pass'); };
  window.J_mic=(targetId,btn)=>{ const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){ toast('เบราว์เซอร์นี้ไม่รองรับ Voice — ใช้ Chrome บนมือถือ/คอม'); return; }
    const rec=new SR(); rec.lang='th-TH'; rec.interimResults=false; btn.classList.add('rec'); btn.textContent='● ฟัง...';
    rec.onresult=e=>{ const t=e.results[0][0].transcript; const el=document.getElementById(targetId); el.value=(el.value?el.value+' ':'')+t; };
    rec.onerror=()=>toast('ฟังไม่สำเร็จ ลองใหม่'); rec.onend=()=>{ btn.classList.remove('rec'); btn.textContent='🎤'; }; rec.start(); };
  // submit=false saves a draft (parent not notified, still editable); submit=true sends it and locks it
  window.T_saveJournal=async(sid,submit)=>{
    if(submit && !confirm(t('jr.confirmSubmit'))) return;
    const milkQty=+($('#jMilkQty').value||0)||0; const milkUnit=$('#jMilkUnit').value||'box';
    const sleep=($('#jSleep').value||'').split(',').map(x=>x.trim()).filter(Boolean).map(s=>({from:(s.split('-')[0]||'').trim(),to:(s.split('-')[1]||'').trim()}));
    try{ const r=await api('submitJournal',{studentId:sid,staffId:USER.staffId,submit:!!submit,Mood:JSEL.Mood,Health:JSEL.Health,HealthDetail:$('#jHealthD').value,Milk:milkQty,MilkUnit:milkUnit,MilkTotal:milkQty,Water:JSEL.Water,Meals:JSEL.Meals,Sleep:sleep,Toilet:JSEL.Toilet,Activity:[...JSEL.Activity],Theme:$('#jTheme').value,Skills:[...JSEL.Skills],Highlight:$('#jHi').value});
      confirmSaved(r.submitted?(EN()?'Sent to the parent':'ส่งให้ผู้ปกครองแล้ว'):(EN()?'Draft saved — not sent yet':'บันทึกร่างแล้ว — ยังไม่ได้ส่ง')); J_exit(); }catch(e){err(e);} };

  // ===== injury / accident report (แบบบันทึกการบาดเจ็บรายบุคคล) — teacher & leader =====
  SCREENS.Teacher.injury = async () => {
    const [cl,recent]=await Promise.all([api('classList',tc()),api('injuryReports',{})]);
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
      <label class="field" style="display:flex;align-items:center;gap:8px;background:#fff3e0;border:1px solid #ffcc80;border-radius:10px;padding:10px"><input type="checkbox" id="injNotifyParent" style="width:auto"/> 👪 <b>${EN()?'Also notify the parent now (accident/emergency)':'แจ้งเตือนผู้ปกครองด้วยทันที (กรณีอุบัติเหตุ/ฉุกเฉิน)'}</b></label>
      <p class="muted" style="font-size:11.5px;margin:-2px 2px 6px">${EN()?'Admins & leaders are always alerted. Tick this to also LINE the parents right away.':'ระบบแจ้งแอดมิน/หัวหน้าครูทุกครั้งอยู่แล้ว · ติ๊กช่องนี้เพื่อส่ง LINE ถึงผู้ปกครองทันทีด้วย'}</p>
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
      place:rad('injPlace'),placeOther:v('#injPlaceOther'),injuryTypes:types,
      notifyParent:!!($('#injNotifyParent')&&$('#injNotifyParent').checked)});
      confirmSaved(t('inj.saved')); GO('injury'); }catch(e){err(e);} };

  SCREENS.Teacher.dspm = async () => { const cl=await api('classList',tc()); T_assess(cl.students[0].StudentID); };
  let ASEL={};
  window.T_assess = async (sid) => { setNav('class'); ASEL={};
    const due=await api('growthDue',{studentId:sid});
    let c; try{ c=await api('dspmStatus',{studentId:sid}); }catch(e){ app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('class')">${t('c.back')}</button><h2 class="page">📝 ประเมิน DSPM</h2><div class="card muted">${esc(e.message)}</div>`; return; }
    const s=(await api('classList',tc())).students.find(x=>x.StudentID===sid)||{NameTH:sid};
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
        ${photoField('guPhoto',t('growth.photo'),s.Photo,true)}</div>
      <button class="btn block" onclick="T_saveAssess('${sid}')">${esc(t('growth.saveBoth'))}</button>`;
  };
  window.A_set=(item,val)=>{ ASEL[item]=val; ['p','f','n'].forEach(pre=>{const el=document.getElementById(pre+item);if(el)el.classList.remove('pass','fail');});
    if(val==='pass')$('#p'+item).classList.add('pass'); if(val==='fail')$('#f'+item).classList.add('fail'); if(val==='nottested')$('#n'+item).classList.add('pass'); };

  // Group C: bi-monthly growth update (height/weight/photo). gate=true when blocking assessment.
  window.T_growthUpdate = async (sid, gate)=>{ setNav('class');
    const s=(await api('classList',tc())).students.find(x=>x.StudentID===sid)||{NameTH:sid};
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('class')">${t('c.back')}</button>
      <h2 class="page">📏 ${esc(t('growth.update'))} — ${esc(nm(s))}</h2>
      ${gate?`<div class="card" style="background:#fff8e1;border-color:#f0e3b0;color:#8a6d00">⚠️ ${esc(t('growth.gate'))}</div>`:''}
      <div class="card">
        <div style="text-align:center;margin-bottom:8px">${studentAvatar(s)}</div>
        <div class="grid2"><label class="field"><span>${esc(t('reg.weight'))} (kg)</span><input id="guW" type="number" value="${esc(s.Weight||'')}"/></label>
          <label class="field"><span>${esc(t('reg.height'))} (cm)</span><input id="guH" type="number" value="${esc(s.Height||'')}"/></label></div>
        ${photoField('guPhoto',t('growth.photo'),s.Photo,true)}
        <button class="btn block" onclick="T_growthSave('${sid}',${gate?'true':'false'})">${esc(t('c.save'))}</button></div>`;
  };
  window.T_growthSave = async (sid, gate)=>{ const w=+$('#guW').value||null, h=+$('#guH').value||null;
    if(!w||!h){toast(EN()?'Enter weight & height':'กรอกน้ำหนักและส่วนสูง');return;}
    const photo=photoVal(document,'guPhoto');
    try{ await api('updateGrowth',{studentId:sid,weight:w,height:h,photo}); confirmSaved(t('growth.saved'));
      if(gate) T_assess(sid); else GO('class'); }catch(e){err(e);} };
  window.T_saveAssess=async(sid)=>{ const results=Object.keys(ASEL).map(k=>({itemNo:Number(k),result:ASEL[k]}));
    // also persist the growth fields shown below the assessment (weight/height/photo)
    const w=+$('#guW').value||null, h=+$('#guH').value||null; const photo=photoVal(document,'guPhoto');
    if(!results.length && !(w&&h)){toast(EN()?'Assess at least 1 item or enter weight/height':'เลือกผลอย่างน้อย 1 ข้อ หรือกรอกน้ำหนัก/ส่วนสูง');return;}
    try{ if(results.length) await api('submitAssessment',{studentId:sid,staffId:USER.staffId,results});
      if(w&&h) await api('updateGrowth',{studentId:sid,weight:w,height:h,photo});
      confirmSaved(EN()?'Saved — parent notified':'บันทึกแล้ว — แจ้งผู้ปกครอง'); GO('class'); }catch(e){err(e);} };

  SCREENS.Teacher.leave = async () => {
    const [quota,me] = await Promise.all([api('leaveQuota',{staffId:USER.staffId}),api('staffSelf',{staffId:USER.staffId})]);
    const isLeader=(me&&(me.PositionLevel==='Leader'||me.Role==='Leader'))||USER.role==='Leader';
    app.innerHTML=`<h2 class="page">${esc(t('title.leave'))}</h2>
      <div class="card"><h3>สิทธิคงเหลือ</h3><div class="quota">${quota.map(q=>`<div class="q"><div class="n">${q.remain}</div><div class="l">${esc(q.type)} ${q.used}/${q.quota}</div></div>`).join('')}</div></div>
      <div class="card"><h3>ยื่นใบลา</h3>
        <label class="field"><span>ประเภท</span><select id="lType"><option>ลาป่วย</option><option>ลากิจ</option><option>ลาพักร้อน</option></select></label>
        <div class="grid2"><label class="field"><span>วันที่เริ่ม</span><input type="date" id="lStart" value="${todayStr()}"/></label><label class="field"><span>ถึงวันที่</span><input type="date" id="lEnd" value="${todayStr()}"/></label></div>
        <label class="field"><span>เหตุผล</span><textarea id="lReason"></textarea></label>
        ${photoField('lDoc',(EN()?'Attachment (medical cert / doc — optional)':'เอกสารแนบ (ใบรับรองแพทย์ ฯลฯ — ถ้ามี)'),'',false)}
        <button class="btn block" onclick="T_submitLeave()">ส่งคำขอ</button></div>
      <div class="card"><h3>📋 คำขอของฉัน</h3><div id="ml"></div></div>
      <div class="card"><h3>${esc(t('att.title'))}</h3>
        <p class="muted" style="font-size:12px">${EN()?'Forgot to clock in/out? Request a time — it goes to your leader then Admin.':'ลืมลงเวลา? ขอลงเวลาที่ต้องการ ระบบจะส่งให้หัวหน้าครูและแอดมินอนุมัติ'}</p>
        <div class="grid2"><label class="field"><span>${EN()?'Type':'ประเภท'}</span><select id="atType"><option value="IN">${esc(t('att.reqIn'))}</option><option value="OUT">${esc(t('att.reqOut'))}</option></select></label>
          <label class="field"><span>${EN()?'Date':'วันที่'}</span><input type="date" id="atDate" value="${todayStr()}"/></label></div>
        <div class="grid2"><label class="field"><span>${EN()?'Time':'เวลา'}</span><input type="time" id="atTime"/></label>
          <label class="field"><span>${esc(t('c.reason'))}</span><input id="atReason" placeholder="${EN()?'reason':'เหตุผล'}"/></label></div>
        <button class="btn block" onclick="T_submitTimeReq()">📤 ${esc(t('att.title'))}</button>
        <div id="atmine" style="margin-top:10px"></div></div>
      ${isLeader?`<div class="card"><h3>⭐ รออนุมัติ — คำขอของลูกน้อง</h3><div id="tp"></div></div>
      <div class="card"><h3>⭐ ${esc(t('att.teamReq'))} (${EN()?'pending':'รออนุมัติ'})</h3><div id="attp"></div></div>`:''}`;
    setHTML('#ml', (await api('myLeaves',{staffId:USER.staffId})).map(leaveRow).join('')||'<small class="muted">ยังไม่มี</small>');
    setHTML('#atmine', (await api('myTimeRequests',{staffId:USER.staffId})).map(timeReqRow).join('')||'<small class="muted">ยังไม่มี</small>');
    if(isLeader){ setHTML('#tp', (await api('teamPendingLeaves',{staffId:USER.staffId})).map(teamLeaveRow).join('')||'<small class="muted">ไม่มีคำขอรออนุมัติ</small>');
      setHTML('#attp', (await api('teamPendingTimeRequests',{staffId:USER.staffId})).map(timeReqApproveRow).join('')||'<small class="muted">ไม่มีคำขอรออนุมัติ</small>'); }
  };
  // manual attendance-time request row renderers + actions
  const timeTypeLabel = ty => String(ty).toUpperCase()==='IN'?(EN()?'Check-in':'เข้างาน'):(EN()?'Check-out':'เลิกงาน');
  const timeReqStatusPill = st => { const k=String(st||'PENDING_LEADER').toUpperCase(); const cls=k==='APPROVED'?'ok':(k==='REJECTED'?'bad':'wait'); return `<span class="pill ${cls}">${esc(t('att.st.'+k)||k)}</span>`; };
  function timeReqRow(r){ return `<div class="list-item"><span>${esc(timeTypeLabel(r.Type))} · <b style="color:#1565C0">${esc(r.RequestTime)}</b> · ${esc(ddmmyyyy(r.Date))}${r.Reason?`<br><small class="muted">${esc(r.Reason)}</small>`:''}</span>${timeReqStatusPill(r.Status)}</div>`; }
  function timeReqApproveRow(r){ return `<div class="list-item"><span><b>${esc(dnick(r))}</b> · ${esc(timeTypeLabel(r.Type))} <b style="color:#1565C0">${esc(r.RequestTime)}</b> · ${esc(ddmmyyyy(r.Date))}${r.Reason?`<br><small class="muted">${esc(r.Reason)}</small>`:''}</span><span class="row"><button class="btn sm green" onclick="T_approveTimeReq('${r.ReqID}','approve')">✔</button><button class="btn sm pink" onclick="T_approveTimeReq('${r.ReqID}','reject')">✕</button></span></div>`; }
  window.T_submitTimeReq=async()=>{ const type=$('#atType').value, date=$('#atDate').value, time=$('#atTime').value, reason=$('#atReason').value;
    if(!time){toast(EN()?'Pick a time':'เลือกเวลา');return;}
    try{ await api('submitTimeRequest',{staffId:USER.staffId,type,date,time,reason}); confirmSaved(t('corg.submitted')); GO('leave'); }catch(e){err(e);} };
  window.T_approveTimeReq=async(reqId,dec)=>{ try{ await api('approveTimeRequest',{staffId:USER.staffId,reqId,decision:dec}); toast(dec==='approve'?(EN()?'Approved (→Admin)':'อนุมัติ (ส่งต่อแอดมิน)'):(EN()?'Rejected':'ปฏิเสธแล้ว')); GO('leave'); }catch(e){err(e);} };
  window.T_submitLeave=async()=>{ const attachment=photoVal(document,'lDoc'); try{ const r=await api('submitLeave',{staffId:USER.staffId,type:$('#lType').value,startDate:$('#lStart').value,endDate:$('#lEnd').value,reason:$('#lReason').value,attachment}); toast(`✅ ส่งคำขอ ${r.leaveId} (${r.days} วัน)`); GO('leave'); }catch(e){err(e);} };
  window.T_teamApprove=async(id,dec)=>{ try{ const r=await api('approveLeave',{staffId:USER.staffId,leaveId:id,decision:dec}); toast(`✅ ${dec==='approve'?'อนุมัติ(ส่งต่อ Admin)':'ปฏิเสธ'} — ${r.status}`); GO('leave'); }catch(e){err(e);} };
  function leaveStatusPill(st){ const c={PENDING_LEADER:'wait',PENDING_ADMIN:'wait',APPROVED:'ok',REJECTED:'bad'}[st]||'info'; return `<span class="pill ${c}">${esc(tStat(st))}</span>`; }
  // display name for a leave row: nickname first (enriched l.nick/l.name), else staff-cache lookup
  const leaveName = l => (EN()?(l.nickEN||l.nick):(l.nick||l.nickEN)) || (EN()?(l.nameEN||l.name):(l.name||l.nameEN)) || staffNick(l.StaffID);
  // 📎 attachment link (medical cert / doc) if present
  const leaveDoc = l => l.Attachment ? ` <a href="${esc(l.Attachment)}" target="_blank" onclick="event.stopPropagation()">📎</a>` : '';
  function leaveRow(l){ return `<div class="list-item"><div><b>${esc(l.Type)}</b> ${esc(l.StartDate)}→${esc(l.EndDate)} (${l.Days}ว.)${leaveDoc(l)}<br><small class="muted">${esc(l.LeaveID)}${l.Step1ApproverName?' · ขั้น1: '+esc(l.Step1ApproverName)+(l.Step1CrossDept==='YES'?' (ข้ามแผนก)':''):''}${l.Step2ApproverName?' · ขั้น2: '+esc(l.Step2ApproverName):''}</small></div>${leaveStatusPill(l.Status)}</div>`; }
  function teamLeaveRow(l){ return `<div class="card" style="margin:8px 0"><div class="spread"><div><b>${esc(leaveName(l))}</b> <small class="muted">(${esc(l.Department)})</small><br>${esc(l.Type)} ${esc(l.StartDate)}→${esc(l.EndDate)} (${l.Days}ว.)${leaveDoc(l)}<br><small class="muted">${esc(l.Reason||'')}</small></div>${leaveStatusPill(l.Status)}</div><div class="row" style="margin-top:8px"><button class="btn sm green" onclick="T_teamApprove('${l.LeaveID}','approve')">อนุมัติ</button><button class="btn sm pink" onclick="T_teamApprove('${l.LeaveID}','reject')">ปฏิเสธ</button></div></div>`; }

  const firstName = s => (nm(s)||'').split(' ')[0];
  // opts: { shortName(staffId), holidays:[{Date,NameTH,NameEN}], leaves:[approved] } — never reads MOCK.staff
  // Teacher calendar: check-in/out times + holidays + Big Cleaning + leaves of ALL staff. Navigable (all months).
  function staffSchedCalendar(history, opts){ opts=opts||{};
    const shortName=opts.shortName||(id=>id);
    const render=()=>{ const b=calBase(),y=b.getFullYear(),mo=b.getMonth(); const now=new Date(); const isCur=CAL_OFF===0;
      const first=new Date(y,mo,1).getDay(),days=new Date(y,mo+1,0).getDate(); const byDay={};
      const holByDay={}; (opts.holidays||[]).forEach(h=>{ const d=new Date(h.Date); if(d.getFullYear()===y&&d.getMonth()===mo) holByDay[d.getDate()]=EN()?(h.NameEN||h.NameTH):(h.NameTH||h.NameEN); });
      const bcByDay={}; (opts.bigCleaning||[]).forEach(s=>{ const d=new Date(s); if(d.getFullYear()===y&&d.getMonth()===mo) bcByDay[d.getDate()]=1; });
      (history||[]).forEach(h=>{ const d=new Date(h.Date); if(d.getFullYear()===y&&d.getMonth()===mo){ const io=(h.In?'↓'+h.In:'')+(h.Out?' ↑'+h.Out:''); (byDay[d.getDate()]=byDay[d.getDate()]||[]).push(shortName(h.StaffID)+(io?' '+io:'')); } });
      // approved leaves of ALL staff overlapping each day → "Nickname (LeaveType)"
      (opts.leaves||[]).filter(l=>l.Status==='APPROVED').forEach(l=>{ const st=new Date(l.StartDate),en=new Date(l.EndDate); for(let dt=new Date(st); dt<=en; dt.setDate(dt.getDate()+1)){ if(dt.getFullYear()===y&&dt.getMonth()===mo){ (byDay[dt.getDate()]=byDay[dt.getDate()]||[]).push('🏠 '+shortName(l.StaffID)+' ('+tLeaveType(l.Type)+')'); } } });
      let cells=['อา','จ','อ','พ','พฤ','ศ','ส'].map(w=>`<div style="text-align:center;font-size:11px;color:#94a3b8">${EN()?({'อา':'Su','จ':'Mo','อ':'Tu','พ':'We','พฤ':'Th','ศ':'Fr','ส':'Sa'}[w]):w}</div>`).join('');
      for(let i=0;i<first;i++) cells+='<div class="d dim"></div>';
      for(let dd=1;dd<=days;dd++){ const ppl=byDay[dd]; const hol=holByDay[dd]; const bc=bcByDay[dd]; const today=(isCur&&dd===now.getDate())?'today':'';
        const holStyle=hol?'background:#ffebee;border-color:#ef9a9a;':(bc?'background:#e0f7fa;border-color:#80deea;':'');
        cells+=`<div class="d ${ppl?'ev':''} ${today}" style="min-height:64px;${holStyle}">${dd}`
          +(hol?`<span class="io" style="color:#c62828;text-align:left;font-weight:600">🏖️ ${esc(hol)}</span>`:'')
          +(bc&&!hol?`<span class="io" style="color:#00838f;text-align:left;font-weight:600">🧹 ${EN()?'Cleaning':'ทำความสะอาด'}</span>`:'')
          +(ppl?`<span class="io" style="color:#2e7d32;text-align:left">${esc(ppl.join('\n'))}</span>`:'')+`</div>`; }
      return `${calNavHeader(y,mo)}<div class="cal">${cells}</div><small class="muted">${EN()?'↓in ↑out · 🏖️ holiday · 🧹 cleaning · 🏠 on leave (all staff)':'↓เข้า ↑ออก · 🏖️ วันหยุด · 🧹 ทำความสะอาด · 🏠 ลา (พนักงานทุกคน)'}</small>`; };
    window._CALRENDER=render;
    return `<div class="card"><div id="calWrap">${render()}</div></div>`; }
  SCREENS.Teacher.schedule = async () => { const d=await api('schedule');
    const staffing=d.staffing||[];
    // staff directory comes from the API (MOCK.staff is empty in gas mode)
    const dir={}; (d.staff||[]).forEach(s=>{ dir[s.StaffID]=s; });
    const fullName=id=>{ const s=dir[id]; if(!s) return id; const n=nm(s)||id, k=nick(s); return k?`${n} (${k})`:n; };
    const shortName=id=>{ const s=dir[id]; if(!s) return String(id); return nick(s)||firstName(s)||nm(s)||String(id); };
    const ratioHtml = staffing.length?`<div class="card"><h3>👥 ${esc(t('lbl.staffingByNursery'))} (${esc(todayStr())})</h3>
      <div class="row">${staffing.map(x=>`<span class="pill ${x.present>=x.total?'ok':x.present>0?'wait':'bad'}" style="font-size:13px">${esc(x.dept)} ${x.present}/${x.total}</span>`).join('')}</div></div>`:'';
    app.innerHTML=`<h2 class="page">${esc(t('title.schedule'))}</h2>
      ${ratioHtml}
      ${staffSchedCalendar(d.history,{shortName,holidays:d.holidays,bigCleaning:d.bigCleaning,leaves:d.leavesToday})}
      <div class="card"><h3>📋 ${esc(t('lbl.dailySummary'))} (${esc(todayStr())})</h3>${d.attendance.map(a=>{const cls=a.Status==='IN'?'dot-in':a.Status==='OUT'?'dot-out':a.Status==='LEAVE'?'dot-leave':'dot-absent';return `<div class="att"><span class="dot-s ${cls}"></span> ${esc(fullName(a.StaffID))} — ${a.Status==='LEAVE'?(EN()?'Leave':'ลา')+' ('+esc(a.Reason||'')+')':a.Status+(a.CheckIn?' '+a.CheckIn:'')}</span></div>`;}).join('')||`<small class="muted">${esc(t('c.noItems'))}</small>`}
        <div style="margin-top:8px"><b style="font-size:13px">${EN()?'Approved leave (for coverage)':'การลาที่อนุมัติแล้ว (วางแผนสับเปลี่ยน)'}:</b>${d.leavesToday.map(l=>`<div class="list-item"><span>${esc(fullName(l.StaffID))} · ${esc(tLeaveType(l.Type))}</span><span class="muted">${esc(l.StartDate)}→${esc(l.EndDate)}</span></div>`).join('')||`<small class="muted">${esc(t('c.noItems'))}</small>`}</div></div>`;
  };

  let SLIP_UNLOCKED=false;
  SCREENS.Teacher.slip = async () => {
    if(!SLIP_UNLOCKED){ app.innerHTML=`<h2 class="page">💵 เงินเดือนของฉัน</h2>
      <div class="card" style="text-align:center"><div style="font-size:42px">🔒</div><p>ข้อมูลเงินเดือนเป็นความลับ — กรุณาใส่รหัสผ่านของคุณ</p>
      ${pwField('slipPw',t('lbl.password'),'')}
      <button class="btn block" onclick="T_slipUnlock()">${esc(t('lbl.openSlip'))}</button>
      <button class="btn-ghost block" style="margin-top:8px" onclick="T_changePw(false)">🔑 ${esc(t('pw.title'))}</button>
      <button class="btn-ghost block" style="margin-top:4px" onclick="T_forgotPw()">❓ ${EN()?'Forgot password':'ลืมรหัสผ่าน'}</button></div>`; return; }
    const month=monthStr(); let pay=await api('getPayslip',{staffId:USER.staffId,month}); if(!pay) pay=await api('computePayroll',{staffId:USER.staffId,month});
    app.innerHTML=`<h2 class="page">💵 เงินเดือนของฉัน</h2>
      <div class="seg"><span class="muted" style="align-self:center">งวด:</span><input type="month" id="slipMonth" value="${month}" style="width:auto" onchange="T_slipMonth(this.value)"/>
      <button class="btn sm outline" onclick="SLIP_LOCK()">🔒 ล็อก</button></div>
      <div id="slipBox">${payslipCard(pay)}</div>
      <button class="btn outline block" onclick="T_slipDownload()">⬇️ ${esc(t('lbl.downloadSlip'))}</button>`;
  };
  // staff/admin own profile (opened by tapping the header name/avatar)
  window.T_profile = async () => { setNav('home');
    const s = await api('staffSelf',{staffId:USER.staffId}) || {};
    const ro=(label,val)=>`<div class="list-item"><span class="muted" style="font-size:12.5px">${esc(label)}</span><span><b>${esc(val==null||val===''?'-':val)}</b></span></div>`;
    const f=(k,label,val,type)=>`<label class="field"><span>${esc(label)}</span><input id="sp_${k}" type="${type||'text'}" value="${esc(val==null?'':val)}"/></label>`;
    app.innerHTML=`<div class="spread"><h2 class="page">👤 ${EN()?'My info':'ข้อมูลของฉัน'}</h2><button class="btn sm outline" onclick="GO('home')">← ${esc(t('c.back'))}</button></div>
      <div class="card"><h3>${esc(nm(s)||USER.nameTH||'')}</h3>
        <div class="grid2">${f('NameEN',EN()?'Name (EN)':'ชื่อ-สกุล (อังกฤษ)',s.NameEN)}${f('Nickname',EN()?'Nickname':'ชื่อเล่น',s.Nickname)}</div>
        <div class="grid2">${f('Phone',EN()?'Phone':'เบอร์โทร',phoneFmt(s.Phone))}${f('DOB',EN()?'Date of birth':'วันเกิด',s.DOB,'date')}</div>
        <button class="btn block green" onclick="T_saveProfile(this)">💾 ${EN()?'Save':'บันทึก'}</button></div>
      <div class="card"><h3>ℹ️ ${EN()?'Employment info':'ข้อมูลการทำงาน'}</h3>
        <p class="muted" style="font-size:11.5px">${EN()?'Contact admin to change these.':'ต้องการแก้ไข ติดต่อแอดมิน'}</p>
        ${ro(EN()?'Name (TH)':'ชื่อ-สกุล (ไทย)',s.NameTH)}
        ${ro(EN()?'Position':'ตำแหน่ง',s.Position)}
        ${ro(EN()?'Level':'ระดับ',s.PositionLevel)}
        ${ro(EN()?'Department':'แผนก/Nursery',s.Department)}
        ${ro(EN()?'Staff group':'กลุ่มพนักงาน',(s.StaffGroup||'')+((s.GroupIn||s.GroupOut)?` (${s.GroupIn||'--'}–${s.GroupOut||'--'})`:''))}
        ${ro(EN()?'Check-in required':'ต้องลงเวลาเข้างาน',s.RequireCheckin?(EN()?'Yes':'ใช่'):(EN()?'No':'ไม่'))}
        ${ro(EN()?'Start date':'วันเข้าทำงาน',s.StartDate)}
        ${ro(EN()?'National ID':'เลขบัตรประชาชน',s.NationalID)}</div>
      <div class="card"><div class="row"><button class="btn sm outline" onclick="T_changePw(false)">🔑 ${esc(t('pw.title'))}</button><button class="btn sm outline" onclick="T_forgotPw()">❓ ${EN()?'Forgot password':'ลืมรหัสผ่าน'}</button></div></div>`;
    window.scrollTo(0,0); };
  window.T_saveProfile = async (btn)=>{ const g=k=>{ const e=document.getElementById('sp_'+k); return e?e.value.trim():undefined; };
    const data={ NameEN:g('NameEN'), Nickname:g('Nickname'), Phone:g('Phone'), DOB:g('DOB') };
    if(btn)btn.disabled=true;
    try{ await api('saveStaffSelf',{staffId:USER.staffId,data}); confirmSaved(t('c.saved')); }catch(e){err(e);}finally{ if(btn)btn.disabled=false; } };
  window.T_slipUnlock=async()=>{ const pw=$('#slipPw').value;
    try{ const r=await api('checkStaffPassword',{staffId:USER.staffId,password:pw}); if(r&&r.ok){ SLIP_UNLOCKED=true; GO('slip'); } else toast(EN()?'Wrong password':'รหัสผ่านไม่ถูกต้อง'); }catch(e){err(e);} };
  window.T_forgotPw=async()=>{ if(!confirm(EN()?'Send a password reset request to the admin?':'ส่งคำขอรีเซ็ตรหัสผ่านไปที่แอดมินใช่หรือไม่?'))return;
    try{ await api('requestPasswordReset',{staffId:USER.staffId}); toast(EN()?'Request sent to admin':'ส่งคำขอไปที่แอดมินแล้ว — แอดมินจะรีเซ็ตให้'); }catch(e){err(e);} };
  // teacher password change (forced on first login; validation 8-15 incl upper/lower/digit)
  window.T_changePw=async(forced)=>{ setNav('home');
    const me=await api('staffSelf',{staffId:USER.staffId}).catch(()=>null)||{};
    app.innerHTML=`<h2 class="page">🔑 ${esc(t('pw.title'))}</h2>
      <div class="card">${forced?`<div style="background:#fff8e1;border-radius:8px;padding:8px;color:#8a6d00;font-size:13px;margin-bottom:8px">⚠️ ${esc(t('pw.forced'))}</div>`:''}
        <p class="muted" style="font-size:12px">${esc(t('pw.user'))}: <b>${esc(me.NationalID||'')}</b></p>
        ${pwField('pwNew',t('pw.new'),'8-15 chars')}
        ${pwField('pwConfirm',t('pw.confirm'),'')}
        <p class="muted" style="font-size:11.5px">${esc(t('pw.rule'))}</p>
        <button class="btn block" onclick="T_changePwDo()">${esc(t('c.save'))}</button>
        <button class="btn-ghost block" style="margin-top:8px" onclick="T_forgotPw()">❓ ${EN()?'Forgot password':'ลืมรหัสผ่าน'}</button>
        ${forced?'':`<button class="btn-ghost block" style="margin-top:4px" onclick="GO('home')">${esc(t('c.back'))}</button>`}</div>`;
  };
  window.T_changePwDo=async()=>{ const a=$('#pwNew').value, b=$('#pwConfirm').value;
    if(a!==b){toast(EN()?'Passwords do not match':'รหัสผ่านไม่ตรงกัน');return;}
    try{ await api('changeStaffPassword',{staffId:USER.staffId,newPassword:a}); confirmSaved(t('c.saved')); GO('home'); }catch(e){err(e);} };
  window.SLIP_LOCK=()=>{ SLIP_UNLOCKED=false; GO('slip'); };
  window.T_slipMonth=async(m)=>{ let pay=await api('getPayslip',{staffId:USER.staffId,month:m}); if(!pay)pay=await api('computePayroll',{staffId:USER.staffId,month:m}); setHTML('#slipBox', payslipCard(pay)); };
  window.T_slipDownload=async(m)=>{ m=m||($('#slipMonth')&&$('#slipMonth').value)||monthStr(); let pay=await api('getPayslip',{staffId:USER.staffId,month:m}); if(!pay)pay=await api('computePayroll',{staffId:USER.staffId,month:m}); openOrDownload(buildSlipsHTML([pay],m), 'payslip-'+USER.staffId+'-'+m+'.html'); };
  function payslipCard(r){ return `<div class="card"><h3>สลิป ${esc(staffName(r.StaffID))} · ${esc(r.Month)}</h3>
    ${r.LeaveExceeds?`<div style="background:#fff3e0;border:1px solid #ffcc80;border-radius:8px;padding:6px 9px;margin-bottom:6px;color:#e65100;font-size:12.5px">⚠️ ลาเกิน ${r.LeaveLimit||3} วัน (ลารวม ${r.LeaveDays} วัน) — ไม่คำนวณเรทจำนวนเด็ก</div>`:''}
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
  const pctColor = p => p>=100?'#2e7d32':p>=90?'#f9a825':'#d50000'; // green / amber / red attendance
  SCREENS.Admin.home = async () => { const [d,rem,lrem,pend,fin]=await Promise.all([api('dashboard'),api('payrollReminderDue'),api('leaveResetReminder'),api('pendingPayments'),api('financeSummary',{})]);
    const pendN=pend.length;
    // ---- payment tracking (this month): monthly tuition + student OT collection ----
    const otDue=(fin.students||[]).reduce((a,s)=>a+Number(s.otOpen||0),0)+Number(fin.otCollected||0);
    const tuiPct = fin.studentsTotal?Math.round(fin.studentsPaid/fin.studentsTotal*100):100;
    const tuiOut = Number(fin.tuitionOutstanding||0);
    const payHtml=`<div class="card"><div class="spread"><h3>💰 ${EN()?'Payment tracking':'ติดตามการชำระเงิน'} <small class="muted">(${esc(fin.month||monthStr())})</small></h3><button class="btn sm outline" onclick="GO('finance')">${EN()?'Details':'รายละเอียด'}</button></div>
      <div class="spread" style="font-size:14px;margin-top:4px"><span>🏫 ${EN()?'Monthly tuition':'ค่าเทอมรายเดือน'}</span><b style="color:${pctColor(tuiPct)}">${fin.studentsPaid}/${fin.studentsTotal} <small class="muted" style="font-weight:400">(${tuiPct}%)</small></b></div>
      <div style="height:6px;background:#eee;border-radius:4px;overflow:hidden;margin:4px 0"><div style="height:100%;width:${tuiPct}%;background:${pctColor(tuiPct)}"></div></div>
      <div class="spread" style="font-size:13px"><span class="muted">${EN()?'Collected':'เก็บได้'} <b style="color:#2e7d32">${baht(fin.tuitionCollected||0)}</b></span><span class="muted">${EN()?'Outstanding':'ค้างชำระ'} <b style="color:${tuiOut>0?'#c62828':'#2e7d32'}">${baht(tuiOut)}</b></span></div>
      <hr style="border:none;border-top:1px solid #f0f0f0;margin:8px 0">
      <div class="spread" style="font-size:14px"><span>⏰ ${EN()?'Student OT':'OT นักเรียน'}</span><span class="muted">${EN()?'this month':'เดือนนี้'}</span></div>
      <div class="spread" style="font-size:13px"><span class="muted">${EN()?'Collected':'เก็บได้'} <b style="color:#2e7d32">${baht(fin.otCollected||0)}</b></span><span class="muted">${EN()?'Outstanding':'ค้างชำระ'} <b style="color:${(otDue-Number(fin.otCollected||0))>0?'#e65100':'#2e7d32'}">${baht(Math.max(0,otDue-Number(fin.otCollected||0)))}</b></span></div></div>`;
    const remHtml = rem.due?`<div class="card" style="background:#fff3e0;border-color:#ffcc80;color:#e65100"><div class="spread"><b>🔔 ${esc(t('admin.payrollReminder'))}</b><button class="btn sm" onclick="GO('payroll')">${esc(t('admin.goPayroll'))}</button></div><small>${esc(t('admin.payrollReminderSub').replace('{d}',rem.lastDay-1).replace('{last}',rem.lastDay))}</small></div>`:'';
    const leaveRemHtml = lrem.due?`<div class="card" style="background:#e8f5e9;border-color:#a5d6a7;color:#2e7d32"><div class="spread"><b>🗓️ ${esc(t('admin.leaveReset'))}</b><button class="btn sm" onclick="A_settings()">${esc(t('manage.settings'))}</button></div><small>${esc(t('admin.leaveResetSub'))}</small></div>`:'';
    const _dow=new Date().getDay(); const _closed=(_dow===0||_dow===6);
    const closedBanner=_closed?`<div class="card" style="background:#e8f5e9;border-color:#a5d6a7;color:#2e7d32;text-align:center"><b>🏖️ ${EN()?'School closed today (weekend) — no check-in required':'วันนี้โรงเรียนหยุด (เสาร์/อาทิตย์) — ไม่มีการลงเวลา'}</b></div>`:'';
    app.innerHTML=`<h2 class="page">${esc(t('title.dashboard'))} (${esc(todayStr())})</h2>
      ${closedBanner}${remHtml}${leaveRemHtml}
      <div class="card"><div class="row"><button class="btn sm" onclick="GO('finance')">💰 ${esc(t('fin.title'))}</button><button class="btn sm ${pendN?'':'outline'}" onclick="GO('verify')">✅ ${esc(t('verify.title'))}${pendN?` (${pendN})`:''}</button><button class="btn sm" onclick="GO('daily')">📋 ${esc(t('daily.title'))}</button><button class="btn sm outline" onclick="GO('absence')">🔎 ${esc(t('abs.title'))}</button><button class="btn sm outline" onclick="A_addAnn()">+ ${esc(t('lbl.addAnn'))}</button><button class="btn sm outline" onclick="A_viewAs()">👁️ ${EN()?'View as':'ดูมุมมอง'}</button></div></div>
      ${payHtml}
      <div class="card"><div class="spread"><h3>👶 ${EN()?'Attendance by class':'การมาเรียนแต่ละชั้น'}</h3><button class="btn sm outline" onclick="A_addAnn()">+ ${EN()?'Announce':'ประกาศ'}</button></div>
        ${(()=>{ const ts=d.classes.reduce((a,c)=>{a.p+=c.in+c.out;a.t+=c.total;return a;},{p:0,t:0}); const tp=ts.t?Math.round(ts.p/ts.t*100):100;
          return `<div class="spread" style="font-size:15px;margin-bottom:8px"><b>${EN()?'Total':'รวมทั้งหมด'}</b><b style="color:${pctColor(tp)}">${tp}% <small class="muted" style="font-weight:400">(${ts.p}/${ts.t})</small></b></div>`; })()}
        ${d.classes.map(c=>{ const present=c.in+c.out; const pct=c.total?Math.round(present/c.total*100):100; const miss=(c.students||[]).filter(s=>s.status==='ABSENT'||s.status==='LEAVE');
          return `<div style="margin-bottom:12px"><div class="spread"><b>${esc(c.className)}</b><span style="font-weight:700;color:${pctColor(pct)}">${pct}% <small class="muted" style="font-weight:400">(${present}/${c.total})</small></span></div>
            <div style="height:6px;background:#eee;border-radius:4px;overflow:hidden;margin:4px 0"><div style="height:100%;width:${pct}%;background:${pctColor(pct)}"></div></div>
            ${(()=>{ const inb=(c.students||[]).filter(s=>s.status==='IN'||s.status==='OUT'); const lv=(c.students||[]).filter(s=>s.status==='LEAVE'); const ab=(c.students||[]).filter(s=>s.status==='ABSENT');
              return `${inb.length?`<div><span class="pill ok">✅ ${EN()?'in':'มา'} (${inb.length})</span> <small class="muted">${inb.map(s=>esc(dnick(s))+(s.in?' '+esc(s.in):'')).join(', ')}</small></div>`:''}
                ${lv.length?`<div style="margin-top:2px"><span class="pill wait">🌴 ${EN()?'leave':'ลา'} (${lv.length})</span> <small class="muted">${lv.map(s=>esc(dnick(s))).join(', ')}</small></div>`:''}
                ${ab.length?`<div style="margin-top:2px"><span class="pill bad">⛔ ${EN()?'absent':'ขาด'} (${ab.length})</span> <small class="muted">${ab.map(s=>esc(dnick(s))).join(', ')}</small></div>`:''}
                ${!lv.length&&!ab.length?`<small style="color:#2e7d32">✓ ${EN()?'All present':'มาครบทุกคน'}</small>`:''}`; })()}</div>`;}).join('')}</div>
      <div class="card"><h3>👩‍🏫 ${EN()?'Staff today':'พนักงานวันนี้'}</h3>
        ${(()=>{ const present=d.staff.filter(s=>s.status==='IN'||s.status==='OUT').length; const t=d.staff.length; const pct=t?Math.round(present/t*100):100;
          const onTime=d.staff.filter(s=>(s.status==='IN'||s.status==='OUT')&&!s.late); const late=d.staff.filter(s=>s.late); const absent=d.staff.filter(s=>s.status==='ABSENT'||s.status==='LEAVE');
          return `<div class="spread" style="font-size:15px"><b>${EN()?'Present':'มาทำงาน'}</b><b style="color:${pctColor(pct)}">${pct}% <small class="muted" style="font-weight:400">(${present}/${t})</small></b></div>
            ${onTime.length?`<div style="margin-top:6px"><span class="pill ok">✅ ${EN()?'On time':'ตรงเวลา'} (${onTime.length})</span> <small class="muted">${onTime.map(s=>esc(dnick(s))+(s.checkIn?' '+esc(s.checkIn):'')).join(', ')}</small></div>`:''}
            ${late.length?`<div style="margin-top:6px"><span class="pill bad">⏰ ${EN()?'Late':'มาสาย'} (${late.length})</span> <small style="color:#e65100">${late.map(s=>esc(dnick(s))+' '+esc(s.checkIn||'')+(s.late?` (${EN()?'late ':'สาย '}${s.late}${EN()?'m':'น.'})`:'')).join(', ')}</small></div>`:''}
            ${absent.length?`<div style="margin-top:6px"><span class="pill wait">⛔ ${EN()?'Absent/leave':'ขาด/ลา'} (${absent.length})</span> <small class="muted">${absent.map(s=>esc(dnick(s))+(s.status==='LEAVE'?(EN()?' (leave)':' (ลา)'):'')).join(', ')}</small></div>`:''}
            ${!late.length&&!absent.length?`<small style="color:#2e7d32">✓ ${EN()?'All present & on time':'มาครบ ตรงเวลา'}</small>`:''}`; })()}</div>
      <div class="card"><h3>📢 ประกาศ</h3><div id="anns"></div></div>`;
    const _anns=await api('announcements'); A_CACHE.announcements=_anns;
    const _annEl=$('#anns'); if(!_annEl) return; // user navigated away before this resolved
    _annEl.innerHTML=_anns.map(a=>{ const ti=EN()?(a.TitleEN||a.Title):(a.Title||a.TitleEN);
      return `<div class="list-item"><div><b>${esc(ti)}</b>${a.Popup?` <span class="pill info" style="font-size:10px">Pop-up</span>`:''}${Number(a.Priority||0)>=2?` <span class="pill" style="font-size:10px;background:#fff3e0;color:#e65100">⭐ ${esc(t('ann.pri.high'))}</span>`:''}<br><small class="muted">${esc(a.StartDate||a.Date)}${a.EndDate?'→'+esc(a.EndDate):''}</small></div><span class="row"><button class="btn sm outline" onclick="A_editAnn('${a.AnnID}')">✏️</button><button class="btn sm pink" onclick="A_delAnn('${a.AnnID}')">🗑️</button></span></div>`; }).join('')||`<small class="muted">${esc(t('c.noItems'))}</small>`;
  };
  window.A_addAnn=(annId)=>{ const a=annId?findAnn(annId):{};
    modal(`<h3>📢 ${annId?esc(t('ann.edit')):'เพิ่มประกาศ / Add announcement'}</h3>
    <label class="field"><span>หัวข้อ (ไทย)</span><input id="anT" value="${esc(a.Title||'')}"/></label>
    <label class="field"><span>Title (English)</span><input id="anTE" value="${esc(a.TitleEN||'')}"/></label>
    <label class="field"><span>รายละเอียด (ไทย)</span><textarea id="anC">${esc(a.Content||'')}</textarea></label>
    <label class="field"><span>Content (English)</span><textarea id="anCE">${esc(a.ContentEN||'')}</textarea></label>
    ${photoField('anImg',(EN()?'Attach image (optional)':'แนบรูป (ถ้ามี)'),a.Image,false)}
    <label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="anPopup" ${a.Popup!==false?'checked':''} style="width:auto"/> ${esc(t('ann.popup'))}</label>
    <label class="field"><span>${esc(t('ann.priority'))}</span><select id="anPri">${[[2,t('ann.pri.high')],[1,t('ann.pri.normal')],[0,t('ann.pri.low')]].map(([v,l])=>`<option value="${v}" ${Number(a.Priority||1)===v?'selected':''}>${esc(l)}</option>`).join('')}</select></label>
    <div class="grid2"><label class="field"><span>${esc(t('ann.start'))}</span><input type="date" id="anStart" value="${esc(a.StartDate||todayStr())}"/></label><label class="field"><span>${esc(t('ann.end'))}</span><input type="date" id="anEnd" value="${esc(a.EndDate||'')}"/></label></div>
    <button class="btn block" onclick="A_addAnnDo(this,'${annId||''}')">บันทึกประกาศ / Save</button>`); };
  window.A_addAnnDo=async(btn,annId)=>{ const m=btn.closest('.modal'); const q=s=>m.querySelector(s).value.trim();
    const title=q('#anT'), titleEN=q('#anTE'); if(!title&&!titleEN){toast('ใส่หัวข้อ / Enter a title');return;}
    const image=photoVal(m,'anImg');
    const data={title:title||titleEN,titleEN:titleEN||title,content:q('#anC'),contentEN:q('#anCE'),image,popup:m.querySelector('#anPopup').checked,priority:Number(m.querySelector('#anPri').value)||0,startDate:q('#anStart'),endDate:q('#anEnd')};
    if(annId) await api('editAnnouncement',Object.assign({annId},data)); else await api('addAnnouncement',data);
    m.remove(); confirmSaved(t('c.saved')); GO('home'); };
  window.A_editAnn=(annId)=>A_addAnn(annId);
  window.A_delAnn=async(annId)=>{ if(!confirm(t('manage.confirmDel')))return; try{ await api('deleteAnnouncement',{annId}); toast(t('manage.deleted')); GO('home'); }catch(e){err(e);} };

  // one admin leave card: nickname + dept + type/dates + reason + status + actions (approve/reject/edit/cancel)
  function leaveAdminCard(l){ const isPA=String(l.Status)==='PENDING_ADMIN';
    return `<div class="card"><div class="spread"><div><b>${esc(leaveName(l))}</b> <small class="muted">(${esc(l.Department||'-')})</small><br>${esc(l.Type)} ${esc(l.StartDate)}→${esc(l.EndDate)} (${l.Days} ${EN()?'d':'วัน'})${leaveDoc(l)}<br><small class="muted">${esc(l.Reason||'')}</small>${l.Step1ApproverName?`<br><small>${EN()?'via leader':'ผ่านหัวหน้างาน'}: ${esc(l.Step1ApproverName)}${l.Step1CrossDept==='YES'?' ⚠️ '+(EN()?'cross-dept':'ข้ามแผนก'):''}</small>`:''}</div>${leaveStatusPill(l.Status)}</div>
      <div class="row" style="margin-top:8px">${isPA?`<button class="btn sm green" onclick="A_leave('${l.LeaveID}','approve')">${esc(t('ot.approve'))}</button><button class="btn sm pink" onclick="A_leave('${l.LeaveID}','reject')">${esc(t('ot.reject'))}</button>`:''}<button class="btn sm outline" onclick="A_editLeave('${l.LeaveID}')">✏️ ${EN()?'Edit':'แก้ไข'}</button><button class="btn sm pink" onclick="A_cancelLeave('${l.LeaveID}')">🗑️ ${EN()?'Cancel':'ยกเลิก'}</button></div></div>`; }
  // month calendar of who is on leave each day (spot same-day overlaps — ≥2 on a day is flagged red)
  function leaveCalendar(all){
    const render=()=>{ const b=calBase(),y=b.getFullYear(),mo=b.getMonth(); const now=new Date(); const isCur=CAL_OFF===0;
      const first=new Date(y,mo,1).getDay(),days=new Date(y,mo+1,0).getDate(); const byDay={};
      all.filter(l=>l.Status!=='REJECTED').forEach(l=>{ const st=new Date(l.StartDate),en=new Date(l.EndDate);
        for(let dt=new Date(st);dt<=en;dt.setDate(dt.getDate()+1)){ if(dt.getFullYear()===y&&dt.getMonth()===mo)(byDay[dt.getDate()]=byDay[dt.getDate()]||[]).push(leaveName(l)); } });
      let cells=['อา','จ','อ','พ','พฤ','ศ','ส'].map(w=>`<div style="text-align:center;font-size:11px;color:#94a3b8">${EN()?({'อา':'Su','จ':'Mo','อ':'Tu','พ':'We','พฤ':'Th','ศ':'Fr','ส':'Sa'}[w]):w}</div>`).join('');
      for(let i=0;i<first;i++)cells+='<div class="d dim"></div>';
      for(let dd=1;dd<=days;dd++){ const ppl=byDay[dd]; const today=(isCur&&dd===now.getDate())?'today':''; const clash=ppl&&ppl.length>=2;
        cells+=`<div class="d ${ppl?'ev':''} ${today}" style="min-height:52px;${clash?'background:#ffebee;border-color:#ef9a9a;':''}">${dd}${ppl?`<span class="io" style="text-align:left;color:${clash?'#c62828':'#2e7d32'};font-weight:600">${esc(ppl.join('\n'))}</span>`:''}</div>`; }
      return `${calNavHeader(y,mo)}<div class="cal">${cells}</div><small class="muted">${EN()?'Red = 2+ staff on leave the same day':'สีแดง = ลาซ้ำวันเดียวกัน ≥2 คน'}</small>`; };
    window._CALRENDER=render;
    return `<div class="card"><div id="calWrap">${render()}</div></div>`; }

  let LV_TAB='pending';  // default sub-tab (teacher view) = in-progress
  let LV_MAIN='staff';   // main tab: 'staff' (teachers) | 'student'
  SCREENS.Admin.leaves = async () => {
    const mainSeg=`<div class="seg" style="margin-bottom:10px"><button class="${LV_MAIN==='staff'?'active':''}" onclick="A_lvMain('staff')">👩‍🏫 ${EN()?'Teachers':'คุณครู'}</button><button class="${LV_MAIN==='student'?'active':''}" onclick="A_lvMain('student')">👶 ${EN()?'Students':'นักเรียน'}</button></div>`;
    if(LV_MAIN==='student'){
      const leaves=await api('allStudentLeaves'); window._SLV_ALL=leaves||[];
      window._CALRENDER=studentLeaveCalRender;
      app.innerHTML=`<h2 class="page">✅ ${EN()?'Leave approval':'อนุมัติการลา'}</h2>${mainSeg}
        <p class="muted" style="font-size:12px">${EN()?'Absences by day and class. Tap a day to see who is absent per class (history included).':'การลาแยกรายวันและชั้นเรียน · แตะวันเพื่อดูว่านักเรียนคนไหนขาดในแต่ละชั้น (ดูย้อนหลังได้)'}</p>
        <div class="card"><div id="calWrap">${studentLeaveCalRender()}</div></div>`;
      return;
    }
    const [all,staff]=await Promise.all([api('allLeaves'),(A_CACHE.staff&&A_CACHE.staff.length)?Promise.resolve(A_CACHE.staff):api('listStaff')]);
    A_CACHE.staff=staff||A_CACHE.staff; window._LV_ALL=all;
    const pending=all.filter(l=>String(l.Status).indexOf('PENDING')===0);
    const resolved=all.filter(l=>String(l.Status).indexOf('PENDING')!==0);
    const none=`<div class="card muted">${esc(t('c.noItems'))}</div>`;
    const shown = LV_TAB==='pending'?pending:resolved;
    app.innerHTML=`<h2 class="page">✅ ${EN()?'Leave approval':'อนุมัติการลา'}</h2>${mainSeg}
      <div class="leavegrid">
        <div class="lvcol">
          <div class="seg" style="margin-bottom:10px"><button class="${LV_TAB==='pending'?'active':''}" onclick="A_lvTab('pending')">⏳ ${EN()?'In progress':'กำลังดำเนินการ'} (${pending.length})</button><button class="${LV_TAB==='resolved'?'active':''}" onclick="A_lvTab('resolved')">✅ ${EN()?'Done':'อนุมัติแล้ว/เสร็จสิ้น'} (${resolved.length})</button></div>
          ${shown.length?shown.map(leaveAdminCard).join(''):none}
        </div>
        <div class="lvcol">${leaveCalendar(all)}</div>
      </div>`;
  };
  window.A_lvMain=(m)=>{ LV_MAIN=m; CAL_OFF=0; SCREENS.Admin.leaves(); };
  window.A_lvTab=(tab)=>{ LV_TAB=tab; SCREENS.Admin.leaves(); };
  // Student-absence calendar: each day shows the total absent count; tap a day → per-class breakdown popup.
  function studentLeaveCalRender(){
    const b=calBase(),y=b.getFullYear(),mo=b.getMonth(); const now=new Date(); const isCur=CAL_OFF===0;
    const first=new Date(y,mo,1).getDay(),days=new Date(y,mo+1,0).getDate();
    const byDay={}; (window._SLV_ALL||[]).forEach(l=>{ const dt=new Date(ymd(l.Date));
      if(dt.getFullYear()===y&&dt.getMonth()===mo){ const d=dt.getDate(); (byDay[d]=byDay[d]||[]).push(l); } });
    let cells=['อา','จ','อ','พ','พฤ','ศ','ส'].map(w=>`<div style="text-align:center;font-size:11px;color:#94a3b8">${EN()?({'อา':'Su','จ':'Mo','อ':'Tu','พ':'We','พฤ':'Th','ศ':'Fr','ส':'Sa'}[w]):w}</div>`).join('');
    for(let i=0;i<first;i++)cells+='<div class="d dim"></div>';
    for(let dd=1;dd<=days;dd++){ const items=byDay[dd]; const today=(isCur&&dd===now.getDate())?'today':''; const n=items?items.length:0;
      const nCls=items?new Set(items.map(x=>x.class||'-')).size:0; const ds=`${y}-${String(mo+1).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
      cells+=`<div class="d ${n?'ev':''} ${today}" style="min-height:52px;${n?'cursor:pointer;background:#fff3e0;border-color:#ffcc80;':''}" ${n?`onclick="A_slvDay('${ds}')"`:''}>${dd}${n?`<span class="io" style="text-align:left;color:#e65100;font-weight:700">${EN()?'absent':'ขาด'} ${n}<br><span style="font-weight:400;color:#94a3b8">${nCls} ${EN()?'class':'ชั้น'}</span></span>`:''}</div>`; }
    return `${calNavHeader(y,mo)}<div class="cal">${cells}</div><small class="muted">${EN()?'Orange = students on leave that day. Tap to see details.':'สีส้ม = มีนักเรียนลาวันนั้น · แตะเพื่อดูรายละเอียด'}</small>`;
  }
  window.A_slvDay=(ds)=>{ const items=(window._SLV_ALL||[]).filter(l=>ymd(l.Date)===ds);
    const byClass={}; items.forEach(l=>{ const c=l.class||(EN()?'(no class)':'(ไม่ระบุชั้น)'); (byClass[c]=byClass[c]||[]).push(l); });
    const classes=Object.keys(byClass).sort();
    modal(`<h3>🗓️ ${EN()?'Absent on':'ขาดเรียนวันที่'} ${esc(ddmmyyyy(ds))}</h3>
      <p class="muted" style="font-size:12px">${EN()?'Total':'รวม'} <b>${items.length}</b> ${EN()?'across':'ใน'} ${classes.length} ${EN()?'class(es)':'ชั้นเรียน'}</p>
      <div style="max-height:60vh;overflow:auto">${classes.length?classes.map(c=>`<div class="card" style="padding:8px"><div class="spread"><b>🏫 ${esc(c)}</b><span class="pill bad">${byClass[c].length} ${EN()?'absent':'ขาด'}</span></div>
        ${byClass[c].map(l=>`<div class="list-item"><span>${esc((EN()?(l.nickEN||l.nick||l.nameEN):(l.nick||l.name))||l.StudentID)} ${l.Type?`<span class="pill info" style="font-size:10px">${esc(l.Type)}</span>`:''}</span><small class="muted">${esc(l.Reason||'')}</small></div>`).join('')}</div>`).join(''):`<div class="card muted">${EN()?'None':'ไม่มี'}</div>`}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_editLeave=async(id)=>{ const l=(await api('allLeaves')).find(x=>x.LeaveID===id); if(!l){toast(t('c.noItems'));return;}
    modal(`<h3>✏️ ${EN()?'Edit leave':'แก้ไขการลา'} — ${esc(leaveName(l))}</h3>
      <label class="field"><span>${EN()?'Type':'ประเภท'}</span><input id="elType" value="${esc(l.Type||'')}"/></label>
      <div class="grid2"><label class="field"><span>${EN()?'From':'ตั้งแต่'}</span><input type="date" id="elStart" value="${esc(String(l.StartDate).slice(0,10))}"/></label>
        <label class="field"><span>${EN()?'To':'ถึง'}</span><input type="date" id="elEnd" value="${esc(String(l.EndDate).slice(0,10))}"/></label></div>
      <label class="field"><span>${EN()?'Reason':'เหตุผล'}</span><textarea id="elReason">${esc(l.Reason||'')}</textarea></label>
      <button class="btn block" onclick="A_editLeaveDo('${id}',this)">${esc(t('c.save'))}</button>`); };
  window.A_editLeaveDo=async(id,btn)=>{ const m=btn.closest('.modal'); const g=x=>{const e=m.querySelector('#'+x);return e?e.value.trim():undefined;};
    try{ await api('editLeave',{staffId:USER.staffId,leaveId:id,type:g('elType'),startDate:g('elStart'),endDate:g('elEnd'),reason:g('elReason')}); m.remove(); confirmSaved(t('c.saved')); GO('leaves'); }catch(e){err(e);} };
  window.A_cancelLeave=async(id)=>{ if(!confirm(EN()?'Cancel/delete this leave request?':'ยกเลิก/ลบคำขอลานี้?'))return;
    try{ await api('cancelLeave',{staffId:USER.staffId,leaveId:id}); toast(t('manage.deleted')); GO('leaves'); }catch(e){err(e);} };
  window.A_leave=async(id,dec)=>{ try{ const r=await api('approveLeave',{staffId:USER.staffId,leaveId:id,decision:dec}); toast(`✅ ${dec==='approve'?'อนุมัติ':'ปฏิเสธ'}แล้ว (${r.status})`); GO('leaves'); }catch(e){err(e);} };

  let PAY_ADJ=[];
  SCREENS.Admin.payroll = async () => { const [staff,rate]=await Promise.all([api('listStaff'),api('ratedChildCount')]); PAY_ADJ=[]; window._RATED=rate;
    app.innerHTML=`<h2 class="page">${esc(t('title.payroll'))}</h2><div class="card">
      <div class="grid2"><label class="field"><span>${esc(t('c.staff'))}</span><select id="pStaff" onchange="A_payStaff()">${staff.map(s=>`<option value="${s.StaffID}">${esc(nmn(s))}</option>`).join('')}</select></label>
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
        <div id="pLeaveWarn"></div>
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
      const n=$('#otNote'); if(n) n.innerHTML=`(${EN()?'auto':'อัตโนมัติ'} ${ot.hours} ${EN()?'hr':'ชม.'} × ${baht(ot.rate)})`; }catch(e){}
    // leave (any type) over the limit → warn + auto-zero the child-rate count (field NOT locked; Admin can re-enter)
    try{ const ls=await api('staffLeaveSummary',{staffId:sid,month:$('#pMonth').value}); const w=$('#pLeaveWarn'), ch=$('#pChild');
      if(ls.exceeds){ if(ch) ch.value=0;
        if(w) w.innerHTML=`<div style="background:#fff3e0;border:1px solid #ffcc80;border-radius:8px;padding:7px 9px;margin-bottom:6px;color:#e65100;font-size:12.5px">⚠️ ${EN()?`Leave ${ls.days} days (> ${ls.limit}) this month — child-rate income not calculated. You can still enter a count manually.`:`ลาเกิน ${ls.limit} วัน (ลารวม ${ls.days} วัน) เดือนนี้ — ไม่คำนวณเรทจำนวนเด็กให้ · กรอกจำนวนเองได้หากต้องการ`}</div>`;
      } else if(w){ w.innerHTML=''; } }catch(e){} };
  window.A_payTypeToggle=()=>{ const daily=$('#pType').value==='daily'; $('#pMonthlyBox').hidden=daily; $('#pDailyBox').hidden=!daily; };
  // auto child-rate count from DB: children from #threshold onward = rated − (threshold−1)
  window.A_recalcChild=()=>{ const r=window._RATED||{}; const th=+$('#pThreshold').value||31; const cnt=Math.max(0,(r.rated||0)-(th-1)); $('#pChild').value=cnt;
    setHTML('#childCalc', `${esc(t('abs.rated'))} <b>${r.rated||0}</b> <span class="muted">(${esc(t('abs.rateNote').replace('{n}',r.excludeDays||6).replace('{x}',r.excluded||0))})</span> − ${esc(t('pay.fromChild'))} #${th} → <b style="color:#1565C0">${cnt} ${EN()?'children':'คน'}</b>`); };
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

  // tabs = the departments master ∪ every class students are actually in, so no child is hidden
  SCREENS.Admin.dspm = async () => { const [students,depts]=await Promise.all([api('listStudents'),api('listDepartments')]);
    A_CACHE.students=students||A_CACHE.students;
    const present={}; (students||[]).forEach(s=>{ if(s.Class) present[s.Class]=(present[s.Class]||0)+1; });
    const order=[]; (depts||[]).forEach(d=>{ if(order.indexOf(d)<0) order.push(d); });
    Object.keys(present).forEach(c=>{ if(order.indexOf(c)<0) order.push(c); });
    if(!order.length) order.push('-');
    app.innerHTML=`<h2 class="page">${esc(t('title.analytics'))}</h2>
      <div class="seg" style="flex-wrap:wrap">${order.map((c,i)=>`<button class="${i===0?'active':''}" onclick="A_cls('${esc(c)}',this)">${esc(c)} <small>(${present[c]||0})</small></button>`).join('')}</div><div id="clsRes"></div>`;
    A_cls(order[0]);
  };
  window.A_cls=async(name,el)=>{ if(el){[...el.parentElement.children].forEach(b=>b.classList.remove('active'));el.classList.add('active');} const r=await api('classAssessment',{className:name});
    $('#clsRes').innerHTML=`<div class="card"><div class="spread"><b>${esc(r.class)}</b><span class="pill ${r.passRate>=70?'ok':'wait'}">${EN()?'avg pass':'ผ่านเฉลี่ย'} ${r.passRate}%</span></div><small class="muted">${r.studentCount} ${EN()?'kids':'คน'}</small>
      ${r.perStudent.length?r.perStudent.map(s=>`<div class="list-item"><span><b>${esc(dnick(s))}</b> <small class="muted">${esc(dn(s))} · ${s.ageMonth} ${EN()?'m.':'ด.'}</small></span><span><span class="pill ok">${s.pass}</span> <span class="pill bad">${s.fail}</span> <button class="btn sm outline" onclick="A_student('${s.studentId}')">${EN()?'view':'ดูราย นร.'}</button></span></div>`).join(''):`<small class="muted">${EN()?'No students in this class':'ยังไม่มีนักเรียนในชั้นนี้'}</small>`}</div>`; };
  window.A_student=async(sid)=>{ const [d,g]=await Promise.all([api('studentAllBands',{studentId:sid}),api('growthHistory',{studentId:sid})]); const pill=DSPM_PILL;
    app.innerHTML=`<h2 class="page">📈 ${esc(dnick(d))} <small class="muted">(${esc(dn(d))})</small></h2>
      <div class="row"><button class="btn sm outline" onclick="GO('dspm')">← ${esc(t('c.back'))}</button><button class="btn sm" onclick="A_editAssess('${sid}')">📝 ${esc(t('assess.edit'))}</button></div>
      <div class="card"><div class="spread"><b>อายุปัจจุบัน ${d.ageMonth} เดือน</b><span class="muted">เข้าเรียน ${esc(d.enrollDate||'-')}</span></div>
      <p class="muted" style="font-size:12px">แสดงทุกช่วงวัยที่เด็กผ่านมา (ตั้งแต่เข้าเรียน) เพื่อดูพัฒนาการต่อเนื่อง</p></div>
      <div class="card"><h3>📈 ${esc(t('growth.chartTitle'))}</h3>
        <p class="muted" style="font-size:12px">${esc(t('growth.chartSub'))}</p>
        ${growthChartSVG(t('growth.weight'),g.records.map(r=>({x:r.AgeMonth,y:r.Weight})),gBand(g.weightBand,g.gender,g.records,'weight'),'kg')}
        ${growthChartSVG(t('growth.height'),g.records.map(r=>({x:r.AgeMonth,y:r.Height})),gBand(g.heightBand,g.gender,g.records,'height'),'cm')}
        <div class="row" style="font-size:11px;justify-content:center;margin-top:6px"><span>🟦 ${esc(t('growth.actual'))}</span><span>🟩 ${esc(t('growth.normalBand'))}</span></div>
        ${growthRecordsList(g.records)}</div>
      ${d.bands.map(b=>`<div class="card"><h3>${esc(b.label)}</h3>${b.items.map(i=>`<div class="list-item"><span><b>ข้อ ${i.itemNo}</b> <span class="pill info">${i.skill}</span> <small>${esc(EN()&&i.descriptionEN?i.descriptionEN:i.description)}</small></span>${pill(i.result)}</div>`).join('')}</div>`).join('')}
      <button class="btn outline" onclick="GO('dspm')">← กลับหน้าวิเคราะห์</button>`; window.scrollTo(0,0); };
  // measurement history list (date · age-at-measurement · weight/height)
  function growthRecordsList(records, dob){ if(!records||!records.length) return '';
    const rows=records.slice().sort((a,b)=>b.Date.localeCompare(a.Date)).map(r=>`<div class="list-item"><span>${esc(r.Date)} <small class="muted">(${esc(ageYMfromMonths(r.AgeMonth))})</small></span><span>${r.Weight?baht(r.Weight).replace('.00','')+' kg':''} ${r.Height?'· '+(baht(r.Height).replace('.00',''))+' cm':''}</span></div>`).join('');
    return `<div style="margin-top:8px"><b style="font-size:13px">📋 ${esc(t('growth.records'))}</b>${rows}</div>`; }
  // vaccine record card. Each vaccine topic supports MULTIPLE dose dates (some vaccines need several shots).
  // recs come from studentVaccines → each has {Key, VaccineName, Dates:[...]}.
  // editable=true → parent/Admin add/remove dose dates per topic, then one Save button (→ saveVaccines).
  function vacDatesOf(recs,k){ const r=(recs||[]).find(x=>x.Key===k); return (r&&r.Dates&&r.Dates.length)?r.Dates.slice():[]; }
  // one editable date row (date input + ✕ remove); the remove just drops the row from the DOM.
  function vacDateInput(key,val){ return `<div class="row vacdrow" style="gap:5px;align-items:center;margin-top:4px">`
    +`<input type="date" class="vacdate" data-key="${esc(key)}" value="${esc(val||'')}" style="width:150px"/>`
    +`<button class="btn sm gray" type="button" onclick="this.closest('.vacdrow').remove()" title="${EN()?'Remove':'ลบ'}">✕</button></div>`; }
  function vaccineCard(sched, recs, sid, editable){
    if(editable){ window.__VAC_SCHED=sched; }  // stash for VAC_save (key→name lookup)
    const body = sched.map(grp=>`<div style="margin-bottom:8px"><b style="font-size:13px">${esc(EN()?grp.ageEN:grp.ageTH)}</b>
      ${grp.items.map(it=>{ const dates=vacDatesOf(recs,it.key);
        if(editable){ const rows=(dates.length?dates:['']).map(d=>vacDateInput(it.key,d)).join('');
          return `<div class="vacitem" style="padding:6px 0;border-bottom:1px solid #eef0f4">
            <div style="font-size:12.5px;font-weight:600">${esc(EN()?it.en:it.th)}</div>
            <div id="vacrow_${esc(it.key)}">${rows}</div>
            <button class="btn sm outline" type="button" onclick="VAC_addDate('${esc(it.key)}')" style="margin-top:4px">➕ ${EN()?'Add dose date':'เพิ่มวันที่ฉีด'}</button></div>`; }
        return `<div class="list-item"><span style="font-size:12.5px">${esc(EN()?it.en:it.th)}</span>`
          +(dates.length?`<span>${dates.map(d=>`<span class="pill ok">✓ ${esc(d)}</span>`).join(' ')}</span>`:`<span class="pill wait">${esc(t('vac.notYet'))}</span>`)+`</div>`; }).join('')}</div>`).join('');
    return `<div class="card" id="vaccard" data-sid="${esc(sid)}"><h3>💉 ${esc(t('vac.title'))}</h3>
      ${editable?`<p class="muted" style="font-size:12px">${esc(t('vac.note'))}</p>`:''}
      ${body}
      ${editable?`<button class="btn block green" type="button" onclick="VAC_save('${esc(sid)}')" style="margin-top:10px">💾 ${EN()?'Save vaccine records':'บันทึกวัคซีน'}</button>`:''}</div>`; }
  // inline SVG line chart: child's measurements (line) vs the standard normal band (shaded)
  // The GAS engine runs with GROWTH_STD=null (no server-side band), so the green normal-range
  // band comes back empty in gas mode. The browser HAS window.GROWTH_STD → rebuild it locally.
  function gBand(serverBand, gender, recs, key){
    if(serverBand && serverBand.some(b=>b.min!=null)) return serverBand;
    if(!window.GROWTH_STD || !window.GROWTH_STD.at) return serverBand||[];
    return (recs||[]).map(r=>{ const at=GROWTH_STD.at(gender, r.AgeMonth, key); return {ageMonth:r.AgeMonth, min:at?at.min:null, max:at?at.max:null}; });
  }
  // Growth vs standard: the green band is the WHO/Amarin normal range; the blue line is the child.
  // The y-axis is centered on the band so a healthy child sits mid-chart and only DEVIATION moves the
  // line out — "แถบเขียว = มาตรฐาน, เส้น = เด็ก, อยู่ตรงกลางแล้วขยับออกตามข้อมูล".
  function growthChartSVG(title, pts, band, unit){ const W=320,H=170,pl=34,pr=10,pt=24,pb=22;
    const bandPts=band.filter(b=>b.min!=null);
    const xs=pts.map(p=>p.x).concat(band.map(b=>b.ageMonth));
    const ys=pts.map(p=>p.y).concat(band.map(b=>b.min),band.map(b=>b.max)).filter(v=>v!=null);
    if(!ys.length) return `<div class="muted" style="font-size:12px">${esc(title)}: ${EN()?'no data':'ยังไม่มีข้อมูล'}</div>`;
    const xmin=Math.min.apply(0,xs),xmax=Math.max.apply(0,xs)||1; const xR=(xmax-xmin)||1;
    // y-domain: symmetric around the band's center so the standard band is vertically centered
    let ymin,ymax,center=null;
    if(bandPts.length){ const bMin=Math.min.apply(0,bandPts.map(b=>b.min)), bMax=Math.max.apply(0,bandPts.map(b=>b.max));
      center=(bMin+bMax)/2; const bandHalf=(bMax-bMin)/2||1;
      const dev=Math.max.apply(0,pts.map(p=>Math.abs(p.y-center)).concat([bandHalf]));
      const half=Math.max(bandHalf, dev)*1.3; ymin=center-half; ymax=center+half; }
    else { ymin=Math.min.apply(0,ys); ymax=Math.max.apply(0,ys); if(ymin===ymax){ymin-=1;ymax+=1;} }
    const yR=(ymax-ymin)||1;
    const X=v=>pl+(v-xmin)/xR*(W-pl-pr), Y=v=>H-pb-(v-ymin)/yR*(H-pt-pb);
    const top=bandPts.map(b=>X(b.ageMonth)+','+Y(b.max)).join(' ');
    const bot=bandPts.slice().reverse().map(b=>X(b.ageMonth)+','+Y(b.min)).join(' ');
    const bandPoly = bandPts.length?`<polygon points="${top} ${bot}" fill="#43a04733" stroke="#43a047" stroke-width="0.6"/>`:'';
    // dashed center reference (band midline)
    const centerLine = center!=null?`<line x1="${pl}" y1="${Y(center)}" x2="${W-pr}" y2="${Y(center)}" stroke="#43a047" stroke-width="0.6" stroke-dasharray="3 3" opacity="0.7"/>`:'';
    const line = pts.map((p,i)=>(i?'L':'M')+X(p.x)+' '+Y(p.y)).join(' ');
    const dots = pts.map(p=>{ const lbl=`${ageYMfromMonths(p.x)} · ${p.y} ${unit}`; const cy=Y(p.y);
      return `<circle cx="${X(p.x)}" cy="${cy}" r="4.5" fill="#1565C0" style="cursor:pointer" onclick="GROWTH_PT('${esc(lbl)}')"><title>${esc(lbl)}</title></circle>
        <text x="${X(p.x)}" y="${cy-7}" font-size="8.5" font-weight="700" fill="#0D47A1" text-anchor="middle">${p.y}</text>`; }).join('');
    const yt=[ymin,center!=null?center:(ymin+ymax)/2,ymax].map(v=>`<text x="2" y="${Y(v)+3}" font-size="8" fill="#94a3b8">${v.toFixed(0)}</text>`).join('');
    return `<div style="margin:6px 0"><b style="font-size:13px">${esc(title)} (${unit})</b><br>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:420px;height:auto">
        <line x1="${pl}" y1="${H-pb}" x2="${W-pr}" y2="${H-pb}" stroke="#cbd5e1" stroke-width="0.7"/>
        <line x1="${pl}" y1="${pt}" x2="${pl}" y2="${H-pb}" stroke="#cbd5e1" stroke-width="0.7"/>
        ${bandPoly}${centerLine}<path d="${line}" fill="none" stroke="#1565C0" stroke-width="1.6"/>${dots}${yt}
        <text x="${pl}" y="${H-6}" font-size="8" fill="#94a3b8">${xmin}${EN()?'m':'ด'}</text>
        <text x="${W-pr-16}" y="${H-6}" font-size="8" fill="#94a3b8">${xmax}${EN()?'m':'ด'}</text>
      </svg></div>`; }

  window.A_reqCI = async (id,val) => { await api('setRequireCheckin',{staffId:id,value:val}); toast((val?'เปิด':'ปิด')+'การบังคับลงเวลา'); };
  // Save all check-in-requirement toggles at once (persists to STAFF.RequireCheckin). One batched round-trip.
  window.A_saveReqCI = async (btn)=>{ const card=btn.closest('.modal,.card'); const tgs=[...card.querySelectorAll('input[data-sid]')];
    try{ await Promise.all(tgs.map(t=>api('setRequireCheckin',{staffId:t.dataset.sid,value:t.checked}))); confirmSaved(EN()?'Check-in settings saved':'บันทึกการตั้งค่าลงเวลาแล้ว'); const m=btn.closest('.modal'); if(m)m.remove(); }catch(e){err(e);} };
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
  // PDPA access matrix — moved off the manage page into a Settings modal (opened from the menu)
  window.A_perms = async () => { const pm=window._PERM||await api('permMatrix');
    const CAPS=[['students','perm.students'],['staff','perm.staff'],['payroll','perm.payroll'],['parentPII','perm.parentPII'],['edit','perm.edit'],['approve','perm.approve']];
    const RS=['Admin','Leader','Teacher','Parent'];
    modal(`<h3>🔐 ${esc(t('lbl.perms'))}</h3><p class="muted" style="font-size:12px">${esc(t('perm.note'))}</p>
      <div style="overflow:auto"><table style="width:100%;font-size:12px;border-collapse:collapse">
      <tr style="background:#1565C0;color:#fff"><th style="padding:4px 6px;text-align:left">${esc(t('perm.role'))}</th>${CAPS.map(c=>`<th style="padding:4px 3px">${esc(t(c[1]))}</th>`).join('')}</tr>
      ${RS.map(r=>`<tr style="border-bottom:1px solid #eee"><td style="padding:4px 6px"><b>${esc(t('role.'+r)||r)}</b></td>${CAPS.map(c=>`<td style="text-align:center"><input type="checkbox" style="width:auto" ${pm[r]&&pm[r][c[0]]?'checked':''} onchange="A_perm('${r}','${c[0]}',this.checked)"/></td>`).join('')}</tr>`).join('')}
      </table></div>
      <button class="btn outline block" style="margin-top:10px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  // ---- DSPM criteria editor (admin can add/edit/remove/re-categorize milestone items) ----
  const DSPM_SKILLS=['GM','FM','RL','EL','PS'];
  const dcSkillLabel=code=>`${esc(code)} · ${esc(t('dom.'+code)||code)}`;
  window.A_dspmCriteria = async () => { const rows=await api('dspmAllCriteria'); window._DSPM_ROWS=rows;
    // group by age band (AgeLabelTH), bands ordered by AgeFrom
    const bands={}; rows.forEach(r=>{ const k=r.AgeLabelTH||'—'; (bands[k]=bands[k]||{label:k,from:Number(r.AgeFrom)||0,items:[]}).items.push(r); });
    const ordered=Object.values(bands).sort((a,b)=>a.from-b.from);
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('manage')">${t('c.back')}</button>
      <div class="spread"><h2 class="page">📈 ${esc(t('dspm.manageTitle'))}</h2><button class="btn sm" onclick="A_dspmForm()">➕ ${esc(t('dspm.add'))}</button></div>
      <p class="muted" style="font-size:12px">${EN()?'Add, edit or remove milestone items. Grouped by age band.':'เพิ่ม แก้ไข หรือลบเกณฑ์พัฒนาการ · จัดกลุ่มตามช่วงอายุ'} (${rows.length})</p>
      ${ordered.map(b=>`<div class="card"><h3>${esc(b.label)} <small class="muted">(${b.items[0]?esc(b.items[0].AgeFrom+'–'+b.items[0].AgeTo+(EN()?' mo':' เดือน')):''})</small></h3>
        ${b.items.sort((x,y)=>Number(x.ItemNo)-Number(y.ItemNo)).map(r=>`<div class="list-item"><span><b>${esc(t('dspm.item'))} ${esc(r.ItemNo)}</b> <span class="pill info" style="font-size:10px">${esc(r.Skill||'')}</span><br><small class="muted">${esc(r.Description||'')}</small></span>
          <span class="row"><button class="btn sm outline" onclick="A_dspmForm(${Number(r.ItemNo)},'${esc(r.Track||'Teacher')}')">✏️</button><button class="btn sm pink" onclick="A_dspmDel(${Number(r.ItemNo)},'${esc(r.Track||'Teacher')}')">🗑️</button></span></div>`).join('')}</div>`).join('')||`<div class="card muted">${esc(t('c.noItems'))}</div>`}`;
    window.scrollTo(0,0);
  };
  window.A_dspmForm = (itemNo,track)=>{ const rows=window._DSPM_ROWS||[];
    const r=(itemNo!=null)?(rows.find(x=>Number(x.ItemNo)===Number(itemNo)&&String(x.Track||'Teacher')===String(track||'Teacher'))||{}):{};
    modal(`<h3>${itemNo!=null?'✏️':'➕'} ${esc(t('dspm.manageTitle'))}</h3>
      <div class="grid2"><label class="field"><span>${EN()?'Age from (months)':'อายุตั้งแต่ (เดือน)'}</span><input type="number" id="dcFrom" value="${esc(r.AgeFrom!=null?r.AgeFrom:'')}"/></label>
        <label class="field"><span>${EN()?'Age to (months)':'ถึงอายุ (เดือน)'}</span><input type="number" id="dcTo" value="${esc(r.AgeTo!=null?r.AgeTo:'')}"/></label></div>
      <label class="field"><span>${EN()?'Age band label':'ชื่อช่วงอายุ'}</span><input id="dcLabel" value="${esc(r.AgeLabelTH||'')}" placeholder="${EN()?'e.g. 1-2 months':'เช่น 1-2 เดือน'}"/></label>
      <label class="field"><span>${EN()?'Skill (domain)':'ด้านพัฒนาการ'}</span><select id="dcSkill">${DSPM_SKILLS.map(c=>`<option value="${c}" ${r.Skill===c?'selected':''}>${dcSkillLabel(c)}</option>`).join('')}</select></label>
      <label class="field"><span>${EN()?'Description (TH)':'รายละเอียด (ไทย)'}</span><textarea id="dcDesc">${esc(r.Description||'')}</textarea></label>
      <label class="field"><span>${EN()?'Description (EN)':'รายละเอียด (อังกฤษ)'}</span><textarea id="dcDescEN">${esc(r.DescriptionEN||'')}</textarea></label>
      <button class="btn block" onclick="A_dspmSave(this,${itemNo!=null?Number(itemNo):'null'},'${esc(track||'Teacher')}')">${esc(t('c.save'))}</button>`);
  };
  window.A_dspmSave = async (btn,itemNo,track)=>{ const m=btn.closest('.modal'); const g=id=>{const e=m.querySelector('#'+id);return e?e.value.trim():'';};
    const label=g('dcLabel'), desc=g('dcDesc'); if(!label||!desc){toast(EN()?'Fill band + description':'กรอกช่วงอายุและรายละเอียด');return;}
    const data={AgeFrom:g('dcFrom'),AgeTo:g('dcTo'),AgeLabelTH:label,Skill:g('dcSkill'),Description:desc,DescriptionEN:g('dcDescEN'),Track:track||'Teacher'};
    try{ await api('saveDspmCriteria',{staffId:USER.staffId,itemNo:itemNo!=null?itemNo:undefined,track:track||'Teacher',data}); m.remove(); confirmSaved(t('c.saved')); GO_('dspmCriteria'); }catch(e){err(e);} };
  window.A_dspmDel = async (itemNo,track)=>{ if(!confirm(t('manage.confirmDel')))return; try{ await api('deleteDspmCriteria',{staffId:USER.staffId,itemNo,track:track||'Teacher'}); toast(t('manage.deleted')); GO_('dspmCriteria'); }catch(e){err(e);} };

  // ---- Admin: student-leave management — grouped by Class → student (with leave count) + multi-select delete ----
  window.A_studentLeaves = async () => { const rows=await api('allStudentLeaves'); window._SLV=rows;
    // group: class -> student -> [leaves]
    const byClass={};
    rows.forEach(l=>{ const c=l.class||'—'; const g=byClass[c]=byClass[c]||{}; const sid=l.StudentID;
      (g[sid]=g[sid]||{name:l.nick||l.name||sid, sub:l.name||'', leaves:[]}).leaves.push(l); });
    const classes=Object.keys(byClass).sort();
    const classHtml=classes.map(c=>{ const studs=byClass[c]; const total=Object.values(studs).reduce((n,s)=>n+s.leaves.length,0);
      const studHtml=Object.keys(studs).map(sid=>{ const s=studs[sid]; s.leaves.sort((a,b)=>String(b.Date).localeCompare(String(a.Date)));
        return `<div class="slv-stud"><div class="spread"><b>${esc(s.name)}</b><span class="pill info">${s.leaves.length} ${EN()?'leaves':'ครั้ง'}</span></div>
          ${s.leaves.map(l=>`<div class="slv-row"><label class="slv-pick"><input type="checkbox" class="slvchk" value="${esc(l.LeaveID)}" onchange="A_slvCount()"><span><b style="color:#1565C0">${esc(ddmmyyyy(l.Date))}</b> <small class="muted">· ${esc(stdLeaveDesc(l))}</small></span></label>
            <span class="row"><button class="btn sm outline" onclick="A_slvEdit('${l.LeaveID}')">✏️</button><button class="btn sm pink" onclick="A_slvDel('${l.LeaveID}')">🗑️</button></span></div>`).join('')}</div>`; }).join('');
      return `<div class="card"><div class="spread"><h3>👶 ${esc(c)}</h3><span class="muted" style="font-size:12px">${Object.keys(studs).length} ${EN()?'kids':'คน'} · ${total} ${EN()?'leaves':'ครั้ง'}</span></div>${studHtml}</div>`; }).join('');
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('manage')">${t('c.back')}</button>
      <h2 class="page">🏠 ${esc(t('slv.title'))}</h2>
      <div class="slv-bar"><label class="slv-pick"><input type="checkbox" id="slvAll" onchange="A_slvToggleAll(this)"> ${EN()?'Select all':'เลือกทั้งหมด'}</label>
        <button class="btn sm pink" id="slvDelBtn" disabled onclick="A_slvDelSel(this)">🗑️ ${EN()?'Delete selected':'ลบที่เลือก'} <span id="slvN">0</span></button></div>
      ${rows.length?classHtml:`<div class="card"><small class="muted">${esc(t('c.noItems'))}</small></div>`}`;
    window.scrollTo(0,0);
  };
  window.A_slvCount = ()=>{ const n=document.querySelectorAll('.slvchk:checked').length; const b=$('#slvDelBtn'), s=$('#slvN'); if(s)s.textContent='('+n+')'; if(b)b.disabled=!n;
    const all=$('#slvAll'); if(all){ const tot=document.querySelectorAll('.slvchk').length; all.checked=n>0&&n===tot; } };
  window.A_slvToggleAll = (cb)=>{ document.querySelectorAll('.slvchk').forEach(x=>{x.checked=cb.checked;}); A_slvCount(); };
  window.A_slvDelSel = async (btn)=>{ const ids=[...document.querySelectorAll('.slvchk:checked')].map(x=>x.value); if(!ids.length)return;
    if(!confirm((EN()?'Delete ':'ลบการลา ')+ids.length+(EN()?' selected leaves?':' รายการที่เลือก?')))return;
    btn.disabled=true; try{ await api('deleteStudentLeaves',{staffId:USER.staffId,leaveIds:ids}); toast((EN()?'Deleted ':'ลบแล้ว ')+ids.length); GO_('studentLeaves'); }catch(e){err(e);btn.disabled=false;} };
  window.A_slvEdit = (leaveId)=>{ const l=(window._SLV||[]).find(x=>x.LeaveID===leaveId)||{};
    modal(`<h3>✏️ ${esc(t('slv.title'))}</h3>
      <div class="muted" style="font-size:13px;margin-bottom:6px">${esc(l.nick||l.name||l.StudentID)}</div>
      <label class="field"><span>${EN()?'Date':'วันที่'}</span><input type="date" id="slvDate" value="${esc(String(l.Date||'').slice(0,10))}"/></label>
      <label class="field"><span>${esc(t('c.reason'))}</span><input id="slvReason" value="${esc(l.Reason||'')}"/></label>
      <button class="btn block" onclick="A_slvSave('${leaveId}',this)">${esc(t('c.save'))}</button>`);
  };
  window.A_slvSave = async (leaveId,btn)=>{ const m=btn.closest('.modal'); const g=id=>{const e=m.querySelector('#'+id);return e?e.value:'';};
    try{ await api('editStudentLeave',{staffId:USER.staffId,leaveId,date:g('slvDate'),reason:g('slvReason')}); m.remove(); confirmSaved(t('c.saved')); GO_('studentLeaves'); }catch(e){err(e);} };
  window.A_slvDel = async (leaveId)=>{ if(!confirm(t('manage.confirmDel')))return; try{ await api('deleteStudentLeave',{staffId:USER.staffId,leaveId}); toast(t('manage.deleted')); GO_('studentLeaves'); }catch(e){err(e);} };

  // ---- Admin: cleanse duplicate parents/students (preview → apply) ----
  window.A_dedup = async () => { let plan; try{ plan=await api('dedupData',{preview:true}); }catch(e){ return err(e); }
    const pg=plan.parentGroups||[], sg=plan.studentGroups||[];
    const grp=(title,arr,idk)=>`<h4 style="margin:8px 0 4px">${esc(title)} — ${EN()?'to delete':'จะลบ'} ${arr.reduce((n,g)=>n+g.dels.length,0)}</h4>${
      arr.length?arr.map(g=>`<div class="list-item" style="font-size:12.5px"><span><b>${esc(g.name||'')}</b><br><small class="muted">${EN()?'keep':'เก็บ'} ${esc(g.keepId)}${g.keepHasLine?' 🟢LINE':''}${g.keepLinked?' 🔗':''} · ${EN()?'delete':'ลบ'} ${g.dels.map(d=>esc(d.id)).join(', ')}</small></span></div>`).join(''):`<small class="muted">${EN()?'none':'ไม่มี'}</small>`}`;
    modal(`<h3>🧹 ${esc(t('dedup.title'))}</h3>
      <p class="muted" style="font-size:12px">${EN()?'Keeps the parent with a LINE login and the student linked to a parent; deletes the rest. A daily backup is kept.':'เก็บผู้ปกครองที่มี LINE และนักเรียนที่ผูกกับผู้ปกครองแล้ว · ลบที่เหลือ · มีสำรองข้อมูลรายวัน'}</p>
      <div style="background:#fff3e0;border-radius:8px;padding:8px;font-size:13px;color:#e65100"><b>${EN()?'Will delete':'จะลบ'}: ${plan.willDelete.parents} ${EN()?'parents':'ผู้ปกครอง'} · ${plan.willDelete.students} ${EN()?'students':'นักเรียน'}</b> <small>(${EN()?'now':'ปัจจุบัน'} ${plan.counts.parents}/${plan.counts.students})</small></div>
      <div style="max-height:44vh;overflow:auto">${grp(EN()?'Parents':'ผู้ปกครอง',pg)}${grp(EN()?'Students':'นักเรียน',sg)}</div>
      ${(plan.willDelete.parents+plan.willDelete.students)?`<button class="btn block pink" onclick="A_dedupApply(this)">🗑️ ${EN()?'Delete duplicates':'ลบข้อมูลซ้ำ'} (${plan.willDelete.parents+plan.willDelete.students})</button>`:`<div class="muted" style="text-align:center;padding:8px">${EN()?'No duplicates found':'ไม่พบข้อมูลซ้ำ'}</div>`}
      <button class="btn outline block" style="margin-top:6px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_dedupApply = async (btn)=>{ if(!confirm(EN()?'Permanently delete the duplicate rows? (a daily backup exists)':'ยืนยันลบข้อมูลซ้ำถาวร? (มีสำรองข้อมูลรายวัน)'))return;
    btn.disabled=true; try{ const r=await api('dedupData',{}); const m=btn.closest('.modal'); if(m)m.remove();
      toast((EN()?'Deleted ':'ลบแล้ว ')+r.deleted.parents+'P/'+r.deleted.students+'S'); GO('manage'); }catch(e){err(e);btn.disabled=false;} };

  // Require-check-in toggles — moved into a modal (opened from the menu)
  window.A_requireCI = async () => { const staff=window._PERM_STAFF||await api('listStaff');
    modal(`<h3>⏱️ ${esc(t('lbl.requireCI'))}</h3><p class="muted" style="font-size:12px">${EN()?'Turn OFF for positions that need not clock in (e.g. leaders). Press Save after changes.':'ปิดสำหรับตำแหน่งที่ไม่ต้องลงเวลา (เช่น หัวหน้างาน) — กด บันทึก หลังเปลี่ยน'}</p>
      <div style="max-height:56vh;overflow:auto">${staff.map(s=>`<div class="list-item"><span><b>${esc(nm(s))}</b> <small class="muted">${esc(s.PositionLevel||'')}</small></span>
        <label class="switch"><input type="checkbox" data-sid="${s.StaffID}" ${s.RequireCheckin!==false?'checked':''}><span class="slider"></span></label></div>`).join('')}</div>
      <button class="btn block" style="margin-top:8px" onclick="A_saveReqCI(this)">💾 ${esc(t('c.save'))}</button>`);
  };
  // Admin forms must read the LIVE records (gas mode), not the stale window.MOCK arrays.
  // manage()/home() fill this cache; the edit forms + dropdowns read from it (fallback to MOCK).
  window.A_CACHE = { staff:[], students:[], parents:[], classes:[], plans:[], announcements:[], depts:[] };
  const findStaff   = id => (A_CACHE.staff||[]).find(x=>x.StaffID===id)     || (MOCK.staff||[]).find(x=>x.StaffID===id)     || {};
  const findStudent = id => (A_CACHE.students||[]).find(x=>x.StudentID===id) || (MOCK.students||[]).find(x=>x.StudentID===id) || {};
  const findParent  = id => (A_CACHE.parents||[]).find(x=>x.ParentID===id)   || (MOCK.parents||[]).find(x=>x.ParentID===id)   || {};
  const findAnn     = id => (A_CACHE.announcements||[]).find(x=>x.AnnID===id) || (MOCK.announcements||[]).find(x=>x.AnnID===id) || {};
  const A_classes   = () => (A_CACHE.classes&&A_CACHE.classes.length)?A_CACHE.classes:(MOCK.classes||[]);
  // the departments master (Nursery Baby/1/2/Premium…) is the real list of nurseries; CLASSES only has
  // the rows that happen to have a homeroom teacher. Offer every department, plus whatever `cur` already is.
  const A_deptNames = () => ((A_CACHE.depts&&A_CACHE.depts.length)?A_CACHE.depts:(MOCK.config.Departments||[])).slice();
  function A_classOptions(cur){
    const out=A_deptNames();
    A_classes().forEach(c=>{ if(c.ClassName && out.indexOf(c.ClassName)<0) out.push(c.ClassName); });
    if(cur && out.indexOf(cur)<0) out.unshift(cur);
    return out;
  }
  const A_plans     = () => (A_CACHE.plans&&A_CACHE.plans.length)?A_CACHE.plans:((MOCK.config&&MOCK.config.Plans)||[]);
  // generic client-side list filter + collapsible section (Admin manage). Sections start collapsed.
  window.A_toggleSec = (btn)=>{ const b=btn.closest('.secw'); const body=b.querySelector('.secbody'); const open=body.hasAttribute('hidden'); if(open)body.removeAttribute('hidden');else body.setAttribute('hidden',''); btn.querySelector('.caret').textContent=open?'▲':'▼'; };
  window.A_search = (inp)=>{ const b=inp.closest('.secw'); const q=inp.value.trim().toLowerCase(); b.querySelectorAll('.list-item').forEach(it=>{ it.style.display = (!q || it.dataset.k && it.dataset.k.indexOf(q)>=0) ? '' : 'none'; }); };
  const secHead = (icon,title,count,addBtn)=>`<div class="spread" style="cursor:pointer" onclick="A_toggleSec(this.querySelector('.sectog'))"><h3 style="margin:0">${icon} ${esc(title)} <span class="pill info">${count}</span></h3><span class="row" onclick="event.stopPropagation()">${addBtn||''}<button class="btn sm outline sectog" onclick="A_toggleSec(this)"><span class="caret">▼</span></button></span></div>`;
  const searchBox = ph=>`<input class="asearch" placeholder="🔎 ${esc(ph)}" oninput="A_search(this)" style="width:100%;margin:8px 0;padding:8px 10px;border:1px solid var(--line);border-radius:8px"/>`;

  SCREENS.Admin.manage = async () => {
    const [staff,students,parents,pm,groups,exported,wds,classes,plans,depts,linkCounts]=await Promise.all([api('listStaff'),api('listStudents'),api('listParents'),api('permMatrix'),api('listStaffGroups'),api('listExportedStudents'),api('listWithdrawals',{pending:true}),api('listClasses'),api('getPlans'),api('listDepartments'),api('parentLinkCounts').catch(()=>({}))]);
    window._LINKCOUNTS=linkCounts||{};
    A_CACHE.staff=staff; A_CACHE.students=students; A_CACHE.parents=parents; A_CACHE.classes=classes||[]; A_CACHE.plans=plans||[]; A_CACHE.groups=groups||[]; A_CACHE.depts=depts||[];
    const CAPS=[['students','perm.students'],['staff','perm.staff'],['payroll','perm.payroll'],['parentPII','perm.parentPII'],['edit','perm.edit'],['approve','perm.approve']];
    const ROLES=['Admin','Leader','Teacher','Parent'];
    window._PERM=pm; window._PERM_STAFF=staff;
    // Categorized admin menu — grouped so related tools sit together (e.g. all the OT/time tools).
    const MENU=[
      {t:EN()?'👥 People & classes':'👥 บุคลากร & ชั้นเรียน', items:[
        ['🔁',t('manage.organize'),"GO_('organize')"],
        ['🏫',t('manage.departments'),'A_departments()'],
        ['📦',EN()?'Packages':'แพ็กเกจ','A_packages()'],
        ['🕑',t('manage.groups'),'A_groups()'],
        ['⏱️',t('lbl.requireCI'),'A_requireCI()'],
      ]},
      {t:EN()?'⏰ Time & OT':'⏰ เวลา & OT', items:[
        ['⏰',t('ot.adminOT'),'A_staffOT()'],
        ['⏰',EN()?'Student late-pickup OT':'OT รับช้า (นักเรียน)','A_studentOT()'],
        ['⏰',t('att.adminTitle'),'A_timeRequests()'],
        ['🔁',t('corg.adminTitle'),'A_classChanges()'],
      ]},
      {t:EN()?'📄 Reports & records':'📄 รายงาน & เอกสาร', items:[
        ['📒',t('jr.admin'),'A_journals()'],
        ['📍',EN()?'On-behalf check-in log':'ประวัติเช็คอิน-เอาท์แทน','A_checkinLog()'],
        ['🏠',t('slv.title'),"GO_('studentLeaves')"],
        ['🛡️',t('ins2.manage'),'A_insurance()'],
        ['📈',t('dspm.manageTitle'),"GO_('dspmCriteria')"],
        ['📜',t('act.open'),'A_activityLog()'],
      ]},
      {t:EN()?'⚙️ System settings':'⚙️ ตั้งค่าระบบ', items:[
        ['⚙️',t('manage.settings'),'A_settings()'],
        ['🗓️',t('manage.holidays'),"GO_('holidays')"],
        ['📥',t('manage.importExport'),"GO_('importExport')"],
        ['🔐',t('lbl.perms'),'A_perms()'],
        ['🧹',t('dedup.title'),'A_dedup()'],
      ]},
    ];
    // some i18n labels already start with an emoji; strip it since the button shows its own icon
    const stripIc=s=>{ const r=String(s).replace(/^[\p{Extended_Pictographic}️‍\s]+/u,'').trim(); return r||String(s); };
    const amenu=MENU.map(g=>`<div class="card amenu"><h3>${esc(g.t)}</h3><div class="amenu-grid">${
      g.items.map(([ic,label,fn])=>`<button class="amenu-btn" onclick="${fn}"><span class="amenu-ic">${ic}</span><span>${esc(stripIc(label))}</span></button>`).join('')
    }</div></div>`).join('');
    app.innerHTML=`<h2 class="page">${esc(t('title.manage'))}</h2>
      ${wds.length?`<div class="card" style="background:#fff8e1;border-color:#f0e3b0"><h3>🚪 ${esc(t('wd.requests'))} (${wds.length})</h3>
        ${wds.map(w=>`<div class="list-item"><span><b>${esc(EN()?w.nameEN:w.name)}</b> <small class="muted">${esc(w.class||'')}</small><br><small class="muted">${esc(t('wd.reason.'+w.Reason)||w.Reason)}${w.Detail?' · '+esc(w.Detail):''} · ${esc(w.CreatedDate)}</small></span>
          <button class="btn sm pink" onclick="A_processWithdraw('${w.WithdrawID}','${w.StudentID}','${w.Reason}')">${esc(t('wd.process'))}</button></div>`).join('')}</div>`:''}
      ${amenu}
      <div class="card secw">${secHead('👩‍🏫',t('c.staff'),staff.length,`<button class="btn sm" onclick="event.stopPropagation();A_staffForm()">+ ${esc(t('manage.add'))}</button>`)}
        <div class="secbody" hidden>${searchBox(EN()?'name / nickname / dept':'ชื่อ / ชื่อเล่น / แผนก')}
        ${staff.map(s=>`<div class="list-item" data-k="${esc((s.NameTH+' '+(s.NameEN||'')+' '+(s.Nickname||'')+' '+(s.Position||'')+' '+(s.Department||'')).toLowerCase())}"><span style="display:flex;gap:8px;align-items:center">${personAvatar(s)}<span><b>${esc(dispNick(s))}</b> <small class="muted">${esc(nm(s))}</small><br><small class="muted">${esc(s.Position||'')} · ${esc(deptLabel(s))} · 🕑 ${esc(groupLabel(s.StaffGroup))}${groupHours(s.StaffGroup)?' ('+esc(groupHours(s.StaffGroup))+')':''}</small><br><small class="muted">${esc(t('staff.start'))} ${esc(s.StartDate||'-')} · ${esc(t('staff.tenure'))} ${esc(tenure(s.StartDate))}</small></span></span><span class="row"><button class="btn sm outline" onclick="A_staffForm('${s.StaffID}')">✏️</button><button class="btn sm pink" onclick="A_delStaff('${s.StaffID}')">🗑️</button></span></div>`).join('')}</div></div>
      <div class="card secw">${secHead('👪',t('manage.parents'),parents.length,`<button class="btn sm" onclick="event.stopPropagation();A_parentForm()">+ ${esc(t('manage.add'))}</button>`)}
        <div class="secbody" hidden>${searchBox(EN()?'name / phone':'ชื่อ / เบอร์')}
        ${parents.map(p=>{ const lc=(window._LINKCOUNTS||{})[p.ParentID]||0; const lcBadge=`<span class="pill ${lc?'ok':'bad'}" style="font-size:10px" title="${EN()?'linked children':'จำนวนบุตรที่ผูก'}">👶 ${lc}</span>`;
          return `<div class="list-item" data-k="${esc((p.NameTH+' '+(p.NameEN||'')+' '+(p.Nickname||'')+' '+(p.NicknameEN||'')+' '+(p.Phone||'')+' '+(p.Relationship||'')).toLowerCase())}"><span style="display:flex;gap:8px;align-items:center">${personAvatar(p)}<span><b>${esc(parentDisp(p))}</b> ${lcBadge} <small class="muted">${esc(titledName(p))} · ${esc(p.Relationship||'')} · ${phoneLink(p.Phone)}</small></span></span><span class="row"><button class="btn sm outline" onclick="A_parentLinks('${p.ParentID}')" title="${EN()?'linked children':'บุตรที่ผูก'}">🔗</button><button class="btn sm outline" onclick="A_parentForm('${p.ParentID}')">✏️</button><button class="btn sm pink" onclick="A_delParent('${p.ParentID}')">🗑️</button></span></div>`; }).join('')}</div></div>
      <div class="card secw">${secHead('👶',EN()?'Students':'นักเรียน',students.length,`<button class="btn sm" onclick="event.stopPropagation();A_genBills()">📅 ${esc(t('bill.genTitle'))}</button>`)}
        <div class="secbody" hidden>${searchBox(EN()?'name / nickname / class':'ชื่อ / ชื่อเล่น / ชั้นเรียน')}
        ${students.map(s=>`<div class="list-item" data-k="${esc((s.NameTH+' '+(s.NameEN||'')+' '+(s.Nickname||'')+' '+(s.NicknameEN||'')+' '+(s.Class||'')+' '+(s.NationalID||'')).toLowerCase())}"><span>${studentAvatar(s)} <b>${esc(dispNick(s))}</b> <small class="muted">${esc(nm(s))} · ${esc(s.Class)} · ${esc(ageYM(s.DOB))}${s.InsuranceHas?' · 🛡️':''}</small><br><small class="muted">${EN()?'ID':'บัตร'}: ${esc(s.NationalID||'-')}</small></span><span class="row"><button class="btn sm outline" onclick="A_studentForm('${s.StudentID}')">✏️</button><button class="btn sm" onclick="A_issueBill('${s.StudentID}')">🧾</button><button class="btn sm" onclick="A_charges('${s.StudentID}')">💵</button><button class="btn sm outline" onclick="A_vaccines('${s.StudentID}')">💉</button><button class="btn sm gray" onclick="A_exportStudent('${s.StudentID}')">📤</button><button class="btn sm pink" onclick="A_removeStudent('${s.StudentID}')" title="${esc(t('wd.remove'))}">🚪</button></span></div>`).join('')}</div></div>`;
  };
  // navigate to an admin sub-screen (kept off the bottom nav)
  var ADMIN_SUB_organize, ADMIN_SUB_holidays, ADMIN_SUB_importExport;
  const ADMIN_SUB = { organize:()=>ADMIN_SUB_organize(), holidays:()=>ADMIN_SUB_holidays(), importExport:()=>ADMIN_SUB_importExport(), dspmCriteria:()=>A_dspmCriteria(), studentLeaves:()=>A_studentLeaves() };
  window.GO_=(k)=>{ CURRENT='manage'; setNav('manage'); (ADMIN_SUB[k]||(()=>{}))(); window.scrollTo(0,0); };

  // ---- Staff CRUD ----
  window.A_staffForm=(id)=>{ const s=id?findStaff(id):{}; const groups=(A_CACHE.groups&&A_CACHE.groups.length)?A_CACHE.groups:MOCK.staffGroups;
    const f=(k,label,val,type)=>`<label class="field"><span>${esc(label)}</span><input id="sf_${k}" type="${type||'text'}" value="${esc(val!=null?val:'')}"/></label>`;
    // departments master (Nursery Baby/1/2/Premium…), NOT the CLASSES list — show ALL of them
    const depts=A_classOptions(s.Department); // keeps the staff's current value even if not in the master
    // a staff row whose StaffGroup isn't in STAFF_GROUPS resolves no work hours — surface it instead of
    // silently snapping the <select> to the first option (which would rewrite the value on save)
    const grpOpts=groups.slice();
    if(s.StaffGroup && !grpOpts.some(g=>g.GroupName===s.StaffGroup)) grpOpts.unshift({GroupName:s.StaffGroup,GroupNameEN:(EN()?'⚠️ unknown group':'⚠️ กลุ่มไม่ถูกต้อง')});
    modal(`<h3>${id?'✏️':'➕'} ${esc(t('c.staff'))}</h3>
      <div class="grid2">${f('NameTH',t('reg.nameTH'),s.NameTH)}${f('NameEN',t('reg.nameEN'),s.NameEN)}</div>
      <div class="grid2">${f('Nickname',t('reg.nickname'),s.Nickname)}${f('NicknameEN',t('reg.nicknameEN'),s.NicknameEN)}</div>
      <div class="grid2">${f('DOB',t('reg.dob'),s.DOB,'date')}${f('Position',t('manage.position'),s.Position)}</div>
      <div class="grid2">
        <label class="field"><span>${esc(t('manage.level'))}</span><select id="sf_PositionLevel">${['Admin','Leader','Officer','Assistant','Staff'].map(l=>`<option ${s.PositionLevel===l?'selected':''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="field"><span>${EN()?'Work group & time (admin-managed)':'กลุ่มพนักงาน & เวลา (แอดมินจัดการ)'}</span>
          <div class="row" style="gap:6px"><select id="sf_StaffGroup" style="flex:1">${grpOpts.map(g=>`<option value="${esc(g.GroupName)}" ${s.StaffGroup===g.GroupName?'selected':''}>${esc(g.GroupName)}${g.CheckInTime?` (${esc(g.CheckInTime)}–${esc(g.CheckOutTime||'')})`:''}</option>`).join('')}</select><button type="button" class="btn sm outline" onclick="A_groups()" title="${EN()?'Edit groups & times':'แก้ไขกลุ่ม & เวลา'}">✏️</button></div></label></div>
      <div class="jsec"><b style="font-size:13px">🏫 ${EN()?'Department(s) responsible (choose one or more)':'แผนกที่รับผิดชอบ (เลือกได้หลายแผนก)'}</b>
        <label style="display:block;margin:4px 0"><input type="checkbox" id="sf_AllDept" style="width:auto" ${s.Department==='*'||s.Classes==='*'?'checked':''} onchange="SF_allDept(this)"/> ${EN()?'All departments (head teacher)':'ทุกแผนก (หัวหน้าครู)'}</label>
        <div id="sf_DeptList" ${(s.Department==='*'||s.Classes==='*')?'style="opacity:.4;pointer-events:none"':''}>${A_classOptions(s.Department&&s.Department!=='*'?s.Department:'').map(d=>`<label style="margin-right:10px;font-size:13px"><input type="checkbox" class="sfDept" value="${esc(d)}" style="width:auto" ${String(s.Department||'').split(',').map(x=>x.trim()).indexOf(d)>=0?'checked':''}/> ${esc(d)}</label>`).join('')||`<small class="muted">${EN()?'no departments yet':'ยังไม่มีแผนก'}</small>`}</div>
        <small class="muted" style="font-size:11px">${EN()?'Department = responsibility (can be several). Work time is set by the group, not the department.':'แผนก = ส่วนที่รับผิดชอบ (มีได้หลายแผนก) · เวลาเข้างานกำหนดที่กลุ่มพนักงาน ไม่ผูกกับแผนก'}</small></div>
      <label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="sf_CanClassOrg" style="width:auto" ${(s.CanClassOrg===true||s.CanClassOrg===1||['YES','TRUE'].indexOf(String(s.CanClassOrg||'').toUpperCase())>=0)?'checked':''}/> 🔁 ${EN()?'Allow this teacher to organize classes (move teachers/students, like Admin)':'ให้ครูคนนี้จัดชั้นเรียนได้ (ย้ายครู/นักเรียน เหมือนแอดมิน)'}</label>
      <div class="grid2">${f('Phone',t('reg.phone'),phoneFmt(s.Phone))}${f('NationalID',t('reg.nationalId'),s.NationalID)}</div>
      <div class="grid2">${f('StartDate',t('staff.startDate'),s.StartDate,'date')}${f('BaseSalary',t('pay.baseSalary'),s.BaseSalary,'number')}</div>
      <label class="field"><span>🔗 LINE ID ${s.LineUID?'✅':''}</span><input id="sf_LineUID" value="${esc(s.LineUID||'')}" placeholder="Uxxxxxxxxxxxxxxxx"/></label>
      <div class="card" style="background:#f7f9fc;padding:8px"><small class="muted">${EN()?'To let this staff log in: they open the app via LINE → "New user or already registered?" shows their LINE ID → paste it here and Save.':'ให้ครูเข้าแอปผ่าน LINE → หน้า "New user or already registered?" จะโชว์ LINE ID ของครู → คัดลอกมาวางช่องนี้แล้วกดบันทึก'}</small></div>
      ${photoField('sf_Photo',t('manage.photo'),s.Photo,true)}
      ${id?`<div class="card" style="background:#f7f9fc;padding:8px"><b style="font-size:13px">🔑 ${EN()?'Salary-slip password':'รหัสผ่าน (เปิดสลิปเงินเดือน)'}</b>
        <div class="row" style="margin-top:6px"><button type="button" class="btn sm outline" onclick="A_viewPw('${id}')">👁️ ${EN()?'View':'ดูรหัสผ่าน'}</button><button type="button" class="btn sm pink" onclick="A_resetPw('${id}')">♻️ ${EN()?'Reset':'รีเซ็ต'}</button></div>
        <div id="pwView_${id}" class="muted" style="font-size:12.5px;margin-top:6px"></div></div>`:''}
      <button class="btn block" onclick="A_saveStaff(this,'${id||''}')">${esc(t('c.save'))}</button>`);
  };
  window.A_saveStaff=async(btn,id)=>{ const m=btn.closest('.modal'); const v=k=>{ const e=m.querySelector('#sf_'+k); return e?e.value.trim():''; };
    // Department = the department(s) the staff is responsible for (multi). '*' = all (head teacher).
    const allDept=m.querySelector('#sf_AllDept')&&m.querySelector('#sf_AllDept').checked;
    const dept = allDept ? '*' : [...m.querySelectorAll('.sfDept:checked')].map(x=>x.value).join(',');
    const canOrg=m.querySelector('#sf_CanClassOrg')&&m.querySelector('#sf_CanClassOrg').checked;
    const data={NameTH:v('NameTH'),NameEN:v('NameEN'),Nickname:v('Nickname'),NicknameEN:v('NicknameEN'),DOB:v('DOB'),Position:v('Position'),Department:dept,StaffGroup:v('StaffGroup'),PositionLevel:v('PositionLevel'),Phone:v('Phone'),NationalID:v('NationalID'),LineUID:v('LineUID'),StartDate:v('StartDate'),BaseSalary:+v('BaseSalary')||0,Classes:dept,CanClassOrg:canOrg?'YES':''};
    const sfp=photoVal(m,'sf_Photo'); if(sfp) data.Photo=sfp;
    try{ await api('saveStaff',{staffId:id||null,data}); m.remove(); confirmSaved(t('c.saved')); GO('manage'); }catch(e){err(e);} };
  window.SF_allDept=(cb)=>{ const box=document.getElementById('sf_DeptList'); if(box){ box.style.opacity=cb.checked?'.4':''; box.style.pointerEvents=cb.checked?'none':''; } };
  window.A_delStaff=async(id)=>{ if(!confirm(t('manage.confirmDel')))return; try{ await api('deleteStaff',{staffId:id}); toast(t('manage.deleted')); GO('manage'); }catch(e){err(e);} };
  window.A_viewPw=async(id)=>{ const box=document.getElementById('pwView_'+id); try{ const r=await api('getStaffPassword',{staffId:id}); if(box)box.innerHTML=`${EN()?'Current password':'รหัสผ่านปัจจุบัน'}: <b>${esc(r.password)}</b>`; }catch(e){err(e);} };
  window.A_resetPw=async(id)=>{ if(!confirm(EN()?'Reset this staff\'s password? A temporary password will be shown.':'รีเซ็ตรหัสผ่านพนักงานคนนี้? ระบบจะแสดงรหัสชั่วคราว'))return;
    const box=document.getElementById('pwView_'+id); try{ const r=await api('adminResetPassword',{staffId:id}); if(box)box.innerHTML=`✅ ${EN()?'Reset. Temporary password':'รีเซ็ตแล้ว รหัสชั่วคราว'}: <b>${esc(r.tempPassword)}</b> — ${EN()?'staff must change it after unlocking':'พนักงานต้องเปลี่ยนใหม่หลังเข้าใช้'}`; toast(t('c.saved')); }catch(e){err(e);} };

  // ---- View-as: Admin previews the app as any role (stays logged in as admin; token is full-trust) ----
  let VIEW_AS_BACKUP=null;
  window.A_viewAs=async()=>{
    // the lists are normally cached by manage(); fetch them so View-As works straight from home
    if(!(A_CACHE.staff&&A_CACHE.staff.length) || !(A_CACHE.students&&A_CACHE.students.length)){
      try{ const [staff,students]=await Promise.all([api('listStaff'),api('listStudents')]); if(staff)A_CACHE.staff=staff; if(students)A_CACHE.students=students; }catch(e){}
    }
    modal(`<h3>👁️ ${EN()?'View as role':'ดูในมุมมอง (สลับ Role)'}</h3>
    <p class="muted" style="font-size:12px">${EN()?'Preview the app as another role. You stay logged in as admin — tap "Back to Admin" to return.':'ดูแอปในมุมมองบทบาทอื่น (ยังเป็นแอดมินอยู่) — กด "กลับเป็น Admin" เพื่อกลับ'}</p>
    <label class="field"><span>👩‍🏫 ${EN()?'As teacher / leader':'มุมมองครู / หัวหน้า'}</span><select id="va_staff"><option value="">—</option>${(A_CACHE.staff||[]).filter(s=>s.Role!=='Admin').map(s=>`<option value="${s.StaffID}">${esc(nmn(s))} · ${esc(s.PositionLevel||'')}</option>`).join('')}</select></label>
    <button class="btn block" onclick="A_viewAsStaff(this)">${EN()?'View as this staff':'ดูมุมมองครูคนนี้'}</button>
    <div style="height:12px"></div>
    <label class="field"><span>👪 ${EN()?'As parent of…':'มุมมองผู้ปกครองของ…'}</span><select id="va_stu"><option value="">—</option>${(A_CACHE.students||[]).map(s=>`<option value="${s.StudentID}">${esc(nmn(s))} · ${esc(s.Class||'')}</option>`).join('')}</select></label>
    <button class="btn block outline" onclick="A_viewAsParent(this)">${EN()?'View as this parent':'ดูมุมมองผู้ปกครอง'}</button>`); };
  window.A_viewAsStaff=(btn)=>{ const m=btn.closest('.modal'); const sid=m.querySelector('#va_staff').value; if(!sid){toast(EN()?'Pick a staff':'เลือกครูก่อน');return;} const s=findStaff(sid); m.remove();
    _enterViewAs({role:'Teacher',_roleKey:(s.PositionLevel==='Leader'?'Leader':'Teacher'),staffId:sid,nameEN:s.NameEN||s.NameTH||sid,nameTH:s.NameTH||sid}); };
  window.A_viewAsParent=(btn)=>{ const m=btn.closest('.modal'); const sid=m.querySelector('#va_stu').value; if(!sid){toast(EN()?'Pick a student':'เลือกนักเรียนก่อน');return;} const s=findStudent(sid); m.remove();
    _enterViewAs({role:'Parent',_roleKey:'Parent',parentId:s.ParentID,uid:s.ParentID||'',nameEN:(s.NameEN||s.NameTH)+' — parent',nameTH:(s.NameTH||'')+' — ผู้ปกครอง'}); };
  function _enterViewAs(ctx){ if(!VIEW_AS_BACKUP) VIEW_AS_BACKUP=USER; USER=Object.assign({_viewAs:true},ctx); setHeader(); GO('home'); _viewAsBar(); }
  window.A_exitViewAs=()=>{ if(VIEW_AS_BACKUP){ USER=VIEW_AS_BACKUP; VIEW_AS_BACKUP=null; } const b=document.getElementById('viewAsBar'); if(b)b.remove(); setHeader(); GO('home'); };
  function _viewAsBar(){ let b=document.getElementById('viewAsBar'); if(!b){ b=document.createElement('div'); b.id='viewAsBar'; document.body.appendChild(b); }
    b.style.cssText='position:fixed;bottom:66px;left:8px;right:8px;z-index:40;background:#1565C0;color:#fff;padding:8px 12px;border-radius:10px;display:flex;justify-content:space-between;align-items:center;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.25)';
    b.innerHTML=`<span>👁️ ${EN()?'Viewing as':'กำลังดูมุมมอง'}: <b>${esc(EN()?USER.nameEN:USER.nameTH)}</b></span><button onclick="A_exitViewAs()" style="background:#fff;color:#1565C0;border:none;padding:5px 12px;border-radius:6px;font-weight:700;cursor:pointer">${EN()?'Back to Admin':'กลับเป็น Admin'}</button>`; }

  // ---- Parent CRUD ----
  window.A_parentForm=(id)=>{ const p=id?findParent(id):{};
    const f=(k,label,val)=>`<label class="field"><span>${esc(label)}</span><input id="pf_${k}" value="${esc(val!=null?val:'')}"/></label>`;
    modal(`<h3>${id?'✏️':'➕'} ${esc(t('manage.parents'))}</h3>
      <div class="grid2"><label class="field"><span>${esc(t('reg.title'))}</span><select id="pf_Title">${['','นาย','นาง','นางสาว'].map(x=>`<option ${(p.Title||titleOf(p))===x?'selected':''}>${x}</option>`).join('')}</select></label>${f('NameTH',t('reg.nameTH'),p.NameTH)}</div>
      <div class="grid2">${f('NameEN',t('reg.nameEN'),p.NameEN)}${f('Nickname',t('reg.nickname'),p.Nickname)}</div>
      <div class="grid2">${f('NicknameEN',t('reg.nicknameEN'),p.NicknameEN)}${f('Relationship',t('reg.relationship'),p.Relationship)}</div>
      <div class="grid2">${f('NationalID',t('reg.nationalIdParent'),p.NationalID)}</div>
      <div class="grid2">${f('Phone',t('reg.mobile'),phoneFmt(p.Phone))}${f('OfficePhone',t('reg.officePhone'),phoneFmt(p.OfficePhone))}</div>
      <div class="grid2">${f('Occupation',t('reg.occupation'),p.Occupation)}${f('Workplace',t('reg.workplace'),p.Workplace)}</div>
      ${photoField('pf_Photo',t('reg.parentPhoto'),p.Photo,true)}
      <button class="btn block" onclick="A_saveParent(this,'${id||''}')">${esc(t('c.save'))}</button>`);
  };
  window.A_saveParent=async(btn,id)=>{ const m=btn.closest('.modal'); const v=k=>{ const e=m.querySelector('#pf_'+k); return e?e.value.trim():''; };
    const data={Title:v('Title'),NameTH:v('NameTH'),NameEN:v('NameEN'),Nickname:v('Nickname'),NicknameEN:v('NicknameEN'),Relationship:v('Relationship'),NationalID:v('NationalID'),Phone:v('Phone'),OfficePhone:v('OfficePhone'),Occupation:v('Occupation'),Workplace:v('Workplace')};
    const pfp=photoVal(m,'pf_Photo'); if(pfp) data.Photo=pfp;
    try{ await api('saveParent',{parentId:id||null,data}); m.remove(); confirmSaved(t('c.saved')); GO('manage'); }catch(e){err(e);} };
  window.A_delParent=async(id)=>{ if(!confirm(t('manage.confirmDel')))return; try{ await api('deleteParent',{parentId:id}); toast(t('manage.deleted')); GO('manage'); }catch(e){err(e);} };

  // ---- Student edit (incl. insurance) ----
  // choosing a package fills the arrive/leave time from the package's schedule (still editable per student)
  window.A_planFill=(sel)=>{ const pl=A_plans().find(p=>p.id===sel.value); if(!pl)return;
    const st=document.getElementById('stf_StartTime'), en=document.getElementById('stf_EndTime');
    if(st && pl.start) st.value=String(pl.start).slice(0,5);
    if(en && pl.end) en.value=String(pl.end).slice(0,5); };

  // ---- Package (Plan) CRUD: name / price / study time. Persists the whole list via savePlans. ----
  window.A_packages=async()=>{ const plans=await api('getPlans'); A_CACHE.plans=plans||[];
    const row=p=>`<div class="card" style="padding:8px"><div class="spread"><b>${esc(EN()?(p.labelEN||p.labelTH):(p.labelTH||p.labelEN))||p.id}</b><b style="color:#1565C0">${baht(p.price)}</b></div>
      <small class="muted">🕗 ${esc(p.start||'-')} – ${esc(p.end||'-')} น.</small>
      <div class="row" style="margin-top:6px"><button class="btn sm outline" onclick="A_pkgForm('${esc(p.id)}')">✏️ ${EN()?'Edit':'แก้ไข'}</button><button class="btn sm pink" onclick="A_pkgDelete('${esc(p.id)}')">🗑️ ${EN()?'Delete':'ลบ'}</button></div></div>`;
    modal(`<div class="spread"><h3>📦 ${EN()?'Packages':'แพ็กเกจการเรียน'}</h3><button class="btn sm" onclick="A_pkgForm()">+ ${esc(t('manage.add'))}</button></div>
      <p class="muted" style="font-size:12px">${EN()?'Name, price and study time per package. The time auto-fills a student’s arrive/leave time when you assign the package (still editable).':'ตั้งชื่อ ราคา และช่วงเวลาเรียนของแต่ละแพ็กเกจ · เวลาจะถูกนำไปใส่ให้นักเรียนอัตโนมัติเมื่อเลือกแพ็กเกจ (แก้ไขรายคนได้)'}</p>
      <div style="max-height:60vh;overflow:auto">${(plans||[]).length?plans.map(row).join(''):`<div class="card muted">${EN()?'No packages yet':'ยังไม่มีแพ็กเกจ'}</div>`}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_pkgForm=(id)=>{ const p=(A_CACHE.plans||[]).find(x=>x.id===id)||{};
    modal(`<h3>📦 ${id?(EN()?'Edit package':'แก้ไขแพ็กเกจ'):(EN()?'New package':'เพิ่มแพ็กเกจ')}</h3>
      <div class="grid2"><label class="field"><span>${EN()?'Name (TH)':'ชื่อ (ไทย)'}</span><input id="pk_th" value="${esc(p.labelTH||'')}" placeholder="เช่น รายเดือน 07:00–17:00"/></label>
        <label class="field"><span>${EN()?'Name (EN)':'ชื่อ (อังกฤษ)'}</span><input id="pk_en" value="${esc(p.labelEN||'')}"/></label></div>
      <label class="field"><span>${EN()?'Price / month (฿)':'ราคาต่อเดือน (฿)'}</span><input id="pk_price" type="number" min="0" value="${esc(p.price!=null?p.price:'')}"/></label>
      <div class="grid2"><label class="field"><span>🕗 ${EN()?'Arrive time':'เวลาเข้าเรียน'}</span><input id="pk_start" type="time" value="${esc(String(p.start||'').slice(0,5))}"/></label>
        <label class="field"><span>🕔 ${EN()?'Leave time':'เวลาเลิกเรียน'}</span><input id="pk_end" type="time" value="${esc(String(p.end||'').slice(0,5))}"/></label></div>
      <button class="btn block" onclick="A_pkgSave(this,'${id||''}')">${esc(t('c.save'))}</button>`);
  };
  window.A_pkgSave=async(btn,id)=>{ const m=btn.closest('.modal'); const v=s=>{ const e=m.querySelector(s); return e?e.value.trim():''; };
    const th=v('#pk_th'), en=v('#pk_en'); if(!th&&!en){ toast(EN()?'Enter a name':'ใส่ชื่อแพ็กเกจ'); return; }
    const rec={ id:id||undefined, labelTH:th||en, labelEN:en||th, price:Number(v('#pk_price'))||0, start:v('#pk_start'), end:v('#pk_end') };
    const plans=(A_CACHE.plans||[]).slice();
    if(id){ const i=plans.findIndex(x=>x.id===id); if(i>=0) plans[i]=Object.assign({},plans[i],rec); else plans.push(rec); }
    else plans.push(rec);
    try{ const r=await api('savePlans',{plans}); A_CACHE.plans=r.plans||plans; MOCK.config.Plans=A_CACHE.plans; m.remove(); confirmSaved(t('c.saved')); A_packages(); }catch(e){err(e);} };
  window.A_pkgDelete=async(id)=>{ if(!confirm(EN()?'Delete this package? Students already on it keep their saved time.':'ลบแพ็กเกจนี้? นักเรียนที่ใช้อยู่จะยังคงเวลาที่บันทึกไว้'))return;
    const plans=(A_CACHE.plans||[]).filter(x=>x.id!==id);
    try{ const r=await api('savePlans',{plans}); A_CACHE.plans=r.plans||plans; MOCK.config.Plans=A_CACHE.plans; toast(t('manage.deleted')); const m=document.querySelector('.modal'); if(m)m.remove(); A_packages(); }catch(e){err(e);} };

  window.A_studentForm=(id)=>{ const s=findStudent(id);
    const f=(k,label,val,type)=>`<label class="field"><span>${esc(label)}</span><input id="stf_${k}" type="${type||'text'}" value="${esc(val!=null?val:'')}"/></label>`;
    modal(`<h3>✏️ ${esc(nm(s))}</h3>
      <div class="grid2">${f('NameTH',t('reg.nameTH'),s.NameTH)}${f('NameEN',t('reg.nameEN'),s.NameEN)}</div>
      <div class="grid2">${f('Nickname',t('reg.nickname'),s.Nickname)}${f('NicknameEN',t('reg.nicknameEN'),s.NicknameEN)}</div>
      <div class="grid2">${f('NationalID',t('reg.nationalIdStudent'),s.NationalID)}
        <label class="field"><span>${esc(t('manage.class'))}</span><select id="stf_Class">${A_classOptions(s.Class).map(c=>`<option ${s.Class===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label></div>
      <div class="grid2"><label class="field"><span>${esc(t('reg.plan'))}</span><select id="stf_Plan" onchange="A_planFill(this)"><option value="">${esc(t('manage.noPlan'))}</option>${A_plans().map(p=>`<option value="${p.id}" ${s.Plan===p.id?'selected':''}>${esc(EN()?p.labelEN:p.labelTH)} · ${baht(p.price)}</option>`).join('')}</select></label>
        ${photoField('stf_Photo',t('growth.photo'),s.Photo,true)}</div>
      <div class="grid2">${f('Allergy',t('reg.allergy'),s.Allergy)}${f('MedicalHistory',t('reg.chronic'),s.MedicalHistory)}</div>
      <div class="grid2">
        <label class="field"><span>🕗 ${EN()?'Arrive time':'เวลาเข้าเรียน'}</span><input id="stf_StartTime" type="time" value="${esc(String(s.StartTime||'').slice(0,5))}" placeholder="08:00"/></label>
        <label class="field"><span>🕔 ${EN()?'Leave time (OT after this)':'เวลาเลิกเรียน (คิด OT หลังเวลานี้)'}</span><input id="stf_EndTime" type="time" value="${esc(String(s.EndTime||'').slice(0,5))}" placeholder="17:00"/></label></div>
      <small class="muted" style="display:block;margin:-2px 0 6px">${EN()?'Blank = use the plan default. Set individually, e.g. 07:00–17:00 vs 08:00–18:00.':'เว้นว่าง = ใช้ค่าตามแพ็กเกจ · ตั้งรายบุคคลได้ เช่น 07:00–17:00 หรือ 08:00–18:00'}</small>
      <label class="field"><span>⏰ ${EN()?'OT rate / hour (blank = school default)':'ค่า OT ต่อชั่วโมง (เว้นว่าง = ใช้ค่าเริ่มต้นของโรงเรียน)'}</span>
        <input id="stf_OTRate" type="number" min="0" value="${esc(s.OTRate!=null&&s.OTRate!==''?s.OTRate:'')}" placeholder="${esc(MOCK.config.OTRatePerHour||100)}"/></label>
      <label class="field"><span>🕕 ${EN()?'OT-free until (grace cutoff — blank = leave time)':'รับได้ถึง (ไม่คิด OT ก่อนเวลานี้ — เว้นว่าง = เวลาเลิกเรียน)'}</span>
        <input id="stf_OTGraceUntil" type="time" value="${esc(String(s.OTGraceUntil||'').slice(0,5))}" placeholder="18:00"/></label>
      <small class="muted" style="display:block;margin:-2px 0 6px">${EN()?'e.g. child on the 17:00 rate but allowed pickup to 18:00 with no OT → set 18:00. OT is charged only after this time.':'เช่น เด็กเรท 17:00 แต่อนุญาตให้รับถึง 18:00 โดยไม่คิด OT → ตั้ง 18:00 · จะคิด OT เฉพาะหลังเวลานี้'}</small>
      <label class="field"><span>📝 ${EN()?'Rate note (shown to the parent)':'หมายเหตุเรท (แสดงให้ผู้ปกครองเห็น)'}</span>
        <input id="stf_RateNote" value="${esc(s.RateNote||'')}" placeholder="${EN()?'e.g. Special: pickup until 18:00, no OT':'เช่น สิทธิพิเศษ: รับได้ถึง 18:00 ไม่คิด OT'}"/></label>
      <hr style="border:none;border-top:1px solid #eee;margin:8px 0">
      <label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="stf_Ins" ${s.InsuranceHas?'checked':''} style="width:auto" onchange="document.getElementById('insBox').hidden=!this.checked"/> 🛡️ ${esc(t('ins.has'))}</label>
      <div id="insBox" ${s.InsuranceHas?'':'hidden'}>
        <div class="grid2">${f('InsurancePolicyNo',t('ins.policy'),s.InsurancePolicyNo)}${f('InsuranceCompany',t('ins.company'),s.InsuranceCompany)}</div>
        ${f('InsuranceExpiry',t('ins.expiry'),s.InsuranceExpiry,'date')}
        ${photoField('stf_InsCard',t('ins.card'),s.InsuranceCardImage,false)}</div>
      ${s.DriveFolderUrl?`<div class="card" style="background:#f7f9fc;padding:8px"><small class="muted">📁 ${esc(t('folder.student'))}<br><code style="font-size:11px">${esc(s.DriveFolderUrl)}</code><br>${esc(t('folder.note'))}</small></div>`:''}
      ${id?`<button class="btn block outline" onclick="A_studentLinks('${id}')">🔗 ${EN()?'Linked parents / unlink':'ผู้ปกครองที่ผูก / ยกเลิกการผูก'}</button>`:''}
      <button class="btn block" onclick="A_saveStudent(this,'${id}')">${esc(t('c.save'))}</button>`);
  };
  // Admin: list the parents linked to a child and unlink one (child stays enrolled — this is NOT a withdrawal).
  window.A_studentLinks=async(sid)=>{ const d=await api('studentLinkedParents',{studentId:sid});
    modal(`<h3>🔗 ${EN()?'Linked parents':'ผู้ปกครองที่ผูกกับ'} ${esc(d.nick||d.name||sid)}</h3>
      <p class="muted" style="font-size:12px">${EN()?'Unlink detaches this parent from the child. The child stays enrolled (this is not a withdrawal).':'ยกเลิกการผูก = ตัดผู้ปกครองคนนี้ออกจากเด็ก โดยเด็กยังเรียนอยู่ในระบบ (ไม่ใช่การลาออก)'}</p>
      ${(d.parents||[]).length?d.parents.map(pa=>`<div class="list-item"><span><b>${esc(pa.nick||pa.name||pa.parentId||pa.uid)}</b> ${pa.phone?`<small class="muted">${esc(phoneFmt(pa.phone))}</small>`:''} <span class="pill info" style="font-size:10px">${pa.via==='link'?'LINE':'legacy'}</span></span><button class="btn sm pink" onclick="A_unlink('${esc(sid)}','${esc(pa.parentId||'')}','${esc(pa.uid||'')}',this)">✂️ ${EN()?'Unlink':'ยกเลิกผูก'}</button></div>`).join(''):`<div class="card muted">${EN()?'No linked parents':'ไม่มีผู้ปกครองที่ผูกอยู่'}</div>`}
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  // Admin: the children a PARENT is linked to (reverse view) — shows how many + who, with unlink per child.
  window.A_parentLinks=async(pid)=>{ let d; try{ d=await api('parentLinkedStudents',{parentId:pid}); }catch(e){ err(e); return; }
    const kids=d.students||[];
    modal(`<h3>🔗 ${EN()?'Children linked to':'บุตรที่ผูกกับ'} ${esc(d.nick||d.name||pid)} <span class="pill ${kids.length?'ok':'bad'}" style="font-size:11px">👶 ${kids.length}</span></h3>
      <p class="muted" style="font-size:12px">${EN()?'These are the students this parent can see & pay for. Unlink detaches one (the child stays enrolled).':'รายชื่อนักเรียนที่ผู้ปกครองคนนี้เห็นและชำระเงินได้ · ยกเลิกผูก = ตัดออก (เด็กยังเรียนอยู่)'}</p>
      ${kids.length?kids.map(s=>`<div class="list-item"><span><b>${esc(s.nick||s.name||s.studentId)}</b> <small class="muted">${esc(s.name||'')} · ${esc(s.class||(EN()?'no class':'ยังไม่จัดชั้น'))}${String(s.status).toLowerCase()!=='active'?' · <span style="color:#c62828">'+esc(s.status)+'</span>':''}</small> <span class="pill info" style="font-size:10px">${s.via==='link'?'LINE':'legacy'}</span></span><button class="btn sm pink" onclick="A_unlinkFromParent('${esc(s.studentId)}','${esc(pid)}',this)">✂️ ${EN()?'Unlink':'ยกเลิกผูก'}</button></div>`).join(''):`<div class="card muted">${EN()?'No linked children':'ยังไม่มีบุตรที่ผูก'}</div>`}
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_unlinkFromParent=async(sid,pid,btn)=>{ if(!confirm(EN()?'Unlink this child from the parent? The child stays enrolled.':'ยืนยันตัดนักเรียนคนนี้ออกจากผู้ปกครอง? (เด็กยังเรียนอยู่)'))return; if(btn)btn.disabled=true;
    try{ const r=await api('unlinkStudent',{studentId:sid,parentId:pid,adminId:USER.staffId}); toast((EN()?'Unlinked · removed ':'ยกเลิกการผูกแล้ว · ตัด ')+(r&&r.removed!=null?r.removed:'')+(EN()?' link(s)':' รายการ')); const m=document.querySelector('.modal'); if(m)m.remove(); A_parentLinks(pid); }catch(e){ err(e); if(btn)btn.disabled=false; } };
  window.A_unlink=async(sid,parentId,uid,btn)=>{ if(!confirm(EN()?'Unlink this parent from the child? The child stays enrolled.':'ยืนยันยกเลิกการผูกผู้ปกครองคนนี้ออกจากเด็ก? (เด็กยังเรียนอยู่)'))return; if(btn)btn.disabled=true;
    try{ const r=await api('unlinkStudent',{studentId:sid,parentId:parentId||undefined,uid:uid||undefined,adminId:USER.staffId}); toast((EN()?'Unlinked · removed ':'ยกเลิกการผูกแล้ว · ตัด ')+(r&&r.removed!=null?r.removed:'')+(EN()?' link(s)':' รายการ')); const m=document.querySelector('.modal'); if(m)m.remove(); A_studentLinks(sid); }catch(e){ err(e); if(btn)btn.disabled=false; } };
  window.A_saveStudent=async(btn,id)=>{ const m=btn.closest('.modal'); const v=k=>{ const e=m.querySelector('#stf_'+k); return e?e.value.trim():''; };
    const data={NameTH:v('NameTH'),NameEN:v('NameEN'),Nickname:v('Nickname'),NicknameEN:v('NicknameEN'),NationalID:v('NationalID'),Class:v('Class'),Plan:v('Plan'),Allergy:v('Allergy'),MedicalHistory:v('MedicalHistory'),
      InsuranceHas:m.querySelector('#stf_Ins').checked,InsurancePolicyNo:v('InsurancePolicyNo'),InsuranceCompany:v('InsuranceCompany'),InsuranceExpiry:v('InsuranceExpiry'),
      StartTime:v('StartTime'),EndTime:v('EndTime'),   // per-student individual schedule (EndTime drives OT)
      OTGraceUntil:v('OTGraceUntil'),RateNote:v('RateNote'),  // OT-free cutoff decoupled from EndTime + parent-facing note
      OTRate:v('OTRate')===''?'':(Number(v('OTRate'))||0)};   // blank = fall back to the school-wide OT rate
    const stp=photoVal(m,'stf_Photo'); if(stp) data.Photo=stp;
    const stc=photoVal(m,'stf_InsCard'); if(stc) data.InsuranceCardImage=stc;
    try{ await api('saveStudent',{studentId:id,data}); m.remove(); confirmSaved(t('c.saved')); GO('manage'); }catch(e){err(e);} };

  // ---- vaccine records (Admin/teacher) ----
  window.A_vaccines=async(sid)=>{ const s=findStudent(sid); const [sched,recs]=await Promise.all([api('vaccineSchedule'),api('studentVaccines',{studentId:sid})]);
    modal(`<h3>💉 ${esc(t('vac.title'))} — ${esc(nm(s))}</h3>
      ${vaccineCard(sched,recs,sid,true)}
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  // append another empty dose-date input under a vaccine topic
  window.VAC_addDate=(key)=>{ const c=document.getElementById('vacrow_'+key); if(c) c.insertAdjacentHTML('beforeend', vacDateInput(key,'')); };
  // gather every filled date input (grouped by vaccine key) and save all at once
  window.VAC_save=async(sid)=>{ const names={}; (window.__VAC_SCHED||[]).forEach(g=>g.items.forEach(it=>{ names[it.key]=it.th; }));
    const byKey={}; document.querySelectorAll('#vaccard .vacdate').forEach(inp=>{ const k=inp.dataset.key, v=(inp.value||'').trim(); if(!v)return; (byKey[k]=byKey[k]||[]).push(v); });
    const records=Object.keys(byKey).map(k=>({key:k,name:names[k]||'',dates:byKey[k]}));
    try{ await api('saveVaccines',{studentId:sid,records}); toast(t('c.saved')); }catch(e){ toast((EN()?'Save failed: ':'บันทึกไม่สำเร็จ: ')+(e.message||e)); } };

  // ---- Admin issues a bill to a parent (custom amount for mid-month proration / ad-hoc) ----
  window.A_issueBill=async(sid)=>{ const s=findStudent(sid); const [base,bills]=await Promise.all([api('studentBillBase',{studentId:sid}),api('payments',{studentId:sid})]);
    const billRow=b=>{ const st={PAID:'ok',PARTIAL:'wait',PENDING_VERIFY:'wait'}[b.Status]||'bad';
      return `<div class="list-item"><span><b>${esc(b.Month)}</b> ${baht(b.TotalDue!=null?b.TotalDue:b.Amount)} <span class="pill ${st}" style="font-size:10px">${esc(tStat(b.Status))}</span></span><button class="btn sm pink" onclick="A_delBill('${esc(b.BillingID)}','${esc(b.Month)}',this)">🗑️</button></div>`; };
    modal(`<h3>🧾 ${esc(t('bill.issue'))} — ${esc(nm(s))}</h3><p class="muted" style="font-size:12px">${esc(t('bill.issueNote'))}</p>
      ${bills&&bills.length?`<div class="card" style="padding:8px;background:#fafbfe"><b style="font-size:13px">📋 ${EN()?'Existing bills':'บิลที่มีอยู่'}</b>${bills.map(billRow).join('')}</div>`:''}
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
  window.A_delBill=async(billingId,month,btn)=>{ if(!confirm((EN()?'Delete the bill for ':'ลบบิลงวด ')+month+' ?'))return;
    if(btn)btn.disabled=true;
    try{ await api('deleteBill',{billingId}); toast(t('manage.deleted')); const m=btn&&btn.closest('.modal'); if(m)m.remove(); GO('manage'); }catch(e){err(e);} };
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
  window.A_groups=async()=>{ const [groups,staff]=await Promise.all([api('listStaffGroups'),api('listStaff')]);
    A_CACHE.groups=groups||[]; A_CACHE.staff=staff||A_CACHE.staff;
    const membersOf=name=>(staff||[]).filter(s=>s.StaffGroup===name);
    modal(`<h3>🕑 ${esc(t('manage.groups'))}</h3><p class="muted" style="font-size:12px">${esc(t('manage.groupsNote'))}</p>
      <div id="grpList">${groups.map(g=>{ const mem=membersOf(g.GroupName);
        return `<div class="card" style="padding:10px"><div class="spread"><b>${esc(EN()?g.GroupNameEN:g.GroupName)}</b><button class="btn sm pink" onclick="A_delGroup('${esc(g.GroupName)}')">🗑️</button></div>
        <div class="grid2" style="margin-top:6px"><label class="field"><span>${esc(t('lbl.checkIn'))}</span><input type="time" value="${esc(g.CheckInTime)}" onchange="A_setGroup('${esc(g.GroupName)}','in',this.value)"/></label>
          <label class="field"><span>${esc(t('lbl.checkOut'))}</span><input type="time" value="${esc(g.CheckOutTime)}" onchange="A_setGroup('${esc(g.GroupName)}','out',this.value)"/></label></div>
        <div style="margin-top:6px"><small class="muted">👥 ${EN()?'Members':'พนักงานในกลุ่ม'} (${mem.length})</small>${mem.length?`<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${mem.map(s=>`<span class="pill info" style="font-size:11px">${esc(nmn(s))}</span>`).join('')}</div>`:`<div class="muted" style="font-size:12px">— ${EN()?'no members':'ยังไม่มีพนักงาน'} —</div>`}</div></div>`; }).join('')}</div>
      <div class="card" style="background:#f7f9fc;padding:10px"><b style="font-size:13px">➕ ${esc(t('grp.add'))}</b>
        <div class="grid2" style="margin-top:6px"><input id="ngName" placeholder="${esc(t('grp.nameTH'))}"/><input id="ngNameEN" placeholder="${esc(t('grp.nameEN'))}"/></div>
        <div class="grid2" style="margin-top:6px"><input id="ngIn" type="time" value="08:00"/><input id="ngOut" type="time" value="17:00"/></div>
        <button class="btn block" style="margin-top:6px" onclick="A_addGroup(this)">${esc(t('grp.add'))}</button></div>
      <button class="btn block outline" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_setGroup=async(group,which,val)=>{ await api('setStaffGroupHours',{group,checkIn:which==='in'?val:undefined,checkOut:which==='out'?val:undefined}); toast(t('c.saved')); };

  // ---- admin: daily reports for a day — view, and unlock a submitted one so it can be corrected ----
  window.A_journals=async(date)=>{ const day=date||todayStr();
    const [st,students,staff]=await Promise.all([api('journalStatus',{date:day,role:USER.role}),
      (A_CACHE.students&&A_CACHE.students.length)?Promise.resolve(A_CACHE.students):api('listStudents'),
      (A_CACHE.staff&&A_CACHE.staff.length)?Promise.resolve(A_CACHE.staff):api('listStaff')]);
    A_CACHE.students=students||A_CACHE.students; A_CACHE.staff=staff||A_CACHE.staff;
    const sName=id=>{ const s=(students||[]).find(x=>x.StudentID===id); return s?nm(s):id; };
    const tName=id=>{ const s=(staff||[]).find(x=>x.StaffID===id); return s?(nick(s)||nm(s)):(id||'-'); };
    const rows=(st.done||[]).map(d=>`<div class="list-item"><span>${esc(sName(d.studentId))} ${journalPill(d)}<br><small class="muted">${esc(EN()?'by':'โดย')} ${esc(tName(d.teacherId))}</small></span>
      <span class="row"><button class="btn sm outline" onclick="A_viewJournal('${d.studentId}','${day}')">👁️</button>
      ${jIsDraft(d)?`<button class="btn sm" onclick="A_editJournal('${d.studentId}','${day}')">✏️</button>`
                   :`<button class="btn sm pink" onclick="A_unlockJournal('${d.studentId}','${day}')">${esc(t('jr.unlock'))}</button>`}</span></div>`).join('');
    modal(`<h3>📒 ${esc(t('jr.admin'))}</h3>
      <label class="field"><span>${esc(t('inj.date'))}</span><input type="date" id="ajDate" value="${day}" onchange="A_journals(this.value)"/></label>
      <div style="max-height:50vh;overflow:auto">${rows||`<small class="muted">${esc(t('jr.noneForDay'))}</small>`}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_viewJournal=async(sid,day)=>{ const j=await api('getJournal',{studentId:sid,date:day,role:USER.role});
    if(!j){ toast(t('jr.noneForDay')); return; }
    modal(`<h3>📒 ${esc(day)}</h3>${journalChecklist(j)}<button class="btn outline block" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`); };
  window.A_unlockJournal=async(sid,day)=>{ if(!confirm(t('jr.confirmUnlock')))return;
    try{ await api('unlockJournal',{studentId:sid,date:day}); const m=document.querySelector('.modal'); if(m)m.remove();
      toast(t('jr.unlocked')); A_journals(day); }catch(e){err(e);} };
  // an unlocked (DRAFT) report opens in the same form the teacher uses; only today's is editable
  window.A_editJournal=(sid,day)=>{ if(day!==todayStr()){ toast(EN()?'Only today’s report can be edited':'แก้ไขได้เฉพาะบันทึกของวันนี้'); return; }
    const m=document.querySelector('.modal'); if(m)m.remove(); T_journal(sid); };

  // ---- departments (Nursery) add / rename / remove ----
  window.A_departments=async()=>{
    // staff list may not be cached yet (the modal opens straight from the manage header)
    const [deps,staff]=await Promise.all([api('listDepartments'), (A_CACHE.staff&&A_CACHE.staff.length)?Promise.resolve(A_CACHE.staff):api('listStaff')]);
    A_CACHE.depts=deps||A_CACHE.depts; A_CACHE.staff=staff||A_CACHE.staff; // keep the form dropdowns in sync
    const active=(staff||[]).filter(s=>String(s.Status||'ACTIVE').toUpperCase()!=='INACTIVE');
    const members=d=>active.filter(s=>String(s.Department||'')===d);
    const chip=s=>`<span class="pill info" style="margin:2px 3px 0 0">${esc(nm(s))}${nick(s)?` (${esc(nick(s))})`:''}${s.PositionLevel==='Leader'?' ⭐':''}</span>`;
    const unassigned=active.filter(s=>!s.Department||deps.indexOf(s.Department)<0);
    modal(`<h3>🏫 ${esc(t('manage.departments'))}</h3>
      <div id="depList">${deps.map(d=>{ const ms=members(d); return `<div style="padding:6px 0;border-bottom:1px solid #f0f0f0">
        <div class="list-item" style="border:none;padding:0"><input value="${esc(d)}" id="dep_${esc(d)}" style="flex:1"/><span class="row"><button class="btn sm" onclick="A_renameDep('${esc(d)}')">💾</button><button class="btn sm pink" onclick="A_delDep('${esc(d)}')">🗑️</button></span></div>
        <div style="margin-top:4px">${ms.length?ms.map(chip).join(''):`<small class="muted">${esc(EN()?'No staff assigned':'ยังไม่มีคุณครูในแผนกนี้')}</small>`}
          <small class="muted" style="margin-left:4px">· ${ms.length} ${esc(EN()?'people':'คน')}</small></div></div>`; }).join('')}</div>
      ${unassigned.length?`<div style="margin-top:8px"><small class="muted">⚠️ ${esc(EN()?'Not in any department':'ยังไม่ได้อยู่แผนกใด')}:</small><div>${unassigned.map(chip).join('')}</div></div>`:''}
      <div class="grid2" style="margin-top:8px"><input id="newDep" placeholder="${esc(t('dep.name'))}"/><button class="btn" onclick="A_addDep()">+ ${esc(t('manage.add'))}</button></div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_addDep=async()=>{ const n=$('#newDep').value.trim(); if(!n){toast(t('dep.name'));return;} try{ await api('addDepartment',{name:n}); const m=document.querySelector('.modal'); if(m)m.remove(); A_departments(); toast(t('c.saved')); }catch(e){err(e);} };
  window.A_renameDep=async(old)=>{ const nv=document.getElementById('dep_'+old).value.trim(); if(!nv||nv===old)return; try{ await api('renameDepartment',{old,'new':nv}); const m=document.querySelector('.modal'); if(m)m.remove(); A_departments(); toast(t('c.saved')); }catch(e){err(e);} };
  window.A_delDep=async(name)=>{ if(!confirm(t('manage.confirmDel')))return; try{ await api('removeDepartment',{name}); const m=document.querySelector('.modal'); if(m)m.remove(); A_departments(); toast(t('manage.deleted')); }catch(e){err(e);} };

  // ---- settings: diligence amounts + leave quota (Admin-editable) ----
  window.A_settings=async()=>{ const [q,sc,bc]=await Promise.all([api('getLeaveQuota'),api('schoolConfig'),api('bigCleaningDays')]); const cfg=MOCK.config;
    const cfgOn=(k,def)=>{ const v=(sc&&sc[k]!=null)?sc[k]:cfg[k]; return v==null?def:(v===true||String(v).toLowerCase()==='true'); };
    modal(`<h3>⚙️ ${esc(t('manage.settings'))}</h3>
      <h4 style="margin:6px 0">📍 ${EN()?'Check-in location (geofence)':'พิกัดโรงเรียน (เช็คอิน)'}</h4>
      <p class="muted" style="font-size:11.5px">${EN()?'Open Google Maps → long-press the school → copy the lat, long numbers here.':'เปิด Google Maps → กดค้างที่ตำแหน่งโรงเรียน → คัดลอกเลข lat, long มาใส่'}</p>
      <div class="grid2"><label class="field"><span>Latitude</span><input id="cfgLat" type="number" step="any" value="${esc(sc.GPS_Lat!=null?sc.GPS_Lat:'')}"/></label>
        <label class="field"><span>Longitude</span><input id="cfgLng" type="number" step="any" value="${esc(sc.GPS_Lng!=null?sc.GPS_Lng:'')}"/></label></div>
      <label class="field"><span>${EN()?'Radius (metres)':'รัศมี (เมตร)'}</span><input id="cfgRadius" type="number" value="${esc(sc.Radius!=null?sc.Radius:30)}"/></label>
      <h4 style="margin:6px 0">${esc(t('set.diligence'))}</h4>
      <div class="grid2"><label class="field"><span>${esc(t('set.attendAmt'))}</span><input id="setAtt" type="number" value="${cfg.DiligenceAttendanceAmount}"/></label>
        <label class="field"><span>${esc(t('set.fbAmt'))}</span><input id="setFb" type="number" value="${cfg.DiligenceFacebookAmount}"/></label></div>
      <h4 style="margin:6px 0">🧹 ${EN()?'Big Cleaning Day':'วัน Big Cleaning'}</h4>
      <p class="muted" style="font-size:11.5px">${EN()?'A monthly mandatory workday with no fixed hours; attendance earns a diligence bonus.':'วันทำงานบังคับเดือนละครั้ง ไม่กำหนดเวลาเข้า-ออก · มาแล้วได้เบี้ยขยันเพิ่ม'}</p>
      <label class="field"><span>${EN()?'Bonus per cleaning day (฿)':'เบี้ยขยันต่อวัน (฿)'}</span><input id="setBC" type="number" value="${esc(bc.amount||0)}"/></label>
      <div id="bcList">${(bc.days||[]).map(d=>`<div class="list-item"><span>🧹 ${esc(ddmmyyyy(d))}</span><button class="btn sm pink" onclick="A_bcRemove('${esc(d)}')">🗑️</button></div>`).join('')||`<small class="muted">${EN()?'no dates set':'ยังไม่ได้กำหนดวัน'}</small>`}</div>
      <div class="grid2" style="margin-top:6px"><input type="date" id="bcDate"/><button class="btn" onclick="A_bcAdd()">+ ${esc(t('manage.add'))}</button></div>
      <h4 style="margin:6px 0">${esc(t('set.leaveQuota'))}</h4>
      ${Object.keys(q).map(k=>`<label class="field"><span>${esc(tLeaveType(k))}</span><input type="number" id="lq_${esc(k)}" value="${q[k]}"/></label>`).join('')}
      <h4 style="margin:10px 0 4px">🔔 ${EN()?'Notifications':'การแจ้งเตือน'}</h4>
      <p class="muted" style="font-size:11.5px">${EN()?'To protect the LINE monthly quota, approval alerts go to the in-app bell 🔔. Turn options on to also use LINE. Emergencies (accidents) always LINE.':'เพื่อประหยัดโควตา LINE รายเดือน คำขออนุมัติจะเข้ากล่องแจ้งเตือนในแอป 🔔 · เปิดตัวเลือกเพื่อส่ง LINE เพิ่ม · เหตุฉุกเฉิน (อุบัติเหตุ) ส่ง LINE ทุกครั้ง'}</p>
      <label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="setAdminLine" style="width:auto" ${cfgOn('AdminLineNotify',false)?'checked':''}/> 📲 ${EN()?'Also LINE-push admins for approvals (uses quota)':'ส่ง LINE ถึงแอดมินเมื่อมีคำขออนุมัติ (ใช้โควตา)'}</label>
      <label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="setDigM" style="width:auto" ${cfgOn('DigestMorning',true)?'checked':''}/> 🌅 ${EN()?'Morning digest 10:00 (Big Cleaning + pending)':'สรุปเช้า 10:00 (Big Cleaning + รายการค้าง)'}</label>
      <label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="setDigE" style="width:auto" ${cfgOn('DigestEvening',true)?'checked':''}/> 🌆 ${EN()?'Evening digest 20:00 (daily report)':'สรุปเย็น 20:00 (รายงานประจำวัน)'}</label>
      <button class="btn sm outline block" style="margin-top:4px" onclick="A_reinstallTriggers(this)">🔄 ${EN()?'Apply digest schedule (10:00 / 20:00)':'อัปเดตตารางส่งสรุป (10:00 / 20:00)'}</button>
      <p class="muted" style="font-size:11px">${EN()?'Digests skip weekends & holidays. Run "Apply" once after enabling.':'สรุปจะข้ามวันหยุด/เสาร์-อาทิตย์ · กด "อัปเดตตาราง" 1 ครั้งหลังเปิดใช้'}</p>
      <button class="btn block" onclick="A_saveSettings(this)">${esc(t('c.save'))}</button>`);
  };
  // Big Cleaning Day add/remove — persist immediately (also save the amount field first so it isn't lost)
  window.A_bcAdd=async()=>{ const d=document.getElementById('bcDate').value; if(!d){toast(EN()?'Pick a date':'เลือกวันที่');return;}
    const amt=document.getElementById('setBC'); if(amt) await api('setSchoolConfig',{values:{BigCleaningAmount:+amt.value||0}});
    try{ await api('addBigCleaning',{date:d}); const m=document.querySelector('.modal'); if(m)m.remove(); toast(t('c.saved')); A_settings(); }catch(e){err(e);} };
  window.A_bcRemove=async(d)=>{ try{ await api('removeBigCleaning',{date:d}); const m=document.querySelector('.modal'); if(m)m.remove(); toast(t('manage.deleted')); A_settings(); }catch(e){err(e);} };
  // (re)install the time triggers so the 10:00/20:00 digests are scheduled after enabling them
  window.A_reinstallTriggers=async(btn)=>{ if(btn)btn.disabled=true; try{ const r=await api('reinstallTriggers',{}); toast((EN()?'Schedule updated · triggers: ':'อัปเดตตารางแล้ว · triggers: ')+(r&&r.triggers!=null?r.triggers:'?')); }catch(e){err(e);}finally{ if(btn)btn.disabled=false; } };
  window.A_saveSettings=async(btn)=>{ const m=btn.closest('.modal');
    const lat=parseFloat(m.querySelector('#cfgLat').value), lng=parseFloat(m.querySelector('#cfgLng').value), rad=parseFloat(m.querySelector('#cfgRadius').value);
    const gv={}; if(!isNaN(lat))gv.GPS_Lat=lat; if(!isNaN(lng))gv.GPS_Lng=lng; if(!isNaN(rad))gv.Radius=rad;
    const bcEl=m.querySelector('#setBC'); if(bcEl) gv.BigCleaningAmount=+bcEl.value||0;
    // notification prefs (checkboxes) — stored in SCHOOL_CONFIG so the digests/triggers read them
    const ck=id=>{ const e=m.querySelector(id); return e?(e.checked?'true':'false'):undefined; };
    if(ck('#setAdminLine')!==undefined) gv.AdminLineNotify=ck('#setAdminLine');
    if(ck('#setDigM')!==undefined) gv.DigestMorning=ck('#setDigM');
    if(ck('#setDigE')!==undefined) gv.DigestEvening=ck('#setDigE');
    if(Object.keys(gv).length) await api('setSchoolConfig',{values:gv});
    await api('setConfigVal',{key:'DiligenceAttendanceAmount',value:+m.querySelector('#setAtt').value});
    await api('setConfigVal',{key:'DiligenceFacebookAmount',value:+m.querySelector('#setFb').value});
    for(const k of Object.keys(MOCK.config.LeaveQuota)){ const el=m.querySelector('#lq_'+k); if(el) await api('setLeaveQuota',{type:k,days:+el.value}); }
    m.remove(); confirmSaved(t('c.saved')); };

  // ---- OT verification (check the ≥50min→1hr rule on attendance) ----
  // ---- Admin: student late-pickup OT (cancel / correct pickup time / override amount) ----
  let OT_MONTH=null;
  window.A_studentOT=async()=>{ const month=OT_MONTH||monthStr(); const rows=await api('studentOtList',{month});
    const pill=st=>({UNPAID:'bad',PENDING_VERIFY:'wait',PARTIAL:'wait',PAID:'ok',CANCELLED:'info'}[st]||'info');
    const lbl=st=>({UNPAID:EN()?'unpaid':'ค้างชำระ',PENDING_VERIFY:EN()?'pending':'รอตรวจ',PARTIAL:EN()?'partial':'บางส่วน',PAID:EN()?'paid':'ชำระแล้ว',CANCELLED:EN()?'cancelled':'ยกเลิกแล้ว'}[st]||st);
    const row=o=>{ const paid=o.status==='PAID', cancelled=o.status==='CANCELLED';
      return `<div class="card" style="padding:8px;${cancelled?'opacity:.6':''}">
        <div class="spread"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" class="sotoc" value="${esc(o.otId)}" ${paid?'disabled':''} style="width:auto" onchange="A_socSel()"/> <b>${esc((EN()?(o.nickEN||o.nick||o.nameEN):(o.nick||o.name))||o.studentId)}</b></label><span class="pill ${pill(o.status)}" style="font-size:10px">${esc(lbl(o.status))}</span></div>
        <small class="muted">${esc(String(o.date).slice(0,10))} · ${EN()?'leaves':'เลิกเรียน'} ${esc(o.endTime||o.planEnd||'-')} · ${EN()?'rate':'เรต'} ${baht(o.rate)}/${EN()?'hr':'ชม.'}</small>
        <div class="grid2" style="margin-top:6px">
          <label class="field"><span>${EN()?'Pickup time':'เวลารับ'}</span><input type="time" id="ot_t_${esc(o.otId)}" value="${esc(String(o.pickupTime||'').slice(0,5))}" data-orig="${esc(String(o.pickupTime||'').slice(0,5))}" ${paid?'disabled':''}/></label>
          <label class="field"><span>${EN()?'Amount (฿)':'ยอด OT (฿)'}</span><input type="number" id="ot_a_${esc(o.otId)}" value="${o.amount}" data-orig="${o.amount}" ${paid?'disabled':''}/></label></div>
        <small class="muted">${EN()?'late':'สาย'} ${o.lateMinutes} ${EN()?'min':'นาที'} · ${o.hours} ${EN()?'hr':'ชม.'}</small>
        ${paid?`<div class="muted" style="font-size:12px;margin-top:6px">🔒 ${EN()?'Paid — locked':'ชำระแล้ว แก้ไขไม่ได้'}</div>`
          :`<div class="row" style="margin-top:6px"><button class="btn sm green" onclick="A_otSave('${esc(o.otId)}',this)">💾 ${esc(t('c.save'))}</button>
            ${cancelled?`<button class="btn sm outline" onclick="A_otRestore('${esc(o.otId)}')">♻️ ${EN()?'Restore':'คืนค่า'}</button>`
                       :`<button class="btn sm pink" onclick="A_otCancel('${esc(o.otId)}')">🚫 ${EN()?'Cancel OT':'ยกเลิก OT'}</button>`}</div>`}</div>`; };
    modal(`<h3>⏰ ${EN()?'Student late-pickup OT':'OT รับช้า (นักเรียน)'}</h3>
      <p class="muted" style="font-size:12px">${EN()?'Cancelled OT is never billed. Editing a cancelled row restores it. Paid rows are locked.':'OT ที่ยกเลิกจะไม่ถูกเรียกเก็บ · แก้ไขรายการที่ยกเลิกแล้วจะคืนค่าอัตโนมัติ · รายการที่ชำระแล้วแก้ไม่ได้'}</p>
      <label class="field"><span>${esc(t('c.month'))}</span><input type="month" value="${month}" onchange="A_otMonth(this.value)"/></label>
      ${rows.length?`<div style="position:sticky;top:0;z-index:2;background:#fff;border:1px solid var(--line);border-radius:8px;padding:6px 8px;margin-bottom:6px">
        <div class="spread"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="socAll" style="width:auto" onchange="A_socToggleAll(this)"/> ${EN()?'Select all':'เลือกทั้งหมด'} <span class="muted" id="socN">(0)</span></label></div>
        <div class="row" style="margin-top:6px"><button class="btn sm pink" onclick="A_socBatch('cancel')">🚫 ${EN()?'Cancel all selected':'ยกเลิกทั้งหมด'}</button><button class="btn sm outline" onclick="A_socBatch('restore')">♻️ ${EN()?'Restore all selected':'คืนค่าทั้งหมด'}</button></div></div>`:''}
      ${rows.length?rows.map(row).join(''):`<div class="card muted">${EN()?'No OT this month':'ไม่มีรายการ OT เดือนนี้'}</div>`}
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_socSel=()=>{ const n=document.querySelectorAll('.sotoc:checked').length; const el=document.getElementById('socN'); if(el)el.textContent='('+n+')'; };
  window.A_socToggleAll=(cb)=>{ document.querySelectorAll('.sotoc:not([disabled])').forEach(c=>{c.checked=cb.checked;}); A_socSel(); };
  window.A_socBatch=async(kind)=>{ const ids=[...document.querySelectorAll('.sotoc:checked')].map(c=>c.value); if(!ids.length){toast(EN()?'Select at least one':'เลือกอย่างน้อย 1 รายการ');return;}
    if(!confirm((kind==='cancel'?(EN()?'Cancel ':'ยกเลิก '):(EN()?'Restore ':'คืนค่า '))+ids.length+(EN()?' item(s)?':' รายการ?')))return;
    let ok=0,skip=0; for(const id of ids){ try{ await api(kind==='cancel'?'adminCancelOT':'adminRestoreOT',{otId:id}); ok++; }catch(e){ skip++; } }
    toast((EN()?'Done ':'สำเร็จ ')+ok+(skip?` · ${EN()?'skipped':'ข้าม'} ${skip}`:'')); const x=document.querySelector('.modal'); if(x)x.remove(); A_studentOT(); };
  window.A_otMonth=(m)=>{ OT_MONTH=m; const x=document.querySelector('.modal'); if(x)x.remove(); A_studentOT(); };
  // Only send what actually changed: sending a stale amount alongside a new pickup time
  // would override the recomputed value. If the admin edits the amount, that wins.
  window.A_otSave=async(otId,btn)=>{ const tm=document.getElementById('ot_t_'+otId), am=document.getElementById('ot_a_'+otId);
    const p={otId};
    if(tm && tm.value && tm.value!==tm.dataset.orig) p.pickupTime=tm.value;
    if(am && String(am.value)!==String(am.dataset.orig)) p.amount=am.value;
    if(p.pickupTime===undefined && p.amount===undefined){ toast(EN()?'Nothing changed':'ไม่มีการเปลี่ยนแปลง'); return; }
    btn.disabled=true;
    try{ const r=await api('adminUpdateOT',p);
      toast(`✅ ${EN()?'Updated':'อัปเดตแล้ว'} — ${baht(r.Amount!=null?r.Amount:r.amount||0)}`); const x=document.querySelector('.modal'); if(x)x.remove(); A_studentOT();
    }catch(e){ err(e); btn.disabled=false; } };
  window.A_otCancel=async(otId)=>{ if(!confirm(EN()?'Cancel this OT charge? It will not be billed.':'ยกเลิกค่า OT รายการนี้? จะไม่ถูกเรียกเก็บ'))return;
    try{ await api('adminCancelOT',{otId}); toast(EN()?'OT cancelled':'ยกเลิก OT แล้ว'); const x=document.querySelector('.modal'); if(x)x.remove(); A_studentOT(); }catch(e){err(e);} };
  window.A_otRestore=async(otId)=>{ try{ await api('adminRestoreOT',{otId}); toast(EN()?'OT restored':'คืนค่า OT แล้ว'); const x=document.querySelector('.modal'); if(x)x.remove(); A_studentOT(); }catch(e){err(e);} };

  // ---- Class-management (ย้ายครูประจำชั้น/แผนก): Leader stages moves → submits a change request;
  //      Admin reviews Before/After and approves (applies + logs). Shared row renderer + screens below. ----
  const ccrStatusPill = st => { const k=String(st||'PENDING_ADMIN').toUpperCase(); const cls=k==='APPROVED'?'ok':(k==='REJECTED'?'bad':'wait');
    return `<span class="pill ${cls}">${esc(t('att.st.'+k)||k)}</span>`; };
  const ccrChanges = r => { let a=r.Changes; if(typeof a==='string'){ try{a=JSON.parse(a);}catch(e){a=[];} } return Array.isArray(a)?a:[]; };
  const ccrDiff = c => `${esc(c.name||c.staffId)}: <span class="muted">${esc(c.before||'—')}</span> → <b style="color:#1565C0">${esc(c.after||'—')}</b>`;
  function ccrRow(r){ return `<div class="list-item"><span>${ccrChanges(r).map(ccrDiff).join('<br>')||'<small class="muted">—</small>'}<br><small class="muted">${esc(ddmmyyyy(r.CreatedDate))}${r.Note?' · '+esc(r.Note):''}</small></span>${ccrStatusPill(r.Status)}</div>`; }
  // Leader screen: move teachers between departments; changed rows are staged and submitted as one request.
  window.T_classOrg=async()=>{ const [staff,depts]=await Promise.all([api('listStaff'),api('listDepartments')]);
    const teachers=staff.filter(s=>s.Role==='Teacher'||s.PositionLevel==='Leader'||s.PositionLevel==='Assistant');
    window._CCR_ORIG={}; teachers.forEach(s=>{ window._CCR_ORIG[s.StaffID]=String(s.Department||''); });
    const optsFor=cur=>depts.map(d=>`<option value="${esc(d)}" ${String(cur||'')===d?'selected':''}>${esc(d)}</option>`).join('');
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('home')">${t('c.back')}</button>
      <h2 class="page">🔁 ${esc(t('corg.title'))}</h2>
      <p class="muted" style="font-size:12px">${esc(t('corg.leaderNote'))}</p>
      <div class="card">${teachers.map(s=>`<div class="list-item"><span>👩‍🏫 <b>${esc(nmn(s))}</b></span>
        <select data-ccr="${s.StaffID}" data-name="${esc(nmn(s))}" onchange="CCR_mark(this)">${optsFor(s.Department)}</select></div>`).join('')}</div>
      <label class="field"><span>${esc(t('corg.note'))}</span><input id="ccrNote" placeholder="${EN()?'reason (optional)':'เหตุผล (ถ้ามี)'}"/></label>
      <button class="btn block" onclick="CCR_submit(this)">📤 ${esc(t('corg.submit'))}</button>`;
  };
  window.CCR_mark=(sel)=>{ const orig=(window._CCR_ORIG||{})[sel.getAttribute('data-ccr')]; sel.style.fontWeight=(sel.value!==orig)?'700':''; sel.style.color=(sel.value!==orig)?'#1565C0':''; };
  window.CCR_submit=async(btn)=>{ const orig=window._CCR_ORIG||{}; const changes=[];
    document.querySelectorAll('select[data-ccr]').forEach(sel=>{ const id=sel.getAttribute('data-ccr'); const after=sel.value; const before=orig[id]||'';
      if(after!==before) changes.push({staffId:id,name:sel.getAttribute('data-name'),before,after}); });
    if(!changes.length){toast(EN()?'No changes':'ไม่มีการเปลี่ยนแปลง');return;}
    if(!confirm((EN()?'Submit ':'ส่งคำขอ ')+changes.length+(EN()?' change(s) to Admin?':' รายการไปที่แอดมิน?')))return;
    try{ await api('submitClassChange',{staffId:USER.staffId,changes,note:$('#ccrNote').value||''}); confirmSaved(t('corg.submitted')); GO('home'); }catch(e){err(e);} };
  // Admin screen: pending change requests with Before/After → approve (apply+log) / reject
  window.A_classChanges=async()=>{ const rows=await api('pendingClassChanges',{staffId:USER.staffId});
    modal(`<h3>🔁 ${esc(t('corg.adminTitle'))}</h3>
      <div style="max-height:60vh;overflow:auto">${rows.length?rows.map(r=>`<div class="card" style="margin:8px 0"><div><b>${esc(r.RequestByName||r.RequestBy)}</b> <small class="muted">${esc(ddmmyyyy(r.CreatedDate))}</small></div>
        <div style="margin:6px 0">${ccrChanges(r).map(ccrDiff).join('<br>')}</div>${r.Note?`<small class="muted">${esc(r.Note)}</small>`:''}
        <div class="row" style="margin-top:8px"><button class="btn sm green" onclick="CCR_decide('${r.ReqID}','approve')">✔ ${esc(t('c.approve'))}</button><button class="btn sm pink" onclick="CCR_decide('${r.ReqID}','reject')">✕ ${esc(t('c.reject'))}</button></div></div>`).join(''):`<small class="muted">${esc(t('corg.noPending'))}</small>`}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.CCR_decide=async(reqId,dec)=>{ try{ await api('decideClassChange',{staffId:USER.staffId,reqId,decision:dec}); toast(dec==='approve'?(EN()?'Approved & applied':'อนุมัติและปรับแล้ว'):(EN()?'Rejected':'ปฏิเสธแล้ว')); const m=document.querySelector('.modal'); if(m)m.remove(); A_classChanges(); }catch(e){err(e);} };

  // Admin: confirm/reject manual attendance-time requests (final step → writes CHECKIN_STAFF)
  window.A_timeRequests=async()=>{ const rows=await api('pendingAdminTimeRequests',{staffId:USER.staffId});
    const tyLabel=ty=>String(ty).toUpperCase()==='IN'?(EN()?'Check-in':'เข้างาน'):(EN()?'Check-out':'เลิกงาน');
    modal(`<h3>⏰ ${esc(t('att.adminTitle'))}</h3>
      <p class="muted" style="font-size:12px">${EN()?'Approving writes the time into attendance and recomputes late/OT.':'อนุมัติแล้วจะบันทึกเวลาลงในระบบและคำนวณสาย/OT ใหม่'}</p>
      <div style="max-height:60vh;overflow:auto">${rows.length?rows.map(r=>`<div class="card" style="margin:8px 0"><div><b>${esc(dnick(r))}</b> · ${esc(tyLabel(r.Type))} <b style="color:#1565C0">${esc(r.RequestTime)}</b> · ${esc(ddmmyyyy(r.Date))}</div>${r.Reason?`<small class="muted">${esc(r.Reason)}</small>`:''}
        <div class="row" style="margin-top:8px"><button class="btn sm green" onclick="ATR_decide('${r.ReqID}','approve')">✔ ${esc(t('c.approve'))}</button><button class="btn sm pink" onclick="ATR_decide('${r.ReqID}','reject')">✕ ${esc(t('c.reject'))}</button></div></div>`).join(''):`<small class="muted">${esc(t('corg.noPending'))}</small>`}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.ATR_decide=async(reqId,dec)=>{ try{ await api('confirmTimeRequest',{staffId:USER.staffId,reqId,decision:dec}); toast(dec==='approve'?(EN()?'Approved & written':'อนุมัติและบันทึกแล้ว'):(EN()?'Rejected':'ปฏิเสธแล้ว')); const m=document.querySelector('.modal'); if(m)m.remove(); A_timeRequests(); }catch(e){err(e);} };

  // ---- Admin: staff OT approval + management (confirm/edit/reject/add/delete) ----
  let SOT_MONTH=null;
  // Staff OT — same card/list template as student late-pickup OT. Shows check-in → check-out (the leave
  // time that drove the OT). Batch: top-left select-all + top-right approve/reject selected. Rejected rows
  // can be restored (re-approve). A single existing modal is replaced on refresh.
  window.A_staffOT=async(month)=>{ SOT_MONTH=month||SOT_MONTH||monthStr();
    const [rows,staff]=await Promise.all([api('adminOTList',{month:SOT_MONTH}), (A_CACHE.staff&&A_CACHE.staff.length)?Promise.resolve(A_CACHE.staff):api('listStaff')]);
    A_CACHE.staff=staff||A_CACHE.staff;
    const pend=rows.filter(o=>String(o.Status).toUpperCase()==='PENDING_ADMIN');
    const pcls=st=>({PENDING_ADMIN:'wait',PENDING_LEADER:'wait',APPROVED:'ok',CONFIRMED:'ok',REJECTED:'bad'}[String(st||'').toUpperCase()]||'ok');
    const plbl=st=>{ const k=String(st||'').toUpperCase()||'APPROVED'; return t('ot.st.'+k)||k; };
    const row=o=>{ const st=String(o.Status).toUpperCase(); const isPA=st==='PENDING_ADMIN'; const rejected=st==='REJECTED';
      return `<div class="card" style="padding:8px;${rejected?'opacity:.7':''}">
        <div class="spread"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" class="sotchk" value="${esc(o.OTRecordID)}" style="width:auto" onchange="A_sotSel()"/> <b>${esc(dnick(o))}</b></label><span class="pill ${pcls(st)}" style="font-size:10px">${esc(plbl(st))}</span></div>
        <small class="muted">${esc(ddmmyyyy(o.Date))} · ${EN()?'in':'เข้างาน'} <b>${esc(o.CheckIn||'--:--')}</b> → ${EN()?'out':'เลิกงาน'} <b>${esc(o.CheckOutActual||o.ActualOut||'--:--')}</b>${o.PlanOut?` <span class="muted">(${EN()?'plan':'แผน'} ${esc(o.PlanOut)})</span>`:''}</small>
        <div class="grid2" style="margin-top:6px"><label class="field"><span>${EN()?'Hours':'ชั่วโมง'}</span><input type="number" min="0" step="1" value="${esc(o.Hours)}" id="sot_h_${o.OTRecordID}"/></label>
          <label class="field"><span>${EN()?'Amount (฿)':'ยอด (฿)'}</span><input type="number" min="0" value="${esc(o.Amount)}" id="sot_a_${o.OTRecordID}"/></label></div>
        ${o.Minutes?`<small class="muted">${esc(hmMin(o.Minutes))}</small>`:''}
        <div class="row" style="margin-top:6px">${isPA
          ?`<button class="btn sm green" onclick="A_confirmOT('${o.OTRecordID}')">✔ ${esc(t('c.approve'))}</button><button class="btn sm pink" onclick="A_rejectOT('${o.OTRecordID}')">✕ ${esc(t('c.reject'))}</button>`
          :`<button class="btn sm outline" onclick="A_editOT('${o.OTRecordID}')">💾 ${esc(t('c.save'))}</button>${rejected?`<button class="btn sm outline" onclick="A_restoreStaffOT('${o.OTRecordID}')">♻️ ${EN()?'Restore':'คืนค่า'}</button>`:''}`}
          <button class="btn sm pink" onclick="A_deleteOT('${o.OTRecordID}')">🗑️</button></div></div>`; };
    modal(`<h3>⏰ ${esc(t('ot.adminOT'))}</h3>
      <div class="spread"><label class="field" style="flex:1"><span>${EN()?'Month':'เดือน'}</span><input type="month" id="sotMonth" value="${SOT_MONTH}" onchange="A_staffOT(this.value)"/></label>
        <button class="btn sm" style="align-self:end;margin-bottom:2px" onclick="A_addOTForm()">${esc(t('ot.addOT'))}</button></div>
      ${rows.length?`<div style="position:sticky;top:0;z-index:2;background:#fff;border:1px solid var(--line);border-radius:8px;padding:6px 8px;margin-bottom:6px">
        <div class="spread"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="sotAll" style="width:auto" onchange="A_sotToggleAll(this)"/> ${EN()?'Select all':'เลือกทั้งหมด'} <span class="muted" id="sotN">(0)</span></label></div>
        <div class="row" style="margin-top:6px"><button class="btn sm green" onclick="A_sotBatch('approve')">✔ ${EN()?'Approve all selected':'อนุมัติทั้งหมด'}</button><button class="btn sm pink" onclick="A_sotBatch('reject')">✕ ${EN()?'Reject all selected':'ยกเลิกทั้งหมด'}</button></div></div>`:''}
      ${pend.length?`<div style="background:#fff3e0;border-radius:8px;padding:6px;color:#e65100;font-size:12px;margin-bottom:6px">🔔 ${pend.length} ${EN()?'awaiting your confirmation':'รายการรอยืนยัน'}</div>`:''}
      <div style="max-height:52vh;overflow:auto">${rows.length?rows.map(row).join(''):`<small class="muted">${esc(t('ot.none'))}</small>`}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  const sotH=id=>{ const e=document.getElementById('sot_h_'+id); return e?e.value:undefined; };
  const sotA=id=>{ const e=document.getElementById('sot_a_'+id); return e?e.value:undefined; };
  const A_sotRefresh=()=>{ const x=document.querySelector('.modal'); if(x)x.remove(); A_staffOT(); };
  window.A_sotSel=()=>{ const n=document.querySelectorAll('.sotchk:checked').length; const el=document.getElementById('sotN'); if(el)el.textContent='('+n+')'; };
  window.A_sotToggleAll=(cb)=>{ document.querySelectorAll('.sotchk:not([disabled])').forEach(c=>{c.checked=cb.checked;}); A_sotSel(); };
  window.A_sotBatch=async(decision)=>{ const ids=[...document.querySelectorAll('.sotchk:checked')].map(c=>c.value); if(!ids.length){toast(EN()?'Select at least one':'เลือกอย่างน้อย 1 รายการ');return;}
    if(!confirm((decision==='approve'?(EN()?'Approve ':'อนุมัติ '):(EN()?'Reject ':'ไม่อนุมัติ '))+ids.length+(EN()?' item(s)?':' รายการ?')))return;
    try{ for(const id of ids){ await api('confirmOT',{staffId:USER.staffId,otId:id,decision,hours:sotH(id),amount:sotA(id)}); } toast(EN()?'Done':'ดำเนินการแล้ว'); A_sotRefresh(); }catch(e){err(e);} };
  window.A_restoreStaffOT=async(otId)=>{ try{ await api('confirmOT',{staffId:USER.staffId,otId,decision:'approve',hours:sotH(otId),amount:sotA(otId)}); toast(EN()?'Restored':'คืนค่าแล้ว'); A_sotRefresh(); }catch(e){err(e);} };
  window.A_confirmOT=async(otId)=>{ try{ await api('confirmOT',{staffId:USER.staffId,otId,decision:'approve',hours:sotH(otId),amount:sotA(otId)}); toast(EN()?'Confirmed':'ยืนยันแล้ว'); A_sotRefresh(); }catch(e){err(e);} };
  window.A_rejectOT=async(otId)=>{ if(!confirm(EN()?'Reject this OT?':'ปฏิเสธ OT นี้?'))return; try{ await api('confirmOT',{staffId:USER.staffId,otId,decision:'reject'}); toast(EN()?'Rejected':'ปฏิเสธแล้ว'); A_sotRefresh(); }catch(e){err(e);} };
  window.A_editOT=async(otId)=>{ try{ await api('adminEditOT',{staffId:USER.staffId,otId,hours:sotH(otId),amount:sotA(otId)}); toast(t('c.saved')); A_sotRefresh(); }catch(e){err(e);} };
  window.A_deleteOT=async(otId)=>{ if(!confirm(t('manage.confirmDel')))return; try{ await api('adminDeleteOT',{staffId:USER.staffId,otId}); toast(t('manage.deleted')); A_sotRefresh(); }catch(e){err(e);} };
  window.A_addOTForm=()=>{ const staff=(A_CACHE.staff||[]).filter(s=>s.Role!=='Admin'||true);
    modal(`<h3>${esc(t('ot.addOT'))}</h3>
      <label class="field"><span>${esc(t('c.staff'))}</span><select id="aotStaff">${staff.map(s=>`<option value="${s.StaffID}">${esc(nmn(s))}</option>`).join('')}</select></label>
      <div class="grid2"><label class="field"><span>${esc(t('inj.date'))}</span><input type="date" id="aotDate" value="${todayStr()}"/></label>
        <label class="field"><span>${esc(t('ot.hoursLabel'))}</span><input type="number" min="1" step="1" id="aotHours" value="1"/></label></div>
      <label class="field"><span>${EN()?'Amount (blank = auto from salary ×1.5)':'ยอด (เว้นว่าง = คิดจากเงินเดือน ×1.5)'}</span><input type="number" min="0" id="aotAmount" placeholder="auto"/></label>
      <label class="field"><span>${EN()?'Note':'หมายเหตุ'}</span><input id="aotNote"/></label>
      <button class="btn block" onclick="A_addOTDo(this)">${esc(t('c.save'))}</button>`);
  };
  window.A_addOTDo=async(btn)=>{ const m=btn.closest('.modal'); const g=id=>{const e=m.querySelector('#'+id);return e?e.value:'';};
    const hours=Number(g('aotHours'))||0; if(hours<=0){toast(EN()?'Enter hours':'ระบุจำนวนชั่วโมง');return;}
    try{ await api('adminAddOT',{staffId:USER.staffId,targetStaffId:g('aotStaff'),date:g('aotDate'),hours,amount:g('aotAmount'),note:g('aotNote')}); m.remove(); confirmSaved(t('c.saved')); A_staffOT(); }catch(e){err(e);} };

  window.A_otVerify=async()=>{ const rows=await api('otVerification',{});
    modal(`<h3>⏱️ ${esc(t('manage.otVerify'))}</h3><p class="muted" style="font-size:12px">${esc(t('ot.verifyNote'))}</p>
      <div style="overflow:auto"><table style="width:100%;font-size:12px;border-collapse:collapse">
      <tr style="background:#1565C0;color:#fff"><th style="padding:3px 5px">${esc(t('hol.date'))}</th><th>${esc(t('c.staff'))}</th><th>${esc(t('lbl.checkOut'))}</th><th>OT</th><th>${EN()?'OT pay':'ค่า OT'}</th></tr>
      ${rows.map(r=>`<tr style="border-bottom:1px solid #eee"><td style="padding:3px 5px">${esc(r.date)}</td><td>${esc(staffNick(r.staffId))}</td><td>${esc(r.out)} <small class="muted">/${esc(r.schedOut)}</small></td><td style="text-align:center">${esc(hmMin(r.otMinutes))}</td><td style="text-align:center">${r.otPay?esc(baht(r.otPay)):'-'}</td></tr>`).join('')}
      </table></div>
      <p class="muted" style="font-size:11px;margin-top:6px">${EN()?'OT pay = hours × (salary ÷ 30 ÷ 8) × 1.5 (Thai labour law, normal working day)':'ค่า OT = ชั่วโมง × (เงินเดือน ÷ 30 ÷ 8) × 1.5 (ตามกฎหมายแรงงานไทย วันทำงานปกติ)'}</p>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_addGroup=async(btn)=>{ const m=btn.closest('.modal'); const name=m.querySelector('#ngName').value.trim(); if(!name){toast(t('grp.nameTH'));return;}
    try{ await api('addStaffGroup',{name,nameEN:m.querySelector('#ngNameEN').value.trim()||name,checkIn:m.querySelector('#ngIn').value,checkOut:m.querySelector('#ngOut').value}); m.remove(); confirmSaved(t('c.saved')); A_groups(); }catch(e){err(e);} };
  window.A_delGroup=async(name)=>{ if(!confirm(t('manage.confirmDel')))return; try{ await api('deleteStaffGroup',{name}); toast(t('manage.deleted')); const m=document.querySelector('.modal'); if(m)m.remove(); A_groups(); }catch(e){err(e);} };

  // ---- Organize: move teachers/students between Nurseries (drag-drop + dropdown fallback) ----
  ADMIN_SUB_organize = async (backGo)=>{ window.__orgBack = backGo || window.__orgBack || 'manage';
    const [staff,students,depts]=await Promise.all([api('listStaff'),api('listStudents'),api('listDepartments')]);
    // classes = the department master the admin created (Nursery Baby/1/2/…) — NOT the seed config
    const deps=(depts||[]).filter(d=>d);
    const canClass = s => s.Role!=='Admin' && s.PositionLevel!=='Admin';   // teachers, leaders, assistants…
    const depOf = s => String(s.Department||'').trim();
    const inDep = (s,dep)=>{ const d=depOf(s); if(d===''||d==='*')return false; return d.split(',').map(x=>x.trim()).indexOf(dep)>=0; };
    const teachers = staff.filter(canClass);
    // a staff is "unassigned" if their Department is blank, '*' (all classes), or not one of the current classes
    const unassigned = teachers.filter(s=>{ const d=depOf(s); return d===''||d==='*'|| !deps.some(dep=>inDep(s,dep)); });
    const opts=cur=>`<option value="">—</option>`+deps.map(d=>`<option value="${esc(d)}" ${cur===d?'selected':''}>${esc(d)}</option>`).join('');
    const chip=s=>`<div class="org-chip" draggable="true" ondragstart="A_drag(event,'teacher','${s.StaffID}')"><span>👩‍🏫 ${esc(nmn(s))}${depOf(s)==='*'?` <small class="muted">(${EN()?'all':'ทุกชั้น'})</small>`:''}</span><select onchange="A_moveSel('teacher','${s.StaffID}',this.value)">${opts(depOf(s)==='*'?'':depOf(s))}</select></div>`;
    const col=dep=>{ const ts=teachers.filter(s=>inDep(s,dep)); const ss=students.filter(s=>s.Class===dep);
      return `<div class="card org-col" ondragover="event.preventDefault()" ondrop="A_drop(event,'${esc(dep)}')"><h3>${esc(dep)} <small class="muted">${ts.length}👩‍🏫 · ${ss.length}👶</small></h3>
        ${ts.map(chip).join('')}
        ${ss.map(s=>`<div class="org-chip" draggable="true" ondragstart="A_drag(event,'student','${s.StudentID}')"><span>${studentAvatar(s)} ${esc(nmn(s))}</span><select onchange="A_moveSel('student','${s.StudentID}',this.value)">${opts(s.Class)}</select></div>`).join('')}</div>`; };
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('${esc(window.__orgBack)}')">${t('c.back')}</button>
      <h2 class="page">🔁 ${esc(t('manage.organize'))}</h2>
      <p class="muted" style="font-size:12px">${esc(t('org.note'))}</p>
      <div class="card" ondragover="event.preventDefault()" ondrop="A_drop(event,'')" style="background:#fff8e1;border-color:#f0e3b0"><h3>🧑‍🏫 ${EN()?'Unassigned staff — drag into a class':'พนักงานที่ยังไม่ได้จัดชั้น — ลากไปใส่ชั้นเรียน'} <small class="muted">${unassigned.length}</small></h3>
        <div class="org-grid" style="grid-template-columns:1fr">${unassigned.length?unassigned.map(chip).join(''):`<small class="muted">${EN()?'none':'ไม่มี'}</small>`}</div></div>
      <div class="org-grid">${deps.map(col).join('')}</div>`;
  };
  window.A_drag=(e,type,id)=>{ e.dataTransfer.setData('text/plain',type+':'+id); };
  window.A_drop=async(e,dep)=>{ e.preventDefault(); const d=(e.dataTransfer.getData('text/plain')||'').split(':'); if(d.length<2)return; await A_moveSel(d[0],d[1],dep); };
  // Permission-aware move: caller = USER.staffId (server injects/validates), target = the dragged id.
  // Works for Admin and any teacher the admin granted CanClassOrg. Refresh in place (role-agnostic).
  window.A_moveSel=async(type,id,dep)=>{ try{ if(type==='teacher')await api('orgMoveTeacher',{staffId:USER.staffId,targetId:id,toDept:dep}); else await api('orgMoveStudent',{staffId:USER.staffId,targetId:id,toClass:dep}); toast(t('org.moved')); ADMIN_SUB_organize(); }catch(e){err(e);} };
  window.T_organize=()=>{ window.__orgBack='home'; ADMIN_SUB_organize('home'); };

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
  // Prepay retro-check: bills the OLD prepay logic marked fully paid (should have covered tuition only).
  window.A_prepayAudit=async(apply)=>{ const r=await api('prepayAudit', apply?{apply:true}:{});
    const items=r.items||[];
    modal(`<h3>🔍 ${EN()?'Prepay retro-check':'ตรวจ prepay ย้อนหลัง'}</h3>
      <p class="muted" style="font-size:12px">${EN()?'Confirmed prepays':'prepay ที่ยืนยันแล้ว'}: <b>${r.prepaysPaid}</b> · ${EN()?'bills flagged':'บิลที่เข้าข่าย'}: <b>${r.flaggedBills}</b>${r.applied?` · ${EN()?'repaired':'แก้ไขแล้ว'}: <b>${r.repaired}</b>`:''}</p>
      ${items.length?`<div style="max-height:48vh;overflow:auto">${items.map(x=>`<div class="list-item"><span><b>${esc(x.student)}</b> · ${esc(x.month)}<br><small class="muted">${esc(x.billingId)} · ${esc(x.status)}/${esc(x.verified||'-')} · ${baht(x.amount)}</small></span></div>`).join('')}</div>
        <p class="muted" style="font-size:11.5px">${EN()?'“Repair” resets bills marked PREPAID back to unpaid so only tuition is credited and extras (food/activity) are billed again. Bills the family truly paid are left untouched.':'“แก้ไข” จะรีเซ็ตบิลที่ถูกทำเครื่องหมาย PREPAID กลับเป็นค้างชำระ เพื่อให้ระบบเครดิตเฉพาะค่าเทอม และเรียกเก็บค่าอาหาร/กิจกรรมตามจริง (บิลที่จ่ายจริงไม่ถูกแตะ)'}</p>
        ${apply?'':`<button class="btn block pink" onclick="A_prepayAudit(true)">🛠️ ${EN()?'Repair flagged bills':'แก้ไขบิลที่เข้าข่าย'}</button>`}`
        :`<div class="card" style="background:#e8f5e9;border-color:#a5d6a7;color:#2e7d32">✓ ${EN()?'No affected bills — nothing to fix.':'ไม่มีบิลที่ได้รับผลกระทบ — ไม่ต้องแก้ไขอะไร'}</div>`}
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
    if(apply){ toast((EN()?'Repaired ':'แก้ไขแล้ว ')+r.repaired); }
  };
  SCREENS.Admin.finance = async () => { const month=FIN_MONTH||monthStr(); const f=await api('financeSummary',{month});
    const stat=(cls,n,l)=>`<div class="stat ${cls}"><div class="n">${n}</div><div class="l">${esc(l)}</div></div>`;
    app.innerHTML=`<h2 class="page">💰 ${esc(t('fin.title'))} <button class="btn sm outline" style="float:right;font-size:12px" onclick="A_prepayAudit()">🔍 ${EN()?'Prepay check':'ตรวจ prepay ย้อนหลัง'}</button></h2>
      <div class="card"><label class="field"><span>${esc(t('c.month'))}</span><input type="month" value="${month}" onchange="FIN_set(this.value)"/></label>
        <div class="grid2"><div class="grid2" style="grid-template-columns:1fr 1fr;gap:8px">${stat('green',baht(f.income),t('fin.income'))}${stat('pink',baht(f.expense),t('fin.expense'))}</div>
          <div class="grid2" style="grid-template-columns:1fr 1fr;gap:8px">${stat(f.net>=0?'':'amber',baht(f.net),t('fin.net'))}${stat('amber',baht(f.tuitionOutstanding),t('fin.outstanding'))}</div></div></div>
      <div class="card"><div class="spread"><h3>👶 ${esc(t('fin.tuition'))}</h3><span class="pill ${f.studentsPaid>=f.studentsTotal?'ok':'wait'}">${f.studentsPaid}/${f.studentsTotal} ${esc(t('fin.paid'))}</span></div>
        ${f.students.map(s=>`<div class="list-item" style="cursor:pointer" onclick="A_finStudent('${s.studentId}')"><span><b>${esc(dnick(s))}</b><br><small class="muted" style="font-weight:400">${esc(dn(s))} · ${esc(planLabel(s.plan))}</small></span><span>${baht(s.due||s.amount)} ${s.paid?`<span class="pill ok">${esc(t('s.paid'))}</span>`:s.partial?`<span class="pill wait">${EN()?'partial':'บางส่วน'} ${baht(s.collected)}</span>`:s.status==='NO_BILL'?`<span class="pill info">${esc(t('fin.noBill'))}</span>`:`<span class="pill bad">${esc(t('s.unpaid'))}</span>`} <span class="muted">›</span></span></div>`).join('')}
        <div class="spread" style="margin-top:8px"><b>${esc(t('fin.collected'))}</b><b style="color:#2e7d32">${baht(f.tuitionCollected+f.otCollected)}</b></div></div>
      <div class="card"><div class="spread"><h3>👩‍🏫 ${esc(t('fin.salary'))}</h3><span class="pill ${f.staffPaid>=f.staffTotal?'ok':'wait'}">${f.staffPaid}/${f.staffTotal} ${esc(t('fin.computed'))}</span></div>
        ${f.staff.map(s=>`<div class="list-item" style="cursor:pointer" onclick="A_finStaff('${s.staffId}')"><span><b>${esc(dnick(s))}</b> <small class="muted" style="font-weight:400">${esc(dn(s))}</small></span><span>${baht(s.net)} ${s.computed?`<span class="pill ok">${esc(t('fin.done'))}</span>`:`<span class="pill bad">${esc(t('fin.pending'))}</span>`} <span class="muted">›</span></span></div>`).join('')}
        <div class="spread" style="margin-top:8px"><b>${esc(t('fin.totalSalary'))}</b><b style="color:#c62828">${baht(f.expense)}</b></div></div>`;
  };
  window.FIN_set=(m)=>{ FIN_MONTH=m; GO('finance'); };

  // ---- Finance: per-student detail (bill + extra charges + OT) — view/add/edit/delete in one place ----
  window.A_finStudent=async(sid)=>{ const month=FIN_MONTH||monthStr();
    const [bills,charges,ot,allSlips]=await Promise.all([api('payments',{studentId:sid}),api('studentCharges',{studentId:sid,month}),api('otDaily',{studentId:sid}),api('paymentSlips',{studentId:sid})]);
    const s=(A_CACHE.students||[]).find(x=>x.StudentID===sid)||(MOCK.students||[]).find(x=>x.StudentID===sid)||{};
    const slipsOf=(kind,id)=>(allSlips||[]).filter(x=>x.RefKind===kind&&x.RefID===id);
    const bill=(bills||[]).find(b=>ym(b.Month)===ym(month));
    const otM=(ot||[]).filter(o=>ym(o.Date)===ym(month));
    const stPill=st=>({UNPAID:'bad',PENDING_VERIFY:'wait',PARTIAL:'wait',PAID:'ok',CANCELLED:'info'}[st]||'info');
    const billBox = bill
      ? `<table style="width:100%;font-size:13.5px;margin:4px 0">${(bill.Items||[]).map(it=>`<tr><td>${esc(it[0])}</td><td style="text-align:right">${baht(it[1])}</td></tr>`).join('')}
          <tr style="border-top:1px solid #ddd"><td><b>${EN()?'Total due':'ยอดรวม'}</b></td><td style="text-align:right"><b>${baht(bill.TotalDue!=null?bill.TotalDue:bill.Amount)}</b></td></tr>
          ${Number(bill.PaidConfirmed||0)>0?`<tr><td>${EN()?'Paid':'ชำระแล้ว'}</td><td style="text-align:right;color:#2e7d32">−${baht(bill.PaidConfirmed)}</td></tr>`:''}
          <tr><td><b>${EN()?'Outstanding':'คงค้าง'}</b></td><td style="text-align:right"><b style="color:${Number(bill.Outstanding||0)>0?'#c62828':'#2e7d32'}">${baht(bill.Outstanding||0)}</b></td></tr></table>
        ${slipHistoryHTML(slipsOf('bill',bill.BillingID))}
        <div class="row" style="margin-top:6px"><button class="btn sm pink" onclick="A_finDelBill('${esc(bill.BillingID)}','${sid}')">🗑️ ${EN()?'Delete bill':'ลบบิล'}</button></div>`
      : `<p class="muted" style="font-size:12px">${EN()?'No bill issued for this month yet.':'ยังไม่ได้ออกบิลของเดือนนี้'}</p><button class="btn sm" onclick="A_finIssueBill('${sid}')">🧾 ${EN()?'Issue this month’s bill':'ออกบิลเดือนนี้'}</button>`;
    const chargeBox = `${(charges||[]).length?(charges).map(c=>`<div class="list-item"><span>${esc(c.Label)} <b>${baht(c.Amount)}</b></span><button class="btn sm pink" onclick="A_finDelCharge('${esc(c.ChargeID)}','${sid}')">🗑️</button></div>`).join(''):`<small class="muted">${EN()?'No extra charges':'ไม่มีรายการเพิ่มเติม'}</small>`}
      <div class="grid2" style="margin-top:6px"><input id="fcLabel" placeholder="${EN()?'e.g. Special class':'เช่น ค่าเรียนพิเศษ'}"/><input id="fcAmt" type="number" placeholder="${EN()?'amount':'จำนวนเงิน'}"/></div>
      <button class="btn sm outline block" style="margin-top:6px" onclick="A_finAddCharge('${sid}')">+ ${EN()?'Add charge':'เพิ่มรายการ'}</button>`;
    const otBox = `${otM.length?otM.map(o=>{ const sl=slipsOf('ot',o.OTID);
      return `<div style="border-bottom:1px solid #f0f0f0;padding:4px 0"><div class="list-item"><span>${esc(ymd(o.Date))} · ${esc(String(o.PickupTime||'').slice(0,5))} <b>${baht(o.Amount)}</b> <span class="pill ${stPill(o.Status)}" style="font-size:10px">${esc(o.Status)}</span></span>
        ${o.Status==='PAID'?'':`<span class="row">${o.Status==='CANCELLED'?`<button class="btn sm outline" onclick="A_finOt('${esc(o.OTID)}','restore','${sid}')">♻️</button>`:`<button class="btn sm pink" onclick="A_finOt('${esc(o.OTID)}','cancel','${sid}')">🚫</button>`}</span>`}</div>${slipHistoryHTML(sl)}</div>`; }).join(''):`<small class="muted">${EN()?'No OT this month':'ไม่มี OT เดือนนี้'}</small>`}`;
    modal(`<h3>💰 ${esc(dispNick(s)||sid)} <small class="muted" style="font-size:13px">${esc(planLabel(s.Plan))}${s.Class?' · '+esc(s.Class):''}</small></h3>
      <p class="muted" style="font-size:12px">${EN()?'Month':'เดือน'} <b>${esc(month)}</b> — ${EN()?'change the month at the finance page':'เปลี่ยนเดือนได้ที่หน้าการเงิน'}</p>
      <div class="card" style="padding:8px"><b>🧾 ${EN()?'Monthly bill':'บิลรายเดือน'}</b>${billBox}</div>
      <div class="card" style="padding:8px"><b>💵 ${EN()?'Extra charges':'ค่าใช้จ่ายเพิ่มเติม'}</b>${chargeBox}</div>
      <div class="card" style="padding:8px"><b>⏰ ${EN()?'Late-pickup OT':'OT รับช้า'}</b>${otBox}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  const _finReopen=(sid)=>{ const x=document.querySelector('.modal'); if(x)x.remove(); A_finStudent(sid); };
  window.A_finAddCharge=async(sid)=>{ const m=document.querySelector('.modal'); const label=(m.querySelector('#fcLabel').value||'').trim(); const amt=Number(m.querySelector('#fcAmt').value)||0;
    if(!label||!amt){ toast(EN()?'Enter label and amount':'กรอกชื่อรายการและจำนวนเงิน'); return; }
    try{ await api('addStudentCharge',{studentId:sid,month:FIN_MONTH||monthStr(),label,amount:amt}); _finReopen(sid); }catch(e){err(e);} };
  window.A_finDelCharge=async(chargeId,sid)=>{ try{ await api('removeStudentCharge',{chargeId}); _finReopen(sid); }catch(e){err(e);} };
  window.A_finIssueBill=async(sid)=>{ try{ await api('issueBill',{studentId:sid,month:FIN_MONTH||monthStr()}); _finReopen(sid); }catch(e){err(e);} };
  window.A_finDelBill=async(billingId,sid)=>{ if(!confirm(EN()?'Delete this bill?':'ลบบิลนี้?'))return; try{ await api('deleteBill',{billingId}); _finReopen(sid); }catch(e){err(e);} };
  window.A_finOt=async(otId,kind,sid)=>{ try{ await api(kind==='cancel'?'adminCancelOT':'adminRestoreOT',{otId}); _finReopen(sid); }catch(e){err(e);} };

  // ---- Finance: per-staff detail (salary base + this-month OT + compute) ----
  window.A_finStaff=async(sid)=>{ const month=FIN_MONTH||monthStr();
    const s=(A_CACHE.staff||[]).find(x=>x.StaffID===sid)||{};
    let otTotal=0; try{ const mo=await api('staffMonthlyOT',{staffId:sid,month}); otTotal=(mo||[]).reduce((a,o)=>a+Number(o.Amount||0),0); }catch(e){}
    modal(`<h3>👩‍🏫 ${esc(dispNick(s)||sid)} <small class="muted" style="font-size:13px">${esc(s.Position||'')}</small></h3>
      <div class="card" style="padding:8px"><label class="field"><span>${EN()?'Base salary (฿/month)':'ฐานเงินเดือน (฿/เดือน)'}</span><input id="fsBase" type="number" min="0" value="${esc(s.BaseSalary!=null?s.BaseSalary:'')}"/></label>
        <button class="btn sm block" onclick="A_finSaveBase('${sid}')">💾 ${EN()?'Save base salary':'บันทึกฐานเงินเดือน'}</button></div>
      <div class="card" style="padding:8px"><div class="spread"><span>⏰ ${EN()?'Approved OT this month':'OT อนุมัติเดือนนี้'}</span><b>${baht(otTotal)}</b></div></div>
      <div class="row"><button class="btn sm" onclick="A_finCompute('${sid}')">🧮 ${EN()?'Compute payroll':'คำนวณเงินเดือน'}</button><button class="btn sm outline" onclick="this.closest('.modal').remove();GO('payroll')">📄 ${EN()?'Full payroll':'หน้าเงินเดือนเต็ม'}</button></div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_finSaveBase=async(sid)=>{ const m=document.querySelector('.modal'); const base=Number(m.querySelector('#fsBase').value)||0;
    try{ await api('saveStaff',{staffId:sid,data:{BaseSalary:base}}); toast(t('c.saved')); }catch(e){err(e);} };
  window.A_finCompute=async(sid)=>{ try{ await api('computePayroll',{staffId:sid,month:FIN_MONTH||monthStr()}); toast(EN()?'Computed':'คำนวณแล้ว'); const x=document.querySelector('.modal'); if(x)x.remove(); GO('finance'); }catch(e){err(e);} };

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
    const kindLbl=k=>({bill:t('verify.monthly'),ot:'OT',prepay:t('prepay.title')}[k]||k);
    app.innerHTML=`<h2 class="page">✅ ${esc(t('verify.title'))}</h2>
      <p class="muted" style="font-size:12px">${esc(t('verify.note'))}</p>
      ${list.length?list.map(x=>{
        const cash=x.cash; const methodPill=`<span class="pill ${cash?'wait':'info'}">${cash?'💵 '+esc(t('pay.cash')):'🏦 '+esc(t('pay.transfer'))}</span>`;
        const confirmed=Number(x.confirmedPaid||0), outstanding=Number(x.outstanding!=null?x.outstanding:Math.max(0,x.due-confirmed));
        // per-slip confirm/reject rows (each slip has its own image + SlipOK verified flag)
        const slipRows=(x.slips||[]).map(s=>`<div class="card" style="padding:8px;background:#fafbfe"><div class="row" style="gap:10px;align-items:flex-start">
            ${slipThumb2(s.url)}
            <div style="flex:1"><div><b>${baht(s.amount)}</b> ${slipVerBadge(s.verified)}</div>
              ${s.receiver?`<small class="muted">→ ${esc(s.receiver)}</small><br>`:''}${s.transRef?`<small class="muted">ref ${esc(s.transRef)}</small><br>`:''}
              <small class="muted">${esc(String(s.date||'').slice(0,16))}</small></div></div>
            <div class="row" style="margin-top:6px"><button class="btn sm green" onclick="A_confirmSlip('${esc(s.slipId)}',this)">✅ ${EN()?'Confirm this slip':'ยืนยันสลิปนี้'}</button><button class="btn sm pink" onclick="A_rejectSlip('${esc(s.slipId)}')">✗ ${esc(t('verify.reject'))}</button></div></div>`).join('');
        return `<div class="card"><div class="spread"><div><b>${esc(EN()?x.nameEN:x.name)}</b> <span class="pill info">${esc(kindLbl(x.kind))}</span> ${methodPill}<br><small class="muted">${esc(x.label)}${x.transactionDate?' · '+esc(t('pay.txnDate'))+' '+esc(x.transactionDate):''}</small></div></div>
          <table style="width:100%;font-size:13px;margin:6px 0"><tr><td>${esc(t('slip.amountDue'))}</td><td style="text-align:right"><b>${baht(x.due)}</b></td></tr>
          ${confirmed>0?`<tr><td>${EN()?'Confirmed so far':'ยืนยันแล้ว'}</td><td style="text-align:right;color:#2e7d32">${baht(confirmed)}</td></tr>`:''}
          <tr><td><b>${EN()?'Outstanding':'คงค้าง'}</b></td><td style="text-align:right"><b style="color:${outstanding>0?'#c62828':'#2e7d32'}">${baht(outstanding)}</b></td></tr></table>
          <label class="field"><span>${esc(t('pay.paidDate'))}</span><input type="date" id="pd_${esc(x.id)}" value="${todayStr()}"/></label>
          ${cash?`<div style="background:#fffbe6;border-radius:8px;padding:6px 8px;font-size:12.5px;color:#8a6d00;margin-bottom:6px">💵 ${esc(t('verify.cashPending'))} ${baht(x.slipAmount)}</div>
            <div class="row"><button class="btn sm green" onclick="A_confirmPay('${x.kind}','${x.id}','cash')">✅ ${esc(t('verify.confirm'))}</button><button class="btn sm pink" onclick="A_rejectPay('${x.kind}','${x.id}')">✗ ${esc(t('verify.reject'))}</button></div>`
            : (slipRows||`<small class="muted">${EN()?'no slips':'ไม่มีสลิป'}</small>`)}</div>`;
      }).join(''):`<div class="card muted">${esc(t('verify.empty'))}</div>`}`;
  };
  // bigger slip preview for the admin (tap to zoom)
  function slipThumb2(url){ return url?`<img src="${esc(url)}" alt="slip" style="width:90px;height:110px;object-fit:cover;border-radius:8px;border:1px solid #eee;cursor:zoom-in" onclick="ZOOM_IMG('${esc(url)}')" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'qr-ph',textContent:'📎'}))"/>`:`<div class="qr-ph" style="width:90px;height:110px">📎</div>`; }
  window.A_confirmSlip=async(slipId,btn)=>{ const card=btn?btn.closest('.card'):null; const d=card&&card.parentElement?card.parentElement.querySelector('input[type=date]'):null; const paidDate=(d&&d.value)||todayStr();
    try{ const r=await api('confirmSlip',{slipId,adminId:USER.staffId,paidDate}); const out=Number(r&&r.outstanding||0); confirmSaved(out>0?(EN()?`Confirmed. Still outstanding ${baht(out)}`:`ยืนยันแล้ว ยังค้าง ${baht(out)}`):t('verify.confirmed')); GO('verify'); }catch(e){err(e);} };
  window.A_rejectSlip=async(slipId)=>{ if(!confirm(t('verify.rejectConfirm')))return; try{ await api('rejectSlip',{slipId}); toast(t('verify.rejected')); GO('verify'); }catch(e){err(e);} };
  window.A_confirmPay=async(kind,id,method)=>{ const d=document.getElementById('pd_'+id); const paidDate=(d&&d.value)||todayStr();
    try{ await api('confirmPayment',{kind,id,adminId:USER.staffId,paidDate,method}); confirmSaved(t('verify.confirmed')); GO('verify'); }catch(e){err(e);} };
  window.A_rejectPay=async(kind,id)=>{ if(!confirm(t('verify.rejectConfirm')))return; try{ await api('rejectPayment',{kind,id}); toast(t('verify.rejected')); GO('verify'); }catch(e){err(e);} };

  // ---- absence tracking (Teacher / Leader / Admin) ----
  async function absenceScreen(){ setNav(CURRENT);
    const [all,rate]=await Promise.all([api('absenceReport',{minDays:2}),api('ratedChildCount')]);
    const g1=all.filter(s=>s.group==='range'), g2=all.filter(s=>s.group==='over5');
    const STATUSES=['','กำลังติดตาม','ติดตามแล้ว','ลายาว','ออกกลางคัน'];
    // if the child has since returned, annotate the come-back date behind the count
    const backNote=s=>s.returnedDate?` · <span style="color:#2e7d32;font-weight:600">${EN()?'came back':'มาแล้ว'} ${esc(s.returnedDate)}</span>`:` · <span style="color:#c62828">${EN()?'still absent':'ยังขาดอยู่'}</span>`;
    const row=(s)=>`<div class="list-item" style="flex-wrap:wrap"><span><b>${esc(s.nick||s.name)}</b> <small class="muted">${esc(s.name)} · ${esc(s.class)} · ${esc(t('abs.days').replace('{n}',s.count))}${s.reasons?' · '+esc(s.reasons):''}</small>${backNote(s)}</span>
      <span class="row" style="width:100%;margin-top:6px"><input id="fn_${s.studentId}" placeholder="${esc(t('abs.note'))}" value="${esc(s.note)}" style="flex:1"/>
        <select id="fs_${s.studentId}">${STATUSES.map(st=>`<option ${s.status===st?'selected':''}>${esc(st||'-')}</option>`).join('')}</select>
        <button class="btn sm" onclick="A_followup('${s.studentId}')">${esc(t('c.save'))}</button></span></div>`;
    const back = USER.role==='Admin'?'manage':'home';
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('${back}')">${t('c.back')}</button><h2 class="page">🔎 ${esc(t('abs.title'))}</h2>
      <div class="card" style="background:#eef6ff"><div class="spread"><b>${esc(t('abs.rated'))}</b><b>${rate.rated}/${rate.total}</b></div><small class="muted">${esc(t('abs.rateNote').replace('{n}',rate.excludeDays).replace('{x}',rate.excluded))}</small></div>
      <div class="card"><h3>⚠️ ${EN()?'Absent 2–5 days':'ขาด 2–5 วัน'} <small class="muted">(${g1.length})</small></h3>${g1.length?g1.map(row).join(''):`<small class="muted">${esc(t('c.noItems'))}</small>`}</div>
      <div class="card" style="border:1px solid #ffcdd2"><h3>🚨 ${EN()?'Absent over 5 days':'ขาดเกิน 5 วัน'} <small class="muted">(${g2.length})</small></h3>${g2.length?g2.map(row).join(''):`<small class="muted">${esc(t('c.noItems'))}</small>`}</div>`;
  }
  SCREENS.Teacher.absence = absenceScreen; SCREENS.Admin.absence = absenceScreen;
  window.A_followup=async(sid)=>{ await api('setAbsenceFollowup',{studentId:sid,note:$('#fn_'+sid).value,status:$('#fs_'+sid).value==='-'?'':$('#fs_'+sid).value}); confirmSaved(t('c.saved')); };

  // Admin audit: every on-behalf student check-in/out (staff, ACTUAL time entered, reason, OT produced)
  // so a disputed pick-up time — e.g. picked up 12:57 but recorded 17:26 → false OT — can be verified.
  window.A_checkinLog=async()=>{ let rows=[]; try{ rows=await api('staffCheckinLog',{days:30})||[]; }catch(e){ err(e); return; }
    const row=r=>`<div class="list-item" style="flex-wrap:wrap"><span><b>${r.type==='IN'?'🟢 '+(EN()?'IN':'ส่ง'):'🔵 '+(EN()?'OUT':'รับ')}</b> ${esc(r.nick||r.name||r.studentId)} <small class="muted">${esc(r.name||'')}</small><br>
      <small class="muted">📅 ${esc(r.date)} · ⏰ ${esc(r.time)} · 👩‍🏫 ${esc(r.byStaff)}</small><br>
      <small>📝 ${esc(r.remark||'-')}</small>${r.otAmount?`<br><small style="color:#e65100">⏰ ${EN()?'OT charged':'คิด OT'} ${baht(r.otAmount)}${r.planEnd?' ('+(EN()?'plan end ':'เลิก ')+esc(r.planEnd)+')':''}</small>`:''}</span></div>`;
    modal(`<h3>📍 ${EN()?'On-behalf check-in log (30d)':'ประวัติเช็คอิน-เอาท์แทน (30 วัน)'}</h3>
      <p class="muted" style="font-size:12px">${EN()?'Recorded by staff for a non-registered pickup. Time shown is the ACTUAL time the teacher entered.':'บันทึกโดยคุณครูแทนผู้มารับ-ส่ง · เวลาที่แสดงคือเวลาจริงที่คุณครูกรอก'}</p>
      <div style="max-height:60vh;overflow:auto">${rows.length?rows.map(row).join(''):`<small class="muted">${EN()?'No records':'ยังไม่มีรายการ'}</small>`}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`); };

  // Admin chat -> LINE OA (manage all conversations in one place)
  SCREENS.Admin.chat = async () => { const line=MOCK.config.Links.line||'#';
    app.innerHTML=`<h2 class="page">💬 ${esc(t('title.chat'))}</h2>
      <div class="card" style="text-align:center"><div style="font-size:48px">💬</div>
        <p>${esc(t('chat.lineMsg'))}</p>
        <a class="btn block green" href="${esc(line)}" target="_blank">${esc(t('chat.openLine'))} →</a>
        <p class="muted" style="font-size:12px;margin-top:10px">${esc(t('chat.lineNote'))}</p></div>${verTag()}`;
  };

  // look up a staff record from the admin cache first (MOCK.staff is empty in gas mode)
  const staffRec = id => (window.A_CACHE&&(A_CACHE.staff||[]).find(x=>x.StaffID===id)) || (MOCK.staff||[]).find(x=>x.StaffID===id) || null;
  function staffName(id){ const s=staffRec(id); return s?nm(s):id; }
  function staffNick(id){ const s=staffRec(id); return s?dispNick(s):id; }
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
