/**
 * tools/test_food_photo.js — a picture of what was actually on the plate.
 *   node tools/test_food_photo.js
 *
 * Asked 2026-08-29. The daily journal reads "ผัดวุ้นเส้น · เกือบหมด": how much was eaten, and nothing
 * about what it was. The child is two and cannot fill that in, and for a family whose Thai is not
 * first-language the name is not much of an answer either. So: a round thumbnail beside the dish,
 * tap to open the full photo.
 *
 * FOUR THINGS THAT WOULD HAVE MADE IT SILENTLY USELESS, all pinned here:
 *
 *   1. THE COLUMN NAME. Db.gs offloads a data:image URL to Drive only for columns listed in
 *      IMAGE_COLS_, and `Photo` is one of them. Under any other name the base64 would go into the
 *      cell — a real photo is far past the 50,000-character limit, setValues throws, and the save
 *      "does nothing". This is the bug that already happened once with student photos.
 *   2. THE LOOKUP KEY. A journal stores what a child ate as free TEXT, not as an item id, because a
 *      teacher may type a dish that is not in the master list yet. So the photo has to be found by
 *      NAME — by either name, or an English-language parent gets no picture.
 *   3. THE EXTRA ROUND TRIP. The parent home is one request on purpose; Apps Script runs one
 *      execution at a time per user, so a second call is ~5 seconds in front of every morning.
 *   4. CLEARING IT BY ACCIDENT. The edit dialog does not have to carry the photo, and an untouched
 *      file input reads as "". Sending that would wipe the picture every time somebody corrected a
 *      spelling.
 */
