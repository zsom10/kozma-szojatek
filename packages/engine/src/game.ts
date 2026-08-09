import type { Lexicon } from "./lexicon.js";
import {
  applyPlacements,
  createBag,
  drawTiles,
  emptyBoard,
  rackPoints,
  validateMove,
} from "./board.js";
import type {
  EndMode,
  GameState,
  Placement,
  PlayerState,
  PublicGameState,
  ScoredMove,
} from "./types.js";
import {
  DEFAULT_RULES,
  DEFAULT_TURN_SECONDS,
  RACK_SIZE,
  type Rules,
} from "./tiles.js";

export class MoveError extends Error {
  invalidWords: string[];
  constructor(message: string, invalidWords: string[] = []) {
    super(message);
    this.name = "MoveError";
    this.invalidWords = invalidWords;
  }
}

function now(): number {
  return Date.now();
}

function blankPenalty(rules: Rules): number {
  return rules.blankRackPenalty ?? 10;
}

export function createLobby(opts: {
  id: string;
  host: { id: string; name: string };
  turnSeconds?: number;
  endMode?: EndMode;
  tableId?: number;
}): GameState {
  return {
    id: opts.id,
    status: "lobby",
    board: emptyBoard(),
    bag: [],
    players: [
      {
        id: opts.host.id,
        name: opts.host.name,
        rack: [],
        score: 0,
        isBot: false,
        connected: true,
        eliminated: false,
      },
    ],
    currentPlayerIndex: 0,
    turnDeadlineAt: null,
    consecutivePasses: 0,
    moveCount: 0,
    winnerIds: [],
    turnSeconds: opts.turnSeconds ?? DEFAULT_TURN_SECONDS,
    createdAt: now(),
    endMode: opts.endMode ?? "B",
    tableId: opts.tableId,
  };
}

export function addPlayer(
  state: GameState,
  player: {
    id: string;
    name: string;
    isBot?: boolean;
    botDifficulty?: PlayerState["botDifficulty"];
  },
  rules: Rules = DEFAULT_RULES
): GameState {
  if (state.status !== "lobby") throw new Error("A játék már elindult.");
  if (state.players.some((p) => p.id === player.id)) return state;
  if (state.players.length >= rules.maxPlayers) throw new Error("Tele a szoba.");
  return {
    ...state,
    players: [
      ...state.players,
      {
        id: player.id,
        name: player.name,
        rack: [],
        score: 0,
        isBot: !!player.isBot,
        botDifficulty: player.botDifficulty,
        connected: !player.isBot,
        eliminated: false,
      },
    ],
  };
}

export function startGame(state: GameState, seed?: number): GameState {
  if (state.status !== "lobby") throw new Error("Már fut vagy vége.");
  if (state.players.length < 1) throw new Error("Kell legalább egy játékos.");
  let bag = createBag(seed);
  const players = state.players.map((p) => {
    const { drawn, bag: next } = drawTiles(bag, RACK_SIZE);
    bag = next;
    return { ...p, rack: drawn, score: 0, eliminated: false };
  });
  return {
    ...state,
    status: "playing",
    board: emptyBoard(),
    bag,
    players,
    currentPlayerIndex: 0,
    turnDeadlineAt: now() + state.turnSeconds * 1000,
    consecutivePasses: 0,
    moveCount: 0,
    winnerIds: [],
  };
}

function refillRack(player: PlayerState, bag: string[]): { player: PlayerState; bag: string[] } {
  const need = RACK_SIZE - player.rack.length;
  if (need <= 0) return { player, bag };
  const { drawn, bag: next } = drawTiles(bag, need);
  return { player: { ...player, rack: [...player.rack, ...drawn] }, bag: next };
}

function activeIndices(state: GameState): number[] {
  return state.players
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !p.eliminated)
    .map(({ i }) => i);
}

function nextActiveIndex(state: GameState, from: number): number {
  const active = activeIndices(state);
  if (active.length === 0) return from;
  const ordered = [...active.filter((i) => i > from), ...active.filter((i) => i <= from)];
  return ordered[0] ?? from;
}

function advanceTurn(state: GameState, fromIndex: number): GameState {
  const nextIndex = nextActiveIndex(state, fromIndex);
  return {
    ...state,
    currentPlayerIndex: nextIndex,
    turnDeadlineAt: now() + state.turnSeconds * 1000,
  };
}

function deductRack(player: PlayerState, penalty: number): PlayerState {
  const pts = rackPoints(player.rack, penalty);
  return { ...player, score: player.score - pts, rack: [], eliminated: true };
}

