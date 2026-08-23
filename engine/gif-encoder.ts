/**
 * GIF89a encoder.
 *
 * Three things matter for quality here:
 *  - an adaptive palette chosen from the frames themselves (a fixed 3-3-2 RGB
 *    palette posterises skin tones and dark interiors into flat blocks),
 *  - Floyd-Steinberg dithering, which turns the remaining banding into texture,
 *  - real LZW with a dictionary, so the file is a fraction of the size.
 */

type FrameLike = { width: number; height: number; data: Uint8ClampedArray };

function bytes(value: number, count: number) {
  return Array.from({ length: count }, (_, index) => (value >> (index * 8)) & 255);
}

/** Evenly sampled RGB triples across every frame, capped so large clips stay fast. */
function samplePixels(frames: FrameLike[], cap = 40000) {
  let total = 0;
  for (const frame of frames) total += frame.width * frame.height;
  const stride = Math.max(1, Math.floor(total / cap));
  const samples: number[] = [];
  let counter = 0;
  for (const frame of frames) {
    const { data } = frame;
    for (let index = 0; index < data.length; index += 4) {
      if (counter++ % stride) continue;
      samples.push(data[index], data[index + 1], data[index + 2]);
    }
  }
  return samples;
}

type Box = { start: number; end: number };

/** Median-cut quantisation: split the colour cloud until it yields `maxColors` cells. */
function medianCut(samples: number[], maxColors: number) {
  const count = samples.length / 3;
  if (count === 0) return [0, 0, 0];
  const order = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) order[index] = index;

  const spread = (box: Box) => {
    const low = [255, 255, 255];
    const high = [0, 0, 0];
    for (let index = box.start; index < box.end; index += 1) {
      const base = order[index] * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = samples[base + channel];
        if (value < low[channel]) low[channel] = value;
        if (value > high[channel]) high[channel] = value;
      }
    }
    return [high[0] - low[0], high[1] - low[1], high[2] - low[2]];
  };

  const boxes: Box[] = [{ start: 0, end: count }];
  while (boxes.length < maxColors) {
    // Split whichever box still covers the widest range of colour.
    let target = -1;
    let widest = 0;
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index];
      if (box.end - box.start < 2) continue;
      const size = spread(box);
      const longest = Math.max(size[0], size[1], size[2]);
      if (longest > widest) { widest = longest; target = index; }
    }
    if (target < 0 || widest === 0) break;

    const box = boxes[target];
    const size = spread(box);
    const channel = size.indexOf(Math.max(size[0], size[1], size[2]));
    const slice = Array.from(order.subarray(box.start, box.end));
    slice.sort((left, right) => samples[left * 3 + channel] - samples[right * 3 + channel]);
    order.set(slice, box.start);
    const middle = box.start + (slice.length >> 1);
    boxes.splice(target, 1, { start: box.start, end: middle }, { start: middle, end: box.end });
  }

  const palette: number[] = [];
  for (const box of boxes) {
    let r = 0, g = 0, b = 0;
    const size = box.end - box.start;
    for (let index = box.start; index < box.end; index += 1) {
      const base = order[index] * 3;
      r += samples[base]; g += samples[base + 1]; b += samples[base + 2];
    }
    palette.push(Math.round(r / size), Math.round(g / size), Math.round(b / size));
  }
  return palette;
}

/** Nearest palette entry, cached per 5-5-5 colour cell so lookups stay cheap. */
function nearestFinder(palette: number[]) {
  const cache = new Int16Array(32768).fill(-1);
  const size = palette.length / 3;
  return (r: number, g: number, b: number) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const cached = cache[key];
    if (cached >= 0) return cached;
    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < size; index += 1) {
      const dr = r - palette[index * 3];
      const dg = g - palette[index * 3 + 1];
      const db = b - palette[index * 3 + 2];
      const distance = dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
      if (distance < bestDistance) { bestDistance = distance; best = index; }
    }
    cache[key] = best;
    return best;
  };
}

