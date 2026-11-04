/**
 * Records the README demo clips against a running server (Docker or npm start).
 * Every clip is a live run: Jev routes, Grok builds, then chat or voice operates
 * the result. The long generation wait is sped up; interaction plays at 1x.
 *
 *   BASE_URL=http://localhost:8080 node scripts/record.mjs [clip ...]
 *   clips: drums solar voice jev   (default: all)
 *
 * Needs ffmpeg on PATH. The voice clip feeds scripts/screens/rec/q-rate.wav
 * (make it with scripts/speak.ts) to Chrome as the microphone and records the
 * agent's spoken reply through a page hook, then muxes both into the mp4.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = join(HERE, 'screens', 'rec');
const OUT = resolve(HERE, '..', 'docs', 'media');
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1280, H = 720;

/** Timeline marks: each mark starts a segment at the given playback speed. */
function timeline() {
  const t0 = Date.now();
  const marks = [{ at: 0, speed: 1 }];
  return {
    t0,
    now: () => Date.now() - t0,
    speed(speed) { marks.push({ at: Date.now() - t0, speed }); },
    /** Speed up the segment since the last mark so it plays in about `seconds`. */
    fit(seconds) {
      const m = marks[marks.length - 1];
      m.speed = Math.max(1, (Date.now() - t0 - m.at) / 1000 / seconds);
    },
    segments(endMs) {
      const segs = [];
      for (let i = 0; i < marks.length; i++) {
        const s = marks[i].at, e = i + 1 < marks.length ? marks[i + 1].at : endMs;
        if (e - s > 50) segs.push({ s: s / 1000, e: e / 1000, speed: marks[i].speed });
      }
      return segs;
    },
  };
}

async function typeSlow(locator, text) {
  await locator.click();
  await locator.pressSequentially(text, { delay: 28 });
}

async function waitBuilt(page, timeout = 180000) {
  await page.locator('[aria-label="Design brief"]').waitFor({ timeout });
  await page.getByText('Rendering the interface').waitFor({ state: 'hidden', timeout });
}

async function chatAndWait(page, text, settleMs = 2500) {
  const before = (await page.locator('[role=log]').innerText()).length;
  await typeSlow(page.locator('#chat-input'), text);
  await page.locator('#chat-input').press('Enter');
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const busy = await page.getByLabel('Thinking').count();
    const len = (await page.locator('[role=log]').innerText()).length;
    if (!busy && len > before + text.length + 10) break;
  }
  await sleep(settleMs);
}

