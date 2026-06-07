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
  /** Tek kullanımlık mı (maç içi; Faz 3). */
  oneShot: boolean;
};

/** Yeni kullanıcının bedava başladığı protokoller (Sv1, 0 Veri). */
export const STARTER_PROTOCOLS = ['time_add', 'info_eliminate'] as const;

/** 14 protokol — sunucu tablosuyla aynı sırada/değerlerde. */
export const PROTOCOLS: readonly Protocol[] = [
  { id: 'time_add',        name: 'Süre Enjeksiyonu', pillar: 'time',    effect: '+12sn kendine',                                  levelGate: 1,  veriCost: 0,    oneShot: false },
  { id: 'info_eliminate',  name: 'Eleme',            pillar: 'info',    effect: 'Sayıda olmayan bir rakamı öğren',                levelGate: 1,  veriCost: 0,    oneShot: false },
  { id: 'def_shield',      name: 'Kalkan',           pillar: 'defense', effect: 'Gelen bir engeli blokla',                        levelGate: 2,  veriCost: 250,  oneShot: false },
  { id: 'info_readlast',   name: 'Rakip Okuması',    pillar: 'info',    effect: 'Rakibin son tahminini gör',                      levelGate: 2,  veriCost: 300,  oneShot: false },
  { id: 'time_steal',      name: 'Saat Çalma',       pillar: 'time',    effect: 'Rakipten 10sn al (rakip min 5sn)',               levelGate: 3,  veriCost: 350,  oneShot: false },
  { id: 'disrupt_fog',     name: 'Sis Perdesi',      pillar: 'disrupt', effect: 'Rakip geri bildirimi 4sn gecikir',               levelGate: 3,  veriCost: 350,  oneShot: false },
  { id: 'info_postest',    name: 'Konum Testi',      pillar: 'info',    effect: 'Bir rakam doğru pozisyonda mı (evet/hayır)',     levelGate: 4,  veriCost: 450,  oneShot: false },
  { id: 'time_freeze',     name: 'Dondur',           pillar: 'time',    effect: 'Rakip sırasında saati durur',                    levelGate: 5,  veriCost: 550,  oneShot: false },
  { id: 'disrupt_silence', name: 'Susturma',         pillar: 'disrupt', effect: 'Rakip 1 sıra yetenek kullanamaz',                levelGate: 5,  veriCost: 600,  oneShot: false },
  { id: 'time_slow',       name: 'Yavaşlat',         pillar: 'time',    effect: 'Rakip saati 1.5× hızlı akar (1 sıra)',           levelGate: 6,  veriCost: 700,  oneShot: false },
  { id: 'disrupt_waste',   name: 'Zorla Harca',      pillar: 'disrupt', effect: 'Rakibin bir yeteneğini boşa tüket',              levelGate: 7,  veriCost: 850,  oneShot: false },
  { id: 'info_reveal',     name: 'Sayı İşareti',     pillar: 'info',    effect: 'Doğru bir rakamı açar',                          levelGate: 8,  veriCost: 1100, oneShot: true  },
  { id: 'disrupt_deceive', name: 'Yanıltma',         pillar: 'disrupt', effect: 'Rakip geri bildirimi +1 şişirilir (partial)',    levelGate: 9,  veriCost: 1300, oneShot: false },
  { id: 'def_reflect',     name: 'Yansıtma',         pillar: 'defense', effect: 'Gelen son yeteneği rakibe geri yolla',           levelGate: 10, veriCost: 1500, oneShot: false },
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
