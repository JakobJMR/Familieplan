// Emoji-forslag og automatisk emoji på handlelista.

export const MEMBER_EMOJIS = ['👩', '👨', '🧑', '👧', '👦', '🧒', '👶', '👵', '👴', '🐶', '🐱', '🦊', '🐻', '🐼', '🦄', '🐸'];
export const ACTIVITY_EMOJIS = ['💼', '🏫', '🧸', '⚽', '🏊', '🎹', '🎸', '🩰', '🤸', '🏒', '🎾', '🏃', '🎨', '📚', '🚗', '🧑‍🍳', '🏋️', '🎮', '⛪', '📌'];
export const EVENT_EMOJIS = ['📅', '🎂', '🎉', '🦷', '🩺', '✈️', '🚗', '🏫', '⚽', '🎭', '🍽️', '🎄', '💼', '👶', '📞', '🛠️'];
export const TASK_EMOJIS = ['✅', '🧹', '🧺', '🍽️', '🪴', '🐕', '🛒', '📦', '💡', '🔧', '🧾', '📞', '🚗', '🗑️', '🛏️', '📬'];
export const GARBAGE_EMOJIS = ['🗑️', '♻️', '🍂', '🥫', '📦', '🍾', '🧃', '🟢', '🔵', '🟤'];

const FOOD = [
  [/melk|mjølk/, '🥛'], [/brød|rundstykk|baguett|loff/, '🍞'], [/egg/, '🥚'], [/ost/, '🧀'], [/smør|margarin/, '🧈'],
  [/lyspære/, '💡'], [/banan/, '🍌'], [/eple/, '🍎'], [/pære/, '🍐'], [/appelsin|klementin|mandarin/, '🍊'], [/sitron/, '🍋'],
  [/drue/, '🍇'], [/jordbær/, '🍓'], [/blåbær|bær/, '🫐'], [/melon/, '🍉'], [/ananas/, '🍍'], [/avokado/, '🥑'],
  [/tomat/, '🍅'], [/agurk/, '🥒'], [/salat|spinat|ruccola/, '🥬'], [/brokkoli/, '🥦'], [/gulrot|gulrøtter/, '🥕'],
  [/potet/, '🥔'], [/hvitløk/, '🧄'], [/løk/, '🧅'], [/paprika|chili/, '🌶️'], [/mais/, '🌽'], [/sopp/, '🍄'],
  [/kylling/, '🍗'], [/kjøttdeig|biff|kjøtt|entrecote/, '🥩'], [/bacon/, '🥓'], [/pølse/, '🌭'], [/skinke|pålegg/, '🍖'],
  [/laks|fisk|torsk|sei|reke|scampi/, '🐟'], [/pasta|spagetti|makaroni/, '🍝'], [/ris/, '🍚'], [/taco|tortilla|lefse/, '🌮'],
  [/pizza/, '🍕'], [/mel|gjær/, '🌾'], [/sukker|søtning/, '🧂'], [/salt|pepper|krydder/, '🧂'], [/olje/, '🫒'],
  [/kaffe/, '☕'], [/te\b|tebrev/, '🍵'], [/juice|saft/, '🧃'], [/brus|cola|farris|vann/, '🥤'], [/øl/, '🍺'], [/vin/, '🍷'],
  [/yoghurt|youghurt|skyr/, '🥣'], [/müsli|musli|frokostblanding|havre|gryn/, '🥣'], [/sjokolade|snop|godteri/, '🍫'],
  [/chips|snacks/, '🍿'], [/kjeks|kake/, '🍪'], [/is\b|iskrem/, '🍦'], [/honning/, '🍯'], [/syltetøy|nugatti/, '🍯'],
  [/bleie|våtserviett/, '👶'], [/dopapir|tørkepapir|papir/, '🧻'], [/såpe|oppvask|vaskemiddel|zalo|klut/, '🧼'],
  [/tannkrem|tannbørste/, '🪥'], [/sjampo|balsam/, '🧴'], [/batteri/, '🔋'], [/hundemat|kattemat/, '🐾'],
  [/blomst/, '💐'], [/medisin|plaster|paracet|ibux/, '💊'],
];

export function guessEmoji(name) {
  const n = name.toLowerCase();
  for (const [re, e] of FOOD) if (re.test(n)) return e;
  return '🛒';
}

export const QUICK_SHOPPING = ['Melk', 'Brød', 'Egg', 'Smør', 'Ost', 'Bananer', 'Epler', 'Kaffe', 'Dopapir', 'Yoghurt'];
