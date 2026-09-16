import { add, scale, axes } from "./ray3-geometry.js";
import { pathKey } from "./nonsequential.js";
export const escapeRay = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const rayNumber = (v) => (Number.isFinite(v) ? v.toPrecision(6) : "—");
function outlines(o) {
  const b = axes(o.normal),
    point = (x, y, z) =>
      add(o.center, add(scale(b.n, x), add(scale(b.u, y), scale(b.v, z)))),
    circle = (x, r) =>
      Array.from({ length: 49 }, (_, i) =>
        point(
          x,
          r * Math.cos((i * Math.PI) / 24),
          r * Math.sin((i * Math.PI) / 24),
        ),
      );
  if (o.kind === "sphere")
    return [
      circle(0, o.radius),
      Array.from({ length: 49 }, (_, i) =>
        point(
          o.radius * Math.cos((i * Math.PI) / 24),
          o.radius * Math.sin((i * Math.PI) / 24),
          0,
        ),
      ),
      Array.from({ length: 49 }, (_, i) =>
        point(
          o.radius * Math.cos((i * Math.PI) / 24),
          0,
          o.radius * Math.sin((i * Math.PI) / 24),
        ),
      ),
    ];
  if (o.kind === "lens") {
    const r = o.aperture / 2,
      edge = o.thickness / 2 - o.radius + Math.sqrt(o.radius ** 2 - r * r);
    return [
      circle(-edge, r),
      circle(edge, r),
      ...[-1, 1].map((sign) =>
        Array.from({ length: 33 }, (_, i) => {
          const y = -r + (i * 2 * r) / 32;
          return point(
            sign *
              (o.thickness / 2 - o.radius + Math.sqrt(o.radius ** 2 - y * y)),
            y,
            0,
          );
        }),
      ),
    ];
  }
  if (o.shape === "disc" && o.kind !== "plate")
    return [
      Array.from({ length: 49 }, (_, i) =>
        point(
          0,
          (o.width / 2) * Math.cos((i * Math.PI) / 24),
          (o.height / 2) * Math.sin((i * Math.PI) / 24),
        ),
      ),
    ];
  const face = (x) => [
    point(x, -o.width / 2, -o.height / 2),
    point(x, o.width / 2, -o.height / 2),
    point(x, o.width / 2, o.height / 2),
    point(x, -o.width / 2, o.height / 2),
    point(x, -o.width / 2, -o.height / 2),
  ];
  if (o.kind !== "plate") return [face(0)];
  const a = face(-o.thickness / 2),
    c = face(o.thickness / 2);
  return [a, c, ...a.slice(0, 4).map((v, i) => [v, c[i]])];
}
export function raySceneSVG(scene, run, view = "oblique", selected = null) {
  const projection = (p) =>
    view === "top"
      ? [p[0], p[1]]
      : view === "front"
        ? [p[0], -p[2]]
        : [0.86 * (p[0] - p[1]), 0.35 * (p[0] + p[1]) - p[2]];
  let lines = run?.segments || [];
  if (selected)
    lines = lines.filter(
      (s) =>
        s.sourceId === selected.sourceId &&
        s.wavelength === selected.wavelength &&
        s.path.every(
          (e, i) => JSON.stringify(e) === JSON.stringify(selected.path[i]),
        ) &&
        s.surface ===
          `${selected.path[s.path.length]?.objectId}:${selected.path[s.path.length]?.surface}`,
    );
  const shapes = scene.objects
      .filter((o) => o.kind !== "unsupported")
      .map((o) => ({ o, lines: outlines(o) })),
    points = [
      ...scene.sources.map((s) => s.position),
      ...shapes.flatMap((s) => s.lines.flat()),
      ...lines.slice(0, 3000).flatMap((s) => [s.a, s.b]),
    ].map(projection);
  if (!points.length) return "";
  const min = [0, 1].map((k) => Math.min(...points.map((p) => p[k]))),
    max = [0, 1].map((k) => Math.max(...points.map((p) => p[k]))),
    factor = Math.min(
      900 / Math.max(10, max[0] - min[0]),
      370 / Math.max(10, max[1] - min[1]),
    ),
    xy = (p) => {
      const q = projection(p);
      return [(q[0] - min[0]) * factor + 40, (q[1] - min[1]) * factor + 40];
    },
    coord = (p) => xy(p).join(",");
  return `<svg viewBox="0 0 1000 460" role="img" aria-label="${view} projection of three-dimensional ray paths">${lines
    .slice(0, 3000)
    .map(
      (s) =>
        `<path d="M${coord(s.a)}L${coord(s.b)}" stroke="${s.path.some((p) => p.event === "R" || p.event === "TIR") ? "#edb679" : "#bbec7d"}" stroke-width="1" opacity=".45" fill="none"/>`,
    )
    .join(
      "",
    )}${shapes.map(({ o, lines }) => `<g stroke="${o.kind === "detector" ? "#b3e5ff" : "#7796b7"}" fill="none" stroke-width="1.4">${lines.map((line) => `<polyline points="${line.map(coord).join(" ")}"/>`).join("")}</g><text x="${xy(o.center)[0] + 6}" y="${xy(o.center)[1] - 8}" fill="#dce9f6" font-size="13">${escapeRay(o.label)}</text>`).join("")}${scene.sources.map((s) => `<circle cx="${xy(s.position)[0]}" cy="${xy(s.position)[1]}" r="4" fill="#b7e97d"/>`).join("")}<text x="20" y="448" fill="#b3c3d2" font-size="14">${escapeRay(view)} projection · ${lines.length} segments${lines.length > 3000 ? " · display capped at 3000; accounting uses every ray" : ""}</text></svg>`;
}
export function detectorCSV(run, id) {
  const d = run.detectors.find((d) => d.id === id);
  if (!d) throw Error("Select a detector.");
  const rows = ["u_mm,v_mm,power_mW,irradiance_mW_per_mm2"];
  for (let y = 0; y < d.bins; y++)
    for (let x = 0; x < d.bins; x++) {
      const i = y * d.bins + x;
      rows.push(
        [
          ((x + 0.5 - d.bins / 2) * d.width) / d.bins,
          ((y + 0.5 - d.bins / 2) * d.height) / d.bins,
          d.pixels[i],
          d.irradiance[i],
        ].join(","),
      );
    }
  return rows.join("\n");
}
export function pathCSV(groups) {
  const cell = (v) =>
    '"' +
    String(
      typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? "'" + v : v,
    ).replaceAll('"', '""') +
    '"';
  return [
    [
      "source",
      "wavelength_nm",
      "detector",
      "reflections",
      "ray_hits",
      "power_mW",
      "path",
    ],
    ...groups.map((g) => [
      g.sourceId,
      g.wavelength,
      g.detectorId,
      g.reflections,
      g.hits,
      g.power,
      pathKey(g.path),
    ]),
  ]
    .map((r) => r.map(cell).join(","))
    .join("\n");
}
