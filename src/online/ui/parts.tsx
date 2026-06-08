import { Feather } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';

export type FeatherName = keyof typeof Feather.glyphMap;

/** Lobi alt-ekran başlığı: geri ok callback ile (durum makinesinde faz-geri
 *  ya da route'tan çıkış için). ScreenHeader router.back() yaptığından burada
 *  ayrı bir başlık kullanıyoruz. */
export function LobbyHeader({ title, onBack }: { title: string; onBack?: () => void }) {
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
      <View style={styles.headerSide} />
    </View>
  );
}

/** Yuvarlatılmış kare amblem: vurgu renginde camsı zemin, iç halka ve glow.
 *  Tasarımdaki kart/giriş ikonu emblemlerinin RN karşılığı. */
export function Emblem({
  icon,
  accent,
  size = 66,
  iconSize = 28,
  fillIcon = false,
}: {
  icon: FeatherName;
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
      <Feather
        name={icon}
        size={iconSize}
        color={accent}
        style={fillIcon ? { textShadowColor: accent, textShadowRadius: 8 } : undefined}
      />
    </View>
  );
}

/** Lobi/özel seçimdeki büyük seçim kartı: emblem + başlık + alt metin + chevron.
 *  İsteğe bağlı `children` (ör. çevrimiçi rozeti/etiketler) başlığın altına eklenir. */
export function ChoiceCard({
  icon,
  accent,
  title,
  subtitle,
  onPress,
  onInfo,
  hero = false,
  children,
}: {
  icon: FeatherName;
  accent: string;
  title: string;
  subtitle: string;
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
      <Emblem icon={icon} accent={accent} size={hero ? 72 : 66} iconSize={hero ? 30 : 26} />
      <View style={styles.cardBody}>
        <Text style={[styles.cardTitle, hero && styles.cardTitleHero, { color: colors.text }]}>
          {title}
        </Text>
        <Text style={styles.cardSubtitle}>{subtitle}</Text>
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
