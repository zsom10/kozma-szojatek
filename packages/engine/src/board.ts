import {
  BOARD_SIZE,
  CENTER,
  LETTER_COUNTS,
  LETTER_POINTS,
  createPremiumGrid,
  type Premium,
} from "./tiles.js";
import type { Board, Placement, ScoredMove, TileCell } from "./types.js";
import { tilesToWord } from "./tokenize.js";
import type { Lexicon } from "./lexicon.js";

const premiums = createPremiumGrid();

export function emptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null)
  );
}

export function createBag(seed?: number): string[] {
  const bag: string[] = [];
  for (const [letter, count] of Object.entries(LETTER_COUNTS)) {
    for (let i = 0; i < count; i++) bag.push(letter);
  }
  return shuffle(bag, seed);
}

export function shuffle<T>(arr: T[], seed = Date.now()): T[] {
  const a = [...arr];
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function drawTiles(bag: string[], n: number): { drawn: string[]; bag: string[] } {
  const drawn = bag.slice(0, n);
  return { drawn, bag: bag.slice(n) };
}

export function letterPoints(letter: string, _isBlank = false): number {
  if (letter === "?" || letter === "") {
    return 0;
  }
  return LETTER_POINTS[letter] ?? 0;
}

export function rackTilePenalty(tile: string, blankPenalty: number): number {
  if (tile === "?") return blankPenalty;
  return LETTER_POINTS[tile] ?? 0;
}

export function rackPoints(rack: string[], blankPenalty = 10): number {
  return rack.reduce((s, t) => s + rackTilePenalty(t, blankPenalty), 0);
}

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

function sortPlacements(placements: Placement[]): Placement[] {
  return [...placements].sort((a, b) => a.row - b.row || a.col - b.col);
}

function detectDirection(board: Board, placements: Placement[]): "H" | "V" | null {
  if (placements.length === 0) return null;
  if (placements.length === 1) {
    const p = placements[0];
    const horiz =
      (inBounds(p.row, p.col - 1) && !!board[p.row][p.col - 1]) ||
      (inBounds(p.row, p.col + 1) && !!board[p.row][p.col + 1]);
    const vert =
      (inBounds(p.row - 1, p.col) && !!board[p.row - 1][p.col]) ||
      (inBounds(p.row + 1, p.col) && !!board[p.row + 1][p.col]);
    if (vert && !horiz) return "V";
    return "H";
  }
  const sameRow = placements.every((p) => p.row === placements[0].row);
  const sameCol = placements.every((p) => p.col === placements[0].col);
  if (sameRow) return "H";
  if (sameCol) return "V";
  return null;
}

function contiguousOnLine(
  board: Board,
  placements: Placement[],
  dir: "H" | "V"
): boolean {
  const map = new Map<string, Placement>();
  for (const p of placements) map.set(`${p.row},${p.col}`, p);

  if (dir === "H") {
    const row = placements[0].row;
    const cols = placements.map((p) => p.col).sort((a, b) => a - b);
    const min = cols[0];
    const max = cols[cols.length - 1];
    for (let c = min; c <= max; c++) {
      if (!board[row][c] && !map.has(`${row},${c}`)) return false;
    }
    return true;
  }
  const col = placements[0].col;
  const rows = placements.map((p) => p.row).sort((a, b) => a - b);
  const min = rows[0];
  const max = rows[rows.length - 1];
  for (let r = min; r <= max; r++) {
    if (!board[r][col] && !map.has(`${r},${col}`)) return false;
  }
  return true;
}

function touchesExisting(board: Board, placements: Placement[]): boolean {
  const occupied = board.some((row) => row.some((c) => c));
  if (!occupied) {
    return placements.some((p) => p.row === CENTER && p.col === CENTER);
  }
  const dirs = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  for (const p of placements) {
    for (const [dr, dc] of dirs) {
      const r = p.row + dr;
      const c = p.col + dc;
      if (inBounds(r, c) && board[r][c]) return true;
    }
  }
  return false;
}

function cellAt(
  board: Board,
  placements: Map<string, Placement>,
  r: number,
  c: number
): TileCell | null {
  const p = placements.get(`${r},${c}`);
  if (p) return { letter: p.letter, isBlank: p.isBlank, fresh: true };
  return board[r][c];
}

function extractWord(
  board: Board,
  placements: Map<string, Placement>,
  r: number,
  c: number,
  dr: number,
  dc: number
): { tiles: string[]; hasFresh: boolean; scoreCells: { letter: string; isBlank: boolean; r: number; c: number; fresh: boolean }[] } | null {
  let sr = r;
  let sc = c;
  while (inBounds(sr - dr, sc - dc) && cellAt(board, placements, sr - dr, sc - dc)) {
    sr -= dr;
    sc -= dc;
  }
  const scoreCells: { letter: string; isBlank: boolean; r: number; c: number; fresh: boolean }[] = [];
  let cr = sr;
  let cc = sc;
  let hasFresh = false;
  while (inBounds(cr, cc) && cellAt(board, placements, cr, cc)) {
    const cell = cellAt(board, placements, cr, cc)!;
    scoreCells.push({
      letter: cell.letter,
      isBlank: cell.isBlank,
      r: cr,
      c: cc,
      fresh: !!cell.fresh,
    });
    if (cell.fresh) hasFresh = true;
    cr += dr;
    cc += dc;
  }
  if (scoreCells.length < 2) return null;
  return {
    tiles: scoreCells.map((x) => x.letter),
    hasFresh,
    scoreCells,
  };
}

function scoreWord(
  scoreCells: { letter: string; isBlank: boolean; r: number; c: number; fresh: boolean }[],
  premiumGrid: Premium[][]
): number {
  let wordMult = 1;
  let sum = 0;
  for (const cell of scoreCells) {
    let pts = letterPoints(cell.letter, cell.isBlank);
    if (cell.fresh) {
      const prem = premiumGrid[cell.r][cell.c];
      if (prem === "DL") pts *= 2;
      if (prem === "TL") pts *= 3;
      if (prem === "DW" || prem === "STAR") wordMult *= 2;
      if (prem === "TW") wordMult *= 3;
    }
    sum += pts;
  }
  return sum * wordMult;
}

export type ValidationResult =
  | { ok: true; move: ScoredMove }
  | { ok: false; error: string; invalidWords?: string[] };

export function validateMove(
  board: Board,
  rack: string[],
  placements: Placement[],
  dictionary: Lexicon,
  bingoBonus: number
): ValidationResult {
  if (placements.length === 0) return { ok: false, error: "Nincs lerakott betű." };

  for (const p of placements) {
    if (!inBounds(p.row, p.col)) return { ok: false, error: "Mező a táblán kívül." };
    if (board[p.row][p.col]) return { ok: false, error: "A mező foglalt." };
  }

  const keys = new Set(placements.map((p) => `${p.row},${p.col}`));
  if (keys.size !== placements.length) return { ok: false, error: "Duplikált mező." };

  const dir = detectDirection(board, placements);
  if (!dir) return { ok: false, error: "A betűknek egy sorban vagy oszlopban kell lenniük." };

  if (!contiguousOnLine(board, placements, dir)) {
    return { ok: false, error: "A betűknek folytonosnak kell lenniük." };
  }

  if (!touchesExisting(board, placements)) {
    return { ok: false, error: "Kapcsolódnia kell meglévő betűhöz (első szónál a középhez)." };
  }

  const rackCopy = [...rack];
  for (const p of placements) {
    const want = p.isBlank ? "?" : p.letter;
    const idx = rackCopy.indexOf(want);
    if (idx === -1) return { ok: false, error: `Nincs a tartódban: ${want}` };
    rackCopy.splice(idx, 1);
  }

  const pmap = new Map(placements.map((p) => [`${p.row},${p.col}`, p]));
  const words: string[] = [];
  let total = 0;

  const mainDr = dir === "H" ? 0 : 1;
  const mainDc = dir === "H" ? 1 : 0;
  const main = extractWord(
    board,
    pmap,
    placements[0].row,
    placements[0].col,
    mainDr,
    mainDc
  );
  if (!main) return { ok: false, error: "A fő szónak legalább 2 betűsnek kell lennie." };
  if (!dictionary.hasTiles(main.tiles)) {
    return {
      ok: false,
      error: `Érvénytelen szó: ${tilesToWord(main.tiles)}`,
      invalidWords: [tilesToWord(main.tiles)],
    };
  }
  words.push(tilesToWord(main.tiles));
  total += scoreWord(main.scoreCells, premiums);

  const crossDr = dir === "H" ? 1 : 0;
  const crossDc = dir === "H" ? 0 : 1;
  const invalidWords: string[] = [];
  for (const p of placements) {
    const cross = extractWord(board, pmap, p.row, p.col, crossDr, crossDc);
    if (!cross) continue;
    if (!dictionary.hasTiles(cross.tiles)) {
      invalidWords.push(tilesToWord(cross.tiles));
      continue;
    }
    words.push(tilesToWord(cross.tiles));
    total += scoreWord(cross.scoreCells, premiums);
  }
  if (invalidWords.length) {
    return {
      ok: false,
      error: `Érvénytelen keresztszó: ${invalidWords.join(", ")}`,
      invalidWords,
    };
  }

  if (placements.length === 7) total += bingoBonus;

  return {
    ok: true,
    move: {
      placements: sortPlacements(placements),
      score: total,
      words,
      direction: dir,
    },
  };
}

export function applyPlacements(board: Board, placements: Placement[]): Board {
  const next = board.map((row) => row.map((c) => (c ? { ...c } : null)));
  for (const p of placements) {
    next[p.row][p.col] = { letter: p.letter, isBlank: p.isBlank };
  }
  return next;
}

