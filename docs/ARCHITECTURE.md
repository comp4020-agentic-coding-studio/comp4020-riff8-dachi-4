# Architecture

## Shape

```
browser                                      one Fly machine (shared-cpu-1x, 256 MB)
┌───────────────────────────┐                ┌───────────────────────────────────────┐
│ Next.js shell (static)    │   GET /, /play │ server/main.ts (node, type-stripped)  │
│  app/, client/Game.tsx    │◄──────────────►│  serves out/ (Next export), /readme/  │
│  React HUD (≤5 Hz)        │                │  POST /api/rooms, GET /api/health     │
│  Canvas 2D renderer (rAF) │   WebSocket    │  /ws ──► server/rooms.ts               │
│  client/net.ts            │◄──────────────►│          one live owner per room      │
└───────────────────────────┘    /ws         │          shared/sim.ts (pure)         │
                                             │  server/store.ts ──► SQLite on /data  │
                                             └───────────────────────────────────────┘
```

| Directory | Holds |
| --- | --- |
| `shared/` | content and balance data, the protocol types, world generation, the simulation, and the faction bots' planner (`bots.ts`); pure TypeScript, no I/O, imported by both sides |
| `server/` | the HTTP and WebSocket server, live room management, SQLite storage |
| `app/` | Next.js routes: the front page and the play shell (the client-only boundary) |
| `client/` | the browser game: network client, renderer, audio, HUD |
| `spec/` | the tests (see [`TESTING.md`](TESTING.md)) |
| `scripts/` | the playtest bot and the course's evidence check |

## Choices, and why

- **Next.js as a static export.** The prompt wants Next.js for the shell and a separate long-running service for the simulation. Exporting the shell to static files and serving them from the game server keeps that separation (Next never runs a request handler, let alone the loop) while fitting the course's one-machine, one-port Fly setup. The game is loaded with `next/dynamic` and `ssr: false` from inside a Client Component (`app/play/PlayShell.tsx`), as the [lazy-loading guide](https://nextjs.org/docs/app/guides/lazy-loading) requires, since it touches canvas, WebSocket, AudioContext and localStorage.
- **Canvas 2D, no engine.** A two-day prototype budget favoured the one renderer with nothing to install, learn or ship. Every asset is a few draw calls in `client/render.ts`, so the visual bible is enforced by one file. Measured frame time in the densest scene tested was about 1.2 ms (see [`TESTING.md`](TESTING.md)), so the renderer has headroom. If the art direction outgrows hand-drawn shapes, PixiJS is the natural swap: `Renderer` is the only module that draws.
- **`ws` over a room framework.** Rooms, sequencing and deduplication are about 300 lines in `server/rooms.ts`; Colyseus would have hidden exactly the parts the prompt asks to get right.
- **`node:sqlite`, one row per room.** No native module to build, one file on the volume, a single UPSERT per save.

## Rooms and worlds

