import assert from "node:assert/strict";
import test from "node:test";

import {
  createBlackjackGame,
  createStandardDeck,
  doubleDown,
  scoreHand,
  shuffleDeck,
  stand,
  startNewHand,
  hit,
  type Card,
  type Rank,
  type Suit,
} from "../app/lib/blackjack";

const card = (rank: Rank, suit: Suit = "spades"): Card => ({ rank, suit });

test("scores aces as 11 until the hand would bust", () => {
  assert.deepEqual(scoreHand([card("A"), card("A"), card("9")]), {
    total: 21,
    isSoft: true,
    isBlackjack: false,
    isBust: false,
  });

  assert.deepEqual(scoreHand([card("A"), card("A"), card("9"), card("K")]), {
    total: 21,
    isSoft: false,
    isBlackjack: false,
    isBust: false,
  });
});

test("uses injected decks in index order and dealer stands on 17", () => {
  const game = createBlackjackGame({
    deck: [card("10"), card("6"), card("7"), card("9"), card("2")],
  });

  assert.deepEqual(game.playerHand, [card("10"), card("7")]);
  assert.deepEqual(game.dealerHand, [card("6"), card("9")]);
  assert.equal(game.credits, 90);

  const result = stand(game);
  assert.deepEqual(result.dealerHand, [card("6"), card("9"), card("2")]);
  assert.equal(result.outcome, "push");
  assert.equal(result.credits, 100);
});

test("settles a bust immediately", () => {
  const game = createBlackjackGame({
    deck: [card("10"), card("9"), card("6"), card("7"), card("10")],
  });
  const result = hit(game);

  assert.equal(scoreHand(result.playerHand).total, 26);
  assert.equal(result.phase, "settled");
  assert.equal(result.outcome, "player-bust");
  assert.equal(result.credits, 90);
});

test("double takes one card, doubles the stake, and finishes the dealer hand", () => {
  const game = createBlackjackGame({
    deck: [card("5"), card("9"), card("6"), card("7"), card("K"), card("2")],
  });
  const result = doubleDown(game);

  assert.equal(result.doubled, true);
  assert.equal(result.wager, 20);
  assert.equal(scoreHand(result.playerHand).total, 21);
  assert.equal(scoreHand(result.dealerHand).total, 18);
  assert.equal(result.outcome, "player-win");
  assert.equal(result.payout, 40);
  assert.equal(result.credits, 120);
});

test("pays a natural blackjack at 3:2", () => {
  const game = createBlackjackGame({
    deck: [card("A"), card("10"), card("K"), card("8")],
  });

  assert.equal(game.outcome, "player-blackjack");
  assert.equal(game.payout, 25);
  assert.equal(game.credits, 115);
});

test("new hand preserves credits and clears round settlement", () => {
  const settled = stand(
    createBlackjackGame({
      deck: [card("10"), card("6"), card("7"), card("9"), card("2")],
    }),
  );
  const next = startNewHand(settled, {
    deck: [card("9"), card("10"), card("8"), card("7"), card("4")],
  });

  assert.equal(next.credits, settled.credits - 10);
  assert.equal(next.wager, 10);
  assert.equal(next.phase, "player-turn");
  assert.equal(next.outcome, null);
  assert.equal(next.payout, 0);
  assert.equal(next.doubled, false);
});

test("shuffle is deterministic with an injected random source and is immutable", () => {
  const deck = createStandardDeck().slice(0, 8);
  const original = [...deck];
  const first = shuffleDeck(deck, () => 0.25);
  const second = shuffleDeck(deck, () => 0.25);

  assert.deepEqual(first, second);
  assert.deepEqual(deck, original);
  assert.notDeepEqual(first, deck);
});
