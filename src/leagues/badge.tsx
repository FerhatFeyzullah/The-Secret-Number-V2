import { StyleSheet, Text, View } from 'react-native';

import { mono } from '../ui/theme';
import { leagueForRating } from './catalog';
import { LeagueIcon } from './icons';

/** Görünür lig rozeti: kademe ikonu (+ ad). Kupa'dan (rating) türetilir →
 *  ana ekran, profil ve lider tablosunda tutarlı. `showName=false` ile yalnız
 *  ikon (dar yerler/liste). */
export function LeagueBadge({
  rating,
  size = 20,
  showName = true,
  animated = false,
}: {
  rating: number;
  size?: number;
  showName?: boolean;
  animated?: boolean;
}) {
  const lg = leagueForRating(rating);
  return (
    <View style={styles.row}>
      <LeagueIcon league={lg.key} size={size} animated={animated} />
      {showName ? (
        <Text style={[styles.name, { color: lg.color, fontSize: Math.max(11, size * 0.52) }]}>
          {lg.name}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  name: {
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 0.5,
  },
});
