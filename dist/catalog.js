export const sources = {
  thorlabsVIS: {
    name: "Thorlabs mounted visible achromats",
    url: "https://punchout.thorlabs.com/newgrouppage9.cfm?objectgroup_id=2696&pn=AC254-300-A-ML",
    checked: "2026-09-15",
    status: "Indexed manufacturer catalog; availability not verified",
  },
  thorlabsIR: {
    name: "Thorlabs mounted infrared achromats",
    url: "https://www.thorlabs.de/newgrouppage9.cfm?objectgroup_id=4066&pn=AC508-075-C-ML",
    checked: "2026-09-15",
    status: "Indexed manufacturer catalog; availability not verified",
  },
  thorlabsPCX: {
    name: "Thorlabs optics catalog",
    url: "https://www.thorlabs.com/catalogpages/700.pdf",
    checked: "2026-09-15",
    status: "Legacy catalog reference; nominal d-line specifications",
  },
  newport: {
    name: "Newport spherical lens kit catalog",
    url: "https://www.newport.com/f/basic-spherical-lens-kits",
    checked: "2026-09-15",
    status: "Legacy kit reference; individual part availability not verified",
  },
  mechanics: {
    name: "Thorlabs optomechanics",
    url: "https://www.thorlabs.com/newgrouppage9.cfm?objectgroup_id=1433&pn=LMRA10",
    checked: "2026-09-15",
    status: "Indexed catalog; footprint dimensions are adjustable estimates",
  },
  camera: {
    name: "Thorlabs DCC camera specifications",
    url: "https://www.thorlabs.com/catalogpages/obsolete/2020/DCC1545M.pdf",
    checked: "2026-09-15",
    status:
      "Archived camera specifications; detector noise defaults are assumptions",
  },
  edmund: {
    name: "Edmund Optics achromatic lens kits",
    url: "https://www.edmundoptics.com/f/achromatic-lens-kits/11702/",
    checked: "2026-09-15",
    status: "Manufacturer catalog; availability not verified",
  },
  ideal: {
    name: "OptiBench parametric design library",
    url: "",
    checked: "2026-09-15",
    status: "Ideal design component; not a purchasable product",
  },
};
export const catalog = [];
function entry(c) {
  catalog.push({
    id: c.part,
    brand: "OptiBench",
    provenance: "ideal",
    name: "Design component",
    diameter: 25.4,
    footprint: 40,
    aperture: 25.4,
    transmission: 1,
    reflectivity: 1,
    ...c,
  });
}
function lens(part, f, diameter, brand, provenance, extra = {}) {
  entry({
    part,
    f,
    diameter,
    aperture: diameter * 0.9,
    footprint: Math.max(35, diameter + 12),
    name: "Mounted achromatic doublet",
    type: "lens",
    category: "Lenses",
    brand,
    provenance,
    model: "Ideal thin lens; catalog nominal focal length",
    ...extra,
  });
}
for (const [f, bfl, glass] of [
  [30, 22.9, "N-BAF10 / N-SF6HT"],
  [35, 27.3, "N-BAF10 / N-SF6HT"],
  [40, 33.4, "N-BK7 / SF5"],
  [45, 40.2, "N-BAF10 / N-SF6HT"],
  [50, 43.4, "N-BAF10 / N-SF10"],
  [75, null, null],
  [125, null, null],
  [150, null, null],
  [200, null, null],
  [250, null, null],
  [300, 297, "N-BK7 / SF2"],
  [400, 396, "N-BK7 / SF2"],
  [500, 499.9, "N-BK7 / SF2"],
])
  lens(
    `AC254-${String(f).padStart(3, "0")}-A-ML`,
    f,
    25.4,
    "Thorlabs",
    "thorlabsVIS",
    { range: [400, 700], coating: "A · 400–700 nm", thread: "SM1", bfl, glass },
  );
for (const [f, bfl] of [
  [19, 15.7],
  [25, null],
  [30, 27.5],
  [50, 47.2],
  [75, 72.9],
])
  lens(
    `AC127-${String(f).padStart(3, "0")}-A-ML`,
    f,
    12.7,
    "Thorlabs",
    "thorlabsVIS",
    { range: [400, 700], coating: "A · 400–700 nm", thread: "SM05", bfl },
  );
