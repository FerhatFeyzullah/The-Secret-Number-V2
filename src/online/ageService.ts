// Gizem Çağı (3 oyunculu harita fethi) — istemci servis katmanı.
// matchService şişmesin diye AYRI dosya; ortak callRpc/OnlineError yeniden kullanılır.
// Tüm otorite sunucudadır (age_* RPC'leri); burada yalnız sarmalama + snake→camel
// eşleme. Şifreler istemciye ASLA gelmez.

import { callRpc } from './matchService';

// ─── Tipler ─────────────────────────────────────────────────────────────────
export type AgePhase = 'queue' | 'prep' | 'war' | 'finished' | 'cancelled';
export type AgeKind = 'tower' | 'castle';
export type AgeAttackStatus = 'open' | 'active' | 'won' | 'lost';
export type AgeSabotage = 'fog' | 'cursed';

export type AgePlayer = {
  player: string;
  slot: number;
  username: string | null;
  eliminated: boolean;
  territories: number;
};

export type AgeTerritory = {
  id: string;
  kind: AgeKind;
  /** Harita düzeni için sabit indeks (kaleler 0–4; kuleler 100+). */
  slotIndex: number;
  /** Kule → bağlı kale id'si (kapı); kale → null. */
  castleId: string | null;
  /** Kule: 0 · Kale: 4/5/6 (harf sayısı). */
  level: number;
  /** null = bot (fethedilmemiş). */
  owner: string | null;
  conquerCount: number;
  /** Fetih sonrası şifre belirleme penceresi bitişi; null = kilitli/geçmiş. */
  codeDeadline: string | null;
  /** Kale: kelime belirlenmiş mi (false = SAVUNMASIZ, tek hamlede kapılır).
   *  Kule: her zaman true. */
  defended: boolean;
};

export type AgeGuess = { guess: string; feedback: string; marks: string | null };

export type AgeAttack = {
  territoryId: string;
  kind: AgeKind;
  status: AgeAttackStatus;
  deadline: string | null;
  fogRemaining: number;
  thiefRemaining: number;
  guesses: AgeGuess[];
};

/** Herkesin aktif saldırısı (harita işareti — kim nereye). */
export type AgePublicAttack = { territoryId: string; attacker: string };

/** Çağıranın topraklarına gelen saldırı (savunma alarmı; şifre/tahmin içeriği yok). */
export type AgeIncoming = {
  attackId: string;
  territoryId: string;
  attacker: string;
  guessCount: number;
  lastGreen: number | null;
  lastYellow: number | null;
};

export type AgeRankEntry = { player: string; rank: number; kupaDelta: number; veriDelta: number };

export type AgeState = {
  matchId: string;
  phase: AgePhase;
  prepEndsAt: string | null;
  warEndsAt: string | null;
  ranking: AgeRankEntry[];
  me: string;
  players: AgePlayer[];
  territories: AgeTerritory[];
  myAttacks: AgeAttack[];
  incoming: AgeIncoming[];
  attacksPublic: AgePublicAttack[];
};

export type AgeStartAttack = {
  attackId: string;
  deadline: string | null;
  kind: AgeKind;
  level: number;
  targetOwner: string | null;
};

export type AgeGuessOutcome =
  | { status: 'lost_race' }
  | { status: 'expired_renewed' }
  | { status: 'expired' }
  | { status: 'conquered'; territoryId: string; codeDeadline: string | null }
  | { status: 'continue'; feedback: string; marks: string | null; remainingMs: number };

export type AgeDefenseStart = {
  defenseId: string;
  solvedCount: number;
  slots: number;
  deadline: string | null;
};

export type AgeSabotageChoice = 'time' | 'fog' | 'thief';

export type AgeDefenseOutcome =
  | { status: 'solved'; solvedCount: number; slots: number; veri: number | null }
  | { status: 'continue'; feedback: string }
  | { status: 'attack_gone' };

