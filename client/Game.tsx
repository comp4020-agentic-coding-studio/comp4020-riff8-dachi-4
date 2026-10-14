"use client";
// The play screen: the canvas (driven by Renderer's own frame loop) plus a
// compact React HUD that re-renders at most five times a second from the
// client's version counter, never per entity update.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BUILDINGS, EMOTES, FAMILIES, HARVEST_COOLDOWN_TICKS, HARVEST_RANGE, STAGES, TICK_MS, TOOL_TIERS, buildingName, harvestCooldown, toolCost, toolName, type BuildingType, type Emote, type Family, type GodPower } from "../shared/content.ts";
import type { Building, Player, Snapshot } from "../shared/protocol.ts";
import { averageLife, craftProblem, harvestTicks } from "../shared/sim.ts";
import { GameClient } from "./net.ts";
import { PLAYER_COLOURS, Renderer, type Tool, type View } from "./render.ts";
import { Sound, type Mix } from "./audio.ts";

const EMOTE_GLYPH: Record<Emote, string> = { wave: "👋", heart: "💛", laugh: "😄", wow: "😮", sad: "😢", point: "👉" };
const KEY_DIRS: Record<string, [number, number]> = {
  w: [-1, -1], arrowup: [-1, -1],
  s: [1, 1], arrowdown: [1, 1],
  a: [-1, 1], arrowleft: [-1, 1],
  d: [1, -1], arrowright: [1, -1],
};

const MECHANIC_HINT: Record<string, string> = {
  pollution: "Furnaces are strong but their smoke kills groves and browns the land. Sun Gardens are clean and slow.",
  pressure: "Nothing runs outside a Dome's air. Domes drink ice; so do datacentres. Watch the ice.",
  heat: "Collector Wings pour in power and heat. Over the limit, scoops throttle: radiators shed it.",
  relay: "No sunlight: every machine drinks from the Bottled Sun. Miners only ship if relays link them to the Depot.",
  legacy: "Your old worlds run as World Engines. The host can render one down for a burst of energy, for good.",
};

function useVersion(client: GameClient | null): number {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!client) return;
    let seen = -1;
    const id = setInterval(() => {
      if (client.version !== seen) {
        seen = client.version;
        setN((n) => n + 1);
      }
    }, 200);
    return () => clearInterval(id);
  }, [client]);
  return client?.version ?? 0;
}

