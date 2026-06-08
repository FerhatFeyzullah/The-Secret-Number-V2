import type { ComponentType } from 'react';

import {
  AngerIcon,
  ClapIcon,
  ConfidentIcon,
  CryingIcon,
  DefeatIcon,
  DisbeliefIcon,
  EurekaIcon,
  FireIcon,
  GgIcon,
  IceIcon,
  LaughIcon,
  LockedIcon,
  LuckyIcon,
  RespectIcon,
  ShockIcon,
  SneakyIcon,
  ThinkingIcon,
  VictoryIcon,
  type SignalIconProps,
} from './icons';

/** Maç sonu "Sinyal" reaksiyonu. TEK doğruluk kaynağı (protokol catalog deseni).
 *  Henüz mağaza/deste/sunucu YOK — yalnız görsel + meta. */
export type Signal = {
  /** Kalıcı kimlik (örn. 'sig_victory'). */
  id: string;
  /** Türkçe ad (UI'da gösterilir). */
  name: string;
  /** SVG bileşeni (size prop alır). */
  component: ComponentType<SignalIconProps>;
  /** Açma maliyeti (Veri). starter ise 0. */
  veriCost: number;
  /** Başlangıçta açık mı (ücretsiz). */
  starter: boolean;
};

/** 18 sinyal. Fiyat merdiveni protokollere benzer: starter (0) → 150 → 200 →
 *  300 → 450 → 600 → 800. Başlangıçta 5 temel reaksiyon açık. */
export const SIGNALS: Signal[] = [
  // ── Starter (ücretsiz) — temel reaksiyonlar ──
  { id: 'sig_victory', name: 'Zafer', component: VictoryIcon, veriCost: 0, starter: true },
  { id: 'sig_defeat', name: 'Mağlubiyet', component: DefeatIcon, veriCost: 0, starter: true },
  { id: 'sig_gg', name: 'İyi Oyun', component: GgIcon, veriCost: 0, starter: true },
  { id: 'sig_laugh', name: 'Kahkaha', component: LaughIcon, veriCost: 0, starter: true },
  { id: 'sig_thinking', name: 'Düşünüyor', component: ThinkingIcon, veriCost: 0, starter: true },

  // ── 150 Veri ──
  { id: 'sig_shock', name: 'Şoke', component: ShockIcon, veriCost: 150, starter: false },
  { id: 'sig_crying', name: 'Üzgün', component: CryingIcon, veriCost: 150, starter: false },
  { id: 'sig_anger', name: 'Sinirli', component: AngerIcon, veriCost: 150, starter: false },

  // ── 200 Veri ──
  { id: 'sig_confident', name: 'Kendinden Emin', component: ConfidentIcon, veriCost: 200, starter: false },
  { id: 'sig_disbelief', name: 'İnanamıyorum', component: DisbeliefIcon, veriCost: 200, starter: false },
  { id: 'sig_clap', name: 'Alkış', component: ClapIcon, veriCost: 200, starter: false },

  // ── 300 Veri ──
  { id: 'sig_lucky', name: 'Şanslı Tahmin', component: LuckyIcon, veriCost: 300, starter: false },
  { id: 'sig_eureka', name: 'Buldum!', component: EurekaIcon, veriCost: 300, starter: false },
  { id: 'sig_respect', name: 'Saygı', component: RespectIcon, veriCost: 300, starter: false },

  // ── 450 Veri ──
  { id: 'sig_fire', name: 'Ateşli', component: FireIcon, veriCost: 450, starter: false },
  { id: 'sig_ice', name: 'Buz Gibi', component: IceIcon, veriCost: 450, starter: false },

  // ── 600 Veri ──
  { id: 'sig_sneaky', name: 'Sinsi', component: SneakyIcon, veriCost: 600, starter: false },

  // ── 800 Veri ──
  { id: 'sig_locked', name: 'Hedef Kilitlendi', component: LockedIcon, veriCost: 800, starter: false },
];

/** id → sinyal (hızlı arama). */
export const SIGNAL_BY_ID: Record<string, Signal> = Object.fromEntries(
  SIGNALS.map((s) => [s.id, s]),
);

export function getSignal(id: string): Signal | undefined {
  return SIGNAL_BY_ID[id];
}
