// All balance and stage content lives here as data. Units are whole numbers
// throughout (no floats in the economy), so inventories can't drift, go
// negative or overflow: every natural stock is finite and every inventory is
// bounded by the stock it came from, except the Bottled Sun reserve, which is
// bounded by the Sun's own stock (see SUN_TO_RESERVE).

export const FAMILIES = ["matter", "mineral", "coolant"] as const;
export type Family = (typeof FAMILIES)[number];
export type Bundle = Record<Family, number>;

export const BUILDING_TYPES = [
  "extractor",
  "furnace",
  "solar",
  "city",
  "datacentre",
  "habitat",
  "radiator",
  "relay",
  "plaza",
  "depot",
  "engine",
] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export interface BuildingDef {
  size: 1 | 2;
  cost: Partial<Bundle>;
  /** construction time in economy ticks */
  build: number;
  energy: number; // + produces, - consumes (per economy tick)
  workers: number; // + houses, - employs
  compute: number; // + produces, - consumes
  coolantUse?: number; // coolant drawn from inventory per economy tick
  fuelUse?: number; // matter drawn per economy tick
  /** extraction per economy tick from adjacent deposits */
  extract?: number;
  /** tiles of life lost per economy tick, Chebyshev radius */
  pollution?: { radius: number; amount: number; burnsMatter?: number };
  heat?: number;
  cooling?: number;
  pressureRadius?: number;
  relayRange?: number;
  /** protected shared utility: nobody can demolish it */
  protected?: boolean;
  /** energy released into the reserve when this is rendered down */
  renderValue?: number;
  tall?: boolean;
  blurb: string;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  extractor: {
    size: 1,
    cost: { mineral: 6, matter: 4 },
    build: 3,
    energy: -1,
    workers: 0,
    compute: -1,
    extract: 1,
    pollution: { radius: 1, amount: 4 },
    heat: 2,
    blurb: "Harvests every neighbouring deposit by itself. Needs power and compute.",
  },
  furnace: {
    size: 1,
    cost: { mineral: 8 },
    build: 3,
    energy: 5,
    workers: -1,
    compute: 0,
    fuelUse: 1,
    pollution: { radius: 2, amount: 3, burnsMatter: 1 },
    tall: true,
    blurb: "Burns matter for lots of power. Its smoke browns the land and kills nearby groves.",
  },
  solar: {
    size: 2,
    cost: { mineral: 10, coolant: 2 },
    build: 4,
    energy: 2,
    workers: 0,
    compute: 0,
    blurb: "Clean, slow power that takes a lot of ground.",
  },
  city: {
    size: 2,
    cost: { matter: 12, mineral: 6 },
    build: 5,
    energy: -1,
    workers: 2,
    compute: -1,
    tall: true,
    blurb: "Homes for workers. Served with compute, a city houses far more of them.",
  },
  datacentre: {
    size: 2,
    cost: { mineral: 10, matter: 6 },
    build: 6,
    energy: -2,
    workers: -2,
    compute: 4,
    coolantUse: 1,
    heat: 3,
    tall: true,
    blurb: "Turns power, workers and coolant into compute: automation, services, growth.",
  },
  habitat: {
    size: 2,
    cost: { mineral: 12, coolant: 4 },
    build: 5,
    energy: -1,
    workers: 0,
    compute: 0,
    coolantUse: 1,
    pressureRadius: 4,
    tall: true,
    blurb: "A sealed dome. Machines only run inside the air it holds.",
  },
  radiator: {
    size: 1,
    cost: { mineral: 8 },
    build: 3,
    energy: -1,
    workers: 0,
    compute: 0,
    cooling: 5,
    blurb: "Sheds heat so collectors don't throttle.",
  },
  relay: {
    size: 1,
    cost: { mineral: 4, matter: 2 },
    build: 2,
    energy: -1,
    workers: 0,
    compute: 0,
    relayRange: 5,
    blurb: "Links machines to the Depot. Extractors off the network ship nothing.",
  },
  plaza: {
    size: 1,
    cost: { matter: 2 },
    build: 1,
    energy: 0,
    workers: 0,
    compute: 0,
    blurb: "A bench and some bunting. A city beside a plaza houses one more worker.",
  },
  depot: {
    size: 2,
    cost: {},
    build: 0,
    energy: 0,
    workers: 0,
    compute: 0,
    relayRange: 6,
    protected: true,
    tall: true,
    blurb: "The Cooperative's shared depot. Everything the relays carry ends up here.",
  },
  engine: {
    size: 2,
    cost: {},
    build: 0,
    energy: 0,
    workers: 0,
    compute: 4,
    renderValue: 160,
    tall: true,
    blurb: "A whole spent world, running as compute. Render it down for a burst of energy.",
  },
};

