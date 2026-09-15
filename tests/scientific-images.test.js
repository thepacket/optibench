import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decodeTIFF, decodeNumericalImage } from "../dist/scientific-images.js";
for (const compression of ["raw", "tiff_lzw", "packbits", "tiff_adobe_deflate"])
  test(`16-bit Pillow ${compression} fixture preserves every sample`, async () => {
    const file = await readFile(
      new URL(`./fixtures/${compression}.tif`, import.meta.url),
    );
    const f = await decodeTIFF(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
    );
    assert.equal(f.fullScale, 65535);
    assert.equal(f.values.length, 4096);
    f.values.forEach((v, i) =>
      assert.ok(Math.abs(v * 65535 - ((i * 127 + 32701) % 65536)) < 1e-8),
    );
  });
test("numerical images preserve fractional counts and reject invalid samples", () => {
  const r = {
    width: 64,
    height: 64,
    fullScale: 65535,
    values: Array(4096).fill(32701.125),
  };
  assert.equal(
    decodeNumericalImage(JSON.stringify(r)).values[0],
    32701.125 / 65535,
  );
  r.values[3] = null;
  assert.throws(() => decodeNumericalImage(JSON.stringify(r)), /samples/);
});
test("truncated TIFF offsets fail explicitly", async () => {
  const f = await readFile(new URL("./fixtures/raw.tif", import.meta.url));
  await assert.rejects(() =>
    decodeTIFF(f.buffer.slice(f.byteOffset, f.byteOffset + 100)),
  );
});

test("big-endian horizontal predictor and white-is-zero decoding", async () => {
  const tags = [
    [256, 4, 64],
    [257, 4, 64],
    [258, 3, 16],
    [259, 3, 1],
    [262, 3, 0],
    [273, 4, 134],
    [277, 3, 1],
    [278, 4, 64],
    [279, 4, 8192],
    [317, 3, 2],
  ];
  const buffer = new ArrayBuffer(134 + 8192),
    d = new DataView(buffer);
  d.setUint16(0, 0x4d4d);
  d.setUint16(2, 42);
  d.setUint32(4, 8);
  d.setUint16(8, tags.length);
  tags.forEach(([tag, type, value], i) => {
    const p = 10 + i * 12;
    d.setUint16(p, tag);
    d.setUint16(p + 2, type);
    d.setUint32(p + 4, 1);
    if (type === 3) d.setUint16(p + 8, value);
    else d.setUint32(p + 8, value);
  });
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++)
      d.setUint16(134 + (y * 64 + x) * 2, x === 0 ? 32000 + y : 1);
  const f = await decodeTIFF(buffer);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++)
      assert.equal(f.values[y * 64 + x], (65535 - 32000 - y - x) / 65535);
});
