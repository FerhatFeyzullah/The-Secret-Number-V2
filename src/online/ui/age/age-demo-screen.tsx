import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import type {
  AgeAttack,
  AgeDefenseStart,
  AgeKind,
  AgePlayer,
  AgeRankEntry,
  AgeState,
  AgeTerritory,
} from '@/online';
import { getSeen, markSeen } from '@/storage';
import { InfoModal, type InfoSection } from '@/ui/info-modal';
import { colors, mono, withAlpha } from '@/ui/theme';
import { AgeBackground } from './age-bg';
import { AGE, ageColors } from './age-colors';
import { AgeEliminated } from './age-eliminated';
import { AgeMap } from './age-map';
import { AgeQueue } from './age-queue';
import { AgeResult } from './age-result';
import { AttackPanel, DefensePanel, SetCodePanel } from './age-panels';

/* ══ Demo verisi (tamamen yerel — sunucu YOK) ═════════════════════════════════ */

const ME = 'me';
const RED = 'p2';
const GREEN = 'p3';

/** Kule şifresi + kale kelimeleri (harf sayısına göre). Intro'da kullanıcıya açık. */
const TOWER_SECRET = '123';
const WORDS: Record<number, string> = { 4: 'OKUL', 5: 'KEMAN', 6: 'KAPTAN' };
/** Savunmada botun 3 haneli sayısı (deneyerek çözülür; yanlışlar listelenir). */
const DEFENSE_SECRET = '456';

type Seed = {
  id: string;
  kind: AgeKind;
  slotIndex: number;
  castleId: string | null;
  level: number;
  owner: string | null;
  defended: boolean;
};

// 5 kale (seviye 4,4,5,5,6) × 3 kule = 20 bölge. Baştan karışık sahiplik → 4 renk
// birden görünür. c3 SAVUNMASIZ bot kale (anında fetih testi). "me" bazı düşman
// kalelerinin kulelerine sahip (kapı kuralını test için).
const SEED: Seed[] = [
  { id: 'c0', kind: 'castle', slotIndex: 0, castleId: null, level: 4, owner: ME, defended: true },
  { id: 'c1', kind: 'castle', slotIndex: 1, castleId: null, level: 4, owner: RED, defended: true },
  { id: 'c2', kind: 'castle', slotIndex: 2, castleId: null, level: 5, owner: GREEN, defended: true },
  { id: 'c3', kind: 'castle', slotIndex: 3, castleId: null, level: 5, owner: null, defended: false },
  { id: 'c4', kind: 'castle', slotIndex: 4, castleId: null, level: 6, owner: null, defended: true },
  // c0 kuleleri
  { id: 't101', kind: 'tower', slotIndex: 101, castleId: 'c0', level: 0, owner: ME, defended: true },
  { id: 't102', kind: 'tower', slotIndex: 102, castleId: 'c0', level: 0, owner: ME, defended: true },
  { id: 't103', kind: 'tower', slotIndex: 103, castleId: 'c0', level: 0, owner: null, defended: true },
  // c1 (kırmızı) kuleleri
  { id: 't111', kind: 'tower', slotIndex: 111, castleId: 'c1', level: 0, owner: RED, defended: true },
  { id: 't112', kind: 'tower', slotIndex: 112, castleId: 'c1', level: 0, owner: RED, defended: true },
  { id: 't113', kind: 'tower', slotIndex: 113, castleId: 'c1', level: 0, owner: ME, defended: true },
  // c2 (yeşil) kuleleri
  { id: 't121', kind: 'tower', slotIndex: 121, castleId: 'c2', level: 0, owner: GREEN, defended: true },
  { id: 't122', kind: 'tower', slotIndex: 122, castleId: 'c2', level: 0, owner: null, defended: true },
  { id: 't123', kind: 'tower', slotIndex: 123, castleId: 'c2', level: 0, owner: null, defended: true },
  // c3 (savunmasız bot kale) kuleleri
  { id: 't131', kind: 'tower', slotIndex: 131, castleId: 'c3', level: 0, owner: ME, defended: true },
  { id: 't132', kind: 'tower', slotIndex: 132, castleId: 'c3', level: 0, owner: null, defended: true },
  { id: 't133', kind: 'tower', slotIndex: 133, castleId: 'c3', level: 0, owner: GREEN, defended: true },
  // c4 (bot taht) kuleleri
  { id: 't141', kind: 'tower', slotIndex: 141, castleId: 'c4', level: 0, owner: ME, defended: true },
  { id: 't142', kind: 'tower', slotIndex: 142, castleId: 'c4', level: 0, owner: null, defended: true },
  { id: 't143', kind: 'tower', slotIndex: 143, castleId: 'c4', level: 0, owner: RED, defended: true },
];

