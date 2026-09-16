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

export function validateCustomMaterials(materials = []) {
  if (!Array.isArray(materials) || materials.length > 16)
    throw Error("Use at most 16 custom materials.");
  const ids = new Set();
  for (const m of materials) {
    if (
      typeof m.id !== "string" ||
      !/^custom-[\w-]{1,80}$/.test(m.id) ||
      ids.has(m.id) ||
      typeof m.name !== "string" ||
      !m.name.trim() ||
      m.name.length > 100 ||
      typeof m.provenance !== "string" ||
      m.provenance.length > 1000
    )
      throw Error(
        "Custom materials need unique custom- IDs, names and provenance text.",
      );
    ids.add(m.id);
    if (
      !Array.isArray(m.samples) ||
      m.samples.length < 2 ||
      m.samples.length > 64
    )
      throw Error("A material needs 2–64 increasing wavelength rows.");
    let previous = 0;
    for (const row of m.samples) {
      if (
        !Array.isArray(row) ||
        row.length !== 3 ||
        !row.every(Number.isFinite) ||
        row[0] < 400 ||
        row[0] > 1100 ||
        row[0] <= previous ||
        row[1] < 1 ||
        row[1] > 4 ||
        row[2] < 0 ||
        row[2] > 100
      )
        throw Error(
          "Material rows: increasing wavelength 400–1100 nm, index 1–4, attenuation 0–100 per mm.",
        );
      previous = row[0];
    }
  }
  return structuredClone(materials);
}
export function materialValue(id, wavelength, materials = []) {
  const m = materials.find((m) => m.id === id);
  if (!m) return { n: indexAt(id, wavelength), alpha: 0 };
  const rows = m.samples;
  if (wavelength < rows[0][0] || wavelength > rows.at(-1)[0])
    throw Error(
      `${m.name}: wavelength is outside the supplied data; extrapolation is disabled.`,
    );
  for (let i = 1; i < rows.length; i++)
    if (wavelength <= rows[i][0]) {
      const a = rows[i - 1],
        b = rows[i],
        u = (wavelength - a[0]) / (b[0] - a[0]);
      return { n: a[1] + u * (b[1] - a[1]), alpha: a[2] + u * (b[2] - a[2]) };
    }
  throw Error("Invalid custom material table.");
}
export function parseMaterialTable(text) {
  const rows = text
    .trim()
    .split(/\n/)
    .filter((l) => l.trim())
    .map((line) =>
      line
        .trim()
        .split(/[\s,;]+/)
        .map(Number),
    );
  validateCustomMaterials([
    {
      id: "custom-check",
      name: "Imported material",
      provenance: "",
      samples: rows,
    },
  ]);
  return rows;
}
