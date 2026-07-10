// Sanal oyuncu: gerçek istemcinin (src/online/matchService.ts) RPC akışını taklit
// eder. Tek "runMatchLoop" döngüsü word/number/protocol/private maçlarını savunmacı
// biçimde yürütür — status'a göre mark_ready → (protokol) seçim → set_secret → guess.
import { newPlayerClient } from './client.mjs';
import { randomContent } from './words.mjs';

const OVERALL_TIMEOUT_MS = 4 * 60 * 1000; // bir oturum en fazla 4 dk yaşar
const PAIR_TIMEOUT_MS = 30_000; // eşleşme için en fazla bekleme
const POLL_MS = 1000; // maç durumu yoklama aralığı

// make_guess çözüldüğü an → Realtime guesses event'i gelince fanout gecikmesi ölçülür
// (aynı Node süreci = aynı saat, bu yüzden karşılaştırma geçerli; yaklaşık).
const guessAt = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** RPC sarmalayıcı: sunucunun RAISE mesajını .code olarak taşıyan hata fırlatır. */
async function rpc(client, fn, args) {
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    const e = new Error(error.message || 'rpc_error');
    e.code = error.message || 'unknown';
    throw e;
  }
  return data;
}

async function fetchMatch(client, matchId) {
  const { data } = await client.from('matches').select('*').eq('id', matchId).maybeSingle();
  return data ?? null;
}

/** Bir hesapla oturum aç; { client, id } döndür. */
export async function openPlayer(cfg, metrics, email) {
  const client = newPlayerClient(cfg);
  const id = await metrics.time('auth_signin', async () => {
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password: cfg.accountPassword,
    });
    if (error) {
      const e = new Error(error.message);
      e.code = 'auth:' + error.message;
      throw e;
    }
    return data.user.id;
  });
  return { client, id };
}

function subscribeRealtime(client, matchId, metrics) {
  const ch = client.channel(`lt:match:${matchId}`);
  ch.on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'guesses', filter: `match_id=eq.${matchId}` },
    () => {
      const t = guessAt.get(matchId);
      if (t) metrics.record('realtime_fanout', Date.now() - t);
      metrics.incr('realtime_guess_events');
    },
  );
  ch.on(
    'postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
    () => metrics.incr('realtime_match_events'),
  );
  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') metrics.incr('realtime_subscribed');
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') metrics.incr('realtime_error');
  });
  return ch;
}

/** Eşleşmeyi bekle: status 'waiting' değilken (setup/active/finished) dön. */
async function waitForPairing(client, matchId, metrics, sinceTs) {
  const deadline = Date.now() + PAIR_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const m = await fetchMatch(client, matchId);
    if (m && m.status !== 'waiting') {
      metrics.record('pairing', Date.now() - sinceTs);
      return m;
    }
    await sleep(POLL_MS);
  }
  metrics.incr('pairing_timeout');
  return null;
}

/** Bir maçı baştan sona (savunmacı) oynar. matchId eşleşmiş bir maça ait olmalı. */
async function runMatchLoop(cfg, metrics, client, myId, matchId) {
  const ch = subscribeRealtime(client, matchId, metrics);
  const deadline = Date.now() + OVERALL_TIMEOUT_MS;
  const secretsSet = new Set(); // secret girdiğim round'lar
  let selectionDone = false; // protokol seçimi yapıldı mı
  let readyDone = false;
  let ownTurns = 0;
  let lastHeartbeat = 0;
  let finished = false;

  try {
    while (Date.now() < deadline) {
      const m = await fetchMatch(client, matchId);
      if (!m) break;

      if (m.status === 'finished') {
        finished = true;
        metrics.incr('match_finished');
        try {
          await metrics.time('get_match_reveal', () => rpc(client, 'get_match_reveal', { p_match_id: matchId }));
        } catch {}
        break;
      }

      // Heartbeat (gerçek istemci gibi periyodik).
      if (Date.now() - lastHeartbeat > cfg.heartbeatMs) {
        lastHeartbeat = Date.now();
        try {
          await metrics.time('heartbeat', () => rpc(client, 'heartbeat', { p_match_id: matchId }));
        } catch (e) {
          metrics.countError(e.code);
        }
      }

      if (m.status === 'setup') {
        if (!readyDone) {
          try {
            await metrics.time('mark_ready', () => rpc(client, 'mark_ready', { p_match_id: matchId }));
          } catch (e) {
            metrics.countError(e.code);
          }
          readyDone = true;
        }
        // Protokol maçı: önce seçim fazını sunucuya rastgele doldurt.
        if (m.mode === 'protocol' && !selectionDone) {
          try {
            await metrics.time('set_protocol_selection', () =>
              rpc(client, 'set_protocol_selection', { p_match_id: matchId, p_ids: [] }),
            );
            selectionDone = true;
          } catch (e) {
            // not_in_select / not_both_present → sonraki yoklamada tekrar dene.
            metrics.countError(e.code);
          }
        }
        // Secret: bu round için henüz girmediysem (protokolde seçim bitmeden
        // 'not_in_setup' döner → sonraki yoklamada tekrar denenir).
        if (!secretsSet.has(m.current_round) && !(m.mode === 'protocol' && !selectionDone)) {
          const secret = randomContent(m.content_type, m.word_length);
          try {
            await metrics.time('set_secret', () =>
              rpc(client, 'set_secret', { p_match_id: matchId, p_digits: secret }),
            );
            secretsSet.add(m.current_round);
          } catch (e) {
            if (e.code === 'match_already_ready') secretsSet.add(m.current_round);
            else metrics.countError(e.code);
          }
        }
      } else if (m.status === 'active') {
        if (m.current_turn === myId) {
          ownTurns++;
          if (ownTurns > cfg.maxTurns) break; // finally'de leaveMatch ile kapanır
          const guess = randomContent(m.content_type, m.word_length);
          try {
            const out = await metrics.time('make_guess', () =>
              rpc(client, 'make_guess', { p_match_id: matchId, p_digits: guess }),
            );
            guessAt.set(matchId, Date.now());
            metrics.incr('guesses');
            if (out && out.status === 'finished') {
              finished = true;
              metrics.incr('match_finished');
              break;
            }
          } catch (e) {
            // not_your_turn = iyi huylu yarış; diğerleri gerçek sinyal.
            metrics.countError(e.code);
          }
        }
        // rakip sırasıysa: yoklamaya devam (aşağıdaki sleep).
      }

      await sleep(POLL_MS);
    }
  } finally {
    if (!finished) {
      metrics.incr('match_left_incomplete');
      try {
        await rpc(client, 'leave_match', { p_match_id: matchId });
      } catch {}
    }
    try {
      await client.removeChannel(ch);
    } catch {}
  }
}

