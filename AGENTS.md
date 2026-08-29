# AGENTS.md — tetris-relinked

Guidance for AI coding agents working in this repository.

## Project overview

**Modern Tetris** game: a React + TypeScript + Tailwind client with a canvas playfield, plus a Node + `ws` multiplayer server (`server/`). See `notes/tech-stack.md` for the stack and rationale and `notes/architecture.md` for the module layout and multiplayer model.

## Notes directory — read these before working

The singleplayer and multiplayer feature sets are both shipped; there is no requirement checklist anymore. The docs below are the current reference.

| File | When to consult |
|---|---|
| `notes/game-design.md` | Before implementing or changing any game mechanic (SRS, 7-bag, DAS/ARR/SDF, scoring, lock delay, zero line clear delay, four-wide, zen garbage modes, multiplayer targeting). |
| `notes/architecture.md` | Before adding files/modules. Follow the layer rules (`engine/` is pure TS with no React/DOM imports) and the multiplayer model (server authority, resync rules, protocol single source of truth). |
| `notes/tech-stack.md` | Before adding any dependency or tooling. Do not introduce libraries not recorded here without updating this file first. |

## Hard rules

1. **Modern Tetris, not classic**: 5-piece preview, SRS kicks, hold, ghost piece, 7-bag, zero line clear delay.
2. **Engine purity**: code under `src/engine/` must never import React, DOM APIs, or renderer code.
3. **Fixed-timestep simulation**: handling timings (DAS/ARR/SDF, lock delay) are frame-based at 60Hz; never tie gameplay to render framerate.
4. **Terminal-like UI only**: monospace, minimal chrome; color strictly to communicate information (pieces, danger), never decoration. Effects (particles, shake) are toggleable and purely cosmetic.
5. **Multiplayer**: there is a backend now. `server/` (Node + ws) is authoritative for lobbies, room settings, matches, scoring/targeting, cross-player garbage routing, **and each player's board**. `shared/protocol.ts` is the single source of truth for client↔server messages — never duplicate message types. Every `lock` must carry the placed `cells` so the server can reconstruct an authoritative board (`server/authority.ts`). The server cross-checks client snapshots and sends a real `resync` on genuine divergence — never blindly overwrite the stack, and never ack a board that disagrees with the authority. Singleplayer modes stay fully local (localStorage persistence).
6. **Buffered input**: discrete actions (rotate/hold/hard drop) go through `GameRunner.queueActions` and are consumed on the next 60Hz tick, so they are never dropped between frames. Game screens must call `drainFrame(input, runner)` (`src/game/input.ts`) once per animation frame — never drain the `InputManager` and throw the actions away on a non-ticking frame. Build handling timings with `handlingFromSettings` (`src/state/settings.ts`); don't re-derive DAS/ARR/SDF frames per screen.
7. TypeScript strict mode. No comments unless explaining non-obvious logic.

## Workflow expectations

- Unit-test engine changes (bag distribution, kick tables, timing) with Vitest once scaffolding exists.
- Server logic lives in `server/` as pure TS (no framework); keep the socket layer thin and unit-test the logic. Run the server with `npm run server` (plain `node server/index.ts` — Node 22.18+ type stripping; imports of TS files must use explicit `.ts` extensions).
- Fast multiplayer verification uses real ephemeral WebSockets, not the browser preview: `npm run test:multiplayer` runs the two-client and message-loss contracts; `server/test-client.ts` is the shared simulator and must be reused by socket tests.
- Run lint/typecheck before declaring a task complete. Vitest's CLI does not support Jest's `--runInBand`; use `npm test` or a file-filtered `npm test -- --run ...`.

## Tests

For fast, headless multi-client iteration through real WebSocket connections, run:

```bash
npm run test:multiplayer
```