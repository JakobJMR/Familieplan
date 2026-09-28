// AI-funksjoner for huset, vinkjelleren og middagsforslag.

import { gemini } from './ai.js';

export async function identifyWine(b64, mime = 'image/jpeg') {
  return gemini({
    json: true,
    system: 'Du er en erfaren sommelier. Identifiser vinen på bildet av etiketten så presist du kan, og gi realistiske vurderinger. Svar på norsk bokmål. Bruk null når du ikke vet.',
    parts: [
      { inline_data: { mime_type: mime, data: b64 } },
      {
        text: `Svar KUN med JSON:
{
  "name": "vinens navn/cuvée",
  "producer": "produsent",
  "vintage": årstall eller null,
  "type": "rød|hvit|rosé|musserende|søt|oransje|annet",
  "grapes": "druer, kommaseparert",
  "region": "område/appellasjon",
  "country": "land",
  "abv": alkoholprosent som tall eller null,
  "drinkFrom": årstall (når den er klar) eller null,
  "drinkUntil": årstall (siste gode år) eller null,
  "storage": "lagringspotensial kort, f.eks. 'Kan lagres 8–12 år' eller 'Drikkes ung'",
  "cellarWorthy": true/false (er den lagringsverdig?),
  "style": "kort beskrivelse av stil og smak (1–2 setninger)",
  "pairing": "passer til … (kort)",
  "confidence": "høy|middels|lav (hvor sikker du er på identifiseringen)"
}`,
      },
    ],
  });
}

export async function winePairing(dish, wines) {
  const list = wines.map((w) => `- id:${w.id} · ${w.producer || ''} ${w.name} ${w.vintage || ''} (${w.type}, ${w.grapes || ''}, ${w.region || ''}) · ${w.bottles} fl.`).join('\n');
  return gemini({
    json: true,
    system: 'Du er sommelier for en norsk familie. Velg blant vinene de faktisk har.',
    parts: [{ text: `Retten er: «${dish}».\nVinkjelleren:\n${list}\n\nSvar KUN med JSON: {"picks":[{"id":"...","why":"kort begrunnelse"}],"tip":"kort råd hvis ingen passer godt"} (maks 3 picks, beste først).` }],
  });
}

export async function suggestMeals({ have, onlyHave, dates, recipes, fixed, avoid }) {
  return gemini({
    json: true,
    temperature: 0.7,
    system: 'Du er en kreativ, praktisk kokk for en norsk barnefamilie. Foreslå hverdagsmiddager som er realistiske å lage på under en time.',
    parts: [
      {
        text: `Vi har: ${have || '(ikke oppgitt)'}.
${onlyHave ? 'Bruk BARE det vi har, pluss vanlige basisvarer (salt, pepper, olje, smør, mel, krydder).' : 'Bruk helst det vi har – det er lov å kjøpe litt i tillegg.'}
Familiens egne oppskrifter: ${recipes || 'ingen'}. Bruk gjerne disse hvis de passer.
${avoid ? 'Unngå disse (planlagt nylig): ' + avoid : ''}
${dates.length ? `Lag ett forslag for hver av disse datoene: ${dates.join(', ')}. ${fixed ? 'Faste retter: ' + fixed : ''}` : 'Lag 3 forslag.'}
Svar KUN med JSON:
{"suggestions":[{"date":"YYYY-MM-DD eller null","dish":"...","emoji":"🍝","why":"kort: hva fra lageret som brukes","ingredients":["mengde + ingrediens for 4 personer"],"missing":["ting vi må kjøpe"],"minutes":tall}]}`,
      },
    ],
  });
}

export async function photoContents(b64, mime = 'image/jpeg') {
  return gemini({
    json: true,
    system: 'Du lager inventarlister for en norsk familie ut fra bilder av bokser, skap og hyller.',
    parts: [
      { inline_data: { mime_type: mime, data: b64 } },
      { text: 'List opp tingene du ser, kort og konkret på norsk (f.eks. "Babyklær str. 86", "Julepynt – kuler", "Skøyter str. 32"). Slå sammen like ting. Svar KUN med JSON: {"title":"forslag til navn på boksen/hylla","emoji":"📦","items":["..."]}' },
    ],
  });
}

export async function askHouse(question, inventory) {
  return gemini({
    system: 'Du hjelper en norsk familie å finne ting i huset. Svar kort og konkret: hvilket rom, hvilken boks/hylle. Finnes det ikke i lista, si det ærlig og foreslå hvor det kan være eller at de kan legge det inn.',
    parts: [{ text: `Inventarliste:\n${inventory}\n\nSpørsmål: ${question}` }],
  });
}
