import type { AgePlayer } from '@/online';

/** Gizem Çağı takım renkleri. "Sen" her zaman MAVİ; diğer ikisi slot sırasına
 *  göre kırmızı/yeşil. Nötr (bot) gri. Renk izleyiciye görelidir (herkes kendini
 *  mavi görür) — tanınırlık için. */
export const AGE = { blue: '#4a90ff', red: '#ff5b5b', green: '#46cf7c', gray: '#6b7690' };

/** playerId → renk. me = mavi; diğerleri slot sırasıyla kırmızı, yeşil. */
export function ageColors(players: AgePlayer[], me: string): Record<string, string> {
  const map: Record<string, string> = { [me]: AGE.blue };
  const others = players.filter((p) => p.player !== me).sort((a, b) => a.slot - b.slot);
  const pal = [AGE.red, AGE.green];
  others.forEach((p, i) => {
    map[p.player] = pal[i] ?? AGE.gray;
  });
  return map;
}

/** Sahip rengi (owner null → gri). */
export function ownerColor(owner: string | null, colorMap: Record<string, string>): string {
  return owner ? colorMap[owner] ?? AGE.gray : AGE.gray;
}
