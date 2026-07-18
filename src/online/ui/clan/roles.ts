import type { ClanRole } from '@/online';
import { colors } from '@/ui/theme';

/** Çaylak → Ajan otomatik yükselme eşiği (klan galibiyeti). Sunucudaki türetimle
 *  aynı: contribution = katıldıktan sonraki kalıcı galibiyet. */
export const AJAN_THRESHOLD = 10;

export type ClanRank = { key: 'leader' | 'coleader' | 'ajan' | 'caylak'; label: string; accent: string };

/** Rol + katkıdan görünen rütbe (Operatör/Şifreci/Ajan/Çaylak). */
export function memberRank(m: { role: ClanRole; contribution: number }): ClanRank {
  if (m.role === 'leader') return { key: 'leader', label: 'Operatör', accent: colors.gold };
  if (m.role === 'coleader') return { key: 'coleader', label: 'Şifreci', accent: colors.cyan };
  if (m.contribution >= AJAN_THRESHOLD) return { key: 'ajan', label: 'Ajan', accent: colors.teal };
  return { key: 'caylak', label: 'Çaylak', accent: colors.dim };
}

/** Katılım modu etiketi. */
export function joinModeLabel(mode: string): string {
  if (mode === 'approval') return 'Onaylı';
  if (mode === 'invite') return 'Davetle';
  return 'Açık';
}
