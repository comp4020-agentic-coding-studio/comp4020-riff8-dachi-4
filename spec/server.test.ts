import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, inject, it } from "vitest";
import WebSocket from "ws";
import type { ServerMsg, Snapshot, Delta, Command } from "../shared/protocol.ts";
import { PROTOCOL_VERSION } from "../shared/protocol.ts";

// The real server over HTTP and WebSocket: what a browser actually talks to.
const baseUrl = inject("baseUrl");

class Bot {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  snap: Snapshot | null = null;
  inc = "";
  you = "";
  token = "";
  private waiters: (() => void)[] = [];
  private n = 0;

  constructor(url: string, origin: string) {
    this.ws = new WebSocket(url.replace(/^http/, "ws") + "/ws", { headers: { origin } });
    this.ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString()) as ServerMsg;
      this.msgs.push(m);
      if (m.t === "welcome") {
        this.snap = m.snap;
        this.inc = m.inc;
        this.you = m.you;
        this.token = m.token;
      }
      if (m.t === "delta" && this.snap) {
        if (m.summaries) this.snap.summaries = m.summaries;
        if (m.meta) Object.assign(this.snap, m.meta);
        if (m.vw === this.snap.viewing) {
          for (const [i, t] of m.tiles ?? []) this.snap.tiles[i] = t;
          if (m.world) Object.assign(this.snap, m.world);
        }
        for (const p of m.players) this.snap.players[p.id] = p;
        for (const [id, x, y] of m.moves ?? []) Object.assign(this.snap.players[id] ?? {}, { x, y });
      }
      for (const w of this.waiters.splice(0)) w();
    });
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
  }

  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }

  hello(room: string, name: string, token?: string): void {
    this.send({ t: "hello", v: PROTOCOL_VERSION, room, name, token });
  }

  cmd(c: Command, id = `t${this.n++}`, inc = this.inc): string {
    this.send({ t: "cmd", id, inc, gen: this.snap!.gen, c, w: this.snap!.viewing });
    return id;
  }

  async until(pred: (m: ServerMsg) => boolean, ms = 3000): Promise<ServerMsg> {
    const deadline = Date.now() + ms;
    let seen = 0;
    for (;;) {
      for (; seen < this.msgs.length; seen++) if (pred(this.msgs[seen])) return this.msgs[seen];
      if (Date.now() > deadline) throw new Error("timed out waiting for a message");
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 100);
      });
    }
  }

  close(): void {
    this.ws.close();
  }
}

const originOf = (url: string): string => new URL(url).origin;

async function newRoom(url: string, pace = "normal", extra: Record<string, unknown> = {}): Promise<string> {
  const res = await fetch(new URL("/api/rooms", url), { method: "POST", headers: { origin: originOf(url), "content-type": "application/json" }, body: JSON.stringify({ pace, ...extra }) });
  expect(res.status).toBe(201);
  return ((await res.json()) as { code: string }).code;
}

async function joined(url: string, room: string, name: string, token?: string): Promise<Bot> {
  const b = new Bot(url, originOf(url));
  await b.open();
  b.hello(room, name, token);
  await b.until((m) => m.t === "welcome");
  return b;
}

/** Walk a bot next to the nearest tile matching `pred` (by moving its intent and waiting). */
async function walkTo(b: Bot, pred: (t: Snapshot["tiles"][number], k: number) => boolean, close = 1.2): Promise<void> {
  // re-aim every step: in a cosmos room the bots may take the target first
  for (let step = 0; step < 120; step++) {
    const s = b.snap!;
    const p = s.players[b.you];
    let best = -1;
    let bd = Infinity;
    s.tiles.forEach((t, k) => {
      if (!pred(t, k)) return;
      const d = Math.hypot((k % s.w) - p.x, Math.floor(k / s.w) - p.y);
      if (d < bd) [bd, best] = [d, k];
    });
    if (best < 0 || bd < close) break;
    b.cmd({ k: "move", dx: (best % s.w) - p.x, dy: Math.floor(best / s.w) - p.y });
    await new Promise((r) => setTimeout(r, 100));
  }
  b.cmd({ k: "move", dx: 0, dy: 0 });
  await new Promise((r) => setTimeout(r, 250));
}

