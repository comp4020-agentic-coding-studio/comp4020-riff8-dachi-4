// The wire protocol between browser and game server. Versioned: a client and
// server that disagree on PROTOCOL_VERSION refuse each other rather than
// guess. All messages are JSON text frames.
import type { Bundle, BuildingType, Emote, Family, GodPower, Pace, StageId, ToolLevels } from "./content.ts";

export const PROTOCOL_VERSION = 3;
export const SCHEMA_VERSION = 3;
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
  type: BuildingType;
  x: number;
  y: number;
  owner: string | null;
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
}

export interface GodState {
  /** the host's switch */
  on: boolean;
  /** who is a god right now, if anyone */
  id: string | null;
  /** tick their turn ends */
  until: number;
  /** tick the god may next act */
  ready: number;
  /** bombs and auras made so far, for ids */
  made: number;
}

export interface Bomb {
  id: number;
  x: number;
  y: number;
  /** tick it goes off */
  at: number;
  by: string;
}

export interface Aura {
  id: number;
  x: number;
  y: number;
  /** tick it fades */
  until: number;
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
}

export interface ArchiveEntry {
  stage: StageId;
  name: string;
  fate: string;
}

export interface LogEntry {
  tick: number;
  text: string;
}

export type Phase =
  | { k: "play" }
  | { k: "transition"; until: number; summary: StageSummary }
  | { k: "ended"; how?: "consumed" | "restraint" };

/** Everything a room is. JSON-serialisable: this is exactly what gets saved. */
export interface RoomState {
  v: number;
  code: string;
  seed: number;
  pace: Pace;
  hostId: string | null;
  tick: number;
  seq: number;
  gen: number;
  stage: number;
  stageStartTick: number;
  lifeStart: number;
  econTicks: number;
  phase: Phase;
  w: number;
  tiles: Tile[];
  buildings: Building[];
  nextBuildingId: number;
  /** the shared stockpile: machines fill it and draw on it, players deposit into it */
  inventory: Bundle;
  ledger: Ledger;
  econ: Econ;
  heat: number;
  reserve: number;
  god: GodState;
  bombs: Bomb[];
  auras: Aura[];
  history: StageSummary[];
  archive: ArchiveEntry[];
  players: Record<string, Player>;
  /** player id -> session token (secret; never sent to other clients) */
  tokens: Record<string, string>;
  /** player id -> recent command ids, for duplicate suppression */
  receipts: Record<string, string[]>;
  log: LogEntry[];
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
  | { k: "god"; power: GodPower; x: number; y: number; family?: Family }
  | { k: "gods"; on: boolean }
  | { k: "stop"; on: boolean };

export type ClientMsg =
  | { t: "hello"; v: number; room: string; token?: string; name: string }
  | { t: "cmd"; id: string; inc: string; gen: number; c: Command }
  | { t: "sync" }
  | { t: "ping"; n: number };

/** What a client sees of the room: the state minus secrets. */
export type Snapshot = Omit<RoomState, "tokens" | "receipts">;

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
  /** bombs that went off in this delta: [x, y] */
  blasts?: [number, number][];
  meta?: Pick<RoomState, "inventory" | "ledger" | "econ" | "heat" | "reserve" | "phase" | "hostId" | "god" | "bombs" | "auras"> &
    Partial<Pick<RoomState, "archive" | "history">>;
  log?: LogEntry[];
}

export type ServerMsg =
  | { t: "welcome"; v: number; inc: string; you: string; token: string; snap: Snapshot }
  | Delta
  | { t: "ack"; id: string; ok: boolean; reason?: string }
  | { t: "error"; reason: string }
  | { t: "pong"; n: number };
