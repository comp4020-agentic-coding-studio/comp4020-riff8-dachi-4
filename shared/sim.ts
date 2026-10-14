// The authoritative room simulation. Pure functions over a JSON-serialisable
// RoomState, so it runs (and is tested) without a browser or a socket. The
// server owns the only live copy of each room and calls these in order: one
// command or one tick at a time, which is what serialises every mutation.
//
// A room holds a list of worlds. Every per-world rule takes a World, not the
// room: a classic room is a room with one active world and the stage advance;
// a cosmos room runs all five at once, with factions, ships and bots on top.
import {
  BENCH_RANGE,
  BLESS_MIN_COOLDOWN,
  BLESS_RADIUS,
  BLESS_SPEEDUP,
  BLESS_TICKS,
  BOT_RETURN_TICKS,
  BUILDINGS,
  BUILD_RANGE,
  CATCH_UP_FUEL,
  DEAL_AFTER_TICKS,
  EARTH_SEED_LIFT,
  EMOTES,
  ENGINE_OF,
  FACTIONS,
  FACTION_IDS,
  FAMILIES,
  GOD_GAP_TICKS,
  GOD_TURN_TICKS,
  HARVEST_COOLDOWN_TICKS,
  HARVEST_RANGE,
  HEAT_LIMIT,
  HUSH_RADIUS,
  HUSH_REST_TICKS,
  HUSH_TICKS,
  LAUNCH_FUEL,
  MARKS_PER_PLAYER,
  MAX_IDENTITIES,
  MAX_PLAYERS,
  PACES,
  PAD_FEE,
  PLAYER_SPEED,
  RESERVE_COST,
  RESERVE_RADIUS,
  RESERVE_REST_TICKS,
  RESERVE_TICKS,
  SALVAGE_RATE,
  SEEDER_CAP,
  SEEDER_EVERY,
  SHIP_CARGO,
  SMELTER_IN,
  SOW_CAP,
  STAGES,
  STRIKE_FUSE_TICKS,
  STRIKE_RADIUS,
  SUN_TO_RESERVE,
  SUN_TWIST_HEAT,
  TICK_MS,
  TOOL_TIERS,
  UNIQUE,
  buildingName,
  flightTicks,
  harvestCooldown,
  powerName,
  toolCost,
  toolName,
  type Bundle,
  type BuildingType,
  type FactionId,
  type Family,
  type GodPower,
  type Pace,
} from "./content.ts";
import type { Building, Command, FactionPick, GodRecord, Ledger, Mode, Player, RoomState, Ship, StageSummary, Strike, Tile, World, WorldSummary } from "./protocol.ts";
import { SCHEMA_VERSION } from "./protocol.ts";
import { generateStage, rng } from "./worldgen.ts";

/** What changed on one world during one call. */
export interface WorldChanges {
  tiles: Set<number>;
  buildings: Set<number>;
  removed: number[];
  /** where strikes landed: [x, y] */
  blasts: [number, number][];
  meta: boolean;
}

/** What changed during one call: the server turns this into deltas. */
export interface Changes {
  w: Map<number, WorldChanges>;
  /** room-level fields (god, ships, factions, phase...) */
  meta: boolean;
  /** log entries added or rewritten, by id */
  logIds: Set<number>;
  /** a stage boundary, a world ending or the ending: save now, then broadcast fresh snapshots */
  boundary: boolean;
}

export const newChanges = (): Changes => ({ w: new Map(), meta: false, logIds: new Set(), boundary: false });

export function wc(ch: Changes, wi: number): WorldChanges {
  let c = ch.w.get(wi);
  if (!c) ch.w.set(wi, (c = { tiles: new Set(), buildings: new Set(), removed: [], blasts: [], meta: false }));
  return c;
}

export type Result = { ok: true } | { ok: false; reason: string };
const no = (reason: string): Result => ({ ok: false, reason });
const OK: Result = { ok: true };

export const emptyBundle = (): Bundle => ({ matter: 0, mineral: 0, coolant: 0 });
export const emptyRecord = (): GodRecord => ({ turns: 0, sown: 0, destroyed: 0, felled: 0, gifted: 0, blessed: 0, hushed: 0 });
const bundleTotal = (b: Bundle): number => FAMILIES.reduce((a, f) => a + b[f], 0);

const emptyLedger = (): Ledger =>
  Object.fromEntries(FAMILIES.map((f) => [f, { initial: 0, remaining: 0, extracted: 0, destroyed: 0 }])) as Ledger;

function ledgerFor(tiles: Tile[]): Ledger {
  const l = emptyLedger();
  for (const t of tiles) if (t.d) {
    l[t.d].initial += t.init;
    l[t.d].remaining += t.amt;
  }
  return l;
}

/**
 * The land holds only as much life as its world has left: every tile's life
 * is capped by how much of the world remains (60%) and how much of its water,
 * its coolant, remains (40%). So the whole land dries as it's consumed, in
 * whatever order, not just the tiles anyone touched, and draining the pond
 * costs more than its share. Derived from the ledger on both sides, so it
 * costs no traffic.
 */
export const lifeCap = (ledger: Ledger): number => {
  const frac = (rem: number, init: number): number => (init ? rem / init : 0);
  const total = FAMILIES.reduce((a, f) => a + ledger[f].remaining, 0);
  const initial = FAMILIES.reduce((a, f) => a + ledger[f].initial, 0);
  const left = 0.6 * frac(total, initial) + 0.4 * frac(ledger.coolant.remaining, ledger.coolant.initial);
  return Math.round(15 + 85 * left);
};

export const effectiveLife = (t: Tile, cap: number): number => Math.min(t.life, cap);

export const averageLife = (w: Pick<World, "tiles" | "ledger">): number => {
  const cap = lifeCap(w.ledger);
  const land = w.tiles.filter((t) => t.t === 0 || t.t === 1 || t.t === 3);
  return Math.round(land.reduce((a, t) => a + effectiveLife(t, cap), 0) / Math.max(1, land.length));
};

export function newWorld(seed: number, stage: number, tick: number): World {
  const g = generateStage(seed, stage);
  const ledger = ledgerFor(g.tiles);
  const w: World = {
    stage,
    w: STAGES[stage].size,
    tiles: g.tiles,
    buildings: g.buildings,
    nextBuildingId: g.buildings.length + 1,
    inventory: { ...STAGES[stage].starter },
    stock: {},
    ledger,
    econ: { energySupply: 0, energyUsed: 0, computeSupply: 0, computeUsed: 0, workersSupply: 0, workersUsed: 0 },
    heat: 0,
    econTicks: 0,
    lifeStart: 100,
    startTick: tick,
    spent: false,
    sown: 0,
    generated: FAMILIES.reduce((a, f) => a + ledger[f].initial, 0),
    strikes: [],
    blessings: [],
    hushes: [],
    hushUntil: {},
    hushRest: {},
    reserves: [],
    reserveUntil: {},
    reserveRest: {},
    landed: [],
    seeded: 0,
    took: {},
  };
  w.lifeStart = averageLife(w);
  return w;
}

export function createRoom(code: string, seed: number, pace: Pace, gods = false, mode: Mode = "classic", pick: FactionPick = "either"): RoomState {
  const s: RoomState = {
    v: SCHEMA_VERSION,
    code,
    seed,
    pace,
    mode,
    pick,
    hostId: null,
    tick: 0,
    seq: 0,
    gen: 1,
    stage: 0,
    phase: { k: "play" },
    worlds: mode === "cosmos" ? STAGES.map((_, i) => newWorld(seed, i, 0)) : [newWorld(seed, 0, 0)],
    reserve: 0,
    god: { on: gods, id: null, until: 0, next: 0, last: null, aim: 0, made: 0 },
    ships: [],
    nextShipId: 1,
    transit: { launched: emptyBundle(), landed: emptyBundle() },
    computeTotal: 0,
    factions: {},
    history: [],
    archive: [],
    players: {},
    tokens: {},
    receipts: {},
    log: [],
    logId: 0,
  };
  if (mode === "cosmos") {
    // the starter crates wait in each world's stockpiles, not in a common pool
    for (const w of s.worlds) w.inventory = emptyBundle();
    const ch = newChanges();
    for (const f of FACTION_IDS) {
      s.factions[f] = { bot: null, emptySince: null, turns: 0, took: 0, compute: 0, carried: 0 };
      seatBot(s, f, ch);
    }
    s.log = [];
  }
  return s;
}

export const spawnPoint = (stage: number): { x: number; y: number } => {
  const st = STAGES[stage];
  const c = (st.size - 1) / 2;
  if (st.id === "sun") return { x: c, y: st.size - 4 };
  if (st.id === "system") return { x: c, y: c + 2 };
  return { x: c, y: c };
};

/** The world a player stands on, or null in flight. */
export const worldOf = (s: RoomState, p: Pick<Player, "world">): World | null => (p.world >= 0 ? (s.worlds[p.world] ?? null) : null);

function log(s: RoomState, ch: Changes, text: string, fold?: { key: string; many: (n: number) => string }): void {
  const last = s.log.at(-1);
  if (fold && last && last.key === fold.key) {
    last.n = (last.n ?? 1) + 1;
    last.text = fold.many(last.n);
    last.tick = s.tick;
    ch.logIds.add(last.id);
    return;
  }
  const e = { id: ++s.logId, tick: s.tick, text, ...(fold ? { key: fold.key, n: 1 } : {}) };
  s.log.push(e);
  if (s.log.length > 40) s.log.splice(0, s.log.length - 40);
  ch.logIds.add(e.id);
}

const cleanText = (raw: unknown, max: number): string | null => {
  if (typeof raw !== "string") return null;
  // printable characters only; collapse whitespace; hard length cap
  const t = raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  return t.length > 0 ? t : null;
};
export const cleanName = (raw: unknown): string => cleanText(raw, 16) ?? "Guest";

const isHuman = (p: Player): boolean => !p.bot;
export const humansHere = (s: RoomState): Player[] => Object.values(s.players).filter((p) => p.connected && isHuman(p));
export const humansIn = (s: RoomState, f: FactionId): Player[] => humansHere(s).filter((p) => p.faction === f);
const botId = (f: FactionId): string => `bot-${f}`;
/** The bot holding a faction's seat right now, if one is. */
export const activeBot = (s: RoomState, f: FactionId): Player | null => {
  const b = s.players[botId(f)];
  return b && b.connected ? b : null;
};

function newPlayer(s: RoomState, id: string, name: string, colour: number, world: number, n: number): Player {
  const sp = spawnPoint(s.worlds[world].stage);
  return {
    id,
    name,
    colour,
    x: sp.x + (n % 3) - 1,
    y: sp.y + Math.floor(n / 3) * 0.8,
    dx: 0,
    dy: 0,
    facing: 2,
    act: null,
    connected: true,
    joinedTick: s.tick,
    nextHarvest: 0,
    nextEmote: 0,
    marks: 0,
    pack: emptyBundle(),
    tools: emptyBundle(),
    stats: { harvested: 0, built: 0, helped: 0 },
    world,
    god: emptyRecord(),
  };
}

