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
  cursor: { x: number; y: number } | null;
}

export type Status = 'connecting' | 'connected' | 'reconnecting' | 'failed';

export const BOARD = { width: 1600, height: 1000 } as const;

const FIRST_CONNECT_FAIL_MS = 8000;
const FIRST_CONNECT_FAIL_ATTEMPTS = 6;
const RECONNECT_FAIL_MS = 10000;

function partyHost(): string {
  const host = import.meta.env.VITE_PARTYKIT_HOST;
  if (host) return host;
  if (import.meta.env.DEV) return 'localhost:1999';
  throw new Error('VITE_PARTYKIT_HOST is not set, so this build has no realtime server to connect to.');
}

const HOST = partyHost();

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
  canUndo: boolean;
  addStroke: (stroke: Stroke) => void;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  setCursor: (x: number, y: number) => void;
  clearCursor: () => void;
}

export function useWhiteboard(room: string): UseWhiteboard {
  const providerRef = useRef<YPartyKitProvider | null>(null);
  const strokesYRef = useRef<Y.Array<Stroke> | null>(null);
  const undoRef = useRef<Y.UndoManager | null>(null);
  const [me] = useState(randomUser);

  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [status, setStatus] = useState<Status>('connecting');
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => {
    const doc = new Y.Doc();
    const provider = new YPartyKitProvider(HOST, room, doc);
    const yStrokes = doc.getArray<Stroke>('strokes');
    const undoManager = new Y.UndoManager(yStrokes, { captureTimeout: 0 });
    providerRef.current = provider;
    strokesYRef.current = yStrokes;
    undoRef.current = undoManager;

    const syncStrokes = () => setStrokes(yStrokes.toArray());
    yStrokes.observe(syncStrokes);
    syncStrokes();

    const syncUndo = () => setCanUndo(undoManager.undoStack.length > 0);
    undoManager.on('stack-item-added', syncUndo);
    undoManager.on('stack-item-popped', syncUndo);
    undoManager.on('stack-cleared', syncUndo);

    let everConnected = false;
    let failed = false;
    let failedAttempts = 0;
    let failTimer: ReturnType<typeof setTimeout> | undefined;

    const fail = () => {
      failed = true;
      setStatus('failed');
    };

    const awareness = provider.awareness;

    const reannounce = () => {
      awareness.meta.forEach((_, id) => {
        if (id !== awareness.clientID && !awareness.states.has(id)) awareness.meta.delete(id);
      });
      const local = awareness.getLocalState();
      if (local !== null) awareness.setLocalState(local);
    };

    const onStatus = ({ status: next }: { status: string }) => {
      if (next === 'connected') {
        everConnected = true;
        failed = false;
        failedAttempts = 0;
        clearTimeout(failTimer);
        failTimer = undefined;
        reannounce();
        setStatus('connected');
        return;
      }
      if (failTimer === undefined)
        failTimer = setTimeout(fail, everConnected ? RECONNECT_FAIL_MS : FIRST_CONNECT_FAIL_MS);
      if (!failed) setStatus(everConnected ? 'reconnecting' : 'connecting');
    };
    provider.on('status', onStatus);

    const onClose = () => {
      if (provider.wsconnected || everConnected) return;
      failedAttempts += 1;
      if (failedAttempts >= FIRST_CONNECT_FAIL_ATTEMPTS) fail();
    };
    provider.on('connection-close', onClose);

    awareness.setLocalStateField('user', me);

    const onAwareness = () => {
      const list: Peer[] = [];
      awareness.getStates().forEach((state, id) => {
        if (id === awareness.clientID) return;
        const user = state.user as User | undefined;
        const cursor = (state.cursor as Peer['cursor'] | undefined) ?? null;
        if (user) list.push({ id, name: user.name, color: user.color, cursor });
      });
      setPeers(list);
    };
    awareness.on('change', onAwareness);

    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) awareness.setLocalState({ user: me });
    };
    window.addEventListener('pageshow', onPageShow);

    return () => {
      clearTimeout(failTimer);
      window.removeEventListener('pageshow', onPageShow);
      yStrokes.unobserve(syncStrokes);
      awareness.off('change', onAwareness);
      provider.off('status', onStatus);
      provider.off('connection-close', onClose);
      undoManager.destroy();
      provider.destroy();
      doc.destroy();
    };
  }, [room, me]);

  const addStroke = useCallback((stroke: Stroke) => {
    strokesYRef.current?.push([stroke]);
  }, []);

  const clear = useCallback(() => {
    const y = strokesYRef.current;
    if (y) y.delete(0, y.length);
  }, []);

  const undo = useCallback(() => {
    undoRef.current?.undo();
  }, []);

  const redo = useCallback(() => {
    undoRef.current?.redo();
  }, []);

  const setCursor = useCallback((x: number, y: number) => {
    providerRef.current?.awareness.setLocalStateField('cursor', { x, y });
  }, []);

  const clearCursor = useCallback(() => {
    providerRef.current?.awareness.setLocalStateField('cursor', null);
  }, []);

  return { strokes, peers, status, me, canUndo, addStroke, clear, undo, redo, setCursor, clearCursor };
}
