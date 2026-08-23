import { downloadBlob } from "@/engine/canvas-render";

export async function recordCanvas(
  canvas: HTMLCanvasElement,
  drawFrames: Array<() => void>,
  fps: number,
  filename: string,
) {
  const supported = ["video/mp4", "video/webm;codecs=vp9", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
  if (!supported) throw new Error("This browser cannot export video.");
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType: supported, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const finished = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  recorder.start();
  for (const draw of drawFrames) {
    draw();
    await new Promise((resolve) => setTimeout(resolve, 1000 / fps));
  }
  recorder.stop();
  await finished;
  const extension = supported.startsWith("video/mp4") ? "mp4" : "webm";
  downloadBlob(new Blob(chunks, { type: supported }), `${filename}.${extension}`);
  return extension;
}
