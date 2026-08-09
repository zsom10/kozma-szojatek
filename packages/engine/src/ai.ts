import { BOARD_SIZE, CENTER, BINGO_BONUS } from "./tiles.js";
import { validateMove } from "./board.js";
import type { Board, Placement, ScoredMove, BotDifficulty } from "./types.js";
import type { Lexicon } from "./lexicon.js";
import type { TrieNode } from "./trie.js";

export type { BotDifficulty };

function boardEmpty(board: Board): boolean {
  return !board.some((row) => row.some((c) => c));
}

function isAnchor(board: Board, r: number, c: number): boolean {
  if (board[r][c]) return false;
  if (boardEmpty(board)) return r === CENTER && c === CENTER;
  const dirs = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  for (const [dr, dc] of dirs) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc]) {
      return true;
    }
  }
  return false;
}

function consumeRack(rack: string[], letter: string): string[] | null {
  const idx = rack.indexOf(letter);
  if (idx !== -1) {
    const next = [...rack];
    next.splice(idx, 1);
    return next;
  }
  const blank = rack.indexOf("?");
  if (blank !== -1) {
    const next = [...rack];
    next.splice(blank, 1);
    return next;
  }
  return null;
}

function isBotLegalMove(lexicon: Lexicon, move: ScoredMove): boolean {
  if (move.words.length === 0) return false;
  return move.words.every((w) => lexicon.isBotLegalWord(w));
}

function generateAlong(
  board: Board,
  rack: string[],
  lexicon: Lexicon,
  row: number,
  col: number,
  dr: number,
  dc: number,
  results: ScoredMove[],
  botOnly: boolean
): void {
  const root = (botOnly ? lexicon.getStemTrie() : lexicon.getTrie()).root;
  const tryFrom = (
    r: number,
    c: number,
    node: TrieNode,
    remaining: string[],
    placed: Placement[],
    usedNew: boolean
  ) => {
    if (node.terminal && usedNew && placed.length > 0) {
      const validated = validateMove(board, rack, placed, lexicon, BINGO_BONUS);
      if (validated.ok) {
        if (!botOnly || isBotLegalMove(lexicon, validated.move)) {
          results.push(validated.move);
        }
      }
    }

    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return;

    const existing = board[r][c];
    if (existing) {
      const next = node.children.get(existing.letter);
      if (!next) return;
      tryFrom(r + dr, c + dc, next, remaining, placed, usedNew);
      return;
    }

    if (remaining.length === 0) return;

    for (const [letter, child] of node.children) {
      const exactIdx = remaining.indexOf(letter);
      const after = consumeRack(remaining, letter);
      if (!after) continue;
      const isBlank = exactIdx === -1;
      const placement: Placement = { row: r, col: c, letter, isBlank };
      tryFrom(r + dr, c + dc, child, after, [...placed, placement], true);
    }
  };

  let startR = row;
  let startC = col;
  while (
    startR - dr >= 0 &&
    startR - dr < BOARD_SIZE &&
    startC - dc >= 0 &&
    startC - dc < BOARD_SIZE &&
    board[startR - dr][startC - dc]
  ) {
    startR -= dr;
    startC -= dc;
  }

  tryFrom(startR, startC, root, [...rack], [], false);
}

export function generateMoves(
  board: Board,
  rack: string[],
  lexicon: Lexicon,
  botOnly = false
): ScoredMove[] {
  const results: ScoredMove[] = [];
  const seen = new Set<string>();

  const pushUnique = (move: ScoredMove) => {
    const key = move.placements.map((p) => `${p.row},${p.col},${p.letter}`).join("|");
    if (seen.has(key)) return;
    seen.add(key);
    results.push(move);
  };

  const collect: ScoredMove[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (!isAnchor(board, r, c)) continue;
      generateAlong(board, rack, lexicon, r, c, 0, 1, collect, botOnly);
      generateAlong(board, rack, lexicon, r, c, 1, 0, collect, botOnly);
    }
  }

  for (const m of collect) pushUnique(m);
  results.sort((a, b) => b.score - a.score);
  return results;
}

export function chooseBotMove(
  board: Board,
  rack: string[],
  lexicon: Lexicon,
  difficulty: BotDifficulty = "medium"
): ScoredMove | null {
  const moves = generateMoves(board, rack, lexicon, true);
  if (moves.length === 0) return null;

  if (difficulty === "hard") return moves[0];

  if (difficulty === "medium") {
    const top = moves.slice(0, Math.min(10, moves.length));
    return top[Math.floor(Math.random() * top.length)];
  }

  const weak = moves.filter((m) => m.score <= Math.max(12, moves[0].score * 0.45));
  const pool = weak.length > 0 ? weak : moves.slice(Math.floor(moves.length / 2));
  return pool[Math.floor(Math.random() * pool.length)];
}
