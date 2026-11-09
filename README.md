# Collab Canvas

A real-time **multiplayer whiteboard** — shared freehand drawing and **live cursors**, powered by **Yjs CRDTs** synced through a **Cloudflare Durable Object** per room. Open the same room in two tabs and draw together; conflicts merge automatically and every stroke is stored in the room's SQLite database.

A portfolio piece demonstrating real-time/full-stack depth: CRDT state, presence/awareness, and an edge realtime backend.

## Stack

React 19 · Vite 8 · TypeScript 6 · Tailwind 4 · **Yjs** + **y-partyserver** + **partyserver** on SQLite-backed **Durable Objects** (Workers, deployed with wrangler) · SVG rendering with **perfect-freehand** ink.

## How it works

- **`party/whiteboard.ts`** — the `collab-canvas-sync` Worker. Each room is a `Whiteboard` Durable Object (a `y-partyserver` `YServer`) at `/parties/whiteboard/<room>`. Every Yjs update is appended to the room's SQLite storage as it arrives, and after 500 updates (or one larger than 1 MB) the rows are compacted into a snapshot split into 1 MB parts (the row limit is 2 MB). If a write fails the object aborts: every socket drops, the room reloads its last stored state, and the clients' Yjs resync sends the lost update again. The Worker rejects room names outside `[A-Za-z0-9_-]{1,64}` (400) and origins outside `ALLOWED_ORIGINS` (403); everything else is a 404. y-partyserver's provider closes with no status code, which partyserver treats as "no Close frame" (1005) and never answers, so the client would hang in CLOSING and could not reconnect; the room answers those with 1000.
- **`party/wrangler.jsonc`** — Worker name, custom domain, Durable Object binding and SQLite migration, allowed origins, and the dev port (1999). `party/worker-configuration.d.ts` is generated from it with `npm run types:party`.
- **`src/useWhiteboard.ts`** — a `y-partyserver` provider over a shared `Y.Doc`; strokes live in a `Y.Array`, and cursors, identity and the stroke in progress ride on Yjs **awareness** (`src/presence.ts`).
- **`src/useMirror.ts`** — the network mirror: a second, independent Yjs client on the same room, shown in the corner inset (`src/Mirror.tsx`).
- **`src/connection.ts`** — the realtime host, `openRoom` (creates the provider and closes it even when cleanup runs before y-partyserver's asynchronous `connect()` has opened the socket, which React StrictMode does in development; a plain `destroy()` leaves that socket open), connection status, and the idle pause (hidden tabs and quiet rooms).
- **`src/App.tsx`** — SVG canvas with pointer drawing, other users' live ink and cursors, the join moment, room links, undo, and connection status (connecting, live, reconnecting, offline). Room id comes from `?room=` (auto-generated and shareable; an invalid one is replaced by a fresh room).

## Develop

```bash
npm install
npm run party       # wrangler dev: the Worker on :1999 with local SQLite in .wrangler/  (terminal 1)
npm run dev         # Vite front end on :5173, or the next free port                      (terminal 2)
```

Open the Vite URL in two windows — they join the same room and sync live. The dev server falls back to `localhost:1999` only in development.

```bash
npm run type-check  # tsc -b: app, Vite config and the Worker
npm run lint
npm run types:party # regenerate party/worker-configuration.d.ts after changing party/wrangler.jsonc
```

## Deploy

The site and the realtime Worker deploy separately.

```bash
npx wrangler login      # once per machine
npm run deploy:party    # deploys collab-canvas-sync to collab-canvas-sync.rokass.org
```

The site is a Cloudflare Pages project that builds from `main`. Set `VITE_SYNC_HOST=collab-canvas-sync.rokass.org` on the Pages project (Production and Preview). `npm run build` fails when it is missing, so a build can never ship pointing at nothing. Preview builds share the production rooms.

`public/` holds the favicon, `robots.txt`, the Open Graph image and a `404.html`, which also turns off the Pages SPA fallback so unknown paths return a real 404.

## Notes

- Identity (name + color) is **room-scoped and anonymous** — real auth is a clean upgrade: gate the room and pass a verified user into awareness. The origin check keeps other sites from using the Worker; it is not authentication.
- Strokes and cursors live in one fixed 1600×1000 board space, letterboxed to fit each screen, so a phone and a laptop see the same drawing. On touch screens two fingers pinch and pan the board (up to 6×) and a **Fit board** pill resets it; the pen body never renders thinner than 3 px (tapered ends aside), and touches in the grey letterbox don't draw.
- **Ink** is one pen at one nominal width, drawn as a filled perfect-freehand outline: smoothed, with tapered ends on strokes longer than a few pen widths. A stylus stores real pressure per point (`pressure`, one value per x,y pair) and the width follows it; mouse and finger strokes store none and keep an even width. Strokes saved before this (`{id, color, points}`) render the same way without migration.
- **Live ink:** while someone draws, their stroke in progress rides on awareness next to their cursor, at most ~30 updates a second and only the last 64 points per update (receivers stitch the windows back together), so it grows from their cursor tip on every screen. Nothing of it is written to the document; pointer-up pushes the finished stroke first and clears the draft in the same tick, and a draft whose id is already committed is never drawn, so the swap has no gap and no double.
- **Network mirror:** a solo visitor sees a second connection to the same room in the bottom-right inset. It is a genuine second `Y.Doc` + provider with BroadcastChannel off, so everything in it came through the Worker; it never sets an awareness state, so nobody sees it or counts it as a person, and its provider's awareness forwarding is detached so it doesn't echo everyone's presence back through the server (it throws if a library change ever re-attaches it). The caption is a real round trip on one clock: when this tab sent an awareness update or stroke (`performance.now()`) until the mirror received it, median of the last 9; it reads `—` until the first cursor move or stroke after the mirror connects. The first ink it receives from you flashes the frame and reads **Sync verified** once. When the server can't be reached the frame goes grey and says so. When a real person is present it folds into a chip and closes its socket; 2 s after they have all left it reconnects with a fresh document.
- **Join moment:** when someone arrives after you, the board edge washes in their colour for 500 ms, a ring opens where their cursor first lands and their tag reads *NAME JOINED* for 900 ms before shrinking to the name. It plays once per client (reconnects stay quiet) and becomes a plain text change under reduced motion.
- **No hibernation:** y-partyserver keeps presence only in memory and neither side expires stale presence, so a room that hibernated would forget who is there and never remove peers who leave afterwards. Rooms stay in memory while a socket is open instead, which bills Durable Object duration, and the Workers Free plan allows about 29 room-hours a day across the account. So a tab disconnects when it has been hidden for 5 minutes, or when its room has been quiet for 10: no pointer, key or wheel input in the tab and no changes from anyone else. Others see it leave. A hidden tab rejoins when it is shown, a quiet one on the next pointer move, tap, key press, scroll or focus. Duration is billed per room, not per socket, so someone watching an active room is never dropped.
- The status dot reads connecting, live, reconnecting, paused (idle, see above) or offline. A first connection is called offline after 6 failed attempts or 8 s; a live connection that drops shows reconnecting for 10 s before it is called offline, and recovers on its own. On reconnect the provider re-sends this client's presence, so the online count is right straight away.
- Strokes are a `Y.Array`; "Clear" deletes the range for everyone and a `Y.UndoManager` scoped to local changes brings it back (Undo, ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z).
- y-partyserver's provider registers an `unload` listener, which blocks the back/forward cache; the Vite build rewrites it to `pagehide` and fails if the library changes shape.
