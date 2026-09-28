// «Les én gang»: AI leser et dokument (PDF, bilde eller lenke) ÉN gang, og resultatet
// – både strukturerte fakta og en fyldig referansetekst – lagres i databasen.
// Senere spørsmål bruker den lagrede teksten, så originalen slipper å leses på nytt.

import { gemini, AIError } from './ai.js';
import { backend } from './backend.js';
import { blobToBase64 } from './media.js';

export const AI_MAX_MB = 19; // grensen for å sende en fil direkte til Gemini

const REF_RULE = `"referenceText": "en fyldig, ryddig oppsummering av HELE dokumentet på norsk bokmål (maks ca. 6000 ord), med alle konkrete detaljer som tall, innstillinger, feilkoder, mål, frister, vilkår og unntak. Dette brukes senere til å svare på spørsmål uten å lese dokumentet på nytt."`;

/** Lagrer referanseteksten som en tekstfil i databasen. Returnerer fil-id. */
export async function saveText(text, name = 'referanse.txt') {
  if (!text) return null;
  const { id } = await backend.saveFile(new File([text], name, { type: 'text/plain' }));
  return id;
}

const textCache = new Map();
export async function loadText(fileId) {
  if (!fileId) return '';
  if (textCache.has(fileId)) return textCache.get(fileId);
  const { b64 } = await backend.loadFileBase64(fileId);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const text = new TextDecoder().decode(bytes);
  textCache.set(fileId, text);
  return text;
}

async function run({ source, schema, system }) {
  const parts = [];
  let tools = null;
  if (source.url) {
    tools = [{ url_context: {} }];
    parts.push({ text: `Les dokumentet/siden på denne adressen: ${source.url}` });
  } else {
    const b64 = source.b64 || (await blobToBase64(source.file));
    parts.push({ inline_data: { mime_type: source.mime || source.file?.type || 'application/pdf', data: b64 } });
  }
  parts.push({ text: `Svar KUN med gyldig JSON (ingen annen tekst) på dette formatet:\n{\n${schema},\n  ${REF_RULE}\n}` });
  const out = await gemini({ json: true, system, parts, tools, maxTokens: 32768 });
  if (!out || typeof out !== 'object') throw new AIError('Forsto ikke svaret fra Gemini.');
  return out;
}

/** Leser et dokument én gang. Returnerer { data, textFileId }. */
export async function readOnce({ source, schema, system }) {
  if (source.file && source.file.size > AI_MAX_MB * 1024 * 1024) {
    throw new AIError(`Fila er for stor for AI (maks ${AI_MAX_MB} MB). Bruk heller en lenke til bruksanvisningen.`);
  }
  const data = await run({ source, schema, system });
  const text = typeof data.referenceText === 'string' ? data.referenceText.trim() : '';
  delete data.referenceText;
  const textFileId = text ? await saveText(text) : null;
  if (textFileId) textCache.set(textFileId, text);
  return { data, textFileId };
}

// ───────── Skjemaer ─────────

export const SCHEMAS = {
  receipt: {
    system: 'Du leser kvitteringer og garantibevis for en norsk familie. Hent ut fakta nøyaktig. Bruk null når noe ikke står.',
    schema: `  "productName": "hva som er kjøpt (hovedproduktet)",
  "brand": "merke eller null",
  "model": "modell eller null",
  "category": "kjøkken|hvitevarer|elektronikk|verktøy|møbler|klær|sport|barn|bil|hage|annet",
  "emoji": "én passende emoji",
  "store": "butikk eller null",
  "purchaseDate": "YYYY-MM-DD eller null",
  "price": tall i kroner eller null,
  "warrantyYears": tall (produsentgaranti i år, fra dokumentet) eller null,
  "reklamasjonYears": 2 eller 5 (norsk reklamasjonsrett: 5 år for ting som er ment å vare vesentlig lenger enn 2 år, f.eks. hvitevarer, møbler, dyr elektronikk; ellers 2)`,
  },
  manual: {
    system: 'Du leser bruksanvisninger for en norsk familie og lager en praktisk oppsummering på enkelt norsk bokmål.',
    schema: `  "productName": "produktets navn",
  "brand": "merke eller null",
  "model": "modell eller null",
  "category": "kjøkken|hvitevarer|elektronikk|verktøy|møbler|klær|sport|barn|bil|hage|annet",
  "emoji": "én passende emoji",
  "summary": "2–3 setninger om produktet og hva som er viktigst å vite",
  "keyFacts": ["nyttige fakta: innstillinger, kapasitet, mål, programmer – maks 12"],
  "maintenance": [{"task": "f.eks. Rens lofilteret", "everyMonths": tall (hvor ofte i måneder, 0.25 = ukentlig)}],
  "troubleshooting": [{"problem": "f.eks. Feilkode E21", "solution": "kort løsning"}]`,
  },
  insurance: {
    system: 'Du er en hjelpsom norsk forsikringsrådgiver. Les forsikringsdokumentet og hent ut fakta. Skriv enkelt og kort på norsk bokmål. Ikke gjett – bruk null når noe ikke står i dokumentet.',
    schema: `  "type": "bil|hus|innbo|reise|liv|ulykke|uføre|helse|barn|dyr|båt|annet",
  "name": "kort navn, f.eks. 'Bilforsikring Tesla'",
  "company": "forsikringsselskap",
  "policyNumber": "polisenummer eller null",
  "insured": "hvem/hva som er forsikret – kort",
  "pricePerYear": tall i kroner eller null,
  "pricePerMonth": tall i kroner eller null,
  "renewalDate": "YYYY-MM-DD (hovedforfall/fornyelse) eller null",
  "deductible": "egenandel(er), kort tekst eller null",
  "annualKm": tall (årlig kjørelengde for bil) eller null,
  "summary": "2–3 setninger på enkelt norsk",
  "covers": ["viktigste ting som ER dekket – maks 10"],
  "notCovered": ["viktige unntak – maks 8"],
  "keyTerms": ["andre nyttige detaljer – maks 15"]`,
  },
};

/** Svarer på et spørsmål ut fra lagrede tekster (ingen originaldokumenter leses). */
export async function askFromTexts(question, sources, role = 'familiens dokumenter') {
  const ctx = sources.map((s) => `### ${s.title}\n${s.facts || ''}\n${s.text ? '\nFulltekst:\n' + s.text : ''}`).join('\n\n---\n\n');
  return gemini({
    system: `Du svarer på spørsmål om ${role} på enkelt norsk. Svar kort og konkret (maks ca. 150 ord). Si hvilket dokument/produkt svaret gjelder. Finnes ikke svaret i teksten, si det ærlig og foreslå hva man kan gjøre. Du er ikke juridisk rådgiver.`,
    parts: [{ text: `${ctx || '(ingen dokumenter)'}\n\nSpørsmål: ${question}` }],
  });
}
