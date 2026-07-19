import {
  displayClocks,
  feedbackToGuessResult,
  guessRowToGuess,
  mapTowerOutcome,
  mapTowerState,
  matchRowToState,
  type MatchRow,
} from './mapping';

const P1 = '00000000-0000-0000-0000-00000000000a';
const P2 = '00000000-0000-0000-0000-00000000000b';

function row(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    id: 'match-1',
    status: 'active',
    mode: 'quick',
    room_code: null,
    player1: P1,
    player2: P2,
    current_turn: P1,
    turn_started_at: '2026-06-05T10:00:00.000Z',
    clock1_ms: 60000,
    clock2_ms: 45000,
    setup_deadline: null,
    winner: null,
    result: null,
    ...overrides,
  };
}

describe('matchRowToState', () => {
  it('çağıranın rolünü doğru belirler ve camelCase eşler', () => {
    const state = matchRowToState(row(), P2, { [P2]: 'vavi' });
    expect(state).toMatchObject({
      id: 'match-1',
      myRole: 'player2',
      currentTurn: P1,
      clock1Ms: 60000,
      clock2Ms: 45000,
      player1: { id: P1, username: null },
      player2: { id: P2, username: 'vavi' },
    });
  });

  it('çağıran maçın oyuncusu değilse null döner', () => {
    expect(matchRowToState(row(), 'baska-biri')).toBeNull();
  });

  it('rakip henüz yokken (waiting) player2 null olur', () => {
    const state = matchRowToState(row({ status: 'waiting', player2: null, current_turn: null }), P1);
    expect(state?.player2).toBeNull();
    expect(state?.myRole).toBe('player1');
  });

  it('tip seviyesinde gizli sayı alanı yoktur', () => {
    const state = matchRowToState(row(), P1)!;
    expect(Object.keys(state)).not.toEqual(
      expect.arrayContaining(['digits', 'secret', 'secrets']),
    );
  });
});

describe('displayClocks', () => {
  const base = matchRowToState(row(), P1)!;

  it('akan tarafın (player1) saatinden geçen süreyi düşer, rakibinkine dokunmaz', () => {
    const nowMs = Date.parse('2026-06-05T10:00:10.000Z'); // 10 sn geçti
    expect(displayClocks(base, nowMs)).toEqual({ clock1Ms: 50000, clock2Ms: 45000 });
  });

  it('saat 0 altına inmez', () => {
    const nowMs = Date.parse('2026-06-05T10:05:00.000Z'); // 5 dk geçti
    expect(displayClocks(base, nowMs)).toEqual({ clock1Ms: 0, clock2Ms: 45000 });
  });

  it('active olmayan maçta sunucu değerlerini aynen döndürür', () => {
    const finished = matchRowToState(
      row({ status: 'finished', current_turn: null, turn_started_at: null }),
      P1,
    )!;
    const nowMs = Date.parse('2026-06-05T10:05:00.000Z');
    expect(displayClocks(finished, nowMs)).toEqual({ clock1Ms: 60000, clock2Ms: 45000 });
  });

  it('sıra player2 dayken yalnızca onun saati akar', () => {
    const turn2 = matchRowToState(row({ current_turn: P2 }), P1)!;
    const nowMs = Date.parse('2026-06-05T10:00:05.000Z');
    expect(displayClocks(turn2, nowMs)).toEqual({ clock1Ms: 60000, clock2Ms: 40000 });
  });
});

describe('feedbackToGuessResult', () => {
  it('offline GuessResult ile birebir eşler', () => {
    expect(feedbackToGuessResult('partial:0')).toEqual({ status: 'partial', correctCount: 0 });
    expect(feedbackToGuessResult('partial:1')).toEqual({ status: 'partial', correctCount: 1 });
    expect(feedbackToGuessResult('partial:2')).toEqual({ status: 'partial', correctCount: 2 });
    expect(feedbackToGuessResult('digits_correct_wrong_order')).toEqual({
      status: 'digitsCorrectWrongOrder',
    });
    expect(feedbackToGuessResult('win')).toEqual({ status: 'win' });
  });
});

describe('guessRowToGuess', () => {
  it('snake_case satırı camelCase tahmine çevirir', () => {
    expect(
      guessRowToGuess({
        id: 7,
        match_id: 'match-1',
        guesser: P1,
        digits: '123',
        feedback: 'partial:2',
        created_at: '2026-06-05T10:00:03.000Z',
      }),
    ).toEqual({
      id: 7,
      matchId: 'match-1',
      guesser: P1,
      digits: '123',
      feedback: 'partial:2',
      round: 1,
      createdAt: '2026-06-05T10:00:03.000Z',
    });
  });
});

