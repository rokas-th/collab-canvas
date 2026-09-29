import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { JOIN_LABEL_MS, type Ring, type Wash } from './useArrivals';

const WASH_MS = 500;
const RING_MS = 760;
const SHRINK_MS = 240;
const EASE = 'cubic-bezier(.2,.8,.2,1)';

const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function mounted<T>(ref: { current: T | null }, what: string): T {
  if (!ref.current) throw new Error(`${what} is not mounted`);
  return ref.current;
}

interface CursorProps {
  name: string;
  color: string;
  x: number;
  y: number;
  scale: number;
  joining?: boolean;
}

export function Cursor({ name, color, x, y, scale, joining = false }: CursorProps) {
  const textRef = useRef<SVGTextElement>(null);
  const rectRef = useRef<SVGRectElement>(null);
  const wasJoining = useRef(joining);
  const narrow = name.length * 7 + 12;
  const joinedLabel = `${name} joined`.toUpperCase();
  const [wide, setWide] = useState(joinedLabel.length * 7 + 11);

  useLayoutEffect(() => {
    if (joining) {
      setWide(Math.ceil(mounted(textRef, 'Cursor label').getComputedTextLength()) + 11);
      wasJoining.current = true;
      return;
    }
    if (!wasJoining.current) return;
    wasJoining.current = false;
    if (calm()) return;
    const rect = mounted(rectRef, 'Cursor tag');
    const text = mounted(textRef, 'Cursor label');
    const from = wide;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / SHRINK_MS);
      const eased = 1 - (1 - t) ** 3;
      rect.setAttribute('width', String(from + (narrow - from) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    rect.setAttribute('width', String(from));
    frame = requestAnimationFrame(step);
    const fade = text.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, delay: 120, fill: 'backwards' });
    return () => {
      cancelAnimationFrame(frame);
      if (fade.playState !== 'finished') fade.cancel();
      rect.setAttribute('width', String(narrow));
    };
  }, [joining, narrow, wide]);

  return (
    <g transform={`translate(${x}, ${y}) scale(${scale})`} pointerEvents="none">
      <path d="M0 0 L0 16 L4.5 12 L7 17 L9 16 L6.5 11 L12 11 Z" fill={color} stroke="white" strokeWidth={1} />
      <rect ref={rectRef} x="12" y="10" rx="3" width={joining ? wide : narrow} height="18" fill={color} />
      {joining ? (
        <text
          ref={textRef}
          x="17.5"
          y="22.5"
          fontSize="10"
          letterSpacing="0.12em"
          fill="white"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
        >
          {joinedLabel}
        </text>
      ) : (
        <text ref={textRef} x="18" y="23" fontSize="11" fill="white" fontFamily="ui-sans-serif, system-ui">
          {name}
        </text>
      )}
    </g>
  );
}

export function ArrivalRing({ ring, scale, onDone }: { ring: Ring; scale: number; onDone: (key: number) => void }) {
  const ref = useRef<SVGCircleElement>(null);
  const [still] = useState(calm);

  useEffect(() => {
    if (still) {
      const t = setTimeout(() => onDone(ring.key), JOIN_LABEL_MS);
      return () => clearTimeout(t);
    }
    const grow = mounted(ref, 'Arrival ring').animate(
      [
        { transform: 'scale(0.125)', opacity: 1 },
        { transform: 'scale(1)', opacity: 0 },
      ],
      { duration: RING_MS, easing: EASE, fill: 'forwards' },
    );
    grow.onfinish = () => onDone(ring.key);
    return () => {
      if (grow.playState !== 'finished') grow.cancel();
    };
  }, [ring.key, onDone, still]);

  return (
    <g transform={`translate(${ring.x}, ${ring.y}) scale(${scale})`} pointerEvents="none">
      <circle
        ref={ref}
        r={still ? 14 : 24}
        fill="none"
        stroke={ring.color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
      />
    </g>
  );
}

export function EdgeWash({ wash, width, height, inset }: { wash: Wash; width: number; height: number; inset: number }) {
  const ref = useRef<SVGRectElement>(null);

  useEffect(() => {
    const rect = mounted(ref, 'Edge wash');
    if (calm()) {
      rect.style.opacity = '1';
      const t = setTimeout(() => {
        rect.style.opacity = '0';
      }, WASH_MS);
      return () => clearTimeout(t);
    }
    const flash = rect.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], {
      duration: WASH_MS,
      easing: 'ease-out',
    });
    return () => {
      if (flash.playState !== 'finished') flash.cancel();
    };
  }, [wash.key]);

  return (
    <rect
      ref={ref}
      data-wash={wash.color}
      x={inset}
      y={inset}
      width={width - 2 * inset}
      height={height - 2 * inset}
      fill="none"
      stroke={wash.color}
      strokeWidth={1}
      vectorEffect="non-scaling-stroke"
      opacity={0}
      pointerEvents="none"
    />
  );
}
