import { dot, scale, axes, add, unit } from "./ray3-geometry.js";
import { fieldPower, initialFields } from "./ray3-fresnel.js";
export function seededScatter(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function cosineDirection(normal, u, v) {
  const b = axes(normal),
    r = Math.sqrt(u),
    a = 2 * Math.PI * v;
  return unit(
    add(
      scale(b.n, Math.sqrt(1 - u)),
      add(scale(b.u, r * Math.cos(a)), scale(b.v, r * Math.sin(a))),
    ),
  );
}
export function lambertianBranch(direction, normal, fields, albedo, random) {
  const n = dot(direction, normal) < 0 ? normal : scale(normal, -1),
    out = cosineDirection(n, random(), random());
  return {
    event: "S",
    direction: out,
    fields: initialFields(out, fieldPower(fields) * albedo, 0, 0, true),
  };
}
