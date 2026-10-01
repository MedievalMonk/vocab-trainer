# Vocab Trainer

A private, local-first English vocabulary trainer: FSRS spaced repetition, your own growing
dictionary, and data that outlives any app, device or account.

Your vocabulary lives in the browser on each device (IndexedDB) and is always exportable as
plain Markdown from **Library → Import / Export**. This repository contains code only.

## Install on a phone or PC

Open the app's address in Chrome, then use the browser menu → **Install app** (Android) or the
install icon in the address bar (Windows). It then opens like any app and works offline.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run build      # production build into dist/
npm run preview    # serve dist/ locally (service worker only runs in a build)
```

Put your vocabulary `.md` files in a local `content/` folder (git-ignored). In dev, Library and the
empty dashboard offer a "Load content/" button; on a real device use **Choose files…** instead.

## Updating

Pushing to `main` runs tests, builds and publishes through GitHub Actions
(`.github/workflows/deploy.yml`). Installed copies download the new version in the background and
show **"A new version is ready. Reload to update"**, never in the middle of a study session.

## Layout

| Path | What |
|---|---|
| `src/core/` | Pure logic: Markdown parse/export, event log, import merge, FSRS, queues, storage, service |
| `src/lib/` | Exercise generation and grading, app state, speech, PWA registration |
| `src/components/` | Svelte UI |
| `scripts/` | Icon generator and the service-worker template filled in at build time |
