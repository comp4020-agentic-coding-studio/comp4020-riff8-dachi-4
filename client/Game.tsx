"use client";
// The play screen: the canvas (driven by Renderer's own frame loop) plus a
// compact React HUD that re-renders at most five times a second from the
// client's version counter, never per entity update.
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BUILDINGS,
  EMOTES,
  FACTIONS,
  FACTION_IDS,
  FAMILIES,
  GOD_GAP_TICKS,
  GOD_POWERS,
  GOD_TURN_TICKS,
  HARVEST_COOLDOWN_TICKS,
  HARVEST_RANGE,
  RESERVE_COST,
  SHIP_CARGO,
  STAGES,
  TICK_MS,
  TOOL_TIERS,
  buildingName,
  harvestCooldown,
  powerName,
  toolCost,
  toolName,
  type BuildingType,
  type Emote,
  type FactionId,
  type Family,
  type GodPower,
  type Shape,
} from "../shared/content.ts";
import type { Building, Player, Snapshot, World } from "../shared/protocol.ts";
import { averageLife, buildable, costOf, craftProblem, factionProblem, harvestTicks, launchPlan, measureText, reachedPar } from "../shared/sim.ts";
import { GameClient } from "./net.ts";
import { PLAYER_COLOURS, Renderer, godPreview, type Tool, type View } from "./render.ts";