function finishGame(state: GameState, players: PlayerState[]): GameState {
  const max = Math.max(...players.map((p) => p.score), 0);
  return {
    ...state,
    status: "finished",
    players,
    turnDeadlineAt: null,
    winnerIds: players.filter((p) => p.score === max).map((p) => p.id),
  };
}

function finalizeModeA(state: GameState, rules: Rules): GameState {
  const penalty = blankPenalty(rules);
  const players = state.players.map((p) => {
    if (p.rack.length === 0) return { ...p, eliminated: true };
    return deductRack(p, penalty);
  });
  return finishGame(state, players);
}

function finalizeModeBIfDone(state: GameState, rules: Rules): GameState {
  const active = state.players.filter((p) => !p.eliminated);
  if (active.length > 0) return state;
  return finishGame(state, state.players.map((p) => ({ ...p })));
}

export function playMove(
  state: GameState,
  playerId: string,
  placements: Placement[],
  dictionary: Lexicon,
  rules: Rules = { ...DEFAULT_RULES, endMode: state.endMode }
): { state: GameState; move: ScoredMove } {
  if (state.status !== "playing") throw new Error("Nincs aktív játszma.");
  const idx = state.currentPlayerIndex;
  const player = state.players[idx];
  if (!player || player.id !== playerId || player.eliminated) {
    throw new Error("Nem a te köröd.");
  }

  if (state.mustPlayBlank && !placements.some((p) => p.isBlank)) {
    throw new Error("A visszacserélt jollyt ebben a körben le kell raknod.");
  }

  const validated = validateMove(
    state.board,
    player.rack,
    placements,
    dictionary,
    rules.bingoBonus
  );
  if (!validated.ok) {
    throw new MoveError(validated.error, validated.invalidWords ?? []);
  }

  let rack = [...player.rack];
  for (const p of placements) {
    const want = p.isBlank ? "?" : p.letter;
    const i = rack.indexOf(want);
    rack.splice(i, 1);
  }

  let bag = state.bag;
  let updatedPlayer: PlayerState = {
    ...player,
    rack,
    score: player.score + validated.move.score,
  };
  ({ player: updatedPlayer, bag } = refillRack(updatedPlayer, bag));

  let players = state.players.map((p, i) => (i === idx ? updatedPlayer : p));
  let next: GameState = {
    ...state,
    board: applyPlacements(state.board, placements),
    bag,
    players,
    consecutivePasses: 0,
    moveCount: state.moveCount + 1,
    mustPlayBlank: false,
    lastMove: {
      playerId: player.id,
      playerName: player.name,
      placements: validated.move.placements,
    },
  };

  const emptied = updatedPlayer.rack.length === 0 && bag.length === 0;
  if (emptied) {
    if (state.endMode === "A") {
      return { state: finalizeModeA(next, rules), move: validated.move };
    }
    players = next.players.map((p, i) =>
      i === idx ? { ...p, eliminated: true } : p
    );
    next = { ...next, players };
    next = finalizeModeBIfDone(next, rules);
    if (next.status === "finished") return { state: next, move: validated.move };
    return { state: advanceTurn(next, idx), move: validated.move };
  }

  return { state: advanceTurn(next, idx), move: validated.move };
}

export function passTurn(
  state: GameState,
  playerId: string,
  rules: Rules = { ...DEFAULT_RULES, endMode: state.endMode }
): GameState {
  if (state.status !== "playing") throw new Error("Nincs aktív játszma.");
  const idx = state.currentPlayerIndex;
  const player = state.players[idx];
  if (!player || player.id !== playerId || player.eliminated) {
    throw new Error("Nem a te köröd.");
  }
  if (state.mustPlayBlank) {
    throw new Error("A visszacserélt jollyt le kell raknod, passzolni nem lehet.");
  }

  let next: GameState = {
    ...state,
    consecutivePasses: state.consecutivePasses + 1,
    moveCount: state.moveCount + 1,
  };
  const activeCount = activeIndices(next).length;
  const roundsNeeded =
    next.bag.length === 0 ? 1 : rules.consecutivePassRoundsToEnd;
  if (next.consecutivePasses >= activeCount * roundsNeeded) {
    const players = next.players.map((p) =>
      p.eliminated ? p : deductRack(p, blankPenalty(rules))
    );
    return finishGame(next, players);
  }
  return advanceTurn(next, idx);
}

