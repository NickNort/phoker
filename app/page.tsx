"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Vapi from "@vapi-ai/web";
import {
  createBlackjackGame,
  doubleDown,
  getAvailableActions,
  hit,
  scoreHand,
  stand,
  startNewHand,
  type BlackjackState,
  type Card,
  type PlayerAction,
  type Rank,
  type RoundOutcome,
  type Suit,
} from "./lib/blackjack";

type CallStage = "incoming" | "connecting" | "active" | "ended";
type VoiceMode =
  | "connecting"
  | "dealer-speaking"
  | "listening"
  | "processing"
  | "muted"
  | "unavailable";
type VoiceCommand = PlayerAction | "deal";

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const VAPI_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? "";
const VAPI_ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID ?? "";
const VAPI_CONFIGURED = Boolean(VAPI_PUBLIC_KEY && VAPI_ASSISTANT_ID);

const card = (rank: Rank, suit: Suit): Card => ({ rank, suit });

const DEMO_DECKS: readonly (readonly Card[])[] = [
  [
    card("9", "spades"),
    card("10", "hearts"),
    card("7", "clubs"),
    card("6", "diamonds"),
    card("5", "hearts"),
    card("4", "spades"),
  ],
  [
    card("5", "diamonds"),
    card("10", "clubs"),
    card("6", "spades"),
    card("7", "hearts"),
    card("K", "hearts"),
  ],
  [
    card("10", "diamonds"),
    card("9", "clubs"),
    card("8", "spades"),
    card("7", "diamonds"),
    card("4", "clubs"),
  ],
];

const SUIT_MARKS: Record<Suit, string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};

const OUTCOME_COPY: Record<RoundOutcome, { title: string; detail: string }> = {
  "player-blackjack": {
    title: "Blackjack",
    detail: "Natural 21. You win 25 credits.",
  },
  "dealer-blackjack": {
    title: "Dealer blackjack",
    detail: "Mina takes this hand.",
  },
  "player-bust": { title: "Bust", detail: "Over 21. Mina takes the hand." },
  "dealer-bust": {
    title: "Dealer busts",
    detail: "The table pays you double.",
  },
  "player-win": { title: "You win", detail: "Nicely played. Credits paid." },
  "dealer-win": { title: "Dealer wins", detail: "Mina takes this hand." },
  push: { title: "Push", detail: "Even hand. Your wager is returned." },
};

function parseVoiceCommand(value: string): VoiceCommand | null {
  const normalized = value.toLowerCase().trim();

  if (/\b(double|double down)\b/.test(normalized)) return "double";
  if (/\b(hit|another|card)\b/.test(normalized)) return "hit";
  if (/\b(stand|stay|hold)\b/.test(normalized)) return "stand";
  if (/\b(deal|again|new hand|play again)\b/.test(normalized)) return "deal";

  return null;
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cardName(value: Card | undefined): string {
  if (!value) return "a card";
  return `${value.rank}${SUIT_MARKS[value.suit]}`;
}

function dealerLineFor(
  previous: BlackjackState,
  next: BlackjackState,
  command: VoiceCommand,
): string {
  if (command === "deal") {
    const score = scoreHand(next.playerHand).total;
    return `New hand. You have ${score}. Say hit, stand, or double.`;
  }

  const drawnCard =
    command === "hit" || command === "double"
      ? next.playerHand.at(-1)
      : undefined;
  const playerTotal = scoreHand(next.playerHand).total;

  if (next.outcome) {
    const result = OUTCOME_COPY[next.outcome];
    const drawIntro = drawnCard ? `You draw ${cardName(drawnCard)}. ` : "";
    return `${drawIntro}${result.title}. ${result.detail} Say deal for another hand.`;
  }

  if (command === "hit") {
    return `You draw ${cardName(drawnCard)}. You're at ${playerTotal}. Hit or stand?`;
  }

  if (command === "stand") {
    return `You stand on ${scoreHand(previous.playerHand).total}.`;
  }

  return `Double confirmed. You draw ${cardName(drawnCard)}.`;
}

function PlayingCard({
  value,
  hidden = false,
  index,
}: {
  value?: Card;
  hidden?: boolean;
  index: number;
}) {
  const red = value?.suit === "hearts" || value?.suit === "diamonds";
  const style = { "--card-index": index } as React.CSSProperties;

  if (hidden) {
    return (
      <div className="playing-card is-hidden" style={style} aria-label="Hidden card">
        <div className="card-back-mark">M</div>
      </div>
    );
  }

  return (
    <div
      className={`playing-card${red ? " is-red" : ""}`}
      style={style}
      aria-label={`${value?.rank} of ${value?.suit}`}
    >
      <span className="card-rank">{value?.rank}</span>
      <span className="card-suit">{value ? SUIT_MARKS[value.suit] : ""}</span>
      <span className="card-suit-large">{value ? SUIT_MARKS[value.suit] : ""}</span>
    </div>
  );
}

function Waveform({ active }: { active: boolean }) {
  return (
    <span className={`waveform${active ? " is-active" : ""}`} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((bar) => (
        <span key={bar} style={{ "--wave-index": bar } as React.CSSProperties} />
      ))}
    </span>
  );
}

