export const FIXED_WAGER = 10;
export const DEFAULT_STARTING_CREDITS = 100;

export const SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;
export const RANKS = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}

export type PlayerAction = "hit" | "stand" | "double";
export type RoundPhase = "player-turn" | "settled";
export type RoundOutcome =
  | "player-blackjack"
  | "dealer-blackjack"
  | "player-bust"
  | "dealer-bust"
  | "player-win"
  | "dealer-win"
  | "push";

export interface HandScore {
  readonly total: number;
  readonly isSoft: boolean;
  readonly isBlackjack: boolean;
  readonly isBust: boolean;
}

export interface BlackjackState {
  /** Available play credits after the current wager has been deducted. */
  readonly credits: number;
  /** Credits currently at risk. Starts at $10 and becomes $20 after double. */
  readonly wager: number;
  /** The first item is always the next card that will be drawn. */
  readonly deck: readonly Card[];
  readonly playerHand: readonly Card[];
  readonly dealerHand: readonly Card[];
  readonly phase: RoundPhase;
  readonly outcome: RoundOutcome | null;
  /** Total credits returned at settlement, including the stake. */
  readonly payout: number;
  readonly doubled: boolean;
}

export type RandomSource = () => number;

export interface DeckOptions {
  /** A deterministic deck in draw order. The item at index 0 is dealt first. */
  readonly deck?: readonly Card[];
  /** Injected decks are not shuffled unless this is explicitly true. */
  readonly shuffle?: boolean;
  /** Used only when the deck is shuffled. Must return a value in [0, 1). */
  readonly random?: RandomSource;
}

export interface CreateBlackjackOptions extends DeckOptions {
  readonly credits?: number;
}

interface DrawResult {
  readonly card: Card;
  readonly deck: readonly Card[];
}

export function createStandardDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}

/** Returns a shuffled copy and never mutates the supplied deck. */
export function shuffleDeck(
  deck: readonly Card[],
  random: RandomSource = Math.random,
): Card[] {
  const shuffled = [...deck];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const sample = random();

    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new RangeError("Random source must return a number in [0, 1).");
    }

    const swapIndex = Math.floor(sample * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}