/** The viewed world, as the per-world rules see it. */
const W = (s: Snapshot): World => s as unknown as World;
const SHAPE_GLYPH: Record<Shape, string> = { square: "■", circle: "●", triangle: "▲", diamond: "◆" };
/** A faction's badge: its shape and its colour, and the shape alone carries it. */
function Badge({ f }: { f: FactionId }): ReactNode {
  return (
    <span className="badge" style={{ color: FACTIONS[f].colour }} aria-label={FACTIONS[f].name} title={FACTIONS[f].name}>
      {SHAPE_GLYPH[FACTIONS[f].shape]}
    </span>
  );
}
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
  const viewRef = useRef<View>({ tool: "harvest", build: null, god: null, hover: null, keyboardTarget: true, survey: false, selected: null, reducedMotion: prefersReducedMotion(), low: false, zoom: 1, map: false });
  const [, force] = useState(0);
  const [help, setHelp] = useState(false);
  const [naming, setNaming] = useState<[number, number] | null>(null);
  const [mix, setMix] = useState<Mix>({ music: 0.5, ambience: 0.7, effects: 0.8 });
  const [settings, setSettings] = useState(false);
  const [bar, setBar] = useState<"build" | "powers">("build");
  const barRef = useRef(bar);
  barRef.current = bar;
  const [sowing, setSowing] = useState(false);
  const [launching, setLaunching] = useState<Building | null>(null);
  const [trading, setTrading] = useState(false);
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
      else if (cmd.k === "launch") snd.launch();
      else if (cmd.k === "god" && cmd.power === "bless") snd.shimmer();
    };
    const prevBoundary = c.onBoundary;
    c.onBoundary = () => {
      prevBoundary?.();
      viewRef.current.build = null;
      viewRef.current.selected = null;
      // a god aiming at another world keeps the power in hand
      if (viewRef.current.tool !== "god") {
        soundRef.current.boundary();
        viewRef.current.tool = "harvest";
        viewRef.current.god = null;
      }
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
  const godRef = useRef<string | null>(null);
  const worldRef = useRef<number>(-2);
  useEffect(() => {
    if (!s || !client) return;
    const snd = soundRef.current;
    if (s.god.id && s.god.id !== godRef.current) snd.ascend();
    godRef.current = s.god.id;
    const mine = s.players[client.you]?.world ?? 0;
    if (worldRef.current === -1 && mine >= 0) snd.landing();
    worldRef.current = mine;
    snd.life = averageLife(W(s));
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
      const ticks = family && st && me ? harvestTicks(st, W(st), { ...me, x: client.me.x, y: client.me.y }, family) : HARVEST_COOLDOWN_TICKS;
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
      const cs = client.state;
      const isGod = !!(cs && cs.god.on && cs.god.id === client.you);
      if (k === "enter" && viewRef.current.tool === "god") {
        // a power stays in hand: hold Enter to use it again and again
        e.preventDefault();
        viewRef.current.keyboardTarget = true;
        const tgt = rendererRef.current?.facingTile() ?? viewRef.current.hover;
        if (tgt) act(tgt[0], tgt[1]);
        return;
      }
      if (e.repeat) return;
      if (k === "m" && cs?.mode === "cosmos") {
        viewRef.current.map = !viewRef.current.map;
        rerender();
        return;
      }
      if (isGod && cs && (k === "[" || k === "]") && cs.mode === "cosmos") {
        // the god's world selector: aim, and look where you aim
        const n = cs.summaries.length;
        const next = (cs.viewing + (k === "]" ? 1 : n - 1)) % n;
        client.view(next);
        client.send({ k: "aim", world: next });
        return;
      }
      if (k === "tab" && isGod) {
        e.preventDefault();
        setBar((b) => (b === "powers" ? "build" : "powers"));
        return;
      }
      if (isGod && barRef.current === "powers" && /^[1-5]$/.test(k)) {
        e.preventDefault();
        const power = GOD_POWERS[Number(k) - 1];
        if (power === "sow") setSowing(true);
        else chooseGod(power);
        return;
      }
      if (k === "e" || k === " ") {
        e.preventDefault();
        if (!harvestTimer) holdHarvest();
      } else if (e.shiftKey && /^digit[1-6]$/i.test(e.code)) {
        e.preventDefault();
        client.send({ k: "emote", e: EMOTES[Number(e.code.slice(5)) - 1] });
      } else if (/^[1-9]$/.test(k) && st && client.state) {
        const me = client.state.players[client.you];
        const type = buildable(client.state, W(client.state), me?.faction)[Number(k) - 1];
        if (type) {
          e.preventDefault();
          chooseBuild(type);
        }
      } else if (k === "escape") {
        setTool("harvest");
        setHelp(false);
        setSowing(false);
        if (viewRef.current.map) {
          viewRef.current.map = false;
          rerender();
        }
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
    setSowing(false);
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
        if (view.god) c.send({ k: "god", power: view.god.power, x, y, family: view.god.family, world: st.viewing });
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
          if (site && site.type === "pad" && site.work >= BUILDINGS.pad.build * 10 && st.players[c.you]?.world === st.viewing) {
            setLaunching(site);
          } else if (site && site.work >= BUILDINGS[site.type].build * 10) {
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
    if (view.map && client) {
      // clicking a disc views that world; it never costs a turn or a resource
      const rect = e.currentTarget.getBoundingClientRect();
      const i = rendererRef.current?.discAt(e.clientX - rect.left, e.clientY - rect.top);
      if (i !== null && i !== undefined) {
        client.view(i);
        if (client.state?.god.id === client.you) client.send({ k: "aim", world: i });
        view.map = false;
        rerender();
      }
      return;
    }
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
  // a god's turn ends on the server's clock: put the power down when it does, and switch the bar back
  const isGod = !!(s && client && s.god.on && s.god.id === client.you);
  if (view.tool === "god" && !isGod) {
    view.tool = "harvest";
    view.god = null;
  }
  const wasGod = useRef(false);
  useEffect(() => {
    if (isGod && !wasGod.current) setBar("powers");
    if (!isGod && wasGod.current) setBar("build");
    wasGod.current = isGod;
  }, [isGod]);
  const onWorld = !!(me && s && me.world === s.viewing);
  const needCards = !!(s && me && s.mode === "cosmos" && !me.faction && s.phase.k === "play");

  return (
    <main className={`game ${view.map && s?.mode === "cosmos" ? "mapping" : ""}`}>
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
            {host && s.phase.k === "play" && <HostSwitch s={s} onSwitch={(on) => client.send({ k: "gods", on })} />}
            {s.mode === "cosmos" && <WorldChips s={s} me={me} onView={(i) => client.view(i)} onMap={() => { view.map = !view.map; rerender(); }} />}
            <StagePanel s={s} me={me} />
            {me && <Pack s={s} me={me} onCraft={(tool) => client.send({ k: "craft", tool })} onDeposit={() => client.send({ k: "deposit" })} />}
            <Economy s={s} me={me} onTrade={() => setTrading(true)} />
            {s.mode === "classic" && st.id === "earth" && s.phase.k === "play" && <Memo s={s} />}
            {st.id === "universe" && s.phase.k === "play" && (s.mode === "classic" || s.summaries.slice(0, -1).every((w) => w.spent)) && (
              <LastFrontier s={s} you={client.you} onVote={(on) => client.send({ k: "stop", on })} />
            )}
          </div>
          {s.god.on && s.phase.k === "play" && <GodLine s={s} you={client.you} />}
          <RoomPanel s={s} client={client} host={host} />
          {s.mode === "cosmos" && <FactionPanel s={s} />}
          {isGod && bar === "powers" ? (
            <PowersBar s={s} you={client.you} view={view} sowing={sowing} onSow={() => setSowing((v) => !v)} onPower={chooseGod} onFlip={() => setBar("build")} />
          ) : (
            <BuildBar s={s} me={me} view={view} onWorld={onWorld} onPick={chooseBuild} onTool={setTool} god={isGod} onFlip={() => setBar("powers")} />
          )}
          {needCards && me && <FactionCards s={s} me={me} onPick={(f) => client.send({ k: "faction", f })} />}
          {launching && me && <LaunchPanel s={s} me={me} pad={launching} onLaunch={(c) => { client.send(c); setLaunching(null); }} onClose={() => setLaunching(null)} />}
          {trading && me?.faction && <TradePanel s={s} me={me} onGive={(to, cargo) => { client.send({ k: "transfer", to, cargo }); setTrading(false); }} onClose={() => setTrading(false)} />}
          <Log s={s} client={client} />
          {view.selected !== null && <Inspect s={s} b={s.buildings.find((b) => b.id === view.selected)} youId={client.you} host={host} onDemolish={(b) => client.send({ k: "demolish", x: b.x, y: b.y })} onReserve={me?.faction === "stewards" && onWorld ? (x, y) => client.send({ k: "reserve", x, y }) : undefined} onClose={() => setTool("harvest")} />}
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
          {help && <Help onClose={() => setHelp(false)} st={st} cosmos={s.mode === "cosmos"} />}
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
          {s.mode === "cosmos" && me && me.world < 0 && <InFlight s={s} me={me} />}
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

function StagePanel({ s, me }: { s: Snapshot; me: Player | undefined }): ReactNode {
  const st = STAGES[s.stage];
  const life = averageLife(W(s));
  const where = s.mode === "cosmos" ? (me && me.world === s.viewing ? "You're here" : me && me.world < 0 ? "Looking, from a ship" : "Only looking: you can't build or harvest here") : `Stage ${s.stage + 1} of 5`;
  return (
      <div className="panel top-left">
        <p className="stage">
          <span className="stage-n">{where}</span> <strong>{st.name}</strong>
          {s.spent ? " · spent" : ""}
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
          {(st.energySource === "bottled" || s.mode === "cosmos") && (
            <>
              {" "}· Bottled Sun: <strong>{s.reserve}</strong> energy
            </>
          )}
        </p>
      </div>
  );
}

function RoomPanel({ s, client, host }: { s: Snapshot; client: GameClient; host: boolean }): ReactNode {
  const [copied, setCopied] = useState(false);
  const status = { live: "connected", connecting: "connecting…", reconnecting: "reconnecting…", error: "disconnected" }[client.status];
  // bots only while they hold a seat; people whether here or away
  const people = Object.values(s.players).filter((p) => !p.bot || p.connected);
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
          {s.mode === "cosmos" ? " · cosmos" : ""}
        </p>
        <ul className="roster" aria-label="Players">
          {people
            .sort((a, b) => Number(b.connected) - Number(a.connected) || Number(!!a.bot) - Number(!!b.bot))
            .map((p) => (
              <li key={p.id} className={p.connected ? "" : "away"}>
                {p.faction ? <Badge f={p.faction} /> : <span className="swatch" style={{ background: PLAYER_COLOURS[p.colour % 8] }} aria-hidden="true" />}
                {p.name}
                {p.bot ? " (bot)" : ""}
                {p.id === client.you ? " (you)" : ""}
                {s.hostId === p.id ? " · host" : ""}
                {s.god.id === p.id ? " · god" : ""}
                {p.connected ? "" : " · away"}
                {s.mode === "cosmos" && p.connected ? ` · ${p.world < 0 ? "in flight" : STAGES[s.summaries[p.world]?.stage ?? 0].name}` : ""}
                {p.god.turns > 0 && (p.god.sown || p.god.destroyed) ? (
                  <span className="small"> · sown {p.god.sown}, destroyed {p.god.destroyed}</span>
                ) : null}
              </li>
            ))}
        </ul>
        {host && <p className="small">You're the host: you can take down anyone's buildings.</p>}
      </div>
  );
}

/** The host's switch: first in the left column, in both modes. */
function HostSwitch({ s, onSwitch }: { s: Snapshot; onSwitch: (on: boolean) => void }): ReactNode {
  return (
    <div className="panel host-switch">
      <label className="switch">
        <input type="checkbox" role="switch" checked={s.god.on} onChange={(e) => onSwitch(e.target.checked)} /> God mode {s.god.on ? "on" : "off"}
      </label>
    </div>
  );
}

/** Five world chips, each with its stock ring: the cosmos one glance away. */
function WorldChips({ s, me, onView, onMap }: { s: Snapshot; me: Player | undefined; onView: (i: number) => void; onMap: () => void }): ReactNode {
  return (
    <div className="panel chips" role="group" aria-label="Worlds">
      {s.summaries.map((w, i) => {
        const st = STAGES[w.stage];
        const left = w.total ? w.left / w.total : 0;
        const here = me?.world === i;
        return (
          <button
            key={i}
            type="button"
            className={`chip ${i === s.viewing ? "on" : ""} ${w.spent ? "spent" : ""}`}
            aria-pressed={i === s.viewing}
            aria-label={`${st.name}: ${Math.round(left * 100)}% stock left${w.spent ? ", spent" : ""}${here ? ", you're here" : ""}${w.strikes.length ? `, ${w.strikes.length} strike${w.strikes.length === 1 ? "" : "s"} coming` : ""}`}
            title={st.name}
            onClick={() => onView(i)}
          >
            <span className="ring" style={{ background: `conic-gradient(#3a2c2c ${left * 360}deg, rgba(0,0,0,0.12) 0)` }} aria-hidden="true">
              <span style={{ background: w.spent ? "#77757d" : `rgb(${st.palette.lush.join(",")})` }} />
            </span>
            <span className="cname">{st.name.replace("The ", "")}</span>
            {here && <span className="you" aria-hidden="true">●</span>}
            {w.strikes.length > 0 && <span className="warn" aria-hidden="true">!</span>}
          </button>
        );
      })}
      <button type="button" className="chip map" onClick={onMap}>
        Map (M)
      </button>
    </div>
  );
}

/** One compact line at the top centre: who the god is and how long, or how long until the next. */
function GodLine({ s, you }: { s: Snapshot; you: string }): ReactNode {
  const god = s.god.id ? s.players[s.god.id] : undefined;
  const turnLeft = Math.max(0, s.god.until - s.tick);
  const gapLeft = Math.max(0, s.god.next - s.tick);
  const secs = (t: number): number => Math.ceil((t * TICK_MS) / 1000);
  const aimed = god && s.mode === "cosmos" && s.god.aim !== s.viewing ? s.summaries[s.god.aim] : undefined;
  const pending = s.mode === "cosmos" ? s.summaries.map((w, i) => ({ w, i })).filter(({ w, i }) => i !== s.viewing && w.strikes.length) : [];
  return (
    <div className="godline" role="status" aria-live="polite">
      {god ? (
        <>
          <p>
            <strong>{god.id === you ? "You are" : `${god.name}${god.bot ? " (bot)" : ""} is`}</strong> a god · {secs(turnLeft)}s
          </p>
          <span className="drain" aria-hidden="true">
            <span style={{ width: `${(turnLeft / GOD_TURN_TICKS) * 100}%` }} />
          </span>
        </>
      ) : (
        <p>No god. Next in {secs(gapLeft || GOD_GAP_TICKS)}s.</p>
      )}
      {aimed && <p className="small">{god!.name} is aiming at {STAGES[aimed.stage].name}.</p>}
      {pending.slice(0, 1).map(({ w }) => (
        <p key={w.stage} className="small">
          {STAGES[w.stage].powers.strike} on {STAGES[w.stage].name} lands in {Math.max(0, secs(Math.min(...w.strikes.map((b) => b.at)) - s.tick))}s.
        </p>
      ))}
    </div>
  );
}

/** The god's bar: five powers in this world's names, keys 1-5. */
function PowersBar({ s, you, view, sowing, onSow, onPower, onFlip }: { s: Snapshot; you: string; view: View; sowing: boolean; onSow: () => void; onPower: (p: GodPower, f?: Family) => void; onFlip: () => void }): ReactNode {
  const st = STAGES[s.stage];
  const blurb: Record<GodPower, string> = {
    sow: "A full new deposit on an empty tile",
    bless: "Everyone in it but you harvests twice as fast, 5 seconds",
    hush: "Nothing in it can be taken, by hand or machine, 10 seconds",
    gift: `A finished ${buildingName(st, "datacentre")}, free, wherever one fits`,
    strike: "Lands in 3 seconds: stock destroyed, buildings fall, the ground dies",
  };
  const on = (p: GodPower): boolean => view.tool === "god" && view.god?.power === p;
  const hover = view.hover;
  const preview = view.tool === "god" && view.god && hover ? godPreview(s, view.god, hover[0], hover[1], you) : null;
  return (
    <div className="panel bottom powers-bar" role="toolbar" aria-label="God powers">
      {s.mode === "cosmos" && (
        <span className="aim small">
          Aiming at <strong>{st.name}</strong> ([ ])
        </span>
      )}
      {GOD_POWERS.map((p, i) => (
        <button key={p} type="button" className={`build ${on(p) || (p === "sow" && sowing) ? "on" : ""}`} aria-pressed={on(p)} title={blurb[p]} onClick={() => (p === "sow" ? onSow() : onPower(p))}>
          <span className="key">{i + 1}</span>
          <span className="bname">{powerName(st, p)}</span>
          <span className="cost">{blurb[p].split(",")[0].split(":")[0]}</span>
        </button>
      ))}
      {sowing && (
        <span className="sow-pick" role="group" aria-label="Sow what">
          {FAMILIES.map((f) => (
            <button key={f} type="button" className={view.god?.power === "sow" && view.god.family === f ? "on" : ""} onClick={() => onPower("sow", f)}>
              {st.families[f].label}
            </button>
          ))}
        </span>
      )}
      <span className="sep" aria-hidden="true" />
      <button type="button" className="tool" onClick={onFlip}>
        Build (Tab)
      </button>
      {preview && <p className={`preview small ${preview.ok ? "" : "bad"}`}>{preview.text}</p>}
    </div>
  );
}

/** The four cards a newcomer to a cosmos room chooses from, or "deal me one". */
function FactionCards({ s, me, onPick }: { s: Snapshot; me: Player; onPick: (f: FactionId | "deal") => void }): ReactNode {
  const secs = me.dealAt !== undefined ? Math.max(0, Math.ceil(((me.dealAt - s.tick) * TICK_MS) / 1000)) : null;
  const room = asRoom(s);
  return (
    <div className="overlay center" role="dialog" aria-modal="true" aria-labelledby="fc-h">
      <div className="card factions">
        <h2 id="fc-h">Four divisions of the Plenty Cooperative</h2>
        <p className="small">Each wants something the others spend or need. Pick one, or be dealt one{secs !== null ? ` (in ${secs}s if you don't)` : ""}. You can change until you first harvest or build.</p>
        <div className="cards">
          {FACTION_IDS.map((f) => {
            const d = FACTIONS[f];
            const problem = s.pick === "deal" ? "the host deals factions in this room" : factionProblem(room, me, f);
            const held = Object.values(s.players).filter((p) => p.connected && p.faction === f);
            return (
              <button key={f} type="button" className="fcard" disabled={!!problem} onClick={() => onPick(f)} style={{ borderColor: d.colour }} aria-describedby={`fc-${f}`}>
                <span className="fname">
                  <Badge f={f} /> {d.name}
                </span>
                <em>{d.doctrine}</em>
                <span id={`fc-${f}`} className="small">
                  {d.uniqueText} Goal: {d.goal}. {d.needs}
                  {held.length ? ` Now: ${held.map((p) => p.name + (p.bot ? " (bot)" : "")).join(", ")}.` : ""}
                  {problem ? ` ${problem}.` : ""}
                </span>
              </button>
            );
          })}
        </div>
        {s.pick !== "choose" && (
          <button type="button" onClick={() => onPick("deal")} autoFocus>
            Deal me one
          </button>
        )}
      </div>
    </div>
  );
}

/** Each faction's own measure beside its par, in words: no ranking, no winner. */
function FactionPanel({ s }: { s: Snapshot }): ReactNode {
  return (
    <div className="panel factions-panel" aria-label="Factions">
      <h2>Each faction, by its own measure</h2>
      <ul>
        {FACTION_IDS.map((f) => (
          <li key={f}>
            <Badge f={f} /> <strong>{FACTIONS[f].name}</strong> {factionLine(s, f)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A Snapshot's faction measure, worked out from what the client has: the summaries stand in for the worlds. */
function factionLine(s: Snapshot, f: FactionId): string {
  const room = asRoom(s);
  return measureText(room, f);
}
/**
 * The room as the shared rules see it, from what a client holds: the viewed
 * world in full, the others as stand-ins built from their summaries (enough
 * for the faction measures, fuel and launch checks, which only read their
 * phase and life).
 */
function asRoom(s: Snapshot): Parameters<typeof measureText>[0] {
  const full = { initial: 1, remaining: 1, extracted: 0, destroyed: 0 };
  const worlds = s.summaries.map((w, i) =>
    i === s.viewing ? W(s) : { stage: w.stage, spent: w.spent, lifeEnd: w.life, ledger: { matter: full, mineral: full, coolant: full }, tiles: [{ t: 0, life: w.life }] },
  );
  return { ...s, worlds } as never;
}

/** What you carry and the tools you've made: yours alone, unlike the stockpile below it. */
function Pack({ s, me, onCraft, onDeposit }: { s: Snapshot; me: Player; onCraft: (f: Family) => void; onDeposit: () => void }): ReactNode {
  // what you carry is named for the world you stand on, whichever one you're looking at
  const st = STAGES[s.mode === "cosmos" && me.world >= 0 ? (s.summaries[me.world]?.stage ?? s.stage) : s.stage];
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
          const problem = next ? craftProblem(me.world === s.viewing ? W(s) : { buildings: [], stage: st === STAGES[s.stage] ? s.stage : STAGES.indexOf(st) }, me, f) : null;
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

function Economy({ s, me, onTrade }: { s: Snapshot; me: Player | undefined; onTrade: () => void }): ReactNode {
  const st = STAGES[s.stage];
  const e = s.econ;
  // the shortage most of the machine is waiting on, so nobody has to inspect buildings one by one
  const idle = s.buildings.filter((b) => b.status !== "ok" && b.work >= BUILDINGS[b.type].build * 10);
  const tally = new Map<string, number>();
  for (const b of idle) tally.set(b.status, (tally.get(b.status) ?? 0) + 1);
  const top = [...tally].sort((a, b) => b[1] - a[1])[0];
  const bottleneck = top ? { n: idle.length, why: top[0] } : null;
  const cosmos = s.mode === "cosmos";
  const f = me?.faction;
  const pool = cosmos ? (f ? (s.stock[f] ?? { matter: 0, mineral: 0, coolant: 0 }) : null) : s.inventory;
  return (
    <div className="panel left">
      <h2>{cosmos ? (f ? <><Badge f={f} /> {FACTIONS[f].name} stockpile on {st.name}</> : "No faction yet") : "Stockpile (shared)"}</h2>
      {pool && (
        <ul className="inv">
          {FAMILIES.map((fam) => (
            <li key={fam}>
              <span className="swatch" style={{ background: st.palette[fam] }} aria-hidden="true" />
              {st.families[fam].label}: <strong>{pool[fam]}</strong>
            </li>
          ))}
        </ul>
      )}
      {cosmos && f && me?.world === s.viewing && (
        <button type="button" onClick={onTrade}>
          Give to another faction…
        </button>
      )}
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
          <strong>⚠ {bottleneck.n} idle</strong>, mostly “{bottleneck.why.replace(/^(idle|unserved|throttled|dormant): /, "")}”
        </p>
      )}
    </div>
  );
}

/** Give stock to another faction on this world: free and instant, which is how deals happen. */
function TradePanel({ s, me, onGive, onClose }: { s: Snapshot; me: Player; onGive: (to: FactionId, cargo: Record<Family, number>) => void; onClose: () => void }): ReactNode {
  const st = STAGES[s.stage];
  const others = FACTION_IDS.filter((f) => f !== me.faction);
  const [to, setTo] = useState<FactionId>(others[0]);
  const [cargo, setCargo] = useState<Record<Family, number>>({ matter: 0, mineral: 0, coolant: 0 });
  const have = s.stock[me.faction!] ?? { matter: 0, mineral: 0, coolant: 0 };
  return (
    <div className="panel inspect" role="dialog" aria-label="Give to another faction">
      <h2>Give to another faction on {st.name}</h2>
      <label>
        To{" "}
        <select value={to} onChange={(e) => setTo(e.target.value as FactionId)}>
          {others.map((f) => (
            <option key={f} value={f}>
              {FACTIONS[f].name}
            </option>
          ))}
        </select>
      </label>
      {FAMILIES.map((f) => (
        <label key={f} className="cargo">
          {st.families[f].label} (have {have[f]})
          <input type="number" min={0} max={have[f]} value={cargo[f]} onChange={(e) => setCargo({ ...cargo, [f]: Math.max(0, Math.min(have[f], Math.floor(Number(e.target.value) || 0))) })} />
        </label>
      ))}
      <div className="row">
        <button type="button" onClick={() => onGive(to, cargo)}>
          Give, now
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** Where to, who goes, what cargo, fuel and flight time, in words, before you commit. */
function LaunchPanel({ s, me, pad, onLaunch, onClose }: { s: Snapshot; me: Player; pad: Building; onLaunch: (c: { k: "launch"; x: number; y: number; to: number; cargo: Record<Family, number>; to_f?: FactionId; go: boolean }) => void; onClose: () => void }): ReactNode {
  const st = STAGES[s.stage];
  const options = s.summaries.map((w, i) => ({ w, i })).filter(({ w, i }) => i !== s.viewing && !w.spent);
  const [to, setTo] = useState(options[0]?.i ?? 0);
  const [go, setGo] = useState(true);
  const [toF, setToF] = useState<FactionId | undefined>(undefined);
  const [cargo, setCargo] = useState<Record<Family, number>>({ matter: 0, mineral: 0, coolant: 0 });
  const room = asRoom(s);
  const c = { k: "launch" as const, x: pad.x, y: pad.y, to, cargo, to_f: toF, go };
  const plan = launchPlan(room, { ...me }, c);
  const owner = pad.f ? `the ${FACTIONS[pad.f].name}` : "nobody";
  const stock = me.faction ? (s.stock[me.faction] ?? { matter: 0, mineral: 0, coolant: 0 }) : { matter: 0, mineral: 0, coolant: 0 };
  const total = FAMILIES.reduce((a, f) => a + cargo[f], 0);
  return (
    <div className="panel inspect launch" role="dialog" aria-label="Launch">
      <h2>{buildingName(st, "pad")}, built by {owner}</h2>
      {s.spent ? (
        <p className="small">{st.name} is spent: you can leave free, to the nearest living world.</p>
      ) : (
        <>
          <label>
            To{" "}
            <select value={to} onChange={(e) => setTo(Number(e.target.value))}>
              {options.map(({ w, i }) => (
                <option key={i} value={i}>
                  {STAGES[w.stage].name}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={go} onChange={(e) => setGo(e.target.checked)} /> I go too (my pack comes free)
          </label>
          {FAMILIES.map((f) => (
            <label key={f} className="cargo">
              {st.families[f].label} (stockpile {stock[f]})
              <input type="number" min={0} max={SHIP_CARGO} value={cargo[f]} onChange={(e) => setCargo({ ...cargo, [f]: Math.max(0, Math.min(SHIP_CARGO, Math.floor(Number(e.target.value) || 0))) })} />
            </label>
          ))}
          <label>
            Address the cargo to{" "}
            <select value={toF ?? ""} onChange={(e) => setToF((e.target.value || undefined) as FactionId | undefined)}>
              <option value="">my own faction</option>
              {FACTION_IDS.filter((f) => f !== me.faction).map((f) => (
                <option key={f} value={f}>
                  the {FACTIONS[f].name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <p className="small" role="status">
        {plan.ok
          ? `${go ? "You fly" : "The ship flies"} to ${STAGES[s.summaries[plan.to]?.stage ?? 0].name} in ${Math.round((plan.ticks * TICK_MS) / 1000)}s` +
            (plan.free ? ", free of fuel." : `, burning ${FAMILIES.filter((f) => plan.fuel[f]).map((f) => `${plan.fuel[f]} ${st.families[f].label}`).join(" and ")}.`) +
            (total ? ` Cargo ${total} of ${SHIP_CARGO}${FAMILIES.some((f) => plan.fee[f]) ? `, less ${owner}'s tenth (${FAMILIES.reduce((a, f) => a + plan.fee[f], 0)})` : ""}.` : "")
          : `✕ ${plan.reason}`}
      </p>
      <div className="row">
        <button type="button" disabled={!plan.ok} onClick={() => onLaunch(c)}>
          Launch
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function InFlight({ s, me }: { s: Snapshot; me: Player }): ReactNode {
  const ship = s.ships.find((sh) => sh.id === me.ship);
  if (!ship) return null;
  const secs = Math.max(0, Math.ceil(((ship.arrives - s.tick) * TICK_MS) / 1000));
  return (
    <div className="flight" role="status">
      In flight to <strong>{STAGES[s.summaries[ship.to]?.stage ?? 0].name}</strong>: {secs}s. You can still look at any world, and still be a god.
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

function BuildBar({ s, me, view, onWorld, onPick, onTool, god, onFlip }: { s: Snapshot; me: Player | undefined; view: View; onWorld: boolean; onPick: (t: BuildingType) => void; onTool: (t: Tool) => void; god: boolean; onFlip: () => void }): ReactNode {
  const st = STAGES[s.stage];
  const f = me?.faction;
  const types = buildable(s, W(s), f);
  const pool = s.mode === "cosmos" ? (f ? s.stock[f] : undefined) : s.inventory;
  return (
    <div className="panel bottom" role="toolbar" aria-label="Build and tools">
      {!onWorld && s.mode === "cosmos" && <span className="small">Only looking at {st.name}: nothing here can be built from afar.</span>}
      {types.map((type, i) => {
        const def = BUILDINGS[type];
        const cost = costOf(type, s.mode === "cosmos" ? f : undefined);
        const short = FAMILIES.filter((fam) => cost[fam] > (pool?.[fam] ?? 0) + (me?.pack[fam] ?? 0));
        const costText = FAMILIES.filter((fam) => cost[fam]).map((fam) => `${cost[fam]} ${st.families[fam].label}`).join(", ");
        return (
          <button
            key={type}
            type="button"
            className={`build ${view.build === type ? "on" : ""} ${short.length ? "short" : ""}`}
            aria-pressed={view.build === type}
            title={def.blurb}
            disabled={!onWorld}
            aria-label={`${buildingName(st, type)}, costs ${costText || "nothing"}${short.length ? ", can't afford yet" : ""}`}
            onClick={() => onPick(type)}
          >
            <span className="key">{i + 1}</span>
            <span className="bname">{buildingName(st, type)}</span>
            <span className="cost">
              {short.length ? "✕ " : ""}
              {costText || "free"}
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
      {god && (
        <button type="button" className="tool" onClick={onFlip}>
          Powers (Tab)
        </button>
      )}
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

function Inspect({ s, b, youId, host, onDemolish, onReserve, onClose }: { s: Snapshot; b: Building | undefined; youId: string; host: boolean; onDemolish: (b: Building) => void; onReserve?: (x: number, y: number) => void; onClose: () => void }): ReactNode {
  if (!b) return null;
  // a Steward beside a machine can reserve the deposit it's working
  const besides = onReserve && (b.type === "extractor" || b.type === "seeder")
    ? [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [b.x + dx, b.y + dy]).find(([x, y]) => x >= 0 && y >= 0 && x < s.w && y < s.w && s.tiles[y * s.w + x].d && s.tiles[y * s.w + x].amt > 0)
    : undefined;
  const st = STAGES[s.stage];
  const def = BUILDINGS[b.type];
  const owner = (b.owner ? (s.players[b.owner]?.name ?? "someone") : b.f ? "a machine" : "the Cooperative") + (b.f ? ` of the ${FACTIONS[b.f].name}` : "") + (b.gift ? ", a god's gift" : "");
  const done = b.work >= def.build * 10;
  const io: string[] = [];
  if (def.energy) io.push(def.energy > 0 ? `+${def.energy * (b.type === "solar" ? st.solarScale : 1)} power` : `uses ${-def.energy} power`);
  if (def.workers) io.push(def.workers > 0 ? `houses ${def.workers}–5 workers` : `employs ${-def.workers} workers`);
  if (def.compute) io.push(def.compute > 0 ? `+${def.compute} compute` : `uses ${-def.compute} compute`);
  if (def.coolantUse) io.push(`drinks ${def.coolantUse} ${st.families.coolant.label}`);
  if (def.fuelUse) io.push(`burns ${def.fuelUse} ${st.families.matter.label}`);
  if (def.extract) io.push(`harvests ${def.extract} from a neighbour`);
  const myF = s.players[youId]?.faction;
  const canDemolish = !def.protected && (def.renderValue ? host : b.owner === youId || host || (!!b.f && b.f === myF));
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
            {def.renderValue ? `Render down (+${def.renderValue} energy, forever)` : b.gift ? "Take down (it was free: nothing back)" : "Take down (half back)"}
          </button>
        )}
        {besides && onReserve && (
          <button type="button" onClick={() => onReserve(besides[0], besides[1])}>
            Reserve the deposit beside it ({FAMILIES.filter((f) => RESERVE_COST[f]).map((f) => `${RESERVE_COST[f]} ${STAGES[s.stage].families[f].label}`).join(", ")})
          </button>
        )}
        <button type="button" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function Help({ onClose, st, cosmos }: { onClose: () => void; st: (typeof STAGES)[number]; cosmos: boolean }): ReactNode {
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
        <p>With gods on, there's a god half the time: 30 seconds with one, 30 without. A god has five powers and can use them as often as they like: Sow new stock, Bless (quicker hands), Hush (nothing taken), Gift a free datacentre, or Strike. Each world has its own names for them. <kbd>Tab</kbd> flips between Powers and Build, <kbd>1</kbd>–<kbd>5</kbd> pick a power, hold <kbd>Enter</kbd> or click to use it, <kbd>Esc</kbd> puts it down.{cosmos ? <> <kbd>[</kbd> <kbd>]</kbd> aim at another world.</> : null}</p>
        {cosmos ? (
          <p>All five worlds run at once. <kbd>M</kbd> opens the map; click a world to look at it, which is free. To go there, use a Launch Pad. You belong to one of four factions, each with its own stockpile on each world; give stock to another with “Give to another faction”. Each faction is measured by its own goal, and no faction can reach it alone.</p>
        ) : (
          <p>When every deposit on this world is gone, the room moves on together. There are five worlds.</p>
        )}
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
            <tr><th scope="col">Stock</th><th scope="col">Was</th><th scope="col">Extracted</th><th scope="col">Destroyed</th><th scope="col">Sown</th></tr>
          </thead>
          <tbody>
            {FAMILIES.map((f) => (
              <tr key={f}>
                <th scope="row">{st.families[f].label}</th>
                <td>{sum.ledger[f].initial}</td>
                <td>{sum.ledger[f].extracted}</td>
                <td>{sum.ledger[f].destroyed}</td>
                <td>{f === "matter" ? (sum.sown ?? 0) : ""}</td>
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
  const humans = Object.values(s.players).filter((p) => !p.bot);
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
  const hands = `${humans.length} pair${humans.length === 1 ? "" : "s"} of hands`;
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
          {Object.values(s.players).filter((p) => !p.bot || p.stats.harvested || p.stats.built).map((p) => (
            <li key={p.id}>
              {p.faction ? <Badge f={p.faction} /> : null}
              {p.name}
              {p.bot ? " (bot)" : ""}: harvested {p.stats.harvested}, built {p.stats.built}, helped {p.stats.helped} times
            </li>
          ))}
          {Object.values(s.players).filter((p) => p.god.turns > 0).map((p) => (
            <li key={`g-${p.id}`}>
              {p.name}, as a god ({p.god.turns} turn{p.god.turns === 1 ? "" : "s"}): sowed {p.god.sown}, destroyed {p.god.destroyed}, felled {p.god.felled} buildings, gifted {p.god.gifted} datacentres, {p.god.blessed} harvests made under their Bless, {Math.round((p.god.hushed * TICK_MS) / 1000)} seconds of Hush
            </li>
          ))}
        </ul>
        {s.mode === "cosmos" && (
          <>
            <h3>Each faction, by its own measure</h3>
            <ul>
              {FACTION_IDS.map((f) => (
                <li key={f}>
                  <Badge f={f} /> The {FACTIONS[f].name} {factionLine(s, f)} {reachedPar(asRoom(s), f) ? "Reached." : "Not reached."}
                </li>
              ))}
            </ul>
            <h3>Who took what, world by world</h3>
            <ul>
              {s.history.map((h, i) => (
                <li key={i}>
                  {STAGES.find((x) => x.id === h.stage)?.name}:{" "}
                  {FACTION_IDS.filter((f) => h.took?.[f]).map((f) => `the ${FACTIONS[f].name} ${h.took![f]}`).join(", ") || "nothing by hand or machine"}
                  {h.sown ? `; ${h.sown} sown by gods` : ""}.
                </li>
              ))}
            </ul>
          </>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const res = await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pace: s.pace, mode: s.mode, gods: s.god.on, pick: s.pick }) });
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
