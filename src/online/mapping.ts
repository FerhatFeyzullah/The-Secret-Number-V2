import type { ContentTypeId, GuessResult } from '../game';
import type {
  FirstTurnMode,
  GuessFeedback,
  MatchMode,
  MatchResult,
  MatchState,
  MatchStatus,
  OnlineGuess,
  PresenceInfo,
  ProtocolUse,
  TowerBossItem,
  TowerGuessOutcome,
  TowerOutcomeStatus,
  TowerReward,
  TowerRunStatus,
  TowerState,
  TowerTwist,
  WordRaceOutcome,
  WordRaceTimeoutOutcome,
} from './types';

/** matches tablosundan/realtime'dan gelen ham satır (snake_case). */
export type MatchRow = {
  id: string;
  status: MatchStatus;
  mode: MatchMode;
  /** Gizli içerik tipi; eski satırlarda yoktur → mapping 'number' varsayar. */
  content_type?: ContentTypeId;
  /** Kelime maçının harf uzunluğu (4-6); number maçlarda null/yok. */
  word_length?: number | null;
  room_code: string | null;
  /** Dostluk maçı (özel oda) mı; eski satırlarda yok → mapping false varsayar. */
  is_friendly?: boolean;
  player1: string;
  player2: string | null;
  current_turn: string | null;
  turn_started_at: string | null;
  clock1_ms: number;
  clock2_ms: number;
  // Çok-turlu maç (Best of 3); eski satırlarda olmayabilir → mapping default'lar.
  win_target?: number;
  current_round?: number;
  p1_round_wins?: number;
  p2_round_wins?: number;
  // KELİME YARIŞI: rakip-güvenli toplu ilerleme (harf sızmaz); diğer modlarda yok.
  p1_best_green?: number;
  p1_best_yellow?: number;
  p2_best_green?: number;
  p2_best_yellow?: number;
  // Konfig (özel oda ayarları); eski satırlarda olmayabilir → mapping default'lar.
  clock_ms?: number;
  first_turn_mode?: FirstTurnMode;
  // Saat/engel protokolü bayrakları (Faz 3 / Adım 4b-4c); eski satırlarda
  // olmayabilir.
  turn_frozen?: boolean;
  turn_slow_p1?: boolean;
  turn_slow_p2?: boolean;
  fog_p1?: boolean;
  fog_p2?: boolean;
  silenced_p1?: boolean;
  silenced_p2?: boolean;
  setup_deadline: string | null;
  // Protokol seçim fazı (Destiny's Hand) bitiş anı; eski satırlarda olmayabilir.
  select_deadline?: string | null;
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
  round?: number;
  created_at: string;
  /** Sis Perdesi işareti (4c); eski satırlarda olmayabilir. */
  fogged?: boolean;
  /** KELİME modu: yeşil harf sayısı (rakip-güvenli; per-harf dizi DEĞİL).
   *  number satırlarda null/yok. Per-harf marks satırda SAKLANMAZ (rakibe sızmasın). */
  green_count?: number | null;
  /** KELİME modu: sarı harf sayısı (rakip-güvenli). number satırlarda null/yok. */
  yellow_count?: number | null;
};

/** presence tablosundan/realtime'dan gelen ham satır. */
export type PresenceRow = {
  match_id: string;
  player: string;
  last_seen: string;
  disconnected_at: string | null;
};

/** match_protocol_uses tablosundan/realtime'dan gelen ham satır (sır içermez). */
export type ProtocolUseRow = {
  id: number;
  match_id: string;
  player: string;
  protocol_id: string;
  round: number;
  created_at: string;
  /** Counter zinciri sonucu (4c); eski satırlarda olmayabilir. */
  outcome?: string;
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
    contentType: row.content_type ?? 'number',
    wordLength: row.word_length ?? null,
    roomCode: row.room_code,
    isFriendly: row.is_friendly ?? false,
    player1: { id: row.player1, username: usernames[row.player1] ?? null },
    player2: row.player2
      ? { id: row.player2, username: usernames[row.player2] ?? null }
      : null,
    myRole,
    winTarget: row.win_target ?? 1,
    currentRound: row.current_round ?? 1,
    p1RoundWins: row.p1_round_wins ?? 0,
    p2RoundWins: row.p2_round_wins ?? 0,
    p1BestGreen: row.p1_best_green ?? 0,
    p1BestYellow: row.p1_best_yellow ?? 0,
    p2BestGreen: row.p2_best_green ?? 0,
    p2BestYellow: row.p2_best_yellow ?? 0,
    currentTurn: row.current_turn,
    clock1Ms: row.clock1_ms,
    clock2Ms: row.clock2_ms,
    clockMs: row.clock_ms ?? 60000,
    firstTurnMode: row.first_turn_mode ?? 'random',
    turnStartedAt: row.turn_started_at,
    turnFrozen: row.turn_frozen ?? false,
    turnSlowP1: row.turn_slow_p1 ?? false,
    turnSlowP2: row.turn_slow_p2 ?? false,
    fogP1: row.fog_p1 ?? false,
    fogP2: row.fog_p2 ?? false,
    silencedP1: row.silenced_p1 ?? false,
    silencedP2: row.silenced_p2 ?? false,
    setupDeadline: row.setup_deadline,
    selectDeadline: row.select_deadline ?? null,
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
    round: row.round ?? 1,
    createdAt: row.created_at,
    // Yalnız işaretliyken eklenir (eski satır/teste şekil-uyumlu).
    ...(row.fogged ? { fogged: true } : {}),
    // Kelime yeşil/sarı sayısı; number satırlarda null → eklenmez (şekil-uyumlu).
    ...(row.green_count != null ? { greenCount: row.green_count } : {}),
    ...(row.yellow_count != null ? { yellowCount: row.yellow_count } : {}),
  };
}

