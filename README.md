# Afterframe

A private S3-like video library with FFmpeg HLS transcoding, real thumbnail & color-signature extraction, recoverable trash, private share links, and an interactive **Memory Constellation** that plots your clips as glowing stars tinted by their own frames.

Supports both **zero-config local filesystem storage** (`./data`) and **Supabase persistent cloud storage** (Auth, Postgres metadata, and private Storage bucket).

## Run locally

```sh
npm install
```

Start the API + FFmpeg worker and the Vite dev server in separate terminals:

```sh
npm run server
npm run dev -- --host 127.0.0.1
```

Then open `http://127.0.0.1:5173`.

Or build and serve everything from one Node process:

```sh
npm run build
npm start
```

Then open `http://127.0.0.1:3001`.

## Tests

Run the end-to-end API, FFmpeg transcoding, HLS signing, sharing, and trash test suite:

```sh
npm test
```

## Deploy

The included `Dockerfile` builds the frontend and runs the API + FFmpeg worker in one container. For Railway, Render, or Fly.io:

1. Deploy from this repository.
2. Set `AFTERFRAME_SIGNING_SECRET` to a long random secret.
3. Either attach a persistent disk at `/data` (local mode) **or** configure Supabase environment variables (see `.env.example`).

The service listens on `PORT` automatically.

## Supabase persistent storage (optional)

1. Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL Editor to create the `public.videos` table, indexes, RLS policies, and the private `afterframe-videos` storage bucket.
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (and optionally `SUPABASE_ANON_KEY`) in your deployment environment — never commit secrets to source control.
3. When configured, Afterframe automatically uses Supabase Auth for accounts, Postgres for clip metadata, and the private `afterframe-videos` bucket for originals, thumbnails, and HLS streams.

## Features

- **Private accounts**: Registration, sign-in, profile editing, and sign-out with salted `scrypt` hashes (or Supabase Auth), timing-safe HMAC-signed HTTP-only sessions, and strict per-owner authorization.
- **Upload & FFmpeg pipeline**: Drag-and-drop or file picker upload with live upload progress, automatic duration probing, JPEG poster thumbnail generation, dominant color signature extraction, and H.264/AAC 6-second HLS VOD packaging (with silent-video and odd-dimension safety).
- **Signed HLS streaming**: Expiring HMAC-signed master playlists, `.ts` segments, and thumbnails served via `hls.js` (with native HLS and direct original fallback).
- **Interactive Memory Constellation**: Both an inline constellation banner and a dedicated full-screen Constellation Explorer that plots your clips by category and real extracted color signatures, with hover tooltips, tone/category filtering, and click-to-play.
- **Full library management**: Category tabs (`All videos`, `Moments`, `Travel`, `Field notes`), instant search (`/` shortcut), status filtering (`Ready`, `Processing`, `Failed`), multi-mode sorting (`Newest`, `Oldest`, `Title A–Z`, `Largest`, `Longest`), grid/list views, inline title & category editing, original file downloads, and failed-job retries.
- **Recoverable Trash**: Soft-delete with one-click Undo toast, dedicated Trash view with Restore and confirmed permanent deletion (cleaning up disk and cloud assets).
- **Private Share Pages**: Shareable viewing links at `/?share=<token>` with signed HLS playback and poster thumbnails, automatically revoked when a clip is moved to trash.
- **Live diagnostics & storage breakdown**: Built-in System Health modal (`/api/health`), per-category Storage Overview modal, and Help & Shortcuts guide.