for (const f of [75, 80, 100, 150, 180, 200, 250, 300, 400, 500, 750, 1000])
  lens(
    `${f >= 200 ? "ACT" : "AC"}508-${String(f).padStart(3, "0")}-A-ML`,
    f,
    50.8,
    "Thorlabs",
    "thorlabsVIS",
    { range: [400, 700], coating: "A · 400–700 nm", thread: "SM2" },
  );
for (const [f, bfl] of [
  [19, 15.4],
  [25, 20.3],
  [30, 24.5],
  [50, 43.5],
  [75, 69.8],
])
  lens(
    `AC127-${String(f).padStart(3, "0")}-C-ML`,
    f,
    12.7,
    "Thorlabs",
    "thorlabsIR",
    { range: [1050, 1700], coating: "C · 1050–1700 nm", thread: "SM05", bfl },
  );
for (const [part, f, d] of [
  ["LA1131", 50, 25.4],
  ["LA1608", 75, 25.4],
  ["LA1509", 100, 25.4],
  ["LA1708", 200, 25.4],
  ["LA1399", 175, 50.8],
  ["LA1256", 300, 50.8],
])
  lens(part, f, d, "Thorlabs", "thorlabsPCX", {
    name: "Plano-convex lens",
    glass: "N-BK7",
    coating: "Uncoated",
  });
for (const [part, f] of [
  ["KPX076", 25.4],
  ["KPX082", 50.2],
  ["KPX088", 75.6],
  ["KPX094", 100],
  ["KPX013", 175],
  ["KPX019", 250],
  ["KPX118", 500],
  ["KBX049", 38.1],
  ["KBX052", 50.2],
  ["KBX058", 75.6],
  ["KBX064", 100],
  ["KBX070", 150],
  ["KBX073", 175],
  ["KBX076", 200],
])
  lens(part, f, 25.4, "Newport", "newport", {
    name: part.startsWith("KPX") ? "Plano-convex lens" : "Bi-convex lens",
    glass: "N-BK7",
    coating: "Uncoated",
  });
entry({
  part: "10D20ER.2-PF",
  name: "Broadband silver mirror",
  type: "mirror",
  category: "Mirrors & splitters",
  brand: "Newport",
  provenance: "newportMirror",
  diameter: 25.4,
  reflectivity: 0.98,
  coating: "Silver",
  glass: "Borofloat 33",
  thickness: 6,
});
sources.newportMirror = {
  name: "Newport mirror product page",
  url: "https://www.newport.com/p/10D20ER.2-PF",
  checked: "2026-09-15",
  status:
    "Diameter and substrate sourced; reflectivity is an editable assumption",
};
entry({
  part: "SM1D12C",
  name: "Ring-actuated iris",
  type: "aperture",
  category: "Apertures",
  brand: "Thorlabs",
  provenance: "mechanics",
  aperture: 5,
  diameter: 30,
  apertureMin: 1,
  apertureMax: 12,
  thread: "SM1",
});
for (const [part, name, d] of [
  ["LMR1S/M", "SM1 lens mount", 25.4],
  ["TR100/M", "100 mm optical post", 12.7],
  ["TR50/M", "50 mm optical post", 12.7],
  ["SM1L10", "1 inch SM1 lens tube", 25.4],
])
  entry({
    part,
    name,
    type: "mechanical",
    category: "Optomechanics",
    brand: "Thorlabs",
    provenance: "mechanics",
    diameter: d,
    footprint: 35,
    thread: part.includes("TR") ? "M4 / M6" : "SM1",
  });
for (const [part, pitch, width, height] of [
  ["DCC1545M", 5.2, 1280, 1024],
  ["DCC1240M", 5.3, 1280, 1024],
  ["DCC3240M", 5.3, 1280, 1024],
])
  entry({
    part,
    name: "Monochrome CMOS camera",
    type: "camera",
    category: "Detectors",
    brand: "Thorlabs",
    provenance: "camera",
    pixelPitch: pitch,
    pixelsX: width,
    pixelsY: height,
    exposure: 1,
    qe: 0.5,
    readNoise: 3,
    darkCurrent: 0.1,
    fullWell: 20000,
    bits: 12,
    gain: 1,
    footprint: 65,
    diameter: 12,
    assumptions:
      "QE, read noise, dark current, full well, ADC and gain are user model defaults, not manufacturer specifications.",
  });
