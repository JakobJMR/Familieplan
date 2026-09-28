// Små hjelpefunksjoner: datoer, HTML-escaping, toast og modal.

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// ---------- Datoer (alltid lokal tid, format YYYY-MM-DD) ----------

export const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const today = () => iso(new Date());
export const addDays = (s, n) => {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
export const diffDays = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000); // b - a
/** Ukedag 1 = mandag … 7 = søndag */
export const weekday = (s) => ((parseISO(s).getDay() + 6) % 7) + 1;
export const startOfWeek = (s) => addDays(s, 1 - weekday(s));
export const nowHM = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fmt = (opts) => new Intl.DateTimeFormat('nb-NO', opts);
export const fmtLong = (s) => cap(fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(parseISO(s)));
export const fmtShort = (s) => fmt({ day: 'numeric', month: 'short' }).format(parseISO(s)).replace('.', '');
export const fmtWeekday = (s) => cap(fmt({ weekday: 'long' }).format(parseISO(s)));
export const fmtWeekdayShort = (s) => cap(fmt({ weekday: 'short' }).format(parseISO(s)).replace('.', ''));
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const DAY_NAMES = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];

export function relDay(s) {
  const d = diffDays(today(), s);
  if (d === 0) return 'i dag';
  if (d === 1) return 'i morgen';
  if (d === -1) return 'i går';
  if (d > 1 && d < 7) return fmtWeekday(s).toLowerCase();
  if (d < 0) return `${-d} dager siden`;
  return fmtShort(s);
}

/** ISO-ukenummer */
export function weekNumber(s) {
  const d = parseISO(s);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}

// ---------- UI-hjelpere ----------

let toastTimer;
export function toast(msg, kind = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 3200);
}

/**
 * Åpner en modal. html er innholdet; onMount(root, close) kobler opp hendelser.
 */
export function openModal(html, onMount) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('modal-open');
  const close = () => {
    wrap.remove();
    if (!document.querySelector('.modal-wrap')) document.body.classList.remove('modal-open');
  };
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-close]')) close();
  });
  const first = wrap.querySelector('input:not([type=hidden]), select, textarea');
  if (first && matchMedia('(pointer: fine)').matches) setTimeout(() => first.focus(), 30);
  onMount?.(wrap.querySelector('.modal'), close);
  return close;
}

export function confirmDialog(text, okLabel = 'Slett') {
  return new Promise((resolve) => {
    openModal(
      `<p class="confirm-text">${esc(text)}</p>
       <div class="modal-actions">
         <button class="btn ghost" data-close>Avbryt</button>
         <button class="btn danger" data-ok>${esc(okLabel)}</button>
       </div>`,
      (root, close) => {
        root.querySelector('[data-ok]').onclick = () => {
          close();
          resolve(true);
        };
        root.parentElement.addEventListener('click', (e) => {
          if (e.target === root.parentElement || e.target.closest('[data-close]')) resolve(false);
        });
      },
    );
  });
}