const fs = require('fs'), path = require('path');
const { createAtomAPI } = require(path.join(__dirname, '..', 'webapp', 'engine.js'));

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + '  got=' + JSON.stringify(got) + (ok ? '' : ' want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function ok_(label, cond) { console.log((cond ? '  ok   ' : '  FAIL ') + label); cond ? pass++ : fail++; }
function throws_(label, fn, code) {
  try { fn(); console.log('  FAIL ' + label + '  (did not throw)'); fail++; }
  catch (e) { const c = e && (e.code || e.apiCode); const ok = !code || c === code;
    console.log((ok ? '  ok   ' : '  FAIL ') + label + '  code=' + c); ok ? pass++ : fail++; }
}
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = R('webapp/app.js'), apiJs = R('webapp/api.js'),
      dbGs = R('src/Db.gs'), gasEng = R('src/GasEngine.gs'), engGs = R('src/Engine.gs');
const appCode = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PIC = 'https://drive.google.com/thumbnail?id=abc123&sz=w1000';
function fresh() {
  const M = {
    config: { Departments: 'Nursery 1' },
    staff: [
      { StaffID: 'STF-A', NameTH: 'แอดมิน', Role: 'Admin', PositionLevel: 'Admin' },
      { StaffID: 'STF-K', NameTH: 'ครูครัว', Role: 'Teacher', PositionLevel: 'Staff', Department: 'Nursery 1', CanFoodMenu: 'YES' },
      { StaffID: 'STF-T', NameTH: 'ครูทั่วไป', Role: 'Teacher', PositionLevel: 'Staff', Department: 'Nursery 1' }
    ],
    foodItems: [
      { ItemID: 'FI-0001', NameTH: 'ข้าวต้มไก่', NameEN: 'Chicken rice porridge', Category: 'savoury', Active: 'YES', Photo: PIC },
      { ItemID: 'FI-0002', NameTH: 'ผัดวุ้นเส้น', NameEN: 'Stir-fried glass noodles', Category: 'savoury', Active: 'YES' },
      { ItemID: 'FI-0003', NameTH: 'แอปเปิ้ล', NameEN: '', Category: 'fruit', Active: 'NO', Photo: PIC + '&x=2' }
    ],
    students: [], parents: [], classes: [], journals: [], activityLog: [], feed: [], holidays: []
  };
  return { M, H: createAtomAPI(M).H };
}

// ============================================================================
console.log('\n1) the lookup the journal can actually use');
{
  const { H } = fresh();
  const pics = H.foodPhotos();
  /* BY NAME, because that is what a journal stores — free text, deliberately, so a teacher can type
   * a dish the master list has never heard of. An id-keyed map would have matched nothing. */
  eq('the Thai name finds the picture', pics['ข้าวต้มไก่'], PIC);
  eq('...and so does the English one', pics['Chicken rice porridge'], PIC);
  ok_('a dish with no photo is simply absent', !('ผัดวุ้นเส้น' in pics));
  ok_('...and so is its English name', !('Stir-fried glass noodles' in pics));
  /* A RETIRED DISH KEEPS ITS PICTURE. Journals already written still name it, and a parent reading
   * back through last month should not lose the photo because the kitchen stopped cooking it. */
  eq('a retired dish still resolves, for the journals that already name it', pics['แอปเปิ้ล'], PIC + '&x=2');
  ok_('an item with a blank English name adds no blank key', !('' in pics));
  eq('nothing else is in there', Object.keys(pics).sort(),
    ['Chicken rice porridge', 'ข้าวต้มไก่', 'แอปเปิ้ล'].sort());
}
{
  // a school that has uploaded none pays for an empty object, not a list of every dish
  const { M, H } = fresh();
  M.foodItems.forEach(i => { i.Photo = ''; });
  eq('no photos anywhere → an empty map', H.foodPhotos(), {});
}

console.log('\n2) who may attach one');
{
  const { M, H } = fresh();
  /* THE PERSON WHO KNOWS WHAT THE DISH LOOKS LIKE IS THE ONE IN THE KITCHEN, and the admin already
   * delegates the monthly menu to them (CanFoodMenu). Making them ask an admin for every picture is
   * how a feature ends up with no pictures in it. */
  const r = H.saveFoodItem({ staffId: 'STF-K', item: { itemId: 'FI-0002', nameTH: 'ผัดวุ้นเส้น', photo: PIC } });
  ok_('the kitchen teacher may attach a photo', r.itemId === 'FI-0002');
  eq('...and it is stored', M.foodItems[1].Photo, PIC);
  /* ...WITHOUT BEING ABLE TO RENAME THE DISH. The master list is still the admin's. Refusing the
   * whole call would have meant a kitchen teacher could not photograph a dish that already exists,
   * which is every dish — so the photo is applied and the rest of the edit is ignored. */
  eq('...but the name they sent is ignored', [M.foodItems[1].NameTH, M.foodItems[1].NameEN],
    ['ผัดวุ้นเส้น', 'Stir-fried glass noodles']);
  ok_('...and the reply says so', r.photoOnly === true);
}
{
  const { M, H } = fresh();
  throws_('a teacher WITHOUT the menu right may not attach one',
    () => H.saveFoodItem({ staffId: 'STF-T', item: { itemId: 'FI-0002', nameTH: 'ผัดวุ้นเส้น', photo: PIC } }), 'NO_PERMISSION');
  eq('...and nothing was written', M.foodItems[1].Photo, undefined);
  throws_('...nor rename a dish, exactly as before',
    () => H.saveFoodItem({ staffId: 'STF-T', item: { itemId: 'FI-0002', nameTH: 'ชื่อใหม่' } }), 'NO_PERMISSION');
  // ...and ADDING a dish is still open to any teacher, which is the whole point of the master list
  ok_('a plain teacher may still add a new dish', !!H.saveFoodItem({ staffId: 'STF-T', item: { nameTH: 'ไข่เจียว', category: 'savoury' } }).itemId);
}
{
  const { M, H } = fresh();
  H.saveFoodItem({ staffId: 'STF-A', item: { itemId: 'FI-0002', nameTH: 'ผัดวุ้นเส้นหมูสับ', nameEN: 'Glass noodles with pork', category: 'savoury', photo: PIC } });
  eq('an admin may do both at once', [M.foodItems[1].NameTH, M.foodItems[1].Photo], ['ผัดวุ้นเส้นหมูสับ', PIC]);
}

console.log('\n3) a photo is not cleared by an edit that never mentioned it');
{
  /* The edit dialog does not have to carry the picture, and an untouched file input reads as "".
   * Sending it unconditionally would have wiped the photo every time somebody fixed a spelling. */
  const { M, H } = fresh();
  H.saveFoodItem({ staffId: 'STF-A', item: { itemId: 'FI-0001', nameTH: 'ข้าวต้มไก่ใส่ไข่', nameEN: 'Chicken rice porridge', category: 'savoury' } });
  eq('renaming a dish leaves its photo alone', M.foodItems[0].Photo, PIC);
  eq('...and the rename happened', M.foodItems[0].NameTH, 'ข้าวต้มไก่ใส่ไข่');
  // ...while an explicit empty string DOES clear it, which is the "remove the photo" button
  H.saveFoodItem({ staffId: 'STF-A', item: { itemId: 'FI-0001', nameTH: 'ข้าวต้มไก่ใส่ไข่', category: 'savoury', photo: '' } });
  eq('an explicit blank removes it', M.foodItems[0].Photo, '');
  ok_('the screen sends the field only when a picture was picked',
    /const pic=photoVal\(m,'fiPhoto'\); if\(pic\) item\.photo=pic;/.test(app));
  ok_('...and the remove button sends an explicit blank', /const url=clear\?'':photoVal\(m,'fiPic'\);/.test(app));
}
{
  // adding a dish that already exists is not a new item — but the picture IS new information
  const { M, H } = fresh();
  const r = H.saveFoodItem({ staffId: 'STF-A', item: { nameTH: 'ผัดวุ้นเส้น', photo: PIC } });
  eq('a duplicate returns the dish that exists', [r.itemId, r.existed], ['FI-0002', true]);
  eq('...and takes its photo', M.foodItems[1].Photo, PIC);
  eq('...without adding a row', M.foodItems.length, 3);
}

console.log('\n4) the column has to be called Photo, or the save vanishes');
{
  ok_('it is declared on FOOD_ITEMS', /FOOD_ITEMS: *\[[^\]]*'Photo'\]/.test(gasEng));
  ok_('...at the END, since ensureColumns_ appends and never reorders', /'CreatedAt', 'Photo'\]/.test(gasEng));
  /* THE NAME IS THE MECHANISM. Db.gs offloads a data:image URL to Drive only for the columns in
   * IMAGE_COLS_; anything else goes into the cell as base64, blows the 50,000-character limit and
   * makes setValues throw — the "attach a photo, press save, nothing happens" bug, already had once. */
  ok_('Photo is one of the columns Db.gs sends to Drive', /var IMAGE_COLS_ = \{ Photo: 1/.test(dbGs));
  ok_('...and the collection writer offloads it too, not only appendObject_',
    /IMAGE_COLS_\[col\]\) v = driveifyImage_/.test(gasEng));
  ok_('the built engine carries the reader', /foodPhotos: \(\) =>/.test(engGs));
}

