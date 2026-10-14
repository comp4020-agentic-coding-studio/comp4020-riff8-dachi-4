# Plenty

A cosy multiplayer game about having enough, and never stopping.

You and up to seven friends arrive on a little meadow island: a pond with a heron, a few groves, an old oak, a hill for picnics. You gather timber and stone by hand, build cottages, power them, and teach a datacentre to do the gathering for you. It works beautifully. When the island is used up, the Plenty Cooperative has another world ready: Mars, then the Sun itself, then the whole Solar System, then the Universe. There is no sixth.

The game is built from a pod's brief, _Consume the Universe_: let players enjoy building the machine, then notice what the machine has consumed. A later brief, _Rivals under gods_, put all five worlds in play at once and split the players into four rival factions, with a god among them half the time.

## How to play

Start a world from the front page and send the invite link (or the five-letter room code) to friends. No account: your browser remembers who you are in each room.

- **Walk** with WASD or the arrow keys. Zoom with the wheel or `+`/`-`.
- **Harvest** by holding `E` (or `Space`) near a tree, rock or pond, or by clicking it. What you gather by hand goes into your own pack.
- **Make tools** from your pack with the buttons under it: a Cutter, a Pick and a Scoop, one for each kind of stock, each making your own harvesting of that stock quicker. A rough one takes 6 of each of the other two stocks and can be made anywhere; a fine one takes 12 of all three and has to be made beside finished homes. Tools are yours, and you keep them from world to world.
- **Deposit** your pack into the stockpile with `G` (the room's shared one in classic, your faction's on this world in cosmos). Machines only ever fill the stockpile and run on it, so a furnace with nothing to burn is waiting for someone to deposit.
- **Build** with `1`--`9`. Building spends your pack first and the stockpile for the rest. A ghost shows the footprint, green where it fits and red with the reason where it doesn't. Click to place it, or press `Enter` for the tile you're facing. `Esc` cancels.
- **Help raise** a building site by pressing `E` beside it: several people building together finish faster.
- `I` inspects a building (what it needs, what it makes, why it's idle), `X` takes one down for half its cost back, `N` names a favourite place, `V` surveys every deposit left, `P` saves a photo, and `Shift`+`1`--`6` emotes.
- `H` opens help in the game.

### Hosting: cosmos or classic

Whoever starts a world from the front page is its host, and chooses its mode for good:

- **Cosmos** (the default): all five worlds exist and run at once, and you belong to one of four rival factions. The map (`M`) shows every world; click one to look at it, which is free. To go there, launch from a Launch Pad.
- **Classic**: one world at a time, one shared stockpile, everyone on the same side. When every deposit is gone the room moves on together.

Tick **With gods** for either mode, and the host can switch god mode on or off at any time from the switch at the top left.

### Factions (cosmos)

When you join a cosmos room you pick one of four divisions of the Plenty Cooperative, or are dealt one. Each has its own stockpile on each world, its own way of working, one building only it can raise, and a goal shown as a plain number beside a par. Nobody wins: the game only counts.

| Faction | Doctrine | Good at | Can't | Its own measure |
| --- | --- | --- | --- | --- |
| ■ Foundry | Burn it. | Furnaces give double power. A Smelter turns 3 matter into 1 mineral. | build Launch Pads; its smoke reaches further | its share of everything taken |
| ● Automata | Let the machine do it. | Harvesters cost a quarter less. A Seeder builds copies of itself. | build any power of its own; hands are slow | compute its machines supply |
| ▲ Brokers | Everything moves through us. | Launch Pads and fuel at half price. Every Pad takes a tenth of other people's cargo. | build Harvesters | units carried through its Pads |
| ◆ Stewards | Keep some back. | Sun Gardens cheaper. A Reserve locks a deposit for a minute. | build Furnaces; hands are slowish | how alive the land stays on the worlds it reaches |

A faction with no human is played by a bot, marked "(bot)", until someone takes its seat. Give stock to another faction with "Give to another faction…" under your stockpile: that's how deals are made. A Launch Pad (click it) carries you and up to 20 units of cargo to another world for some fuel; your pack comes free.

### Gods

With gods on, there's a god half the time: 30 seconds with one, 30 without, and the top of the screen says who and how long. When it's your turn the bottom bar becomes Powers (`Tab` flips back), and you can use any of five powers as often as you like until the clock runs out:

- **Sow** (`1`): a full new deposit of a stock you choose, on an empty tile.
- **Bless** (`2`): for 5 seconds, everyone in it but you harvests twice as fast.
- **Hush** (`3`): for 10 seconds, nothing in it can be taken, by hand or machine.
- **Gift** (`4`): a finished datacentre, free.
- **Strike** (`5`): lands 3 seconds later; stock destroyed, buildings fall, the ground dies.

Each world has its own names for them (on Earth: Seed, Fair wind, Still air, Datacentre, Lightning) and a twist of its own. Hold `Enter` or click to use a power again and again; `Esc` puts it down. In cosmos, `[` and `]` aim at another world. Before you commit, a line says what will happen ("destroys 36 timber and 2 buildings, including Ben's Cottages"). Everything a god does is signed in the log and on the roster, and the halo shows what kind of god you've been.

In classic, start with the Cooperative memo in the corner: gather, build cottages, power them, build a datacentre, put a harvester beside a grove. The stockpile panel tells you what most of your idle machines are waiting for.

In classic, a world moves on when every deposit on it is gone, for everyone at once. In cosmos, a world that's spent stays on the map, grey, and the campaign ends when all five are. The survey arrow points at the nearest remaining deposit, so the last few never turn into a hunt.

## The five worlds

| World | What you consume | What's different |
| --- | --- | --- |
| Earth | timber, stone, fresh water | Furnaces are strong, but their smoke kills groves and browns the land. Sun Gardens are clean and slow. |
| Mars | regolith, iron, buried ice | Nothing runs outside a dome's air, and domes drink the same ice your datacentres need. |
| The Sun | plasma, magnetics, shade | Collectors pour in power and heat; past the limit, scoops throttle until radiators shed it. The star dims as you take it. |
| The Solar System | volatiles, asteroid metal, comet ice | No sunlight. Every machine draws on the Bottled Sun, filled only by plasma taken at the Sun. Miners only ship if relays link them to the Depot. |
| The Universe | starlight, stellar cores, dark cold | Your spent worlds run as World Engines. The host can render one down for a burst of energy, forever. And once the other four are spent, if everyone here agrees, you can stop, and leave the rest alone. |

Spent Earth and Mars float in the Solar System as grey remnants, and the Solar System sits in a corner of the Universe. Nothing you've finished comes back fresh.

## What the game is arguing

Every convenience has a dependency. A datacentre gives you compute, which runs harvesters, which empty the land faster, which needs more power, which on Earth means furnaces, whose smoke burns the groves you were going to harvest anyway. The game never stops you and never lectures you. It shows the cost in the land (grass browns, trees become stumps, the pond shrinks to mud, the birds thin out and the birdsong with them) and it keeps a short archive of every named place and what became of it. The ending reads that archive back to you.

The design document, [`docs/DESIGN.md`](docs/DESIGN.md), covers the economy, pacing, stages and ending in detail.

## How it works

One Node process on Fly.io owns every room's simulation and speaks WebSocket; browsers render the world and send intentions (move, harvest, build). The browser app is Next.js, exported to static files that the same process serves, with the world drawn on a Canvas 2D in its own frame loop. Rooms persist as snapshots in SQLite on the Fly volume.

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): the stack, the protocol, authority, persistence, deployment and recovery
- [`docs/DECISIONS.md`](docs/DECISIONS.md): the decision log, including the creative directions weighed at the start
- [`docs/adr/0001-empty-rooms-pause.md`](docs/adr/0001-empty-rooms-pause.md): what a player finds when they come back
- [`docs/adr/0002-worlds-run-unattended.md`](docs/adr/0002-worlds-run-unattended.md): why, in cosmos, a world nobody stands on keeps running
- [`docs/TESTING.md`](docs/TESTING.md): what was tested, how, and what was measured
- [`docs/ASSETS.md`](docs/ASSETS.md): where every picture and sound comes from, and how to replace them

