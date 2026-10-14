// Durable room storage: one SQLite file on the Fly volume, one row per room
// holding the whole RoomState as JSON. A save is a single UPSERT, so a crash
// mid-save leaves the previous snapshot intact (WAL mode). World state,
// sequence number and command receipts live in the same row, so they can
// never disagree about what was applied.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RoomState } from "../shared/protocol.ts";
import { SCHEMA_VERSION } from "../shared/protocol.ts";

const dir = process.env.DATA_DIR ?? join(process.cwd(), "data");
mkdirSync(dir, { recursive: true });

export const db = new DatabaseSync(join(dir, "plenty.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");

// Migrations run in order against PRAGMA user_version.
const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS rooms (
     code TEXT PRIMARY KEY,
     schema INTEGER NOT NULL,
     state TEXT NOT NULL,
     saved_at INTEGER NOT NULL
   )`,
  // how many players a room has ever had, so rooms nobody joined can be pruned
  `ALTER TABLE rooms ADD COLUMN players INTEGER NOT NULL DEFAULT 1`,
];
const current = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
for (let i = current; i < MIGRATIONS.length; i++) {
  db.exec(MIGRATIONS[i]);
  db.exec(`PRAGMA user_version = ${i + 1}`);
}

const upsert = db.prepare(
  "INSERT INTO rooms (code, schema, state, saved_at, players) VALUES (?, ?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET schema = excluded.schema, state = excluded.state, saved_at = excluded.saved_at, players = excluded.players",
);
const prune = db.prepare("DELETE FROM rooms WHERE players = 0 AND saved_at < ?");

/** Rooms created but never joined, older than a day, are deleted. Joined rooms are kept. */
export function pruneRooms(): void {
  prune.run(Date.now() - 86_400_000);
}
const select = db.prepare("SELECT schema, state FROM rooms WHERE code = ?");
const exists = db.prepare("SELECT 1 FROM rooms WHERE code = ?");

export function saveRoom(s: RoomState): void {
  upsert.run(s.code, SCHEMA_VERSION, JSON.stringify(s), Date.now(), Object.keys(s.players).length);
}

export function loadRoom(code: string): RoomState | null {
  const row = select.get(code) as { schema: number; state: string } | undefined;
  if (!row) return null;
  const s = JSON.parse(row.state) as RoomState;
  let schema = row.schema;
  if (schema === 1) {
    // 1 -> 2: every player gets a pack and tools; what was gathered stays in the stockpile
    for (const p of Object.values(s.players)) {
      p.pack = { matter: 0, mineral: 0, coolant: 0 };
      p.tools = { matter: 0, mineral: 0, coolant: 0 };
    }
    s.v = schema = 2;
  }
  if (schema === 2) {
    // 2 -> 3: rooms from before gods have them switched off
    s.god = { on: false, id: null, until: 0, ready: 0, made: 0 };
    s.bombs = [];
    s.auras = [];
    s.v = schema = 3;
  }
  if (schema !== SCHEMA_VERSION) throw new Error(`room ${code} is schema ${row.schema}, server expects ${SCHEMA_VERSION}`);
  return s;
}

export const roomExists = (code: string): boolean => exists.get(code) !== undefined;
