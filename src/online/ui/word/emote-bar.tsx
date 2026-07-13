import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QUICK_TEXTS } from '@/online/quick-texts';
import { getSignal } from '@/signals/catalog';
import { colors, mono, withAlpha } from '@/ui/theme';

/** Maç-içi emote/mesaj gönderme (KELİME modu — ilk etap). Üst bara küçük buton;
 *  basınca alttan tepsi: EMOTE = oyuncunun sinyal destesi (≤6, sahip olunan),
 *  MESAJ = 6 sabit hazır metin. Gönderim ebeveynin sendSignal/sendText'ine (efemeral
 *  broadcast). Gönderimde kısa cooldown (spam koruması). */
const COOLDOWN_MS = 2500;

export function EmoteBar({
  deck,
  onSendSignal,
  onSendText,
  disabled = false,
}: {
  /** Oyuncunun sinyal destesi (≤6 id) — yalnız sahip olunanlar. */
  deck: string[];
  onSendSignal: (id: string) => void;
  onSendText: (text: string) => void;
  disabled?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [cooling, setCooling] = useState(false);
  const coolRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (coolRef.current != null) clearTimeout(coolRef.current);
    };
  }, []);

  const fire = useCallback((send: () => void) => {
    if (coolRef.current != null) return; // cooldown içindeyken engelle
    send();
    setOpen(false);
    setCooling(true);
    coolRef.current = setTimeout(() => {
      coolRef.current = null;
      setCooling(false);
    }, COOLDOWN_MS);
  }, []);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled || cooling}
        hitSlop={8}
        accessibilityLabel="Emote / mesaj gönder"
        style={[styles.toggle, cooling && styles.toggleCooling]}>
        <Feather name="smile" size={18} color={cooling ? colors.dim : colors.cyan} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 18 }]}>
            <View style={styles.grip} />
            <View style={styles.headRow}>
              <Feather name="smile" size={14} color={colors.cyan} />
              <Text style={styles.headText}>EMOTE</Text>
            </View>
            <View style={styles.emoteRow}>
              {deck.map((id) => {
                const sig = getSignal(id);
                if (!sig) return null;
                const Icon = sig.component;
                return (
                  <Pressable
                    key={id}
                    onPress={() => fire(() => onSendSignal(id))}
                    style={({ pressed }) => [styles.emoteCell, pressed && styles.cellPressed]}>
                    <Icon size={36} animated={false} />
                  </Pressable>
                );
              })}
            </View>

            <View style={[styles.headRow, styles.headGap]}>
              <Feather name="message-circle" size={14} color={colors.amber} />
              <Text style={[styles.headText, { color: colors.amber }]}>MESAJ</Text>
            </View>
            <View style={styles.msgGrid}>
              {QUICK_TEXTS.map((t) => (
                <Pressable
                  key={t}
                  onPress={() => fire(() => onSendText(t))}
                  style={({ pressed }) => [styles.msgCap, pressed && styles.capPressed]}>
                  <Text style={styles.msgText} numberOfLines={2}>
                    {t}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

type Content = { kind: 'emote'; id: string } | { kind: 'text'; text: string };
const SHOW_MS = 2600;
/** Gelen reaksiyon YÜKSEKLİĞİ — emote ve mesaj AYNI alanı kaplar (tutarlı bant). */
const REACTION_H = 34;

/** Rakipten gelen emote/mesaj → rakip tarafında animasyonlu baloncuk (pop → ~2.6 sn →
 *  kaybol). pointerEvents yok → oyunu engellemez. incomingSignal/incomingText nonce'una
 *  bağlı (aynı reaksiyon tekrarında bile yeniden pop'lar). */
export function IncomingReaction({
  signal,
  text,
  placement = 'center',
}: {
  signal: { id: string; nonce: number } | null;
  text: { text: string; nonce: number } | null;
  /** 'center' → ebeveynin ortasında (kelime modu, rakip kartı içinde).
   *  'belowRight' → ebeveynin ALTINA, sağa yaslı hang (sayı/protokol: üst barın
   *  altında, tur çipinin altında; banner metni ortada olduğundan sağ boş kalır). */
  placement?: 'center' | 'belowRight';
}) {
  const [content, setContent] = useState<Content | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const popup = useCallback(
    (c: Content) => {
      setContent(c);
      if (timerRef.current) clearTimeout(timerRef.current);
      anim.setValue(0);
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 6, tension: 120 }).start();
      timerRef.current = setTimeout(() => {
        Animated.timing(anim, { toValue: 0, duration: 240, useNativeDriver: true }).start(
          ({ finished }) => finished && setContent(null),
        );
      }, SHOW_MS);
    },
    [anim],
  );

  // Nonce her gelişte artar → aynı reaksiyon peş peşe gelse bile yeniden tetiklenir.
  useEffect(() => {
    if (signal) popup({ kind: 'emote', id: signal.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal?.nonce]);
  useEffect(() => {
    if (text) popup({ kind: 'text', text: text.text });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text?.nonce]);
  useEffect(() => {
    return () => {
      if (timerRef.current != null) clearTimeout(timerRef.current);
    };
  }, []);

  if (!content) return null;
  const style = {
    opacity: anim,
    transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }],
  };
  const emoteIcon = content.kind === 'emote' ? getSignal(content.id) : null;
  const Icon = emoteIcon?.component;
  return (
    <View
      style={placement === 'belowRight' ? styles.incomingBelow : styles.incomingWrap}
      pointerEvents="none">
      <Animated.View style={style}>
        {Icon ? (
          // Emote: kapsül YOK — 40px, kartın ortasında.
          <Icon size={40} animated />
        ) : content.kind === 'text' ? (
          // Metin: şeffaf çerçeve — emote ile AYNI yükseklikte (REACTION_H).
          <View style={[styles.reactBox, styles.textBubble]}>
            <Text style={styles.textBubbleStr} numberOfLines={1}>
              {content.text}
            </Text>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    width: 54,
    alignSelf: 'stretch', // "Kelimeyi Onayla" ile aynı yükseklik (confirmRow alignItems:stretch)
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: withAlpha(colors.cyan, 0.5),
    backgroundColor: withAlpha(colors.cyan, 0.14),
    boxShadow: `0 0 14px -4px ${withAlpha(colors.cyan, 0.6)}`,
  },
  toggleCooling: {
    borderColor: colors.glassBorder,
    backgroundColor: colors.glass,
    boxShadow: undefined,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(4,8,18,0.6)',
  },
  sheet: {
    backgroundColor: colors.bgMid,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: colors.glassBorder,
    paddingHorizontal: 18,
    paddingTop: 10,
    gap: 8,
    boxShadow: '0 -12px 40px rgba(0,0,0,0.5)',
  },
  grip: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: 6,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  headGap: {
    marginTop: 14,
  },
  headText: {
    fontFamily: mono,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    color: colors.cyan,
  },
  emoteRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  emoteCell: {
    width: 50,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: withAlpha(colors.cyan, 0.22),
  },
  cellPressed: {
    backgroundColor: withAlpha(colors.cyan, 0.18),
    borderColor: withAlpha(colors.cyan, 0.5),
    transform: [{ scale: 0.94 }],
  },
  msgGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  msgCap: {
    flexBasis: '30%',
    flexGrow: 1,
    minHeight: 52,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: withAlpha(colors.cyan, 0.3),
    backgroundColor: withAlpha(colors.cyan, 0.1),
    boxShadow: `0 0 14px -6px ${withAlpha(colors.cyan, 0.5)}`,
  },
  capPressed: {
    backgroundColor: withAlpha(colors.cyan, 0.22),
    borderColor: withAlpha(colors.cyan, 0.55),
    transform: [{ scale: 0.97 }],
  },
  msgText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.ice,
    textAlign: 'center',
    fontFamily: mono,
    letterSpacing: 0.2,
  },
  // Gelen reaksiyon — rakip kartının İÇİNE, tam ortaya. overflow:hidden → kart
  // sınırının DIŞINA taşamaz (dikey/yatay).
  incomingWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    zIndex: 20,
  },
  // Sayı/protokol düellosu: reaksiyon üst barın ALTINA, sağa yaslı hang'ler.
  // top:'100%' → ebeveyn üst barın hemen altı; sağ yaslı → banner'ın (ortalı
  // metin) sağ boşluğuna denk gelir, tur çipinin altında kalır. UI itmez.
  incomingBelow: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 6,
    alignItems: 'flex-end',
    zIndex: 30,
  },
  // Emote ve mesajın oturduğu ORTAK yükseklikteki alan (aynı bant → aynı alan).
  reactBox: {
    height: REACTION_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBubble: {
    maxWidth: 170,
    paddingHorizontal: 11,
    borderRadius: 10,
    backgroundColor: 'transparent', // şeffaf — sadece çerçeve
    borderWidth: 1,
    borderColor: withAlpha(colors.ice, 0.45),
  },
  textBubbleStr: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.ice, // beyazımsı yazı
  },
});
