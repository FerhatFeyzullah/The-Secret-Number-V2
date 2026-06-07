import { parseGuess } from '../game';
import { supabase } from '../supabase';
import {
  guessRowToGuess,
  matchRowToState,
  presenceRowToInfo,
  protocolUseRowToUse,
  type GuessRow,
  type MatchRow,
  type PresenceRow,
  type ProtocolUseRow,
} from './mapping';
import type {
  FirstTurnMode,
  GuessFeedback,
  GuessOutcome,
  LeaderboardEntry,
  MatchResult,
  MatchReveal,
  MyRank,
  MatchState,
  MatchStatus,
  MatchTicket,
  OnlineGuess,
  PlayerRole,
  PresenceInfo,
  ProtocolHand,
  ProtocolUse,
  ProtocolUseOutcome,
} from './types';

/** RPC'lerin fırlattığı, sunucu hata koduna göre Türkçe mesaj taşıyan hata. */
export class OnlineError extends Error {
  constructor(
    /** Sunucudaki raise exception metni (ör. not_your_turn) ya da yerel kod. */
    readonly code: string,
    message: string,
    /** Tanınmayan hatalarda sunucunun ham mesajı (teşhis için; UI detay gösterir). */
    readonly serverMessage?: string,
  ) {
    super(message);
    this.name = 'OnlineError';
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  // Yerel kodlar
  offline: 'Online mod yapılandırılmamış.',
  unknown: 'Beklenmeyen bir hata oluştu, lütfen tekrar dene.',
  // Sunucu (RPC) kodları
  not_authenticated: 'Oturum açman gerekiyor.',
  match_not_found: 'Maç bulunamadı.',
  not_a_player: 'Bu maçın oyuncusu değilsin.',
  not_in_setup: 'Maç sayı belirleme fazında değil.',
  setup_expired: 'Sayı belirleme süresi doldu.',
  setup_not_expired: 'Sayı belirleme süresi henüz dolmadı.',
  match_already_ready: 'İki oyuncu da sayısını belirlemiş.',
  invalid_digits: 'Geçersiz sayı: 1-9 arasından 3 farklı rakam olmalı.',
  match_not_active: 'Maç aktif değil.',
  not_your_turn: 'Sıra sende değil.',
  opponent_secret_missing: 'Rakibin sayısı bulunamadı, lütfen tekrar dene.',
  room_not_found: 'Oda bulunamadı, kodu kontrol et.',
  own_room: 'Kendi odana katılamazsın.',
  room_full: 'Oda dolu ya da oyun çoktan başlamış.',
  room_code_generation_failed: 'Oda kodu üretilemedi, lütfen tekrar dene.',
  clock_not_expired: 'Rakibin süresi henüz dolmadı.',
  cannot_claim_own_timeout: 'Kendi süren için zaman aşımı iddia edemezsin.',
  not_waiting: 'Maç artık beklemede değil.',
  match_not_finished: 'Maç henüz bitmedi.',
  profile_not_found: 'Profil bulunamadı.',
  invalid_clock: 'Geçersiz süre seçimi.',
  invalid_first_turn: 'Geçersiz ilk sıra seçimi.',
  // Protokol ekonomisi (Faz 2a)
  protocol_not_found: 'Protokol bulunamadı.',
  already_owned: 'Bu protokole zaten sahipsin.',
  level_too_low: 'Seviyen bu protokol için yetersiz.',
  insufficient_veri: 'Yetersiz Veri.',
  not_owned: 'Sahip olmadığın bir protokol seçtin.',
  // Protokol seçimi / Destiny's Hand (Faz 3 / Adım 3)
  not_in_select: 'Seçim fazı bitti.',
  no_hand: 'El bulunamadı.',
  not_in_hand: 'Elinde olmayan bir protokol seçtin.',
  invalid_selection: 'Geçersiz seçim.',
  too_many_selected: 'Yuva limitini aştın.',
  not_both_present: 'İki oyuncu da hazır değil.',
  select_not_expired: 'Seçim süresi henüz dolmadı.',
  // Protokol kullanımı (Faz 3 / Adım 4)
  not_protocol_match: 'Bu maçta protokol kullanılamaz.',
  protocol_not_selected: 'Bu protokol bu maç için seçili değil.',
  protocol_already_used: 'Bu protokolü bu maçta zaten kullandın.',
  protocol_not_implemented: 'Bu protokol henüz aktif değil.',
  time_expired: 'Süren doldu, protokol kullanılamaz.',
  no_digits_left: 'Elenecek rakam kalmadı.',
};

function toOnlineError(serverMessage: string | null | undefined): OnlineError {
  const known = !!serverMessage && serverMessage in ERROR_MESSAGES;
  const code = known ? (serverMessage as string) : 'unknown';
  // Tanınmayan hatada sunucunun ham metnini sakla (yutma — teşhis için yüzeye çıkar).
  return new OnlineError(code, ERROR_MESSAGES[code], known ? undefined : serverMessage ?? undefined);
}

function requireClient(): NonNullable<typeof supabase> {
  if (!supabase) throw new OnlineError('offline', ERROR_MESSAGES.offline);
  return supabase;
}

async function callRpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const client = requireClient();
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    // Teşhis: ham sunucu hatasını geliştirme konsoluna düş (UI'da yutulmasın).
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn(`[online] RPC "${fn}" hatası:`, error.message, error);
    }
    throw toOnlineError(error.message);
  }
  return data as T;
}

