// Live rooms: exactly one in-memory owner per room, inside this one process.
// Rooms with nobody connected pause (no ticks) and are unloaded after a
// minute, so an empty campaign never advances while its players are away.
import { randomBytes, randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, type ClientMsg, type Delta, type FactionPick, type Mode, type Player, type RoomState, type ServerMsg, type Snapshot } from "../shared/protocol.ts";
import { PACES, TICK_MS, type Pace } from "../shared/content.ts";
import { applyCommand, createRoom, join, leave, newChanges, summaries, tick, type Changes } from "../shared/sim.ts";
import { runBots } from "../shared/bots.ts";
import { loadRoom, roomExists, saveRoom } from "./store.ts";

const SAVE_EVERY_MS = 5000;
const UNLOAD_AFTER_MS = 60_000;
const MAX_CATCHUP_TICKS = 3;

interface Conn {
  ws: WebSocket;
  pid: string | null;
  /** the world this browser is looking at: where its deltas come from */
  view: number;
  tokens: number;
  lastRefill: number;
}

interface LiveRoom {
  s: RoomState;
  /** fresh every time the room is loaded into memory: clients must resync on change */
  inc: string;
  conns: Set<Conn>;
  dirty: boolean;
  lastSave: number;
  emptySince: number | null;
  lastTickAt: number;
  sentPlayers: Map<string, string>;
  sentMoves: Map<string, string>;
  sentArchive: number;
  sentHistory: number;
  sentSummaries: string;
  ch: Changes;
}

const rooms = new Map<string, LiveRoom>();
export const stats = { tickMsMax: 0, tickMsLast: 0, bytesOut: 0, msgsIn: 0 };

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function createNewRoom(pace: Pace, gods = false, mode: Mode = "classic", pick: FactionPick = "either"): string {
  let code = "";
  do {
    code = Array.from(randomBytes(5), (b) => ALPHABET[b % ALPHABET.length]).join("");
  } while (roomExists(code));
  const s = createRoom(code, randomBytes(4).readUInt32LE(0), pace, gods, mode, pick);
  saveRoom(s);
  return code;
}

function live(code: string): LiveRoom | null {
  let r = rooms.get(code);
  if (r) return r;
  const s = loadRoom(code);
  if (!s) return null;
  for (const p of Object.values(s.players)) {
    // bots keep their seats across a reload; people reconnect for themselves
    if (!p.bot) p.connected = false;
    p.dx = p.dy = 0;
  }
  r = { s, inc: randomUUID().slice(0, 8), conns: new Set(), dirty: false, lastSave: Date.now(), emptySince: Date.now(), lastTickAt: Date.now(), sentPlayers: new Map(), sentMoves: new Map(), sentArchive: s.archive.length, sentHistory: s.history.length, sentSummaries: "", ch: newChanges() };
  rooms.set(code, r);
  return r;
}

/** The room minus its secrets, with the viewed world's fields laid out at the top. */
export const snapshot = (s: RoomState, view: number): Snapshot => {
  const { tokens: _t, receipts: _r, worlds, ...room } = s;
  const vw = worlds[view] ? view : 0;
  return { ...room, ...worlds[vw], viewing: vw, summaries: summaries(s) };
};

/** Where a newly joined or reconnected browser looks first: the world its player stands on. */
const homeView = (s: RoomState, pid: string): number => Math.max(0, s.players[pid]?.world ?? 0);

function send(c: Conn, msg: ServerMsg): void {
  if (c.ws.readyState !== c.ws.OPEN) return;
  // a slow client whose buffer is backing up gets dropped rather than stall or bloat the room
  if (c.ws.bufferedAmount > 1_000_000) {
    c.ws.close(1013, "too far behind");
    return;
  }
  const text = JSON.stringify(msg);
  stats.bytesOut += text.length;
  c.ws.send(text);
}

function welcome(r: LiveRoom, c: Conn): void {
  if (!c.pid) return;
  if (!r.s.worlds[c.view]) c.view = 0;
  send(c, { t: "welcome", v: PROTOCOL_VERSION, inc: r.inc, you: c.pid, token: r.s.tokens[c.pid], snap: snapshot(r.s, c.view) });
}

function save(r: LiveRoom): void {
  saveRoom(r.s);
  r.dirty = false;
  r.lastSave = Date.now();
}

