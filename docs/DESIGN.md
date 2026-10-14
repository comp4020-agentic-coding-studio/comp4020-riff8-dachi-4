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

## Two modes

A room is hosted in one of two modes, fixed for its life. **Classic** is everything above: one world at a time, one shared stockpile, everyone on the same side. **Cosmos** (the default on the front page) runs all five worlds at once, splits the players into four rival factions, and moves people and stock between worlds by ship. Both use the same simulation: a cosmos world is a classic world, run alongside the others, with faction rules on top.

## The cosmos

**All five worlds from the first tick.** Each has its own tiles, buildings, books, heat and economy, and every world's economy ticks whether or not anyone is standing on it ([ADR 0002](adr/0002-worlds-run-unattended.md)). Nothing locks a route: the worlds' own rules gate them. Mars runs only inside a dome's air; the Sun's heat throttles output; the Solar System and the Universe have no sunlight, and every machine there draws on one Bottled Sun for the whole cosmos, filled 4 energy for every unit of plasma anyone takes at the Sun. Until someone burns the Sun, those two worlds have hands and nothing else.

**Being somewhere, and looking.** You stand on one world and can walk, harvest and build only there. The orbital map (`M`, or the world chips) lets anyone look at any world for free; looking is not presence, and the build bar says so. A faction's first person on a world brings that world's starter crate, once.

**Journeys.** A Launch Pad is the way off a world, open to everyone; its builder takes a tenth of any cargo through it, always less than the cargo. A launch costs 6 matter and 3 coolant from the faction's stockpile there, and takes 10 seconds plus 8 per step along Earth, Mars, Sun, Solar System, Universe. A ship carries its launcher and up to 20 units, addressed to their own faction or another's, landing in the destination's names. Packs travel free with their owner. A spent world never traps anyone: from it you can always leave free, from the ground, to the nearest living world. Stock in flight is in a ship and nowhere else, and an invariant beside the ledger checks it.

**Stockpiles.** Each faction has its own stockpile on each world and spends only that. There's no common pool. `transfer` gives stock to another faction on the same world, free and instant, which is how deals are struck. Power, compute, workers and coolant draw stay world-wide, so a Dome or a Relay helps every machine in its reach whoever built it, and a builder pays for what others use.

**Ending.** The campaign ends when every world is spent, or when the Universe's restraint vote passes, which is offered only once the other four are spent. Only humans vote. A spent world stays on the map as a grey remnant, and its World Engine in the Universe wakes.

## Factions

| Faction | Doctrine | Passive | Unique | Weakness | Goal |
| --- | --- | --- | --- | --- | --- |
| Foundry ■ | Burn it. | Furnaces give double power. | Smelter: 3 matter → 1 mineral a tick. | Smoke reaches a tile further. Builds no Launch Pads. | its share of everything taken |
| Automata ● | Let the machine do it. | Harvesters a quarter cheaper. | Seeder: a harvester that pays for and places copies of itself, up to 12 a world. | Hands half as fast. Builds no power of its own. | compute-ticks its machines supply |
| Brokers ▲ | Everything moves through us. | Pads and fuel half price. | Launch Pad (others pay 1.5×). | Can't build Harvesters. | units carried through its Pads |
| Stewards ◆ | Keep some back. | Sun Gardens 30% cheaper. | Reserve: a deposit and its neighbours, locked for 60 s. | Hands a quarter slower. Can't build Furnaces. | land life on the worlds it reaches, against how it began, over the campaign |

Each goal is a number beside a par, set once from the tournament and never edited since: facts, not a score. Nobody wins.

### What they are arguing

The Foundry is the honest version of the whole game: take, burn, grow. It needs someone to carry its output off Earth (it builds no Pads) and its smoke spends the land everyone shares, which is the land the Stewards are measured on. The Automata want the machine to do it, but build no power of their own, so their datacentres run on the Foundry's furnaces or the Stewards' gardens, and drink the water every faction's machines need. The Brokers make nothing; they're paid when other people move what they've taken, so they want everyone else busy and travelling, and lose most when the others are slowed down. The Stewards want the land kept, which means they want the other three to slow down or stop, and the only tool they have that isn't persuasion is the Reserve, which holds a deposit back for a minute and then always lets go.