for (const wavelength of [
  375, 405, 450, 488, 515, 532, 561, 594, 633, 660, 730, 780, 850, 980, 1064,
  1310, 1550,
])
  entry({
    part: `DESIGN-LASER-${wavelength}`,
    name: `${wavelength} nm Gaussian laser`,
    type: "source",
    category: "Sources",
    wavelength,
    waist: 0.6,
    power: 1,
    m2: 1,
    polarization: 0,
    footprint: 70,
    diameter: 20,
  });
entry({
  part: "DESIGN-IMAGE",
  name: "Coherent image source",
  type: "image",
  category: "Sources",
  wavelength: 532,
  waist: 1,
  power: 0.01,
  m2: 1,
  polarization: 0,
  footprint: 50,
  pattern: "bars",
});
for (const diameter of [12.7, 25.4, 50.8])
  for (const f of [
    -200, -100, -75, -50, -25, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 175,
    200, 250, 300, 400, 500, 750, 1000,
  ])
    lens(`DESIGN-LENS-${diameter}-${f}`, f, diameter, "OptiBench", "ideal", {
      name: f < 0 ? "Negative thin lens" : "Positive thin lens",
      aperture: diameter,
      model: "Parametric ideal thin lens",
    });
for (const d of [12.7, 25.4, 50.8])
  entry({
    part: `DESIGN-MIRROR-${d}`,
    name: "Plane mirror",
    type: "mirror",
    category: "Mirrors & splitters",
    diameter: d,
    footprint: d + 20,
    reflectivity: 0.99,
  });
for (const reflectivity of [0.1, 0.3, 0.5, 0.7, 0.9])
  entry({
    part: `DESIGN-BS-${reflectivity * 100}`,
    name: `${reflectivity * 100}:${100 - reflectivity * 100} beamsplitter`,
    type: "splitter",
    category: "Mirrors & splitters",
    reflectivity,
    transmission: 1 - reflectivity,
    footprint: 50,
    diameter: 35,
  });
for (const aperture of [0.025, 0.05, 0.075, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25])
  entry({
    part: `DESIGN-IRIS-${aperture}`,
    name: aperture < 1 ? "Precision pinhole" : "Circular aperture",
    type: "aperture",
    category: "Apertures",
    aperture,
    diameter: 30,
    apertureMin: 0.001,
    apertureMax: 25,
  });
for (const aperture of [0.025, 0.05, 0.1, 0.2, 0.5, 1])
  entry({
    part: `DESIGN-SLIT-${aperture}`,
    name: "Single slit",
    type: "slit",
    category: "Apertures",
    aperture,
    diameter: 30,
  });
for (const od of [0.1, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 4])
  entry({
    part: `DESIGN-ND-${od}`,
    name: `Neutral density · OD ${od}`,
    type: "filter",
    category: "Filters & polarization",
    transmission: 10 ** -od,
    diameter: 25.4,
  });
for (const axis of [0, 45, 90])
  entry({
    part: `DESIGN-POL-${axis}`,
    name: "Linear polarizer",
    type: "polarizer",
    category: "Filters & polarization",
    axis,
    diameter: 25.4,
  });
for (const [name, retardance] of [["Half-wave plate",180],["Quarter-wave plate",90]])
  entry({part:`DESIGN-WP-${retardance}`,name,type:"waveplate",category:"Filters & polarization",axis:0,retardance,transmission:1,diameter:25.4});
for (const diameter of [25, 50, 100])
  entry({
    part: `DESIGN-SCREEN-${diameter}`,
    name: "Movable observation screen",
    type: "screen",
    category: "Detectors",
    diameter,
    terminate: false,
    footprint: diameter + 10,
  });