const PLAYERS: AgePlayer[] = [
  { player: ME, slot: 0, username: 'Sen', eliminated: false, territories: 0 },
  { player: RED, slot: 1, username: 'Bora', eliminated: false, territories: 0 },
  { player: GREEN, slot: 2, username: 'Derya', eliminated: false, territories: 0 },
];

const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

/** Oyuncuların toprak sayısını tahtadan yeniden say. */
function recount(st: AgeState): AgeState {
  const players = st.players.map((p) => ({
    ...p,
    territories: st.territories.filter((t) => t.owner === p.player).length,
  }));
  return { ...st, players };
}

function freshState(): AgeState {
  const st: AgeState = {
    matchId: 'demo',
    phase: 'queue',
    prepEndsAt: null,
    warEndsAt: null,
    ranking: [],
    me: ME,
    players: PLAYERS.map((p) => ({ ...p })),
    territories: SEED.map((s) => ({ ...s, conquerCount: 0, codeDeadline: null })),
    myAttacks: [],
    incoming: [],
    attacksPublic: [
      { territoryId: 'c4', attacker: RED },
      { territoryId: 't103', attacker: GREEN },
    ],
  };
  return recount(st);
}

/** Sayı geri bildirimi (numFeedback ile uyumlu): win / hepsi-doğru-yer-yanlış / partial:N. */
function evalNumber(guess: string, secret: string): { win: boolean; feedback: string } {
  if (guess === secret) return { win: true, feedback: 'win' };
  const common = guess.split('').filter((d) => secret.includes(d)).length;
  if (common === 3) return { win: false, feedback: 'digits_correct_wrong_order' };
  return { win: false, feedback: `partial:${common}` };
}

/** Kelime işaretleri (G/Y/X) — tekrar eden harf işleme dahil (Wordle mantığı). */
function wordMarks(guess: string, secret: string): { win: boolean; marks: string } {
  const g = guess.toLocaleUpperCase('tr').split('');
  const s = secret.toLocaleUpperCase('tr').split('');
  const marks = new Array(g.length).fill('X');
  const used = new Array(s.length).fill(false);
  for (let i = 0; i < g.length; i++) {
    if (g[i] === s[i]) {
      marks[i] = 'G';
      used[i] = true;
    }
  }
  for (let i = 0; i < g.length; i++) {
    if (marks[i] === 'G') continue;
    for (let j = 0; j < s.length; j++) {
      if (!used[j] && g[i] === s[j]) {
        marks[i] = 'Y';
        used[j] = true;
        break;
      }
    }
  }
  return { win: marks.every((m) => m === 'G'), marks: marks.join('') };
}

const REWARD: Record<number, { k: number; v: number }> = {
  1: { k: 60, v: 60 },
  2: { k: 40, v: 20 },
  3: { k: 15, v: 0 },
};

/** Sonuç sıralaması: "me" istenen sırada, diğer ikisi kalan sıralara. */
function buildRanking(st: AgeState, myRank: number): AgeRankEntry[] {
  const others = st.players.filter((p) => p.player !== ME).map((p) => p.player);
  const remaining = [1, 2, 3].filter((r) => r !== myRank);
  const entries: AgeRankEntry[] = [
    { player: ME, rank: myRank, kupaDelta: REWARD[myRank].k, veriDelta: REWARD[myRank].v },
  ];
  others.forEach((pid, i) => {
    const r = remaining[i];
    entries.push({ player: pid, rank: r, kupaDelta: REWARD[r].k, veriDelta: REWARD[r].v });
  });
  return entries;
}

