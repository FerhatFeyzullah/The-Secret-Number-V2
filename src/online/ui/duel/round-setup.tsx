import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { parseGuess } from '@/game';
import { OnlineError, setSecret, type MatchState } from '@/online';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';

import { CountdownRing } from '../setup/countdown-ring';
import { VaultDials } from '../setup/vault-dials';

const SETUP_MS = 30_000;
const errMsg = (e: unknown) =>
  e instanceof OnlineError ? e.message : 'Bağlantı hatası, lütfen tekrar dene.';

/** Turlar arası (Best of 3, round ≥ 2) belirleme: kısa skor arası + yeni gizli
 *  sayı. setup_deadline = ~8 sn ara + 30 sn; "ara" boyunca skor gösterilir, sonra
 *  belirleme. Düello ekranı içinde, status='setup' iken render edilir. */
export function RoundSetup({
  matchId,
  match,
  lastRound,
  reveal,
}: {
  matchId: string;
  match: MatchState;
  /** Biten turun sonucu (kim + neden); yalnızca bilgi, gizli sayı içermez. */
  lastRound: { winnerIsMe: boolean; reason: 'win' | 'timeout' } | null;
  /** Biten turun iki gizli sayısı (break ekranında gösterilir); yoksa null. */
  reveal?: { mine: string | null; opponent: string | null } | null;
}) {
  const [dials, setDials] = useState<number[]>([1, 2, 3]);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(iv);
  }, []);

  // Yeni tura geçince giriş/kilit sıfırlanır.
  useEffect(() => {
    setLocked(false);
    setDials([1, 2, 3]);
    setError(null);
  }, [match.currentRound]);

  const p1 = match.myRole === 'player1';
  const myWins = p1 ? match.p1RoundWins : match.p2RoundWins;
  const oppWins = p1 ? match.p2RoundWins : match.p1RoundWins;
  const oppLocked = p1 ? match.player2Ready : match.player1Ready;

  const deadline = match.setupDeadline ? Date.parse(match.setupDeadline) : null;
  const remaining = deadline ? Math.max(0, deadline - now) : SETUP_MS;
  const inBreak = remaining > SETUP_MS; // ilk ~8 sn skor arası
  const settingRemaining = Math.min(SETUP_MS, remaining);
  const breakRemaining = Math.max(0, remaining - SETUP_MS);
  const distinct = new Set(dials).size === 3;
  const canLock = distinct && !locked && !busy;

  const setDial = useCallback(
    (i: number, v: number) => {
      if (locked) return;
      setDials((prev) => {
        const n = [...prev];
        n[i] = v;
        return n;
      });
      setError(null);
    },
    [locked],
  );

  const lock = useCallback(async () => {
    if (!canLock) return;
    const digits = dials.join('');
    if (!parseGuess(digits).ok) {
      setError('rakamlar farklı olmalı');
      return;
    }
    setBusy(true);
    try {
      await setSecret(matchId, digits);
      setLocked(true);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [canLock, dials, matchId]);

  // Skor rozeti (her iki görünümde de üstte).
  const score = (
    <View style={styles.score}>
      <Text style={styles.scoreLabel}>TUR {match.currentRound}</Text>
      <Text style={styles.scoreVal}>
        <Text style={{ color: colors.cyan }}>{myWins}</Text>
        <Text style={styles.scoreDash}> – </Text>
        <Text style={{ color: colors.amber }}>{oppWins}</Text>
      </Text>
    </View>
  );

  // Biten turun sonucu (oyuncunun perspektifinden); gizli sayı içermez.
  const resultText = !lastRound
    ? null
    : lastRound.reason === 'win'
      ? lastRound.winnerIsMe
        ? 'Rakibin sayısını buldun! 🎯'
        : 'Rakip senin sayını buldu'
      : lastRound.winnerIsMe
        ? 'Rakibin süresi doldu'
        : 'Süren doldu';

  if (inBreak) {
    return (
      <View style={styles.center}>
        {resultText ? (
          <Text style={[styles.resultText, lastRound?.winnerIsMe && styles.resultWin]}>
            {resultText}
          </Text>
        ) : null}
        {score}

        {/* Biten turun İKİ sayısı (result-overlay ifşa düzeni yansıtılır). */}
        <View style={styles.reveal}>
          <View style={styles.revealCol}>
            <Text style={styles.revealLabel}>SENİN SAYIN</Text>
            <Text numberOfLines={1} style={[styles.revealNum, { color: colors.cyan }]}>
              {reveal?.mine ? reveal.mine.split('').join(' ') : '—'}
            </Text>
          </View>
          <View style={styles.revealDivider} />
          <View style={styles.revealCol}>
            <Text style={styles.revealLabel}>RAKİBİN SAYISI</Text>
            <Text numberOfLines={1} style={[styles.revealNum, { color: colors.amber }]}>
              {reveal?.opponent ? reveal.opponent.split('').join(' ') : '—'}
            </Text>
          </View>
        </View>

        <Text style={styles.breakTitle}>
          {myWins > oppWins ? 'Öndesin' : myWins < oppWins ? 'Rakip önde' : 'Berabere'}
        </Text>
        <Text style={styles.breakNext}>Tur {match.currentRound} başlıyor…</Text>
        <Text style={styles.breakCount}>{Math.ceil(breakRemaining / 1000)}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.countdown}>
        <CountdownRing remainingMs={settingRemaining} totalMs={SETUP_MS} low={settingRemaining <= 5000} />
        {score}
      </View>

      <View style={styles.secrecy}>
        <Feather name="eye-off" size={13} color={colors.cyan} />
        <Text style={styles.secrecyText}>Yeni tur — yeni gizli kod belirle</Text>
      </View>

      <VaultDials values={dials} locked={locked} onChange={setDial} />
      <Text style={[styles.hint, !error && styles.hintHidden]}>{error ?? ' '}</Text>

      {locked ? (
        <View style={styles.lockedBanner}>
          <Feather name="check" size={16} color={colors.success} />
          <Text style={styles.lockedText}>KİLİTLENDİ</Text>
        </View>
      ) : (
        <Pressable onPress={lock} disabled={!canLock} style={[styles.lockBtn, !canLock && styles.lockBtnOff]}>
          {busy ? (
            <ActivityIndicator color={colors.ice} size="small" />
          ) : (
            <>
              <Feather name="lock" size={16} color={canLock ? colors.ice : colors.dim} />
              <Text style={[styles.lockText, !canLock && { color: colors.dim }]}>KİLİTLE</Text>
            </>
          )}
        </Pressable>
      )}

      <View style={styles.opp}>
        <View style={[styles.oppDot, { backgroundColor: oppLocked ? colors.success : colors.amber }]} />
        <Text style={[styles.oppText, { color: oppLocked ? colors.success : colors.amber }]}>
          {oppLocked ? '✓ Rakip hazır' : 'Rakip kodunu seçiyor…'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 8,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  score: {
    alignItems: 'center',
    gap: 4,
  },
  scoreLabel: {
    fontSize: 10,
    letterSpacing: 2,
    color: colors.dim,
    fontFamily: mono,
  },
  scoreVal: {
    fontSize: 26,
    fontWeight: '800',
    fontFamily: mono,
  },
  scoreDash: {
    color: colors.dim,
  },
  resultText: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.dim,
    fontFamily: mono,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  resultWin: {
    color: colors.success,
  },
  reveal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    alignSelf: 'stretch',
    marginHorizontal: 20,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  revealCol: {
    alignItems: 'center',
    flex: 1,
  },
  revealLabel: {
    fontSize: 8,
    color: colors.dim,
    fontFamily: mono,
    letterSpacing: 1,
    marginBottom: 6,
  },
  revealNum: {
    fontSize: 28,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 2,
    textShadowRadius: 14,
  },
  revealDivider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  breakTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.ice,
    fontFamily: mono,
  },
  breakNext: {
    fontSize: 12,
    color: colors.dim,
    fontFamily: mono,
  },
  breakCount: {
    fontSize: 40,
    fontWeight: '800',
    color: colors.cyan,
    fontFamily: mono,
    textShadowColor: cyanAlpha(0.6),
    textShadowRadius: 16,
  },
  countdown: {
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  secrecy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    marginBottom: 18,
  },
  secrecyText: {
    fontSize: 11,
    color: colors.dim,
  },
  hint: {
    height: 14,
    marginTop: 8,
    fontSize: 10,
    color: '#fca5a5',
    textAlign: 'center',
  },
  hintHidden: {
    opacity: 0,
  },
  lockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: cyanAlpha(0.55),
    backgroundColor: cyanAlpha(0.24),
    marginTop: 6,
  },
  lockBtnOff: {
    opacity: 0.45,
  },
  lockText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
    color: colors.ice,
    fontFamily: mono,
  },
  lockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: withAlpha(colors.success, 0.4),
    backgroundColor: withAlpha(colors.success, 0.14),
    marginTop: 6,
  },
  lockedText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
    color: colors.success,
    fontFamily: mono,
  },
  opp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
  },
  oppDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  oppText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
