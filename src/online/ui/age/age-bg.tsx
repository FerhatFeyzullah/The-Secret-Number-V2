import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, Path, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';

/** Gizem Çağı ortak arka planı (artifact stili): koyu mavi radial + hex desen +
 *  köşe vinyeti. Kor parçacıkları KALDIRILDI (istenmedi). Tüm Gizem Çağı
 *  ekranları bunu sarar (uygulamanın FloatingDigits'i yerine — moda özgü kimlik). */
export function AgeBackground({ children }: { children: ReactNode }) {
  return (
    <View style={styles.root}>
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="ageBg" cx="50%" cy="8%" rx="130%" ry="90%">
            <Stop offset="0%" stopColor="#12224a" />
            <Stop offset="34%" stopColor="#0e1d3e" />
            <Stop offset="78%" stopColor="#0a1526" />
            <Stop offset="100%" stopColor="#070f22" />
          </RadialGradient>
          <RadialGradient id="ageVig" cx="50%" cy="44%" rx="90%" ry="60%">
            <Stop offset="42%" stopColor="rgba(6,12,26,0)" />
            <Stop offset="100%" stopColor="rgba(6,12,26,0.5)" />
          </RadialGradient>
          <Pattern id="ageHex" width={46} height={40} patternUnits="userSpaceOnUse">
            <Path
              d="M11.5 0 L34.5 0 L46 20 L34.5 40 L11.5 40 L0 20 Z"
              fill="none"
              stroke="rgba(120,170,230,0.14)"
              strokeWidth={1}
            />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#ageBg)" />
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#ageHex)" opacity={0.5} />
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#ageVig)" />
      </Svg>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        {children}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a1526' },
  safe: { flex: 1 },
});
