import { nanoid } from "nanoid";
import {
  createLobby,
  addPlayer,
  startGame,
  playMove,
  passTurn,
  timeoutPass,
  swapBlank,
  resignTurn,
  exchangeTiles,
  toPublicState,
  chooseBotMove,
  type GameState,
  type Placement,
  type BotDifficulty,
  type EndMode,
  type Lexicon,
} from "@szorako/engine";
import { recordFinishedGame, saveGameState, addUserWords } from "./db.js";

export type TableSeat = {
  userId: string;
  name: string;
  isBot: boolean;
  botDifficulty?: BotDifficulty;
};

export type WordChallenge = {
  id: string;
  proposerId: string;
  proposerName: string;
  placements: Placement[];
  words: string[];
  voterIds: string[];
  votes: Record<string, "yes" | "no">;
};

export type ChatMessage = {
  id: string;
  userId: string;
  name: string;
  text: string;
  at: number;
};

export type TableInfo = {
  id: number;
  status: "empty" | "lobby" | "playing" | "finished";
  endMode: EndMode;
  turnSeconds: number;
  seats: TableSeat[];
  hostUserId: string | null;
  game: GameState | null;
  spectators: Set<string>;
  challenge: WordChallenge | null;
  chat: ChatMessage[];
  meta: {
    bingos: Record<string, number>;
    passes: Record<string, number>;
    timeouts: Record<string, number>;
    blanks: Record<string, number>;
    bestMove: Record<string, number>;
    longest: Record<string, string>;
  };
};

const tables = new Map<number, TableInfo>();

let tableChangeHandler: ((t: TableInfo) => void) | null = null;

export function onTableChange(handler: (t: TableInfo) => void): void {
  tableChangeHandler = handler;
}

function notifyTable(t: TableInfo): void {
  tableChangeHandler?.(t);
}

function emptyMeta() {
  return {
    bingos: {},
    passes: {},
    timeouts: {},
    blanks: {},
    bestMove: {},
    longest: {},
  };
}

export function initTables(): void {
  for (let i = 1; i <= 5; i++) {
    tables.set(i, {
      id: i,
      status: "empty",
      endMode: "B",
      turnSeconds: 180,
      seats: [],
      hostUserId: null,
      game: null,
      spectators: new Set(),
      challenge: null,
      chat: [],
      meta: emptyMeta(),
    });
  }
}

export function listTables() {
  return [...tables.values()].map((t) => ({
    id: t.id,
    status: t.status,
    endMode: t.endMode,
    turnSeconds: t.turnSeconds,
    hostUserId: t.hostUserId,
    players: t.seats.map((s) => ({
      userId: s.userId,
      name: s.name,
      isBot: s.isBot,
    })),
    spectatorCount: t.spectators.size,
  }));
}

export function getTable(id: number): TableInfo | null {
  return tables.get(id) ?? null;
}

export function joinTable(
  tableId: number,
  user: { id: string; name: string }
): TableInfo {
  const t = tables.get(tableId);
  if (!t) throw new Error("Nincs ilyen asztal.");
  if (t.seats.some((s) => s.userId === user.id)) return t;
  if (t.status === "playing") throw new Error("A meccs már zajlik — nézőként csatlakozz.");
  if (t.seats.filter((s) => !s.isBot).length >= 4) throw new Error("Tele az asztal.");
  if (t.status === "finished") {
    t.seats = [];
    t.game = null;
    t.meta = emptyMeta();
    t.status = "empty";
    t.hostUserId = null;
  }
  t.seats.push({ userId: user.id, name: user.name, isBot: false });
  if (!t.hostUserId) t.hostUserId = user.id;
  t.status = "lobby";
  return t;
}

export function resumeTable(
  tableId: number,
  userId: string
): TableInfo {
  const t = tables.get(tableId);
  if (!t) throw new Error("Nincs ilyen asztal.");
  if (!t.seats.some((s) => s.userId === userId)) {
    throw new Error("Nem ülsz ennél az asztalnál.");
  }
  if (t.status !== "playing" && t.status !== "finished" && t.status !== "lobby") {
    throw new Error("Nincs aktív hely.");
  }
  t.spectators.delete(userId);
  return t;
}

export function leaveTable(tableId: number, userId: string): void {
  const t = tables.get(tableId);
  if (!t) return;
  t.spectators.delete(userId);
  if (t.status === "playing") return;
  t.seats = t.seats.filter((s) => s.userId !== userId);
  if (t.hostUserId === userId) {
    t.hostUserId = t.seats.find((s) => !s.isBot)?.userId ?? null;
  }
  if (t.seats.length === 0) {
    t.status = "empty";
    t.game = null;
    t.hostUserId = null;
  }
}

