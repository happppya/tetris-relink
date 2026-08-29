# Tetris Relinked

[Play here.](https://happppya.github.io/tetris-relinked)

Tetris relinked is a simple online multiplayer tetris website inspired by the modern features of TETR.IO but made open-source. Star the repository if you enjoyed. PRs and suggestions are welcome.

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

## Local multiplayer development

Install dependencies once from the repository root:

```bash
npm install
```

Run the WebSocket server and browser client in separate terminals:

```bash
# Terminal 1: multiplayer server
npm run server:dev

# Terminal 2: Vite client
npm run dev
```

Open `http://localhost:5173` in two or more browser windows. The client connects to `ws://localhost:8787` by default. To use another local server, set `VITE_SERVER_URL` before starting Vite:

```bash
VITE_SERVER_URL=ws://127.0.0.1:8787 npm run dev
```

For fast, headless multi-client iteration through real WebSocket connections, run:

```bash
npm run test:multiplayer
```

The test server uses ephemeral ports, so it does not require a running local server.

## Deployment

The frontend is a static Vite site and the multiplayer backend is a separate long-running Node.js WebSocket service. Deploy them independently.

Build the frontend with the public WebSocket endpoint configured at build time:

```bash
VITE_SERVER_URL=wss://your-server.example npm run build
```

Serve the generated `dist/` directory with any static hosting provider. For GitHub Pages project sites, set the repository base path when building:

```bash
BASE_PATH=/your-repository/ VITE_SERVER_URL=wss://your-server.example npm run build
```

**GitHub Pages (recommended).** The deploy workflow (`.github/workflows/deploy.yml`) builds on every push to `master` and handles this automatically — it derives the base path from the repository name and bakes the production server URL into the build from a repository **Variable** (Settings → Secrets and variables → Actions → Variables → `VITE_SERVER_URL`, e.g. `wss://your-server.example`). If that variable is missing the build fails rather than shipping a site wired to a localhost server. Local development is unaffected: `npm run dev` keeps the `ws://localhost:8787` default with no environment set. See `.env.example` for the full dev/prod split.

Run the server on the deployment host with Node.js 22.18 or newer:

```bash
PORT=8787 npm run server
```

Put the WebSocket service behind a TLS-enabled reverse proxy and expose it as `wss://...`; ensure the proxy supports WebSocket upgrades and forwards the configured `PORT`. The frontend must use `wss://` when served over HTTPS because browsers block insecure `ws://` connections from secure pages.
