import type YPartyKitProvider from 'y-partykit/provider';

export type Status = 'connecting' | 'connected' | 'reconnecting' | 'failed';

const FIRST_CONNECT_FAIL_MS = 8000;
const FIRST_CONNECT_FAIL_ATTEMPTS = 6;
const RECONNECT_FAIL_MS = 10000;

function partyHost(): string {
  const host = import.meta.env.VITE_PARTYKIT_HOST;
  if (host) return host;
  if (import.meta.env.DEV) return 'localhost:1999';
  throw new Error('VITE_PARTYKIT_HOST is not set, so this build has no realtime server to connect to.');
}

export const HOST = partyHost();

export function trackStatus(
  provider: YPartyKitProvider,
  onStatus: (status: Status) => void,
  onConnected: () => void = () => {},
): () => void {
  let everConnected = false;
  let failed = false;
  let failedAttempts = 0;
  let failTimer: ReturnType<typeof setTimeout> | undefined;

  const fail = () => {
    failed = true;
    onStatus('failed');
  };

  const handleStatus = ({ status: next }: { status: string }) => {
    if (next === 'connected') {
      everConnected = true;
      failed = false;
      failedAttempts = 0;
      clearTimeout(failTimer);
      failTimer = undefined;
      onConnected();
      onStatus('connected');
      return;
    }
    if (failTimer === undefined) failTimer = setTimeout(fail, everConnected ? RECONNECT_FAIL_MS : FIRST_CONNECT_FAIL_MS);
    if (!failed) onStatus(everConnected ? 'reconnecting' : 'connecting');
  };
  provider.on('status', handleStatus);

  const handleClose = () => {
    if (provider.wsconnected || everConnected) return;
    failedAttempts += 1;
    if (failedAttempts >= FIRST_CONNECT_FAIL_ATTEMPTS) fail();
  };
  provider.on('connection-close', handleClose);

  return () => {
    clearTimeout(failTimer);
    provider.off('status', handleStatus);
    provider.off('connection-close', handleClose);
  };
}
