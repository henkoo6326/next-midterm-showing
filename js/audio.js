/* 쇼잉 오디오 관리자 (ES module, named export만)
 *
 * 목록: assets/audio/manifest.json
 *   { "<name>": { "file": "assets/audio/...", "channel": "sfx|voice", "speaker": "...", "text": "...",
 *                 "source": "...", "durationMs": n, "available": true|false } }
 * - voice 채널은 한 번에 하나만 재생한다. 재생 중 들어온 음성은 큐에 넣고 순서대로 재생한다.
 * - sfx 채널은 겹쳐 재생할 수 있다. 같은 이름이 재생 중이면 다시 재생하지 않는다.
 * - 파일이 없거나 available:false 이거나 재생에 실패하면 소리 없이 자막만 내보내고 durationMs 만큼 기다린다.
 * - manifest 를 읽지 못하면 빈 목록으로 동작한다(play 는 바로 resolve).
 * - stop/stopAll 로 끊긴 재생은 promise 만 resolve 하고 onEnd 는 부르지 않는다.
 * - 음소거 상태에서도 자막과 대기 시간은 그대로 진행한다(장면 타이밍이 바뀌지 않게).
 *
 * 사용 예
 *   import * as audio from './audio.js';
 *   button.onclick = async () => { await audio.unlock(); await audio.play('sfx-ev-start'); };
 *   audio.onCaption(c => { c ? show(c.speaker, c.text, c.source) : hide(); });
 *   await audio.play('voice-v1');   // 재생 끝(또는 자막 대기 끝)에 resolve
 */

const MANIFEST_URL = new URL('../assets/audio/manifest.json', import.meta.url);
const SITE_ROOT = new URL('../', import.meta.url);
const DEFAULT_DURATION = 1500;

let manifest = {};
let loaded = null;
let muted = false;
let unlocked = false;
let ctx = null;
const captionListeners = new Set();

const sfxPlaying = new Map();      // name -> { audio, timer, resolve }
const voiceQueue = [];             // { name, opts, resolve }
let voiceCurrent = null;           // { name, audio, timer, resolve, onEnd }

function load() {
  if (!loaded) {
    loaded = fetch(MANIFEST_URL, { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : {}))
      .then(json => { manifest = json && typeof json === 'object' ? json : {}; return manifest; })
      .catch(() => { manifest = {}; return manifest; });
  }
  return loaded;
}
load();

export function ready() { return load(); }

export async function unlock() {
  await load();
  if (unlocked) return true;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      ctx = ctx || new AC();
      if (ctx.state === 'suspended') await ctx.resume();
      const buffer = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
    }
    // HTMLAudio 경로도 사용자 제스처 안에서 한 번 깨운다
    const silent = new Audio();
    silent.muted = true;
    silent.play?.().catch(() => {});
    unlocked = true;
  } catch {
    unlocked = true;
  }
  return unlocked;
}

export function has(name) {
  const item = manifest[name];
  return !!(item && item.available && item.file);
}

export function caption(name) {
  const item = manifest[name];
  if (!item) return null;
  return {
    name,
    speaker: item.speaker || '',
    text: item.text || '',
    source: item.source || '',
    durationMs: Number(item.durationMs) || DEFAULT_DURATION,
    channel: item.channel || 'sfx',
  };
}

export function onCaption(fn) {
  captionListeners.add(fn);
  return () => captionListeners.delete(fn);
}

function emitCaption(value) {
  for (const fn of captionListeners) {
    try { fn(value); } catch (err) { console.error(err); }
  }
}

export function setMuted(value) {
  muted = !!value;
  if (voiceCurrent?.audio) voiceCurrent.audio.muted = muted;
  for (const entry of sfxPlaying.values()) if (entry.audio) entry.audio.muted = muted;
}

export function isMuted() { return muted; }

