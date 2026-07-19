import type { TowerTwistKind } from '@/online';
import { getProtocol } from '@/protocols/catalog';
import { getSignal } from '@/signals/catalog';
import { colors } from '@/ui/theme';

/** İstemci yetenek kataloğu — rozet + ilk-karşılaşma modalı açıklaması için.
 *  Mantık (sis/zaman/lanetli) sunucuda; hafıza kaybı istemci-taraflı. */
export const TOWER_TWISTS: Record<
  TowerTwistKind,
  { emoji: string; name: string; desc: string; color: string }
> = {
  fog: {
    emoji: '🌫️',
    name: 'Sis',
    desc: 'Kelimede olan harflerin yeşil mi sarı mı olduğu gizlenir; kelimede olmayan (gri) haneler normal görünür.',
    color: colors.violet,
  },
  time_thief: {
    emoji: '⏳',
    name: 'Zaman Hırsızı',
    desc: 'Her yanlış tahminde, kelimede olmayan (gri) her hane için sürenden 1 saniye gider.',
    color: colors.amber,
  },
  cursed: {
    emoji: '🚫',
    name: 'Lanetli Harf',
    desc: 'Kelimede olmayan 1-2 harf lanetlidir (baştan gösterilir). Tahminde kullanırsan her seferinde 3 saniye ceza.',
    color: colors.danger,
  },
  memory: {
    emoji: '🧠',
    name: 'Hafıza Kaybı',
    desc: 'Sorgu listesi yok! Yaptığın her tahmin 3 saniye sonra kaybolur; sonuçları aklında tutmalısın.',
    color: colors.teal,
  },
};

/** Boss ödülü (protokol/sinyal) için gösterilecek ad. */
export function towerItemLabel(kind: 'protocol' | 'signal', id: string): string {
  if (kind === 'protocol') return getProtocol(id)?.name ?? 'Protokol';
  return getSignal(id)?.name ?? 'Sinyal';
}
