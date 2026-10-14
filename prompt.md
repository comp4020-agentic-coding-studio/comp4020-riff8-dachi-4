# Gods: give people 30 seconds of real power, and let the world remember what they did with it

Plenty is a game about using worlds up. This run adds the one thing that can push the other way, and the one thing that can make it much worse: every so often a player becomes a god. A god can give or take. The game never says which was right; it only keeps the record, by name.

You are running unattended. Nobody will answer questions, so where this prompt leaves a gap, decide in the direction of the design goals below and write the decision in `docs/DECISIONS.md`.

## Where you start

The branch `packs-tools-gods` (commit `2430441`) holds a working first pass. Merge it into `main` and build on it, or rebuild from this prompt if you find it in your way. It has:

- **Packs and hand tools.** Hand harvests go to the harvester's own pack; building spends the pack, then the shared stockpile; `G` deposits. A Cutter, a Pick and a Scoop (rough, then fine) shorten the harvest cooldown for one stock each. Keep this as it is.
- **Gods, roughly.** A room can be hosted with gods. One player is chosen every 30 seconds and can raise a datacentre, drop a bomb, plant a deposit or lay an aura. There is a host button, a plain panel, and a halo on the god.

That first pass is a sketch. Its selection, limits, look, panel and powers are all replaced by what follows. Where it and this prompt disagree, this prompt wins.

## What good looks like

- **Every power can be used kindly or cruelly, and it's the same power.** No good spells and bad spells. A player who wants to help and a player who wants to wreck should both find all five powers useful.
- **"Kind" has two meanings here, and they pull apart.** Kind to the players (faster harvesting, free machines) is cruel to the world. Kind to the world (new stock, protected groves) slows the players down. Don't resolve this. It is the point of the game.
- **A turn is a few decisions, not a spray.** Thirty seconds, a handful of acts, each one visible to everyone and signed.
- **Nobody is surprised.** Everyone can see who the god is, what is about to land, where, and when.
- **The record is facts, not a verdict.** No morality meter, no "good" or "evil" label anywhere. Counts and names only.

## When there is a god

- Gods are on or off per room. The host chooses when hosting and can switch at any time.
- While they are on, there is a god exactly half the time: 30 seconds with a god, 30 seconds with none, repeating.
- The next god is whoever has had the fewest turns in this room, ties broken by the room's seeded generator. Never the same person twice running when anyone else is connected. A lone player still alternates.
- A god who disconnects is replaced at once, for the rest of that turn only.
- A turn and a gap both carry over a world boundary; pending acts do not.

## What a god has to spend

Each turn starts with **4 will**. Will does not carry over. Acts cost will, land from any distance, and are refused when the god can't pay. This replaces the first pass's one-act-a-second cooldown.

| Power | Cost | What it does |
| --- | --- | --- |
| **Sow** | 1 | A full new deposit of a chosen stock on an empty tile. |
| **Bless** | 1 | An aura, radius 4, 5 seconds. Everyone in it except the god harvests twice as fast, on top of their hand tool. |
| **Hush** | 1 | A stillness, radius 3, 10 seconds. Nothing inside it can be harvested, by hand or by machine. |
| **Gift** | 2 | A finished datacentre, free, wherever one would normally fit. It is owned by the god and runs like any other: it needs power, workers and coolant. |
| **Strike** | 2 | Lands 3 seconds after it is called, radius about 2.3 tiles. Stock is destroyed, buildings fall with no refund, the ground dies. |

Why each one cuts both ways, which is what to preserve if you change numbers:

- **Sow** feeds the players and heals the map. It also puts off the world's end, and on a crowded map it can be dropped where it blocks a building someone was about to place.
- **Bless** is a gift to the people in it and a faster death for whatever they are standing on.
- **Hush** can save the Old Oak for ten seconds, or lock the only pond while a colony's datacentres run dry.
- **Gift** is free compute, and one more machine drinking the shared water and killing the ground under it.
- **Strike** can end a furnace that is smoking a named grove, or erase a friend's town.

Limits that keep the game sound:

- **Sown stock is capped per world** at 20% of what that world was generated with. Past that, Sow is refused with "this world has no more to give". A world must always be able to end.
- **A Strike never touches** the Depot, a World Engine or a player. Stock it destroys moves from `remaining` to `destroyed`; stock that is sown is added to `initial` and `remaining` together. `ledgerHolds` stays true on every tick.
- **A Hush always ends.** At most one at a time, and it can't be renewed over the same tiles until it has lapsed for 10 seconds, so no deposit is ever out of reach for good.
- **A Strike that destroys the last stock ends the world**, once, the same way a last harvest does.

## The same powers on five worlds

Powers keep their mechanics on every world. Each world renames them and adds one twist that touches that world's own rule. If you run short of time, the names matter more than the twists.

| World | The god is | Sow | Strike | Bless | Hush | Twist |
| --- | --- | --- | --- | --- | --- | --- |
| Earth | a person, afloat | Seed | Lightning | Fair wind | Still air | Seed also restores the tile to full life and lifts its eight neighbours by 20. |
| Mars | a suit, visor gold | Buried spring | Meteor | Thin air | Dust calm | Machines inside a Thin air run as if under a Dome while it lasts. |
| The Sun | a drone in a corona | Kindle | Flare | Updraft | Eclipse | A Flare adds 15 heat. An Eclipse sheds 15. |
| Solar System | a probe with moons | Comet | Collision | Slipstream | Radio silence | Machines inside a Slipstream count as linked to the Depot while it lasts. |
| The Universe | a wisp with an eye | New star | Supernova | Fair current | Dark | Sown stock counts in what the restraint ending leaves alone. A Supernova takes back the god's own vote to stop; Sow and Hush do not. |

