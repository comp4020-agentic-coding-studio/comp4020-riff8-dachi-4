// The faction bots: a pure planner that takes a room, a player and a seeded
// generator and returns the commands a person playing that faction's doctrine
// might send next. The server runs it for every faction with no human, the
// tournament (spec/balance.test.ts) runs it headless, and scripts/playbot.ts
// runs it over a real socket. A bot is a normal player to the simulation:
// everything it decides goes through applyCommand like anyone's.
import { BUILDINGS, BUILD_RANGE, FACTIONS, FACTION_IDS, FAMILIES, HARVEST_RANGE, SHIP_CARGO, STAGES, BOT_EVERY_TICKS, type BuildingType, type FactionId, type Family } from "./content.ts";
import type { Command, Player, RoomState, World } from "./protocol.ts";
import {
  activeBot,
  applyCommand,
  buildable,
  costOf,
  fuelFor,
  humansHere,
  launchPlan,
  lockProblem,
  placementProblem,
  reserveProblem,
  sowProblem,
  stockOf,
  worldRemaining,
  type Changes,
} from "./sim.ts";
import { rng } from "./worldgen.ts";

/** What each faction builds on each world, in order, until it can't afford the next thing. */
const PLANS: Record<FactionId, Record<string, BuildingType[]>> = {
  foundry: {
    earth: ["city", "furnace", "pad", "extractor", "furnace", "smelter", "extractor", "city", "furnace", "extractor", "extractor", "datacentre"],
    mars: ["habitat", "solar", "city", "extractor", "smelter", "extractor", "habitat", "extractor"],
    sun: ["solar", "radiator", "city", "extractor", "extractor", "smelter", "radiator", "extractor", "extractor"],
    system: ["city", "relay", "relay", "extractor", "extractor", "smelter", "extractor"],
    universe: ["city", "extractor", "extractor", "smelter", "extractor"],
  },
  automata: {
    earth: ["city", "solar", "datacentre", "extractor", "seeder", "datacentre", "city", "extractor", "datacentre"],
    mars: ["habitat", "solar", "solar", "datacentre", "seeder", "datacentre", "habitat", "extractor"],
    sun: ["solar", "datacentre", "radiator", "seeder", "datacentre", "radiator", "extractor"],
    system: ["city", "datacentre", "relay", "relay", "seeder", "datacentre", "extractor"],
    universe: ["city", "datacentre", "datacentre", "seeder", "datacentre"],
  },
  brokers: {
    earth: ["pad", "city", "solar", "pad", "datacentre", "plaza"],
    mars: ["pad", "habitat", "solar", "city", "pad"],
    sun: ["pad", "solar", "city", "radiator", "pad"],
    system: ["pad", "city", "relay", "pad"],
    universe: ["pad", "city", "pad"],
  },
  stewards: {
    earth: ["solar", "city", "plaza", "solar", "datacentre"],
    mars: ["habitat", "solar", "city", "plaza"],
    sun: ["solar", "radiator", "city", "plaza"],
    system: ["city", "relay", "plaza"],
    universe: ["city", "plaza"],
  },
};

/** Where each faction would rather be, in order. */
const ROUTE: Record<FactionId, string[]> = {
  foundry: ["earth", "sun", "mars", "system", "universe"],
  automata: ["earth", "mars", "system", "universe", "sun"],
  brokers: ["earth", "mars", "sun", "system", "universe"],
  stewards: ["earth", "mars", "sun", "system", "universe"],
};

const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by);
const at = (w: World, i: number): [number, number] => [i % w.w, Math.floor(i / w.w)];
const done = (b: { type: BuildingType; work: number }): boolean => b.work >= BUILDINGS[b.type].build * 10;

/** Walk toward a tile: a move command, or a stop when close. */
const walk = (p: Player, x: number, y: number, close = 1.2): Extract<Command, { k: "move" }> | null => {
  const d = dist(p.x, p.y, x, y);
  if (d <= close) return p.dx || p.dy ? { k: "move", dx: 0, dy: 0 } : null;
  return { k: "move", dx: (x - p.x) / d, dy: (y - p.y) / d };
};

function nearestDeposit(s: RoomState, w: World, p: Player): number {
  let best = -1;
  let bd = Infinity;
  w.tiles.forEach((t, i) => {
    if (!t.d || t.amt <= 0 || lockProblem(w, i, s.tick)) return;
    const [x, y] = at(w, i);
    const d = dist(x, y, p.x, p.y);
    if (d < bd) [bd, best] = [d, i];
  });
  return best;
}

