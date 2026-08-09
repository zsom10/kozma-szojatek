import { DIGRAPHS } from "./tiles.js";

export function tokenizeWord(word: string): string[] | null {
  const upper = word.trim().toUpperCase().normalize("NFC");
  if (!upper) return null;
  const tiles: string[] = [];
  let i = 0;
  while (i < upper.length) {
    let matched = false;
    for (const d of DIGRAPHS) {
      if (upper.startsWith(d, i)) {
        tiles.push(d);
        i += d.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const ch = upper[i];
      if (!/[A-ZÁÉÍÓÖŐÚÜŰ]/.test(ch)) return null;
      tiles.push(ch);
      i += 1;
    }
  }
  return tiles;
}

export function tilesToWord(tiles: string[]): string {
  return tiles.join("");
}
