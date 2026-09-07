/**
 * Decides whether a post is in a language this account's audience does not read.
 *
 * The first version of this asked one question — is there Cyrillic? — because the only
 * foreign source at the time was Russian. Then a FURIA post went out reading "Já temos data
 * marcada para voltar ao servidor!", untranslated, because Portuguese is written in the same
 * alphabet as English. Half the orgs worth following post in Portuguese, Spanish or French,
 * so alphabet alone cannot be the test.
 *
 * Two tests, because they fail differently:
 *
 *   1. SCRIPT. Cyrillic, Greek, Arabic, Hebrew, CJK, Thai, Korean. Certain on sight — no
 *      English CS post contains a Cyrillic word.
 *   2. FUNCTION WORDS. Latin-alphabet languages give themselves away through the small words
 *      that carry no meaning and cannot be avoided: "para", "nous", "und", "för". Content
 *      words are useless here because CS posts are full of names, and names travel.
 *
 * Test 2 needs TWO hits before it fires. One is not enough: an English post can carry a
 * single foreign word in an org name or a quoted phrase, and a Translate button on an
 * English post is a small annoyance while a false negative is an untranslated post going out.
 * Two independent function words in one short post effectively never happens in English.
 *
 * WHERE THIS IS WRONG: a very short foreign post — three or four words, no function words —
 * reads as English and gets no button. That is the accepted failure, because loosening the
 * threshold puts the button on English posts instead. Diacritics deliberately do not count:
 * "Håvard", "Zörter" and "paiN" are all English-post material.
 */

/** Alphabets an English-speaking audience cannot read at all. */
const FOREIGN_SCRIPT =
  /[Ѐ-ӿͰ-Ͽ֐-׿؀-ۿ฀-๿぀-ヿ一-鿿가-힯]/;

/**
 * Function words that do not collide with English.
 *
 * Every candidate was checked against English before being added, which is why some obvious
 * ones are missing: "die" (German) and "do" (Polish) are English words, "no" and "a" are
 * English words, "plus" is an English word. A collision here puts the Translate button on
 * English posts, which trains the eye to ignore it.
 */
const FUNCTION_WORDS = [
  // Portuguese — FURIA, paiN, Imperial, Legacy, Fluxo, MIBR.
  "já", "não", "nao", "temos", "para", "com", "uma", "nós", "que", "dos", "das", "mais",
  "hoje", "vamos", "está", "sua", "seu", "pelo", "pela", "nosso", "nossa", "sobre",
  "é", "são", "foi", "vou", "sou", "nem", "muito", "tudo", "agora", "ainda", "porque",
  "quando", "obrigado", "valeu", "aqui", "meu", "minha", "ele", "ela", "isso", "também",
  "só", "até", "então", "onde",
  // Spanish — 9z, Leviatán, KRÜ, BESTIA.
  "los", "las", "del", "por", "más", "con", "hoy", "nuestro", "nuestra", "equipo", "ya",
  "pero", "cuando", "donde", "ahora", "todo", "muy", "gracias", "somos", "sus", "sin",
  // French — Vitality, Falcons' French-language posts, 3DMAX.
  "les", "des", "pour", "avec", "nous", "notre", "est", "sur", "très", "cette", "aussi",
  "était", "sont", "ont", "cela", "chez", "leur", "bien", "merci", "toujours",
  // German — BIG, Eternal Fire's German posts.
  "der", "das", "und", "für", "nicht", "mit", "ein", "eine", "wir", "ist", "auch",
  "aber", "haben", "sind", "sich", "noch", "sehr", "danke", "heute",
  // Nordic — Astralis, Heroic, NiP, Fnatic.
  "och", "för", "att", "är", "ikke", "inte", "med", "har", "vores", "vår",
  "vi", "er", "til", "og", "af", "eller", "kan",
  // Turkish — Eternal Fire, FUT, Fear.
  "bir", "için", "ile", "bu", "ve",
  // Polish — Virtus.pro's Polish posts, Zero Tenacity.
  "nie", "jest", "się", "dla", "który",
];

const FUNCTION_WORD_SET = new Set(FUNCTION_WORDS);

/** True when the alphabet itself is unreadable — Cyrillic and friends. */
export function isForeignScript(text: string): boolean {
  return FOREIGN_SCRIPT.test(text);
}

/**
 * True when the post is not in English and needs translating before it can go out.
 *
 * Deliberately one boolean rather than a language name. Naming the language would mean
 * guessing between Portuguese and Spanish on posts that share most of their function words,
 * and the translator does not need to be told — it can see the text.
 *
 * Splitting on non-letters rather than matching a regex of alternatives, because word
 * boundaries in a regex would need lookbehind to handle two function words in a row, and
 * lookbehind in a client bundle is a syntax error on older iOS rather than a wrong answer.
 */
export function needsTranslation(text: string): boolean {
  if (isForeignScript(text)) return true;
  const hits = new Set<string>();
  for (const word of text.toLowerCase().split(/[^\p{L}]+/u)) {
    if (FUNCTION_WORD_SET.has(word)) hits.add(word);
    if (hits.size >= 2) return true;
  }
  return false;
}
