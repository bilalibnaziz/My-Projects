# Jiro live-sync server

A small self-hosted relay for real-time board editing (Yjs, y-websocket wire protocol).

```sh
npm run server            # ws://0.0.0.0:1234, rooms saved in server/data/
JIRO_SYNC_PORT=4000 npm run server
```

- Every room's document is saved to `server/data/<room>.ystate` (atomic write) and reloaded on restart.
- Rooms are open until someone connects with an **owner key** (Jiro does this when you start a live
  session). After that, joining needs the owner key or an **invite token** from `GET /invite`
  (signed with HMAC-SHA256; the secret lives in `server/data/.secret` or `JIRO_SYNC_SECRET`).
- Invite roles: `edit` or `view`. The server drops writes from viewers.
- Offline-first: Jiro keeps its own copy in IndexedDB, so boards open and edit with the server down;
  changes merge when it's back.

Run it on your own machine or LAN. For use over the internet, put it behind TLS (`wss://`), e.g. Caddy.
