# Collab Canvas

A real-time **multiplayer whiteboard** — shared freehand drawing and **live cursors**, powered by **Yjs CRDTs** synced over **PartyKit** (Cloudflare Durable Objects). Open the same room in two tabs and draw together; conflicts merge automatically and a snapshot persists after everyone leaves.

A portfolio piece demonstrating real-time/full-stack depth: CRDT state, presence/awareness, and an edge realtime backend.

## Stack

React 19 · Vite 8 · TypeScript 6 · Tailwind 4 · **Yjs** + **y-partykit** + **PartyKit** (Durable Objects) · SVG rendering.

## How it works

- **`party/whiteboard.ts`** — a PartyKit room (Durable Object) that runs `y-partykit`'s sync protocol and persists a Yjs snapshot.
- **`src/useWhiteboard.ts`** — a `YPartyKitProvider` over a shared `Y.Doc`; strokes live in a `Y.Array`, and cursors/identity ride on Yjs **awareness**.
- **`src/App.tsx`** — SVG canvas with pointer drawing, other users' live cursors, room links, and connection status. Room id comes from `?room=` (auto-generated and shareable).

## Develop

```bash
npm install
npm run party       # PartyKit dev server on :1999  (terminal 1)
npm run dev         # Vite front end on :5173        (terminal 2)
```

Open `http://localhost:5173` in two windows — they join the same room and sync live.

## Deploy

```bash
npx partykit deploy                     # deploys the room; prints a host
# set the front end to point at it:
echo "VITE_PARTYKIT_HOST=collab-canvas.<your-account>.partykit.dev" > .env
npm run build                           # deploy dist/ to any static host (e.g. Cloudflare Pages)
```

## Notes

- Identity (name + color) is **room-scoped and anonymous** — real auth is a clean upgrade: gate the room and pass a verified user into awareness.
- Cursor coordinates are viewport pixels for simplicity; normalize to a shared document space for cross-resolution fidelity.
- Strokes are an append-only `Y.Array`; "Clear" deletes the range. Persistence is a PartyKit snapshot.
