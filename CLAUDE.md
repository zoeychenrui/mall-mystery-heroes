# CLAUDE.md

GM console for a live-action assassin game. Create React App + Firebase, no
backend of our own. Start with `docs/architecture.md`; `docs/data-model.md` is
the only record of the Firestore schema and is reconstructed from call sites.

## The gate

Run all four before claiming anything is done. CI runs the same set.

```bash
npm run format      # Prettier, 4-space, rewrites in place
npm run lint        # ESLint, --max-warnings=0
npm test            # Jest
npm run build       # CRA production build
```

## Where code goes

| Kind                                              | Location                                   | Rule                                                                                                                                                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Game rules, parsing, anything decidable from data | `src/game/`                                | Pure. No Firebase, no React, no `Math.random()` without an injectable `rng`.                                                                                                                                                                                  |
| Firestore reads/writes                            | `src/components/firebase_calls/dbCalls.js` | The only place the client SDK is touched (one legacy exception: `DashBoard.js`). `functions/callableFunctions/killPlayer.js` touches the server-side Admin SDK directly, inside a `runTransaction` — a separate, intentional exception, not a seam violation. |
| Components                                        | `src/pages/`, `src/components/`            | Thin. Call into `src/game/`, hand the result to `dbCalls`.                                                                                                                                                                                                    |

**Separate deciding from writing.** `planRemap` returns a list of writes rather
than performing them; keep that shape when adding logic. It is what makes the
rules testable and what a future `writeBatch` will need.

## Tests

The filename extension routes the test to an environment — see `jest.config.js`:

- `src/game/**/*.test.js`, `src/utils/**/*.test.js` → **node** project. Pure, no DOM.
- `src/**/*.test.jsx` → **jsdom** project, Testing Library, asset stubs.

**Never import `dbCalls.js` or `utils/firebase.js` from a unit test.**
`src/utils/firebaseEnv.js` throws under `NODE_ENV=test` unless emulators are
enabled — deliberately, because `.firebaserc` points `dev` and `prod` at the
same live project. If you need the data layer in a test, it belongs in the
emulator-backed layer, not the unit layer. See `docs/testing.md`.

Write the test first and watch it fail. Every module in `src/game/` was built
that way.

## Environments

`REACT_APP_USE_EMULATORS=true` lives in `.env.development` — read by
`npm start` only. It must never go in `.env`, which `npm run build` reads and
would bake into a production bundle.

## Before starting work

Check `docs/improvements.md` — the bug you're about to hit is probably already
triaged there, with the intended fix.
