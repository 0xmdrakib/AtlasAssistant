import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { SpeechPlayer, type SpeechEnvironment } from "../lib/speech-player";
import { formatSpeechTime, speechChunk, speechTimeline, wordAtTime } from "../lib/speech-timeline";

const story = "The morning news brings fresh research and thoughtful reporting. ".repeat(15);
function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let now = 0;
  const spoken: SpeechSynthesisUtterance[] = [];
  const synth = {
    paused: false, speaking: false,
    speak(u: SpeechSynthesisUtterance) { spoken.push(u); this.speaking = true; u.onstart?.({} as SpeechSynthesisEvent); },
    cancel() { this.speaking = false; },
    pause() { this.paused = true; }, resume() { this.paused = false; }, getVoices() { return []; },
  };
  const player = new SpeechPlayer(() => ({ synth, now: () => now, utterance: (text: string) => ({ text }) }) as unknown as SpeechEnvironment);
  player.initialize();
  return { player, synth, spoken, flush: () => t.mock.timers.tick(100), advance: (ms: number) => { now += ms; }, start: () => player.start({ id: "one", text: story, lang: "en-US" }) };
}

test("pause freezes position; resume continues; approximate skips land on complete words", (t) => {
  const f = fixture(t);
  try {
    f.start(); f.advance(3000); f.player.toggle(); f.flush();
    assert.equal(f.player.getSnapshot().status, "paused");
    assert.equal(f.player.getSnapshot().position, 3);
    f.advance(20000); f.player.toggle(); f.flush(); f.advance(1000); f.player.toggle(); f.flush();
    assert.ok(f.player.getSnapshot().position <= 4 && f.player.getSnapshot().position > 3, "Resume starts at the saved word; paused time cannot advance playback");
    f.player.skip(10);
    const afterSkip = f.player.getSnapshot();
    assert.equal(afterSkip.status, "paused");
    assert.ok(afterSkip.position <= 14 && afterSkip.position > 13);
    f.player.toggle(); f.flush();
    const timeline = speechTimeline(story, "en-US");
    const word = timeline.words[wordAtTime(timeline, afterSkip.position)];
    assert.ok(timeline.text.slice(word.start).startsWith(f.spoken.at(-1)!.text));
    f.player.skip(-10);
    assert.ok(Math.abs(f.player.getSnapshot().position - (afterSkip.position - 10)) < 1, "Each skip is within one spoken word of the estimate");
  } finally { f.player.close(); }
});

test("rate changes preserve position, replace active speech, and keep paused speech paused", (t) => {
  const f = fixture(t);
  try {
    f.start(); f.advance(2000); f.player.setRate(2); f.flush();
    assert.equal(f.spoken.at(-1)!.rate, 2);
    const start = f.player.getSnapshot().position;
    f.advance(1000); f.player.toggle(); f.flush();
    assert.equal(f.player.getSnapshot().position, start + 2);
    const count = f.spoken.length;
    f.player.setRate(3);
    assert.equal(f.spoken.length, count, "Changing rate while paused cannot start audio");
    f.player.toggle(); f.flush(); assert.equal(f.spoken.at(-1)!.rate, 3);
  } finally { f.player.close(); }
});

test("late canceled utterance events cannot change a replacement track; close resets everything", (t) => {
  const f = fixture(t);
  try {
    f.start(); const old = f.spoken[0];
    f.player.setRate(3); f.player.start({ id: "two", text: "A new story.", lang: "en" }); f.flush();
    old.onend?.({} as SpeechSynthesisEvent);
    old.onerror?.({ error: "interrupted" } as SpeechSynthesisErrorEvent);
    assert.equal(f.player.getSnapshot().track?.id, "two");
    assert.equal(f.player.getSnapshot().rate, 1);
    f.player.stopTrack("one"); assert.equal(f.player.getSnapshot().track?.id, "two");
    f.player.close(); assert.equal(f.player.getSnapshot().track, null);
    assert.equal(f.player.getSnapshot().position, 0); assert.equal(f.player.getSnapshot().rate, 1);
    f.start(); f.flush(); assert.equal(f.player.getSnapshot().position, 0); assert.equal(f.spoken.at(-1)!.text, f.spoken[0].text);
  } finally { f.player.close(); }
});

test("engines that cancel on pause resume from the same word", (t) => {
  const f = fixture(t);
  try {
    f.synth.pause = function () { this.speaking = false; this.paused = false; f.spoken.at(-1)!.onend?.({} as SpeechSynthesisEvent); };
    f.start(); f.advance(2000); f.player.toggle(); f.flush();
    assert.equal(f.player.getSnapshot().status, "paused");
    f.player.toggle(); f.flush(); assert.equal(f.player.getSnapshot().status, "playing");
    assert.equal(f.spoken.length, 2); assert.ok(f.player.getSnapshot().position > 1);
  } finally { f.player.close(); }
});

