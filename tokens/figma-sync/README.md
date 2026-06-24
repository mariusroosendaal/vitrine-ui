# Figma → frontend.config.json

Pull Figma variables, text styles, and effect styles into a single
**`frontend.config.json`** for `@area17/a17-tailwind-plugins` — **deterministically,
no LLM**. One-way: Figma owns the values, the config is regenerated from them. The
consuming app builds its CSS from the config.

This exists because the Figma **Variables REST API is Enterprise-only**, and we don't
want an LLM relaying a few hundred values (the non-determinism we're avoiding). A
plugin reads variables via the Plugin API — available on every plan — and either a
tiny local server writes the result to disk, **or** the plugin commits the export to
GitHub and a CI Action opens a sync PR.

```
figma-sync/
  transform.a17.mjs       the deterministic core: Figma export → frontend.config.json (pure, testable)
  transform.a17.test.mjs  offline proof of the core (npm run sync:test)
  sync.mjs                CLI: export.json → frontend.config.json   (npm run sync)
  sync-server.mjs         localhost receiver the plugin posts to    (npm run sync:serve)
  github-workflow.template.yml  the CI Action — copy into the CONSUMING app's .github/workflows/
  plugin/                 the Figma plugin (vanilla JS, no build step)
    manifest.json · code.js · ui.html
```

## How the pieces fit

```
┌─ Figma ─────────────┐         ┌─ your machine ─────────────────────────────┐
│ Figma Token Sync     │  POST   │ sync-server.mjs ─→ transform.a17.mjs ─→     │
│ plugin (Plugin API) │ ──────► │                       frontend.config.json │
│  reads vars+styles  │ :41789  └────────────────────────────────────────────┘
└─────────────────────┘
                                 …then the consuming app's Tailwind build turns
                                 frontend.config.json into CSS.
```

Or the GitHub path — same brain, no local server: the plugin commits the export to
the `figma-sync/incoming` branch of the **consuming app**, and that app's
`.github/workflows/figma-token-sync.yml` (copied from `github-workflow.template.yml`)
transforms it and opens/updates a single PR. The Action lives in the consuming app
because that's where `frontend.config.json` is owned and merged — this toolkit only
produces it.

`transform.a17.mjs` is the whole brain and is Figma-agnostic — it eats a plain JSON
export and is covered by `transform.a17.test.mjs`. The plugin and server are thin.

## Usage (the normal loop)

1. **Start the server** (in the repo): `npm run sync:serve`
2. **In Figma**, run the **Figma Token Sync** plugin → click **Read & Sync to repo**.
   (Use **Dry run** first to preview, or **Download export JSON** to sync via CLI.)
3. **Review** the diff: `git diff frontend.config.json`, then commit.

> **Restart the server after editing `transform.a17.mjs`.** Node caches modules at
> process start, so a long-running `npm run sync:serve` keeps using the code it
> launched with. (The CLI always runs fresh.)

CLI equivalent (e.g. from a downloaded export):

```bash
npm run sync -- path/to/figma-export.json    # write frontend.config.json
npm run sync -- export.json --dry-run         # preview, write nothing
npm run sync -- export.json --report          # coverage only
```

## Usage via GitHub (no local server)

> **One-time setup in the consuming app:** copy `github-workflow.template.yml` to
> `.github/workflows/figma-token-sync.yml` there. Without it, the export just lands on
> the `incoming` branch and nothing transforms it.

1. In the plugin, fill in **GitHub repo** (`owner/name` — the **consuming app**, not
   this toolkit) and a **fine-grained PAT** (Contents: Read/Write on that repo), then
   **Sync to GitHub & open PR**.
2. The plugin commits the export to the **`figma-sync/incoming`** branch. That push
   triggers the consuming app's `figma-token-sync.yml`, which transforms the export
   and opens/updates a single **sync PR** — but only if `frontend.config.json` actually
   drifted (no diff ⇒ no PR).
3. Review and merge like any other PR.

Repo/token are remembered in Figma `clientStorage` (local, never committed). The
export is read off the `incoming` branch by the Action and never reaches `main`.

**Token:** a **fine-grained PAT** scoped to this repo with **Contents: Read/Write**.
**One repo setting:** Settings → Actions → General → *Workflow permissions* → enable
**"Allow GitHub Actions to create and approve pull requests."**

## The mapping

`frontend.config.json` has four sections; here's where each comes from. All routing
lives in `CONFIG` at the top of `transform.a17.mjs`.

| Section | Source in Figma |
| --- | --- |
| `structure.breakpoints` | the `responsive` collection's `…/breakpoint` variable (value per breakpoint mode) |
| `structure.columns` | `layout/columns` (per breakpoint) |
| `structure.gutters.inner` / `.outer` | `layout/gutter` / `layout/margin` (per breakpoint) |
| `structure.container` | defaults to `"auto"` (no Figma source — see below) |
| `spacing.tokens.scaler` + `spacing.groups` | `CONFIG.spacingScaler` + the `space/*` scale (per breakpoint) |
| `color.tokens` | the color-primitives collection, names flattened (`color/gray/950` → `gray-950`) |
| `color.border` / `.text` / `.background` | the semantic `color` collection (light theme), each value resolved to a token name |
| `typography.families` | `font family/<x>` (+ `-stack`) primitives |
| `typography.typesets` | text styles named `<role>/<bp>` → one responsive typeset per role |

### Conventions

- **A variable's name is its path** — routing only needs the leaf/segment names.
- **Private** — any collection, group, mode, or variable whose name starts with `_`
  (or `.`) is a design-time aid and is **never emitted**. A token that *aliases* a
  private value still resolves it (e.g. `content-width` defined as a `_grid` column
  becomes a column count; a `layout` value aliasing a private primitive is inlined).
- **`font family/<x>-stack`** holds the CSS fallback stack for `<x>`; quoting is
  normalized (a name with an apostrophe — `Suisse Int'l` — is double-quoted).
- **Text styles**: `<role>/<bp>` or `<role>/<bp-range>` (+ `-strong`). The role is the
  name minus its trailing breakpoint segment; `-strong` becomes the typeset's
  `bold-weight`. A trailing segment that isn't a known breakpoint is skipped with a
  warning (and listed in `report.unparsed`).
- **`2xl` → `xxl`**: a breakpoint key can't start with a digit (a17 builds CSS class
  names from it), so `2xl` is aliased to a17's `xxl`.
