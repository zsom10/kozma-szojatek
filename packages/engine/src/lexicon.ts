import { gunzipSync } from "node:zlib";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tokenizeWord, tilesToWord } from "./tokenize.js";
import { Trie, buildTrieFromWords } from "./trie.js";
import { STARTER_WORDS } from "./dictionary.js";

const INFLECTION_SUFFIXES = [
  "KÉNT",
  "KÉPP",
  "VALÓ",
  "VELŐ",
  "JAIÉ",
  "JEIÉ",
  "NAK",
  "NEK",
  "BAN",
  "BEN",
  "BA",
  "BE",
  "RA",
  "RE",
  "HOZ",
  "HEZ",
  "HÖZ",
  "NÁL",
  "NÉL",
  "TÓL",
  "TŐL",
  "RÓL",
  "RŐL",
  "VAL",
  "VEL",
  "ÉRT",
  "IG",
  "UL",
  "ÜL",
  "VÁ",
  "VÉ",
  "OK",
  "EK",
  "ÖK",
  "AK",
  "OT",
  "ET",
  "ÖT",
  "AT",
  "JAI",
  "JEI",
  "JA",
  "JE",
  "OM",
  "EM",
  "ÖM",
  "AM",
  "OD",
  "ED",
  "ÖD",
  "AD",
  "UNK",
  "ÜNK",
  "TOK",
  "TEK",
  "TÖK",
  "IK",
  "NI",
  "VA",
  "VE",
  "TT",
  "T",
  "K",
  "I",
  "É",
  "Á",
].sort((a, b) => b.length - a.length);

function dataPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "../data", name);
}

function loadLines(file: string): string[] {
  const gz = dataPath(`${file}.gz`);
  const plain = dataPath(file);
  if (existsSync(gz)) {
    return gunzipSync(readFileSync(gz)).toString("utf8").split(/\n/).filter(Boolean);
  }
  if (existsSync(plain)) {
    return readFileSync(plain, "utf8").split(/\n/).filter(Boolean);
  }
  return [];
}

export class Lexicon {
  private stems = new Set<string>();
  private forms = new Set<string>();
  private userWords = new Set<string>();
  private trie: Trie;
  private stemTrie: Trie;

  constructor(extraUserWords: string[] = []) {
    for (const w of STARTER_WORDS) {
      const key = w.toLocaleUpperCase("hu").normalize("NFC");
      this.forms.add(key);
      this.stems.add(key);
    }
    for (const w of loadLines("stems.txt")) this.stems.add(w);
    for (const w of loadLines("forms.txt")) this.forms.add(w);
    for (const w of extraUserWords) {
      const tiles = tokenizeWord(w);
      if (!tiles || tiles.length < 2) continue;
      this.userWords.add(tilesToWord(tiles));
    }
    this.trie = buildTrieFromWords(
      [...this.stems, ...this.forms, ...this.userWords],
      (w) => tokenizeWord(w)
    );
    this.stemTrie = buildTrieFromWords(
      [...this.stems, ...this.userWords],
      (w) => {
        const tiles = tokenizeWord(w);
        if (!tiles || tiles.length < 3) return null;
        return tiles;
      }
    );
  }

  size(): number {
    return this.stems.size + this.forms.size + this.userWords.size;
  }

  stemCount(): number {
    return this.stems.size;
  }

  userCount(): number {
    return this.userWords.size;
  }

  addWord(word: string): boolean {
    const tiles = tokenizeWord(word);
    if (!tiles || tiles.length < 2) return false;
    const key = tilesToWord(tiles);
    if (this.hasWord(key)) {
      this.userWords.add(key);
      return true;
    }
    this.userWords.add(key);
    this.forms.add(key);
    this.trie.insert(tiles);
    if (tiles.length >= 3) this.stemTrie.insert(tiles);
    return true;
  }

  hasWord(word: string): boolean {
    const key = word.toLocaleUpperCase("hu").normalize("NFC");
    return this.userWords.has(key) || this.forms.has(key) || this.stems.has(key);
  }

  hasStem(word: string): boolean {
    const key = word.toLocaleUpperCase("hu").normalize("NFC");
    return this.stems.has(key) || this.userWords.has(key);
  }

  isBotLegalWord(word: string): boolean {
    const tiles = tokenizeWord(word);
    if (!tiles || tiles.length < 3) return false;
    return this.hasStem(tilesToWord(tiles));
  }

  hasTiles(tiles: string[]): boolean {
    return this.hasPlayableWord(tilesToWord(tiles));
  }

  hasPlayableWord(word: string): boolean {
    const key = word.toLocaleUpperCase("hu").normalize("NFC");
    if (this.hasWord(key)) return true;
    for (const suf of INFLECTION_SUFFIXES) {
      if (key.length <= suf.length + 2) continue;
      if (!key.endsWith(suf)) continue;
      const stem = key.slice(0, -suf.length);
      if (this.hasStem(stem) || this.hasWord(stem)) return true;
    }
    return false;
  }

  hasPrefix(tiles: string[]): boolean {
    return this.trie.hasPrefix(tiles);
  }

  getTrie(): Trie {
    return this.trie;
  }

  getStemTrie(): Trie {
    return this.stemTrie;
  }
}

let cached: Lexicon | null = null;

export function getDefaultLexicon(userWords: string[] = []): Lexicon {
  if (!cached || userWords.length) {
    const lex = new Lexicon(userWords);
    if (!userWords.length) cached = lex;
    return lex;
  }
  return cached;
}

export function resetLexiconCache(): void {
  cached = null;
}
