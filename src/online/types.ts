import type { ContentTypeId } from '../game';

/** Sunucudaki matches.status değerleri. */
export type MatchStatus =
  | 'waiting'
  | 'protocol_select'
  | 'setup'
  | 'active'
  | 'finished'
  | 'cancelled'
  | 'abandoned';

/** Maç modu: hızlı eşleşme (tek tur), protokol maçı (Best of 3) ya da özel oda. */
export type MatchMode = 'quick' | 'protocol' | 'private';

/** Özel odada ilk tahmin sırası: rastgele ya da oda kuran (player1) başlar. */
export type FirstTurnMode = 'random' | 'creator';

/** Özel oda oyun modu (kamudaki karşılığının kurallarını birebir yansıtır):
 *  'quick' → Hızlı (sayı, tek tur) · 'protocol' → Protokol (sayı, Bo3) ·
 *  'word' → Kelime (Bo3 + Wordle). Hepsi dostluk maçıdır (skora saymaz). */
export type PrivateRoomMode = 'quick' | 'protocol' | 'word';

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
  | 'partial:3' // kelime modunda (4-6 harf) mümkün; sayıda üretilmez
  | 'partial:4'
  | 'partial:5'
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
  /** Gizli içeriğin tipi ('number' | 'word'). */
  contentType: ContentTypeId;
  /** Kelime maçında harf uzunluğu (4-6, maç başına random; iki oyuncuya aynı).
   *  Number maçlarda null. */
  wordLength: number | null;
  roomCode: string | null;
  /** Dostluk maçı mı (özel oda): true ise hiçbir kalıcı etki yok — ELO/XP/Veri/
   *  lig/istatistik değişmez (sunucu garantisi). Gösterim/etiket için. */
  isFriendly: boolean;
  player1: MatchPlayer;
  player2: MatchPlayer | null;
  /** Çağıranın rolü (maçın oyuncusu değilse state hiç üretilmez). */
  myRole: PlayerRole;
  /** Maçı kazanmak için gereken tur sayısı (quick=1, protocol=2 → Best of 3). */
  winTarget: number;
  /** Şu anki tur (1..). Her turun kendi gizli sayısı/tahminleri vardır. */
  currentRound: number;
  /** player1/player2'nin kazandığı tur sayısı. */
  p1RoundWins: number;
  p2RoundWins: number;
  /** KELİME YARIŞI: rakibe İNEN tek ilerleme verisi — o oyuncunun BU TURDAKİ en
   *  iyi yeşil/sarı harf SAYISI (per-harf dizi ASLA taşınmaz; harf sızmaz). Tur
   *  başında 0'a döner. Diğer modlarda 0 (kullanılmaz). */
  p1BestGreen: number;
  p1BestYellow: number;
  p2BestGreen: number;
  p2BestYellow: number;
  /** Sırası gelen oyuncunun id'si (active dışında null). */
  currentTurn: string | null;
  clock1Ms: number;
  clock2Ms: number;
  /** Konfig: kişi başı TUR başına süre (ms; her tur başında sıfırlanır).
   *  Özel oda 60/90/120/180 sn; sayı quick 60 sn; kelime quick 180 sn. */
  clockMs: number;
  /** Konfig: ilk tahmin sırası ('random' | 'creator'). */
  firstTurnMode: FirstTurnMode;
  /** Sıranın başladığı sunucu zamanı (ISO); görsel geri sayım bundan türetilir. */
  turnStartedAt: string | null;
  /** Dondur (time_freeze): mevcut turun oyuncusunun saati işlemiyor. */
  turnFrozen: boolean;
  /** Yavaşlat (time_slow): player1/player2'nin mevcut-veya-sıradaki turu 1.5×
   *  akar; o tur bitince sunucu söndürür. Görsel saat hesabına yansır. */
  turnSlowP1: boolean;
  turnSlowP2: boolean;
  /** Sis Perdesi: o oyuncunun SONRAKİ tahmini gecikmeli gösterilir. */
  fogP1: boolean;
  fogP2: boolean;
  /** Susturma: o oyuncu (sıradaki turu bitene kadar) protokol kullanamaz. */
  silencedP1: boolean;
  silencedP2: boolean;
  /** Sayı belirleme fazının bitiş anı (ISO). İki taraf da "Hazır" (present)
   *  olunca kurulur; o ana kadar null (sayaç başlamaz). */
  setupDeadline: string | null;
  /** Protokol seçim fazının (Destiny's Hand) bitiş anı (ISO); yalnız
   *  status='protocol_select' iken, iki taraf present olunca kurulur (20 sn). */
  selectDeadline: string | null;
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
  /** Tahminin yapıldığı tur (Best of 3'te tura göre filtrelenir). */
  round: number;
  createdAt: string;
  /** Sis Perdesi: bu tahminin feedback'i 4 sn maskeyle gösterilir (yalnız
   *  gösterim; değerlendirme sunucuda aynen yapılmıştır). */
  fogged?: boolean;
  /** KELİME modu: bu tahmindeki YEŞİL (doğru harf+pozisyon) harf sayısı. Rakip
   *  ilerleme kartı bunu gösterir ("N/uzunluk"). YALNIZ sayı — per-harf dizi
   *  DEĞİL (rakibe pozisyon sızmaz). SAYI modunda yok. Per-harf renkler ayrı
   *  kanaldan, yalnız tahmini yapan oyuncuya gelir (bkz. getMyMarks). */
  greenCount?: number;
  /** KELİME modu: bu tahmindeki SARI (doğru harf, yanlış pozisyon) harf sayısı.
   *  greenCount ile aynı mantık — rakip-güvenli SAYI (per-harf dizi değil). Rakip
   *  ilerleme kartı "en iyi sarı"yı buradan türetir. SAYI modunda yok. */
  yellowCount?: number;
};