/** A tile within reach where this building would go, or null: beside stock for a harvester. */
function spotFor(s: RoomState, w: World, p: Player, type: BuildingType, r: () => number): [number, number] | null {
  const ok = (x: number, y: number): boolean => placementProblem(s, w, type, x, y, { p }) === null;
  if (type === "extractor" || type === "seeder") {
    const deps = w.tiles
      .map((t, i) => [t, i] as const)
      .filter(([t, i]) => t.d && t.amt > 0 && dist(...at(w, i), p.x, p.y) < BUILD_RANGE - 1)
      .sort((a, b) => dist(...at(w, a[1]), p.x, p.y) - dist(...at(w, b[1]), p.x, p.y));
    for (const [, i] of deps.slice(0, 12)) {
      const [x, y] = at(w, i);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) if (ok(x + dx, y + dy)) return [x + dx, y + dy];
    }
    return null;
  }
  const r0 = Math.floor(r() * 3);
  for (let rad = 1 + r0; rad < BUILD_RANGE - 1; rad++)
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + r();
      const x = Math.round(p.x + Math.cos(a) * rad);
      const y = Math.round(p.y + Math.sin(a) * rad);
      if (ok(x, y)) return [x, y];
    }
  return null;
}

/** The next thing on this faction's plan for this world that it hasn't built yet. */
function nextBuild(s: RoomState, w: World, f: FactionId): BuildingType | null {
  const plan = PLANS[f][STAGES[w.stage].id] ?? [];
  const can = buildable(s, w, f);
  const have = new Map<BuildingType, number>();
  for (const b of w.buildings) if (b.f === f) have.set(b.type, (have.get(b.type) ?? 0) + 1);
  const seen = new Map<BuildingType, number>();
  for (const t of plan) {
    seen.set(t, (seen.get(t) ?? 0) + 1);
    if (!can.includes(t)) continue;
    if ((have.get(t) ?? 0) < seen.get(t)!) return t;
  }
  // past the plan: more harvesters while there's stock, if this faction may build them
  if (worldRemaining(w) > 40) {
    if (f === "automata" && can.includes("seeder")) return "seeder";
    if (can.includes("extractor")) return "extractor";
  }
  return null;
}

/** Which world a faction's bot would go to next, if any is better than where it stands. */
function nextWorld(s: RoomState, p: Player, f: FactionId): number | null {
  const here = s.worlds[p.world];
  const frac = (w: World): number => {
    const total = FAMILIES.reduce((a, fam) => a + w.ledger[fam].initial, 0);
    return total ? worldRemaining(w) / total : 0;
  };
  if (f === "brokers") {
    // go where people are and no Broker pad stands yet
    const hasPad = (wi: number): boolean => s.worlds[wi].buildings.some((b) => b.type === "pad" && b.f === "brokers");
    if (!hasPad(p.world)) return null;
    const busy = s.worlds
      .map((w, wi) => [w, wi] as const)
      .filter(([w, wi]) => !w.spent && wi !== p.world && !hasPad(wi) && Object.values(s.players).some((q) => q.connected && q.world === wi && q.faction !== "brokers"));
    return busy.length ? busy[0][1] : null;
  }
  if (!here.spent && frac(here) > 0.3) return null;
  for (const id of ROUTE[f]) {
    const wi = s.worlds.findIndex((w) => STAGES[w.stage].id === id);
    if (wi >= 0 && wi !== p.world && !s.worlds[wi].spent && frac(s.worlds[wi]) > 0.3) return wi;
  }
  return null;
}