/** A faction's first person on a world brings that world's starter crate, once. */
function land(s: RoomState, wi: number, f: FactionId | undefined, ch: Changes): void {
  if (s.mode !== "cosmos" || !f) return;
  const w = s.worlds[wi];
  if (w.landed.includes(f)) return;
  w.landed.push(f);
  const st = STAGES[w.stage];
  const pool = stockOf(w, f);
  for (const fam of FAMILIES) pool[fam] += st.starter[fam];
  wc(ch, wi).meta = true;
}

/** Put a faction's bot in its seat: made the first time, woken after that. */
function seatBot(s: RoomState, f: FactionId, ch: Changes): void {
  const id = botId(f);
  let b = s.players[id];
  if (!b) {
    b = newPlayer(s, id, `${FACTIONS[f].name}`, 8 + FACTION_IDS.indexOf(f), 0, FACTION_IDS.indexOf(f) + 4);
    b.bot = true;
    b.faction = f;
    b.locked = true;
    s.players[id] = b;
    s.receipts[id] = [];
  }
  if (b.world < 0 && !b.ship) b.world = 0;
  b.connected = true;
  s.factions[f]!.bot = id;
  s.factions[f]!.emptySince = null;
  if (b.world >= 0) land(s, b.world, f, ch);
  log(s, ch, `The ${FACTIONS[f].name} bot is playing the ${FACTIONS[f].name}.`);
  ch.meta = true;
}

function standDownBot(s: RoomState, f: FactionId, ch: Changes): void {
  const b = activeBot(s, f);
  if (!b) return;
  b.connected = false;
  b.dx = b.dy = 0;
  b.stop = false;
  s.factions[f]!.bot = null;
  log(s, ch, `The ${FACTIONS[f].name} bot stands down.`);
  ch.meta = true;
}

/** Add a player, or return the existing one. Returns null when the room is full. */
export function join(s: RoomState, id: string, token: string, name: string, ch: Changes): Player | null {
  const existing = s.players[id];
  if (existing && !existing.bot) {
    existing.connected = true;
    if (!s.hostId || !s.players[s.hostId]?.connected) s.hostId = id;
    if (existing.faction) claimSeat(s, existing.faction, ch);
    else if (s.mode === "cosmos") existing.dealAt = s.tick + DEAL_AFTER_TICKS;
    log(s, ch, `${existing.name} is back.`);
    ch.meta = true;
    return existing;
  }
  // capacity is seats at the table, not every browser that ever visited; bots take no seat
  if (humansHere(s).length >= MAX_PLAYERS) return null;
  const humans = Object.values(s.players).filter(isHuman);
  if (humans.length >= MAX_IDENTITIES) {
    // forget the longest-gone identity; its buildings stay, credited to "someone"
    const gone = humans.filter((q) => !q.connected).sort((a, b) => a.joinedTick - b.joinedTick)[0];
    delete s.players[gone.id];
    delete s.tokens[gone.id];
    delete s.receipts[gone.id];
  }
  const used = new Set(Object.values(s.players).filter(isHuman).map((p) => p.colour));
  let colour = 0;
  while (used.has(colour)) colour++;
  // two browsers called "Ada" stay tellable apart
  const taken = new Set(Object.values(s.players).map((q) => q.name));
  let unique = cleanName(name);
  for (let k = 2; taken.has(unique); k++) unique = `${cleanName(name).slice(0, 13)} ${k}`;
  const p = newPlayer(s, id, unique, colour, 0, humans.length);
  s.players[id] = p;
  s.tokens[id] = token;
  s.receipts[id] = [];
  if (!s.hostId || !s.players[s.hostId]?.connected) s.hostId = id;
  log(s, ch, `${p.name} arrived.`);
  if (s.mode === "cosmos") {
    if (s.pick === "deal") setFaction(s, p, dealFaction(s, p.id), ch);
    else p.dealAt = s.tick + DEAL_AFTER_TICKS;
  }
  ch.meta = true;
  return p;
}

/** A player's connection dropped. Their buildings and stats stay; the host role moves on. */
export function leave(s: RoomState, id: string, ch: Changes): void {
  const p = s.players[id];
  if (!p || p.bot) return;
  p.connected = false;
  p.dx = p.dy = 0;
  if (s.hostId === id) {
    const next = humansHere(s).sort((a, b) => a.joinedTick - b.joinedTick)[0];
    s.hostId = next ? next.id : id;
  }
  if (p.faction && humansIn(s, p.faction).length === 0) s.factions[p.faction]!.emptySince = s.tick;
  log(s, ch, `${p.name} stepped away.`);
  ch.meta = true;
}

/** A human in a faction's seat: the bot stands down at once. */
function claimSeat(s: RoomState, f: FactionId, ch: Changes): void {
  const fs = s.factions[f];
  if (!fs) return;
  fs.emptySince = null;
  standDownBot(s, f, ch);
}

/** Which faction "deal me one" gives: fewest humans, a bot-held seat first, then the room's dice. */
export function dealFaction(s: RoomState, pid: string): FactionId {
  const count = (f: FactionId): number => humansIn(s, f).filter((p) => p.id !== pid).length;
  const fewest = Math.min(...FACTION_IDS.map(count));
  let pool = FACTION_IDS.filter((f) => count(f) === fewest);
  const botHeld = pool.filter((f) => activeBot(s, f));
  if (botHeld.length) pool = botHeld;
  let h = 0;
  for (const c of pid) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return pool[Math.floor(rng(s.seed + s.tick * 7 + h)() * pool.length)];
}

/** Why this player can't join that faction, or null if they can. */
export function factionProblem(s: RoomState, p: Player, f: FactionId): string | null {
  if (s.mode !== "cosmos") return "there are no factions in a classic world";
  if (p.locked) return `you've already worked for the ${FACTIONS[p.faction!].name}: you're theirs for the campaign`;
  const humans = humansHere(s).length + (p.connected ? 0 : 1);
  const cap = Math.ceil(humans / 4);
  const there = humansIn(s, f).filter((q) => q.id !== p.id).length;
  if (there + 1 > cap) return `the ${FACTIONS[f].name} are full: ${there} of ${cap}`;
  return null;
}

function setFaction(s: RoomState, p: Player, f: FactionId, ch: Changes): void {
  const old = p.faction;
  p.faction = f;
  delete p.dealAt;
  claimSeat(s, f, ch);
  if (old && old !== f && humansIn(s, old).length === 0) s.factions[old]!.emptySince = s.tick;
  if (p.world >= 0) land(s, p.world, f, ch);
  log(s, ch, `${p.name} joined the ${FACTIONS[f].name}.`);
  ch.meta = true;
}

export const footprint = (b: Pick<Building, "x" | "y" | "type">): [number, number][] => {
  const n = BUILDINGS[b.type].size;
  const out: [number, number][] = [];
  for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) out.push([b.x + dx, b.y + dy]);
  return out;
};

const centre = (b: Pick<Building, "x" | "y" | "type">): [number, number] => {
  const h = (BUILDINGS[b.type].size - 1) / 2;
  return [b.x + h, b.y + h];
};

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
const inBounds = (w: Pick<World, "w">, x: number, y: number): boolean => x >= 0 && y >= 0 && x < w.w && y < w.w;
const tileAt = (w: Pick<World, "w" | "tiles">, x: number, y: number): Tile | undefined => (inBounds(w, x, y) ? w.tiles[y * w.w + x] : undefined);
const near = (p: Pick<Player, "x" | "y">, x: number, y: number, range: number): boolean => Math.hypot(p.x - x, p.y - y) <= range;
const complete = (b: Building): boolean => b.work >= BUILDINGS[b.type].build * 10;

export const isHost = (s: Pick<RoomState, "hostId">, id: string): boolean => s.hostId === id;

/** A faction's stockpile on a world, made on first use. */
export const stockOf = (w: World, f: FactionId): Bundle => (w.stock[f] ??= emptyBundle());

/** What a building costs this faction: its discounts, and double for a unique it doesn't own. */
export function costOf(type: BuildingType, f?: FactionId): Bundle {
  const base = BUILDINGS[type].cost;
  let k = 1;
  if (f) {
    k *= FACTIONS[f].costs[type] ?? 1;
    const u = UNIQUE[type];
    if (u?.othersPay && FACTIONS[f].unique !== type) k *= u.othersPay;
  }
  return Object.fromEntries(FAMILIES.map((fam) => [fam, Math.ceil((base[fam] ?? 0) * k)])) as Bundle;
}

/** What can be built on this world, by whom: a classic world's list, plus cosmos's pad and the uniques. */
export function buildable(s: Pick<RoomState, "mode">, w: Pick<World, "stage">, f?: FactionId): BuildingType[] {
  const st = STAGES[w.stage];
  if (s.mode !== "cosmos") return st.buildings;
  const out = st.buildings.filter((t) => !(f && FACTIONS[f].cannot.includes(t)));
  out.push("pad");
  if (f === "foundry") out.push("smelter");
  if (f === "automata" && st.buildings.includes("extractor")) out.push("seeder");
  return out;
}

/** What pays for a player's building besides their pack: the shared stockpile, or their faction's here. */
const poolFor = (s: Pick<RoomState, "mode">, w: World, f?: FactionId): Bundle | null =>
  s.mode === "cosmos" ? (f ? (w.stock[f] ?? emptyBundle()) : null) : w.inventory;

/** Why a building can't go here, or null if it can. Shared by server and the ghost preview. */
export function placementProblem(
  s: Pick<RoomState, "mode">,
  w: World,
  type: BuildingType,
  x: number,
  y: number,
  opts: { p?: Pick<Player, "x" | "y" | "pack" | "faction">; free?: boolean; f?: FactionId } = {},
): string | null {
  const st = STAGES[w.stage];
  const f = opts.f ?? opts.p?.faction;
  if (w.spent) return `${st.name} is spent: nothing more can be built here`;
  if (s.mode === "cosmos" && !f && !opts.free) return "choose a faction first";
  if (f && FACTIONS[f].cannot.includes(type)) return `the ${FACTIONS[f].name} can't build ${buildingName(st, type)}s`;
  const only = UNIQUE[type]?.only;
  if (only && f !== only && !opts.free) return `only the ${FACTIONS[only].name} can build a ${buildingName(st, type)}`;
  if (!opts.free && !buildable(s, w, f).includes(type)) return `nothing like that can be built on ${st.name}`;
  const def = BUILDINGS[type];
  for (const [fx, fy] of footprint({ type, x, y })) {
    const t = tileAt(w, fx, fy);
    if (!t) return "off the edge of the map";
    if (t.b) return "something is already built here";
    if (t.d && t.amt > 0) return `there's ${st.families[t.d].label} here: harvest it first`;
    if (t.t === 1) return "can't build on water";
    if (t.t === 3) return "can't build on the star itself";
    if (t.t === 2 && type !== "relay") return "nothing to build on: only relays float in open space";
  }
  if (opts.p && !near(opts.p, x + (def.size - 1) / 2, y + (def.size - 1) / 2, BUILD_RANGE)) return "too far away: walk closer";
  // a builder pays from their own pack first, and the stockpile covers the rest
  if (!opts.free) {
    const cost = costOf(type, s.mode === "cosmos" ? f : undefined);
    const pool = poolFor(s, w, f);
    for (const fam of FAMILIES) {
      const have = (pool?.[fam] ?? 0) + (opts.p?.pack[fam] ?? 0);
      if (have < cost[fam]) return `needs ${cost[fam]} ${st.families[fam].label} (have ${have})`;
    }
  }
  return null;
}

