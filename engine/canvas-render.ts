import type { TextOverlay } from "@/engine/types";

export async function loadImage(src: string) {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  await image.decode();
  return image;
}

function wrappedLines(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const output: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && context.measureText(next).width > maxWidth) {
        output.push(line);
        line = word;
      } else line = next;
    }
    if (line) output.push(line);
  }
  return output;
}

export function paintFrame(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  width: number,
  height: number,
  overlays: TextOverlay[],
  time?: number,
) {
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  for (const overlay of overlays) {
    if (time !== undefined && ((overlay.start ?? 0) > time || (overlay.end ?? Infinity) < time)) continue;
    const fontSize = Math.max(14, overlay.fontSize * (width / 640));
    context.font = `900 ${fontSize}px Arial, Helvetica, sans-serif`;
    context.textAlign = overlay.align;
    context.textBaseline = "middle";
    context.lineJoin = "round";
    context.fillStyle = overlay.color;
    context.strokeStyle = "rgba(0,0,0,.9)";
    context.lineWidth = Math.max(3, fontSize * 0.11);
    const maxWidth = width * 0.86;
    const lines = wrappedLines(context, overlay.text, maxWidth);
    const lineHeight = fontSize * 1.08;
    const x = width * overlay.x / 100;
    const y = height * overlay.y / 100 - ((lines.length - 1) * lineHeight / 2);
    lines.forEach((line, index) => {
      context.strokeText(line, x, y + index * lineHeight, maxWidth);
      context.fillText(line, x, y + index * lineHeight, maxWidth);
    });
  }
}

export async function renderStill(src: string, overlays: TextOverlay[]) {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  paintFrame(context, image, canvas.width, canvas.height, overlays);
  return canvas;
}

export async function renderVideoStill(src: string, time: number, overlays: TextOverlay[]) {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "metadata";
  video.src = src;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("The episode preview could not be loaded."));
    video.load();
  });
  await new Promise<void>((resolve, reject) => {
    video.onseeked = () => resolve();
    video.onerror = () => reject(new Error("The selected frame could not be loaded."));
    video.currentTime = Math.max(0, Math.min(video.duration, time));
  });
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  paintFrame(context, video, canvas.width, canvas.height, overlays);
  video.removeAttribute("src");
  video.load();
  return canvas;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function canvasBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Export failed.")), type, quality));
}
