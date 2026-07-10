import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactNode } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassButton } from '@/ui/glass';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';
import { Emblem, type FeatherName } from '@/online/ui/parts';

import type { UpdateGate } from './use-update-gate';

/** İndirme çubuğu: ilerleme biliniyorsa dolan çubuk + %, bilinmiyorsa (native
 *  ilerleme olayı yoksa) sağa-sola süzülen belirsiz (indeterminate) segment. */
function ProgressBar({ progress }: { progress: number | undefined }) {
  const [trackW, setTrackW] = useState(0);
  const indeterminate = progress == null;
  const pct = Math.max(0, Math.min(1, progress ?? 0));
  const x = useSharedValue(0);

  useEffect(() => {
    if (indeterminate && trackW > 0) {
      x.value = 0;
      x.value = withRepeat(
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(x);
    }
    return () => cancelAnimation(x);
  }, [indeterminate, trackW, x]);

  const segW = trackW * 0.35;
  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value * (trackW - segW) }],
  }));

  return (
    <View style={styles.progressWrap}>
      <View style={styles.track} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
        {indeterminate ? (
          trackW > 0 ? <Animated.View style={[styles.segment, { width: segW }, slideStyle]} /> : null
        ) : (
          <View style={[styles.fill, { width: trackW * pct }]} />
        )}
      </View>
      <Text style={styles.progressLabel}>
        {indeterminate ? 'İndiriliyor…' : `%${Math.round(pct * 100)}`}
      </Text>
    </View>
  );
}

/** Kök seviyede tam ekran, zorunlu OTA güncelleme ekranı. Oyun temasında
 *  (gradient + vignette + neon), fazlara göre içerik değişir. Sunum katmanı:
 *  tüm mantık `useUpdateGate`'te. */
export function UpdateOverlay({ phase, progress, startDownload, retry, skip, restart }: UpdateGate) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
  }, [opacity]);

  // Zorunlu güncelleme: donanım geri tuşu overlay'i geçemez (kaza ile çıkış yok).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const rootStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  let icon: FeatherName = 'download-cloud';
  let accent = colors.cyan;
  let title = '';
  let subtitle = '';
  let showBar = false;
  let buttons: ReactNode = null;

  switch (phase) {
    case 'available':
      title = 'YENİ SÜRÜM MEVCUT';
      subtitle = 'Oyunun daha yeni bir sürümü hazır. Güncellemek yalnızca birkaç saniye sürer.';
      buttons = (
        <GlassButton
          label="Güncelle"
          variant="fill"
          accent={colors.cyan}
          onPress={startDownload}
          icon={<Feather name="download" size={18} color={colors.cyan} />}
        />
      );
      break;
    case 'downloading':
      title = 'GÜNCELLENİYOR';
      subtitle = 'Lütfen bekle, yeni sürüm indiriliyor.';
      showBar = true;
      break;
    case 'ready':
      icon = 'check-circle';
      accent = colors.success;
      title = 'GÜNCELLEME HAZIR';
      subtitle = 'Yeni sürüme geçmek için oyunu yeniden başlat.';
      showBar = true;
      buttons = (
        <GlassButton
          label="Yeniden Başlat"
          variant="fill"
          accent={colors.success}
          onPress={restart}
          icon={<Feather name="refresh-cw" size={18} color={colors.success} />}
        />
      );
      break;
    case 'error':
      icon = 'wifi-off';
      accent = colors.danger;
      title = 'BAĞLANTI KOPTU';
      subtitle = 'Güncelleme indirilemedi. Bağlantını kontrol edip tekrar dene.';
      buttons = (
        <View style={styles.errorActions}>
          <GlassButton
            label="Tekrar Dene"
            variant="fill"
            accent={colors.cyan}
            onPress={retry}
            icon={<Feather name="rotate-cw" size={18} color={colors.cyan} />}
          />
          <GlassButton label="Şimdilik Geç" accent={colors.dim} onPress={skip} />
        </View>
      );
      break;
    default:
      return null;
  }

  return (
    <Animated.View style={[styles.root, rootStyle]}>
      <LinearGradient
        colors={[colors.bgTop, colors.bgMid, colors.bgBottom]}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[colors.vignette, colors.vignetteClear, colors.vignetteClear, colors.vignette]}
        locations={[0, 0.3, 0.7, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <SafeAreaView style={styles.center}>
        <Emblem icon={icon} accent={accent} size={84} iconSize={36} />
        <Text style={[styles.title, { textShadowColor: withAlpha(accent, 0.6) }]}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {showBar ? <ProgressBar progress={progress} /> : null}
        <View style={styles.actions}>{buttons}</View>
      </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    paddingHorizontal: 32,
  },
  title: {
    color: colors.ice,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
    textShadowRadius: 12,
    marginTop: 4,
  },
  subtitle: {
    color: colors.dim,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 300,
  },
  actions: {
    width: '100%',
    maxWidth: 320,
    marginTop: 8,
  },
  errorActions: {
    width: '100%',
    gap: 10,
  },
  progressWrap: {
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  track: {
    width: '100%',
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 6,
    backgroundColor: colors.cyan,
    boxShadow: `0 0 12px ${cyanAlpha(0.6)}`,
  },
  segment: {
    height: '100%',
    borderRadius: 6,
    backgroundColor: colors.cyan,
    boxShadow: `0 0 12px ${cyanAlpha(0.6)}`,
  },
  progressLabel: {
    color: colors.cyan,
    fontSize: 15,
    fontWeight: '700',
    fontFamily: mono,
    letterSpacing: 1,
  },
});
