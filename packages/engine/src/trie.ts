export class TrieNode {
  children = new Map<string, TrieNode>();
  terminal = false;
}

export class Trie {
  root = new TrieNode();

  insert(tiles: string[]): void {
    let node = this.root;
    for (const t of tiles) {
      let next = node.children.get(t);
      if (!next) {
        next = new TrieNode();
        node.children.set(t, next);
      }
      node = next;
    }
    node.terminal = true;
  }

  has(tiles: string[]): boolean {
    let node = this.root;
    for (const t of tiles) {
      const next = node.children.get(t);
      if (!next) return false;
      node = next;
    }
    return node.terminal;
  }

  hasPrefix(tiles: string[]): boolean {
    let node = this.root;
    for (const t of tiles) {
      const next = node.children.get(t);
      if (!next) return false;
      node = next;
    }
    return true;
  }
}

export function buildTrieFromWords(words: string[], tokenize: (w: string) => string[] | null): Trie {
  const trie = new Trie();
  for (const w of words) {
    const tiles = tokenize(w);
    if (tiles && tiles.length >= 2) trie.insert(tiles);
  }
  return trie;
}
