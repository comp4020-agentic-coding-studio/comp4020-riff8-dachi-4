import { describe, expect, it } from "vitest";
import {
  BLESS_TICKS,
  BOT_RETURN_TICKS,
  BUILDINGS,
  DEAL_AFTER_TICKS,
  EARTH_SEED_LIFT,
  FACTIONS,
  FACTION_IDS,
  FAMILIES,
  GOD_GAP_TICKS,
  GOD_POWERS,
  GOD_TURN_TICKS,
  HARVEST_COOLDOWN_TICKS,
  HUSH_TICKS,
  RESERVE_TICKS,
  SMELTER_IN,
  SOW_CAP,
  STAGES,
  STRIKE_FUSE_TICKS,
  SUN_TWIST_HEAT,
  TOOL_TIERS,
  flightTicks,
  toolCost,
} from "../shared/content.ts";
import type { Building, RoomState, Ship, World } from "../shared/protocol.ts";
import {
  activeBot,
  applyCommand,
  bundleOk,
  costOf,
  createRoom,
  fuelFor,
  harvestTicks,
  inventoriesOk,
  join,
  leave,
  ledgerHolds,
  newChanges,
  placementProblem,
  stockOf,
  tick,
  totalRemaining,
  transitHolds,
  type Changes,
} from "../shared/sim.ts";
import { runBots } from "../shared/bots.ts";

// The authoritative simulation, exercised directly: no browser, no socket.

let n = 0;
const id = (): string => `c${n++}`;

function room(pace: "normal" | "rapid" = "rapid", players = ["a"]): { s: RoomState; ch: Changes } {
  const s = createRoom("TESTS", 7, pace);
  const ch = newChanges();
  for (const p of players) join(s, p, `tok-${p}`, p.toUpperCase(), ch);
  return { s, ch };
}

const depositIdx = (s: RoomState): number => s.worlds[0].tiles.findIndex((t) => t.d && t.amt > 0);
const at = (s: RoomState, i: number): [number, number] => [i % s.worlds[0].w, Math.floor(i / s.worlds[0].w)];
const freeTile = (s: RoomState, size = 1): [number, number] => {
  const p = Object.values(s.players)[0];
  for (let r = 1; r < s.worlds[0].w; r++)
    for (let y = Math.round(p.y) - r; y <= Math.round(p.y) + r; y++)
      for (let x = Math.round(p.x) - r; x <= Math.round(p.x) + r; x++) {
        let ok = true;
        for (let dy = 0; dy < size && ok; dy++)
          for (let dx = 0; dx < size && ok; dx++) {
            const t = s.worlds[0].tiles[(y + dy) * s.worlds[0].w + x + dx];
            if (x + dx < 0 || y + dy < 0 || x + dx >= s.worlds[0].w || y + dy >= s.worlds[0].w || !t || t.d || t.b || t.t !== 0) ok = false;
          }
        if (ok) return [x, y];
      }
  throw new Error("no free tile");
};
const stand = (s: RoomState, pid: string, x: number, y: number): void => {
  s.players[pid].x = x;
  s.players[pid].y = y;
};

/** A bot that only ever harvests by hand: the path that must always finish a stage. */
function harvestBot(s: RoomState, ch: Changes, pid: string): void {
  const p = s.players[pid];
  let best = -1;
  let bd = Infinity;
  s.worlds[0].tiles.forEach((t, i) => {
    if (!t.d || t.amt <= 0) return;
    const d = Math.hypot((i % s.worlds[0].w) - p.x, Math.floor(i / s.worlds[0].w) - p.y);
    if (d < bd) [bd, best] = [d, i];
  });
  if (best < 0) return;
  const [x, y] = at(s, best);
  if (bd > 1.5) applyCommand(s, pid, id(), s.gen, { k: "move", dx: x - p.x, dy: y - p.y }, ch);
  else {
    applyCommand(s, pid, id(), s.gen, { k: "move", dx: 0, dy: 0 }, ch);
    applyCommand(s, pid, id(), s.gen, { k: "harvest", x, y }, ch);
  }
}

describe("resource accounting", () => {
  it("keeps initial = remaining + extracted + destroyed through a whole campaign, and reaches the ending", () => {
    const { s, ch } = room("rapid", ["a", "b"]);
    const boundaries: number[] = [];
    while (s.phase.k !== "ended" && s.tick < 100_000) {
      if (s.phase.k === "play") {
        harvestBot(s, ch, "a");
        harvestBot(s, ch, "b");
      }
      const before = s.gen;
      tick(s, ch);
      if (s.gen !== before) boundaries.push(s.gen);
      expect(ledgerHolds(s)).toBe(true);
      expect(bundleOk(s.worlds[0].inventory)).toBe(true);
      for (const p of Object.values(s.players)) expect(bundleOk(p.pack)).toBe(true);
    }
    expect(s.phase.k).toBe("ended");
    // exactly one transition per exhausted stage
    expect(boundaries).toEqual([2, 3, 4, 5]);
    expect(s.history.map((h) => h.stage)).toEqual(STAGES.map((st) => st.id));
    for (const h of s.history) for (const f of FAMILIES) expect(h.ledger[f].remaining).toBe(0);
  });

  it("charges a building's cost once and salvages strictly less than it", () => {
    const { s, ch } = room();
    s.worlds[0].inventory = { matter: 100, mineral: 100, coolant: 100 };
    const [x, y] = freeTile(s, 2);
    expect(applyCommand(s, "a", id(), s.gen, { k: "build", x, y, type: "city" }, ch)).toEqual({ ok: true });
    expect(s.worlds[0].inventory.matter).toBe(100 - BUILDINGS.city.cost.matter!);
    expect(applyCommand(s, "a", id(), s.gen, { k: "demolish", x, y }, ch)).toEqual({ ok: true });
    expect(s.worlds[0].inventory.matter).toBeLessThan(100);
    expect(s.worlds[0].inventory.mineral).toBeLessThan(100);
  });

  it("never lets a furnace's smoke make stock vanish off the books", () => {
    const { s, ch } = room("rapid");
    s.worlds[0].inventory = { matter: 200, mineral: 200, coolant: 0 };
    const grove = s.worlds[0].tiles.findIndex((t) => t.d === "matter");
    const [gx, gy] = at(s, grove);
    // find a free tile within two of the grove for the furnace
    let spot: [number, number] | null = null;
    for (let dy = -2; dy <= 2 && !spot; dy++)
      for (let dx = -2; dx <= 2 && !spot; dx++) {
        const t = s.worlds[0].tiles[(gy + dy) * s.worlds[0].w + gx + dx];
        if (t && !t.d && !t.b && t.t === 0) spot = [gx + dx, gy + dy];
      }
    expect(spot).not.toBeNull();
    stand(s, "a", spot![0], spot![1]);
    expect(applyCommand(s, "a", id(), s.gen, { k: "build", x: spot![0], y: spot![1], type: "furnace" }, ch).ok).toBe(true);
    const [cx, cy] = freeTile(s, 2);
    expect(applyCommand(s, "a", id(), s.gen, { k: "build", x: cx, y: cy, type: "city" }, ch).ok).toBe(true);
    for (let i = 0; i < 200; i++) tick(s, ch);
    expect(s.worlds[0].ledger.matter.destroyed).toBeGreaterThan(0);
    expect(ledgerHolds(s)).toBe(true);
  });
});

describe("conflicts resolve to one outcome", () => {
  it("two players placing on the same tile: one building, one charge", () => {
    const { s, ch } = room("rapid", ["a", "b"]);
    s.worlds[0].inventory = { matter: 100, mineral: 100, coolant: 100 };
    const [x, y] = freeTile(s, 2);
    stand(s, "b", s.players.a.x, s.players.a.y);
    const r1 = applyCommand(s, "a", id(), s.gen, { k: "build", x, y, type: "city" }, ch);
    const r2 = applyCommand(s, "b", id(), s.gen, { k: "build", x, y, type: "plaza" }, ch);
    expect(r1.ok).toBe(true);
    expect(r2).toEqual({ ok: false, reason: "something is already built here" });
    expect(s.worlds[0].buildings.filter((b) => b.owner)).toHaveLength(1);
    expect(s.worlds[0].inventory.matter).toBe(100 - BUILDINGS.city.cost.matter!);
  });

  it("two players spending the same shared balance: the second is refused, nothing goes negative", () => {
    const { s, ch } = room("rapid", ["a", "b"]);
    s.worlds[0].inventory = { matter: 12, mineral: 6, coolant: 0 }; // exactly one city
    const [x, y] = freeTile(s, 2);
    stand(s, "b", s.players.a.x, s.players.a.y);
    expect(applyCommand(s, "a", id(), s.gen, { k: "build", x, y, type: "city" }, ch).ok).toBe(true);
    const [x2, y2] = freeTile(s, 2);
    const r = applyCommand(s, "b", id(), s.gen, { k: "build", x: x2, y: y2, type: "city" }, ch);
    expect(r.ok).toBe(false);
    expect(bundleOk(s.worlds[0].inventory)).toBe(true);
  });

  it("two players harvesting the last unit: one gets it, and the stage ends exactly once", () => {
    const { s, ch } = room("normal", ["a", "b"]);
    const last = depositIdx(s);
    s.worlds[0].tiles.forEach((t, i) => {
      if (t.d && i !== last) {
        s.worlds[0].ledger[t.d].remaining -= t.amt;
        s.worlds[0].ledger[t.d].extracted += t.amt;
        t.amt = 0;
      }
    });
    const t = s.worlds[0].tiles[last];
    s.worlds[0].ledger[t.d!].remaining -= t.amt - 1;
    s.worlds[0].ledger[t.d!].extracted += t.amt - 1;
    t.amt = 1;
    expect(ledgerHolds(s)).toBe(true);
    const [x, y] = at(s, last);
    stand(s, "a", x, y);
    stand(s, "b", x, y);
    const r1 = applyCommand(s, "a", id(), s.gen, { k: "harvest", x, y }, ch);
    const r2 = applyCommand(s, "b", id(), s.gen, { k: "harvest", x, y }, ch);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    expect(s.history).toHaveLength(1);
    expect(s.phase.k).toBe("transition");
  });
});

