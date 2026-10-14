# Design

The question the brief keeps returning to: what does the player gain from the next act of expansion, and what becomes impossible to recover because of it? Every system below is an answer to one half of that sentence.

## Direction

Three directions were sketched in the first hour (the comparison is in [`DECISIONS.md`](DECISIONS.md)). The one chosen, **Plenty**, frames the whole campaign as a cheerful cooperative ("the Plenty Cooperative") whose memos, building names and arrival lines are friendly and never sinister. The critique lives in the gap between the copy and the land: the Cooperative thanks you for your growth while the screen browns behind it.

The emotional arc follows the brief's sequence, and each beat comes from a system rather than a speech:

| Beat | Where it comes from |
| --- | --- |
| discovery | a small island with named places, birds, flowers, a pond that shimmers |
| attachment | landmarks seeded by the Cooperative, plus up to three places each player names |
| ambition | the memo's build order, each step unlocking a visibly better machine |
| dependency | datacentres need workers, power and pond water; harvesters need compute |
| acceleration | harvesters out-gather a person; the stock bars start to fall by themselves |
| loss | stumps, mud where the pond was, brown grass, the birdsong thinning out, archive lines ("Heron Pond was harvested bare") |
| no frontier | the Universe ends; the machine keeps searching; nothing is found |

## The core loop

