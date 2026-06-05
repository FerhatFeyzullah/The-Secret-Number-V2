import { parseGuess } from '../game';
import { supabase } from '../supabase';
import {
  guessRowToGuess,
  matchRowToState,
  presenceRowToInfo,
  type GuessRow,
  type MatchRow,
  type PresenceRow,
} from './mapping';
import type {
  GuessFeedback,
  GuessOutcome,
  MatchResult,
  MatchReveal,
  MatchState,
  MatchStatus,
  MatchTicket,
  OnlineGuess,
  PlayerRole,
  PresenceInfo,
} from './types';

/** RPC'lerin fırlattığı, sunucu hata koduna göre Türkçe mesaj taşıyan hata. */
export class OnlineError extends Error {
  constructor(
    /** Sunucudaki raise exception metni (ör. not_your_turn) ya da yerel kod. */
    readonly code: string,
    message: string,
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
};

function toOnlineError(serverMessage: string | null | undefined): OnlineError {
  const code = serverMessage && serverMessage in ERROR_MESSAGES ? serverMessage : 'unknown';
  return new OnlineError(code, ERROR_MESSAGES[code]);
}

function requireClient(): NonNullable<typeof supabase> {
  if (!supabase) throw new OnlineError('offline', ERROR_MESSAGES.offline);
  return supabase;
}

async function callRpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const client = requireClient();
  const { data, error } = await client.rpc(fn, args);
  if (error) throw toOnlineError(error.message);
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

/** Hızlı maç: bekleyen maça katıl ya da kuyruğa yeni maç aç. */
export async function findOrCreateQuickMatch(): Promise<MatchTicket> {
  return toTicket(await callRpc<TicketPayload>('find_or_create_quick_match'));
}

/** Yeni özel oda açar; dönen roomCode rakiple paylaşılır. */
export async function createPrivateRoom(): Promise<MatchTicket> {
  return toTicket(await callRpc<TicketPayload>('create_private_room'));
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
