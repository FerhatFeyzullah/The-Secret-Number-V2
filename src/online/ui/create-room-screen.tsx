import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassButton } from '@/ui/glass';
import { colors, cyanAlpha, mono } from '@/ui/theme';
import { Avatar, LobbyHeader } from './parts';

/** Sallanan bekleme noktaları (dotBounce @keyframes karşılığı). */
function WaitingDots() {
  return (
    <View style={dotStyles.row}>
      {[0, 1, 2].map((i) => (
        <BounceDot key={i} index={i} />
      ))}
    </View>
  );
}

function BounceDot({ index }: { index: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(index * 220),
        Animated.timing(v, { toValue: 1, duration: 560, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 560, useNativeDriver: true }),
        Animated.delay((2 - index) * 220),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [index, v]);
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] });
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  return <Animated.View style={[dotStyles.dot, { opacity, transform: [{ scale }] }]} />;
}

/** Oda kuruldu: gerçek oda kodu plakası + kopyala/paylaş + rakip bekleme. */
export function CreateRoomScreen({
  roomCode,
  error,
  onCopy,
  onShare,
  onCancel,
}: {
  roomCode: string | null;
  error?: string | null;
  onCopy: () => void | Promise<void>;
  onShare: () => void;
  onCancel: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const chars = roomCode ? roomCode.split('') : ['', '', '', '', '', ''];

  const handleCopy = async () => {
    await onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <View style={styles.root}>
      <LobbyHeader title="ODA KUR" onBack={onCancel} />
      <View style={styles.body}>
        <Text style={styles.label}>ODA KODU</Text>

        <View style={styles.plate}>
          {chars.map((ch, i) => (
            <View key={i} style={styles.charBox}>
              <Text style={styles.charText}>{ch || '·'}</Text>
            </View>
          ))}
        </View>

        <View style={styles.row}>
          <Pressable
            onPress={handleCopy}
            disabled={!roomCode}
            style={[styles.smallBtn, copied && styles.smallBtnDone, !roomCode && styles.smallBtnOff]}>
            <Feather
              name={copied ? 'check' : 'copy'}
              size={14}
              color={copied ? colors.cyan : colors.text}
            />
            <Text style={[styles.smallBtnText, copied && { color: colors.cyan }]}>
              {copied ? 'Kopyalandı' : 'Kopyala'}
            </Text>
          </Pressable>
          <Pressable
            onPress={onShare}
            disabled={!roomCode}
            style={[styles.smallBtn, styles.shareBtn, !roomCode && styles.smallBtnOff]}>
            <Feather name="share-2" size={14} color={colors.cyan} />
            <Text style={[styles.smallBtnText, { color: colors.cyan }]}>Paylaş</Text>
          </Pressable>
        </View>

        <View style={styles.waiting}>
          <View style={styles.slots}>
            <Avatar initial="O" accent={colors.cyan} />
            <WaitingDots />
            <Avatar empty />
          </View>
          {error ? (
            <Text style={styles.errorText} selectable>
              {error}
            </Text>
          ) : (
            <Text style={styles.waitingText}>Rakip bekleniyor…</Text>
          )}
        </View>

        <View style={styles.action}>
          <GlassButton label="İptal" accent={colors.dim} onPress={onCancel} />
        </View>
      </View>
    </View>
  );
}

const dotStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.dim,
  },
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 24,
  },
  label: {
    fontSize: 10,
    color: colors.dim,
    letterSpacing: 3,
    fontFamily: mono,
    marginBottom: 16,
  },
  plate: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: cyanAlpha(0.55),
    backgroundColor: cyanAlpha(0.12),
    boxShadow: `0 0 28px ${cyanAlpha(0.28)}`,
    marginBottom: 24,
  },
  charBox: {
    width: 40,
    height: 56,
    borderRadius: 10,
    backgroundColor: cyanAlpha(0.12),
    borderWidth: 1,
    borderColor: cyanAlpha(0.28),
    alignItems: 'center',
    justifyContent: 'center',
  },
  charText: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.cyan,
    fontFamily: mono,
    textShadowColor: colors.cyan,
    textShadowRadius: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    paddingHorizontal: 8,
    marginBottom: 36,
  },
  smallBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 13,
    borderRadius: 13,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  shareBtn: {
    backgroundColor: cyanAlpha(0.12),
    borderColor: cyanAlpha(0.4),
  },
  smallBtnDone: {
    backgroundColor: cyanAlpha(0.16),
    borderColor: cyanAlpha(0.5),
  },
  smallBtnOff: {
    opacity: 0.5,
  },
  smallBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.text,
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  waiting: {
    width: '100%',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 24,
    paddingHorizontal: 24,
    borderRadius: 18,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    marginBottom: 24,
  },
  slots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 22,
  },
  waitingText: {
    fontSize: 11,
    color: colors.dim,
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  errorText: {
    fontSize: 11,
    color: colors.danger,
    textAlign: 'center',
  },
  action: {
    width: '100%',
    paddingHorizontal: 16,
    marginTop: 'auto',
    paddingBottom: 8,
  },
});