## Running it

You need the versions in `mise.toml` (Node 24, pnpm 11).

```sh
pnpm install
pnpm build          # Next.js shell -> out/
pnpm start          # game server on :8080 (PORT and DATA_DIR override)
```

Then open <http://localhost:8080>. `pnpm check` typechecks and runs the spec against the running server (set `APP_URL` if it isn't on :8080). `node scripts/playbot.ts <ROOM> [url] [name] [faction]` joins a room with a bot that plays it (given a faction, a cosmos room's faction, with the same planner the server's own bots use), which is the quickest way to see later worlds or fill a room.

The rapid preset (a button on the front page) runs the same rules with the economy five times faster and a hand harvest worth ten. A solo campaign takes about ten minutes on it.

## Known limits

Desktop browsers with a keyboard first; it renders on a phone but isn't playable there. Faction balance is measured, not finished: in lineups with one faction missing, some factions reach their par almost always or almost never (see [`docs/TESTING.md`](docs/TESTING.md#the-tournament)). One server process and one Fly machine host every room, so a deploy or crash pauses all rooms for a few seconds and can roll back up to five seconds of play. There's no text chat by design (emotes only), so moderation is limited to the host taking down buildings. The full list, and what to build next, is in [`docs/TESTING.md`](docs/TESTING.md).
