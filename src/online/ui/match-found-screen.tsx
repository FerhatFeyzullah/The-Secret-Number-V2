import { Feather } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View } from 'react-native';

import type { FirstTurnMode, MatchMode } from '@/online/types';
import { colors, cyanAlpha, mono } from '@/ui/theme';
import { Avatar } from './parts';

const clockLabel = (ms: number) => (ms === 120000 ? '2 dk' : ms === 90000 ? '1.5 dk' : '1 dk');

/** Kısa kutlama anı: VS açılışı + gerçek oyuncu adları + maç bilgisi.
 *  El sıkışması OTOMATİK: ekran ~7 sn gösterilir, sonraki ekrana kendiliğinden
 *  geçilir (mark_ready'yi üst akış gönderir) — manuel "Hazır"/"İptal" yok. */
export function MatchFoundScreen({
  myName,
  opponentName,
  mode,
  clockMs,
  firstTurnMode,
  iAmCreator,
}: {
  myName: string;
  /** null = ad henüz yükleniyor; "Rakip"e düşmek yerine "…" gösterilir
   *  (ad geldiğinde tek geçiş — titreşim yok). */
  opponentName: string | null;
  mode: MatchMode;
  /** Konfig: kişi başı süre (ms). */
  clockMs: number;
  /** Konfig: ilk sıra modu. */
  firstTurnMode: FirstTurnMode;
  /** Çağıran oda kuran (player1) mı — ilk sıra metnini kişiselleştirir. */
  iAmCreator: boolean;
}) {
  const oppName = opponentName ?? '…';
  const oppInitial = opponentName ? opponentName.charAt(0) : '?';
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: 520,
      delay: 80,
      useNativeDriver: true,
    }).start();
  }, [v]);

  const fade = { opacity: v };
  const rise = {
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  };
  const pop = {
    opacity: v,
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
  };

  const modeLabel =
    mode === 'quick' ? 'Hızlı Maç' : mode === 'protocol' ? 'Protokol Maçı' : 'Özel Oyun';
  const turnPhrase =
    firstTurnMode === 'random' ? 'Rastgele' : iAmCreator ? 'Sen başlıyorsun' : 'Rakip başlıyor';

  return (
    <View style={styles.root}>
      <Animated.Text style={[styles.banner, rise]}>⚡ RAKİP BULUNDU</Animated.Text>

      <Animated.View style={[styles.versus, pop]}>
        <View style={styles.player}>
          <Avatar initial={myName.charAt(0)} accent={colors.cyan} size={80} />
          <Text style={styles.name} numberOfLines={1}>
            {myName}
          </Text>
        </View>

        <View style={styles.vsBlock}>
          <Text style={styles.vsKarsi}>KARŞI</Text>
          <Text style={styles.vs}>VS</Text>
          <View style={styles.vsRule} />
        </View>

        <View style={styles.player}>
          <Avatar initial={oppInitial} accent={colors.amber} size={80} />
          <Text style={styles.name} numberOfLines={1}>
            {oppName}
          </Text>
        </View>
      </Animated.View>

      <Animated.View style={[styles.info, rise]}>
        {[
          { label: 'MOD', val: modeLabel },
          { label: 'SÜRE', val: clockLabel(clockMs) },
          { label: 'RAKİP', val: oppName },
        ].map((item) => (
          <View key={item.label} style={styles.infoItem}>
            <Text style={styles.infoLabel}>{item.label}</Text>
            <Text
              style={styles.infoVal}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}>
              {item.val}
            </Text>
          </View>
        ))}
      </Animated.View>

      <Animated.View style={[styles.firstTurn, rise]}>
        <Feather name="play" size={12} color={colors.amber} />
        <Text style={styles.firstTurnText}>
          İlk sıra: <Text style={styles.firstTurnVal}>{turnPhrase}</Text>
        </Text>
      </Animated.View>

      {mode === 'protocol' ? (
        <Animated.View style={[styles.firstTurn, rise]}>
          <Feather name="layers" size={12} color={colors.violet} />
          <Text style={styles.firstTurnText}>
            <Text style={[styles.firstTurnVal, { color: colors.violet }]}>3 tur</Text> · iki
            galibiyet alır
          </Text>
        </Animated.View>
      ) : null}

      {/* Otomatik hazırlık: buton yok, sade yükleme görünümü (≈7 sn). */}
      <Animated.View style={[styles.action, fade]}>
        <View style={styles.preparing}>
          <ActivityIndicator color={colors.cyan} size="small" />
          <Text style={styles.preparingText}>OYUN HAZIRLANIYOR…</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  banner: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 5,
    color: colors.cyan,
    fontFamily: mono,
    textShadowColor: colors.cyan,
    textShadowRadius: 16,
    marginBottom: 40,
  },
  versus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 44,
  },
  player: {
    alignItems: 'center',
    gap: 10,
    width: 96,
  },
  name: {
    fontSize: 11,
    color: colors.dim,
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  vsBlock: {
    alignItems: 'center',
    gap: 4,
    marginHorizontal: 14,
    marginBottom: 20,
  },
  vsKarsi: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.dim,
    fontFamily: mono,
    letterSpacing: 1,
  },
  vs: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.ice,
    fontFamily: mono,
    letterSpacing: 1,
    textShadowColor: cyanAlpha(0.7),
    textShadowRadius: 20,
  },
  vsRule: {
    width: 36,
    height: 2,
    borderRadius: 2,
    backgroundColor: colors.cyan,
  },
  info: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    marginBottom: 12,
  },
  firstTurn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 8,
    paddingHorizontal: 12,
  },
  firstTurnText: {
    flexShrink: 1,
    fontSize: 11,
    color: colors.dim,
    fontFamily: mono,
    textAlign: 'center',
  },
  firstTurnVal: {
    color: colors.amber,
    fontWeight: '800',
  },
  infoItem: {
    flex: 1,
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 9,
    color: colors.dim,
    fontFamily: mono,
    letterSpacing: 1,
    marginBottom: 4,
  },
  infoVal: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ice,
    fontFamily: mono,
  },
  action: {
    width: '100%',
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 14,
    marginTop: 28,
  },
  preparing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  preparingText: {
    fontSize: 11,
    letterSpacing: 3,
    color: colors.dim,
    fontFamily: mono,
  },
});