const inZone = (zones: { x: number; y: number; until: number }[], tick: number, x: number, y: number, r: number): boolean =>
  zones.some((a) => a.until > tick && Math.hypot(x - a.x, y - a.y) <= r);

/** Ticks until this player may harvest this family again: their tool, their faction's hands, and a Bless if one is over them. */
export function harvestTicks(
  s: Pick<RoomState, "god" | "tick" | "mode">,
  w: Pick<World, "blessings">,
  p: Pick<Player, "id" | "x" | "y" | "tools" | "faction">,
  family: Family,
): number {
  let base = harvestCooldown(p.tools, family);
  if (s.mode === "cosmos" && p.faction) base = Math.round(base * FACTIONS[p.faction].hands);
  const blessed = p.id !== s.god.id && inZone(w.blessings, s.tick, p.x, p.y, BLESS_RADIUS);
  return blessed ? Math.max(BLESS_MIN_COOLDOWN, Math.floor(base / BLESS_SPEEDUP)) : base;
}

/** Why nothing can be taken from this tile right now, or null. Hand and machine alike. */
export function lockProblem(w: Pick<World, "hushUntil" | "reserveUntil" | "stage">, idx: number, tick: number): string | null {
  if ((w.hushUntil[idx] ?? 0) > tick) return `nothing can be taken here: a god laid ${STAGES[w.stage].powers.hush} on it`;
  if ((w.reserveUntil[idx] ?? 0) > tick) return "the Stewards have reserved this for now";
  return null;
}

/** Why a god can't Sow here, or null if they can. Shared by server and the preview. */
export function sowProblem(w: World, x: number, y: number, family?: Family): string | null {
  const t = tileAt(w, x, y);
  if (!t) return "off the edge of the map";
  if (w.spent) return "not on a spent world";
  if (t.b) return "something is built here";
  if (t.d && t.amt > 0) return "something already grows here";
  if (t.t === 3) return "not on the star itself";
  if (t.t === 4) return "not on a spent world";
  const n = family ? STAGES[w.stage].families[family].perTile : 0;
  if (w.sown + n > Math.floor(w.generated * SOW_CAP)) return "this world has no more to give";
  return null;
}

/** A finished home within reach: its workbench is where fine tools are made. */
export const atBench = (w: Pick<World, "buildings">, p: Pick<Player, "x" | "y">): boolean =>
  w.buildings.some((b) => b.type === "city" && complete(b) && Math.hypot(p.x - centre(b)[0], p.y - centre(b)[1]) <= BENCH_RANGE);

/** Why this player can't make the next tier of a tool right now, or null if they can. Shared by server and HUD. */
export function craftProblem(w: Pick<World, "buildings" | "stage">, p: Player, family: Family): string | null {
  const st = STAGES[w.stage];
  const tier = p.tools[family] + 1;
  const def = TOOL_TIERS[tier];
  if (!def) return `your ${toolName(family, p.tools[family])} is as good as they get`;
  if (def.bench && !atBench(w, p)) return `a ${toolName(family, tier)} needs a workbench: stand beside finished ${buildingName(st, "city")}`;
  const cost = toolCost(family, tier);
  for (const f of FAMILIES) if (p.pack[f] < cost[f]) return `needs ${cost[f]} ${st.families[f].label} in your pack (you carry ${p.pack[f]})`;
  return null;
}

function remember(s: RoomState, wi: number, tile: Tile, fate: string, ch: Changes): void {
  if (!tile.mark) return;
  s.archive.push({ stage: STAGES[s.worlds[wi].stage].id, name: tile.mark.name, fate });
  log(s, ch, `${tile.mark.name} ${fate}.`);
  delete tile.mark;
  ch.meta = true;
}

/** Take stock off a tile and put it in `into`: a player's pack, or a stockpile for machines. */
function takeFrom(s: RoomState, wi: number, idx: number, amount: number, into: Bundle, by: FactionId | undefined, ch: Changes): number {
  const w = s.worlds[wi];
  const tile = w.tiles[idx];
  if (!tile.d || tile.amt <= 0) return 0;
  const took = Math.min(amount, tile.amt);
  const family = tile.d;
  tile.amt -= took;
  w.ledger[family].remaining -= took;
  w.ledger[family].extracted += took;
  into[family] += took;
  tile.life = Math.min(tile.life, Math.round((tile.amt / tile.init) * 60));
  const c = wc(ch, wi);
  c.tiles.add(idx);
  c.meta = true;
  if (s.mode === "cosmos") {
    if (by) {
      w.took[by] = (w.took[by] ?? 0) + took;
      s.factions[by]!.took += took;
      ch.meta = true;
    }
    // whoever burns the Sun fills the one Bottled Sun everyone's outer worlds run on
    if (STAGES[w.stage].id === "sun" && family === "matter") s.reserve += took * SUN_TO_RESERVE;
  }
  if (tile.amt === 0) {
    remember(s, wi, tile, "was harvested bare", ch);
    // a grove or pond gone leaves the ground around it poorer
    const x = idx % w.w;
    const y = Math.floor(idx / w.w);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = tileAt(w, x + dx, y + dy);
        if (!n || n.t === 2 || (dx === 0 && dy === 0)) continue;
        n.life = Math.max(0, n.life - 15);
        c.tiles.add((y + dy) * w.w + x + dx);
      }
  }
  return took;
}

function receipt(s: RoomState, pid: string, cmdId: string): void {
  const r = (s.receipts[pid] ??= []);
  r.push(cmdId);
  if (r.length > 64) r.splice(0, r.length - 64);
}

/** Commands that act on the ground: only on the world you stand on. */
const GROUNDED = new Set(["harvest", "build", "demolish", "mark", "craft", "deposit", "transfer", "launch", "reserve"]);

/**
 * Apply one command. `w` is the world the client meant it for (the one it was
 * viewing); a grounded command meant for a world the player isn't on is refused.
 */
export function applyCommand(s: RoomState, pid: string, cmdId: string, gen: number, c: Command, ch: Changes, w?: unknown): Result {
  const p = s.players[pid];
  if (!p) return no("not in this room");
  if (typeof cmdId !== "string" || cmdId.length < 1 || cmdId.length > 40) return no("bad command id");
  if (gen !== s.gen) return no("that was meant for a world that's gone");
  if (!c || typeof c !== "object") return no("malformed command");

  if (c.k === "move") {
    // continuous intent, idempotent by nature: not receipted
    if (typeof c.dx !== "number" || typeof c.dy !== "number" || !Number.isFinite(c.dx) || !Number.isFinite(c.dy)) return no("malformed move");
    const len = Math.hypot(c.dx, c.dy);
    p.dx = len > 1 ? c.dx / len : c.dx;
    p.dy = len > 1 ? c.dy / len : c.dy;
    return OK;
  }

  if (s.phase.k !== "play") return no(s.phase.k === "ended" ? "there is nothing left" : "the world is changing: wait a moment");
  if (GROUNDED.has(c.k)) {
    if (p.world < 0) return no("you're in flight: wait until you land");
    if (w !== undefined && w !== p.world) {
      const there = typeof w === "number" && s.worlds[w] ? STAGES[s.worlds[w].stage].name : "that world";
      return no(`you're only looking at ${there}: you're on ${STAGES[s.worlds[p.world].stage].name}`);
    }
  }
  // a retry of a command that was applied is acknowledged again, not applied again;
  // only applied commands are receipted, so a refused one can be retried for real
  if (s.receipts[pid]?.includes(cmdId)) return OK;
  const res = mutate(s, p, c, ch);
  if (res.ok) receipt(s, pid, cmdId);
  return res;
}

const validBundle = (b: unknown): b is Bundle =>
  !!b && typeof b === "object" && FAMILIES.every((f) => isInt((b as Bundle)[f]) && (b as Bundle)[f] >= 0 && (b as Bundle)[f] <= 1_000_000);
const isFaction = (f: unknown): f is FactionId => typeof f === "string" && (FACTION_IDS as readonly string[]).includes(f);

