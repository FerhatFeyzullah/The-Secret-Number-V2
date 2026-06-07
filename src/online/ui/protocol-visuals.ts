import { colors } from '@/ui/theme';
import type { Pillar } from '@/protocols/catalog';

import type { FeatherName } from './parts';

// Protokol görsel sözlüğü — YALNIZCA UI (katalog veri kaynağı bunları içermez).
// protocol-select / protocol-tree / düello şeridi aynı renk+glifi buradan alır.

/** Kategori (sütun) renkleri — tasarım referansı: Bilgi cyan, Zaman violet,
 *  Sabotaj amber, Savunma yeşil. */
export const PILLAR_COLOR: Record<Pillar, string> = {
  info: colors.cyan,
  time: colors.violet,
  disrupt: colors.amber,
  defense: colors.success,
};

/** Protokol → Feather glifi. */
export const PROTOCOL_ICONS: Record<string, FeatherName> = {
  info_eliminate: 'eye',
  info_readlast: 'search',
  info_postest: 'map-pin',
  info_reveal: 'hash',
  time_add: 'clock',
  time_steal: 'watch',
  time_freeze: 'pause',
  time_slow: 'wind',
  disrupt_fog: 'cloud',
  disrupt_silence: 'volume-x',
  disrupt_waste: 'shuffle',
  disrupt_deceive: 'alert-triangle',
  def_shield: 'shield',
  def_reflect: 'refresh-cw',
};

/** id → glif (bilinmeyen id'de nötr kutu). */
export const protocolIcon = (id: string): FeatherName => PROTOCOL_ICONS[id] ?? 'box';

/** "Gözlemlenebilir etki" kuralı: kullanımı rakipte o an somut etki yaratan
 *  (rakibe bildirilen) protokoller. Diğerleri gizli kalır — rakibe ne toast ne
 *  veri gider (sunucu RLS de bu seti uygular). İstemci-içi savunma katmanı. */
export const OPPONENT_VISIBLE_PROTOCOLS = new Set<string>([
  'time_steal', // saat görünür azalır
  'time_slow', // saat hızlı erir
  'disrupt_fog', // geri bildirim gecikir
  'disrupt_silence', // protokoller pasifleşir
  'disrupt_waste', // bir protokol gider
]);
