import { LETTER_POINTS, createPremiumGrid, type Premium } from "@szorako/engine/browser";
import type { Placement, PublicGameState } from "@szorako/engine/browser";

const premiums = createPremiumGrid();

export type DraftTile = {
  rackIndex: number;
  letter: string;
  isBlank: boolean;
  row: number;
  col: number;
};

export function premiumLabel(p: Premium): string {
  if (p === "TW") return "3×SZÓ";
  if (p === "DW" || p === "STAR") return "2×SZÓ";
  if (p === "TL") return "3×BETŰ";
  if (p === "DL") return "2×BETŰ";
  return "";
}

export function premiumClass(p: Premium): string {
  if (p === "TW") return "tw";
  if (p === "DW" || p === "STAR") return "dw";
  if (p === "TL") return "tl";
  if (p === "DL") return "dl";
  return "";
}

export function formatTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function draftsToPlacements(drafts: DraftTile[]): Placement[] {
  return drafts.map((d) => ({
    row: d.row,
    col: d.col,
    letter: d.letter,
    isBlank: d.isBlank,
  }));
}

export function tilePoints(letter: string, isBlank: boolean): number {
  if (letter === "?" || letter === "") return 0;
  return LETTER_POINTS[letter] ?? 0;
}

export function currentPlayer(state: PublicGameState) {
  return state.players[state.currentPlayerIndex];
}

export { premiums };