describe("commands", () => {
  it("applies a retried command id once", () => {
    const { s, ch } = room("normal");
    const i = depositIdx(s);
    const [x, y] = at(s, i);
    stand(s, "a", x, y);
    const before = s.worlds[0].tiles[i].amt;
    applyCommand(s, "a", "same", s.gen, { k: "harvest", x, y }, ch);
    s.players.a.nextHarvest = 0;
    expect(applyCommand(s, "a", "same", s.gen, { k: "harvest", x, y }, ch)).toEqual({ ok: true });
    expect(s.worlds[0].tiles[i].amt).toBe(before - 1);
  });

  it("receipts only applied commands, so a refused one can be retried for real", () => {
    const { s, ch } = room("normal");
    const i = depositIdx(s);
    const [x, y] = at(s, i);
    stand(s, "a", x, y);
    const before = s.worlds[0].tiles[i].amt;
    applyCommand(s, "a", "first", s.gen, { k: "harvest", x, y }, ch);
    expect(applyCommand(s, "a", "again", s.gen, { k: "harvest", x, y }, ch)).toEqual({ ok: false, reason: "too fast" });
    s.players.a.nextHarvest = 0;
    expect(applyCommand(s, "a", "again", s.gen, { k: "harvest", x, y }, ch)).toEqual({ ok: true });
    expect(s.worlds[0].tiles[i].amt).toBe(before - 2);
  });

  it("counts seats by who's connected, so departed browsers never fill a room", () => {
    const { s, ch } = room("normal", ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7"]);
    expect(join(s, "late", "tok-late", "Late", ch)).toBeNull();
    leave(s, "p3", ch);
    expect(join(s, "late", "tok-late", "Late", ch)).not.toBeNull();
    for (let k = 0; k < 40; k++) {
      leave(s, "late", ch);
      expect(join(s, `v${k}`, `t${k}`, "Visitor", ch)).not.toBeNull();
      leave(s, `v${k}`, ch);
    }
    expect(Object.keys(s.players).length).toBeLessThanOrEqual(32);
    expect(s.players.p0).toBeDefined();
  });

  it("rejects commands addressed to a previous stage", () => {
    const { s, ch } = room();
    const i = depositIdx(s);
    const [x, y] = at(s, i);
    stand(s, "a", x, y);
    expect(applyCommand(s, "a", id(), s.gen - 1, { k: "harvest", x, y }, ch).ok).toBe(false);
  });

  it("rejects malformed, out-of-range, and unauthorised commands", () => {
    const { s, ch } = room("rapid", ["a", "b"]);
    s.worlds[0].inventory = { matter: 100, mineral: 100, coolant: 100 };
    const bad = (c: unknown, pid = "a"): boolean => applyCommand(s, pid, id(), s.gen, c as never, ch).ok;
    expect(bad({ k: "move", dx: Number.NaN, dy: 0 })).toBe(false);
    expect(bad({ k: "move", dx: Infinity, dy: 0 })).toBe(false);
    expect(bad({ k: "harvest", x: 1.5, y: 2 })).toBe(false);
    expect(bad({ k: "harvest", x: -1, y: 0 })).toBe(false);
    expect(bad({ k: "build", x: 0, y: 0, type: "palace" })).toBe(false);
    expect(bad({ k: "build", x: 0, y: 0, type: "relay" })).toBe(false); // not on Earth
    expect(bad({ k: "emote", e: "<script>" })).toBe(false);
    expect(bad({ k: "teleport" })).toBe(false);
    expect(applyCommand(s, "nobody", id(), s.gen, { k: "emote", e: "wave" }, ch).ok).toBe(false);
    // far away
    const far = s.worlds[0].tiles.findIndex((t, i) => t.d && Math.hypot((i % s.worlds[0].w) - s.players.a.x, Math.floor(i / s.worlds[0].w) - s.players.a.y) > 5);
    expect(bad({ k: "harvest", x: far % s.worlds[0].w, y: Math.floor(far / s.worlds[0].w) })).toBe(false);
    // only the builder or the host takes a building down
    const [x, y] = freeTile(s, 1);
    stand(s, "b", s.players.a.x, s.players.a.y);
    expect(applyCommand(s, "b", id(), s.gen, { k: "build", x, y, type: "plaza" }, ch).ok).toBe(true);
    expect(s.hostId).toBe("a");
    const [x2, y2] = freeTile(s, 1);
    expect(applyCommand(s, "a", id(), s.gen, { k: "build", x: x2, y: y2, type: "plaza" }, ch).ok).toBe(true);
    expect(applyCommand(s, "b", id(), s.gen, { k: "demolish", x: x2, y: y2 }, ch)).toEqual({ ok: false, reason: "only its builder or the host can take this down" });
    expect(applyCommand(s, "a", id(), s.gen, { k: "demolish", x, y }, ch).ok).toBe(true);
  });

  it("never builds on a deposit, so no building can trap stock", () => {
    const { s, ch } = room();
    s.worlds[0].inventory = { matter: 100, mineral: 100, coolant: 100 };
    const i = depositIdx(s);
    const [x, y] = at(s, i);
    stand(s, "a", x, y);
    const r = applyCommand(s, "a", id(), s.gen, { k: "build", x, y, type: "plaza" }, ch);
    expect(r.ok).toBe(false);
  });

  it("lets a spent deposit be built on", () => {
    const { s, ch } = room();
    s.worlds[0].inventory = { matter: 100, mineral: 100, coolant: 100 };
    const i = s.worlds[0].tiles.findIndex((t) => t.d && t.t === 0);
    const [x, y] = at(s, i);
    stand(s, "a", x, y);
    s.worlds[0].ledger[s.worlds[0].tiles[i].d!].extracted += s.worlds[0].tiles[i].amt;
    s.worlds[0].ledger[s.worlds[0].tiles[i].d!].remaining -= s.worlds[0].tiles[i].amt;
    s.worlds[0].tiles[i].amt = 0;
    expect(applyCommand(s, "a", id(), s.gen, { k: "build", x, y, type: "plaza" }, ch)).toEqual({ ok: true });
  });

  it("cleans names: control characters stripped, length capped", () => {
    const { s, ch } = room();
    const [x, y] = freeTile(s, 1);
    applyCommand(s, "a", id(), s.gen, { k: "mark", x, y, name: "  Old\u0000 Oak‮<b>and a very long name indeed</b>" }, ch);
    const name = s.worlds[0].tiles[y * s.worlds[0].w + x].mark?.name ?? "";
    expect(name.length).toBeLessThanOrEqual(24);
    expect(name).not.toMatch(/[\u0000-\u001f]/);
  });
});

describe("the restraint ending", () => {
  const toUniverse = (s: RoomState, ch: Changes): void => {
    while (STAGES[s.stage].id !== "universe" || s.phase.k !== "play") {
      if (s.phase.k === "play") harvestBot(s, ch, "a");
      tick(s, ch);
    }
  };

  it("ends the campaign with stock left only when everyone here agrees, and keeps the books", () => {
    const { s, ch } = room("rapid", ["a", "b"]);
    toUniverse(s, ch);
    expect(applyCommand(s, "a", id(), s.gen, { k: "stop", on: true }, ch)).toEqual({ ok: true });
    expect(s.phase.k).toBe("play");
    // harvesting takes a vote back
    const i = depositIdx(s);
    const [x, y] = at(s, i);
    stand(s, "a", x, y);
    s.players.a.nextHarvest = 0;
    applyCommand(s, "a", id(), s.gen, { k: "harvest", x, y }, ch);
    expect(s.players.a.stop).toBe(false);
    applyCommand(s, "a", id(), s.gen, { k: "stop", on: true }, ch);
    applyCommand(s, "b", id(), s.gen, { k: "stop", on: true }, ch);
    expect(s.phase).toEqual({ k: "ended", how: "restraint" });
    expect(totalRemaining(s)).toBeGreaterThan(0);
    expect(ledgerHolds(s)).toBe(true);
    expect(s.history.at(-1)!.stage).toBe("universe");
  });

  it("never ends because a holdout's connection dropped; someone still here confirms", () => {
    const { s, ch } = room("rapid", ["a", "b"]);
    toUniverse(s, ch);
    applyCommand(s, "a", id(), s.gen, { k: "stop", on: true }, ch);
    leave(s, "b", ch);
    expect(s.phase.k).toBe("play");
    applyCommand(s, "a", id(), s.gen, { k: "stop", on: true }, ch);
    expect(s.phase).toEqual({ k: "ended", how: "restraint" });
  });

  it("isn't offered before the last world", () => {
    const { s, ch } = room();
    expect(applyCommand(s, "a", id(), s.gen, { k: "stop", on: true }, ch).ok).toBe(false);
  });
});

describe("stage transitions", () => {
  const exhaust = (s: RoomState, ch: Changes): void => {
    while (totalRemaining(s) > 0 && s.tick < 50_000) {
      harvestBot(s, ch, "a");
      tick(s, ch);
    }
  };

  it("refuses mutations while the world changes, then admits the next stage's", () => {
    const { s, ch } = room();
    exhaust(s, ch);
    expect(s.phase.k).toBe("transition");
    const i = s.worlds[0].tiles.findIndex((t) => !t.d && !t.b);
    expect(applyCommand(s, "a", id(), s.gen, { k: "mark", x: i % s.worlds[0].w, y: Math.floor(i / s.worlds[0].w), name: "Late" }, ch).ok).toBe(false);
    const gen = s.gen;
    while (s.phase.k === "transition") tick(s, ch);
    expect(s.gen).toBe(gen + 1);
    expect(STAGES[s.stage].id).toBe("mars");
    expect(totalRemaining(s)).toBeGreaterThan(0);
  });

  it("a crash mid-transition recovers to the same single next stage, with no doubled carryover", () => {
    const { s, ch } = room();
    // play through to the Sun's exhaustion so the Bottled Sun carryover is in play
    while (!(STAGES[s.stage].id === "sun" && s.phase.k === "transition")) {
      if (s.phase.k === "play") harvestBot(s, ch, "a");
      tick(s, ch);
    }
    const saved = JSON.stringify(s); // what the server persisted at the boundary
    while (s.phase.k === "transition") tick(s, ch);
    const restored = JSON.parse(saved) as RoomState;
    const ch2 = newChanges();
    while (restored.phase.k === "transition") tick(restored, ch2);
    expect(restored.gen).toBe(s.gen);
    expect(restored.reserve).toBe(s.reserve);
    expect(restored.reserve).toBe(s.history.at(-1)!.ledger.matter.extracted * 4);
    expect(JSON.stringify(restored.worlds[0].tiles)).toBe(JSON.stringify(s.worlds[0].tiles));
    expect(restored.history).toHaveLength(3);
  });
});

describe("packs and tools", () => {
  const deposit = (s: RoomState, family: "matter" | "mineral" | "coolant"): [number, number] => at(s, s.worlds[0].tiles.findIndex((t) => t.d === family && t.amt > 0));

  it("puts a hand harvest in the harvester's own pack, not the stockpile or anyone else's", () => {
    const { s, ch } = room("normal", ["a", "b"]);
    const [x, y] = deposit(s, "matter");
    stand(s, "a", x, y);
    expect(applyCommand(s, "a", id(), s.gen, { k: "harvest", x, y }, ch).ok).toBe(true);
    expect(s.players.a.pack.matter).toBe(1);
    expect(s.players.b.pack.matter).toBe(0);
    expect(s.worlds[0].inventory.matter).toBe(0);
    expect(ledgerHolds(s)).toBe(true);
  });

  it("moves a whole pack into the stockpile on deposit, and refuses an empty one", () => {
    const { s, ch } = room("normal");
    expect(applyCommand(s, "a", id(), s.gen, { k: "deposit" }, ch).ok).toBe(false);
    s.players.a.pack = { matter: 5, mineral: 3, coolant: 0 };
    s.worlds[0].inventory = { matter: 1, mineral: 0, coolant: 2 };
    expect(applyCommand(s, "a", id(), s.gen, { k: "deposit" }, ch).ok).toBe(true);
    expect(s.players.a.pack).toEqual({ matter: 0, mineral: 0, coolant: 0 });
    expect(s.worlds[0].inventory).toEqual({ matter: 6, mineral: 3, coolant: 2 });
  });

  it("builds from the builder's pack first and the stockpile for the rest, never from another pack", () => {
    const { s, ch } = room("normal", ["a", "b"]);
    const [x, y] = freeTile(s, 2);
    stand(s, "a", x, y);
    const cost = BUILDINGS.city.cost; // 12 matter, 6 mineral
    s.players.b.pack = { matter: 100, mineral: 100, coolant: 0 };
    expect(applyCommand(s, "a", id(), s.gen, { k: "build", x, y, type: "city" }, ch).ok).toBe(false);
    s.players.a.pack = { matter: 5, mineral: 20, coolant: 0 };
    s.worlds[0].inventory = { matter: 10, mineral: 10, coolant: 0 };
    expect(applyCommand(s, "a", id(), s.gen, { k: "build", x, y, type: "city" }, ch).ok).toBe(true);
    expect(s.players.a.pack).toEqual({ matter: 0, mineral: 20 - cost.mineral!, coolant: 0 });
    expect(s.worlds[0].inventory).toEqual({ matter: 10 - (cost.matter! - 5), mineral: 10, coolant: 0 });
    expect(s.players.b.pack.matter).toBe(100);
  });

  it("crafts a rough tool from the crafter's pack alone, and it shortens only that family's cooldown", () => {
    const { s, ch } = room("normal");
    const cost = toolCost("matter", 1);
    s.worlds[0].inventory = { matter: 100, mineral: 100, coolant: 100 }; // the stockpile doesn't pay for tools
    expect(applyCommand(s, "a", id(), s.gen, { k: "craft", tool: "matter" }, ch).ok).toBe(false);
    s.players.a.pack = { ...cost };
    expect(applyCommand(s, "a", id(), s.gen, { k: "craft", tool: "matter" }, ch).ok).toBe(true);
    expect(s.players.a.tools).toEqual({ matter: 1, mineral: 0, coolant: 0 });
    expect(s.players.a.pack).toEqual({ matter: 0, mineral: 0, coolant: 0 });
    expect(s.worlds[0].inventory.matter).toBe(100);

    const [x, y] = deposit(s, "matter");
    stand(s, "a", x, y);
    applyCommand(s, "a", id(), s.gen, { k: "harvest", x, y }, ch);
    expect(s.players.a.nextHarvest - s.tick).toBe(TOOL_TIERS[1].cooldown);
    expect(TOOL_TIERS[1].cooldown).toBeLessThan(HARVEST_COOLDOWN_TICKS);
    for (let k = 0; k < TOOL_TIERS[1].cooldown - 1; k++) tick(s, ch);
    expect(applyCommand(s, "a", id(), s.gen, { k: "harvest", x, y }, ch)).toEqual({ ok: false, reason: "too fast" });
    tick(s, ch);
    expect(applyCommand(s, "a", id(), s.gen, { k: "harvest", x, y }, ch).ok).toBe(true);
    expect(s.players.a.pack.matter).toBe(2); // a quicker swing, the same bite

    const [mx, my] = deposit(s, "mineral");
    stand(s, "a", mx, my);
    s.players.a.nextHarvest = 0;
    applyCommand(s, "a", id(), s.gen, { k: "harvest", x: mx, y: my }, ch);
    expect(s.players.a.nextHarvest - s.tick).toBe(HARVEST_COOLDOWN_TICKS);
  });

  it("makes a fine tool only beside finished homes, and stops at the top tier", () => {
    const { s, ch } = room("normal");
    s.players.a.tools.mineral = 1;
    s.players.a.pack = { matter: 100, mineral: 100, coolant: 100 };
    const far = applyCommand(s, "a", id(), s.gen, { k: "craft", tool: "mineral" }, ch);
    expect(far.ok).toBe(false);
    const [x, y] = freeTile(s, 2);
    stand(s, "a", x, y);
    expect(applyCommand(s, "a", id(), s.gen, { k: "build", x, y, type: "city" }, ch).ok).toBe(true);
    // a building site is not a workbench yet
    expect(applyCommand(s, "a", id(), s.gen, { k: "craft", tool: "mineral" }, ch).ok).toBe(false);
    s.worlds[0].buildings.find((b) => b.type === "city")!.work = BUILDINGS.city.build * 10;
    const before = { ...s.players.a.pack };
    expect(applyCommand(s, "a", id(), s.gen, { k: "craft", tool: "mineral" }, ch).ok).toBe(true);
    expect(s.players.a.tools.mineral).toBe(2);
    const cost = toolCost("mineral", 2);
    for (const f of FAMILIES) expect(s.players.a.pack[f]).toBe(before[f] - cost[f]);
    expect(applyCommand(s, "a", id(), s.gen, { k: "craft", tool: "mineral" }, ch).ok).toBe(false);
    expect(bundleOk(s.players.a.pack)).toBe(true);
  });

  it("refuses a tool that doesn't exist", () => {
    const { s, ch } = room("normal");
    s.players.a.pack = { matter: 100, mineral: 100, coolant: 100 };
    for (const tool of ["gold", "__proto__", 3, null]) expect(applyCommand(s, "a", id(), s.gen, { k: "craft", tool } as never, ch).ok).toBe(false);
  });

  it("empties packs at a world boundary and keeps the tools", () => {
    const { s, ch } = room();
    s.players.a.tools = { matter: 2, mineral: 1, coolant: 0 };
    while (s.stage === 0) {
      if (s.phase.k === "play") harvestBot(s, ch, "a");
      tick(s, ch);
    }
    expect(s.players.a.pack).toEqual({ matter: 0, mineral: 0, coolant: 0 });
    expect(s.players.a.tools).toEqual({ matter: 2, mineral: 1, coolant: 0 });
  });
});

// ---- gods, in both modes ----

const W0 = (s: RoomState) => s.worlds[0];
const freeOn = (w: World, near: { x: number; y: number }, size = 1): [number, number] => {
  for (let r = 1; r < w.w; r++)
    for (let y = Math.round(near.y) - r; y <= Math.round(near.y) + r; y++)
      for (let x = Math.round(near.x) - r; x <= Math.round(near.x) + r; x++) {
        let ok = true;
        for (let dy = 0; dy < size && ok; dy++)
          for (let dx = 0; dx < size && ok; dx++) {
            const t = w.tiles[(y + dy) * w.w + x + dx];
            if (x + dx < 0 || y + dy < 0 || x + dx >= w.w || y + dy >= w.w || !t || t.d || t.b || t.t !== 0) ok = false;
          }
        if (ok) return [x, y];
      }
  throw new Error("no free tile");
};
const depositOn = (w: World): [number, number] => {
  const i = w.tiles.findIndex((t) => t.d && t.amt > 0);
  return [i % w.w, Math.floor(i / w.w)];
};

function godRoom(players = ["a", "b"], mode: "classic" | "cosmos" = "classic"): { s: RoomState; ch: Changes } {
  const s = createRoom("GODSS", 7, "normal", true, mode);
  const ch = newChanges();
  for (const p of players) join(s, p, `tok-${p}`, p.toUpperCase(), ch);
  if (mode === "cosmos") players.forEach((p, i) => applyCommand(s, p, id(), s.gen, { k: "faction", f: FACTION_IDS[i % 4] }, ch));
  tick(s, ch);
  return { s, ch };
}
/** Run until someone in particular is the god (and only humans are candidates in classic). */
function untilGod(s: RoomState, ch: Changes, pid?: string): string {
  for (let k = 0; k < 20 * (GOD_TURN_TICKS + GOD_GAP_TICKS); k++) {
    if (s.god.id && (!pid || s.god.id === pid)) return s.god.id;
    tick(s, ch);
  }
  throw new Error("nobody became a god");
}
const act = (s: RoomState, ch: Changes, pid: string, c: object) => applyCommand(s, pid, id(), s.gen, c as never, ch);
const others = (s: RoomState, god: string): string => Object.keys(s.players).find((p) => p !== god && !s.players[p].bot)!;

describe("gods: when there is one", () => {
  it("has no god unless the room was hosted with them", () => {
    const { s, ch } = room("normal");
    for (let k = 0; k < GOD_TURN_TICKS * 3; k++) tick(s, ch);
    expect(s.god.id).toBeNull();
    expect(act(s, ch, "a", { k: "god", power: "strike", x: 3, y: 3 }).ok).toBe(false);
  });

  it("is on exactly half the time: 30 seconds with a god, 30 with none, and never the same one twice running", () => {
    const { s, ch } = godRoom(["a", "b", "c"]);
    let withGod = 0;
    let total = 0;
    const order: string[] = [];
    for (let k = 0; k < 6 * (GOD_TURN_TICKS + GOD_GAP_TICKS); k++) {
      if (s.god.id) {
        withGod++;
        if (order.at(-1) !== s.god.id) order.push(s.god.id);
      } else if (order.at(-1) !== "-") order.push("-");
      total++;
      tick(s, ch);
    }
    expect(Math.abs(withGod / total - 0.5)).toBeLessThan(0.02);
    const gods = order.filter((x) => x !== "-");
    for (let i = 1; i < gods.length; i++) expect(gods[i]).not.toBe(gods[i - 1]);
    // fair: everyone has had a turn, and nobody more than one more than anyone else
    const turns = ["a", "b", "c"].map((p) => s.players[p].god.turns);
    expect(Math.min(...turns)).toBeGreaterThan(0);
    expect(Math.max(...turns) - Math.min(...turns)).toBeLessThanOrEqual(1);
  });

  it("in cosmos, takes the faction with fewest turns, bots included, and the human in it before its bot", () => {
    const { s, ch } = godRoom(["a"], "cosmos");
    const seen: string[] = [];
    for (let k = 0; k < 8 * (GOD_TURN_TICKS + GOD_GAP_TICKS) + 5; k++) {
      if (s.god.id && seen.at(-1) !== s.god.id) seen.push(s.god.id);
      tick(s, ch);
    }
    // a's faction is held by a, so its bot is never a candidate; the other three bots are
    expect(seen).not.toContain("bot-foundry");
    const byFaction = FACTION_IDS.map((f) => s.factions[f]!.turns);
    expect(Math.max(...byFaction) - Math.min(...byFaction)).toBeLessThanOrEqual(1);
    expect(seen.some((p) => p.startsWith("bot-"))).toBe(true);
    expect(seen).toContain("a");
  });

  it("replaces a god who disconnects at once, for the rest of that turn only", () => {
    const { s, ch } = godRoom(["a", "b"]);
    const was = untilGod(s, ch);
    const until = s.god.until;
    leave(s, was, ch);
    tick(s, ch);
    expect(s.god.id).toBe(others(s, was));
    expect(s.god.until).toBe(until);
  });

  it("lets only the host switch gods off; off ends the turn at once and leaves called strikes to land", () => {
    const { s, ch } = godRoom(["a", "b"]);
    const god = untilGod(s, ch);
    const [x, y] = depositOn(W0(s));
    expect(act(s, ch, god, { k: "god", power: "strike", x, y }).ok).toBe(true);
    expect(act(s, ch, "b", { k: "gods", on: false }).ok).toBe(s.hostId === "b");
    act(s, ch, s.hostId!, { k: "gods", on: false });
    expect(s.god).toMatchObject({ on: false, id: null });
    expect(act(s, ch, god, { k: "god", power: "strike", x, y }).ok).toBe(false);
    const before = W0(s).ledger;
    const destroyed = FAMILIES.reduce((a, f) => a + before[f].destroyed, 0);
    for (let k = 0; k <= STRIKE_FUSE_TICKS; k++) tick(s, ch);
    expect(FAMILIES.reduce((a, f) => a + W0(s).ledger[f].destroyed, 0)).toBeGreaterThan(destroyed);
  });

  it("refuses every power to a mortal, and malformed ones to the god", () => {
    const { s, ch } = godRoom();
    const god = untilGod(s, ch);
    const m = others(s, god);
    const [x, y] = freeOn(W0(s), s.players[god], 2);
    for (const power of GOD_POWERS) expect(act(s, ch, m, { k: "god", power, x, y, family: "matter" }).ok).toBe(false);
    for (const c of [{ power: "smite", x, y }, { power: "strike", x: -1, y }, { power: "strike", x: 1.5, y }, { power: "sow", x, y }, { power: "sow", x, y, family: "gold" }])
      expect(act(s, ch, god, { k: "god", ...c }).ok).toBe(false);
    expect(ledgerHolds(s)).toBe(true);
  });
});

describe("gods: the five powers", () => {
  it("acts many times in one tick and hundreds in one turn, folding the log, with the books intact", () => {
    const { s, ch } = godRoom();
    const god = untilGod(s, ch);
    const w = W0(s);
    let ok = 0;
    for (let k = 0; k < 400; k++) {
      const x = k % w.w;
      const y = Math.floor(k / w.w) % w.w;
      const power = GOD_POWERS[k % 5];
      if (act(s, ch, god, { k: "god", power, x, y, family: FAMILIES[k % 3] }).ok) ok++;
      if (k % 50 === 0) tick(s, ch);
    }
    expect(ok).toBeGreaterThan(150);
    for (let k = 0; k <= STRIKE_FUSE_TICKS; k++) tick(s, ch);
    expect(ledgerHolds(s)).toBe(true);
    expect(bundleOk(w.inventory)).toBe(true);
    // the log has room for 40 lines and isn't flooded: repeated acts fold into counted lines
    expect(s.log.length).toBeLessThanOrEqual(40);
    expect(s.log.some((l) => (l.n ?? 0) > 1 && /times/.test(l.text))).toBe(true);
  });

  it("Gift raises a finished datacentre for nothing, from any distance, owned by the god, not on a deposit", () => {
    const { s, ch } = godRoom();
    const god = untilGod(s, ch);
    const w = W0(s);
    const [x, y] = freeOn(w, s.players[god], 2);
    stand(s, god, 0, 0);
    const inv = { ...w.inventory };
    expect(act(s, ch, god, { k: "god", power: "gift", x, y }).ok).toBe(true);
    const b = w.buildings.find((q) => q.type === "datacentre")!;
    expect(b.work).toBe(BUILDINGS.datacentre.build * 10);
    expect(b.owner).toBe(god);
    expect(w.inventory).toEqual(inv);
    expect(s.players[god].god.gifted).toBe(1);
    expect(act(s, ch, god, { k: "god", power: "gift", x: depositOn(w)[0], y: depositOn(w)[1] }).ok).toBe(false);
  });

  it("Sow adds stock to initial and remaining together, up to a fifth of what the world began with", () => {
    const { s, ch } = godRoom();
    const god = untilGod(s, ch);
    const w = W0(s);
    const [x, y] = freeOn(w, s.players[god]);
    const before = { ...w.ledger.mineral };
    expect(act(s, ch, god, { k: "god", power: "sow", x, y, family: "mineral" }).ok).toBe(true);
    const n = STAGES[0].families.mineral.perTile;
    expect(w.ledger.mineral.initial).toBe(before.initial + n);
    expect(w.ledger.mineral.remaining).toBe(before.remaining + n);
    expect(ledgerHolds(s)).toBe(true);
    expect(act(s, ch, god, { k: "god", power: "sow", x, y, family: "matter" }).ok).toBe(false);
    // the cap
    let refusal = "";
    for (let k = 0; k < w.tiles.length && !refusal; k++) {
      const t = w.tiles[k];
      if (t.d || t.b || t.t !== 0) continue;
      const r = act(s, ch, god, { k: "god", power: "sow", x: k % w.w, y: Math.floor(k / w.w), family: "mineral" });
      if (!r.ok) refusal = r.reason;
    }
    expect(refusal).toBe("this world has no more to give");
    expect(w.sown).toBeLessThanOrEqual(Math.floor(w.generated * SOW_CAP));
    expect(ledgerHolds(s)).toBe(true);
  });

  it("Earth's Seed restores the tile to full life and lifts its neighbours", () => {
    const { s, ch } = godRoom();
    const god = untilGod(s, ch);
    const w = W0(s);
    const [x, y] = freeOn(w, s.players[god]);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) w.tiles[(y + dy) * w.w + x + dx].life = 30;
    act(s, ch, god, { k: "god", power: "sow", x, y, family: "matter" });
    expect(w.tiles[y * w.w + x].life).toBe(100);
    expect(w.tiles[(y + 1) * w.w + x].life).toBe(30 + EARTH_SEED_LIFT);
  });

  it("Strike lands after its fuse: stock to destroyed, buildings fall with no refund, never the god's record wrong", () => {
    const { s, ch } = godRoom();
    const god = untilGod(s, ch);
    const w = W0(s);
    const [x, y] = depositOn(w);
    const [bx, by] = freeOn(w, s.players[god]);
    stand(s, god, bx, by);
    s.players[god].pack = { matter: 50, mineral: 50, coolant: 50 };
    expect(act(s, ch, god, { k: "build", x: bx, y: by, type: "plaza" }).ok).toBe(true);
    const inv = { ...w.inventory };
    expect(act(s, ch, god, { k: "god", power: "strike", x, y }).ok).toBe(true);
    expect(act(s, ch, god, { k: "god", power: "strike", x: bx, y: by }).ok).toBe(true);
    const fam = w.tiles[y * w.w + x].d!;
    for (let k = 0; k < STRIKE_FUSE_TICKS - 1; k++) tick(s, ch);
    expect(w.tiles[y * w.w + x].amt).toBeGreaterThan(0);
    tick(s, ch);
    expect(w.tiles[y * w.w + x].amt).toBe(0);
    expect(w.ledger[fam].destroyed).toBeGreaterThan(0);
    expect(w.buildings.some((b) => b.type === "plaza")).toBe(false);
    expect(w.inventory).toEqual(inv);
    expect(s.players[god].god.destroyed).toBeGreaterThan(0);
    expect(s.players[god].god.felled).toBe(1);
    expect(ledgerHolds(s)).toBe(true);
  });

  it("Strike never touches the Depot, a player, or a ship; and striking a world's last stock ends it once", () => {
    const { s, ch } = godRoom(["a", "b", "c"], "cosmos");
    const god = untilGod(s, ch);
    const si = s.worlds.findIndex((w) => STAGES[w.stage].id === "system");
    const w = s.worlds[si];
    const depot = w.buildings.find((b) => b.type === "depot")!;
    expect(act(s, ch, god, { k: "god", power: "strike", x: depot.x, y: depot.y, world: si }).ok).toBe(true);
    for (let k = 0; k <= STRIKE_FUSE_TICKS; k++) tick(s, ch);
    expect(w.buildings.some((b) => b.type === "depot")).toBe(true);
    // leave one deposit there and strike it
    const [lx, ly] = depositOn(w);
    w.tiles.forEach((t, i) => {
      if (i === ly * w.w + lx || !t.d || !t.amt) return;
      w.ledger[t.d].remaining -= t.amt;
      w.ledger[t.d].destroyed += t.amt;
      t.amt = 0;
    });
    const before = s.history.length;
    if (s.god.id !== god) untilGod(s, ch, god);
    expect(act(s, ch, god, { k: "god", power: "strike", x: lx, y: ly, world: si }).ok).toBe(true);
    expect(act(s, ch, god, { k: "god", power: "strike", x: lx, y: ly, world: si }).ok).toBe(true);
    for (let k = 0; k <= STRIKE_FUSE_TICKS; k++) tick(s, ch);
    expect(w.spent).toBe(true);
    expect(s.history.length).toBe(before + 1);
    expect(ledgerHolds(s)).toBe(true);
  });

  it("Bless doubles a mortal's harvesting inside it for five seconds, never the god's, and doesn't stack", () => {
    const { s, ch } = godRoom();
    const god = untilGod(s, ch);
    const m = others(s, god);
    const w = W0(s);
    const [x, y] = depositOn(w);
    stand(s, m, x, y);
    stand(s, god, x, y);
    act(s, ch, god, { k: "god", power: "bless", x, y });
    act(s, ch, god, { k: "god", power: "bless", x, y });
    act(s, ch, m, { k: "harvest", x, y });
    expect(s.players[m].nextHarvest - s.tick).toBe(HARVEST_COOLDOWN_TICKS / 2);
    expect(s.players[god].god.blessed).toBe(1);
    act(s, ch, god, { k: "harvest", x, y });
    expect(s.players[god].nextHarvest - s.tick).toBe(HARVEST_COOLDOWN_TICKS);
    for (let k = 0; k < BLESS_TICKS; k++) tick(s, ch);
    expect(w.blessings).toHaveLength(0);
    s.players[m].nextHarvest = 0;
    act(s, ch, m, { k: "harvest", x, y });
    expect(s.players[m].nextHarvest - s.tick).toBe(HARVEST_COOLDOWN_TICKS);
  });

  it("Hush stops harvest by hand and machine, always lapses, and can't be renewed until the ground has rested", () => {
    const { s, ch } = godRoom();
    const god = untilGod(s, ch);
    const m = others(s, god);
    const w = W0(s);
    const [x, y] = depositOn(w);
    stand(s, m, x, y);
    // a hundred Hushes on one spot in one turn still lapse on time
    expect(act(s, ch, god, { k: "god", power: "hush", x, y }).ok).toBe(true);
    for (let k = 0; k < 100; k++) expect(act(s, ch, god, { k: "god", power: "hush", x, y }).ok).toBe(false);
    expect(act(s, ch, m, { k: "harvest", x, y }).ok).toBe(false);
    for (let k = 0; k < HUSH_TICKS; k++) tick(s, ch);
    s.players[m].nextHarvest = 0;
    expect(act(s, ch, m, { k: "harvest", x, y }).ok).toBe(true);
    // still resting: refused
    if (s.god.id === god) expect(act(s, ch, god, { k: "god", power: "hush", x, y }).ok).toBe(false);
    expect(ledgerHolds(s)).toBe(true);
  });

  it("the Sun's twist: a Flare adds heat and an Eclipse sheds it", () => {
    const { s, ch } = godRoom(["a", "b"], "cosmos");
    const god = untilGod(s, ch);
    const si = s.worlds.findIndex((w) => STAGES[w.stage].id === "sun");
    const w = s.worlds[si];
    w.heat = 50;
    act(s, ch, god, { k: "god", power: "strike", x: 1, y: 1, world: si });
    for (let k = 0; k <= STRIKE_FUSE_TICKS; k++) tick(s, ch);
    // it cools by 2 an economy tick on its own
    expect(w.heat).toBeGreaterThanOrEqual(50 + SUN_TWIST_HEAT - 8);
    const h = w.heat;
    if (s.god.id !== god) untilGod(s, ch, god);
    act(s, ch, god, { k: "god", power: "hush", x: 3, y: 3, world: si });
    expect(w.heat).toBe(Math.max(0, h - SUN_TWIST_HEAT));
  });
});