const INTRO: InfoSection[] = [
  {
    icon: 'monitor',
    title: 'DEMO MODU',
    body: 'Bu maç tamamen yerel — kimseyle eşleşmezsin, sunucuya gitmez. Amaç tek başına tüm ekranları/panelleri gezip eksikleri görmen. 200 Sefer Verisi ile başlarsın (üstte ◈); sabotaj ve şifre yenileme bundan düşer.',
    accent: colors.violet,
  },
  {
    icon: 'key',
    title: 'ŞİFRELER',
    body: 'Kule şifresi: 123 · Kale kelimeleri: 4 harf OKUL · 5 harf KEMAN · 6 harf KAPTAN · Savunmada botun sayısı 456. Yanlış deneyip geri bildirimi görebilirsin; denemelerin panelde listelenir.',
    accent: colors.amber,
  },
  {
    icon: 'sliders',
    title: 'ALT BAR',
    body: 'Alttaki DEMO barı: Hazırlık/Savaş geçişi · "Sana saldırı" (savunma paneli) · "Elen" (eleme ekranı) · 1./2./3. (sonuç ekranı) · Sıfırla.',
    accent: colors.teal,
  },
];

/* ══ Ekran ════════════════════════════════════════════════════════════════════ */

type Sheet =
  | { t: 'attack'; territoryId: string; kind: AgeKind; level: number; targetName: string; defended: boolean }
  | { t: 'defense'; attackId: string; territoryId: string; start: AgeDefenseStart; solvedCount: number; premiumUsed: number }
  | { t: 'setcode'; territoryId: string; kind: AgeKind; level: number; deadline: string | null }
  | { t: 'refresh'; territoryId: string; kind: AgeKind; level: number }
  | null;

