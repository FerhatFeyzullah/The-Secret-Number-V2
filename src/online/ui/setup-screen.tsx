import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { parseGuess } from '@/game';
import {
  cancelSetupTimeout,
  leaveMatch,
  OnlineError,
  setSecret,
  useMatch,
} from '@/online';
import { useSfx, type SfxName } from '@/sfx';
import { getToggle } from '@/storage';
import { Screen } from '@/ui/screen';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';

import { CountdownRing } from './setup/countdown-ring';
import { VaultDials } from './setup/vault-dials';

const SETUP_TOTAL_MS = 30_000;
const LOW_MS = 5_000;
const canHaptics = Platform.OS === 'ios' || Platform.OS === 'android';
const errMsg = (e: unknown) =>
  e instanceof OnlineError ? e.message : 'Bağlantı hatası, lütfen tekrar dene.';

/** Gizli kod belirleme ekranı: kasa kadranı → setSecret.
 *  Sayaç ancak İKİ taraf da "Hazır" (present) olunca başlar (30 sn); o ana
 *  kadar "rakip hazır bekleniyor" + giriş pasif. present = Hazır'a bastı,
 *  ready = sayıyı kilitledi (ikisi de sızdırmayan boolean). Gizli sayı yalnızca
 *  setSecret ile sunucuya gider; asla rakibe sızmaz. */
