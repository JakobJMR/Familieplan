// Oppstart og navigasjon.
// Flyt: Google-innlogging (én gang per enhet) → tilgangssjekk → familiekode (hvis satt)
//       → (første gang) oppsett → dashbord.

import { backend, isDemo } from './backend.js';
import { state, subscribe, startData, stopData } from './store.js';
import { toast } from './util.js';
import { isUnlocked, markUnlocked, lock, watchBackground, hasPin } from './pin.js';
import { renderPin, renderLogin, renderNoAccess, renderError, renderLoading } from './views/gate.js';
import { renderOnboarding } from './views/onboarding.js';
import { renderDashboard, bindDashboard } from './views/dashboard.js';
import { renderCalendar, bindCalendar } from './views/calendar.js';
import { renderTasks, bindTasks } from './views/tasks.js';
import { renderFood, bindFood } from './views/food.js';
import { renderMore } from './views/more.js';
import { renderEconomy, bindEconomy } from './views/economy.js';
import { renderInsurance, bindInsurance } from './views/insurance.js';
import { renderSettings, bindSettings, resetSettingsDraft, settingsDirty } from './views/settings.js';
import { openAssistant } from './views/assistant.js';
import { renderHouse, bindHouse } from './views/house.js';
import { renderWine, bindWine } from './views/wine.js';
import { renderProducts, bindProducts } from './views/products.js';
import { refreshWidgets } from './views/widgets.js';
import { bindMemberFilter } from './components.js';

const app = document.getElementById('app');
let mode = 'gate'; // 'gate' | 'onboarding' | 'main'

const VIEWS = {
  hjem: { icon: '🏠', label: 'Hjem', tab: true, render: renderDashboard, bind: (r) => bindDashboard(r, go) },
  kalender: { icon: '📅', label: 'Kalender', tab: true, render: renderCalendar, bind: (r) => bindCalendar(r, renderMain) },
  oppgaver: { icon: '✅', label: 'Gjøremål', tab: true, render: renderTasks, bind: (r) => bindTasks(r, renderMain) },
  mat: { icon: '🍽️', label: 'Mat', tab: true, render: renderFood, bind: (r) => bindFood(r, renderMain) },
  mer: { icon: '☰', label: 'Mer', tab: true, render: renderMore, bind: () => {} },
  okonomi: { parent: 'mer', render: renderEconomy, bind: (r) => bindEconomy(r) },
  forsikring: { parent: 'mer', render: renderInsurance, bind: (r, p) => bindInsurance(r, renderMain, p) },
  hus: { parent: 'mer', render: renderHouse, bind: (r, p) => bindHouse(r, renderMain, p) },
  vin: { parent: 'mer', render: renderWine, bind: (r) => bindWine(r, renderMain) },
  produkter: { parent: 'mer', render: renderProducts, bind: (r, p) => bindProducts(r, renderMain, p) },
  innstillinger: { parent: 'mer', render: renderSettings, bind: (r) => bindSettings(r, renderMain, signOut) },
};

function route() {
  const [v, param] = location.hash.replace(/^#\/?/, '').split('/');
  return VIEWS[v] ? { view: v, param: param || null } : { view: 'hjem', param: null };
}

function go(target) {
  const { view } = route();
  if (view === 'innstillinger' && !target.startsWith('innstillinger') && settingsDirty()) {
    if (!confirm('Du har endringer i innstillingene som ikke er lagret. Forkaste dem?')) return;
  }
  location.hash = `#/${target}`;
}

let lastView = null;
window.addEventListener('hashchange', () => {
  if (mode !== 'main') return;
  const { view } = route();
  if (lastView === 'innstillinger' && view !== 'innstillinger') resetSettingsDraft();
  renderMain();
  scrollTo(0, 0);
});

function renderMain() {
  mode = 'main';
  const { view, param } = route();
  lastView = view;
  const v = VIEWS[view];
  const activeTab = v.tab ? view : v.parent;

  const active = document.activeElement;
  const focusId = active?.id && app.contains(active) ? active.id : null;
  const sel = focusId && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  const scroll = window.scrollY;
  const openShop = state.shopping.filter((s) => !s.done).length;
  const overdue = overdueCount();

  app.innerHTML = `
    <div class="shell view-${view}">
      <nav class="tabbar" aria-label="Hovedmeny">
        <div class="brand" aria-hidden="true">🏡</div>
        ${Object.entries(VIEWS)
          .filter(([, x]) => x.tab)
          .map(([key, x]) => `<a href="#/${key}" class="tab ${key === activeTab ? 'on' : ''}" data-nav="${key}" ${key === activeTab ? 'aria-current="page"' : ''}>
            <span class="tab-icon">${x.icon}</span><span class="tab-label">${x.label}</span>
            ${key === 'mat' && openShop ? `<span class="badge">${openShop}</span>` : ''}
            ${key === 'oppgaver' && overdue ? `<span class="badge alert">${overdue}</span>` : ''}
          </a>`)
          .join('')}
      </nav>
      <main class="content" id="content">${v.render(param)}</main>
      ${v.tab && view !== 'mer' ? '<button class="fab" data-fab aria-label="Assistent – legg inn noe">✨</button>' : ''}
    </div>`;

  const content = app.querySelector('#content');
  v.bind(content, param);
  bindMemberFilter(content);
  app.querySelectorAll('[data-nav]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      go(a.dataset.nav);
    }),
  );
  app.querySelector('[data-fab]')?.addEventListener('click', () => openAssistant());

  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus();
      if (sel) try { el.setSelectionRange(...sel); } catch { /* ikke tekstfelt */ }
    }
  }
  if (scroll && lastRenderedView === view) window.scrollTo(0, scroll);
  lastRenderedView = view;
  if (view === 'hjem') refreshWidgets();
}
let lastRenderedView = null;