/** Bilgi protokollerinin verdiği kalıcı ipuçları (yalnız çağıranın; tur bazlı).
 *  readlast: rakibin son tahmini + ALDIĞI feedback (ekstra sızdırma yok) ·
 *  postest: tek rakam+pozisyon evet/hayır · reveal: sayıdaki bir rakam
 *  (pozisyonsuz). Gizli sayının tamamını temsil eden hiçbir şekil yoktur. */
export type ProtocolHint =
  | { t: 'readlast'; digits: string; feedback: GuessFeedback }
  | { t: 'postest'; digit: number; pos: number; match: boolean }
  | { t: 'reveal'; digit: number };

/** Çağıranın protokol maçı eli + seçimi (get_my_hand).
 *  Rakibin eli/seçimi/elenenleri/ipuçları ASLA gelmez (sunucu RLS). */
export type ProtocolHand = {
  /** Sunucuda dağıtılan el (sahip olunanlardan rastgele yuva+3, sahip ile sınırlı). */
  hand: string[];
  /** Kilitlenmiş seçim (henüz seçmediyse boş). */
  selected: string[];
  /** Seviyeye göre yuva sayısı (Sv1-3 → 2, Sv4+ → 3). */
  slots: number;
  /** KENDİ protokol kullanımların (şerit "kullanıldı" durumu; Faz 3 / Adım 4). */
  uses: { protocolId: string; round: number; outcome?: ProtocolUseOutcomeKind }[];
  /** Eleme'nin verdiği "sayıda yok" rakamları, tur → rakamlar (yalnız kendi). */
  eliminations: Record<string, number[]>;
  /** Bilgi protokolü ipuçları, tur → liste (yalnız kendi; Adım 4b). */
  hints: Record<string, ProtocolHint[]>;
  /** Kurulu savunmalar (yalnız kendi; ilk engele kadar bekler; Adım 4c). */
  shieldArmed: boolean;
  reflectArmed: boolean;
};

/** Kullanım kaydının sonucu: applied = etki uygulandı · blocked = hedefin
 *  Kalkanı blokladı · reflected = hedefin Yansıtması gönderene çevirdi ·
 *  wasted = Zorla Harca kurbanının protokolü etkisiz tüketildi (satır
 *  kurbana aittir). */
export type ProtocolUseOutcomeKind = 'applied' | 'blocked' | 'reflected' | 'wasted';

/** Maç içi tek protokol kullanım kaydı (match_protocol_uses; sır içermez —
 *  iki oyuncu da görür, "rakip X kullandı" bildirimi buradan). */
export type ProtocolUse = {
  id: number;
  matchId: string;
  player: string;
  protocolId: string;
  round: number;
  createdAt: string;
  /** Counter zinciri sonucu (Adım 4c); eski kayıtlarda 'applied'. */
  outcome: ProtocolUseOutcomeKind;
};

/** use_protocol dönüşü: yalnız çağırana ait güvenli sonuç.
 *  Etkiye göre alanlar dolar; gizli sayının tamamı hiçbir alanda yoktur. */
