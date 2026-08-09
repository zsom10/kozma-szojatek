export const BOARD_SIZE = 15;
export const CENTER = 7;
export const RACK_SIZE = 7;
export const BINGO_BONUS = 50;
export const DEFAULT_TURN_SECONDS = 180;
export const BLANK = "?";

export const DIGRAPHS = ["CS", "GY", "LY", "NY", "SZ", "TY", "ZS"] as const;

export type Premium = "DL" | "TL" | "DW" | "TW" | "STAR" | null;

export type Rules = {
  boardSize: number;
  rackSize: number;
  turnSeconds: number;
  bingoBonus: number;
  blankTiles: number;
  allowProperNouns: boolean;
  maxPlayers: number;
  consecutivePassRoundsToEnd: number;
  endMode: "A" | "B";
  blankRackPenalty: number;
};

export const DEFAULT_RULES: Rules = {
  boardSize: BOARD_SIZE,
  rackSize: RACK_SIZE,
  turnSeconds: DEFAULT_TURN_SECONDS,
  bingoBonus: BINGO_BONUS,
  blankTiles: 2,
  allowProperNouns: false,
  maxPlayers: 4,
  consecutivePassRoundsToEnd: 2,
  endMode: "B",
  blankRackPenalty: 10,
};

export const LETTER_POINTS: Record<string, number> = {
  A: 1,
  Á: 1,
  B: 2,
  C: 5,
  CS: 7,
  D: 2,
  E: 1,
  É: 3,
  F: 4,
  G: 2,
  GY: 4,
  H: 3,
  I: 1,
  Í: 5,
  J: 4,
  K: 1,
  L: 1,
  LY: 8,
  M: 1,
  N: 1,
  NY: 5,
  O: 1,
  Ó: 2,
  Ö: 4,
  Ő: 7,
  P: 4,
  R: 1,
  S: 1,
  SZ: 3,
  T: 1,
  TY: 10,
  U: 4,
  Ú: 7,
  Ü: 4,
  Ű: 7,
  V: 3,
  Z: 4,
  ZS: 8,
  "?": 0,
};

export const LETTER_COUNTS: Record<string, number> = {
  A: 6,
  Á: 4,
  B: 3,
  C: 1,
  CS: 1,
  D: 3,
  E: 6,
  É: 3,
  F: 2,
  G: 3,
  GY: 2,
  H: 2,
  I: 3,
  Í: 1,
  J: 2,
  K: 6,
  L: 4,
  LY: 1,
  M: 3,
  N: 4,
  NY: 1,
  O: 3,
  Ó: 3,
  Ö: 2,
  Ő: 1,
  P: 2,
  R: 4,
  S: 3,
  SZ: 2,
  T: 5,
  TY: 1,
  U: 2,
  Ú: 1,
  Ü: 2,
  Ű: 1,
  V: 2,
  Z: 2,
  ZS: 1,
  "?": 2,
};

export function createPremiumGrid(): Premium[][] {
  const g: Premium[][] = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null)
  );
  const tw = [
    [0, 0],
    [0, 7],
    [0, 14],
    [7, 0],
    [7, 14],
    [14, 0],
    [14, 7],
    [14, 14],
  ];
  const dw = [
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [1, 13],
    [2, 12],
    [3, 11],
    [4, 10],
    [13, 1],
    [12, 2],
    [11, 3],
    [10, 4],
    [13, 13],
    [12, 12],
    [11, 11],
    [10, 10],
  ];
  const dl = [
    [0, 3],
    [0, 11],
    [2, 6],
    [2, 8],
    [3, 0],
    [3, 7],
    [3, 14],
    [6, 2],
    [6, 6],
    [6, 8],
    [6, 12],
    [7, 3],
    [7, 11],
    [8, 2],
    [8, 6],
    [8, 8],
    [8, 12],
    [11, 0],
    [11, 7],
    [11, 14],
    [12, 6],
    [12, 8],
    [14, 3],
    [14, 11],
  ];
  const tl = [
    [1, 5],
    [1, 9],
    [5, 1],
    [5, 5],
    [5, 9],
    [5, 13],
    [9, 1],
    [9, 5],
    [9, 9],
    [9, 13],
    [13, 5],
    [13, 9],
  ];
  for (const [r, c] of tw) g[r][c] = "TW";
  for (const [r, c] of dw) g[r][c] = "DW";
  for (const [r, c] of dl) g[r][c] = "DL";
  for (const [r, c] of tl) g[r][c] = "TL";
  g[CENTER][CENTER] = "STAR";
  return g;
}
