# Collaborative Canvas — Design Spec (`collab-canvas`, new project)

- **Date:** 2026-06-27
- **Status:** Approved (design); pending implementation plan
- **Project:** `collab-canvas` (new) — real-time full-stack build proving auth + WebSockets + data depth
- **Goal:** A multiplayer whiteboard — live cursors + shared editing — built on Cloudflare's edge (matches CF Pages hosting). Proves presence, conflict resolution, and end-to-end realtime engineering.

## 1. Concept

Open a room, share the URL, and draw/move/edit together in real time: see other people's **live cursors**, selections, and shape edits with no perceptible lag. A focused, impressive demo of real-time product engineering.

## 2. Experience Flow

1. **Lobby** — create or join a room (shareable URL); pick a name/color.
2. **Canvas** — add/move/resize/delete shapes, sticky notes, freehand strokes, text.
3. **Presence** — other users' cursors, names, and selections render live.
4. **Persistence** — room state survives reload (server-authoritative).

## 3. Architecture

- **Frontend (Vite SPA):** `Canvas` (SVG or `<canvas>` renderer), `Toolbar`, `PresenceLayer` (cursors), `RoomProvider`, `useRoom` hook. State via **Yjs** CRDT document (shapes, text); ephemeral presence via Yjs **awareness**.
- **Realtime backend:** **PartyKit** (`partysocket` client) running on **Cloudflare Durable Objects** — one Durable Object per room is the single source of truth, relays Yjs updates, and persists the document. This is the 2026-native edge-realtime path and matches your Cloudflare deployment.
- **Conflict resolution:** Yjs CRDT merges concurrent edits deterministically — no custom OT.
- **Auth:** lightweight room-scoped identity (name + color + anonymous id) for the showcase; optional upgrade path to real auth (see Out of Scope).

## 4. Data & Sync

- **Document model:** Yjs `Y.Map`/`Y.Array` of shapes; each shape `{ id, type, x, y, w, h, rotation, style, text? }`.
- **Presence:** awareness state `{ cursor: {x,y}, name, color, selection }` — broadcast, not persisted.
- **Persistence:** Durable Object stores the encoded Yjs doc; late joiners get the full state on connect.

## 5. Stack (latest stable, 2026-06-27)

React 19.2 · react-dom 19.2 · react-router-dom 7.18 · vite 8.1 · typescript 6.0 · tailwindcss 4.3 (`@tailwindcss/vite`) · zustand 5.0.14 (local UI state) · **yjs 13.6.31** · **partysocket 1.3.0** + **partykit 0.0.115** (Durable Objects realtime) · `motion` 12.42. Tooling: `wrangler` 4.105.0. Deploy: Cloudflare Pages (frontend) + PartyKit/Durable Object (backend).

## 6. Quality

- **Performance:** batch/throttle cursor updates (~30–60fps), requestAnimationFrame render, virtualize large shape counts.
- **Resilience:** reconnect with backoff (`partysocket` handles this); on reconnect, re-sync the Yjs doc (no lost edits).
- **A11y:** keyboard shortcuts for tools; visible focus; reduced-motion respects cursor smoothing.

## 7. Out of Scope (YAGNI)

- No real account system / SSO in v1 (room-scoped identity only) — documented upgrade path: add auth (e.g. Clerk/Auth.js) + per-user rooms later.
- No export to image/PDF in v1 (easy follow-up), no comments/chat.

## 8. Risks

- **Durable Object/PartyKit deploy complexity** → PartyKit CLI + `wrangler` smooth this; document the deploy in the README.
- **CRDT memory growth** → periodic Yjs document compaction/snapshotting in the Durable Object.
- **Cursor spam** → throttle + coalesce awareness updates.