/** Tahmin/gizli sayıyı istemcide ön-doğrular; nihai otorite yine sunucudur. */
function assertValidDigits(digits: string): void {
  if (!parseGuess(digits).ok) {
    throw new OnlineError('invalid_digits', ERROR_MESSAGES.invalid_digits);
  }
}

// RPC'lerin jsonb dönüşleri (snake_case).
type TicketPayload = {
  match_id: string;
  role: PlayerRole;
  status: MatchStatus;
  room_code?: string;
};
type OutcomePayload = {
  match_id: string;
  status: MatchStatus;
  result: MatchResult | null;
  winner: string | null;
  feedback?: GuessFeedback | null;
  current_turn?: string | null;
  clock1_ms: number;
  clock2_ms: number;
};

function toTicket(p: TicketPayload): MatchTicket {
  return {
    matchId: p.match_id,
    role: p.role,
    status: p.status,
    ...(p.room_code ? { roomCode: p.room_code } : {}),
  };
}

function toOutcome(p: OutcomePayload): GuessOutcome {
  return {
    matchId: p.match_id,
    status: p.status,
    result: p.result,
    winner: p.winner,
    feedback: p.feedback ?? null,
    currentTurn: p.current_turn ?? null,
    clock1Ms: p.clock1_ms,
    clock2Ms: p.clock2_ms,
  };
}

/** Hızlı maç: bekleyen maça katıl ya da kuyruğa yeni maç aç (tek tur). */
export async function findOrCreateQuickMatch(): Promise<MatchTicket> {
  return toTicket(await callRpc<TicketPayload>('find_or_create_quick_match'));
}

/** Protokol maçı: ayrı kuyruk, Best of 3 (win_target=2). Quick'ten ayrı eşleşir. */
export async function findOrCreateProtocolMatch(): Promise<MatchTicket> {
  return toTicket(await callRpc<TicketPayload>('find_or_create_protocol_match'));
}

/** Destiny's Hand: çağıranın dağıtılan eli + seçimi + yuva sayısı + kendi
 *  kullanımları/elenenleri. Rakibin eli/elenenleri ASLA gelmez (sunucu RLS). */
export async function getMyHand(matchId: string): Promise<ProtocolHand> {
  const p = await callRpc<{
    hand?: string[];
    selected?: string[];
    slots?: number;
    uses?: { protocol_id: string; round: number }[];
    eliminations?: Record<string, number[]>;
  }>('get_my_hand', { p_match_id: matchId });
  return {
    hand: p.hand ?? [],
    selected: p.selected ?? [],
    slots: Number(p.slots ?? 2),
    uses: (p.uses ?? []).map((u) => ({ protocolId: u.protocol_id, round: u.round })),
    eliminations: p.eliminations ?? {},
  };
}