/** Walk a bot next to the nearest deposit (by moving its intent and waiting). */
async function walkToDeposit(b: Bot): Promise<[number, number]> {
  const s = b.snap!;
  const me = s.players[b.you];
  const i = s.tiles.findIndex((t, k) => t.d && t.amt > 0 && Math.hypot((k % s.w) - me.x, Math.floor(k / s.w) - me.y) < 12);
  const x = i % s.w;
  const y = Math.floor(i / s.w);
  for (let step = 0; step < 60; step++) {
    const p = b.snap!.players[b.you];
    const dx = x - p.x;
    const dy = y - p.y;
    if (Math.hypot(dx, dy) < 1.2) break;
    b.cmd({ k: "move", dx, dy });
    await new Promise((r) => setTimeout(r, 120));
  }
  b.cmd({ k: "move", dx: 0, dy: 0 });
  await new Promise((r) => setTimeout(r, 250));
  return [x, y];
}

describe("pages", () => {
  it("serves the app shell, the play screen and a health check", async () => {
    for (const p of ["/", "/play/"]) expect((await fetch(new URL(p, baseUrl))).status).toBe(200);
    const h = (await (await fetch(new URL("/api/health", baseUrl))).json()) as { ok: boolean };
    expect(h.ok).toBe(true);
  });

  it("refuses to create a room from another site, and refuses a foreign WebSocket", async () => {
    const res = await fetch(new URL("/api/rooms", baseUrl), { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" });
    expect(res.status).toBe(403);
    const ws = new WebSocket(baseUrl.replace(/^http/, "ws") + "/ws", { headers: { origin: "https://evil.example" } });
    await expect(new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    })).rejects.toThrow();
  });
});

describe("real time", () => {
  it("one player's harvest reaches another open session within a second, without a reload", async () => {
    const room = await newRoom(baseUrl);
    const a = await joined(baseUrl, room, "Ada");
    const b = await joined(baseUrl, room, "Bo");
    const [x, y] = await walkToDeposit(a);
    const idx = y * a.snap!.w + x;
    const before = b.snap!.tiles[idx].amt;
    const sent = Date.now();
    a.cmd({ k: "harvest", x, y });
    await b.until((m) => m.t === "delta" && !!(m as Delta).tiles?.some(([i, t]) => i === idx && t.amt < before), 1000);
    expect(Date.now() - sent).toBeLessThan(1000);
    a.close();
    b.close();
  });

  it("a returning browser gets its own identity back; a stranger gets a new one", async () => {
    const room = await newRoom(baseUrl);
    const a = await joined(baseUrl, room, "Ada");
    const { you, token } = a;
    a.close();
    await new Promise((r) => setTimeout(r, 200));
    const again = await joined(baseUrl, room, "Ada", token);
    expect(again.you).toBe(you);
    const stranger = await joined(baseUrl, room, "Mallory", "not-a-real-token");
    expect(stranger.you).not.toBe(you);
    again.close();
    stranger.close();
  });

  it("a resent harvest applies once, and a stale incarnation is refused with a fresh snapshot", async () => {
    const room = await newRoom(baseUrl);
    const a = await joined(baseUrl, room, "Ada");
    const [x, y] = await walkToDeposit(a);
    const idx = y * a.snap!.w + x;
    const before = a.snap!.tiles[idx].amt;
    a.cmd({ k: "harvest", x, y }, "dup-1");
    await a.until((m) => m.t === "ack" && m.id === "dup-1");
    await new Promise((r) => setTimeout(r, 600));
    a.cmd({ k: "harvest", x, y }, "dup-1");
    await a.until((m) => m.t === "ack" && m.id === "dup-1" && a.msgs.filter((q) => q.t === "ack" && q.id === "dup-1").length === 2);
    await new Promise((r) => setTimeout(r, 300));
    expect(a.snap!.tiles[idx].amt).toBe(before - 1);
    const welcomes = a.msgs.filter((m) => m.t === "welcome").length;
    a.cmd({ k: "harvest", x, y }, "stale-1", "not-this-incarnation");
    const ack = await a.until((m) => m.t === "ack" && m.id === "stale-1");
    expect(ack).toMatchObject({ ok: false });
    await a.until(() => a.msgs.filter((m) => m.t === "welcome").length > welcomes);
    a.close();
  });

  it("survives messages built to throw when coerced", async () => {
    const room = await newRoom(baseUrl);
    const a = await joined(baseUrl, room, "Ada");
    a.send({ t: "cmd", id: { toString: 1 }, inc: "stale", gen: 1, c: { k: "emote", e: "wave" } });
    a.send({ t: "ping", n: { toString: 1 } });
    await a.until((m) => m.t === "pong");
    expect((await fetch(new URL("/api/health", baseUrl))).status).toBe(200);
    const b = await joined(baseUrl, room, "Bo");
    expect(Object.keys(b.snap!.players)).toHaveLength(2);
    a.close();
    b.close();
  });

  it("drops oversized and malformed messages without dropping the room", async () => {
    const room = await newRoom(baseUrl);
    const a = await joined(baseUrl, room, "Ada");
    a.send({ t: "cmd", id: "x", inc: a.inc, gen: a.snap!.gen, c: { k: "harvest", x: "lots", y: null } });
    await a.until((m) => m.t === "ack" && m.id === "x" && !m.ok);
    a.ws.send("{not json");
    await a.until((m) => m.t === "error" && m.reason === "malformed message");
    const b = await joined(baseUrl, room, "Bo");
    expect(Object.keys(b.snap!.players)).toHaveLength(2);
    a.close();
    b.close();
  });
});

