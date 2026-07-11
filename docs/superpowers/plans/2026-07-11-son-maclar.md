# Son Maçlar (Global Maç Akışı) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ana menüden açılan bir modalde, oyunda oynanan son 30 eşleşmeli maçı (tur-bazlı gizli ifşa + kupa deltalarıyla) global bir akış olarak göster.

**Architecture:** Bitmiş eşleşmeli maçlar 15 dk'da silindiği için, maç bitişinde minik bir özet `match_history` tablosuna **snapshot** alınır. Snapshot **saf ek trigger'larla** beslenir (mevcut `_advance_or_finish`/`_apply_rating` DEĞİŞMEZ): bir trigger tur kazananlarını `round_results`'a yazar, bir trigger `rating_applied` true olunca özeti kaydeder. Feed `get_recent_matches()` RPC'siyle okunur. İstemci `RecentMatchesModal` (lider tablosu deseni) + ana menü butonu.

**Tech Stack:** Supabase Postgres (plpgsql, trigger, SECURITY DEFINER RPC), React Native / Expo SDK 54, TypeScript, jest-expo.

## Global Constraints

- Expo SDK 54, RN 0.81.5, React 19 (React Compiler açık). Yeni native paket YOK.
- Türkçe kod yorumları (proje kuralı). Renk/font `src/ui/theme.ts` token'larından.
- Migration idempotent olmalı (`create ... if not exists`, `create or replace`, `drop trigger if exists`) — panelde tekrar çalıştırılabilir.
- `match_history.match_id` **FK DEĞİL** (yalnız UNIQUE) → 15 dk reap tarafından silinmez.
- Yalnız eşleşmeli maçlar: `mode in ('quick','protocol')`. Private/dostluk dışarıda.
- Feed sırası: `ended_at desc`, limit 30. Rolling-30 (insert'te en eski silinir, cron yok).
- RPC dönüşleri snake_case → istemci camelCase eşler (mevcut matchService deseni).
- Tüm RPC çağrıları `callRpc` (zaten `withTimeout` sarmalı) üzerinden.

---

### Task 1: Veritabanı migration'ı (tablolar + trigger'lar + RPC)

**Files:**
- Create: `supabase/migrations/20260711000000_match_history.sql`

**Interfaces:**
- Produces (server):
  - table `public.match_history` (kalıcı özet; FK yok)
  - table `public.round_results (match_id, round, winner)`
  - trigger `trg_capture_round_result` (round_wins artışında tur kazananını yazar)
  - trigger `trg_record_match_history` (rating_applied true olunca snapshot)
  - function `public.get_recent_matches() returns jsonb` — authenticated'a grant
- RPC dönüş şekli (jsonb array, her eleman):
  `{ match_id, ended_at, mode, content_type, win_target, player1_name, player2_name, p1_won(bool), result, p1_round_wins, p2_round_wins, p1_rating_delta, p2_rating_delta, rounds: [{round, p1_secret, p2_secret, winner(1|2)}] }`

- [ ] **Step 1: Migration dosyasını yaz**

`supabase/migrations/20260711000000_match_history.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════════
-- Global "Son Maçlar" akışı: bitmiş EŞLEŞMELİ maçların kalıcı, minik özetleri.
-- SAF EK: mevcut _advance_or_finish / _apply_rating DEĞİŞMEZ; iki trigger'la
-- beslenir. match_history matches'a FK TUTMAZ → 15-dk reap onu SİLMEZ.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) round_results: tur kazananı (match-scoped, maçla birlikte silinir — snapshot
--    maç bitişinde alındığından reap'ten önce hep mevcut). _advance_or_finish'in
--    round_wins ARTIRAN update'inden trigger ile dolar.
create table if not exists public.round_results (
  match_id uuid not null references public.matches(id) on delete cascade,
  round int not null,
  winner uuid not null,
  primary key (match_id, round)
);
alter table public.round_results enable row level security;
revoke all on public.round_results from anon, authenticated;

create or replace function public._capture_round_result()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- old.current_round = az önce çözülen tur (finish dalı current_round'u değiştirmez,
  -- advance dalı SONRADAN +1 yapar; her iki durumda old = çözülen tur).
  if new.p1_round_wins > old.p1_round_wins then
    insert into round_results(match_id, round, winner)
      values (new.id, old.current_round, new.player1) on conflict do nothing;
  elsif new.p2_round_wins > old.p2_round_wins then
    insert into round_results(match_id, round, winner)
      values (new.id, old.current_round, new.player2) on conflict do nothing;
  end if;
  return null;
end; $$;

drop trigger if exists trg_capture_round_result on public.matches;
create trigger trg_capture_round_result
  after update of p1_round_wins, p2_round_wins on public.matches
  for each row execute function public._capture_round_result();

-- 2) match_history: kalıcı özet. match_id UNIQUE ama FK DEĞİL → reap silmez.
create table if not exists public.match_history (
  id bigint generated always as identity primary key,
  match_id uuid not null unique,
  ended_at timestamptz not null default now(),
  mode text not null,
  content_type text not null default 'number',
  win_target int not null default 1,
  player1 uuid not null,
  player2 uuid,
  player1_name text,
  player2_name text,
  winner uuid,
  result text,
  p1_round_wins int not null default 0,
  p2_round_wins int not null default 0,
  p1_rating_delta int,
  p2_rating_delta int,
  rounds jsonb not null default '[]'::jsonb
);
create index if not exists match_history_ended_idx on public.match_history (ended_at desc);
alter table public.match_history enable row level security;
revoke all on public.match_history from anon, authenticated;

-- 3) Snapshot: rating_applied true olunca (deltalar YAZILDIKTAN sonra) çağrılır.
create or replace function public._record_match_history(p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  p1n text;
  p2n text;
  rj jsonb;
begin
  select * into m from matches where id = p_match_id;
  if not found or m.mode not in ('quick','protocol')
     or m.status <> 'finished' or m.winner is null then
    return;
  end if;

  select username into p1n from profiles where id = m.player1;
  select username into p2n from profiles where id = m.player2;

  -- Turlar: her tur için iki gizli + kazanan (round_results, yoksa maç kazananı).
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'round', r.round,
             'p1_secret', s1.digits,
             'p2_secret', s2.digits,
             'winner', case when coalesce(rr.winner, m.winner) = m.player1 then 1 else 2 end
           ) order by r.round), '[]'::jsonb)
    into rj
    from (select distinct round from secrets where match_id = m.id) r
    left join secrets s1 on s1.match_id = m.id and s1.round = r.round and s1.player = m.player1
    left join secrets s2 on s2.match_id = m.id and s2.round = r.round and s2.player = m.player2
    left join round_results rr on rr.match_id = m.id and rr.round = r.round;

  insert into match_history(match_id, ended_at, mode, content_type, win_target,
      player1, player2, player1_name, player2_name, winner, result,
      p1_round_wins, p2_round_wins, p1_rating_delta, p2_rating_delta, rounds)
    values (m.id, now(), m.mode, coalesce(m.content_type,'number'), coalesce(m.win_target,1),
      m.player1, m.player2, p1n, p2n, m.winner, m.result,
      coalesce(m.p1_round_wins,0), coalesce(m.p2_round_wins,0),
      m.p1_rating_delta, m.p2_rating_delta, rj)
    on conflict (match_id) do nothing;

  -- Rolling-30: yalnız en yeni 30 kayıt kalsın (cron gerekmez).
  delete from match_history
   where id not in (select id from match_history order by ended_at desc, id desc limit 30);
end; $$;

create or replace function public._on_rating_applied()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform _record_match_history(new.id);
  return null;
end; $$;

drop trigger if exists trg_record_match_history on public.matches;
create trigger trg_record_match_history
  after update of rating_applied on public.matches
  for each row when (new.rating_applied and not old.rating_applied)
  execute function public._on_rating_applied();

-- 4) Okuma RPC: son 30, giriş yapan herkese açık. Bitmiş maç → gizli/isim
--    public-safe (zaten iki tarafa reveal ediliyor, tek maçlık). Ham uuid'ler
--    dışarı sızmaz; yalnız isim + p1_won (kazanan taraf) döner.
create or replace function public.get_recent_matches()
returns jsonb language sql security definer set search_path = public stable as $$
  select coalesce(jsonb_agg(to_jsonb(h) order by h.ended_at desc), '[]'::jsonb)
  from (
    select match_id, ended_at, mode, content_type, win_target,
           player1_name, player2_name,
           (winner = player1) as p1_won,
           result, p1_round_wins, p2_round_wins,
           p1_rating_delta, p2_rating_delta, rounds
    from match_history
    order by ended_at desc
    limit 30
  ) h;
$$;
revoke execute on function public.get_recent_matches() from public, anon;
grant execute on function public.get_recent_matches() to authenticated;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: SQL sözdizimi/idempotency doğrula (postgres:16-alpine smoke)**

Run (opsiyonel yerel smoke — Supabase şeması gerektirmeden yalnız DDL parse etmez; asıl davranış testi panelde):
```bash
docker run --rm -v "$PWD/supabase/migrations:/m:ro" postgres:16-alpine \
  sh -c 'initdb -D /tmp/d >/dev/null 2>&1 && pg_ctl -D /tmp/d -o "-k /tmp" -w start >/dev/null 2>&1; psql -h /tmp -U postgres -d postgres -f /m/20260711000000_match_history.sql 2>&1 | tail -20'
```
Expected: `matches`/`profiles`/`secrets` tabloları olmadığından FK/kolon referansları hata verebilir — bu smoke YALNIZCA sözdizimi/typo yakalamak içindir. Asıl doğrulama Step 3.

> **NOT (kritik):** Migration'ı gerçek veritabanına **kullanıcı Supabase panelinden** uygular (proje CLI-migration kullanmıyor). Bu task'ın çıktısı SQL dosyasıdır; DB'ye uygulanması + davranış testi kullanıcıya bırakılır (aşağıda "Uygulama & Doğrulama" bölümü).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260711000000_match_history.sql
git commit -m "feat(db): son maçlar için match_history snapshot + get_recent_matches RPC"
```

---

### Task 2: İstemci tipleri + servis + birim testi

**Files:**
- Modify: `src/online/types.ts` (dosya sonuna tipler)
- Modify: `src/online/matchService.ts` (yeni `getRecentMatches`)
- Modify: `src/online/index.ts` (export)
- Test: `src/online/matchService.test.ts` (yeni describe)

**Interfaces:**
- Consumes: `callRpc<T>(fn)` (matchService içi, withTimeout sarmalı).
- Produces:
  - `type RecentMatch`, `type RecentMatchRound` (types.ts)
  - `getRecentMatches(): Promise<RecentMatch[]>` (matchService.ts) — `@/online`'dan export

- [ ] **Step 1: Testi yaz (kırmızı)**

`src/online/matchService.test.ts` — import satırına `getRecentMatches` ekle, dosya sonuna:

```ts
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
```

- [ ] **Step 2: Testi koştur, başarısız olduğunu gör**

Run: `npx jest src/online/matchService.test.ts -t getRecentMatches`
Expected: FAIL — `getRecentMatches is not a function` / import hatası.

- [ ] **Step 3: Tipleri ekle**

`src/online/types.ts` sonuna:

```ts
/** Global "Son Maçlar" akışı — tek maç özeti (get_recent_matches RPC). */
export type RecentMatchRound = {
  round: number;
  /** Oyuncu1'in o turdaki gizlisi (sayı ya da kelime); yoksa null. */
  p1Secret: string | null;
  p2Secret: string | null;
  /** Turu kazanan taraf. */
  winner: 1 | 2;
};

export type RecentMatch = {
  matchId: string;
  mode: 'quick' | 'protocol';
  contentType: 'number' | 'word';
  winTarget: number;
  player1Name: string | null;
  player2Name: string | null;
  /** Kazanan oyuncu1 mi (renk/kupa yönü için). */
  p1Won: boolean;
  result: 'win' | 'timeout' | 'forfeit' | null;
  p1RoundWins: number;
  p2RoundWins: number;
  /** Maçta kazanılan/kaybedilen kupa (rating). Kazananda +, kaybedende −. */
  p1RatingDelta: number | null;
  p2RatingDelta: number | null;
  rounds: RecentMatchRound[];
};
```

- [ ] **Step 4: Servis fonksiyonunu ekle**

`src/online/matchService.ts` — importlara `RecentMatch` ekle (types import bloğu), dosya sonuna:

```ts
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
      winner: rd.winner === 1 ? 1 : 2,
    })),
  }));
}
```

`src/online/index.ts` — matchService export bloğuna `getRecentMatches` ve types bloğuna `RecentMatch`, `RecentMatchRound` ekle.

- [ ] **Step 5: Testi koştur, geçtiğini gör**

Run: `npx jest src/online/matchService.test.ts -t getRecentMatches`
Expected: PASS (2 test).

- [ ] **Step 6: Commit**

```bash
git add src/online/types.ts src/online/matchService.ts src/online/index.ts src/online/matchService.test.ts
git commit -m "feat(online): getRecentMatches servis + RecentMatch tipleri + test"
```

---

### Task 3: RecentMatchesModal bileşeni

**Files:**
- Create: `src/online/ui/recent-matches-modal.tsx`
- Modify: `src/online/ui/index.ts` (barrel export)

**Interfaces:**
- Consumes: `getRecentMatches`, `RecentMatch`, `RecentMatchRound`, `OnlineError` (`@/online`); `colors`, `mono`, `withAlpha`, `cyanAlpha` (`@/ui/theme`).
- Produces: `RecentMatchesModal({ visible, onClose }: { visible: boolean; onClose: () => void })` — `@/online/ui`'dan export.

Referans: görsel `scratchpad/son-maclar-mockup.html` (kart anatomisi + renkler), yapı deseni `src/online/ui/leaderboard-modal.tsx` (Modal + kart + head + loading/error + FlatList refresh).

- [ ] **Step 1: Bileşeni yaz**

`src/online/ui/recent-matches-modal.tsx`:

```tsx
import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getRecentMatches, OnlineError, type RecentMatch, type RecentMatchRound } from '@/online';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';

const MODE_META: Record<string, { label: string; color: string }> = {
  hizli: { label: 'Hızlı', color: colors.cyan },
  kelime: { label: 'Kelime', color: colors.amber },
  protokol: { label: 'Protokol', color: colors.violet },
};

function modeKey(m: RecentMatch): keyof typeof MODE_META {
  if (m.contentType === 'word') return 'kelime';
  if (m.mode === 'protocol') return 'protokol';
  return 'hizli';
}

function reasonLabel(result: RecentMatch['result']): string {
  if (result === 'win') return 'doğru tahmin';
  if (result === 'timeout') return 'süre doldu';
  if (result === 'forfeit') return 'terk';
  return '';
}

/** Bir gizliyi (sayı ya da kelime) tile dizisine böler. */
function Tiles({ value, win }: { value: string | null; win: boolean }) {
  const chars = (value ?? '').toUpperCase().split('');
  return (
    <View style={styles.tiles}>
      {chars.map((c, i) => (
        <View key={i} style={[styles.tile, win && styles.tileWin]}>
          <Text style={[styles.tileText, win && styles.tileTextWin]}>{c}</Text>
        </View>
      ))}
    </View>
  );
}

function RoundRow({ r }: { r: RecentMatchRound }) {
  const p1Win = r.winner === 1;
  const p2Win = r.winner === 2;
  return (
    <View style={styles.round}>
      <View style={[styles.secret, styles.s1]}>
        {p1Win ? <Text style={styles.rt}>🏆</Text> : null}
        <Tiles value={r.p1Secret} win={p1Win} />
      </View>
      <Text style={styles.turn}>Tur {r.round}</Text>
      <View style={[styles.secret, styles.s2]}>
        <Tiles value={r.p2Secret} win={p2Win} />
        {p2Win ? <Text style={styles.rt}>🏆</Text> : null}
      </View>
    </View>
  );
}

function Delta({ value }: { value: number | null }) {
  if (value == null) return null;
  const up = value >= 0;
  return (
    <Text style={[styles.delta, up ? styles.deltaUp : styles.deltaDown]}>
      {up ? '+' : '−'}
      {Math.abs(value)} 🏆
    </Text>
  );
}

function MatchCard({ m }: { m: RecentMatch }) {
  const meta = MODE_META[modeKey(m)];
  const p1Won = m.p1Won;
  return (
    <View style={styles.match}>
      <View style={styles.matchHead}>
        <View style={[styles.player, styles.pRight]}>
          <Text style={[styles.name, p1Won ? styles.nameWin : styles.nameLose]} numberOfLines={1}>
            {m.player1Name ?? 'Rakip'}
          </Text>
          <Delta value={m.p1RatingDelta} />
        </View>
        <View style={styles.center}>
          <Text style={[styles.mode, { color: meta.color, backgroundColor: withAlpha(meta.color, 0.13) }]}>
            {meta.label}
          </Text>
          {m.winTarget > 1 ? (
            <Text style={styles.tally}>
              {m.p1RoundWins}–{m.p2RoundWins}
            </Text>
          ) : null}
          <Text style={styles.reason}>{reasonLabel(m.result)}</Text>
        </View>
        <View style={[styles.player, styles.pLeft]}>
          <Text style={[styles.name, !p1Won ? styles.nameWin : styles.nameLose]} numberOfLines={1}>
            {m.player2Name ?? 'Rakip'}
          </Text>
          <Delta value={m.p2RatingDelta} />
        </View>
      </View>
      <View style={styles.reveal}>
        {m.rounds.map((r) => (
          <RoundRow key={r.round} r={r} />
        ))}
      </View>
    </View>
  );
}

export function RecentMatchesModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [matches, setMatches] = useState<RecentMatch[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const pop = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    setError(null);
    try {
      setMatches(await getRecentMatches());
    } catch (e) {
      setError(e instanceof OnlineError ? e.message : 'Son maçlar yüklenemedi.');
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    pop.setValue(0);
    Animated.timing(pop, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [visible, load, pop]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const cardStyle = {
    opacity: pop,
    transform: [
      { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
      { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
    ],
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 14 }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View style={[styles.card, cardStyle]}>
          <View style={styles.head}>
            <View style={styles.headIcon}>
              <Feather name="activity" size={17} color={colors.cyan} />
            </View>
            <Text style={styles.title}>SON MAÇLAR</Text>
            <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
              <Feather name="x" size={16} color={colors.dim} />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator color={colors.cyan} />
              <Text style={styles.muted}>Yükleniyor…</Text>
            </View>
          ) : error ? (
            <View style={styles.centerBox}>
              <Feather name="alert-circle" size={22} color={colors.danger} />
              <Text style={styles.errorText} selectable>
                {error}
              </Text>
              <Pressable
                onPress={() => {
                  setLoading(true);
                  load().finally(() => setLoading(false));
                }}
                style={styles.retry}>
                <Text style={styles.retryText}>Tekrar Dene</Text>
              </Pressable>
            </View>
          ) : (matches?.length ?? 0) === 0 ? (
            <View style={styles.centerBox}>
              <Text style={styles.muted}>Henüz maç oynanmadı.</Text>
            </View>
          ) : (
            <FlatList
              style={styles.list}
              data={matches ?? []}
              keyExtractor={(m) => m.matchId}
              renderItem={({ item }) => <MatchCard m={item} />}
              contentContainerStyle={styles.listBody}
              showsVerticalScrollIndicator={false}
              refreshing={refreshing}
              onRefresh={onRefresh}
            />
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(3,7,18,0.72)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  card: {
    width: '100%', maxWidth: 440, flex: 1, backgroundColor: colors.bgMid,
    borderRadius: 20, borderWidth: 1, borderColor: colors.glassBorder, overflow: 'hidden',
  },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.glassBorder,
  },
  headIcon: {
    width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
    backgroundColor: cyanAlpha(0.13), borderWidth: 1, borderColor: cyanAlpha(0.4),
  },
  title: { flex: 1, color: colors.ice, fontSize: 14, fontWeight: '800', letterSpacing: 2.5, fontFamily: mono },
  close: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  muted: { color: colors.dim, fontSize: 13, fontFamily: mono },
  errorText: { color: colors.danger, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  retry: {
    marginTop: 6, paddingVertical: 8, paddingHorizontal: 18, borderRadius: 12,
    borderWidth: 1, borderColor: cyanAlpha(0.4), backgroundColor: cyanAlpha(0.12),
  },
  retryText: { color: colors.cyan, fontSize: 13, fontWeight: '700', fontFamily: mono },
  list: { flex: 1 },
  listBody: { padding: 12, gap: 12 },

  match: { backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder, borderRadius: 16, padding: 13, paddingBottom: 6 },
  matchHead: { flexDirection: 'row', alignItems: 'center', paddingBottom: 11 },
  player: { flex: 1, gap: 3, minWidth: 0 },
  pRight: { alignItems: 'flex-end' },
  pLeft: { alignItems: 'flex-start' },
  name: { fontSize: 14, fontWeight: '700', maxWidth: '100%' },
  nameWin: { color: colors.ice, textShadowColor: cyanAlpha(0.4), textShadowRadius: 12 },
  nameLose: { color: colors.dim },
  delta: { fontSize: 11, fontWeight: '800', fontFamily: mono, letterSpacing: 0.3 },
  deltaUp: { color: colors.success },
  deltaDown: { color: colors.danger },
  center: { alignItems: 'center', gap: 3, paddingHorizontal: 8 },
  mode: {
    fontSize: 9.5, fontWeight: '800', letterSpacing: 1.2, fontFamily: mono,
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, overflow: 'hidden', textTransform: 'uppercase',
  },
  tally: { fontSize: 17, fontWeight: '800', color: colors.text, fontFamily: mono, letterSpacing: 1 },
  reason: { fontSize: 9.5, color: colors.dim, letterSpacing: 0.4 },

  reveal: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)', borderStyle: 'dashed' },
  round: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  secret: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  s1: { justifyContent: 'flex-end' },
  s2: { justifyContent: 'flex-start' },
  rt: { fontSize: 12 },
  turn: {
    fontSize: 9, color: colors.dim, fontFamily: mono, letterSpacing: 1, textTransform: 'uppercase',
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  tiles: { flexDirection: 'row', gap: 4 },
  tile: {
    minWidth: 20, height: 24, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center',
    borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', backgroundColor: 'rgba(255,255,255,0.03)',
  },
  tileWin: { borderColor: withAlpha(colors.gold, 0.55), backgroundColor: withAlpha(colors.gold, 0.10) },
  tileText: { fontSize: 13, fontWeight: '800', color: colors.dim, fontFamily: mono },
  tileTextWin: { color: colors.ice },
});
```

- [ ] **Step 2: Barrel export ekle**

`src/online/ui/index.ts` sonuna:
```ts
export { RecentMatchesModal } from './recent-matches-modal';
```

- [ ] **Step 3: Tip kontrolü**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add src/online/ui/recent-matches-modal.tsx src/online/ui/index.ts
git commit -m "feat(online): RecentMatchesModal — son maçlar akışı bileşeni"
```

---

### Task 4: Ana menü entegrasyonu (buton + modal)

**Files:**
- Modify: `app/index.tsx` (import, state, sideIcons butonu, modal mount)

**Interfaces:**
- Consumes: `RecentMatchesModal` (`@/online/ui`).

- [ ] **Step 1: Import + state + buton + mount ekle**

`app/index.tsx`:
1. Import satırına `RecentMatchesModal` ekle (mevcut `@/online/ui` importuna).
2. Diğer modal state'lerinin yanına: `const [recentOpen, setRecentOpen] = useState(false);`
3. `sideIcons` kolonundaki mağaza/protokol/sinyal butonlarının yanına yeni Pressable:
```tsx
<Pressable
  onPress={() => setRecentOpen(true)}
  hitSlop={8}
  accessibilityLabel="Son Maçlar"
  style={styles.sideIconBtn}>
  <Feather name="activity" size={20} color={colors.cyan} />
</Pressable>
```
(Not: `styles.sideIconBtn` yerine komşu butonların kullandığı stil adını kullan — dosyadaki mevcut ada uy.)
4. `<LeaderboardModal ... />` mount'unun yanına:
```tsx
<RecentMatchesModal visible={recentOpen} onClose={() => setRecentOpen(false)} />
```

- [ ] **Step 2: Tip + lint + test**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: hepsi EXIT 0; 122 test (mevcut 120 + getRecentMatches 2).

- [ ] **Step 3: Commit**

```bash
git add app/index.tsx
git commit -m "feat(menu): ana menüye Son Maçlar butonu + modal"
```

---

## Uygulama & Doğrulama (kullanıcı adımları)

Migration **Supabase panelinden** uygulanmalı (proje CLI-migration kullanmıyor):

1. Supabase → SQL Editor → `20260711000000_match_history.sql` içeriğini çalıştır (idempotent).
2. Bir eşleşmeli maç oyna+bitir → `select * from match_history;` tek satır; `rounds` doğru turlar/kazananlar; kazananda +delta, kaybedende −delta.
3. `select get_recent_matches();` → maç görünür.
4. 31. maçtan sonra en eski satırın silindiğini doğrula (rolling-30).
5. Uygulamada ana menü → Son Maçlar butonu → modal açılır, akış görünür (Hızlı/Kelime/Protokol çipleri, tur ifşaları, kupa deltaları).

**Sonra Android OTA** (kullanıcı isteği): `main`'den `eas update --branch preview --platform android` (migration uygulanmadan yayınlanırsa modal "yüklenemedi" gösterir — önce migration).

## Self-Review notları
- Spec kapsamı: global feed (RPC son 30) ✓, kart anatomisi (Task 3) ✓, kupa deltası ✓, tur ifşası + kazanan ✓, ana menü modal (Task 4) ✓, rolling-30 (Task 1) ✓, private hariç (`mode in quick/protocol`) ✓, snapshot muafiyeti (FK yok) ✓.
- Tip tutarlılığı: `RecentMatch`/`RecentMatchRound` Task 2'de tanımlı, Task 3'te tüketiliyor; alan adları birebir.
- Açık nokta çözüldü: tur kazananı `round_results` (trigger) + fallback `m.winner`.
