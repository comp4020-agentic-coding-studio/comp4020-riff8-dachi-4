// The wire protocol between browser and game server. Versioned: a client and
// server that disagree on PROTOCOL_VERSION refuse each other rather than
// guess. All messages are JSON text frames.
import type { Bundle, BuildingType, Emote, FactionId, Family, GodPower, Pace, StageId, ToolLevels } from "./content.ts";

export const PROTOCOL_VERSION = 4;
export const SCHEMA_VERSION = 4;
export const MAX_MESSAGE_BYTES = 2048;

export type Terrain = 0 | 1 | 2 | 3 | 4; // ground, water/ice, void, stellar core, remnant

export interface Tile {
  t: Terrain;
  /** deposit family, or null for no natural stock */
  d: Family | null;
  amt: number;
  init: number;
  /** 0..100: how alive (or, off Earth, how untouched) the tile is */
  life: number;
  /** id of the building covering this tile, 0 if none */
  b: number;
  mark?: { name: string; by: string };
  /** label for remnant regions (spent worlds) */
  ghost?: string;
}

export interface Building {
  id: number;
  /** a god's Gift: free, so taking it down salvages nothing */
  gift?: boolean;
  type: BuildingType;
  x: number;
  y: number;
  owner: string | null;
  /** the owner's faction, in cosmos: kept even if the owner is forgotten */
  f?: FactionId;
  /** work units done; complete at BUILDINGS[type].build * 10 */
  work: number;
  /** "ok", or why it's idle: shown to players as text, never colour alone */
  status: string;
  name?: string;
}

export interface PlayerStats {
  harvested: number;
  built: number;
  helped: number;
}

export interface Player {
  id: string;
  name: string;
  colour: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  facing: number;
  act: { k: "harvest" | "build" | "emote"; until: number; e?: Emote } | null;
  connected: boolean;
  joinedTick: number;
  nextHarvest: number;
  nextEmote: number;
  marks: number;
  /** what this player carries: hand harvests land here, and only they can spend or deposit it */
  pack: Bundle;
  /** tier of each family's hand tool, 0 for bare hands; kept across worlds */
  tools: ToolLevels;
  /** in the Universe: this player wants to stop and leave the rest alone */
  stop?: boolean;
  stats: PlayerStats;
  /** index into RoomState.worlds of the world they stand on; -1 while in flight */
  world: number;
  /** cosmos: their faction, once chosen or dealt */
  faction?: FactionId;
  /** cosmos: true once they have harvested or built, after which the faction is fixed */
  locked?: boolean;
  /** a server-side bot holding a faction with no human: never a socket, never a vote */
  bot?: boolean;
  /** cosmos: a human with no faction is dealt one at this tick */
  dealAt?: number;
  /** the ship they're on, while in flight */
  ship?: number;
  /** what this player has done as a god, across the whole campaign */
  god: GodRecord;
}

export interface GodRecord {
  turns: number;
  sown: number;
  destroyed: number;
  felled: number;
  gifted: number;
  /** harvests other people made under this god's Bless */
  blessed: number;
  /** ticks of Hush laid */
  hushed: number;
}

export interface GodState {
  /** the host's switch */
  on: boolean;
  /** who is a god right now, if anyone */
  id: string | null;
  /** tick their turn ends */
  until: number;
  /** tick the next turn starts, during a gap */
  next: number;
  /** who was the last god, so nobody goes twice running */
  last: string | null;
  /** cosmos: the world the god is aiming at, so everyone can see it */
  aim: number;
  /** acts made so far, for ids */
  made: number;
}

/** A called Strike: lands at tick `at`. */
export interface Strike {
  id: number;
  x: number;
  y: number;
  at: number;
  by: string;
  byId: string;
}

/** A Bless or a Hush: a circle on the ground until `until`. */
export interface Zone {
  id: number;
  x: number;
  y: number;
  until: number;
  by: string;
  byId: string;
}

/** A Steward Reserve: a deposit and its neighbours, locked from harvest for a while. */
export interface Reserve {
  x: number;
  y: number;
  until: number;
  f: FactionId;
}

/** A ship between worlds: what it carries is in neither stockpile until it lands. */
export interface Ship {
  id: number;
  from: number;
  to: number;
  departs: number;
  arrives: number;
  /** the faction that paid, and the faction the cargo is addressed to */
  f: FactionId;
  to_f: FactionId;
  passengers: string[];
  cargo: Bundle;
}

export interface LedgerEntry {
  initial: number;
  remaining: number;
  extracted: number;
  destroyed: number;
}
export type Ledger = Record<Family, LedgerEntry>;

export interface Econ {
  energySupply: number;
  energyUsed: number;
  computeSupply: number;
  computeUsed: number;
  workersSupply: number;
  workersUsed: number;
}

export interface StageSummary {
  stage: StageId;
  ledger: Ledger;
  lifeStart: number;
  lifeEnd: number;
  buildings: number;
  ticks: number;
  lost: string[];
  sown?: number;
  /** cosmos: who took what here, by faction */
  took?: Partial<Record<FactionId, number>>;
}

export interface ArchiveEntry {
  stage: StageId;
  name: string;
  fate: string;
}

export interface LogEntry {
  id: number;
  tick: number;
  text: string;
  /** repeated god acts fold into one line: same key, a count */
  key?: string;
  n?: number;
}

export type Phase =
  | { k: "play" }
  | { k: "transition"; until: number; summary: StageSummary }
  | { k: "ended"; how?: "consumed" | "restraint" };

export type Mode = "classic" | "cosmos";
export type FactionPick = "choose" | "deal" | "either";

