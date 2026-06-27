import { useCallback, useRef, useState, type PointerEvent } from 'react';
import { useWhiteboard, type Stroke } from './useWhiteboard';

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

function toPolyline(points: number[]): string {
  let s = '';
  for (let i = 0; i < points.length; i += 2) s += `${points[i]},${points[i + 1]} `;
  return s.trim();
}

const STATUS_COLOR: Record<string, string> = {
  connected: '#10b981',
  connecting: '#f59e0b',
  disconnected: '#ef4444',
};

export default function App() {
  const [room] = useState(getRoom);
  const { strokes, peers, status, me, addStroke, clear, setCursor } = useWhiteboard(room);

  const [pen, setPen] = useState('');
  const penColor = pen || me.color;

  const drawing = useRef(false);
  const [current, setCurrent] = useState<number[]>([]);

  const point = (e: PointerEvent<SVGSVGElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const onDown = useCallback((e: PointerEvent<SVGSVGElement>) => {
    const [x, y] = point(e);
    drawing.current = true;
    setCurrent([x, y]);
  }, []);

  const onMove = useCallback(
    (e: PointerEvent<SVGSVGElement>) => {
      const [x, y] = point(e);
      setCursor(x, y);
      if (drawing.current) setCurrent((c) => [...c, x, y]);
    },
    [setCursor],
  );

  const finish = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;
    setCurrent((c) => {
      if (c.length >= 4) {
        const stroke: Stroke = { id: crypto.randomUUID(), color: penColor, points: c };
        addStroke(stroke);
      }
      return [];
    });
  }, [addStroke, penColor]);

  const share = () => {
    navigator.clipboard?.writeText(window.location.href);
  };

  return (
    <div className="relative h-screen w-screen touch-none select-none">
      <svg
        className="h-full w-full"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={finish}
        onPointerLeave={finish}
      >
        <defs>
          <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#d8d8d2" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots)" />

        {strokes.map((s) => (
          <polyline
            key={s.id}
            points={toPolyline(s.points)}
            stroke={s.color}
            fill="none"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {current.length >= 4 && (
          <polyline
            points={toPolyline(current)}
            stroke={penColor}
            fill="none"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {peers.map((p) => (
          <g key={p.id} transform={`translate(${p.x}, ${p.y})`} pointerEvents="none">
            <path d="M0 0 L0 16 L4.5 12 L7 17 L9 16 L6.5 11 L12 11 Z" fill={p.color} stroke="white" strokeWidth={1} />
            <rect x="12" y="10" rx="3" width={p.name.length * 7 + 12} height="18" fill={p.color} />
            <text x="18" y="23" fontSize="11" fill="white" fontFamily="ui-sans-serif, system-ui">
              {p.name}
            </text>
          </g>
        ))}
      </svg>

      {/* Toolbar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-black/10 bg-white/90 px-4 py-2 shadow-sm backdrop-blur">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-black/40">Collab Canvas</p>
            <p className="text-sm font-semibold">
              Room <span className="font-mono">{room}</span>
            </p>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-black/50">
            <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[status] }} />
            {status}
          </span>
        </div>

        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-black/10 bg-white/90 px-3 py-2 shadow-sm backdrop-blur">
          <span className="text-xs text-black/50">{peers.length + 1} online</span>
          <label className="flex items-center gap-1.5 text-xs text-black/60">
            Pen
            <input
              type="color"
              value={penColor}
              onChange={(e) => setPen(e.target.value)}
              className="h-6 w-8 cursor-pointer rounded border border-black/10 bg-transparent"
            />
          </label>
          <button type="button" onClick={clear} className="rounded-lg px-2 py-1 text-sm text-black/60 hover:bg-black/5">
            Clear
          </button>
          <button
            type="button"
            onClick={share}
            className="rounded-lg bg-black px-3 py-1 text-sm font-medium text-white hover:bg-black/80"
          >
            Share
          </button>
        </div>
      </div>

      {status !== 'connected' && (
        <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white">
          {status === 'connecting'
            ? 'Connecting to the room…'
            : 'Offline — run `npm run party` or set VITE_PARTYKIT_HOST to sync.'}
        </p>
      )}
    </div>
  );
}