/** Turn accumulated changes into one delta for everyone. */
function flush(r: LiveRoom): void {
  const ch = r.ch;
  const s = r.s;
  if (ch.boundary) {
    // persist the boundary before anyone hears about it
    save(r);
    r.ch = newChanges();
    r.sentPlayers.clear();
    r.sentMoves.clear();
    for (const c of r.conns) welcome(r, c);
    return;
  }
  // walking is most of the traffic: send it as compact tuples, and whole
  // player records only when something besides position changed
  const players: Player[] = [];
  const moves: NonNullable<Delta["moves"]> = [];
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  for (const p of Object.values(s.players)) {
    const { x, y, dx, dy, facing, nextHarvest: _h, nextEmote: _e, ...rest } = p;
    const full = JSON.stringify(rest);
    const motion = `${r2(x)},${r2(y)},${dx},${dy},${facing}`;
    if (r.sentPlayers.get(p.id) !== full) {
      r.sentPlayers.set(p.id, full);
      r.sentMoves.set(p.id, motion);
      players.push(p);
    } else if (r.sentMoves.get(p.id) !== motion) {
      r.sentMoves.set(p.id, motion);
      moves.push([p.id, r2(x), r2(y), dx, dy, facing]);
    }
  }
  // the orbital map's picture of every world, at most once a second and only when it changed
  let sums: Delta["summaries"];
  if (s.mode === "cosmos" && (s.tick % 10 === 0 || ch.meta)) {
    const all = summaries(s);
    const text = JSON.stringify(all);
    if (text !== r.sentSummaries) {
      r.sentSummaries = text;
      sums = all;
    }
  }
  const any = players.length || moves.length || ch.w.size || ch.meta || ch.logIds.size || sums;
  if (!any) return;
  s.seq++;
  const base: Delta = { t: "delta", seq: s.seq, gen: s.gen, tick: s.tick, players, vw: 0 };
  if (moves.length) base.moves = moves;
  if (ch.meta) {
    base.meta = { reserve: s.reserve, phase: s.phase, hostId: s.hostId, god: s.god, ships: s.ships, factions: s.factions, computeTotal: s.computeTotal, transit: s.transit };
    // the archive and history only ever grow: resend them only when they have
    if (s.archive.length !== r.sentArchive) base.meta.archive = s.archive;
    if (s.history.length !== r.sentHistory) base.meta.history = s.history;
    r.sentArchive = s.archive.length;
    r.sentHistory = s.history.length;
  }
  if (sums) base.summaries = sums;
  if (ch.logIds.size) base.log = s.log.filter((l) => ch.logIds.has(l.id));
  // one delta per viewed world, built once and sent to everyone looking at it
  const byView = new Map<number, Delta>();
  const forView = (vw: number): Delta => {
    let d = byView.get(vw);
    if (d) return d;
    d = { ...base, vw };
    const wch = ch.w.get(vw);
    const w = s.worlds[vw];
    if (wch && w) {
      if (wch.tiles.size) d.tiles = [...wch.tiles].map((i) => [i, w.tiles[i]]);
      if (wch.buildings.size) d.buildings = w.buildings.filter((b) => wch.buildings.has(b.id));
      if (wch.removed.length) d.removed = wch.removed;
      if (wch.blasts.length) d.blasts = wch.blasts;
      if (wch.meta || wch.tiles.size) {
        const { inventory, stock, ledger, econ, heat, spent, strikes, blessings, hushes, reserves, sown, lifeStart, landed, took } = w;
        d.world = { inventory, stock, ledger, econ, heat, spent, strikes, blessings, hushes, reserves, sown, lifeStart, landed, took };
      }
    }
    byView.set(vw, d);
    return d;
  };
  r.dirty = true;
  r.ch = newChanges();
  for (const c of r.conns) if (c.pid) send(c, forView(c.view));
}

export function stepAll(): void {
  const now = Date.now();
  const t0 = performance.now();
  for (const [code, r] of rooms) {
    if (r.conns.size === 0) {
      r.lastTickAt = now;
      if (r.dirty) save(r);
      if (r.emptySince && now - r.emptySince > UNLOAD_AFTER_MS) rooms.delete(code);
      continue;
    }
    // catch up after a stall, but never more than a few ticks: no runaway economy
    let due = Math.floor((now - r.lastTickAt) / TICK_MS);
    if (due > MAX_CATCHUP_TICKS) {
      r.lastTickAt = now - MAX_CATCHUP_TICKS * TICK_MS;
      due = MAX_CATCHUP_TICKS;
    }
    try {
      for (let i = 0; i < due; i++) {
        tick(r.s, r.ch);
        // bots play through the same applyCommand as everyone, and only while a human keeps the room awake
        runBots(r.s, r.ch);
        r.lastTickAt += TICK_MS;
        if (r.ch.boundary) break;
      }
      flush(r);
      if (r.dirty && now - r.lastSave > SAVE_EVERY_MS) save(r);
    } catch (err) {
      // one room's failure mustn't stop the others; it resumes from its last save on next load
      console.error(`room ${code}:`, err);
      for (const c of r.conns) c.ws.close(1011, "room error");
      rooms.delete(code);
    }
  }
  stats.tickMsLast = performance.now() - t0;
  stats.tickMsMax = Math.max(stats.tickMsMax, stats.tickMsLast);
}

export function saveAll(): void {
  for (const r of rooms.values()) save(r);
}

export const roomCount = (): number => rooms.size;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const perIp = new Map<string, number>();
// generous: a whole class on campus Wi-Fi can share one public address
const MAX_SOCKETS_PER_IP = 32;

