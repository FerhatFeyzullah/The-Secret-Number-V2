import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { upperTr } from '@/game';
import type { MatchResult } from '@/online/types';
import { getSignal, SIGNALS } from '@/signals/catalog';
import { colors, mono, withAlpha } from '@/ui/theme';
import { Avatar } from '../parts';

/** Maç sonu kazanımı (sunucudan; istemci yeniden hesaplamaz). */
export type MatchReward = { rating: number; xp: number; veri: number };

/** Bitiş sebebi etiketi — oyuncunun perspektifinden (madde 8). result yoksa
 *  güvenli varsayılan. forfeit'te kaybeden ayrılan taraftır. */
function reasonText(win: boolean, result: MatchResult | null, isWord: boolean): string {
  switch (result) {
    case 'win':
      return win
        ? isWord ? 'Rakibin kelimesini buldun!' : 'Rakibin sayısını buldun!'
        : isWord ? 'Rakip senin kelimeni buldu' : 'Rakip senin sayını buldu';
    case 'timeout':
      return win ? 'Rakibin süresi doldu' : 'Süren doldu';
    case 'forfeit':
      return win ? 'Rakip maçtan ayrıldı' : 'Maçtan ayrıldın';
    default:
      return win ? 'Kazandın' : 'Kaybettin';
  }
}

const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const spaced = (s: string | null) => (s ? s.split('').join(' ') : '—');
/** Deste boşsa (olmamalı) güvenli geri-dönüş: starter sinyaller. */
const STARTERS = SIGNALS.filter((s) => s.starter).map((s) => s.id);
/** Arka arkaya spam'i engelle (maç sonu reaksiyonu). */
const SEND_COOLDOWN_MS = 600;

