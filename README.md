# Afterframe

A polished local implementation of an S3-like video library. Its signature feature is the **memory constellation**: a visual map that gives saved clips color signatures and turns a flat file list into a browsable story.

## Run locally

```sh
npm install
```

Start the two local services in separate terminals:

```sh
npm run server
npm run dev -- --host 127.0.0.1
```

Then open `http://127.0.0.1:5173`.

## Deploy

The included `Dockerfile` builds the web app and runs the API plus FFmpeg worker in one container. For Railway, Render, or Fly.io, deploy from this repository, attach a persistent disk at `/data`, and set `AFTERFRAME_SIGNING_SECRET` to a long random value. The service listens on the provider's `PORT` automatically.

## Supabase persistent storage

Run `supabase/schema.sql` in the project SQL editor to create the `videos` table, private `afterframe-videos` bucket, and owner-level access rules. The cloud project URL and service credentials belong in the deployment environment, never in source control.

## Included

- Responsive video library with category tabs, search, grid/list views, storage summary, and clip details.
- Drag-and-drop or file picker upload backed by the local storage API.
- A real FFmpeg processing worker that reads duration, transcodes H.264/AAC, and packages HLS playlists and six-second segments.
- Expiring HMAC-signed HLS playback URLs and private share-token API endpoints.
- Persisted library loading with automatic processing-status refresh. Every shelf entry comes from the storage API.
- Browser-compatible HLS playback through `hls.js`, with native HLS playback used when available.
- Account creation, sign-in, and sign-out with salted `scrypt` password hashes, seven-day HTTP-only sessions, and per-account library authorization.
- Recoverable deletion: a removed video is hidden from the owner’s shelf and can be restored through `POST /api/videos/:id/restore` before any permanent cleanup.
- Browser share pages at `/?share=<token>` for private links created from the video player.
- Custom constellation illustration, designed as the product's distinctive library view.

The included API persists uploaded video files in `data/uploads/`, HLS packages in `data/hls/`, video metadata in `data/clips.json`, and local account records in `data/users.json`. It intentionally uses a lightweight local filesystem store so it can run on this laptop without cloud credentials or external services. FFmpeg is required for processing and is installed on this laptop.

For a production S3-like deployment, replace the local storage layer with S3-compatible object storage, add authentication, move metadata to MongoDB, use Redis for caching, Kafka for job events, worker-based transcoding and HLS packaging, and serve segments through a CDN.
