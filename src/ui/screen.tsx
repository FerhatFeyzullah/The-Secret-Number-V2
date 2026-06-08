import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FloatingDigits } from './floating-digits';
import { colors } from './theme';

/** Tüm ekranlar için ortak zemin: gradyan + süzülen rakamlar + safe area. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <LinearGradient
      colors={[colors.bgTop, colors.bgMid, colors.bgBottom]}
      style={styles.fill}>
      {/* Köşe vinyeti: dikey + yatay kenar koyulaşması köşelerde üst üste binip
          merkezden dışa radyal koyulaşma hissi verir. Merkez saydam kalır. */}
      <LinearGradient
        colors={[colors.vignette, colors.vignetteClear, colors.vignetteClear, colors.vignette]}
        locations={[0, 0.3, 0.7, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <LinearGradient
        colors={[colors.vignette, colors.vignetteClear, colors.vignetteClear, colors.vignette]}
        locations={[0, 0.3, 0.7, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <FloatingDigits />
      <SafeAreaView style={styles.content}>{children}</SafeAreaView>
    </LinearGradient>
  );
}

/** Alt ekranlarda geri ok + başlık satırı. */
export function ScreenHeader({ title, onInfo }: { title: string; onInfo?: () => void }) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
        <Ionicons name="arrow-back" size={24} color={colors.cyan} />
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
      {onInfo ? (
        <Pressable onPress={onInfo} hitSlop={12} style={styles.back}>
          <Ionicons name="help-circle-outline" size={24} color={colors.cyan} />
        </Pressable>
      ) : (
        <View style={styles.back} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  back: {
    width: 32,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
});