function overdueCount() {
  const t = new Date();
  const s = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  return state.tasks.filter((x) => !x.done && x.due && x.due < s).length;
}

// Tegn på nytt når data endres (fra denne eller andre enheter)
let pendingRender = false;
subscribe(() => {
  if (mode !== 'main') return;
  const { view } = route();
  if (view === 'innstillinger') return; // ikke forstyrr redigering
  const typing = document.activeElement?.matches?.('textarea, input:not([type=checkbox]):not([type=date])') && !document.activeElement.id;
  if (document.querySelector('.modal-wrap') || typing) {
    pendingRender = true;
    return;
  }
  renderMain();
});
new MutationObserver(() => {
  if (pendingRender && !document.querySelector('.modal-wrap') && mode === 'main') {
    pendingRender = false;
    renderMain();
  }
}).observe(document.body, { childList: true });
document.addEventListener('focusout', () => {
  setTimeout(() => {
    if (pendingRender && mode === 'main' && !document.querySelector('.modal-wrap')) {
      pendingRender = false;
      renderMain();
    }
  }, 50);
});

// ---------- Oppstart ----------

let dataStarted = false;
async function onSignedIn(user) {
  state.user = user;
  renderLoading(app);
  try {
    if (!(await backend.checkAccess())) return renderNoAccess(app, user.email, signOut);
    if (!dataStarted) {
      await startData();
      dataStarted = true;
    }
  } catch (e) {
    dataStarted = false;
    if (e?.code === 'permission-denied') return renderNoAccess(app, user.email, signOut);
    return renderError(app, 'Fikk ikke hentet familiens data. Sjekk nettforbindelsen.', () => onSignedIn(user));
  }
  afterData();
}

function afterData() {
  if (!isUnlocked()) {
    mode = 'gate';
    return renderPin(app, () => (markUnlocked(), afterData()), signOut);
  }
  if (!state.household?.onboarded) {
    mode = 'onboarding';
    return renderOnboarding(app, () => {
      markUnlocked();
      toast('Alt klart! Velkommen til dashbordet 🎉', 'ok');
      location.hash = '#/hjem';
      renderMain();
    });
  }
  renderMain();
}

async function signOut() {
  stopData();
  dataStarted = false;
  lock();
  await backend.signOut();
}

watchBackground(() => {
  if (mode === 'main' && hasPin()) {
    document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
    afterData();
  }
});

// Oppdater «nå»-markeringer og dato over midnatt
setInterval(() => {
  if (mode === 'main' && route().view === 'hjem' && !document.querySelector('.modal-wrap')) renderMain();
}, 5 * 60_000);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

(async () => {
  renderLoading(app, 'Starter …');
  try {
    await backend.init();
  } catch (e) {
    console.error(e);
    return renderError(app, 'Klarte ikke å starte. Sjekk at js/config.js er fylt ut riktig.', () => location.reload());
  }
  backend.onUser((user) => {
    if (user) onSignedIn(user);
    else {
      stopData();
      dataStarted = false;
      mode = 'gate';
      renderLogin(app);
    }
  });
})();

if (isDemo) console.info('Familiens dashbord kjører i DEMO-MODUS (js/config.js er tom).');
