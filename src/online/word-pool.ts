import { normalizeTr } from '@/game';

import { supabase } from '../supabase';

/** PostgREST tek istekte ~1000 satır döndürür; bir uzunluk bunu aşabilir. */
const PAGE = 1000;

/**
 * Tek oyunculu kelime modu için verilen uzunluğun TÜM havuzunu (secret_words)
 * çeker. `secret_words` birleşik havuzdur (hem gizli kelime seçimi hem tahmin
 * doğrulaması) ve anon+authenticated okumaya açıktır → yeni RPC/migration gerekmez.
 * `ORDER BY random()` PostgREST'te yok; ekran diziden yerel olarak rastgele gizli
 * kelime seçer ve bir Set kurarak tahminleri gecikmesiz doğrular.
 *
 * Kelimeler normalizeTr'den geçirilir (havuz zaten küçük harf; garanti için).
 * Hata/boş havuz/yapılandırılmamış istemci durumunda throw eder — çağıran
 * ekran `error` durumuna düşer.
 */
export async function fetchWordPool(length: number): Promise<string[]> {
  if (!supabase) throw new Error('supabase-unconfigured');
  const out: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('secret_words')
      .select('word')
      .eq('length', length)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) out.push(normalizeTr(row.word as string));
    if (data.length < PAGE) break;
  }
  if (out.length === 0) throw new Error('empty-pool');
  return out;
}