export function resignTurn(
  state: GameState,
  playerId: string,
  rules: Rules = { ...DEFAULT_RULES, endMode: state.endMode }
): GameState {
  if (state.status !== "playing") throw new Error("Nincs aktív játszma.");
  if (state.endMode !== "B") {
    throw new Error("Feladás csak folytatásos módban van.");
  }
  const idx = state.currentPlayerIndex;
  const player = state.players[idx];
  if (!player || player.id !== playerId || player.eliminated) {
    throw new Error("Nem a te köröd.");
  }
  const players = state.players.map((p, i) =>
    i === idx ? deductRack(p, blankPenalty(rules)) : p
  );
  let next: GameState = {
    ...state,
    players,
    consecutivePasses: 0,
    moveCount: state.moveCount + 1,
  };
  next = finalizeModeBIfDone(next, rules);
  if (next.status === "finished") return next;
  return advanceTurn(next, idx);
}

export function timeoutPass(state: GameState, rules?: Rules): GameState {
  if (state.status !== "playing" || state.turnDeadlineAt == null) return state;
  if (now() < state.turnDeadlineAt) return state;
  const player = state.players[state.currentPlayerIndex];
  if (!player) return state;
  return passTurn(state, player.id, rules ?? { ...DEFAULT_RULES, endMode: state.endMode });
}

export function swapBlank(
  state: GameState,
  playerId: string,
  row: number,
  col: number
): GameState {
  if (state.status !== "playing") throw new Error("Nincs aktív játszma.");
  const idx = state.currentPlayerIndex;
  const player = state.players[idx];
  if (!player || player.id !== playerId || player.eliminated) {
    throw new Error("Nem a te köröd.");
  }
  const cell = state.board[row]?.[col];
  if (!cell || !cell.isBlank) throw new Error("Itt nincs jolly.");
  const letterIdx = player.rack.indexOf(cell.letter);
  if (letterIdx === -1) {
    throw new Error(`Nincs nálad a valódi betű: ${cell.letter}`);
  }
  const rack = [...player.rack];
  rack.splice(letterIdx, 1);
  rack.push("?");
  const board = state.board.map((r) => r.map((c) => (c ? { ...c } : null)));
  board[row][col] = { letter: cell.letter, isBlank: false };
  const players = state.players.map((p, i) =>
    i === idx ? { ...player, rack } : p
  );
  return {
    ...state,
    board,
    players,
    moveCount: state.moveCount + 1,
    mustPlayBlank: true,
  };
}

export function exchangeTiles(
  state: GameState,
  playerId: string,
  tiles: string[],
  rules: Rules = { ...DEFAULT_RULES, endMode: state.endMode }
): GameState {
  if (state.status !== "playing") throw new Error("Nincs aktív játszma.");
  if (state.mustPlayBlank) {
    throw new Error("A visszacserélt jollyt le kell raknod, cserélni nem lehet.");
  }
  if (state.bag.length < tiles.length) throw new Error("Nincs elég betű a zsákban.");
  const idx = state.currentPlayerIndex;
  const player = state.players[idx];
  if (!player || player.id !== playerId || player.eliminated) {
    throw new Error("Nem a te köröd.");
  }

  let rack = [...player.rack];
  for (const t of tiles) {
    const i = rack.indexOf(t);
    if (i === -1) throw new Error(`Nincs a tartódban: ${t}`);
    rack.splice(i, 1);
  }
  const mixed = [...state.bag, ...tiles];
  for (let i = mixed.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [mixed[i], mixed[j]] = [mixed[j], mixed[i]];
  }
  const { drawn, bag: nextBag } = drawTiles(mixed, tiles.length);
  rack = [...rack, ...drawn];

  const players = state.players.map((p, i) =>
    i === idx ? { ...player, rack } : p
  );
  const next: GameState = {
    ...state,
    bag: nextBag,
    players,
    consecutivePasses: 0,
    moveCount: state.moveCount + 1,
  };
  return advanceTurn(next, idx);
}

export function toPublicState(
  state: GameState,
  viewerId?: string,
  spectate = false
): PublicGameState {
  return {
    id: state.id,
    status: state.status,
    board: state.board,
    currentPlayerIndex: state.currentPlayerIndex,
    turnDeadlineAt: state.turnDeadlineAt,
    consecutivePasses: state.consecutivePasses,
    moveCount: state.moveCount,
    winnerIds: state.winnerIds,
    turnSeconds: state.turnSeconds,
    createdAt: state.createdAt,
    endMode: state.endMode,
    tableId: state.tableId,
    bagCount: state.bag.length,
    lastMove: state.lastMove ?? null,
    mustPlayBlank: !!state.mustPlayBlank,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      isBot: p.isBot,
      botDifficulty: p.botDifficulty,
      connected: p.connected,
      eliminated: p.eliminated,
      rackCount: p.rack.length,
      rack: !spectate && p.id === viewerId ? p.rack : undefined,
    })),
  };
}
