/* ---------------------------------------------------------------------------
   dashboard.js — מנוע הדשבורד.

   כל הסינון והחישוב מתבצעים כאן, בדפדפן. השרת שולח את שורות הקמפיין
   פעם אחת, וכל שינוי מסנן מחשב מחדש את המספרים, הטבלאות והגרפים
   מיידית — בלי סבב לשרת.

   הגרפים מצוירים ב-SVG שנבנה ידנית. אין ספריות חיצוניות: המערכת
   חייבת לעבוד גם במחשב מנותק רשת.
   --------------------------------------------------------------------------- */

'use strict';

/* גרסת ה-GitHub היא אתר סטטי בלי שרת, ולכן אותם נתונים נקראים שם
   מקבצי JSON. window.CC_STATIC נקבע בעמוד ההדגמה בלבד. */
/* קורא תשובה מהשרת בלי להישבר עליה.

   כשמסך נכשל בשרת הוא היה מחזיר עמוד HTML של שגיאה גם לנתיבי
   ה-API. הדפדפן ניסה לפענח אותו כ-JSON, זרק חריגה שאיש לא תפס,
   וכל הציור נעצר — המסך נשאר ריק בלי מילה. עכשיו השרת מחזיר
   ‎{error}‎ בנתיבים האלה, וכאן נתפס גם מה שאינו JSON בכלל. */
async function ccJson(path) {
  let response;
  try {
    response = await ccFetch(path);
  } catch (error) {
    return { error: 'אין תשובה מהשרת. ייתכן שהמערכת נסגרה — ' +
                    'יש להפעיל אותה מחדש.' };
  }
  // בענן ובבדיקה האוטומטית התשובה אינה Response אמיתי אלא אובייקט
  // עם json() בלבד. לכן קוראים דרך text() רק כשהוא קיים — שם
  // נמצאת התועלת (עמוד HTML של שגיאה במקום JSON), ובשאר המקרים
  // json() הוא כל מה שיש.
  try {
    if (typeof response.text === 'function') {
      const body = await response.text();
      try {
        return JSON.parse(body);
      } catch (parseError) {
        return { error: 'תשובה לא צפויה מהשרת (' + response.status + ').' };
      }
    }
    return await response.json();
  } catch (error) {
    return { error: 'לא ניתן לקרוא את תשובת השרת.' };
  }
}

/* מציג הודעת שגיאה במקום התוכן, במקום להשאיר מסך ריק. */
function ccShowError(hostId, message) {
  const host = document.getElementById(hostId);
  if (host) host.innerHTML = '<div class="err">' + message + '</div>';
}

function ccFetch(path) {
  if (window.CC_STATIC) {
    const map = {
      '/api/geo': 'geo',
      '/api/annual': 'annual',
      '/api/status': 'index',
    };
    let key = map[path];
    if (path.indexOf('/api/campaign') === 0) {
      const id = decodeURIComponent(path.split('id=')[1] || '');
      const entry = (window.CC_STATIC.campaigns || [])
        .find(c => c.id === id) || window.CC_STATIC.campaigns[0];
      key = entry.file.replace(/\.json$/, '');
    }
    /* הנתונים מוטמעים בקובץ סקריפט ולא נמשכים ב-fetch, כדי שהאתר
       יעבוד גם כשפותחים את התיקייה מהמחשב (file://) ולא רק משרת. */
    if (window.CC_INLINE && Object.prototype.hasOwnProperty.call(window.CC_INLINE, key)) {
      const body = window.CC_INLINE[key];
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    }
    /* בענן אין קובץ למשוך: מה שלא נטען מראש פשוט אינו קיים.
       ההגנה היא בדיוק בזה — אין URL שאפשר לפנות אליו ישירות. */
    if (window.CC_CLOUD) {
      return Promise.resolve({
        ok: false, status: 404,
        json: () => Promise.resolve({ error: 'הנתונים לא נטענו' }),
      });
    }
    return fetch(key ? 'data/' + key + '.json' : path);
  }
  return fetch(path);
}

const CC = {
  data: null,          // המטען מהשרת
  selected: {},        // key -> Set של אינדקסי ערכים שנבחרו
  dateFrom: null,      // מספר ימים מתחילת הטווח
  dateTo: null,
  rows: [],            // אינדקסי השורות שעוברות את הסינון
};

/* ===== עזרי פורמט ===== */

const NUM = new Intl.NumberFormat('he-IL');

function n(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return NUM.format(Math.round(value));
}
function pct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return (value * 100).toFixed(1) + '%';
}
function money(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return NUM.format(Math.round(value)) + ' ₪';
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function dayToDate(day) {
  if (!CC.data || !CC.data.dateStart) return '';
  const base = new Date(CC.data.dateStart + 'T00:00:00');
  base.setDate(base.getDate() + day);
  return base.toISOString().slice(0, 10);
}
function dateToDay(iso) {
  if (!CC.data || !CC.data.dateStart || !iso) return null;
  const base = new Date(CC.data.dateStart + 'T00:00:00');
  const target = new Date(iso + 'T00:00:00');
  return Math.round((target - base) / 86400000);
}

/* ===== צבעים לסדרות ===== */

const SERIES = ['#4F8EF7', '#22c39a', '#FFC857', '#f97362', '#a78bfa',
                '#38bdf8', '#fb923c', '#34d399', '#f472b6', '#94a3b8'];

/* מעבר לאורך הסדרה הצבע אינו חוזר על עצמו אלא נגזר ממנה בגוון
   כהה או בהיר יותר. פרוסה אחת-עשרה בעוגה קיבלה קודם בדיוק את
   הצבע של הראשונה, ושתי קטגוריות שונות נראו זהות. */
function seriesColor(index) {
  const base = SERIES[index % SERIES.length];
  const cycle = Math.floor(index / SERIES.length);
  return cycle ? shiftColor(base, cycle) : base;
}

/* ===== טעינה ===== */

async function loadCampaign(campaignId) {
  const payload = await ccJson('/api/campaign?id=' + encodeURIComponent(campaignId));
  CC.data = payload;

  if (payload.error || payload.empty) {
    document.querySelectorAll('[data-cc]').forEach(node => {
      node.innerHTML = '<div class="warn">' +
        (payload.message || payload.error || 'אין נתונים להצגה.') + '</div>';
    });
    return;
  }

  // ברירת מחדל: הכל נבחר, טווח התאריכים המלא
  payload.facets.forEach(facet => { CC.selected[facet.key] = new Set(); });
  CC.dateFrom = null;
  CC.dateTo = null;
  // בחירת תתי-הקמפיין שייכת לקמפיין שממנו היא נבחרה בלבד
  resetSubPick();

  buildControls();
  buildFilters();
  recompute();
}

/* ===== סרגל הבקרה העליון: טווח תאריכים ===== */

function buildControls() {
  const host = document.getElementById('cc-ctl');
  if (!host) return;

  host.innerHTML = '';
  const box = el('div', 'ctl');

  // כפתור שלושת הפסים — פותח וסוגר את מגירת המסננים
  const drawer = document.getElementById('cc-drawer');
  const toggle = document.getElementById('cc-drawer-toggle');
  if (drawer && toggle) {
    const label = el('label', 'drawer-toggle');
    label.htmlFor = 'cc-drawer-toggle';
    const lines = el('span', 'lines');
    lines.innerHTML = '<i></i><i></i><i></i>';
    label.appendChild(lines);
    label.appendChild(el('span', null, 'מסננים וטווח תאריכים'));
    box.appendChild(label);
  }

  const reset = el('button', 'act-btn ghost', 'איפוס');
  reset.addEventListener('click', resetFilters);
  box.appendChild(reset);

  const state = el('span', 'ctl-state');
  state.id = 'cc-state';
  box.appendChild(state);

  host.appendChild(box);
}

function resetFilters() {
  Object.keys(CC.selected).forEach(key => CC.selected[key].clear());
  CC.dateFrom = null;
  CC.dateTo = null;
  buildFilters();
  recompute();
}

/* טווח התאריכים יושב בתוך המגירה, יחד עם שאר המסננים.
   ברירת המחדל היא תמיד הטווח המלא של הקמפיין. */
function dateGroup() {
  if (!CC.data.dateStart) return null;

  const group = el('div', 'fgrp');
  const head = el('div', 'ghead');
  head.appendChild(el('span', 'gname', 'טווח תאריכי הגשה'));
  const count = el('span', 'gcnt');
  count.id = 'cnt-dates';
  head.appendChild(count);
  group.appendChild(head);

  const buttons = el('div', 'gbtns');
  const all = el('button', 'mini', 'כל הטווח');
  buttons.appendChild(all);
  group.appendChild(buttons);

  const dates = el('div', 'dates');
  const from = el('input');
  from.type = 'date';
  from.min = CC.data.dateStart; from.max = CC.data.dateEnd;
  from.value = CC.dateFrom === null ? CC.data.dateStart : dayToDate(CC.dateFrom);

  const to = el('input');
  to.type = 'date';
  to.min = CC.data.dateStart; to.max = CC.data.dateEnd;
  to.value = CC.dateTo === null ? CC.data.dateEnd : dayToDate(CC.dateTo);

  const fromRow = el('label');
  fromRow.appendChild(el('span', null, 'מ־'));
  fromRow.appendChild(from);
  const toRow = el('label');
  toRow.appendChild(el('span', null, 'עד'));
  toRow.appendChild(to);
  dates.appendChild(fromRow);
  dates.appendChild(toRow);
  group.appendChild(dates);

  from.addEventListener('change', () => { CC.dateFrom = dateToDay(from.value); recompute(); });
  to.addEventListener('change', () => { CC.dateTo = dateToDay(to.value); recompute(); });
  all.addEventListener('click', () => {
    CC.dateFrom = null; CC.dateTo = null;
    from.value = CC.data.dateStart; to.value = CC.data.dateEnd;
    recompute();
  });

  return group;
}

/* ===== פאנל המסננים ===== */

function buildFilters() {
  const host = document.getElementById('cc-filters');
  if (!host) return;

  host.innerHTML = '';

  const dates = dateGroup();
  if (dates) host.appendChild(dates);

  CC.data.facets.forEach(facet => {
    const group = el('div', 'fgrp');

    const head = el('div', 'ghead');
    head.appendChild(el('span', 'gname', facet.label));
    const count = el('span', 'gcnt');
    count.id = 'cnt-' + facet.key;
    head.appendChild(count);
    group.appendChild(head);

    const buttons = el('div', 'gbtns');
    const all = el('button', 'mini', 'הכל');
    all.addEventListener('click', () => {
      CC.selected[facet.key].clear();
      buildFilters();
      recompute();
    });
    // הסט מחזיק את הערכים ה*מוחרגים*. סט ריק = הכל נבחר.
    // לכן "נקה" מחריג את כולם, ו"הכל" מרוקן את הסט.
    const none = el('button', 'mini reset', 'נקה');
    none.addEventListener('click', () => {
      CC.selected[facet.key] = new Set(facet.values.map((_, i) => i));
      buildFilters();
      recompute();
    });
    buttons.appendChild(all);
    buttons.appendChild(none);
    group.appendChild(buttons);

    const scroll = el('div', 'scroll');
    facet.values.forEach((value, index) => {
      const label = el('label', 'chk');
      const box = el('input');
      box.type = 'checkbox';
      // סט ריק = הכל נבחר. אחרת — הסט מכיל את המוחרגים.
      box.checked = !CC.selected[facet.key].has(index);
      box.addEventListener('change', () => {
        if (box.checked) CC.selected[facet.key].delete(index);
        else CC.selected[facet.key].add(index);
        recompute();
      });
      label.appendChild(box);
      label.appendChild(el('span', null, value));
      const cnt = el('span', 'cnt');
      cnt.dataset.facet = facet.key;
      cnt.dataset.index = index;
      label.appendChild(cnt);
      scroll.appendChild(label);
    });
    group.appendChild(scroll);
    host.appendChild(group);
  });
}

/* ===== חישוב הסינון ===== */

function recompute() {
  const data = CC.data;
  if (!data || data.empty) return;

  const total = data.total;
  const rows = [];

  for (let i = 0; i < total; i++) {
    let keep = true;

    if (data.dates.length) {
      const day = data.dates[i];
      if (day < 0) keep = false;
      else if (CC.dateFrom !== null && day < CC.dateFrom) keep = false;
      else if (CC.dateTo !== null && day > CC.dateTo) keep = false;
    }

    if (keep) {
      for (const facet of data.facets) {
        const excluded = CC.selected[facet.key];
        if (excluded && excluded.size && excluded.has(facet.codes[i])) {
          keep = false;
          break;
        }
      }
    }
    if (keep) rows.push(i);
  }

  CC.rows = rows;
  renderAll();
}

/* ===== ספירות ===== */

function flagBits(key) {
  const flag = CC.data.flags.find(f => f.key === key);
  return flag ? flag.bits : null;
}

function countFlag(key) {
  const bits = flagBits(key);
  if (!bits) return 0;
  let sum = 0;
  for (const i of CC.rows) sum += bits[i];
  return sum;
}

function facetCounts(facet) {
  const counts = new Array(facet.values.length).fill(0);
  for (const i of CC.rows) {
    const code = facet.codes[i];
    if (code >= 0) counts[code]++;
  }
  return counts;
}

function averageDuration(key) {
  const values = CC.data.durations[key];
  if (!values) return null;
  let sum = 0, count = 0;
  for (const i of CC.rows) {
    const value = values[i];
    if (value !== null && value >= 0) { sum += value; count++; }
  }
  return count ? sum / count : null;
}

/* ===== רינדור ===== */

function renderAll() {
  renderState();
  renderExport();
  renderKpis();
  renderFunnel();
  renderFunnelShape();
  renderFunnelFull();
  renderConversion();
  renderStageTable();
  renderRecruitTime();
  renderStatusReason();
  renderCharts();
  renderRecruits();
  renderPies();
  renderTrend();
  renderSubCampaigns();
  renderPlatforms();
  renderAds();
  renderAdSuccess();
  renderSubComparison();
  syncSubTabLink();
  renderMediaTools();
  renderMediaKpis();
  renderPlatformCards();
  renderMediaBars();
  renderDaily();
  renderCplCards();
  renderMaps();
  renderSettlementTable();
  renderAreaMissingNote();
  renderInsights();
  renderHeadline();
  renderComparison();
  renderFacetCounts();
  fitBarLabels();
  tidyTables();
}

function renderState() {
  const node = document.getElementById('cc-state');
  if (!node) return;
  const shown = CC.rows.length;
  const total = CC.data.total;
  node.textContent = shown === total
    ? `מוצגים כל ${n(total)} המועמדים`
    : `מוצגים ${n(shown)} מתוך ${n(total)} מועמדים`;
  node.classList.toggle('filtered', shown !== total);
}

function renderFacetCounts() {
  const dateCount = document.getElementById('cnt-dates');
  if (dateCount) {
    dateCount.textContent = (CC.dateFrom === null && CC.dateTo === null)
      ? 'כל הטווח' : 'מסונן';
  }

  CC.data.facets.forEach(facet => {
    const counts = facetCounts(facet);
    const head = document.getElementById('cnt-' + facet.key);
    if (head) {
      const chosen = facet.values.length - (CC.selected[facet.key]?.size || 0);
      head.textContent = `${chosen}/${facet.values.length}`;
    }
    document.querySelectorAll(`.cnt[data-facet="${facet.key}"]`).forEach(node => {
      node.textContent = n(counts[Number(node.dataset.index)]);
    });
  });
}

function tile(value, label, foot, isTotal) {
  const node = el('div', 'tile' + (isTotal ? ' total' : ''));
  node.appendChild(el('div', 'val', value));
  node.appendChild(el('div', 'lbl', label));
  if (foot) node.appendChild(el('div', 'foot', foot));
  return node;
}

function renderKpis() {
  const host = document.getElementById('cc-kpis');
  if (!host) return;
  host.innerHTML = '';

  const leads = CC.rows.length;
  const active = countFlag('active');
  const recruited = countFlag('recruited');
  const referred = countFlag('referred');

  host.appendChild(tile(n(leads), 'מועמדים בסינון הנוכחי',
                        `מתוך ${n(CC.data.total)} בקמפיין`, true));
  host.appendChild(tile(n(active), 'מועמדים פעילים',
                        leads ? pct(active / leads) + ' מהמועמדים' : ''));
  host.appendChild(tile(n(countFlag('interview')), 'עשו ראיון התאמה',
                        avgText('רמה')));
  host.appendChild(tile(n(countFlag('dapar')), 'עשו דפ"ר', avgText('דפר')));
  host.appendChild(tile(n(countFlag('assessment')), 'עשו מרכז הערכה',
                        avgText('מרכז הערכה')));
  if (CC.data.usesReferents) {
    host.appendChild(tile(n(referred), 'הופנו למחוז',
                          leads ? pct(referred / leads) : ''));
  }
  host.appendChild(tile(n(recruited), 'גויסו',
                        leads ? 'שיעור גיוס ' + pct(recruited / leads) : ''));
}

function avgText(milestone) {
  const average = averageDuration(milestone);
  return average === null ? '' : `ממוצע ${Math.round(average)} ימים מההגשה`;
}

function renderFunnel() {
  const host = document.getElementById('cc-funnel');
  if (!host) return;
  host.innerHTML = '';

  const leads = CC.rows.length;
  const steps = funnelSteps();
  if (!steps.length) return;

  const card = el('div', 'card barcard');
  card.appendChild(el('div', 'bartitle', 'משפך הגיוס'));

  const table = el('table', 'bars');
  const max = Math.max(...steps.map(s => s.value), 1);

  steps.forEach((step, index) => {
    table.appendChild(barRow(step.label, step.value / max,
                             leads ? step.value / leads : 0,
                             n(step.value), seriesColor(index)));
  });

  card.appendChild(table);
  card.appendChild(el('div', 'tnote',
    `האחוז שבתוך העמודה הוא שיעור השלב מתוך ${n(leads)} המגישים בסינון ` +
    'הנוכחי, והמספר בסופה הוא הכמות. "גויסו" נספר רק בגיוס שהתרחש ' +
    `תוך ${n(CC.data.recruitWindowDays || 120)} יום מההגשה.`));
  host.appendChild(card);
}

/* --- גרפי עמודות לפי ממד --- */

const CHART_DIMENSIONS = ['platform', 'stage', 'area', 'age', 'education',
                          'religion', 'gender', 'adGroup'];

function renderCharts() {
  const host = document.getElementById('cc-charts');
  if (!host) return;
  host.innerHTML = '';

  const only = host.dataset.dims ? host.dataset.dims.split(',') : CHART_DIMENSIONS;
  only.forEach(key => {
    const facet = CC.data.facets.find(f => f.key === key);
    if (!facet) return;
    const counts = facetCounts(facet);
    // כל המגישים בגרף: הריקים כ"לא צוין", ומעבר ל-14 שורות — "ערכים
    // נוספים". הגרף מסתכם תמיד לסך הקמפיין (אלי הדיבגר בודק זאת).
    const pairs = pieSlices(facet.values
      .map((value, index) => ({ value, count: counts[index] })), key, 14);
    if (pairs.length) host.appendChild(barCard(facet.label, pairs, facet.key));
  });
}

/* --- פילוח הגיוסים מהקמפיין --- */

/* אלה השורות שגויסו, מתוך הסינון הפעיל. כל שאר המסך מדבר על
   מגישים; כאן מסתכלים רק על מי שהגיע עד הסוף, ומפלחים אותו לפי
   שדות דוח הגיוסים. */
function recruitedRows() {
  const bits = flagBits('recruited');
  if (!bits) return [];
  return CC.rows.filter(index => bits[index]);
}

/* הזמן הממוצע עד גיוס, על המגויסים שבסינון בלבד. המשכים כבר
   נשלחים לדפדפן עבור אבני הדרך; כאן נדרש משך הגיוס עצמו. */
function averageRecruitDays(rows) {
  const values = CC.data.durations && CC.data.durations['גיוס'];
  if (!values) return null;
  let sum = 0, count = 0;
  rows.forEach(index => {
    const value = values[index];
    if (value !== null && value !== undefined && value >= 0) {
      sum += value; count += 1;
    }
  });
  return count ? sum / count : null;
}

/* פיצול הגיוסים לפי "יעוד/מנהלי" — שתי דרכי הקבלה. הערכים
   מגיעים כפי שנרשמו בדוח הגיוסים, ולכן הרשימה נבנית מהם ולא
   מרשימה קבועה: דוח שיביא ערך שלישי יציג אותו ולא יבליע אותו.
   שורות בלי ערך אינן כרטיס — הן נספרות בכרטיס "ללא סיווג". */
function recruitTypeSplit(rows) {
  const facet = CC.data.facets.find(f => f.key === 'recruitType');
  if (!facet || !rows.length) return [];

  const counts = new Array(facet.values.length).fill(0);
  let missing = 0;
  rows.forEach(index => {
    const code = facet.codes[index];
    if (code >= 0 && !isEmptyValue(facet.values[code])) counts[code] += 1;
    else missing += 1;
  });

  const parts = facet.values
    .map((value, index) => ({ label: value, count: counts[index] }))
    .filter(part => part.count > 0 && !isEmptyValue(part.label))
    .sort((a, b) => b.count - a.count);

  // אם אין אף ערך מסווג אין מה לפצל, וכרטיס "ללא סיווג" לבדו
  // רק חוזר על המספר הגדול שמעליו
  if (!parts.length) return [];
  if (missing) parts.push({ label: 'ללא סיווג', count: missing });
  return parts;
}

function renderRecruits() {
  const host = document.getElementById('cc-recruit-charts');
  const kpis = document.getElementById('cc-recruit-kpis');
  if (!host) return;
  host.innerHTML = '';
  if (kpis) kpis.innerHTML = '';

  const rows = recruitedRows();
  if (kpis) {
    const share = CC.rows.length ? rows.length / CC.rows.length : 0;
    const window = CC.data.recruitWindowDays || 120;
    kpis.appendChild(tile(n(rows.length), 'גויסו מהקמפיין',
                          `${pct(share)} מהמגישים · תוך ${n(window)} יום מההגשה`,
                          true));

    /* הפיצול ליעודי ומנהלי יושב באותה שורה, מיד מתחת למספר
       הגדול: זה אותו גיוס, מוצג בשתי דרכי הקבלה. מספר "גויסו
       בסך הכול" ירד מכאן — גיוס שאינו של הקמפיין אינו נתון של
       הקמפיין, ומקומו בהתראות הריצה שאומרות למה הוא לא נספר. */
    recruitTypeSplit(rows).forEach(part => {
      kpis.appendChild(tile(n(part.count), part.label,
                            rows.length ? pct(part.count / rows.length) +
                                          ' מהגיוסים' : ''));
    });

    const average = averageRecruitDays(rows);
    if (average !== null) {
      kpis.appendChild(tile(Math.round(average) + ' ימים', 'זמן ממוצע עד גיוס',
                            'מההגשה ועד יום הגיוס'));
    }
  }

  if (!rows.length) {
    host.innerHTML = '<p class="note">אין גיוסים בסינון הנוכחי.</p>';
    return;
  }

  const only = host.dataset.dims ? host.dataset.dims.split(',') : [];
  only.forEach(key => {
    const facet = CC.data.facets.find(f => f.key === key);
    if (!facet) return;

    // ספירה על המגויסים בלבד, ולא על כל המגישים
    const counts = new Array(facet.values.length).fill(0);
    rows.forEach(index => {
      const code = facet.codes[index];
      if (code >= 0) counts[code] += 1;
    });

    // כל המגויסים בגרף — מי שאין לו ערך נספר כ"לא צוין"
    const pairs = pieSlices(facet.values
      .map((value, index) => ({ value, count: counts[index] })), key, 14);

    // שדה שלא הגיע בדוח הגיוסים פשוט אינו מוצג, במקום כרטיס ריק
    const stated = pairs.some(pair => pair.value !== NOT_STATED);
    if (stated) host.appendChild(barCard(facet.label, pairs, facet.key));
  });

  if (!host.children.length) {
    host.innerHTML = '<p class="note">אין שדות גיוס בדוח שנטען — ' +
      'ראה את ההתראות.</p>';
  }
}

/* --- גרף מגמה --- */

function dailySeries() {
  const byDay = new Map();
  for (const i of CC.rows) {
    const day = CC.data.dates[i];
    if (day >= 0) byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0])
    .map(entry => ({ day: entry[0], date: dayToDate(entry[0]), value: entry[1] }));
}

/* "-2 שעות" נכתב "פחות שעתיים", ולא "ב--2 שעות". */
function hoursText(shift) {
  const size = Math.abs(shift);
  const word = size === 1 ? 'שעה' : (size === 2 ? 'שעתיים' : size + ' שעות');
  return (shift < 0 ? 'פחות ' : 'תוספת ') + word;
}

function renderDaily() {
  const kpis = document.getElementById('cc-daily-kpis');
  const series = dailySeries();

  if (kpis) {
    kpis.innerHTML = '';
    if (series.length) {
      const values = series.map(p => p.value);
      const peak = series[values.indexOf(Math.max(...values))];
      const low = series[values.indexOf(Math.min(...values))];
      const sum = values.reduce((a, b) => a + b, 0);
      kpis.appendChild(tile(n(sum), 'סך ההגשות בטווח',
                            `${series.length} ימים`, true));
      kpis.appendChild(tile(n(peak.value), 'שיא יומי', peak.date));
      kpis.appendChild(tile(n(low.value), 'שפל יומי', low.date));
      kpis.appendChild(tile(n(Math.round(sum / series.length)),
                            'ממוצע לידים ליום'));
    }
  }

  const tableHost = document.getElementById('cc-daily-table');
  if (tableHost) {
    tableHost.innerHTML = '';
    if (series.length) {
      const max = Math.max(...series.map(p => p.value));
      const table = el('table', 't');
      const head = el('tr');
      ['תאריך', 'שיעור', '', 'הגשות', 'מצטבר'].forEach(
        label => head.appendChild(el('th', null, label)));
      table.appendChild(head);
      let running = 0;
      const sum = series.reduce((acc, p) => acc + p.value, 0) || 1;
      series.forEach(point => { running += point.value; point.cum = running; });
      series.forEach(point => {
        // אותו כלל כמו בכל הגרפים: אחוז בהתחלה, עמודה, מספר בסוף
        const tr = barRow(point.date, point.value / max, point.value / sum,
                          n(point.value), '#4F8EF7');
        tr.appendChild(el('td', 'bval', n(point.cum)));
        table.appendChild(tr);
      });
      const card = el('div', 'card');
      card.appendChild(table);
      tableHost.appendChild(card);
    }
  }

  // הגשות לפי שבוע קמפיין — כל 7 ימים מתחילת הקמפיין
  const weekly = document.getElementById('cc-weekly');
  if (weekly) {
    weekly.innerHTML = '';
    if (series.length) {
      const firstDay = series[0].day;
      const buckets = new Map();
      series.forEach(point => {
        const week = Math.floor((point.day - firstDay) / 7);
        buckets.set(week, (buckets.get(week) || 0) + point.value);
      });
      const pairs = [...buckets.entries()].sort((a, b) => a[0] - b[0])
        .map(entry => {
          const start = dayToDate(firstDay + entry[0] * 7);
          const end = dayToDate(firstDay + entry[0] * 7 + 6);
          return {
            value: `שבוע ${entry[0] + 1} (${start.slice(8, 10)}/${start.slice(5, 7)}` +
                   `–${end.slice(8, 10)}/${end.slice(5, 7)})`,
            count: entry[1],
          };
        });
      weekly.appendChild(barCard('הגשות לפי שבוע קמפיין', pairs));
    }
  }

  const charts = document.getElementById('cc-daily-charts');
  if (charts) {
    charts.innerHTML = '';
    // לפי יום בשבוע
    const names = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    const weekday = new Array(7).fill(0);
    series.forEach(point => {
      weekday[new Date(point.date + 'T00:00:00').getDay()] += point.value;
    });
    charts.appendChild(barCard('הגשות לפי יום בשבוע',
      names.map((name, index) => ({ value: name, count: weekday[index] }))));

    // שעת ההגשה אינה מוצגת (07/10/2026) — הנתון נקלט אך בעייתי
  }
}

/* כרטיס גרף עמודות מרשימת {value, count} */
/* כרטיס גרף עמודות — הכלל של כל הגרפים בפרויקט:
   תווית · אחוז בתחילת השורה · העמודה הצבועה · המספר בסופה.
   האחוז בעמודה משלו, כך שכל האחוזים עומדים אחד מעל השני. */
/* --- הדגשת ערכים חיוביים ושליליים (סעיף 4) --- */

/* הצבעים בגרפים אינם משתנים: כל פילוח שומר על סדרת הצבעים שלו,
   כדי שאותה קטגוריה תיראה אותו דבר בכל מסך. מה שנוסף הוא סימון
   קטן — נקודה ומסגרת — לצד הערכים שהוגדרו כחיוביים או כשליליים,
   כך שהעין מוצאת אותם בלי שהגרף יאבד את שפתו. */
function sentimentOf(facetKey, value) {
  const table = (CC.data || ANNUAL.data || {}).sentiment || {};
  const forFacet = table[facetKey];
  return (forFacet && forFacet[value]) || '';
}

const SENTIMENT_TITLE = { 'חיובי': 'קהל יעד', 'שלילי': 'מחוץ לקהל היעד' };

/* הצבע עצמו נושא את המשמעות, ולכן אין סימון נפרד לצד התווית.
   נשאר רק ה-title, שמסביר בריחוף מה הצבע אומר. */
function markSentiment(node, facetKey, value) {
  const mood = sentimentOf(facetKey, value);
  if (mood) node.title = SENTIMENT_TITLE[mood] || mood;
  return node;
}

/* --- צבע לפי משמעות --- */

/* קטגוריה שהוגדרה כשלילית מקבלת אדום, וחיובית ירוק-כחול. הגוונים
   בתוך כל משפחה שונים זה מזה, כדי ששתי פרוסות שליליות סמוכות
   יישארו נפרדות לעין ולא ייראו כפרוסה אחת גדולה.

   מה שאינו מסומן שומר על סדרת הצבעים הרגילה. */
const MOOD_COLORS = {
  'חיובי': ['#22c39a', '#0f8f77', '#4fd1a5', '#1d7a63', '#7fe3c4'],
  'שלילי': ['#f97362', '#c23b3b', '#ff9a86', '#8f2a2a', '#ffb4a2'],
};

/* הצבעים הניטרליים. אף אחד מהם אינו ירוק ואינו אדום, ולכן ערך
   שלא סומן אינו יכול להתחזות לחיובי או לשלילי: "מוסלמי" קיבל
   קודם את הצבע השני בסדרה הכללית, שהוא בדיוק הירוק של "יהודי",
   ושתי הקטגוריות נראו זהות. */
const NEUTRAL_COLORS = ['#4F8EF7', '#FFC857', '#a78bfa', '#38bdf8', '#f472b6',
                        '#fb923c', '#94a3b8', '#818cf8', '#e879f9', '#facc15',
                        '#60a5fa', '#c084fc'];

/* מחשיך או מבהיר צבע, כשמשפחה נגמרה ונדרש גוון נוסף שאינו בשימוש. */
function shiftColor(hex, step) {
  const towards = step % 2 ? '#ffffff' : '#000000';
  return mixColors(hex, towards, 0.12 * Math.ceil(step / 2));
}

/* בונה את פונקציית הצבע של גרף אחד.

   שני כללים:
   1. הצבע נושא משמעות — שלילי באדום, חיובי בירוק, וכל השאר
      בסדרה הניטרלית שאין בה לא ירוק ולא אדום.
   2. בתוך גרף אחד, שתי קטגוריות שונות לעולם אינן מקבלות אותו
      צבע. אם גוון כבר נתפס, הבא בתור נלקח, ואם המשפחה נגמרה —
      נגזר ממנה גוון כהה או בהיר יותר. */
function moodPalette(facetKey) {
  const used = { 'חיובי': 0, 'שלילי': 0 };
  let neutral = 0;
  const taken = new Set();
  const memory = new Map();

  return function (value) {
    if (memory.has(value)) return memory.get(value);

    const mood = sentimentOf(facetKey, value);
    const family = MOOD_COLORS[mood];
    let color;
    if (family) {
      color = family[used[mood] % family.length];
      used[mood] += 1;
    } else {
      color = NEUTRAL_COLORS[neutral % NEUTRAL_COLORS.length];
      neutral += 1;
    }

    let step = 1;
    let unique = color;
    while (taken.has(unique) && step < 12) {
      unique = shiftColor(color, step);
      step += 1;
    }
    taken.add(unique);
    memory.set(value, unique);
    return unique;
  };
}

/* סדר קבוע לפילוח שיש לו ציר טבעי (קבוצות גיל). בלי זה "48+"
   יכול להופיע לפני "21-30" רק משום שיש בו פחות מועמדים. */
function axisOrder(facetKey) {
  // הסדרים נשלחים גם במטען הקמפיין וגם בזה של הלוח השנתי, כי
  // הגרפים משותפים לשני המסכים. בלוח השנתי CC.data ריק, ולהפך.
  const source = CC.data || ANNUAL.data || {};
  if (facetKey === 'age' || facetKey === 'קבוצת גיל') return source.ageOrder || null;
  // רובאי בסדר הקבוצות, מהנמוכה לגבוהה — ולא לפי גודל
  if (facetKey === 'rovai' || facetKey === 'קבוצת רובאי') {
    return source.rovaiOrder || ['00', '02', '03', '05'];
  }
  if (facetKey === 'daypart') return (source.dayparts || {}).order || null;
  if (facetKey === 'recruitTime') return source.recruitTimeBuckets || null;
  return null;
}

function sortByAxis(pairs, facetKey) {
  const order = axisOrder(facetKey);
  if (!order) return pairs;
  return pairs.slice().sort((a, b) => {
    const ia = order.indexOf(a.value), ib = order.indexOf(b.value);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
}

function barCard(title, pairs, facetKey, dropEmpty) {
  let shown = pairs.filter(p => p.count > 0);
  const card = el('div', 'card barcard');
  card.appendChild(el('div', 'bartitle', title));
  if (!shown.length) return card;

  // בגרפי הפרופיל הערכים הריקים יורדים, וכמותם נרשמת מתחת לגרף
  let missing = 0;
  if (dropEmpty) {
    const split = splitEmpty(shown);
    if (split.real.length) { shown = split.real; missing = split.missing; }
  }

  // בגרף הפלטפורמות הצבע נגזר מהפלטפורמה ולא מסדר השורה, כדי
  // שאותה פלטפורמה תיראה באותו צבע בכל מסך
  const byPlatform = facetKey === 'platform';
  const max = Math.max(...shown.map(p => p.count));
  const total = shown.reduce((acc, p) => acc + p.count, 0);

  // פילוח שיש לו ציר טבעי מסודר לפיו, ולא לפי גודל
  const ordered = sortByAxis(shown, facetKey);
  const paint = moodPalette(facetKey);

  const table = el('table', 'bars');
  ordered.forEach(pair => {
    const row = barRow(pair.value, pair.count / max,
                       pair.count / total, n(pair.count),
                       (pair.value === NOT_STATED || pair.value === OTHER_VALUES)
                         ? NOT_STATED_COLOR
                         : byPlatform ? platformColor(pair.value)
                                      : paint(pair.value));
    markSentiment(row.firstChild, facetKey, pair.value);
    table.appendChild(row);
  });
  card.appendChild(table);
  if (missing) {
    card.appendChild(el('div', 'emptynote',
      `${n(missing)} ללא נתון (${pct(missing / (missing + total))}) — ` +
      'אינם מוצגים בגרף'));
  }
  return card;
}

/* שורת גרף אחת, לפי הכלל האחיד */
function barRow(label, widthRatio, share, valueText, color) {
  const tr = el('tr');
  tr.appendChild(el('td', 'blab', label));

  // עמודת הצבע לוקחת את כל הרוחב שנשאר, והאחוז יושב בתוכה בהתחלה.
  // אם העמודה צרה מכדי להכיל אותו, הוא עובר מיד אחריה — ראו fitBarLabels.
  const cell = el('td', 'bwrap');
  const track = el('div', 'btrack');
  const bar = el('div', 'bbar bbar--labelled');
  bar.style.width = Math.max(3, widthRatio * 100) + '%';
  bar.style.background = color;
  if (share !== null && share !== undefined) {
    const tag = el('span', 'bpct', pct(share));
    tag.dataset.color = color;
    bar.appendChild(tag);
  }
  track.appendChild(bar);
  cell.appendChild(track);
  tr.appendChild(cell);

  tr.appendChild(el('td', 'bval', valueText));
  return tr;
}

/* האחוז יושב בתוך הצבע. כשהעמודה צרה מכדי להכיל אותו הוא היה
   נחתך, או — גרוע מכך — רוחב מזערי היה מנפח עמודה קטנה ומשקר
   על הפרופורציה. לכן נמדד כאן הרוחב בפועל, ותווית שאינה נכנסת
   עוברת אל מחוץ לצבע, מיד אחריו, בצבעו.

   המדידה נעשית במעבר אחד על כל הגרפים שכבר בעמוד, ולכן הדפדפן
   מחשב פריסה פעם אחת בלבד: קודם נאספות כל המידות, ורק אחר כך
   מתבצעים השינויים. */
function fitBarLabels(root) {
  /* השמורה שנוספת בסוף כל מעבר מקצרת את כל העמודות בגרף — ותווית
     שנכנסה בדיוק לפני כן כבר אינה נכנסת (בלוח השנתי: "6.0%" שנחתך
     ל-"0%", 11/10/2026). לכן חוזרים עד שאף תווית אינה זזה. */
  for (let pass = 0; pass < 4; pass++) {
    if (!fitBarLabelsPass(root)) return;
  }
}

/* המדידה נעשית ברגע הציור — לפעמים לפני שהגופן נטען או לפני שהעמוד
   הגיע לרוחבו הסופי, ואז תווית "נכנסה" לעמודה שבסוף צרה ממנה
   (11/10/2026). המדידה חוזרת אחרי טעינת הגופנים, בטעינת העמוד ובכל
   שינוי רוחב. היא נוגעת רק בתוויות שבתוך העמודה ואינן נכנסות, ולכן
   הרצה חוזרת בטוחה וזולה. */
(function watchBarLabels() {
  let pending = 0;
  const again = () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => fitBarLabels());
  };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(again);
  window.addEventListener('load', again);
  if (window.ResizeObserver) {
    const start = () => new ResizeObserver(again).observe(document.body);
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  }
})();

function fitBarLabelsPass(root) {
  const scope = root || document;
  const tags = scope.querySelectorAll('.bbar > .bpct');
  if (!tags.length) return false;

  const move = [];
  tags.forEach(tag => {
    const bar = tag.parentNode;
    if (tag.scrollWidth + 12 > bar.clientWidth) move.push(tag);
  });
  if (!move.length) return false;

  /* שמורה בסוף כל מסילה, ברוחב התווית החיצונית הרחבה ביותר
     שבאותו גרף.

     בלי זה התווית שיצאה מהצבע נדחפה אל מעבר לסוף המסילה ועלתה
     על עמודת המספר שלצדה — שני מספרים זה על גבי זה, בדיוק מה
     שאסור. השמורה נמדדת פעם אחת לכל גרף ונוספת לכל שורותיו
     גם יחד, ולכן כל העמודות באותו גרף מתכווצות באותו יחס
     והפרופורציה ביניהן נשמרת במדויק. */
  const widest = new Map();
  move.forEach(tag => {
    const chart = tag.closest('table.bars');
    if (!chart) return;
    // השמורה ממעבר קודם אינה מתקצרת — רק גדלה אם צריך
    const before = parseFloat(chart.style.getPropertyValue('--outgutter')) - 8 || 0;
    widest.set(chart, Math.max(widest.get(chart) || 0, before, tag.scrollWidth));
  });

  move.forEach(tag => {
    const bar = tag.parentNode;
    tag.classList.add('bpct--out');
    tag.style.color = tag.dataset.color || '';
    bar.parentNode.appendChild(tag);
  });

  widest.forEach((width, chart) => {
    chart.style.setProperty('--outgutter', Math.ceil(width + 8) + 'px');
    chart.classList.add('bars--outfit');
  });
  return true;
}

/* מסדר כל טבלה שנוצרה בצד הלקוח, במעבר אחד אחרי הציור.

   שני דברים:

   1. גלילה אופקית. טבלה רחבה דחפה את העמוד עצמו להתרחב — במסך
      צר זה אומר שכל המסך נמתח לרוחב הטבלה, והכותרות, הכרטיסים
      והגרפים יצאו מחוץ למסך. עכשיו הטבלה נגללת בתוך המכל שלה
      והעמוד נשאר ברוחב המכשיר.

   2. רוחב הגיוני. טבלה של שתיים-שלוש עמודות שנפרסה על כל רוחב
      העמוד הפכה שדה ריק ענק בין התווית למספר. טבלה צרה נשארת
      צרה, ובמקום שהתפנה אפשר להעמיד כרטיס נוסף לצדה. */
function tidyTables(root) {
  const scope = root || document;
  // כל סוגי הטבלאות, ולא רק table.t. טבלת ההשוואה (table.cmp)
  // וטבלאות העמודות (table.bars) נשארו בחוץ, ולכן במסך צר הן
  // מתחו את העמוד כולו לרוחבן — בדיוק התקלה שהעטיפה נועדה
  // למנוע, רק בטבלאות אחרות.
  scope.querySelectorAll('table.t, table.cmp, table.bars').forEach(table => {
    const head = table.rows[0];
    const columns = head ? head.cells.length : 0;

    if (!table.parentNode.classList.contains('table-wrap')) {
      const wrap = el('div', 'table-wrap');
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    }

    // הסף הוא ארבע עמודות: מעבר לזה הטבלה באמת צריכה את הרוחב.
    // חל על table.t בלבד — גרף עמודות רוצה את כל הרוחב שיש.
    const card = table.closest('.card');
    if (card && columns && columns <= 4 && table.classList.contains('t')) {
      card.classList.add('card--slim');
    }

    markScrollable(table.parentNode);
  });
}

/* סימון עטיפה שאפשר לגלול בתוכה.

   הגלילה עצמה עבדה, אבל שום דבר לא אמר שהיא קיימת: בטלפון נראה
   שהטבלה פשוט נחתכת בקצה, ומי שלא ניחש שאפשר להחליק אותה הצידה
   לא ראה את העמודות האחרונות — ובטבלת האזורים דווקא האחרונה היא
   "מדד ייצוג". הסימון מוסיף הצללה בקצה שממנו יש עוד, והיא נעלמת
   כשמגיעים לסוף.

   המצב מתעדכן גם בגלילה וגם בשינוי גודל, כי טבלה יכולה להפוך
   לנגללת רק כשמסובבים את המכשיר. */
function markScrollable(wrap) {
  if (!wrap || !wrap.classList || !wrap.classList.contains('table-wrap')) return;

  const update = () => {
    const slack = wrap.scrollWidth - wrap.clientWidth;
    if (slack <= 2) {
      wrap.classList.remove('is-scrollable', 'at-start', 'at-end');
      return;
    }
    // ב-RTL scrollLeft הוא אפס בקצה הימני ושלילי ככל שגוללים שמאלה
    const offset = Math.abs(wrap.scrollLeft);
    wrap.classList.add('is-scrollable');
    wrap.classList.toggle('at-start', offset <= 2);
    wrap.classList.toggle('at-end', offset >= slack - 2);
  };

  if (!wrap.dataset.scrollWatched) {
    wrap.dataset.scrollWatched = '1';
    wrap.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
  }
  update();
}

function renderTrend() {
  const host = document.getElementById('cc-trend');
  if (!host || !CC.data.dates.length) return;
  host.innerHTML = '';

  const byDay = new Map();
  for (const i of CC.rows) {
    const day = CC.data.dates[i];
    if (day < 0) continue;
    byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  if (!byDay.size) return;

  const days = [...byDay.keys()].sort((a, b) => a - b);
  const first = days[0], last = days[days.length - 1];
  const points = [];
  for (let day = first; day <= last; day++) {
    points.push({ day, value: byDay.get(day) || 0 });
  }

  // שני מצבים: הגרף הרגיל מציג את הסך הכול בלבד, ובמסך ביצועי
  // הקמפיין מוצגות רק הפלטפורמות — בלי קו כולל שדורס אותן.
  const platformMode = host.dataset.mode === 'platforms';

  const facet = platformMode
    ? CC.data.facets.find(f => f.key === 'platform') : null;
  const series = [];
  if (facet) {
    const active = activePlatforms();
    const perPlatform = new Map();
    for (const i of CC.rows) {
      const day = CC.data.dates[i];
      if (day < 0) continue;
      const name = facet.values[facet.codes[i]];
      if (!active.has(name) || name === NO_SOURCE) continue;
      if (!perPlatform.has(name)) perPlatform.set(name, new Map());
      const bucket = perPlatform.get(name);
      bucket.set(day, (bucket.get(day) || 0) + 1);
    }
    [...perPlatform.entries()]
      .sort((a, b) => [...b[1].values()].reduce((x, y) => x + y, 0) -
                      [...a[1].values()].reduce((x, y) => x + y, 0))
      .forEach((entry, index) => {
        series.push({
          name: entry[0], color: platformColor(entry[0]),
          points: points.map(p => ({ day: p.day, value: entry[1].get(p.day) || 0 })),
        });
      });
  }

  const width = 900, height = 220;
  const padLeft = 46, padBottom = 30, padTop = 14, padRight = 14;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  // במצב פלטפורמות אין קו סך הכול, ולכן הסקאלה נקבעת לפי הקו הגבוה
  // ביותר. מדידה לפי הסך הכול הייתה מועכת את כל הקווים לתחתית.
  let max = 1;
  if (platformMode && series.length) {
    series.forEach(entry => entry.points.forEach(p => {
      if (p.value > max) max = p.value;
    }));
  } else {
    max = Math.max(...points.map(p => p.value), 1);
  }

  const x = i => padLeft + (points.length === 1 ? plotW / 2
    : (i / (points.length - 1)) * plotW);
  const y = value => padTop + plotH - (value / max) * plotH;

  const parts = [];
  parts.push(`<svg class="tsvg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`);

  for (let step = 0; step <= 4; step++) {
    const value = (max / 4) * step;
    const yy = y(value);
    parts.push(`<line class="tgrid" x1="${padLeft}" y1="${yy}" x2="${width - padRight}" y2="${yy}"/>`);
    parts.push(`<text class="tylab" x="${padLeft - 8}" y="${yy + 3}">${n(value)}</text>`);
  }

  if (!platformMode) {
    const line = points.map((p, i) =>
      `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    const area = `${line} L${x(points.length - 1).toFixed(1)},${y(0)} ` +
                 `L${x(0).toFixed(1)},${y(0)} Z`;
    parts.push(`<path d="${area}" fill="#4F8EF7" opacity="0.14"/>`);
    parts.push(`<path d="${line}" fill="none" stroke="#4F8EF7" stroke-width="2.4"/>`);
  }

  series.forEach(entry => {
    const path = entry.points.map((p, i) =>
      `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    parts.push(`<path d="${path}" fill="none" stroke="${entry.color}" ` +
               `stroke-width="2"/>`);
  });

  // תוויות נתונים — רק על שיאים מקומיים, וכשאין תווית אחרת קרובה,
  // כדי שהמספרים לא ידרסו זה את זה
  const taken = [];
  const fits = (px, py) => !taken.some(t =>
    Math.abs(t[0] - px) < 26 && Math.abs(t[1] - py) < 12);

  series.forEach(entry => {
    entry.points.forEach((p, i) => {
      if (!p.value) return;
      const before = i > 0 ? entry.points[i - 1].value : -1;
      const after = i < entry.points.length - 1 ? entry.points[i + 1].value : -1;
      if (p.value < before || p.value < after) return;
      const px = x(i), py = y(p.value) - 6;
      if (!fits(px, py)) return;
      taken.push([px, py]);
      parts.push(`<text x="${px.toFixed(1)}" y="${py.toFixed(1)}" ` +
                 `text-anchor="middle" style="fill:${entry.color};font-size:9px;` +
                 `font-weight:700">${n(p.value)}</text>`);
    });
  });

  const labelStep = Math.max(1, Math.floor(points.length / 8));
  points.forEach((p, i) => {
    if (i % labelStep === 0 || i === points.length - 1) {
      const iso = dayToDate(p.day);
      const label = iso.slice(8, 10) + '/' + iso.slice(5, 7);
      parts.push(`<text class="txlab" x="${x(i).toFixed(1)}" y="${height - 10}">${label}</text>`);
    }
    // תווית כמות מעל כל נקודה — כשיש הרבה ימים מוצגת אחת לכמה ימים,
    // אחרת התוויות נדבקות זו לזו ואי אפשר לקרוא אף אחת.
    // במצב פלטפורמות אין קו סך הכול, ולכן גם אין תוויות סך הכול:
    // הן היו יושבות גבוה מעל הקווים, רחוק ממה שהן מתארות.
    const every = points.length > 45 ? labelStep : 1;
    if (!platformMode && (i % every === 0 || i === points.length - 1)) {
      parts.push(`<text class="tval" x="${x(i).toFixed(1)}" ` +
                 `y="${(y(p.value) - 7).toFixed(1)}">${n(p.value)}</text>`);
    }
  });

  parts.push('</svg>');

  const card = el('div', 'card trendcard');
  card.appendChild(el('div', 'bartitle', 'הגשות לפי יום'));
  const holder = el('div');
  holder.innerHTML = parts.join('');
  card.appendChild(holder);
  // מקרא צבעים — קו בצבע הסדרה לצד שמה
  if (series.length) {
    const legend = el('div', 'linelegend');
    series.forEach(entry => {
      const item = el('span', 'lineitem');
      const swatch = el('span', 'lineswatch');
      swatch.style.background = entry.color;
      item.appendChild(swatch);
      const total = entry.points.reduce((acc, p) => acc + p.value, 0);
      item.appendChild(el('span', null, `${entry.name} · ${n(total)}`));
      legend.appendChild(item);
    });
    card.appendChild(legend);
  }

  const note = el('div', 'tnote');
  note.textContent = `${n(CC.rows.length)} מועמדים · ${points.length} ימים בטווח הנבחר`;
  card.appendChild(note);
  host.appendChild(card);
}

/* --- טבלת פלטפורמות: מדיה מול תוצאות --- */

const PLATFORM_TABLE_HEAD = ['פלטפורמה', 'תקציב שנוצל', 'ניצול', 'חשיפות',
                             'הקלקות', 'CTR', 'CPC', 'המרות', 'לידים',
                             'פעילים', 'גויסו', 'עלות לליד', 'עלות לגיוס'];

/* שורות טבלת הפלטפורמות של תת-קמפיין אחד (או של הקמפיין כולו).

   הלידים/פעילים/גיוסים נלקחים מהספירות המסוננות; המדיה מהשורות
   שהשרת שלח. פלטפורמה בלי מועמדים בסינון הנוכחי אינה שורה. */
function platformRows(subName, counts) {
  const media = performanceMedia(subName);
  const wanted = (subName && subName !== SUB_ALL) ? subName : null;

  const leads = new Map(), active = new Map(), recruited = new Map();
  counts.forEach(row => {
    if (wanted !== null && row.sub !== wanted) return;
    leads.set(row.platform, (leads.get(row.platform) || 0) + row.leads);
    active.set(row.platform, (active.get(row.platform) || 0) + row.active);
    recruited.set(row.platform, (recruited.get(row.platform) || 0) + row.recruited);
  });

  const names = new Set();
  leads.forEach((count, name) => { if (count > 0 && name) names.add(name); });
  return [...names].map(name => {
    const m = media.find(x => x.platform === name) || {};
    const count = leads.get(name) || 0;
    const hired = recruited.get(name) || 0;
    return {
      name, leads: count, active: active.get(name) || 0, recruited: hired,
      // התקציב עצמו אינו עמודה בטבלה, אבל הוא נדרש כדי שאחוז
      // הניצול של שורת הסיכום ייחשב מהסכומים ולא ממוצע אחוזים
      budget: m.budget ?? null,
      spent: m.spent ?? null, impressions: m.impressions ?? null,
      clicks: m.clicks ?? null, conversions: m.conversions ?? null,
      ctr: m.ctr ?? null, cpc: m.cpc ?? null, util: m.util ?? null,
      cpl: (m.spent && count) ? m.spent / count : null,
      cpr: (m.spent && hired) ? m.spent / hired : null,
    };
  }).sort((a, b) => b.leads - a.leads);
}

/* מסכם רשימת שורות פלטפורמה לשורה אחת — הכותרת של תת-קמפיין
   בטבלה המתחלחלת, ושורת ה"כולל" בתחתיתה. */
function platformRowsTotal(rows, label) {
  const total = rows.reduce((acc, row) => {
    MEDIA_SUMS.concat(['leads', 'active', 'recruited']).forEach(key => {
      if (row[key] === null || row[key] === undefined) return;
      acc[key] = (acc[key] || 0) + row[key];
    });
    return acc;
  }, { name: label, leads: 0, active: 0, recruited: 0 });

  total.ctr = ratio(total.clicks, total.impressions);
  total.cpc = ratio(total.spent, total.clicks);
  total.util = ratio(total.spent, total.budget);
  total.cpl = ratio(total.spent, total.leads);
  total.cpr = ratio(total.spent, total.recruited);
  return total;
}

/* המרות בדיגיטל מול הגשות במערכת (07/10/2026).

   כל הגשה במערכת התחילה בהמרה בפלטפורמה, ולא כל המרה הבשילה להגשה —
   ולכן ההמרות אמורות להיות לפחות כמו ההגשות. פחות המרות מהגשות הוא
   הפוך מהצפוי (דיווח מדיה חסר, או הגשות שיוחסו לפלטפורמה הלא נכונה),
   והוא מסומן באדום בכל מקום שבו שני המספרים עומדים זה לצד זה.
   אין דיווח המרות (null) — אין מה להשוות, ואין סימון. */
function conversionShort(conversions, leads) {
  return conversions !== null && conversions !== undefined && conversions < leads;
}

const CONVERSION_SHORT_NOTE =
  'פחות המרות בדיגיטל מהגשות במערכת — הפער אמור להיות הפוך';

/* הערה אדומה מפורשת מעל הטבלה, לכל פלטפורמה שבה ההמרות פחותות
   מההגשות: כמה המרות, כמה הגשות, מה הפער ומה לבדוק. בלי שורות כאלה —
   null, ואין הערה. */
function conversionShortNote(rows) {
  const short = rows.filter(row => row.name !== 'כולל' &&
                                   conversionShort(row.conversions, row.leads));
  if (!short.length) return null;
  const node = el('div', 'insight insight--short conv-short-note');
  node.style.marginBottom = '12px';
  node.innerHTML = `<b>${CONVERSION_SHORT_NOTE}.</b> ` + short.map(row =>
    `ב${row.name}: <b>${n(row.conversions)}</b> המרות מול <b>${n(row.leads)}</b> ` +
    `הגשות — <b>${n(row.leads - row.conversions)}</b> הגשות יותר מהמרות`)
    .join(' · ') +
    '. כל הגשה מתחילה בהמרה בפלטפורמה, ולא כל המרה מבשילה להגשה — ולכן ' +
    'ההמרות אמורות להיות יותר מההגשות. יש לבדוק שדוח המדיה מלא (כל ' +
    'התקופה וכל המודעות) ושההגשות שויכו לפלטפורמה הנכונה.';
  return node;
}

function platformTableRow(row, className, indent) {
  const tr = el('tr', className);
  const nameCell = el('td', indent ? 'sub-in' : null);
  if (!indent) {
    // כותרת תת-קמפיין אינה פלטפורמה ואין לה נקודת צבע של פלטפורמה
    nameCell.textContent = row.name;
  } else {
    const dot = el('span', 'cdot');
    dot.style.background = platformColor(row.name);
    nameCell.appendChild(dot);
    nameCell.appendChild(document.createTextNode(row.name));
  }
  tr.appendChild(nameCell);
  const short = conversionShort(row.conversions, row.leads);
  [money(row.spent), pct(row.util), n(row.impressions), n(row.clicks),
   pct(row.ctr), money(row.cpc), n(row.conversions), n(row.leads),
   n(row.active), n(row.recruited), money(row.cpl), money(row.cpr)]
    .forEach((text, index) => {
      // ההמרות (7) וההגשות (8) — באדום כשיש פחות המרות מהגשות
      const red = short && (index === 6 || index === 7);
      const cell = el('td', red ? 'num conv-short' : 'num', text);
      if (red) cell.title = CONVERSION_SHORT_NOTE;
      tr.appendChild(cell);
    });
  tr.dataset.conv = row.conversions === null || row.conversions === undefined
    ? '' : String(row.conversions);
  tr.dataset.leads = String(row.leads);
  tr.dataset.short = short ? '1' : '';
  return tr;
}

/* --- הטבלה עצמה ---

   בקמפיין מחולק היא מתחלחלת: שורת כותרת לכל תת-קמפיין עם סיכומיו,
   ותחתיה הפלטפורמות שלו. כך "כאילו כל אחד פלטפורמה אחרת" נראה
   בטבלה עצמה ולא רק בבחירה שמעליה. מי שאין לו סיווג מקבל את אותה
   שורת כותרת בסוף, ואינו מתערבב באף תת-קמפיין.

   כשתת-קמפיין אחד נבחר אין מה לחלחל — הטבלה חוזרת להיות רשימת
   פלטפורמות, כמו בקמפיין רגיל. */
function renderPlatforms() {
  const host = document.getElementById('cc-platforms');
  if (!host) return;
  host.innerHTML = '';

  const counts = platformCounts();
  const table = el('table', 't');
  const head = el('tr');
  PLATFORM_TABLE_HEAD.forEach(label => head.appendChild(el('th', null, label)));
  table.appendChild(head);

  const current = currentSub();
  const nested = hasSubCampaigns() && current === SUB_ALL;

  if (!nested) {
    platformRows(current, counts)
      .forEach(row => table.appendChild(platformTableRow(row, null, true)));
  } else {
    /* הגושים הם תתי-הקמפיין, וזהו. "ללא סיווג" אינו גוש: שורת
       כותרת משלו הייתה נראית כמו תת-קמפיין רביעי בלהב ושלישי
       בסייר וחוקר, ואין כאלה — יש שלושה ושניים. הוא נספר בשורת
       "כולל" בתחתית, וכמותו נאמרת במפורש בהערה שמתחת לטבלה. */
    const subs = activeSubs();
    const groups = subNames().filter(name => subs.has(name));

    let any = false;
    groups.forEach(name => {
      const rows = platformRows(name, counts);
      if (!rows.length) return;
      any = true;
      table.appendChild(platformTableRow(platformRowsTotal(rows, name),
                                         'sub-head', false));
      rows.forEach(row => table.appendChild(platformTableRow(row, 'sub-row', true)));
    });
    if (any) {
      table.appendChild(platformTableRow(
        platformRowsTotal(platformRows(SUB_ALL, counts), 'כולל — כל הקמפיין'),
        'sub-total', false));
    }
  }

  const warning = conversionShortNote(platformRows(current, counts));
  if (warning) host.appendChild(warning);
  const card = el('div', 'card');
  card.appendChild(table);
  let note = 'הלידים, הפעילים והגיוסים מגיבים למסננים. נתוני המדיה הם ' +
             'ברמת הפלטפורמה כולה ואינם מסוננים לפי תאריך. המרות והגשות ' +
             `באדום: ${CONVERSION_SHORT_NOTE}.`;
  if (nested) {
    const unclassified = [...counts.values()]
      .filter(row => row.sub === SUBCAMPAIGN_NONE)
      .reduce((acc, row) => acc + row.leads, 0);
    note += ` הטבלה מציגה את ${n(subNames().length)} תתי הקמפיין. ` +
            'שורת "כולל" בתחתית מסכמת את הקמפיין כולו' +
            (unclassified
              ? `, ובכללו ${n(unclassified)} מועמדים שלא נמצא להם ` +
                'תת-קמפיין ואינם מופיעים תחת אף אחד מהם.'
              : '.');
  }
  card.appendChild(el('div', 'tnote', note));
  host.appendChild(card);
}

/* ===== פירוט עד רמת המודעה =====

   "טק.מקור מות.ללק." נושא שלושה רכיבים — פלטפורמה, קמפיין ומודעה
   ("fb_HAP1_AD5") — וזו הרזולוציה העמוקה ביותר שיש בדוח הלידים.
   כאן היא נמדדת: כמה הגיעו מכל מודעה, כמה מהם עדיין בהליך, וכמה
   גויסו.

   מה שאין כאן, ובכוונה: תקציב ועלות לליד למודעה. דוחות המדיה
   שמגיעים הם ברמת הקמפיין — אין בהם שורה למודעה. חלוקת התקציב
   לפי מספר הלידים הייתה נותנת לכל המודעות אותה "עלות לליד"
   בדיוק, מספר שנראה כמו מדידה ואינו כזה. */

const AD_NONE = 'ללא מודעה';

/* ערך הפילוח לשורה. ערך ריק מגיע מהשרת כ"(ריק)", ולכן הוא
   מתורגם כאן חזרה למחרוזת ריקה — אחרת "(ריק)" היה מופיע בטבלה
   כשמה של קבוצת מודעות. */
function facetValue(facet, index) {
  if (!facet) return '';
  const value = facet.values[facet.codes[index]];
  return isEmptyValue(value) ? '' : value;
}

/* ===== הצלחה לפי מודעה (לשונית נפרדת, 05/10/2026) =====

   לכל מודעה — כמה לידים הביאה וכמה מהם עברו כל שלב במשפך, עד הגיוס;
   כמה מהם פעילים (אקסל "פעילים"); ושיעור ההצלחה מתוך הלידים שלה.
   השלבים הם אותם שלבי המשפך שהשרת שולח (payload.funnel), כך שהמודעה
   נמדדת בדיוק כמו הקמפיין. הכול מגיב לסינון. */

// מתחת לסף הזה שיעור אחד או שניים קופצים ל-50%–100% ואינם אומרים דבר.
// מודעה כזו נשארת בטבלה, אבל אינה "המודעה המובילה" ואינה בגרף.
const AD_MIN_LEADS = 20;
const AD_METRICS = [
  ['files', 'עברו בדיקת קבצים'],
  ['dapar', 'ביצעו דפ"ר'],
  ['recruited', 'גויסו'],
];
let AD_METRIC = 'files';

function adSuccessRows() {
  // פלטפורמה וקבוצת מודעות הן אופציונליות: מסנן עם ערך אחד בלבד
  // (כל הקמפיין בפייסבוק, כולו HAP1) אינו נשלח מהשרת כלל
  const platform = CC.data.facets.find(f => f.key === 'platform');
  const ad = CC.data.facets.find(f => f.key === 'ad');
  if (!ad) return null;
  const group = CC.data.facets.find(f => f.key === 'adGroup');
  // "הגשות" כבר בעמודת "לידים"
  const steps = (CC.data.funnel || []).filter(s => s.key && s.key !== 'submitted');
  const bits = {};
  steps.concat([{ key: 'active' }]).forEach(s => { bits[s.key] = flagBits(s.key); });

  const rows = new Map();
  for (const i of CC.rows) {
    const record = {
      platform: (platform ? facetValue(platform, i) : '') || '—',
      group: (group ? facetValue(group, i) : '') || '—',
      ad: facetValue(ad, i) || AD_NONE,
    };
    const key = JSON.stringify([record.platform, record.group, record.ad]);
    let acc = rows.get(key);
    if (!acc) {
      acc = Object.assign({ leads: 0, counts: {} }, record);
      rows.set(key, acc);
    }
    acc.leads += 1;
    Object.keys(bits).forEach(k => {
      if (bits[k] && bits[k][i]) acc.counts[k] = (acc.counts[k] || 0) + 1;
    });
  }
  return { steps, list: [...rows.values()].sort((a, b) => b.leads - a.leads),
           hasPlatform: !!platform, hasGroup: !!group };
}

function adName(row) {
  return row.group && row.group !== '—' ? `${row.group} · ${row.ad}` : row.ad;
}

/* המרות בדיגיטל מול הגשות — בלשונית "הצלחה לפי מודעה" (07/10/2026).

   דוחות המדיה הם ברמת הפלטפורמה (ותת-הקמפיין), ואין בהם שורה למודעה —
   ולכן ההשוואה היא לכל פלטפורמה, הרזולוציה העמוקה שיש לשני הצדדים.
   שורה שבה ההמרות פחותות מההגשות — באדום (conversionShort). */
function renderAdConversions() {
  const host = document.getElementById('cc-adsuccess-conv');
  if (!host) return;
  host.innerHTML = '';

  const rows = platformRows(currentSub(), platformCounts())
    .filter(row => row.conversions !== null && row.conversions !== undefined);
  // פלטפורמה שדיווחה המרות ואין לה אף הגשה במערכת — גם היא שורה (0 הגשות).
  // היא אינה במסנן הפלטפורמות (אין לה לידים), ולכן נלקחת ישר מהמדיה —
  // רק כשלא נבחרה פלטפורמה מסוימת במסנן.
  const picked = CC.selected && CC.selected.platform && CC.selected.platform.size;
  (picked ? [] : mediaRows(currentSub())).forEach(m => {
    if (m.platform === NO_SOURCE || m.platform === OTHER_PLATFORM) return;
    if (m.conversions === null || m.conversions === undefined) return;
    if (rows.some(row => row.name === m.platform)) return;
    rows.push({ name: m.platform, conversions: m.conversions, leads: 0 });
  });
  if (!rows.length) {
    host.appendChild(el('div', 'card',
      'אין דיווח המרות מהמדיה לפלטפורמות שבסינון הנוכחי.'));
    return;
  }
  const total = rows.reduce((acc, row) => ({
    name: 'כולל', conversions: acc.conversions + row.conversions,
    leads: acc.leads + row.leads,
  }), { conversions: 0, leads: 0 });

  const table = el('table', 't');
  const head = el('tr');
  ['פלטפורמה', 'המרות בדיגיטל', 'הגשות במערכת', 'פער (המרות פחות הגשות)']
    .forEach(label => head.appendChild(el('th', null, label)));
  table.appendChild(head);
  rows.concat([total]).forEach(row => {
    const short = conversionShort(row.conversions, row.leads);
    const tr = el('tr', (short ? 'conv-short-row' : '') +
                        (row === total ? ' sub-total' : ''));
    const name = el('td');
    if (row !== total) {
      const dot = el('span', 'cdot');
      dot.style.background = platformColor(row.name);
      name.appendChild(dot);
    }
    name.appendChild(document.createTextNode(row.name));
    tr.appendChild(name);
    const gap = row.conversions - row.leads;
    [n(row.conversions), n(row.leads), (gap > 0 ? '+' : '') + n(gap)]
      .forEach(text => {
        const cell = el('td', short ? 'num conv-short' : 'num', text);
        if (short) cell.title = CONVERSION_SHORT_NOTE;
        tr.appendChild(cell);
      });
    tr.dataset.conv = String(row.conversions);
    tr.dataset.leads = String(row.leads);
    tr.dataset.short = short ? '1' : '';
    table.appendChild(tr);
  });

  const warning = conversionShortNote(rows);
  if (warning) host.appendChild(warning);
  const card = el('div', 'card');
  const scroll = el('div', 'tscroll');
  scroll.appendChild(table);
  card.appendChild(scroll);
  card.appendChild(el('div', 'tnote',
    'כל הגשה מתחילה בהמרה בפלטפורמה, ולא כל המרה מבשילה להגשה — ולכן ' +
    `ההמרות אמורות להיות לפחות כמו ההגשות. באדום: ${CONVERSION_SHORT_NOTE}. ` +
    'ההשוואה לפי פלטפורמה: דוחות המדיה אינם מפרטים המרות למודעה. ' +
    'ההגשות מגיבות למסננים; ההמרות הן של הפלטפורמה כולה.'));
  host.appendChild(card);
}

function renderAdSuccess() {
  renderAdConversions();
  const kpis = document.getElementById('cc-adsuccess-kpis');
  const bars = document.getElementById('cc-adsuccess-bars');
  const tableHost = document.getElementById('cc-adsuccess-table');
  if (!kpis && !bars && !tableHost) return;
  [kpis, bars, tableHost].forEach(node => { if (node) node.innerHTML = ''; });

  const data = adSuccessRows();
  if (!data) {
    if (tableHost) {
      tableHost.appendChild(el('div', 'card',
        'בקמפיין הזה אין פירוט לרמת המודעה: אף קוד מקור בו אינו נושא רכיב ' +
        'מודעה (למשל "fb_HAP1_AD5"). כאן הקוד מזהה את הפלטפורמה או את ' +
        'תת-הקמפיין, ולא את המודעה.'));
    }
    return;
  }
  const { steps, list, hasPlatform, hasGroup } = data;
  if (!list.length) {
    if (tableHost) tableHost.appendChild(el('div', 'card', 'אין מועמדים בסינון הנוכחי.'));
    return;
  }
  const rate = (row, key) => row.leads ? (row.counts[key] || 0) / row.leads : 0;
  const real = list.filter(row => row.ad !== AD_NONE);
  const solid = real.filter(row => row.leads >= AD_MIN_LEADS);

  // --- כרטיסי סיכום ---
  if (kpis) {
    kpis.appendChild(tile(n(real.length), 'מודעות', `${n(solid.length)} עם ${AD_MIN_LEADS}+ לידים`, true));
    if (real.length) {
      const most = real[0];
      kpis.appendChild(tile(adName(most), 'הכי הרבה לידים',
        `${n(most.leads)} לידים · ${pct(most.leads / CC.rows.length)} מהלידים`));
    }
    AD_METRICS.forEach(([key, label]) => {
      if (!solid.length) return;
      const best = solid.slice().sort((a, b) => rate(b, key) - rate(a, key))[0];
      if (!rate(best, key)) return;
      kpis.appendChild(tile(adName(best), `שיעור "${label}" הגבוה`,
        `${pct(rate(best, key))} · ${n(best.counts[key] || 0)} מתוך ${n(best.leads)}`));
    });
  }

  // --- גרף שיעור ההצלחה, עם בחירת המדד ---
  if (bars) {
    const card = el('div', 'card');
    const chips = el('div', 'chips');
    AD_METRICS.forEach(([key, label]) => {
      const chip = el('button', 'chip' + (AD_METRIC === key ? ' on' : ''), label);
      chip.type = 'button';
      chip.addEventListener('click', () => { AD_METRIC = key; renderAll(); });
      chips.appendChild(chip);
    });
    card.appendChild(chips);
    const shown = solid.slice().sort((a, b) => rate(b, AD_METRIC) - rate(a, AD_METRIC));
    if (shown.length) {
      const top = Math.max(...shown.map(row => rate(row, AD_METRIC))) || 1;
      const table = el('table', 'bars');
      shown.forEach(row => {
        const value = rate(row, AD_METRIC);
        // מספר הלידים בתווית, והכמות בלבד בסוף השורה — "35 מתוך 50"
        // נחתך בטלפון, שבו עמודת הערך צרה
        table.appendChild(barRow(`${adName(row)} (${n(row.leads)} לידים)`, value / top,
          value, n(row.counts[AD_METRIC] || 0), platformColor(row.platform)));
      });
      card.appendChild(table);
    }
    card.appendChild(el('div', 'tnote',
      `שיעור מתוך הלידים של כל מודעה. בגרף רק מודעות עם ${AD_MIN_LEADS} לידים ` +
      'ומעלה — במעט לידים מועמד אחד מזיז את השיעור בעשרות אחוזים. כל ' +
      'המודעות בטבלה שלמטה.'));
    bars.appendChild(card);
  }

  // --- הטבלה: המשפך של כל מודעה ---
  if (tableHost) {
    const table = el('table', 't');
    const head = el('tr');
    // פלטפורמה וקבוצה מוצגות רק כשיש בהן יותר מערך אחד — עמודה של
    // מקפים רק דוחקת את השיעורים אל מחוץ למסך
    (hasPlatform ? ['פלטפורמה'] : []).concat(hasGroup ? ['קבוצת מודעות'] : [])
      .concat(['מודעה', 'לידים'])
      .concat(steps.map(s => s.label))
      .concat(['פעילים', 'שיעור בדיקת קבצים', 'שיעור דפ"ר', 'שיעור גיוס'])
      .forEach(label => head.appendChild(el('th', null, label)));
    table.appendChild(head);
    list.forEach(row => {
      const tr = el('tr');
      if (row.leads < AD_MIN_LEADS) tr.style.opacity = '.62';
      if (hasPlatform) {
        const nameCell = el('td');
        const dot = el('span', 'cdot');
        dot.style.background = platformColor(row.platform);
        nameCell.appendChild(dot);
        nameCell.appendChild(document.createTextNode(row.platform));
        tr.appendChild(nameCell);
      }
      if (hasGroup) tr.appendChild(el('td', null, row.group));
      tr.appendChild(el('td', null, row.ad));
      tr.appendChild(el('td', 'num', n(row.leads)));
      steps.forEach(s => tr.appendChild(el('td', 'num', n(row.counts[s.key] || 0))));
      tr.appendChild(el('td', 'num', n(row.counts.active || 0)));
      ['files', 'dapar', 'recruited'].forEach(key =>
        tr.appendChild(el('td', 'num', pct(rate(row, key)))));
      table.appendChild(tr);
    });
    const card = el('div', 'card');
    const scroll = el('div', 'tscroll');
    scroll.appendChild(table);
    card.appendChild(scroll);
    card.appendChild(el('div', 'tnote',
      'כל שלב נספר מתוך הלידים של המודעה, כמו במשפך הקמפיין. "פעילים" — ' +
      `מאקסל "פעילים". שורה עמומה: פחות מ-${AD_MIN_LEADS} לידים. אין כאן עלות ` +
      'למודעה: דוחות המדיה הם ברמת הקמפיין.'));
    tableHost.appendChild(card);
  }
}

function renderAds() {
  const host = document.getElementById('cc-ads');
  if (!host) return;
  host.innerHTML = '';

  const platform = CC.data.facets.find(f => f.key === 'platform');
  if (!platform) { host.style.display = 'none'; return; }

  /* אין רכיב מודעה באף קוד בקמפיין הזה — למשל להב, שהקודים שלו הם
     "y105" / "yahbal" / "yalack" ואינם קודי מודעה.

     המקטע נשאר ואומר זאת במפורש. הסתרה שקטה הייתה נראית בדיוק כמו
     תקלה: המקטע התבקש, הכותרת שלו במסך, ותחתיה שום דבר בלי הסבר. */
  const ad = CC.data.facets.find(f => f.key === 'ad');
  if (!ad) {
    host.style.display = '';
    const card = el('div', 'card');
    card.appendChild(el('div', 'tnote',
      'בקמפיין הזה אין פירוט לרמת המודעה: אף קוד מקור בו אינו נושא ' +
      'רכיב מודעה. פירוט כזה נבנה כשהקוד מורכב משלושה רכיבים — ' +
      '"fb_HAP1_AD5" הוא פלטפורמה fb, קבוצת מודעות HAP1 ומודעה AD5. ' +
      'כאן הקוד הוא ערך אחד ("fb", "y105"), שמזהה את הפלטפורמה או את ' +
      'תת-הקמפיין ולא את המודעה שממנה הגיע המועמד.'));
    host.appendChild(card);
    return;
  }

  const group = CC.data.facets.find(f => f.key === 'adGroup');
  const sub = subFacet();
  const activeBits = flagBits('active');
  const recruitedBits = flagBits('recruited');

  const rows = new Map();
  for (const i of CC.rows) {
    const record = {
      sub: sub ? facetValue(sub, i) : '',
      platform: facetValue(platform, i),
      group: (group ? facetValue(group, i) : '') || '—',
      ad: facetValue(ad, i) || AD_NONE,
    };
    const key = JSON.stringify([record.sub, record.platform, record.group,
                                record.ad]);
    let acc = rows.get(key);
    if (!acc) {
      acc = Object.assign({ leads: 0, active: 0, recruited: 0 },
                          record);
      rows.set(key, acc);
    }
    acc.leads += 1;
    if (activeBits && activeBits[i]) acc.active += 1;
    if (recruitedBits && recruitedBits[i]) acc.recruited += 1;
  }

  const list = [...rows.values()].sort((a, b) => b.leads - a.leads);
  host.style.display = '';
  // הסינון הנוכחי השאיר רק מועמדים בלי רכיב מודעה. הטבלה עדיין
  // נבנית — שורת "ללא מודעה" היא נתון, וריקון המקטע במקומה היה
  // נראה כמו תקלה.
  if (!list.length) {
    const card = el('div', 'card');
    card.appendChild(el('div', 'tnote',
      'אין מועמדים בסינון הנוכחי.'));
    host.appendChild(card);
    return;
  }

  const total = list.reduce((acc, row) => acc + row.leads, 0);
  const table = el('table', 't');
  const head = el('tr');
  const headers = (sub ? ['תת קמפיין'] : [])
    .concat(['פלטפורמה', 'קבוצת מודעות', 'מודעה', 'לידים', 'חלק מהלידים',
             'פעילים', 'גויסו', 'שיעור פעילים']);
  headers.forEach(label => head.appendChild(el('th', null, label)));
  table.appendChild(head);

  list.forEach(row => {
    const tr = el('tr');
    if (sub) tr.appendChild(el('td', null, row.sub || '—'));
    const nameCell = el('td');
    const dot = el('span', 'cdot');
    dot.style.background = platformColor(row.platform);
    nameCell.appendChild(dot);
    nameCell.appendChild(document.createTextNode(row.platform));
    tr.appendChild(nameCell);
    tr.appendChild(el('td', null, row.group));
    tr.appendChild(el('td', null, row.ad));
    [n(row.leads), pct(total ? row.leads / total : null), n(row.active),
     n(row.recruited),
     pct(row.leads ? row.active / row.leads : null)]
      .forEach(text => tr.appendChild(el('td', 'num', text)));
    table.appendChild(tr);
  });

  const card = el('div', 'card');
  card.appendChild(table);
  const noAd = list.filter(row => row.ad === AD_NONE)
    .reduce((acc, row) => acc + row.leads, 0);
  card.appendChild(el('div', 'tnote',
    'המודעה נלקחת מהרכיב השלישי בקוד המקור ("fb_HAP1_AD5" — פלטפורמה fb, ' +
    'קבוצה HAP1, מודעה AD5). אין כאן תקציב ואין עלות לליד: דוחות המדיה ' +
    'הם ברמת הקמפיין ואין בהם שורה למודעה.' +
    (noAd ? ` ${n(noAd)} מועמדים נכנסו בקוד שאינו נושא רכיב מודעה, ` +
            'ומופיעים כ"ללא מודעה".' : '')));
  host.appendChild(card);
}

/* --- הערת הכלים: כמה הגיע מפימקס וכמה מחיפוש ---

   פימקס וחיפוש הם אותה שורה. הם רצים באותו קמפיין ובאותו תקציב,
   וכל המספרים בטבלת הפלטפורמות כוללים את שניהם יחד. מה שמוצג כאן
   הוא הערה בלבד — כמה מההמרות הגיעו מכל אחד — ולא טבלה שנייה
   שסופרת שוב את אותם מספרים.

   "כמה הגיע" הוא ההמרות שהפלטפורמה דיווחה עליהן. ליד בודד אינו
   ניתן לייחוס לפימקס או לחיפוש — בדוח הלידים הקוד הטכני הוא
   "Google" לשניהם. */

function renderMediaTools() {
  const host = document.getElementById('cc-media-tools');
  if (!host) return;
  host.innerHTML = '';

  // הכלים מפולחים בתוך תת-הקמפיין: מה שרץ בפימקס בסייר אינו מה
  // שרץ בפימקס בחוקר. כשתת-קמפיין נבחר מוצג רק שלו.
  const current = currentSub();
  let tools = CC.data.mediaTools || [];
  if (current !== SUB_ALL) tools = tools.filter(row => row.sub === current);
  if (!tools.length) { host.style.display = 'none'; return; }
  host.style.display = '';

  const nested = current === SUB_ALL && tools.some(row => row.sub);
  // שם תת-קמפיין מכיל רווחים ("חוקר רשת"), ולכן הקיבוץ נעשה על
  // מפתח שנבנה מרשימה ולא על מחרוזת מחוברת שצריך לפרק בחזרה
  const groups = new Map();
  tools.forEach(row => {
    const which = nested ? (row.sub || '') : '';
    const key = JSON.stringify([which, row.platform]);
    if (!groups.has(key)) {
      groups.set(key, { sub: which, platform: row.platform, rows: [] });
    }
    groups.get(key).rows.push(row);
  });
  const lines = [...groups.values()].map(group => {
    const which = group.sub, platform = group.platform;
    const parts = group.rows
      .map(row => `${row.tool} ${n(row.conversions)} (${pct(row.share)})`);
    const prefix = which ? `ב${platform} ב"${which}"` : `ב${platform}`;
    return `${prefix} — מתוך ההמרות שדווחו: ${parts.join(' · ')}.`;
  });

  const note = el('div', 'tnote');
  note.textContent = lines.join(' ') +
    ' הכלים רצים באותו קמפיין ובאותו תקציב, וכל המספרים בטבלה שמעל ' +
    'כוללים את כולם יחד.';
  host.appendChild(note);
}

/* ===== משפך המיון — צורת משפך ===== */

/* השלבים כפי שסוכמו: הגשות, יום מיון מקוון (דפ"ר), רמה, גיבושון, גיוס.
   מבחני אישיות אינם חלק מהמשפך הזה. */
/* צורת המשפך נגזרת מאותה רשימה שהשרת שולח (payload.funnel), ולא
   מרשימה שנייה שנכתבה כאן — שתי רשימות נפרדות לאותו משפך היו
   נפרדות בפועל: השרת הסיר "הגשות" ו"מבחני אישיות" והצורה המשיכה
   להראות אותם. */
function funnelSteps() {
  const steps = (CC.data.funnel || []).map(step => ({
    label: step.label,
    // "הגשות" אינו דגל — הוא כל השורות שבסינון
    value: (step.key === null || step.key === 'submitted') ? CC.rows.length
                                                             : countFlag(step.key),
  }));
  return steps;
}

// שבעה גוונים: עד שבעה שלבים במשפך (כולל "הפונו למחוז" בקמפיין עם רפרנטים)
const FUNNEL_COLORS = ['#0f2f66', '#123f7a', '#12608f', '#1191b5', '#3aa76d', '#8fc63f', '#f5c518'];

/* ===== המשפך המורחב — כל תחנה בהליך =====

   המשפך הרגיל מציג שישה שלבים והוא נשאר כפי שהוא, גם משום שהוא
   מה שמשווים בין קמפיינים. לצדו יושב כאן המשפך המלא: בדיקת
   קבצים, זימון למבחן מקוון, יום מיון מקוון, ראיון התאמה, תוצאת
   בדיקת רופא, מרכז הערכה/אישיות, זימון לגיוס וגיוס.

   הוא במסך הקמפיין בלבד. בלוח השנתי ובהשוואה בין קמפיינים דרושה
   אותה מידה בדיוק בכל הקמפיינים, ולקמפיין ישן פשוט אין את
   השלבים האלה — משפך שחציו אפסים אינו השוואה. */

/* כמה מהשורות המסוננות נושאות לפחות אחד מהדגלים.

   איחוד ולא סכום: "מרכז הערכה/אישיות" הוא שלב אחד משני מבדקים,
   ומי שעשה את שניהם נספר בו פעם אחת. סכימה של שני הדגלים הייתה
   סופרת אותו פעמיים ומייצרת שלב גדול מזה שמעליו. */
function countAnyFlag(keys) {
  const lists = (keys || []).map(flagBits).filter(Boolean);
  if (!lists.length) return 0;
  let sum = 0;
  for (const i of CC.rows) {
    for (const bits of lists) {
      if (bits[i]) { sum++; break; }
    }
  }
  return sum;
}

/* כמה עשו את הראשון ולא את השני — ההערה שליד "מרכז הערכה/אישיות" */
function countOnlyFirst(onlyKey, withoutKey) {
  const has = flagBits(onlyKey), lacks = flagBits(withoutKey);
  if (!has) return 0;
  let sum = 0;
  for (const i of CC.rows) if (has[i] && !(lacks && lacks[i])) sum++;
  return sum;
}

function fullFunnelSteps() {
  const stages = CC.data.funnelFull || [];
  if (!stages.length) return [];
  return stages.map(stage => {
    let value;
    if (stage.key === 'submitted') value = CC.rows.length;
    else if (stage.key === 'recruited') value = countFlag('recruited');
    else value = countAnyFlag(stage.flags);
    return { key: stage.key, label: stage.label, value: value };
  });
}

function renderFunnelFull() {
  const host = document.getElementById('cc-funnel-full');
  if (!host) return;
  host.innerHTML = '';

  const steps = fullFunnelSteps();
  if (!steps.length) return;

  /* שלב בלי אף רשומה יורד מהתצוגה.

     כל עוד דוח הפעולות אינו מכיל את הפעילות החדשה, השלב שלה ריק —
     ושורה של אפס בתוך משפך אינה אומרת "אף אחד לא עבר" אלא
     "הנתון עוד לא הגיע". שתי השורות שתמיד נשארות הן ההגשות
     והגיוס, שאינן תלויות בדוח הפעולות. */
  const shown = steps.filter(step => step.value > 0
                             || step.key === 'submitted'
                             || step.key === 'recruited');
  const missing = steps.filter(step => !shown.includes(step));

  const leads = CC.rows.length;
  const card = el('div', 'card barcard');
  card.appendChild(el('div', 'bartitle', 'משפך ההליך המלא'));

  const table = el('table', 't');
  const head = el('tr');
  ['שלב', 'הגיעו', 'שיעור מכלל המגישים', 'שיעור מהשלב הקודם']
    .forEach(label => head.appendChild(el('th', null, label)));
  table.appendChild(head);

  const split = CC.data.funnelSplit || {};
  let previous = null;

  shown.forEach((step, index) => {
    const tr = el('tr');

    const name = el('td');
    const swatch = el('span', 'swatch');
    swatch.style.background = FUNNEL_COLORS[index % FUNNEL_COLORS.length];
    name.appendChild(swatch);
    name.appendChild(el('span', null, step.label));

    // ההערה שליד "מרכז הערכה/אישיות": כמה מתוכם היו רק במרכז
    // ההערכה. זה פיצול בתוך השלב, ולא שלב בפני עצמו.
    if (step.key === split.stage && step.value) {
      const only = countOnlyFirst(split.only, split.without);
      const note = el('span', 'substep');
      note.textContent = ` · ${split.label}: ${n(only)} (${pct(only / step.value)})`;
      name.appendChild(note);
    }
    tr.appendChild(name);

    tr.appendChild(el('td', 'num', n(step.value)));
    tr.appendChild(el('td', 'num', leads ? pct(step.value / leads) : '—'));
    tr.appendChild(el('td', 'num',
      previous === null ? '—' : (previous ? pct(step.value / previous) : '—')));

    table.appendChild(tr);
    previous = step.value;
  });

  card.appendChild(table);

  let note = 'כל תחנה בהליך, לפי סדר ההתרחשות. "שיעור מהשלב הקודם" ' +
    'הוא אחוז ההמרה בין שתי שורות סמוכות. המשפך מגיב למסננים, ' +
    'ומוצג במסך הקמפיין בלבד — בלוח השנתי ובהשוואה נשאר המשפך הרגיל.';
  if (missing.length) {
    note += ' שלבים שאין להם עדיין נתונים בדוח הפעולות אינם מוצגים: ' +
      missing.map(step => step.label).join(', ') + '.';
  }
  card.appendChild(el('div', 'tnote', note));
  host.appendChild(card);
}

function renderFunnelShape() {
  const host = document.getElementById('cc-funnel-shape');
  if (!host) return;
  host.innerHTML = '';

  const steps = funnelSteps();
  if (!steps.length) return;

  /* בטלפון הכרטיס צר (~340px), ו-viewBox של 860 היה מקטין את הכול פי
     2.5 — גם את האחוזים. במסך צר המשפך מצויר ב-560, ואותם גופנים יוצאים
     גדולים יותר. */
  const narrow = (host.clientWidth || 800) < 600;
  const width = narrow ? 560 : 860, bandHeight = 62, gap = 3;
  const height = steps.length * (bandHeight + gap) + 24;
  const topHalf = width * (narrow ? 0.36 : 0.38);   // חצי הרוחב בראש המשפך
  const bottomHalf = width * 0.04;                   // חצי הרוחב בקצה התחתון
  /* המשפך זז מעט שמאלה כדי לפנות מקום לאחוזים מימין. האחוזים צמודים
     לשולי המשפך ויושבים בדיוק על הקו שבין שני שלבים (ראו funnelRates). */
  const cx = width / 2 - (narrow ? 50 : 60);

  const halfAt = index => topHalf - (topHalf - bottomHalf) * (index / steps.length);
  const topOf = index => 12 + index * (bandHeight + gap);

  const parts = [`<svg class="funnelsvg" viewBox="0 0 ${width} ${height}">`];

  steps.forEach((step, index) => {
    const top = topOf(index);
    const bottom = top + bandHeight;
    const halfTop = halfAt(index), halfBottom = halfAt(index + 1);
    const points = [
      [cx - halfTop, top], [cx + halfTop, top],
      [cx + halfBottom, bottom], [cx - halfBottom, bottom],
    ].map(point => point.map(v => v.toFixed(1)).join(',')).join(' ');

    parts.push(`<polygon points="${points}" fill="${FUNNEL_COLORS[index % FUNNEL_COLORS.length]}"/>`);

    const middle = top + bandHeight / 2;
    /* המשפך מוצג בחצי רוחב, כך שה-viewBox מוקטן בערך פי שניים — הגופנים
       כאן גדולים בהתאם, כדי שייצאו ~11-12px על המסך. בשלב צר מדי לתווית
       הטקסט עובר לצבע הדיו של העמוד: לבן מודגש שגולש מהמשפך נבלע ברקע
       הבהיר-כהה שבשוליו. */
    const fits = fitsInBand(step.label, 22, halfTop + halfBottom);
    parts.push(`<text x="${cx}" y="${(middle - 4).toFixed(1)}" text-anchor="middle" ` +
               `style="fill:${fits ? '#fff' : 'var(--ink)'};font-size:22px;font-weight:700">` +
               `${step.label}</text>`);
    parts.push(`<text x="${cx}" y="${(middle + 20).toFixed(1)}" text-anchor="middle" ` +
               `style="fill:${fits ? '#eaf2ff' : 'var(--ink)'};font-size:19px;font-weight:600">` +
               `${n(step.value)}</text>`);
  });

  parts.push(funnelRates(steps, {
    edgeAt: index => cx + halfAt(index),
    lineAt: index => topOf(index) - gap / 2,
    size: 22, color: 'var(--accent)',
  }));
  parts.push('</svg>');

  const card = el('div', 'card funnelcard');
  const holder = el('div');
  holder.innerHTML = parts.join('');
  card.appendChild(holder);
  card.appendChild(el('div', 'tnote',
    'האחוז שעל הקו בין שני שלבים הוא שיעור המעבר: כמה מהשלב שמעל הקו ' +
    'הגיעו לשלב שמתחתיו. המשפך מגיב למסננים.'));
  host.appendChild(card);
}

/* אחוזי המעבר של משפך — אחד על כל קו שבין שני שלבים (05/10/2026).

   האחוז יושב בדיוק בגובה הקו שבין השלב שמעליו לשלב שמתחתיו, צמוד
   לשולי המשפך באותו גובה, ומחובר אליהם בקו קצר. כך ברור בין איזה
   שלבים הוא, והוא נשאר קרוב למשפך גם בטלפון — טור קבוע בקצה הכרטיס
   התרחק מהמשפך ככל שזה הצטמצם, ולא היה ברור לאיזה שלב הוא שייך.

   הכיוון מפורש (direction="ltr" ועיגון לשמאל), כדי שהטקסט ייפתח
   החוצה מהמשפך גם בעמוד שכיוונו מימין לשמאל. */
function funnelRates(steps, geo) {
  const out = [];
  const size = geo.size;
  for (let index = 1; index < steps.length; index++) {
    const previous = steps[index - 1].value;
    const text = previous ? '↓ ' + pct(steps[index].value / previous) : '↓ —';
    const y = geo.lineAt(index);
    const edge = geo.edgeAt(index);
    const pillW = text.length * size * 0.56 + size * 0.9;
    const pillH = size * 1.45;
    const x = edge + size * 0.7;
    out.push(`<line x1="${(edge + 2).toFixed(1)}" y1="${y.toFixed(1)}" ` +
             `x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${geo.color}" ` +
             `stroke-width="${(size / 11).toFixed(1)}"/>`);
    out.push(`<rect x="${x.toFixed(1)}" y="${(y - pillH / 2).toFixed(1)}" ` +
             `width="${pillW.toFixed(1)}" height="${pillH.toFixed(1)}" ` +
             `rx="${(pillH / 2).toFixed(1)}" fill="var(--panel-soft)" ` +
             `stroke="${geo.color}" stroke-width="${(size / 14).toFixed(1)}"/>`);
    out.push(`<text x="${(x + pillW / 2).toFixed(1)}" y="${(y + size * 0.36).toFixed(1)}" ` +
             `text-anchor="middle" direction="ltr" style="fill:${geo.color};` +
             `font-size:${size}px;font-weight:700">${text}</text>`);
  }
  return out.join('');
}

/* ===== שיעורי המרה בין השלבים ===== */

function renderConversion() {
  const host = document.getElementById('cc-conversion');
  if (!host) return;
  host.innerHTML = '';

  const leads = CC.rows.length;
  // אותם שלבים של המשפך, באותו סדר. קודם לכן הייתה כאן רשימה
  // שנייה משלה, ובה גם "מבחני אישיות" — מבדק צדדי שאינו תחנה
  // בדרך לגיוס. הצבתו בטור ייצרה שיעורי מעבר של 190%, שאינם
  // מעבר בין שלבים אלא סימן ששני השלבים אינם על אותו ציר.
  // הטבלה מתחילה מההגשות (previous = leads), ולכן "הגשות" אינו שורה בה
  const steps = (CC.data.funnel || []).filter(step => step.key
                                               && step.key !== 'active'
                                               && step.key !== 'submitted');

  const table = el('table', 't');
  const head = el('tr');
  ['שלב', 'ביצעו', 'שיעור מכלל המגישים', 'שיעור מהשלב הקודם', 'זמן ממוצע מההגשה']
    .forEach(label => head.appendChild(el('th', null, label)));
  table.appendChild(head);

  // מפתח הדגל ➜ מפתח המשך, לעמודת "זמן ממוצע מההגשה"
  const durations = { files: 'קבצים', summonMiyun: 'זימון מיון',
                      interview: 'רמה', dapar: 'דפר', personality: 'אישיות',
                      assessment: 'מרכז הערכה', recruited: 'גיוס' };
  let previous = leads;

  steps.forEach(step => {
    const value = countFlag(step.key);
    const tr = el('tr');
    tr.appendChild(el('td', null, step.label));
    tr.appendChild(el('td', 'num', n(value)));
    tr.appendChild(el('td', 'num', leads ? pct(value / leads) : '—'));
    tr.appendChild(el('td', 'num', previous ? pct(value / previous) : '—'));
    // הזמן הממוצע חייב להימדד על אותם מועמדים שנספרו בשורה. עבור
    // הגיוס אלה 29 הגיוסים שבחלון, ולא כל 48 — אחרת אותו מסך היה
    // מציג "29 גיוסים, ממוצע 112 יום" כשהתקרה היא 120.
    const key = durations[step.key];
    const average = step.key === 'recruited'
      ? averageRecruitDays(recruitedRows())
      : (key ? averageDuration(key) : null);
    tr.appendChild(el('td', 'num', average === null ? '—' : Math.round(average) + ' ימים'));
    table.appendChild(tr);
    if (value) previous = value;
  });

  const card = el('div', 'card');
  card.appendChild(table);
  card.appendChild(el('div', 'tnote',
    'שיעור מהשלב הקודם מחושב מול השלב האחרון שנספרו בו מועמדים. ' +
    'שיעור מעל 100% אומר שהשלב אינו תת-קבוצה של קודמו — מועמד יכול ' +
    'לעשות דפ"ר בלי ראיון התאמה.'));
  host.appendChild(card);
}

/* ===== טבלת שלב בהליך ===== */

/* טבלת "שלב בהליך — פירוט".

   השלב מגיע מאקסל "פעילים" ("תהליך נוכחי"), ולכן כל מי שבטבלה הוא
   פעיל, וסך הטבלה הוא בדיוק מספר הפעילים — שדה פעילות אחד בכל המערכת
   (05/10/2026). עד אז הייתה כאן עמודת "מתוכם בהליך" לפי חלונות זמן, ושלב
   שאין לו שם תצוגה ("טפסים מקוונים") הושמט — שני ערכים נוספים לפעילים.

   שמות התצוגה ("בבחינה", "יחב"מ" וכו') וסדר השורות מגיעים מההגדרות
   (payload.stageDisplay). שלב שאין לו שם תצוגה מוצג בשמו הגולמי, בסוף. */
function renderStageTable() {
  const host = document.getElementById('cc-stage-table');
  if (!host) return;
  host.innerHTML = '';

  const facet = CC.data.facets.find(f => f.key === 'stage');
  if (!facet) return;

  const display = (CC.data.stageDisplay && CC.data.stageDisplay.map) || {};
  const order = (CC.data.stageDisplay && CC.data.stageDisplay.order) || [];
  const activeBits = flagBits('active');

  // צבירה לפי שם התצוגה, כך ששני שלבים שממופים לאותו שם מתאחדים
  const buckets = new Map();
  for (const i of CC.rows) {
    if (!activeBits || !activeBits[i]) continue;
    const code = facet.codes[i];
    const stage = code < 0 ? 'ללא שלב' : facet.values[code];
    const label = display[stage] || stage;
    const bucket = buckets.get(label) || { label, count: 0 };
    bucket.count += 1;
    buckets.set(label, bucket);
  }

  const known = order.filter(label => buckets.has(label));
  const rest = [...buckets.keys()].filter(label => !known.includes(label))
    .sort((a, b) => buckets.get(b).count - buckets.get(a).count);
  const rows = known.concat(rest).map(label => buckets.get(label));
  if (!rows.length) {
    host.appendChild(el('div', 'card', 'אין מועמדים פעילים בסינון הנוכחי.'));
    return;
  }

  const total = rows.reduce((acc, r) => acc + r.count, 0);

  const table = el('table', 't');
  const head = el('tr');
  ['שלב', 'פעילים', 'שיעור']
    .forEach(label => head.appendChild(el('th', null, label)));
  table.appendChild(head);

  rows.forEach(row => {
    const tr = el('tr');
    tr.appendChild(el('td', null, row.label));
    tr.appendChild(el('td', 'num', n(row.count)));
    tr.appendChild(el('td', 'num', pct(row.count / total)));
    table.appendChild(tr);
  });

  const totalRow = el('tr');
  const label = el('td', null, 'סה"כ פעילים');
  label.style.fontWeight = '700';
  totalRow.appendChild(label);
  totalRow.appendChild(el('td', 'num', n(total)));
  totalRow.appendChild(el('td', 'num', '100.0%'));
  table.appendChild(totalRow);

  const card = el('div', 'card');
  card.appendChild(table);
  card.appendChild(el('div', 'tnote',
    'השלב והפעילות מגיעים מאקסל "פעילים" בלבד: כל מי שמופיע בו נספר כאן, ' +
    'לפי השלב שרשום לו שם.'));
  host.appendChild(card);
}

/* --- זמן עד גיוס (סעיף 6) --- */

/* עוגה אחת, בדיוק כמו בפרופיל הדמוגרפי: אחוז בתוך הפרוסה, מקרא
   עם הכמויות מתחת. הקבוצות מגיעות מוכנות מהשרת ובסדר שנקבע שם,
   ולכן "עד 30 יום" תמיד ראשון ולא נגרר לפי גודלו. */
function renderRecruitTime() {
  const host = document.getElementById('cc-recruit-time');
  if (!host) return;
  host.innerHTML = '';

  // אין קבוצות זמן כשאין תאריך גיוס בדוח. זו אינה תקלה בתצוגה
  // אלא שדה חסר בקלט, ולכן נאמר במפורש במקום להשאיר מקטע ריק.
  const facet = CC.data.facets.find(f => f.key === 'recruitTime');
  if (!facet) {
    host.appendChild(el('div', 'card',
      'אין "תאריך גיוס" בדוח הגיוסים שנטען, ולכן לא ניתן לחשב זמן עד גיוס.'));
    return;
  }

  const rows = recruitedRows();
  const counts = new Array(facet.values.length).fill(0);
  rows.forEach(index => {
    const code = facet.codes[index];
    if (code >= 0) counts[code] += 1;
  });

  // סדר הקבוצות הוא סדר הזמן, ולא סדר הגודל
  const pairs = facet.values
    .map((value, index) => ({ value, count: counts[index] }))
    .filter(pair => pair.count > 0 && !isEmptyValue(pair.value))
    .sort((a, b) => parseInt(a.value, 10) - parseInt(b.value, 10));

  if (!pairs.length) {
    host.appendChild(el('div', 'card',
      'אין גיוסים בסינון הנוכחי, ולכן אין זמן עד גיוס להצגה.'));
    return;
  }

  const total = pairs.reduce((acc, p) => acc + p.count, 0);
  const card = el('div', 'card piecard');
  card.appendChild(el('div', 'bartitle', 'זמן עד גיוס'));

  const holder = el('div');
  holder.innerHTML = pieSvg(pairs, 180);
  card.appendChild(holder);

  // המקרא מציג את כל ארבע הקבוצות, גם ריקה. "אף אחד לא גויס תוך
  // 30 יום" הוא ממצא, ולא שורה שצריכה להיעלם מהמקרא.
  const legend = el('div', 'pielegend');
  const shown = new Map(pairs.map((pair, index) => [pair.value, index]));
  // הרשימה המלאה מגיעה מהשרת ולא מהערכים שנמצאו בנתונים — אחרת
  // קבוצה שאין בה אף גיוס פשוט לא הייתה קיימת מבחינת המקרא.
  const all = CC.data.recruitTimeBuckets
    || facet.values.filter(value => !isEmptyValue(value));

  all.forEach(value => {
    const index = shown.has(value) ? shown.get(value) : -1;
    const count = index >= 0 ? pairs[index].count : 0;
    const row = el('div', count ? null : 'off');
    const swatch = el('span', 'swatch');
    swatch.style.background = index >= 0 ? seriesColor(index) : 'transparent';
    swatch.style.border = index >= 0 ? '' : '1px dashed #55688f';
    row.appendChild(swatch);
    row.appendChild(el('span', null, value));
    row.appendChild(el('span', 'pv', n(count)));
    legend.appendChild(row);
  });
  card.appendChild(legend);
  card.appendChild(el('div', 'emptynote',
    `${n(total)} גיוסים מהקמפיין. הזמן נמדד מיום ההגשה ליום הגיוס, ` +
    `ומעל ${n(CC.data.recruitWindowDays || 120)} יום הגיוס אינו מיוחס לקמפיין.`));
  host.appendChild(card);
}

/* ===== סיבת סטטוס למועמדות ===== */

/* הסיבה מגיעה מדוח הלידים, מהעמודה "סיבת סטאטוס למועמדות". היא
   ההסבר היחיד לכך שמועמדות נעצרה: בקמפיין ינואר 4,383 מתוך 4,389
   המגישים מסומנים "הפסקת הליך", והסטטוס לבדו אינו מלמד דבר.

   הערך הריק אינו סיבה. הוא יורד מהגרף ומהאחוזים, וכמותו נרשמת
   בנפרד — בדיוק כמו בגרפי הפרופיל. */

const REASON_CROSS_ROWS = 12;

/* שתי סיבות אינן הפסקת הליך: "הקצאה לתפקיד אחר" ו"אין מה להציע-
   מומלץ לבחינה נוספת". באלה המועמד לא נעצר — הוא הופנה למקום אחר
   או הומלץ להמשך בדיקה — ולכן הם יוצאים מהמסך הזה לגמרי, ולא
   מוצגים כפרוסה קטנה בשוליים. הרשימה מגיעה מהשרת. */
function excludedReasons() {
  return new Set(((CC.data.reason || {}).exclude) || []);
}

function reasonBreakdown() {
  const facet = CC.data.facets.find(f => f.key === 'statusReason');
  if (!facet) return null;
  const counts = facetCounts(facet);
  const skip = excludedReasons();

  const present = facet.values
    .map((value, index) => ({ value, count: counts[index], index }))
    .filter(pair => pair.count > 0)
    .sort((a, b) => b.count - a.count);

  const split = splitEmpty(present);
  const pairs = split.real.filter(pair => !skip.has(pair.value));
  const excluded = split.real.filter(pair => skip.has(pair.value));
  const total = pairs.reduce((acc, p) => acc + p.count, 0);

  return {
    facet, pairs, total,
    missing: split.missing,
    excluded,
    excludedCount: excluded.reduce((acc, p) => acc + p.count, 0),
  };
}

/* הסיבות המרכזיות: כל סיבה שמעל סף השכיחות מקבלת פרוסה משלה,
   וכל השאר מתקבצות ל"סיבות נוספות". בלי זה העוגה מקבלת 38
   פרוסות, ורובן דקות מכדי להיראות. */
function renderReasonPie(host, data) {
  const rule = CC.data.reason || {};
  const minShare = rule.minShare || 0.05;
  const otherLabel = rule.otherLabel || 'סיבות נוספות';

  const major = data.pairs.filter(p => p.count / data.total >= minShare);
  const minor = data.pairs.filter(p => p.count / data.total < minShare);
  const rest = minor.reduce((acc, p) => acc + p.count, 0);

  const slices = major.map(p => ({ value: p.value, count: p.count }));
  if (rest) slices.push({ value: otherLabel, count: rest });
  if (!slices.length) return;

  // "סיבות נוספות" מקבל אפור: הוא אינו סיבה אלא סל, ואסור לו
  // להיראות כמו קטגוריה שווה לשאר.
  const OTHER_COLOR = '#7d8ba6';
  const colors = slices.map(function (slice, index) {
    return slice.value === otherLabel ? OTHER_COLOR : seriesColor(index);
  });

  // הכרטיס תופס חצי שורה בלבד, בצד ימין. בחציה השני יושבת
  // תמונת המצב הכללית — ראו renderOutcomeCard.
  const card = el('div', 'card piecard piecard--half');
  card.appendChild(el('div', 'bartitle', 'הסיבות המרכזיות'));

  const row = el('div', 'piesplit');

  const holder = el('div', 'piesplit-chart');
  holder.innerHTML = pieSvg(slices, 172, (_v, index) => colors[index]);
  row.appendChild(holder);

  const legend = el('div', 'pielegend piesplit-legend');
  slices.forEach((slice, index) => {
    const line = el('div');
    const swatch = el('span', 'swatch');
    swatch.style.background = colors[index];
    line.appendChild(swatch);
    line.appendChild(el('span', 'plabel', slice.value));
    line.appendChild(el('span', 'pv', pct(slice.count / data.total)));
    line.appendChild(el('span', 'pn', n(slice.count)));
    legend.appendChild(line);
  });
  row.appendChild(legend);
  card.appendChild(row);

  card.appendChild(el('div', 'emptynote',
    `כל סיבה שמעל ${pct(minShare)} מוצגת בנפרד; ` +
    (rest
      ? `${n(minor.length)} סיבות מקובצות ל"סיבות נוספות".`
      : 'אין סיבות מתחת לסף.')));
  host.appendChild(card);

  renderOutcomeCard(host, data);
}

/* מה עלה בגורל ההגשות — הכרטיס שיושב לצד עוגת הסיבות.

   העוגה עונה על "למה נעצרו". הכרטיס הזה עונה על "כמה בכלל
   נעצרו", ומראה את אותו חשבון שמופיע בכותרת: הגשות פחות מי
   שפעיל (אקסל "פעילים") ופחות מי שגויס. שניהם מדברים על אותו קהל,
   ולכן הם יושבים זה לצד זה. מי שגם פעיל וגם גויס נספר פעם אחת, בגיוס. */
const OUTCOME_COLORS = {
  'הופסק הליכם': '#f97362',
  'לא הופסק הליכם': '#e0a44a',
  'גויסו': '#22c39a',
  'פעילים': '#4F8EF7',
};

/* פעילים שלא גויסו, וגיוסים — בלי לספור פעמיים מי שגם וגם */
function activeAndRecruited() {
  const recruited = countFlag('recruited');
  const either = countAnyFlag(['active', 'recruited']);
  return { active: Math.max(0, either - recruited), recruited, either };
}

function renderOutcomeCard(host, data) {
  const rows = CC.rows.length;
  if (!rows) return;

  const { active, recruited, either } = activeAndRecruited();
  const stopped = Math.max(0, rows - either);
  const excluded = Math.min(data.excludedCount, stopped);

  const parts = [
    { value: 'הופסק הליכם', count: stopped - excluded },
    { value: 'לא הופסק הליכם', count: excluded },
    { value: 'גויסו', count: recruited },
    { value: 'פעילים', count: active },
  ].filter(part => part.count > 0);
  if (!parts.length) return;

  const card = el('div', 'card piecard piecard--half');
  card.appendChild(el('div', 'bartitle', 'מה עלה בגורל ההגשות'));

  const row = el('div', 'piesplit');
  const holder = el('div', 'piesplit-chart');
  holder.innerHTML = pieSvg(parts, 172, value => OUTCOME_COLORS[value]);
  row.appendChild(holder);

  const legend = el('div', 'pielegend piesplit-legend');
  parts.forEach(part => {
    const line = el('div');
    const swatch = el('span', 'swatch');
    swatch.style.background = OUTCOME_COLORS[part.value];
    line.appendChild(swatch);
    line.appendChild(el('span', 'plabel', part.value));
    line.appendChild(el('span', 'pv', pct(part.count / rows)));
    line.appendChild(el('span', 'pn', n(part.count)));
    legend.appendChild(line);
  });
  row.appendChild(legend);
  card.appendChild(row);

  card.appendChild(el('div', 'emptynote',
    `מתוך ${n(rows)} הגשות בסינון הנוכחי. "לא הופסק הליכם" — ` +
    'הוקצו לתפקיד אחר או הומלצו לבחינה נוספת.'));
  host.appendChild(card);
}

function renderStatusReason() {
  const kpis = document.getElementById('cc-reason-kpis');
  const pie = document.getElementById('cc-reason-pie');
  const chart = document.getElementById('cc-reason-chart');
  const tableHost = document.getElementById('cc-reason-table');
  const cross = document.getElementById('cc-reason-cross');
  if (!kpis && !pie && !chart && !tableHost && !cross) return;

  [kpis, pie, chart, tableHost, cross].forEach(node => {
    if (node) node.innerHTML = '';
  });

  const data = reasonBreakdown();
  if (!data) {
    if (chart) {
      chart.appendChild(el('div', 'card',
        'העמודה "סיבת סטאטוס למועמדות" אינה בדוח הלידים שנטען.'));
    }
    return;
  }

  const { facet, pairs, missing, total, excludedCount } = data;
  const rows = CC.rows.length;

  if (kpis) {
    // כמה הפסקות הליך יש באמת: הגשות פחות מי שפעיל ופחות
    // מי שגויס. זה המספר הנכון, והוא אינו תלוי בעמודת הסיבה —
    // שיש בה חוסר. הפער בינו לבין מי שיש לו סיבה רשומה הוא
    // בדיוק גודל החוסר, והוא מוצג במפורש ולא נבלע.
    const { active, recruited, either } = activeAndRecruited();
    const stopped = Math.max(0, rows - either);
    const unexplained = Math.max(0, stopped - total - excludedCount);

    kpis.appendChild(tile(n(stopped), 'הפסקות הליך',
                          `${n(rows)} הגשות − ${n(active)} פעילים − ` +
                          `${n(recruited)} גיוסים`, true));
    kpis.appendChild(tile(n(total), 'מתוכם עם סיבה רשומה',
                          stopped ? pct(total / stopped) + ' מההפסקות' : ''));
    if (unexplained) {
      kpis.appendChild(tile(n(unexplained), 'ללא סיבה בעמודה',
                            'חוסר בעמודת "סיבת סטאטוס למועמדות"'));
    }
    kpis.appendChild(tile(n(pairs.length), 'סיבות שונות'));
    if (pairs.length) {
      kpis.appendChild(tile(pairs[0].value, 'הסיבה השכיחה',
                            `${n(pairs[0].count)} מועמדים · ` +
                            pct(pairs[0].count / total)));
      const top3 = pairs.slice(0, 3).reduce((acc, p) => acc + p.count, 0);
      kpis.appendChild(tile(pct(top3 / total), 'שיעור שלוש הסיבות המובילות',
                            'מתוך בעלי סיבה רשומה'));
    }
    // מי שלא נעצר אינו "חסר סיבה" ואינו "הופסק" — קטגוריה שלישית
    if (excludedCount) {
      kpis.appendChild(tile(n(excludedCount), 'לא הופסק הליכם',
                            'הוקצו לתפקיד אחר או הומלצו לבחינה נוספת'));
    }
  }

  if (pie && pairs.length) renderReasonPie(pie, data);

  if (chart && pairs.length) {
    chart.appendChild(barCard(facet.label, pairs, facet.key));
  }

  if (tableHost && pairs.length) {
    const table = el('table', 't');
    const head = el('tr');
    ['סיבה', 'כמות', 'שיעור', 'שיעור מצטבר']
      .forEach(label => head.appendChild(el('th', null, label)));
    table.appendChild(head);

    let running = 0;
    pairs.forEach(pair => {
      running += pair.count;
      const tr = el('tr');
      tr.appendChild(el('td', null, pair.value));
      tr.appendChild(el('td', 'num', n(pair.count)));
      tr.appendChild(el('td', 'num', pct(pair.count / total)));
      tr.appendChild(el('td', 'num', pct(running / total)));
      table.appendChild(tr);
    });

    const totalRow = el('tr');
    const label = el('td', null, 'סה"כ עם סיבה');
    label.style.fontWeight = '700';
    totalRow.appendChild(label);
    totalRow.appendChild(el('td', 'num', n(total)));
    totalRow.appendChild(el('td', 'num', '100.0%'));
    totalRow.appendChild(el('td', 'num', ''));
    table.appendChild(totalRow);

    const card = el('div', 'card');
    card.appendChild(table);
    const notes = ['השיעור המצטבר מראה כמה מהמועמדויות מוסברות בסיבות ' +
                   'שעד אותה שורה.'];
    if (missing) {
      notes.push(`${n(missing)} מועמדים ללא סיבה רשומה אינם נספרים כאן.`);
    }
    if (excludedCount) {
      notes.push(`${n(excludedCount)} מועמדים אינם בטבלה כלל: ` +
                 (data.excluded.map(p => `${p.value} (${n(p.count)})`).join(', ')) +
                 ' — אלה אינם הפסקת הליך.');
    }
    card.appendChild(el('div', 'tnote', notes.join(' ')));
    tableHost.appendChild(card);
  }

  if (cross) renderReasonByPlatform(cross, data);
}

/* חוצה סיבה × פלטפורמה: איזו סיבה בולטת בכל ערוץ. השורות הן
   הסיבות המובילות, והאחוז בכל תא הוא מתוך אותה פלטפורמה — כך
   ניתן להשוות בין ערוצים בגדלים שונים. */
function renderReasonByPlatform(host, data) {
  const platform = CC.data.facets.find(f => f.key === 'platform');
  if (!platform || !data.pairs.length) return;

  const columns = [];
  const platformCounts = facetCounts(platform);
  platform.values.forEach((value, index) => {
    if (platformCounts[index] > 0) columns.push({ value, index });
  });
  if (columns.length < 2) return;

  const shown = data.pairs.slice(0, REASON_CROSS_ROWS);
  const rowOf = {}, colOf = {};
  shown.forEach((pair, position) => { rowOf[pair.index] = position; });
  columns.forEach((column, position) => { colOf[column.index] = position; });

  const grid = shown.map(() => new Array(columns.length).fill(0));
  const columnTotals = new Array(columns.length).fill(0);

  for (const i of CC.rows) {
    const column = colOf[platform.codes[i]];
    if (column === undefined) continue;
    columnTotals[column]++;
    const row = rowOf[data.facet.codes[i]];
    if (row !== undefined) grid[row][column]++;
  }

  const table = el('table', 't');
  const head = el('tr');
  head.appendChild(el('th', null, 'סיבה'));
  columns.forEach(column => head.appendChild(el('th', null, column.value)));
  head.appendChild(el('th', null, 'סה"כ'));
  table.appendChild(head);

  shown.forEach((pair, row) => {
    const tr = el('tr');
    tr.appendChild(el('td', null, pair.value));
    columns.forEach((column, index) => {
      const value = grid[row][index];
      const share = columnTotals[index] ? value / columnTotals[index] : 0;
      tr.appendChild(el('td', 'num',
        value ? `${n(value)} (${pct(share)})` : '—'));
    });
    tr.appendChild(el('td', 'num', n(pair.count)));
    table.appendChild(tr);
  });

  const totalRow = el('tr');
  const label = el('td', null, 'כלל המועמדים בפלטפורמה');
  label.style.fontWeight = '700';
  totalRow.appendChild(label);
  columnTotals.forEach(value => totalRow.appendChild(el('td', 'num', n(value))));
  totalRow.appendChild(el('td', 'num', n(CC.rows.length)));
  table.appendChild(totalRow);

  const card = el('div', 'card');
  card.appendChild(table);
  card.appendChild(el('div', 'tnote',
    'האחוז בכל תא הוא מתוך כלל המועמדים באותה פלטפורמה, ולכן הוא ' +
    'בר-השוואה בין ערוצים בגדלים שונים.'));
  host.appendChild(card);
}

/* ===== גרפי עוגה ===== */

function pieSvg(pairs, size, paint) {
  const radius = size / 2 - 2;
  const cx = size / 2, cy = size / 2;
  const total = pairs.reduce((acc, p) => acc + p.count, 0);
  if (!total) return '';

  const parts = [`<svg viewBox="0 0 ${size} ${size}" style="width:${size}px;max-width:100%">`];
  let angle = -Math.PI / 2;

  pairs.forEach((pair, index) => {
    const slice = (pair.count / total) * Math.PI * 2;
    const end = angle + slice;
    const large = slice > Math.PI ? 1 : 0;
    const x1 = cx + radius * Math.cos(angle), y1 = cy + radius * Math.sin(angle);
    const x2 = cx + radius * Math.cos(end),   y2 = cy + radius * Math.sin(end);
    // פרוסה יחידה: עיגול מלא, כי קשת של 360 מעלות מתנוונת לנקודה
    const d = pairs.length === 1
      ? `M${cx},${cy - radius} A${radius},${radius} 0 1 1 ${cx - 0.01},${cy - radius} Z`
      : `M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} ` +
        `A${radius},${radius} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`;
    const fill = paint ? paint(pair.value, index) : seriesColor(index);
    parts.push(`<path d="${d}" fill="${fill}" stroke="#0f1729" stroke-width="1.5"/>`);

    // האחוז נכתב בתוך הפרוסה עצמה, אם היא רחבה מספיק כדי להכיל אותו
    const share = pair.count / total;
    if (share >= 0.05) {
      const middle = angle + slice / 2;
      const labelRadius = radius * 0.62;
      const lx = cx + labelRadius * Math.cos(middle);
      const ly = cy + labelRadius * Math.sin(middle);
      parts.push(`<text x="${lx.toFixed(1)}" y="${(ly + 4.5).toFixed(1)}" ` +
                 `text-anchor="middle" style="fill:#fff;font-size:12px;` +
                 `font-weight:700;paint-order:stroke;stroke:rgba(15,23,41,.6);` +
                 `stroke-width:2.6px">${pct(share)}</text>`);
    }
    angle = end;
  });

  parts.push('</svg>');
  return parts.join('');
}

function renderPies() {
  ['cc-pies', 'cc-pies-2'].forEach(hostId => {
    const host = document.getElementById(hostId);
    if (!host) return;
    host.innerHTML = '';

    const keys = host.dataset.dims ? host.dataset.dims.split(',') : [];
    keys.forEach(key => {
      const facet = CC.data.facets.find(f => f.key === key);
      if (!facet) return;

      const counts = facetCounts(facet);
      const all = facet.values
        .map((value, index) => ({ value, count: counts[index] }))
        .filter(p => p.count > 0)
        .sort((a, b) => b.count - a.count);
      if (!all.length) return;

      // מי שלא ציין נספר. כל הערכים הריקים מתאחדים לפרוסה אחת,
      // "לא צוין", אפורה ובסוף — וכל אחוז בעוגה הוא מתוך כל
      // המגישים, בדיוק כמו המשפט בכותרת. עד 05/10/2026 הריקים
      // ירדו מהעוגה, ולכן בקמפיין הארצי הכותרת אמרה 64.6% יהודים
      // והעוגה 69%: אותם 452 יהודים, מחולקים פעם ב-700 ופעם ב-654.
      const pairs = pieSlices(all, key, 8);
      if (!pairs.length) return;

      const card = el('div', 'card piecard');
      card.appendChild(el('div', 'bartitle', facet.label));

      // הצבע נושא את המשמעות: קטגוריה שלילית באדום, חיובית
      // בירוק-כחול, והשאר בסדרה הרגילה. הפלטה מחושבת פעם אחת
      // ומשמשת גם את הפרוסה וגם את המקרא, כך שהם לא ייפרדו.
      const shown = pairs;
      const total = shown.reduce((acc, p) => acc + p.count, 0);
      const paint = moodPalette(key);
      const colors = shown.map(pair => sliceColor(pair.value, paint));

      const holder = el('div');
      holder.innerHTML = pieSvg(shown, 180, (_v, index) => colors[index]);
      card.appendChild(holder);

      const legend = el('div', 'pielegend');
      shown.forEach((pair, index) => {
        const row = el('div');
        const swatch = el('span', 'swatch');
        swatch.style.background = colors[index];
        row.appendChild(swatch);
        row.appendChild(markSentiment(el('span', 'plabel', pair.value),
                                      key, pair.value));
        // הכמות והאחוז — אותו אחוז שבפרוסה ושבכותרת
        row.appendChild(el('span', 'pv',
          `${n(pair.count)} · ${pct(total ? pair.count / total : 0)}`));
        legend.appendChild(row);
      });
      card.appendChild(legend);
      host.appendChild(card);
    });
  });
}

/* ===== מפות חום ===== */

function hexToRgb(hex) {
  const clean = String(hex).replace('#', '');
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16),
          parseInt(clean.slice(4, 6), 16)];
}

function mixColors(from, to, t) {
  const a = hexToRgb(from), b = hexToRgb(to);
  const channel = i => Math.round(a[i] + (b[i] - a[i]) * t);
  return `rgb(${channel(0)},${channel(1)},${channel(2)})`;
}

/* צבע רציף: מהצבע הנמוך, דרך הבינוני, אל הגבוה. הספים קובעים את
   נקודות המעבר, וביניהן הצבע משתנה בהדרגה.

   הסולם הוא בדיוק זה של עמודת "מדד ייצוג" בטבלת ההגשות מול
   האוכלוסייה — כחול לאזור שמגיש הרבה, אדום לדליל. ירוק/צהוב/אדום
   ירד: הוא נקרא כציון ("טוב"/"רע") במקום כעוצמה, והשתמש באותם
   שני צבעים שנושאים משמעות בגרפי הפילוח. */
function heatColor(ratio) {
  const colors = CC.data.heatColors || {};
  const low = colors['צבע_נמוך'] || '#5A2230';
  const mid = colors['צבע_בינוני'] || '#36344F';
  const high = colors['צבע_גבוה'] || '#12456E';
  if (ratio === null || ratio === undefined) return colors['צבע_ללא_נתון'] || '#9CA3AF';

  const highAt = (colors['סף_גבוה_אחוז'] !== undefined ? colors['סף_גבוה_אחוז'] : 66) / 100;
  const midAt = (colors['סף_בינוני_אחוז'] !== undefined ? colors['סף_בינוני_אחוז'] : 33) / 100;
  const value = Math.max(0, Math.min(1, ratio));

  if (value >= highAt) return high;
  if (value >= midAt) {
    return mixColors(mid, high, (value - midAt) / Math.max(0.001, highAt - midAt));
  }
  return mixColors(low, mid, value / Math.max(0.001, midAt));
}

/* צבע "ללא נתון" מההגדרות — משותף למצולעי המפה ולמקרא שמתחתיה */
function noDataColor() {
  return (CC.data.heatColors || {})['צבע_ללא_נתון'] || '#9CA3AF';
}

function heatLegend(ratioMode) {
  const colors = CC.data.heatColors || {};
  const legend = el('div', 'maplegend');
  const suffix = ratioMode ? ' ביחס לאוכלוסייה' : '';
  /* הסולם נפרס בין האזור הנמוך ביותר לגבוה ביותר במפה הזו, ולכן
     "גבוה" ו"דליל" הם תמיד קצוות אמיתיים שקיימים בנתונים — בדיוק
     כמו בעמודת "מדד ייצוג" בטבלה שמתחת. המקרא אומר את זה בפירוש,
     אחרת אפשר לחשוב שהכחול מסמן סף מוחלט כלשהו. */
  // הצבע הוא צבע המחוז עצמו, ולא רק של הסיכה — ראו renderChoropleth
  [['הגבוה ביותר — הגשות רבות' + suffix, colors['צבע_גבוה'] || '#12456E'],
   ['אמצע הטווח', colors['צבע_בינוני'] || '#36344F'],
   ['הנמוך ביותר — הגשות דלילות' + suffix, colors['צבע_נמוך'] || '#5A2230'],
   ['ללא נתון', colors['צבע_ללא_נתון'] || '#9CA3AF']].forEach(([label, color]) => {
    const item = el('span');
    const swatch = el('span', 'swatch');
    swatch.style.background = color;
    item.appendChild(swatch);
    item.appendChild(el('span', null, label));
    legend.appendChild(item);
  });
  const note = el('div', 'tnote');
  note.textContent = ratioMode
    ? 'צבע המחוז נקבע לפי מדד הייצוג — שיעור ההגשות מהאזור חלקי ' +
      'שיעורו באוכלוסייה — ונפרס בין האזור הנמוך ביותר לגבוה ביותר. ' +
      'זה אותו סולם בדיוק של עמודת "מדד ייצוג" בטבלה שמתחת, ' +
      'והמספר שבסיכה הוא אותו מדד.'
    : 'אין נתוני אוכלוסייה לרוב האזורים, ולכן הצבע נקבע לפי מספר ' +
      'ההגשות המוחלט ונפרס בין האזור הנמוך ביותר לגבוה ביותר.';
  legend.appendChild(note);
  return legend;
}

/* מסננים חלים על המפות דרך ספירת האזורים; היישובים הם אגרגט של הריצה
   ולכן הם מוצגים כפי שהם, עם ציון מפורש בהערה. */
let GEO = null;

async function loadGeo() {
  if (GEO) return GEO;
  const payload = await ccJson('/api/geo');
  // מפה שלא נטענה אינה סיבה להפיל את שאר המסך: המפות מציגות
  // הודעה, וכל הגרפים האחרים ממשיכים להיבנות. כישלון אינו נשמר
  // במטמון — הציור הבא ינסה שוב.
  if (!payload || payload.error) {
    return { error: (payload && payload.error) || 'המפות לא נטענו.' };
  }
  GEO = payload;
  return GEO;
}

/* מחזיר את ההבטחה, כדי שניתן יהיה להמתין לציור המפות — בדפדפן זה
   לא נדרש, בבדיקה האוטומטית כן. */
/* מידת ההגדלה של כל מפה, בין 1 ל-1.6. נשמרת בין ציורים כדי שסינון
   לא יאפס את מה שהמשתמש בחר. */
/* מידת ההגדלה שהמשתמש בחר, לכל מפה. נשמרת בין ציורים כדי שסינון
   לא יאפס אותה.

   הערך שנשמר הוא מה שמוצג למשתמש: 1 = "100%". הציור בפועל מוכפל
   ב-MAP_ZOOM_BASE, ולכן ברירת המחדל שנראית כ-100% מציירת מפה
   בגודל 160% — זה הגודל שבו המפה נקראית. הטווח 100%–200%. */
const MAP_ZOOM = {};
const MAP_ZOOM_MIN = 1, MAP_ZOOM_MAX = 2, MAP_ZOOM_STEP = 0.2;
const MAP_ZOOM_BASE = 1.6;

function mapLevel(hostId) {
  return MAP_ZOOM[hostId] || MAP_ZOOM_MIN;
}

function mapScale(hostId) {
  return mapLevel(hostId) * MAP_ZOOM_BASE;
}

/* גובה הבסיס נגזר מגובה החלון. ישראל צרה וגבוהה, ולכן הגובה הוא
   שקובע כמה גדולה המפה — מתיחה לרוחב רק הייתה מותחת אוויר. */
function mapBaseHeight() {
  const viewport = (typeof window !== 'undefined' && window.innerHeight) || 900;
  return Math.round(Math.min(760, Math.max(500, viewport * 0.74)));
}

/* גרירת המפה בתוך חלון התצוגה.

   בהגדלה המפה גדולה מהחלון, ולכן צריך דרך להגיע לאזור שמעניין.
   גלילה רגילה של העמוד לא מתאימה כאן — היא הייתה מזיזה את העמוד
   כולו — ולכן הגרירה מזיזה את תוכן החלון בלבד. */
function enableMapPan(view) {
  let dragging = false, startX = 0, startY = 0, fromLeft = 0, fromTop = 0;

  view.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    dragging = true;
    startX = event.clientX; startY = event.clientY;
    fromLeft = view.scrollLeft; fromTop = view.scrollTop;
    view.classList.add('grabbing');
    view.setPointerCapture(event.pointerId);
  });

  view.addEventListener('pointermove', event => {
    if (!dragging) return;
    event.preventDefault();
    view.scrollLeft = fromLeft - (event.clientX - startX);
    view.scrollTop = fromTop - (event.clientY - startY);
  });

  const stop = event => {
    if (!dragging) return;
    dragging = false;
    view.classList.remove('grabbing');
    if (event.pointerId !== undefined && view.hasPointerCapture(event.pointerId)) {
      view.releasePointerCapture(event.pointerId);
    }
  };
  view.addEventListener('pointerup', stop);
  view.addEventListener('pointercancel', stop);

  // פתיחה במרכז המפה, ולא בפינה. נדחה לפריים הבא כדי שהמידות
  // כבר יהיו ידועות; מחוץ לדפדפן אין requestAnimationFrame, ולכן
  // המרכוז פשוט מדולג — הבדיקה האוטומטית מריצה את הקובץ ב-node.
  const center = () => {
    view.scrollLeft = (view.scrollWidth - view.clientWidth) / 2;
    view.scrollTop = (view.scrollHeight - view.clientHeight) / 2;
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(center);
  }
}

function mapZoomBar(hostId, redraw) {
  const bar = el('div', 'mapzoom');
  const level = mapLevel(hostId);

  const make = (label, delta, title) => {
    const button = el('button', 'mapzoom-btn', label);
    button.type = 'button';
    button.title = title;
    const next = Math.round((level + delta) * 100) / 100;
    button.disabled = next < MAP_ZOOM_MIN - 0.001 || next > MAP_ZOOM_MAX + 0.001;
    button.addEventListener('click', () => {
      MAP_ZOOM[hostId] = Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, next));
      redraw();
    });
    return button;
  };

  bar.appendChild(make('−', -MAP_ZOOM_STEP, 'הקטנה'));
  bar.appendChild(el('span', 'mapzoom-val', Math.round(level * 100) + '%'));
  bar.appendChild(make('+', MAP_ZOOM_STEP, 'הגדלה'));
  return bar;
}

/* המפות. שכבת המרחבים ירדה מהתצוגה (סעיף 2) והקוד שלה נשאר שלם:
   כל מכל שקיים בעמוד מצויר, וכל מכל שאינו קיים פשוט מדולג. החזרת
   המרחבים היא החזרת שני ה-div למסך — בלי נגיעה כאן. */
function renderMaps() {
  if (!document.getElementById('cc-map-districts') &&
      !document.getElementById('cc-map-regions')) return Promise.resolve();
  return loadGeo().then(geo => {
    if (geo && geo.error) {
      ccShowError('cc-map-districts', geo.error);
      ccShowError('cc-map-regions', geo.error);
      return;
    }
    renderChoropleth('cc-map-districts', 'districts', 'district', 'הגשות לפי מחוז');
    renderChoropleth('cc-map-regions', 'regions', 'region', 'הגשות לפי מרחב');
  });
}

/* צובע כל מחוז או מרחב לפי מספר ההגשות שלו. הפוליגונים מגיעים מהשרת
   ומצוירים ב-SVG — אין כאן שכבת אריחים חיצונית. */
/* לוח הצבעים של מפת החום — הבסיס שעליו יושבות הסיכות.

   ים תכלת שממלא את כל המסגרת, יבשה בגוון אבן בהיר, גבולות אפורים
   דקים ורצופים, ונקודות יישוב בהירות עם קו מתאר כהה. זה בדיוק
   המראה שבתמונת הייחוס. */
const MAP_SKIN = {
  sea: '#bcdcef',
  land: '#e4e6e0',
  river: '#8fbfdd',
  border: '#8d99a8',
  dot: '#c6ced8',
  dotEdge: '#4d5866',
  label: '#1f2937',
};

/* תווית יישוב בתיבה לבנה, כמו במפת החום. הרוחב נאמד מאורך השם —
   ב-SVG אין פריסת טקסט לפני הציור, ולכן אמידה היא הדרך היחידה. */
function mapLabel(text, px, py, size) {
  const width = text.length * size * 0.58 + size * 0.9;
  const height = size * 1.65;
  const left = px - width / 2, top = py - height;
  return `<g pointer-events="none">` +
    `<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" ` +
    `width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="${(height / 2.6).toFixed(1)}" ` +
    `fill="#fff" fill-opacity="0.92" stroke="${MAP_SKIN.border}" stroke-width="0.5"/>` +
    `<text x="${px.toFixed(1)}" y="${(top + height * 0.72).toFixed(1)}" ` +
    `text-anchor="middle" style="fill:${MAP_SKIN.label};font-size:${size}px;` +
    `font-weight:600">${text}</text></g>`;
}

function renderChoropleth(hostId, layerKey, field, title) {
  const host = document.getElementById(hostId);
  if (!host || !GEO || !GEO[layerKey]) return;
  host.innerHTML = '';

  // הגשות ואוכלוסייה לכל מחוז או מרחב, מתוך אגרגט היישובים
  const counts = new Map(), people = new Map();
  (CC.data.settlements || []).forEach(place => {
    const key = place[field];
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + place.count);
    if (place.population) people.set(key, (people.get(key) || 0) + place.population);
  });

  // אוכלוסיית המחוזות מגיעה כנתון ישיר; היא מדויקת יותר מסכום היישובים
  if (field === 'district') {
    Object.entries(CC.data.districtPopulation || {}).forEach(entry => {
      if (counts.has(entry[0])) people.set(entry[0], entry[1]);
    });
  }

  const totalCount = [...counts.values()].reduce((a, b) => a + b, 0);
  const totalPeople = [...people.values()].reduce((a, b) => a + b, 0);
  // מצב היחס דורש אוכלוסייה לרוב האזורים; אחרת נופלים לכמות מוחלטת
  const ratioMode = people.size >= Math.max(2, counts.size * 0.6) && totalPeople > 0;

  // הערך שמצויר: הגשות לכל 1,000 תושבים, או הכמות עצמה
  // מדד הייצוג: שיעור ההגשות מהאזור חלקי שיעורו באוכלוסייה.
  // 1.00 = בדיוק כמצופה לגודלו; מעל — ייצוג יתר; מתחת — תת ייצוג.
  const totalForMetric = [...counts.values()].reduce((a, b) => a + b, 0);
  const peopleForMetric = [...people.values()].reduce((a, b) => a + b, 0);
  const metric = new Map();
  counts.forEach((value, key) => {
    const residents = people.get(key);
    if (ratioMode && residents && peopleForMetric && totalForMetric) {
      metric.set(key, (value / totalForMetric) / (residents / peopleForMetric));
    } else {
      metric.set(key, value);
    }
  });
  const maxMetric = Math.max(...metric.values(), 0.000001);

  /* מיקום כל אזור על הסולם — בין הנמוך ביותר לגבוה ביותר, ולא
     ביחס לאפס.

     קודם לכן הצבע נגזר מ-metric/maxMetric. במצב יחס לאוכלוסייה
     מדד הייצוג של כל המחוזות מתגודד סביב 1.00 (0.78 … 1.31),
     ולכן כל המנות יצאו בטווח 0.6–1.0 — כלומר כל המחוזות נצבעו
     באותו גוון כהה, ומפה שאמורה להראות הבדלים הראתה שטח אחיד.

     הפריסה בין המינימום למקסימום היא בדיוק מה שעמודת "מדד ייצוג"
     בטבלה שמתחת עושה, ולכן המפה והטבלה מספרות עכשיו אותו סיפור:
     המחוז הכי מיוצג בקצה הכחול, הכי דליל בקצה האדום, והשאר
     נפרסים ביניהם. */
  const measuredValues = [...metric.entries()]
    .filter(entry => counts.has(entry[0])).map(entry => entry[1]);
  const minMetric = measuredValues.length ? Math.min(...measuredValues) : 0;
  const topMetric = measuredValues.length ? Math.max(...measuredValues) : maxMetric;
  const spread = topMetric - minMetric;
  // אזור יחיד, או שכולם שווים בדיוק: אין מה לפרוס, וכולם באמצע
  const scaleOf = value => (spread > 0 ? (value - minMetric) / spread : 0.5);

  /* גבולות משותפים לשתי המפות.

     קודם לכן כל מפה נגזרה מהגבולות של השכבה שלה בלבד, ומכיוון
     שלמחוזות ולמרחבים היקף מעט שונה יצאו שתי מפות בגדלים שונים
     זו לצד זו. עכשיו שתיהן נמדדות מאותם גבולות, ולכן הן זהות
     בגודל ובמיקום — אפשר להשוות ביניהן במבט. */
  const bounds = geoBounds([GEO.districts, GEO.regions].filter(Boolean));
  const margin = 0.05;
  const latPad = (bounds.maxLat - bounds.minLat) * margin;
  const lonPad = (bounds.maxLon - bounds.minLon) * margin;
  bounds.minLat -= latPad; bounds.maxLat += latPad;
  bounds.minLon -= lonPad; bounds.maxLon += lonPad;

  // הגובה נגזר מגובה החלון וממידת ההגדלה שהמשתמש בחר. ישראל צרה
  // וגבוהה, ולכן הרוחב נגזר קטן ממנו.
  // המידות נכתבות כתכונות על ה-SVG עצמו — CSS לבדו אינו מספיק כאן.
  const zoom = mapScale(hostId);
  const height = Math.round(mapBaseHeight() * zoom), pad = 8;
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const lonScale = Math.cos(midLat * Math.PI / 180);
  const spanLat = bounds.maxLat - bounds.minLat || 1;
  const spanLon = (bounds.maxLon - bounds.minLon) * lonScale || 1;
  const width = Math.round((height - pad * 2) * (spanLon / spanLat)) + pad * 2;
  /* מזרח מימין, מערב משמאל — כמו בכל מפה.

     קודם לכן הנוסחה הייתה (maxLon - lon), כלומר קו אורך גדול יותר
     קיבל x קטן יותר: המפה צוירה כתמונת ראי, חוף הים בצד שמאל
     במקום בימין. עמוד בעברית נקרא מימין לשמאל, אבל גאוגרפיה לא
     מתהפכת איתו. */
  const x = lon => pad + ((lon - bounds.minLon) * lonScale / spanLon) * (width - pad * 2);
  const y = lat => pad + ((bounds.maxLat - lat) / spanLat) * (height - pad * 2);

  // מידות מפורשות על האלמנט עצמו. SVG עם viewBox בלבד מתנהג כרוחב
  // מלא של המכל ברוב הדפדפנים, ו-CSS width:auto אינו דורס את זה —
  // שם היה מקור הניפוח.
  const parts = ['<svg class="mapsvg" width="' + width + '" height="' + height +
                 '" viewBox="0 0 ' + width + ' ' + height +
                 '" preserveAspectRatio="xMidYMid meet">'];

  /* ראשית מלבן ים על כל המסגרת.

     קודם לכן נצבעו רק מצולעי הים מקובץ הגאוגרפיה, ולפינות שאליהן
     הם אינם מגיעים הציץ רקע הממשק הכהה — פינות שחורות שקטעו את
     המפה. הים ממלא עכשיו את הכול, והיבשה מצוירת מעליו. */
  parts.push('<rect x="0" y="0" width="' + width + '" height="' + height +
             '" fill="' + MAP_SKIN.sea + '"/>');

  const BACKGROUND = { sea: MAP_SKIN.sea, water: MAP_SKIN.sea, land: MAP_SKIN.land };
  (GEO.israel.features || []).forEach(feature => {
    if (feature.geometry.type === 'LineString') {
      const line = feature.geometry.coordinates.map((point, index) =>
        (index ? 'L' : 'M') + x(point[0]).toFixed(1) + ',' + y(point[1]).toFixed(1)
      ).join(' ');
      parts.push('<path d="' + line + '" fill="none" stroke="' + MAP_SKIN.river +
                 '" stroke-width="1.6"/>');
      return;
    }
    const fill = BACKGROUND[feature.properties.kind] || MAP_SKIN.land;
    pathsOf(feature.geometry).forEach(ring => {
      parts.push('<path d="' + ringPath(ring, x, y) + '" fill="' + fill + '"/>');
    });
  });

  /* מצולעי השכבה — כאן יושב החום עצמו.

     קודם לכן המצולע נצבע בגוון פסטל קבוע שנשא זהות בלבד, וכל
     החום הצטמצם לסיכה שקוטרה 20 פיקסלים. כלומר הצבע שאמור לספר
     מאיפה מגיעות ההגשות תפס אחוז אחד משטח המפה, ואי אפשר היה
     לקרוא אותה במבט — רק לקרוא שבעה מספרים קטנים.

     עכשיו המחוז כולו נצבע לפי המדד שלו: שטח גדול לכל ערך, ומפה
     שנקראת בצבע. הגוון הקבוע נשאר כנפילה לאחור למחוז בלי נתון,
     שאסור לו להיראות כאילו נמדד ויצא נמוך. */
  const pins = [];
  (GEO[layerKey].features || []).forEach(feature => {
    const name = feature.properties.name;
    const measured = metric.has(name);
    // מחוז בלי נתון מקבל את צבע "ללא נתון" שבהגדרות, ולא גוון
    // מהסולם: אפור אומר "לא נמדד", ואילו כל גוון מהסולם היה
    // אומר "נמדד ויצא נמוך" — שני דברים שונים לחלוטין.
    const fill = measured ? heatColor(scaleOf(metric.get(name)))
                          : noDataColor();
    pathsOf(feature.geometry).forEach(ring => {
      parts.push('<path d="' + ringPath(ring, x, y) + '" fill="' + fill +
                 '" fill-opacity="' + (measured ? '0.92' : '0.55') +
                 '" stroke="' + MAP_SKIN.border + '" stroke-width="0.9"/>');
    });
    if (feature.properties.label && counts.has(name)) {
      pins.push({ name, lon: feature.properties.label[0],
                  lat: feature.properties.label[1],
                  count: counts.get(name) || 0,
                  people: people.get(name) || 0,
                  metric: metric.get(name) || 0 });
    }
  });

  /* גודל הסיכה נגזר ממספרן: 7 מחוזות יכולים להיות גדולים, 22
     מרחבים חייבים להיות קטנים אחרת המפה נעלמת מתחתיהם. במרכז הארץ
     נקודות התווית צפופות, ולכן הסיכות מורחקות זו מזו לפני הציור.

     שכבת נקודות היישוב הוסרה לבקשתך: על מפה בהגדלה הן הצטברו
     לענן אפור שהסתיר את המחוזות ואת הסיכות. מי שרוצה את הפירוט
     לפי יישוב מוצא אותו בטבלת "יישובים מובילים" שמתחת למפה. */
  /* המידות גדלו: שם המחוז והמספר היו קטנים מכדי להיקרא בלי
     להתקרב למסך. סיכה של 14 פיקסלים עם ספרות של 11 הייתה בגודל
     של הערת שוליים, על מפה שתופסת שני שלישים מגובה המסך.

     המידות גם גדלות עם ההגדלה: הן נמדדות ביחידות ה-SVG, וכשהמפה
     נמתחת פי 2 טקסט בגודל קבוע נראה קטן פי 2 ביחס אליה. הגורם
     נעצר ב-1.35 כדי שבהגדלה מלאה התוויות לא יבלעו את המחוזות. */
  const label = Math.min(1.35, mapScale(hostId) / MAP_ZOOM_BASE);
  const radius = Math.round((pins.length > 12 ? 14 : 19) * label);
  const fontMain = +((pins.length > 12 ? 12 : 15) * label).toFixed(1);
  const fontName = +((pins.length > 12 ? 11.5 : 13.5) * label).toFixed(1);
  const fontSub = +((pins.length > 12 ? 9 : 10.5) * label).toFixed(1);

  const placed = pins.map(pin => ({ pin, px: x(pin.lon), py: y(pin.lat) }));
  spreadPins(placed, radius * 2.1);
  const positionOf = new Map(placed.map(item => [item.pin, item]));

  /* הסיכה נצבעת בצבע החום של האזור, כמו בטבלה שמתחת למפה.

     קודם לכן היא הייתה תג כהה אחיד. הסיבה הייתה טובה — סיכה בצבע
     החום נבלעה במצולע שמתחתיה, אותו צבע בדיוק על אותו מקום — אבל
     המחיר היה שהעיגול, שהוא הדבר שהעין נעצרת עליו, לא אמר דבר על
     המחוז. הפתרון אינו לוותר על הצבע אלא להפריד בין השניים:
     טבעת לבנה עבה מסביב לסיכה מנתקת אותה מהרקע, וכך הצבע נקרא גם
     כשהמצולע מתחתיו זהה לו.

     מסודרות מהנמוך לגבוה, כדי שסיכה בולטת לא תיחתך על ידי שכנתה. */
  pins.sort((a, b) => a.metric - b.metric).forEach(pin => {
    const spot = positionOf.get(pin);
    const px = spot.px, py = spot.py;
    const big = ratioMode ? pin.metric.toFixed(2) : n(pin.count);
    const share = totalCount ? pin.count / totalCount : 0;
    const heat = heatColor(scaleOf(pin.metric));

    // טבעת לבנה מאחורי הסיכה — היא שמפרידה אותה מהמצולע
    parts.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" ` +
               `r="${(radius + 2.6).toFixed(1)}" fill="#fff" fill-opacity="0.95"/>`);
    parts.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${radius}" ` +
               `fill="${heat}" stroke="#0d1526" stroke-width="1.1" ` +
               `style="filter:drop-shadow(0 1px 3px rgba(0,0,0,.35))">` +
               `<title>${pin.name} — ${n(pin.count)} הגשות` +
               (pin.people ? ` · ${n(pin.people)} תושבים` : '') +
               (ratioMode ? ` · מדד ייצוג ${pin.metric.toFixed(2)}` : '') +
               `</title></circle>`);
    parts.push(`<text x="${px.toFixed(1)}" y="${(py + fontMain * 0.36).toFixed(1)}" ` +
               `text-anchor="middle" style="fill:#fff;font-size:${fontMain}px;` +
               `font-weight:700;pointer-events:none">${big}</text>`);
    // שם האזור בתיבה לבנה, כמו תוויות היישובים במפת החום
    parts.push(mapLabel(pin.name, px, py + radius + fontName + 5, fontName));
    if (pins.length <= 12) {
      parts.push(`<text x="${px.toFixed(1)}" y="${(py + radius + fontName + fontSub + 8).toFixed(1)}" ` +
                 `text-anchor="middle" style="fill:#2b3852;font-size:${fontSub}px;` +
                 `font-weight:700;paint-order:stroke;stroke:rgba(255,255,255,.95);` +
                 `stroke-width:2.4px;pointer-events:none">` +
                 `${n(pin.count)} · ${pct(share)}</text>`);
    }
  });

  parts.push('</svg>');

  const card = el('div', 'card mapcard');
  const head = el('div', 'maphead');
  head.appendChild(el('div', 'bartitle', title));
  head.appendChild(mapZoomBar(hostId,
    () => renderChoropleth(hostId, layerKey, field, title)));
  card.appendChild(head);

  /* חלון תצוגה קבוע שאפשר לגרור בתוכו.

     המפה עצמה גדלה עם ההגדלה, אבל החלון שומר על גובהו — אחרת
     הגדלה הייתה דוחפת את כל מה שמתחת למפה מטה. גרירה מזיזה את
     המפה בתוך החלון. */
  const holder = el('div', 'mapview');
  holder.innerHTML = parts.join('');
  /* גובה החלון הוא גובה המפה בהגדלת הבסיס, ולכן ב-100% רואים את
     הארץ כולה — גדולה פי 1.6 מקודם, בלי שדבר ייחתך. רק הגדלה
     מעבר לכך מוציאה את המפה מגבולות החלון, ואז נכנסת הגרירה. */
  holder.style.height = Math.round(mapBaseHeight() * MAP_ZOOM_BASE) + 'px';
  enableMapPan(holder);
  card.appendChild(holder);
  card.appendChild(heatLegend(ratioMode));
  host.appendChild(card);

  renderAreaTable(field === 'district' ? 'cc-district-table' : 'cc-region-table',
                  field, counts, people, metric, ratioMode);
}

/* טבלת האזורים — מתחת למפות, עם צביעת מפת חום לפי מדד הייצוג */
function renderAreaTable(hostId, field, counts, people, metric, ratioMode) {
  const host = document.getElementById(hostId);
  if (!host) return;
  host.innerHTML = '';

  const totalCount = [...counts.values()].reduce((a, b) => a + b, 0);
  const totalPeople = [...people.values()].reduce((a, b) => a + b, 0);
  const rows = [...counts.entries()]
    .sort((a, b) => (metric.get(b[0]) || 0) - (metric.get(a[0]) || 0));

  const table = el('table', 't');
  const head = el('tr');
  const headers = [field === 'district' ? 'מחוז' : 'מרחב', 'הגשות', 'שיעור מההגשות'];
  if (ratioMode) {
    headers.push('תושבים', 'שיעור מהאוכלוסייה', 'הגשות ל-100 אלף תושבים',
                 'מדד ייצוג');
  }
  headers.forEach(label => head.appendChild(el('th', null, label)));
  table.appendChild(head);

  /* המדד שנצבע. במצב יחס — מדד הייצוג; בלעדיו — הכמות עצמה.

     הנפילה לאחור אינה קוסמטיקה: בלעדיה המפה נצבעה לפי הכמות
     והטבלה לא נצבעה כלל, ואותו נתון בדיוק הופיע בשני מקומות —
     באחד בצבע ובשני בלבן. */
  const indexes = rows.map(entry => {
    const residents = people.get(entry[0]) || 0;
    const shareCount = totalCount ? entry[1] / totalCount : 0;
    const sharePeople = totalPeople ? residents / totalPeople : 0;
    if (ratioMode) return sharePeople ? shareCount / sharePeople : null;
    return entry[1];
  });
  const valid = indexes.filter(v => v !== null);
  const maxIndex = valid.length ? Math.max(...valid) : 1;
  const minIndex = valid.length ? Math.min(...valid) : 0;

  rows.forEach((entry, position) => {
    const name = entry[0], value = entry[1];
    const residents = people.get(name) || 0;
    const shareCount = totalCount ? value / totalCount : 0;
    const sharePeople = totalPeople ? residents / totalPeople : 0;

    const index = indexes[position];
    const t = (index !== null && maxIndex > minIndex)
      ? (index - minIndex) / (maxIndex - minIndex) : null;

    const tr = el('tr');

    /* עמודת השם נושאת ריבוע בצבע החום של האזור.

       "מדד ייצוג" הוא העמודה האחרונה, כלומר הרחוקה ביותר בטבלה,
       ובטלפון היא מחוץ למסך עד שגוללים לצד. כלומר הצבע — הדבר
       שאמור להיקרא במבט — היה הדבר היחיד שדרש גלילה. הריבוע כאן
       יושב בעמודה הראשונה, זו שתמיד גלויה, ובאותו צבע בדיוק. */
    const first = el('td');
    if (t !== null) {
      const swatch = el('span', 'swatch');
      swatch.style.background = heatColor(t);
      first.appendChild(swatch);
    }
    first.appendChild(el('span', null, name));
    tr.appendChild(first);
    tr.appendChild(el('td', 'num', n(value)));
    tr.appendChild(el('td', 'num', pct(shareCount)));

    if (ratioMode) {
      tr.appendChild(el('td', 'num', n(residents)));
      tr.appendChild(el('td', 'num', pct(sharePeople)));
      tr.appendChild(el('td', 'num',
        residents ? ((value / residents) * 100000).toFixed(1) : '—'));

      const cell = el('td', 'num', index === null ? '—' : index.toFixed(2));
      if (t !== null) {
        // אותו heatColor של המפה, ולא סולם שני משלה: שני סולמות
        // לאותו מדד הם שני סיפורים שונים על אותו מספר.
        cell.style.background = heatColor(t);
        cell.style.color = t > 0.55 ? '#cfe6fb' : '#ffd8d2';
        cell.style.fontWeight = '700';
      }
      tr.appendChild(cell);
    }
    table.appendChild(tr);
  });

  const card = el('div', 'card');
  card.appendChild(table);
  card.appendChild(el('div', 'tnote', ratioMode
    ? 'מדד ייצוג = שיעור ההגשות מהאזור חלקי שיעורו באוכלוסייה. ' +
      'מעל 1 — מגישים יותר מהמצופה לגודלם; מתחת ל-1 — פחות. ' +
      'כחול = ייצוג גבוה, אדום = ייצוג נמוך — אותו צבע בדיוק של ' +
      'המחוז במפה ושל הריבוע שליד שמו כאן.'
    : 'ללא נתוני אוכלוסייה מוצגת כמות בלבד.'));

  // מי שיישובו טרם סווג אינו נספר באף אזור. זו אינה תקלה — יישוב
  // חדש נוסף לטבלה עם אזור ריק וממתין להשלמה — ולכן החוסר נרשם
  // בקטן ולא כהתראה (סעיף 2).
  const note = unclassifiedNote();
  if (note) card.appendChild(el('div', 'emptynote', note));
  host.appendChild(card);
}

/* כמה מועמדים אין להם אזור, מתוך הסינון הפעיל. */
function unclassifiedArea() {
  const facet = CC.data.facets.find(f => f.key === 'area');
  if (!facet) return 0;
  const counts = facetCounts(facet);
  let sum = 0;
  facet.values.forEach((value, index) => {
    if (isEmptyValue(value)) sum += counts[index];
  });
  return sum;
}

function unclassifiedNote() {
  const missing = unclassifiedArea();
  if (!missing) return '';
  const total = CC.rows.length;
  return `${n(missing)} מועמדים (${pct(missing / total)}) ביישוב שטרם סווג ` +
         'לאזור — אינם נספרים בטבלה ובמפה. היישובים נוספו לטבלת ' +
         '"סיווג ישובים" וממתינים להשלמת האזור.';
}

/* דוחף סיכות שנמצאות קרוב מדי זו לזו, עד שכולן קריאות.
   ההזזה קטנה ומוגבלת — מיקום מדויק פחות חשוב מכך שכל מספר נראה. */
function spreadPins(items, minDistance) {
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        let dx = b.px - a.px, dy = b.py - a.py;
        let distance = Math.sqrt(dx * dx + dy * dy);
        if (distance >= minDistance) continue;
        if (distance < 0.01) { dx = 0.6; dy = 0.8; distance = 1; }
        const push = (minDistance - distance) / 2;
        const ux = (dx / distance) * push, uy = (dy / distance) * push;
        a.px -= ux; a.py -= uy;
        b.px += ux; b.py += uy;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

function pathsOf(geometry) {
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  return [];
}

function ringPath(ring, x, y) {
  return ring.map((point, index) =>
    (index ? 'L' : 'M') + x(point[0]).toFixed(1) + ',' + y(point[1]).toFixed(1)
  ).join(' ') + ' Z';
}

function geoBounds(collections) {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  collections.forEach(collection => {
    (collection.features || []).forEach(feature => {
      pathsOf(feature.geometry).forEach(ring => ring.forEach(point => {
        const lon = point[0], lat = point[1];
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
      }));
    });
  });
  return { minLat, maxLat, minLon, maxLon };
}

/* ההערה על מי שאין לו סיווג מופיעה גם מתחת לרשימת היישובים,
   כי שם מסתכלים על יישובים בשמם ושם החוסר בולט. */
function renderAreaMissingNote() {
  const host = document.getElementById('cc-area-missing');
  if (!host) return;
  host.textContent = unclassifiedNote();
}

function renderSettlementTable() {
  const host = document.getElementById('cc-settlement-table');
  if (!host) return;
  host.innerHTML = '';

  const settlements = [...(CC.data.settlements || [])]
    .sort((a, b) => b.count - a.count).slice(0, 25);
  if (!settlements.length) return;

  const table = el('table', 't');
  const head = el('tr');
  ['יישוב', 'אזור', 'מועמדים', 'פעילים', 'גויסו'].forEach(
    label => head.appendChild(el('th', null, label)));
  table.appendChild(head);

  settlements.forEach(place => {
    const tr = el('tr');
    tr.appendChild(el('td', null, place.name));
    tr.appendChild(el('td', null, place.area || '—'));
    tr.appendChild(el('td', 'num', n(place.count)));
    tr.appendChild(el('td', 'num', n(place.active)));
    tr.appendChild(el('td', 'num', n(place.recruited)));
    table.appendChild(tr);
  });

  const card = el('div', 'card');
  card.appendChild(table);
  card.appendChild(el('div', 'tnote', '25 היישובים המובילים בכלל הקמפיין.'));
  host.appendChild(card);
}

/* ===== תובנות ===== */

function topShare(facetKey) {
  const facet = CC.data.facets.find(f => f.key === facetKey);
  if (!facet) return null;
  const counts = facetCounts(facet);
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return null;
  // המכנה הוא כל המגישים, כולל מי שלא ציין — אותו מכנה של העוגה.
  // "לא צוין" עצמו אינו יכול להיות הערך המוביל במשפט.
  let best = -1;
  counts.forEach((value, index) => {
    if (isEmptyValue(facet.values[index])) return;
    if (best < 0 || value > counts[best]) best = index;
  });
  if (best < 0 || !counts[best]) return null;
  return { value: facet.values[best], count: counts[best], share: counts[best] / total };
}

function groupShare(facetKey, values) {
  const facet = CC.data.facets.find(f => f.key === facetKey);
  if (!facet) return null;
  const counts = facetCounts(facet);
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let sum = 0;
  facet.values.forEach((value, index) => {
    if (values.includes(value)) sum += counts[index];
  });
  return sum / total;
}

function insightCard(text) {
  const node = el('div', 'insight');
  node.innerHTML = text;
  return node;
}

/* שורת אחוזים ראשית — המשפטים מהמצגת, גדולים ובשורה אחת.
   note — שורה קטנה מתחת למשפט (בפרופיל: כמה חסר בממד). */
function headlineItem(value, text, note) {
  const item = el('div', 'hitem');
  item.appendChild(el('div', 'hval', value));
  item.appendChild(el('div', 'htxt', text));
  if (note) item.appendChild(el('div', 'hmiss', note));
  return item;
}

/* כמה מהמגישים בסינון לא ציינו ערך בממד — כמות וחלק */
function missingOf(facetKey) {
  const facet = CC.data.facets.find(f => f.key === facetKey);
  if (!facet) return null;
  const counts = facetCounts(facet);
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let missing = 0;
  facet.values.forEach((value, index) => {
    if (isEmptyValue(value)) missing += counts[index];
  });
  return { count: missing, share: missing / total };
}

/* מעל הסף אין אחוז כללי: כשרוב גדול לא ציין, "22% עם בגרות" מתאר
   רק את מי שבחר למלא — הטיה, לא נתון על הקמפיין. */
function missingLimit() {
  // בלוח השנתי CC.data ריק, והסף מגיע במטען השנתי
  const source = CC.data || (typeof ANNUAL !== 'undefined' && ANNUAL.data) || {};
  const limit = source.missingLimit;
  return typeof limit === 'number' ? limit : 0.2;
}

function missingNote(missing) {
  if (!missing || !missing.count) return 'אין חסר בנתון';
  return `חסר: ${pct(missing.share)} (${n(missing.count)} לא ציינו)`;
}

/* פריט פרופיל בשורה הראשית: האחוז, המשפט, ומתחתיו כמה חסר. אם
   החסר מעל הסף — במקום האחוז "—", וההסבר בשורת החסר. */
function profileItem(facetKey, share, text) {
  const missing = missingOf(facetKey);
  if (missing && missing.share > missingLimit()) {
    return headlineItem('—', text,
      `${missingNote(missing)} — מעל ${Math.round(missingLimit() * 100)}%, ` +
      'ולכן לא מוצג אחוז כללי');
  }
  return headlineItem(pct(share), text, missingNote(missing));
}

/* קבוצות הערכים שמשפטי הכותרת סוכמים. כל ערך כאן חייב להיות ערך
   אמיתי של הפילוח — אלי הדיבגר בודק זאת לפני כל עלייה לענן. עד
   05/10/2026 משפט הגיל סכם את '21-23', '24-26' ו-'27-30', קבוצות
   שכבר לא היו קיימות, ולכן "בגיל 21-40" הציג בפועל רק את 31-40. */
const HEADLINE_GROUPS = {
  age: { values: ['21-30', '31-40'], text: 'מהמועמדים בגיל 21-40' },
  education: { values: ['בגרות', 'דיפלומה', 'תואר'],
               text: 'עם בגרות או השכלה מתקדמת יותר' },
  // קבוצות היעד ברובאי הן 03 ו-05 (S.VALUE_SENTIMENT); 02 ניטרלי.
  // עד 06/10/2026 המשפט סכם גם את 02 — 47% בסייר אוגוסט, בעוד
  // שהפרוסות המסומנות כחיוביות בעוגה הן 13.5%.
  rovai: { values: ['03', '05'], text: 'עם פרופיל קרבי (רובאי 03 או 05)' },
};

function headlineGroup(key) {
  const rule = HEADLINE_GROUPS[key];
  return { share: groupShare(key, rule.values), text: rule.text };
}

function renderHeadline() {
  const demo = document.getElementById('cc-headline-demo');
  if (demo) {
    demo.innerHTML = '';
    const religion = topShare('religion');
    const gender = topShare('gender');

    if (religion) demo.appendChild(profileItem('religion', religion.share,
      `מהמועמדים הם ${religion.value}`));
    if (gender) demo.appendChild(profileItem('gender', gender.share,
      `מהמועמדים הם ${gender.value === 'זכר' ? 'גברים' : gender.value}`));
    ['age', 'education', 'rovai'].forEach(key => {
      const group = headlineGroup(key);
      if (group.share !== null) {
        demo.appendChild(profileItem(key, group.share, group.text));
      }
    });
  }

  const submit = document.getElementById('cc-headline-submit');
  if (submit) {
    submit.innerHTML = '';
    const area = topShare('area');
    const source = topShare('source');
    // אותו כלל של שורת הפרופיל: מעל סף החסר — "—" במקום אחוז
    if (area) submit.appendChild(profileItem('area', area.share,
      `מההגשות מאזור ${area.value}`));
    if (source) submit.appendChild(profileItem('source', source.share,
      `מההגשות ממקור ${source.value}`));
  }
}

function renderInsights() {
  const demo = document.getElementById('cc-insights-demo');
  if (demo) {
    demo.innerHTML = '';
    const religion = topShare('religion');
    const gender = topShare('gender');
    const age = headlineGroup('age');
    const education = headlineGroup('education');
    const rovai = topShare('rovai');

    // אותו כלל של השורה הראשית: מעל סף החסר — בלי אחוז כללי
    const card = (key, share, text) => {
      const missing = missingOf(key);
      const hidden = missing && missing.share > missingLimit();
      demo.appendChild(insightCard(
        `<b>${hidden ? '—' : pct(share)}</b> ${text}` +
        `<br><small>${missingNote(missing)}</small>`));
    };
    if (religion) card('religion', religion.share, `מהמועמדים הם ${religion.value}`);
    if (gender) card('gender', gender.share,
      `מהמועמדים הם ${gender.value === 'זכר' ? 'גברים' : gender.value}`);
    if (age.share !== null) card('age', age.share, age.text);
    if (education.share !== null) card('education', education.share, education.text);
    if (rovai) card('rovai', rovai.share, `ברובאי ${rovai.value} (הקבוצה הנפוצה)`);
  }

  const submit = document.getElementById('cc-insights-submit');
  if (submit) {
    submit.innerHTML = '';
    const area = topShare('area');
    const source = topShare('source');
    // מעל סף החסר אין אחוז כללי — גם לא כאן
    const shown = (key, share) => {
      const missing = missingOf(key);
      return missing && missing.share > missingLimit() ? '—' : pct(share);
    };
    if (area) submit.appendChild(insightCard(
      `אזור ההגשה המרכזי הוא <b>${area.value}</b> עם ${shown('area', area.share)} ` +
      `מכלל ההגשות<br><small>${missingNote(missingOf('area'))}</small>`));
    if (source) submit.appendChild(insightCard(
      `מקור המועמדות הנפוץ: <b>${source.value}</b> (${shown('source', source.share)})` +
      `<br><small>${missingNote(missingOf('source'))}</small>`));
  }

  const funnel = document.getElementById('cc-insights-funnel');
  if (funnel) {
    funnel.innerHTML = '';
    const leads = CC.rows.length;
    const active = countFlag('active');
    const recruited = countFlag('recruited');
    // "החלו הליך מיון" הוא מי שעשה ראיון התאמה או דפ"ר. שני
    // השלבים אינם תת-קבוצה זה של זה, ולכן נלקח הגדול מביניהם
    // ולא סכומם — אחרת אותו מועמד נספר פעמיים.
    const started = Math.max(countFlag('interview'), countFlag('dapar'));
    funnel.appendChild(insightCard(`הגשות: <b>${n(leads)}</b>`));
    funnel.appendChild(insightCard(
      `פעילים: <b>${n(active)}</b> (${leads ? pct(active / leads) : '—'})`));
    // האחוז כאן הוא שיעור מכלל ההגשות, בדיוק כמו בשאר הכרטיסים
    // בשורה. בלעדיו זה היה המספר היחיד בשורה בלי קנה מידה.
    funnel.appendChild(insightCard(
      `החלו הליך מיון: <b>${n(started)}</b> (${leads ? pct(started / leads) : '—'})`));
    funnel.appendChild(insightCard(
      `גיוסים: <b>${n(recruited)}</b> (${leads ? pct(recruited / leads) : '—'})`));
  }
}

/* ===== ביצועי מדיה ===== */

/* נתוני המדיה של הפלטפורמות שנשארו בסינון בלבד.
   כשמסננים לגוגל בלבד, אסור שיישארו קליקים ותקציב של מטא — לא במסך
   ולא בייצוא. */
function activePlatforms() {
  const facet = CC.data.facets.find(f => f.key === 'platform');
  if (!facet) return null;
  const counts = facetCounts(facet);
  const names = new Set();
  facet.values.forEach((value, index) => {
    if (counts[index] > 0) names.add(value);
  });
  return names;
}

const NO_SOURCE = 'ללא מקור';
const OTHER_PLATFORM = 'אחר';

/* ערכים שאינם נתון אלא היעדרו. בגרף הפרופיל הם אינם מוצגים —
   "לא ידוע" אינו מאפיין דמוגרפי, והוא רק גונב נתח מהפרוסות
   האמיתיות ומעוות את התמונה. כמותם נרשמת מתחת לגרף, כדי שהחוסר
   יישאר גלוי ולא ייעלם בשקט. */
const EMPTY_VALUES = ['(ריק)', 'לא ידוע', 'נתון חסר', 'לא צוין', 'חוסר', ''];

function isEmptyValue(name) {
  return EMPTY_VALUES.indexOf(String(name == null ? '' : name).trim()) >= 0;
}

/* "נתון חסר" — מי שאין לו ערך בממד. הוא נספר בכל גרף ובכל משפט
   אחוזים, ואינו יורד מהמכנה: אחרת אותו נתון מקבל שני אחוזים שונים
   בשני מקומות באותו מסך, והגרף אינו מסתכם ל-100%. עד 07/10/2026
   נקרא "לא צוין". */
const NOT_STATED = 'נתון חסר';

/* חלק הנתון החסר בסדרה — {ערך: כמות או חלק} */
function missingShareIn(values) {
  let sum = 0, missing = 0;
  Object.entries(values || {}).forEach(([name, value]) => {
    sum += value;
    if (isEmptyValue(name)) missing += value;
  });
  return sum ? missing / sum : 0;
}

/* סדרה שחסר בה יותר מהסף אינה מוצגת בגרף השוואה (07/10/2026):
   ההשוואה הייתה בין מי שבחר למלא, לא בין הקמפיינים. */
function overMissing(share) {
  return share > missingLimit() + 1e-9;
}

/* ההערה מתחת לגרף השוואה: לכל קמפיין כמה חסר, ומי לא מוצג */
function missingSummary(items) {
  const limit = Math.round(missingLimit() * 100);
  const hidden = items.filter(item => item.hidden);
  const shown = items.filter(item => !item.hidden && item.share > 0);
  const parts = [];
  if (shown.length) {
    parts.push('נתון חסר: ' + shown.map(item =>
      `${item.name} ${pct(item.share)}`).join(' · ') + '.');
  }
  if (hidden.length) {
    parts.push(`לא מוצגים — נתון חסר מעל ${limit}%: ` + hidden.map(item =>
      `${item.name} (${pct(item.share)} חסר)`).join(' · ') + '.');
  }
  return parts.join(' ');
}
const NOT_STATED_COLOR = '#7d8ba6';
const OTHER_VALUES = 'ערכים נוספים';

/* פרוסות עוגת פרופיל: הריקים מתאחדים ל"לא צוין" בסוף, ומה שמעבר
   ל-limit פרוסות מתקבץ ל"ערכים נוספים". שום מועמד לא נשמט — סכום
   הפרוסות הוא תמיד כל המגישים בסינון. */
function pieSlices(pairs, facetKey, limit) {
  const split = splitEmpty(pairs.filter(p => p.count > 0));
  const real = sortByAxis(split.real.slice().sort((a, b) => b.count - a.count),
                          facetKey);
  let out = real;
  const room = limit - (split.missing ? 1 : 0);
  if (real.length > room) {
    const bySize = real.slice().sort((a, b) => b.count - a.count);
    const keep = new Set(bySize.slice(0, room - 1).map(p => p.value));
    const rest = real.filter(p => !keep.has(p.value))
      .reduce((acc, p) => acc + p.count, 0);
    out = real.filter(p => keep.has(p.value));
    out.push({ value: OTHER_VALUES, count: rest });
  }
  if (split.missing) out = out.concat([{ value: NOT_STATED, count: split.missing }]);
  return out;
}

function sliceColor(value, paint) {
  if (value === NOT_STATED || value === OTHER_VALUES) return NOT_STATED_COLOR;
  return paint(value);
}

/* מפריד רשימת זוגות לערכים אמיתיים ולריקים */
function splitEmpty(pairs) {
  const real = [], empty = [];
  pairs.forEach(pair => (isEmptyValue(pair.value) ? empty : real).push(pair));
  return { real, empty, missing: empty.reduce((acc, p) => acc + p.count, 0) };
}

/* לכל פלטפורמה צבע קבוע משלה, זהה בכל המסכים — בכרטיס הגדול,
   בגרפים ובטבלאות. הצבע נקבע לפי סדר הפלטפורמה ברשימת הערכים
   של הפילוח, ולכן הוא יציב בין מסך למסך ובין סינון לסינון. */
const PLATFORM_COLORS = ['#4F8EF7', '#22c39a', '#FFC857', '#f97362', '#a78bfa',
                         '#38bdf8', '#f472b6', '#8fc63f', '#fb923c', '#2dd4bf'];

function platformColor(name) {
  const facet = CC.data && CC.data.facets
    ? CC.data.facets.find(f => f.key === 'platform') : null;
  const index = facet ? facet.values.indexOf(name) : -1;
  if (index < 0) return PLATFORM_COLORS[0];
  return PLATFORM_COLORS[index % PLATFORM_COLORS.length];
}

/* ===== תתי-קמפיין =====

   יש קמפיינים שהם בפועל כמה קמפיינים שרצו יחד תחת תקציב אחד: להב
   מגייס חוקר, בלש וחוקר רשת; קמפיין אוגוסט מגייס סייר וחוקר. הם
   אינם אותו קמפיין ואין להשוות אותם דרך סיכום אחד — ולכן במסך
   הביצועים כל אחד מהם מתנהג כמו פלטפורמה בפני עצמה: אפשר לבחור
   אותו, וכל הניתוח — מדדים, כרטיסים, טבלה, גרפים ומגמה — נבנה
   מחדש עליו בלבד.

   הבחירה אינה מנגנון שני לצד המסננים: היא מוגשת דרך אותו פילוח
   ("תת קמפיין") שיושב בפאנל המסננים, ולכן היא משפיעה על כל המסכים
   ולא רק על זה, והמסננים והשבבים אינם יכולים לומר דברים שונים.

   "ללא סיווג" אינו שבב. מי שלא נמצא לו תת-קמפיין נספר בתצוגה
   הכוללת, וזה כל מקומו — תת-קמפיין מדומה בשמו היה נראה כמו קמפיין
   רביעי שאיש לא הריץ. */

const SUB_ALL = '__all__';
const SUBCAMPAIGN_NONE = 'ללא סיווג';

function subFacet() {
  return (CC.data && CC.data.facets)
    ? CC.data.facets.find(f => f.key === 'subCampaign') || null
    : null;
}

function subNames() {
  return (CC.data && CC.data.subCampaigns) || [];
}

function hasSubCampaigns() {
  return !!(subNames().length && subFacet());
}

/* שמות תתי-הקמפיין שנשארו בסינון. null = לקמפיין אין חלוקה. */
function activeSubs() {
  const facet = subFacet();
  if (!facet) return null;
  const excluded = CC.selected[facet.key] || new Set();
  const names = new Set();
  facet.values.forEach((value, index) => {
    if (!excluded.has(index)) names.add(value);
  });
  return names;
}

/* תת-הקמפיין הבודד שנבחר, או SUB_ALL כשיותר מאחד נשאר בסינון.
   "יותר מאחד" ולא "כולם": גם בחירה חלקית היא תצוגה מסכמת, ואין
   מקום להציג אותה כאילו היא תת-קמפיין אחד. */
function currentSub() {
  const subs = activeSubs();
  if (!subs) return SUB_ALL;
  const chosen = subNames().filter(name => subs.has(name));
  return (chosen.length === 1 && !subs.has(SUBCAMPAIGN_NONE))
    ? chosen[0] : SUB_ALL;
}

/* מגדיר את הסינון כך שרק תת-הקמפיין הזה יישאר. SUB_ALL מחזיר הכל,
   כולל "ללא סיווג". */
function selectSub(name) {
  const facet = subFacet();
  if (!facet) return;
  CC.selected[facet.key] = name === SUB_ALL
    ? new Set()
    : new Set(facet.values.map((value, index) => (value === name ? -1 : index))
                          .filter(index => index >= 0));
  buildFilters();
  recompute();
}

function renderSubCampaigns() {
  const host = document.getElementById('cc-subcampaigns');
  if (!host) return;
  host.innerHTML = '';
  if (!hasSubCampaigns()) { host.style.display = 'none'; return; }
  host.style.display = '';

  const current = currentSub();
  const counts = platformCounts();
  const leadsBySub = new Map();
  counts.forEach(row => {
    leadsBySub.set(row.sub, (leadsBySub.get(row.sub) || 0) + row.leads);
  });

  const strip = el('div', 'subchips');
  const entries = [{ key: SUB_ALL, label: 'כולל — כל תתי הקמפיין' }]
    .concat(subNames().map(name => ({ key: name, label: name })));

  entries.forEach(entry => {
    const total = entry.key === SUB_ALL
      ? [...leadsBySub.values()].reduce((acc, value) => acc + value, 0)
      : (leadsBySub.get(entry.key) || 0);
    const chip = el('button',
      'subchip' + (entry.key === current ? ' on' : ''));
    chip.appendChild(el('span', 'subchip-name', entry.label));
    chip.appendChild(el('span', 'subchip-count', n(total) + ' לידים'));
    chip.addEventListener('click', () => selectSub(entry.key));
    strip.appendChild(chip);
  });
  host.appendChild(strip);

  const unclassified = leadsBySub.get(SUBCAMPAIGN_NONE) || 0;
  const note = el('div', 'tnote');
  note.textContent = current === SUB_ALL
    ? (unclassified
        ? `התצוגה מסכמת את כל תתי הקמפיין, ובכללם ${n(unclassified)} ` +
          'מועמדים שלא נמצא להם תת-קמפיין. הם נספרים בכולל בלבד ואינם ' +
          'מופיעים תחת אף תת-קמפיין.'
        : 'התצוגה מסכמת את כל תתי הקמפיין יחד.')
    : `כל הניתוח שלמטה — מדדים, כרטיסים, טבלה, גרפים ומגמה — מוגבל ` +
      `ל"${current}" בלבד.`;
  host.appendChild(note);
}

/* ספירות מסוננות לפי (תת-קמפיין, פלטפורמה).

   נספרות כאן ולא מגיעות מהשרת, כי הן חייבות להגיב לכל המסננים —
   טווח התאריכים בכללם. נתוני המדיה, לעומתן, הם ברמת הקמפיין כולו
   ואינם מסוננים לפי תאריך; זה נאמר במפורש מתחת לטבלה. */
function platformCounts() {
  const platform = CC.data.facets.find(f => f.key === 'platform');
  const map = new Map();
  // קמפיין בפלטפורמה אחת: אין מסנן פלטפורמה, והשרת שולח את הערך היחיד
  const single = (CC.data.constants || {}).platform;
  if (!platform && !single) return map;

  const sub = subFacet();
  const activeBits = flagBits('active');
  const recruitedBits = flagBits('recruited');
  for (const i of CC.rows) {
    const name = platform ? platform.values[platform.codes[i]] : single;
    const which = sub ? sub.values[sub.codes[i]] : '';
    const key = JSON.stringify([which, name]);
    let acc = map.get(key);
    if (!acc) {
      acc = { sub: which, platform: name, leads: 0, active: 0, recruited: 0 };
      map.set(key, acc);
    }
    acc.leads += 1;
    if (activeBits && activeBits[i]) acc.active += 1;
    if (recruitedBits && recruitedBits[i]) acc.recruited += 1;
  }
  return map;
}

function ratio(numerator, denominator) {
  if (!denominator || numerator === null || numerator === undefined) return null;
  return numerator / denominator;
}

/* מסכם שורות מדיה לרמת הפלטפורמה.

   היחסים מחושבים מחדש מהסכומים ולא ממוצעים מהשורות: ממוצע של
   CTR-ים אינו ה-CTR של הסכום, וכך גם עלות לקליק. */
const MEDIA_SUMS = ['budget', 'spent', 'impressions', 'clicks',
                    'conversions', 'views', 'reach'];

function aggregateMedia(rows) {
  const byPlatform = new Map();
  rows.forEach(row => {
    let acc = byPlatform.get(row.platform);
    if (!acc) {
      acc = { platform: row.platform, leads: 0, activeCount: 0, recruitedCount: 0 };
      MEDIA_SUMS.forEach(key => { acc[key] = null; });
      byPlatform.set(row.platform, acc);
    }
    MEDIA_SUMS.forEach(key => {
      const value = row[key];
      if (value === null || value === undefined) return;
      acc[key] = (acc[key] || 0) + value;
    });
    ['leads', 'activeCount', 'recruitedCount'].forEach(key => {
      acc[key] += row[key] || 0;
    });
  });

  return [...byPlatform.values()].map(acc => Object.assign(acc, {
    ctr: ratio(acc.clicks, acc.impressions),
    cpc: ratio(acc.spent, acc.clicks),
    cvr: ratio(acc.conversions, acc.clicks),
    util: ratio(acc.spent, acc.budget),
    cpm: acc.impressions ? (acc.spent / acc.impressions) * 1000 : null,
    cpl: ratio(acc.spent, acc.leads),
    costPerRecruit: ratio(acc.spent, acc.recruitedCount),
  }));
}

/* שורות המדיה ברמת הפלטפורמה, אחרי בחירת תת-הקמפיין.

   בקמפיין מחולק המדיה נשלחת ברמת (תת-קמפיין, פלטפורמה) והרמה הזו
   היא המקור היחיד: כשתת-קמפיין אחד נבחר מסוכמות רק שורותיו,
   וכשכולם נבחרים מסוכמות כולן — כולל "ללא סיווג", שהתקציב שלו הוא
   תקציב הקמפיין ככל תקציב אחר. בקמפיין שאין לו חלוקה אין מה לסכם,
   והשורות שהשרת שלח ברמת הפלטפורמה נשארות כפי שהן. */
function mediaRows(subName) {
  const bySub = CC.data.mediaBySub || [];
  const subs = activeSubs();
  if (!bySub.length || !subs) return CC.data.media || [];
  const wanted = (subName && subName !== SUB_ALL) ? new Set([subName]) : subs;
  return aggregateMedia(bySub.filter(row => wanted.has(row.sub)));
}

function filteredMedia(subName) {
  const names = activePlatforms();
  const media = mediaRows(subName);
  if (!names) return media;
  return media.filter(row => names.has(row.platform));
}

/* שורות המדיה של מסך הביצועים.

   "ללא מקור" אינו פלטפורמה — אלו הגשות שלא נקשרו לערוץ. אין לו
   תקציב, אין לו עלות לליד, והצגתו לצד הפלטפורמות מעוותת כל השוואת
   עלויות. לכן הוא אינו מופיע במסך הביצועים כלל. הוא נשאר, כמובן,
   בפילוחי ההגשות עצמם. */
function performanceMedia(subName) {
  return filteredMedia(subName).filter(row => row.platform !== NO_SOURCE);
}

/* הפירוט לפי פלטפורמה מציג פלטפורמות אמיתיות בלבד. "אחר" הוא סל
   של מקורות שאינם ערוץ מדיה — אין לו תקציב ואין לו עלות לליד,
   והצגתו לצד גוגל וטיקטוק מעוותת את ההשוואה. הוא נשאר, כמובן,
   בגרף ההגשות היומי ובפילוחי ההגשות. */
function realPlatformMedia(subName) {
  return performanceMedia(subName).filter(row => row.platform !== OTHER_PLATFORM);
}

function mediaTotals() {
  const media = performanceMedia();
  return media.reduce((acc, row) => ({
    spent: acc.spent + (row.spent || 0),
    impressions: acc.impressions + (row.impressions || 0),
    clicks: acc.clicks + (row.clicks || 0),
    conversions: acc.conversions + (row.conversions || 0),
  }), { spent: 0, impressions: 0, clicks: 0, conversions: 0 });
}

function renderMediaKpis() {
  const host = document.getElementById('cc-media-kpis');
  if (!host) return;
  host.innerHTML = '';

  const totals = mediaTotals();
  const leads = CC.rows.length;

  host.appendChild(tile(money(totals.spent), 'עלות כוללת', '', true));
  host.appendChild(tile(n(totals.impressions), 'חשיפות'));
  host.appendChild(tile(n(totals.clicks), 'קליקים'));
  const convTile = tile(n(totals.conversions), 'המרות במדיה',
    conversionShort(totals.conversions, leads) ? CONVERSION_SHORT_NOTE : '');
  if (conversionShort(totals.conversions, leads)) convTile.className += ' tile--short';
  host.appendChild(convTile);
  host.appendChild(tile(n(leads), 'הגשות מועמדות'));
  host.appendChild(tile(totals.spent && leads ? money(totals.spent / leads) : '—',
                        'עלות ממוצעת לליד'));

  const gap = document.getElementById('cc-media-gap');
  if (gap) {
    const diff = totals.conversions - leads;
    gap.className = 'insight' + (diff < 0 ? ' insight--short' : '');
    gap.innerHTML = diff < 0
      ? `<b>${CONVERSION_SHORT_NOTE}.</b> המדיה מדווחת על ` +
        `<b>${n(totals.conversions)}</b> המרות, ובמערכת <b>${n(leads)}</b> ` +
        `הגשות — <b>${n(-diff)}</b> הגשות יותר מהמרות. כל הגשה מתחילה ` +
        'בהמרה, ולכן יש לבדוק את דיווח המדיה ואת שיוך ההגשות לפלטפורמות.'
      : diff === 0
      ? 'מספר ההמרות במדיה תואם את מספר ההגשות במערכת.'
      : `הפער בין ההמרות במדיה (<b>${n(totals.conversions)}</b>) לבין ההגשות ` +
        `במערכת (<b>${n(leads)}</b>) הוא <b>${n(Math.abs(diff))}</b>. ` +
        'פער כזה מוכר מראש — הוא נובע מהמרות שלא הבשילו להגשה, וממועמדים ' +
        'שהגישו ולא נקלטו.';
  }
}

function renderCplCards() {
  const host = document.getElementById('cc-cpl-cards');
  if (!host) return;
  host.innerHTML = '';

  const facet = CC.data.facets.find(f => f.key === 'platform');
  const counts = facet ? facetCounts(facet) : [];
  const leadsBy = new Map();
  if (facet) facet.values.forEach((value, index) => leadsBy.set(value, counts[index]));

  // "ללא מקור" אינו פלטפורמה — אין לו תקציב ואין לו עלות לליד.
  // כרטיס "כלל הקמפיין" מסכם את כל מה שיש לו תקציב, כולל "אחר";
  // הכרטיסים הבודדים מציגים פלטפורמות אמיתיות בלבד.
  const totals = performanceMedia().reduce((acc, row) => ({
    spent: acc.spent + (row.spent || 0),
    leads: acc.leads + (leadsBy.get(row.platform) || 0),
  }), { spent: 0, leads: 0 });
  const media = realPlatformMedia();

  const row = el('div', 'cpl-row');
  row.appendChild(cplCard('כלל הקמפיין',
    totals.leads ? money(totals.spent / totals.leads) : '—',
    `${n(totals.leads)} לידים · ${money(totals.spent)}`, true));

  media.forEach(item => {
    const leads = leadsBy.get(item.platform) || 0;
    const card = cplCard(item.platform,
      leads && item.spent ? money(item.spent / leads) : '—',
      `${n(leads)} לידים · ${money(item.spent)}`, false);
    card.style.borderTopColor = platformColor(item.platform);
    card.classList.add('cpl-card--tinted');
    row.appendChild(card);
  });

  host.appendChild(row);
}

function cplCard(name, value, foot, primary) {
  const card = el('div', 'cpl-card' + (primary ? ' cpl-card--main' : ''));
  card.appendChild(el('div', 'cpl-name', name));
  card.appendChild(el('div', 'cpl-value', value));
  card.appendChild(el('div', 'cpl-foot', foot));
  return card;
}

function renderPlatformCards() {
  const host = document.getElementById('cc-platform-cards');
  if (!host) return;
  host.innerHTML = '';

  const facet = CC.data.facets.find(f => f.key === 'platform');
  const counts = facet ? facetCounts(facet) : [];
  const leadsBy = new Map();
  if (facet) facet.values.forEach((value, index) => leadsBy.set(value, counts[index]));

  realPlatformMedia().forEach(row => {
    const leads = leadsBy.get(row.platform) || 0;
    const color = platformColor(row.platform);
    const card = el('div', 'card barcard platcard');
    card.style.borderInlineStartColor = color;
    const title = el('div', 'bartitle', row.platform);
    title.style.borderRightColor = color;
    card.appendChild(title);

    /* סדר המדדים הוא סדר המשפך של המדיה, מהתוצאה אל ההשקעה:
       לידים, ואז מה שהוביל אליהם — הקלקות ואז חשיפות — ולבסוף
       העלות. הכרטיסים עומדים זה לצד זה בגובה מלא, ולכן אפשר
       לקרוא את אותה שורה לרוחב ולהשוות בין הפלטפורמות. */
    const kpis = el('div', 'kpis platstack');
    kpis.appendChild(tile(n(leads), 'לידים'));
    kpis.appendChild(tile(n(row.clicks), 'הקלקות'));
    kpis.appendChild(tile(n(row.impressions), 'חשיפות'));
    kpis.appendChild(tile(money(row.spent), 'עלות כוללת'));
    /* עלות ממוצעת לליד — שורה אחרונה בכרטיס, ולא מקטע נפרד למעלה.
       כמקטע נפרד היא חזרה על אותן פלטפורמות באותו סדר, והעין
       הייתה צריכה לקפוץ בין שני מקומות כדי לחבר עלות לתוצאה. */
    const cpl = tile(leads && row.spent ? money(row.spent / leads) : '—',
                     'עלות ממוצעת לליד');
    cpl.classList.add('tile-cpl');
    cpl.style.borderColor = color;
    kpis.appendChild(cpl);
    card.appendChild(kpis);
    host.appendChild(card);
  });
}

function renderMediaBars() {
  const host = document.getElementById('cc-media-bars');
  if (!host) return;
  host.innerHTML = '';

  // "אחר" הוא סל של מקורות שאינם ערוץ מדיה. בהשוואה חזותית בין
  // הפלטפורמות הוא מקבל עמודה כמו גוגל וטיקטוק ומעוות את הקריאה,
  // ולכן אינו מופיע כאן. בגרף ההגשות לפי ימים הוא כן מופיע —
  // שם הוא מקור הגשות לכל דבר.
  const media = realPlatformMedia();
  if (!media.length) return;

  /* שני סוגי מדדים, ולכן שתי שורות: בראשונה מדדים מצטברים —
     חשיפות, הקלקות והמרות; בשנייה מדדי יחס ועלות — CTR, עלות
     לקליק ותקציב.

     בשתי השורות מוצג הערך בלבד בלי אחוז. אחוז החלק של פלטפורמה
     מהמדד אינו מוסיף מידע מעבר לאורך העמודה עצמה, ובמדדי יחס
     הוא אף מטעה. */
  const countMetrics = [
    { key: 'impressions', label: 'חשיפות', format: n },
    { key: 'clicks', label: 'הקלקות', format: n },
    { key: 'conversions', label: 'המרות', format: n },
  ];
  const rateMetrics = [
    { key: 'spent', label: 'תקציב שנוצל', format: money },
    { key: 'ctr', label: 'יחס צפייה להקלקה', format: pct },
    { key: 'cpc', label: 'עלות לקליק', format: money },
  ];

  function metricCard(metric) {
    const rows = media
      .map(row => ({ name: row.platform, value: row[metric.key] }))
      .filter(row => row.value !== null && row.value !== undefined);
    if (!rows.length) return null;

    const max = Math.max(...rows.map(r => r.value), 0.000001);
    const card = el('div', 'card barcard');
    card.appendChild(el('div', 'bartitle', metric.label));

    const table = el('table', 'bars');
    rows.forEach(row => {
      table.appendChild(barRow(row.name, row.value / max, null,
                               metric.format(row.value),
                               platformColor(row.name)));
    });
    card.appendChild(table);
    return card;
  }

  function metricRow(metrics) {
    const strip = el('div', 'barstack');
    let filled = 0;
    metrics.forEach(metric => {
      const card = metricCard(metric);
      if (card) { strip.appendChild(card); filled += 1; }
    });
    if (filled) host.appendChild(strip);
  }

  metricRow(countMetrics);
  metricRow(rateMetrics);
}

/* ===== השוואה לקמפיינים קודמים ===== */

/* בסיסי ההשוואה שנבחרו, לפי סדר הבחירה — והסדר הזה הוא גם סדר
   הצבעים, כך שקמפיין שומר על צבעו כל עוד לא הוסר מהבחירה. */
// נקבע בציור הראשון מ"קמפיין ההשוואה" של הקמפיין (defaultBaseline),
// ואם לא הוגדר — נתוני 2025. בסיס 2025 המחולל נמחק ב-06/10/2026;
// מ-07/10/2026 זהו קובץ נתוני האמת, באחוזים בלבד (percentOnly).
let BASELINE_KEYS = null;

/* האם הקמפיין הנוכחי משתתף בהשוואה.

   קודם לכן הוא היה קבוע ולא ניתן להסרה: נכנסים למסך דרך קמפיין,
   ולכן הוא תמיד ראשון. אבל המסך משמש גם להשוואת קמפיינים קודמים
   זה מול זה — "איך נראו שלוש השנים שקדמו לנו" — ואז הקמפיין
   שדרכו נכנסו הוא עמודה מיותרת שגוזלת מקום ומסיטה את הסדר. */
let COMPARE_CURRENT = true;

const CURRENT_KEY = '__current__';

/* לכל היותר חמישה קמפיינים בהשוואה אחת.

   לא מגבלה טכנית אלא מגבלת קריאה: כל ערך בכל פילוח מקבל עמודה
   לכל קמפיין, ובשישה קמפיינים גוש אחד הוא שש עמודות צבעוניות
   שאי אפשר לעקוב אחריהן. חמש הוא גם אורך סדרת הצבעים, ולכן מעבר
   לו שני קמפיינים היו מקבלים את אותו גוון. */
const MAX_COMPARE = 5;

const CURRENT_COLOR = '#4F8EF7';
const BASELINE_COLORS = ['#f59e0b', '#22c39a', '#a78bfa', '#f472b6', '#38bdf8'];

function baselineColor(index) {
  return BASELINE_COLORS[index % BASELINE_COLORS.length];
}

/* הסדרות שמוצגות בפועל — הקמפיין הנוכחי (אם נבחר) ואחריו
   הבסיסים, כל אחד עם שמו, צבעו והנתונים שלו.

   זהו המקור היחיד לשאלה "מי משתתף בהשוואה": הגרפים, טבלת
   העלויות והטבלה המלאה קוראים ממנו, ולכן אי אפשר שאחד מהם
   יציג קמפיין שהשני אינו מכיר. */
function comparisonSeries(comparison) {
  const sets = comparison.sets || {};
  const series = [];

  if (COMPARE_CURRENT) {
    series.push({
      key: CURRENT_KEY,
      name: comparison.currentName || 'קמפיין נוכחי',
      color: CURRENT_COLOR,
      profile: comparison.current || {},
      counts: comparison.currentCounts || {},
      costs: comparison.currentCosts || {},
      funnel: comparison.currentFunnel || [],
    });
  }

  (BASELINE_KEYS || []).forEach((key, index) => {
    const set = sets[key];
    if (!set) return;
    series.push({
      key: key,
      name: set.name,
      color: baselineColor(index),
      profile: set.profile || {},
      counts: set.counts || {},
      costs: set.costs || {},
      funnel: set.funnel || [],
      percentOnly: !!set.percentOnly,
    });
  });

  return series;
}

/* חותך את הבחירה לתקרה. נדרש כשהתקרה יורדת או כשנטענת בחירה
   שנשמרה לפני שהוגדרה — עדיף לחתוך מהסוף מאשר להציג מסך שאינו
   נקרא. */
function trimComparisonPick() {
  const room = MAX_COMPARE - (COMPARE_CURRENT ? 1 : 0);
  if (BASELINE_KEYS.length > room) BASELINE_KEYS = BASELINE_KEYS.slice(0, room);
}

function renderComparison() {
  const host = document.getElementById('cc-comparison');
  const picker = document.getElementById('cc-baseline-pick');
  if (!host && !picker) return;

  const comparison = CC.data.comparison || {};
  const sets = comparison.sets || {};

  if (BASELINE_KEYS === null) {
    BASELINE_KEYS = comparison.defaultBaseline && sets[comparison.defaultBaseline]
      ? [comparison.defaultBaseline] : [];
  }
  trimComparisonPick();
  const series = comparisonSeries(comparison);
  const full = series.length >= MAX_COMPARE;

  // בורר מרובה — אפשר לסמן כמה קמפיינים ולראות את כולם יחד
  if (picker) {
    picker.innerHTML = '';
    const box = el('div', 'ctl');
    box.appendChild(el('span', 'ctl-label', 'משווים מול'));

    const chips = el('div', 'chips');

    /* צ'יפ הקמפיין הנוכחי — כמו כל צ'יפ אחר, ונכבה בלחיצה.
       מה שהוא אינו מרשה הוא לרוקן את המסך: אם אין בסיס אחר
       נבחר, כיבויו לא היה משאיר דבר להשוות. */
    const mine = el('button', 'chip' + (COMPARE_CURRENT ? ' on' : ''));
    const mark = el('span', 'mark');
    if (COMPARE_CURRENT) {
      mark.style.background = CURRENT_COLOR;
      mark.style.borderColor = CURRENT_COLOR;
    }
    mine.appendChild(mark);
    mine.appendChild(el('span', 'cname', comparison.currentName || 'קמפיין נוכחי'));
    mine.appendChild(el('span', 'cnum', 'נוכחי'));
    const lonely = COMPARE_CURRENT && !BASELINE_KEYS.length;
    if (lonely) mine.title = 'צריך להישאר לפחות קמפיין אחד בהשוואה';
    else if (!COMPARE_CURRENT && full) mine.title = `אפשר להשוות עד ${MAX_COMPARE} קמפיינים`;
    mine.addEventListener('click', () => {
      if (COMPARE_CURRENT) {
        if (!BASELINE_KEYS.length) return;
        COMPARE_CURRENT = false;
      } else {
        if (full) return;
        COMPARE_CURRENT = true;
      }
      renderComparison();
    });
    if (lonely || (!COMPARE_CURRENT && full)) mine.classList.add('chip--locked');
    chips.appendChild(mine);

    (comparison.baselines || []).forEach(option => {
      const active = BASELINE_KEYS.indexOf(option.key);
      const chip = el('button', 'chip' + (active >= 0 ? ' on' : ''));
      const dot = el('span', 'mark');
      if (active >= 0) {
        dot.style.background = baselineColor(active);
        dot.style.borderColor = baselineColor(active);
      }
      chip.appendChild(dot);
      chip.appendChild(el('span', 'cname', option.name));

      // מלא ולא נבחר — הצ'יפ נעול, ומסביר למה
      const locked = active < 0 && full;
      if (locked) {
        chip.classList.add('chip--locked');
        chip.title = `אפשר להשוות עד ${MAX_COMPARE} קמפיינים — יש להסיר אחד קודם`;
      }
      chip.addEventListener('click', () => {
        const at = BASELINE_KEYS.indexOf(option.key);
        if (at >= 0) {
          if (BASELINE_KEYS.length === 1 && !COMPARE_CURRENT) return;
          BASELINE_KEYS.splice(at, 1);
        } else {
          if (full) return;
          BASELINE_KEYS.push(option.key);
        }
        renderComparison();
      });
      chips.appendChild(chip);
    });

    box.appendChild(chips);
    box.appendChild(el('span', 'ctl-note',
      `${series.length} מתוך ${MAX_COMPARE} — אפשר להסיר גם את הקמפיין הנוכחי`));
    picker.appendChild(box);
  }

  renderComparisonBars(series);
  renderComparisonFunnel(series);
  renderComparisonCosts(series);

  if (!host) return;
  host.innerHTML = '';
  if (!series.length) {
    host.innerHTML = '<div class="warn">יש לבחור לפחות קמפיין אחד להשוואה.</div>';
    return;
  }

  renderComparisonTable(host, series);
}

/* ===== השוואת אוכלוסיות בין תתי-הקמפיין =====

   אותו דבר בדיוק כמו ההשוואה לקמפיינים קודמים, רק שהצדדים הם
   תתי-הקמפיין של אותו קמפיין. אותם רנדררים בדיוק מציירים את
   שניהם — ולכן אי אפשר ששני המסכים יסתרו זה את זה.

   למה זו שאלה אמיתית: בלהב, חוקר רשת הביא 502 מועמדים ב-7.3 ₪
   לליד וחוקר הביא 169 ב-22.3 ₪. השאלה הבאה היא מי הם — האם אלה
   אותן אוכלוסיות בכלל, או ששני תתי-הקמפיין פנו לאנשים שונים.

   "ללא סיווג" אינו צד בהשוואה: הוא אינו תת-קמפיין אלא מי שלא
   נמצא לו אחד. כמותו נאמרת מתחת לגרפים ולא נעלמת. */

/* אילו תתי-קמפיין משתתפים בהשוואה. ריק = כולם, וזו גם ההתחלה:
   מי שנכנס ללשונית רוצה לראות קודם את התמונה המלאה. הבחירה
   מתאפסת בכל מעבר קמפיין — שם תת-קמפיין של קמפיין אחד אינו
   אומר דבר באחר. */
let SUB_KEYS = [];

function resetSubPick() {
  SUB_KEYS = [];
}

function subComparisonSeries() {
  const data = (CC.data && CC.data.subComparison) || {};
  const sets = data.sets || [];
  const picked = SUB_KEYS.length
    ? sets.filter(set => SUB_KEYS.indexOf(set.key) >= 0)
    : sets;
  /* הצבע נגזר מהמקום ברשימה המלאה ולא ברשימה המסוננת, כדי
     שתת-קמפיין ישמור על צבעו גם כשמסירים אחר מההשוואה. */
  return picked.map(set => {
    const index = sets.indexOf(set);
    return {
      key: set.key,
      name: set.name,
      color: index === 0 ? CURRENT_COLOR : baselineColor(index - 1),
      profile: set.profile || {},
      counts: set.counts || {},
      costs: set.costs || {},
      total: set.total || 0,
    };
  });
}

/* בורר תתי-הקמפיין — אותו בורר צ'יפים של ההשוואה לקמפיינים
   קודמים, ובאותה התנהגות: אי אפשר לרוקן אותו לגמרי, כי מסך
   השוואה בלי צדדים אינו אומר דבר. */
function renderSubPick(series) {
  const picker = document.getElementById('cc-sub-pick');
  if (!picker) return;
  picker.innerHTML = '';

  const sets = ((CC.data && CC.data.subComparison) || {}).sets || [];
  if (sets.length < 2) return;

  const box = el('div', 'ctl');
  box.appendChild(el('span', 'ctl-label', 'משווים בין'));
  const chips = el('div', 'chips');

  sets.forEach((set, index) => {
    const on = series.some(item => item.key === set.key);
    const chip = el('button', 'chip' + (on ? ' on' : ''));
    const dot = el('span', 'mark');
    if (on) {
      const color = index === 0 ? CURRENT_COLOR : baselineColor(index - 1);
      dot.style.background = color;
      dot.style.borderColor = color;
    }
    chip.appendChild(dot);
    chip.appendChild(el('span', 'cname', set.name));
    chip.appendChild(el('span', 'cnum', n(set.total)));

    const lonely = on && series.length <= 2;
    if (lonely) chip.title = 'צריך להישאר לפחות שני תתי-קמפיין בהשוואה';
    chip.addEventListener('click', () => {
      const chosen = SUB_KEYS.length ? SUB_KEYS.slice()
                                     : sets.map(item => item.key);
      const at = chosen.indexOf(set.key);
      if (at >= 0) {
        if (chosen.length <= 2) return;
        chosen.splice(at, 1);
      } else {
        chosen.push(set.key);
      }
      SUB_KEYS = chosen.length === sets.length ? [] : chosen;
      renderSubComparison();
    });
    if (lonely) chip.classList.add('chip--locked');
    chips.appendChild(chip);
  });

  box.appendChild(chips);
  box.appendChild(el('span', 'ctl-note',
    `${series.length} מתוך ${sets.length} תתי-קמפיין`));
  picker.appendChild(box);
}

function renderSubComparison() {
  const host = document.getElementById('cc-sub-comparison');
  const wrap = document.getElementById('cc-sub-comparison-wrap');
  const picker = document.getElementById('cc-sub-pick');
  if (!host && !wrap && !picker) return;

  const all = ((CC.data && CC.data.subComparison) || {}).sets || [];
  const series = subComparisonSeries();
  const enough = all.length >= 2 && series.length >= 2;

  if (wrap) wrap.style.display = enough ? '' : 'none';
  renderSubPick(series);

  const note = document.getElementById('cc-sub-comparison-note');
  if (!enough) {
    if (host) host.innerHTML = '';
    ['cc-sub-comparison-bars', 'cc-sub-comparison-costs',
     'cc-sub-leads'].forEach(id => {
      const node = document.getElementById(id);
      if (node) node.innerHTML = '';
    });
    /* לשונית שנפתחה לקמפיין מחולק שאין בנתוניו חלוקה בפועל אינה
       נשארת ריקה בשקט — היא אומרת מה חסר. */
    if (note) {
      note.textContent = all.length
        ? ''
        : 'לקמפיין הזה אין בנתוני הריצה האחרונה שני תתי-קמפיין ' +
          'ומעלה, ולכן אין מה להשוות. תת-הקמפיין נקבע בטבלת ' +
          'הסיווג "תת קמפיין", והשיוך נעשה בריצה.';
    }
    return;
  }

  renderComparisonBars(series, 'cc-sub-comparison-bars');
  renderComparisonCosts(series, 'cc-sub-comparison-costs');
  renderSubLeads(series);
  if (host) {
    host.innerHTML = '';
    renderComparisonTable(host, series);
  }

  if (note) {
    const data = CC.data.subComparison || {};
    const names = series.map(set => set.name).join(', ');
    note.textContent =
      `הצדדים הם תתי-הקמפיין של הקמפיין הזה: ${names}.` +
      (data.unclassified
        ? ` ${n(data.unclassified)} מועמדים שלא נמצא להם תת-קמפיין אינם ` +
          'צד בהשוואה — הם נספרים בסיכום הכולל בלבד.'
        : '') +
      ' ההשוואה אינה מגיבה למסננים: היא נבנית מכלל מועמדי הקמפיין, ' +
      'כמו ההשוואה לקמפיינים קודמים.';
  }
}

/* פילוח הלידים במספרים מלאים — הטבלה הגדולה של הלשונית.

   טבלת ההשוואה מציגה אחוזים, וזו השאלה הנכונה כשמשווים אוכלוסיות
   בגדלים שונים. אבל אחוז לבדו מסתיר את הבסיס: 40% מתוך 25 מועמדים
   ו-40% מתוך 500 אינם אותו דבר. כאן יושבים המספרים עצמם, ולצד כל
   מספר חלקו בתוך תת-הקמפיין שלו — ובשורה תחתונה סך הלידים של כל
   אחד, שהוא הבסיס לכל האחוזים שמעליה. */
function renderSubLeads(series) {
  const host = document.getElementById('cc-sub-leads');
  if (!host) return;
  host.innerHTML = '';

  const dimensions = [];
  series.forEach(set => Object.keys(set.counts || {}).forEach(dimension => {
    if (dimensions.indexOf(dimension) < 0) dimensions.push(dimension);
  }));
  if (!dimensions.length) {
    host.innerHTML = '<div class="warn">אין פילוח לידים זמין להשוואה.</div>';
    return;
  }

  const table = el('table', 't');
  const head = el('tr');
  ['ערך'].concat(series.map(set => set.name)).concat(['סך הכול'])
    .forEach(label => head.appendChild(el('th', null, label)));
  table.appendChild(head);
  const columns = series.length + 2;

  const totals = series.map(set => set.total || 0);

  let group = 0;
  dimensions.forEach(dimension => {
    const keys = [];
    series.forEach(set => Object.keys(set.counts[dimension] || {})
      .forEach(key => { if (keys.indexOf(key) < 0) keys.push(key); }));
    if (!keys.length) return;

    // סדר יורד לפי סך הלידים — הערך הגדול ראשון, ולא לפי
    // הסדר המקרי שבו הוא הופיע בנתונים
    keys.sort((a, b) => {
      const sum = key => series.reduce(
        (acc, set) => acc + ((set.counts[dimension] || {})[key] || 0), 0);
      return sum(b) - sum(a);
    });

    const band = group % 2 === 0 ? 'grp grp--a' : 'grp grp--b';
    group += 1;

    const title = el('tr', 'grp-head ' + band);
    const cell = el('td', null, dimension);
    cell.colSpan = columns;
    title.appendChild(cell);
    table.appendChild(title);

    // "נתון חסר" אחרון; תת-קמפיין שחסר לו מעל הסף — כמויות בלי אחוזים
    keys.sort((a, b) => (a === NOT_STATED) - (b === NOT_STATED));
    const hidden = series.map(set =>
      overMissing(missingShareIn(set.counts[dimension] || {})));

    keys.forEach((key, position) => {
      const values = series.map(set => (set.counts[dimension] || {})[key] || 0);
      const sum = values.reduce((a, b) => a + b, 0);
      const tr = el('tr', band + (position === keys.length - 1 ? ' grp-last' : ''));
      tr.appendChild(el('td', 'grp-key', key));
      values.forEach((value, index) => {
        const base = totals[index];
        const withShare = base && (!hidden[index] || key === NOT_STATED);
        const text = withShare ? `${n(value)} (${pct(value / base)})` : n(value);
        tr.appendChild(el('td', 'num', text));
      });
      tr.appendChild(el('td', 'num', n(sum)));
      table.appendChild(tr);
    });
  });

  const foot = el('tr', 'grp-head');
  foot.appendChild(el('td', 'grp-key', 'סך הלידים'));
  totals.forEach(total => foot.appendChild(el('td', 'num', n(total))));
  foot.appendChild(el('td', 'num',
    n(totals.reduce((a, b) => a + b, 0))));
  table.appendChild(foot);

  const card = el('div', 'card');
  card.appendChild(table);
  const data = (CC.data && CC.data.subComparison) || {};
  card.appendChild(el('div', 'tnote',
    'מספרי לידים ממשיים, ולצדם חלקו של כל ערך בתוך תת-הקמפיין ' +
    'שלו. "סך הכול" הוא סכום תתי-הקמפיין שבהשוואה בלבד' +
    (data.unclassified
      ? `, ואינו כולל ${n(data.unclassified)} מועמדים שלא נמצא ` +
        'להם תת-קמפיין.'
      : '.') +
    ' מי שאין לו ערך בממד נספר בשורת "נתון חסר", ולכן כל ממד ' +
    'מסתכם לסך הלידים. בתת-קמפיין שחסר לו בממד יותר מ-' +
    `${Math.round(missingLimit() * 100)}% מוצגות הכמויות בלבד, בלי אחוזים.`));
  host.appendChild(card);
}

/* הסתרת לשונית "תת קמפיין" באתר הסטטי.

   בשרת הלשונית כלל אינה נבנית לקמפיין שאינו מחולק (ui.campaign_tabs).
   בענן ובאתר ההדגמה העמודים נבנים פעם אחת לכל הקמפיינים, והבחירה
   נעשית בדפדפן — ולכן ההסתרה חייבת לקרות כאן, בכל החלפת קמפיין. */
function syncSubTabLink() {
  if (!window.CC_STATIC) return;
  const split = !!(CC.data && CC.data.hasSubCampaigns);
  document.querySelectorAll('.nav a[href="subcampaign.html"]')
    .forEach(link => { link.style.display = split ? '' : 'none'; });
}

/* מקרא צבעים לגרף — ריבוע בצבע הסדרה וליד שמה.

   בגרפי ההשוואה כל קמפיין הוא עמודה בצבע משלו, וקודם הופיעה
   מתחתיהם רק רשימת שמות בלי צבע. השם לבדו אינו אומר איזו עמודה
   שייכת למי, ולכן הצבע יושב עכשיו לצד כל שם. */
function seriesLegend(items) {
  const legend = el('div', 'serieslegend');
  items.forEach(item => {
    const row = el('span', 'serieslegend-item');
    const swatch = el('span', 'swatch');
    swatch.style.background = item.color;
    row.appendChild(swatch);
    row.appendChild(el('span', null, item.name));
    legend.appendChild(row);
  });
  return legend;
}

/* השוואת משפכים (08/10/2026) — המקור היחיד ללשונית "השוואה לקמפיינים
   קודמים", למשפכי הלוח השנתי ולגרף המשפך במצגת.

   series: [{id, name, color, funnel: [{key, label, value}]}]. כל שלב
   הוא שיעור מההגשות של אותה סדרה (המרה מצטברת). השלבים — כל מה שיש
   לאחת הסדרות, בסדר המשפך; לסדרה שאין לה שלב (2025 אין "זומנו למבחן
   מקוון") השלב הוא null — "אין נתון", לא אפס. common — השלבים שיש לכל
   הסדרות. */
function funnelCompareData(series) {
  const order = [];
  const labels = {};
  series.forEach(item => (item.funnel || []).forEach(step => {
    if (step.key === 'submitted') return;
    if (order.indexOf(step.key) < 0) order.push(step.key);
    labels[step.key] = step.label;
  }));
  // הסדר הקנוני: סדר השלבים של הסדרה הארוכה ביותר
  const longest = series.reduce((best, item) =>
    ((item.funnel || []).length > (best.funnel || []).length ? item : best), series[0] || {});
  const rank = key => {
    const at = (longest.funnel || []).findIndex(step => step.key === key);
    return at < 0 ? 100 + order.indexOf(key) : at;
  };
  order.sort((a, b) => rank(a) - rank(b));

  const rows = series.filter(item => (item.funnel || []).length).map(item => {
    const submitted = ((item.funnel || []).find(step => step.key === 'submitted') || {}).value || 0;
    return {
      id: item.id, name: item.name, color: item.color, submitted,
      steps: order.map(key => {
        const step = item.funnel.find(s => s.key === key);
        return step ? { value: step.value, share: submitted ? step.value / submitted : 0 }
                    : null;
      }),
    };
  });
  const common = order.filter((key, index) => rows.every(row => row.steps[index]));
  return { keys: order, labels: order.map(key => labels[key]), rows, common };
}

/* לשונית ההשוואה: משפך הגיוס — כל שלב כשיעור מההגשות, סדרה לכל קמפיין */
function renderComparisonFunnel(series, hostId) {
  const host = document.getElementById(hostId || 'cc-comparison-funnel');
  if (!host) return;
  host.innerHTML = '';
  const data = funnelCompareData(series.map(set => ({
    id: set.key, name: set.name, color: set.color, funnel: set.funnel || [] })));
  if (!data.rows.length || !data.keys.length) return;

  const card = el('div', 'card barcard');
  card.appendChild(el('div', 'bartitle', 'משפך הגיוס — שיעור מההגשות'));
  card.dataset.series = data.rows.map(row => row.id).join(',');
  const peak = Math.max(0.01, ...data.rows.map(row =>
    Math.max(0, ...row.steps.map(step => (step ? step.share : 0)))));
  const table = el('table', 'bars');
  data.keys.forEach((key, index) => {
    data.rows.forEach((row, position) => {
      const step = row.steps[index];
      const label = position === 0 ? data.labels[index] : '';
      const tr = step
        ? barRow(label, step.share / peak, step.share, n(step.value), row.color)
        : barRow(label, 0, null, 'אין נתון', row.color);
      if (!step) tr.classList.add('cmp-none');
      if (position === 0) tr.classList.add('cmp-first');
      if (position === data.rows.length - 1) tr.classList.add('cmp-last');
      table.appendChild(tr);
    });
  });
  card.appendChild(table);
  card.appendChild(seriesLegend(data.rows.map(row => ({ name: row.name, color: row.color }))));
  const missing = data.keys.filter(key => data.common.indexOf(key) < 0)
    .map(key => data.labels[data.keys.indexOf(key)]);
  card.appendChild(el('div', 'emptynote',
    'האחוז — כמה מההגשות של כל קמפיין הגיעו לשלב (המרה מצטברת); המספר בסוף '
    + 'השורה — כמה מועמדים. ' + data.rows.map(row =>
      `${row.name}: ${n(row.submitted)} הגשות`).join(' · ') + '.'
    + (missing.length ? ` "אין נתון" — השלב אינו בנתונים של אותה סדרה (${missing.join(', ')}).` : '')));
  host.appendChild(card);
}

/* גרפי ההשוואה: המספר בסוף השורה, האחוז בתוך העמודה הצבועה.

   כל ערך בפילוח הוא גוש של עמודה אחת לכל קמפיין, בסדר הסדרות
   ובצבעיהן. מבנה התצוגה נגזר מכמות הקמפיינים: משלושה ומעלה
   הגוש מתכווץ — עמודות נמוכות יותר, גופן קטן יותר — אחרת כרטיס
   אחד של חמישה קמפיינים נמתח על גובה מסך שלם ואי אפשר להשוות
   בין פילוח לפילוח בלי לגלול. */
function renderComparisonBars(series, hostId) {
  const host = document.getElementById(hostId || 'cc-comparison-bars');
  if (!host) return;
  host.innerHTML = '';
  host.className = 'barstack' + (series.length >= 3 ? ' barstack--dense' : '');
  if (!series.length) return;

  const dimensions = [];
  series.forEach(set => Object.keys(set.profile || {}).forEach(dimension => {
    if (dimensions.indexOf(dimension) < 0) dimensions.push(dimension);
  }));

  dimensions.forEach(dimension => {
    // סדרה שחסר בה יותר מהסף אינה מוצגת בממד הזה (07/10/2026)
    const missingItems = series
      .filter(set => set.profile[dimension])
      .map(set => {
        const share = missingShareIn(set.profile[dimension]);
        return { name: set.name, share, hidden: overMissing(share), set };
      });
    const shown = missingItems.filter(item => !item.hidden).map(item => item.set);
    if (!missingItems.length) return;
    if (!shown.length) {
      const card = el('div', 'card barcard');
      card.appendChild(el('div', 'bartitle', dimension));
      card.dataset.series = '';
      card.appendChild(el('div', 'warn',
        `נתון חסר — בכל הקמפיינים שנבחרו חסר בממד הזה יותר מ-`
        + `${Math.round(missingLimit() * 100)}%, ולכן אין השוואה.`));
      card.appendChild(el('div', 'emptynote', missingSummary(missingItems)));
      host.appendChild(card);
      return;
    }

    const keys = new Set();
    shown.forEach(set => Object.keys(set.profile[dimension] || {})
      .forEach(key => keys.add(key)));

    const rows = [...keys]
      .map(key => ({
        key: key,
        values: shown.map(set => ({
          share: (set.profile[dimension] || {})[key] || 0,
          count: ((set.counts || {})[dimension] || {})[key] || 0,
          percentOnly: set.percentOnly,
          color: set.color,
        })),
      }))
      .filter(row => row.values.some(item => item.count > 0 || item.share > 0));
    // כל ערך מוצג — גם קטן — כדי שכל עמודה תסתכם לסך הקמפיין.
    // ממד עם ציר (גיל, רובאי) בסדר הציר; השאר לפי גודל; "לא צוין" אחרון.
    const order = axisOrder(dimension);
    rows.sort((a, b) => {
      if (a.key === NOT_STATED) return 1;
      if (b.key === NOT_STATED) return -1;
      if (order) {
        const ia = order.indexOf(a.key), ib = order.indexOf(b.key);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      }
      return b.values[0].share - a.values[0].share;
    });
    if (!rows.length) return;

    const card = el('div', 'card barcard');
    card.appendChild(el('div', 'bartitle', dimension));
    // אילו סדרות מוצגות, בסדרן — אלי קורא את השורות לפיו
    card.dataset.series = shown.map(set => set.key).join(',');
    const table = el('table', 'bars');

    rows.forEach(row => {
      row.values.forEach((item, index) => {
        // לנתוני 2025 אין מספרי מועמדים — רק האחוז שבתוך העמודה
        const tr = barRow(index === 0 ? row.key : '', item.share,
                          item.share, item.percentOnly ? '—' : n(item.count),
                          row.key === NOT_STATED ? NOT_STATED_COLOR : item.color);
        if (index === 0) tr.classList.add('cmp-first');
        if (index === row.values.length - 1) tr.classList.add('cmp-last');
        table.appendChild(tr);
      });
    });

    card.appendChild(table);
    // המקרא נצמד לתחתית המלבן (ראו .barcard ב-CSS), ולכן בכל
    // הכרטיסים שבשורה הוא עומד באותו גובה
    card.appendChild(seriesLegend(
      shown.map(set => ({ name: set.name, color: set.color }))));
    const summary = missingSummary(missingItems);
    if (summary) card.appendChild(el('div', 'emptynote cmp-missing', summary));
    host.appendChild(card);
  });

  const percentOnly = series.filter(set => set.percentOnly).map(set => set.name);
  if (percentOnly.length && host.children.length) {
    const note = el('div', 'tnote',
      `${percentOnly.join(', ')}: אחוזים בלבד, ללא מספרי מועמדים (—).`);
    note.style.gridColumn = '1 / -1';   // שורה מלאה מתחת לרשת הכרטיסים
    host.appendChild(note);
  }
}

/* הטבלה המלאה — כל ערך בכל פילוח, עמודה לכל קמפיין, עם צביעת
   מפת חום לפי מי מוביל בשורה. */
function renderComparisonTable(host, series) {
  const table = el('table', 't');
  const head = el('tr');
  // שם המדד יושב בשורת הכותרת של הגוש, ולכן אינו חוזר בכל שורה
  const headers = ['ערך'].concat(series.map(set => set.name));
  // עמודת הפער נופלת כשיש קמפיין אחד בלבד: אין מול מה להשוות
  const withDelta = series.length >= 2;
  if (withDelta) headers.push(`${series[0].name} מול ${series[1].name}`);
  headers.forEach(label => head.appendChild(el('th', null, label)));
  table.appendChild(head);

  const dimensions = [];
  series.forEach(set => Object.keys(set.profile || {}).forEach(dimension => {
    if (dimensions.indexOf(dimension) < 0) dimensions.push(dimension);
  }));
  const columns = headers.length;

  /* כל מדד הוא גוש בפני עצמו: שורת כותרת נושאת את שמו, כל שורותיו
     נושאות רקע משלו, וקו מפריד סוגר אותו. בלי זה כל המדדים נשפכו
     לטבלה אחת ארוכה, ולא היה ברור איפה נגמרת הדת ומתחיל המין. */
  let group = 0;
  dimensions.forEach(dimension => {
    const keys = new Set();
    series.forEach(set => Object.keys(set.profile[dimension] || {})
      .forEach(key => keys.add(key)));

    const rows = [...keys].filter(key =>
      series.some(set => ((set.profile[dimension] || {})[key] || 0) > 0));
    if (!rows.length) return;

    const band = group % 2 === 0 ? 'grp grp--a' : 'grp grp--b';
    group += 1;

    const title = el('tr', 'grp-head ' + band);
    const cell = el('td', null, dimension);
    cell.colSpan = columns;
    title.appendChild(cell);
    table.appendChild(title);

    // סדרה שחסר בה יותר מהסף — "—" בכל הממד, חוץ משורת החסר עצמה
    const hidden = series.map(set =>
      overMissing(missingShareIn(set.profile[dimension] || {})));
    rows.sort((a, b) => (a === NOT_STATED) - (b === NOT_STATED));

    rows.forEach((key, position) => {
      const values = series.map(set => (set.profile[dimension] || {})[key] || 0);
      const visible = values.filter((v, i) => !hidden[i] || key === NOT_STATED);
      const best = Math.max(...visible);
      const worst = Math.min(...visible);

      const tr = el('tr', band + (position === rows.length - 1 ? ' grp-last' : ''));
      tr.appendChild(el('td', 'grp-key', key));
      values.forEach((value, index) => {
        if (hidden[index] && key !== NOT_STATED) {
          const cell = el('td', 'num', '—');
          cell.title = `נתון חסר מעל ${Math.round(missingLimit() * 100)}% — לא מוצג`;
          tr.appendChild(cell);
          return;
        }
        const cell = el('td', 'num', pct(value));
        // צביעת מפת חום: המוביל ירוק, הנמוך אדום, והשאר ביניהם
        if (best > worst) {
          const t = (value - worst) / (best - worst);
          cell.style.background = mixColors('#3a2b2b', '#1e4634', t);
          cell.style.color = t > 0.6 ? '#8fe3b8' : '#e8b4b4';
          cell.style.fontWeight = value === best ? '700' : '500';
        }
        tr.appendChild(cell);
      });

      if (withDelta && (hidden[0] || hidden[1]) && key !== NOT_STATED) {
        tr.appendChild(el('td', 'num', '—'));
      } else if (withDelta) {
        const change = values[0] - values[1];
        const delta = el('td', 'num',
          (change > 0 ? '+' : '') + (change * 100).toFixed(1) + '%');
        delta.className = 'num ' + (Math.abs(change) < 0.01 ? 'delta-flat'
          : change > 0 ? 'delta-up' : 'delta-down');
        tr.appendChild(delta);
      }
      table.appendChild(tr);
    });
  });

  const card = el('div', 'card');
  card.appendChild(table);
  card.appendChild(el('div', 'tnote',
    'כל מדד מופרד לגוש משלו, וכל עמודה בו מסתכמת ל-100% כולל ' +
    '"נתון חסר". הצבע בכל שורה מסמן מי מוביל: ירוק לגבוה, אדום ' +
    `לנמוך. קמפיין שחסר לו בממד יותר מ-${Math.round(missingLimit() * 100)}% ` +
    'מוצג כ"—" בממד הזה, ורק שורת החסר שלו גלויה.'));
  host.appendChild(card);
}

/* השוואת עלויות: עלות לליד כוללת, ולפי פלטפורמה */
function renderComparisonCosts(series, hostId) {
  const host = document.getElementById(hostId || 'cc-comparison-costs');
  if (!host) return;
  host.innerHTML = '';

  const sources = series.map(set => ({
    name: set.name, costs: set.costs || {}, color: set.color }));

  const withData = sources.filter(source => source.costs.available);
  if (!withData.length) {
    host.innerHTML = '<div class="warn">אין נתוני עלות זמינים להשוואה.</div>';
    return;
  }

  const table = el('table', 't');
  const head = el('tr');
  ['קמפיין', 'תקציב', 'לידים', 'עלות לליד']
    .forEach(label => head.appendChild(el('th', null, label)));
  table.appendChild(head);
  withData.forEach(source => {
    const tr = el('tr');
    const name = el('td', null, source.name);
    name.style.borderInlineStart = '3px solid ' + source.color;
    tr.appendChild(name);
    tr.appendChild(el('td', 'num', money(source.costs.spent)));
    tr.appendChild(el('td', 'num', n(source.costs.leads)));
    tr.appendChild(el('td', 'num', money(source.costs.cpl)));
    table.appendChild(tr);
  });

  const card = el('div', 'card');
  card.appendChild(el('div', 'bartitle', 'עלות לליד — כלל הקמפיין'));
  card.appendChild(table);
  host.appendChild(card);

  // עלות לליד לפי פלטפורמה
  const platforms = new Set();
  withData.forEach(source => (source.costs.platforms || [])
    .forEach(row => platforms.add(row.platform)));
  if (!platforms.size) return;

  const byPlatform = el('table', 't');
  const head2 = el('tr');
  const headers = ['פלטפורמה'].concat(withData.map(source => source.name));
  headers.forEach(label => head2.appendChild(el('th', null, label)));
  byPlatform.appendChild(head2);

  [...platforms].forEach(platform => {
    const tr = el('tr');
    tr.appendChild(el('td', null, platform));
    withData.forEach(source => {
      const row = (source.costs.platforms || [])
        .find(item => item.platform === platform);
      tr.appendChild(el('td', 'num', row ? money(row.cpl) : '—'));
    });
    byPlatform.appendChild(tr);
  });

  const card2 = el('div', 'card');
  card2.appendChild(el('div', 'bartitle', 'עלות לליד — לפי פלטפורמה'));
  card2.appendChild(byPlatform);
  host.appendChild(card2);
}

/* ===== ייצוא לאקסל ===== */

/* מרכיב את קישור הייצוא מהסינון שפעיל ברגע זה, כדי שהקובץ יכיל
   בדיוק את מה שמוצג — אותו טווח תאריכים ואותם מסננים. */
function exportUrl(campaignId, screen) {
  const params = ['id=' + encodeURIComponent(campaignId),
                  'screen=' + encodeURIComponent(screen)];

  if (CC.data && CC.data.dateStart) {
    params.push('from=' + (CC.dateFrom === null ? CC.data.dateStart : dayToDate(CC.dateFrom)));
    params.push('to=' + (CC.dateTo === null ? CC.data.dateEnd : dayToDate(CC.dateTo)));
  }

  // לכל מסנן נשלחים הערכים שהוצאו, לפי שם העמודה באיחוד
  (CC.data.facets || []).forEach(facet => {
    const excluded = CC.selected[facet.key];
    if (!excluded || !excluded.size) return;
    const values = [...excluded].map(index => facet.values[index]);
    params.push('x_' + encodeURIComponent(facet.column || facet.label) +
                '=' + encodeURIComponent(values.join('|')));
  });

  return '/export?' + params.join('&');
}

/* קישור ייצוא המצגת — אותם פרמטרים בדיוק, נתיב אחר. שני הקבצים
   נבנים מאותו סינון ומאותה לשונית, ולכן אי אפשר שהמצגת תראה משהו
   אחר מהחוברת.

   הפרמטר screen הוא שקובע מה נכנס: השרת בונה ממנו מצגת של הלשונית
   הזו בלבד. הבורר שבלוח הראשי אינו שולח אותו כלל, ולכן משם יוצאת
   המצגת המלאה. */
function deckUrl(campaignId, screen) {
  return exportUrl(campaignId, screen).replace('/export?', '/export/deck?');
}

/* הורדת קובץ ייצוא מהענן.

   הקובץ אינו קיים ככתובת: הוא מטען ב-Firestore, נמשך רק אחרי
   אימות ורק למי שברשימת המורשים, ומורכב כאן לקובץ. זו הסיבה
   שהכפתור אינו קישור — אין למה להצביע. */
function downloadPayload(button, file) {
  if (!window.CC_GET) {
    ccToast('הקובץ יהיה זמין אחרי ההזדהות.');
    return;
  }
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'מוריד…';

  window.CC_GET(file.key).then(body => {
    const raw = atob(body['קובץ']);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes]));
    const link = document.createElement('a');
    link.href = url;
    link.download = body['תווית'] || file.name || 'ייצוא';
    document.body.appendChild(link);
    link.click();
    link.remove();
    // שחרור הזיכרון אחרי שהדפדפן הספיק להתחיל להוריד
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }).catch(error => {
    ccToast('ההורדה נכשלה: ' + (error && error.message ? error.message : error));
  }).then(() => {
    button.disabled = false;
    button.textContent = original;
  });
}

/* הודעה קצרה בתחתית המסך — אין כאן שרת שיציג עמוד שגיאה */
function ccToast(message) {
  let box = document.getElementById('cc-toast');
  if (!box) {
    box = el('div', 'cc-toast');
    box.id = 'cc-toast';
    document.body.appendChild(box);
  }
  box.textContent = message;
  box.classList.add('on');
  clearTimeout(ccToast._timer);
  ccToast._timer = setTimeout(() => box.classList.remove('on'), 6000);
}

function renderExport() {
  document.querySelectorAll('.export-bar').forEach(host => {
    const screen = host.dataset.export;
    const campaignId = host.dataset.campaign;
    if (!screen || !campaignId) return;

    host.innerHTML = '';

    /* בענן אין שרת שיבנה קובץ בלחיצה, ולכן הייצואים נבנו מראש
       בזמן הפרסום — באותו קוד בדיוק של גרסת השרת, כלומר אותן
       שקופיות ואותם גרפים ניתנים לעריכה. כאן רק מצביעים עליהם.

       מה שהם לא עושים הוא לכבד את הסינון שפעיל עכשיו: הם נבנו
       ברגע הפרסום, לפני שנפתח הדפדפן. ההערה אומרת זאת. */
    if (window.CC_CLOUD && window.CC_EXPORTS) {
      /* הקמפיין הנוכחי בענן נבחר בבורר שבראש העמוד ולא בכתובת,
         ולכן data-campaign שמוטבע ב-HTML הוא של הקמפיין הראשון
         בלבד. מי שמחזיק את הבחירה בפועל הוא cc-root, שהבורר
         מעדכן בכל שינוי. */
      const picker = document.getElementById('demo-campaign');
      const root = document.getElementById('cc-root');
      const current = (picker && picker.value)
                   || (root && root.dataset.campaign)
                   || campaignId;
      const entry = window.CC_EXPORTS[current]
                 || window.CC_EXPORTS[Object.keys(window.CC_EXPORTS)[0]];
      if (!entry) return;

      /* שני קבצים: המצגת המתכללת — לכל המורשים; ורשימת המועמדים
         באקסל — לראש חולייה בלבד. צופה אינו רואה את הכפתור, ומסמך
         הרשימה ("l_") חסום לו גם בחוקי הגישה שבשרת. */
      const lead = window.CC_ROLE === 'ראש חולייה';
      const items = [[entry.deck, '⭳ מצגת הקמפיין (PowerPoint)', 'go']];
      if (lead) items.unshift([entry.list, '⭳ ייצוא לאקסל — רשימת מועמדים', 'ghost']);
      items.forEach(item => {
        const [file, label, tone] = item;
        if (!file) return;
        const button = el('button', 'act-btn ' + tone, label);
        button.type = 'button';
        button.addEventListener('click', () => downloadPayload(button, file));
        host.appendChild(button);
      });

      const why = el('span', 'note');
      why.style.marginInlineStart = '12px';
      why.style.alignSelf = 'center';
      why.textContent = lead
        ? 'האקסל — רשימת כל המועמדים בקמפיין; המצגת — כל הלשוניות וכל ' +
          'הגרפים. שניהם נבנו בעדכון האחרון לענן ואינם מושפעים מהסינון ' +
          'שפעיל עכשיו במסך.'
        : 'המצגת מכילה את כל הלשוניות וכל הגרפים, ונבנתה בעדכון האחרון ' +
          'לענן. הורדת אקסל ורשימות מועמדים — בהרשאת ראש חולייה בלבד.';
      host.appendChild(why);
      return;
    }

    if (window.CC_STATIC) {
      ['⭳ ייצוא הלשונית לאקסל', '⭳ ייצוא הלשונית למצגת'].forEach(label => {
        const disabled = el('span', 'act-btn ghost', label);
        disabled.style.opacity = '.5';
        disabled.title = 'זמין בגרסת השרת המלאה';
        host.appendChild(disabled);
      });
      const why = el('span', 'note');
      why.style.marginInlineStart = '12px';
      why.style.alignSelf = 'center';
      why.textContent = 'הייצוא זמין בגרסת השרת המלאה. זהו אתר הדגמה לקריאה בלבד.';
      host.appendChild(why);
      return;
    }
    /* ייצוא לאקסל = רשימת המועמדים (מ-05/10/2026, במקום חוברת הטבלאות):
       שורה לכל מועמד בסינון שפעיל עכשיו — מספר מועמד, שלב בהליך, זמן
       בהליך, תאריך תחילת מועמדות, ואחריהם כל שאר הנתונים שלו. */
    const link = el('a', 'act-btn ghost', '⭳ ייצוא לאקסל — רשימת מועמדים');
    link.href = exportUrl(campaignId, screen);
    link.title = 'שורה לכל מועמד בסינון: שלב, זמן בהליך, תאריך תחילת מועמדות ועוד';
    host.appendChild(link);

    /* המצגת מוציאה את הלשונית שעליה אתה עומד, ואת כולה. מי שרוצה את
       הקמפיין כולו מוצא אותו בבורר שבלוח הראשי — שם אין "לשונית
       נוכחית", ולכן שם זו הכוונה. */
    const deck = el('a', 'act-btn go', '⭳ ייצוא הלשונית למצגת (PowerPoint)');
    deck.href = deckUrl(campaignId, screen);
    host.appendChild(deck);

    const note = el('span', 'note');
    note.style.marginInlineStart = '12px';
    note.style.alignSelf = 'center';
    note.textContent = 'האקסל — כל המועמדים בסינון שפעיל עכשיו. המצגת — "' +
      screen + '" במלואה. למצגת של הקמפיין כולו — הבורר שבלוח הראשי.';
    host.appendChild(note);
  });
}

/* ===== סטטוס קמפיינים ===== */

async function loadStatus() {
  const host = document.getElementById('cc-status');
  if (!host) return;

  const rows = await ccJson('/api/status');

  host.innerHTML = '';
  if (rows && rows.error) {
    host.innerHTML = '<div class="err">' + rows.error + '</div>';
    return;
  }
  if (!Array.isArray(rows) || !rows.length) {
    host.innerHTML = '<div class="warn">עדיין לא הוגדר אף קמפיין.</div>';
    return;
  }

  const totals = rows.reduce((acc, r) => ({
    leads: acc.leads + (r.leads || 0),
    active: acc.active + (r.active || 0),
    recruited: acc.recruited + (r.recruited || 0),
  }), { leads: 0, active: 0, recruited: 0 });

  const kpis = el('div', 'kpis');
  kpis.appendChild(tile(n(rows.length), 'קמפיינים במערכת', '', true));
  kpis.appendChild(tile(n(totals.leads), 'סך הלידים בכל הקמפיינים'));
  kpis.appendChild(tile(n(totals.active), 'מועמדים פעילים'));
  kpis.appendChild(tile(n(totals.recruited), 'גיוסים'));
  host.appendChild(kpis);

  const STATE_CLASS = {
    'תקין': 'ok', 'אזהרות': 'warn', 'שגיאות': 'err',
    'ממתין להרצה': 'pend', 'ריק': 'idle',
  };

  const table = el('table', 't');
  const head = el('tr');
  ['קמפיין', 'מצב', 'ריצה אחרונה', 'קבצים', 'ריצות', 'לידים', 'פעילים',
   'גויסו', 'אזהרות', 'שגיאות', 'רפרנטים', '']
    .forEach(label => head.appendChild(el('th', null, label)));
  table.appendChild(head);

  rows.forEach(row => {
    const tr = el('tr');
    tr.appendChild(el('td', null, row.name));

    const stateCell = el('td');
    const badge = el('span', 'badge ' + (STATE_CLASS[row.state] || 'idle'), row.state);
    stateCell.appendChild(badge);
    tr.appendChild(stateCell);

    tr.appendChild(el('td', null, row.lastRun || '—'));
    tr.appendChild(el('td', 'num', n(row.files)));
    tr.appendChild(el('td', 'num', n(row.runs)));
    tr.appendChild(el('td', 'num', row.leads === null ? '—' : n(row.leads)));
    tr.appendChild(el('td', 'num', row.active === null ? '—' : n(row.active)));
    tr.appendChild(el('td', 'num', row.recruited === null ? '—' : n(row.recruited)));
    tr.appendChild(el('td', 'num', n(row.warnings)));
    tr.appendChild(el('td', 'num', n(row.errors)));
    tr.appendChild(el('td', null, row.usesReferents ? 'עובד' : 'לא עובד'));

    const link = el('td');
    const anchor = el('a', 'act-btn', 'פתיחה');
    anchor.href = '/dashboard?id=' + encodeURIComponent(row.id);
    link.appendChild(anchor);
    tr.appendChild(link);

    table.appendChild(tr);
  });

  const card = el('div', 'card');
  card.appendChild(table);
  host.appendChild(card);
}

/* ===== לוח בקרה שנתי ===== */

const ANNUAL = { data: null, campaigns: new Set(), from: 0, to: 0, days: [] };

/* לכל קמפיין צבע משלו, קבוע לאורך כל הלוח השנתי — הצ'יפ, הטבלה
   והגרף מציגים את אותו הצבע, כך שאפשר לעקוב אחרי קמפיין במבט אחד. */
const ANNUAL_COLORS = ['#4F8EF7', '#22c39a', '#FFC857', '#f97362', '#a78bfa',
                       '#38bdf8', '#f472b6', '#8fc63f', '#fb923c', '#2dd4bf',
                       '#c084fc', '#facc15'];

/* נתוני 2025 — צבע קבוע משלהם, מחוץ לסבב צבעי הקמפיינים */
const ANNUAL_2025_COLOR = '#94a3b8';

function annualColor(campaignId) {
  const baseline = ANNUAL.data && ANNUAL.data.baseline2025;
  if (baseline && campaignId === baseline.id) return ANNUAL_2025_COLOR;
  const list = (ANNUAL.data && ANNUAL.data.campaigns) || [];
  const index = list.findIndex(c => c.id === campaignId);
  return ANNUAL_COLORS[(index < 0 ? 0 : index) % ANNUAL_COLORS.length];
}

async function loadAnnual() {
  // אותו מטען משרת את הלוח השנתי, את עמוד הבית שבענן ואת ציר
  // החודשים שבדף הראשי המקומי, ולכן די באחד המכלים כדי להצדיק
  // את הטעינה.
  const host = document.getElementById('cc-annual')
            || document.getElementById('cc-home')
            || document.getElementById('cc-home-months');
  if (!host) return;

  ANNUAL.data = await ccJson('/api/annual');

  if (ANNUAL.data && ANNUAL.data.error) {
    host.innerHTML = '<div class="err">' + ANNUAL.data.error + '</div>';
    ANNUAL.data = null;
    return;
  }
  if (!ANNUAL.data || !Array.isArray(ANNUAL.data.campaigns)) {
    host.innerHTML = '<div class="err">לא התקבלו נתוני הלוח השנתי.</div>';
    ANNUAL.data = null;
    return;
  }

  if (!ANNUAL.data.campaigns.length) {
    const chips = document.getElementById('cc-annual-chips');
    if (chips) chips.innerHTML =
      '<div class="warn">אין קמפיין עם ריצה. יש להעלות נתונים ולהריץ ניתוח.</div>';
    return;
  }

  // ברירת המחדל: הקמפיינים הפעילים ונתוני 2025 מסומנים, וכל הטווח
  // הקיים במערכת. אין קמפיין פעיל — כל הקמפיינים מסומנים.
  const live = ANNUAL.data.campaigns.filter(c => c.live);
  (live.length ? live : ANNUAL.data.campaigns)
    .forEach(c => ANNUAL.campaigns.add(c.id));
  if (ANNUAL.data.baseline2025) ANNUAL.campaigns.add(ANNUAL.data.baseline2025.id);
  const all = new Set();
  ANNUAL.data.campaigns.forEach(c => c.daily.forEach(d => all.add(d.date)));
  ANNUAL.days = [...all].sort();
  ANNUAL.from = 0;
  ANNUAL.to = Math.max(0, ANNUAL.days.length - 1);

  buildAnnualChips();
  buildAnnualRange();
  setupAnnualTabs();
  setupAnnualExport();
  renderAnnual();
}

/* לשוניות הלוח השנתי (07/10/2026) — כמו לשוניות הקמפיין: שורה
   למעלה, נושא אחד גלוי בכל רגע. הבחירה שמעליהן (קמפיינים וטווח)
   חלה על כל הלשוניות. הלשונית נשמרת בכתובת (#profile), כך שרענון
   או קישור חוזרים אליה. */
function setupAnnualTabs() {
  const bar = document.getElementById('cc-annual-tabs');
  if (!bar) return;
  const links = [...bar.querySelectorAll('a[data-annual-tab]')];
  const panes = [...document.querySelectorAll('[data-annual-pane]')];
  if (!links.length) return;

  function show(key) {
    links.forEach(link =>
      link.classList.toggle('on', link.dataset.annualTab === key));
    panes.forEach(pane => { pane.hidden = pane.dataset.annualPane !== key; });
  }

  links.forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    const key = link.dataset.annualTab;
    show(key);
    try { history.replaceState(null, '', '#' + key); } catch (e) { /* קובץ מקומי */ }
    // גרפים שצוירו בלשונית מוסתרת נמדדו ברוחב 0 — מודדים מחדש
    renderAnnual();
  }));

  const wanted = (location.hash || '').slice(1);
  const first = links.some(link => link.dataset.annualTab === wanted)
    ? wanted : links[0].dataset.annualTab;
  show(first);
}

/* צ'יפ לכל קמפיין — מודגש כשנבחר, עמום כשלא. בלי סימני וי. */
function buildAnnualChips() {
  const host = document.getElementById('cc-annual-chips');
  if (!host) return;
  host.innerHTML = '';

  const box = el('div', 'chips');
  ANNUAL.data.campaigns.forEach(campaign => {
    const on = ANNUAL.campaigns.has(campaign.id);
    const chip = el('button', 'chip chip--plain' + (on ? ' on' : ''));
    const color = annualColor(campaign.id);
    const dot = el('span', 'cdot');
    dot.style.background = color;
    chip.appendChild(dot);
    if (on) chip.style.borderColor = color;
    chip.appendChild(el('span', 'cname', campaign.name));
    chip.appendChild(el('span', 'cnum', n(campaign.total) + ' לידים'));
    chip.addEventListener('click', () => {
      if (on) ANNUAL.campaigns.delete(campaign.id);
      else ANNUAL.campaigns.add(campaign.id);
      buildAnnualChips();
      renderAnnual();
    });
    box.appendChild(chip);
  });

  // נתוני 2025 — צ'יפ אחרון, נבחר ומבוטל כמו כל קמפיין
  const baseline = ANNUAL.data.baseline2025;
  if (baseline) {
    const on = ANNUAL.campaigns.has(baseline.id);
    const chip = el('button', 'chip chip--plain' + (on ? ' on' : ''));
    const dot = el('span', 'cdot');
    dot.style.background = ANNUAL_2025_COLOR;
    chip.appendChild(dot);
    if (on) chip.style.borderColor = ANNUAL_2025_COLOR;
    chip.appendChild(el('span', 'cname', baseline.name));
    chip.appendChild(el('span', 'cnum', 'אחוזים בלבד'));
    chip.title = 'נתוני 2025 — משתתפים רק בגרפי הפרופיל הדמוגרפי';
    chip.addEventListener('click', () => {
      if (on) ANNUAL.campaigns.delete(baseline.id);
      else ANNUAL.campaigns.add(baseline.id);
      buildAnnualChips();
      renderAnnual();
    });
    box.appendChild(chip);
  }
  host.appendChild(box);
}

/* נתוני 2025 אם סומנו, אחרת null */
function annualBaseline() {
  const baseline = ANNUAL.data && ANNUAL.data.baseline2025;
  return baseline && ANNUAL.campaigns.has(baseline.id) ? baseline : null;
}

/* מחוון טווח: קו אחד, עיגול בכל קצה, והתאריך המילולי מעליו.
   מתחתיו צ'יפים של כל החודשים בטווח — לחיצה בוחרת חודש שלם. */
function buildAnnualRange() {
  const host = document.getElementById('cc-annual-range');
  if (!host || !ANNUAL.days.length) return;
  host.innerHTML = '';

  const last = ANNUAL.days.length - 1;
  const box = el('div', 'rangebox');

  const header = el('div', 'range-head');
  const fromLabel = el('span', 'range-date');
  const toLabel = el('span', 'range-date');
  header.appendChild(fromLabel);
  const spacer = el('span', 'range-line-label', 'טווח תאריכים');
  header.appendChild(spacer);
  header.appendChild(toLabel);
  box.appendChild(header);

  const track = el('div', 'range-track');
  const fill = el('div', 'range-fill');
  track.appendChild(fill);

  const fromInput = el('input', 'range-input range-from');
  const toInput = el('input', 'range-input range-to');
  [fromInput, toInput].forEach(input => {
    input.type = 'range';
    input.min = '0';
    input.max = String(last);
  });
  fromInput.value = String(ANNUAL.from);
  toInput.value = String(ANNUAL.to);
  track.appendChild(fromInput);
  track.appendChild(toInput);
  box.appendChild(track);

  function paint() {
    const left = last ? (ANNUAL.from / last) * 100 : 0;
    const right = last ? (ANNUAL.to / last) * 100 : 100;
    // RTL: ההתחלה בצד ימין
    fill.style.right = left + '%';
    fill.style.width = Math.max(0, right - left) + '%';
    fromLabel.textContent = hebrewDate(ANNUAL.days[ANNUAL.from]);
    toLabel.textContent = hebrewDate(ANNUAL.days[ANNUAL.to]);
  }

  fromInput.addEventListener('input', () => {
    ANNUAL.from = Math.min(Number(fromInput.value), ANNUAL.to);
    fromInput.value = String(ANNUAL.from);
    paint(); markMonths(); renderAnnual();
  });
  toInput.addEventListener('input', () => {
    ANNUAL.to = Math.max(Number(toInput.value), ANNUAL.from);
    toInput.value = String(ANNUAL.to);
    paint(); markMonths(); renderAnnual();
  });

  // חודשים
  const months = [];
  ANNUAL.days.forEach(day => {
    const key = day.slice(0, 7);
    if (!months.length || months[months.length - 1] !== key) {
      if (months.indexOf(key) < 0) months.push(key);
    }
  });

  const monthBox = el('div', 'months');
  const monthButtons = new Map();
  months.forEach(month => {
    const button = el('button', 'month', hebrewMonth(month));
    button.addEventListener('click', () => {
      const first = ANNUAL.days.findIndex(day => day.slice(0, 7) === month);
      let lastIndex = first;
      ANNUAL.days.forEach((day, index) => {
        if (day.slice(0, 7) === month) lastIndex = index;
      });
      ANNUAL.from = first;
      ANNUAL.to = lastIndex;
      fromInput.value = String(first);
      toInput.value = String(lastIndex);
      paint(); markMonths(); renderAnnual();
    });
    monthButtons.set(month, button);
    monthBox.appendChild(button);
  });

  const allButton = el('button', 'month month--all', 'כל הטווח');
  allButton.addEventListener('click', () => {
    ANNUAL.from = 0; ANNUAL.to = last;
    fromInput.value = '0'; toInput.value = String(last);
    paint(); markMonths(); renderAnnual();
  });
  monthBox.appendChild(allButton);
  box.appendChild(monthBox);

  function markMonths() {
    const from = ANNUAL.days[ANNUAL.from], to = ANNUAL.days[ANNUAL.to];
    monthButtons.forEach((button, month) => {
      const inside = ANNUAL.days.some(day =>
        day.slice(0, 7) === month && day >= from && day <= to);
      button.classList.toggle('on', inside);
    });
    allButton.classList.toggle('on', ANNUAL.from === 0 && ANNUAL.to === last);
  }

  const state = el('span', 'ctl-state');
  state.id = 'cc-annual-count';
  box.appendChild(state);

  host.appendChild(box);
  paint();
  markMonths();
}

const HEB_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי',
                    'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

function hebrewDate(iso) {
  if (!iso) return '';
  return `${iso.slice(8, 10)} ${HEB_MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

function hebrewMonth(key) {
  return `${HEB_MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;
}

/* רק קמפיינים שיש להם הגשות בתוך הטווח נכנסים להשוואה */
function annualSelection() {
  const from = ANNUAL.days[ANNUAL.from];
  const to = ANNUAL.days[ANNUAL.to];
  return ANNUAL.data.campaigns
    .filter(c => ANNUAL.campaigns.has(c.id))
    .map(campaign => {
      const daily = campaign.daily.filter(d => d.date >= from && d.date <= to);
      const inRange = daily.reduce((acc, d) => acc + d.count, 0);
      // המספרים המצטברים אינם מפולחים לפי יום, ולכן הם משוקללים לפי
      // חלק ההגשות שנכנס לטווח — קירוב מוצהר ולא ספירה מדויקת
      const ratio = campaign.total ? inRange / campaign.total : 0;
      const scale = value => (value === null || value === undefined)
        ? null : Math.round(value * ratio);
      return {
        ...campaign, daily, inRange, ratio,
        activeInRange: scale(campaign.active),
        recruitedInRange: scale(campaign.recruited),
        interviewInRange: scale(campaign.interview),
        daparInRange: scale(campaign.dapar),
        gibushonInRange: scale(campaign.gibushon),
        spentInRange: campaign.spent === null ? null : campaign.spent * ratio,
        orderedInRange: scale(campaign.ordered),
      };
    })
    .filter(campaign => campaign.inRange > 0);
}

function renderAnnual() {
  if (!ANNUAL.data) return;
  const selected = annualSelection();

  const count = document.getElementById('cc-annual-count');
  if (count) {
    const total = selected.reduce((acc, c) => acc + c.inRange, 0);
    count.textContent = `${n(selected.length)} קמפיינים בטווח · ${n(total)} הגשות`
      + (annualBaseline() ? ' · מול 2025' : '');
    count.classList.toggle('filtered',
      ANNUAL.from !== 0 || ANNUAL.to !== ANNUAL.days.length - 1 ||
      selected.length !== ANNUAL.data.campaigns.length);
  }

  renderHome();
  renderCampaignMonths();
  renderAnnualKpis(selected);
  renderAnnualTable(selected);
  renderAnnualMedia();
  renderAnnualTrend(selected);
  renderAnnualFunnels(selected);
  renderAnnualCharts(selected);
  fitBarLabels();
  tidyTables();
}

/* ===== לוח שנתי: השוואה גרפית בין קמפיינים ===== */

/* לכל קמפיין צבע אחד לכל אורך הניתוח — בצ'יפ הבחירה, בקו המגמה,
   במשפך שלו ובכל עמודה שלו בכל גרף השוואה. כך העין עוקבת אחרי
   קמפיין בין מסך למסך בלי לקרוא שמות. */

/* משפך אחד, מצויר בקטן. אותם שלבים ואותו סדר של מסך הקמפיין,
   כי הם מגיעים מאותה רשימה בשרת. */
/* המשפך מצויר ב-viewBox קבוע, וה-SVG נמתח לרוחב שהכרטיס נותן לו —
   כלומר האותיות גדלות וקטנות יחד עם הכרטיס.

   מכאן נבע שהטקסט יצא ענק: בשני קמפיינים הכרטיס קיבל חצי מסך,
   וגופן 11.5 ביחידות viewBox ברוחב 260 הופיע על המסך בגודל 24px.
   הפתרון אינו לשחק בגופן אלא לקבוע את רוחב הכרטיס: הוא מוגבל
   ל-260px ב-CSS, ולכן ה-SVG מצויר תמיד בערך בגודלו הטבעי,
   והגופן שכאן הוא הגופן שרואים — בלי קשר לכמה קמפיינים נבחרו.
   שמונה קמפיינים פורשים לשתי שורות של ארבעה, באותו גודל בדיוק. */
const FUNNEL_MINI = {
  width: 260,          // רוחב ה-viewBox, וגם רוחב הכרטיס בפועל
  band: 23,            // גובה שלב
  gap: 2,
  label: 12,           // גופן השם והכמות (יוצא ~11px על המסך)
  rate: 12,            // גופן האחוז — אינו מוקטן עם הכרטיס (ראו למטה)
  top: 0.34,           // חצי הרוחב בראש המשפך
  bottom: 0.09,        // ובקצה התחתון
  gutter: 60,          // המקום שמימין למשפך, לאחוזים שעל הקווים
};

/* האם תווית נכנסת ברוחב השלב. הערכה: תו עברי ממוצע ≈ 0.55 מגודל
   הגופן. משמש לבחירת צבע הטקסט — לבן בתוך המשפך, כהה כשהוא גולש. */
function fitsInBand(text, fontSize, bandWidth) {
  return String(text).length * fontSize * 0.55 + 8 <= bandWidth;
}

function annualFunnelSvg(campaign, color, scale) {
  const steps = campaign.funnel || [];
  if (!steps.length) return '';

  const box = FUNNEL_MINI;
  // כרטיס שרוחבו שונה מרוחב ה-viewBox (כמו בעמוד הבית) מקבל
  // תיקון גופן, כדי שהטקסט ייצא באותו גודל גם שם
  const grow = scale || 1;
  const width = box.width;
  const height = steps.length * (box.band + box.gap) + 6;
  const topHalf = width * box.top, bottomHalf = width * box.bottom;
  // המשפך זז שמאלה; האחוזים יושבים על הקווים שבין השלבים, צמודים לשוליו
  const cx = (width - box.gutter) / 2;
  const halfAt = i => topHalf - (topHalf - bottomHalf) * (i / steps.length);
  const topOf = i => 3 + i * (box.band + box.gap);

  const parts = [`<svg viewBox="0 0 ${width} ${height}" class="minifunnel" ` +
                 `preserveAspectRatio="xMidYMid meet">`];

  steps.forEach((step, index) => {
    const top = topOf(index);
    const bottom = top + box.band;
    const a = halfAt(index), b = halfAt(index + 1);
    const points = [[cx - a, top], [cx + a, top], [cx + b, bottom], [cx - b, bottom]]
      .map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');

    // אותו צבע לקמפיין, נעשה בהיר יותר ככל שיורדים במשפך
    const fade = 0.30 + 0.70 * (1 - index / Math.max(1, steps.length - 1));
    parts.push(`<polygon points="${points}" fill="${color}" ` +
               `fill-opacity="${fade.toFixed(2)}"/>`);

    const middle = top + box.band / 2 + (box.label * grow) / 3;
    const text = `${step.label} · ${n(step.value)}`;
    const fits = fitsInBand(text, box.label * grow, a + b);
    parts.push(`<text x="${cx}" y="${middle.toFixed(1)}" text-anchor="middle" ` +
               `style="fill:${fits ? '#fff' : 'var(--ink)'};` +
               `font-size:${(box.label * grow).toFixed(1)}px;` +
               `font-weight:600">${text}</text>`);

  });

  /* אחוז המעבר על כל קו שבין שני שלבים, בצבע הקמפיין ובגופן קבוע —
     בכרטיס של עמוד הבית התוויות מוקטנות (grow), והאחוז לא. */
  parts.push(funnelRates(steps, {
    edgeAt: i => cx + halfAt(i),
    lineAt: i => topOf(i) - box.gap / 2,
    size: box.rate, color,
  }));
  parts.push('</svg>');
  return parts.join('');
}

function renderAnnualFunnels(selected) {
  const host = document.getElementById('cc-annual-funnels');
  if (!host) return;
  host.innerHTML = '';
  if (!selected.length) return;

  selected.forEach(campaign => {
    const color = annualColor(campaign.id);
    const card = el('div', 'card funnelmini');

    const head = el('div', 'funnelmini-head');
    const dot = el('span', 'cdot');
    dot.style.background = color;
    head.appendChild(dot);
    head.appendChild(el('span', 'funnelmini-name', campaign.name));
    card.appendChild(head);

    const holder = el('div');
    holder.innerHTML = annualFunnelSvg(campaign, color);
    card.appendChild(holder);

    card.appendChild(el('div', 'emptynote',
      `${n(campaign.inRange)} הגשות · האחוז שעל הקו בין שני שלבים — המעבר מהשלב שמעליו`));
    host.appendChild(card);
  });

  // משפך 2025 (08/10/2026) — ספירות אמיתיות מהקובץ, לשנה כולה
  const baseline = annualBaseline();
  if (baseline && (baseline.funnel || []).length) {
    const card = el('div', 'card funnelmini');
    const head = el('div', 'funnelmini-head');
    const dot = el('span', 'cdot');
    dot.style.background = ANNUAL_2025_COLOR;
    head.appendChild(dot);
    head.appendChild(el('span', 'funnelmini-name', baseline.name));
    card.appendChild(head);
    const holder = el('div');
    holder.innerHTML = annualFunnelSvg(baseline, ANNUAL_2025_COLOR);
    card.appendChild(holder);
    const submitted = (baseline.funnel.find(s => s.key === 'submitted') || {}).value;
    card.appendChild(el('div', 'emptynote',
      `${n(submitted)} הגשות · שנה שלמה, בלי קשר לטווח · אין בנתונים "זומנו למבחן מקוון"`));
    host.appendChild(card);
  }
}

/* גרף השוואה אחד: לכל ערך בממד, עמודה לכל קמפיין בצבעו.

   הרוחב הוא השיעור בתוך הקמפיין ולא הכמות המוחלטת — אחרת קמפיין
   גדול היה מכסה קמפיין קטן בכל שורה, וההשוואה הייתה בין גדלים
   במקום בין תמהילים.

   כל סדרה מסתכמת ל-100% (07/10/2026): מי שאין לו ערך נספר בשורת
   "נתון חסר", ומה שמעבר לתשעה ערכים מתקבץ ל"ערכים נוספים" — שום
   חלק לא נשמט. סדרה שחסר בה יותר מהסף (20%) אינה מוצגת בגרף כלל,
   וההערה מתחת לגרף אומרת למה. */
const ANNUAL_TOP_VALUES = 9;

/* הנתונים של גרף השוואה אחד — המקור היחיד שממנו מצוירים גם הכרטיס
   שבמסך וגם הגרף שבמצגת (07/10/2026), כדי ששניהם לא יספרו שני סיפורים.
   מחזיר null כשאין לממד נתונים בכלל. */
function annualCompareData(dimensionKey, selected) {
  const series = [];             // [{campaign, values: Map, sum, percentOnly}]
  const missingItems = [];       // לכל סדרה: כמה חסר והאם הוסתרה

  selected.forEach(campaign => {
    const dim = campaign.dims[dimensionKey];
    if (!dim) return;
    // מי שלא ציין נספר כ"נתון חסר", והמכנה הוא כל המגישים — אותו
    // כלל של עוגות הפרופיל במסך הקמפיין
    const merged = new Map();
    Object.entries(dim.values || {}).forEach(([raw, value]) => {
      const name = isEmptyValue(raw) ? NOT_STATED : raw;
      merged.set(name, (merged.get(name) || 0) + value);
    });
    let sum = 0;
    merged.forEach(value => { sum += value; });
    if (!sum) return;
    const share = (merged.get(NOT_STATED) || 0) / sum;
    const hidden = overMissing(share);
    missingItems.push({ name: campaign.name, share, hidden });
    if (!hidden) series.push({ campaign, values: merged, sum, percentOnly: false });
  });

  // נתוני 2025 — סדרה נוספת, באחוזים בלבד (אין ספירות). הם שנה
  // שלמה, ואינם מושפעים מטווח התאריכים.
  const baseline = annualBaseline();
  const baseDim = baseline && baseline.dims[dimensionKey];
  if (baseDim) {
    const merged = new Map();
    Object.entries(baseDim.values || {}).forEach(([raw, value]) => {
      const name = isEmptyValue(raw) ? NOT_STATED : raw;
      merged.set(name, (merged.get(name) || 0) + value);
    });
    let sum = 0;
    merged.forEach(value => { sum += value; });
    const share = sum ? (merged.get(NOT_STATED) || 0) / sum : 0;
    const hidden = overMissing(share);
    missingItems.push({ name: baseline.name, share, hidden });
    if (sum && !hidden) {
      series.push({ campaign: baseline, values: merged, sum, percentOnly: true });
    }
  }

  if (!missingItems.length) return null;
  if (!series.length) return { series, groups: [], missingItems };

  // הערכים: לפי ציר אם יש, אחרת לפי גודל. מעבר לתשעה — "ערכים נוספים"
  const totals = new Map();
  series.forEach(item => item.values.forEach((value, name) => {
    if (name === NOT_STATED) return;
    totals.set(name, (totals.get(name) || 0) + value / item.sum);
  }));
  let values = [...totals.keys()];
  const order = axisOrder(dimensionKey);
  if (order) {
    values.sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
  } else {
    values.sort((a, b) => totals.get(b) - totals.get(a));
  }
  let rest = [];
  if (values.length > ANNUAL_TOP_VALUES) {
    rest = values.slice(ANNUAL_TOP_VALUES - 1);
    values = values.slice(0, ANNUAL_TOP_VALUES - 1);
  }

  // שורה לכל ערך: לכל סדרה החלק והכמות. "נתון חסר" תמיד אחרון.
  const rowsOf = name => series.map(item => {
    const names = name === OTHER_VALUES ? rest : [name];
    const value = names.reduce((acc, key) => acc + (item.values.get(key) || 0), 0);
    return {
      campaign: item.campaign,
      share: value / item.sum,
      count: item.percentOnly ? null : Math.round(value * item.campaign.ratio),
    };
  });
  const groups = values.map(name => ({ name, rows: rowsOf(name) }));
  if (rest.length) groups.push({ name: OTHER_VALUES, rows: rowsOf(OTHER_VALUES) });
  const missingRows = rowsOf(NOT_STATED);
  if (missingRows.some(row => row.share > 0)) {
    groups.push({ name: NOT_STATED, rows: missingRows });
  }
  return { series, groups, missingItems };
}

function annualCompareCard(label, dimensionKey, selected) {
  const data = annualCompareData(dimensionKey, selected);
  if (!data) return null;
  const { series, groups, missingItems } = data;
  const baseline = annualBaseline();

  const card = el('div', 'card barcard comparecard');
  card.appendChild(el('div', 'bartitle', label));
  card.dataset.dim = dimensionKey;
  card.dataset.series = series.map(item => item.campaign.id).join(',');

  if (!series.length) {
    card.appendChild(el('div', 'warn',
      'נתון חסר — בכל הקמפיינים שנבחרו חסר בממד הזה יותר מ-'
      + Math.round(missingLimit() * 100) + '%, ולכן אין השוואה.'));
    card.appendChild(el('div', 'emptynote', missingSummary(missingItems)));
    return card;
  }

  const peak = Math.max(0.01, ...groups.map(group =>
    Math.max(...group.rows.map(row => row.share))));

  const table = el('table', 'cmp');
  groups.forEach(group => {
    group.rows.forEach((row, index) => {
      const tr = el('tr', index === 0 ? 'cmp-first' : null);
      // שם הערך נכתב פעם אחת, בשורה הראשונה של הקבוצה
      const name = el('td', 'blab', index === 0 ? group.name : '');
      if (index === 0) markSentiment(name, dimensionKey, group.name);
      tr.appendChild(name);

      // אותו כלל של כל גרף במערכת: האחוז בתוך העמודה הצבועה,
      // והכמות בסוף השורה
      const color = group.name === NOT_STATED ? NOT_STATED_COLOR
        : annualColor(row.campaign.id);
      const cell = el('td', 'bwrap');
      const track = el('div', 'btrack btrack--thin');
      const bar = el('div', 'bbar bbar--labelled');
      bar.style.width = Math.max(3, (row.share / peak) * 100) + '%';
      bar.style.background = color;
      if (group.name === NOT_STATED) {
        bar.style.outline = '2px solid ' + annualColor(row.campaign.id);
      }
      bar.title = `${row.campaign.name}: ${pct(row.share)}`
        + (row.count === null ? '' : ` (${n(row.count)})`);
      const tag = el('span', 'bpct', pct(row.share));
      tag.dataset.color = color;
      bar.appendChild(tag);
      track.appendChild(bar);
      cell.appendChild(track);
      tr.appendChild(cell);

      // 2025: אחוזים בלבד
      tr.appendChild(el('td', 'bval', row.count === null ? '—' : n(row.count)));
      table.appendChild(tr);
    });
  });

  card.appendChild(table);
  // מקרא הצבעים יושב מתחת לגרף עצמו: בלעדיו אי אפשר לדעת איזו
  // עמודה שייכת לאיזה קמפיין, כי השם נכתב רק בריחוף
  card.appendChild(seriesLegend(series.map(item => ({
    name: item.campaign.name, color: annualColor(item.campaign.id) }))));
  const summary = missingSummary(missingItems);
  if (summary) card.appendChild(el('div', 'emptynote cmp-missing', summary));
  card.appendChild(el('div', 'emptynote',
    'הרוחב והאחוז הם שיעור הערך בתוך כל קמפיין, וכל קמפיין מסתכם '
    + 'ל-100%. הכמות בסוף השורה.'
    + (series.some(item => item.percentOnly)
      ? ` ${baseline.name}: אחוזים בלבד, ללא מספרי מועמדים (—), `
        + 'לשנה כולה — בלי קשר לטווח התאריכים.' : '')));
  return card;
}

function renderAnnualKpis(selected) {
  const host = document.getElementById('cc-annual-kpis');
  if (!host) return;
  host.innerHTML = '';

  const totals = selected.reduce((acc, c) => ({
    leads: acc.leads + c.inRange,
    ordered: acc.ordered + (c.orderedInRange || 0),
    recruited: acc.recruited + (c.recruitedInRange || 0),
    gibushon: acc.gibushon + (c.gibushonInRange || 0),
    spent: acc.spent + (c.spentInRange || 0),
  }), { leads: 0, ordered: 0, recruited: 0, gibushon: 0, spent: 0 });

  host.appendChild(tile(n(totals.leads), 'לידים במערכת',
                        `${selected.length} קמפיינים בטווח`, true));
  host.appendChild(tile(n(totals.ordered), 'לידים שהוזמנו'));
  host.appendChild(tile(money(totals.spent), 'תקציב'));
  host.appendChild(tile(totals.leads ? money(totals.spent / totals.leads) : '—',
                        'עלות לליד'));
  host.appendChild(tile(totals.gibushon ? money(totals.spent / totals.gibushon) : '—',
                        'עלות לגיבושון'));
  host.appendChild(tile(totals.recruited ? money(totals.spent / totals.recruited) : '—',
                        'עלות לגיוס'));
}

function renderAnnualTable(selected) {
  const host = document.getElementById('cc-annual-table');
  if (!host) return;
  host.innerHTML = '';

  const table = el('table', 't');
  const head = el('tr');
  ['שם קמפיין', 'תקציב', 'לידים שהוזמנו', 'לידים במערכת',
   'דפ"ר', 'רמה', 'גיבושון', 'גיוס',
   'עלות לליד', 'עלות לגיבושון', 'עלות לגיוס']
    .forEach(label => head.appendChild(el('th', null, label)));
  table.appendChild(head);

  const sorted = [...selected].sort((a, b) => b.inRange - a.inRange);
  sorted.forEach(campaign => {
    const spent = campaign.spentInRange;
    const tr = el('tr');
    const nameCell = el('td');
    const swatch = el('span', 'cdot');
    swatch.style.background = annualColor(campaign.id);
    nameCell.appendChild(swatch);
    nameCell.appendChild(document.createTextNode(campaign.name));
    tr.appendChild(nameCell);
    tr.appendChild(el('td', 'num', money(spent)));
    tr.appendChild(el('td', 'num', n(campaign.orderedInRange)));
    tr.appendChild(el('td', 'num', n(campaign.inRange)));
    tr.appendChild(el('td', 'num', n(campaign.daparInRange)));
    tr.appendChild(el('td', 'num', n(campaign.interviewInRange)));
    tr.appendChild(el('td', 'num', n(campaign.gibushonInRange)));
    tr.appendChild(el('td', 'num', n(campaign.recruitedInRange)));
    tr.appendChild(el('td', 'num',
      spent && campaign.inRange ? money(spent / campaign.inRange) : '—'));
    tr.appendChild(el('td', 'num',
      spent && campaign.gibushonInRange ? money(spent / campaign.gibushonInRange) : '—'));
    tr.appendChild(el('td', 'num',
      spent && campaign.recruitedInRange ? money(spent / campaign.recruitedInRange) : '—'));
    table.appendChild(tr);
  });

  // שורת סיכום
  if (sorted.length > 1) {
    const totals = sorted.reduce((acc, c) => ({
      spent: acc.spent + (c.spentInRange || 0),
      ordered: acc.ordered + (c.orderedInRange || 0),
      leads: acc.leads + c.inRange,
      dapar: acc.dapar + (c.daparInRange || 0),
      interview: acc.interview + (c.interviewInRange || 0),
      gibushon: acc.gibushon + (c.gibushonInRange || 0),
      recruited: acc.recruited + (c.recruitedInRange || 0),
    }), { spent: 0, ordered: 0, leads: 0, dapar: 0, interview: 0,
          gibushon: 0, recruited: 0 });

    const tr = el('tr');
    const label = el('td', null, 'סה"כ');
    label.style.fontWeight = '700';
    tr.appendChild(label);
    [money(totals.spent), n(totals.ordered), n(totals.leads), n(totals.dapar),
     n(totals.interview), n(totals.gibushon), n(totals.recruited),
     totals.leads ? money(totals.spent / totals.leads) : '—',
     totals.gibushon ? money(totals.spent / totals.gibushon) : '—',
     totals.recruited ? money(totals.spent / totals.recruited) : '—']
      .forEach(value => tr.appendChild(el('td', 'num', value)));
    table.appendChild(tr);
  }

  const card = el('div', 'card');
  card.appendChild(table);
  card.appendChild(el('div', 'tnote',
    'שלושת העמודות האחרונות הן עלות מהתקציב לכל יחידה. ' +
    '"גיבושון" הוא מרכז ההערכה. המספרים בטווח מחושבים לפי חלק ההגשות ' +
    'שנכנס אליו — הדוחות אינם מפולחים לפי יום, ולכן זהו קירוב מוצהר.'));
  host.appendChild(card);
}

/* --- טבלת המדיה של הלוח השנתי ---

   בניגוד לכל השאר בלוח, הטבלה הזו אינה מגיבה לסימון הקמפיינים
   ולא לטווח התאריכים: היא מציגה תמיד את כל הקמפיינים, כפי שהם
   בריצה האחרונה של כל אחד. זו הייתה הבקשה — טבלה אחת שרואים בסוף
   ושמתעדכנת מעצמה, בלי לזכור מה סומן.

   נתוני המדיה ממילא אינם מפולחים לפי יום, ולכן חיתוך שלהם לטווח
   היה קירוב על גבי קירוב. */

function renderAnnualMedia() {
  const host = document.getElementById('cc-annual-media');
  if (!host) return;
  host.innerHTML = '';

  const campaigns = (ANNUAL.data && ANNUAL.data.campaigns) || [];
  if (!campaigns.length) return;

  const table = el('table', 't');
  const head = el('tr');
  ['קמפיין', 'לידים חיצוני', 'לידים פנימי', 'צפיות', 'הקלקות', 'עלות',
   'עלות לליד חיצוני', 'עלות לליד פנימי']
    .forEach(label => head.appendChild(el('th', null, label)));
  table.appendChild(head);

  const totals = { external: 0, internal: 0, impressions: 0, clicks: 0, spent: 0 };

  campaigns.forEach(campaign => {
    const external = campaign.external || 0;
    const internal = campaign.total || 0;
    const spent = campaign.spent || 0;
    totals.external += external;
    totals.internal += internal;
    totals.impressions += campaign.impressions || 0;
    totals.clicks += campaign.clicks || 0;
    totals.spent += spent;

    const tr = el('tr');
    const nameCell = el('td');
    const swatch = el('span', 'cdot');
    swatch.style.background = annualColor(campaign.id);
    nameCell.appendChild(swatch);
    nameCell.appendChild(document.createTextNode(campaign.name));
    tr.appendChild(nameCell);
    tr.appendChild(el('td', 'num', external ? n(external) : '—'));
    tr.appendChild(el('td', 'num', n(internal)));
    tr.appendChild(el('td', 'num', campaign.impressions ? n(campaign.impressions) : '—'));
    tr.appendChild(el('td', 'num', campaign.clicks ? n(campaign.clicks) : '—'));
    tr.appendChild(el('td', 'num', spent ? money(spent) : '—'));
    tr.appendChild(el('td', 'num', spent && external ? money(spent / external) : '—'));
    tr.appendChild(el('td', 'num', spent && internal ? money(spent / internal) : '—'));
    table.appendChild(tr);
  });

  if (campaigns.length > 1) {
    const tr = el('tr');
    const label = el('td', null, 'סה"כ');
    label.style.fontWeight = '700';
    tr.appendChild(label);
    [n(totals.external), n(totals.internal), n(totals.impressions),
     n(totals.clicks), money(totals.spent),
     totals.external ? money(totals.spent / totals.external) : '—',
     totals.internal ? money(totals.spent / totals.internal) : '—']
      .forEach(value => tr.appendChild(el('td', 'num', value)));
    table.appendChild(tr);
  }

  const card = el('div', 'card');
  card.appendChild(table);
  card.appendChild(el('div', 'tnote',
    'כל הקמפיינים, ללא תלות בסימון ובטווח שלמעלה. נתוני המדיה הם ' +
    'סך הקמפיין כולו — הם אינם מגיעים מפולחים לפי יום. בגוגל ' +
    'פימקס וחיפוש נספרים יחד; הפילוח ביניהם מופיע כהערה במסך ' +
    'ביצועי הקמפיין.'));
  host.appendChild(card);
}

function renderAnnualTrend(selected) {
  const host = document.getElementById('cc-annual-trend');
  if (!host) return;
  host.innerHTML = '';
  if (!selected.length) return;

  /* קו לכל קמפיין בצבע שלו, על אותו ציר זמן — כך רואים מי פעל מתי
     ומי הביא יותר, בלי לאחד את כולם לקו אחד חסר משמעות. */
  const days = new Set();
  selected.forEach(c => c.daily.forEach(d => days.add(d.date)));
  if (!days.size) return;
  const axis = [...days].sort();
  const at = new Map(axis.map((day, i) => [day, i]));

  const series = selected.map(campaign => {
    const values = new Array(axis.length).fill(null);
    campaign.daily.forEach(day => {
      const i = at.get(day.date);
      if (i !== undefined) values[i] = (values[i] || 0) + day.count;
    });
    return { name: campaign.name, color: annualColor(campaign.id), values };
  });

  const width = 960, height = 250;
  const padLeft = 50, padBottom = 32, padTop = 14, padRight = 14;
  const plotW = width - padLeft - padRight, plotH = height - padTop - padBottom;
  let max = 0;
  series.forEach(line => line.values.forEach(v => { if (v > max) max = v; }));
  max = max || 1;
  const x = i => padLeft + (axis.length === 1 ? plotW / 2
    : (i / (axis.length - 1)) * plotW);
  const y = value => padTop + plotH - (value / max) * plotH;

  const parts = [`<svg class="tsvg" viewBox="0 0 ${width} ${height}">`];
  for (let step = 0; step <= 4; step++) {
    const value = (max / 4) * step, yy = y(value);
    parts.push(`<line class="tgrid" x1="${padLeft}" y1="${yy}" x2="${width - padRight}" y2="${yy}"/>`);
    parts.push(`<text class="tylab" x="${padLeft - 8}" y="${yy + 3}">${n(value)}</text>`);
  }

  series.forEach(line => {
    let path = '', open = false;
    line.values.forEach((value, i) => {
      if (value === null) { open = false; return; }
      path += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(value).toFixed(1)} `;
      open = true;
    });
    if (path) {
      parts.push(`<path d="${path.trim()}" fill="none" stroke="${line.color}" ` +
                 `stroke-width="2.2" stroke-linejoin="round"/>`);
    }
  });

  /* תווית נתונים לכל קו, בצבע הקו שאותו היא מתארת — בדיוק כמו
     בגרף ההגשות לפי פלטפורמה.

     התוויות נכתבות על שיאים מקומיים בלבד, וגם אז רק כשאין תווית
     אחרת קרובה: על ציר של חודשים שלמים, ועם כמה קמפיינים במקביל,
     תווית לכל נקודה הייתה הופכת לקיר של מספרים. */
  const taken = [];
  const fits = (px, py) => !taken.some(t =>
    Math.abs(t[0] - px) < 26 && Math.abs(t[1] - py) < 12);

  series.forEach(line => {
    line.values.forEach((value, i) => {
      if (!value) return;
      const before = i > 0 ? line.values[i - 1] : -1;
      const after = i < line.values.length - 1 ? line.values[i + 1] : -1;
      if (value < before || value < after) return;
      const px = x(i), py = y(value) - 6;
      if (!fits(px, py)) return;
      taken.push([px, py]);
      parts.push(`<text x="${px.toFixed(1)}" y="${py.toFixed(1)}" ` +
                 `text-anchor="middle" style="fill:${line.color};font-size:9px;` +
                 `font-weight:700">${n(value)}</text>`);
    });
  });

  const step = Math.max(1, Math.floor(axis.length / 9));
  axis.forEach((day, i) => {
    if (i % step === 0 || i === axis.length - 1) {
      parts.push(`<text class="txlab" x="${x(i).toFixed(1)}" y="${height - 10}">` +
                 `${day.slice(8, 10)}/${day.slice(5, 7)}</text>`);
    }
  });
  parts.push('</svg>');

  const card = el('div', 'card trendcard');
  card.appendChild(el('div', 'bartitle', 'הגשות יומיות — לפי קמפיין'));
  const holder = el('div');
  holder.innerHTML = parts.join('');
  card.appendChild(holder);

  const legend = el('div', 'linelegend');
  series.forEach(line => {
    const item = el('span', 'lineitem');
    const swatch = el('i', 'lineswatch');
    swatch.style.background = line.color;
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(line.name));
    legend.appendChild(item);
  });
  card.appendChild(legend);
  card.appendChild(el('div', 'tnote', `${axis.length} ימים בטווח`));
  host.appendChild(card);
}

/* כל הגרפים, מסודרים לפי המסך שאליו הם שייכים.

   הסדר מגיע מהשרת (payload.sections), ולכן מי שמכיר את מסכי
   הקמפיין מוצא את עצמו גם כאן: קטגוריה לכל מסך, ובתוכה הגרפים
   של אותו מסך — בהשוואה בין הקמפיינים ולא במיזוג שלהם. */
function renderAnnualCharts(selected) {
  // כל מקטע בלשונית משלו (cc-annual-sec-<מקטע>, 07/10/2026). עמוד
  // בלי לשוניות — כל המקטעים ברצף, תחת cc-annual-charts.
  const host = document.getElementById('cc-annual-charts');
  const sectionHost = key => document.getElementById('cc-annual-sec-' + key);
  const sections = ANNUAL.data.sections || [];
  sections.forEach(section => {
    const target = sectionHost(section.key);
    if (target) target.innerHTML = '';
  });
  if (host) host.innerHTML = '';
  if (!host && !sections.some(section => sectionHost(section.key))) return;
  // נתוני 2025 משתתפים גם בלי קמפיין מסומן
  if (!selected.length && !annualBaseline()) return;

  const labels = {};
  (ANNUAL.data.dimensions || []).forEach(d => { labels[d.key] = d.label; });

  sections.forEach(section => {
    const cards = [];

    // "הגשות" פותח בגרף היום בשבוע, שאינו ממד רגיל אלא נגזר
    // מתאריך ההגשה
    if (section.key === 'submissions') {
      const weekday = annualWeekdayCard(selected);
      if (weekday) cards.push(weekday);
    }

    (section.dims || []).forEach(key => {
      const card = annualCompareCard(labels[key] || key, key, selected);
      if (card) cards.push(card);
    });

    const target = sectionHost(section.key);
    if (!cards.length) {
      if (target) target.appendChild(el('div', 'emptynote',
        'אין נתונים להשוואה בקמפיינים ובטווח שנבחרו.'));
      return;
    }
    const row = el('div', 'barstack');
    cards.forEach(card => row.appendChild(card));
    if (target) {
      target.appendChild(row);
      return;
    }
    if (!host) return;
    host.appendChild(el('h3', 'annual-section', section.label));
    host.appendChild(row);
  });
}

/* הגשות לפי יום בשבוע — עמודה לכל קמפיין, בצבעו. */
function annualWeekdayCard(selected) {
  const order = ANNUAL.data.weekdayOrder || [];
  if (!order.length) return null;

  const rows = selected
    .map(campaign => ({ campaign, values: campaign.weekday || {} }))
    .filter(row => Object.keys(row.values).length);
  if (!rows.length) return null;

  const shares = rows.map(row => {
    const sum = Object.values(row.values).reduce((a, b) => a + b, 0) || 1;
    return { campaign: row.campaign, values: row.values, sum };
  });
  const peak = Math.max(...shares.map(
    row => Math.max(...order.map(day => (row.values[day] || 0) / row.sum))), 0.01);

  const card = el('div', 'card barcard comparecard');
  card.appendChild(el('div', 'bartitle', 'הגשות לפי יום בשבוע'));

  const table = el('table', 'cmp');
  order.forEach(day => {
    shares.forEach((row, index) => {
      const count = row.values[day] || 0;
      const share = count / row.sum;
      const tr = el('tr', index === 0 ? 'cmp-first' : null);
      tr.appendChild(el('td', 'blab', index === 0 ? day : ''));

      const color = annualColor(row.campaign.id);
      const cell = el('td', 'bwrap');
      const track = el('div', 'btrack btrack--thin');
      const bar = el('div', 'bbar bbar--labelled');
      bar.style.width = Math.max(3, (share / peak) * 100) + '%';
      bar.style.background = color;
      bar.title = `${row.campaign.name}: ${pct(share)} (${n(count)})`;
      const tag = el('span', 'bpct', pct(share));
      tag.dataset.color = color;
      bar.appendChild(tag);
      track.appendChild(bar);
      cell.appendChild(track);
      tr.appendChild(cell);
      tr.appendChild(el('td', 'bval', n(count)));
      table.appendChild(tr);
    });
  });

  card.appendChild(table);
  card.appendChild(el('div', 'emptynote',
    'האחוז שבתוך העמודה הוא שיעור היום בתוך כל קמפיין, והכמות '
    + 'בסוף השורה. צבע לכל קמפיין.'));
  return card;
}

/* ===== לוח שנתי: ייצוא למצגת (07/10/2026) =====

   המצגת נבנית בדפדפן, מהקמפיינים שמסומנים עכשיו ומהטווח שנבחר —
   גם בענן, שבו אין שרת שיבנה קובץ בלחיצה, ולכן אי אפשר לבנות אותה
   מראש לכל צירוף של קמפיינים. הספרייה (PptxGenJS, assets/
   pptxgen.bundle.js) נטענת רק ברגע הייצוא ואינה דורשת רשת.

   שני שלבים, בכוונה:
     annualDeckModel — מה נכנס לכל שקופית, במספרים. הגרפים נבנים
       מ-annualCompareData, אותה פונקציה שמציירת את הכרטיסים במסך,
       ולכן המצגת והמסך אינם יכולים לומר דברים שונים. אלי הדיבגר
       בודק את המודל הזה לפני כל עלייה לענן.
     annualPptx — איך זה נראה: אותה שפה של מצגת סיכום הקמפיין
       (app/powerpoint.py) — פס כותרת נייבי, כרטיסי מספר עם כובע
       צבעוני, שורת סיכום בתחתית — וכל הטקסט מימין לשמאל.

   כל שקופית היא לשונית אחת בלוח. כפתור בכל לשונית מוציא אותה לבדה;
   הכפתור שמעל הלשוניות מוציא את כולן, עם שער. */

const DECK = {
  W: 13.333, H: 7.5, M: 0.5,
  BAND: 0.92,                 // פס הכותרת
  FOOT: 6.92,                 // שורת הסיכום
  INK_DEEP: '0A1628', BLUE: '3B82F6', DEEP: '2255A0', AMBER: 'F59E0B',
  ORANGE: 'F97316', GREEN: '10B981', MUTED: '64748B', INK: '1B2538',
  LINE: 'E2E8F0', PAPER: 'FFFFFF', BAND_BG: 'F6F8FC',
  FONT: 'Arial',
};
const DECK_ACCENTS = [DECK.AMBER, DECK.DEEP, DECK.BLUE, DECK.ORANGE, DECK.GREEN, '8B5CF6'];

/* הלשוניות שבמצגת, בסדר הלשוניות במסך (screens.ANNUAL_TABS) */
const ANNUAL_DECK_TABS = [
  ['summary', 'סיכום ומגמה'], ['profile', 'פרופיל דמוגרפי'],
  ['submissions', 'הגשות'], ['map', 'מפת הגשות'], ['funnel', 'משפך הגיוס'],
  ['performance', 'ביצועי קמפיין'], ['reason', 'סיבה להפסקת הליך'],
  ['media', 'מדיה מול תוצאות'],
];

// לכל היותר שלושה גרפים זה לצד זה בשקופית; יותר — שקופית המשך
const DECK_CHARTS_PER_SLIDE = 3;

const hex = color => String(color || '').replace('#', '').toUpperCase();

/* תווית בלי אף אות עברית ("47+", "03") בתוך גרף עברי: בלי סימוני
   כיוון ה-+ קופץ לצד השני ("+47"). LRM משני הצדדים מחזיק אותה כמקשה. */
const bidiLabel = label => (/[\u0590-\u05FF]/.test(label) ? String(label)
  : '\u200E' + label + '\u200E');

/* הסכומים של כרטיסי הסיכום — אותם חישובים של renderAnnualKpis */
function annualKpiTotals(selected) {
  return selected.reduce((acc, c) => ({
    leads: acc.leads + c.inRange,
    ordered: acc.ordered + (c.orderedInRange || 0),
    recruited: acc.recruited + (c.recruitedInRange || 0),
    gibushon: acc.gibushon + (c.gibushonInRange || 0),
    spent: acc.spent + (c.spentInRange || 0),
  }), { leads: 0, ordered: 0, recruited: 0, gibushon: 0, spent: 0 });
}

/* גרף השוואה במודל: לכל סדרה מוצגת — שם, צבע, והחלקים לפי הערכים */
function deckShareChart(title, dimensionKey, selected) {
  const data = annualCompareData(dimensionKey, selected);
  if (!data) return null;
  return {
    kind: 'share', title, dim: dimensionKey,
    labels: data.groups.map(group => group.name),
    series: data.series.map((item, index) => ({
      id: item.campaign.id, name: item.campaign.name,
      color: hex(annualColor(item.campaign.id)),
      percentOnly: item.percentOnly,
      values: data.groups.map(group => group.rows[index].share),
    })),
    missing: data.missingItems,
  };
}

/* הגשות לפי יום בשבוע — אותו חישוב של annualWeekdayCard */
function deckWeekdayChart(selected) {
  const order = ANNUAL.data.weekdayOrder || [];
  const rows = selected.filter(c => Object.keys(c.weekday || {}).length);
  if (!order.length || !rows.length) return null;
  return {
    kind: 'share', title: 'הגשות לפי יום בשבוע', dim: 'weekday', labels: order,
    series: rows.map(campaign => {
      const sum = Object.values(campaign.weekday).reduce((a, b) => a + b, 0) || 1;
      return { id: campaign.id, name: campaign.name,
               color: hex(annualColor(campaign.id)), percentOnly: false,
               values: order.map(day => (campaign.weekday[day] || 0) / sum) };
    }),
    missing: [],
  };
}

/* משפך: כל שלב כשיעור מההגשות — funnelCompareData, כמו בלשונית
   ההשוואה. במצגת רק שלבים שיש לכל הסדרות: תא ריק בגרף PowerPoint
   הוא קובץ שבור, ואפס במקום "אין נתון" הוא שקר. השלב שהושמט נכתב
   בהערה. 2025 נכנס כשהוא מסומן (08/10/2026). */
function deckFunnelChart(selected) {
  const series = selected.map(c => ({ id: c.id, name: c.name,
    color: hex(annualColor(c.id)), funnel: c.funnel || [] }));
  const baseline = annualBaseline();
  if (baseline && (baseline.funnel || []).length) {
    series.push({ id: baseline.id, name: baseline.name,
                  color: hex(ANNUAL_2025_COLOR), funnel: baseline.funnel });
  }
  const data = funnelCompareData(series);
  if (!data.rows.length || !data.common.length) return null;
  const at = data.common.map(key => data.keys.indexOf(key));
  const dropped = data.keys.filter(key => data.common.indexOf(key) < 0)
    .map(key => data.labels[data.keys.indexOf(key)]);
  return {
    kind: 'rate', title: 'משפך הגיוס — שיעור מההגשות', dim: 'funnel',
    labels: at.map(i => data.labels[i]),
    series: data.rows.map(row => ({
      id: row.id, name: row.name, color: row.color,
      percentOnly: baseline ? row.id === baseline.id : false,
      submitted: row.submitted,
      counts: at.map(i => row.steps[i].value),
      values: at.map(i => row.steps[i].share),
    })),
    missing: [],
    note: 'המשפך הוא של הקמפיין כולו (כמו במסך), ואינו נחתך לטווח התאריכים.'
        + (dropped.length ? ` לא בגרף: ${dropped.join(', ')} — אין נתון לכל הסדרות.` : ''),
  };
}

/* מגמה שבועית — קו לכל קמפיין, שבוע מתחיל ביום ראשון */
function deckTrendChart(selected) {
  const weekOf = iso => {
    const day = new Date(iso + 'T00:00:00Z');
    day.setUTCDate(day.getUTCDate() - day.getUTCDay());
    return day.toISOString().slice(0, 10);
  };
  const weeks = new Set();
  selected.forEach(c => c.daily.forEach(d => weeks.add(weekOf(d.date))));
  const axis = [...weeks].sort();
  if (!axis.length) return null;
  return {
    kind: 'line', title: 'הגשות לפי שבוע — לפי קמפיין', dim: 'trend',
    labels: axis.map(w => `${w.slice(8, 10)}/${w.slice(5, 7)}`),
    series: selected.map(campaign => {
      const values = new Array(axis.length).fill(0);
      campaign.daily.forEach(d => { values[axis.indexOf(weekOf(d.date))] += d.count; });
      return { id: campaign.id, name: campaign.name,
               color: hex(annualColor(campaign.id)), values };
    }),
    missing: [],
  };
}

/* כל מה שנכנס למצגת, במספרים. tabs — אילו לשוניות (ברירת מחדל: כולן). */
function annualDeckModel(selected, tabs) {
  const wanted = new Set(tabs || ANNUAL_DECK_TABS.map(t => t[0]));
  const labels = {};
  (ANNUAL.data.dimensions || []).forEach(d => { labels[d.key] = d.label; });
  const sections = {};
  (ANNUAL.data.sections || []).forEach(s => { sections[s.key] = s; });
  const from = ANNUAL.days[ANNUAL.from], to = ANNUAL.days[ANNUAL.to];
  const baseline = annualBaseline();
  const leads = selected.reduce((acc, c) => acc + c.inRange, 0);

  const model = {
    campaigns: selected.map(c => ({ id: c.id, name: c.name, color: hex(annualColor(c.id)),
                                    leads: c.inRange })),
    baseline: baseline ? { id: baseline.id, name: baseline.name,
                           color: hex(ANNUAL_2025_COLOR) } : null,
    from, to, leads, slides: [],
  };

  const sectionCharts = key => ((sections[key] || {}).dims || [])
    .map(dim => deckShareChart(labels[dim] || dim, dim, selected))
    .filter(Boolean);

  ANNUAL_DECK_TABS.forEach(([key, title]) => {
    if (!wanted.has(key)) return;
    let charts = [];
    const slide = { key, title, charts, kpis: null, table: null };
    if (key === 'summary') {
      const t = annualKpiTotals(selected);
      slide.kpis = [
        [n(t.leads), 'לידים במערכת', `${selected.length} קמפיינים בטווח`],
        [n(t.ordered), 'לידים שהוזמנו', ''],
        [money(t.spent), 'תקציב', ''],
        [t.leads ? money(t.spent / t.leads) : '—', 'עלות לליד', ''],
        [t.gibushon ? money(t.spent / t.gibushon) : '—', 'עלות לגיבושון', ''],
        [t.recruited ? money(t.spent / t.recruited) : '—', 'עלות לגיוס', ''],
      ];
      const trend = deckTrendChart(selected);
      if (trend) charts.push(trend);
    } else if (key === 'submissions') {
      const weekday = deckWeekdayChart(selected);
      if (weekday) charts.push(weekday);
      charts = charts.concat(sectionCharts(key));
    } else if (key === 'funnel') {
      const funnel = deckFunnelChart(selected);
      if (funnel) charts.push(funnel);
      charts = charts.concat(sectionCharts(key));
    } else if (key === 'media') {
      slide.table = annualMediaRows(selected);
    } else {
      charts = sectionCharts(key);
    }
    slide.charts = charts;
    if (!charts.length && !slide.kpis && !(slide.table && slide.table.rows.length)) return;

    // יותר משלושה גרפים — שקופית המשך עם אותה כותרת
    if (charts.length > DECK_CHARTS_PER_SLIDE) {
      const parts = Math.ceil(charts.length / DECK_CHARTS_PER_SLIDE);
      for (let i = 0; i < parts; i++) {
        model.slides.push({ ...slide, title: `${title} (${i + 1}/${parts})`,
          charts: charts.slice(i * DECK_CHARTS_PER_SLIDE, (i + 1) * DECK_CHARTS_PER_SLIDE) });
      }
    } else {
      model.slides.push(slide);
    }
  });
  return model;
}

/* טבלת המדיה — הקמפיינים המסומנים בלבד (במסך: כולם) */
function annualMediaRows(selected) {
  const head = ['קמפיין', 'לידים חיצוני', 'לידים פנימי', 'צפיות', 'הקלקות',
                'עלות', 'עלות לליד חיצוני', 'עלות לליד פנימי'];
  const totals = { external: 0, internal: 0, impressions: 0, clicks: 0, spent: 0 };
  const rows = selected.map(c => {
    const external = c.external || 0, internal = c.total || 0, spent = c.spent || 0;
    totals.external += external; totals.internal += internal;
    totals.impressions += c.impressions || 0; totals.clicks += c.clicks || 0;
    totals.spent += spent;
    return { color: hex(annualColor(c.id)), cells: [
      c.name, external ? n(external) : '—', n(internal),
      c.impressions ? n(c.impressions) : '—', c.clicks ? n(c.clicks) : '—',
      spent ? money(spent) : '—', spent && external ? money(spent / external) : '—',
      spent && internal ? money(spent / internal) : '—'] };
  });
  if (rows.length > 1) {
    rows.push({ total: true, cells: [
      'סה"כ', n(totals.external), n(totals.internal), n(totals.impressions),
      n(totals.clicks), money(totals.spent),
      totals.external ? money(totals.spent / totals.external) : '—',
      totals.internal ? money(totals.spent / totals.internal) : '—'] });
  }
  return { head, rows,
           note: 'נתוני המדיה הם סך הקמפיין כולו — הם אינם מגיעים מפולחים לפי יום. '
               + '"חיצוני" — מה שהפלטפורמה דיווחה; "פנימי" — מועמדויות שנפתחו בפועל.' };
}

/* ---------- הציור ---------- */

/* טקסט עברי: ימין-לשמאל, Arial, בלי שוליים פנימיים */
function deckText(slide, text, x, y, w, h, opts) {
  slide.addText(text, Object.assign({
    x, y, w, h, fontFace: DECK.FONT, fontSize: 12, color: DECK.INK,
    align: 'right', valign: 'top', rtlMode: true, lang: 'he-IL', margin: 0,
  }, opts || {}));
}

function deckSlide(pptx, title, accent) {
  const slide = pptx.addSlide();
  slide.background = { color: DECK.PAPER };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: DECK.W, h: DECK.BAND,
    fill: { color: DECK.INK_DEEP }, line: { color: DECK.INK_DEEP } });
  // בלוק ההדגשה בקצה — בצד ימין, שם מתחילה הכותרת
  slide.addShape(pptx.ShapeType.rect, { x: DECK.W - 0.24, y: 0, w: 0.24, h: DECK.BAND,
    fill: { color: accent || DECK.BLUE }, line: { color: accent || DECK.BLUE } });
  deckText(slide, title, DECK.M, 0.2, DECK.W - 2 * DECK.M - 0.2, 0.55,
           { fontSize: 24, bold: true, color: DECK.PAPER, valign: 'middle' });
  return slide;
}

/* שורת הסיכום בתחתית — כמו במצגת הקמפיין */
function deckFoot(pptx, slide, text) {
  const w = 9.2, x = (DECK.W - w) / 2;
  slide.addShape(pptx.ShapeType.roundRect, { x, y: DECK.FOOT, w, h: 0.38,
    fill: { color: DECK.BAND_BG }, line: { color: DECK.LINE, width: 1 }, rectRadius: 0.08 });
  deckText(slide, text, x + 0.15, DECK.FOOT + 0.04, w - 0.3, 0.3,
           { fontSize: 11.5, bold: true, color: DECK.DEEP, align: 'center', valign: 'middle' });
}

/* מקרא אחד לכל השקופית: ריבוע בצבע הקמפיין ושמו, מימין לשמאל */
function deckLegend(pptx, slide, items, y) {
  let right = DECK.W - DECK.M;
  items.forEach(item => {
    const width = Math.min(3.2, 0.42 + item.name.length * 0.095);
    slide.addShape(pptx.ShapeType.rect, { x: right - 0.17, y: y + 0.07, w: 0.17, h: 0.17,
      fill: { color: item.color }, line: { color: item.color } });
    deckText(slide, item.name, right - width, y, width - 0.25, 0.3,
             { fontSize: 11, color: DECK.INK, valign: 'middle' });
    right -= width + 0.25;
  });
}

function deckTile(pptx, slide, x, y, w, h, value, label, foot, accent) {
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.06,
    fill: { color: DECK.PAPER }, line: { color: DECK.LINE, width: 1 } });
  slide.addShape(pptx.ShapeType.rect, { x: x + 0.06, y: y + 0.02, w: w - 0.12, h: 0.1,
    fill: { color: accent }, line: { color: accent } });
  deckText(slide, value, x + 0.1, y + 0.26, w - 0.2, 0.5,
           { fontSize: 22, bold: true, color: accent, align: 'center', valign: 'middle' });
  deckText(slide, label, x + 0.1, y + 0.8, w - 0.2, 0.3,
           { fontSize: 12, color: DECK.MUTED, align: 'center' });
  if (foot) deckText(slide, foot, x + 0.1, y + 1.08, w - 0.2, 0.26,
                     { fontSize: 10, color: DECK.MUTED, align: 'center' });
}

/* גרף אחד במסגרת: כותרת, הגרף, ומתחת — כמה חסר ומי לא מוצג */
function deckChart(pptx, slide, chart, x, y, w, h) {
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.05,
    fill: { color: DECK.PAPER }, line: { color: DECK.LINE, width: 1 } });
  deckText(slide, chart.title, x + 0.15, y + 0.1, w - 0.3, 0.34,
           { fontSize: 14, bold: true, color: DECK.INK_DEEP });

  const noteLines = [];
  if (chart.missing && chart.missing.length) {
    const summary = missingSummary(chart.missing);
    if (summary) noteLines.push(summary);
  }
  if (chart.note) noteLines.push(chart.note);
  if (chart.kind !== 'line' && chart.series.some(s => s.values.some(v => v === 0))) {
    noteLines.push('עמודה בלי תווית — 0%.');
  }
  if (chart.series.some(s => s.percentOnly)) {
    noteLines.push('נתוני 2025 — אחוזים לשנה כולה, בלי קשר לטווח התאריכים.');
  }
  const noteH = noteLines.length ? Math.min(0.9, 0.2 + 0.19 * noteLines.length
    + noteLines.join('').length / 900) : 0;
  const top = y + 0.48, height = h - 0.58 - noteH;

  if (!chart.series.length || !chart.labels.length) {
    slide.addShape(pptx.ShapeType.roundRect, { x: x + 0.3, y: top + height / 2 - 0.45,
      w: w - 0.6, h: 0.9, rectRadius: 0.06,
      fill: { color: DECK.BAND_BG }, line: { color: DECK.LINE, width: 1 } });
    deckText(slide, 'נתון חסר',
             x + 0.4, top + height / 2 - 0.35, w - 0.8, 0.35,
             { fontSize: 16, bold: true, color: DECK.MUTED, align: 'center' });
    deckText(slide, `בכל הקמפיינים שנבחרו חסר יותר מ-${Math.round(missingLimit() * 100)}%`,
             x + 0.4, top + height / 2, w - 0.8, 0.3,
             { fontSize: 11, color: DECK.MUTED, align: 'center' });
  } else if (chart.kind === 'line') {
    slide.addChart(pptx.ChartType.line,
      chart.series.map(s => ({ name: s.name, labels: chart.labels, values: s.values })), {
        x: x + 0.1, y: top, w: w - 0.2, h: height,
        chartColors: chart.series.map(s => s.color), lineSize: 2, lineDataSymbol: 'none',
        showLegend: false, catAxisLabelFontSize: 9, valAxisLabelFontSize: 9,
        catAxisLabelFontFace: DECK.FONT, valAxisLabelFontFace: DECK.FONT,
        catAxisLabelColor: DECK.MUTED, valAxisLabelColor: DECK.MUTED,
        valGridLine: { color: DECK.LINE, size: 0.5 }, catGridLine: { style: 'none' },
        valAxisLabelFormatCode: '#,##0',
      });
  } else {
    const peak = Math.max(0.01, ...chart.series.map(s => Math.max(...s.values)));
    const bars = chart.labels.length * chart.series.length;
    slide.addChart(pptx.ChartType.bar,
      chart.series.map(s => ({ name: s.name, labels: chart.labels.map(bidiLabel),
                               values: s.values })), {
        x: x + 0.1, y: top, w: w - 0.2, h: height,
        barDir: 'bar', barGrouping: 'clustered', barGapWidthPct: 45,
        chartColors: chart.series.map(s => s.color),
        // עברית: הקטגוריות מימין, הראשונה למעלה, העמודות גדלות שמאלה
        catAxisOrientation: 'maxMin', valAxisOrientation: 'maxMin',
        valAxisHidden: true, valAxisMinVal: 0, valAxisMaxVal: peak * 1.3,
        valGridLine: { style: 'none' }, catAxisLineShow: false,
        catAxisLabelFontSize: bars > 24 ? 9 : 10, catAxisLabelFontFace: DECK.FONT,
        catAxisLabelColor: DECK.INK,
        // אפס בדיוק — בלי תווית: היא נכתבת על הציר, על שם הקטגוריה
        showValue: true, dataLabelFormatCode: '0.0%;;;', dataLabelPosition: 'outEnd',
        dataLabelFontSize: bars > 24 ? 7 : 8, dataLabelFontFace: DECK.FONT,
        dataLabelColor: DECK.INK, showLegend: false,
      });
  }

  if (noteLines.length) {
    deckText(slide, noteLines.join('\n'), x + 0.15, y + h - 0.08 - noteH, w - 0.3, noteH,
             { fontSize: 9, color: DECK.MUTED, valign: 'bottom' });
  }
}

function deckTable(pptx, slide, table, y) {
  // עמודה ראשונה (שם הקמפיין) בצד ימין: הסדר נהפך, והטקסט מיושר לימין
  const head = table.head.slice().reverse().map(text => ({ text, options: {
    bold: true, color: DECK.PAPER, fill: { color: DECK.INK_DEEP }, align: 'center',
    rtlMode: true, lang: 'he-IL' } }));
  const rows = table.rows.map((row, index) => row.cells.slice().reverse().map((text, col, all) => ({
    text, options: {
      bold: !!row.total, color: DECK.INK,
      fill: { color: row.total ? 'E6EEFA' : (index % 2 ? DECK.BAND_BG : DECK.PAPER) },
      align: col === all.length - 1 ? 'right' : 'center',
      rtlMode: true, lang: 'he-IL',
    } })));
  const w = DECK.W - 2 * DECK.M;
  slide.addTable([head].concat(rows), {
    x: DECK.M, y, w, colW: [1.35, 1.35, 1.35, 1.2, 1.2, 1.2, 1.25, w - 8.9],
    fontFace: DECK.FONT, fontSize: 11, rtlMode: true, lang: 'he-IL',
    border: { type: 'solid', color: DECK.LINE, pt: 0.75 }, rowH: 0.36, valign: 'middle',
  });
  deckText(slide, table.note, DECK.M, y + 0.36 * (rows.length + 1) + 0.15,
           w, 0.5, { fontSize: 10, color: DECK.MUTED });
}

function deckCover(pptx, model) {
  const slide = pptx.addSlide();
  slide.background = { color: DECK.INK_DEEP };
  slide.addShape(pptx.ShapeType.rect, { x: DECK.W - 0.24, y: 0, w: 0.24, h: DECK.H,
    fill: { color: DECK.BLUE }, line: { color: DECK.BLUE } });
  slide.addShape(pptx.ShapeType.rect, { x: DECK.W - 0.33, y: 0, w: 0.09, h: DECK.H,
    fill: { color: DECK.AMBER }, line: { color: DECK.AMBER } });
  const x = DECK.M + 0.2, w = DECK.W - 2 * DECK.M - 0.6;
  deckText(slide, 'משטרת ישראל · חטיבת גיוס ושחרור', x, 1.1, w, 0.4,
           { fontSize: 15, color: DECK.BLUE });
  deckText(slide, 'לוח בקרה שנתי', x, 1.6, w, 0.85, { fontSize: 42, bold: true, color: DECK.PAPER });
  deckText(slide, 'השוואת קמפיינים', x, 2.5, w, 0.6, { fontSize: 28, bold: true, color: DECK.AMBER });
  deckText(slide, `${hebrewDate(model.from)} — ${hebrewDate(model.to)}`, x, 3.15, w, 0.45,
           { fontSize: 19, color: DECK.BLUE });
  slide.addShape(pptx.ShapeType.rect, { x, y: 3.8, w, h: 0.045,
    fill: { color: DECK.BLUE }, line: { color: DECK.BLUE } });

  // הקמפיינים שבמצגת — כל אחד בצבעו, כמו בצ'יפים שבמסך
  let y = 4.05;
  const items = model.campaigns.map(c => ({ name: `${c.name} · ${n(c.leads)} הגשות`, color: c.color }));
  if (model.baseline) items.push({ name: `${model.baseline.name} · אחוזים בלבד`, color: model.baseline.color });
  const perRow = 3, colW = w / perRow;
  items.forEach((item, index) => {
    const col = index % perRow, row = Math.floor(index / perRow);
    const right = x + w - col * colW;
    slide.addShape(pptx.ShapeType.ellipse, { x: right - 0.2, y: y + row * 0.42 + 0.08,
      w: 0.17, h: 0.17, fill: { color: item.color }, line: { color: item.color } });
    deckText(slide, item.name, right - colW + 0.1, y + row * 0.42, colW - 0.4, 0.34,
             { fontSize: 14, color: 'CFE0F7', valign: 'middle' });
  });

  deckText(slide, `${n(model.leads)} הגשות בטווח · הופק ${hebrewNow()}`,
           x, 6.25, w, 0.35, { fontSize: 13, color: 'CFE0F7' });
  deckText(slide, 'המצגת הופקה אוטומטית ממערכת ניתוח קמפיין הגיוס. אין בה שום פרט מזהה — '
                + 'כל הנתונים מצטברים.', x, 6.75, w, 0.35, { fontSize: 11, color: '7E95B8' });
}

function hebrewNow() {
  const d = new Date();
  const two = v => String(v).padStart(2, '0');
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} `
       + `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/* בונה את המצגת מהמודל. withCover — שער בראש (בייצוא המלא). */
function annualPptx(PptxGenJS, model, withCover) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.rtlMode = true;
  pptx.theme = { headFontFace: DECK.FONT, bodyFontFace: DECK.FONT, lang: 'he-IL' };
  pptx.title = 'לוח בקרה שנתי';
  pptx.company = 'חטיבת גיוס ושחרור';

  if (withCover) deckCover(pptx, model);

  const legend = model.campaigns.map(c => ({ name: c.name, color: c.color }));
  const foot = `${n(model.campaigns.length)} קמפיינים · ${n(model.leads)} הגשות · `
             + `${hebrewDate(model.from)} — ${hebrewDate(model.to)}`;

  model.slides.forEach((spec, index) => {
    const slide = deckSlide(pptx, spec.title, DECK_ACCENTS[index % DECK_ACCENTS.length]);
    let y = DECK.BAND + 0.22;

    if (spec.kpis) {
      const gap = 0.18, w = (DECK.W - 2 * DECK.M - gap * (spec.kpis.length - 1)) / spec.kpis.length;
      spec.kpis.forEach((k, i) => {
        // הכרטיס הראשון בצד ימין
        const x = DECK.W - DECK.M - (i + 1) * w - i * gap;
        deckTile(pptx, slide, x, y, w, 1.4, k[0], k[1], k[2], DECK_ACCENTS[i % DECK_ACCENTS.length]);
      });
      y += 1.6;
    }

    if (spec.table) deckTable(pptx, slide, spec.table, y);

    // מקרא אחד מתחת לגרפים: הקמפיינים, ו-2025 אם הוא באחד הגרפים
    const items = legend.slice();
    if (model.baseline && spec.charts.some(c => c.series.some(s => s.percentOnly))) {
      items.push({ name: model.baseline.name, color: model.baseline.color });
    }
    const legendY = DECK.FOOT - 0.42;
    if (spec.charts.length) {
      const gap = 0.2, count = spec.charts.length;
      const w = (DECK.W - 2 * DECK.M - gap * (count - 1)) / count;
      const h = legendY - 0.1 - y;
      spec.charts.forEach((chart, i) => {
        const x = DECK.W - DECK.M - (i + 1) * w - i * gap;   // מימין לשמאל
        deckChart(pptx, slide, chart, x, y, w, h);
      });
      deckLegend(pptx, slide, items, legendY);
    }
    deckFoot(pptx, slide, foot);
  });
  return pptx;
}

/* טוען את PptxGenJS מאותה תיקייה של dashboard.js — מקומי וגם בענן */
function loadPptxLib() {
  if (window.PptxGenJS) return Promise.resolve(window.PptxGenJS);
  return new Promise((resolve, reject) => {
    const own = document.querySelector('script[src*="dashboard.js"]');
    const script = document.createElement('script');
    script.src = own ? own.src.replace(/dashboard\.js.*$/, 'pptxgen.bundle.js')
                     : '/assets/pptxgen.bundle.js';
    script.onload = () => (window.PptxGenJS ? resolve(window.PptxGenJS)
      : reject(new Error('ספריית המצגות לא נטענה')));
    script.onerror = () => reject(new Error('ספריית המצגות לא נטענה'));
    document.head.appendChild(script);
  });
}

/* tab — לשונית אחת, או null לכל הלוח */
async function exportAnnualDeck(tab, button) {
  const selected = annualSelection();
  if (!selected.length) {
    ccToast('אין קמפיין מסומן עם הגשות בטווח — אין ממה לבנות מצגת.');
    return;
  }
  const label = button ? button.textContent : '';
  if (button) { button.disabled = true; button.textContent = 'בונה מצגת…'; }
  try {
    const PptxGenJS = await loadPptxLib();
    const model = annualDeckModel(selected, tab ? [tab] : null);
    if (!model.slides.length) {
      ccToast('אין בלשונית הזו נתונים לקמפיינים שנבחרו.');
      return;
    }
    const pptx = annualPptx(PptxGenJS, model, !tab);
    const name = tab ? (ANNUAL_DECK_TABS.find(t => t[0] === tab) || [tab, tab])[1]
                     : 'כל הלוח';
    const stamp = hebrewNow().replace(/\//g, '-').replace(' ', '_').replace(':', '-');
    await pptx.writeFile({ fileName: `לוח בקרה שנתי — ${name} — ${stamp}.pptx` });
  } catch (error) {
    ccToast('ייצוא המצגת נכשל: ' + (error && error.message ? error.message : error));
  } finally {
    if (button) { button.disabled = false; button.textContent = label; }
  }
}

/* כפתורי הייצוא: אחד מעל הלשוניות (הכול), ואחד בראש כל לשונית */
function setupAnnualExport() {
  const all = document.getElementById('cc-annual-export');
  if (all && !all.dataset.ready) {
    all.dataset.ready = '1';
    const button = el('button', 'act-btn go', '⭳ כל הלוח למצגת (PowerPoint)');
    button.type = 'button';
    button.addEventListener('click', () => exportAnnualDeck(null, button));
    all.appendChild(button);
    all.appendChild(el('span', 'note',
      'רק הקמפיינים המסומנים והטווח שנבחר. שקופית לכל לשונית, הגרפים זה לצד זה.'));
  }
  document.querySelectorAll('[data-annual-pane]').forEach(pane => {
    if (pane.querySelector('.annual-pane-export')) return;
    const key = pane.dataset.annualPane;
    const bar = el('div', 'annual-pane-export');
    const button = el('button', 'act-btn ghost', '⭳ הלשונית למצגת');
    button.type = 'button';
    button.addEventListener('click', () => exportAnnualDeck(key, button));
    bar.appendChild(button);
    pane.insertBefore(bar, pane.firstChild);
  });
}

/* ===== עמוד הבית שבענן ===== */

/* המסך הראשון שנפתח אחרי הכניסה: כל הקמפיינים ככרטיסים, עם
   המספרים המרכזיים של כל אחד ומשפך זעיר שמראה את הצורה שלו.
   לחיצה על כרטיס נכנסת לקמפיין.

   הנתונים מגיעים מאותו מטען של הלוח השנתי, ולכן אין כאן קריאה
   נוספת ואין מספר שיכול להיפרד ממנו. */
function renderHome() {
  const cards = document.getElementById('cc-home-cards');
  if (!cards || !ANNUAL.data) return;

  const list = ANNUAL.data.campaigns || [];
  cards.innerHTML = '';

  const kpis = document.getElementById('cc-home-kpis');
  if (kpis) {
    kpis.innerHTML = '';
    const totals = list.reduce((acc, c) => ({
      leads: acc.leads + c.total,
      recruited: acc.recruited + c.recruited,
      spent: acc.spent + (c.spent || 0),
    }), { leads: 0, recruited: 0, spent: 0 });

    kpis.appendChild(tile(n(list.length), 'קמפיינים במערכת', '', true));
    kpis.appendChild(tile(n(totals.leads), 'הגשות'));
    kpis.appendChild(tile(n(totals.recruited), 'גיוסים'));
    if (totals.spent) {
      kpis.appendChild(tile(money(totals.spent), 'תקציב'));
      kpis.appendChild(tile(totals.leads ? money(totals.spent / totals.leads) : '—',
                            'עלות לליד'));
    }
  }

  if (!list.length) {
    cards.appendChild(el('div', 'card', 'אין קמפיינים להצגה.'));
    return;
  }

  /* פעילים בגוש נפרד בראש העמוד, ואחריהם מי שהסתיים — כמו בלוח
     הראשי של המערכת המקומית. הכותרת "קמפיינים שהסתיימו" קבועה גם
     כשאין אף קמפיין פעיל, כדי שמצב הקמפיינים ייאמר תמיד. */
  [[list.filter(c => c.live), 'קמפיינים פעילים', 'h2--live'],
   [list.filter(c => !c.live), 'קמפיינים שהסתיימו', '']]
    .forEach(([group, title, cls]) => {
      if (!group.length) return;
      cards.appendChild(el('h2', cls || null, title));
      const grid = el('div', 'homegrid');
      group.forEach(campaign => grid.appendChild(homeCard(campaign)));
      cards.appendChild(grid);
    });
}

/* כרטיס קמפיין אחד בעמוד הבית שבענן */
function homeCard(campaign) {
  const color = annualColor(campaign.id);
  const card = el('a', 'homecard');
  card.href = 'funnel.html';
  card.style.setProperty('--cc', color);
  // הכניסה לקמפיין נעשית דרך אותו מפתח שהבורר משתמש בו, כדי
  // שהמסך הבא ייפתח על הקמפיין הנכון
  card.addEventListener('click', function () {
    try { localStorage.setItem('cc-cloud-campaign', campaign.id); } catch (e) {}
  });

  const head = el('div', 'homecard-head');
  const dot = el('span', 'cdot');
  dot.style.background = color;
  head.appendChild(dot);
  head.appendChild(el('span', 'homecard-name', campaign.name));
  card.appendChild(head);

  if (campaign.range) card.appendChild(el('div', 'homecard-range', campaign.range));

  const stats = el('div', 'homecard-stats');
  [['הגשות', n(campaign.total)],
   ['פעילים', n(campaign.active || 0)],
   ['גויסו', n(campaign.recruited)]].forEach(pair => {
    const box = el('div', 'homestat');
    box.appendChild(el('b', null, pair[1]));
    box.appendChild(el('span', null, pair[0]));
    stats.appendChild(box);
  });
  card.appendChild(stats);

  const shape = el('div', 'homecard-shape');
  // כרטיס הקמפיין בעמוד הבית רחב מ-260, ולכן הגופן מוקטן
  // ביחידות ה-viewBox כדי לצאת באותו גודל על המסך
  shape.innerHTML = annualFunnelSvg(campaign, color, 0.85);
  card.appendChild(shape);

  const foot = el('div', 'homecard-foot');
  const rate = campaign.total ? campaign.recruited / campaign.total : 0;
  foot.appendChild(el('span', null, 'שיעור גיוס ' + pct(rate)));
  foot.appendChild(el('span', 'homecard-go', 'כניסה ←'));
  card.appendChild(foot);

  return card;
}

/* ===== זמני הקמפיינים — ציר זמן ===== */

/* גרף אחד שעונה על השאלה הראשונה בדף הראשי: מה רץ מתי.

   ציר אופקי אחד של חודשים, וכל קמפיין הוא רצועה עליו — מהחודש
   שבו נפתחה ההגשה הראשונה ועד זה של האחרונה. עומק הצבע בכל חודש
   הוא עוצמת ההגשות בו, ולכן הרצועה אומרת גם מתי הקמפיין היה
   פתוח וגם מתי הוא באמת רץ.

   שלושה דברים שאינם מובנים מאליהם:

   1. הציר רץ משמאל לימין, בניגוד לשאר העמוד. זמן אינו טקסט:
      "אחר כך" הוא ימינה בכל גרף שראינו אי פעם, וציר שרץ לכיוון
      השני נקרא הפוך בכל מבט ראשון. שמות הקמפיינים בתוכו נשארים
      בעברית ובכיוון שלהם.

   2. הצבע של כל קמפיין כאן הוא בדיוק הצבע שלו בכרטיס שמעל הציר,
      ובכל גרף בלוח השנתי — annualColor, מפתח אחד לכל המערכת.
      קודם לכן היו כאן שתי משפחות גוונים משלו, ולכן אותו קמפיין
      היה ירוק כאן וכחול שם.

   3. קמפיין פעיל בולט: רצועה גבוהה יותר, צבע מלא, ומסגרת דקה.
      מי שהסתיים עמום מעט. ההבדל נועד להיקרא במבט, לא לצעוק.

   קו אנכי מסמן את היום. בלי הוא אי אפשר לדעת במבט אם רצועה
   נגמרה או שהיא פשוט מגיעה עד עכשיו.

   הציר והכרטיסים שמעליו קשורים: ריחוף על רצועה מדגיש את הכרטיס
   של אותו קמפיין, ריחוף על כרטיס מדגיש את הרצועה שלו, ולחיצה
   על הרצועה נכנסת לקמפיין — בדיוק כמו לחיצה על הכרטיס.

   הנתונים הם ההגשות בפועל שעלו מהדוחות, ולא התאריכים שהוקלדו
   בהגדרות הקמפיין. */
function monthKey(iso) { return String(iso).slice(0, 7); }

function campaignMonthly() {
  const list = (ANNUAL.data && ANNUAL.data.campaigns) || [];
  const months = new Set();
  const rows = [];

  list.forEach(campaign => {
    const byMonth = new Map();
    (campaign.daily || []).forEach(point => {
      if (!point.count) return;
      const key = monthKey(point.date);
      months.add(key);
      byMonth.set(key, (byMonth.get(key) || 0) + point.count);
    });
    if (byMonth.size) rows.push({ campaign, byMonth });
  });

  return { months: [...months].sort(), rows };
}

/* כל החודשים שבין הראשון לאחרון, גם אלה שאין בהם הגשה כלל.

   בלי זה הציר היה מדלג על חודש שקט, ושני קמפיינים שרצו בהפרש
   של חצי שנה היו נראים סמוכים. ציר זמן שאינו רציף אינו ציר זמן. */
function monthSpan(first, last) {
  const span = [];
  let year = parseInt(first.slice(0, 4), 10);
  let month = parseInt(first.slice(5, 7), 10);
  const endYear = parseInt(last.slice(0, 4), 10);
  const endMonth = parseInt(last.slice(5, 7), 10);
  // תקרה רכה, שלא ייווצר לולאה אינסופית על נתון פגום
  for (let guard = 0; guard < 600; guard += 1) {
    span.push(String(year) + '-' + String(month).padStart(2, '0'));
    if (year === endYear && month === endMonth) break;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return span;
}

/* כותרת הציר לפי מה שהוא באמת מציג. שנה אחת — "בשנת 2026"; יותר
   מאחת — הטווח. כותרת שכתובה קשיח נעשית שקר בינואר. */
function timelineTitle(months) {
  const first = months[0].slice(0, 4);
  const last = months[months.length - 1].slice(0, 4);
  return first === last
    ? `זמני קמפיינים בשנת ${first}`
    : `זמני קמפיינים ${first}–${last}`;
}

/* קושר רצועה לכרטיס: ריחוף על אחד מדגיש את השני, ולחיצה על
   הרצועה נכנסת לקמפיין. */
function linkLaneToCard(lane, campaignId) {
  const card = document.querySelector(
    'a.camp[data-campaign="' + (window.CSS && CSS.escape
      ? CSS.escape(campaignId) : campaignId) + '"]');

  const on = () => {
    lane.classList.add('tl-lane--hot');
    if (card) card.classList.add('camp--hot');
  };
  const off = () => {
    lane.classList.remove('tl-lane--hot');
    if (card) card.classList.remove('camp--hot');
  };

  lane.addEventListener('mouseenter', on);
  lane.addEventListener('mouseleave', off);
  lane.addEventListener('focus', on);
  lane.addEventListener('blur', off);
  if (card) {
    card.addEventListener('mouseenter', on);
    card.addEventListener('mouseleave', off);
    // הרצועה נכנסת לקמפיין כמו הכרטיס עצמו
    lane.addEventListener('click', () => { window.location.href = card.href; });
    lane.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        window.location.href = card.href;
      }
    });
    lane.classList.add('tl-lane--go');
    lane.tabIndex = 0;
  }
}

/* צובע את כרטיסי הקמפיין בדף הראשי המקומי בצבע הקמפיין.

   הכרטיסים נבנים בשרת, שאינו יודע את סדר הקמפיינים במטען השנתי
   ולכן אינו יכול לדעת את הצבע. הצביעה נעשית כאן, מאותו
   annualColor שהציר והלוח השנתי משתמשים בו — וזו כל הנקודה:
   מקור צבע אחד, ולא שניים שמתפצלים. */
function paintCampaignCards() {
  document.querySelectorAll('a.camp[data-campaign]').forEach(card => {
    const color = annualColor(card.dataset.campaign);
    card.style.setProperty('--cc', color);
    if (!card.querySelector('.cdot')) {
      const dot = el('span', 'cdot');
      const name = card.querySelector('.cname');
      if (name) name.insertBefore(dot, name.firstChild);
    }
  });
}

/* מיקום היום על הציר, כשבר בין 0 ל-1 מתחילת החודש הראשון.

   החישוב הוא ביחידות חודש ולא ביחידות יום: הציר עצמו בנוי
   ממשבצות חודש שוות, ולכן קו שממוקם לפי ימים היה יוצא מהמקום.
   בתוך החודש הנוכחי הקו זז לפי היום בחודש. */
function todayFraction(months) {
  const now = new Date();
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const at = months.indexOf(key);
  if (at < 0) return null;
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return (at + (now.getDate() - 0.5) / days) / months.length;
}

/* הקו של היום, ממוקם אחרי שהדפדפן פרס את הציר.

   המיקום נמדד מהרצועה האמיתית ולא מחושב מרוחב עמודות: שורת
   השמות היא minmax, רוחבה משתנה עם התוכן ועם רוחב המסך, וכל
   חישוב מראש שלה היה יוצא לא מדויק במסך אחר. */
function placeTodayLine(chart, track, fraction) {
  let line = chart.querySelector('.tl-today');
  if (!line) {
    line = el('div', 'tl-today');
    line.appendChild(el('span', 'tl-today-tag', 'היום'));
    chart.appendChild(line);
  }
  // offsetLeft ולא getBoundingClientRect: במסך צר הציר עצמו נגלל
  // לרוחב, ומדידה יחסית למסך הייתה מזיזה את הקו עם כל גלילה.
  const width = track.offsetWidth;
  if (!width) return;
  const lane = track.parentNode;
  line.style.left = (track.offsetLeft + width * fraction) + 'px';
  line.style.top = (lane && lane.offsetTop ? lane.offsetTop - 4 : 0) + 'px';
}

function renderCampaignMonths() {
  const host = document.getElementById('cc-home-months');
  if (!host) return;
  host.innerHTML = '';
  paintCampaignCards();

  const data = campaignMonthly();
  if (!data.months.length) {
    host.appendChild(el('div', 'card', 'אין הגשות עם תאריך, ולכן אין ציר זמן.'));
    return;
  }

  // הציר נמשך עד החודש הנוכחי, גם כשאין בו הגשות. בלי זה קו
  // ה"היום" נופל מחוץ לציר בדיוק במצב הנפוץ — כל הקמפיינים
  // הסתיימו — והמרחק בין הקמפיין האחרון לעכשיו אינו נראה.
  const last = data.months[data.months.length - 1];
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const months = monthSpan(data.months[0], thisMonth > last ? thisMonth : last);
  const index = new Map(months.map((key, at) => [key, at]));

  const card = el('div', 'card');
  card.appendChild(el('div', 'bartitle', timelineTitle(months)));

  const chart = el('div', 'tl');
  chart.dir = 'ltr';
  chart.style.setProperty('--tl-months', months.length);

  // שורת החודשים. בציר ארוך לא כל חודש מקבל תווית — אחרת הן
  // נדחסות זו על זו — אבל כל חודש מקבל את משבצתו.
  const every = months.length > 24 ? 6 : months.length > 12 ? 3 : 1;
  const axis = el('div', 'tl-axis');
  const axisName = el('div', 'tl-name');
  axisName.dir = 'rtl';
  axis.appendChild(axisName);
  const axisTrack = el('div', 'tl-track');
  months.forEach((key, at) => {
    const cell = el('div', 'tl-tick');
    if (at % every === 0) cell.appendChild(el('span', null, monthLabel(key)));
    axisTrack.appendChild(cell);
  });
  axis.appendChild(axisTrack);
  const axisTotal = el('div', 'tl-total', 'הגשות');
  axisTotal.dir = 'rtl';
  axis.appendChild(axisTotal);
  chart.appendChild(axis);

  // סדר הרצועות: הפעילים ראשונים, ואחריהם לפי זמן — בדיוק סדר
  // הגושים שמעל הציר
  const lanes = data.rows.slice().sort((a, b) => {
    if (!!a.campaign.live !== !!b.campaign.live) return a.campaign.live ? -1 : 1;
    return (a.campaign.daily[0] || {}).date < (b.campaign.daily[0] || {}).date ? 1 : -1;
  });

  let firstTrack = null;
  lanes.forEach(row => {
    const color = annualColor(row.campaign.id);

    const keys = [...row.byMonth.keys()].sort();
    const from = index.get(keys[0]);
    const to = index.get(keys[keys.length - 1]);
    const peak = Math.max(...row.byMonth.values(), 1);
    const total = [...row.byMonth.values()].reduce((a, b) => a + b, 0);

    const lane = el('div', 'tl-lane' +
      (row.campaign.live ? ' tl-lane--live' : ' tl-lane--done'));
    lane.style.setProperty('--cc', color);

    const name = el('div', 'tl-name', row.campaign.name);
    name.dir = 'rtl';
    name.title = row.campaign.name +
      (row.campaign.live ? ' — קמפיין בהליך' : ' — הסתיים');
    lane.appendChild(name);

    const track = el('div', 'tl-track');
    if (!firstTrack) firstTrack = track;
    months.forEach((key, at) => {
      const cell = el('div', 'tl-cell');
      if (at >= from && at <= to) {
        const count = row.byMonth.get(key) || 0;
        cell.classList.add('tl-on');
        if (at === from) cell.classList.add('tl-start');
        if (at === to) cell.classList.add('tl-end');
        // עומק הצבע הוא העוצמה. רצפה של 0.35, כדי שחודש שקט
        // בתוך הרצף עדיין ייראה כחלק מהרצועה ולא כניתוק.
        cell.style.background = color;
        cell.style.opacity = (0.35 + 0.65 * (count / peak)).toFixed(2);
        cell.title = `${row.campaign.name} · ${monthLabel(key)}: ` +
                     `${n(count)} הגשות`;
      }
      track.appendChild(cell);
    });
    lane.appendChild(track);
    const totalCell = el('div', 'tl-total', n(total));
    totalCell.dir = 'rtl';
    lane.appendChild(totalCell);

    linkLaneToCard(lane, row.campaign.id);
    chart.appendChild(lane);
  });

  card.appendChild(chart);
  card.appendChild(el('div', 'tnote',
    'הציר רץ משמאל לימין. כל רצועה היא קמפיין, מהחודש הראשון שבו ' +
    'התקבלה הגשה ועד האחרון, ועומק הצבע הוא כמות ההגשות באותו ' +
    'חודש. הצבע של כל קמפיין זהה לצבע שלו בכרטיסים שמעל ובלוח ' +
    'השנתי. קמפיין בהליך מודגש, קמפיין שהסתיים עמום. הקו האנכי ' +
    'הוא היום. ריחוף על רצועה מדגיש את כרטיס הקמפיין שמעליה, ' +
    'ולחיצה נכנסת אליו.'));
  host.appendChild(card);

  // הקו של היום נמדד מהפריסה בפועל, ולכן אחרי שהכרטיס בעמוד
  const fraction = todayFraction(months);
  if (fraction !== null && firstTrack) {
    const draw = () => placeTodayLine(chart, firstTrack, fraction);
    draw();
    requestAnimationFrame(draw);
    if (!renderCampaignMonths._watching) {
      renderCampaignMonths._watching = true;
      window.addEventListener('resize', () => {
        const live = document.querySelector('#cc-home-months .tl');
        const first = live && live.querySelector('.tl-lane .tl-track');
        if (live && first) placeTodayLine(live, first, fraction);
      });
    }
  }
}

function monthLabel(key) {
  const month = parseInt(key.slice(5, 7), 10);
  return `${HEB_MONTHS[month - 1] || key} ${key.slice(0, 4)}`;
}

/* ===== התנעה ===== */

function ccBoot() {
  const root = document.getElementById('cc-root');
  if (root && root.dataset.campaign) {
    loadCampaign(root.dataset.campaign);
  }
  loadAnnual();
  loadStatus();
}

/* באתר שבענן הנתונים אינם קבצים שאפשר למשוך — הם יושבים
   ב-Firestore מאחורי חוקי גישה, ונקראים רק אחרי שהמשתמש הזדהה.
   לכן ההתנעה שם מחכה לאות מ-auth.js במקום לרוץ מיד. */
document.addEventListener('DOMContentLoaded', () => {
  if (window.CC_CLOUD) return;
  ccBoot();
});

window.addEventListener('cc-data-ready', () => ccBoot());