/** Hızlı/protokol oyuncusu: eşleş + oyna. content: 'word' | 'number' | 'protocol'. */
export async function playSession(cfg, metrics, player, kind) {
  const { client, id } = player;
  let ticket;
  try {
    const t0 = Date.now();
    if (kind === 'protocol') {
      ticket = await metrics.time('matchmake_protocol', () =>
        rpc(client, 'find_or_create_protocol_match', undefined),
      );
    } else {
      ticket = await metrics.time('matchmake_quick', () =>
        rpc(client, 'find_or_create_quick_match', kind === 'number' ? undefined : { p_content_type: 'word' }),
      );
    }
    metrics.incr('matchmake_ok');
    const matchId = ticket.match_id;
    // Eşleşmeyi bekle (kurucuysam rakip gelene dek; katılansam zaten setup).
    if (ticket.status === 'waiting') {
      const paired = await waitForPairing(client, matchId, metrics, t0);
      if (!paired) {
        try {
          await rpc(client, 'leave_match', { p_match_id: matchId });
        } catch {}
        return;
      }
    } else {
      metrics.record('pairing', 0);
    }
    await runMatchLoop(cfg, metrics, client, id, matchId);
  } catch (e) {
    metrics.countError(e.code ?? 'unknown');
    metrics.incr('session_error');
  }
}

/** Özel oda çifti: host oda kurar, kodu paylaşır; guest katılır; ikisi de oynar. */
export async function playPrivatePair(cfg, metrics, host, guest) {
  try {
    const roomMode = Math.random() < 0.5 ? 'word' : 'quick';
    const ticket = await metrics.time('create_private_room', () =>
      rpc(host.client, 'create_private_room', {
        p_clock_ms: 120000,
        p_first_turn_mode: 'random',
        p_room_mode: roomMode,
        p_word_length: null,
      }),
    );
    const code = ticket.room_code;
    metrics.incr('private_room_created');
    // Guest katılır.
    const gTicket = await metrics.time('join_private_room', () =>
      rpc(guest.client, 'join_private_room', { p_code: code }),
    );
    const matchId = ticket.match_id ?? gTicket.match_id;
    await Promise.all([
      runMatchLoop(cfg, metrics, host.client, host.id, matchId),
      runMatchLoop(cfg, metrics, guest.client, guest.id, matchId),
    ]);
  } catch (e) {
    metrics.countError(e.code ?? 'unknown');
    metrics.incr('private_error');
  }
}

/** "Yalnız-matchmake" fırtına oyuncusu: kuyruğa gir, hemen iptal et (kontenjan çekişmesi). */
export async function runStorm(cfg, metrics, player) {
  const { client } = player;
  try {
    const ticket = await metrics.time('matchmake_storm', () =>
      rpc(client, 'find_or_create_quick_match', { p_content_type: 'word' }),
    );
    metrics.incr('storm_matchmake_ok');
    try {
      await rpc(client, 'leave_match', { p_match_id: ticket.match_id });
    } catch {}
  } catch (e) {
    metrics.countError(e.code ?? 'unknown');
    metrics.incr('storm_error');
  }
}
