// Protokol kataloğu — sunucu + istemci ORTAK doğruluk kaynağı.
//
// Sunucu doğrulaması public.protocols tablosuna dayanır (migration
// 20260607000002); buradaki id / pillar / levelGate / veriCost / oneShot
// değerleri o tabloyla BİRE BİR aynı olmalıdır. Ad ve etki açıklaması yalnızca
// istemci (UI) içindir — sunucu bunlara ihtiyaç duymaz.
//
// Maç içi etki Faz 3'te; burada yalnızca tanım + ekonomi/sahiplik için meta.

/** Protokol sütunu (kategori). */
export type Pillar = 'info' | 'time' | 'disrupt' | 'defense';

/** Maç içi kullanım zamanı kuralı (sunucu doğrular; UI tile durumuna yansıtır).
 *  own_turn: yalnız kendi sıranda · anytime: maç aktifken her an ·
 *  setup: yalnız belirleme fazında. */
export type UsageTiming = 'own_turn' | 'anytime' | 'setup';

export type Protocol = {
  id: string;
  /** Görünen ad (TR). */
  name: string;
  pillar: Pillar;
  /** Kısa etki açıklaması (TR, UI — kart üstü/özet/şerit). */
  effect: string;
  /** Uzun açıklama (TR, UI — info modali): ne yaptığı + maç içi kullanımı
   *  (zamanlama, etki, sınır/tavan). Mekanikle birebir tutarlı. */
  longDescription: string;
  /** Açılması için gereken seviye. */
  levelGate: number;
  /** Veri maliyeti (0 = başta açık). */
  veriCost: number;
  /** Tek kullanımlık mı: TÜM maçta 1 kez (perRoundReset olsa bile). */
  oneShot: boolean;
  /** Maç içi kullanım zamanı kuralı (Faz 3 / Adım 4). */
  usageTiming: UsageTiming;
  /** Kullanım hakkı: maç başına kaç kez (varsayılan 1; Best of 3 boyunca tek). */
  usesPerMatch: number;
  /** Hak tur başına sıfırlanır mı (şimdilik hepsi false; altyapı hazır). */
  perRoundReset: boolean;
};

/** Yeni kullanıcının bedava başladığı protokoller (Sv1, 0 Veri). */
export const STARTER_PROTOCOLS = ['time_add', 'info_eliminate'] as const;

/** 14 protokol — sunucu tablosuyla aynı sırada/değerlerde.
 *  Kullanım hakkı VARSAYILANI: maç başına 1 (usesPerMatch:1, perRoundReset:false;
 *  Best of 3 boyunca tek — turlar arası SIFIRLANMAZ). 14 protokolün TAMAMI
 *  uygulanmıştır (4a-4d); usageTiming değerleri sunucu seed'iyle bire birdir. */