/** Maç içi protokol kullanımı (use_protocol RPC). TÜM doğrulama + ETKİ sunucuda;
 *  istemci yalnız sonucu okur. (Adı bilerek "use" ile başlamıyor — React hook
 *  değildir.) payload 4a'da kullanılmaz; parametreli protokoller için ayrılmıştır. */
export async function activateProtocol(
  matchId: string,
  protocolId: string,
  payload?: Record<string, unknown>,
): Promise<ProtocolUseOutcome> {
  const p = await callRpc<{
    match_id: string;
    protocol_id: string;
    round: number;
    clock1_ms?: number;
    clock2_ms?: number;
    eliminated_digit?: number;
    eliminated?: number[];
  }>('use_protocol', {
    p_match_id: matchId,
    p_protocol_id: protocolId,
    p_payload: payload ?? null,
  });
  return {
    matchId: p.match_id,
    protocolId: p.protocol_id,
    round: p.round,
    ...(p.clock1_ms != null ? { clock1Ms: p.clock1_ms } : {}),
    ...(p.clock2_ms != null ? { clock2Ms: p.clock2_ms } : {}),
    ...(p.eliminated_digit != null ? { eliminatedDigit: p.eliminated_digit } : {}),
    ...(p.eliminated ? { eliminated: p.eliminated } : {}),
  };
}

/** Maç başı protokol seçimini sunucuya kilitler (elde mi / yuva ≤ mı sunucuda
 *  doğrulanır; eksikse eldeki kartlardan rastgele tamamlanır). */
export async function setProtocolSelection(
  matchId: string,
  ids: string[],
): Promise<{ status: MatchStatus; selected: string[] }> {
  const p = await callRpc<{ status: MatchStatus; selected?: string[] }>('set_protocol_selection', {
    p_match_id: matchId,
    p_ids: ids,
  });
  return { status: p.status, selected: p.selected ?? [] };
}

/** Seçim süresi dolunca eksik seçimleri sunucuda rastgele tamamlatıp belirlemeye
 *  geçirir (idempotent; iki istemci de güvenle çağırabilir). */
export async function resolveProtocolSelect(matchId: string): Promise<{ status: MatchStatus }> {
  const p = await callRpc<{ status: MatchStatus }>('resolve_protocol_select', {
    p_match_id: matchId,
  });
  return { status: p.status };
}

/** Yeni özel oda açar; süre (kişi başı ms) + ilk sıra ayarlarıyla.
 *  Dönen roomCode rakiple paylaşılır. Varsayılanlar Hızlı Maç davranışıyla aynı. */
export async function createPrivateRoom(
  clockMs: number = 60000,
  firstTurnMode: FirstTurnMode = 'random',
): Promise<MatchTicket> {
  return toTicket(
    await callRpc<TicketPayload>('create_private_room', {
      p_clock_ms: clockMs,
      p_first_turn_mode: firstTurnMode,
    }),
  );
}

/** Koda göre özel odaya katılır (kod sunucuda normalize edilir). */
export async function joinPrivateRoom(code: string): Promise<MatchTicket> {
  return toTicket(await callRpc<TicketPayload>('join_private_room', { p_code: code }));
}

/** "Hazır'a bastı" işaretini gönderir (present = belirleme ekranına girdi).
 *  İki taraf da present olunca sunucu 30 sn'lik belirleme sayacını başlatır.
 *  Gizli sayı İÇERMEZ; yalnızca boolean hazır sinyalidir. Idempotent. */
export async function markReady(matchId: string): Promise<void> {
  await callRpc('mark_ready', { p_match_id: matchId });
}

/** Gizli sayını belirler; iki oyuncu da yazınca sunucu maçı başlatır. */
export async function setSecret(
  matchId: string,
  digits: string,
): Promise<{ status: MatchStatus }> {
  assertValidDigits(digits);
  const payload = await callRpc<{ status: MatchStatus }>('set_secret', {
    p_match_id: matchId,
    p_digits: digits,
  });
  return { status: payload.status };
}

