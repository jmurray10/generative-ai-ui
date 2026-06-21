/**
 * Browser audio for the Gemini Live voice session.
 *  - MicStreamer captures the mic as 16-bit PCM @ 16 kHz (Live API input format)
 *    and emits base64 chunks.
 *  - AudioPlayer queues/plays 16-bit PCM @ 24 kHz chunks (Live API output) and
 *    supports barge-in (clear()).
 */

function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate >= inRate) return input;
  const ratio = inRate / outRate;
  const len = Math.floor(input.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = input[Math.floor(i * ratio)];
  return out;
}

function floatToPCM16(f32: Float32Array): Int16Array {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function base64FromBytes(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}

function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 2));
}

export class MicStreamer {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private node?: ScriptProcessorNode;
  private source?: MediaStreamAudioSourceNode;

  async start(onChunk: (b64: string) => void): Promise<void> {
    this.ctx = new AudioContext({ sampleRate: 16000 });
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    const rate = this.ctx.sampleRate;
    this.node.onaudioprocess = (e) => {
      const ds = downsample(e.inputBuffer.getChannelData(0), rate, 16000);
      onChunk(base64FromBytes(new Uint8Array(floatToPCM16(ds).buffer)));
    };
    const mute = this.ctx.createGain();
    mute.gain.value = 0; // keep onaudioprocess firing without echoing to speakers
    this.source.connect(this.node);
    this.node.connect(mute);
    mute.connect(this.ctx.destination);
  }

  stop(): void {
    try { this.node?.disconnect(); } catch { /* */ }
    try { this.source?.disconnect(); } catch { /* */ }
    try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    try { this.ctx?.close(); } catch { /* */ }
  }
}

export class AudioPlayer {
  private ctx = new AudioContext({ sampleRate: 24000 });
  private nextTime = 0;
  private sources: AudioBufferSourceNode[] = [];

  resume(): void {
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  play(b64: string): void {
    const i16 = base64ToInt16(b64);
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
    const buf = this.ctx.createBuffer(1, f32.length, 24000);
    buf.getChannelData(0).set(f32);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    const t = Math.max(this.ctx.currentTime, this.nextTime);
    src.start(t);
    this.nextTime = t + buf.duration;
    this.sources.push(src);
    src.onended = () => { this.sources = this.sources.filter((s) => s !== src); };
  }

  clear(): void {
    this.sources.forEach((s) => { try { s.stop(); } catch { /* */ } });
    this.sources = [];
    this.nextTime = this.ctx.currentTime;
  }

  close(): void {
    this.clear();
    try { this.ctx.close(); } catch { /* */ }
  }
}