function mutate(s: RoomState, p: Player, c: Exclude<Command, { k: "move" }>, ch: Changes): Result {
  const pid = p.id;
  const wi = p.world;
  const w = wi >= 0 ? s.worlds[wi] : null;
  const st = w ? STAGES[w.stage] : STAGES[0];
  const cosmos = s.mode === "cosmos";
  const needFaction = (): Result | null => (cosmos && !p.faction ? no("choose a faction first") : null);

  switch (c.k) {
    case "harvest": {
      if (!w) return no("you're in flight");
      if (!isInt(c.x) || !isInt(c.y) || !inBounds(w, c.x, c.y)) return no("off the map");
      const nf = needFaction();
      if (nf) return nf;
      if (s.tick < p.nextHarvest) return no("too fast");
      if (!near(p, c.x, c.y, HARVEST_RANGE)) return no("too far away");
      const idx = c.y * w.w + c.x;
      const tile = w.tiles[idx];
      if (tile.b) {
        const b = w.buildings.find((q) => q.id === tile.b)!;
        if (complete(b)) return no(`the ${buildingName(st, b.type)} is already built`);
        b.work = Math.min(BUILDINGS[b.type].build * 10, b.work + 5);
        wc(ch, wi).buildings.add(b.id);
        p.stats.helped++;
        p.nextHarvest = s.tick + HARVEST_COOLDOWN_TICKS;
        p.act = { k: "build", until: s.tick + 4 };
        lock(p, ch);
        return OK;
      }
      if (!tile.d || tile.amt <= 0) return no("nothing to harvest there");
      const locked = lockProblem(w, idx, s.tick);
      if (locked) return no(locked);
      const family = tile.d;
      const took = takeFrom(s, wi, idx, PACES[s.pace].harvestYield, p.pack, p.faction, ch);
      withdraw(s, p, ch);
      p.stats.harvested += took;
      // a harvest made under someone's Bless goes on their record
      const bless = p.id !== s.god.id ? w.blessings.find((a) => a.until > s.tick && Math.hypot(p.x - a.x, p.y - a.y) <= BLESS_RADIUS) : undefined;
      if (bless && s.players[bless.byId]) {
        s.players[bless.byId].god.blessed++;
        ch.meta = true;
      }
      p.nextHarvest = s.tick + harvestTicks(s, w, p, family);
      p.act = { k: "harvest", until: s.tick + 4 };
      p.facing = facingTo(c.x - p.x, c.y - p.y, p.facing);
      lock(p, ch);
      checkExhausted(s, wi, ch);
      return OK;
    }
    case "build": {
      if (!w) return no("you're in flight");
      if (!isInt(c.x) || !isInt(c.y) || typeof c.type !== "string" || !(c.type in BUILDINGS)) return no("malformed build");
      const problem = placementProblem(s, w, c.type, c.x, c.y, { p });
      if (problem) return no(problem);
      raise(s, wi, c.type, c.x, c.y, p, ch);
      withdraw(s, p, ch);
      lock(p, ch);
      return OK;
    }
    case "demolish": {
      if (!w) return no("you're in flight");
      if (!isInt(c.x) || !isInt(c.y)) return no("malformed demolish");
      const tile = tileAt(w, c.x, c.y);
      if (!tile?.b) return no("nothing built there");
      const b = w.buildings.find((q) => q.id === tile.b)!;
      const def = BUILDINGS[b.type];
      if (def.protected) return no("the Depot is shared: nobody can take it down");
      if (def.renderValue) {
        if (!isHost(s, pid)) return no("only the host can render down a world");
        s.reserve += def.renderValue;
        s.archive.push({ stage: st.id, name: b.name ?? "A world", fate: `was rendered down for ${def.renderValue} energy` });
        log(s, ch, `${p.name} rendered down ${b.name}.`);
      } else {
        const ours = cosmos && b.f && b.f === p.faction;
        if (b.owner !== pid && !isHost(s, pid) && !ours) return no(cosmos ? "only its faction or the host can take this down" : "only its builder or the host can take this down");
        // lossy salvage: always strictly less than the cost, so no refund loop; a god's Gift was free
        const pool = cosmos ? (b.f ? stockOf(w, b.f) : null) : w.inventory;
        if (pool && !b.gift) {
          const cost = costOf(b.type, cosmos ? b.f : undefined);
          for (const f of FAMILIES) pool[f] += Math.floor(cost[f] * SALVAGE_RATE);
        }
        log(s, ch, `${p.name} took down a ${buildingName(st, b.type)}.`);
      }
      fell(s, wi, b, ch);
      return OK;
    }
    case "emote": {
      if (!(EMOTES as readonly string[]).includes(c.e)) return no("unknown emote");
      if (s.tick < p.nextEmote) return no("too fast");
      p.act = { k: "emote", e: c.e, until: s.tick + 25 };
      p.nextEmote = s.tick + 8;
      return OK;
    }
    case "mark": {
      if (!w) return no("you're in flight");
      if (!isInt(c.x) || !isInt(c.y)) return no("malformed mark");
      const tile = tileAt(w, c.x, c.y);
      const name = cleanText(c.name, 24);
      if (!tile) return no("off the map");
      if (!name) return no("give the place a name");
      if (tile.b) return no("pick somewhere nothing is built");
      if (tile.mark) return no(`that's already ${tile.mark.name}`);
      if (p.marks >= MARKS_PER_PLAYER) return no(`you can name ${MARKS_PER_PLAYER} places per world`);
      if (!near(p, c.x, c.y, BUILD_RANGE)) return no("too far away");
      tile.mark = { name, by: p.name };
      p.marks++;
      wc(ch, wi).tiles.add(c.y * w.w + c.x);
      log(s, ch, `${p.name} named a place ${name}.`);
      return OK;
    }
    case "craft": {
      if (!w) return no("you're in flight");
      if (typeof c.tool !== "string" || !(FAMILIES as readonly string[]).includes(c.tool)) return no("no such tool");
      const problem = craftProblem(w, p, c.tool);
      if (problem) return no(problem);
      const tier = p.tools[c.tool] + 1;
      const cost = toolCost(c.tool, tier);
      for (const f of FAMILIES) p.pack[f] -= cost[f];
      p.tools[c.tool] = tier;
      withdraw(s, p, ch);
      p.act = { k: "build", until: s.tick + 6 };
      log(s, ch, `${p.name} made a ${toolName(c.tool, tier)}.`);
      return OK;
    }
    case "deposit": {
      if (!w) return no("you're in flight");
      const nf = needFaction();
      if (nf) return nf;
      if (FAMILIES.every((f) => p.pack[f] === 0)) return no("your pack is empty");
      const pool = cosmos ? stockOf(w, p.faction!) : w.inventory;
      for (const f of FAMILIES) {
        pool[f] += p.pack[f];
        p.pack[f] = 0;
      }
      wc(ch, wi).meta = true;
      return OK;
    }
    case "faction": {
      if (!cosmos) return no("there are no factions in a classic world");
      const f = c.f === "deal" ? dealFaction(s, pid) : c.f;
      if (!isFaction(f)) return no("no such faction");
      if (p.faction === f) return OK;
      const problem = factionProblem(s, p, f);
      if (problem) return no(problem);
      setFaction(s, p, f, ch);
      return OK;
    }
    case "transfer": {
      if (!w) return no("you're in flight");
      if (!cosmos) return no("there's one shared stockpile in a classic world");
      const nf = needFaction();
      if (nf) return nf;
      if (!isFaction(c.to)) return no("give it to whom?");
      if (c.to === p.faction) return no("that's your own stockpile");
      if (!validBundle(c.cargo) || bundleTotal(c.cargo) === 0) return no("give what?");
      const from = stockOf(w, p.faction!);
      for (const f of FAMILIES) if (from[f] < c.cargo[f]) return no(`the ${FACTIONS[p.faction!].name} have only ${from[f]} ${st.families[f].label} here`);
      const to = stockOf(w, c.to);
      for (const f of FAMILIES) {
        from[f] -= c.cargo[f];
        to[f] += c.cargo[f];
      }
      wc(ch, wi).meta = true;
      const what = FAMILIES.filter((f) => c.cargo[f]).map((f) => `${c.cargo[f]} ${st.families[f].label}`).join(", ");
      log(s, ch, `${p.name} gave the ${FACTIONS[c.to].name} ${what} on ${st.name}.`);
      return OK;
    }
    case "launch":
      return launch(s, p, c, ch);
    case "reserve": {
      if (!w) return no("you're in flight");
      if (!cosmos || p.faction !== "stewards") return no("only the Stewards can reserve land");
      if (!isInt(c.x) || !isInt(c.y) || !inBounds(w, c.x, c.y)) return no("off the map");
      const problem = reserveProblem(s, w, p, c.x, c.y);
      if (problem) return no(problem);
      const pool = stockOf(w, "stewards");
      for (const f of FAMILIES) {
        const mine = Math.min(RESERVE_COST[f], p.pack[f]);
        p.pack[f] -= mine;
        pool[f] -= RESERVE_COST[f] - mine;
      }
      for (const i of reserveTiles(w, c.x, c.y)) {
        if ((w.reserveRest[i] ?? 0) > s.tick) continue;
        w.reserveUntil[i] = s.tick + RESERVE_TICKS;
        w.reserveRest[i] = s.tick + RESERVE_TICKS + RESERVE_REST_TICKS;
      }
      w.reserves.push({ x: c.x, y: c.y, until: s.tick + RESERVE_TICKS, f: "stewards" });
      wc(ch, wi).meta = true;
      lock(p, ch);
      log(s, ch, `${p.name} reserved ${w.tiles[c.y * w.w + c.x].mark?.name ?? "a deposit"} on ${st.name} for ${RESERVE_TICKS / 10}s.`);
      return OK;
    }
    case "gods": {
      if (typeof c.on !== "boolean") return no("malformed switch");
      if (!isHost(s, pid)) return no("only the host can turn gods on or off");
      if (s.god.on === c.on) return OK;
      s.god.on = c.on;
      s.god.id = null;
      s.god.until = 0;
      s.god.next = s.tick;
      log(s, ch, c.on ? `${p.name} let the gods in.` : `${p.name} sent the gods away.`);
      ch.meta = true;
      return OK;
    }
    case "aim": {
      if (!s.god.on || s.god.id !== pid) return no("you aren't a god right now");
      if (!isInt(c.world) || !s.worlds[c.world]) return no("no such world");
      s.god.aim = c.world;
      ch.meta = true;
      return OK;
    }
    case "god":
      return godAct(s, p, c, ch);
    case "stop": {
      const last = s.worlds.at(-1)!;
      const offered = cosmos ? s.worlds.slice(0, -1).every((x) => x.spent) && !last.spent : STAGES[last.stage].id === "universe";
      if (!offered) return no(cosmos ? "the Universe can only be left alone once the other four worlds are spent" : "there's always another world, until the last one");
      if (typeof c.on !== "boolean") return no("malformed vote");
      if (p.bot) return no("bots don't vote");
      // a dropped connection never ends the campaign: if a holdout leaves, someone
      // still here confirms by voting again
      if (p.stop !== c.on) {
        p.stop = c.on;
        log(s, ch, c.on ? `${p.name} wants to stop here and leave the rest alone.` : `${p.name} wants to keep going.`);
        ch.meta = true;
      }
      checkRestraint(s, ch);
      return OK;
    }
    default:
      return no("unknown command");
  }
}

/** A person's first harvest or build fixes their faction for the campaign. */
function lock(p: Player, ch: Changes): void {
  if (p.faction && !p.locked) {
    p.locked = true;
    ch.meta = true;
  }
}

/** Put a building down, paying from the pack first and then the stockpile. Assumes placementProblem said yes. */
function raise(s: RoomState, wi: number, type: BuildingType, x: number, y: number, p: Player | null, ch: Changes, f?: FactionId): Building {
  const w = s.worlds[wi];
  const st = STAGES[w.stage];
  const faction = f ?? p?.faction;
  const cost = costOf(type, s.mode === "cosmos" ? faction : undefined);
  const pool = s.mode === "cosmos" ? stockOf(w, faction!) : w.inventory;
  // payment and occupancy commit together: nothing between them can fail
  for (const fam of FAMILIES) {
    const mine = p ? Math.min(cost[fam], p.pack[fam]) : 0;
    if (p) p.pack[fam] -= mine;
    pool[fam] -= cost[fam] - mine;
  }
  const b: Building = { id: w.nextBuildingId++, type, x, y, owner: p?.id ?? null, work: 0, status: "under construction" };
  if (s.mode === "cosmos" && faction) b.f = faction;
  w.buildings.push(b);
  const c = wc(ch, wi);
  for (const [fx, fy] of footprint(b)) {
    const idx = fy * w.w + fx;
    const tile = w.tiles[idx];
    tile.b = b.id;
    if (type !== "plaza") tile.life = Math.min(tile.life, 15);
    c.tiles.add(idx);
    remember(s, wi, tile, `became a ${buildingName(st, type)}`, ch);
  }
  c.buildings.add(b.id);
  c.meta = true;
  if (p) {
    p.stats.built++;
    p.act = { k: "build", until: s.tick + 6 };
    log(s, ch, `${p.name} started a ${buildingName(st, type)}${s.mode === "cosmos" ? ` on ${st.name}` : ""}.`);
  }
  return b;
}

/** Take a building off the map, no refund (the caller pays any salvage). */
function fell(s: RoomState, wi: number, b: Building, ch: Changes): void {
  const w = s.worlds[wi];
  const c = wc(ch, wi);
  for (const [fx, fy] of footprint(b)) {
    const idx = fy * w.w + fx;
    w.tiles[idx].b = 0;
    c.tiles.add(idx);
  }
  w.buildings = w.buildings.filter((q) => q.id !== b.id);
  c.removed.push(b.id);
  c.meta = true;
}

const reserveTiles = (w: World, x: number, y: number): number[] => {
  const out: number[] = [];
  for (let dy = -RESERVE_RADIUS; dy <= RESERVE_RADIUS; dy++)
    for (let dx = -RESERVE_RADIUS; dx <= RESERVE_RADIUS; dx++) if (inBounds(w, x + dx, y + dy)) out.push((y + dy) * w.w + x + dx);
  return out;
};

