"use client";

import * as React from "react";
import { SpeechPlayer } from "@/lib/speech-player";
import { FloatingAudioPlayer } from "@/components/floating-audio-player";

const AudioContext = React.createContext<SpeechPlayer | null>(null);

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const [player] = React.useState(() => new SpeechPlayer());
  React.useEffect(() => { player.initialize(); return player.close; }, [player]);
  return <AudioContext.Provider value={player}>{children}<FloatingAudioPlayer player={player} /></AudioContext.Provider>;
}

export function useAudioPlayer() {
  const player = React.useContext(AudioContext);
  if (!player) throw new Error("AudioPlayerProvider is required");
  return player;
}
