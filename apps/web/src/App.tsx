import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BotDifficulty,
  EndMode,
  PublicGameState,
} from "@szorako/engine/browser";
import { DIGRAPHS } from "@szorako/engine/browser";
import {
  currentPlayer,
  draftsToPlacements,
  formatTime,
  premiumClass,
  premiumLabel,
  premiums,
  tilePoints,
  type DraftTile,
} from "./gameUi";
import { ConfettiBurst, TurnBanner, VoteBanner, DrawRevealOverlay } from "./fx";

type Screen = "auth" | "lobby" | "table" | "account" | "leaderboard" | "settings" | "people" | "admin";
type UiScale = "normal" | "large" | "xlarge" | "xxlarge";
const BOARD_SCALE_KEY = "kozma.boardScale";
const SCALE_STEPS: { id: UiScale; label: string }[] = [
  { id: "normal", label: "Kicsi" },
  { id: "large", label: "Közepes" },
  { id: "xlarge", label: "Nagy" },
  { id: "xxlarge", label: "Hatalmas" },
];

type AuthUser = { id: string; name: string; uiScale: UiScale; isAdmin?: boolean };

function lastMoveText(lm: {
  playerName: string;
  kind?: string;
  score?: number;
}): string {
  if (lm.kind === "timeout") return `${lm.playerName} (kicsúszott az időből)`;
  if (lm.kind === "pass" || lm.kind === "exchange") return `${lm.playerName} (passzolt)`;
  if (lm.kind === "resign") return `${lm.playerName} (feladta)`;
  if (lm.kind === "place") return `${lm.playerName} (+${lm.score ?? 0} pont)`;
  if (lm.score != null) return `${lm.playerName} (+${lm.score} pont)`;
  return lm.playerName;
}

type WordChallenge = {
  id: string;
  proposerId: string;
  proposerName: string;
  placements: { row: number; col: number; letter: string; isBlank: boolean }[];
  words: string[];
  voterIds: string[];
  votes: Record<string, "yes" | "no">;
};

type ChatMessage = {
  id: string;
  userId: string;
  name: string;
  text: string;
  at: number;
};

type PresencePerson = {
  userId: string;
  name: string;
  available: boolean;
  tableId: number | null;
};

type InviteInfo = {
  fromId: string;
  fromName: string;
  tableId: number;
  at: number;
};

type TableSummary = {
  id: number;
  status: string;
  endMode: EndMode;
  turnSeconds: number;
  hostUserId: string | null;
  players: { userId: string; name: string; isBot: boolean }[];
  spectatorCount: number;
};

type TableSeat = {
  userId: string;
  name: string;
  isBot: boolean;
  botDifficulty?: BotDifficulty;
};

type Curiosity = { key: string; label: string; value: unknown };
type HistoryRow = {
  id: string;
  vs_ai: number;
  finished_at: number | null;
  end_mode: string;
  score: number;
  won: number;
  opponents: string | null;
};

const SESSION_KEY = "kozma.session";
const SCALE_KEY = "kozma.uiScale";

