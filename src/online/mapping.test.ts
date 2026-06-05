import {
  displayClocks,
  feedbackToGuessResult,
  guessRowToGuess,
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
      createdAt: '2026-06-05T10:00:03.000Z',
    });
  });
});