// ─── Ham RPC payload tipleri (snake_case) ───────────────────────────────────
type StatePayload = {
  match_id: string;
  phase: AgePhase;
  prep_ends_at: string | null;
  war_ends_at: string | null;
  ranking: { player: string; rank: number; kupa_delta: number; veri_delta: number }[] | null;
  me: string;
  players: {
    player: string;
    slot: number;
    username: string | null;
    eliminated: boolean;
    territories: number;
  }[];
  territories: {
    id: string;
    kind: AgeKind;
    slot_index: number;
    castle_id: string | null;
    level: number;
    owner: string | null;
    conquer_count: number;
    code_deadline: string | null;
    defended: boolean;
  }[];
  my_attacks: {
    territory_id: string;
    kind: AgeKind;
    status: AgeAttackStatus;
    deadline: string | null;
    fog_remaining: number;
    thief_remaining: number;
    guesses: { guess: string; feedback: string; marks: string | null }[];
  }[];
  incoming: {
    attack_id: string;
    territory_id: string;
    attacker: string;
    guess_count: number;
    last_marks_summary: { green: number; yellow: number } | null;
  }[];
  attacks_public: { territory_id: string; attacker: string }[];
};

// ─── Eşleyici ───────────────────────────────────────────────────────────────
export function mapAgeState(p: StatePayload): AgeState {
  return {
    matchId: p.match_id,
    phase: p.phase,
    prepEndsAt: p.prep_ends_at ?? null,
    warEndsAt: p.war_ends_at ?? null,
    ranking: (p.ranking ?? []).map((r) => ({
      player: r.player,
      rank: r.rank,
      kupaDelta: r.kupa_delta,
      veriDelta: r.veri_delta,
    })),
    me: p.me,
    players: (p.players ?? []).map((pl) => ({
      player: pl.player,
      slot: pl.slot,
      username: pl.username ?? null,
      eliminated: !!pl.eliminated,
      territories: Number(pl.territories ?? 0),
    })),
    territories: (p.territories ?? []).map((t) => ({
      id: t.id,
      kind: t.kind,
      slotIndex: Number(t.slot_index),
      castleId: t.castle_id ?? null,
      level: Number(t.level ?? 0),
      owner: t.owner ?? null,
      conquerCount: Number(t.conquer_count ?? 0),
      codeDeadline: t.code_deadline ?? null,
      defended: t.defended !== false,
    })),
    myAttacks: (p.my_attacks ?? []).map((a) => ({
      territoryId: a.territory_id,
      kind: a.kind,
      status: a.status,
      deadline: a.deadline ?? null,
      fogRemaining: Number(a.fog_remaining ?? 0),
      thiefRemaining: Number(a.thief_remaining ?? 0),
      guesses: (a.guesses ?? []).map((g) => ({
        guess: g.guess,
        feedback: g.feedback,
        marks: g.marks ?? null,
      })),
    })),
    incoming: (p.incoming ?? []).map((i) => ({
      attackId: i.attack_id,
      territoryId: i.territory_id,
      attacker: i.attacker,
      guessCount: Number(i.guess_count ?? 0),
      lastGreen: i.last_marks_summary ? Number(i.last_marks_summary.green) : null,
      lastYellow: i.last_marks_summary ? Number(i.last_marks_summary.yellow) : null,
    })),
    attacksPublic: (p.attacks_public ?? []).map((x) => ({
      territoryId: x.territory_id,
      attacker: x.attacker,
    })),
  };
}

// ─── RPC sarmalayıcıları ────────────────────────────────────────────────────

/** 3'lü kuyruğa katıl (ya da aktif maçını sürdür). 3. oyuncuyla hazırlık başlar. */
export async function ageFindMatch(): Promise<{ matchId: string; phase: AgePhase }> {
  const p = await callRpc<{ match_id: string; phase: AgePhase }>('age_find_match');
  return { matchId: p.match_id, phase: p.phase };
}

/** Güvenli tam durum (harita + saldırılar + savunma alarmı). Şifre SIZDIRMAZ. */
export async function ageGetState(matchId: string): Promise<AgeState> {
  return mapAgeState(await callRpc<StatePayload>('age_get_state', { p_match_id: matchId }));
}

/** Bir bölgeye saldırı başlat/sürdür (kapı + faz kuralları sunucuda). */
export async function ageStartAttack(territoryId: string): Promise<AgeStartAttack> {
  const p = await callRpc<{
    attack_id: string;
    deadline: string | null;
    kind: AgeKind;
    level: number;
    target_owner: string | null;
  }>('age_start_attack', { p_territory_id: territoryId });
  return {
    attackId: p.attack_id,
    deadline: p.deadline ?? null,
    kind: p.kind,
    level: Number(p.level ?? 0),
    targetOwner: p.target_owner ?? null,
  };
}

