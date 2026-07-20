"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { NotebookSound } from "./notebook-sound";

type Phase = "idle" | "writing" | "listening" | "thinking" | "answer" | "error";
type AiState = "checking" | "ready" | "missing" | "offline";

type Answer = {
  question: string;
  answer: string;
};

type HistoryEntry = Answer & {
  id: string;
  drawing: string;
  createdAt: string;
};

type InkBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const WRITING_PAUSE_MS = 3200;
const INK_WORD_GAP_MS = 18;
const HISTORY_STORAGE_KEY = "enchanted-notebook-history";
const NOTEBOOK_ID_STORAGE_KEY = "enchanted-notebook-id";
const MAX_HISTORY_ENTRIES = 12;
const EMPTY_BOUNDS: InkBounds = {
  minX: Number.POSITIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
  maxX: 0,
  maxY: 0,
};

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [aiState, setAiState] = useState<AiState>("checking");
  const [model, setModel] = useState("gemini-3.1-flash-lite");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [answerComplete, setAnswerComplete] = useState(false);
  const [error, setError] = useState("");
  const [soundMuted, setSoundMuted] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [onlineHistoryEnabled, setOnlineHistoryEnabled] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const soundRef = useRef<NotebookSound | null>(null);
  if (!soundRef.current || typeof soundRef.current.startPen !== "function") {
    soundRef.current = new NotebookSound();
  }
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);
  const inkLengthRef = useRef(0);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const boundsRef = useRef<InkBounds>({ ...EMPTY_BOUNDS });
  const pauseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const savedMuted = window.localStorage.getItem("enchanted-notebook-muted") === "true";
    soundRef.current?.setMuted(savedMuted);

    void checkGemini();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const nextWidth = Math.round(rect.width * dpr);
      const nextHeight = Math.round(rect.height * dpr);
      if (!nextWidth || !nextHeight || (canvas.width === nextWidth && canvas.height === nextHeight)) return;

      const copy = document.createElement("canvas");
      copy.width = canvas.width;
      copy.height = canvas.height;
      copy.getContext("2d")?.drawImage(canvas, 0, 0);

      canvas.width = nextWidth;
      canvas.height = nextHeight;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(dpr, dpr);
      prepareInk(context);
      if (copy.width && copy.height) {
        context.drawImage(copy, 0, 0, copy.width / dpr, copy.height / dpr);
      }
    };

    const preferenceFrame = requestAnimationFrame(() => {
      setSoundMuted(savedMuted);
      setHistory(readHistory());
    });
    const frame = requestAnimationFrame(resizeCanvas);
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(preferenceFrame);
      observer.disconnect();
      if (pauseTimerRef.current) window.clearTimeout(pauseTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!historyOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHistoryOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [historyOpen]);

  function toggleSound() {
    const nextMuted = !soundMuted;
    soundRef.current?.setMuted(nextMuted);
    if (!nextMuted) soundRef.current?.unlock();
    window.localStorage.setItem("enchanted-notebook-muted", String(nextMuted));
    setSoundMuted(nextMuted);
  }

  useEffect(() => {
    if (!answer) return;
    soundRef.current?.startPen("answer");
    const timer = window.setTimeout(
      () => {
        setAnswerComplete(true);
        soundRef.current?.stopPen("answer");
      },
      answerInkDuration(answer.answer) + 350,
    );
    return () => {
      window.clearTimeout(timer);
      soundRef.current?.stopPen("answer");
    };
  }, [answer]);

  async function checkGemini() {
    setAiState("checking");
    try {
      const response = await fetch("/api/ask", { cache: "no-store" });
      const data = (await response.json()) as {
        available?: boolean;
        installed?: boolean;
        model?: string;
        onlineHistory?: boolean;
      };
      setModel(data.model || "gemini-3.1-flash-lite");
      setOnlineHistoryEnabled(Boolean(data.onlineHistory));
      setAiState(data.available && data.installed ? "ready" : data.available ? "missing" : "offline");
    } catch {
      setAiState("offline");
    }
  }

  function beginStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (phase === "thinking") return;

    soundRef.current?.unlock();

    if (phase === "answer" || phase === "error") {
      soundRef.current?.pageTurn();
      resetPage();
    }
    cancelPauseDetection();

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    hasInkRef.current = true;
    setPhase("writing");
    setError("");

    const point = canvasPoint(canvas, event.nativeEvent);
    lastPointRef.current = point;
    updateBounds(point);
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineTo(point.x + 0.1, point.y + 0.1);
    context.stroke();
    soundRef.current?.nibDown();
    soundRef.current?.startPen("user");
  }

  function continueStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const events = event.nativeEvent.getCoalescedEvents?.() || [event.nativeEvent];
    for (const pointerEvent of events) {
      const point = canvasPoint(canvas, pointerEvent);
      const previous = lastPointRef.current;
      if (previous) inkLengthRef.current += Math.hypot(point.x - previous.x, point.y - previous.y);
      lastPointRef.current = point;
      updateBounds(point);

      const pressure = pointerEvent.pressure || 0.5;
      context.lineWidth = pointerEvent.pointerType === "pen" ? 1.8 + pressure * 2.8 : 3.6;
      context.lineTo(point.x, point.y);
      context.stroke();
    }
  }

  function endStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false;
    lastPointRef.current = null;
    soundRef.current?.stopPen("user");
    if (canvasRef.current?.hasPointerCapture(event.pointerId)) {
      canvasRef.current.releasePointerCapture(event.pointerId);
    }
    schedulePauseDetection();
  }

  function schedulePauseDetection() {
    cancelPauseDetection();
    if (!hasInkRef.current || inkLengthRef.current < 45) {
      setPhase("writing");
      return;
    }
    setPhase("listening");
    soundRef.current?.listening();
    pauseTimerRef.current = window.setTimeout(() => {
      void submitHandwriting();
    }, WRITING_PAUSE_MS);
  }

  function cancelPauseDetection() {
    if (pauseTimerRef.current) {
      window.clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
  }

  async function submitHandwriting() {
    const canvas = canvasRef.current;
    if (!canvas || !hasInkRef.current || phase === "thinking") return;
    cancelPauseDetection();
    setPhase("thinking");
    setError("");

    const bounds = boundsRef.current;

    try {
      const image = exportCanvas(canvas, bounds);
      const drawing = exportCanvas(canvas, bounds, {
        maxWidth: 560,
        maxHeight: 260,
        type: "image/webp",
        quality: 0.72,
      });
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, notebookId: getNotebookId() }),
      });
      const data = (await response.json()) as {
        question?: string;
        answer?: string;
        error?: string;
      };
      if (!response.ok || !data.answer) throw new Error(data.error || "The page remained silent.");

      setAnswerComplete(false);
      const nextAnswer = {
        question: data.question || "Your handwritten question",
        answer: data.answer,
      };
      setAnswer(nextAnswer);
      saveHistoryEntry({
        id: createHistoryId(),
        ...nextAnswer,
        drawing,
        createdAt: new Date().toISOString(),
      });
      setPhase("answer");
      soundRef.current?.answer();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "The page remained silent.");
      setPhase("error");
      void checkGemini();
    }
  }

  function updateBounds(point: { x: number; y: number }) {
    const bounds = boundsRef.current;
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.maxY = Math.max(bounds.maxY, point.y);
  }

  function resetPage() {
    cancelPauseDetection();
    clearCanvas(canvasRef.current);
    drawingRef.current = false;
    hasInkRef.current = false;
    inkLengthRef.current = 0;
    lastPointRef.current = null;
    boundsRef.current = { ...EMPTY_BOUNDS };
    setAnswer(null);
    setAnswerComplete(false);
    setError("");
    setPhase("idle");
  }

  function saveHistoryEntry(entry: HistoryEntry) {
    setHistory((current) => persistHistory([entry, ...current].slice(0, MAX_HISTORY_ENTRIES)));
  }

  function deleteHistoryEntry(id: string) {
    setHistory((current) => persistHistory(current.filter((entry) => entry.id !== id)));
  }

  function clearHistory() {
    setHistory(persistHistory([]));
  }

  return (
    <main className={`enchanted-canvas phase-${phase}`}>
      <div className="paper-lines" aria-hidden="true" />
      <div className="paper-margin" aria-hidden="true" />
      <div className="paper-grain" aria-hidden="true" />

      <header className="quiet-header" aria-live="polite">
        <div>
          <p>THE ENCHANTED NOTEBOOK</p>
          <time>{formatDate(new Date())}</time>
        </div>
        <p className={`whisper-status ai-${aiState}`}>{statusText(phase, aiState, model)}</p>
      </header>

      <div className="notebook-controls">
        <button
          className="notebook-control history-toggle"
          type="button"
          aria-label="Open notebook history"
          aria-expanded={historyOpen}
          aria-controls="notebook-history"
          onClick={() => setHistoryOpen(true)}
        >
          <span aria-hidden="true">☰</span>
          History{history.length > 0 ? ` · ${history.length}` : ""}
        </button>
        <button
          className="notebook-control sound-toggle"
          type="button"
          aria-label={soundMuted ? "Turn notebook sounds on" : "Mute notebook sounds"}
          aria-pressed={soundMuted}
          onClick={toggleSound}
        >
          <span aria-hidden="true">{soundMuted ? "♪̸" : "♪"}</span>
          {soundMuted ? "Sound off" : "Sound on"}
        </button>
      </div>

      {phase === "idle" && (
        <p className="write-hint">Write a question anywhere on the page…</p>
      )}

      <canvas
        ref={canvasRef}
        className="full-ink-canvas"
        onPointerDown={beginStroke}
        onPointerMove={continueStroke}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        aria-label="Write a question with your finger, stylus, or mouse. The notebook answers automatically after you pause."
      />

      {(phase === "listening" || phase === "thinking") && (
        <div className="magic-listener" aria-hidden="true">
          <i /><i /><i />
        </div>
      )}

      {answer && (
        <article className={`written-answer ${answerLengthClass(answer.answer)}`} aria-live="polite">
          <span className="answer-flourish" aria-hidden="true">✦</span>
          <p aria-label={answer.answer}>
            <span aria-hidden="true">{renderInkWords(answer.answer)}</span>
          </p>
          {answerComplete && (
            <small>Begin writing to turn the page</small>
          )}
        </article>
      )}

      {phase === "error" && (
        <div className="page-error" role="alert">
          <p>{error}</p>
          <small>Begin writing to try a fresh page</small>
        </div>
      )}

      {historyOpen && (
        <div className="history-layer">
          <button
            className="history-backdrop"
            type="button"
            aria-label="Close notebook history"
            onClick={() => setHistoryOpen(false)}
          />
          <aside
            className="history-drawer"
            id="notebook-history"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-title"
          >
            <header className="history-header">
              <div>
                <p>PAST PAGES</p>
                <h2 id="history-title">Notebook history</h2>
              </div>
              <button type="button" aria-label="Close notebook history" onClick={() => setHistoryOpen(false)}>
                ×
              </button>
            </header>

            <p className="history-privacy">
              {onlineHistoryEnabled
                ? "Shown here on this device. Answered pages are also stored privately by the notebook owner."
                : "Saved only in this browser on this device."}
            </p>

            {history.length === 0 ? (
              <div className="history-empty">
                <span aria-hidden="true">✦</span>
                <p>Your answered pages will gather here.</p>
              </div>
            ) : (
              <div className="history-list">
                {history.map((entry) => (
                  <article className="history-entry" key={entry.id}>
                    <div className="history-entry-heading">
                      <time dateTime={entry.createdAt}>{formatHistoryDate(entry.createdAt)}</time>
                      <button
                        type="button"
                        aria-label={`Remove local history entry from ${formatHistoryDate(entry.createdAt)}`}
                        onClick={() => deleteHistoryEntry(entry.id)}
                      >
                        Remove locally
                      </button>
                    </div>
                    {/* A data URL is required because history is intentionally device-local. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={entry.drawing} alt="Your handwritten question" />
                    <p className="history-question">“{entry.question}”</p>
                    <p className="history-answer">{entry.answer}</p>
                  </article>
                ))}
              </div>
            )}

            {history.length > 0 && (
              <button className="clear-history" type="button" onClick={clearHistory}>
                Clear local history
              </button>
            )}
          </aside>
        </div>
      )}

      <div className="magic-motes" aria-hidden="true">
        {Array.from({ length: 14 }, (_, index) => <i key={index} />)}
      </div>
    </main>
  );
}

function prepareInk(context: CanvasRenderingContext2D) {
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "#26334d";
  context.shadowColor = "rgba(31, 42, 65, 0.12)";
  context.shadowBlur = 0.5;
}

function canvasPoint(canvas: HTMLCanvasElement, event: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.restore();
}

function exportCanvas(
  canvas: HTMLCanvasElement,
  bounds: InkBounds,
  options: {
    maxWidth?: number;
    maxHeight?: number;
    type?: "image/png" | "image/webp";
    quality?: number;
  } = {},
) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const padding = 64;
  const sourceX = Math.max(0, (bounds.minX - padding) * dpr);
  const sourceY = Math.max(0, (bounds.minY - padding) * dpr);
  const sourceWidth = Math.min(canvas.width - sourceX, (bounds.maxX - bounds.minX + padding * 2) * dpr);
  const sourceHeight = Math.min(canvas.height - sourceY, (bounds.maxY - bounds.minY + padding * 2) * dpr);
  const exportScale = Math.max(
    0.05,
    Math.min(3, (options.maxWidth || 1600) / sourceWidth, (options.maxHeight || 700) / sourceHeight),
  );

  const exported = document.createElement("canvas");
  exported.width = Math.max(1, Math.round(sourceWidth * exportScale));
  exported.height = Math.max(1, Math.round(sourceHeight * exportScale));
  const context = exported.getContext("2d");
  if (!context) return "";
  context.fillStyle = "#fffdf7";
  context.fillRect(0, 0, exported.width, exported.height);
  context.drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, exported.width, exported.height);
  return exported.toDataURL(options.type || "image/png", options.quality);
}

function readHistory(): HistoryEntry[] {
  try {
    const saved = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHistoryEntry).slice(0, MAX_HISTORY_ENTRIES);
  } catch {
    return [];
  }
}

function persistHistory(entries: HistoryEntry[]) {
  let saved = entries;
  while (true) {
    try {
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(saved));
      return saved;
    } catch {
      if (saved.length === 0) return [];
      saved = saved.slice(0, -1);
    }
  }
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<HistoryEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.drawing === "string" &&
    typeof entry.question === "string" &&
    typeof entry.answer === "string" &&
    typeof entry.createdAt === "string"
  );
}

function createHistoryId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getNotebookId() {
  try {
    const saved = window.localStorage.getItem(NOTEBOOK_ID_STORAGE_KEY);
    if (saved) return saved;

    const id = globalThis.crypto.randomUUID();
    window.localStorage.setItem(NOTEBOOK_ID_STORAGE_KEY, id);
    return id;
  } catch {
    return globalThis.crypto.randomUUID();
  }
}

function formatHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved page";
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function renderInkWords(text: string) {
  let elapsed = 0;

  return text.split(/(\s+)/).map((token, index) => {
    if (/^\s+$/.test(token)) return token;
    const duration = wordInkDuration(token);
    const delay = elapsed;
    elapsed += duration + INK_WORD_GAP_MS;

    const style = {
      "--ink-delay": `${delay}ms`,
      "--ink-duration": `${duration}ms`,
    } as CSSProperties;

    return (
      <span className="ink-word" data-word={token} style={style} key={`${index}-${token}`}>
        {token}
      </span>
    );
  });
}

function wordInkDuration(word: string) {
  return Math.max(160, word.length * 70);
}

function answerInkDuration(text: string) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .reduce((duration, word) => duration + wordInkDuration(word) + INK_WORD_GAP_MS, 0);
}

function answerLengthClass(text: string) {
  if (text.length > 260) return "answer-very-long";
  if (text.length > 150) return "answer-long";
  return "answer-short";
}

function statusText(phase: Phase, aiState: AiState, model: string) {
  if (aiState === "checking") return "Waking the ink…";
  if (aiState === "missing") return "Add GEMINI_API_KEY to wake the notebook";
  if (aiState === "offline") return "Gemini is unavailable";
  if (phase === "writing") return "The page is following your pen";
  if (phase === "listening") return "Pause detected · listening…";
  if (phase === "thinking") return "The ink is thinking…";
  if (phase === "answer") return "The page has answered";
  return `Gemini ready · ${model}`;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}
