// Første oppsett: spør om familien, ukeplaner, søppel, sted og ferie.
// Ingenting gjettes – alt fylles inn av brukeren. Lagres etter hvert steg.

import { esc, toast } from '../util.js';
import { state, saveHousehold, saveSecrets } from '../store.js';
import { setPin } from '../pin.js';
import { isDemo } from '../backend.js';
import {
  emptyHousehold, membersEditor, schedulesEditor, garbageEditor, holidaysEditor, placeEditor, bindEditors, validateDraft,
} from './editors.js';

const STEPS = [
  {
    key: 'welcome',
    emoji: '🏡',
    title: 'Velkommen!',
    intro: 'Vi setter opp dashbordet sammen. Det tar et par minutter, og alt kan endres senere under Innstillinger.',
    render: (d) => `<label class="field"><span>Hva vil dere kalle husstanden?</span>
      <input placeholder="F.eks. Familien Hansen" value="${esc(d.name)}" data-path="name" maxlength="80"></label>`,
  },
  {
    key: 'members',
    emoji: '👪',
    title: 'Hvem bor her?',
    intro: 'Legg til alle i familien. Trykk på ikonet for å velge et annet. Ikonene brukes til å filtrere visningen per person.',
    render: membersEditor,
  },
  {
    key: 'schedules',
    emoji: '🗓️',
    title: 'Faste ukeplaner',
    intro: 'Hva skjer fast hver uke? Jobb, skole, barnehage, trening … Dette vises automatisk på dashbordet hver dag. Hopp over om du vil fylle ut senere.',
    render: schedulesEditor,
  },
  {
    key: 'garbage',
    emoji: '🗑️',
    title: 'Søppeltømming',
    intro: 'Legg inn avfallstypene som hentes, hvor ofte, og én dato de blir tømt. Så får dere påminnelse dagen før.',
    render: garbageEditor,
  },
  {
    key: 'place',
    emoji: '🌤️',
    title: 'Vær og strøm',
    intro: 'Hvor bor dere? Brukes til værmelding fra Yr og dagens strømpris. Begge deler kan hoppes over.',
    render: placeEditor,
  },
  {
    key: 'holidays',
    emoji: '🏖️',
    title: 'Ferier',
    intro: 'Kjenner dere allerede til noen ferier? Da viser dashbordet «alle har fri» de dagene. Kan legges til senere.',
    render: holidaysEditor,
  },
  {
    key: 'extras',
    emoji: '🔒',
    title: 'Kode og AI',
    intro: 'Begge deler er valgfritt og kan settes senere under Innstillinger.',
    render: () => `
      <label class="field"><span>🔒 Familiekode (4–8 siffer) – spørres når appen åpnes</span>
        <input id="ob-pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" placeholder="La stå tom for ingen kode"></label>
      <label class="field"><span>✨ Gemini API-nøkkel (gratis)</span>
        <input id="ob-key" type="password" autocomplete="off" placeholder="Lim inn nøkkelen fra aistudio.google.com/apikey"></label>
      <p class="hint">Med nøkkel kan appen lese forsikringsdokumenter, foreslå middag og forstå «legg inn bursdag til Nils 12. oktober». Lag den i et Google-prosjekt uten betalingskort, så kan den aldri koste penger.${isDemo ? ' (I demo-modus lagres alt bare på denne enheten.)' : ''}</p>`,
  },
];

export function renderOnboarding(app, onDone) {
  const d = Object.assign(emptyHousehold(), structuredClone(state.household || {}));
  let step = 0;
  if (d.name) step = 1;
  if (d.members?.length) step = 2;

  const draw = () => {
    const s = STEPS[step];
    app.innerHTML = `<main class="onboarding">
      <div class="ob-progress" aria-label="Steg ${step + 1} av ${STEPS.length}">
        ${STEPS.map((_, i) => `<span class="${i <= step ? 'on' : ''}"></span>`).join('')}
      </div>
      <header class="ob-head">
        <div class="ob-emoji">${s.emoji}</div>
        <h1>${s.title}</h1>
        <p class="muted">${s.intro}</p>
      </header>
      <section class="ob-body card" id="ob-body">${s.render(d)}</section>
      <footer class="ob-foot">
        ${step > 0 ? '<button class="btn ghost" id="back">← Tilbake</button>' : '<span></span>'}
        <button class="btn primary" id="next">${step === STEPS.length - 1 ? 'Ferdig 🎉' : 'Neste →'}</button>
      </footer>
    </main>`;
    const body = app.querySelector('#ob-body');
    bindEditors(body, d, () => (body.innerHTML = s.render(d)));
    app.querySelector('#back')?.addEventListener('click', () => {
      step--;
      draw();
      scrollTo(0, 0);
    });
    app.querySelector('#next').onclick = next;
  };

  const next = async () => {
    const s = STEPS[step];
    const err = s.key === 'extras' ? null : validateDraft(d, s.key);
    if (err) return toast(err, 'error');
    if (s.key === 'extras') {
      const pin = app.querySelector('#ob-pin').value.trim();
      const key = app.querySelector('#ob-key').value.trim();
      if (pin && !/^\d{4,8}$/.test(pin)) return toast('Koden må være 4–8 siffer.', 'error');
      if (pin) await setPin(pin);
      if (key) await saveSecrets({ geminiKey: key });
    }
    const last = step === STEPS.length - 1;
    const btn = app.querySelector('#next');
    btn.disabled = true;
    btn.textContent = 'Lagrer …';
    try {
      await saveHousehold({ ...d, onboarded: last });
      Object.assign(d, structuredClone(state.household));
      if (last) return onDone();
      step++;
      draw();
      scrollTo(0, 0);
    } catch (e) {
      toast(e.message || 'Kunne ikke lagre.', 'error');
      btn.disabled = false;
      btn.textContent = last ? 'Ferdig 🎉' : 'Neste →';
    }
  };

  draw();
}
