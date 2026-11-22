import { CV, UI } from './data.js';
import { icon } from './icons.js';

const doc = document.documentElement;
const body = document.body;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let lang = doc.lang === 'en' ? 'en' : 'ar';
let theme = doc.dataset.theme === 'light' ? 'light' : 'dark';
let scene = null;
let ready = false;

const tr = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? (o[lang] ?? o.ar) : o ?? '');
const u = (k) => UI[lang][k];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const bidi = (s) => esc(s).replace(/(\d[\d.,]*M?\+?)/g, '<bdi dir="ltr">$1</bdi>');
const sq = (ic, g, cls = '') => `<span class="squircle ${cls}" style="--g1:${g[0]};--g2:${g[1]}">${icon(ic)}</span>`;
const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };

const SEC_ICON = { home: 'person', about: 'quote', numbers: 'chart', work: 'case', tools: 'grid', learn: 'cap', contact: 'mail' };
const SECS = Object.keys(SEC_ICON);
const SPARK = [0.2, 0.28, 0.24, 0.36, 0.32, 0.46, 0.42, 0.55, 0.5, 0.64, 0.6, 0.74, 0.7, 0.86, 0.82, 1];
const STAT_ICON = [null, 'gauge', 'scale', 'seal'];

/* ───────── rendering ───────── */
const counted = new Set();
const revealed = new Set();
let words = [];
let lastLit = -1;

function renderText() {
  $$('[data-t]').forEach((el) => { el.textContent = u(el.dataset.t); });
  $$('[data-nav]').forEach((el) => { el.textContent = UI[lang].nav[el.dataset.nav]; });
  document.title = u('title');
  $('meta[name="description"]').setAttribute('content', u('description'));
  const nm = tr(CV.name).split(' ');
  const cut = lang === 'ar' ? 2 : 2;
  $('#heroName').innerHTML = `<span>${esc(nm.slice(0, cut).join(' '))}</span> <span>${esc(nm.slice(cut).join(' '))}</span>`;
  $('#heroRole').textContent = tr(CV.role);
  $('#heroLead').textContent = tr(CV.lead);
  $('#heroCta').innerHTML =
    `<a class="btn primary" href="#contact">${icon('mail')}<span>${esc(u('ctaContact'))}</span></a>` +
    `<a class="btn glass" href="#work"><span>${esc(u('ctaWork'))}</span>${icon('arrow')}</a>`;
  $('#homeScreen').setAttribute('aria-label', u('toolsEyebrow'));
  $('#islandMenu').setAttribute('aria-label', u('menu'));
  $('#foot').textContent = `© ${new Date().getFullYear()} ${tr(CV.name)} · ${u('rights')}`;
}

function renderWords() {
  const parts = tr(CV.statement).split(/\s+/).filter(Boolean);
  $('#words').innerHTML = parts
    .map((w) => {
      const hl = w.startsWith('*') && w.endsWith('*');
      return `<span class="w${hl ? ' hl' : ''}">${esc(w.replace(/\*/g, ''))}</span>`;
    })
    .join(' ');
  words = $$('#words .w');
  lastLit = -1;
}

function renderStats() {
  $('#stats').innerHTML = CV.stats
    .map((s, i) => {
      const d = s.decimals || 0;
      const val = counted.has(i) || reduced ? s.value.toFixed(d) : (0).toFixed(d);
      const num = `<div class="num grad" dir="ltr"><span class="cnt" aria-hidden="true" data-v="${s.value}" data-d="${d}">${val}</span><span class="cnt-f">${s.value.toFixed(d)}</span>${esc(s.suffix || '')}</div>`;
      const text = `<div class="stat-body">${num}<p>${esc(tr(s.label))}</p></div>`;
      if (s.featured) {
        const bars = SPARK.map((h, j) => `<i style="--h:${h};--j:${j}"></i>`).join('');
        return `<article class="stat glass rv featured" style="--i:${i}" data-i="${i}">${text}<div class="spark" aria-hidden="true">${bars}</div></article>`;
      }
      if (i === 3) {
        const seals = CV.certs.map((c, j) => `<span style="--j:${j}">${sq(c.icon, c.grad, 'mini')}</span>`).join('');
        return `<article class="stat glass rv wide" style="--i:${i}" data-i="${i}">${text}<div class="seals" aria-hidden="true">${seals}</div></article>`;
      }
      return `<article class="stat glass rv" style="--i:${i}" data-i="${i}"><span class="stat-ic" aria-hidden="true">${icon(STAT_ICON[i])}</span>${text}</article>`;
    })
    .join('');
}