/** Why the Stewards can't reserve this deposit right now, or null. */
export function reserveProblem(s: Pick<RoomState, "tick">, w: World, p: Pick<Player, "x" | "y" | "pack">, x: number, y: number): string | null {
  const t = tileAt(w, x, y);
  if (!t) return "off the map";
  if (!t.d || t.amt <= 0) return "a Reserve goes on a deposit with stock left";
  const i = y * w.w + x;
  if ((w.reserveUntil[i] ?? 0) > s.tick) return "it's already reserved";
  if ((w.reserveRest[i] ?? 0) > s.tick) return "it was reserved too recently: it has to be open for a while first";
  if (!near(p, x, y, BUILD_RANGE)) return "too far away";
  const pool = w.stock.stewards ?? emptyBundle();
  for (const f of FAMILIES)
    if (pool[f] + p.pack[f] < RESERVE_COST[f]) return `needs ${RESERVE_COST[f]} ${STAGES[w.stage].families[f].label} (have ${pool[f] + p.pack[f]})`;
  return null;
}

/** The fuel a launch costs this faction now: its own rate, and the catch-up lever for whoever is furthest from par. */
export function fuelFor(s: RoomState, f: FactionId): Bundle {
  let k = FACTIONS[f].fuel;
  if (CATCH_UP_FUEL > 0 && furthestFromPar(s) === f) k *= 1 - CATCH_UP_FUEL;
  return Object.fromEntries(FAMILIES.map((fam) => [fam, Math.ceil(LAUNCH_FUEL[fam] * k)])) as Bundle;
}

/** The nearest world, in flight order, that still has stock. */
export function nearestLiving(s: RoomState, from: number): number | null {
  let best: number | null = null;
  for (let i = 0; i < s.worlds.length; i++) {
    if (i === from || s.worlds[i].spent) continue;
    if (best === null || Math.abs(i - from) < Math.abs(best - from)) best = i;
  }
  return best;
}

/** What a launch would do, or why it can't: shared by the server and the Launch panel. */
export function launchPlan(
  s: RoomState,
  p: Player,
  c: { x: number; y: number; to: number; cargo: Bundle; to_f?: FactionId; go?: boolean },
): { ok: false; reason: string } | { ok: true; to: number; fuel: Bundle; fee: Bundle; pad: Building | null; free: boolean; ticks: number } {
  if (s.mode !== "cosmos") return { ok: false, reason: "there's nowhere to fly to in a classic world" };
  if (p.world < 0) return { ok: false, reason: "you're already in flight" };
  if (!p.faction) return { ok: false, reason: "choose a faction first" };
  const w = s.worlds[p.world];
  if (!validBundle(c.cargo) || bundleTotal(c.cargo) > SHIP_CARGO) return { ok: false, reason: `a ship carries up to ${SHIP_CARGO} units of cargo` };
  if (c.to_f !== undefined && !isFaction(c.to_f)) return { ok: false, reason: "address it to whom?" };
  const go = c.go !== false;
  if (!go && bundleTotal(c.cargo) === 0) return { ok: false, reason: "nothing to send" };
  // a spent world never traps anyone: leave free, from a Pad or from the ground, to the nearest living world
  if (w.spent) {
    const to = nearestLiving(s, p.world);
    if (to === null) return { ok: false, reason: "there's nowhere left to go" };
    if (!go) return { ok: false, reason: "a spent world can only send people, not cargo" };
    return { ok: true, to, fuel: emptyBundle(), fee: emptyBundle(), pad: null, free: true, ticks: flightTicks(p.world, to) };
  }
  if (!isInt(c.to) || !s.worlds[c.to] || c.to === p.world) return { ok: false, reason: "fly where?" };
  if (s.worlds[c.to].spent) return { ok: false, reason: `${STAGES[s.worlds[c.to].stage].name} is spent: there's nothing there` };
  if (!isInt(c.x) || !isInt(c.y)) return { ok: false, reason: "launch from where?" };
  const tile = tileAt(w, c.x, c.y);
  const pad = tile?.b ? w.buildings.find((b) => b.id === tile.b && b.type === "pad") : undefined;
  if (!pad) return { ok: false, reason: "launches go from a Launch Pad" };
  if (!complete(pad)) return { ok: false, reason: "that Launch Pad isn't finished" };
  if (!near(p, pad.x, pad.y, HARVEST_RANGE + 1)) return { ok: false, reason: "stand beside the Pad to launch" };
  const fuel = fuelFor(s, p.faction);
  const fee = emptyBundle();
  if (pad.f && pad.f !== p.faction) for (const f of FAMILIES) fee[f] = Math.floor(c.cargo[f] * PAD_FEE);
  const stock = w.stock[p.faction] ?? emptyBundle();
  for (const f of FAMILIES)
    if (stock[f] < c.cargo[f] + fuel[f])
      return { ok: false, reason: `needs ${c.cargo[f] + fuel[f]} ${STAGES[w.stage].families[f].label} in the ${FACTIONS[p.faction].name} stockpile here (have ${stock[f]})` };
  return { ok: true, to: c.to, fuel, fee, pad, free: false, ticks: flightTicks(p.world, c.to) };
}

function launch(s: RoomState, p: Player, c: Extract<Command, { k: "launch" }>, ch: Changes): Result {
  const plan = launchPlan(s, p, c);
  if (!plan.ok) return no(plan.reason);
  const wi = p.world;
  const w = s.worlds[wi];
  const f = p.faction!;
  const cargo = plan.free ? emptyBundle() : { ...c.cargo };
  if (!plan.free) {
    const stock = stockOf(w, f);
    for (const fam of FAMILIES) stock[fam] -= cargo[fam] + plan.fuel[fam];
    // the Pad's builder takes their cut here, on the ground, before the ship leaves
    if (plan.pad?.f && plan.pad.f !== f) {
      const theirs = stockOf(w, plan.pad.f);
      for (const fam of FAMILIES) {
        theirs[fam] += plan.fee[fam];
        cargo[fam] -= plan.fee[fam];
      }
      s.factions[plan.pad.f]!.carried += bundleTotal(c.cargo);
    }
  }
  const go = plan.free || c.go !== false;
  const ship: Ship = {
    id: s.nextShipId++,
    from: wi,
    to: plan.to,
    departs: s.tick,
    arrives: s.tick + plan.ticks,
    f,
    to_f: isFaction(c.to_f) ? c.to_f : f,
    passengers: go ? [p.id] : [],
    cargo,
  };
  s.ships.push(ship);
  for (const fam of FAMILIES) s.transit.launched[fam] += cargo[fam];
  if (go) {
    p.world = -1;
    p.ship = ship.id;
    p.dx = p.dy = 0;
    p.stop = false;
  }
  wc(ch, wi).meta = true;
  ch.meta = true;
  log(s, ch, `${p.name} launched for ${STAGES[s.worlds[plan.to].stage].name}${bundleTotal(cargo) ? ` with ${bundleTotal(cargo)} in the hold` : ""}${plan.free ? ", free, off a spent world" : ""}.`);
  return OK;
}

function arrive(s: RoomState, ship: Ship, ch: Changes): void {
  const w = s.worlds[ship.to];
  const into = stockOf(w, ship.to_f);
  for (const f of FAMILIES) {
    into[f] += ship.cargo[f];
    s.transit.landed[f] += ship.cargo[f];
  }
  const sp = spawnPoint(w.stage);
  ship.passengers.forEach((id, k) => {
    const q = s.players[id];
    if (!q || q.ship !== ship.id) return;
    q.world = ship.to;
    delete q.ship;
    q.x = sp.x + (k % 3) - 1;
    q.y = sp.y + 1;
    q.dx = q.dy = 0;
    q.marks = 0;
    land(s, ship.to, q.faction, ch);
  });
  wc(ch, ship.to).meta = true;
  ch.meta = true;
  log(s, ch, `A ${FACTIONS[ship.f].name} ship landed on ${STAGES[w.stage].name}.`);
}

/** Where on a world a god's act lands, in words: the nearest named place in reach, or the world. */
function whereOn(w: World, x: number, y: number, r: number): string {
  let best: string | null = null;
  let bd = Infinity;
  w.tiles.forEach((t, i) => {
    if (!t.mark) return;
    const d = Math.hypot((i % w.w) - x, Math.floor(i / w.w) - y);
    if (d <= r + 1 && d < bd) [bd, best] = [d, t.mark.name];
  });
  return best ?? STAGES[w.stage].name;
}

function godAct(s: RoomState, p: Player, c: Extract<Command, { k: "god" }>, ch: Changes): Result {
  if (!s.god.on || s.god.id !== p.id) return no("you aren't a god right now");
  // in cosmos a god reaches any world; in classic, the one there is
  let wi: number;
  if (s.mode === "cosmos") {
    wi = c.world === undefined ? p.world : (c.world as number);
    if (!isInt(wi) || !s.worlds[wi]) return no("no such world");
  } else wi = 0;
  const w = s.worlds[wi];
  const st = STAGES[w.stage];
  if (!isInt(c.x) || !isInt(c.y) || !inBounds(w, c.x, c.y)) return no("off the map");
  if (!(["sow", "bless", "hush", "gift", "strike"] as string[]).includes(c.power)) return no("no such power");
  if (w.spent && c.power !== "strike") return no(`${st.name} is spent: there's nothing left to touch`);
  const idx = c.y * w.w + c.x;
  const tile = w.tiles[idx];
  const cw = wc(ch, wi);
  const name = powerName(st, c.power);
  const fold = { key: `${p.id}:${c.power}:${wi}`, many: (n: number) => `${p.name}, a god, called ${name} ${n} times on ${st.name}.` };
  let where = whereOn(w, c.x, c.y, 0);
  switch (c.power) {
    case "gift": {
      // free, finished and from any distance; the ground rules still hold
      const problem = placementProblem(s, w, "datacentre", c.x, c.y, { free: true });
      if (problem) return no(problem);
      const b: Building = { id: w.nextBuildingId++, type: "datacentre", x: c.x, y: c.y, owner: p.id, work: BUILDINGS.datacentre.build * 10, status: "starting up", gift: true };
      if (s.mode === "cosmos" && p.faction) b.f = p.faction;
      w.buildings.push(b);
      for (const [fx, fy] of footprint(b)) {
        const i = fy * w.w + fx;
        w.tiles[i].b = b.id;
        w.tiles[i].life = Math.min(w.tiles[i].life, 15);
        cw.tiles.add(i);
        remember(s, wi, w.tiles[i], `became a ${buildingName(st, "datacentre")}`, ch);
      }
      cw.buildings.add(b.id);
      p.god.gifted++;
      break;
    }
    case "strike": {
      w.strikes.push({ id: ++s.god.made, x: c.x, y: c.y, at: s.tick + STRIKE_FUSE_TICKS, by: p.name, byId: p.id });
      // the Universe's twist: a Supernova takes back the god's own vote to stop
      if (st.id === "universe") withdraw(s, p, ch);
      where = whereOn(w, c.x, c.y, STRIKE_RADIUS);
      break;
    }
    case "sow": {
      if (typeof c.family !== "string" || !(FAMILIES as readonly string[]).includes(c.family)) return no(`${name} what?`);
      const problem = sowProblem(w, c.x, c.y, c.family);
      if (problem) return no(problem);
      // new natural stock goes on the books as it appears: initial and remaining grow together
      const n = st.families[c.family].perTile;
      tile.d = c.family;
      tile.amt = tile.init = n;
      if (tile.t === 2) tile.t = c.family === "coolant" ? 1 : 0;
      tile.life = Math.max(tile.life, 60);
      w.ledger[c.family].initial += n;
      w.ledger[c.family].remaining += n;
      w.sown += n;
      cw.tiles.add(idx);
      // Earth's twist: a Seed restores the tile to full life and lifts its neighbours
      if (st.id === "earth") {
        tile.life = 100;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const t = tileAt(w, c.x + dx, c.y + dy);
            if (!t || (dx === 0 && dy === 0) || t.t === 2) continue;
            t.life = Math.min(100, t.life + EARTH_SEED_LIFT);
            cw.tiles.add((c.y + dy) * w.w + c.x + dx);
          }
      }
      p.god.sown += n;
      break;
    }
    case "bless": {
      w.blessings = w.blessings.filter((a) => a.until > s.tick);
      w.blessings.push({ id: ++s.god.made, x: c.x, y: c.y, until: s.tick + BLESS_TICKS, by: p.name, byId: p.id });
      where = whereOn(w, c.x, c.y, BLESS_RADIUS);
      break;
    }
    case "hush": {
      // a Hush always ends, and the ground rests after it: no deposit is out of reach for good
      let laid = 0;
      for (let y = Math.floor(c.y - HUSH_RADIUS); y <= Math.ceil(c.y + HUSH_RADIUS); y++)
        for (let x = Math.floor(c.x - HUSH_RADIUS); x <= Math.ceil(c.x + HUSH_RADIUS); x++) {
          if (!inBounds(w, x, y) || Math.hypot(x - c.x, y - c.y) > HUSH_RADIUS) continue;
          const i = y * w.w + x;
          if ((w.hushRest[i] ?? 0) > s.tick) continue;
          w.hushUntil[i] = s.tick + HUSH_TICKS;
          w.hushRest[i] = s.tick + HUSH_TICKS + HUSH_REST_TICKS;
          laid++;
        }
      if (!laid) return no("the ground here was hushed too recently: it has to be open for a while first");
      w.hushes = w.hushes.filter((a) => a.until > s.tick);
      w.hushes.push({ id: ++s.god.made, x: c.x, y: c.y, until: s.tick + HUSH_TICKS, by: p.name, byId: p.id });
      // the Sun's twist: an Eclipse sheds heat
      if (st.id === "sun") w.heat = Math.max(0, w.heat - SUN_TWIST_HEAT);
      p.god.hushed += HUSH_TICKS;
      where = whereOn(w, c.x, c.y, HUSH_RADIUS);
      break;
    }
  }
  if (p.world === wi) p.act = { k: "build", until: s.tick + 6 };
  s.god.aim = wi;
  cw.meta = true;
  ch.meta = true;
  log(s, ch, `${p.name}, a god, called ${name} on ${where}.`, fold);
  return OK;
}

