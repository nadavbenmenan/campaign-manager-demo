/* ---------------------------------------------------------------------------
   demo.js — התאמות לאתר נתוני הדמה בלבד (11/10/2026).

   נטען אחרי dashboard.js באתר "מערכת לניהול קמפיינים" ולא בשום מקום
   אחר — המערכת והענן אינם מושפעים. מחליף פונקציות גלובליות:
     · renderHeadline — שורת הפרופיל: אחוז נשים, גיל 20-67, השכלה
       ופרופיל קרבי (בלי מגזר).
     · conversionShortNote / renderMediaKpis — במקום "תקלה" בין
       ההמרות להגשות: הסבר קצר עם סימן קריאה — ההמרות בדיגיטל רבות
       מההגשות כי יש כפולים.
   --------------------------------------------------------------------------- */

'use strict';

window.renderHeadline = function () {
  const demo = document.getElementById('cc-headline-demo');
  if (demo) {
    demo.innerHTML = '';
    const women = groupShare('gender', ['נקבה']);
    if (women !== null) {
      demo.appendChild(profileItem('gender', women, 'מהמועמדים הן נשים'));
    }
    if (CC.rows.length && flagBits('age2067')) {
      demo.appendChild(headlineItem(pct(countFlag('age2067') / CC.rows.length),
        'מהמועמדים בגיל 20-67', missingNote(missingOf('age'))));
    }
    ['education', 'rovai'].forEach(key => {
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
    if (area) submit.appendChild(profileItem('area', area.share,
      `מההגשות מאזור ${area.value}`));
    if (source) submit.appendChild(profileItem('source', source.share,
      `מההגשות ממקור ${source.value}`));
  }
};

// ההמרות בדמה תמיד רבות מההגשות — אין הערה אדומה מעל הטבלה
window.conversionShortNote = function () { return null; };

/* תיבת הפער בסיכום הביצועים: ההסבר על הכפולים, עם סימן קריאה קטן */
const ccDemoMediaKpis = window.renderMediaKpis;
window.renderMediaKpis = function () {
  ccDemoMediaKpis();
  const gap = document.getElementById('cc-media-gap');
  if (!gap) return;
  const totals = mediaTotals();
  const leads = CC.rows.length;
  if (!totals.conversions) return;
  gap.className = 'insight demo-dup-note';
  gap.innerHTML =
    '<span class="demo-bang" title="המרות כפולות">!</span> ' +
    `<b>${n(totals.conversions)}</b> המרות בדיגיטל מול <b>${n(leads)}</b> הגשות ` +
    'במערכת. ההמרות רבות מההגשות כי יש כפולים: מועמד ששלח את הטופס פעמיים, ' +
    'או שהמיר ביותר מפלטפורמה אחת, נספר בכל המרה — ובמערכת הוא הגשה אחת.';
};

/* הערות השוליים שמתחת לטבלאות ההמרות מסבירות "באדום: ... הפער אמור
   להיות הפוך". בדמה אין שורה אדומה — המשפט מוחלף בהסבר על הכפולים. */
function ccDemoNotes() {
  document.querySelectorAll('.tnote').forEach(note => {
    const before = note.textContent;
    const after = before
      .replace(` המרות והגשות באדום: ${CONVERSION_SHORT_NOTE}.`, '')
      .replace(` באדום: ${CONVERSION_SHORT_NOTE}.`, '')
      .replace('ולכן ההמרות אמורות להיות לפחות כמו ההגשות.',
               'ולכן ההמרות רבות מההגשות — כולל כפולים (מועמד שהמיר יותר מפעם אחת).');
    if (after !== before) note.textContent = after;
  });
}
['renderAdConversions', 'renderPlatforms'].forEach(name => {
  const original = window[name];
  if (typeof original !== 'function') return;
  window[name] = function () {
    const result = original.apply(this, arguments);
    ccDemoNotes();
    return result;
  };
});
