import { useCallback, useEffect, useRef, useState } from 'react';
import type { Peer } from './presence';

export const JOIN_LABEL_MS = 900;

export interface Wash {
  key: number;
  color: string;
}

export interface Ring {
  key: number;
  color: string;
  x: number;
  y: number;
}

interface Arrivals {
  wash: Wash | null;
  rings: Ring[];
  joining: ReadonlySet<number>;
  announcement: string;
  dropRing: (key: number) => void;
}

export function useArrivals(peers: Peer[], ready: boolean): Arrivals {
  const seen = useRef(new Set<number>());
  const awaitingCursor = useRef(new Set<number>());
  const baselined = useRef(false);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [wash, setWash] = useState<Wash | null>(null);
  const [rings, setRings] = useState<Ring[]>([]);
  const [joining, setJoining] = useState<ReadonlySet<number>>(() => new Set());
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const arrived = peers.filter((p) => !seen.current.has(p.id));
    arrived.forEach((p) => seen.current.add(p.id));
    if (baselined.current && arrived.length > 0) {
      arrived.forEach((p) => awaitingCursor.current.add(p.id));
      const last = arrived[arrived.length - 1];
      setWash({ key: last.id, color: last.color });
      setAnnouncement(`${arrived.map((p) => p.name).join(' and ')} joined the room.`);
    }
    baselined.current = true;

    const landed = peers.flatMap((p) =>
      p.cursor && awaitingCursor.current.has(p.id) ? [{ key: p.id, color: p.color, x: p.cursor.x, y: p.cursor.y }] : [],
    );
    if (landed.length === 0) return;
    landed.forEach((ring) => awaitingCursor.current.delete(ring.key));
    setRings((r) => [...r, ...landed]);
    setJoining((s) => new Set([...s, ...landed.map((ring) => ring.key)]));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setJoining((s) => new Set([...s].filter((id) => !landed.some((ring) => ring.key === id))));
    }, JOIN_LABEL_MS);
    timers.current.add(timer);
  }, [peers, ready]);

  const dropRing = useCallback((key: number) => setRings((r) => r.filter((ring) => ring.key !== key)), []);

  return { wash, rings, joining, announcement, dropRing };
}
