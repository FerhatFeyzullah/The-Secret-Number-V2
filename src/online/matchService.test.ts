// RPC sarmalayıcılarını ağ olmadan test eder: supabase istemcisi mock'lanır.
import { supabase } from '../supabase';
import {
  cancelWaiting,
  claimTimeout,
  fetchMatchState,
  findOrCreateQuickMatch,
  getMyRank,
  getRecentMatches,
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
    from: jest.fn(),
    auth: { getSession: jest.fn() },
  },
}));

const client = supabase as NonNullable<typeof supabase>;
const rpcMock = client.rpc as jest.Mock;
const fromMock = client.from as unknown as jest.Mock;
const getSessionMock = client.auth.getSession as jest.Mock;

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  getSessionMock.mockReset();
});

/** Zincirlenebilir + await edilebilir PostgREST sorgu taklidi (select/eq/in/
 *  order/maybeSingle hepsi builder'ı döndürür; await → verilen sonuç). */
function queryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    maybeSingle: () => Promise.resolve(result),
    then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onF, onR),
  };
  return builder;
}

const MATCH_ROW = {
  id: 'm1',
  status: 'active',
  mode: 'ranked',
  room_code: null,
  player1: 'me',
  player2: 'opp',
  current_turn: 'me',
  turn_started_at: null,
  clock1_ms: 60000,
  clock2_ms: 60000,
  setup_deadline: null,
  winner: null,
  result: null,
};

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

  it("word kuyruğu için p_content_type parametresi gönderir", async () => {
    rpcResolves({ match_id: 'm2', role: 'player1', status: 'waiting' });
    await expect(findOrCreateQuickMatch('word')).resolves.toEqual({
      matchId: 'm2',
      role: 'player1',
      status: 'waiting',
    });
    expect(rpcMock).toHaveBeenCalledWith('find_or_create_quick_match', {
      p_content_type: 'word',
    });
  });

  // Kelime modu PROTOKOLSÜZ: kelime maçı protokol kuyruğundan (find_or_create_
  // protocol_match) DEĞİL, quick RPC'sinden doğar; eşleşen oyuncu doğrudan
  // 'setup'a düşer (protocol_select fazı YOK). Bu sözleşme, yönlendirmenin
  // kelimeyi asla Kader Eli seçim ekranına götürmemesini garanti eder.
  it('kelime maçına katılım protokol seçimi atlar (status=setup)', async () => {
    rpcResolves({ match_id: 'm3', role: 'player2', status: 'setup' });
    const ticket = await findOrCreateQuickMatch('word');
    expect(ticket.status).toBe('setup');
    expect(ticket.status).not.toBe('protocol_select');
    // Yalnız quick RPC çağrılır; protokol-maçı RPC'si ASLA çağrılmaz.
    expect(rpcMock).toHaveBeenCalledWith('find_or_create_quick_match', {
      p_content_type: 'word',
    });
    expect(rpcMock).not.toHaveBeenCalledWith('find_or_create_protocol_match', expect.anything());
    expect(rpcMock).not.toHaveBeenCalledWith('find_or_create_protocol_match');
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

  // Regresyon (cihaz hatası): kelime, sayı parser'ına takılıp RPC'ye hiç
  // gitmeden reddediliyordu — contentType='word' ile kelime parser'ı kullanılır.
  it("kelime maçında geçerli Türkçe kelimeyi RPC'ye GÖNDERİR", async () => {
    rpcResolves({ match_id: 'm1', status: 'setup' });
    await expect(setSecret('m1', 'kalem', 'word')).resolves.toEqual({ status: 'setup' });
    expect(rpcMock).toHaveBeenCalledWith('set_secret', {
      p_match_id: 'm1',
      p_digits: 'kalem',
    });
  });

  it("kelime maçında format-bozuk girdiyi RPC'siz reddeder", async () => {
    const err = await setSecret('m1', 'ka1em', 'word').catch((e: unknown) => e);
    expect((err as OnlineError).code).toBe('invalid_digits');
    expect(rpcMock).not.toHaveBeenCalled();
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

describe('istek zaman aşımı (withTimeout)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('asılı RPC ~10 sn sonra timeout OnlineError fırlatır', async () => {
    jest.useFakeTimers();
    rpcMock.mockReturnValueOnce(new Promise(() => {})); // hiç çözülmez (ölü ağ)
    const settled = makeGuess('m1', '123').catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(10_000);
    const err = await settled;
    expect(err).toBeInstanceOf(OnlineError);
    expect((err as OnlineError).code).toBe('timeout');
    expect((err as OnlineError).message).toBe('Sunucu yanıt vermedi, lütfen tekrar dene.');
  });

  it('hızlı çözülen RPC timeout FIRLATMAZ (timer temizlenir)', async () => {
    jest.useFakeTimers();
    rpcResolves({
      match_id: 'm1',
      status: 'active',
      result: null,
      winner: null,
      feedback: null,
      current_turn: 'opp',
      clock1_ms: 1,
      clock2_ms: 2,
    });
    await expect(makeGuess('m1', '123')).resolves.toMatchObject({ matchId: 'm1' });
    // Timer temizlendiyse ilerletme askıda bir reddi tetiklemez.
    await jest.advanceTimersByTimeAsync(20_000);
  });
});

describe('getRecentMatches', () => {
  it('RPC jsonb dizisini RecentMatch[] olarak eşler', async () => {
    rpcResolves([
      {
        match_id: 'm1',
        mode: 'protocol',
        content_type: 'word',
        win_target: 3,
        player1_name: 'ferhat',
        player2_name: 'mehmet',
        p1_won: true,
        result: 'win',
        p1_round_wins: 2,
        p2_round_wins: 1,
        p1_rating_delta: 21,
        p2_rating_delta: -16,
        rounds: [{ round: 1, p1_secret: 'kalem', p2_secret: 'masa', winner: 1 }],
      },
    ]);
    const out = await getRecentMatches();
    expect(out[0]).toMatchObject({
      matchId: 'm1',
      mode: 'protocol',
      contentType: 'word',
      winTarget: 3,
      p1Won: true,
      p1RatingDelta: 21,
      p2RatingDelta: -16,
    });
    expect(out[0].rounds[0]).toEqual({ round: 1, p1Secret: 'kalem', p2Secret: 'masa', winner: 1 });
    expect(rpcMock).toHaveBeenCalledWith('get_recent_matches', undefined);
  });

  it('boş/null dönüşte boş dizi', async () => {
    rpcResolves(null);
    await expect(getRecentMatches()).resolves.toEqual([]);
  });
});

describe('fetchMatchState skipProfiles (A5)', () => {
  beforeEach(() => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: 'me' } } } });
  });

  it('varsayılan: profiles sorgusunu çağırır ve adları haritalar', async () => {
    fromMock.mockImplementation((table: string) =>
      table === 'profiles'
        ? queryBuilder({ data: [{ id: 'me', username: 'Ben' }], error: null })
        : queryBuilder({ data: MATCH_ROW, error: null }),
    );
    const state = await fetchMatchState('m1');
    expect(fromMock).toHaveBeenCalledWith('profiles');
    expect(state?.player1.username).toBe('Ben');
  });

  it('skipProfiles: profiles sorgusunu ATLAR, adlar null kalır', async () => {
    fromMock.mockImplementation(() => queryBuilder({ data: MATCH_ROW, error: null }));
    const state = await fetchMatchState('m1', { skipProfiles: true });
    expect(fromMock).toHaveBeenCalledWith('matches');
    expect(fromMock).not.toHaveBeenCalledWith('profiles');
    expect(state?.player1.username).toBeNull();
    expect(state?.player2?.username).toBeNull();
  });
});