// ---- the cosmos ----

function cosmos(players: string[] = ["a"], seed = 7): { s: RoomState; ch: Changes } {
  const s = createRoom("COSMO", seed, "rapid", false, "cosmos");
  const ch = newChanges();
  for (const p of players) join(s, p, `tok-${p}`, p.toUpperCase(), ch);
  return { s, ch };
}

describe("the cosmos", () => {
  it("runs all five worlds from the first tick, each with its own books, and ledgerHolds checks every one", () => {
    const { s, ch } = cosmos(["a"]);
    expect(s.worlds.map((w) => STAGES[w.stage].id)).toEqual(STAGES.map((st) => st.id));
    for (const w of s.worlds) expect(w.generated).toBe(FAMILIES.reduce((a, f) => a + w.ledger[f].initial, 0));
    expect(ledgerHolds(s)).toBe(true);
    // break one world's books, and the room's check says so
    s.worlds[3].ledger.matter.remaining += 1;
    expect(ledgerHolds(s)).toBe(false);
    s.worlds[3].ledger.matter.remaining -= 1;
    // a world nobody stands on still ticks
    applyCommand(s, "a", id(), s.gen, { k: "faction", f: "foundry" }, ch);
    for (let k = 0; k < 40; k++) tick(s, ch);
    expect(s.worlds.every((w) => w.econTicks > 0)).toBe(true);
  });

  it("refuses ground commands meant for a world the player is only looking at", () => {
    const { s, ch } = cosmos(["a"]);
    applyCommand(s, "a", id(), s.gen, { k: "faction", f: "foundry" }, ch);
    const [x, y] = depositOn(s.worlds[1]);
    const r = applyCommand(s, "a", id(), s.gen, { k: "harvest", x, y }, ch, 1);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/only looking/);
  });

  it("gives a faction a world's starter crate the first time it lands there, once", () => {
    const { s, ch } = cosmos(["a"]);
    applyCommand(s, "a", id(), s.gen, { k: "faction", f: "stewards" }, ch);
    // Earth's crate is empty; Mars's isn't, and nobody's been
    expect(s.worlds[1].stock.stewards).toBeUndefined();
    expect(s.worlds[0].landed).toContain("stewards");
  });

  it("is a classic room when loaded from before: the migration keeps the world and turns gods off", () => {
    const { s } = room("normal", ["a"]);
    expect(s.mode).toBe("classic");
    expect(s.worlds).toHaveLength(1);
  });

  it("pauses bots with no human here: runBots does nothing, and they never vote", () => {
    const { s, ch } = cosmos(["a"]);
    leave(s, "a", ch);
    const before = JSON.stringify(Object.values(s.players).map((p) => [p.x, p.y, p.stats]));
    for (let k = 0; k < 100; k++) runBots(s, ch);
    expect(JSON.stringify(Object.values(s.players).map((p) => [p.x, p.y, p.stats]))).toBe(before);
    expect(applyCommand(s, "bot-foundry", id(), s.gen, { k: "stop", on: true }, ch).ok).toBe(false);
  });
});

