// RPC sarmalayıcılarını ağ olmadan test eder: supabase istemcisi mock'lanır.
import { supabase } from '../supabase';
import {
  cancelWaiting,
  claimTimeout,
  findOrCreateQuickMatch,
  getMyRank,
  joinPrivateRoom,
  leaveMatch,
  makeGuess,
  OnlineError,
  setSecret,
  unlockProtocol,
} from './matchService';

jest.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: jest.fn(),
    auth: { getSession: jest.fn() },
  },
}));

const rpcMock = (supabase as NonNullable<typeof supabase>).rpc as jest.Mock;

beforeEach(() => {
  rpcMock.mockReset();
});

function rpcResolves(data: unknown) {
  rpcMock.mockResolvedValueOnce({ data, error: null });
}

function rpcFails(message: string) {
  rpcMock.mockResolvedValueOnce({ data: null, error: { message } });
}

describe('findOrCreateQuickMatch', () => {
  it('jsonb dönüşünü MatchTicket olarak eşler', async () => {
    rpcResolves({ match_id: 'm1', role: 'player2', status: 'setup' });
    await expect(findOrCreateQuickMatch()).resolves.toEqual({
      matchId: 'm1',
      role: 'player2',
      status: 'setup',
    });
    expect(rpcMock).toHaveBeenCalledWith('find_or_create_quick_match', undefined);
  });
});

describe('hata eşleme', () => {
  it('sunucu kodunu Türkçe-anlamlı OnlineError yapar', async () => {
    rpcFails('not_your_turn');
    const err = await makeGuess('m1', '123').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OnlineError);
    expect((err as OnlineError).code).toBe('not_your_turn');
    expect((err as OnlineError).message).toBe('Sıra sende değil.');
  });

  it('bilinmeyen sunucu hatasını unknown koduna düşürür', async () => {
    rpcFails('connection reset by peer');
    const err = await joinPrivateRoom('ABC234').catch((e: unknown) => e);
    expect((err as OnlineError).code).toBe('unknown');
  });
});

describe('setSecret istemci ön-doğrulaması', () => {
  it.each(['120', '112', '12', 'abc', '1234'])(
    "geçersiz '%s' için RPC'yi HİÇ çağırmadan reddeder",
    async (digits) => {
      const err = await setSecret('m1', digits).catch((e: unknown) => e);
      expect((err as OnlineError).code).toBe('invalid_digits');
      expect(rpcMock).not.toHaveBeenCalled();
    },
  );

  it('geçerli sayıyı doğru parametrelerle gönderir', async () => {
    rpcResolves({ match_id: 'm1', status: 'setup' });
    await expect(setSecret('m1', '297')).resolves.toEqual({ status: 'setup' });
    expect(rpcMock).toHaveBeenCalledWith('set_secret', {
      p_match_id: 'm1',
      p_digits: '297',
    });
  });
});