function wsUrl(token: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`;
}

function apiBase(): string {
  return "";
}

function loadAuth(): { token: string; user: AuthUser } | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.user?.id || !parsed?.user?.name) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function saveAuth(token: string, user: AuthUser) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token, user }));
}

function clearAuth() {
  localStorage.removeItem(SESSION_KEY);
}

function blankChoices(): string[] {
  const singles = "AÁBCDEÉFGHIÍJKLMNOÓÖŐPQRSTUÚÜŰVWXYZ".split("");
  return [...singles, ...DIGRAPHS];
}

function endModeLabel(mode: EndMode): string {
  return mode === "A" ? "Klasszikus" : "Folytatásos";
}

function endModeHint(mode: EndMode): string {
  return mode === "A"
    ? "Az első tartókiürítéskor vége a partinak."
    : "Aki kiüríti a tartóját vagy felad, kiesik; a többiek játszanak tovább. A Passz csak kihagyja a kört.";
}

export function App() {
  const [auth, setAuth] = useState(loadAuth);
  const [screen, setScreen] = useState<Screen>(auth ? "lobby" : "auth");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [nameInput, setNameInput] = useState("");
  const [passInput, setPassInput] = useState("");
  const [ready, setReady] = useState(false);
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [tableMeta, setTableMeta] = useState<{
    id: number;
    status: string;
    endMode: EndMode;
    turnSeconds: number;
    hostUserId: string | null;
    seats: TableSeat[];
    spectatorCount: number;
    challenge?: WordChallenge | null;
    chat?: ChatMessage[];
    humanCount?: number;
    drawReveal?: {
      draws: { userId: string; name: string; letter: string }[];
      order: string[];
      until: number;
    } | null;
  } | null>(null);
  const [state, setState] = useState<PublicGameState | null>(null);
  const [spectating, setSpectating] = useState(false);
  const [error, setError] = useState("");
  const [invalidWords, setInvalidWords] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<BotDifficulty>("medium");
  const [selectedRack, setSelectedRack] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<DraftTile[]>([]);
  const [blankLetter, setBlankLetter] = useState("A");
  const [now, setNow] = useState(Date.now());
  const [version, setVersion] = useState("1.0.0");
  const [uiScale, setUiScale] = useState<UiScale>(() => {
    const raw = (localStorage.getItem(SCALE_KEY) ||
      localStorage.getItem(BOARD_SCALE_KEY) ||
      auth?.user.uiScale ||
      "large") as UiScale;
    return SCALE_STEPS.some((s) => s.id === raw) ? raw : "large";
  });
  const [lbTab, setLbTab] = useState<"score" | "pvp" | "bestMove">("score");
  const [leaderboard, setLeaderboard] = useState<{
    byScore: Record<string, unknown>[];
    byPvp: Record<string, unknown>[];
    byBestMove: Record<string, unknown>[];
  }>({ byScore: [], byPvp: [], byBestMove: [] });
  const [profile, setProfile] = useState<{
    curiosities: Curiosity[];
    history: HistoryRow[];
    isAdmin?: boolean;
  } | null>(null);
  const [adminStats, setAdminStats] = useState<{
    overview: Record<string, number>;
    users: Record<string, unknown>[];
    recentGames: Record<string, unknown>[];
    words: Record<string, unknown>[];
    topPlayers: Record<string, unknown>[];
    wordsByUser: Record<string, unknown>[];
  } | null>(null);
  const [dragRack, setDragRack] = useState<number | null>(null);
  const [swapMode, setSwapMode] = useState(false);
  const [busy, setBusy] = useState("");
  const [activeTableId, setActiveTableId] = useState<number | null>(null);
  const [people, setPeople] = useState<PresencePerson[]>([]);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [chatText, setChatText] = useState("");
  const [iAmAvailable, setIAmAvailable] = useState(true);
  const [adminName, setAdminName] = useState("");
  const [adminPass, setAdminPass] = useState("");
  const [adminMakeAdmin, setAdminMakeAdmin] = useState(false);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPass, setEditPass] = useState("");
  const boardRef = useRef<HTMLDivElement>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  function applyIncomingGame(
    prev: PublicGameState | null,
    next: PublicGameState | null
  ): PublicGameState | null {
    if (!next) return null;
    if (prev && next.moveCount < prev.moveCount) return prev;
    if (prev && next.moveCount === prev.moveCount) {
      const prevKey = [
        prev.mustPlayBlank ? 1 : 0,
        prev.currentPlayerIndex,
        prev.players.map((p) => `${p.id}:${p.rackCount}:${(p.rack ?? []).join(",")}`).join("|"),
        prev.board
          .flatMap((row, r) =>
            row.flatMap((c, col) => (c?.isBlank ? [`${r},${col},${c.letter}`] : []))
          )
          .join(";"),
      ].join("#");
      const nextKey = [
        next.mustPlayBlank ? 1 : 0,
        next.currentPlayerIndex,
        next.players.map((p) => `${p.id}:${p.rackCount}:${(p.rack ?? []).join(",")}`).join("|"),
        next.board
          .flatMap((row, r) =>
            row.flatMap((c, col) => (c?.isBlank ? [`${r},${col},${c.letter}`] : []))
          )
          .join(";"),
      ].join("#");
      if (prevKey === nextKey) return prev;
    }
    return next;
  }

  const token = auth?.token;
  const user = auth?.user;

  useEffect(() => {
    document.documentElement.dataset.scale = uiScale;
    localStorage.setItem(SCALE_KEY, uiScale);
  }, [uiScale]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(`${apiBase()}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init?.headers ?? {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.error || "Hiba") as Error & {
          invalidWords?: string[];
        };
        if (Array.isArray(data.invalidWords)) err.invalidWords = data.invalidWords;
        throw err;
      }
      return data;
    },
    [token]
  );

  const refreshTables = useCallback(async () => {
    try {
      const data = await api("/api/tables");
      setTables(data.tables ?? []);
      if (data.version) setVersion(data.version);
    } catch {
      /* ignore */
    }
  }, [api]);

  const refreshLeaderboard = useCallback(async () => {
    try {
      const data = await api("/api/leaderboard");
      setLeaderboard(data);
    } catch {
      /* ignore */
    }
  }, [api]);

  const refreshProfile = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api("/api/me");
      const isAdmin = !!data.isAdmin;
      setProfile({
        curiosities: data.curiosities ?? [],
        history: data.history ?? [],
        isAdmin,
      });
      if (data.user?.uiScale) setUiScale(data.user.uiScale);
      setAuth((prev) => {
        if (!prev) return prev;
        if (prev.user.isAdmin === isAdmin) return prev;
        const next = {
          ...prev,
          user: { ...prev.user, isAdmin },
        };
        saveAuth(next.token, next.user);
        return next;
      });
    } catch {
      /* ignore */
    }
  }, [api, token]);

  const refreshAdmin = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api("/api/admin/stats");
      setAdminStats(data);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, token]);

  async function doAuth() {
    setError("");
    try {
      const path = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const data = await api(path, {
        method: "POST",
        body: JSON.stringify({ name: nameInput, password: passInput }),
      });
      const nextUser: AuthUser = {
        id: data.user.id,
        name: data.user.name,
        uiScale: data.user.uiScale || "normal",
        isAdmin: !!data.user.isAdmin,
      };
      saveAuth(data.token, nextUser);
      setAuth({ token: data.token, user: nextUser });
      setUiScale(nextUser.uiScale);
      setVersion(data.version ?? "1.0.0");
      setScreen("lobby");
      setPassInput("");
      setProfile((p) => ({
        curiosities: p?.curiosities ?? [],
        history: p?.history ?? [],
        isAdmin: !!data.user.isAdmin,
      }));
      queueMicrotask(() => {
        void refreshProfile();
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function logout() {
    clearAuth();
    setAuth(null);
    setReady(false);
    setScreen("auth");
    setState(null);
    setTableMeta(null);
  }

  useEffect(() => {
    if (!token) return;
    const socket = new WebSocket(wsUrl(token));
    wsRef.current = socket;
    socket.onopen = () => setReady(true);
    socket.onclose = () => {
      setReady(false);
      if (wsRef.current === socket) wsRef.current = null;
    };
    socket.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "hello") {
        if (msg.version) setVersion(msg.version);
        socket.send(JSON.stringify({ type: "list" }));
        return;
      }
      if (msg.type === "tables") {
        setTables(msg.tables ?? []);
        return;
      }
      if (msg.type === "presence") {
        setPeople(Array.isArray(msg.people) ? msg.people : []);
        return;
      }
      if (msg.type === "invite") {
        setInvite(msg.invite ?? null);
        return;
      }
      if (msg.type === "state") {
        if (msg.table) {
          setTableMeta(msg.table);
          setActiveTableId(msg.table.id);
        }
        const next = msg.game ?? null;
        setState((prev) => {
          const applied = applyIncomingGame(prev, next);
          if (applied && prev && applied.moveCount !== prev.moveCount) {
            queueMicrotask(() => {
              setDrafts([]);
              setSelectedRack(null);
              setInvalidWords([]);
              setSwapMode(false);
            });
          }
          return applied;
        });
        setError("");
        if (msg.game?.status === "finished") {
          refreshLeaderboard();
          refreshProfile();
        }
        return;
      }
      if (msg.type === "error") {
        setError(msg.error ?? "Hiba");
        setInvalidWords(Array.isArray(msg.invalidWords) ? msg.invalidWords : []);
      }
    };
    return () => {
      socket.close();
      if (wsRef.current === socket) wsRef.current = null;
    };
  }, [token, refreshLeaderboard, refreshProfile]);

  useEffect(() => {
    if (token) void refreshProfile();
  }, [token, refreshProfile]);

  useEffect(() => {
    if (screen !== "people" || !token) return;
    const ping = () => {
      const socket = wsRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "presence" }));
      }
    };
    ping();
    const id = window.setInterval(ping, 6000);
    return () => clearInterval(id);
  }, [screen, token, ready]);

  useEffect(() => {
    const el = chatLogRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [tableMeta?.chat]);

  useEffect(() => {
    if (screen === "lobby") refreshTables();
    if (screen === "leaderboard") refreshLeaderboard();
    if (screen === "account") refreshProfile();
    if (screen === "admin") {
      void refreshProfile();
      void refreshAdmin();
    }
  }, [screen, refreshTables, refreshLeaderboard, refreshProfile, refreshAdmin]);

  useEffect(() => {
    if (screen !== "table" || activeTableId == null) return;
    if (state?.status !== "playing" && tableMeta?.status !== "playing") return;
    let dead = false;
    const tick = async () => {
      try {
        const data = await api(`/api/tables/${activeTableId}`);
        if (dead || !data.game) return;
        setTableMeta(data.table);
        setState((prev: PublicGameState | null) => {
          const applied = applyIncomingGame(prev, data.game);
          if (applied && prev && applied.moveCount !== prev.moveCount) {
            queueMicrotask(() => {
              setDrafts([]);
              setSelectedRack(null);
              setSwapMode(false);
            });
          }
          return applied;
        });
      } catch {
        /* ignore */
      }
    };
    const id = setInterval(tick, 1200);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [screen, activeTableId, state?.status, tableMeta?.status, api]);

  const me = state?.players.find((p) => p.id === user?.id);
  const myRack = me?.rack ?? [];
  const usedRack = new Set(drafts.map((d) => d.rackIndex));
  const isMyTurn =
    !!state &&
    !spectating &&
    state.status === "playing" &&
    currentPlayer(state)?.id === user?.id &&
    !currentPlayer(state)?.eliminated;

  const iWon =
    !!state &&
    state.status === "finished" &&
    !!user &&
    state.winnerIds.includes(user.id);

  const remainingMs = useMemo(() => {
    if (!state?.turnDeadlineAt) return 0;
    return state.turnDeadlineAt - now;
  }, [state?.turnDeadlineAt, now]);

  function send(payload: Record<string, unknown>) {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("Nincs élő kapcsolat — próbáld újra, vagy frissítsd az oldalt.");
      return;
    }
    socket.send(JSON.stringify(payload));
  }

  function applyTablePayload(
    data: { table?: NonNullable<typeof tableMeta>; game?: PublicGameState | null },
    asSpectator: boolean
  ) {
    if (!data.table) {
      setError("Érvénytelen szerverválasz.");
      return;
    }
    setSpectating(asSpectator);
    setTableMeta(data.table);
    setState(data.game ?? null);
    setActiveTableId(data.table.id);
    setScreen("table");
    setError("");
    setInvalidWords([]);
    setDrafts([]);
    setSelectedRack(null);
  }

  function wsAttach(type: "join" | "spectate" | "resume", tableId: number) {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type, tableId }));
    }
  }

  async function joinTableClick(tableId: number) {
    if (!token) {
      setError("Előbb jelentkezz be.");
      setScreen("auth");
      return;
    }
    setBusy(`join-${tableId}`);
    setError("");
    try {
      const data = await api(`/api/tables/${tableId}/join`, { method: "POST" });
      applyTablePayload(data, false);
      wsAttach("join", tableId);
    } catch (e) {
      setError((e as Error).message || "Csatlakozás sikertelen.");
    } finally {
      setBusy("");
    }
  }

  async function resumeTableClick(tableId: number) {
    if (!token) {
      setError("Előbb jelentkezz be.");
      setScreen("auth");
      return;
    }
    setBusy(`resume-${tableId}`);
    setError("");
    try {
      const data = await api(`/api/tables/${tableId}/resume`, { method: "POST" });
      applyTablePayload(data, false);
      wsAttach("resume", tableId);
    } catch (e) {
      setError((e as Error).message || "Visszatérés sikertelen.");
    } finally {
      setBusy("");
    }
  }

  async function spectateTableClick(tableId: number) {
    if (!token) {
      setError("Előbb jelentkezz be.");
      setScreen("auth");
      return;
    }
    setBusy(`spec-${tableId}`);
    setError("");
    try {
      const data = await api(`/api/tables/${tableId}/spectate`, { method: "POST" });
      applyTablePayload(data, true);
      wsAttach("spectate", tableId);
    } catch (e) {
      setError((e as Error).message || "Nézés sikertelen.");
    } finally {
      setBusy("");
    }
  }

  async function leaveTableClick() {
    if (!tableMeta) return;
    const playing = tableMeta.status === "playing" || state?.status === "playing";
    if (playing) {
      if (
        !confirm(
          "Kilépsz a meccsből? Ez feladásként számít, és a többiek folytatják nélküled."
        )
      ) {
        return;
      }
    }
    setBusy("leave");
    try {
      await api(`/api/tables/${tableMeta.id}/leave`, { method: "POST" });
    } catch {
      /* local leave anyway */
    }
    send({ type: "leave" });
    setScreen("lobby");
    setState(null);
    setTableMeta(null);
    setActiveTableId(null);
    setSpectating(false);
    setBusy("");
    refreshTables();
  }

  async function resetTableClick() {
    if (!tableMeta) return;
    if (!confirm("Asztal reset: meccs és szavazás törlése, tiszta váró?")) return;
    setBusy("reset");
    try {
      const data = await api(`/api/tables/${tableMeta.id}/reset`, { method: "POST" });
      applyTablePayload(data, false);
      wsAttach("join", tableMeta.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function submitPlace() {
    if (!tableMeta || drafts.length === 0) return;
    setError("");
    setInvalidWords([]);
    try {
      const data = await api(`/api/tables/${tableMeta.id}/place`, {
        method: "POST",
        body: JSON.stringify({ placements: draftsToPlacements(drafts) }),
      });
      applyTablePayload(data, false);
      wsAttach("resume", tableMeta.id);
    } catch (e) {
      const err = e as Error & { invalidWords?: string[] };
      setError(err.message);
      if (Array.isArray(err.invalidWords)) setInvalidWords(err.invalidWords);
    }
  }

  async function submitPass() {
    if (!tableMeta || !state) return;
    const mePlayer = state.players.find((p) => p.id === user?.id);
    const rackLen = mePlayer?.rackCount || myRack.length;
    const canExchange = state.bagCount > 0 && state.bagCount >= rackLen;
    let exchangeAll = false;
    if (state.bagCount === 0) {
      if (!confirm("Passzolsz? (A zsák üres, betűt cserélni nem lehet.)")) return;
    } else if (canExchange) {
      exchangeAll = confirm(
        "Passzolsz.\n\nKicseréljem az összes betűdet a zsákból? (OK = csere, Mégse = csak passz)"
      );
    } else if (!confirm("Passzolsz? (Nincs elég betű a zsákban a teljes cseréhez.)")) {
      return;
    }
    try {
      const data = await api(`/api/tables/${tableMeta.id}/pass`, {
        method: "POST",
        body: JSON.stringify({ exchangeAll }),
      });
      applyTablePayload(data, false);
      wsAttach("resume", tableMeta.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submitResign() {
    if (!tableMeta) return;
    if (!confirm("Feladod a partit? A megmaradt betűid pontja levonódik, és kiestél.")) {
      return;
    }
    try {
      const data = await api(`/api/tables/${tableMeta.id}/resign`, { method: "POST" });
      applyTablePayload(data, false);
      wsAttach("resume", tableMeta.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function configTable(patch: { endMode?: EndMode; turnSeconds?: number }) {
    if (!tableMeta) return;
    try {
      const data = await api(`/api/tables/${tableMeta.id}/config`, {
        method: "POST",
        body: JSON.stringify(patch),
      });
      applyTablePayload(data, spectating);
      wsAttach("join", tableMeta.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addBotClick() {
    if (!tableMeta) return;
    setBusy("bot");
    try {
      const data = await api(`/api/tables/${tableMeta.id}/bot`, {
        method: "POST",
        body: JSON.stringify({ difficulty }),
      });
      applyTablePayload(data, false);
      wsAttach("join", tableMeta.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function removeBotClick(botUserId: string) {
    if (!tableMeta) return;
    setBusy(`rm-${botUserId}`);
    try {
      const data = await api(`/api/tables/${tableMeta.id}/bot/remove`, {
        method: "POST",
        body: JSON.stringify({ botUserId }),
      });
      applyTablePayload(data, false);
      wsAttach("resume", tableMeta.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function saveScale(scale: UiScale) {
    setUiScale(scale);
    try {
      await api("/api/me/ui-scale", {
        method: "POST",
        body: JSON.stringify({ scale }),
      });
    } catch {
      /* local ok */
    }
  }

  async function startTableClick() {
    if (!tableMeta) return;
    setBusy("start");
    try {
      const data = await api(`/api/tables/${tableMeta.id}/start`, {
        method: "POST",
      });
      applyTablePayload(data, false);
      wsAttach("resume", tableMeta.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  function placeOnCell(row: number, col: number, rackIndex: number) {
    if (!isMyTurn || !state) return;
    if (state.board[row][col]) return;
    if (drafts.some((d) => d.row === row && d.col === col)) return;
    if (usedRack.has(rackIndex)) return;
    const letterRaw = myRack[rackIndex];
    if (!letterRaw) return;
    const isBlank = letterRaw === "?";
    const letter = isBlank
      ? blankLetter.toLocaleUpperCase("hu").normalize("NFC")
      : letterRaw.toLocaleUpperCase("hu").normalize("NFC");
    setDrafts((d) => [...d, { rackIndex, letter, isBlank, row, col }]);
    setSelectedRack(null);
    setError("");
    setInvalidWords([]);
  }

  async function doSwapBlank(row: number, col: number) {
    if (!tableMeta || !state) return;
    setBusy("swap");
    try {
      const data = await api(`/api/tables/${tableMeta.id}/swap-blank`, {
        method: "POST",
        body: JSON.stringify({ row, col }),
      });
      applyTablePayload(data, false);
      wsAttach("resume", tableMeta.id);
      setSwapMode(false);
      setSelectedRack(null);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  function onCellClick(row: number, col: number) {
    if (!isMyTurn || !state || !tableMeta) return;
    const cell = state.board[row][col];
    if (cell?.isBlank) {
      const want = cell.letter.toLocaleUpperCase("hu").normalize("NFC");
      const have = myRack.some(
        (t) => t !== "?" && t.toLocaleUpperCase("hu").normalize("NFC") === want
      );
      if (have) {
        void doSwapBlank(row, col);
        return;
      }
      setError(`Nincs nálad a valódi betű (${cell.letter}), ezért nem cserélheted a jollyt.`);
      return;
    }
    if (swapMode) {
      setError("A csíkozott, J jelű jolly zsetonra kattints a táblán.");
      return;
    }
    const existing = state.board[row][col];
    if (existing) return;
    const draftHere = drafts.find((d) => d.row === row && d.col === col);
    if (draftHere) {
      setDrafts((d) => d.filter((x) => !(x.row === row && x.col === col)));
      return;
    }
    if (selectedRack == null) return;
    placeOnCell(row, col, selectedRack);
  }

  useEffect(() => {
    if (screen !== "table" || !isMyTurn) return;
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const used = new Set(drafts.map((d) => d.rackIndex));
      if (e.key >= "1" && e.key <= "7") {
        const idx = Number(e.key) - 1;
        if (idx < myRack.length && !used.has(idx)) {
          setSelectedRack(idx);
        }
        return;
      }
      if (e.key === "Escape") {
        setDrafts([]);
        setSelectedRack(null);
        setSwapMode(false);
        return;
      }
      if (e.key === "Enter" && drafts.length > 0) {
        e.preventDefault();
        void submitPlace();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, isMyTurn, myRack.length, drafts, tableMeta?.id]);

  async function acceptWords() {
    if (!tableMeta) return;
    const humans = tableMeta.humanCount ?? 1;
    try {
      if (humans <= 1) {
        await api("/api/words", {
          method: "POST",
          body: JSON.stringify({ words: invalidWords, tableId: tableMeta.id }),
        });
        await submitPlace();
        return;
      }
      const data = await api(`/api/tables/${tableMeta.id}/challenge`, {
        method: "POST",
        body: JSON.stringify({
          placements: draftsToPlacements(drafts),
          words: invalidWords,
        }),
      });
      applyTablePayload(data, false);
      setInvalidWords([]);
      setError("Szavazásra küldve — a többieknek el kell fogadniuk.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function voteWord(accept: boolean) {
    if (!tableMeta) return;
    try {
      const data = await api(`/api/tables/${tableMeta.id}/challenge/vote`, {
        method: "POST",
        body: JSON.stringify({ accept }),
      });
      applyTablePayload(data, spectating);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function sendChat() {
    if (!tableMeta || !chatText.trim()) return;
    const text = chatText.trim();
    setChatText("");
    try {
      const data = await api(`/api/tables/${tableMeta.id}/chat`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      applyTablePayload(data, spectating);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!auth || screen === "auth") {
    return (
      <div className="app shell">
        <header className="hero">
          <h1 className="brand">Kozma Szójáték</h1>
          <p className="tagline">Családi magyar szókirakós — fiókkal, asztalokkal, ranglistával.</p>
        </header>
        <section className="panel auth-panel">
          <div className="tabs">
            <button
              className={authMode === "login" ? "" : "secondary"}
              type="button"
              onClick={() => setAuthMode("login")}
            >
              Belépés
            </button>
            <button
              className={authMode === "register" ? "" : "secondary"}
              type="button"
              onClick={() => setAuthMode("register")}
            >
              Regisztráció
            </button>
          </div>
          <div className="field">
            <label>Név</label>
            <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} autoComplete="username" />
          </div>
          <div className="field">
            <label>Jelszó</label>
            <input
              type="password"
              value={passInput}
              onChange={(e) => setPassInput(e.target.value)}
              autoComplete={authMode === "login" ? "current-password" : "new-password"}
            />
          </div>
          <button type="button" onClick={doAuth}>
            {authMode === "login" ? "Belépés" : "Fiók létrehozása"}
          </button>
          {error && <p className="error">{error}</p>}
        </section>
        <footer className="footer">v{version}</footer>
      </div>
    );
  }

  return (
    <div className={`app shell ${screen === "table" ? "on-table" : ""}`}>
      <header className="topbar">
        <div>
          <h1 className="brand brand-sm">Kozma Szójáték</h1>
          <p className="meta">{user?.name}{ready ? "" : " · kapcsolat…"}</p>
        </div>
        <nav className="nav">
          <button className="secondary" type="button" onClick={() => setScreen("lobby")}>
            Asztalok
          </button>
          <button className="secondary" type="button" onClick={() => setScreen("people")}>
            Elérhető{invite ? " !" : ""}
          </button>
          <button className="secondary nav-extra" type="button" onClick={() => setScreen("account")}>
            Fiókom
          </button>
          <button className="secondary nav-extra" type="button" onClick={() => setScreen("leaderboard")}>
            Ranglista
          </button>
          <button className="secondary nav-extra" type="button" onClick={() => setScreen("settings")}>
            Beállítások
          </button>
          {(user?.isAdmin || profile?.isAdmin) && (
            <button className="secondary" type="button" onClick={() => setScreen("admin")}>
              Admin
            </button>
          )}
          <button className="secondary" type="button" onClick={logout}>
            Kilépés
          </button>
        </nav>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {invite && (
        <div className="invite-banner" role="status">
          <span>
            <strong>{invite.fromName}</strong> meghívott az {invite.tableId}. asztalra.
          </span>
          <div className="actions">
            <button
              type="button"
              onClick={() => {
                void joinTableClick(invite.tableId);
                setInvite(null);
                send({ type: "inviteDismiss" });
              }}
            >
              Csatlakozom
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => {
                setInvite(null);
                send({ type: "inviteDismiss" });
              }}
            >
              Később
            </button>
          </div>
        </div>
      )}

      {screen === "people" && (
        <section className="panel">
          <h2 className="panel-title">Ki elérhető?</h2>
          <div className="actions" style={{ marginBottom: "0.8rem" }}>
            <button
              type="button"
              className={iAmAvailable ? "" : "secondary"}
              onClick={() => {
                const next = !iAmAvailable;
                setIAmAvailable(next);
                send({ type: "setAvailable", available: next });
              }}
            >
              {iAmAvailable ? "Elérhető vagyok" : "Nem vagyok elérhető"}
            </button>
          </div>
          <div className="player-list">
            {people.filter((p) => p.userId !== user?.id).length === 0 && (
              <p className="meta">Most senki más nincs online.</p>
            )}
            {people
              .filter((p) => p.userId !== user?.id)
              .map((p) => (
                <div className="player-row" key={p.userId}>
                  <span>
                    {p.name}
                    {p.available ? " · elérhető" : p.tableId ? ` · asztal ${p.tableId}` : " · elfoglalt"}
                  </span>
                  {p.available && tableMeta && tableMeta.status !== "playing" && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        send({
                          type: "invite",
                          toUserId: p.userId,
                          tableId: tableMeta.id,
                        })
                      }
                    >
                      Meghívás
                    </button>
                  )}
                  {p.available && !tableMeta && (
                    <span className="meta">Ülj be egy asztalra a meghíváshoz</span>
                  )}
                </div>
              ))}
          </div>
        </section>
      )}

      {screen === "lobby" && (
        <section className="tables-grid">
          {tables.map((t) => (
            <article key={t.id} className={`table-card status-${t.status}`}>
              <h2>Asztal {t.id}</h2>
              <p className="meta">
                {t.status === "empty" && "Üres"}
                {t.status === "lobby" && "Várakozik"}
                {t.status === "playing" && "Zajlik"}
                {t.status === "finished" && "Vége"}
                {" · "}
                {endModeLabel(t.endMode)} · {t.turnSeconds}s
              </p>
              <ul className="seat-list">
                {t.players.length === 0 && <li className="meta">Nincs játékos</li>}
                {t.players.map((p) => (
                  <li key={p.userId}>
                    {p.name}
                  </li>
                ))}
              </ul>
              <div className="actions">
                {t.players.some((p) => p.userId === user?.id) &&
                  (t.status === "playing" || t.status === "lobby") && (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => resumeTableClick(t.id)}
                  >
                    {busy === `resume-${t.id}` ? "Belépés…" : "Vissza a játékba"}
                  </button>
                )}
                {(t.status === "empty" || t.status === "lobby" || t.status === "finished") &&
                  !t.players.some((p) => p.userId === user?.id) && (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => joinTableClick(t.id)}
                  >
                    {busy === `join-${t.id}` ? "Csatlakozás…" : "Beülök"}
                  </button>
                )}
                {t.status === "playing" &&
                  !t.players.some((p) => p.userId === user?.id) && (
                  <button
                    className="secondary"
                    type="button"
                    disabled={!!busy}
                    onClick={() => spectateTableClick(t.id)}
                  >
                    {busy === `spec-${t.id}` ? "Belépés…" : `Nézés (${t.spectatorCount})`}
                  </button>
                )}
                {t.status === "finished" && (
                  <button
                    className="secondary"
                    type="button"
                    disabled={!!busy}
                    onClick={() => spectateTableClick(t.id)}
                  >
                    Eredmény
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
      )}

      {screen === "account" && profile && (
        <div className="split">
          <section className="panel">
            <h2 className="panel-title">Statisztikák</h2>
            <div className="stats-grid">
              {profile.curiosities.map((c) => (
                <div key={c.key} className="stat">
                  <span className="meta">{c.label}</span>
                  <strong>{String(c.value ?? "—")}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2 className="panel-title">Meccstörténet</h2>
            <div className="player-list">
              {profile.history.length === 0 && <p className="meta">Még nincs befejezett meccs.</p>}
              {profile.history.map((h) => (
                <div className="player-row" key={`${h.id}-${h.finished_at}`}>
                  <span>
                    {h.won ? "Győzelem" : "Vereség"} · {h.score} pont
                    {h.opponents ? ` · vs ${h.opponents}` : ""}
                  </span>
                  <span className="meta">
                    {h.finished_at
                      ? new Date(h.finished_at).toLocaleString("hu-HU")
                      : "—"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {screen === "admin" && (
        <div className="admin-page">
          {!(user?.isAdmin || profile?.isAdmin) ? (
            <section className="panel">
              <p className="meta">Nincs admin jogod.</p>
            </section>
          ) : !adminStats ? (
            <section className="panel">
              <p className="meta">Statisztikák betöltése…</p>
            </section>
          ) : (
            <>
              <div className="admin-head">
                <h2 className="panel-title" style={{ margin: 0 }}>
                  Admin áttekintés
                </h2>
                <button className="secondary" type="button" onClick={() => void refreshAdmin()}>
                  Frissítés
                </button>
              </div>
              <div className="stats-grid admin-overview">
                {[
                  ["users", "Felhasználók"],
                  ["games", "Meccsek összesen"],
                  ["finishedGames", "Befejezett"],
                  ["playingGames", "Folyamatban"],
                  ["pvpGames", "Emberek közt"],
                  ["aiGames", "Bot ellen"],
                  ["userWords", "Felvett szavak"],
                  ["sessions", "Aktív sessionök"],
                ].map(([key, label]) => (
                  <div key={key} className="stat">
                    <span className="meta">{label}</span>
                    <strong>{adminStats.overview[key] ?? 0}</strong>
                  </div>
                ))}
              </div>

              <section className="panel">
                <h3 className="panel-title">Felhasználók kezelése</h3>
                <div className="admin-create">
                  <div className="field">
                    <label>Új név</label>
                    <input value={adminName} onChange={(e) => setAdminName(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Jelszó</label>
                    <input
                      type="password"
                      value={adminPass}
                      onChange={(e) => setAdminPass(e.target.value)}
                    />
                  </div>
                  <label className="admin-check">
                    <input
                      type="checkbox"
                      checked={adminMakeAdmin}
                      onChange={(e) => setAdminMakeAdmin(e.target.checked)}
                    />
                    Admin jog
                  </label>
                  <button
                    type="button"
                    disabled={busy === "admin-create"}
                    onClick={() => {
                      void (async () => {
                        setBusy("admin-create");
                        try {
                          await api("/api/admin/users", {
                            method: "POST",
                            body: JSON.stringify({
                              name: adminName,
                              password: adminPass,
                              isAdmin: adminMakeAdmin,
                            }),
                          });
                          setAdminName("");
                          setAdminPass("");
                          setAdminMakeAdmin(false);
                          await refreshAdmin();
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy("");
                        }
                      })();
                    }}
                  >
                    Felhasználó létrehozása
                  </button>
                </div>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Név</th>
                        <th>Admin</th>
                        <th>Meccs</th>
                        <th>Győzelem</th>
                        <th>Legjobb</th>
                        <th>Utoljára</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminStats.users.map((u) => {
                        const id = String(u.id);
                        const editing = editUserId === id;
                        return (
                          <tr key={id}>
                            <td>
                              {editing ? (
                                <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                              ) : (
                                String(u.name)
                              )}
                            </td>
                            <td>{Number(u.is_admin) ? "igen" : "nem"}</td>
                            <td>{String(u.games)}</td>
                            <td>{String(u.wins)}</td>
                            <td>{String(u.best_score)}</td>
                            <td>{String(u.last_seen)}</td>
                            <td>
                              <div className="admin-row-actions">
                                {editing ? (
                                  <>
                                    <input
                                      type="password"
                                      placeholder="Új jelszó (opcionális)"
                                      value={editPass}
                                      onChange={(e) => setEditPass(e.target.value)}
                                    />
                                    <button
                                      type="button"
                                      className="secondary"
                                      onClick={() => {
                                        void (async () => {
                                          try {
                                            await api(`/api/admin/users/${id}`, {
                                              method: "PATCH",
                                              body: JSON.stringify({
                                                name: editName,
                                                password: editPass || undefined,
                                              }),
                                            });
                                            setEditUserId(null);
                                            setEditPass("");
                                            await refreshAdmin();
                                          } catch (e) {
                                            setError((e as Error).message);
                                          }
                                        })();
                                      }}
                                    >
                                      Mentés
                                    </button>
                                    <button
                                      type="button"
                                      className="secondary"
                                      onClick={() => {
                                        setEditUserId(null);
                                        setEditPass("");
                                      }}
                                    >
                                      Mégse
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      className="secondary"
                                      onClick={() => {
                                        setEditUserId(id);
                                        setEditName(String(u.name));
                                        setEditPass("");
                                      }}
                                    >
                                      Szerkeszt
                                    </button>
                                    <button
                                      type="button"
                                      className="secondary"
                                      onClick={() => {
                                        void (async () => {
                                          try {
                                            await api(`/api/admin/users/${id}`, {
                                              method: "PATCH",
                                              body: JSON.stringify({
                                                isAdmin: !Number(u.is_admin),
                                              }),
                                            });
                                            await refreshAdmin();
                                          } catch (e) {
                                            setError((e as Error).message);
                                          }
                                        })();
                                      }}
                                    >
                                      {Number(u.is_admin) ? "Admin elvétele" : "Adminná tesz"}
                                    </button>
                                    {id !== user?.id && (
                                      <button
                                        type="button"
                                        className="secondary"
                                        onClick={() => {
                                          if (!confirm(`Törlöd: ${String(u.name)}?`)) return;
                                          void (async () => {
                                            try {
                                              await api(`/api/admin/users/${id}`, {
                                                method: "DELETE",
                                              });
                                              await refreshAdmin();
                                            } catch (e) {
                                              setError((e as Error).message);
                                            }
                                          })();
                                        }}
                                      >
                                        Törlés
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <div className="split admin-split">
                <section className="panel">
                  <h3 className="panel-title">Top játékosok</h3>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Név</th>
                          <th>Győzelem</th>
                          <th>Meccs</th>
                          <th>PvP</th>
                          <th>AI</th>
                          <th>Legjobb</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminStats.topPlayers.map((p) => (
                          <tr key={String(p.name)}>
                            <td>{String(p.name)}</td>
                            <td>{String(p.wins)}</td>
                            <td>{String(p.games)}</td>
                            <td>{String(p.pvp_wins)}</td>
                            <td>{String(p.ai_wins)}</td>
                            <td>{String(p.best_score)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              <section className="panel">
                <h3 className="panel-title">Legutóbbi meccsek</h3>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Mikor</th>
                        <th>Állapot</th>
                        <th>Típus</th>
                        <th>Játékosok</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminStats.recentGames.map((g) => (
                        <tr key={String(g.id)}>
                          <td>{String(g.finished || g.created)}</td>
                          <td>{String(g.status)}</td>
                          <td>{Number(g.vs_ai) ? "Bot" : "PvP"}</td>
                          <td>{String(g.players ?? "—")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <div className="split admin-split">
                <section className="panel">
                  <h3 className="panel-title">Felvett szavak</h3>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Szó</th>
                          <th>Ki</th>
                          <th>Mikor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminStats.words.map((w, i) => (
                          <tr key={`${w.word}-${i}`}>
                            <td>
                              <strong>{String(w.word)}</strong>
                            </td>
                            <td>{String(w.added_by)}</td>
                            <td>{String(w.created)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section className="panel">
                  <h3 className="panel-title">Szavak felhasználónként</h3>
                  <div className="player-list">
                    {adminStats.wordsByUser.map((w) => (
                      <div className="player-row" key={String(w.name)}>
                        <span>{String(w.name)}</span>
                        <strong>{String(w.n)}</strong>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </>
          )}
        </div>
      )}

      {screen === "leaderboard" && (
        <section className="panel">
          <div className="tabs">
            <button className={lbTab === "score" ? "" : "secondary"} type="button" onClick={() => setLbTab("score")}>
              Legjobb pont
            </button>
            <button className={lbTab === "pvp" ? "" : "secondary"} type="button" onClick={() => setLbTab("pvp")}>
              PvP győzelem
            </button>
            <button
              className={lbTab === "bestMove" ? "" : "secondary"}
              type="button"
              onClick={() => setLbTab("bestMove")}
            >
              Legjobb lépés
            </button>
          </div>
          <div className="player-list">
            {(lbTab === "score"
              ? leaderboard.byScore
              : lbTab === "pvp"
                ? leaderboard.byPvp
                : leaderboard.byBestMove
            ).map((row, i) => (
              <div className="player-row" key={`${String(row.name)}-${i}`}>
                <span>
                  {i + 1}. {String(row.name)}
                  {lbTab === "bestMove" && row.words ? ` · ${String(row.words)}` : ""}
                  {lbTab === "bestMove" && row.at ? ` · ${String(row.at)}` : ""}
                </span>
                <strong>
                  {lbTab === "score" && `${row.best_score} pont`}
                  {lbTab === "pvp" && `${row.pvp_wins} győzelem`}
                  {lbTab === "bestMove" && `${row.score} pont`}
                </strong>
              </div>
            ))}
          </div>
        </section>
      )}

      {screen === "settings" && (
        <section className="panel">
          <h2 className="panel-title">Tábla és betű mérete</h2>
          <div className="actions">
            {SCALE_STEPS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={uiScale === s.id ? "" : "secondary"}
                onClick={() => saveScale(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="meta">
            Meccs közben is állítható a tábla felett. Alapértelmezett: Közepes.
          </p>
          <p className="meta">
            Asztalon: 1–7 billentyű a tartóhoz, Enter lerakás, Escape törlés. Telefonon húzd a zsetont a mezőre.
          </p>
          <h2 className="panel-title" style={{ marginTop: "1.2rem" }}>
            Jolly visszacseréje
          </h2>
          <p className="meta">
            Ha a táblán jolly (üres, J jelű zseton) van, és nálad megvan a valódi betű, saját
            körödben kattints rá — kicserélődik, a jolly visszakerül a tartódba, és abban a körben
            le kell raknod.
          </p>
        </section>
      )}

      {screen === "table" && tableMeta && (
        <div className="game-layout">
          <section className="panel">
            <div className="actions" style={{ marginBottom: "0.8rem" }}>
              <button
                className="secondary"
                type="button"
                disabled={busy === "leave"}
                onClick={() => leaveTableClick()}
              >
                {tableMeta.status === "playing" || state?.status === "playing"
                  ? "Asztalok (játék megy)"
                  : "Vissza az asztalokhoz"}
              </button>
              <span className="meta">
                Asztal {tableMeta.id}
                {spectating ? " · néző" : ""}
                {state?.status === "playing" ? ` · zsák: ${state.bagCount}` : ""}
              </span>
              <div className="scale-inline" title="Tábla mérete">
                {SCALE_STEPS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={uiScale === s.id ? "" : "secondary"}
                    onClick={() => saveScale(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {(tableMeta.status === "lobby" || tableMeta.status === "empty") &&
              (!state || state.status === "lobby") && (
              <div className="waiting-room">
                <h2 className="panel-title">Asztal {tableMeta.id} – váró</h2>
                <p className="meta">
                  {endModeLabel(tableMeta.endMode)} · {tableMeta.turnSeconds} mp / kör
                </p>
                <p className="meta">{endModeHint(tableMeta.endMode)}</p>
                <ul className="seat-list big-seats">
                  {(tableMeta.seats ?? []).map((s) => (
                    <li key={s.userId} className="seat-row">
                      <span>
                        {s.name}
                        {s.userId === tableMeta.hostUserId ? " · hoszt" : ""}
                        {s.userId === user?.id ? " (te)" : ""}
                      </span>
                      {s.isBot && tableMeta.hostUserId === user?.id && (
                        <button
                          className="secondary seat-remove"
                          type="button"
                          disabled={!!busy}
                          onClick={() => removeBotClick(s.userId)}
                        >
                          {busy === `rm-${s.userId}` ? "…" : "Eltávolít"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {tableMeta.hostUserId === user?.id ? (
                  <div className="lobby-controls">
                    <div className="field">
                      <label>Játékvége szabály</label>
                      <select
                        value={tableMeta.endMode}
                        onChange={(e) =>
                          configTable({ endMode: e.target.value as EndMode })
                        }
                      >
                        <option value="B">Folytatásos (ajánlott)</option>
                        <option value="A">Klasszikus</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Lépésidő (mp)</label>
                      <input
                        type="number"
                        min={30}
                        max={600}
                        defaultValue={tableMeta.turnSeconds}
                        key={`turn-${tableMeta.id}-${tableMeta.turnSeconds}`}
                        onBlur={(e) =>
                          configTable({ turnSeconds: Number(e.target.value) || 180 })
                        }
                      />
                    </div>
                    <div className="field">
                      <label>Bot nehézség</label>
                      <select
                        value={difficulty}
                        onChange={(e) => setDifficulty(e.target.value as BotDifficulty)}
                      >
                        <option value="easy">Könnyű</option>
                        <option value="medium">Közepes</option>
                        <option value="hard">Nehéz</option>
                      </select>
                    </div>
                    <div className="actions">
                      <button
                        className="secondary"
                        type="button"
                        disabled={!!busy}
                        onClick={() => addBotClick()}
                      >
                        Bot hozzáadása
                      </button>
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => startTableClick()}
                      >
                        {busy === "start" ? "Indítás…" : "Indítás"}
                      </button>
                      <button
                        className="secondary"
                        type="button"
                        disabled={!!busy}
                        onClick={() => void resetTableClick()}
                      >
                        {busy === "reset" ? "Reset…" : "Asztal törlése"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="meta">Várunk a hosztra, amíg elindítja a partit.</p>
                )}
              </div>
            )}

            {state && (state.status === "playing" || state.status === "finished") && (
              <>
                <div className="board-wrap" ref={boardRef}>
                  <div className="board felt">
                    {state.board.map((row, r) =>
                      row.map((cell, c) => {
                        const draft = drafts.find((d) => d.row === r && d.col === c);
                        const prem = premiums[r][c];
                        const show = cell ?? (draft
                          ? { letter: draft.letter, isBlank: draft.isBlank }
                          : null);
                        const isLast = !!state.lastMove?.placements.some(
                          (p) => p.row === r && p.col === c
                        );
                        const canSwapBlank =
                          !!show?.isBlank &&
                          isMyTurn &&
                          !spectating &&
                          myRack.some(
                            (t) =>
                              t !== "?" &&
                              t.toLocaleUpperCase("hu").normalize("NFC") ===
                                show.letter.toLocaleUpperCase("hu").normalize("NFC")
                          );
                        return (
                          <div
                            key={`${r}-${c}`}
                            className={`cell ${premiumClass(prem)} ${canSwapBlank ? "can-swap" : ""} ${swapMode ? "swap-mode" : ""}`}
                            onClick={() => onCellClick(r, c)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (dragRack == null) return;
                              placeOnCell(r, c, dragRack);
                              setDragRack(null);
                            }}
                          >
                            {show ? (
                              <div
                                className={`tile ${draft ? "draft" : ""} ${show.isBlank ? "blank" : ""} ${isLast ? "last-move" : ""} ${canSwapBlank ? "swap-ready" : ""}`}
                              >
                                {show.isBlank && <span className="jolly-badge">J</span>}
                                <span className="letter">{show.letter}</span>
                                <span className="pts">
                                  {show.isBlank ? tilePoints(show.letter, true) : tilePoints(show.letter, false)}
                                </span>
                              </div>
                            ) : (
                              <span className="prem">{premiumLabel(prem)}</span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {state.status === "playing" && !spectating && (
                  <>
                    {state.mustPlayBlank && isMyTurn && (
                      <p className="meta center help-tip">
                        A visszacserélt jollyt ebben a körben le kell raknod.
                      </p>
                    )}
                    {state.lastMove && (
                      <p className="meta center last-move-hint">
                        Utolsó lépés: {lastMoveText(state.lastMove)}
                      </p>
                    )}
                    <div className="play-dock">
                      <div className="rack">
                        {myRack.map((letter, i) => (
                          <button
                            key={`${letter}-${i}`}
                            className={`tile rack-tile ${selectedRack === i ? "selected" : ""} ${letter === "?" ? "blank-rack" : ""}`}
                            disabled={usedRack.has(i) || !isMyTurn}
                            draggable={isMyTurn && !usedRack.has(i)}
                            onDragStart={() => setDragRack(i)}
                            onDragEnd={() => setDragRack(null)}
                            onClick={() => setSelectedRack((cur) => (cur === i ? null : i))}
                            type="button"
                            style={{ opacity: usedRack.has(i) ? 0.25 : 1 }}
                          >
                            <span className="keyhint">{i + 1}</span>
                            {letter === "?" ? (
                              <>
                                <span className="jolly-badge">J</span>
                                <span className="letter">★</span>
                                <span className="pts">0</span>
                              </>
                            ) : (
                              <>
                                <span className="letter">{letter}</span>
                                <span className="pts">{tilePoints(letter, false)}</span>
                              </>
                            )}
                          </button>
                        ))}
                      </div>
                      {selectedRack != null && myRack[selectedRack] === "?" && (
                        <div className="field blank-picker">
                          <label>Jolly betű</label>
                          <select value={blankLetter} onChange={(e) => setBlankLetter(e.target.value)}>
                            {blankChoices().map((ch) => (
                              <option key={ch} value={ch}>
                                {ch}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className="actions center play-actions">
                        <button
                          disabled={!isMyTurn || drafts.length === 0}
                          type="button"
                          onClick={() => void submitPlace()}
                        >
                          Lerakás
                        </button>
                        <button
                          className="secondary"
                          disabled={!isMyTurn}
                          type="button"
                          onClick={() => {
                            setDrafts([]);
                            setInvalidWords([]);
                            setError("");
                          }}
                        >
                          Törlés
                        </button>
                        <button
                          className={swapMode ? "" : "secondary"}
                          disabled={!isMyTurn || busy === "swap"}
                          type="button"
                          onClick={() => {
                            setSwapMode((v) => !v);
                            setError("");
                          }}
                        >
                          {swapMode ? "Csere mód be" : "Jolly csere"}
                        </button>
                        <button
                          className="secondary"
                          disabled={!isMyTurn}
                          type="button"
                          onClick={() => void submitPass()}
                        >
                          Passz
                        </button>
                        {state.endMode === "B" && (
                          <button
                            className="secondary"
                            disabled={!isMyTurn}
                            type="button"
                            onClick={() => void submitResign()}
                          >
                            Feladom
                          </button>
                        )}
                      </div>
                    </div>
                    {swapMode && (
                      <p className="meta center help-tip">
                        Kattints a táblán a csíkozott, J jelű jollyra. Ha nálad van a valódi betű,
                        azonnal kicseréli — a jolly visszakerül a tartódba, és ebben a körben le kell raknod.
                      </p>
                    )}
                    {isMyTurn &&
                      !swapMode &&
                      state.board.some((row) =>
                        row.some(
                          (c) =>
                            !!c?.isBlank &&
                            myRack.some(
                              (t) =>
                                t !== "?" &&
                                t.toLocaleUpperCase("hu").normalize("NFC") ===
                                  c.letter.toLocaleUpperCase("hu").normalize("NFC")
                            )
                        )
                      ) && (
                        <p className="meta center help-tip">
                          Van nálad betű egy jollyhoz — kattints a zölden kiemelt J zsetonra a cseréhez.
                        </p>
                      )}
                    {invalidWords.length > 0 && (
                      <div className="accept-box">
                        <p>
                          A szótár nem ismeri: <strong>{invalidWords.join(", ")}</strong>
                        </p>
                        <button type="button" onClick={acceptWords}>
                          {(tableMeta.humanCount ?? 1) <= 1
                            ? "Ez értelmes — felveszem"
                            : "Szavazásra küldöm"}
                        </button>
                      </div>
                    )}
                  </>
                )}

                {state.status === "finished" && (
                  <div className="game-over-modal" role="dialog" aria-modal="true">
                    <div className={`game-over-card ${iWon ? "win" : "done"}`}>
                      <p className="game-over-kicker">
                        {iWon ? "Gratulálunk!" : "Szép játék!"}
                      </p>
                      <h2>Vége a partinak!</h2>
                      <p className="meta">
                        Győztes:{" "}
                        <strong>
                          {state.players
                            .filter((p) => state.winnerIds.includes(p.id))
                            .map((p) => p.name)
                            .join(", ") || "—"}
                        </strong>
                      </p>
                      <div className="player-list" style={{ marginTop: "0.8rem" }}>
                        {[...state.players]
                          .sort((a, b) => b.score - a.score)
                          .map((p) => (
                            <div className="player-row" key={p.id}>
                              <span>
                                {p.name}
                                {p.id === user?.id ? " (te)" : ""}
                              </span>
                              <strong>{p.score} pont</strong>
                            </div>
                          ))}
                      </div>
                      <div className="actions" style={{ marginTop: "1rem", justifyContent: "center" }}>
                        <button type="button" onClick={() => leaveTableClick()}>
                          Asztalokhoz
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          <aside className="side">
            <section className="panel">
              <div className="meta">Hátralévő idő</div>
              <div className={`timer ${remainingMs < 30000 ? "urgent" : ""}`}>
                {state?.status === "playing"
                  ? formatTime(remainingMs)
                  : tableMeta.status === "lobby"
                    ? "VÁRÓ"
                    : "VÉGE"}
              </div>
              {state?.status === "playing" && (
                <p className="meta">Meccs ideje: {formatTime(Math.max(0, now - state.createdAt))}</p>
              )}
              <p className="meta">
                {spectating
                  ? "Néző mód"
                  : isMyTurn
                    ? "Te jössz."
                    : state
                      ? `${currentPlayer(state)?.name ?? "—"} köre`
                      : "Várakozás a kezdésre"}
              </p>
              <p className="meta">{endModeLabel(tableMeta.endMode)}</p>
            </section>
            <section className="panel">
              <div className="player-list">
                {(state?.players ?? (tableMeta.seats ?? []).map((s) => ({
                  id: s.userId,
                  name: s.name,
                  score: 0,
                  isBot: s.isBot,
                  eliminated: false,
                  connected: true,
                  rackCount: 0,
                }))).map((p, i) => (
                  <div
                    key={p.id}
                    className={`player-row ${state && i === state.currentPlayerIndex ? "active" : ""} ${"eliminated" in p && p.eliminated ? "out" : ""}`}
                  >
                    <span>
                      {p.name}
                      {p.id === user?.id ? " (te)" : ""}
                      {"eliminated" in p && p.eliminated ? " ✕" : ""}
                    </span>
                    <strong>{"score" in p ? p.score : 0}</strong>
                  </div>
                ))}
              </div>
            </section>
            <section className="panel chat-panel">
              <div className="panel-title" style={{ fontSize: "1rem", marginBottom: "0.4rem" }}>
                Chat
              </div>
              <div className="chat-log" ref={chatLogRef}>
                {(tableMeta.chat ?? []).length === 0 && (
                  <p className="meta">Még nincs üzenet.</p>
                )}
                {(tableMeta.chat ?? []).map((m) => (
                  <div key={m.id} className="chat-line">
                    <strong>{m.name}:</strong> {m.text}
                  </div>
                ))}
              </div>
              <div className="chat-compose">
                <input
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void sendChat();
                  }}
                  placeholder="Üzenet…"
                  maxLength={240}
                />
                <button type="button" onClick={() => void sendChat()}>
                  Küld
                </button>
              </div>
            </section>
          </aside>
        </div>
      )}

      <TurnBanner
        show={isMyTurn && !tableMeta?.challenge && !tableMeta?.drawReveal}
        epoch={
          state
            ? `${state.moveCount}:${state.currentPlayerIndex}:${user?.id ?? ""}`
            : ""
        }
        name={user?.name}
        awayFromTable={screen !== "table" && !!activeTableId && state?.status === "playing"}
        onReturnToGame={() => {
          if (activeTableId == null) return;
          setScreen("table");
          wsAttach("resume", activeTableId);
        }}
      />
      <VoteBanner
        show={
          !!tableMeta?.challenge &&
          screen === "table" &&
          !spectating &&
          tableMeta.status === "playing" &&
          state?.status === "playing"
        }
        challengeId={tableMeta?.challenge?.id ?? ""}
        proposerName={tableMeta?.challenge?.proposerName ?? ""}
        words={tableMeta?.challenge?.words ?? []}
        isProposer={tableMeta?.challenge?.proposerId === user?.id}
        canVote={
          !!tableMeta?.challenge &&
          tableMeta.challenge.voterIds.includes(user?.id ?? "") &&
          !tableMeta.challenge.votes[user?.id ?? ""]
        }
        onAccept={() => void voteWord(true)}
        onReject={() => void voteWord(false)}
      />
      <DrawRevealOverlay
        show={!!tableMeta?.drawReveal && screen === "table"}
        draws={tableMeta?.drawReveal?.draws ?? []}
        order={tableMeta?.drawReveal?.order ?? []}
      />
      <ConfettiBurst
        active={!!state && state.status === "finished" && screen === "table"}
        celebrate={iWon}
      />

      <footer className="footer">Kozma Szójáték v{version}</footer>
    </div>
  );
}
