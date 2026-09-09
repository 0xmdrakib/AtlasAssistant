export type SpeechWord = { start: number; end: number; time: number };
export type SpeechTimeline = { text: string; words: SpeechWord[]; duration: number };

// Web Speech exposes word boundaries, but no audio duration or seek API.
// Keep estimates on a 1x timeline and seek only to complete word boundaries.
export function speechTimeline(input: string, lang: string): SpeechTimeline {
  const text = input.replace(/\s+/g, " ").trim();
  let segments: { index: number; segment: string }[];
  try {
    segments = [...new Intl.Segmenter(lang || "en", { granularity: "word" }).segment(text)].filter((part) => part.isWordLike);
  } catch {
    segments = [...text.matchAll(/\S+/gu)].map((part) => ({ index: part.index!, segment: part[0] }));
  }
  let duration = 0;
  const words = segments.map((part, index) => {
    const word = { start: part.index, end: part.index + part.segment.length, time: duration };
    const gap = text.slice(word.end, segments[index + 1]?.index ?? text.length);
    const characters = [...part.segment].length;
    duration += 0.34 + Math.max(0, characters - 6) * 0.025 + (/[.!?。！？।]/u.test(gap) ? 0.22 : /[,;:，；：]/u.test(gap) ? 0.1 : 0);
    return word;
  });
  return { text, words, duration };
}

export function wordAtTime(timeline: SpeechTimeline, time: number): number {
  let low = 0, high = timeline.words.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (timeline.words[mid].time <= time) low = mid + 1; else high = mid;
  }
  return Math.max(0, low - 1);
}

export function wordAtCharacter(timeline: SpeechTimeline, character: number): number {
  let low = 0, high = timeline.words.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (timeline.words[mid].start <= character) low = mid + 1; else high = mid;
  }
  return Math.max(0, low - 1);
}

export function speechChunk(timeline: SpeechTimeline, first: number) {
  const start = timeline.words[first].start;
  let next = first + 1;
  // Short, sentence-aware utterances also keep long news/digests manageable
  // for browser voices that struggle with a single large utterance.
  while (next < timeline.words.length) {
    const length = timeline.words[next].start - start;
    const gap = timeline.text.slice(timeline.words[next - 1].end, timeline.words[next].start);
    if (length >= 220 || (length >= 80 && /[.!?。！？।]/u.test(gap))) break;
    next++;
  }
  return { start, next, text: timeline.text.slice(start, timeline.words[next]?.start ?? timeline.text.length).trim(), endTime: timeline.words[next]?.time ?? timeline.duration };
}

export function formatSpeechTime(seconds: number) {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
