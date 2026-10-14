# Plenty

A cosy multiplayer game about having enough, and never stopping.

You and up to seven friends arrive on a little meadow island: a pond with a heron, a few groves, an old oak, a hill for picnics. You gather timber and stone by hand, build cottages, power them, and teach a datacentre to do the gathering for you. It works beautifully. When the island is used up, the Plenty Cooperative has another world ready: Mars, then the Sun itself, then the whole Solar System, then the Universe. There is no sixth.

The game is built from a pod's brief, _Consume the Universe_: let players enjoy building the machine, then notice what the machine has consumed.

## How to play

Start a world from the front page and send the invite link (or the five-letter room code) to friends. No account: your browser remembers who you are in each room.

- **Walk** with WASD or the arrow keys. Zoom with the wheel or `+`/`-`.
- **Harvest** by holding `E` (or `Space`) near a tree, rock or pond, or by clicking it. What you gather by hand goes into your own pack.
- **Make tools** from your pack with the buttons under it: a Cutter, a Pick and a Scoop, one for each kind of stock, each making your own harvesting of that stock quicker. A rough one takes 6 of each of the other two stocks and can be made anywhere; a fine one takes 12 of all three and has to be made beside finished homes. Tools are yours, and you keep them from world to world.
- **Deposit** your pack into the room's shared stockpile with `G`. Machines only ever fill the stockpile and run on it, so a furnace with nothing to burn is waiting for someone to deposit.
- **Build** with `1`--`6`. Building spends your pack first and the stockpile for the rest. A ghost shows the footprint, green where it fits and red with the reason where it doesn't. Click to place it, or press `Enter` for the tile you're facing. `Esc` cancels.
- **Help raise** a building site by pressing `E` beside it: several people building together finish faster.
- `I` inspects a building (what it needs, what it makes, why it's idle), `X` takes one down for half its cost back, `N` names a favourite place, `V` surveys every deposit left, `P` saves a photo, and `Shift`+`1`--`6` emotes.
- `H` opens help in the game.

### Hosting, and gods

Whoever starts a world from the front page is its host. Tick **With gods** before hosting and, every 30 seconds, one person in the world is chosen to be a god (someone else each time, when there is anyone else). A halo and the word "god" mark them, and the Gods panel counts their turn down. A god picks a power from that panel and clicks where it lands:

- **Datacentre**: a finished one, for nothing, anywhere it would normally fit.
- **Bomb**: goes off 3 seconds after it's put down. Everything within about two tiles is flattened: the stock is destroyed (and counted as destroyed), buildings fall, the ground dies. The Depot and the World Engines survive. At most three can be ticking.
- **Plant**: a fresh, full deposit of any of the three stocks on an empty tile.
- **Aura**: for 5 seconds, everyone standing in it except the god harvests twice as fast.

The host can turn gods off, and back on, from the Gods panel at any time.

Start with the Cooperative memo in the corner: gather, build cottages, power them, build a datacentre, put a harvester beside a grove. The stockpile panel tells you what most of your idle machines are waiting for.

A world moves on when every deposit on it is gone, for everyone at once. The survey arrow points at the nearest remaining deposit, so the last few never turn into a hunt.

## The five worlds

| World | What you consume | What's different |
| --- | --- | --- |
| Earth | timber, stone, fresh water | Furnaces are strong, but their smoke kills groves and browns the land. Sun Gardens are clean and slow. |
| Mars | regolith, iron, buried ice | Nothing runs outside a dome's air, and domes drink the same ice your datacentres need. |
| The Sun | plasma, magnetics, shade | Collectors pour in power and heat; past the limit, scoops throttle until radiators shed it. The star dims as you take it. |
| The Solar System | volatiles, asteroid metal, comet ice | No sunlight now. Every machine draws on the Bottled Sun you saved, and it doesn't refill. Miners only ship if relays link them to the Depot. |
| The Universe | starlight, stellar cores, dark cold | Your spent worlds run as World Engines. The host can render one down for a burst of energy, forever. And if everyone here agrees, you can stop, and leave the rest alone. |

Spent Earth and Mars float in the Solar System as grey remnants, and the Solar System sits in a corner of the Universe. Nothing you've finished comes back fresh.

## What the game is arguing

Every convenience has a dependency. A datacentre gives you compute, which runs harvesters, which empty the land faster, which needs more power, which on Earth means furnaces, whose smoke burns the groves you were going to harvest anyway. The game never stops you and never lectures you. It shows the cost in the land (grass browns, trees become stumps, the pond shrinks to mud, the birds thin out and the birdsong with them) and it keeps a short archive of every named place and what became of it. The ending reads that archive back to you.

The design document, [`docs/DESIGN.md`](docs/DESIGN.md), covers the economy, pacing, stages and ending in detail.

## How it works

One Node process on Fly.io owns every room's simulation and speaks WebSocket; browsers render the world and send intentions (move, harvest, build). The browser app is Next.js, exported to static files that the same process serves, with the world drawn on a Canvas 2D in its own frame loop. Rooms persist as snapshots in SQLite on the Fly volume.

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): the stack, the protocol, authority, persistence, deployment and recovery
- [`docs/DECISIONS.md`](docs/DECISIONS.md): the decision log, including the creative directions weighed at the start
- [`docs/adr/0001-empty-rooms-pause.md`](docs/adr/0001-empty-rooms-pause.md): what a player finds when they come back
- [`docs/TESTING.md`](docs/TESTING.md): what was tested, how, and what was measured
- [`docs/ASSETS.md`](docs/ASSETS.md): where every picture and sound comes from, and how to replace them

## Running it

You need the versions in `mise.toml` (Node 24, pnpm 11).

```sh
pnpm install
pnpm build          # Next.js shell -> out/
pnpm start          # game server on :8080 (PORT and DATA_DIR override)
```

Then open <http://localhost:8080>. `pnpm check` typechecks and runs the spec against the running server (set `APP_URL` if it isn't on :8080). `node scripts/playbot.ts <ROOM> [url] [name]` joins a room with a bot that plays it, which is the quickest way to see later stages or fill a room.

The rapid preset (a button on the front page) runs the same rules with the economy five times faster and a hand harvest worth ten. A solo campaign takes about ten minutes on it.

## Known limits

Desktop browsers with a keyboard first; it renders on a phone but isn't playable there. One server process and one Fly machine host every room, so a deploy or crash pauses all rooms for a few seconds and can roll back up to five seconds of play. There's no text chat by design (emotes only), so moderation is limited to the host taking down buildings. The full list, and what to build next, is in [`docs/TESTING.md`](docs/TESTING.md).