entry({
  part: "DESIGN-POWER",
  name: "Optical power meter",
  type: "power",
  category: "Detectors",
  diameter: 30,
  footprint: 45,
});
entry({
  part: "DESIGN-CAMERA",
  name: "Configurable CMOS detector",
  type: "camera",
  category: "Detectors",
  diameter: 12,
  footprint: 65,
  pixelPitch: 3.45,
  pixelsX: 1440,
  pixelsY: 1080,
  exposure: 1,
  qe: 0.6,
  readNoise: 2,
  darkCurrent: 0.1,
  fullWell: 18000,
  bits: 12,
  gain: 1,
});
entry({
  part: "DESIGN-STOP",
  name: "Beam dump",
  type: "stop",
  category: "Optomechanics",
  diameter: 50,
  footprint: 60,
});
for (const footprint of [25, 40, 50, 75, 100])
  entry({
    part: `DESIGN-BASE-${footprint}`,
    name: `Mounting base · ${footprint} mm`,
    type: "mechanical",
    category: "Optomechanics",
    diameter: footprint,
    footprint,
  });
export const categories = [
  "All components",
  "Sources",
  "Lenses",
  "Mirrors & splitters",
  "Apertures",
  "Filters & polarization",
  "Detectors",
  "Optomechanics",
];
export function instantiate(part, id, x, y, override = {}) {
  const base =
    typeof part === "string" ? catalog.find((c) => c.id === part) : part;
  if (!base) throw Error("Unknown catalog component");
  return {
    ...structuredClone(base),
    catalogId: base.id,
    id,
    label: base.name,
    x,
    y,
    angle: ["mirror", "splitter"].includes(base.type) ? 135 : 0,
    enabled: true,
    locked: false,
    notes: "",
    ...override,
  };
}
// Exact part-to-specification mappings from Edmund's kit specification tables.
const eo125 = [
  [14, 9.92, "45-209", "47-660", "49-321"],
  [20, 16.45, "32-309", "47-661", "49-322"],
  [25, 21.47, "32-311", "47-662", "49-323"],
  [30, 26.12, "32-313", "47-663", "49-324"],
  [35, 32.5, "45-210", "47-664", "49-325"],
  [40, 37.54, "32-315", "47-665", "49-326"],
  [45, 42.52, "45-136", "47-666", "49-327"],
  [50, 47.61, "32-317", "47-667", "49-328"],
  [60, 57.59, "45-137", "47-668", "49-329"],
  [75, 72.35, "32-882", "47-669", "49-330"],
  [80, 78.4, "45-409", "47-670", "49-331"],
  [90, 88.47, "45-410", "47-671", "49-332"],
  [100, 97.92, "45-265", "47-672", "49-333"],
];
const eo25 = [
  [30, 22.23, "45-211", "47-633", "49-352"],
  [35, 27.55, "32-319", "47-634", "49-353"],
  [40, 33.26, "32-321", "47-635", "49-354"],
  [45, 39.28, "45-212", "47-636", "49-355"],
  [50, 43.53, "32-323", "47-637", "49-356"],
  [60, 52.23, "32-724", "47-638", "49-357"],
  [75, 70.39, "32-325", "47-639", "49-358"],
  [85, 81.12, "45-213", "47-640", "49-359"],
  [100, 95.92, "32-327", "47-641", "49-360"],
  [125, 120.89, "32-492", "47-642", "49-361"],
  [150, 146.1, "32-494", "47-643", "49-362"],
  [175, 170.84, "32-884", "47-644", "49-363"],
  [200, 194.14, "32-917", "47-645", "49-364"],
  [225, 222.69, "45-214", "47-646", "49-365"],
  [250, 243.63, "32-919", "47-647", "49-366"],
  [300, 297.73, "45-215", "47-649", "49-368"],
  [400, 397.73, "45-216", "47-650", "49-369"],
];
for (const [diameter, rows] of [
  [12.5, eo125],
  [25, eo25],
])
  for (const [f, bfl, ...parts] of rows)
    parts.forEach((part, i) =>
      lens(part, f, diameter, "Edmund Optics", "edmund", {
        name: "Achromatic doublet",
        bfl,
        coating: ["MgF₂", "VIS 0°", "VIS-NIR"][i],
      }),
    );