console.log('\n5) it costs no extra round trip');
{
  /* Apps Script runs ONE execution at a time per user, so a second call is not 200ms, it is another
   * queued execution — roughly five seconds in front of every morning. api.js batches every api()
   * made in the SAME TICK into one request; a call after an `await` is a new tick and a new trip. */
  const sites = [...app.matchAll(/FOOD_PICS\(\)/g)];
  ok_('the lookup is used on more than one screen', sites.length >= 4);
  ok_('...and every use is inside a Promise.all, never after an await',
    !/await [^\n]*\n[\s\S]{0,200}?await FOOD_PICS\(\)/.test(appCode) && !/;\s*await FOOD_PICS\(\)/.test(appCode));
  ok_('the parent home takes it in its single batch',
    /Promise\.all\(\[ window\._BOOT_HOME \|\| api\('parentHome', parentScope\(\)\), FOOD_PICS\(\) \]\)/.test(app));
  ok_('the journal screen too', /api\('studentCheckinHistory',\{studentId:sid\}\)\.catch\(\(\)=>\[\]\),\s*\n\s*FOOD_PICS\(\)\]\)/.test(app));
  ok_('it is fetched once and kept', /if\(window\._FOOD_PIC\) return window\._FOOD_PIC;/.test(app));
  ok_('...and a failure means no thumbnails, not a broken screen', /catch\(e\)\{ window\._FOOD_PIC = \{\}; \}/.test(app));
  ok_('the cached copy is dropped when a photo is saved', (app.match(/window\._FOOD_PIC=null;/g) || []).length >= 2);
  ok_('...and the server-side cache tier says it barely changes', /foodPhotos: TTL_STATIC,/.test(apiJs));
}

