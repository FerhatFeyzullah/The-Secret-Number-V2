/** Sunucudaki matches.status değerleri. */
export type MatchStatus =
  | 'waiting'
  | 'setup'
  | 'active'
  | 'finished'
  | 'cancelled'
  | 'abandoned';

/** Maç modu: hızlı eşleşme ya da kodlu özel oda. */
export type MatchMode = 'quick' | 'private';

/** Maç bitiş nedeni. */
export type MatchResult = 'win' | 'timeout' | 'forfeit' | 'cancelled';

/**
 * Sunucunun döndürdüğü tahmin geri bildirimi.
 *
 * Offline kuralıyla birebir: yalnızca doğru rakam SAYISI (partial:N) ya da
 * "rakamlar doğru, sıra yanlış" / "kazandın" bilgisi. Pozisyon eşleşme sayısı
 * tip seviyesinde dahi yoktur — sunucu da hesaplamaz (bkz. evaluate_guess SQL).
 */
export type GuessFeedback =
  | 'partial:0'
  | 'partial:1'
  | 'partial:2'
  | 'digits_correct_wrong_order'
  | 'win';

/** Çağıranın maçtaki rolü. */
export type PlayerRole = 'player1' | 'player2';

/** Oyuncu kimliği + profil adı.
 *  Not: profiles RLS'i şimdilik yalnızca KENDİ satırını okutuyor; rakip adı
 *  null kalabilir (lider tablosu adımında politika/RPC eklenecek). */
export type MatchPlayer = {
  id: string;
  username: string | null;
};

/**
 * İstemcinin gördüğü güvenli maç durumu.
 *
 * Bilinçli olarak gizli sayıyı (kendi ya da rakibinkini) temsil eden HİÇBİR
 * alan yoktur; sunucu zaten döndürmez, tip seviyesinde de var olamaz.
 */
export type MatchState = {
  id: string;
  status: MatchStatus;
  mode: MatchMode;
  roomCode: string | null;
  player1: MatchPlayer;
  player2: MatchPlayer | null;
  /** Çağıranın rolü (maçın oyuncusu değilse state hiç üretilmez). */
  myRole: PlayerRole;
  /** Sırası gelen oyuncunun id'si (active dışında null). */
  currentTurn: string | null;
  clock1Ms: number;
  clock2Ms: number;
  /** Sıranın başladığı sunucu zamanı (ISO); görsel geri sayım bundan türetilir. */
  turnStartedAt: string | null;
  /** Sayı belirleme fazının bitiş anı (ISO). İki taraf da "Hazır" (present)
   *  olunca kurulur; o ana kadar null (sayaç başlamaz). */
  setupDeadline: string | null;
  /** present = "Hazır'a bastı / belirleme ekranına girdi" (mark_ready).
   *  İki taraf da present olunca setup_deadline (30 sn) başlar. Yalnızca boolean. */
  player1Present: boolean;
  player2Present: boolean;
  /** İlk present olandan sonra rakip için tanınan idle penceresinin bitişi (ISO);
   *  geçerse maç iptal (kazanan yok). İki taraf present olunca null'a döner. */
  presentDeadline: string | null;
  /** ready = "gizli sayısını KİLİTLEDİ" (set_secret). present'ten farklıdır.
   *  Yalnızca BOOLEAN sinyal; gizli sayının kendisi asla taşınmaz/sızmaz. */
  player1Ready: boolean;
  player2Ready: boolean;
  winner: string | null;
  result: MatchResult | null;
};

/** Tek tahmin satırı (kendi + rakip; feedback pozisyon sızdırmaz). */
export type OnlineGuess = {
  id: number;
  matchId: string;
  guesser: string;
  digits: string;
  feedback: GuessFeedback;
  createdAt: string;
};

/** Eşleşme RPC'lerinin (quick/private) ortak dönüşü. */
export type MatchTicket = {
  matchId: string;
  role: PlayerRole;
  status: MatchStatus;
  /** Yalnızca create_private_room döndürür. */
  roomCode?: string;
};

/** make_guess / claim_timeout dönüşü: yalnızca çağırana ait güvenli sonuç. */
export type GuessOutcome = {
  matchId: string;
  status: MatchStatus;
  result: MatchResult | null;
  winner: string | null;
  /** claim_timeout ve timeout ile biten make_guess'te null. */
  feedback: GuessFeedback | null;
  currentTurn: string | null;
  clock1Ms: number;
  clock2Ms: number;
};

/** Maç sonu gizli sayı ifşası (get_match_reveal).
 *  Çağıranın bakış açısından; yalnızca maç finished olunca dolar. */
export type MatchReveal = {
  /** Çağıranın gizli sayısı (3 hane). */
  mine: string | null;
  /** Rakibin gizli sayısı — SADECE maç bitince gelir. */
  opponent: string | null;
};

/** Bir oyuncunun bağlantı bilgisi (presence tablosundan). */
export type PresenceInfo = {
  player: string;
  /** Son heartbeat'in sunucu zamanı (ISO). */
  lastSeen: string;
  /** İstemcinin bildirdiği kopuş anı (ISO); bağlıyken null. */
  disconnectedAt: string | null;
};
