/**
 * ----------------------------------------------------------------------------
 *  لایه‌ی نمایش مشترک: پوسته صفحه، استایل‌ها، آیکون‌ها و توابع جاوااسکریپت
 * ----------------------------------------------------------------------------
 *  تمام کد فرانت‌اند در Template Literal نوشته شده است و نیازی به بیلد استپ
 *  جداگانه ندارد. Tailwind از CDN بارگذاری می‌شود.
 */
import type { Role } from '../types';
import { escapeHtml } from '../lib/utils';

export const APP_NAME = 'باشگاه مشتریان کافه';

/* ==========================================================================
 *  آیکون‌ها (SVG درون‌خطی — بدون وابستگی خارجی)
 * ========================================================================== */

const ICONS: Record<string, string> = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  receipt:
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
  chat:
    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  gift:
    '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v9H5v-9"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  menu: '<path d="M3 12h18"/><path d="M3 6h18"/><path d="M3 18h18"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  warning: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  trending: '<path d="m23 6-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
  coffee:
    '<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><path d="M6 2v2"/><path d="M10 2v2"/><path d="M14 2v2"/>',
  calendar:
    '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  phone:
    '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  wallet:
    '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  refresh:
    '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
  trash:
    '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 8.6-8.6"/><path d="m15 8 3 3"/><path d="m18 5 2 2"/>',
  shield:
    '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1Z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5Z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  chart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  userCheck:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>',
  sparkles:
    '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z"/>',
};

