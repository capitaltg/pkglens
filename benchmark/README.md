# Bundle size benchmark

Compares DepLens's bundle-size measurements against [bundlephobia](https://bundlephobia.com) across a corpus of ~100 packages.

```bash
npm run benchmark                  # measure the corpus, print a report
npm run benchmark -- --update      # also rewrite snapshot.json
npm run benchmark -- --diff        # compare against snapshot, exit 1 on drift
npm run benchmark -- --tag ui      # restrict to tagged entries (repeatable)
npm run benchmark -- --limit 10    # stop after N packages
```

**This is not part of `npm test` and does not gate CI.** It performs real npm installs and calls an external service, so it is slow and would be flaky as a required check.

## What this is for

Exact agreement with bundlephobia is **not** the goal, and targeting it would be wrong. The two tools genuinely measure different things:

|                | DepLens                                            | bundlephobia                |
| -------------- | -------------------------------------------------- | --------------------------- |
| Bundler        | esbuild                                            | webpack                     |
| Entry          | `import * as pkg from "<pkg>"; export default pkg` | the package's default entry |
| Node built-ins | reported as `serverOnly`                           | polyfilled                  |
| Externals      | host frameworks + declared peer deps               | peer deps                   |

A few percent of disagreement is expected and fine. What the benchmark is actually for:

1. **Catching outliers.** A package measuring 0.07x or 20x is a bug, not a methodology difference. Both size bugs found so far had exactly this signature.
2. **Catching drift.** `--diff` compares against a committed snapshot, so a change that silently moves every measurement shows up in review.

## Interpreting a run

Every package lands in one of five outcomes:

| outcome                | meaning                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `compared`             | Both tools produced a size. The ratio is meaningful.                                                                           |
| `divergent-serveronly` | We report `serverOnly`; bundlephobia polyfilled Node built-ins and produced a number. **Expected**, not a failure — see below. |
| `both-failed`          | Neither tool could bundle it. Agreement, just not numeric.                                                                     |
| `ours-failed`          | We failed where bundlephobia succeeded. **Usually worth investigating.**                                                       |
| `theirs-failed`        | bundlephobia errored (`BuildError`, `BlocklistedPackageError`). Informational.                                                 |

Only `compared` rows produce a ratio. The tolerance band is **0.75x–1.35x** on gzip; anything outside is reported as an outlier.

**Use gzip, not minified.** Measured across an early sample, gzip ratios spanned 1.03x–1.20x while minified spanned 0.78x–1.34x for the same packages. Gzip is both the more stable comparison and the number users care about.

## The serverOnly divergence

The sharpest methodology difference:

| package   | DepLens      | bundlephobia              |
| --------- | ------------ | ------------------------- |
| `express` | `serverOnly` | 241,793 B gzip            |
| `jest`    | `serverOnly` | `BuildError`              |
| `next`    | `serverOnly` | `BlocklistedPackageError` |

bundlephobia polyfills Node built-ins, so `express` gets a browser bundle size. We detect the built-in imports and report that there is no browser bundle.

We think ours is the more honest answer — 241 kB implies you could ship Express to a browser, which you cannot meaningfully do — but it is a deliberate divergence, so the harness classifies it separately rather than scoring it as a miss.

## Why the corpus looks like this

`corpus.ts` tags each entry by what it stresses, not by popularity:

- `tiny` — fixed overhead dominates, so small absolute gaps become large ratios
- `client` — the ordinary case
- `heavy` — multi-MB bundles, where install and bundle timeouts bite
- `ui` — wide peer-dependency sets, which drive the externals list
- `server` — imports Node built-ins; expect `divergent-serveronly`
- `tooling` — usually unbundleable by both; agreement on failure is still signal
- `scoped` — `@scope/name` URL encoding
- `esm` / `cjs` — module format differences
- `deeptree` — large transitive graphs
- `deprecated` — deprecated packages must still measure

Filter with `--tag`, e.g. `npm run benchmark -- --tag tiny --tag esm`.

## Snapshot workflow

`snapshot.json` records our gzip size and outcome per package. It is committed.

- After an intentional change to measurement, re-record: `npm run benchmark -- --update`
- To check for unintended change: `npm run benchmark -- --diff` (fails on >5% gzip movement or any outcome change)

The snapshot deliberately stores **our** numbers, not bundlephobia's. Theirs can change when they upgrade webpack, and we do not want that to look like our regression.

## Etiquette

bundlephobia is a free service. The runner is sequential, waits 1.5s between calls, and caches responses in `benchmark/.cache/` keyed by `name@version` — a published version is immutable, so a cached answer stays correct. The cache is gitignored.

## Baseline results

First full run, 108 packages, recorded in `snapshot.json`:

| outcome                | count |
| ---------------------- | ----- |
| `compared`             | 73    |
| `divergent-serveronly` | 25    |
| `both-failed`          | 9     |
| `ours-failed`          | 1     |

Of the 73 comparable packages, **67 fall within 0.75x–1.35x**, median **1.05x**.

`both-failed` — neither tool can bundle these, which is the expected answer for build tooling: `prisma`, `vite`, `jest`, `tsx`, `gatsby`, `execa`, `firebase`, `next`, `storybook`.

## Known divergences (investigated, not bugs)

**`vue` — 0.24x (ours 11 kB, bundlephobia 46 kB).** Vue's `exports` map declares `"import" → dist/vue.runtime.esm-bundler.js`, the runtime-only build. esbuild follows the map; bundlephobia resolves a fuller entry that includes the template compiler, which is most of Vue's weight. Ours reflects what a modern bundler actually gives you for `import { createApp } from "vue"`, so the gap is resolution semantics, not a measurement error.

**`moment` — 0.26x (ours 20 kB, bundlephobia 77 kB).** Same family of cause: bundlephobia's figure includes the bundled locale set; esbuild does not pull them in.

## Open outliers

Flagged for investigation, not known-good. The report prints the **minified**
ratio alongside gzip, because when the two disagree sharply that is itself the
finding:

| package      | gzip ratio | minified ratio | reading                                 |
| ------------ | ---------- | -------------- | --------------------------------------- |
| `pino`       | 2.48x      | **1.09x**      | same content, gzip disagrees            |
| `kleur`      | 0.46x      | **1.00x**      | same content, gzip disagrees            |
| `classnames` | 1.66x      | 1.75x          | we genuinely bundle more                |
| `left-pad`   | 1.72x      | —              | small; wrapper overhead is a real share |

**Where minified agrees and gzip does not, suspect the gzip figure rather than
the bundle.** For `kleur`, bundlephobia reports 1,972 B minified and 2,039 B
gzip — a gzip larger than the input it compresses, at 1.0:1, against a corpus
median of 3.0:1. Our minified matches theirs to within 0.3%, which is good
evidence we bundle the same content. `pino` has the same shape: minified within
9%, gzip 2.5x apart.

`classnames` is the one genuinely worth chasing — both sides compress normally
(1.9:1 and 1.8:1), so the 1.75x is real extra content in our bundle.

**`monaco-editor` is the only `ours-failed`** — esbuild errors where
bundlephobia succeeds. Not yet diagnosed.

## Known findings

Bugs this harness has already found:

- **Default exports were not measured.** `export * from "<pkg>"` does not re-export a default export, so default-only packages (`mitt`, `tiny-invariant`) bundled to zero bytes and measured 20 B. Fixed by importing the namespace instead — `mitt` went from 0.07x to 1.00x.
