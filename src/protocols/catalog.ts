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
  /** Kısa etki açıklaması (TR, UI). */
  effect: string;
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
 *  Best of 3 boyunca tek — turlar arası SIFIRLANMAZ). usageTiming yalnız
 *  uygulanmış protokollerde (4a: time_add, info_eliminate · 4b: info_readlast,
 *  info_postest, info_reveal, time_steal, time_freeze, time_slow · 4c:
 *  disrupt_fog, disrupt_silence, disrupt_waste, def_shield, def_reflect)
 *  bağlayıcıdır; kalan disrupt_deceive 4d'de etkiyle birlikte kesinleşir. */
export const PROTOCOLS: readonly Protocol[] = [
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
  { id: 'disrupt_deceive', name: 'Yanıltma',         pillar: 'disrupt', effect: 'Rakip geri bildirimi +1 şişirilir (partial)',    levelGate: 9,  veriCost: 1300, oneShot: false, usageTiming: 'own_turn', usesPerMatch: 1, perRoundReset: false },
  { id: 'def_reflect',     name: 'Yansıtma',         pillar: 'defense', effect: 'Gelen ilk engeli sahibine yansıtır',             levelGate: 10, veriCost: 1500, oneShot: false, usageTiming: 'anytime',  usesPerMatch: 1, perRoundReset: false },
];

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
