## Why

`openspec_cli` fails whenever a change name is wrapped in shell quotes (e.g. `new change "my-feature"`). The command string is split on whitespace without stripping quotes, so the literal `"` characters pass through to the openspec binary, which rejects them as invalid name characters. Additionally, spawn failures (openspec not on PATH) are silently swallowed and returned as a JSON blob instead of propagating to the TUI — agents get an opaque error object and the user sees nothing.

## What Changes

- Add `parseTokens(command)` to `src/lib/helpers.js`: a minimal shell-like tokenizer that splits on unquoted whitespace and strips surrounding `"` and `'` from each token.
- Replace the `split(/\s+/)` call in `openspec_cli.execute` with `parseTokens`.
- Update `isDestructive` to use `parseTokens` for consistency.
- Change spawn-failure handling in `openspec_cli.execute` from catch→return-JSON to log→rethrow, following the `opencode-use` error-propagation pattern.

## Capabilities

### New Capabilities

_(none — both changes extend the existing `tools` spec)_

### Modified Capabilities

- `tools`: adds shell-quote tokenization requirement; changes "openspec not on PATH" behavior from returning `{error, exitCode:null}` to throwing

## Impact

- `src/lib/helpers.js` — new export `parseTokens`
- `src/index.js` — `openspec_cli` execute function
- `test/helpers.test.js`, `test/plugin.test.js` — updated tests
