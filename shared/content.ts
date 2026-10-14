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
  "pad",
  "smelter",
  "seeder",
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
  pad: {
    size: 1,
    cost: { mineral: 4, matter: 2 },
    build: 2,
    energy: 0,
    workers: 0,
    compute: 0,
    blurb: "The way off a world, open to everyone. Its builder takes a tenth of any cargo that goes through it.",
  },
  smelter: {
    size: 1,
    cost: { mineral: 6, matter: 2 },
    build: 3,
    energy: -1,
    workers: 0,
    compute: 0,
    pollution: { radius: 1, amount: 2 },
    blurb: "Foundry only. Turns 3 matter from the Foundry's stockpile into 1 mineral each tick.",
  },
  seeder: {
    size: 1,
    cost: { mineral: 6, matter: 4 },
    build: 3,
    energy: -1,
    workers: 0,
    compute: -1,
    extract: 1,
    pollution: { radius: 1, amount: 4 },
    heat: 2,
    blurb: "Automata only. A harvester that pays for and places a copy of itself beside it every few ticks.",
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
  /** what a god's five powers are called here; Gift takes the datacentre's name */
  powers: Record<Exclude<GodPower, "gift">, string>;
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
    powers: { sow: "Seed", strike: "Lightning", bless: "Fair wind", hush: "Still air" },
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
    powers: { sow: "Buried spring", strike: "Meteor", bless: "Thin air", hush: "Dust calm" },
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
    powers: { sow: "Kindle", strike: "Flare", bless: "Updraft", hush: "Eclipse" },
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
    powers: { sow: "Comet", strike: "Collision", bless: "Slipstream", hush: "Radio silence" },
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
    powers: { sow: "New star", strike: "Supernova", bless: "Fair current", hush: "Dark" },
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
 * Gods: while a room has them on, there is a god half the time, GOD_TURN_TICKS
 * with one and GOD_GAP_TICKS without. A god can use any of five powers as
 * often as they like during their turn; the clock is the only limit. The
 * numbers below are the rules that keep the world sound however often they act.
 */
export const GOD_POWERS = ["sow", "bless", "hush", "gift", "strike"] as const;
export type GodPower = (typeof GOD_POWERS)[number];
export const GOD_TURN_TICKS = 300; // 30 s
export const GOD_GAP_TICKS = 300; // 30 s
export const STRIKE_FUSE_TICKS = 30;
/** tiles from the strike, centre to centre, that are flattened */
export const STRIKE_RADIUS = 2.3;
export const BLESS_TICKS = 50; // 5 s
export const BLESS_RADIUS = 4;
/** inside a blessing a mortal's harvest cooldown is divided by this, to no less than BLESS_MIN_COOLDOWN */
export const BLESS_SPEEDUP = 2;
export const BLESS_MIN_COOLDOWN = 2;
export const HUSH_TICKS = 100; // 10 s
export const HUSH_RADIUS = 3;
/** a tile that was hushed can't be hushed again until this long after it lapsed */
export const HUSH_REST_TICKS = 100;
/** sown stock on a world is capped at this share of what it was generated with */
export const SOW_CAP = 0.2;
/** the Sun's twist: a Flare adds this much heat and an Eclipse sheds it */
export const SUN_TWIST_HEAT = 15;
/** Earth's twist: a Seed lifts its eight neighbours' life by this */
export const EARTH_SEED_LIFT = 20;

/** Cosmos: journeys between worlds. */
export const PAD_FEE = 0.1;
export const LAUNCH_FUEL: Bundle = { matter: 6, mineral: 0, coolant: 3 };
export const SHIP_PASSENGERS = 4;
export const SHIP_CARGO = 20;
/** seconds of flight: a base plus a step for each world between, in STAGES order */
export const FLIGHT_BASE_TICKS = 100;
export const FLIGHT_STEP_TICKS = 80;
export const flightTicks = (from: number, to: number): number => FLIGHT_BASE_TICKS + FLIGHT_STEP_TICKS * Math.abs(from - to);

export const FACTION_IDS = ["foundry", "automata", "brokers", "stewards"] as const;
export type FactionId = (typeof FACTION_IDS)[number];
export type Shape = "square" | "circle" | "triangle" | "diamond";

export interface FactionDef {
  id: FactionId;
  name: string;
  doctrine: string;
  passive: string;
  unique: BuildingType | "reserve";
  uniqueText: string;
  weakness: string;
  goal: string;
  needs: string;
  colour: string;
  shape: Shape;
  /** territory outline dash pattern, in pixels at zoom 1 */
  dash: number[];
  /** the faction's own measure reaches this; set once from the baseline tournament (docs/TESTING.md) */
  par: number;
  /** cost multiplier per building type for this faction */
  costs: Partial<Record<BuildingType, number>>;
  /** fuel multiplier on launches */
  fuel: number;
  /** hand harvest cooldown multiplier */
  hands: number;
  cannot: BuildingType[];
}

export const FACTIONS: Record<FactionId, FactionDef> = {
  foundry: {
    id: "foundry",
    name: "Foundry",
    doctrine: "Burn it.",
    passive: "Furnaces give double power on the same fuel.",
    unique: "smelter",
    uniqueText: "Smelter: turns 3 matter into 1 mineral each tick.",
    weakness: "Furnace smoke reaches one tile further, and it browns land everyone shares.",
    goal: "its share of everything taken from every world, by hand or machine",
    needs: "Needs Brokers to carry its output off Earth. Threatens the Stewards' land.",
    colour: "#d9653b",
    shape: "square",
    dash: [10, 4],
    par: 0.3,
    costs: {},
    fuel: 1,
    hands: 1,
    cannot: [],
  },
  automata: {
    id: "automata",
    name: "Automata",
    doctrine: "Let the machine do it.",
    passive: "Harvesters cost a quarter less.",
    unique: "seeder",
    uniqueText: "Seeder: a harvester that places copies of itself, up to 12 a world.",
    weakness: "Hand harvesting is half as fast. Needs power and compute from someone.",
    goal: "its share of all compute supplied, in compute-ticks",
    needs: "Needs the Foundry's power. Its machines drink the water everyone shares.",
    colour: "#4f8fd9",
    shape: "circle",
    dash: [2, 4],
    par: 0.5,
    costs: { extractor: 0.75, seeder: 0.75 },
    fuel: 1,
    hands: 2,
    cannot: [],
  },
  brokers: {
    id: "brokers",
    name: "Brokers",
    doctrine: "Everything moves through us.",
    passive: "Launch Pads cost half, and the fuel is half.",
    unique: "pad",
    uniqueText: "Launch Pad: the way off a world, taking a tenth of all cargo.",
    weakness: "Can't build Harvesters. Earns only when other people consume.",
    goal: "units carried through Pads it built",
    needs: "Needs everyone else to have something to ship. Threatens nobody directly.",
    colour: "#c9a227",
    shape: "triangle",
    dash: [12, 4, 2, 4],
    par: 40,
    costs: { pad: 0.5 },
    fuel: 0.5,
    hands: 1,
    cannot: ["extractor", "seeder"],
  },
  stewards: {
    id: "stewards",
    name: "Stewards",
    doctrine: "Keep some back.",
    passive: "Sun Gardens cost 30% less.",
    unique: "reserve",
    uniqueText: "Reserve: locks a deposit and its neighbours from harvest for 60 seconds.",
    weakness: "Hand harvesting is a quarter slower. Can't build Furnaces.",
    goal: "the average life of the land across the five worlds, taken as each ended or as it stands",
    needs: "Needs the others to slow down or stop. Threatens everyone's harvest.",
    colour: "#3f9f6a",
    shape: "diamond",
    dash: [6, 6],
    par: 40,
    costs: { solar: 0.7 },
    fuel: 1,
    hands: 1.25,
    cannot: ["furnace"],
  },
};
/** a building only one faction may raise, and what the others pay for one (the Pad) */
export const UNIQUE: Partial<Record<BuildingType, { only?: FactionId; othersPay?: number }>> = {
  smelter: { only: "foundry" },
  seeder: { only: "automata" },
  pad: { othersPay: 2 },
};
export const SMELTER_IN = 3;
export const SEEDER_EVERY = 6; // economy ticks between copies
export const SEEDER_CAP = 12; // per world
export const RESERVE_TICKS = 600; // 60 s
export const RESERVE_REST_TICKS = 600;
export const RESERVE_RADIUS = 1;
export const RESERVE_COST: Bundle = { matter: 4, mineral: 2, coolant: 0 };
/** the faction furthest from its par pays this much less fuel; 0 turns the lever off */
export const CATCH_UP_FUEL = 0.25;
/** a faction left without a human is played by its bot again after this long */
export const BOT_RETURN_TICKS = 300;
/** how often a bot may act: one command every this many ticks */
export const BOT_EVERY_TICKS = 3;
/** a human who ignores the faction cards is dealt one after this long */
export const DEAL_AFTER_TICKS = 300;

export const EMOTES = ["wave", "heart", "laugh", "wow", "sad", "point"] as const;
export type Emote = (typeof EMOTES)[number];

const DEFAULT_NAMES: Partial<Record<BuildingType, string>> = { pad: "Launch Pad", smelter: "Smelter", seeder: "Seeder" };

export function buildingName(stage: StageDef, type: BuildingType): string {
  return stage.names[type] ?? DEFAULT_NAMES[type] ?? type[0].toUpperCase() + type.slice(1);
}

/** What a god's power is called on this world. */
export function powerName(stage: StageDef, power: GodPower): string {
  return power === "gift" ? buildingName(stage, "datacentre") : stage.powers[power];
}

/** Which spent world a World Engine in the Universe stands for. */
export const ENGINE_OF: Record<string, StageId> = { "Earth Engine": "earth", "Mars Engine": "mars", "Sun Husk Engine": "sun" };
