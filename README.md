# Collab Canvas

A multiplayer whiteboard: freehand drawing and live cursors shared between everyone in a room. Running at https://collab-canvas.rokass.org. Open the same `?room=` link in two windows and draw.

The board is a Yjs document. Strokes live in a `Y.Array`; cursors, names and the stroke in progress ride on Yjs awareness. Each room is a Cloudflare Durable Object (`party/whiteboard.ts`, a y-partyserver `YServer`) that relays updates and stores them in the object's SQLite storage.

Stack: React 19, Vite 8, TypeScript 6, Tailwind 4, Yjs with y-partyserver and partyserver on Cloudflare Workers, perfect-freehand for ink.

## Run locally

Node 22 (`.nvmrc`).

```bash
npm install
npm run party   # the Worker on :1999, local SQLite in .wrangler/
npm run dev     # the site on :5173, in a second terminal
```

`npm run build` needs `VITE_SYNC_HOST`; for a local production build copy `.env.example` to `.env.production.local` (ignored by `*.local`).

`npm run type-check` (`tsc -b` over the app, the Vite config and the Worker) and `npm run lint` are the checks.

## Deploy

The site and the realtime Worker deploy separately.

```bash
npx wrangler login     # once
npm run deploy:party   # the Worker, to the custom domain in party/wrangler.jsonc
```

The site is a Cloudflare Pages project building from `main`. Set `VITE_SYNC_HOST=collab-canvas-sync.rokass.org` on the Pages project (Production and Preview); `npm run build` fails without it.

How the server stores rooms, presence, idle pausing and the network mirror: [docs/NOTES.md](docs/NOTES.md).

## Licence

MIT. See LICENSE.
