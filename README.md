# EDH Play scheduling bot

A Discord bot that opens and schedules Magic: The Gathering Commander (EDH) pods,
shows live seat fill, and launches the game on [EDH Play](https://edhplay.com)
with one click.

This is an MVP scaffold. It compiles and runs, but a few pieces are deliberately
simple (in-memory pod store, JSON token store, paste-based account linking) and
are flagged below for you to harden.

## What it does

| Command | Purpose |
| --- | --- |
| `/link` | Link your EDH Play account so the bot can create rooms as you |
| `/lfg` | Open a pod **now** and look for players |
| `/schedule minutes_from_now:<n>` | Schedule a pod; it auto-launches at start time |
| `/pods` | List open pods in the server + public EDH Play rooms |

Each pod posts a signup message with:

- a live `seats X/4` count and the seated players,
- buttons: **Take a seat**, **Leave**, **Launch now** + **Cancel pod** (host
  only); the seat button flips to **Join waitlist** when full,
- an **auto-waitlist** that promotes and pings the next person when a seat opens,
- timezone-free times via Discord dynamic timestamps (`<t:unix:F>`),
- an **auto-created voice channel** per pod (when `voice` is on), torn down once
  the game ends or the channel sits empty,
- a **15-minute reminder** and **auto-launch** for scheduled pods.

When a pod launches, the bot calls `POST /api/v1/rooms` on EDH Play as the host
and edits the message with a join link.

## Setup

```bash
npm install
cp .env.example .env        # fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID
npm run deploy              # register slash commands (instant if GUILD_ID is set)
npm run dev                 # run the bot
```

Bot needs the `Manage Channels` permission (for voice channels) and the
`applications.commands` + `bot` scopes when invited.

## The account-linking caveat (important)

EDH Play has **no API keys**. Authentication is a Google-OAuth-issued JWT
(`access_token` + `refresh_token`) stored in the browser. To create a room "as"
a user, the bot needs that user's token.

This scaffold uses the simplest honest approach: `/link` opens a modal where the
user pastes their `access_token` and `refresh_token` (from `edhplay.com` →
DevTools → Application → Local Storage). The bot stores them and refreshes via
`POST /api/v1/auth/refresh`.

**This is fine for a personal/portfolio MVP but not for public distribution.**
The production-grade path is a small companion web page that runs EDH Play's
Google OAuth flow and hands the bot the resulting tokens — which realistically
needs cooperation from the EDH Play developer (the API is unofficial and
undocumented). Treat all stored tokens as secrets: encrypt at rest and never log
them.

## Architecture

```
src/
  config.ts              env loading
  edhplay/
    types.ts             room/token shapes observed from api.edhplay.com
    client.ts            REST client + token refresh (createRoom, listRooms, ...)
  store/
    db.ts                SQLite connection + schema (pods, tokens)
    tokenStore.ts        Discord user -> EDH Play tokens (SQLite)
    podStore.ts          active pods as a SQLite-backed write-through cache
  pods/
    pod.ts               seat + waitlist logic, snapshot (de)serialisation
    embed.ts             signup embed + buttons (custom_id = pod:<action>:<id>)
    manager.ts           post / refresh / launch / cancel / sweep a pod
  voice/voiceChannels.ts temp voice channel create + empty-check + cleanup
  commands/index.ts      /link /lfg /schedule /pods
  interactions/router.ts buttons + modal routing
  index.ts               client bootstrap + scheduler/cleanup loop
  deploy-commands.ts     slash-command registration
```

## Known simplifications / production TODOs

- **Persistence**: pods and tokens persist to SQLite (`better-sqlite3`) and are
  rehydrated on startup, so they survive a restart. Tokens are stored in
  plaintext — encrypt them at rest before any real deployment.
- **Scheduler**: a 30s `setInterval` drives reminders, auto-launch, and cleanup
  of finished pods. Scheduled pods now survive restarts; at scale you'd still
  want a durable job queue (BullMQ, Agenda) rather than an in-process interval.
- **`/schedule`** takes `minutes_from_now` to avoid timezone-parsing bugs. Add a
  natural-language/date parser (e.g. `chrono-node`) for "Friday 8pm" input.
- **Auth refresh contract** — verified live: `POST /api/v1/auth/refresh` with
  `{ refresh_token }` returns `{ access_token, refresh_token, token_type }`.
- **Room URL** — verified live: join at `/games/<id>/play`, spectate at
  `/games/<id>/spectate`.
- **Create payload** — verified live: the exact body the bot sends (with
  `bracket` and `communication_preference: "voice"`) returns `200 success:true`
  and persists both fields.

## Roadmap (post-MVP, evidence-ranked)

1. Bracket-keyed matchmaking (WotC Commander brackets 1–5) — the strongest wedge.
2. Structured Rule 0 fields (proxies, win-cons, banned categories) on each pod.
3. Spectator support done right (the most-requested SpellTable gap).
4. Post-game result logging / standings.
5. Recurring / standing weekly pods.
6. Reputation / no-show tracking (validate demand first).
```