function renderJobs() {
  $('#jobs').innerHTML = CV.experience
    .map(
      (j, i) => `<article class="job glass rv" style="--i:${i % 2}">
        <header class="job-head">${sq(j.icon, j.grad)}
          <div class="job-t"><h3>${esc(tr(j.title))}</h3><p class="org">${esc(tr(j.org))}</p></div>
          ${j.period ? `<span class="pill">${esc(j.period)}</span>` : ''}
        </header>
        <ul>${tr(j.points).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      </article>`,
    )
    .join('');
}

function renderTools() {
  const app = (t, j) => `<div class="app" style="--j:${j}">${sq(t.icon, t.grad)}<span class="lbl">${esc(tr(t.label))}</span></div>`;
  $('#homeGrid').innerHTML = CV.tools.map(app).join('');
  $('#dock').innerHTML = CV.dock.map((t, j) => app(t, j + CV.tools.length)).join('');
  $('#printTools').innerHTML = [...CV.dock, ...CV.tools].map((t) => `<li>${esc(tr(t.label))}</li>`).join('');
}

function renderLearn() {
  const e = CV.education;
  $('#bento').innerHTML = `
    <article class="edu rv" style="--i:0">
      <div class="edu-top"><span class="edu-label">${esc(u('edu'))}</span>${sq('cap', ['rgba(255,255,255,.22)', 'rgba(255,255,255,.08)'], 'sm glassy')}</div>
      <div class="edu-main"><h3>${esc(tr(e.degree))}</h3><p class="track">${esc(tr(e.track))}</p></div>
      <div class="edu-foot"><p class="school">${esc(tr(e.school))}</p><span class="edu-year"><bdi>${esc(e.year)}</bdi></span></div>
    </article>
    <article class="langs glass rv" style="--i:1">
      <div class="card-h">${sq('globe', ['#8cc8ff', '#3474e0'], 'sm')}<h3>${esc(u('langs'))}</h3></div>
      <ul>${CV.languages.map((l) => `<li><b>${esc(tr(l.name))}</b>${tr(l.level) ? `<span>${esc(tr(l.level))}</span>` : ''}</li>`).join('')}</ul>
    </article>
    <article class="certs glass rv" style="--i:2">
      <div class="card-h">${sq('seal', ['#7ef0ff', '#0b86ad'], 'sm')}<h3>${esc(u('certs'))}</h3></div>
      <ul class="certs-list">${CV.certs.map((c) => `<li class="row">${sq(c.icon, c.grad, 'xs')}<b>${esc(tr(c.title))}</b>${c.note ? `<small>${esc(tr(c.note))}</small>` : ''}</li>`).join('')}</ul>
    </article>`;
}

function renderContact() {
  $('#contactCta').innerHTML =
    `<a class="btn primary" href="mailto:${CV.email}">${icon('mail')}<span>${esc(u('mail'))}</span></a>` +
    `<button class="btn glass" type="button" id="copyBtn">${icon('copy')}<span>${esc(u('copy'))}</span></button>` +
    `<button class="btn glass" type="button" id="pdfBtn">${icon('doc')}<span>${esc(u('pdf'))}</span></button>`;
  const a = $('#emailLink');
  a.href = `mailto:${CV.email}`;
  a.textContent = CV.email;
  $('#copyBtn').addEventListener('click', copyEmail);
  $('#pdfBtn').addEventListener('click', () => window.print());
}

function renderMenu() {
  $('#islandMenu').innerHTML = Object.keys(SEC_ICON)
    .map((k) => `<a href="#${k}" data-k="${k}">${icon(SEC_ICON[k])}<span>${esc(UI[lang].nav[k])}</span></a>`)
    .join('');
}

function renderAll() {
  renderText();
  renderWords();
  renderStats();
  renderJobs();
  renderTools();
  renderLearn();
  renderContact();
  renderMenu();
  renderRail();
  observeReveals();
}