export type StageId = "earth" | "mars" | "sun" | "system" | "universe";
export type Mechanic = "pollution" | "pressure" | "heat" | "relay" | "legacy";
export type Avatar = "person" | "suit" | "drone" | "probe" | "wisp";

export interface FamilySpec {
  label: string;
  /** number of deposit tiles generated */
  tiles: number;
  perTile: number;
}

export interface StageDef {
  id: StageId;
  name: string;
  tagline: string;
  size: number;
  mechanic: Mechanic;
  avatar: Avatar;
  energySource: "local" | "bottled";
  families: Record<Family, FamilySpec>;
  buildings: BuildingType[];
  names: Partial<Record<BuildingType, string>>;
  starter: Bundle;
  landmarks: string[];
  /** solar output multiplier for this stage */
  solarScale: number;
  palette: {
    sky: [string, string];
    lush: [number, number, number];
    dead: [number, number, number];
    matter: string;
    mineral: string;
    coolant: string;
  };
  arrival: string;
  departure: string;
}

export const STAGES: StageDef[] = [
  {
    id: "earth",
    name: "Earth",
    tagline: "A meadow island with a pond, a few groves and an old oak.",
    size: 24,
    mechanic: "pollution",
    avatar: "person",
    energySource: "local",
    families: {
      matter: { label: "timber", tiles: 34, perTile: 18 },
      mineral: { label: "stone", tiles: 16, perTile: 20 },
      coolant: { label: "fresh water", tiles: 14, perTile: 14 },
    },
    buildings: ["city", "plaza", "furnace", "solar", "datacentre", "extractor"],
    names: {
      city: "Cottages",
      furnace: "Furnace",
      solar: "Sun Garden",
      datacentre: "Datacentre",
      extractor: "Harvester",
      plaza: "Plaza",
    },
    starter: { matter: 0, mineral: 0, coolant: 0 },
    landmarks: ["The Old Oak", "Heron Pond", "Picnic Hill", "Granite Seat"],
    solarScale: 1,
    palette: {
      sky: ["#bfe7ff", "#fdf3d8"],
      lush: [126, 196, 104],
      dead: [150, 128, 104],
      matter: "#3f8f4f",
      mineral: "#a6a39b",
      coolant: "#5bb6e8",
    },
    arrival: "The Plenty Cooperative welcomes you to Earth. Everything here is yours to use.",
    departure: "Earth is spent. The Cooperative thanks you for your growth.",
  },
  {
    id: "mars",
    name: "Mars",
    tagline: "Rust dunes over buried ice. Nothing runs outside a dome.",
    size: 26,
    mechanic: "pressure",
    avatar: "suit",
    energySource: "local",
    families: {
      matter: { label: "regolith", tiles: 30, perTile: 18 },
      mineral: { label: "iron", tiles: 18, perTile: 20 },
      coolant: { label: "buried ice", tiles: 18, perTile: 16 },
    },
    buildings: ["habitat", "solar", "city", "datacentre", "extractor", "plaza"],
    names: {
      habitat: "Dome",
      solar: "Solar Field",
      city: "Hab Block",
      datacentre: "Cold Datacentre",
      extractor: "Rover Drill",
      plaza: "Garden Pod",
    },
    starter: { matter: 20, mineral: 40, coolant: 12 },
    landmarks: ["First Footprint", "Ice Cathedral", "Olympus Lookout"],
    solarScale: 2,
    palette: {
      sky: ["#f2b08a", "#5a2a2a"],
      lush: [214, 120, 74],
      dead: [110, 84, 76],
      matter: "#c4683e",
      mineral: "#7d5a50",
      coolant: "#dff6ff",
    },
    arrival: "Mars. The ice under the dust is everything: air, water, coolant.",
    departure: "The ice is gone. Mars can no longer hold anyone, including you.",
  },
  {
    id: "sun",
    name: "The Sun",
    tagline: "Collector platforms in the corona. The star itself is the deposit.",
    size: 28,
    mechanic: "heat",
    avatar: "drone",
    energySource: "local",
    families: {
      matter: { label: "plasma", tiles: 44, perTile: 16 },
      mineral: { label: "magnetics", tiles: 16, perTile: 18 },
      coolant: { label: "shade", tiles: 14, perTile: 14 },
    },
    buildings: ["solar", "radiator", "datacentre", "city", "extractor", "plaza"],
    names: {
      solar: "Collector Wing",
      radiator: "Radiator",
      datacentre: "Furnace Mind",
      city: "Crew Ring",
      extractor: "Plasma Scoop",
      plaza: "Viewing Deck",
    },
    starter: { matter: 20, mineral: 50, coolant: 10 },
    landmarks: ["Morning", "The Last Noon"],
    solarScale: 4,
    palette: {
      sky: ["#ffcf6b", "#7a2410"],
      lush: [255, 196, 92],
      dead: [92, 60, 52],
      matter: "#ffe27a",
      mineral: "#7b6cff",
      coolant: "#2b3a66",
    },
    arrival: "The Sun. It has powered everything you have ever done. It is now a deposit.",
    departure: "The Sun goes out. What's left of it is bottled, and the bottle is all there is.",
  },
  {
    id: "system",
    name: "The Solar System",
    tagline: "Asteroids, comets and two spent worlds, under a dead star.",
    size: 30,
    mechanic: "relay",
    avatar: "probe",
    energySource: "bottled",
    families: {
      matter: { label: "volatiles", tiles: 34, perTile: 16 },
      mineral: { label: "asteroid metal", tiles: 22, perTile: 18 },
      coolant: { label: "comet ice", tiles: 16, perTile: 14 },
    },
    buildings: ["relay", "datacentre", "city", "extractor", "plaza"],
    names: {
      relay: "Relay",
      datacentre: "Orbital Datacentre",
      city: "Station",
      extractor: "Asteroid Miner",
      plaza: "Observation Ring",
      depot: "Cooperative Depot",
    },
    starter: { matter: 20, mineral: 40, coolant: 10 },
    landmarks: ["Ceres Pier", "The Long Comet"],
    solarScale: 0,
    palette: {
      sky: ["#141a33", "#05060c"],
      lush: [138, 132, 160],
      dead: [64, 62, 74],
      matter: "#9fe3d0",
      mineral: "#c9a76a",
      coolant: "#cfe8ff",
    },
    arrival: "No sunlight now. Every machine draws on the Bottled Sun, and it does not refill.",
    departure: "The Solar System is spent. The Cooperative looks further out.",
  },
  {
    id: "universe",
    name: "The Universe",
    tagline: "Galaxies as deposits. Your old worlds hum along as compute.",
    size: 32,
    mechanic: "legacy",
    avatar: "wisp",
    energySource: "bottled",
    families: {
      matter: { label: "starlight", tiles: 40, perTile: 16 },
      mineral: { label: "stellar cores", tiles: 20, perTile: 18 },
      coolant: { label: "dark cold", tiles: 16, perTile: 14 },
    },
    buildings: ["datacentre", "city", "extractor", "plaza"],
    names: {
      datacentre: "Matrioshka Shell",
      city: "Mind City",
      extractor: "Galaxy Siphon",
      plaza: "Memorial",
      engine: "World Engine",
    },
    starter: { matter: 30, mineral: 50, coolant: 10 },
    landmarks: ["Andromeda", "The Quiet Arm"],
    solarScale: 0,
    palette: {
      sky: ["#0b0820", "#000000"],
      lush: [120, 110, 200],
      dead: [30, 30, 38],
      matter: "#fff1b8",
      mineral: "#ff9dd2",
      coolant: "#6fd0ff",
    },
    arrival: "The Universe. Every star is a deposit. The worlds you finished are machinery now.",
    departure: "Nothing left.",
  },
];

