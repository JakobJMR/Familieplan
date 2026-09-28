// Gemini (Google AI) – gratisnivået. Kalles rett fra appen med familiens nøkkel,
// som ligger i databasen (bare innloggede familiemedlemmer kan lese den).
// Nøkkelen lages i Google AI Studio i et prosjekt UTEN betalingskort → kan aldri koste penger.

import { state } from './store.js';
import { today, fmtLong, addDays, weekday } from './util.js';

export const DEFAULT_MODEL = 'gemini-3.8-flash';
const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite'];
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export const hasAI = () => !!state.secrets?.geminiKey;

export class AIError extends Error {}

async function call(model, body, key) {
  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

/**
 * Sender en forespørsel til Gemini. parts: [{text}] eller [{inline_data:{mime_type,data}}].
 * Returnerer tekst, eller parset JSON når json=true.
 */
export async function gemini({ parts, system, json = false, temperature = 0.3, tools = null, maxTokens = null }) {
  const key = state.secrets?.geminiKey;
  if (!key) throw new AIError('AI er ikke satt opp. Legg inn Gemini-nøkkelen under Mer → Innstillinger → AI.');
  const body = {
    contents: [{ role: 'user', parts }],
    // JSON-modus kan ikke kombineres med verktøy (f.eks. lese lenker) – da parses svaret manuelt
    generationConfig: { temperature, ...(json && !tools ? { responseMimeType: 'application/json' } : {}), ...(maxTokens ? { maxOutputTokens: maxTokens } : {}) },
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    ...(tools ? { tools } : {}),
  };
  const models = [state.secrets?.geminiModel || DEFAULT_MODEL, ...FALLBACK_MODELS.filter((m) => m !== state.secrets?.geminiModel)];
  let last;
  for (const model of models) {
    let r;
    try {
      r = await call(model, body, key);
    } catch {
      throw new AIError('Fikk ikke kontakt med Gemini. Er du på nett?');
    }
    const { res, json: out } = r;
    if (res.ok) {
      const text = (out.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
      if (!text) throw new AIError('Gemini ga et tomt svar. Prøv å formulere deg litt annerledes.');
      if (!json) return text;
      return parseJSON(text);
    }
    last = { status: res.status, msg: out.error?.message || '' };
    // Modellen finnes ikke / er ikke tilgjengelig gratis → prøv neste. Kvote brukt opp → prøv lettere modell.
    if (res.status === 404 || res.status === 429 || (res.status === 400 && /model/i.test(last.msg))) continue;
    break;
  }
  if (last?.status === 429) throw new AIError('Gratiskvoten til Gemini er brukt opp for nå. Prøv igjen om litt (kvoten fylles på daglig).');
  if (last?.status === 400 && /api key/i.test(last.msg)) throw new AIError('Gemini-nøkkelen er ugyldig. Sjekk den under Innstillinger → AI.');
  if (last?.status === 403) throw new AIError('Gemini-nøkkelen har ikke tilgang. Sjekk at den er laget i Google AI Studio.');
  throw new AIError(`Gemini svarte med feil (${last?.status || '?'}). ${last?.msg || ''}`.trim());
}

function parseJSON(text) {
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    const m = clean.match(/[{[][\s\S]*[}\]]/);
    if (m) return JSON.parse(m[0]);
    throw new AIError('Forsto ikke svaret fra Gemini. Prøv igjen.');
  }
}

export async function testKey(key, model) {
  const { res, json } = await call(model || DEFAULT_MODEL, { contents: [{ role: 'user', parts: [{ text: 'Svar bare med ordet OK.' }] }] }, key).catch(() => ({ res: { ok: false, status: 0 }, json: {} }));
  if (res.ok) return { ok: true };
  return { ok: false, status: res.status, message: json.error?.message || 'Ingen kontakt' };
}

// ───────────────────────── Forsikring ─────────────────────────

const INSURANCE_SCHEMA = `{
  "type": "bil|hus|innbo|reise|liv|ulykke|uføre|helse|barn|dyr|båt|annet",
  "name": "kort navn, f.eks. 'Bilforsikring Tesla' eller 'Innboforsikring'",
  "company": "forsikringsselskap",
  "policyNumber": "polisenummer eller null",
  "insured": "hvem/hva som er forsikret (person, bil m/reg.nr, adresse) – kort",
  "pricePerYear": tall i kroner eller null,
  "pricePerMonth": tall i kroner eller null,
  "renewalDate": "YYYY-MM-DD (hovedforfall/fornyelse) eller null",
  "deductible": "egenandel(er), kort tekst eller null",
  "annualKm": tall (årlig kjørelengde for bil) eller null,
  "summary": "2–3 setninger på enkelt norsk om hva forsikringen er",
  "covers": ["viktigste ting som ER dekket – korte punkter, maks 10"],
  "notCovered": ["viktige unntak/begrensninger – korte punkter, maks 8"],
  "keyTerms": ["andre nyttige detaljer: forsikringssummer, vilkår, karenstid, dekningsområde osv. – maks 15"]
}`;

export async function interpretInsurance(b64, mimeType) {
  return gemini({
    json: true,
    system:
      'Du er en hjelpsom norsk forsikringsrådgiver. Les forsikringsdokumentet og hent ut fakta. Skriv enkelt og kort på norsk bokmål. Ikke gjett – bruk null når noe ikke står i dokumentet.',
    parts: [
      { inline_data: { mime_type: mimeType || 'application/pdf', data: b64 } },
      { text: `Svar KUN med JSON på dette formatet:\n${INSURANCE_SCHEMA}` },
    ],
  });
}

export async function askInsurance(question, policies, docs = []) {
  const ctx = policies
    .map(
      (p) => `### ${p.name} (${p.company || 'ukjent selskap'})
Type: ${p.type}. Forsikret: ${p.insured || '-'}. Pris: ${p.pricePerYear ? p.pricePerYear + ' kr/år' : '-'}. Fornyes: ${p.renewalDate || '-'}. Egenandel: ${p.deductible || '-'}
Sammendrag: ${p.summary || '-'}
Dekker: ${(p.covers || []).join('; ') || '-'}
Dekker ikke: ${(p.notCovered || []).join('; ') || '-'}
Detaljer: ${(p.keyTerms || []).join('; ') || '-'}`,
    )
    .join('\n\n');
  return gemini({
    system:
      'Du svarer på spørsmål om familiens forsikringer på enkelt norsk. Svar kort og konkret (maks ca. 120 ord), si hvilken forsikring svaret gjelder, og vær ærlig når informasjonen ikke finnes – da anbefal å sjekke vilkårene eller spørre selskapet. Du er ikke juridisk rådgiver.',
    parts: [
      ...docs.map((d) => ({ inline_data: { mime_type: d.type, data: d.b64 } })),
      { text: `Familiens forsikringer:\n\n${ctx || '(ingen registrert)'}\n\nSpørsmål: ${question}` },
    ],
  });
}

// ───────────────────────── Assistent (tekst/stemme) ─────────────────────────

function contextText() {
  const t = today();
  const members = (state.household?.members || []).map((m) => `${m.name} (${m.role})`).join(', ') || 'ingen';
  const week = Array.from({ length: 14 }, (_, i) => addDays(t, i));
  const meals = week
    .map((d) => {
      const m = state.meals.find((x) => x.id === d);
      return m ? `${d}: ${m.dish}` : null;
    })
    .filter(Boolean)
    .join('; ');
  const fixed = Object.entries(state.household?.fixedMeals || {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${['', 'man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'][k]}: ${v}`)
    .join(', ');
  return `I dag er ${fmtLong(t)} (${t}, ukedag ${weekday(t)} der 1=mandag).
Familiemedlemmer: ${members}.
Middager planlagt: ${meals || 'ingen'}.
Faste middager: ${fixed || 'ingen'}.
Oppskrifter vi har: ${state.recipes.map((r) => r.name).join(', ') || 'ingen'}.
På handlelista nå: ${state.shopping.filter((s) => !s.done).map((s) => s.name).join(', ') || 'tom'}.`;
}

const ASSISTANT_FORMAT = `Svar KUN med JSON:
{
  "reply": "kort, vennlig svar på norsk (1–2 setninger)",
  "actions": [
    {"type":"event","title":"...","emoji":"🎂","date":"YYYY-MM-DD","start":"HH:MM eller null","end":"HH:MM eller null","members":["navn"],"repeat":"none|weekly|yearly"},
    {"type":"task","title":"...","emoji":"✅","due":"YYYY-MM-DD eller null","members":["navn"]},
    {"type":"shopping","list":"navn på handleliste eller null (= standardlista)","items":[{"name":"Melk","emoji":"🥛"}]},
    {"type":"thing","room":"romnavn fra inventaret","name":"f.eks. Boks med vinterklær","emoji":"📦","place":"hylle/plass eller tom","contents":["innhold, hvis det er en boks"]},
    {"type":"meal","date":"YYYY-MM-DD","dish":"...","emoji":"🍝","ingredients":["400 g kjøttdeig","..."]}
  ]
}
Regler: Bruk bare handlingene som trengs (actions kan være tom). Regn ut riktige datoer ut fra dagens dato ("torsdag" = førstkommende torsdag, i dag inkludert).
Bursdager/merkedager: repeat "yearly". members er navn fra familielista (tom liste = hele familien).
Når noen mangler middag eller ber om forslag: foreslå EN konkret, familievennlig middag (gjerne fra oppskriftene våre), med ingredienser for hele familien.
Handleliste-varer: korte navn med stor forbokstav og passende emoji. Ikke legg til ting som allerede står på lista.
Spørsmål om HVOR noe er («hvor er klær str. 86?»): svar i "reply" ut fra inventarlista (rom, boks, plass), og la actions være tom.`;

export async function runAssistant(text, extraContext = '') {
  return gemini({
    json: true,
    temperature: 0.4,
    system: `Du er familiens hjelpsomme assistent i en norsk familie-app. Du gjør om det brukeren sier til handlinger i appen, eller svarer på spørsmål om familiens ting.\n\n${contextText()}\n${extraContext}`,
    parts: [{ text: `${ASSISTANT_FORMAT}\n\nBrukeren sier: «${text}»` }],
  });
}

export async function structureRecipe(text) {
  return gemini({
    json: true,
    system: 'Du gjør om oppskrifter til strukturert form på norsk bokmål.',
    parts: [
      {
        text: `Gjør om denne oppskriften (eller beskrivelsen) til JSON: {"name":"...","emoji":"🍲","servings":tall eller null,"ingredients":["mengde + ingrediens", "..."],"steps":"fremgangsmåte, nummererte steg adskilt med linjeskift"}\n\n${text}`,
      },
    ],
  });
}