export default function Home() {
  const [callStage, setCallStage] = useState<CallStage>("incoming");
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("connecting");
  const [game, setGame] = useState<BlackjackState>(() =>
    createBlackjackGame({ deck: DEMO_DECKS[0] }),
  );
  const [roundIndex, setRoundIndex] = useState(0);
  const [dealerCaption, setDealerCaption] = useState(
    "Ready when you are. Your first hand is waiting.",
  );
  const [heardText, setHeardText] = useState("");
  const [muted, setMuted] = useState(false);
  const [captionsVisible, setCaptionsVisible] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [voiceProvider, setVoiceProvider] = useState<"vapi" | "browser" | "demo">(
    VAPI_CONFIGURED ? "vapi" : "demo",
  );

  const vapiRef = useRef<Vapi | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const callActiveRef = useRef(false);
  const dealerSpeakingRef = useRef(false);
  const mutedRef = useRef(false);
  const gameRef = useRef(game);
  const roundIndexRef = useRef(roundIndex);
  const controlsTimerRef = useRef<number | null>(null);
  const speechTimerRef = useRef<number | null>(null);
  const commandHandlerRef = useRef<(value: string) => void>(() => undefined);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    roundIndexRef.current = roundIndex;
  }, [roundIndex]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const restartBrowserRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    if (
      !recognition ||
      !callActiveRef.current ||
      mutedRef.current ||
      dealerSpeakingRef.current
    ) {
      return;
    }

    window.setTimeout(() => {
      try {
        recognition.start();
      } catch {
        // Recognition is already active. The browser owns this lifecycle.
      }
    }, 180);
  }, []);

  const finishDealerSpeech = useCallback(() => {
    dealerSpeakingRef.current = false;
    if (!callActiveRef.current) return;
    setVoiceMode(mutedRef.current ? "muted" : "listening");
    restartBrowserRecognition();
  }, [restartBrowserRecognition]);

  const speakDealer = useCallback(
    (line: string) => {
      setDealerCaption(line);
      setHeardText("");
      dealerSpeakingRef.current = true;
      setVoiceMode("dealer-speaking");

      try {
        recognitionRef.current?.stop();
      } catch {
        // The recognizer may already be stopped while the dealer speaks.
      }

      if (speechTimerRef.current) window.clearTimeout(speechTimerRef.current);

      if (vapiRef.current) {
        vapiRef.current.say(line, false, true, true);
        speechTimerRef.current = window.setTimeout(
          finishDealerSpeech,
          Math.max(2200, line.length * 42),
        );
        return;
      }

      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(line);
        utterance.rate = 0.96;
        utterance.pitch = 0.9;
        utterance.onend = finishDealerSpeech;
        utterance.onerror = finishDealerSpeech;
        window.speechSynthesis.speak(utterance);
        return;
      }

      speechTimerRef.current = window.setTimeout(
        finishDealerSpeech,
        Math.max(1900, line.length * 38),
      );
    },
    [finishDealerSpeech],
  );

  const applyVoiceCommand = useCallback(
    (rawValue: string) => {
      if (!callActiveRef.current || mutedRef.current) return;

      const command = parseVoiceCommand(rawValue);
      const current = gameRef.current;
      setHeardText(rawValue.trim());

      if (!command) {
        speakDealer(
          current.phase === "settled"
            ? "I didn't catch that. Say deal for another hand."
            : "I didn't catch that. Say hit, stand, or double.",
        );
        return;
      }

      setVoiceMode("processing");

      let next = current;
      if (command === "deal") {
        if (current.phase !== "settled") {
          speakDealer("This hand is still live. Say hit, stand, or double.");
          return;
        }
        const nextRound = (roundIndexRef.current + 1) % DEMO_DECKS.length;
        next = startNewHand(current, { deck: DEMO_DECKS[nextRound] });
        roundIndexRef.current = nextRound;
        setRoundIndex(nextRound);
      } else if (!getAvailableActions(current).includes(command)) {
        speakDealer(
          command === "double"
            ? "Double is only available on your first two cards."
            : "That action isn't available right now.",
        );
        return;
      } else if (command === "hit") {
        next = hit(current);
      } else if (command === "stand") {
        next = stand(current);
      } else {
        next = doubleDown(current);
      }

      gameRef.current = next;
      window.setTimeout(() => {
        setGame(next);
        speakDealer(dealerLineFor(current, next, command));
      }, 360);
    },
    [speakDealer],
  );

  useEffect(() => {
    commandHandlerRef.current = applyVoiceCommand;
  }, [applyVoiceCommand]);

  const startBrowserVoice = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices?.getUserMedia({ audio: true });
      stream?.getTracks().forEach((track) => track.stop());
    } catch {
      // SpeechRecognition may still present its own permission prompt.
    }

    const Recognition =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceProvider("demo");
      setVoiceMode("unavailable");
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript?.trim() ?? "";
        if (result.isFinal) {
          commandHandlerRef.current(transcript);
        } else {
          interim += transcript;
        }
      }
      if (interim) setHeardText(interim);
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setVoiceMode("unavailable");
        setVoiceProvider("demo");
      }
    };
    recognition.onend = restartBrowserRecognition;
    recognitionRef.current = recognition;
    setVoiceProvider("browser");
    restartBrowserRecognition();
  }, [restartBrowserRecognition]);

  const connectVapi = useCallback(async () => {
    if (!VAPI_CONFIGURED) return false;

    try {
      const vapi = new Vapi(VAPI_PUBLIC_KEY);
      vapi.on("call-start", () => {
        setVoiceMode("listening");
        setVoiceProvider("vapi");
      });
      vapi.on("speech-start", () => {
        dealerSpeakingRef.current = true;
        setVoiceMode("dealer-speaking");
      });
      vapi.on("speech-end", finishDealerSpeech);
      vapi.on("message", (message) => {
        if (
          message?.type === "transcript" &&
          message?.role === "user" &&
          (message?.transcriptType === "final" || message?.isFinal === true)
        ) {
          commandHandlerRef.current(String(message.transcript ?? ""));
        }
      });
      vapi.on("error", () => {
        setVoiceProvider("demo");
      });
      vapiRef.current = vapi;
      await vapi.start(VAPI_ASSISTANT_ID);
      return true;
    } catch {
      vapiRef.current?.removeAllListeners();
      vapiRef.current = null;
      setVoiceProvider("demo");
      return false;
    }
  }, [finishDealerSpeech]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimerRef.current) window.clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = window.setTimeout(
      () => setControlsVisible(false),
      4200,
    );
  }, []);

  const answerCall = useCallback(async () => {
    setCallStage("connecting");
    setVoiceMode("connecting");
    callActiveRef.current = true;

    const connectedToVapi = await connectVapi();
    if (!connectedToVapi) await startBrowserVoice();

    setCallStage("active");
    revealControls();
    window.setTimeout(() => {
      speakDealer(
        "Welcome to Midnight. Ten credits are on the table. You have sixteen. Say hit, stand, or double.",
      );
    }, 520);
  }, [connectVapi, revealControls, speakDealer, startBrowserVoice]);

  const endCall = useCallback(async () => {
    callActiveRef.current = false;
    dealerSpeakingRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    window.speechSynthesis?.cancel();
    if (speechTimerRef.current) window.clearTimeout(speechTimerRef.current);

    const vapi = vapiRef.current;
    vapiRef.current = null;
    if (vapi) {
      vapi.removeAllListeners();
      await vapi.stop();
    }

    setCallStage("ended");
  }, []);

  const toggleMute = useCallback(() => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    setMuted(nextMuted);
    vapiRef.current?.setMuted(nextMuted);
    if (nextMuted) {
      recognitionRef.current?.stop();
      setVoiceMode("muted");
    } else {
      setVoiceMode("listening");
      restartBrowserRecognition();
    }
    revealControls();
  }, [restartBrowserRecognition, revealControls]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!callActiveRef.current || event.repeat) return;
      const shortcuts: Record<string, string> = {
        h: "hit",
        s: "stand",
        d: "double",
        n: "deal",
      };
      const command = shortcuts[event.key.toLowerCase()];
      if (command) commandHandlerRef.current(command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(
    () => () => {
      callActiveRef.current = false;
      if (controlsTimerRef.current) window.clearTimeout(controlsTimerRef.current);
      if (speechTimerRef.current) window.clearTimeout(speechTimerRef.current);
      recognitionRef.current?.stop();
      window.speechSynthesis?.cancel();
      void vapiRef.current?.stop();
    },
    [],
  );

  const playerScore = scoreHand(game.playerHand).total;
  const dealerVisibleScore = scoreHand(
    game.phase === "player-turn" ? game.dealerHand.slice(0, 1) : game.dealerHand,
  ).total;
  const actions = getAvailableActions(game);
  const availableCopy =
    game.phase === "settled"
      ? "Say “deal” for another hand"
      : `Say ${actions.map((action) => `“${action}”`).join(", ")}`;
  const statusCopy = useMemo(() => {
    if (voiceMode === "dealer-speaking") return "Mina is speaking";
    if (voiceMode === "listening") return "Listening";
    if (voiceMode === "processing") return "Reading the table";
    if (voiceMode === "muted") return "Microphone muted";
    if (voiceMode === "unavailable") return "Demo voice unavailable";
    return "Connecting voice";
  }, [voiceMode]);

  if (callStage === "incoming" || callStage === "connecting") {
    return (
      <main className="experience-shell">
        <div className="ambient-orb ambient-orb-one" />
        <div className="ambient-orb ambient-orb-two" />
        <section className="device-frame incoming-frame" aria-label="Incoming blackjack call">
          <div className="sheet-handle" aria-hidden="true" />
          <div className="messages-origin">
            <span className="messages-chevron">‹</span>
            <span>Messages</span>
            <span className="messages-context">Mini app</span>
          </div>
          <div className="incoming-visual">
            <Image
              src="/dealer-mina.png"
              alt="Mina, the AI blackjack dealer"
              fill
              priority
              sizes="(max-width: 520px) 100vw, 430px"
            />
            <div className="incoming-vignette" />
          </div>
          <div className="incoming-copy">
            <span className="eyebrow">MIDNIGHT TABLE</span>
            <h1>Mina is calling</h1>
            <p>Voice blackjack · 100 play credits</p>
          </div>
          <div className="incoming-footer">
            <div className="incoming-note">
              <span className="secure-dot" />
              Opened securely from your iMessage
            </div>
            <button
              type="button"
              className="answer-button"
              onClick={answerCall}
              disabled={callStage === "connecting"}
            >
              <span className="phone-glyph" aria-hidden="true">☎</span>
              <span>{callStage === "connecting" ? "Joining…" : "Answer"}</span>
            </button>
            <span className="permission-note">Microphone access is requested once</span>
          </div>
        </section>
        <p className="desktop-hint">Photon mini-app demo · Best viewed on iPhone</p>
      </main>
    );
  }

  if (callStage === "ended") {
    return (
      <main className="experience-shell">
        <section className="device-frame ended-frame">
          <div className="sheet-handle" aria-hidden="true" />
          <div className="ended-content">
            <div className="ended-avatar">
              <Image
                src="/dealer-mina.png"
                alt="Mina, the AI blackjack dealer"
                fill
                sizes="124px"
              />
            </div>
            <span className="eyebrow">CALL ENDED</span>
            <h1>Thanks for playing</h1>
            <p>Your demo balance is {Math.round(game.credits)} credits.</p>
            <button
              type="button"
              className="return-button"
              onClick={() => {
                const reset = createBlackjackGame({ deck: DEMO_DECKS[0] });
                gameRef.current = reset;
                setGame(reset);
                setRoundIndex(0);
                roundIndexRef.current = 0;
                setCallStage("incoming");
                setDealerCaption("Ready when you are. Your first hand is waiting.");
                setHeardText("");
              }}
            >
              Return to invite
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="experience-shell">
      <div className="ambient-orb ambient-orb-one" />
      <div className="ambient-orb ambient-orb-two" />
      <section
        className="device-frame game-frame"
        onPointerDown={revealControls}
        aria-label="Voice blackjack table"
      >
        <div className="sheet-handle" aria-hidden="true" />
        <header className="game-header">
          <button className="header-icon" type="button" onClick={endCall} aria-label="Leave table">
            ‹
          </button>
          <div className="game-title">
            <span>LIVE TABLE</span>
            <strong>BLACKJACK</strong>
          </div>
          <span className="header-icon more-icon" aria-hidden="true">•••</span>
        </header>

        <div className="dealer-stage">
          <Image
            className="dealer-loop"
            src="/dealer-mina.png"
            alt="Mina, your AI blackjack dealer"
            fill
            priority
            sizes="(max-width: 520px) 100vw, 430px"
          />
          <div className="dealer-vignette" />
          <div className="live-pill"><span /> LIVE</div>
          <div className="dealer-identity">
            <span>MINA</span>
            <small>AI dealer · connected</small>
          </div>
          {captionsVisible && (
            <div className="dealer-caption" aria-live="polite">
              {dealerCaption}
            </div>
          )}
        </div>

        <div className="felt-table">
          <div className="table-arc" aria-hidden="true">
            <span>VOICE BLACKJACK</span>
            <small>DEALER STANDS ON 17</small>
          </div>

          <div className="hand dealer-hand">
            <div className="hand-label">
              <span>Dealer</span>
              <strong>{game.phase === "player-turn" ? `${dealerVisibleScore} + ?` : dealerVisibleScore}</strong>
            </div>
            <div className="card-stack">
              {game.dealerHand.map((value, index) => (
                <PlayingCard
                  key={`dealer-${index}-${value.rank}-${value.suit}`}
                  value={value}
                  hidden={game.phase === "player-turn" && index === 1}
                  index={index}
                />
              ))}
            </div>
          </div>

          <div className="hand player-hand">
            <div className="hand-label">
              <span>Your hand</span>
              <strong>{playerScore}</strong>
            </div>
            <div className="card-stack">
              {game.playerHand.map((value, index) => (
                <PlayingCard
                  key={`player-${index}-${value.rank}-${value.suit}`}
                  value={value}
                  index={index}
                />
              ))}
            </div>
          </div>

          <div className="table-hud" aria-label="Play balance and wager">
            <div><span>PLAY CREDITS</span><strong>{Math.round(game.credits)}</strong></div>
            <span className="hud-divider" />
            <div><span>WAGER</span><strong>{game.wager}</strong></div>
          </div>

          {game.outcome && (
            <div className="round-result" aria-live="assertive">
              <span>{OUTCOME_COPY[game.outcome].title}</span>
              <small>{OUTCOME_COPY[game.outcome].detail}</small>
            </div>
          )}
        </div>

        <div className="voice-tray">
          <div className={`voice-orb mode-${voiceMode}`}>
            <Waveform active={voiceMode === "listening" || voiceMode === "dealer-speaking"} />
          </div>
          <div className="voice-copy">
            <div className="voice-status-row">
              <strong>{statusCopy}</strong>
              <span>{voiceProvider === "vapi" ? "VAPI · ELEVENLABS" : "DEMO · VAPI READY"}</span>
            </div>
            <p>{heardText ? `“${titleCase(heardText)}”` : availableCopy}</p>
          </div>
        </div>

        <div className={`call-controls${controlsVisible ? " is-visible" : ""}`}>
          <button type="button" onClick={toggleMute} aria-label={muted ? "Unmute microphone" : "Mute microphone"}>
            <span className={`mic-glyph${muted ? " is-muted" : ""}`} aria-hidden="true" />
            <small>{muted ? "Unmute" : "Mute"}</small>
          </button>
          <button
            type="button"
            onClick={() => {
              setCaptionsVisible((visible) => !visible);
              revealControls();
            }}
            aria-label={captionsVisible ? "Hide captions" : "Show captions"}
          >
            <span className="cc-glyph" aria-hidden="true">CC</span>
            <small>Captions</small>
          </button>
          <button type="button" className="end-call-control" onClick={endCall} aria-label="End call">
            <span aria-hidden="true">☎</span>
            <small>End</small>
          </button>
        </div>
      </section>
      <p className="desktop-hint">Tap the table to show call controls · Voice actions have no buttons</p>
    </main>
  );
}