/* ───────── reveal on scroll ───────── */
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      reveal(e.target);
      io.unobserve(e.target);
    }
  },
  { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
);
function reveal(el) {
  el.classList.add('in');
  const sec = el.closest('[data-sec]');
  if (sec) revealed.add(sec.id + ':' + [...sec.querySelectorAll('.rv')].indexOf(el));
  if (el.classList.contains('stat')) countUp(el);
}
function observeReveals() {
  body.classList.add('instant');
  $$('.rv').forEach((el) => {
    const sec = el.closest('[data-sec]');
    const key = sec ? sec.id + ':' + [...sec.querySelectorAll('.rv')].indexOf(el) : '';
    if (reduced || revealed.has(key)) {
      el.classList.add('in');
      if (el.classList.contains('stat')) countUp(el, true);
    } else io.observe(el);
  });
  requestAnimationFrame(() => requestAnimationFrame(() => body.classList.remove('instant')));
}
function countUp(card, instant = false) {
  const i = +card.dataset.i;
  const el = card.querySelector('.cnt');
  const v = +el.dataset.v, d = +el.dataset.d;
  if (instant || counted.has(i) || reduced) { el.textContent = v.toFixed(d); counted.add(i); return; }
  counted.add(i);
  const t0 = performance.now() + 250, dur = 1800;
  const step = (now) => {
    const p = Math.max(0, Math.min(1, (now - t0) / dur));
    const e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
    el.textContent = (v * e).toFixed(d);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ───────── Dynamic Island ───────── */
const island = $('#island');
const islandInner = island.querySelector('.island-inner');
const menu = $('#islandMenu');
let iState = 'intro', iTimer = 0, swapTimer = 0, curSec = 'home', iKey = '';

const narrowBar = matchMedia('(max-width: 340px)');
function maxIslandWidth() {
  const bar = $('.statusbar');
  const ctl = $('.controls');
  const cs = getComputedStyle(bar);
  const inner = bar.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  // very narrow screens: the island takes the space beside the switches (see the CSS)
  if (narrowBar.matches) return Math.max(118, inner - ctl.offsetWidth - 2 * (parseFloat(cs.columnGap) || 0) - 8);
  return Math.max(118, inner - 2 * (ctl.offsetWidth + 8));
}
function fitIsland() {
  // on narrow phones the island stays centred between the switches, so when the text
  // does not fit it first tightens its padding, then drops the icon, instead of crowding the edge
  const max = maxIslandWidth();
  const need = () => Math.ceil(islandInner.scrollWidth) + 2;
  island.classList.remove('tight', 'bare');
  if (need() > max) island.classList.add('tight');
  if (need() > max) island.classList.add('bare');
  island.style.width = Math.max(118, Math.min(max, need())) + 'px';
}
function islandSet(key, ico, html) {
  if (key === iKey) return;
  iKey = key;
  island.classList.add('swap');
  clearTimeout(swapTimer);
  swapTimer = setTimeout(() => {
    $('#islandIco').innerHTML = ico;
    $('#islandTxt').innerHTML = html;
    island.setAttribute('aria-label', $('#islandTxt').textContent);
    fitIsland();
    island.classList.remove('swap');
  }, 170);
}
function islandIntro() {
  const small = innerWidth < 600;
  islandSet('intro' + lang, '<span class="spinner"></span>', `${esc(small ? u('initShort') : u('init'))}<span class="dots-anim"><i>.</i><i>.</i><i>.</i></span>`);
}
function islandAvailable() {
  iState = 'available';
  islandSet('avail' + lang, '<span class="live"></span>', esc(u(innerWidth < 600 ? 'availableShort' : 'available')));
  clearTimeout(iTimer);
  iTimer = setTimeout(() => { iState = 'nav'; islandSection(); }, 3400);
}
function islandSection() {
  const label = curSec === 'home' ? tr(CV.short) : UI[lang].nav[curSec];
  islandSet('sec' + curSec + lang, icon(SEC_ICON[curSec]), esc(label));
  $$('#islandMenu a').forEach((a) => a.classList.toggle('cur', a.dataset.k === curSec));
}
function islandToast(text) {
  iState = 'toast';
  islandSet('toast' + Date.now(), `<span class="ok">${icon('check')}</span>`, esc(text));
  clearTimeout(iTimer);
  iTimer = setTimeout(() => { iState = 'nav'; iKey = ''; islandSection(); }, 2200);
}
function refreshIsland() {
  iKey = '';
  if (iState === 'intro') islandIntro();
  else if (iState === 'available') islandSet('avail' + lang, '<span class="live"></span>', esc(u(innerWidth < 600 ? 'availableShort' : 'available')));
  else islandSection();
}
function toggleMenu(force) {
  const open = force ?? !menu.classList.contains('open');
  menu.classList.toggle('open', open);
  island.setAttribute('aria-expanded', String(open));
}
island.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!ready) { scene?.skip(); if (!scene) onReady(); return; }
  toggleMenu();
});
document.addEventListener('click', (e) => { if (!menu.contains(e.target)) toggleMenu(false); });
menu.addEventListener('click', (e) => { if (e.target.closest('a')) toggleMenu(false); });
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') toggleMenu(false);
  if (!ready && ['Escape', 'Enter', ' ', 'ArrowDown', 'PageDown'].includes(e.key)) scene?.skip();
});

