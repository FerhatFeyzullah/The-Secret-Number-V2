import { Feather } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { upperTr } from '@/game';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';

export type FeatherName = keyof typeof Feather.glyphMap;

/** Kart canlı-sayaç etiketleri — Türkçe BÜYÜK harf (upperTr; RN textTransform 'i'→'I'
 *  yapıp İ'yi bozardı). Modül düzeyinde bir kez hesaplanır. */
const LBL_WAITING = upperTr('bekliyor');
const LBL_ACTIVE = upperTr('aktif maç');

/** Lobi alt-ekran başlığı: geri ok callback ile (durum makinesinde faz-geri
 *  ya da route'tan çıkış için). ScreenHeader router.back() yaptığından burada
 *  ayrı bir başlık kullanıyoruz. */
export function LobbyHeader({
  title,
  onBack,
  onInfo,
}: {
  title: string;
  onBack?: () => void;
  /** Verilirse sağda "?" çıkar; bilgilendirme modalını açar. */
  onInfo?: () => void;
}) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={12} style={styles.headerBack}>
          <Feather name="arrow-left" size={18} color={colors.text} />
        </Pressable>
      ) : (
        <View style={styles.headerSide} />
      )}
      <Text style={styles.headerTitle}>{title}</Text>
      {onInfo ? (
        <Pressable onPress={onInfo} hitSlop={12} style={styles.headerBack}>
          <Feather name="help-circle" size={18} color={colors.cyan} />
        </Pressable>
      ) : (
        <View style={styles.headerSide} />
      )}
    </View>
  );
}

/** Yuvarlatılmış kare amblem: vurgu renginde camsı zemin, iç halka ve glow.
 *  Tasarımdaki kart/giriş ikonu emblemlerinin RN karşılığı. */
export function Emblem({
  icon,
  iconNode,
  accent,
  size = 66,
  iconSize = 28,
  fillIcon = false,
}: {
  icon?: FeatherName;
  /** Feather yerine özel bir ikon (ör. SVG logo). Verilirse `icon` yok sayılır. */
  iconNode?: ReactNode;
  accent: string;
  size?: number;
  iconSize?: number;
  fillIcon?: boolean;
}) {
  return (
    <View
      style={[
        styles.emblem,
        {
          width: size,
          height: size,
          borderRadius: size * 0.27,
          backgroundColor: withAlpha(accent, 0.16),
          borderColor: withAlpha(accent, 0.5),
          boxShadow: `0 0 18px ${withAlpha(accent, 0.32)}`,
        },
      ]}>
      <View
        style={[
          styles.emblemRing,
          { borderRadius: size * 0.2, borderColor: withAlpha(accent, 0.22) },
        ]}
      />
      {iconNode ??
        (icon ? (
          <Feather
            name={icon}
            size={iconSize}
            color={accent}
            style={fillIcon ? { textShadowColor: accent, textShadowRadius: 8 } : undefined}
          />
        ) : null)}
    </View>
  );
}

/** Lobi/özel seçimdeki büyük seçim kartı: emblem + başlık + alt metin + chevron.
 *  İsteğe bağlı `children` (ör. çevrimiçi rozeti/etiketler) başlığın altına eklenir. */