export type ProtocolUseOutcome = {
  matchId: string;
  protocolId: string;
  round: number;
  /** false → etki boşa gitti, hak HARCANMADI (örn. readlast'ta rakip
   *  tahminsiz). Yokken true varsayılır. */
  consumed?: boolean;
  /** Saat etkileri (time_add/steal/freeze): güncel saatler. */
  clock1Ms?: number;
  clock2Ms?: number;
  /** info_eliminate: rakibin BU TURDAKİ sayısında OLMAYAN rakam. */
  eliminatedDigit?: number;
  /** info_eliminate: bu turda verilen tüm "yok" rakamları. */
  eliminated?: number[];
  /** info_readlast: rakibin son tahmini + aldığı feedback. */
  digits?: string;
  feedback?: GuessFeedback;
  /** info_readlast: rakip bu turda henüz tahmin yapmadı (consumed=false). */
  noGuess?: boolean;
  /** info_postest: sorulan rakam/pozisyon + evet/hayır. */
  digit?: number;
  position?: number;
  match?: boolean;
  /** info_reveal: rakibin sayısında VAR olan bir rakam (pozisyonsuz). */
  revealedDigit?: number;
  /** time_steal: gerçekten çalınan süre (floor: rakip 5 sn altına inmez). */
  stolenMs?: number;
  /** time_freeze: bu turda kendi saatin donduruldu. */
  frozen?: boolean;
  /** time_slow: rakibin sıradaki turu 1.5× akacak. */
  slowed?: boolean;
  /** Engel sınıfı: counter zinciri sonucu (applied/blocked/reflected). */
  outcome?: ProtocolUseOutcomeKind;
  /** Engel: hedefin Kalkanı blokladı (Kalkan + engel tükendi). */
  blocked?: boolean;
  /** Engel: hedefin Yansıtması gönderene çevirdi (etki SANA uygulandı). */
  reflected?: boolean;
  /** disrupt_waste: hedefte tüketilen protokol id'si. */
  wastedProtocol?: string;
  /** disrupt_waste: hedefin harcanacak protokolü yoktu (consumed=false). */
  noTargetProtocol?: boolean;
  /** def_shield / def_reflect: savunma kuruldu. */
  armed?: 'shield' | 'reflect';
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
  /** Sis Perdesi: bu tahminin feedback'i gecikmeli gösterilmeli (4 sn). */
  fogged?: boolean;
  /** KELİME modu: bu (ÇAĞIRANA ait) tahminin per-harf Wordle renkleri 'GYX'
   *  dizisi. YALNIZ tahmini yapan oyuncuya döner — rakip asla almaz. SAYI'da yok. */
  marks?: string;
  /** KELİME modu: bu tahmindeki yeşil sayısı (satıra da yazılır; rakip kartı). */
  greenCount?: number;
  /** Eklenen tahmin satırının id'si — istemci kendi tahtasını marks ile eşler. */
  guessId?: number;
};

/** KELİME YARIŞI: word_race_guess dönüşü. 'round_won'/'match_won' YALNIZ turu
 *  ÇÖZEN oyuncuya döner; kaybeden sonucu realtime maç-satırı değişiminden öğrenir
 *  (current_round++ / round_wins / status). */
export type WordRaceOutcome = {
  status: 'playing' | 'round_won' | 'match_won';
  /** Bu (çağırana ait) tahminin per-harf Wordle renkleri ('GYXXX'; G=doğru yer,
   *  Y=yanlış yer, X=yok). Kendi tahtanı boyamak için. */
  marks: string;
  /** Bu tahmindeki yeşil (doğru yer) harf sayısı. */
  greenCount: number;
  /** Bu tahmindeki sarı (doğru harf, yanlış yer) sayısı. */
  yellowCount: number;
  /** Tur ortak geri sayımından kalan (ms) — istemci saatini resync eder. */
  remainingMs: number;
  p1RoundWins: number;
  p2RoundWins: number;
  /** Güncel tur (tur çözülünce sunucu artırdıysa yeni tur numarası). */
  currentRound: number;
  /** Yalnız tur bitince (round_won/match_won) kararlaşan turun gizli kelimesi;
   *  aksi halde null. */
  reveal: string | null;
};

/** KELİME YARIŞI: claim_word_race_timeout dönüşü (süre dolunca ilerlemeye göre
 *  turu böler). Süre dolmadıysa sunucu 'clock_not_expired' fırlatır. */