/** energy units banked per unit of plasma extracted from the Sun */
export const SUN_TO_RESERVE = 4;

export const TICK_MS = 100;
export const MAX_PLAYERS = 8;
/** identities a room remembers; past this the longest-gone is forgotten */
export const MAX_IDENTITIES = 32;
export const PACES = {
  // normal: one economy tick a second; harvest yields 1
  normal: { econEvery: 10, harvestYield: 1, transitionTicks: 90 },
  // the accelerated development preset: same rules, the economy five times
  // faster and a hand harvest worth ten
  rapid: { econEvery: 2, harvestYield: 10, transitionTicks: 50 },
} as const;
export type Pace = keyof typeof PACES;

export const PLAYER_SPEED = 4; // tiles per second
export const HARVEST_RANGE = 2.2; // tiles
export const BUILD_RANGE = 8; // tiles
export const HARVEST_COOLDOWN_TICKS = 8;
/** how close to a finished home you must stand to use its workbench */
export const BENCH_RANGE = 3.5;

/**
 * Hand tools, one per family: each makes its owner's hand harvest of that
 * family quicker (a shorter cooldown, never a bigger bite, so the ledger and
 * the pacing of a tool-less player are untouched). A tool is paid for out of
 * the crafter's own pack. The rough tier is made anywhere from the two
 * families it doesn't harvest; the fine tier takes all three and a workbench,
 * which is any finished home. Tools are kept from world to world.
 */