None of them is the right answer. A table of Stewards spends nothing and goes nowhere: the Bottled Sun stays empty, the outer worlds are hands only, and their own measure counts every world they never reached as dead. A table of Foundry spends everything fast, and the furnaces it relies on burn the groves it would have harvested next. The Brokers' measure is only as large as everyone else's appetite. Each faction's goal needs another's behaviour, or is ruined by it, and the tournament shows it: take one faction out and the one that needed it falls (numbers in [TESTING.md](TESTING.md#the-tournament)).

### Joining, and bots

On joining a cosmos room you see four cards (name, doctrine, unique building, goal, and who it needs and threatens) and either choose one that isn't full (`ceil(humans ÷ 4)`) or are dealt one. The host can make the room choose-only, deal-only, or either. You can change until you first harvest or build.

Every faction always has an occupant. One with no human is played by a server-side bot, labelled "(bot)", which takes the same commands through the same validation as anyone, from a pure planner in `shared/bots.ts`. A human joining a faction takes its seat at once, keeping its buildings and stockpiles; if every human leaves, the bot is back 30 seconds later. Bots take no seat among the eight, never vote, and never keep a room awake.

## Gods

A room can be hosted with gods, in either mode, and the host can switch them on or off at any time (switching off ends the current turn and leaves anything already called to land). While they're on, there's a god half the time: 30 seconds with one, 30 seconds with none. The next god is the faction with fewest turns (in classic, the person), ties broken by the room's dice, then the human in it with fewest turns, or its bot if it has no human; never the same player twice running when anyone else can be.

A god has five powers and no budget: as many acts as they like while the turn lasts, from any distance, and in cosmos on any world (`[` and `]`, or a click on the map). The clock is the only limit, and every act is signed in the log and visible to everyone.

| Power | What it does | Kind to the players | Kind to the world |
| --- | --- | --- | --- |
| Sow | a full new deposit on an empty tile, up to a fifth of what the world began with | more to take | heals the ground, but puts off the world's end |
| Bless | radius 4, 5 s: everyone in it but the god harvests twice as fast | quicker hands | a faster death for what they stand on |
| Hush | radius 3, 10 s: nothing in it can be harvested, by hand or machine; the ground then rests 10 s before it can be hushed again | locks the only pond while datacentres run dry | saves the Old Oak, for ten seconds |
| Gift | a finished datacentre, free, owned by the god's faction | free compute | one more machine drinking the water and killing the ground under it |
| Strike | lands 3 s after it's called, radius 2.3: stock destroyed, buildings fall, the ground dies; never the Depot, a World Engine, a player or a ship | ends the furnace smoking a named grove | erases a friend's town |

No good spells and bad spells: the same power is kind or cruel depending on what it lands on, and kind to the players is usually cruel to the world. Each world renames them (Seed / Lightning / Fair wind / Still air on Earth; Buried spring / Meteor / Thin air / Dust calm on Mars; Kindle / Flare / Updraft / Eclipse at the Sun; Comet / Collision / Slipstream / Radio silence in the Solar System; New star / Supernova / Fair current / Dark in the Universe) and adds one twist: Earth's Seed restores the tile and lifts its neighbours; Mars's Thin air runs machines as if under a Dome; at the Sun a Flare adds 15 heat and an Eclipse sheds 15; the Solar System's Slipstream links machines to the Depot; and a Supernova takes back its god's own vote to stop.

The god is drawn 1.4× larger, hovering with a soft shadow, a halo and the word "god", with a mark for each world (a robe on Earth, a gold visor on Mars, a corona at the Sun, six moons in the Solar System, one open eye in the Universe). The halo tells on you: a whole ring with drifting petals for someone who has mostly given, a ring broken in two trailing embers for someone who has mostly taken. The roster shows each god's stock sown and destroyed; the ending lists, per god, what they sowed, destroyed, felled, gifted, the harvests made under their Bless and the seconds of Hush, and in cosmos each faction's measure against its par. No adjective, no score, no winner.

## Multiplayer rules

- In classic, natural stock and the stockpile are communal; in cosmos each faction has its own stockpile per world. Packs and tools are individual; buildings are owned for recognition and permission; stats (harvested, built, helped) are individual and shown at the end.
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
