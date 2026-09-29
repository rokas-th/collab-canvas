import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import YPartyKitProvider from 'y-partykit/provider';
import { Awareness } from 'y-protocols/awareness';
import { HOST, trackStatus, type Status } from './connection';
import { isStroke, readPeers, readStrokes, type Peer, type Stroke } from './presence';
import type { Outbox } from './useWhiteboard';

const RTT_SAMPLES = 9;
const RTT_PAINT_MS = 400;

export interface MirrorState {
  status: Status;
  synced: boolean;
  strokes: Stroke[];
  peers: Peer[];
  rtt: number | null;
}

const IDLE: MirrorState = { status: 'connecting', synced: false, strokes: [], peers: [], rtt: null };

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

function take<K>(log: Map<K, number>, key: K): number | undefined {
  const sentAt = log.get(key);
  log.delete(key);
  return sentAt;
}

export function useMirror(room: string, outbox: Outbox | null, enabled: boolean, onMark: () => void): MirrorState {
  const [state, setState] = useState<MirrorState>(IDLE);
  const [session, setSession] = useState(enabled);
  const markRef = useRef(onMark);

  if (session !== enabled) {
    setSession(enabled);
    if (enabled) setState(IDLE);
  }

  useEffect(() => {
    markRef.current = onMark;
  }, [onMark]);

  useEffect(() => {
    if (!enabled || !outbox) return;
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalState(null);
    const provider = new YPartyKitProvider(HOST, room, doc, { awareness, disableBc: true });
    awareness.off('update', provider._awarenessUpdateHandler);
    const yStrokes = doc.getArray<Stroke>('strokes');
    const drafts = new Map<number, Stroke>();
    const samples: number[] = [];
    let openedAt = Infinity;
    let paintedAt = -Infinity;
    let paintTimer: ReturnType<typeof setTimeout> | undefined;

    const patch = (next: Partial<MirrorState>) => setState((s) => ({ ...s, ...next }));

    const paint = () => {
      paintTimer = undefined;
      paintedAt = performance.now();
      patch({ rtt: median(samples) });
    };

    const fresh = (sentAt: number | undefined): sentAt is number => sentAt !== undefined && sentAt >= openedAt;

    const record = (sentAt: number) => {
      samples.push(performance.now() - sentAt);
      if (samples.length > RTT_SAMPLES) samples.shift();
      const wait = RTT_PAINT_MS - (performance.now() - paintedAt);
      if (wait <= 0) paint();
      else if (paintTimer === undefined) paintTimer = setTimeout(paint, wait);
    };

    const stopStatus = trackStatus(
      provider,
      (status) => patch({ status }),
      () => {
        openedAt = performance.now();
      },
    );

    const onSynced = (synced: boolean) => {
      patch({ synced });
      if (synced) outbox.reannounce();
    };
    provider.on('synced', onSynced);

    const onStrokes = (event: Y.YArrayEvent<Stroke>) => {
      patch({ strokes: readStrokes(yStrokes.toArray()).strokes });
      const measured = event.changes.delta
        .flatMap((d) => (d.insert as unknown[] | undefined) ?? [])
        .filter(isStroke)
        .map((s) => take(outbox.strokes, s.id))
        .filter(fresh);
      measured.forEach(record);
      if (measured.length > 0) markRef.current();
    };
    yStrokes.observe(onStrokes);

    const onChange = () => patch({ peers: readPeers(awareness, drafts) });
    awareness.on('change', onChange);

    const onUpdate = ({ added, updated }: { added: number[]; updated: number[] }, origin: unknown) => {
      if (origin === 'local' || ![...added, ...updated].includes(outbox.clientID)) return;
      const clock = awareness.meta.get(outbox.clientID)?.clock;
      if (clock === undefined) throw new Error('Mirror received an awareness update without a clock');
      const sentAt = take(outbox.awareness, clock);
      if (!fresh(sentAt)) return;
      record(sentAt);
      if (awareness.getStates().get(outbox.clientID)?.ink) markRef.current();
    };
    awareness.on('update', onUpdate);

    return () => {
      clearTimeout(paintTimer);
      stopStatus();
      provider.off('synced', onSynced);
      yStrokes.unobserve(onStrokes);
      awareness.off('change', onChange);
      awareness.off('update', onUpdate);
      provider.destroy();
      doc.destroy();
    };
  }, [room, outbox, enabled]);

  return state;
}
