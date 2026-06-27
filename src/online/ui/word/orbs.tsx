import { StyleSheet, View } from 'react-native';

import { withAlpha } from '@/ui/theme';

/** Tasarımdaki radyal glow orb'un RN yaklaşıması: iç içe yumuşayan halkalar.
 *  (RN'de radial-gradient yok; üç katmanlı dairesel saydamlık aynı hissi verir.) */
function Orb({
  size,
  color,
  opacity,
  style,
}: {
  size: number;
  color: string;
  opacity: number;
  style: object;
}) {
  return (
    <View pointerEvents="none" style={[styles.orb, { width: size, height: size }, style]}>
      <View style={[styles.fill, { borderRadius: size / 2, backgroundColor: withAlpha(color, opacity * 0.35) }]} />
      <View
        style={[
          styles.fill,
          {
            margin: size * 0.18,
            borderRadius: size / 2,
            backgroundColor: withAlpha(color, opacity * 0.5),
          },
        ]}
      />
      <View
        style={[
          styles.fill,
          {
            margin: size * 0.34,
            borderRadius: size / 2,
            backgroundColor: withAlpha(color, opacity * 0.6),
          },
        ]}
      />
    </View>
  );
}

/** Kelime ekranlarının arka plan orb'ları (tasarım: sol-üst cyan + sağ-alt amber). */
export function WordOrbs({ amberBottom = 120 }: { amberBottom?: number }) {
  return (
    <>
      <Orb size={220} color="#2FA8E0" opacity={0.2} style={{ top: -60, left: -40 }} />
      <Orb size={180} color="#FBBF24" opacity={0.15} style={{ bottom: amberBottom, right: -50 }} />
    </>
  );
}

const styles = StyleSheet.create({
  orb: {
    position: 'absolute',
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
});
