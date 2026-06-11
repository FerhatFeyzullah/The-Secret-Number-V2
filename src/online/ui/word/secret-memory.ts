/** Düello ekranındaki "gizli kelimen" göstergesi için İSTEMCİ-YEREL hafıza.
 *  Sunucu gizli kelimeyi asla geri döndürmez (tip/RLS garantisi); oyuncunun
 *  KENDİ yazdığı kelime kilitleme anında buraya yazılır, düello ekranı okur.
 *  Uygulama yeniden başlarsa kaybolur → gösterge "—" düşer (sızıntı yok). */
const secrets = new Map<string, string>();

const key = (matchId: string, round: number) => `${matchId}:${round}`;

export function rememberMySecret(matchId: string, round: number, word: string) {
  secrets.set(key(matchId, round), word);
}

export function recallMySecret(matchId: string, round: number): string | null {
  return secrets.get(key(matchId, round)) ?? null;
}
