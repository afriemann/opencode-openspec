## 1. Red step — failing tests

- [x] 1.1 Add `parseTokens` unit tests to `test/helpers.test.js` covering: double-quote stripping, single-quote stripping, backslash escape, multi-word quoted token as one token, and unquoted passthrough — verify they fail before implementation
- [x] 1.2 Add `openspec_cli` integration test to `test/plugin.test.js`: `new change "my-feature"` (with quotes) reaches the mock shell as `my-feature` (without) — verify it fails before implementation
- [x] 1.3 Add `openspec_cli` integration test to `test/plugin.test.js`: spawn failure throws instead of returning `{error, exitCode:null}` — verify it fails before implementation

## 2. Implementation

- [x] 2.1 Add `parseTokens(command)` to `src/lib/helpers.js` and export it — verify the helpers unit tests from 1.1 pass
- [x] 2.2 Update `isDestructive` in `src/lib/helpers.js` to use `parseTokens` instead of `split(/\s+/)` — verify existing `isDestructive` tests still pass
- [x] 2.3 Replace `split(/\s+/).filter(Boolean)` with `parseTokens(args.command)` in `openspec_cli.execute` in `src/index.js` — verify the quote-stripping test from 1.2 passes
- [x] 2.4 Replace the spawn-failure catch→return-JSON in `openspec_cli.execute` with log→rethrow — verify the throw test from 1.3 passes; update the existing "returns {error, exitCode:null}" test to expect a throw

## 3. Verify

- [x] 3.1 Run the full test suite (`npm test`) — verify all tests pass with no failures or suppressions