export function attach(ws: WebSocket, ip: string): void {
  // one machine opening many sockets can't take every seat or multiply its rate limit
  const open = perIp.get(ip) ?? 0;
  if (open >= MAX_SOCKETS_PER_IP) {
    ws.close(1013, "too many connections from one address");
    return;
  }
  perIp.set(ip, open + 1);
  const c: Conn = { ws, pid: null, view: 0, tokens: 60, lastRefill: Date.now() };
  let room: LiveRoom | null = null;
  const fail = (reason: string): void => send(c, { t: "error", reason });

  ws.on("message", (raw, isBinary) => {
    // a throw in here would take every room down with it: contain it to this message
    try {
      onMessage(raw.toString(), isBinary);
    } catch (err) {
      console.error("message handler:", err);
      fail("server error");
    }
  });

  const onMessage = (text: string, isBinary: boolean): void => {
    stats.msgsIn++;
    // token bucket: 40 messages a second sustained, bursts of 60
    const now = Date.now();
    c.tokens = Math.min(60, c.tokens + ((now - c.lastRefill) / 1000) * 40);
    c.lastRefill = now;
    if (c.tokens < 1) return fail("slow down");
    c.tokens--;
    if (isBinary || text.length > MAX_MESSAGE_BYTES) return fail("message too large");
    let msg: ClientMsg;
    try {
      msg = JSON.parse(text);
    } catch {
      return fail("malformed message");
    }
    if (!isRecord(msg)) return fail("malformed message");

    if (msg.t === "hello") {
      if (room) return fail("already joined");
      if (msg.v !== PROTOCOL_VERSION) return fail("this page is out of date: reload it");
      if (typeof msg.room !== "string" || !/^[A-Z0-9]{5}$/.test(msg.room)) return fail("no such room");
      const r = live(msg.room);
      if (!r) return fail("no such room");
      const s = r.s;
      let pid = typeof msg.token === "string" ? Object.keys(s.tokens).find((id) => s.tokens[id] === msg.token) : undefined;
      if (pid) {
        // the same player opened a second tab: the newest wins
        for (const other of r.conns) if (other.pid === pid) other.ws.close(4001, "opened in another tab");
      }
      const id = pid ?? randomUUID().slice(0, 12);
      const token = pid ? s.tokens[pid] : randomBytes(18).toString("base64url");
      const p = join(s, id, token, typeof msg.name === "string" ? msg.name : "", r.ch);
      if (!p) return fail("this room is full");
      room = r;
      c.pid = id;
      c.view = homeView(s, id);
      r.conns.add(c);
      r.emptySince = null;
      // pending changes go out first, so the snapshot is the exact boundary for later deltas
      flush(r);
      welcome(r, c);
      return;
    }
    if (!room || !c.pid) return fail("say hello first");
    if (msg.t === "ping") return send(c, { t: "pong", n: typeof msg.n === "number" && Number.isFinite(msg.n) ? msg.n : 0 });
    if (msg.t === "sync") {
      flush(room);
      return welcome(room, c);
    }
    if (msg.t === "view") {
      // looking is free and never presence: a fresh snapshot of the world asked for
      if (typeof msg.world !== "number" || !Number.isInteger(msg.world) || !room.s.worlds[msg.world]) return fail("no such world");
      flush(room);
      c.view = msg.world;
      return welcome(room, c);
    }
    if (msg.t === "cmd") {
      if (typeof msg.id !== "string" || msg.id.length < 1 || msg.id.length > 40) return fail("malformed command");
      if (msg.inc !== room.inc) {
        send(c, { t: "ack", id: msg.id, ok: false, reason: "the server restarted: resyncing" });
        flush(room);
        return welcome(room, c);
      }
      if (!isRecord(msg.c) || typeof msg.c.k !== "string") return fail("malformed command");
      const res = applyCommand(room.s, c.pid, msg.id, msg.gen, msg.c, room.ch, msg.w);
      if (msg.c.k !== "move") send(c, res.ok ? { t: "ack", id: msg.id, ok: true } : { t: "ack", id: msg.id, ok: false, reason: res.reason });
      return;
    }
    fail("unknown message");
  };

  ws.on("close", () => {
    const left = (perIp.get(ip) ?? 1) - 1;
    if (left <= 0) perIp.delete(ip);
    else perIp.set(ip, left);
    if (!room || !c.pid) return;
    room.conns.delete(c);
    const stillHere = [...room.conns].some((o) => o.pid === c.pid);
    if (!stillHere) leave(room.s, c.pid, room.ch);
    flush(room);
    if (room.conns.size === 0) {
      room.emptySince = Date.now();
      save(room);
    }
  });
}

export const paceOf = (raw: unknown): Pace => (raw === "rapid" ? "rapid" : "normal");
export const modeOf = (raw: unknown): Mode => (raw === "classic" ? "classic" : raw === "cosmos" ? "cosmos" : "classic");
export const pickOf = (raw: unknown): FactionPick => (raw === "choose" || raw === "deal" ? raw : "either");
export { PACES };