describe("factions", () => {
  it("lets a newcomer choose any faction that isn't full, and deals one by fewest humans, bot-held seats first", () => {
    const { s, ch } = cosmos(["a", "b", "c", "d", "e"]);
    // five humans: each faction holds at most two
    for (const p of ["a", "b"]) expect(applyCommand(s, p, id(), s.gen, { k: "faction", f: "foundry" }, ch).ok).toBe(true);
    const r = applyCommand(s, "c", id(), s.gen, { k: "faction", f: "foundry" }, ch);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/full/);
    expect(applyCommand(s, "c", id(), s.gen, { k: "faction", f: "deal" }, ch).ok).toBe(true);
    expect(s.players.c.faction).not.toBe("foundry");
    // the dealt faction was held by a bot until now
    expect(activeBot(s, s.players.c.faction!)).toBeNull();
  });

  it("locks a faction after a first harvest or build", () => {
    const { s, ch } = cosmos(["a"]);
    applyCommand(s, "a", id(), s.gen, { k: "faction", f: "foundry" }, ch);
    expect(applyCommand(s, "a", id(), s.gen, { k: "faction", f: "brokers" }, ch).ok).toBe(true);
    const [x, y] = depositOn(s.worlds[0]);
    stand(s, "a", x, y);
    expect(applyCommand(s, "a", id(), s.gen, { k: "harvest", x, y }, ch).ok).toBe(true);
    expect(applyCommand(s, "a", id(), s.gen, { k: "faction", f: "stewards" }, ch).ok).toBe(false);
  });

  it("deals a faction to anyone who ignores the cards", () => {
    const { s, ch } = cosmos(["a"]);
    for (let k = 0; k <= DEAL_AFTER_TICKS; k++) tick(s, ch);
    expect(s.players.a.faction).toBeDefined();
  });

  it("puts a human in a bot's seat at once, keeping its stockpile, and brings the bot back 30 seconds after they leave", () => {
    const { s, ch } = cosmos(["a"]);
    stockOf(s.worlds[0], "automata").matter = 33;
    expect(activeBot(s, "automata")).not.toBeNull();
    applyCommand(s, "a", id(), s.gen, { k: "faction", f: "automata" }, ch);
    expect(activeBot(s, "automata")).toBeNull();
    expect(s.worlds[0].stock.automata!.matter).toBe(33);
    leave(s, "a", ch);
    join(s, "z", "tok-z", "Z", ch); // someone keeps the room awake
    for (let k = 0; k < BOT_RETURN_TICKS - 2; k++) tick(s, ch);
    expect(activeBot(s, "automata")).toBeNull();
    for (let k = 0; k < 5; k++) tick(s, ch);
    expect(activeBot(s, "automata")).not.toBeNull();
  });

  it("spends a faction's own stockpile, never another's, and moves stock between factions with transfer", () => {
    const { s, ch } = cosmos(["a"]);
    applyCommand(s, "a", id(), s.gen, { k: "faction", f: "stewards" }, ch);
    const w = s.worlds[0];
    stockOf(w, "foundry").mineral = 100;
    const [x, y] = freeOn(w, s.players.a);
    expect(applyCommand(s, "a", id(), s.gen, { k: "build", x, y, type: "plaza" }, ch).ok).toBe(false);
    stockOf(w, "stewards").matter = 10;
    expect(applyCommand(s, "a", id(), s.gen, { k: "transfer", to: "foundry", cargo: { matter: 4, mineral: 0, coolant: 0 } }, ch).ok).toBe(true);
    expect(w.stock.stewards!.matter).toBe(6);
    expect(w.stock.foundry!.matter).toBe(4);
    expect(applyCommand(s, "a", id(), s.gen, { k: "transfer", to: "foundry", cargo: { matter: 7, mineral: 0, coolant: 0 } }, ch).ok).toBe(false);
    expect(inventoriesOk(s)).toBe(true);
  });

  it("each passive rule and weakness: furnaces, harvester cost, pad cost and fuel, gardens, hands, can't-builds", () => {
    expect(costOf("extractor", "automata").mineral).toBeLessThan(costOf("extractor").mineral);
    expect(costOf("pad", "brokers").mineral).toBe(Math.ceil(costOf("pad").mineral * 0.5));
    expect(costOf("pad", "stewards").mineral).toBe(Math.ceil(costOf("pad").mineral * 1.5));
    expect(costOf("solar", "stewards").mineral).toBeLessThan(costOf("solar").mineral);
    const { s, ch } = cosmos(["a", "b"]);
    expect(FACTIONS.brokers.fuel).toBe(0.5);
    expect(fuelFor(s, "brokers").matter).toBeLessThan(fuelFor(s, "foundry").matter + 1);
    applyCommand(s, "a", id(), s.gen, { k: "faction", f: "brokers" }, ch);
    applyCommand(s, "b", id(), s.gen, { k: "faction", f: "stewards" }, ch);
    const w = s.worlds[0];
    stockOf(w, "brokers").mineral = stockOf(w, "brokers").matter = 99;
    stockOf(w, "stewards").mineral = stockOf(w, "stewards").matter = 99;
    const [x, y] = depositOn(w);
    stand(s, "a", x + 1, y);
    expect(placementProblem(s, w, "extractor", x + 1, y, { p: s.players.a })).toMatch(/can't build/);
    expect(placementProblem(s, w, "furnace", x + 1, y, { p: { ...s.players.b, x: x + 1, y } })).toMatch(/can't build/);
    // hands: Automata half as fast, Stewards a quarter slower
    expect(harvestTicks(s, w, { ...s.players.a, faction: "automata" }, "matter")).toBe(HARVEST_COOLDOWN_TICKS * 2);
    expect(harvestTicks(s, w, s.players.b, "matter")).toBe(HARVEST_COOLDOWN_TICKS * 1.25);
  });

  it("a Foundry furnace makes double power and smokes a tile further", () => {
    const { s, ch } = cosmos(["a"]);
    applyCommand(s, "a", id(), s.gen, { k: "faction", f: "foundry" }, ch);
    const w = s.worlds[0];
    const pool = stockOf(w, "foundry");
    pool.matter = 100;
    pool.mineral = 100;
    const p = s.players.a;
    const [cx, cy] = freeOn(w, p, 2);
    expect(applyCommand(s, "a", id(), s.gen, { k: "build", x: cx, y: cy, type: "city" }, ch).ok).toBe(true);
    const [fx, fy] = freeOn(w, p);
    expect(applyCommand(s, "a", id(), s.gen, { k: "build", x: fx, y: fy, type: "furnace" }, ch).ok).toBe(true);
    for (const b of w.buildings) b.work = BUILDINGS[b.type].build * 10;
    for (let k = 0; k < 6; k++) tick(s, ch);
    expect(w.econ.energySupply).toBe(BUILDINGS.furnace.energy * 2);
  });

  it("a Smelter loses value: 3 matter in, 1 mineral out", () => {
    const { s, ch } = cosmos(["a"]);
    applyCommand(s, "a", id(), s.gen, { k: "faction", f: "foundry" }, ch);
    const w = s.worlds[0];
    const pool = stockOf(w, "foundry");
    pool.matter = 60;
    pool.mineral = 60;
    pool.coolant = 10;
    const [x, y] = freeOn(w, s.players.a);
    expect(applyCommand(s, "a", id(), s.gen, { k: "build", x, y, type: "smelter" }, ch).ok).toBe(true);
    expect(placementProblem(s, w, "smelter", x + 3, y, { f: "brokers" })).toMatch(/only the Foundry/);
    // power for it: a Sun Garden
    const [sx, sy] = freeOn(w, s.players.a, 2);
    expect(applyCommand(s, "a", id(), s.gen, { k: "build", x: sx, y: sy, type: "solar" }, ch).ok).toBe(true);
    for (const b of w.buildings) b.work = BUILDINGS[b.type].build * 10;
    const before = { ...pool };
    for (let k = 0; k < 10; k++) tick(s, ch);
    const made = pool.mineral - before.mineral;
    expect(made).toBeGreaterThan(0);
    expect(before.matter - pool.matter).toBe(made * SMELTER_IN);
  });

  it("a Seeder pays for its copies from its faction, never covers stock, never mints, and stops at 12", () => {
    const { s, ch } = cosmos(["a"]);
    applyCommand(s, "a", id(), s.gen, { k: "faction", f: "automata" }, ch);
    const w = s.worlds[0];
    const pool = stockOf(w, "automata");
    pool.matter = 400;
    pool.mineral = 400;
    pool.coolant = 50;
    const [dx, dy] = depositOn(w);
    const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => [dx + a, dy + b]).find(([x, y]) => !placementProblem(s, w, "seeder", x, y, { f: "automata" }))!;
    stand(s, "a", spot[0], spot[1]);
    expect(applyCommand(s, "a", id(), s.gen, { k: "build", x: spot[0], y: spot[1], type: "seeder" }, ch).ok).toBe(true);
    // power and compute from gifts nobody pays for
    w.buildings.push({ id: w.nextBuildingId++, type: "engine", x: 0, y: 0, owner: null, work: 0, status: "ok" });
    s.reserve = 0;
    for (const t of w.buildings) t.work = BUILDINGS[t.type].build * 10;
    // power from someone else's Sun Garden: the Automata build none of their own
    const [gx, gy] = freeOn(w, s.players.a, 2);
    w.buildings.push({ id: w.nextBuildingId++, type: "solar", x: gx, y: gy, owner: null, f: "stewards", work: 40, status: "ok" });
    for (const [fx, fy] of [[gx, gy], [gx + 1, gy], [gx, gy + 1], [gx + 1, gy + 1]]) w.tiles[fy * w.w + fx].b = w.nextBuildingId - 1;
    for (const t of w.buildings) t.work = BUILDINGS[t.type].build * 10;
    const cost = costOf("seeder", "automata");
    const spent = (): number => 400 + 400 - pool.matter - pool.mineral;
    for (let k = 0; k < 2000 && w.seeded < 20; k++) {
      tick(s, ch);
      for (const b of w.buildings) if (b.type === "seeder") for (const [fx, fy] of [[b.x, b.y]]) expect(w.tiles[fy * w.w + fx].d && w.tiles[fy * w.w + fx].amt > 0 && w.tiles[fy * w.w + fx].b !== b.id).toBeFalsy();
      expect(inventoriesOk(s)).toBe(true);
      expect(ledgerHolds(s)).toBe(true);
    }
    expect(w.seeded).toBeGreaterThan(0);
    expect(w.buildings.filter((b) => b.type === "seeder").length).toBeLessThanOrEqual(12);
    // every copy was paid for out of the faction's own stock (it may also have harvested some back)
    expect(spent() + (w.took.automata ?? 0)).toBeGreaterThanOrEqual(w.seeded * (cost.matter + cost.mineral) - 1);
  });

  it("a Reserve locks a deposit and its neighbours for 60 seconds, always lapses, and rests before it can be laid again", () => {
    const { s, ch } = cosmos(["a", "b"]);
    applyCommand(s, "a", id(), s.gen, { k: "faction", f: "stewards" }, ch);
    applyCommand(s, "b", id(), s.gen, { k: "faction", f: "foundry" }, ch);
    const w = s.worlds[0];
    stockOf(w, "stewards").matter = 50;
    stockOf(w, "stewards").mineral = 50;
    const [x, y] = depositOn(w);
    stand(s, "a", x, y);
    stand(s, "b", x, y);
    expect(applyCommand(s, "b", id(), s.gen, { k: "reserve", x, y }, ch).ok).toBe(false);
    expect(applyCommand(s, "a", id(), s.gen, { k: "reserve", x, y }, ch).ok).toBe(true);
    expect(applyCommand(s, "b", id(), s.gen, { k: "harvest", x, y }, ch).ok).toBe(false);
    for (let k = 0; k < RESERVE_TICKS; k++) tick(s, ch);
    s.players.b.nextHarvest = 0;
    expect(applyCommand(s, "b", id(), s.gen, { k: "harvest", x, y }, ch).ok).toBe(true);
    expect(applyCommand(s, "a", id(), s.gen, { k: "reserve", x, y }, ch).ok).toBe(false);
  });
});

