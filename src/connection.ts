import type * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';

export type Status = 'connecting' | 'connected' | 'reconnecting' | 'paused' | 'failed';

const FIRST_CONNECT_FAIL_MS = 8000;
const FIRST_CONNECT_FAIL_ATTEMPTS = 6;
const RECONNECT_FAIL_MS = 10000;
const HIDDEN_PAUSE_MS = 5 * 60 * 1000;
export const QUIET_PAUSE_MS = 10 * 60 * 1000;
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'focus'] as const;

const PARTY = 'whiteboard';

function syncHost(): string {
  const host = import.meta.env.VITE_SYNC_HOST;
  if (host) return host;
  if (import.meta.env.DEV) return 'localhost:1999';
  throw new Error('VITE_SYNC_HOST is not set, so this build has no realtime server to connect to.');
}

const HOST = syncHost();

const quietListeners = new Set<(quiet: boolean) => void>();
let quiet = false;
let lastActivity = 0;
let quietTimer: ReturnType<typeof setTimeout> | undefined;

const checkQuiet = () => {
  const idle = performance.now() - lastActivity;
  if (idle < QUIET_PAUSE_MS) {
    quietTimer = setTimeout(checkQuiet, QUIET_PAUSE_MS - idle);
    return;
  }
  quietTimer = undefined;
  quiet = true;
  quietListeners.forEach((listener) => listener(true));
};

function markActivity() {
  lastActivity = performance.now();
  if (!quiet) return;
  quiet = false;
  quietTimer = setTimeout(checkQuiet, QUIET_PAUSE_MS);
  quietListeners.forEach((listener) => listener(false));
}

const markVisible = () => {
  if (document.visibilityState === 'visible') markActivity();
};

function onQuiet(listener: (quiet: boolean) => void): () => void {
  if (quietListeners.size === 0) {
    quiet = false;
    lastActivity = performance.now();
    quietTimer = setTimeout(checkQuiet, QUIET_PAUSE_MS);
    INPUT_EVENTS.forEach((event) => window.addEventListener(event, markActivity, { capture: true, passive: true }));
    document.addEventListener('visibilitychange', markVisible);
  }
  quietListeners.add(listener);
  if (quiet) listener(true);
  return () => {
    quietListeners.delete(listener);
    if (quietListeners.size > 0) return;
    clearTimeout(quietTimer);
    quietTimer = undefined;
    INPUT_EVENTS.forEach((event) => window.removeEventListener(event, markActivity, { capture: true }));
    document.removeEventListener('visibilitychange', markVisible);
  };
}

export function trackRoomActivity(provider: YProvider): () => void {
  const onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === provider) markActivity();
  };
  const onAwareness = ({ added, updated }: { added: number[]; updated: number[] }, origin: unknown) => {
    if (origin === provider && added.length + updated.length > 0) markActivity();
  };
  provider.doc.on('update', onUpdate);
  provider.awareness.on('change', onAwareness);
  return () => {
    provider.doc.off('update', onUpdate);
    provider.awareness.off('change', onAwareness);
  };
}

type ProviderOptions = Omit<NonNullable<ConstructorParameters<typeof YProvider>[3]>, 'party' | 'connect'>;

export interface RoomConnection {
  provider: YProvider;
  connect: () => void;
  disconnect: () => void;
  close: () => void;
}

export function openRoom(room: string, doc: Y.Doc, options: ProviderOptions = {}): RoomConnection {
  const provider = new YProvider(HOST, room, doc, { ...options, party: PARTY, connect: false });
  let settled = provider.connect();
  const after = (step: () => void | Promise<void>) => {
    settled = settled.then(step);
  };
  return {
    provider,
    connect: () => after(() => provider.connect()),
    disconnect: () => after(() => provider.disconnect()),
    close: () => {
      provider.destroy();
      after(() => provider.disconnect());
    },
  };
}

export function superviseConnection(
  { provider, connect, disconnect }: RoomConnection,
  onStatus: (status: Status) => void,
  onConnected: () => void = () => {},
): () => void {
  let everConnected = false;
  let failed = false;
  let paused = false;
  let resuming = false;
  let hiddenTooLong = false;
  let roomQuiet = false;
  let failedAttempts = 0;
  let failTimer: ReturnType<typeof setTimeout> | undefined;
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined;

  const stopFailTimer = () => {
    clearTimeout(failTimer);
    failTimer = undefined;
  };

  const fail = () => {
    failed = true;
    onStatus('failed');
  };

  const handleStatus = ({ status: next }: { status: string }) => {
    if (next === 'connected') {
      if (paused) throw new Error(`Room ${provider.roomname} connected while its connection is paused`);
      everConnected = true;
      failed = false;
      resuming = false;
      failedAttempts = 0;
      stopFailTimer();
      onConnected();
      onStatus('connected');
      return;
    }
    if (paused) return;
    if (failTimer === undefined) failTimer = setTimeout(fail, everConnected ? RECONNECT_FAIL_MS : FIRST_CONNECT_FAIL_MS);
    if (!failed) onStatus(everConnected && !resuming ? 'reconnecting' : 'connecting');
  };
  provider.on('status', handleStatus);

  const handleClose = () => {
    if (paused || provider.wsconnected || everConnected) return;
    failedAttempts += 1;
    if (failedAttempts >= FIRST_CONNECT_FAIL_ATTEMPTS) fail();
  };
  provider.on('connection-close', handleClose);

  const apply = () => {
    const next = hiddenTooLong || roomQuiet;
    if (next === paused) return;
    paused = next;
    if (paused) {
      resuming = false;
      stopFailTimer();
      onStatus('paused');
      disconnect();
      return;
    }
    resuming = true;
    failed = false;
    failedAttempts = 0;
    onStatus('connecting');
    connect();
  };

  const handleVisibility = () => {
    clearTimeout(hiddenTimer);
    if (document.visibilityState === 'hidden') {
      hiddenTimer = setTimeout(() => {
        hiddenTooLong = true;
        apply();
      }, HIDDEN_PAUSE_MS);
      return;
    }
    hiddenTooLong = false;
    apply();
  };
  document.addEventListener('visibilitychange', handleVisibility);

  const stopQuiet = onQuiet((next) => {
    roomQuiet = next;
    apply();
  });

  return () => {
    stopFailTimer();
    clearTimeout(hiddenTimer);
    stopQuiet();
    document.removeEventListener('visibilitychange', handleVisibility);
    provider.off('status', handleStatus);
    provider.off('connection-close', handleClose);
  };
}
