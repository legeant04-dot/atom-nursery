/* app.js — UI shell + 3 portals on the mock API (revamped). */
(function () {
  const $ = s => document.querySelector(s);
  // Deferred writes (after an await) must tolerate the user having navigated away — the target node
  // is gone and `el.innerHTML=` would throw "Cannot set properties of null" and clobber the new screen.
  const setHTML = (sel, html) => { const el = $(sel); if (el) el.innerHTML = html; };
  const app = $('#app'), nav = $('#bottomnav');
  // Unsaved-changes guard (see the listeners + leaveOk() further down). Declared up here because the
  // api() wrapper below clears FORM_DIRTY as soon as any mutation succeeds.
  let FORM_DIRTY = false, CUR_SUB = null;
  const baht = n => (Number(n)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  // ---- global "processing" overlay + double-submit guard ----------------------------------------
  // Any MUTATING api() call covers the screen with "ระบบกำลังดำเนินการ" (pointer-events blocked) so the
  // user can't double-tap a button or resubmit while the request is in flight. Reads are never covered
  // (they paint from cache instantly). Wraps window.api once, after api.js has defined it.
  const _mutRe = /^(submit|save|add|remove|delete|set|register|pay|upload|confirm|reject|issue|generate|move|export|import|compute|cancel|prepay|link|notify|request|mark|approve|edit|rename|update|change|seed|dedup|reindex)/i;
  const _isMut = a => _mutRe.test(a) || /check(in|out)|absence|payOT$|^orgMove|^unlink|^claim/i.test(a);
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
  function _busyDone(ok){ if(!ok) _busyFail=true; else FORM_DIRTY=false;   // saved → nothing left to lose
    if(_busyN>0)_busyN--; if(_busyN!==0||!_busyEl) return;
    if(_busyFail){ _busyFail=false; _busyEl.classList.remove('on','ok'); return; }
    _busyFail=false; _busyEl.classList.add('ok'); _busyEl.querySelector('.busy-txt').textContent=_EN()?'Done':'สำเร็จ';
    clearTimeout(_busyOkT); _busyOkT=setTimeout(()=>{ if(_busyN===0&&_busyEl){ _busyEl.classList.remove('on','ok'); _busyEl.querySelector('.busy-txt').textContent=_busyTxt(); } }, 750); }
  // ---- the same overlay for SLOW READS -----------------------------------------------------------
  // Opening a screen used to give no feedback at all when the data wasn't cached yet: the old screen
  // just sat there, so people tapped the tab again. Covering every read would be worse — most paint
  // from cache instantly and an overlay would make the app FEEL slower. So the overlay is armed on a
  // delay: if a read is still in flight after READ_LAG it is genuinely fetching, and the user sees
  // "ระบบกำลังดำเนินการ". Anything faster than that shows nothing at all.
  // Kept separate from the mutation counter on purpose — a read finishing must NOT flash the green ✓
  // (nothing was saved) and must NOT clear FORM_DIRTY.
  const READ_LAG = 350;   // slower than this and the user deserves to be told something is happening
  const READ_IDLE = 120;  // gap allowed between chained fetches before the wait counts as over
  let _readN=0, _readT=null, _readIdle=null, _readShown=false;
  function _readStart(){ _readN++; clearTimeout(_readIdle); _readIdle=null;
    if(_readT||_readShown) return;                     // a wait is already being timed
    _readT=setTimeout(()=>{ _readT=null;
      if(_readN>0 && _busyN===0){ _readShown=true; const el=_busyEnsure();
        el.classList.remove('ok'); el.querySelector('.busy-txt').textContent=_busyTxt(); el.classList.add('on'); } }, READ_LAG); }
  // Screens fetch in several steps (the deferred setHTML islands each run their own call), so the
  // count drops to 0 between them while the user is still staring at a half-drawn page. Waiting out
  // a short idle gap before disarming makes one screen load count as ONE wait — otherwise 5 chained
  // 110ms fetches (measured: 571ms of real waiting) showed nothing at all.
  function _readEnd(){ if(_readN>0)_readN--; if(_readN>0) return;
    clearTimeout(_readIdle);
    _readIdle=setTimeout(()=>{ _readIdle=null; if(_readN>0) return;
      if(_readT){ clearTimeout(_readT); _readT=null; }
      if(_readShown){ _readShown=false; if(_busyN===0 && _busyEl) _busyEl.classList.remove('on','ok'); } }, READ_IDLE); }
  // ---- offline outbox ---------------------------------------------------------------------------
  // Losing a morning's attendance because the school wi-fi dropped is the worst failure this app has.
  // But a blind retry queue is worse than none: replaying a payment or a bill would create a second
  // one. So ONLY actions that are safe to send twice are held. Each of these was checked in the GAS
  // handler: staffStudentCheckin updates the existing row for that (student, date, type);
  // submitJournal writes by (student, date); studentAbsence returns the existing leave on a
  // duplicate; submitAssessment clears the previous result per item first. Everything that CREATES a
  // row (payments, slips, bills, growth records) or deletes one is deliberately NOT queued.
  const QUEUEABLE = { staffStudentCheckin:1, submitJournal:1, studentAbsence:1, submitAssessment:1 };
  const QKEY='atom_outbox_v1';
  const _isNetErr = e => { const m=String((e&&e.message)||e||'');
    return (typeof navigator!=='undefined' && navigator.onLine===false) ||
      /failed to fetch|networkerror|load failed|network request failed/i.test(m); };
  const qLoad=()=>{ try{ return JSON.parse(localStorage.getItem(QKEY)||'[]'); }catch(e){ return []; } };
  const qSave=l=>{ try{ localStorage.setItem(QKEY, JSON.stringify(l)); }catch(e){} qBadge(); };
  function qAdd(action,payload){ const l=qLoad();
    l.push({ id:Date.now()+'-'+Math.random().toString(36).slice(2,7), action, payload, at:new Date().toISOString() });
    qSave(l); }
  function qBadge(){ const n=qLoad().length; let el=document.getElementById('outbox');
    if(!n){ if(el) el.remove(); return; }
    if(!el){ el=document.createElement('button'); el.id='outbox'; el.type='button';
      el.onclick=()=>qFlush(true); document.body.appendChild(el); }
    el.textContent = (EN()?`📥 ${n} waiting to send — tap to retry`:`📥 รอส่ง ${n} รายการ · แตะเพื่อลองใหม่`); }
  let _rawApi=null, _qFlushing=false;
  async function qFlush(manual){
    if(_qFlushing || !_rawApi) return;
    let l=qLoad(); if(!l.length){ qBadge(); return; }
    if(typeof navigator!=='undefined' && navigator.onLine===false){ if(manual) toast(EN()?'Still offline':'ยังออฟไลน์อยู่'); return; }
    _qFlushing=true; const left=[]; let sent=0, dropped=0;
    for(const it of l){
      try{ await _rawApi(it.action, it.payload); sent++; }
      catch(e){
        if(_isNetErr(e)) left.push(it);        // still offline — keep it for next time
        else dropped++;                        // the server rejected it; retrying forever won't help
      }
    }
    _qFlushing=false; qSave(left);
    if(sent) toast(EN()?`✅ Sent ${sent} saved item(s)`:`✅ ส่งข้อมูลที่ค้างไว้แล้ว ${sent} รายการ`, 3600, true);
    if(dropped) toast(EN()?`⚠️ ${dropped} item(s) could not be sent and were discarded`:`⚠️ ส่งไม่สำเร็จ ${dropped} รายการ (ระบบปฏิเสธ)`, 5200, true);
  }
  window.addEventListener('online', ()=>qFlush());
  if(typeof document!=='undefined') document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) qFlush(); });

  if(window.api && !window.__apiBusyWrapped){ window.__apiBusyWrapped=true; _rawApi=window.api;
    window.api=function(action,payload,opts){
      if(_isMut(action)){
        _busyShow(); let pr; try{ pr=_rawApi(action,payload,opts); }catch(e){ _busyDone(false); throw e; }
        return Promise.resolve(pr).then(v=>{ _busyDone(true); qFlush(); return v; }, e=>{ _busyDone(false);
          // network died mid-save and this action is replay-safe → keep it and let the UI carry on.
          // The outbox pill is what tells the truth: "saved" plus "2 waiting to send".
          if(!_qFlushing && QUEUEABLE[action] && _isNetErr(e)){ qAdd(action,payload); return {queued:true}; }
          throw e; });
      }
      if(opts&&opts.quiet) return _rawApi(action,payload,opts);   // PREFETCH: warming the cache in the background
      _readStart(); let pr; try{ pr=_rawApi(action,payload,opts); }catch(e){ _readEnd(); throw e; }
      return Promise.resolve(pr).then(v=>{ _readEnd(); return v; }, e=>{ _readEnd(); throw e; }); }; }
  setTimeout(()=>{ qBadge(); qFlush(); }, 1200);   // anything left from a previous session
  const APP_VERSION = 'Version 1.261'; // bump each webapp change; shown only at the bottom of the Chat screen
  window.__atomVer = APP_VERSION;      // api.js stamps it on every telemetry row (which build was slow?)
  const verTag = () => `<div style="text-align:center;color:var(--ink-3);font-size:11px;margin-top:24px">${APP_VERSION}</div>`;
  // phones are stored as numbers in Sheets so the leading 0 is lost — re-add it for Thai mobiles + make it a tap-to-call link
  const phoneFmt = p => { let d=String(p==null?'':p).replace(/\D/g,''); if(d.length===9) d='0'+d; return d; };
  const phoneLink = p => { const d=phoneFmt(p); return d?`<a href="tel:${d}" onclick="event.stopPropagation()" style="color:inherit;text-decoration:underline dotted">${esc(d)}</a>`:'-'; };
  const esc = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  // Escape AND shield from the EN phrase dictionary. Use for anything the school typed in (names,
  // staff-group names, addresses): word-by-word substitution turned "ครูประจำ" into "Teacherประจำ".
  const _notr = v => `<span translate="no">${esc(v)}</span>`;
  // Relationship is free text in the sheet, but in practice it is one of three values. Translate
  // those; anything else the school typed is shown as-is (and shielded, so the EN phrase dictionary
  // can't chop it into a half-English hybrid).
  const REL_EN = { 'บิดา':'Father', 'มารดา':'Mother', 'ผู้ปกครอง':'Guardian' };
  // strip any tags: v156-v157 briefly rendered this label INTO the profile input, so a parent who saved
  // My-info in that window stored '<span translate="no">มารดา</span>' in PARENTS.Relationship
  const relLabel = v => { const s=String(v==null?'':v).replace(/<[^>]*>/g,'').trim(); if(!s) return '';
    return (EN() && REL_EN[s]) ? esc(REL_EN[s]) : _notr(s); };
  // password input with a 👁️ show/hide toggle
  const pwField = (id,label,ph)=>`<label class="field"><span>${esc(label)}</span><div class="row" style="gap:6px"><input type="password" id="${id}" placeholder="${esc(ph||'')}" style="flex:1"/><button type="button" class="btn sm outline" onclick="PW_toggle('${id}',this)" title="show/hide" aria-label="${EN()?"Show or hide password":"แสดง/ซ่อนรหัสผ่าน"}" title="${EN()?"Show or hide password":"แสดง/ซ่อนรหัสผ่าน"}">👁️</button></div></label>`;
  window.PW_toggle=(id,btn)=>{ const e=document.getElementById(id); if(!e)return; const show=e.type==='password'; e.type=show?'text':'password'; if(btn)btn.textContent=show?'🙈':'👁️'; };
  const p2 = n => String(n).padStart(2,'0');
  const todayStr = () => { const d=new Date(); return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate()); };
  const monthStr = () => todayStr().slice(0,7);
  const ymd = v => String(v==null?'':v).slice(0,10);   // date part 'YYYY-MM-DD' (dates arrive as strings from the engine)
  const ym = v => String(v==null?'':v).slice(0,7);      // month part 'YYYY-MM'
  const nowTime = () => { const d=new Date(); return p2(d.getHours())+':'+p2(d.getMinutes()); };
  // "printed at" for an exported document. LOCAL, never toISOString() — that is UTC, and a sheet
  // printed at 14:08 in Bangkok came out stamped 07:08.
  const nowStamp = () => todayStr()+' '+nowTime();
  const initialEN = name => { let s=String(name||'?').replace(/^(Ms\.|Mr\.|Mrs\.|Miss|Master)\s*/i,'').trim(); const m=s.match(/[A-Za-z]/); return (m?m[0]:s[0]||'?').toUpperCase(); };
  const nm = o => o ? (LANG()==='en' ? (o.NameEN||o.NameTH||'') : (o.NameTH||o.NameEN||'')) : '';
  // language-aware nickname (EN nickname shown in English mode, Thai otherwise)
  const nick = o => o ? (LANG()==='en' ? (o.NicknameEN||o.Nickname||'') : (o.Nickname||o.NicknameEN||'')) : '';
  // full name + nickname, for plain-text spots (<option>, chips, headings) where a pill can't be used
  const nmn = o => { const n=nm(o), k=nick(o); return k ? `${n} (${k})` : n; };
  // the same as an inline pill, for list rows
  const nickPill = o => nick(o) ? ` <span class="pill info">${esc(nick(o))}</span>` : '';
  const dn = o => o ? (LANG()==='en' ? (o.nameEN||o.name||'') : (o.name||o.nameEN||'')) : '';
  // Secondary "full name" line. dispNick/dnick fall back to the full name when a nickname is missing,
  // which printed the same name twice ("ธนิดา ศรีพลาย ธนิดา ศรีพลาย"). Return it only when it adds
  // something. Both variants exist because engine DTOs are lowercase and sheet records PascalCase.
  const dnSub = o => { const n=dn(o), k=dnick(o); return (n && n!==k) ? n : ''; };
  const nmSub = o => { const n=nm(o), k=dispNick(o); return (n && n!==k) ? n : ''; };
  // nickname-first for lowercase DTOs (engine projections: name/nameEN/nick/nickEN)
  const dnick = o => o ? (LANG()==='en' ? (o.nickEN||o.nick||o.nameEN||o.name||'') : (o.nick||o.nickEN||o.name||o.nameEN||'')) : '';

  /* ---- one alphabetical order for the whole app ---------------------------------------------
   * Every list of people or things reads in the same order, in Thai and in English.
   *
   * Thai cannot be sorted with a plain string comparison: it puts ก…ฮ in Unicode order and gets the
   * leading vowels (เ แ โ ใ ไ) wrong, because those are written before the consonant they are
   * pronounced after — so เก้า would land far from where anyone looks for it. Intl.Collator with the
   * Thai locale knows the dictionary order. The browser has full data for this; Apps Script does not,
   * which is why the sorting happens here and not on the server.
   *
   * Titles are stripped first, so a list of children is not one long run of "ด.ช./ด.ญ." and parents
   * do not group into all the fathers followed by all the mothers. "คุณแม่น้องเก้า" therefore sorts
   * under เก้า — next to that child's other parent, which is how the school talks about them.
   */
  const TITLE_RE = /^(?:ด\.?\s*ช\.?|ด\.?\s*ญ\.?|เด็กชาย|เด็กหญิง|นางสาว|นาง|นาย|คุณพ่อน้อง|คุณแม่น้อง|ผู้ปกครองน้อง|คุณพ่อ|คุณแม่|คุณ|น้อง|Master|Miss|Mrs\.?|Mr\.?|Ms\.?)\s*/i;
  const sortKey = v => { let s=String(v==null?'':v).trim();
    for (let i=0;i<3 && TITLE_RE.test(s);i++) s=s.replace(TITLE_RE,'').trim();   // "นาย" + "น้อง" can stack
    return s || String(v==null?'':v).trim(); };                                  // a bare title still sorts somewhere
  let _collLang=null, _coll=null;
  /**
   * Two passes, on purpose.
   *
   * The first ignores tone marks and capitals, so นอง / น่อง / น้อง land together where someone
   * scanning the list expects them — which is the point of an alphabetical list. But "together" left
   * their order down to whatever the sheet happened to hold, so the same three names could appear in
   * a different order on two screens. The second pass breaks that tie by full comparison, which is
   * only ever reached for names the first pass called equal.
   */
  const collator = () => { const l=LANG()==='en'?'en':'th-TH';
    if (_collLang!==l) { _collLang=l;
      try {
        const base=new Intl.Collator(l,{numeric:true,sensitivity:'base',ignorePunctuation:true});
        const exact=new Intl.Collator(l,{numeric:true,sensitivity:'variant'});
        _coll={ compare:(a,b)=>base.compare(a,b) || exact.compare(a,b) };
      } catch(e){ _coll={compare:(a,b)=>String(a).localeCompare(String(b),l,{numeric:true})}; } }
    return _coll; };
  // sort a COPY, never the caller's array — several of these lists are shared caches
  const sortBy = (list, keyFn) => (list||[]).slice().sort((a,b)=>collator().compare(sortKey(keyFn(a)), sortKey(keyFn(b))));
  // the three shapes the app has: PascalCase records, lowercase DTOs, and plain strings
  const sortPeople  = list => sortBy(list, dispNick);
  const sortPeopleD = list => sortBy(list, dnick);
  const sortText    = list => sortBy(list, x=>x);
  window.__atomSortKey = sortKey;   // used by the tests

  // ---- display names: nickname-first everywhere; formal name kept for payroll/records ----
  const REL_DAD = /บิดา|father|พ่อ|^นาย|mr/i, REL_MOM = /มารดา|mother|แม่|^นาง|ms|mrs|miss/i;
  // title (คำนำหน้า) prefixed to a formal name; defaults from relationship when unset
  const titleOf = p => p ? (p.Title || (REL_DAD.test(p.Relationship||'')?'นาย':(REL_MOM.test(p.Relationship||'')?'นางสาว':''))) : '';
  const titledName = p => { const ti=EN()?'':titleOf(p); const n=nm(p); return ti?`${ti} ${n}`:n; };
  // student / staff: nickname first, else full name
  const dispNick = o => nick(o) || nm(o);
  /* Is this OT record the holiday LUMP SUM (as opposed to hours × rate)? The engine owns this rule
   * (isHolidayOT_) and Apps Script has its own (otIsHoliday_), because the three runtimes cannot
   * share a function — but the CLIENT had written it out five separate times, which is one drift
   * away from a calendar and a payslip disagreeing about the same row. One copy here, and
   * tools/test_one_rule.js fails if a sixth appears. */
  const isHolOT = o => String((o && o.Kind) || '').toUpperCase() === 'HOLIDAY';
  // ...and a holiday OT that is still countable: rejected ones are not on anybody's calendar or pay
  const isLiveHolOT = o => isHolOT(o) && String((o && o.Status) || '').toUpperCase() !== 'REJECTED';
  // a staff's department(s) for display — '*' = all, comma-list joined with ·
  const deptLabel = s => { const d=String((s&&s.Department)||''); if(d==='*')return EN()?'All depts':'ทุกแผนก'; return d.split(',').map(x=>x.trim()).filter(Boolean).join(' · ')||'-'; };
  // look up a student we already fetched (admin caches; parent scope has kids on the page)
  const findKid = id => (window.A_CACHE&&(A_CACHE.students||[]).find(s=>s.StudentID===id)) || (window._KIDS&&_KIDS.find(s=>s.StudentID===id)) || null;
  // Parent display is ALWAYS "คุณพ่อ/คุณแม่น้อง<ชื่อเล่นลูก>". The parent's own nickname is kept on
  // their record (and stays editable in the profile form) but is never used as a headline — the
  // school refers to parents by their child.
  function parentDisp(p, kid){
    if(!p) return '';
    const dad=REL_DAD.test(p.Relationship||'')||REL_DAD.test(p.Title||''), mom=REL_MOM.test(p.Relationship||'')||REL_MOM.test(p.Title||'');
    // p.StudentID only exists on legacy rows; modern links live in USER_LINKS, which parentKidsMap
    // resolves server-side (window._PKIDS) — without it a link-only parent fell back to their own
    // nickname and showed up as "กิ๊บ" instead of "คุณแม่น้องเลอา".
    const child = kid || findKid(p.StudentID) || ((window._PKIDS||{})[p.ParentID]||[])[0];
    const kn = child ? dispNick(child) : '';
    if(kn) return EN() ? `${kn}'s ${dad?'dad':mom?'mom':'parent'}` : `${dad?'คุณพ่อน้อง':mom?'คุณแม่น้อง':'ผู้ปกครองน้อง'}${kn}`;
    return titledName(p);   // no child resolvable → formal name, never their nickname
  }
  const EN = () => LANG()==='en';
  /* What the staff's extra scheduled workday is CALLED.
   *
   * It was "Big Cleaning Day" (🧹) and the school asked for it to read as a meeting instead — a
   * nursery's calendar is seen by parents, and a day named after cleaning says the wrong thing
   * about the place. Only the label changed: the stored config keys (BigCleaningDays / In / Out /
   * Amount) and every column already on the sheets are untouched, because renaming live data to
   * relabel a screen is how a term's records go missing. One name, one icon, one place — the
   * screens below all read these, so the next rename is a two-line change. */
  const BC_ICON  = '👥';
  const BC_NAME  = () => EN()?'Meeting day':'วันประชุม';
  const BC_SHORT = () => EN()?'Meeting':'ประชุม';
  /* A holiday can be HALF a day: "19/08 08:00–12:30". These two put it in words in the one place
   * every calendar and list reads, so a half-day never prints as if the school were shut all day.
   * Blank (or an unreadable cell) means the whole day — the way every holiday behaved before. */
  const holWindow = h => { const ok=v=>/^\d{2}:\d{2}$/.test(v)?v:'';
    const S=ok(String((h&&h.StartTime)||'').slice(0,5)), E=ok(String((h&&h.EndTime)||'').slice(0,5));
    return (S||E) ? `${S||'00:00'}-${E||'23:59'}` : ''; };
  const holLabel = h => { const nm=EN()?(h.NameEN||h.NameTH):(h.NameTH||h.NameEN); const w=holWindow(h);
    return w ? `${nm} ${w}` : nm; };
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
  /**
   * A slip photo, sized so it still POSTs. Photo FIELDS have been compressed for a long time, but the
   * three slip-upload paths read the raw file — and a phone camera slip is 2–6 MB, which base64
   * inflates by a third. Google rejects a POST that large before the script even runs, answering with
   * an HTML page, and the parent saw 'Unexpected token "<"' with no idea what went wrong.
   * 1400px keeps the reference number and the amount legible for SlipOK and for the admin's eyes.
   * A PDF (or anything not an image) is passed through untouched.
   */
  async function slipDataUrl(f){
    if (f && /^image\//.test(f.type)) { const small = await compressImage(f, 1400, 0.85); if (small) return small; }
    return await new Promise(r=>{ const fr=new FileReader(); fr.onload=()=>r(fr.result); fr.readAsDataURL(f); });
  }
  // HTML for a photo field: file input + status line + preview thumb. The compressed dataURL is stashed
  // on the input's dataset by PHOTO_pick, so save handlers read photoVal() (no second, uncompressed read).
  const photoField = (id,label,cur,round)=>`<label class="field"><span>${esc(label)}</span>
    <input id="${id}" type="file" accept="image/*" onchange="PHOTO_pick(this)"/>
    <span id="${id}_st" class="muted" style="font-size:13px"></span>
    <div id="${id}_pv" style="margin-top:6px">${cur?`<img src="${esc(cur)}" onclick="IMG_zoom('${esc(cur)}')" style="width:${round?'56px':'120px'};height:${round?'56px':'auto'};border-radius:${round?'50%':'8px'};object-fit:cover;cursor:zoom-in"/>`:''}</div></label>`;
  window.PHOTO_pick = async (inp)=>{ const f=inp.files&&inp.files[0]; const st=document.getElementById(inp.id+'_st'), pv=document.getElementById(inp.id+'_pv');
    if(!f){ return; } if(st){ st.textContent='⏳ '+(EN()?'Processing image…':'กำลังประมวลผลรูป…'); st.style.color='var(--warn)'; }
    const url=await compressImage(f); inp.dataset.url=url||'';
    if(st){ st.textContent = url?('✅ '+(EN()?'Ready':'พร้อมแล้ว')):('⚠️ '+(EN()?'Not an image':'ไม่ใช่ไฟล์รูป')); st.style.color=url?'var(--ok)':'var(--bad)'; }
    if(pv&&url) pv.innerHTML=`<img src="${url}" onclick="IMG_zoom('${url}')" style="width:120px;border-radius:8px;object-fit:cover;cursor:zoom-in"/>`; };
  // read a picked+compressed photo from a form; returns '' if none picked (caller keeps the old value)
  const photoVal = (scope,id)=>{ const el=(scope||document).querySelector('#'+id); return el&&el.dataset&&el.dataset.url?el.dataset.url:''; };
  // age as "X ปี Y เดือน" / "X y Y m" from a DOB
  function ageYM(dob){ const m=window.AGEMONTHS?AGEMONTHS(dob):0; return ageYMfromMonths(m); }
  function ageYMfromMonths(m){ m=Math.max(0,Math.round(m)); const y=Math.floor(m/12), mo=m%12;
    return EN()? `${y}y ${mo}m` : `${y} ปี ${mo} เดือน`; }
  // DSPM_CRITERIA only stores AgeLabelTH (there is no EN column, and adding one would mean a schema
  // change plus data entry for every band), so swap the two units instead. The runtime translator
  // used to convert เดือน but not ปี, which is what produced "1 ปี 1 mo".
  const ageBandLabel = s => EN() ? String(s==null?'':s).replace(/เดือน/g,'mo').replace(/ปี/g,'y') : String(s==null?'':s);
  window.GROWTH_PT = lbl => toast(lbl);
  // staff tenure (years/months since StartDate)
  function tenure(startDate){ if(!startDate) return '-'; const d=new Date(startDate),n=new Date();
    let m=(n.getFullYear()-d.getFullYear())*12+(n.getMonth()-d.getMonth()); if(n.getDate()<d.getDate())m--; m=Math.max(0,m);
    return ageYMfromMonths(m); }
  /**
   * A leaving date that has been agreed but not arrived, shown under the start date.
   *
   * ADMIN ONLY, on purpose. This is on the admin roster and nowhere else: the teacher's own profile
   * reads staffSelf, whose whitelist does not include EndDate, so nobody learns their last day from
   * the app — the school tells them. Somebody still on the roster for another three weeks must not
   * open the app one morning and find out that way.
   */
  function endNote(s){
    const d=String((s&&s.EndDate)||'').slice(0,10); if(!d) return '';
    const why=[s.EndReason, s.EndRemark].filter(Boolean).join(' · ');
    return `<br><small style="color:var(--warn)">🚪 ${EN()?'Last working day':'วันสิ้นสุดการทำงาน'} ${esc(d)}${why?' · '+esc(why):''}</small>`;
  }
  // MOCK.config.Plans holds only SEED plans in gas mode, so a live id like "p_6900" isn't found →
  // format it as "Plan 6900" instead of showing the raw id.
  // Look in the LIVE plans first (A_CACHE.plans, loaded from getPlans) and only then the seed. Live
  // ids look like "pkg_e32dd4" — no digits to fall back on — so reading the seed alone printed the
  // raw id on screen. Last resort is "-": an internal id tells a parent or an admin nothing.
  const planLabel = id => { if(!id) return '-';
    const list=(window.A_plans?A_plans():null)||(MOCK.config.Plans||[]);
    const p=list.find(x=>x.id===id)||(MOCK.config.Plans||[]).find(x=>x.id===id);
    if(p) return (EN()?(p.labelEN||p.labelTH):(p.labelTH||p.labelEN))||'-';
    const m=String(id).match(/(\d{3,})/); return m?('Plan '+m[1]):'-'; };
  const groupsSrc = () => (window.A_CACHE&&A_CACHE.groups&&A_CACHE.groups.length?A_CACHE.groups:MOCK.staffGroups)||[];
  const groupLabel = name => { const g=groupsSrc().find(x=>x.GroupName===name); return g?(EN()?g.GroupNameEN:g.GroupName):(name||''); };
  const groupHours = name => { const g=groupsSrc().find(x=>x.GroupName===name); return g&&(g.CheckInTime||g.CheckOutTime)?`${g.CheckInTime||'--'}–${g.CheckOutTime||'--'}`:''; };
  // scope for parent data calls (uid → links for isolation; parentId as fallback)
  const parentScope = () => ({ parentId:USER&&USER.parentId, uid:USER&&USER.uid });
  // translate a stored status (leave code / payment / dspm result) for display
  const STAT = { PENDING_LEADER:'s.pending_leader', PENDING_ADMIN:'s.pending_admin', APPROVED:'s.approved', REJECTED:'s.rejected', PAID:'s.paid', UNPAID:'s.unpaid', PENDING_VERIFY:'s.verify', 'ผ่าน':'s.pass','ไม่ผ่าน':'s.fail','ยังไม่ได้รับการทดสอบ':'s.nottested','ยังไม่เข้าโรงเรียน':'s.notenrolled' };
  const tStat = s => STAT[s] ? t(STAT[s]) : s;
  const MONEY_TR = { 'ค่าเทอม':'Tuition', 'ค่าอาหาร':'Meals', 'ค่ากิจกรรม':'Activities' };
  const trItem = s => EN() && MONEY_TR[s] ? MONEY_TR[s] : s;
  // Rows written while the app was in English hold an English type ("Sick Leave"), because the old
  // dropdown had no value attribute and the runtime translator rewrote the option text. Map those
  // back to the Thai name first, so an already-saved row still renders in the reader's language
  // instead of showing English to a Thai user. The server normalises too (leaveTypeTH_ in Leave.gs).
  const LEAVE_TH = { 'sick leave':'ลาป่วย','sick':'ลาป่วย','leave of absence':'ลากิจ','personal leave':'ลากิจ',
    'personal':'ลากิจ','holiday leave':'ลาพักร้อน','vacation':'ลาพักร้อน','annual leave':'ลาพักร้อน','absent':'ขาด' };
  const leaveTypeTH = s => LEAVE_TH[String(s||'').trim().toLowerCase()] || s;
  const tLeaveType = s0 => { const s=leaveTypeTH(s0);
    const k={ 'ลาป่วย':'leaveType.sick','ลากิจ':'leaveType.personal','ลาพักร้อน':'leaveType.vacation' }[s];
    return k ? t(k) : s; };
  // ms: errors stay long enough to read a two-line hint. raw: skip the EN phrase dictionary for text
  // that is already in the right language (see err()).
  let toastT; function toast(m,ms,raw){ if(!raw && window.trPhrase) m=trPhrase(m); let t=$('.toast'); if(!t){t=document.createElement('div');t.className='toast';document.body.appendChild(t);} t.textContent=m; t.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'), ms||2400); }
  // runtime translator hook: auto-translate any remaining Thai in #app when EN
  let _mo=null,_translating=false;
  // English mode sweeps #app for any Thai the i18n keys didn't cover. It used to re-sweep the WHOLE
  // subtree on every single mutation — a screen render fired it 3-8 times (5-8ms measured on a
  // desktop, several times that on the phones the parents actually use). One render produces a burst
  // of mutations but only needs one sweep, so they are now collapsed into a single pass per frame.
  // characterData is dropped too: editing existing text never introduces new Thai to translate.
  let _trQueued=false;
  function ensureTranslateObserver(){ if(_mo||!window.translateTree)return;
    const run=()=>{ _trQueued=false; if(LANG()!=='en')return;
      _translating=true; try{translateTree(app);}finally{_translating=false;} };
    // setTimeout, NOT requestAnimationFrame: rAF is suspended while the tab is hidden or not
    // compositing, so a screen rendered in the background would never get translated at all.
    _mo=new MutationObserver(()=>{ if(_translating||LANG()!=='en'||_trQueued)return;
      _trQueued=true; setTimeout(run,0); });
    _mo.observe(app,{childList:true,subtree:true}); }
  function applyLangNow(){ if(window.translateTree&&LANG()==='en'){ _translating=true; try{translateTree(app);}finally{_translating=false;} } }
  // ---- error messages people can act on ---------------------------------------------------------
  // The server already sends a readable Thai sentence for every fail(), but it is Thai-only (and the
  // EN phrase dictionary mangles it), and it never says what to do next. Codes listed here win and
  // add a "what now" line; anything unlisted still falls back to the server's own wording.
  const ERR_MSG = {
    NOT_CHECKED_IN:   ['ยังไม่ได้เช็คอินนักเรียนคนนี้วันนี้','This child has not been checked in today',
                       'เช็คอินให้นักเรียนก่อน แล้วจึงบันทึกสมุดอีกครั้ง','Check the child in first, then save the journal again'],
    // OUT_OF_RANGE is deliberately NOT here — it is handled in err() so the server's sentence, which
    // carries the real distance and the limit, survives instead of being replaced by a generic one.
    AMOUNT_MISMATCH:  ['ยอดเงินในสลิปไม่ตรงกับยอดที่ต้องชำระ','The slip amount does not match the amount due',
                       'ตรวจยอดในสลิปอีกครั้ง หรือแนบสลิปให้ครบทุกใบ','Re-check the slip, or attach every slip that makes up the total'],
    NO_PLAN_PRICE:    ['นักเรียนคนนี้ยังไม่ได้ตั้งราคาแพ็กเกจรายเดือน','This child has no monthly package price set',
                       'ติดต่อแอดมินให้ตั้งค่าแพ็กเกจก่อนชำระล่วงหน้า','Ask the admin to set the package before paying in advance'],
    ALREADY_PAID:     ['รายการนี้ชำระเรียบร้อยแล้ว','This item has already been paid',
                       'ไม่ต้องดำเนินการซ้ำ หากยอดไม่ถูกต้องกรุณาแจ้งแอดมิน','Nothing more to do — tell the admin if the amount looks wrong'],
    ALREADY_REGISTERED:['ข้อมูลนี้มีอยู่ในระบบแล้ว','This record already exists',
                       'ลองค้นหาด้วยชื่อหรือเลขบัตรก่อนเพิ่มใหม่','Search by name or ID before adding a new one'],
    JOURNAL_LOCKED:   ['สมุดรายงานวันนี้ถูกส่งแล้ว แก้ไขไม่ได้','Today’s report has been sent and is locked',
                       'ติดต่อแอดมินเพื่อปลดล็อกหากต้องแก้ไข','Ask the admin to unlock it if it needs changing'],
    NO_PERMISSION:    ['บัญชีนี้ไม่มีสิทธิ์ใช้งานส่วนนี้','Your account cannot use this section',
                       'ติดต่อแอดมินหากคิดว่าควรมีสิทธิ์','Contact the admin if you think you should have access'],
    NOT_FOUND:        ['ไม่พบข้อมูลที่ต้องการ','The record could not be found',
                       'ข้อมูลอาจถูกลบหรือย้ายไปแล้ว — ลองรีเฟรชหน้านี้','It may have been removed — try refreshing this screen'],
    BAD_PW:           ['รหัสผ่านไม่ถูกต้อง','Wrong password','',''],
    WEAK_PW:          ['รหัสผ่านสั้นหรือคาดเดาง่ายเกินไป','That password is too short or too easy to guess',
                       'ใช้อย่างน้อย 6 ตัว ผสมตัวเลขและตัวอักษร','Use at least 6 characters, mixing letters and numbers'],
    DUP:              ['มีรายการซ้ำอยู่แล้ว','A duplicate already exists','',''],
    VERIFY_FAILED:    ['ข้อมูลยืนยันไม่ตรงกับที่โรงเรียนมี','The details do not match the school’s records',
                       'ลองใช้เบอร์โทรที่แจ้งไว้กับโรงเรียน หรือเลขบัตรของผู้ปกครอง — หากยังไม่ได้ กรุณาติดต่อแอดมิน','Try the phone number you gave the school, or the parent’s National ID — otherwise contact the admin'],
    NO_RECORD:        ['ยังไม่มีข้อมูลผู้ปกครองของนักเรียนคนนี้','The school has no parent record for this child',
                       'เลือก "ลงทะเบียนใหม่" เพื่อกรอกข้อมูลของท่าน','Choose “Register” to enter your details'],
    ALREADY_CLAIMED:  ['ข้อมูลนี้ผูกกับบัญชี LINE อื่นแล้ว','This record is already linked to another LINE account',
                       'ติดต่อแอดมินเพื่อตรวจสอบ','Contact the admin to check it'],
    TOO_MANY_TRIES:   ['ยืนยันไม่สำเร็จหลายครั้ง','Too many failed attempts',
                       'กรุณารอ 15 นาทีแล้วลองใหม่ หรือติดต่อแอดมิน','Wait 15 minutes and try again, or contact the admin'],
  };
  function err(e){
    const code=String((e&&e.code)||'');
    const raw=String((e&&e.message)||e||'');
    const offline=(typeof navigator!=='undefined' && navigator.onLine===false) ||
      /failed to fetch|networkerror|load failed|network request failed/i.test(raw);
    let head, hint='';
    if(offline){
      head=EN()?'No connection to the school system':'เชื่อมต่อระบบของโรงเรียนไม่ได้';
      hint=EN()?'Check your internet and try again — nothing has been saved.':'ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ — ยังไม่มีการบันทึกข้อมูล';
    } else if(code==='OUT_OF_RANGE'){
      // KEEP the server's sentence here: it carries the actual distance and the limit. "You are
      // outside the school area" alone tells nobody whether to walk twenty steps or whether the
      // fence is set wrong — and it is the number the school needs when a parent reports it.
      head = raw;
      // the manual time request is a STAFF tool; telling a parent to use it sends them nowhere
      hint = (USER&&USER.role==='Parent')
        ? (EN()?'Stand near the school entrance and try again. If it still refuses, tell the teacher the distance shown above.'
               :'ลองยืนใกล้ประตูโรงเรียนแล้วกดใหม่ · ถ้ายังไม่ผ่าน แจ้งคุณครูพร้อมบอกระยะที่ขึ้นด้านบน')
        : (EN()?'Move inside the school grounds, or use the manual time request'
               :'เข้ามาในบริเวณโรงเรียนแล้วลงเวลาอีกครั้ง หรือใช้ "ขอลงเวลา"');
      // record HOW FAR the refusals actually are — metres only, no coordinates. Without this the
      // next speed report can only say "14% refused", never whether the fence is too tight.
      try{ window.__atomPerfErr&&window.__atomPerfErr('outOfRange', raw); }catch(_){}
    } else {
      const m=ERR_MSG[code];
      head = m ? (EN()?m[1]:m[0]) : raw;      // unlisted code → the server's own sentence
      hint = m ? (EN()?m[3]:m[2]) : '';
    }
    // raw=true: already in the right language, so keep the phrase dictionary away from it
    toast('⚠️ '+head+(hint?'\n'+hint:''), hint?5200:3600, true);
  }
  // Modals carry most of this app's data entry, so they need to behave like real dialogs: announced
  // as one, closable with Esc, and keyboard focus kept inside instead of wandering onto the page
  // behind them. Closing hands focus back to whatever opened the modal.
  const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function modal(html){
    const opener=document.activeElement;
    const m=document.createElement('div'); m.className='modal';
    m.innerHTML=`<div class="sheet" role="dialog" aria-modal="true" tabindex="-1">${html}</div>`;
    m.onclick=e=>{ if(e.target===m)m.remove(); };
    const onKey=e=>{
      if(e.key==='Escape'){ e.preventDefault(); m.remove(); return; }
      if(e.key!=='Tab') return;
      const f=[...m.querySelectorAll(FOCUSABLE)].filter(el=>el.offsetParent!==null);
      if(!f.length) return;
      const first=f[0], last=f[f.length-1];
      if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown',onKey);
    // one instance-level override so EVERY existing `.remove()` call site cleans up and restores focus
    const rm=Element.prototype.remove.bind(m);
    m.remove=()=>{ document.removeEventListener('keydown',onKey); rm();
      if(opener&&opener.focus) try{ opener.focus(); }catch(e){} };
    document.body.appendChild(m);
    // focus the sheet itself rather than the first field — focusing an input would throw the
    // on-screen keyboard up over the dialog on a phone.
    const sheet=m.querySelector('.sheet'); if(sheet) try{ sheet.focus({preventScroll:true}); }catch(e){}
    if(window.translateTree) translateTree(m); return m; }

  let USER = null;

  let CURRENT = 'home';
  const ROLE_KEY = r => ({Parent:'role.Parent',Teacher:'role.Teacher',Admin:'role.Admin',Observer:'role.Observer'}[r]||r);
  function setHeader(){
    // version is shown only at the bottom of the Chat screen now (see verTag / APP_VERSION)
    $('#langBtn').textContent = LANG()==='en' ? 'EN' : 'TH';
    // follow the chosen language — otherwise the Thai UI showed "Beam's mom" instead of "คุณแม่น้องบีม"
    $('#userName').textContent = USER ? (EN() ? USER.nameEN : (USER.nameTH || USER.nameEN)) : '–';
    $('#userRole').textContent = USER ? t(ROLE_KEY(USER.role)) : '';
    // show the signed-in user's LINE profile picture in the header; fall back to their initial
    const av=$('#avatar'), pic=USER&&USER.pictureUrl;
    av.textContent = pic ? '' : (USER ? initialEN(USER.nameEN) : '–');
    av.style.backgroundImage = pic ? `url('${pic}')` : '';
    av.classList.toggle('photo', !!pic);
    $('#logoutBtn').hidden = !USER; $('#logoutBtn').textContent = t('c.logout');
    $('#bellBtn').hidden = !USER;
    // search lives in the header for admins so it is reachable from every screen, not just Manage
    const sb=$('#searchBtn'); if(sb) sb.hidden = !(USER && USER.role==='Admin');
    // Say it once, at the top, rather than letting someone discover it by pressing a button that
    // refuses. Reuses the "viewing as" bar so there is one strip in one place, never two.
    if (USER && USER.role === 'Observer') {
      let b=document.getElementById('viewAsBar');
      if(!b){ b=document.createElement('div'); b.id='viewAsBar'; document.body.appendChild(b); }
      const hd=document.querySelector('.topbar');
      b.style.top=((hd?hd.getBoundingClientRect().height:56))+'px';
      document.body.classList.add('viewas');
      b.innerHTML=`<span>👁️ ${EN()?'View only — you can open anything, but not change it':'ดูอย่างเดียว — เปิดดูได้ทุกอย่าง แต่แก้ไขไม่ได้'}</span>`;
    }
    if(USER) refreshBell();
  }
  // staffId matters now: teachers have their own inbox rows (a parent's journal comment lands there)
  function notifParams(){ return {role:USER.role, parentId:USER.parentId, staffId:USER.staffId}; }
  async function refreshBell(){ try{ const ns=await api('notifications',notifParams()); const n=ns.filter(x=>!x.read).length; const b=$('#bellBadge'); b.hidden=!n; b.textContent=n; }catch(e){} }
  // Notifications drop down FROM the bell (like Google's app grid) instead of taking over the screen
  // with a modal. Same behaviour otherwise: tap an item to go to it, and one button to mark all read.
  window.NOTIF_CLOSE = () => { const d=document.getElementById('notifMenu'); if(d) d.remove();
    document.removeEventListener('click', _notifAway, true); };
  function _notifAway(ev){ const d=document.getElementById('notifMenu'); if(!d) return;
    if(d.contains(ev.target)) return;
    const b=document.getElementById('bellBtn'); if(b&&b.contains(ev.target)) return;   // the bell toggles it
    NOTIF_CLOSE(); }
  window.BELL = async () => {
    if(document.getElementById('notifMenu')){ NOTIF_CLOSE(); return; }                 // tapping again closes
    const ns=await api('notifications',notifParams()); window._NOTIFS=ns;
    const d=document.createElement('div'); d.id='notifMenu'; d.setAttribute('role','menu');
    d.innerHTML=`<div class="nm-head"><b>🔔 ${esc(t('c.notifications'))}</b><button class="btn-ghost" onclick="NOTIF_CLOSE()" aria-label="${EN()?'Close':'ปิด'}">✕</button></div>
      <div class="nm-list">${ns.map((n,i)=>{ const go=notifTarget(n);
        return `<div class="nm-item${n.read?'':' unread'}" ${go?`role="menuitem" tabindex="0" onclick="NOTIF_TAP(${i})"`:''}>
          <span>${n.read?'':'🔵 '}${esc(EN()&&n.textEN?n.textEN:n.text)}</span>
          <small class="muted">${esc(n.time)}${go?' ›':''}</small></div>`; }).join('')
        ||`<div class="nm-item"><span class="muted">${EN()?'Nothing new':'ไม่มีรายการใหม่'}</span></div>`}</div>
      <button class="btn sm outline block" style="margin:8px" onclick="MARKREAD(this)">${esc(t('c.markread'))}</button>`;
    document.body.appendChild(d);
    // sit under the bell, clamped inside the viewport on a narrow phone
    const b=document.getElementById('bellBtn'); const r=b?b.getBoundingClientRect():{bottom:56,right:window.innerWidth-8};
    const w=Math.min(340, window.innerWidth-16);
    d.style.width=w+'px';
    d.style.top=(r.bottom+6)+'px';
    d.style.left=Math.max(8, Math.min(window.innerWidth-w-8, r.right-w))+'px';
    setTimeout(()=>document.addEventListener('click', _notifAway, true), 0);
  };

  // decide which screen a notification opens (by inbox category, falling back to keywords), role-aware
  function notifTarget(n){ const cat=String(n&&n.category||''); const s=String((n&&(n.text||n.textEN))||''); const role=USER&&USER.role;
    // exact deep-link when the notification carries a ref "kind|studentId|date"
    const ref=String(n&&n.ref||''); if(ref){ const pp=ref.split('|'); const rk=pp[0], sid=pp[1], date=pp[2]||todayStr();
      if(rk==='journal'&&sid){ if(role==='Admin') return ()=>A_viewJournal(sid,date);
        if(role==='Parent') return ()=>{ if(window.P_showJ)P_showJ(sid,date); else GO('journal'); };
        // staff: show the report that was sent (the viewer offers an edit button when it is today)
        return ()=>{ if(window.A_viewJournal) A_viewJournal(sid,date); else if(window.T_journal) T_journal(sid); else GO('class'); }; }
      // an emergency carries the report id, so the notification opens the report the teacher filed
      // rather than dropping the admin on the dashboard with nothing to read
      if(rk==='injury'&&sid) return ()=>{ if(window.A_viewInjury) A_viewInjury(sid); else GO('home'); }; }
    const has=re=>re.test(s);
    let key = cat==='comment'?'journal':cat==='leave'?'leave':cat==='ot'?'ot':cat==='registration'?'register':cat==='emergency'?'injury':cat==='payment'?'verify':cat==='digest'?'home':'';
    if(!key){ if(has(/ความคิดเห็น|คอมเมนต์|comment|ตอบกลับ|reply|บันทึกของ|รายงาน/i))key='journal';
      else if(has(/แจ้งลา|ลาป่วย|ลากิจ|พักร้อน|\bลา\b|leave/i))key='leave';
      else if(has(/OT|โอที|รับช้า|ล่วงเวลา/i))key='ot';
      else if(has(/ลงทะเบียน|สมัคร|register|ผู้ปกครองใหม่|นักเรียนใหม่/i))key='register';
      else if(has(/ชำระ|โอนเงิน|สลิป|slip|บิล|payment/i))key='verify';
      else if(has(/สรุปประจำวัน|digest/i))key='home'; }
    if(!key) return null;
    // map the logical key to the actual screen for this role
    const M={ Admin:{journal:()=>A_journals&&A_journals(), leave:()=>GO('leaves'), ot:()=>GO('manage'), register:()=>GO('manage'), verify:()=>GO('verify'), injury:()=>GO('injuries'), home:()=>GO('home')},
      Teacher:{journal:()=>GO('class'), leave:()=>GO('leave'), ot:()=>GO('slip'), register:null, verify:null, injury:()=>GO('injury'), home:()=>GO('home')},
      Parent:{journal:()=>GO('journal'), leave:()=>GO('home'), ot:()=>GO('payment'), register:null, verify:()=>GO('payment'), injury:()=>GO('home'), home:()=>GO('home')} };
    const fn=(M[role]||{})[key]; return fn||null; }
  window.NOTIF_TAP = (i)=>{ const n=(window._NOTIFS||[])[i]; if(!n)return; const go=notifTarget(n);
    NOTIF_CLOSE(); const m=document.querySelector('.modal'); if(m)m.remove();
    if(go){ try{ go(); }catch(e){} } };
  window.MARKREAD = async (btn)=>{ await api('markNotifsRead',notifParams());
    NOTIF_CLOSE(); const m=btn.closest('.modal'); if(m)m.remove(); refreshBell(); };
  // remembers which pre-login screen we're on, so the language toggle re-renders THAT screen
  let AUTH_RENDER = null;
  window.TOGGLE_LANG = () => { setLang(LANG()==='en'?'th':'en');
    // the cached rosters are ordered by the name being SHOWN, which just changed
    try { window.__atomResort && __atomResort(); } catch(e) {}
    setHeader(); paintThemeBtn(); if(USER) GO(CURRENT); else (AUTH_RENDER||loginScreen)(); ensureTranslateObserver(); applyLangNow(); };
  // ---- light / dark (Phase 6 #15) -----------------------------------------------------------------
  // With no stored choice the app follows the phone's own setting, which is what most people expect and
  // means nothing has to be tapped. Tapping picks the opposite of what is on screen right now and
  // remembers it; the icon shows what you will GET, not what you have. Only the palette changes — no
  // layout, and print/export documents stay light because they are laid out for paper.
  const _prefersDark = () => { try{ return window.matchMedia('(prefers-color-scheme: dark)').matches; }catch(e){ return false; } };
  const _isDark = () => { const a=document.documentElement.getAttribute('data-theme'); return a?a==='dark':_prefersDark(); };
  function paintThemeBtn(){ const b=document.getElementById('themeBtn'); if(!b) return;
    const dark=_isDark();
    if(window.svgIcon) b.innerHTML=svgIcon(dark?'sun':'moon',20);
    b.setAttribute('aria-label', dark ? (EN()?'Switch to light mode':'สลับเป็นโหมดสว่าง') : (EN()?'Switch to dark mode':'สลับเป็นโหมดมืด'));
    const m=document.querySelector('meta[name=theme-color]'); if(m) m.setAttribute('content', dark?'#1b2027':'#1565C0'); }
  window.TOGGLE_THEME = () => { const next=_isDark()?'light':'dark';
    document.documentElement.setAttribute('data-theme', next);
    try{ localStorage.setItem('atom_theme', next); }catch(e){}
    paintThemeBtn(); };
  setTimeout(paintThemeBtn,0);   // svgIcon is defined further down this file
  window.addEventListener('DOMContentLoaded', paintThemeBtn);
  try{ window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ()=>{ if(!localStorage.getItem('atom_theme')) paintThemeBtn(); }); }catch(e){}

  // tapping the left logo goes Home; tapping the right name/avatar → parent profile (else Home)
  window.HOME_TAP = () => { if(USER) GO('home'); };
  // tapping the name/avatar opens THIS account's own profile (parent or staff/admin)
  window.NAME_TAP = () => { if(!USER) return;
    if(USER.role==='Parent'){ if(typeof P_profile==='function') P_profile(); return; }
    if(USER.staffId && typeof T_profile==='function'){ T_profile(); return; }
    GO('home'); };


  // ---- icon set (Phase 6 #14) ---------------------------------------------------------------------
  // The navigation and header used emoji, which every platform draws differently — Android, iOS and
  // Windows each ship their own artwork, sizes wander, and a few (🗂️ 🚑) are barely legible at 22px.
  // These are stroke icons on a 24x24 grid using currentColor, so they inherit the tab's colour and
  // follow light/dark for free. Content emoji are deliberately left alone: they carry meaning in the
  // journal, announcements and money screens, and parents like them.
  const ICON = {
    home:'M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6',
    pin:'M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    card:'M3 7.5h18v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-10z M3 11h18 M6.5 15.5h4',
    book:'M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z M17 7h2v13H8 M8 8.5h6 M8 12h6',
    chart:'M4 19V5 M4 19h16 M7.5 15.5l3.5-4 3 2.5 4.5-6',
    clipboard:'M9 4.5h6v2H9z M7 5.5H6a1 1 0 0 0-1 1V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-1 M8.5 11h7 M8.5 14.5h4.5',
    chat:'M20 12a7.5 7.5 0 0 1-11 6.6L5 20l1.2-3.4A7.5 7.5 0 1 1 20 12z',
    kids:'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3.5 20v-1.5A4.5 4.5 0 0 1 8 14h2a4.5 4.5 0 0 1 4.5 4.5V20 M16.5 6.2a2.8 2.8 0 0 1 0 5.6 M17 14.2a4 4 0 0 1 3.5 4V20',
    aid:'M4 8.5A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.5v7A2.5 2.5 0 0 1 17.5 18h-11A2.5 2.5 0 0 1 4 15.5v-7z M12 9v6 M9 12h6',
    inbox:'M4 13.5 6.5 6h11L20 13.5V18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4.5z M4 13.5h4l1 2h6l1-2h4',
    calendar:'M4 7.5h16V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7.5z M4 11h16 M8 4.5v4 M16 4.5v4',
    cash:'M3 7.5h18v9H3z M12 15a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M6 10.5v3 M18 10.5v3',
    check:'M20 7 10 18l-5-5',
    money:'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z M14.5 9.2A2.6 2.6 0 0 0 12 7.8c-1.4 0-2.5.9-2.5 2s1.1 2 2.5 2 2.5.9 2.5 2-1.1 2-2.5 2a2.6 2.6 0 0 1-2.5-1.4 M12 6v12',
    folders:'M3 8V6a1 1 0 0 1 1-1h4l1.5 2H14a1 1 0 0 1 1 1v1 M3 9.5h16.5a1 1 0 0 1 1 1L20 18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z',
    bell:'M18 15.5V11a6 6 0 1 0-12 0v4.5L4.5 18h15L18 15.5z M10 20.5a2.2 2.2 0 0 0 4 0',
    search:'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z M15.2 15.2 20 20',
    moon:'M20 14.5A8 8 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z',
    sun:'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z M12 2.5v2 M12 19.5v2 M2.5 12h2 M19.5 12h2 M5.3 5.3l1.4 1.4 M17.3 17.3l1.4 1.4 M18.7 5.3l-1.4 1.4 M6.7 17.3l-1.4 1.4',
  };
  // `<svg>` with no width/height would collapse before CSS lands, so both are set inline
  window.svgIcon = (name, size) => { const d=ICON[name]; if(!d) return '';
    const paths=d.split(' M').map((p,i)=>`<path d="${i?'M'+p:p}"/>`).join('');
    return `<svg class="i" width="${size||22}" height="${size||22}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`; };

  const NAVS = {
    Parent:[['home','home','nav.home'],['checkin','pin','nav.checkin'],['payment','card','nav.payment'],['journal','book','nav.journal'],['growth','chart','nav.growth'],['dspm','clipboard','nav.dspm'],['chat','chat','nav.chat']],
    Teacher:[['home','home','nav.home'],['class','kids','nav.class'],['injury','aid','inj.nav'],['leave','inbox','nav.leave'],['schedule','calendar','nav.schedule'],['slip','cash','nav.slip']],
    Admin:[['home','chart','nav.home'],['leaves','check','nav.leaves'],['finance','money','nav.finance'],['dspm','clipboard','nav.analytics'],['manage','folders','nav.manage'],['chat','chat','nav.chat']],
    // Observer sees the four whole-school screens an Admin does. "จัดการ" is absent because every
    // one of its tools exists to change something, and offering them would only produce refusals.
    Observer:[['home','chart','nav.home'],['leaves','check','nav.leaves'],['finance','money','nav.finance'],['dspm','clipboard','nav.analytics']],
  };
  function setNav(active){ if(!USER){nav.hidden=true;return;} nav.hidden=false;
    // aria-current marks the open tab for screen readers; the emoji is decorative next to the label
    nav.innerHTML = NAVS[USER.role].map(([k,ic,l])=>`<button class="${k===active?'active':''}"${k===active?' aria-current="page"':''} onclick="GO('${k}')"><span class="ic">${svgIcon(ic)}</span>${esc(t(l))}</button>`).join(''); }

  // header quick-actions slot (before the language toggle); each screen fills it or it clears on nav
  window.setTopActions = html => { const el=document.getElementById('topActions'); if(el) el.innerHTML=html||''; };

  // ---- Back-button support ---------------------------------------------------------------------
  // Without this the Android hardware Back button LEAVES the app, losing whatever the user was in
  // the middle of. Every real navigation now pushes a history entry, so Back walks the tabs instead.
  // Two deliberate rules:
  //   - a silent SWR re-render (__atomRevalidate) must NOT push, or Back would replay the same screen
  //   - if a modal is open, Back CLOSES it and re-pushes the entry it consumed, so the user stays put.
  //     Most data entry in this app happens in modals (แจ้งลา / แนบสลิป / เพิ่มประกาศ), which is
  //     exactly where an accidental app exit hurt most.
  // Full-screen sub-views opened directly (P_profile, T_journal, A_studentForm, …) still don't push;
  // Back from those behaves as it always did.
  function histPush(screen, fromPop){
    if(fromPop || !USER) return;
    const st=history.state;
    if(st && st.atom && st.screen===screen) return;      // same screen again → don't stack duplicates
    try{ history.pushState({atom:1,screen:screen},'','#'+screen); }catch(e){}
  }
  // Leaving a half-filled form used to throw the work away silently: Back stopped exiting the app in
  // v127, but the teacher who reported it still lost a whole daily journal. Ask first. Answering "no"
  // returns without touching the DOM, so every tick is still exactly where it was — and after a Back
  // we re-push the entry we just consumed so the history stack stays honest.
  function leaveOk(opts){
    if(!FORM_DIRTY || !CUR_SUB) return true;
    const msg = EN() ? 'You have unsaved changes. Leave now and lose them?\n\nPress Cancel to go back and save first.'
                     : 'ยังไม่ได้บันทึก — ถ้าออกตอนนี้ ข้อมูลที่กรอกไว้จะหายทั้งหมด\n\nกด "ยกเลิก" เพื่อกลับไปบันทึกก่อน';
    if(confirm(msg)) return true;
    if(opts && opts.fromPop && CURRENT) try{ history.pushState({atom:1,screen:CURRENT,sub:CUR_SUB},'','#'+CURRENT); }catch(e){}
    return false;
  }
  // the screen to open at login: honour a #hash deep link, but only if that screen exists for this role
  function initialScreen(){
    const want=String(location.hash||'').replace(/^#/,'');
    return (want && SCREENS[USER.role] && SCREENS[USER.role][want]) ? want : 'home';
  }
  window.addEventListener('popstate', ev => {
    const m=document.querySelector('.modal');
    if(m){ m.remove(); if(USER&&CURRENT) try{ history.pushState({atom:1,screen:CURRENT},'','#'+CURRENT); }catch(e){} return; }
    // signed-out: the only screen worth rescuing is the registration form (a new parent has typed a
    // lot by then). #rPDPA = REG_FORM, #rNameTH = REG_CHILD_FORM.
    if(!USER){ if(document.getElementById('rPDPA')||document.getElementById('rNameTH')){
      if(!leaveOk({fromPop:true})) return; CUR_SUB=null; FORM_DIRTY=false; accountStage(); } return; }
    const s=ev.state && ev.state.atom && ev.state.screen;
    if(s && (SCREENS[USER.role]||{})[s]) GO(s,{fromPop:true});
  });

  // ---- keep the user's place across a REDRAW ------------------------------------------------------
  // Every screen paints by replacing the whole of #app. That is right for a real navigation, but when
  // a save, a delete or a background refresh redraws the screen someone is ALREADY on, they were being
  // thrown back to the top with every collapsible section shut and the search box cleared — the work
  // they were in the middle of. Rather than rewrite rendering to diff (which would touch all ~60
  // screens), snapshot the handful of things that live only in the DOM and put them back afterwards.
  function uiSnap(){
    const secs={};
    document.querySelectorAll('#app .secw').forEach(w=>{ if(!w.id) return;
      const b=w.querySelector('.secbody'); if(b) secs[w.id]=!b.hasAttribute('hidden'); });
    const mg=document.getElementById('mgSearch'), ae=document.activeElement;
    return { y:window.scrollY||window.pageYOffset||0, secs:secs, q:mg?mg.value:'',
             focus:(ae&&ae.id)||'' };
  }
  function uiRestore(sn){
    if(!sn) return;
    Object.keys(sn.secs).forEach(id=>{ if(!sn.secs[id]) return;
      const w=document.getElementById(id); const b=w&&w.querySelector('.secbody'); if(!b) return;
      b.removeAttribute('hidden');
      const c=w.querySelector('.caret'); if(c) c.textContent='▲';
      const tg=w.querySelector('.sectog'); if(tg) tg.setAttribute('aria-expanded','true'); });
    // a live filter decides for itself which sections are open, so it runs after them
    const mg=document.getElementById('mgSearch');
    if(mg && sn.q){ mg.value=sn.q; if(window.A_search) A_search(mg); }
    if(sn.focus){ const el=document.getElementById(sn.focus); if(el&&el.focus) try{ el.focus(); }catch(e){} }
    if(sn.y) window.scrollTo(0,sn.y);
  }
  window.GO = function(screen, opts){
    // every real navigation leaves whatever sub-view was open — check for unsaved work first.
    // Runs before CURRENT is reassigned so leaveOk() can re-push the entry the user came from.
    if(!(opts&&opts.silent)){ if(!leaveOk(opts)) return; CUR_SUB=null; FORM_DIRTY=false; window._ATTA_OPEN=false; }
    // a REDRAW of the screen we're already on (save/delete/refresh) keeps the user's place;
    // a real navigation still starts at the top. Must be read before CURRENT is reassigned.
    const snap = (screen===CURRENT && !(opts&&opts.fromPop)) ? uiSnap() : null;
    if(window.__atomHideRefreshBar) __atomHideRefreshBar();   // a fresh render answers the offer
    CURRENT=screen; setNav(screen); if(!(opts&&opts.silent)) histPush(screen, opts&&opts.fromPop); if(!(opts&&opts.silent)){ setTopActions(''); CAL_OFF=0; window._CALRENDER=null; } const fn=(SCREENS[USER.role]||{})[screen];
    // paint an instant placeholder so a tap feels responsive instead of "stuck" on the old screen
    // while the first (uncached) fetch runs; skip on silent background re-renders to avoid flicker.
    if(fn && !(opts&&opts.silent) && !snap) app.innerHTML=`<div class="card" style="text-align:center;color:var(--ink-3);padding:28px">⏳ ${EN()?'Loading…':'กำลังโหลด…'}</div>`;
    window.__atomScreen=screen;   // Phase 0: tags every API row, so we learn WHICH screen is slow
    // a stopwatch that stops while the app is off screen. "leaves p95=407.2s" was one person opening
    // the screen and putting their phone in their pocket — not a screen that takes seven minutes.
    const _took=(window.__atomAwakeTimer?window.__atomAwakeTimer():(t0=>()=>Date.now()-t0)(Date.now()));
    if(fn){ const r=fn(); // a screen that throws must not leave the loading skeleton stuck forever
      // How long from tap to the screen actually being drawn — the number the user experiences.
      // Measured only for real navigations; a silent background re-render is not something anyone waits for.
      if(!(opts&&opts.silent)){ const done=()=>{ try{ window.__atomPerfMark&&__atomPerfMark('nav',screen,_took()); }catch(e){} };
        if(r&&r.then) r.then(done,done); else done(); }
      if(snap){ if(r&&r.then) r.then(()=>uiRestore(snap),()=>{}); else uiRestore(snap); }
      // only show the error if STILL on this screen — a slow screen the user already left must not
      // clobber the new one (e.g. home's deferred #anns write firing after navigating to leaves).
      // Every "โหลดไม่สำเร็จ" the user has ever seen has been invisible to us. Record it with the
      // screen and the error code — this is the single most direct answer to "มี Error บางครั้งในมือถือ".
      if(r&&r.catch) r.catch(e=>{ try{ window.__atomPerfErr&&__atomPerfErr('screen:'+screen,((e&&e.code)?e.code+' ':'')+((e&&e.message)||e)); }catch(x){} });
      if(r&&r.catch) r.catch(e=>{ if(CURRENT!==screen)return; app.innerHTML=`<div class="card"><b>⚠️ ${EN()?'Could not load':'โหลดไม่สำเร็จ'}</b><br><small class="muted">${esc((e&&e.message)||e)}</small></div><button class="btn outline block" style="margin-top:10px" onclick="GO('${screen}')">🔄 ${EN()?'Retry':'ลองใหม่'}</button>`; });
    } else app.innerHTML=`<div class="card">หน้านี้กำลังพัฒนา</div>`;
    if(!snap) window.scrollTo(0,0); };
  // SWR hook: api.js calls this when a background refresh found newer data than what's shown.
  // Re-render the current screen (silently, no skeleton), but never interrupt an open modal or active typing.
  // Background refresh found newer data. Redrawing the screen underneath someone reading it — or
  // about to tap a button — moves things at the worst possible moment, so offer it instead: a bar
  // slides in and the user decides when. The one exception is a screen with nothing on it yet
  // (first paint still pending), where there is nothing to disturb.
  window.__atomRevalidate = () => {
    if(!USER||!CURRENT) return;
    if(document.querySelector('.modal')) return;
    const ae=document.activeElement; if(ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
    if(FORM_DIRTY) return;                                   // never interrupt half-finished work
    const empty=!app.querySelector('.card, .list-item, .kpigrid');
    if(empty){ GO(CURRENT,{silent:true}); return; }
    showRefreshBar();
  };
  // ---- undo for deletes ---------------------------------------------------------------------
  // Nothing in this app could be taken back. Rather than adding soft-delete to every sheet, the
  // request is simply HELD: the screen updates at once so it feels instant, but nothing is sent
  // until the window closes. "เลิกทำ" means the delete never happened at all — no server round trip,
  // nothing to restore. If the app is closed inside the window the record survives, which is the
  // safe direction to fail in.
  const UNDO_MS=6000;
  let _undo=null;   // {timer, send, label}
  function undoCommit(){ if(!_undo) return; const u=_undo; _undo=null; clearTimeout(u.timer);
    const bar=document.getElementById('undoBar'); if(bar) bar.remove();
    Promise.resolve().then(u.send).catch(e=>err(e)); }
  window.UNDO_cancel=()=>{ if(!_undo) return; const u=_undo; _undo=null; clearTimeout(u.timer);
    const bar=document.getElementById('undoBar'); if(bar) bar.remove();
    if(u.onUndo) try{ u.onUndo(); }catch(e){}
    toast(EN()?'Undone — nothing was deleted':'เลิกทำแล้ว — ยังไม่ได้ลบข้อมูล'); };
  // Take the row out of the list the moment the user confirms, and put it back on undo. The request is
  // HELD for UNDO_MS, so the list used to sit there unchanged for six seconds — long enough that people
  // pressed delete a second time. This is also the cheap half of "render only what changed": one node
  // hidden instead of a whole screen (and 12 refetches) repainted.
  function _rowOf(el){ return (el && el.closest) ? el.closest('.list-item, .card') : null; }
  // send: () => Promise (the actual api call).  after: run straight away to update the screen.
  // row: the element the user tapped (or its row) — hidden now, restored if they undo.
  function deleteWithUndo(label, send, after, onUndo, row){
    if(_undo) undoCommit();                       // only one pending delete at a time
    const node=_rowOf(row), prevDisplay=node?node.style.display:null;
    if(node) node.style.display='none';
    if(after) try{ after(); }catch(e){}
    const undoAll=()=>{ if(node) node.style.display=prevDisplay||''; if(onUndo) onUndo(); };
    _undo={ send, onUndo:undoAll, label, timer:setTimeout(()=>{ undoCommit(); }, UNDO_MS) };
    let bar=document.getElementById('undoBar');
    if(!bar){ bar=document.createElement('div'); bar.id='undoBar'; document.body.appendChild(bar); }
    bar.innerHTML=`<span>🗑️ ${esc(label)}</span><button type="button" onclick="UNDO_cancel()">${EN()?'Undo':'เลิกทำ'}</button>`;
    requestAnimationFrame(()=>bar.classList.add('show'));
  }
  // a pending delete must not be lost silently if the tab goes away — send it
  window.addEventListener('pagehide', ()=>{ if(_undo) undoCommit(); });

  function showRefreshBar(){
    if(document.getElementById('refreshBar')) return;
    const b=document.createElement('button'); b.id='refreshBar'; b.type='button';
    b.innerHTML=`🔄 ${EN()?'New data available — tap to refresh':'มีข้อมูลใหม่ · แตะเพื่อรีเฟรช'}`;
    b.onclick=()=>{ b.remove(); GO(CURRENT,{silent:true}); };
    document.body.appendChild(b);
    requestAnimationFrame(()=>b.classList.add('show'));
  }
  window.__atomHideRefreshBar = () => { const b=document.getElementById('refreshBar'); if(b) b.remove(); };
  // Warm the SWR cache for the other tabs right after login so navigating to them is instant
  // (the home screen loads first; these fire ~0.5s later and micro-batch into one request).
  window.PREFETCH = () => {
    if (CONFIG.MODE!=='gas' || !USER) return;
    const jobs = USER.role==='Parent'
        ? [['parentChildren',parentScope()],['announcements'],['calendar'],['notifications',notifParams()]]
      : USER.role==='Admin'
        ? [['dashboard'],['pendingLeaves',{staffId:USER.staffId}],['pendingPayments'],['listStudents'],['listStaff'],['listParents']]
        : [['classList',{staffId:USER.staffId}],['schedule'],['myLeaves',{staffId:USER.staffId}]];
    // quiet: this runs in the background right after login — it must never raise the overlay
    setTimeout(()=>{ jobs.forEach(j=>{ try{ api(j[0], j[1]||{}, {quiet:true}); }catch(e){} }); }, 500);
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
      ${installButtonsHTML()}</div>`;
  }
  // "ติดตั้ง Android" read like it was about to install Android itself — parents could not tell what
  // this did. Say the action once, in a heading, and label the buttons with the DEVICE instead.
  function installButtonsHTML(){ return `<div class="card instbox">
      <b>📲 ${EN()?'Add the app to your phone':'เพิ่มแอปลงหน้าจอมือถือ'}</b>
      <small class="muted">${EN()?'Puts an "Atom Nursery" icon on your home screen so you can open it straight away, without going through LINE every time.':'จะมีไอคอน "Atom Nursery" อยู่ที่หน้าจอมือถือ กดเปิดได้ทันที ไม่ต้องเข้าผ่าน LINE ทุกครั้ง'}</small>
      <div class="row" style="gap:8px">
        <button class="btn outline" style="flex:1" onclick="DO_INSTALL('android')">🤖 ${EN()?'Android phone':'เครื่อง Android'}</button>
        <button class="btn outline" style="flex:1" onclick="DO_INSTALL('ios')">🍎 ${EN()?'iPhone / iPad':'iPhone / iPad'}</button>
      </div></div>`; }
  let deferredInstall=null;
  window.addEventListener('beforeinstallprompt', e=>{ e.preventDefault(); deferredInstall=e; });
  window.addEventListener('appinstalled', ()=>{ deferredInstall=null; toast(EN()?'App installed ✓':'ติดตั้งแอปแล้ว ✓'); });
  // step-by-step help for whichever platform the parent taps
  function _installHelp(ios){ modal(`<div style="text-align:center"><div style="font-size:40px">${ios?'🍎':'🤖'}</div>
    <h3>${ios?(EN()?'Install on iPhone / iPad':'ติดตั้งบน iPhone / iPad'):(EN()?'Install on Android':'ติดตั้งบน Android')}</h3>
    <ol style="text-align:left;font-size:14px;line-height:1.7;padding-left:22px;margin:8px 0">
    ${ios
      ? `<li>${EN()?'Open this page in <b>Safari</b>':'เปิดหน้านี้ใน <b>Safari</b>'}</li><li>${EN()?'Tap <b>Share</b> ⬆️':'แตะปุ่ม <b>แชร์</b> ⬆️'}</li><li>${EN()?'Choose <b>Add to Home Screen</b>':'เลือก <b>เพิ่มลงในหน้าจอโฮม</b>'}</li><li>${EN()?'Tap <b>Add</b>':'แตะ <b>เพิ่ม</b>'}</li>`
      : `<li>${EN()?'Tap the browser menu ⋮':'แตะเมนู ⋮ ของเบราว์เซอร์'}</li><li>${EN()?'Choose <b>Install app</b> / <b>Add to Home screen</b>':'เลือก <b>ติดตั้งแอป</b> / <b>เพิ่มลงในหน้าจอหลัก</b>'}</li><li>${EN()?'Confirm <b>Install</b>':'ยืนยัน <b>ติดตั้ง</b>'}</li>`}
    </ol><button class="btn block" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button></div>`); }
  window.DO_INSTALL = async (platform)=>{
    if(platform==='android' && deferredInstall){ deferredInstall.prompt(); try{ await deferredInstall.userChoice; }catch(e){} deferredInstall=null; return; }
    _installHelp(platform==='ios'); };
  const DEMO_USERS = {
    Parent:{role:'Parent',nameTH:'กานต์ ดีงาม',nameEN:'Ms.Karn',parentId:'PAR-1',uid:'U_p1'},
    Teacher:{role:'Teacher',nameTH:'เอ มานะ',nameEN:'A Mana',staffId:'STF-T1'},
    Leader:{role:'Teacher',nameTH:'แนน ใจดี',nameEN:'Nan J.',staffId:'STF-L1'},
    Admin:{role:'Admin',nameTH:'อารยา ผ่องใส',nameEN:'Araya P.',staffId:'STF-ADM'},
    // demo/testing only — in the real school this comes from STAFF.Role
    Observer:{role:'Observer',nameTH:'ผู้ตรวจสอบ',nameEN:'Observer',staffId:'STF-OBS'},
  };
  window.LOGIN = function(roleKey){ if(!CONFIG.DEMO_MODE){ toast(EN()?'Demo login is disabled':'ปิดการเข้าสู่ระบบทดลองแล้ว'); return; } USER=Object.assign({},DEMO_USERS[roleKey]); USER._roleKey=roleKey;
    try{ localStorage.setItem('atom_session', JSON.stringify({roleKey, provider:PENDING_PROVIDER||'demo'})); }catch(e){}
    setHeader(); GO(initialScreen()); PREFETCH();
  };
  // log in as a freshly registered/linked parent (carries its own uid for data isolation)
  window.LOGIN_PARENT = function(u){ USER=Object.assign({role:'Parent',_roleKey:'Parent'},u);
    try{ localStorage.setItem('atom_session', JSON.stringify({roleKey:'Parent', provider:PENDING_PROVIDER||'demo', parent:u})); }catch(e){}
    setHeader(); GO(initialScreen()); PREFETCH();
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
    setHeader(); GO(initialScreen()); PREFETCH();
  };
  function logout(){
    try{ localStorage.removeItem('atom_session'); }catch(e){}
    // drop the #screen deep link too, or the next sign-in would reopen the previous user's tab
    try{ history.replaceState(null,'',location.pathname+location.search); }catch(e){}
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
  // index.html paints this same card from static HTML before any script runs, and it is
  // character-for-character what this function produces (measured: same height, same text, same
  // buttons). Replacing it with an identical render still creates NEW elements, and the browser treats
  // a newly painted element of that size as a fresh Largest-Contentful-Paint candidate — which is why
  // LCP sat ~3s behind FCP while nothing on screen changed. So when the shell is still there and we
  // would draw exactly it, leave it alone. English re-renders (the shell is written in Thai), and once
  // any other screen has replaced it the shell is gone and this renders normally.
  function loginScreen(){ USER=null; AUTH_RENDER=loginScreen; setHeader(); nav.hidden=true;
    if(document.getElementById('bootSplash') && !EN()) return;
    app.innerHTML = `<div class="rolewrap"><img src="assets/logo.png" class="logo-lg" alt="logo"/>
      <h2 class="page" style="text-align:center">${esc(t('login.title'))}</h2>
      <p class="muted">${esc(t('login.lineOnly'))}</p>
      <button class="role-card" onclick="LIFF_LOGIN()"><span class="ic" style="background:#06C755;color:#fff;font-weight:800">L</span><span><b>${esc(t('login.lineBtn'))}</b><br><small>${esc(t('login.lineSub'))}</small></span></button>
      <label style="display:flex;align-items:center;gap:8px;justify-content:center;margin-top:10px;font-size:13px"><input type="checkbox" id="rememberMe" checked style="width:auto"/> ${esc(t('login.remember'))}</label>
      ${installButtonsHTML()}</div>`;
  }
  // In gas+LIFF mode: trigger real LINE login; otherwise fall through to demo chooser
  /**
   * Get a working session again WITHOUT sending the user back to the login screen.
   *
   * api.js calls this when the server refuses a request for an expired session. The LINE session
   * behind the app outlives ours by a long way, so in almost every case we can mint a new token
   * from it and the person carries on with what they were doing — the failed call is repeated for
   * them. Returns false if LINE cannot vouch for them either, and only then do they see a login.
   */
  window.__atomReauth = async () => {
    try {
      if (CONFIG.MODE !== 'gas' || !CONFIG.LIFF_ID) return false;
      await loadLiff();
      if (!window.liff) return false;
      try { await liff.init({ liffId: CONFIG.LIFF_ID }); } catch (e) {}
      if (!liff.isLoggedIn()) return false;
      const u = await api('auth', { accessToken: liff.getAccessToken() });
      return !!(u && u.role && u.role !== 'guest');
    } catch (e) { return false; }
  };
  window.LIFF_LOGIN = () => {
    if (CONFIG.MODE === 'gas' && CONFIG.LIFF_ID) {                 // SDK may still be in flight — wait for it
      if (window.liff) { liff.login(); return; }
      toast(EN()?'Connecting to LINE…':'กำลังเชื่อมต่อ LINE…', 4000);
      loadLiff().then(() => liff.init({ liffId: CONFIG.LIFF_ID })).then(() => liff.login())
        .catch(() => toast(EN()?'Could not reach LINE — check your connection':'เชื่อมต่อ LINE ไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ต'));
      return;
    }
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
      ${PENDING_LINE_UID?`<div class="card" style="background:var(--surface-2);margin-top:10px"><small class="muted">${EN()?'Your LINE ID (give this to the admin to link your staff account):':'LINE ID ของคุณ (ส่งให้แอดมินเพื่อผูกบัญชีพนักงาน):'}</small><br><code style="font-size:13px;word-break:break-all" onclick="navigator.clipboard&&navigator.clipboard.writeText('${esc(PENDING_LINE_UID)}')">${esc(PENDING_LINE_UID)}</code></div>`:''}
      <button class="btn-ghost block" style="margin-top:8px" onclick="loginScreen()">${esc(t('c.back'))}</button></div>`;
  }
  // "I already gave my details to the school" — in production this used to dead-end on a screen that just
  // said "please sign in with LINE", so an imported parent had no way in and registered again (the cause of
  // the duplicate-parent mess). Now it opens the claim form. DEMO_MODE keeps the old role chooser for testing.
  window.chooserExisting = ()=> CONFIG.DEMO_MODE ? chooser() : CLAIM_FORM();
  // claim an EXISTING parent record: child's National ID + one thing only the family knows//the school holds
  window.CLAIM_FORM = (prefillNid)=>{ USER=null; AUTH_RENDER=()=>CLAIM_FORM(prefillNid); setHeader(); nav.hidden=true;
    app.innerHTML=`<div class="rolewrap"><img src="assets/logo.png" class="logo-lg" alt="logo"/>
      <h2 class="page" style="text-align:center">✅ ${EN()?'Use my existing details':'ใช้ข้อมูลที่เคยให้โรงเรียนไว้'}</h2>
      <p class="muted">${EN()?'If you already gave your details to the school, connect this LINE account to that record — no need to fill everything again.':'ถ้าท่านเคยให้ข้อมูลกับโรงเรียนไว้แล้ว เชื่อมบัญชี LINE นี้เข้ากับข้อมูลเดิมได้เลย ไม่ต้องกรอกใหม่'}</p>
      <div class="card">
        <label class="field"><span>${EN()?"Child's National ID (13 digits)":'เลขบัตรประชาชนของบุตรหลาน (13 หลัก)'} <span style="color:var(--bad)">*</span></span>
          <input id="cl_nid" inputmode="numeric" maxlength="17" placeholder="1-2345-67890-12-3" value="${esc(prefillNid||'')}"/></label>
        <label class="field"><span>${EN()?'Your National ID or your phone number':'เลขบัตรประชาชนของท่าน หรือเบอร์โทรของท่าน'} <span style="color:var(--bad)">*</span></span>
          <input id="cl_ver" inputmode="numeric" placeholder="${EN()?'as given to the school':'ตามที่แจ้งไว้กับโรงเรียน'}"/></label>
        <small class="muted" style="font-size:13px">${EN()?'Used only to confirm you are this child’s parent.':'ใช้เพื่อยืนยันว่าท่านเป็นผู้ปกครองของเด็กคนนี้เท่านั้น'}</small>
        <button class="btn block" style="margin-top:10px" onclick="CLAIM_DO(this)">🔗 ${EN()?'Connect my account':'เชื่อมข้อมูลของฉัน'}</button>
      </div>
      <button class="btn-ghost block" onclick="REG_START()">${EN()?'I have never given my details — register':'ยังไม่เคยให้ข้อมูล — ลงทะเบียนใหม่'}</button>
      <button class="btn-ghost block" onclick="accountStage()">${esc(t('c.back'))}</button></div>`; };
  window.CLAIM_DO = async (btn)=>{ const g=id=>{ const e=$('#'+id); return e?e.value.trim():''; };
    const nid=g('cl_nid'), ver=g('cl_ver');
    if(nid.replace(/\D/g,'').length!==13){ toast(EN()?"Enter the child's 13-digit National ID":'กรอกเลขบัตรประชาชนนักเรียน 13 หลัก'); return; }
    if(ver.replace(/\D/g,'').length<9){ toast(EN()?'Enter your National ID or phone number':'กรอกเลขบัตรของท่าน หรือเบอร์โทรของท่าน'); return; }
    btn.disabled=true;
    // PENDING_LINE_UID is set on every LIFF boot; atom_last_uid is only a belt-and-braces fallback.
    // On GAS the server overwrites uid from the verified guest token anyway (applyIdentity_).
    try{ let uid=PENDING_LINE_UID||''; if(!uid){ try{ uid=localStorage.getItem('atom_last_uid')||''; }catch(_){} }
      const r=await api('claimParent',{uid,nationalId:nid,verify:ver});
      await UPGRADE_SESSION();   // guest token → Parent token now that PARENTS.LineUID is set
      const kids=(r.students||[]).map(s=>s.nick||s.name).filter(Boolean).join(', ');
      confirmSaved((EN()?'Connected':'เชื่อมข้อมูลเรียบร้อย')+(kids?' — '+kids:''));
      LOGIN_PARENT({nameTH:r.name||r.nick||'',nameEN:r.nameEN||r.name||'',parentId:r.parentId,uid:uid||r.parentId}); }
    catch(e){ err(e); btn.disabled=false; } };
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
  // The LINE SDK is 32 KB of third-party JS that also fetches its own manifest and message bundle.
  // It used to sit in <head> as a <script defer>, so the browser started all of that WHILE it was still
  // fetching the CSS and app.js — competing with the sign-in card for bandwidth and adding a big slice
  // of the measured blocking time. Nothing on screen needs it until either auto-login or a tap on
  // "เข้าสู่ระบบด้วย LINE", and the sign-in card is already painted from index.html, so it is fetched
  // here instead: after the first paint.
  let _liffP = null;
  function loadLiff(){
    if (window.liff) return Promise.resolve(window.liff);
    if (!_liffP) _liffP = new Promise((res, rej) => {
      const el = document.createElement('script');
      el.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
      el.onload = () => res(window.liff); el.onerror = () => { _liffP = null; rej(new Error('LIFF SDK failed to load')); };
      document.head.appendChild(el);
    });
    return _liffP;
  }
  function boot(){ ensureTranslateObserver();
    // LIFF path: gas mode + LIFF_ID set → fetch the SDK, then real LINE auth
    if (CONFIG.MODE === 'gas' && CONFIG.LIFF_ID) {
      // not logged in / init failed (e.g. opened outside LINE) → keep an existing demo session if any,
      // else show login. Stops a reload from wiping a testing session.
      const fallback = () => { if(!restoreDemoOrLogin()){ loginScreen(); applyLangNow(); } };
      loadLiff().then(() => liff.init({ liffId: CONFIG.LIFF_ID })).then(() => {
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
      <div class="card" style="background:var(--surface-2)"><small class="muted">${esc(t('reg.parentFirstNote'))}</small></div>
      <div class="card"><h3>👪 ${esc(t('reg.parent'))}</h3>
        <div class="grid2"><label class="field"><span>${esc(t('reg.title'))}</span><select id="rTitle">${['นาย','นาง','นางสาว'].map(x=>`<option value="${x}">${EN()?({'นาย':'Mr.','นาง':'Mrs.','นางสาว':'Ms.'})[x]:x}</option>`).join('')}</select></label>${fld_('rPNameTH',t('reg.nameTH'))}</div>
        <div class="grid2">${fld_('rPNameEN',t('reg.nameEN'))}${fld_('rPNick',t('reg.nickname'))}</div>
        <div class="grid2">${fld_('rPNickEN',t('reg.nicknameEN'))}${fld_('rPNID',t('reg.nationalIdParent'))}</div>
        <div class="grid2"><label class="field"><span>${esc(t('reg.relationship'))}</span><select id="rRel" onchange="REG_titleFromRel()"><option>${esc(t('reg.father'))}</option><option>${esc(t('reg.mother'))}</option><option>${esc(t('reg.guardian'))}</option></select></label></div>
        <div class="grid2">${fld_('rPPhone',t('reg.mobile'))}${fld_('rPOffice',t('reg.officePhone'))}</div>
        <div class="grid2">${fld_('rPOcc',t('reg.occupation'))}${fld_('rPWork',t('reg.workplace'))}</div>
        ${fld_('rPAddr',t('reg.address'))}
        <label class="field"><span>📸 ${esc(t('reg.photoCapture'))}</span><input id="rPPhoto" type="file" accept="image/*" capture="user" onchange="REG_photoPrev(this)"/><span id="rPPhoto_st" class="muted" style="font-size:13px"></span></label>
        <div style="text-align:center"><img id="rPPhotoPrev" alt="" style="max-height:160px;border-radius:10px;border:1px solid var(--line);margin:4px 0;cursor:zoom-in" hidden onclick="IMG_zoom(this.src)"/></div>
        <small class="muted" style="font-size:13px">🔒 ${esc(t('reg.photoCaptureNote'))}</small></div>
      <div class="card"><label style="display:flex;gap:8px;align-items:flex-start;font-size:13px"><input type="checkbox" id="rPDPA" style="width:auto;margin-top:3px"/><span>${esc(t('reg.pdpa'))}</span></label></div>
      <div class="savedock"><button class="btn block" onclick="REG_submit()">${esc(t('reg.submit'))}</button></div>
      <button class="btn-ghost block" style="margin-top:8px" onclick="REG_BACK()">${esc(t('c.back'))}</button>`;
  };
  // relationship sets a sensible default title (father→นาย, mother→นางสาว); guardian leaves it alone
  window.REG_titleFromRel = ()=>{ const rel=$('#rRel').value, ti=$('#rTitle'); if(!ti)return;
    if(/บิดา|father/i.test(rel)) ti.value='นาย'; else if(/มารดา|mother/i.test(rel)) ti.value='นางสาว'; };
  window.REG_BACK = ()=>{ if(USER) GO('home'); else accountStage(); };
  window.REG_photoPrev=async(inp)=>{ const f=inp.files[0]; const img=$('#rPPhotoPrev'), st=$('#rPPhoto_st'); if(!f)return;
    if(st){ st.textContent='⏳ '+(EN()?'Processing…':'กำลังประมวลผล…'); st.style.color='var(--warn)'; }
    const url=await compressImage(f); inp.dataset.url=url||'';
    if(st){ st.textContent = url?('✅ '+(EN()?'Ready':'พร้อมแล้ว')):('⚠️ '+(EN()?'Not an image':'ไม่ใช่ไฟล์รูป')); st.style.color=url?'var(--ok)':'var(--bad)'; }
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
    }catch(e){
      // the school already has this parent on file — send them to the claim form instead of leaving them
      // stuck on an error they cannot act on (registering again is what created the duplicates)
      if(String((e&&e.code)||'')==='ALREADY_REGISTERED'){
        modal(`<h3>✅ ${EN()?'The school already has your details':'โรงเรียนมีข้อมูลของท่านอยู่แล้ว'}</h3>
          <p class="muted" style="font-size:13px">${EN()?'No need to fill everything again — connect this LINE account to your existing record.':'ไม่ต้องกรอกใหม่ทั้งหมด · เชื่อมบัญชี LINE นี้เข้ากับข้อมูลเดิมได้เลย'}</p>
          <button class="btn block" onclick="this.closest('.modal').remove();CLAIM_FORM()">🔗 ${EN()?'Connect to my existing record':'เชื่อมกับข้อมูลเดิมของฉัน'}</button>
          <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
        return; }
      err(e); } };

  // ----- add a NEW child (student-only form) — used from P_addChild -----
  window.REG_CHILD_FORM = ()=>{ REG_PICKUPS=1;
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('home')">${t('c.back')}</button><h2 class="page">👶 ${esc(t('reg.childTitle'))}</h2>
      <div class="card"><h3>👶 ${esc(t('reg.student'))}</h3>
        <p class="muted" style="font-size:13px">${EN()?'Fields marked * are required (incl. English name & nickname).':'ช่องที่มี * จำเป็นต้องกรอก (รวมชื่อจริงและชื่อเล่นภาษาอังกฤษ)'}</p>
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
      <div class="savedock"><button class="btn block" onclick="REG_childSubmit()">${esc(t('reg.saveChild'))}</button></div>`;
    REG_renderPickups();
  };
  window.REG_age = ()=>{ const v=$('#rDOB').value; if(v) $('#rAge').value=ageYM(v); };
  window.REG_addPickup = ()=>{ if(REG_PICKUPS>=4){toast(EN()?'Max 4':'สูงสุด 4 คน');return;} REG_PICKUPS++; REG_renderPickups(true); };
  function REG_renderPickups(keep){ const box=$('#rPickups'); if(!box)return; const old=keep?[...box.querySelectorAll('input')].map(i=>i.value):[];
    let h=''; for(let i=0;i<REG_PICKUPS;i++) h+=`<div class="grid3" style="margin-bottom:6px"><input id="pkN${i}" placeholder="${esc(t('reg.name'))}"/><input id="pkP${i}" placeholder="${esc(t('reg.phone'))}"/><input id="pkR${i}" placeholder="${esc(t('reg.relation'))}"/></div>`;
    box.innerHTML=h; if(keep) old.forEach((v,idx)=>{ const el=box.querySelectorAll('input')[idx]; if(el)el.value=v; }); }
  // red inline overlay for incomplete registration + highlight the empty required fields
  function REG_flashError(msg){ let el=document.getElementById('regErr'); if(!el){ el=document.createElement('div'); el.id='regErr';
      el.style.cssText='position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:100000;background:var(--bad);color:var(--surface);padding:12px 18px;border-radius:10px;box-shadow:0 6px 22px rgba(0,0,0,.28);font-weight:600;max-width:92%;text-align:center;font-size:14px'; document.body.appendChild(el); }
    el.textContent='⚠️ '+msg; el.style.display='block'; clearTimeout(el._t); el._t=setTimeout(()=>{ el.style.display='none'; },3800); }
  function REG_require(reqs){ let missing=[]; let first=null;
    reqs.forEach(([id,label])=>{ const el=$('#'+id); if(!el)return; const empty=!el.value.trim();
      el.style.borderColor=empty?'var(--bad)':''; el.style.background=empty?'var(--bad-bg)':'';
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

  const SCREENS = { Parent:{}, Teacher:{}, Admin:{}, Observer:{} };

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
    { const mt=jMilkTimes(j);
      row('🍼', jt('Milk & Water'), (milkQty&&milkQty!==0?`<b>${esc(milkQty)} ${esc(milkUnitL)}</b>`:'')
        + (mt.length?` <span class="muted">(${esc(mt.join(', '))}${EN()?'':' น.'})</span>`:'')
        + (j.Water?(milkQty?' · ':'')+esc(jt(j.Water)):'')); }
    // what the child ate, then how much of it — "ข้าวต้มไก่ · หมด" says far more than "หมด"
    { let mi={}; try{ mi=typeof j.MealItems==='string'?JSON.parse(j.MealItems||'{}'):(j.MealItems||{}); }catch(e){ mi={}; }
      const ms=['Breakfast','Lunch','Dinner','Snack'].filter(m=>meals[m]||mi[m]).map(m=>
        `${esc(jt(m))}: ${mi[m]?`<b>${esc(mi[m])}</b>${meals[m]?' ':''}`:''}${meals[m]?pill(jt(meals[m])):''}`);
      row('🍽', jt('Meals & Snacks'), ms.length?ms.join('<br>'):''); }
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
        ? `<div class="row"><textarea id="jPC" placeholder="${EN()?'Write a comment… (tap mic to speak)':'พิมพ์ความคิดเห็น... (กดไมค์เพื่อพูด)'}" style="flex:1">${esc(j.ParentComment||'')}</textarea><button class="micbtn" onclick="J_mic('jPC',this)" aria-label="${EN()?"Voice input":"พูดเพื่อกรอกข้อความ"}" title="${EN()?"Voice input":"พูดเพื่อกรอกข้อความ"}">🎤</button></div>
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
  // full Thai/English date + month names for the receipt (Buddhist year in Thai)
  const TH_MONTHS=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const EN_MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  // "YYYY-MM" (or a date) → "กรกฎาคม 2569" / "July 2026"
  function monthNameYear(v){ const s=String(v||''); const m=/^(\d{4})-(\d{1,2})/.exec(s); let y,mo; if(m){y=+m[1];mo=+m[2]-1;} else {const d=new Date(s);y=d.getFullYear();mo=d.getMonth();} if(mo<0||mo>11)return s; return EN()?`${EN_MONTHS[mo]} ${y}`:`${TH_MONTHS[mo]} ${y+543}`; }
  // date → "25 กรกฎาคม 2569" / "25 July 2026"
  function fullDate(v){ const d=new Date(v||todayStr()); if(isNaN(d))return String(v||''); const dd=d.getDate(),mo=d.getMonth(),y=d.getFullYear(); return EN()?`${dd} ${EN_MONTHS[mo]} ${y}`:`${dd} ${TH_MONTHS[mo]} ${y+543}`; }
  // student leave label: "ประเภท — เหตุผล" (type first, reason appended when present)
  const stdLeaveDesc = l => { const ty=(l&&l.Type||'').trim(), rs=(l&&l.Reason||'').trim(); return ty&&rs ? ty+' — '+rs : (ty||rs||'-'); };
  function waitCard(date){ return `<div class="card" style="text-align:center;color:var(--warn-ink);background:var(--warn-bg);border-color:var(--warn-line)">⏳ รอคุณครูส่งข้อมูลของวันที่ ${ddmmyyyy(date)}</div>`; }
  function annRow(a){ const ti=EN()?(a.TitleEN||a.Title):(a.Title||a.TitleEN); const co=EN()?(a.ContentEN||a.Content):(a.Content||a.ContentEN);
    return `<div class="list-item"><div><b>${esc(ti)}</b><br><small class="muted">${esc(co)}</small>${a.Image?`<br><img class="ann-thumb" src="${esc(a.Image)}" alt=""/>`:''}</div><small class="muted">${esc(a.Date)}</small></div>`; }
  const SCHOOL_MAP_URL = 'https://maps.app.goo.gl/jQhGb3KQj59RV2wXA';
  function socialFooter(){ const L=MOCK.config.Links||{}; return `<div class="social">
    <a href="${esc(L.line||'#')}" target="_blank"><span class="ic line">L</span>LINE OA</a>
    <a href="${esc(L.facebook||'#')}" target="_blank"><span class="ic fb">f</span>Facebook</a>
    <a href="${esc(L.map||SCHOOL_MAP_URL)}" target="_blank"><span class="ic web">📍</span>${EN()?'Map':'แผนที่'}</a></div>`; }
  // ---- navigable month calendar (all roles: browse ahead/back) ----
  let CAL_OFF=0;  // month offset from the current month; reset on screen nav (GO)
  const CAL_redraw=()=>{ const w=document.getElementById('calWrap'); if(w&&window._CALRENDER) w.innerHTML=window._CALRENDER();
    // birthdays belong to the month on screen, so they follow the arrows. Only the student-leave
    // calendar has them; everywhere else this is a no-op.
    if(document.getElementById('bdayCard')) CAL_birthdays(); };
  window.CAL_nav=(d)=>{ CAL_OFF+=d; CAL_redraw(); };
  window.CAL_today=()=>{ CAL_OFF=0; CAL_redraw(); };
  window.CAL_birthdays=async()=>{ const b=calBase();
    const month=b.getFullYear()+'-'+String(b.getMonth()+1).padStart(2,'0');
    if(window._SALERTS && window._SALERTS.month===month){ setHTML('#bdayCard', birthdayCard(window._SALERTS)); return; }
    try{ window._SALERTS=await api('studentAlerts',{staffId:USER.staffId,role:USER.role,month});
      setHTML('#bdayCard', birthdayCard(window._SALERTS));
      setHTML('#dspmDueCard', dspmDueCard(window._SALERTS));
      const w=document.getElementById('calWrap'); if(w&&window._CALRENDER) w.innerHTML=window._CALRENDER();
    }catch(e){}
  };
  const CAL_MTH=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'], CAL_MTHE=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const calBase=()=>{ const b=new Date(); b.setDate(1); b.setMonth(b.getMonth()+CAL_OFF); return b; };
  function calNavHeader(y,mo){ const head=EN()?CAL_MTHE[mo]+' '+y:CAL_MTH[mo]+' '+(y+543);
    return `<div class="spread" style="margin-bottom:6px"><button class="btn sm outline" onclick="CAL_nav(-1)" aria-label="${EN()?"Previous month":"เดือนก่อนหน้า"}" title="${EN()?"Previous month":"เดือนก่อนหน้า"}">◀</button><b style="font-size:14px">📅 ${esc(head)}</b><span class="row"><button class="btn sm outline" onclick="CAL_today()">${EN()?'Today':'วันนี้'}</button><button class="btn sm outline" onclick="CAL_nav(1)" aria-label="${EN()?"Next month":"เดือนถัดไป"}" title="${EN()?"Next month":"เดือนถัดไป"}">▶</button></span></div>`; }

  // light-red / teal background for weekend · holiday · meeting-day cells (shared by all calendars)
  function calOffBg(y,mo,d,hol,bc){ const dow=new Date(y,mo,d).getDay(); if(hol)return 'background:var(--bad-bg);border-color:var(--bad-line);'; if(bc)return 'background:var(--teal-bg);border-color:var(--teal-line);'; if(dow===0||dow===6)return 'background:var(--bad-bg);border-color:var(--bad-line);'; return ''; }
  // Parent calendar: check-in/out times + school holidays + the LINKED student's leave days only.
  // A child's plan end time drives the "late pick-up" marker. Live plans first (seed ids never match
  // the real pkg_* ids), and a per-student EndTime override wins — same rule the OT charge uses.
  const planEndOf = s => { if(!s) return '';
    if(s.EndTime) return String(s.EndTime).slice(0,5);
    const list=(window.A_plans?A_plans():null)||(MOCK.config.Plans||[]);
    const p=list.find(x=>x.id===s.Plan); return p?p.end:''; };
  // Parent with more than one child: switch the bottom calendar between them.
  window.P_calSel = (i)=>{ const d=window._CALDATA; if(!d||!d.kids[i]) return;
    const seg=document.getElementById('calSeg'); if(seg)[...seg.children].forEach((b,j)=>b.classList.toggle('active',j===i));
    const box=document.getElementById('calBox'); if(!box) return;
    CAL_OFF=0;   // a fresh child starts on the current month
    box.innerHTML=calendarWidget(d.cal, d.ciAll[i]||[], planEndOf(d.kids[i]), d.slAll[i]||[]);
    if(window.translateTree) translateTree(box); };
  function calendarWidget(events, checkins, planEnd, studentLeaves){ checkins=checkins||[]; studentLeaves=studentLeaves||[];
    const grace=Number(MOCK.config.OTGraceMinutes||21); const toMin=hhmm=>{const[h,m]=String(hhmm||'0:0').split(':').map(Number);return (h||0)*60+(m||0);};
    const lateOut = out => planEnd && out && (toMin(out)-toMin(planEnd))>grace;
    const render=()=>{ const b=calBase(),y=b.getFullYear(),mo=b.getMonth(); const now=new Date(); const isCur=CAL_OFF===0;
      const first=new Date(y,mo,1).getDay(); const days=new Date(y,mo+1,0).getDate(); const evByDay={},ioByDay={},lvByDay={};
      events.forEach(e=>{ const d=new Date(e.date); if(d.getFullYear()===y&&d.getMonth()===mo) (evByDay[d.getDate()]=evByDay[d.getDate()]||[]).push(e); });
      checkins.forEach(c=>{ const d=new Date(c.Date); if(d.getFullYear()===y&&d.getMonth()===mo) ioByDay[d.getDate()]=c; });
      studentLeaves.forEach(l=>{ const d=new Date(l.Date); if(d.getFullYear()===y&&d.getMonth()===mo) (lvByDay[d.getDate()]=lvByDay[d.getDate()]||[]).push(l); });
      let cells=['อา','จ','อ','พ','พฤ','ศ','ส'].map(w=>`<div style="text-align:center;font-size:13px;color:var(--ink-3)">${EN()?({'อา':'Su','จ':'Mo','อ':'Tu','พ':'We','พฤ':'Th','ศ':'Fr','ส':'Sa'}[w]):w}</div>`).join('');
      for(let i=0;i<first;i++) cells+=`<div class="d dim"></div>`;
      for(let d=1;d<=days;d++){ const ev=evByDay[d]; const io=ioByDay[d]; const lv=lvByDay[d]; const et=ev?ev[0].type:''; const today=(isCur&&d===now.getDate())?'today':'';
        const isBC=!!(ev&&ev.some(e=>e.type==='bigclean')); const isHol=!!(ev&&ev.some(e=>e.type!=='bigclean'));
        const outRed=io&&lateOut(io.OutTime); const outHtml=io?`<span style="${outRed?'color:var(--bad-2);font-weight:800':''}">${esc(io.OutTime||'-')}</span>`:'';
        // leave day keeps its orange; otherwise weekend/holiday/Big-Cleaning → light red / cleaning tint
        const bg = lv?'background:var(--warn-bg);border-color:var(--warn-line);':calOffBg(y,mo,d,isHol,isBC);
        cells+=`<div class="d ${ev?'ho':''} ${lv?'ev':''} ${today}" style="${bg}">${d}${ev?`<span class="dot" style="color:${isBC&&!isHol?'var(--teal)':'var(--bad)'}">${isBC&&!isHol?BC_ICON:'🏖️'} ${esc(EN()?(ev[0].titleEN||ev[0].title):ev[0].title)}</span>`:''}${lv?`<span class="dot" style="color:var(--warn)">🏠 ${esc(lv[0].Type||lv[0].Reason||(EN()?'leave':'ลา'))}</span>`:''}${io?`<span class="io">${esc(io.InTime||'-')}<br>${outHtml}</span>`:''}</div>`; }
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
    if(!kids.length){ app.innerHTML=`<h2 class="page">${esc(t('p.greeting'))}${esc(EN()?USER.nameEN:'คุณ'+USER.nameTH)} 👋</h2>
      <div class="card" style="text-align:center"><p>${esc(t('p.noChild'))}</p><div class="row" style="justify-content:center">${addBtn}${profileBtn}</div></div>${socialFooter()}`; return; }
    const k0 = kids[0];
    // one batched round-trip: journal/leaves/announcements/calendar + each kid's check-in history (for today's status)
    // one batched round-trip. Check-ins AND leaves are fetched for every child, not just the first,
    // so the calendar at the bottom can be switched per child (it only ever showed child #1 before).
    const _res = await Promise.all([
      api('getJournal',{studentId:k0.StudentID}), api('studentLeaves',{studentId:k0.StudentID}),
      api('announcements'), api('calendar'), api('familyProfile',parentScope()).catch(()=>({parents:[]})),
      api('getPlans').catch(()=>[]),
      api('schoolDay',{}).then(d=>{ window._SCHOOLDAY=d; return d; }).catch(()=>null),
      // what the family still owes — rides in the SAME batch, so telling them costs no extra trip
      api('parentDue',parentScope()).catch(()=>null),
      ...kids.map(k=>api('studentCheckinHistory',{studentId:k.StudentID})),
      ...kids.map(k=>api('studentLeaves',{studentId:k.StudentID}).catch(()=>[]))
    ]);
    // 8 fixed entries now (parentDue was added), then one check-in history per child, then one
    // leave list per child — the offsets below MUST move with that count or every child's calendar
    // is handed another child's data. FIXED is the count, in one place, so adding the ninth cannot
    // silently shift them again.
    const FIXED = 8;
    const [j, sl, anns, cal, fam, plans] = _res; const due = _res[7];
    const ciAll=_res.slice(FIXED, FIXED+kids.length); const slAll=_res.slice(FIXED+kids.length); const ci=ciAll[0]||[];
    if(plans&&plans.length) A_CACHE.plans=plans;   // so planLabel() names the package, not "pkg_e32dd4"
    // everything the per-child calendar needs, kept for P_calSel()
    window._CALDATA={ kids, cal, ciAll, slAll, plans:plans||[] };
    // greeting = คุณพ่อ/แม่ + first child's nickname (always), regardless of the parent's own nickname
    const _me=((fam&&fam.parents)||[]).find(p=>p.isMe)||((fam&&fam.parents)||[])[0]||{}; const _rel=_me.Relationship||'';
    const _k0n=dispNick(k0); const _dad=REL_DAD.test(_rel), _mom=REL_MOM.test(_rel);
    // 'p.greeting' is just "สวัสดีค่ะ " — the honorific belongs to the name, because the resolved form
    // already starts with คุณพ่อ/คุณแม่ (it used to render "สวัสดีค่ะ คุณคุณพ่อน้องเอม").
    const greetName=_k0n?(EN()?`${_k0n}'s ${_dad?'dad':_mom?'mom':'parent'}`:`${_dad?'คุณพ่อน้อง':_mom?'คุณแม่น้อง':'ผู้ปกครองน้อง'}${_k0n}`):(EN()?USER.nameEN:'คุณ'+USER.nameTH);
    // today's IN/OUT time per kid → disable the button once done (one drop-off / one pick-up per day)
    const todayCI={}; kids.forEach((k,i)=>{ const r=(ciAll[i]||[]).find(x=>ymd(x.Date)===todayStr())||{}; todayCI[k.StudentID]={in:r.InTime||'',out:r.OutTime||''}; });
    const doneBtn=(done,txt)=> done ? `disabled style="flex:1;padding:18px;font-size:18px;font-weight:700;opacity:.45;cursor:not-allowed"` : `style="flex:1;padding:18px;font-size:18px;font-weight:700"`;
    // рับ-ส่งเด็ก (GPS) is now on the home kid card: big IN/OUT buttons like the teacher's, no location bar
    const kidsHtml = kids.map(k=>{ const din=todayCI[k.StudentID].in, dout=todayCI[k.StudentID].out;
      return `<div class="card"><div class="spread"><div><b style="font-size:17px">${esc(dispNick(k))}</b> <small class="muted">${esc(nm(k))}</small><br><small class="muted">🏫 ${esc(k.Class||(EN()?'no class':'ยังไม่จัดชั้น'))} · ${esc(ageYM(k.DOB))} · ${esc(planLabel(k.Plan))}<br>${EN()?'allergy':'แพ้'}: ${esc(k.Allergy||'-')}</small>${k.RateNote?`<br><small style="color:var(--blue)">🕕 ${esc(k.RateNote)}</small>`:''}</div>${studentAvatar(k)}</div>
      ${(window._SCHOOLDAY&&window._SCHOOLDAY.closedForStudents)
        // School shut today: the server refuses a check-in anyway, so offering the buttons could only
        // produce an error. Say WHICH holiday — that is the thing a parent actually wants to know.
        // a HALF-day holiday says the window, and says the buttons come back after it — otherwise a
        // parent reads "closed today" at 09:00 and does not come back at 13:00
        ? `<div class="card" style="background:var(--surface-3);border-color:var(--line-strong);margin-top:12px;padding:10px;text-align:center">
             <b>🏖️ ${window._SCHOOLDAY.partial?(EN()?'School closed just now':'ขณะนี้โรงเรียนหยุด'):(EN()?'School closed today':'วันนี้โรงเรียนหยุด')}</b>
             <br><small class="muted">${esc(EN()?(window._SCHOOLDAY.reasonEN||'Holiday'):(window._SCHOOLDAY.reason||'วันหยุด'))}${window._SCHOOLDAY.partial?` <b>${esc((window._SCHOOLDAY.holStart||'00:00')+'-'+(window._SCHOOLDAY.holEnd||'23:59'))}</b>`:''} · ${window._SCHOOLDAY.partial?(EN()?'the buttons return after that time':'หลังเวลานี้จะกลับมาใช้ปุ่มได้ตามปกติ'):(EN()?'no drop-off or pick-up to record':'ไม่ต้องบันทึกส่ง-รับ')}</small></div>`
        : k.onLeave
        // Away today. The family told us themselves, so the leave IS the record of this child's day
        // — offering drop-off / pick-up would only produce a refusal (ON_LEAVE). This is PER CHILD:
        // a sibling who did go to school keeps their buttons on the very same screen.
        ? `<div class="card" style="background:var(--warn-bg);border-color:var(--warn-line);margin-top:12px;padding:10px;text-align:center">
             <b style="color:var(--warn)">🏖️ ${EN()?'On leave today':'ลาวันนี้'}</b>
             <br><small class="muted">${esc(k.leaveType||(EN()?'leave':'ลา'))}${k.leaveReason?' · '+esc(k.leaveReason):''}</small>
             <br><small class="muted">${EN()?'Nothing to record today. Cancel the leave first if they do come in.':'วันนี้ไม่ต้องบันทึกส่ง-รับ · หากมาจริงกรุณายกเลิกใบลาก่อน'}</small></div>`
        : k.paused
        // On temporary leave (or not started yet): there is nothing to record, so the buttons go
        // rather than sitting there doing nothing. Everything else about the child stays visible —
        // the family still needs the bills and their own details.
        ? `<div class="card" style="background:var(--warn-bg);border-color:var(--warn-line);margin-top:12px;padding:10px;text-align:center">
             <b style="color:var(--warn)">⏳ ${EN()?'Not due to attend yet':'ยังไม่ถึงกำหนดเข้าเรียน'}</b>
             ${k.pauseFrom?`<br><small class="muted">${EN()?'from':'ตั้งแต่'} ${esc(k.pauseFrom)}${k.pauseTo?` ${EN()?'to':'ถึง'} ${esc(k.pauseTo)}`:''}</small>`:''}
             ${k.pauseReason?`<br><small class="muted">${esc(k.pauseReason)}</small>`:''}</div>`
        : `<div class="row" style="margin-top:12px;gap:10px"><button class="btn green" ${doneBtn(din)} onclick="P_punch('${k.StudentID}','IN',this)">🟢 ${din?(EN()?'Dropped off ':'ส่งแล้ว ')+esc(din):(EN()?'Drop off':'ส่งเข้าเรียน')}</button><button class="btn pink" ${doneBtn(dout)} onclick="P_punch('${k.StudentID}','OUT',this)">🔴 ${dout?(EN()?'Picked up ':'รับแล้ว ')+esc(dout):(EN()?'Pick up':'รับกลับ')}</button></div>`}</div>`; }).join('');
    /**
   * What the family still owes, right under the drop-off / pick-up card — the place they already
   * look every morning. Tapping it goes to the payment screen; it is the whole card, not a small
   * link, because the number is the point.
   *
   * Nothing owed prints NOTHING. A green "you're all paid up" banner every single day is noise, and
   * noise is what makes people stop reading the screen that does matter.
   */
  function parentDueCard(due){
    if(!due || !(Number(due.total)>0)) return '';
    const kids=(due.children||[]);
    return `<div class="card" style="background:var(--warn-bg);border-color:var(--warn-line);cursor:pointer" onclick="GO('payment')">
      <div class="spread"><b>💳 ${EN()?'Outstanding':'ยอดค้างชำระ'}</b>
        <b style="font-size:22px;color:var(--warn)">${baht(due.total)}</b></div>
      ${kids.length>1 ? kids.map(c=>`<div class="list-item" style="padding:6px 0"><span>${esc(c.nick||c.name)}</span>
        <span><b>${baht(c.due)}</b> <small class="muted">${c.count} ${EN()?'items':'รายการ'}</small></span></div>`).join('')
        : `<small class="muted">${due.count} ${EN()?'item(s) to pay':'รายการที่ต้องชำระ'}</small>`}
      <button class="btn sm block" style="margin-top:8px" onclick="event.stopPropagation();GO('payment')">${EN()?'Go to payment':'ไปหน้าชำระเงิน'} →</button></div>`;
  }
  // header quick-actions: บันทึก / พัฒนาการ. (แจ้งลาออก removed — only Admin may withdraw a student.)
    setTopActions(`<button class="btn sm outline" onclick="P_journal('${k0.StudentID}')" title="${esc(t('nav.journal'))}">📒<span class="lbl"> ${esc(t('nav.journal'))}</span></button>
      <button class="btn sm outline" onclick="P_dspm('${k0.StudentID}')" title="${esc(t('nav.dspm'))}">📈<span class="lbl"> ${esc(t('nav.dspm'))}</span></button>`);
    const slHtml = sl.map(l=>`<div class="list-item"><span>${esc(ddmmyyyy(l.Date))} · <b>${esc(stdLeaveDesc(l))}</b></span><span class="pill info">${esc(tStat(l.Status))}</span></div>`).join('')||'<small class="muted">ไม่มีรายการ</small>';
    app.innerHTML = `<div class="spread"><h2 class="page">${esc(t('p.greeting'))}${esc(greetName)} 👋</h2><div class="row">${profileBtn}${addBtn}</div></div>
      ${kidsHtml}
      <div id="pDue"></div>
      <h3 style="margin:6px 2px">📒 ${EN()?'Journal of':'บันทึกของ'} ${esc(dispNick(k0))} ${EN()?'today':'วันนี้'}</h3>${j?journalChecklist(j,{parentEditable:true,student:k0}):waitCard()}
      <div class="card"><div class="spread"><h3>🏠 แจ้งลาบุตรหลาน</h3><button class="btn sm outline" onclick="P_absence()">+ แจ้งลา</button></div>${slHtml}</div>
      <div id="svCard"></div>
<!-- the food-menu card was here. Removed on the owner's call: the day's meals are already on the
           child's daily journal, where a parent reads what their child actually ATE rather than what
           was planned. P_menu went with it — see below. -->
      <div class="card" id="insCard"></div>
      <div class="card"><h3>📢 ประกาศจากโรงเรียน</h3>${(()=>{
        // whether an announcement is on show is the SERVER's answer (annPhase_), not a second copy
        // of the rule here — a screen that disagrees with the server about a window is the bug that
        // has already cost us twice with "is the school open today"
        const act=(anns||[]).filter(a=>a.Active!==false);
        return act.length?act.map(annRow).join(''):`<small class="muted">${EN()?'No announcements from the school yet':'ยังไม่มีประกาศจากทางโรงเรียน'}</small>`; })()}</div>
      ${kids.length>1?`<div class="seg" id="calSeg" style="margin:14px 2px 6px">${kids.map((k,i)=>`<button class="${i===0?'active':''}" onclick="P_calSel(${i})">🗓️ ${esc(dispNick(k))}</button>`).join('')}</div>`:''}
      <div id="calBox">${calendarWidget(cal, ci, planEndOf(k0), sl)}</div>
      ${socialFooter()}`;
    setHTML('#pDue', parentDueCard(due));
    // insurance status per child (parent fills once; shows "กรอกแล้ว" if done)
    try{ const sts=await Promise.all(kids.map(k=>api('insuranceStatus',{studentId:k.StudentID})));
      // an open survey is offered, never forced: a dismissible card, and answering is one tap
      api('openSurveys',parentScope()).then(list=>{
        const open=(list||[]).filter(s=>!s.answered);
        if(!open.length) return;
        setHTML('#svCard', open.slice(0,2).map(s=>`<div class="card" style="border-color:var(--brand-line);background:var(--brand-soft)">
          <div class="spread"><b>💬 ${esc(s.title)}</b>${s.anonymous?`<span class="pill info" style="font-size:11px">${EN()?'anonymous':'ไม่ระบุชื่อ'}</span>`:''}</div>
          ${s.description?`<small class="muted">${esc(s.description)}</small>`:''}
          <button class="btn sm block" style="margin-top:8px" onclick="P_survey('${esc(s.surveyId)}')">${EN()?'Answer — it takes a moment':'ร่วมตอบแบบสอบถาม ใช้เวลาไม่ถึงนาที'}</button></div>`).join(''));
      }).catch(()=>{});
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
      return `<div class="card"><div class="spread"><h3>${p.isMe?'👤':'👥'} ${esc(parentDisp(p)||(EN()?'Parent':'ผู้ปกครอง'))} ${p.isMe?`<span class="pill ok" style="font-size:11px">${EN()?'me':'ฉัน'}</span>`:''}</h3></div>
        <div class="ppic">
          ${pic?`<img class="ppic-img" src="${esc(pic)}" alt="" onclick="IMG_zoom('${esc(pic)}')"/>`:`<span class="ppic-none">${esc(initialEN(p.NameEN))}</span>`}
          <div class="ppic-side">
            <span class="pill ${usingLine?'info':'ok'}" style="font-size:11px">${usingLine?('LINE '+(EN()?'picture':'โปรไฟล์')):(p.Photo?(EN()?'uploaded':'รูปที่อัปโหลด'):(EN()?'no picture':'ยังไม่มีรูป'))}</span>
            <small class="muted" style="font-size:13px">${EN()?'Uses your LINE picture automatically. Upload one to replace it.':'ใช้รูปโปรไฟล์ LINE อัตโนมัติ · อัปโหลดรูปเพื่อใช้แทนได้'}</small>
            ${photoField(pre+'_PhotoUp',(EN()?'Upload a picture':'อัปโหลดรูป'),'',false)}
            ${p.Photo?`<button class="btn sm outline" onclick="P_useLinePic('${p.ParentID}',this)">↩︎ ${EN()?'Use my LINE picture':'ใช้รูป LINE แทน'}</button>`:''}
          </div>
        </div>
        <div class="grid2"><label class="field"><span>${esc(t('reg.title'))}</span><select id="${pre}_Title">${['','นาย','นาง','นางสาว'].map(x=>`<option value="${x}" ${(p.Title||titleOf(p))===x?'selected':''}>${EN()?({'':'','นาย':'Mr.','นาง':'Mrs.','นางสาว':'Ms.'})[x]:x}</option>`).join('')}</select></label>${ppFld(pre,'NameTH',EN()?'Name (TH)':'ชื่อ-สกุล (ไทย)',p.NameTH)}</div>
        <div class="grid2">${ppFld(pre,'NameEN',EN()?'Name (EN)':'ชื่อ-สกุล (อังกฤษ)',p.NameEN)}${ppFld(pre,'Nickname',EN()?'Nickname (TH)':'ชื่อเล่น (ไทย)',p.Nickname)}</div>
        <div class="grid2">${ppFld(pre,'NicknameEN',EN()?'Nickname (EN)':'ชื่อเล่น (อังกฤษ)',p.NicknameEN)}<label class="field"><span>${EN()?'Relationship':'ความสัมพันธ์'}</span><input id="${pre}_Relationship" value="${esc(String(p.Relationship||'').replace(/<[^>]*>/g,''))}"/></label></div>
        <div class="grid2">${ppFld(pre,'Phone',EN()?'Phone':'เบอร์โทร',phoneFmt(p.Phone))}${ppFld(pre,'OfficePhone',EN()?'Office phone':'เบอร์ที่ทำงาน',phoneFmt(p.OfficePhone))}</div>
        <div class="grid2">${ppFld(pre,'Occupation',EN()?'Occupation':'อาชีพ',p.Occupation)}${ppFld(pre,'Workplace',EN()?'Workplace':'ที่ทำงาน',p.Workplace)}</div>
        <label class="field"><span>${EN()?'Address':'ที่อยู่'}</span><textarea id="${pre}_Address">${esc(p.Address||'')}</textarea></label>
        <p class="muted" style="font-size:13px">${EN()?'National ID':'เลขบัตรประชาชน'}: <b>${esc(p.NationalID||'-')}</b> · ${EN()?'contact admin to change':'ติดต่อแอดมินเพื่อแก้ไข'}</p>
        <button class="btn block green" onclick="P_saveParent('${p.ParentID}',this)">💾 ${EN()?'Save':'บันทึก'}</button></div>`; };
    const studentCard=s=>{ const pre='st_'+s.StudentID;
      return `<div class="card"><div class="spread"><h3>👶 ${esc(nm(s))}${nick(s)?` <span class="pill info" style="font-size:13px">${esc(nick(s))}</span>`:''}</h3><span class="muted" style="font-size:13px">🏫 ${esc(s.Class||(EN()?'no class':'ยังไม่จัดชั้น'))} · ${esc(ageYM(s.DOB))}</span></div>
        <p class="muted" style="font-size:13px">${EN()?'ID':'เลขบัตร'}: <b>${esc(s.NationalID||'-')}</b> · ${EN()?'class/plan/ID: contact admin':'ชั้นเรียน/แพ็กเกจ/เลขบัตร: ติดต่อแอดมิน'}</p>
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
    // the option VALUES stay Thai — that is what the sheet stores and what studentAbsence expects;
    // only the labels switch language (tLeaveType covers the three standard types).
    const types=['ลาป่วย','ลากิจ','ลาพักร้อน','อื่นๆ'];
    const m=modal(`<h3>🏠 ${EN()?'Report your child absent':'แจ้งลาบุตรหลาน'}</h3>
      <label class="field"><span>${EN()?'Child':'บุตรหลาน'}</span><select id="aKid">${kids.map(k=>`<option value="${k.StudentID}">${esc(dispNick(k))}</option>`).join('')}</select></label>
      <label class="field"><span>${EN()?'Date':'วันที่ลา'}</span><input type="date" id="aDate" value="${todayStr()}"/></label>
      <label class="field"><span>${EN()?'Leave type':'ประเภทการลา'}</span><select id="aType">${types.map(x=>`<option value="${esc(x)}">${esc(x==='อื่นๆ'?(EN()?'Other':'อื่นๆ'):tLeaveType(x))}</option>`).join('')}</select></label>
      <label class="field"><span>${EN()?'Reason (optional)':'สาเหตุ (ถ้ามี)'}</span><textarea id="aReason" placeholder="${EN()?'e.g. fever / family matter':'เช่น เป็นไข้ / มีธุระครอบครัว'}"></textarea></label>
      <button class="btn block" onclick="P_absenceDo(this)">${EN()?'Send':'ส่งแจ้งลา'}</button>`);
  };
  window.P_absenceDo = async (btn) => { const m=btn.closest('.modal');
    await api('studentAbsence',{studentId:m.querySelector('#aKid').value,date:m.querySelector('#aDate').value,type:m.querySelector('#aType').value,reason:m.querySelector('#aReason').value});
    m.remove(); toast(EN()?'✅ Absence reported — the teacher has been notified':'✅ แจ้งลาแล้ว — ครูได้รับทราบ'); GO('home'); };

  // shared withdrawal reason picker (4 standard reasons; "other" reveals a long-text box)
  const WD_REASONS=['graduated','moved','transferred','other'];
  const withdrawReasonField=(selId,detId)=>`<label class="field"><span>${esc(t('wd.reason'))}</span>
      <select id="${selId}" onchange="WD_toggleDetail('${selId}','${detId}')">${WD_REASONS.map(r=>`<option value="${r}">${esc(t('wd.reason.'+r))}</option>`).join('')}</select></label>
    <label class="field" id="${detId}_wrap" hidden><span>${esc(t('wd.detail'))}</span><textarea id="${detId}" placeholder="${esc(t('wd.reason.other'))}"></textarea></label>`;
  window.WD_toggleDetail=(selId,detId)=>{ const w=document.getElementById(detId+'_wrap'); if(w)w.hidden=(document.getElementById(selId).value!=='other'); };
  // parent: self-service withdrawal / cancel enrolment request
  window.P_withdraw = async ()=>{ const kids=await api('parentChildren',parentScope());
    if(!kids.length){toast(t('p.noChild'));return;}
    const m=modal(`<h3>🚪 ${esc(t('wd.title'))}</h3><p class="muted" style="font-size:13px">${esc(t('wd.parentNote'))}</p>
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
        <div class="card" style="background:var(--ok-bg);border-color:var(--ok-line)"><b style="color:var(--ok)">✓ ${esc(t('ins2.filledMsg'))}</b><br><small class="muted">${esc(t('ins2.filledBy'))}: ${esc(r.FilledBy||'')} · ${esc(r.FilledDate||'')}</small></div>
        <div class="card"><table style="width:100%;font-size:13px">
          ${[['ins2.titlePre',r.Title],['ins2.fname',r.InsuredName],['ins2.lname',r.InsuredLastName],['ins2.nid',r.NationalID],['ins2.dob',r.DOB],['ins2.plan',r.Plan],['ins2.effective',r.EffectiveDate],['ins2.beneName',(r.BeneficiaryName||'')+' '+(r.BeneficiaryLastName||'')],['ins2.beneRel',r.BeneficiaryRelationship]].map(x=>`<tr><td class="muted">${esc(t(x[0]))}</td><td style="text-align:right"><b>${esc(x[1]||'-')}</b></td></tr>`).join('')}
        </table></div>`; window.scrollTo(0,0); return; }
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('home')">${t('c.back')}</button><h2 class="page">🛡️ ${esc(t('ins2.title'))}</h2>
      <div class="card" style="background:var(--surface-2)"><small class="muted">${esc(t('ins2.note'))}</small></div>
      ${insuranceFormHTML(o,s,null)}
      <div class="savedock"><button class="btn block" onclick="P_insuranceSave('${sid}')">${esc(t('ins2.save'))}</button></div>`; window.scrollTo(0,0); };
  window.P_insuranceSave = async (sid)=>{ const d=readInsuranceForm(); if(!insValid(d)){toast(t('ins2.required'));return;}
    try{ await api('submitInsurance',{studentId:sid,parentId:USER.parentId,uid:USER.uid,data:d}); confirmSaved(t('ins2.saved')); GO('home'); }catch(e){err(e);} };

  /**
   * The pick-up history. A parent with more than one child used to see ONE of them — kids[0] — with
   * nothing on the screen to say which, and no way to reach the others. Two children's mornings look
   * much alike, so the wrong one is not obviously the wrong one.
   *
   * Nickname tabs, the same way every other multi-child screen in the app does it (childSwitcher),
   * and the name is repeated on the card so a screenshot of it is unambiguous.
   */
  SCREENS.Parent.checkin = async () => {
    showAnnPopups();
    const kids=await api('parentChildren',parentScope()); if(!kids.length){GO('home');return;}
    window._CI_KIDS=kids;
    P_ciHist(kids[0].StudentID);
  };
  window.P_ciHist = async (sid) => { setNav('checkin');
    const kids=window._CI_KIDS||[]; const kid=kids.find(k=>k.StudentID===sid)||kids[0]||{};
    app.innerHTML = `<h2 class="page">${esc(t('title.checkin'))}</h2>
      <div class="card" style="background:var(--blue-bg);border-color:var(--blue-line)"><div class="spread"><small class="muted" style="font-size:13px">${EN()?'Drop-off / pick-up buttons are on the Home page (on each child’s card).':'ปุ่มส่งเข้าเรียน / รับกลับ อยู่ที่หน้าหลัก (บนการ์ดของบุตรหลานแต่ละคน)'}</small><button class="btn sm" onclick="GO('home')">🏠 ${EN()?'Home':'ไปหน้าหลัก'}</button></div></div>
      ${childSwitcher(kids, sid, 'P_ciHist')}
      <div class="card"><div class="spread"><h3>🗓️ ${EN()?'Drop-off / pick-up history':'ประวัติการรับ-ส่ง'}</h3>
        <span><b>${esc(dispNick(kid))}</b> <small class="muted">${esc(kid.Class||'')}</small></span></div>
        <div id="ciHist"><div class="card muted">${EN()?'Loading…':'กำลังโหลด…'}</div></div></div>`;
    let hist=[]; try{ hist=await api('studentCheckinHistory',{studentId:sid})||[]; }catch(e){ err(e); return; }
    setHTML('#ciHist', hist.map(h=>`<div class="list-item"><span>${esc(ddmmyyyy(h.Date))}</span><span><span class="pill ok">↓ ${esc(h.InTime||'--:--')}</span> <span class="pill info">↑ ${esc(h.OutTime||'--:--')}</span></span></div>`).join('')||`<small class="muted">${EN()?'no history yet':'ยังไม่มีประวัติ'}</small>`);
  };
  let P_TYPE='IN'; window.P_type=t=>{P_TYPE=t;$('#tIN').classList.toggle('active',t==='IN');$('#tOUT').classList.toggle('active',t==='OUT');};
  // real device geolocation → {lat,lng}. Backend enforces the school geofence (OUT_OF_RANGE).
  // `acc` is the phone's OWN margin of error in metres, and the server needs it: a ±60 m fix at the
  // school gate is not evidence that anyone is outside a 30 m fence. Sending it is what lets the
  // server ask "could they be inside?" instead of trusting the dot.
  function getPosition(){ return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){ reject(new Error(EN()?'This device does not support GPS':'อุปกรณ์นี้ไม่รองรับ GPS')); return; }
    navigator.geolocation.getCurrentPosition(
      pos=>resolve({lat:pos.coords.latitude,lng:pos.coords.longitude,acc:Math.round(pos.coords.accuracy)||0}),
      e=>reject(new Error(EN()?'Cannot get your location — please allow location access and try again':'ระบุตำแหน่งไม่ได้ — กรุณาอนุญาตการเข้าถึงตำแหน่ง แล้วลองใหม่')),
      {enableHighAccuracy:true,timeout:10000,maximumAge:0}); }); }
  window.P_do=async(btn)=>{ const studentId=$('#kid').value; P_TYPE=P_TYPE; return P_punch(studentId,P_TYPE,btn); };
  // one-tap check-in/out from the home kid card (or checkin screen): read GPS → parentCheckin directly
  window.P_punch=async(studentId,type,btn)=>{ if(btn)btn.disabled=true; const done=()=>{ if(btn)btn.disabled=false; };
    try{ let lat=null,lng=null,acc=0;
      // Check-in works from ANYWHERE — GPS is optional (tolerate denial). Check-out still needs a location (school enforces the radius).
      if(type==='OUT'){ ({lat,lng,acc}=await getPosition()); }
      else { try{ ({lat,lng,acc}=await getPosition()); }catch(e){ lat=null; lng=null; acc=0; } }
      const r=await api('parentCheckin',{parentId:USER.parentId,uid:USER.uid,studentId,type,lat,lng,acc});
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
      <p>${o.note?`<span class="muted" style="font-size:13px">${esc(o.note)}</span><br>`:''}<b>${esc(t('c.total'))} ${baht(o.amount)} ${esc(EN()?'THB':'บาท')}</b></p>
      ${o.extra||''}
      <button class="btn outline block" style="margin-top:8px" onclick="SAVE_IMG('${esc(qr)}','${esc(o.imgName||'qr.png')}')">💾 ${esc(t('lbl.saveQR'))}</button>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button></div>`); }
  window.QR_PH=(img)=>{ const d=document.createElement('div'); d.className='qr-ph'; img.replaceWith(d); };
  window.ZOOM_IMG=(url)=>{ if(!url)return; const m=document.createElement('div'); m.className='modal imgzoom'; m.innerHTML=`<img src="${esc(url)}" alt="QR"/>`; m.onclick=()=>m.remove(); document.body.appendChild(m); };
  window.SAVE_IMG=(url,name)=>{ if(!url){toast(EN()?'No QR image set yet (add it in config)':'ยังไม่ได้ตั้งรูป QR (เพิ่มใน config)');return;} const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); toast(EN()?'Saved '+name:'บันทึกรูปแล้ว'); };

  // ---- slip history rendering (shared parent + admin) ----
  /**
   * What SlipOK said about a slip. A "NO:<code>" is a VERDICT, not a failure to read — SlipOK read
   * the slip fine (that is where the reference, the receiver and the transfer time come from) and
   * then objected to something specific. Saying only "ตรวจไม่ผ่าน" left the admin with no idea what
   * to do about it, so each code now explains itself.
   */
  const SLIPOK_CODES = {
    '1011': [EN2=>EN2?'No such transaction at the bank':'ธนาคารไม่พบรายการโอนนี้', 'bad'],
    '1012': [EN2=>EN2?'This slip was already used':'สลิปนี้เคยถูกใช้แล้ว (ส่งซ้ำ)', 'wait'],
    '1013': [EN2=>EN2?'Amount differs from the bill':'ยอดในสลิปไม่ตรงกับยอดที่แจ้ง', 'wait'],
    '1014': [EN2=>EN2?'Paid into a different account':'โอนเข้าบัญชีอื่น ไม่ใช่บัญชีโรงเรียน', 'bad'],
  };
  function slipVerInfo(v){ v=String(v||'');
    if(v.slice(0,3)==='YES') return {cls:'ok', icon:'✓', text:EN()?'verified':'สลิปแท้', why:''};
    if(v==='MANUAL') return {cls:'ok', icon:'✓', text:EN()?'recorded by admin':'แอดมินบันทึกเอง', why:''};
    if(v.slice(0,2)==='NO'){ const code=v.slice(3).trim(); const hit=SLIPOK_CODES[code];
      return hit ? {cls:hit[1], icon:'⚠', text:hit[0](EN()), why:code}
                 : {cls:'bad', icon:'⚠', text:EN()?'not verified':'ตรวจไม่ผ่าน', why:code}; }
    return {cls:'info', icon:'', text:EN()?'not checked':'ยังไม่ตรวจ', why:''}; }
  function slipVerBadge(v){ const i=slipVerInfo(v);
    return `<span class="pill ${i.cls}" style="font-size:11px"${i.why?` title="SlipOK ${esc(i.why)}"`:''}>${i.icon?i.icon+' ':''}${esc(i.text)}</span>`; }
  function slipStatusPill(s){ const c={SUBMITTED:'wait',CONFIRMED:'ok',PARTIAL:'wait',REJECTED:'bad'}[s]||'info'; const lbl={SUBMITTED:EN()?'pending':'รอตรวจ',CONFIRMED:EN()?'confirmed':'ยืนยันแล้ว',REJECTED:EN()?'rejected':'ปฏิเสธ'}[s]||s; return `<span class="pill ${c}" style="font-size:11px">${esc(lbl)}</span>`; }
  function slipThumb(url){ return url?`<img src="${esc(url)}" alt="slip" style="width:46px;height:46px;object-fit:cover;border-radius:6px;border:1px solid var(--line);cursor:zoom-in" onclick="ZOOM_IMG('${esc(url)}')" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'pill info',textContent:'📎',style:'font-size:11px'}))"/>`:`<span class="pill info" style="font-size:13px">📎</span>`; }
  // Payments recorded by an Admin (cash, or a transfer already seen in the bank) have no image, so the
  // 📎 slip thumbnail read as "a slip that failed to load". They get a 💵 and their note instead.
  const isCashRow = s => String(s.Method||'')==='cash' || (!s.Url && String(s.Verified||'')==='MANUAL');
  /**
   * When the money MOVED, taken off the slip by SlipOK — not when the file happened to be attached.
   * Those are different moments (a parent often transfers at night and uploads the next morning), and
   * the upload time is the one nobody cares about. Falls back to the upload time, clearly labelled,
   * when SlipOK could not read a transfer time.
   */
  /**
   * When the money moved — and how sure we are of it.
   * 1. read off the slip by SlipOK: a bank fact
   * 2. otherwise what the parent typed: their own word, and labelled as such so nobody mistakes it
   *    for verified
   * 3. otherwise all we ever had — the moment the file was attached
   */
  function slipWhen(s){
    const d=String(s.TransDate||'').slice(0,10), tm=String(s.TransTime||'').slice(0,5);
    if(d) return `<b>${esc(fullDate(d))}${tm?' · '+esc(tm)+' '+(EN()?'':'น.'):''}</b> <span class="muted">${EN()?'transferred (from the slip)':'เวลาที่โอน (อ่านจากสลิป)'}</span>`;
    const sd=String(s.StatedDate||'').slice(0,10), stm=String(s.StatedTime||'').slice(0,5);
    if(sd) return `<b>${esc(fullDate(sd))}${stm?' · '+esc(stm)+' '+(EN()?'':'น.'):''}</b> <span class="muted">${EN()?'transferred (stated by the parent)':'เวลาที่โอน (ผู้ปกครองแจ้ง)'}</span>`;
    const sub=String(s.SubmittedDate||'').slice(0,16);
    return `<span class="muted">${esc(sub)} ${EN()?'(uploaded — no transfer time given)':'(เวลาที่แนบไฟล์ — ไม่มีข้อมูลเวลาโอน)'}</span>`;
  }
  function slipHistoryHTML(slips, canDelete){ if(!slips||!slips.length)return '';
    const anySlip=slips.some(s=>!isCashRow(s));
    return `<div style="margin-top:8px"><small class="muted">${anySlip?`📎 ${EN()?'Submitted slips':'สลิปที่ส่งมา'}`:`💵 ${EN()?'Payments received':'การรับชำระ'}`}</small>${slips.map(s=>{
      const cash=isCashRow(s);
      // an empty row (no image at all) is a double-tap or a mistaken cash entry — the admin can bin it.
      // A row WITH a slip is evidence: reject it instead, which keeps the image and the trail.
      const del = canDelete && !s.Url ? `<button class="btn sm pink" onclick="A_delSlip('${esc(s.SlipID)}',this)" aria-label="${EN()?'Delete':'ลบ'}" title="${EN()?'Delete this empty entry':'ลบรายการที่ไม่มีสลิป'}">🗑️</button>` : '';
      return `<div class="list-item" style="gap:8px;align-items:center">${cash?`<span class="pill ok" style="font-size:13px">💵</span>`:slipThumb(s.Url)}<span style="flex:1"><b>${baht(s.Amount)}</b> ${slipStatusPill(s.Status)} ${slipVerBadge(s.Verified)}${s.SlipGroup?` <span class="pill info" style="font-size:11px" title="${esc(s.SlipGroup)}">🔗 ${EN()?'combined':'สลิปรวมหลายคน'}</span>`:''}${cash&&s.TransRef?`<br><small class="muted">${esc(s.TransRef)}</small>`:''}${!cash&&s.TransRef?`<br><small class="muted">${EN()?'ref':'เลขอ้างอิง'} ${esc(s.TransRef)}</small>`:''}${s.Sender?`<br><small class="muted">${EN()?'from':'จาก'} ${esc(s.Sender)}</small>`:''}${s.Receiver?`<br><small class="muted">→ ${esc(s.Receiver)}</small>`:''}<br><small>${slipWhen(s)}</small></span>${del}</div>`;
    }).join('')}</div>`; }
  window.A_delSlip=async(slipId,btn)=>{ if(!confirm(EN()?'Delete this empty payment entry? The balance is recalculated.':'ลบรายการรับชำระที่ไม่มีสลิปนี้? ระบบจะคำนวณยอดค้างใหม่'))return;
    const sid=window._FIN_SID;
    try{ await api('deleteSlip',{slipId,staffId:USER.staffId}); toast(EN()?'Deleted':'ลบแล้ว'); if(sid) _finReopen(sid); }catch(e){err(e);} };

  window._PAY_KIDS=[];
  SCREENS.Parent.payment = async () => {
    const kids=await api('parentChildren',parentScope()); if(!kids.length){GO('home');return;}
    window._PAY_KIDS=kids; window._PAY_SID=kids[0].StudentID;
    // one tab per child so a parent with >1 child can see EACH child's bills (not just the first)
    const switcher = kids.length>1 ? `<div class="seg" id="paySeg" style="margin-bottom:8px">${kids.map((k,i)=>`<button class="${i===0?'active':''}" onclick="P_paySel(${i})">${esc(dispNick(k))}</button>`).join('')}</div>` : '';
    const logBtn = `<div class="row" style="margin-bottom:8px"><button class="btn sm outline block" onclick="A_payLog()">🧾 ${EN()?'My payment history':'ประวัติการชำระเงินของฉัน'}</button></div>`;
    // The pick-and-pay list is the FIRST thing on this screen now. It used to be a button that
    // opened a dialog, so the main action of the page was hidden behind an extra tap.
    app.innerHTML = `<h2 class="page">${esc(t('title.payment'))}${kids.length===1?` · <span style="color:var(--blue)">${esc(dispNick(kids[0]))}</span>`:''}</h2>
      <div id="payPick"><div class="card muted">${EN()?'Loading…':'กำลังโหลด…'}</div></div>${logBtn}${switcher}
      <div id="payBody"><div class="card muted">${EN()?'Loading…':'กำลังโหลด…'}</div></div>`;
    P_pickRender();
    P_paySel(0);
  };
  // render the payment section for the selected child (index into _PAY_KIDS)
  window.P_paySel=async(i)=>{ const kids=window._PAY_KIDS||[]; const k=kids[i]; if(!k)return; window._PAY_SID=k.StudentID;
    const seg=document.getElementById('paySeg'); if(seg)[...seg.children].forEach((b,j)=>b.classList.toggle('active',j===i));
    setHTML('#payBody', await P_payChildHTML(k)); window.scrollTo(0,0); };
  async function P_payChildHTML(kid){ const sid=kid.StudentID;
    const [ps, ot, pre, allSlips, charges, plans, qr] = await Promise.all([api('payments',{studentId:sid}), api('otDaily',{studentId:sid}), api('prepayments',{studentId:sid}), api('paymentSlips',{studentId:sid}), api('studentCharges',{studentId:sid}), api('getPlans').catch(()=>[]), api('getQRCodes').catch(()=>({qrs:[],otQrId:''}))]);
    // resolve the bank QR bound to THIS child's package (tuition) and to OT — so money goes to the right account
    const _qrs=(qr&&qr.qrs)||[]; const _plan=(plans||[]).find(p=>p.id===kid.Plan)||{}; const _img=id=>{ const q=_qrs.find(x=>x.id===id); return q?q.image:''; };
    window._PAYQR={ bill:_img(_plan.qrId)||MOCK.config.QRCode_Monthly||MOCK.config.QRCode, ot:_img(qr&&qr.otQrId)||MOCK.config.QRCode_OT };
    const slipsOf=(kind,id)=>(allSlips||[]).filter(s=>s.RefKind===kind&&s.RefID===id);
    const per=EN()?'Period ':'งวด ';
    const verifyPill=`<span class="pill wait">${esc(t('pay.pendingVerify'))}</span>`;
    const preShow=pre.filter(p=>p.Status!=='UNPAID'); // in-progress / paid only; the discount options live behind the button
    const preHtml=`<div class="card"><div class="spread"><h3>💰 ${esc(t('prepay.title'))}</h3><button class="btn sm" onclick="P_prepay('${sid}')">💰 ${esc(t('prepay.pay'))}</button></div>
      <p class="muted" style="font-size:13px">${EN()?'Pay several months ahead for a discount — tap the button to see the options.':'จ่ายล่วงหน้าหลายเดือนรับส่วนลด — กดปุ่มเพื่อดูตัวเลือก'}</p>
      ${preShow.length?preShow.map(p=>{ const paid=p.Status==='PAID',partial=p.Status==='PARTIAL'; const sl=slipsOf('prepay',p.PrepayID); const pend=sl.some(s=>s.Status==='SUBMITTED');
        return `<div style="border-bottom:1px solid var(--surface-3);padding:4px 0"><div class="list-item"><span>${esc(t('prepay.months').replace('{n}',p.Months))} <span class="pill ok">-${p.Discount}%</span> <small class="muted">${esc(p.Covered[0])}→${esc(p.Covered[p.Covered.length-1])}</small></span>
        <span><b>${baht(p.Amount)}</b> ${paid?`<span class="pill ok">${esc(t('prepay.paidAhead'))}</span>`:partial?`<span class="pill wait">${EN()?'partial':'บางส่วน'}</span>`:pend?verifyPill:''} ${paid?'':`<button class="btn sm" onclick="P_pay('prepay','${p.PrepayID}',${p.Amount})">${pend||partial?'📎':'💳'} ${esc(t('lbl.pay'))}</button>`}</span></div>${slipHistoryHTML(sl)}</div>`; }).join(''):''}</div>`;
    const otOpen=ot.filter(o=>o.Status!=='PAID'&&o.Status!=='PENDING_VERIFY'&&o.Status!=='PARTIAL');
    const otHtml = ot.length?`<div class="card"><h3>⏰ ${esc(t('ot.daily'))}</h3>
      ${ot.map(o=>{ const paid=o.Status==='PAID',partial=o.Status==='PARTIAL'; const sl=slipsOf('ot',o.OTID); const pend=sl.some(s=>s.Status==='SUBMITTED'); return `<div style="border-bottom:1px solid var(--surface-3);padding:4px 0"><div class="list-item"><span>${esc(ddmmyyyy(o.Date))} · ${esc(o.PickupTime)} <small class="muted">(${EN()?'late':'สาย'} ${o.LateMinutes}${esc(t('lbl.min'))} · ${o.Hours}${EN()?'h':'ชม.'})</small></span>
        <span><b>${baht(o.Amount)}</b> ${paid?`<span class="pill ok">${esc(t('s.paid'))}</span>`:partial?`<span class="pill wait">${EN()?'partial':'บางส่วน'}</span>`:pend?verifyPill:''} ${paid?'':`<button class="btn sm" onclick="P_pay('ot','${o.OTID}',${o.Amount})">${pend||partial?'📎':'💳'} ${esc(t('lbl.pay'))}</button>`}</span></div>${slipHistoryHTML(sl)}</div>`; }).join('')}
      ${otOpen.length?`<div class="spread" style="margin-top:8px"><b>${esc(t('ot.unpaidTotal'))}</b><b style="color:var(--bad)">${baht(otOpen.reduce((a,o)=>a+o.Amount,0))}</b></div><small class="muted">${esc(t('ot.rollNote'))}</small>`:''}</div>`:'';
    // extra charges — each is its own payable item (ค่ากิจกรรม/ค่าพิเศษ ฯลฯ) paid separately from tuition
    const chHtml = (charges&&charges.length)?`<div class="card"><h3>➕ ${EN()?'Extra charges':'ค่าใช้จ่ายเพิ่มเติม'}</h3>
      ${charges.map(c=>{ const paid=c.Status==='PAID',partial=c.Status==='PARTIAL'; const sl=slipsOf('charge',c.ChargeID); const pend=sl.some(s=>s.Status==='SUBMITTED'); return `<div style="border-bottom:1px solid var(--surface-3);padding:4px 0"><div class="list-item"><span>${esc(c.Label)} <small class="muted">${esc(monthNameYear(c.Month))}</small></span>
        <span><b>${baht(c.Amount)}</b> ${paid?`<span class="pill ok">${esc(t('s.paid'))}</span>`:partial?`<span class="pill wait">${EN()?'partial':'บางส่วน'}</span>`:pend?verifyPill:''} ${paid?'':`<button class="btn sm" onclick="P_pay('charge','${c.ChargeID}',${c.Outstanding!=null?c.Outstanding:c.Amount})">${pend||partial?'📎':'💳'} ${esc(t('lbl.pay'))}</button>`}</span></div>${slipHistoryHTML(sl)}</div>`; }).join('')}</div>`:'';
    const kidHead = window._PAY_KIDS.length>1 ? `<div class="card" style="background:var(--surface-2);padding:8px"><b>👶 ${esc(dispNick(kid))}</b> <small class="muted">${esc(nm(kid))} · ${esc(kid.Class||'')}</small></div>` : '';
    return `${kidHead}${preHtml}${chHtml}${otHtml}${ps.map(b=>{
      const paid=b.Status==='PAID',partial=b.Status==='PARTIAL'; const due=b.TotalDue!=null?b.TotalDue:b.Amount;
      // A month covered by an advance payment carries a PrepaidTuition credit. VerifiedStatus==='PREPAID'
      // is the older marker and is no longer written (advance payment covers tuition only), so relying on
      // it alone made a fully prepaid month read as an ordinary "ชำระแล้ว" with no explanation.
      const prepaidCredit=Number(b.PrepaidTuition||0);
      const prepaid=b.VerifiedStatus==='PREPAID'||prepaidCredit>0;
      const confirmed=Number(b.PaidConfirmed||0); const outstanding=b.Outstanding!=null?Number(b.Outstanding):Math.max(0,due-confirmed);
      const billSlips=slipsOf('bill',b.BillingID); const hasPending=billSlips.some(s=>s.Status==='SUBMITTED');
      const topUp = outstanding>0?outstanding:due;
      const statusPill = prepaid?`<span class="pill ok">${esc(t('prepay.paidAhead'))}</span>`
        : paid?`<span class="pill ok">${esc(tStat('PAID'))}</span>`
        : partial?`<span class="pill wait">${EN()?'Partially paid':'ชำระบางส่วน'}</span>`
        : hasPending?`<span class="pill wait">${esc(t('pay.pendingVerify'))}</span>`
        : `<span class="pill bad">${esc(tStat(b.Status))}</span>`;
      return `<div class="card"><div class="spread"><b>${per}${esc(monthNameYear(b.Month))}</b>${statusPill}</div>
      <table style="width:100%;font-size:14px;margin:8px 0">${b.Items.map(it=>`<tr><td>${esc(trItem(it[0]))}</td><td style="text-align:right">${baht(it[1])}</td></tr>`).join('')}
      ${b.OTRollover?`<tr><td>${esc(t('ot.rollover'))}</td><td style="text-align:right">${baht(b.OTRollover)}</td></tr>`:''}
      <tr style="border-top:1px solid var(--line)"><td><b>${esc(t('c.total'))}</b></td><td style="text-align:right"><b>${baht(due)}</b></td></tr>
      ${confirmed>0&&!paid?`<tr><td>${EN()?'Paid':'ชำระแล้ว'}</td><td style="text-align:right;color:var(--ok)">−${baht(confirmed)}</td></tr><tr><td><b>${EN()?'Remaining':'คงค้าง'}</b></td><td style="text-align:right"><b style="color:var(--bad)">${baht(outstanding)}</b></td></tr>`:''}</table>
      ${b.Prepay?`<div class="card" style="background:var(--ok-bg);border-color:var(--ok-line);padding:6px 8px;margin:0 0 6px"><small style="color:var(--ok)">💰 ${esc(prepaySpan(b.Prepay))}</small></div>`:''}
      <small class="muted">${esc(t('c.due'))} ${esc(fullDate(b.DueDate))}${b.PaidDate?' · '+esc(t('c.paid'))+' '+esc(fullDate(b.PaidDate)):''}</small>
      ${slipHistoryHTML(billSlips)}
      ${paid||prepaid?`<div class="row" style="margin-top:10px"><button class="btn sm outline" onclick="P_receipt('${b.BillingID}')">🧾 ${esc(t('pay.receipt'))}</button></div>`
        :`<div class="row" style="margin-top:10px"><button class="btn block" onclick="P_pay('bill','${b.BillingID}',${topUp})">${hasPending||partial?`📎 ${EN()?'Add another slip':'แนบสลิปเพิ่ม'}`:`💳 ${esc(t('lbl.pay'))} ${baht(topUp)}`}</button></div>`}</div>`;
    }).join('')}`;
  }
  // add n months to a 'YYYY-MM'
  function addMonths(m, n){ let [y,mo]=String(m).split('-').map(Number); mo+=n;
    while(mo>12){ mo-=12; y++; } while(mo<1){ mo+=12; y--; }
    return y+'-'+String(mo).padStart(2,'0'); }
  // which months an advance payment of n months starting at `from` covers, in words
  function coverSpan(from, n){ const to=addMonths(from, Math.max(1,n)-1);
    return `${monthNameYear(from)} – ${monthNameYear(to)}`; }

  // Advance-tuition tiers are the SCHOOL's pricing, edited in Admin → แพ็กเกจ / ส่วนลดชำระล่วงหน้า and
  // stored in SCHOOL_CONFIG — they used to be duplicated here as a literal, so the screen and the
  // engine could (and did) disagree. Fetch them, like the monthly price, which comes from
  // studentBillBase so the preview equals the real charge instead of the local MOCK seed.
  window.P_prepay=async(sid)=>{ const [base,tiers]=await Promise.all([api('studentBillBase',{studentId:sid}),api('prepayTiers').catch(()=>[])]);
    const price=Number(base&&base.price||0);
    const label=(EN()?(base&&base.labelEN):(base&&base.labelTH))||planLabel((MOCK.students.find(x=>x.StudentID===sid)||{}).Plan);
    // WHICH months this covers is the parent's to choose. It used to be hard-wired to the current
    // month, so a payment made on the 31st of July covered July — a month already billed — and the
    // cover ran out one month early. Default to NEXT month, which is what "ล่วงหน้า" means, and let
    // them move it.
    const start=addMonths(monthStr(), 1);
    const opt=({months:mo,discount:disc})=>{ const gross=price*mo, amt=Math.round(gross*(100-disc)/100), per=Math.round(amt/mo);
      return `<button class="role-card" data-mo="${mo}" onclick="P_prepayDo('${sid}',${mo})"><span class="ic">${mo}</span><span><b>${esc(t('prepay.months').replace('{n}',mo))} · -${disc}%</b><br><small>${baht(gross)} → <b>${baht(amt)}</b> <span class="muted">(${EN()?'avg':'เฉลี่ย'} ${baht(per)}/${EN()?'mo':'เดือน'})</span></small><br><small class="muted cov" data-mo="${mo}">${esc(coverSpan(start,mo))}</small></span></button>`; };
    const body = price>0 ? (tiers||[]).map(opt).join('')
      : `<div class="card" style="background:var(--warn-bg);border-color:var(--warn-line);color:var(--warn)">⚠️ ${EN()?'This child has no monthly plan price set yet — please ask the admin to set the plan before paying in advance.':'นักเรียนคนนี้ยังไม่ได้ตั้งราคาแผนรายเดือน — กรุณาติดต่อแอดมินให้ตั้งค่าแผนก่อนชำระล่วงหน้า'}</div>`;
    modal(`<h3>💰 ${esc(t('prepay.title'))}</h3><p class="muted" style="font-size:13px">${esc(label)} · ${baht(price)}/${EN()?'mo':'เดือน'}</p>
      ${price>0?`<label class="field"><span>📅 ${EN()?'Starts from the month':'เริ่มมีผลตั้งแต่เดือน'}</span>
        <input type="month" id="ppStart" value="${esc(start)}" onchange="P_prepayCov()"/></label>
        <p class="muted" style="font-size:13px;margin:-2px 2px 8px">${EN()?'The months this payment covers. Months already billed and paid are not covered.':'เดือนที่การชำระนี้จะครอบคลุม · เดือนที่ออกบิลและชำระไปแล้วจะไม่ถูกนับ'}</p>`:''}
      ${body}
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  // keep each tier's "covers …" line in step with the chosen start month
  window.P_prepayCov=()=>{ const el=document.getElementById('ppStart'); if(!el)return; const from=el.value; if(!from)return;
    document.querySelectorAll('.cov').forEach(c=>{ c.textContent=coverSpan(from, Number(c.dataset.mo)||1); }); };
  window.P_prepayDo=async(sid,months)=>{ const el=document.getElementById('ppStart'); const startMonth=(el&&el.value)||undefined;
    try{ const r=await api('prepay',{studentId:sid,months,startMonth}); const m=document.querySelector('.modal'); if(m)m.remove();
    // one-shot: go straight to the QR + attach-slip flow for the chosen plan (no clutter on the payment screen)
    P_payPrepay(r.PrepayID, r.Amount); }catch(e){err(e);} };
  // pay a prepay charge: SCB QR + attach slip (kind 'prepay')
  // ---- ONE way to pay anything -------------------------------------------------------------------
  // Each payable row used to carry its own little cluster of buttons (QR + 📎 แนบสลิป + 💵 เงินสด),
  // so a bill offered three equally-weighted choices before the parent had decided anything. Now every
  // row has a single "ชำระเงิน" button that opens this sheet: the right bank QR, the amount, then the
  // two things you can actually do next.
  // slipKind/cashKind are kept exactly as the two APIs already expect them — note a monthly bill is
  // 'monthly' to P_slip but 'bill' to P_cash; that mismatch is pre-existing and deliberate here.
  const PAY_KIND = {
    bill:   { ic:'📲', title:()=>t('pay.scanMonthly'),                     qr:'bill', slip:'monthly', cash:'bill'   },
    ot:     { ic:'⏰', title:()=>t('ot.title'),                            qr:'ot',   slip:'ot',      cash:'ot'     },
    charge: { ic:'➕', title:()=>EN()?'Extra charge':'ค่าใช้จ่ายเพิ่มเติม', qr:'bill', slip:'charge',  cash:'charge' },
    prepay: { ic:'💰', title:()=>t('prepay.title'),                        qr:'bill', slip:'prepay',  cash:'prepay' },
  };
  const payQR = which => which==='ot'
    ? ((window._PAYQR&&window._PAYQR.ot)||MOCK.config.QRCode_OT)
    : ((window._PAYQR&&window._PAYQR.bill)||MOCK.config.QRCode_Monthly||MOCK.config.QRCode||MOCK.config.PromptPayQR);
  window.P_pay=(kind,id,amt)=>{ const k=PAY_KIND[kind]; if(!k) return;
    qrModalHTML({ title:k.ic+' '+k.title(), amount:amt, img:payQR(k.qr), imgName:kind+'-'+id+'.png',
      extra:`<button class="btn block" onclick="this.closest('.modal').remove();P_slip('${esc(id)}',${amt},'${k.slip}')">${esc(t('lbl.attachSlip'))}</button>
        <button class="btn block gray" style="margin-top:8px" onclick="this.closest('.modal').remove();P_cash('${k.cash}','${esc(id)}',${amt})">💵 ${esc(t('pay.cash'))}</button>` }); };
  // kept as thin aliases: P_prepayDo and any older call sites still reach the same sheet.
  // (prepay now uses the package QR like the rest of tuition — it used to ignore _PAYQR and always
  // fall back to the default config QR, so advance payments could land in the wrong account.)
  window.P_payPrepay=(prepayId,amt)=>P_pay('prepay',prepayId,amt);
  // printable receipt
  window.P_receipt=async(billingId)=>{ const ps=await api('payments',{studentId:window._PAY_SID}); const b=ps.find(x=>x.BillingID===billingId); if(!b)return;
    // use the real linked child (gas mode has no MOCK.students seed → the old lookup gave a blank name)
    const s=(window._PAY_KIDS||[]).find(x=>x.StudentID===b.StudentID)||MOCK.students.find(x=>x.StudentID===b.StudentID)||{}; await ensureLogos(["_LOGO"]); openOrDownload(buildReceiptHTML(b,s),'receipt-'+billingId+'.html'); };
  window.P_qr=(id,amt)=>P_pay('bill',id,amt);
  window.P_payOT=(otId,amt)=>P_pay('ot',otId,amt);
  window.P_payCharge=(chargeId,amt)=>P_pay('charge',chargeId,amt);
  // attach slip + enter the transferred amount → system verifies amount matches before marking paid
  window.P_slip=(id,due,kind)=>{ modal(`<h3>📎 ${esc(t('slip.title'))}</h3><p class="muted" style="font-size:13px">${esc(t('slip.note'))}</p>
    <label class="field"><span>${esc(t('slip.amountDue'))}</span><input id="slipDue" value="${due}" data-due="${due}" disabled style="font-weight:700"/></label>
    <label class="field"><span>${esc(t('slip.file'))}</span><input type="file" id="slipF" accept="image/*" onchange="P_slipDetect(this)"/></label>
    <div style="text-align:center"><img id="slipPrev" alt="" style="max-height:200px;border-radius:8px;border:1px solid var(--line);margin:4px 0;cursor:zoom-in" hidden onclick="ZOOM_IMG(this.src)"/></div>
    <label class="field"><span>${esc(t('slip.amountPaid'))}</span><input id="slipAmt" type="number" inputmode="decimal" placeholder="${esc(t('slip.amountPh'))}"/></label>
    <!-- The system can only ever know when the FILE was attached. When the slip cannot be read
         automatically that is all the school sees, which is not the same as when the money moved —
         so the parent states it. Pre-filled with now, because that is the common case. -->
    <div class="grid2">
      <label class="field"><span>${EN()?'Date transferred':'วันที่โอนจริง'}</span><input type="date" id="slipDate" value="${todayStr()}"/></label>
      <label class="field"><span>${EN()?'Time transferred':'เวลาที่โอน'}</span><input type="time" id="slipTime" value="${nowTime()}"/></label></div>
    <small class="muted" style="display:block;margin:-2px 0 6px">${EN()?'Taken from the slip automatically when it can be read; otherwise what you enter here is used.':'ถ้าระบบอ่านสลิปได้จะใช้เวลาจากสลิป · ถ้าอ่านไม่ได้จะใช้เวลาที่กรอกนี้'}</small>
    <div id="qrDetect" class="muted" style="font-size:13px"></div>
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
    try{ const dataUrl=await slipDataUrl(f);
      const slipBase64=String(dataUrl).split(',')[1]||'';
      const vk=await api('verifySlip', Object.assign(qr?{qrData:qr}:{slipBase64}, {amount:due, log:false})); // log:false = pre-check only, don't consume the slip
      if(vk&&vk.available){
        if(vk.ok && vk.amount!=null){ setAmt(vk.amount); out.innerHTML=`✅ SlipOK ${esc(t('slip.qrMatch'))} ${baht(vk.amount)}${vk.receiver&&vk.receiver.name?` → ${esc(vk.receiver.name)}`:''}`; return; }
        if(vk.code===1013){ if(vk.amount!=null)setAmt(vk.amount); out.innerHTML=`⚠️ SlipOK ${esc(t('slip.qrMismatch'))} ${vk.amount!=null?baht(vk.amount):'?'} / ${baht(due)}`; return; }
        if(vk.code===1014){ if(vk.amount!=null)setAmt(vk.amount); const rcv=vk.receiver&&vk.receiver.name?esc(vk.receiver.name):'';
          out.innerHTML=`⚠️ SlipOK: ${EN()?'the slip receiver':'บัญชีผู้รับในสลิป'}${rcv?` (<b>${rcv}</b>)`:''} ${EN()?"doesn't match the account registered in SlipOK — you can still submit; the admin will verify":'ยังไม่ตรงกับบัญชีที่ลงทะเบียนไว้ใน SlipOK — ส่งได้เลย แอดมินจะตรวจสอบอีกครั้ง'}`; return; }
        if(vk.code===1012){ out.innerHTML=`⚠️ ${EN()?'Duplicate slip (already used)':'สลิปนี้เคยใช้แล้ว (สลิปซ้ำ)'}`; return; }
        // A raw SlipOK message like "Package ของคุณหมดอายุแล้ว" is about the SCHOOL's subscription,
        // not this family's slip — shown as-is it reads like the parent did something wrong.
        if(vk.message){
          const school=/หมดอายุ|expire|สาขา|branch|apikey|api key|quota|โควต/i.test(String(vk.message));
          out.innerHTML = school
            ? `ℹ️ ${EN()?'Automatic slip checking is unavailable at the moment — attach your slip as usual, the school will confirm it.':'ระบบตรวจสลิปอัตโนมัติใช้งานไม่ได้ชั่วคราว — แนบสลิปได้ตามปกติ ทางโรงเรียนจะตรวจสอบให้'}`
            : `ℹ️ SlipOK: ${esc(vk.message)}`; }
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
    const dataUrl=await slipDataUrl(f);
    if(btn)btn.disabled=true;
    // what the parent says about WHEN they transferred — used only when the slip itself cannot be read
    const sd=(m.querySelector('#slipDate')||{}).value||'', st=(m.querySelector('#slipTime')||{}).value||'';
    try{ const args={slipName:f.name,slipAmount:amt,fromQR,slipData:dataUrl,statedDate:sd,statedTime:st}; // slipData → saved to the Drive folder in GAS; SlipOK verifies it
      const r= kind==='teacherOt' ? await api('teacherPayOT',Object.assign({staffId:USER.staffId,otId:id},args))
             : kind==='ot' ? await api('payOT',Object.assign({otId:id},args))
             : kind==='charge' ? await api('payCharge',Object.assign({chargeId:id},args))
             : kind==='prepay' ? await api('payPrepay',Object.assign({prepayId:id},args))
             : await api('uploadSlip',Object.assign({billingId:id},args));
      m.remove();
      const out=Number(r&&r.outstanding||0);
      if(kind==='teacherOt'){ confirmSaved(t('slip.submittedReview')); if(window.T_studentOT) T_studentOT(); }
      else { P_thanks(amt, out); GO('payment'); }
    }catch(e){err(e);} finally{ if(btn)btn.disabled=false; } };
  // A parent has just paid the school. Say thank you properly — this is the one moment in the app
  // where the family has done something for us, and a grey toast was all they got.
  // `method` — 'cash' when the money was handed over at the school, anything else (blank) when a slip
  // was attached. A family who paid in cash was being thanked for a slip they never sent, which reads
  // as though the school did not notice what they actually did. What we PROMISE differs too: a slip is
  // checked, cash has to be confirmed as received.
  window.P_thanks=(amount, outstanding, method)=>{ const out=Number(outstanding||0);
    const cash = String(method||'')==='cash';
    modal(`<div style="text-align:center;padding:4px 2px">
      <div style="font-size:46px;line-height:1.1">🙏</div>
      <h3 style="margin:6px 0 2px">${EN()?'Thank you':'ขอบพระคุณค่ะ'}</h3>
      ${amount?`<div style="font-size:22px;font-weight:700;color:var(--blue);margin:2px 0 6px">${baht(amount)}</div>`:''}
      <p style="font-size:14px;line-height:1.7;margin:0 6px">${
        cash ? (EN()
          ? 'Thank you for paying in cash at the school. We will confirm the amount received in the system as soon as possible. Thank you for trusting us with your child — every day they are with us, we look after them as our own.'
          : 'ขอบพระคุณสำหรับการชำระเป็นเงินสดที่โรงเรียนค่ะ ทางโรงเรียนจะทำการยืนยันยอดเงินสดที่ได้รับในระบบโดยเร็วที่สุดค่ะ<br><br>ขอบพระคุณที่ไว้วางใจให้เราดูแลลูกของคุณ ทุกวันที่น้องอยู่กับเรา เราดูแลเหมือนลูกของเราเองค่ะ 💛')
        : (EN()
          ? 'We have received your slip and will confirm it shortly. Thank you for trusting us with your child — every day they are with us, we look after them as our own.'
          : 'ทางโรงเรียนได้รับสลิปของคุณเรียบร้อยแล้ว และจะตรวจสอบให้โดยเร็วที่สุดค่ะ<br><br>ขอบพระคุณที่ไว้วางใจให้เราดูแลลูกของคุณ ทุกวันที่น้องอยู่กับเรา เราดูแลเหมือนลูกของเราเองค่ะ 💛')}</p>
      ${out>0?`<div class="card" style="background:var(--warn-bg);border-color:var(--warn-line);color:var(--warn);margin-top:10px;padding:8px;font-size:13px">
        ${EN()?`Remaining balance ${baht(out)} — you can attach another slip any time.`:`ยังมียอดค้างอีก ${baht(out)} · แนบสลิปเพิ่มได้ทุกเมื่อค่ะ`}</div>`:''}
      <button class="btn block" style="margin-top:12px" onclick="this.closest('.modal').remove()">${EN()?'You’re welcome':'ยินดีค่ะ'}</button></div>`); };
  // notify a CASH payment — staff confirm + record the payment date afterward
  window.P_cash=(kind,id,amt)=>{ modal(`<div style="text-align:center"><h3>💵 ${esc(t('pay.payCash'))}</h3>
    <p class="muted" style="font-size:13px">${esc(t('pay.cashNote'))}</p>
    <p><b>${esc(t('c.total'))} ${baht(amt)} ${esc(EN()?'THB':'บาท')}</b></p>
    <button class="btn block" onclick="P_cashDo('${kind}','${id}',${amt},this)">${esc(t('c.confirm'))}</button>
    <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button></div>`); };
  window.P_cashDo=async(kind,id,amt,btn)=>{ const m=btn.closest('.modal');
    try{ await api('notifyCash',{kind,id,amount:amt,parentId:USER.parentId,uid:USER.uid}); m.remove();
      toast(t('pay.cashNotified')); P_thanks(amt,0,'cash'); GO('payment'); }catch(e){err(e);} };

  // ---- combined payment: one slip, several items (2-level tick: child → each outstanding item) ----
  // items now include tuition bill + each extra charge + each open OT (item-level ticking).
  let _COMB={items:[],due:0};
  /* ================= pick what to pay, right on the payment screen =========================
   * Everything still owed, grouped per child (nickname first, so a parent with three children can
   * tell at a glance which charge belongs to whom). Tick any combination — one child's tuition, one
   * OT, or the lot — and the total and the QR follow the selection.
   *
   * WHICH QR: the money has to land in the right account, so the QR is chosen by what is ticked:
   *   only OT           -> the OT account
   *   only one child's tuition/charges -> that child's package account
   *   anything mixed    -> the school's main account
   */
  window._PICK={groups:[], items:[], due:0};
  async function P_pickLoad(){
    const kids=window._PAY_KIDS||[];
    const [data,plans,qr] = await Promise.all([
      Promise.all(kids.map(k=>Promise.all([api('payments',{studentId:k.StudentID}),api('studentCharges',{studentId:k.StudentID}),api('otDaily',{studentId:k.StudentID})]))),
      api('getPlans').catch(()=>[]), api('getQRCodes').catch(()=>({qrs:[],otQrId:''}))]);
    const qrs=(qr&&qr.qrs)||[]; const imgOf=id=>{ const q=qrs.find(x=>x.id===id); return q?q.image:''; };
    window._PICKQR={ ot: imgOf(qr&&qr.otQrId)||MOCK.config.QRCode_OT||'',
      school: MOCK.config.QRCode_Monthly||MOCK.config.QRCode||MOCK.config.PromptPayQR||'',
      byKid: {} };
    return kids.map((k,i)=>{ const pv=data[i][0]||[], chs=data[i][1]||[], ot=data[i][2]||[]; const rows=[];
      const plan=(plans||[]).find(p=>p.id===k.Plan)||{};
      window._PICKQR.byKid[k.StudentID]=imgOf(plan.qrId)||window._PICKQR.school;
      pv.forEach(b=>{ const out=Number(b.Outstanding!=null?b.Outstanding:(b.TotalDue!=null?b.TotalDue:b.Amount));
        if(b.Status!=='PAID'&&b.VerifiedStatus!=='PREPAID'&&out>0) rows.push({kind:'bill',id:b.BillingID,label:(EN()?'Tuition ':'ค่าเทอม ')+monthNameYear(b.Month),out}); });
      chs.forEach(c=>{ const out=Number(c.Outstanding!=null?c.Outstanding:c.Amount);
        if(c.Status!=='PAID'&&out>0) rows.push({kind:'charge',id:c.ChargeID,label:c.Label,out}); });
      ot.forEach(o=>{ if(o.Status!=='PAID'&&o.Status!=='PENDING_VERIFY'&&o.Status!=='PARTIAL'&&Number(o.Amount)>0)
        rows.push({kind:'ot',id:o.OTID,label:'OT '+ddmmyyyy(o.Date),out:Number(o.Amount)}); });
      return {kid:k, rows}; }).filter(g=>g.rows.length);
  }
  window.P_pickRender=async()=>{
    let groups=[]; try{ groups=await P_pickLoad(); }catch(e){ setHTML('#payPick',''); return; }
    window._PICK.groups=groups;
    if(!groups.length){ setHTML('#payPick', `<div class="card" style="background:var(--ok-bg);border-color:var(--ok-line)">
      <b style="color:var(--ok)">✅ ${EN()?'Nothing outstanding right now':'ไม่มียอดค้างชำระในขณะนี้'}</b></div>`); return; }
    const multi=(window._PAY_KIDS||[]).length>1;
    const body=groups.map((g,gi)=>`<div class="card" style="padding:8px;margin:6px 0">
      <label class="spread" style="cursor:pointer">
        <span><b style="font-size:16px">${esc(dispNick(g.kid))}</b> <small class="muted">${esc(nm(g.kid))}</small></span>
        <span style="display:flex;align-items:center;gap:6px;font-size:13px" class="muted">${EN()?'all':'ทั้งหมด'}
          <input type="checkbox" class="pickAllKid" data-g="${gi}" checked onchange="P_pickAllKid(${gi},this.checked)" style="width:auto"/></span></label>
      ${g.rows.map((r,ri)=>`<label class="field" style="display:block;background:var(--surface);border-radius:8px;padding:6px;margin:6px 0">
        <span style="display:flex;align-items:center;gap:8px"><input type="checkbox" class="pickCb" data-g="${gi}" data-kind="${esc(r.kind)}" data-id="${esc(r.id)}" data-out="${r.out}" data-sid="${esc(g.kid.StudentID)}" checked onchange="P_pickRecalc()" style="width:auto"/>
          <b>${esc(r.label)}</b> <b style="margin-left:auto;color:var(--blue)">${baht(r.out)}</b></span></label>`).join('')}</div>`).join('');
    setHTML('#payPick', `<div class="card" style="background:var(--blue-bg);border-color:var(--blue-line)">
      <div class="spread"><b>💳 ${EN()?'Choose what to pay':'เลือกรายการที่จะชำระ'}</b>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px" class="muted">${EN()?'select all':'เลือกทั้งหมด'}
          <input type="checkbox" id="pickAll" checked onchange="P_pickAll(this.checked)" style="width:auto"/></label></div>
      <small class="muted">${multi?(EN()?'Split by child. Tick any items — one transfer covers them all.':'แยกตามรายบุคคล · ติ๊กรายการไหนก็ได้ โอนครั้งเดียวจบ')
        :(EN()?'Tick the items you are paying now — one transfer covers them all.':'ติ๊กรายการที่จะจ่ายรอบนี้ · โอนครั้งเดียวจบ')}</small>
      ${body}
      <div class="card" style="background:var(--ok-bg);padding:8px;margin-top:4px"><div class="spread">
        <b>${EN()?'Total to transfer':'ยอดรวมที่ต้องโอน'}</b><b id="pickTotal" style="font-size:20px;color:var(--ok)">฿0</b></div>
        <small class="muted" id="pickQrNote"></small></div>
      <!-- The button used to say "Next: scan the QR and attach a slip". The school takes CASH too,
           and the next screen offers both — naming only one of them told half the families the
           wrong thing about how they are allowed to pay. -->
      <button class="btn block green" id="pickNext" onclick="P_pickPay()">💳 ${EN()?'Pay':'ชำระ'}</button></div>`);
    P_pickRecalc();
  };
  window.P_pickAll=(on)=>{ document.querySelectorAll('.pickCb,.pickAllKid').forEach(c=>c.checked=on); P_pickRecalc(); };
  window.P_pickAllKid=(gi,on)=>{ document.querySelectorAll('.pickCb[data-g="'+gi+'"]').forEach(c=>c.checked=on); P_pickRecalc(); };
  /**
   * Which account this selection should be paid into.
   *
   *   only OT                -> the OT account
   *   anything with a bill   -> the PACKAGE account. A combined payment is still tuition money, so
   *                             it follows the package rather than going to the general account —
   *                             even when an OT is bundled into the same transfer.
   *
   * Two children whose packages point at DIFFERENT accounts is the one case with no right answer:
   * one transfer cannot land in two places. Rather than silently picking one, it falls back to the
   * school account and says so.
   */
  function P_pickQR(items){
    const q=window._PICKQR||{}, byKid=q.byKid||{};
    if(!items.length) return {img:q.school||'', note:''};
    const kinds=[...new Set(items.map(i=>i.kind))];
    if(kinds.length===1 && kinds[0]==='ot')
      return {img:q.ot||q.school||'', note:EN()?'OT account':'บัญชีสำหรับค่า OT'};
    // every package account involved in this selection (OT rows follow whoever they belong to)
    const accts=[...new Set(items.map(i=>byKid[i.sid]||q.school||'').filter(Boolean))];
    if(accts.length===1)
      return {img:accts[0], note:EN()?'the account for this package':'บัญชีตามแพ็กเกจของนักเรียน'};
    return {img:q.school||'', note:EN()?'the school\'s main account (the children\'s packages use different accounts)'
      :'บัญชีหลักของโรงเรียน (แพ็กเกจของนักเรียนแต่ละคนคนละบัญชี)'};
  }
  window.P_pickRecalc=()=>{ const cbs=[...document.querySelectorAll('.pickCb')]; let sum=0; const items=[];
    cbs.forEach(c=>{ if(c.checked){ sum+=Number(c.dataset.out||0); items.push({kind:c.dataset.kind,id:c.dataset.id,sid:c.dataset.sid}); } });
    window._PICK.items=items; window._PICK.due=Math.round(sum);
    const tEl=document.getElementById('pickTotal'); if(tEl)tEl.textContent=baht(window._PICK.due);
    const nx=document.getElementById('pickNext'); if(nx) nx.disabled=!items.length;
    // keep the per-child and master boxes honest about what is actually ticked
    document.querySelectorAll('.pickAllKid').forEach(k=>{ const gi=k.dataset.g;
      const all=[...document.querySelectorAll('.pickCb[data-g="'+gi+'"]')];
      k.checked=all.length>0&&all.every(c=>c.checked); });
    const master=document.getElementById('pickAll'); if(master) master.checked=cbs.length>0&&cbs.every(c=>c.checked);
    const note=document.getElementById('pickQrNote');
    if(note){ const q=P_pickQR(items); note.textContent = items.length&&q.note ? (EN()?'Pay into ':'โอนเข้า')+q.note : ''; }
  };
  /** Show the right QR for the selection, then hand over to the one-slip flow. */
  window.P_pickPay=()=>{ const items=(window._PICK.items||[]);
    if(!items.length){ toast(EN()?'Select at least one item':'เลือกอย่างน้อย 1 รายการ'); return; }
    _COMB={items:items.map(i=>({kind:i.kind,id:i.id})), due:window._PICK.due};
    const q=P_pickQR(items);
    qrModalHTML({ title:'💳 '+(EN()?'Scan to transfer':'สแกนเพื่อโอน'), amount:window._PICK.due,
      img:q.img, imgName:'pay-'+items.length+'.png',
      extra:`${q.note?`<p class="muted" style="font-size:13px;text-align:center">${EN()?'Pay into ':'โอนเข้า'}${esc(q.note)}</p>`:''}
        <button class="btn block green" onclick="this.closest('.modal').remove();P_combinedNext()">📎 ${EN()?'I have transferred — attach slip':'โอนแล้ว — แนบสลิป'}</button>
        <button class="btn block gray" style="margin-top:8px" onclick="this.closest('.modal').remove();P_combinedCash()">💵 ${EN()?'Paid in cash at the school':'ชำระเงินสดที่โรงเรียน'}</button>` });
  };
  /**
   * Cash handed over at the school. The amount is filled in for them and must match, exactly as a
   * transfer must — it is prefilled, not free text, because the point is to confirm the figure, not
   * to negotiate it. The DATE is theirs to set: a parent often tells us on Monday about Friday.
   */
  window.P_combinedCash=()=>{ if(!_COMB.items.length){ toast(EN()?'Select at least one item':'เลือกอย่างน้อย 1 รายการ'); return; }
    const cur=document.querySelector('.modal'); if(cur)cur.remove();
    modal(`<h3>💵 ${EN()?'Paid in cash':'ชำระเงินสด'} · <span style="color:var(--blue)">${_COMB.items.length} ${EN()?'items':'รายการ'}</span></h3>
      <p class="muted" style="font-size:13px">${EN()?'Tell the school you have handed the money over. It is recorded against these items and waits for the school to confirm — you will see it as paid once they do.':'แจ้งโรงเรียนว่าได้ชำระเงินสดแล้ว · ระบบจะบันทึกไว้กับรายการที่เลือก และรอโรงเรียนตรวจสอบ · เมื่อยืนยันแล้วจะขึ้นเป็นชำระแล้ว'}</p>
      <label class="field"><span>${EN()?'Amount paid':'จำนวนเงินที่ชำระ'}</span>
        <input id="cashAmt" type="number" inputmode="decimal" value="${_COMB.due}" data-due="${_COMB.due}" style="font-weight:700"/></label>
      <label class="field"><span>${EN()?'Date paid':'วันที่ชำระ'}</span><input type="date" id="cashDate" value="${todayStr()}" max="${todayStr()}"/></label>
      <small class="muted" style="display:block;margin:-2px 0 8px">${EN()?'The day you handed the money over — not today, if they are different.':'วันที่ยื่นเงินให้โรงเรียนจริง · ถ้าไม่ใช่วันนี้ให้เลือกวันที่จ่ายจริง'}</small>
      <button class="btn block green" onclick="P_combinedCashDo(this)">${EN()?'Confirm cash payment':'ยืนยันการชำระเงินสด'}</button>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`); };
  window.P_combinedCashDo=async(btn)=>{ const m=btn.closest('.modal');
    const amt=Number(m.querySelector('#cashAmt').value||0), date=m.querySelector('#cashDate').value;
    if(!date){ toast(EN()?'Pick the date you paid':'เลือกวันที่ชำระ'); return; }
    // the same hard block as a transfer: cash must not be the way round the amount rule
    if(Math.round(amt)!==Math.round(_COMB.due)){
      toast((EN()?'Amount must be ':'ยอดต้องเท่ากับ ')+baht(_COMB.due)); return; }
    btn.disabled=true;
    // parentScope() so the handler knows whose children these are; on GAS applyIdentity_ overrides
    // it from the session, so it can only ever narrow the scope, never widen it
    try{ const r=await api('payCombinedCash',Object.assign({items:_COMB.items, amount:amt, paidDate:date},parentScope()));
      m.remove();
      confirmSaved(EN()?'Cash payment sent to the school':'แจ้งชำระเงินสดแล้ว — รอโรงเรียนตรวจสอบ');
      P_thanks(r&&r.total||amt,0,'cash'); GO('payment');
    }catch(e){ err(e); btn.disabled=false; } };

  // (the old combined-payment DIALOG lived here. The pick list on the payment screen replaced it;
  //  keeping both would have meant two lists of the same thing drifting apart.)
  window.P_combinedNext=()=>{ if(!_COMB.items.length){ toast(EN()?'Select at least one item':'เลือกอย่างน้อย 1 รายการ'); return; }
    const cur=document.querySelector('.modal'); if(cur)cur.remove();
    modal(`<h3>📎 ${EN()?'Attach one slip':'แนบสลิปเดียว'} · <span style="color:var(--blue)">${_COMB.items.length} ${EN()?'items':'รายการ'}</span></h3>
      <label class="field"><span>${EN()?'Total to transfer':'ยอดที่ต้องโอน'}</span><input id="slipDue" value="${_COMB.due}" data-due="${_COMB.due}" disabled style="font-weight:700"/></label>
      <label class="field"><span>${esc(t('slip.file'))}</span><input type="file" id="slipF" accept="image/*" onchange="P_slipDetect(this)"/></label>
      <div style="text-align:center"><img id="slipPrev" alt="" style="max-height:200px;border-radius:8px;border:1px solid var(--line);margin:4px 0;cursor:zoom-in" hidden onclick="ZOOM_IMG(this.src)"/></div>
      <label class="field"><span>${esc(t('slip.amountPaid'))}</span><input id="slipAmt" type="number" inputmode="decimal" placeholder="${esc(t('slip.amountPh'))}"/></label>
      <!-- The same "when did you actually transfer" fields as the single-item form. They were only
           added there, and this is now the flow almost everyone uses — so in practice nobody was
           being asked, and the school was still left with only the upload time. -->
      <div class="grid2">
        <label class="field"><span>${EN()?'Date transferred':'วันที่โอนจริง'}</span><input type="date" id="slipDate" value="${todayStr()}"/></label>
        <label class="field"><span>${EN()?'Time transferred':'เวลาที่โอน'}</span><input type="time" id="slipTime" value="${nowTime()}"/></label></div>
      <small class="muted" style="display:block;margin:-2px 0 6px">${EN()?'Taken from the slip automatically when it can be read; otherwise what you enter here is used.':'ถ้าระบบอ่านสลิปได้จะใช้เวลาจากสลิป · ถ้าอ่านไม่ได้จะใช้เวลาที่กรอกนี้'}</small>
      <div id="qrDetect" class="muted" style="font-size:13px"></div>
      <button class="btn block green" onclick="P_combinedSlipDo(this)">${esc(t('slip.upload'))}</button>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`); };
  window.P_combinedSlipDo=async(btn)=>{ const m=btn.closest('.modal'); const aEl=m.querySelector('#slipAmt'); const f=m.querySelector('#slipF').files[0]; const amt=Number(aEl.value||0); const fromQR=aEl.dataset.fromqr==='1';
    if(!f){ toast(EN()?'Please choose a slip file':'กรุณาเลือกไฟล์สลิป'); return; }
    if(!amt){ toast(EN()?'Enter the transferred amount':'กรอกยอดที่โอน'); return; }
    // hard block: the transferred amount MUST equal the system total (owner rule) → red overlay
    if(Math.round(amt)!==Math.round(_COMB.due)){
      modal(`<div style="text-align:center;padding:6px"><div style="font-size:40px">⛔</div><h3 style="color:var(--bad)">${EN()?'Amount does not match':'ยอดชำระไม่ตรงกับระบบ'}</h3>
        <p style="font-size:14px">${EN()?'You entered':'คุณกรอก'} <b>${baht(amt)}</b><br>${EN()?'System total':'ยอดรวมในระบบ'} <b style="color:var(--bad)">${baht(_COMB.due)}</b></p>
        <p class="muted" style="font-size:13px">${EN()?'Transfer the exact total, or go back and change which items are ticked.':'กรุณาโอนยอดให้ตรง หรือย้อนกลับไปแก้รายการที่ติ๊ก'}</p>
        <button class="btn block" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button></div>`);
      return; }
    const dataUrl=await slipDataUrl(f);
    if(btn)btn.disabled=true;
    const sd=(m.querySelector('#slipDate')||{}).value||'', st=(m.querySelector('#slipTime')||{}).value||'';
    try{ const r=await api('payCombined',{items:_COMB.items, slipAmount:amt, fromQR, slipName:f.name, slipData:dataUrl, statedDate:sd, statedTime:st});
      m.remove(); toast(EN()?`Slip submitted — ${r.count} items`:`ส่งสลิปแล้ว ${r.count} รายการ`); P_thanks(r.total,0); GO('payment'); }
    catch(e){ err(e); if(btn)btn.disabled=false; } };

  // tabs to switch between linked children on a parent screen (calls fn(otherStudentId))
  function childSwitcher(kids, sid, fn){ if(!kids||kids.length<2)return ''; return `<div class="seg" style="margin-bottom:8px">${kids.map(k=>`<button class="${k.StudentID===sid?'active':''}" onclick="${fn}('${k.StudentID}')">${esc(dispNick(k))}</button>`).join('')}</div>`; }
  SCREENS.Parent.journal = async () => { const kids=await api('parentChildren',parentScope()); if(!kids.length){GO('home');return;} P_journal(kids[0].StudentID); };
  window.P_journal = async (sid) => { setNav('journal');
    // journalInjuries rides in the SAME batch as the journal — an injury the teacher chose to share
    // must appear with the day it belongs to, and not at the cost of another round trip.
    const [kids,j,hist,inj]=await Promise.all([api('parentChildren',parentScope()),api('getJournal',{studentId:sid}),
      api('journalHistory',{studentId:sid}),api('journalInjuries',{studentId:sid}).catch(()=>[])]);
    const kid=(kids||[]).find(k=>k.StudentID===sid)||{};
    app.innerHTML=`<h2 class="page">${esc(t('title.journal'))}${kids.length===1?` · <span style="color:var(--blue)">${esc(dispNick(kid)||sid)}</span>`:''}</h2>${childSwitcher(kids,sid,'P_journal')}${injJournalHTML(inj)}${j?journalChecklist(j,{parentEditable:true}):waitCard()}
      <h3 class="page" style="font-size:16px">ย้อนหลัง</h3>${hist.map(h=>`<div class="list-item"><span>${esc(h.Date)} · ${esc(MOODS[h.Mood]||'')} ${esc(h.Mood||'')}</span><button class="btn sm outline" onclick="P_showJ('${h.StudentID}','${h.Date}')">ดู</button></div>`).join('')||'<small class="muted">ไม่มี</small>'}`;
  };
  window.P_showJ=async(sid,date)=>{ const [j,inj]=await Promise.all([api('getJournal',{studentId:sid,date}),api('journalInjuries',{studentId:sid,date}).catch(()=>[])]);
    app.innerHTML=`<h2 class="page">📒 ${esc(date)}</h2>${injJournalHTML(inj)}${journalChecklist(j,{parentEditable:true})}<button class="btn outline" onclick="GO('journal')">← กลับ</button>`; window.scrollTo(0,0); };
  /**
   * An injury the teacher chose to attach to the journal, in the parents' words rather than the
   * authority's: what happened, the pictures, and what was done. The tick box on the report is the
   * only thing that puts it here — a report kept in the system never reaches this screen.
   */
  function injJournalHTML(list){ if(!list||!list.length) return '';
    return list.map(r=>`<div class="card" style="background:var(--bad-bg);border-color:var(--bad-line)">
      <div class="spread"><b>🚑 ${EN()?'Injury today':'แจ้งการบาดเจ็บ'}</b><small class="muted">${esc(r.time||'')}</small></div>
      <div style="margin-top:4px;font-size:13px">${esc(injTypeNames(r.types))}</div>
      ${r.narrative?`<div style="margin-top:6px;white-space:pre-wrap">${esc(r.narrative)}</div>`:''}
      ${r.treatmentType?`<div class="muted" style="margin-top:6px;font-size:13px">🩺 ${r.treatmentType==='none'?(EN()?'No treatment needed':'ไม่ต้องรับการรักษาใดๆ'):(EN()?'Received treatment':'ได้รับการรักษาพยาบาล')}${r.treatmentBy?' · '+esc(r.treatmentBy):''}</div>`:''}
      ${(r.photos||[]).length?`<div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${r.photos.map(u=>`<img src="${esc(u)}" onclick="IMG_zoom('${esc(u)}')" style="width:88px;height:88px;object-fit:cover;border-radius:8px;cursor:zoom-in"/>`).join('')}</div>`:''}
      <p class="muted" style="font-size:12px;margin:8px 2px 0">${EN()?'Please contact the school if you have any questions.':'หากมีข้อสงสัย กรุณาติดต่อโรงเรียนค่ะ'}</p></div>`).join(''); }

  const DSPM_PILL=r=>{const c=r==='ผ่าน'?'ok':r==='ไม่ผ่าน'?'bad':r==='ยังไม่เข้าโรงเรียน'?'info':'wait';return `<span class="pill ${c}">${esc(tStat(r))}</span>`;};
  const DT_KEY={GM:'dom.GM',FM:'dom.FM',RL:'dom.RL',EL:'dom.EL',PS:'dom.PS'};
  const DT=new Proxy({},{get:(_,k)=>t(DT_KEY[k]||k)});
  // ---- MODULE 1: การเจริญเติบโต (weight/height chart + vaccine) — separate page ----
  SCREENS.Parent.growth = async () => { const kids=await api('parentChildren',parentScope()); if(!kids.length){GO('home');return;} P_growth(kids[0].StudentID); };
  /* ================= Phase 7: what the PARENT sees ==========================================
   * Menu: only their own child's class, resolved server-side so it can never be the wrong one.
   * Survey: a card on the home screen while one is open for them, answerable in one tap.
   */
  // P_menu (the parent's own copy of the monthly menu) was removed on the owner's call: the day's
  // meals are already on the child's daily journal, which is what the family actually reads — a
  // second place showing the PLAN could only ever disagree with the record.
  window.P_survey = async (id) => {
    const list = await api('openSurveys', parentScope(), {fresh:true});
    // with no id, offer something they have NOT answered yet rather than reopening an old answer
    const s = list.find(x=>x.surveyId===id) || list.find(x=>!x.answered) || list[0];
    if(!s){ toast(EN()?'No survey open':'ยังไม่มีแบบสอบถาม'); return; }
    // one block per question; a survey with a single question looks exactly as it did before
    const qs = (s.questions&&s.questions.length) ? s.questions : [{text:s.title,type:s.type,options:s.options||[]}];
    const prev = s.myAnswers || (s.myAnswer?[s.myAnswer]:[]);
    window.__SVA = qs.map((q,i)=>Number((prev[i]||{}).rating)||0);
    const block=(q,i)=>{ const a=prev[i]||{};
      const faces = q.type==='rating' ? `<div class="row" style="justify-content:space-between;margin:8px 0">${
        SV_FACE.map((f,n)=>`<button type="button" class="btn outline" id="svf${i}_${n+1}" style="flex:1;font-size:26px;padding:8px 0${a.rating===n+1?';border-color:var(--brand);background:var(--brand-soft)':''}" onclick="P_svPick(${i},${n+1})">${f}</button>`).join('')}</div>
        <div style="text-align:center" class="muted"><small>${EN()?'1 = not happy · 5 = very happy':'1 = ไม่พอใจ · 5 = พอใจมาก'}</small></div>` : '';
      const votes = q.type==='vote' ? `<div style="margin:6px 0">${(q.options||[]).map(o=>
        `<label class="field" style="display:flex;align-items:center;gap:8px"><input type="radio" name="svv${i}" value="${esc(o)}" style="width:auto" ${a.choice===o?'checked':''}/> ${esc(o)}</label>`).join('')}</div>` : '';
      return `<div class="card" style="padding:10px;margin:8px 0">
        <b>${qs.length>1?`${i+1}. `:''}${esc(q.text)}</b>
        ${faces}${votes}
        <label class="field" style="margin-top:4px"><span>${q.type==='comment'?(EN()?'Your comment':'ความคิดเห็นของคุณ'):(EN()?'Anything to add? (optional)':'อยากบอกอะไรเพิ่มไหม (ถ้ามี)')}</span><textarea id="svC${i}" rows="2">${esc(a.comment||'')}</textarea></label></div>`; };
    modal(`<h3>💬 ${esc(s.title)}</h3>
      ${s.description?`<p class="muted" style="font-size:14px">${esc(s.description)}</p>`:''}
      ${s.anonymous?`<p class="muted" style="font-size:13px">🕶️ ${EN()?'Anonymous — the school will not see who answered.':'ไม่ระบุชื่อ — โรงเรียนจะไม่เห็นว่าใครตอบ'}</p>`:''}
      ${qs.length>1?`<p class="muted" style="font-size:13px">${EN()?`${qs.length} questions — it takes about a minute.`:`มี ${qs.length} ข้อ · ใช้เวลาประมาณ 1 นาที`}</p>`:''}
      <div style="max-height:56vh;overflow:auto">${qs.map(block).join('')}</div>
      ${s.answered?`<p class="muted" style="font-size:13px">✅ ${EN()?'You already answered — saving again updates your answer.':'คุณตอบไปแล้ว — บันทึกอีกครั้งจะเป็นการแก้ไขคำตอบเดิม'}</p>`:''}
      <button class="btn block" onclick="P_svSend('${esc(s.surveyId)}',${qs.length},this)">${s.answered?(EN()?'Update my answer':'แก้ไขคำตอบ'):(EN()?'Send':'ส่งคำตอบ')}</button>`);
  };
  window.P_svPick=(qi,n)=>{ (window.__SVA=window.__SVA||[])[qi]=n;
    for(let i=1;i<=5;i++){ const b=document.getElementById('svf'+qi+'_'+i); if(!b)continue;
      b.style.borderColor = i===n?'var(--brand)':''; b.style.background = i===n?'var(--brand-soft)':''; } };
  window.P_svSend=async(id,nq,btn)=>{ const m=btn.closest('.modal');
    const answers=Array.from({length:nq||1},(_,i)=>({
      rating:(window.__SVA||[])[i]||0,
      choice:(m.querySelector('input[name=svv'+i+']:checked')||{}).value||'',
      comment:(m.querySelector('#svC'+i)||{}).value||'' }));
    if(btn)btn.disabled=true;
    try{ const r=await api('submitSurvey',Object.assign({},parentScope(),{surveyId:id,answers}));
      m.remove(); confirmSaved(r.updated?(EN()?'Answer updated — thank you':'แก้ไขคำตอบแล้ว ขอบคุณค่ะ'):(EN()?'Thank you!':'ขอบคุณสำหรับความคิดเห็นค่ะ 🙏'));
      GO('home');
    }catch(e){err(e); if(btn)btn.disabled=false;} };

  window.P_growth = async (sid) => { setNav('growth');
    const [rg,rvs,rvr,rk]=await Promise.allSettled([
      api('growthHistory',{studentId:sid}),api('vaccineSchedule'),api('studentVaccines',{studentId:sid}),api('parentChildren',parentScope())]);
    const kidsD=rk.status==='fulfilled'?rk.value:[];
    const st=(kidsD||[]).find(k=>k.StudentID===sid)||MOCK.students.find(x=>x.StudentID===sid)||{};
    const g=rg.status==='fulfilled'?rg.value:{records:[]};
    const vsched=rvs.status==='fulfilled'?rvs.value:[]; const vrecs=rvr.status==='fulfilled'?rvr.value:[];
    app.innerHTML=`<h2 class="page">📈 ${EN()?'Growth':'การเจริญเติบโต'}${(kidsD&&kidsD.length>1)?'':` · <span style="color:var(--blue)">${esc(dispNick(st)||sid)}</span>`}</h2>${childSwitcher(kidsD,sid,'P_growth')}
      <div class="card"><h3>📈 ${esc(t('growth.chartTitle'))}</h3><p class="muted" style="font-size:13px">${esc(t('growth.chartSub'))}</p>
        ${growthChartSVG(t('growth.weight'),g.records.map(r=>({x:r.AgeMonth,y:r.Weight})),gBand(g.weightBand,g.gender,g.records,'weight'),'kg')}
        ${growthChartSVG(t('growth.height'),g.records.map(r=>({x:r.AgeMonth,y:r.Height})),gBand(g.heightBand,g.gender,g.records,'height'),'cm')}
        <div class="row" style="font-size:13px;justify-content:center;margin-top:6px"><span>🟦 ${esc(t('growth.actual'))}</span><span>🟩 ${esc(t('growth.normalBand'))}</span></div>
        ${growthRecordsList(g.records)}</div>
      ${reportButtons(sid)}
      ${vaccineCard(vsched,vrecs,sid,true)}`;
  };
  // ---- MODULE 2: DSPM assessment only — separate page ----
  SCREENS.Parent.dspm = async () => { const kids=await api('parentChildren',parentScope()); if(!kids.length){GO('home');return;} P_dspm(kids[0].StudentID); };
  window.P_dspm = async (sid) => { setNav('dspm');
    // the age-band assessment may be absent (no DSPM_CRITERIA for this age) — allSettled so it never blanks
    const [rs,rall,rk]=await Promise.allSettled([
      api('dspmStatus',{studentId:sid}),api('studentAllBands',{studentId:sid}),api('parentChildren',parentScope())]);
    const kidsD=rk.status==='fulfilled'?rk.value:[];
    const st=(kidsD||[]).find(k=>k.StudentID===sid)||MOCK.students.find(x=>x.StudentID===sid)||{};
    const s=rs.status==='fulfilled'?rs.value:null;            // NO_CRITERIA for this age → null
    const all=rall.status==='fulfilled'?rall.value:{bands:[]};
    const ageMo = (window.AGEMONTHS&&st.DOB)?window.AGEMONTHS(st.DOB):(s?s.ageMonth:'');
    const past=(all.bands||[]).filter(b=>!s||b.label!==s.ageLabel);
    const itemRow=i=>`<div class="list-item"><span><b>ข้อ ${i.itemNo}</b> <span class="pill info">${i.skill}</span> · ${DT[i.skill]||''}<br><small>${esc(EN()&&i.descriptionEN?i.descriptionEN:i.description)}</small></span>${DSPM_PILL(i.result)}</div>`;
    const assessCard = s
      ? `<div class="card"><div class="spread"><b>${esc(dispNick(st)||sid)}</b><span class="muted">${esc(ageYMfromMonths(s.ageMonth))} (${s.ageMonth} ${EN()?'mo':'เดือน'})</span></div>
          <div class="spread"><b style="color:var(--blue)">⭐ ${EN()?'Current age band':'ช่วงวัยปัจจุบัน'}: ${esc(ageBandLabel(s.ageLabel))}</b></div>
          <p class="muted" style="font-size:13px">${EN()?'Every item for this age band is listed; anything not assessed yet shows as "Not tested".':'แสดงทุกข้อของช่วงวัยนี้ ที่ยังไม่ประเมินจะขึ้น "ยังไม่ได้รับการทดสอบ"'}</p>
          ${s.manualUrl?`<a class="btn sm outline" href="${esc(s.manualUrl)}" target="_blank">⬇️ ดาวน์โหลดคู่มือ DSPM</a>`:''}
          ${s.items.map(itemRow).join('')}</div>`
      : `<div class="card"><div class="spread"><b>${esc(dispNick(st)||sid)}</b><span class="muted">${esc(ageYMfromMonths(ageMo))} (${ageMo} ${EN()?'mo':'เดือน'})</span></div>
          <p class="muted" style="font-size:13px">ℹ️ ยังไม่มีเกณฑ์ประเมินพัฒนาการสำหรับช่วงวัยนี้ (อายุ ${ageMo} เดือน) — เมื่อโรงเรียนเพิ่มเกณฑ์ตามคู่มือ DSPM ของช่วงวัยนี้แล้ว รายการประเมินจะแสดงที่นี่</p></div>`;
    app.innerHTML=`<h2 class="page">📋 ${esc(t('title.dspm'))}${(kidsD&&kidsD.length>1)?'':` · <span style="color:var(--blue)">${esc(dispNick(st)||sid)}</span>`}</h2>${childSwitcher(kidsD,sid,'P_dspm')}
      ${assessCard}
      ${past.length?`<h3 class="page" style="font-size:16px">📜 ${EN()?'Earlier results (previous age bands)':'ผลย้อนหลัง (ช่วงวัยก่อนหน้า)'}</h3>`+past.reverse().map(b=>`<div class="card"><h3 style="font-size:14px">${esc(ageBandLabel(b.label))}</h3>${b.items.map(i=>`<div class="list-item"><span><b>${EN()?'Item':'ข้อ'} ${i.itemNo}</b> <span class="pill info">${i.skill}</span> <small>${esc(EN()&&i.descriptionEN?i.descriptionEN:i.description)}</small></span>${DSPM_PILL(i.result)}</div>`).join('')}</div>`).join(''):''}`;
  };

  SCREENS.Parent.chat = async () => { const line=MOCK.config.Links.line||'#';
    app.innerHTML=`<h2 class="page">${esc(t('title.chat'))}</h2>
      <div class="card" style="text-align:center"><div style="font-size:48px">💬</div>
        <p>${esc(t('chat.lineMsg'))}</p>
        <a class="btn block green" href="${esc(line)}" target="_blank">${esc(t('chat.openLine'))} →</a>
        <p class="muted" style="font-size:13px;margin-top:10px">${esc(t('chat.lineNote'))}</p></div>${verTag()}`;
  };
  function bubble(c){ const me=c.SenderRole==='Parent'; return `<div style="display:flex;justify-content:${me?'flex-end':'flex-start'};margin:6px 0"><div style="max-width:80%;background:${me?'var(--blue-bg)':'var(--surface-3)'};padding:8px 12px;border-radius:12px"><div style="font-size:13px;color:var(--ink-3)">${esc(c.SenderName||c.SenderRole)}</div><div style="font-size:14px">${esc(c.Message)}</div><div class="muted" style="font-size:11px;text-align:right">${esc(c.Timestamp)}</div></div></div>`; }
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
  // `day` is the server's answer about TODAY. On a day the nursery is shut to the families nobody is
  // absent — they are on holiday — and every "แตะเพื่อเช็คอินแทน" button here would be refused by the
  // server anyway (assertSchoolOpen_ with forStudents). Say the day is closed instead of accusing
  // the whole roll of not turning up.
  function tcaHtml(d, day){ if(!d||!d.classes||!d.classes.length) return '';
    if(day&&day.closedForStudents) return `<div class="card"><div class="spread"><h3>👶 ${EN()?'Class attendance today':'การมาเรียนวันนี้'}</h3><span class="pill" style="background:var(--surface-3);color:var(--ink-3)">🏖️ ${EN()?'Holiday':'วันหยุด'}</span></div>
      <div style="text-align:center;color:var(--ink-3);padding:10px 0"><b>${EN()?'School closed today':'วันนี้โรงเรียนหยุด'}${day.reason?` (${esc(EN()?(day.reasonEN||day.reason):day.reason)})`:''}</b><br><small>${EN()?'no drop-off or pick-up':'ไม่มีการรับ-ส่งนักเรียน'}</small></div></div>`;
    const cards=d.classes.map(c=>{ const present=c.in+c.out; const pct=c.total?Math.round(present/c.total*100):100;
      const inNow=(c.students||[]).filter(s=>s.status==='IN');    // present, not yet picked up
      const outNow=(c.students||[]).filter(s=>s.status==='OUT');  // already picked up
      const lv=(c.students||[]).filter(s=>s.status==='LEAVE');
      const ab=(c.students||[]).filter(s=>s.status==='ABSENT');
      return `<div style="margin-bottom:12px"><div class="spread"><b>${esc(c.className)}</b><span style="font-weight:700;color:${pctColor(pct)}">${pct}% <small class="muted" style="font-weight:400">(${present}/${c.total})</small></span></div>
        <div style="height:6px;background:var(--line);border-radius:4px;overflow:hidden;margin:4px 0"><div style="height:100%;width:${pct}%;background:${pctColor(pct)}"></div></div>
        ${inNow.length?`<div style="margin-top:4px"><span class="pill ok">✅ ${EN()?'in — tap to pick up':'อยู่ที่โรงเรียน — แตะเพื่อรับกลับ'} (${inNow.length})</span><br>${inNow.map(s=>`<button class="btn sm pink" style="margin:3px 3px 0 0" onclick="T_studentCheckin('${s.studentId}','${esc(dnick(s))}','OUT')">🔴 ${esc(dnick(s))}${s.in?' ('+esc(s.in)+')':''}</button>`).join('')}</div>`:''}
        ${outNow.length?`<div style="margin-top:4px"><span class="pill info">↩️ ${EN()?'picked up':'รับกลับแล้ว'} (${outNow.length})</span><br>${outNow.map(s=>`<button class="btn sm outline" style="margin:3px 3px 0 0" onclick="T_studentCheckin('${s.studentId}','${esc(dnick(s))}','OUT')">✏️ ${esc(dnick(s))}${s.out?' '+esc(s.out):''}</button>`).join('')}</div>`:''}
        ${lv.length?`<div style="margin-top:2px"><span class="pill wait">🌴 ${EN()?'leave':'ลา'} (${lv.length})</span> <small class="muted">${lv.map(s=>esc(dnick(s))).join(', ')}</small></div>`:''}
        ${ab.length?`<div style="margin-top:4px"><span class="pill bad">⛔ ${EN()?'absent':'ขาด'} (${ab.length})</span> <small class="muted">${EN()?'tap to check in':'แตะเพื่อเช็คอินแทน'}</small><br>${ab.map(s=>`<button class="btn sm outline" style="margin:3px 3px 0 0" onclick="T_studentCheckin('${s.studentId}','${esc(dnick(s))}','IN')">📍 ${esc(dnick(s))}</button>`).join('')}</div>`:''}
        ${!lv.length&&!ab.length&&c.total?`<small style="color:var(--ok)">✓ ${EN()?'All present':'มาครบทุกคน'}</small>`:''}</div>`; }).join('');
    const ts=d.classes.reduce((a,c)=>{a.p+=c.in+c.out;a.t+=c.total;return a;},{p:0,t:0}); const tp=ts.t?Math.round(ts.p/ts.t*100):100;
    return `<div class="card"><div class="spread"><h3>👶 ${EN()?'Class attendance today':'การมาเรียนวันนี้'}</h3><b style="color:${pctColor(tp)}">${tp}% <small class="muted" style="font-weight:400">(${ts.p}/${ts.t})</small></b></div>
      <p class="muted" style="font-size:13px">${d.seeAll?(EN()?'All classes (head teacher)':'ทุกชั้นเรียน (หัวหน้าครู)'):(EN()?'Your class(es) only':'เฉพาะชั้นที่ดูแล')}</p>
      ${cards}</div>`; }
  SCREENS.Teacher.home = async () => {
    /* ONE round trip for the whole screen.
     *
     * api.js micro-batches every api() call made in the SAME TICK, so what decides the number of
     * requests is not how many calls there are — it is whether they all start together. These three
     * used to be fetched one after another further down (`const x = await api(...)`, three times),
     * which on live is three separate requests at the ~3s Apps Script floor. Nothing below depends
     * on them, so they start here and are awaited where they are rendered.
     * That is where "home p95 17.6s" came from.
     *
     * Each carries its own fallback: one broken section must never blank the rest of the screen —
     * a failure used to abort the entire tail, including the growth reminder.
     */
    const p_day = api('schoolDay',{}).catch(()=>null);
    const p_tca = api('teacherClassAttendance',{staffId:USER.staffId}).catch(()=>null);
    // myLeaves / myOT / recentAttendance were fetched here for lists that have MOVED — the leave
    // history and the work-time history to 📅 ตาราง, the OT history to 💵 การเงิน. Fetching them
    // for a screen that no longer shows them would be three requests spent on nothing.
    // leaveQuota left this batch with the remaining-days grid it fed — the leave screen fetches it
    // where it is actually read, and the home screen stops paying for a figure it no longer shows
    const [att,cl,me0raw,jstat,al] = await Promise.all([api('myAttendanceToday',{staffId:USER.staffId}),api('classList',tc()),api('staffSelf',{staffId:USER.staffId}),api('journalStatus',{}),
      api('studentAlerts',{staffId:USER.staffId,role:USER.role}).catch(()=>null)]);
    const jdone = journalDoneMap(jstat); setAlerts(al);
    T_STU={}; (cl.students||[]).forEach(s=>{ T_STU[s.StudentID]=s; });   // names for the ⋯ menu
    const day0 = await p_day;                 // already in flight with the batch above — no extra trip
    const me0=me0raw||{};
    if(me0.MustChangePassword){ T_changePw(true); return; } // force password change on first login
    const isLeader = me0.PositionLevel==='Leader' || me0.Role==='Leader' || USER.role==='Leader';
    USER._isLeader = isLeader;   // remembered for screens that cannot re-read the staff record (isLeaderRole)
    const canOrg = !!me0.CanClassOrg || isLeader;   // may use the drag class-organize tool (admin-granted)
    // the teacher the admin put in charge of the kitchen menu gets the monthly menu screen too
    const canFood = ['YES','TRUE','1'].indexOf(String(me0.CanFoodMenu||'').toUpperCase())>=0 || me0.CanFoodMenu===true;
    // a manually-requested time (ขอลงเวลา, approved) shows blue+bold to distinguish it from a normal GPS clock-in
    const mtime=(v,manual)=>manual?`<b style="color:var(--blue)" title="${EN()?'manual (requested)':'ขอลงเวลา'}">${v||'--:--'} •</b>`:`<b>${v||'--:--'}</b>`;
    // A meeting day IS a working day — often a Saturday — but it runs to its own hours. Say so
    // on the clock card, or a teacher works to their normal shift and is marked late for no reason.
    const bcBar = (day0&&day0.bigCleaning&&day0.bcIn)
      ? `<div style="background:var(--warn-bg);border:1px solid var(--warn-line);border-radius:8px;padding:8px;margin-bottom:8px;font-size:13px">
          ${BC_ICON} <b>${BC_NAME()}</b> — ${EN()?'today’s hours':'เวลาทำงานวันนี้'} <b>${esc(day0.bcIn)}–${esc(day0.bcOut)}</b>
          <br><span class="muted">${EN()?'Late and OT are measured against these, not your usual shift.':'การมาสายและ OT ของวันนี้คิดจากเวลานี้ ไม่ใช่เวลาปกติ'}</span></div>`
      : '';
    /* The school shut for part of today and opens again partway through. The teacher must be able to
     * SEE that their day starts then — reading their usual 08:00 off the roster while the gate is
     * locked is how someone concludes they are already hours late. The server computed this
     * (atomStaffHours_); the card only prints it. */
    const hrs0 = att && att.hours;
    const reopenBar = (hrs0 && hrs0.reopened)
      ? `<div style="background:var(--blue-bg);border:1px solid var(--blue-line);border-radius:8px;padding:8px;margin-bottom:8px;font-size:13px">
          🎉 <b>${EN()?'The school is closed this morning':'วันนี้โรงเรียนหยุดช่วงแรก'}</b> — ${EN()?'work starts':'เริ่มงาน'} <b>${esc(hrs0.checkIn)}</b> · ${EN()?'finish':'เลิกงาน'} <b>${esc(hrs0.checkOut)}</b>
          <br><span class="muted">${EN()
            ? `You are not late before ${hrs0.checkIn}, and you can clock in from ${hrs0.openFrom}. OT still runs from ${hrs0.checkOut}.`
            : `ไม่นับสายก่อน ${esc(hrs0.checkIn)} · ลงเวลาได้ตั้งแต่ ${esc(hrs0.openFrom)} · OT ยังคิดจาก ${esc(hrs0.checkOut)} ตามเดิม`}</span></div>`
      /* OT วันหยุด: the school is shut and this teacher is in, by arrangement, for an agreed sum.
       * The card used to print the holiday notice and no buttons at all — so on 22/08 she clocked in
       * by filing a time request. The day is hers to punch; it just is not priced by the hour. */
      : (att && att.holidayOT)
      ? `<div style="background:var(--ok-bg,var(--blue-bg));border:1px solid var(--ok-line,var(--blue-line));border-radius:8px;padding:8px;margin-bottom:8px;font-size:13px">
          🎉 <b>${EN()?'Holiday OT today':'วันนี้คุณมี OT วันหยุด'}</b>${att.holidayOTAmount?` — <b>${esc(baht(att.holidayOTAmount))}</b>`:''}
          ${att.holidayOTNote?`<br><span>${esc(att.holidayOTNote)}</span>`:''}
          <br><span class="muted">${EN()
            ? 'Clock in and out as usual. The day is paid as the agreed amount, so nothing counts as late and there is no hourly OT on top.'
            : 'ลงเวลาเข้า-ออกได้ตามปกติ · วันนี้จ่ายเป็นเงินก้อนตามที่ตกลง จึงไม่นับสายและไม่มี OT รายชั่วโมงเพิ่ม'}</span></div>`
      : (hrs0 && hrs0.dayOff)
      ? `<div style="background:var(--warn-bg);border:1px solid var(--warn-line);border-radius:8px;padding:8px;margin-bottom:8px;font-size:13px">
          🎉 <b>${EN()?'A day off — no need to clock in':'วันนี้เป็นวันหยุด — ไม่ต้องลงเวลา'}</b>
          <br><span class="muted">${EN()?'The holiday covers your whole shift. Nothing counts as late or absent.':'เวลาวันหยุดครอบคลุมทั้งกะของคุณ · ไม่นับสายและไม่นับขาดงาน'}</span></div>`
      : '';
    app.innerHTML = `<h2 class="page">${esc(t('t.greeting'))}${esc(EN()?USER.nameEN:USER.nameTH)} 👩‍🏫</h2>
      <div class="card"><h3>⏱️ ${esc(t('lbl.worktime'))} (${esc(att.date)})</h3>${bcBar}${reopenBar}
        ${me0.RequireCheckin===false?`<div style="background:var(--blue-bg);border-radius:8px;padding:8px;color:var(--blue);font-size:13px">ℹ️ ${esc(t('ci.notRequired'))}</div>`
        // School shut today: the server refuses the punch anyway (assertSchoolOpen_), so live buttons
        // could only produce an error. Name the holiday — the recent-days list stays, because that is
        // still what a teacher wants to check on a day off.
        // ...unless this teacher was given OT วันหยุด, in which case the server WILL take the punch
        // (staffCheckin) and hiding the buttons is the only thing stopping her. See holidayOTStaffInfo_.
        :(day0&&day0.closed&&!(att&&att.holidayOT))?`<div style="background:var(--surface-3);border:1px solid var(--line-strong);border-radius:8px;padding:12px;text-align:center">
          <b>🏖️ ${day0.partial?(EN()?'School closed just now':'ขณะนี้โรงเรียนหยุด'):(EN()?'School closed today':'วันนี้โรงเรียนหยุด')}</b>
          <br><span style="font-size:15px">${esc(EN()?(day0.reasonEN||'Holiday'):(day0.reason||'วันหยุด'))}${day0.partial?' '+esc((day0.holStart||'00:00')+'-'+(day0.holEnd||'23:59')):''}</span>
          <br><small class="muted">${day0.partial?(EN()?'Clocking in works again after that time.':'หลังเวลานี้ลงเวลาได้ตามปกติ'):(EN()?'No clocking in today. Nothing counts as late or absent.':'วันนี้ไม่ต้องลงเวลา · ระบบไม่นับสาย/ขาดงาน')}</small></div>`
        // Hired but not started yet: the server already refuses the check-in, so leaving live buttons
        // here only produced an error. Say when the first day is instead.
        :att.notStarted?`<div style="background:var(--warn-bg);border:1px solid var(--warn-line);border-radius:8px;padding:12px;text-align:center">
          <b style="color:var(--warn)">⏳ ${EN()?'Not started yet':'ยังไม่ถึงวันเริ่มงาน'}</b>
          <br><span style="font-size:15px">${EN()?'First working day':'วันแรกของการทำงาน'}: <b>${esc(att.startDate||'-')}</b></span>
          <br><small class="muted">${EN()?'Clocking in opens on that day. Nothing counts as late or absent before it.':'ปุ่มลงเวลาจะเปิดให้ใช้ในวันนั้น · ก่อนหน้านั้นระบบไม่นับสาย/ขาดงาน'}</small></div>`:`
        <div class="spread" style="font-size:15px"><span>${esc(t('lbl.checkIn'))} ${mtime(att.checkIn,att.manualIn)}</span><span>${esc(t('lbl.checkOut'))} ${mtime(att.checkOut,att.manualOut)}</span><span>${esc(t('lbl.late'))} <b style="color:${att.late?'var(--bad)':'var(--ok)'}">${att.late||0}</b> ${esc(t('lbl.min'))}</span></div>
        <div class="row" style="margin-top:12px;gap:10px"><button class="btn green" ${att.checkIn?'disabled':''} style="flex:1;padding:18px;font-size:18px;font-weight:700${att.checkIn?';opacity:.45;cursor:not-allowed':''}" onclick="T_punch('in',this)">🟢 ${att.checkIn?(EN()?'Checked in ':'เข้างานแล้ว ')+esc(att.checkIn):esc(t('lbl.checkIn'))}</button><button class="btn pink" ${att.checkOut?'disabled':''} style="flex:1;padding:18px;font-size:18px;font-weight:700${att.checkOut?';opacity:.45;cursor:not-allowed':''}" onclick="T_punch('out',this)">🔴 ${att.checkOut?(EN()?'Checked out ':'เลิกงานแล้ว ')+esc(att.checkOut):esc(t('lbl.checkOut'))}</button></div>`}
        <!-- The recent-days list and the leave history used to sit here. They are RECORDS, not
             today's job: they moved to 📅 ตาราง, where they can be filtered by month and folded
             away. The home screen is what you do this morning. -->
        <button class="btn sm outline block" style="margin-top:10px" onclick="GO('schedule')">📅 ${EN()?'Work history & leave history':'เวลาทำงานย้อนหลัง · ประวัติการลา'} →</button></div>
      ${isLeader?`<div id="tapprove"><div class="card muted">${EN()?'Loading approvals…':'กำลังโหลดรายการรออนุมัติ…'}</div></div>`:''}
      <div id="tcatt"></div>
      <!-- The remaining-days grid used to sit here. It is a reference figure, not a morning job, and
           it is on the leave screen itself where a teacher is actually deciding whether to file one.
           The home screen keeps the way IN. -->
      <div id="tholnext"></div>
      <div id="tholday"></div>
      <div id="tmissout"></div>
      <div class="card"><button class="btn sm outline block" onclick="GO('leave')">📩 ${EN()?'Leave — file or view':'ยื่น/ดูใบลา'}</button></div>
      ${isLeader?`<div class="card"><div class="spread"><h3>${esc(t('corg.title'))}</h3><button class="btn sm" onclick="T_classOrg()">🔁 ${esc(t('corg.manage'))}</button></div><small class="muted">${esc(t('corg.leaderNote'))}</small><div id="myccr" style="margin-top:8px"></div></div>`:''}
      <div class="card"><div class="row"><button class="btn sm outline" onclick="GO('absence')">🔎 ${esc(t('abs.title'))}</button>
        <button class="btn sm outline" onclick="T_studentOT()">⏰ ${EN()?'Student OT (follow-up)':'OT นักเรียน (ติดตามชำระ)'}</button>
        <button class="btn sm outline" onclick="T_holidayOT()">🎉 ${EN()?'My holiday OT':'OT วันหยุดของฉัน'}</button>
        <button class="btn sm outline" onclick="A_attAudit()">🕵️ ${EN()?'Attendance check':'ตรวจสอบการลงเวลา'}</button>
        ${canOrg?`<button class="btn sm outline" onclick="T_organize()">🔁 ${EN()?'Organize classes':'จัดชั้นเรียน'}</button>`:''}
        ${canFood?`<button class="btn sm outline" onclick="A_foodMenu()">🍚 ${EN()?'Monthly food menu':'เมนูอาหารรายเดือน'}</button>`:''}</div></div>
      <div class="card"><div class="spread"><h3>👶 ${esc(cl.class.ClassName)}</h3><span class="muted">${cl.students.length} ${EN()?'kids':'คน'}</span></div>${classSwitcher(cl)}
        ${cl.students.map(s=>{
          // same rule as the class screen and as the server: no journal until the child has arrived
          const done=jdone[s.StudentID], canJ = s.inToday || !!done;
          const jBtn = canJ
            ? `<button class="btn sm outline" onclick="T_journal('${s.StudentID}')" title="${esc(journalBtnLabel(done))}">${esc(jShortLabel(done))}</button>`
            : `<button class="btn sm outline" disabled style="opacity:.45" title="${s.onLeave?(EN()?'On leave today — the leave is the record':'ลาวันนี้ — การลาคือบันทึกของวันนี้'):(EN()?'Check the child in first':'ต้องเช็คอินนักเรียนก่อนจึงจะบันทึกได้')}">${esc(EN()?'Write':'บันทึก')}</button>`;
          // min-width:0 lets the name column shrink; without it the two buttons were pushed onto
          // their own lines and every row ended up a different height
          const dueA=dspmDueOf(s.StudentID);
          return `<div class="list-item"><span style="min-width:0;flex:1">${studentAvatar(s)} <b>${esc(dispNick(s))}</b> ${dueA?dspmDueBadge(dueA):''} ${journalPill(done)}</span><span class="acts2">${jBtn}<button class="btn sm outline" onclick="T_assess('${s.StudentID}')">${esc(t('lbl.assess'))}</button></span></div>`; }).join('')}</div>
      ${birthdayCard(al)}`;
    // render, don't fetch: this was started before the batch above and travelled with it
    const tca=await p_tca; setHTML('#tcatt', tca?tcaHtml(tca,day0):'');
    /* A closed day with children in it. The teacher on OT วันหยุด needs the list in front of her —
     * who was expected, who has arrived, who has gone home — because on a normal day the class
     * screen answers that and on a holiday there is no class. And when a family turns up who is not
     * on the list, adding them is one tap: refusing a child at the door with no way to say yes is
     * not a safety rule, it is an obstacle. */
    /* "I DID NOT KNOW I WAS DUE IN ON SATURDAY."
     *
     * The admin agrees an OT วันหยุด days or weeks ahead; the teacher is told once, in a bell
     * notification that scrolls away. Then the day arrives and the only place it was written down is
     * a payslip. This is the standing reminder, on the screen somebody actually opens on a Friday —
     * and on the day itself it says so in the present tense, next to the clock-in button. */
    api('myHolidayOTNext',{staffId:USER.staffId}).then(n=>{
      if(!n||!n.count){ setHTML('#tholnext',''); return; }
      const today=(n.rows||[]).filter(r=>r.date===n.today);
      const ahead=(n.rows||[]).filter(r=>r.date>n.today);
      const dayName=d=>{ const g=new Date(d+'T00:00:00').getDay();
        return (EN()?['Sun','Mon','Tue','Wed','Thu','Fri','Sat']:['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'])[g]; };
      const away=d=>Math.round((new Date(d+'T00:00:00')-new Date(n.today+'T00:00:00'))/86400000);
      setHTML('#tholnext', `<div class="card" style="background:var(--ok-bg,var(--blue-bg));border-color:var(--ok-line,var(--blue-line))">
        <b>🎉 ${EN()?'Holiday OT':'OT วันหยุดของคุณ'}</b>
        ${today.map(r=>`<div class="list-item"><span><b>${EN()?'Today':'วันนี้'}</b> · ${esc(ddmmyyyy(r.date))} (${esc(dayName(r.date))})${r.note?`<br><small class="muted">${esc(r.note)}</small>`:''}</span>
          <b style="flex:0 0 auto;color:var(--ok)">${esc(baht(r.amount))}</b></div>`).join('')}
        ${ahead.map(r=>`<div class="list-item"><span><b>${esc(ddmmyyyy(r.date))}</b> <small class="muted">(${esc(dayName(r.date))} · ${EN()?`in ${away(r.date)} day(s)`:`อีก ${away(r.date)} วัน`})</small>${r.note?`<br><small class="muted">${esc(r.note)}</small>`:''}</span>
          <b style="flex:0 0 auto;color:var(--ok)">${esc(baht(r.amount))}</b></div>`).join('')}
        <small class="muted">${EN()
          ? 'You are expected in on these days even though the school is shut. The amount is a lump sum for the day — no lateness, and no hourly OT on top.'
          : 'วันเหล่านี้คุณต้องมาทำงานแม้โรงเรียนหยุด · ยอดนี้เป็นเงินก้อนของทั้งวัน ไม่นับสายและไม่มี OT รายชั่วโมงเพิ่ม'}</small>
        <button class="btn sm outline block" style="margin-top:6px" onclick="T_holidayOT()">🎉 ${EN()?'Details & the children for each day':'ดูรายละเอียดและนักเรียนของแต่ละวัน'}</button></div>`);
    }).catch(()=>{});
    api('holidayAttendList',{}).then(h=>{
      /* Shown when there are children in — OR when this teacher is the one on OT วันหยุด and there
       * are none. That second case is the whole of 22/08: with an empty list the card vanished, and
       * the ➕ "a child turned up" button lives INSIDE it, so the one situation the button exists for
       * was the one situation it could not be reached in. */
      const _mine=(h&&h.staffIds||[]).indexOf(String(USER.staffId))>=0;
      if(!h||!h.closed||(!h.count&&!_mine)){ setHTML('#tholday',''); return; }
      const dn=x=>EN()?(x.nickEN||x.nameEN||x.nick||x.name):(x.nick||x.name);
      setHTML('#tholday', `<div class="card" style="background:var(--blue-bg);border-color:var(--blue-line)">
        <div class="spread"><b>🎉 ${EN()?'Children in today (holiday)':'นักเรียนที่มาวันนี้ (วันหยุด)'}</b>
          <span class="muted">${h.count} ${EN()?'children':'คน'}</span></div>
        <small class="muted" style="display:block;margin:2px 0 6px">${EN()
          ? 'The day works as usual for these children: check-in, the journal, the history and the late-pickup charge.'
          : 'สำหรับนักเรียนกลุ่มนี้ วันนี้ทำงานเหมือนวันปกติ — ลงเวลา สมุดรายวัน ประวัติ และ OT รับช้า'}</small>
        ${h.count?'':`<div style="text-align:center;color:var(--ink-3);padding:6px 0"><b>${EN()?'No child is on today’s list':'ยังไม่มีนักเรียนในรายชื่อวันนี้'}</b><br><small>${EN()?'Add a name below if a family turns up.':'หากมีนักเรียนมา ให้เพิ่มชื่อด้านล่างก่อนจึงจะลงเวลาได้'}</small></div>`}
        ${(h.students||[]).map(s=>`<div class="list-item"><span><b>${esc(dn(s))}</b> <small class="muted">${esc(s.class||'')}</small>
            <br><small class="muted">🟢 ${esc(s.inTime||'—')} → 🔴 ${esc(s.outTime||'—')}${s.otAmount>0?` · <span style="color:var(--warn)">OT ${esc(baht(s.otAmount))}</span>`:''}</small></span>
          <button class="btn sm outline" onclick="T_studentCheckin('${esc(s.studentId)}','${esc(dn(s))}','${s.inTime&&!s.outTime?'OUT':'IN'}')">🕑 ${EN()?'Record':'ลงเวลา'}</button></div>`).join('')}
        <button class="btn sm outline block" style="margin-top:6px" onclick="T_holAddStudent('${esc(h.date)}')">➕ ${EN()?'A child turned up who is not on the list':'มีนักเรียนมาเพิ่ม (ไม่อยู่ในรายชื่อ)'}</button></div>`);
    }).catch(()=>{});
    /* A day you clocked into and never out of is nobody's fault and everybody's problem: it has no
     * hours, no OT, and the month reads "ครบ" while two days sit half-written. Only the person who
     * was there knows what time they left, so they are told first — with the way to fix it. */
    api('staffMissingCheckout',{staffId:USER.staffId}).then(mo=>{
      if(!mo||!mo.count){ setHTML('#tmissout',''); return; }
      const days=((mo.staff||[])[0]||{}).days||[];
      setHTML('#tmissout', `<div class="card" style="background:var(--warn-bg);border-color:var(--warn-line)">
        <b style="color:var(--warn)">⏳ ${EN()?`${mo.count} day(s) with no check-out`:`มี ${mo.count} วันที่ยังไม่ได้ลงเวลาออก`}</b>
        <div style="font-size:14px;margin:4px 0">${days.map(d=>esc(ddmmyyyy(d))).join(' · ')}</div>
        <small class="muted">${EN()?'Those days have no working hours and no OT until they are completed. Send a time request with the time you actually left.':'วันเหล่านี้จะยังไม่มีชั่วโมงทำงานและไม่มี OT จนกว่าจะลงเวลาให้ครบ · ส่งคำขอลงเวลาโดยระบุเวลาที่กลับจริง'}</small>
        <button class="btn sm block" style="margin-top:8px" onclick="GO('leave')">📤 ${esc(t('att.title'))}</button></div>`);
    }).catch(()=>{});
    // A leader has three more sections. They cannot join the batch above — whether this person IS a
    // leader is only known once staffSelf has answered — but they can share ONE round trip with each
    // other instead of taking three, and one failing section no longer hides the other two.
    if(isLeader){
      const p_tp=api('teamPendingLeaves',{staffId:USER.staffId}).catch(()=>[]);
      const p_to=api('teamPendingOT',{staffId:USER.staffId}).catch(()=>[]);
      const p_cc=api('myClassChanges',{staffId:USER.staffId}).catch(()=>[]);
      const p_ti=api('pendingInjuries',{staffId:USER.staffId}).catch(()=>[]);
      // time-correction requests were the one approval a head teacher could only reach by going to
      // the leave screen and finding a tab — so they sat unanswered
      const p_tt=api('teamPendingTimeRequests',{staffId:USER.staffId}).catch(()=>[]);
      const [tp,to,ccr,ti,tt]=await Promise.all([p_tp,p_to,p_cc,p_ti,p_tt]);
      setHTML('#tapprove', leaderApprovalsHTML({leaves:tp, ot:to, times:tt, injuries:ti}));
      setHTML('#myccr', ccr.slice(0,4).map(ccrRow).join('')||`<small class="muted">${esc(t('corg.noReq'))}</small>`);
    }
    T_growthReminder();   // even-month weight/height measurement reminder (once per month)
  };
  /**
   * EVERYTHING a head teacher has to approve, in one card, directly under the clock they already
   * tap every morning.
   *
   * These were four separate cards scattered down the page — and the time-correction requests were
   * on none of them: the only way to them was the leave screen, behind a tab, so they sat there
   * unanswered while the teacher who asked waited. A queue nobody can see is a queue nobody works.
   *
   * A section with nothing in it is not drawn. When ALL four are empty the card says so once,
   * quietly, rather than printing four "no items" lines.
   */
  function leaderApprovalsHTML(q){
    const secs=[
      ['📩', EN()?'Leave requests':'ใบลาของลูกน้อง',      q.leaves,   l=>teamLeaveRow(l)],
      ['⏰', EN()?'Overtime':'OT ของลูกน้อง',              q.ot,       otApproveRow],
      ['🕑', EN()?'Time corrections':'คำขอแก้ไข/ลงเวลา',   q.times,    timeReqApproveRow],
      ['🚑', EN()?'Injury reports':'รายงานอุบัติเหตุ',      q.injuries, null]   // rendered as a list
    ];
    const total=secs.reduce((a,s)=>a+((s[2]||[]).length),0);
    if(!total) return `<div class="card" style="background:var(--ok-bg);border-color:var(--ok-line)">
      <b style="color:var(--ok)">✅ ${EN()?'Nothing waiting for your approval':'ไม่มีรายการรออนุมัติ'}</b></div>`;
    return `<div class="card" style="border-color:var(--brand-line)">
      <div class="spread"><h3 style="margin:0">⭐ ${EN()?'Waiting for you':'รออนุมัติจากคุณ'}</h3>
        <span class="pill bad">${total}</span></div>
      ${secs.map(s=>{ const rows=s[2]||[]; if(!rows.length) return '';
        return `<div style="margin-top:10px"><div class="spread" style="margin-bottom:4px">
            <b style="font-size:14px">${s[0]} ${esc(s[1])}</b><span class="pill wait" style="font-size:11px">${rows.length}</span></div>
          ${s[3] ? rows.map(s[3]).join('') : injuryListHTML(rows)}</div>`; }).join('')}</div>`;
  }
  // Even-numbered months (Feb, Apr, … Dec) are weight+height measurement months — remind teachers once,
  // like a parent announcement. Dismissed per-month via localStorage so it shows once each even month.
  window.T_growthReminder = () => {
    const now=new Date(); const mo=now.getMonth()+1; if(mo%2!==0) return;   // even months only
    const key='atom_growth_reminder_'+now.getFullYear()+'-'+mo;
    try{ if(localStorage.getItem(key)) return; }catch(e){}
    const monName=EN()?EN_MONTHS[mo-1]:TH_MONTHS[mo-1];
    modal(`<div style="text-align:center"><div style="font-size:40px">📏⚖️</div>
      <h3>${EN()?'Measurement month':'เดือนวัดการเจริญเติบโต'}</h3>
      <p style="font-size:14px">${EN()?`${monName} is a weight & height measurement month. Please measure every student and record it in the growth module.`:`เดือน${monName}เป็นเดือนที่ต้องวัด<b>น้ำหนักและส่วนสูง</b>ของนักเรียนทุกคน · กรุณาวัดและบันทึกในเมนูพัฒนาการการเจริญเติบโต`}</p>
      <label style="display:flex;align-items:center;gap:8px;justify-content:center;font-size:13px;color:var(--ink-3)"><input type="checkbox" id="grNoShow"> ${EN()?"Don't show again this month":'ไม่ต้องแสดงอีกในเดือนนี้'}</label>
      <button class="btn block" style="margin-top:10px" onclick="if(document.getElementById('grNoShow').checked){try{localStorage.setItem('${key}','1')}catch(e){}}; this.closest('.modal').remove()">${esc(t('c.close'))}</button></div>`);
  };
  // OT status badge + row renderers (shared)
  // a blank Status is a legacy pre-workflow OT row → treat it as approved
  const otStatusPill = st => { const k=String(st||'').toUpperCase()||'APPROVED'; const cls=k==='APPROVED'?'ok':(k==='REJECTED'?'bad':'wait');
    return `<span class="pill ${cls}">${esc(t('ot.st.'+k)||k)}</span>`; };
  // a holiday OT has no hours behind it — printing "0 ชม." would read as a mistake, so it says what
  // it is and shows the reason the Admin wrote down instead. isHolOT is defined once, near the top.
  function otRow(o){ const hol=isHolOT(o);
    const mid=hol?`🎉 <b>${EN()?'Holiday OT':'OT วันหยุด'}</b> ${esc(baht(o.Amount))}${o.Note?`<br><small class="muted">${esc(o.Note)}</small>`:''}`
                 :`<b>${o.Hours} ${EN()?'h':'ชม.'}</b> ${esc(baht(o.Amount))}${o.Minutes?` <small class="muted">(${esc(hmMin(o.Minutes))})</small>`:''}`;
    return `<div class="list-item"><span>${esc(ddmmyyyy(o.Date))} · ${mid}</span>${otStatusPill(o.Status)}</div>`; }
  // leader approval row (approve / reject)
  function otApproveRow(o){ return `<div class="list-item"><span><b>${esc(dnick(o))}</b> · ${esc(ddmmyyyy(o.Date))} · ${o.Hours} ${EN()?'h':'ชม.'} ${esc(baht(o.Amount))}<br><small class="muted">${esc(o.PlanOut||'')}→${esc(o.ActualOut||'')} (${esc(hmMin(o.Minutes))})</small></span><span class="row"><button class="btn sm green" onclick="T_approveOT('${o.OTRecordID}','approve')" aria-label="${EN()?"Approve":"อนุมัติ"}" title="${EN()?"Approve":"อนุมัติ"}">✔</button><button class="btn sm pink" onclick="T_approveOT('${o.OTRecordID}','reject')" aria-label="${EN()?"Reject":"ปฏิเสธ"}" title="${EN()?"Reject":"ปฏิเสธ"}">✕</button></span></div>`; }
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
          <b>${baht(o.amount)}</b> <span class="pill ${stPill(o.status)}" style="font-size:11px">${esc(stLbl(o.status))}</span>${o.submitted>0&&o.status!=='PAID'?` <small class="muted">(${EN()?'slip sent':'ส่งสลิปแล้ว'})</small>`:''}</span>
          ${closed?'':`<button class="btn sm" onclick="T_payOT('${esc(o.otId)}',${o.outstanding||o.amount})">📎 ${EN()?'Add slip':'แนบสลิป'}</button>`}</div>`; }).join('')}</div>`;
    modal(`<h3>⏰ ${EN()?'Student OT — follow-up':'OT นักเรียน — ติดตามชำระ'}</h3>
      <p class="muted" style="font-size:13px">${d.seeAll?(EN()?'All classes (head teacher).':'ทุกชั้นเรียน (หัวหน้าครู)'):(EN()?'Your class only.':'เฉพาะชั้นเรียนที่ดูแล')} ${EN()?'Total outstanding':'ยอดค้างรวม'} <b>${baht(d.totalOutstanding)}</b></p>
      <div style="max-height:64vh;overflow:auto">${(d.students||[]).length?d.students.map(stud).join(''):`<div class="card muted">${EN()?'No OT to follow up':'ไม่มีรายการ OT ค้างชำระ'}</div>`}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.T_payOT=(otId,amt)=>{ const x=document.querySelector('.modal'); if(x)x.remove(); P_slip(otId,amt,'teacherOt'); };
  window.T_punch=async(kind,btn)=>{ if(btn){ btn.disabled=true; btn.style.opacity='.45'; btn.style.cursor='not-allowed'; }  // prevent double-tap immediately
    try{ const {lat,lng,acc}=await getPosition();
      const r=await api(kind==='in'?'staffCheckin':'staffCheckout',{staffId:USER.staffId,lat,lng,acc}); toast(kind==='in'?`✅ ${t('lbl.checkIn')} ${r.time}${r.lateMinutes>0?` (${t('lbl.late')} ${r.lateMinutes} ${t('lbl.min')})`:' ('+t('lbl.onTime')+')'}`:`✅ ${t('lbl.checkOut')} ${r.time}${r.otHours>0?` · OT ${hmHours(r.otHours)}${r.otPay?' ≈ '+baht(r.otPay):''}`:''}`); GO('home'); }
    catch(e){
      /* "You already clocked in/out today" is not a failure — it is the work having been DONE, and
       * the app not knowing it yet. It happens when the reply to the first tap was lost in transit
       * (the app retries a read, never a write) or when the punch was made on another device. The
       * teacher should be told the time it actually happened and see the screen catch up, not a red
       * error about something that already worked. 33% of check-outs "failed" this way in one day.
       */
      const code=(e&&e.code)||'';
      if(code==='ALREADY_CHECKED_IN'||code==='ALREADY_CHECKED_OUT'){
        toast('✅ '+((e&&e.message)||(EN()?'Already recorded':'บันทึกไว้แล้ว')));
        GO('home'); return;                                   // re-reads the real times from the server
      }
      err(e); if(btn){ btn.disabled=false; btn.style.opacity=''; btn.style.cursor=''; } } };  // re-enable on error (GO('home') re-renders disabled on success)

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

  /**
   * A child's row of actions, WITH THE ACTION WRITTEN ON IT.
   *
   * These were six unlabelled icons and teachers could not tell 📝 (assess) from 📒 (journal) or
   * 🕑 (correct a time) from 📅 (past reports) — a tooltip is no help on a phone, where there is no
   * hover. Every button now says what it does in two or three words; the emoji stays as a visual
   * anchor, matching the rest of the app.
   *
   * The journal is CLOSED until the child is checked in — the same rule the server enforces
   * (submitJournal → NOT_CHECKED_IN), said out loud on the button rather than as a refusal after
   * the teacher has filled a page in. A child on leave is closed for the same reason: the leave is
   * the record of their day.
   */
  /**
   * ONE WORD WHERE ONE WORD WILL DO. The button is 1/3 of a phone's width, and "แก้ไขบันทึก" in
   * that space either wraps the card or shrinks past reading size. The card already says what the
   * child's journal is (the ⏳/📝/✅ pill), so the button only has to say what tapping it does.
   * The full sentence stays on `title` for anyone on a desktop.
   */
  const jShortLabel = d => !d ? (EN()?'Write':'บันทึก') : (jIsDraft(d) ? (EN()?'Edit':'แก้ไข') : (EN()?'View':'ดู'));
  function studentRowButtons(s, jdone){
    const done=jdone[s.StudentID], canJ = s.inToday || !!done;
    // label '' = icon only (the ⋯ menu): a word there would cost a third of the row for nothing
    const B=(cls,onclick,icon,label,title)=>`<button class="btn sm ${cls}" ${onclick?`onclick="${onclick}"`:'disabled style="opacity:.45"'} title="${esc(title||label)}" aria-label="${esc(label||title||'')}">${icon}${label?' '+esc(label):''}</button>`;
    const jBtn = canJ
      ? B(done?'outline':'', `T_journal('${s.StudentID}')`, !done?'📒':(jIsDraft(done)?'✏️':'👁️'),
          jShortLabel(done), journalBtnLabel(done)+' — '+dispNick(s))
      : B('outline', '', '📒', EN()?'Write':'บันทึก',
          s.onLeave ? (EN()?'On leave today — the leave is the record':'ลาวันนี้ — การลาคือบันทึกของวันนี้')
                    : (EN()?'Check the child in first':'ต้องเช็คอินนักเรียนก่อนจึงจะบันทึกได้'));
    // preselect OUT once the child is in (so "pick up" is one tap); always usable so a time can be corrected.
    // A child their parent has reported away today cannot be checked in — the leave IS the record, and a
    // stray check-in would contradict it.
    // shut to the children today (weekend / holiday — and a meeting day IS shut to them, even
    // though the teachers are in). The server refuses it, so offering the tap only produces an error.
    const stdClosed = !!(window._SCHOOLDAY && window._SCHOOLDAY.closedForStudents);
    const ciBtn = stdClosed
      ? B('outline', '', '🏖️', EN()?'Closed':'หยุด',
          (EN()?'School closed to children today':'วันนี้โรงเรียนหยุดสำหรับนักเรียน')+
          ((window._SCHOOLDAY&&(EN()?window._SCHOOLDAY.reasonEN:window._SCHOOLDAY.reason))?' · '+(EN()?window._SCHOOLDAY.reasonEN:window._SCHOOLDAY.reason):''))
      : s.onLeave
      ? B('outline', '', '🚫', EN()?'Leave':'ลา', EN()?'On leave today — cannot check in':'ลาวันนี้ — เช็คอินไม่ได้')
      : B('green', `T_studentCheckin('${s.StudentID}','${esc(nm(s))}','${s.inToday&&!s.outToday?'OUT':(s.outToday?'OUT':'IN')}')`,
          '📍', s.inToday&&!s.outToday?(EN()?'Out':'รับกลับ'):(EN()?'In':'เช็คอิน'),
          EN()?'Check in / pick up on behalf':'เช็คอิน / รับกลับ แทนผู้ปกครอง');
    // Three everyday actions stay on the row; the three occasional ones go behind ⋯, the same way
    // the admin's student list already works.
    return `<div class="stuacts">${[jBtn,
      B('outline', `T_assess('${s.StudentID}')`, '📝', EN()?'Assess':'ประเมิน', EN()?'DSPM assessment':'ประเมินพัฒนาการ DSPM'),
      ciBtn,
      B('outline more', `T_stuMore('${s.StudentID}')`, '⋯', '', EN()?'File leave · correct times · past reports':'แจ้งลา · แก้ไขเวลา · บันทึกย้อนหลัง')
    ].join('')}</div>`;
  }
  /**
   * The rest of a child's actions, as a list. Keyed off the class list the screen just drew
   * (T_STU) so it needs no extra round trip and shows the same name the row does.
   */
  let T_STU={};
  window.T_stuMore=(sid)=>{ const s=T_STU[sid]||{StudentID:sid};
    const close="this.closest('.modal').remove();";
    modal(`<h3>👶 ${esc(dispNick(s)||sid)} ${nmSub(s)?`<small class="muted" style="font-size:13px">${esc(nmSub(s))}</small>`:''}</h3>
      <button class="btn block outline" onclick="${close}T_studentLeave('${esc(sid)}','${esc(dispNick(s)||sid)}')">🏖️ ${EN()?'File leave for this student':'แจ้งลาให้นักเรียน'}</button>
      <button class="btn block outline" style="margin-top:8px" onclick="${close}EDIT_ATT('${esc(sid)}')">🕑 ${EN()?'Correct check-in / pick-up':'แก้ไขเวลารับ-ส่ง'}</button>
      <button class="btn block outline" style="margin-top:8px" onclick="${close}T_journalHistory('${esc(sid)}')">📅 ${EN()?'Past daily reports':'ดูบันทึกย้อนหลัง'}</button>
      <button class="btn block outline" style="margin-top:12px" onclick="${close}">${esc(t('c.close'))}</button>`); };
  // who is due a DSPM assessment / whose birthday it is, keyed by student — filled by any screen
  // that fetches studentAlerts, read by the row renderers
  let DSPM_DUE={};
  const dspmDueOf = sid => DSPM_DUE[sid];
  function setAlerts(al){ DSPM_DUE={}; ((al&&al.dspmDue)||[]).forEach(k=>{ DSPM_DUE[k.studentId]=k; }); return al; }
  SCREENS.Teacher.class = async () => {
    const [cl,jstat,al]=await Promise.all([api('classList',tc()),api('journalStatus',{}),
      api('studentAlerts',{staffId:USER.staffId,role:USER.role}).catch(()=>null),
      // the on-behalf check-in button must know whether the nursery is open TO THE CHILDREN today
      api('schoolDay',{}).then(d=>{ window._SCHOOLDAY=d; return d; }).catch(()=>null)]);
    const jdone=journalDoneMap(jstat); setAlerts(al);
    T_STU={}; cl.students.forEach(s=>{ T_STU[s.StudentID]=s; });
    app.innerHTML=`<h2 class="page">👶 ${esc(cl.class.ClassName)}</h2>${classSwitcher(cl)}${birthdayCard(al)}`+cl.students.map(s=>{
      const attTag = s.onLeave
        ? `<small class="pill warn" style="margin-left:4px">🏖️ ${esc(s.leaveType||(EN()?'on leave':'ลา'))}${s.leaveReason?' · '+esc(s.leaveReason):''}</small>`
        : (s.inToday?`<small class="pill ok" style="margin-left:4px">${EN()?'in':'มา'} ${esc(s.inTime||'')}</small>`:'');
      // the DSPM reminder rides after the name, where the teacher is already looking, and clears
      // itself once the band is finished
      const due=dspmDueOf(s.StudentID);
      return `<div class="card"><div style="display:flex;gap:10px;align-items:center">${studentAvatar(s)}<div style="min-width:0"><b>${esc(dispNick(s))}</b> ${due?dspmDueBadge(due):''} ${nmSub(s)?`<small class="muted">${esc(nmSub(s))}</small>`:""}${attTag}<br><small class="muted">${esc(ageYM(s.DOB))} · ${EN()?'allergy':'แพ้'}: ${esc(s.Allergy||'-')}</small><br>${journalPill(jdone[s.StudentID])}</div></div>
        ${studentRowButtons(s,jdone)}</div>`; }).join(''); };
  // Teacher files a leave for a student → notifies the linked parents; shows in that student's parent calendar
  window.T_studentLeave=(sid,name)=>{ modal(`<h3>🏖️ ${EN()?'File student leave':'แจ้งลานักเรียน'} — ${esc(name)}</h3>
    <!-- same trap as #lType: the value is what reaches the sheet, so it stays Thai in both languages -->
    <label class="field"><span>${EN()?'Type':'ประเภท'}</span><select id="tslType" translate="no">
      <option value="ลาป่วย">${EN()?'Sick leave (ลาป่วย)':'ลาป่วย'}</option>
      <option value="ลากิจ">${EN()?'Personal leave (ลากิจ)':'ลากิจ'}</option>
      <option value="ขาด">${EN()?'Absent (ขาด)':'ขาด'}</option></select></label>
    <label class="field"><span>${esc(t('inj.date'))}</span><input type="date" id="tslDate" value="${todayStr()}"/></label>
    <label class="field"><span>${EN()?'Reason':'เหตุผล'}</span><textarea id="tslReason" placeholder="${EN()?'reason…':'เหตุผล...'}"></textarea></label>
    <button class="btn block" onclick="T_studentLeaveDo('${sid}',this)">${EN()?'Notify parents':'แจ้งผู้ปกครอง'}</button>`); };
  window.T_studentLeaveDo=async(sid,btn)=>{ const m=btn.closest('.modal'); const g=x=>{const e=m.querySelector('#'+x);return e?e.value:'';};
    btn.disabled=true; try{ await api('teacherStudentLeave',{staffId:USER.staffId,studentId:sid,date:g('tslDate'),type:g('tslType'),reason:g('tslReason')}); m.remove(); confirmSaved(EN()?'Leave filed — parents notified':'แจ้งลาแล้ว — แจ้งผู้ปกครอง'); }catch(e){err(e);btn.disabled=false;} };
  // Teacher checks a student in/out on behalf of a pickup person who isn't a registered parent.
  // The ACTUAL time and the remark (who it was) are BOTH mandatory — Save stays disabled until filled.
  // inDone/outDone fade the type that's already recorded so it can't be double-entered.
  // prefer = the type to preselect ('IN'|'OUT'); both are always selectable so a wrong time can be corrected
  window.T_studentCheckin=(sid,name,prefer)=>{
    const nowHM=(()=>{const d=new Date();return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');})();
    SC_TYPE = (String(prefer||'').toUpperCase()==='OUT') ? 'OUT' : 'IN';
    modal(`<h3>📍 ${EN()?'Check in / out for':'เช็คอิน-เอาท์แทน'} ${esc(name)}</h3>
    <p class="muted" style="font-size:13px">${EN()?'Record the REAL drop-off / pick-up time. Re-recording the same type corrects the time. Time + remark are required.':'บันทึกเวลาจริงที่มารับ-ส่ง · บันทึกซ้ำประเภทเดิม = แก้เวลา · ต้องกรอกเวลาจริงและหมายเหตุเสมอ'}</p>
    <div class="seg"><button class="${SC_TYPE==='IN'?'active':''}" id="scIN" onclick="T_scType('IN')">${EN()?'Drop off (IN)':'ส่งเข้าเรียน (IN)'}</button><button class="${SC_TYPE==='OUT'?'active':''}" id="scOUT" onclick="T_scType('OUT')">${EN()?'Pick up (OUT)':'รับกลับ (OUT)'}</button></div>
    <label class="field"><span>${EN()?'Actual time (required)':'เวลาจริง (บังคับ)'}</span>
      <input type="time" id="scTime" value="${nowHM}" oninput="T_scCheck()"/></label>
    <label class="field"><span>${EN()?'Remark — who dropped off / picked up? (required)':'หมายเหตุ — ใครมารับ-ส่ง? (บังคับ)'}</span>
      <textarea id="scRemark" placeholder="${EN()?'e.g. Grandmother Somsri, phone 08x-xxx-xxxx':'เช่น คุณยายสมศรี เบอร์ 08x-xxx-xxxx'}" oninput="T_scCheck()"></textarea></label>
    <button class="btn block green" id="scSave" disabled onclick="T_studentCheckinDo('${sid}',this)">💾 ${EN()?'Save':'บันทึก'}</button>
    <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`); };
  /**
   * A teacher's own OT วันหยุด, and the children attached to each of those days.
   *
   * The home card only appears ON the day itself. A teacher asked to work a Saturday needs to see it
   * BEFORE the Saturday — what was agreed, what the note says, and which children she is expecting —
   * and on the day she needs to add the one who turned up anyway. Both live here.
   */
  window.T_holidayOT=async(month)=>{
    const mth=month||monthStr();
    let rows=[]; try{ rows=await api('myOT',{staffId:USER.staffId,month:mth})||[]; }catch(e){ err(e); return; }
    const hol=rows.filter(isLiveHolOT).sort((a,b)=>String(b.Date).localeCompare(String(a.Date)));
    const total=hol.reduce((a,o)=>a+(Number(o.Amount)||0),0);
    modal(`<h3>🎉 ${EN()?'My holiday OT':'OT วันหยุดของฉัน'}</h3>
      <label class="field"><span>${esc(t('c.month'))}</span><input type="month" value="${esc(mth)}" onchange="this.closest('.modal').remove();T_holidayOT(this.value)"/></label>
      ${hol.length?`<div class="spread" style="margin:6px 0"><b>${EN()?'This month':'เดือนนี้'} (${hol.length})</b><b style="color:var(--ok)">${esc(baht(total))}</b></div>`:''}
      <div style="max-height:56vh;overflow:auto">${hol.length?hol.map(o=>`<div class="card" style="padding:8px">
        <div class="spread"><b>${esc(ddmmyyyy(o.Date))}</b><b style="color:var(--ok)">${esc(baht(o.Amount))}</b></div>
        ${o.Note?`<div style="font-size:14px;margin-top:2px">${esc(o.Note)}</div>`:''}
        <div id="tho_${esc(ymd(o.Date))}" class="muted" style="font-size:13px;margin-top:4px">…</div>
        <button class="btn sm outline block" style="margin-top:6px" onclick="T_holAddStudent('${esc(ymd(o.Date))}')">➕ ${EN()?'Add a child to this day':'เพิ่มนักเรียนของวันนี้'}</button>
      </div>`).join(''):`<div class="card muted">${EN()?'No holiday OT this month':'ยังไม่มี OT วันหยุดในเดือนนี้'}</div>`}</div>
      <p class="muted" style="font-size:13px">${EN()
        ? 'The amount is a lump sum for the day: clocking in on it adds no hourly OT and counts no lateness. Children ticked for the day check in and out as usual.'
        : 'ยอดนี้เป็นเงินก้อนของทั้งวัน · การลงเวลาวันนั้นจะไม่คิด OT รายชั่วโมงเพิ่มและไม่นับสาย · นักเรียนที่อยู่ในรายชื่อจะรับ-ส่งได้ตามปกติ'}</p>
      <button class="btn outline block" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
    [...new Set(hol.map(o=>ymd(o.Date)))].forEach(async d=>{
      let l=null; try{ l=await api('holidayAttendList',{date:d}); }catch(e){}
      const el=document.getElementById('tho_'+d); if(!el)return;
      const dn=x=>EN()?(x.nickEN||x.nameEN||x.nick||x.name):(x.nick||x.name);
      el.innerHTML = (l&&l.count)
        ? `👶 ${EN()?'children':'นักเรียน'} (${l.count}): ${l.students.map(s=>`<b>${esc(dn(s))}</b> <small>${esc(s.inTime||'—')}→${esc(s.outTime||'—')}</small>`).join(' · ')}`
        : `👶 <span class="muted">${EN()?'no children — your clock only':'ไม่มีนักเรียน — เปิดเฉพาะการลงเวลาของคุณ'}</span>`;
    });
  };
  /**
   * A family turned up on a closed day with a child nobody put on the list. Refusing them at the
   * door with no way to say yes is not a safety rule, it is an obstacle — so a teacher can add the
   * name here, and the engine records who did it and when.
   */
  window.T_holAddStudent=async(date)=>{
    let list=A_CACHE.students;
    if(!list||!list.length){ try{ list=await api('listStudents'); A_CACHE.students=list; }catch(e){ list=[]; } }
    const d=date||todayStr();
    let already=[]; try{ already=((await api('holidayAttendList',{date:d}))||{}).students||[]; }catch(e){}
    const on={}; already.forEach(x=>{ on[x.studentId]=1; });
    const active=(list||[]).filter(s=>String(s.Status||'ACTIVE').toUpperCase()!=='WITHDRAWN' && !on[s.StudentID]);
    const isToday=(d===todayStr());
    modal(`<h3>➕ ${EN()?'Add a child to':'เพิ่มนักเรียนวันที่'} ${esc(isToday?(EN()?'today':'วันนี้'):ddmmyyyy(d))}</h3>
      <p class="muted" style="font-size:13px">${EN()
        ? 'The school is closed that day. Adding a name opens that child\'s check-in for it — everything else then works as usual.'
        : 'วันนั้นโรงเรียนหยุด · การเพิ่มชื่อจะเปิดการลงเวลาของนักเรียนคนนั้นสำหรับวันนั้น — ส่วนอื่นทำงานเหมือนวันปกติ'}</p>
      <input id="haFind" placeholder="🔎 ${EN()?'search by name or nickname':'ค้นหาชื่อ / ชื่อเล่น'}" oninput="A_editAttFilter(this.value)"/>
      <div id="eaList" style="max-height:52vh;overflow:auto;margin-top:8px">${active.map(s=>
        `<div class="list-item eaRow" data-k="${esc(((dispNick(s)||'')+' '+(nmSub(s)||'')+' '+(s.NameEN||'')).toLowerCase())}">
          <span>${studentAvatar(s)} <b>${esc(dispNick(s)||s.StudentID)}</b> <small class="muted">${esc(s.Class||'')}</small></span>
          <button class="btn sm green" onclick="T_holAddDo('${esc(s.StudentID)}','${esc(d)}',this)">➕ ${EN()?'Add':'เพิ่ม'}</button></div>`).join('')
        ||`<div class="card muted">${EN()?'Everyone is already on the list':'ทุกคนอยู่ในรายชื่อแล้ว'}</div>`}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.T_holAddDo=async(sid,date,btn)=>{ if(btn)btn.disabled=true;
    try{ await api('holidayAttendAdd',{staffId:USER.staffId,studentId:sid,date});
      const m=document.querySelector('.modal'); if(m)m.remove();
      confirmSaved(EN()?'Added — their check-in is open for that day':'เพิ่มแล้ว — เปิดการลงเวลาของวันนั้นให้แล้ว');
      if(date && date!==todayStr()) T_holidayOT(String(date).slice(0,7)); else GO('home');
    }catch(e){ err(e); if(btn)btn.disabled=false; } };
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
    const [cl,j,food]=await Promise.all([api('classList',tc()),api('getJournal',{studentId:sid,role:USER.role}),
      api('foodItems',{}).catch(()=>[])]);
    JFOOD=food||[];
    const s=cl.students.find(x=>x.StudentID===sid)||(A_CACHE.students||[]).find(x=>x.StudentID===sid)||{NameTH:sid};
    // which meals this class records (the baby class records none; Nursery 1 also eats dinner here),
    // and what the kitchen planned for today — used to pre-fill an empty slot
    JPLAN={};
    try{ const ms=await api('mealSlots',{className:s.Class||'',date:todayStr()});
      JSLOTS=ms.slots||JSLOTS; JPLAN=ms.planned||{}; }catch(e){}
    const sent=jTime(j), draft=jIsDraft(j), jv=journalValues(j);

    // once submitted the entry is final — show it read-only rather than a form that cannot save
    if(j && !draft){ app.innerHTML=`<button class="btn sm outline backbtn" onclick="J_exit()">${t('c.back')}</button>
      <h2 class="page">📒 ${esc(nm(s))}</h2>
      <div class="card" style="background:var(--ok-bg);color:var(--ok);font-size:13px">🔒 ${esc(t('jr.locked'))}${sent?` · ${esc(t('jr.sent'))} ${esc(sent)}`:''}</div>
      ${journalChecklist(j)}`; window.scrollTo(0,0); return; }

    const seg=(group,arr,multi)=>arr.map(v=>`<button type="button" data-g="${esc(group)}" data-v="${esc(v)}" onclick="J_pick('${group}','${v.replace(/'/g,"\\'")}',this,${multi})">${esc(jt(v))}</button>`).join('');
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="J_exit()">${t('c.back')}</button><h2 class="page">${draft?'✏️':'📒'} ${esc(draft?t('jr.edit'):t('lbl.record'))} — ${esc(nm(s))}</h2><div class="card">
      <div style="background:var(--warn-bg);border-radius:8px;padding:8px;color:var(--warn);font-size:13px;margin-bottom:8px">📝 ${esc(t('jr.draftHint'))}</div>
      <div class="jsec"><h4>😊 ${esc(jt('Mood'))} *</h4><div class="choice" id="g_Mood">${Object.keys(MOODS).map(m=>`<button type="button" data-g="Mood" data-v="${esc(m)}" onclick="J_pick('Mood','${m}',this,false)">${MOODS[m]} ${esc(jt(m))}</button>`).join('')}</div></div>
      <div class="jsec"><h4>❤️ ${esc(jt('Health'))}</h4><div class="choice">${seg('Health',HEALTHS,false)}</div>
        <div class="row" style="margin-top:6px"><input id="jHealthD" value="${esc(jv.healthDetail)}" placeholder="รายละเอียดสุขภาพ/ยา" style="flex:1"/><button class="micbtn" onclick="J_mic('jHealthD',this)" aria-label="${EN()?"Voice input":"พูดเพื่อกรอกข้อความ"}" title="${EN()?"Voice input":"พูดเพื่อกรอกข้อความ"}">🎤</button></div></div>
      <div class="jsec"><h4>🍼 ${esc(jt('Milk & Water'))}</h4>
        <div class="row" style="gap:8px;align-items:center"><select id="jMilkUnit" style="flex:0 0 auto">${[['box',EN()?'Box':'กล่อง'],['oz','Oz.']].map(([u,l])=>`<option value="${u}" ${jv.milkUnit===u?'selected':''}>${esc(l)}</option>`).join('')}</select>
          <select id="jMilkQty" style="flex:1">${['',...Array.from({length:20},(_,i)=>i+1)].map(n=>`<option value="${n}" ${String(jv.milkQty)===String(n)?'selected':''}>${n||'-'}</option>`).join('')}</select></div>
        <!-- "3 boxes" does not tell a parent whether the last one was at 09:00 or 16:00, which is
             exactly what they need to plan the evening feed. -->
        <label class="field" style="margin-top:6px"><span>${EN()?'Times fed':'เวลาที่กินนม'}</span>
          <input id="jMilkTimes" value="${esc(jv.milkTimes)}" placeholder="${EN()?'e.g. 09:00, 12:30, 15:00':'เช่น 09:00, 12:30, 15:00'}"/></label>
        <div class="choice" style="margin-top:6px">${seg('Water',WATERS,false)}</div></div>
      <!-- What the child ate AND how much. The dish comes from the school's master list; anything
           not on it can be typed and is added to the list on save, so the next teacher just picks it.
           Which meals appear depends on the class — the older classes do not eat dinner here. -->
      <div class="jsec"><h4>🍽 ${esc(jt('Meals'))}</h4><div id="jMealBox">${jMealRows(JSLOTS,jv)}</div></div>
      <div class="jsec"><h4>😴 ${esc(jt('Sleep'))}</h4><input id="jSleep" value="${esc(jv.sleep)}" placeholder="เช่น 12:30-14:00 (คั่นหลายช่วงด้วย ,)"/></div>
      <div class="jsec"><h4>🚽 ${esc(jt('Toileting'))}</h4>
        ${[['Urination',URI],['Bowel',BOWEL],['Stool',STOOL],['Training',TT]].map(([k,opts])=>`<div><b style="font-size:13px">${esc(jt(k==='Training'?'Toilet Training':k))}:</b> <span class="choice" style="display:inline-flex">${opts.map(x=>`<button type="button" data-tl="${esc(k)}" data-v="${esc(x)}" onclick="J_tl('${k}','${x}',this)">${esc(jt(x))}</button>`).join('')}</span></div>`).join('')}</div>
      <div class="jsec"><h4>🎨 ${esc(jt('Learning Journey'))}</h4><div class="choice">${seg('Activity',ACTS,true)}</div><input id="jTheme" value="${esc(jv.theme)}" placeholder="Theme / Topic" style="margin-top:6px"/></div>
      <div class="jsec"><h4>🌟 ${esc(jt('Skills'))}</h4><div class="choice">${seg('Skills',SKILLS,true)}</div></div>
      <div class="jsec"><h4>⭐ ${esc(jt('Highlight'))}</h4><div class="row"><textarea id="jHi" placeholder="เหตุการณ์น่าประทับใจ... (กดไมค์เพื่อพูด)" style="flex:1">${esc(jv.highlight)}</textarea><button class="micbtn" onclick="J_mic('jHi',this)" aria-label="${EN()?"Voice input":"พูดเพื่อกรอกข้อความ"}" title="${EN()?"Voice input":"พูดเพื่อกรอกข้อความ"}">🎤</button></div></div>
      <div class="savedock"><button class="btn block outline" onclick="T_saveJournal('${sid}',false)">${esc(t('jr.saveDraft'))}</button>
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
  // MilkTimes is stored as a JSON array in one cell; older journals have none.
  function jMilkTimes(j){ let v=(j&&j.MilkTimes)||[];
    if(typeof v==='string'){ try{ v=JSON.parse(v); }catch(e){ v=String(v).split(','); } }
    return (Array.isArray(v)?v:[]).map(x=>String(x).trim()).filter(x=>/^\d{1,2}:\d{2}$/.test(x)); }
  function journalValues(j){ j=j||{};
    // milk is now qty + unit (box|oz). Legacy journals stored Milk as an oz array → derive the total.
    const mq = Array.isArray(j.Milk) ? (j.Milk.reduce((a,b)=>a+(+b||0),0)||'') : (j.Milk!=null&&j.Milk!==''?Number(j.Milk):(j.MilkTotal||''));
    return { healthDetail: j.HealthDetail||'', theme: j.Theme||'', highlight: j.Highlight||'',
      milkQty: mq===0?'':mq, milkUnit: j.MilkUnit || (Array.isArray(j.Milk)?'oz':'box'),
      milkTimes: jMilkTimes(j).join(', '),
      sleep: jArr(j.Sleep).map(s=>`${s.from||''}-${s.to||''}`).filter(x=>x!=='-').join(', ') }; }
  window.J_pick=(g,v,el,multi)=>{ if(multi){ JSEL[g].has(v)?JSEL[g].delete(v):JSEL[g].add(v); el.classList.toggle('pass'); }
    else { JSEL[g]=v; [...el.parentElement.children].forEach(b=>b.classList.remove('pass')); el.classList.add('pass'); } };
  window.J_meal=(m,a,el)=>{ JSEL.Meals[m]=a; [...el.parentElement.children].forEach(b=>b.classList.remove('pass')); el.classList.add('pass'); };
  /* ---- meals: which dish, and how much ------------------------------------------------------
   * JSLOTS is set when the journal opens (it depends on the child's class); JFOOD is the master
   * list. A teacher who picks "➕ เพิ่มเมนูใหม่" gets a text box, and on save that dish is written
   * into the master so it is a normal choice from then on.
   */
  let JSLOTS=[{key:'Breakfast',th:'อาหารเช้า',en:'Breakfast'},{key:'Lunch',th:'อาหารกลางวัน',en:'Lunch'},{key:'Dinner',th:'อาหารเย็น',en:'Dinner'}];
  // what the monthly menu says is being served today, per meal — a DEFAULT for an empty slot only
  let JPLAN={};
  let JFOOD=[];
  const FOOD_CAT={savoury:()=>EN()?'Savoury':'ของคาว',dessert:()=>EN()?'Dessert':'ของหวาน',fruit:()=>EN()?'Fruit':'ผลไม้',other:()=>EN()?'Other':'อื่นๆ'};
  const foodLabel=i=>EN()?(i.nameEN||i.nameTH):(i.nameTH+(i.nameEN?` (${i.nameEN})`:''));
  /**
   * The dish picker, shared by the daily journal and the monthly menu editor so both offer exactly
   * the same catalogue. `list` defaults to the journal's copy; the menu editor passes its own.
   */
  function jFoodOptions(sel,list,blank){
    const L=list||JFOOD;
    const groups=['savoury','dessert','fruit','other'].map(c=>{
      const its=sortBy(L.filter(i=>i.category===c), foodLabel); if(!its.length) return '';
      return `<optgroup label="${esc(FOOD_CAT[c]())}">${its.map(i=>
        `<option value="${esc(i.nameTH)}"${i.nameTH===sel?' selected':''}>${esc(foodLabel(i))}</option>`).join('')}</optgroup>`;
    }).join('');
    // a dish already written on an older journal but since retired must still show, not vanish
    const orphan=sel&&!L.some(i=>i.nameTH===sel)?`<option value="${esc(sel)}" selected>${esc(sel)}</option>`:'';
    return `<option value="">${esc(blank||(EN()?'– not recorded –':'– ยังไม่ระบุ –'))}</option>${orphan}${groups}<option value="__new">➕ ${EN()?'Add a new dish…':'เพิ่มเมนูใหม่…'}</option>`;
  }
  function jMealRows(slots,jv){
    const items=(jv&&jv.mealItems)||{};
    // A slot the teacher has already filled keeps what they wrote; an empty one starts from what the
    // kitchen planned, so the usual case is confirm-and-move-on rather than retype.
    const chosen = k => items[k] || JPLAN[k] || '';
    if(!slots.length) return `<p class="muted" style="font-size:13px">${EN()?'This class records milk feeds rather than meals.':'ชั้นนี้บันทึกเป็นมื้อนมแทนมื้ออาหาร'}</p>`;
    return slots.map(s=>`<div style="margin:8px 0;padding:6px 0;border-top:1px solid var(--line)">
      <b style="font-size:13px">${esc(EN()?s.en:s.th)}</b>${(!items[s.key]&&JPLAN[s.key])?` <small style="color:var(--blue)">· ${EN()?'from the monthly menu':'จากเมนูประจำเดือน'}</small>`:''}
      <select id="jFood_${esc(s.key)}" style="width:100%;margin:4px 0" onchange="J_foodPick('${esc(s.key)}',this)">${jFoodOptions(chosen(s.key))}</select>
      <input id="jFoodNew_${esc(s.key)}" hidden placeholder="${EN()?'Dish name in Thai':'ชื่อเมนู (ภาษาไทย)'}" style="width:100%;margin-bottom:4px"/>
      <input id="jFoodNewEN_${esc(s.key)}" hidden placeholder="${EN()?'English name (optional)':'ชื่อภาษาอังกฤษ (ถ้ามี)'}" style="width:100%;margin-bottom:4px"/>
      <span class="choice" style="display:inline-flex">${MEAL_AMT.map(a=>`<button type="button" data-meal="${esc(s.key)}" data-v="${esc(a)}" class="${(JSEL.Meals||{})[s.key]===a?'pass':''}" onclick="J_meal('${s.key}','${a}',this)">${esc(jt(a))}</button>`).join('')}</span></div>`).join('');
  }
  window.J_foodPick=(k,sel)=>{ const isNew=sel.value==='__new';
    const a=document.getElementById('jFoodNew_'+k), b=document.getElementById('jFoodNewEN_'+k);
    if(a){ a.hidden=!isNew; if(isNew) a.focus(); } if(b) b.hidden=!isNew; };
  /** Collect the meals, registering any newly typed dish in the master list first. */
  async function jCollectMeals(){
    const items={};
    for(const s of JSLOTS){
      const sel=document.getElementById('jFood_'+s.key); if(!sel) continue;
      if(sel.value==='__new'){
        const th=(document.getElementById('jFoodNew_'+s.key)||{}).value||'';
        const en=(document.getElementById('jFoodNewEN_'+s.key)||{}).value||'';
        if(th.trim()){
          // add to the master so the next teacher just picks it from the list
          try{ await api('saveFoodItem',{staffId:USER.staffId,item:{nameTH:th.trim(),nameEN:en.trim(),category:'other'}}); }catch(e){}
          items[s.key]=th.trim();
        }
      } else if(sel.value) items[s.key]=sel.value;
    }
    return items;
  }
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
    // accept "9:00, 12.30 15:00" and keep only what is really a time — a typo must not be stored
    const milkTimes=(($('#jMilkTimes')||{}).value||'').split(/[,\s]+/).map(x=>x.trim().replace('.',':'))
      .filter(x=>/^\d{1,2}:\d{2}$/.test(x)).map(x=>('0'+x).slice(-5));
    const sleep=($('#jSleep').value||'').split(',').map(x=>x.trim()).filter(Boolean).map(s=>({from:(s.split('-')[0]||'').trim(),to:(s.split('-')[1]||'').trim()}));
    // any dish typed as new is registered in the master list here, before the journal is written
    const mealItems=await jCollectMeals();
    try{ const r=await api('submitJournal',{studentId:sid,staffId:USER.staffId,submit:!!submit,Mood:JSEL.Mood,Health:JSEL.Health,HealthDetail:$('#jHealthD').value,Milk:milkQty,MilkUnit:milkUnit,MilkTotal:milkQty,MilkTimes:milkTimes,Water:JSEL.Water,Meals:JSEL.Meals,MealItems:mealItems,Sleep:sleep,Toilet:JSEL.Toilet,Activity:[...JSEL.Activity],Theme:$('#jTheme').value,Skills:[...JSEL.Skills],Highlight:$('#jHi').value});
      confirmSaved(r.submitted?(EN()?'Sent to the parent':'ส่งให้ผู้ปกครองแล้ว'):(EN()?'Draft saved — not sent yet':'บันทึกร่างแล้ว — ยังไม่ได้ส่ง')); J_exit(); }catch(e){err(e);} };

  // ===== injury / accident report (แบบบันทึกการบาดเจ็บรายบุคคล) — teacher & leader =====
  // ลักษณะการบาดเจ็บ ๑–๑๔ — the legend on page 2 of the official form; the number is what is stored.
  const INJ_CHARS=[
    {n:1, th:'บาดแผลถลอก', en:'Abrasion'}, {n:2, th:'บาดแผลฉีกขาด', en:'Laceration'},
    {n:3, th:'บาดแผลถูกแทง', en:'Puncture wound'}, {n:4, th:'ฟกช้ำ', en:'Bruise / contusion'},
    {n:5, th:'บาดแผลจากวัตถุระเบิดหรือกระสุนปืน', en:'Blast / gunshot wound'},
    {n:6, th:'บิดแพลง / เคล็ดขัดยอก', en:'Sprain / strain'}, {n:7, th:'กระดูกเคลื่อนหรือหัก', en:'Dislocation / fracture'},
    {n:8, th:'แผลไหม้ น้ำร้อนลวก', en:'Burn / scald'}, {n:9, th:'ไฟฟ้าดูด / ช็อต', en:'Electric shock'},
    {n:10,th:'สารพิษ / พิษแมลง', en:'Poison / insect venom'}, {n:11,th:'ขาดอากาศหายใจ', en:'Asphyxia'},
    {n:12,th:'บาดเจ็บทรวงอก–อวัยวะช่องท้อง', en:'Chest / abdominal injury'},
    {n:13,th:'บาดเจ็บสมอง', en:'Brain injury'}, {n:14,th:'อื่นๆ', en:'Other'}];
  // การช่วยเหลือการบาดเจ็บ — where the child was treated (page 2, right-hand column)
  const INJ_TREAT_PLACES=[['nurse','ห้องพยาบาลของโรงเรียน','School nurse room'],
    ['health','ศูนย์บริการสาธารณสุข / สถานีอนามัย','Public health centre'],['clinic','คลินิก','Clinic'],
    ['hosp_gov','โรงพยาบาลรัฐบาล','Government hospital'],['hosp_pri','โรงพยาบาลเอกชน','Private hospital'],
    ['dentist','ทันตแพทย์','Dentist'],['other','อื่นๆ','Other']];
  const injTL=o=>EN()?o.en:o.th;
  // stored codes, whatever shape they came back in (array, JSON string, or "1,2")
  function injCodes(v){ let a=v; if(typeof a==='string'&&a){ try{ a=JSON.parse(a); }catch(e){ a=String(a).split(/[,\s]+/).filter(Boolean); } }
    return (Array.isArray(a)?a:[]).map(String); }
  // Wounds is stored as a JSON string: [{pos, char}]
  function injWounds(v){ let a=v; if(typeof a==='string'&&a){ try{ a=JSON.parse(a); }catch(e){ a=[]; } }
    return Array.isArray(a)?a:[]; }

  /**
   * THE injury form — one builder, used to file a new report and to correct an existing one, so a
   * field cannot exist on one path and be quietly missing from the other.
   *
   * `pfx` prefixes every id and radio name. The correction modal can be opened ON TOP of the filing
   * screen, and two elements sharing an id would hand the save handler the wrong one without a word.
   */
  function injFormHTML(pfx, o){
    o=o||{}; const r=o.r||{}, edit=!!o.r;
    const id=s=>pfx+s, V=v=>esc(v==null?'':String(v));
    // the label is a <span> so .chk-inline can keep it beside the control instead of under it
    const radio=(name,val,label,on)=>`<label class="chk-inline"><input type="radio" name="${pfx+name}" value="${val}" ${on?'checked':''}/><span>${esc(label)}</span></label>`;
    const types=injCodes(r.InjuryTypes), wounds=injWounds(r.Wounds), tPlaces=injCodes(r.TreatmentPlaces);
    const photos=[r.Photo1,r.Photo2,r.Photo3];
    const aff=String(r.AffiliationType||'social'), sex=String(r.Sex||'').toUpperCase();
    const edu=String(r.EduStatus||'grade'), wit=String(r.Witness||'unsure'), place=String(r.Place||'school');
    const treat=String(r.TreatmentType||'');
    return `<div id="${id('injForm')}" data-ph1="${V(photos[0])}" data-ph2="${V(photos[1])}" data-ph3="${V(photos[2])}">
      <div class="card">
        <div class="grid2"><label class="field"><span>${esc(t('inj.date'))}</span><input type="date" id="${id('injDate')}" value="${V(edit?String(r.Date||'').slice(0,10):todayStr())}"/></label>
          <label class="field"><span>${esc(t('inj.time'))}</span><input type="time" id="${id('injTime')}" value="${V(edit?String(r.Time||'').slice(0,5):nowTime())}"/></label></div>
        <label class="field"><span>${esc(t('inj.center'))}</span><input id="${id('injCenter')}" value="${V(edit?r.CenterName:(MOCK.config.SchoolName||''))}"/></label>
        <div class="jsec"><h4>${esc(t('inj.affiliation'))}</h4>
          ${radio('injAff','social',t('inj.aff.social'),aff!=='other')} ${radio('injAff','other',t('inj.aff.other'),aff==='other')}
          <input id="${id('injAffOther')}" placeholder="${esc(t('inj.aff.other'))}" value="${V(r.AffiliationOther)}" style="margin-top:6px"/>
          <label class="field" style="margin-top:6px"><span>${esc(t('inj.district'))}</span><input id="${id('injDistrict')}" value="${V(r.District)}"/></label></div>
        <label class="field"><span>${esc(t('inj.recorder'))}</span><input id="${id('injRecorder')}" value="${V(edit?r.RecorderName:(EN()?USER.nameEN:USER.nameTH))}"/></label>
      </div>
      <div class="card"><h3>👶 ${esc(t('inj.child'))}</h3>
        ${edit ? `<div class="list-item"><span class="muted">${esc(t('inj.child'))}</span><b>${esc(r.nick||r.ChildName||r.StudentID)}</b></div>`
               : `<label class="field"><span>${esc(t('inj.selectChild'))}</span><select id="${id('injChild')}">${(o.students||[]).map(s=>`<option value="${s.StudentID}">${esc(nm(s))} (${esc(ageYM(s.DOB))})</option>`).join('')}</select></label>`}
        <div class="jsec"><h4>${esc(t('inj.sex'))}</h4>${radio('injSex','M',t('inj.male'),sex==='M')} ${radio('injSex','F',t('inj.female'),sex==='F')}</div>
        <div class="grid2"><label class="field"><span>${esc(t('inj.age'))} (${esc(t('inj.years'))})</span><input type="number" id="${id('injAgeY')}" value="${V(r.AgeYears)}" placeholder="–"/></label><label class="field"><span>${esc(t('inj.age'))} (${esc(t('inj.months'))})</span><input type="number" id="${id('injAgeM')}" value="${V(r.AgeMonths)}" placeholder="–"/></label></div>
        <div class="jsec"><h4>${esc(t('inj.edu'))}</h4>${radio('injEdu','none',t('inj.edu.none'),edu==='none')} ${radio('injEdu','grade',t('inj.edu.grade'),edu!=='none')}
          <input id="${id('injGrade')}" placeholder="${esc(t('inj.edu.grade'))}" value="${V(edit?r.EduGrade:'')}" style="margin-top:6px"/></div>
      </div>
      <div class="card"><h3>📝 ${esc(t('inj.narrative'))}</h3><p class="muted" style="font-size:13px">${esc(t('inj.narrativeHint'))}</p>
        <textarea id="${id('injNarr')}" rows="3">${V(r.Narrative)}</textarea>
        <label class="field" style="margin-top:8px"><span>${esc(t('inj.cause'))}</span><input id="${id('injCause')}" placeholder="${esc(t('inj.causePh'))}" value="${V(r.CauseObject)}"/></label>
        <div class="jsec"><h4>${esc(t('inj.witness'))}</h4>${radio('injWit','yes',t('inj.witness.yes'),wit==='yes')} ${radio('injWit','no',t('inj.witness.no'),wit==='no')} ${radio('injWit','unsure',t('inj.witness.unsure'),wit!=='yes'&&wit!=='no')}</div>
      </div>
      <div class="card"><h3>📍 ${esc(t('inj.place'))}</h3>
        ${PLACE_OPTS.map(p=>radio('injPlace',p[0],t(p[1]),place===p[0])).join(' ')}
        <input id="${id('injPlaceOther')}" placeholder="${esc(t('inj.place.other'))}" value="${V(r.PlaceOther)}" style="margin-top:6px"/></div>
      <div class="card"><h3>🩹 ${esc(t('inj.types'))}</h3>
        ${INJURY_TYPES.map(it=>`<label class="chk-inline"><input type="checkbox" class="injType" value="${it.n}" ${types.indexOf(String(it.n))>=0?'checked':''}/><span><b>${it.n}.</b> ${esc(injTL(it))}</span></label>`).join('')}</div>

      <div class="card"><h3>🖼️ ${EN()?'Photos of the injury':'รูปการบาดเจ็บ'}</h3>
        <p class="muted" style="font-size:13px;margin-top:-4px">${EN()?'Up to 3. They are stored with the report and shown to the parents only if you share it below.':'ได้สูงสุด 3 รูป · เก็บไว้กับรายงาน และจะให้ผู้ปกครองเห็นก็ต่อเมื่อเลือกแนบสมุดรายวันด้านล่าง'}</p>
        ${[0,1,2].map(i=>photoField(id('injPh'+(i+1)), (EN()?'Photo ':'รูปที่ ')+(i+1), photos[i]||'')).join('')}</div>

      <div class="card"><h3>👪 ${EN()?'Who sees this report':'ใครเห็นรายงานนี้'}</h3>
        ${radio('injShare','keep',EN()?'Keep in the system only (school + authority)':'เก็บไว้ในระบบเท่านั้น (โรงเรียน/หน่วยงานราชการ)',String(r.ShareJournal||'').toUpperCase()!=='YES')}
        ${radio('injShare','journal',EN()?'Also attach to the daily journal for the parents':'แนบไปกับสมุดรายวันให้ผู้ปกครองทราบด้วย',String(r.ShareJournal||'').toUpperCase()==='YES')}
        <p class="muted" style="font-size:13px;margin:6px 2px 0">${EN()?'Attaching shows the account, the photos and the treatment on that day’s journal. It does not wait for approval.':'ถ้าแนบ ผู้ปกครองจะเห็นเหตุการณ์ รูป และการรักษาในสมุดรายวันของวันนั้น · ไม่ต้องรออนุมัติ'}</p></div>

      <div class="card"><h3>📄 ${EN()?'Page 2 — wounds & treatment':'หน้า 2 — บาดแผลและการรักษา'}</h3>
        <p class="muted" style="font-size:13px;margin-top:-4px">${EN()?'Fill in what you can; anything left blank prints as an empty line on the official form.':'กรอกเท่าที่มี · ช่องที่เว้นไว้จะพิมพ์เป็นเส้นว่างในแบบฟอร์มราชการ'}</p>
        ${[0,1,2,3,4,5,6,7].map(i=>{ const wnd=wounds[i]||{};
          return `<div class="grid2" style="gap:6px;margin-bottom:4px">
            <label class="field" style="margin:0"><span>${EN()?'Wound ':'บาดแผลที่ '}${i+1} · ${EN()?'position':'ตำแหน่ง'}</span><input id="${id('injW'+i+'p')}" value="${V(wnd.pos)}" placeholder="${EN()?'e.g. left forearm':'เช่น แขนซ้ายท่อนล่าง'}"/></label>
            <label class="field" style="margin:0"><span>${EN()?'nature':'ลักษณะ'}</span><select id="${id('injW'+i+'c')}"><option value="">–</option>${INJ_CHARS.map(c=>`<option value="${c.n}" ${String(wnd.char||'')===String(c.n)?'selected':''}>${c.n}. ${esc(injTL(c))}</option>`).join('')}</select></label></div>`; }).join('')}
        <div class="jsec"><h4>${EN()?'Help given':'การช่วยเหลือการบาดเจ็บ'}</h4>
          ${radio('injTreat','none',EN()?'No treatment needed':'ไม่ต้องรับการรักษาใดๆ',treat==='none')}
          ${radio('injTreat','treated',EN()?'Received treatment':'ได้รับการรักษาพยาบาล',treat==='treated')}
          <label class="field" style="margin-top:6px"><span>${EN()?'Treated at':'รักษาที่'}</span><input id="${id('injTreatBy')}" value="${V(r.TreatmentBy)}" placeholder="${EN()?'name of the place / person':'ชื่อสถานที่ / ผู้ให้การรักษา'}"/></label>
          <div class="chk-cols" style="margin-top:4px">${INJ_TREAT_PLACES.map(p=>`<label class="chk-inline"><input type="checkbox" class="injTP" value="${p[0]}" ${tPlaces.indexOf(p[0])>=0?'checked':''}/><span>${esc(EN()?p[2]:p[1])}</span></label>`).join('')}</div>
          <input id="${id('injTreatOther')}" placeholder="${EN()?'Other — specify':'อื่นๆ ระบุ'}" value="${V(r.TreatmentPlaceOther)}" style="margin-top:6px"/></div>
      </div>

      <label class="field" style="display:flex;align-items:center;gap:8px;background:var(--warn-bg);border:1px solid var(--warn-line);border-radius:10px;padding:10px"><input type="checkbox" id="${id('injNotifyParent')}" ${String(r.NotifyParent||'')==='YES'?'checked':''} style="width:auto"/> 👪 <b>${EN()?'Also notify the parent now (accident/emergency)':'แจ้งเตือนผู้ปกครองด้วยทันที (กรณีอุบัติเหตุ/ฉุกเฉิน)'}</b></label>
      <p class="muted" style="font-size:13px;margin:-2px 2px 6px">${EN()?'Admins & leaders are always alerted. Tick this to also LINE the parents right away.':'ระบบแจ้งแอดมิน/หัวหน้าครูทุกครั้งอยู่แล้ว · ติ๊กช่องนี้เพื่อส่ง LINE ถึงผู้ปกครองทันทีด้วย'}</p>
    </div>`;
  }
  /** Read the form back. Scoped to its own container, so the modal and the screen never cross. */
  function injFormVals(pfx){
    const box=document.getElementById(pfx+'injForm')||document;
    const v=s=>{ const e=box.querySelector('#'+pfx+s); return e?String(e.value).trim():''; };
    const rad=n=>{ const e=box.querySelector(`input[name="${pfx+n}"]:checked`); return e?e.value:''; };
    const wounds=[]; for(let i=0;i<8;i++){ const pos=v('injW'+i+'p'), ch=v('injW'+i+'c');
      if(pos||ch) wounds.push({no:i+1,pos,char:ch}); }
    return {
      date:v('injDate'), time:v('injTime'), centerName:v('injCenter'),
      affiliationType:rad('injAff'), affiliationOther:v('injAffOther'), district:v('injDistrict'),
      recorderName:v('injRecorder'), sex:rad('injSex'),
      ageYears:v('injAgeY')!==''?+v('injAgeY'):undefined, ageMonths:v('injAgeM')!==''?+v('injAgeM'):undefined,
      eduStatus:rad('injEdu'), eduGrade:v('injGrade'), narrative:v('injNarr'), causeObject:v('injCause'),
      witness:rad('injWit'), place:rad('injPlace'), placeOther:v('injPlaceOther'),
      injuryTypes:[...box.querySelectorAll('.injType:checked')].map(c=>Number(c.value)),
      notifyParent:!!(box.querySelector('#'+pfx+'injNotifyParent')||{}).checked,
      shareJournal:rad('injShare')==='journal',
      // a picked photo wins; otherwise KEEP the one already on the report. Sending '' for a slot the
      // editor never touched would erase a picture of a child's injury on every correction.
      photos:[0,1,2].map(i=>photoVal(box,pfx+'injPh'+(i+1)) || (box.dataset?box.dataset['ph'+(i+1)]:'') || ''),
      wounds, treatmentType:rad('injTreat'), treatmentBy:v('injTreatBy'),
      treatmentPlaces:[...box.querySelectorAll('.injTP:checked')].map(c=>c.value),
      treatmentPlaceOther:v('injTreatOther')
    };
  }
  SCREENS.Teacher.injury = async () => {
    const [cl,recent]=await Promise.all([api('classList',tc()),api('injuryReports',{})]);
    app.innerHTML=`<h2 class="page">🚑 ${esc(t('inj.title'))}</h2>
      ${injFormHTML('',{students:cl.students})}
      <button class="btn block pink" onclick="T_injurySave()">${esc(t('inj.save'))}</button>
      <div class="card" style="margin-top:12px"><h3>🗒️ ${esc(t('inj.recent'))}</h3><div id="injRecent">${injuryListHTML(recent)}</div></div>`;
  };
  /* ---- injury approval: teacher → หัวหน้าครู → แอดมิน ----------------------------------------
   * The same two steps as a leave request, and shown the same way, so nobody has to learn a second
   * vocabulary. The emergency notification is NOT part of this: it goes out when the teacher saves,
   * because a hurt child cannot wait for a signature. This chain is about the DOCUMENT.
   */
  const INJ_STATUS = {
    PENDING_LEADER: ()=>EN()?'Waiting for the head teacher':'รอหัวหน้าครู',
    PENDING_ADMIN:  ()=>EN()?'Waiting for the admin':'รอแอดมิน',
    APPROVED:       ()=>EN()?'Approved':'อนุมัติแล้ว',
    REJECTED:       ()=>EN()?'Sent back':'ตีกลับให้แก้ไข'
  };
  const injStatus = r => String((r&&r.Status)||'PENDING_LEADER').toUpperCase();
  function injStatusPill(r){ const s=injStatus(r);
    const cls = s==='APPROVED'?'ok' : s==='REJECTED'?'bad' : 'wait';
    return `<span class="pill ${cls}" style="font-size:11px">${esc((INJ_STATUS[s]||INJ_STATUS.PENDING_LEADER)())}</span>`;
  }
  function injuryListHTML(rows){ if(!rows||!rows.length)return `<small class="muted">${esc(t('c.noItems'))}</small>`;
    return rows.slice(0,10).map(r=>{ const types=injTypeNames(r.InjuryTypes);
      return `<div class="list-item" onclick="A_viewInjury('${esc(r.InjuryID||'')}')" style="cursor:pointer"><span><b>${esc(EN()?(r.nameEN||r.ChildName):r.ChildName)}</b> <small class="muted">${esc(ddmmyyyy(r.Date))} ${esc(r.Time)}</small><br><small class="muted">${esc(types)}</small></span><span>${injStatusPill(r)} <span class="muted">›</span></span></div>`; }).join(''); }
  // injury type codes → the official form's wording. Stored as numbers; may arrive as a JSON string.
  function injTypeNames(v){ let a=v; if(typeof a==='string'&&a){ try{ a=JSON.parse(a); }catch(e){ a=String(a).split(/[,\s]+/).filter(Boolean); } }
    return (Array.isArray(a)?a:[]).map(n=>{ const it=INJURY_TYPES.find(x=>String(x.n)===String(n)); return it?(EN()?it.en:it.th):n; }).join(', '); }

  /** The pictures on a report — nothing at all when there are none, rather than an empty box. */
  function injPhotosHTML(r){ const ph=[r.Photo1,r.Photo2,r.Photo3].filter(Boolean); if(!ph.length) return '';
    return `<div class="card" style="padding:8px"><b style="font-size:13px">🖼️ ${EN()?'Photos':'รูปการบาดเจ็บ'}</b>
      <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">${ph.map(u=>`<img src="${esc(u)}" onclick="IMG_zoom('${esc(u)}')" style="width:96px;height:96px;object-fit:cover;border-radius:8px;cursor:zoom-in"/>`).join('')}</div></div>`; }
  /** Page 2 as recorded: the wounds and what was done about them. */
  function injPage2HTML(r){
    const wounds=injWounds(r.Wounds), tType=String(r.TreatmentType||'');
    const places=injCodes(r.TreatmentPlaces).map(c=>{ const p=INJ_TREAT_PLACES.find(x=>x[0]===c); return p?(EN()?p[2]:p[1]):c; });
    if(!wounds.length && !tType && !places.length && !r.TreatmentBy) return '';
    const charName=n=>{ const c=INJ_CHARS.find(x=>String(x.n)===String(n)); return c?injTL(c):''; };
    return `<div class="card" style="padding:8px"><b style="font-size:13px">🩺 ${EN()?'Wounds & treatment':'บาดแผลและการรักษา'}</b>
      ${wounds.map(w=>`<div style="margin-top:4px;font-size:13px">• ${esc(w.pos||'-')}${w.char?` <span class="muted">(${esc(charName(w.char))})</span>`:''}</div>`).join('')}
      ${tType?`<div style="margin-top:6px;font-size:13px">${tType==='none'?(EN()?'No treatment needed':'ไม่ต้องรับการรักษาใดๆ'):(EN()?'Received treatment':'ได้รับการรักษาพยาบาล')}${r.TreatmentBy?' · '+esc(r.TreatmentBy):''}</div>`:''}
      ${places.length?`<div class="muted" style="font-size:13px">${esc(places.join(' · '))}${r.TreatmentPlaceOther?' · '+esc(r.TreatmentPlaceOther):''}</div>`:''}</div>`; }

  // ---- Admin: read the injury reports teachers file, and the month at a glance -------------------
  // An emergency notification used to land on the dashboard, so the admin was told an accident had
  // happened but had no way to read what the teacher actually wrote. This is that screen.
  let INJ_MONTH=null;
  SCREENS.Admin.injuries = async () => A_injuries();
  window.A_injuries=async(month)=>{ INJ_MONTH=month||INJ_MONTH||monthStr();
    const sum=await api('injurySummary',{month:INJ_MONTH});
    const bar=(rows,total)=>rows.map(r=>`<div style="margin-top:5px"><div class="spread" style="font-size:13px"><span>${esc(r.label||r.key)}</span><b>${r.count}</b></div>
      <div style="height:6px;background:var(--surface-3);border-radius:3px;overflow:hidden"><div style="height:100%;width:${total?Math.round(r.count/total*100):0}%;background:var(--bad-2)"></div></div></div>`).join('');
    const byType=(sum.byType||[]).map(r=>({label:injTypeNames([r.key]),count:r.count}));
    app.innerHTML=`<h2 class="page">🚑 ${EN()?'Injury reports':'รายงานอุบัติเหตุ'}</h2>
      <div class="card"><label class="field" style="margin:0"><span>${esc(t('c.month'))}</span>
        <input type="month" value="${esc(sum.month)}" onchange="A_injuries(this.value)"/></label></div>
      <div class="kpis">
        <div class="kpi"><span class="kic">🚑</span><b class="kn" style="color:${sum.total?'var(--bad)':'var(--ok)'}">${sum.total}</b><span class="kl">${EN()?'Reports this month':'รายงานเดือนนี้'}</span></div>
        <div class="kpi"><span class="kic">👶</span><b class="kn">${sum.students}</b><span class="kl">${EN()?'Children involved':'จำนวนเด็กที่เกี่ยวข้อง'}</span></div>
      </div>
      ${sum.total?`
      <div class="card"><h3>🩹 ${EN()?'By injury type':'แยกตามชนิดการบาดเจ็บ'}</h3>${bar(byType,sum.total)}</div>
      <div class="card"><h3>🏫 ${EN()?'By class':'แยกตามชั้นเรียน'}</h3>${bar((sum.byClass||[]).map(r=>({label:r.key,count:r.count})),sum.total)}</div>
      <div class="card"><h3>📋 ${EN()?'Reports':'รายการทั้งหมด'}</h3>
        ${sum.reports.map(r=>`<div class="list-item" onclick="A_viewInjury('${esc(r.injuryId)}')" style="cursor:pointer">
          <span><b>${esc(r.nick||r.name||r.studentId)}</b> <small class="muted">${esc(r.className||'')}</small><br>
          <small class="muted">${esc(ddmmyyyy(r.date))} ${esc(r.time)} · ${esc(injTypeNames(r.types))}</small></span><span class="muted">›</span></div>`).join('')}</div>`
      : `<div class="card" style="text-align:center;color:var(--ok);padding:18px"><div style="font-size:34px">🎉</div><b>${EN()?'No injuries reported this month':'เดือนนี้ไม่มีรายงานอุบัติเหตุ'}</b></div>`}`;
  };
  // one report, exactly as the teacher filed it
  window.A_viewInjury=async(id)=>{ if(!id){ GO('injuries'); return; }
    let r=null; try{ r=await api('injuryReport',{injuryId:id}); }catch(e){ err(e); return; }
    const row=(lbl,val)=>val?`<div class="list-item"><span class="muted">${esc(lbl)}</span><span style="text-align:right;max-width:60%">${esc(val)}</span></div>`:'';
    modal(`<h3>🚑 ${EN()?'Injury report':'รายงานอุบัติเหตุ'}</h3>
      <div class="card" style="background:var(--bad-bg);border-color:var(--bad-line);padding:8px">
        <b style="font-size:16px">${esc(r.nick||r.ChildName||r.StudentID)}</b> <small class="muted">${esc(r.className||'')}</small><br>
        <small class="muted">${esc(ddmmyyyy(r.Date))} ${esc(r.Time)} ${r.teacherNick||r.teacherName?'· '+esc(EN()?'reported by ':'ผู้บันทึก ')+esc(r.teacherNick||r.teacherName):''}</small></div>
      <div class="card" style="padding:8px"><b style="font-size:13px">🩹 ${EN()?'Injury type':'ชนิดการบาดเจ็บ'}</b>
        <div style="margin-top:4px">${esc(injTypeNames(r.InjuryTypes))||'-'}</div></div>
      ${r.Narrative?`<div class="card" style="padding:8px"><b style="font-size:13px">📝 ${EN()?'What happened':'เหตุการณ์'}</b><div style="margin-top:4px;white-space:pre-wrap">${esc(r.Narrative)}</div></div>`:''}
      <div class="card" style="padding:4px 8px">
        ${row(EN()?'Place':'สถานที่', [r.Place,r.PlaceOther].filter(Boolean).join(' · '))}
        ${row(EN()?'Cause / object':'สาเหตุ/สิ่งที่ทำให้บาดเจ็บ', r.CauseObject)}
        ${row(EN()?'Witness':'พยาน', r.Witness)}
        ${row(EN()?'Parent notified':'แจ้งผู้ปกครองแล้ว', String(r.NotifyParent||'')==='YES'?(EN()?'Yes':'แจ้งแล้ว'):(EN()?'No':'ยังไม่แจ้ง'))}
        ${row(EN()?'Shown to parents':'แสดงให้ผู้ปกครอง', String(r.ShareJournal||'').toUpperCase()==='YES'
          ? (EN()?'Attached to the daily journal':'แนบในสมุดรายวัน') : (EN()?'Kept in the system only':'เก็บในระบบเท่านั้น'))}
        ${row(EN()?'Report no.':'เลขที่รายงาน', r.InjuryID)}
      </div>
      ${injPhotosHTML(r)}
      ${injPage2HTML(r)}
      <div class="card" style="padding:8px">
        <div class="spread"><b style="font-size:13px">✅ ${EN()?'Approval':'การอนุมัติ'}</b>${injStatusPill(r)}</div>
        <div style="margin-top:4px;font-size:13px">
          <div>1. ${EN()?'Head teacher':'หัวหน้าครู'}: ${r.LeaderBy?`<b>${esc(r.LeaderBy)}</b> <small class="muted">${esc(r.LeaderAt||'')}</small>`:`<span class="muted">${EN()?'not yet':'ยังไม่ดำเนินการ'}</span>`}</div>
          <div>2. ${EN()?'Admin':'แอดมิน'}: ${r.AdminBy?`<b>${esc(r.AdminBy)}</b> <small class="muted">${esc(r.AdminAt||'')}</small>`:`<span class="muted">${EN()?'not yet':'ยังไม่ดำเนินการ'}</span>`}</div>
          ${r.RejectReason?`<div style="color:var(--bad);margin-top:4px">↩️ ${esc(r.RejectReason)}</div>`:''}
          ${r.UpdatedBy?`<div class="muted" style="margin-top:4px">✏️ ${EN()?'last edited by':'แก้ไขล่าสุดโดย'} ${esc(r.UpdatedBy)} ${esc(r.UpdatedAt||'')}</div>`:''}
        </div>
        ${injCanDecide(r)?`<div class="row" style="gap:8px;margin-top:8px">
          <button class="btn" style="flex:1" onclick="A_injDecide('${esc(r.InjuryID)}','approve',this)">✅ ${EN()?'Approve':'อนุมัติ'}</button>
          <button class="btn pink" style="flex:1" onclick="A_injDecide('${esc(r.InjuryID)}','reject',this)">↩️ ${EN()?'Send back':'ตีกลับ'}</button></div>`:''}
        ${injCanEdit(r)?`<button class="btn sm outline block" style="margin-top:8px" onclick="A_injEdit('${esc(r.InjuryID)}')">✏️ ${EN()?'Correct this report':'แก้ไขรายงาน'}</button>`:''}
        ${isAdmin()?`<div class="row" style="gap:8px;margin-top:8px">
          ${injStatus(r)==='APPROVED'?`<button class="btn sm outline" style="flex:1" onclick="A_injUnlock('${esc(r.InjuryID)}',this)">🔓 ${EN()?'Unlock to edit':'ปลดล็อกให้แก้ไข'}</button>`:''}
          <button class="btn sm pink" style="flex:1" onclick="A_injDelete('${esc(r.InjuryID)}',this)">🗑️ ${EN()?'Delete':'ลบรายงาน'}</button></div>`:''}
      </div>
      <div class="row" style="gap:8px">
        <button class="btn" style="flex:1" onclick="A_injuryPdf('${esc(r.InjuryID||'')}',this)">📄 ${EN()?'Official form (PDF)':'แบบฟอร์มราชการ (PDF)'}</button>
        <button class="btn outline" style="flex:1" onclick="A_injuryPdf('${esc(r.InjuryID||'')}',this,'jpg')">🖼️ ${EN()?'Image':'รูป'}</button></div>
      <p class="muted" style="font-size:12px;margin:6px 2px">${EN()?'The body diagram on page 2 is printed blank for the wound positions to be marked by hand; everything recorded here is printed in place. Photos are not printed — they stay in the app.':'ภาพตำแหน่งบาดแผลในหน้า 2 พิมพ์เป็นภาพเปล่าให้ทำเครื่องหมายด้วยมือ · ข้อมูลที่บันทึกไว้จะพิมพ์ให้ครบทุกช่อง · รูปถ่ายไม่ถูกพิมพ์ลงฟอร์ม เก็บไว้ในระบบ'}</p>
      <button class="btn outline block" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`); };
  /**
   * The filled-in official form, built on this device. The report holds a child's health data, so it
   * follows the same PDPA rule as the report card: drawn in the browser, downloaded, never uploaded
   * and never given a shareable URL.
   */
  /**
   * Is it THIS person's turn? The server decides for real (approveInjury); this only decides whether
   * to offer a button, so nobody is shown one that will be refused.
   */
  const isAdmin = () => USER.role==='Admin';
  /**
   * USER.role is 'Teacher' for a head teacher too — being a leader lives on the STAFF RECORD
   * (PositionLevel), which is why the home screen reads staffSelf to decide its leader-only cards.
   * It stores the answer here so every other screen uses that same one rather than guessing from
   * the role name, which reads "คุณครู" for a leader and would hide the approve button from them.
   */
  const isLeaderRole = () => USER.role==='Admin' || USER.role==='Leader' || USER._isLeader===true;
  function injCanDecide(r){ const s=injStatus(r);
    if(s==='PENDING_LEADER') return isLeaderRole();
    if(s==='PENDING_ADMIN') return isAdmin();
    return false;
  }
  window.A_injDecide=async(id,decision,btn)=>{
    let reason='';
    if(decision==='reject'){
      reason=String(prompt(EN()?'Why is it being sent back? (the teacher will see this)':'ตีกลับเพราะอะไร? (ผู้บันทึกจะเห็นข้อความนี้)')||'').trim();
      if(!reason) return;                       // cancelled — nothing happens
    }
    if(btn)btn.disabled=true;
    try{ const r=await api('approveInjury',{staffId:USER.staffId,injuryId:id,decision,reason});
      confirmSaved(decision==='approve'?(EN()?'Approved':'อนุมัติแล้ว'):(EN()?'Sent back':'ตีกลับแล้ว'));
      const m=document.querySelector('.modal'); if(m)m.remove(); A_viewInjury(id);
    }catch(e){ err(e); if(btn)btn.disabled=false; } };
  window.A_injUnlock=async(id,btn)=>{
    if(!confirm(EN()?'Unlock this report so it can be corrected? It goes back to the head teacher for approval.'
                    :'ปลดล็อกรายงานนี้เพื่อแก้ไข? สถานะจะกลับไปรออนุมัติจากหัวหน้าครูอีกครั้ง')) return;
    if(btn)btn.disabled=true;
    try{ await api('unlockInjury',{staffId:USER.staffId,injuryId:id});
      confirmSaved(EN()?'Unlocked':'ปลดล็อกแล้ว');
      const m=document.querySelector('.modal'); if(m)m.remove(); A_viewInjury(id);
    }catch(e){ err(e); if(btn)btn.disabled=false; } };
  window.A_injDelete=async(id,btn)=>{
    if(!confirm(EN()?'Delete this injury report for good? This is the record of an accident to a child.'
                    :'ลบรายงานอุบัติเหตุนี้ถาวร? นี่คือบันทึกอุบัติเหตุที่เกิดกับเด็ก')) return;
    if(btn)btn.disabled=true;
    try{ await api('deleteInjury',{staffId:USER.staffId,injuryId:id});
      const m=document.querySelector('.modal'); if(m)m.remove();
      toast(EN()?'Deleted':'ลบแล้ว'); if(SCREENS[USER.role]&&SCREENS[USER.role][CURRENT]) SCREENS[USER.role][CURRENT]();
    }catch(e){ err(e); if(btn)btn.disabled=false; } };
  window.A_injuryPdf=async(id,btn,kind)=>{ const old=btn?btn.innerHTML:'';
    if(btn){ btn.disabled=true; btn.innerHTML='⏳'; }
    try{
      const r=await api('injuryReport',{injuryId:id});
      await window.__atomLoadScript('report_card.js',()=>!!(window.AtomReportCard&&window.AtomReportCard.saveInjury));
      await AtomReportCard.saveInjury(r, kind);
      toast(EN()?'Saved to your device':'บันทึกลงเครื่องแล้ว');
    }catch(e){ err(e); }finally{ if(btn){ btn.disabled=false; btn.innerHTML=old; } } };
  window.T_injurySave = async ()=>{
    const f=injFormVals('');
    const studentId=$('#injChild')&&$('#injChild').value;
    if(!studentId){toast(t('inj.needChild'));return;}
    if(!f.injuryTypes.length){toast(t('inj.needType'));return;}
    try{ await api('submitInjury',Object.assign({staffId:USER.staffId,studentId},f));
      confirmSaved(t('inj.saved')); GO('injury'); }catch(e){err(e);} };
  /**
   * Correct a report. Who may is decided by the SERVER (editInjury); this only offers the button.
   * The person who filed it and any leader may correct it while it is still moving; once both
   * signatures are on it, only an admin — after an admin has unlocked it, everyone is back in.
   */
  function injCanEdit(r){ const s=injStatus(r);
    if(isAdmin()) return true;
    if(s==='APPROVED') return false;
    return isLeaderRole() || String(r.TeacherID||'')===String(USER.staffId||'');
  }
  window.A_injEdit=async(id)=>{
    let r=null; try{ r=await api('injuryReport',{injuryId:id}); }catch(e){ err(e); return; }
    const m=document.querySelector('.modal'); if(m)m.remove();
    modal(`<h3>✏️ ${EN()?'Correct the injury report':'แก้ไขรายงานอุบัติเหตุ'}</h3>
      ${injStatus(r)==='APPROVED'?`<div class="card" style="background:var(--warn-bg);border-color:var(--warn-line);padding:8px;font-size:13px">🔓 ${EN()?'This report is already approved. Your correction is logged against your name.':'รายงานนี้อนุมัติครบแล้ว การแก้ไขจะถูกบันทึกในชื่อของคุณ'}</div>`:''}
      ${injFormHTML('e',{r})}
      <div class="row" style="gap:8px">
        <button class="btn" style="flex:1" onclick="A_injEditSave('${esc(r.InjuryID)}',this)">💾 ${esc(t('c.save'))}</button>
        <button class="btn outline" style="flex:1" onclick="this.closest('.modal').remove();A_viewInjury('${esc(r.InjuryID)}')">${EN()?'Cancel':'ยกเลิก'}</button></div>`);
  };
  window.A_injEditSave=async(id,btn)=>{
    const f=injFormVals('e');
    if(!f.injuryTypes.length){ toast(t('inj.needType')); return; }
    if(btn)btn.disabled=true;
    // scalars travel in `data` (the engine's whitelist); photos/journal/page-2 ride at the top level
    const data={Date:f.date,Time:f.time,CenterName:f.centerName,AffiliationType:f.affiliationType,
      AffiliationOther:f.affiliationOther,District:f.district,RecorderName:f.recorderName,Sex:f.sex,
      AgeYears:f.ageYears,AgeMonths:f.ageMonths,EduStatus:f.eduStatus,EduGrade:f.eduGrade,
      Narrative:f.narrative,CauseObject:f.causeObject,Witness:f.witness,Place:f.place,
      PlaceOther:f.placeOther,InjuryTypes:f.injuryTypes,NotifyParent:f.notifyParent};
    try{ await api('editInjury',Object.assign({staffId:USER.staffId,injuryId:id,data},f));
      confirmSaved(EN()?'Saved':'บันทึกแล้ว');
      const m=document.querySelector('.modal'); if(m)m.remove(); A_viewInjury(id);
    }catch(e){ err(e); if(btn)btn.disabled=false; } };

  SCREENS.Teacher.dspm = async () => { const cl=await api('classList',tc()); T_assess(cl.students[0].StudentID); };
  let ASEL={};
  window.T_assess = async (sid) => { setNav('class'); ASEL={};
    const due=await api('growthDue',{studentId:sid});
    let c; try{ c=await api('dspmStatus',{studentId:sid}); }catch(e){ app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('class')">${t('c.back')}</button><h2 class="page">📝 ประเมิน DSPM</h2><div class="card muted">${esc(e.message)}</div>`; return; }
    const s=(await api('classList',tc())).students.find(x=>x.StudentID===sid)||{NameTH:sid};
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('class')">${t('c.back')}</button><h2 class="page">📝 ประเมิน DSPM — ${esc(nm(s))}</h2>
      <div class="card"><div class="spread"><span>ช่วงอายุ: <b>${esc(ageBandLabel(c.ageLabel))}</b></span><span class="muted">${c.ageMonth} เดือน</span></div>
      <p class="muted" style="font-size:13px">เลือก "ยังไม่ได้ประเมิน" ได้ เพื่อให้ผู้ปกครองทราบว่ายังมีหัวข้อที่ต้องประเมิน · เทียบกับคู่มือที่ดาวน์โหลด</p>
      ${c.manualUrl?`<a class="btn sm outline" href="${esc(c.manualUrl)}" target="_blank">⬇️ ดาวน์โหลดคู่มือ DSPM</a>`:''}</div>
      ${c.items.map(i=>`<div class="card"><div style="margin-bottom:8px"><b>${EN()?'Item':'ข้อ'} ${i.itemNo}</b> <span class="pill info">${i.skill}</span> ${i.result!=='ยังไม่ได้รับการทดสอบ'?`<span class="pill ${i.result==='ผ่าน'?'ok':'bad'}">${EN()?'prev':'เดิม'}: ${esc(tStat(i.result))}</span>`:''}<br>${esc(EN()&&i.descriptionEN?i.descriptionEN:i.description)}</div>
        ${assessMetaHTML(i, sid)}
        <div class="choice"><button id="p${i.itemNo}" onclick="A_set(${i.itemNo},'pass')">✅ ${esc(t('s.pass'))}</button><button id="f${i.itemNo}" onclick="A_set(${i.itemNo},'fail')">❌ ${esc(t('s.fail'))}</button><button id="n${i.itemNo}" onclick="A_set(${i.itemNo},'nottested')">⊘ ${EN()?'Not assessed':'ยังไม่ได้ประเมิน'}</button><button id="e${i.itemNo}" onclick="A_set(${i.itemNo},'notenrolled')">🚪 ${EN()?'Not enrolled yet':'ยังไม่เข้าโรงเรียน'}</button></div></div>`).join('')}
      <div class="card"><h3>📏 ${esc(t('growth.section'))}</h3>
        ${due.due?`<div style="background:var(--warn-bg);border-radius:8px;padding:8px;color:var(--warn-ink);font-size:13px;margin-bottom:8px">⚠️ ${esc(t('growth.gate'))}</div>`:''}
        <div style="text-align:center;margin-bottom:8px">${studentAvatar(s)}</div>
        <div class="grid2"><label class="field"><span>${esc(t('reg.weight'))} (kg)</span><input id="guW" type="number" value="${esc(s.Weight||'')}"/></label>
          <label class="field"><span>${esc(t('reg.height'))} (cm)</span><input id="guH" type="number" value="${esc(s.Height||'')}"/></label></div>
        ${growthDateField(s)}
        ${photoField('guPhoto',t('growth.photo'),s.Photo,true)}</div>
      <div class="savedock"><button class="btn block" onclick="T_saveAssess('${sid}')">${esc(t('growth.saveBoth'))}</button></div>`;
  };
  /**
   * WHOSE judgement this is, and WHEN — plus the admin's note on that one item.
   *
   * A DSPM result is an opinion about a child, and an opinion with no name on it cannot be asked
   * about. Whoever reads it later — the next teacher, a nurse, the parent — can now see who made
   * the call and the moment it was recorded.
   *
   * The admin's comment sits BESIDE the result and never replaces it: a second reader disagreeing,
   * or asking for a re-check, is information. Overwriting the result would destroy the very thing
   * being discussed. Only an admin can write one; everyone working on this screen can read it.
   */
  function assessMetaHTML(i, sid){
    if(!i || i.result==='ยังไม่ได้รับการทดสอบ') return '';
    const when = i.at || i.date;
    const stamp = when ? (String(when).length>10 ? esc(ddmmyyyy(when)+' '+String(when).slice(11,16)) : esc(ddmmyyyy(when))) : '';
    const cmt = i.comment
      ? `<div style="margin-top:6px;background:var(--surface);border-left:3px solid var(--brand);border-radius:6px;padding:6px 8px">
           <small class="muted">💬 ${EN()?'Admin note':'ความเห็นแอดมิน'}${i.commentBy?' · '+esc(i.commentBy):''}${i.commentAt?' · '+esc(ddmmyyyy(i.commentAt)):''}</small>
           <div style="white-space:pre-wrap">${esc(i.comment)}</div></div>`
      : '';
    const btn = isAdmin()
      ? `<button class="btn sm outline" style="margin-top:6px" onclick="A_assessComment('${esc(sid)}',${i.itemNo},this)">💬 ${i.comment?(EN()?'Edit note':'แก้ไขความเห็น'):(EN()?'Add note':'เพิ่มความเห็น')}</button>`
      : '';
    return `<div style="margin-bottom:8px;font-size:13px">
      <small class="muted">👩‍🏫 ${EN()?'assessed by':'ผู้ประเมิน'} <b>${esc(i.by||(EN()?'unknown':'ไม่ระบุ'))}</b>${stamp?` · 🕘 ${stamp}`:''}</small>
      ${cmt}${btn}</div>`;
  }
  window.A_assessComment=async(sid,itemNo,btn)=>{
    let cur=''; try{ const c=await api('dspmStatus',{studentId:sid}); const it=(c.items||[]).find(x=>String(x.itemNo)===String(itemNo)); cur=(it&&it.comment)||''; }catch(e){}
    const txt=prompt(EN()?'Note on this item (leave empty to remove):':'ความเห็นสำหรับข้อนี้ (เว้นว่าง = ลบความเห็น):', cur);
    if(txt===null) return;                                  // cancelled — nothing happens
    if(btn)btn.disabled=true;
    try{ await api('commentAssessment',{staffId:USER.staffId,studentId:sid,itemNo,comment:txt});
      confirmSaved(String(txt).trim()?(EN()?'Note saved':'บันทึกความเห็นแล้ว'):(EN()?'Note removed':'ลบความเห็นแล้ว'));
      // redraw whichever assessment screen we are on
      if(typeof A_editAssess==='function' && CURRENT==='manage') A_editAssess(sid); else T_assess(sid);
    }catch(e){ err(e); if(btn)btn.disabled=false; } };
  window.A_set=(item,val)=>{ ASEL[item]=val; ['p','f','n','e'].forEach(pre=>{const el=document.getElementById(pre+item);if(el)el.classList.remove('pass','fail');});
    if(val==='pass')$('#p'+item).classList.add('pass'); if(val==='fail')$('#f'+item).classList.add('fail'); if(val==='nottested')$('#n'+item).classList.add('pass'); if(val==='notenrolled'){const e=$('#e'+item);if(e)e.classList.add('pass');} };

  // Group C: bi-monthly growth update (height/weight/photo). gate=true when blocking assessment.
  window.T_growthUpdate = async (sid, gate)=>{ setNav('class');
    const s=(await api('classList',tc())).students.find(x=>x.StudentID===sid)||{NameTH:sid};
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('class')">${t('c.back')}</button>
      <h2 class="page">📏 ${esc(t('growth.update'))} — ${esc(nm(s))}</h2>
      ${gate?`<div class="card" style="background:var(--warn-bg);border-color:var(--warn-line);color:var(--warn-ink)">⚠️ ${esc(t('growth.gate'))}</div>`:''}
      <div class="card">
        <div style="text-align:center;margin-bottom:8px">${studentAvatar(s)}</div>
        <div class="grid2"><label class="field"><span>${esc(t('reg.weight'))} (kg)</span><input id="guW" type="number" value="${esc(s.Weight||'')}"/></label>
          <label class="field"><span>${esc(t('reg.height'))} (cm)</span><input id="guH" type="number" value="${esc(s.Height||'')}"/></label></div>
        ${growthDateField(s)}
        ${photoField('guPhoto',t('growth.photo'),s.Photo,true)}
        <button class="btn block" onclick="T_growthSave('${sid}',${gate?'true':'false'})">${esc(t('c.save'))}</button></div>`;
  };
  /**
   * WHEN they were weighed and measured. A class is weighed on one day and the numbers are typed in
   * later, so recording "today" plotted the measurement on a day nobody stood on the scales — and
   * that chart is what a nurse reads. Defaults to today; a future date is refused by the server too.
   */
  function growthDateField(s){
    const last=ymd(s&&s.LastGrowthUpdate||'');
    return `<label class="field"><span>📅 ${EN()?'Date measured':'วันที่ชั่ง / วัด'}</span>
      <input type="date" id="guDate" value="${todayStr()}" max="${todayStr()}"/>
      <small class="muted">${EN()?'The day it was actually done — not the day it is typed in.':'วันที่ชั่ง/วัดจริง ไม่ใช่วันที่กรอกข้อมูล'}${last?` · ${EN()?'last':'ครั้งล่าสุด'} ${esc(ddmmyyyy(last))}`:''}</small></label>`;
  }
  const growthDateVal = () => { const e=$('#guDate'); const v=e?e.value:''; return /^\d{4}-\d{2}-\d{2}$/.test(v)?v:todayStr(); };
  window.T_growthSave = async (sid, gate)=>{ const w=+$('#guW').value||null, h=+$('#guH').value||null;
    if(!w||!h){toast(EN()?'Enter weight & height':'กรอกน้ำหนักและส่วนสูง');return;}
    const photo=photoVal(document,'guPhoto');
    try{ await api('updateGrowth',{studentId:sid,weight:w,height:h,photo,date:growthDateVal()}); confirmSaved(t('growth.saved'));
      if(gate) T_assess(sid); else GO('class'); }catch(e){err(e);} };
  window.T_saveAssess=async(sid)=>{ const results=Object.keys(ASEL).map(k=>({itemNo:Number(k),result:ASEL[k]}));
    // also persist the growth fields shown below the assessment (weight/height/photo)
    const w=+$('#guW').value||null, h=+$('#guH').value||null; const photo=photoVal(document,'guPhoto');
    if(!results.length && !(w&&h)){toast(EN()?'Assess at least 1 item or enter weight/height':'เลือกผลอย่างน้อย 1 ข้อ หรือกรอกน้ำหนัก/ส่วนสูง');return;}
    try{ if(results.length) await api('submitAssessment',{studentId:sid,staffId:USER.staffId,results});
      if(w&&h) await api('updateGrowth',{studentId:sid,weight:w,height:h,photo,date:growthDateVal()});
      // stay in the assessment (re-render) so the teacher keeps working; history is always kept
      confirmSaved(EN()?'Saved — parent notified':'บันทึกแล้ว — แจ้งผู้ปกครอง'); T_assess(sid); }catch(e){err(e);} };

  SCREENS.Teacher.leave = async () => {
    const [quota,me] = await Promise.all([api('leaveQuota',{staffId:USER.staffId}),api('staffSelf',{staffId:USER.staffId})]);
    const isLeader=(me&&(me.PositionLevel==='Leader'||me.Role==='Leader'))||USER.role==='Leader';
    app.innerHTML=`<h2 class="page">${esc(t('title.leave'))}</h2>
      <div class="card"><h3>สิทธิคงเหลือ</h3><div class="quota">${quota.map(q=>`<div class="q"><div class="n">${esc(halfNum(q.remain))}</div><div class="l">${esc(q.type)} ${esc(halfNum(q.used))}/${esc(halfNum(q.quota))}</div></div>`).join('')}</div></div>
      <div class="card"><h3>ยื่นใบลา</h3>
        <!-- The VALUE must be Thai and must never be translatable. These options used to carry the
             Thai text with no value attribute: in English mode i18n_tr.js rewrote that text to
             "Sick Leave", and with no value attribute the translated label is what got SAVED —
             which broke both the display and the entitlement counter. value= pins what we store,
             translate="no" stops the text being rewritten at all. -->
        <label class="field"><span>ประเภท</span><select id="lType" translate="no">
          <option value="ลาป่วย">${EN()?'Sick leave (ลาป่วย)':'ลาป่วย'}</option>
          <option value="ลากิจ">${EN()?'Personal leave (ลากิจ)':'ลากิจ'}</option>
          <option value="ลาพักร้อน">${EN()?'Holiday leave (ลาพักร้อน)':'ลาพักร้อน'}</option></select></label>
        <div class="grid2"><label class="field"><span>วันที่เริ่ม</span><input type="date" id="lStart" value="${todayStr()}" onchange="T_halfToggle()"/></label><label class="field"><span>ถึงวันที่</span><input type="date" id="lEnd" value="${todayStr()}" onchange="T_halfToggle()"/></label></div>
        <label class="field" id="lHalfBox"><span>${EN()?'Half day?':'ลาครึ่งวันหรือไม่'}</span>
          <select id="lHalf"><option value="">${EN()?'Full day':'ลาเต็มวัน'}</option>
            <option value="AM">${EN()?'Half day — morning (0.5)':'ครึ่งวันเช้า (0.5 วัน)'}</option>
            <option value="PM">${EN()?'Half day — afternoon (0.5)':'ครึ่งวันบ่าย (0.5 วัน)'}</option></select></label>
        <small class="muted" style="display:block;margin:-2px 0 6px">${EN()?'A half day deducts 0.5 from your entitlement — e.g. 30 days of sick leave becomes 29.5.':'ลาครึ่งวันจะหักสิทธิ 0.5 วัน เช่น ลาป่วย 30 วัน เหลือ 29.5 วัน · เลือกได้เมื่อลาวันเดียว'}</small>
        <label class="field"><span>เหตุผล</span><textarea id="lReason"></textarea></label>
        ${photoField('lDoc',(EN()?'Attachment (medical cert / doc — optional)':'เอกสารแนบ (ใบรับรองแพทย์ ฯลฯ — ถ้ามี)'),'',false)}
        <button class="btn block" onclick="T_submitLeave()">ส่งคำขอ</button></div>
      <div class="card"><h3>📋 คำขอของฉัน</h3><div id="ml"></div></div>
      <div class="card"><h3>${esc(t('att.title'))}</h3>
        <p class="muted" style="font-size:13px">${EN()?'Forgot to clock in/out? Request a time — it goes to your leader then Admin.':'ลืมลงเวลา? ขอลงเวลาที่ต้องการ ระบบจะส่งให้หัวหน้าครูและแอดมินอนุมัติ'}</p>
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
  function timeReqRow(r){ return `<div class="list-item"><span>${esc(timeTypeLabel(r.Type))} · <b style="color:var(--blue)">${esc(r.RequestTime)}</b> · ${esc(ddmmyyyy(r.Date))}${r.Reason?`<br><small class="muted">${esc(r.Reason)}</small>`:''}</span>${timeReqStatusPill(r.Status)}</div>`; }
  function timeReqApproveRow(r){ return `<div class="list-item"><span><b>${esc(dnick(r))}</b> · ${esc(timeTypeLabel(r.Type))} <b style="color:var(--blue)">${esc(r.RequestTime)}</b> · ${esc(ddmmyyyy(r.Date))}${r.Reason?`<br><small class="muted">${esc(r.Reason)}</small>`:''}</span><span class="row"><button class="btn sm green" onclick="T_approveTimeReq('${r.ReqID}','approve')" aria-label="${EN()?"Approve":"อนุมัติ"}" title="${EN()?"Approve":"อนุมัติ"}">✔</button><button class="btn sm pink" onclick="T_approveTimeReq('${r.ReqID}','reject')" aria-label="${EN()?"Delete":"ลบ"}" title="${EN()?"Delete":"ลบ"}">✕</button></span></div>`; }
  window.T_submitTimeReq=async()=>{ const type=$('#atType').value, date=$('#atDate').value, time=$('#atTime').value, reason=$('#atReason').value;
    if(!time){toast(EN()?'Pick a time':'เลือกเวลา');return;}
    try{ await api('submitTimeRequest',{staffId:USER.staffId,type,date,time,reason}); confirmSaved(t('corg.submitted')); GO('leave'); }catch(e){err(e);} };
  window.T_approveTimeReq=async(reqId,dec)=>{ try{ await api('approveTimeRequest',{staffId:USER.staffId,reqId,decision:dec}); toast(dec==='approve'?(EN()?'Approved (→Admin)':'อนุมัติ (ส่งต่อแอดมิน)'):(EN()?'Rejected':'ปฏิเสธแล้ว')); GO('leave'); }catch(e){err(e);} };
  // half a day is only meaningful on a single-day request — hide (and clear) it on a range
  window.T_halfToggle=()=>{ const a=$('#lStart'), b=$('#lEnd'), box=$('#lHalfBox'), sel=$('#lHalf');
    if(!a||!b||!box)return; const one=a.value && a.value===b.value;
    box.hidden=!one; if(!one && sel) sel.value=''; };
  window.T_submitLeave=async()=>{ const attachment=photoVal(document,'lDoc');
    const halfDay=(($('#lHalf')||{}).value)||'';
    try{ const r=await api('submitLeave',{staffId:USER.staffId,type:$('#lType').value,startDate:$('#lStart').value,endDate:$('#lEnd').value,reason:$('#lReason').value,halfDay,attachment});
      toast(`✅ ส่งคำขอ ${r.leaveId} (${leaveDays(r.days)}${r.halfDay?' · '+halfLabel(r.halfDay):''})`); GO('leave'); }catch(e){err(e);} };
  // "1 วัน" / "0.5 วัน" — never "0.5 วันเต็ม"
  // 29.5 stays 29.5; 29.0 prints as 29 (a whole entitlement should not read "29.0 วัน")
  const halfNum = n => { const v=Number(n)||0; return (Math.round(v*2)/2)%1 ? (Math.round(v*2)/2).toFixed(1) : String(Math.round(v)); };
  const leaveDays = d => { const n=Number(d)||0; return (EN()? (n===0.5?'half a day':halfNum(n)+' day'+(n===1?'':'s')) : (halfNum(n)+' วัน')); };
  const halfLabel = h => String(h)==='AM' ? (EN()?'morning':'ครึ่งวันเช้า') : String(h)==='PM' ? (EN()?'afternoon':'ครึ่งวันบ่าย') : '';
  window.T_teamApprove=async(id,dec)=>{ try{ const r=await api('approveLeave',{staffId:USER.staffId,leaveId:id,decision:dec}); toast(`✅ ${dec==='approve'?'อนุมัติ(ส่งต่อ Admin)':'ปฏิเสธ'} — ${r.status}`); GO('leave'); }catch(e){err(e);} };
  function leaveStatusPill(st){ const c={PENDING_LEADER:'wait',PENDING_ADMIN:'wait',APPROVED:'ok',REJECTED:'bad'}[st]||'info'; return `<span class="pill ${c}">${esc(tStat(st))}</span>`; }
  // display name for a leave row: nickname first (enriched l.nick/l.name), else staff-cache lookup
  const leaveName = l => (EN()?(l.nickEN||l.nick):(l.nick||l.nickEN)) || (EN()?(l.nameEN||l.name):(l.name||l.nameEN)) || staffNick(l.StaffID);
  // 📎 attachment link (medical cert / doc) if present
  const leaveDoc = l => l.Attachment ? ` <a href="${esc(l.Attachment)}" target="_blank" onclick="event.stopPropagation()">📎</a>` : '';
  // "2ว." never made it through the runtime translator; days/steps are spelled out per language now.
  const lvDays = n => EN() ? `${halfNum(n)} d` : `${halfNum(n)}ว.`;
  function leaveRow(l){ return `<div class="list-item"><div><b>${esc(tLeaveType(l.Type))}</b> ${esc(l.StartDate)}→${esc(l.EndDate)} (${lvDays(l.Days)}${l.HalfDay?" · "+esc(halfLabel(l.HalfDay)):""})${leaveDoc(l)}<br><small class="muted">${esc(l.LeaveID)}${l.Step1ApproverName?(EN()?' · step 1: ':' · ขั้น1: ')+esc(l.Step1ApproverName)+(l.Step1CrossDept==='YES'?(EN()?' (cross-dept)':' (ข้ามแผนก)'):''):''}${l.Step2ApproverName?(EN()?' · step 2: ':' · ขั้น2: ')+esc(l.Step2ApproverName):''}</small></div>${leaveStatusPill(l.Status)}</div>`; }
  function teamLeaveRow(l){ return `<div class="card" style="margin:8px 0"><div class="spread"><div><b>${esc(leaveName(l))}</b> <small class="muted">(${esc(l.Department)})</small><br>${esc(tLeaveType(l.Type))} ${esc(l.StartDate)}→${esc(l.EndDate)} (${lvDays(l.Days)}${l.HalfDay?" · "+esc(halfLabel(l.HalfDay)):""})${leaveDoc(l)}<br><small class="muted">${esc(l.Reason||'')}</small></div>${leaveStatusPill(l.Status)}</div><div class="row" style="margin-top:8px"><button class="btn sm green" onclick="T_teamApprove('${l.LeaveID}','approve')">${esc(t('ot.approve'))}</button><button class="btn sm pink" onclick="T_teamApprove('${l.LeaveID}','reject')">${esc(t('ot.reject'))}</button></div></div>`; }

  const firstName = s => (nm(s)||'').split(' ')[0];
  // opts: { shortName(staffId), holidays:[{Date,NameTH,NameEN}], leaves:[approved] } — never reads MOCK.staff
  // Teacher calendar: check-in/out times + holidays + meeting days + leaves of ALL staff. Navigable (all months).
  function staffSchedCalendar(history, opts){ opts=opts||{};
    const shortName=opts.shortName||(id=>id);
    const render=()=>{ const b=calBase(),y=b.getFullYear(),mo=b.getMonth(); const now=new Date(); const isCur=CAL_OFF===0;
      const first=new Date(y,mo,1).getDay(),days=new Date(y,mo+1,0).getDate(); const byDay={};
      const holByDay={}; (opts.holidays||[]).forEach(h=>{ const d=new Date(h.Date); if(d.getFullYear()===y&&d.getMonth()===mo) holByDay[d.getDate()]=holLabel(h); });
      const bcByDay={}; (opts.bigCleaning||[]).forEach(s=>{ const d=new Date(s); if(d.getFullYear()===y&&d.getMonth()===mo) bcByDay[d.getDate()]=1; });
      (history||[]).forEach(h=>{ const d=new Date(h.Date); if(d.getFullYear()===y&&d.getMonth()===mo){ const io=(h.In?'↓'+h.In:'')+(h.Out?' ↑'+h.Out:''); (byDay[d.getDate()]=byDay[d.getDate()]||[]).push(shortName(h.StaffID)+(io?' '+io:'')); } });
      // approved leaves of ALL staff overlapping each day → "Nickname (LeaveType)"
      (opts.leaves||[]).filter(l=>l.Status==='APPROVED').forEach(l=>{ const st=new Date(l.StartDate),en=new Date(l.EndDate); for(let dt=new Date(st); dt<=en; dt.setDate(dt.getDate()+1)){ if(dt.getFullYear()===y&&dt.getMonth()===mo){ (byDay[dt.getDate()]=byDay[dt.getDate()]||[]).push('🏠 '+shortName(l.StaffID)+' ('+tLeaveType(l.Type)+')'); } } });
      let cells=['อา','จ','อ','พ','พฤ','ศ','ส'].map(w=>`<div style="text-align:center;font-size:13px;color:var(--ink-3)">${EN()?({'อา':'Su','จ':'Mo','อ':'Tu','พ':'We','พฤ':'Th','ศ':'Fr','ส':'Sa'}[w]):w}</div>`).join('');
      for(let i=0;i<first;i++) cells+='<div class="d dim"></div>';
      for(let dd=1;dd<=days;dd++){ const ppl=byDay[dd]; const hol=holByDay[dd]; const bc=bcByDay[dd]; const today=(isCur&&dd===now.getDate())?'today':'';
        const holStyle=calOffBg(y,mo,dd,hol,bc);   // holiday red · Big-Cleaning cyan · weekend light-red
        cells+=`<div class="d ${ppl?'ev':''} ${today}" style="min-height:64px;${holStyle}">${dd}`
          +(hol?`<span class="io" style="color:var(--bad);text-align:left;font-weight:600">🏖️ ${esc(hol)}</span>`:'')
          +(bc&&!hol?`<span class="io" style="color:var(--teal);text-align:left;font-weight:600">${BC_ICON} ${BC_SHORT()}</span>`:'')
          +(ppl?`<span class="io" style="color:var(--ok);text-align:left">${esc(ppl.join('\n'))}</span>`:'')+`</div>`; }
      return `${calNavHeader(y,mo)}<div class="cal">${cells}</div><small class="muted">${EN()?`↓in ↑out · 🏖️ holiday · ${BC_ICON} meeting · 🏠 on leave (all staff)`:`↓เข้า ↑ออก · 🏖️ วันหยุด · ${BC_ICON} ประชุม · 🏠 ลา (พนักงานทุกคน)`}</small>`; };
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
        <!-- Approved leave was printed in full underneath the summary every time. It is a "who do I
             need to cover for" reference, not something to read daily — folded shut, with the count
             on the summary line so you can see whether it is worth opening. -->
        <details style="margin-top:8px"><summary style="cursor:pointer;font-weight:700;font-size:13px">${EN()?'Approved leave (for coverage)':'การลาที่อนุมัติแล้ว (วางแผนสับเปลี่ยน)'} <span class="pill ${d.leavesToday.length?'wait':'ok'}" style="font-size:11px">${d.leavesToday.length}</span></summary>
          <div style="margin-top:6px">${d.leavesToday.map(l=>`<div class="list-item"><span>${esc(fullName(l.StaffID))} · ${esc(tLeaveType(l.Type))}</span><span class="muted">${esc(l.StartDate)}→${esc(l.EndDate)}</span></div>`).join('')||`<small class="muted">${esc(t('c.noItems'))}</small>`}</div></details>
        <!-- my own OT วันหยุด, in the place a teacher already comes to check their own days -->
        <div id="myHolOT"></div></div>
      <!-- MY OWN records. They used to sit on the home screen, where a month of history had nowhere
           to go and every day of it was in the way of this morning's job. Folded shut by default:
           open one when you want it. -->
      <details class="card" id="myAttBox"><summary style="cursor:pointer;font-weight:700">🕘 ${EN()?'My work history':'เวลาทำงานย้อนหลังของฉัน'}</summary>
        <div class="row" style="margin:8px 0"><input type="month" id="mhMonth" value="${monthStr()}" onchange="T_myHistory(this.value)"/>
          <select id="mhFilter" onchange="T_myHistoryFilter()">
            <option value="all">${EN()?'All days':'ทุกวัน'}</option>
            <option value="worked">${EN()?'Worked':'วันที่มาทำงาน'}</option>
            <option value="late">${EN()?'Late only':'เฉพาะวันที่สาย'}</option>
            <option value="leave">${EN()?'Leave':'วันลา'}</option>
            <option value="absent">${EN()?'Absent':'ขาดงาน'}</option>
            <!-- "OT 14 ชม." was a total with nothing behind it. This is the days it is made of. -->
            <option value="ot">${EN()?'OT — day by day':'OT รายวัน'}</option></select></div>
        <div id="mhBox"><small class="muted">${EN()?'Loading…':'กำลังโหลด…'}</small></div></details>
      <details class="card" id="myLvBox"><summary style="cursor:pointer;font-weight:700">📩 ${EN()?'My leave history':'ประวัติการลาของฉัน'}</summary>
        <div class="row" style="margin:8px 0"><select id="mlFilter" onchange="T_myLeaveFilter()">
            <option value="all">${EN()?'All':'ทั้งหมด'}</option>
            <option value="pending">${EN()?'Awaiting approval':'รออนุมัติ'}</option>
            <option value="approved">${EN()?'Approved':'อนุมัติแล้ว'}</option>
            <option value="rejected">${EN()?'Rejected':'ไม่อนุมัติ'}</option></select></div>
        <div id="mlBox"><small class="muted">${EN()?'Loading…':'กำลังโหลด…'}</small></div></details>`;
    // both lists load AFTER the screen is on the page, and only once — opening a <details> costs
    // nothing, so a teacher who never opens them still pays for the fetch, but only two of them
    T_myHistory(monthStr());
    api('myLeaves',{staffId:USER.staffId}).then(l=>{ MY_LEAVES=l||[]; T_myLeaveFilter(); })
      .catch(()=>setHTML('#mlBox', `<small class="muted">${esc(t('c.noItems'))}</small>`));
    /* My own OT วันหยุด. The Admin agrees it and the teacher is told once, in a notification that
     * scrolls away; after that the only record was inside a payslip they may not open for weeks.
     * This is the screen they already use to check their own days, so it belongs here. Loaded after
     * the screen is drawn — it must never hold up the summary above it. */
    api('myOT',{staffId:USER.staffId}).then(rows=>{
      const hol=(rows||[]).filter(isLiveHolOT);
      if(!hol.length) return;                       // nothing to say → no empty card in the way
      const total=hol.reduce((a,o)=>a+(Number(o.Amount)||0),0);
      setHTML('#myHolOT', `<details style="margin-top:8px"><summary style="cursor:pointer;font-weight:700;font-size:13px">🎉 ${EN()?'My holiday OT':'OT วันหยุดของฉัน'} <span class="pill ok" style="font-size:11px">${hol.length}</span> <span class="muted" style="font-weight:400">${esc(baht(total))}</span></summary>
        <div style="margin-top:6px">${hol.map(o=>`<div class="list-item" style="align-items:flex-start"><span style="flex:1;min-width:0"><b>${esc(ddmmyyyy(o.Date))}</b>${o.Note?`<br><small class="muted">${esc(o.Note)}</small>`:''}</span><b style="color:var(--ok);white-space:nowrap">${esc(baht(o.Amount))}</b></div>`).join('')}
        <small class="muted">${EN()?'Paid on its own line of your payslip.':'จ่ายเป็นบรรทัดแยกในสลิปเงินเดือน'}</small></div></details>`);
    }).catch(()=>{});
  };
  /* ---- my own work history + leave history (📅 ตาราง) --------------------------------------
   * Filters, because a month is 30 rows and the question is almost always narrower than that:
   * "which days was I late", "did that leave get approved".
   */
  let MY_DAYS=[], MY_LEAVES=[];
  const MH_LABEL = { IN:()=>EN()?'Worked':'มาทำงาน', LEAVE:()=>EN()?'Leave':'ลา', HOLIDAY:()=>EN()?'Holiday':'วันหยุด',
    OFF:()=>EN()?'Weekend':'เสาร์-อาทิตย์', ABSENT:()=>EN()?'Absent':'ขาดงาน', TODAY:()=>EN()?'Today':'วันนี้',
    FUTURE:()=>'-', BEFORE:()=>EN()?'Before start':'ก่อนเริ่มงาน' };
  window.T_myHistory=async(month)=>{
    setHTML('#mhBox', `<small class="muted">${EN()?'Loading…':'กำลังโหลด…'}</small>`);
    try{ const r=await api('myAttendanceMonth',{staffId:USER.staffId,month});
      MY_DAYS=((r.staff||[])[0]||{}).days||[];
      const me=(r.staff||[])[0]||{};
      setHTML('#mhSum', '');
      window._MH_SUM=me;
    }catch(e){ MY_DAYS=[]; }
    T_myHistoryFilter();
  };
  window.T_myHistoryFilter=()=>{
    const f=(($('#mhFilter')||{}).value)||'all';
    const keep=d=> f==='all' ? d.status!=='FUTURE' && d.status!=='BEFORE'
      : f==='worked' ? d.status==='IN'
      : f==='late'   ? d.status==='IN' && Number(d.late)>0
      : f==='leave'  ? d.status==='LEAVE'
      : /* absent */   d.status==='ABSENT';
    const rows=MY_DAYS.filter(keep);
    const me=window._MH_SUM||{};
    const sum=`<div class="row" style="gap:6px;margin-bottom:6px;flex-wrap:wrap">
      <span class="pill ok">${EN()?'worked':'มาทำงาน'} ${me.present||0}</span>
      <span class="pill ${me.lateDays?'bad':'ok'}">${EN()?'late':'สาย'} ${me.lateDays||0} ${EN()?'days':'วัน'} (${me.lateMinutes||0} ${esc(t('lbl.min'))})</span>
      <span class="pill info">${EN()?'leave':'ลา'} ${me.leaveDays||0}</span>
      <span class="pill ${me.absent?'bad':'ok'}">${EN()?'absent':'ขาด'} ${me.absent||0}</span>
      ${me.otHours?`<span class="pill wait">OT ${me.otHours} ${EN()?'hr':'ชม.'}</span>`:''}
      ${me.holidayOTDays?`<span class="pill ok">🎉 OT ${EN()?'holiday':'วันหยุด'} ${me.holidayOTDays} ${EN()?'day(s)':'วัน'} · ${esc(baht(me.holidayOTAmount||0))}</span>`:''}</div>`;
    /* WHERE THE OT TOTAL COMES FROM. A figure that cannot be traced to days is a figure that has to
     * be trusted, and this one goes on a payslip. Every row the month counted is here, with the
     * decision on it — including the rejected ones, which are shown struck out so "why is it 14 and
     * not 16" has an answer on the screen rather than in the spreadsheet. */
    if(f==='ot'){
      const od=(me.otDays||[]);
      setHTML('#mhBox', sum + (od.length?od.map(o=>{
        const rej=o.status==='REJECTED';
        return `<div class="list-item"><span>${esc(ddmmyyyy(o.date))} ${o.kind==='HOLIDAY'?`<span class="pill ok">🎉 ${EN()?'holiday':'วันหยุด'}</span>`:''}${o.note?`<br><small class="muted">${esc(o.note)}</small>`:''}</span>
          <span style="font-size:13px;text-align:right${rej?';text-decoration:line-through;opacity:.6':''}">
            ${o.kind==='HOLIDAY'?`<b>${esc(baht(o.amount||0))}</b> <small class="muted">(${EN()?'lump sum — no hours':'เงินก้อน · ไม่มีชั่วโมง'})</small>`
              :`<b>${o.hours} ${EN()?'hr':'ชม.'}</b> · ${esc(baht(o.amount||0))}`}
            <br><span class="pill ${rej?'bad':o.status==='APPROVED'?'ok':'wait'}">${esc(tStat(o.status))}</span></span></div>`;
      }).join('')
        : `<small class="muted">${EN()?'No OT this month':'เดือนนี้ไม่มี OT'}</small>`)
        + `<small class="muted" style="display:block;margin-top:6px">${EN()
          ? 'Rejected rows are struck out and are not in the total. Holiday OT is an agreed amount with no hours behind it, so it adds money but not hours.'
          : 'รายการที่ถูกปฏิเสธจะขีดฆ่าและไม่รวมในยอด · OT วันหยุดเป็นเงินก้อนที่ตกลงกันไว้ ไม่มีชั่วโมง จึงเพิ่มเป็นเงินแต่ไม่เพิ่มชั่วโมง'}</small>`);
      return;
    }
    setHTML('#mhBox', sum + (rows.map(d=>{
      const late=Number(d.late)||0;
      const right = d.status==='IN'
        ? `${esc(t('lbl.checkIn'))} <b>${esc(d.in||'--:--')}</b> · ${esc(t('lbl.checkOut'))} <b>${esc(d.out||'--:--')}</b> ${late?`<span class="pill bad">${esc(t('lbl.late'))} ${late}</span>`:`<span class="pill ok">${esc(t('lbl.onTime'))}</span>`}`
        : `<span class="pill ${d.status==='ABSENT'?'bad':d.status==='LEAVE'?'info':'wait'}">${esc((MH_LABEL[d.status]||MH_LABEL.FUTURE)())}${d.leaveType?' · '+esc(d.leaveType):''}${d.holiday?' · '+esc(d.holiday):''}</span>`;
      // a Saturday somebody was PAID to work is not a blank row (22/08/26) — the day says so whether
      // or not there is a punch on it
      const hot=d.holidayOT?`<br><span class="pill ok" style="font-size:11px">🎉 OT ${EN()?'holiday':'วันหยุด'} ${esc(baht(d.holidayOT))}</span>`:'';
      return `<div class="list-item"><span>${esc(ddmmyyyy(d.date))}${d.bigCleaning?' '+BC_ICON:''}${d.manual?' <small class="muted">✍️</small>':''}${d.holidayOTNote?`<br><small class="muted">${esc(d.holidayOTNote)}</small>`:''}</span><span style="font-size:13px;text-align:right">${right}${hot}</span></div>`;
    }).join('') || `<small class="muted">${esc(t('c.noItems'))}</small>`));
  };
  window.T_myLeaveFilter=()=>{
    const f=(($('#mlFilter')||{}).value)||'all';
    const st=l=>String(l.Status||'').toUpperCase();
    const keep=l=> f==='all' ? true
      : f==='pending'  ? st(l).indexOf('PENDING')===0
      : f==='approved' ? st(l)==='APPROVED'
      : /* rejected */   st(l)==='REJECTED';
    const rows=MY_LEAVES.filter(keep);
    setHTML('#mlBox', rows.map(leaveRow).join('') || `<small class="muted">${esc(t('c.noItems'))}</small>`);
  };

  let SLIP_UNLOCKED=false;
  /**
   * 💵 การเงิน — everything about this teacher's own money: the payslip AND their OT history.
   *
   * The OT list used to be on the home screen. It is pay, not a task, and it belongs with the
   * payslip behind the same password: an OT record IS an amount of money owed to this person, and
   * the school locked the payslip for exactly that reason.
   */
  SCREENS.Teacher.slip = async () => {
    if(!SLIP_UNLOCKED){ app.innerHTML=`<h2 class="page">${esc(t('title.slip'))}</h2>
      <div class="card" style="text-align:center"><div style="font-size:42px">🔒</div><p>${EN()?'Pay information is private — enter your password.':'ข้อมูลการเงินเป็นความลับ — กรุณาใส่รหัสผ่านของคุณ'}</p>
      ${pwField('slipPw',t('lbl.password'),'')}
      <button class="btn block" onclick="T_slipUnlock()">${esc(t('lbl.openSlip'))}</button>
      <button class="btn-ghost block" style="margin-top:8px" onclick="T_changePw(false)">🔑 ${esc(t('pw.title'))}</button>
      <button class="btn-ghost block" style="margin-top:4px" onclick="T_forgotPw()">❓ ${EN()?'Forgot password':'ลืมรหัสผ่าน'}</button></div>`; return; }
    const month=monthStr();
    const p_ot=api('myOT',{staffId:USER.staffId}).catch(()=>[]);   // travels with the payslip fetch
    const pay=await T_slipFor(month);
    app.innerHTML=`<h2 class="page">${esc(t('title.slip'))}</h2>
      <div class="seg"><span class="muted" style="align-self:center">งวด:</span><input type="month" id="slipMonth" value="${month}" style="width:auto" onchange="T_slipMonth(this.value)"/>
      <button class="btn sm outline" onclick="SLIP_LOCK()">🔒 ล็อก</button></div>
      <div id="slipBox">${payslipCard(pay,month)}</div>
      <button class="btn outline block" onclick="T_slipDownload()">⬇️ ${esc(t('lbl.downloadSlip'))}</button>
      <details class="card" style="margin-top:10px" open><summary style="cursor:pointer;font-weight:700">${esc(t('ot.myOT'))}</summary>
        <div id="myot" style="margin-top:8px"><small class="muted">${EN()?'Loading…':'กำลังโหลด…'}</small></div></details>`;
    const myot=await p_ot; setHTML('#myot', myot.map(otRow).join('')||`<small class="muted">${esc(t('ot.none'))}</small>`);
  };
  // staff/admin own profile (opened by tapping the header name/avatar)
  window.T_profile = async () => { setNav('home');
    const s = await api('staffSelf',{staffId:USER.staffId}) || {};
    // every row here is a stored value (name, position, department, staff group) — shield them all,
    // or the EN dictionary rewrites them word-by-word ("ครูประจำ" -> "Teacherประจำ")
    const ro=(label,val)=>`<div class="list-item"><span class="muted" style="font-size:13px">${esc(label)}</span><span><b>${_notr(val==null||val===''?'-':val)}</b></span></div>`;
    const f=(k,label,val,type)=>`<label class="field"><span>${esc(label)}</span><input id="sp_${k}" type="${type||'text'}" value="${esc(val==null?'':val)}"/></label>`;
    app.innerHTML=`<div class="spread"><h2 class="page">👤 ${EN()?'My info':'ข้อมูลของฉัน'}</h2><button class="btn sm outline" onclick="GO('home')">← ${esc(t('c.back'))}</button></div>
      <div class="card"><h3>${esc(nm(s)||USER.nameTH||'')}</h3>
        <div class="grid2">${f('NameEN',EN()?'Name (EN)':'ชื่อ-สกุล (อังกฤษ)',s.NameEN)}${f('Nickname',EN()?'Nickname':'ชื่อเล่น',s.Nickname)}</div>
        <div class="grid2">${f('Phone',EN()?'Phone':'เบอร์โทร',phoneFmt(s.Phone))}${f('DOB',EN()?'Date of birth':'วันเกิด',s.DOB,'date')}</div>
        <button class="btn block green" onclick="T_saveProfile(this)">💾 ${EN()?'Save':'บันทึก'}</button></div>
      <div class="card"><h3>ℹ️ ${EN()?'Employment info':'ข้อมูลการทำงาน'}</h3>
        <p class="muted" style="font-size:13px">${EN()?'Contact admin to change these.':'ต้องการแก้ไข ติดต่อแอดมิน'}</p>
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
      <div class="card">${forced?`<div style="background:var(--warn-bg);border-radius:8px;padding:8px;color:var(--warn-ink);font-size:13px;margin-bottom:8px">⚠️ ${esc(t('pw.forced'))}</div>`:''}
        <p class="muted" style="font-size:13px">${esc(t('pw.user'))}: <b>${esc(me.NationalID||'')}</b></p>
        ${pwField('pwNew',t('pw.new'),'8-15 chars')}
        ${pwField('pwConfirm',t('pw.confirm'),'')}
        <p class="muted" style="font-size:13px">${esc(t('pw.rule'))}</p>
        <button class="btn block" onclick="T_changePwDo()">${esc(t('c.save'))}</button>
        <button class="btn-ghost block" style="margin-top:8px" onclick="T_forgotPw()">❓ ${EN()?'Forgot password':'ลืมรหัสผ่าน'}</button>
        ${forced?'':`<button class="btn-ghost block" style="margin-top:4px" onclick="GO('home')">${esc(t('c.back'))}</button>`}</div>`;
  };
  window.T_changePwDo=async()=>{ const a=$('#pwNew').value, b=$('#pwConfirm').value;
    if(a!==b){toast(EN()?'Passwords do not match':'รหัสผ่านไม่ตรงกัน');return;}
    try{ await api('changeStaffPassword',{staffId:USER.staffId,newPassword:a}); confirmSaved(t('c.saved')); GO('home'); }catch(e){err(e);} };
  window.SLIP_LOCK=()=>{ SLIP_UNLOCKED=false; GO('slip'); };
  /**
   * This month's slip for the signed-in person: the SAVED one if the admin has run payroll, otherwise
   * a calculated preview. Both steps are guarded — someone who has just typed their password to open
   * their own salary must never be answered with a blank screen, and "no slip yet" is a normal state,
   * not an error (the server answers it with null).
   */
  async function T_slipFor(m){
    let pay=null;
    try{ pay=await api('getPayslip',{staffId:USER.staffId,month:m}); }catch(e){}
    if(!pay){ try{ pay=await api('computePayroll',{staffId:USER.staffId,month:m}); }catch(e){} }
    return pay;
  }
  window.T_slipMonth=async(m)=>{ setHTML('#slipBox', payslipCard(await T_slipFor(m), m)); };
  window.T_slipDownload=async(m)=>{ m=m||($('#slipMonth')&&$('#slipMonth').value)||monthStr();
    const pay=await T_slipFor(m);
    if(!pay){ toast(EN()?'No payslip for this month yet':'ยังไม่มีสลิปของเดือนนี้'); return; }
    await ensureLogos(); openOrDownload(buildSlipsHTML([pay],m), 'payslip-'+USER.staffId+'-'+m+'.html'); };
  // the sheet stores Adjustments as JSON text; the in-browser engine returns a real array
  const adjRows = r => { const a=r&&r.Adjustments; if(Array.isArray(a)) return a;
    if(typeof a==='string' && a.trim()){ try{ const v=JSON.parse(a); return Array.isArray(v)?v:[]; }catch(e){} } return []; };
  // which earlier months the "ค้างจ่าย OT" line is made of — OTCarryDetail is JSON on the sheet row
  function carryMonths(r){ let d=r.OTCarryDetail;
    if(typeof d==='string'&&d){ try{ d=JSON.parse(d); }catch(e){ d=null; } }
    return (Array.isArray(d)?d:[]).map(x=>monthNameYear(x.month)).join(', ')||'-'; }
  function payslipCard(r,month){
    // no slip AND no preview: say so, rather than dying on r.StaffID and leaving the screen empty
    if(!r) return `<div class="card"><b>${EN()?'No payslip for this month yet':'ยังไม่มีสลิปเงินเดือนของเดือนนี้'}${month?` · ${esc(month)}`:''}</b>
      <br><small class="muted">${EN()?'It appears once the school has run payroll for this month.':'สลิปจะขึ้นเมื่อโรงเรียนคำนวณเงินเดือนของเดือนนี้แล้ว'}</small></div>`;
    return `<div class="card"><h3>สลิป ${esc(staffName(r.StaffID))} · ${esc(r.Month)}</h3>
    ${r.LeaveExceeds?`<div style="background:var(--warn-bg);border:1px solid var(--warn-line);border-radius:8px;padding:6px 9px;margin-bottom:6px;color:var(--warn);font-size:13px">⚠️ ลาเกิน ${r.LeaveLimit||3} วัน (ลารวม ${r.LeaveDays} วัน) — ไม่คำนวณเรทจำนวนเด็ก</div>`:''}
    <table style="width:100%;font-size:14px;border-collapse:collapse">
    <tr><td>เงินเดือน</td><td style="text-align:right">${baht(r.BaseSalary)}</td></tr>
    <tr><td>เบี้ยขยัน (มาครบ ${baht(r.DiligenceAttendance)} + FB ${baht(r.DiligenceFacebook)})</td><td style="text-align:right">${baht(r.DiligenceTotal)}</td></tr>
    <tr><td>รายได้อื่นๆ${r.ChildCount?` <small class="muted">(เด็ก ${r.ChildCount} คน × ${baht(r.ChildMultiplier)})</small>`:''}</td><td style="text-align:right">${baht(r.OtherIncome)}</td></tr>
    <tr><td>ค่าสวงเวลาตอนเย็น</td><td style="text-align:right">${baht(r.OTEvening)}</td></tr>
    ${Number(r.OTCarry||0)?`<tr><td>ค้างจ่าย OT เดือนก่อน <small class="muted">(${esc(carryMonths(r))})</small></td><td style="text-align:right">${baht(r.OTCarry)}</td></tr>`:''}
    ${Number(r.OTHoliday||0)?`<tr><td>🎉 OT วันหยุด</td><td style="text-align:right">${baht(r.OTHoliday)}</td></tr>`:''}
    <tr><td>เงินพิเศษวันพักผ่อน</td><td style="text-align:right">${baht(r.HolidayBonus)}</td></tr>
    <tr style="border-top:1px solid var(--line)"><td><b>รวมรายได้</b></td><td style="text-align:right"><b>${baht(r.GrossIncome)}</b></td></tr>
    <tr><td>หัก ประกันสังคม</td><td style="text-align:right">-${baht(r.SocialSecurity)}</td></tr>
    <tr><td>หัก เงินสมทบ (พนักงาน)</td><td style="text-align:right">-${baht(r.Contribution||0)}</td></tr>
    ${Number(r.OtherDeductions||0)?`<tr><td>หัก อื่นๆ</td><td style="text-align:right">-${baht(r.OtherDeductions)}</td></tr>`:''}
    <tr><td><b>รวมหัก</b></td><td style="text-align:right"><b>-${baht(r.TotalDeductions)}</b></td></tr>
    ${adjRows(r).length?`<tr><td colspan="2"><small class="muted">${adjRows(r).map(a=>esc(a.label||'-')+' '+(Number(a.amount)<0?'−':'+')+baht(Math.abs(a.amount))).join(' · ')}</small></td></tr>`:''}
    <tr style="border-top:2px solid var(--blue)"><td><b>โอนเข้า ${esc(r.BankAccount)} (สุทธิ)</b></td><td style="text-align:right;color:var(--blue);font-size:18px"><b>${baht(r.NetPay)}</b></td></tr>
    </table>
    ${Number(r.Contribution||0)||Number(r.ContributionAccum||0)?`<div style="margin-top:8px;padding-top:6px;border-top:1px dashed var(--line);font-size:13px" class="muted">
      💰 เงินสมทบเดือนนี้: หักพนักงาน ${baht(r.Contribution||0)} + โรงเรียนสมทบ ${baht(r.ContributionEmployer!=null?r.ContributionEmployer:r.Contribution||0)}
      · <b style="color:var(--ink)">เงินสมทบสะสมรวม ${baht(r.ContributionAccum||0)}</b></div>`:''}
    </div>`; }

  // ================= ADMIN =================
  const pctColor = p => p>=100?'var(--ok)':p>=90?'var(--warn-2)':'var(--bad-2)'; // green / amber / red attendance
  SCREENS.Admin.home = async () => { const [d,rem,lrem,pend,fin]=await Promise.all([api('dashboard'),api('payrollReminderDue'),api('leaveResetReminder'),api('pendingPayments'),api('financeSummary',{})]);
    const pendN=pend.length;
    // ---- payment tracking (this month): monthly tuition + student OT collection ----
    /* THREE KINDS OF MONEY, EACH REPORTED AS ITSELF.
     * A ฿2,000 entry fee was billed and appeared on no screen at all: the card only ever showed
     * tuition and OT, and the month's total added the OT twice on top (the server's
     * `tuitionCollected` has never been tuition — it is everything). Reported 2026-08-24.
     */
    const tuiPct = fin.studentsTotal?Math.round(fin.studentsPaid/fin.studentsTotal*100):100;
    const tuiOut = Number(fin.tuitionOutstanding||0);
    const _chOut = Number(fin.chargesOutstanding||0);
    const _otOut = Number(fin.otOutstanding||0);
    const _tuiCol = Number(fin.collectedTuition||0);
    const _chCol = Number(fin.collectedCharges||0);
    // The card showed what came in and what is still owed, but never the two added up — so "how much
    // is this month worth in total?" could not be read off it, only worked out on paper.
    const _otCol=Number(fin.collectedOT||0);
    const _allIn=Number(fin.collectedAll||0);                 // money actually received (each kind once)
    const _allOut=tuiOut+_chOut+_otOut;                       // still owed
    const _allTotal=_allIn+_allOut;                           // everything billed this month
    const _line=(icon,label,col,out,warn)=>`
      <div class="spread" style="font-size:14px"><span>${icon} ${esc(label)}</span><span class="muted">${EN()?'this month':'เดือนนี้'}</span></div>
      <div class="spread" style="font-size:13px"><span class="muted">${EN()?'Collected':'เก็บได้'} <b style="color:var(--ok)">${baht(col)}</b></span><span class="muted">${EN()?'Outstanding':'ค้างชำระ'} <b style="color:${out>0?(warn?'var(--warn)':'var(--bad)'):'var(--ok)'}">${baht(out)}</b></span></div>`;
    const payHtml=`<div class="card"><div class="spread"><h3>💰 ${EN()?'Payment tracking':'ติดตามการชำระเงิน'} <small class="muted">(${esc(fin.month||monthStr())})</small></h3><button class="btn sm outline" onclick="GO('finance')">${EN()?'Details':'รายละเอียด'}</button></div>
      <div style="text-align:center;margin:6px 0 8px;padding:8px;background:var(--surface-2);border-radius:10px">
        <small class="muted">${EN()?'Total billed this month (tuition + extras + student OT)':'ยอดทั้งหมดเดือนนี้ (ค่าเทอม + ค่าใช้จ่ายเพิ่มเติม + OT นักเรียน)'}</small>
        <div style="font-size:24px;font-weight:800;line-height:1.2">${baht(_allTotal)}</div>
        <small class="muted">${EN()?'Collected':'เก็บได้'} <b style="color:var(--ok)">${baht(_allIn)}</b> · ${EN()?'Outstanding':'ค้างชำระ'} <b style="color:${_allOut>0?'var(--bad)':'var(--ok)'}">${baht(_allOut)}</b></small></div>
      <div class="spread" style="font-size:14px;margin-top:4px"><span>🏫 ${EN()?'Monthly tuition':'ค่าเทอมรายเดือน'}</span><b style="color:${pctColor(tuiPct)}">${fin.studentsPaid}/${fin.studentsTotal} <small class="muted" style="font-weight:400">(${tuiPct}%)</small></b></div>
      <div style="height:6px;background:var(--line);border-radius:4px;overflow:hidden;margin:4px 0"><div style="height:100%;width:${tuiPct}%;background:${pctColor(tuiPct)}"></div></div>
      <div class="spread" style="font-size:13px"><span class="muted">${EN()?'Collected':'เก็บได้'} <b style="color:var(--ok)">${baht(_tuiCol)}</b></span><span class="muted">${EN()?'Outstanding':'ค้างชำระ'} <b style="color:${tuiOut>0?'var(--bad)':'var(--ok)'}">${baht(tuiOut)}</b></span></div>
      ${(_chCol||_chOut)?`<hr style="border:none;border-top:1px solid var(--surface-3);margin:8px 0">
      ${_line('➕', EN()?'Extra charges':'ค่าใช้จ่ายเพิ่มเติม', _chCol, _chOut)}`:''}
      <hr style="border:none;border-top:1px solid var(--surface-3);margin:8px 0">
      ${_line('⏰', EN()?'Student OT':'OT นักเรียน', _otCol, _otOut, true)}</div>`;
    const remHtml = rem.due?`<div class="card" style="background:var(--warn-bg);border-color:var(--warn-line);color:var(--warn)"><div class="spread"><b>🔔 ${esc(t('admin.payrollReminder'))}</b><button class="btn sm" onclick="GO('payroll')">${esc(t('admin.goPayroll'))}</button></div><small>${esc(t('admin.payrollReminderSub').replace('{d}',rem.lastDay-1).replace('{last}',rem.lastDay))}</small></div>`:'';
    const leaveRemHtml = lrem.due?`<div class="card" style="background:var(--ok-bg);border-color:var(--ok-line);color:var(--ok)"><div class="spread"><b>🗓️ ${esc(t('admin.leaveReset'))}</b><button class="btn sm" onclick="A_settings()">${esc(t('manage.settings'))}</button></div><small>${esc(t('admin.leaveResetSub'))}</small></div>`:'';
    /* Open — but open TO WHOM. The dashboard used to work this out for itself and treated a Big
     * Cleaning day as an ordinary working day for everybody, so on a holiday that was also a Big
     * Cleaning day it marked all 31 children ขาด. The server already answers both questions
     * (schoolDayFor_) and now sends the answer with the dashboard; the two cards ask different halves:
     *   · the children's card → closedForStudents (the nursery is shut to the families)
     *   · the staff card      → closed            (a meeting Saturday IS a working day)
     */
    const _day=d.day||{};
    const _closedStd=!!_day.closedForStudents, _closedStaff=!!_day.closed;
    const _closed=_closedStd;                                   // the dashboard is mostly about the children
    const _closedWhy=EN()?(_day.reasonEN||'holiday'):(_day.reason||'วันหยุด');
    const closedBanner=_closedStd?`<div class="card" style="background:var(--surface-3);border-color:var(--line-strong);color:var(--ink-3);text-align:center"><b>🏖️ ${EN()?'School closed today':'วันนี้โรงเรียนหยุด'} (${esc(_closedWhy)}) — ${EN()?'attendance not counted':'ไม่นับการมาเรียน'}</b>${_day.bigCleaning?`<br><small>${BC_ICON} ${EN()?`Meeting day — staff work ${esc(_day.bcIn||'')}–${esc(_day.bcOut||'')}`:`${BC_NAME()} — พนักงานทำงาน ${esc(_day.bcIn||'')}–${esc(_day.bcOut||'')}`}</small>`:''}</div>`:'';
    // at-a-glance KPI tiles (tap → the relevant screen)
    const _attTs=d.classes.reduce((a,c)=>{a.p+=c.in+c.out;a.t+=c.total;return a;},{p:0,t:0}); const _attPct=_attTs.t?Math.round(_attTs.p/_attTs.t*100):100;
    const _pl=Number(d.pendingLeaves||0);
    const kpi=`<div class="kpigrid">
      <button class="kpi blue" onclick="GO('daily')"><span class="kic">👶</span><b class="kn" style="color:${_closed?'var(--ink-3)':pctColor(_attPct)}">${_closed?(EN()?'Holiday':'หยุด'):_attPct+'%'}</b><span class="kl">${EN()?'Attendance today':'มาเรียนวันนี้'}</span></button>
      <button class="kpi amber" onclick="A_finTab('in')"><span class="kic">💰</span><b class="kn" style="color:${tuiOut>0?'var(--bad)':'var(--ok)'}">${baht(tuiOut)}</b><span class="kl">${EN()?'Tuition outstanding':'ค้างค่าเทอม'}</span>
        <span class="kl" style="margin-top:2px">⏰ ${EN()?'OT':'OT'} <b style="color:${_otOut>0?'var(--warn)':'var(--ok)'}">${baht(_otOut)}</b>${_chOut?` · ➕ <b style="color:var(--warn)">${baht(_chOut)}</b>`:''}</span></button>
      <button class="kpi green" onclick="A_finTab('wait')"><span class="kic">✅</span><b class="kn" style="color:${pendN?'var(--warn)':'var(--ok)'}">${pendN}</b><span class="kl">${EN()?'Slips to verify':'รอตรวจสลิป'}</span></button>
      <button class="kpi pink" onclick="GO('leaves')"><span class="kic">📩</span><b class="kn" style="color:${_pl?'var(--warn)':'var(--ok)'}">${_pl}</b><span class="kl">${EN()?'Leaves to approve':'รออนุมัติลา'}</span></button></div>`;
    const quick=`<div class="qbar"><button class="btn sm" onclick="GO('daily')">📋 ${esc(t('daily.title'))}</button><button class="btn sm outline" onclick="GO('absence')">🔎 ${esc(t('abs.title'))}</button><button class="btn sm outline" onclick="A_addAnn()">➕ ${esc(t('lbl.addAnn'))}</button><button class="btn sm outline" onclick="A_linkParent()">🔗 ${EN()?'Link parent':'เชื่อมผู้ปกครอง'}</button><button class="btn sm outline" onclick="A_viewAs()">👁️ ${EN()?'View as':'ดูมุมมอง'}</button><button class="btn sm outline" onclick="GO('manage')">🗂️ ${esc(t('title.manage'))}</button></div>`;
    app.innerHTML=`<div class="dash-h"><h2 class="page">${esc(t('title.dashboard'))}</h2><span class="dash-date">${esc(todayStr())}</span></div>
      ${closedBanner}<div id="aholot"></div>${remHtml}${leaveRemHtml}
      ${kpi}${quick}
      ${payHtml}
      <div class="card"><div class="spread"><h3>👶 ${EN()?'Attendance by class':'การมาเรียนแต่ละชั้น'}</h3>${_closed?`<span class="pill" style="background:var(--surface-3);color:var(--ink-3)">🏖️ ${EN()?'Holiday':'วันหยุด'}</span>`:''}</div>
        ${_closed?`<div style="text-align:center;color:var(--ink-3);padding:10px 0"><b>${EN()?'School closed — no attendance today':'โรงเรียนหยุด — ไม่มีการมาเรียนวันนี้'}</b></div>`:`
        ${(()=>{ const ts=d.classes.reduce((a,c)=>{a.p+=c.in+c.out;a.t+=c.total;return a;},{p:0,t:0}); const tp=ts.t?Math.round(ts.p/ts.t*100):100;
          return `<div class="spread" style="font-size:15px;margin-bottom:8px"><b>${EN()?'Total':'รวมทั้งหมด'}</b><b style="color:${pctColor(tp)}">${tp}% <small class="muted" style="font-weight:400">(${ts.p}/${ts.t})</small></b></div>`; })()}
        ${d.classes.map(c=>{ const present=c.in+c.out; const pct=c.total?Math.round(present/c.total*100):100; const miss=(c.students||[]).filter(s=>s.status==='ABSENT'||s.status==='LEAVE');
          return `<div style="margin-bottom:12px"><div class="spread"><b>${esc(c.className)}</b><span style="font-weight:700;color:${pctColor(pct)}">${pct}% <small class="muted" style="font-weight:400">(${present}/${c.total})</small></span></div>
            <div style="height:6px;background:var(--line);border-radius:4px;overflow:hidden;margin:4px 0"><div style="height:100%;width:${pct}%;background:${pctColor(pct)}"></div></div>
            ${(()=>{ // teachers see "in" and "picked up" separately; Admin lumped them into one "มา"
              // line, so the two screens disagreed on who was still at school
              const inb=(c.students||[]).filter(s=>s.status==='IN'); const gone=(c.students||[]).filter(s=>s.status==='OUT');
              const lv=(c.students||[]).filter(s=>s.status==='LEAVE'); const ab=(c.students||[]).filter(s=>s.status==='ABSENT');
              return `${inb.length?`<div><span class="pill ok">✅ ${EN()?'at school':'อยู่ที่โรงเรียน'} (${inb.length})</span> <small class="muted">${inb.map(s=>esc(dnick(s))+(s.in?' '+esc(s.in):'')).join(', ')}</small></div>`:''}
                ${gone.length?`<div style="margin-top:2px"><span class="pill info">🔄 ${EN()?'picked up':'รับกลับแล้ว'} (${gone.length})</span> <small class="muted">${gone.map(s=>esc(dnick(s))+(s.out?' '+esc(s.out):'')).join(', ')}</small></div>`:''}
                ${lv.length?`<div style="margin-top:2px"><span class="pill wait">🌴 ${EN()?'leave':'ลา'} (${lv.length})</span> <small class="muted">${lv.map(s=>esc(dnick(s))).join(', ')}</small></div>`:''}
                ${ab.length?`<div style="margin-top:2px"><span class="pill bad">⛔ ${EN()?'absent':'ขาด'} (${ab.length})</span> <small class="muted">${ab.map(s=>esc(dnick(s))).join(', ')}</small></div>`:''}
                ${!lv.length&&!ab.length?`<small style="color:var(--ok)">✓ ${EN()?'All present':'มาครบทุกคน'}</small>`:''}
                ${(()=>{ // a child whose temporary leave has run out is back on this list — say so, or
                  // "ขาด" is the only word anyone sees for a child everybody knew was away
                  const due=(c.students||[]).filter(s=>s.pauseDue);
                  return due.length?`<div style="margin-top:2px"><span class="pill info">🔄 ${EN()?'due back from leave':'ลาชั่วคราว · ครบกำหนดแล้ว'} (${due.length})</span> <small class="muted">${due.map(s=>esc(dnick(s))).join(', ')}</small></div>`:''; })()}`; })()}</div>`;}).join('')}`}</div>
      ${A_pausedCard(d.paused)}
      <div class="card"><div class="spread"><h3>👩‍🏫 ${EN()?'Staff today':'พนักงานวันนี้'}</h3>${_closedStaff?`<span class="pill" style="background:var(--surface-3);color:var(--ink-3)">🏖️ ${EN()?'Holiday':'วันหยุด'}</span>`:(_day.bigCleaning?`<span class="pill wait">${BC_ICON} ${BC_SHORT()}</span>`:'')}</div>
        ${_closedStaff?`<div style="text-align:center;color:var(--ink-3);padding:10px 0"><b>${EN()?'School closed — nobody is expected in today':'โรงเรียนหยุด — ไม่มีใครต้องเข้างานวันนี้'}</b></div>`:
        (()=>{ const present=d.staff.filter(s=>s.status==='IN'||s.status==='OUT').length; const t=d.staff.length; const pct=t?Math.round(present/t*100):100;
          const onTime=d.staff.filter(s=>(s.status==='IN'||s.status==='OUT')&&!s.late); const late=d.staff.filter(s=>s.late); const absent=d.staff.filter(s=>s.status==='ABSENT'||s.status==='LEAVE');
          // in-AND-out: the dashboard only ever showed the arrival, so there was no way to see who had
          // already left. "–" with nothing after it means still at work.
          const hhmm=v=>String(v||'').slice(0,5);
          const inOut=s2=>{ const i=hhmm(s2.checkIn), o=hhmm(s2.checkOut); return i?(' '+i+'–'+(o||'')):''; };
          return `<div class="spread" style="font-size:15px"><b>${EN()?'Present':'มาทำงาน'}</b><b style="color:${pctColor(pct)}">${pct}% <small class="muted" style="font-weight:400">(${present}/${t})</small></b></div>
            ${onTime.length?`<div style="margin-top:6px"><span class="pill ok">✅ ${EN()?'On time':'ตรงเวลา'} (${onTime.length})</span> <small class="muted">${onTime.map(s=>esc(dnick(s))+esc(inOut(s))).join(', ')}</small></div>`:''}
            ${late.length?`<div style="margin-top:6px"><span class="pill bad">⏰ ${EN()?'Late':'มาสาย'} (${late.length})</span> <small style="color:var(--warn)">${late.map(s=>esc(dnick(s))+esc(inOut(s))+(s.late?` (${EN()?'late ':'สาย '}${s.late}${EN()?'m':'น.'})`:'')).join(', ')}</small></div>`:''}
            ${absent.length?`<div style="margin-top:6px"><span class="pill wait">⛔ ${EN()?'Absent/leave':'ขาด/ลา'} (${absent.length})</span> <small class="muted">${absent.map(s=>esc(dnick(s))+(s.status==='LEAVE'?(EN()?' (leave)':' (ลา)'):'')).join(', ')}</small></div>`:''}
            ${!late.length&&!absent.length?`<small style="color:var(--ok)">✓ ${EN()?'All present & on time':'มาครบ ตรงเวลา'}</small>`:''}`; })()}</div>
      <div class="card"><div class="spread"><h3>🚑 ${EN()?'Injury reports':'รายงานอุบัติเหตุ'}</h3><button class="btn sm outline" onclick="A_injuries()">${EN()?'Open':'ดูรายงาน'}</button></div>
        <small class="muted">${EN()?'Read what a teacher reported and see the month at a glance.':'อ่านรายงานที่คุณครูแจ้งมา และดูสรุปรายเดือน'}</small></div>
      <div class="card"><div class="spread"><h3>📢 ${EN()?"Announcements":"ประกาศ"}</h3><div id="annTabs"></div></div><div id="anns"></div></div>`;
    /* WHO IS AT SCHOOL ON A DAY THE SCHOOL IS SHUT.
     *
     * On Saturday 22/08/26 ครูจอย was given OT วันหยุด to look after น้องโมน่า, and the dashboard —
     * the one screen whose whole job is "what is happening today" — said only "โรงเรียนหยุด". The
     * arrangement existed in OT_RECORDS and HOLIDAY_ATTEND and nowhere a person could see it, so
     * nobody could tell whether it had been recorded at all. Names, money, and whether each of them
     * has actually arrived. It draws nothing on an ordinary open day.
     */
    api('holidayAttendList',{}).then(h=>{
      const el=document.getElementById('aholot'); if(!el) return;
      if(!h||!h.closed||(!h.count&&!(h.staff||[]).length)){ el.innerHTML=''; return; }
      const dn=x=>EN()?(x.nickEN||x.nameEN||x.nick||x.name):(x.nick||x.name);
      const arr=x=>x.checkIn?`🟢 ${esc(String(x.checkIn).slice(0,5))}${x.checkOut?` → 🔴 ${esc(String(x.checkOut).slice(0,5))}`:''}`
        :`<span style="color:var(--warn)">${EN()?'not clocked in yet':'ยังไม่ได้ลงเวลา'}</span>`;
      el.innerHTML=`<div class="card" style="background:var(--blue-bg);border-color:var(--blue-line)">
        <div class="spread"><h3 style="margin:0">🎉 ${EN()?'Working today (holiday)':'ทำงานวันนี้ (วันหยุด)'}</h3>
          <span class="muted">${esc(ddmmyyyy(h.date))}${h.reason?' · '+esc(h.reason):''}</span></div>
        ${(h.staff||[]).length?`<div style="margin-top:6px"><b>👩‍🏫 ${EN()?'Staff on holiday OT':'คุณครูที่ทำ OT วันหยุด'} (${(h.staff||[]).length})</b>
          ${(h.staff||[]).map(s=>`<div class="list-item"><span><b>${esc(dn(s))}</b> <small class="muted">${esc(s.dept||'')}</small>
            <br><small class="muted">${arr(s)}${s.note?' · '+esc(s.note):''}</small></span>
            <b style="flex:0 0 auto;color:var(--ok)">${esc(baht(s.amount||0))}</b></div>`).join('')}</div>`
          :`<small class="muted">${EN()?'No staff has been given holiday OT for today.':'ยังไม่มีคุณครูที่ได้รับ OT วันหยุดของวันนี้'}</small>`}
        <div style="margin-top:8px"><b>👶 ${EN()?'Children expected':'นักเรียนที่มาวันนี้'} (${h.count||0})</b>
          ${(h.students||[]).length?(h.students||[]).map(s=>`<div class="list-item"><span><b>${esc(dn(s))}</b> <small class="muted">${esc(s.class||'')}</small>
            <br><small class="muted">🟢 ${esc(s.inTime||'—')} → 🔴 ${esc(s.outTime||'—')}${s.otAmount>0?` · <span style="color:var(--warn)">OT ${esc(baht(s.otAmount))}</span>`:''}</small></span></div>`).join('')
            :`<br><small class="muted">${EN()?'Nobody is on today’s list — only the staff above are in.':'ไม่มีนักเรียนในรายชื่อวันนี้ — มีเฉพาะคุณครูข้างต้นเข้างาน'}</small>`}</div>
        <small class="muted" style="display:block;margin-top:6px">${EN()
          ? 'For these people today is a working day: they clock in and out, and the children are checked in, journalled and charged as usual.'
          : 'สำหรับคนกลุ่มนี้ วันนี้คือวันทำงาน — ลงเวลาเข้า-ออกได้ และนักเรียนลงเวลา/บันทึก/คิดค่าใช้จ่ายได้ตามปกติ'}</small></div>`;
    }).catch(()=>{});
    const _anns=await api('announcements'); A_CACHE.announcements=_anns;
    const _annEl=$('#anns'); if(!_annEl) return; // user navigated away before this resolved
    A_annRender();
  };
  /* The list was every announcement the school has ever posted, in whatever order the sheet held
   * them, with no way to tell which are actually on show. It is now filtered by the phase the
   * SERVER computed (annPhase_ — one rule, so the list and the parents' screens cannot disagree),
   * newest first, and each row says its window in words. Mobile-first: the filter is a single row of
   * short chips, and the list scrolls inside its own box instead of pushing the page down. */
  let ANN_TAB='live';
  window.A_annTab=(k)=>{ ANN_TAB=k; A_annRender(); };
  window.A_annRender=()=>{
    const all=A_CACHE.announcements||[];
    const of=k=>all.filter(a=>String(a.Phase||'live')===k);
    const groups={live:of('live'),soon:of('soon'),ended:of('ended'),all:all};
    const tabs=[['live','▶️',EN()?'Showing':'กำลังแสดง'],['soon','🕘',EN()?'Scheduled':'ยังไม่ถึงเวลา'],
                ['ended','🔕',EN()?'Ended':'จบแล้ว'],['all','📋',EN()?'All':'ทั้งหมด']];
    const tEl=document.getElementById('annTabs');
    if(tEl) tEl.innerHTML=`<div class="seg" style="margin:0">${tabs.map(([k,ic,lb])=>
      `<button class="${ANN_TAB===k?'active':''}" style="font-size:12px;padding:4px 8px" onclick="A_annTab('${k}')">${ic} ${esc(lb)} (${groups[k].length})</button>`).join('')}</div>`;
    const el=document.getElementById('anns'); if(!el) return;
    // "19/08/2026 06:00 → 19/08/2026 12:30", collapsing to a bare date when no time was set
    const when=a=>{ const s=a.StartDate?ddmmyyyy(a.StartDate)+(a.StartTime?' '+a.StartTime:''):'';
      const e=a.EndDate?ddmmyyyy(a.EndDate)+(a.EndTime?' '+a.EndTime:''):'';
      return e?`${s} → ${e}`:(s?`${s} → ${EN()?'no end':'ไม่มีวันสิ้นสุด'}`:'-'); };
    const phasePill=a=>({live:`<span class="pill ok" style="font-size:11px">▶️ ${EN()?'showing':'กำลังแสดง'}</span>`,
      soon:`<span class="pill wait" style="font-size:11px">🕘 ${EN()?'scheduled':'รอเวลา'}</span>`,
      ended:`<span class="pill" style="font-size:11px;background:var(--surface-3);color:var(--ink-3)">🔕 ${EN()?'ended':'จบแล้ว'}</span>`}[String(a.Phase||'live')]||'');
    const rows=groups[ANN_TAB]||[];
    el.innerHTML=rows.length?`<div style="max-height:46vh;overflow:auto">${rows.map(a=>{
      const ti=EN()?(a.TitleEN||a.Title):(a.Title||a.TitleEN);
      return `<div class="list-item" style="align-items:flex-start"><div style="flex:1;min-width:0">
        <b>${esc(ti)}</b> ${phasePill(a)}${a.Popup?` <span class="pill info" style="font-size:11px">Pop-up</span>`:''}${Number(a.Priority||0)>=2?` <span class="pill" style="font-size:11px;background:var(--warn-bg);color:var(--warn)">⭐ ${esc(t('ann.pri.high'))}</span>`:''}
        <br><small class="muted">${esc(when(a))}</small></div>
        <span class="row" style="flex:0 0 auto"><button class="btn sm outline" onclick="A_editAnn('${a.AnnID}')" aria-label="${EN()?"Edit":"แก้ไข"}" title="${EN()?"Edit":"แก้ไข"}">✏️</button><button class="btn sm pink" onclick="A_delAnn('${a.AnnID}')" aria-label="${EN()?"Delete":"ลบ"}" title="${EN()?"Delete":"ลบ"}">🗑️</button></span></div>`;
      }).join('')}</div>`
      : `<small class="muted">${ANN_TAB==='live'?(EN()?'Nothing is showing right now':'ตอนนี้ไม่มีประกาศที่กำลังแสดง'):esc(t('c.noItems'))}</small>`;
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
    <div class="grid2"><label class="field"><span>${esc(t('ann.start'))}</span><input type="date" id="anStart" value="${esc(a.StartDate||todayStr())}"/></label><label class="field"><span>${esc(t('ann.startTime'))}</span><input type="time" id="anStartT" value="${esc(a.StartTime||'')}"/></label></div>
    <div class="grid2"><label class="field"><span>${esc(t('ann.end'))}</span><input type="date" id="anEnd" value="${esc(a.EndDate||'')}"/></label><label class="field"><span>${esc(t('ann.endTime'))}</span><input type="time" id="anEndT" value="${esc(a.EndTime||'')}"/></label></div>
    <small class="muted">${esc(t('ann.timeNote'))}</small>
    <button class="btn block" style="margin-top:8px" onclick="A_addAnnDo(this,'${annId||''}')">บันทึกประกาศ / Save</button>`); };
  window.A_addAnnDo=async(btn,annId)=>{ const m=btn.closest('.modal'); const q=s=>m.querySelector(s).value.trim();
    const title=q('#anT'), titleEN=q('#anTE'); if(!title&&!titleEN){toast('ใส่หัวข้อ / Enter a title');return;}
    const image=photoVal(m,'anImg');
    const data={title:title||titleEN,titleEN:titleEN||title,content:q('#anC'),contentEN:q('#anCE'),image,popup:m.querySelector('#anPopup').checked,priority:Number(m.querySelector('#anPri').value)||0,
      startDate:q('#anStart'),endDate:q('#anEnd'),startTime:q('#anStartT'),endTime:q('#anEndT')};
    // an end time with no end DATE would never arrive — say so rather than saving something that
    // silently never stops
    if(data.endTime&&!data.endDate){ toast(EN()?'Set the end date too':'ใส่วันที่สิ้นสุดด้วย'); return; }
    if(data.endDate&&data.startDate&&data.endDate<data.startDate){ toast(EN()?'The end is before the start':'วันสิ้นสุดอยู่ก่อนวันเริ่ม'); return; }
    if(data.endDate&&data.endDate===data.startDate&&data.startTime&&data.endTime&&data.endTime<data.startTime){
      toast(EN()?'On the same day, the end time is before the start time':'วันเดียวกัน แต่เวลาสิ้นสุดอยู่ก่อนเวลาเริ่ม'); return; }
    if(annId) await api('editAnnouncement',Object.assign({annId},data)); else await api('addAnnouncement',data);
    m.remove(); confirmSaved(t('c.saved')); GO('home'); };
  window.A_editAnn=(annId)=>A_addAnn(annId);
  window.A_delAnn=(annId)=>{ if(!confirm(t('manage.confirmDel')))return;
    deleteWithUndo(EN()?'Announcement deleted':'ลบประกาศแล้ว', ()=>api('deleteAnnouncement',{annId}).then(()=>GO('home')), ()=>GO('home')); };

  // one admin leave card: nickname + dept + type/dates + reason + status + actions (approve/reject/edit/cancel)
  function leaveAdminCard(l){ const isPA=String(l.Status)==='PENDING_ADMIN';
    return `<div class="card"><div class="spread"><div><b>${esc(leaveName(l))}</b> <small class="muted">(${esc(l.Department||'-')})</small><br>${esc(l.Type)} ${esc(l.StartDate)}→${esc(l.EndDate)} (${esc(leaveDays(l.Days))}${l.HalfDay?' · '+esc(halfLabel(l.HalfDay)):''})${leaveDoc(l)}<br><small class="muted">${esc(l.Reason||'')}</small>${l.Step1ApproverName?`<br><small>${EN()?'via leader':'ผ่านหัวหน้างาน'}: ${esc(l.Step1ApproverName)}${l.Step1CrossDept==='YES'?' ⚠️ '+(EN()?'cross-dept':'ข้ามแผนก'):''}</small>`:''}</div>${leaveStatusPill(l.Status)}</div>
      <div class="row" style="margin-top:8px">${isPA?`<button class="btn sm green" onclick="A_leave('${l.LeaveID}','approve')">${esc(t('ot.approve'))}</button><button class="btn sm pink" onclick="A_leave('${l.LeaveID}','reject')">${esc(t('ot.reject'))}</button>`:''}<button class="btn sm outline" onclick="A_editLeave('${l.LeaveID}')">✏️ ${EN()?'Edit':'แก้ไข'}</button><button class="btn sm pink" onclick="A_cancelLeave('${l.LeaveID}')">🗑️ ${EN()?'Cancel':'ยกเลิก'}</button></div></div>`; }
  // month calendar of who is on leave each day (spot same-day overlaps — ≥2 on a day is flagged red)
  function leaveCalendar(all){
    const render=()=>{ const b=calBase(),y=b.getFullYear(),mo=b.getMonth(); const now=new Date(); const isCur=CAL_OFF===0;
      const first=new Date(y,mo,1).getDay(),days=new Date(y,mo+1,0).getDate(); const byDay={};
      all.filter(l=>l.Status!=='REJECTED').forEach(l=>{ const st=new Date(l.StartDate),en=new Date(l.EndDate);
        for(let dt=new Date(st);dt<=en;dt.setDate(dt.getDate()+1)){ if(dt.getFullYear()===y&&dt.getMonth()===mo)(byDay[dt.getDate()]=byDay[dt.getDate()]||[]).push(leaveName(l)); } });
      let cells=['อา','จ','อ','พ','พฤ','ศ','ส'].map(w=>`<div style="text-align:center;font-size:13px;color:var(--ink-3)">${EN()?({'อา':'Su','จ':'Mo','อ':'Tu','พ':'We','พฤ':'Th','ศ':'Fr','ส':'Sa'}[w]):w}</div>`).join('');
      for(let i=0;i<first;i++)cells+='<div class="d dim"></div>';
      const holByDay={}; (window._LV_HOL||[]).forEach(h=>{ const d=new Date(h.Date); if(d.getFullYear()===y&&d.getMonth()===mo) holByDay[d.getDate()]=holLabel(h); });
      const bcByDay={}; (window._LV_BC||[]).forEach(s=>{ const d=new Date(s); if(d.getFullYear()===y&&d.getMonth()===mo) bcByDay[d.getDate()]=1; });
      // OT วันหยุด on the calendar: a day someone came in on their day off is the sort of thing that
      // has to be VISIBLE next to the leave it sits among, or the only place it exists is a list
      // nobody opens. Names, so the admin can see at a glance who was in.
      const otByDay={}; (window._LV_HOT||[]).forEach(o=>{ const d=new Date(o.Date);
        if(d.getFullYear()===y&&d.getMonth()===mo){ (otByDay[d.getDate()]=otByDay[d.getDate()]||[]).push(dnick(o)); } });
      for(let dd=1;dd<=days;dd++){ const ppl=byDay[dd]; const today=(isCur&&dd===now.getDate())?'today':''; const clash=ppl&&ppl.length>=2;
        const bg=clash?'background:var(--bad-bg);border-color:var(--bad-line);':calOffBg(y,mo,dd,holByDay[dd],bcByDay[dd]);
        const ot=otByDay[dd];
        cells+=`<div class="d ${ppl||ot?'ev':''} ${today}" style="min-height:52px;${bg}">${dd}${holByDay[dd]?`<span class="io" style="text-align:left;color:var(--bad);font-weight:600">🏖️ ${esc(holByDay[dd])}</span>`:''}${bcByDay[dd]&&!holByDay[dd]?`<span class="io" style="text-align:left;color:var(--teal);font-weight:600">${BC_ICON}</span>`:''}${ot?`<span class="io" style="text-align:left;color:var(--warn);font-weight:700" title="${esc(EN()?'Holiday OT':'OT วันหยุด')}: ${esc(ot.join(', '))}">🎉 ${esc(ot.length===1?ot[0]:ot.length)}</span>`:''}${ppl?`<span class="io" style="text-align:left;color:${clash?'var(--bad)':'var(--ok)'};font-weight:600">${esc(ppl.join('\n'))}</span>`:''}</div>`; }
      return `${calNavHeader(y,mo)}<div class="cal">${cells}</div><small class="muted">${EN()?`Red = 2+ staff on leave · weekend/holiday · ${BC_ICON} meeting · 🎉 holiday OT`:`สีแดง = ลาซ้ำ ≥2 คน · เสาร์-อาทิตย์/วันหยุด · ${BC_ICON} ประชุม · 🎉 OT วันหยุด`}</small>`; };
    window._CALRENDER=render;
    return `<div class="card"><div id="calWrap">${render()}</div></div>`; }

  let LV_TAB='pending';  // default sub-tab (teacher view) = in-progress
  let LV_MAIN='staff';   // main tab: 'staff' (teachers) | 'student'
  // The ⏰ time/OT tools used to live under จัดการ, two screens away from the approving they belong
  // to. They sit here now, split the same way the tabs are: teacher tools on the teacher tab,
  // the student one on the student tab.
  // some labels already carry their own icon (t('ot.adminOT') is "⏰ OT คุณครู") — don't print it twice
  const opTools = items => `<div class="card" style="padding:8px"><div class="grid2" style="gap:8px">${
    items.map(([ic,label,fn])=>{ const L=String(label); const dup=L.slice(0,3).indexOf(ic)>=0;
      return `<button class="btn sm outline" style="text-align:left" onclick="${fn}">${dup?'':ic+' '}${esc(L)}</button>`;
    }).join('')}</div></div>`;

  /* ---- one month of working time, per teacher --------------------------------------------------
   * The school could see who was on leave and who was in today, but not how a teacher's MONTH went
   * without opening the spreadsheet. Overview first — one row per teacher with the totals — then any
   * row opens the day-by-day calendar behind those totals.
   *
   * Late minutes and OT are shown as they were RECORDED on the day, so this cannot drift away from
   * the payslip. Weekends, holidays and days before someone started are not absences.
   */
  let SM_MONTH=null;
  const smStat = (n,label,color) => `<div class="stat ${color||''}"><div class="n">${n}</div><div class="l">${esc(label)}</div></div>`;
  window.A_staffMonth = async (month) => {
    SM_MONTH = month || SM_MONTH || monthStr();
    let d; try { d = await api('staffAttendanceMonth',{month:SM_MONTH,staffId:USER.staffId}); } catch(e){ err(e); return; }
    window._SM = d;
    const rows = sortPeopleD(d.staff||[]).map(s=>`
      <div class="list-item" style="cursor:pointer" onclick="A_staffMonthOne('${esc(s.staffId)}')">
        <span><b>${esc(dnick(s))}</b>${dnSub(s)?` <small class="muted" style="font-weight:400">${esc(dnSub(s))}</small>`:''}
          <br><small class="muted">${EN()?'present':'มาทำงาน'} ${s.present} · ${EN()?'late':'สาย'} ${s.lateDays}${s.lateMinutes?` (${s.lateMinutes} ${EN()?'min':'นาที'})`:''} · ${EN()?'leave':'ลา'} ${s.leaveDays} · ${EN()?'absent':'ขาด'} ${s.absent}${s.otHours?` · OT ${s.otHours} ${EN()?'hr':'ชม.'}`:''}</small></span>
        <span style="text-align:right">${
          // a day with an arrival and no departure is NOT "ครบ" — that is what let ก้อย read as
          // complete with two open days in the month
          s.missingOut?`<span class="pill bad">⏳ ${EN()?'no check-out':'ไม่ได้ลงเวลาออก'} ${s.missingOut}</span>`
          :s.absent?`<span class="pill bad">${EN()?'absent':'ขาด'} ${s.absent}</span>`
          :(s.lateDays?`<span class="pill wait">${EN()?'late':'สาย'} ${s.lateDays}</span>`:`<span class="pill ok">${EN()?'full':'ครบ'}</span>`)} <span class="muted">›</span></span></div>`).join('');
    const tot = (d.staff||[]).reduce((a,s)=>({p:a.p+s.present,l:a.l+s.lateDays,v:a.v+s.leaveDays,ab:a.ab+s.absent,ot:a.ot+s.otHours,mo:a.mo+(s.missingOut||0)}),{p:0,l:0,v:0,ab:0,ot:0,mo:0});
    modal(`<h3>🗓️ ${EN()?'Monthly work time':'เวลาเข้า-ออกรายเดือน'}</h3>
      <label class="field"><span>${esc(t('c.month'))}</span><input type="month" value="${esc(d.month)}" onchange="A_staffMonth(this.value)"/></label>
      <div class="kpigrid" style="margin-bottom:8px">
        ${smStat(tot.p, EN()?'days present':'วันมาทำงาน','green')}
        ${smStat(tot.l, EN()?'late days':'วันมาสาย','amber')}
        ${smStat(tot.v, EN()?'leave days':'วันลา','')}
        ${smStat(tot.ab, EN()?'absent days':'วันขาด', tot.ab?'pink':'')}
        ${smStat(tot.mo, EN()?'no check-out':'ไม่ได้ลงเวลาออก', tot.mo?'pink':'')}</div>
      ${(d.missingOut||[]).length?`<div class="card" style="background:var(--warn-bg);border-color:var(--warn-line);padding:8px;font-size:13px">
        ⏳ <b>${EN()?'Days with an arrival and no departure':'วันที่มีเวลาเข้า แต่ไม่มีเวลาออก'}</b>
        ${d.missingOut.map(x=>`<div style="margin-top:2px">• <b>${esc(EN()?(x.nickEN||x.name):(x.nick||x.name))}</b> — ${x.days.map(dd=>esc(ddmmyyyy(dd))).join(', ')}</div>`).join('')}
        <div class="muted" style="margin-top:4px">${EN()?'Ask them to file a time request so the day can be completed.':'แจ้งให้คุณครูส่งคำขอลงเวลา เพื่อให้วันนั้นสมบูรณ์'}</div></div>`:''}
      <p class="muted" style="font-size:13px">${EN()?'Everyone who logs time, this month. Tap a person for their day-by-day record. Weekends, holidays and days before someone started are not counted as absent.':'ทุกคนที่ต้องลงเวลา ในเดือนนี้ · แตะที่ชื่อเพื่อดูรายวันทั้งเดือน · เสาร์-อาทิตย์ วันหยุด และวันก่อนเริ่มงาน ไม่นับเป็นขาด'}</p>
      <div style="max-height:52vh;overflow:auto">${rows||`<div class="card muted">${esc(t('c.noItems'))}</div>`}</div>
      <div class="row" style="gap:8px;margin-top:8px">
        <button class="btn sm outline" style="flex:1" onclick="A_staffMonthExport('pdf')">📄 PDF</button>
        <button class="btn sm outline" style="flex:1" onclick="A_staffMonthExport('jpg')">🖼️ JPG</button></div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  // Export uses the same A4 renderer as the report card, so every document the school prints looks
  // like it came from the same place. Built on the device — no report is uploaded anywhere.
  const withReportKit = fn => __atomLoadScript('report_card.js', ()=>!!window.AtomReportCard).then(fn).catch(e=>err(e));
  window.A_staffMonthExport = (kind) => withReportKit(()=>{
    const d=window._SM||{}; const list=sortPeopleD(d.staff||[]);
    const tot=list.reduce((a,s)=>({p:a.p+s.present,l:a.l+s.lateDays,v:a.v+s.leaveDays,ab:a.ab+s.absent}),{p:0,l:0,v:0,ab:0});
    AtomReportCard.saveTable({
      title:'สรุปเวลาทำงานของครู', subtitle:monthNameYear(d.month),
      filename:'เวลาทำงานครู_'+String(d.month||''),
      stats:[{n:list.length,label:'คุณครู'},{n:tot.p,label:'วันมาทำงาน'},{n:tot.l,label:'วันมาสาย'},
             {n:tot.v,label:'วันลา'},{n:tot.ab,label:'วันขาด'}],
      note:'เสาร์-อาทิตย์ วันหยุด วันก่อนเริ่มงาน และวันนี้ ไม่นับเป็นวันขาด',
      columns:[{key:'name',label:'ชื่อ',width:3,bold:true},{key:'present',label:'มาทำงาน',width:1.2,align:'right'},
        {key:'late',label:'สาย (วัน/นาที)',width:1.6,align:'right'},{key:'leave',label:'ลา',width:1,align:'right'},
        {key:'absent',label:'ขาด',width:1,align:'right'},{key:'ot',label:'OT (ชม.)',width:1.2,align:'right'}],
      rows:list.map(s=>({name:dnick(s)+(dnSub(s)?' ('+dnSub(s)+')':''), present:s.present,
        late:s.lateDays+(s.lateMinutes?' / '+s.lateMinutes:''), leave:s.leaveDays, absent:s.absent,
        ot:s.otHours||'', _warn:s.absent>0})),
      footer:'ออกโดยระบบ Atom Nursery · '+todayStr()
    }, kind);
  });

  /* ---- the class report the school did not have ------------------------------------------------
   * Attendance, leave, consecutive absence, growth and DSPM for every child, grouped by class.
   * The pieces existed one child at a time; this is the page that answers "how is Nursery 2 doing".
   */
  let SR_MONTH=null;
  window.A_studentReport = async (month) => {
    SR_MONTH = month || SR_MONTH || monthStr();
    let d; try { d = await api('studentMonthReport',{month:SR_MONTH,staffId:USER.staffId}); } catch(e){ err(e); return; }
    window._SR = d;
    const T=d.totals||{};
    const cls=(d.classes||[]).map(c=>`
      <div class="card" style="padding:8px">
        <div class="spread"><b>🏫 ${esc(c.className)}</b><span class="muted" style="font-size:13px">${c.count} ${EN()?'children':'คน'}</span></div>
        <div class="muted" style="font-size:13px;margin:2px 0 6px">${EN()?'present':'มาเรียน'} ${c.present} · ${EN()?'absent':'ขาด'} ${c.absent} · ${EN()?'sick':'ลาป่วย'} ${c.sick} · ${EN()?'personal':'ลากิจ'} ${c.personal}
          ${c.watch?` · <span style="color:var(--bad);font-weight:600">${EN()?'to follow up':'ต้องติดตาม'} ${c.watch}</span>`:''}</div>
        ${sortPeopleD(c.students).map(s=>`<div class="list-item" style="align-items:flex-start${s.paused?';opacity:.7':''}">
          <span style="flex:1"><b>${esc(dnick(s))}</b>${s.paused?` <span class="pill info" style="font-size:11px">${EN()?'on leave':'ลาชั่วคราว'}</span>`:''}
            <br><small class="muted">${EN()?'present':'มา'} ${s.present} · ${EN()?'absent':'ขาด'} ${s.absent} · ${EN()?'sick':'ป่วย'} ${s.sick} · ${EN()?'personal':'กิจ'} ${s.personal}</small>
            <br><small class="muted">⚖️ ${s.weight?esc(s.weight)+' kg':'—'} · 📏 ${s.height?esc(s.height)+' cm':'—'}${s.measuredAt?` <span style="color:var(--ink-3)">(${esc(s.measuredAt)})</span>`:` <span style="color:var(--warn)">${EN()?'never measured':'ยังไม่เคยชั่ง/วัด'}</span>`}</small>
            <br><small class="muted">📈 DSPM ${s.dspmTotal?`${s.dspmDone}/${s.dspmTotal}${s.dspmDone?` · ${EN()?'passed':'ผ่าน'} ${s.dspmPass}`:''}`:(EN()?'no criteria for this age':'ยังไม่มีเกณฑ์ตามอายุ')}</small></span>
          <span style="text-align:right">${s.maxConsecutive>=3
            ? `<span class="pill bad">${EN()?'absent':'ขาดต่อเนื่อง'} ${s.maxConsecutive}</span>`
            : (s.maxConsecutive>=2?`<span class="pill wait">${EN()?'absent':'ขาดต่อเนื่อง'} ${s.maxConsecutive}</span>`:'')}</span></div>`).join('')}
      </div>`).join('');
    modal(`<h3>📊 ${EN()?'Class report':'สรุปรายชั้นเรียน'}</h3>
      <label class="field"><span>${esc(t('c.month'))}</span><input type="month" value="${esc(d.month)}" onchange="A_studentReport(this.value)"/></label>
      <div class="kpigrid" style="margin-bottom:8px">
        <div class="kpi"><b>${T.students||0}</b><small>${EN()?'children':'นักเรียน'}</small></div>
        <div class="kpi"><b style="color:var(--ok)">${T.present||0}</b><small>${EN()?'days present':'วันมาเรียน'}</small></div>
        <div class="kpi"><b style="color:var(--warn)">${(T.sick||0)+(T.personal||0)}</b><small>${EN()?'leave days':'วันลา'}</small></div>
        <div class="kpi"><b style="color:${T.watch?'var(--bad)':'var(--ink)'}">${T.watch||0}</b><small>${EN()?'to follow up':'ต้องติดตาม'}</small></div></div>
      <p class="muted" style="font-size:13px">${EN()?`${d.schoolDays} school days this month. "To follow up" = absent 3 days or more in a row. Weekends, holidays and days a child was on temporary leave are not absences.`:`เดือนนี้มีวันเรียน ${d.schoolDays} วัน · "ต้องติดตาม" = ขาดติดต่อกัน 3 วันขึ้นไป · เสาร์-อาทิตย์ วันหยุด และวันที่ลาชั่วคราว ไม่นับเป็นขาด`}</p>
      <div style="max-height:50vh;overflow:auto">${cls||`<div class="card muted">${esc(t('c.noItems'))}</div>`}</div>
      <div class="row" style="gap:8px;margin-top:8px">
        <button class="btn sm outline" style="flex:1" onclick="A_studentReportExport('pdf')">📄 PDF</button>
        <button class="btn sm outline" style="flex:1" onclick="A_studentReportExport('jpg')">🖼️ JPG</button></div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_studentReportExport = (kind) => withReportKit(()=>{
    const d=window._SR||{}; const T=d.totals||{};
    AtomReportCard.saveTable({
      title:'สรุปนักเรียนรายชั้นเรียน', subtitle:monthNameYear(d.month)+' · วันเรียน '+(d.schoolDays||0)+' วัน',
      filename:'สรุปนักเรียน_'+String(d.month||''),
      stats:[{n:T.students||0,label:'นักเรียน'},{n:T.present||0,label:'วันมาเรียน'},{n:T.absent||0,label:'วันขาด'},
             {n:T.sick||0,label:'ลาป่วย'},{n:T.personal||0,label:'ลากิจ'},{n:T.watch||0,label:'ต้องติดตาม'}],
      note:'"ต้องติดตาม" = ขาดติดต่อกัน 3 วันขึ้นไป · เสาร์-อาทิตย์ วันหยุด และวันที่ลาชั่วคราว ไม่นับเป็นขาด',
      columns:[{key:'name',label:'ชื่อ',width:2.6,bold:true},{key:'present',label:'มา',width:0.8,align:'right'},
        {key:'absent',label:'ขาด',width:0.8,align:'right'},{key:'sick',label:'ป่วย',width:0.8,align:'right'},
        {key:'personal',label:'กิจ',width:0.8,align:'right'},{key:'run',label:'ขาดต่อเนื่อง',width:1.2,align:'right'},
        {key:'wh',label:'น้ำหนัก/ส่วนสูง',width:1.6,align:'right'},{key:'dspm',label:'DSPM',width:1,align:'right'}],
      groups:(d.classes||[]).map(c=>({
        title:c.className+'  ('+c.count+' คน · มา '+c.present+' · ขาด '+c.absent+(c.watch?' · ต้องติดตาม '+c.watch:'')+')',
        rows:sortPeopleD(c.students).map(s=>({
          name:dnick(s)+(s.paused?' (ลาชั่วคราว)':''), present:s.present, absent:s.absent, sick:s.sick, personal:s.personal,
          run:s.maxConsecutive||'', wh:(s.weight?s.weight+' kg':'—')+' / '+(s.height?s.height+' cm':'—'),
          dspm:s.dspmTotal?(s.dspmDone+'/'+s.dspmTotal):'—', _warn:s.maxConsecutive>=3 }))
      })),
      footer:'ออกโดยระบบ Atom Nursery · '+todayStr()
    }, kind);
  });

  window.A_staffMonthOne = (sid) => {
    const d=window._SM||{}; const s=(d.staff||[]).find(x=>x.staffId===sid); if(!s) return;
    const [Y,Mo]=String(d.month).split('-').map(Number);
    const first=new Date(Y,Mo-1,1).getDay();
    // colour says what KIND of day it was; the times and the reason are written in the cell
    const cell = r => {
      const map={ IN:['var(--ok-bg)','var(--ok-line)'], LEAVE:['var(--blue-bg)','var(--blue-line)'],
        ABSENT:['var(--bad-bg)','var(--bad-line)'], HOLIDAY:['var(--warn-bg)','var(--warn-line)'],
        OFF:['var(--surface-2)','var(--line)'], BEFORE:['var(--surface-2)','var(--line)'],
        TODAY:['','var(--blue-line)'], FUTURE:['','var(--line)'] };
      let [bg,bd]=map[r.status]||['',''];
      /* A DAY SOMEBODY WAS PAID TO WORK IS NOT AN EMPTY CELL. On 22/08/26 ครูจอย held an approved
       * OT วันหยุด of ฿500 and this calendar printed a blank Saturday — the school-wide calendar knew
       * (🎉 จอย) and her own page did not, so the one place you would go to check a person's month
       * was the one place the day was missing. It rides on top of whatever the day already was. */
      if(r.holidayOT){ bg='var(--ok-bg)'; bd='var(--ok-line)'; }
      const holOtTag = r.holidayOT?`<span class="io" style="text-align:left;color:var(--ok);font-weight:600">🎉 ${esc(baht(r.holidayOT))}</span>`:'';
      const body = holOtTag +
        r.status==='IN' ? `<span class="io" style="text-align:left;color:${r.late?'var(--warn)':'var(--ok)'};font-weight:600">${esc(r.in||'')}${r.out?`–${esc(r.out)}`:''}${r.late?`<br>${EN()?'late':'สาย'} ${r.late}′`:''}${r.otHours?`<br>OT ${r.otHours}`:''}${r.manual?'<br>✍️':''}</span>`
        : r.status==='LEAVE' ? `<span class="io" style="text-align:left;color:var(--blue);font-weight:600">${esc(r.leaveType||'ลา')}${r.leaveHalf?` (${r.leaveHalf==='AM'?(EN()?'AM':'เช้า'):(EN()?'PM':'บ่าย')})`:''}</span>`
        : r.status==='HOLIDAY' ? `<span class="io" style="text-align:left;color:var(--bad);font-weight:600">🏖️ ${esc(r.holiday)}</span>`
        : r.status==='ABSENT' ? `<span class="io" style="text-align:left;color:var(--bad);font-weight:700">${EN()?'absent':'ขาด'}</span>`
        : r.status==='BEFORE' ? `<span class="io" style="text-align:left;color:var(--ink-3)">–</span>`
        : r.status==='TODAY' ? `<span class="io" style="text-align:left;color:var(--ink-3)">${EN()?'today':'วันนี้'}</span>` : '';
      return `<div class="d" style="min-height:56px;background:${bg};border-color:${bd}">${r.day}${r.bigCleaning?' '+BC_ICON:''}${body}</div>`;
    };
    let cells=['อา','จ','อ','พ','พฤ','ศ','ส'].map(w=>`<div style="text-align:center;font-size:13px;color:var(--ink-3)">${EN()?({'อา':'Su','จ':'Mo','อ':'Tu','พ':'We','พฤ':'Th','ศ':'Fr','ส':'Sa'}[w]):w}</div>`).join('');
    for(let i=0;i<first;i++) cells+='<div class="d dim"></div>';
    s.days.forEach(r=>{ cells+=cell(r); });
    modal(`<h3>🗓️ ${esc(dnick(s))} <small class="muted" style="font-weight:400">${esc(monthNameYear(d.month))}</small></h3>
      ${s.startDate?`<p class="muted" style="font-size:13px">${EN()?'Started':'เริ่มงาน'} ${esc(s.startDate)}</p>`:''}
      <div class="kpigrid" style="margin-bottom:8px">
        ${smStat(s.present, EN()?'present':'มาทำงาน','green')}
        ${smStat(s.lateDays, EN()?'late':'สาย','amber')}
        ${smStat(s.leaveDays, EN()?'leave':'ลา','')}
        ${smStat(s.absent, EN()?'absent':'ขาด', s.absent?'pink':'')}</div>
      ${s.lateMinutes?`<p class="muted" style="font-size:13px">${EN()?'Total minutes late':'รวมเวลามาสาย'} <b>${s.lateMinutes}</b> ${EN()?'min':'นาที'}${s.otHours?` · OT <b>${s.otHours}</b> ${EN()?'hr':'ชม.'}`:''}</p>`:''}
      <div class="cal">${cells}</div>
      <small class="muted">${EN()?'green = worked · blue = leave · red = absent · orange = holiday · 🎉 = holiday OT · ✍️ = time entered by request. Today is not counted as absent until the day is over.':'เขียว = มาทำงาน · ฟ้า = ลา · แดง = ขาด · ส้ม = วันหยุด · 🎉 = OT วันหยุด · ✍️ = ลงเวลาย้อนหลังจากคำขอ · วันนี้ยังไม่นับเป็นขาดจนกว่าจะหมดวัน'}</small>
      ${/* the days behind "OT n ชม." — a payslip figure nobody could trace */''}
      ${(s.otDays||[]).length?`<details style="margin-top:8px"><summary style="cursor:pointer;font-weight:700;font-size:14px">⏰ ${EN()?'OT day by day':'OT รายวัน'} (${(s.otDays||[]).length}) — ${EN()?'total':'รวม'} <b>${s.otHours||0}</b> ${EN()?'hr':'ชม.'}${s.holidayOTAmount?` · 🎉 ${esc(baht(s.holidayOTAmount))}`:''}</summary>
        ${(s.otDays||[]).map(o=>{ const rej=o.status==='REJECTED';
          return `<div class="list-item"><span>${esc(ddmmyyyy(o.date))} ${o.kind==='HOLIDAY'?`<span class="pill ok">🎉 ${EN()?'holiday':'วันหยุด'}</span>`:''}${o.note?`<br><small class="muted">${esc(o.note)}</small>`:''}</span>
            <span style="font-size:13px;text-align:right${rej?';text-decoration:line-through;opacity:.6':''}">${o.kind==='HOLIDAY'?`<b>${esc(baht(o.amount||0))}</b>`:`<b>${o.hours} ${EN()?'hr':'ชม.'}</b> · ${esc(baht(o.amount||0))}`}
              <br><span class="pill ${rej?'bad':o.status==='APPROVED'?'ok':'wait'}">${esc(tStat(o.status))}</span></span></div>`; }).join('')}
        <small class="muted">${EN()?'Rejected rows are struck out and are not in the total. Holiday OT is an agreed amount with no hours behind it.':'รายการที่ปฏิเสธจะขีดฆ่าและไม่รวมในยอด · OT วันหยุดเป็นเงินก้อน ไม่มีชั่วโมง'}</small></details>`:''}
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  SCREENS.Admin.leaves = async () => {
    // school holidays + meeting days → light-red / teal cells on the approval calendars
    try{ window._LV_HOL=await api('holidays'); }catch(e){ window._LV_HOL=window._LV_HOL||[]; }
    try{ const bc=await api('bigCleaningDays'); window._LV_BC=(bc&&bc.days)||bc||[]; }catch(e){ window._LV_BC=window._LV_BC||[]; }
    // holiday OT for the month on show, so the leave calendar can mark the days someone came in
    try{ const _ot=await api('adminOTList',{month:monthStr()});
      window._LV_HOT=(_ot||[]).filter(isLiveHolOT);
    }catch(e){ window._LV_HOT=window._LV_HOT||[]; }
    // pending teacher-leave count → badge on the tab so it's visible at a glance
    let _lvPend=0; try{ const _al=await api('allLeaves'); window._LV_ALL=_al; _lvPend=_al.filter(l=>String(l.Status).indexOf('PENDING')===0).length; }catch(e){}
    const mainSeg=`<div class="seg" style="margin-bottom:10px"><button class="${LV_MAIN==='staff'?'active':''}" onclick="A_lvMain('staff')">👩‍🏫 ${EN()?'Teachers':'คุณครู'}${_lvPend?` <span class="pill bad" style="font-size:11px">${_lvPend}</span>`:''}</button><button class="${LV_MAIN==='student'?'active':''}" onclick="A_lvMain('student')">👶 ${EN()?'Students':'นักเรียน'}</button></div>`;
    if(LV_MAIN==='student'){
      const leaves=await api('allStudentLeaves'); window._SLV_ALL=leaves||[];
      window._CALRENDER=studentLeaveCalRender;
      // birthdays this month + the DSPM assessments that have come due — one call, drawn ON the
      // calendar and summarised under it
      try{ window._SALERTS=await api('studentAlerts',{staffId:USER.staffId,role:USER.role}); }catch(e){ window._SALERTS=null; }
      app.innerHTML=`<h2 class="page">✅ ${EN()?'Operations':'ดำเนินการ'}</h2>${mainSeg}
        ${opTools([['⏰',EN()?'Student late-pickup OT':'OT รับช้า (นักเรียน)','A_studentOT()'],
                   ['🕵️',EN()?'Attendance check':'ตรวจสอบการลงเวลา','A_attAudit()'],
                   ['🕑',EN()?'Correct check-in / pick-up':'แก้ไขเวลารับ-ส่ง','A_editAttPick()'],
                   ['📊',EN()?'Class report':'สรุปรายชั้นเรียน','A_studentReport()']])}
        <p class="muted" style="font-size:13px">${EN()?'Absences by day and class. Tap a day to see who is absent per class (history included).':'การลาแยกรายวันและชั้นเรียน · แตะวันเพื่อดูว่านักเรียนคนไหนขาดในแต่ละชั้น (ดูย้อนหลังได้)'}</p>
        <div class="card"><div id="calWrap">${studentLeaveCalRender()}</div></div>
        <div id="bdayCard">${birthdayCard(window._SALERTS)}</div>
        <div id="dspmDueCard">${dspmDueCard(window._SALERTS)}</div>`;
      return;
    }
    const [all,staff]=await Promise.all([window._LV_ALL?Promise.resolve(window._LV_ALL):api('allLeaves'),(A_CACHE.staff&&A_CACHE.staff.length)?Promise.resolve(A_CACHE.staff):api('listStaff')]);
    A_CACHE.staff=staff||A_CACHE.staff; window._LV_ALL=all;
    const pending=all.filter(l=>String(l.Status).indexOf('PENDING')===0);
    const resolved=all.filter(l=>String(l.Status).indexOf('PENDING')!==0);
    const none=`<div class="card muted">${esc(t('c.noItems'))}</div>`;
    const shown = LV_TAB==='pending'?pending:resolved;
    app.innerHTML=`<h2 class="page">✅ ${EN()?'Operations':'ดำเนินการ'}</h2>${mainSeg}
      ${opTools([['⏰',t('ot.adminOT'),'A_staffOT()'],
                 ['🎉',EN()?'Holiday OT':'OT วันหยุด','A_holidayOT()'],
                 ['⏰',t('att.adminTitle'),'A_timeRequests()'],
                 ['🔁',t('corg.adminTitle'),'A_classChanges()'],
                 ['🗓️',EN()?'Monthly work time':'เวลาเข้า-ออกรายเดือน','A_staffMonth()']])}
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
    const holByDay={}; (window._LV_HOL||[]).forEach(h=>{ const d=new Date(h.Date); if(d.getFullYear()===y&&d.getMonth()===mo) holByDay[d.getDate()]=holLabel(h); });
    const bcByDay={}; (window._LV_BC||[]).forEach(s=>{ const d=new Date(s); if(d.getFullYear()===y&&d.getMonth()===mo) bcByDay[d.getDate()]=1; });
    // birthdays belong to a month, not a year — only mark them on the month they were fetched for
    const bdayByDay={}; const _al=window._SALERTS;
    if(_al && _al.month===`${y}-${String(mo+1).padStart(2,'0')}`)
      (_al.birthdays||[]).forEach(b=>{ (bdayByDay[b.day]=bdayByDay[b.day]||[]).push(b); });
    let cells=['อา','จ','อ','พ','พฤ','ศ','ส'].map(w=>`<div style="text-align:center;font-size:13px;color:var(--ink-3)">${EN()?({'อา':'Su','จ':'Mo','อ':'Tu','พ':'We','พฤ':'Th','ศ':'Fr','ส':'Sa'}[w]):w}</div>`).join('');
    for(let i=0;i<first;i++)cells+='<div class="d dim"></div>';
    for(let dd=1;dd<=days;dd++){ const items=byDay[dd]; const today=(isCur&&dd===now.getDate())?'today':''; const n=items?items.length:0;
      const nCls=items?new Set(items.map(x=>x.class||'-')).size:0; const ds=`${y}-${String(mo+1).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
      const bg = n?'cursor:pointer;background:var(--warn-bg);border-color:var(--warn-line);':calOffBg(y,mo,dd,holByDay[dd],bcByDay[dd]);
      const bd = (bdayByDay[dd]||[]);
      cells+=`<div class="d ${n?'ev':''} ${today}" style="min-height:52px;${bg}" ${n?`onclick="A_slvDay('${ds}')"`:''}>${dd}${holByDay[dd]?`<span class="io" style="text-align:left;color:var(--bad);font-weight:600">🏖️ ${esc(holByDay[dd])}</span>`:''}${bcByDay[dd]&&!holByDay[dd]?`<span class="io" style="text-align:left;color:var(--teal);font-weight:600">${BC_ICON}</span>`:''}${bd.length?`<span class="io" style="text-align:left;color:var(--brand);font-weight:700" title="${esc(bd.map(b=>dnick(b)).join(', '))}">🎂 ${bd.length===1?esc(dnick(bd[0])):bd.length}</span>`:''}${n?`<span class="io" style="text-align:left;color:var(--warn);font-weight:700">${EN()?'absent':'ขาด'} ${n}<br><span style="font-weight:400;color:var(--ink-3)">${nCls} ${EN()?'class':'ชั้น'}</span></span>`:''}</div>`; }
    return `${calNavHeader(y,mo)}<div class="cal">${cells}</div><small class="muted">${EN()?`Orange = absences · weekend/holiday red · ${BC_ICON} meeting · 🎂 birthday`:`สีส้ม = มีนักเรียนลา · เสาร์-อาทิตย์/วันหยุดแดง · ${BC_ICON} ประชุม · 🎂 วันเกิด`}</small>`;
  }
  /**
   * Birthdays this month. The school wants to know BEFORE the day, which is why this is a month at
   * a time and not a "today" banner: a card that only appears on the morning itself is a card that
   * arrives too late to do anything with.
   * Only rendered when the calendar is showing the month the birthdays belong to.
   */
  function birthdayCard(al){
    const list=(al&&al.birthdays)||[]; if(!list.length) return '';
    const b=calBase(); const shown=b.getFullYear()+'-'+String(b.getMonth()+1).padStart(2,'0');
    if(al.month && shown!==al.month) return '';
    const today=new Date(); const isThisMonth = shown===todayStr().slice(0,7);
    const dayNow=today.getDate();
    return `<div class="card" style="border-color:var(--brand-line);background:var(--brand-soft)">
      <div class="spread"><b>🎂 ${EN()?'Birthdays this month':'วันเกิดนักเรียนเดือนนี้'}</b><span class="pill info">${list.length}</span></div>
      ${list.map(k=>{ const past = isThisMonth && k.day<dayNow, isToday = isThisMonth && k.day===dayNow;
        return `<div class="list-item"${past?' style="opacity:.5"':''}>
          <span>${isToday?'🎉 ':''}<b>${esc(dnick(k))}</b> <small class="muted">${esc(k.class||'')}</small></span>
          <span style="text-align:right"><b>${esc(ddmmyyyy(k.dob).slice(0,5))}</b>${k.turning?` <small class="muted">${EN()?'turns':'ครบ'} ${k.turning} ${EN()?'yrs':'ขวบ'}</small>`:''}</span></div>`; }).join('')}</div>`;
  }
  /**
   * Who is due a DSPM assessment. The reminder is the ONLY thing that makes a bi-monthly assessment
   * happen on time, and it clears itself: finish the band and the child drops off this list.
   */
  function dspmDueCard(al){
    const list=(al&&al.dspmDue)||[]; if(!list.length) return '';
    const byClass={}; list.forEach(k=>{ (byClass[k.class||'-']=byClass[k.class||'-']||[]).push(k); });
    return `<div class="card" style="border-color:var(--warn-line);background:var(--warn-bg)">
      <div class="spread"><b>📝 ${EN()?'DSPM assessments due':'ถึงกำหนดประเมิน DSPM'}</b><span class="pill warn">${list.length}</span></div>
      <small class="muted">${EN()?'By age band. A child drops off this list once every item in their band has a result.':'ตามช่วงอายุ · เมื่อประเมินครบทุกข้อในช่วงนั้นแล้ว ชื่อจะหายไปเอง'}</small>
      ${Object.keys(byClass).sort().map(c=>`<div style="margin-top:8px"><b style="font-size:13px">🏫 ${esc(c)}</b>
        ${byClass[c].map(k=>`<div class="list-item"><span><b>${esc(dnick(k))}</b> <small class="muted">${esc(ageMonthLabel(k.ageMonth))}</small></span>
          <span>${dspmDueBadge(k)}</span></div>`).join('')}</div>`).join('')}</div>`;
  }
  // "2 ปี 8 เดือน" from a month count — the same way the child's age reads everywhere else
  const ageMonthLabel = m => { m=Number(m)||0; const y=Math.floor(m/12), r=m%12;
    return EN() ? `${y}y ${r}m` : `${y} ปี ${r} เดือน`; };
  /** The band a child is due, and how far through it they are. Small enough to sit after a name. */
  const dspmDueBadge = k => `<span class="pill warn" style="font-size:11px" title="${esc((EN()?'DSPM ':'ประเมิน DSPM ')+(k.ageLabel||k.band))}">📝 ${esc(k.band)} ${EN()?'mo':'เดือน'}${k.done?` · ${k.done}/${k.total}`:''}</span>`;
  window.A_slvDay=(ds)=>{ const items=(window._SLV_ALL||[]).filter(l=>ymd(l.Date)===ds);
    const byClass={}; items.forEach(l=>{ const c=l.class||(EN()?'(no class)':'(ไม่ระบุชั้น)'); (byClass[c]=byClass[c]||[]).push(l); });
    const classes=Object.keys(byClass).sort();
    modal(`<h3>🗓️ ${EN()?'Absent on':'ขาดเรียนวันที่'} ${esc(ddmmyyyy(ds))}</h3>
      <p class="muted" style="font-size:13px">${EN()?'Total':'รวม'} <b>${items.length}</b> ${EN()?'across':'ใน'} ${classes.length} ${EN()?'class(es)':'ชั้นเรียน'}</p>
      <div style="max-height:60vh;overflow:auto">${classes.length?classes.map(c=>`<div class="card" style="padding:8px"><div class="spread"><b>🏫 ${esc(c)}</b><span class="pill bad">${byClass[c].length} ${EN()?'absent':'ขาด'}</span></div>
        ${byClass[c].map(l=>`<div class="list-item"><span>${esc((EN()?(l.nickEN||l.nick||l.nameEN):(l.nick||l.name))||l.StudentID)} ${l.Type?`<span class="pill info" style="font-size:11px">${esc(l.Type)}</span>`:''}</span><small class="muted">${esc(l.Reason||'')}</small></div>`).join('')}</div>`).join(''):`<div class="card muted">${EN()?'None':'ไม่มี'}</div>`}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_editLeave=async(id)=>{ const l=(await api('allLeaves')).find(x=>x.LeaveID===id); if(!l){toast(t('c.noItems'));return;}
    modal(`<h3>✏️ ${EN()?'Edit leave':'แก้ไขการลา'} — ${esc(leaveName(l))}</h3>
      ${(() => { const cur=leaveTypeTH(l.Type||''), std=['ลาป่วย','ลากิจ','ลาพักร้อน'];
        // A free-text box is how a bad type got in and stayed in. Offer the real three; keep whatever
        // odd value the row already has as a fourth option so editing can never silently change it.
        const opts=std.concat(std.indexOf(cur)<0&&cur?[cur]:[]);
        return `<label class="field"><span>${EN()?'Type':'ประเภท'}</span><select id="elType" translate="no">${
          opts.map(x=>`<option value="${esc(x)}"${x===cur?' selected':''}>${esc(std.indexOf(x)<0?x:tLeaveType(x))}</option>`).join('')}</select></label>`; })()}
      <div class="grid2"><label class="field"><span>${EN()?'From':'ตั้งแต่'}</span><input type="date" id="elStart" value="${esc(String(l.StartDate).slice(0,10))}"/></label>
        <label class="field"><span>${EN()?'To':'ถึง'}</span><input type="date" id="elEnd" value="${esc(String(l.EndDate).slice(0,10))}"/></label></div>
      <!-- Until now nothing in the app could turn a full day into a half day. A leave filed before
           half-days existed, or ticked wrongly, was stuck at 1 day and quietly overcharged the
           teacher's entitlement. -->
      <label class="field"><span>${EN()?'Half day?':'ลาครึ่งวันหรือไม่'}</span>
        <select id="elHalf"><option value=""${!l.HalfDay?' selected':''}>${EN()?'Full day (1)':'ลาเต็มวัน (1 วัน)'}</option>
          <option value="AM"${l.HalfDay==='AM'?' selected':''}>${EN()?'Half day — morning (0.5)':'ครึ่งวันเช้า (0.5 วัน)'}</option>
          <option value="PM"${l.HalfDay==='PM'?' selected':''}>${EN()?'Half day — afternoon (0.5)':'ครึ่งวันบ่าย (0.5 วัน)'}</option></select></label>
      <small class="muted" style="display:block;margin:-2px 0 6px">${EN()?'Half day deducts 0.5 from the entitlement, and is only possible on a single-day request.':'ลาครึ่งวันหักสิทธิ 0.5 วัน · ใช้ได้เฉพาะใบลาวันเดียว'}</small>
      <label class="field"><span>${EN()?'Reason':'เหตุผล'}</span><textarea id="elReason">${esc(l.Reason||'')}</textarea></label>
      <button class="btn block" onclick="A_editLeaveDo('${id}',this)">${esc(t('c.save'))}</button>`); };
  window.A_editLeaveDo=async(id,btn)=>{ const m=btn.closest('.modal'); const g=x=>{const e=m.querySelector('#'+x);return e?e.value.trim():undefined;};
    try{ await api('editLeave',{staffId:USER.staffId,leaveId:id,type:g('elType'),startDate:g('elStart'),endDate:g('elEnd'),reason:g('elReason'),halfDay:g('elHalf')||''});
      m.remove(); confirmSaved(t('c.saved')); GO('leaves'); }catch(e){err(e);} };
  window.A_cancelLeave=async(id)=>{ if(!confirm(EN()?'Cancel/delete this leave request?':'ยกเลิก/ลบคำขอลานี้?'))return;
    try{ await api('cancelLeave',{staffId:USER.staffId,leaveId:id}); toast(t('manage.deleted')); GO('leaves'); }catch(e){err(e);} };
  window.A_leave=async(id,dec)=>{ try{ const r=await api('approveLeave',{staffId:USER.staffId,leaveId:id,decision:dec}); toast(`✅ ${dec==='approve'?'อนุมัติ':'ปฏิเสธ'}แล้ว (${r.status})`); GO('leaves'); }catch(e){err(e);} };

  let PAY_ADJ=[];
  SCREENS.Admin.payroll = async () => { const [staff,rate]=await Promise.all([api('listStaff'),api('ratedChildCount')]); PAY_ADJ=[]; window._RATED=rate;
    A_CACHE.staff=staff||[];   // the base salary is read from HERE — MOCK.staff is empty in gas mode
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="A_finTab('pay')">${t('c.back')} · ${EN()?'Finance':'การเงิน'}</button><h2 class="page">${esc(t('title.payroll'))}</h2><div class="card">
      <div class="grid2"><label class="field"><span>${esc(t('c.staff'))}</span><select id="pStaff" onchange="A_payStaff()">${staff.map(s=>`<option value="${s.StaffID}">${esc(nmn(s))}</option>`).join('')}</select></label>
        <label class="field"><span>${esc(t('c.month'))}</span><input id="pMonth" type="month" value="${monthStr()}" onchange="A_payStaff()"/></label></div>
      <label class="field"><span>${esc(t('pay.payType'))}</span><select id="pType" onchange="A_payTypeToggle()"><option value="monthly">${esc(t('pay.monthly'))}</option><option value="daily">${esc(t('pay.dailyType'))}</option></select></label>
      <div class="grid2" id="pMonthlyBox"><label class="field"><span>${esc(t('pay.baseSalary'))}</span><input id="pBase" type="number"/></label></div>
      <div class="grid2" id="pDailyBox" hidden><label class="field"><span>${esc(t('pay.dailyRate'))}</span><input id="pDaily" type="number" value="0"/></label>
        <label class="field"><span>${esc(t('pay.daysWorked'))}</span><input id="pDays" type="number" value="0"/></label></div>
      <label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="pSS" style="width:auto"/> ${esc(t('pay.ssDeduct'))}</label>
      <div class="card" style="background:var(--surface-2);padding:8px"><b style="font-size:13px">⭐ ${esc(t('set.diligence'))} <small class="muted">(${esc(t('pay.perStaff'))})</small></b>
        <div class="grid2" style="margin-top:6px"><label class="field" style="margin:0"><span style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="pAtt" checked style="width:auto"/> ${esc(t('pay.attend'))}</span><input id="pAttendAmt" type="number"/></label>
          <label class="field" style="margin:0"><span style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="pFb" style="width:auto"/> ${esc(t('pay.fb'))}</span><input id="pFbAmt" type="number"/></label></div></div>
      <div class="card" style="background:var(--blue-bg);padding:8px"><b style="font-size:13px">👶 ${esc(t('pay.childRate'))}</b>
        <div id="pLeaveWarn"></div>
        <div class="grid2" style="margin-top:6px"><label class="field" style="margin:0"><span>${esc(t('pay.childThreshold'))}</span><input id="pThreshold" type="number" onchange="A_recalcChild()"/></label>
          <label class="field" style="margin:0"><span>${esc(t('pay.childMultiplier'))} (฿)</span><input id="pChildMul2" type="number"/></label></div>
        <div id="childCalc" class="muted" style="font-size:13px;margin-top:6px"></div>
        <label class="field" style="margin:6px 0 0"><span>${esc(t('pay.childCount'))} <small class="muted">(${esc(t('pay.autoEditable'))})</small></span><input id="pChild" type="number" value="0"/></label></div>
      <div class="grid2"><label class="field"><span>${esc(t('pay.cert'))}</span><input id="pCert" type="number" value="0"/></label>
        <label class="field"><span>${esc(t('pay.otEvening'))} <small id="otNote" class="muted"></small></span><input id="pOt" type="number" value="0"/></label></div>
      <div id="otCarryBox"></div>
      <div class="grid2"><label class="field"><span>🎉 ${esc(t('pay.otHoliday'))} <small id="otHolNote" class="muted"></small></span><input id="pOtHol" type="number" value="0"/></label>
        <label class="field"><span>${esc(t('pay.holidayBonus'))}</span><input id="pHb" type="number" value="0"/></label></div>
      <div class="grid2">
        <label class="field"><span>${EN()?'Contribution — deducted from staff':'เงินสมทบ (หักจากพนักงาน)'}</span><input id="pContrib" type="number" value="0" oninput="A_contribNote()"/></label></div>
      <div id="contribNote" class="muted" style="font-size:13px;margin:-4px 2px 8px"></div>
      <div class="card" style="background:var(--surface-2)"><div class="spread"><b style="font-size:13px">➕ ${esc(t('pay.adjustments'))}</b><button class="btn sm outline" onclick="A_addAdj()">+ ${esc(t('pay.addAdj'))}</button></div>
        <p class="muted" style="font-size:13px">${esc(t('pay.adjNote'))}</p><div id="adjList"></div></div>
      <div class="row" style="gap:8px"><button class="btn outline" style="flex:1" onclick="A_calc(false)">🧮 ${esc(t('c.calc'))}</button>
        <button class="btn" style="flex:1" onclick="A_calc(true)">💾 ${EN()?'Save as payable':'บันทึกเป็นรายการจ่าย'}</button></div>
      <p class="muted" style="font-size:13px;text-align:center">${EN()?'Calculate only checks the figures. Saving creates the payable and adds it to this month’s expenses.':'กด "คำนวณ" เพื่อดูตัวเลขอย่างเดียว · กด "บันทึก" เมื่อยืนยันแล้ว ระบบจึงตั้งเป็นรายการจ่ายและรวมในรายจ่ายเดือนนี้'}</p></div><div id="slipResult"></div>`;
    A_payStaff();
  };
  // switching staff (or month) fires this again while the previous one is still fetching; without a
  // token the slower reply repaints the screen for the staff member you just left
  let _payReq=0;
  window.A_payStaff = async ()=>{ const sid=$('#pStaff').value; const my=++_payReq;
    const stale=()=>my!==_payReq||$('#pStaff')&&$('#pStaff').value!==sid;
    const pc=await api('payrollConfig',{staffId:sid}); if(stale())return;
    // this used to read MOCK.staff, which holds SEED rows (and is empty since the mockdata split), so
    // the saved salary never came back — the field showed 0 every time the screen was opened
    const s=(A_CACHE.staff||[]).find(x=>x.StaffID===sid)||{};
    $('#pBase').value=s.BaseSalary||0; $('#pChildMul2').value=pc.ChildMultiplier; $('#pSS').checked=pc.SocialSecurityDeduct!==false;
    $('#pType').value=pc.PayType||'monthly'; $('#pDaily').value=pc.DailyRate||0;
    $('#pAttendAmt').value=pc.DiligenceAttendanceAmount!=null?pc.DiligenceAttendanceAmount:MOCK.config.DiligenceAttendanceAmount;
    $('#pFbAmt').value=pc.DiligenceFacebookAmount!=null?pc.DiligenceFacebookAmount:MOCK.config.DiligenceFacebookAmount;
    $('#pThreshold').value=pc.ChildThreshold||31;
    { const c=$('#pContrib'); if(c) c.value=pc.Contribution||0; }
    A_payTypeToggle(); A_recalcChild(); A_contribNote();
    // auto-pull this staff's APPROVED OT for the selected month into the OT field
    let otAuto=null;
    try{ const ot=await api('staffMonthlyOT',{staffId:sid,month:$('#pMonth').value}); if(stale())return; otAuto=ot;
      // the EVENING field gets only the evening OT; the holiday OT has its own field and its own
      // line on the slip, so the two are never added together behind the admin's back
      $('#pOt').value=(ot.daily!=null?ot.daily:ot.amount);
      const hol=$('#pOtHol'); if(hol) hol.value=Number(ot.holiday||0);
      const hn=$('#otHolNote'); if(hn) hn.innerHTML=Number(ot.holiday||0)>0
        ? `(${EN()?'auto':'อัตโนมัติ'} ${ot.holidayDays||0} ${EN()?'day(s)':'วัน'})`
        : `(${EN()?'none this month':'เดือนนี้ไม่มี'})`;
      const n=$('#otNote'); if(n) n.innerHTML=`(${EN()?'auto':'อัตโนมัติ'} ${ot.hours} ${EN()?'hr':'ชม.'} × ${baht(ot.rate)})`; }catch(e){}
    // OT approved after an EARLIER month's payroll was saved was never paid — it is owed now, as its
    // own line, so the earlier slip stays exactly as it was signed off (see otCarryOver_ in Payroll.gs)
    try{ const cy=await api('otCarryOver',{staffId:sid,month:$('#pMonth').value}); if(stale())return;
      const box=$('#otCarryBox'); if(!box) return;
      if(cy && Number(cy.total)>0){
        const list=(cy.detail||[]).map(d=>`${esc(monthNameYear(d.month))} ${baht(d.amount)}`).join(' · ');
        box.innerHTML=`<div class="card" style="background:var(--warn-bg);border-color:var(--warn-line);padding:8px">
          <label class="field" style="margin:0"><span style="color:var(--warn)">⏰ ${EN()?'Unpaid OT carried from earlier months':'ค้างจ่าย OT เดือนก่อนหน้า'}</span>
          <input id="pOtCarry" type="number" value="${Number(cy.total)}"/></label>
          <small class="muted">${EN()?'Approved after that month’s salary had already been paid':'อนุมัติหลังจากจ่ายเงินเดือนของเดือนนั้นไปแล้ว'} — ${list}</small></div>`;
      } else box.innerHTML='';
    }catch(e){}
    // A saved payslip is the record of what was actually paid, so reopening the month must show THAT,
    // not a fresh form with defaults — otherwise there is no way to check a previous month or to see
    // what a figure was made of. Load it back into every field and show the slip as saved.
    try{ const saved=await api('getPayslip',{staffId:sid,month:$('#pMonth').value}); if(stale())return;
      if(saved){
        const set=(id,v)=>{ const e=$(id); if(e&&v!=null) e.value=v; };
        set('#pBase',saved.BaseSalary); set('#pType',saved.PayType||'monthly'); set('#pDaily',saved.DailyRate||0); set('#pDays',saved.DaysWorked||0);
        set('#pChild',saved.ExtraChildCount!=null?saved.ExtraChildCount:saved.ChildCount);
        set('#pThreshold',saved.ChildThreshold); set('#pChildMul2',saved.ChildMultiplier);
        set('#pCert',saved.TrainingCertCount||0); set('#pOt',saved.OTEvening||0); set('#pHb',saved.HolidayBonus||0);
        set('#pOtHol',saved.OTHoliday||0);
        set('#pContrib',saved.Contribution||0); A_contribNote();
        // Approved OT must ALWAYS reach this field. If more was approved after the slip was saved, the
        // saved figure is stale — show the approved total and say so, rather than silently under-paying.
        const _dailyAuto=otAuto?Number(otAuto.daily!=null?otAuto.daily:otAuto.amount):0;
        if(otAuto && _dailyAuto > Number(saved.OTEvening||0)+0.5){
          set('#pOt',_dailyAuto);
          const n=$('#otNote'); if(n) n.innerHTML=`<span style="color:var(--warn)">⚠️ ${EN()?`approved ${baht(_dailyAuto)} > saved ${baht(saved.OTEvening||0)} — recalculate & save`:`อนุมัติแล้ว ${baht(_dailyAuto)} มากกว่าที่บันทึกไว้ ${baht(saved.OTEvening||0)} — กดคำนวณและบันทึกใหม่`}</span>`;
        }
        // the same check for the holiday line — approved after the slip was saved must not be lost
        if(otAuto && Number(otAuto.holiday||0) > Number(saved.OTHoliday||0)+0.5){
          set('#pOtHol',Number(otAuto.holiday||0));
          const hn=$('#otHolNote'); if(hn) hn.innerHTML=`<span style="color:var(--warn)">⚠️ ${EN()?`approved ${baht(otAuto.holiday)} > saved ${baht(saved.OTHoliday||0)}`:`อนุมัติแล้ว ${baht(otAuto.holiday)} มากกว่าที่บันทึกไว้ ${baht(saved.OTHoliday||0)}`}</span>`;
        }
        // the amounts are stored as PAID (0 when not eligible), so >0 is what tells us the box was ticked
        if($('#pAtt')) $('#pAtt').checked=Number(saved.DiligenceAttendance||0)>0;
        if($('#pFb'))  $('#pFb').checked=Number(saved.DiligenceFacebook||0)>0;
        if(Number(saved.DiligenceAttendance||0)>0) set('#pAttendAmt',saved.DiligenceAttendance);
        if(Number(saved.DiligenceFacebook||0)>0) set('#pFbAmt',saved.DiligenceFacebook);
        if($('#pSS')) $('#pSS').checked=Number(saved.SocialSecurity||0)>0;
        PAY_ADJ=adjRows(saved).map(a=>({label:a.label||'',amount:Number(a.amount)||0})); A_renderAdj();
        A_payTypeToggle();
        const box=$('#slipResult');
        if(box) box.innerHTML=`<div class="spread" style="margin:8px 2px 0"><b>${EN()?'Saved for this month':'ที่บันทึกไว้ของเดือนนี้'}</b><span class="pill ok">💾 ${EN()?'saved':'บันทึกแล้ว'}</span></div>`
          + payslipCard(saved)
          + `<div class="row"><button class="btn outline" onclick="A_dlSlip('${sid}','${$('#pMonth').value}')">⬇️ ${esc(t('pay.download'))}</button><button class="btn outline" onclick="A_print('${$('#pMonth').value}')">🖨️ ${esc(t('pay.print3'))}</button></div>`;
      } else { const box=$('#slipResult'); if(box) box.innerHTML=`<p class="muted" style="font-size:13px;text-align:center;margin-top:8px">${EN()?'Nothing saved for this month yet.':'ยังไม่มีรายการที่บันทึกไว้ของเดือนนี้'}</p>`; }
    }catch(e){}
    // leave (any type) over the limit → warn + auto-zero the child-rate count (field NOT locked; Admin can re-enter)
    try{ const ls=await api('staffLeaveSummary',{staffId:sid,month:$('#pMonth').value}); const w=$('#pLeaveWarn'), ch=$('#pChild');
      if(ls.exceeds){ if(ch) ch.value=0;
        if(w) w.innerHTML=`<div style="background:var(--warn-bg);border:1px solid var(--warn-line);border-radius:8px;padding:7px 9px;margin-bottom:6px;color:var(--warn);font-size:13px">⚠️ ${EN()?`Leave ${ls.days} days (> ${ls.limit}) this month — child-rate income not calculated. You can still enter a count manually.`:`ลาเกิน ${ls.limit} วัน (ลารวม ${ls.days} วัน) เดือนนี้ — ไม่คำนวณเรทจำนวนเด็กให้ · กรอกจำนวนเองได้หากต้องการ`}</div>`;
      } else if(w){ w.innerHTML=''; } }catch(e){} };
  window.A_payTypeToggle=()=>{ const daily=$('#pType').value==='daily'; $('#pMonthlyBox').hidden=daily; $('#pDailyBox').hidden=!daily; };
  // เงินสมทบ is a savings fund, not a cost: the teacher's half is deducted and the school matches it,
  // so the fund grows by both halves. Spell that out under the field — 200 deducted → +400 saved.
  window.A_contribNote=()=>{ const el=$('#contribNote'), f=$('#pContrib'); if(!el||!f) return;
    const v=Number(f.value||0); const mr=Number(MOCK.config.ContributionMatchRate!=null?MOCK.config.ContributionMatchRate:1);
    if(!v){ el.innerHTML=''; return; }
    const emp=Math.round(v*mr*100)/100;
    el.innerHTML=EN()
      ? `Deducted from staff ${baht(v)} + school matches ${baht(emp)} → <b>${baht(v+emp)}</b> added to the fund this month`
      : `หักจากพนักงาน ${baht(v)} + โรงเรียนสมทบ ${baht(emp)} → เข้ากองทุนเดือนนี้ <b>${baht(v+emp)}</b>`; };
  // auto child-rate count from DB: children from #threshold onward = rated − (threshold−1)
  window.A_recalcChild=()=>{ const r=window._RATED||{}; const th=+$('#pThreshold').value||31; const cnt=Math.max(0,(r.rated||0)-(th-1)); $('#pChild').value=cnt;
    setHTML('#childCalc', `${esc(t('abs.rated'))} <b>${r.rated||0}</b> <span class="muted">(${esc(t('abs.rateNote').replace('{n}',r.excludeDays||6).replace('{x}',r.excluded||0))})</span> − ${esc(t('pay.fromChild'))} #${th} → <b style="color:var(--blue)">${cnt} ${EN()?'children':'คน'}</b>`); };
  window.A_addAdj=()=>{ PAY_ADJ.push({label:'',amount:0}); A_renderAdj(); };
  window.A_delAdj=(i)=>{ PAY_ADJ.splice(i,1); A_renderAdj(); };
  function A_renderAdj(){ const box=$('#adjList'); if(!box)return;
    box.innerHTML=PAY_ADJ.map((a,i)=>`<div class="grid3" style="margin-bottom:6px;grid-template-columns:1fr 90px 36px"><input value="${esc(a.label)}" placeholder="${esc(t('pay.adjLabel'))}" oninput="PAY_ADJ_SET(${i},'label',this.value)"/><input type="number" value="${a.amount}" placeholder="±0" oninput="PAY_ADJ_SET(${i},'amount',this.value)"/><button class="btn sm pink" onclick="A_delAdj(${i})" aria-label="${EN()?"Delete":"ลบ"}" title="${EN()?"Delete":"ลบ"}">✕</button></div>`).join(''); }
  window.PAY_ADJ_SET=(i,k,v)=>{ PAY_ADJ[i][k]= k==='amount'?Number(v||0):v; };
  window.A_calc=async(commit)=>{ const payType=$('#pType').value; const p={staffId:$('#pStaff').value,month:$('#pMonth').value,payType,baseSalary:+$('#pBase').value,dailyRate:+$('#pDaily').value,daysWorked:+$('#pDays').value,childMultiplier:+$('#pChildMul2').value,childThreshold:+$('#pThreshold').value,diligenceAttend:+$('#pAttendAmt').value,diligenceFb:+$('#pFbAmt').value,socialSecurityDeduct:$('#pSS').checked,facebookPosted:$('#pFb').checked,attendanceEligible:$('#pAtt').checked,extraChildCount:+$('#pChild').value,trainingCertCount:+$('#pCert').value,otEvening:+$('#pOt').value,otHoliday:+(($('#pOtHol')||{}).value||0),holidayBonus:+$('#pHb').value,contribution:+($('#pContrib')||{}).value||0,adjustments:PAY_ADJ.filter(a=>a.label||a.amount)};
    // Only override the carry-over when the field is actually on screen. Sending 0 unconditionally
    // would wipe a genuine carry whenever its fetch was still in flight.
    { const c=$('#pOtCarry'); if(c) p.otCarry=+c.value||0; }
    // the per-staff SETTINGS are remembered either way; only the payslip itself waits for "บันทึก"
    await api('setPayrollConfig',{staffId:p.staffId,config:{PayType:payType,DailyRate:p.dailyRate,ChildMultiplier:p.childMultiplier,ChildThreshold:p.childThreshold,DiligenceAttendanceAmount:p.diligenceAttend,DiligenceFacebookAmount:p.diligenceFb,SocialSecurityDeduct:p.socialSecurityDeduct,Contribution:p.contribution}});
    // the base salary belongs to the STAFF record, and setPayrollConfig never carried it — so the
    // number the admin typed was used for THIS calculation and then thrown away
    try{ await api('saveStaff',{staffId:p.staffId,data:{BaseSalary:p.baseSalary}});
      const cached=(A_CACHE.staff||[]).find(x=>x.StaffID===p.staffId); if(cached) cached.BaseSalary=p.baseSalary; }catch(e){}
    const r=await api('computePayroll',Object.assign({},p,{preview:!commit}));
    const savedBadge = commit
      ? `<span class="pill ok">💾 ${EN()?'saved':'บันทึกแล้ว'}</span>`
      : `<span class="pill wait">🧮 ${EN()?'preview — not saved yet':'ตัวอย่าง · ยังไม่บันทึก'}</span>`;
    $('#slipResult').innerHTML=`<div class="spread" style="margin:8px 2px 0"><b>${EN()?'Result':'ผลการคำนวณ'}</b>${savedBadge}</div>`
      + payslipCard(r)
      + (commit?`<div class="row"><button class="btn outline" onclick="A_dlSlip('${r.StaffID}','${r.Month}')">⬇️ ${esc(t('pay.download'))}</button><button class="btn outline" onclick="A_print('${r.Month}')">🖨️ ${esc(t('pay.print3'))}</button></div>`
              :`<p class="muted" style="font-size:13px">${EN()?'Press "Save as payable" to record this and add it to expenses.':'กด "บันทึกเป็นรายการจ่าย" เพื่อบันทึกและรวมเข้ารายจ่าย'}</p>`);
    if(commit) confirmSaved(EN()?'Saved — included in this month’s expenses':'บันทึกแล้ว · รวมในรายจ่ายเดือนนี้');
    else toast(EN()?'Calculated — not saved yet':'คำนวณแล้ว · ยังไม่บันทึก'); };
  // both of these read MOCK.payroll, which is empty in gas mode — so downloading or printing a slip on
  // live always said "ยังไม่มีสลิป". Ask the server for the saved rows instead.
  window.A_dlSlip=async(staffId,month)=>{ let r=null; try{ r=await api('getPayslip',{staffId,month}); }catch(e){}
    if(!r){ toast(EN()?'No payslip for this month yet — press Calculate first':'ยังไม่มีสลิปของเดือนนี้ — กดคำนวณก่อน'); return; }
    await ensureLogos(); openOrDownload(buildSlipsHTML([r],month),'payslip-'+staffId+'-'+month+'.html'); };
  window.A_print=async(month)=>{ const list=(A_CACHE.staff&&A_CACHE.staff.length)?A_CACHE.staff:await api('listStaff').catch(()=>[]);
    const rows=(await Promise.all((list||[]).map(x=>api('getPayslip',{staffId:x.StaffID,month}).catch(()=>null)))).filter(Boolean);
    if(!rows.length){ toast(EN()?'No payslips for this month yet':'ยังไม่มีสลิปของเดือนนี้'); return; }
    await ensureLogos(); openOrDownload(buildSlipsHTML(rows,month), 'payslips-'+month+'.html'); };

  // tabs = the departments master ∪ every class students are actually in, so no child is hidden
  SCREENS.Admin.dspm = async () => { const [students,depts]=await Promise.all([api('listStudents'),api('listDepartments')]);
    A_CACHE.students=students||A_CACHE.students;
    // Count the tabs by exactly the rule classAssessment uses, or the tab and the card disagree —
    // the roster now includes children on temporary leave, and children whose first day is still
    // ahead, and neither can have been assessed.
    const today=todayStr();
    const countable = s => !isPaused(s) && (!s.EnrollDate || String(s.EnrollDate).slice(0,10) <= today);
    const present={}; (students||[]).forEach(s=>{ if(s.Class && countable(s)) present[s.Class]=(present[s.Class]||0)+1; });
    const order=[]; (depts||[]).forEach(d=>{ if(order.indexOf(d)<0) order.push(d); });
    Object.keys(present).forEach(c=>{ if(order.indexOf(c)<0) order.push(c); });
    if(!order.length) order.push('-');
    app.innerHTML=`<h2 class="page">${esc(t('title.analytics'))}</h2>
      <div class="seg" style="flex-wrap:wrap">${order.map((c,i)=>`<button class="${i===0?'active':''}" onclick="A_cls('${esc(c)}',this)">${esc(c)} <small>(${present[c]||0})</small></button>`).join('')}</div><div id="clsRes"></div>`;
    A_cls(order[0]);
  };
  window.A_cls=async(name,el)=>{ if(el){[...el.parentElement.children].forEach(b=>b.classList.remove('active'));el.classList.add('active');} const r=await api('classAssessment',{className:name});
    // Coverage is the headline and starts at 0 — "ผ่านเฉลี่ย 100%" off a single assessed child said
    // the class was finished while five children had not been looked at. The pass rate is still
    // shown, but only once there is something to average, and labelled as being of what was assessed.
    const cov=Number(r.coverage||0);
    const headline = r.assessed
      ? `<span class="pill ${cov>=100?'ok':'wait'}">${EN()?'assessed':'ประเมินแล้ว'} ${r.assessed}/${r.studentCount} (${cov}%)</span>`
      : `<span class="pill info">${EN()?'not assessed yet':'ยังไม่ได้ประเมิน'} 0%</span>`;
    const rate = r.assessed
      ? `<div class="spread" style="font-size:14px;margin-top:4px"><span class="muted">${EN()?'pass rate of what was assessed':'ผ่านเฉลี่ย (เฉพาะที่ประเมินแล้ว)'}</span><b style="color:${r.passRate>=70?'var(--ok)':'var(--warn)'}">${r.passRate}% <small class="muted" style="font-weight:400">(${EN()?'pass':'ผ่าน'} ${r.totalPass} / ${EN()?'fail':'ไม่ผ่าน'} ${r.totalFail})</small></b></div>` : '';
    const todo = r.notAssessed
      ? `<div style="background:var(--warn-bg);border:1px solid var(--warn-line);border-radius:8px;padding:6px 9px;margin-top:6px;color:var(--warn);font-size:13px">⚠️ ${EN()?`${r.notAssessed} child(ren) not assessed yet`:`ยังไม่ได้ประเมิน ${r.notAssessed} คน`}</div>` : '';
    const skip = r.skipped
      ? `<small class="muted" style="display:block;margin-top:4px">${EN()?`${r.skipped} not counted (on leave or not started yet)`:`ไม่นับ ${r.skipped} คน (ลาชั่วคราว / ยังไม่เริ่มเรียน)`}</small>` : '';
    setHTML('#clsRes', `<div class="card"><div class="spread"><b>${esc(r.class)}</b>${headline}</div>
      <small class="muted">${r.studentCount} ${EN()?'kids':'คน'}</small>${rate}${todo}${skip}
      ${r.perStudent.length?r.perStudent.map(s=>{
        // nickname leads; the real name sits under it, small and light
        const nick=dnick(s), real=dnSub(s);
        return `<div class="list-item"><span><b>${esc(nick)}</b> <small class="muted">${s.ageMonth} ${EN()?'m.':'ด.'}</small>${real?`<br><small class="muted" style="font-weight:400">${esc(real)}</small>`:''}</span>
        <span>${s.assessed
          ? `<span class="pill ok">${s.pass}</span> <span class="pill bad">${s.fail}</span>`
          : `<span class="pill info" style="font-size:11px">${EN()?'not assessed':'ยังไม่ประเมิน'}</span>`} <button class="btn sm outline" onclick="A_student('${s.studentId}')">${EN()?'view':'ดูราย นร.'}</button></span></div>`;
      }).join(''):`<small class="muted">${EN()?'No students in this class':'ยังไม่มีนักเรียนในชั้นนี้'}</small>`}</div>`); };
  /* ---- one-page report card (PDF / JPEG) --------------------------------------------------
   * PDPA: the file is drawn on THIS device and handed straight to the download. Nothing is
   * uploaded, nothing is stored on a server, and there is no link that could be forwarded or
   * indexed. The renderer (report_card.js, ~15 KB) is fetched only when someone actually exports.
   */
  window.EXPORT_REPORT=async(sid,kind,btn)=>{
    const old=btn?btn.innerHTML:''; if(btn){ btn.disabled=true; btn.innerHTML='⏳ '+(EN()?'Preparing…':'กำลังสร้าง…'); }
    try{
      const d=await api('studentReportCard',USER.role==='Parent'?{studentId:sid}:{studentId:sid,staffId:USER.staffId},{fresh:true});
      await window.__atomLoadScript('report_card.js',()=>!!window.AtomReportCard);
      await (kind==='pdf' ? AtomReportCard.savePdf(d) : AtomReportCard.saveJpeg(d));
      toast(EN()?'Saved to your device':'บันทึกลงเครื่องแล้ว');
    }catch(e){ err(e); }
    finally{ if(btn){ btn.disabled=false; btn.innerHTML=old; } } };
  const reportButtons=sid=>`<div class="card"><div class="spread"><b>📄 ${EN()?'One-page report':'รายงานสรุป 1 หน้า'}</b></div>
    <p class="muted" style="font-size:13px">${EN()?'Growth + development on a single A4 page. The file is created on this device — nothing is uploaded and no link is shared.':'การเจริญเติบโต + พัฒนาการ รวมใน A4 หน้าเดียว · ไฟล์สร้างบนเครื่องนี้ ไม่มีการอัปโหลดและไม่มีลิงก์แชร์'}</p>
    <div class="row" style="gap:8px"><button class="btn sm outline" style="flex:1" onclick="EXPORT_REPORT('${esc(sid)}','pdf',this)">📕 PDF</button>
      <button class="btn sm outline" style="flex:1" onclick="EXPORT_REPORT('${esc(sid)}','jpg',this)">🖼️ ${EN()?'Image':'รูปภาพ'}</button></div>
    <p class="muted" style="font-size:12px;margin:6px 0 0">🔒 ${EN()?'Contains health information — keep it private.':'มีข้อมูลสุขภาพของเด็ก — โปรดเก็บเป็นความลับ'}</p></div>`;

  window.A_student=async(sid)=>{ const [d,g]=await Promise.all([api('studentAllBands',{studentId:sid}),api('growthHistory',{studentId:sid})]); const pill=DSPM_PILL;
    app.innerHTML=`<h2 class="page">📈 ${esc(dnick(d))} <small class="muted">(${esc(dn(d))})</small></h2>
      <div class="row"><button class="btn sm outline" onclick="GO('dspm')">← ${esc(t('c.back'))}</button><button class="btn sm" onclick="A_editAssess('${sid}')">📝 ${esc(t('assess.edit'))}</button></div>
      ${reportButtons(sid)}
      <div class="card"><div class="spread"><b>${EN()?'Age':'อายุ'} ${esc(ageYMfromMonths(d.ageMonth))} <small class="muted" style="font-weight:400">(${d.ageMonth} ${EN()?'mo':'เดือน'})</small></b><span class="muted">${EN()?'enrolled':'เข้าเรียน'} ${esc(d.enrollDate||'-')}</span></div>
      <p class="muted" style="font-size:13px">แสดงทุกช่วงวัยที่เด็กผ่านมา (ตั้งแต่เข้าเรียน) เพื่อดูพัฒนาการต่อเนื่อง</p></div>
      <div class="card"><h3>📈 ${esc(t('growth.chartTitle'))}</h3>
        <p class="muted" style="font-size:13px">${esc(t('growth.chartSub'))}</p>
        ${growthChartSVG(t('growth.weight'),g.records.map(r=>({x:r.AgeMonth,y:r.Weight})),gBand(g.weightBand,g.gender,g.records,'weight'),'kg')}
        ${growthChartSVG(t('growth.height'),g.records.map(r=>({x:r.AgeMonth,y:r.Height})),gBand(g.heightBand,g.gender,g.records,'height'),'cm')}
        <div class="row" style="font-size:13px;justify-content:center;margin-top:6px"><span>🟦 ${esc(t('growth.actual'))}</span><span>🟩 ${esc(t('growth.normalBand'))}</span></div>
        ${growthRecordsList(g.records)}</div>
      ${d.bands.map(b=>`<div class="card"><h3>${esc(ageBandLabel(b.label))}</h3>${b.items.map(i=>`<div class="list-item"><span><b>ข้อ ${i.itemNo}</b> <span class="pill info">${i.skill}</span> <small>${esc(EN()&&i.descriptionEN?i.descriptionEN:i.description)}</small></span>${pill(i.result)}</div>`).join('')}</div>`).join('')}
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
    +`<button class="btn sm gray" type="button" onclick="this.closest('.vacdrow').remove()" title="${EN()?'Remove':'ลบ'}" aria-label="${EN()?"Delete":"ลบ"}" title="${EN()?"Delete":"ลบ"}">✕</button></div>`; }
  function vaccineCard(sched, recs, sid, editable){
    if(editable){ window.__VAC_SCHED=sched; }  // stash for VAC_save (key→name lookup)
    const body = sched.map(grp=>`<div style="margin-bottom:8px"><b style="font-size:13px">${esc(EN()?grp.ageEN:grp.ageTH)}</b>
      ${grp.items.map(it=>{ const dates=vacDatesOf(recs,it.key);
        if(editable){ const rows=(dates.length?dates:['']).map(d=>vacDateInput(it.key,d)).join('');
          return `<div class="vacitem" style="padding:6px 0;border-bottom:1px solid var(--surface-2)">
            <div style="font-size:13px;font-weight:600">${esc(EN()?it.en:it.th)}</div>
            <div id="vacrow_${esc(it.key)}">${rows}</div>
            <button class="btn sm outline" type="button" onclick="VAC_addDate('${esc(it.key)}')" style="margin-top:4px">➕ ${EN()?'Add dose date':'เพิ่มวันที่ฉีด'}</button></div>`; }
        return `<div class="list-item"><span style="font-size:13px">${esc(EN()?it.en:it.th)}</span>`
          +(dates.length?`<span>${dates.map(d=>`<span class="pill ok">✓ ${esc(d)}</span>`).join(' ')}</span>`:`<span class="pill wait">${esc(t('vac.notYet'))}</span>`)+`</div>`; }).join('')}</div>`).join('');
    return `<div class="card" id="vaccard" data-sid="${esc(sid)}"><h3>💉 ${esc(t('vac.title'))}</h3>
      ${editable?`<p class="muted" style="font-size:13px">${esc(t('vac.note'))}</p>`:''}
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
    if(!ys.length) return `<div class="muted" style="font-size:13px">${esc(title)}: ${EN()?'no data':'ยังไม่มีข้อมูล'}</div>`;
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
    const bandPoly = bandPts.length?`<polygon points="${top} ${bot}" style="fill:var(--ok-2);fill-opacity:.2;stroke:var(--ok-2)" stroke-width="0.6"/>`:'';
    // dashed center reference (band midline)
    const centerLine = center!=null?`<line x1="${pl}" y1="${Y(center)}" x2="${W-pr}" y2="${Y(center)}" style="stroke:var(--ok-2)" stroke-width="0.6" stroke-dasharray="3 3" opacity="0.7"/>`:'';
    const line = pts.map((p,i)=>(i?'L':'M')+X(p.x)+' '+Y(p.y)).join(' ');
    const dots = pts.map(p=>{ const lbl=`${ageYMfromMonths(p.x)} · ${p.y} ${unit}`; const cy=Y(p.y);
      return `<circle cx="${X(p.x)}" cy="${cy}" r="4.5" style="fill:var(--blue)" style="cursor:pointer" onclick="GROWTH_PT('${esc(lbl)}')"><title>${esc(lbl)}</title></circle>
        <text x="${X(p.x)}" y="${cy-7}" font-size="8.5" font-weight="700" style="fill:var(--blue-d)" text-anchor="middle">${p.y}</text>`; }).join('');
    const yt=[ymin,center!=null?center:(ymin+ymax)/2,ymax].map(v=>`<text x="2" y="${Y(v)+3}" font-size="8" style="fill:var(--ink-3)">${v.toFixed(0)}</text>`).join('');
    return `<div style="margin:6px 0"><b style="font-size:13px">${esc(title)} (${unit})</b><br>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:420px;height:auto">
        <line x1="${pl}" y1="${H-pb}" x2="${W-pr}" y2="${H-pb}" style="stroke:var(--line-strong)" stroke-width="0.7"/>
        <line x1="${pl}" y1="${pt}" x2="${pl}" y2="${H-pb}" style="stroke:var(--line-strong)" stroke-width="0.7"/>
        ${bandPoly}${centerLine}<path d="${line}" fill="none" style="stroke:var(--blue)" stroke-width="1.6"/>${dots}${yt}
        <text x="${pl}" y="${H-6}" font-size="8" style="fill:var(--ink-3)">${xmin}${EN()?'m':'ด'}</text>
        <text x="${W-pr-16}" y="${H-6}" font-size="8" style="fill:var(--ink-3)">${xmax}${EN()?'m':'ด'}</text>
      </svg></div>`; }

  window.A_reqCI = async (id,val) => { await api('setRequireCheckin',{staffId:id,value:val}); toast((val?'เปิด':'ปิด')+'การบังคับลงเวลา'); };
  // Save all check-in-requirement toggles at once (persists to STAFF.RequireCheckin). One batched round-trip.
  window.A_saveReqCI = async (btn)=>{ const card=btn.closest('.modal,.card'); const tgs=[...card.querySelectorAll('input[data-sid]')];
    try{ await Promise.all(tgs.map(t=>api('setRequireCheckin',{staffId:t.dataset.sid,value:t.checked}))); confirmSaved(EN()?'Check-in settings saved':'บันทึกการตั้งค่าลงเวลาแล้ว'); const m=btn.closest('.modal'); if(m)m.remove(); }catch(e){err(e);} };
  // Admin can edit a student's DSPM assessment (all items in the current band)
  window.A_editAssess=async(sid)=>{ ASEL={}; let c; try{ c=await api('dspmStatus',{studentId:sid}); }catch(e){ app.innerHTML=`<button class="btn sm outline backbtn" onclick="A_student('${sid}')">${t('c.back')}</button><div class="card muted">${esc(e.message)}</div>`; return; }
    const s=MOCK.students.find(x=>x.StudentID===sid)||{NameTH:sid};
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="A_student('${sid}')">${t('c.back')}</button><h2 class="page">📝 ${esc(t('assess.edit'))} — ${esc(nm(s))}</h2>
      <div class="card"><div class="spread"><span>${esc(t('growth.section').split('/')[0])}: <b>${esc(ageBandLabel(c.ageLabel))}</b></span><span class="muted">${c.ageMonth} ${EN()?'mo':'เดือน'}</span></div></div>
      ${c.items.map(i=>`<div class="card"><div style="margin-bottom:8px"><b>${EN()?'Item':'ข้อ'} ${i.itemNo}</b> <span class="pill info">${i.skill}</span> ${i.result!=='ยังไม่ได้รับการทดสอบ'?`<span class="pill ${i.result==='ผ่าน'?'ok':'bad'}">${EN()?'now':'ปัจจุบัน'}: ${esc(tStat(i.result))}</span>`:''}<br>${esc(EN()&&i.descriptionEN?i.descriptionEN:i.description)}</div>
        ${assessMetaHTML(i, sid)}
        <div class="choice"><button id="p${i.itemNo}" onclick="A_set(${i.itemNo},'pass')">✅ ${esc(t('s.pass'))}</button><button id="f${i.itemNo}" onclick="A_set(${i.itemNo},'fail')">❌ ${esc(t('s.fail'))}</button><button id="n${i.itemNo}" onclick="A_set(${i.itemNo},'nottested')">⊘ ${EN()?'Not assessed':'ยังไม่ได้ประเมิน'}</button><button id="e${i.itemNo}" onclick="A_set(${i.itemNo},'notenrolled')">🚪 ${EN()?'Not enrolled yet':'ยังไม่เข้าโรงเรียน'}</button></div></div>`).join('')}
      <button class="btn block" onclick="A_saveAssess('${sid}')">${esc(t('lbl.saveAssess'))}</button>`;
  };
  window.A_saveAssess=async(sid)=>{ const results=Object.keys(ASEL).map(k=>({itemNo:Number(k),result:ASEL[k]})); if(!results.length){toast(EN()?'Select at least 1':'เลือกอย่างน้อย 1 ข้อ');return;}
    try{ await api('submitAssessment',{studentId:sid,staffId:USER.staffId,results}); confirmSaved(t('c.saved')); A_student(sid); }catch(e){err(e);} };
  window.A_perm = async (role,cap,val) => { await api('setPerm',{role,cap,value:val}); toast(t('c.saved')); };
  // PDPA access matrix — moved off the manage page into a Settings modal (opened from the menu)
  window.A_perms = async () => { const pm=window._PERM||await api('permMatrix');
    const CAPS=[['students','perm.students'],['staff','perm.staff'],['payroll','perm.payroll'],['parentPII','perm.parentPII'],['edit','perm.edit'],['approve','perm.approve']];
    const RS=['Admin','Leader','Teacher','Parent'];
    modal(`<h3>🔐 ${esc(t('lbl.perms'))}</h3><p class="muted" style="font-size:13px">${esc(t('perm.note'))}</p>
      <div style="overflow:auto"><table style="width:100%;font-size:13px;border-collapse:collapse">
      <tr style="background:var(--blue);color:var(--surface)"><th style="padding:4px 6px;text-align:left">${esc(t('perm.role'))}</th>${CAPS.map(c=>`<th style="padding:4px 3px">${esc(t(c[1]))}</th>`).join('')}</tr>
      ${RS.map(r=>`<tr style="border-bottom:1px solid var(--line)"><td style="padding:4px 6px"><b>${esc(t('role.'+r)||r)}</b></td>${CAPS.map(c=>`<td style="text-align:center"><input type="checkbox" style="width:auto" ${pm[r]&&pm[r][c[0]]?'checked':''} onchange="A_perm('${r}','${c[0]}',this.checked)"/></td>`).join('')}</tr>`).join('')}
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
      <p class="muted" style="font-size:13px">${EN()?'Add, edit or remove milestone items. Grouped by age band.':'เพิ่ม แก้ไข หรือลบเกณฑ์พัฒนาการ · จัดกลุ่มตามช่วงอายุ'} (${rows.length})</p>
      ${ordered.map(b=>`<div class="card"><h3>${esc(b.label)} <small class="muted">(${b.items[0]?esc(b.items[0].AgeFrom+'–'+b.items[0].AgeTo+(EN()?' mo':' เดือน')):''})</small></h3>
        ${b.items.sort((x,y)=>Number(x.ItemNo)-Number(y.ItemNo)).map(r=>`<div class="list-item"><span><b>${esc(t('dspm.item'))} ${esc(r.ItemNo)}</b> <span class="pill info" style="font-size:11px">${esc(r.Skill||'')}</span><br><small class="muted">${esc(r.Description||'')}</small></span>
          <span class="row"><button class="btn sm outline" onclick="A_dspmForm(${Number(r.ItemNo)},'${esc(r.Track||'Teacher')}')" aria-label="${EN()?"Edit":"แก้ไข"}" title="${EN()?"Edit":"แก้ไข"}">✏️</button><button class="btn sm pink" onclick="A_dspmDel(${Number(r.ItemNo)},'${esc(r.Track||'Teacher')}')" aria-label="${EN()?"Delete":"ลบ"}" title="${EN()?"Delete":"ลบ"}">🗑️</button></span></div>`).join('')}</div>`).join('')||`<div class="card muted">${esc(t('c.noItems'))}</div>`}`;
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
          ${s.leaves.map(l=>`<div class="slv-row"><label class="slv-pick"><input type="checkbox" class="slvchk" value="${esc(l.LeaveID)}" onchange="A_slvCount()"><span><b style="color:var(--blue)">${esc(ddmmyyyy(l.Date))}</b> <small class="muted">· ${esc(stdLeaveDesc(l))}</small></span></label>
            <span class="row"><button class="btn sm outline" onclick="A_slvEdit('${l.LeaveID}')" aria-label="${EN()?"Edit":"แก้ไข"}" title="${EN()?"Edit":"แก้ไข"}">✏️</button><button class="btn sm pink" onclick="A_slvDel('${l.LeaveID}')" aria-label="${EN()?"Delete":"ลบ"}" title="${EN()?"Delete":"ลบ"}">🗑️</button></span></div>`).join('')}</div>`; }).join('');
      return `<div class="card"><div class="spread"><h3>👶 ${esc(c)}</h3><span class="muted" style="font-size:13px">${Object.keys(studs).length} ${EN()?'kids':'คน'} · ${total} ${EN()?'leaves':'ครั้ง'}</span></div>${studHtml}</div>`; }).join('');
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
      arr.length?arr.map(g=>`<div class="list-item" style="font-size:13px"><span><b>${esc(g.name||'')}</b><br><small class="muted">${EN()?'keep':'เก็บ'} ${esc(g.keepId)}${g.keepHasLine?' 🟢LINE':''}${g.keepLinked?' 🔗':''} · ${EN()?'delete':'ลบ'} ${g.dels.map(d=>esc(d.id)).join(', ')}</small></span></div>`).join(''):`<small class="muted">${EN()?'none':'ไม่มี'}</small>`}`;
    modal(`<h3>🧹 ${esc(t('dedup.title'))}</h3>
      <p class="muted" style="font-size:13px">${EN()?'Keeps the parent with a LINE login and the student linked to a parent; deletes the rest. A daily backup is kept.':'เก็บผู้ปกครองที่มี LINE และนักเรียนที่ผูกกับผู้ปกครองแล้ว · ลบที่เหลือ · มีสำรองข้อมูลรายวัน'}</p>
      <div style="background:var(--warn-bg);border-radius:8px;padding:8px;font-size:13px;color:var(--warn)"><b>${EN()?'Will delete':'จะลบ'}: ${plan.willDelete.parents} ${EN()?'parents':'ผู้ปกครอง'} · ${plan.willDelete.students} ${EN()?'students':'นักเรียน'}</b> <small>(${EN()?'now':'ปัจจุบัน'} ${plan.counts.parents}/${plan.counts.students})</small></div>
      <div style="max-height:44vh;overflow:auto">${grp(EN()?'Parents':'ผู้ปกครอง',pg)}${grp(EN()?'Students':'นักเรียน',sg)}</div>
      ${(plan.willDelete.parents+plan.willDelete.students)?`<button class="btn block pink" onclick="A_dedupApply(this)">🗑️ ${EN()?'Delete duplicates':'ลบข้อมูลซ้ำ'} (${plan.willDelete.parents+plan.willDelete.students})</button>`:`<div class="muted" style="text-align:center;padding:8px">${EN()?'No duplicates found':'ไม่พบข้อมูลซ้ำ'}</div>`}
      <button class="btn outline block" style="margin-top:6px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_dedupApply = async (btn)=>{ if(!confirm(EN()?'Permanently delete the duplicate rows? (a daily backup exists)':'ยืนยันลบข้อมูลซ้ำถาวร? (มีสำรองข้อมูลรายวัน)'))return;
    btn.disabled=true; try{ const r=await api('dedupData',{}); const m=btn.closest('.modal'); if(m)m.remove();
      toast((EN()?'Deleted ':'ลบแล้ว ')+r.deleted.parents+'P/'+r.deleted.students+'S'); GO('manage'); }catch(e){err(e);btn.disabled=false;} };

  // Require-check-in toggles — moved into a modal (opened from the menu)
  window.A_requireCI = async () => { const staff=window._PERM_STAFF||await api('listStaff');
    modal(`<h3>⏱️ ${esc(t('lbl.requireCI'))}</h3><p class="muted" style="font-size:13px">${EN()?'Turn OFF for positions that need not clock in (e.g. leaders). Press Save after changes.':'ปิดสำหรับตำแหน่งที่ไม่ต้องลงเวลา (เช่น หัวหน้างาน) — กด บันทึก หลังเปลี่ยน'}</p>
      <div style="max-height:56vh;overflow:auto">${staff.map(s=>`<div class="list-item"><span><b>${esc(nm(s))}</b> <small class="muted">${esc(s.PositionLevel||'')}</small></span>
        <label class="switch"><input type="checkbox" data-sid="${s.StaffID}" ${s.RequireCheckin!==false?'checked':''}><span class="slider"></span></label></div>`).join('')}</div>
      <button class="btn block" style="margin-top:8px" onclick="A_saveReqCI(this)">💾 ${esc(t('c.save'))}</button>`);
  };
  // Admin forms must read the LIVE records (gas mode), not the stale window.MOCK arrays.
  // manage()/home() fill this cache; the edit forms + dropdowns read from it (fallback to MOCK).
  /**
   * Every roster the admin screens use, kept in alphabetical order.
   *
   * These three are assigned from eighteen different places and feed nearly every list and dropdown
   * in the app. Sorting at each of those sites would work until the nineteenth forgot, so the order
   * is applied HERE, once, on the way in — a list cannot enter the cache unsorted.
   *
   * Re-sorted on language change too: Thai and English order differently, and the key is the name
   * being displayed, which itself changes with the language.
   */
  const _AC = { staff:[], students:[], parents:[], classes:[], plans:[], announcements:[], depts:[] };
  window.A_CACHE = {
    get classes(){ return _AC.classes; },       set classes(v){ _AC.classes=v||[]; },
    get plans(){ return _AC.plans; },           set plans(v){ _AC.plans=v||[]; },
    get announcements(){ return _AC.announcements; }, set announcements(v){ _AC.announcements=v||[]; },
    get depts(){ return _AC.depts; },           set depts(v){ _AC.depts=v||[]; },
    get groups(){ return _AC.groups; },         set groups(v){ _AC.groups=v||[]; },
    get staff(){ return _AC.staff; },           set staff(v){ _AC.staff=sortPeople(v||[]); },
    get students(){ return _AC.students; },     set students(v){ _AC.students=sortPeople(v||[]); },
    get parents(){ return _AC.parents; },       set parents(v){ _AC.parents=sortPeople(v||[]); }
  };
  // the stored order follows the language on screen, so switching TH/EN re-orders rather than keeping
  // an order built from names nobody is looking at any more
  window.__atomResort = () => { ['staff','students','parents'].forEach(k => { A_CACHE[k]=_AC[k]; }); };
  const findStaff   = id => (A_CACHE.staff||[]).find(x=>x.StaffID===id)     || (MOCK.staff||[]).find(x=>x.StaffID===id)     || {};
  const findStudent = id => (A_CACHE.students||[]).find(x=>x.StudentID===id) || (MOCK.students||[]).find(x=>x.StudentID===id) || {};
  // Six buttons per student row wrapped into ragged strips on a phone. The three everyday ones stay
  // on the row; the rarer (and two destructive) ones move behind ⋯ so a mis-tap can't withdraw a
  // child. Reuses modal(), so it is keyboard- and Esc-friendly for free.
  window.A_stuMore = (sid)=>{ const s=findStudent(sid);
    const close="this.closest('.modal').remove();";
    modal(`<h3>👶 ${esc(dispNick(s)||sid)} ${nmSub(s)?`<small class="muted" style="font-size:13px">${esc(nmSub(s))}</small>`:''}</h3>
      <button class="btn block outline" onclick="${close}A_vaccines('${esc(sid)}')">💉 ${EN()?'Vaccination record':'บันทึกวัคซีน'}</button>
      <!-- correcting a time moved to ดำเนินการ → นักเรียน (A_editAttPick): it is a daily attendance job,
           not something you go looking for inside one child's record -->
      <button class="btn block gray" style="margin-top:8px" onclick="${close}A_exportStudent('${esc(sid)}')">📤 ${EN()?'Export data':'ส่งออกข้อมูล'}</button>
      <button class="btn block pink" style="margin-top:8px" onclick="${close}A_removeStudent('${esc(sid)}')">🚪 ${EN()?'Withdraw student':'นำนักเรียนออก'}</button>
      <button class="btn block outline" style="margin-top:12px" onclick="${close}">${esc(t('c.close'))}</button>`); };
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
  window.A_plans    = A_plans;   // planLabel() (defined much earlier) resolves live plans through this
  // generic client-side list filter + collapsible section (Admin manage). Sections start collapsed.
  window.A_toggleSec = (btn)=>{ const b=btn.closest('.secw'); const body=b.querySelector('.secbody'); const open=body.hasAttribute('hidden'); if(open)body.removeAttribute('hidden');else body.setAttribute('hidden',''); btn.querySelector('.caret').textContent=open?'▲':'▼'; btn.setAttribute('aria-expanded', open?'true':'false'); };
  // manage: open a data section (staff/parents/students) and scroll to it (from the count tiles)
  window.A_jumpSec = (id)=>{ const el=document.getElementById(id); if(!el)return; const body=el.querySelector('.secbody');
    if(body&&body.hasAttribute('hidden')){ body.removeAttribute('hidden'); const car=el.querySelector('.caret'); if(car)car.textContent='▲'; }
    el.scrollIntoView({behavior:'smooth',block:'start'}); };
  // ONE search box for the whole manage screen. It used to be three separate boxes, each buried
  // INSIDE a collapsed section, so finding a person meant first guessing which section they were in
  // and expanding it. This filters all three at once, opens whichever sections have hits, closes the
  // ones that don't, and shows match counts on the section pills.
  const MG_SECS = ['sec-staff','sec-parents','sec-students'];
  // ---- app-wide search (admin) -------------------------------------------------------------------
  // The Manage screen's box only searches Manage. This one is in the header, so a name can be found
  // from any screen, and each hit opens the record it belongs to instead of just scrolling to a row.
  window.A_globalSearch = async ()=>{
    const m=modal(`<h3>🔎 ${EN()?'Search':'ค้นหา'}</h3>
      <input id="gsq" type="search" autocomplete="off" oninput="A_gsRun(this.value)"
        aria-label="${EN()?'Search people':'ค้นหาบุคคล'}"
        placeholder="${EN()?'Name, nickname, phone or ID…':'ชื่อ ชื่อเล่น เบอร์โทร หรือเลขบัตร…'}"
        style="width:100%;padding:12px;border:1px solid var(--line);border-radius:10px"/>
      <p class="muted" style="font-size:12px;margin:6px 2px">${EN()?'Students · parents · staff':'นักเรียน · ผู้ปกครอง · พนักงาน'}</p>
      <div id="gsres" style="max-height:58vh;overflow:auto"></div>`);
    const inp=m.querySelector('#gsq'); if(inp) setTimeout(()=>inp.focus(),80);
    // load once; the lists are SWR-cached so this is usually instant
    if(!(A_CACHE.students&&A_CACHE.students.length)||!(A_CACHE.parents&&A_CACHE.parents.length)||!(A_CACHE.staff&&A_CACHE.staff.length)){
      try{ const [st,pa,sf,kids]=await Promise.all([api('listStudents'),api('listParents'),api('listStaff'),api('parentKidsMap').catch(()=>({}))]);
        A_CACHE.students=st||A_CACHE.students; A_CACHE.parents=pa||A_CACHE.parents; A_CACHE.staff=sf||A_CACHE.staff;
        if(kids&&Object.keys(kids).length) window._PKIDS=kids;
      }catch(e){}
    }
  };
  window.A_gsRun = (q)=>{
    q=String(q||'').trim().toLowerCase();
    const box=document.getElementById('gsres'); if(!box) return;
    if(q.length<1){ box.innerHTML=''; return; }
    const hit=(...parts)=>parts.filter(Boolean).join(' ').toLowerCase().indexOf(q)>=0;
    const rows=[];
    (A_CACHE.students||[]).forEach(s=>{ if(rows.length>40) return;
      if(hit(s.NameTH,s.NameEN,s.Nickname,s.NicknameEN,s.Class,s.NationalID))
        rows.push({ic:'👶',t:EN()?'Student':'นักเรียน',head:dispNick(s),sub:[nmSub(s),s.Class].filter(Boolean).join(' · '),
                   go:`A_studentForm('${esc(s.StudentID)}')`}); });
    (A_CACHE.parents||[]).forEach(p=>{ if(rows.length>40) return;
      // phones are stored as numbers, so the leading 0 is gone — match both "811…" and "0811…"
      if(hit(p.NameTH,p.NameEN,p.Nickname,p.NicknameEN,p.Phone,phoneFmt(p.Phone),p.NationalID))
        rows.push({ic:'👪',t:EN()?'Parent':'ผู้ปกครอง',head:parentDisp(p),sub:[titledName(p),phoneFmt(p.Phone)].filter(Boolean).join(' · '),
                   go:`A_parentForm('${esc(p.ParentID)}')`}); });
    (A_CACHE.staff||[]).forEach(s=>{ if(rows.length>40) return;
      if(hit(s.NameTH,s.NameEN,s.Nickname,s.Position,s.Department))
        rows.push({ic:'👩‍🏫',t:EN()?'Staff':'พนักงาน',head:dispNick(s),sub:[nmSub(s),s.Position].filter(Boolean).join(' · '),
                   go:`A_staffForm('${esc(s.StaffID)}')`}); });
    box.innerHTML = rows.length
      ? rows.map(r=>`<div class="list-item" style="cursor:pointer" onclick="A_gsOpen(&quot;${r.go.replace(/"/g,'&quot;')}&quot;)">
          <span><b>${r.ic} ${esc(r.head)}</b> <span class="pill info" style="font-size:11px">${esc(r.t)}</span>
          ${r.sub?`<br><small class="muted">${esc(r.sub)}</small>`:''}</span><span class="muted">›</span></div>`).join('')
      : `<p class="muted" style="text-align:center;padding:14px">${EN()?'No matches':'ไม่พบข้อมูลที่ค้นหา'}</p>`;
  };
  window.A_gsOpen = (call)=>{ const m=document.querySelector('.modal'); if(m)m.remove();
    try{ (new Function(call))(); }catch(e){ err(e); } };

  window.A_search = (inp)=>{
    const q=String(inp&&inp.value||'').trim().toLowerCase();
    let total=0;
    MG_SECS.forEach(id=>{
      const sec=document.getElementById(id); if(!sec) return;
      const body=sec.querySelector('.secbody'); const rows=[...sec.querySelectorAll('.list-item[data-k]')];
      let hits=0;
      rows.forEach(it=>{ const ok = !q || String(it.dataset.k||'').indexOf(q)>=0;
        it.style.display = ok ? '' : 'none'; if(ok && q) hits++; });
      total+=hits;
      const pill=sec.querySelector('.pill');            // the header count (first .pill in the section)
      if(pill) pill.textContent = q ? (hits+'/'+rows.length) : String(rows.length);
      if(!body) return;
      const car=sec.querySelector('.caret'), tog=sec.querySelector('.sectog');
      if(q){ const open=hits>0;
        if(open) body.removeAttribute('hidden'); else body.setAttribute('hidden','');
        if(car) car.textContent = open?'▲':'▼';
        if(tog) tog.setAttribute('aria-expanded', open?'true':'false'); }
    });
    const out=document.getElementById('mgSearchCount');
    if(out) out.textContent = q ? (EN()?`${total} result${total===1?'':'s'}`:`พบ ${total} รายการ`) : '';
  };
  const secHead = (icon,title,count,addBtn)=>`<div class="spread" style="cursor:pointer" onclick="A_toggleSec(this.querySelector('.sectog'))"><h3 style="margin:0">${icon} ${esc(title)} <span class="pill info">${count}</span></h3><span class="row" onclick="event.stopPropagation()">${addBtn||''}<button class="btn sm outline sectog" onclick="A_toggleSec(this)" aria-expanded="false" aria-label="${EN()?'Expand or collapse this section':'ย่อ/ขยายหมวดนี้'}"><span class="caret" aria-hidden="true">▼</span></button></span></div>`;
  const searchBox = ()=>`<div class="card" style="padding:10px 12px">
    <input id="mgSearch" class="asearch" type="search" oninput="A_search(this)"
      aria-label="${EN()?'Search staff, parents and students':'ค้นหาพนักงาน ผู้ปกครอง และนักเรียน'}"
      placeholder="🔎 ${EN()?'Search staff, parents or students…':'ค้นหาพนักงาน ผู้ปกครอง หรือนักเรียน…'}"
      style="width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px"/>
    <small id="mgSearchCount" class="muted" style="font-size:13px;display:block;margin-top:4px"></small></div>`;

  SCREENS.Admin.manage = async () => {
    const [staff,students,parents,pm,groups,exported,wds,classes,plans,depts,linkCounts,kidsMap]=await Promise.all([api('listStaff'),api('listStudents'),api('listParents'),api('permMatrix'),api('listStaffGroups'),api('listExportedStudents'),api('listWithdrawals',{pending:true}),api('listClasses'),api('getPlans'),api('listDepartments'),api('parentLinkCounts').catch(()=>({})),api('parentKidsMap').catch(()=>({}))]);
    window._LINKCOUNTS=linkCounts||{};
    window._PKIDS=kidsMap||{};   // lets parentDisp() name every parent by their child, links included
    A_CACHE.staff=staff; A_CACHE.students=students; A_CACHE.parents=parents; A_CACHE.classes=classes||[]; A_CACHE.plans=plans||[]; A_CACHE.groups=groups||[]; A_CACHE.depts=depts||[];
    // Someone who has left keeps their record — payroll and attendance history still point at it —
    // but they do not belong in the working list. They get their own collapsed section below.
    const _left=v=>String(v||'ACTIVE').toUpperCase()==='INACTIVE';
    const _stAct=(staff||[]).filter(s=>!_left(s.Status));
    const _stGone=(staff||[]).filter(s=>_left(s.Status));
    const CAPS=[['students','perm.students'],['staff','perm.staff'],['payroll','perm.payroll'],['parentPII','perm.parentPII'],['edit','perm.edit'],['approve','perm.approve']];
    const ROLES=['Admin','Leader','Teacher','Parent'];
    window._PERM=pm; window._PERM_STAFF=staff;
    // Categorized admin menu — grouped so related tools sit together (e.g. all the OT/time tools).
    const MENU=[
      {t:EN()?'👥 People & classes':'👥 บุคลากร & ชั้นเรียน', items:[
        ['🔁',t('manage.organize'),"GO_('organize')"],
        ['🏫',t('manage.departments'),'A_departments()'],
        ['📦',EN()?'Packages / prepay discounts':'แพ็กเกจ / ส่วนลดชำระล่วงหน้า','A_packages()'],
        ['🕑',t('manage.groups'),'A_groups()'],
        ['⏱️',t('lbl.requireCI'),'A_requireCI()'],
      ]},
      // ⏰ Time & OT moved to the ดำเนินการ screen, where the day-to-day approving happens: the
      // teacher tools sit under 👩‍🏫 คุณครู and the student one under 👶 นักเรียน. Keeping them here
      // as well would be two doors to the same room, and the second one always goes stale.
      {t:EN()?'📄 Reports & records':'📄 รายงาน & เอกสาร', items:[
        ['📒',t('jr.admin'),'A_journals()'],
        ['📍',EN()?'On-behalf check-in log':'ประวัติเช็คอิน-เอาท์แทน','A_checkinLog()'],
        ['🏠',t('slv.title'),"GO_('studentLeaves')"],
        ['🛡️',t('ins2.manage'),'A_insurance()'],
        ['📈',t('dspm.manageTitle'),"GO_('dspmCriteria')"],
        ['🍚',EN()?'Food list (master)':'รายการอาหาร (ตัวหลัก)','A_foodItems()'],
        ['📅',EN()?'Monthly menu':'เมนูอาหารรายเดือน','A_foodMenu()'],
        ['💬',EN()?'Satisfaction survey':'แบบสอบถามความพึงพอใจ','A_surveys()'],
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
    // quick-access data counts → tap to open & scroll to that section
    const countTiles=`<div class="kpigrid" style="grid-template-columns:repeat(3,1fr);margin-bottom:2px">
      <button class="kpi blue" onclick="A_jumpSec('sec-staff')"><span class="kic">👩‍🏫</span><b class="kn">${staff.length}</b><span class="kl">${EN()?'Staff':'พนักงาน'}</span></button>
      <button class="kpi green" onclick="A_jumpSec('sec-parents')"><span class="kic">👪</span><b class="kn">${parents.length}</b><span class="kl">${EN()?'Parents':'ผู้ปกครอง'}</span></button>
      <button class="kpi amber" onclick="A_jumpSec('sec-students')"><span class="kic">👶</span><b class="kn">${students.length}</b><span class="kl">${EN()?'Students':'นักเรียน'}</span></button></div>`;
    app.innerHTML=`<h2 class="page">${esc(t('title.manage'))}</h2>
      ${wds.length?`<div class="card" style="background:var(--warn-bg);border-color:var(--warn-line)"><h3>🚪 ${esc(t('wd.requests'))} (${wds.length})</h3>
        ${wds.map(w=>`<div class="list-item"><span><b>${esc(EN()?w.nameEN:w.name)}</b> <small class="muted">${esc(w.class||'')}</small><br><small class="muted">${esc(t('wd.reason.'+w.Reason)||w.Reason)}${w.Detail?' · '+esc(w.Detail):''} · ${esc(w.CreatedDate)}</small></span>
          <button class="btn sm pink" onclick="A_processWithdraw('${w.WithdrawID}','${w.StudentID}','${w.Reason}')">${esc(t('wd.process'))}</button></div>`).join('')}</div>`:''}
      ${countTiles}
      <div class="sec-divider">🛠️ ${EN()?'Tools':'เครื่องมือ'}</div>
      ${amenu}
      <div class="sec-divider">🗂️ ${EN()?'People & data':'บุคลากร & ข้อมูล'}</div>
      ${searchBox()}
      <div class="card secw" id="sec-staff">${secHead('👩‍🏫',t('c.staff'),_stAct.length,`<button class="btn sm" onclick="event.stopPropagation();A_staffForm()">+ ${esc(t('manage.add'))}</button>`)}
        <div class="secbody" hidden>
        ${_stAct.map(s=>`<div class="list-item stack" data-k="${esc((s.NameTH+' '+(s.NameEN||'')+' '+(s.Nickname||'')+' '+(s.Position||'')+' '+(s.Department||'')).toLowerCase())}"><span style="display:flex;gap:8px;align-items:center">${personAvatar(s)}<span><b>${esc(dispNick(s))}</b> ${nmSub(s)?`<small class="muted">${esc(nmSub(s))}</small>`:""}<br><small class="muted">${_notr(s.Position||"")} · ${esc(deptLabel(s))} · 🕑 ${_notr(groupLabel(s.StaffGroup))}${groupHours(s.StaffGroup)?' ('+esc(groupHours(s.StaffGroup))+')':''}</small><br><small class="muted">${esc(t('staff.start'))} ${esc(s.StartDate||'-')} · ${esc(t('staff.tenure'))} ${esc(tenure(s.StartDate))}</small>${endNote(s)}</span></span><span class="acts"><button class="btn sm outline" onclick="A_staffForm('${s.StaffID}')">✏️ ${EN()?'Edit':'แก้ไข'}</button><button class="btn sm pink" onclick="A_delStaff('${s.StaffID}',this)">🗑️ ${EN()?'Delete':'ลบ'}</button></span></div>`).join('')}</div></div>
      ${_stGone.length?`<div class="card secw" id="sec-staff-gone">${secHead('🚪',EN()?'No longer working here':'สิ้นสุดการทำงานแล้ว',_stGone.length,'')}
        <div class="secbody" hidden>
        <p class="muted" style="font-size:13px;margin:2px 2px 8px">${EN()?'Kept on purpose — payroll and attendance history still refer to these records. Open one to bring the person back.':'เก็บไว้โดยตั้งใจ — ประวัติเงินเดือนและการลงเวลายังอ้างอิงถึงข้อมูลเหล่านี้ · เปิดดูเพื่อนำกลับเข้าทำงานได้'}</p>
        ${_stGone.map(s=>`<div class="list-item stack"><span style="display:flex;gap:8px;align-items:center">${personAvatar(s)}<span><b>${esc(dispNick(s))}</b> ${nmSub(s)?`<small class="muted">${esc(nmSub(s))}</small>`:""}<br><small class="muted">${esc(t('staff.start'))} ${esc(s.StartDate||'-')} → ${esc(s.EndDate||'-')}</small>${s.EndReason?`<br><small style="color:var(--warn)">${esc(s.EndReason)}</small>`:''}${s.EndRemark?`<br><small class="muted" style="white-space:pre-wrap">${esc(s.EndRemark)}</small>`:''}</span></span><span class="acts"><button class="btn sm outline" onclick="A_staffForm('${s.StaffID}')">👁️ ${EN()?'Open':'เปิดดู'}</button><button class="btn sm" onclick="A_staffReturn('${s.StaffID}',this)">↩️ ${EN()?'Bring back':'นำกลับ'}</button></span></div>`).join('')}</div></div>`:''}
      <div class="card secw" id="sec-parents">${secHead('👪',t('manage.parents'),parents.length,`<button class="btn sm" onclick="event.stopPropagation();A_parentForm()">+ ${esc(t('manage.add'))}</button>`)}
        <div class="secbody" hidden>
        ${parents.map(p=>{ const lc=(window._LINKCOUNTS||{})[p.ParentID]||0; const lcBadge=`<span class="pill ${lc?'ok':'bad'}" style="font-size:11px" title="${EN()?'linked children':'จำนวนบุตรที่ผูก'}">👶 ${lc}</span>`;
          return `<div class="list-item stack" data-k="${esc((p.NameTH+' '+(p.NameEN||'')+' '+(p.Nickname||'')+' '+(p.NicknameEN||'')+' '+(p.Phone||'')+' '+String(p.Relationship||'').replace(/<[^>]*>/g,'')).toLowerCase())}"><span style="display:flex;gap:8px;align-items:center">${personAvatar(p)}<span><b>${esc(parentDisp(p))}</b> ${lcBadge} <small class="muted">${[p.NameTH||p.NameEN?esc(titledName(p)):'',relLabel(p.Relationship),p.Phone?phoneLink(p.Phone):(EN()?'no phone':'ไม่มีเบอร์โทร')].filter(Boolean).join(' · ')}</small></span></span><span class="acts"><button class="btn sm outline" onclick="A_parentLinks('${p.ParentID}')">🔗 ${EN()?'Children':'บุตรที่ผูก'}</button><button class="btn sm outline" onclick="A_parentForm('${p.ParentID}')">✏️ ${EN()?'Edit':'แก้ไข'}</button><button class="btn sm pink" onclick="A_delParent('${p.ParentID}',this)">🗑️ ${EN()?'Delete':'ลบ'}</button></span></div>`; }).join('')}</div></div>
      <div class="card secw" id="sec-students">${secHead('👶',EN()?'Students':'นักเรียน',students.length,`<span class="row"><button class="btn sm outline" onclick="event.stopPropagation();A_issueCombined()">🧾 ${EN()?'Issue (select)':'ออกบิล (เลือก)'}</button><button class="btn sm" onclick="event.stopPropagation();A_genBills()">📅 ${esc(t('bill.genTitle'))}</button></span>`)}
        <div class="secbody" hidden>
        ${students.map(s=>`<div class="list-item stack" data-k="${esc((s.NameTH+' '+(s.NameEN||'')+' '+(s.Nickname||'')+' '+(s.NicknameEN||'')+' '+(s.Class||'')+' '+(s.NationalID||'')).toLowerCase())}"><span>${studentAvatar(s)} <b>${esc(dispNick(s))}</b> ${isPaused(s)?`<span class="pill wait" style="font-size:11px">⏸️ ${EN()?'on leave':'ลาชั่วคราว'}</span>`:''} <small class="muted">${nmSub(s)?esc(nmSub(s))+" · ":""}${esc(s.Class)} · ${esc(ageYM(s.DOB))}${s.InsuranceHas?' · 🛡️':''}</small><br><small class="muted">${EN()?'ID':'บัตร'}: ${esc(s.NationalID||'-')}</small>${isPaused(s)?`<br><small style="color:var(--warn)">⏸️ ${esc(pauseSpan(s))}</small>`:''}</span><span class="acts"><button class="btn sm outline" onclick="A_studentForm('${s.StudentID}')">✏️ ${EN()?'Edit':'แก้ไข'}</button><button class="btn sm" onclick="A_issueBill('${s.StudentID}')">🧾 ${EN()?'Bill':'ออกบิล'}</button><button class="btn sm" onclick="A_charges('${s.StudentID}')">💵 ${EN()?'Charges':'เรียกเก็บ'}</button><button class="btn sm outline" onclick="A_stuMore('${s.StudentID}')" aria-label="${EN()?'More actions':'การทำงานเพิ่มเติม'}" title="${EN()?'More actions':'การทำงานเพิ่มเติม'}">⋯</button></span></div>`).join('')}</div></div>`;
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
        <label class="field"><span>🔐 ${EN()?'Access':'สิทธิ์การใช้งาน'}</span><select id="sf_Role">${
          [['Teacher',EN()?'Teacher':'คุณครู'],['Admin',EN()?'Admin — full access':'ผู้ดูแลระบบ — ทำได้ทุกอย่าง'],['Observer',EN()?'Observer — view only':'ผู้ตรวจสอบ — ดูอย่างเดียว']]
            .map(([v,l])=>`<option value="${v}" ${String(s.Role||'Teacher')===v?'selected':''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="field"><span>${EN()?'Work group & time (admin-managed)':'กลุ่มพนักงาน & เวลา (แอดมินจัดการ)'}</span>
          <div class="row" style="gap:6px"><select id="sf_StaffGroup" style="flex:1">${grpOpts.map(g=>`<option value="${esc(g.GroupName)}" ${s.StaffGroup===g.GroupName?'selected':''}>${esc(g.GroupName)}${g.CheckInTime?` (${esc(g.CheckInTime)}–${esc(g.CheckOutTime||'')})`:''}</option>`).join('')}</select><button type="button" class="btn sm outline" onclick="A_groups()" title="${EN()?'Edit groups & times':'แก้ไขกลุ่ม & เวลา'}" aria-label="${EN()?"Edit":"แก้ไข"}" title="${EN()?"Edit":"แก้ไข"}">✏️</button></div></label></div>
      <div class="jsec"><b style="font-size:13px">🏫 ${EN()?'Department(s) responsible (choose one or more)':'แผนกที่รับผิดชอบ (เลือกได้หลายแผนก)'}</b>
        <label style="display:block;margin:4px 0"><input type="checkbox" id="sf_AllDept" style="width:auto" ${s.Department==='*'||s.Classes==='*'?'checked':''} onchange="SF_allDept(this)"/> ${EN()?'All departments (head teacher)':'ทุกแผนก (หัวหน้าครู)'}</label>
        <div id="sf_DeptList" ${(s.Department==='*'||s.Classes==='*')?'style="opacity:.4;pointer-events:none"':''}>${A_classOptions(s.Department&&s.Department!=='*'?s.Department:'').map(d=>`<label style="margin-right:10px;font-size:13px"><input type="checkbox" class="sfDept" value="${esc(d)}" style="width:auto" ${String(s.Department||'').split(',').map(x=>x.trim()).indexOf(d)>=0?'checked':''}/> ${esc(d)}</label>`).join('')||`<small class="muted">${EN()?'no departments yet':'ยังไม่มีแผนก'}</small>`}</div>
        <small class="muted" style="font-size:13px">${EN()?'Department = responsibility (can be several). Work time is set by the group, not the department.':'แผนก = ส่วนที่รับผิดชอบ (มีได้หลายแผนก) · เวลาเข้างานกำหนดที่กลุ่มพนักงาน ไม่ผูกกับแผนก'}</small></div>
      <label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="sf_CanClassOrg" style="width:auto" ${(s.CanClassOrg===true||s.CanClassOrg===1||['YES','TRUE'].indexOf(String(s.CanClassOrg||'').toUpperCase())>=0)?'checked':''}/> 🔁 ${EN()?'Allow this teacher to organize classes (move teachers/students, like Admin)':'ให้ครูคนนี้จัดชั้นเรียนได้ (ย้ายครู/นักเรียน เหมือนแอดมิน)'}</label>
      <label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="sf_CanFoodMenu" style="width:auto" ${(s.CanFoodMenu===true||s.CanFoodMenu===1||['YES','TRUE'].indexOf(String(s.CanFoodMenu||'').toUpperCase())>=0)?'checked':''}/> 🍚 ${EN()?'Allow this teacher to manage the monthly food menu':'ให้ครูคนนี้จัดการเมนูอาหารรายเดือนได้'}</label>
      <div class="grid2">${f('Phone',t('reg.phone'),phoneFmt(s.Phone))}${f('NationalID',t('reg.nationalId'),s.NationalID)}</div>
      <div class="grid2">${f('StartDate',t('staff.startDate'),s.StartDate,'date')}${f('BaseSalary',t('pay.baseSalary'),s.BaseSalary,'number')}</div>
      <p class="muted" style="font-size:13px;margin:-4px 2px 8px">${EN()?'Before the first working day this person cannot log time, and nothing counts them present or absent.':'ก่อนถึงวันเข้าทำงานวันแรก จะลงเวลาไม่ได้ และระบบจะไม่นับมา/ขาด/สายให้'}</p>
      <div class="card" style="background:var(--surface-2);padding:8px"><b style="font-size:13px">⭐ ${EN()?'Diligence bonus for this person':'เบี้ยขยันของพนักงานคนนี้'}</b>
        <p class="muted" style="font-size:13px;margin:2px 0 6px">${EN()?'Set per person — the payroll screen starts from these figures instead of the school-wide default.':'ตั้งได้รายบุคคล ไม่จำเป็นต้องเท่ากันทุกคน · หน้าคำนวณเงินเดือนจะดึงค่านี้ไปใช้แทนค่ากลางของโรงเรียน'}</p>
        <div class="grid2"><label class="field" style="margin:0"><span>${esc(t('set.attendAmt'))} (฿)</span><input id="sf_DiligenceAttendanceAmount" type="number" min="0" value="${esc(s.DiligenceAttendanceAmount!=null&&s.DiligenceAttendanceAmount!==''?s.DiligenceAttendanceAmount:'')}" placeholder="${esc(String((MOCK.config&&MOCK.config.DiligenceAttendanceAmount)||500))}"/></label>
          <label class="field" style="margin:0"><span>${esc(t('set.fbAmt'))} (฿)</span><input id="sf_DiligenceFacebookAmount" type="number" min="0" value="${esc(s.DiligenceFacebookAmount!=null&&s.DiligenceFacebookAmount!==''?s.DiligenceFacebookAmount:'')}" placeholder="${esc(String((MOCK.config&&MOCK.config.DiligenceFacebookAmount)||500))}"/></label></div></div>
      ${id?(String(s.Status||'ACTIVE').toUpperCase()==='INACTIVE'
        ? `<div class="card" style="background:var(--warn-bg);border-color:var(--warn-line);padding:8px">
             <b style="font-size:13px;color:var(--warn)">🚪 ${EN()?'No longer working here':'สิ้นสุดการทำงานแล้ว'}</b>
             <div style="font-size:13px;margin-top:4px">${esc(s.EndDate||'')}${s.EndReason?` · ${esc(s.EndReason)}`:''}</div>
             ${s.EndRemark?`<div class="muted" style="font-size:13px;white-space:pre-wrap">${esc(s.EndRemark)}</div>`:''}
             <p class="muted" style="font-size:13px;margin:6px 0 0">${EN()?'The record was kept — payroll and attendance history still refer to it.':'ระบบเก็บข้อมูลไว้ครบ — ประวัติเงินเดือนและการลงเวลายังอ้างอิงถึงคนนี้อยู่'}</p>
             <button type="button" class="btn sm block" style="margin-top:6px" onclick="A_staffReturn('${id}',this)">↩️ ${EN()?'Bring this person back':'นำกลับเข้าทำงาน'}</button></div>`
        : `<details class="card" style="background:var(--surface-2);padding:8px"><summary style="font-size:13px;cursor:pointer"><b>🚪 ${EN()?'End employment':'สิ้นสุดการทำงาน'}</b></summary>
             <p class="muted" style="font-size:13px;margin:6px 0">${EN()?'Removes them from the active lists. Nothing is deleted — payroll and attendance history are kept, and they can be brought back later.':'จะนำชื่อออกจากรายชื่อที่ใช้งานอยู่ · ไม่มีการลบข้อมูล ประวัติเงินเดือนและการลงเวลายังอยู่ครบ และนำกลับเข้ามาใหม่ได้'}</p>
             <div class="grid2"><label class="field" style="margin:0"><span>${EN()?'Last working day':'วันสิ้นสุดการทำงาน'}</span><input id="sf_EndDate" type="date" value="${esc(s.EndDate||'')}"/></label>
               <label class="field" style="margin:0"><span>${EN()?'Reason':'เหตุผล'}</span><select id="sf_EndReason" translate="no">
                 <option value="">—</option>
                 <option value="ไม่ผ่านการทดลองงาน">${EN()?'Did not pass probation':'ไม่ผ่านการทดลองงาน'}</option>
                 <option value="ลาออก">${EN()?'Resigned':'ลาออก'}</option>
                 <option value="ให้ออก">${EN()?'Dismissed':'ให้ออก'}</option></select></label></div>
             <label class="field"><span>${EN()?'Notes':'รายละเอียดเพิ่มเติม'}</span><textarea id="sf_EndRemark" rows="3" style="width:100%"></textarea></label>
             <button type="button" class="btn sm pink block" onclick="A_staffEnd('${id}',this)">${EN()?'Save and remove from lists':'บันทึกและนำออกจากรายชื่อ'}</button></details>`):''}
      <div class="grid2"><label class="field"><span>🏦 ${EN()?'Bank':'ธนาคาร'}</span><select id="sf_BankName">${['','SCB','KBANK','KTB','BBL','TTB','BAY','GSB','KKP','TISCO','UOB','CIMB','BAAC','LHBANK'].map(b=>`<option value="${b}" ${String(s.BankName||'')===b?'selected':''}>${b||(EN()?'—':'—')}</option>`).join('')}</select></label>
        ${f('BankAccount',(EN()?'Account number':'เลขที่บัญชี'),s.BankAccount)}</div>
      <div class="card" style="padding:8px;background:var(--surface-2)">
        <label class="field" style="margin:0"><span>💰 ${EN()?'Opening accumulated contribution (฿)':'เงินสมทบสะสมยกมา (฿)'}</span>
          <input id="sf_ContributionOpening" type="number" value="${esc(s.ContributionOpening!=null?s.ContributionOpening:0)}" ${String(s.ContributionLocked||'')==='YES'?'readonly style="background:var(--surface-3)"':''}/></label>
        <label class="field" style="display:flex;align-items:center;gap:8px;margin:6px 0 0"><input type="checkbox" id="sf_ContributionLocked" style="width:auto" ${String(s.ContributionLocked||'')==='YES'?'checked':''}/> 🔒 ${EN()?'Lock this figure (no more edits)':'ล็อกยอดนี้ (ไม่ให้แก้ไขอีก)'}</label>
        <small class="muted" style="font-size:13px">${EN()?'The balance carried over from before the app. Each month’s contribution is added on top of it.':'ยอดสะสมเดิมก่อนใช้ระบบ · เงินสมทบของแต่ละเดือนจะบวกเพิ่มจากยอดนี้'}${s.ContributionAccum!=null&&s.ContributionAccum!==''?`<br>${EN()?'Running total now':'ยอดสะสมปัจจุบัน'}: <b>${baht(s.ContributionAccum)}</b>`:''}</small></div>
      <label class="field"><span>🔗 LINE ID ${s.LineUID?'✅':''}</span><input id="sf_LineUID" value="${esc(s.LineUID||'')}" placeholder="Uxxxxxxxxxxxxxxxx"/></label>
      <div class="card" style="background:var(--surface-2);padding:8px"><small class="muted">${EN()?'To let this staff log in: they open the app via LINE → "New user or already registered?" shows their LINE ID → paste it here and Save.':'ให้ครูเข้าแอปผ่าน LINE → หน้า "New user or already registered?" จะโชว์ LINE ID ของครู → คัดลอกมาวางช่องนี้แล้วกดบันทึก'}</small></div>
      ${photoField('sf_Photo',t('manage.photo'),s.Photo,true)}
      ${id?`<div class="card" style="background:var(--surface-2);padding:8px"><b style="font-size:13px">🔑 ${EN()?'Salary-slip password':'รหัสผ่าน (เปิดสลิปเงินเดือน)'}</b>
        <div class="row" style="margin-top:6px"><button type="button" class="btn sm outline" onclick="A_viewPw('${id}')">👁️ ${EN()?'View':'ดูรหัสผ่าน'}</button><button type="button" class="btn sm pink" onclick="A_resetPw('${id}')">♻️ ${EN()?'Reset':'รีเซ็ต'}</button></div>
        <div id="pwView_${id}" class="muted" style="font-size:13px;margin-top:6px"></div></div>`:''}
      <button class="btn block" onclick="A_saveStaff(this,'${id||''}')">${esc(t('c.save'))}</button>`);
  };
  window.A_saveStaff=async(btn,id)=>{ const m=btn.closest('.modal'); const v=k=>{ const e=m.querySelector('#sf_'+k); return e?e.value.trim():''; };
    // Department = the department(s) the staff is responsible for (multi). '*' = all (head teacher).
    const allDept=m.querySelector('#sf_AllDept')&&m.querySelector('#sf_AllDept').checked;
    const dept = allDept ? '*' : [...m.querySelectorAll('.sfDept:checked')].map(x=>x.value).join(',');
    const canOrg=m.querySelector('#sf_CanClassOrg')&&m.querySelector('#sf_CanClassOrg').checked;
    const canFood=m.querySelector('#sf_CanFoodMenu')&&m.querySelector('#sf_CanFoodMenu').checked;
    const data={NameTH:v('NameTH'),NameEN:v('NameEN'),Nickname:v('Nickname'),NicknameEN:v('NicknameEN'),DOB:v('DOB'),Position:v('Position'),Department:dept,StaffGroup:v('StaffGroup'),PositionLevel:v('PositionLevel'),Phone:v('Phone'),NationalID:v('NationalID'),LineUID:v('LineUID'),StartDate:v('StartDate'),BaseSalary:+v('BaseSalary')||0,BankName:v('BankName'),BankAccount:v('BankAccount'),ContributionOpening:+v('ContributionOpening')||0,ContributionLocked:(m.querySelector('#sf_ContributionLocked')&&m.querySelector('#sf_ContributionLocked').checked)?'YES':'',Classes:dept,CanClassOrg:canOrg?'YES':'',CanFoodMenu:canFood?'YES':''};
    data.Role=v('Role')||'Teacher';
    const sfp=photoVal(m,'sf_Photo'); if(sfp) data.Photo=sfp;
    try{ const r=await api('saveStaff',{staffId:id||null,data});
      // The diligence figures live with the rest of this person's pay settings (PAYROLL_CONFIG), which
      // is where the payroll screen already reads them from — one place, not two that can disagree.
      const sid=id||(r&&r.staffId);
      const att=m.querySelector('#sf_DiligenceAttendanceAmount'), fb=m.querySelector('#sf_DiligenceFacebookAmount');
      if(sid && att && fb && (att.value!==''||fb.value!=='')){
        const cur=await api('payrollConfig',{staffId:sid}).catch(()=>({}));
        await api('setPayrollConfig',{staffId:sid,config:Object.assign({},cur,{
          DiligenceAttendanceAmount: att.value===''?undefined:+att.value,
          DiligenceFacebookAmount:  fb.value===''?undefined:+fb.value })});
      }
      m.remove(); confirmSaved(t('c.saved')); GO('manage'); }catch(e){err(e);} };
  // Leaving is not deleting: the row stays so payroll and attendance history keep their meaning.
  window.A_staffEnd=async(id,btn)=>{ const m=btn.closest('.modal');
    const endDate=(m.querySelector('#sf_EndDate')||{}).value||'';
    const reason=(m.querySelector('#sf_EndReason')||{}).value||'';
    const remark=(m.querySelector('#sf_EndRemark')||{}).value||'';
    if(!endDate){ toast(EN()?'Pick the last working day':'กรุณาเลือกวันสิ้นสุดการทำงาน'); return; }
    if(!reason){ toast(EN()?'Pick a reason':'กรุณาเลือกเหตุผล'); return; }
    if(!confirm(EN()?'Remove this person from the active lists?':'ยืนยันนำชื่อออกจากรายชื่อที่ใช้งานอยู่?'))return;
    btn.disabled=true;
    try{ await api('setStaffEnd',{staffId:id,endDate,reason,remark,adminId:USER.staffId});
      m.remove(); confirmSaved(EN()?'Recorded — the record is kept':'บันทึกแล้ว — ข้อมูลยังเก็บไว้ครบ'); GO('manage');
    }catch(e){err(e); btn.disabled=false;} };
  window.A_staffReturn=async(id,btn)=>{ if(!confirm(EN()?'Bring this person back to the active lists?':'นำกลับเข้าทำงานและกลับไปอยู่ในรายชื่อ?'))return;
    btn.disabled=true; const m=btn.closest('.modal');
    try{ await api('setStaffEnd',{staffId:id,restore:true,adminId:USER.staffId});
      if(m)m.remove(); confirmSaved(EN()?'Back on the active list':'นำกลับเข้าทำงานแล้ว'); GO('manage');
    }catch(e){err(e); btn.disabled=false;} };
  window.SF_allDept=(cb)=>{ const box=document.getElementById('sf_DeptList'); if(box){ box.style.opacity=cb.checked?'.4':''; box.style.pointerEvents=cb.checked?'none':''; } };
  window.A_delStaff=(id,btn)=>{ if(!confirm(t('manage.confirmDel')))return;
    deleteWithUndo(EN()?'Staff removed':'ลบพนักงานแล้ว', ()=>api('deleteStaff',{staffId:id}).then(()=>GO('manage')), null, null, btn); };
  window.A_viewPw=async(id)=>{ const box=document.getElementById('pwView_'+id); try{ const r=await api('getStaffPassword',{staffId:id}); if(box)box.innerHTML=`${EN()?'Current password':'รหัสผ่านปัจจุบัน'}: <b>${esc(r.password)}</b>`; }catch(e){err(e);} };
  window.A_resetPw=async(id)=>{ if(!confirm(EN()?'Reset this staff\'s password? A temporary password will be shown.':'รีเซ็ตรหัสผ่านพนักงานคนนี้? ระบบจะแสดงรหัสชั่วคราว'))return;
    const box=document.getElementById('pwView_'+id); try{ const r=await api('adminResetPassword',{staffId:id}); if(box)box.innerHTML=`✅ ${EN()?'Reset. Temporary password':'รีเซ็ตแล้ว รหัสชั่วคราว'}: <b>${esc(r.tempPassword)}</b> — ${EN()?'staff must change it after unlocking':'พนักงานต้องเปลี่ยนใหม่หลังเข้าใช้'}`; toast(t('c.saved')); }catch(e){err(e);} };

  // ---- View-as: Admin previews the app as any role (stays logged in as admin; token is full-trust) ----
  let VIEW_AS_BACKUP=null;
  // Admin bypass: link a parent to a student on their behalf. It used to demand a LINE UID typed by
  // hand plus the student's National ID — neither of which an admin can look up in the app, so the tool
  // was effectively unusable. Now both sides are PICKED from a list and the UID is resolved server-side.
  window.A_linkParent=async(preSid)=>{ let students,parents;
    try{ [students,parents]=await Promise.all([api('listStudents'),api('listParents')]); }catch(e){ err(e); return; }
    const act=(students||[]).filter(s=>String(s.Status||'ACTIVE').toUpperCase()!=='WITHDRAWN');
    const sOpt=act.map(s=>`<option value="${esc(s.StudentID)}" ${preSid===s.StudentID?'selected':''}>${esc(dispNick(s))}${nmSub(s)?' · '+esc(nmSub(s)):''}${s.Class?' · '+esc(s.Class):''}</option>`).join('');
    // "(LINE)" tells the admin which parents can actually be given app access right now
    const pOpt=(parents||[]).map(p=>`<option value="${esc(p.ParentID)}" data-line="${p.LineUID?1:0}">${esc(titledName(p)||((EN()?'no name yet':'ยังไม่กรอกชื่อ')+' · '+p.ParentID))}${p.Phone?' · '+esc(phoneFmt(p.Phone)):''}${p.LineUID?' · LINE':''}</option>`).join('');
    modal(`<h3>🔗 ${EN()?'Link parent to student':'เชื่อมข้อมูลผู้ปกครองกับนักเรียน'}</h3>
    <p class="muted" style="font-size:13px">${EN()?'For a parent who cannot do it themselves — pick the child and the parent.':'สำหรับผู้ปกครองที่ทำเองไม่ได้ · เลือกนักเรียนและผู้ปกครองที่มีอยู่แล้วได้เลย'}</p>
    <label class="field"><span>${EN()?'Student':'นักเรียน'} <span style="color:var(--bad)">*</span></span><select id="lp_sid">${sOpt}</select></label>
    <label class="field"><span>${EN()?'Parent':'ผู้ปกครอง'}</span><select id="lp_pid" onchange="A_lpPick()"><option value="">— ${EN()?'new parent (fill in below)':'ผู้ปกครองใหม่ (กรอกด้านล่าง)'} —</option>${pOpt}</select></label>
    <p id="lp_hint" class="muted" style="font-size:13px"></p>
    <div id="lp_new">
      <div class="grid2"><label class="field"><span>${EN()?'Full name':'ชื่อ-นามสกุล'}</span><input id="lp_name"/></label><label class="field"><span>${EN()?'Nickname':'ชื่อเล่น'}</span><input id="lp_nick"/></label></div>
      <div class="grid2"><label class="field"><span>${EN()?'Phone':'เบอร์โทร'}</span><input id="lp_phone" inputmode="tel"/></label>
        <label class="field"><span>${EN()?'Relationship':'ความสัมพันธ์'}</span><select id="lp_rel"><option value="">—</option><option value="บิดา">${EN()?'Father':'บิดา'}</option><option value="มารดา">${EN()?'Mother':'มารดา'}</option><option value="ผู้ปกครอง">${EN()?'Guardian':'ผู้ปกครอง'}</option></select></label></div>
    </div>
    <details style="margin:6px 0"><summary class="muted" style="font-size:13px">${EN()?'Advanced: enter a LINE UID':'ขั้นสูง: ระบุ LINE UID เอง'}</summary>
      <label class="field"><span>LINE UID</span><input id="lp_uid" placeholder="U1234abcd…"/></label>
      <small class="muted" style="font-size:13px">${EN()?'Only needed when the parent already uses LINE but has no record here yet.':'ใช้เมื่อผู้ปกครองมี LINE แล้วแต่ยังไม่มีข้อมูลในระบบ'}</small></details>
    <button class="btn block" onclick="A_linkParentDo(this)">🔗 ${EN()?'Link':'เชื่อมข้อมูล'}</button>
    <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
    A_lpPick(); };
  // hide the "new parent" fields once an existing parent is picked, and say what the link will actually do
  window.A_lpPick=()=>{ const sel=document.getElementById('lp_pid'); if(!sel)return;
    const box=document.getElementById('lp_new'), hint=document.getElementById('lp_hint');
    const picked=!!sel.value, hasLine=picked&&sel.selectedOptions[0].dataset.line==='1';
    if(box) box.hidden=picked;
    if(hint) hint.innerHTML = !picked ? (EN()?'A new parent record will be created.':'จะสร้างข้อมูลผู้ปกครองใหม่')
      : hasLine ? '✅ '+(EN()?'This parent uses LINE — they will see the child right after this.':'ผู้ปกครองรายนี้ใช้ LINE อยู่แล้ว · จะเห็นข้อมูลนักเรียนทันทีหลังเชื่อม')
      : '⚠️ '+(EN()?'This parent has never signed in with LINE. The link is recorded, but they still have to sign in with LINE once before they can see anything.':'ผู้ปกครองรายนี้ยังไม่เคยเข้าใช้งานด้วย LINE · ระบบจะบันทึกความสัมพันธ์ไว้ แต่ผู้ปกครองต้องเข้าสู่ระบบด้วย LINE เองหนึ่งครั้งจึงจะเห็นข้อมูล'); };
  window.A_linkParentDo=async(btn)=>{ const m=btn.closest('.modal'); const g=x=>{const e=m.querySelector('#'+x);return e?e.value.trim():'';};
    const sid=g('lp_sid'), pid=g('lp_pid'), uid=g('lp_uid');
    if(!sid){ toast(EN()?'Pick a student':'ต้องเลือกนักเรียน'); return; }
    const data=pid?{}:{NameTH:g('lp_name'),Nickname:g('lp_nick'),Phone:g('lp_phone'),Relationship:g('lp_rel')};
    if(!pid&&!uid&&!data.NameTH&&!data.Phone){ toast(EN()?'Pick a parent, or fill in the new one':'เลือกผู้ปกครอง หรือกรอกข้อมูลผู้ปกครองใหม่'); return; }
    btn.disabled=true;
    try{ const r=await api('linkParentAdmin',{studentId:sid,parentId:pid||undefined,uid:uid||undefined,data,adminId:USER.staffId}); m.remove();
      confirmSaved((EN()?'Linked to ':'เชื่อมกับ ')+(r.nick||r.name||r.studentId)+(r.via==='legacy'?(EN()?' — parent must sign in with LINE once':' — ผู้ปกครองต้องเข้าสู่ระบบด้วย LINE เองหนึ่งครั้ง'):'')); }
    catch(e){ err(e); btn.disabled=false; } };
  // How the school actually refers to a parent: "คุณแม่น้องบีม" / "Beam's mom" (+N for extra children).
  // Built for an explicit language rather than reusing parentDisp(), so both nameTH and nameEN can be
  // stored on the view-as USER and the header/bar keep working when the language is toggled.
  function vaLabel(p, en){
    const kids=(window._PKIDS||{})[p.ParentID]||[];
    const own=(en?(p.NameEN||p.NameTH):(p.NameTH||p.NameEN))||p.ParentID;
    if(!kids.length) return own;
    const k=kids[0];
    const kn=(en?(k.NicknameEN||k.Nickname||k.NameEN||k.NameTH):(k.Nickname||k.NicknameEN||k.NameTH||k.NameEN))||'';
    if(!kn) return own;
    const rel=String(p.Relationship||''), ti=String(p.Title||'');
    const dad=REL_DAD.test(rel)||REL_DAD.test(ti), mom=REL_MOM.test(rel)||REL_MOM.test(ti);
    const base=en ? `${kn}'s ${dad?'dad':mom?'mom':'parent'}`
                  : `${dad?'คุณพ่อน้อง':mom?'คุณแม่น้อง':'ผู้ปกครองน้อง'}${kn}`;
    return kids.length>1 ? base+' +'+(kids.length-1) : base;
  }
  window.A_viewAs=async()=>{
    // the lists are normally cached by manage(); fetch them so View-As works straight from home
    const need=[];
    if(!(A_CACHE.staff&&A_CACHE.staff.length)) need.push(api('listStaff').then(r=>A_CACHE.staff=r||A_CACHE.staff));
    if(!(A_CACHE.parents&&A_CACHE.parents.length)) need.push(api('listParents').then(r=>A_CACHE.parents=r||A_CACHE.parents));
    if(!(window._LINKCOUNTS&&Object.keys(window._LINKCOUNTS).length)) need.push(api('parentLinkCounts').then(r=>window._LINKCOUNTS=r||{}).catch(()=>{}));
    // children per parent, so this list can name people the way the school does: คุณแม่น้อง<ชื่อเล่น>
    if(!(window._PKIDS&&Object.keys(window._PKIDS).length)) need.push(api('parentKidsMap').then(r=>window._PKIDS=r||{}).catch(()=>{}));
    if(need.length){ try{ await Promise.all(need); }catch(e){} }
    // parents WITH ≥1 linked child (so the multi-child view is meaningful) sorted by count desc
    // alphabetical, but families WITH a linked child first — picking someone with no child
    // opens an empty view, so those stay at the bottom rather than scattered through the list
    const cnt=window._LINKCOUNTS||{};
    const paList=sortBy(A_CACHE.parents||[], p=>vaLabel(p,EN())).sort((a,b)=>((cnt[b.ParentID]||0)>0?1:0)-((cnt[a.ParentID]||0)>0?1:0));
    modal(`<h3>👁️ ${EN()?'View as role':'ดูในมุมมอง (สลับ Role)'}</h3>
    <p class="muted" style="font-size:13px">${EN()?'Preview the app exactly as this person sees it. You stay logged in as admin — tap "Back to Admin" to return.':'ดูแอปแบบที่คน ๆ นั้นเห็นจริง (ยังเป็นแอดมินอยู่) — กด "กลับเป็น Admin" เพื่อกลับ'}</p>
    <label class="field"><span>👩‍🏫 ${EN()?'As teacher / leader':'มุมมองครู / หัวหน้า'}</span><select id="va_staff"><option value="">—</option>${(A_CACHE.staff||[]).filter(s=>s.Role!=='Admin').map(s=>`<option value="${s.StaffID}">${esc(nmn(s))} · ${esc(String(s.Role||'')==='Observer'?(EN()?'Observer — view only':'ผู้ตรวจสอบ (ดูอย่างเดียว)'):(s.PositionLevel||''))}</option>`).join('')}</select></label>
    <button class="btn block" onclick="A_viewAsStaff(this)">${EN()?'View as this staff':'ดูมุมมองครูคนนี้'}</button>
    <div style="height:12px"></div>
    <label class="field"><span>👪 ${EN()?'As parent (all their children)':'มุมมองผู้ปกครอง (เห็นลูกทุกคนที่ผูก)'}</span><select id="va_parent"><option value="">—</option>${paList.map(p=>`<option value="${esc(p.ParentID)}">${esc(vaLabel(p,EN()))}${p.Phone?' · '+esc(phoneFmt(p.Phone)):''} · 👶 ${cnt[p.ParentID]||0}</option>`).join('')}</select></label>
    <button class="btn block outline" onclick="A_viewAsParent(this)">${EN()?'View as this parent':'ดูมุมมองผู้ปกครองคนนี้'}</button>`); };
  window.A_viewAsStaff=(btn)=>{ const m=btn.closest('.modal'); const sid=m.querySelector('#va_staff').value; if(!sid){toast(EN()?'Pick a staff':'เลือกครูก่อน');return;} const s=findStaff(sid); m.remove();
    // Preview the person's OWN role. This said 'Teacher' for everybody, so previewing an Observer
    // showed the teacher screens — the very thing the preview exists to check. Their real role is on
    // their staff record; anything that is not an Observer previews as a teacher exactly as before.
    const role = String(s.Role||'')==='Observer' ? 'Observer' : 'Teacher';
    _enterViewAs({role, _roleKey:(role==='Observer'?'Observer':(s.PositionLevel==='Leader'?'Leader':'Teacher')),
      staffId:sid,nameEN:s.NameEN||s.NameTH||sid,nameTH:s.NameTH||sid}); };
  window.A_viewAsParent=(btn)=>{ const m=btn.closest('.modal'); const pid=m.querySelector('#va_parent').value; if(!pid){toast(EN()?'Pick a parent':'เลือกผู้ปกครองก่อน');return;}
    const p=(A_CACHE.parents||[]).find(x=>String(x.ParentID)===String(pid))||{}; m.remove();
    // uid = their LINE UID so visibleStudents returns EVERY linked child (multi-child view); parentId for legacy links
    _enterViewAs({role:'Parent',_roleKey:'Parent',parentId:pid,uid:p.LineUID||pid,nameEN:vaLabel(p,true),nameTH:vaLabel(p,false)}); };
  function _enterViewAs(ctx){ if(!VIEW_AS_BACKUP) VIEW_AS_BACKUP=USER; USER=Object.assign({_viewAs:true},ctx); setHeader(); GO('home'); _viewAsBar(); }
  window.A_exitViewAs=()=>{ if(VIEW_AS_BACKUP){ USER=VIEW_AS_BACKUP; VIEW_AS_BACKUP=null; } const b=document.getElementById('viewAsBar'); if(b)b.remove(); document.body.classList.remove('viewas'); setHeader(); GO('home'); };
  // Sits directly under the header, not above the bottom nav. Anchored to the bottom it covered
  // whatever the screen put there — the nav, and now the sticky save bar on the long forms.
  function _viewAsBar(){ let b=document.getElementById('viewAsBar'); if(!b){ b=document.createElement('div'); b.id='viewAsBar'; document.body.appendChild(b); }
    const hd=document.querySelector('.topbar');
    b.style.top=((hd?hd.getBoundingClientRect().height:56))+'px';
    document.body.classList.add('viewas');   // gives <main> matching top padding
    b.innerHTML=`<span>👁️ ${EN()?'Viewing as':'กำลังดูมุมมอง'}: <b>${esc(EN()?USER.nameEN:USER.nameTH)}</b>${USER.role==='Observer'?` · ${EN()?'view only':'ดูอย่างเดียว'}`:''}</span><button onclick="A_exitViewAs()">${EN()?'Back to Admin':'กลับเป็น Admin'}</button>`; }

  // ---- Parent CRUD ----
  window.A_parentForm=(id)=>{ const p=id?findParent(id):{};
    const f=(k,label,val)=>`<label class="field"><span>${esc(label)}</span><input id="pf_${k}" value="${esc(val!=null?val:'')}"/></label>`;
    modal(`<h3>${id?'✏️':'➕'} ${esc(t('manage.parents'))}</h3>
      <div class="grid2"><label class="field"><span>${esc(t('reg.title'))}</span><select id="pf_Title">${['','นาย','นาง','นางสาว'].map(x=>`<option value="${x}" ${(p.Title||titleOf(p))===x?'selected':''}>${EN()?({'':'','นาย':'Mr.','นาง':'Mrs.','นางสาว':'Ms.'})[x]:x}</option>`).join('')}</select></label>${f('NameTH',t('reg.nameTH'),p.NameTH)}</div>
      <div class="grid2">${f('NameEN',t('reg.nameEN'),p.NameEN)}${f('Nickname',t('reg.nickname'),p.Nickname)}</div>
      <div class="grid2">${f('NicknameEN',t('reg.nicknameEN'),p.NicknameEN)}${f('Relationship',t('reg.relationship'),p.Relationship)}</div>
      <div class="grid2">${f('NationalID',t('reg.nationalIdParent'),p.NationalID)}</div>
      <div class="grid2">${f('Phone',t('reg.mobile'),phoneFmt(p.Phone))}${f('OfficePhone',t('reg.officePhone'),phoneFmt(p.OfficePhone))}</div>
      <div class="grid2">${f('Occupation',t('reg.occupation'),p.Occupation)}${f('Workplace',t('reg.workplace'),p.Workplace)}</div>
      <label class="field"><span>🔗 LINE ID ${p.LineUID?'✅':''}</span><input id="pf_LineUID" value="${esc(p.LineUID||'')}" placeholder="Uxxxxxxxxxxxxxxxx"/></label>
      <div class="card" style="background:var(--surface-2);padding:8px"><small class="muted">${EN()?'This is what ties the account to their LINE. If they change phone or LINE account, have them open the app once — the sign-in screen shows their new LINE ID — then paste it here and Save. Nothing else has to be re-entered.':'ช่องนี้คือสิ่งที่ผูกบัญชีเข้ากับ LINE ของผู้ปกครอง · หากเปลี่ยนเครื่องหรือเปลี่ยนบัญชี LINE ให้เปิดแอปหนึ่งครั้ง หน้าเข้าสู่ระบบจะแสดง LINE ID ใหม่ → คัดลอกมาวางช่องนี้แล้วกดบันทึก ข้อมูลอื่นไม่ต้องกรอกใหม่'}</small></div>
      ${photoField('pf_Photo',t('reg.parentPhoto'),p.Photo,true)}
      ${id?`<button class="btn block outline" onclick="this.closest('.modal').remove();A_payLog('${esc(id)}')">🧾 ${EN()?'Payment history':'ประวัติการชำระเงิน'}</button>`:''}
      <button class="btn block" onclick="A_saveParent(this,'${id||''}')">${esc(t('c.save'))}</button>`);
  };

  // ---- Payment history (Data Log) --------------------------------------------------------------
  // Every amount that came in for this family: when, for what, how much, and the slip. Tapping a row
  // opens the slip. Built from PAYMENT_SLIPS plus anything settled in cash (which leaves no slip).
  window.A_payLog=async(parentId, studentId)=>{
    // Admin passes a parentId (or a studentId); a parent calls it with neither and gets their own
    // children — parentScope() carries the uid/parentId the engine resolves links from, and on GAS the
    // route overwrites it from the session anyway, so a parent can never widen the scope.
    const q = studentId ? {studentId} : (parentId ? {parentId} : parentScope());
    let d=null; try{ d=await api('paymentLog',q); }catch(e){ err(e); return; }
    const kindIcon={bill:'🏫',prepay:'💰',ot:'⏰',charge:'🧾'};
    const stat=s=>s==='CONFIRMED'?['ok',EN()?'confirmed':'ตรวจแล้ว']:s==='SUBMITTED'?['wait',EN()?'awaiting check':'รอตรวจสอบ']:['bad',EN()?'rejected':'ไม่ผ่าน'];
    const rows=(d.entries||[]).map((e,i)=>{ const [cls,lbl]=stat(e.status);
      return `<div class="list-item stack" ${e.slipUrl?`onclick="ZOOM_IMG('${esc(e.slipUrl)}')" style="cursor:zoom-in"`:''}>
        <span><b>${kindIcon[e.refKind]||'💳'} ${esc(e.label)}</b>${e.month?` <small class="muted">${esc(monthNameYear(e.month))}</small>`:''}<br>
          <small class="muted">${esc(dispNick({Nickname:e.nick,NameTH:e.name})||e.studentId)} · ${esc(e.date?fullDate(e.date):'-')}${e.transTime?' '+esc(e.transTime)+(EN()?'':' น.'):''}${e.transRef?' · '+esc(e.transRef):''}${e.via==='cash'?' · '+(EN()?'cash':'เงินสด'):''}</small></span>
        <span style="text-align:right"><b>${baht(e.amount)}</b><br><span class="pill ${cls}" style="font-size:11px">${esc(lbl)}</span>${e.slipUrl?' 📎':''}</span></div>`; }).join('');
    modal(`<h3>🧾 ${EN()?'Payment history':'ประวัติการชำระเงิน'}</h3>
      <p class="muted" style="font-size:13px">${(d.students||[]).map(s=>esc(s.nick||s.name||s.studentId)).join(' · ')||'-'}</p>
      <div class="grid2">
        <div class="card" style="padding:8px;text-align:center"><small class="muted">${EN()?'Confirmed':'ตรวจสอบแล้ว'}</small><br><b style="color:var(--ok);font-size:18px">${baht(d.totalConfirmed)}</b></div>
        <div class="card" style="padding:8px;text-align:center"><small class="muted">${EN()?'Awaiting check':'รอตรวจสอบ'}</small><br><b style="color:var(--warn);font-size:18px">${baht(d.totalPending)}</b></div></div>
      <div style="max-height:56vh;overflow:auto">${rows||`<div class="card muted">${EN()?'No payments recorded yet':'ยังไม่มีรายการชำระเงิน'}</div>`}</div>
      <p class="muted" style="font-size:13px">${EN()?'Tap a row with 📎 to see the slip.':'แตะรายการที่มี 📎 เพื่อดูสลิป'}</p>
      <button class="btn outline block" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_saveParent=async(btn,id)=>{ const m=btn.closest('.modal'); const v=k=>{ const e=m.querySelector('#pf_'+k); return e?e.value.trim():''; };
    const data={Title:v('Title'),NameTH:v('NameTH'),NameEN:v('NameEN'),Nickname:v('Nickname'),NicknameEN:v('NicknameEN'),Relationship:v('Relationship'),NationalID:v('NationalID'),Phone:v('Phone'),OfficePhone:v('OfficePhone'),Occupation:v('Occupation'),Workplace:v('Workplace'),LineUID:v('LineUID')};
    const pfp=photoVal(m,'pf_Photo'); if(pfp) data.Photo=pfp;
    try{ await api('saveParent',{parentId:id||null,data}); m.remove(); confirmSaved(t('c.saved')); GO('manage'); }catch(e){err(e);} };
  window.A_delParent=(id,btn)=>{ if(!confirm(t('manage.confirmDel')))return;
    deleteWithUndo(EN()?'Parent removed':'ลบผู้ปกครองแล้ว', ()=>api('deleteParent',{parentId:id}).then(()=>GO('manage')), null, null, btn); };

  // ---- Student edit (incl. insurance) ----
  // choosing a package fills the arrive/leave time from the package's schedule (still editable per student)
  window.A_planFill=(sel)=>{ setTimeout(()=>{ if(window.A_prorateHint) A_prorateHint(); },0);   // price changed → first-month figure changes
    const pl=A_plans().find(p=>p.id===sel.value); if(!pl)return;
    const st=document.getElementById('stf_StartTime'), en=document.getElementById('stf_EndTime');
    if(st && pl.start) st.value=String(pl.start).slice(0,5);
    if(en && pl.end) en.value=String(pl.end).slice(0,5); };

  // ---- Package (Plan) CRUD: name / price / study time. Persists the whole list via savePlans. ----
  window.A_packages=async()=>{ const [plans,qr]=await Promise.all([api('getPlans'),api('getQRCodes').catch(()=>({qrs:[],otQrId:''}))]); A_CACHE.plans=plans||[]; window._QR=qr||{qrs:[],otQrId:''};
    const qrName=id=>{ const q=(window._QR.qrs||[]).find(x=>x.id===id); return q?q.name:''; };
    const row=p=>`<div class="card" style="padding:8px"><div class="spread"><b>${esc(EN()?(p.labelEN||p.labelTH):(p.labelTH||p.labelEN))||p.id}</b><b style="color:var(--blue)">${baht(p.price)}</b></div>
      <small class="muted">🕗 ${esc(p.start||'-')} – ${esc(p.end||'-')} น.${p.qrId?` · 🏦 ${esc(qrName(p.qrId))||'QR'}`:''}</small>
      <div class="row" style="margin-top:6px"><button class="btn sm outline" onclick="A_pkgForm('${esc(p.id)}')">✏️ ${EN()?'Edit':'แก้ไข'}</button><button class="btn sm pink" onclick="A_pkgDelete('${esc(p.id)}')">🗑️ ${EN()?'Delete':'ลบ'}</button></div></div>`;
    modal(`<div class="spread"><h3>📦 ${EN()?'Packages / prepay discounts':'แพ็กเกจ / ส่วนลดชำระล่วงหน้า'}</h3><span class="row"><button class="btn sm outline" onclick="A_prepayTiers()">💰 ${EN()?'Advance-payment discounts':'ส่วนลดชำระล่วงหน้า'}</button><button class="btn sm outline" onclick="A_qrCodes()">🏦 ${EN()?'QR accounts':'QR/บัญชี'}</button><button class="btn sm" onclick="A_pkgForm()">+ ${esc(t('manage.add'))}</button></span></div>
      <p class="muted" style="font-size:13px">${EN()?'Name, price and study time per package. The time auto-fills a student’s arrive/leave time when you assign the package (still editable).':'ตั้งชื่อ ราคา และช่วงเวลาเรียนของแต่ละแพ็กเกจ · เวลาจะถูกนำไปใส่ให้นักเรียนอัตโนมัติเมื่อเลือกแพ็กเกจ (แก้ไขรายคนได้)'}</p>
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
      <label class="field"><span>🏦 ${EN()?'Bank QR / account for tuition':'QR/บัญชีธนาคารสำหรับค่าเทอม'}</span><select id="pk_qr"><option value="">${EN()?'(default account)':'(บัญชีเริ่มต้น)'}</option>${(window._QR&&window._QR.qrs||[]).map(q=>`<option value="${esc(q.id)}" ${p.qrId===q.id?'selected':''}>${esc(q.name)}</option>`).join('')}</select></label>
      <button class="btn block" onclick="A_pkgSave(this,'${id||''}')">${esc(t('c.save'))}</button>`);
  };
  window.A_pkgSave=async(btn,id)=>{ const m=btn.closest('.modal'); const v=s=>{ const e=m.querySelector(s); return e?e.value.trim():''; };
    const th=v('#pk_th'), en=v('#pk_en'); if(!th&&!en){ toast(EN()?'Enter a name':'ใส่ชื่อแพ็กเกจ'); return; }
    const rec={ id:id||undefined, labelTH:th||en, labelEN:en||th, price:Number(v('#pk_price'))||0, start:v('#pk_start'), end:v('#pk_end'), qrId:v('#pk_qr') };
    const plans=(A_CACHE.plans||[]).slice();
    if(id){ const i=plans.findIndex(x=>x.id===id); if(i>=0) plans[i]=Object.assign({},plans[i],rec); else plans.push(rec); }
    else plans.push(rec);
    try{ const r=await api('savePlans',{plans}); A_CACHE.plans=r.plans||plans; MOCK.config.Plans=A_CACHE.plans; m.remove(); confirmSaved(t('c.saved')); A_packages(); }catch(e){err(e);} };
  window.A_pkgDelete=async(id)=>{ if(!confirm(EN()?'Delete this package? Students already on it keep their saved time.':'ลบแพ็กเกจนี้? นักเรียนที่ใช้อยู่จะยังคงเวลาที่บันทึกไว้'))return;
    const plans=(A_CACHE.plans||[]).filter(x=>x.id!==id);
    try{ const r=await api('savePlans',{plans}); A_CACHE.plans=r.plans||plans; MOCK.config.Plans=A_CACHE.plans; toast(t('manage.deleted')); const m=document.querySelector('.modal'); if(m)m.remove(); A_packages(); }catch(e){err(e);} };
  // ---- Advance-tuition (ชำระล่วงหน้า) discount tiers — school pricing, edited beside the packages ----
  // Was hard-coded in two places (engine + this file). Now one saved table drives both, and a preview
  // against the largest package price shows what a parent will actually be charged.
  let PP_TIERS=[];
  window.A_prepayTiers=async()=>{ PP_TIERS=(await api('prepayTiers').catch(()=>[])).map(t=>({months:Number(t.months)||0,discount:Number(t.discount)||0}));
    if(!PP_TIERS.length) PP_TIERS=[{months:3,discount:5},{months:6,discount:10},{months:12,discount:15}];
    const prices=(A_CACHE.plans||[]).map(p=>Number(p.price)||0).filter(Boolean);
    window._PP_PREVIEW=prices.length?Math.max.apply(null,prices):0;
    modal(`<div class="spread"><h3>💰 ${EN()?'Advance-payment discounts':'ส่วนลดชำระล่วงหน้า'}</h3><button class="btn sm" onclick="A_ppAdd()">+ ${esc(t('manage.add'))}</button></div>
      <p class="muted" style="font-size:13px">${EN()?'Pay several months up front, get a discount. These tiers are what parents see; an Admin can still agree a one-off rate for a single family.':'ชำระล่วงหน้าหลายเดือนแล้วได้ส่วนลด · ระดับเหล่านี้คือที่ผู้ปกครองเห็น · แอดมินยังตกลงเรตพิเศษเฉพาะรายได้'}</p>
      <div id="ppList"></div>
      <button class="btn block" style="margin-top:8px" onclick="A_ppSave(this)">${esc(t('c.save'))}</button>`);
    A_ppRender(); };
  function A_ppRender(){ const box=$('#ppList'); if(!box)return;
    const price=Number(window._PP_PREVIEW||0);
    box.innerHTML=PP_TIERS.map((t,i)=>{ const gross=price*t.months, amt=Math.round(gross*(100-t.discount)/100);
      return `<div class="card" style="padding:8px;margin-bottom:6px"><div class="grid3" style="grid-template-columns:1fr 1fr 36px;gap:6px">
        <label class="field" style="margin:0"><span>${EN()?'Months':'จำนวนเดือน'}</span><input type="number" min="1" value="${t.months}" oninput="PP_SET(${i},'months',this.value)"/></label>
        <label class="field" style="margin:0"><span>${EN()?'Discount (%)':'ส่วนลด (%)'}</span><input type="number" min="0" max="100" value="${t.discount}" oninput="PP_SET(${i},'discount',this.value)"/></label>
        <button class="btn sm pink" style="align-self:end" onclick="A_ppDel(${i})" aria-label="${EN()?'Delete':'ลบ'}">✕</button></div>
        ${price>0?`<small class="muted">${EN()?'e.g.':'ตัวอย่าง'} ${baht(price)}/${EN()?'mo':'เดือน'} → ${baht(gross)} ${EN()?'becomes':'เหลือ'} <b>${baht(amt)}</b> (${EN()?'save':'ประหยัด'} ${baht(gross-amt)})</small>`:''}</div>`;
    }).join('')||`<small class="muted">${EN()?'No tiers — parents cannot pay in advance.':'ยังไม่มีระดับส่วนลด — ผู้ปกครองจะชำระล่วงหน้าไม่ได้'}</small>`; }
  window.PP_SET=(i,k,v)=>{ PP_TIERS[i][k]=Number(v)||0; if(k==='discount')A_ppRender(); };
  window.A_ppAdd=()=>{ PP_TIERS.push({months:0,discount:0}); A_ppRender(); };
  window.A_ppDel=(i)=>{ PP_TIERS.splice(i,1); A_ppRender(); };
  window.A_ppSave=async(btn)=>{ const tiers=PP_TIERS.filter(t=>t.months>0);
    if(!tiers.length){ toast(EN()?'Add at least one tier':'ต้องมีอย่างน้อย 1 ระดับ'); return; }
    try{ const r=await api('savePrepayTiers',{tiers,staffId:USER.staffId}); MOCK.config.PrepayTiers=r.tiers||tiers;
      const m=btn.closest('.modal'); if(m)m.remove(); confirmSaved(t('c.saved')); }catch(e){err(e);} };

  // ---- QR-code MASTER: bank QR images bound per package (tuition) / OT, so fees go to different accounts ----
  window.A_qrCodes=async()=>{ const qr=await api('getQRCodes').catch(()=>({qrs:[],otQrId:''})); window._QR=qr||{qrs:[],otQrId:''};
    const rows=(window._QR.qrs||[]).map(q=>`<div class="card" style="padding:8px"><div class="spread"><b>${esc(q.name)}</b><button class="btn sm pink" onclick="A_qrDel('${esc(q.id)}')">🗑️ ${EN()?'Delete':'ลบ'}</button></div>${q.image?`<div style="text-align:center"><img src="${esc(q.image)}" style="max-height:120px;border-radius:8px;margin-top:6px;cursor:zoom-in" onclick="ZOOM_IMG('${esc(q.image)}')"/></div>`:''}</div>`).join('')||`<small class="muted">${EN()?'No QR accounts yet':'ยังไม่มี QR/บัญชี'}</small>`;
    modal(`<div class="spread"><h3>🏦 ${EN()?'QR accounts (master)':'QR/บัญชีธนาคาร'}</h3><button class="btn sm" onclick="A_qrAdd()">+ ${esc(t('manage.add'))}</button></div>
      <p class="muted" style="font-size:13px">${EN()?'Add bank QR images, then bind them per package (tuition) and for OT — so different fees go to different accounts.':'เพิ่ม QR ธนาคารได้หลายบัญชี แล้วผูกกับแต่ละแพ็กเกจ (ค่าเทอม) และ OT เพื่อแยกเงินเข้าคนละบัญชี'}</p>
      <div style="max-height:44vh;overflow:auto">${rows}</div>
      <label class="field" style="margin-top:10px"><span>⏰ ${EN()?'QR / account for OT payments':'QR/บัญชีสำหรับชำระ OT'}</span><select id="qr_ot"><option value="">${EN()?'(default account)':'(บัญชีเริ่มต้น)'}</option>${(window._QR.qrs||[]).map(q=>`<option value="${esc(q.id)}" ${window._QR.otQrId===q.id?'selected':''}>${esc(q.name)}</option>`).join('')}</select></label>
      <button class="btn block" onclick="A_qrSaveOt(this)">💾 ${EN()?'Save OT account':'บันทึกบัญชี OT'}</button>
      <button class="btn outline block" style="margin-top:8px" onclick="A_packages()">← ${EN()?'Packages':'แพ็กเกจ'}</button>`);
  };
  window.A_qrAdd=()=>{ modal(`<h3>🏦 ${EN()?'Add QR account':'เพิ่ม QR/บัญชี'}</h3>
    <label class="field"><span>${EN()?'Account name':'ชื่อบัญชี'}</span><input id="qr_name" placeholder="${EN()?'e.g. SCB — tuition':'เช่น SCB — ค่าเทอม'}"/></label>
    ${photoField('qr_img',EN()?'QR image':'รูป QR',null,false)}
    <button class="btn block" onclick="A_qrAddDo(this)">${esc(t('c.save'))}</button>`); };
  window.A_qrAddDo=async(btn)=>{ const m=btn.closest('.modal'); const name=(m.querySelector('#qr_name').value||'').trim(); const img=photoVal(m,'qr_img');
    if(!name){ toast(EN()?'Enter a name':'ใส่ชื่อบัญชี'); return; } if(!img){ toast(EN()?'Add the QR image':'แนบรูป QR'); return; }
    const qrs=(window._QR.qrs||[]).slice(); qrs.push({name,image:img});
    btn.disabled=true; try{ const r=await api('saveQRCodes',{qrs,otQrId:window._QR.otQrId||''}); window._QR=r; m.remove(); confirmSaved(t('c.saved')); A_qrCodes(); }catch(e){err(e);btn.disabled=false;} };
  window.A_qrDel=async(id)=>{ if(!confirm(EN()?'Delete this QR account?':'ลบ QR/บัญชีนี้?'))return; const qrs=(window._QR.qrs||[]).filter(q=>q.id!==id);
    const otQrId=window._QR.otQrId===id?'':window._QR.otQrId; try{ const r=await api('saveQRCodes',{qrs,otQrId}); window._QR=r; const m=document.querySelector('.modal'); if(m)m.remove(); A_qrCodes(); }catch(e){err(e);} };
  window.A_qrSaveOt=async(btn)=>{ const m=btn.closest('.modal'); const otQrId=m.querySelector('#qr_ot').value; try{ const r=await api('saveQRCodes',{qrs:window._QR.qrs||[],otQrId}); window._QR=r; confirmSaved(t('c.saved')); }catch(e){err(e);} };

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
      <div class="grid2"><label class="field"><span>🏷️ ${EN()?'Monthly discount (hidden from parent)':'ส่วนลดรายเดือน (ไม่แสดงให้ผู้ปกครอง)'}</span><input id="stf_DiscountAmount" type="number" min="0" value="${esc(s.DiscountAmount!=null&&s.DiscountAmount!==''?s.DiscountAmount:'')}" placeholder="0"/></label>
        <label class="field"><span>${EN()?'Unit':'หน่วย'}</span><select id="stf_DiscountUnit"><option value="บาท" ${(s.DiscountUnit||'บาท')!=='%'?'selected':''}>${EN()?'THB':'บาท'}</option><option value="%" ${s.DiscountUnit==='%'?'selected':''}>%</option></select></label></div>
      <small class="muted" style="display:block;margin:-2px 0 6px">${EN()?'Deducted silently from monthly tuition when a bill is issued — the parent only sees the reduced total.':'หักออกจากค่าเทอมรายเดือนตอนออกบิลโดยอัตโนมัติ · ผู้ปกครองเห็นแค่ยอดสุทธิ ไม่เห็นส่วนลด'}</small>
      <div class="grid2"><label class="field"><span>📅 ${EN()?'First day at school':'วันเริ่มเรียนจริง'}</span>
          <input id="stf_EnrollDate" type="date" value="${esc(String(s.EnrollDate||'').slice(0,10))}" onchange="A_prorateHint()"/></label>
        <label class="field"><span>${EN()?'Charge for the starting month':'คิดค่าเทอมเดือนที่เริ่ม'}</span>
          <select id="stf_ProrateMode" onchange="A_prorateHint()">
            <option value="FULL" ${(s.ProrateMode||'FULL')==='FULL'?'selected':''}>${EN()?'Full month':'เต็มเดือน'}</option>
            <option value="HALF" ${s.ProrateMode==='HALF'?'selected':''}>${EN()?'Half month':'ครึ่งเดือน'}</option>
            <option value="DAILY" ${s.ProrateMode==='DAILY'?'selected':''}>${EN()?'Pro-rata by day':'เฉลี่ยตามวัน'}</option>
            <option value="MANUAL" ${s.ProrateMode==='MANUAL'?'selected':''}>${EN()?'Set the amount myself':'กำหนดยอดเอง'}</option>
          </select></label></div>
      <label class="field" id="prorateAmtBox" ${s.ProrateMode==='MANUAL'?'':'hidden'}><span>${EN()?'Amount for the starting month (฿)':'ยอดของเดือนที่เริ่มเรียน (฿)'}</span>
        <input id="stf_ProrateAmount" type="number" min="0" value="${esc(s.ProrateAmount!=null&&s.ProrateAmount!==''?s.ProrateAmount:'')}" oninput="A_prorateHint()"/></label>
      <small class="muted" id="prorateHint" style="display:block;margin:-2px 0 6px"></small>
      <hr style="border:none;border-top:1px solid var(--line);margin:8px 0">
      <label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="stf_Ins" ${s.InsuranceHas?'checked':''} style="width:auto" onchange="document.getElementById('insBox').hidden=!this.checked"/> 🛡️ ${esc(t('ins.has'))}</label>
      <div id="insBox" ${s.InsuranceHas?'':'hidden'}>
        <div class="grid2">${f('InsurancePolicyNo',t('ins.policy'),s.InsurancePolicyNo)}${f('InsuranceCompany',t('ins.company'),s.InsuranceCompany)}</div>
        ${f('InsuranceExpiry',t('ins.expiry'),s.InsuranceExpiry,'date')}
        ${photoField('stf_InsCard',t('ins.card'),s.InsuranceCardImage,false)}</div>
      ${s.DriveFolderUrl?`<div class="card" style="background:var(--surface-2);padding:8px"><small class="muted">📁 ${esc(t('folder.student'))}<br><code style="font-size:13px">${esc(s.DriveFolderUrl)}</code><br>${esc(t('folder.note'))}</small></div>`:''}
      ${id?A_pauseBox(s):''}
      ${id?`<button class="btn block outline" onclick="A_studentLinks('${id}')">🔗 ${EN()?'Linked parents / unlink':'ผู้ปกครองที่ผูก / ยกเลิกการผูก'}</button>`:''}
      <button class="btn block" onclick="A_saveStudent(this,'${id}')">${esc(t('c.save'))}</button>`);
    A_prorateHint();   // show the first-month figure straight away, not only after a field is touched
  };
  // Admin: list the parents linked to a child and unlink one (child stays enrolled — this is NOT a withdrawal).
  window.A_studentLinks=async(sid)=>{ const d=await api('studentLinkedParents',{studentId:sid});
    // Same naming rule as everywhere else: a parent is "คุณแม่น้องอลัน", with their own name as the
    // muted sub-line. A parent who signed in with LINE but never filled the form has no name at all —
    // that used to print the bare row id ("PAR-058"), which tells the admin nothing.
    const kid=d.nick||d.name||sid;
    const paLabel=pa=>{ const r=String(pa.rel||'')+' '+String(pa.title||'');
      if(REL_DAD.test(r)) return EN()?`${kid}'s dad`:`คุณพ่อน้อง${kid}`;
      if(REL_MOM.test(r)) return EN()?`${kid}'s mom`:`คุณแม่น้อง${kid}`;
      if(pa.name) return titledName({Title:pa.title,NameTH:pa.name,NameEN:pa.name});
      return EN()?`${kid}'s parent (name not filled in)`:`ผู้ปกครองน้อง${kid} (ยังไม่กรอกชื่อ)`; };
    modal(`<h3>🔗 ${EN()?'Linked parents':'ผู้ปกครองที่ผูกกับ'} ${esc(kid)}</h3>
      <p class="muted" style="font-size:13px">${EN()?'Unlink detaches this parent from the child. The child stays enrolled (this is not a withdrawal).':'ยกเลิกการผูก = ตัดผู้ปกครองคนนี้ออกจากเด็ก โดยเด็กยังเรียนอยู่ในระบบ (ไม่ใช่การลาออก)'}</p>
      ${(d.parents||[]).length?d.parents.map(pa=>`<div class="list-item stack"><span><b>${esc(paLabel(pa))}</b> <span class="pill info" style="font-size:11px">${pa.via==='link'?'LINE':'legacy'}</span><br><small class="muted">${pa.name?esc(titledName({Title:pa.title,NameTH:pa.name,NameEN:pa.name}))+' · ':''}${pa.rel?relLabel(pa.rel)+' · ':''}${pa.phone?esc(phoneFmt(pa.phone)):(EN()?'no phone':'ไม่มีเบอร์โทร')}${pa.parentId?' · '+esc(pa.parentId):''}</small></span><span class="acts">${pa.parentId?`<button class="btn sm outline" onclick="this.closest('.modal').remove();A_parentForm('${esc(pa.parentId)}')">✏️ ${EN()?'Edit info':'แก้ข้อมูล'}</button>`:''}<button class="btn sm pink" onclick="A_unlink('${esc(sid)}','${esc(pa.parentId||'')}','${esc(pa.uid||'')}',this)">✂️ ${EN()?'Unlink':'ยกเลิกผูก'}</button></span></div>`).join(''):`<div class="card muted">${EN()?'No linked parents':'ไม่มีผู้ปกครองที่ผูกอยู่'}</div>`}
      <button class="btn block" style="margin-top:8px" onclick="this.closest('.modal').remove();A_linkParent('${esc(sid)}')">➕ ${EN()?'Link another parent':'เพิ่มผู้ปกครองที่ผูก'}</button>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  // Admin: the children a PARENT is linked to (reverse view) — shows how many + who, with unlink per child.
  window.A_parentLinks=async(pid)=>{ let d; try{ d=await api('parentLinkedStudents',{parentId:pid}); }catch(e){ err(e); return; }
    const kids=d.students||[];
    modal(`<h3>🔗 ${EN()?'Children linked to':'บุตรที่ผูกกับ'} ${esc(d.nick||d.name||pid)} <span class="pill ${kids.length?'ok':'bad'}" style="font-size:13px">👶 ${kids.length}</span></h3>
      <p class="muted" style="font-size:13px">${EN()?'These are the students this parent can see & pay for. Unlink detaches one (the child stays enrolled).':'รายชื่อนักเรียนที่ผู้ปกครองคนนี้เห็นและชำระเงินได้ · ยกเลิกผูก = ตัดออก (เด็กยังเรียนอยู่)'}</p>
      ${kids.length?kids.map(s=>`<div class="list-item"><span><b>${esc(s.nick||s.name||s.studentId)}</b> <small class="muted">${esc(s.name||'')} · ${esc(s.class||(EN()?'no class':'ยังไม่จัดชั้น'))}${String(s.status).toLowerCase()!=='active'?' · <span style="color:var(--bad)">'+esc(s.status)+'</span>':''}</small> <span class="pill info" style="font-size:11px">${s.via==='link'?'LINE':'legacy'}</span></span><button class="btn sm pink" onclick="A_unlinkFromParent('${esc(s.studentId)}','${esc(pid)}',this)">✂️ ${EN()?'Unlink':'ยกเลิกผูก'}</button></div>`).join(''):`<div class="card muted">${EN()?'No linked children':'ยังไม่มีบุตรที่ผูก'}</div>`}
      ${kids.length>1?`<button class="btn block" style="margin-top:8px" onclick="A_familyFinance('${esc(pid)}')">👁️ ${EN()?'Preview family finance (as parent sees it)':'ดูมุมมองการเงินของครอบครัว (แบบที่ผู้ปกครองเห็น)'}</button>`:''}
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  // Admin read-only preview of a family's finances across ALL linked children (what the parent sees + combined total)
  window.A_familyFinance=async(pid)=>{ let d; try{ d=await api('parentLinkedStudents',{parentId:pid}); }catch(e){ err(e); return; }
    const kids=(d.students||[]).filter(s=>String(s.status||'active').toLowerCase()==='active'); if(!kids.length){ toast(EN()?'No active children':'ไม่มีบุตรที่กำลังเรียน'); return; }
    const pers=await Promise.all(kids.map(k=>api('payments',{studentId:k.studentId})));
    let grand=0;
    const secs=kids.map((k,i)=>{ const bills=(pers[i]||[]).filter(b=>b.Status!=='PAID'&&b.VerifiedStatus!=='PREPAID');
      const rows=bills.map(b=>{ const out=b.Outstanding!=null?Number(b.Outstanding):Number(b.TotalDue!=null?b.TotalDue:b.Amount); grand+=out;
        return `<div class="list-item" style="align-items:flex-start"><span>${esc(b.Month)}<br><small class="muted">${(b.Items||[]).map(it=>esc(trItem(it[0]))+' '+baht(it[1])).join(' · ')}</small></span><b style="color:var(--bad)">${baht(out)}</b></div>`; }).join('') || `<small class="muted">${EN()?'no outstanding bills':'ไม่มีบิลค้างชำระ'}</small>`;
      return `<div class="card" style="padding:8px"><b>👶 ${esc(k.nick||k.name)}</b> <small class="muted">${esc(k.class||'')}</small>${rows}</div>`; }).join('');
    modal(`<h3>👁️ ${EN()?'Family finance':'มุมมองการเงินของครอบครัว'} — ${esc(d.nick||d.name)}</h3>
      <p class="muted" style="font-size:13px">${EN()?'Outstanding bills across every child — this is what the combined-payment total would be.':'บิลค้างชำระของลูกทุกคน — เท่ากับยอดที่จะได้เมื่อกด "จ่ายรวม"'}</p>
      ${secs}
      <div class="card" style="background:var(--ok-bg);padding:8px"><div class="spread"><b>${EN()?'Combined outstanding':'ยอดค้างรวมทุกคน'}</b><b style="color:var(--ok);font-size:18px">${baht(grand)}</b></div></div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_unlinkFromParent=async(sid,pid,btn)=>{ if(!confirm(EN()?'Unlink this child from the parent? The child stays enrolled.':'ยืนยันตัดนักเรียนคนนี้ออกจากผู้ปกครอง? (เด็กยังเรียนอยู่)'))return; if(btn)btn.disabled=true;
    try{ const r=await api('unlinkStudent',{studentId:sid,parentId:pid,adminId:USER.staffId}); toast((EN()?'Unlinked · removed ':'ยกเลิกการผูกแล้ว · ตัด ')+(r&&r.removed!=null?r.removed:'')+(EN()?' link(s)':' รายการ')); const m=document.querySelector('.modal'); if(m)m.remove(); A_parentLinks(pid); }catch(e){ err(e); if(btn)btn.disabled=false; } };
  window.A_unlink=async(sid,parentId,uid,btn)=>{ if(!confirm(EN()?'Unlink this parent from the child? The child stays enrolled.':'ยืนยันยกเลิกการผูกผู้ปกครองคนนี้ออกจากเด็ก? (เด็กยังเรียนอยู่)'))return; if(btn)btn.disabled=true;
    try{ const r=await api('unlinkStudent',{studentId:sid,parentId:parentId||undefined,uid:uid||undefined,adminId:USER.staffId}); toast((EN()?'Unlinked · removed ':'ยกเลิกการผูกแล้ว · ตัด ')+(r&&r.removed!=null?r.removed:'')+(EN()?' link(s)':' รายการ')); const m=document.querySelector('.modal'); if(m)m.remove(); A_studentLinks(sid); }catch(e){ err(e); if(btn)btn.disabled=false; } };
  // ---- temporary leave (ลาชั่วคราว) — Admin only ----------------------------------------------
  // A child who is away for a while and coming back: the record, the history and the parent link all
  // stay, but while they are away they are not billed, not marked absent, and not on any class list.
  // Distinct from withdrawing, which ends the enrolment.
  const isPaused = s => String(s&&s.Status||'')==='PAUSED';
  function pauseSpan(s){ const f=String(s.PauseFrom||'').slice(0,10), tt=String(s.PauseTo||'').slice(0,10);
    if(!f) return '';
    return tt ? `${fullDate(f)} – ${fullDate(tt)}` : (EN()?`from ${fullDate(f)} (open-ended)`:`ตั้งแต่ ${fullDate(f)} เป็นต้นไป (ยังไม่ระบุวันกลับ)`); }
  function A_pauseBox(s){ const sid=s.StudentID;
    if(isPaused(s)){
      const back=String(s.PauseTo||'').slice(0,10);
      const due = back && back < todayStr();     // the return date has passed — they are back already
      return `<div class="card" style="background:${due?'var(--ok-bg)':'var(--warn-bg)'};border-color:${due?'var(--ok-line)':'var(--warn-line)'};padding:8px">
        <b style="font-size:13px;color:${due?'var(--ok)':'var(--warn)'}">${due?'✅ '+(EN()?'Return date has passed':'ถึงกำหนดกลับมาเรียนแล้ว'):'⏸️ '+(EN()?'On temporary leave':'ลาชั่วคราว')}</b>
        <div style="font-size:13px;margin-top:2px">${esc(pauseSpan(s))}</div>
        ${s.PauseReason?`<div class="muted" style="font-size:13px">${esc(s.PauseReason)}</div>`:''}
        <p class="muted" style="font-size:13px;margin:6px 0 4px">${EN()?'While away: no monthly bill, not counted absent, not on class or activity lists. The record and the parent link stay.':'ระหว่างลา: ไม่ออกบิลรายเดือน · ไม่นับขาด/ลา · ไม่ขึ้นชื่อในชั้นเรียนและกิจกรรม · ข้อมูลและการผูกผู้ปกครองยังอยู่ครบ'}</p>
        <button class="btn sm block" onclick="A_resumeStudent('${esc(sid)}')">▶️ ${EN()?'Bring back to school':'กลับมาเรียนตามปกติ'}</button></div>`;
    }
    return `<button class="btn block outline" onclick="A_pauseForm('${esc(sid)}')">⏸️ ${EN()?'Temporary leave (keeps the record)':'ลาชั่วคราว (เก็บข้อมูลไว้)'}</button>`;
  }
  window.A_pauseForm=(sid)=>{ const s=findStudent(sid)||{};
    modal(`<h3>⏸️ ${EN()?'Temporary leave':'ลาชั่วคราว'} — ${esc(dispNick(s)||sid)}</h3>
      <p class="muted" style="font-size:13px">${EN()?'For a child who is away for a while and coming back. They stay in the system; while away they are not billed, not marked absent, and not on class or activity lists. To end the enrolment, use withdraw instead.':'สำหรับเด็กที่หยุดพักช่วงหนึ่งแล้วจะกลับมาเรียน · ข้อมูลยังอยู่ในระบบ ระหว่างลาจะไม่ออกบิล ไม่นับขาด/ลา และไม่ขึ้นชื่อในชั้นเรียน/กิจกรรม · หากจะออกจากโรงเรียนถาวร ให้ใช้เมนูลาออกแทน'}</p>
      <div class="grid2"><label class="field"><span>${EN()?'Away from':'เริ่มลาวันที่'}</span><input type="date" id="pz_from" value="${esc(todayStr())}"/></label>
        <label class="field"><span>${EN()?'Coming back (optional)':'กลับมาเรียนวันที่ (ไม่ระบุก็ได้)'}</span><input type="date" id="pz_to"/></label></div>
      <label class="field"><span>${EN()?'Reason (for the school’s own record)':'เหตุผล (บันทึกไว้ในระบบ)'}</span><input id="pz_why" placeholder="${EN()?'e.g. travelling with family':'เช่น เดินทางไปต่างประเทศกับครอบครัว'}"/></label>
      <p class="muted" style="font-size:13px">${EN()?'Leave the return date blank if it is not decided yet — you can end the leave at any time.':'ถ้ายังไม่รู้วันกลับ เว้นว่างไว้ได้ · กดให้กลับมาเรียนเมื่อไหร่ก็ได้'}</p>
      <button class="btn block" onclick="A_pauseDo('${esc(sid)}',this)">${esc(t('c.save'))}</button>`); };
  window.A_pauseDo=async(sid,btn)=>{ const m=btn.closest('.modal'); const v=x=>{const e=m.querySelector(x);return e?e.value.trim():'';};
    const from=v('#pz_from'); if(!from){ toast(EN()?'Pick the start date':'เลือกวันที่เริ่มลา'); return; }
    const to=v('#pz_to'); if(to && to<from){ toast(EN()?'The return date cannot be before the start':'วันที่กลับต้องไม่ก่อนวันที่เริ่มลา'); return; }
    try{ await api('setStudentPause',{studentId:sid,paused:true,from,to,reason:v('#pz_why'),staffId:USER.staffId});
      m.remove(); const m2=document.querySelector('.modal'); if(m2)m2.remove();
      confirmSaved(EN()?'Marked as on temporary leave':'บันทึกเป็นลาชั่วคราวแล้ว'); GO('manage'); }catch(e){err(e);} };
  window.A_resumeStudent=async(sid,back)=>{ if(!confirm(EN()?'Bring this child back to school? Billing and attendance resume.':'ให้นักเรียนคนนี้กลับมาเรียนตามปกติ? ระบบจะเริ่มออกบิลและนับการมาเรียนอีกครั้ง'))return;
    try{ await api('setStudentPause',{studentId:sid,paused:false,staffId:USER.staffId});
      const m=document.querySelector('.modal'); if(m)m.remove();
      confirmSaved(EN()?'Back at school':'กลับมาเรียนตามปกติแล้ว'); GO(back||'manage'); }catch(e){err(e);} };
  /**
   * Children on a temporary leave, on the screen the admin actually opens every morning.
   *
   * They used to be invisible here: away for a month with nothing to say so, and back with nothing
   * to say that either — the return date came and went and the only sign was the child appearing
   * among "ขาด". Now the leave is listed with its dates, the day it runs out is called out, and
   * confirming the return is one tap from the same screen (early returns included, which is what
   * the "มาก่อนกำหนด" case needs).
   */
  window.A_pausedCard=(list)=>{ list=list||[]; if(!list.length) return '';
    const dn=x=>EN()?(x.nickEN||x.nameEN||x.nick||x.name):(x.nick||x.name);
    const due=list.filter(x=>x.due), away=list.filter(x=>!x.due);
    const row=(x,isDue)=>`<div class="list-item"><span><b>${esc(dn(x))}</b> <small class="muted">${esc(x.className||'')}</small>
        <br><small class="muted">${esc(ddmmyyyy(x.from))} → ${x.to?esc(ddmmyyyy(x.to)):(EN()?'not decided':'ยังไม่กำหนด')}${x.reason?' · '+esc(x.reason):''}</small>
        ${isDue?`<br><small style="color:var(--warn)">${x.dueToday?(EN()?'⏰ due back TODAY':'⏰ ครบกำหนดวันนี้'):(EN()?'⏰ the return date has passed':'⏰ เลยกำหนดกลับมาแล้ว')}</small>`:''}</span>
      <button class="btn sm ${isDue?'green':'outline'}" onclick="A_resumeStudent('${esc(x.studentId)}','home')">▶️ ${EN()?'Back':'กลับมาเรียน'}</button></div>`;
    return `<div class="card"><div class="spread"><h3>⏸️ ${EN()?'Temporary leave':'นักเรียนลาชั่วคราว'}</h3>
        <span class="muted">${list.length} ${EN()?'children':'คน'}</span></div>
      ${due.length?`<div class="card" style="background:var(--warn-bg);border-color:var(--warn-line);padding:8px;margin:4px 0">
        <b style="color:var(--warn)">🔄 ${EN()?'Due back — confirm they have returned':'ครบกำหนดแล้ว — กดยืนยันว่ากลับมาเรียนแล้ว'} (${due.length})</b>
        <small class="muted" style="display:block;margin-top:2px">${EN()?'They are already back on the class lists and can be checked in. Confirming clears the leave.':'ระบบนำชื่อกลับเข้าชั้นเรียนและเปิดให้เช็คอินแล้ว · กดยืนยันเพื่อล้างสถานะลาชั่วคราว'}</small>
        ${due.map(x=>row(x,true)).join('')}</div>`:''}
      ${away.map(x=>row(x,false)).join('')}
      <small class="muted">${EN()?'While away a child is not billed, not marked absent, and not on class lists.':'ระหว่างลาชั่วคราว จะไม่ออกบิล ไม่นับขาด และไม่ขึ้นชื่อในชั้นเรียน'}</small></div>`; };

  // Live preview of the FIRST month's tuition under the chosen rule, so the admin sees the number
  // before it becomes a bill. Mirrors tuitionForMonth_ in engine.js — keep the two in step.
  window.A_prorateHint=()=>{ const hint=document.getElementById('prorateHint'); if(!hint)return;
    const g=k=>{ const e=document.getElementById('stf_'+k); return e?e.value.trim():''; };
    const mode=g('ProrateMode')||'FULL', box=document.getElementById('prorateAmtBox');
    if(box) box.hidden = mode!=='MANUAL';
    const d=g('EnrollDate');
    if(!d){ hint.textContent=EN()?'No start date — billed from the month the bill is issued, as before.'
      :'ไม่ได้ระบุวันเริ่มเรียน — ออกบิลตามเดือนที่เรียกเก็บเหมือนเดิม'; return; }
    const price=Number((A_plans().find(x=>x.id===g('Plan'))||{}).price||0);
    const day=Number(d.slice(8,10))||1, mm=d.slice(0,7);
    const [yy,mo]=mm.split('-').map(Number); const total=new Date(yy,mo,0).getDate(), remain=total-day+1;
    let amt=price, how=EN()?'full month':'เต็มเดือน';
    if(day>1){ if(mode==='HALF'){ amt=Math.round(price/2); how=EN()?'half month':'ครึ่งเดือน'; }
      else if(mode==='DAILY'){ amt=Math.round(price*remain/total); how=`${remain}/${total} ${EN()?'days':'วัน'}`; }
      else if(mode==='MANUAL'){ amt=Number(g('ProrateAmount'))||0; how=EN()?'set manually':'กำหนดเอง'; } }
    hint.innerHTML = price>0
      ? `${EN()?'First bill':'บิลแรก'} <b>${esc(monthNameYear(mm))}</b> = <b style="color:var(--blue)">${baht(amt)}</b> <span class="muted">(${esc(how)}${day>1?'':EN()?', starts on the 1st':' · เริ่มวันที่ 1'})</span> · ${EN()?'earlier months are not billed':'เดือนก่อนหน้าจะไม่ออกบิล'}`
      : (EN()?'Pick a package first — the amount is worked out from its monthly price.':'เลือกแพ็กเกจก่อน — ยอดคำนวณจากราคาต่อเดือนของแพ็กเกจ'); };

  window.A_saveStudent=async(btn,id)=>{ const m=btn.closest('.modal'); const v=k=>{ const e=m.querySelector('#stf_'+k); return e?e.value.trim():''; };
    const data={NameTH:v('NameTH'),NameEN:v('NameEN'),Nickname:v('Nickname'),NicknameEN:v('NicknameEN'),NationalID:v('NationalID'),Class:v('Class'),Plan:v('Plan'),Allergy:v('Allergy'),MedicalHistory:v('MedicalHistory'),
      InsuranceHas:m.querySelector('#stf_Ins').checked,InsurancePolicyNo:v('InsurancePolicyNo'),InsuranceCompany:v('InsuranceCompany'),InsuranceExpiry:v('InsuranceExpiry'),
      StartTime:v('StartTime'),EndTime:v('EndTime'),   // per-student individual schedule (EndTime drives OT)
      OTGraceUntil:v('OTGraceUntil'),RateNote:v('RateNote'),  // OT-free cutoff decoupled from EndTime + parent-facing note
      DiscountAmount:v('DiscountAmount')===''?'':(Number(v('DiscountAmount'))||0),DiscountUnit:v('DiscountUnit')||'บาท',  // monthly tuition discount (master, hidden from parent)
      EnrollDate:v('EnrollDate'),                             // billing starts from the first REAL day, not the day the record was typed in
      ProrateMode:v('ProrateMode')||'FULL',                   // how the STARTING month is charged
      ProrateAmount:v('ProrateAmount')===''?'':(Number(v('ProrateAmount'))||0),
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
      return `<div class="list-item"><span><b>${esc(b.Month)}</b> ${baht(b.TotalDue!=null?b.TotalDue:b.Amount)} <span class="pill ${st}" style="font-size:11px">${esc(tStat(b.Status))}</span></span><button class="btn sm pink" onclick="A_delBill('${esc(b.BillingID)}','${esc(b.Month)}',this)" aria-label="${EN()?"Delete":"ลบ"}" title="${EN()?"Delete":"ลบ"}">🗑️</button></div>`; };
    modal(`<h3>🧾 ${esc(t('bill.issue'))} — ${esc(nm(s))}</h3><p class="muted" style="font-size:13px">${esc(t('bill.issueNote'))}</p>
      ${bills&&bills.length?`<div class="card" style="padding:8px;background:var(--surface)"><b style="font-size:13px">📋 ${EN()?'Existing bills':'บิลที่มีอยู่'}</b>${bills.map(billRow).join('')}</div>`:''}
      <div class="grid2"><label class="field"><span>${esc(t('c.month'))}</span><input type="month" id="biMonth" value="${monthStr()}"/></label>
        <label class="field"><span>${esc(t('bill.amount'))}</span><input type="number" id="biAmt" value="${base.price}"/></label></div>
      <p class="muted" style="font-size:13px">${esc(t('bill.planFull'))}: ${esc(EN()?base.labelEN:base.labelTH)} · ${baht(base.price)} — ${esc(t('bill.prorateHint'))}</p>
      <label class="field"><span>${esc(t('bill.label'))}</span><input id="biLabel" value="${esc((EN()?'Tuition ':'ค่าเทอม ')+(EN()?base.labelEN:base.labelTH))}"/></label>
      <label class="field"><span>${esc(t('c.reason')) } (${esc(t('bill.optional'))})</span><input id="biNote" placeholder="${esc(t('bill.notePh'))}"/></label>
      <label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="biPaid" style="width:auto" onchange="document.getElementById('biPaidBox').hidden=!this.checked"/> 💵 ${esc(t('bill.markPaid'))}</label>
      <div id="biPaidBox" hidden><small class="muted" style="font-size:13px">${esc(t('bill.advanceHint'))}</small>
        <label class="field"><span>${esc(t('bill.paidDate'))}</span><input type="date" id="biPaidDate" value="${todayStr()}"/></label></div>
      <button class="btn block" onclick="A_issueBillDo('${sid}',this)">${esc(t('bill.send'))}</button>`);
  };
  // Admin: issue this month's bill for SEVERAL selected students at once + notify their parents.
  // The parent then sees each child's bill and can pay them combined (one slip) or per item.
  window.A_issueCombined=async()=>{ const students=(A_CACHE.students&&A_CACHE.students.length)?A_CACHE.students:await api('listStudents');
    A_CACHE.students=students;
    const rows=students.map(s=>`<label class="field" style="display:flex;align-items:center;gap:8px;margin:2px 0"><input type="checkbox" class="icStu" value="${s.StudentID}" style="width:auto"/> <b>${esc(dispNick(s))}</b> <small class="muted">${esc(nm(s))} · ${esc(s.Class||'')}</small></label>`).join('');
    modal(`<h3>🧾 ${EN()?'Issue combined bills':'ออกบิลรวม (เลือกนักเรียน)'}</h3>
      <p class="muted" style="font-size:13px">${EN()?'Pick 2+ students; this issues each one\'s monthly tuition bill and notifies the parents. Parents can pay them combined (one slip) or separately.':'เลือกนักเรียนตั้งแต่ 2 คนขึ้นไป · ระบบจะออกบิลค่าเทอมรายเดือนของแต่ละคนและแจ้งผู้ปกครอง · ผู้ปกครองเลือกจ่ายรวมสลิปเดียวหรือแยกได้'}</p>
      <label class="field"><span>${esc(t('c.month'))}</span><input id="icMonth" type="month" value="${monthStr()}"/></label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin:4px 0"><input type="checkbox" id="icNotify" checked style="width:auto"/> ${EN()?'Notify parents':'แจ้งเตือนผู้ปกครอง'}</label>
      <div style="max-height:40vh;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px;margin:6px 0"><label style="display:flex;align-items:center;gap:8px;font-size:13px;border-bottom:1px solid var(--line);padding-bottom:4px"><input type="checkbox" id="icAll" onchange="document.querySelectorAll('.icStu').forEach(c=>c.checked=this.checked)" style="width:auto"/> <b>${EN()?'Select all':'เลือกทั้งหมด'}</b></label>${rows}</div>
      <button class="btn block" onclick="A_issueCombinedDo(this)">🧾 ${EN()?'Issue bills':'ออกบิล'}</button>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`); };
  window.A_issueCombinedDo=async(btn)=>{ const m=btn.closest('.modal'); const ids=[...m.querySelectorAll('.icStu:checked')].map(c=>c.value); const month=m.querySelector('#icMonth').value; const notify=m.querySelector('#icNotify').checked;
    if(!ids.length){ toast(EN()?'Select at least one student':'เลือกนักเรียนอย่างน้อย 1 คน'); return; }
    btn.disabled=true;
    try{ const r=await api('issueBillsFor',{studentIds:ids,month}); if(notify){ try{ await api('notifyBills',{studentIds:ids,month}); }catch(e){} }
      m.remove(); confirmSaved((EN()?'Issued ':'ออกบิลแล้ว ')+r.created+(EN()?' bills':' รายการ')+(notify?(EN()?' · parents notified':' · แจ้งผู้ปกครองแล้ว'):'')); }
    catch(e){ err(e); btn.disabled=false; } };
  window.A_delBill=async(billingId,month,btn)=>{ if(!confirm((EN()?'Delete the bill for ':'ลบบิลงวด ')+month+' ?'))return;
    if(btn)btn.disabled=true;
    try{ await api('deleteBill',{billingId}); toast(t('manage.deleted')); const m=btn&&btn.closest('.modal'); if(m)m.remove(); GO('manage'); }catch(e){err(e);} };
  window.A_issueBillDo=async(sid,btn)=>{ const m=btn.closest('.modal'); const amt=+m.querySelector('#biAmt').value;
    if(!amt){toast(t('bill.amount'));return;} const paid=m.querySelector('#biPaid').checked; const paidDate=m.querySelector('#biPaidDate').value;
    try{ await api('issueBill',{studentId:sid,month:m.querySelector('#biMonth').value,amount:amt,label:m.querySelector('#biLabel').value.trim(),note:m.querySelector('#biNote').value.trim(),paid,paidDate});
      m.remove(); confirmSaved(t('bill.sent')); GO('manage'); }catch(e){err(e);} };
  // auto-generate the month's bills for all active students (recurring monthly)
  window.A_genBills=()=>{ modal(`<h3>📅 ${esc(t('bill.genTitle'))}</h3><p class="muted" style="font-size:13px">${esc(t('bill.genNote'))}</p>
    <label class="field"><span>${esc(t('c.month'))}</span><input type="month" id="gbMonth" value="${monthStr()}"/></label>
    <button class="btn block" onclick="A_genBillsDo(this)">${esc(t('bill.genBtn'))}</button>`); };
  window.A_genBillsDo=async(btn)=>{ const m=btn.closest('.modal'); const r=await api('generateMonthlyBills',{month:m.querySelector('#gbMonth').value});
    m.remove(); confirmSaved(t('bill.genDone').replace('{n}',r.created).replace('{m}',r.month));
    // children with no package are skipped rather than billed 0 — name them, or nobody would notice
    const np=r.noPlan||[];
    if(np.length) setTimeout(()=>modal(`<h3>⚠️ ${EN()?'Skipped — no package yet':'ข้ามไป — ยังไม่ได้เลือกแพ็กเกจ'} (${np.length})</h3>
      <p class="muted" style="font-size:13px">${EN()?'These children were NOT billed because no package is set. Set one in the student record, then generate again.':'นักเรียนต่อไปนี้ยังไม่ได้ออกบิล เพราะยังไม่ได้ตั้งแพ็กเกจ · ตั้งแพ็กเกจในข้อมูลนักเรียนแล้วกดออกบิลอีกครั้ง'}</p>
      ${np.map(x=>`<div class="list-item"><span><b>${esc(x.nick||x.name||x.studentId)}</b>${x.nick&&x.name?` <small class="muted">${esc(x.name)}</small>`:''}</span><button class="btn sm outline" onclick="this.closest('.modal').remove();A_studentForm('${esc(x.studentId)}')">✏️ ${EN()?'Set package':'ตั้งแพ็กเกจ'}</button></div>`).join('')}
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`), 600); };

  // ---- per-student extra charges (auto-merged into monthly bill) ----
  window.A_charges=async(sid)=>{ const s=MOCK.students.find(x=>x.StudentID===sid)||{}; const month=monthStr(); const list=await api('studentCharges',{studentId:sid,month});
    modal(`<h3>💵 ${esc(t('charge.title'))} — ${esc(nm(s))}</h3><p class="muted" style="font-size:13px">${esc(t('charge.note'))} (${esc(month)})</p>
      <div id="chList">${list.map(c=>`<div class="list-item"><span>${esc(c.Label)}</span><span><b>${baht(c.Amount)}</b> <button class="btn sm pink" onclick="A_delCharge('${c.ChargeID}','${sid}')" aria-label="${EN()?"Delete":"ลบ"}" title="${EN()?"Delete":"ลบ"}">✕</button></span></div>`).join('')||`<small class="muted">${esc(t('c.noItems'))}</small>`}</div>
      <div class="grid2" style="margin-top:8px"><input id="chLabel" placeholder="${esc(t('charge.label'))}"/><input id="chAmt" type="number" placeholder="${esc(t('charge.amount'))}"/></div>
      <button class="btn block" style="margin-top:6px" onclick="A_addCharge('${sid}')">+ ${esc(t('charge.add'))}</button>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_addCharge=async(sid)=>{ const label=$('#chLabel').value.trim(), amt=+$('#chAmt').value; if(!label||!amt){toast(t('charge.label'));return;}
    await api('addStudentCharge',{studentId:sid,month:monthStr(),label,amount:amt}); const m=document.querySelector('.modal'); if(m)m.remove(); A_charges(sid); toast(t('c.saved')); };
  window.A_delCharge=async(id,sid)=>{ await api('removeStudentCharge',{chargeId:id}); const m=document.querySelector('.modal'); if(m)m.remove(); A_charges(sid); toast(t('manage.deleted')); };

  // ---- Import / Export students ----
  // xlsx_min.js used to ship to every parent for the sake of these two admin screens — fetch it here
  const needXLSX = () => window.__atomLoadScript ? __atomLoadScript('xlsx_min.js', ()=>!!window.XLSXMin) : Promise.resolve();
  window.A_exportStudent=async(id)=>{ if(!confirm(t('manage.confirmExport')))return;
    try{ const r=await api('exportStudent',{studentId:id}); await needXLSX();
      if(window.XLSXMin) XLSXMin.download(r.filename, r.rows, 'Student');
      confirmSaved((EN()?'Exported & removed: ':'นำออกแล้ว: ')+r.filename); GO('manage'); }catch(e){err(e);} };
  // ---- Admin: remove a student from the system (with required reason) ----
  window.A_removeStudent=(id,withdrawId,preset)=>{ const s=MOCK.students.find(x=>x.StudentID===id)||{};
    const m=modal(`<h3>🚪 ${esc(t('wd.remove'))} — ${esc(nm(s))}</h3><p class="muted" style="font-size:13px">${esc(t('wd.adminNote'))}</p>
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
      <div class="card"><p class="muted" style="font-size:13px">${esc(t('ins2.manageNote'))}</p>
      ${list.map(x=>`<div class="list-item"><span><b>${esc(EN()?(x.nameEN||x.name):x.name)}</b> <small class="muted">${esc(x.class||'')} · ${EN()?'ID':'บัตร'} ${esc(x.nationalId||'-')}</small> <span class="pill ${x.filled?'ok':'wait'}">${x.filled?'✓ '+esc(t('ins2.filled')):esc(t('ins2.notFilled'))}</span></span>
        <button class="btn sm ${x.filled?'outline':''}" onclick="A_insuranceEdit('${x.studentId}')">${x.filled?'✏️':esc(t('ins2.btn'))}</button></div>`).join('')}</div>`;
    window.scrollTo(0,0); };
  window.A_insuranceEdit = async (sid)=>{ const st=await api('insuranceStatus',{studentId:sid}); const o=await api('insuranceOptions'); const s=MOCK.students.find(x=>x.StudentID===sid)||{};
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="A_insurance()">${t('c.back')}</button><h2 class="page">🛡️ ${esc(t('ins2.adminEdit'))}</h2>
      <div class="card" style="background:var(--surface-2)"><b>${esc(nm(s))}</b> <span class="pill ${st.filled?'ok':'wait'}">${st.filled?esc(t('ins2.filled')):esc(t('ins2.notFilled'))}</span></div>
      ${insuranceFormHTML(o,s,st.record)}
      <button class="btn block" onclick="A_insuranceSave('${sid}')">${esc(t('c.save'))}</button>`; window.scrollTo(0,0); };
  window.A_insuranceSave = async (sid)=>{ const d=readInsuranceForm(); if(!insValid(d)){toast(t('ins2.required'));return;}
    try{ await api('saveInsuranceAdmin',{studentId:sid,adminId:USER.staffId,data:d}); confirmSaved(t('c.saved')); A_insurance(); }catch(e){err(e);} };

  // ---- Admin: activity log (who did what) ----
  window.A_activityLog=async()=>{ const rows=await api('activityLog',{limit:200});
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('manage')">${t('c.back')}</button><h2 class="page">📜 ${esc(t('act.title'))}</h2>
      <div class="card"><p class="muted" style="font-size:13px">${esc(t('act.note'))}</p>
      ${rows.length?rows.map(r=>`<div class="list-item"><span><b>${esc(r.Action)}</b> <small class="muted">${esc(r.Target||'')}</small><br><small class="muted">${esc(r.Detail||'')}</small></span>
        <small class="muted" style="text-align:right">${esc(r.UserName||r.UserRole||'')}<br>${esc(r.Timestamp)}</small></div>`).join(''):`<small class="muted">${esc(t('c.noItems'))}</small>`}</div>`;
  };

  ADMIN_SUB_importExport = async ()=>{ const exported=await api('listExportedStudents');
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('manage')">${t('c.back')}</button><h2 class="page">📥 ${esc(t('manage.importExport'))}</h2>
      <div class="card"><h3>📤 ${esc(t('ie.exportedFolder'))}</h3><p class="muted" style="font-size:13px">${esc(t('ie.folderNote'))}</p>
        ${exported.length?exported.map(s=>`<div class="list-item"><span><b>${esc(nm(s))}</b> <small class="muted">${esc(s.NationalID||'')} · ${EN()?'exported':'นำออก'} ${esc(s.ExportedDate||'')}</small></span><button class="btn sm green" onclick="A_reimport('${s.StudentID}')">↩️ ${esc(t('ie.reimport'))}</button></div>`).join(''):`<small class="muted">${esc(t('c.noItems'))}</small>`}</div>
      <div class="card"><h3>📂 ${esc(t('ie.importFile'))}</h3><p class="muted" style="font-size:13px">${esc(t('ie.importNote'))}</p>
        <label class="field"><span>${esc(t('ie.chooseXlsx'))}</span><input type="file" id="impF" accept=".xlsx"/></label>
        <button class="btn block" onclick="A_importFile()">${esc(t('ie.import'))}</button></div>`;
  };
  window.A_reimport=async(id)=>{ try{ await api('importStudent',{studentId:id}); confirmSaved(t('ie.imported')); GO_('importExport'); }catch(e){err(e);} };
  window.A_importFile=async()=>{ const f=$('#impF').files[0]; if(!f){toast(t('ie.chooseXlsx'));return;}
    try{ await needXLSX(); const rows=await XLSXMin.parse(f); await api('importStudent',{rows}); confirmSaved(t('ie.imported')); GO_('importExport'); }catch(e){err(e);} };

  // ---- Staff groups & hours ----
  window.A_groups=async()=>{ const [groups,staff]=await Promise.all([api('listStaffGroups'),api('listStaff')]);
    A_CACHE.groups=groups||[]; A_CACHE.staff=staff||A_CACHE.staff;
    const membersOf=name=>(staff||[]).filter(s=>s.StaffGroup===name);
    modal(`<h3>🕑 ${esc(t('manage.groups'))}</h3><p class="muted" style="font-size:13px">${esc(t('manage.groupsNote'))}</p>
      <div id="grpList">${groups.map(g=>{ const mem=membersOf(g.GroupName);
        return `<div class="card" style="padding:10px"><div class="spread"><b>${esc(EN()?g.GroupNameEN:g.GroupName)}</b><button class="btn sm pink" onclick="A_delGroup('${esc(g.GroupName)}')" aria-label="${EN()?"Delete":"ลบ"}" title="${EN()?"Delete":"ลบ"}">🗑️</button></div>
        <div class="grid2" style="margin-top:6px"><label class="field"><span>${esc(t('lbl.checkIn'))}</span><input type="time" value="${esc(g.CheckInTime)}" onchange="A_setGroup('${esc(g.GroupName)}','in',this.value)"/></label>
          <label class="field"><span>${esc(t('lbl.checkOut'))}</span><input type="time" value="${esc(g.CheckOutTime)}" onchange="A_setGroup('${esc(g.GroupName)}','out',this.value)"/></label></div>
        <div style="margin-top:6px"><small class="muted">👥 ${EN()?'Members':'พนักงานในกลุ่ม'} (${mem.length})</small>${mem.length?`<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${mem.map(s=>`<span class="pill info" style="font-size:13px">${esc(nmn(s))}</span>`).join('')}</div>`:`<div class="muted" style="font-size:13px">— ${EN()?'no members':'ยังไม่มีพนักงาน'} —</div>`}</div></div>`; }).join('')}</div>
      <div class="card" style="background:var(--surface-2);padding:10px"><b style="font-size:13px">➕ ${esc(t('grp.add'))}</b>
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
    const sObj=id=>(students||[]).find(x=>x.StudentID===id)||null;
    const sName=id=>{ const s=sObj(id); return s?dispNick(s):id; };   // nickname headline
    const sFull=id=>{ const s=sObj(id); return s?nm(s):''; };
    const tName=id=>{ const s=(staff||[]).find(x=>x.StaffID===id); return s?(nick(s)||nm(s)):(id||'-'); };
    const rows=(st.done||[]).map(d=>`<div class="list-item"><span><b>${esc(sName(d.studentId))}</b> <small class="muted">${esc(sFull(d.studentId))}</small> ${journalPill(d)}<br><small class="muted">${esc(EN()?'by':'โดย')} ${esc(tName(d.teacherId))}</small></span>
      <span class="row"><button class="btn sm outline" onclick="A_viewJournal('${d.studentId}','${day}')" aria-label="${EN()?"View journal":"ดูบันทึกประจำวัน"}" title="${EN()?"View journal":"ดูบันทึกประจำวัน"}">👁️</button>
      ${jIsDraft(d)?`<button class="btn sm" onclick="A_editJournal('${d.studentId}','${day}')" aria-label="${EN()?"Edit":"แก้ไข"}" title="${EN()?"Edit":"แก้ไข"}">✏️</button>`
                   :`<button class="btn sm pink" onclick="A_unlockJournal('${d.studentId}','${day}')">${esc(t('jr.unlock'))}</button>`}</span></div>`).join('');
    modal(`<h3>📒 ${esc(t('jr.admin'))}</h3>
      <label class="field"><span>${esc(t('inj.date'))}</span><input type="date" id="ajDate" value="${day}" onchange="A_journals(this.value)"/></label>
      <div style="max-height:50vh;overflow:auto">${rows||`<small class="muted">${esc(t('jr.noneForDay'))}</small>`}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  // Read-only view of a submitted report — the same one Admin sees. Teachers use it too: opening a
  // notification about a past day, or browsing a child's history, must SHOW the report rather than
  // reopening the entry form (which only ever holds today).
  window.A_viewJournal=async(sid,day)=>{ const j=await api('getJournal',{studentId:sid,date:day,role:USER.role});
    if(!j){ toast(t('jr.noneForDay')); return; }
    const canEdit=(day===todayStr()) && (USER.role==='Admin' || !!USER.staffId);
    modal(`<h3>📒 ${esc(day)}</h3>${journalChecklist(j)}
      ${canEdit?`<button class="btn block" onclick="this.closest('.modal').remove();T_journal('${esc(sid)}')">✏️ ${EN()?'Edit today’s report':'แก้ไขบันทึกของวันนี้'}</button>`:''}
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`); };
  // a child's recent reports, for staff. Tap a day to read it exactly as Admin would.
  window.T_journalHistory=async(sid)=>{ let st=(A_CACHE.students||[]).find(x=>x.StudentID===sid);
    // a teacher rarely has the admin roster cached — fetch once so the title is a name, not an id
    if(!st){ try{ const l=await api('listStudents'); if(l&&l.length){ A_CACHE.students=l; st=l.find(x=>x.StudentID===sid); } }catch(e){} }
    st=st||{};
    let rows=[]; try{ rows=await api('journalHistory',{studentId:sid,limit:14,role:USER.role,staffId:USER.staffId}); }catch(e){ err(e); return; }
    modal(`<h3>📒 ${EN()?'Past reports':'บันทึกย้อนหลัง'} — ${esc(dispNick(st)||sid)}</h3>
      <p class="muted" style="font-size:13px">${EN()?'Tap a day to read the report that was sent.':'แตะที่วันเพื่อดูบันทึกที่ส่งไปแล้ว'}</p>
      ${(rows||[]).length?rows.map(r=>{ const d=ymd(r.Date); const sent=String(r.Status||'').toUpperCase()!=='DRAFT';
          return `<div class="list-item" style="cursor:pointer" onclick="this.closest('.modal').remove();A_viewJournal('${esc(sid)}','${esc(d)}')">
            <span><b>${esc(ddmmyyyy(d))}</b> ${sent?`<span class="pill ok" style="font-size:11px">${EN()?'sent':'ส่งแล้ว'}</span>`:`<span class="pill wait" style="font-size:11px">${EN()?'draft':'ร่าง'}</span>`}</span><span class="muted">›</span></div>`; }).join('')
        :`<div class="card muted">${EN()?'No reports yet':'ยังไม่มีบันทึก'}</div>`}
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`); };
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
      <div id="depList">${deps.map(d=>{ const ms=members(d); return `<div style="padding:6px 0;border-bottom:1px solid var(--surface-3)">
        <div class="list-item" style="border:none;padding:0"><input value="${esc(d)}" id="dep_${esc(d)}" style="flex:1"/><span class="row"><button class="btn sm" onclick="A_renameDep('${esc(d)}')" aria-label="${EN()?"Save":"บันทึก"}" title="${EN()?"Save":"บันทึก"}">💾</button><button class="btn sm pink" onclick="A_delDep('${esc(d)}')" aria-label="${EN()?"Delete":"ลบ"}" title="${EN()?"Delete":"ลบ"}">🗑️</button></span></div>
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
  window.A_settings=async()=>{ const [q,sc]=await Promise.all([api('getLeaveQuota'),api('schoolConfig')]); const cfg=MOCK.config;
    const cfgOn=(k,def)=>{ const v=(sc&&sc[k]!=null)?sc[k]:cfg[k]; return v==null?def:(v===true||String(v).toLowerCase()==='true'); };
    modal(`<h3>⚙️ ${esc(t('manage.settings'))}</h3>
      <h4 style="margin:6px 0">📍 ${EN()?'Check-in location (geofence)':'พิกัดโรงเรียน (เช็คอิน)'}</h4>
      <p class="muted" style="font-size:13px">${EN()?'Open Google Maps → long-press the school → copy the lat, long numbers here.':'เปิด Google Maps → กดค้างที่ตำแหน่งโรงเรียน → คัดลอกเลข lat, long มาใส่'}</p>
      <div class="grid2"><label class="field"><span>Latitude</span><input id="cfgLat" type="number" step="any" value="${esc(sc.GPS_Lat!=null?sc.GPS_Lat:'')}"/></label>
        <label class="field"><span>Longitude</span><input id="cfgLng" type="number" step="any" value="${esc(sc.GPS_Lng!=null?sc.GPS_Lng:'')}"/></label></div>
      <div class="grid2"><label class="field"><span>${EN()?'Radius (metres)':'รัศมี (เมตร)'}</span><input id="cfgRadius" type="number" value="${esc(sc.Radius!=null?sc.Radius:30)}"/></label>
        <label class="field"><span>${EN()?'GPS tolerance (metres)':'เผื่อความคลาดเคลื่อน GPS (เมตร)'}</span><input id="cfgSlack" type="number" min="0" value="${esc(sc.GpsAccuracySlack!=null?sc.GpsAccuracySlack:50)}"/></label></div>
      <p class="muted" style="font-size:13px">${EN()?'A phone reports how sure it is of your position. This is how much of that margin may count in your favour, so someone standing at the gate with a poor signal is not refused. 0 = judge by the dot alone (strict).':'มือถือจะบอกด้วยว่าตำแหน่งที่จับได้คลาดเคลื่อนได้เท่าไร · ค่านี้คือส่วนที่ยอมให้นับเป็นประโยชน์กับผู้ใช้ คนที่ยืนอยู่หน้าประตูแต่สัญญาณไม่ดีจะได้ไม่ถูกปฏิเสธ · ใส่ 0 = ตัดสินจากจุดที่จับได้อย่างเดียว (เข้มงวด)'}</p>
      <h4 style="margin:6px 0">${esc(t('set.diligence'))}</h4>
      <div class="grid2"><label class="field"><span>${esc(t('set.attendAmt'))}</span><input id="setAtt" type="number" value="${cfg.DiligenceAttendanceAmount}"/></label>
        <label class="field"><span>${esc(t('set.fbAmt'))}</span><input id="setFb" type="number" value="${cfg.DiligenceFacebookAmount}"/></label></div>
      <p class="muted" style="font-size:13px">${BC_ICON} ${EN()?'Meeting days moved to':'วันประชุมย้ายไปที่'} <a href="#" onclick="event.preventDefault();this.closest('.modal').remove();GO_('holidays')"><b>${esc(t('manage.holidays'))}</b></a></p>
      <h4 style="margin:6px 0">⏰ ${EN()?'Staff OT & provident fund':'OT พนักงาน & เงินสมทบ'}</h4>
      <div class="grid2"><label class="field"><span>${EN()?'Staff OT (฿/hour)':'OT พนักงาน (฿/ชั่วโมง)'}</span><input id="setOtRate" type="number" min="0" value="${esc(sc.StaffOTHourlyRate!=null?sc.StaffOTHourlyRate:100)}"/></label>
        <label class="field"><span>${EN()?'School match (× staff share)':'โรงเรียนสมทบ (เท่าของยอดหักพนักงาน)'}</span><input id="setMatch" type="number" min="0" step="0.1" value="${esc(sc.ContributionMatchRate!=null?sc.ContributionMatchRate:1)}"/></label></div>
      <p class="muted" style="font-size:13px">${EN()?'Match 1 = deduct 200 from staff, school adds 200, fund grows 400.':'สมทบ 1 เท่า = หักพนักงาน 200 · โรงเรียนสมทบ 200 · เข้ากองทุน 400'}</p>
      <button class="btn sm outline block" onclick="A_contribRecalc(this)">🧮 ${EN()?'Review accumulated fund totals':'ตรวจยอดเงินสมทบสะสมของทุกคน'}</button>
      <h4 style="margin:6px 0">🔍 ${EN()?'Slip verification (SlipOK)':'การตรวจสลิป (SlipOK)'}</h4>
      <button class="btn sm outline block" onclick="A_slipDiag(this)">${EN()?'Check whether slip verification is working':'ตรวจว่าระบบตรวจสลิปทำงานอยู่ไหม'}</button>
      <h4 style="margin:6px 0">⚡ ${EN()?'System speed & errors':'ความเร็วและข้อผิดพลาดของระบบ'}</h4>
      <label class="field"><span>${EN()?'Keep data ready for (seconds)':'เก็บข้อมูลไว้ให้พร้อมใช้ (วินาที)'}</span><input id="setTtl" type="number" min="30" max="21600" value="${esc(sc.CacheTTL!=null?sc.CacheTTL:300)}"/></label>
      <p class="muted" style="font-size:13px">${EN()?'Reading the sheets takes about 10 seconds; reading this ready-made copy takes under half a second. Saving anything in the app refreshes it immediately, so this only matters if someone edits the Google Sheet BY HAND — then the app can lag behind by up to this long. 300 = 5 minutes.':'การอ่านจากชีตใช้เวลาราว 10 วินาที · อ่านจากสำเนาที่เตรียมไว้ใช้ไม่ถึงครึ่งวินาที · การบันทึกผ่านแอปจะรีเฟรชให้ทันทีเสมอ ค่านี้จึงมีผลเฉพาะกรณีมีคนไปแก้ Google Sheet ด้วยมือ — แอปอาจตามช้าได้ไม่เกินเวลานี้ · 300 = 5 นาที'}</p>
      <button class="btn sm outline block" onclick="this.closest('.modal').remove();A_perfReport(7)">${EN()?'Which screens are slow, what is breaking':'ดูว่าหน้าไหนช้า อะไรพังบ้าง'}</button>
      <h4 style="margin:6px 0">${esc(t('set.leaveQuota'))}</h4>
      ${Object.keys(q).map(k=>`<label class="field"><span>${esc(tLeaveType(k))}</span><input type="number" id="lq_${esc(k)}" value="${q[k]}"/></label>`).join('')}
      <h4 style="margin:10px 0 4px">🔔 ${EN()?'Notifications':'การแจ้งเตือน'}</h4>
      <p class="muted" style="font-size:13px">${EN()?'To protect the LINE monthly quota, approval alerts go to the in-app bell 🔔. Turn options on to also use LINE. Emergencies (accidents) always LINE.':'เพื่อประหยัดโควตา LINE รายเดือน คำขออนุมัติจะเข้ากล่องแจ้งเตือนในแอป 🔔 · เปิดตัวเลือกเพื่อส่ง LINE เพิ่ม · เหตุฉุกเฉิน (อุบัติเหตุ) ส่ง LINE ทุกครั้ง'}</p>
      <label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="setAdminLine" style="width:auto" ${cfgOn('AdminLineNotify',false)?'checked':''}/> 📲 ${EN()?'Also LINE-push admins for approvals (uses quota)':'ส่ง LINE ถึงแอดมินเมื่อมีคำขออนุมัติ (ใช้โควตา)'}</label>
      <label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="setDigM" style="width:auto" ${cfgOn('DigestMorning',true)?'checked':''}/> 🌅 ${EN()?`Morning digest 10:00 (${BC_NAME()} + pending)`:`สรุปเช้า 10:00 (${BC_NAME()} + รายการค้าง)`}</label>
      <label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="setDigE" style="width:auto" ${cfgOn('DigestEvening',true)?'checked':''}/> 🌆 ${EN()?'Evening digest 20:00 (daily report)':'สรุปเย็น 20:00 (รายงานประจำวัน)'}</label>
      <button class="btn sm outline block" style="margin-top:4px" onclick="A_reinstallTriggers(this)">🔄 ${EN()?'Apply digest schedule (10:00 / 20:00)':'อัปเดตตารางส่งสรุป (10:00 / 20:00)'}</button>
      <p class="muted" style="font-size:13px">${EN()?'Digests skip weekends & holidays. Run "Apply" once after enabling.':'สรุปจะข้ามวันหยุด/เสาร์-อาทิตย์ · กด "อัปเดตตาราง" 1 ครั้งหลังเปิดใช้'}</p>
      <h4 style="margin:10px 0 4px">🕑 ${EN()?'Today’s working hours':'เวลาทำงานของวันนี้'}</h4>
      <p class="muted" style="font-size:13px">${EN()
        ? 'If a half-day holiday was added or corrected AFTER someone had already clocked in, their late minutes were measured against the old hours. Recalculate rewrites today’s rows from the day’s real hours.'
        : 'ถ้าเพิ่ม/แก้วันหยุดครึ่งวัน "หลังจาก" มีคนลงเวลาไปแล้ว นาทีสายของคนนั้นจะคิดจากเวลาเดิม · กดคำนวณใหม่เพื่อเขียนทับด้วยเวลาจริงของวันนี้'}</p>
      <button class="btn sm outline block" onclick="A_recomputeAtt(this)">🕑 ${EN()?'Recalculate today’s late minutes':'คำนวณนาทีสายของวันนี้ใหม่'}</button>
      <button class="btn sm outline block" style="margin-top:4px" onclick="A_diagDay()">🔍 ${EN()?'What the server thinks today is':'ตรวจสอบว่าระบบมองวันนี้อย่างไร'}</button>
      <button class="btn block" onclick="A_saveSettings(this)">${esc(t('c.save'))}</button>`);
  };
  // ---- accumulated เงินสมทบ: review before overwriting ----------------------------------------
  // The fund total used to be built from the staff half only. Correcting the formula changes a stored
  // figure for every teacher, so this NEVER writes on its own — it shows before/after per person and
  // waits for a second, explicit press. Rows ticked "locked" are listed but left alone.
  window.A_contribRecalc=async(btn)=>{ if(btn)btn.disabled=true;
    try{ const r=await api('recomputeContributions',{preview:true});
      if(!r||!r.changed){ toast(EN()?'All fund totals already correct':'ยอดเงินสมทบสะสมถูกต้องอยู่แล้วทุกคน'); return; }
      const rows=(r.rows||[]).map(x=>`<tr><td>${esc(x.name)}${x.locked?' 🔒':''}<br><small class="muted">${x.months} ${EN()?'months':'เดือน'} · ${EN()?'opening':'ยอดตั้งต้น'} ${baht(x.opening)}</small></td>
        <td style="text-align:right">${baht(x.before)}</td>
        <td style="text-align:right;color:var(--ok)"><b>${baht(x.after)}</b><br><small class="muted">${x.diff>0?'+':''}${baht(x.diff)}</small></td></tr>`).join('');
      const locked=(r.rows||[]).filter(x=>x.locked).length;
      modal(`<h3>💰 ${EN()?'Accumulated fund — review':'ตรวจยอดเงินสมทบสะสม'}</h3>
        <p class="muted" style="font-size:13px">${EN()?`School match ×${r.matchRate}. ${r.changed} staff would change. Nothing is saved until you press Apply.`:`โรงเรียนสมทบ ${r.matchRate} เท่า · จะเปลี่ยน ${r.changed} คน · ยังไม่บันทึกจนกว่าจะกดยืนยัน`}</p>
        <table style="width:100%;font-size:14px;border-collapse:collapse"><thead><tr><th style="text-align:left">${EN()?'Staff':'พนักงาน'}</th><th style="text-align:right">${EN()?'Before':'เดิม'}</th><th style="text-align:right">${EN()?'After':'ใหม่'}</th></tr></thead><tbody>${rows}</tbody></table>
        ${locked?`<p class="muted" style="font-size:13px">🔒 ${EN()?`${locked} have a locked opening balance — that figure is not touched, only the running total is rebuilt.`:`ล็อคยอดตั้งต้นไว้ ${locked} คน — ยอดตั้งต้นไม่ถูกแตะ คำนวณใหม่เฉพาะยอดสะสมรวม`}</p>`:''}
        <button class="btn block" onclick="A_contribApply(this)">✅ ${EN()?'Apply these totals':'ยืนยันบันทึกยอดใหม่'}</button>`);
    }catch(e){err(e);}finally{ if(btn)btn.disabled=false; } };
  window.A_contribApply=async(btn)=>{ if(btn)btn.disabled=true;
    try{ const r=await api('recomputeContributions',{preview:false,adminId:USER.staffId});
      const m=btn.closest('.modal'); if(m)m.remove();
      confirmSaved(EN()?`Updated ${r.written} staff`:`บันทึกแล้ว ${r.written} คน`);
    }catch(e){err(e);}finally{ if(btn)btn.disabled=false; } };

  // ---- "is slip verification actually working?" ------------------------------------------------
  // A slip marked ⚠ is SlipOK's VERDICT, not a broken connection — it read the slip (that is where the
  // reference and the transfer time come from) and then objected. This says which, and how often.
  window.A_slipDiag=async(btn)=>{ if(btn)btn.disabled=true;
    try{ A_slipDiagShow(await api('slipDiag',{staffId:USER.staffId}));
    }catch(e){err(e);}finally{ if(btn)btn.disabled=false; } };
  // Save the branch id (and optionally the key), then redraw with the LIVE probe that comes back —
  // so the answer to "did that fix it?" is on screen immediately, not a second trip through Settings.
  window.A_slipOkSave=async(btn)=>{
    const m=btn.closest('.modal'), b=m.querySelector('#sokBranch').value.trim(), k=m.querySelector('#sokKey').value.trim();
    if(!b){ toast(EN()?'Enter the branch id':'ใส่เลขสาขาก่อน'); return; }
    btn.disabled=true;
    try{ const d=await api('saveSlipOk',{branch:b,apiKey:k,staffId:USER.staffId,adminId:USER.staffId});
      m.remove(); A_slipDiagShow(d);
      toast(d.working?(EN()?'Saved — SlipOK is answering now':'บันทึกแล้ว — SlipOK ตอบกลับได้แล้ว')
        :(EN()?'Saved, but SlipOK still is not answering':'บันทึกแล้ว แต่ SlipOK ยังไม่ตอบกลับ'));
    }catch(e){err(e); btn.disabled=false;} };
  // Pasting the wrong thing into the key box overwrites the only copy the app holds, and the key is
  // never shown, so there is nothing to read back off the screen. One generation of undo.
  window.A_slipOkUndo=async(btn)=>{ btn.disabled=true;
    try{ const d=await api('saveSlipOk',{restorePrev:true,staffId:USER.staffId,adminId:USER.staffId});
      const m=btn.closest('.modal'); if(m)m.remove(); A_slipDiagShow(d);
      toast(EN()?'Previous key restored':'ย้อนกลับไปใช้คีย์เดิมแล้ว');
    }catch(e){err(e); btn.disabled=false;} };
  window.A_slipDiagShow=(d)=>{ const c=d.counts||{};
      const why={'1011':EN()?'no such transaction at the bank':'ธนาคารไม่พบรายการโอน',
        '1012':EN()?'slip already used (sent twice)':'สลิปถูกใช้ไปแล้ว (ส่งซ้ำ)',
        '1013':EN()?'amount differs from the bill':'ยอดในสลิปไม่ตรงกับยอดที่แจ้ง',
        '1014':EN()?'paid into a different account':'โอนเข้าบัญชีอื่น',
        // not a verdict on the slip at all — SlipOK refused to look. These are the ones that mean
        // "the school's package lapsed", and they used to show as a bare number next to real fraud
        // reasons, which reads as if the parents' slips were the problem.
        '1001':EN()?'wrong branch id — SlipOK did not check the slip':'เลขสาขาผิด — SlipOK ไม่ได้ตรวจสลิปใบนี้',
        '1002':EN()?'API key rejected — SlipOK did not check the slip':'API key ไม่ผ่าน — SlipOK ไม่ได้ตรวจสลิปใบนี้',
        '1003':EN()?'package expired — SlipOK did not check the slip':'แพ็กเกจหมดอายุ — SlipOK ไม่ได้ตรวจสลิปใบนี้',
        '1015':EN()?'over quota — SlipOK did not check the slip':'ใช้เกินโควตา — SlipOK ไม่ได้ตรวจสลิปใบนี้'};
      // "configured" only ever meant a URL and a key exist. It said "connected and running normally"
      // while an expired package rejected every slip — so report what SlipOK ACTUALLY answered.
      const lv=d.live||{}; const good=d.working, off=!d.configured;
      modal(`<h3>🔍 ${EN()?'Slip verification':'การตรวจสลิป'}</h3>
        <div class="card" style="background:${good?'var(--ok-bg)':(off?'var(--warn-bg)':'var(--bad-bg)')};border-color:${good?'var(--ok-line)':(off?'var(--warn-line)':'var(--bad-line)')};padding:8px">
          <b style="color:${good?'var(--ok)':(off?'var(--warn)':'var(--bad)')}">${
            off ? '⚠️ '+(EN()?'SlipOK is not configured — slips are stored but never checked':'ยังไม่ได้ตั้งค่า SlipOK — ระบบเก็บสลิปไว้แต่ไม่ได้ตรวจ')
            : good ? '✅ '+(EN()?'SlipOK answered — the account is active':'SlipOK ตอบกลับปกติ — บัญชียังใช้งานได้')
            : '⛔ '+(EN()?'SlipOK is NOT working right now':'SlipOK ใช้งานไม่ได้ในขณะนี้')}</b>
          ${lv.checked&&lv.message?`<div style="font-size:13px;margin-top:4px">${EN()?'SlipOK says':'ข้อความจาก SlipOK'}: <b>${esc(lv.message)}</b>${lv.code?` <span class="muted">(code ${esc(String(lv.code))})</span>`:''}</div>`:''}
          ${lv.checked&&lv.branch?`<div class="muted" style="font-size:12px;margin-top:4px">${EN()?'Branch in use':'สาขาที่ระบบใช้อยู่'}: <b>${esc(lv.branch)}</b> · ${EN()?'API key':'คีย์'} ${esc(lv.keyTail||'')}</div>`:''}
          ${good&&(lv.quota!=null||lv.endDate)?`<div style="font-size:13px;margin-top:4px">${lv.quota!=null?`${EN()?'Slips left':'โควตาคงเหลือ'}: <b>${lv.quota}</b>${lv.overQuota?` <span style="color:var(--warn)">(${EN()?'over by':'ใช้เกิน'} ${lv.overQuota})</span>`:''}`:''}${lv.endDate?` · ${EN()?'valid until':'ใช้ได้ถึง'} <b>${esc(lv.endDate)}</b>`:''}</div>`:''}
          ${!good&&!off?`<div class="muted" style="font-size:13px;margin-top:6px">${
            lv.badBranch?(EN()?'The BRANCH ID is wrong — SlipOK has no branch with this number. Copy "เลขอ้างอิงสาขา" from your SlipOK branch page.':'<b>เลขสาขาผิด</b> — SlipOK ไม่มีสาขาเลขนี้ · ให้คัดลอก "เลขอ้างอิงสาขา" จากหน้าสาขาใน SlipOK มาใส่')
            :lv.badKey?(EN()?'The branch is correct but the API KEY is not accepted. Note: the notification reference (slipok-xxxx-…) is NOT the API key — the key is issued per branch, so a new branch needs its own key.':'<b>เลขสาขาถูกแล้ว แต่ API key ไม่ผ่าน</b> · หมายเหตุ: "เลขอ้างอิงการแจ้งเตือน" (slipok-xxxx-…) <b>ไม่ใช่</b> API key — คีย์ออกแยกตามสาขา สาขาใหม่ต้องใช้คีย์ของสาขานั้น')
            :lv.expired?(EN()?'The branch and key are accepted, but the package is expired or over quota. Renew it on this branch.':'เลขสาขาและคีย์ถูกต้อง แต่<b>แพ็กเกจหมดอายุหรือใช้เกินโควตา</b> — ต่ออายุที่สาขานี้')
            :(EN()?'Compare the branch above with your SlipOK dashboard.':'นำเลขสาขาด้านบนไปเทียบกับหน้า SlipOK ของโรงเรียน')
          }<br>${EN()?'Slips still upload; an admin just has to check them by eye.':'ระหว่างนี้ผู้ปกครองยังแนบสลิปได้ตามปกติ เพียงแต่แอดมินต้องตรวจเอง'}</div>`:''}</div>
        <div class="card" style="padding:8px"><b style="font-size:13px">🔧 ${EN()?'Point the app at the right branch':'ตั้งค่าสาขาที่ถูกต้อง'}</b>
          <p class="muted" style="font-size:13px;margin:4px 0">${EN()?'Copy the branch id and API key from your SlipOK dashboard. Renewing on a new branch gives you a NEW id — the app keeps using the old one until it is changed here.':'คัดลอกเลขสาขาและ API key จากหน้า SlipOK ของโรงเรียนมาใส่ · การต่ออายุแบบเปิดสาขาใหม่จะได้เลขสาขาใหม่ ระบบจะยังใช้เลขเดิมจนกว่าจะแก้ตรงนี้'}</p>
          <label class="field"><span>${EN()?'Branch id':'เลขสาขา (Branch ID)'}</span><input id="sokBranch" value="${esc(lv.branch||'')}" placeholder="${EN()?'e.g. 69307':'เช่น 69307'}"/></label>
          <label class="field"><span>${EN()?'API key':'API key'} <small class="muted">${EN()?'leave blank to keep the current one':'เว้นว่างไว้ = ใช้คีย์เดิม'} ${esc(lv.keyTail||'')}</small></span><input id="sokKey" placeholder="SLIPOK…"/></label>
          <button class="btn sm block" onclick="A_slipOkSave(this)">💾 ${EN()?'Save and test again':'บันทึกแล้วตรวจใหม่'}</button>
          ${d.hasPrevKey?`<button class="btn sm outline block" style="margin-top:6px" onclick="A_slipOkUndo(this)">↩️ ${EN()?'Put the previous API key back':'ย้อนกลับไปใช้ API key เดิม'}</button>`:''}</div>
        <div class="card" style="padding:8px"><b style="font-size:13px">${EN()?'Slips on file':'สลิปทั้งหมดในระบบ'} (${c.total||0})</b>
          <div class="list-item"><span>✓ ${EN()?'genuine':'สลิปแท้'}</span><b style="color:var(--ok)">${c.verified||0}</b></div>
          <div class="list-item"><span>⚠ ${EN()?'SlipOK objected':'SlipOK ทักท้วง'}</span><b style="color:var(--warn)">${c.rejected||0}</b></div>
          <div class="list-item"><span>💵 ${EN()?'recorded by admin (no slip)':'แอดมินบันทึกเอง (ไม่มีสลิป)'}</span><b>${c.manual||0}</b></div>
          <div class="list-item"><span>— ${EN()?'not checked':'ยังไม่ได้ตรวจ'}</span><b>${c.unchecked||0}</b></div></div>
        ${(d.recent||[]).length?`<div class="card" style="padding:8px"><b style="font-size:13px">🕘 ${EN()?'The last few slips — was each one checked?':'สลิปล่าสุด — แต่ละใบถูกตรวจไหม'}</b>
          <p class="muted" style="font-size:13px;margin:4px 0">${EN()?'A total cannot tell "never checked" from "checked and objected to". These can.':'ตัวเลขรวมบอกไม่ได้ว่า "ไม่เคยตรวจ" หรือ "ตรวจแล้วไม่ผ่าน" — ดูรายการนี้แทน'}</p>
          ${d.recent.map(r=>{ const v=String(r.verdict||'');
            const tag = v.slice(0,3)==='YES' ? `<b style="color:var(--ok)">✓ ${EN()?'genuine':'ผ่าน'}</b>`
              : v==='MANUAL' ? `<b>${EN()?'entered by admin':'แอดมินบันทึก'}</b>`
              : v.slice(0,2)==='NO' ? `<b style="color:var(--warn)">⚠ ${esc(why[v.slice(3)]||v.slice(3))}</b>`
              : r.method==='cash' ? `<span class="muted">💵 ${EN()?'cash — nothing to check':'เงินสด — ไม่มีสลิปให้ตรวจ'}</span>`
              : `<b style="color:var(--bad)">— ${EN()?'NOT checked':'ไม่ได้ตรวจ'}</b>`;
            return `<div class="list-item"><span><small class="muted">${esc(r.date||'-')}</small> · ${esc(baht(r.amount))}</span>${tag}</div>`; }).join('')}
          <p class="muted" style="font-size:13px;margin:6px 0 0">${EN()?'A transfer slip that says NOT checked means verification did not run on it — that is the case to report. Cash rows never have a verdict.':'ถ้าสลิป<b>โอนเงิน</b>ขึ้นว่า “ไม่ได้ตรวจ” แปลว่าตอนนั้นระบบไม่ได้ตรวจจริงๆ — กรณีนี้ให้แจ้ง · ส่วนรายการเงินสดไม่มีผลตรวจอยู่แล้ว'}</p></div>`:''}
        ${(d.byCode||[]).length?`<div class="card" style="padding:8px"><b style="font-size:13px">${EN()?'Why they were objected to':'เหตุผลที่ทักท้วง'}</b>
          ${d.byCode.map(x=>`<div class="list-item"><span>${esc(why[x.code]||x.code)} <small class="muted">(${esc(x.code)})</small></span><b>${x.count}</b></div>`).join('')}
          <p class="muted" style="font-size:13px;margin:6px 0 0">${EN()?'An objection is not proof of fraud — a re-sent slip or an amount typed differently both trigger one. Open the slip and judge it yourself.':'การทักท้วงไม่ได้แปลว่าสลิปปลอม — ส่งสลิปซ้ำ หรือกรอกยอดไม่ตรง ก็ขึ้นได้ · เปิดดูสลิปแล้วตัดสินเองได้เลย'}</p></div>`:''}
        <button class="btn outline block" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };

  // ---- Phase 0: "where is it actually slow, and what is actually breaking?" ---------------------
  // Nobody can read a raw log sheet and act on it, so this ranks the answer instead of dumping rows.
  // Slow actions are ranked by TOTAL waiting time (how often × how slow), because a 4s call that runs
  // once a month matters far less than a 900ms call that runs on every screen.
  const msFmt=n=>n>=1000?(n/1000).toFixed(1)+' วิ':Math.round(n)+' ms';
  const msColor=n=>n<600?'var(--ok)':(n<1500?'var(--warn)':'var(--bad)');
  window.A_perfReport=async(days)=>{
    days=days||7;
    try{
      const d=await api('perfSummary',{days,staffId:USER.staffId},{fresh:true});
      if(d.empty){ modal(`<h3>⚡ ${EN()?'System speed':'ความเร็วระบบ'}</h3>
        <div class="card" style="padding:10px"><b>${EN()?'No data yet':'ยังไม่มีข้อมูล'}</b>
          <p class="muted" style="font-size:13px;margin:6px 0 0">${esc(d.note||'')}</p></div>
        <button class="btn outline block" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`); return; }

      window._PERF=d;   // kept so the report can be copied out as text without re-fetching
      const bar=(label,val,max,color)=>`<div style="margin:4px 0"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${label}</span><b style="color:${color||'var(--ink)'}">${val}</b></div>
        <div style="height:5px;background:var(--line);border-radius:3px;overflow:hidden"><div style="height:100%;width:${Math.min(100,max)}%;background:${color||'var(--brand)'}"></div></div></div>`;

      const worstCost=Math.max(1,...(d.slowest||[]).map(x=>x.cost));
      const slow=(d.slowest||[]).slice(0,10).map(x=>bar(
        `${esc(x.action)} <small class="muted">×${x.n}${x.fail?` · <span style="color:var(--bad)">พลาด ${x.fail}</span>`:''}</small>`,
        `${msFmt(x.p50)} <small class="muted">(p95 ${msFmt(x.p95)})</small>`,
        x.cost/worstCost*100, msColor(x.p50))).join('');

      const worstScr=Math.max(1,...(d.slowScreens||[]).map(x=>x.p95));
      const scr=(d.slowScreens||[]).filter(x=>x.n).slice(0,10).map(x=>bar(
        `${esc(x.screen)} <small class="muted">×${x.n}</small>`,
        `${msFmt(x.p50)} <small class="muted">(p95 ${msFmt(x.p95)})</small>`,
        x.p95/worstScr*100, msColor(x.p95))).join('');

      // "how many PEOPLE hit this" is the number that decides what to fix first — a crash 40 times
      // on one phone is a different problem from a crash once on 40 phones.
      const probs=(d.problems||[]).slice(0,12).map(x=>`<div class="list-item" style="align-items:flex-start">
        <span style="flex:1"><b>${esc(x.what)}</b><br><small class="muted">${esc(x.detail||'-')}</small></span>
        <span style="text-align:right;white-space:nowrap"><b style="color:var(--bad)">${x.users} ${EN()?'user(s)':'คน'}</b><br><small class="muted">${x.n} ${EN()?'times':'ครั้ง'}</small></span></div>`).join('')
        || `<p class="muted" style="font-size:13px">✅ ${EN()?'No errors recorded in this window.':'ไม่พบ error ในช่วงเวลานี้'}</p>`;

      const fails=(d.failing||[]).slice(0,10).map(x=>`<div class="list-item"><span>${esc(x.action)}<br><small class="muted">${Object.keys(x.codes||{}).map(c=>esc(c)+' ×'+x.codes[c]).join(' · ')}</small></span>
        <b style="color:${x.rate>10?'var(--bad)':'var(--warn)'}">${x.rate}%</b></div>`).join('')
        || `<p class="muted" style="font-size:13px">✅ ${EN()?'Every request succeeded.':'ทุกคำขอสำเร็จหมด'}</p>`;

      const devs=(d.byDev||[]).map(x=>`<div class="list-item"><span>${esc(x.dev)} <small class="muted">×${x.n}</small></span>
        <span style="text-align:right"><b style="color:${msColor(x.p50)}">${msFmt(x.p50)}</b>${x.fail?` <small style="color:var(--bad)">· ${EN()?'fail':'พลาด'} ${x.rate}%</small>`:''}</span></div>`).join('');
      // The device breakdown was being read as a claim about hardware ("desktops are slow"). It is
      // not: the office computer is the ADMIN, whose screens ask for far more than a parent's. Role
      // — verified server-side on every row — says which it is, and CALLS PER SESSION is the number
      // that actually explains a queue.
      const roles=(d.byRole||[]).map(x=>`<div class="list-item"><span>${esc(x.role)} <small class="muted">×${x.n} · ${x.sessions} ${EN()?'sessions':'เซสชัน'}</small></span>
        <span style="text-align:right"><b style="color:${msColor(x.p50)}">${msFmt(x.p50)}</b><br><small class="muted">${x.perSession} ${EN()?'calls/session':'ครั้ง/เซสชัน'}</small></span></div>`).join('');
      const nets=(d.byNet||[]).filter(x=>x.net).map(x=>`<div class="list-item"><span>${esc(x.net)} <small class="muted">×${x.n}</small></span><b style="color:${msColor(x.p50)}">${msFmt(x.p50)}</b></div>`).join('');
      const boots=(d.boot||[]).map(x=>`<div class="list-item"><span>${esc(x.mark)}</span><b>${msFmt(x.p50)}</b></div>`).join('');

      modal(`<h3>⚡ ${EN()?'System speed & errors':'ความเร็วและข้อผิดพลาดของระบบ'}</h3>
        <p class="muted" style="font-size:12px">${esc(String(d.from||'').slice(0,16))} → ${esc(String(d.to||'').slice(0,16))} · ${d.sessions} ${EN()?'sessions':'เซสชัน'}</p>
        <div class="kpigrid" style="margin-bottom:8px">
          <div class="kpi"><b style="color:${msColor(d.p50)}">${msFmt(d.p50)}</b><small>${EN()?'typical wait':'รอโดยทั่วไป'}</small></div>
          <div class="kpi"><b style="color:${msColor(d.p95)}">${msFmt(d.p95)}</b><small>${EN()?'slowest 5%':'ช้าสุด 5%'}</small></div>
          <div class="kpi"><b style="color:${d.failRate>2?'var(--bad)':'var(--ok)'}">${d.failRate}%</b><small>${EN()?'failed':'ล้มเหลว'}</small></div>
          <div class="kpi"><b style="color:var(--ok)">${d.cacheRate}%</b><small>${EN()?'instant (cached)':'ทันที (แคช)'}</small></div>
        </div>
        <p class="muted" style="font-size:13px">${EN()?`${d.calls} requests measured. "Instant" means it was served from the phone without waiting for the server.`:`วัดจาก ${d.calls} คำขอ · "ทันที" คือได้ข้อมูลจากเครื่องเลย ไม่ต้องรอเซิร์ฟเวอร์`}</p>

        <h4 style="margin:12px 0 4px">🐌 ${EN()?'Where the waiting actually goes':'เวลารอหมดไปกับอะไร'}</h4>
        <p class="muted" style="font-size:12px;margin:0 0 6px">${EN()?'Ranked by total time waited (how often × how slow) — fix the top one first.':'เรียงตามเวลารอรวม (บ่อยแค่ไหน × ช้าแค่ไหน) — แก้ตัวบนสุดก่อนคุ้มที่สุด'}</p>
        ${slow||`<p class="muted" style="font-size:13px">-</p>`}

        <h4 style="margin:12px 0 4px">📱 ${EN()?'Slowest screens to open':'หน้าจอที่เปิดช้าที่สุด'}</h4>
        ${scr||`<p class="muted" style="font-size:13px">-</p>`}

        <h4 style="margin:12px 0 4px">🚨 ${EN()?'What is breaking':'อะไรพังบ้าง'}</h4>
        ${probs}

        <h4 style="margin:12px 0 4px">❌ ${EN()?'Requests that failed':'คำขอที่ล้มเหลว'}</h4>
        ${Number(d.healed)>0?`<div class="card" style="background:var(--ok-bg);border-color:var(--ok-line);padding:8px;margin-bottom:6px">
          <b style="color:var(--ok)">🔄 ${EN()?`${d.healed} of these recovered by themselves`:`${d.healed} รายการในนี้ ระบบกู้คืนให้เองแล้ว`}</b>
          <div class="muted" style="font-size:13px;margin-top:2px">${EN()?`An expired session signed back in behind the scenes and the request went through — nobody saw an error. Failure rate excluding these: <b>${d.realFailRate}%</b>.`:`เซสชันหมดอายุแล้วระบบเข้าใหม่ให้เงียบๆ คำขอผ่านเรียบร้อย ผู้ใช้ไม่เห็น error · อัตราพลาดจริงหลังหักส่วนนี้: <b>${d.realFailRate}%</b>`}</div>
          ${(d.healedBy||[]).length?`<div class="muted" style="font-size:12px;margin-top:4px">${d.healedBy.map(x=>esc(x.action)+' ×'+x.n).join(' · ')}</div>`:''}</div>`:''}
        ${fails}

        ${roles?`<h4 style="margin:12px 0 4px">👥 ${EN()?'By role — and how many calls each visit costs':'แยกตามบทบาท — และหนึ่งครั้งที่เข้าใช้ ยิงกี่คำขอ'}</h4>${roles}
        <p class="muted" style="font-size:12px">${EN()?'Calls per session is the number that explains a queue: Apps Script runs one at a time per user, so the more a visit asks for, the longer everything else waits.':'“ครั้ง/เซสชัน” คือตัวเลขที่อธิบายอาการช้า — Apps Script รันทีละคำสั่งต่อผู้ใช้หนึ่งคน ยิ่งเข้าใช้ครั้งหนึ่งยิงเยอะ ทุกอย่างยิ่งต้องรอคิว'}</p>`:''}

        <h4 style="margin:12px 0 4px">📟 ${EN()?'By device / connection':'แยกตามเครื่อง / สัญญาณ'}</h4>
        ${devs||''}${nets||''}
        <p class="muted" style="font-size:12px">${EN()?'A device is not a speed: the desktop is the office admin, whose screens ask for the most. Read this next to the role list above.':'ตัวเครื่องไม่ได้บอกความเร็ว — เครื่อง Desktop คือแอดมินที่ออฟฟิศ ซึ่งเปิดหน้าที่ดึงข้อมูลหนักที่สุด · ให้ดูคู่กับตารางบทบาทด้านบน'}</p>
        ${boots?`<h4 style="margin:12px 0 4px">🚀 ${EN()?'App start-up':'เวลาเปิดแอป'}</h4>${boots}`:''}

        <p class="muted" style="font-size:12px;margin-top:12px">${EN()?`Log holds ${d.rows} of max ${d.cap} rows. No names, ids or amounts are recorded — only action names and timings.`:`บันทึกไว้ ${d.rows} แถว (สูงสุด ${d.cap}) · ไม่มีการเก็บชื่อ รหัส หรือยอดเงินใดๆ เก็บเฉพาะชื่อคำสั่งและเวลาที่ใช้`}</p>
        <div class="row" style="gap:8px;margin-top:8px">
          <button class="btn sm outline" style="flex:1" onclick="this.closest('.modal').remove();A_perfReport(1)">${EN()?'1 day':'1 วัน'}</button>
          <button class="btn sm outline" style="flex:1" onclick="this.closest('.modal').remove();A_perfReport(7)">${EN()?'7 days':'7 วัน'}</button>
          <button class="btn sm outline" style="flex:1" onclick="this.closest('.modal').remove();A_perfReport(30)">${EN()?'30 days':'30 วัน'}</button>
        </div>
        <button class="btn sm outline block" style="margin-top:8px" onclick="A_perfCopy(this)">📋 ${EN()?'Copy this report as text (to send on)':'คัดลอกรายงานเป็นข้อความ (ไว้ส่งต่อ)'}</button>
        <button class="btn sm outline block" style="margin-top:8px" onclick="A_perfClear(this)">🧹 ${EN()?'Clear the log and start a fresh measurement window':'ล้างบันทึกแล้วเริ่มเก็บข้อมูลรอบใหม่'}</button>
        <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
    }catch(e){err(e);}
  };
  // The report is only useful if it can leave the phone — a screenshot of a scrolling modal loses
  // most of it. This flattens the same ranked numbers into plain text. It carries no names, ids or
  // amounts (the log itself holds none), so it is safe to paste anywhere.
  window.A_perfCopy=async(btn)=>{
    const d=window._PERF; if(!d)return;
    const L=[], ms=n=>n>=1000?(n/1000).toFixed(1)+'s':Math.round(n)+'ms';
    L.push('ATOM PERF '+String(d.from||'').slice(0,16)+' -> '+String(d.to||'').slice(0,16));
    // the window may be shorter than the one asked for — the log is capped and drops its oldest rows
    if(d.truncated) L.push('WINDOW: capped at '+d.cap+' rows — this covers LESS than '+d.days+' days');
    L.push('calls='+d.calls+' sessions='+d.sessions+' perSession='+(d.perSession!=null?d.perSession:'?')
      +' p50='+ms(d.p50)+' p95='+ms(d.p95)+' fail='+d.failRate+'% cache='+d.cacheRate+'%');
    // refused ON PURPOSE (outside the geofence, already clocked in, a field left empty). Kept out of
    // fail% — it is the rule working, and mixed in it buried the failures that were ours.
    if(Number(d.refused)>0) L.push('REFUSED (working as intended): '+d.refused+' '
      +(d.refusedBy||[]).map(x=>x.code+' x'+x.n).join(' '));
    if((d.byRole||[]).length) L.push('ROLES: '+d.byRole.map(x=>x.role+' x'+x.n+'/'+x.sessions+'s ='+x.perSession+'/session p50='+ms(x.p50)).join(' | '));
    if(Number(d.healed)>0) L.push('SELF-HEALED: '+d.healed+' (real fail='+d.realFailRate+'%) '+(d.healedBy||[]).map(x=>x.action+' x'+x.n).join(' '));
    L.push('SLOWEST (by total wait):');
    (d.slowest||[]).slice(0,10).forEach(x=>L.push('  '+x.action+' x'+x.n+' p50='+ms(x.p50)+' p95='+ms(x.p95)+(x.fail?' fail='+x.fail:'')));
    L.push('SCREENS:');
    // calls/visit is what a screen's wait is really made of — every request queues behind the last
    (d.slowScreens||[]).filter(x=>x.n).slice(0,10).forEach(x=>L.push('  '+x.screen+' x'+x.n+' p50='+ms(x.p50)+' p95='+ms(x.p95)
      +(x.perVisit!=null?' calls/visit='+x.perVisit+(x.over?' ⚠️OVER budget '+x.budget:''):'')));
    const over=(d.slowScreens||[]).filter(x=>x.over);
    if(over.length) L.push('OVER BUDGET: '+over.map(x=>x.screen+' '+x.perVisit+'>'+x.budget).join(' · '));
    L.push('PROBLEMS:');
    (d.problems||[]).slice(0,12).forEach(x=>L.push('  ['+x.users+' users x'+x.n+'] '+x.what+' :: '+(x.detail||'-')));
    L.push('FAILING:');
    (d.failing||[]).slice(0,10).forEach(x=>L.push('  '+x.action+' '+x.rate+'%'+(x.refused?' (+'+x.refused+' refused)':'')+' '+Object.keys(x.codes||{}).map(c=>c+'x'+x.codes[c]).join(',')));
    L.push('DEVICES: '+(d.byDev||[]).map(x=>x.dev+' x'+x.n+' p50='+ms(x.p50)+(x.fail?' fail'+x.rate+'%':'')).join(' | '));
    L.push('NETWORK: '+(d.byNet||[]).filter(x=>x.net).map(x=>x.net+' x'+x.n+' p50='+ms(x.p50)).join(' | '));
    L.push('BOOT: '+(d.boot||[]).map(x=>x.mark+'='+ms(x.p50)).join(' | '));
    L.push('rows='+d.rows+'/'+d.cap);
    const txt=L.join('\n');
    try{ await navigator.clipboard.writeText(txt); toast(EN()?'Copied':'คัดลอกแล้ว'); return; }catch(e){}
    // Clipboard is blocked in plenty of in-app browsers — show it selectable instead of failing.
    modal(`<h3>📋 ${EN()?'Copy this text':'คัดลอกข้อความนี้'}</h3>
      <textarea readonly style="width:100%;height:50vh;font-family:monospace;font-size:12px" onclick="this.select()">${esc(txt)}</textarea>
      <button class="btn outline block" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  // Used after acting on a finding ("did that fix it?"), so the next report is not diluted by the
  // old numbers. Only the log is deleted — nothing the school depends on lives in it.
  window.A_perfClear=async(btn)=>{
    if(!confirm(EN()?'Delete all collected speed/error data and start again?':'ลบข้อมูลความเร็ว/ข้อผิดพลาดทั้งหมด แล้วเริ่มเก็บใหม่?'))return;
    if(btn)btn.disabled=true;
    try{ const r=await api('deletePerfLog',{staffId:USER.staffId});
      const m=btn.closest('.modal'); if(m)m.remove();
      toast((EN()?'Cleared ':'ล้างแล้ว ')+(r&&r.cleared!=null?r.cleared:0)+(EN()?' rows':' แถว'));
    }catch(e){err(e);}finally{ if(btn)btn.disabled=false; } };

  /* ================= Phase 7a: food menu (Admin edits by class + month) =======================
   * One class, one month, one screen. The kitchen plans per class, and a parent must never have to
   * work out which of five menus applies to their child — so the parent view resolves the class for
   * them and the A4 sheet is printed per class.
   */
  /* ---- master food list: what the daily journal picks from -------------------------------- */
  window.A_foodItems=async()=>{
    const items=await api('foodItems',{all:true},{fresh:true});
    // dishes read alphabetically within their category, in whichever language is on screen
    const byCat=c=>sortBy(items.filter(i=>i.category===c), i=>(LANG()==='en'?(i.nameEN||i.nameTH):(i.nameTH||i.nameEN)));
    const sec=(c)=>{ const its=byCat(c); return `<h4 style="margin:10px 0 4px">${esc(FOOD_CAT[c]())} <small class="muted">(${its.length})</small></h4>${
      its.length?its.map(i=>`<div class="list-item"${i.active?'':' style="opacity:.5"'}>
        <span><b>${esc(i.nameTH)}</b>${i.nameEN?`<br><small class="muted">${esc(i.nameEN)}</small>`:`<br><small style="color:var(--warn)">${EN()?'no English name yet':'ยังไม่มีชื่อภาษาอังกฤษ'}</small>`}</span>
        <span><button class="btn sm outline" onclick="A_fiEdit('${esc(i.itemId)}')">✏️</button>${i.active?`<button class="btn sm pink" onclick="A_fiRetire('${esc(i.itemId)}')" title="${EN()?'Retire':'เลิกใช้'}">🚫</button>`:''}</span></div>`).join('')
        :`<small class="muted">-</small>`}`; };
    modal(`<h3>🍚 ${EN()?'Food list (master)':'รายการอาหาร (ตัวหลัก)'}</h3>
      <p class="muted" style="font-size:13px">${EN()?'This is what teachers pick from in the daily journal. A dish a teacher types in is added here automatically.':'รายการนี้คือตัวเลือกที่คุณครูใช้ในสมุดบันทึกประจำวัน · เมนูที่คุณครูพิมพ์เพิ่มเองจะถูกบันทึกเข้ามาที่นี่อัตโนมัติ'}</p>
      <div class="row" style="gap:8px;margin-bottom:6px">
        <button class="btn sm" style="flex:1" onclick="A_fiEdit('')">+ ${EN()?'Add dish':'เพิ่มเมนู'}</button>
        <button class="btn sm outline" style="flex:1" onclick="A_fiSeed(this)">🍚 ${EN()?'Load the school list':'เพิ่มรายการมาตรฐานของโรงเรียน'}</button></div>
      <div style="max-height:60vh;overflow:auto">${['savoury','dessert','fruit','other'].map(sec).join('')}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_fiEdit=async(id)=>{ const items=await api('foodItems',{all:true});
    const i=items.find(x=>x.itemId===id)||{category:'savoury',active:true};
    modal(`<h3>${id?'✏️ '+(EN()?'Edit dish':'แก้ไขเมนู'):'➕ '+(EN()?'Add dish':'เพิ่มเมนู')}</h3>
      <label class="field"><span>${EN()?'Name (Thai)':'ชื่อเมนู (ภาษาไทย)'}</span><input id="fiTH" value="${esc(i.nameTH||'')}"/></label>
      <label class="field"><span>${EN()?'Name (English)':'ชื่อเมนู (ภาษาอังกฤษ)'}</span><input id="fiEN" value="${esc(i.nameEN||'')}" placeholder="${EN()?'e.g. Chicken rice porridge':'เช่น Chicken rice porridge'}"/></label>
      <p class="muted" style="font-size:12px">${EN()?'Parents reading the app in English see the English name.':'ผู้ปกครองที่ใช้แอปภาษาอังกฤษจะเห็นชื่อภาษาอังกฤษ'}</p>
      <label class="field"><span>${EN()?'Category':'หมวด'}</span><select id="fiCat" translate="no">${
        ['savoury','dessert','fruit','other'].map(c=>`<option value="${c}"${i.category===c?' selected':''}>${esc(FOOD_CAT[c]())}</option>`).join('')}</select></label>
      <button class="btn block" onclick="A_fiSave('${esc(id||'')}',this)">${esc(t('c.save'))}</button>`);
  };
  window.A_fiSave=async(id,btn)=>{ const m=btn.closest('.modal'); const g=x=>(m.querySelector('#'+x)||{}).value||'';
    if(btn)btn.disabled=true;
    try{ await api('saveFoodItem',{staffId:USER.staffId,item:{itemId:id||undefined,nameTH:g('fiTH'),nameEN:g('fiEN'),category:g('fiCat')}});
      m.remove(); confirmSaved(t('c.saved')); A_foodItems();
    }catch(e){err(e); if(btn)btn.disabled=false;} };
  window.A_fiRetire=async(id)=>{ if(!confirm(EN()?'Stop offering this dish? Journals already written keep it.':'เลิกใช้เมนูนี้? บันทึกที่เขียนไปแล้วยังคงแสดงตามเดิม'))return;
    try{ await api('deleteFoodItem',{staffId:USER.staffId,itemId:id});
      const m=document.querySelector('.modal'); if(m)m.remove(); A_foodItems(); }catch(e){err(e);} };
  window.A_fiSeed=async(btn)=>{ if(btn)btn.disabled=true;
    try{ const r=await api('seedFoodItems',{staffId:USER.staffId});
      const m=document.querySelector('.modal'); if(m)m.remove();
      toast((EN()?'Added ':'เพิ่มแล้ว ')+r.added+(EN()?' dishes':' รายการ')); A_foodItems();
    }catch(e){err(e);}finally{ if(btn)btn.disabled=false; } };

  let FM_MONTH=null, FM_FOOD=[];
  // The kitchen cooks ONCE a day and every class eats the same food, so the menu is planned once —
  // there is no class to pick. Who EATS which meal is still a class rule, applied where the menu is
  // shown (the journal and the parent's copy), which is what these notes spell out.
  const FM_MEALS=[['breakfast',()=>EN()?'Breakfast':'อาหารเช้า'],['snackAM',()=>EN()?'Morning snack':'ว่างเช้า'],
                  ['lunch',()=>EN()?'Lunch':'อาหารกลางวัน'],['snackPM',()=>EN()?'Afternoon snack':'ว่างบ่าย'],
                  ['dinner',()=>EN()?'Dinner':'อาหารเย็น']];
  // who actually eats each planned meal — shown under the field so the person entering the menu can
  // see it without having to remember the rule
  const FM_WHO={ dinner:()=>EN()?'Nursery 1 only':'เฉพาะ Nursery 1',
                 _default:()=>EN()?'every class except Nursery Baby':'ทุกชั้น ยกเว้น Nursery Baby' };
  const fmWho = k => (FM_WHO[k]||FM_WHO._default)();
  // fmShows() lived here: it turned the engine's per-class slot list into "does this class get this
  // planned meal?", for the parent's copy of the menu. That screen is gone (the journal is where a
  // family reads the day's food), and the planner shows every meal, so nothing asked the question
  // any more. The RULE itself is untouched — it lives in mealSlotsFor_ in the engine, which the
  // journal still reads to decide which meal slots a class records.
  const fmDays=(month)=>{ const [y,m]=month.split('-').map(Number); const n=new Date(y,m,0).getDate(); const out=[];
    for(let d=1;d<=n;d++) out.push(`${month}-${String(d).padStart(2,'0')}`); return out; };
  const fmDow=ds=>['อา','จ','อ','พ','พฤ','ศ','ส'][new Date(ds+'T00:00:00').getDay()];
  const fmWeekend=ds=>{ const g=new Date(ds+'T00:00:00').getDay(); return g===0||g===6; };

  window.A_foodMenu=async()=>{
    // the master food list is what the menu is planned FROM — same catalogue the journal picks from,
    // so a planned dish and a recorded dish are always the same string
    FM_MONTH=FM_MONTH||monthStr();
    const [food,d]=await Promise.all([
      api('foodItems',{}).catch(()=>[]),
      api('foodMenu',{month:FM_MONTH},{fresh:true})]);
    FM_FOOD=food||[];
    const by={}; (d.days||[]).forEach(x=>by[x.date]=x);
    // no class is chosen here any more, so the planner shows every meal; the class rule is applied
    // where the menu is READ (journal + parent), not where it is written
    window._FM_SLOTS=(d.slots||[]).map(x=>x.key);
    // a day still coming from an old per-class menu, kept as a fallback so nothing typed before this
    // change disappeared — saying so is better than the person wondering where it came from
    const legacyDays=(d.days||[]).filter(x=>x.legacyClass).length;
    // The kitchen does not cook at the weekend, so those rows are just noise to scroll past. A public
    // holiday IS worth showing — with its name — because that is a day a parent might otherwise expect
    // a menu for.
    const hol={}; (await api('holidays',{}).catch(()=>[])).forEach(h=>{ const k=ymd(h.Date||h.date); if(k) hol[k]=h.NameTH||h.Name||h.name||h.NameEN||''; });
    const rows=fmDays(FM_MONTH).filter(ds=>!fmWeekend(ds)).map(ds=>{ const v=by[ds]||{};
      if(hol[ds]) return `<div class="card" style="padding:8px;background:var(--bad-bg);border-color:var(--bad-line)">
        <div class="spread"><b>${esc(ds.slice(8))} ${esc(fmDow(ds))}.</b><span class="pill bad" style="font-size:11px">🏖️ ${esc(hol[ds])}</span></div>
        <small class="muted">${EN()?'School closed — no menu needed':'วันหยุด — ไม่ต้องลงเมนู'}</small></div>`;
      return `<div class="card" style="padding:8px">
        <div class="spread"><b>${esc(ds.slice(8))} ${esc(fmDow(ds))}.</b><small class="muted">${esc(ds)}</small></div>
        <div class="grid2" style="margin-top:4px">${FM_MEALS.map(([k,lb])=>
          `<label class="field"><span>${esc(lb())} <small class="muted" style="font-weight:400">· ${esc(fmWho(k))}</small></span><select id="fm_${k}_${ds}" data-prev="${esc(v[k]||'')}" onchange="A_fmFoodPick(this)">${
            jFoodOptions(v[k]||'',FM_FOOD,EN()?'– no dish –':'– ไม่มีเมนู –')}</select></label>`).join('')}</div>
        <label class="field"><span>${EN()?'Note':'หมายเหตุ'}</span><input id="fm_note_${ds}" value="${esc(v.note||'')}" placeholder="${EN()?'e.g. birthday cake':'เช่น มีเค้กวันเกิด'}"/></label>
        ${v.legacyClass?`<small class="muted">📋 ${EN()?'from the old '+v.legacyClass+' menu — saving makes it the school-wide one':'มาจากเมนูเดิมของ '+v.legacyClass+' · กดบันทึกแล้วจะกลายเป็นเมนูรวมของทั้งโรงเรียน'}</small>`:''}</div>`;
    }).join('');
    modal(`<h3>🍚 ${EN()?'Food menu':'เมนูอาหาร'} <small class="muted" style="font-size:13px;font-weight:400">· ${EN()?'whole school':'ทุกชั้นเรียน'}</small></h3>
      <label class="field"><span>${esc(t('c.month'))}</span><input type="month" value="${esc(FM_MONTH)}" onchange="A_fmPick(this.value)"/></label>
      <p class="muted" style="font-size:13px">${EN()?'One menu a day for the whole school. Nursery Baby records no meals; Nursery 1 eats dinner too; Nursery 2 / 3 / Premium go home before dinner. Leave a day blank to remove it.':'ลงเมนูวันละครั้ง ใช้ร่วมกันทุกชั้นเรียน · Nursery Baby ไม่แสดงมื้ออาหาร · Nursery 1 ได้ครบทุกมื้อรวมมื้อเย็น · Nursery 2 / 3 / Premium ได้ทุกมื้อยกเว้นมื้อเย็น · เว้นว่างไว้ = ไม่มีเมนูวันนั้น'}</p>
      ${legacyDays?`<div class="card" style="padding:8px;background:var(--warn-bg);border-color:var(--warn-line);color:var(--warn);font-size:13px">📋 ${EN()?legacyDays+' day(s) still show a menu entered per class before this change. They are kept as-is until you save.':'มี '+legacyDays+' วัน ที่ยังแสดงเมนูเดิมซึ่งเคยลงแยกตามชั้นเรียน · ระบบเก็บไว้ให้ จนกว่าจะกดบันทึกทับ'}</div>`:''}
      <div class="row" style="gap:8px;margin-bottom:6px">
        <button class="btn sm" style="flex:1" onclick="A_fmSave(this)">💾 ${esc(t('c.save'))}</button>
        <button class="btn sm outline" style="flex:1" onclick="A_fmExport('pdf',this)">📕 A4 PDF</button>
        <button class="btn sm outline" style="flex:1" onclick="A_fmExport('jpg',this)">🖼️ ${EN()?'Image':'รูป'}</button></div>
      <div style="max-height:56vh;overflow:auto">${rows}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_fmPick=(month)=>{ if(month)FM_MONTH=month;
    const m=document.querySelector('.modal'); if(m)m.remove(); A_foodMenu(); };
  /**
   * "➕ เพิ่มเมนูใหม่…" from inside the menu editor. The dish goes into the master list, so it is a
   * normal choice everywhere from then on — and every cell in the open month is refreshed IN PLACE,
   * keeping whatever has been picked but not saved yet.
   */
  window.A_fmFoodPick=async(el)=>{
    if(el.value!=='__new'){ el.dataset.prev=el.value; return; }
    el.value=el.dataset.prev||'';                                  // never leave "__new" as the value
    const th=String(prompt(EN()?'New dish (Thai name)':'ชื่อเมนูใหม่ (ภาษาไทย)')||'').trim();
    if(!th) return;
    if(!FM_FOOD.some(i=>String(i.nameTH)===th)){
      const en=String(prompt(EN()?'English name (optional)':'ชื่อภาษาอังกฤษ (ถ้ามี)')||'').trim();
      try{ await api('saveFoodItem',{staffId:USER.staffId,item:{nameTH:th,nameEN:en,category:'other'}}); }
      catch(e){ err(e); return; }
      FM_FOOD.push({itemId:'',nameTH:th,nameEN:en,category:'other',active:true});
    }
    document.querySelectorAll('select[id^="fm_"]').forEach(s=>{ const cur=s.value;
      s.innerHTML=jFoodOptions(cur,FM_FOOD,EN()?'– no dish –':'– ไม่มีเมนู –'); s.value=cur; s.dataset.prev=cur; });
    el.value=th; el.dataset.prev=th;
  };
  window.A_fmCollect=()=>fmDays(FM_MONTH).map(ds=>{ const g=k=>{const e=document.getElementById('fm_'+k+'_'+ds); return e?e.value.trim():'';};
    return {date:ds, breakfast:g('breakfast'), snackAM:g('snackAM'), lunch:g('lunch'), dinner:g('dinner'), snackPM:g('snackPM'), note:g('note')}; });
  window.A_fmSave=async(btn)=>{ if(btn)btn.disabled=true;
    try{ await api('saveFoodMenu',{staffId:USER.staffId,month:FM_MONTH,days:A_fmCollect()});
      confirmSaved(t('c.saved'));
    }catch(e){err(e);}finally{ if(btn)btn.disabled=false; } };
  window.A_fmExport=async(kind,btn)=>{ const old=btn?btn.innerHTML:'';
    if(btn){ btn.disabled=true; btn.innerHTML='⏳'; }
    try{
      await window.__atomLoadScript('report_card.js',()=>!!window.AtomReportCard);
      await AtomReportCard.saveMenu({className:(EN()?'Whole school':'ทุกชั้นเรียน'), month:FM_MONTH, days:A_fmCollect(),
        // LOCAL time. toISOString() is UTC, so a sheet printed at 14:08 in Bangkok was stamped
        // 07:08 — seven hours out, on a document people file and refer back to.
        school:{name:'Atom Nursery'}, generatedAt:nowStamp()}, kind);
      toast(EN()?'Saved to your device':'บันทึกลงเครื่องแล้ว');
    }catch(e){ err(e); }finally{ if(btn){ btn.disabled=false; btn.innerHTML=old; } } };

  /* ================= Phase 7b: satisfaction survey (Admin) ================================= */
  const SV_TYPE=t0=>({rating:EN()?'1-5 faces':'ให้คะแนน 1-5',vote:EN()?'Choose one':'เลือกตอบ',comment:EN()?'Comment only':'ความคิดเห็น'})[t0]||t0;
  const SV_FACE=['😡','🙁','😐','🙂','😍'];
  window.A_surveys=async()=>{
    const list=await api('surveys',{staffId:USER.staffId},{fresh:true});
    const row=s=>`<div class="card" style="padding:8px">
      <div class="spread"><b>${esc(s.title)}</b><span class="pill ${s.status==='OPEN'?'ok':'info'}" style="font-size:11px">${s.status==='OPEN'?(EN()?'open':'เปิดรับ'):(EN()?'closed':'ปิดแล้ว')}</span></div>
      <small class="muted">${s.questionCount>1?(EN()?s.questionCount+' questions':s.questionCount+' ข้อ'):esc(SV_TYPE(s.type))} · ${esc(s.scope==='all'?(EN()?'everyone':'ทุกคน'):(s.scope==='class'?(EN()?'class ':'ชั้น ')+s.target:(EN()?'one child':'รายบุคคล')))}${s.anonymous?' · '+(EN()?'anonymous':'ไม่ระบุชื่อ'):''} · ${EN()?'answers':'คำตอบ'} <b>${s.responses}</b></small>
      <div class="row" style="gap:6px;margin-top:6px">
        <button class="btn sm outline" onclick="A_svResults('${esc(s.surveyId)}')">📊 ${EN()?'Results':'ผลลัพธ์'}</button>
        <button class="btn sm outline" onclick="A_svForm('${esc(s.surveyId)}')">✏️ ${esc(t('c.edit')||'แก้ไข')}</button>
        <button class="btn sm outline" onclick="A_svClose('${esc(s.surveyId)}',${s.status==='OPEN'?'false':'true'})">${s.status==='OPEN'?'🔒 '+(EN()?'Close':'ปิดรับ'):'🔓 '+(EN()?'Reopen':'เปิดใหม่')}</button>
        <button class="btn sm pink" onclick="A_svDelete('${esc(s.surveyId)}')">🗑️</button></div></div>`;
    modal(`<h3>💬 ${EN()?'Satisfaction survey':'แบบสอบถามความพึงพอใจ'}</h3>
      <div class="row" style="gap:8px;margin-bottom:6px">
        <button class="btn sm" style="flex:1" onclick="A_svForm('')">+ ${EN()?'New survey':'สร้างแบบสอบถาม'}</button>
        <button class="btn sm outline" style="flex:1" onclick="A_svMonth()">📅 ${EN()?'Monthly summary':'สรุปรายเดือน'}</button></div>
      <div style="max-height:60vh;overflow:auto">${list.length?list.map(row).join(''):`<div class="card muted">${EN()?'No surveys yet':'ยังไม่มีแบบสอบถาม'}</div>`}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_svForm=async(id)=>{
    // the manage screen may not have been opened yet, so never assume the cache is warm
    const [list,studs]=await Promise.all([
      id?api('surveys',{staffId:USER.staffId}):Promise.resolve([]),
      (A_CACHE.students&&A_CACHE.students.length)?Promise.resolve(A_CACHE.students):api('listStudents').catch(()=>[])]);
    A_CACHE.students=studs||[];
    const s=list.find(x=>x.surveyId===id)||{type:'rating',scope:'all',options:[],status:'OPEN'};
    const classes=[...new Set((A_CACHE.students||[]).map(x=>x.Class).filter(Boolean))];
    const kids=(A_CACHE.students||[]).filter(x=>x.Status!=='WITHDRAWN');
    modal(`<h3>${id?'✏️ '+(EN()?'Edit survey':'แก้ไขแบบสอบถาม'):'➕ '+(EN()?'New survey':'สร้างแบบสอบถาม')}</h3>
      <label class="field"><span>${EN()?'Title':'หัวข้อ'}</span><input id="svT" value="${esc(s.title||'')}" placeholder="${EN()?'e.g. How happy are you with the food?':'เช่น พอใจกับอาหารกลางวันแค่ไหน'}"/></label>
      <label class="field"><span>${EN()?'Description (optional)':'คำอธิบาย (ถ้ามี)'}</span><textarea id="svD">${esc(s.description||'')}</textarea></label>
      <!-- Up to five questions. More than that and people stop answering, which is worse than
           asking less. -->
      <div class="spread" style="margin:10px 0 4px"><b>❓ ${EN()?'Questions':'คำถาม'} <small class="muted" id="svQCount"></small></b>
        <button class="btn sm outline" onclick="A_svQAdd()">+ ${EN()?'Add question':'เพิ่มคำถาม'}</button></div>
      <div id="svQBox"></div>
      <label class="field"><span>${EN()?'Ask who?':'ถามใคร'}</span><select id="svScope" onchange="A_svScopeChg(this.value)">
        <option value="all"${s.scope==='all'?' selected':''}>${EN()?'Everyone':'ผู้ปกครองทุกคน'}</option>
        <option value="class"${s.scope==='class'?' selected':''}>${EN()?'One class':'เฉพาะชั้นเรียน'}</option>
        <option value="student"${s.scope==='student'?' selected':''}>${EN()?'One child':'รายบุคคล'}</option></select></label>
      <div id="svTgtBox" ${s.scope==='all'?'hidden':''}><label class="field"><span>${EN()?'Target':'เป้าหมาย'}</span><select id="svTgt">
        ${s.scope==='student'?kids.map(k=>`<option value="${esc(k.StudentID)}"${s.target===k.StudentID?' selected':''}>${esc(dispNick(k))} (${esc(k.Class||'')})</option>`).join('')
                             :classes.map(c=>`<option value="${esc(c)}"${s.target===c?' selected':''}>${esc(c)}</option>`).join('')}</select></label></div>
      <div class="grid2">
        <label class="field"><span>${EN()?'Open from':'เริ่ม'}</span><input type="date" id="svS" value="${esc(s.startDate||todayStr())}"/></label>
        <label class="field"><span>${EN()?'Until (optional)':'ถึง (ถ้ามี)'}</span><input type="date" id="svE" value="${esc(s.endDate||'')}"/></label></div>
      <label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="svAnon" style="width:auto" ${s.anonymous?'checked':''}/> 🕶️ ${EN()?'Anonymous — never show who said what':'ไม่ระบุชื่อผู้ตอบ — ระบบจะไม่แสดงว่าใครตอบอะไร'}</label>
      <p class="muted" style="font-size:12px">${EN()?'Once promised, this is kept: an anonymous survey never returns names, even to an admin.':'เมื่อเลือกแล้วระบบจะไม่คืนชื่อผู้ตอบให้ใครเลย แม้แต่แอดมิน'}</p>
      <button class="btn block" onclick="A_svSave('${esc(id||'')}',this)">${esc(t('c.save'))}</button>`);
    // seed the question editor from the survey (a legacy one-question survey comes back as one row)
    SV_Q = (s.questions&&s.questions.length ? s.questions : [{text:s.title||'',type:s.type||'rating',options:s.options||[]}])
      .map(q=>({text:q.text||'',type:q.type||'rating',options:(q.options||[]).slice()}));
    A_svQRender();
  };
  /* ---- the question editor -------------------------------------------------------------- */
  const SV_MAX_Q=5;
  let SV_Q=[];
  window.A_svQRender=()=>{ const box=document.getElementById('svQBox'); if(!box)return;
    box.innerHTML = SV_Q.map((q,i)=>`<div class="card" style="padding:8px;margin:6px 0">
      <div class="spread"><b style="font-size:13px">${EN()?'Question':'ข้อ'} ${i+1}</b>
        ${SV_Q.length>1?`<button class="btn sm pink" onclick="A_svQDel(${i})" title="${EN()?'Remove':'ลบข้อนี้'}">🗑️</button>`:''}</div>
      <input id="svQT${i}" value="${esc(q.text)}" oninput="A_svQSet(${i},'text',this.value)" placeholder="${EN()?'e.g. How happy are you with the food?':'เช่น พอใจกับอาหารกลางวันแค่ไหน'}" style="width:100%;margin:4px 0"/>
      <select id="svQY${i}" onchange="A_svQSet(${i},'type',this.value)" style="width:100%">${
        ['rating','vote','comment'].map(x=>`<option value="${x}"${q.type===x?' selected':''}>${esc(SV_TYPE(x))}</option>`).join('')}</select>
      <div id="svQO${i}" ${q.type==='vote'?'':'hidden'} style="margin-top:4px">
        <textarea id="svQOpts${i}" rows="3" oninput="A_svQSet(${i},'options',this.value)" placeholder="${EN()?'Options, one per line':'ตัวเลือก บรรทัดละ 1 ข้อ'}">${esc((q.options||[]).join('\n'))}</textarea></div></div>`).join('');
    const c=document.getElementById('svQCount'); if(c) c.textContent=`(${SV_Q.length}/${SV_MAX_Q})`;
  };
  window.A_svQSet=(i,k,v)=>{ if(!SV_Q[i])return;
    if(k==='options') SV_Q[i].options=String(v).split('\n').map(x=>x.trim()).filter(Boolean);
    else SV_Q[i][k]=v;
    if(k==='type'){ const b=document.getElementById('svQO'+i); if(b) b.hidden=(v!=='vote'); } };
  window.A_svQAdd=()=>{ if(SV_Q.length>=SV_MAX_Q){ toast(EN()?`Up to ${SV_MAX_Q} questions`:`ใส่คำถามได้ไม่เกิน ${SV_MAX_Q} ข้อ`); return; }
    SV_Q.push({text:'',type:'rating',options:[]}); A_svQRender(); };
  window.A_svQDel=(i)=>{ if(SV_Q.length<=1)return; SV_Q.splice(i,1); A_svQRender(); };
  window.A_svScopeChg=(v)=>{ const b=document.getElementById('svTgtBox'); if(b)b.hidden=(v==='all');
    const m=document.querySelector('.modal'); if(!m)return; const sel=m.querySelector('#svTgt'); if(!sel)return;
    const classes=[...new Set((A_CACHE.students||[]).map(x=>x.Class).filter(Boolean))];
    const kids=(A_CACHE.students||[]).filter(x=>x.Status!=='WITHDRAWN');
    sel.innerHTML = v==='student' ? kids.map(k=>`<option value="${esc(k.StudentID)}">${esc(dispNick(k))} (${esc(k.Class||'')})</option>`).join('')
                                  : classes.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join(''); };
  window.A_svSave=async(id,btn)=>{ const m=btn.closest('.modal'); const g=x=>{const e=m.querySelector('#'+x);return e?e.value:'';};
    if(btn)btn.disabled=true;
    try{ await api('saveSurvey',{staffId:USER.staffId,survey:{ surveyId:id||undefined, title:g('svT'), description:g('svD'),
        questions:SV_Q.filter(q=>String(q.text||'').trim()),
        scope:g('svScope'), target:g('svTgt'),
        startDate:g('svS'), endDate:g('svE'), anonymous:!!m.querySelector('#svAnon').checked }});
      m.remove(); confirmSaved(t('c.saved')); A_surveys();
    }catch(e){err(e); if(btn)btn.disabled=false;} };
  window.A_svClose=async(id,reopen)=>{ try{ await api('setSurveyStatus',{staffId:USER.staffId,surveyId:id,reopen});
    const m=document.querySelector('.modal'); if(m)m.remove(); A_surveys(); }catch(e){err(e);} };
  window.A_svDelete=async(id)=>{ if(!confirm(EN()?'Delete this survey AND every answer given to it?':'ลบแบบสอบถามนี้ พร้อมคำตอบทั้งหมดที่ผู้ปกครองตอบมา?'))return;
    try{ const r=await api('deleteSurvey',{staffId:USER.staffId,surveyId:id});
      const m=document.querySelector('.modal'); if(m)m.remove();
      toast((EN()?'Deleted · answers removed ':'ลบแล้ว · ลบคำตอบ ')+(r.removedResponses||0)); A_surveys(); }catch(e){err(e);} };
  window.A_svResults=async(id)=>{
    const d=await api('surveyResults',{staffId:USER.staffId,surveyId:id},{fresh:true});
    // one result block per question, so a five-question survey is read question by question rather
    // than as one pile of numbers
    const qs=(d.perQuestion&&d.perQuestion.length)?d.perQuestion
      :[{text:d.title,type:d.type,options:d.options||[],dist:d.dist,tally:d.tally,average:d.average,comments:d.comments||[]}];
    const qBlock=(q,i)=>{
      const max=Math.max(1,...(q.dist||[0]));
      const bars=(q.type==='rating')?(q.dist||[]).map((n,k)=>`<div style="display:flex;align-items:center;gap:8px;margin:3px 0">
          <span style="width:28px;font-size:20px">${SV_FACE[k]}</span><span class="muted" style="width:16px">${k+1}</span>
          <div style="flex:1;height:14px;background:var(--line);border-radius:7px;overflow:hidden"><div style="height:100%;width:${n/max*100}%;background:var(--brand)"></div></div>
          <b style="width:32px;text-align:right">${n}</b></div>`).join(''):'';
      const votes=(q.type==='vote')?Object.keys(q.tally||{}).map(k=>`<div class="list-item"><span>${esc(k)}</span><b>${q.tally[k]}</b></div>`).join(''):'';
      const cms=(q.comments||[]).map(c=>`<div class="card" style="padding:8px;margin:4px 0"><div style="font-size:14px">${esc(c.comment)}</div>
        <small class="muted">${c.rating?SV_FACE[c.rating-1]+' ':''}${esc(c.who||(EN()?'anonymous':'ไม่ระบุชื่อ'))} · ${esc(String(c.at||'').slice(0,16))}</small></div>`).join('');
      return `<div class="card" style="padding:10px;margin:8px 0">
        <div class="spread"><b>${qs.length>1?`${i+1}. `:''}${esc(q.text)}</b>${q.average!=null?`<span class="pill info">${EN()?'avg':'เฉลี่ย'} ${q.average}</span>`:''}</div>
        ${bars}${votes}
        ${cms?`<div style="margin-top:6px"><small class="muted">${EN()?'Comments':'ความคิดเห็น'} (${(q.comments||[]).length})</small>${cms}</div>`:''}</div>`; };
    modal(`<h3>📊 ${esc(d.title)}</h3>
      <div class="kpigrid" style="margin-bottom:8px">
        <div class="kpi"><b>${d.responses}</b><small>${EN()?'families answered':'ครอบครัวที่ตอบ'}</small></div>
        ${d.average!=null?`<div class="kpi"><b style="color:var(--brand)">${d.average}</b><small>${EN()?'average (of 5)':'ค่าเฉลี่ย (เต็ม 5)'}</small></div>`:''}
        <div class="kpi"><b>${qs.length}</b><small>${EN()?'questions':'คำถาม'}</small></div></div>
      ${d.anonymous?`<p class="muted" style="font-size:13px">🕶️ ${EN()?'Anonymous survey — names are never returned, not even here.':'แบบสอบถามไม่ระบุชื่อ — ระบบไม่คืนชื่อผู้ตอบ แม้ในหน้านี้'}</p>`:''}
      <div style="max-height:58vh;overflow:auto">${qs.map(qBlock).join('')}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove();A_surveys()">${esc(t('c.close'))}</button>`);
  };
  window.A_svMonth=async(month)=>{ const m0=month||monthStr();
    const d=await api('surveySummary',{staffId:USER.staffId,month:m0},{fresh:true});
    modal(`<h3>📅 ${EN()?'Survey summary':'สรุปแบบสอบถาม'} ${esc(m0)}</h3>
      <label class="field"><span>${esc(t('c.month'))}</span><input type="month" value="${esc(m0)}" onchange="this.closest('.modal').remove();A_svMonth(this.value)"/></label>
      <div class="kpigrid" style="margin-bottom:8px">
        <div class="kpi"><b>${d.responses}</b><small>${EN()?'answers':'คำตอบ'}</small></div>
        <div class="kpi"><b style="color:var(--brand)">${d.average!=null?d.average:'-'}</b><small>${EN()?'average (of 5)':'ค่าเฉลี่ย (เต็ม 5)'}</small></div></div>
      ${(d.surveys||[]).length?(d.surveys||[]).map(s=>`<div class="list-item"><span>${esc(s.title)}<br><small class="muted">${s.questionCount>1?(EN()?s.questionCount+' questions':s.questionCount+' ข้อ'):esc(SV_TYPE(s.type))}</small></span>
        <span style="text-align:right"><b>${s.responses}</b>${s.average!=null?`<br><small class="muted">${EN()?'avg':'เฉลี่ย'} ${s.average}</small>`:''}</span></div>`).join('')
        :`<div class="card muted">${EN()?'No answers this month':'เดือนนี้ยังไม่มีคำตอบ'}</div>`}
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove();A_surveys()">${esc(t('c.close'))}</button>`);
  };

  /** The day's own hours + the bonus. Read straight back out of the form, so nothing is remembered. */
  function bcHourValues(){ const g=id=>{ const e=document.getElementById(id); return e?e.value.trim():''; };
    const v={BigCleaningAmount:+g('setBC')||0};
    // an empty time field means "leave it as it is" — never write a blank over a working schedule
    if(/^\d{2}:\d{2}$/.test(g('setBCIn')))  v.BigCleaningIn  = g('setBCIn');
    if(/^\d{2}:\d{2}$/.test(g('setBCOut'))) v.BigCleaningOut = g('setBCOut');
    return v; }
  window.A_bcSaveHours=async(btn)=>{ if(btn)btn.disabled=true;
    try{ await api('setSchoolConfig',{values:bcHourValues()}); confirmSaved(t('c.saved')); }
    catch(e){ err(e); } finally{ if(btn)btn.disabled=false; } };
  // Meeting-day add/remove — persist immediately (the hours/bonus go first so they aren't lost)
  window.A_bcAdd=async()=>{ const d=document.getElementById('bcDate').value; if(!d){toast(EN()?'Pick a date':'เลือกวันที่');return;}
    await api('setSchoolConfig',{values:bcHourValues()});
    try{ await api('addBigCleaning',{date:d}); toast(t('c.saved')); GO_('holidays'); }catch(e){err(e);} };
  window.A_bcRemove=async(d)=>{ try{ await api('removeBigCleaning',{date:d}); toast(t('manage.deleted')); GO_('holidays'); }catch(e){err(e);} };
  // (re)install the time triggers so the 10:00/20:00 digests are scheduled after enabling them
  /**
   * Rewrite today's late minutes from the day's REAL hours.
   *
   * A half-day holiday added (or corrected) after someone has already clocked in leaves their row
   * measured against the hours that were in force at the moment they tapped. That is not a bug to
   * paper over — the row was right when it was written — but somebody has to be able to put it
   * right, and on 2026-08-19 four teachers sat at 250–311 minutes late with no way to fix it.
   */
  window.A_recomputeAtt=async(btn)=>{ if(btn)btn.disabled=true;
    try{ const r=await api('recomputeAttendance',{});
      const rows=(r&&r.rows)||[], f=(r&&r.fixed)||[];
      // every row, with the hours it was measured against — "3 rows fixed" cannot tell you whether
      // the server is now reading the holiday or has just rewritten the same wrong number
      const line=x=>`<div class="list-item"><span><b>${esc(x.staffId)}</b>
          <small class="muted">${EN()?'in':'เข้า'} ${esc(x.checkIn)} · ${EN()?'start':'เริ่มงาน'} ${esc(x.start)}${x.reopened?(EN()?' (reopening)':' (วันหยุดครึ่งวัน)'):''}${x.dayOff?(EN()?' (day off)':' (วันหยุด)'):''}${x.grace?` · ${EN()?'grace':'ผ่อนผัน'} ${x.grace}`:''}</small></span>
        <span>${x.changed?`${x.was} → `:''}<b style="color:${x.late?'var(--bad)':'var(--ok)'}">${x.late}</b> ${EN()?'min':'นาที'}</span></div>`;
      modal(`<h3>🕑 ${EN()?'Late minutes recalculated':'คำนวณนาทีสายใหม่แล้ว'}</h3>
        <p class="muted" style="font-size:13px">${esc(r.date||'')} · ${EN()?'corrected':'แก้ไข'} <b>${f.length}</b> / ${rows.length} ${EN()?'rows':'แถว'}</p>
        ${rows.length?rows.map(line).join('')
          :`<div class="card muted">${EN()?'Nobody has clocked in today yet.':'วันนี้ยังไม่มีใครลงเวลา'}</div>`}
        <p class="muted" style="font-size:13px;margin-top:6px">${EN()
          ? 'If “start” still shows the ordinary shift on a half-day holiday, the server is not reading the holiday — send this screen.'
          : 'ถ้า "เริ่มงาน" ยังเป็นเวลากะปกติทั้งที่เป็นวันหยุดครึ่งวัน แปลว่าระบบยังอ่านวันหยุดไม่ได้ — ส่งภาพหน้านี้มาได้เลย'}</p>
        <button class="btn block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
    }catch(e){err(e);}finally{ if(btn)btn.disabled=false; } };
  /* The server saying out loud what it thinks today is. Added after the app and the server spent a
   * morning disagreeing about a half-day holiday with no way to see which of them was wrong. */
  window.A_diagDay=async(date)=>{
    let d; try{ d=await api('diagDay',date?{date}:{}); }catch(e){ err(e); return; }
    const tzBad = d.ssTimezone!==d.configTimezone;
    const row=(l,v)=>`<div class="spread" style="font-size:13px;padding:2px 0"><span class="muted">${esc(l)}</span><b>${esc(String(v==null?'-':v))}</b></div>`;
    modal(`<h3>🔍 ${EN()?'What the server thinks today is':'ระบบมองวันนี้อย่างไร'}</h3>
      <label class="field"><span>${EN()?'Day':'วันที่'}</span><input type="date" value="${esc(d.date)}" onchange="this.closest('.modal').remove();A_diagDay(this.value)"/></label>
      ${tzBad?`<div class="card" style="background:var(--bad-bg,var(--warn-bg));border-color:var(--warn-line);color:var(--bad);padding:8px;font-size:13px">
        ⚠️ ${EN()?'The spreadsheet timezone and the app setting disagree — every time-only cell then has two readings.':'เขตเวลาของสเปรดชีตกับที่ตั้งไว้ในระบบไม่ตรงกัน — เวลาในเซลล์จะถูกอ่านได้ 2 แบบ'}</div>`:''}
      <div class="card" style="padding:8px">
        ${row(EN()?'Spreadsheet timezone':'เขตเวลาสเปรดชีต', d.ssTimezone)}
        ${row(EN()?'App setting':'เขตเวลาในระบบ', d.configTimezone)}
        ${row(EN()?'Late grace / reopen window':'ผ่อนผัน / ช่วงเปิดระบบ', d.grace+' / '+d.reopenWindow)}
        ${row(BC_NAME(), d.bigCleaning?'✓':'—')}</div>
      <div class="card" style="padding:8px"><b style="font-size:13px">🎉 ${EN()?'Holiday row':'แถววันหยุด'}</b>
        ${d.holidayRaw?`${row(EN()?'Name':'ชื่อ', d.holidayRaw.name)}
          ${row(EN()?'Stored as':'เก็บเป็น', (d.holidayRaw.startIsDate?'Date':'text')+' / '+(d.holidayRaw.endIsDate?'Date':'text'))}
          ${row(EN()?'Read as':'อ่านได้เป็น', d.holidayDecoded?((d.holidayDecoded.StartTime||'—')+' – '+(d.holidayDecoded.EndTime||'—')):'—')}`
        :`<small class="muted">${EN()?'no holiday on this day':'วันนี้ไม่มีวันหยุด'}</small>`}</div>
      ${d.closed?`<div class="card" style="padding:8px"><b style="font-size:13px">🎉 ${EN()?'Who this closed day is open for':'วันหยุดนี้เปิดให้ใคร'}</b>
        <div style="margin-top:4px"><small class="muted">${EN()?'Holiday OT rows in OT_RECORDS':'แถว OT วันหยุดใน OT_RECORDS'}</small>
        ${(d.holidayOT||[]).length?(d.holidayOT||[]).map(o=>`<div class="list-item"><span><b>${esc(o.nick||o.staffId)}</b>
            <small class="muted">Kind=${esc(o.kind||'(ว่าง)')} · ${esc(o.status||'')}${o.note?' · '+esc(o.note):''}</small></span>
          <span style="flex:0 0 auto">${o.opensDay?`<span class="pill ok">${EN()?'opens the day':'เปิดวันให้'}</span>`
            :`<span class="pill bad">${EN()?'does NOT open the day':'ไม่เปิดวันให้'}</span>`} <b>${esc(baht(o.amount||0))}</b></span></div>`).join('')
          :`<br><small style="color:var(--warn)">${EN()?'No OT row at all on this date — nothing was recorded.':'ไม่มีแถว OT ของวันนี้เลย — ยังไม่ได้บันทึก'}</small>`}</div>
        <div style="margin-top:6px"><small class="muted">${EN()?'Named children in HOLIDAY_ATTEND':'รายชื่อนักเรียนใน HOLIDAY_ATTEND'}</small>
        ${(d.holidayStudents||[]).length?`<br>${(d.holidayStudents||[]).map(k=>`<b>${esc(k.nick)}</b> <small class="muted">${esc(k.class||'')}</small>`).join(' · ')}`
          :`<br><small style="color:var(--warn)">${EN()?'Nobody — no child may be checked in on this day.':'ไม่มี — นักเรียนจะลงเวลาในวันนี้ไม่ได้'}</small>`}</div></div>`:''}
      <div class="card" style="padding:8px"><b style="font-size:13px">👩‍🏫 ${EN()?'Hours resolved per person':'เวลาทำงานที่ระบบคิดให้แต่ละคน'}</b>
        ${(d.staff||[]).map(s=>`<div class="list-item"><span><b>${esc(s.nick||s.staffId)}</b>
          <small class="muted">${EN()?'shift':'กะ'} ${esc(s.shift)}</small></span>
          <span style="font-size:13px">${s.holidayOT?`<span class="pill ok">🎉 OT ${EN()?'holiday':'วันหยุด'}</span> `:''}${s.dayOff&&!s.holidayOT?`<span class="pill info">${EN()?'day off':'หยุด'}</span>`
            :`<b>${esc(s.start)}–${esc(s.end)}</b>${s.reopened?` <span class="pill wait">${EN()?'from':'ลงเวลา'} ${esc(s.openFrom)}</span>`:''}`}</span></div>`).join('')}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_reinstallTriggers=async(btn)=>{ if(btn)btn.disabled=true; try{ const r=await api('reinstallTriggers',{}); toast((EN()?'Schedule updated · triggers: ':'อัปเดตตารางแล้ว · triggers: ')+(r&&r.triggers!=null?r.triggers:'?')); }catch(e){err(e);}finally{ if(btn)btn.disabled=false; } };
  window.A_saveSettings=async(btn)=>{ const m=btn.closest('.modal');
    const lat=parseFloat(m.querySelector('#cfgLat').value), lng=parseFloat(m.querySelector('#cfgLng').value), rad=parseFloat(m.querySelector('#cfgRadius').value);
    const slackEl=m.querySelector('#cfgSlack'); const slack=slackEl?parseFloat(slackEl.value):NaN;
    const gv={}; if(!isNaN(lat))gv.GPS_Lat=lat; if(!isNaN(lng))gv.GPS_Lng=lng; if(!isNaN(rad))gv.Radius=rad;
    if(!isNaN(slack)&&slack>=0) gv.GpsAccuracySlack=slack;   // 0 is a real choice (strict), so test for NaN, not falsiness

    // notification prefs (checkboxes) — stored in SCHOOL_CONFIG so the digests/triggers read them
    const ck=id=>{ const e=m.querySelector(id); return e?(e.checked?'true':'false'):undefined; };
    if(ck('#setAdminLine')!==undefined) gv.AdminLineNotify=ck('#setAdminLine');
    if(ck('#setDigM')!==undefined) gv.DigestMorning=ck('#setDigM');
    if(ck('#setDigE')!==undefined) gv.DigestEvening=ck('#setDigE');
    if(Object.keys(gv).length) await api('setSchoolConfig',{values:gv});
    await api('setConfigVal',{key:'DiligenceAttendanceAmount',value:+m.querySelector('#setAtt').value});
    await api('setConfigVal',{key:'DiligenceFacebookAmount',value:+m.querySelector('#setFb').value});
    { const o=m.querySelector('#setOtRate'); if(o) await api('setConfigVal',{key:'StaffOTHourlyRate',value:+o.value||100}); }
    { const c=m.querySelector('#setMatch'); if(c) await api('setConfigVal',{key:'ContributionMatchRate',value:c.value===''?1:+c.value}); }
    { const t=m.querySelector('#setTtl'); if(t) await api('setConfigVal',{key:'CacheTTL',value:Math.max(30,Math.min(21600,+t.value||300))}); }
    for(const el of m.querySelectorAll('input[id^="lq_"]')){ const type=el.id.slice(3); if(!type) continue;
      await api('setLeaveQuota',{type,days:+el.value||0}); }
    m.remove(); confirmSaved(t('c.saved')); };

  // ---- OT verification (check the ≥50min→1hr rule on attendance) ----
  // ---- Admin: student late-pickup OT (cancel / correct pickup time / override amount) ----
  let OT_MONTH=null;
  window.A_studentOT=async()=>{ const month=OT_MONTH||monthStr(); const rows=await api('studentOtList',{month});
    const pill=st=>({UNPAID:'bad',PENDING_VERIFY:'wait',PARTIAL:'wait',PAID:'ok',CANCELLED:'info'}[st]||'info');
    const lbl=st=>({UNPAID:EN()?'unpaid':'ค้างชำระ',PENDING_VERIFY:EN()?'pending':'รอตรวจ',PARTIAL:EN()?'partial':'บางส่วน',PAID:EN()?'paid':'ชำระแล้ว',CANCELLED:EN()?'cancelled':'ยกเลิกแล้ว'}[st]||st);
    // "ปกติ 200 · ส่วนลดพิเศษ −100 · เก็บจริง 100" — the admin must be able to see at a glance that a
    // row is discounted, not miscalculated. Rows with no discount just show the charge.
    const otLine=(full,disc)=>disc>0
      ? `<span class="muted">${EN()?'normally':'ปกติ'} ${baht(full)}</span> · <b style="color:var(--warn)">${EN()?'discount':'ส่วนลดพิเศษ'} −${baht(disc)}</b> · <b style="color:var(--ok)">${EN()?'charge':'เก็บจริง'} ${baht(Math.max(0,full-disc))}</b>`
      : `<span class="muted">${EN()?'charge':'ยอดเต็ม'} ${baht(full)}</span>`;
    const row=o=>{ const paid=o.status==='PAID', cancelled=o.status==='CANCELLED';
      const otFull=Number(o.fullAmount||o.amount||0), otDisc=Number(o.discount||0);
      return `<div class="card" style="padding:8px;${cancelled?'opacity:.6':''}">
        <div class="spread"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" class="sotoc" value="${esc(o.otId)}" ${paid?'disabled':''} style="width:auto" onchange="A_socSel()"/> <b>${esc((EN()?(o.nickEN||o.nick||o.nameEN):(o.nick||o.name))||o.studentId)}</b></label><span class="pill ${pill(o.status)}" style="font-size:11px">${esc(lbl(o.status))}</span></div>
        <small class="muted">${esc(String(o.date).slice(0,10))} · ${EN()?'leaves':'เลิกเรียน'} ${esc(o.endTime||o.planEnd||'-')} · ${EN()?'rate':'เรต'} ${baht(o.rate)}/${EN()?'hr':'ชม.'}</small>
        <div class="grid2" style="margin-top:6px">
          <label class="field"><span>${EN()?'Pickup time':'เวลารับ'}</span><input type="time" id="ot_t_${esc(o.otId)}" value="${esc(String(o.pickupTime||'').slice(0,5))}" data-orig="${esc(String(o.pickupTime||'').slice(0,5))}" ${paid?'disabled':''}/></label>
          <!-- The admin types what the parent should ACTUALLY pay ("just pay 100"); the difference
               from the real charge is stored as the discount. The charge itself is never overwritten,
               so re-tapping check-out can no longer silently undo the school's goodwill. -->
          <label class="field"><span>${EN()?'Parent pays (฿)':'ให้ผู้ปกครองจ่าย (฿)'}</span><input type="number" min="0" id="ot_a_${esc(o.otId)}" value="${o.amount}" data-orig="${o.amount}" ${paid?'disabled':''} oninput="A_otPreview('${esc(o.otId)}',${otFull})"/></label></div>
        ${paid?'':`<label class="field"><span>${EN()?'Reason for the discount (optional)':'เหตุผลที่ให้ส่วนลด (ถ้ามี)'}</span><input id="ot_r_${esc(o.otId)}" value="${esc(o.discountReason||'')}" data-orig="${esc(o.discountReason||'')}" placeholder="${EN()?'e.g. heavy traffic, special case':'เช่น รถติดมาก / กรณีพิเศษ'}"/></label>`}
        <div id="ot_p_${esc(o.otId)}" style="font-size:13px;margin-top:2px">${otLine(otFull,otDisc)}</div>
        <small class="muted">${EN()?'late':'สาย'} ${o.lateMinutes} ${EN()?'min':'นาที'} · ${o.hours} ${EN()?'hr':'ชม.'}${o.discountBy?` · ${EN()?'discount by':'ส่วนลดโดย'} ${esc(staffNick(o.discountBy)||o.discountBy)}`:''}</small>
        ${paid?`<div class="muted" style="font-size:13px;margin-top:6px">🔒 ${EN()?'Paid — locked':'ชำระแล้ว แก้ไขไม่ได้'}</div>`
          :`<div class="row" style="margin-top:6px"><button class="btn sm green" onclick="A_otSave('${esc(o.otId)}',this)">💾 ${esc(t('c.save'))}</button>
            ${cancelled?`<button class="btn sm outline" onclick="A_otRestore('${esc(o.otId)}')">♻️ ${EN()?'Restore':'คืนค่า'}</button>`
                       :`<button class="btn sm pink" onclick="A_otCancel('${esc(o.otId)}')">🚫 ${EN()?'Cancel OT':'ยกเลิก OT'}</button>`}</div>`}</div>`; };
    modal(`<h3>⏰ ${EN()?'Student late-pickup OT':'OT รับช้า (นักเรียน)'}</h3>
      <p class="muted" style="font-size:13px">${EN()?'Cancelled OT is never billed. Editing a cancelled row restores it. Paid rows are locked.':'OT ที่ยกเลิกจะไม่ถูกเรียกเก็บ · แก้ไขรายการที่ยกเลิกแล้วจะคืนค่าอัตโนมัติ · รายการที่ชำระแล้วแก้ไม่ได้'}</p>
      <label class="field"><span>${esc(t('c.month'))}</span><input type="month" value="${month}" onchange="A_otMonth(this.value)"/></label>
      ${rows.length?`<div style="position:sticky;top:0;z-index:2;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:6px 8px;margin-bottom:6px">
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
  // live "ปกติ 200 · ส่วนลด −100 · เก็บจริง 100" as the admin types, so the discount being granted is
  // never a surprise once saved
  window.A_otPreview=(otId,full)=>{ const am=document.getElementById('ot_a_'+otId), box=document.getElementById('ot_p_'+otId);
    if(!am||!box)return; const pay=Math.max(0,Math.min(Number(am.value)||0,full)); const disc=Math.max(0,full-pay);
    box.innerHTML = disc>0
      ? `<span class="muted">${EN()?'normally':'ปกติ'} ${baht(full)}</span> · <b style="color:var(--warn)">${EN()?'discount':'ส่วนลดพิเศษ'} −${baht(disc)}</b> · <b style="color:var(--ok)">${EN()?'charge':'เก็บจริง'} ${baht(pay)}</b>`
      : `<span class="muted">${EN()?'charge':'ยอดเต็ม'} ${baht(full)}</span>`; };
  // Only send what actually changed. The amount field is what the parent should PAY; the server turns
  // the difference from the real charge into a recorded discount, so the charge itself is preserved.
  window.A_otSave=async(otId,btn)=>{ const tm=document.getElementById('ot_t_'+otId), am=document.getElementById('ot_a_'+otId), rs=document.getElementById('ot_r_'+otId);
    const p={otId,staffId:USER.staffId};
    if(tm && tm.value && tm.value!==tm.dataset.orig) p.pickupTime=tm.value;
    if(am && String(am.value)!==String(am.dataset.orig)) p.amount=am.value;
    if(rs && String(rs.value)!==String(rs.dataset.orig)) p.discountReason=rs.value;
    if(p.pickupTime===undefined && p.amount===undefined && p.discountReason===undefined){ toast(EN()?'Nothing changed':'ไม่มีการเปลี่ยนแปลง'); return; }
    // a reason-only edit still needs an amount for the server to act on
    if(p.amount===undefined && p.discountReason!==undefined && am) p.amount=am.value;
    btn.disabled=true;
    try{ const r=await api('adminUpdateOT',p); const d=Number(r.discount||r.Discount||0);
      toast(d>0 ? `✅ ${EN()?'Discount granted':'ให้ส่วนลดแล้ว'} −${baht(d)} · ${EN()?'charge':'เก็บจริง'} ${baht(r.amount!=null?r.amount:r.Amount||0)}`
                : `✅ ${EN()?'Updated':'อัปเดตแล้ว'} — ${baht(r.amount!=null?r.amount:r.Amount||0)}`);
      const x=document.querySelector('.modal'); if(x)x.remove(); A_studentOT();
    }catch(e){ err(e); btn.disabled=false; } };
  window.A_otCancel=async(otId)=>{ if(!confirm(EN()?'Cancel this OT charge? It will not be billed.':'ยกเลิกค่า OT รายการนี้? จะไม่ถูกเรียกเก็บ'))return;
    try{ await api('adminCancelOT',{otId}); toast(EN()?'OT cancelled':'ยกเลิก OT แล้ว'); const x=document.querySelector('.modal'); if(x)x.remove(); A_studentOT(); }catch(e){err(e);} };
  window.A_otRestore=async(otId)=>{ try{ await api('adminRestoreOT',{otId}); toast(EN()?'OT restored':'คืนค่า OT แล้ว'); const x=document.querySelector('.modal'); if(x)x.remove(); A_studentOT(); }catch(e){err(e);} };

  // ---- Class-management (ย้ายครูประจำชั้น/แผนก): Leader stages moves → submits a change request;
  //      Admin reviews Before/After and approves (applies + logs). Shared row renderer + screens below. ----
  const ccrStatusPill = st => { const k=String(st||'PENDING_ADMIN').toUpperCase(); const cls=k==='APPROVED'?'ok':(k==='REJECTED'?'bad':'wait');
    return `<span class="pill ${cls}">${esc(t('att.st.'+k)||k)}</span>`; };
  const ccrChanges = r => { let a=r.Changes; if(typeof a==='string'){ try{a=JSON.parse(a);}catch(e){a=[];} } return Array.isArray(a)?a:[]; };
  const ccrDiff = c => `${esc(c.name||c.staffId)}: <span class="muted">${esc(c.before||'—')}</span> → <b style="color:var(--blue)">${esc(c.after||'—')}</b>`;
  function ccrRow(r){ return `<div class="list-item"><span>${ccrChanges(r).map(ccrDiff).join('<br>')||'<small class="muted">—</small>'}<br><small class="muted">${esc(ddmmyyyy(r.CreatedDate))}${r.Note?' · '+esc(r.Note):''}</small></span>${ccrStatusPill(r.Status)}</div>`; }
  // Leader screen: move teachers between departments; changed rows are staged and submitted as one request.
  window.T_classOrg=async()=>{ const [staff,depts]=await Promise.all([api('listStaff'),api('listDepartments')]);
    const teachers=staff.filter(s=>s.Role==='Teacher'||s.PositionLevel==='Leader'||s.PositionLevel==='Assistant');
    window._CCR_ORIG={}; teachers.forEach(s=>{ window._CCR_ORIG[s.StaffID]=String(s.Department||''); });
    const optsFor=cur=>depts.map(d=>`<option value="${esc(d)}" ${String(cur||'')===d?'selected':''}>${esc(d)}</option>`).join('');
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('home')">${t('c.back')}</button>
      <h2 class="page">🔁 ${esc(t('corg.title'))}</h2>
      <p class="muted" style="font-size:13px">${esc(t('corg.leaderNote'))}</p>
      <div class="card">${teachers.map(s=>`<div class="list-item"><span>👩‍🏫 <b>${esc(nmn(s))}</b></span>
        <select data-ccr="${s.StaffID}" data-name="${esc(nmn(s))}" onchange="CCR_mark(this)">${optsFor(s.Department)}</select></div>`).join('')}</div>
      <label class="field"><span>${esc(t('corg.note'))}</span><input id="ccrNote" placeholder="${EN()?'reason (optional)':'เหตุผล (ถ้ามี)'}"/></label>
      <button class="btn block" onclick="CCR_submit(this)">📤 ${esc(t('corg.submit'))}</button>`;
  };
  window.CCR_mark=(sel)=>{ const orig=(window._CCR_ORIG||{})[sel.getAttribute('data-ccr')]; sel.style.fontWeight=(sel.value!==orig)?'700':''; sel.style.color=(sel.value!==orig)?'var(--blue)':''; };
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
  window.A_timeRequests=async()=>{ const rows=await api('pendingAdminTimeRequests',{staffId:USER.staffId},{fresh:true});
    const tyLabel=ty=>String(ty).toUpperCase()==='IN'?(EN()?'Check-in':'เข้างาน'):(EN()?'Check-out':'เลิกงาน');
    // The list used to show only what was waiting on the ADMIN, so a request still with the head
    // teacher was invisible here even though the admin had been notified about it. Both stages now
    // appear, each labelled, and the admin can settle either.
    const card=r=>`<div class="card" style="margin:8px 0"><div class="spread"><div><b>${esc(dnick(r))}</b> · ${esc(tyLabel(r.Type))} <b style="color:var(--blue)">${esc(r.RequestTime)}</b> · ${esc(ddmmyyyy(r.Date))}</div>
        <span class="pill ${r.stage==='leader'?'wait':'info'}" style="font-size:11px">${r.stage==='leader'?(EN()?'with head teacher':'รอหัวหน้าครู'):(EN()?'your turn':'รอคุณอนุมัติ')}</span></div>
      ${r.Reason?`<small class="muted">${esc(r.Reason)}</small>`:''}
      ${r.stage==='leader'?`<small class="muted" style="display:block;margin-top:4px">${EN()?'Approving here settles it without waiting for the head teacher — it is recorded that you did.':'กดอนุมัติที่นี่ = ปิดคำขอโดยไม่ต้องรอหัวหน้าครู · ระบบจะบันทึกว่าแอดมินอนุมัติแทน'}</small>`:''}
      <div class="row" style="margin-top:8px"><button class="btn sm green" onclick="ATR_decide('${esc(r.ReqID)}','approve')">✔ ${esc(t('c.approve'))}</button><button class="btn sm pink" onclick="ATR_decide('${esc(r.ReqID)}','reject')">✕ ${esc(t('c.reject'))}</button></div></div>`;
    const mine=rows.filter(r=>r.stage!=='leader'), lead=rows.filter(r=>r.stage==='leader');
    modal(`<h3>⏰ ${esc(t('att.adminTitle'))}</h3>
      <p class="muted" style="font-size:13px">${EN()?'Approving writes the time into attendance and recomputes late/OT.':'อนุมัติแล้วจะบันทึกเวลาลงในระบบและคำนวณสาย/OT ใหม่'}</p>
      <div style="max-height:60vh;overflow:auto">
        ${mine.length?`<h4 style="margin:6px 0">${EN()?'Waiting for you':'รอคุณอนุมัติ (ขั้นสุดท้าย)'} (${mine.length})</h4>${mine.map(card).join('')}`:''}
        ${lead.length?`<h4 style="margin:12px 0 6px">${EN()?'Still with the head teacher':'ยังรอหัวหน้าครู'} (${lead.length})</h4>${lead.map(card).join('')}`:''}
        ${rows.length?'':`<small class="muted">${esc(t('corg.noPending'))}</small>`}</div>
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
      const hol=isHolOT(o);
      return `<div class="card" style="padding:8px;${rejected?'opacity:.7':''}">
        <div class="spread"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" class="sotchk" value="${esc(o.OTRecordID)}" style="width:auto" onchange="A_sotSel()"/> <b>${esc(dnick(o))}</b>${hol?` <span class="pill" style="font-size:11px">🎉 ${EN()?'Holiday':'วันหยุด'}</span>`:''}</label><span class="pill ${pcls(st)}" style="font-size:11px">${esc(plbl(st))}</span></div>
        ${hol?`<small class="muted">${esc(ddmmyyyy(o.Date))}${o.Note?` · ${esc(o.Note)}`:''}</small>`
             :`<small class="muted">${esc(ddmmyyyy(o.Date))} · ${EN()?'in':'เข้างาน'} <b>${esc(o.CheckIn||'--:--')}</b> → ${EN()?'out':'เลิกงาน'} <b>${esc(o.CheckOutActual||o.ActualOut||'--:--')}</b>${o.PlanOut?` <span class="muted">(${EN()?'plan':'แผน'} ${esc(o.PlanOut)})</span>`:''}</small>`}
        <div class="grid2" style="margin-top:6px"><label class="field"><span>${EN()?'Hours':'ชั่วโมง'}</span><input type="number" min="0" step="1" value="${esc(o.Hours)}" id="sot_h_${o.OTRecordID}" ${hol?'disabled':''}/></label>
          <label class="field"><span>${EN()?'Amount (฿)':'ยอด (฿)'}</span><input type="number" min="0" value="${esc(o.Amount)}" id="sot_a_${o.OTRecordID}"/></label></div>
        ${o.Minutes?`<small class="muted">${esc(hmMin(o.Minutes))}</small>`:''}
        <div class="row" style="margin-top:6px">${isPA
          ?`<button class="btn sm green" onclick="A_confirmOT('${o.OTRecordID}')">✔ ${esc(t('c.approve'))}</button><button class="btn sm pink" onclick="A_rejectOT('${o.OTRecordID}')">✕ ${esc(t('c.reject'))}</button>`
          :`<button class="btn sm outline" onclick="A_editOT('${o.OTRecordID}')">💾 ${esc(t('c.save'))}</button>${rejected?`<button class="btn sm outline" onclick="A_restoreStaffOT('${o.OTRecordID}')">♻️ ${EN()?'Restore':'คืนค่า'}</button>`:''}`}
          <button class="btn sm pink" onclick="A_deleteOT('${o.OTRecordID}')" aria-label="${EN()?"Delete":"ลบ"}" title="${EN()?"Delete":"ลบ"}">🗑️</button></div></div>`; };
    modal(`<h3>⏰ ${esc(t('ot.adminOT'))}</h3>
      <div class="spread"><label class="field" style="flex:1"><span>${EN()?'Month':'เดือน'}</span><input type="month" id="sotMonth" value="${SOT_MONTH}" onchange="A_staffOT(this.value)"/></label>
        <button class="btn sm" style="align-self:end;margin-bottom:2px" onclick="A_addOTForm()">${esc(t('ot.addOT'))}</button></div>
      ${rows.length?`<div style="position:sticky;top:0;z-index:2;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:6px 8px;margin-bottom:6px">
        <div class="spread"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="sotAll" style="width:auto" onchange="A_sotToggleAll(this)"/> ${EN()?'Select all':'เลือกทั้งหมด'} <span class="muted" id="sotN">(0)</span></label></div>
        <div class="row" style="margin-top:6px"><button class="btn sm green" onclick="A_sotBatch('approve')">✔ ${EN()?'Approve all selected':'อนุมัติทั้งหมด'}</button><button class="btn sm pink" onclick="A_sotBatch('reject')">✕ ${EN()?'Reject all selected':'ยกเลิกทั้งหมด'}</button></div></div>`:''}
      ${pend.length?`<div style="background:var(--warn-bg);border-radius:8px;padding:6px;color:var(--warn);font-size:13px;margin-bottom:6px">🔔 ${pend.length} ${EN()?'awaiting your confirmation':'รายการรอยืนยัน'}</div>`:''}
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

  /* ---- Admin: OT วันหยุด (holiday OT) ----------------------------------------------------------
   * A day off that was worked is agreed as a SUM, not clocked: the Admin ticks who came in, picks the
   * day, writes down what they did (that note is the only record of it) and sets one amount each.
   * It is written into OT_RECORDS as APPROVED, so it reaches the salary through the same path as the
   * evening OT — including the carry-over that pays it late rather than dropping it.
   * Mobile-first: one column, the form collapsed under a summary so the month's list is what you see
   * first, and the staff list scrolls inside its own box rather than pushing the Save button off-screen.
   */
  let HOT_MONTH=null;
  window.A_holidayOT=async(month)=>{ HOT_MONTH=month||HOT_MONTH||monthStr();
    const [rows,staff]=await Promise.all([api('adminOTList',{month:HOT_MONTH}), (A_CACHE.staff&&A_CACHE.staff.length)?Promise.resolve(A_CACHE.staff):api('listStaff')]);
    A_CACHE.staff=staff||A_CACHE.staff;
    const hol=(rows||[]).filter(isHolOT);
    const total=hol.reduce((a,o)=>a+(Number(o.Amount)||0),0);
    const people=(A_CACHE.staff||[]).filter(s=>!s.ended);
    const row=o=>`<div class="card" style="padding:8px">
      <div class="spread"><b>${esc(dnick(o))}</b><span class="pill ok" style="font-size:11px">${esc(ddmmyyyy(o.Date))}</span></div>
      <label class="field" style="margin-top:6px"><span>${EN()?'Amount (฿)':'จำนวนเงิน (฿)'}</span><input type="number" min="0" id="hot_a_${o.OTRecordID}" value="${esc(o.Amount)}"/></label>
      <label class="field"><span>${EN()?'Details':'รายละเอียด'}</span><textarea id="hot_n_${o.OTRecordID}" rows="2">${esc(o.Note||'')}</textarea></label>
      <!-- the children bound to that DAY. They belong to the date, not to this one teacher's row, so
           two teachers working the same holiday see (and edit) the same list — said out loud below. -->
      <div id="hotKids_${esc(ymd(o.Date))}" class="muted" style="font-size:13px;margin:4px 0">…</div>
      <div class="row"><button class="btn sm outline" onclick="A_hotSave('${o.OTRecordID}')">💾 ${esc(t('c.save'))}</button>
        <button class="btn sm outline" onclick="A_hotKidsEdit('${esc(ymd(o.Date))}')">👶 ${EN()?'Children':'นักเรียน'}</button>
        <button class="btn sm pink" onclick="A_hotDel('${o.OTRecordID}')">🗑️ ${EN()?'Delete':'ลบ'}</button></div></div>`;
    modal(`<h3>🎉 ${EN()?'Holiday OT':'OT วันหยุด'}</h3>
      <label class="field"><span>${EN()?'Month':'เดือน'}</span><input type="month" id="hotMonth" value="${HOT_MONTH}" onchange="A_holidayOT(this.value)"/></label>
      <details class="card" style="padding:8px" ${hol.length?'':'open'}>
        <summary style="cursor:pointer;font-weight:700">➕ ${EN()?'Record holiday OT':'บันทึก OT วันหยุด'}</summary>
        <label class="field" style="margin-top:8px"><span>${EN()?'Date worked (holidays only)':'วันที่มาทำงาน (เฉพาะวันหยุด)'}</span><input type="date" id="hotDate" value="${todayStr()}" onchange="A_hotDate(this.value)"/></label>
        <div id="hotDateWhy" style="font-size:13px;margin:-4px 0 6px"></div>
        <label class="field"><span>${EN()?'Amount each (฿)':'จำนวนเงินต่อคน (฿)'}</span><input type="number" min="0" id="hotAmount" placeholder="0"/></label>
        <label class="field"><span>${EN()?'Details of the work':'รายละเอียดการทำงาน'}</span><textarea id="hotNote" rows="3" placeholder="${EN()?'What was done on the day off':'ทำอะไรในวันหยุด'}"></textarea></label>
        <div class="spread" style="margin:6px 0"><b style="font-size:13px">${EN()?'Staff':'พนักงาน'} <span class="muted" id="hotN">(0)</span></b>
          <label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="hotAll" style="width:auto" onchange="A_hotToggleAll(this)"/> ${EN()?'All':'ทั้งหมด'}</label></div>
        <div style="max-height:34vh;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px">
          ${people.map(s=>`<label class="list-item" style="gap:8px;cursor:pointer"><input type="checkbox" class="hotchk" value="${esc(s.StaffID)}" style="width:auto" onchange="A_hotSel()"/><span>${esc(nmn(s))}</span></label>`).join('')||`<small class="muted">${esc(t('c.noItems'))}</small>`}</div>
        <!-- Children coming in with them. Ticking a name is what OPENS that child's check-in on a day
             the school is otherwise shut — for them the day then behaves like any other. Tick nobody
             and only the teacher's own clock opens. -->
        <div class="spread" style="margin:10px 0 4px"><b style="font-size:13px">👶 ${EN()?'Children coming that day':'นักเรียนที่มาวันนั้น'} <span class="muted" id="hotSN">(0)</span></b>
          <label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="hotSAll" style="width:auto" onchange="A_hotStdAll(this)"/> ${EN()?'All':'ทั้งหมด'}</label></div>
        <small class="muted" style="display:block;margin-bottom:4px">${EN()
          ? 'Tick a child to open their check-in / pick-up that day — attendance, the journal, the history and the late-pickup charge all work as usual. Tick nobody and only the teacher clocks in.'
          : 'ติ๊กชื่อนักเรียนเพื่อเปิดการรับ-ส่งของวันนั้น — การลงเวลา สมุดรายวัน ประวัติ และ OT รับช้า ทำงานเหมือนวันปกติ · ไม่ติ๊กใครเลย = เปิดเฉพาะการลงเวลาของคุณครู'}</small>
        <div id="hotStd" style="max-height:34vh;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px">
          <small class="muted">${EN()?'Loading…':'กำลังโหลด…'}</small></div>
        <button class="btn block green" style="margin-top:8px" onclick="A_hotAdd(this)">💾 ${esc(t('c.save'))}</button>
      </details>
      ${hol.length?`<div class="spread" style="margin:8px 0"><b>${EN()?'This month':'เดือนนี้'} (${hol.length})</b><b>${esc(baht(total))}</b></div>`:''}
      <div style="max-height:44vh;overflow:auto">${hol.length?hol.map(row).join(''):`<small class="muted">${EN()?'No holiday OT this month':'ยังไม่มี OT วันหยุดในเดือนนี้'}</small>`}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
    A_hotSel();
    A_hotDate();
    // fill in each record's "children on this day" line — one call per DATE, not per record
    [...new Set(hol.map(o=>ymd(o.Date)))].forEach(async d=>{
      let l=null; try{ l=await api('holidayAttendList',{date:d}); }catch(e){}
      const el=document.getElementById('hotKids_'+d); if(!el)return;
      const dn=x=>EN()?(x.nickEN||x.nameEN||x.nick||x.name):(x.nick||x.name);
      el.innerHTML = (l&&l.count)
        ? `👶 ${EN()?'children that day':'นักเรียนวันนั้น'} (${l.count}): <b>${l.students.map(s=>esc(dn(s))).join(', ')}</b>`
        : `👶 <span class="muted">${EN()?'no children that day — the teacher\'s clock only':'ไม่มีนักเรียนวันนั้น — เปิดเฉพาะการลงเวลาของครู'}</span>`;
    });
  };
  /**
   * The children on a holiday, edited after the fact — somebody was added, somebody cancelled.
   *
   * The list belongs to the DATE. Two teachers on the same holiday share it, and the form says so,
   * because "I changed mine and hers changed too" is the kind of surprise that stops people trusting
   * a screen.
   */
  window.A_hotKidsEdit=async(date)=>{
    let list=A_CACHE.students;
    if(!list||!list.length){ try{ list=await api('listStudents'); A_CACHE.students=list; }catch(e){ list=[]; } }
    let cur=[]; let staff=[];
    try{ const l=await api('holidayAttendList',{date}); cur=l.students||[]; staff=l.staff||[]; }catch(e){}
    const on={}; cur.forEach(x=>{ on[x.studentId]=1; });
    const active=(list||[]).filter(s=>String(s.Status||'ACTIVE').toUpperCase()!=='WITHDRAWN'
      && String(s.Status||'').toUpperCase()!=='EXPORTED');
    const byClass={}; active.forEach(s=>{ const c=s.Class||(EN()?'(no class)':'(ยังไม่จัดชั้น)'); (byClass[c]=byClass[c]||[]).push(s); });
    modal(`<h3>👶 ${EN()?'Children on':'นักเรียนวันที่'} ${esc(ddmmyyyy(date))}</h3>
      <p class="muted" style="font-size:13px">${EN()
        ? 'Ticking a child opens their check-in for that day. This list belongs to the DAY — every teacher working that holiday shares it.'
        : 'ติ๊กชื่อเพื่อเปิดการลงเวลาของวันนั้น · รายชื่อนี้เป็นของ "วัน" — คุณครูทุกคนที่ทำงานวันหยุดนั้นใช้รายชื่อเดียวกัน'}${staff.length?` (${staff.length} ${EN()?'staff':'คน'})`:''}</p>
      <div class="spread" style="margin:4px 0"><b style="font-size:13px">${EN()?'Selected':'เลือกแล้ว'} <span class="muted" id="hkN">(0)</span></b>
        <label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" style="width:auto" onchange="document.querySelectorAll('.hkchk').forEach(c=>c.checked=this.checked);A_hkSel()"/> ${EN()?'All':'ทั้งหมด'}</label></div>
      <div style="max-height:50vh;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px">
        ${Object.keys(byClass).sort().map(c=>`<div style="margin-bottom:6px">
          <b style="font-size:13px">${esc(c)}</b>
          ${sortPeople(byClass[c]).map(s=>`<label class="list-item" style="gap:8px;cursor:pointer;padding:4px 6px">
            <input type="checkbox" class="hkchk" value="${esc(s.StudentID)}" style="width:auto" ${on[s.StudentID]?'checked':''} onchange="A_hkSel()"/>
            <span><b>${esc(dispNick(s))}</b>${nmSub(s)?` <small class="muted">${esc(nmSub(s))}</small>`:''}</span></label>`).join('')}
        </div>`).join('')||`<small class="muted">${esc(t('c.noItems'))}</small>`}</div>
      <button class="btn block green" style="margin-top:8px" onclick="A_hotKidsSave('${esc(date)}',this)">💾 ${esc(t('c.save'))}</button>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
    A_hkSel();
  };
  window.A_hkSel=()=>{ const n=document.querySelectorAll('.hkchk:checked').length;
    const el=document.getElementById('hkN'); if(el)el.textContent='('+n+')'; };
  window.A_hotKidsSave=async(date,btn)=>{ const m=btn.closest('.modal');
    const studentIds=[...m.querySelectorAll('.hkchk:checked')].map(c=>c.value);
    btn.disabled=true;
    try{ await api('holidayAttendSet',{staffId:USER.staffId,date,studentIds});
      m.remove(); confirmSaved(t('c.saved')); A_hotRefresh(); }catch(e){ err(e); btn.disabled=false; } };
  /**
   * The date box says, as it is typed, whether the day is one OT วันหยุด may be recorded against.
   *
   * The server refuses a working day outright (assertHolidayDate_) — but being told AFTER filling in
   * the amount, the note and five names is a form that wastes your afternoon. So it answers here
   * first, and the save button follows.
   */
  window.A_hotDate=async(date)=>{
    const d=date||(document.getElementById('hotDate')||{}).value||todayStr();
    const why=document.getElementById('hotDateWhy'); const box=document.getElementById('hotStd');
    let r=null; try{ r=await api('holidayDateCheck',{date:d}); }catch(e){}
    if(why){ why.innerHTML = !r ? ''
      : r.holiday
        ? `<span style="color:var(--ok)">✓ ${esc(r.name||(r.weekend?(EN()?'weekend':'เสาร์-อาทิตย์'):(EN()?'holiday':'วันหยุด')))}</span>`
        : `<span style="color:var(--bad)">⛔ ${EN()?'This is an ordinary working day — holiday OT cannot be recorded on it. Use hourly OT instead.':'วันนี้เป็นวันทำงานปกติ — บันทึก OT วันหยุดไม่ได้ · ให้ใช้ OT รายชั่วโมงแทน'}</span>`; }
    // a working day gets no student list either: nothing about that day is going to be saved
    if(box && r && !r.holiday){ box.innerHTML=`<small class="muted">${EN()?'Pick a holiday first.':'เลือกวันหยุดก่อน'}</small>`; A_hotStdSel(); return; }
    A_hotStdList(d);
  };
  /**
   * The children who might come in on the chosen day — nickname first, grouped by class, because
   * that is how the school talks about them. Whatever is already saved for that date comes back
   * ticked, so reopening the form shows the plan rather than a blank slate.
   */
  window.A_hotStdList=async(date)=>{
    const box=document.getElementById('hotStd'); if(!box) return;
    const d=date||(document.getElementById('hotDate')||{}).value||todayStr();
    let list=A_CACHE.students;
    if(!list||!list.length){ try{ list=await api('listStudents'); A_CACHE.students=list; }catch(e){ list=[]; } }
    let picked=[]; try{ picked=((await api('holidayAttendList',{date:d}))||{}).students||[]; }catch(e){}
    const on={}; picked.forEach(x=>{ on[x.studentId]=1; });
    const active=(list||[]).filter(s=>String(s.Status||'ACTIVE').toUpperCase()!=='WITHDRAWN'
      && String(s.Status||'').toUpperCase()!=='EXPORTED');
    const byClass={}; active.forEach(s=>{ const c=s.Class||(EN()?'(no class)':'(ยังไม่จัดชั้น)'); (byClass[c]=byClass[c]||[]).push(s); });
    const names=Object.keys(byClass).sort();
    box.innerHTML = names.length ? names.map(c=>`<div style="margin-bottom:6px">
        <label style="display:flex;gap:6px;align-items:center;font-weight:700;font-size:13px;cursor:pointer">
          <input type="checkbox" style="width:auto" onchange="A_hotStdClass(this,'${esc(c)}')"/> ${esc(c)}
          <span class="muted" style="font-weight:400">(${byClass[c].length})</span></label>
        ${sortPeople(byClass[c]).map(s=>`<label class="list-item" style="gap:8px;cursor:pointer;padding:4px 6px">
          <input type="checkbox" class="hotstd" data-class="${esc(c)}" value="${esc(s.StudentID)}" style="width:auto" ${on[s.StudentID]?'checked':''} onchange="A_hotStdSel()"/>
          <span><b>${esc(dispNick(s))}</b>${nmSub(s)?` <small class="muted">${esc(nmSub(s))}</small>`:''}</span></label>`).join('')}
      </div>`).join('') : `<small class="muted">${esc(t('c.noItems'))}</small>`;
    A_hotStdSel();
  };
  window.A_hotStdSel=()=>{ const n=document.querySelectorAll('.hotstd:checked').length;
    const el=document.getElementById('hotSN'); if(el)el.textContent='('+n+')'; };
  window.A_hotStdAll=(cb)=>{ document.querySelectorAll('.hotstd').forEach(c=>{c.checked=cb.checked;}); A_hotStdSel(); };
  window.A_hotStdClass=(cb,cls)=>{ document.querySelectorAll('.hotstd[data-class="'+cls.replace(/"/g,'\\"')+'"]').forEach(c=>{c.checked=cb.checked;}); A_hotStdSel(); };
  // the calendar underneath is showing the same days — refresh its copy too, or a grant appears in
  // the list and not on the calendar until the screen is reopened
  const A_hotRefresh=async()=>{ const x=document.querySelector('.modal'); if(x)x.remove();
    try{ const _ot=await api('adminOTList',{month:monthStr()});
      window._LV_HOT=(_ot||[]).filter(isLiveHolOT);
      if(window._CALRENDER){ const w=document.getElementById('calWrap'); if(w) w.innerHTML=window._CALRENDER(); }
    }catch(e){}
    A_holidayOT(); };
  window.A_hotSel=()=>{ const n=document.querySelectorAll('.hotchk:checked').length; const el=document.getElementById('hotN'); if(el)el.textContent='('+n+')'; };
  window.A_hotToggleAll=(cb)=>{ document.querySelectorAll('.hotchk').forEach(c=>{c.checked=cb.checked;}); A_hotSel(); };
  window.A_hotAdd=async(btn)=>{ const m=btn.closest('.modal'); const g=id=>{const e=m.querySelector('#'+id);return e?e.value:'';};
    const staffIds=[...m.querySelectorAll('.hotchk:checked')].map(c=>c.value);
    if(!staffIds.length){toast(EN()?'Select at least one':'เลือกพนักงานอย่างน้อย 1 คน');return;}
    const amount=Number(g('hotAmount'))||0; if(amount<=0){toast(EN()?'Enter the amount':'ระบุจำนวนเงิน');return;}
    const note=g('hotNote').trim(); if(!note){toast(EN()?'Enter the details':'ระบุรายละเอียดการทำงาน');return;}
    // the server refuses a working day anyway; asking here keeps the answer in front of the person
    try{ const dc=await api('holidayDateCheck',{date:g('hotDate')});
      if(dc && !dc.holiday){ toast(EN()?'Holiday OT can only be recorded on a holiday':'OT วันหยุดบันทึกได้เฉพาะวันหยุดเท่านั้น'); return; }
    }catch(e){}
    const studentIds=[...m.querySelectorAll('.hotstd:checked')].map(c=>c.value);
    // said out loud before it is written: the amount is PER PERSON, so ticking five people spends five times it
    if(!confirm((EN()?`Pay ${baht(amount)} each to ${staffIds.length} staff?`:`จ่าย ${baht(amount)} ต่อคน ให้ ${staffIds.length} คน (รวม ${baht(amount*staffIds.length)}) ใช่หรือไม่?`)
      +(studentIds.length?(EN()?`\nAnd open the day for ${studentIds.length} child(ren).`:`\nและเปิดวันนั้นให้นักเรียน ${studentIds.length} คน`):'')))return;
    try{ await api('adminAddHolidayOT',{staffId:USER.staffId,staffIds,date:g('hotDate'),amount,note});
      // the children are a fact about the DAY, not about one teacher's OT row — saved separately, and
      // saved even when the list is empty, because "nobody is coming" is an answer too
      await api('holidayAttendSet',{staffId:USER.staffId,date:g('hotDate'),studentIds});
      confirmSaved(t('c.saved')); A_hotRefresh(); }catch(e){err(e);} };
  window.A_hotSave=async(otId)=>{ const a=document.getElementById('hot_a_'+otId), n=document.getElementById('hot_n_'+otId);
    try{ await api('adminEditOT',{staffId:USER.staffId,otId,amount:a?a.value:undefined,note:n?n.value:undefined}); toast(t('c.saved')); A_hotRefresh(); }catch(e){err(e);} };
  window.A_hotDel=async(otId)=>{ if(!confirm(t('manage.confirmDel')))return;
    try{ await api('adminDeleteOT',{staffId:USER.staffId,otId}); toast(t('manage.deleted')); A_hotRefresh(); }catch(e){err(e);} };

  window.A_otVerify=async()=>{ const rows=await api('otVerification',{});
    modal(`<h3>⏱️ ${esc(t('manage.otVerify'))}</h3><p class="muted" style="font-size:13px">${esc(t('ot.verifyNote'))}</p>
      <div style="overflow:auto"><table style="width:100%;font-size:13px;border-collapse:collapse">
      <tr style="background:var(--blue);color:var(--surface)"><th style="padding:3px 5px">${esc(t('hol.date'))}</th><th>${esc(t('c.staff'))}</th><th>${esc(t('lbl.checkOut'))}</th><th>OT</th><th>${EN()?'OT pay':'ค่า OT'}</th></tr>
      ${rows.map(r=>`<tr style="border-bottom:1px solid var(--line)"><td style="padding:3px 5px">${esc(r.date)}</td><td>${esc(staffNick(r.staffId))}</td><td>${esc(r.out)} <small class="muted">/${esc(r.schedOut)}</small></td><td style="text-align:center">${esc(hmMin(r.otMinutes))}</td><td style="text-align:center">${r.otPay?esc(baht(r.otPay)):'-'}</td></tr>`).join('')}
      </table></div>
      <p class="muted" style="font-size:13px;margin-top:6px">${EN()?'OT pay = hours × (salary ÷ 30 ÷ 8) × 1.5 (Thai labour law, normal working day)':'ค่า OT = ชั่วโมง × (เงินเดือน ÷ 30 ÷ 8) × 1.5 (ตามกฎหมายแรงงานไทย วันทำงานปกติ)'}</p>
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
      <p class="muted" style="font-size:13px">${esc(t('org.note'))}</p>
      <div class="card" ondragover="event.preventDefault()" ondrop="A_drop(event,'')" style="background:var(--warn-bg);border-color:var(--warn-line)"><h3>🧑‍🏫 ${EN()?'Unassigned staff — drag into a class':'พนักงานที่ยังไม่ได้จัดชั้น — ลากไปใส่ชั้นเรียน'} <small class="muted">${unassigned.length}</small></h3>
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
  ADMIN_SUB_holidays = async ()=>{ const [hs,bc]=await Promise.all([api('holidays'),api('bigCleaningDays')]);
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('manage')">${t('c.back')}</button><h2 class="page">🗓️ ${esc(t('manage.holidays'))}</h2>
      <div class="card"><h3>${BC_ICON} ${BC_NAME()}</h3>
        <p class="muted" style="font-size:13px">${EN()?'A monthly mandatory workday — it counts as work even on a Saturday, but it is worked to the hours below rather than each group’s normal shift. Lateness and OT that day are measured against them, and attendance earns a diligence bonus.':'วันทำงานบังคับเดือนละครั้ง · นับเป็นวันทำงาน (แม้ตรงเสาร์-อาทิตย์) แต่ใช้เวลาเข้า-ออกด้านล่างแทนเวลาปกติของกลุ่ม · การมาสายและ OT ของวันนั้นคิดจากเวลานี้ · มาแล้วได้เบี้ยขยันเพิ่ม'}</p>
        <div class="grid2">
          <label class="field"><span>🕗 ${EN()?'Check-in time':'เวลาเข้างาน'}</span><input id="setBCIn" type="time" value="${esc(bc.checkIn||'08:30')}"/></label>
          <label class="field"><span>🕔 ${EN()?'Check-out time':'เวลาออกงาน'}</span><input id="setBCOut" type="time" value="${esc(bc.checkOut||'17:00')}"/></label></div>
        <label class="field"><span>${EN()?'Bonus per meeting day (฿)':'เบี้ยขยันต่อวัน (฿)'}</span><input id="setBC" type="number" value="${esc(bc.amount||0)}"/></label>
        <button class="btn sm outline block" onclick="A_bcSaveHours(this)">💾 ${EN()?'Save hours & bonus':'บันทึกเวลาและเบี้ยขยัน'}</button>
        <div id="bcList">${(bc.days||[]).map(d=>`<div class="list-item"><span>${BC_ICON} ${esc(ddmmyyyy(d))}</span><button class="btn sm pink" onclick="A_bcRemove('${esc(d)}')" aria-label="${EN()?"Delete":"ลบ"}" title="${EN()?"Delete":"ลบ"}">🗑️</button></div>`).join('')||`<small class="muted">${EN()?'no dates set':'ยังไม่ได้กำหนดวัน'}</small>`}</div>
        <div class="grid2" style="margin-top:6px"><input type="date" id="bcDate"/><button class="btn" onclick="A_bcAdd()">+ ${esc(t('manage.add'))}</button></div></div>
      <div class="card"><h3>➕ ${esc(t('hol.add'))}</h3>
        <div class="grid2"><label class="field"><span>${esc(t('hol.date'))}</span><input type="date" id="hDate"/></label>
          <label class="field" style="display:flex;align-items:center;gap:8px;margin-top:22px"><input type="checkbox" id="hRec" style="width:auto"/> ${esc(t('hol.recurring'))}</label></div>
        <div class="grid2"><label class="field"><span>${esc(t('hol.nameTH'))}</span><input id="hNameTH"/></label><label class="field"><span>${esc(t('hol.nameEN'))}</span><input id="hNameEN"/></label></div>
        <div class="grid2"><label class="field"><span>${esc(t('hol.startTime'))}</span><input type="time" id="hStart"/></label><label class="field"><span>${esc(t('hol.endTime'))}</span><input type="time" id="hEnd"/></label></div>
        <small class="muted">${esc(t('hol.timeNote'))}</small>
        <button class="btn block" style="margin-top:8px" onclick="A_addHoliday()">${esc(t('hol.add'))}</button></div>
      <div class="card"><h3>📋 ${esc(t('hol.list'))}</h3>${hs.map(h=>`<div class="list-item"><span><b>${esc(h.Date)}</b> · ${esc(EN()?h.NameEN:h.NameTH)}${holWindow(h)?` <span class="pill wait" style="font-size:11px">🕘 ${esc(holWindow(h))}</span>`:''}${h.Recurring?` <span class="pill info">${esc(t('hol.yearly'))}</span>`:''}</span><span class="acts2"><button class="btn sm outline" onclick="A_editHoliday('${esc(h.Date)}','${esc(h.NameTH||'')}')" aria-label="${EN()?"Edit":"แก้ไข"}" title="${EN()?"Edit":"แก้ไข"}">✏️</button><button class="btn sm pink" onclick="A_removeHoliday('${h.Date}','${esc(h.NameTH)}')" aria-label="${EN()?"Delete":"ลบ"}" title="${EN()?"Delete":"ลบ"}">🗑️</button></span></div>`).join('')}</div>`;
    window._HOLS=hs;
  };
  /**
   * Correct a holiday that is already saved. A typo in the date, or a half-day window that turned out
   * to be the wrong half, used to mean deleting it and adding it again — and between those two steps
   * the day was open for check-in with nobody at school.
   */
  window.A_editHoliday=(date,nameTH)=>{ const h=(window._HOLS||[]).find(x=>String(x.Date)===String(date)&&String(x.NameTH||'')===String(nameTH))||{Date:date,NameTH:nameTH};
    modal(`<h3>✏️ ${EN()?'Edit holiday':'แก้ไขวันหยุด'} — ${esc(h.Date)}</h3>
      <div class="grid2"><label class="field"><span>${esc(t('hol.date'))}</span><input type="date" id="ehDate" value="${esc(ymd(h.Date))}"/></label>
        <label class="field" style="display:flex;align-items:center;gap:8px;margin-top:22px"><input type="checkbox" id="ehRec" style="width:auto" ${h.Recurring?'checked':''}/> ${esc(t('hol.recurring'))}</label></div>
      <div class="grid2"><label class="field"><span>${esc(t('hol.nameTH'))}</span><input id="ehNameTH" value="${esc(h.NameTH||'')}"/></label>
        <label class="field"><span>${esc(t('hol.nameEN'))}</span><input id="ehNameEN" value="${esc(h.NameEN||'')}"/></label></div>
      <div class="grid2"><label class="field"><span>${esc(t('hol.startTime'))}</span><input type="time" id="ehStart" value="${esc(String(h.StartTime||'').slice(0,5))}"/></label>
        <label class="field"><span>${esc(t('hol.endTime'))}</span><input type="time" id="ehEnd" value="${esc(String(h.EndTime||'').slice(0,5))}"/></label></div>
      <small class="muted">${esc(t('hol.timeNote'))}</small>
      <button class="btn sm outline block" style="margin-top:6px" onclick="document.getElementById('ehStart').value='';document.getElementById('ehEnd').value=''">🕘 ${EN()?'Clear the times (all day)':'ล้างเวลา (หยุดทั้งวัน)'}</button>
      <button class="btn block" style="margin-top:8px" onclick="A_editHolidaySave('${esc(h.Date)}','${esc(h.NameTH||'')}',this)">${esc(t('c.save'))}</button>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`); };
  window.A_editHolidaySave=async(date,nameTH,btn)=>{ const m=btn.closest('.modal'); const g=id=>{ const e=m.querySelector('#'+id); return e?e.value.trim():''; };
    const s=g('ehStart'), e=g('ehEnd');
    if(s&&e&&e<s){ toast(EN()?'The end time is before the start time':'เวลาสิ้นสุดอยู่ก่อนเวลาเริ่ม'); return; }
    if(!g('ehDate')){ toast(t('hol.date')); return; }
    btn.disabled=true;
    try{ await api('editHoliday',{date,nameTH,newDate:g('ehDate'),newNameTH:g('ehNameTH'),newNameEN:g('ehNameEN'),
        recurring:m.querySelector('#ehRec').checked,startTime:s,endTime:e});
      m.remove(); confirmSaved(t('c.saved')); GO_('holidays'); }catch(err_){ err(err_); btn.disabled=false; } };
  window.A_addHoliday=async()=>{ const d=$('#hDate').value; if(!d){toast(t('hol.date'));return;}
    const s=($('#hStart')||{}).value||'', e=($('#hEnd')||{}).value||'';
    // half a day means a window, and a window that ends before it starts is not one
    if(s&&e&&e<s){ toast(EN()?'The end time is before the start time':'เวลาสิ้นสุดอยู่ก่อนเวลาเริ่ม'); return; }
    await api('addHoliday',{date:d,nameTH:$('#hNameTH').value,nameEN:$('#hNameEN').value,recurring:$('#hRec').checked,startTime:s,endTime:e}); confirmSaved(t('c.saved')); GO_('holidays'); };
  // "08:00-12:30", or '' when the holiday covers the whole day
  window.A_removeHoliday=async(date,nameTH)=>{ await api('removeHoliday',{date,nameTH}); toast(t('manage.deleted')); GO_('holidays'); };

  // Admin finance dashboard — tuition collection + salary payout + income/expense
  let FIN_MONTH=null;
  // Prepay retro-check: bills the OLD prepay logic marked fully paid (should have covered tuition only).
  window.A_prepayAudit=async(apply)=>{ const r=await api('prepayAudit', apply?{apply:true}:{});
    const items=r.items||[];
    modal(`<h3>🔍 ${EN()?'Prepay retro-check':'ตรวจ prepay ย้อนหลัง'}</h3>
      <p class="muted" style="font-size:13px">${EN()?'Confirmed prepays':'prepay ที่ยืนยันแล้ว'}: <b>${r.prepaysPaid}</b> · ${EN()?'bills flagged':'บิลที่เข้าข่าย'}: <b>${r.flaggedBills}</b>${r.applied?` · ${EN()?'repaired':'แก้ไขแล้ว'}: <b>${r.repaired}</b>`:''}</p>
      ${items.length?`<div style="max-height:48vh;overflow:auto">${items.map(x=>`<div class="list-item"><span><b>${esc(x.student)}</b> · ${esc(x.month)}<br><small class="muted">${esc(x.billingId)} · ${esc(x.status)}/${esc(x.verified||'-')} · ${baht(x.amount)}</small></span></div>`).join('')}</div>
        <p class="muted" style="font-size:13px">${EN()?'“Repair” resets bills marked PREPAID back to unpaid so only tuition is credited and extras (food/activity) are billed again. Bills the family truly paid are left untouched.':'“แก้ไข” จะรีเซ็ตบิลที่ถูกทำเครื่องหมาย PREPAID กลับเป็นค้างชำระ เพื่อให้ระบบเครดิตเฉพาะค่าเทอม และเรียกเก็บค่าอาหาร/กิจกรรมตามจริง (บิลที่จ่ายจริงไม่ถูกแตะ)'}</p>
        ${apply?'':`<button class="btn block pink" onclick="A_prepayAudit(true)">🛠️ ${EN()?'Repair flagged bills':'แก้ไขบิลที่เข้าข่าย'}</button>`}`
        :`<div class="card" style="background:var(--ok-bg);border-color:var(--ok-line);color:var(--ok)">✓ ${EN()?'No affected bills — nothing to fix.':'ไม่มีบิลที่ได้รับผลกระทบ — ไม่ต้องแก้ไขอะไร'}</div>`}
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
    if(apply){ toast((EN()?'Repaired ':'แก้ไขแล้ว ')+r.repaired); }
  };
  // ---- การเงิน HUB: one place for รับเงิน (income) / จ่ายเงิน (payroll) / รออนุมัติ (verify) ----
  let FIN_TAB='in';
  window.A_finTab=(tab)=>{ FIN_TAB=tab; GO('finance'); };
  // "ชำระล่วงหน้า 6 เดือน (ส.ค. 2569 – ม.ค. 2570) · เดือนที่ 1/6 · เหลืออีก 5 เดือน"
  function prepaySpan(pp){ if(!pp) return '';
    const range=(pp.from&&pp.to)?` (${monthNameYear(pp.from)} – ${monthNameYear(pp.to)})`:'';
    const left=Number(pp.left||0);
    return EN()
      ? `Paid ${pp.months} months in advance${range} · month ${pp.index}/${pp.months}${left>1?` · ${left-1} more covered`:' · last covered month'}`
      : `ชำระล่วงหน้า ${pp.months} เดือน${range} · เดือนที่ ${pp.index}/${pp.months}${left>1?` · เหลืออีก ${left-1} เดือน`:' · เดือนสุดท้ายที่ครอบคลุม'}`; }
  /**
   * One row in the finance income list. The amount shown is what is STILL OWED, not the gross bill —
   * a prepaid family was being listed at the full tuition with a "ค้างชำระ" tag beside it. Tuition
   * settled in advance says so; anything left over is labelled as NOT tuition.
   */
  function finStudentRow(s){
    const tuiOpen=Number(s.tuitionOpen||0), othOpen=Number(s.otherOpen||0);
    const pill = s.prepaid && tuiOpen<=0
        ? `<span class="pill ok">💰 ${EN()?'paid in advance':'ชำระล่วงหน้าแล้ว'}</span>`
      : s.paid ? `<span class="pill ok">${esc(t('s.paid'))}</span>`
      : s.partial ? `<span class="pill wait">${EN()?'partial':'บางส่วน'} ${baht(s.collected)}</span>`
      : s.status==='NO_BILL' ? `<span class="pill info">${esc(t('fin.noBill'))}</span>`
      : `<span class="pill bad">${esc(t('s.unpaid'))}</span>`;
    // A slip the parent already sent is NOT the family owing money — it is the school owing them a
    // check. Showing "ค้างชำระ" for it made admins chase people who had already transferred.
    const othPend=Number(s.otherPending||0), othReal=Math.max(0,othOpen-othPend);
    const otherPill = (tuiOpen<=0 && othOpen>0)
      ? (othReal>0
          ? `<br><span class="pill wait" style="font-size:11px">⚠️ ${EN()?`other charges due ${baht(othReal)}`:`ค้างชำระอื่นๆ (ไม่ใช่ค่าเทอม) ${baht(othReal)}`}</span>`
          : '')
        + (othPend>0 ? `<br><span class="pill info" style="font-size:11px">🕐 ${EN()?`slip sent — awaiting your check ${baht(othPend)}`:`แนบสลิปแล้ว รอตรวจสอบ ${baht(othPend)}`}</span>` : '')
      : '';
    const amount = (tuiOpen+othOpen)>0 ? baht(tuiOpen+othOpen) : `<span class="muted">${baht(0)}</span>`;
    const sub = s.prepaid ? `<br><small style="color:var(--ok);font-weight:400">💰 ${esc(prepaySpan(s.prepay))}</small>` : '';
    // Children on temporary leave are still billable — this is how a deposit or a first month is
    // collected BEFORE a child starts — so they stay on the list, marked, at the bottom.
    const pausedTag = s.paused
      ? `<br><small style="color:var(--warn);font-weight:400">⏳ ${EN()?'on temporary leave':'ลาชั่วคราว'}${s.pauseFrom?` · ${esc(s.pauseFrom)}${s.pauseTo?`–${esc(s.pauseTo)}`:''}`:''}</small>`
      : '';
    return `<div class="list-item" style="cursor:pointer${s.paused?';opacity:.75':''}" onclick="A_finStudent('${s.studentId}')">
      <span><b>${esc(dnick(s))}</b><br><small class="muted" style="font-weight:400">${dnSub(s)?esc(dnSub(s))+" · ":""}${esc(planLabel(s.plan))}</small>${sub}${pausedTag}</span>
      <span style="text-align:right">${amount} ${pill}${otherPill} <span class="muted">›</span></span></div>`;
  }
  SCREENS.Admin.finance = async () => { const month=FIN_MONTH||monthStr();
    // plans come along so planLabel() can name the package instead of printing "pkg_e32dd4"
    const [f,pend,plans]=await Promise.all([api('financeSummary',{month}), api('pendingPayments'), api('getPlans').catch(()=>[])]);
    if(plans&&plans.length) A_CACHE.plans=plans;
    const pendN=(pend||[]).length;
    const stat=(cls,n,l)=>`<div class="stat ${cls}"><div class="n">${n}</div><div class="l">${esc(l)}</div></div>`;
    // income tab: tuition/OT/charges collection per student
    const inTab=`<div class="card"><div class="spread"><h3>👶 ${esc(t('fin.tuition'))}</h3><span class="pill ${f.studentsPaid>=f.studentsTotal?'ok':'wait'}">${f.studentsPaid}/${f.studentsTotal} ${esc(t('fin.paid'))}</span></div>
        ${sortBy(f.students,dnick).sort((a,b)=>(a.paused?1:0)-(b.paused?1:0)).map(s=>finStudentRow(s)).join('')}
        <!-- collectedAll counts each kind once; tuitionCollected+otCollected counted the OT twice -->
        <div class="spread" style="margin-top:8px"><b>${esc(t('fin.collected'))}</b><b style="color:var(--ok)">${baht(f.collectedAll!=null?f.collectedAll:(f.tuitionCollected+f.otCollected))}</b></div>
        <button class="btn sm outline block" style="margin-top:10px" onclick="A_prepayAudit()">🔍 ${EN()?'Prepay check (retro)':'ตรวจ prepay ย้อนหลัง'}</button></div>`;
    // payroll tab: per-staff salary + full payroll form
    const payTab=`<div class="card"><div class="spread"><h3>👩‍🏫 ${esc(t('fin.salary'))}</h3><span class="pill ${f.staffPaid>=f.staffTotal?'ok':'wait'}">${f.staffPaid}/${f.staffTotal} ${esc(t('fin.computed'))}</span></div>
        ${sortPeopleD(f.staff).map(s=>`<div class="list-item" style="cursor:pointer" onclick="A_finStaff('${s.staffId}')"><span><b>${esc(dnick(s))}</b>${dnSub(s)?` <small class="muted" style="font-weight:400">${esc(dnSub(s))}</small>`:""}</span><span>${baht(s.net)} ${s.computed?`<span class="pill ok">${esc(t('fin.done'))}</span>`:`<span class="pill bad">${esc(t('fin.pending'))}</span>`} <span class="muted">›</span></span></div>`).join('')}
        <div class="spread" style="margin-top:8px"><b>${esc(t('fin.totalSalary'))}</b><b style="color:var(--bad)">${baht(f.expense)}</b></div>
        <button class="btn sm block" style="margin-top:10px" onclick="GO('payroll')">📄 ${EN()?'Full payroll calculator':'เครื่องคำนวณเงินเดือน (เต็ม)'}</button></div>`;
    // verify tab: pending slips/cash to confirm
    const waitTab=`<p class="muted" style="font-size:13px;margin:2px 2px 8px">${esc(t('verify.note'))}</p>${verifyListHTML(pend||[])}`;
    const tab=(k,ic,lbl,badge)=>`<button class="${FIN_TAB===k?'active':''}" onclick="A_finTab('${k}')">${ic} ${esc(lbl)}${badge?` (${badge})`:''}</button>`;
    app.innerHTML=`<h2 class="page">💰 ${EN()?'Finance':'การเงิน'}</h2>
      <div class="card"><label class="field" style="margin:0"><span>${esc(t('c.month'))}</span><input type="month" value="${month}" onchange="FIN_set(this.value)"/></label>
        <div class="grid2" style="margin-top:10px"><div class="grid2" style="grid-template-columns:1fr 1fr;gap:8px">${stat('green',baht(f.income),t('fin.income'))}${stat('pink',baht(f.expense),t('fin.expense'))}</div>
          <div class="grid2" style="grid-template-columns:1fr 1fr;gap:8px">${stat(f.net>=0?'':'amber',baht(f.net),t('fin.net'))}${stat('amber',baht(f.tuitionOutstanding),t('fin.outstanding'))}</div></div></div>
      <div class="seg">${tab('in','💵',EN()?'Income':'รับเงิน')}${tab('pay','💸',EN()?'Payroll':'จ่ายเงิน')}${tab('wait','✅',EN()?'To approve':'รออนุมัติ',pendN)}</div>
      ${FIN_TAB==='pay'?payTab:FIN_TAB==='wait'?waitTab:inTab}`;
  };
  window.FIN_set=(m)=>{ FIN_MONTH=m; GO('finance'); };

  // ---- Finance: per-student detail (bill + extra charges + OT) — view/add/edit/delete in one place ----
  window.A_finStudent=async(sid)=>{ const month=FIN_MONTH||monthStr(); window._FIN_SID=sid;
    const [bills,charges,ot,allSlips,pre]=await Promise.all([api('payments',{studentId:sid}),api('studentCharges',{studentId:sid,month}),api('otDaily',{studentId:sid}),api('paymentSlips',{studentId:sid}),api('prepayments',{studentId:sid}).catch(()=>[])]);
    // A_CACHE.students is only filled by the manage screen, so opening this from Finance left the
    // header showing the raw StudentID ("💰 STD-018 -"). Fetch the roster once if it isn't loaded.
    let s=(A_CACHE.students||[]).find(x=>x.StudentID===sid)||(MOCK.students||[]).find(x=>x.StudentID===sid);
    if(!s){ try{ const list=await api('listStudents'); if(list&&list.length){ A_CACHE.students=list; s=list.find(x=>x.StudentID===sid); } }catch(e){} }
    s=s||{};
    const slipsOf=(kind,id)=>(allSlips||[]).filter(x=>x.RefKind===kind&&x.RefID===id);
    const bill=(bills||[]).find(b=>ym(b.Month)===ym(month));
    const otM=(ot||[]).filter(o=>ym(o.Date)===ym(month));
    const stPill=st=>({UNPAID:'bad',PENDING_VERIFY:'wait',PARTIAL:'wait',PAID:'ok',CANCELLED:'info'}[st]||'info');
    // The bill stores tuition already NET of the child's standing discount, because that is what the
    // parent must see. The admin needs the working: full package price, the discount taken off, then the
    // net — otherwise the number looks arbitrary and cannot be checked against the package.
    const _planPrice=Number((A_plans().find(x=>x.id===s.Plan)||{}).price||0);
    const _discAmt=Number(s.DiscountAmount||0);
    const _discBaht=_discAmt>0 ? (/%|percent/i.test(String(s.DiscountUnit||'')) ? Math.round(_planPrice*_discAmt/100) : _discAmt) : 0;
    const _isTuition=lbl=>/ค่าเทอม|tuition/i.test(String(lbl||''));
    const billBox = bill
      ? `<table style="width:100%;font-size:13.5px;margin:4px 0">${(bill.Items||[]).map(it=>{
            // expand the single net tuition line into price − discount for the admin's eyes only
            if(_discBaht>0 && _isTuition(it[0]) && Number(it[1])>0 && Math.abs(_planPrice-_discBaht-Number(it[1]))<1)
              return `<tr><td>${esc(it[0])} <small class="muted">${EN()?'(package price)':'(ราคาแพ็กเกจ)'}</small></td><td style="text-align:right">${baht(_planPrice)}</td></tr>`
                   + `<tr><td style="color:var(--ok)">🏷️ ${EN()?'student discount':'ส่วนลดของนักเรียน'} <small class="muted">${EN()?'admin only':'ผู้ปกครองไม่เห็นบรรทัดนี้'}</small></td><td style="text-align:right;color:var(--ok)">−${baht(_discBaht)}</td></tr>`;
            return `<tr><td>${Number(it[1])<0?'🏷️ ':''}${esc(it[0])}</td><td style="text-align:right;color:${Number(it[1])<0?'var(--ok)':'inherit'}">${Number(it[1])<0?'−'+baht(Math.abs(it[1])):baht(it[1])}</td></tr>`; }).join('')}
          <tr style="border-top:1px solid var(--line)"><td><b>${EN()?'Total due':'ยอดรวม'}</b></td><td style="text-align:right"><b>${baht(bill.TotalDue!=null?bill.TotalDue:bill.Amount)}</b></td></tr>
          ${Number(bill.PaidConfirmed||0)>0?`<tr><td>${EN()?'Paid':'ชำระแล้ว'}</td><td style="text-align:right;color:var(--ok)">−${baht(bill.PaidConfirmed)}</td></tr>`:''}
          <tr><td><b>${EN()?'Outstanding':'คงค้าง'}</b></td><td style="text-align:right"><b style="color:${Number(bill.Outstanding||0)>0?'var(--bad)':'var(--ok)'}">${baht(bill.Outstanding||0)}</b></td></tr></table>
        <div class="spread" style="margin:2px 0 4px"><span class="pill ${Number(bill.Outstanding||0)<=0?'ok':'bad'}">${Number(bill.Outstanding||0)<=0?(Number(bill.PrepaidTuition||0)>0?('💰 '+(EN()?'paid in advance':'ชำระล่วงหน้าแล้ว')):('✅ '+(EN()?'paid in full':'ชำระครบแล้ว'))):('⏳ '+(EN()?'outstanding':'ค้างชำระ')+' '+baht(bill.Outstanding))}</span><small class="muted">${esc(bill.Status||'')}</small></div>
        ${bill.Prepay?`<div class="card" style="background:var(--ok-bg);border-color:var(--ok-line);padding:6px 8px;margin:2px 0"><small style="color:var(--ok)">💰 ${esc(prepaySpan(bill.Prepay))}</small></div>`:''}
        ${slipHistoryHTML(slipsOf('bill',bill.BillingID),true)}
        ${Number(bill.Outstanding||0)>0?cashBox('bill',bill.BillingID,sid,Number(bill.Outstanding||0)):''}
        <div class="row" style="margin-top:6px"><button class="btn sm pink" onclick="A_finDelBill('${esc(bill.BillingID)}','${sid}',this)">🗑️ ${EN()?'Delete bill':'ลบบิล'}</button></div>`
      : `<p class="muted" style="font-size:13px">${EN()?'No bill issued for this month yet.':'ยังไม่ได้ออกบิลของเดือนนี้'}</p>
         <div class="grid2" style="align-items:end"><label class="field" style="margin:0"><span>${EN()?'Bill month':'เดือนที่จะออกบิล'}</span><input type="month" id="fbMonth" value="${esc(ym(month))}"/></label>
           <button class="btn sm" onclick="A_finIssueBill('${sid}')">🧾 ${EN()?'Issue bill':'ออกบิล'}</button></div>`;
    // the child's standing discount is applied to tuition on every bill — show it so the admin can see
    // WHY the amount differs from the package price, instead of having to open the student record
    const _disc=Number(s.DiscountAmount||0);
    const discBox=_disc>0?`<div class="list-item" style="background:var(--ok-bg);border-radius:8px;padding:6px 8px;margin-top:4px"><span>🏷️ ${EN()?'Standing discount':'ส่วนลดประจำของนักเรียน'} <small class="muted">${EN()?'always applied to tuition':'หักจากค่าเทอมทุกบิล'}</small></span><b style="color:var(--ok)">−${/%|percent/i.test(String(s.DiscountUnit||''))?_disc+'%':baht(_disc)}</b></div>`:'';
    const chargeBox = `${(charges||[]).length?(charges).map(c=>{ const cOut=Number(c.Outstanding!=null?c.Outstanding:c.Amount);
      return `<div style="border-bottom:1px solid var(--surface-3);padding:4px 0"><div class="list-item"><span>${Number(c.Amount)<0?'🏷️ ':''}${esc(c.Label)} <b style="color:${Number(c.Amount)<0?'var(--ok)':'inherit'}">${Number(c.Amount)<0?'−'+baht(Math.abs(c.Amount)):baht(c.Amount)}</b> <span class="pill ${stPill(c.Status)}" style="font-size:11px">${esc(c.Status||'UNPAID')}</span></span><button class="btn sm pink" onclick="A_finDelCharge('${esc(c.ChargeID)}','${sid}',this)" aria-label="${EN()?"Delete":"ลบ"}" title="${EN()?"Delete":"ลบ"}">🗑️</button></div>${slipHistoryHTML(slipsOf('charge',c.ChargeID),true)}${cOut>0?cashBox('charge',c.ChargeID,sid,cOut):''}</div>`;
      }).join(''):`<small class="muted">${EN()?'No extra charges':'ไม่มีรายการเพิ่มเติม'}</small>`}
      <div class="grid2" style="margin-top:6px"><input id="fcLabel" placeholder="${EN()?'e.g. Special class':'เช่น ค่าเรียนพิเศษ'}"/>
        <div class="row" style="gap:6px"><select id="fcSign" style="max-width:104px"><option value="1">+ ${EN()?'charge':'เรียกเก็บ'}</option><option value="-1">− ${EN()?'discount':'ส่วนลด'}</option></select><input id="fcAmt" type="number" min="0" placeholder="${EN()?'amount':'จำนวนเงิน'}" style="flex:1"/></div></div>
      <button class="btn sm outline block" style="margin-top:6px" onclick="A_finAddCharge('${sid}')">+ ${EN()?'Add charge':'เพิ่มรายการ'}</button>`;
    // An advance payment is its own payable, so the parent's transfer is filed against IT, not against
    // this month's bill. Without this box the admin opened the bill, saw no slip, and concluded the
    // slip had vanished after approving it — it was simply attached to the prepay.
    const preBox = `${(pre||[]).length?(pre).map(pp=>{ const sl=slipsOf('prepay',pp.PrepayID);
      const cov=Array.isArray(pp.Covered)?pp.Covered:(()=>{try{return JSON.parse(pp.Covered||'[]')}catch(e){return []}})();
      const out=Math.max(0, Number(pp.Amount||0)-(sl.filter(x=>x.Status==='CONFIRMED').reduce((a,x)=>a+Number(x.Amount||0),0)));
      // a duplicate created by a double-tap: still UNPAID with no slip against it at all → binnable.
      // Anything with a slip, or already paid, is left alone.
      const dup = String(pp.Status)==='UNPAID' && !sl.length;
      return `<div style="border-bottom:1px solid var(--surface-3);padding:4px 0"><div class="list-item">
        <span><b>${pp.Months} ${EN()?'months':'เดือน'}</b> ${pp.Discount?`<small class="muted">−${pp.Discount}%</small>`:''} <b>${baht(pp.Amount)}</b>
          <span class="pill ${stPill(pp.Status)}" style="font-size:11px">${esc(pp.Status)}</span>
          ${cov.length?`<br><small class="muted">${EN()?'covers':'มีผล'} ${esc(monthNameYear(cov[0]))} – ${esc(monthNameYear(cov[cov.length-1]))}</small>`:''}
          ${dup?`<br><small style="color:var(--warn)">${EN()?'no slip attached — safe to delete':'ยังไม่มีสลิปแนบ — ลบได้'}</small>`:''}</span>
        <span class="acts"><button class="btn sm outline" onclick="A_editPrepay('${esc(pp.PrepayID)}','${esc(sid)}')" aria-label="${EN()?'Edit months':'แก้เดือนที่มีผล'}" title="${EN()?'Edit which months this covers':'แก้เดือนที่มีผล'}">📅</button>${dup?`<button class="btn sm pink" onclick="A_delPrepay('${esc(pp.PrepayID)}','${esc(sid)}',this)" aria-label="${EN()?'Delete':'ลบ'}" title="${EN()?'Delete this empty entry':'ลบรายการที่ไม่มีสลิป'}">🗑️</button>`:''}</span>
        </div>${slipHistoryHTML(sl,true)}${out>0&&String(pp.Status)!=='PAID'?cashBox('prepay',pp.PrepayID,sid,out):''}</div>`; }).join('')
      :`<small class="muted">${EN()?'No advance payments':'ไม่มีรายการชำระล่วงหน้า'}</small>`}`;
    const otBox = `${otM.length?otM.map(o=>{ const sl=slipsOf('ot',o.OTID);
      return `<div style="border-bottom:1px solid var(--surface-3);padding:4px 0"><div class="list-item"><span>${esc(ymd(o.Date))} · ${esc(String(o.PickupTime||'').slice(0,5))} <b>${baht(o.Amount)}</b> <span class="pill ${stPill(o.Status)}" style="font-size:11px">${esc(o.Status)}</span></span>
        ${o.Status==='PAID'?'':`<span class="row">${o.Status==='CANCELLED'?`<button class="btn sm outline" onclick="A_finOt('${esc(o.OTID)}','restore','${sid}')" aria-label="${EN()?"Restore":"กู้คืน"}" title="${EN()?"Restore":"กู้คืน"}">♻️</button>`:`<button class="btn sm pink" onclick="A_finOt('${esc(o.OTID)}','cancel','${sid}')" aria-label="${EN()?"Cancel":"ยกเลิก"}" title="${EN()?"Cancel":"ยกเลิก"}">🚫</button>`}</span>`}</div>${slipHistoryHTML(sl)}</div>`; }).join(''):`<small class="muted">${EN()?'No OT this month':'ไม่มี OT เดือนนี้'}</small>`}`;
    modal(`<h3>💰 ${esc(dispNick(s)||sid)} <small class="muted" style="font-size:13px">${nmSub(s)?esc(nmSub(s))+' · ':''}${esc(planLabel(s.Plan))}${s.Class?' · '+esc(s.Class):''}</small></h3>
      <p class="muted" style="font-size:13px">${EN()?'Month':'เดือน'} <b>${esc(month)}</b> — ${EN()?'change the month at the finance page':'เปลี่ยนเดือนได้ที่หน้าการเงิน'}</p>
      <div class="card" style="padding:8px"><b>🧾 ${EN()?'Monthly bill':'บิลรายเดือน'}</b>${discBox}${billBox}</div>
      <div class="card" style="padding:8px"><b>💵 ${EN()?'Extra charges':'ค่าใช้จ่ายเพิ่มเติม'}</b>${chargeBox}</div>
      <div class="card" style="padding:8px"><b>💰 ${EN()?'Advance payments':'ชำระล่วงหน้า'}</b>${preBox}</div>
      <div class="card" style="padding:8px"><b>⏰ ${EN()?'Late-pickup OT':'OT รับช้า'}</b>${otBox}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  const _finReopen=(sid,month)=>{ const x=document.querySelector('.modal'); if(x)x.remove(); if(month) FIN_MONTH=month; A_finStudent(sid); };
  /**
   * "Money received at the desk" for any payable. Families rarely pay one clean way: the enrolment fee
   * comes in cash while the tuition is transferred, or two months are paid ahead in one go. Recording
   * the cash part here first drops the outstanding balance, so the slip the parent uploads only has to
   * cover what is genuinely left — instead of never matching the bill.
   */
  function cashBox(kind, refId, sid, outstanding){
    return `<div class="card" style="background:var(--surface-2);padding:8px;margin-top:6px">
      <b style="font-size:13px">💵 ${EN()?'Record money received (cash / already in the bank)':'บันทึกรับชำระ (เงินสด / เห็นยอดเข้าบัญชีแล้ว)'}</b>
      <p class="muted" style="font-size:13px;margin:2px 0 6px">${EN()?`Outstanding ${baht(outstanding)}. Recording it here counts as paid straight away — no slip needed.`:`ค้างอยู่ ${baht(outstanding)} · บันทึกแล้วถือว่าชำระทันที ไม่ต้องแนบสลิป`}</p>
      <div class="grid2" style="align-items:end">
        <label class="field" style="margin:0"><span>${EN()?'Amount':'จำนวนเงิน'}</span><input type="number" min="0" id="cash_${esc(refId)}" value="${outstanding}"/></label>
        <label class="field" style="margin:0"><span>${EN()?'Received on':'วันที่รับ'}</span><input type="date" id="cashd_${esc(refId)}" value="${esc(todayStr())}"/></label></div>
      <input id="cashn_${esc(refId)}" placeholder="${EN()?'note, e.g. enrolment fee in cash':'หมายเหตุ เช่น ค่าธรรมเนียมแรกเข้า รับเป็นเงินสด'}" style="margin-top:6px"/>
      <button class="btn sm block" style="margin-top:6px" onclick="A_finCash('${esc(kind)}','${esc(refId)}','${esc(sid)}',this)">💵 ${EN()?'Record as received':'บันทึกรับชำระ'}</button></div>`;
  }
  window.A_finCash=async(kind,refId,sid,btn)=>{ const m=btn.closest('.modal');
    const g=id=>{ const e=m.querySelector('#'+id+'_'+CSS.escape(refId)); return e?e.value.trim():''; };
    const amt=Number(g('cash')||0);
    if(!(amt>0)){ toast(EN()?'Enter the amount received':'กรอกจำนวนเงินที่รับมา'); return; }
    if(btn)btn.disabled=true;
    try{ const r=await api('recordCashPayment',{kind,refId,amount:amt,date:g('cashd'),note:g('cashn'),staffId:USER.staffId});
      toast(Number(r.outstanding||0)>0
        ? (EN()?`Recorded. Still outstanding ${baht(r.outstanding)}`:`บันทึกแล้ว · ยังค้างอีก ${baht(r.outstanding)}`)
        : (EN()?'Recorded — paid in full':'บันทึกแล้ว · ชำระครบ'));
      _finReopen(sid);
    }catch(e){ err(e); if(btn)btn.disabled=false; } };
  window.A_finAddCharge=async(sid)=>{ const m=document.querySelector('.modal'); const label=(m.querySelector('#fcLabel').value||'').trim();
    const sign=Number((m.querySelector('#fcSign')||{}).value||1)<0?-1:1;
    const amt=Math.abs(Number(m.querySelector('#fcAmt').value)||0)*sign;
    if(!label||!amt){ toast(EN()?'Enter label and amount':'กรอกชื่อรายการและจำนวนเงิน'); return; }
    try{ await api('addStudentCharge',{studentId:sid,month:FIN_MONTH||monthStr(),label,amount:amt}); _finReopen(sid); }catch(e){err(e);} };
  window.A_finDelCharge=(chargeId,sid,btn)=>{
    deleteWithUndo(EN()?'Charge removed':'ลบรายการเรียกเก็บแล้ว', ()=>api('removeStudentCharge',{chargeId}).then(()=>_finReopen(sid)), null, null, btn); };
  window.A_finIssueBill=async(sid)=>{ const m=document.querySelector('.modal'); const pick=m&&m.querySelector('#fbMonth');
    const month=(pick&&pick.value)||FIN_MONTH||monthStr();
    try{ await api('issueBill',{studentId:sid,month}); _finReopen(sid,month); }catch(e){err(e);} };
  window.A_finDelBill=(billingId,sid,btn)=>{ if(!confirm(EN()?'Delete this bill?':'ลบบิลนี้?'))return;
    deleteWithUndo(EN()?'Bill deleted':'ลบบิลแล้ว', ()=>api('deleteBill',{billingId}).then(()=>_finReopen(sid)), null, null, btn); };
  window.A_finOt=async(otId,kind,sid)=>{ try{ await api(kind==='cancel'?'adminCancelOT':'adminRestoreOT',{otId}); _finReopen(sid); }catch(e){err(e);} };
  /**
   * Correct an advance payment. Getting the START MONTH wrong is the common mistake — a transfer made
   * on 31 July belongs to August, not July — and it silently shortens the cover by a month. That is
   * fixable even after payment; the months count and the discount are not, once money has moved.
   */
  window.A_editPrepay=async(prepayId,sid)=>{
    const list=await api('prepayments',{studentId:sid}).catch(()=>[]);
    const pp=(list||[]).find(x=>x.PrepayID===prepayId); if(!pp){ toast(t('c.noItems')); return; }
    const cov=Array.isArray(pp.Covered)?pp.Covered:(()=>{try{return JSON.parse(pp.Covered||'[]')}catch(e){return []}})();
    const paid=String(pp.Status)==='PAID';
    const start=(cov[0]||monthStr()).slice(0,7);
    modal(`<h3>📅 ${EN()?'Which months does this cover?':'แก้เดือนที่มีผล'}</h3>
      <div class="card" style="padding:8px;background:var(--surface-2)"><b>${pp.Months} ${EN()?'months':'เดือน'}</b>${pp.Discount?` <small class="muted">−${pp.Discount}%</small>`:''} <b>${baht(pp.Amount)}</b>
        <span class="pill ${paid?'ok':'bad'}" style="font-size:11px">${esc(pp.Status)}</span></div>
      <label class="field"><span>${EN()?'Starts from the month':'เริ่มมีผลตั้งแต่เดือน'}</span>
        <input type="month" id="epStart" value="${esc(start)}" onchange="A_epCov(${Number(pp.Months)||1})"/></label>
      <p class="muted" style="font-size:13px" id="epCov">${EN()?'covers':'มีผล'} <b>${esc(coverSpan(start, Number(pp.Months)||1))}</b></p>
      ${paid?`<div class="card" style="background:var(--ok-bg);border-color:var(--ok-line);padding:8px"><small style="color:var(--ok)">${EN()?'Already paid — only the months can be corrected. The amount the family transferred is never recalculated.':'ชำระแล้ว — แก้ได้เฉพาะเดือนที่มีผล · ยอดที่ผู้ปกครองโอนมาจะไม่ถูกคำนวณใหม่'}</small></div>`
        :`<div class="grid2"><label class="field"><span>${EN()?'Months':'จำนวนเดือน'}</span><input type="number" min="1" id="epMonths" value="${Number(pp.Months)||1}" oninput="A_epCov(this.value)"/></label>
          <label class="field"><span>${EN()?'Discount (%)':'ส่วนลด (%)'}</span><input type="number" min="0" max="100" id="epDisc" value="${Number(pp.Discount)||0}"/></label></div>
          <p class="muted" style="font-size:13px">${EN()?'Not paid yet — the amount is re-quoted from the package price.':'ยังไม่ได้ชำระ — ระบบจะคิดยอดใหม่จากราคาแพ็กเกจ'}</p>`}
      <button class="btn block" onclick="A_editPrepayDo('${esc(prepayId)}','${esc(sid)}',this)">${esc(t('c.save'))}</button>`);
  };
  window.A_epCov=(months)=>{ const el=document.getElementById('epStart'), box=document.getElementById('epCov');
    if(!el||!box||!el.value)return;
    box.innerHTML=`${EN()?'covers':'มีผล'} <b>${esc(coverSpan(el.value, Number(months)||1))}</b>`; };
  window.A_editPrepayDo=async(prepayId,sid,btn)=>{ const m=btn.closest('.modal');
    const g=id=>{ const e=m.querySelector('#'+id); return e?e.value.trim():undefined; };
    const startMonth=g('epStart'); if(!startMonth){ toast(EN()?'Pick the start month':'เลือกเดือนที่เริ่มมีผล'); return; }
    const p={prepayId,startMonth,staffId:USER.staffId};
    if(m.querySelector('#epMonths')){ p.months=Number(g('epMonths'))||1; p.discount=g('epDisc'); }
    try{ await api('editPrepay',p); m.remove(); confirmSaved(t('c.saved')); _finReopen(sid); }catch(e){err(e);} };
  // remove an advance-payment entry the parent created twice and never paid (cancelPrepay only ever
  // touches an UNPAID one, so a real payment can never be deleted this way)
  window.A_delPrepay=(prepayId,sid,btn)=>{ if(!confirm(EN()?'Delete this unpaid advance-payment entry?':'ลบรายการชำระล่วงหน้าที่ยังไม่ได้ชำระนี้?'))return;
    deleteWithUndo(EN()?'Entry removed':'ลบรายการแล้ว', ()=>api('cancelPrepay',{prepayId}).then(()=>_finReopen(sid)), null, null, btn); };

  // ---- Finance: per-staff detail (salary base + this-month OT + compute) ----
  window.A_finStaff=async(sid)=>{ const month=FIN_MONTH||monthStr();
    // A_CACHE.staff is only filled by the manage/payroll screens, so opening this from Finance showed
    // the raw StaffID ("STF-002"). Fetch the roster once if it isn't loaded — same fix as A_finStudent.
    let s=(A_CACHE.staff||[]).find(x=>x.StaffID===sid);
    if(!s){ try{ const list=await api('listStaff'); if(list&&list.length){ A_CACHE.staff=list; s=list.find(x=>x.StaffID===sid); } }catch(e){} }
    s=s||{};
    // staffMonthlyOT returns a SUMMARY OBJECT {hours, rate, amount}, not an array — the old .reduce()
    // threw on every call and the catch swallowed it, so "OT อนุมัติเดือนนี้" always displayed 0.
    let otTotal=0; try{ const mo=await api('staffMonthlyOT',{staffId:sid,month}); otTotal=Number((mo&&mo.amount)||0); }catch(e){}
    let pay=null; try{ pay=await api('getPayslip',{staffId:sid,month}); }catch(e){}   // null = nothing saved yet
    modal(`<h3>👩‍🏫 ${esc(dispNick(s)||sid)} ${nmSub(s)?`<small class="muted" style="font-size:13px;font-weight:400">${esc(nmSub(s))}</small>`:''}${s.Position?` <small class="muted" style="font-size:13px">${_notr(s.Position)}</small>`:''}</h3>
      <div class="card" style="padding:8px"><label class="field"><span>${EN()?'Base salary (฿/month)':'ฐานเงินเดือน (฿/เดือน)'}</span><input id="fsBase" type="number" min="0" value="${esc(s.BaseSalary!=null?s.BaseSalary:'')}"/></label>
        <button class="btn sm block" onclick="A_finSaveBase('${sid}')">💾 ${EN()?'Save base salary':'บันทึกฐานเงินเดือน'}</button></div>
      <div class="card" style="padding:8px"><div class="spread"><span>⏰ ${EN()?'Approved OT this month':'OT อนุมัติเดือนนี้'}</span><b>${baht(otTotal)}</b></div></div>
      ${(()=>{ const paid=String(pay&&pay.SlipSent||'')==='YES';
        if(!pay) return `<div class="card" style="padding:8px"><small class="muted">${EN()?'Nothing saved for this month yet — save the payroll first, then you can mark it paid.':'ยังไม่มีรายการจ่ายของเดือนนี้ — บันทึกเงินเดือนก่อน จึงจะติ๊กว่าจ่ายแล้วได้'}</small></div>`;
        return `<div class="card" style="padding:8px;background:${paid?'var(--ok-bg)':'var(--surface-2)'}">
          <div class="spread"><b>${EN()?'Transfer':'การจ่ายเงิน'}</b><b>${baht(pay.NetPay)}</b></div>
          <div class="spread" style="font-size:13px;margin-top:2px"><span class="muted">${esc(pay.BankName||'')} ${esc(pay.BankAccount||'')}</span>
            <span class="pill ${paid?'ok':'bad'}">${paid?('✅ '+(EN()?'paid':'จ่ายแล้ว')+(pay.PaidDate?' '+esc(ddmmyyyy(pay.PaidDate)):'')):'⏳ '+(EN()?'not paid':'ยังไม่จ่าย')}</span></div>
          ${pay.SlipUrl?`<div style="margin-top:6px"><img src="${esc(pay.SlipUrl)}" style="max-width:100%;border-radius:8px;cursor:pointer" onclick="IMG_zoom('${esc(pay.SlipUrl)}')"/></div>`:''}
          ${paid
            ? `<button class="btn sm outline block" style="margin-top:6px" onclick="A_salaryPaid('${sid}',false)">↩︎ ${EN()?'Undo paid':'ยกเลิกสถานะจ่ายแล้ว'}</button>`
            : `${photoField('fsSlip',(EN()?'Attach transfer slip (optional)':'แนบสลิปโอน (ถ้ามี)'),'',false)}
               <button class="btn sm block" style="margin-top:6px" onclick="A_salaryPaid('${sid}',true)">✅ ${EN()?'Mark paid':'ติ๊กว่าจ่ายแล้ว'}</button>`}
        </div>`; })()}
      <div class="row"><button class="btn sm" onclick="A_finCompute('${sid}')">🧮 ${EN()?'Compute payroll':'คำนวณเงินเดือน'}</button><button class="btn sm outline" onclick="this.closest('.modal').remove();GO('payroll')">📄 ${EN()?'Full payroll':'หน้าเงินเดือนเต็ม'}</button></div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  // record that the salary was actually transferred, with the slip if the admin has one
  window.A_salaryPaid=async(sid,paid)=>{ const m=document.querySelector('.modal'); const month=FIN_MONTH||monthStr();
    let slipUrl='';
    if(paid){ const inp=m&&m.querySelector('#fsSlip'); const f=inp&&inp.files&&inp.files[0];
      if(f){ try{ slipUrl=inp.dataset.url||await compressImage(f); }catch(e){} } }
    if(!paid && !confirm(EN()?'Undo the paid status for this month?':'ยกเลิกสถานะ "จ่ายแล้ว" ของเดือนนี้?')) return;
    try{ await api('markSalaryPaid',{staffId:sid,month,paid,slipUrl:slipUrl||undefined,adminId:USER.staffId});
      if(m)m.remove(); confirmSaved(paid?(EN()?'Marked as paid':'บันทึกว่าจ่ายแล้ว'):(EN()?'Paid status removed':'ยกเลิกสถานะจ่ายแล้ว'));
      A_finStaff(sid); }catch(e){ err(e); } };
  /**
   * Pick the child whose time needs correcting. Admin reaches this from ดำเนินการ → นักเรียน,
   * because "a parent tapped picked-up by mistake" is an attendance job you arrive at knowing the
   * child's name — not something to go hunting for inside one student's record.
   * Teachers still have the button on their own class row, where the child is already in front of them.
   */
  window.A_editAttPick=async()=>{
    let list=A_CACHE.students;
    if(!list||!list.length){ try{ list=await api('listStudents'); A_CACHE.students=list; }catch(e){ list=[]; } }
    const active=(list||[]).filter(s=>String(s.Status||'ACTIVE').toUpperCase()!=='WITHDRAWN');
    modal(`<h3>🕑 ${EN()?'Correct check-in / pick-up':'แก้ไขเวลารับ-ส่ง'}</h3>
      <p class="muted" style="font-size:13px">${EN()?'Pick the child, then the day and the times.':'เลือกนักเรียน แล้วจึงเลือกวันและเวลา'}</p>
      <input id="eaFind" placeholder="🔎 ${EN()?'search by name or nickname':'ค้นหาชื่อ / ชื่อเล่น'}" oninput="A_editAttFilter(this.value)"/>
      <div id="eaList" style="max-height:52vh;overflow:auto;margin-top:8px">${active.map(s=>
        `<div class="list-item eaRow" data-k="${esc(((dispNick(s)||'')+' '+(nmSub(s)||'')+' '+(s.NameEN||'')).toLowerCase())}">
          <span>${studentAvatar(s)} <b>${esc(dispNick(s)||s.StudentID)}</b> <small class="muted">${esc(s.Class||'')}</small></span>
          <button class="btn sm outline" onclick="this.closest('.modal').remove();EDIT_ATT('${esc(s.StudentID)}')">${EN()?'Correct':'แก้ไข'}</button></div>`).join('')
        ||`<div class="card muted">${esc(t('c.noItems'))}</div>`}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.A_editAttFilter=(q)=>{ const k=String(q||'').trim().toLowerCase();
    document.querySelectorAll('#eaList .eaRow').forEach(el=>{ el.style.display = (!k || el.dataset.k.indexOf(k)>=0) ? '' : 'none'; }); };

  // ---- correct a student's check-in / pick-up -----------------------------------------------------
  // A parent tapping "picked up" during class used to be permanent, and it raised an OT charge too.
  // Teachers can fix their own classes; a head teacher and Admin can fix anyone (enforced server-side).
  window.EDIT_ATT=async(sid,dateStr)=>{
    let st=(A_CACHE.students||[]).find(x=>x.StudentID===sid);
    // the attendance-check screen already knows this child's name, and a teacher may not be allowed
    // to list every student in the school — ask the page before asking the server
    if(!st && window._ATTA){ const r=(_ATTA.rows||[]).find(x=>x.studentId===sid);
      if(r) st={StudentID:sid,Nickname:r.nick,NicknameEN:r.nickEN,NameTH:r.name,NameEN:r.nameEN,Class:r.class}; }
    if(!st){ try{ const l=await api('listStudents'); if(l&&l.length){ A_CACHE.students=l; st=l.find(x=>x.StudentID===sid); } }catch(e){} }
    st=st||{StudentID:sid};
    const date=dateStr||todayStr();
    let rec={checkIn:'',checkOut:''};
    try{ const h=await api('studentCheckinHistory',{studentId:sid}); const row=(h||[]).find(r=>ymd(r.Date)===date);
      if(row){ rec.checkIn=String(row.InTime||row.CheckIn||'').slice(0,5); rec.checkOut=String(row.OutTime||row.CheckOut||'').slice(0,5); } }catch(e){}
    modal(`<h3>🕑 ${EN()?'Correct times':'แก้ไขเวลารับ-ส่ง'} — ${esc(dispNick(st)||sid)}</h3>
      <p class="muted" style="font-size:13px">${EN()?'Clearing the pick-up time puts the child back to "at school" and removes any OT that pick-up created. Parents see the correction.':'ลบเวลารับกลับ = เด็กกลับไปเป็น "อยู่ที่โรงเรียน" และ OT ที่เกิดจากการรับครั้งนั้นจะถูกยกเลิกด้วย · ผู้ปกครองจะเห็นผลการแก้ไข'}</p>
      <label class="field"><span>${EN()?'Date':'วันที่'}</span><input type="date" id="eaDate" value="${esc(date)}" onchange="EDIT_ATT('${esc(sid)}',this.value)"/></label>
      <div class="grid2"><label class="field"><span>🟢 ${EN()?'Dropped off':'เวลาส่ง (เข้าเรียน)'}</span><input type="time" id="eaIn" value="${esc(rec.checkIn)}"/></label>
        <label class="field"><span>🔴 ${EN()?'Picked up':'เวลารับกลับ'}</span><input type="time" id="eaOut" value="${esc(rec.checkOut)}"/></label></div>
      <button class="btn sm outline block" onclick="document.getElementById('eaOut').value=''">🚫 ${EN()?'Clear pick-up (tapped by mistake)':'ล้างเวลารับกลับ (กดผิด)'}</button>
      <label class="field" style="margin-top:6px"><span>${EN()?'Reason (kept in the log)':'เหตุผล (บันทึกไว้ในประวัติ)'}</span><input id="eaWhy" placeholder="${EN()?'e.g. parent tapped by mistake':'เช่น ผู้ปกครองกดผิด'}"/></label>
      <button class="btn block" onclick="EDIT_ATT_SAVE('${esc(sid)}',this)">${esc(t('c.save'))}</button>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`);
  };
  window.EDIT_ATT_SAVE=async(sid,btn)=>{ const m=btn.closest('.modal'); const g=id=>{ const e=m.querySelector('#'+id); return e?e.value.trim():''; };
    btn.disabled=true;
    try{ const r=await api('editStudentAttendance',{studentId:sid,date:g('eaDate'),checkIn:g('eaIn'),checkOut:g('eaOut'),
        remark:g('eaWhy')||undefined,staffId:USER.staffId,role:USER.role});
      m.remove();
      confirmSaved((EN()?'Times updated':'แก้ไขเวลาแล้ว')+(r&&r.checkOut?'':' · '+(EN()?'back at school':'กลับเป็นอยู่ที่โรงเรียน')));
      if(window._ATTA_OPEN){ A_attAudit((window._ATTA||{}).date); return; }
      GO(CURRENT); }catch(e){ err(e); btn.disabled=false; } };

  /* ================= ตรวจสอบการลงเวลานักเรียน =====================================================
   * The whole day on one screen: who arrived, who went home, and who is still unaccounted for.
   *
   * A child nobody checked OUT stays "at school" for ever, the day's attendance is wrong, and the
   * late-pickup OT the family owes is never raised. The app could fix that one child at a time, from
   * the class screen — but nobody could SEE the list, which is the thing you need at 18:00.
   *
   * The system never guesses a going-home time. It leaves the day OPEN and a teacher or head teacher
   * enters the real one; the OT is then charged from that time like any other pick-up (dropped off
   * 07:50, entered as 18:40 → 1 hour). It writes through editStudentAttendance, so the class scope,
   * the OT recompute and the activity log are the ones that already exist — not a second copy.
   */
  let ATTA={date:'',filter:'all',className:''};
  window.A_attAudit=async(date)=>{ ATTA.date=date||ATTA.date||todayStr();
    const back=(USER&&USER.role==='Admin')?'leaves':'home';
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('${back}')">${t('c.back')}</button>
      <h2 class="page">🕵️ ${EN()?'Attendance check':'ตรวจสอบการลงเวลานักเรียน'}</h2>
      <div class="card muted">${EN()?'Loading…':'กำลังโหลด…'}</div>`;
    let d; try{ d=await api('attendanceAudit',{date:ATTA.date,staffId:USER.staffId,role:USER.role}); }
    catch(e){ err(e); return; }
    window._ATTA=d; A_attRender(); };
  window.A_attDate=(v)=>{ A_attAudit(v); };
  window.A_attTab=(f)=>{ ATTA.filter=f; A_attRender(); };
  window.A_attClass=(c)=>{ ATTA.className=c||''; A_attRender(); };
  function A_attRender(){ const d=window._ATTA; if(!d)return;
    const c=d.counts||{}, back=(USER&&USER.role==='Admin')?'leaves':'home';
    const tab=(k,icon,label,n,cls)=>`<button class="btn sm ${ATTA.filter===k?'':'outline'}" onclick="A_attTab('${k}')" style="flex:1;min-width:88px">${icon} ${esc(label)} <b>${n}</b></button>`;
    let rows=(d.rows||[]).filter(r=>!ATTA.className||r.class===ATTA.className);
    if(ATTA.filter!=='all') rows=rows.filter(r=>r.status===ATTA.filter);
    const dn=r=>EN()?(r.nickEN||r.nameEN||r.nick||r.name||r.studentId):(r.nick||r.name||r.studentId);
    const pill=r=>r.status==='DONE'?`<span class="pill ok">✅ ${EN()?'complete':'ครบ'}</span>`
      :r.status==='OPEN'?`<span class="pill wait">⏳ ${EN()?'not picked up':'ยังไม่ลงเวลากลับ'}</span>`
      :r.status==='LEAVE'?`<span class="pill info">📩 ${esc(r.leaveType||(EN()?'on leave':'ลา'))}</span>`
      :`<span class="pill bad">➖ ${EN()?'no times':'ยังไม่ลงเวลา'}</span>`;
    // an Observer may look at the day but not change it — the server refuses anyway, so showing the
    // buttons would only be an invitation to an error message
    const canEdit=USER&&USER.role!=='Observer';
    const row=r=>`<div class="list-item" style="flex-wrap:wrap;gap:6px">
      <span style="min-width:0;flex:1"><b>${esc(dn(r))}</b> <small class="muted">${esc(r.class||'')}</small><br>
        <small class="muted">🟢 ${esc(r.inTime||'—')} → 🔴 ${esc(r.outTime||'—')} · ${EN()?'ends':'เลิกเรียน'} ${esc(r.planEnd||'')}</small>
        ${r.otAmount>0?`<br><small style="color:var(--warn)">⏰ OT ${esc(String(r.otLate||0))} ${EN()?'min':'นาที'} · ${baht(r.otAmount)}${r.otStatus==='PAID'?' ✅':''}</small>`:''}</span>
      <span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">${pill(r)}
        ${canEdit&&r.status==='OPEN'?`<button class="btn sm pink" onclick="A_attPunch('${esc(r.studentId)}','OUT')">🔴 ${EN()?'Record pick-up':'ลงเวลากลับ'}</button>`:''}
        ${canEdit&&r.status==='NONE'?`<button class="btn sm green" onclick="A_attPunch('${esc(r.studentId)}','IN')">🟢 ${EN()?'Record arrival':'ลงเวลาเข้า'}</button>`:''}
        ${canEdit?`<button class="btn sm outline" onclick="EDIT_ATT('${esc(r.studentId)}','${esc(d.date)}')" aria-label="${EN()?'Edit':'แก้ไข'}" title="${EN()?'Edit':'แก้ไข'}">✏️</button>`:''}</span></div>`;
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('${back}')">${t('c.back')}</button>
      <h2 class="page">🕵️ ${EN()?'Attendance check':'ตรวจสอบการลงเวลานักเรียน'}</h2>
      <div class="card">
        <label class="field"><span>${EN()?'Day':'วันที่'}</span><input type="date" value="${esc(d.date)}" max="${esc(todayStr())}" onchange="A_attDate(this.value)"/></label>
        ${d.closed?`<div class="card" style="background:var(--warn-bg);border-color:var(--warn-line);color:var(--warn);padding:8px;font-size:13px">
          🎉 ${EN()?'The school was closed for children on this day':'วันนี้โรงเรียนหยุดสำหรับนักเรียน'}${d.holiday?` (${esc(d.holiday.start||'')}–${esc(d.holiday.end||'')})`:''}</div>`:''}
        ${(d.classes||[]).length>1?`<label class="field"><span>${EN()?'Class':'ชั้นเรียน'}</span><select onchange="A_attClass(this.value)">
          <option value="">${EN()?'All classes':'ทุกชั้นเรียน'}</option>
          ${d.classes.map(c=>`<option value="${esc(c)}" ${ATTA.className===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label>`:''}
        <div class="row" style="flex-wrap:wrap;gap:6px;margin-top:4px">
          ${tab('all','👶',EN()?'All':'ทั้งหมด',c.total||0)}
          ${tab('OPEN','⏳',EN()?'Not picked up':'ยังไม่ลงเวลากลับ',c.open||0)}
          ${tab('NONE','➖',EN()?'No times':'ยังไม่ลงเวลา',c.none||0)}
          ${tab('DONE','✅',EN()?'Complete':'ครบ',c.done||0)}
          ${tab('LEAVE','📩',EN()?'On leave':'ลา',c.leave||0)}</div>
        <small class="muted" style="display:block;margin-top:6px">${EN()
          ? 'The system never invents a pick-up time. Enter the real one — OT is charged from it, exactly as it would be if the parent had tapped.'
          : 'ระบบจะไม่เดาเวลากลับให้ · ให้ใส่เวลาที่นักเรียนกลับบ้านจริง (ใกล้เคียงที่สุด) · OT จะคิดตามเวลานั้นเหมือนผู้ปกครองกดเอง'}</small></div>
      ${rows.length?rows.map(row).join(''):`<div class="card muted">${esc(t('c.noItems'))}</div>`}`;
    // so a correction made through the shared ✏️ form comes back HERE instead of bouncing the user
    // to whichever screen they arrived from (GO clears it on any real navigation)
    window._ATTA_OPEN=true;
    window.scrollTo(0,0); }
  /**
   * Enter the time a child really arrived or really went home. Defaulting it to "now" would be the
   * easy thing and the wrong one — this screen is used hours after the fact, and a default of 18:47
   * silently bills a family for OT they did not incur. The field starts EMPTY on a past day.
   */
  window.A_attPunch=(sid,type)=>{ const d=window._ATTA||{}; const r=(d.rows||[]).find(x=>x.studentId===sid)||{};
    const dn=EN()?(r.nickEN||r.nameEN||r.nick||r.name||sid):(r.nick||r.name||sid);
    const isToday=String(d.date)===todayStr();
    modal(`<h3>${type==='OUT'?'🔴 '+(EN()?'Record pick-up':'ลงเวลากลับ'):'🟢 '+(EN()?'Record arrival':'ลงเวลาเข้า')} — ${esc(dn)}</h3>
      <p class="muted" style="font-size:13px">${esc(d.date)}${type==='OUT'?` · ${EN()?'school ends':'เลิกเรียน'} ${esc(r.planEnd||'')}${r.inTime?` · ${EN()?'arrived':'เข้าเรียน'} ${esc(r.inTime)}`:''}`:''}</p>
      <label class="field"><span>${type==='OUT'?(EN()?'Time the child actually went home':'เวลาที่นักเรียนกลับบ้านจริง'):(EN()?'Time the child actually arrived':'เวลาที่นักเรียนมาถึงจริง')}</span>
        <input type="time" id="apTime" value="${isToday?esc(nowTime()):''}"/></label>
      ${type==='OUT'?`<div class="card" style="background:var(--warn-bg);border-color:var(--warn-line);padding:8px;font-size:13px">⏰ ${EN()
        ? 'If it is past the end of the school day, late-pickup OT is charged from this time.'
        : 'หากเลยเวลาเลิกเรียน ระบบจะคิด OT รับช้าตามเวลานี้ตามจริง'}</div>`:''}
      <label class="field" style="margin-top:6px"><span>${EN()?'Reason (kept in the log)':'เหตุผล (บันทึกไว้ในประวัติ)'}</span>
        <input id="apWhy" placeholder="${EN()?'e.g. nobody tapped at pick-up':'เช่น ลืมลงเวลาตอนรับกลับ'}"/></label>
      <button class="btn block" onclick="A_attPunchSave('${esc(sid)}','${type}',this)">${esc(t('c.save'))}</button>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`); };
  window.A_attPunchSave=async(sid,type,btn)=>{ const m=btn.closest('.modal'); const d=window._ATTA||{};
    const time=(m.querySelector('#apTime')||{}).value||'', why=(m.querySelector('#apWhy')||{}).value||'';
    if(!time){ toast(EN()?'Enter the time':'กรุณาใส่เวลา'); return; }
    btn.disabled=true;
    try{ const body={studentId:sid,date:d.date,remark:why||undefined,staffId:USER.staffId,role:USER.role};
      body[type==='OUT'?'checkOut':'checkIn']=time;
      const r=await api('editStudentAttendance',body);
      m.remove();
      const ot=r&&r.ot;
      confirmSaved((EN()?'Saved ':'บันทึกแล้ว ')+time+(ot&&ot.amount>0?` · OT ${ot.lateMinutes} ${EN()?'min':'นาที'} ${baht(ot.amount)}`:''));
      A_attAudit(d.date); }catch(e){ err(e); btn.disabled=false; } };

  window.A_finSaveBase=async(sid)=>{ const m=document.querySelector('.modal'); const base=Number(m.querySelector('#fsBase').value)||0;
    try{ await api('saveStaff',{staffId:sid,data:{BaseSalary:base}}); toast(t('c.saved')); }catch(e){err(e);} };
  window.A_finCompute=async(sid)=>{ try{ await api('computePayroll',{staffId:sid,month:FIN_MONTH||monthStr()}); toast(EN()?'Computed':'คำนวณแล้ว'); const x=document.querySelector('.modal'); if(x)x.remove(); GO('finance'); }catch(e){err(e);} };

  // ---- Admin Daily Report (web + send to LINE OA) ----
  SCREENS.Admin.daily = async () => { const [r,_d]=await Promise.all([api('dailyReport'),api('schoolDay',{}).catch(()=>({}))]);
    const dot=st=>st==='IN'?'dot-in':st==='OUT'?'dot-out':st==='LEAVE'?'dot-leave':'dot-absent';
    // the report is about the CHILDREN, so it asks the children's half — and it asks the server
    // rather than working the calendar out here for the third time (see schoolDayFor_ in engine.js)
    const _closed=!!_d.closedForStudents;
    const T=r.totals; const present=T.in+T.out; const pct=T.total?Math.round(present/T.total*100):100;
    const summary=_closed
      ? `<div class="card" style="background:var(--surface-3);border-color:var(--line-strong);color:var(--ink-3);text-align:center"><b>🏖️ ${EN()?'School closed today':'วันนี้โรงเรียนหยุด'} (${esc(EN()?(_d.reasonEN||'holiday'):(_d.reason||'วันหยุด'))}) — ${EN()?'attendance not counted':'ไม่นับการมาเรียน'}</b></div>`
      : `<div class="kpigrid" style="grid-template-columns:repeat(4,1fr)">
          <div class="kpi blue" style="cursor:default"><span class="kic">✅</span><b class="kn" style="color:${pctColor(pct)}">${pct}%</b><span class="kl">${EN()?'Attendance':'มาเรียน'} (${present}/${T.total})</span></div>
          <div class="kpi green" style="cursor:default"><span class="kic">🟢</span><b class="kn">${present}</b><span class="kl">${EN()?'Present':'มา'}</span></div>
          <div class="kpi amber" style="cursor:default"><span class="kic">🌴</span><b class="kn">${T.leave}</b><span class="kl">${EN()?'On leave':'ลา'}</span></div>
          <div class="kpi pink" style="cursor:default"><span class="kic">⛔</span><b class="kn" style="color:${T.absent?'var(--bad)':'var(--ok)'}">${T.absent}</b><span class="kl">${EN()?'Absent':'ขาด'}</span></div></div>`;
    app.innerHTML=`<div class="dash-h"><h2 class="page">📋 ${esc(t('daily.title'))}</h2><span class="dash-date">${esc(r.date)}</span></div>
      ${summary}
      ${r.classes.map(c=>`<div class="card"><div class="spread"><b>${esc(c.className)}</b><span class="muted">${esc(t('lbl.present'))} ${c.in}·${esc(t('lbl.onleave'))} ${c.leave}·${esc(t('lbl.absent'))} ${c.absent}/${c.total}</span></div>
        <div>${c.students.map(s=>`<span class="att" style="display:inline-flex;margin-right:10px"><span class="dot-s ${dot(s.status)}"></span>${esc(dnick(s))}${s.status==='LEAVE'?' ('+esc(t('lbl.onleave'))+')':s.status==='ABSENT'?' ('+esc(t('lbl.absent'))+')':''}</span>`).join('')}</div></div>`).join('')}
      <div class="card"><h3>⏰ ${esc(t('daily.lateStaff'))}</h3>${r.lateStaff.length?r.lateStaff.map(s=>`<div class="list-item"><span><b>${esc(dnick(s))}</b>${dnSub(s)?` <small class="muted">${esc(dnSub(s))}</small>`:""}</span><span class="pill bad">${esc(t('lbl.late'))} ${s.late} ${esc(t('lbl.min'))}</span></div>`).join(''):`<small class="muted">${esc(t('c.noItems'))}</small>`}</div>
      <div class="card" style="background:var(--warn-bg);border-color:var(--warn-line)"><h3>🚨 ${esc(t('daily.absenceAlert'))}</h3>
        <p class="muted" style="font-size:13px">${esc(t('daily.alertNote'))}</p>
        ${r.absent2.map(s=>`<div class="list-item"><span><b>${esc(dnick(s))}</b> <small class="muted">${dnSub(s)?esc(dnSub(s))+" · ":""}${esc(s.class)}</small></span><span class="pill ${s.count>=5?'bad':'wait'}">${esc(t('abs.days').replace('{n}',s.count))}</span></div>`).join('')||`<small class="muted">${esc(t('c.noItems'))}</small>`}
        <button class="btn sm outline" style="margin-top:8px" onclick="GO('absence')">${esc(t('abs.title'))} →</button></div>
      ${(r.injuries&&r.injuries.length)?`<div class="card" style="background:var(--bad-bg);border-color:var(--bad-line)"><h3 style="color:var(--bad)">${esc(t('daily.injuryAlert'))} (${r.injuries.length})</h3>
        <p class="muted" style="font-size:13px">${esc(t('daily.injuryNote'))}</p>${injuryListHTML(r.injuries)}</div>`:''}
      <button class="btn block green" onclick="A_sendLine()">📤 ${esc(t('daily.sendLine'))}</button>`;
  };
  window.A_sendLine=()=>{ toast(EN()?'Daily report sent to LINE OA (demo)':'ส่งสรุปไป LINE OA แล้ว (เดโม)'); };

  // ---- Admin: confirm parent payments (slips await admin verification) ----
  // pending-payment cards (slips + cash to confirm/reject) — shared by the standalone screen AND the
  // การเงิน hub "รออนุมัติ" tab. kind = bill/ot/charge/prepay.
  function verifyListHTML(list){ const kindLbl=k=>({bill:t('verify.monthly'),ot:'OT',charge:(EN()?'Charge':'ค่าเพิ่มเติม'),prepay:t('prepay.title')}[k]||k);
    if(!list.length) return `<div class="card muted">${esc(t('verify.empty'))}</div>`;
    return list.map(x=>{
        const cash=x.cash; const methodPill=`<span class="pill ${cash?'wait':'info'}">${cash?'💵 '+esc(t('pay.cash')):'🏦 '+esc(t('pay.transfer'))}</span>`;
        const confirmed=Number(x.confirmedPaid||0), outstanding=Number(x.outstanding!=null?x.outstanding:Math.max(0,x.due-confirmed));
        const slipRows=(x.slips||[]).map(s=>`<div class="card" style="padding:8px;background:var(--surface)"><div class="row" style="gap:10px;align-items:flex-start">
            ${slipThumb2(s.url)}
            <div style="flex:1"><div><b>${baht(s.amount)}</b> ${slipVerBadge(s.verified)}</div>
              ${s.receiver?`<small class="muted">→ ${esc(s.receiver)}</small><br>`:''}${s.transRef?`<small class="muted">ref ${esc(s.transRef)}</small><br>`:''}
              <small class="muted">${esc(String(s.date||'').slice(0,16))}</small></div></div>
            <div class="row" style="margin-top:6px"><button class="btn sm green" onclick="A_confirmSlip('${esc(s.slipId)}',this)">✅ ${EN()?'Confirm this slip':'ยืนยันสลิปนี้'}</button><button class="btn sm pink" onclick="A_rejectSlip('${esc(s.slipId)}')">✗ ${esc(t('verify.reject'))}</button></div></div>`).join('');
        const sNick=EN()?(x.nickEN||x.nick):(x.nick||x.nickEN);
        return `<div class="card"><div class="spread"><div><b>👶 ${esc(sNick||x.name)}</b> <small class="muted">${sNick?esc(EN()?x.nameEN:x.name):""}${x.class?' · '+esc(x.class):''}</small> <span class="pill info">${esc(kindLbl(x.kind))}</span> ${methodPill}<br><small class="muted">${esc(x.label)}${x.transactionDate?' · '+esc(t('pay.txnDate'))+' '+esc(x.transactionDate):''}</small></div></div>
          <table style="width:100%;font-size:13px;margin:6px 0"><tr><td>${esc(t('slip.amountDue'))}</td><td style="text-align:right"><b>${baht(x.due)}</b></td></tr>
          ${confirmed>0?`<tr><td>${EN()?'Confirmed so far':'ยืนยันแล้ว'}</td><td style="text-align:right;color:var(--ok)">${baht(confirmed)}</td></tr>`:''}
          <tr><td><b>${EN()?'Outstanding':'คงค้าง'}</b></td><td style="text-align:right"><b style="color:${outstanding>0?'var(--bad)':'var(--ok)'}">${baht(outstanding)}</b></td></tr></table>
          <label class="field"><span>${esc(t('pay.paidDate'))} <small class="muted">${(x.slips&&x.slips[0]&&/^\d{4}-\d{2}-\d{2}/.test(x.slips[0].transDate||''))?(EN()?'(from slip)':'(จากสลิป)'):''}</small></span><input type="date" id="pd_${esc(x.id)}" value="${(x.slips&&x.slips[0]&&/^\d{4}-\d{2}-\d{2}/.test(x.slips[0].transDate||''))?esc(x.slips[0].transDate.slice(0,10)):todayStr()}"/></label>
          ${cash?`<div style="background:var(--warn-bg);border-radius:8px;padding:6px 8px;font-size:13px;color:var(--warn-ink);margin-bottom:6px">💵 ${esc(t('verify.cashPending'))} ${baht(x.slipAmount)}</div>
            <div class="row"><button class="btn sm green" onclick="A_confirmPay('${x.kind}','${x.id}','cash')">✅ ${esc(t('verify.confirm'))}</button><button class="btn sm pink" onclick="A_rejectPay('${x.kind}','${x.id}')">✗ ${esc(t('verify.reject'))}</button></div>`
            : (slipRows||`<small class="muted">${EN()?'no slips':'ไม่มีสลิป'}</small>`)}</div>`;
      }).join(''); }
  SCREENS.Admin.verify = async () => { const list=await api('pendingPayments');
    app.innerHTML=`<h2 class="page">✅ ${esc(t('verify.title'))}</h2>
      <p class="muted" style="font-size:13px">${esc(t('verify.note'))}</p>${verifyListHTML(list)}`;
  };
  // bigger slip preview for the admin (tap to zoom)
  function slipThumb2(url){ return url?`<img src="${esc(url)}" alt="slip" style="width:90px;height:110px;object-fit:cover;border-radius:8px;border:1px solid var(--line);cursor:zoom-in" onclick="ZOOM_IMG('${esc(url)}')" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'qr-ph',textContent:'📎'}))"/>`:`<div class="qr-ph" style="width:90px;height:110px">📎</div>`; }
  window.A_confirmSlip=async(slipId,btn)=>{ const card=btn?btn.closest('.card'):null; const d=card&&card.parentElement?card.parentElement.querySelector('input[type=date]'):null; const paidDate=(d&&d.value)||todayStr();
    try{ const r=await api('confirmSlip',{slipId,adminId:USER.staffId,paidDate}); const out=Number(r&&r.outstanding||0); confirmSaved(out>0?(EN()?`Confirmed. Still outstanding ${baht(out)}`:`ยืนยันแล้ว ยังค้าง ${baht(out)}`):t('verify.confirmed')); GO(CURRENT); }catch(e){err(e);} };
  window.A_rejectSlip=async(slipId)=>{ if(!confirm(t('verify.rejectConfirm')))return; try{ await api('rejectSlip',{slipId}); toast(t('verify.rejected')); GO(CURRENT); }catch(e){err(e);} };
  window.A_confirmPay=async(kind,id,method)=>{ const d=document.getElementById('pd_'+id); const paidDate=(d&&d.value)||todayStr();
    try{ await api('confirmPayment',{kind,id,adminId:USER.staffId,paidDate,method}); confirmSaved(t('verify.confirmed')); GO(CURRENT); }catch(e){err(e);} };
  window.A_rejectPay=async(kind,id)=>{ if(!confirm(t('verify.rejectConfirm')))return; try{ await api('rejectPayment',{kind,id}); toast(t('verify.rejected')); GO(CURRENT); }catch(e){err(e);} };

  // ---- absence tracking (Teacher / Leader / Admin) ----
  async function absenceScreen(){ setNav(CURRENT);
    const [all,rate]=await Promise.all([api('absenceReport',{minDays:2}),api('ratedChildCount')]);
    const g1=all.filter(s=>s.group==='range'), g2=all.filter(s=>s.group==='over5');
    const STATUSES=['','กำลังติดตาม','ติดตามแล้ว','ลายาว','ออกกลางคัน'];
    // if the child has since returned, annotate the come-back date behind the count
    const backNote=s=>s.returnedDate?` · <span style="color:var(--ok);font-weight:600">${EN()?'came back':'มาแล้ว'} ${esc(s.returnedDate)}</span>`:` · <span style="color:var(--bad)">${EN()?'still absent':'ยังขาดอยู่'}</span>`;
    const row=(s)=>`<div class="list-item" style="flex-wrap:wrap"><span><b>${esc(s.nick||s.name)}</b> <small class="muted">${esc(s.name)} · ${esc(s.class)} · ${esc(t('abs.days').replace('{n}',s.count))}${s.reasons?' · '+esc(s.reasons):''}</small>${backNote(s)}</span>
      <span class="row" style="width:100%;margin-top:6px"><input id="fn_${s.studentId}" placeholder="${esc(t('abs.note'))}" value="${esc(s.note)}" style="flex:1"/>
        <select id="fs_${s.studentId}">${STATUSES.map(st=>`<option ${s.status===st?'selected':''}>${esc(st||'-')}</option>`).join('')}</select>
        <button class="btn sm" onclick="A_followup('${s.studentId}')">${esc(t('c.save'))}</button></span></div>`;
    const back = USER.role==='Admin'?'manage':'home';
    app.innerHTML=`<button class="btn sm outline backbtn" onclick="GO('${back}')">${t('c.back')}</button><h2 class="page">🔎 ${esc(t('abs.title'))}</h2>
      <div class="card" style="background:var(--blue-bg)"><div class="spread"><b>${esc(t('abs.rated'))}</b><b>${rate.rated}/${rate.total}</b></div><small class="muted">${esc(t('abs.rateNote').replace('{n}',rate.excludeDays).replace('{x}',rate.excluded))}</small></div>
      <div class="card"><h3>⚠️ ${EN()?'Absent 2–5 days':'ขาด 2–5 วัน'} <small class="muted">(${g1.length})</small></h3>${g1.length?g1.map(row).join(''):`<small class="muted">${esc(t('c.noItems'))}</small>`}</div>
      <div class="card" style="border:1px solid var(--bad-line)"><h3>🚨 ${EN()?'Absent over 5 days':'ขาดเกิน 5 วัน'} <small class="muted">(${g2.length})</small></h3>${g2.length?g2.map(row).join(''):`<small class="muted">${esc(t('c.noItems'))}</small>`}</div>`;
  }
  SCREENS.Teacher.absence = absenceScreen; SCREENS.Admin.absence = absenceScreen;
  window.A_followup=async(sid)=>{ await api('setAbsenceFollowup',{studentId:sid,note:$('#fn_'+sid).value,status:$('#fs_'+sid).value==='-'?'':$('#fs_'+sid).value}); confirmSaved(t('c.saved')); };

  // Admin audit: every on-behalf student check-in/out (staff, ACTUAL time entered, reason, OT produced)
  // so a disputed pick-up time — e.g. picked up 12:57 but recorded 17:26 → false OT — can be verified.
  window.A_checkinLog=async()=>{ let rows=[]; try{ rows=await api('staffCheckinLog',{days:30})||[]; }catch(e){ err(e); return; }
    const row=r=>`<div class="list-item" style="flex-wrap:wrap"><span><b>${r.type==='IN'?'🟢 '+(EN()?'IN':'ส่ง'):'🔵 '+(EN()?'OUT':'รับ')}</b> ${esc(r.nick||r.name||r.studentId)} <small class="muted">${esc(r.name||'')}</small><br>
      <small class="muted">📅 ${esc(r.date)} · ⏰ ${esc(r.time)} · 👩‍🏫 ${esc(r.byStaff)}</small><br>
      <small>📝 ${esc(r.remark||'-')}</small>${r.otAmount?`<br><small style="color:var(--warn)">⏰ ${EN()?'OT charged':'คิด OT'} ${baht(r.otAmount)}${r.planEnd?' ('+(EN()?'plan end ':'เลิก ')+esc(r.planEnd)+')':''}</small>`:''}</span></div>`;
    modal(`<h3>📍 ${EN()?'On-behalf check-in log (30d)':'ประวัติเช็คอิน-เอาท์แทน (30 วัน)'}</h3>
      <p class="muted" style="font-size:13px">${EN()?'Recorded by staff for a non-registered pickup. Time shown is the ACTUAL time the teacher entered.':'บันทึกโดยคุณครูแทนผู้มารับ-ส่ง · เวลาที่แสดงคือเวลาจริงที่คุณครูกรอก'}</p>
      <div style="max-height:60vh;overflow:auto">${rows.length?rows.map(row).join(''):`<small class="muted">${EN()?'No records':'ยังไม่มีรายการ'}</small>`}</div>
      <button class="btn outline block" style="margin-top:8px" onclick="this.closest('.modal').remove()">${esc(t('c.close'))}</button>`); };

  // Admin chat -> LINE OA (manage all conversations in one place)
  SCREENS.Admin.chat = async () => { const line=MOCK.config.Links.line||'#';
    app.innerHTML=`<h2 class="page">💬 ${esc(t('title.chat'))}</h2>
      <div class="card" style="text-align:center"><div style="font-size:48px">💬</div>
        <p>${esc(t('chat.lineMsg'))}</p>
        <a class="btn block green" href="${esc(line)}" target="_blank">${esc(t('chat.openLine'))} →</a>
        <p class="muted" style="font-size:13px;margin-top:10px">${esc(t('chat.lineNote'))}</p></div>${verTag()}`;
  };

  /* ===== Observer: everything an Admin can SEE, nothing an Admin can change =====================
   * The four whole-school screens are the SAME functions, not copies — a copy would drift, and the
   * point of the role is that an Observer and an Admin are looking at the same thing.
   *
   * What actually enforces read-only is the server (dispatch_ refuses every mutating action for this
   * role). The guard below is there so nothing is half-done on screen and the person gets a plain
   * explanation instead of a failure, and the banner is there so they know why.
   */
  ['home','leaves','finance','dspm'].forEach(k => { SCREENS.Observer[k] = (...a) => SCREENS.Admin[k](...a); });
  const isObserver = () => !!(USER && USER.role === 'Observer');
  {
    const _api = window.api;
    // Rosters come back in sheet order, and a dozen screens read them WITHOUT going through A_CACHE.
    // Ordering them here means one rule for every caller — including the next one somebody writes.
    // Classes and departments are deliberately absent: their order is the school's (Baby, 1, 2, 3,
    // Premium), which alphabetical would scramble.
    const ROSTER = { listStaff:1, listStudents:1, listParents:1, listExportedStudents:1 };
    window.api = function (action, payload, opts) {
      if (ROSTER[action]) return _api(action, payload, opts).then(r => Array.isArray(r) ? sortPeople(r) : r);
      // a class roster is a list of children too, just wrapped in the class it belongs to
      if (action === 'classList') return _api(action, payload, opts)
        .then(r => (r && Array.isArray(r.students)) ? Object.assign({}, r, { students: sortPeople(r.students) }) : r);
      if (isObserver() && window.__atomIsMutating && window.__atomIsMutating(action)) {
        toast('👁️ ' + (EN() ? 'View-only account — you can open anything, but not change it'
                             : 'บัญชีนี้ดูอย่างเดียว — เปิดดูได้ทุกอย่าง แต่แก้ไขไม่ได้'));
        const e = new Error(EN() ? 'View-only account' : 'บัญชีนี้เป็นสิทธิ์ดูอย่างเดียว (Observer)');
        e.code = 'READ_ONLY';
        return Promise.reject(e);
      }
      return _api(action, payload, opts);
    };
  }

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
  function buildReceiptHTML(b,s){ const logo=window._LOGO||(location.origin+'/assets/logo.png');
    const due=b.TotalDue!=null?b.TotalDue:b.Amount;
    const rows=(b.Items||[]).map(it=>`<tr><td>${esc(trItem(it[0]))}</td><td style="text-align:right">${baht(it[1])}</td></tr>`).join('')+(b.OTRollover?`<tr><td>OT</td><td style="text-align:right">${baht(b.OTRollover)}</td></tr>`:'');
    // student headline: full name-surname (nickname)
    const snick=(s.Nickname||s.NicknameEN||''); const sname=(s.NameTH||s.NameEN||'')+(snick?` (${snick})`:'');
    return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(b.BillingID)}</title><link href="https://fonts.googleapis.com/css2?family=Sarabun&display=swap" rel="stylesheet">
      <style>@page{size:A5}body{font-family:Sarabun,sans-serif;margin:0;padding:18px;color:#222}.hd{display:flex;justify-content:center;align-items:center;gap:12px;border-bottom:2px solid #1565C0;padding-bottom:8px}
      .hd img{height:46px} h1{font-size:20px;color:#1565C0;margin:0} .meta{font-size:13px;margin:10px 0;line-height:1.7} table{width:100%;border-collapse:collapse;font-size:14px;margin-top:8px}td{padding:5px 6px;border-bottom:1px solid #eee}
      .tot{font-size:18px;font-weight:bold;color:#1565C0} .paid{margin-top:10px;color:#2e7d32;font-weight:bold} .bar{padding:8px;text-align:center}@media print{.bar{display:none}}</style></head>
      <body><div class="bar"><button onclick="window.print()">🖨️ ${esc(t('c.print'))}</button></div>
      <div class="hd"><img src="${logo}"/><div style="text-align:center"><h1>Atom Nursery</h1><div style="font-size:13px">${esc(t('pay.receipt'))} / Receipt</div></div></div>
      <div class="meta"><b>${esc(t('reg.student'))}:</b> ${esc(sname)}<br>
      <b>${EN()?'Period':'งวดประจำเดือน'}:</b> ${esc(monthNameYear(b.Month))} · <b>No.</b> ${esc(b.BillingID)}<br>
      <b>${esc(t('c.paid'))}:</b> ${esc(fullDate(b.PaidDate||todayStr()))}${b.DueDate?` · <b>${esc(t('c.due'))}:</b> ${esc(fullDate(b.DueDate))}`:''}</div>
      <table>${rows}<tr><td class="tot">${esc(t('c.total'))}</td><td class="tot" style="text-align:right">${baht(due)}</td></tr></table>
      <div class="paid">✅ ${esc(t('s.paid'))}${b.VerifiedStatus==='PREPAID'?' ('+esc(t('prepay.paidAhead'))+')':''}</div></body></html>`; }

  // Printable payslip, laid out like the school's own document: CONFIDENTIAL mark, letterhead, the
  // income / deduction / transfer three-column grid, and the footnotes explaining how เบี้ยขยัน and
  // รายได้อื่นๆ are worked out. Three to an A4 landscape sheet with cut lines, as before.
  const _beYear = m => { const y=parseInt(String(m).slice(0,4),10); return isNaN(y)?'':(y+543); };
  const _periodTH = m => { const y=parseInt(String(m).slice(0,4),10), mo=parseInt(String(m).slice(5,7),10);
    if(isNaN(y)||isNaN(mo)) return esc(m);
    const last=new Date(y,mo,0).getDate(); return `01/${mo}/${y+543} ถึง ${last}/${mo}/${y+543}`; };
  function buildSlipsHTML(rows,month){ const logo=window._LOGO||(location.origin+'/assets/logo.png');
    const card=p=>{ const adj=adjRows(p); const bank=[p.BankName||'',p.BankAccount||''].filter(Boolean).join(' ');
      const plus=adj.filter(a=>Number(a.amount)>0), minus=adj.filter(a=>Number(a.amount)<0);
      const note=a=>a.label?` <span class="sub">(${esc(a.label)})</span>`:'';
      return `<div class="slip">
      <div class="hd"><span class="conf">CONFIDENTIAL</span><span class="cf">confidential เอกสารปกปิด เป็นความลับ ห้ามเปิดเผย</span><img src="${logo}" style="height:30px"/></div>
      <div class="ttl">อะตอม เนอสเซอรี่</div>
      <div class="meta"><span>พิมพ์วันที่ <b>${todayStr()}</b></span><span>ชื่อพนักงาน <b>${esc(p.StaffName||staffName(p.StaffID))}</b></span>
        <span>รหัสพนักงาน <b>${esc(p.StaffID)}</b></span><span>ตำแหน่ง <b>${esc(p.Position||'-')}</b></span><span>งวดวันที่ <b>${_periodTH(p.Month)}</b></span></div>
      <table class="grid"><thead>
        <tr><th colspan="3">รายได้</th><th colspan="3">รายการหัก</th><th rowspan="2">จำนวนเงินโอนเข้าบัญชี<br><span class="sub">${esc(bank||'-')}</span></th></tr>
        <tr><th>เงินเดือน</th><th>เบี้ยขยัน<sup>1</sup></th><th>อื่น ๆ<sup>2</sup></th><th>ประกันสังคม</th><th>เงินสมทบ</th><th>อื่น ๆ</th></tr></thead><tbody>
        <tr><td class="n in">${baht(p.BaseSalary)}</td><td class="n in">${baht(p.DiligenceTotal)}</td><td class="n in">${baht(p.OtherIncome)}</td>
            <td class="n de">${Number(p.SocialSecurity||0)?baht(p.SocialSecurity):'-'}</td><td class="n de">${baht(p.Contribution||0)}</td>
            <td class="n de">${baht(p.OtherDeductions)}</td>
            <td class="n net" rowspan="3">${baht(p.NetPay)}</td></tr>
        <tr><td class="lbl">ค่าล่วงเวลาตอนเย็น${Number(p.OTCarry||0)?' + ค้างจ่าย*':''}</td><td class="n in">${baht(Number(p.OTEvening||0)+Number(p.OTCarry||0))}</td>
            <td class="lbl">${Number(p.OTHoliday||0)?'OT วันหยุด':'เงินพิเศษวันพักผ่อน'}</td><td class="n in">${baht(Number(p.OTHoliday||0)?p.OTHoliday:p.HolidayBonus)}</td>
            <td class="lbl">รวมหัก</td><td class="n">${baht(p.TotalDeductions)}</td></tr>
        <tr><td colspan="4" class="sub lft">${minus.map(a=>esc(a.label||'')).filter(Boolean).join(' · ')||'&nbsp;'}</td>
            <td class="lbl">รวมรายได้</td><td class="n">${baht(p.GrossIncome)}</td></tr>
      </tbody></table>
      <div class="acc">${Number(p.OTCarry||0)?`<span style="color:#1565C0">*รวมค้างจ่าย OT ${esc(carryMonths(p))} ${baht(p.OTCarry)}</span> &nbsp;·&nbsp; `:''}เงินสมทบเดือนนี้ หักพนักงาน ${baht(p.Contribution||0)} + โรงเรียนสมทบ ${baht(p.ContributionEmployer!=null?p.ContributionEmployer:p.Contribution||0)} · <b>${baht(p.ContributionAccum||p.Contribution||0)}</b> เงินสมทบสะสม</div>
      <div class="fn"><b>เบี้ยขยัน<sup>1</sup></b> คำนวณจากการมาทำงานทุกวันของแต่ละเดือน โดยไม่ลา ไม่มาสาย (${baht(p.DiligenceAttendance)})+Post รูป Facebook (${baht(p.DiligenceFacebook)})<br>
        <b>รายได้อื่น ๆ<sup>2</sup></b> คำนวณจากจำนวนเด็กตั้งแต่คนที่ ${esc(p.ChildThreshold||31)} (ที่มาอยู่เต็มเดือน ${baht(p.ChildMultiplier||300)}/คน)* &nbsp; **ใบประกาศอบรม 100/ใบ สูงสุด 2 ใบ/เดือน</div></div>`; };
    let pages=''; for(let i=0;i<rows.length;i+=3) pages+=`<div class="sheet">${rows.slice(i,i+3).map(card).join('<div class="cut"></div>')}</div>`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>Slips ${month}</title><link href="https://fonts.googleapis.com/css2?family=Sarabun&display=swap" rel="stylesheet"><style>
      @page{size:A4 landscape;margin:6mm}*{box-sizing:border-box}body{font-family:Sarabun,sans-serif;margin:0;color:#222}.bar{padding:8px;text-align:center;background:#eee}
      .sheet{width:285mm;height:198mm;display:flex;flex-direction:column;justify-content:space-between;page-break-after:always;padding:2mm}
      .slip{border:1px solid #1565C0;border-radius:4px;padding:3mm 4mm;height:62mm}.cut{border-top:1px dashed #999;margin:1mm 0}
      .hd{display:flex;justify-content:space-between;align-items:center;gap:8px}
      .conf{color:#c00;border:2px solid #c00;padding:0 5px;font-size:14px;font-weight:bold;letter-spacing:.5px}
      .cf{font-size:11px;color:#555;flex:1;text-align:center}
      .ttl{text-align:center;font-size:17px;font-weight:bold;margin:1mm 0 2mm}
      .meta{display:flex;justify-content:space-between;font-size:10.5px;margin-bottom:1.5mm;gap:4px;flex-wrap:wrap}
      .grid{width:100%;border-collapse:collapse;font-size:10.5px;table-layout:fixed}
      .grid th,.grid td{border:1px solid #333;padding:1px 3px;text-align:center;overflow-wrap:anywhere;line-height:1.25}
      .grid th{background:#fff;font-weight:bold}.grid td.n{text-align:right;font-weight:bold}
      .grid td.lft{text-align:left}
      .grid td.in{color:#1565C0}.grid td.de{color:#c00}
      .grid td.net{color:#1565C0;font-size:15px;text-align:center;vertical-align:middle;font-weight:bold}
      .grid td.lbl{text-align:right;font-weight:normal}.sub{font-size:10.5px;color:#555;font-weight:normal}
      .acc{text-align:right;font-size:11px;margin:1mm 0}
      .fn{font-size:9px;color:#1565C0;line-height:1.35}.fn b{color:#222}
      @media print{.bar{display:none}}</style></head>
      <body><div class="bar"><button onclick="window.print()">🖨️ พิมพ์ (3 สลิป/แผ่น A4 แนวนอน)</button></div>${pages}</body></html>`; }

  // ---- Back-button support for full-screen SUB-VIEWS -------------------------------------------
  // These replace #app directly instead of going through GO(), so Back used to walk past them and
  // leave the app from the middle of a long form. Wrapping them here (rather than editing each one)
  // pushes {screen:CURRENT, sub:name}; Back then pops to the plain {screen} entry and GO() re-renders
  // whichever screen the form was opened from.
  // Deliberately NOT listed: P_journal / P_growth / P_dspm — SCREENS.Parent.journal|growth|dspm call
  // those directly, so pushing there would make Back re-enter the sub-view at once (Back looks dead).
  // Admin's A_studentForm / A_parentForm aren't here either: they are modal(), already covered.
  ['P_profile','P_insurance','REG_FORM','REG_CHILD_FORM','T_journal','T_assess','T_profile']
    .forEach(name => { const orig = window[name]; if (typeof orig !== 'function') return;
      window[name] = function () {
        const st = history.state;
        // re-entering the SAME sub-view (e.g. P_saveParent re-renders P_profile after a photo
        // upload) must not stack another entry, or Back would need two presses.
        if (!(st && st.atom && st.sub === name)) {
          try { history.pushState({ atom:1, screen: CURRENT || 'home', sub: name }, '', '#' + (CURRENT || 'home')); } catch (e) {}
        }
        CUR_SUB = name; FORM_DIRTY = false;   // freshly opened form — nothing to lose yet
        return orig.apply(this, arguments);
      }; });

  // What counts as "the user has entered something". Typing covers the text/number/date/select
  // fields; the journal's mood/meal pickers and the DSPM pass/fail buttons are plain <button>s, so
  // their clicks are watched separately. #app is never replaced (only its innerHTML), so binding
  // once here is enough for every screen.
  // the header's brand / avatar / name are clickable <div role="button">s — make Enter and Space
  // activate them the way a real <button> would, so they are usable without a pointer.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest && e.target.closest('[role="button"]');
    if (!el || el.tagName === 'BUTTON') return;
    e.preventDefault(); el.click();
  });

  const markDirty = () => { if (CUR_SUB) FORM_DIRTY = true; };
  app.addEventListener('input', markDirty);
  app.addEventListener('change', markDirty);
  app.addEventListener('click', e => {
    if (e.target.closest('.choice button, [data-g], [data-meal], .chk')) markDirty();
  });

  // preload logos as dataURLs so printed/downloaded slips & receipts always show them
  // Printed receipts and payslips embed the logos as data URLs. This used to run on EVERY app start
  // for every role — 78KB of logo-corner.jpg downloaded on each launch for a document most users
  // never print. Fetched on demand instead, and awaited by the two builders that need it.
  const LOGO_SRC={_LOGO:'assets/logo.png',_LOGOCORNER:'assets/logo-corner.jpg'};
  async function ensureLogos(keys){
    await Promise.all((keys||Object.keys(LOGO_SRC)).map(async k=>{
      if(window[k]) return;
      try{ const r=await fetch(LOGO_SRC[k]); const b=await r.blob();
        window[k]=await new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.readAsDataURL(b);}); }catch(e){}
    }));
  }
  boot();
})();
