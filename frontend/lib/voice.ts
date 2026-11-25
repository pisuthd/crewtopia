'use client';

// Browser mic capture for voice input: records up to 60s, downsamples to
// 24kHz mono 16-bit WAV (the shape the VM ASR proxy expects). Live mic level
// + elapsed callbacks drive the VoiceModal UI. Abort 'stop' resolves partial
// audio; any other abort reason rejects (unmount/cancel).

export const MAX_VOICE_MS = 60_000;

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const wstr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  wstr(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  wstr(8, 'WAVE');
  wstr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  wstr(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export async function recordWav24k(
  opts: { onLevel?: (level: number) => void; onTick?: (ms: number) => void },
  signal?: AbortSignal,
): Promise<Blob> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const startedAt = Date.now();
  // Live level meter: an analyser observing the same stream (recording itself
  // goes through MediaRecorder; the analyser never touches the bytes).
  let actx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let meterTimer: ReturnType<typeof setInterval> | null = null;
  try {
    actx = new AudioContext();
    const src = actx.createMediaStreamSource(stream);
    analyser = actx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    meterTimer = setInterval(() => {
      if (!analyser) return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const d = (data[i] - 128) / 128;
        sum += d * d;
      }
      opts.onLevel?.(Math.min(1, Math.sqrt(sum / data.length) * 3));
      opts.onTick?.(Date.now() - startedAt);
    }, 100);
  } catch {
    // Meter is decoration — recording proceeds without it.
  }

  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const cleanup = () => {
    if (meterTimer) clearInterval(meterTimer);
    stream.getTracks().forEach((t) => t.stop());
    if (actx) void actx.close().catch(() => {});
  };
  let timer: ReturnType<typeof setTimeout>;
  const raw = new Promise<Blob>((resolve, reject) => {
    rec.onstop = () => {
      clearTimeout(timer);
      cleanup();
      resolve(new Blob(chunks));
    };
    rec.onerror = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error('recording failed'));
    };
  });
  rec.start();
  const stop = () => {
    try {
      rec.state !== 'inactive' && rec.stop();
    } catch { /* already stopped */ }
  };
  timer = setTimeout(stop, MAX_VOICE_MS);
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      cleanup();
      throw new DOMException('cancel', 'AbortError');
    }
    // Any abort stops capture (raw resolves); non-'stop' reasons reject below.
    signal.addEventListener('abort', stop, { once: true });
  }
  const webm = await raw;
  if (signal && signal.aborted && signal.reason !== 'stop') {
    throw new DOMException('cancel', 'AbortError');
  }
  const ac = new AudioContext();
  try {
    const decoded = await ac.decodeAudioData(await webm.arrayBuffer());
    const targetLen = Math.floor((decoded.length / decoded.sampleRate) * 24000);
    const out = new Float32Array(targetLen);
    const ch0 = decoded.getChannelData(0);
    const ch1 = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : ch0;
    for (let i = 0; i < targetLen; i++) {
      const src = Math.min(decoded.length - 1, Math.floor((i / targetLen) * decoded.length));
      out[i] = (ch0[src] + ch1[src]) / 2;
    }
    return encodeWav(out, 24000);
  } finally {
    void ac.close().catch(() => {});
  }
}