/* ───────── section rail: where you are on the page ───────── */
const rail = $('#rail');
let railIdx = -1, railP = -1, peekT = 0;
function renderRail() {
  rail.setAttribute('aria-label', u('sections'));
  rail.innerHTML = '<span class="rail-track" aria-hidden="true"><i id="railFill"></i></span>' +
    SECS.map((k) => `<a href="#${k}" data-k="${k}"><i aria-hidden="true"></i><span class="rail-tip">${esc(UI[lang].nav[k])}</span></a>`).join('');
  railIdx = -1;
  railP = -1;
  updateSections(false);
}
// A section becomes current once its top passes 45% of the screen (the first one from the top of the page).
// The island and the rail both follow it, and the rail's line fills from one section's dot to the next
// as you read through it, so it always shows how far down the page you are.
function updateSections(peek = true) {
  const n = SECS.length, y = scrollY, line = innerHeight * 0.45;
  const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
  const at = [];
  for (let i = 0; i < n; i++) {
    const el = document.getElementById(SECS[i]);
    const v = i === 0 || !el ? 0 : Math.min(max, el.getBoundingClientRect().top + y - line);
    at.push(Math.max(v, i ? at[i - 1] : 0));
  }
  let p = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (y < at[i] - 0.5) continue;
    p = i < n - 1 ? i + Math.min(1, (y - at[i]) / Math.max(1, at[i + 1] - at[i])) : i;
    break;
  }
  const idx = Math.min(n - 1, Math.floor(p + 1e-4));
  if (idx !== railIdx) {
    railIdx = idx;
    rail.querySelectorAll('a').forEach((a, i) => {
      a.classList.toggle('cur', i === idx);
      a.classList.toggle('done', i < idx);
      if (i === idx) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    });
    if (SECS[idx] !== curSec) {
      curSec = SECS[idx];
      if (iState === 'nav') islandSection();
    }
    // name the new section beside the rail for a moment
    if (peek && ready) {
      rail.classList.add('peek');
      clearTimeout(peekT);
      peekT = setTimeout(() => rail.classList.remove('peek'), 1600);
    }
  }
  const v = Math.min(1, p / (n - 1));
  if (Math.abs(v - railP) > 0.0005) {
    railP = v;
    document.getElementById('railFill').style.transform = `scaleY(${v.toFixed(4)})`;
  }
}

