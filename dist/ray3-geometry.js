// Geometry in millimetres; right-handed XYZ, unit directions and normals.
export const EPS = 1e-7;
export const add = (a, b) => a.map((v, i) => v + b[i]);
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const scale = (a, s) => a.map((v) => v * s);
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a) => Math.hypot(...a);
export function unit(a) {
  const n = length(a);
  if (!Number.isFinite(n) || n < 1e-14)
    throw Error("A direction must be finite and nonzero.");
  return scale(a, 1 / n);
}
export function axes(direction) {
  const n = unit(direction),
    u = unit(cross(Math.abs(n[2]) < 0.99 ? [0, 0, 1] : [0, 1, 0], n));
  return { n, u, v: cross(n, u) };
}
export function normalAngles(yaw = 0, pitch = 0) {
  const a = (yaw * Math.PI) / 180,
    b = (pitch * Math.PI) / 180;
  return [Math.cos(a) * Math.cos(b), Math.sin(a) * Math.cos(b), Math.sin(b)];
}
export const local = (p, o) => {
  const b = axes(o.normal),
    d = sub(p, o.center);
  return [dot(d, b.n), dot(d, b.u), dot(d, b.v)];
};
const world = (a, b) =>
  add(add(scale(b.n, a[0]), scale(b.u, a[1])), scale(b.v, a[2]));
export function volume(o) {
  return ["sphere", "plate", "lens"].includes(o.kind);
}
export function boundRadius(o) {
  return o.kind === "sphere"
    ? o.radius
    : o.kind === "lens"
      ? Math.hypot(o.thickness / 2, o.aperture / 2)
      : o.kind === "plate"
        ? Math.hypot(o.thickness / 2, o.width / 2, o.height / 2)
        : Math.hypot(o.width / 2, o.height / 2);
}
export function inside(p, o, tolerance = 0) {
  const q = local(p, o);
  if (o.kind === "sphere") return length(q) < o.radius - tolerance;
  if (o.kind === "plate")
    return (
      Math.abs(q[0]) < o.thickness / 2 - tolerance &&
      Math.abs(q[1]) < o.width / 2 - tolerance &&
      Math.abs(q[2]) < o.height / 2 - tolerance
    );
  if (o.kind === "lens") {
    const c = o.radius - o.thickness / 2;
    return (
      Math.hypot(q[0] - c, q[1], q[2]) < o.radius - tolerance &&
      Math.hypot(q[0] + c, q[1], q[2]) < o.radius - tolerance &&
      Math.hypot(q[1], q[2]) < o.aperture / 2 - tolerance
    );
  }
  return false;
}
function sphereRoots(p, d, c, r) {
  const q = sub(p, c),
    b = dot(q, d),
    h = b * b - dot(q, q) + r * r;
  if (h < 0) return [];
  const s = Math.sqrt(Math.max(0, h));
  return [-b - s, -b + s];
}
export function intersectSurface(origin, direction, o) {
  const basis = axes(o.normal),
    p = local(origin, o),
    d = [
      dot(direction, basis.n),
      dot(direction, basis.u),
      dot(direction, basis.v),
    ],
    hits = [];
  function accept(t, n, face) {
    if (t <= EPS || !Number.isFinite(t)) return;
    const q = add(p, scale(d, t));
    hits.push({
      distance: t,
      point: add(origin, scale(direction, t)),
      normal: world(n, basis),
      uv: [q[1], q[2]],
      face,
    });
  }
  if (o.kind === "sphere")
    for (const t of sphereRoots(p, d, [0, 0, 0], o.radius)) {
      const q = add(p, scale(d, t));
      accept(t, scale(q, 1 / o.radius), "sphere");
    }
  else if (o.kind === "plate") {
    const size = [o.thickness, o.width, o.height];
    for (let k = 0; k < 3; k++)
      for (const sign of [-1, 1]) {
        if (Math.abs(d[k]) < 1e-14) continue;
        const t = ((sign * size[k]) / 2 - p[k]) / d[k],
          q = add(p, scale(d, t));
        if (q.every((v, i) => i === k || Math.abs(v) <= size[i] / 2 + EPS)) {
          const n = [0, 0, 0];
          n[k] = sign;
          accept(t, n, `${["axial", "u", "v"][k]}${sign > 0 ? "+" : "-"}`);
        }
      }
  } else if (o.kind === "lens") {
    const c = o.radius - o.thickness / 2;
    for (const sign of [-1, 1]) {
      const center = [sign * c, 0, 0];
      for (const t of sphereRoots(p, d, center, o.radius)) {
        const q = add(p, scale(d, t));
        if (
          Math.hypot(q[0] + sign * c, q[1], q[2]) <= o.radius + EPS &&
          Math.hypot(q[1], q[2]) <= o.aperture / 2 + EPS
        )
          accept(
            t,
            scale(sub(q, center), 1 / o.radius),
            sign === 1 ? "front" : "back",
          );
      }
    }
    const a = d[1] ** 2 + d[2] ** 2,
      b = p[1] * d[1] + p[2] * d[2],
      h = b * b - a * (p[1] ** 2 + p[2] ** 2 - (o.aperture / 2) ** 2);
    if (a > 1e-20 && h >= 0)
      for (const t of [(-b - Math.sqrt(h)) / a, (-b + Math.sqrt(h)) / a]) {
        const q = add(p, scale(d, t));
        if (
          Math.hypot(q[0] - c, q[1], q[2]) <= o.radius + EPS &&
          Math.hypot(q[0] + c, q[1], q[2]) <= o.radius + EPS
        )
          accept(t, unit([0, q[1], q[2]]), "rim");
      }
  } else if (Math.abs(d[0]) > 1e-14) {
    const t = -p[0] / d[0],
      q = add(p, scale(d, t));
    if (
      Math.abs(q[1]) <= o.width / 2 + EPS &&
      Math.abs(q[2]) <= o.height / 2 + EPS &&
      (o.shape !== "disc" ||
        (q[1] / (o.width / 2)) ** 2 + (q[2] / (o.height / 2)) ** 2 <= 1 + 1e-12)
    )
      accept(t, [1, 0, 0], "plane");
  }
  hits.sort((a, b) => a.distance - b.distance);
  return hits[0] || null;
}
export function nearestSurface(origin, direction, objects) {
  const hits = objects
    .map((object) => {
      const hit = intersectSurface(origin, direction, object);
      return hit ? { ...hit, object } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance);
  if (hits.length > 1 && Math.abs(hits[0].distance - hits[1].distance) < EPS)
    throw Error(
      "Coincident surface encounters are ambiguous; separate the objects.",
    );
  return hits[0] || null;
}
