import { franc } from "franc-min";

/**
 * Decides whether a post is in a language this account's audience does not read.
 *
 * THIS IS THE THIRD VERSION. The first asked one question — is there Cyrillic? — and a FURIA
 * post in Portuguese went out untranslated. The second added a list of foreign function words
 * and needed two hits; then a Vitality post arrived reading "Chaque détail mène à la victoire.
 * Découvrez le complément alimentaire de nos joueurs !" and scored ZERO, because not one of
 * chaque/détail/mène/victoire/découvrez/complément/joueurs was on a list that could never be
 * long enough. Extending it again would have been the same mistake a third time.
 *
 * So the question is INVERTED. Instead of proving a post is foreign, prove it is ENGLISH.
 * English has a small closed class of words that any real English sentence contains — the,
 * with, from, for, that, have — and unlike the foreign vocabulary, that class is finite and
 * short. A post with none of them is not English, whatever else it is.
 *
 * That single test is too blunt on its own, so it is paired with a real detector:
 *
 *   1. SCRIPT — Cyrillic, Greek, Arabic, Hebrew, CJK, Thai, Korean. Certain on sight.
 *   2. franc SAYS A LANGUAGE and the text has NO ENGLISH FUNCTION WORD. Neither half works
 *      alone, and that is the whole design. Measured on real feed text, franc alone called
 *      "Media day photos from Porto" Portuguese, "Top 4 in Porto" Spanish and "Krabeni pens
 *      contract extension with FUT" French — it latches onto proper nouns in short text. The
 *      English check vetoes every one of those, because they all contain from / in / with.
 *   3. NO ENGLISH FUNCTION WORD IN A LONG POST. franc gives up on names — it read the Turkish
 *      "İstanbul'da Şampiyon FUT FreeZone" as English — so length carries the ones it misses.
 *   4. The old foreign-word list, kept as a floor for terse posts the others let through.
 *
 * WHERE THIS IS STILL WRONG: a two-word post of pure proper nouns is unclassifiable by any
 * of the four and reads as English. That is the accepted failure, and it is nearly always a
 * post not worth making anyway.
 *
 * TEST EACH PART OF AN ITEM SEPARATELY — use `anyForeign`, never a concatenation. A feed
 * item's summary is often OUR text, not the author's: Twitch appends "Clipped from
 * BLASTPremier · 4 views", whose "from" and "on" are real English function words and vetoed
 * the Portuguese title they were bolted onto. Judging a post by boilerplate the app itself
 * wrote is how "Sempre a fazer porcaria este valamatos" was called English.
 */

/** Alphabets an English-speaking audience cannot read at all. */
const FOREIGN_SCRIPT = /[Ѐ-ӿͰ-Ͽ֐-׿؀-ۿ฀-๿぀-ヿ一-鿿가-힯]/;

/**
 * English function words. The finite half of the problem.
 *
 * SINGLE LETTERS ARE DELIBERATELY ABSENT. "a" is an English article and also Portuguese and
 * Spanish; "I" is a pronoun and a Roman numeral. Including "a" made "o plano N é diferente e
 * a run dos playoffs" read as English on the strength of one letter.
 *
 * Nor are content words here. "game", "team" and "win" are English, but they are also loaned
 * into every esports language on earth, and a Portuguese post about "o game" is not English.
 */
const ENGLISH_WORDS = new Set([
  "the","of","and","to","in","is","was","were","are","be","been","for","with","on","at","by",
  "from","as","that","this","these","those","it","its","he","she","his","her","him","they",
  "them","their","we","our","us","you","your","who","whom","whose","which","what","when",
  "where","why","how","not","no","but","or","if","than","then","so","because","while",
  "have","has","had","do","does","did","will","would","can","could","should","may","might",
  "must","about","after","before","over","under","between","through","into","onto","out",
  "up","down","off","again","more","most","less","least","all","any","some","each","every",
  "both","other","another","such","only","just","also","very","too","now","new","first",
  "last","next","back","still","yet","here","there","one","two","three","against","during",
  "without","within","across","behind","beyond","per","via","upon","along","around","since",
]);

/**
 * Foreign function words, kept from the previous version as a floor.
 *
 * No longer load-bearing — the English test and franc do the work — so it does not need to
 * grow. Entries that collide with English or with map names are still excluded: German "die",
 * Polish "do", Danish "at", "eu" for Europe, and "de"/"do" because "de_dust2" tokenises.
 */