const PROTOCOLS_BASE: readonly Omit<Protocol, 'longDescription'>[] = [
  { id: 'time_add',        name: 'Süre Enjeksiyonu', pillar: 'time',    effect: '+12sn kendine',                                  levelGate: 1,  veriCost: 0,    oneShot: false, usageTiming: 'own_turn', usesPerMatch: 1, perRoundReset: false },
  { id: 'info_eliminate',  name: 'Eleme',            pillar: 'info',    effect: 'Sayıda olmayan bir rakamı öğren',                levelGate: 1,  veriCost: 0,    oneShot: false, usageTiming: 'own_turn', usesPerMatch: 1, perRoundReset: false },
  { id: 'def_shield',      name: 'Kalkan',           pillar: 'defense', effect: 'Gelen bir engeli blokla',                        levelGate: 2,  veriCost: 250,  oneShot: false, usageTiming: 'anytime',  usesPerMatch: 1, perRoundReset: false },
  { id: 'info_readlast',   name: 'Rakip Okuması',    pillar: 'info',    effect: 'Rakibin son tahminini gör',                      levelGate: 2,  veriCost: 300,  oneShot: false, usageTiming: 'own_turn', usesPerMatch: 1, perRoundReset: false },
  { id: 'time_steal',      name: 'Saat Çalma',       pillar: 'time',    effect: 'Rakipten 10sn al (rakip min 5sn)',               levelGate: 3,  veriCost: 350,  oneShot: false, usageTiming: 'own_turn', usesPerMatch: 1, perRoundReset: false },
  { id: 'disrupt_fog',     name: 'Sis Perdesi',      pillar: 'disrupt', effect: 'Rakibin sonraki geri bildirimi 4sn gecikir',     levelGate: 3,  veriCost: 350,  oneShot: false, usageTiming: 'anytime',  usesPerMatch: 1, perRoundReset: false },
  { id: 'info_postest',    name: 'Konum Testi',      pillar: 'info',    effect: 'Bir rakam doğru pozisyonda mı (evet/hayır)',     levelGate: 4,  veriCost: 450,  oneShot: false, usageTiming: 'own_turn', usesPerMatch: 1, perRoundReset: false },
  { id: 'time_freeze',     name: 'Dondur',           pillar: 'time',    effect: 'Bu turda kendi saatin işlemez',                  levelGate: 5,  veriCost: 550,  oneShot: false, usageTiming: 'own_turn', usesPerMatch: 1, perRoundReset: false },
  { id: 'disrupt_silence', name: 'Susturma',         pillar: 'disrupt', effect: 'Rakip 1 sıra protokol kullanamaz',               levelGate: 5,  veriCost: 600,  oneShot: false, usageTiming: 'anytime',  usesPerMatch: 1, perRoundReset: false },
  { id: 'time_slow',       name: 'Yavaşlat',         pillar: 'time',    effect: 'Rakip saati 1.5× hızlı akar (1 sıra)',           levelGate: 6,  veriCost: 700,  oneShot: false, usageTiming: 'own_turn', usesPerMatch: 1, perRoundReset: false },
  { id: 'disrupt_waste',   name: 'Zorla Harca',      pillar: 'disrupt', effect: 'Rakibin bir protokolünü boşa tüketir',           levelGate: 7,  veriCost: 850,  oneShot: false, usageTiming: 'anytime',  usesPerMatch: 1, perRoundReset: false },
  { id: 'info_reveal',     name: 'Sayı İşareti',     pillar: 'info',    effect: 'Doğru bir rakamı açar',                          levelGate: 8,  veriCost: 1100, oneShot: true,  usageTiming: 'own_turn', usesPerMatch: 1, perRoundReset: false },
  { id: 'disrupt_deceive', name: 'Yanıltma',         pillar: 'disrupt', effect: 'Rakibin sonraki geri bildirimi +1 şişer',        levelGate: 9,  veriCost: 1300, oneShot: false, usageTiming: 'anytime',  usesPerMatch: 1, perRoundReset: false },
  { id: 'def_reflect',     name: 'Yansıtma',         pillar: 'defense', effect: 'Gelen ilk engeli sahibine yansıtır',             levelGate: 10, veriCost: 1500, oneShot: false, usageTiming: 'anytime',  usesPerMatch: 1, perRoundReset: false },
];

