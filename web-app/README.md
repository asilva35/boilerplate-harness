# web-app

The Phase 10 browser client for `boilerplate-harness`: React + Vite + TypeScript + shadcn/ui, speaking the same WebSocket protocol as the Phase 6 vanilla client (`../src/web/index.html`, still served at `/legacy`).

This is a self-contained npm subproject — its own `package.json`, its own `node_modules` — with no build-time dependency on the parent harness. `src/lib/protocol.ts` is a local copy of the wire message types, not an import across that boundary.

```sh
npm install
npm run build   # writes dist/, served by ../src/server.ts at "/"
npm run dev     # Vite dev server, for iterating on the UI in isolation
```

See the parent repo's [README](../README.md#phase-10-web-ui-with-react--vite--shadcnui) for how this fits into the harness as a whole.