/** Tahmin yapar; yalnızca çağırana ait güvenli sonucu döndürür. */
export async function makeGuess(matchId: string, digits: string): Promise<GuessOutcome> {
  assertValidDigits(digits);
  return toOutcome(
    await callRpc<OutcomePayload>('make_guess', {
      p_match_id: matchId,
      p_digits: digits,
    }),
  );
}

/** Sıradaki oyuncunun süresinin dolduğunu iddia eder; kararı sunucu verir. */
export async function claimTimeout(matchId: string): Promise<GuessOutcome> {
  return toOutcome(await callRpc<OutcomePayload>('claim_timeout', { p_match_id: matchId }));
}

/** 30 sn'dir kopuk rakibe karşı hükmen galibiyet ister; değilse no-op. */
export async function forfeitDisconnect(
  matchId: string,
): Promise<{ forfeited: boolean; status: MatchStatus; winner: string | null }> {
  const p = await callRpc<{
    forfeited: boolean;
    status: MatchStatus;
    winner?: string | null;
  }>('forfeit_disconnect', { p_match_id: matchId });
  return { forfeited: p.forfeited, status: p.status, winner: p.winner ?? null };
}

/** Setup süresi dolduysa maçı iptal ettirir (kazanan yok). */
export async function cancelSetupTimeout(
  matchId: string,
): Promise<{ status: MatchStatus; result: MatchResult }> {
  return callRpc('cancel_setup_timeout', { p_match_id: matchId });
}

/** Kuyruktan/odadan çıkış: bekleyen (waiting) maçı iptal eder.
 *  Doğrudan tablo update'i RLS gereği imkânsız; cancel_waiting RPC'si
 *  20260605000003 migration'ı ile eklendi.
 *  @deprecated Yalnızca waiting'i kapatır; her fazı doğru kapatan
 *  leaveMatch'i tercih et. Geriye dönük uyumluluk için duruyor. */
export async function cancelWaiting(matchId: string): Promise<void> {
  await callRpc('cancel_waiting', { p_match_id: matchId });
}

/** Maçtan çıkış (her faz için doğru davranış, 20260605000004 migration'ı):
 *  waiting/setup → iptal (kazanan yok), active → çıkan hükmen kaybeder,
 *  bitmiş → no-op (left=false döner, hata fırlatmaz). */
export async function leaveMatch(
  matchId: string,
): Promise<{ left: boolean; status: MatchStatus; result: MatchResult | null }> {
  const p = await callRpc<{
    left: boolean;
    status: MatchStatus;
    result?: MatchResult | null;
  }>('leave_match', { p_match_id: matchId });
  return { left: p.left, status: p.status, result: p.result ?? null };
}

/** Bağlı olduğunu bildirir (last_seen=now, disconnected_at=null). */
export async function heartbeat(matchId: string): Promise<void> {
  await callRpc('heartbeat', { p_match_id: matchId });
}

/** Lider tablosu: puana göre azalan ilk 100 (yalnızca okuma; rank eşit puanda eşit). */
export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const rows = await callRpc<
    { rank: number; user_id: string; username: string | null; rating: number; wins: number }[]
  >('get_leaderboard');
  return (rows ?? []).map((r) => ({
    rank: Number(r.rank),
    userId: r.user_id,
    username: r.username,
    rating: Number(r.rating),
    wins: Number(r.wins),
  }));
}

/** Çağıranın kendi sırası/istatistikleri (top 100 dışında da çalışır). */
export async function getMyRank(): Promise<MyRank> {
  const p = await callRpc<{
    rank: number;
    username: string | null;
    rating: number;
    wins: number;
    played?: number;
    streak?: number;
    xp?: number;
    level?: number;
    veri?: number;
    level_floor?: number | null;
    level_next?: number | null;
    owned_protocols?: string[] | null;
  }>('get_my_rank');
  return {
    rank: Number(p.rank),
    username: p.username,
    rating: Number(p.rating),
    wins: Number(p.wins),
    // Migration 20260606000000 öncesi sunucuya karşı güvenli varsayılanlar.
    played: Number(p.played ?? 0),
    streak: Number(p.streak ?? 0),
    // Migration 20260607000000 öncesi sunucuya karşı güvenli varsayılanlar.
    xp: Number(p.xp ?? 0),
    level: Number(p.level ?? 1),
    veri: Number(p.veri ?? 0),
    levelFloor: Number(p.level_floor ?? 0),
    levelNext: p.level_next == null ? null : Number(p.level_next),
    // Migration 20260607000002 (protokoller) öncesi güvenli varsayılan.
    owned: p.owned_protocols ?? [],
  };
}

