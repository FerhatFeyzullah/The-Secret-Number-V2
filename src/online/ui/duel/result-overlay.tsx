import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import type { MatchResult } from '@/online/types';
import { colors, mono, withAlpha } from '@/ui/theme';
import { Avatar } from '../parts';

/** Maç sonu kazanımı (sunucudan; istemci yeniden hesaplamaz). */
export type MatchReward = { rating: number; xp: number; veri: number };

/** Bitiş sebebi etiketi — oyuncunun perspektifinden (madde 8). result yoksa
 *  güvenli varsayılan. forfeit'te kaybeden ayrılan taraftır. */
function reasonText(win: boolean, result: MatchResult | null): string {
  switch (result) {
    case 'win':
      return win ? 'Rakibin sayısını buldun!' : 'Rakip senin sayını buldu';
    case 'timeout':
      return win ? 'Rakibin süresi doldu' : 'Süren doldu';
    case 'forfeit':
      return win ? 'Rakip maçtan ayrıldı' : 'Maçtan ayrıldın';
    default:
      return win ? 'Kazandın' : 'Kaybettin';
  }
}

const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);

// Maça yakışan, kışkırtıcı/saldırgan olmayan set.
const EMOJIS = ['👍', '🔥', '😎', '😅', '😮', '👏'];
const spaced = (s: string | null) => (s ? s.split('').join(' ') : '—');

/** Kazan/kaybet ekranı: verdict + iki gizli sayı ifşası + Tekrar Oyna / Ana Menü
 *  + akordeon emoji şeridi (efemeral realtime broadcast). Rakibin gönderdiği
 *  emoji, rakip avatarının yanında pop'layıp birkaç saniye sonra solar. */
