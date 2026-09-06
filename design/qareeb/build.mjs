// Assembles the Qareeb design artboards (.dc.html) from shared tokens.
// Run: node build.mjs   -> writes *.dc.html + canvas.json next to this file.
import { writeFileSync } from 'node:fs';

const T = {
  bg: '#FAF7F0', surface: '#FFFEFA', text: '#193E2D', muted: '#626C61',
  primary: '#20583B', onPrimary: '#FFFEFA', soft: '#EDF2E4', border: '#E4E7DC',
  warm: '#924220', warmBg: '#FBE5D5', err: '#A3342B', errBg: '#FDEDE9',
};

const FONT_LINK = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600&amp;family=Noto+Sans+Hebrew:wght@400;500;600&amp;family=Noto+Sans+Arabic:wght@400;500;600&amp;display=swap">`;

const BASE_CSS = `
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; background: ${T.bg}; color: ${T.text};
      font-family: "Noto Sans", "Noto Sans Hebrew", "Noto Sans Arabic", "Segoe UI", Arial, sans-serif;
      font-size: 16px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
    [lang="he"], [lang="he"] * { font-family: "Noto Sans Hebrew", "Noto Sans", "Segoe UI", Arial, sans-serif; letter-spacing: 0; }
    [lang="ar"], [lang="ar"] * { font-family: "Noto Sans Arabic", "Noto Sans", "Segoe UI", Arial, sans-serif; letter-spacing: 0; }
    a { color: ${T.primary}; } a:hover { color: #193E2D; }
    h1, h2, h3, p { margin: 0; text-wrap: pretty; }
    button { font: inherit; color: inherit; cursor: pointer; }
    input, textarea, select { font: inherit; color: inherit; }
    .h-page { font-size: 28px; line-height: 1.2; font-weight: 600; }
    .h-desk { font-size: 36px; line-height: 1.15; font-weight: 600; }
    .h-sec { font-size: 20px; line-height: 1.3; font-weight: 600; }
    .small { font-size: 14px; line-height: 1.45; color: ${T.muted}; }
    .badge { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 500; line-height: 1.2;
      padding: 4px 8px; border-radius: 6px; white-space: nowrap; }
    .badge-open { background: ${T.soft}; color: ${T.primary}; }
    .badge-closed { background: #F1F0EA; color: ${T.muted}; }
    .badge-warm { background: ${T.warmBg}; color: ${T.warm}; }
    .badge-err { background: ${T.errBg}; color: ${T.err}; }
    .badge-placed { background: ${T.warmBg}; color: ${T.warm}; }
    .card { background: ${T.surface}; border: 1px solid ${T.border}; border-radius: 16px; }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px;
      padding: 0 20px; border-radius: 12px; font-weight: 600; font-size: 16px; border: 1px solid transparent; }
    .btn-primary { background: ${T.primary}; color: ${T.onPrimary}; }
    .btn-secondary { background: ${T.surface}; color: ${T.text}; border-color: ${T.border}; }
    .btn-destructive { background: ${T.surface}; color: ${T.err}; border-color: #E9C7C2; }
    .btn-sm { min-height: 40px; padding: 0 14px; font-size: 14px; }
    .icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px;
      border-radius: 12px; border: 1px solid ${T.border}; background: ${T.surface}; }
    .seg { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; padding: 4px;
      background: ${T.surface}; border: 1px solid ${T.border}; border-radius: 14px; }
    .seg button { min-height: 44px; border-radius: 10px; border: 0; background: transparent; font-weight: 500;
      color: ${T.muted}; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
    .seg button[aria-pressed="true"] { background: ${T.soft}; color: ${T.primary}; font-weight: 600;
      box-shadow: inset 0 0 0 1px #CFDDC2; }
    .field { display: flex; flex-direction: column; gap: 6px; }
    .label { font-size: 14px; font-weight: 500; color: ${T.text}; }
    .label .opt { font-weight: 400; color: ${T.muted}; }
    .input { min-height: 48px; padding: 12px 14px; border-radius: 12px; border: 1px solid ${T.border};
      background: ${T.surface}; font-size: 16px; line-height: 1.5; width: 100%; }
    .input.ph { color: #8B948A; }
    .textarea { min-height: 110px; align-items: flex-start; }
    .hint { font-size: 14px; color: ${T.muted}; }
    .divider { height: 1px; background: ${T.border}; }
    .num { font-variant-numeric: tabular-nums; }
    .img-fallback { background: ${T.soft}; display: flex; align-items: center; justify-content: center; color: #626C61; }
    .focus-ring { outline: 2px solid ${T.primary}; outline-offset: 2px; }
`;