/** One world: its land, its machines, its books. Every per-world rule takes one of these. */
export interface World {
  stage: number;
  w: number;
  tiles: Tile[];
  buildings: Building[];
  nextBuildingId: number;
  /** classic: the one shared stockpile. Zero and unused in cosmos */
  inventory: Bundle;
  /** cosmos: a stockpile per faction on this world */
  stock: Partial<Record<FactionId, Bundle>>;
  ledger: Ledger;
  econ: Econ;
  heat: number;
  econTicks: number;
  lifeStart: number;
  startTick: number;
  /** cosmos: a spent world stays on the map as a remnant */
  spent: boolean;
  lifeEnd?: number;
  /** stock a god has added here, against SOW_CAP of what it was generated with */
  sown: number;
  generated: number;
  strikes: Strike[];
  blessings: Zone[];
  hushes: Zone[];
  /** tile index -> tick its Hush lapses, and tick it may be hushed again */
  hushUntil: Record<number, number>;
  hushRest: Record<number, number>;
  reserves: Reserve[];
  reserveUntil: Record<number, number>;
  reserveRest: Record<number, number>;
  /** stock taken here, by faction */
  took: Partial<Record<FactionId, number>>;
  /** factions that have had their starter crate here */
  landed: FactionId[];
  seeded: number;
}

export interface FactionState {
  /** the bot's player id while the bot holds the seat */
  bot: string | null;
  /** tick since which the faction has had no connected human */
  emptySince: number | null;
  turns: number;
  /** goal measures */
  took: number;
  compute: number;
  carried: number;
}

/** Everything a room is. JSON-serialisable: this is exactly what gets saved. */
export interface RoomState {
  v: number;
  code: string;
  seed: number;
  pace: Pace;
  mode: Mode;
  pick: FactionPick;
  hostId: string | null;
  tick: number;
  seq: number;
  gen: number;
  /** classic: which stage the one world is */
  stage: number;
  phase: Phase;
  worlds: World[];
  /** the Bottled Sun: one for the whole room */
  reserve: number;
  god: GodState;
  ships: Ship[];
  nextShipId: number;
  /** stock launched and landed so far: what's in ships is always the difference */
  transit: { launched: Bundle; landed: Bundle };
  /** compute-ticks supplied by every machine in the room, for the Automata's share */
  computeTotal: number;
  factions: Partial<Record<FactionId, FactionState>>;
  history: StageSummary[];
  archive: ArchiveEntry[];
  players: Record<string, Player>;
  /** player id -> session token (secret; never sent to other clients) */
  tokens: Record<string, string>;
  /** player id -> recent command ids, for duplicate suppression */
  receipts: Record<string, string[]>;
  log: LogEntry[];
  logId: number;
}

/** The thin picture of a world the orbital map draws, sent for every world at 1 Hz. */
export interface WorldSummary {
  stage: number;
  spent: boolean;
  life: number;
  left: number;
  total: number;
  /** building counts per faction */
  stake: Partial<Record<FactionId, number>>;
  present: string[];
  strikes: { at: number }[];
  blessings: number;
  hushes: number;
}

export type Command =
  | { k: "move"; dx: number; dy: number }
  | { k: "harvest"; x: number; y: number }
  | { k: "build"; x: number; y: number; type: BuildingType }
  | { k: "demolish"; x: number; y: number }
  | { k: "emote"; e: Emote }
  | { k: "mark"; x: number; y: number; name: string }
  | { k: "craft"; tool: Family }
  | { k: "deposit" }
  | { k: "god"; power: GodPower; x: number; y: number; family?: Family; world?: number }
  | { k: "gods"; on: boolean }
  | { k: "aim"; world: number }
  | { k: "stop"; on: boolean }
  | { k: "faction"; f: FactionId | "deal" }
  | { k: "transfer"; to: FactionId; cargo: Bundle }
  | { k: "launch"; x: number; y: number; to: number; cargo: Bundle; to_f?: FactionId; go?: boolean }
  | { k: "reserve"; x: number; y: number };

export type ClientMsg =
  | { t: "hello"; v: number; room: string; token?: string; name: string }
  | { t: "cmd"; id: string; inc: string; gen: number; c: Command; w?: number }
  | { t: "view"; world: number }
  | { t: "sync" }
  | { t: "ping"; n: number };

/** What a client sees of the room: the state minus secrets, with the world it's viewing laid out at the top. */
export type Snapshot = Omit<RoomState, "tokens" | "receipts" | "worlds"> & World & { viewing: number; summaries: WorldSummary[] };

export type WorldMeta = Pick<World, "inventory" | "stock" | "ledger" | "econ" | "heat" | "spent" | "strikes" | "blessings" | "hushes" | "reserves" | "sown" | "lifeStart" | "landed" | "took">;

export interface Delta {
  t: "delta";
  seq: number;
  gen: number;
  tick: number;
  /** players whose non-movement fields changed, in full */
  players: Player[];
  /** everyone else who moved: [id, x, y, dx, dy, facing], positions to 0.01 tile */
  moves?: [string, number, number, number, number, number][];
  tiles?: [number, Tile][];
  buildings?: Building[];
  removed?: number[];
  /** which world the tiles, buildings, blasts and world fields belong to */
  vw: number;
  /** strikes that landed in this delta on the viewed world: [x, y] */
  blasts?: [number, number][];
  meta?: Pick<RoomState, "reserve" | "phase" | "hostId" | "god" | "ships" | "factions" | "computeTotal" | "transit"> & Partial<Pick<RoomState, "archive" | "history">>;
  world?: WorldMeta;
  summaries?: WorldSummary[];
  log?: LogEntry[];
}

export type ServerMsg =
  | { t: "welcome"; v: number; inc: string; you: string; token: string; snap: Snapshot }
  | Delta
  | { t: "ack"; id: string; ok: boolean; reason?: string }
  | { t: "error"; reason: string }
  | { t: "pong"; n: number };
