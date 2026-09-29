import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Cursor } from './Cursors';
import { InkPath } from './InkPath';
import { penSize } from './pen';
import type { Peer, Stroke } from './presence';

export type MirrorMode = 'live' | 'off' | 'unreachable';
export type Verify = 'flash' | 'verified' | null;

const BOARD_W = 1600;
const BOARD_H = 1000;
const MIRROR_MIN_PX = 1.5;
const FOLD_MS = 400;

interface MirrorProps {
  mode: MirrorMode;
  reason: string;
  caption: string;
  strokes: Stroke[];
  peers: Peer[];
  verify: Verify;
  devices: number;
  colors: string[];
  onCardHeight: (height: number) => void;
}

export function Dots({ colors }: { colors: string[] }) {
  return (
    <span className="flex -space-x-1" aria-hidden="true">
      {colors.slice(0, 4).map((c, i) => (
        <span key={i} className="size-2.5 rounded-full ring-2 ring-white" style={{ background: c }} />
      ))}
    </span>
  );
}

export function Mirror({ mode, reason, caption, strokes, peers, verify, devices, colors, onCardHeight }: MirrorProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(0);
  const [folding, setFolding] = useState(false);
  const off = mode === 'off';
  const down = mode === 'unreachable';
  const [shown, setShown] = useState({ devices, colors });
  if (off && (shown.devices !== devices || shown.colors.join() !== colors.join())) setShown({ devices, colors });
  const wasOff = useRef(off);

  useLayoutEffect(() => {
    const card = cardRef.current;
    const chip = chipRef.current;
    if (!card || !chip) throw new Error('Mirror card is not mounted');
    const measure = () => {
      const target = off ? chip : card;
      setBox({ w: target.offsetWidth + 2, h: target.offsetHeight + 2 });
      onCardHeight(card.offsetHeight + 2);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    observer.observe(chip);
    return () => observer.disconnect();
  }, [off, onCardHeight]);

  useLayoutEffect(() => {
    if (wasOff.current === off) return;
    wasOff.current = off;
    setFolding(true);
    const t = setTimeout(() => setFolding(false), FOLD_MS);
    return () => clearTimeout(t);
  }, [off]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) throw new Error('Mirror board is not mounted');
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setScale(Math.min(width / BOARD_W, height / BOARD_H));
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const ids = useMemo(() => new Set(strokes.map((s) => s.id)), [strokes]);
  const size = scale > 0 ? penSize(scale, MIRROR_MIN_PX) : 0;
  const floor = scale > 0 ? MIRROR_MIN_PX / scale : 0;
  const cursorScale = scale > 0 ? (scale * BOARD_W < 160 ? 0.55 : 0.72) / scale : 0;
  const radius = box && off ? `${box.h / 2}px` : '12px';
  const deviceCount = `${shown.devices} ${shown.devices === 1 ? 'device' : 'devices'}`;

  return (
    <div
      data-mirror={mode}
      role="group"
      aria-label={off ? `${deviceCount} in the room, mirror off` : 'What another device sees'}
      className={`pointer-events-auto relative self-end overflow-hidden border border-black/10 bg-white/90 shadow-sm backdrop-blur ${folding ? 'transition-[width,height,border-radius] duration-[340ms] ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none' : ''}`}
      style={{ width: box?.w, height: box?.h, borderRadius: radius }}
    >
      <div
        ref={cardRef}
        inert={off}
        aria-hidden={off}
        className={`absolute bottom-0 right-0 w-[244px] p-3 transition-opacity motion-reduce:transition-none max-sm:w-[152px] max-sm:p-2.5 ${off ? 'opacity-0 duration-[130ms]' : 'opacity-100 delay-[120ms] duration-[180ms]'}`}
      >
        <p
          className={`font-mono text-[10px] uppercase leading-[15px] tracking-[0.2em] transition-colors duration-200 motion-reduce:transition-none max-sm:leading-[13px] ${verify ? 'text-[#1a1a1f]' : 'text-black/60'}`}
        >
          {verify ? 'Sync verified' : 'What another device sees'}
        </p>
        <div
          className={`relative mt-2 h-[138px] w-[220px] rounded-[15px] border px-[7px] py-1 transition-[background-color,border-color] motion-reduce:transition-none max-sm:mt-1.5 max-sm:h-[83px] max-sm:w-[132px] max-sm:rounded-[11px] max-sm:px-[5px] max-sm:py-[3px] ${
            verify === 'flash'
              ? 'border-[#1a1a1f] bg-[#1a1a1f] duration-[140ms]'
              : down
                ? 'border-black/10 bg-[#f1f1ef] duration-700'
                : 'border-black/[0.14] bg-[#fbfbfa] duration-700'
          }`}
        >
          <div
            className={`relative h-full w-full overflow-hidden rounded-lg outline outline-1 -outline-offset-1 outline-black/[0.06] max-sm:rounded-md ${down ? 'bg-[#e2e2de]' : 'bg-[#f6f6f4]'}`}
          >
            <svg
              ref={svgRef}
              viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
              preserveAspectRatio="xMidYMid meet"
              aria-hidden="true"
              className={`block h-full w-full ${down ? 'invisible' : ''}`}
            >
              <defs>
                <pattern id="mirror-dots" width="72" height="72" patternUnits="userSpaceOnUse">
                  <circle cx="4" cy="4" r="4.2" fill="#d8d8d2" />
                </pattern>
              </defs>
              <rect width={BOARD_W} height={BOARD_H} fill="#f6f6f4" />
              <rect width={BOARD_W} height={BOARD_H} fill="url(#mirror-dots)" />
              {size > 0 && (
                <>
                  <g data-layer="committed">
                    {strokes.map((s) => (
                      <InkPath key={s.id} stroke={s} size={size} floor={floor} layer="committed" />
                    ))}
                  </g>
                  <g data-layer="draft">
                    {peers.map(({ id, draft }) =>
                      draft && !ids.has(draft.id) ? (
                        <InkPath key={id} stroke={draft} size={size} floor={floor} layer="draft" />
                      ) : null,
                    )}
                  </g>
                  {peers.map(({ id, name, color, cursor }) =>
                    cursor ? <Cursor key={id} name={name} color={color} x={cursor.x} y={cursor.y} scale={cursorScale} /> : null,
                  )}
                </>
              )}
            </svg>
          </div>
        </div>
        <p className="mt-2 font-mono text-[10px] leading-[14px] tracking-[0.02em] text-black/60 tabular-nums max-sm:mt-1.5 max-sm:leading-[13px]">
          {down ? (
            <>
              <span className="whitespace-nowrap">
                <span
                  className="mr-1.5 inline-block size-1.5 rounded-full bg-[#ef4444] align-[1px] max-sm:hidden"
                  aria-hidden="true"
                />
                nothing is arriving:
              </span>{' '}
              <span className="whitespace-nowrap">{reason}</span>
            </>
          ) : (
            caption
          )}
        </p>
      </div>
      <div
        ref={chipRef}
        aria-hidden={!off}
        className={`absolute bottom-0 right-0 flex h-7 items-center gap-1.5 whitespace-nowrap pl-[9px] pr-[11px] text-xs text-black/60 transition-opacity motion-reduce:transition-none ${off ? 'opacity-100 delay-[140ms] duration-[170ms]' : 'opacity-0 duration-[120ms]'}`}
      >
        <Dots colors={shown.colors} />
        {deviceCount} · mirror off
      </div>
    </div>
  );
}
