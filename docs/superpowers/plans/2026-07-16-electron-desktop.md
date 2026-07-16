# Electron Desktop Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the existing React/Fastify app as unsigned macOS arm64 and x64 Electron release assets.

**Architecture:** Extract production backend assembly from the CLI side-effect entry point, then share a loopback listener between CLI and Electron. Electron loads the built React app through that in-process Fastify server, while electron-builder and GitHub Actions own distribution only.

**Tech Stack:** TypeScript, Fastify, React/Vite, Electron, electron-builder, Vitest, Playwright, GitHub Actions

---

### Task 1: Make production startup reusable

**Files:**
- Create: `src/server/production-app.ts`
- Create: `src/server/production-server.ts`
- Create: `src/server/production-server.test.ts`
- Modify: `src/server/index.ts`
- Modify: `src/server/index.test.ts`

- [ ] Change the existing production test first so `buildProductionApp({ environment, webRoot })` is required and verify the supplied web root serves the React fallback.
- [ ] Run `npm test -- src/server/index.test.ts` and confirm the new assertion fails against the old positional environment API.
- [ ] Move dependency assembly into `production-app.ts` with a readonly `ProductionAppOptions` type containing optional `environment` and `webRoot`.
- [ ] Add a listener returning the actual loopback `URL` from `app.server.address()`, with port `0` supported.
- [ ] Keep `index.ts` as a thin CLI boundary that listens on port `4319`, installs signals, and reports fatal startup errors.
- [ ] Run the focused server tests and confirm they pass.

### Task 2: Add the Electron entry point

**Files:**
- Create: `src/electron/main.ts`
- Create: `tsconfig.electron.json`
- Create: `tests/e2e/electron.spec.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.tools.json`

- [ ] Add an Electron Playwright smoke test that launches `dist/electron/main.js` and expects the existing DroidCrashLab page title.
- [ ] Build and run the smoke test before the Electron entry point exists; confirm it fails because no desktop main process is available.
- [ ] Install current Electron and electron-builder development dependencies.
- [ ] Compile a main process that builds Fastify with `webRoot: resolve(electronApp.getAppPath(), "dist")`, listens on loopback port `0`, then loads the returned URL.
- [ ] Configure the window with Node integration disabled, context isolation and sandbox enabled, and popup creation denied.
- [ ] Reuse the backend shutdown function during Electron quit and recreate the window on macOS activation.
- [ ] Add `build:electron`, `desktop`, and `package:mac` scripts plus Electron type checking.
- [ ] Run the Electron smoke test and confirm it passes.

### Task 3: Configure unsigned dual-architecture packaging

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `README.md`

- [ ] Set `main` to `dist/electron/main.js`.
- [ ] Add electron-builder files/output/app-id/product-name/mac target configuration with `identity: null`, `dmg` and `zip` targets, and `${productName}-${version}-${arch}.${ext}` artifacts.
- [ ] Ignore the local `release/` output.
- [ ] Document desktop requirements, SDK discovery, unsigned Gatekeeper behavior, and local packaging commands.
- [ ] Run `CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:mac -- --arm64` and confirm `.dmg` and `.zip` are produced without an SDK inside the app bundle.

### Task 4: Publish release assets from GitHub Actions

**Files:**
- Create: `.github/workflows/release-macos.yml`

- [ ] Trigger only on published `v*` releases and grant `contents: write`.
- [ ] Use a matrix for `arm64` and `x64`, install Node 26 dependencies with `npm ci`, and sync the package version from the release tag.
- [ ] Build each architecture with signing identity discovery disabled.
- [ ] Upload each architecture's `.dmg` and `.zip` through the authenticated GitHub CLI.
- [ ] Inspect the workflow and run a local YAML parse or action lint when available.

### Task 5: Final verification

**Files:** all changed files

- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run the Electron Playwright smoke test.
- [ ] Inspect `git diff --check`, changed-file sizes, packaged contents, and `git status` for accidental files.
