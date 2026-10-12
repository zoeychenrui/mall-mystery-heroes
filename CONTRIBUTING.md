# Contributing

Thanks for working on Mall Mystery Heroes. This document covers how to get set
up, what we check automatically, and the conventions specific to this repo —
the ones you can't infer from reading the code.

Most contributors here work from a fork and open a pull request against `main`.
CI runs on every PR, including from forks.

## Getting set up

See [README.md](README.md) for prerequisites, the `.env` variables you need, and
how to run against the Firebase emulators.

The short version:

```bash
npm install                 # covers functions/ too, via npm workspaces
npm run firebase:emulate    # terminal 1
npm start                   # terminal 2
```

Everything runs against local emulators — you do not need access to the
`mall-mystery-heroes` Firebase project.

## Before you open a PR

```bash
npm run format   # Prettier, rewrites files in place
npm run lint     # must be clean — CI runs with --max-warnings=0
npm test
npm run build
```

CI runs exactly these. If they pass locally they will pass in CI, with one
caveat: CI sets `CI=true`, which makes Create React App treat build warnings as
errors. Run `CI=true npm run build` if you want to be certain.

## Formatting

**Don't hand-format. Run `npm run format`.**

Prettier owns all formatting — indentation, quotes, line breaks, trailing
commas. It is configured in `.prettierrc` to match the style this codebase
already used (4-space indent, single quotes, semicolons), so its output should
rarely surprise you.

`eslint-config-prettier` is listed last in `.eslintrc.json`, which turns off
every stylistic ESLint rule. ESLint here is only about correctness, never
about style. If you find yourself arguing about formatting in review, the
answer is whatever Prettier does.

The repo was reformatted in one commit, recorded in `.git-blame-ignore-revs`.
To keep `git blame` useful, run this once:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

GitHub applies it automatically in its own blame view.

## Naming

- **Component files are `PascalCase`** — `GameMasterView.js`, `ChatInput.js`.
- **Non-component modules are `camelCase`** — `dbCalls.js`, `firebaseEnv.js`,
  `auth.js`.
- Components live in a feature-named folder under `src/components/`.

## Styling

This is a Chakra UI app; there is essentially no CSS.

- Prefer the `sx` prop over `style`.
- For anything beyond a couple of props, extract a `const styles = { … }` object
  at the **bottom of the file** and reference `sx={styles.someBox}`.
  `GameMasterView.js`, `ChatInput.js`, and `PhotosDisplay.js` all follow this.

## Repo-specific rules

These are the ones that matter. They encode problems this codebase already has;
see [docs/improvements.md](docs/improvements.md) for the full backlog.

### All Firestore access goes through `dbCalls.js`

`src/components/firebase_calls/dbCalls.js` is the data-access seam. Don't import
`firebase/firestore` directly into a component.

Follow the existing naming, which is load-bearing — it tells the caller whether
they get data or a subscription:

| Prefix                              | Returns                                                       |
| ----------------------------------- | ------------------------------------------------------------- |
| `fetch…ForRoom` / `fetch…ForPlayer` | resolved data                                                 |
| `fetch…QueryFor…`                   | an unexecuted `Query`, for the caller to pass to `onSnapshot` |
| `update…For…`                       | writes                                                        |

One file bypasses this seam today (`DashBoard.js`). It's a known exception,
not precedent. Don't add another — `functions/callableFunctions/killPlayer.js`
touching the Admin SDK directly doesn't count here; it's server-side code in
a different package, not a component reaching around `dbCalls.js`.

### Don't swallow errors

`dbCalls.js` functions throw on failure rather than wrapping their body in
`try/catch`, logging with `console.error`, and returning `undefined` —
callers checking a resolved value can't tell success from silent failure,
and it used to resurface later as `TypeError: Cannot read properties of
undefined` somewhere unrelated, with nothing shown to the user
([improvements item 10](docs/improvements.md)).

Don't add that pattern back. Let the error propagate to an existing or new
`try/catch` at the call site and surface it with `CreateAlert`, or — if the
call site is somewhere a failure genuinely shouldn't interrupt or alarm the
GM (`GameMasterView.addLog`, called from many places, is the existing
example) — catch it locally and degrade gracefully, but still `console.error`
so it's not silent to a developer.

### Prefer live subscriptions over fetch-once-and-mutate

`GameMasterView` keeps arrays that are fetched once on mount and then mutated
optimistically, while `PlayersList` and `PhotosDisplay` subscribe with
`onSnapshot`. The two already drift apart — a second GM's actions are invisible
until reload.

New rendered state should come from a subscription.

### Put game rules in a pure function

The target-assignment algorithm used to exist in three near-identical copies;
it's now one, `src/game/targetGraph.js`, which `TargetGenerator.js`,
`ResetTargetsButton.js`, and `RemapPlayers.js` all call into.

New game logic belongs in a plain, testable function in `src/game/` — not
inside a component. That's what makes it unit-testable without Firebase or
React, and it's the pattern every fix in `improvements.md` follows.

### Multi-word player names aren't normalized consistently

`dbCalls.js`'s `normalizePlayerName` strips **all** whitespace
(`"Alice Smith"` → `"alicesmith"`); the command bar's `.toLowerCase()` calls
strip none. For a single-word name these produce the same key, so most of the
codebase's case-insensitivity (improvements item 1) already covers it. A
multi-word name entered via the command bar's bracket syntax
(`/kill [Alice Smith] bob`) still won't match the stored key. See
[improvements item 35](docs/improvements.md).

### `eslint-disable` must name its rule and say why

```js
// Good
// eslint-disable-next-line react-hooks/exhaustive-deps -- query is stable; adding it re-subscribes every render

// Bad — disables every rule on the line, with no explanation
// eslint-disable-next-line
```

## Tests

See [docs/testing.md](docs/testing.md) for the testing strategy.

Tests run under Jest directly (not `react-scripts test`), configured in
`jest.config.js`. Pure functions — game rules especially — are the highest-value
thing to test and the easiest, since they need no Firebase.

## Updating documentation

Two documents rot fastest because nothing in code references them. Update them
in the same PR as the change:

- Changing a Firestore field, or adding a collection → **[docs/data-model.md](docs/data-model.md)**
- Changing the command bar → **[docs/commands.md](docs/commands.md)**

If you change how a core flow works, check
[docs/game-flows.md](docs/game-flows.md) too.

## Pull requests

- Keep them focused. A formatting sweep mixed with a logic change is very hard
  to review.
- Say what you changed, why, and how you verified it. The PR template prompts
  for this.
- If you fix something from `docs/improvements.md`, reference the item number
  and remove it from that file.
