import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { ArrivalRing, Cursor, EdgeWash } from './Cursors';
import { InkPath } from './InkPath';
import { Dots, Mirror, type MirrorMode, type Verify } from './Mirror';
import { MIN_PEN_PX, penSize } from './pen';
import { useArrivals } from './useArrivals';
import { useMirror } from './useMirror';
import { BOARD, useWhiteboard, type Status, type Stroke } from './useWhiteboard';

const PORTFOLIO_URL = 'https://rokass.org/work/collab-canvas/';
const SOURCE_URL = 'https://github.com/rokas-th/collab-canvas';
const CLEARED_PILL_MS = 5000;
const COPIED_MS = 1600;
const UNFOLD_MS = 2000;
const FLASH_MS = 420;
const VERIFIED_MS = 1800;

function getRoom(): string {
  const url = new URL(window.location.href);
  let room = url.searchParams.get('room');
  if (!room) {
    room = Math.random().toString(36).slice(2, 8);
    url.searchParams.set('room', room);
    window.history.replaceState({}, '', url);
  }
  return room;
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
const round1 = (v: number) => Math.round(v * 10) / 10;
const pressureOf = (e: PointerEvent) => Math.round(clamp(e.pressure, 0, 1) * 100) / 100;

const MAX_ZOOM = 6;

interface View {
  k: number;
  x: number;
  y: number;
}

interface Gesture {
  view: View;
  anchor: { x: number; y: number };
  distance: number;
}

const FIT: View = { k: 1, x: 0, y: 0 };

function clientToSvg(svg: SVGSVGElement, x: number, y: number): DOMPoint {
  const ctm = svg.getScreenCTM();
  if (!ctm) throw new Error('Whiteboard SVG has no screen transform');
  return new DOMPoint(x, y).matrixTransform(ctm.inverse());
}

function clampView(svg: SVGSVGElement, view: View): View {
  const rect = svg.getBoundingClientRect();
  const min = clientToSvg(svg, rect.left, rect.top);
  const max = clientToSvg(svg, rect.right, rect.bottom);
  const axis = (t: number, lo: number, hi: number, size: number) => {
    const a = lo;
    const b = hi - size * view.k;
    return clamp(t, Math.min(a, b), Math.max(a, b));
  };
  return {
    k: view.k,
    x: axis(view.x, min.x, max.x, BOARD.width),
    y: axis(view.y, min.y, max.y, BOARD.height),
  };
}

const STATUS_META: Record<Status, { color: string; label: string; pill: string | null }> = {
  connected: { color: '#10b981', label: 'live', pill: null },
  connecting: { color: '#f59e0b', label: 'connecting', pill: 'Connecting to the room…' },
  reconnecting: { color: '#f59e0b', label: 'reconnecting', pill: 'Connection lost — reconnecting…' },
  failed: { color: '#ef4444', label: 'offline', pill: 'Offline — only this browser sees your drawing.' },
};

const STATUSES = Object.keys(STATUS_META) as Status[];

type HintKey = 'connecting' | 'reconnecting' | 'mirror' | 'plain' | 'failed';

const HINT: Record<HintKey, string> = {
  connecting: 'Connecting to the room. Start drawing now: your strokes sync as soon as it is live.',
  reconnecting: 'The connection dropped and is coming back. Keep drawing: your strokes sync when it is live again.',
  mirror:
    'The small screen in the corner is a second connection to this room. It shows what anyone you share the link with would see.',
  plain: 'Open this room in a second tab or on your phone. Strokes and cursors show up there as you draw.',
  failed:
    'The realtime server can’t be reached, so only tabs in this browser see this board. It reconnects on its own.',
};

const HINT_KEYS = Object.keys(HINT) as HintKey[];

type ShareState = 'idle' | 'copied' | 'manual';

function Swap<K extends string>({ active, options }: { active: K; options: [K, ReactNode][] }) {
  return (
    <span className="grid">
      {options.map(([key, node]) => (
        <span
          key={key}
          aria-hidden={key !== active}
          className={`col-start-1 row-start-1 ${key === active ? '' : 'invisible'}`}
        >
          {node}
        </span>
      ))}
    </span>
  );
}

const PANEL =
  'pointer-events-auto flex h-14 items-center rounded-xl border border-black/10 bg-white/90 shadow-sm backdrop-blur max-sm:w-full';
const GHOST_BUTTON =
  'rounded-lg px-2.5 py-1 text-sm text-black/70 hover:bg-black/5 disabled:cursor-not-allowed disabled:text-black/30 disabled:hover:bg-transparent pointer-coarse:h-10';
const SOLID_BUTTON =
  'min-w-[4.5rem] rounded-lg bg-black px-3 py-1 text-sm font-medium text-white hover:bg-black/80 pointer-coarse:h-10';
const MONO_LABEL = 'font-mono text-[10px] uppercase tracking-[0.2em] text-black/60';

export default function App() {
  const [room] = useState(getRoom);
  const {
    strokes,
    malformed,
    peers,
    status,
    synced,
    me,
    canUndo,
    outbox,
    addStroke,
    clear,
    undo,
    redo,
    setCursor,
    clearCursor,
    setDraft,
  } = useWhiteboard(room);

  const [pen, setPen] = useState('');
  const penColor = pen || me.color;

  const svgRef = useRef<SVGSVGElement>(null);
  const boardRef = useRef<SVGGElement>(null);
  const [scale, setScale] = useState(1);
  const [view, setView] = useState<View>(FIT);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const pointerId = useRef<number | null>(null);
  const currentRef = useRef<Stroke | null>(null);
  const [current, setCurrent] = useState<Stroke | null>(null);

  const [started, setStarted] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [shareState, setShareState] = useState<ShareState>('idle');
  const shareInputRef = useRef<HTMLInputElement>(null);

  const [everSynced, setEverSynced] = useState(false);
  if (synced && !everSynced) setEverSynced(true);
  const live = status === 'connected' && synced;
  const [folded, setFolded] = useState(false);
  const [mirrorH, setMirrorH] = useState(0);
  const [verify, setVerify] = useState<Verify>(null);
  const [notice, setNotice] = useState('');
  const verifiedOnce = useRef(false);
  const verifyTimers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const arrivals = useArrivals(peers, everSynced);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) throw new Error('Whiteboard SVG is not mounted');
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setScale(Math.min(width / BOARD.width, height / BOARD.height));
      setView(FIT);
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!live) return;
    if (peers.length > 0) {
      setFolded(true);
      return;
    }
    const t = setTimeout(() => setFolded(false), UNFOLD_MS);
    return () => clearTimeout(t);
  }, [live, peers.length]);

  useEffect(() => {
    const pending = verifyTimers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const onMark = useCallback(() => {
    if (verifiedOnce.current) return;
    verifiedOnce.current = true;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setVerify(still ? 'verified' : 'flash');
    setNotice('Sync verified: the second connection received your ink through the server.');
    const later = (ms: number, next: Verify) => {
      const t = setTimeout(() => {
        verifyTimers.current.delete(t);
        setVerify(next);
      }, ms);
      verifyTimers.current.add(t);
    };
    if (!still) later(FLASH_MS, 'verified');
    later(VERIFIED_MS, null);
  }, []);

  const mirrorOff = peers.length > 0 || folded;
  const mirror = useMirror(room, outbox, everSynced && !mirrorOff && status !== 'failed', onMark);
  const mirrorMode: MirrorMode =
    status === 'failed' ? 'unreachable' : mirrorOff ? 'off' : mirror.status === 'failed' ? 'unreachable' : 'live';
  const mirrorReason = status === 'failed' ? 'server unreachable' : 'the mirror can’t connect';
  const mirrorCaption = mirror.synced
    ? `${mirror.rtt === null ? '—' : mirror.rtt < 10 ? mirror.rtt.toFixed(1) : Math.round(mirror.rtt)} ms via PartyKit`
    : status === 'reconnecting' || mirror.status === 'reconnecting'
      ? 'reconnecting to PartyKit…'
      : 'connecting to PartyKit…';

  const undoLast = useCallback(() => {
    undo();
    setCleared(false);
  }, [undo]);

  const redoLast = useCallback(() => {
    redo();
    setCleared(false);
  }, [redo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.target instanceof HTMLInputElement) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoLast();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redoLast();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undoLast, redoLast]);

  useEffect(() => {
    if (!cleared) return;
    const t = setTimeout(() => setCleared(false), CLEARED_PILL_MS);
    return () => clearTimeout(t);
  }, [cleared]);

  useEffect(() => {
    if (shareState !== 'copied') return;
    const t = setTimeout(() => setShareState('idle'), COPIED_MS);
    return () => clearTimeout(t);
  }, [shareState]);

  useEffect(() => {
    if (shareState === 'manual') shareInputRef.current?.focus();
  }, [shareState]);

  const toBoard = (e: PointerEvent<SVGSVGElement>): { x: number; y: number; inside: boolean } => {
    const board = boardRef.current;
    if (!board) throw new Error('Whiteboard board group is not mounted');
    const ctm = board.getScreenCTM();
    if (!ctm) throw new Error('Whiteboard board has no screen transform');
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const inside = p.x >= 0 && p.y >= 0 && p.x <= BOARD.width && p.y <= BOARD.height;
    return { x: round1(clamp(p.x, 0, BOARD.width)), y: round1(clamp(p.y, 0, BOARD.height)), inside };
  };

  const pinch = (svg: SVGSVGElement) => {
    const [a, b] = [...touches.current.values()];
    const anchor = clientToSvg(svg, (a.x + b.x) / 2, (a.y + b.y) / 2);
    return { anchor: { x: anchor.x, y: anchor.y }, distance: Math.hypot(a.x - b.x, a.y - b.y) };
  };

  const track = (stroke: Stroke | null) => {
    currentRef.current = stroke;
    setCurrent(stroke);
  };

  const abortStroke = () => {
    pointerId.current = null;
    if (!currentRef.current) return;
    track(null);
    setDraft(null);
  };

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size >= 2) {
        abortStroke();
        clearCursor();
        if (touches.current.size === 2) gesture.current = { view, ...pinch(e.currentTarget) };
        return;
      }
    }
    if (pointerId.current !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const { x, y, inside } = toBoard(e);
    if (!inside) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerId.current = e.pointerId;
    const stroke: Stroke = {
      id: crypto.randomUUID(),
      color: penColor,
      points: [x, y],
      ...(e.pointerType === 'pen' ? { pressure: [pressureOf(e)] } : {}),
    };
    track(stroke);
    setDraft(stroke);
    setStarted(true);
    setCleared(false);
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const start = gesture.current;
      if (start && touches.current.size === 2) {
        const svg = e.currentTarget;
        const now = pinch(svg);
        const k = clamp((start.view.k * now.distance) / start.distance, 1, MAX_ZOOM);
        const bx = (start.anchor.x - start.view.x) / start.view.k;
        const by = (start.anchor.y - start.view.y) / start.view.k;
        setView(clampView(svg, { k, x: now.anchor.x - k * bx, y: now.anchor.y - k * by }));
        return;
      }
      if (start) return;
    }
    const { x, y, inside } = toBoard(e);
    if (pointerId.current === e.pointerId) {
      const prev = currentRef.current;
      if (!prev) throw new Error('Pointer is drawing without a stroke in progress');
      const next: Stroke = {
        ...prev,
        points: [...prev.points, x, y],
        ...(prev.pressure ? { pressure: [...prev.pressure, pressureOf(e)] } : {}),
      };
      track(next);
      setDraft(next);
      return;
    }
    if (pointerId.current !== null) return;
    if (inside) setCursor(x, y);
    else clearCursor();
  };

  const finish = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch') {
      touches.current.delete(e.pointerId);
      if (touches.current.size === 0) gesture.current = null;
    }
    if (pointerId.current !== e.pointerId) return;
    pointerId.current = null;
    const stroke = currentRef.current;
    if (!stroke) throw new Error('Pointer finished without a stroke in progress');
    track(null);
    const dot = stroke.points.length === 2;
    addStroke({
      ...stroke,
      points: dot ? [...stroke.points, ...stroke.points] : stroke.points,
      ...(stroke.pressure ? { pressure: dot ? [...stroke.pressure, ...stroke.pressure] : stroke.pressure } : {}),
    });
  };

  const onLeave = () => {
    if (pointerId.current === null) clearCursor();
  };

  const clearBoard = () => {
    clear();
    setCleared(true);
  };

  const share = useCallback(async () => {
    const url = window.location.href;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    if (coarse && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Collab Canvas', text: 'Draw with me on this board', url });
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setShareState('manual');
      }
      return;
    }
    if (!navigator.clipboard) {
      setShareState('manual');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareState('copied');
    } catch {
      setShareState('manual');
    }
  }, []);

  const openSecondTab = () => {
    window.open(window.location.href, '_blank', 'noopener');
  };

  const statusMeta = STATUS_META[status];
  const unfolding = live && peers.length === 0 && folded;
  const showHint = !started && strokes.length === 0 && peers.length === 0 && !unfolding;
  const liveHint: HintKey = status === 'connected' ? (mirrorMode === 'live' ? 'mirror' : 'plain') : status;
  const [hintKey, setHintKey] = useState(liveHint);
  if (showHint && hintKey !== liveHint) setHintKey(liveHint);
  const tabFirst = hintKey === 'plain' || hintKey === 'failed';
  const offline = status === 'failed';
  const badInk = peers.filter((p) => p.badInk).map((p) => p.name);
  const onScreen = scale * view.k;
  const cursorScale = 1 / onScreen;
  const size = penSize(onScreen, MIN_PEN_PX);
  const floor = MIN_PEN_PX / onScreen;
  const zoomed = view.k !== 1 || view.x !== 0 || view.y !== 0;
  const committed = useMemo(() => new Set(strokes.map((s) => s.id)), [strokes]);
  const presentColors = [me.color, ...peers.map((p) => p.color)];

  return (
    <main
      className="relative h-dvh w-full touch-none select-none overflow-hidden bg-[#ecebe6]"
      style={{ '--mirror-h': `${mirrorH}px` } as CSSProperties}
    >
      <svg
        ref={svgRef}
        role="img"
        aria-label="Shared whiteboard"
        viewBox={`0 0 ${BOARD.width} ${BOARD.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-full w-full cursor-crosshair"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onPointerLeave={onLeave}
      >
        <defs>
          <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1.1" fill="#d8d8d2" />
          </pattern>
        </defs>
        <g ref={boardRef} transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <rect width={BOARD.width} height={BOARD.height} fill="#f6f6f4" />
          <rect
            width={BOARD.width}
            height={BOARD.height}
            fill="url(#dots)"
            stroke="rgba(0,0,0,0.08)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />

          <g data-layer="committed">
            {strokes.map((s) => (
              <InkPath key={s.id} stroke={s} size={size} floor={floor} layer="committed" />
            ))}
          </g>

          <g data-layer="draft">
            {peers.map(({ id, draft }) =>
              draft && !committed.has(draft.id) ? (
                <InkPath key={id} stroke={draft} size={size} floor={floor} layer="draft" />
              ) : null,
            )}
          </g>

          {current && <InkPath stroke={current} size={size} floor={floor} layer="own" />}

          {arrivals.rings.map((ring) => (
            <ArrivalRing key={ring.key} ring={ring} scale={cursorScale} onDone={arrivals.dropRing} />
          ))}

          {peers.map(({ id, name, color, cursor }) =>
            cursor ? (
              <Cursor
                key={id}
                name={name}
                color={color}
                x={cursor.x}
                y={cursor.y}
                scale={cursorScale}
                joining={arrivals.joining.has(id)}
              />
            ) : null,
          )}

          {arrivals.wash && (
            <EdgeWash
              key={arrivals.wash.key}
              wash={arrivals.wash}
              width={BOARD.width}
              height={BOARD.height}
              inset={0.5 / onScreen}
            />
          )}
        </g>
      </svg>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 p-4 sm:gap-3">
        <div data-panel className={`${PANEL} flex-col items-stretch justify-center gap-0.5 px-4`}>
          <div className="flex items-center gap-4 whitespace-nowrap max-[359px]:gap-2">
            <h1 className={`${MONO_LABEL} max-[359px]:tracking-[0.12em]`}>Collab Canvas</h1>
            <span className="ml-auto flex items-center gap-2 font-mono text-[10px] tracking-[0.08em] text-black/60 max-[359px]:gap-1.5">
              <a
                href={PORTFOLIO_URL}
                className="-my-2 py-2 underline decoration-black/20 underline-offset-2 hover:text-black hover:decoration-black/60"
              >
                rokass.org ↗
              </a>
              <span aria-hidden="true">·</span>
              <a
                href={SOURCE_URL}
                className="-my-2 py-2 underline decoration-black/20 underline-offset-2 hover:text-black hover:decoration-black/60"
              >
                source ↗
              </a>
            </span>
          </div>
          <div className="flex items-center gap-4 whitespace-nowrap">
            <p className="min-w-0 truncate text-sm font-semibold">
              Room <span className="font-mono">{room}</span>
            </p>
            <span data-status={status} className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-black/60">
              <span className="h-2 w-2 rounded-full" style={{ background: statusMeta.color }} />
              <Swap active={status} options={STATUSES.map((key) => [key, STATUS_META[key].label])} />
            </span>
          </div>
        </div>

        <div data-panel className={`${PANEL} relative gap-2 px-3 max-sm:justify-between max-[359px]:gap-1`}>
          <span data-online className="flex items-center gap-1.5 whitespace-nowrap text-xs text-black/60">
            <Dots colors={presentColors} />
            <span>
              {peers.length + 1}
              <span className="max-[359px]:sr-only"> online</span>
            </span>
          </span>
          <label className="flex items-center gap-1.5 text-xs text-black/60 pointer-coarse:h-10">
            <span className="max-sm:sr-only">Pen</span>
            <input
              type="color"
              value={penColor}
              onChange={(e) => setPen(e.target.value)}
              className="size-7 cursor-pointer appearance-none rounded-full border border-black/15 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0"
            />
          </label>
          <button type="button" onClick={undoLast} disabled={!canUndo} className={GHOST_BUTTON}>
            Undo
          </button>
          <button
            type="button"
            onClick={clearBoard}
            disabled={strokes.length + malformed === 0}
            className={GHOST_BUTTON}
          >
            Clear
          </button>
          <button type="button" onClick={share} hidden={offline} className={SOLID_BUTTON}>
            {shareState === 'copied' ? 'Copied' : 'Share'}
          </button>
          <span className="sr-only" aria-live="polite">
            {shareState === 'copied' ? 'Room link copied to the clipboard' : ''}
          </span>

          {shareState === 'manual' && (
            <div
              role="dialog"
              aria-label="Copy the room link"
              className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-black/10 bg-white p-3 shadow-sm"
              onKeyDown={(e) => e.key === 'Escape' && setShareState('idle')}
            >
              <p className="text-xs text-black/70">Copying was blocked by the browser. Copy the link yourself:</p>
              <input
                ref={shareInputRef}
                readOnly
                value={window.location.href}
                onFocus={(e) => e.currentTarget.select()}
                className="mt-2 w-full rounded-lg border border-black/15 bg-[#f6f6f4] px-2 py-1.5 font-mono text-xs select-all"
              />
              <button type="button" onClick={() => setShareState('idle')} className={`${GHOST_BUTTON} mt-2`}>
                Close
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        data-hint={hintKey}
        inert={!showHint}
        aria-hidden={!showHint}
        className={`pointer-events-none absolute inset-0 flex items-end justify-center px-4 pb-[calc(var(--mirror-h)+64px)] transition-opacity duration-300 motion-reduce:transition-none sm:items-center sm:pb-[calc(var(--mirror-h)+16px)] ${showHint ? 'opacity-100' : 'opacity-0'}`}
      >
        <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-white px-5 py-4 shadow-sm">
          <p className={MONO_LABEL}>Empty board</p>
          <p className="mt-1 text-lg font-semibold">Draw anywhere.</p>
          <p className="mt-1 text-sm text-black/70">
            <Swap active={hintKey} options={HINT_KEYS.map((key) => [key, HINT[key]])} />
          </p>
          <p className="mt-1 hidden text-sm text-black/70 pointer-coarse:block">Pinch with two fingers to zoom in.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {tabFirst && (
              <button
                type="button"
                onClick={openSecondTab}
                className={`${SOLID_BUTTON} ${showHint ? 'pointer-events-auto' : ''}`}
              >
                Open second tab ↗
              </button>
            )}
            {hintKey !== 'failed' && (
              <button
                type="button"
                onClick={share}
                className={`${tabFirst ? GHOST_BUTTON : SOLID_BUTTON} ${showHint ? 'pointer-events-auto' : ''}`}
              >
                {shareState === 'copied' ? 'Link copied' : 'Share link'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-2 px-4">
        <Mirror
          mode={mirrorMode}
          reason={mirrorReason}
          caption={mirrorCaption}
          strokes={mirror.strokes}
          peers={mirror.peers}
          verify={verify}
          devices={peers.length + 1}
          colors={presentColors}
          onCardHeight={setMirrorH}
        />
        {zoomed && (
          <button
            type="button"
            onClick={() => setView(FIT)}
            className="pointer-events-auto rounded-full bg-black/75 px-3 py-1.5 text-xs font-medium text-white hover:bg-black/85 pointer-coarse:py-2.5"
          >
            Fit board · {Math.round(view.k * 100)}%
          </button>
        )}
        {cleared && (
          <p className="pointer-events-auto flex items-center gap-3 rounded-full bg-black/80 py-1 pl-3 pr-1 text-xs text-white">
            Board cleared for everyone
            <button
              type="button"
              onClick={undoLast}
              className="rounded-full bg-white/15 px-2.5 py-1 font-medium hover:bg-white/25 pointer-coarse:py-2"
            >
              Undo
            </button>
          </p>
        )}
        {malformed > 0 && (
          <p role="alert" className="max-w-full rounded-full bg-black/80 px-3 py-1.5 text-center text-xs text-white">
            {malformed === 1
              ? '1 stroke in this room is malformed, so it isn’t drawn.'
              : `${malformed} strokes in this room are malformed, so they aren’t drawn.`}
          </p>
        )}
        {badInk.length > 0 && (
          <p role="alert" className="max-w-full rounded-full bg-black/80 px-3 py-1.5 text-center text-xs text-white">
            Live ink from {badInk.join(' and ')} is malformed, so it isn’t shown.
          </p>
        )}
        <p
          role="status"
          className={`max-w-full rounded-full bg-black/75 px-3 py-1.5 text-center text-xs text-white ${statusMeta.pill ? '' : 'hidden'}`}
        >
          <Swap
            active={status}
            options={STATUSES.flatMap((key) => {
              const pill = STATUS_META[key].pill;
              if (!pill) return [];
              const dev = key === 'failed' && import.meta.env.DEV ? ' Start it with `npm run party`.' : '';
              return [[key, pill + dev] as [Status, ReactNode]];
            })}
          />
        </p>
      </div>

      <p className="sr-only" aria-live="polite">
        {arrivals.announcement}
      </p>
      <p className="sr-only" aria-live="polite">
        {notice}
      </p>
    </main>
  );
}
