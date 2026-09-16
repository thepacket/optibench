import { fresnel, transport } from "./ray3-fresnel.js";
import { dot, scale, unit, add } from "./ray3-geometry.js";
const addC = (a, b) => [a[0] + b[0], a[1] + b[1]],
  subC = (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],
  times = (a, s) => a.map((v) => v * s),
  norm = (a) => a[0] ** 2 + a[1] ** 2;
function div(a, b) {
  const d = norm(b);
  if (d < 1e-28)
    throw Error(
      "Coating resonance is numerically singular; adjust the angle or layer prescription.",
    );
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
}
export function validateCoating(layers = []) {
  if (!Array.isArray(layers) || layers.length > 12)
    throw Error("Use at most 12 lossless coating layers.");
  for (const l of layers) {
    if (
      !Number.isFinite(l.n) ||
      l.n < 1 ||
      l.n > 4 ||
      !Number.isFinite(l.thicknessNm) ||
      l.thicknessNm < 0 ||
      l.thicknessNm > 10000
    )
      throw Error(
        "Coating layers require a real index 1–4 and thickness 0–10000 nm.",
      );
  }
  return structuredClone(layers);
}
// Stable scattering recursion (rather than exponentially growing characteristic matrices).
// exp(-i wt), forward exp(+i kz). Real indices only; evanescent film cosines use +i.
export function coatingResponse(n1, n2, ci, wavelength, layers = []) {
  validateCoating(layers);
  if (
    ![n1, n2, ci, wavelength].every(Number.isFinite) ||
    n1 <= 0 ||
    n2 <= 0 ||
    ci < 0 ||
    ci > 1 ||
    wavelength < 400 ||
    wavelength > 1100
  )
    throw Error("Invalid coating incidence or wavelength.");
  if (!layers.length || ci < 1e-12) return fresnel(n1, n2, ci);
  const ns = [n1, ...layers.map((l) => l.n), n2],
    q = n1 * Math.sqrt(Math.max(0, 1 - ci * ci)),
    cos = ns.map((n) => {
      const z = 1 - (q / n) ** 2;
      return z < 0 ? [0, Math.sqrt(-z)] : [Math.sqrt(Math.max(1e-24, z)), 0];
    });
  cos[0] = [ci, 0];
  function solve(polarization) {
    let r = [0, 0],
      t = [1, 0];
    for (let j = ns.length - 2; j >= 0; j--) {
      const a = ns[j],
        b = ns[j + 1],
        ca = cos[j],
        cb = cos[j + 1],
        x = times(ca, polarization === "s" ? a : b),
        y = times(cb, polarization === "s" ? b : a),
        den = addC(x, y),
        rij = div(subC(x, y), den),
        tij = div(times(ca, 2 * a), den);
      const phase =
          j < layers.length
            ? times(cb, (2 * Math.PI * b * layers[j].thicknessNm) / wavelength)
            : [0, 0],
        prop = [
          Math.exp(-phase[1]) * Math.cos(phase[0]),
          Math.exp(-phase[1]) * Math.sin(phase[0]),
        ],
        rphase = mul(r, mul(prop, prop)),
        d = addC([1, 0], mul(rij, rphase));
      t = div(mul(mul(tij, t), prop), d);
      r = div(addC(rij, rphase), d);
    }
    return { r, t };
  }
  const s = solve("s"),
    p = solve("p"),
    ct = cos.at(-1),
    tir = q >= n2,
    flux = tir ? 0 : (n2 * ct[0]) / (n1 * ci),
    rs = s.r,
    rp = p.r,
    ts = times(s.t, Math.sqrt(flux)),
    tp = times(p.t, Math.sqrt(flux));
  const Rs = norm(rs),
    Rp = norm(rp),
    Ts = norm(ts),
    Tp = norm(tp);
  if (
    ![Rs, Rp, Ts, Tp].every(Number.isFinite) ||
    Math.abs(Rs + Ts - 1) > 1e-7 ||
    Math.abs(Rp + Tp - 1) > 1e-7
  )
    throw Error(
      "Coating energy balance failed; this prescription is numerically unsupported.",
    );
  return {
    rs,
    rp,
    ts,
    tp,
    Rs,
    Rp,
    Ts,
    Tp,
    tir,
    cosTransmitted: tir ? 0 : ct[0],
  };
}
export function coatedBranches(
  direction,
  outward,
  fields,
  n1,
  n2,
  wavelength,
  layers,
  exiting = false,
) {
  const normal = dot(direction, outward) < 0 ? outward : scale(outward, -1),
    ci = Math.min(1, Math.max(0, -dot(direction, normal))),
    f = coatingResponse(
      n1,
      n2,
      ci,
      wavelength,
      exiting ? [...layers].reverse() : layers,
    ),
    reflected = unit(add(direction, scale(normal, 2 * ci))),
    branches = [
      {
        event: f.tir ? "TIR" : "R",
        direction: reflected,
        fields: transport(fields, direction, reflected, normal, f.rs, f.rp),
      },
    ];
  if (!f.tir) {
    const transmitted = unit(
      add(
        scale(direction, n1 / n2),
        scale(normal, (n1 / n2) * ci - f.cosTransmitted),
      ),
    );
    branches.push({
      event: "T",
      direction: transmitted,
      fields: transport(fields, direction, transmitted, normal, f.ts, f.tp),
    });
  }
  return branches;
}
export function coatingPreset(kind, substrate = 1.5, designNm = 550) {
  if (kind === "ar") {
    const n = Math.sqrt(substrate);
    return [{ n, thicknessNm: designNm / (4 * n) }];
  }
  if (kind === "reflector")
    return Array.from({ length: 8 }, (_, i) => {
      const n = i % 2 ? 1.45 : 2.1;
      return { n, thicknessNm: designNm / (4 * n) };
    });
  return [];
}
export function coatingApplies(object, face) {
  return (
    object.coating?.length &&
    (object.coatingFaces === "all" ||
      ["front", "back", "axial-", "axial+", "sphere"].includes(face))
  );
}
