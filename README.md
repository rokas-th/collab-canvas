# Collab Canvas

A real-time **multiplayer whiteboard** — shared freehand drawing and **live cursors**, powered by **Yjs CRDTs** synced over **PartyKit** (Cloudflare Durable Objects). Open the same room in two tabs and draw together; conflicts merge automatically and a snapshot persists after everyone leaves.

A portfolio piece demonstrating real-time/full-stack depth: CRDT state, presence/awareness, and an edge realtime backend.

## Stack

React 19 · Vite 8 · TypeScript 6 · Tailwind 4 · **Yjs** + **y-partykit** + **PartyKit** (Durable Objects) · SVG rendering.

## How it works

- **`party/whiteboard.ts`** — a PartyKit room (Durable Object) that runs `y-partykit`'s sync protocol and persists a Yjs snapshot.
- **`src/useWhiteboard.ts`** — a `YPartyKitProvider` over a shared `Y.Doc`; strokes live in a `Y.Array`, and cursors/identity ride on Yjs **awareness**.
- **`src/App.tsx`** — SVG canvas with pointer drawing, other users' live cursors, room links, undo, and connection status (connecting, live, reconnecting, offline). Room id comes from `?room=` (auto-generated and shareable).

## Develop

```bash
npm install
npm run party       # PartyKit dev server on :1999  (terminal 1)
npm run dev         # Vite front end on :5173        (terminal 2)
```

Open `http://localhost:5173` in two windows — they join the same room and sync live. The dev server falls back to `localhost:1999` only in development.

```bash
npm run type-check  # tsc -b: app, Vite config and the PartyKit server
npm run lint
```

## Deploy

```bash
npx partykit deploy                     # deploys the room; prints a host
```

Set `VITE_PARTYKIT_HOST=collab-canvas.<your-account>.partykit.dev` for the build — as a Cloudflare Pages environment variable (Production and Preview) or in `.env`. `npm run build` fails when it is missing, so a build can never ship pointing at nothing.

`public/` holds the favicon, `robots.txt`, the Open Graph image and a `404.html`, which also turns off the Pages SPA fallback so unknown paths return a real 404.

## Notes

- Identity (name + color) is **room-scoped and anonymous** — real auth is a clean upgrade: gate the room and pass a verified user into awareness.
- Strokes and cursors live in one fixed 1600×1000 board space, letterboxed to fit each screen, so a phone and a laptop see the same drawing. On touch screens two fingers pinch and pan the board (up to 6×) and a **Fit board** pill resets it; strokes never render thinner than 3 px, and touches in the grey letterbox don't draw.
- The status dot reads connecting, live, reconnecting or offline. A first connection is called offline after 6 failed attempts or 8 s; a live connection that drops shows reconnecting for 10 s before it is called offline, and recovers on its own. On reconnect the client re-announces its presence so the online count is right straight away.
- Strokes are a `Y.Array`; "Clear" deletes the range for everyone and a `Y.UndoManager` scoped to local changes brings it back (Undo, ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z). Persistence is a PartyKit snapshot.
- y-partykit registers an `unload` listener, which blocks the back/forward cache; the Vite build rewrites it to `pagehide` and fails if the library changes shape.
