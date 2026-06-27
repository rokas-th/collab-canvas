import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import YPartyKitProvider from 'y-partykit/provider';

export interface Stroke {
  id: string;
  color: string;
  points: number[]; // flat [x0, y0, x1, y1, ...]
}

export interface User {
  name: string;
  color: string;
}

export interface Peer extends User {
  id: number;
  x: number;
  y: number;
}

export type Status = 'connecting' | 'connected' | 'disconnected';

const HOST = import.meta.env.VITE_PARTYKIT_HOST ?? 'localhost:1999';

const NAMES = ['Otter', 'Heron', 'Lynx', 'Wren', 'Marten', 'Ibis', 'Vole', 'Tern', 'Stoat', 'Finch'];
const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

function randomUser(): User {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  return { name: pick(NAMES), color: pick(COLORS) };
}

interface UseWhiteboard {
  strokes: Stroke[];
  peers: Peer[];
  status: Status;
  me: User;
  addStroke: (stroke: Stroke) => void;
  clear: () => void;
  setCursor: (x: number, y: number) => void;
}

export function useWhiteboard(room: string): UseWhiteboard {
  const providerRef = useRef<YPartyKitProvider | null>(null);
  const strokesYRef = useRef<Y.Array<Stroke> | null>(null);
  const meRef = useRef<User>(randomUser());

  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [status, setStatus] = useState<Status>('connecting');

  useEffect(() => {
    const doc = new Y.Doc();
    const provider = new YPartyKitProvider(HOST, room, doc);
    const yStrokes = doc.getArray<Stroke>('strokes');
    providerRef.current = provider;
    strokesYRef.current = yStrokes;

    const syncStrokes = () => setStrokes(yStrokes.toArray());
    yStrokes.observe(syncStrokes);
    syncStrokes();

    const onStatus = (event: { status: string }) => setStatus(event.status as Status);
    provider.on('status', onStatus);

    const awareness = provider.awareness;
    awareness.setLocalStateField('user', meRef.current);

    const onAwareness = () => {
      const list: Peer[] = [];
      awareness.getStates().forEach((state, id) => {
        if (id === awareness.clientID) return;
        const user = state.user as User | undefined;
        const cursor = state.cursor as { x: number; y: number } | undefined;
        if (user && cursor) list.push({ id, name: user.name, color: user.color, x: cursor.x, y: cursor.y });
      });
      setPeers(list);
    };
    awareness.on('change', onAwareness);

    return () => {
      yStrokes.unobserve(syncStrokes);
      awareness.off('change', onAwareness);
      provider.destroy();
      doc.destroy();
    };
  }, [room]);

  const addStroke = useCallback((stroke: Stroke) => {
    strokesYRef.current?.push([stroke]);
  }, []);

  const clear = useCallback(() => {
    const y = strokesYRef.current;
    if (y) y.delete(0, y.length);
  }, []);

  const setCursor = useCallback((x: number, y: number) => {
    providerRef.current?.awareness.setLocalStateField('cursor', { x, y });
  }, []);

  return { strokes, peers, status, me: meRef.current, addStroke, clear, setCursor };
}
