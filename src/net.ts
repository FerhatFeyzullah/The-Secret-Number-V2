import * as Network from 'expo-network';

/**
 * Kaba çevrimdışı tespiti — online-bağımlı girişleri (çok oyunculu, solo kelime
 * havuzu) girmeden ÖNCE proaktif uyarmak için. Solo SAYI modu çevrimdışı çalışır,
 * hiç çağrılmaz.
 *
 * SADECE net çevrimdışıda false döner: bağlantı yok VEYA internet erişilemez.
 * `isInternetReachable` bilinmiyorsa (undefined/null — bazı platformlarda geç
 * gelir) engellemeyiz → yanlış-negatifle çevrimiçi kullanıcıyı bloklamayız.
 * Tespit hata verirse (nadir) çevrimiçi sayılır; nihai koruma yine reaktif
 * ağ-hatası katmanıdır.
 */
export async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    if (state.isConnected === false) return false;
    if (state.isInternetReachable === false) return false;
    return true;
  } catch {
    return true;
  }
}