/* 파일 재생 또는 자막 길이 대기. 끝나면 resolve. 중간에 stop 되면 그 시점에 resolve */
function run(name, entry) {
  const item = manifest[name];
  const duration = Number(item?.durationMs) || DEFAULT_DURATION;
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(entry.timer);
      if (entry.audio) { entry.audio.onended = entry.audio.onerror = null; }
      resolve();
    };
    entry.finish = finish;
    const fallback = () => { clearTimeout(entry.timer); entry.timer = setTimeout(finish, duration); };
    if (item && item.available && item.file) {
      const audio = new Audio(new URL(item.file, SITE_ROOT).href);
      audio.preload = 'auto';
      audio.muted = muted;
      entry.audio = audio;
      audio.onended = finish;
      audio.onerror = () => { entry.audio = null; fallback(); };
      // 재생 실패(자동재생 정책 등) 시에도 장면은 durationMs 로 이어진다. 안전장치로 duration+4s 상한
      entry.timer = setTimeout(finish, duration + 4000);
      audio.play().catch(() => { try { audio.pause(); } catch { /* noop */ } entry.audio = null; fallback(); });
    } else {
      fallback();
    }
  });
}

function startNextVoice() {
  if (voiceCurrent || !voiceQueue.length) return;
  const job = voiceQueue.shift();
  const entry = { name: job.name, audio: null, timer: null, finish: null };
  voiceCurrent = entry;
  const cap = caption(job.name);
  if (cap) emitCaption(cap);
  run(job.name, entry).then(() => {
    if (voiceCurrent === entry) voiceCurrent = null;
    if (entry.audio) { try { entry.audio.pause(); } catch { /* noop */ } }
    emitCaption(null);
    if (!entry.stopped) { try { job.opts.onEnd?.(); } catch (err) { console.error(err); } }
    job.resolve();
    startNextVoice();
  });
}

export async function play(name, opts = {}) {
  await load();
  const item = manifest[name];
  if (!item) {
    // 목록에 없는 이름: 소리·자막 없이 바로 끝낸다
    try { opts.onEnd?.(); } catch (err) { console.error(err); }
    return;
  }
  const channel = opts.channel || item.channel || 'sfx';
  if (channel === 'voice') {
    return new Promise(resolve => {
      voiceQueue.push({ name, opts, resolve });
      startNextVoice();
    });
  }
  // sfx: 같은 이름 중복 재생 방지
  const running = sfxPlaying.get(name);
  if (running) return running.promise;
  const entry = { name, audio: null, timer: null, finish: null, promise: null };
  entry.promise = run(name, entry).then(() => {
    if (sfxPlaying.get(name) === entry) sfxPlaying.delete(name);
    if (entry.audio) { try { entry.audio.pause(); } catch { /* noop */ } }
    if (!entry.stopped) { try { opts.onEnd?.(); } catch (err) { console.error(err); } }
  });
  sfxPlaying.set(name, entry);
  return entry.promise;
}

export function stop(channel) {
  if (!channel || channel === 'voice') {
    // 큐에 남은 음성은 재생하지 않고 바로 끝낸다(대기 중인 await 가 풀리도록 resolve)
    const pending = voiceQueue.splice(0);
    if (voiceCurrent) {
      const entry = voiceCurrent;
      entry.stopped = true;
      if (entry.audio) { try { entry.audio.pause(); } catch { /* noop */ } }
      entry.finish?.();
    }
    for (const job of pending) job.resolve();
    emitCaption(null);
  }
  if (!channel || channel === 'sfx') {
    for (const entry of [...sfxPlaying.values()]) {
      entry.stopped = true;
      if (entry.audio) { try { entry.audio.pause(); } catch { /* noop */ } }
      entry.finish?.();
    }
    sfxPlaying.clear();
  }
}

export function stopAll() { stop(); }

/* 내보낸 목록(읽기 전용 사본) */
export function list() { return JSON.parse(JSON.stringify(manifest)); }
