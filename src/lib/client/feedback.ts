"use client";
/** Haptic + optional audio feedback. Audio is synthesized (no asset downloads on event Wi-Fi). */
let ctx: AudioContext | null = null;

const SOUND_KEY = "swag.sound";
export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}
export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

function tone(freq: number, start: number, dur: number) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.05);
}

/** Must be called from a user gesture once (iOS) to unlock audio. */
export function unlockAudio() {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* no audio */
  }
}

export function feedback(kind: "good" | "bad" | "warn" | "scan") {
  const pattern = { good: [60], bad: [200, 80, 200, 80, 200], warn: [120, 60, 120], scan: [25] }[kind];
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported (iOS Safari) */
  }
  if (!soundEnabled()) return;
  unlockAudio();
  if (kind === "good") {
    tone(880, 0, 0.12);
    tone(1320, 0.12, 0.18);
  } else if (kind === "bad") {
    tone(220, 0, 0.25);
    tone(180, 0.28, 0.35);
  } else if (kind === "warn") {
    tone(440, 0, 0.15);
    tone(440, 0.2, 0.15);
  } else tone(1000, 0, 0.05);
}
