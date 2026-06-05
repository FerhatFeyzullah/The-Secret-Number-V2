import type { GuessResult } from '../game';
import type {
  GuessFeedback,
  MatchMode,
  MatchResult,
  MatchState,
  MatchStatus,
  OnlineGuess,
  PresenceInfo,
} from './types';

/** matches tablosundan/realtime'dan gelen ham satır (snake_case). */
export type MatchRow = {
  id: string;
  status: MatchStatus;
  mode: MatchMode;
  room_code: string | null;
  player1: string;
  player2: string | null;
  current_turn: string | null;
  turn_started_at: string | null;
  clock1_ms: number;
  clock2_ms: number;
  setup_deadline: string | null;
  // Eski satırlarda/realtime payload'ında bulunmayabilir; mapping varsayılana düşürür.
  // present = "Hazır'a bastı", ready = "sayıyı kilitledi" (ikisi de yalnız boolean).
  player1_present?: boolean;
  player2_present?: boolean;
  present_deadline?: string | null;
  player1_ready?: boolean;
  player2_ready?: boolean;
  winner: string | null;
  result: MatchResult | null;
};

/** guesses tablosundan/realtime'dan gelen ham satır. */
export type GuessRow = {
  id: number;
  match_id: string;
  guesser: string;
  digits: string;
  feedback: GuessFeedback;
  created_at: string;
};

/** presence tablosundan/realtime'dan gelen ham satır. */
export type PresenceRow = {
  match_id: string;
  player: string;
  last_seen: string;
  disconnected_at: string | null;
};

/**
 * Ham maç satırını çağıranın bakış açısından MatchState'e çevirir.
 * Çağıran maçın oyuncusu değilse null (RLS zaten göstermez ama tip de korur).
 */
export function matchRowToState(
  row: MatchRow,
  myId: string,
  usernames: Record<string, string> = {},
): MatchState | null {
  const myRole =
    row.player1 === myId ? 'player1' : row.player2 === myId ? 'player2' : null;
  if (!myRole) return null;
  return {
    id: row.id,
    status: row.status,
    mode: row.mode,
    roomCode: row.room_code,
    player1: { id: row.player1, username: usernames[row.player1] ?? null },
    player2: row.player2
      ? { id: row.player2, username: usernames[row.player2] ?? null }
      : null,
    myRole,
    currentTurn: row.current_turn,
    clock1Ms: row.clock1_ms,
    clock2Ms: row.clock2_ms,
    turnStartedAt: row.turn_started_at,
    setupDeadline: row.setup_deadline,
    player1Present: row.player1_present ?? false,
    player2Present: row.player2_present ?? false,
    presentDeadline: row.present_deadline ?? null,
    player1Ready: row.player1_ready ?? false,
    player2Ready: row.player2_ready ?? false,
    winner: row.winner,
    result: row.result,
  };
}

export function guessRowToGuess(row: GuessRow): OnlineGuess {
  return {
    id: row.id,
    matchId: row.match_id,
    guesser: row.guesser,
    digits: row.digits,
    feedback: row.feedback,
    createdAt: row.created_at,
  };
}

export function presenceRowToInfo(row: PresenceRow): PresenceInfo {
  return {
    player: row.player,
    lastSeen: row.last_seen,
    disconnectedAt: row.disconnected_at,
  };
}

/**
 * Görsel geri sayım: akan tarafın saatinden, sıranın başlangıcından bu yana
 * geçen süreyi düşer. SADECE gösterim içindir — gerçek karar her zaman
 * sunucuda (make_guess / claim_timeout) verilir; yeni sunucu state'i gelince
 * değerler otomatik yeniden senkronlanır.
 */
export function displayClocks(
  state: Pick<
    MatchState,
    'status' | 'currentTurn' | 'turnStartedAt' | 'clock1Ms' | 'clock2Ms' | 'player1'
  >,
  nowMs: number,
): { clock1Ms: number; clock2Ms: number } {
  if (state.status !== 'active' || !state.currentTurn || !state.turnStartedAt) {
    return { clock1Ms: state.clock1Ms, clock2Ms: state.clock2Ms };
  }
  const elapsed = Math.max(0, nowMs - Date.parse(state.turnStartedAt));
  const running1 = state.currentTurn === state.player1.id;
  return {
    clock1Ms: running1 ? Math.max(0, state.clock1Ms - elapsed) : state.clock1Ms,
    clock2Ms: running1 ? state.clock2Ms : Math.max(0, state.clock2Ms - elapsed),
  };
}

/**
 * Sunucu feedback'ini offline'daki GuessResult'a çevirir; UI iki modda da
 * aynı bileşenleri kullanabilsin. Eşleme src/game/evaluate.ts ile birebirdir.
 */
export function feedbackToGuessResult(feedback: GuessFeedback): GuessResult {
  switch (feedback) {
    case 'partial:0':
      return { status: 'partial', correctCount: 0 };
    case 'partial:1':
      return { status: 'partial', correctCount: 1 };
    case 'partial:2':
      return { status: 'partial', correctCount: 2 };
    case 'digits_correct_wrong_order':
      return { status: 'digitsCorrectWrongOrder' };
    case 'win':
      return { status: 'win' };
  }
}
