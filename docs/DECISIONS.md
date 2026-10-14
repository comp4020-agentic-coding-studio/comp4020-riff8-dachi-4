# Decision log

Consequential decisions, newest last. The multi-user behaviour decision has its own record: [ADR 0001](adr/0001-empty-rooms-pause.md).

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
- **Gods are opt-in per room and one switch for the host.** They break the game's one-way arithmetic on purpose (stock can be planted, built things can be blown up), so a room only has them if its host asked, and the host can end it. A god's turn is 30 seconds and passes to someone else, so nobody holds the power.
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
