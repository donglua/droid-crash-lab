# Electron Desktop Distribution Design

## Goal

Package the existing React and Fastify application as a macOS desktop app without duplicating application behavior or bundling the Android SDK.

## Architecture

The existing production dependency assembly remains the single backend implementation. The CLI and Electron entry points both build that Fastify app and use the same loopback listener. The CLI keeps port `4319`; Electron requests port `0`, receives an available loopback port from the OS, then opens that URL in a sandboxed `BrowserWindow`.

The packaged app contains compiled server, web, and Electron files plus production npm dependencies. `adb` and `apkanalyzer` continue to be resolved from `PATH`, `ANDROID_HOME`, or `ANDROID_SDK_ROOT` at runtime. No SDK files are copied into the application.

## Desktop lifecycle and security

- Electron starts Fastify before creating the first window.
- The window loads only the local HTTP origin and uses `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`.
- New windows are denied because the current product has no desktop popup requirement.
- On quit, Electron asks the existing production shutdown function to stop polling, active runs, and Fastify before exiting.
- Closing the last window follows standard macOS behavior: the process remains available and recreates the window on activation.

## Packaging

`electron-builder` produces one `.dmg` and one `.zip` for each requested architecture. Artifact names contain product name, release version, and architecture. Signing identity discovery is disabled and the macOS identity is explicitly unset, so the first release is unsigned and not notarized.

## Release automation

A GitHub Actions workflow reacts to published releases whose tag begins with `v`. It validates the tag version through `npm version`, builds arm64 and x64 in a matrix, then uploads both formats to the triggering release. The workflow runs on macOS because electron-builder cannot create macOS packages on Linux or Windows.

## User-facing constraints

- A compatible local Android SDK is still required for device and APK operations.
- Unsigned downloads can be blocked by Gatekeeper. The README documents opening the app through Finder or macOS Privacy & Security settings.
- Icons, Apple signing, hardened runtime, entitlements, and notarization are intentionally outside the first release.

## Verification

- Unit/integration tests prove production app options and loopback dynamic-port startup.
- An Electron Playwright smoke test proves the compiled desktop process opens the existing React page.
- Lint, TypeScript checks, the full Vitest suite, the existing web build, and local arm64 packaging validate the final change.
