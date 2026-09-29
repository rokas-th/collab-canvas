import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import YPartyKitProvider from 'y-partykit/provider';
import { HOST, trackStatus, type Status } from './connection';
import {
  createPresence,
  isStroke,
  readPeers,
  readStrokes,
  type Peer,
  type Presence,
  type Stroke,
  type User,
} from './presence';

export type { Peer, Status, Stroke, User };

export const BOARD = { width: 1600, height: 1000 } as const;

const NAMES = ['Otter', 'Heron', 'Lynx', 'Wren', 'Marten', 'Ibis', 'Vole', 'Tern', 'Stoat', 'Finch'];
const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
const SENT_LOG = 256;

function randomUser(): User {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  return { name: pick(NAMES), color: pick(COLORS) };
}

/** When this client sent each awareness update (by clock) and each stroke insert (by stroke id), on the performance.now() clock. */
export interface Outbox {
  clientID: number;
  awareness: Map<number, number>;
  strokes: Map<string, number>;
  reannounce: () => void;
}

function remember<K>(log: Map<K, number>, key: K) {
  log.set(key, performance.now());
  if (log.size > SENT_LOG) log.delete(log.keys().next().value as K);
}

interface UseWhiteboard {
  strokes: Stroke[];
  malformed: number;
  peers: Peer[];
  status: Status;
  synced: boolean;
  me: User;
  canUndo: boolean;
  outbox: Outbox | null;
  addStroke: (stroke: Stroke) => void;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  setCursor: (x: number, y: number) => void;
  clearCursor: () => void;
  setDraft: (draft: Stroke | null) => void;
}

export function useWhiteboard(room: string): UseWhiteboard {
  const strokesYRef = useRef<Y.Array<Stroke> | null>(null);
  const undoRef = useRef<Y.UndoManager | null>(null);
  const presenceRef = useRef<Presence | null>(null);
  const [me] = useState(randomUser);

  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [malformed, setMalformed] = useState(0);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [status, setStatus] = useState<Status>('connecting');
  const [synced, setSynced] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [outbox, setOutbox] = useState<Outbox | null>(null);

  useEffect(() => {
    const doc = new Y.Doc();
    const provider = new YPartyKitProvider(HOST, room, doc);
    const yStrokes = doc.getArray<Stroke>('strokes');
    const undoManager = new Y.UndoManager(yStrokes, { captureTimeout: 0 });
    const awareness = provider.awareness;
    const presence = createPresence(awareness);
    strokesYRef.current = yStrokes;
    undoRef.current = undoManager;
    presenceRef.current = presence;

    let reported = 0;
    const syncStrokes = () => {
      const read = readStrokes(yStrokes.toArray());
      setStrokes(read.strokes);
      setMalformed(read.malformed.length);
      if (read.malformed.length > 0 && read.malformed.length !== reported)
        console.error(`Room ${room} holds ${read.malformed.length} malformed strokes that are not drawn`, read.malformed);
      reported = read.malformed.length;
    };
    yStrokes.observe(syncStrokes);
    syncStrokes();

    const syncUndo = () => setCanUndo(undoManager.undoStack.length > 0);
    undoManager.on('stack-item-added', syncUndo);
    undoManager.on('stack-item-popped', syncUndo);
    undoManager.on('stack-cleared', syncUndo);

    const reannounce = () => {
      awareness.meta.forEach((_, id) => {
        if (id !== awareness.clientID && !awareness.states.has(id)) awareness.meta.delete(id);
      });
      const local = awareness.getLocalState();
      if (local !== null) awareness.setLocalState(local);
    };
    const stopStatus = trackStatus(provider, setStatus, reannounce);

    const onSynced = (state: boolean) => setSynced(state);
    provider.on('synced', onSynced);

    const out: Outbox = {
      clientID: awareness.clientID,
      awareness: new Map(),
      strokes: new Map(),
      reannounce: () => {
        const local = awareness.getLocalState();
        if (local !== null) awareness.setLocalState(local);
      },
    };
    const onLocalUpdate = (_: unknown, origin: unknown) => {
      if (origin !== 'local') return;
      const clock = awareness.meta.get(awareness.clientID)?.clock;
      if (clock === undefined) throw new Error('Local awareness update has no clock');
      remember(out.awareness, clock);
    };
    awareness.on('update', onLocalUpdate);
    const onLocalInsert = (event: Y.YArrayEvent<Stroke>) => {
      if (!event.transaction.local) return;
      event.changes.delta
        .flatMap((d) => (d.insert as unknown[] | undefined) ?? [])
        .filter(isStroke)
        .forEach((s) => remember(out.strokes, s.id));
    };
    yStrokes.observe(onLocalInsert);
    setOutbox(out);

    awareness.setLocalStateField('user', me);

    const drafts = new Map<number, Stroke>();
    const onAwareness = () => setPeers(readPeers(awareness, drafts));
    awareness.on('change', onAwareness);

    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      presence.reset();
      awareness.setLocalState({ user: me });
    };
    window.addEventListener('pageshow', onPageShow);

    return () => {
      stopStatus();
      presence.dispose();
      window.removeEventListener('pageshow', onPageShow);
      yStrokes.unobserve(syncStrokes);
      yStrokes.unobserve(onLocalInsert);
      awareness.off('change', onAwareness);
      awareness.off('update', onLocalUpdate);
      provider.off('synced', onSynced);
      undoManager.destroy();
      provider.destroy();
      doc.destroy();
    };
  }, [room, me]);

  const addStroke = useCallback((stroke: Stroke) => {
    strokesYRef.current?.push([stroke]);
    presenceRef.current?.draft(null);
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
    presenceRef.current?.cursor({ x, y });
  }, []);

  const clearCursor = useCallback(() => {
    presenceRef.current?.cursor(null);
  }, []);

  const setDraft = useCallback((draft: Stroke | null) => {
    presenceRef.current?.draft(draft);
  }, []);

  return {
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
  };
}