A `RoomState` holds a list of `World`s. Every per-world rule in `shared/sim.ts` (placement, harvesting, the economy, gods' acts, exhaustion) takes a world, not the room. A classic room has one world and replaces it at each stage boundary, so classic plays exactly as it did before cosmos. A cosmos room has five from the first tick, ticks every one each economy tick, and adds what spans worlds at room level: one Bottled Sun, ships in flight and the `transit` totals, factions, and the god. `ledgerHolds` checks every world, and `transitHolds` checks that stock launched minus stock landed is exactly what the ships hold.

Bots are ordinary `Player`s with `bot: true` and no socket. `server/rooms.ts` calls `runBots` after each tick while at least one human is connected; the planner in `shared/bots.ts` returns commands that go through `applyCommand` like anyone's. The tournament (`spec/balance.test.ts`) and `scripts/playbot.ts` use the same planner.

## Authority

The server owns every room's state; the browser renders it and sends intentions. All mutation goes through `applyCommand` and `tick` in `shared/sim.ts`, called one at a time on Node's single thread, so every mutation is serialised. Two players placing on the same tile, two builds spending the same balance, two hands on the last unit: whichever command the server reads first wins; the other gets a reason. Payment and occupancy are committed in the same synchronous block with nothing between them that can fail.

Every command is validated server-side: session (the socket's player), membership, stage generation, phase, the world it was meant for (a ground command for a world the player is only viewing, or while in flight, is refused; only a god's powers may name another world), integer and in-bounds coordinates, finite movement vectors, range (2.2 tiles to harvest, 8 to build), cooldowns, footprint and terrain, affordability, ownership, and string length.

**Movement** is a continuous intent (a direction vector); the server integrates it at 10 Hz. There are no collisions, so the browser predicts its own avatar exactly and eases toward the server's answer, snapping only if more than 1.5 tiles off. Other avatars are interpolated two ticks behind the latest update.

**Ticks.** The server steps every room at 10 Hz (checked every 50 ms). After a stall it catches up at most three ticks and drops the rest, so a paused process can't run the economy forward in a burst. The economy runs every 10 ticks (every 2 on the rapid preset).

## Protocol

Defined in [`shared/protocol.ts`](../shared/protocol.ts), JSON text frames, `PROTOCOL_VERSION = 4`. A client and server on different versions refuse each other ("this page is out of date: reload it").

Client to server:

- `hello {v, room, token?, name}`: join; a known token resumes that player, anything else makes a new one
- `cmd {id, inc, gen, c, w?}`: an intention (`move`, `harvest`, `build`, `demolish`, `emote`, `mark`, `craft`, `deposit`, `god`, `gods`, `aim`, `stop`, `faction`, `transfer`, `launch`, `reserve`) with a client-chosen id, the room incarnation, the stage generation and the world it was meant for
- `view {world}`: look at another world; answered with a fresh snapshot of it, and the connection's deltas come from that world from then on. Looking is never presence.
- `sync`: ask for a fresh snapshot
- `ping {n}`

Server to client:

- `welcome {v, inc, you, token, snap}`: a full snapshot (state minus tokens and receipts) with the viewed world's fields laid out at the top (`viewing` says which), and a summary of every world for the map
- `delta {seq, gen, tick, vw, players, moves?, tiles?, buildings?, removed?, blasts?, world?, meta?, summaries?, log?}`: changes since the previous delta, sent only when something changed, at most once per tick. Tiles, buildings, blasts and `world` belong to world `vw`, the one that connection views; one delta is built per viewed world and shared by everyone viewing it. `summaries` (life, stock left, stake per faction, players present, active god effects) for every world goes out at most once a second, and only when it changed. A folded log line ("called Lightning 14 times") arrives as a new line that names the one it replaces.
- `ack {id, ok, reason?}`: for every command except `move`
- `error {reason}`, `pong {n}`

**Ordering and gaps.** Every delta increments the room's `seq`. A client that sees anything but `seq + 1` asks for a fresh snapshot rather than guessing. On join, any pending changes are flushed to everyone first and the snapshot is taken immediately after, in the same synchronous turn, so the snapshot is exactly the boundary the next delta continues from.

**Duplicates.** The last 64 applied command ids per player are remembered (and saved with the room). A retried id that was applied is acknowledged again without being applied again; a refused command isn't receipted, so retrying it is a real retry. Movement isn't receipted: it's idempotent.

**Stage generation.** `gen` increments with each world. A command carrying an old `gen` is refused ("that was meant for a world that's gone"), and the client clears its pending actions and previews when a new world's snapshot arrives.

**Incarnation.** Each time a room is loaded into memory it gets a fresh random `inc`. A command carrying any other `inc` is refused with a fresh snapshot, so after a server restart a browser's in-flight actions are never replayed; the client tells the player their last action may not have gone through. This is the fresh-session policy: there's no claim of exactly-once delivery.

**Bounds.** 2 KB per message (`ws` `maxPayload`), a 40-per-second token bucket per connection, 32 sockets per client address (generous, because a class on campus Wi-Fi shares one), 32 unacknowledged commands per client, and a slow client whose send buffer passes 1 MB is disconnected rather than allowed to bloat the server or stall the room.

**Containment.** A message that throws is answered with an error and goes no further; a room whose tick throws is closed and unloaded (it reloads from its last save) without stopping the others. An independent review found a message that crashed the whole process by coercing a booby-trapped `id`; the spec now sends it.

## Persistence

- **Store**: `DATA_DIR/plenty.db` (SQLite, WAL), table `rooms(code, schema, state, saved_at)`, the whole `RoomState` as JSON. World, sequence and receipts are in one row, so they can't disagree about what was applied.
- **Schema**: `SCHEMA_VERSION` (4) in each row; migrations run in order against `PRAGMA user_version` at boot (`server/store.ts`). A saved room from an older schema is upgraded as it loads: 1 → 2 gives players an empty pack and no tools, and 3 → 4 turns the single-world room into a classic room with one world and gods off (rooms saved by `main` and by the `packs-tools-gods` branch are schema 3). Any other version refuses to load rather than load wrongly.
- **Save frequency**: every 5 s while a room has changed, immediately when a room empties, immediately at every stage boundary (before anyone is told about it), and for every room on SIGTERM or SIGINT.
- **Maximum rollback**: 5 s of play after an abrupt crash. A rolled-back command's receipt rolls back with it, so a retry after recovery is treated as new, not wrongly acknowledged as done. The spec kills the server with SIGKILL to check this.
- **Transitions survive crashes**: the transition state is saved before it's announced, and the next world is a pure function of the saved seed and stage, so a restart during a transition finishes it exactly once with the same map and no doubled carryover.
- **Backup**: the volume is a single point of failure. `fly volumes snapshots list -a <app>` shows Fly's daily volume snapshots (retained five days by default); restoring one is `fly volumes create data --snapshot-id <id>` and pointing the machine at it. Copying the file off with `fly ssh sftp get /data/plenty.db` is the manual backup.

## Rooms, sessions and empty rooms

Room codes are five characters from a 31-letter alphabet without lookalikes. A code identifies a room; it doesn't authorise anything. An address can create 60 rooms an hour, and rooms nobody ever joined are deleted after a day. Authority is the per-player token the server mints on first join (18 random bytes), which the browser keeps in localStorage per room and presents on reconnect. A second tab with the same token takes over from the first. A room seats eight connected players; it remembers up to 32 identities, and past that forgets the one gone longest (its buildings stay, credited to "someone"), so browsers that came once and left can never fill a room.

A room with nobody connected pauses: no ticks, saved, and unloaded after a minute. Its next visitor loads it under a new incarnation. Why, and what that costs, is [ADR 0001](adr/0001-empty-rooms-pause.md). In a cosmos room every world runs while any human is connected, and bots alone never keep it running ([ADR 0002](adr/0002-worlds-run-unattended.md)).

## Deployment on Fly.io

`fly.toml` is the course's fixed shape: one `shared-cpu-1x` machine with 256 MB, one volume at `/data`, HTTP on `0.0.0.0:$PORT` behind Fly's TLS proxy, `force_https`, and `auto_stop_machines = "stop"` with `min_machines_running = 0`. The `Dockerfile` builds the shell in one stage and runs `node server/main.ts` on Node 24 Alpine in the next (production dependencies only: `ws` and `marked`).

- **One owner per room.** One machine runs every room, and the deploy command passes `--ha=false`. A Fly volume attaches to one machine at a time, so an old process and its replacement can never both hold the database during a deploy: Fly stops the old machine (it receives SIGINT, saves every room, closes sockets with 1012) before starting the new one on the same volume. Adding replicas would need a room-to-owner map and `fly-replay` routing of the WebSocket handshake; that's deliberately not built.
- **Autostop.** Fly's proxy counts open connections, and every player holds a WebSocket, so the machine stays up while anyone is playing and stops when the last player leaves. That matches the pause-when-empty policy: a stopped machine has nothing it should have been simulating.
- **Capacity.** Measured locally at 20 connections across 6 live rooms: about 1 ms of simulation per step, 104 MB resident. A cosmos room of five built-up worlds, four bots and eight humans' worth of commands a tick costs a median 0.1 ms a tick ([`TESTING.md`](TESTING.md#performance)). The 256 MB machine is not the constraint at the scale this course tests; the honest limit is availability (one machine, seconds of downtime per deploy).
- **Health**: `GET /api/health` reports rooms, tick time, memory and traffic.
- **Security**: every write (`POST /api/rooms`) and every WebSocket upgrade must carry an `Origin` matching the request's own host; framing is refused (`X-Frame-Options: DENY`, `frame-ancestors 'none'`); no secrets are needed at runtime.

## Operating it

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | 8080 | where to listen (`fly.toml` sets it) |
| `DATA_DIR` | `./data` | where `plenty.db` lives (`/data` in the image) |

- **Deploy**: CI runs `flyctl deploy --remote-only --ha=false -a <app>` on every push to `main` once the spec passes against the built image.
- **Logs and status**: `flyctl logs -a <app>`, `flyctl status -a <app>`, `curl https://<app>.fly.dev/api/health`.
- **Recovering a room**: nothing to do; any visitor loads it from the last save. To inspect one, `fly ssh console -a <app> -C "node -e \"const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/data/plenty.db');console.log(d.prepare('select code,saved_at from rooms').all())\""`.
- **A room that won't load** (schema mismatch after a bad deploy): roll back the deploy; rows are never rewritten by a server that can't read them.