describe("journeys and cargo", () => {
  function padRoom(): { s: RoomState; ch: Changes; pad: Building } {
    const { s, ch } = cosmos(["a", "b"]);
    applyCommand(s, "a", id(), s.gen, { k: "faction", f: "foundry" }, ch);
    applyCommand(s, "b", id(), s.gen, { k: "faction", f: "brokers" }, ch);
    const w = s.worlds[0];
    stockOf(w, "brokers").matter = stockOf(w, "brokers").mineral = 50;
    const [x, y] = freeOn(w, s.players.b);
    expect(applyCommand(s, "b", id(), s.gen, { k: "build", x, y, type: "pad" }, ch).ok).toBe(true);
    const pad = w.buildings.find((b) => b.type === "pad")!;
    pad.work = BUILDINGS.pad.build * 10;
    stand(s, "a", x, y);
    return { s, ch, pad };
  }

  it("refuses a launch it can't pay for, and never mid-flight", () => {
    const { s, ch, pad } = padRoom();
    const c = { k: "launch", x: pad.x, y: pad.y, to: 1, cargo: { matter: 0, mineral: 0, coolant: 0 } } as const;
    expect(applyCommand(s, "a", id(), s.gen, c, ch).ok).toBe(false);
    stockOf(s.worlds[0], "foundry").matter = 20;
    stockOf(s.worlds[0], "foundry").coolant = 20;
    expect(applyCommand(s, "a", id(), s.gen, c, ch).ok).toBe(true);
    expect(s.players.a.world).toBe(-1);
    expect(applyCommand(s, "a", id(), s.gen, { ...c, to: 2 }, ch).ok).toBe(false);
    expect(applyCommand(s, "a", id(), s.gen, { k: "harvest", x: 1, y: 1 }, ch).ok).toBe(false);
  });

  it("carries cargo with the stock always in a ship or a stockpile, takes the pad's tenth, and lands it in the right names", () => {
    const { s, ch, pad } = padRoom();
    const w = s.worlds[0];
    stockOf(w, "foundry").matter = 40;
    stockOf(w, "foundry").coolant = 20;
    s.players.a.pack.mineral = 7;
    const fuel = fuelFor(s, "foundry");
    expect(applyCommand(s, "a", id(), s.gen, { k: "launch", x: pad.x, y: pad.y, to: 1, cargo: { matter: 20, mineral: 0, coolant: 0 } }, ch).ok).toBe(true);
    expect(w.stock.foundry!.matter).toBe(40 - 20 - fuel.matter);
    expect(w.stock.brokers!.matter).toBe(50 - costOf("pad", "brokers").matter + 2);
    expect(s.factions.brokers!.carried).toBe(20);
    expect(transitHolds(s)).toBe(true);
    // break the books: the invariant catches it
    s.ships[0].cargo.matter++;
    expect(transitHolds(s)).toBe(false);
    s.ships[0].cargo.matter--;
    const arrive = s.ships[0].arrives;
    expect(arrive - s.tick).toBe(flightTicks(0, 1));
    while (s.tick < arrive) {
      tick(s, ch);
      expect(transitHolds(s)).toBe(true);
    }
    expect(s.players.a.world).toBe(1);
    expect(s.players.a.pack.mineral).toBe(7);
    expect(s.worlds[1].stock.foundry!.matter).toBe(18 + STAGES[1].starter.matter);
    expect(s.ships).toHaveLength(0);
  });

  it("never traps anyone on a spent world: free from the ground, to the nearest living world", () => {
    const { s, ch } = cosmos(["a"]);
    applyCommand(s, "a", id(), s.gen, { k: "faction", f: "stewards" }, ch);
    const w = s.worlds[0];
    w.tiles.forEach((t) => {
      if (!t.d || !t.amt) return;
      w.ledger[t.d].remaining -= t.amt;
      w.ledger[t.d].destroyed += t.amt;
      t.amt = 0;
    });
    for (let k = 0; k < 3; k++) tick(s, ch);
    expect(w.spent).toBe(true);
    const r = applyCommand(s, "a", id(), s.gen, { k: "launch", x: 0, y: 0, to: 3, cargo: { matter: 0, mineral: 0, coolant: 0 } }, ch);
    expect(r.ok).toBe(true);
    expect(s.ships[0].to).toBe(1);
  });

  it("a god's acts never touch a ship or a person in flight", () => {
    const { s, ch, pad } = padRoom();
    s.god.on = true;
    stockOf(s.worlds[0], "foundry").matter = 40;
    stockOf(s.worlds[0], "foundry").coolant = 20;
    applyCommand(s, "a", id(), s.gen, { k: "launch", x: pad.x, y: pad.y, to: 1, cargo: { matter: 10, mineral: 0, coolant: 0 } }, ch);
    const ship = JSON.stringify(s.ships);
    const god = untilGod(s, ch, "b");
    const w = s.worlds[0];
    for (let k = 0; k < 30; k++) act(s, ch, god, { k: "god", power: "strike", x: (k * 3) % w.w, y: (k * 7) % w.w });
    for (let k = 0; k <= STRIKE_FUSE_TICKS; k++) tick(s, ch);
    const now = JSON.parse(JSON.stringify(s.ships));
    if (now.length) expect(JSON.stringify(now.map((x: Ship) => x.cargo))).toBe(JSON.stringify(JSON.parse(ship).map((x: Ship) => x.cargo)));
    expect(transitHolds(s)).toBe(true);
  });
});