/* ───────── status bar clock ───────── */
function tick() {
  const d = new Date();
  $('#clock').textContent = `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
}
tick();
setInterval(tick, 10000);

/* ───────── switches ───────── */
function syncSwitches() {
  const sl = $('#swLang'), st = $('#swTheme');
  sl.setAttribute('aria-checked', String(lang === 'en'));
  sl.setAttribute('aria-label', u('langLabel'));
  $('#swLangK').textContent = lang === 'en' ? 'EN' : 'ع';
  st.setAttribute('aria-checked', String(theme === 'dark'));
  st.setAttribute('aria-label', u('themeLabel'));
  $('#swThemeL').innerHTML = `${icon('sun')}${icon('moon')}`;
  $('#swThemeK').innerHTML = icon(theme === 'dark' ? 'moon' : 'sun');
}
function withTransition(fn, origin) {
  if (!document.startViewTransition || reduced) { fn(); return; }
  const vt = document.startViewTransition(fn);
  if (!origin) return;
  const r = origin.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  vt.ready
    .then(() => doc.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] }, { duration: 700, easing: 'cubic-bezier(.4,0,.2,1)', pseudoElement: '::view-transition-new(root)' }))
    .catch(() => {});
}
function setTheme(t) {
  theme = t;
  doc.dataset.theme = t;
  store('theme', t);
  $('meta[name="theme-color"]').setAttribute('content', t === 'dark' ? '#000000' : '#f5f5f7');
  scene?.setTheme(t);
  syncSwitches();
}
function calloutLabels() {
  const m = {};
  for (const [k, v] of Object.entries(CV.callouts)) m[k] = { t: bidi(tr(v.t)), s: esc(tr(v.s)), to: v.to };
  return m;
}
function setLang(l) {
  lang = l;
  doc.lang = l;
  doc.dir = l === 'ar' ? 'rtl' : 'ltr';
  store('lang', l);
  renderAll();
  syncSwitches();
  refreshIsland();
  scene?.setLang(l, calloutLabels());
  onScroll();
  // the other script's font may arrive a moment later: re-measure the island and the labels
  if (document.fonts) document.fonts.ready.then(() => { fitIsland(); scene?.relayout(); });
}
$('#swTheme').addEventListener('click', (e) => withTransition(() => setTheme(theme === 'dark' ? 'light' : 'dark'), e.currentTarget));
$('#swLang').addEventListener('click', () => withTransition(() => setLang(lang === 'ar' ? 'en' : 'ar')));

/* ───────── actions ───────── */
async function copyEmail() {
  try {
    await navigator.clipboard.writeText(CV.email);
    islandToast(u('copied'));
  } catch (e) {
    location.href = `mailto:${CV.email}`;
  }
}
$('#skip').addEventListener('click', () => { scene?.skip(); if (!scene) onReady(); });

/* glass highlight follows the pointer */
addEventListener('pointermove', (e) => {
  const el = e.target.closest && e.target.closest('.glass');
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - r.left}px`);
  el.style.setProperty('--my', `${e.clientY - r.top}px`);
}, { passive: true });

/* ───────── scroll ───────── */
const canvas = $('#gl');
const statement = $('#about');
let ticking = false;
function onScroll() {
  const vh = innerHeight, y = scrollY;
  const k = Math.min(1, y / (vh * 0.85));
  canvas.style.opacity = String(1 - 0.84 * k);
  scene?.setScroll(k);
  body.classList.toggle('scrolled', y > 40);
  body.classList.toggle('rail-on', y > vh * 0.25);
  if (!ready && y > 30) scene?.skip();
  updateSections();
  // scroll-lit statement
  const r = statement.getBoundingClientRect();
  const span = Math.max(1, r.height - vh);
  const p = reduced ? 1 : Math.min(1, Math.max(0, (-r.top + vh * 0.12) / (span * 0.78)));
  const lit = Math.round(p * words.length);
  if (lit !== lastLit) {
    for (let i = 0; i < words.length; i++) words[i].classList.toggle('lit', i < lit);
    lastLit = lit;
  }
}
addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; onScroll(); });
}, { passive: true });
addEventListener('resize', () => { fitIsland(); onScroll(); });

/* ───────── intro / ready ───────── */
function onReady() {
  if (ready) return;
  ready = true;
  body.classList.remove('intro');
  body.classList.add('ready');
  $('#siri').classList.remove('on');
  islandAvailable();
}

renderAll();
syncSwitches();
islandIntro();
onScroll();
if (document.fonts) document.fonts.ready.then(fitIsland);
if (!reduced) $('#siri').classList.add('on');

import('./scene.js')
  .then((m) => {
    scene = m.createScene({
      canvas,
      calloutsEl: $('#callouts'),
      labels: calloutLabels(),
      theme,
      lang,
      reduced,
      getReserve: () => $('#heroText').offsetHeight + 40,
      onPhase: (name) => {
        if (name === 'formed') $('#siri').classList.remove('on');
        if (name === 'ready') onReady();
      },
    });
    if (!scene) { body.classList.add('no-webgl'); onReady(); return; }
    const dbg = /^#t=([\d.]+)$/.exec(location.hash);
    if (dbg) scene.freeze(parseFloat(dbg[1]));
    // label widths change once the web fonts arrive
    if (document.fonts) document.fonts.ready.then(() => scene.relayout());
  })
  .catch(() => { body.classList.add('no-webgl'); onReady(); });

setTimeout(onReady, 9000);