export function presenceRowToInfo(row: PresenceRow): PresenceInfo {
  return {
    player: row.player,
    lastSeen: row.last_seen,
    disconnectedAt: row.disconnected_at,
  };
}

export function protocolUseRowToUse(row: ProtocolUseRow): ProtocolUse {
  return {
    id: row.id,
    matchId: row.match_id,
    player: row.player,
    protocolId: row.protocol_id,
    round: row.round,
    createdAt: row.created_at,
    outcome: (row.outcome as ProtocolUse['outcome']) ?? 'applied',
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
    | 'status'
    | 'currentTurn'
    | 'turnStartedAt'
    | 'clock1Ms'
    | 'clock2Ms'
    | 'player1'
    | 'turnFrozen'
    | 'turnSlowP1'
    | 'turnSlowP2'
  >,
  nowMs: number,
): { clock1Ms: number; clock2Ms: number } {
  if (state.status !== 'active' || !state.currentTurn || !state.turnStartedAt) {
    return { clock1Ms: state.clock1Ms, clock2Ms: state.clock2Ms };
  }
  const running1 = state.currentTurn === state.player1.id;
  // Sunucudaki _turn_elapsed_ms ile aynı model: donmuş tur → süre işlemez;
  // yavaşlatılmış oyuncunun turu → geçen süre ×1.5 erir.
  let elapsed = Math.max(0, nowMs - Date.parse(state.turnStartedAt));
  if (state.turnFrozen) elapsed = 0;
  else if (running1 ? state.turnSlowP1 : state.turnSlowP2) elapsed = Math.floor(elapsed * 1.5);
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
    case 'partial:3': // kelime modu (sayıda üretilmez)
      return { status: 'partial', correctCount: 3 };
    case 'partial:4':
      return { status: 'partial', correctCount: 4 };
    case 'partial:5':
      return { status: 'partial', correctCount: 5 };
    case 'digits_correct_wrong_order':
      return { status: 'digitsCorrectWrongOrder' };
    case 'win':
      return { status: 'win' };
  }
}

// ─── Kelime Yarışı (RPC jsonb → domain) ──────────────────────────────────────

/** word_race_guess jsonb dönüşü (snake_case). */
export type WordRaceOutcomePayload = {
  status: string;
  marks?: string | null;
  green_count?: number | null;
  yellow_count?: number | null;
  remaining_ms?: number | null;
  p1_round_wins?: number;
  p2_round_wins?: number;
  current_round?: number;
  reveal?: string | null;
};

export function mapWordRaceOutcome(p: WordRaceOutcomePayload): WordRaceOutcome {
  return {
    status: p.status as WordRaceOutcome['status'],
    marks: p.marks ?? '',
    greenCount: Number(p.green_count ?? 0),
    yellowCount: Number(p.yellow_count ?? 0),
    remainingMs: Number(p.remaining_ms ?? 0),
    p1RoundWins: Number(p.p1_round_wins ?? 0),
    p2RoundWins: Number(p.p2_round_wins ?? 0),
    currentRound: Number(p.current_round ?? 1),
    reveal: p.reveal ?? null,
  };
}

/** claim_word_race_timeout jsonb dönüşü (snake_case). */
export type WordRaceTimeoutPayload = {
  status: string;
  reveal?: string | null;
  p1_round_wins?: number;
  p2_round_wins?: number;
  current_round?: number;
  remaining_ms?: number | null;
};

