# TikTok Collector -> Node.js Backend -> Neon/Redis -> SSE -> Next.js

## New backend endpoints

### Collector -> Node internal ingest

`POST /api/internal/live-comments/ingest`

Header:

```txt
x-internal-api-key: <NODE_INTERNAL_API_KEY>
```

This route receives each comment from the collector, resolves the shop, creates/gets the live session, saves the comment into Neon Postgres, then broadcasts the `COMMENT` SSE event to connected clients of the same shop.

### Collector -> Node internal live status

```txt
POST /api/internal/live-events/connected
POST /api/internal/live-events/disconnected
POST /api/internal/live-events/error
```

### Client -> Node SSE

`GET /api/live-stream/events`

Auth can be via cookie, Authorization Bearer token, or query fallback:

```txt
/api/live-stream/events?accessToken=<token>
```

### Client -> Node -> Collector control

```txt
POST /api/live-stream/start { "username": "@shop" }
POST /api/live-stream/stop  { "username": "@shop" }
```

## Required env

```env
NODE_INTERNAL_API_KEY=change_me
COLLECTOR_BASE_URL=http://localhost:8765
COLLECTOR_CONTROL_API_KEY=change_me
```

The collector `.env` must use the same values:

```env
NODE_COMMENT_INGEST_URL=http://localhost:3001/api/internal/live-comments/ingest
NODE_INTERNAL_API_KEY=change_me
COLLECTOR_CONTROL_API_KEY=change_me
```

## Shop mapping

The internal ingest route maps collector comments to a shop by either:

1. `shopId` sent in collector payload, or
2. `shops.default_tiktok_username` matching `liveUsername`.

Set this via SQL (Neon SQL Editor or drizzle-kit):

```sql
update public.shops
set default_tiktok_username = '@your_live_username'
where id = 'YOUR_SHOP_ID';
```
