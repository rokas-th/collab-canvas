import type * as Party from 'partykit/server';
import { onConnect } from 'y-partykit';

/**
 * PartyKit room (a Cloudflare Durable Object) that syncs a Yjs document.
 * `y-partykit` handles the CRDT update protocol + awareness; we persist a
 * snapshot so a room survives all clients disconnecting.
 */
export default class WhiteboardServer implements Party.Server {
  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection) {
    return onConnect(conn, this.room, { persist: { mode: 'snapshot' } });
  }
}