/** Protokolü Veri ile açar (seviye/Veri/sahiplik sunucuda doğrulanır, atomik).
 *  Dönen değer: güncel Veri + sahip olunan protokol id'leri. */
export async function unlockProtocol(
  id: string,
): Promise<{ veri: number; owned: string[] }> {
  const p = await callRpc<{ veri: number; owned: string[] }>('unlock_protocol', { p_id: id });
  return { veri: Number(p.veri), owned: p.owned ?? [] };
}


/** Maç sonu gizli sayı ifşası (yalnızca finished + çağıran oyuncu).
 *  Çağıranın bakış açısından kendi ve rakip sayısı; satır yoksa null.
 *  Maç bitmeden çağrılırsa sunucu 'match_not_finished' fırlatır. */
export async function getMatchReveal(matchId: string): Promise<MatchReveal> {
  const p = await callRpc<{ mine: string | null; opponent: string | null }>('get_match_reveal', {
    p_match_id: matchId,
  });
  return { mine: p.mine ?? null, opponent: p.opponent ?? null };
}

async function currentUserId(): Promise<string | null> {
  const client = requireClient();
  const { data } = await client.auth.getSession();
  return data.session?.user.id ?? null;
}

/** Maçın güvenli durumunu çeker; satır yok/oyuncu değilsen null. */
export async function fetchMatchState(matchId: string): Promise<MatchState | null> {
  const client = requireClient();
  const myId = await currentUserId();
  if (!myId) throw new OnlineError('not_authenticated', ERROR_MESSAGES.not_authenticated);

  const { data, error } = await client
    .from('matches')
    .select('*')
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw toOnlineError(error.message);
  if (!data) return null;

  const row = data as MatchRow;
  // Profil adları: profiles RLS'i şimdilik yalnızca kendi satırını okutur;
  // in() sorgusu izinli olanları döndürür, rakip adı null kalır (ileride
  // lider tablosu politikası/RPC'siyle dolacak).
  const ids = [row.player1, row.player2].filter((v): v is string => Boolean(v));
  const usernames: Record<string, string> = {};
  const { data: profiles } = await client
    .from('profiles')
    .select('id, username')
    .in('id', ids);
  for (const p of profiles ?? []) {
    if (p.username) usernames[p.id] = p.username;
  }
  return matchRowToState(row, myId, usernames);
}

/** Maçın tahmin geçmişi (kendi + rakip), eskiden yeniye. */
export async function fetchGuesses(matchId: string): Promise<OnlineGuess[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('guesses')
    .select('*')
    .eq('match_id', matchId)
    .order('created_at', { ascending: true });
  if (error) throw toOnlineError(error.message);
  return ((data ?? []) as GuessRow[]).map(guessRowToGuess);
}

/** Maçın presence satırları (iki oyuncunun bağlantı durumu). */
export async function fetchPresence(matchId: string): Promise<PresenceInfo[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('presence')
    .select('*')
    .eq('match_id', matchId);
  if (error) throw toOnlineError(error.message);
  return ((data ?? []) as PresenceRow[]).map(presenceRowToInfo);
}

/** Maçın protokol kullanım kayıtları (iki oyuncununki; sır içermez).
 *  Şerit "kullanıldı" durumu + yeniden bağlanınca senkron için. */
export async function fetchProtocolUses(matchId: string): Promise<ProtocolUse[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('match_protocol_uses')
    .select('*')
    .eq('match_id', matchId)
    .order('id', { ascending: true });
  if (error) throw toOnlineError(error.message);
  return ((data ?? []) as ProtocolUseRow[]).map(protocolUseRowToUse);
}
