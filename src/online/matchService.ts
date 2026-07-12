import { parseGuess, parseWord, type ContentTypeId } from '../game';
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
  RoundReveal,
  MyRank,
  MatchState,
  MatchStatus,
  MatchTicket,
  OnlineGuess,
  PlayerRole,
  PresenceInfo,
  PrivateRoomMode,
  ProtocolHand,
  ProtocolHint,
  ProtocolUse,
  ProtocolUseOutcome,
  ProtocolUseOutcomeKind,
  RecentMatch,
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
  timeout: 'Sunucu yanıt vermedi, lütfen tekrar dene.',
  // Sunucu (RPC) kodları
  not_authenticated: 'Oturum açman gerekiyor.',
  match_not_found: 'Maç bulunamadı.',
  not_a_player: 'Bu maçın oyuncusu değilsin.',
  not_in_setup: 'Maç sayı belirleme fazında değil.',
  setup_expired: 'Sayı belirleme süresi doldu.',
  setup_not_expired: 'Sayı belirleme süresi henüz dolmadı.',
  not_inter_round: 'Tur arası belirleme fazında değil.',
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
  wrong_pin: 'PIN geçersiz.',
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
  invalid_payload: 'Geçersiz seçim: rakam 1-9, pozisyon 1-3 olmalı.',
  silenced: 'Susturuldun — bu sıra protokol kullanamazsın.',
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

/** İstemci-taraflı istek zaman aşımı: ağ sessizce ölürse (hücresel geçiş, ölü
 *  websocket) supabase-js'in fetch'i dakikalarca asılı kalabilir → busy kilitleri
 *  hiç açılmaz, tuş takımı donar. Bu sarmalayıcı ~10 sn sonra reddeder ki catch/
 *  finally çalışsın. AbortController yerine Promise yarışı kullanılır: mevcut
 *  testler rpc'yi düz promise mock'luyor, .abortSignal() zinciri onları kırardı.
 *  Sunucu otoritesi değişmez; geç gelen yanıt realtime/poll ile senkronlanır. */
const REQUEST_TIMEOUT_MS = 10_000;

function withTimeout<T>(p: PromiseLike<T>, ms = REQUEST_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new OnlineError('timeout', ERROR_MESSAGES.timeout)), ms);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function callRpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const client = requireClient();
  const { data, error } = await withTimeout(client.rpc(fn, args));
  if (error) {
    // Teşhis: ham sunucu hatasını geliştirme konsoluna düş (UI'da yutulmasın).
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn(`[online] RPC "${fn}" hatası:`, error.message, error);
    }
    throw toOnlineError(error.message);
  }
  return data as T;
}

/** Tahmin/gizli içeriği istemcide ön-doğrular; nihai otorite yine sunucudur.
 *  İçerik tipine göre DOĞRU parser kullanılır: sayı → parseGuess (3 rakam),
 *  kelime → parseWord (4-6 TR harf; havuz üyeliği yalnız sunucuda). */
function assertValidDigits(digits: string, contentType: ContentTypeId = 'number'): void {
  const ok = contentType === 'word' ? parseWord(digits).ok : parseGuess(digits).ok;
  if (!ok) {
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
  fogged?: boolean;
  /** KELİME: çağıranın per-harf renkleri ('GYX'); number dönüşünde null/yok. */
  marks?: string | null;
  /** KELİME: yeşil sayısı; number'da null. */
  green_count?: number | null;
  /** KELİME: eklenen tahmin satırı id'si; number'da null. */
  guess_id?: number | null;
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
    // Yalnız işaretliyken eklenir (eski dönüş/teste şekil-uyumlu).
    ...(p.fogged ? { fogged: true } : {}),
    // Kelime: çağıranın per-harf renkleri + yeşil sayısı + satır id'si;
    // number dönüşünde hepsi null → eklenmez (eski şekil korunur).
    ...(p.marks ? { marks: p.marks } : {}),
    ...(p.green_count != null ? { greenCount: p.green_count } : {}),
    ...(p.guess_id != null ? { guessId: p.guess_id } : {}),
  };
}