/** Map a frame onto the palette, diffusing the error into neighbouring pixels. */
function ditherToIndices(frame: FrameLike, palette: number[], nearest: (r: number, g: number, b: number) => number) {
  const { width, height, data } = frame;
  const working = new Float32Array(width * height * 3);
  for (let source = 0, target = 0; source < data.length; source += 4, target += 3) {
    working[target] = data[source];
    working[target + 1] = data[source + 1];
    working[target + 2] = data[source + 2];
  }
  const output = new Uint8Array(width * height);
  const clamp = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : value);
  const push = (offset: number, error: number, factor: number) => {
    working[offset] += error * factor;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * 3;
      const r = clamp(working[pixel]);
      const g = clamp(working[pixel + 1]);
      const b = clamp(working[pixel + 2]);
      const index = nearest(Math.round(r), Math.round(g), Math.round(b));
      output[y * width + x] = index;
      const errors = [r - palette[index * 3], g - palette[index * 3 + 1], b - palette[index * 3 + 2]];
      for (let channel = 0; channel < 3; channel += 1) {
        const error = errors[channel];
        if (error === 0) continue;
        if (x + 1 < width) push(pixel + 3 + channel, error, 7 / 16);
        if (y + 1 < height) {
          const below = pixel + width * 3 + channel;
          if (x > 0) push(below - 3, error, 3 / 16);
          push(below, error, 5 / 16);
          if (x + 1 < width) push(below + 3, error, 1 / 16);
        }
      }
    }
  }
  return output;
}

/** GIF-variant LZW with a real dictionary. */
function lzw(data: Uint8Array, minCodeSize: number) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const packed: number[] = [];
  let current = 0;
  let bitCount = 0;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  let dictionary = new Map<number, number>();

  const write = (code: number) => {
    current |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      packed.push(current & 255);
      current >>= 8;
      bitCount -= 8;
    }
  };

  write(clearCode);
  if (data.length === 0) {
    write(endCode);
    if (bitCount > 0) packed.push(current & 255);
    return packed;
  }

  let prefix = data[0];
  for (let index = 1; index < data.length; index += 1) {
    const character = data[index];
    const key = prefix * 256 + character;
    const existing = dictionary.get(key);
    if (existing !== undefined) { prefix = existing; continue; }
    write(prefix);
    dictionary.set(key, nextCode);
    nextCode += 1;
    if (nextCode === 4096) {
      write(clearCode);
      dictionary = new Map();
      codeSize = minCodeSize + 1;
      nextCode = endCode + 1;
    } else if (nextCode > (1 << codeSize)) {
      codeSize += 1;
    }
    prefix = character;
  }
  write(prefix);
  write(endCode);
  if (bitCount > 0) packed.push(current & 255);
  return packed;
}

function blocks(data: number[]) {
  const output: number[] = [];
  for (let index = 0; index < data.length; index += 255) {
    const block = data.slice(index, index + 255);
    output.push(block.length, ...block);
  }
  output.push(0);
  return output;
}

export function encodeGif(frames: FrameLike[], delayCentiseconds: number) {
  if (!frames.length) throw new Error("A GIF needs at least one frame.");
  const { width, height } = frames[0];

  const palette = medianCut(samplePixels(frames), 256);
  const nearest = nearestFinder(palette);
  const table = palette.slice(0, 768);
  while (table.length < 768) table.push(0);

  const output: number[] = [
    ...new TextEncoder().encode("GIF89a"), ...bytes(width, 2), ...bytes(height, 2), 0xf7, 0, 0,
    ...table,
    0x21, 0xff, 0x0b, ...new TextEncoder().encode("NETSCAPE2.0"), 3, 1, 0, 0, 0,
  ];
  const append = (data: number[]) => {
    for (const value of data) output.push(value);
  };
  for (const frame of frames) {
    output.push(
      0x21, 0xf9, 4, 0x04, ...bytes(Math.max(1, delayCentiseconds), 2), 0, 0,
      0x2c, 0, 0, 0, 0, ...bytes(width, 2), ...bytes(height, 2), 0,
      8,
    );
    append(blocks(lzw(ditherToIndices(frame, palette, nearest), 8)));
  }
  output.push(0x3b);
  return new Blob([new Uint8Array(output)], { type: "image/gif" });
}
