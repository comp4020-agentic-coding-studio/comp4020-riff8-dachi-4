# Decision log

Consequential decisions, newest last. The multi-user behaviour decisions have their own records: [ADR 0001](adr/0001-empty-rooms-pause.md) and [ADR 0002](adr/0002-worlds-run-unattended.md).

## Creative direction

Three directions were sketched against emotional impact, gameplay, visual identity and cost:

| Direction | Pitch | For | Against |
| --- | --- | --- | --- |
| **Plenty** (chosen) | a cheerful cooperative hands you world after world; the copy stays sunny while the land dies | the critique lives in the gap between the voice and the screen, so no lecture is needed; warm Animal Crossing tone is natural | relies on visible environmental change being strong enough |
| Ledger | a clean corporate dashboard world, every tile a spreadsheet cell, players as consultants | the economy reads clearly; cheap to draw | cold from the first minute: no attachment to lose |
| Hearth | a village of named animals who move away as their homes are consumed | strongest attachment | named characters cost far more art and writing than the time allows, and the cosmic stages have no animals to lose |

Plenty keeps Hearth's attachment through landmarks, player-named places and wildlife, and takes Ledger's legibility for the HUD.

## Decisions

- **One authoritative Node process; Next.js exported static.** Satisfies "Next.js for the shell, a separate long-running service for the simulation" on the course's one-machine Fly setup. See [`ARCHITECTURE.md`](ARCHITECTURE.md).
- **Canvas 2D, procedural art.** Fastest route to a consistent original look; one file to replace. PixiJS is the upgrade path if needed.
- **No collisions for avatars.** Players walk through everything; tall buildings turn translucent when someone's behind them. This rules out obstructed routes and trapped deposits entirely, at the cost of a little physicality.
- **Buildings can't cover a deposit that still has stock.** Combined with walk-anywhere, no deposit is ever unreachable, so exhaustion is always achievable.
- **A shared stockpile, and a pack each.** Machines fill and drain the stockpile, so cooperation and tension still come from it; hand harvests go to the harvester's pack, which only they can spend, craft from or deposit. Nobody can take from the stockpile into a pack, so there is nothing to hoard out of it.
- **Tools speed the swing, not the bite.** A tool shortens the cooldown for one family and leaves the yield alone, so the hand-harvest-only path that must always finish a stage is unchanged and nothing new touches the ledger. They cost the families they don't harvest, so the first one is always reachable with bare hands.
- **Gods are opt-in per room and one switch for the host.** They break the game's one-way arithmetic on purpose (stock can be sown, built things can be struck down), so a room only has them if its host asked, and the host can end it.
- **Three resource families relabelled per world.** One economy to balance and learn, five sets of names and looks.
- **Inventory doesn't carry between worlds; the Bottled Sun does.** Each world opens with a small starter crate, so balance is predictable per stage, and the one carryover is the one the prompt makes consequential: the Sun's energy.
- **No readiness vote at transitions.** The server moves the room on after a fixed pause, so no absent player can block it.
- **No rotation.** No building's function depends on facing, so rotation would be decoration with a key binding.
- **No text chat.** Emotes, named places and the activity log carry communication. This removes the moderation surface rather than half-building one.
- **Host is a role, not a person.** The creator, or the longest-connected player present. The host can take down anyone's building and render down World Engines.
- **Hand harvest slowed to 0.8 s and stocks deepened about 1.4×** after measuring a two-player Earth at under three minutes. See [`DESIGN.md`](DESIGN.md#pacing).
- **Movement sent as compact tuples** after measuring bandwidth. See [`TESTING.md`](TESTING.md).
- **Spent deposits are buildable.** Found playtesting: a stump refused a plaza because the tile still had a deposit family with zero stock.
- **No restoration mechanic in this version.** Regrowth that doesn't refill stock risks reading as an undo; one that does breaks the finite-stock rule.
- **Restraint is a unanimous vote, offered only in the Universe.** Unanimous among those present, so it's collective without letting absentees block it; consuming withdraws your vote; a dropped connection never completes it. Offered last so it saves something real without undoing the earlier worlds. The full consumption ending stays available.
- **Fixes from an independent review** (a subagent auditing `server/` and `shared/`): a message that crashed the process, rooms that filled forever, receipts for refused commands, a resync that doubled log lines, a city served for free, unlimited room creation. All fixed with regression tests where they're testable.

## Rivals under gods (crit 10)

Decisions made running the crit 10 pod prompt unattended, where it left a gap or where measuring showed the prose wouldn't hold.

- **Built on the `packs-tools-gods` branch, merged, then rebuilt where the prompt replaced it.** Packs and tools stayed as they were; the first pass's god selection, cooldown, caps and four powers were replaced.
- **One simulation, worlds as a list.** Every per-world rule in `shared/sim.ts` takes a `World`. A classic room holds one world and swaps it at the stage boundary; a cosmos room holds five from the first tick. The classic tests pass unchanged.
- **The client gets one world in full.** A `Snapshot` is the room with the viewed world's fields laid out at the top, so the renderer and HUD code that read `s.tiles` and `s.buildings` didn't fork. Deltas say which world they belong to (`vw`), and a client ignores one for a world it isn't viewing.
- **A god has no budget; the turn has a clock.** Gods are on exactly half the time (30 s with, 30 s without). Selection is fair by faction turns in cosmos (bots holding a seat included) and by person in classic, never the same player twice running when anyone else is a candidate. A god who disconnects is replaced for the rest of the turn, unless under a second is left; a lone god who disconnects simply ends the turn.
- **Repeated acts fold into one log line, moved to the end.** A turn of hundreds of acts is a handful of lines ("Ada, a god, called Lightning 14 times on Earth"), per god, per power, per world, per turn.
- **Hush and Reserve lock tiles, with a rest period.** A tile under one can't be put under another of the same kind until the rest after it lapses. Machines skip locked deposits, and say so in their status.
- **The Universe's restraint counts sown stock as left alone.** It falls out of the books: sown stock is in `remaining` like any other.
- **Spent worlds stay; their Engines wake.** In cosmos a World Engine in the Universe is dormant until the world it stands for is spent, then runs as compute and can still be rendered down.
- **The Bottled Sun fills as plasma is taken**, at the classic rate (4 energy a unit), not in one lump when the Sun is spent, because in cosmos the Sun is taken alongside everything else.
- **Packs travel with their owner.** A pack is named for the world you stand on and spent there; it isn't emptied by a launch.
- **Gifts salvage nothing.** A god's free datacentre taken down gives nothing back, so salvage stays below cost (zero).
- **Factions are data, and two table lines became rules.** "Needs power and compute from someone" (Automata) and "needs Brokers to carry its output off Earth" (Foundry) were only prose until the tournament showed every faction could ignore them. Now the Automata build no Furnace or Sun Garden, and the Foundry builds no Launch Pad. Without that, the lopsided lineups showed no interdependence at all.
- **Others pay 1.5× for a Pad, not 2×.** At 2× nobody but the Brokers ever built one, so a lineup without Brokers simply had no ships.
- **The goals, as they are measured** (each in `measure()`):
  - Foundry: its share of everything taken, by hand or machine, across every world.
  - Automata: compute-ticks its own datacentres supplied. A share of all compute was tried first and sat near 100% whenever the others built none, so the par meant nothing.
  - Brokers: units carried through Pads it built (cargo launched from them by other factions).
  - Stewards: each world's land life against how it began, averaged over five worlds and over the campaign, where a world the Stewards never reached counts as nothing. The prompt's "as each ended or as it stands" was tried first; it finished every campaign at the same value whatever anyone did, because every world ends spent. Averaging over the campaign rewards keeping land alive for longer, and counting unreached worlds as nothing means staying home can't meet it.
- **Par was set once, from data.** The median of each measure over a baseline of 96 full-lineup campaigns (seeds 1000--1047 and 5000--5047), then frozen; balance changes since were made to faction numbers and the bots' plans, never to par. See [TESTING.md](TESTING.md#the-tournament).
- **The catch-up lever is on and left on, though it changes little.** The faction furthest below its par pays 25% less fuel (`CATCH_UP_FUEL`). With it off, par rates on the held-out seeds moved by at most two campaigns in 48; it's kept as the one tunable lever the prompt allows.
- **Choosing a faction.** A newcomer to a cosmos room sees four cards and is dealt one after 30 seconds if they don't choose. "Deal me one" picks the faction with the fewest humans, a bot-held seat first, then the room's dice.
- **Bots are players with no socket.** A bot is a `Player` with `bot: true`, kept in the room's player list (so its buildings, stockpile and record survive a human taking its seat), driven by `shared/bots.ts` through `applyCommand` with a command every 0.3 s and a god act at most once a second. It doesn't take a seat in the eight, never votes and never keeps a room awake.
- **No new god powers were invented, and the prompt's numbers were kept** except where the tournament says otherwise above.