console.log('\n6) what a parent sees');
{
  ok_('the thumbnail is drawn after the dish name in the journal',
    /\$\{esc\(mi\[m\]\)\}<\/b>\$\{foodPic\(mi\[m\]\)\}/.test(app));
  ok_('it is round, like the profile icon', /border-radius:50%/.test((/const foodPic = [\s\S]*?\};/.exec(app) || [''])[0]));
  ok_('...and tapping it opens the full picture', /IMG_zoom\('\$\{esc\(u\)\}'\)/.test(app));
  /* A journal history can hold a month of meals; loading every photo at once on a phone on mobile
   * data is not what a parent came for. */
  ok_('the images load lazily', /loading="lazy"/.test((/const foodPic = [\s\S]*?\};/.exec(app) || [''])[0]));
  /* THE TAP MUST NOT REACH THE ROW BEHIND IT. Journal rows and list items carry their own onclick
   * (open the day, open the child); without this, tapping the picture would navigate instead. */
  ok_('the tap does not fall through to the row', /onclick="event\.stopPropagation\(\);IMG_zoom/.test(app));
  // a dish with no photo yet reads exactly as it always did
  /* The body ends `…"/>`; };` on ONE line, so a `\n  };` terminator ran past it and swallowed the
   * closing brace — new Function then died on a stray ';' rather than telling anyone anything. */
  const src = /const foodPic = \(name, size\)=>\{([\s\S]*?)`; \};/.exec(app);
  ok_('the helper exists', !!src);
  const foodPic = new Function('name', 'size', 'window', 'esc', src[1] + '`;');
  const W = { _FOOD_PIC: { 'ข้าวต้มไก่': PIC } }, E = s => String(s);
  eq('no photo → nothing at all, not a broken image', foodPic('ผัดวุ้นเส้น', 28, W, E), '');
  ok_('a photo → an img at the profile-icon size', /width:28px;height:28px/.test(foodPic('ข้าวต้มไก่', 28, W, E)));
  eq('an unknown dish is silent too', foodPic('อะไรก็ไม่รู้', 28, W, E), '');
  eq('...and so is a blank one', foodPic('', 28, W, E), '');
}

console.log('\n7) the school can see which dishes still need one');
{
  ok_('the master list shows the picture, or a placeholder where it is missing',
    /const thumb=i=>i\.photo/.test(app) && /🍽<\/span>`;/.test(app));
  ok_('...and counts what is left', /const noPic = items\.filter\(i=>i\.active && !i\.photo\)\.length;/.test(app));
  ok_('the kitchen teacher has a door of their own to it',
    /onclick="A_foodItems\(\)">📷 \$\{EN\(\)\?'Food photos':'รูปอาหาร'\}/.test(app));
  /* The screen is shared with the admin, so it has to know which buttons to draw — and must not be
   * the thing that DECIDES: the server checks canFoodMenu_ either way. */
  ok_('...where names and categories stay the admin’s', /const admin = USER\.role==='Admin';/.test(app)
    && /\$\{admin\?`<div class="row"[\s\S]{0,200}A_fiEdit\(''\)/.test(app));
  ok_('the flag it reads is set from the teacher’s own record', /window\._CAN_FOOD = canFood;/.test(app));
}

console.log('\n' + (fail ? 'FAILED ' : 'PASSED ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
