import type { Awareness } from 'y-protocols/awareness';

export interface Stroke {
  id: string;
  color: string;
  points: number[];
  pressure?: number[];
}

export interface User {
  name: string;
  color: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface Peer extends User {
  id: number;
  cursor: Point | null;
  draft: Stroke | null;
  badInk: boolean;
}

/** Live ink on the wire: the last INK_WINDOW points of a stroke in progress, starting at point index `from`. */
export interface WireInk extends Stroke {
  from: number;
}

export const INK_MS = 33;
const INK_WINDOW = 64;

const isNumberArray = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((n) => typeof n === 'number' && Number.isFinite(n));

const hasPath = (s: Partial<Stroke>) =>
  typeof s.id === 'string' &&
  typeof s.color === 'string' &&
  isNumberArray(s.points) &&
  s.points.length >= 2 &&
  s.points.length % 2 === 0 &&
  (s.pressure === undefined || (isNumberArray(s.pressure) && s.pressure.length * 2 === s.points.length));

export function isStroke(value: unknown): value is Stroke {
  return typeof value === 'object' && value !== null && hasPath(value as Partial<Stroke>);
}

function isWireInk(value: unknown): value is WireInk {
  return isStroke(value) && Number.isInteger((value as Partial<WireInk>).from) && (value as WireInk).from >= 0;
}

export function readStrokes(items: readonly unknown[]): { strokes: Stroke[]; malformed: unknown[] } {
  return {
    strokes: items.filter(isStroke),
    malformed: items.filter((item) => !isStroke(item)),
  };
}

const isUser = (v: unknown): v is User =>
  typeof v === 'object' && v !== null && typeof (v as User).name === 'string' && typeof (v as User).color === 'string';

const isPoint = (v: unknown): v is Point =>
  typeof v === 'object' && v !== null && Number.isFinite((v as Point).x) && Number.isFinite((v as Point).y);

function mergeDraft(prev: Stroke | undefined, ink: WireInk): Stroke {
  const { id, color, from, points, pressure } = ink;
  const continues =
    prev !== undefined &&
    prev.id === id &&
    from * 2 <= prev.points.length &&
    (prev.pressure === undefined) === (pressure === undefined);
  if (!continues) return pressure ? { id, color, points, pressure } : { id, color, points };
  const merged = prev.points.slice(0, from * 2).concat(points);
  return pressure && prev.pressure
    ? { id, color, points: merged, pressure: prev.pressure.slice(0, from).concat(pressure) }
    : { id, color, points: merged };
}

export function readPeers(awareness: Awareness, drafts: Map<number, Stroke>): Peer[] {
  const peers: Peer[] = [];
  const seen = new Set<number>();
  awareness.getStates().forEach((state, id) => {
    if (id === awareness.clientID || !isUser(state.user)) return;
    const ink: unknown = state.ink ?? null;
    const draft = isWireInk(ink) ? mergeDraft(drafts.get(id), ink) : null;
    const badInk = ink !== null && draft === null;
    if (draft) {
      drafts.set(id, draft);
      seen.add(id);
    }
    const cursor = isPoint(state.cursor) ? { x: state.cursor.x, y: state.cursor.y } : null;
    peers.push({ id, name: state.user.name, color: state.user.color, cursor, draft, badInk });
  });
  [...drafts.keys()].filter((id) => !seen.has(id)).forEach((id) => drafts.delete(id));
  return peers;
}

function toWire(draft: Stroke): WireInk {
  const count = draft.points.length / 2;
  const from = Math.max(0, count - INK_WINDOW);
  const wire: WireInk = { id: draft.id, color: draft.color, from, points: draft.points.slice(from * 2) };
  if (draft.pressure) wire.pressure = draft.pressure.slice(from);
  return wire;
}

export interface Presence {
  cursor: (point: Point | null) => void;
  draft: (draft: Stroke | null) => void;
  reset: () => void;
  dispose: () => void;
}

export function createPresence(awareness: Awareness): Presence {
  let cursor: Point | null = null;
  let draft: Stroke | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastWrite = -Infinity;

  const write = () => {
    clearTimeout(timer);
    timer = undefined;
    lastWrite = performance.now();
    const local = awareness.getLocalState();
    if (local === null) return;
    awareness.setLocalState({ ...local, cursor, ink: draft && toWire(draft) });
  };

  const flush = (urgent: boolean) => {
    if (urgent) {
      write();
      return;
    }
    if (timer !== undefined) return;
    const wait = INK_MS - (performance.now() - lastWrite);
    if (wait <= 0) write();
    else timer = setTimeout(write, wait);
  };

  return {
    cursor(point) {
      cursor = point;
      flush(draft === null);
    },
    draft(next) {
      draft = next;
      if (next) cursor = { x: next.points[next.points.length - 2], y: next.points[next.points.length - 1] };
      flush(next === null);
    },
    reset() {
      clearTimeout(timer);
      timer = undefined;
      cursor = null;
      draft = null;
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
