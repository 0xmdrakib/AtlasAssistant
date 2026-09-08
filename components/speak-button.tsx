"use client";

import * as React from "react";
import { Volume2, Square } from "lucide-react";
import { Button } from "@/components/ui";

let stopActivePlayback: (() => void) | null = null;

export function SpeakButton({
  text,
  lang,
  labelSpeak = "Listen",
  labelStop = "Stop audio",
}: {
  text: string;
  lang: string;
  labelSpeak?: string;
  labelStop?: string;
}) {
  const [speaking, setSpeaking] = React.useState(false);
  const [supported, setSupported] = React.useState(false);
  const utterance = React.useRef<SpeechSynthesisUtterance | null>(null);

  const stop = React.useCallback(() => {
    // Only the button that owns the current audio may cancel it.
    if (stopActivePlayback === stop) {
      stopActivePlayback = null;
      window.speechSynthesis.cancel();
    }
    utterance.current = null;
    setSpeaking(false);
  }, []);

  React.useEffect(() => {
    setSupported("speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
    return () => {
      if (stopActivePlayback === stop) stop();
    };
  }, [stop]);

  function speak() {
    if (!supported) return;
    if (!text.trim()) return;

    stopActivePlayback?.();

    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang || "en-US";

    const finish = () => {
      if (utterance.current !== u) return;
      utterance.current = null;
      if (stopActivePlayback === stop) stopActivePlayback = null;
      setSpeaking(false);
    };
    u.onend = finish;
    u.onerror = finish;

    utterance.current = u;
    stopActivePlayback = stop;
    setSpeaking(true);
    try { window.speechSynthesis.speak(u); } catch { finish(); }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className="h-10 w-10 shrink-0 gap-2 px-0"
      onClick={speaking ? stop : speak}
      aria-label={speaking ? labelStop : labelSpeak}
      aria-pressed={speaking}
      title={speaking ? labelStop : labelSpeak}
      disabled={!supported || !text.trim()}
    >
      {speaking ? <Square size={16} /> : <Volume2 size={16} />}
    </Button>
  );
}