/** Choose the next god: fairly by faction in cosmos, by person in classic, never the same one twice running if anyone else can be. */
export function godCandidates(s: RoomState): Player[] {
  const humans = humansHere(s);
  if (s.mode !== "cosmos") return humans;
  const bots = FACTION_IDS.filter((f) => humansIn(s, f).length === 0).map((f) => activeBot(s, f)).filter((b): b is Player => !!b);
  return [...humans.filter((p) => p.faction), ...bots];
}

function crown(s: RoomState, ch: Changes, until: number): void {
  let pool = godCandidates(s);
  if (pool.length > 1) pool = pool.filter((p) => p.id !== s.god.last);
  const r = rng(s.seed + s.tick * 2654435761);
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  let next: Player | null = null;
  if (pool.length) {
    if (s.mode === "cosmos") {
      const fs = [...new Set(pool.map((p) => p.faction!))];
      const fewest = Math.min(...fs.map((f) => s.factions[f]!.turns));
      const f = pick(fs.filter((x) => s.factions[x]!.turns === fewest));
      const inF = pool.filter((p) => p.faction === f);
      const humans = inF.filter((p) => !p.bot);
      const from = humans.length ? humans : inF;
      const least = Math.min(...from.map((p) => p.god.turns));
      next = pick(from.filter((p) => p.god.turns === least));
      s.factions[f]!.turns++;
    } else {
      const least = Math.min(...pool.map((p) => p.god.turns));
      next = pick(pool.filter((p) => p.god.turns === least));
    }
  }
  s.god.id = next ? next.id : null;
  s.god.until = until;
  if (next) {
    next.god.turns++;
    s.god.last = next.id;
    s.god.aim = Math.max(0, next.world);
    log(s, ch, `${next.name} is a god for ${Math.round(((until - s.tick) * TICK_MS) / 1000)} seconds.`);
  }
  ch.meta = true;
}

/** A Strike lands: stock in reach is destroyed (on the books), buildings fall, the ground dies. */
function explode(s: RoomState, wi: number, strike: Strike, ch: Changes): void {
  const w = s.worlds[wi];
  const st = STAGES[w.stage];
  const by = s.players[strike.byId];
  const fallen = new Set<number>();
  const cw = wc(ch, wi);
  let destroyed = 0;
  for (let y = Math.floor(strike.y - STRIKE_RADIUS); y <= Math.ceil(strike.y + STRIKE_RADIUS); y++)
    for (let x = Math.floor(strike.x - STRIKE_RADIUS); x <= Math.ceil(strike.x + STRIKE_RADIUS); x++) {
      const tile = tileAt(w, x, y);
      if (!tile || Math.hypot(x - strike.x, y - strike.y) > STRIKE_RADIUS) continue;
      if (tile.d && tile.amt > 0) {
        w.ledger[tile.d].remaining -= tile.amt;
        w.ledger[tile.d].destroyed += tile.amt;
        destroyed += tile.amt;
        tile.amt = 0;
      }
      remember(s, wi, tile, `was struck by ${strike.by}`, ch);
      if (tile.t !== 2) tile.life = 0;
      if (tile.b) fallen.add(tile.b);
      cw.tiles.add(y * w.w + x);
    }
  let down = 0;
  for (const id of fallen) {
    const b = w.buildings.find((q) => q.id === id)!;
    // the shared Depot and the World Engines are beyond even a god
    if (BUILDINGS[b.type].protected || BUILDINGS[b.type].renderValue) continue;
    fell(s, wi, b, ch);
    down++;
  }
  // the Sun's twist: a Flare adds heat
  if (st.id === "sun") w.heat = Math.min(100, w.heat + SUN_TWIST_HEAT);
  if (by) {
    by.god.destroyed += destroyed;
    by.god.felled += down;
  }
  cw.blasts.push([strike.x, strike.y]);
  cw.meta = true;
  const name = st.powers.strike;
  log(s, ch, down ? `${strike.by}'s ${name} landed on ${st.name} and took ${down} building${down === 1 ? "" : "s"} with it.` : `${strike.by}'s ${name} landed on ${st.name}.`, {
    key: `land:${strike.byId}:${wi}`,
    many: (n) => `${n} of ${strike.by}'s ${name}s have landed on ${st.name}.`,
  });
  ch.meta = true;
}

/** Gods change hands, blessings and hushes fade, strikes land. Runs every tick of play, gods on or not, so nothing is left ticking. */
function divine(s: RoomState, ch: Changes): void {
  const g = s.god;
  if (g.on) {
    const god = g.id ? s.players[g.id] : undefined;
    if (g.id && (s.tick >= g.until || !god?.connected)) {
      if (s.tick < g.until) crown(s, ch, g.until); // replaced at once, for the rest of the turn only
      else {
        g.id = null;
        g.next = s.tick + GOD_GAP_TICKS;
        log(s, ch, `${god?.name ?? "The god"} is mortal again.`);
        ch.meta = true;
      }
    }
    if (!g.id && s.tick >= g.next && g.next >= 0) {
      crown(s, ch, s.tick + GOD_TURN_TICKS);
      // nobody to crown: try again after a gap
      if (!g.id) g.next = s.tick + GOD_GAP_TICKS;
    }
  }
  s.worlds.forEach((w, wi) => {
    const cw = (): void => {
      wc(ch, wi).meta = true;
    };
    if (w.blessings.some((a) => a.until <= s.tick)) {
      w.blessings = w.blessings.filter((a) => a.until > s.tick);
      cw();
    }
    if (w.hushes.some((a) => a.until <= s.tick)) {
      w.hushes = w.hushes.filter((a) => a.until > s.tick);
      cw();
    }
    if (w.reserves.some((a) => a.until <= s.tick)) {
      w.reserves = w.reserves.filter((a) => a.until > s.tick);
      cw();
    }
    // forget rested ground now and then, so the maps stay small
    if (s.tick % 50 === 0) {
      for (const k of Object.keys(w.hushRest)) if (w.hushRest[+k] <= s.tick) delete w.hushRest[+k], delete w.hushUntil[+k];
      for (const k of Object.keys(w.reserveRest)) if (w.reserveRest[+k] <= s.tick) delete w.reserveRest[+k], delete w.reserveUntil[+k];
    }
    if (w.strikes.length && w.strikes.some((b) => b.at <= s.tick)) {
      const due = w.strikes.filter((b) => b.at <= s.tick);
      w.strikes = w.strikes.filter((b) => b.at > s.tick);
      // pending acts that land on a spent world do nothing
      if (!w.spent) for (const b of due) explode(s, wi, b, ch);
      cw();
      checkExhausted(s, wi, ch);
    }
  });
}

function withdraw(s: RoomState, p: Player, ch: Changes): void {
  if (!p.stop) return;
  p.stop = false;
  log(s, ch, `${p.name} went back to work.`);
}

function summarise(s: RoomState, wi: number): StageSummary {
  const w = s.worlds[wi];
  const st = STAGES[w.stage];
  return {
    stage: st.id,
    ledger: structuredClone(w.ledger),
    lifeStart: w.lifeStart,
    lifeEnd: averageLife(w),
    buildings: w.buildings.filter((b) => b.owner || b.f).length,
    ticks: s.tick - w.startTick,
    lost: s.archive.filter((a) => a.stage === st.id).map((a) => a.name),
    sown: w.sown,
    ...(s.mode === "cosmos" ? { took: { ...w.took } } : {}),
  };
}

/**
 * The restraint ending: if every human present agrees to stop, the campaign
 * ends with what's left still out there. It can't be undone, and absent
 * players can't block it (or make it happen) by staying away. Bots never vote.
 */
export function checkRestraint(s: RoomState, ch: Changes): void {
  const last = s.worlds.length - 1;
  const w = s.worlds[last];
  if (s.phase.k !== "play" || STAGES[w.stage].id !== "universe") return;
  if (s.mode === "cosmos" && !s.worlds.slice(0, -1).every((x) => x.spent)) return;
  const here = humansHere(s);
  if (here.length === 0 || !here.every((p) => p.stop)) return;
  const left = FAMILIES.reduce((a, f) => a + w.ledger[f].remaining, 0);
  if (left === 0) return;
  s.history.push(summarise(s, last));
  w.lifeEnd = averageLife(w);
  for (const t of w.tiles) if (t.mark) s.archive.push({ stage: "universe", name: t.mark.name, fate: "is still there" });
  s.archive.push({ stage: "universe", name: `${left} units of the Universe`, fate: "were left alone" });
  s.phase = { k: "ended", how: "restraint" };
  for (const p of Object.values(s.players)) p.dx = p.dy = 0;
  log(s, ch, "You stopped. The rest is still out there.");
  ch.meta = true;
  ch.boundary = true;
}

