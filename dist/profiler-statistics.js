// Linear least-squares coefficient covariance followed by first-order propagation.
// Intervals describe residual scatter under independent equal-variance errors only.
export function propagationUncertainty(rows, coefficients, scale, mid) {
  const dof = rows.length - 3,
    [a, b, c] = coefficients;
  const m = Array.from({ length: 3 }, (_, i) => [
    0,
    0,
    0,
    ...[0, 1, 2].map((j) => +(j === i)),
  ]);
  for (const r of rows)
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) m[i][j] += r.x[i] * r.x[j];
  for (let i = 0; i < 3; i++) {
    let k = i;
    for (let j = i + 1; j < 3; j++)
      if (Math.abs(m[j][i]) > Math.abs(m[k][i])) k = j;
    [m[i], m[k]] = [m[k], m[i]];
    const d = m[i][i];
    if (Math.abs(d) < 1e-12) throw Error("Fit covariance is singular.");
    for (let j = 0; j < 6; j++) m[i][j] /= d;
    for (let k = 0; k < 3; k++)
      if (k !== i) {
        const v = m[k][i];
        for (let j = 0; j < 6; j++) m[k][j] -= v * m[i][j];
      }
  }
  const variance =
    rows.reduce((s, r) => s + (r.y - a - b * r.x[1] - c * r.x[2]) ** 2, 0) /
    dof;
  const covariance = m.map((r) => r.slice(3).map((v) => v * variance));
  const t95 = [
    null,
    12.706,
    4.303,
    3.182,
    2.776,
    2.571,
    2.447,
    2.365,
    2.306,
    2.262,
    2.228,
    2.201,
    2.179,
    2.16,
    2.145,
    2.131,
    2.12,
    2.11,
    2.101,
  ][Math.min(dof, 18)];
  const w = Math.sqrt(a - (b * b) / (4 * c)),
    z = mid - (scale * b) / (2 * c),
    angle = (1000 * Math.sqrt(c)) / scale;
  function estimate(value, g) {
    let v = 0;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) v += g[i] * covariance[i][j] * g[j];
    const standardError = Math.sqrt(Math.max(0, v));
    return {
      standardError,
      ci95: [value - t95 * standardError, value + t95 * standardError],
    };
  }
  return {
    dof,
    residualVariance: variance,
    covariance,
    waistRadiusMm: estimate(w, [
      1 / (2 * w),
      -b / (4 * c * w),
      (b * b) / (8 * c * c * w),
    ]),
    waistPositionMm: estimate(z, [
      0,
      -scale / (2 * c),
      (scale * b) / (2 * c * c),
    ]),
    halfAngleMrad: estimate(angle, [0, 0, 500 / (scale * Math.sqrt(c))]),
    method:
      "Approximate 95% t intervals: least-squares residual covariance with first-order propagation. Assumes independent equal-variance errors in measured radius squared. Excludes pixel calibration, alignment, model bias and other systematic uncertainty.",
  };
}
