import { describe, expect, it } from "vitest";
import { FACTIONS, FACTION_IDS, type FactionId } from "../shared/content.ts";
import type { RoomState } from "../shared/protocol.ts";
import { applyCommand, createRoom, join, measure, newChanges, reachedPar, tick } from "../shared/sim.ts";
import { runBots } from "../shared/bots.ts";

// The tournament: seeded cosmos campaigns on the rapid preset, one bot per
// faction, driven headless by the shared planner through applyCommand and
// tick. Par for each faction was set once from a baseline batch (seeds
// 1000-1047 and 5000-5047, the full lineup) and frozen in content.ts; these
// seeds are held out from that batch. docs/TESTING.md has the measured table.

const SEEDS = Array.from({ length: 16 }, (_, k) => 9000 + k);
const MAX_TICKS = 40_000;

/** One campaign to its ending. A faction left out of the lineup has no bot and no human: an empty seat. */
function campaign(seed: number, lineup: readonly FactionId[], idle?: FactionId): RoomState {
  const s = createRoom("TOURN", seed, "rapid", false, "cosmos");
  const ch = newChanges();
  if (idle) {
    // a person who joins a faction and then does nothing at all
    join(s, "idle", "tok-idle", "Idle", ch);
    applyCommand(s, "idle", "pick", s.gen, { k: "faction", f: idle }, ch);
  }
  const empty = (): void => {
    for (const f of FACTION_IDS)
      if (!lineup.includes(f)) {
        s.players[`bot-${f}`].connected = false;
        s.factions[f]!.bot = null;
        s.factions[f]!.emptySince = s.tick;
      }
  };
  empty();
  while (s.phase.k === "play" && s.tick < MAX_TICKS) {
    tick(s, ch);
    empty();
    runBots(s, ch, true);
    ch.w.clear();
    ch.logIds.clear();
  }
  return s;
}

function rates(lineup: readonly FactionId[]): Record<FactionId, number> {
  const hits = Object.fromEntries(FACTION_IDS.map((f) => [f, 0])) as Record<FactionId, number>;
  for (const seed of SEEDS) {
    const s = campaign(seed, lineup);
    expect(s.phase.k).toBe("ended");
    for (const f of FACTION_IDS) if (reachedPar(s, f)) hits[f]++;
  }
  return Object.fromEntries(FACTION_IDS.map((f) => [f, hits[f] / SEEDS.length])) as Record<FactionId, number>;
}

const without = (f: FactionId): FactionId[] => FACTION_IDS.filter((g) => g !== f);

describe("the tournament", { timeout: 120_000 }, () => {
  const full = rates(FACTION_IDS);
  const noBrokers = rates(without("brokers"));
  const noFoundry = rates(without("foundry"));
  const noStewards = rates(without("stewards"));
  const table = { full, noBrokers, noFoundry, noStewards };
  // printed so a run shows the numbers TESTING.md records
  console.log(JSON.stringify(table));

  it("in the full lineup, every faction reaches its par between 30% and 70% of the time", () => {
    for (const f of FACTION_IDS) {
      expect(full[f], f).toBeGreaterThanOrEqual(0.3);
      expect(full[f], f).toBeLessThanOrEqual(0.7);
    }
  });

  it("a missing faction visibly hurts the faction that needs it", () => {
    // Stewards need the others to slow: without Brokers' Pads the others spend the worlds faster
    expect(full.stewards - noBrokers.stewards).toBeGreaterThanOrEqual(0.3);
    // Brokers live on others' consumption and cargo: with no Stewards the campaign is shorter and ships less
    expect(full.brokers - noStewards.brokers).toBeGreaterThanOrEqual(0.3);
    // and a faction can't reach a goal that is someone else's to supply
    expect(noBrokers.brokers).toBe(0);
    expect(noFoundry.foundry).toBe(0);
  });

  it("a faction that sits idle among three bots misses its par", () => {
    for (const f of FACTION_IDS) {
      const s = campaign(SEEDS[0], without(f), f);
      expect(reachedPar(s, f), `${f} measured ${measure(s, f)}, par ${FACTIONS[f].par}`).toBe(false);
    }
  });
});
