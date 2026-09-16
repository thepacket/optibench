import {
  dot,
  cross,
  scale,
  sub,
  add,
  unit,
  axes,
  length,
} from "./ray3-geometry.js";
// Complex field vectors carry sqrt(mW); their squared norm is ray power.
const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a, b) => {
  const d = b[0] ** 2 + b[1] ** 2;
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
export const fieldPower = (fields) =>
  fields.reduce(
    (s, f) => s + f.reduce((a, v) => a + v[0] ** 2 + v[1] ** 2, 0),
    0,
  );
export function initialFields(
  direction,
  power,
  polarization = 0,
  ellipticity = 0,
  unpolarized = false,
) {
  const { u, v } = axes(direction),
    a = (polarization * Math.PI) / 180,
    e = (ellipticity * Math.PI) / 180;
  if (unpolarized)
    return [
      u.map((x) => [x * Math.sqrt(power / 2), 0]),
      v.map((x) => [x * Math.sqrt(power / 2), 0]),
    ];
  const ur = Math.cos(a) * Math.cos(e),
    ui = -Math.sin(a) * Math.sin(e),
    vr = Math.sin(a) * Math.cos(e),
    vi = Math.cos(a) * Math.sin(e);
  return [
    u.map((x, i) => [
      Math.sqrt(power) * (x * ur + v[i] * vr),
      Math.sqrt(power) * (x * ui + v[i] * vi),
    ]),
  ];
}
export function fresnel(n1, n2, cosIncident) {
  if (
    ![n1, n2, cosIncident].every(Number.isFinite) ||
    n1 <= 0 ||
    n2 <= 0 ||
    cosIncident < 0 ||
    cosIncident > 1
  )
    throw Error("Invalid Fresnel inputs.");
  if (n1 === n2)
    return {
      rs: [0, 0],
      rp: [0, 0],
      ts: [1, 0],
      tp: [1, 0],
      Rs: 0,
      Rp: 0,
      Ts: 1,
      Tp: 1,
      tir: false,
      cosTransmitted: cosIncident,
    };
  const ci = cosIncident,
    st2 = (n1 / n2) ** 2 * (1 - ci * ci),
    tir = st2 > 1,
    ct = tir ? [0, Math.sqrt(st2 - 1)] : [Math.sqrt(Math.max(0, 1 - st2)), 0];
  const rs = div(
      [n1 * ci - n2 * ct[0], -n2 * ct[1]],
      [n1 * ci + n2 * ct[0], n2 * ct[1]],
    ),
    rp = div(
      [n2 * ci - n1 * ct[0], -n1 * ct[1]],
      [n2 * ci + n1 * ct[0], n1 * ct[1]],
    );
  // Flux-normalized amplitudes preserve branch power; phase/sign from Fresnel t.
  const Rs = rs[0] ** 2 + rs[1] ** 2,
    Rp = rp[0] ** 2 + rp[1] ** 2;
  return {
    rs,
    rp,
    ts: [tir ? 0 : Math.sqrt(Math.max(0, 1 - Rs)), 0],
    tp: [tir ? 0 : Math.sqrt(Math.max(0, 1 - Rp)), 0],
    Rs,
    Rp,
    Ts: tir ? 0 : 1 - Rs,
    Tp: tir ? 0 : 1 - Rp,
    tir,
    cosTransmitted: ct[0],
  };
}
function project(f, v) {
  return f.reduce(
    (s, a, i) => [s[0] + a[0] * v[i], s[1] + a[1] * v[i]],
    [0, 0],
  );
}
export function transport(fields, dIn, dOut, normal, cs, cp) {
  let s = cross(dIn, normal);
  s = length(s) < 1e-12 ? axes(dIn).u : unit(s);
  const pi = cross(s, dIn),
    po = cross(s, dOut);
  return fields.map((f) => {
    const es = mul(project(f, s), cs),
      ep = mul(project(f, pi), cp);
    return s.map((x, i) => [
      x * es[0] + po[i] * ep[0],
      x * es[1] + po[i] * ep[1],
    ]);
  });
}
export function interfaceBranches(direction, outwardNormal, fields, n1, n2) {
  const normal =
      dot(direction, outwardNormal) < 0
        ? outwardNormal
        : scale(outwardNormal, -1),
    ci = Math.max(0, Math.min(1, -dot(direction, normal))),
    f = fresnel(n1, n2, ci),
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
export function idealBranches(direction, normal, fields, R, T) {
  const reflected = unit(
      sub(direction, scale(normal, 2 * dot(direction, normal))),
    ),
    out = [];
  if (R > 0)
    out.push({
      event: "R",
      direction: reflected,
      fields: transport(
        fields,
        direction,
        reflected,
        normal,
        [-Math.sqrt(R), 0],
        [Math.sqrt(R), 0],
      ),
    });
  if (T > 0)
    out.push({
      event: "T",
      direction: [...direction],
      fields: fields.map((f) => f.map((c) => c.map((v) => v * Math.sqrt(T)))),
    });
  return out;
}
