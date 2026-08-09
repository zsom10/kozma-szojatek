export type TileCell = {
  letter: string;
  isBlank: boolean;
  fresh?: boolean;
};

export type Board = (TileCell | null)[][];

export type Placement = {
  row: number;
  col: number;
  letter: string;
  isBlank: boolean;
};

export type Direction = "H" | "V";

export type ScoredMove = {
  placements: Placement[];
  score: number;
  words: string[];
  direction: Direction;
};

export type BotDifficulty = "easy" | "medium" | "hard";

export type PlayerState = {
  id: string;
  name: string;
  rack: string[];
  score: number;
  isBot: boolean;
  botDifficulty?: BotDifficulty;
  connected: boolean;
  eliminated: boolean;
};

export type GameStatus = "lobby" | "playing" | "finished";

export type EndMode = "A" | "B";

export type GameState = {
  id: string;
  status: GameStatus;
  board: Board;
  bag: string[];
  players: PlayerState[];
  currentPlayerIndex: number;
  turnDeadlineAt: number | null;
  consecutivePasses: number;
  moveCount: number;
  winnerIds: string[];
  turnSeconds: number;
  createdAt: number;
  endMode: EndMode;
  tableId?: number;
  lastMove?: {
    playerId: string;
    playerName: string;
    placements: Placement[];
    kind?: "place" | "pass" | "timeout" | "exchange" | "resign";
    score?: number;
  } | null;
  mustPlayBlank?: boolean;
};

export type PublicPlayer = Omit<PlayerState, "rack"> & {
  rackCount: number;
  rack?: string[];
};

export type PublicGameState = Omit<GameState, "bag" | "players"> & {
  bagCount: number;
  players: PublicPlayer[];
};
