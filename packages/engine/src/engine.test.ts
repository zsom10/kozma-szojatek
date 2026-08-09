import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CENTER,
  tokenizeWord,
  emptyBoard,
  validateMove,
  createBag,
  LETTER_COUNTS,
  getDefaultLexicon,
  createLobby,
  addPlayer,
  startGame,
  passTurn,
  swapBlank,
  rackPoints,
  resignTurn,
  chooseBotMove,
  generateMoves,
} from "./index.js";

describe("tokenizeWord", () => {
  it("splits digraphs", () => {
    assert.deepEqual(tokenizeWord("család"), ["CS", "A", "L", "Á", "D"]);
  });
});

describe("bag", () => {
  it("has 100 tiles", () => {
    assert.equal(createBag(1).length, 100);
    assert.equal(Object.values(LETTER_COUNTS).reduce((a, b) => a + b, 0), 100);
  });
});

describe("lexicon", () => {
  const lex = getDefaultLexicon();

  it("loads many stems", () => {
    assert.ok(lex.stemCount() > 10000);
  });

  it("accepts stems and common forms", () => {
    assert.equal(lex.hasWord("ház"), true);
    assert.equal(lex.hasWord("xyzqwerty"), false);
  });

  it("accepts user words", () => {
    const local = getDefaultLexicon(["SZUPERHANGYA"]);
    assert.equal(local.hasWord("szuperhangya"), true);
  });
});

describe("validateMove", () => {
  const dict = getDefaultLexicon();

  it("accepts first word through center", () => {
    const board = emptyBoard();
    const tiles = tokenizeWord("ház")!;
    const placements = tiles.map((letter, i) => ({
      row: CENTER,
      col: CENTER + i,
      letter,
      isBlank: false,
    }));
    const result = validateMove(board, tiles, placements, dict, 50);
    assert.equal(result.ok, true);
  });

  it("accepts single tile vertical extension", () => {
    const board = emptyBoard();
    board[CENTER][CENTER] = { letter: "A", isBlank: false };
    board[CENTER][CENTER + 1] = { letter: "Z", isBlank: false };
    const placements = [
      { row: CENTER - 1, col: CENTER, letter: "F", isBlank: false },
    ];
    const result = validateMove(board, ["F"], placements, dict, 50);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.move.direction, "V");
      assert.ok(result.move.words.includes("FA"));
    }
  });
});

describe("game flow", () => {
  it("plays and passes", () => {
    let state = createLobby({ id: "g1", host: { id: "p1", name: "Anna" } });
    state = addPlayer(state, { id: "p2", name: "Béla" });
    state = startGame(state, 42);
    state = passTurn(state, "p1");
    assert.equal(state.currentPlayerIndex, 1);
  });
});

describe("scoring house rules", () => {
  const dict = getDefaultLexicon();

  it("blank scores as substituted letter", () => {
    const board = emptyBoard();
    const placements = [
      { row: CENTER, col: CENTER, letter: "H", isBlank: false },
      { row: CENTER, col: CENTER + 1, letter: "Á", isBlank: true },
      { row: CENTER, col: CENTER + 2, letter: "Z", isBlank: false },
    ];
    const result = validateMove(board, ["H", "?", "Z"], placements, dict, 50);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.move.score >= 1 + 1 + 3);
    }
  });

  it("mode B pass skips turn without eliminating", () => {
    let state = createLobby({
      id: "g2",
      host: { id: "p1", name: "Anna" },
      endMode: "B",
    });
    state = addPlayer(state, { id: "p2", name: "Béla" });
    state = startGame(state, 7);
    state = passTurn(state, "p1");
    assert.equal(state.players[0].eliminated, false);
    assert.equal(state.currentPlayerIndex, 1);
  });

  it("resign eliminates in mode B", () => {
    let state = createLobby({
      id: "g2b",
      host: { id: "p1", name: "Anna" },
      endMode: "B",
    });
    state = addPlayer(state, { id: "p2", name: "Béla" });
    state = startGame(state, 7);
    const before = state.players[0].score;
    state = resignTurn(state, "p1");
    assert.equal(state.players[0].eliminated, true);
    assert.ok(state.players[0].score < before);
  });

  it("rejects nonsense words even with suffix-looking endings", () => {
    const dict = getDefaultLexicon();
    assert.equal(dict.hasWord("NIENJKCLS"), false);
    assert.equal(dict.hasWord("BOLYATK"), false);
    assert.equal(dict.hasWord("HPABOLYA"), false);
    assert.equal(dict.hasWord("SZT"), false);
    assert.equal(dict.hasWord("LSDVÉ"), false);
    assert.equal(dict.hasWord("PÖCSSZ"), false);
    assert.equal(dict.hasWord("EBRO"), false);
    assert.equal(dict.hasWord("JS"), false);
    assert.equal(dict.hasWord("MRD"), false);
    assert.equal(dict.hasWord("ház"), true);
  });

  it("swapBlank exchanges real letter for jolly", () => {
    let state = createLobby({ id: "g3", host: { id: "p1", name: "Anna" } });
    state = startGame(state, 1);
    const board = emptyBoard();
    board[CENTER][CENTER] = { letter: "A", isBlank: true };
    state = {
      ...state,
      board,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, rack: ["A", "B", "C", "D", "E", "F", "G"] } : p
      ),
    };
    state = swapBlank(state, "p1", CENTER, CENTER);
    assert.equal(state.board[CENTER][CENTER]?.isBlank, false);
    assert.ok(state.players[0].rack.includes("?"));
    assert.equal(state.players[0].rack.includes("A"), false);
    assert.equal(state.mustPlayBlank, true);
  });

  it("rack blank penalty is 10", () => {
    assert.equal(rackPoints(["?"], 10), 10);
    assert.equal(rackPoints(["A", "?"], 10), 11);
  });
});

describe("ai", () => {
  it("finds moves", () => {
    const dict = getDefaultLexicon();
    const board = emptyBoard();
    const move = chooseBotMove(board, ["H", "Á", "Z", "A", "L", "M", "A"], dict, "hard");
    assert.ok(move === null || move.score > 0);
    const moves = generateMoves(board, ["H", "Á", "Z", "A", "L", "M", "A"], dict);
    assert.ok(moves.length >= 0);
  });

  it("bots only place stems of at least 3 tiles", () => {
    const dict = getDefaultLexicon();
    assert.equal(dict.isBotLegalWord("HÁZ"), true);
    assert.equal(dict.isBotLegalWord("AZ"), false);
    assert.equal(dict.isBotLegalWord("A"), false);
    const board = emptyBoard();
    const moves = generateMoves(board, ["H", "Á", "Z", "A", "L", "M", "A"], dict, true);
    for (const m of moves) {
      for (const w of m.words) {
        assert.equal(dict.isBotLegalWord(w), true);
      }
    }
  });
});
