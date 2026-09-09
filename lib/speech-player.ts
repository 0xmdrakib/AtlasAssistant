import { speechChunk, speechTimeline, wordAtCharacter, wordAtTime, type SpeechTimeline } from "@/lib/speech-timeline";

export type SpeechTrack = { id: string; text: string; lang: string };
export type SpeechRate = 1 | 2 | 3;
export type SpeechState = {
  supported: boolean; track: SpeechTrack | null;
  status: "idle" | "loading" | "playing" | "paused" | "ended" | "error";
  position: number; duration: number; rate: SpeechRate; error: string;
};
export type SpeechEnvironment = { synth: SpeechSynthesis; utterance: (text: string) => SpeechSynthesisUtterance; now: () => number };
export const EMPTY_SPEECH: SpeechState = { supported: false, track: null, status: "idle", position: 0, duration: 0, rate: 1, error: "" };

function browserEnvironment(): SpeechEnvironment | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return null;
  return { synth: window.speechSynthesis, utterance: (text) => new SpeechSynthesisUtterance(text), now: () => performance.now() };
}

export class SpeechPlayer {
  private state: SpeechState = EMPTY_SPEECH;
  private listeners = new Set<() => void>();
  private env: SpeechEnvironment | null = null;
  private timeline: SpeechTimeline | null = null;
  private current: SpeechSynthesisUtterance | null = null;
  private generation = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private startup: ReturnType<typeof setTimeout> | null = null;
  private anchor = { position: 0, at: 0, end: 0 };

  constructor(private environment = browserEnvironment) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  initialize = () => { this.env = this.environment(); this.set({ supported: Boolean(this.env) }); };
  private set(patch: Partial<SpeechState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener()); }
  private clearTimers() {
    if (this.interval !== null) clearInterval(this.interval);
    if (this.startup !== null) clearTimeout(this.startup);
    this.interval = null; this.startup = null;
  }
  private cancel() {
    this.generation++; this.current = null; this.clearTimers();
    try {
      this.env?.synth.cancel();
      // cancel() does not clear the global synthesis paused state.
      if (this.env?.synth.paused) this.env.synth.resume();
    } catch { /* Closing must always reset local playback, including on errors. */ }
  }
  close = () => { this.cancel(); this.timeline = null; this.set({ ...EMPTY_SPEECH, supported: Boolean(this.env) }); };
  stopTrack = (id: string) => { if (this.state.track?.id === id) this.close(); };
  start = (track: SpeechTrack) => {
    if (!this.env) this.initialize();
    if (!this.env) return;
    const timeline = speechTimeline(track.text, track.lang);
    if (!timeline.words.length) return;
    this.cancel(); this.timeline = timeline;
    this.set({ track: { ...track, text: timeline.text }, duration: timeline.duration, position: 0, rate: 1, error: "" });
    this.playWord(0);
  };

  private tick = () => {
    if (this.state.status !== "playing" || !this.env) return;
    const position = Math.min(this.anchor.end, this.anchor.position + Math.max(0, this.env.now() - this.anchor.at) / 1000 * this.state.rate);
    this.set({ position });
  };
  private beginClock() {
    if (!this.env) return;
    this.clearTimers();
    this.anchor.position = this.state.position; this.anchor.at = this.env.now();
    this.interval = setInterval(this.tick, 250);
  }
  private fail(message: string) { this.cancel(); this.set({ status: "error", error: message }); }
  private playWord(first: number) {
    if (!this.timeline || !this.env || !this.state.track) return;
    const chunk = speechChunk(this.timeline, first);
    const utterance = this.env.utterance(chunk.text);
    const generation = this.generation;
    const valid = () => this.generation === generation && this.current === utterance;
    this.current = utterance;
    utterance.lang = this.state.track.lang || "en-US"; utterance.rate = this.state.rate;
    const voices = this.env.synth.getVoices?.() || [];
    const voice = voices.find((voice) => voice.lang.toLowerCase() === utterance.lang.toLowerCase());
    if (voice) utterance.voice = voice;
    this.anchor.end = chunk.endTime;
    this.set({ status: "loading", position: this.timeline.words[first].time, error: "" });
    utterance.onstart = () => {
      if (!valid() || this.state.status === "paused") return;
      this.set({ status: "playing" }); this.beginClock();
    };
    utterance.onboundary = (event) => {
      if (!valid() || this.state.status !== "playing" || !this.timeline || !this.env) return;
      const index = wordAtCharacter(this.timeline, chunk.start + event.charIndex);
      const position = this.timeline.words[index].time;
      this.anchor = { position, at: this.env.now(), end: chunk.endTime };
      this.set({ position });
    };
    utterance.onpause = () => {
      if (!valid() || this.state.status === "paused") return;
      this.tick(); this.clearTimers(); this.set({ status: "paused" });
    };
    utterance.onresume = () => { if (valid()) { this.set({ status: "playing" }); this.beginClock(); } };
    utterance.onend = () => {
      if (!valid()) return;
      this.current = null; this.clearTimers();
      // Some engines cancel the utterance when asked to pause. Resume rebuilds it.
      if (this.state.status === "paused") return;
      if (this.timeline && chunk.next < this.timeline.words.length) this.playWord(chunk.next);
      else this.set({ status: "ended", position: this.state.duration });
    };
    utterance.onerror = (event) => {
      if (!valid()) return;
      if (this.state.status === "paused" && ["canceled", "interrupted"].includes(event.error)) { this.current = null; return; }
      const message = ["language-unavailable", "voice-unavailable"].includes(event.error)
        ? "This browser has no voice available for this language."
        : event.error === "not-allowed" ? "Press play to allow audio in this browser." : "Audio could not play. Press play to try again.";
      this.fail(message);
    };
    this.startup = setTimeout(() => { if (valid() && this.state.status === "loading") this.fail("The browser voice did not start. Press play to try again."); }, 12000);
    try { this.env.synth.speak(utterance); } catch { this.fail("Audio could not play. Press play to try again."); }
  }

  toggle = () => {
    if (!this.state.track || !this.env || !this.timeline) return;
    if (this.state.status === "loading") { this.cancel(); this.set({ status: "paused" }); return; }
    if (this.state.status === "playing") {
      this.tick(); this.clearTimers(); this.set({ status: "paused" });
      try {
        this.env.synth.pause();
        if (!this.env.synth.speaking && !this.env.synth.paused) this.cancel();
      } catch { this.cancel(); }
    } else if (this.state.status === "paused" && this.current && (this.env.synth.paused || this.env.synth.speaking)) {
      try { this.set({ status: "playing" }); this.beginClock(); this.env.synth.resume(); }
      catch { this.seek(this.state.position, true); }
    } else this.seek(this.state.status === "ended" ? 0 : this.state.position, true);
  };

  seek = (time: number, play = this.state.status === "playing" || this.state.status === "loading") => {
    if (!this.timeline || !this.state.track || !Number.isFinite(time)) return;
    this.cancel();
    if (time >= this.state.duration) { this.set({ position: this.state.duration, status: "ended", error: "" }); return; }
    const word = wordAtTime(this.timeline, Math.max(0, time));
    this.set({ position: this.timeline.words[word].time, status: "paused", error: "" });
    if (play) this.playWord(word);
  };
  skip = (seconds: number) => { this.tick(); this.seek(this.state.position + seconds); };
  setRate = (rate: SpeechRate) => {
    if (![1, 2, 3].includes(rate) || rate === this.state.rate) return;
    this.tick(); this.set({ rate });
    if (this.state.track && this.state.status !== "ended") this.seek(this.state.position);
  };
}
