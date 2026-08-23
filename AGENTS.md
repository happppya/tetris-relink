# AGENTS.md — tetris-liberation

Guidance for AI coding agents working in this repository.

## Project overview

Fully frontend, singleplayer **modern Tetris** application (React + TypeScript + Tailwind, canvas playfield). See `notes/tech-stack.md` for the stack and rationale.

## Notes directory — read these before working

| File | When to consult |
|---|---|
| `notes/todo.md` | **Always start here.** Full requirement list with status. Check off items as you complete them; do not remove requirements. |
| `notes/game-design.md` | Before implementing or changing any game mechanic (SRS, 7-bag, DAS/ARR/SDF, scoring, lock delay, zero line clear delay). |
| `notes/architecture.md` | Before adding files/modules. Follow the layer rules (`engine/` is pure TS with no React/DOM imports). |
| `notes/tech-stack.md` | Before adding any dependency or tooling. Do not introduce libraries not recorded here without updating this file first. |

## Hard rules

1. **Modern Tetris, not classic**: 5-piece preview, SRS kicks, hold, ghost piece, 7-bag, zero line clear delay.
2. **Engine purity**: code under `src/engine/` must never import React, DOM APIs, or renderer code.
3. **Fixed-timestep simulation**: handling timings (DAS/ARR/SDF, lock delay) are frame-based at 60Hz; never tie gameplay to render framerate.
4. **Terminal-like UI only**: monospace, minimal chrome; color strictly to communicate information (pieces, danger), never decoration. Effects (particles, shake) are toggleable and purely cosmetic.
5. **No backend**: everything client-side; persistence via localStorage.
6. TypeScript strict mode. No comments unless explaining non-obvious logic.

## Workflow expectations

- Update `notes/todo.md` status markers (`[ ]`, `[~]`, `[x]`) as work progresses.
- Unit-test engine changes (bag distribution, kick tables, timing) with Vitest once scaffolding exists.
- Run lint/typecheck before declaring a task complete.