export function facingTo(dx: number, dy: number, fallback: number): number {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return fallback;
  return (Math.round((Math.atan2(dy, dx) / (Math.PI * 2)) * 8) + 8) % 8;
}

export const worldRemaining = (w: Pick<World, "ledger">): number => FAMILIES.reduce((a, f) => a + w.ledger[f].remaining, 0);

function checkExhausted(s: RoomState, wi: number, ch: Changes): void {
  if (s.phase.k !== "play") return;
  const w = s.worlds[wi];
  if (w.spent || worldRemaining(w) > 0) return;
  const st = STAGES[w.stage];
  for (const t of w.tiles) if (t.mark) {
    s.archive.push({ stage: st.id, name: t.mark.name, fate: `was left behind on spent ${st.name}` });
    delete t.mark;
  }
  const summary = summarise(s, wi);
  s.history.push(summary);
  log(s, ch, st.departure);
  ch.meta = true;
  ch.boundary = true;
  if (s.mode !== "cosmos") {
    s.phase = { k: "transition", until: s.tick + PACES[s.pace].transitionTicks, summary };
    return;
  }
  // a spent world stays on the map as a grey remnant; its strikes and zones go quiet
  w.spent = true;
  w.lifeEnd = summary.lifeEnd;
  w.strikes = [];
  w.blessings = [];
  w.hushes = [];
  w.reserves = [];
  for (const p of Object.values(s.players)) if (p.world === wi) p.stop = false;
  wc(ch, wi).meta = true;
  if (s.worlds.every((x) => x.spent)) {
    s.phase = { k: "ended", how: "consumed" };
    for (const p of Object.values(s.players)) p.dx = p.dy = 0;
    log(s, ch, "The engine keeps searching for a next frontier. There isn't one.");
  }
}

function nextStage(s: RoomState, ch: Changes): void {
  const leaving = STAGES[s.stage];
  if (s.stage === STAGES.length - 1) {
    s.phase = { k: "ended", how: "consumed" };
    for (const p of Object.values(s.players)) p.dx = p.dy = 0;
    log(s, ch, "The engine keeps searching for a next frontier. There isn't one.");
    ch.meta = true;
    ch.boundary = true;
    return;
  }
  if (leaving.id === "sun") s.reserve += s.worlds[0].ledger.matter.extracted * SUN_TO_RESERVE;
  s.stage++;
  s.gen++;
  const st = STAGES[s.stage];
  s.worlds[0] = newWorld(s.seed, s.stage, s.tick);
  s.phase = { k: "play" };
  const sp = spawnPoint(s.stage);
  Object.values(s.players).forEach((p, i) => {
    p.x = sp.x + (i % 3) - 1;
    p.y = sp.y + Math.floor(i / 3) * 0.8;
    p.dx = p.dy = 0;
    p.act = null;
    p.marks = 0;
    // what was carried belonged to the last world; the tools come along
    p.pack = emptyBundle();
  });
  s.receipts = Object.fromEntries(Object.keys(s.players).map((id) => [id, []]));
  log(s, ch, st.arrival);
  ch.meta = true;
  ch.boundary = true;
}

/** One server tick (TICK_MS). Movement every tick; the economy every PACES[pace].econEvery. */
export function tick(s: RoomState, ch: Changes): void {
  s.tick++;
  const dt = TICK_MS / 1000;
  for (const p of Object.values(s.players)) {
    if (p.act && p.act.until <= s.tick) p.act = null;
    if (!p.connected || p.world < 0 || s.phase.k === "ended" || (p.dx === 0 && p.dy === 0)) continue;
    const w = s.worlds[p.world];
    p.x = Math.max(0, Math.min(w.w - 1, p.x + p.dx * PLAYER_SPEED * dt));
    p.y = Math.max(0, Math.min(w.w - 1, p.y + p.dy * PLAYER_SPEED * dt));
    p.facing = facingTo(p.dx, p.dy, p.facing);
  }
  if (s.phase.k === "transition") {
    if (s.tick >= s.phase.until) nextStage(s, ch);
    return;
  }
  if (s.phase.k === "ended") return;
  if (s.mode === "cosmos") seats(s, ch);
  divine(s, ch);
  if (s.phase.k !== "play") return;
  if (s.ships.length && s.ships.some((sh) => sh.arrives <= s.tick)) {
    const due = s.ships.filter((sh) => sh.arrives <= s.tick);
    s.ships = s.ships.filter((sh) => sh.arrives > s.tick);
    for (const sh of due) arrive(s, sh, ch);
  }
  if (s.tick % PACES[s.pace].econEvery === 0) for (let wi = 0; wi < s.worlds.length; wi++) economy(s, wi, ch);
}

/** Cosmos: deal anyone who ignored the cards, and bring a bot back to a faction its humans left. */
function seats(s: RoomState, ch: Changes): void {
  for (const p of Object.values(s.players))
    if (p.connected && !p.bot && !p.faction && p.dealAt !== undefined && s.tick >= p.dealAt) setFaction(s, p, dealFaction(s, p.id), ch);
  for (const f of FACTION_IDS) {
    const fs = s.factions[f]!;
    if (humansIn(s, f).length > 0 || activeBot(s, f)) {
      fs.emptySince = null;
      continue;
    }
    fs.emptySince ??= s.tick;
    if (s.tick - fs.emptySince >= BOT_RETURN_TICKS) seatBot(s, f, ch);
  }
}

const setStatus = (b: Building, status: string, cw: WorldChanges): void => {
  if (b.status !== status) {
    b.status = status;
    cw.buildings.add(b.id);
  }
};

const ring = (w: World, b: Pick<Building, "x" | "y" | "type">): number[] => {
  const n = BUILDINGS[b.type].size;
  const out: number[] = [];
  for (let y = b.y - 1; y <= b.y + n; y++)
    for (let x = b.x - 1; x <= b.x + n; x++) {
      if (x >= b.x && x < b.x + n && y >= b.y && y < b.y + n) continue;
      if (inBounds(w, x, y)) out.push(y * w.w + x);
    }
  return out;
};

const within = (w: World, b: Building, radius: number): number[] => {
  const [cx, cy] = centre(b);
  const out: number[] = [];
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++)
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++)
      if (inBounds(w, x, y) && Math.max(Math.abs(x - cx), Math.abs(y - cy)) <= radius + 0.5) out.push(y * w.w + x);
  return out;
};

