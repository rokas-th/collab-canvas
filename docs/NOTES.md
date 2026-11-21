# Notes

How Collab Canvas works, and why some of it is the way it is.

## Files

- `party/whiteboard.ts`: the `collab-canvas-sync` Worker and the `Whiteboard` Durable Object.
- `party/wrangler.jsonc`: Worker name, custom domain, Durable Object binding and SQLite migration, allowed origins, dev port 1999. `party/worker-configuration.d.ts` is generated from it with `npm run types:party`; run that after changing the config.
- `src/connection.ts`: the realtime host, `openRoom`, connection status and the idle pause.
- `src/useWhiteboard.ts`: one y-partyserver provider over a `Y.Doc`. Strokes are a `Y.Array`; presence (`src/presence.ts`) is Yjs awareness.
- `src/useMirror.ts` and `src/Mirror.tsx`: the network mirror.
- `src/App.tsx`: the SVG board, pointer drawing, other people's ink and cursors, room links, undo and the status display.
- `public/`: favicon, `robots.txt`, the Open Graph image and `404.html`. The `404.html` also turns off the Pages SPA fallback, so unknown paths return a real 404.

## Server

Each room is a `Whiteboard` Durable Object at `/parties/whiteboard/<room>`.

Every Yjs update is appended to the room's SQLite storage as it arrives. After 500 updates, or one update larger than 1 MB, the rows are compacted into a snapshot split into 1 MB parts, because a row holds at most 2 MB. If a write fails the object aborts: every socket drops, the room reloads its last stored state, and the clients' Yjs resync sends the lost update again.

The Worker rejects room names outside `[A-Za-z0-9_-]{1,64}` with 400 and origins outside `ALLOWED_ORIGINS` with 403. Every other request is a 404. The origin check keeps other sites from using the Worker; it is not authentication.

y-partyserver's provider closes without a status code. partyserver reads that as "no Close frame" (1005) and never answers, so the client would hang in CLOSING and could not reconnect. The room answers those closes with 1000.

## Client connection

The client connects to `VITE_SYNC_HOST`. Without it, development falls back to `localhost:1999` and any other build throws. The Vite build also refuses to run without it, so a build cannot ship pointing at nothing.

`openRoom` creates the provider and closes it correctly even when cleanup runs before y-partyserver's asynchronous `connect()` has opened the socket, which React StrictMode does in development. A plain `destroy()` leaves that socket open.

**Presence traffic.** The provider forwards every presence change it hears, other people's included, and the server relays every presence frame to every socket. Out of the box, one cursor move in a room with three tabs is three messages into the Durable Object, and Workers bills each. `openRoom` narrows each provider to forwarding only this tab's presence, so a cursor move is one message however many tabs are open. It throws if a library update moves the hook it replaces.

**Connection ids.** The provider sends the same connection id on every reconnect, and partyserver forgets a connection by its id when a socket closes. If the server noticed a dropped socket only after the tab had reconnected, it forgot the live connection too: the tab kept sending and still read live, but received nothing until it reconnected again. `openRoom` issues a new id on every connect and throws if a socket opens with a different one.

**Leaving.** A tab that disconnects normally tells the server its presence is gone. A tab that just vanishes (a network drop, a sleeping laptop, a phone killing a background tab) is removed when its socket closes. For that the Worker records which connection last sent each presence, on every frame. y-partyserver on its own credits a presence only the first time the room sees it, so a tab that had reconnected while others kept the room open stayed on screen after it vanished, until the room emptied (cloudflare/partykit#421 is the same bookkeeping).

## Idle pause

Rooms do not hibernate. y-partyserver keeps presence only in memory and neither side expires stale presence, so a room that hibernated would forget who is there and never remove peers who leave afterwards. Rooms stay in memory while a socket is open instead, which bills Durable Object duration; the Workers Free plan allows about 29 room-hours a day across the account.

So a tab disconnects when it has been hidden for 5 minutes, or when its room has been quiet for 10: no pointer, key or wheel input in the tab and no changes from anyone else. Others see it leave. A hidden tab rejoins when it is shown; a quiet one on the next pointer move, tap, key press, scroll or focus. Duration is billed per room, not per socket, so someone watching an active room is never dropped.

The status reads connecting, live, reconnecting, paused or offline. A first connection is called offline after 6 failed attempts or 8 s. A live connection that drops shows reconnecting for 10 s before it is called offline, and recovers on its own. On reconnect the provider re-sends this client's presence, so the online count is right straight away.

## Board and ink

Strokes and cursors live in one fixed 1600 x 1000 board, letterboxed to fit each screen, so a phone and a laptop see the same drawing. On touch screens two fingers pinch and pan the board up to 6x, and a Fit board pill resets it. Touches in the grey letterbox do not draw.

There is one pen at one nominal width, drawn as a filled perfect-freehand outline: smoothed, with tapered ends on strokes longer than a few pen widths. The pen body never renders thinner than 3 px, tapered ends aside. A stylus stores real pressure per point (`pressure`, one value per x,y pair) and the width follows it; mouse and finger strokes store none and keep an even width. Older strokes saved as `{id, color, points}` render the same way without migration.

**Live ink.** While someone draws, their stroke in progress rides on awareness next to their cursor: at most about 30 updates a second, and only the last 64 points per update (receivers stitch the windows back together). None of it is written to the document. Pointer-up pushes the finished stroke and clears the draft in the same tick, and a draft whose id is already committed is never drawn, so the swap has no gap and no double.

**Clear and undo.** "Clear" deletes the whole array for everyone. A `Y.UndoManager` scoped to local changes brings it back: Undo, Cmd/Ctrl+Z, and Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y to redo.

## Network mirror

A solo visitor sees a second connection to the same room in the bottom-right inset. It is a separate `Y.Doc` and provider with BroadcastChannel off, so everything in it came through the Worker. It never sets an awareness state, so nobody sees or counts it, and it sends no presence at all.

The caption is a round trip measured on one clock: from when this tab sent an awareness update or stroke (`performance.now()`) until the mirror received it, median of the last 9. It reads `—` until the first cursor move or stroke after the mirror connects. The first ink it receives from you flashes the frame and reads "Sync verified" once. When the server cannot be reached the frame goes grey and says so. When a real person is present the mirror folds into a chip and closes its socket; 2 s after they have all left it reconnects with a fresh document.

## Join moment

When someone arrives after you, the board edge washes in their colour for 500 ms, a ring opens where their cursor first lands, and their tag reads NAME JOINED for 900 ms before shrinking to the name. It plays once per client, reconnects stay quiet, and under reduced motion it is a plain text change.

## Limits

- Identity is a random name and colour per visit, anonymous and scoped to the room. There is no sign-in; adding one means gating the room and putting a verified user into awareness.
- Room ids come from `?room=`. A missing or invalid one is replaced by a fresh random room, and anyone with the link can draw.
- Pages preview builds share the production rooms.
- y-partyserver's provider registers an `unload` listener, which blocks the back/forward cache. The Vite build rewrites it to `pagehide` and fails if the library changes shape.
