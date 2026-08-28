# Tetris Liberation

[Play here.](https://happppya.github.io/tetris-liberation)

This project aims to liberate the TETR.IO experience for all. Star the repository if you enjoyed.

# Usage

Multiplayer needs the game server running (singleplayer modes work without it):

```bash
npm run server        # game server on ws://localhost:8787 (PORT env overrides)
npm run dev           # Vite dev preview on http://localhost:5173
```

Point the client at a remote server with `VITE_SERVER_URL` (default `ws://localhost:8787`):

```bash
VITE_SERVER_URL=wss://your-server.example npm run dev
```

Build the project
```bash
npm run build
```

Run the tests
```bash
npm test
```