export type WordRaceTimeoutOutcome = {
  status: 'playing' | 'round_won' | 'match_won';
  /** Kararlaşan turun gizli kelimesi (dolduysa); zaten çözülmüşse null. */
  reveal: string | null;
  p1RoundWins: number;
  p2RoundWins: number;
  currentRound: number;
  remainingMs: number;
};

/** Maç sonu gizli sayı ifşası (get_match_reveal).
 *  Çağıranın bakış açısından; yalnızca maç finished olunca dolar. */
export type MatchReveal = {
  /** Çağıranın gizli sayısı (3 hane). */
  mine: string | null;
  /** Rakibin gizli sayısı — SADECE maç bitince gelir. */
  opponent: string | null;
  /** Maç ilerleme saydı mı (matchmade quick/protocol). false → özel oda/saymayan. */
  scored: boolean;
  /** Bu maçtan çağıranın Kupa/XP/Veri değişimi (sunucu hesaplar; saymıyorsa null). */
  ratingDelta: number | null;
  xpDelta: number | null;
  veriDelta: number | null;
};

/** Tur-bazlı gizli ifşa (get_round_reveal). Yalnızca KARARLAŞMIŞ tur için dolar
 *  (biten tur veya bitmiş son tur); canlı turda sunucu 'round_not_revealable' fırlatır.
 *  Tur-arası "break" ekranında iki oyuncunun o turdaki gizlisini göstermek için. */
export type RoundReveal = {
  /** Çağıranın o turdaki gizli kelimesi/sayısı; satır yoksa null. */
  mine: string | null;
  /** Rakibin o turdaki gizlisi; satır yoksa null (setup-timeout ile biten tur). */
  opponent: string | null;
};

/** Lider tablosu satırı (get_leaderboard; yalnızca okuma, puan sunucuda hesaplanır). */
export type LeaderboardEntry = {
  rank: number;
  userId: string;
  username: string | null;
  rating: number;
  wins: number;
};

/** Çağıranın kendi sırası + istatistikleri (get_my_rank); top 100 dışında da
 *  geçerli. Başarı oranı saklanmaz, wins/played'den türetilir. */
export type MyRank = {
  rank: number;
  username: string | null;
  rating: number;
  wins: number;
  /** Oynanan quick+finished maç sayısı (cancelled/abandoned hariç). */
  played: number;
  /** Güncel galibiyet serisi (yalnızca Hızlı Maç; sunucuda tutulur). */
  streak: number;
  /** Toplam deneyim puanı; YALNIZCA sunucuda artar (kazanan +90, kaybeden +25). */
  xp: number;
  /** Seviye 1-10; XP eşik tablosundan sunucuda hesaplanır. */
  level: number;
  /** Veri parası; YALNIZCA sunucuda artar (kazanan +70, kaybeden +15). */
  veri: number;
  /** Mevcut seviyenin alt XP eşiği (ilerleme çubuğunun 0 noktası). */
  levelFloor: number;
  /** Sonraki seviyenin XP eşiği; maks seviyede (10) null. */
  levelNext: number | null;
  /** Sahip olunan protokol id'leri (Faz 2a). */
  owned: string[];
  /** Sahip olunan sinyal id'leri (Sinyal Adım 2). */
  ownedSignals: string[];
  /** Kalıcı sinyal destesi (≤6) — maç sonu reaksiyonları (Sinyal Adım 2). */
  signalDeck: string[];
  /** Güncel sezon kimliği (Lig sistemi); haftalık sıfırlamada artar. Lig
   *  migration'ı öncesi sunucuya karşı null. İstemci yeni sezonu bundan algılar. */
  seasonId: number | null;
};

/** Bir oyuncunun bağlantı bilgisi (presence tablosundan). */
export type PresenceInfo = {
  player: string;
  /** Son heartbeat'in sunucu zamanı (ISO). */
  lastSeen: string;
  /** İstemcinin bildirdiği kopuş anı (ISO); bağlıyken null. */
  disconnectedAt: string | null;
};

/** Global "Son Maçlar" akışı — tek turun ifşası (get_recent_matches RPC). */
export type RecentMatchRound = {
  round: number;
  /** Oyuncu1'in o turdaki gizlisi (sayı ya da kelime); yoksa null. */
  p1Secret: string | null;
  p2Secret: string | null;
  /** Turu kazanan taraf. */
  winner: 1 | 2;
};

