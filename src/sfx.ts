import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef } from 'react';

export type SfxName = 'blip' | 'good' | 'win' | 'lose';

/**
 * Sentezlenmiş kısa ses efektleri (assets/sfx/).
 * Oynatıcılar yalnızca istemcide oluşturulur — statik render'da Audio yoktur.
 */
export function useSfx() {
  const players = useRef<Record<SfxName, AudioPlayer> | null>(null);

  useEffect(() => {
    players.current = {
      blip: createAudioPlayer(require('../assets/sfx/blip.wav')),
      good: createAudioPlayer(require('../assets/sfx/good.wav')),
      win: createAudioPlayer(require('../assets/sfx/win.wav')),
      lose: createAudioPlayer(require('../assets/sfx/lose.wav')),
    };
    return () => {
      for (const player of Object.values(players.current ?? {})) {
        player.remove();
      }
      players.current = null;
    };
  }, []);

  return (name: SfxName) => {
    const player = players.current?.[name];
    if (!player) return;
    player.seekTo(0);
    player.play();
  };
}