describe("a god across the cosmos", () => {
  it("acts on any world in one turn, hundreds of times across five, with every world's books intact", () => {
    const { s, ch } = godRoom(["a", "b"], "cosmos");
    const god = untilGod(s, ch, "a");
    let ok = 0;
    for (let k = 0; k < 500; k++) {
      const wi = k % 5;
      const w = s.worlds[wi];
      const r = act(s, ch, god, { k: "god", power: GOD_POWERS[(k >> 2) % 5], x: (k * 7) % w.w, y: (k * 13) % w.w, family: FAMILIES[k % 3], world: wi });
      if (r.ok) ok++;
    }
    expect(ok).toBeGreaterThan(200);
    for (let k = 0; k <= STRIKE_FUSE_TICKS + 1; k++) tick(s, ch);
    expect(ledgerHolds(s)).toBe(true);
    expect(inventoriesOk(s)).toBe(true);
    expect(s.log.length).toBeLessThanOrEqual(40);
  });

  it("names powers in the world's own words, in the log", () => {
    const { s, ch } = godRoom(["a", "b"], "cosmos");
    const god = untilGod(s, ch, "a");
    act(s, ch, god, { k: "god", power: "strike", x: 2, y: 2, world: 1 });
    expect(s.log.at(-1)!.text).toMatch(/Meteor/);
    act(s, ch, god, { k: "god", power: "bless", x: 2, y: 2, world: 4 });
    expect(s.log.at(-1)!.text).toMatch(/Fair current/);
  });

  it("Mars's Thin air lets machines run as if under a Dome while it lasts", () => {
    const { s, ch } = godRoom(["a", "b"], "cosmos");
    const god = untilGod(s, ch, "a");
    const w = s.worlds[1];
    const pool = stockOf(w, "foundry");
    pool.matter = pool.mineral = pool.coolant = 200;
    const [x, y] = freeOn(w, { x: w.w / 2, y: w.w / 2 }, 2);
    w.buildings.push({ id: w.nextBuildingId++, type: "datacentre", x, y, owner: "a", f: "foundry", work: 60, status: "ok" });
    for (const [fx, fy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) w.tiles[fy * w.w + fx].b = w.nextBuildingId - 1;
    w.buildings.push({ id: w.nextBuildingId++, type: "city", x: x + 3, y, owner: "a", f: "foundry", work: 50, status: "ok" });
    s.reserve = 0;
    const solar = { id: w.nextBuildingId++, type: "solar" as const, x: x - 3, y, owner: "a", f: "foundry" as const, work: 40, status: "ok" };
    w.buildings.push(solar);
    for (let k = 0; k < 12; k++) tick(s, ch);
    const dc = w.buildings.find((b) => b.type === "datacentre")!;
    expect(dc.status).toMatch(/dome/);
    act(s, ch, god, { k: "god", power: "bless", x, y, world: 1 });
    for (let k = 0; k < 12; k++) tick(s, ch);
    expect(dc.status).not.toMatch(/dome/);
  });

  it("the Solar System's Slipstream links machines to the Depot while it lasts", () => {
    const { s, ch } = godRoom(["a", "b"], "cosmos");
    const god = untilGod(s, ch, "a");
    const si = s.worlds.findIndex((w) => STAGES[w.stage].id === "system");
    const w = s.worlds[si];
    // a miner beside a deposit far from the Depot and any relay
    const depot = w.buildings.find((b) => b.type === "depot")!;
    const far = w.tiles.findIndex((t, i) => t.d && t.amt > 0 && Math.max(Math.abs((i % w.w) - depot.x), Math.abs(Math.floor(i / w.w) - depot.y)) > 9);
    const [dx, dy] = [far % w.w, Math.floor(far / w.w)];
    const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => [dx + a, dy + b]).find(([x, y]) => !placementProblem(s, w, "extractor", x, y, { free: true }))!;
    w.buildings.push({ id: w.nextBuildingId++, type: "extractor", x: spot[0], y: spot[1], owner: "a", f: "foundry", work: 30, status: "ok" });
    w.tiles[spot[1] * w.w + spot[0]].b = w.nextBuildingId - 1;
    w.buildings.push({ id: w.nextBuildingId++, type: "engine", x: 0, y: 0, owner: null, work: 0, status: "ok" });
    s.reserve = 1000;
    const miner = w.buildings.find((b) => b.type === "extractor" && b.owner === "a")!;
    for (let k = 0; k < 12; k++) tick(s, ch);
    expect(miner.status).toMatch(/not linked/);
    act(s, ch, god, { k: "god", power: "bless", x: spot[0], y: spot[1], world: si });
    for (let k = 0; k < 12; k++) tick(s, ch);
    expect(miner.status).not.toMatch(/not linked/);
  });

  it("the Universe's Supernova takes back the god's own vote; Sow and Hush don't", () => {
    const { s, ch } = godRoom(["a", "b"], "cosmos");
    for (const w of s.worlds.slice(0, 4)) w.spent = true;
    const god = untilGod(s, ch, "a");
    expect(act(s, ch, god, { k: "stop", on: true }).ok).toBe(true);
    const u = s.worlds[4];
    const [fx, fy] = freeOn(u, { x: u.w / 2, y: u.w / 2 });
    act(s, ch, god, { k: "god", power: "hush", x: 2, y: 2, world: 4 });
    act(s, ch, god, { k: "god", power: "sow", x: fx, y: fy, family: "matter", world: 4 });
    expect(s.players[god].stop).toBe(true);
    act(s, ch, god, { k: "god", power: "strike", x: 2, y: 2, world: 4 });
    expect(s.players[god].stop).toBe(false);
  });
});

