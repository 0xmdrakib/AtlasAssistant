"use client";

import * as React from "react";
import { Volume2, Square } from "lucide-react";
import { Button } from "@/components/ui";
import { useAudioPlayer } from "@/components/audio-player-provider";

export function SpeakButton({ text, lang, labelSpeak = "Listen", labelStop = "Stop audio" }: {
  text: string; lang: string; labelSpeak?: string; labelStop?: string;
}) {
  const player = useAudioPlayer();
  const id = React.useId();
  // Subscribe to ownership only: the playback clock must not re-render every feed card.
  const supported = React.useSyncExternalStore(player.subscribe, () => player.getSnapshot().supported, () => false);
  const active = React.useSyncExternalStore(player.subscribe, () => {
    const state = player.getSnapshot();
    return state.track?.id === id && state.status !== "ended";
  }, () => false);
  React.useEffect(() => () => player.stopTrack(id), [player, id, text, lang]);

  return <Button type="button" variant="ghost" className="h-10 w-10 shrink-0 gap-2 px-0"
    data-speech-owner={id} onClick={() => active ? player.close() : player.start({ id, text, lang })}
    aria-label={active ? labelStop : labelSpeak} aria-pressed={active} title={active ? labelStop : labelSpeak}
    disabled={!supported || !text.trim()}>
    {active ? <Square size={16} /> : <Volume2 size={16} />}
  </Button>;
}
