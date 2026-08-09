export * from "./tiles.js";
export * from "./tokenize.js";
export * from "./trie.js";
export * from "./dictionary.js";
export * from "./lexicon.js";
export * from "./types.js";
export * from "./board.js";
export * from "./game.js";
export * from "./ai.js";
export * from "./version.js";

import { getDefaultLexicon, type Lexicon } from "./lexicon.js";

export function getDefaultDictionary(): Lexicon {
  return getDefaultLexicon();
}