export function SecretSetupScreen({ matchId }: { matchId: string }) {
  const router = useRouter();
  const navigation = useNavigation();
  const { match, loading, error } = useMatch(matchId);

  const [dials, setDials] = useState<number[]>([1, 2, 3]);
  const [locked, setLocked] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Ses/haptik tercihleri.
  const [soundOn, setSoundOn] = useState(true);
  const [hapticsOn, setHapticsOn] = useState(true);
  const playSfx = useSfx();
  useEffect(() => {
    getToggle('sound').then(setSoundOn);
    getToggle('haptics').then(setHapticsOn);
  }, []);
  const play = useCallback((n: SfxName) => soundOn && playSfx(n), [soundOn, playSfx]);
  const buzz = useCallback(
    (kind: 'tap' | 'lock') => {
      if (!hapticsOn || !canHaptics) return;
      if (kind === 'tap') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    [hapticsOn],
  );

  const status = match?.status ?? null;
  const distinct = new Set(dials).size === 3;
  // present = iki taraf da "Hazır"; sayaç ancak o an başlar.
  const bothPresent = !!match && match.player1Present && match.player2Present;
  const deadline = match?.setupDeadline ? Date.parse(match.setupDeadline) : null;
  const remainingMs = deadline ? Math.max(0, deadline - nowMs) : SETUP_TOTAL_MS;
  const pastDeadline = deadline ? nowMs > deadline : false;
  const low = remainingMs <= LOW_MS;
  // Idle: bir taraf present olduktan sonra rakip için tanınan kısa pencere.
  const presentDeadline = match?.presentDeadline ? Date.parse(match.presentDeadline) : null;
  const pastPresentDeadline = presentDeadline ? nowMs > presentDeadline : false;
  // oppReady = rakip gizli sayısını KİLİTLEDİ (present'ten farklı).
  const oppReady = match
    ? match.myRole === 'player1'
      ? match.player2Ready
      : match.player1Ready
    : false;

  // Görsel geri sayım tiki (yalnız setup fazında).
  useEffect(() => {
    if (status !== 'setup') return;
    const iv = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(iv);
  }, [status]);

  // İptal tetikleyici (karar sunucuda): iki geçerli neden —
  //  a) idle: bir taraf present, diğeri gelmedi (present_deadline geçti),
  //  b) belirleme: iki taraf present ama 30 sn'de iki sayı girilmedi (setup_deadline).
  const timeoutFiredRef = useRef(false);
  const shouldCancel =
    status === 'setup' &&
    ((bothPresent && pastDeadline) || (!bothPresent && pastPresentDeadline));
  useEffect(() => {
    if (!shouldCancel || timeoutFiredRef.current) return;
    timeoutFiredRef.current = true;
    void cancelSetupTimeout(matchId).catch(() => {});
  }, [shouldCancel, matchId]);

  // active → düello ekranına geç (kısa "Maç başlıyor…" anından sonra).
  const leavingRef = useRef(false);
  const navedRef = useRef(false);
  useEffect(() => {
    if (status !== 'active' || navedRef.current) return;
    navedRef.current = true;
    leavingRef.current = true;
    const t = setTimeout(
      () => router.replace({ pathname: '/match/[id]', params: { id: matchId } }),
      700,
    );
    return () => clearTimeout(t);
  }, [status, matchId, router]);

  // İptal/terk → mesaj + lobiye dön (kendi çıkışımız değilse).
  const endedRef = useRef(false);
  useEffect(() => {
    if (!match || navedRef.current || endedRef.current || leavingRef.current) return;
    if (status === 'cancelled' || status === 'finished' || status === 'abandoned') {
      endedRef.current = true;
      leavingRef.current = true;
      // Neden: iki taraf present değilse "rakip katılmadı"; aksi halde süre doldu.
      const reason = !bothPresent
        ? 'Rakip katılmadı, maç iptal edildi.'
        : 'Süre doldu, maç iptal edildi.';
      Alert.alert('Maç iptal', reason, [{ text: 'Tamam', onPress: () => router.back() }]);
    }
  }, [status, match, bothPresent, router]);

  // Çıkış onayı: belirleme fazında çıkış = maç iptal.
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (leavingRef.current || match?.status !== 'setup') return;
      e.preventDefault();
      Alert.alert('Maçtan çık', 'Çıkarsan maç iptal olur. Çıkmak istiyor musun?', [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Çık',
          style: 'destructive',
          onPress: () => {
            leavingRef.current = true;
            void leaveMatch(matchId).catch(() => {});
            navigation.dispatch(e.data.action);
          },
        },
      ]);
    });
    return sub;
  }, [navigation, match?.status, matchId]);

  const setDial = useCallback(
    (i: number, v: number) => {
      if (locked) return;
      setDials((prev) => {
        const n = [...prev];
        n[i] = v;
        return n;
      });
      setShowHint(false);
      buzz('tap');
    },
    [locked, buzz],
  );

  const lock = useCallback(async () => {
    if (locked || submitting || status !== 'setup') return;
    if (!distinct) {
      setShowHint(true);
      return;
    }
    const digits = dials.join('');
    if (!parseGuess(digits).ok) {
      setShowHint(true);
      return;
    }
    setSubmitting(true);
    setActionError(null);
    try {
      await setSecret(matchId, digits);
      setLocked(true);
      play('blip');
      buzz('lock');
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setSubmitting(false);
    }
  }, [locked, submitting, status, distinct, dials, matchId, play, buzz]);

  const exitButton = (
    <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.exit}>
      <Feather name="chevron-left" size={20} color={colors.text} />
    </Pressable>
  );

  if (!match) {
    return (
      <Screen>
        <View style={styles.centered}>
          {loading ? (
            <ActivityIndicator color={colors.cyan} />
          ) : (
            <Text style={styles.note}>{error ?? 'Maç bulunamadı.'}</Text>
          )}
        </View>
      </Screen>
    );
  }

  const starting = status === 'active';
  // KİLİTLE ancak iki taraf da present (sayaç başladı) ve rakamlar farklıyken aktif.
  const canLock = bothPresent && distinct && !locked && status === 'setup';

  return (
    <Screen>
      <View style={styles.content}>
        <View style={styles.topRow}>{exitButton}</View>

        {/* Geri sayım — yalnızca iki taraf da present olunca (sayaç o an başlar).
            Öncesinde sayaç GÖSTERİLMEZ; "rakip hazır bekleniyor". */}
        <View style={styles.countdown}>
          {bothPresent ? (
            <>
              <CountdownRing remainingMs={remainingMs} totalMs={SETUP_TOTAL_MS} low={low} />
              <Text style={styles.cdLabel}>GİZLİ KODUNU BELİRLE</Text>
            </>
          ) : (
            <View style={styles.waiting}>
              <ActivityIndicator color={colors.amber} />
              <Text style={styles.waitingText}>RAKİP HAZIR BEKLENİYOR</Text>
            </View>
          )}
        </View>

        {/* Gizlilik vurgusu */}
        <View style={styles.secrecy}>
          <View style={styles.secrecyIcon}>
            <Feather name="eye-off" size={14} color={colors.cyan} />
          </View>
          <Text style={styles.secrecyText}>Rakibin bu kodu asla görmeyecek</Text>
        </View>

        {/* Kasa kadranı — iki taraf present olana dek pasif. */}
        <VaultDials values={dials} locked={locked || !bothPresent} onChange={setDial} />
        <Text style={[styles.hint, !showHint && styles.hintHidden]}>rakamlar farklı olmalı</Text>
        <View style={styles.assembled}>
          <Text style={styles.assembledLabel}>KODUN</Text>
          <Text style={styles.assembledCode}>{dials.join('  ')}</Text>
        </View>

        {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

        {/* Kilitle / kilitlendi */}
        {locked ? (
          <View style={styles.lockedBanner}>
            <Feather name="check" size={16} color={colors.success} />
            <Text style={styles.lockedText}>KİLİTLENDİ</Text>
          </View>
        ) : (
          <Pressable
            onPress={lock}
            disabled={!canLock || submitting}
            style={({ pressed }) => [
              styles.lockBtn,
              (!canLock || submitting) && styles.lockBtnDisabled,
              pressed && canLock && styles.lockBtnPressed,
            ]}>
            <Feather name="lock" size={16} color={canLock ? colors.ice : colors.dim} />
            <Text style={[styles.lockText, !canLock && styles.lockTextDisabled]}>KİLİTLE</Text>
          </Pressable>
        )}

        <View style={styles.spacer} />

        {/* Maç başlıyor ipucu */}
        {starting ? <Text style={styles.startCue}>MAÇ BAŞLIYOR…</Text> : null}

        {/* Rakip durumu (kilitledi mi) — yalnızca iki taraf da present olunca. */}
        {bothPresent ? (
          <View style={[styles.opp, oppReady && styles.oppReady]}>
            <View style={[styles.oppDot, { backgroundColor: oppReady ? colors.success : colors.amber }]} />
            <Text style={[styles.oppText, { color: oppReady ? colors.success : colors.amber }]}>
              {oppReady ? '✓ Rakip hazır' : 'Rakip kodunu seçiyor…'}
            </Text>
          </View>
        ) : null}
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
  countdown: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 18,
    minHeight: 128, // halka yokken (bekleme) düzen zıplamasın
  },
  cdLabel: {
    fontSize: 11,
    letterSpacing: 2,
    color: colors.dim,
    fontFamily: mono,
  },
  waiting: {
    alignItems: 'center',
    gap: 12,
  },
  waitingText: {
    fontSize: 12,
    letterSpacing: 2,
    color: colors.amber,
    fontFamily: mono,
  },
  secrecy: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 20,
  },
  secrecyIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: cyanAlpha(0.18),
    borderWidth: 1,
    borderColor: cyanAlpha(0.4),
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0 0 12px ${cyanAlpha(0.3)}`,
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
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  hintHidden: {
    opacity: 0,
  },
  assembled: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    marginBottom: 16,
  },
  assembledLabel: {
    fontSize: 9,
    letterSpacing: 1,
    color: colors.dim,
    fontFamily: mono,
  },
  assembledCode: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 4,
    color: colors.ice,
    fontFamily: mono,
  },
  actionError: {
    color: colors.danger,
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 8,
  },
  lockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingVertical: 16,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: cyanAlpha(0.55),
    backgroundColor: cyanAlpha(0.24),
    boxShadow: `0 4px 0 ${colors.cyanDeep}, 0 0 20px ${cyanAlpha(0.3)}`,
  },
  lockBtnPressed: {
    transform: [{ translateY: 3 }],
    boxShadow: `0 0 14px ${cyanAlpha(0.25)}`,
  },
  lockBtnDisabled: {
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    boxShadow: undefined,
  },
  lockText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
    color: colors.ice,
    fontFamily: mono,
    textShadowColor: cyanAlpha(0.7),
    textShadowRadius: 10,
  },
  lockTextDisabled: {
    color: colors.dim,
    textShadowColor: 'transparent',
  },
  lockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingVertical: 15,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: withAlpha(colors.success, 0.4),
    backgroundColor: withAlpha(colors.success, 0.14),
    boxShadow: `0 0 16px ${withAlpha(colors.success, 0.18)}`,
  },
  lockedText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
    color: colors.success,
    fontFamily: mono,
  },
  spacer: {
    flex: 1,
  },
  startCue: {
    textAlign: 'center',
    fontSize: 11,
    letterSpacing: 3,
    color: colors.cyan,
    fontFamily: mono,
    marginBottom: 12,
    textShadowColor: cyanAlpha(0.6),
    textShadowRadius: 10,
  },
  opp: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  oppReady: {
    borderColor: withAlpha(colors.success, 0.4),
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
});