Gift takes the world's own name for a datacentre.

## What a god looks like

The god is the player's own avatar for that world, in their own colour, changed in ways that read at a glance and never by colour alone:

- **Drawn 1.4 times larger, and off the ground.** It hovers about a third of a tile up with a soft shadow below it, bobbing slowly (still, under reduced motion).
- **A halo** above the head, and the word "god" after the name on the label.
- **One mark per world**, on top of that world's avatar: on Earth the legs are gone and a robe hem trails; on Mars the visor is solid gold; at the Sun a ragged corona; in the Solar System six small moons in orbit; in the Universe a single open eye in the wisp.
- **The halo tells on you.** It is drawn from what this player has done as a god across the whole campaign. Mostly giving (stock sown, Hushes laid): a whole ring, with a few drifting petals, snowflakes, sparks or stars to suit the world. Mostly taking (stock destroyed, buildings felled): the ring is broken in two and the trail is embers. Otherwise a plain ring. The shape carries it, not the tint.
- **A turn begins and ends visibly.** A short column of light on the chosen player when it starts; the avatar settles back to the ground when it ends.

## Interface

**Front page.** A "Host a world" group: name, pace, and a "With gods" switch with one sentence saying what it means. The join form stays separate below it.

**Host switch.** The first thing in the top-left column, visible only to the host: a labelled switch, "God mode on / off". It works on every world. Switching off ends the current turn immediately and leaves anything already called to land.

**For everyone, while gods are on.** One compact line at the top centre of the screen:

- with a god: "Ada is a god", a bar draining over the 30 seconds, and their remaining will as pips
- in a gap: "No god. Next in 12s."
- It is an `aria-live` status, and it never covers the stage panel or the room panel at 1280×720.

**For the god.** When your turn starts the bottom bar switches from Build to Powers and switches back when it ends. `Tab` flips between them at any time during a turn.

- Five buttons, keys `1`–`5`, each showing the world's name for the power, its cost, and whether you can afford it. Sow opens a choice of the three stocks.
- Click a tile, or press `Enter` for the tile you face. `Esc` puts the power down.
- **The preview says what will happen in words**, before you commit: the radius on the ground, and a line such as "destroys 36 timber and 2 buildings, including Ben's Cottages. The Old Oak is inside." For Bless and Hush: who is standing in it right now.
- A refusal is a sentence, as everywhere else in the game.

**For everyone else.**

- A called Strike shows its ring and a countdown on the ground the moment it is called. If it is off screen, an arrow at the screen edge points to it.
- Bless and Hush show their rings, a label in words ("quicker hands, 4s", "nothing can be taken here, 8s") and a line when you walk in or out.
- Every act is one line in the log, signed: "Ada, a god, called Lightning on Heron Pond."
- Named places hit by a Strike go into the archive with the god's name: "was struck by Ada".

**The record.**

- The roster shows two numbers beside anyone who has acted as a god: stock sown and stock destroyed.
- The world summary between worlds gains a "Sown" column beside Extracted and Destroyed.
- The ending's "Who did it" gains a line per god: sown, destroyed, buildings felled, datacentres gifted, harvests made under their Bless, seconds of Hush. No adjective, no score.

**Sound and motion.** A rising tone when a turn starts, a low one when a Strike lands, a soft shimmer for Bless. Everything respects the reduced-motion and low-detail settings that exist.

## Rules of the house

The harness rules in `CLAUDE.md` all apply. The ones this work leans on hardest:

- The server decides everything. A client sends "I want to Strike here"; whether they are the god, can pay, and what it destroys is worked out in `shared/sim.ts`. Validate every field.
- Bump `PROTOCOL_VERSION` and `SCHEMA_VERSION`, with a migration in `server/store.ts` that loads rooms saved by `main` and by the `packs-tools-gods` branch with gods off.
- Rooms hosted without gods must play exactly as they do now. A tool-less, god-less player's pacing does not change.
- Add tests to `spec/sim.test.ts` for: the half-time alternation and fair order; will and its costs; each power's effect and refusal cases; the sow cap; the ledger through sowing and striking; a Strike ending a world once; Hush always lapsing; a mortal being refused every power; each world's twist you build.
- Update `README.md`, `docs/DESIGN.md` and `docs/DECISIONS.md` in the same commits as the behaviour.
- `pnpm check` passes before each commit, and `main` stays deployable throughout.

## Leave alone

- The five worlds, their maps, their balance numbers and their two endings.
- Packs, hand tools and their costs.
- The Depot, the World Engines and the host's right to render an Engine down.
- Anything that would let a god harm, move or block another player's avatar.

## If you run out of time

Build in this order, and stop at a point where `main` is whole:

1. Alternation, fair order, will, and the five powers with their limits, tested.
2. The top-centre line, the Powers bar and the worded previews.
3. The god's look: size, hover, halo, the word.
4. The record: roster numbers, the Sown column, the ending lines.
5. Per-world names.
6. Per-world twists and marks, and the halo that tells on you.

Then play one room with gods through all five worlds using `scripts/playbot.ts` and a browser, fix what you find, and write what you could not verify in `docs/TESTING.md`.
