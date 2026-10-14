#!/usr/bin/env node
// A playtest bot that joins a room over the real protocol and plays it: walks,
// harvests by hand, and builds each stage's machine (homes, power, compute,
// extractors) wherever the server will accept them. Used to drive a room
// through every stage while real browsers watch, and to measure pacing.
//
//   node scripts/playbot.ts <room> [baseUrl] [name]
import WebSocket from "ws";
import { BUILDINGS, HARVEST_RANGE, STAGES, type BuildingType } from "../shared/content.ts";
import { PROTOCOL_VERSION, type RoomState, type ServerMsg, type Snapshot } from "../shared/protocol.ts";
import { placementProblem } from "../shared/sim.ts";

const [room, base = "http://localhost:8347", name = "Bot"] = process.argv.slice(2);
if (!room) {
  console.error("usage: node scripts/playbot.ts <room> [baseUrl] [name]");
  process.exit(1);
}

const PLANS: Record<string, BuildingType[]> = {
  earth: ["city", "furnace", "datacentre", "extractor", "extractor", "plaza", "solar", "extractor", "extractor", "city", "extractor", "extractor"],
  mars: ["habitat", "solar", "solar", "city", "datacentre", "extractor", "extractor", "extractor", "habitat", "extractor", "extractor"],
  sun: ["solar", "city", "datacentre", "radiator", "extractor", "extractor", "radiator", "extractor", "extractor", "extractor"],
  system: ["city", "datacentre", "relay", "relay", "extractor", "extractor", "relay", "extractor", "extractor", "extractor"],
  universe: ["city", "datacentre", "datacentre", "extractor", "extractor", "extractor", "extractor", "extractor", "extractor"],
};

const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { origin: new URL(base).origin } });
let s: Snapshot | null = null;
let you = "";
let inc = "";
let n = 0;
let goal: [number, number] | null = null;
const started = Date.now();

const send = (c: object): void => {
  if (s) ws.send(JSON.stringify({ t: "cmd", id: `${name}-${n++}`, inc, gen: s.gen, c }));
};

ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: PROTOCOL_VERSION, room, name })));
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString()) as ServerMsg;
  if (m.t === "welcome") {
    const fresh = !s || s.gen !== m.snap.gen;
    s = m.snap;
    you = m.you;
    inc = m.inc;
    goal = null;
    if (fresh) console.log(`${((Date.now() - started) / 1000).toFixed(0)}s: ${STAGES[s.stage].name}${s.phase.k === "ended" ? " (ended)" : ""}`);
  } else if (m.t === "delta" && s) {
    for (const p of m.players) s.players[p.id] = p;
    for (const [id, x, y] of m.moves ?? []) if (s.players[id]) Object.assign(s.players[id], { x, y });
    for (const [i, t] of m.tiles ?? []) s.tiles[i] = t;
    for (const b of m.buildings ?? []) {
      const at = s.buildings.findIndex((q) => q.id === b.id);
      if (at >= 0) s.buildings[at] = b;
      else s.buildings.push(b);
    }
    if (m.removed) s.buildings = s.buildings.filter((b) => !m.removed!.includes(b.id));
    if (m.meta) Object.assign(s, m.meta);
  }
});
ws.on("close", () => process.exit(0));

