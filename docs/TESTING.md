# Testing and evidence

What was checked, how, and what it showed. Targets and results are kept apart, and anything not tested says so.

## Automated tests

`pnpm check` typechecks and runs every `spec/*.test.ts` against a running server (`APP_URL`, default `:8080`). CI runs it against the Docker image Fly deploys, with a throwaway `/data`.

**`spec/sim.test.ts`**, the simulation with no browser or socket:

- resource accounting: `initial = remaining + extracted + destroyed` for every family on every tick of a whole two-player campaign, inventories never negative or non-integer, and the campaign reaches the ending
- exactly one transition per exhausted world (stage generations 2, 3, 4, 5) and one history entry per world, each ending at zero remaining
- a building's cost is charged once; salvage returns strictly less than the cost
- furnace smoke records burnt stock as _destroyed_, and the ledger still balances
- two players placing on the same tile: one building, one charge, the second told why
- two players spending the same balance: the second refused, nothing negative
- two players taking the last unit: one succeeds, the world ends exactly once
- a retried command id applies once
- a command for a previous stage generation is refused
- malformed, non-finite, fractional, out-of-bounds, unknown, out-of-range and unauthorised commands are refused; only the builder or host can demolish
- no building on a deposit with stock left; a spent deposit can be built on
- names are stripped of control characters and capped
- mutations are refused during a transition, and the next world admits them
- only applied commands are receipted, so a refused command can be honestly retried
- seats count connected players; departed identities never fill a room, and past 32 the longest-gone is forgotten
- the restraint ending: only in the Universe, only when everyone present agrees, harvesting withdraws a vote, a holdout's dropped connection never completes it, and the ledger still balances with stock left
- a crash mid-transition (state serialised at the Sun's boundary, restored, resumed) yields the same next world, the same generation and the same Bottled Sun as the uninterrupted run: no duplicate generation, no doubled carryover
- packs and tools: hand harvests go to the harvester's pack, building spends pack then stockpile, crafting, the workbench, packs emptied at a classic boundary
- gods, in both modes: on exactly half the time (within 2% over six cycles), never the same god twice running, fair turns (in classic by person, in cosmos by faction with bots in the pool and a human before their faction's bot); a disconnecting god replaced for the rest of the turn; the host's switch ends the turn and leaves a called Strike to land; every power refused to a mortal and malformed ones to the god
- the five powers: 400 acts in one turn with the books intact and the log folded; Gift free, finished, owned, not on stock; Sow on the books, refused past a fifth of the world's start ("this world has no more to give"); Strike's fuse, destroyed stock on the books, buildings felled with no refund, the god's record; never the Depot, and a Strike on a world's last stock ends it once; Bless halves a mortal's cooldown, not the god's, doesn't stack, and fades; a hundred Hushes on one spot still lapse on time, and the ground rests before another
- twists: Earth's Seed (tile to full life, neighbours +20), the Sun's Flare and Eclipse (±15 heat), Mars's Thin air (a datacentre idle outside a dome runs inside a Bless), the Universe's Supernova taking back its god's vote while Sow and Hush don't
- the cosmos: five worlds from the first tick, `ledgerHolds` failing when any one world's books are broken, every world's economy ticking with nobody on it, ground commands refused for a world you're only viewing, the starter crate on first landing
- factions: the cap on choosing, dealing to the fewest humans with a bot-held seat first, dealing after 30 s of ignoring the cards, locking after a first harvest, a human taking a bot's seat with its stockpile intact and the bot back after 30 s, spending only your own faction's stockpile, `transfer`, every passive rule and can't-build, the Foundry furnace's double power, the Smelter's 3-for-1, the Seeder paying for every copy and never covering stock or minting and stopping at 12, the Reserve locking, lapsing and resting
- journeys: a launch refused when it can't pay, refused mid-flight; cargo in a ship and nowhere else on every tick (`transitHolds`, which fails when a ship's cargo is tampered with); the Pad's tenth to its builder; a pack carried free; landing in the arrival world's stockpile; a spent world never trapping anyone; a god's Strikes never touching a ship
- a god's 500 acts across five worlds in one turn with every world's books intact; powers named in each world's own words
- the cosmos ending: restraint refused until four worlds are spent; a bots-only campaign to the consumption ending with every invariant checked along the way
- bots never vote and do nothing in a room with no human

**`spec/server.test.ts`**, the real server over HTTP and WebSocket:

- `/`, `/play/` and `/api/health` answer
- a room can't be created, and a WebSocket can't open, from a foreign origin
- **real time**: one player's harvest reaches a second open session in under a second, without a reload
- a returning browser's token restores its identity; an unknown token gets a new player
- a resent harvest applies once (acknowledged twice); a command from a stale incarnation is refused with a fresh snapshot
- messages built to throw when coerced (an `id` or `n` that's an object with a broken `toString`) are refused, and the server and room carry on: an independent review found this crashed the whole process
- malformed messages are refused without disturbing the room
- **restart recovery**: a private server on its own data directory is stopped with SIGTERM and restarted; the player rejoins as themselves under a new incarnation and the harvested tile is as they left it
- **crash recovery**: the same after SIGKILL, once the 5 s save interval has passed
- **a cosmos room end to end**: join (four bots holding the seats), choose the Brokers, view Mars (a fresh snapshot, still standing on Earth), a harvest meant for Mars refused, gather one of each stock by hand, deposit, build a Launch Pad, launch for Mars, and see the ship and yourself in flight
- **a god's act on another world**: one player watches the Sun, another stays on Earth; whoever becomes god Blesses the Sun from Earth; the watcher gets it in a delta for the Sun, and the one on Earth sees it on the map's summary
- **migration**: a schema-3 room written by hand (the shape `main` and `packs-tools-gods` saved, with a god mid-turn and a bomb ticking) loads as a classic room with gods off, its stockpile, pack, tools and map intact

**`spec/balance.test.ts`**, the tournament (below), headless.

**`spec/invariants.test.ts`**, the course's: `/` answers and `/readme/` publishes this README with every heading.

83 tests, all passing locally against a locally built server (not the Docker image: this run didn't build it).

## The tournament

`spec/balance.test.ts` plays seeded cosmos campaigns on the rapid preset, headless, one bot per faction driven by the shared planner (`shared/bots.ts`) through `applyCommand` and `tick`, to their ending. A faction left out of a lineup has no human and no bot: an empty seat. It runs 16 held-out seeds (9000--9015) per lineup in about 20 seconds on this machine; the 48-seed batches below (the same campaign function, run from a scratch script that is not committed) take about 12 seconds a lineup.

**Par** was set once from the median of each faction's own measure over 96 full-lineup campaigns (seeds 1000--1047 and 5000--5047) and frozen in `content.ts`: Foundry 47% of everything taken, Automata 780 compute-ticks, Brokers 280 units through its Pads, Stewards 20% (land life against its start, averaged over worlds and the campaign, an unreached world counting as nothing). After that, balance was changed only with the factions' numbers and the bots' plans.

**Measured** on 48 held-out seeds (9000--9047), with the numbers as committed:

| Lineup | Foundry | Automata | Brokers | Stewards |
| --- | --- | --- | --- | --- |
| full | 35% | 35% | 58% | 58% |
| no Brokers | 94% | 77% | (absent) | 0% |
| no Foundry | (absent) | 77% | 52% | 88% |
| no Stewards | 100% | 52% | 2% | (absent) |

(Rates of reaching par. An absent faction can't reach its par: 0%.)

- **The full lineup meets the bar**: every faction between 30% and 70%. The test asserts this on its 16 seeds.
- **A missing faction visibly hurts the one that needs it.** Without the Brokers, the Stewards fall from 58% to 0%: nobody carries stock between worlds, so everyone stays and spends Earth and Mars in place, and the land the Stewards are measured on dies faster. Without the Stewards, the Brokers fall from 58% to 2%: with nothing held back the campaign is shorter and less is shipped. The test asserts drops of at least 30 points for both.
- **The lopsided bar is not met.** The brief asks that no faction fall under 15% or rise over 85% in a lineup with one missing. Foundry rises to 94% and 100% when the Brokers or the Stewards are missing (its measure is a share of everything taken, and a missing taker inflates every other share), the Stewards rise to 88% with no Foundry, and the Stewards and Brokers fall to 0% and 2% as above. Those collapses are the interdependence the brief wants, but at full strength rather than within the band. Tuning further means changing what Foundry's measure counts (for instance, against the number of factions present) or giving the Stewards and Brokers a way to survive their partner's absence; neither was done in this run, so the test doesn't assert the 15--85 band.
- **The catch-up lever** (the faction furthest below par pays 25% less fuel) moved the full-lineup rates by at most 3 campaigns in 48 (off: Foundry 35%, Automata 42%, Brokers 54%, Stewards 56%). It's left on and doesn't matter much; ships are rarely what holds a faction back.
- **Doing nothing doesn't reach par.** A human who joins a faction and does nothing, among three bots, misses its par, for every faction. The test asserts it on one seed.

Every campaign in these batches ended (by consumption) within 14,000 ticks.

The baseline found a planner bug worth recording: a bot walked to a Pad it couldn't afford to launch from, then walked back to work, forever, and the campaign never ended. The planner now only walks to a Pad if the launch would go once it got there.


## Multiplayer playthroughs

`scripts/playbot.ts` joins a room over the real protocol and plays: walks, harvests by hand, and builds each world's machine (homes, power, compute, extractors, domes, radiators, relays) wherever the server accepts. Bots and real browsers (driven by `agent-browser`, headless Chrome) shared rooms throughout:

- **Full campaign**: two bots and two browsers, rapid preset, Earth to the ending in about six minutes. Every stage boundary, the Bottled Sun carryover, the remnant worlds in the Solar System and Universe, and the ending's archive appeared in both browsers.
- **Both browsers saw the same world**: same buildings, same damage, each other's avatars and names, emotes.
- **Reconnect**: the server was restarted (SIGTERM) under a live browser session; the page showed "reconnecting", came back by itself under the new incarnation, and the next keyboard action went through.
- **Keyboard only**: walk, harvest with `E`, choose a building with `2`, place it with `Enter`. This caught a real bug (a stump refusing a building) and a crash path in the key handler.
- **Dense rooms**: one room at the 8-player cap (seven bots and a browser) plus three more rooms of four bots each.
- **Delay and jitter**: a TCP proxy adding 150 ± 100 ms each way, in order (a 430 ms round trip as measured by the in-game ping), with a browser and a bot playing through it beside an unlagged browser. Movement stayed smooth (own avatar is predicted), actions were confirmed a round trip later, nothing was applied twice or lost, and the stockpile stayed consistent across all three.

## Visual inspection

Screenshots at 1920×1080, 1600×900, 1400×850, 1280×720 and 390×844 of: lush Earth, industrial Earth (smoke, browned rings around furnaces), spent Earth (12% living land), Mars with domes and a colony stalled on ice, the Sun bright and dimmed, the Solar System with relays and remnants, the Universe with its stars going out, a transition card and the ending. Findings fixed along the way: overlapping HUD panels at 1280×720, a sky that stayed bright after the Sun was spent, an Earth that never looked desolate (the water-table rule), toasts stacking, duplicate player names.

At 390×844 the game renders and the HUD fits (secondary panels hide), but it's a desktop game: there are no touch controls.

**Accessibility**: `agent-browser a11y` (axe-core 4.12 in a real browser) reports no violations on the front page or the play screen with the HUD loaded. Every control is a native button or input with a text label; building status and stock levels are text, never colour alone; there's a reduced-motion setting defaulting to the OS preference; audio starts only on a click and has three volume controls.

## Performance

Targets: 60 fps at 1080p on an ordinary laptop; server tick well inside 100 ms; memory well inside the 256 MB Fly machine; no unbounded growth.

Measured (Node 24.21, headless Chrome 153, on an AMD Threadripper 7960X workstation, which is much faster than an ordinary laptop):

| Measure | Scene | Result |
| --- | --- | --- |
| browser frame time | 1920×1080, Mars, 8 players and ~20 buildings | ~1.2 ms (moving average in the settings panel) |
| browser frame time | 1280×720 through the 430 ms lag proxy | ~1.6 ms |
| server step (all rooms) | 6 rooms, 20 connections, rapid economy | 0.5--1.4 ms typical, 7.4 ms worst (a stage boundary: save plus snapshots) |
| server memory | same | 97 MB at start, 101--104 MB after 100 s, flat |
| outbound traffic | same | 227 KB/s total before compact movement, 136 KB/s after (about 6.8 KB/s per connection) |

Frame time leaves about tenfold headroom on this machine, which suggests a laptop will hold 60 fps, but that isn't established: no ordinary laptop was available. The "low detail" setting turns off wildlife and particles if it's needed. Interest management isn't implemented (every client gets every change in its room); at 32×32 tiles and eight players that's affordable, and it's the first thing to add if maps grow.

**The cost of the cosmos** (`node` on the simulation alone, five worlds after 3,000 ticks of four bots building them up to 17--74 buildings each, then four bots plus eight humans' worth of commands every tick: a move and a harvest each, and four god acts across worlds whenever one of them is god): a median 0.11 ms per tick, 0.48 ms at the 99th percentile, 1.2 ms worst over 2,000 ticks. Well inside the 100 ms tick. A god act is a few dozen tile reads (a Strike's radius) and folds into one log line, so a turn of several hundred acts costs nothing measurable. Strikes, Blesses and Hushes are kept per world and pruned as they lapse; rested tiles are forgotten every 5 s.

Unbounded growth is guarded by design: the activity log keeps 40 entries, receipts 64 per player, interpolation 12 samples per player, toasts 3, pending commands 32; the archive and history grow by a handful of entries per world and stop at the ending.

## Playtesting questions

Answered from bot runs and browser play, not from human playtesters, which this run didn't have:

- **Is the first harvest satisfying?** It has a swing, a pop of "+1 timber", a dust burst and a tone, and a tree visibly thins and becomes a stump. A human should judge the feel.
- **Are buildings useful?** Each unlocks something the previous couldn't do, and the memo walks through the order.
- **Does automation produce new decisions?** Yes, mostly about shortages: the dense Mars test stalled a whole colony on ice, which led to the bottleneck line in the stockpile panel.
- **Can players understand shortages?** Every idle building says why in its inspect panel, and the stockpile panel names the commonest reason.
- **Does environmental loss register without a speech?** After the water-table rule, yes: green to brown across the whole island, birds and birdsong thinning, archive lines as places go.
- **Does cooperation change the experience?** Shared stockpile, helping raise sites, and dependent chains (ice before domes before datacentres) reward dividing work. Untested with humans.
- **Is the end of a stage tedious?** The survey arrow removes the hunt; the last few deposits are still gathered by hand if the machines have run dry.
- **Does each scale feel different?** Each world changes one rule (smoke, air, heat, relays and a finite reserve, legacy engines) and the look and avatar change with it.
- **Does the ending land?** It's deliberate and quiet. Whether it lands needs people.

## Cosmos and gods in a browser

A cosmos room with gods, rapid preset, one browser at 1280×720 beside the four bots: the faction cards (choose or deal, and the dealt faction's bot standing down), the HUD with the host switch, world chips, the god line at the top centre, the faction panel, the orbital map (five discs, a ship crossing to Mars, stake bars with shapes, the panels stepping aside) and clicking a disc to view Mars (build bar refused from afar). As a god: the Powers bar in Earth's names, the preview naming the buildings a Lightning would take, Lightning landing and folding into "3 of Ada's Lightnings have landed on Earth", aiming at Mars with `]` and the bar switching to Mars's names. The god drawn larger, floating, with halo and robe. Found and fixed: a god replaced with no time left was announced as a god "for 0 seconds"; a lone god who left stayed god; the map was covered by the side panels; a Bless preview counted the god among those in it. `agent-browser a11y` on the play screen: 0 violations, 0 incomplete.

## Not done

- **Deployment**: this run doesn't deploy; CI deploys the pod's app on push. Nothing here claims a verified live deployment.
- **Human playtesting**: everything above is bots and a scripted browser.
- **An ordinary laptop**: see performance.
- **Mobile and touch**: renders, isn't playable.
- **Not verified in a browser**: a full cosmos campaign to its ending with humans; a landing (seen only in the server test and the sim tests); the Slipstream twist on the Solar System (the code path exists, there's no test); the sounds (no audio device here); reduced motion on the god's bob and the map's pulses (the code uses the existing setting); the ending card's per-faction lines.
- **The lopsided balance band**: see the tournament.
- **The Docker image** wasn't built or run in this run; CI does that.

## Next development, in priority order

1. Human playtests of the first ten minutes and the ending, then tuning from what people actually do.
2. Interest management (send each client only nearby tile changes) before maps grow.
3. Sprite art for buildings and avatars, replacing the procedural shapes one family at a time (see [`ASSETS.md`](ASSETS.md)).
4. Host moderation: remove a player, lock a room to new joiners.
5. A photo album kept per room, so the archive has pictures, not just names.
6. Touch controls.