/** Kazan/kaybet ekranı: verdict + iki gizli sayı ifşası + Tekrar Oyna / Ana Menü
 *  + akordeon SİNYAL şeridi (oyuncunun 6'lık destesi; efemeral realtime broadcast).
 *  Rakibin gönderdiği sinyal, rakip avatarının yanında büyük/animasyonlu pop'layıp
 *  birkaç saniye sonra solar. Kendi gönderdiğin şeritte vurgulanır (onay). */
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
  contentType = 'number' as const,
  deck,
  incomingSignal,
  onSendSignal,
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
  /** 'word' → kelime modu etiketleri ve reveal düzeni; varsayılan 'number'. */
  contentType?: 'number' | 'word';
  /** Oyuncunun sinyal destesi (≤6 id) — maç sonu reaksiyon seti. */
  deck: string[];
  incomingSignal: { id: string; nonce: number } | null;
  onSendSignal: (signalId: string) => void;
  onRematch: () => void;
  onMenu: () => void;
}) {
  const v = useRef(new Animated.Value(0)).current;
  const [open, setOpen] = useState(false);
  const acc = useRef(new Animated.Value(0)).current;
  const [sent, setSent] = useState<string | null>(null);
  const sentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSendRef = useRef(0);

  // Rakip sinyali: gelen son sinyali avatar yanında pop'lat, sonra solup gitsin.
  const [oppSignal, setOppSignal] = useState<string | null>(null);
  const oppAnim = useRef(new Animated.Value(0)).current;

  const pool = deck.length ? deck : STARTERS;

  useEffect(() => {
    Animated.spring(v, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }).start();
  }, [v]);

  useEffect(() => {
    Animated.timing(acc, { toValue: open ? 1 : 0, duration: 220, useNativeDriver: false }).start();
  }, [open, acc]);

  useEffect(() => {
    if (!incomingSignal) return;
    setOppSignal(incomingSignal.id);
    oppAnim.setValue(0);
    const anim = Animated.sequence([
      Animated.spring(oppAnim, { toValue: 1, friction: 5, useNativeDriver: true }),
      Animated.delay(1900),
      Animated.timing(oppAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]);
    anim.start(({ finished }) => {
      if (finished) setOppSignal(null);
    });
    return () => anim.stop();
  }, [incomingSignal, oppAnim]);

  useEffect(() => () => {
    if (sentTimer.current) clearTimeout(sentTimer.current);
  }, []);

  const handleSend = (id: string) => {
    const now = Date.now();
    if (now - lastSendRef.current < SEND_COOLDOWN_MS) return; // spam koruması
    lastSendRef.current = now;
    onSendSignal(id);
    setSent(id);
    if (sentTimer.current) clearTimeout(sentTimer.current);
    sentTimer.current = setTimeout(() => setSent(null), 1400);
  };

  const isWord = contentType === 'word';
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
  const OppIcon = oppSignal ? getSignal(oppSignal)?.component ?? null : null;

  return (
    <Animated.View style={[styles.root, enter]}>
      <View style={[styles.glow, { backgroundColor: withAlpha(accent, 0.18), boxShadow: `0 0 120px 60px ${withAlpha(accent, 0.18)}` }]} />

      <Animated.Text
        style={[styles.verdict, { color: win ? colors.ice : '#fca5a5', textShadowColor: accent }, pop]}>
        {win ? 'KAZANDIN!' : 'KAYBETTİN'}
      </Animated.Text>
      <Text style={styles.subtitle}>{reasonText(win, result, isWord)}</Text>
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

      {/* Rakip kimliği + gelen sinyal baloncuğu (rakibe bağlı, anlamlı konum). */}
      <View style={styles.oppRow}>
        <Avatar initial={opponentInitial} accent={colors.amber} size={40} />
        <Text style={styles.oppName} numberOfLines={1}>
          {opponentName}
        </Text>
        {OppIcon ? (
          <Animated.View style={[styles.bubble, bubbleStyle]}>
            <OppIcon size={40} animated />
          </Animated.View>
        ) : null}
      </View>

      <View style={styles.reveal}>
        <View style={styles.revealCol}>
          <Text style={styles.revealLabel}>{isWord ? 'SENİN KELİMEN' : 'SENİN SAYIN'}</Text>
          <Text
            numberOfLines={1}
            style={[
              isWord ? styles.revealWord : styles.revealNum,
              { color: colors.cyan, textShadowColor: colors.cyan },
            ]}>
            {isWord ? (mySecret ? upperTr(mySecret) : '—') : spaced(mySecret)}
          </Text>
        </View>
        <View style={styles.revealDivider} />
        <View style={styles.revealCol}>
          <Text style={styles.revealLabel}>{isWord ? 'RAKİBİN KELİMESİ' : 'RAKİBİN SAYISI'}</Text>
          <Text
            numberOfLines={1}
            style={[
              isWord ? styles.revealWord : styles.revealNum,
              { color: colors.amber, textShadowColor: colors.amber },
            ]}>
            {isWord ? (theirSecret ? upperTr(theirSecret) : '—') : spaced(theirSecret)}
          </Text>
        </View>
      </View>

      {/* Akordeon SİNYAL şeridi (deste; aç/kapa smooth). */}
      <Animated.View style={[styles.accordion, accStyle]}>
        <View style={styles.signalStrip}>
          {pool.map((id) => {
            const sig = getSignal(id);
            if (!sig) return null;
            const Icon = sig.component;
            return (
              <Pressable
                key={id}
                onPress={() => handleSend(id)}
                style={[styles.signalBtn, sent === id && styles.signalBtnSent]}>
                <Icon size={34} animated={false} />
              </Pressable>
            );
          })}
        </View>
      </Animated.View>
      <Text style={[styles.sentHint, !sent && styles.sentHintHidden]}>Gönderildi ✓</Text>

      {/* Buton satırı: Tekrar Oyna · Ana Menü · sinyal aç/kapa */}
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
          accessibilityLabel="Sinyal gönder"
          style={[styles.signalToggle, open && styles.signalToggleOpen]}>
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
    minHeight: 48,
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
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: withAlpha(colors.amber, 0.14),
    borderWidth: 1,
    borderColor: withAlpha(colors.amber, 0.45),
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0 0 16px ${withAlpha(colors.amber, 0.4)}`,
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
  revealWord: {
    fontSize: 26,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 2,
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
  signalStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  signalBtn: {
    width: 46,
    height: 46,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signalBtnSent: {
    backgroundColor: withAlpha(colors.cyan, 0.18),
    borderColor: withAlpha(colors.cyan, 0.45),
    transform: [{ scale: 1.12 }],
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
  signalToggle: {
    width: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signalToggleOpen: {
    borderColor: withAlpha(colors.amber, 0.5),
    backgroundColor: withAlpha(colors.amber, 0.14),
  },
});