/** Gizem Çağı DEMO — istemci-tarafı sahte 3 oyunculu maç (yalnız UI testi için). */
export function AgeDemoScreen() {
  const router = useRouter();
  const [st, setSt] = useState<AgeState>(freshState);
  const [joined, setJoined] = useState(1);
  const [resetKey, setResetKey] = useState(0);
  // Bar'dan "Eşleşme"ye basınca kuyrukta beklet (otomatik hazırlığa geçme).
  const [queueHold, setQueueHold] = useState(false);
  // 3/3 dolunca "savaş ortamı hazırlanıyor" arası (eşleşme ekranında ~5 sn).
  const [prepShownAt, setPrepShownAt] = useState<number | null>(null);
  // Maç‑içi kese (herkes eşit başlar; sabotaj/yenileme bundan düşer). Demo değeri.
  const [veri, setVeri] = useState(200);
  const [sheet, setSheet] = useState<Sheet>(null);
  // Savunmada botun sayısını çözme denemeleri (sunucu tutmaz; feedback'ten biriktir).
  const [defenseGuesses, setDefenseGuesses] = useState<{ guess: string; feedback: string }[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [showIntro, setShowIntro] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // İlk girişte tanıtım (şifreler + bar). "?" ile tekrar açılır.
  useEffect(() => {
    void (async () => {
      if (!(await getSeen('ageDemoIntro'))) setShowIntro(true);
    })();
  }, []);

  // Kuyruk animasyonu: 1 → 2 → 3. Tanıtım modalı açıkken bekler (arkada akıp
  // haritaya atlamasın). queueHold ise 3/3'te kalır (bar'dan inceleme için).
  useEffect(() => {
    if (showIntro || st.phase !== 'queue') return;
    setJoined(1);
    const t1 = setTimeout(() => setJoined(2), 850);
    const t2 = setTimeout(() => setJoined(3), 1750);
    const t3 = queueHold
      ? null
      : setTimeout(() => {
          setSt((s) => (s.phase === 'queue' ? { ...s, phase: 'prep', prepEndsAt: iso(300_000) } : s));
          setPrepShownAt(Date.now()); // 3/3 → "savaş ortamı hazırlanıyor" arası
        }, 2600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      if (t3) clearTimeout(t3);
    };
  }, [resetKey, showIntro, queueHold, st.phase]);

  // "Hazırlanıyor" arasını ~5 sn sonra kapat (haritayı aç).
  useEffect(() => {
    if (prepShownAt == null) return;
    const t = setTimeout(() => setPrepShownAt(null), 5000);
    return () => clearTimeout(t);
  }, [prepShownAt]);
  const preparing = prepShownAt != null;

  const me = st.me;
  const myColor = ageColors(st.players)[ME] ?? AGE.you;
  const meElim = !!st.players.find((p) => p.player === me)?.eliminated;
  const byId = Object.fromEntries(st.territories.map((t) => [t.id, t])) as Record<string, AgeTerritory>;
  // Sahip adı; nötr bölge için boş (UI'da "Bot" göstermeyiz).
  const nameOf = (pid: string | null) =>
    (pid && st.players.find((p) => p.player === pid)?.username) || '';

  useEffect(() => {
    if (meElim) setSheet(null);
  }, [meElim]);

  const backToMenu = () => router.back();
  const requeue = () => {
    setSt(freshState());
    setSheet(null);
    setQueueHold(false);
    setPrepShownAt(null);
    setVeri(200);
    setResetKey((k) => k + 1);
  };
  // Bar → kuyruk/eşleşme ekranını göster (fill baştan; 3/3'te bekler).
  const goQueue = () => {
    setSheet(null);
    setQueueHold(true);
    setPrepShownAt(null);
    setSt((s) => ({ ...s, phase: 'queue', incoming: [] }));
  };

  /* ── Tahta mutasyonları ── */
  const patchTerritory = (tid: string, patch: Partial<AgeTerritory>) =>
    setSt((s) => recount({ ...s, territories: s.territories.map((t) => (t.id === tid ? { ...t, ...patch } : t)) }));

  const ownsCastleTower = (castleId: string) =>
    st.territories.some((t) => t.castleId === castleId && t.owner === me);

  const ensureAttack = (t: AgeTerritory) => {
    const total = t.kind === 'tower' ? 90_000 : 120_000;
    setSt((s) => {
      if (s.myAttacks.some((a) => a.territoryId === t.id)) return s;
      const atk: AgeAttack = {
        territoryId: t.id,
        kind: t.kind,
        status: 'active',
        deadline: iso(total),
        fogRemaining: 0,
        thiefRemaining: 0,
        guesses: [],
      };
      return { ...s, myAttacks: [...s.myAttacks, atk] };
    });
  };

  const pushGuess = (tid: string, guess: string, feedback: string, marks: string | null) =>
    setSt((s) => ({
      ...s,
      myAttacks: s.myAttacks.map((a) =>
        a.territoryId === tid ? { ...a, guesses: [...a.guesses, { guess, feedback, marks }] } : a,
      ),
    }));

  const conquer = (tid: string) => {
    const t = byId[tid];
    const isCastle = t?.kind === 'castle';
    setSt((s) =>
      recount({
        ...s,
        territories: s.territories.map((x) =>
          x.id === tid
            ? { ...x, owner: me, defended: !isCastle, codeDeadline: iso(30_000), conquerCount: x.conquerCount + 1 }
            : x,
        ),
        myAttacks: s.myAttacks.filter((a) => a.territoryId !== tid),
        attacksPublic: s.attacksPublic.filter((a) => a.territoryId !== tid),
      }),
    );
  };

  /* ── Saldırı ── */
  const onTapNode = (t: AgeTerritory) => {
    if (t.owner === me) {
      if (t.codeDeadline && Date.parse(t.codeDeadline) > Date.now()) {
        setSheet({ t: 'setcode', territoryId: t.id, kind: t.kind, level: t.level, deadline: t.codeDeadline });
        return;
      }
      if (st.phase !== 'war') {
        showToast('Kendi toprağın. Şifre yenileme yalnız savaşta.');
        return;
      }
      if (t.kind === 'castle') setSheet({ t: 'refresh', territoryId: t.id, kind: 'castle', level: t.level });
      else if (veri < 40) showToast('Yetersiz Sefer Verisi (kule yenileme ◈40).');
      else {
        setVeri((v) => v - 40);
        showToast('Kule şifresi yenilendi · −◈40');
      }
      return;
    }
    if (st.phase === 'queue') return;
    if (st.phase === 'prep' && t.owner !== null) {
      showToast('Burası çoktan alınmış.');
      return;
    }
    if (t.kind === 'castle' && !ownsCastleTower(t.id)) {
      showToast('Bu kaleye ait bir nöbet kulen olmalı.');
      return;
    }
    if (!(t.kind === 'castle' && !t.defended)) ensureAttack(t);
    setSheet({ t: 'attack', territoryId: t.id, kind: t.kind, level: t.level, targetName: nameOf(t.owner), defended: t.defended });
  };

  const onAttackGuess = (value: string) => {
    if (sheet?.t !== 'attack') return;
    const tid = sheet.territoryId;
    const t = byId[tid];
    if (!t) return;
    // Savunmasız kale → doğrudan ele geçir.
    if (t.kind === 'castle' && !t.defended) {
      conquer(tid);
      setSheet({ t: 'setcode', territoryId: tid, kind: 'castle', level: t.level, deadline: iso(30_000) });
      showToast('Fethedildi!');
      return;
    }
    if (t.kind === 'tower') {
      const r = evalNumber(value, TOWER_SECRET);
      if (r.win) {
        conquer(tid);
        setSheet({ t: 'setcode', territoryId: tid, kind: 'tower', level: 3, deadline: iso(30_000) });
        showToast('Fethedildi!');
      } else {
        pushGuess(tid, value, r.feedback, null);
      }
    } else {
      const r = wordMarks(value, WORDS[t.level] ?? 'OKUL');
      if (r.win) {
        conquer(tid);
        setSheet({ t: 'setcode', territoryId: tid, kind: 'castle', level: t.level, deadline: iso(30_000) });
        showToast('Fethedildi!');
      } else {
        pushGuess(tid, value, r.win ? 'win' : 'continue', r.marks);
      }
    }
  };

  const closeAttack = () => {
    if (sheet?.t === 'attack') {
      const tid = sheet.territoryId;
      setSt((s) => ({ ...s, myAttacks: s.myAttacks.filter((a) => a.territoryId !== tid) }));
    }
    setSheet(null);
  };

  /* ── Savunma ── */
  const onDefend = (attackId: string, territoryId: string) => {
    // Hak = 1 (ana kale, yalnız süre) + sahip olunan kule sayısı; premium = kule sayısı.
    const towers = st.territories.filter((t) => t.castleId === territoryId && t.owner === me).length;
    const start: AgeDefenseStart = { defenseId: 'def-demo', solvedCount: 0, slots: 1 + towers, deadline: null };
    setDefenseGuesses([]);
    setSheet({ t: 'defense', attackId, territoryId, start, solvedCount: 0, premiumUsed: 0 });
  };
  const onDefenseSolve = (value: string, sabotage: 'time' | 'fog' | 'thief') => {
    if (sheet?.t !== 'defense' || value.length < 3) return;
    const r = evalNumber(value, DEFENSE_SECRET);
    if (!r.win) {
      // Yanlış → geçmişe ekle (gerçek maçtaki gibi feedback'li), avantaj UYGULANMAZ.
      setDefenseGuesses((g) => [...g, { guess: value, feedback: r.feedback }]);
      showToast('Yanlış — tekrar dene.');
      return;
    }
    // Doğru → hak dolar, avantaj + ücret uygulanır, geçmiş sıfırlanır (yeni sayı).
    setDefenseGuesses([]);
    setSheet((s) => {
      if (s?.t !== 'defense') return s;
      return {
        ...s,
        solvedCount: Math.min(s.solvedCount + 1, s.start.slots),
        premiumUsed: s.premiumUsed + (sabotage === 'time' ? 0 : 1),
      };
    });
    if (sabotage === 'fog') setVeri((v) => v - 50);
    else if (sabotage === 'thief') setVeri((v) => v - 60);
    showToast(sabotage === 'time' ? 'Çözdün — saldırgan −15 sn!' : sabotage === 'fog' ? 'Sis uygulandı · −◈50' : 'Zaman Hırsızı · −◈60');
  };
  const onDefenseTimeout = () => {
    setDefenseGuesses([]);
    setSheet((s) => (s?.t === 'defense' ? { ...s, solvedCount: Math.min(s.solvedCount + 1, s.start.slots) } : s));
    showToast('Süre doldu — bu savunma hakkı yandı.');
  };

  /* ── Şifre ── */
  const onSetCode = (_value: string) => {
    if (sheet?.t !== 'setcode') return;
    const tid = sheet.territoryId;
    patchTerritory(tid, { defended: true, codeDeadline: null });
    setSheet(null);
    showToast('Şifre kuruldu.');
  };
  const closeSetCode = () => {
    if (sheet?.t === 'setcode') patchTerritory(sheet.territoryId, { codeDeadline: null });
    setSheet(null);
  };
  const onRefreshCastle = (_value: string) => {
    if (sheet?.t !== 'refresh') return;
    setVeri((v) => v - 60);
    setSheet(null);
    showToast('Kale kelimesi yenilendi · −◈60');
  };

  /* ── DEMO barı eylemleri ── */
  const goPrep = () => {
    setPrepShownAt(null); // bar'dan doğrudan geç (hazırlanıyor arası yok)
    setSt((s) => ({ ...s, phase: 'prep', prepEndsAt: iso(300_000), incoming: [] }));
  };
  const goWar = () => {
    setPrepShownAt(null);
    setSt((s) => ({ ...s, phase: 'war', warEndsAt: iso(600_000) }));
  };
  const attackMe = () => {
    setSt((s) => ({
      ...s,
      phase: 'war',
      warEndsAt: s.warEndsAt ?? iso(600_000),
      incoming: [{ attackId: 'atk-demo', territoryId: 'c0', attacker: RED, guessCount: 2, lastGreen: 1, lastYellow: 0 }],
      attacksPublic: s.attacksPublic.some((a) => a.territoryId === 'c0')
        ? s.attacksPublic
        : [...s.attacksPublic, { territoryId: 'c0', attacker: RED }],
    }));
    showToast('Kalene saldırı geldi — alarmdan savun.');
  };
  const eliminateMe = () =>
    setSt((s) => ({ ...s, phase: 'war', players: s.players.map((p) => (p.player === ME ? { ...p, eliminated: true } : p)) }));
  const showResult = (rank: number) =>
    setSt((s) => ({ ...s, phase: 'finished', ranking: buildRanking(s, rank) }));

  /* ── Render ── */
  const activeAttack = sheet?.t === 'attack' ? st.myAttacks.find((a) => a.territoryId === sheet.territoryId) : undefined;
  const incoming = sheet?.t === 'defense' ? st.incoming.find((i) => i.attackId === sheet.attackId) : undefined;

  return (
    <AgeBackground hex={st.phase === 'queue'}>
      <View style={styles.wrap}>
        {st.phase === 'finished' ? (
          <AgeResult state={st} onRequeue={requeue} onMenu={backToMenu} />
        ) : meElim ? (
          <AgeEliminated state={st} onMenu={backToMenu} />
        ) : st.phase === 'queue' || preparing ? (
          <AgeQueue players={st.players.slice(0, joined)} onCancel={backToMenu} preparing={preparing} />
        ) : (
          <AgeMap state={st} veri={veri} onTapNode={onTapNode} onDefend={onDefend} />
        )}
      </View>

      {/* DEMO barı */}
      <View style={styles.demoBar}>
        <Text style={styles.demoTag}>DEMO</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.demoRow}>
          <Chip label="Eşleşme" active={st.phase === 'queue'} onPress={goQueue} />
          <Chip label="Hazırlık" active={st.phase === 'prep'} onPress={goPrep} />
          <Chip label="Savaş" active={st.phase === 'war'} onPress={goWar} />
          <Sep />
          <Chip label="Sana saldırı" onPress={attackMe} />
          <Chip label="Elen" danger onPress={eliminateMe} />
          <Sep />
          <Chip label="1." onPress={() => showResult(1)} />
          <Chip label="2." onPress={() => showResult(2)} />
          <Chip label="3." onPress={() => showResult(3)} />
          <Sep />
          <Chip label="↻ Sıfırla" onPress={requeue} />
          <Chip label="?" onPress={() => setShowIntro(true)} />
        </ScrollView>
      </View>

      {sheet?.t === 'attack' ? (
        <AttackPanel
          kind={sheet.kind}
          level={sheet.level}
          targetName={sheet.targetName}
          defended={sheet.defended}
          attack={activeAttack}
          busy={false}
          onGuess={onAttackGuess}
          onClose={closeAttack}
        />
      ) : null}

      {sheet?.t === 'defense' && incoming ? (
        <DefensePanel
          incoming={incoming}
          start={sheet.start}
          solvedCount={sheet.solvedCount}
          premiumLeft={Math.max(0, sheet.start.slots - 1 - sheet.premiumUsed)}
          veri={veri}
          guesses={defenseGuesses}
          accent={myColor}
          busy={false}
          onSolve={onDefenseSolve}
          onTimeout={onDefenseTimeout}
          onClose={() => { setSheet(null); setDefenseGuesses([]); }}
        />
      ) : null}

      {sheet?.t === 'setcode' ? (
        <SetCodePanel
          kind={sheet.kind}
          level={sheet.level}
          deadline={sheet.deadline}
          mode="set"
          veri={veri}
          accent={myColor}
          busy={false}
          onSet={onSetCode}
          onRandom={closeSetCode}
          onClose={closeSetCode}
        />
      ) : null}

      {sheet?.t === 'refresh' ? (
        <SetCodePanel
          kind={sheet.kind}
          level={sheet.level}
          deadline={null}
          mode="refresh"
          veri={veri}
          accent={myColor}
          busy={false}
          onSet={onRefreshCastle}
          onRandom={() => setSheet(null)}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {toast ? (
        <View style={styles.toastWrap} pointerEvents="none">
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </View>
      ) : null}

      <InfoModal
        visible={showIntro}
        onClose={() => {
          setShowIntro(false);
          void markSeen('ageDemoIntro');
        }}
        title="GİZEM ÇAĞI · DEMO"
        icon="monitor"
        accent={colors.violet}
        sections={INTRO}
        ctaLabel="Başla"
      />
    </AgeBackground>
  );
}

function Chip({ label, onPress, active, danger }: { label: string; onPress: () => void; active?: boolean; danger?: boolean }) {
  const accent = danger ? colors.danger : colors.violet;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && { borderColor: accent, backgroundColor: withAlpha(accent, 0.18) }]}>
      <Text style={[styles.chipText, active && { color: colors.ice }, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}
function Sep() {
  return <View style={styles.sep} />;
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  demoBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 8,
    borderTopWidth: 1, borderColor: withAlpha(colors.violet, 0.25), backgroundColor: 'rgba(7,15,34,0.6)',
  },
  demoTag: { fontFamily: mono, fontSize: 9, fontWeight: '900', letterSpacing: 1.5, color: colors.violet },
  demoRow: { alignItems: 'center', gap: 6, paddingRight: 8 },
  chip: {
    paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1,
    borderColor: colors.glassBorder, backgroundColor: colors.glass,
  },
  chipText: { fontFamily: mono, fontSize: 11, fontWeight: '700', color: colors.dim },
  sep: { width: 1, height: 18, backgroundColor: withAlpha(colors.ice, 0.12) },
  toastWrap: { position: 'absolute', top: 54, left: 0, right: 0, alignItems: 'center', zIndex: 200 },
  toast: {
    paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1,
    borderColor: withAlpha(colors.amber, 0.4), backgroundColor: 'rgba(10,20,40,0.98)',
  },
  toastText: { fontFamily: mono, fontSize: 12, color: colors.amber },
});