export function icon(name: string, className = 'w-5 h-5'): string {
  const path = ICONS[name] ?? ICONS.sparkles;
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

/* ==========================================================================
 *  استایل‌های مشترک
 * ========================================================================== */

export const BASE_STYLES = `
  :root {
    --coffee-950: #0b0705;
    --coffee-900: #150e09;
    --coffee-800: #241710;
    --gold: #e8b45a;
    --gold-soft: #f1cf95;
    --cream: #f6ecdd;
  }
  * { -webkit-tap-highlight-color: transparent; }
  html { scroll-behavior: smooth; }
  body {
    font-family: Vazirmatn, Tahoma, 'Segoe UI', system-ui, sans-serif;
    background-color: #0b0705;
    background-image:
      radial-gradient(900px 500px at 85% -10%, rgba(232, 180, 90, 0.16), transparent 60%),
      radial-gradient(700px 420px at 5% 5%, rgba(160, 111, 66, 0.16), transparent 60%),
      radial-gradient(1200px 800px at 50% 110%, rgba(90, 52, 30, 0.28), transparent 65%);
    background-attachment: fixed;
    color: #f2e7d8;
    min-height: 100vh;
  }
  .glass {
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid rgba(255, 255, 255, 0.09);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
  }
  .glass-strong {
    background: rgba(28, 19, 13, 0.86);
    border: 1px solid rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(22px);
    -webkit-backdrop-filter: blur(22px);
  }
  .card-hover { transition: transform .25s ease, border-color .25s ease, box-shadow .25s ease; }
  .card-hover:hover { transform: translateY(-3px); border-color: rgba(232, 180, 90, .35); box-shadow: 0 18px 40px -22px rgba(232, 180, 90, .45); }
  .gold-text {
    background: linear-gradient(115deg, #f7dfb1 0%, #e8b45a 45%, #c98f3f 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .gold-bg { background-image: linear-gradient(120deg, #f0c987 0%, #e8b45a 50%, #c98f3f 100%); }
  .gold-ring { box-shadow: 0 0 0 1px rgba(232,180,90,.35), 0 10px 30px -12px rgba(232,180,90,.45); }
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
  ::-webkit-scrollbar { width: 9px; height: 9px; }
  ::-webkit-scrollbar-track { background: rgba(255,255,255,.03); }
  ::-webkit-scrollbar-thumb { background: rgba(232,180,90,.25); border-radius: 99px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(232,180,90,.45); }

  .field {
    width: 100%;
    background: rgba(255,255,255,.045);
    border: 1px solid rgba(255,255,255,.12);
    border-radius: 0.9rem;
    padding: 0.7rem 0.95rem;
    color: #f6ecdd;
    transition: border-color .2s ease, box-shadow .2s ease, background .2s ease;
    font-size: 0.925rem;
  }
  .field::placeholder { color: rgba(246,236,221,.32); }
  .field:focus {
    outline: none;
    border-color: rgba(232,180,90,.65);
    box-shadow: 0 0 0 4px rgba(232,180,90,.12);
    background: rgba(255,255,255,.06);
  }
  .field:disabled { opacity: .55; cursor: not-allowed; }
  select.field option { background: #1b120c; color: #f6ecdd; }
  textarea.field { line-height: 1.9; resize: vertical; }

  .label { display: block; font-size: .8rem; color: rgba(246,236,221,.62); margin-bottom: .45rem; font-weight: 500; }
  .hint { font-size: .74rem; color: rgba(246,236,221,.45); margin-top: .35rem; line-height: 1.7; }

  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: .5rem;
    border-radius: .9rem; font-weight: 600; font-size: .9rem; padding: .7rem 1.15rem;
    transition: transform .18s ease, opacity .18s ease, background .18s ease, border-color .18s ease;
    cursor: pointer; border: 1px solid transparent; white-space: nowrap;
  }
  .btn:active { transform: scale(.975); }
  .btn:disabled { opacity: .55; cursor: not-allowed; }
  .btn-primary { background-image: linear-gradient(120deg, #f0c987 0%, #e8b45a 50%, #c98f3f 100%); color: #231509; box-shadow: 0 12px 30px -14px rgba(232,180,90,.7); }
  .btn-primary:hover { filter: brightness(1.06); }
  .btn-ghost { background: rgba(255,255,255,.05); border-color: rgba(255,255,255,.12); color: #f6ecdd; }
  .btn-ghost:hover { background: rgba(255,255,255,.09); border-color: rgba(232,180,90,.3); }
  .btn-danger { background: rgba(220,38,38,.14); border-color: rgba(248,113,113,.35); color: #fca5a5; }
  .btn-danger:hover { background: rgba(220,38,38,.24); }
  .btn-sm { padding: .42rem .75rem; font-size: .8rem; border-radius: .7rem; }

  .badge { display: inline-flex; align-items: center; gap: .3rem; border-radius: 99px; padding: .2rem .6rem; font-size: .72rem; font-weight: 600; border: 1px solid transparent; }
  .tone-success { background: rgba(34,197,94,.12); color: #86efac; border-color: rgba(34,197,94,.25); }
  .tone-warning { background: rgba(245,158,11,.12); color: #fcd34d; border-color: rgba(245,158,11,.28); }
  .tone-danger { background: rgba(239,68,68,.12); color: #fca5a5; border-color: rgba(239,68,68,.28); }
  .tone-muted { background: rgba(255,255,255,.06); color: rgba(246,236,221,.6); border-color: rgba(255,255,255,.1); }
  .tone-info { background: rgba(59,130,246,.12); color: #93c5fd; border-color: rgba(59,130,246,.25); }

  .table-wrap { overflow-x: auto; }
  table.data { width: 100%; border-collapse: separate; border-spacing: 0; font-size: .85rem; }
  table.data thead th {
    text-align: right; font-weight: 600; font-size: .74rem; color: rgba(246,236,221,.5);
    padding: .75rem .9rem; border-bottom: 1px solid rgba(255,255,255,.08);
    position: sticky; top: 0; background: rgba(16,11,8,.92); backdrop-filter: blur(8px); z-index: 1;
  }
  table.data tbody td { padding: .8rem .9rem; border-bottom: 1px solid rgba(255,255,255,.05); vertical-align: middle; }
  table.data tbody tr { transition: background .15s ease; }
  table.data tbody tr:hover { background: rgba(232,180,90,.05); }
  table.data tbody tr:last-child td { border-bottom: none; }

  .nav-item { display: flex; align-items: center; gap: .7rem; padding: .62rem .8rem; border-radius: .8rem; color: rgba(246,236,221,.66); font-size: .875rem; font-weight: 500; transition: all .18s ease; }
  .nav-item:hover { background: rgba(255,255,255,.05); color: #f6ecdd; }
  .nav-item.active { background: rgba(232,180,90,.14); color: #f1cf95; box-shadow: inset 0 0 0 1px rgba(232,180,90,.22); }

  .toast { pointer-events: auto; display: flex; align-items: flex-start; gap: .65rem; min-width: 260px; max-width: 380px; padding: .8rem 1rem; border-radius: .9rem; font-size: .845rem; line-height: 1.7; border: 1px solid; box-shadow: 0 20px 45px -18px rgba(0,0,0,.75); animation: toastIn .28s cubic-bezier(.2,.9,.3,1.2); }
  .toast.out { animation: toastOut .22s ease forwards; }
  .toast-success { background: rgba(18,46,29,.96); border-color: rgba(34,197,94,.4); color: #bbf7d0; }
  .toast-error { background: rgba(54,16,16,.96); border-color: rgba(239,68,68,.42); color: #fecaca; }
  .toast-info { background: rgba(35,26,14,.96); border-color: rgba(232,180,90,.4); color: #f6e3bd; }
  @keyframes toastIn { from { opacity: 0; transform: translateY(-12px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes toastOut { to { opacity: 0; transform: translateY(-8px) scale(.98); } }

  .skeleton { background: linear-gradient(90deg, rgba(255,255,255,.05) 25%, rgba(255,255,255,.1) 37%, rgba(255,255,255,.05) 63%); background-size: 400% 100%; animation: shimmer 1.4s ease infinite; border-radius: .6rem; }
  @keyframes shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }

  .float-slow { animation: floatY 9s ease-in-out infinite; }
  .float-slower { animation: floatY 13s ease-in-out infinite; }
  @keyframes floatY { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-14px) rotate(3deg); } }

  .bar-track { position: relative; display: flex; align-items: flex-end; height: 150px; gap: .55rem; }
  .bar-col { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; height: 100%; gap: .5rem; }
  .bar-fill { width: 100%; max-width: 38px; border-radius: .55rem .55rem .2rem .2rem; background: linear-gradient(180deg, #f1cf95, #b9853f); transition: height .7s cubic-bezier(.2,.8,.2,1); min-height: 4px; position: relative; }
  .bar-fill:hover { filter: brightness(1.12); }
  .bar-tip { position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); background: #241710; border: 1px solid rgba(232,180,90,.35); color: #f6ecdd; font-size: .68rem; padding: .18rem .45rem; border-radius: .4rem; opacity: 0; pointer-events: none; transition: opacity .15s ease; white-space: nowrap; z-index: 2; }
  .bar-fill:hover .bar-tip { opacity: 1; }

  input[type='date']::-webkit-calendar-picker-indicator { filter: invert(.85) sepia(.4) saturate(2); cursor: pointer; }
  input[type='number']::-webkit-outer-spin-button, input[type='number']::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  input[type='number'] { -moz-appearance: textfield; }

  .modal-backdrop { position: fixed; inset: 0; background: rgba(5,3,2,.72); backdrop-filter: blur(6px); z-index: 60; display: flex; align-items: center; justify-content: center; padding: 1rem; animation: fadeIn .2s ease; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  .modal-panel { animation: modalIn .28s cubic-bezier(.2,.9,.3,1.15); }
  @keyframes modalIn { from { opacity: 0; transform: translateY(14px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }

  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .scroll-shadow { mask-image: linear-gradient(to left, transparent, #000 12px, #000 calc(100% - 12px), transparent); }
`;

/* ==========================================================================
 *  اسکریپت هسته‌ی کلاینت (در همه صفحات بارگذاری می‌شود)
 * ========================================================================== */

export const CORE_JS = `
(function () {
  'use strict';

  var FA_DIGITS = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];

  window.$ = function (sel, root) { return (root || document).querySelector(sel); };
  window.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  window.fa = function (value) {
    return String(value === undefined || value === null ? '' : value).replace(/[0-9]/g, function (d) {
      return FA_DIGITS[Number(d)];
    });
  };

  window.money = function (value) {
    var n = Math.round(Number(value) || 0);
    return String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  };

  window.moneyFa = function (value) { return fa(money(value)); };

  window.escapeHtml = function (value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  window.toast = function (message, type) {
    var host = document.getElementById('toast-host');
    if (!host) return;
    var tone = type === 'error' ? 'toast-error' : type === 'success' ? 'toast-success' : 'toast-info';
    var mark = type === 'error' ? '!' : type === 'success' ? '✓' : 'i';
    var el = document.createElement('div');
    el.className = 'toast ' + tone;
    el.innerHTML = '<span class="shrink-0 w-5 h-5 rounded-full border border-current opacity-70 flex items-center justify-center text-[11px] font-bold mt-0.5">' + mark + '</span><span class="flex-1">' + escapeHtml(message) + '</span>';
    host.appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 240);
    }, type === 'error' ? 5200 : 3800);
  };

  window.api = async function (path, options) {
    var opts = options || {};
    var init = {
      method: opts.method || 'GET',
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin'
    };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    var response;
    try {
      response = await fetch(path, init);
    } catch (error) {
      throw new Error('ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.');
    }
    var payload = null;
    try { payload = await response.json(); } catch (error) { payload = null; }
    if (response.status === 401) {
      toast('نشست شما منقضی شده است. در حال انتقال به صفحه ورود…', 'error');
      setTimeout(function () {
        window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname + window.location.search);
      }, 900);
      throw new Error('UNAUTHORIZED');
    }
    if (!response.ok || !payload || payload.ok === false) {
      var message = payload && payload.error ? payload.error : 'خطای غیرمنتظره (کد ' + response.status + ')';
      throw new Error(message);
    }
    return payload.data;
  };

  window.setLoading = function (button, loading, label) {
    if (!button) return;
    if (loading) {
      button.dataset.original = button.innerHTML;
      button.disabled = true;
      button.innerHTML = '<span class="inline-block w-4 h-4 rounded-full border-2 border-current border-t-transparent spin"></span>' + (label ? '<span>' + escapeHtml(label) + '</span>' : '');
    } else {
      button.disabled = false;
      if (button.dataset.original) button.innerHTML = button.dataset.original;
    }
  };

  window.debounce = function (fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  };

  window.copyText = async function (text, message) {
    try {
      await navigator.clipboard.writeText(text);
      toast(message || 'کپی شد.', 'success');
    } catch (error) {
      var area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      toast(message || 'کپی شد.', 'success');
    }
  };

  window.confirmAction = function (options) {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML =
        '<div class="modal-panel glass-strong rounded-2xl p-6 w-full max-w-sm">' +
          '<h3 class="text-lg font-bold mb-2">' + escapeHtml(options.title || 'تأیید عملیات') + '</h3>' +
          '<p class="text-sm text-cream/70 leading-7 mb-5">' + escapeHtml(options.message || 'آیا مطمئن هستید؟') + '</p>' +
          '<div class="flex gap-2 justify-end">' +
            '<button type="button" data-act="cancel" class="btn btn-ghost btn-sm">انصراف</button>' +
            '<button type="button" data-act="ok" class="btn ' + (options.danger ? 'btn-danger' : 'btn-primary') + ' btn-sm">' + escapeHtml(options.confirmText || 'تأیید') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(wrap);
      function close(result) { wrap.remove(); resolve(result); }
      wrap.addEventListener('click', function (event) {
        if (event.target === wrap) close(false);
        var act = event.target.closest('[data-act]');
        if (!act) return;
        close(act.dataset.act === 'ok');
      });
    });
  };

  window.gregorianToJalali = function (iso) {
    if (!iso) return null;
    var parts = String(iso).slice(0, 10).split('-');
    if (parts.length !== 3) return null;
    var gy = Number(parts[0]), gm = Number(parts[1]), gd = Number(parts[2]);
    if (!gy || !gm || !gd) return null;
    var g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    var jy = (gy <= 1600) ? 0 : 979;
    gy -= (gy <= 1600) ? 621 : 1600;
    var gy2 = (gm > 2) ? (gy + 1) : gy;
    var days = (365 * gy) + parseInt((gy2 + 3) / 4, 10) - parseInt((gy2 + 99) / 100, 10) + parseInt((gy2 + 399) / 400, 10) - 80 + gd + g_d_m[gm - 1];
    jy += 33 * parseInt(days / 12053, 10);
    days %= 12053;
    jy += 4 * parseInt(days / 1461, 10);
    days %= 1461;
    if (days > 365) {
      jy += parseInt((days - 1) / 365, 10);
      days = (days - 1) % 365;
    }
    var jm = (days < 186) ? 1 + parseInt(days / 31, 10) : 7 + parseInt((days - 186) / 30, 10);
    var jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
    return { jy: jy, jm: jm, jd: jd };
  };

  window.formatJalaliClient = function (iso, withYear) {
    var p = window.gregorianToJalali(iso);
    if (!p) return '—';
    var months = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
    var out = fa(p.jd) + ' ' + months[p.jm - 1];
    if (withYear !== false) out += ' ' + fa(p.jy);
    return out;
  };

  // تبدیل تاریخ شمسی (انتخاب کاربر) به میلادی — برای تاریخ تولد
  window.jalaliToGregorian = function (jy, jm, jd) {
    function div(a, b) { return Math.trunc ? Math.trunc(a / b) : (a / b) | 0; }
    function mod(a, b) { return a - (Math.trunc ? Math.trunc(a / b) : (a / b) | 0) * b; }
    var breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
    var bl = breaks.length;
    var jp = breaks[0];
    var jump = 0;
    var leapJ = -14;
    var jy2 = jy + 621;
    var n = 0;
    var i = 0;
    var leapG = 0;
    var march = 0;
    if (jy < jp || jy >= breaks[bl - 1]) return null;
    for (i = 1; i < bl; i += 1) {
      var jmNext = breaks[i];
      jump = jmNext - jp;
      if (jy < jmNext) break;
      leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
      jp = jmNext;
    }
    n = jy - jp;
    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    leapG = div(jy2, 4) - div((div(jy2, 100) + 1) * 3, 4) - 150;
    march = 20 + leapJ - leapG;
    function g2d(a, b, c) {
      var d = div((a + div(b - 8, 6) + 100100) * 1461, 4) + div(153 * mod(b + 9, 12) + 2, 5) + c - 34840408;
      d = d - div(div(a + 100100 + div(b - 8, 6), 100) * 3, 4) + 752;
      return d;
    }
    function d2g(jdn) {
      var jj = 4 * jdn + 139361631;
      jj = jj + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
      var ii = div(mod(jj, 1461), 4) * 5 + 308;
      var dd = div(mod(ii, 153), 5) + 1;
      var mm = mod(div(ii, 153), 12) + 1;
      var yy = div(jj, 1461) - 100100 + div(8 - mm, 6);
      return { gy: yy, gm: mm, gd: dd };
    }
    var jdn = g2d(jy2, 3, march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
    return d2g(jdn);
  };

  // ساخت سلکت‌های روز/ماه/سال شمسی
  window.initJalaliPickers = function (daySel, monSel, yearSel, initialISO, minAge) {
    var today = new Date().toISOString().slice(0, 10);
    var current = window.gregorianToJalali(today);
    var currentYear = current ? current.jy : 1405;

    function monthLength(jy, jm) {
      var start = window.jalaliToGregorian(jy, jm, 1);
      var ny = jm === 12 ? jy + 1 : jy;
      var nm = jm === 12 ? 1 : jm + 1;
      var end = window.jalaliToGregorian(ny, nm, 1);
      if (!start || !end) return 30;
      var a = Date.UTC(start.gy, start.gm - 1, start.gd);
      var b = Date.UTC(end.gy, end.gm - 1, end.gd);
      return Math.round((b - a) / 86400000);
    }

    function fillDays() {
      var jy = Number(yearSel.value);
      var jm = Number(monSel.value);
      var count = monthLength(jy, jm);
      var previous = Number(daySel.value) || 1;
      daySel.innerHTML = '';
      for (var d = 1; d <= count; d += 1) {
        var opt = document.createElement('option');
        opt.value = String(d);
        opt.textContent = fa(d);
        daySel.appendChild(opt);
      }
      daySel.value = String(Math.min(previous, count));
    }

    yearSel.innerHTML = '';
    for (var y = currentYear; y >= currentYear - (minAge || 90); y -= 1) {
      var yearOption = document.createElement('option');
      yearOption.value = String(y);
      yearOption.textContent = fa(y);
      yearSel.appendChild(yearOption);
    }

    var parsed = initialISO ? window.gregorianToJalali(initialISO) : null;
    yearSel.value = String(parsed ? parsed.jy : currentYear - 25);
    monSel.value = String(parsed ? parsed.jm : 1);
    fillDays();
    if (parsed) daySel.value = String(parsed.jd);

    if (monSel.dataset.jalaliBound !== '1') {
      monSel.addEventListener('change', fillDays);
      yearSel.addEventListener('change', fillDays);
      monSel.dataset.jalaliBound = '1';
      yearSel.dataset.jalaliBound = '1';
    }

    return { fillDays: fillDays, monthLength: monthLength };
  };

  // خواندن تاریخ شمسی انتخاب‌شده و تبدیل به YYYY-MM-DD میلادی
  window.readJalaliPickers = function (daySel, monSel, yearSel) {
    var g = window.jalaliToGregorian(Number(yearSel.value), Number(monSel.value), Number(daySel.value));
    if (!g) return null;
    return String(g.gy).padStart(4, '0') + '-' + String(g.gm).padStart(2, '0') + '-' + String(g.gd).padStart(2, '0');
  };
})();
`;

/* ==========================================================================
 *  پوسته‌ی صفحه
 * ========================================================================== */

const NAV_ITEMS = {
  admin: [
    { href: '/admin', label: 'داشبورد', icon: 'home', key: 'dashboard' },
    { href: '/admin/customers', label: 'مشتریان', icon: 'users', key: 'customers' },
    { href: '/admin/invoices', label: 'فاکتورها', icon: 'receipt', key: 'invoices' },
    { href: '/admin/settings', label: 'تنظیمات', icon: 'settings', key: 'settings' },
    { href: '/admin/staff', label: 'کارمندان', icon: 'shield', key: 'staff' },
    { href: '/admin/coupons', label: 'کدهای تخفیف', icon: 'gift', key: 'coupons' },
    { href: '/admin/sms', label: 'پیامک‌ها', icon: 'chat', key: 'sms' },
  ],
  staff: [
    { href: '/staff', label: 'ثبت فاکتور', icon: 'receipt', key: 'invoice' },
    { href: '/staff/history', label: 'فاکتورهای من', icon: 'clock', key: 'history' },
  ],
  customer: [],
} as const;

export type ShellOptions = {
  title: string;
  role: Role;
  userName: string;
  active: string;
  body: string;
  scripts?: string;
  cafeName: string;
  showNav?: boolean;
};

/** پوسته‌ی اصلی اپلیکیشن (داشبورد کارمند/ادمین) */
export function appShell(options: ShellOptions): string {
  const { title, role, userName, active, body, scripts = '', cafeName, showNav = true } = options;
  const items = NAV_ITEMS[role] ?? [];

  const desktopNav = items
    .map(
      (item) => `
        <a href="${item.href}" class="nav-item ${active === item.key ? 'active' : ''}">
          ${icon(item.icon, 'w-[18px] h-[18px]')}
          <span>${item.label}</span>
          ${active === item.key ? '<span class="me-auto w-1.5 h-1.5 rounded-full bg-gold"></span>' : ''}
        </a>`
    )
    .join('');

  const mobileNav = items
    .slice(0, 5)
    .map(
      (item) => `
        <a href="${item.href}" class="flex flex-col items-center justify-center gap-1 py-2 flex-1 rounded-xl ${active === item.key ? 'text-gold bg-gold/10' : 'text-cream/55'}">
          ${icon(item.icon, 'w-[19px] h-[19px]')}
          <span class="text-[10px] font-medium">${item.label}</span>
        </a>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  ${head(title, cafeName)}
</head>
<body class="min-h-screen antialiased">
  <div id="toast-host" class="fixed z-[80] top-4 left-1/2 -translate-x-1/2 md:left-6 md:translate-x-0 md:top-auto md:bottom-6 flex flex-col gap-2 items-center md:items-start pointer-events-none"></div>

  <div class="flex min-h-screen">
    ${
      showNav
        ? `<aside class="hidden lg:flex w-[260px] shrink-0 flex-col border-e border-white/10 bg-black/25 backdrop-blur-xl sticky top-0 h-screen">
            <div class="p-5 border-b border-white/10">
              <a href="/" class="flex items-center gap-3 group">
                <div class="w-11 h-11 rounded-2xl gold-bg text-coffee-950 flex items-center justify-center shadow-lg shadow-gold/20 group-hover:scale-105 transition">
                  ${icon('coffee', 'w-6 h-6')}
                </div>
                <div class="leading-tight">
                  <div class="font-extrabold text-[15px] gold-text">${escapeHtml(cafeName)}</div>
                  <div class="text-[11px] text-cream/45">باشگاه مشتریان</div>
                </div>
              </a>
            </div>

            <nav class="flex-1 p-3 space-y-1 overflow-y-auto no-scrollbar">
              <div class="px-3 pt-2 pb-1 text-[10px] tracking-wider text-cream/35 font-semibold">
                ${role === 'admin' ? 'پنل مدیریت' : 'پنل کارمند'}
              </div>
              ${desktopNav}
            </nav>

            <div class="p-3 border-t border-white/10 space-y-2">
              <div class="flex items-center gap-2.5 px-3 py-2">
                <div class="w-9 h-9 rounded-full bg-gradient-to-br from-amber-300 to-amber-700 text-coffee-950 flex items-center justify-center font-bold text-sm">
                  ${escapeHtml(userName.slice(0, 1) || '؟')}
                </div>
                <div class="min-w-0">
                  <div class="text-[13px] font-semibold truncate">${escapeHtml(userName)}</div>
                  <div class="text-[10px] text-cream/45">${role === 'admin' ? 'مدیر اصلی' : 'کارمند'}</div>
                </div>
              </div>
              <button type="button" onclick="logout()" class="nav-item w-full text-rose-300/80 hover:text-rose-200 hover:bg-rose-500/10">
                ${icon('logout', 'w-[18px] h-[18px]')}
                <span>خروج از حساب</span>
              </button>
            </div>
          </aside>`
        : ''
    }

    <div class="flex-1 min-w-0 flex flex-col">
      <header class="lg:hidden sticky top-0 z-40 glass-strong border-b border-white/10">
        <div class="flex items-center justify-between px-4 py-3">
          <a href="/" class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-xl gold-bg text-coffee-950 flex items-center justify-center">
              ${icon('coffee', 'w-5 h-5')}
            </div>
            <div class="leading-tight">
              <div class="font-bold text-[13px] gold-text">${escapeHtml(cafeName)}</div>
              <div class="text-[10px] text-cream/45">${role === 'admin' ? 'پنل مدیریت' : 'پنل کارمند'}</div>
            </div>
          </a>
          <button type="button" onclick="logout()" class="btn btn-ghost btn-sm text-rose-300/80">
            ${icon('logout', 'w-4 h-4')}
            <span>خروج</span>
          </button>
        </div>
      </header>

      <main class="flex-1 pb-24 lg:pb-8">
        ${body}
      </main>

      ${
        showNav
          ? `<nav class="lg:hidden fixed bottom-0 inset-x-0 z-40 glass-strong border-t border-white/10 pb-[env(safe-area-inset-bottom)]">
              <div class="flex items-stretch px-2">${mobileNav}</div>
            </nav>`
          : ''
      }
    </div>
  </div>

  <script>${CORE_JS}</script>
  <script>
    async function logout() {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch (error) {}
      window.location.href = '/login';
    }
  </script>
  ${scripts ? `<script>${scripts}</script>` : ''}
</body>
</html>`;
}

/** پوسته‌ی صفحات عمومی (فرود، ثبت‌نام، ورود) */
export function publicShell(options: {
  title: string;
  body: string;
  scripts?: string;
  cafeName: string;
}): string {
  const { title, body, scripts = '', cafeName } = options;
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  ${head(title, cafeName)}
</head>
<body class="min-h-screen antialiased flex flex-col">
  <div id="toast-host" class="fixed z-[80] top-4 left-1/2 -translate-x-1/2 md:left-6 md:translate-x-0 md:top-auto md:bottom-6 flex flex-col gap-2 items-center md:items-start pointer-events-none"></div>

  <header class="sticky top-0 z-40">
    <div class="glass-strong border-b border-white/10">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <a href="/" class="flex items-center gap-3 group">
          <div class="w-10 h-10 rounded-2xl gold-bg text-coffee-950 flex items-center justify-center shadow-lg shadow-gold/20 group-hover:rotate-6 transition">
            ${icon('coffee', 'w-5 h-5')}
          </div>
          <div class="leading-tight">
            <div class="font-extrabold text-sm gold-text">${escapeHtml(cafeName)}</div>
            <div class="text-[10px] text-cream/45">باشگاه مشتریان</div>
          </div>
        </a>
        <nav class="flex items-center gap-2">
          <a href="/register" class="btn btn-ghost btn-sm">عضویت</a>
          <a href="/login" class="btn btn-primary btn-sm">
            ${icon('shield', 'w-4 h-4')}
            <span class="hidden sm:inline">ورود کارمندان</span>
            <span class="sm:hidden">ورود</span>
          </a>
        </nav>
      </div>
    </div>
  </header>

  <main class="flex-1">${body}</main>

  <footer class="border-t border-white/10 mt-16">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-cream/40">
      <div class="flex items-center gap-2">
        ${icon('coffee', 'w-4 h-4')}
        <span>${escapeHtml(cafeName)} — باشگاه مشتریان</span>
      </div>
      <div class="flex items-center gap-4">
        <a href="/register" class="hover:text-gold transition">عضویت</a>
        <a href="/login" class="hover:text-gold transition">ورود کارمندان</a>
      </div>
    </div>
  </footer>

  <script>${CORE_JS}</script>
  ${scripts ? `<script>${scripts}</script>` : ''}
</body>
</html>`;
}

/** تگ‌های head مشترک */
function head(title: string, cafeName: string): string {
  return `<meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#0b0705" />
  <meta name="description" content="باشگاه مشتریان ${escapeHtml(cafeName)} — امتیاز، تخفیف و هدیه" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${escapeHtml(title)} | ${escapeHtml(cafeName)}</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>☕</text></svg>" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700;800;900&display=swap" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            coffee: { 50: '#faf6f1', 100: '#f0e6d8', 200: '#e0cdb4', 300: '#c9a97f', 400: '#b8885a', 500: '#a06f42', 600: '#855736', 700: '#6a442c', 800: '#4a2f20', 900: '#2b1a12', 950: '#160d08' },
            cream: '#f6ecdd',
            gold: '#e8b45a'
          },
          fontFamily: { sans: ['Vazirmatn', 'Tahoma', 'system-ui', 'sans-serif'] },
          opacity: (function () { var scale = {}; for (var i = 0; i <= 100; i++) { scale[i] = String(i / 100); } return scale; })(),
          boxShadow: { glow: '0 0 45px -12px rgba(232,180,90,.45)' }
        }
      }
    };
  </script>
  <style>${BASE_STYLES}</style>
  <script>
    // اگر CDN تیلویند در دسترس نبود، حداقل‌های لازم اعمال شود (بدون شکستن صفحه)
    window.addEventListener('error', function (event) {
      if (event.target && event.target.tagName === 'SCRIPT') {
        document.documentElement.classList.add('cdn-error');
      }
    }, true);
  </script>`;
}

/* ==========================================================================
 *  اجزای کوچک قابل استفاده در صفحات
 * ========================================================================== */

export function badge(text: string, tone: string): string {
  return `<span class="badge tone-${tone}">${escapeHtml(text)}</span>`;
}

export function pageHeader(options: {
  title: string;
  subtitle?: string;
  actions?: string;
  iconName?: string;
}): string {
  const { title, subtitle = '', actions = '', iconName = 'sparkles' } = options;
  return `<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
    <div class="flex items-start gap-3">
      <div class="w-11 h-11 rounded-2xl bg-gold/12 border border-gold/25 text-gold flex items-center justify-center shrink-0">
        ${icon(iconName, 'w-5 h-5')}
      </div>
      <div>
        <h1 class="text-xl sm:text-2xl font-extrabold tracking-tight">${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="text-[13px] text-cream/50 mt-1">${escapeHtml(subtitle)}</p>` : ''}
      </div>
    </div>
    ${actions ? `<div class="flex items-center gap-2 flex-wrap">${actions}</div>` : ''}
  </div>`;
}