function economy(s: RoomState, wi: number, ch: Changes): void {
  const w = s.worlds[wi];
  if (w.spent && s.mode === "cosmos") return;
  const cw = wc(ch, wi);
  const cosmos = s.mode === "cosmos";
  w.econTicks++;
  const st = STAGES[w.stage];
  const built = w.buildings.filter(complete);
  for (const b of w.buildings) if (!complete(b)) {
    b.work = Math.min(BUILDINGS[b.type].build * 10, b.work + 10);
    cw.buildings.add(b.id);
    // a finished building earns its real status on the next tick, not a free one now
    if (complete(b)) setStatus(b, "starting up", cw);
  }
  // what a machine draws on: the shared stockpile in classic, its own faction's in cosmos
  const pool = (b: Building): Bundle | null => (cosmos ? (b.f ? stockOf(w, b.f) : null) : w.inventory);
  const of = (t: BuildingType): Building[] => built.filter((b) => b.type === t);
  const plazaTiles = new Set(of("plaza").flatMap((b) => ring(w, b)));

  // workers: cities house 2, or 5 when served last tick, +1 beside a plaza
  let workers = 0;
  for (const city of of("city")) {
    const served = city.status === "ok";
    const byPlaza = footprint(city).some(([x, y]) => plazaTiles.has(y * w.w + x));
    workers += 2 + (served ? 3 : 0) + (byPlaza ? 1 : 0);
  }
  const workersSupply = workers;

  // energy
  let energy = 0;
  for (const f of of("furnace")) {
    const fuel = pool(f);
    if (workers < 1) setStatus(f, "idle: no workers (build homes)", cw);
    else if (!fuel || fuel.matter < 1) setStatus(f, `idle: no ${st.families.matter.label} in the stockpile to burn`, cw);
    else {
      workers--;
      fuel.matter--;
      // the Foundry's passive: double power on the same fuel
      energy += BUILDINGS.furnace.energy * (f.f === "foundry" ? 2 : 1);
      setStatus(f, "ok", cw);
    }
  }
  for (const p of of("solar")) {
    energy += BUILDINGS.solar.energy * st.solarScale;
    setStatus(p, "ok", cw);
  }
  if (st.energySource === "bottled") energy = s.reserve;
  const energySupply = energy;

  let compute = 0;
  let engineCompute = 0;
  for (const e of of("engine")) {
    // in cosmos a World Engine only runs once the world it stands for is spent
    const of_ = e.name ? ENGINE_OF[e.name] : undefined;
    const source = cosmos && of_ ? s.worlds.find((x) => STAGES[x.stage].id === of_) : undefined;
    if (source && !source.spent) {
      setStatus(e, `dormant: ${STAGES[source.stage].name} is still alive`, cw);
      continue;
    }
    compute += BUILDINGS.engine.compute;
    engineCompute += BUILDINGS.engine.compute;
    setStatus(e, "ok", cw);
  }

  const take = (b: Building, opts: { pressure?: Set<number>; network?: Set<number> } = {}): boolean => {
    const def = BUILDINGS[b.type];
    const draw = pool(b);
    let why: string | null = null;
    if (opts.pressure && !footprint(b).some(([x, y]) => opts.pressure!.has(y * w.w + x))) why = "idle: outside a dome's air";
    else if (opts.network && !opts.network.has(b.id)) why = "idle: not linked to the Depot (build relays)";
    else if (energy < -def.energy) why = st.energySource === "bottled" ? "idle: the Bottled Sun is empty" : "idle: no power";
    else if (workers < -def.workers) why = "idle: no workers (build homes)";
    else if (compute < -def.compute) why = "idle: no compute (build a datacentre)";
    else if ((def.coolantUse ?? 0) > (draw?.coolant ?? 0)) why = `idle: no ${st.families.coolant.label} in the stockpile for cooling`;
    if (why) {
      setStatus(b, why, cw);
      return false;
    }
    energy += Math.min(0, def.energy);
    workers += Math.min(0, def.workers);
    compute += Math.min(0, def.compute);
    if (def.coolantUse && draw) draw.coolant -= def.coolantUse;
    setStatus(b, "ok", cw);
    return true;
  };

  const blessed = (b: Building): boolean => footprint(b).some(([x, y]) => inZone(w.blessings, s.tick, x, y, BLESS_RADIUS));
  // Mars: air comes from domes, and for a while from a god's Thin air
  let pressure: Set<number> | undefined;
  if (st.mechanic === "pressure") {
    pressure = new Set();
    for (const h of of("habitat")) if (take(h)) for (const i of within(w, h, BUILDINGS.habitat.pressureRadius!)) pressure.add(i);
    for (const a of w.blessings)
      if (a.until > s.tick)
        for (let y = Math.floor(a.y - BLESS_RADIUS); y <= Math.ceil(a.y + BLESS_RADIUS); y++)
          for (let x = Math.floor(a.x - BLESS_RADIUS); x <= Math.ceil(a.x + BLESS_RADIUS); x++)
            if (inBounds(w, x, y) && Math.hypot(x - a.x, y - a.y) <= BLESS_RADIUS) pressure.add(y * w.w + x);
  }
  // Solar System: relays link to the depot, and a god's Slipstream links whatever it touches
  let network: Set<number> | undefined;
  if (st.mechanic === "relay") {
    const nodes = [...of("depot"), ...of("relay").filter((r) => take(r))];
    network = new Set();
    const linked: Building[] = nodes.filter((n) => n.type === "depot");
    for (const n of linked) network.add(n.id);
    for (let i = 0; i < linked.length; i++) {
      const [ax, ay] = centre(linked[i]);
      const range = BUILDINGS[linked[i].type].relayRange!;
      for (const b of built) {
        if (network.has(b.id)) continue;
        const [bx, by] = centre(b);
        if (Math.max(Math.abs(ax - bx), Math.abs(ay - by)) <= range) {
          network.add(b.id);
          if (b.type === "relay" && b.status === "ok") linked.push(b);
        }
      }
    }
    for (const b of built) if (blessed(b)) network.add(b.id);
  }

  let supplied = engineCompute;
  for (const d of of("datacentre"))
    if (take(d, { pressure })) {
      compute += BUILDINGS.datacentre.compute;
      supplied += BUILDINGS.datacentre.compute;
      if (cosmos && d.f) s.factions[d.f]!.compute += BUILDINGS.datacentre.compute;
    }
  if (cosmos) s.computeTotal += supplied;
  const computeSupply = compute;
  for (const r of of("radiator")) take(r);

  const throttled = st.mechanic === "heat" && w.heat >= HEAT_LIMIT;
  let heat = 0;
  const machines = [...of("extractor"), ...of("seeder")];
  const seedersRunning: Building[] = [];
  for (const x of machines) {
    if (!take(x, { pressure, network })) continue;
    heat += BUILDINGS[x.type].heat ?? 0;
    if (throttled && w.econTicks % 2 === 0) {
      setStatus(x, "throttled: too hot (build radiators)", cw);
      continue;
    }
    const targets = ring(w, x).filter((i) => w.tiles[i].d && w.tiles[i].amt > 0 && !lockProblem(w, i, s.tick));
    if (targets.length === 0) {
      setStatus(x, ring(w, x).some((i) => w.tiles[i].d && w.tiles[i].amt > 0) ? "idle: what's beside it is hushed or reserved" : "idle: nothing left to harvest beside it", cw);
      continue;
    }
    targets.sort((a, b) => w.tiles[b].amt - w.tiles[a].amt);
    const into = pool(x);
    if (into) takeFrom(s, wi, targets[0], BUILDINGS[x.type].extract!, into, x.f, ch);
    if (x.type === "seeder") seedersRunning.push(x);
  }
  // the Automata's Seeder: while running, it pays for and places a copy of itself beside it
  if (cosmos && seedersRunning.length && w.econTicks % SEEDER_EVERY === 0) {
    for (const sd of seedersRunning) {
      if (w.buildings.filter((b) => b.type === "seeder").length >= SEEDER_CAP) break;
      const spot = ring(w, sd).find((i) => placementProblem(s, w, "seeder", i % w.w, Math.floor(i / w.w), { f: sd.f }) === null);
      if (spot === undefined) continue;
      const b = raise(s, wi, "seeder", spot % w.w, Math.floor(spot / w.w), null, ch, sd.f);
      b.owner = sd.owner;
      w.seeded++;
      break;
    }
  }
  // the Foundry's Smelter: 3 matter for 1 mineral, so it can never loop
  for (const sm of of("smelter")) {
    const p = pool(sm);
    if (!take(sm)) continue;
    if (!p || p.matter < SMELTER_IN) {
      setStatus(sm, `idle: needs ${SMELTER_IN} ${st.families.matter.label} in the stockpile`, cw);
      continue;
    }
    p.matter -= SMELTER_IN;
    p.mineral += 1;
  }
  for (const city of of("city")) {
    const def = BUILDINGS.city;
    if (energy >= -def.energy && compute >= -def.compute) {
      energy += def.energy;
      compute += def.compute;
      setStatus(city, "ok", cw);
    } else setStatus(city, energy < -def.energy ? "unserved: no power (houses fewer)" : "unserved: no compute (houses fewer)", cw);
  }
  for (const p of of("plaza")) setStatus(p, "ok", cw);
  for (const p of of("pad")) setStatus(p, "ok", cw);

  if (st.energySource === "bottled") s.reserve = Math.max(0, energy);

  // the Sun: heat builds with collectors and computation, radiators shed it
  if (st.mechanic === "heat") {
    for (const b of built) if (b.status === "ok" && b.type !== "extractor" && b.type !== "seeder") heat += BUILDINGS[b.type].heat ?? 0;
    heat += of("solar").length * 4;
    for (const r of of("radiator")) if (r.status === "ok") heat -= BUILDINGS.radiator.cooling!;
    const next = Math.max(0, Math.min(100, w.heat + heat - 2));
    if (next !== w.heat) cw.meta = true;
    w.heat = next;
  }

  // pollution: smoke browns the land and burns groves; extraction scars around it
  for (const b of built) {
    const pol = BUILDINGS[b.type].pollution;
    if (!pol || b.status !== "ok") continue;
    // the Foundry's weakness: its smoke reaches one tile further
    const radius = pol.radius + (b.type === "furnace" && b.f === "foundry" ? 1 : 0);
    const reach = within(w, b, radius);
    for (const i of reach) {
      const t = w.tiles[i];
      if (t.t === 2 || t.life === 0) continue;
      t.life = Math.max(0, t.life - pol.amount);
      cw.tiles.add(i);
    }
    if (pol.burnsMatter) {
      const grove = reach.find((i) => w.tiles[i].d === "matter" && w.tiles[i].amt > 0);
      if (grove !== undefined) {
        const t = w.tiles[grove];
        const burnt = Math.min(pol.burnsMatter, t.amt);
        t.amt -= burnt;
        w.ledger.matter.remaining -= burnt;
        w.ledger.matter.destroyed += burnt;
        t.life = Math.min(t.life, Math.round((t.amt / t.init) * 60));
        cw.tiles.add(grove);
        if (t.amt === 0) remember(s, wi, t, "burnt away in the smoke", ch);
      }
    }
  }

  const econ = {
    energySupply,
    energyUsed: energySupply - Math.max(0, energy),
    computeSupply,
    computeUsed: computeSupply - compute,
    workersSupply,
    workersUsed: workersSupply - workers,
  };
  if (JSON.stringify(econ) !== JSON.stringify(w.econ)) cw.meta = true;
  w.econ = econ;
  if (cosmos) cw.meta = true;
  checkExhausted(s, wi, ch);
}

/** Total stock left on the active world (classic) or every world (cosmos); used by tests and the HUD. */
export const totalRemaining = (s: RoomState): number => s.worlds.reduce((a, w) => a + worldRemaining(w), 0);

/** initial = remaining + extracted + destroyed, per family, and remaining matches the tiles: on every world. */
export function ledgerHolds(s: Pick<RoomState, "worlds">): boolean {
  for (const w of s.worlds)
    for (const f of FAMILIES) {
      const l = w.ledger[f];
      const onTiles = w.tiles.reduce((a, t) => a + (t.d === f ? t.amt : 0), 0);
      if (l.initial !== l.remaining + l.extracted + l.destroyed || onTiles !== l.remaining) return false;
    }
  return true;
}

/** Stock in flight is in a ship or a stockpile, never neither: launched - landed = what the ships hold. */
export function transitHolds(s: Pick<RoomState, "ships" | "transit">): boolean {
  for (const f of FAMILIES) {
    const aboard = s.ships.reduce((a, sh) => a + sh.cargo[f], 0);
    if (s.transit.launched[f] - s.transit.landed[f] !== aboard || aboard < 0) return false;
  }
  return true;
}

export const bundleOk = (b: Bundle): boolean => FAMILIES.every((f) => Number.isSafeInteger(b[f]) && b[f] >= 0);

/** Every stockpile and pack in the room is whole and non-negative. */
export function inventoriesOk(s: RoomState): boolean {
  for (const w of s.worlds) {
    if (!bundleOk(w.inventory)) return false;
    for (const b of Object.values(w.stock)) if (b && !bundleOk(b)) return false;
  }
  return Object.values(s.players).every((p) => bundleOk(p.pack)) && s.ships.every((sh) => bundleOk(sh.cargo));
}

/** A faction's own measure, as a number: shares for Foundry and Automata, units for Brokers, life for Stewards. */
export function measure(s: RoomState, f: FactionId): number {
  const fs = s.factions[f];
  if (!fs) return 0;
  switch (f) {
    case "foundry": {
      const all = FACTION_IDS.reduce((a, g) => a + (s.factions[g]?.took ?? 0), 0);
      return all ? fs.took / all : 0;
    }
    case "automata":
      return s.computeTotal ? fs.compute / s.computeTotal : 0;
    case "brokers":
      return fs.carried;
    case "stewards":
      return Math.round(s.worlds.reduce((a, w) => a + (w.spent ? (w.lifeEnd ?? averageLife(w)) : averageLife(w)), 0) / Math.max(1, s.worlds.length));
  }
}

export const reachedPar = (s: RoomState, f: FactionId): boolean => measure(s, f) >= FACTIONS[f].par;

/** The faction furthest below its own par, as a fraction of it: the one the catch-up lever helps. */
export function furthestFromPar(s: RoomState): FactionId | null {
  if (s.mode !== "cosmos") return null;
  let worst: FactionId | null = null;
  let wr = Infinity;
  for (const f of FACTION_IDS) {
    const r = measure(s, f) / FACTIONS[f].par;
    if (r < wr) [wr, worst] = [r, f];
  }
  return wr < 1 ? worst : null;
}

/** A faction's measure in words, beside its par: facts, never a verdict. */
export function measureText(s: RoomState, f: FactionId): string {
  const m = measure(s, f);
  const par = FACTIONS[f].par;
  const pct = (x: number): string => `${Math.round(x * 100)}%`;
  switch (f) {
    case "foundry":
      return `took ${pct(m)} of everything taken. Par ${pct(par)}.`;
    case "automata":
      return `supplied ${pct(m)} of all compute. Par ${pct(par)}.`;
    case "brokers":
      return `carried ${m} units through its Pads. Par ${par}.`;
    case "stewards":
      return `the land across five worlds averages ${m}% alive. Par ${par}%.`;
  }
}

/** The thin picture of every world the orbital map draws. */
export function summaries(s: RoomState): WorldSummary[] {
  return s.worlds.map((w, wi) => {
    const stake: Partial<Record<FactionId, number>> = {};
    for (const b of w.buildings) if (b.f) stake[b.f] = (stake[b.f] ?? 0) + 1;
    return {
      stage: w.stage,
      spent: w.spent,
      life: w.spent ? (w.lifeEnd ?? 0) : averageLife(w),
      left: worldRemaining(w),
      total: FAMILIES.reduce((a, f) => a + w.ledger[f].initial, 0),
      stake,
      present: Object.values(s.players).filter((p) => p.connected && p.world === wi).map((p) => p.id),
      strikes: w.strikes.map((b) => ({ at: b.at })),
      blessings: w.blessings.length,
      hushes: w.hushes.length,
    };
  });
}

export type { Family };
