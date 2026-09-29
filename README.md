# Collab Canvas

A real-time **multiplayer whiteboard** — shared freehand drawing and **live cursors**, powered by **Yjs CRDTs** synced over **PartyKit** (Cloudflare Durable Objects). Open the same room in two tabs and draw together; conflicts merge automatically and a snapshot persists after everyone leaves.

A portfolio piece demonstrating real-time/full-stack depth: CRDT state, presence/awareness, and an edge realtime backend.

## Stack

React 19 · Vite 8 · TypeScript 6 · Tailwind 4 · **Yjs** + **y-partykit** + **PartyKit** (Durable Objects) · SVG rendering with **perfect-freehand** ink.

## How it works

- **`party/whiteboard.ts`** — a PartyKit room (Durable Object) that runs `y-partykit`'s sync protocol and persists a Yjs snapshot.
- **`src/useWhiteboard.ts`** — a `YPartyKitProvider` over a shared `Y.Doc`; strokes live in a `Y.Array`, and cursors, identity and the stroke in progress ride on Yjs **awareness** (`src/presence.ts`).
- **`src/useMirror.ts`** — the network mirror: a second, independent Yjs client on the same room, shown in the corner inset (`src/Mirror.tsx`).
- **`src/App.tsx`** — SVG canvas with pointer drawing, other users' live ink and cursors, the join moment, room links, undo, and connection status (connecting, live, reconnecting, offline). Room id comes from `?room=` (auto-generated and shareable).

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
- Strokes and cursors live in one fixed 1600×1000 board space, letterboxed to fit each screen, so a phone and a laptop see the same drawing. On touch screens two fingers pinch and pan the board (up to 6×) and a **Fit board** pill resets it; the pen body never renders thinner than 3 px (tapered ends aside), and touches in the grey letterbox don't draw.
- **Ink** is one pen at one nominal width, drawn as a filled perfect-freehand outline: smoothed, with tapered ends on strokes longer than a few pen widths. A stylus stores real pressure per point (`pressure`, one value per x,y pair) and the width follows it; mouse and finger strokes store none and keep an even width. Strokes saved before this (`{id, color, points}`) render the same way without migration.
- **Live ink:** while someone draws, their stroke in progress rides on awareness next to their cursor, at most ~30 updates a second and only the last 64 points per update (receivers stitch the windows back together), so it grows from their cursor tip on every screen. Nothing of it is written to the document; pointer-up pushes the finished stroke first and clears the draft in the same tick, and a draft whose id is already committed is never drawn, so the swap has no gap and no double.
- **Network mirror:** a solo visitor sees a second connection to the same room in the bottom-right inset. It is a genuine second `Y.Doc` + provider with BroadcastChannel off, so everything in it came through PartyKit; it never sets an awareness state, so nobody sees it or counts it as a person. The caption is a real round trip on one clock: when this tab sent an awareness update or stroke (`performance.now()`) until the mirror received it, median of the last 9. The first ink it receives from you flashes the frame and reads **Sync verified** once. When the server can't be reached the frame goes grey and says so. When a real person is present it folds into a chip and closes its socket; 2 s after they have all left it reconnects with a fresh document.
- **Join moment:** when someone arrives after you, the board edge washes in their colour for 500 ms, a ring opens where their cursor first lands and their tag reads *NAME JOINED* for 900 ms before shrinking to the name. It plays once per client (reconnects stay quiet) and becomes a plain text change under reduced motion.
- **Connections:** without Hibernation (which y-partykit doesn't support) a PartyKit room takes up to 100 connections. The mirror only exists while you are alone, so a room costs 2 sockets for a single visitor and one per person as soon as there are two.
- The status dot reads connecting, live, reconnecting or offline. A first connection is called offline after 6 failed attempts or 8 s; a live connection that drops shows reconnecting for 10 s before it is called offline, and recovers on its own. On reconnect the client re-announces its presence so the online count is right straight away.
- Strokes are a `Y.Array`; "Clear" deletes the range for everyone and a `Y.UndoManager` scoped to local changes brings it back (Undo, ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z). Persistence is a PartyKit snapshot.
- y-partykit registers an `unload` listener, which blocks the back/forward cache; the Vite build rewrites it to `pagehide` and fails if the library changes shape.
