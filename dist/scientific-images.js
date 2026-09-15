import { validateFrame } from "./metrology.js";
function checkedFrame(name, width, height, values, metadata) {
  return validateFrame({ name, width, height, values, ...metadata });
}
export function decodeNumericalImage(text, name = "image.json") {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw Error(
      "Numerical images must be JSON: {width,height,fullScale,values}.",
    );
  }
  if (
    !raw ||
    !Number.isInteger(raw.width) ||
    !Number.isInteger(raw.height) ||
    raw.width < 64 ||
    raw.height < 64 ||
    raw.width > 2048 ||
    raw.height > 2048
  )
    throw Error("Numerical image dimensions must be 64–2048 pixels.");
  if (
    !Number.isFinite(raw.fullScale) ||
    raw.fullScale <= 0 ||
    raw.fullScale > 1e15
  )
    throw Error(
      "Declare a positive fullScale (e.g. 65535 for 16-bit counts, or 1 for normalized values).",
    );
  if (
    !Array.isArray(raw.values) ||
    raw.values.length !== raw.width * raw.height
  )
    throw Error(
      "Values must be a flat, row-major array matching width × height.",
    );
  for (const v of raw.values)
    if (!Number.isFinite(v) || v < 0 || v > raw.fullScale)
      throw Error(
        "Numerical intensity samples must lie between zero and fullScale.",
      );
  return checkedFrame(
    name,
    raw.width,
    raw.height,
    Float64Array.from(raw.values, (v) => v / raw.fullScale),
    {
      origin: "Imported numerical intensity",
      precision: "Float64 normalized samples",
      fullScale: raw.fullScale,
      format: "numerical-json",
    },
  );
}
export function decodePackBits(bytes, expected) {
  const out = new Uint8Array(expected);
  let p = 0,
    q = 0;
  while (p < bytes.length && q < expected) {
    const header = bytes[p++],
      count = header < 128 ? header + 1 : 257 - header;
    if (header === 128) continue;
    if (q + count > expected)
      throw Error("PackBits strip exceeds its expected size.");
    if (header < 128) {
      if (p + count > bytes.length) throw Error("Truncated PackBits strip.");
      out.set(bytes.subarray(p, p + count), q);
      p += count;
    } else {
      if (p >= bytes.length) throw Error("Truncated PackBits repeat.");
      out.fill(bytes[p++], q, q + count);
    }
    q += count;
  }
  if (q !== expected) throw Error("Incomplete PackBits strip.");
  return out;
}
export function decodeLZW(bytes, expected) {
  let table = [],
    size = 9,
    next = 258,
    bit = 0,
    previous = null,
    offset = 0;
  const out = new Uint8Array(expected);
  const reset = () => {
    table = Array.from({ length: 256 }, (_, i) => new Uint8Array([i]));
    size = 9;
    next = 258;
    previous = null;
  };
  reset();
  const read = () => {
    if (bit + size > bytes.length * 8) return null;
    let value = 0;
    for (let i = 0; i < size; i++, bit++)
      value = value * 2 + ((bytes[bit >> 3] >> (7 - (bit & 7))) & 1);
    return value;
  };
  while (true) {
    const code = read();
    if (code === null) break;
    if (code === 256) {
      reset();
      continue;
    }
    if (code === 257) break;
    let entry = table[code];
    if (!entry && code === next && previous) {
      entry = new Uint8Array(previous.length + 1);
      entry.set(previous);
      entry[previous.length] = previous[0];
    }
    if (!entry) throw Error("Invalid TIFF LZW code.");
    if (offset + entry.length > expected)
      throw Error("LZW strip exceeds its expected size.");
    out.set(entry, offset);
    offset += entry.length;
    if (previous && next < 4096) {
      const added = new Uint8Array(previous.length + 1);
      added.set(previous);
      added[previous.length] = entry[0];
      table[next++] = added;
      if (next === (1 << size) - 1 && size < 12) size++;
    }
    previous = entry;
  }
  if (offset !== expected) throw Error("Incomplete TIFF LZW strip.");
  return out;
}
async function inflate(bytes, expected) {
  if (typeof DecompressionStream === "undefined")
    throw Error(
      "This browser cannot decode Deflate TIFF. Export an uncompressed TIFF.",
    );
  const reader = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream("deflate"))
      .getReader(),
    out = new Uint8Array(expected);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.length > expected) {
        await reader.cancel();
        throw Error("Deflate strip exceeds its expected size.");
      }
      out.set(value, size);
      size += value.length;
    }
  } finally {
    reader.releaseLock();
  }
  if (size !== expected) throw Error("Incomplete Deflate TIFF strip.");
  return out;
}
export async function decodeTIFF(buffer, name = "image.tif") {
  if (
    !(buffer instanceof ArrayBuffer) ||
    buffer.byteLength < 8 ||
    buffer.byteLength > 32 * 1024 * 1024
  )
    throw Error("TIFF must be 8 bytes–32 MB.");
  const d = new DataView(buffer),
    little = d.getUint16(0, false) === 0x4949;
  if (!little && d.getUint16(0, false) !== 0x4d4d)
    throw Error("Invalid TIFF byte order.");
  const bounds = (p, n) => {
    if (!Number.isSafeInteger(p) || p < 0 || p + n > buffer.byteLength)
      throw Error("TIFF offset lies outside the file.");
  };
  const u16 = (p) => {
      bounds(p, 2);
      return d.getUint16(p, little);
    },
    u32 = (p) => {
      bounds(p, 4);
      return d.getUint32(p, little);
    };
  if (u16(2) !== 42)
    throw Error(
      "Only classic TIFF is supported; export BigTIFF as a single classic TIFF frame.",
    );
  const ifd = u32(4),
    count = u16(ifd);
  if (count > 1024) throw Error("TIFF has too many directory entries.");
  bounds(ifd + 2, count * 12 + 4);
  const tags = new Map();
  for (let i = 0; i < count; i++) {
    const p = ifd + 2 + i * 12,
      tag = u16(p),
      type = u16(p + 2),
      num = u32(p + 4);
    if (
      ![
        256, 257, 258, 259, 262, 273, 274, 277, 278, 279, 284, 317, 322, 323,
        324, 325, 339, 266,
      ].includes(tag)
    )
      continue;
    if (![3, 4].includes(type) || num < 1 || num > 65536)
      throw Error("Unsupported TIFF tag representation.");
    const bytes = type === 3 ? 2 : 4,
      start = num * bytes <= 4 ? p + 8 : u32(p + 8);
    bounds(start, num * bytes);
    if (tags.has(tag)) throw Error("Duplicate structural TIFF tag.");
    tags.set(
      tag,
      Array.from({ length: num }, (_, j) =>
        type === 3 ? u16(start + j * bytes) : u32(start + j * bytes),
      ),
    );
  }
  if (u32(ifd + 2 + count * 12) !== 0)
    throw Error(
      "Multi-page TIFF is not imported silently. Export each phase frame as a separate TIFF.",
    );
  const scalar = (tag, def) => {
    const a = tags.get(tag);
    if (!a) return def;
    if (a.length !== 1)
      throw Error("TIFF requires single-channel scalar tags.");
    return a[0];
  };
  const width = scalar(256),
    height = scalar(257),
    bits = scalar(258, 1),
    compression = scalar(259, 1),
    photo = scalar(262),
    predictor = scalar(317, 1),
    rows = scalar(278, height),
    offsets = tags.get(273),
    counts = tags.get(279);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 64 ||
    height < 64 ||
    width > 2048 ||
    height > 2048
  )
    throw Error("TIFF dimensions must be 64–2048 pixels.");
  if (
    ![8, 16].includes(bits) ||
    scalar(277, 1) !== 1 ||
    scalar(339, 1) !== 1 ||
    ![0, 1].includes(photo)
  )
    throw Error(
      "Use unsigned 8-bit or 16-bit monochrome TIFF. RGB, float and signed TIFF are not supported.",
    );
  if (scalar(274, 1) !== 1 || scalar(284, 1) !== 1 || scalar(266, 1) !== 1)
    throw Error("Use top-left, contiguous TIFF with standard bit order.");
  if (tags.has(324) || tags.has(322))
    throw Error("Tiled TIFF is not supported. Export a strip-based TIFF.");
  if (
    ![1, 5, 8, 32946, 32773].includes(compression) ||
    ![1, 2].includes(predictor)
  )
    throw Error(
      "Supported TIFF compression: none, LZW, Deflate and PackBits; predictor 1 or 2.",
    );
  if (
    !Number.isInteger(rows) ||
    rows < 1 ||
    !offsets ||
    !counts ||
    offsets.length !== Math.ceil(height / rows) ||
    counts.length !== offsets.length
  )
    throw Error("Invalid TIFF strip layout.");
  const max = 2 ** bits - 1,
    values = new Float64Array(width * height);
  for (let strip = 0; strip < offsets.length; strip++) {
    const y0 = strip * rows,
      stripRows = Math.min(rows, height - y0),
      expected = (width * stripRows * bits) / 8;
    bounds(offsets[strip], counts[strip]);
    const packed = new Uint8Array(buffer, offsets[strip], counts[strip]);
    let bytes;
    if (compression === 1) {
      if (packed.length !== expected)
        throw Error("Unexpected uncompressed TIFF strip size.");
      bytes = packed;
    } else if (compression === 32773) bytes = decodePackBits(packed, expected);
    else if (compression === 5) bytes = decodeLZW(packed, expected);
    else bytes = await inflate(packed, expected);
    const samples = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
    for (let y = 0; y < stripRows; y++) {
      let previous = 0;
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        let v = bits === 16 ? samples.getUint16(i * 2, little) : bytes[i];
        if (predictor === 2) v = (v + previous) & max;
        previous = v;
        values[(y0 + y) * width + x] = (photo === 0 ? max - v : v) / max;
      }
    }
  }
  return checkedFrame(name, width, height, values, {
    origin: `Imported ${bits}-bit TIFF`,
    precision: `${bits}-bit unsigned monochrome`,
    fullScale: max,
    format: "tiff",
    tiff: {
      compression,
      predictor,
      photometric: photo,
      byteOrder: little ? "II" : "MM",
    },
  });
}
