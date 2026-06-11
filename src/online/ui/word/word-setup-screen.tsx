import { Feather } from '@expo/vector-icons';
import { Redirect, useNavigation, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  cancelSetupTimeout,
  markReady,
  useMatch,
  useMatchSession,
} from '@/online';
import { Screen } from '@/ui/screen';
import { colors, cyanAlpha, mono } from '@/ui/theme';

import { WordOrbs } from './orbs';
import { WordSetupPanel } from './word-setup-panel';

/** Kelime belirleme ROUTE ekranı (tur 1): yaşam döngüsü SecretSetupScreen ile
 *  birebir aynı desen (present el sıkışması, sunucu deadline'ı, iptal izleme,
 *  active → düelloya geçiş); görünüm WordDuelSetup tasarımı (WordSetupPanel).
 *  Sonraki turların belirlemesi düello ekranı İÇİNDE (word-duel-screen). */
export function WordSecretSetupScreen({ matchId }: { matchId: string }) {
  const router = useRouter();
  const navigation = useNavigation();
  const session = useMatchSession();
  const { match, loading, error, refresh } = useMatch(matchId);

  const status = match?.status ?? null;
  const bothPresent = !!match && match.player1Present && match.player2Present;
  const deadline = match?.setupDeadline ? Date.parse(match.setupDeadline) : null;
  const presentDeadline = match?.presentDeadline ? Date.parse(match.presentDeadline) : null;
  const oppReady = match
    ? match.myRole === 'player1'
      ? match.player2Ready
      : match.player1Ready
    : false;
  const myReady = match
    ? match.myRole === 'player1'
      ? match.player1Ready
      : match.player2Ready
    : false;

  // HIZ: ikimiz de kilitlediysek active UPDATE'ini beklemeden tazele.
  useEffect(() => {
    if (status === 'setup' && myReady && oppReady) void refresh();
  }, [status, myReady, oppReady, refresh]);

  // EL SIKIŞMASI GARANTİSİ: present işaretini kesin gönder (idempotent).
  useEffect(() => {
    void markReady(matchId).catch(() => {});
  }, [matchId]);

  // Merkezi maç sahibine kaydol (çıkış temizliği provider'da).
  useEffect(() => {
    session.claim(matchId, 'match');
  }, [matchId, session]);

  // Zaman aşımı tetikleyici (karar sunucuda) — sayı setup'ıyla aynı desen.
  const timeoutFiredRef = useRef(false);
  useEffect(() => {
    if (status !== 'setup' || timeoutFiredRef.current) return;
    const iv = setInterval(() => {
      const now = Date.now();
      const shouldCancel =
        (bothPresent && deadline != null && now > deadline) ||
        (!bothPresent && presentDeadline != null && now > presentDeadline);
      if (shouldCancel && !timeoutFiredRef.current) {
        timeoutFiredRef.current = true;
        void cancelSetupTimeout(matchId).catch(() => {});
      }
    }, 500);
    return () => clearInterval(iv);
  }, [status, bothPresent, deadline, presentDeadline, matchId]);

  // active → düello ekranına geç (kelime düellosu).
  // ÖNEMLİ: one-shot bayrağı zamanlayıcının İÇİNDE kurulur — efekt pencere
  // içinde yeniden koşarsa navigasyon kaybolmaz (protokol seçim ekranındaki
  // takılmanın aynı sınıfı; bkz. protocol-select-screen).
  const leavingRef = useRef(false);
  const navedRef = useRef(false);
  useEffect(() => {
    if (status !== 'active' || navedRef.current) return;
    const t = setTimeout(() => {
      if (navedRef.current) return;
      navedRef.current = true;
      leavingRef.current = true;
      router.replace({ pathname: '/match/[id]', params: { id: matchId, content: 'word' } });
    }, 700);
    return () => clearTimeout(t);
  }, [status, matchId, router]);

  // İptal/terk → mesaj + lobiye dön.
  const endedRef = useRef(false);
  useEffect(() => {
    if (!match || navedRef.current || endedRef.current || leavingRef.current) return;
    if (status === 'cancelled' || status === 'finished' || status === 'abandoned') {
      endedRef.current = true;
      leavingRef.current = true;
      session.release();
      const now = Date.now();
      const pastAny =
        (deadline != null && now > deadline) || (presentDeadline != null && now > presentDeadline);
      const reason =
        status === 'cancelled' && !pastAny
          ? 'Rakip ayrıldı, maç iptal edildi.'
          : !bothPresent
            ? 'Rakip katılmadı, maç iptal edildi.'
            : 'Süre doldu, maç iptal edildi.';
      Alert.alert('Maç iptal', reason, [{ text: 'Tamam', onPress: () => router.back() }]);
    }
  }, [status, match, bothPresent, deadline, presentDeadline, router, session]);

  if (!match) {
    if (!loading && !error) return <Redirect href="/" />;
    return (
      <Screen float="letters">
        <View style={styles.centered}>
          {loading ? (
            <ActivityIndicator color={colors.cyan} />
          ) : (
            <>
              <Text style={styles.note}>{error ?? 'Maç bulunamadı.'}</Text>
              <Pressable onPress={() => router.replace('/')} hitSlop={8} style={styles.noteExit}>
                <Text style={styles.noteExitText}>Ana Menü</Text>
              </Pressable>
            </>
          )}
        </View>
      </Screen>
    );
  }

  return (
    <Screen float="letters">
      <WordOrbs />
      <View style={styles.content}>
        <View style={styles.topRow}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.exit}>
            <Feather name="chevron-left" size={20} color={colors.text} />
          </Pressable>
        </View>
        <WordSetupPanel matchId={matchId} match={match} active={bothPresent} />
        {status === 'active' ? <Text style={styles.startCue}>MAÇ BAŞLIYOR…</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingTop: 6,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  exit: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startCue: {
    textAlign: 'center',
    fontSize: 11,
    letterSpacing: 3,
    color: colors.cyan,
    fontFamily: mono,
    marginVertical: 10,
    textShadowColor: cyanAlpha(0.6),
    textShadowRadius: 10,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    color: colors.dim,
    fontSize: 14,
    fontFamily: mono,
    textAlign: 'center',
  },
  noteExit: {
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: cyanAlpha(0.4),
    backgroundColor: cyanAlpha(0.12),
  },
  noteExitText: {
    color: colors.cyan,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: mono,
    letterSpacing: 1,
  },
});
