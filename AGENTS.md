# opencode-openspec

opencode plugin wrapping the OpenSpec CLI as agent tools and injecting active-change context into the system prompt.

- Runtimes: V1 (`@opencode-ai/plugin`) via `src/plugin.v1.js` (package `main`), V2 (`@opencode/plugin`) via `src/plugin.v2.js`. Both are thin adapters over shared logic in `src/core.js`; keep behaviour identical across them.
- Provides: tools `openspec_cli`, `openspec_status`, `openspec_instructions`; `event` and `experimental.chat.system.transform` hooks on V1, `session.hook('context')` on V2.
- Layout: `src/` plugin code (helpers in `src/lib/`), `test/` tests, `docs/v2-compat-audit.md` V1→V2 hook mapping, `openspec/` specs and changes (behaviour contract).
- Test: `npm test` (Jest, `jest.config.js`). No lint or build script. CI: `.github/workflows/ci.yml`.
- Gotcha: on V2, destructive `openspec_cli` verbs (`archive`, `new change`) are refused, not prompted (no confirmation mechanism in the V2 tool context); on V1 they go through `context.ask`.
- Usage and details: see `README.md`.