describe('makeGuess', () => {
  it('güvenli sonucu GuessOutcome olarak eşler (sır içeren alan yok)', async () => {
    rpcResolves({
      match_id: 'm1',
      status: 'active',
      result: null,
      winner: null,
      feedback: 'partial:1',
      current_turn: 'opp-id',
      clock1_ms: 51234,
      clock2_ms: 60000,
    });
    const outcome = await makeGuess('m1', '123');
    expect(outcome).toEqual({
      matchId: 'm1',
      status: 'active',
      result: null,
      winner: null,
      feedback: 'partial:1',
      currentTurn: 'opp-id',
      clock1Ms: 51234,
      clock2Ms: 60000,
    });
    expect(Object.keys(outcome)).not.toEqual(
      expect.arrayContaining(['digits', 'secret', 'secrets']),
    );
  });

  it('geçersiz tahmini RPC çağırmadan reddeder', async () => {
    const err = await makeGuess('m1', '110').catch((e: unknown) => e);
    expect((err as OnlineError).code).toBe('invalid_digits');
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe('claimTimeout / cancelWaiting', () => {
  it('claim_timeout dönüşünü eşler (feedback yok)', async () => {
    rpcResolves({
      match_id: 'm1',
      status: 'finished',
      result: 'timeout',
      winner: 'me',
      clock1_ms: 0,
      clock2_ms: 31000,
    });
    await expect(claimTimeout('m1')).resolves.toMatchObject({
      status: 'finished',
      result: 'timeout',
      winner: 'me',
      feedback: null,
    });
  });

  it('cancelWaiting doğru RPC adını çağırır', async () => {
    rpcResolves({ match_id: 'm1', status: 'cancelled', result: 'cancelled' });
    await expect(cancelWaiting('m1')).resolves.toBeUndefined();
    expect(rpcMock).toHaveBeenCalledWith('cancel_waiting', { p_match_id: 'm1' });
  });
});

describe('leaveMatch', () => {
  it('setup maçtan çıkışı left=true/cancelled olarak eşler', async () => {
    rpcResolves({ match_id: 'm1', left: true, status: 'cancelled', result: 'cancelled', winner: null });
    await expect(leaveMatch('m1')).resolves.toEqual({
      left: true,
      status: 'cancelled',
      result: 'cancelled',
    });
    expect(rpcMock).toHaveBeenCalledWith('leave_match', { p_match_id: 'm1' });
  });

  it('bitmiş maçta no-op (left=false) hata fırlatmaz', async () => {
    rpcResolves({ match_id: 'm1', left: false, status: 'finished', result: 'win', winner: 'opp' });
    await expect(leaveMatch('m1')).resolves.toEqual({
      left: false,
      status: 'finished',
      result: 'win',
    });
  });

  it('active maçtan çıkış forfeit olarak döner', async () => {
    rpcResolves({ match_id: 'm1', left: true, status: 'finished', result: 'forfeit', winner: 'opp' });
    await expect(leaveMatch('m1')).resolves.toMatchObject({
      left: true,
      result: 'forfeit',
    });
  });
});

describe('getMyRank', () => {
  it('xp/level/veri + ilerleme eşiklerini MyRank olarak eşler', async () => {
    rpcResolves({
      rank: 3,
      username: 'vavi',
      rating: 1030,
      wins: 4,
      played: 7,
      streak: 2,
      xp: 435,
      level: 4,
      veri: 325,
      level_floor: 420,
      level_next: 640,
    });
    await expect(getMyRank()).resolves.toEqual({
      rank: 3,
      username: 'vavi',
      rating: 1030,
      wins: 4,
      played: 7,
      streak: 2,
      xp: 435,
      level: 4,
      veri: 325,
      levelFloor: 420,
      levelNext: 640,
      owned: [],
      ownedSignals: [],
      signalDeck: [],
      seasonId: null,
    });
    expect(rpcMock).toHaveBeenCalledWith('get_my_rank', undefined);
  });

  it('maks seviyede level_next=null korunur', async () => {
    rpcResolves({
      rank: 1,
      username: 'vavi',
      rating: 1500,
      wins: 30,
      played: 40,
      streak: 5,
      xp: 2500,
      level: 10,
      veri: 2400,
      level_floor: 2340,
      level_next: null,
    });
    await expect(getMyRank()).resolves.toMatchObject({ level: 10, levelNext: null });
  });

  it('eski sunucuya (alanlar yok) karşı güvenli varsayılanlara düşer', async () => {
    rpcResolves({ rank: 5, username: 'vavi', rating: 990, wins: 1 });
    await expect(getMyRank()).resolves.toEqual({
      rank: 5,
      username: 'vavi',
      rating: 990,
      wins: 1,
      played: 0,
      streak: 0,
      xp: 0,
      level: 1,
      veri: 0,
      levelFloor: 0,
      levelNext: null,
      owned: [],
      ownedSignals: [],
      signalDeck: [],
      seasonId: null,
    });
  });

  it('season_id alanını (lig/sezon) eşler', async () => {
    rpcResolves({ rank: 2, username: 'vavi', rating: 1100, wins: 5, season_id: 3 });
    await expect(getMyRank()).resolves.toMatchObject({ seasonId: 3 });
  });

  it('owned_signals / signal_deck alanlarını eşler', async () => {
    rpcResolves({
      rank: 2,
      username: 'vavi',
      rating: 1100,
      wins: 5,
      owned_signals: ['sig_victory', 'sig_shock'],
      signal_deck: ['sig_victory'],
    });
    await expect(getMyRank()).resolves.toMatchObject({
      ownedSignals: ['sig_victory', 'sig_shock'],
      signalDeck: ['sig_victory'],
    });
  });

  it('owned_protocols alanını eşler', async () => {
    rpcResolves({
      rank: 2,
      username: 'vavi',
      rating: 1100,
      wins: 5,
      owned_protocols: ['time_add', 'info_eliminate', 'def_shield'],
    });
    await expect(getMyRank()).resolves.toMatchObject({
      owned: ['time_add', 'info_eliminate', 'def_shield'],
    });
  });
});

describe('unlockProtocol', () => {
  it('unlock_protocol dönüşünü eşler', async () => {
    rpcResolves({ id: 'def_shield', veri: 50, owned: ['time_add', 'info_eliminate', 'def_shield'] });
    await expect(unlockProtocol('def_shield')).resolves.toEqual({
      veri: 50,
      owned: ['time_add', 'info_eliminate', 'def_shield'],
    });
    expect(rpcMock).toHaveBeenCalledWith('unlock_protocol', { p_id: 'def_shield' });
  });
});