describe("a cosmos room, end to end", () => {
  it("joins, picks a faction, views another world, launches, and sees a god's act land on another world", async () => {
    const room = await newRoom(baseUrl, "rapid", { mode: "cosmos", gods: true, pick: "choose" });
    const a = await joined(baseUrl, room, "Ada");
    expect(a.snap!.mode).toBe("cosmos");
    expect(a.snap!.summaries).toHaveLength(5);
    // four bots hold the four seats until someone takes one
    expect(Object.values(a.snap!.players).filter((p) => p.bot && p.connected)).toHaveLength(4);
    a.cmd({ k: "faction", f: "brokers" }, "f1");
    expect(await a.until((m) => m.t === "ack" && m.id === "f1")).toMatchObject({ ok: true });
    await a.until((m) => m.t === "delta" && m.players.some((p) => p.id === a.you && p.faction === "brokers"));
    // viewing is free: a fresh snapshot of Mars, and Ada is still on Earth
    a.send({ t: "view", world: 1 });
    const mars = (await a.until((m) => m.t === "welcome" && m.snap.viewing === 1)) as Extract<ServerMsg, { t: "welcome" }>;
    expect(mars.snap.stage).toBe(1);
    expect(mars.snap.players[a.you].world).toBe(0);
    // grounded commands meant for the world you're only looking at are refused
    a.cmd({ k: "harvest", x: 3, y: 3 }, "h-far");
    expect(await a.until((m) => m.t === "ack" && m.id === "h-far")).toMatchObject({ ok: false, reason: expect.stringMatching(/only looking/) });
    // back home, build a Pad from the Brokers' stockpile filled by hand, then launch
    a.send({ t: "view", world: 0 });
    await a.until((m) => m.t === "welcome" && m.snap.viewing === 0);
    // one hand harvest of each stock (rapid: 10 a swing), into the Brokers' stockpile, pays for a Pad and its fuel
    for (const f of ["matter", "mineral", "coolant"] as const) {
      let ok = false;
      for (let attempt = 0; attempt < 6 && !ok; attempt++) {
        await walkTo(a, (t) => t.d === f && t.amt > 0);
        const me = a.snap!.players[a.you];
        const s = a.snap!;
        const i = s.tiles.findIndex((t, k) => t.d === f && t.amt > 0 && Math.hypot((k % s.w) - me.x, Math.floor(k / s.w) - me.y) <= 2);
        if (i < 0) continue;
        const id = `h-${f}-${attempt}`;
        a.cmd({ k: "harvest", x: i % s.w, y: Math.floor(i / s.w) }, id);
        ok = ((await a.until((m) => m.t === "ack" && m.id === id)) as { ok: boolean }).ok;
        await new Promise((r) => setTimeout(r, 900));
      }
      expect(ok, `harvest ${f}`).toBe(true);
    }
    a.cmd({ k: "deposit" }, "dep");
    expect(await a.until((m) => m.t === "ack" && m.id === "dep")).toMatchObject({ ok: true });
    const fresh = async (): Promise<Snapshot> => {
      const since = a.msgs.length;
      a.send({ t: "sync" });
      await a.until((m) => m.t === "welcome" && a.msgs.indexOf(m) >= since);
      return a.snap!;
    };
    let s = await fresh();
    const me = s.players[a.you];
    let built = false;
    for (let r = 1; r < 6 && !built; r++)
      for (let dx = -r; dx <= r && !built; dx++) {
        const x = Math.round(me.x) + dx;
        const y = Math.round(me.y) + r;
        const t = s.tiles[y * s.w + x];
        if (!t || t.d || t.b || t.t !== 0 || x < 0 || x >= s.w) continue;
        const id = `pad-${x}-${y}`;
        a.cmd({ k: "build", x, y, type: "pad" }, id);
        built = ((await a.until((m) => m.t === "ack" && m.id === id)) as { ok: boolean }).ok;
      }
    expect(built).toBe(true);
    await new Promise((r) => setTimeout(r, 1000));
    s = await fresh();
    const pad = s.buildings.find((b) => b.type === "pad" && b.f === "brokers")!;
    await walkTo(a, (_t, k) => k === pad.y * s.w + pad.x, 1.5);
    a.cmd({ k: "launch", x: pad.x, y: pad.y, to: 1, cargo: { matter: 0, mineral: 0, coolant: 0 } }, "go");
    const ack = await a.until((m) => m.t === "ack" && m.id === "go");
    expect(ack).toMatchObject({ ok: true });
    // in flight: a ship on the map with Ada aboard, and Ada on no world
    const flying = (await a.until((m) => m.t === "delta" && !!m.meta?.ships.some((sh) => sh.passengers.includes(a.you)))) as Delta;
    expect(flying.meta!.ships[0].to).toBe(1);
    await a.until((m) => m.t === "delta" && m.players.some((p) => p.id === a.you && p.world === -1));
    a.close();
  }, 60_000);

  it("a god's act on a world nobody is viewing reaches a viewer of that world", async () => {
    const room = await newRoom(baseUrl, "rapid", { mode: "cosmos", gods: true, pick: "choose" });
    const a = await joined(baseUrl, room, "Ada");
    const b = await joined(baseUrl, room, "Ben");
    a.cmd({ k: "faction", f: "stewards" }, "fa");
    b.cmd({ k: "faction", f: "foundry" }, "fb");
    await a.until((m) => m.t === "ack" && m.id === "fa");
    // Ben watches the Sun; Ada stays on Earth
    b.send({ t: "view", world: 2 });
    await b.until((m) => m.t === "welcome" && m.snap.viewing === 2);
    // the fairest pick is the faction with fewest turns: bots take theirs too, so this can take a few turns.
    // The host switching gods off and on hands out a new turn at once, without waiting out a gap.
    const deadline = Date.now() + 55_000;
    let god: Bot | null = null;
    while (!god && Date.now() < deadline) {
      const since = a.msgs.length;
      a.send({ t: "sync" });
      await a.until((m) => m.t === "welcome" && a.msgs.indexOf(m) >= since);
      const g = a.snap!.god.id;
      if (g === a.you) god = a;
      else if (g === b.you) god = b;
      else {
        a.cmd({ k: "gods", on: false });
        a.cmd({ k: "gods", on: true });
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    expect(god).not.toBeNull();
    god!.cmd({ k: "god", power: "bless", x: 5, y: 5, world: 2 }, "bless-sun");
    expect(await god!.until((m) => m.t === "ack" && m.id === "bless-sun")).toMatchObject({ ok: true });
    const seen = await b.until((m) => m.t === "delta" && m.vw === 2 && !!m.world?.blessings.length);
    expect(seen.t).toBe("delta");
    // and Ada, on Earth, sees it on the map's summary
    await a.until((m) => m.t === "delta" && !!m.summaries?.[2]?.blessings);
    a.close();
    b.close();
  }, 70_000);
});

describe("persistence", () => {
  // A private server against its own data directory, so it can be killed.
  const dir = mkdtempSync(join(tmpdir(), "plenty-"));
  const procs: ChildProcess[] = [];
  const port = 18000 + Math.floor(Math.random() * 1000);
  const url = `http://localhost:${port}`;

  async function boot(): Promise<ChildProcess> {
    const p = spawn(process.execPath, ["server/main.ts"], { env: { ...process.env, PORT: String(port), DATA_DIR: dir }, stdio: "ignore" });
    procs.push(p);
    for (let i = 0; i < 100; i++) {
      try {
        await fetch(new URL("/api/health", url));
        return p;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error("server didn't start");
  }
  const stop = (p: ChildProcess, signal: NodeJS.Signals): Promise<void> =>
    new Promise((r) => {
      p.once("exit", () => r());
      p.kill(signal);
    });

  afterAll(() => {
    for (const p of procs) p.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  });

  it("recovers a campaign after a graceful restart, under a new incarnation", async () => {
    let p = await boot();
    const room = await newRoom(url);
    const a = await joined(url, room, "Ada");
    const [x, y] = await walkToDeposit(a);
    const idx = y * a.snap!.w + x;
    a.cmd({ k: "harvest", x, y }, "h1");
    await a.until((m) => m.t === "delta" && !!m.tiles?.some(([i]) => i === idx));
    const amt = a.snap!.tiles[idx].amt;
    const { token, you, inc } = a;
    await stop(p, "SIGTERM");
    p = await boot();
    const back = await joined(url, room, "Ada", token);
    expect(back.you).toBe(you);
    expect(back.inc).not.toBe(inc);
    expect(back.snap!.tiles[idx].amt).toBe(amt);
    back.close();
    await stop(p, "SIGTERM");
  }, 30_000);

  it("after an abrupt kill, loses at most the last save interval", async () => {
    let p = await boot();
    const room = await newRoom(url);
    const a = await joined(url, room, "Ada");
    const [x, y] = await walkToDeposit(a);
    const idx = y * a.snap!.w + x;
    a.cmd({ k: "harvest", x, y }, "h1");
    await a.until((m) => m.t === "delta" && !!m.tiles?.some(([i]) => i === idx));
    const amt = a.snap!.tiles[idx].amt;
    await new Promise((r) => setTimeout(r, 6000)); // > the 5 s save interval
    await stop(p, "SIGKILL");
    p = await boot();
    const back = await joined(url, room, "Ada", a.token);
    expect(back.snap!.tiles[idx].amt).toBe(amt);
    back.close();
    await stop(p, "SIGTERM");
  }, 45_000);

  it("loads a classic room saved before cosmos (schema 3) as classic, gods off, with its world intact", async () => {
    // write a schema-3 row by hand, the shape main and packs-tools-gods saved
    const { DatabaseSync } = await import("node:sqlite");
    const g = (await import("../shared/worldgen.ts")).generateStage(77, 0);
    const ledger = { matter: { initial: 0, remaining: 0, extracted: 0, destroyed: 0 }, mineral: { initial: 0, remaining: 0, extracted: 0, destroyed: 0 }, coolant: { initial: 0, remaining: 0, extracted: 0, destroyed: 0 } };
    for (const t of g.tiles) if (t.d) {
      ledger[t.d].initial += t.init;
      ledger[t.d].remaining += t.amt;
    }
    const old = {
      v: 3, code: "OLDRM", seed: 77, pace: "normal", hostId: "p1", tick: 500, seq: 9, gen: 1, stage: 0, stageStartTick: 0, lifeStart: 90, econTicks: 50,
      phase: { k: "play" }, w: 24, tiles: g.tiles, buildings: g.buildings, nextBuildingId: g.buildings.length + 1,
      inventory: { matter: 5, mineral: 3, coolant: 1 }, ledger, econ: { energySupply: 0, energyUsed: 0, computeSupply: 0, computeUsed: 0, workersSupply: 0, workersUsed: 0 },
      heat: 0, reserve: 0, god: { on: true, id: "p1", until: 900, ready: 0, made: 2 }, bombs: [{ id: 1, x: 3, y: 3, at: 600, by: "Ada" }], auras: [], history: [], archive: [],
      players: { p1: { id: "p1", name: "Ada", colour: 0, x: 11, y: 11, dx: 0, dy: 0, facing: 2, act: null, connected: true, joinedTick: 0, nextHarvest: 0, nextEmote: 0, marks: 0, pack: { matter: 2, mineral: 0, coolant: 0 }, tools: { matter: 1, mineral: 0, coolant: 0 }, stats: { harvested: 2, built: 0, helped: 0 } } },
      tokens: { p1: "old-token" }, receipts: { p1: [] }, log: [{ tick: 1, text: "Ada arrived." }],
    };
    const p0 = await boot();
    await stop(p0, "SIGTERM");
    const db = new DatabaseSync(join(dir, "plenty.db"));
    db.prepare("INSERT INTO rooms (code, schema, state, saved_at, players) VALUES (?, 3, ?, ?, 1)").run("OLDRM", JSON.stringify(old), Date.now());
    db.close();
    const p = await boot();
    const back = await joined(url, "OLDRM", "Ada", "old-token");
    expect(back.you).toBe("p1");
    const s = back.snap!;
    expect(s.mode).toBe("classic");
    expect(s.god.on).toBe(false);
    expect(s.inventory).toEqual({ matter: 5, mineral: 3, coolant: 1 });
    expect(s.players.p1.pack.matter).toBe(2);
    expect(s.players.p1.tools.matter).toBe(1);
    expect(s.tiles).toHaveLength(24 * 24);
    expect(s.strikes).toEqual([]);
    back.close();
    await stop(p, "SIGTERM");
  }, 30_000);
});