/** The commands a faction's bot sends next: at most one action, and a step. Pure: same state and dice, same answer. */
export function planBot(s: RoomState, pid: string, r: () => number): Command[] {
  const p = s.players[pid];
  if (!p || !p.faction || p.world < 0 || s.phase.k !== "play") return [];
  const f = p.faction;
  const w = s.worlds[p.world];
  const stock = w.stock[f] ?? { matter: 0, mineral: 0, coolant: 0 };
  const out: Command[] = [];

  // a spent world never traps anyone: leave from the ground, free
  if (w.spent) return [{ k: "launch", x: 0, y: 0, to: 0, cargo: { matter: 0, mineral: 0, coolant: 0 } }];

  // carry what's in the pack to the stockpile once it's worth the trip
  if (FAMILIES.reduce((a, fam) => a + p.pack[fam], 0) >= 12) return [{ k: "deposit" }];

  // move on, through a Pad, with as much cargo as can be spared
  const dest = nextWorld(s, p, f);
  if (dest !== null) {
    const pads = w.buildings.filter((b) => b.type === "pad" && done(b));
    // a Broker's Pad first, then anyone's: they're open to all
    pads.sort((a, b) => Number(b.f === "brokers") - Number(a.f === "brokers") || dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y));
    const pad = pads[0];
    if (pad) {
      const fuel = fuelFor(s, f);
      const cargo = { matter: 0, mineral: 0, coolant: 0 };
      let room = SHIP_CARGO;
      for (const fam of FAMILIES) {
        const spare = Math.max(0, Math.floor((stock[fam] - fuel[fam]) / 2));
        cargo[fam] = Math.min(spare, room);
        room -= cargo[fam];
      }
      const c = { k: "launch" as const, x: pad.x, y: pad.y, to: dest, cargo };
      const plan = launchPlan(s, p, c);
      if (plan.ok) return [{ k: "move", dx: 0, dy: 0 }, c];
      if (plan.reason.startsWith("stand beside")) {
        const m = walk(p, pad.x, pad.y, 1.5);
        if (m) return [m];
      }
    }
  }

  // build the next thing on the plan, if it can be afforded and placed
  const type = nextBuild(s, w, f);
  if (type) {
    const cost = costOf(type, f);
    const afford = FAMILIES.every((fam) => stock[fam] + p.pack[fam] >= cost[fam]);
    if (afford) {
      const spot = spotFor(s, w, p, type, r);
      if (spot) return [{ k: "move", dx: 0, dy: 0 }, { k: "build", x: spot[0], y: spot[1], type }];
    }
  }

  // the Stewards hold back the deposit other factions' machines are working hardest
  if (f === "stewards" && r() < 0.3) {
    let best: [number, number] | null = null;
    let bn = 0;
    for (const b of w.buildings) {
      if (!b.f || b.f === "stewards" || (b.type !== "extractor" && b.type !== "seeder")) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = b.x + dx;
        const y = b.y + dy;
        if (reserveProblem(s, w, p, x, y)) continue;
        const n = w.buildings.filter((q) => q.f && q.f !== "stewards" && dist(q.x, q.y, x, y) <= 1.5).length;
        if (n > bn) [bn, best] = [n, [x, y]];
      }
    }
    if (best) return [{ k: "reserve", x: best[0], y: best[1] }];
  }

  // deal when stuck: hand a surplus to a faction here that has next to none of it
  if (r() < 0.05) {
    for (const fam of FAMILIES) {
      if (stock[fam] < 30) continue;
      const needy = FACTION_IDS.find((g) => g !== f && w.landed.includes(g) && (w.stock[g]?.[fam] ?? 0) < 5);
      if (needy) return [{ k: "transfer", to: needy, cargo: { matter: 0, mineral: 0, coolant: 0, [fam]: 6 } }];
    }
  }

  // otherwise gather by hand
  const i = nearestDeposit(s, w, p);
  if (i < 0) return out;
  const [x, y] = at(w, i);
  const m = walk(p, x, y, HARVEST_RANGE - 0.8);
  if (m) {
    out.push(m);
    if (m.dx !== 0 || m.dy !== 0) return out;
  }
  if (s.tick >= p.nextHarvest) out.push({ k: "harvest", x, y });
  return out;
}