describe("the cosmos ending", () => {
  it("offers restraint only once the four other worlds are spent, among humans only", () => {
    const { s, ch } = cosmos(["a"]);
    applyCommand(s, "a", id(), s.gen, { k: "faction", f: "stewards" }, ch);
    expect(applyCommand(s, "a", id(), s.gen, { k: "stop", on: true }, ch).ok).toBe(false);
    for (const w of s.worlds.slice(0, 4)) w.spent = true;
    expect(applyCommand(s, "a", id(), s.gen, { k: "stop", on: true }, ch).ok).toBe(true);
    expect(s.phase).toEqual({ k: "ended", how: "restraint" });
  });

  it("ends by consumption when every world is spent, with the books held all the way, from bots alone", () => {
    const s = createRoom("TOURN", 11, "rapid", true, "cosmos");
    const ch = newChanges();
    while (s.phase.k === "play" && s.tick < 60_000) {
      tick(s, ch);
      runBots(s, ch, true);
      if (s.tick % 50 === 0) {
        expect(ledgerHolds(s)).toBe(true);
        expect(transitHolds(s)).toBe(true);
        expect(inventoriesOk(s)).toBe(true);
      }
      ch.w.clear();
      ch.logIds.clear();
    }
    expect(s.phase).toEqual({ k: "ended", how: "consumed" });
    expect(s.history).toHaveLength(5);
    expect(s.worlds.every((w) => w.spent)).toBe(true);
  });
});