export function ResultOverlay({
  win,
  result,
  bestOf = false,
  myWins = 0,
  oppWins = 0,
  reward,
  mySecret,
  theirSecret,
  opponentName,
  opponentInitial,
  incomingEmoji,
  onSendEmoji,
  onRematch,
  onMenu,
}: {
  win: boolean;
  /** Bitiş sebebi (win/timeout/forfeit) — perspektife göre etiket. */
  result: MatchResult | null;
  /** Best of 3 ise tur skoru gösterilir. */
  bestOf?: boolean;
  myWins?: number;
  oppWins?: number;
  /** Kazanım (Kupa/XP/Veri); null → ilerleme saymayan maç (özel oda). */
  reward?: MatchReward | null;
  mySecret: string | null;
  theirSecret: string | null;
  opponentName: string;
  opponentInitial: string;
  incomingEmoji: { emoji: string; nonce: number } | null;
  onSendEmoji: (emoji: string) => void;
  onRematch: () => void;
  onMenu: () => void;
}) {
  const v = useRef(new Animated.Value(0)).current;
  const [open, setOpen] = useState(false);
  const acc = useRef(new Animated.Value(0)).current;
  const [sent, setSent] = useState<string | null>(null);
  const sentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rakip emojisi: gelen son emojiyi avatar yanında pop'lat, sonra solup gitsin.
  const [oppEmoji, setOppEmoji] = useState<string | null>(null);
  const oppAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(v, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }).start();
  }, [v]);

  useEffect(() => {
    Animated.timing(acc, { toValue: open ? 1 : 0, duration: 220, useNativeDriver: false }).start();
  }, [open, acc]);

  useEffect(() => {
    if (!incomingEmoji) return;
    setOppEmoji(incomingEmoji.emoji);
    oppAnim.setValue(0);
    const anim = Animated.sequence([
      Animated.spring(oppAnim, { toValue: 1, friction: 5, useNativeDriver: true }),
      Animated.delay(1900),
      Animated.timing(oppAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]);
    anim.start(({ finished }) => {
      if (finished) setOppEmoji(null);
    });
    return () => anim.stop();
  }, [incomingEmoji, oppAnim]);

  useEffect(() => () => {
    if (sentTimer.current) clearTimeout(sentTimer.current);
  }, []);

  const handleSend = (e: string) => {
    onSendEmoji(e);
    setSent(e);
    if (sentTimer.current) clearTimeout(sentTimer.current);
    sentTimer.current = setTimeout(() => setSent(null), 1400);
  };

  const accent = win ? colors.cyan : colors.danger;
  const enter = { opacity: v };
  const pop = {
    opacity: v,
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
  };
  const accStyle = {
    height: acc.interpolate({ inputRange: [0, 1], outputRange: [0, 60] }),
    opacity: acc,
  };
  const bubbleStyle = {
    opacity: oppAnim,
    transform: [{ scale: oppAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
  };

  return (
    <Animated.View style={[styles.root, enter]}>
      <View style={[styles.glow, { backgroundColor: withAlpha(accent, 0.18), boxShadow: `0 0 120px 60px ${withAlpha(accent, 0.18)}` }]} />

      <Animated.Text
        style={[styles.verdict, { color: win ? colors.ice : '#fca5a5', textShadowColor: accent }, pop]}>
        {win ? 'KAZANDIN!' : 'KAYBETTİN'}
      </Animated.Text>
      <Text style={styles.subtitle}>{reasonText(win, result)}</Text>
      {bestOf ? (
        <Text style={styles.score}>
          Maç skoru <Text style={{ color: colors.cyan }}>{myWins}</Text>
          <Text style={{ color: colors.dim }}> – </Text>
          <Text style={{ color: colors.amber }}>{oppWins}</Text>
        </Text>
      ) : null}

      {/* Kazanım: yalnız ilerleme sayan maçta (matchmade); değerler sunucudan.
          reward undefined → henüz yükleniyor (gösterme); null → saymayan maç. */}
      {reward ? (
        <View style={styles.rewards}>
          <View style={styles.rewardChip}>
            <Feather name="award" size={13} color={colors.amber} />
            <Text style={[styles.rewardVal, { color: colors.amber }]}>{fmt(reward.rating)}</Text>
          </View>
          <View style={styles.rewardChip}>
            <Feather name="zap" size={13} color={colors.violet} />
            <Text style={[styles.rewardVal, { color: colors.violet }]}>{fmt(reward.xp)} XP</Text>
          </View>
          <View style={styles.rewardChip}>
            <Feather name="database" size={13} color={colors.teal} />
            <Text style={[styles.rewardVal, { color: colors.teal }]}>{fmt(reward.veri)}</Text>
          </View>
        </View>
      ) : reward === null ? (
        <Text style={styles.noScore}>Bu maç ilerleme saymaz</Text>
      ) : null}

      {/* Rakip kimliği + gelen emoji baloncuğu (rakibe bağlı, anlamlı konum). */}
      <View style={styles.oppRow}>
        <Avatar initial={opponentInitial} accent={colors.amber} size={40} />
        <Text style={styles.oppName} numberOfLines={1}>
          {opponentName}
        </Text>
        {oppEmoji ? (
          <Animated.View style={[styles.bubble, bubbleStyle]}>
            <Text style={styles.bubbleText}>{oppEmoji}</Text>
          </Animated.View>
        ) : null}
      </View>

      <View style={styles.reveal}>
        <View style={styles.revealCol}>
          <Text style={styles.revealLabel}>SENİN SAYIN</Text>
          <Text style={[styles.revealNum, { color: colors.cyan, textShadowColor: colors.cyan }]}>
            {spaced(mySecret)}
          </Text>
        </View>
        <View style={styles.revealDivider} />
        <View style={styles.revealCol}>
          <Text style={styles.revealLabel}>RAKİBİN SAYISI</Text>
          <Text style={[styles.revealNum, { color: colors.amber, textShadowColor: colors.amber }]}>
            {spaced(theirSecret)}
          </Text>
        </View>
      </View>

      {/* Akordeon emoji şeridi (aç/kapa smooth). */}
      <Animated.View style={[styles.accordion, accStyle]}>
        <View style={styles.emojiStrip}>
          {EMOJIS.map((e) => (
            <Pressable
              key={e}
              onPress={() => handleSend(e)}
              style={[styles.emoji, sent === e && styles.emojiSent]}>
              <Text style={styles.emojiText}>{e}</Text>
            </Pressable>
          ))}
        </View>
      </Animated.View>
      <Text style={[styles.sentHint, !sent && styles.sentHintHidden]}>Gönderildi {sent ?? ''}</Text>

      {/* Buton satırı: Tekrar Oyna · Ana Menü · emoji aç/kapa */}
      <View style={styles.buttonRow}>
        <Pressable
          onPress={onRematch}
          style={[styles.cta, styles.ctaPrimary, { borderColor: withAlpha(colors.cyan, 0.5), backgroundColor: withAlpha(colors.cyan, 0.22) }]}>
          <Feather name="rotate-cw" size={14} color={colors.ice} />
          <Text style={[styles.ctaText, { color: colors.ice }]}>Tekrar Oyna</Text>
        </Pressable>
        <Pressable onPress={onMenu} style={[styles.cta, styles.ctaPrimary, styles.ctaGlass]}>
          <Feather name="home" size={14} color={colors.text} />
          <Text style={[styles.ctaText, { color: colors.text }]}>Ana Menü</Text>
        </Pressable>
        <Pressable
          onPress={() => setOpen((o) => !o)}
          style={[styles.emojiToggle, open && styles.emojiToggleOpen]}>
          <Feather name="smile" size={20} color={open ? colors.amber : colors.text} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: 'rgba(6,12,26,0.92)',
  },
  glow: {
    position: 'absolute',
    top: '30%',
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  verdict: {
    fontSize: 44,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 2,
    textShadowRadius: 28,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 12,
    color: colors.text,
    fontFamily: mono,
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 12,
  },
  score: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: mono,
    color: colors.ice,
    marginBottom: 14,
  },
  rewards: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  rewardChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 20,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  rewardVal: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 0.3,
  },
  noScore: {
    fontSize: 10,
    color: colors.dim,
    fontFamily: mono,
    letterSpacing: 1,
    marginBottom: 20,
  },
  oppRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 18,
    paddingHorizontal: 4,
  },
  oppName: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
    fontFamily: mono,
    maxWidth: 140,
  },
  bubble: {
    marginLeft: 4,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: withAlpha(colors.amber, 0.16),
    borderWidth: 1,
    borderColor: withAlpha(colors.amber, 0.45),
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0 0 14px ${withAlpha(colors.amber, 0.4)}`,
  },
  bubbleText: {
    fontSize: 20,
  },
  reveal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 24,
    marginBottom: 16,
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
    fontSize: 34,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 3,
    textShadowRadius: 14,
  },
  revealDivider: {
    width: 1,
    height: 44,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  accordion: {
    width: '100%',
    overflow: 'hidden',
  },
  emojiStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  emoji: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiSent: {
    backgroundColor: withAlpha(colors.cyan, 0.18),
    borderColor: withAlpha(colors.cyan, 0.4),
    transform: [{ scale: 1.12 }],
  },
  emojiText: {
    fontSize: 20,
  },
  sentHint: {
    height: 16,
    fontSize: 10,
    color: colors.cyan,
    fontFamily: mono,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  sentHintHidden: {
    opacity: 0,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    width: '100%',
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  ctaPrimary: {
    flex: 1,
  },
  ctaGlass: {
    backgroundColor: colors.glass,
    borderColor: colors.glassBorder,
  },
  ctaText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: mono,
    letterSpacing: 1,
  },
  emojiToggle: {
    width: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiToggleOpen: {
    borderColor: withAlpha(colors.amber, 0.5),
    backgroundColor: withAlpha(colors.amber, 0.14),
  },
});
