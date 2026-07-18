import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { Screen, TAB_EDGES } from './screen';
import { colors, mono, withAlpha } from './theme';

type FeatherName = keyof typeof Feather.glyphMap;

/** Sekme yer tutucusu: büyük amblem + "YAKINDA" rozeti + başlık + açıklama.
 *  Klan/Turnuva gibi henüz içeriği netleşmemiş sekmeler için ortak ekran. */
export function ComingSoon({
  icon,
  title,
  subtitle,
  accent = colors.cyan,
}: {
  icon: FeatherName;
  title: string;
  subtitle: string;
  accent?: string;
}) {
  return (
    <Screen edges={TAB_EDGES}>
      <View style={styles.center}>
        <View
          style={[
            styles.emblem,
            {
              borderColor: withAlpha(accent, 0.5),
              backgroundColor: withAlpha(accent, 0.14),
              shadowColor: accent,
            },
          ]}>
          <Feather name={icon} size={42} color={accent} />
        </View>
        <View style={[styles.chip, { borderColor: withAlpha(accent, 0.4), backgroundColor: withAlpha(accent, 0.1) }]}>
          <Text style={[styles.chipText, { color: accent }]}>YAKINDA</Text>
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  emblem: {
    width: 96,
    height: 96,
    borderRadius: 28,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.35,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  chip: {
    paddingVertical: 4,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: {
    fontFamily: mono,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
  },
  title: {
    fontFamily: mono,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2,
    color: colors.ice,
    textShadowColor: colors.cyan,
    textShadowRadius: 14,
  },
  subtitle: {
    textAlign: 'center',
    color: colors.dim,
    fontSize: 14,
    lineHeight: 21,
    maxWidth: 280,
  },
});
