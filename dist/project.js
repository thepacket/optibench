import { catalog, instantiate } from "./catalog.js";
export const ENGINE_VERSION = "0.2.0";
export const DEFAULT_TABLE = {
  width: 1500,
  height: 900,
  pitch: 25,
  thread: "M6",
  border: 12.5,
  snap: 5,
  heightAbove: 100,
  showMounts: true,
  snapToHoles: false,
};
export function makeProject(template = "expander") {
  const p = {
    version: 2,
    engine: ENGINE_VERSION,
    title: "Beam expansion & power monitoring",
    notes: "",
    table: { ...DEFAULT_TABLE },
    items: [],
    measurements: [],
    wave: { n: 256, width: 6 },
    createdAt: new Date().toISOString(),
  };
  let id = 1;
  const add = (part, x, y, o = {}) => {
    const c = instantiate(part, id++, x, y, o);
    p.items.push(c);
    return c;
  };
  if (template === "expander") {
    add("DESIGN-LASER-532", 175, 300, {
      label: "L1 · 532 nm laser",
      waist: 0.6,
      power: 1,
    });
    add("AC254-050-A-ML", 400, 300, { label: "L2 · Expander input" });
    add("AC254-200-A-ML", 650, 300, { label: "L3 · Expander output" });
    add("DESIGN-BS-10", 900, 300, { label: "BS1 · Power pickoff" });
    add("DESIGN-SCREEN-50", 1250, 300, {
      label: "D1 · Beam profiler",
      terminate: true,
    });
    add("DESIGN-POWER", 900, 650, { label: "D2 · Power monitor", angle: 90 });
  }
  if (template === "focus") {
    p.title = "Gaussian laser focusing";
    add("DESIGN-LASER-633", 200, 450, {
      waist: 0.5,
      power: 0.01,
      label: "L1 · HeNe model",
    });
    add("AC254-200-A-ML", 650, 450, { label: "L2 · Focusing lens" });
    add("DESIGN-CAMERA", 850, 450, {
      label: "D1 · Focal plane",
      exposure: 0.01,
    });
  }
  if (template === "folded") {
    p.title = "Folded optical path";
    add("DESIGN-LASER-532", 200, 250);
    add("DESIGN-MIRROR-25.4", 700, 250, { label: "M1 · Fold 90°" });
    add("DESIGN-MIRROR-25.4", 700, 650, {
      angle: 135,
      label: "M2 · Return fold",
    });
    add("DESIGN-SCREEN-50", 1100, 650, {
      label: "D1 · Observation",
      terminate: true,
    }); // second mirror - normal 135 reflects down to right
    p.items[2].angle = 135;
  }
  if (template === "relay") {
    p.title = "4f coherent image relay";
    add("DESIGN-IMAGE", 250, 450, {
      label: "O1 · Object plane",
      power: 0.00001,
    });
    add("AC254-200-A-ML", 450, 450, { label: "L1 · Fourier lens" });
    add("DESIGN-IRIS-1", 650, 450, { label: "A1 · Spatial filter" });
    add("AC254-200-A-ML", 850, 450, { label: "L2 · Relay lens" });
    add("DESIGN-CAMERA", 1050, 450, {
      label: "D1 · Image plane",
      exposure: 10,
    });
    p.wave = { n: 512, width: 6 };
  }
  if (template === "diffraction") {
    p.title = "Young double-slit diffraction";
    add("DESIGN-IMAGE", 300, 450, {
      label: "S1 · Double slit",
      pattern: "double-slit",
      power: 0.00001,
    });
    add("DESIGN-CAMERA", 1100, 450, {
      label: "D1 · Diffraction plane",
      exposure: 100,
    });
    p.wave = { n: 512, width: 6 };
  }
  if (template === "polarization") {
    p.title = "Malus law · polarization laboratory";
    add("DESIGN-LASER-532", 200, 450, { polarization: 0 });
    add("DESIGN-POL-0", 500, 450, { label: "P1 · Input polarizer" });
    add("DESIGN-POL-45", 800, 450, { label: "P2 · Analyzer" });
    add("DESIGN-POWER", 1150, 450, { label: "D1 · Transmitted power" });
  }
  if (template === "empty") {
    p.title = "Untitled experiment";
  }
  return p;
}
export const templates = [
  [
    "expander",
    "Beam expansion",
    "4× Keplerian telescope with a 10% power pickoff.",
    "Gaussian",
  ],
  [
    "focus",
    "Laser focusing",
    "Focus a Gaussian beam and inspect the detector plane.",
    "Gaussian",
  ],
  [
    "folded",
    "Folded beam path",
    "Two steering mirrors on a laboratory table.",
    "2D ray trace",
  ],
  [
    "relay",
    "4f spatial filtering",
    "Coherent object, Fourier-plane aperture and image relay.",
    "Fourier",
  ],
  [
    "diffraction",
    "Double-slit diffraction",
    "Propagate a sampled two-slit field to a camera.",
    "Fourier",
  ],
  [
    "polarization",
    "Polarization laboratory",
    "Rotate an analyzer and measure Malus-law transmission.",
    "Gaussian",
  ],
  [
    "empty",
    "Empty optical table",
    "Start a new layout on a 1500 × 900 mm breadboard.",
    "Layout",
  ],
];
const allowedTypes = new Set([
  "source",
  "image",
  "lens",
  "mirror",
  "splitter",
  "aperture",
  "slit",
  "filter",
  "polarizer",
  "screen",
  "camera",
  "power",
  "stop",
  "mechanical",
]);
function number(v, min, max, name) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    throw Error(`Invalid ${name}: expected ${min} to ${max}.`);
  return v;
}
function text(v, max = 300) {
  return typeof v === "string" ? v.slice(0, max) : "";
}
export function validateProject(input) {
  if (!input || typeof input !== "object") throw Error("Invalid project file.");
  if (input.version === 1) return migrateV1(input);
  if (input.version !== 2) throw Error("Unsupported project version.");
  if (!Array.isArray(input.items) || input.items.length > 300)
    throw Error("A project can contain up to 300 components.");
  const t = input.table || {};
  const table = {
    width: number(t.width, 300, 6000, "table width"),
    height: number(t.height, 300, 4000, "table depth"),
    pitch: number(t.pitch, 1, 100, "hole pitch"),
    border: number(t.border ?? 12.5, 0, 100, "hole border"),
    thread: text(t.thread, 20) || "M6",
    snap: number(t.snap ?? 5, 0, 100, "snap spacing"),
    heightAbove: number(t.heightAbove ?? 100, 0, 1000, "beam height"),
    showMounts: t.showMounts !== false,
    snapToHoles: !!t.snapToHoles,
  };
  const seen = new Set(),
    items = input.items.map((c) => {
      if (!c || !allowedTypes.has(c.type))
        throw Error("Unknown component type.");
      const id = number(c.id, 1, 1e9, "component ID");
      if (seen.has(id)) throw Error("Duplicate component IDs.");
      seen.add(id);
      let out = {
        id,
        catalogId: text(c.catalogId, 100),
        part: text(c.part, 100),
        name: text(c.name, 100) || c.type,
        label: text(c.label, 100) || text(c.name, 100) || c.type,
        brand: text(c.brand, 60) || "Custom",
        provenance: text(c.provenance, 50) || "ideal",
        type: c.type,
        category: text(c.category, 60),
        notes: text(c.notes, 2000),
        x: number(c.x, 0, table.width, "X position"),
        y: number(c.y, 0, table.height, "Y position"),
        angle: number(c.angle ?? 0, -3600, 3600, "angle"),
        enabled: c.enabled !== false,
        locked: !!c.locked,
        footprint: number(c.footprint ?? 40, 1, 500, "footprint"),
        diameter: number(c.diameter ?? 25.4, 0.001, 500, "diameter"),
        aperture: number(
          c.aperture ?? c.diameter ?? 25.4,
          0.001,
          500,
          "aperture",
        ),
        transmission: number(c.transmission ?? 1, 0, 1, "transmission"),
        reflectivity: number(c.reflectivity ?? 1, 0, 1, "reflectivity"),
      };
      for (const key of [
        "coating",
        "glass",
        "thread",
        "assumptions",
        "model",
        "sourceUrl",
      ])
        if (c[key]) out[key] = text(c[key], 500);
      if (c.range)
        out.range = [
          number(c.range[0], 100, 100000, "coating minimum"),
          number(c.range[1], 100, 100000, "coating maximum"),
        ];
      if (c.bfl != null) out.bfl = number(c.bfl, -10000, 10000, "BFL");
      if (c.apertureMin)
        out.apertureMin = number(c.apertureMin, 0.001, 500, "aperture minimum");
      if (c.apertureMax)
        out.apertureMax = number(c.apertureMax, 0.001, 500, "aperture maximum");
      if (
        ["lens", "aperture", "slit"].includes(c.type) &&
        out.aperture > out.diameter
      )
        throw Error("Clear aperture cannot exceed physical diameter.");
      if (c.type === "lens") {
        out.f = number(c.f, -10000, 10000, "focal length");
        if (Math.abs(out.f) < 1)
          throw Error("Focal length magnitude must be at least 1 mm.");
      }
      if (["source", "image"].includes(c.type)) {
        out.wavelength = number(c.wavelength, 200, 20000, "wavelength");
        out.waist = number(c.waist, 0.001, 100, "waist");
        out.power = number(c.power, 1e-12, 1e6, "power");
        out.m2 = number(c.m2 ?? 1, 1, 100, "M²");
        out.polarization = number(
          c.polarization ?? 0,
          -360,
          360,
          "polarization",
        );
        out.pattern = ["bars", "double-slit", "pinhole", "image"].includes(
          c.pattern,
        )
          ? c.pattern
          : "bars";
      }
      if (
        c.type === "splitter" &&
        out.transmission + out.reflectivity > 1.000001
      )
        throw Error("Beamsplitter R + T cannot exceed 100%.");
      if (c.type === "polarizer")
        out.axis = number(c.axis ?? 0, -360, 360, "polarizer axis");
      if (c.type === "screen") out.terminate = c.terminate !== false;
      if (c.type === "camera")
        for (const [key, min, max, def] of [
          ["pixelPitch", 0.1, 100, 3.45],
          ["pixelsX", 16, 20000, 1440],
          ["pixelsY", 16, 20000, 1080],
          ["exposure", 0.000001, 1e6, 1],
          ["qe", 0, 1, 0.6],
          ["readNoise", 0, 1000, 2],
          ["darkCurrent", 0, 1e6, 0.1],
          ["fullWell", 1, 1e8, 18000],
          ["bits", 1, 24, 12],
          ["gain", 0.01, 1000, 1],
        ]) {
          out[key] = number(c[key] ?? def, min, max, key);
          if (
            ["pixelsX", "pixelsY", "bits"].includes(key) &&
            !Number.isInteger(out[key])
          )
            throw Error(`${key} must be an integer.`);
        }
      return out;
    });
  const measurements = Array.isArray(input.measurements)
    ? input.measurements
        .slice(0, 100)
        .map((m) => ({
          a: {
            x: number(m.a.x, 0, table.width, "ruler X"),
            y: number(m.a.y, 0, table.height, "ruler Y"),
          },
          b: {
            x: number(m.b.x, 0, table.width, "ruler X"),
            y: number(m.b.y, 0, table.height, "ruler Y"),
          },
        }))
    : [];
  let image = null;
  if (input.image) {
    const n = number(input.image.n, 128, 512, "image resolution");
    if (
      ![128, 256, 512].includes(n) ||
      !Array.isArray(input.image.values) ||
      input.image.values.length !== n * n
    )
      throw Error("Invalid image data.");
    image = {
      n,
      name: text(input.image.name, 100),
      values: input.image.values.map((v) => number(v, 0, 1, "image pixel")),
    };
  }
  const wave = {
    n: [128, 256, 512, 1024].includes(input.wave?.n) ? input.wave.n : 256,
    width: number(input.wave?.width ?? 6, 0.1, 100, "field width"),
  };
  return {
    version: 2,
    engine: ENGINE_VERSION,
    title: text(input.title, 100) || "Untitled experiment",
    notes: text(input.notes, 10000),
    table,
    items,
    measurements,
    wave,
    image,
    createdAt: text(input.createdAt, 50) || new Date().toISOString(),
  };
}
function migrateV1(p) {
  const base = makeProject("empty");
  base.title = text(p.title) || "Imported experiment";
  if (!Array.isArray(p.items) || p.items.length > 100)
    throw Error("Invalid legacy project.");
  base.items = p.items.map((c, i) => {
    const types = {
      source: "DESIGN-LASER-532",
      image: "DESIGN-IMAGE",
      lens: "DESIGN-LENS-25.4-50",
      screen: "DESIGN-SCREEN-50",
      camera: "DESIGN-CAMERA",
      aperture: "DESIGN-IRIS-5",
      mirror: "DESIGN-MIRROR-25.4",
      filter: "DESIGN-ND-0.3",
    };
    if (!types[c.type]) throw Error("Unknown legacy component.");
    return instantiate(types[c.type], i + 1, Number(c.x) + 200, 450, {
      label: text(c.name, 100) || c.type,
      ...(c.f ? { f: c.f } : {}),
      ...(c.type === "source"
        ? {
            waist: c.waist || 1.2,
            power: c.power || 5,
            wavelength: p.wavelength || 532,
          }
        : {}),
      ...(c.type === "filter"
        ? { transmission: (c.transmission ?? 50) / 100 }
        : {}),
    });
  });
  return validateProject(base);
}
export function resampleImage(image, n) {
  if (!image) return null;
  const out = new Float64Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      out[y * n + x] =
        image.values[
          Math.min(image.n - 1, Math.floor((y * image.n) / n)) * image.n +
            Math.min(image.n - 1, Math.floor((x * image.n) / n))
        ];
  return out;
}