export function spectateTable(tableId: number, userId: string): TableInfo {
  const t = tables.get(tableId);
  if (!t) throw new Error("Nincs ilyen asztal.");
  if (t.status !== "playing" && t.status !== "finished") {
    throw new Error("Nincs mit nézni.");
  }
  t.spectators.add(userId);
  return t;
}

export function configureTable(
  tableId: number,
  hostId: string,
  opts: { endMode?: EndMode; turnSeconds?: number }
): TableInfo {
  const t = tables.get(tableId);
  if (!t) throw new Error("Nincs ilyen asztal.");
  if (t.hostUserId !== hostId) throw new Error("Csak a hoszt állíthat.");
  if (t.status === "playing") throw new Error("Meccs közben nem.");
  if (opts.endMode) t.endMode = opts.endMode;
  if (opts.turnSeconds) t.turnSeconds = opts.turnSeconds;
  return t;
}

const BOT_FIRST_NAMES = [
  "Laci",
  "Pisti",
  "Gábor",
  "Tamás",
  "Attila",
  "Anna",
  "Eszter",
  "Kata",
  "Zsófi",
  "Réka",
] as const;

function pickBotName(taken: Set<string>): string {
  const free = BOT_FIRST_NAMES.filter((n) => !taken.has(`${n} (Bot)`));
  const pool = free.length > 0 ? free : [...BOT_FIRST_NAMES];
  const first = pool[Math.floor(Math.random() * pool.length)];
  let name = `${first} (Bot)`;
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${first} (Bot) ${n}`)) n += 1;
  return `${first} (Bot) ${n}`;
}

export function addBotToTable(
  tableId: number,
  hostId: string,
  difficulty: BotDifficulty
): TableInfo {
  const t = tables.get(tableId);
  if (!t) throw new Error("Nincs ilyen asztal.");
  if (t.hostUserId !== hostId) throw new Error("Csak a hoszt.");
  if (t.status === "playing") throw new Error("Meccs közben nem.");
  if (t.seats.length >= 4) throw new Error("Tele.");
  const taken = new Set(t.seats.map((s) => s.name));
  t.seats.push({
    userId: `bot-${nanoid(6)}`,
    name: pickBotName(taken),
    isBot: true,
    botDifficulty: difficulty,
  });
  t.status = "lobby";
  return t;
}

export function removeBotFromTable(
  tableId: number,
  hostId: string,
  botUserId: string
): TableInfo {
  const t = tables.get(tableId);
  if (!t) throw new Error("Nincs ilyen asztal.");
  if (t.hostUserId !== hostId) throw new Error("Csak a hoszt.");
  if (t.status === "playing") throw new Error("Meccs közben nem.");
  const seat = t.seats.find((s) => s.userId === botUserId);
  if (!seat?.isBot) throw new Error("Ez nem bot.");
  t.seats = t.seats.filter((s) => s.userId !== botUserId);
  if (t.seats.length === 0) {
    t.status = "empty";
    t.hostUserId = null;
  }
  return t;
}

export function startTable(tableId: number, hostId: string): TableInfo {
  const t = tables.get(tableId);
  if (!t) throw new Error("Nincs ilyen asztal.");
  if (t.hostUserId !== hostId) throw new Error("Csak a hoszt indíthat.");
  if (t.seats.length < 1) throw new Error("Kell játékos.");
  const host = t.seats.find((s) => s.userId === hostId) ?? t.seats[0];
  let game = createLobby({
    id: nanoid(10),
    host: { id: host.userId, name: host.name },
    turnSeconds: t.turnSeconds,
    endMode: t.endMode,
    tableId,
  });
  game.players = [];
  for (const s of t.seats) {
    game = addPlayer(game, {
      id: s.userId,
      name: s.name,
      isBot: s.isBot,
      botDifficulty: s.botDifficulty,
    });
  }
  game = startGame(game);
  t.game = game;
  t.status = "playing";
  t.challenge = null;
  t.chat = [];
  t.meta = emptyMeta();
  saveGameState(game, t.seats.some((s) => s.isBot) && t.seats.filter((s) => !s.isBot).length === 1);
  return t;
}

function humanIds(game: GameState): string[] {
  return game.players.filter((p) => !p.isBot && !p.eliminated).map((p) => p.id);
}

export function countHumans(game: GameState): number {
  return humanIds(game).length;
}

export function proposeChallenge(
  tableId: number,
  userId: string,
  placements: Placement[],
  words: string[]
): TableInfo {
  const t = tables.get(tableId);
  if (!t?.game || t.game.status !== "playing") throw new Error("Nincs meccs.");
  if (t.challenge) throw new Error("Már van függő szavazás.");
  const cur = t.game.players[t.game.currentPlayerIndex];
  if (!cur || cur.id !== userId) throw new Error("Nem a te köröd.");
  const voters = humanIds(t.game).filter((id) => id !== userId);
  if (voters.length === 0) throw new Error("Egyedül nem kell szavazás.");
  const clean = words
    .map((w) => String(w).toLocaleUpperCase("hu").normalize("NFC").trim())
    .filter(Boolean);
  if (!clean.length) throw new Error("Nincs szavazandó szó.");
  t.challenge = {
    id: nanoid(8),
    proposerId: userId,
    proposerName: cur.name,
    placements,
    words: clean,
    voterIds: voters,
    votes: {},
  };
  notifyTable(t);
  return t;
}

export function voteChallenge(
  tableId: number,
  userId: string,
  accept: boolean,
  lexicon: Lexicon
): TableInfo {
  const t = tables.get(tableId);
  if (!t?.game || !t.challenge) throw new Error("Nincs szavazás.");
  const ch = t.challenge;
  if (!ch.voterIds.includes(userId)) throw new Error("Te nem szavazhatsz.");
  if (ch.votes[userId]) throw new Error("Már szavaztál.");
  ch.votes[userId] = accept ? "yes" : "no";
  if (!accept) {
    t.challenge = null;
    notifyTable(t);
    return t;
  }
  const allYes = ch.voterIds.every((id) => ch.votes[id] === "yes");
  if (!allYes) {
    notifyTable(t);
    return t;
  }
  const added = addUserWords(ch.words, ch.proposerId);
  for (const w of added) lexicon.addWord(w);
  for (const w of ch.words) lexicon.addWord(w);
  const placements = ch.placements;
  t.challenge = null;
  return applyPlace(tableId, ch.proposerId, placements, lexicon);
}

export function cancelChallenge(tableId: number, userId: string): TableInfo {
  const t = tables.get(tableId);
  if (!t?.challenge) throw new Error("Nincs szavazás.");
  if (t.challenge.proposerId !== userId && t.hostUserId !== userId) {
    throw new Error("Csak a javasló vagy a hoszt vonhatja vissza.");
  }
  t.challenge = null;
  notifyTable(t);
  return t;
}

export function addChatMessage(tableId: number, userId: string, name: string, text: string): TableInfo {
  const t = tables.get(tableId);
  if (!t) throw new Error("Nincs ilyen asztal.");
  const clean = text.trim().slice(0, 240);
  if (!clean) throw new Error("Üres üzenet.");
  t.chat = [
    ...t.chat.slice(-80),
    { id: nanoid(8), userId, name, text: clean, at: Date.now() },
  ];
  notifyTable(t);
  return t;
}

function bump(
  map: Record<string, number>,
  id: string,
  n = 1
): void {
  map[id] = (map[id] ?? 0) + n;
}

export function applyPlace(
  tableId: number,
  userId: string,
  placements: Placement[],
  lexicon: Lexicon
): TableInfo {
  const t = tables.get(tableId);
  if (!t?.game) throw new Error("Nincs meccs.");
  if (t.challenge) throw new Error("Előbb a szószavazásnak véget kell érnie.");
  const result = playMove(t.game, userId, placements, lexicon);
  t.game = result.state;
  if (result.move.placements.some((p) => p.isBlank)) bump(t.meta.blanks, userId);
  if (result.move.placements.length === 7) bump(t.meta.bingos, userId);
  t.meta.bestMove[userId] = Math.max(
    t.meta.bestMove[userId] ?? 0,
    result.move.score
  );
  for (const w of result.move.words) {
    if ((t.meta.longest[userId] ?? "").length < w.length) t.meta.longest[userId] = w;
  }
  afterGameUpdate(t);
  return t;
}

export function applyPass(
  tableId: number,
  userId: string,
  opts?: { exchangeAll?: boolean }
): TableInfo {
  const t = tables.get(tableId);
  if (!t?.game) throw new Error("Nincs meccs.");
  if (t.challenge) throw new Error("Előbb a szószavazásnak véget kell érnie.");
  if (opts?.exchangeAll) {
    const player = t.game.players[t.game.currentPlayerIndex];
    if (!player || player.id !== userId) throw new Error("Nem a te köröd.");
    if (t.game.bag.length < player.rack.length) {
      throw new Error("Nincs elég betű a zsákban a cseréhez.");
    }
    bump(t.meta.passes, userId);
    t.game = exchangeTiles(t.game, userId, [...player.rack]);
    afterGameUpdate(t);
    return t;
  }
  bump(t.meta.passes, userId);
  t.game = passTurn(t.game, userId);
  afterGameUpdate(t);
  return t;
}

export function applyResign(tableId: number, userId: string): TableInfo {
  const t = tables.get(tableId);
  if (!t?.game) throw new Error("Nincs meccs.");
  if (t.challenge) throw new Error("Előbb a szószavazásnak véget kell érnie.");
  bump(t.meta.passes, userId);
  t.game = resignTurn(t.game, userId);
  afterGameUpdate(t);
  return t;
}

export function applySwap(
  tableId: number,
  userId: string,
  row: number,
  col: number
): TableInfo {
  const t = tables.get(tableId);
  if (!t?.game) throw new Error("Nincs meccs.");
  if (t.challenge) throw new Error("Előbb a szószavazásnak véget kell érnie.");
  t.game = swapBlank(t.game, userId, row, col);
  afterGameUpdate(t);
  return t;
}

export function tickTimeouts(lexicon: Lexicon): number[] {
  const changed: number[] = [];
  for (const t of tables.values()) {
    try {
      if (!t.game || t.game.status !== "playing") continue;
      const before = t.game.moveCount;
      const player = t.game.players[t.game.currentPlayerIndex];
      const next = timeoutPass(t.game);
      if (next.moveCount !== before) {
        if (player) bump(t.meta.timeouts, player.id);
        t.game = next;
        afterGameUpdate(t);
        changed.push(t.id);
        maybeBot(t, lexicon);
      }
    } catch (err) {
      console.error("tickTimeouts hiba:", err);
    }
  }
  return changed;
}

export function maybeBot(t: TableInfo, lexicon: Lexicon): void {
  if (!t.game || t.game.status !== "playing") return;
  const cur = t.game.players[t.game.currentPlayerIndex];
  if (!cur?.isBot || cur.eliminated) return;
  setTimeout(() => {
    try {
      const table = tables.get(t.id);
      if (!table?.game || table.game.status !== "playing") return;
      const bot = table.game.players[table.game.currentPlayerIndex];
      if (!bot?.isBot || bot.id !== cur.id) return;
      const move = chooseBotMove(
        table.game.board,
        bot.rack,
        lexicon,
        bot.botDifficulty ?? "medium"
      );
      try {
        if (move) applyPlace(table.id, bot.id, move.placements, lexicon);
        else applyPass(table.id, bot.id);
      } catch {
        if (table.game?.status === "playing") {
          try {
            applyPass(table.id, bot.id);
          } catch {
            return;
          }
        } else {
          return;
        }
      }
      maybeBot(table, lexicon);
    } catch (err) {
      console.error("maybeBot hiba:", err);
    }
  }, 600);
}

function afterGameUpdate(t: TableInfo): void {
  if (!t.game) return;
  const vsAi =
    t.game.players.some((p) => p.isBot) &&
    t.game.players.filter((p) => !p.isBot).length === 1;
  saveGameState(t.game, vsAi);
  if (t.game.status === "finished") {
    t.status = "finished";
    recordFinishedGame({
      game: t.game,
      vsAi,
      bingosByUser: t.meta.bingos,
      passesByUser: t.meta.passes,
      timeoutsByUser: t.meta.timeouts,
      blankUsesByUser: t.meta.blanks,
      bestMoveByUser: t.meta.bestMove,
      longestWordByUser: t.meta.longest,
    });
  }
  notifyTable(t);
}

export function publicTableState(t: TableInfo, viewerId?: string, spectate = false) {
  return {
    table: {
      id: t.id,
      status: t.status,
      endMode: t.endMode,
      turnSeconds: t.turnSeconds,
      hostUserId: t.hostUserId,
      seats: t.seats,
      spectatorCount: t.spectators.size,
      challenge: t.challenge,
      chat: t.chat,
      humanCount: t.game ? countHumans(t.game) : t.seats.filter((s) => !s.isBot).length,
    },
    game: t.game ? toPublicState(t.game, viewerId, spectate) : null,
  };
}