export function emptyState(options: { title: string; message: string; iconName?: string; action?: string }): string {
  return `<div class="text-center py-14 px-6">
    <div class="w-16 h-16 mx-auto rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-cream/30 mb-4">
      ${icon(options.iconName ?? 'sparkles', 'w-7 h-7')}
    </div>
    <h3 class="font-bold text-sm mb-1.5">${escapeHtml(options.title)}</h3>
    <p class="text-xs text-cream/45 leading-6 max-w-sm mx-auto">${escapeHtml(options.message)}</p>
    ${options.action ? `<div class="mt-4">${options.action}</div>` : ''}
  </div>`;
}

/** JSON امن برای تزریق در اسکریپت */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** کارت خطا/۴۰۴ */
export function errorPage(status: number, message: string, cafeName: string): string {
  return publicShell({
    title: `خطای ${status}`,
    cafeName,
    body: `<div class="max-w-xl mx-auto px-4 py-24 text-center">
      <div class="text-7xl font-black gold-text mb-4">${status}</div>
      <h1 class="text-xl font-bold mb-2">صفحه‌ای که دنبالش بودید پیدا نشد</h1>
      <p class="text-sm text-cream/50 leading-7 mb-8">${escapeHtml(message)}</p>
      <div class="flex items-center justify-center gap-3">
        <a href="/" class="btn btn-primary">${icon('home', 'w-4 h-4')} بازگشت به خانه</a>
        <a href="/login" class="btn btn-ghost">ورود کارمندان</a>
      </div>
    </div>`,
  });
}
