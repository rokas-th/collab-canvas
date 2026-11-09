import { routePartykitRequest, type Connection } from 'partyserver';
import { YServer } from 'y-partyserver';
import { removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';

const ROOM = /^[A-Za-z0-9_-]{1,64}$/;
const PART_BYTES = 1_000_000;
const COMPACT_AFTER = 500;

const blob = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer;

const concat = (parts: ArrayBuffer[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  parts.reduce((offset, part) => {
    out.set(new Uint8Array(part), offset);
    return offset + part.byteLength;
  }, 0);
  return out;
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const originAllowed = (origin: string, rules: string) =>
  rules
    .split(',')
    .map((rule) => new RegExp(`^${rule.trim().split('*').map(escapeRegExp).join('[a-z0-9-]+')}$`))
    .some((pattern) => pattern.test(origin));

interface PresenceChanges {
  added: number[];
  updated: number[];
  removed: number[];
}

const isConnection = (origin: unknown): origin is Connection =>
  typeof origin === 'object' && origin !== null && typeof (origin as Connection).id === 'string';

export class Whiteboard extends YServer {
  static options = { hibernate: false };

  private rows = 0;
  private presenceOwners = new Map<number, Connection>();

  private trackPresence = ({ added, updated, removed }: PresenceChanges, origin: unknown) => {
    if (!isConnection(origin)) return;
    [...added, ...updated].forEach((client) => this.presenceOwners.set(client, origin));
    removed.filter((client) => this.presenceOwners.get(client) === origin).forEach((client) => this.presenceOwners.delete(client));
  };

  async onLoad() {
    const sql = this.ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS snapshot (part INTEGER PRIMARY KEY, data BLOB NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL)');
    const parts = sql.exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot ORDER BY part').toArray();
    const updates = sql.exec<{ data: ArrayBuffer }>('SELECT data FROM updates ORDER BY seq').toArray();
    const stored = [concat(parts.map((row) => row.data)), ...updates.map((row) => new Uint8Array(row.data))].filter(
      (update) => update.byteLength > 0,
    );
    if (stored.length > 0) Y.applyUpdate(this.document, Y.mergeUpdates(stored));
    this.rows = updates.length;
    this.document.on('update', (update: Uint8Array) => this.persist(update));
    this.document.awareness.on('update', this.trackPresence);
  }

  onClose(connection: Connection, code: number) {
    const owned = [...this.presenceOwners].filter(([, owner]) => owner === connection).map(([client]) => client);
    owned.forEach((client) => this.presenceOwners.delete(client));
    if (owned.length > 0) removeAwarenessStates(this.document.awareness, owned, null);
    if (code === 1005) connection.close(1000, 'Closed');
  }

  private persist(update: Uint8Array) {
    try {
      if (update.byteLength > PART_BYTES || this.rows + 1 >= COMPACT_AFTER) {
        this.compact();
        return;
      }
      this.ctx.storage.sql.exec('INSERT INTO updates (data) VALUES (?)', blob(update));
      this.rows += 1;
    } catch (error) {
      this.ctx.abort(`Room ${this.name} failed to persist: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private compact() {
    const state = Y.encodeStateAsUpdate(this.document);
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      sql.exec('DELETE FROM snapshot');
      sql.exec('DELETE FROM updates');
      Array.from({ length: Math.ceil(state.byteLength / PART_BYTES) }, (_, part) =>
        sql.exec(
          'INSERT INTO snapshot (part, data) VALUES (?, ?)',
          part,
          blob(state.subarray(part * PART_BYTES, (part + 1) * PART_BYTES)),
        ),
      );
    });
    this.rows = 0;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const routed = await routePartykitRequest(request, env, {
      onBeforeConnect: (_request, { name }) => {
        if (!ROOM.test(name)) return new Response('Invalid room name', { status: 400 });
        if (!originAllowed(origin, env.ALLOWED_ORIGINS)) return new Response('Origin not allowed', { status: 403 });
      },
      onBeforeRequest: () => new Response('Not found', { status: 404 }),
    });
    return routed ?? new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
