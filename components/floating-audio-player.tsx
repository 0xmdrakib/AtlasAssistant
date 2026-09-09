"use client";

import * as React from "react";
import { Loader2, Pause, Play, RotateCcw, RotateCw, X } from "lucide-react";
import { EMPTY_SPEECH, type SpeechPlayer, type SpeechRate } from "@/lib/speech-player";
import { formatSpeechTime } from "@/lib/speech-timeline";
import { useLanguage } from "@/components/language-provider";

export function FloatingAudioPlayer({ player }: { player: SpeechPlayer }) {
  const state = React.useSyncExternalStore(player.subscribe, player.getSnapshot, () => EMPTY_SPEECH);
  const { lang } = useLanguage();
  const bn = lang === "bn";
  const [scrub, setScrub] = React.useState<number | null>(null);
  const region = React.useRef<HTMLDivElement>(null);
  const visible = Boolean(state.track);
  React.useEffect(() => {
    if (visible) document.body.classList.add("audio-player-open");
    return () => document.body.classList.remove("audio-player-open");
  }, [visible]);
  React.useEffect(() => setScrub(null), [state.track?.id]);
  if (!state.track) return null;

  const playing = state.status === "playing" || state.status === "loading";
  const position = scrub ?? state.position;
  const nextRate = (state.rate === 3 ? 1 : state.rate + 1) as SpeechRate;
  const approximate = bn ? "Browser voice-এর সময় আনুমানিক। Seek করলে কাছের শব্দ থেকে শুরু হবে।" : "Browser voice timing is approximate. Seeking starts at the nearest word.";
  const commitSeek = (value: number) => { player.seek(value); setScrub(null); };
  function close() {
    const restoreFocus = region.current?.contains(document.activeElement);
    const owner = document.querySelector<HTMLButtonElement>(`[data-speech-owner="${CSS.escape(state.track!.id)}"]`);
    player.close(); setScrub(null);
    if (restoreFocus) owner?.focus({ preventScroll: true });
  }

  return (
    <div ref={region} className="floating-audio-player" role="region" aria-label={bn ? "অডিও প্লেয়ার" : "Audio player"} data-audio-player
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <div className="audio-player-controls">
        <button type="button" className="audio-player-control audio-player-primary" onClick={player.toggle}
          aria-label={playing ? (bn ? "অডিও থামান" : "Pause audio") : state.status === "ended" ? (bn ? "আবার শুনুন" : "Replay audio") : (bn ? "অডিও চালান" : "Play audio")}>
          {state.status === "loading" ? <Loader2 size={23} className="animate-spin" /> : playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
        </button>
        <button type="button" className="audio-player-control" onClick={() => player.skip(-10)} disabled={state.position <= 0}
          aria-label={bn ? "১০ সেকেন্ড পেছনে" : "Back 10 seconds"} title={bn ? "আনুমানিক ১০ সেকেন্ড পেছনে" : "Back about 10 seconds"}>
          <RotateCcw size={31} strokeWidth={1.8} /><span className="audio-player-skip-number" aria-hidden="true">10</span>
        </button>
        <button type="button" className="audio-player-control" onClick={() => player.skip(10)} disabled={state.position >= state.duration}
          aria-label={bn ? "১০ সেকেন্ড সামনে" : "Forward 10 seconds"} title={bn ? "আনুমানিক ১০ সেকেন্ড সামনে" : "Forward about 10 seconds"}>
          <RotateCw size={31} strokeWidth={1.8} /><span className="audio-player-skip-number" aria-hidden="true">10</span>
        </button>
        <button type="button" className="audio-player-control audio-player-speed" onClick={() => player.setRate(nextRate)}
          aria-label={bn ? `অডিওর গতি: ${state.rate}x` : `Playback speed: ${state.rate}x`} title={bn ? `${nextRate}x গতিতে চালান` : `Change speed to ${nextRate}x`}>{state.rate}×</button>
        <div className="audio-player-time" title={approximate} aria-label={`${bn ? "আনুমানিক সময়" : "Estimated playback time"}: ${formatSpeechTime(position)} / ${formatSpeechTime(state.duration)}`}>
          <span>≈{formatSpeechTime(position)}</span><span className="audio-player-duration"> / {formatSpeechTime(state.duration)}</span>
        </div>
        <button type="button" className="audio-player-control audio-player-close" onClick={close} aria-label={bn ? "অডিও প্লেয়ার বন্ধ করুন" : "Close audio player"}><X size={29} strokeWidth={1.8} /></button>
      </div>
      <div className="audio-player-progress">
        <input type="range" min={0} max={Math.ceil(state.duration * 10) / 10} step={0.1} value={position}
          aria-label={bn ? "আনুমানিক অডিও অবস্থান" : "Approximate audio position"} aria-valuetext={`${formatSpeechTime(position)} / ${formatSpeechTime(state.duration)}`} title={approximate}
          style={{ "--audio-progress": `${state.duration ? position / state.duration * 100 : 0}%` } as React.CSSProperties}
          onChange={(event) => setScrub(Number(event.target.value))}
          onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))} onPointerCancel={() => setScrub(null)}
          onKeyUp={(event) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) commitSeek(Number(event.currentTarget.value)); }}
          onBlur={(event) => { if (scrub !== null) commitSeek(Number(event.currentTarget.value)); }} />
      </div>
      {state.error && <p className="audio-player-error" role="alert">{state.error}</p>}
      <span className="sr-only" aria-live="polite">{state.status === "ended" ? (bn ? "অডিও শেষ হয়েছে" : "Audio finished") : ""}</span>
    </div>
  );
}