export const TOOL_NAMES: Record<Family, string> = { matter: "Cutter", mineral: "Pick", coolant: "Scoop" };
export interface ToolTier {
  label: string;
  /** ticks between hand harvests of the tool's family */
  cooldown: number;
  /** units of the tool's own family, and of each of the other two */
  own: number;
  others: number;
  bench: boolean;
}
export const TOOL_TIERS: ToolTier[] = [
  { label: "Bare hands", cooldown: HARVEST_COOLDOWN_TICKS, own: 0, others: 0, bench: false },
  { label: "Rough", cooldown: 5, own: 0, others: 6, bench: false },
  { label: "Fine", cooldown: 3, own: 12, others: 12, bench: true },
];
export type ToolLevels = Record<Family, number>;

export const toolCost = (family: Family, tier: number): Bundle => {
  const t = TOOL_TIERS[tier];
  return Object.fromEntries(FAMILIES.map((f) => [f, f === family ? t.own : t.others])) as Bundle;
};
export const harvestCooldown = (tools: ToolLevels, family: Family): number => TOOL_TIERS[tools[family]]?.cooldown ?? HARVEST_COOLDOWN_TICKS;
export const toolName = (family: Family, tier: number): string => `${TOOL_TIERS[tier].label} ${TOOL_NAMES[family]}`;
export const MARKS_PER_PLAYER = 3;
export const SALVAGE_RATE = 0.5;
/** heat at which collectors throttle to half output (the Sun) */
export const HEAT_LIMIT = 70;

/**
 * Gods: when a room has them on, one connected player at a time is a god for
 * GOD_TERM_TICKS, then another is chosen. A god can raise a finished
 * datacentre for nothing, drop a bomb, plant a new deposit, or lay an aura
 * that speeds up everyone else's hands. The host can turn gods off and on.
 */
export const GOD_POWERS = ["datacentre", "bomb", "plant", "aura"] as const;
export type GodPower = (typeof GOD_POWERS)[number];
export const GOD_TERM_TICKS = 300; // 30 s
/** ticks between one god's acts */
export const GOD_COOLDOWN_TICKS = 10;
export const BOMB_FUSE_TICKS = 30;
/** tiles from the bomb, centre to centre, that are flattened */
export const BOMB_RADIUS = 2.3;
export const MAX_BOMBS = 3;
export const AURA_TICKS = 50; // 5 s
export const AURA_RADIUS = 4;
export const MAX_AURAS = 2;
/** inside an aura a mortal's harvest cooldown is divided by this, to no less than AURA_MIN_COOLDOWN */
export const AURA_SPEEDUP = 2;
export const AURA_MIN_COOLDOWN = 2;

export const EMOTES = ["wave", "heart", "laugh", "wow", "sad", "point"] as const;
export type Emote = (typeof EMOTES)[number];

export function buildingName(stage: StageDef, type: BuildingType): string {
  return stage.names[type] ?? type[0].toUpperCase() + type.slice(1);
}