/** Global "Son Maçlar" akışı — tek maç özeti. */
export type RecentMatch = {
  matchId: string;
  mode: 'quick' | 'protocol';
  contentType: 'number' | 'word' | 'wordrace';
  winTarget: number;
  player1Name: string | null;
  player2Name: string | null;
  /** Kazanan oyuncu1 mi (renk/kupa yönü için). */
  p1Won: boolean;
  result: 'win' | 'timeout' | 'forfeit' | null;
  p1RoundWins: number;
  p2RoundWins: number;
  /** Maçta kazanılan/kaybedilen kupa (rating). Kazananda +, kaybedende −. */
  p1RatingDelta: number | null;
  p2RatingDelta: number | null;
  rounds: RecentMatchRound[];
};

// ─── Klan sistemi (Faz 1) ──────────────────────────────────────────────────

/** Saklanan klan rolü. UI etiketi: leader→Operatör, coleader→Şifreci,
 *  member→Ajan (kıdemliyse) / Çaylak. */
export type ClanRole = 'leader' | 'coleader' | 'member';

/** Katılım modu. 'invite' veri modelinde var ama Faz 1'de kurulamaz. */
export type ClanJoinMode = 'open' | 'approval' | 'invite';

/** Amblem: hazır parçalardan (şekil + ikon + renk). Sunucuda jsonb saklanır. */
export type ClanEmblem = {
  shape: string;
  icon: string;
  color: string;
};

/** Klan üyesi (get_my_clan.members). */
export type ClanMember = {
  player: string;
  username: string;
  role: ClanRole;
  /** Kupa (rating). */
  rating: number;
  /** Katıldıktan sonra kazanılan klan galibiyeti (Ajan türetimi). */
  contribution: number;
  joinedAt: string;
};

/** Bekleyen katılım isteği (yönetici görünümü). */
export type ClanRequest = {
  player: string;
  username: string;
  rating: number;
  createdAt: string;
};

/** Tam klan görünümü (get_my_clan). */
export type Clan = {
  id: string;
  name: string;
  description: string;
  emblem: ClanEmblem | null;
  joinMode: ClanJoinMode;
  minTrophies: number;
  memberCount: number;
  /** Lider (owner) oyuncu id'si. */
  owner: string;
  /** Oturum açan oyuncunun bu klandaki rolü. */
  myRole: ClanRole;
  /** Klan skoru = üyelerin Kupa toplamı (Faz 2a). */
  score: number;
  /** Global klan sıralaması (1 = en yüksek skor) (Faz 2a). */
  rank: number;
  members: ClanMember[];
  /** Bekleyen istekler — yalnız yönetici (leader/coleader) için dolu; değilse []. */
  requests: ClanRequest[];
};

/** Klan lider tablosu satırı (get_clan_leaderboard). */
export type ClanLeaderboardEntry = {
  rank: number;
  id: string;
  name: string;
  emblem: ClanEmblem | null;
  memberCount: number;
  score: number;
};

/** Dizin/arama kartı (list_clans, get_my_requests). */
export type ClanCard = {
  id: string;
  name: string;
  emblem: ClanEmblem | null;
  joinMode: ClanJoinMode;
  minTrophies: number;
  memberCount: number;
};

/** Klan sohbet mesajı (Faz 3). username istemcide üye listesinden çözülür. */
export type ClanMessage = {
  id: string;
  clanId: string;
  player: string;
  body: string;
  createdAt: string;
};

// ─── Klan içi meydan okuma (Faz 2b) ────────────────────────────────────────

export type ChallengeStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired';

/** Karşıya gelen davet (üstten kayan kart için). */
export type IncomingChallenge = {
  id: string;
  fromPlayer: string;
  fromUsername: string;
  mode: PrivateRoomMode;
  clockMs: number;
  firstTurn: FirstTurnMode;
  wordLength: number | null;
  expiresAt: string;
};

/** Tam davet satırı (realtime; giden/gelen durum takibi). */
export type ChallengeFull = {
  id: string;
  fromPlayer: string;
  fromUsername: string;
  toPlayer: string;
  mode: PrivateRoomMode;
  clockMs: number;
  firstTurn: FirstTurnMode;
  wordLength: number | null;
  status: ChallengeStatus;
  rejectMessage: string | null;
  matchId: string | null;
  expiresAt: string;
};