export function mapWordRaceTimeout(p: WordRaceTimeoutPayload): WordRaceTimeoutOutcome {
  return {
    status: p.status as WordRaceTimeoutOutcome['status'],
    reveal: p.reveal ?? null,
    p1RoundWins: Number(p.p1_round_wins ?? 0),
    p2RoundWins: Number(p.p2_round_wins ?? 0),
    currentRound: Number(p.current_round ?? 1),
    remainingMs: Number(p.remaining_ms ?? 0),
  };
}

// ─── Turnuva: Gizemli Kule (RPC jsonb → domain) ──────────────────────────────

/** get_tower_state / enter_tower / start_tower_floor / claim_tower_timeout jsonb. */
export type TowerStatePayload = {
  period?: { id: number | null; ends_at: string | null } | null;
  run?: {
    current_floor: number;
    lives: number;
    status: string;
    floors_cleared: number;
    win_streak?: number;
  } | null;
  floors?: {
    floor_no: number;
    word_length: number;
    clock_ms: number;
    twists: TowerTwist[] | null;
    veri_reward: number;
    is_boss: boolean;
    item_preview: { kind: string; id: string } | null;
  }[] | null;
  active?: {
    floor_no: number;
    word_length: number;
    remaining_ms: number;
    started?: boolean;
    cursed_letters?: string[] | null;
    twists: TowerTwist[] | null;
    guesses: { guess: string; marks: string; green_count: number }[] | null;
    solved1: boolean;
    solved2: boolean;
  } | null;
  veri?: number;
};

/** tower_guess sonucu (ve claim_tower_timeout'un fail dönüşü). */
export type TowerOutcomePayload = {
  status: string;
  marks?: string | null;
  marks2?: string | null;
  green_count?: number | null;
  remaining_ms?: number | null;
  lives?: number | null;
  solved1?: boolean;
  solved2?: boolean;
  reward?: {
    veri: number;
    kupa?: number;
    item_kind: string | null;
    item_id: string | null;
    converted: boolean;
  } | null;
  reveal?: { secret: string | null; secret2: string | null } | null;
};

function mapBossItem(it: { kind: string; id: string } | null | undefined): TowerBossItem | null {
  if (!it || (it.kind !== 'protocol' && it.kind !== 'signal')) return null;
  return { kind: it.kind, id: it.id };
}

export function mapTowerState(p: TowerStatePayload): TowerState {
  return {
    period: { id: p.period?.id ?? null, endsAt: p.period?.ends_at ?? null },
    run: p.run
      ? {
          currentFloor: Number(p.run.current_floor),
          lives: Number(p.run.lives),
          status: p.run.status as TowerRunStatus,
          floorsCleared: Number(p.run.floors_cleared ?? 0),
          winStreak: Number(p.run.win_streak ?? 0),
        }
      : null,
    floors: (p.floors ?? []).map((f) => ({
      floorNo: Number(f.floor_no),
      wordLength: Number(f.word_length),
      clockMs: Number(f.clock_ms),
      twists: f.twists ?? [],
      veriReward: Number(f.veri_reward ?? 0),
      isBoss: !!f.is_boss,
      itemPreview: mapBossItem(f.item_preview),
    })),
    active: p.active
      ? {
          floorNo: Number(p.active.floor_no),
          wordLength: Number(p.active.word_length),
          remainingMs: Number(p.active.remaining_ms ?? 0),
          started: !!p.active.started,
          cursedLetters: p.active.cursed_letters ?? [],
          twists: p.active.twists ?? [],
          guesses: (p.active.guesses ?? []).map((g) => ({
            guess: g.guess,
            marks: g.marks,
            greenCount: Number(g.green_count ?? 0),
          })),
          solved1: !!p.active.solved1,
          solved2: !!p.active.solved2,
        }
      : null,
    veri: Number(p.veri ?? 0),
  };
}

function mapTowerReward(
  r: TowerOutcomePayload['reward'],
): TowerReward | null {
  if (!r) return null;
  const kind = r.item_kind === 'protocol' || r.item_kind === 'signal' ? r.item_kind : null;
  return {
    veri: Number(r.veri ?? 0),
    kupa: Number(r.kupa ?? 0),
    itemKind: kind,
    itemId: kind ? r.item_id : null,
    converted: !!r.converted,
  };
}

export function mapTowerOutcome(p: TowerOutcomePayload): TowerGuessOutcome {
  return {
    status: p.status as TowerOutcomeStatus,
    marks: p.marks ?? null,
    marks2: p.marks2 ?? null,
    greenCount: Number(p.green_count ?? 0),
    remainingMs: p.remaining_ms == null ? null : Number(p.remaining_ms),
    lives: Number(p.lives ?? 0),
    solved1: p.solved1,
    solved2: p.solved2,
    reward: mapTowerReward(p.reward),
    reveal: p.reveal
      ? { secret: p.reveal.secret ?? null, secret2: p.reveal.secret2 ?? null }
      : null,
  };
}