/** Hızlı maç: bekleyen maça katıl ya da kuyruğa yeni maç aç (tek tur).
 *  contentType 'word' ise ayrı kelime kuyruğuna girer; sunucu maça random
 *  uzunluk (4-6) atar. 'number' default'ta parametre gönderilmez (geriye uyumlu). */
export async function findOrCreateQuickMatch(
  contentType: ContentTypeId = 'number',
): Promise<MatchTicket> {
  return toTicket(
    await callRpc<TicketPayload>(
      'find_or_create_quick_match',
      contentType === 'number' ? undefined : { p_content_type: contentType },
    ),
  );
}

/** Protokol maçı: ayrı kuyruk, Best of 3 (win_target=2). Quick'ten ayrı eşleşir. */
export async function findOrCreateProtocolMatch(): Promise<MatchTicket> {
  return toTicket(await callRpc<TicketPayload>('find_or_create_protocol_match'));
}

/** Destiny's Hand: çağıranın dağıtılan eli + seçimi + yuva sayısı + kendi
 *  kullanımları/elenenleri/ipuçları. Rakibinkiler ASLA gelmez (sunucu RLS). */
export async function getMyHand(matchId: string): Promise<ProtocolHand> {
  const p = await callRpc<{
    hand?: string[];
    selected?: string[];
    slots?: number;
    uses?: { protocol_id: string; round: number; outcome?: ProtocolUseOutcomeKind }[];
    eliminations?: Record<string, number[]>;
    hints?: Record<string, ProtocolHint[]>;
    shield_armed?: boolean;
    reflect_armed?: boolean;
  }>('get_my_hand', { p_match_id: matchId });
  return {
    hand: p.hand ?? [],
    selected: p.selected ?? [],
    slots: Number(p.slots ?? 2),
    uses: (p.uses ?? []).map((u) => ({
      protocolId: u.protocol_id,
      round: u.round,
      ...(u.outcome ? { outcome: u.outcome } : {}),
    })),
    eliminations: p.eliminations ?? {},
    hints: p.hints ?? {},
    shieldArmed: p.shield_armed ?? false,
    reflectArmed: p.reflect_armed ?? false,
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
    consumed?: boolean;
    clock1_ms?: number;
    clock2_ms?: number;
    eliminated_digit?: number;
    eliminated?: number[];
    digits?: string;
    feedback?: GuessFeedback;
    no_guess?: boolean;
    digit?: number;
    position?: number;
    match?: boolean;
    revealed_digit?: number;
    stolen_ms?: number;
    frozen?: boolean;
    slowed?: boolean;
    outcome?: ProtocolUseOutcomeKind;
    blocked?: boolean;
    reflected?: boolean;
    wasted_protocol?: string;
    no_target_protocol?: boolean;
    armed?: 'shield' | 'reflect';
  }>('use_protocol', {
    p_match_id: matchId,
    p_protocol_id: protocolId,
    p_payload: payload ?? null,
  });
  return {
    matchId: p.match_id,
    protocolId: p.protocol_id,
    round: p.round,
    ...(p.consumed != null ? { consumed: p.consumed } : {}),
    ...(p.clock1_ms != null ? { clock1Ms: p.clock1_ms } : {}),
    ...(p.clock2_ms != null ? { clock2Ms: p.clock2_ms } : {}),
    ...(p.eliminated_digit != null ? { eliminatedDigit: p.eliminated_digit } : {}),
    ...(p.eliminated ? { eliminated: p.eliminated } : {}),
    ...(p.digits != null ? { digits: p.digits } : {}),
    ...(p.feedback != null ? { feedback: p.feedback } : {}),
    ...(p.no_guess != null ? { noGuess: p.no_guess } : {}),
    ...(p.digit != null ? { digit: p.digit } : {}),
    ...(p.position != null ? { position: p.position } : {}),
    ...(p.match != null ? { match: p.match } : {}),
    ...(p.revealed_digit != null ? { revealedDigit: p.revealed_digit } : {}),
    ...(p.stolen_ms != null ? { stolenMs: p.stolen_ms } : {}),
    ...(p.frozen != null ? { frozen: p.frozen } : {}),
    ...(p.slowed != null ? { slowed: p.slowed } : {}),
    ...(p.outcome != null ? { outcome: p.outcome } : {}),
    ...(p.blocked != null ? { blocked: p.blocked } : {}),
    ...(p.reflected != null ? { reflected: p.reflected } : {}),
    ...(p.wasted_protocol != null ? { wastedProtocol: p.wasted_protocol } : {}),
    ...(p.no_target_protocol != null ? { noTargetProtocol: p.no_target_protocol } : {}),
    ...(p.armed != null ? { armed: p.armed } : {}),
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

/** Yeni özel oda açar; süre (kişi başı ms) + ilk sıra + oyun modu ayarlarıyla.
 *  roomMode kamudaki karşılığının kurallarını birebir yansıtır (quick/protocol/
 *  word); hepsi dostluk maçıdır (skora saymaz). Dönen roomCode rakiple paylaşılır. */
export async function createPrivateRoom(
  clockMs: number = 60000,
  firstTurnMode: FirstTurnMode = 'random',
  roomMode: PrivateRoomMode = 'quick',
  /** Kelime odasında sabit harf sayısı (4/5/6); null → her tur rastgele. */
  wordLength: number | null = null,
): Promise<MatchTicket> {
  return toTicket(
    await callRpc<TicketPayload>('create_private_room', {
      p_clock_ms: clockMs,
      p_first_turn_mode: firstTurnMode,
      p_room_mode: roomMode,
      p_word_length: wordLength,
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

/** Gizli içeriğini belirler; iki oyuncu da yazınca sunucu maçı başlatır.
 *  contentType='word' kelime maçında ZORUNLU — aksi halde sayı parser'ı
 *  kelimeyi daha RPC'ye gitmeden reddeder. */
export async function setSecret(
  matchId: string,
  digits: string,
  contentType: ContentTypeId = 'number',
): Promise<{ status: MatchStatus }> {
  assertValidDigits(digits, contentType);
  const payload = await callRpc<{ status: MatchStatus }>('set_secret', {
    p_match_id: matchId,
    p_digits: digits,
  });
  return { status: payload.status };
}

/** Tahmin yapar; yalnızca çağırana ait güvenli sonucu döndürür. */
export async function makeGuess(
  matchId: string,
  digits: string,
  contentType: ContentTypeId = 'number',
): Promise<GuessOutcome> {
  assertValidDigits(digits, contentType);
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

/** KELİME modu: ÇAĞIRANIN KENDİ tahminlerinin per-harf renkleri (id → 'GYX').
 *  Sunucu guesser=auth.uid() ile sert filtreler → rakibin marks'ı ASLA gelmez.
 *  İstemci yeniden bağlanınca/ekrana girince kendi tahtasını bundan boyar. */
export async function getMyMarks(matchId: string): Promise<Record<number, string>> {
  const rows = await callRpc<{ id: number; marks: string }[]>('get_my_marks', {
    p_match_id: matchId,
  });
  const map: Record<number, string> = {};
  for (const r of rows ?? []) map[r.id] = r.marks;
  return map;
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

/** Tur-arası (Bo3, round ≥ 2) belirleme süresi dolduysa ADİL çözüm: sırrını
 *  giren oyuncu turu kazanır, iki taraf da girmediyse maç iptal olur. İdempotent
 *  — her iki istemci de çağırabilir (karar sunucuda now() ile doğrulanır).
 *  1. tur setup'ında çağrılmaz (orada cancel_setup_timeout geçerli). */
export async function resolveSetupTimeout(
  matchId: string,
): Promise<{ status: MatchStatus; result: MatchResult | null; winner: string | null }> {
  const p = await callRpc<{
    status: MatchStatus;
    result?: MatchResult | null;
    winner?: string | null;
  }>('resolve_setup_timeout', { p_match_id: matchId });
  return { status: p.status, result: p.result ?? null, winner: p.winner ?? null };
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

export type LobbyCounts = {
  quick: number;
  protocol: number;
  word: number;
  /** O modda ŞU AN oynanan (setup/protocol_select/active) maç adedi. RPC eski
   *  sürümdeyse (migration henüz uygulanmadıysa) 0 döner. */
  activeQuick: number;
  activeProtocol: number;
  activeWord: number;
};

/** Lobi sayaçları: her mod kuyruğunda rakip bekleyen (taze, herkese açık) sayı +
 *  o modda süren aktif maç adedi. Kuyruğu RLS gizlediği için SECURITY DEFINER RPC. */
export async function getLobbyCounts(): Promise<LobbyCounts> {
  const p = await callRpc<{
    quick?: number;
    protocol?: number;
    word?: number;
    active_quick?: number;
    active_protocol?: number;
    active_word?: number;
  }>('get_lobby_counts');
  return {
    quick: Number(p?.quick ?? 0),
    protocol: Number(p?.protocol ?? 0),
    word: Number(p?.word ?? 0),
    activeQuick: Number(p?.active_quick ?? 0),
    activeProtocol: Number(p?.active_protocol ?? 0),
    activeWord: Number(p?.active_word ?? 0),
  };
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
    owned_signals?: string[] | null;
    signal_deck?: string[] | null;
    season_id?: number | string | null;
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
    // Migration 20260607000014 (sinyaller) öncesi güvenli varsayılanlar.
    ownedSignals: p.owned_signals ?? [],
    signalDeck: p.signal_deck ?? [],
    // Migration 20260607000015 (lig/sezon) öncesi güvenli varsayılan.
    seasonId: p.season_id == null ? null : Number(p.season_id),
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

/** Sinyali Veri ile açar (fiyat/Veri/sahiplik sunucuda doğrulanır, atomik).
 *  Dönen: güncel Veri + sahip olunan sinyal id'leri. */
export async function unlockSignal(
  id: string,
): Promise<{ veri: number; ownedSignals: string[] }> {
  const p = await callRpc<{ veri: number; owned_signals: string[] }>('unlock_signal', { p_id: id });
  return { veri: Number(p.veri), ownedSignals: p.owned_signals ?? [] };
}

/** Kalıcı sinyal destesini kaydeder (≤6, hepsi owned, tekrar yok — sunucuda
 *  doğrulanır). Dönen: güncel deste. */
export async function setSignalDeck(ids: string[]): Promise<{ signalDeck: string[] }> {
  const p = await callRpc<{ signal_deck: string[] }>('set_signal_deck', { p_ids: ids });
  return { signalDeck: p.signal_deck ?? [] };
}


/** Maç sonu gizli sayı ifşası (yalnızca finished + çağıran oyuncu).
 *  Çağıranın bakış açısından kendi ve rakip sayısı; satır yoksa null.
 *  Maç bitmeden çağrılırsa sunucu 'match_not_finished' fırlatır. */
export async function getMatchReveal(matchId: string): Promise<MatchReveal> {
  const p = await callRpc<{
    mine: string | null;
    opponent: string | null;
    scored?: boolean;
    rating_delta?: number | null;
    xp_delta?: number | null;
    veri_delta?: number | null;
  }>('get_match_reveal', { p_match_id: matchId });
  return {
    mine: p.mine ?? null,
    opponent: p.opponent ?? null,
    // İlerleme sayan maç (matchmade) + delta uygulanmışsa kazanım gösterilir.
    scored: !!p.scored && p.rating_delta != null,
    ratingDelta: p.rating_delta ?? null,
    xpDelta: p.xp_delta ?? null,
    veriDelta: p.veri_delta ?? null,
  };
}

/** Tur-bazlı gizli ifşa (yalnızca KARARLAŞMIŞ tur + çağıran oyuncu). Tur-arası
 *  break ekranında iki oyuncunun o turdaki gizlisini göstermek için. Canlı tur
 *  istenirse sunucu 'round_not_revealable' fırlatır (rakip kelimesi sızmaz). */
export async function getRoundReveal(matchId: string, round: number): Promise<RoundReveal> {
  const p = await callRpc<{ mine: string | null; opponent: string | null }>('get_round_reveal', {
    p_match_id: matchId,
    p_round: round,
  });
  return { mine: p.mine ?? null, opponent: p.opponent ?? null };
}

// ─── Gizli admin paneli: PIN korumalı kelime havuzu ekleme ──────────────
export type AdminAddStatus = 'added' | 'exists' | 'invalid';

/** PIN'i SUNUCUDA doğrular (panel açılışı için). Yanlışsa false. */
export async function adminVerifyPin(pin: string): Promise<boolean> {
  return callRpc<boolean>('admin_verify_pin', { p_pin: pin });
}

/** PIN korumalı kelime ekleme (tek havuz = secret_words). Sunucu PIN + biçim
 *  doğrular; kelime Türkçe küçük harfe normalize edilerek gönderilmeli. */
export async function adminAddWord(word: string, pin: string): Promise<AdminAddStatus> {
  const r = await callRpc<{ status: AdminAddStatus }>('admin_add_word', {
    p_word: word,
    p_pin: pin,
  });
  return r.status;
}

export type AdminRemoveStatus = 'removed' | 'not_found';

/** PIN korumalı kelime silme (tek havuz = secret_words). Kelime havuzda varsa
 *  siler ('removed'); yoksa 'not_found'. Sunucu PIN doğrular. */
export async function adminRemoveWord(word: string, pin: string): Promise<AdminRemoveStatus> {
  const r = await callRpc<{ status: AdminRemoveStatus }>('admin_remove_word', {
    p_word: word,
    p_pin: pin,
  });
  return r.status;
}

/** Havuz boyutu (secret_words'ün select grant'i zaten açık). */
export async function adminPoolSize(): Promise<number> {
  const client = requireClient();
  const { count } = await withTimeout(
    client.from('secret_words').select('*', { count: 'exact', head: true }),
  );
  return count ?? 0;
}

// ─── Havuza kelime öneri sistemi (oyuncu isteği + admin onay) ───────────────
export type RequestWordStatus = 'submitted' | 'exists' | 'invalid';

/** Oyuncu önerisi: havuzda olmayan bir kelimeyi admin onayına gönderir. PIN'siz —
 *  anon (offline giriş yapmamış) da çağırabilir. Sunucu biçimi tekrar doğrular. */
export async function requestWord(word: string): Promise<RequestWordStatus> {
  const r = await callRpc<{ status: RequestWordStatus }>('request_word', { p_word: word });
  return r.status;
}

/** Onay bekleyen bir öneri satırı. */
export type WordRequest = { word: string; count: number; at: string };

/** Admin: onay bekleyen kelimeler (PIN'li), en çok istenen üstte. */
export async function adminListWordRequests(pin: string): Promise<WordRequest[]> {
  const rows = await callRpc<{ word: string; count: number; at: string }[]>(
    'admin_list_word_requests',
    { p_pin: pin },
  );
  return (rows ?? []).map((x) => ({ word: x.word, count: Number(x.count), at: x.at }));
}

/** Admin: öneriyi onayla → havuza (secret_words) ekler + istekten siler. */
export async function adminApproveWord(word: string, pin: string): Promise<'approved'> {
  const r = await callRpc<{ status: 'approved' }>('admin_approve_word', {
    p_word: word,
    p_pin: pin,
  });
  return r.status;
}

/** Admin: öneriyi reddet → istekten siler (havuza girmez). */
export async function adminRejectWord(word: string, pin: string): Promise<'rejected'> {
  const r = await callRpc<{ status: 'rejected' }>('admin_reject_word', {
    p_word: word,
    p_pin: pin,
  });
  return r.status;
}

async function currentUserId(): Promise<string | null> {
  const client = requireClient();
  const { data } = await client.auth.getSession();
  return data.session?.user.id ?? null;
}

/** Maçın güvenli durumunu çeker; satır yok/oyuncu değilsen null.
 *  skipProfiles: adlar çağıranda zaten cache'te → profiles sorgusunu atla.
 *  (Emniyet poll'u her turda profiles'ı yeniden çekmesin; adlar caller'da
 *  withNames ile geri doldurulur — matchRowToState boş adla haritalar.) */
export async function fetchMatchState(
  matchId: string,
  opts?: { skipProfiles?: boolean },
): Promise<MatchState | null> {
  const client = requireClient();
  const myId = await currentUserId();
  if (!myId) throw new OnlineError('not_authenticated', ERROR_MESSAGES.not_authenticated);

  const { data, error } = await withTimeout(
    client.from('matches').select('*').eq('id', matchId).maybeSingle(),
  );
  if (error) throw toOnlineError(error.message);
  if (!data) return null;

  const row = data as MatchRow;
  const usernames: Record<string, string> = {};
  if (!opts?.skipProfiles) {
    // Profil adları: profiles RLS'i şimdilik yalnızca kendi satırını okutur;
    // in() sorgusu izinli olanları döndürür, rakip adı null kalır (ileride
    // lider tablosu politikası/RPC'siyle dolacak).
    const ids = [row.player1, row.player2].filter((v): v is string => Boolean(v));
    const { data: profiles } = await withTimeout(
      client.from('profiles').select('id, username').in('id', ids),
    );
    for (const p of profiles ?? []) {
      if (p.username) usernames[p.id] = p.username;
    }
  }
  return matchRowToState(row, myId, usernames);
}

/** Maçın tahmin geçmişi (kendi + rakip), eskiden yeniye. */
export async function fetchGuesses(matchId: string): Promise<OnlineGuess[]> {
  const client = requireClient();
  const { data, error } = await withTimeout(
    client.from('guesses').select('*').eq('match_id', matchId).order('created_at', { ascending: true }),
  );
  if (error) throw toOnlineError(error.message);
  return ((data ?? []) as GuessRow[]).map(guessRowToGuess);
}

/** Maçın presence satırları (iki oyuncunun bağlantı durumu). */
export async function fetchPresence(matchId: string): Promise<PresenceInfo[]> {
  const client = requireClient();
  const { data, error } = await withTimeout(
    client.from('presence').select('*').eq('match_id', matchId),
  );
  if (error) throw toOnlineError(error.message);
  return ((data ?? []) as PresenceRow[]).map(presenceRowToInfo);
}

/** Maçın protokol kullanım kayıtları (iki oyuncununki; sır içermez).
 *  Şerit "kullanıldı" durumu + yeniden bağlanınca senkron için. */
export async function fetchProtocolUses(matchId: string): Promise<ProtocolUse[]> {
  const client = requireClient();
  const { data, error } = await withTimeout(
    client.from('match_protocol_uses').select('*').eq('match_id', matchId).order('id', { ascending: true }),
  );
  if (error) throw toOnlineError(error.message);
  return ((data ?? []) as ProtocolUseRow[]).map(protocolUseRowToUse);
}

/** Global son 30 eşleşmeli maç (get_recent_matches RPC). jsonb dizi → RecentMatch[]. */
export async function getRecentMatches(): Promise<RecentMatch[]> {
  const rows = await callRpc<
    {
      match_id: string;
      mode: 'quick' | 'protocol';
      content_type?: 'number' | 'word';
      win_target?: number;
      player1_name?: string | null;
      player2_name?: string | null;
      p1_won?: boolean;
      result?: 'win' | 'timeout' | 'forfeit' | null;
      p1_round_wins?: number;
      p2_round_wins?: number;
      p1_rating_delta?: number | null;
      p2_rating_delta?: number | null;
      rounds?: { round: number; p1_secret: string | null; p2_secret: string | null; winner: number }[];
    }[]
  >('get_recent_matches');
  return (rows ?? []).map((r) => ({
    matchId: r.match_id,
    mode: r.mode,
    contentType: r.content_type ?? 'number',
    winTarget: Number(r.win_target ?? 1),
    player1Name: r.player1_name ?? null,
    player2Name: r.player2_name ?? null,
    p1Won: !!r.p1_won,
    result: r.result ?? null,
    p1RoundWins: Number(r.p1_round_wins ?? 0),
    p2RoundWins: Number(r.p2_round_wins ?? 0),
    p1RatingDelta: r.p1_rating_delta ?? null,
    p2RatingDelta: r.p2_rating_delta ?? null,
    rounds: (r.rounds ?? []).map((rd) => ({
      round: Number(rd.round),
      p1Secret: rd.p1_secret ?? null,
      p2Secret: rd.p2_secret ?? null,
      winner: rd.winner === 1 ? (1 as const) : (2 as const),
    })),
  }));
}