// ─── Turnuva: Gizemli Kule (haftalık PvE gauntlet) ───────────────────────────

/** Bir katın "fantastik" twist'i. Geri bildirimi bozanlar SUNUCUDA uygulanır;
 *  istemci yalnız rozet/kozmetik ipucu için okur. */
export type TowerTwistKind =
  | 'fog' // gösterimde yeşil+sarı 'P' maskelenir; gri (X) kalır
  | 'time_thief' // yanlış tahminde her gri (X) hane için -1sn
  | 'cursed' // gizlide olmayan 1-2 harf lanetli; guess'te her geçiş -3sn
  | 'memory'; // sorgular 3sn sonra kaybolur (istemci-taraflı)

export type TowerTwist = {
  kind: TowerTwistKind;
  params?: Record<string, number | string>;
};

/** Boss ödülü olarak verilebilecek varlık (mevcut protokol/sinyal kataloğundan). */
export type TowerBossItem = { kind: 'protocol' | 'signal'; id: string };

/** Statik kat konfigü (tüm oyuncular aynı; gizli kelime İÇERMEZ). */
export type TowerFloorConfig = {
  floorNo: number;
  wordLength: number;
  clockMs: number;
  twists: TowerTwist[];
  veriReward: number;
  isBoss: boolean;
  /** Boss katında ödül önizlemesi (havuzun ilk item'ı); non-boss'ta null. */
  itemPreview: TowerBossItem | null;
};

export type TowerRunStatus = 'active' | 'cleared' | 'eliminated';

export type TowerRun = {
  currentFloor: number;
  lives: number;
  status: TowerRunStatus;
  floorsCleared: number;
  /** Ardışık geçiş sayacı (kupa için; kayıpta 0). Sıradaki kat kupası = 10 + 2*winStreak. */
  winStreak: number;
};

/** Aktif kat tahtasındaki bir tahmin satırı (marks GÖSTERİM: 'G'/'Y'/'X'/'P').
 *  'P' = Sis: kelimede var ama yeşil/sarı gizli. */
export type TowerBoardGuess = { guess: string; marks: string; greenCount: number };

/** Oyuncunun aktif katı (gizli kelime İÇERMEZ). */
export type TowerActiveFloor = {
  floorNo: number;
  wordLength: number;
  remainingMs: number;
  twists: TowerTwist[];
  /** Saat başladı mı? false = ilk-karşılaşma modalı bekleniyor (begin_tower_floor ile başlar). */
  started: boolean;
  /** Lanetli harfler (gizlide yok; kullanınca ceza). */
  cursedLetters: string[];
  guesses: TowerBoardGuess[];
  solved1: boolean;
  solved2: boolean;
};

export type TowerState = {
  period: { id: number | null; endsAt: string | null };
  run: TowerRun | null;
  floors: TowerFloorConfig[];
  active: TowerActiveFloor | null;
  veri: number;
};

/** Bir kat geçilince/boss'ta kazanılan ödül. converted = boss item zaten
 *  sahipti → Veri'ye çevrildi. */
export type TowerReward = {
  veri: number;
  /** Kat geçişinde kazanılan Kupa (rating). */
  kupa: number;
  itemKind: 'protocol' | 'signal' | null;
  itemId: string | null;
  converted: boolean;
};

export type TowerOutcomeStatus =
  | 'playing'
  | 'floor_cleared'
  | 'floor_failed'
  | 'tower_cleared'
  | 'eliminated'
  | 'left'; // başlamamış kattan serbest çıkış (can gitmez)

/** tower_guess / claim_tower_timeout sonucu. reveal yalnız kat sonuçlanınca. */
export type TowerGuessOutcome = {
  status: TowerOutcomeStatus;
  /** Bu tahminin gösterim marks'ı ('playing'/win). Fail/timeout'ta null. */
  marks: string | null;
  /** 'double' twist'i ikinci kelime marks'ı (v2). */
  marks2?: string | null;
  greenCount: number;
  /** 'playing'te kalan süre; sonuçlanınca null. */
  remainingMs: number | null;
  lives: number;
  solved1?: boolean;
  solved2?: boolean;
  /** Kat geçilince ödül; aksi halde null. */
  reward: TowerReward | null;
  /** Kat sonuçlanınca (fail/timeout/clear) gizli kelime ifşası. */
  reveal: { secret: string | null; secret2: string | null } | null;
};