const FOREIGN_WORDS = new Set([
  // Portuguese
  "já","não","nao","temos","para","com","uma","nós","que","dos","das","mais","hoje","vamos",
  "está","sua","seu","pelo","pela","nosso","nossa","sobre","é","são","foi","vou","sou","nem",
  "muito","tudo","agora","ainda","porque","quando","obrigado","valeu","aqui","meu","minha",
  "ele","ela","isso","também","só","até","então","onde",
  // Spanish
  "los","las","del","por","más","hoy","nuestro","nuestra","equipo","ya","pero","cuando",
  "donde","ahora","todo","muy","gracias","somos","sus","sin","el","una","esta","este",
  // French
  "les","des","pour","avec","nous","notre","est","sur","très","cette","aussi","était","sont",
  "ont","cela","chez","leur","bien","merci","toujours","chaque","le","la","du","au","aux",
  "vos","ses","ces","cet","tous","toute","nos","dans","plus","fait","être","avoir",
  // German
  "der","das","und","für","nicht","mit","ein","eine","wir","ist","auch","aber","haben","sind",
  "sich","noch","sehr","danke","heute",
  // Nordic
  "och","för","att","är","ikke","inte","med","har","vores","vår","vi","er","til","og","af",
  "eller","kan",
  // Turkish
  "bir","için","ile","bu","ve","çok","daha","olarak","sonra",
  // Polish
  "nie","jest","się","dla","który","oraz","tylko",
]);

/**
 * The words a language test may look at.
 *
 * Handles, hashtags, links and scorelines are noise: "@TeamVitality" and "#BLASTPremier" are
 * not evidence of any language, and a post that is mostly mentions would otherwise be judged
 * on its punctuation.
 */
function words(text: string): string[] {
  return text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[@#]\w+/g, " ")
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((word) => word.length > 1);
}

/** True when the alphabet itself is unreadable — Cyrillic and friends. */
export function isForeignScript(text: string): boolean {
  return FOREIGN_SCRIPT.test(text);
}

/**
 * True when the post is not in English and needs translating before it can go out.
 *
 * Deliberately one boolean rather than a language name. Naming the language would mean
 * guessing between Portuguese and Spanish on posts that share most of their vocabulary, and
 * the translator does not need to be told — it can see the text.
 */
export function anyForeign(...parts: (string | null | undefined)[]): boolean {
  return parts.some((part) => (part ? needsTranslation(part) : false));
}

export function needsTranslation(text: string): boolean {
  if (isForeignScript(text)) return true;

  const tokens = words(text);
  if (tokens.length === 0) return false;

  const english = tokens.some((word) => ENGLISH_WORDS.has(word));
  const foreignHits = new Set(tokens.filter((word) => FOREIGN_WORDS.has(word))).size;

  // Two foreign function words outweigh a stray English one — "a run dos playoffs" is not a
  // sentence in English however many English-looking tokens it borrows.
  if (foreignHits >= 2) return true;
  if (english) return false;

  // From here on the post contains no English function word at all.
  if (foreignHits >= 1) return true;

  /**
   * Below five words, stop. Nothing here can tell a language from a fragment.
   *
   * Measured, not guessed: with franc trusted on anything, "CS2 POV demo recording", "Scout
   * Ace 5x Hs Faceit", "YINXING Future Star Festival" and "Fox > s1mple" all came back as
   * some language or other. They are four tokens of proper nouns with no function word in
   * sight, which is exactly the shape a trigram model has nothing to say about.
   *
   * What this gives up is short foreign fragments — "TOU NA BLAST CRL", "jugadon". Accepted:
   * they are stream-clip titles, not posts anyone would make, and the alternative is a
   * Translate button on half the English feed, which trains the eye to ignore it.
   */
  if (tokens.length < 5) return false;

  const guess = franc(text, { minLength: 16 });
  if (guess !== "und" && guess !== "eng") return true;

  /**
   * Six words of English without one function word essentially does not happen, and this
   * catches what franc gives up on — it read the Turkish "İstanbul'da Şampiyon FUT FreeZone"
   * as English, because four of its five tokens are names.
   */
  return tokens.length >= 6;
}