/** Build a 24 kHz mono WAV from timed PCM16 chunks (sequential playback, like the browser). */
function timedWav(chunks, totalMs, rate = 24000) {
  const total = Math.ceil((totalMs / 1000) * rate) + rate;
  const pcm = new Int16Array(total);
  let cursor = 0;
  for (const c of chunks) {
    const buf = Buffer.from(c.b64, 'base64');
    const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
    let pos = Math.max(Math.round((c.t / 1000) * rate), cursor);
    for (let i = 0; i < samples.length && pos < total; i++, pos++) pcm[pos] = samples[i];
    cursor = pos;
  }
  const data = Buffer.from(pcm.buffer);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function encode(name, webm, segs, { audio, posterAt } = {}) {
  const parts = [];
  const labels = [];
  segs.forEach((g, i) => {
    parts.push(`[0:v]trim=${g.s.toFixed(3)}:${g.e.toFixed(3)},setpts=(PTS-STARTPTS)/${g.speed},fps=30,scale=${W}:${H}[v${i}]`);
    if (audio) {
      if (g.speed === 1) parts.push(`[mix]asplit=1[m${i}];[m${i}]atrim=${g.s.toFixed(3)}:${g.e.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
      else parts.push(`anullsrc=channel_layout=mono:sample_rate=48000,atrim=duration=${((g.e - g.s) / g.speed).toFixed(3)}[a${i}]`);
      labels.push(`[v${i}][a${i}]`);
    } else labels.push(`[v${i}]`);
  });
  const args = ['-y', '-v', 'error', '-i', webm];
  let pre = '';
  if (audio) {
    args.push('-i', audio.agent);
    if (audio.mic) args.push('-i', audio.mic.file);
    pre = audio.mic
      ? `[1:a]aresample=48000,aformat=channel_layouts=mono[ag];[2:a]aresample=48000,aformat=channel_layouts=mono,adelay=${Math.round(audio.mic.atMs)}:all=1[mi];[ag][mi]amix=inputs=2:normalize=0:duration=longest[mixall];`
      : `[1:a]aresample=48000,aformat=channel_layouts=mono[mixall];`;
    // Each 1x audio segment trims the same full mix; split it once per segment.
    const n = segs.filter((g) => g.speed === 1).length || 1;
    pre += `[mixall]asplit=${n}${Array.from({ length: n }, (_, i) => `[mx${i}]`).join('')};`;
    let k = 0;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith('[mix]asplit=1')) parts[i] = parts[i].replace(/^\[mix\]asplit=1\[m(\d+)\];\[m\d+\]/, () => `[mx${k++}]`);
    }
  }
  const concat = `${labels.join('')}concat=n=${segs.length}:v=1:a=${audio ? 1 : 0}[v]${audio ? '[a]' : ''}`;
  const filter = pre + parts.join(';') + ';' + concat;
  const mp4 = join(OUT, `${name}.mp4`);
  args.push('-filter_complex', filter, '-map', '[v]');
  if (audio) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '128k');
  args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).toString().trim());
  const at = Math.min(posterAt ?? dur - 1.5, dur - 0.2);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', at.toFixed(2), '-i', mp4, '-frames:v', '1', join(OUT, `${name}.png`)]);
  console.log(`  -> ${mp4} (${dur.toFixed(1)} s, ${(statSync(mp4).size / 1e6).toFixed(2)} MB)`);
  return dur;
}

async function record(name, { micFile } = {}, body) {
  console.log(`\n[${name}]`);
  const args = ['--autoplay-policy=no-user-gesture-required'];
  if (micFile) args.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${micFile}%noloop`);
  const browser = await chromium.launch({ headless: true, args });
  const dir = join(WORK, name);
  mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir, size: { width: W, height: H } }, permissions: micFile ? ['microphone'] : [] });
  const tl = timeline();
  const page = await context.newPage();
  const agentAudio = [];
  let micAt = null;
  await page.exposeFunction('__voiceAudioTap', (b64) => agentAudio.push({ t: tl.now(), b64 }));
  await page.exposeFunction('__micOpened', () => { if (micAt === null) micAt = tl.now(); });
  await page.addInitScript(() => {
    const gum = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (gum) navigator.mediaDevices.getUserMedia = async (c) => { const s = await gum(c); window.__micOpened?.(); return s; };
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let opts = {};
  try {
    opts = (await body(page, tl)) || {};
  } finally {
    const endMs = tl.now();
    await context.close();
    await browser.close();
    const webm = readdirSync(dir).filter((f) => f.endsWith('.webm')).map((f) => join(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    const segs = tl.segments(endMs);
    let audio;
    if (agentAudio.length) {
      const agent = join(dir, 'agent.wav');
      writeFileSync(agent, timedWav(agentAudio, endMs));
      audio = { agent, ...(micFile && micAt !== null ? { mic: { file: micFile, atMs: micAt } } : {}) };
    }
    if (errors.length) console.log('  page errors:', errors.slice(0, 3));
    encode(name, webm, segs, { audio, posterAt: opts.posterAt });
    renameSync(webm, join(dir, 'raw.webm'));
  }
}

const CLIPS = {
  // Gallery card -> Jev route -> build -> chat drives the app's own actions.
  drums: () => record('drum-machine-chat', {}, async (page, tl) => {
    await page.goto(BASE);
    await sleep(1500);
    await page.getByRole('button', { name: /Drum machine/ }).hover();
    await sleep(600);
    await page.getByRole('button', { name: /Drum machine/ }).click();
    await page.getByText('Toolbox decision').waitFor({ timeout: 30000 });
    await sleep(2500);
    tl.speed(8);
    await waitBuilt(page);
    tl.speed(1);
    await sleep(3000);
    await chatAndWait(page, 'Pick the funkiest preset, set the tempo to 128 and start playing', 6000);
    await chatAndWait(page, 'Add claps on steps 2 and 4', 5000);
  }),

  // A 3D scene, operated by chat.
  solar: () => record('solar-system-chat', {}, async (page, tl) => {
    await page.goto(BASE);
    await sleep(1200);
    await page.getByRole('button', { name: /3D solar system/ }).click();
    await page.getByText('Toolbox decision').waitFor({ timeout: 30000 });
    await sleep(2000);
    tl.speed(8);
    await waitBuilt(page);
    // Bring the scene itself into view (the canvas is the point of this clip).
    await page.locator('main iframe').first().evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' }));
    tl.speed(1);
    await sleep(4000);
    await chatAndWait(page, 'Fly to Saturn', 6000);
    await chatAndWait(page, 'Speed time up ten times', 6000);
  }),

  // Spoken question -> act_ui sets the rate -> read_ui -> spoken answer.
  voice: () => record('voice-affordability', { micFile: join(WORK, 'q-rate.wav') }, async (page, tl) => {
    await page.goto(BASE);
    await sleep(1200);
    await page.getByRole('button', { name: /Home affordability/ }).click();
    await page.getByText('Toolbox decision').waitFor({ timeout: 30000 });
    await sleep(2000);
    tl.speed(8);
    await waitBuilt(page);
    tl.speed(1);
    await sleep(3000);
    await page.getByRole('button', { name: /Talk with Grok/ }).click();
    // Wait for the spoken question, the tool calls and the spoken answer to finish.
    const t0 = Date.now();
    let quietSince = Date.now(), lastLen = 0;
    while (Date.now() - t0 < 60000) {
      await sleep(500);
      const len = (await page.locator('[role=log]').innerText()).length;
      if (len !== lastLen) { lastLen = len; quietSince = Date.now(); }
      if (Date.now() - t0 > 15000 && Date.now() - quietSince > 6000) break;
    }
    await sleep(1500);
  }),

  // A vague prompt: Jev asks one question first, then routes and builds.
  jev: () => record('jev-asks-first', {}, async (page, tl) => {
    await page.goto(BASE);
    await sleep(1200);
    await typeSlow(page.getByRole('textbox', { name: /describe an interface/i }), 'a dashboard');
    await sleep(500);
    await page.getByRole('textbox', { name: /describe an interface/i }).press('Enter');
    await page.getByText('Toolbox decision').waitFor({ timeout: 30000 });
    await sleep(3500);
    const ask = page.locator('#jev-answer');
    if (await ask.count()) {
      await typeSlow(ask, 'a coffee shop owner tracking today’s sales, best sellers and low stock');
      await sleep(400);
      await ask.press('Enter');
      await sleep(3500);
    }
    tl.speed(8);
    await waitBuilt(page);
    tl.speed(1);
    await sleep(4000);
    await chatAndWait(page, 'How are sales tracking against plan today?', 4000);
  }),
};

/**
 * Short voice-controlled clip for one gallery example (about 15 s): click the
 * card, watch the live build timeline (the wait is compressed to ~3 s), then a
 * spoken command operates the result and the agent answers aloud.
 * The command is scripts/screens/rec/v-<id>.wav (make it with scripts/speak.ts).
 */
async function waitVoiceDone(page, minMs, capMs = 26000) {
  const t0 = Date.now();
  let quietSince = Date.now(), lastLen = 0;
  while (Date.now() - t0 < capMs) {
    await sleep(400);
    const len = (await page.locator('[role=log]').innerText()).length;
    if (len !== lastLen) { lastLen = len; quietSince = Date.now(); }
    if (Date.now() - t0 > minMs && Date.now() - quietSince > 2800) break;
  }
}

const VOICE_EXAMPLES = {
  trading: { card: /Trading terminal/ },
  solar: { card: /3D solar system/, scrollToFrame: true },
  drums: { card: /Drum machine/, scrollToFrame: true },
  mortgage: { card: /Home affordability/ },
  incidents: { card: /Incident console/ },
  snake: { card: /Snake/, scrollToFrame: true },
};

for (const [id, ex] of Object.entries(VOICE_EXAMPLES)) {
  CLIPS[`voice-${id}`] = () => record(`voice-${id}`, { micFile: join(WORK, `v-${id}.wav`) }, async (page, tl) => {
    await page.goto(BASE);
    await sleep(900);
    await page.getByRole('button', { name: ex.card }).click();
    tl.speed(10);
    await waitBuilt(page);
    tl.fit(3.5);
    if (ex.scrollToFrame && await page.locator('main iframe').count()) {
      await page.locator('main iframe').first().evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70 }));
    }
    tl.speed(1);
    await sleep(900);
    await page.getByRole('button', { name: /Talk with Grok/ }).click();
    await waitVoiceDone(page, 7500);
    await sleep(700);
    return { posterAt: undefined };
  });
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CLIPS).filter((k) => !k.startsWith('voice-'));
for (const k of wanted) {
  if (!CLIPS[k]) { console.error(`unknown clip ${k}`); continue; }
  if (k === 'voice' && !existsSync(join(WORK, 'q-rate.wav'))) { console.error('missing q-rate.wav — run scripts/speak.ts first'); continue; }
  if (k.startsWith('voice-') && !existsSync(join(WORK, `v-${k.slice(6)}.wav`))) { console.error(`missing v-${k.slice(6)}.wav — run scripts/speak.ts first`); continue; }
  await CLIPS[k]();
}