/** One act from a bot god, following its faction's doctrine. Pure, like planBot. */
export function planGod(s: RoomState, pid: string, r: () => number): Command | null {
  const p = s.players[pid];
  if (!p || !p.faction || s.god.id !== pid) return null;
  const f = p.faction;
  const living = s.worlds.map((w, wi) => [w, wi] as const).filter(([w]) => !w.spent);
  if (!living.length) return null;
  const frac = (w: World): number => worldRemaining(w) / Math.max(1, FAMILIES.reduce((a, fam) => a + w.ledger[fam].initial, 0));
  const home = p.world >= 0 && !s.worlds[p.world].spent ? p.world : living[0][1];
  const fam = FAMILIES[Math.floor(r() * 3)] as Family;
  const sowOn = (wi: number): Command | null => {
    const w = s.worlds[wi];
    for (let k = 0; k < 30; k++) {
      const x = Math.floor(r() * w.w);
      const y = Math.floor(r() * w.w);
      if (!sowProblem(w, x, y, fam)) return { k: "god", power: "sow", x, y, family: fam, world: wi };
    }
    return null;
  };
  const near = (wi: number, pred: (f?: FactionId) => boolean): [number, number] | null => {
    const bs = s.worlds[wi].buildings.filter((b) => pred(b.f));
    if (!bs.length) return null;
    // the densest cluster: the building with the most like it close by
    let best = bs[0];
    let bn = -1;
    for (const b of bs) {
      const n = bs.filter((q) => dist(q.x, q.y, b.x, b.y) <= 3).length;
      if (n > bn) [bn, best] = [n, b];
    }
    return [best.x, best.y];
  };
  switch (f) {
    case "stewards": {
      // Hush the deposit nearest a named place; Sow the world with least stock
      if (r() < 0.5) {
        for (const [w, wi] of living) {
          const named = w.tiles.findIndex((t) => t.mark && t.d && t.amt > 0);
          if (named >= 0) return { k: "god", power: "hush", x: named % w.w, y: Math.floor(named / w.w), world: wi };
        }
      }
      const poorest = [...living].sort((a, b) => frac(a[0]) - frac(b[0]))[0][1];
      return sowOn(poorest);
    }
    case "foundry": {
      // Bless where its machines stand; Strike the largest cluster of someone else's
      if (r() < 0.6) {
        const mine = near(home, (g) => g === "foundry");
        if (mine) return { k: "god", power: "bless", x: mine[0], y: mine[1], world: home };
      }
      for (const [, wi] of living) {
        const theirs = near(wi, (g) => !!g && g !== "foundry");
        if (theirs) return { k: "god", power: "strike", x: theirs[0], y: theirs[1], world: wi };
      }
      return null;
    }
    case "automata": {
      const mine = near(home, (g) => g === "automata");
      if (mine && r() < 0.5) {
        const w = s.worlds[home];
        for (let k = 0; k < 20; k++) {
          const x = mine[0] + Math.floor(r() * 9) - 4;
          const y = mine[1] + Math.floor(r() * 9) - 4;
          if (!placementProblem(s, w, "datacentre", x, y, { free: true })) return { k: "god", power: "gift", x, y, world: home };
        }
      }
      if (mine) return { k: "god", power: "bless", x: mine[0], y: mine[1], world: home };
      return sowOn(home);
    }
    case "brokers": {
      // feed the busiest world, so there's more to carry
      const busiest = [...living].sort((a, b) => b[0].buildings.length - a[0].buildings.length)[0][1];
      return r() < 0.5 ? sowOn(busiest) : (() => {
        const pad = near(busiest, (g) => g === "brokers");
        return pad ? { k: "god", power: "bless", x: pad[0], y: pad[1], world: busiest } as Command : sowOn(busiest);
      })();
    }
  }
}

/** Is any human here to keep the room running? Bots never keep a room awake. */
export const awake = (s: RoomState): boolean => humansHere(s).length > 0;

/**
 * Let every seated bot take its turn: one planned step every BOT_EVERY_TICKS,
 * and a god act at most once a second. Everything goes through applyCommand.
 * `headless` runs bots with no human present (the tournament only).
 */
export function runBots(s: RoomState, ch: Changes, headless = false): void {
  if (s.mode !== "cosmos" || s.phase.k !== "play") return;
  if (!headless && !awake(s)) return;
  FACTION_IDS.forEach((f, k) => {
    const b = activeBot(s, f);
    if (!b) return;
    const r = rng(s.seed ^ (s.tick * 40503 + k * 977));
    if (s.god.id === b.id && (s.tick + k) % 10 === 0) {
      const g = planGod(s, b.id, r);
      if (g) applyCommand(s, b.id, `${b.id}-g${s.tick}`, s.gen, g, ch);
    }
    if ((s.tick + k) % BOT_EVERY_TICKS !== 0) return;
    planBot(s, b.id, r).forEach((c, n) => applyCommand(s, b.id, `${b.id}-${s.tick}-${n}`, s.gen, c, ch, c.k === "move" ? undefined : b.world));
  });
}

export { stockOf };
