export const materialSource =
  "https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?download=true&v=97b3ea2b";
// SCHOTT Sellmeier coefficients, lambda in micrometres. Restricted working band;
// nominal reference conditions, no melt/temperature corrections or bulk absorption.
export const rayMaterials = {
  ambient: { name: "Unit-index ambient", n: 1 },
  ideal15: { name: "Ideal nondispersive n = 1.5", n: 1.5 },
  "N-BK7": {
    name: "SCHOTT N-BK7 · nominal",
    B: [1.03961212, 0.231792344, 1.01046945],
    C: [0.00600069867, 0.0200179144, 103.560653],
  },
};
export function indexAt(material, wavelengthNm) {
  const m = rayMaterials[material];
  if (
    !m ||
    !Number.isFinite(wavelengthNm) ||
    wavelengthNm < 400 ||
    wavelengthNm > 1100
  )
    throw Error(
      "Choose a supported material and wavelength from 400 to 1100 nm.",
    );
  if (m.n) return m.n;
  const l2 = (wavelengthNm / 1000) ** 2;
  return Math.sqrt(
    1 + m.B.reduce((s, b, i) => s + (b * l2) / (l2 - m.C[i]), 0),
  );
}
