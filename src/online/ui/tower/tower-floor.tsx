import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { parseWord, upperTr, type LetterMark } from '@/game';
import {
  claimTowerTimeout,
  OnlineError,
  startTowerFloor,
  towerGuess,
  type TowerActiveFloor,
  type TowerBoardGuess,
  type TowerGuessOutcome,
  type TowerState,
} from '@/online';
import { TrKeyboard } from '@/online/ui/word/tr-keyboard';
import { WordConfirmButton } from '@/online/ui/word/word-parts';
import { GlassButton, GlassCard } from '@/ui/glass';
import { colors, mono, withAlpha } from '@/ui/theme';
import { cursedLetter, TOWER_TWISTS, towerItemLabel } from './twists';

const LOW_SEC = 20;

function formatTime(sec: number) {
  const s = Math.max(0, sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type Overlay = { kind: 'cleared' | 'failed'; outcome: TowerGuessOutcome } | null;

/** Kule kat oynanışı: sunucunun gizli kelimesini tek geri sayıma karşı çöz.
 *  Tahtayı/klavyeyi düello motorundan yeniden kullanır; değerlendirme SUNUCUDA,
 *  marks twist'lerle bozulmuş gelir ('?' = gizli). Kat sonuçlanınca overlay. */
export function TowerFloor({
  initialState,
  onExit,
  onFinished,
}: {
  initialState: TowerState;
  onExit: () => void;
  onFinished: (o: TowerGuessOutcome) => void;
}) {
  const { width } = useWindowDimensions();
  const [active, setActive] = useState<TowerActiveFloor | null>(initialState.active);
  const [board, setBoard] = useState<TowerBoardGuess[]>(initialState.active?.guesses ?? []);
  const [entry, setEntry] = useState<string[]>([]);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(() =>
    Math.ceil((initialState.active?.remainingMs ?? 0) / 1000),
  );

  const deadlineRef = useRef<number>(Date.now() + (initialState.active?.remainingMs ?? 0));
  const timedOutRef = useRef(false);

  const wordLength = active?.wordLength ?? 4;
  const twists = useMemo(() => active?.twists ?? [], [active]);
  const cursed = useMemo(() => {
    const t = twists.find((x) => x.kind === 'cursed');
    return t ? cursedLetter(t.params) : null;
  }, [twists]);

  // Aktif kat değişince saati ve tahtayı senkronla.
  const syncClock = useCallback((remainingMs: number) => {
    deadlineRef.current = Date.now() + remainingMs;
    timedOutRef.current = false;
    setTimeLeft(Math.max(0, Math.ceil(remainingMs / 1000)));
  }, []);

  useEffect(() => {
    if (active) syncClock(active.remainingMs);
  }, [active, syncClock]);

  // Klavye harf renkleri: tahtadaki marks'tan (G>Y>X; '?' sayılmaz).
  const keyStates = useMemo(() => {
    const rank: Record<LetterMark, number> = { X: 0, Y: 1, G: 2 };
    const map: Record<string, LetterMark> = {};
    for (const row of board) {
      const letters = Array.from(row.guess);
      for (let i = 0; i < letters.length; i++) {
        const mk = row.marks[i];
        if (mk !== 'G' && mk !== 'Y' && mk !== 'X') continue;
        const ch = letters[i];
        const cur = map[ch];
        if (cur === undefined || rank[mk] > rank[cur]) map[ch] = mk;
      }
    }
    return map;
  }, [board]);

  const handleOutcome = useCallback(
    (o: TowerGuessOutcome, guessWord: string) => {
      if (o.status === 'playing') {
        setBoard((b) => [...b, { guess: guessWord, marks: o.marks ?? '', greenCount: o.greenCount }]);
        setEntry([]);
        if (o.remainingMs != null) syncClock(o.remainingMs);
      } else if (o.status === 'floor_cleared') {
        setBoard((b) => [...b, { guess: guessWord, marks: o.marks ?? '', greenCount: o.greenCount }]);
        setOverlay({ kind: 'cleared', outcome: o });
      } else if (o.status === 'floor_failed') {
        setOverlay({ kind: 'failed', outcome: o });
      } else {
        onFinished(o); // tower_cleared | eliminated
      }
    },
    [onFinished, syncClock],
  );

  const submit = useCallback(async () => {
    if (busy || overlay || entry.length !== wordLength) return;
    const parsed = parseWord(entry.join(''));
    if (!parsed.ok) return;
    setBusy(true);
    setInvalid(null);
    try {
      const o = await towerGuess(parsed.word);
      handleOutcome(o, parsed.word);
    } catch (e) {
      setInvalid(e instanceof OnlineError ? e.message : 'Gönderilemedi, tekrar dene.');
    } finally {
      setBusy(false);
    }
  }, [busy, overlay, entry, wordLength, handleOutcome]);

  const handleTimeout = useCallback(async () => {
    if (busy || overlay) return;
    setBusy(true);
    try {
      const o = await claimTowerTimeout();
      handleOutcome(o, '');
    } catch {
      // clock_not_expired vb. → sessiz; sonraki tik tekrar dener değil (timedOutRef set).
    } finally {
      setBusy(false);
    }
  }, [busy, overlay, handleOutcome]);

  // Geri sayım tik'i.
  useEffect(() => {
    if (overlay || !active) return;
    const id = setInterval(() => {
      const rem = deadlineRef.current - Date.now();
      setTimeLeft(Math.max(0, Math.ceil(rem / 1000)));
      if (rem <= 0 && !timedOutRef.current) {
        timedOutRef.current = true;
        void handleTimeout();
      }
    }, 250);
    return () => clearInterval(id);
  }, [overlay, active, handleTimeout]);

  const openFloor = useCallback(async () => {
    setBusy(true);
    setInvalid(null);
    try {
      const s = await startTowerFloor();
      setActive(s.active);
      setBoard(s.active?.guesses ?? []);
      setEntry([]);
      setOverlay(null);
    } catch (e) {
      setInvalid(e instanceof OnlineError ? e.message : 'Kat açılamadı.');
    } finally {
      setBusy(false);
    }
  }, []);

  // Aktif kat yoksa (guard) başlat.
  useEffect(() => {
    if (!active && !busy) void openFloor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addLetter = useCallback(
    (k: string) => {
      if (overlay || busy) return;
      setInvalid(null);
      setEntry((g) => (g.length >= wordLength ? g : [...g, k]));
    },
    [overlay, busy, wordLength],
  );
  const deleteLetter = useCallback(() => {
    setInvalid(null);
    setEntry((g) => (g.length === 0 ? g : g.slice(0, -1)));
  }, []);

  const low = timeLeft > 0 && timeLeft < LOW_SEC;
  const histTileW = Math.min(34, Math.floor((width - 80) / wordLength) - 4);
  const entryTileW = Math.min(44, Math.floor((width - 60 - (wordLength - 1) * 6) / wordLength));

  return (
    <View style={styles.content}>
      {/* Üst: çıkış + kat rozeti + saat */}
      <View style={styles.headerRow}>
        <Pressable onPress={onExit} hitSlop={10} style={styles.exit}>
          <Feather name="chevron-left" size={18} color={colors.text} />
        </Pressable>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>Kat {active?.floorNo ?? '—'} · {wordLength} harf</Text>
        </View>
        <View style={[styles.clock, low && styles.clockLow]}>
          <Feather name="clock" size={14} color={low ? colors.danger : colors.cyan} />
          <Text style={[styles.clockText, low && { color: colors.danger }]}>{formatTime(timeLeft)}</Text>
        </View>
      </View>

      {/* Aktif twist rozetleri */}
      {twists.length > 0 ? (
        <View style={styles.twistBar}>
          {twists.map((t, i) => {
            const meta = TOWER_TWISTS[t.kind];
            return (
              <View key={i} style={[styles.twistPill, { borderColor: withAlpha(meta?.color ?? colors.dim, 0.5) }]}>
                <Text style={styles.twistPillText}>
                  {meta?.emoji} {meta?.name}
                  {t.kind === 'cursed' && cursed ? ` (${upperTr(cursed)})` : ''}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {/* Orta: tahta */}
      <View style={styles.middle}>
        <ScrollView
          style={styles.board}
          contentContainerStyle={styles.boardBody}
          showsVerticalScrollIndicator={false}>
          {board.length === 0 ? (
            <Text style={styles.histEmpty}>İlk tahminini yap</Text>
          ) : (
            board.map((row, ri) => (
              <View key={ri} style={styles.histRow}>
                {Array.from(row.guess).map((ch, ci) => {
                  const mk = row.marks[ci];
                  return (
                    <View
                      key={ci}
                      style={[
                        styles.histTile,
                        { width: histTileW },
                        mk === 'G' && styles.tileGreen,
                        mk === 'Y' && styles.tileYellow,
                        mk === '?' && styles.tileMasked,
                      ]}>
                      <Text
                        style={[
                          styles.histTileText,
                          (mk === 'G' || mk === 'Y') && styles.histTileTextOn,
                          mk === '?' && styles.histTileTextMasked,
                        ]}>
                        {upperTr(ch)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ))
          )}
        </ScrollView>

        {/* Aktif tahmin */}
        <View style={styles.entryRow}>
          {Array.from({ length: wordLength }).map((_, i) => {
            const letter = entry[i];
            const filled = letter !== undefined;
            return (
              <View
                key={i}
                style={[
                  styles.entryTile,
                  { width: entryTileW, height: Math.round(entryTileW * (50 / 44)) },
                  filled && styles.entryTileFilled,
                ]}>
                {filled ? <Text style={styles.entryTileText}>{upperTr(letter)}</Text> : null}
              </View>
            );
          })}
        </View>
        {invalid ? <Text style={styles.invalid}>{invalid}</Text> : null}
      </View>

      {/* Klavye */}
      <View style={styles.kbWrap}>
        <WordConfirmButton
          label="Kelimeyi Onayla"
          enabled={entry.length === wordLength && !busy && !overlay}
          busy={busy}
          onPress={submit}
        />
        <TrKeyboard large onKey={addLetter} onDelete={deleteLetter} locked={!!overlay || busy} letterStates={keyStates} />
      </View>

      {/* Kat sonucu overlay */}
      {overlay ? <FloorOverlay overlay={overlay} onNext={openFloor} onExit={onExit} /> : null}
    </View>
  );
}

function FloorOverlay({ overlay, onNext, onExit }: { overlay: NonNullable<Overlay>; onNext: () => void; onExit: () => void }) {
  const o = overlay.outcome;
  const cleared = overlay.kind === 'cleared';
  return (
    <View style={styles.overlay}>
      <GlassCard style={styles.overlayCard}>
        {cleared ? (
          <>
            <Text style={styles.clearedTitle}>✓ KAT GEÇİLDİ</Text>
            {o.reward ? (
              <View style={styles.rewardBox}>
                <View style={styles.rewardRow}>
                  <Text style={styles.rewardVeriBig}>+{o.reward.veri} Veri</Text>
                  <Text style={styles.rewardKupa}>+{o.reward.kupa} 🏆</Text>
                </View>
                {o.reward.itemKind && o.reward.itemId ? (
                  <Text style={styles.rewardItemBig}>
                    🎁 {towerItemLabel(o.reward.itemKind, o.reward.itemId)}
                    {o.reward.converted ? ' (zaten sahip → Veri)' : ''}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <View style={styles.overlayBtns}>
              <GlassButton small label="Sonraki Kat" onPress={onNext} />
              <GlassButton small label="Merdiven" accent={colors.dim} onPress={onExit} />
            </View>
          </>
        ) : (
          <>
            <Text style={styles.failedTitle}>⏱ Kat Başarısız</Text>
            <Text style={styles.failedDetail}>Gizli kelime:</Text>
            <Text style={styles.revealed}>{upperTr(o.reveal?.secret ?? '')}</Text>
            <View style={styles.livesRow}>
              {[0, 1, 2].map((i) => (
                <Feather key={i} name="heart" size={18} color={i < o.lives ? colors.danger : withAlpha(colors.dim, 0.3)} />
              ))}
            </View>
            <View style={styles.overlayBtns}>
              <GlassButton small label="Tekrar Dene" onPress={onNext} />
              <GlassButton small label="Merdiven" accent={colors.dim} onPress={onExit} />
            </View>
          </>
        )}
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, gap: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  exit: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: colors.glass,
    borderWidth: 1, borderColor: colors.glassBorder, alignItems: 'center', justifyContent: 'center',
  },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 6, paddingHorizontal: 12,
    borderRadius: 10, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder,
  },
  badgeText: { color: colors.text, fontSize: 12, fontFamily: mono, fontWeight: '700', letterSpacing: 0.5 },
  clock: {
    marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 6,
    paddingHorizontal: 12, borderRadius: 10, backgroundColor: withAlpha(colors.cyan, 0.12),
    borderWidth: 1, borderColor: withAlpha(colors.cyan, 0.4),
  },
  clockLow: { backgroundColor: withAlpha(colors.danger, 0.12), borderColor: withAlpha(colors.danger, 0.55) },
  clockText: { color: colors.cyan, fontSize: 17, fontWeight: '700', fontFamily: mono, letterSpacing: 1 },
  twistBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  twistPill: {
    paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, borderWidth: 1,
    backgroundColor: withAlpha(colors.violet, 0.08),
  },
  twistPillText: { color: colors.text, fontSize: 11, fontWeight: '600' },
  middle: { flex: 1 },
  board: { flex: 1 },
  boardBody: { gap: 6, paddingBottom: 6 },
  histRow: { flexDirection: 'row', justifyContent: 'center', gap: 4 },
  histTile: {
    height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  tileGreen: { backgroundColor: 'rgba(34,197,94,0.9)', borderColor: 'rgba(34,197,94,1)' },
  tileYellow: { backgroundColor: 'rgba(234,179,8,0.92)', borderColor: 'rgba(234,179,8,1)' },
  tileMasked: {
    backgroundColor: withAlpha(colors.violet, 0.18),
    borderColor: withAlpha(colors.violet, 0.7),
    borderStyle: 'dashed',
  },
  histTileText: { color: '#A8C0D8', fontSize: 15, fontWeight: '600', fontFamily: mono },
  histTileTextOn: { color: '#0A1018', fontWeight: '800' },
  histTileTextMasked: { color: colors.violet },
  histEmpty: { color: '#4B6B8A', fontSize: 12, textAlign: 'center', paddingVertical: 10 },
  entryRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 14 },
  entryTile: {
    alignItems: 'center', justifyContent: 'center', borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.1)',
  },
  entryTileFilled: { backgroundColor: withAlpha(colors.cyan, 0.18), borderColor: withAlpha(colors.cyan, 0.8) },
  entryTileText: { color: '#E8F0FF', fontSize: 21, fontWeight: '700', fontFamily: mono },
  invalid: { color: colors.danger, fontSize: 12, textAlign: 'center', marginTop: 8 },
  kbWrap: {
    marginHorizontal: -20, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6,
    backgroundColor: 'rgba(6,12,26,0.7)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)', gap: 10,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,9,18,0.78)',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28,
  },
  overlayCard: { alignItems: 'center', gap: 12, width: '100%', maxWidth: 340 },
  clearedTitle: { fontSize: 22, fontWeight: '900', color: colors.success, letterSpacing: 1, fontFamily: mono },
  failedTitle: { fontSize: 22, fontWeight: '900', color: colors.danger, letterSpacing: 1, fontFamily: mono },
  rewardBox: { alignItems: 'center', gap: 4 },
  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rewardVeriBig: { color: colors.amber, fontSize: 20, fontWeight: '900', fontFamily: mono },
  rewardKupa: { color: colors.gold, fontSize: 18, fontWeight: '900', fontFamily: mono },
  rewardItemBig: { color: colors.gold, fontSize: 13, textAlign: 'center' },
  failedDetail: { color: colors.dim, fontSize: 13 },
  revealed: { color: colors.cyan, fontSize: 28, fontWeight: 'bold', fontFamily: mono, letterSpacing: 5 },
  livesRow: { flexDirection: 'row', gap: 5 },
  overlayBtns: { flexDirection: 'row', gap: 12, marginTop: 4 },
});