// ---------- Icons (stroke outline family, 24px grid) ----------
const ic = (paths, size = 24, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${paths}</svg>`;
const I = {
  pin: (s) => ic('<path d="M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>', s),
  chevronDown: (s) => ic('<path d="m6 9 6 6 6-6"/>', s),
  chevronEnd: (s) => ic('<path d="m9 6 6 6-6 6"/>', s),
  back: (s) => ic('<path d="m15 6-6 6 6 6"/>', s),
  heart: (s, filled) => ic(`<path d="M12 20.5s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 7.5 2.5c0 5.4-7.5 10-7.5 10z" ${filled ? `fill="${T.primary}"` : ''}/>`, s),
  compass: (s) => ic('<circle cx="12" cy="12" r="9"/><path d="m15 9-2 6-4 0-0 0 2-6z"/>', s),
  cart: (s) => ic('<path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.6a1 1 0 0 0 1-.8L21 8H6"/><circle cx="9.5" cy="20" r="1.2"/><circle cx="17.5" cy="20" r="1.2"/>', s),
  user: (s) => ic('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', s),
  phone: (s) => ic('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z"/>', s),
  house: (s) => ic('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>', s),
  leaf: (s) => ic('<path d="M5 19c0-8 5-13 14-13-1 9-6 13-14 13z"/><path d="M5 19c3-4 6-7 10-9"/>', s),
  globe: (s) => ic('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>', s),
  close: (s) => ic('<path d="M6 6l12 12M18 6 6 18"/>', s),
  plus: (s) => ic('<path d="M12 5v14M5 12h14"/>', s),
  minus: (s) => ic('<path d="M5 12h14"/>', s),
  check: (s) => ic('<path d="m5 12 5 5 9-10"/>', s),
  print: (s) => ic('<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="9" rx="2"/><path d="M7 14h10v6H7z"/>', s),
  bell: (s) => ic('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21a2 2 0 0 0 4 0"/>', s),
  inbox: (s) => ic('<path d="M4 4h16v16H4z"/><path d="M4 14h5l1.5 2h3L15 14h5"/>', s),
  list: (s) => ic('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', s),
  box: (s) => ic('<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>', s),
  settings: (s) => ic('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>', s),
  star: (s) => ic('<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>', s),
  users: (s) => ic('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M17.5 14a6 6 0 0 1 4 6"/>', s),
  pause: (s) => ic('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>', s),
  bluetooth: (s) => ic('<path d="m7 7 10 10-5 5V2l5 5L7 17"/>', s),
  grid: (s) => ic('<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>', s),
  store: (s) => ic('<path d="M3 9l1.5-5h15L21 9"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M5 11v9h14v-9"/><path d="M10 20v-5h4v5"/>', s),
  branch: (s) => ic('<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 7.5v9M18 11.5c0 3-3 4-6 4H6"/>', s),
  coins: (s) => ic('<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v10c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M3 12c0 1.7 2.7 3 6 3s6-1.3 6-3"/><path d="M15 9.5c3 .3 6 1.5 6 3.2V17c0 1.7-2.7 3-6 3"/>', s),
  alert: (s) => ic('<path d="M12 3 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>', s),
  clock: (s) => ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', s),
  search: (s) => ic('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3"/>', s),
  scale: (s) => ic('<path d="M12 3v18M4 7h16"/><path d="m6 7-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z"/>', s),
};

const wordmark = (label) => `
  <div style="display: flex; align-items: center; gap: 8px" role="img" aria-label="${label}">
    <div style="width: 32px; height: 32px; border-radius: 10px; background: ${T.primary}; color: ${T.onPrimary}; display: flex; align-items: center; justify-content: center">${I.leaf(20)}</div>
    <span dir="ltr" style="font-size: 22px; font-weight: 600; letter-spacing: -0.01em; color: ${T.text}; line-height: 1">qareeb</span>
  </div>`;

const shell = ({ title, lang = 'en', dir = 'ltr', body, css = '', preview }) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <title>${title}</title>
  ${FONT_LINK}
  <style>${BASE_CSS}${css}</style>
</helmet>
${body.replace('<ROOT', `<div lang="${lang}" dir="${dir}"`)}
</x-dc>
<script data-dc-script data-props='{"$preview":{"width":${preview.w},"height":${preview.h}}}'>
class Component extends DCLogic {}
</script>
</body>
</html>
`;

// ---------- Copy per language ----------
const S = {
  en: {
    lang: 'en', dir: 'ltr', langChip: 'EN', brandLabel: 'Qareeb, neighborhood marketplace',
    deliveringTo: 'Delivering to Beit Jann', headline: 'Good things. Close to home.',
    sub: 'Meals and everyday essentials from your neighborhood.',
    pickup: 'Pickup', delivery: 'Delivery', restaurants: 'Restaurants', supermarkets: 'Supermarkets',
    around: 'Around your neighborhood', open: 'Open', closed: 'Closed · opens 17:00',
    fee: 'Delivery ₪10', min: 'Min. ₪60', pickupOk: 'Pickup available', fee2: 'Delivery ₪8', min2: 'Min. ₪40',
    fee3: 'Delivery ₪12', min3: 'Min. ₪80',
    nav: ['Explore', 'Favorites', 'Cart', 'Account'], cartItems: '2 items', viewCart: 'View cart',
    biz: [
      { name: 'Al-Karmel Grill', cat: 'Grill · Restaurant' },
      { name: 'Beit Jann Bakery & Sweets', cat: 'Bakery · Restaurant' },
      { name: 'Dar Yousef Kitchen', cat: 'Home cooking · Restaurant' },
    ],
    favLabel: 'Add to favorites', navLabel: 'Main',
  },
  he: {
    lang: 'he', dir: 'rtl', langChip: 'עב', brandLabel: 'קריב, מרקטפלייס שכונתי',
    deliveringTo: 'משלוח לבית ג׳ן', headline: 'דברים טובים. קרוב לבית.',
    sub: 'אוכל ומצרכים יומיומיים מהשכונה שלך.',
    pickup: 'איסוף עצמי', delivery: 'משלוח', restaurants: 'מסעדות', supermarkets: 'סופרמרקטים',
    around: 'בסביבה שלך', open: 'פתוח', closed: 'סגור · נפתח ב־17:00',
    fee: 'משלוח ₪10', min: 'מינימום ₪60', pickupOk: 'איסוף זמין', fee2: 'משלוח ₪8', min2: 'מינימום ₪40',
    fee3: 'משלוח ₪12', min3: 'מינימום ₪80',
    nav: ['גילוי', 'מועדפים', 'עגלה', 'חשבון'], cartItems: '2 פריטים', viewCart: 'לעגלה',
    biz: [
      { name: 'גריל אל־כרמל', cat: 'גריל · מסעדה' },
      { name: 'מאפייה וממתקים בית ג׳ן', cat: 'מאפייה · מסעדה' },
      { name: 'המטבח של דאר יוסף', cat: 'אוכל ביתי · מסעדה' },
    ],
    favLabel: 'הוספה למועדפים', navLabel: 'ניווט ראשי',
  },
  ar: {
    lang: 'ar', dir: 'rtl', langChip: 'ع', brandLabel: 'قريب، سوق الحارة',
    deliveringTo: 'التوصيل إلى بيت جن', headline: 'أشياء طيّبة. قريبة من البيت.',
    sub: 'وجبات وحاجيات يومية من حارتك.',
    pickup: 'استلام', delivery: 'توصيل', restaurants: 'مطاعم', supermarkets: 'سوبرماركت',
    around: 'في حارتك', open: 'مفتوح', closed: 'مغلق · يفتح 17:00',
    fee: 'التوصيل ₪10', min: 'الحد الأدنى ₪60', pickupOk: 'الاستلام متاح', fee2: 'التوصيل ₪8', min2: 'الحد الأدنى ₪40',
    fee3: 'التوصيل ₪12', min3: 'الحد الأدنى ₪80',
    nav: ['استكشف', 'المفضلة', 'السلة', 'حسابي'], cartItems: 'صنفان', viewCart: 'عرض السلة',
    biz: [
      { name: 'مشاوي الكرمل', cat: 'مشاوي · مطعم' },
      { name: 'مخبز وحلويات بيت جن', cat: 'مخبز · مطعم' },
      { name: 'مطبخ دار يوسف', cat: 'طبخ بيتي · مطعم' },
    ],
    favLabel: 'أضف إلى المفضلة', navLabel: 'التنقل الرئيسي',
  },
};

const money = (v) => `<bdi dir="ltr" class="num">${v}</bdi>`;

// ---------- Discovery (mobile) ----------
const discovery = (L) => {
  const card = (b, i) => {
    const closed = i === 2;
    const meta = closed
      ? [L.fee3, L.min3]
      : i === 0 ? [L.fee, L.min, L.pickupOk] : [L.fee2, L.min2, L.pickupOk];
    return `
      <article class="card" style="display: flex; gap: 12px; padding: 12px; align-items: stretch; ${closed ? 'opacity: 0.92' : ''}">
        <div class="img-fallback" style="width: 96px; height: 96px; border-radius: 12px; flex: 0 0 auto">${I.leaf(28)}</div>
        <div style="display: flex; flex-direction: column; gap: 4px; flex: 1 1 auto; min-width: 0">
          <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px">
            <h3 style="font-size: 16px; font-weight: 600; line-height: 1.35">${b.name}</h3>
            <button class="icon-btn" aria-label="${L.favLabel}" style="width: 40px; height: 40px; border-color: transparent; margin-block: -6px; margin-inline-end: -6px">${I.heart(20, i === 1)}</button>
          </div>
          <p class="small">${b.cat}</p>
          <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-block-start: 2px">
            <span class="badge ${closed ? 'badge-closed' : 'badge-open'}">${closed ? L.closed : L.open}</span>
            ${meta.map((m) => `<span class="badge" style="background: #F4F3EC; color: ${T.muted}">${m}</span>`).join('')}
          </div>
        </div>
      </article>`;
  };
  const navItem = (label, icon, active) => `
    <a href="#" aria-current="${active ? 'page' : 'false'}" style="display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 64px; min-height: 48px; justify-content: center; text-decoration: none; color: ${active ? T.primary : T.muted}; font-size: 12px; font-weight: ${active ? 600 : 500}">
      ${icon}<span>${label}</span></a>`;
  return `
<ROOT style="width: 390px; height: 844px; background: ${T.bg}; position: relative; overflow: hidden; display: flex; flex-direction: column">
  <header style="display: flex; align-items: center; justify-content: space-between; padding: 12px 20px 8px; background: ${T.surface}; border-block-end: 1px solid ${T.border}">
    ${wordmark(L.brandLabel)}
    <button class="btn btn-secondary btn-sm" aria-haspopup="listbox" style="min-height: 40px; gap: 6px">${I.globe(18)}<span>${L.langChip}</span>${I.chevronDown(16)}</button>
  </header>
  <main style="flex: 1 1 auto; overflow: hidden; display: flex; flex-direction: column; gap: 16px; padding: 12px 20px 0">
    <button style="display: inline-flex; align-items: center; gap: 6px; background: transparent; border: 0; padding: 4px 0; min-height: 44px; color: ${T.primary}; font-weight: 500; font-size: 15px; align-self: flex-start">
      ${I.pin(20)}<span>${L.deliveringTo}</span>${I.chevronDown(16)}
    </button>
    <div style="display: flex; flex-direction: column; gap: 6px">
      <h1 class="h-page">${L.headline}</h1>
      <p class="small" style="font-size: 15px">${L.sub}</p>
    </div>
    <div style="display: flex; flex-direction: column; gap: 8px">
      <div class="seg" role="group" aria-label="${L.pickup} / ${L.delivery}">
        <button aria-pressed="false">${I.store(18)}<span>${L.pickup}</span></button>
        <button aria-pressed="true">${I.pin(18)}<span>${L.delivery}</span></button>
      </div>
      <div class="seg" role="tablist">
        <button role="tab" aria-pressed="true">${L.restaurants}</button>
        <button role="tab" aria-pressed="false">${L.supermarkets}</button>
      </div>
    </div>
    <h2 class="h-sec">${L.around}</h2>
    <div style="display: flex; flex-direction: column; gap: 12px">
      ${L.biz.map(card).join('')}
    </div>
  </main>
  <div style="position: absolute; inset-inline: 0; bottom: 0; display: flex; flex-direction: column">
    <div style="padding: 0 20px 8px; background: linear-gradient(to bottom, rgba(250,247,240,0), ${T.bg} 40%)">
      <button class="btn btn-primary" style="width: 100%; justify-content: space-between; padding: 0 16px">
        <span style="display: inline-flex; align-items: center; gap: 8px">${I.cart(20)}<span>${L.cartItems}</span></span>
        <span style="display: inline-flex; align-items: center; gap: 12px"><span>${money('₪74')}</span><span style="font-weight: 500">${L.viewCart}</span>${I.chevronEnd(18)}</span>
      </button>
    </div>
    <nav aria-label="${L.navLabel}" style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 6px 12px 22px; background: ${T.surface}; border-block-start: 1px solid ${T.border}">
      ${navItem(L.nav[0], I.compass(22), true)}${navItem(L.nav[1], I.heart(22), false)}
      <span style="position: relative; display: contents">${navItem(L.nav[2], I.cart(22), false)}</span>
      ${navItem(L.nav[3], I.user(22), false)}
    </nav>
  </div>
</div>`;
};

// ---------- Business detail (mobile) ----------
const businessDetail = () => {
  const product = (name, desc, price, i) => `
    <div style="display: flex; gap: 12px; padding: 12px 0; border-block-end: 1px solid ${T.border}; align-items: center">
      <div class="img-fallback" style="width: 80px; height: 80px; border-radius: 12px; flex: 0 0 auto">${I.leaf(24)}</div>
      <div style="flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px">
        <h3 style="font-size: 16px; font-weight: 600; line-height: 1.35">${name}</h3>
        <p class="small" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden">${desc}</p>
        <p style="font-weight: 600; margin-block-start: 2px">${money(price)}${i === 2 ? ` <span class="small" style="font-weight: 400">· per plate</span>` : ''}</p>
      </div>
      <button class="icon-btn" aria-label="Add ${name}" style="background: ${T.soft}; border-color: #CFDDC2; color: ${T.primary}">${I.plus(22)}</button>
    </div>`;
  const chip = (label, active) => `<button style="min-height: 40px; padding: 0 14px; border-radius: 12px; border: 1px solid ${active ? '#CFDDC2' : T.border}; background: ${active ? T.soft : T.surface}; color: ${active ? T.primary : T.text}; font-weight: ${active ? 600 : 500}; font-size: 14px; white-space: nowrap">${label}</button>`;
  return `
<ROOT style="width: 390px; height: 844px; background: ${T.bg}; position: relative; overflow: hidden; display: flex; flex-direction: column">
  <div style="position: relative; aspect-ratio: 16 / 9; width: 100%; flex: 0 0 auto" class="img-fallback">
    ${I.leaf(40)}
    <button class="icon-btn" aria-label="Back" style="position: absolute; top: 12px; inset-inline-start: 12px">${I.back(22)}</button>
    <button class="icon-btn" aria-label="Add to favorites" style="position: absolute; top: 12px; inset-inline-end: 12px">${I.heart(22, false)}</button>
  </div>
  <main style="flex: 1 1 auto; overflow: hidden; display: flex; flex-direction: column; padding: 16px 20px 0; gap: 12px">
    <div style="display: flex; flex-direction: column; gap: 6px">
      <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px">
        <h1 class="h-page" style="font-size: 26px">Al-Karmel Grill</h1>
        <span class="badge badge-open" style="margin-block-start: 6px">Open until 23:00</span>
      </div>
      <p class="small">Grill · Restaurant · Beit Jann</p>
      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-block-start: 4px">
        <button class="btn btn-secondary btn-sm" aria-haspopup="listbox">${I.branch(18)}<span>Main branch · Beit Jann</span>${I.chevronDown(16)}</button>
        <a href="#" class="btn btn-secondary btn-sm" style="text-decoration: none">${I.phone(18)}<span>Call <bdi dir="ltr">04-987-0000</bdi></span></a>
      </div>
    </div>
    <div style="display: flex; gap: 8px; overflow: hidden; padding-block: 4px" role="tablist" aria-label="Categories">
      ${chip('Grills', true)}${chip('Salads &amp; sides', false)}${chip('Drinks', false)}${chip('Desserts', false)}
    </div>
    <div style="display: flex; flex-direction: column">
      <h2 class="h-sec" style="padding-block: 4px 0">Grills</h2>
      ${product('Mixed grill plate', 'Lamb kebab, chicken skewers, rice, grilled vegetables and tahini.', '₪58', 0)}
      ${product('Chicken shawarma plate', 'Marinated chicken, pickles, hummus and fresh pita.', '₪42', 1)}
      ${product('Lamb chops', 'Four chops with roasted potatoes and salad. Price per plate.', '₪86', 2)}
    </div>
  </main>
  <div style="position: absolute; inset-inline: 0; bottom: 0; padding: 12px 20px 22px; background: linear-gradient(to bottom, rgba(250,247,240,0), ${T.bg} 30%)">
    <button class="btn btn-primary" style="width: 100%; justify-content: space-between; padding: 0 16px">
      <span style="display: inline-flex; align-items: center; gap: 8px">${I.cart(20)}<span>2 items</span></span>
      <span style="display: inline-flex; align-items: center; gap: 12px"><span>${money('₪74')}</span><span style="font-weight: 500">View cart</span>${I.chevronEnd(18)}</span>
    </button>
  </div>
</div>`;
};

// ---------- Product options sheet (mobile) ----------
const productOptions = () => {
  const radio = (label, price, checked) => `
    <label style="display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 8px 12px; border-radius: 12px; border: 1px solid ${checked ? '#CFDDC2' : T.border}; background: ${checked ? T.soft : T.surface}">
      <span style="width: 22px; height: 22px; border-radius: 50%; border: 2px solid ${checked ? T.primary : '#9AA69B'}; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto">${checked ? `<span style="width: 10px; height: 10px; border-radius: 50%; background: ${T.primary}"></span>` : ''}</span>
      <span style="flex: 1 1 auto; font-weight: ${checked ? 600 : 500}">${label}</span>
      <span class="small" style="color: ${T.text}">${money(price)}</span>
    </label>`;
  const checkbox = (label, price, checked, disabled) => `
    <label style="display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 8px 12px; border-radius: 12px; border: 1px solid ${T.border}; background: ${T.surface}; ${disabled ? 'color: #8B948A' : ''}">
      <span style="width: 22px; height: 22px; border-radius: 6px; border: 2px solid ${checked ? T.primary : disabled ? '#C9CFC7' : '#9AA69B'}; background: ${checked ? T.primary : 'transparent'}; color: ${T.onPrimary}; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto">${checked ? I.check(14) : ''}</span>
      <span style="flex: 1 1 auto; font-weight: 500">${label}${disabled ? ` <span class="small" style="color: inherit">· Unavailable today</span>` : ''}</span>
      <span class="small" style="color: ${disabled ? 'inherit' : T.text}">${money(price)}</span>
    </label>`;
  return `
<ROOT style="width: 390px; height: 844px; background: ${T.bg}; position: relative; overflow: hidden">
  <div style="position: absolute; inset: 0; opacity: 0.35; display: flex; flex-direction: column; gap: 12px; padding: 0 20px">
    <div class="img-fallback" style="aspect-ratio: 16 / 9; margin: 0 -20px"></div>
    <h1 class="h-page" style="font-size: 26px">Al-Karmel Grill</h1>
    <p class="small">Grill · Restaurant · Beit Jann</p>
  </div>
  <div style="position: absolute; inset: 0; background: rgba(25, 62, 45, 0.35)"></div>
  <div role="dialog" aria-modal="true" aria-labelledby="sheet-title" style="position: absolute; inset-inline: 0; bottom: 0; max-height: 92%; background: ${T.surface}; border-start-start-radius: 20px; border-start-end-radius: 20px; display: flex; flex-direction: column; box-shadow: 0 -8px 32px rgba(25,62,45,0.12)">
    <div style="display: flex; justify-content: center; padding: 10px 0 0"><span style="width: 40px; height: 4px; border-radius: 2px; background: ${T.border}"></span></div>
    <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 8px 20px 12px">
      <div style="display: flex; flex-direction: column; gap: 2px">
        <h2 id="sheet-title" class="h-sec">Mixed grill plate</h2>
        <p class="small">Lamb kebab, chicken skewers, rice, grilled vegetables and tahini.</p>
      </div>
      <button class="icon-btn" aria-label="Close">${I.close(22)}</button>
    </div>
    <div style="flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: 20px; padding: 4px 20px 16px">
      <fieldset style="border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px">
        <legend style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 0 0 8px">
          <span style="font-weight: 600">Size</span><span class="badge badge-warm">Required · choose 1</span>
        </legend>
        ${radio('Regular', '₪58', true)}
        ${radio('Large', '+ ₪14', false)}
      </fieldset>
      <fieldset style="border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px">
        <legend style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 0 0 8px">
          <span style="font-weight: 600">Extras</span><span class="small">Optional · up to 3</span>
        </legend>
        ${checkbox('Extra tahini', '+ ₪4', true, false)}
        ${checkbox('Grilled halloumi', '+ ₪12', false, false)}
        ${checkbox('Vine leaves', '+ ₪10', false, true)}
      </fieldset>
      <div class="field">
        <label class="label" for="notes">Notes for the kitchen <span class="opt">(optional)</span></label>
        <div class="input textarea ph" id="notes" style="min-height: 72px">No onion, please.</div>
      </div>
    </div>
    <div style="display: flex; align-items: center; gap: 12px; padding: 12px 20px 22px; border-block-start: 1px solid ${T.border}; background: ${T.surface}">
      <div style="display: inline-flex; align-items: center; border: 1px solid ${T.border}; border-radius: 12px; overflow: hidden">
        <button class="icon-btn" aria-label="Decrease quantity" style="border: 0; border-radius: 0; width: 48px; height: 48px">${I.minus(20)}</button>
        <span class="num" style="min-width: 32px; text-align: center; font-weight: 600" aria-live="polite">1</span>
        <button class="icon-btn" aria-label="Increase quantity" style="border: 0; border-radius: 0; width: 48px; height: 48px">${I.plus(20)}</button>
      </div>
      <button class="btn btn-primary" style="flex: 1 1 auto; justify-content: space-between; padding: 0 16px"><span>Add to cart</span><span>${money('₪62')}</span></button>
    </div>
  </div>
</div>`;
};

// ---------- Checkout with village address (mobile, tall) ----------
const checkout = () => {
  const field = (id, label, value, opt, ph, extra = '') => `
    <div class="field">
      <label class="label" for="${id}">${label}${opt ? ` <span class="opt">(optional)</span>` : ''}</label>
      <div class="input ${ph ? 'ph' : ''}" id="${id}" style="display: flex; align-items: center; justify-content: space-between; ${extra}">${value}</div>
    </div>`;
  const row = (label, value, strong) => `
    <div style="display: flex; justify-content: space-between; gap: 12px; ${strong ? 'font-weight: 600; font-size: 18px' : ''}">
      <span ${strong ? '' : `class="small" style="color: ${T.text}"`}>${label}</span><span class="num">${value}</span>
    </div>`;
  return `
<ROOT style="width: 390px; min-height: 1900px; background: ${T.bg}; display: flex; flex-direction: column">
  <header style="display: flex; align-items: center; gap: 8px; padding: 12px 20px; background: ${T.surface}; border-block-end: 1px solid ${T.border}">
    <button class="icon-btn" aria-label="Back to cart" style="border-color: transparent; margin-inline-start: -10px">${I.back(22)}</button>
    <h1 class="h-sec">Checkout</h1>
    <span class="small" style="margin-inline-start: auto">Al-Karmel Grill · Main branch</span>
  </header>
  <main style="display: flex; flex-direction: column; gap: 24px; padding: 16px 20px 32px">
    <div class="seg" role="group" aria-label="Pickup or delivery">
      <button aria-pressed="false">${I.store(18)}<span>Pickup</span></button>
      <button aria-pressed="true">${I.pin(18)}<span>Delivery</span></button>
    </div>

    <section aria-labelledby="addr-h" style="display: flex; flex-direction: column; gap: 16px">
      <div style="display: flex; flex-direction: column; gap: 4px">
        <h2 id="addr-h" class="h-page" style="font-size: 24px">Your house, in your words.</h2>
        <p class="small" style="font-size: 15px">Help the business find you, even without a street name.</p>
      </div>

      <div style="background: ${T.soft}; border: 1px solid #CFDDC2; border-radius: 16px; padding: 16px; display: flex; flex-direction: column; gap: 10px">
        <div style="display: flex; align-items: center; gap: 8px; color: ${T.primary}">${I.house(22)}
          <label for="house" style="font-weight: 600">How do we find your house? <span aria-hidden="true" style="color: ${T.warm}">*</span></label>
        </div>
        <div class="input textarea" id="house" aria-required="true" style="border-color: #CFDDC2">Near the community center, the house with the blue gate, in the western neighborhood. Ask for the Haddad house.</div>
        <p class="hint">Mention the neighborhood, a landmark, your family name, or the gate color. The business reads this first.</p>
      </div>

      <div style="display: flex; flex-direction: column; gap: 14px">
        ${field('city', 'City', `<span>Beit Jann</span>${I.chevronDown(18)}`, false, false)}
        <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px">
          ${field('name', 'Recipient name', 'Rania Haddad', false, false)}
          ${field('phone', 'Contact phone', '<bdi dir="ltr">052-000-0000</bdi>', false, false)}
        </div>
        ${field('landmark', 'Neighborhood or landmark', 'Western neighborhood', true, true)}
        <div style="display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 12px">
          ${field('street', 'Street', 'If there is one', true, true)}
          ${field('bldg', 'Number', '—', true, true)}
        </div>
        ${field('apt', 'Apartment / floor / entrance', 'e.g. 2nd floor, side entrance', true, true)}
        ${field('label', 'Save as', `<span>Home</span>${I.chevronDown(18)}`, false, false)}
        <button class="btn btn-secondary" style="align-self: flex-start">${I.check(20)}<span>Save address</span></button>
      </div>
    </section>

    <div class="divider"></div>

    <section aria-labelledby="sum-h" style="display: flex; flex-direction: column; gap: 16px">
      <h2 id="sum-h" class="h-sec">Order summary</h2>
      <div class="card" style="padding: 16px; display: flex; flex-direction: column; gap: 12px">
        <div style="display: flex; justify-content: space-between; gap: 12px">
          <div style="display: flex; flex-direction: column"><span style="font-weight: 500">1 × Mixed grill plate</span><span class="small">Regular · Extra tahini · “No onion, please.”</span></div>
          <span class="num" style="font-weight: 500">${money('₪62')}</span>
        </div>
        <div style="display: flex; justify-content: space-between; gap: 12px">
          <div style="display: flex; flex-direction: column"><span style="font-weight: 500">1 × Fattoush salad</span></div>
          <span class="num" style="font-weight: 500">${money('₪22')}</span>
        </div>
        <div class="divider"></div>
        ${row('Merchandise subtotal', money('₪84'), false)}
        ${row('Delivery fee', money('₪10'), false)}
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px">
          <div style="display: flex; flex-direction: column"><span class="small" style="color: ${T.text}">Loyalty discount</span><span class="hint">8 points used · max 10% of merchandise</span></div>
          <span class="num" style="color: ${T.primary}">− ${money('₪8')}</span>
        </div>
        <div class="divider"></div>
        ${row('Cash on delivery', money('₪86'), true)}
        <p class="hint">Pay the courier in cash. This is an order summary, not a tax invoice.</p>
      </div>
      <div class="field">
        <label class="label" for="onote">Note to the business <span class="opt">(optional)</span></label>
        <div class="input ph" id="onote">Ring the bell twice.</div>
      </div>
      <button class="btn btn-primary" style="width: 100%; justify-content: space-between; padding: 0 20px"><span>Place order</span><span>${money('₪86')}</span></button>
      <p class="hint" style="text-align: center">You’ll see the order reference and can call the business right after.</p>
    </section>
  </main>
</div>`;
};

// ---------- Business dashboard: incoming orders (desktop) ----------
const dashboard = () => {
  const navItem = (icon, label, active, badge) => `
    <a href="#" aria-current="${active ? 'page' : 'false'}" style="display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 12px; border-radius: 12px; text-decoration: none; color: ${active ? T.primary : T.text}; background: ${active ? T.soft : 'transparent'}; font-weight: ${active ? 600 : 500}; font-size: 15px">
      ${icon}<span style="flex: 1 1 auto">${label}</span>${badge ? `<span class="badge badge-warm num">${badge}</span>` : ''}</a>`;
  const item = (qty, name, mods, price) => `
    <div style="display: flex; gap: 10px; justify-content: space-between">
      <div style="display: flex; gap: 8px; min-width: 0"><span class="num" style="font-weight: 600; flex: 0 0 auto">${qty}×</span>
        <div style="display: flex; flex-direction: column"><span style="font-weight: 500">${name}</span>${mods ? `<span class="small">${mods}</span>` : ''}</div></div>
      <span class="num small" style="color: ${T.text}; flex: 0 0 auto">${money(price)}</span>
    </div>`;
  const order = ({ ref, time, customer, phone, mode, house, items, total, state }) => `
    <article class="card" style="display: flex; flex-direction: column; gap: 14px; padding: 20px">
      <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px">
        <div style="display: flex; flex-direction: column; gap: 4px">
          <div style="display: flex; align-items: center; gap: 8px"><span class="num" style="font-size: 22px; font-weight: 600">${ref}</span>
            ${state === 'placed' ? '<span class="badge badge-placed">Placed</span>' : state === 'accepted' ? `<span class="badge badge-open">${I.check(12)} Accepted</span>` : '<span class="badge badge-err">Rejected</span>'}</div>
          <span class="small">${time} · ${customer}</span>
        </div>
        <span class="badge" style="background: ${mode === 'DELIVERY' ? T.soft : '#F4F3EC'}; color: ${mode === 'DELIVERY' ? T.primary : T.text}; font-weight: 600">${mode === 'DELIVERY' ? I.pin(12) : I.store(12)} ${mode}</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px">${items.map((i) => item(...i)).join('')}</div>
      ${house ? `
      <div style="background: ${T.soft}; border: 1px solid #CFDDC2; border-radius: 12px; padding: 12px; display: flex; gap: 10px">
        <span style="color: ${T.primary}; flex: 0 0 auto">${I.house(20)}</span>
        <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0">
          <span style="font-weight: 600; font-size: 15px; line-height: 1.4">${house}</span>
          <span class="small">Beit Jann · Western neighborhood · <bdi dir="ltr">${phone}</bdi></span>
        </div>
      </div>` : `
      <div style="border: 1px solid ${T.border}; border-radius: 12px; padding: 12px; display: flex; gap: 10px; align-items: center">
        <span style="color: ${T.muted}">${I.store(20)}</span><span class="small">Customer picks up · <bdi dir="ltr">${phone}</bdi></span>
      </div>`}
      <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding-block-start: 4px; border-block-start: 1px solid ${T.border}; padding-top: 12px">
        <span class="small" style="color: ${T.text}">Cash on ${mode === 'DELIVERY' ? 'delivery' : 'pickup'}</span><span class="num" style="font-size: 22px; font-weight: 600">${money(total)}</span>
      </div>
      ${state === 'placed' ? `
      <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px">
        <button class="btn btn-primary" style="padding: 0 12px; font-size: 15px; white-space: nowrap">${I.check(20)}<span>Accept order</span></button>
        <button class="btn btn-destructive" style="padding: 0 12px; font-size: 15px; white-space: nowrap">${I.close(20)}<span>Reject order</span></button>
      </div>` : `
      <div style="display: flex; flex-direction: column; gap: 10px">
        <div class="btn" style="background: ${T.soft}; color: ${T.primary}; border-color: #CFDDC2; cursor: default; justify-content: flex-start; padding: 0 16px">${I.check(20)}<span>Accepted 18:31 · awaiting cash</span></div>
        <button class="btn btn-secondary" style="justify-content: flex-start; padding: 0 16px">${I.coins(20)}<span>Record cash received</span></button>
      </div>`}
      <div style="display: flex; gap: 8px; flex-wrap: wrap">
        <a href="#" class="btn btn-secondary btn-sm" style="text-decoration: none">${I.phone(18)}<span>Call customer</span></a>
        <button class="btn btn-secondary btn-sm">${I.print(18)}<span>Print order</span></button>
        ${state === 'accepted' ? `<button class="btn btn-secondary btn-sm">${I.scale(18)}<span>Record weights / changes</span></button>` : ''}
      </div>
    </article>`;
  return `
<ROOT style="width: 1440px; height: 900px; background: ${T.bg}; display: grid; grid-template-columns: 264px minmax(0, 1fr); overflow: hidden">
  <aside style="background: ${T.surface}; border-inline-end: 1px solid ${T.border}; display: flex; flex-direction: column; gap: 24px; padding: 20px 16px">
    <div style="padding: 0 8px">${wordmark('Qareeb business dashboard')}</div>
    <nav aria-label="Dashboard" style="display: flex; flex-direction: column; gap: 4px">
      ${navItem(I.inbox(20), 'Incoming orders', true, 3)}
      ${navItem(I.list(20), 'Order history', false)}
      ${navItem(I.grid(20), 'Catalog', false)}
      ${navItem(I.box(20), 'Stock', false)}
      ${navItem(I.clock(20), 'Opening hours', false)}
      ${navItem(I.pin(20), 'Delivery areas', false)}
      ${navItem(I.print(20), 'Printers', false)}
      ${navItem(I.star(20), 'Loyalty', false)}
      ${navItem(I.users(20), 'Staff', false)}
      ${navItem(I.settings(20), 'Branch settings', false)}
    </nav>
    <div style="margin-block-start: auto; display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 12px; border: 1px solid ${T.border}">
      <span class="small">Business approval</span>
      <span class="badge badge-open" style="align-self: flex-start">${I.check(12)} Approved</span>
    </div>
  </aside>
  <div style="display: flex; flex-direction: column; min-width: 0">
    <header style="display: flex; align-items: center; gap: 16px; padding: 16px 32px; background: ${T.surface}; border-block-end: 1px solid ${T.border}">
      <button class="btn btn-secondary btn-sm" aria-haspopup="listbox" style="min-height: 44px">${I.store(18)}<span><strong style="font-weight: 600">Al-Karmel Grill</strong> · Main branch, Beit Jann</span>${I.chevronDown(16)}</button>
      <div style="margin-inline-start: auto; display: flex; align-items: center; gap: 12px">
        <div style="display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 12px; border-radius: 12px; border: 1px solid ${T.border}; font-size: 14px">
          ${I.bluetooth(18)}<span>Kitchen printer 80mm</span><span aria-hidden="true" style="width: 8px; height: 8px; border-radius: 50%; background: ${T.primary}"></span><span style="font-weight: 600; color: ${T.primary}">Connected</span>
        </div>
        <button class="btn btn-secondary btn-sm" aria-pressed="false" style="min-height: 44px">${I.pause(18)}<span>Pause new orders</span></button>
        <button class="icon-btn" aria-label="Notifications, 3 unread" style="position: relative">${I.bell(22)}<span style="position: absolute; top: 6px; inset-inline-end: 6px; width: 8px; height: 8px; border-radius: 50%; background: ${T.warm}"></span></button>
      </div>
    </header>
    <main style="padding: 24px 32px; display: flex; flex-direction: column; gap: 20px; overflow: hidden">
      <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
        <div style="display: flex; flex-direction: column; gap: 4px">
          <h1 class="h-desk" style="font-size: 32px">Incoming orders</h1>
          <p class="small">3 placed and waiting for your decision · sound alerts on</p>
        </div>
        <div style="display: flex; gap: 8px">
          <button class="btn btn-secondary btn-sm">Placed <span class="badge badge-warm num">3</span></button>
          <button class="btn btn-secondary btn-sm" style="border-color: transparent">Accepted today <span class="num" style="color: ${T.muted}">12</span></button>
        </div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; align-items: start">
        ${order({ ref: '#QB-2481', time: 'Placed 18:42', customer: 'Rania Haddad', phone: '052-000-0000', mode: 'DELIVERY',
          house: 'Near the community center, the house with the blue gate, in the western neighborhood. Ask for the Haddad house.',
          items: [[1, 'Mixed grill plate', 'Regular · Extra tahini · “No onion, please.”', '₪62'], [1, 'Fattoush salad', '', '₪22']], total: '₪86', state: 'placed' })}
        ${order({ ref: '#QB-2482', time: 'Placed 18:47', customer: 'Samer Khoury', phone: '054-000-0000', mode: 'PICKUP', house: null,
          items: [[2, 'Chicken shawarma plate', 'Extra pickles', '₪84'], [3, 'Lemonade 0.5 L', '', '₪27']], total: '₪111', state: 'placed' })}
        ${order({ ref: '#QB-2479', time: 'Placed 18:20', customer: 'Layla Saleh', phone: '050-000-0000', mode: 'DELIVERY',
          house: 'Next to the old mosque, second house up the hill on the right, green door. Saleh family.',
          items: [[1, 'Lamb chops', '', '₪86']], total: '₪98', state: 'accepted' })}
      </div>
    </main>
  </div>
</div>`;
};

// ---------- Admin approvals (desktop) ----------
const admin = () => {
  const navItem = (icon, label, active, badge) => `
    <a href="#" aria-current="${active ? 'page' : 'false'}" style="display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 12px; border-radius: 12px; text-decoration: none; color: ${active ? T.primary : T.text}; background: ${active ? T.soft : 'transparent'}; font-weight: ${active ? 600 : 500}; font-size: 15px">
      ${icon}<span style="flex: 1 1 auto">${label}</span>${badge ? `<span class="badge badge-warm num">${badge}</span>` : ''}</a>`;
  const metric = (label, value, note) => `
    <div class="card" style="padding: 16px 20px; display: flex; flex-direction: column; gap: 4px">
      <span class="small">${label}</span><span class="num" style="font-size: 24px; font-weight: 600; line-height: 1.2">${value}</span><span class="hint" style="font-size: 12px">${note}</span>
    </div>`;
  const tr = (cells, selected) => `
    <tr style="background: ${selected ? T.soft : 'transparent'}">${cells.map((c, i) => `<td style="padding: 12px 16px; border-block-end: 1px solid ${T.border}; vertical-align: middle; ${i === 0 ? 'font-weight: 500' : ''}">${c}</td>`).join('')}</tr>`;
  return `
<ROOT style="width: 1440px; height: 900px; background: ${T.bg}; display: grid; grid-template-columns: 264px minmax(0, 1fr); overflow: hidden">
  <aside style="background: ${T.surface}; border-inline-end: 1px solid ${T.border}; display: flex; flex-direction: column; gap: 24px; padding: 20px 16px">
    <div style="padding: 0 8px; display: flex; flex-direction: column; gap: 4px">${wordmark('Qareeb platform admin')}<span class="badge" style="align-self: flex-start; background: #F4F3EC; color: ${T.muted}">Platform admin</span></div>
    <nav aria-label="Admin" style="display: flex; flex-direction: column; gap: 4px">
      ${navItem(I.grid(20), 'Overview', false)}
      ${navItem(I.alert(20), 'Pending approvals', true, 4)}
      ${navItem(I.store(20), 'Businesses', false)}
      ${navItem(I.branch(20), 'Branches', false)}
      ${navItem(I.users(20), 'Users &amp; memberships', false)}
      ${navItem(I.list(20), 'Orders', false)}
      ${navItem(I.pin(20), 'Cities', false)}
      ${navItem(I.coins(20), 'Cash reconciliation', false)}
      ${navItem(I.star(20), 'Loyalty oversight', false)}
      ${navItem(I.settings(20), 'Platform settings', false)}
    </nav>
  </aside>
  <div style="display: flex; flex-direction: column; min-width: 0">
    <header style="display: flex; align-items: center; gap: 16px; padding: 16px 32px; background: ${T.surface}; border-block-end: 1px solid ${T.border}">
      <div class="input" style="display: flex; align-items: center; gap: 8px; max-width: 420px; min-height: 44px; color: #8B948A">${I.search(18)}<span>Search businesses, users, orders…</span></div>
      <div style="margin-inline-start: auto; display: flex; align-items: center; gap: 12px">
        <button class="btn btn-secondary btn-sm" style="min-height: 44px">${I.globe(18)}<span>EN</span>${I.chevronDown(16)}</button>
        <button class="btn btn-primary btn-sm" style="min-height: 44px">${I.plus(18)}<span>Invite owner</span></button>
      </div>
    </header>
    <main style="padding: 24px 32px; display: flex; flex-direction: column; gap: 20px; overflow: hidden">
      <div style="display: flex; flex-direction: column; gap: 4px">
        <h1 class="h-desk" style="font-size: 32px">Pending approvals</h1>
        <p class="small">Business and branch submissions waiting for a decision. Approval states are separate from order statuses.</p>
      </div>
      <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px">
        ${metric('Pending approvals', '4', '2 businesses · 2 branches')}
        ${metric('Placed today', '₪3,240', '41 orders placed')}
        ${metric('Accepted today', '₪2,915', '36 orders · acceptance is not revenue')}
        ${metric('Cash recorded today', '₪2,110', '29 manual cash records')}
      </div>
      <div style="display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 20px; align-items: start">
        <div class="card" style="overflow: hidden">
          <table style="width: 100%; border-collapse: collapse; font-size: 15px">
            <thead><tr style="text-align: start">${['Entity', 'Type', 'Owner', 'City', 'Submitted', 'State'].map((h) => `<th scope="col" style="text-align: start; padding: 12px 16px; font-size: 13px; font-weight: 600; color: ${T.muted}; border-block-end: 1px solid ${T.border}">${h}</th>`).join('')}</tr></thead>
            <tbody>
              ${tr(['Dar Yousef Supermarket', 'Supermarket · Business', 'Y. Yousef', 'Beit Jann', 'Today 09:14', '<span class="badge badge-warm">Pending</span>'], true)}
              ${tr(['Al-Karmel Grill · Hurfeish branch', 'Restaurant · Branch', 'K. Halabi', 'Hurfeish', 'Yesterday 20:02', '<span class="badge badge-warm">Pending</span>'], false)}
              ${tr(['Sweet Corner', 'Restaurant · Business', 'M. Kheir', 'Beit Jann', '2 days ago', '<span class="badge badge-warm">Pending</span>'], false)}
              ${tr(['Beit Jann Market · Lower branch', 'Supermarket · Branch', 'S. Assad', 'Beit Jann', '3 days ago', '<span class="badge badge-warm">Pending</span>'], false)}
            </tbody>
          </table>
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px">
            <span class="small">Showing 1–4 of 4</span>
            <div style="display: flex; gap: 8px"><button class="btn btn-secondary btn-sm" disabled style="color: #8B948A">Previous</button><button class="btn btn-secondary btn-sm" disabled style="color: #8B948A">Next</button></div>
          </div>
        </div>
        <aside class="card" aria-label="Approval detail" style="padding: 20px; display: flex; flex-direction: column; gap: 16px">
          <div style="display: flex; flex-direction: column; gap: 6px">
            <span class="badge badge-warm" style="align-self: flex-start">Pending business approval</span>
            <h2 class="h-sec">Dar Yousef Supermarket</h2>
            <p class="small">Supermarket · Default language Arabic · 1 branch, Beit Jann · Owner Y. Yousef (email verified)</p>
          </div>
          <dl style="margin: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 16px; font-size: 14px">
            <dt style="color: ${T.muted}">Catalog</dt><dd style="margin: 0">48 items prepared, hidden until approval</dd>
            <dt style="color: ${T.muted}">Delivery</dt><dd style="margin: 0">Beit Jann · ₪8 fee · ₪40 minimum</dd>
            <dt style="color: ${T.muted}">Phone</dt><dd style="margin: 0"><bdi dir="ltr">04-987-0100</bdi></dd>
            <dt style="color: ${T.muted}">Translations</dt><dd style="margin: 0">AR complete · HE 46 / 48 · EN 12 / 48</dd>
          </dl>
          <div class="field">
            <label class="label" for="reason">Decision reason <span class="opt">(recorded in the audit log)</span></label>
            <div class="input textarea ph" id="reason" style="min-height: 88px">Visible to the owner. Required when rejecting.</div>
          </div>
          <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px">
            <button class="btn btn-primary">${I.check(20)}<span>Approve business</span></button>
            <button class="btn btn-destructive">${I.close(20)}<span>Reject</span></button>
          </div>
          <p class="hint">Approving publishes the business and its approved branches to Beit Jann discovery.</p>
        </aside>
      </div>
    </main>
  </div>
</div>`;
};

// ---------- Token sheet ----------
const tokens = () => {
  const sw = (name, hex, fg) => `
    <div style="display: flex; flex-direction: column; gap: 6px">
      <div style="height: 56px; border-radius: 12px; background: ${hex}; border: 1px solid ${T.border}; display: flex; align-items: flex-end; padding: 8px; color: ${fg}; font-size: 12px; font-weight: 500"><bdi dir="ltr">${hex}</bdi></div>
      <span class="small" style="font-size: 13px">${name}</span>
    </div>`;
  return `
<ROOT style="width: 880px; min-height: 844px; background: ${T.bg}; padding: 32px; display: flex; flex-direction: column; gap: 28px">
  <div style="display: flex; align-items: center; justify-content: space-between">
    <div style="display: flex; flex-direction: column; gap: 4px"><h1 class="h-desk" style="font-size: 32px">Qareeb design tokens</h1><p class="small">Light theme baseline. Colors, type, spacing, radii and semantic states defined once and shared by every screen.</p></div>
    ${wordmark('Qareeb')}
  </div>
  <section style="display: flex; flex-direction: column; gap: 12px">
    <h2 class="h-sec">Color</h2>
    <div style="display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px">
      ${sw('Page background', T.bg, T.text)}${sw('Surface', T.surface, T.text)}${sw('Primary text', T.text, T.surface)}
      ${sw('Secondary text', T.muted, T.surface)}${sw('Primary action', T.primary, T.onPrimary)}${sw('Soft selected', T.soft, T.text)}
      ${sw('Border / divider', T.border, T.text)}${sw('Warm accent bg', T.warmBg, T.warm)}${sw('Warm accent text', T.warm, T.surface)}
      ${sw('Error bg', T.errBg, T.err)}${sw('Error text', T.err, T.surface)}
    </div>
  </section>
  <section style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 32px">
    <div style="display: flex; flex-direction: column; gap: 12px">
      <h2 class="h-sec">Type · Noto Sans / Hebrew / Arabic</h2>
      <div style="display: flex; flex-direction: column; gap: 10px">
        <div><span class="h-desk">Desktop headline 36</span></div>
        <div><span class="h-page">Mobile headline 28</span></div>
        <div><span class="h-sec">Section heading 20</span></div>
        <div>Body and inputs 16 / 1.5 — <span lang="he">דברים טובים. קרוב לבית.</span> <span lang="ar">أشياء طيّبة.</span></div>
        <div class="small">Secondary copy 14</div>
        <div><span class="badge badge-open">Badge 12</span></div>
        <div style="font-size: 22px; font-weight: 600" class="num">Total ${money('₪1,234.50')} · <bdi dir="ltr">052-000-0000</bdi></div>
      </div>
    </div>
    <div style="display: flex; flex-direction: column; gap: 12px">
      <h2 class="h-sec">Controls &amp; states</h2>
      <div style="display: flex; flex-wrap: wrap; gap: 10px">
        <button class="btn btn-primary">Primary 48</button>
        <button class="btn btn-secondary">Secondary</button>
        <button class="btn btn-destructive">Destructive</button>
        <button class="btn btn-secondary" disabled style="color: #8B948A">Disabled</button>
        <button class="icon-btn focus-ring" aria-label="Focused icon button">${I.heart(22)}</button>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px">
        <span class="badge badge-placed">Placed</span><span class="badge badge-open">${I.check(12)} Accepted</span><span class="badge badge-err">${I.close(12)} Rejected</span>
        <span class="badge badge-warm">Pending approval</span><span class="badge badge-closed">Closed</span><span class="badge badge-err">Suspended</span>
      </div>
      <div class="seg" style="max-width: 320px"><button aria-pressed="true">Selected</button><button aria-pressed="false">Option</button></div>
      <div class="field" style="max-width: 320px"><label class="label" for="tk">Labeled input <span class="opt">(optional)</span></label><div class="input ph" id="tk">Placeholder never the only label</div></div>
      <div class="field" style="max-width: 320px"><label class="label" for="tk2" style="color: ${T.err}">Contact phone</label><div class="input" id="tk2" style="border-color: ${T.err}"><bdi dir="ltr">05</bdi></div><span class="hint" style="color: ${T.err}">Enter a valid Israeli mobile number.</span></div>
    </div>
  </section>
  <section style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 32px">
    <div style="display: flex; flex-direction: column; gap: 12px">
      <h2 class="h-sec">Spacing · 4px system</h2>
      <div style="display: flex; align-items: flex-end; gap: 12px">${[4, 8, 12, 16, 20, 24, 32].map((s) => `<div style="display: flex; flex-direction: column; align-items: center; gap: 4px"><div style="width: ${s}px; height: ${s}px; background: ${T.primary}; border-radius: 2px"></div><span class="small" style="font-size: 12px">${s}</span></div>`).join('')}</div>
      <p class="hint">Gutters: 20px mobile (16 on very narrow), 32px desktop.</p>
    </div>
    <div style="display: flex; flex-direction: column; gap: 12px">
      <h2 class="h-sec">Radii</h2>
      <div style="display: flex; align-items: flex-end; gap: 12px">${[[16, 'Card'], [12, 'Input / button'], [14, 'Segmented'], [6, 'Badge']].map(([r, n]) => `<div style="display: flex; flex-direction: column; align-items: center; gap: 4px"><div style="width: 56px; height: 56px; background: ${T.surface}; border: 1px solid ${T.border}; border-radius: ${r}px"></div><span class="small" style="font-size: 12px">${n} ${r}</span></div>`).join('')}</div>
    </div>
  </section>
</div>`;
};

// ---------- Write files ----------
const out = (name, html) => writeFileSync(new URL(`./${name}`, import.meta.url), html);
out('Main.dc.html', shell({ title: 'Discovery · English', body: discovery(S.en), preview: { w: 390, h: 844 } }));
out('DiscoveryHebrew.dc.html', shell({ title: 'Discovery · Hebrew', lang: 'he', dir: 'rtl', body: discovery(S.he), preview: { w: 390, h: 844 } }));
out('DiscoveryArabic.dc.html', shell({ title: 'Discovery · Arabic', lang: 'ar', dir: 'rtl', body: discovery(S.ar), preview: { w: 390, h: 844 } }));
out('BusinessDetail.dc.html', shell({ title: 'Business detail', body: businessDetail(), preview: { w: 390, h: 844 } }));
out('ProductOptions.dc.html', shell({ title: 'Product options', body: productOptions(), preview: { w: 390, h: 844 } }));
out('Checkout.dc.html', shell({ title: 'Checkout · village address', body: checkout(), preview: { w: 390, h: 1900 } }));
out('IncomingOrders.dc.html', shell({ title: 'Business dashboard · incoming orders', body: dashboard(), preview: { w: 1440, h: 900 } }));
out('AdminApprovals.dc.html', shell({ title: 'Admin · pending approvals', body: admin(), preview: { w: 1440, h: 900 } }));
out('Tokens.dc.html', shell({ title: 'Design tokens', body: tokens(), preview: { w: 880, h: 1100 } }));

const canvas = {
  artboards: [
    { file: 'Main.dc.html', title: 'Discovery · EN', x: 0, y: 0, w: 390, h: 844 },
    { file: 'DiscoveryHebrew.dc.html', title: 'Discovery · HE (RTL)', x: 480, y: 0, w: 390, h: 844 },
    { file: 'DiscoveryArabic.dc.html', title: 'Discovery · AR (RTL)', x: 960, y: 0, w: 390, h: 844 },
    { file: 'BusinessDetail.dc.html', title: 'Business detail', x: 1440, y: 0, w: 390, h: 844 },
    { file: 'ProductOptions.dc.html', title: 'Product options sheet', x: 1920, y: 0, w: 390, h: 844 },
    { file: 'Tokens.dc.html', title: 'Design tokens', x: 2400, y: 0, w: 880, h: 1100 },
    { file: 'Checkout.dc.html', title: 'Checkout · village address', x: 0, y: 980, w: 390, h: 1900 },
    { file: 'IncomingOrders.dc.html', title: 'Business dashboard · incoming orders', x: 480, y: 980, w: 1440, h: 900 },
    { file: 'AdminApprovals.dc.html', title: 'Admin · pending approvals', x: 480, y: 2040, w: 1440, h: 900 },
  ],
  annotations: [
    { id: 'notes', x: 2400, y: 980, w: 420, text: 'Qareeb visual baseline, drafted from the build prompt.\n\nAll names, phone numbers, prices and orders are sample data for the mockup only.\nBusiness photos are shown as the quiet leaf fallback until owners upload imagery.\nStatic mockups: controls illustrate states, they are not wired.\nFonts: Noto Sans / Noto Sans Hebrew / Noto Sans Arabic; PNG/PDF export falls back to system sans.' },
  ],
  launch: { view: 'canvas' },
};
writeFileSync(new URL('./canvas.json', import.meta.url), JSON.stringify(canvas, null, 2));
console.log('wrote artboards + canvas.json');