function spotFor(type: BuildingType, me: { x: number; y: number }): [number, number] | null {
  if (!s) return null;
  const st = s as unknown as RoomState;
  let best: [number, number] | null = null;
  let score = -Infinity;
  for (let y = 0; y < s.w; y++)
    for (let x = 0; x < s.w; x++) {
      if (placementProblem(st, type, x, y) !== null) continue;
      const d = Math.hypot(x - me.x, y - me.y);
      let v = -d;
      if (type === "extractor") {
        let near = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const t = s.tiles[(y + dy) * s.w + x + dx];
            if (t && x + dx >= 0 && x + dx < s.w && t.d) near += t.amt;
          }
        if (near === 0) continue;
        v = near - d * 2;
        if (STAGES[s.stage].mechanic === "pressure" && !s.buildings.some((h) => h.type === "habitat" && Math.max(Math.abs(h.x + 0.5 - x), Math.abs(h.y + 0.5 - y)) <= 4)) continue;
        if (STAGES[s.stage].mechanic === "relay" && !s.buildings.some((r) => BUILDINGS[r.type].relayRange && Math.max(Math.abs(r.x - x), Math.abs(r.y - y)) <= BUILDINGS[r.type].relayRange! - 1)) continue;
      }
      if (type === "relay") {
        // extend the network outward toward the belt
        const linked = s.buildings.filter((r) => BUILDINGS[r.type].relayRange);
        const reach = Math.min(...linked.map((r) => Math.max(Math.abs(r.x - x), Math.abs(r.y - y)) - (BUILDINGS[r.type].relayRange! - 1)));
        if (reach > 0) continue;
        const c = (s.w - 1) / 2;
        v = Math.hypot(x - c, y - c) * 3 - d;
      }
      if (type === "datacentre" && STAGES[s.stage].mechanic === "pressure" && !s.buildings.some((h) => h.type === "habitat" && Math.max(Math.abs(h.x + 0.5 - x - 0.5), Math.abs(h.y + 0.5 - y - 0.5)) <= 4)) continue;
      if (v > score) [score, best] = [v, [x, y]];
    }
  return best;
}

setInterval(() => {
  if (!s || s.phase.k !== "play") return;
  const me = s.players[you];
  if (!me) return;
  const st = STAGES[s.stage];
  const plan = PLANS[st.id];
  const mine = s.buildings.filter((b) => b.owner);
  const counts = new Map<BuildingType, number>();
  let next: BuildingType | null = null;
  for (const t of plan) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
    if (mine.filter((b) => b.type === t).length < counts.get(t)!) {
      next = t;
      break;
    }
  }
  if (next) {
    const def = BUILDINGS[next];
    const affordable = Object.entries(def.cost).every(([f, v]) => s!.inventory[f as keyof Snapshot["inventory"]]  >= (v ?? 0));
    if (affordable) {
      const spot = spotFor(next, me);
      if (spot) {
        if (Math.hypot(spot[0] - me.x, spot[1] - me.y) <= 6) {
          send({ k: "move", dx: 0, dy: 0 });
          send({ k: "build", x: spot[0], y: spot[1], type: next });
          return;
        }
        goal = spot;
      }
    }
  }
  // machines run on the stockpile: hand over a full pack so furnaces and datacentres aren't starved
  if (me.pack.matter + me.pack.mineral + me.pack.coolant >= 10) send({ k: "deposit" });
  // otherwise harvest the nearest deposit (or help raise a site)
  let best = -1;
  let bd = Infinity;
  s.tiles.forEach((t, i) => {
    const b = t.b ? s!.buildings.find((q) => q.id === t.b) : undefined;
    const site = b && b.work < BUILDINGS[b.type].build * 10;
    if (!(t.d && t.amt > 0) && !site) return;
    const d = Math.hypot((i % s!.w) - me.x, Math.floor(i / s!.w) - me.y);
    if (d < bd) [bd, best] = [d, i];
  });
  const target: [number, number] | null = goal ?? (best >= 0 ? [best % s.w, Math.floor(best / s.w)] : null);
  if (!target) return;
  const d = Math.hypot(target[0] - me.x, target[1] - me.y);
  if (goal && d < 4) goal = null;
  if (!goal && best >= 0 && bd <= HARVEST_RANGE - 0.3) {
    send({ k: "move", dx: 0, dy: 0 });
    send({ k: "harvest", x: best % s.w, y: Math.floor(best / s.w) });
  } else send({ k: "move", dx: target[0] - me.x, dy: target[1] - me.y });
}, 820);