test("long stories advance through short chunks, finish once, and replay from the beginning", (t) => {
  const f = fixture(t);
  try {
    f.start(); let count = 0;
    while (f.player.getSnapshot().status !== "ended") {
      assert.ok(count++ < 30); f.spoken.at(-1)!.onend?.({} as SpeechSynthesisEvent);
    }
    assert.ok(f.spoken.length > 1);
    assert.equal(f.spoken.map((u) => u.text).join(" "), story.trim());
    assert.equal(f.player.getSnapshot().position, f.player.getSnapshot().duration);
    f.player.toggle(); f.flush(); assert.equal(f.player.getSnapshot().position, 0);
  } finally { f.player.close(); }
});

test("word boundary feedback corrects estimates; voice errors remain retryable", (t) => {
  const f = fixture(t);
  try {
    f.start(); f.spoken.at(-1)!.onboundary?.({ charIndex: 17 } as SpeechSynthesisEvent);
    assert.ok(f.player.getSnapshot().position > 0);
    f.spoken.at(-1)!.onerror?.({ error: "not-allowed" } as SpeechSynthesisErrorEvent);
    assert.equal(f.player.getSnapshot().status, "error"); assert.match(f.player.getSnapshot().error, /Press play/);
    f.player.toggle(); f.flush(); assert.equal(f.player.getSnapshot().status, "playing"); assert.equal(f.player.getSnapshot().error, "");
  } finally { f.player.close(); }
});

test("Unicode segmentation preserves Bengali words and unsupported browsers stay idle", (t) => {
  const timeline = speechTimeline("আজকের সংবাদ। পৃথিবীর নতুন আবিষ্কার নিয়ে আলোচনা।", "bn");
  assert.ok(timeline.words.length > 5); assert.ok(timeline.duration > 0);
  assert.equal(speechChunk(timeline, 0).text, timeline.text);
  assert.equal(formatSpeechTime(107), "1:47"); assert.equal(formatSpeechTime(NaN), "0:00");
  const player = new SpeechPlayer(() => null);
  player.start({ id: "no", text: story, lang: "en" }); assert.equal(player.getSnapshot().supported, false); assert.equal(player.getSnapshot().track, null);
});

test("rapid pause, seek and rate changes start only the final request; closing cancels a scheduled restart", (t) => {
  const f = fixture(t);
  try {
    f.start(); f.advance(2000); f.player.toggle();
    f.player.skip(10); f.player.setRate(2); f.player.toggle();
    f.player.skip(10); f.player.setRate(3);
    assert.equal(f.spoken.length, 1, "Replacements wait for the previous cancellation");
    assert.equal(f.player.getSnapshot().status, "loading", "A queued request is not yet playing");
    f.flush(); assert.equal(f.spoken.length, 2); assert.equal(f.spoken[1].rate, 3);
    assert.equal(f.player.getSnapshot().status, "playing");
    f.player.skip(-10); f.player.close(); f.flush();
    assert.equal(f.spoken.length, 2, "Closed audio cannot restart later");
    assert.equal(f.player.getSnapshot().track, null);
  } finally { f.player.close(); }
});

test("pause/resume stays usable even if the engine's native resume is broken", (t) => {
  const f = fixture(t);
  try {
    f.synth.pause = function () { this.paused = true; this.speaking = false; };
    f.synth.resume = function () { /* Simulate a native engine that cannot resume a paused utterance. */ };
    f.start(); f.advance(2000); f.player.toggle();
    assert.equal(f.synth.speaking, false);
    f.player.toggle(); f.flush();
    assert.equal(f.synth.paused, false);
    assert.equal(f.synth.speaking, true, "Resume uses a fresh speaking request");
    assert.equal(f.player.getSnapshot().status, "playing");
  } finally { f.player.close(); }
});

test("a stopped engine cannot leave an endlessly advancing playback clock", (t) => {
  const f = fixture(t);
  try {
    f.start(); f.advance(2000); f.flush();
    const before = f.player.getSnapshot().position;
    f.synth.speaking = false;
    f.advance(1000); t.mock.timers.tick(250);
    f.advance(1500); t.mock.timers.tick(250);
    assert.equal(f.player.getSnapshot().status, "error");
    assert.equal(f.player.getSnapshot().position, before);
    f.player.toggle(); f.flush(); assert.equal(f.player.getSnapshot().status, "playing");
  } finally { f.player.close(); }
});