export function ChoiceCard({
  icon,
  iconNode,
  accent,
  title,
  subtitle,
  stats,
  onPress,
  onInfo,
  hero = false,
  children,
}: {
  icon?: FeatherName;
  /** Feather yerine özel ikon (ör. SVG logo). */
  iconNode?: ReactNode;
  accent: string;
  title: string;
  /** Verilmezse alt açıklama satırı çizilmez (ör. lobi mod kartları — sade). */
  subtitle?: string;
  /** Verilirse kart altında iki canlı çip: "N BEKLİYOR" (kuyruk) + "M AKTİF MAÇ".
   *  0 olsa DA gösterilir (rakam hep görünür); undefined → çip yok (ör. Özel Oyun). */
  stats?: { waiting: number; active: number };
  onPress: () => void;
  /** Verilirse sağ-üst köşede "?" rozeti çıkar; bilgilendirme modalını açar
   *  (kartın onPress'ini tetiklemez — üstteki Pressable dokunuşu yakalar). */
  onInfo?: () => void;
  hero?: boolean;
  children?: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: withAlpha(accent, hero ? 0.13 : 0.1),
          borderColor: withAlpha(accent, 0.28),
          boxShadow: `0 0 ${hero ? 28 : 20}px ${withAlpha(accent, hero ? 0.16 : 0.08)}`,
        },
        pressed && styles.cardPressed,
      ]}>
      <Emblem icon={icon} iconNode={iconNode} accent={accent} size={66} iconSize={26} />
      <View style={styles.cardBody}>
        <Text style={[styles.cardTitle, hero && styles.cardTitleHero, { color: colors.text }]}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
        {stats ? (
          // Alt alta KAPSÜL çipler — kart sadeleşti (başlık + sayaçlar), dikey yer var.
          <View style={styles.statCol}>
            <View
              style={[
                styles.pill,
                { borderColor: withAlpha(accent, 0.28), backgroundColor: withAlpha(accent, 0.1) },
              ]}>
              <View
                style={[styles.pillDot, { backgroundColor: accent, boxShadow: `0 0 6px ${accent}` }]}
              />
              <Text style={[styles.pillNum, { color: accent }]}>{stats.waiting}</Text>
              <Text style={[styles.pillLabel, { color: withAlpha(accent, 0.85) }]}>{LBL_WAITING}</Text>
            </View>
            <View style={[styles.pill, styles.pillActive]}>
              <Feather name="play" size={9} color={colors.dim} />
              <Text style={[styles.pillNum, styles.pillNumActive]}>{stats.active}</Text>
              <Text style={styles.pillLabel}>{LBL_ACTIVE}</Text>
            </View>
          </View>
        ) : null}
        {children}
      </View>
      <Feather name="chevron-right" size={18} color={accent} style={{ opacity: 0.7 }} />

      {onInfo ? (
        <Pressable
          onPress={onInfo}
          hitSlop={10}
          style={[styles.infoBadge, { borderColor: withAlpha(accent, 0.5) }]}>
          <Feather name="help-circle" size={15} color={accent} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/** Baş harf taşıyan yuvarlak avatar (kendi = cyan, rakip = amber, boş = kesik çizgi). */
export function Avatar({
  initial,
  accent = colors.cyan,
  size = 50,
  empty = false,
}: {
  initial?: string;
  accent?: string;
  size?: number;
  empty?: boolean;
}) {
  if (empty) {
    return (
      <View
        style={[
          styles.avatar,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderStyle: 'dashed',
            borderColor: withAlpha(colors.dim, 0.4),
            backgroundColor: 'rgba(255,255,255,0.04)',
          },
        ]}>
        <Text style={[styles.avatarText, { color: withAlpha(colors.dim, 0.6), fontSize: size * 0.34 }]}>
          ?
        </Text>
      </View>
    );
  }
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: accent,
          backgroundColor: withAlpha(accent, 0.18),
          boxShadow: `0 0 14px ${withAlpha(accent, 0.45)}`,
        },
      ]}>
      <Text style={[styles.avatarText, { color: accent, fontSize: size * 0.36 }]}>
        {(initial || '?').toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  headerBack: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSide: {
    width: 38,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: colors.ice,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 3,
    textShadowColor: cyanAlpha(0.6),
    textShadowRadius: 10,
  },
  emblem: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emblemRing: {
    position: 'absolute',
    top: 5,
    left: 5,
    right: 5,
    bottom: 5,
    borderWidth: 1,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderWidth: 1,
    borderRadius: 22,
    padding: 20,
  } as ViewStyle,
  cardPressed: {
    transform: [{ scale: 0.99 }],
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  infoBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    backgroundColor: 'rgba(8,15,30,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
    gap: 5,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  cardTitleHero: {
    fontSize: 18,
    color: colors.ice,
    textShadowColor: colors.cyan,
    textShadowRadius: 12,
  },
  cardSubtitle: {
    fontSize: 11,
    color: colors.dim,
    lineHeight: 16,
  },
  statCol: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
    marginTop: 4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 2,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillActive: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: colors.glassBorder,
  },
  pillDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  pillNum: {
    fontFamily: mono,
    fontSize: 11,
    fontWeight: '800',
  },
  pillNumActive: {
    color: colors.ice,
  },
  pillLabel: {
    fontFamily: mono,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.3,
    color: colors.dim,
  },
  avatar: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontWeight: '800',
    fontFamily: mono,
  },
});
