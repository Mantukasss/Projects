/**
 * Canonical spellings for names that Russian-language sources write in Cyrillic.
 *
 * This exists because the failure it prevents is fatal to a news account. Counter-Strike
 * nicknames are stylised — digits inside words, deliberate capitals, no relation to how
 * they sound — so a model translating Cyrillic reaches for a phonetic transliteration and
 * produces confident nonsense: м0НЕСИ became "Ilya Montesko", Ринкл became "Rinkl", and the
 * genitive of the team name Соколы ("the Falcons'") became a surname, "Sokolov".
 *
 * Nobody in this audience needs to check those. They read as an account that does not know
 * the scene, which is the one thing a news account cannot survive looking like.
 *
 * A glossary rather than cleverness, because there is no rule to infer: m0NESY is not
 * derivable from Монеси by any transformation. Add entries as they come up — a name that is
 * missing degrades to the rule in the prompt, which is to leave the Cyrillic alone rather
 * than guess.
 */
export interface GlossaryEntry {
  /** How Russian-language sources write it. */
  cyrillic: string[];
  /** The only correct Latin spelling. */
  latin: string;
}

export const PLAYERS: GlossaryEntry[] = [
  { cyrillic: ["м0НЕСИ", "Монеси", "монеси", "м0неси"], latin: "m0NESY" },
  { cyrillic: ["Ринкл", "ринкл", "р1нкл"], latin: "r1nkle" },
  { cyrillic: ["Симпл", "симпл", "с1мпл"], latin: "s1mple" },
  { cyrillic: ["Донк", "донк"], latin: "donk" },
  { cyrillic: ["Электроник", "электроник"], latin: "electroNic" },
  { cyrillic: ["Бит", "б1т"], latin: "b1t" },
  { cyrillic: ["Перфекто", "перфекто"], latin: "Perfecto" },
  { cyrillic: ["Широ", "широ", "ш1ро"], latin: "sh1ro" },
  { cyrillic: ["Аксель", "Ах1Ле"], latin: "Ax1Le" },
  { cyrillic: ["Хоббит", "хоббит"], latin: "HObbit" },
  { cyrillic: ["Интерз", "интерз"], latin: "interz" },
  { cyrillic: ["Чоппер", "чоппер"], latin: "chopper" },
  { cyrillic: ["Маджикс", "маджикс"], latin: "magixx" },
  { cyrillic: ["Зонтикс", "зонтикс", "з0нт1х"], latin: "zont1x" },
  { cyrillic: ["Молодой", "молодой"], latin: "molodoy" },
  { cyrillic: ["Джейм", "джейм"], latin: "Jame" },
  { cyrillic: ["Флит", "флит"], latin: "FL1T" },
  { cyrillic: ["Никола", "НиКо"], latin: "NiKo" },
  { cyrillic: ["Зиву", "ЗайВу"], latin: "ZywOo" },
  { cyrillic: ["Ропз", "ропз"], latin: "ropz" },
  { cyrillic: ["Апекс", "апекс"], latin: "apEX" },
  { cyrillic: ["Торзси", "торзи"], latin: "torzsi" },
  { cyrillic: ["Броки", "броки"], latin: "broky" },
  { cyrillic: ["Карриган", "карриган"], latin: "karrigan" },
  { cyrillic: ["Рейн", "рейн"], latin: "rain" },
  { cyrillic: ["Фрозен", "фрозен"], latin: "frozen" },
  { cyrillic: ["Зонич", "зонык", "зоник"], latin: "zonic" },
  { cyrillic: ["Кобразера", "кобразера"], latin: "cobrazera" },
  { cyrillic: ["Техно", "техно"], latin: "Techno" },
  { cyrillic: ["Сензу", "сензу"], latin: "Senzu" },
];

export const TEAMS: GlossaryEntry[] = [
  // The one that produced "Sokolov". Russian declines team names, and the genitive of
  // Соколы looks exactly like a surname.
  { cyrillic: ["Соколы", "Соколов", "Соколам", "Соколами", "соколы", "соколов"], latin: "Falcons" },
  { cyrillic: ["Спирит", "Спирита", "спирит"], latin: "Spirit" },
  { cyrillic: ["НАВИ", "Нави", "нави"], latin: "NAVI" },
  { cyrillic: ["Виртус.про", "Виртус про", "ВП"], latin: "Virtus.pro" },
  { cyrillic: ["Фурия", "фурия"], latin: "FURIA" },
  { cyrillic: ["Виталити", "виталити"], latin: "Vitality" },
  { cyrillic: ["Мауз", "мауз"], latin: "MOUZ" },
  { cyrillic: ["Аврора", "аврора"], latin: "Aurora" },
  { cyrillic: ["Монголз", "МонголЗ", "монголз"], latin: "The MongolZ" },
  { cyrillic: ["Астралис", "астралис"], latin: "Astralis" },
  { cyrillic: ["Фейз", "фейз"], latin: "FaZe" },
  { cyrillic: ["Ликвид", "ликвид"], latin: "Liquid" },
  { cyrillic: ["Хироик", "хироик"], latin: "Heroic" },
  { cyrillic: ["Вечный огонь"], latin: "Eternal Fire" },
  { cyrillic: ["Пейн", "пейн"], latin: "paiN" },
  { cyrillic: ["Империал", "империал"], latin: "Imperial" },
];

/** The glossary as prompt lines, so the model is told rather than trusted to know. */
export function glossaryLines(): string[] {
  const line = (entry: GlossaryEntry) => `  ${entry.cyrillic[0]} -> ${entry.latin}`;
  return [
    "NAMES — these are the ONLY correct spellings. Never transliterate a name phonetically:",
    ...PLAYERS.map(line),
    ...TEAMS.map(line),
  ];
}

/**
 * Repairs names the model got wrong anyway.
 *
 * The prompt is instruction; this is enforcement. A model that has just written a fluent
 * paragraph will happily invent "Montesko" inside it, and the only reliable fix is to
 * replace the string afterwards.
 */
export function correctNames(text: string): string {
  let out = text;
  for (const entry of [...PLAYERS, ...TEAMS]) {
    for (const form of entry.cyrillic) {
      out = out.replace(new RegExp(form, "gi"), entry.latin);
    }
  }
  return out;
}