describe('mapTowerState', () => {
  it('maps snake_case payload to camelCase domain state', () => {
    const state = mapTowerState({
      period: { id: 3, ends_at: '2026-07-20T00:00:00.000Z' },
      run: { current_floor: 5, lives: 2, status: 'active', floors_cleared: 4, win_streak: 6 },
      floors: [
        {
          floor_no: 5,
          word_length: 5,
          clock_ms: 105000,
          twists: [{ kind: 'shuffle' }, { kind: 'blind' }],
          veri_reward: 120,
          is_boss: true,
          item_preview: { kind: 'protocol', id: 'info_postest' },
        },
      ],
      active: {
        floor_no: 5,
        word_length: 5,
        remaining_ms: 98000,
        twists: [{ kind: 'shuffle' }],
        guesses: [{ guess: 'kitap', marks: 'GY?XX', green_count: 1 }],
        solved1: false,
        solved2: false,
      },
      veri: 700,
    });
    expect(state.period).toEqual({ id: 3, endsAt: '2026-07-20T00:00:00.000Z' });
    expect(state.run).toEqual({
      currentFloor: 5,
      lives: 2,
      status: 'active',
      floorsCleared: 4,
      winStreak: 6,
    });
    expect(state.floors[0]).toEqual({
      floorNo: 5,
      wordLength: 5,
      clockMs: 105000,
      twists: [{ kind: 'shuffle' }, { kind: 'blind' }],
      veriReward: 120,
      isBoss: true,
      itemPreview: { kind: 'protocol', id: 'info_postest' },
    });
    expect(state.active?.guesses).toEqual([{ guess: 'kitap', marks: 'GY?XX', greenCount: 1 }]);
    expect(state.veri).toBe(700);
  });

  it('defaults run/active to null and coerces missing numbers', () => {
    const state = mapTowerState({ floors: [] });
    expect(state.run).toBeNull();
    expect(state.active).toBeNull();
    expect(state.period).toEqual({ id: null, endsAt: null });
    expect(state.veri).toBe(0);
  });

  it('drops an unknown item_preview kind to null', () => {
    const state = mapTowerState({
      floors: [
        {
          floor_no: 1,
          word_length: 4,
          clock_ms: 150000,
          twists: null,
          veri_reward: 30,
          is_boss: false,
          item_preview: { kind: 'mystery', id: 'x' },
        },
      ],
    });
    expect(state.floors[0].itemPreview).toBeNull();
    expect(state.floors[0].twists).toEqual([]);
  });
});

describe('mapTowerOutcome', () => {
  it('maps a winning floor_cleared outcome with reward', () => {
    const out = mapTowerOutcome({
      status: 'floor_cleared',
      marks: 'GGGGG',
      green_count: 5,
      lives: 3,
      reward: { veri: 120, kupa: 18, item_kind: 'protocol', item_id: 'info_postest', converted: false },
      reveal: { secret: 'kitap', secret2: null },
    });
    expect(out.status).toBe('floor_cleared');
    expect(out.reward).toEqual({
      veri: 120,
      kupa: 18,
      itemKind: 'protocol',
      itemId: 'info_postest',
      converted: false,
    });
    expect(out.reveal).toEqual({ secret: 'kitap', secret2: null });
    expect(out.remainingMs).toBeNull();
  });

  it('maps a playing outcome and null reward/reveal', () => {
    const out = mapTowerOutcome({
      status: 'playing',
      marks: 'XX?X',
      green_count: 0,
      remaining_ms: 129697,
      lives: 3,
      solved1: false,
      solved2: false,
    });
    expect(out).toMatchObject({
      status: 'playing',
      marks: 'XX?X',
      greenCount: 0,
      remainingMs: 129697,
      lives: 3,
      reward: null,
      reveal: null,
    });
  });

  it('nulls itemId when a converted reward has no item', () => {
    const out = mapTowerOutcome({
      status: 'floor_cleared',
      marks: 'GGGGGG',
      green_count: 6,
      lives: 1,
      reward: { veri: 650, kupa: 10, item_kind: null, item_id: null, converted: true },
      reveal: { secret: 'kelime', secret2: null },
    });
    expect(out.reward).toEqual({ veri: 650, kupa: 10, itemKind: null, itemId: null, converted: true });
  });
});
