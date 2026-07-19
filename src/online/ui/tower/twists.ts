import type { TowerTwistKind } from '@/online';
import { getProtocol } from '@/protocols/catalog';
import { getSignal } from '@/signals/catalog';
import { colors } from '@/ui/theme';

/** İstemci twist kataloğu — YALNIZ görsel (rozet/ipucu). Bozma mantığı sunucuda.
 *  emoji + kısa ad + tek satır açıklama + vurgu rengi. */
export const TOWER_TWISTS: Record<
  TowerTwistKind,
  { emoji: string; name: string; desc: string; color: string }
> = {
  fog: { emoji: '🌫️', name: 'Sis', desc: 'Geri bildirimin bir kısmı gizlenir', color: colors.dim },
  time_thief: { emoji: '⏳', name: 'Zaman Hırsızı', desc: 'Yanlış tahminde süre çalınır', color: colors.amber },
  shuffle: { emoji: '🔀', name: 'Karıştırıcı', desc: 'Renkler yerinden oynar', color: colors.violet },
  cursed: { emoji: '🚫', name: 'Lanetli Harf', desc: 'Bir harf zaman cezası getirir', color: colors.danger },
  blind: { emoji: '👁️', name: 'Kör Tur', desc: 'Bir tahminde geri bildirim yok', color: colors.dim },
  liar: { emoji: '🎭', name: 'Yalancı', desc: 'Bir geri bildirim yalan olabilir', color: colors.violet },
  lock: { emoji: '🔒', name: 'Kilit', desc: 'Bir hane sona dek gizli kalır', color: colors.teal },
  double: { emoji: '👥', name: 'Çift Sır', desc: 'İki kelimeyi de çöz', color: colors.gold },
};

/** Lanetli Harf twist'inin params.letter'ı (klavyede işaretlemek için). */
export function cursedLetter(params: Record<string, number | string> | undefined): string | null {
  const l = params?.letter;
  return typeof l === 'string' && l.length > 0 ? l : null;
}

/** Boss ödülü (protokol/sinyal) için gösterilecek ad. */
export function towerItemLabel(kind: 'protocol' | 'signal', id: string): string {
  if (kind === 'protocol') return getProtocol(id)?.name ?? 'Protokol';
  return getSignal(id)?.name ?? 'Sinyal';
}