- **`X/X` → `X`**: redundant color names collapse (`white/white` → `white`).

### Tuning (if your Figma names differ)

Run a real export through `--report`, then adjust `CONFIG` in `transform.a17.mjs`:

- `collections` — the collection names for color primitives / semantic color /
  responsive / typography primitives
- `structure` — the **leaf** names that map to structure slots (`breakpoint`,
  `columns`, `gutter`, `margin`), matched at any group depth
- `breakpoints` / `breakpointAlias` — the breakpoint order and any key remaps
- `spacingPrefix` / `spacingScaler` — the spacing group prefix and a17 scaler
- `fontFamilyStacks` — last-resort stacks if a `-stack` variable is missing

### What's robust vs. what to verify

- **Solid:** structure, color tokens + semantic colors, font families, the typesets
  (responsive composites with `bold-weight`).
- **Verify on first run** (also flagged in `report.notes`):
  - **spacing** — the numeric `space/*` scale is mapped to a17 `groups`; confirm it
    matches how your app consumes spacing.
  - **container** — defaults to `"auto"` per breakpoint; point it at a real token if
    your design defines max container widths.
  - **dark theme** — a17's `frontend.config.json` color is single-value, so the
    semantic colors emit their **light** values; `dark` overrides aren't represented
    here (handle dark in the app).

## Notes

- **Source of truth.** Values flow Figma → JSON. Per-token documentation lives in the
  Figma **variable / text-style descriptions** — author docs there.
- **Exports aren't tracked.** The plugin produces `figma-export.json` on demand; it's
  gitignored. The GitHub flow commits it to the `figma-sync/incoming` branch only.
- Stop the server with Ctrl-C. Port override: `FIGMA_SYNC_PORT=xxxx npm run sync:serve`
  (also change it in `plugin/manifest.json`'s `allowedDomains`).
