'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** One tile of the room to record: a camera or a shared screen. */
export type RecordSource = { id: string; stream: MediaStream | null; name: string; screen?: boolean };
export type Rect = { x: number; y: number; w: number; h: number };

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 24;
const GAP = 8;
const VIDEO_BITRATE = 2_500_000;
const STRIP_MAX = 5;

export function canRecordInBrowser(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    'captureStream' in HTMLCanvasElement.prototype
  );
}

function pickMimeType(): string | undefined {
  for (const type of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

/** Grid of `count` cells filling `area`, rows of equal height. */
export function gridLayout(count: number, area: Rect, gap = GAP): Rect[] {
  if (count <= 0) return [];
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const w = (area.w - gap * (cols - 1)) / cols;
  const h = (area.h - gap * (rows - 1)) / rows;
  return Array.from({ length: count }, (_, i) => ({
    x: area.x + (i % cols) * (w + gap),
    y: area.y + Math.floor(i / cols) * (h + gap),
    w,
    h,
  }));
}

/** One column of `count` equal cells filling `area`. */
export function columnLayout(count: number, area: Rect, gap = GAP): Rect[] {
  if (count <= 0) return [];
  const h = (area.h - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, i) => ({ x: area.x, y: area.y + i * (h + gap), w: area.w, h }));
}

/** "rendly-<slug>-<room>-2026-11-15T10-00.webm" */
export function recordingFileName(title: string, room: string, at: Date): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'huddle';
  const stamp = at.toISOString().slice(0, 16).replace(':', '-');
  return `rendly-${slug}-${room}-${stamp}.webm`;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function drawTile(ctx: CanvasRenderingContext2D, video: HTMLVideoElement | null, name: string, r: Rect, fit: 'cover' | 'contain'): void {
  ctx.fillStyle = '#18181b';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  if (video && video.readyState >= 2 && video.videoWidth > 0) {
    const scale = fit === 'cover'
      ? Math.max(r.w / video.videoWidth, r.h / video.videoHeight)
      : Math.min(r.w / video.videoWidth, r.h / video.videoHeight);
    const w = video.videoWidth * scale;
    const h = video.videoHeight * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.drawImage(video, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
    ctx.restore();
  } else {
    const radius = Math.min(r.w, r.h) * 0.16;
    ctx.fillStyle = '#3f3f46';
    ctx.beginPath();
    ctx.arc(r.x + r.w / 2, r.y + r.h / 2, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fafafa';
    ctx.font = `600 ${Math.round(radius)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((name.replace(/^@/, '')[0] ?? '?').toUpperCase(), r.x + r.w / 2, r.y + r.h / 2);
  }
  const label = name.length > 28 ? `${name.slice(0, 27)}…` : name;
  ctx.font = '500 14px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(label).width + 16;
  ctx.fillStyle = 'rgba(10,10,10,0.72)';
  ctx.fillRect(r.x + 8, r.y + r.h - 32, tw, 24);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, r.x + 16, r.y + r.h - 20);
}

/**
 * Records a huddle room in the browser: every tile is drawn onto one canvas and every
 * person's audio is mixed, then MediaRecorder writes a .webm that downloads on stop.
 * `getSources` is read on every frame, so people joining or leaving show up live.
 */
export function useRoomRecorder(getSources: () => RecordSource[]) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<{ stop: () => void } | null>(null);
  const sourcesRef = useRef(getSources);
  sourcesRef.current = getSources;

  const start = useCallback(async (fileName: string): Promise<boolean> => {
    if (sessionRef.current) return true;
    if (!canRecordInBrowser()) {
      setError('This browser cannot record. Try Chrome, Edge or Firefox on a computer.');
      return false;
    }
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setError('Recording could not start.');
      return false;
    }

    let audio: AudioContext | null = null;
    let dest: MediaStreamAudioDestinationNode | null = null;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        audio = new Ctx();
        dest = audio.createMediaStreamDestination();
      }
    } catch {
      audio = null; // record video only
      dest = null;
    }

    const videos = new Map<string, HTMLVideoElement>();
    const audioNodes = new Map<string, MediaStreamAudioSourceNode>();
    const videoFor = (s: MediaStream): HTMLVideoElement => {
      let v = videos.get(s.id);
      if (!v) {
        v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.srcObject = s;
        void v.play().catch(() => undefined);
        videos.set(s.id, v);
      }
      return v;
    };
    const mixAudio = (s: MediaStream) => {
      if (!audio || !dest || audioNodes.has(s.id) || s.getAudioTracks().length === 0) return;
      try {
        const node = audio.createMediaStreamSource(s);
        node.connect(dest);
        audioNodes.set(s.id, node);
      } catch {
        /* the stream ended between frames */
      }
    };

    const hasVideo = (s: RecordSource) => !!s.stream && s.stream.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled);
    const videoOf = (s: RecordSource) => (hasVideo(s) && s.stream ? videoFor(s.stream) : null);
    const draw = () => {
      const sources = sourcesRef.current();
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      for (const s of sources) if (s.stream) mixAudio(s.stream);
      const shared = sources.find((s) => s.screen && hasVideo(s));
      const cams = sources.filter((s) => !s.screen);
      if (shared) {
        const mainW = Math.round(WIDTH * 0.78);
        drawTile(ctx, videoOf(shared), shared.name, { x: 0, y: 0, w: mainW, h: HEIGHT }, 'contain');
        const strip = cams.slice(0, STRIP_MAX);
        columnLayout(strip.length, { x: mainW + GAP, y: 0, w: WIDTH - mainW - GAP, h: HEIGHT }).forEach((r, i) =>
          drawTile(ctx, videoOf(strip[i]), strip[i].name, r, 'cover'),
        );
      } else {
        gridLayout(cams.length, { x: 0, y: 0, w: WIDTH, h: HEIGHT }).forEach((r, i) => drawTile(ctx, videoOf(cams[i]), cams[i].name, r, 'cover'));
      }
    };

    const frameTimer = setInterval(draw, 1000 / FPS);
    draw();
    const out = new MediaStream([...canvas.captureStream(FPS).getVideoTracks(), ...(dest ? dest.stream.getAudioTracks() : [])]);
    const cleanup = () => {
      clearInterval(frameTimer);
      out.getTracks().forEach((t) => t.stop());
      videos.forEach((v) => {
        v.pause();
        v.srcObject = null;
      });
      audioNodes.forEach((n) => n.disconnect());
      void audio?.close().catch(() => undefined);
    };

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(out, mimeType ? { mimeType, videoBitsPerSecond: VIDEO_BITRATE } : undefined);
    } catch {
      cleanup();
      setError('Recording could not start in this browser.');
      return false;
    }

    const chunks: Blob[] = [];
    const startedAt = Date.now();
    const clock = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      clearInterval(clock);
      cleanup();
      const blob = new Blob(chunks, { type: mimeType ?? 'video/webm' });
      if (blob.size > 0) downloadBlob(blob, fileName);
      sessionRef.current = null;
      setRecording(false);
      setSeconds(0);
    };
    recorder.onerror = () => setError('Recording hit an error. What was recorded so far is saved.');

    let stopping = false;
    sessionRef.current = {
      stop: () => {
        if (stopping) return;
        stopping = true;
        if (recorder.state !== 'inactive') recorder.stop();
      },
    };
    recorder.start(1000);
    setError(null);
    setSeconds(0);
    setRecording(true);
    return true;
  }, []);

  const stop = useCallback(() => sessionRef.current?.stop(), []);
  const clearError = useCallback(() => setError(null), []);

  // Leaving the room or closing the page stops (and saves) the recording.
  useEffect(() => () => sessionRef.current?.stop(), []);

  return { recording, seconds, error, start, stop, clearError };
}