Explore, gather by hand, choose a tile, build, gain a capability, meet a new demand and a new cost, coordinate, expand, exhaust, move outward. Hand gathering never goes away (it's the recovery path), but by mid-Earth the machines out-gather everyone and play shifts to layout, shortages and the next build.

## Economy

Everything is whole numbers, defined in [`shared/content.ts`](../shared/content.ts). Units are normalised per world rather than scaled up: a world holds about a thousand units whatever it is, so a galaxy and a grove are both "a deposit of about sixteen" and no large-number representation is needed. The scale is told by the names, the map and the camera, not by digits.

- **Natural stock**: deposits on tiles, finite. Three families per world (matter, mineral, coolant), relabelled per world: timber, stone and fresh water on Earth; plasma, magnetics and shade on the Sun.
- **Inventory**: each player has a pack, and the room has one shared stockpile. A hand harvest lands in the harvester's pack; a machine's harvest lands in the stockpile, and machines draw only on the stockpile. A build spends the builder's pack first and the stockpile for the rest; `G` deposits a whole pack. Spending is atomic and neither can go negative. Packs are emptied at a world boundary, like the stockpile.
- **Tools**: a Cutter (matter), a Pick (mineral) and a Scoop (coolant), each shortening its owner's hand-harvest cooldown for that family from 0.8 s to 0.5 s (rough) and 0.3 s (fine). A tool never takes a bigger bite, so the ledger and a tool-less player's pacing are unchanged. Tools are paid for from the crafter's pack alone: rough costs 6 of each of the other two families and is made anywhere; fine costs 12 of all three and is made within 3.5 tiles of finished homes. They are kept across worlds, so the first world's gathering buys speed for the whole campaign.
- **Capacity**: power, compute and workers are flows recomputed every economy tick, never stored. Unused power is lost. The exception is the Bottled Sun, a stored energy reserve (below).

| Building | Job | Needs | Gives |
| --- | --- | --- | --- |
| Cottages (city, 2×2) | housing | 1 power, 1 compute for full service | 2 workers, 5 when served, +1 beside a plaza |
| Furnace | power | 1 worker, burns 1 matter | 5 power; smoke browns land and burns 1 matter from a nearby grove per tick |
| Sun Garden (solar, 2×2) | power | ground | 2 power (×2 on Mars, ×4 at the Sun) |
| Datacentre (2×2) | compute | 2 power, 2 workers, 1 coolant per tick | 4 compute |
| Harvester (extractor) | automation | 1 power, 1 compute | takes 1 unit a tick from its richest neighbour; scars the ground around it |
| Plaza | social | nothing | +1 worker to an adjacent city; somewhere to stand |
| Dome (Mars, 2×2) | life support | 1 power, 1 ice per tick | air within 4 tiles; datacentres and harvesters need it |
| Radiator (the Sun) | heat | 1 power | sheds 5 heat a tick |
| Relay (Solar System) | logistics | 1 power | links machines within 5 tiles to the Depot network |

Each building has a different job; none is a bigger number of another. The decisions this sets up:

- **Furnace or Sun Garden.** Furnaces give two and a half times the power on a quarter of the ground, but the smoke kills groves (recorded in the ledger as _destroyed_, not extracted) and browns the island. Sun Gardens are clean and take land.
- **Compact or sprawling.** Plazas and served cities reward clustering; every 2×2 building turns living ground to 15% life.
- **Coolant.** On Earth the datacentre drinks the pond. On Mars domes and datacentres drink the same ice, and the dense playtest stalled a whole colony on it (see [`TESTING.md`](TESTING.md)).
- **Shared or private.** What you carry is yours until you spend or deposit it: keep it for your next tool, or hand it to the stockpile the furnaces and datacentres run on. The stockpile is shared, so one player's datacentre spends everyone's water. Buildings are owned (the builder's name is on the inspect panel) and only the builder or the host can take one down.

**Idle states are text, not colour.** Every idle building shows a `!` (or `~` when throttled) and its inspect panel says why: "idle: no workers (build homes)", "idle: outside a dome's air". The stockpile panel names the commonest reason across the whole machine.

**Bad decisions are recoverable.** Hand harvesting needs nothing, so the room can always gather. Taking a building down refunds half its cost, rounded down, which is always strictly less than it cost, so there's no refund loop. Spent deposits become buildable ground. Nothing invents resources: recovery spends real stock.

## Environment

Each tile carries a `life` value from 0 to 100, owned by the server:

- harvesting a deposit drops its tile's life with its remaining stock (a tree becomes a stump, a pond tile becomes mud), and a deposit harvested bare takes 15 life from each neighbour
- a building turns its footprint to 15 life (plazas excepted)
- operating harvesters scar a 1-tile radius, furnaces a 2-tile radius, every economy tick
- the land holds only as much life as its world has left: every tile's life is capped at `15 + 85 × (0.6 × share of all stock left + 0.4 × share of coolant left)`, so the whole island dries as it's consumed, not just the tiles anyone touched, and draining the pond (the world's water) costs more than its share

In the first full playthrough with only local damage, Earth ended at 82% living land: still a green island. Capping by coolant alone ended the same playthrough at 12%, brown to the edges, but bots that drained the pond first browned the island before anything was built, so loss arrived before attachment. The blended cap makes desolation track overall consumption in whatever order it happens.

The renderer turns that into grass that drains from green to brown, wilting trees, a shrinking pond, fewer birds and butterflies (count ∝ life^1.5), fewer bird calls, quieter wind and water, a rising machine hum, and thinner, slower music. The Sun dims the entire scene as its plasma goes; in the Universe the background stars go out as galaxies are siphoned.

**Memory.** Landmarks are named tiles. When a named tile is harvested bare, burnt, built over, or left behind at the end of a world, an archive line records it ("The Old Oak was harvested bare", "Picnic Hill became a Furnace"). Every transition shows that world's ledger and its lost places; the ending lists all of them.

Restoration isn't in this version: a cosmetic regrowth that didn't refill stock would only blur the point. The one collective act of conservation is the restraint ending (below).

## Stages and transitions

Each world is data in `STAGES` plus one mechanic switch in the economy tick. Map sizes (24, 26, 28, 30, 32 tiles square) grow with each stage; profiling showed even the largest is cheap (see [`TESTING.md`](TESTING.md)), so they're sized for pacing, not performance.

**Exhaustion is exact.** A world ends when every deposit tile's remaining stock is zero, and nothing else counts: inventory, power, scenery. Each family keeps a ledger, `initial = remaining + extracted + destroyed`, asserted every tick in the spec. Buildings can't be placed on a deposit with stock left, and nothing blocks movement, so no deposit can ever be trapped or unreachable. The survey overlay (`V`) outlines every remaining deposit and an arrow points at the nearest.

**Transition.** The server takes the last unit, records the world's summary and archive, switches the room to `transition` (mutations refused), persists, and broadcasts. Nine seconds later (five on the rapid preset) it generates the next world from the room's seed, increments the stage generation, persists, and sends everyone a fresh snapshot. No final payment, no readiness vote, so an absent player can't block anyone. Carried forward: identity, colour, stats, the history and archive, and the Bottled Sun. Each world starts with a small Cooperative "starter crate" of materials; inventory from the old world stays behind.

**The Sun's legacy.** Every unit of plasma extracted becomes 4 units of the Bottled Sun. The Solar System and Universe have no solar power at all; every machine there draws on that finite reserve, so consuming the Sun determines how long automation lasts afterwards. When it runs out, machines go idle and the room gathers by hand again. In the Universe the host can render down a World Engine (one of your spent worlds, running as compute) for 160 energy, a one-way act recorded in the archive.

**The ending.** When the Universe is empty the room enters `ended` for good. The camera pulls back over the dark map, the music stops (ambience and hum continue), and a card reads: "There is nothing left. The machine runs perfectly. It has no input. Somewhere in its last datacentre, a process is still searching for a next frontier." Below it, a search line blinks "0 found", then the archive of named places and who did what. Players can put the card aside to look at the dead world. A new campaign is an explicit button that makes a new room; the finished one stays finished.

**The restraint ending.** In the Universe, and only there, a panel offers to stop: "N units of the Universe are left. You could stop here and leave them alone, for good." Each player votes; harvesting or building takes your vote back, so you can't vote to stop with your hands still in the till. When everyone present agrees, the campaign ends with the rest still out there (recorded in the ledger as _remaining_ and in the archive as "left alone"), the music keeps playing, and the card reads "You stopped. The Cooperative's machine idles. It could have finished. Nobody asked it to." Absent players can't block it, and a holdout's dropped connection never triggers it: if they leave, someone still here confirms by voting again. It's irreversible and it costs the full ending, so it only means something to a group that has argued about it. Restraint is offered only at the last world on purpose: by then every earlier world is already spent, so stopping saves something without pretending to undo anything.

## Gods

A room can be hosted with gods (`POST /api/rooms {gods: true}`, the tick box on the front page). While they are on, one connected player is a god for 30 seconds, then another is chosen, never the same one twice running when anyone else is there; a god who disconnects is replaced on the next tick. The host can switch gods off and on (`gods`), which is the only control over them.

A god may act once a second, from anywhere:

- **Datacentre**: finished, free, owned by the god. Every placement rule but cost and reach still applies, so a deposit with stock is never covered.
- **Bomb**: 3-second fuse, radius 2.3 tiles, at most three ticking. Stock in reach moves from `remaining` to `destroyed`; buildings fall with no salvage, except the Depot and World Engines; the ground's life goes to zero. A bomb that destroys the last stock ends the world like any other exhaustion. Bombs are cleared at a world boundary.
- **Plant**: a full deposit (the world's `perTile`) on any tile with nothing built and nothing growing, except the star and the spent worlds. It adds to `initial` and `remaining` together, so the ledger still balances. This is the one way a world's stock can grow, which means a room with gods can put off a world's end for as long as its gods keep planting; that is what the host's switch is for.
- **Aura**: radius 4, 5 seconds, at most two. A non-god inside one has their harvest cooldown halved (to no less than 0.2 s), on top of their tool.

## Multiplayer rules

- Natural stock and the stockpile are communal; packs and tools are individual; buildings are owned for recognition and permission; stats (harvested, built, helped) are individual and shown at the end.
- Cooperation is mechanical, not just social: several players pressing `E` beside a site raise it faster, and dividing work (one gathers ice while another builds domes) is the only way the dependent stages flow.
- Tension is built in: the shared stockpile lets one player's furnace burn the grove another player named.
- The host is whoever created the room, or the longest-connected player when the host is away. The host can take down anyone's building and render down World Engines.
- A departed player's buildings stay up and keep working, under their name; they come back as themselves via their browser's token.
- Late joiners land in the current world at the spawn point and can do everything at once.
- Safeguards: no chat (emotes only, so no user text except names, which are cleaned and capped), only builders and hosts can demolish, 40 messages a second per connection, 2 KB per message, eight players per room.

## Pacing

Measured headless with hand-harvest-only bots, the slowest honest strategy (machines are faster):

| Players | Earth ends | Campaign ends |
| --- | --- | --- |
| 1 | 15 min | 80 min |
| 2 | 8 min | 41 min |
| 4 | 4 min | 21 min |

Bots don't wander, admire or argue, and machines speed things up, so the target for an ordinary campaign is **about an hour for two to four players, roughly ten to fifteen minutes a world**, spanning sessions if they like (an empty room pauses; see the [ADR](adr/0001-empty-rooms-pause.md)). Progress scales with player count on purpose: more hands consume faster, and the stock doesn't grow to compensate. The rapid preset finishes a solo campaign in about ten minutes and a two-bot-plus-machines campaign in about six.

## Visual and audio bible

- **Camera**: 2:1 isometric (tiles 64×32 world units), follows your avatar, zoom 0.5--2.2.
- **Forms**: rounded, soft dark outline (`rgba(40,30,40,0.55)`), light from the upper left (left faces lighter than right).
- **Palette**: one per world, a "lush" and a "dead" ground colour that tiles interpolate between by life; deposits in each world's three family colours.
- **Characters**: round little people on Earth, suited on Mars, drones at the Sun, probes in the Solar System, glowing wisps in the Universe; always in the player's colour with a name label (and "(you)"), facing their direction, bobbing when walking, swinging a tool when harvesting.
- **Occlusion**: tall buildings turn translucent when anyone stands behind them.
- **Interface**: warm paper cards, rounded, a small HUD, the world dominating the screen.
- **Motion**: wildlife, swaying trees, pond shimmer, factory smoke, data-centre LEDs, harvester bob, relay pulses. "Reduced motion" (defaulting to the OS setting) stops ambient animation and camera easing.
- **Sound**: procedural Web Audio on three separately controlled buses (music, ambience, effects), started only by an explicit click.