// Uzun açıklamalar (info modali) — mekanikle (Faz 3 / 4a-4d) BİREBİR tutarlı.
// Tüm protokoller maç boyunca BİR KEZ kullanılır (usesPerMatch:1, turlar arası
// sıfırlanmaz). Süre/zamanlama değerleri sunucu etkileriyle aynıdır.
const LONG_DESCRIPTIONS: Record<string, string> = {
  time_add:
    'Kendi sıranda kullanılır. Saatine anında 12 saniye ekler — süre baskısı altındayken nefes aldırır. Etki yalnızca senin saatine işler, rakibe dokunmaz. Maç boyunca bir kez kullanılabilir.',
  info_eliminate:
    'Kendi sıranda kullanılır. Rakibin o turdaki gizli sayısında BULUNMAYAN bir rakamı açığa çıkarır; o rakamı elemelerinden çıkarıp olasılıkları daraltırsın. Maç boyunca bir kez kullanılabilir.',
  def_shield:
    'Her an kurulabilir (sıranı beklemeden). Kurulduktan sonra rakipten gelen İLK engeli (Sis Perdesi, Susturma, Zorla Harca veya Yanıltma) bloklar ve söner. Rakip Kalkan kurduğunu göremez. Hem Kalkan hem Yansıtma açıksa önce Yansıtma çalışır. Maç boyunca bir kez kullanılabilir.',
  info_readlast:
    'Kendi sıranda kullanılır. Rakibin bu turda yaptığı SON tahmini ve o tahmine aldığı geri bildirimi gösterir. Rakip henüz tahmin yapmadıysa etki oluşmaz ve hakkın HARCANMAZ. Maç boyunca bir kez kullanılabilir.',
  time_steal:
    'Kendi sıranda kullanılır. Rakibin saatinden 10 saniye alıp kendi saatine ekler. Rakibin saati 5 saniyenin altına düşmez (taban); rakipte alınacak süre azsa daha azını alırsın. Maç boyunca bir kez kullanılabilir.',
  disrupt_fog:
    'Her an kullanılabilir. Rakibin bir sonraki tahmininin geri bildirimini 4 saniye gecikmeli gösterir; bilgiyi geç almasıyla onu yavaşlatır. Değerlendirme normal yapılır, yalnızca gösterim gecikir. Maç boyunca bir kez kullanılabilir.',
  info_postest:
    'Kendi sıranda kullanılır. Seçtiğin bir rakamın, seçtiğin pozisyonda olup olmadığını evet/hayır olarak öğrenirsin — pozisyon avına kesinlik katar. Maç boyunca bir kez kullanılabilir.',
  time_freeze:
    'Kendi sıranda kullanılır. O tur boyunca senin saatin işlemez; süre eksilmeden rahatça düşünebilirsin. Yalnız kendine etki eder. Maç boyunca bir kez kullanılabilir.',
  disrupt_silence:
    'Her an kullanılabilir. Rakip, bir sonraki turunda HİÇBİR protokol kullanamaz — kritik bir anda elini bağlar. Maç boyunca bir kez kullanılabilir.',
  time_slow:
    'Kendi sıranda kullanılır. Rakibin bir sonraki turunda saati 1.5× hızlı erir; o tur bitince normale döner. Rakibe zaman baskısı bindirir. Maç boyunca bir kez kullanılabilir.',
  disrupt_waste:
    'Her an kullanılabilir. Rakibin henüz kullanmadığı protokollerden birini boşa harcatır; o protokolü artık kullanamaz. Rakibin harcanacak protokolü yoksa etki oluşmaz ve hakkın HARCANMAZ. Maç boyunca bir kez kullanılabilir.',
  info_reveal:
    'Kendi sıranda kullanılır. Rakibin gizli sayısında BULUNAN doğru bir rakamı açığa çıkarır (pozisyonunu vermez). Güçlü, tek kullanımlık bir bilgi; maç boyunca bir kez kullanılabilir.',
  disrupt_deceive:
    'Her an kullanılabilir. Rakibin bir sonraki tahmininde GÖSTERİLEN "doğru rakam sayısı" bir kademe şişirilir ve rakip yanıldığını anlamaz. Yalnız ara sonuçlarda çalışır: kazanma ve "rakamlar doğru, sıra yanlış" eşiği sahtelenmez, gerçek değerlendirme bozulmaz. Maç boyunca bir kez kullanılabilir.',
  def_reflect:
    'Her an kurulabilir (sıranı beklemeden). Kurulduktan sonra rakipten gelen İLK engeli gönderene geri çevirir — etki rakibin kendisine işler. Rakip Yansıtma kurduğunu göremez. Hem Kalkan hem Yansıtma açıksa önce Yansıtma çalışır. Maç boyunca bir kez kullanılabilir.',
};

/** 14 protokol — kısa effect + uzun açıklama birleştirilmiş hâli. */
export const PROTOCOLS: readonly Protocol[] = PROTOCOLS_BASE.map((p) => ({
  ...p,
  longDescription: LONG_DESCRIPTIONS[p.id] ?? p.effect,
}));

const BY_ID: Record<string, Protocol> = Object.fromEntries(PROTOCOLS.map((p) => [p.id, p]));

/** id → Protocol (yoksa undefined). */
export function getProtocol(id: string): Protocol | undefined {
  return BY_ID[id];
}

/** Sütun → görünen etiket (UI). */
export const PILLAR_LABELS: Record<Pillar, string> = {
  info: 'Bilgi',
  time: 'Zaman',
  disrupt: 'Sabotaj',
  defense: 'Savunma',
};