/** Saldırı tahmini gönder. Sonuç birlik-tipi (kazandı/süre/devam/yarış). */
export async function ageAttackGuess(territoryId: string, guess: string): Promise<AgeGuessOutcome> {
  const p = await callRpc<{
    status: AgeGuessOutcome['status'];
    territory_id?: string;
    code_deadline?: string | null;
    feedback?: string;
    marks?: string | null;
    remaining_ms?: number;
  }>('age_attack_guess', { p_territory_id: territoryId, p_guess: guess });
  switch (p.status) {
    case 'conquered':
      return { status: 'conquered', territoryId: p.territory_id!, codeDeadline: p.code_deadline ?? null };
    case 'continue':
      return {
        status: 'continue',
        feedback: p.feedback ?? '',
        marks: p.marks ?? null,
        remainingMs: Number(p.remaining_ms ?? 0),
      };
    case 'expired':
      return { status: 'expired' };
    case 'expired_renewed':
      return { status: 'expired_renewed' };
    default:
      return { status: 'lost_race' };
  }
}

/** Aktif saldırıyı bırak (kuşatma birikimi korunur). */
export async function ageAbandonAttack(territoryId: string): Promise<void> {
  await callRpc('age_abandon_attack', { p_territory_id: territoryId });
}

/** Fetih sonrası kendi savunma şifreni belirle (pencere içinde). */
export async function ageSetCode(territoryId: string, code: string): Promise<void> {
  await callRpc('age_set_code', { p_territory_id: territoryId, p_code: code });
}

/** Kalene gelen saldırıya karşı savunmaya koş (kendi aktif saldırın düşer). */
export async function ageStartDefense(attackId: string): Promise<AgeDefenseStart> {
  const p = await callRpc<{
    defense_id: string;
    solved_count: number;
    slots: number;
    deadline: string | null;
  }>('age_start_defense', { p_attack_id: attackId });
  return {
    defenseId: p.defense_id,
    solvedCount: Number(p.solved_count ?? 0),
    slots: Number(p.slots ?? 3),
    deadline: p.deadline ?? null,
  };
}

/** Savunma sayısını çöz → seçilen dezavantajı uygula (time ücretsiz / fog / thief
 *  Veri karşılığı). Dezavantaj yalnız sayı doğru çözülünce uygulanır. */
export async function ageDefenseGuess(
  attackId: string,
  guess: string,
  sabotage: AgeSabotageChoice,
): Promise<AgeDefenseOutcome> {
  const p = await callRpc<{
    status: AgeDefenseOutcome['status'];
    solved_count?: number;
    slots?: number;
    veri?: number;
    feedback?: string;
  }>('age_defense_guess', { p_attack_id: attackId, p_guess: guess, p_sabotage: sabotage });
  switch (p.status) {
    case 'solved':
      return {
        status: 'solved',
        solvedCount: Number(p.solved_count ?? 0),
        slots: Number(p.slots ?? 0),
        veri: p.veri ?? null,
      };
    case 'continue':
      return { status: 'continue', feedback: p.feedback ?? '' };
    default:
      return { status: 'attack_gone' };
  }
}

/** Kule/kale sahibi Veri ödeyip şifreyi yeniler → saldırganın biriken tahtası
 *  sıfırlanır. Kale için yeni kelime (code) ZORUNLU; kule için code opsiyonel. */
export async function ageRefreshCode(
  territoryId: string,
  code?: string,
): Promise<{ veri: number | null }> {
  const p = await callRpc<{ status: string; veri?: number }>('age_refresh_code', {
    p_territory_id: territoryId,
    ...(code ? { p_code: code } : {}),
  });
  return { veri: p.veri ?? null };
}

/** Faz/süre geçişlerini çöz (idempotent; iki istemci de tetikleyebilir). */
export async function ageClaimPhase(matchId: string): Promise<void> {
  await callRpc('age_claim_phase', { p_match_id: matchId });
}

/** Maçtan çık (topraklar bota döner, oyuncu son sıraya). */
export async function ageLeave(matchId: string): Promise<void> {
  await callRpc('age_leave', { p_match_id: matchId });
}