const prefersReducedMotion = (): boolean => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function Game({ room, name }: { room: string; name: string }): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [client, setClient] = useState<GameClient | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const soundRef = useRef(new Sound());
  const viewRef = useRef<View>({ tool: "harvest", build: null, god: null, hover: null, keyboardTarget: true, survey: false, selected: null, reducedMotion: prefersReducedMotion(), low: false, zoom: 1 });
  const [, force] = useState(0);
  const [help, setHelp] = useState(false);
  const [naming, setNaming] = useState<[number, number] | null>(null);
  const [mix, setMix] = useState<Mix>({ music: 0.5, ambience: 0.7, effects: 0.8 });
  const [settings, setSettings] = useState(false);
  useVersion(client);
  const view = viewRef.current;
  const rerender = (): void => force((n) => n + 1);

  useEffect(() => {
    const c = new GameClient(room, name);
    const canvas = canvasRef.current!;
    const r = new Renderer(canvas, c, viewRef.current);
    rendererRef.current = r;
    c.onAck = (ok, cmd) => {
      const snd = soundRef.current;
      if (!ok) snd.reject();
      else if (cmd.k === "harvest") snd.harvest();
      else if (cmd.k === "build") snd.build();
    };
    const prevBoundary = c.onBoundary;
    c.onBoundary = () => {
      prevBoundary?.();
      soundRef.current.boundary();
      viewRef.current.tool = "harvest";
      viewRef.current.build = null;
      viewRef.current.god = null;
      viewRef.current.selected = null;
    };
    const drawBlast = c.onBlast;
    c.onBlast = (x, y) => {
      drawBlast?.(x, y);
      soundRef.current.blast();
    };
    c.connect();
    r.start();
    setClient(c);
    return () => {
      r.stop();
      c.close();
      soundRef.current.stop();
    };
  }, [room, name]);

  // keep the sound engine fed with the world's state
  const s = client?.state ?? null;
  useEffect(() => {
    if (!s) return;
    const snd = soundRef.current;
    snd.life = averageLife(s);
    snd.machines = s.buildings.filter((b) => b.status === "ok" && b.owner).length;
    snd.stage = s.stage;
    snd.ended = s.phase.k === "ended" && s.phase.how !== "restraint";
  });
  useEffect(() => soundRef.current.setMix(mix), [mix]);

  // keyboard
  useEffect(() => {
    if (!client) return;
    const held = new Set<string>();
    let harvestTimer: ReturnType<typeof setTimeout> | null = null;
    // holding the key swings again as soon as the tool in hand allows
    const holdHarvest = (): void => {
      const family = quickHarvest();
      const st = client.state;
      const me = st?.players[client.you];
      // an aura counts from where you're standing now, as the server will see it
      const ticks = family && st && me ? harvestTicks(st, { ...me, x: client.me.x, y: client.me.y }, family) : HARVEST_COOLDOWN_TICKS;
      harvestTimer = setTimeout(holdHarvest, ticks * TICK_MS + 20);
    };
    const sendMove = (): void => {
      let dx = 0;
      let dy = 0;
      for (const k of held) {
        const d = KEY_DIRS[k];
        if (d) {
          dx += d[0];
          dy += d[1];
        }
      }
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        dx /= len;
        dy /= len;
      }
      if (dx !== client.me.dx || dy !== client.me.dy) {
        client.me.dx = dx;
        client.me.dy = dy;
        client.send({ k: "move", dx, dy });
      }
    };
    const down = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("input, textarea, select, dialog")) return;
      if (el?.closest("button, a") && (e.key === "Enter" || e.key === " ")) return;
      const k = e.key.toLowerCase();
      const st = client.state ? STAGES[client.state.stage] : null;
      if (KEY_DIRS[k]) {
        e.preventDefault();
        held.add(k);
        viewRef.current.keyboardTarget = true;
        sendMove();
        return;
      }
      if (e.repeat) return;
      if (k === "e" || k === " ") {
        e.preventDefault();
        if (!harvestTimer) holdHarvest();
      } else if (e.shiftKey && /^digit[1-6]$/i.test(e.code)) {
        e.preventDefault();
        client.send({ k: "emote", e: EMOTES[Number(e.code.slice(5)) - 1] });
      } else if (/^[1-9]$/.test(k) && st) {
        const type = st.buildings[Number(k) - 1];
        if (type) {
          e.preventDefault();
          chooseBuild(type);
        }
      } else if (k === "escape") {
        setTool("harvest");
        setHelp(false);
      } else if (k === "enter") {
        e.preventDefault();
        viewRef.current.keyboardTarget = true;
        const tgt = rendererRef.current?.facingTile();
        if (tgt) act(tgt[0], tgt[1]);
      } else if (k === "x") setTool("demolish");
      else if (k === "i") setTool("inspect");
      else if (k === "n") setTool("mark");
      else if (k === "g") client.send({ k: "deposit" });
      else if (k === "v") {
        viewRef.current.survey = !viewRef.current.survey;
        rerender();
      } else if (k === "p") photo();
      else if (k === "h" || k === "?") setHelp((h) => !h);
      else if (k === "=" || k === "+") zoomBy(1.15);
      else if (k === "-") zoomBy(1 / 1.15);
    };
    const up = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase();
      if (held.delete(k)) sendMove();
      if ((k === "e" || k === " ") && harvestTimer) {
        clearTimeout(harvestTimer);
        harvestTimer = null;
      }
    };
    const blur = (): void => {
      held.clear();
      sendMove();
      if (harvestTimer) clearTimeout(harvestTimer);
      harvestTimer = null;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      if (harvestTimer) clearTimeout(harvestTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  function setTool(tool: Tool): void {
    view.tool = tool;
    if (tool !== "build") view.build = null;
    if (tool !== "god") view.god = null;
    if (tool !== "inspect") view.selected = null;
    rerender();
  }

  function chooseGod(power: GodPower, family?: Family): void {
    view.tool = "god";
    view.god = { power, family };
    view.build = null;
    view.selected = null;
    rerender();
  }

  function chooseBuild(type: BuildingType): void {
    view.tool = "build";
    view.build = type;
    view.god = null;
    view.selected = null;
    rerender();
  }

  function zoomBy(k: number): void {
    view.zoom = Math.max(0.5, Math.min(2.2, view.zoom * k));
  }

  /** Harvest (or help build) the best thing in reach: the forgiving keyboard path. Returns the family harvested, if any. */
  function quickHarvest(): Family | null {
    const c = client;
    const st = c?.state;
    if (!c || !st) return null;
    let best: [number, number] | null = null;
    let bd = Infinity;
    const r = Math.ceil(HARVEST_RANGE);
    for (let y = Math.floor(c.me.y) - r; y <= Math.ceil(c.me.y) + r; y++)
      for (let x = Math.floor(c.me.x) - r; x <= Math.ceil(c.me.x) + r; x++) {
        if (x < 0 || y < 0 || x >= st.w || y >= st.w) continue;
        const t = st.tiles[y * st.w + x];
        const site = t.b ? st.buildings.find((b) => b.id === t.b) : undefined;
        const useful = (t.d && t.amt > 0) || (site && site.work < BUILDINGS[site.type].build * 10);
        const d = Math.hypot(x - c.me.x, y - c.me.y);
        if (useful && d <= HARVEST_RANGE - 0.1 && d < bd) [bd, best] = [d, [x, y]];
      }
    if (best) {
      c.send({ k: "harvest", x: best[0], y: best[1] });
      soundRef.current.tap();
      const t = st.tiles[best[1] * st.w + best[0]];
      return t.b ? null : t.d;
    }
    c.toast("Nothing in reach to harvest. Press V to survey.", "bad");
    return null;
  }

  function act(x: number, y: number): void {
    const c = client;
    const st = c?.state;
    if (!c || !st || x < 0 || y < 0 || x >= st.w || y >= st.w) return;
    const t = st.tiles[y * st.w + x];
    switch (view.tool) {
      case "build":
        if (view.build) c.send({ k: "build", x, y, type: view.build });
        break;
      case "god":
        if (view.god) c.send({ k: "god", power: view.god.power, x, y, family: view.god.family });
        break;
      case "demolish":
        if (t.b) c.send({ k: "demolish", x, y });
        break;
      case "mark":
        setNaming([x, y]);
        break;
      case "inspect":
        view.selected = t.b || null;
        rerender();
        break;
      default:
        if ((t.d && t.amt > 0) || t.b) {
          const site = t.b ? st.buildings.find((b) => b.id === t.b) : undefined;
          if (site && site.work >= BUILDINGS[site.type].build * 10) {
            view.selected = site.id;
            rerender();
          } else {
            c.send({ k: "harvest", x, y });
            soundRef.current.tap();
          }
        } else view.selected = null;
        rerender();
    }
  }

  function photo(): void {
    const url = rendererRef.current?.photo();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `plenty-${client?.state ? STAGES[client.state.stage].id : "world"}-${Date.now()}.png`;
    a.click();
    client?.toast("Photo saved.");
  }

  const onPointer = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    view.hover = rendererRef.current?.pick(e.clientX - rect.left, e.clientY - rect.top) ?? null;
    view.keyboardTarget = false;
  };
  const onClick = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return;
    onPointer(e);
    // a tall building is picked by what you see of it, not only its footprint
    if (view.tool === "harvest" || view.tool === "inspect" || view.tool === "demolish") {
      const rect = e.currentTarget.getBoundingClientRect();
      const b = rendererRef.current?.pickBuilding(e.clientX - rect.left, e.clientY - rect.top);
      if (b) return act(b.x, b.y);
    }
    if (view.hover) act(view.hover[0], view.hover[1]);
  };

  const st = s ? STAGES[s.stage] : null;
  const host = !!(s && client && s.hostId === client.you);
  const me = s && client ? s.players[client.you] : undefined;
  // a god's turn ends on the server's clock: put the power down when it does
  if (view.tool === "god" && s && client && s.god.id !== client.you) {
    view.tool = "harvest";
    view.god = null;
  }

  return (
    <main className="game">
      <h1 className="sr-only">{st ? `Plenty: ${st.name}, room ${room}` : "Plenty"}</h1>
      <canvas
        ref={canvasRef}
        className="world"
        tabIndex={0}
        aria-label={st ? `${st.name}: the shared world. Move with WASD or arrows, harvest with E.` : "Loading the world"}
        onPointerMove={onPointer}
        onPointerDown={onClick}
        onContextMenu={(e) => {
          e.preventDefault();
          setTool("harvest");
        }}
        onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1)}
      />
      {!s || !client || !st ? (
        <div className="overlay center">
          <div className="card">
            <p className="title">Plenty</p>
            <p>{client?.status === "error" ? client.error : "Walking to the world…"}</p>
            {client?.status === "error" && <a href="/">Back to the start</a>}
          </div>
        </div>
      ) : (
        <>
          <div className="col-left">
            <StagePanel s={s} />
            {(s.god.on || host) && s.phase.k === "play" && (
              <Gods s={s} you={client.you} host={host} view={view} onPower={chooseGod} onSwitch={(on) => client.send({ k: "gods", on })} />
            )}
            {me && <Pack s={s} me={me} onCraft={(tool) => client.send({ k: "craft", tool })} onDeposit={() => client.send({ k: "deposit" })} />}
            <Economy s={s} />
            {st.id === "earth" && s.phase.k === "play" && <Memo s={s} />}
          {st.id === "universe" && s.phase.k === "play" && <LastFrontier s={s} you={client.you} onVote={(on) => client.send({ k: "stop", on })} />}
          </div>
          <RoomPanel s={s} client={client} host={host} />
          <BuildBar s={s} me={me} view={view} onPick={chooseBuild} onTool={setTool} />
          <Log s={s} client={client} />
          {view.selected !== null && <Inspect s={s} b={s.buildings.find((b) => b.id === view.selected)} youId={client.you} host={host} onDemolish={(b) => client.send({ k: "demolish", x: b.x, y: b.y })} onClose={() => setTool("harvest")} />}
          <div className="corner-buttons">
            <div className="emotes" role="group" aria-label="Emotes">
              {EMOTES.map((e, i) => (
                <button key={e} type="button" title={`${e} (Shift+${i + 1})`} aria-label={`Emote: ${e}`} onClick={() => client.send({ k: "emote", e })}>
                  {EMOTE_GLYPH[e]}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => { view.survey = !view.survey; rerender(); }} aria-pressed={view.survey}>
              Survey (V)
            </button>
            <button type="button" onClick={photo}>Photo (P)</button>
            <button type="button" onClick={() => { if (!soundRef.current.running) soundRef.current.start(mix); setSettings((v) => !v); }} aria-expanded={settings}>
              {soundRef.current.running ? "Sound" : "Sound on"}
            </button>
            <button type="button" onClick={() => setHelp(true)}>Help (H)</button>
          </div>
          {settings && (
            <div className="panel settings" role="group" aria-label="Settings">
              {(Object.keys(mix) as (keyof Mix)[]).map((k) => (
                <label key={k}>
                  {k}
                  <input type="range" min={0} max={1} step={0.05} value={mix[k]} onChange={(e) => setMix({ ...mix, [k]: Number(e.target.value) })} />
                </label>
              ))}
              <label>
                <input type="checkbox" checked={view.reducedMotion} onChange={(e) => { view.reducedMotion = e.target.checked; rerender(); }} /> reduced motion
              </label>
              <label>
                <input type="checkbox" checked={view.low} onChange={(e) => { view.low = e.target.checked; rerender(); }} /> low detail
              </label>
              <p className="small">
                {Math.round(1000 / Math.max(1, 16.7))} fps target · frame {rendererRef.current?.frameMs.toFixed(1)} ms · ping {client.rtt} ms
              </p>
            </div>
          )}
          {help && <Help onClose={() => setHelp(false)} st={st} />}
          {naming && (
            <NameDialog
              onCancel={() => setNaming(null)}
              onName={(n) => {
                client.send({ k: "mark", x: naming[0], y: naming[1], name: n });
                setNaming(null);
                setTool("harvest");
              }}
            />
          )}
          {s.phase.k === "transition" && <Transition s={s} />}
          {s.phase.k === "ended" && <Ending s={s} />}
          <Toasts client={client} />
          {client.status === "reconnecting" && (
            <div className="overlay center" role="status">
              <div className="card">
                <p className="title">Reconnecting…</p>
                <p>The world is safe on the server. You'll be back where you were in a moment.</p>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function StagePanel({ s }: { s: Snapshot }): ReactNode {
  const st = STAGES[s.stage];
  const life = averageLife(s);
  return (
      <div className="panel top-left">
        <p className="stage">
          <span className="stage-n">Stage {s.stage + 1} of 5</span> <strong>{st.name}</strong>
        </p>
        <p className="small">{st.tagline}</p>
        <ul className="stocks" aria-label="Natural stock remaining">
          {FAMILIES.map((f) => {
            const l = s.ledger[f];
            const pct = l.initial ? (l.remaining / l.initial) * 100 : 0;
            return (
              <li key={f}>
                <span className="lbl">{st.families[f].label}</span>
                <span className="bar" aria-hidden="true">
                  <span style={{ width: `${pct}%`, background: st.palette[f] }} />
                </span>
                <span className="num">
                  {l.remaining}/{l.initial}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="small">
          {st.id === "earth" ? "Living land" : "Untouched ground"}: <strong>{life}%</strong>
          {st.mechanic === "heat" && (
            <>
              {" "}· Heat: <strong>{s.heat}</strong>/100{s.heat >= 70 ? " (throttling)" : ""}
            </>
          )}
          {st.energySource === "bottled" && (
            <>
              {" "}· Bottled Sun: <strong>{s.reserve}</strong> energy left
            </>
          )}
        </p>
      </div>
  );
}

function RoomPanel({ s, client, host }: { s: Snapshot; client: GameClient; host: boolean }): ReactNode {
  const [copied, setCopied] = useState(false);
  const status = { live: "connected", connecting: "connecting…", reconnecting: "reconnecting…", error: "disconnected" }[client.status];
  return (
      <div className="panel top-right">
        <p>
          Room <strong className="code">{s.code}</strong>{" "}
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(`${location.origin}/play/?room=${s.code}`);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Link copied" : "Copy invite link"}
          </button>
        </p>
        <p className="small" role="status">
          <span className={`dot ${client.status}`} aria-hidden="true" /> {status}
          {s.pace === "rapid" ? " · rapid preset" : ""}
        </p>
        <ul className="roster" aria-label="Players">
          {Object.values(s.players)
            .sort((a, b) => Number(b.connected) - Number(a.connected))
            .map((p) => (
              <li key={p.id} className={p.connected ? "" : "away"}>
                <span className="swatch" style={{ background: PLAYER_COLOURS[p.colour % 8] }} aria-hidden="true" />
                {p.name}
                {p.id === client.you ? " (you)" : ""}
                {s.hostId === p.id ? " · host" : ""}
                {p.connected ? "" : " · away"}
              </li>
            ))}
        </ul>
        {host && <p className="small">You're the host: you can take down anyone's buildings.</p>}
      </div>
  );
}

/** Who is a god and for how long; the god's powers; and the host's switch. */
function Gods({ s, you, host, view, onPower, onSwitch }: { s: Snapshot; you: string; host: boolean; view: View; onPower: (p: GodPower, f?: Family) => void; onSwitch: (on: boolean) => void }): ReactNode {
  const st = STAGES[s.stage];
  const god = s.god.id ? s.players[s.god.id] : undefined;
  const mine = s.god.on && s.god.id === you;
  const secs = Math.max(0, Math.ceil(((s.god.until - s.tick) * TICK_MS) / 1000));
  const on = (power: GodPower, family?: Family): boolean => view.tool === "god" && view.god?.power === power && view.god.family === family;
  const power = (label: string, title: string, p: GodPower, f?: Family): ReactNode => (
    <button key={label} type="button" className={on(p, f) ? "on" : ""} aria-pressed={on(p, f)} title={title} onClick={() => onPower(p, f)}>
      {label}
    </button>
  );
  return (
    <div className={`panel left gods ${mine ? "mine" : ""}`}>
      <h2>Gods</h2>
      {!s.god.on ? (
        <p className="small">Gods are off in this world.</p>
      ) : (
        <p role="status">
          {mine ? <strong>You are a god</strong> : god ? <><strong>{god.name}</strong> is a god</> : "Choosing a god…"}
          {god ? ` for ${secs}s more.` : ""}
        </p>
      )}
      {mine && (
        <>
          <p className="small">Pick a power, then click where it should land. Esc puts it down.</p>
          <div className="row powers">
            {power(st.names.datacentre ?? "Datacentre", "Raise a finished datacentre for nothing, anywhere it fits", "datacentre")}
            {power("Bomb", "Goes off after 3 seconds: destroys the stock and the buildings around it", "bomb")}
            {power("Aura", "For 5 seconds, everyone else standing in it harvests twice as fast", "aura")}
            {FAMILIES.map((f) => power(`Plant ${st.families[f].label}`, `A new deposit of ${st.families[f].perTile} ${st.families[f].label}`, "plant", f))}
          </div>
        </>
      )}
      {host && (
        <button type="button" onClick={() => onSwitch(!s.god.on)}>
          {s.god.on ? "Turn gods off (host)" : "Turn gods on (host)"}
        </button>
      )}
    </div>
  );
}

/** What you carry and the tools you've made: yours alone, unlike the stockpile below it. */
function Pack({ s, me, onCraft, onDeposit }: { s: Snapshot; me: Player; onCraft: (f: Family) => void; onDeposit: () => void }): ReactNode {
  const st = STAGES[s.stage];
  const empty = FAMILIES.every((f) => me.pack[f] === 0);
  const secs = (ticks: number): string => `${(ticks * TICK_MS) / 1000}s`;
  return (
    <div className="panel left pack">
      <h2>Your pack</h2>
      <ul className="inv">
        {FAMILIES.map((f) => (
          <li key={f}>
            <span className="swatch" style={{ background: st.palette[f] }} aria-hidden="true" />
            {st.families[f].label}: <strong>{me.pack[f]}</strong>
          </li>
        ))}
      </ul>
      <button type="button" disabled={empty} onClick={onDeposit}>
        Deposit in the stockpile (G)
      </button>
      <h2>Your tools</h2>
      <ul className="tools">
        {FAMILIES.map((f) => {
          const tier = me.tools[f];
          const next = TOOL_TIERS[tier + 1];
          const cost = next ? toolCost(f, tier + 1) : null;
          const problem = next ? craftProblem(s, me, f) : null;
          return (
            <li key={f}>
              <span>
                <strong>{toolName(f, tier)}</strong>: {st.families[f].label} every {secs(harvestCooldown(me.tools, f))}
              </span>
              {next && cost && (
                <button type="button" className={problem ? "short" : ""} title={problem ?? `Harvest ${st.families[f].label} every ${secs(next.cooldown)}`} onClick={() => onCraft(f)}>
                  {problem ? "✕ " : ""}Make a {toolName(f, tier + 1)}:{" "}
                  {FAMILIES.filter((g) => cost[g]).map((g) => `${cost[g]} ${st.families[g].label}`).join(", ")}
                  {next.bench ? `, beside ${buildingName(st, "city")}` : ""}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Economy({ s }: { s: Snapshot }): ReactNode {
  const st = STAGES[s.stage];
  const e = s.econ;
  // the shortage most of the machine is waiting on, so nobody has to inspect buildings one by one
  const idle = s.buildings.filter((b) => b.status !== "ok" && b.work >= BUILDINGS[b.type].build * 10);
  const tally = new Map<string, number>();
  for (const b of idle) tally.set(b.status, (tally.get(b.status) ?? 0) + 1);
  const top = [...tally].sort((a, b) => b[1] - a[1])[0];
  const bottleneck = top ? { n: idle.length, why: top[0] } : null;
  return (
    <div className="panel left">
      <h2>Stockpile (shared)</h2>
      <ul className="inv">
        {FAMILIES.map((f) => (
          <li key={f}>
            <span className="swatch" style={{ background: st.palette[f] }} aria-hidden="true" />
            {st.families[f].label}: <strong>{s.inventory[f]}</strong>
          </li>
        ))}
      </ul>
      <ul className="inv small">
        <li>
          Power {e.energyUsed}/{e.energySupply}
        </li>
        <li>
          Compute {e.computeUsed}/{e.computeSupply}
        </li>
        <li>
          Workers {e.workersUsed}/{e.workersSupply}
        </li>
      </ul>
      {bottleneck && (
        <p className="small bottleneck">
          <strong>⚠ {bottleneck.n} idle</strong>, mostly “{bottleneck.why.replace(/^(idle|unserved|throttled): /, "")}”
        </p>
      )}
    </div>
  );
}

function Memo({ s }: { s: Snapshot }): ReactNode {
  const has = (t: BuildingType): boolean => s.buildings.some((b) => b.type === t && b.owner);
  const steps: [string, boolean][] = [
    ["Gather timber and stone (E near a tree or rock)", s.ledger.matter.extracted + s.ledger.mineral.extracted >= 20],
    ["Make a tool from your pack, to gather quicker", Object.values(s.players).some((p) => FAMILIES.some((f) => p.tools[f] > 0))],
    ["Build Cottages for workers", has("city")],
    ["Power them: a Furnace or a Sun Garden", has("furnace") || has("solar")],
    ["Build a Datacentre (it drinks pond water)", has("datacentre")],
    ["Put a Harvester beside a grove", has("extractor")],
    ["Name a favourite place (N)", s.tiles.some((t) => t.mark && t.mark.by !== "the Cooperative") || s.archive.length > 0],
  ];
  const next = steps.findIndex(([, done]) => !done);
  if (next === -1) return null;
  return (
    <div className="panel memo">
      <h2>Cooperative memo</h2>
      <ol>
        {steps.map(([text, done], i) => (
          <li key={text} className={done ? "done" : i === next ? "next" : ""}>
            {done ? "✓ " : ""}
            {text}
          </li>
        ))}
      </ol>
    </div>
  );
}

function LastFrontier({ s, you, onVote }: { s: Snapshot; you: string; onVote: (on: boolean) => void }): ReactNode {
  const here = Object.values(s.players).filter((p) => p.connected);
  const ready = here.filter((p) => p.stop).length;
  const mine = !!s.players[you]?.stop;
  const left = FAMILIES.reduce((a, f) => a + s.ledger[f].remaining, 0);
  return (
    <div className="panel memo">
      <h2>The last frontier</h2>
      <p className="small">
        {left} units of the Universe are left. You could stop here and leave them alone, for good. Everyone here has to agree; harvesting or building takes your vote back.
      </p>
      <p className="small">
        <strong>
          {ready} of {here.length}
        </strong>{" "}
        here want to stop.
      </p>
      <button type="button" aria-pressed={mine} onClick={() => onVote(!mine || ready === here.length)}>
        {mine ? (ready === here.length ? "Stop for good" : "Keep going instead") : "Stop here"}
      </button>
    </div>
  );
}

function BuildBar({ s, me, view, onPick, onTool }: { s: Snapshot; me: Player | undefined; view: View; onPick: (t: BuildingType) => void; onTool: (t: Tool) => void }): ReactNode {
  const st = STAGES[s.stage];
  return (
    <div className="panel bottom" role="toolbar" aria-label="Build and tools">
      {st.buildings.map((type, i) => {
        const def = BUILDINGS[type];
        const short = FAMILIES.filter((f) => (def.cost[f] ?? 0) > s.inventory[f] + (me?.pack[f] ?? 0));
        const cost = FAMILIES.filter((f) => def.cost[f]).map((f) => `${def.cost[f]} ${st.families[f].label}`).join(", ");
        return (
          <button
            key={type}
            type="button"
            className={`build ${view.build === type ? "on" : ""} ${short.length ? "short" : ""}`}
            aria-pressed={view.build === type}
            title={def.blurb}
            aria-label={`${buildingName(st, type)}, costs ${cost || "nothing"}${short.length ? ", can't afford yet" : ""}`}
            onClick={() => onPick(type)}
          >
            <span className="key">{i + 1}</span>
            <span className="bname">{buildingName(st, type)}</span>
            <span className="cost">
              {short.length ? "✕ " : ""}
              {cost || "free"}
            </span>
          </button>
        );
      })}
      <span className="sep" aria-hidden="true" />
      {(["harvest", "inspect", "demolish", "mark"] as Tool[]).map((t) => (
        <button key={t} type="button" className={`tool ${view.tool === t ? "on" : ""}`} aria-pressed={view.tool === t} onClick={() => onTool(t)}>
          {{ harvest: "Harvest (E)", inspect: "Inspect (I)", demolish: "Take down (X)", mark: "Name (N)", build: "", god: "" }[t]}
        </button>
      ))}
    </div>
  );
}

function Log({ s, client }: { s: Snapshot; client: GameClient }): ReactNode {
  void client;
  return (
    <div className="panel log" aria-live="polite" aria-label="Activity">
      {s.log.slice(-4).map((l, i) => (
        <p key={`${l.tick}-${i}`}>{l.text}</p>
      ))}
    </div>
  );
}

function Inspect({ s, b, youId, host, onDemolish, onClose }: { s: Snapshot; b: Building | undefined; youId: string; host: boolean; onDemolish: (b: Building) => void; onClose: () => void }): ReactNode {
  if (!b) return null;
  const st = STAGES[s.stage];
  const def = BUILDINGS[b.type];
  const owner = b.owner ? (s.players[b.owner]?.name ?? "someone") : "the Cooperative";
  const done = b.work >= def.build * 10;
  const io: string[] = [];
  if (def.energy) io.push(def.energy > 0 ? `+${def.energy * (b.type === "solar" ? st.solarScale : 1)} power` : `uses ${-def.energy} power`);
  if (def.workers) io.push(def.workers > 0 ? `houses ${def.workers}–5 workers` : `employs ${-def.workers} workers`);
  if (def.compute) io.push(def.compute > 0 ? `+${def.compute} compute` : `uses ${-def.compute} compute`);
  if (def.coolantUse) io.push(`drinks ${def.coolantUse} ${st.families.coolant.label}`);
  if (def.fuelUse) io.push(`burns ${def.fuelUse} ${st.families.matter.label}`);
  if (def.extract) io.push(`harvests ${def.extract} from a neighbour`);
  const canDemolish = !def.protected && (def.renderValue ? host : b.owner === youId || host);
  return (
    <div className="panel inspect" role="dialog" aria-label={`${buildingName(st, b.type)} details`}>
      <h2>{b.name ?? buildingName(st, b.type)}</h2>
      <p className="small">Built by {owner}. {def.blurb}</p>
      <p>
        Status: <strong>{done ? (b.status === "ok" ? "running" : b.status) : `under construction (${Math.round((b.work / (def.build * 10)) * 100)}%) — press E beside it to help`}</strong>
      </p>
      <p className="small">Per tick: {io.join(" · ") || "nothing"}</p>
      <div className="row">
        {canDemolish && (
          <button type="button" onClick={() => onDemolish(b)}>
            {def.renderValue ? `Render down (+${def.renderValue} energy, forever)` : "Take down (half back)"}
          </button>
        )}
        <button type="button" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function Help({ onClose, st }: { onClose: () => void; st: (typeof STAGES)[number] }): ReactNode {
  return (
    <div className="overlay center" role="dialog" aria-modal="true" aria-labelledby="help-h">
      <div className="card help">
        <h2 id="help-h">How to play</h2>
        <ul>
          <li><kbd>WASD</kbd> or arrows: walk. Wheel or <kbd>+</kbd>/<kbd>-</kbd>: zoom.</li>
          <li><kbd>E</kbd>/<kbd>Space</kbd> (hold): harvest whatever's in reach, or help raise a building site. Or click a deposit.</li>
          <li><kbd>1</kbd>–<kbd>6</kbd>: pick a building. A ghost shows where it goes and why it can't. Click, or <kbd>Enter</kbd> for the tile you face. <kbd>Esc</kbd> cancels.</li>
          <li><kbd>I</kbd> inspect · <kbd>X</kbd> take down (half back) · <kbd>N</kbd> name a place · <kbd>G</kbd> deposit your pack · <kbd>V</kbd> survey the remaining stock · <kbd>P</kbd> photo · <kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>6</kbd> emote.</li>
        </ul>
        <p>What you gather by hand goes into your own pack. Building spends your pack first and the shared stockpile after it; machines fill the stockpile and run on it, so deposit what they need.</p>
        <p>Tools are made from your pack and make your own harvesting quicker: a Cutter, a Pick and a Scoop, one for each kind of stock. A rough one can be made anywhere; a fine one needs you beside finished homes. You keep them from world to world.</p>
        <p>Buildings remember who built them; only the builder or the host can take one down.</p>
        <p>In a world hosted with gods, someone here becomes a god every 30 seconds. A god can raise a datacentre for nothing, put a bomb down, plant new stock, or lay an aura that doubles everyone else's harvesting speed for 5 seconds. The host can turn gods off and on.</p>
        <p>When every deposit on this world is gone, the room moves on together. There are five worlds.</p>
        <p><strong>{st.name}:</strong> {MECHANIC_HINT[st.mechanic]}</p>
        <button type="button" onClick={onClose} autoFocus>Back to the world</button>
      </div>
    </div>
  );
}

function NameDialog({ onName, onCancel }: { onName: (n: string) => void; onCancel: () => void }): ReactNode {
  const [v, setV] = useState("");
  return (
    <div className="overlay center" role="dialog" aria-modal="true" aria-labelledby="name-h">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (v.trim()) onName(v.trim());
        }}
      >
        <h2 id="name-h">Name this place</h2>
        <label>
          Name <input autoFocus maxLength={24} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onCancel()} />
        </label>
        <div className="row">
          <button type="submit">Name it</button>
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function Transition({ s }: { s: Snapshot }): ReactNode {
  if (s.phase.k !== "transition") return null;
  const sum = s.phase.summary;
  const st = STAGES.find((x) => x.id === sum.stage)!;
  const next = STAGES[s.stage + 1];
  const secs = Math.max(0, Math.ceil((s.phase.until - s.tick) / 10));
  return (
    <div className="overlay bottom-card" role="status">
      <div className="card transition">
        <h2>{st.departure}</h2>
        <table>
          <thead>
            <tr><th scope="col">Stock</th><th scope="col">Was</th><th scope="col">Extracted</th><th scope="col">Destroyed</th></tr>
          </thead>
          <tbody>
            {FAMILIES.map((f) => (
              <tr key={f}>
                <th scope="row">{st.families[f].label}</th>
                <td>{sum.ledger[f].initial}</td>
                <td>{sum.ledger[f].extracted}</td>
                <td>{sum.ledger[f].destroyed}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          {st.id === "earth" ? "Living land" : "Untouched ground"}: {sum.lifeStart}% → {sum.lifeEnd}%.{" "}
          {sum.lost.length ? `Lost: ${sum.lost.join(", ")}.` : ""}
        </p>
        <p className="small">{next ? `Leaving for ${next.name} in ${secs}s.` : `The engine looks for a next frontier… ${secs}s`}</p>
      </div>
    </div>
  );
}

function Ending({ s }: { s: Snapshot }): ReactNode {
  const total = s.history.reduce((a, h) => a + FAMILIES.reduce((b, f) => b + h.ledger[f].extracted + h.ledger[f].destroyed, 0), 0);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  if (hidden)
    return (
      <div className="overlay bottom-card">
        <button type="button" onClick={() => setHidden(false)}>
          Back to the ending
        </button>
      </div>
    );
  const restraint = s.phase.k === "ended" && s.phase.how === "restraint";
  const left = FAMILIES.reduce((a, f) => a + s.ledger[f].remaining, 0);
  const hands = `${Object.keys(s.players).length} pair${Object.keys(s.players).length === 1 ? "" : "s"} of hands`;
  return (
    <div className="overlay center ending" role="dialog" aria-labelledby="end-h">
      <div className={`card ${restraint ? "dawn" : "dark"}`}>
        {restraint ? (
          <>
            <h2 id="end-h">You stopped.</h2>
            <p>
              Four worlds and most of a fifth, {total.toLocaleString("en-AU")} units of everything, consumed by {hands}. {left.toLocaleString("en-AU")} units of the Universe are
              still out there, and will stay there.
            </p>
            <p>The Cooperative's machine idles. It could have finished. Nobody asked it to.</p>
          </>
        ) : (
          <>
            <h2 id="end-h">There is nothing left.</h2>
            <p>Five worlds, {total.toLocaleString("en-AU")} units of everything, consumed by {hands}.</p>
            <p>The machine runs perfectly. It has no input. Somewhere in its last datacentre, a process is still searching for a next frontier.</p>
            <p className="search" aria-hidden="true">searching… 0 found</p>
          </>
        )}
        <h3>What was named, and what became of it</h3>
        <ul className="archive">
          {s.archive.map((a, i) => (
            <li key={i}>
              <strong>{a.name}</strong> ({STAGES.find((x) => x.id === a.stage)?.name}) {a.fate}.
            </li>
          ))}
        </ul>
        <h3>Who did it</h3>
        <ul>
          {Object.values(s.players).map((p) => (
            <li key={p.id}>
              {p.name}: harvested {p.stats.harvested}, built {p.stats.built}, helped {p.stats.helped} times
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const res = await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pace: s.pace }) });
            const { code } = (await res.json()) as { code: string };
            location.href = `/play/?room=${code}`;
          }}
        >
          Start a new campaign, somewhere else
        </button>{" "}
        <button type="button" onClick={() => setHidden(true)}>
          Look at what's left
        </button>
      </div>
    </div>
  );
}

function Toasts({ client }: { client: GameClient }): ReactNode {
  return (
    <div className="toasts" aria-live="assertive">
      {client.toasts.map((t) => (
        <p key={t.id} className={t.kind}>
          {t.kind === "bad" ? "✕ " : ""}
          {t.text}
        </p>
      ))}
    </div>
  );
}