export function scoreHand(hand: readonly Card[]): HandScore {
  let total = 0;
  let acesCountedAsEleven = 0;

  for (const card of hand) {
    if (card.rank === "A") {
      total += 11;
      acesCountedAsEleven += 1;
    } else if (card.rank === "K" || card.rank === "Q" || card.rank === "J") {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }

  while (total > 21 && acesCountedAsEleven > 0) {
    total -= 10;
    acesCountedAsEleven -= 1;
  }

  return {
    total,
    isSoft: acesCountedAsEleven > 0,
    isBlackjack: hand.length === 2 && total === 21,
    isBust: total > 21,
  };
}

export function createBlackjackGame(
  options: CreateBlackjackOptions = {},
): BlackjackState {
  return dealHand(options.credits ?? DEFAULT_STARTING_CREDITS, options);
}

/**
 * Starts a clean hand with the previous state's remaining credits.
 * The caller can inject a new deck for deterministic demos and tests.
 */
export function startNewHand(
  previous: Pick<BlackjackState, "credits">,
  options: DeckOptions = {},
): BlackjackState {
  return dealHand(previous.credits, options);
}

export function getAvailableActions(
  state: BlackjackState,
): readonly PlayerAction[] {
  if (state.phase !== "player-turn") {
    return [];
  }

  if (state.playerHand.length === 2 && state.credits >= FIXED_WAGER) {
    return ["hit", "stand", "double"];
  }

  return ["hit", "stand"];
}

export function hit(state: BlackjackState): BlackjackState {
  if (state.phase !== "player-turn") {
    return state;
  }

  const draw = drawCard(state.deck);
  const next: BlackjackState = {
    ...state,
    deck: draw.deck,
    playerHand: [...state.playerHand, draw.card],
  };
  const playerScore = scoreHand(next.playerHand);

  if (playerScore.isBust) {
    return settle(next, "player-bust", 0);
  }

  // A player on 21 has no useful decision remaining, so finish the hand.
  if (playerScore.total === 21) {
    return playDealerAndSettle(next);
  }

  return next;
}

export function stand(state: BlackjackState): BlackjackState {
  if (state.phase !== "player-turn") {
    return state;
  }

  return playDealerAndSettle(state);
}

export function doubleDown(state: BlackjackState): BlackjackState {
  if (!getAvailableActions(state).includes("double")) {
    return state;
  }

  const draw = drawCard(state.deck);
  const doubled: BlackjackState = {
    ...state,
    credits: state.credits - FIXED_WAGER,
    wager: state.wager + FIXED_WAGER,
    doubled: true,
    deck: draw.deck,
    playerHand: [...state.playerHand, draw.card],
  };

  if (scoreHand(doubled.playerHand).isBust) {
    return settle(doubled, "player-bust", 0);
  }

  return playDealerAndSettle(doubled);
}

function dealHand(credits: number, options: DeckOptions): BlackjackState {
  assertCredits(credits);

  if (credits < FIXED_WAGER) {
    throw new RangeError(
      `At least ${FIXED_WAGER} play credits are required to start a hand.`,
    );
  }

  const sourceDeck = options.deck ?? createStandardDeck();
  const shouldShuffle = options.shuffle ?? options.deck === undefined;
  let deck = shouldShuffle
    ? shuffleDeck(sourceDeck, options.random ?? Math.random)
    : [...sourceDeck];

  if (deck.length < 4) {
    throw new RangeError("A deck needs at least four cards to deal a hand.");
  }

  const firstPlayer = drawCard(deck);
  deck = [...firstPlayer.deck];
  const firstDealer = drawCard(deck);
  deck = [...firstDealer.deck];
  const secondPlayer = drawCard(deck);
  deck = [...secondPlayer.deck];
  const secondDealer = drawCard(deck);

  const initial: BlackjackState = {
    credits: credits - FIXED_WAGER,
    wager: FIXED_WAGER,
    deck: secondDealer.deck,
    playerHand: [firstPlayer.card, secondPlayer.card],
    dealerHand: [firstDealer.card, secondDealer.card],
    phase: "player-turn",
    outcome: null,
    payout: 0,
    doubled: false,
  };

  const playerBlackjack = scoreHand(initial.playerHand).isBlackjack;
  const dealerBlackjack = scoreHand(initial.dealerHand).isBlackjack;

  if (playerBlackjack && dealerBlackjack) {
    return settle(initial, "push", initial.wager);
  }

  if (playerBlackjack) {
    // Blackjack pays 3:2, plus the original stake is returned.
    return settle(initial, "player-blackjack", initial.wager * 2.5);
  }

  if (dealerBlackjack) {
    return settle(initial, "dealer-blackjack", 0);
  }

  return initial;
}

function playDealerAndSettle(state: BlackjackState): BlackjackState {
  let deck = state.deck;
  let dealerHand = state.dealerHand;

  // The dealer stands on every 17, including soft 17.
  while (scoreHand(dealerHand).total < 17) {
    const draw = drawCard(deck);
    deck = draw.deck;
    dealerHand = [...dealerHand, draw.card];
  }

  const completed: BlackjackState = {
    ...state,
    deck,
    dealerHand,
  };
  const playerScore = scoreHand(completed.playerHand);
  const dealerScore = scoreHand(completed.dealerHand);

  if (dealerScore.isBust) {
    return settle(completed, "dealer-bust", completed.wager * 2);
  }

  if (playerScore.total > dealerScore.total) {
    return settle(completed, "player-win", completed.wager * 2);
  }

  if (playerScore.total < dealerScore.total) {
    return settle(completed, "dealer-win", 0);
  }

  return settle(completed, "push", completed.wager);
}

function settle(
  state: BlackjackState,
  outcome: RoundOutcome,
  payout: number,
): BlackjackState {
  return {
    ...state,
    credits: state.credits + payout,
    phase: "settled",
    outcome,
    payout,
  };
}

function drawCard(deck: readonly Card[]): DrawResult {
  const card = deck[0];

  if (!card) {
    throw new RangeError("Cannot draw from an empty deck.");
  }

  return {
    card,
    deck: deck.slice(1),
  };
}

function assertCredits(credits: number): void {
  if (!Number.isFinite(credits) || credits < 0) {
    throw new RangeError("Play credits must be a finite, non-negative number.");
  }
}
