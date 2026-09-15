// Uniform Jones state in transverse (in-table, vertical) axes, exp(-iωt).
const rad = (d) => (d * Math.PI) / 180;
export function sourceJones(c) {
  const a = rad(c.polarization || 0),
    e = rad(c.ellipticity || 0);
  return [
    Math.cos(a) * Math.cos(e),
    -Math.sin(a) * Math.sin(e),
    Math.sin(a) * Math.cos(e),
    Math.cos(a) * Math.sin(e),
  ];
}
export function polarizationElement(j, c) {
  const a = rad(c.axis || 0),
    co = Math.cos(a),
    si = Math.sin(a);
  const u = [co * j[0] + si * j[2], co * j[1] + si * j[3]],
    v = [-si * j[0] + co * j[2], -si * j[1] + co * j[3]];
  const t = Math.sqrt(c.transmission ?? 1),
    attenuation = c.type === "polarizer" ? Math.sqrt(c.leakage ?? 0) : 1;
  const phase = c.type === "waveplate" ? rad(c.retardance ?? 180) : 0;
  const vr = (v[0] * Math.cos(phase) - v[1] * Math.sin(phase)) * attenuation,
    vi = (v[0] * Math.sin(phase) + v[1] * Math.cos(phase)) * attenuation;
  const out = [
    t * (co * u[0] - si * vr),
    t * (co * u[1] - si * vi),
    t * (si * u[0] + co * vr),
    t * (si * u[1] + co * vi),
  ];
  const power = out.reduce((s, v) => s + v * v, 0),
    norm = Math.sqrt(power);
  return {
    power,
    jones: norm > 1e-15 ? out.map((v) => v / norm) : [1, 0, 0, 0],
  };
}
export function advancedPolarization(c) {
  return (
    c.type === "waveplate" ||
    !!c.ellipticity ||
    (c.type === "polarizer" &&
      ((c.leakage || 0) > 0 || (c.transmission ?? 1) !== 1))
  );
}
