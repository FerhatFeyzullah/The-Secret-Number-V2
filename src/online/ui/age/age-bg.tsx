import { type ReactNode, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, Path, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';

/** Gizem Çağı ortak arka planı: koyu mavi radial + köşe vinyeti. Hex deseni
 *  yalnız `hex` verildiğinde (bekleme/eşleşme ekranı) çizilir — harita ekranlarında
 *  düğüm/çizgi clutter'ıyla karıştığı için kapalı. Tüm Gizem Çağı ekranları bunu
 *  sarar (uygulamanın FloatingDigits'i yerine — moda özgü kimlik).
 *
 *  Android notu: <Svg> yalnız absoluteFill stiliyle boyutlanınca Android ölçülen
 *  boyut alamıyor → %'lik Rect'ler 0'a çöküp hiçbir şey çizmiyor (iOS tolere eder).
 *  Bu yüzden konteyner onLayout ile ölçülür, SVG'ye sayısal boyut verilir ve
 *  gradient'ler userSpaceOnUse + stopOpacity ile yazılır (rgba alfa Android'de flaky).
 *  Hex de bu ölçülü SVG sayesinde artık iki platformda da görünür. */
export function AgeBackground({ children, hex = false }: { children: ReactNode; hex?: boolean }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  };
  const { w, h } = size;
  return (
    <View style={styles.root} onLayout={onLayout}>
      {w > 0 && h > 0 ? (
        <Svg
          style={StyleSheet.absoluteFill}
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          pointerEvents="none"
        >
          <Defs>
            <RadialGradient
              id="ageBg"
              cx={w * 0.5}
              cy={h * 0.08}
              rx={w * 1.3}
              ry={h * 0.9}
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="0%" stopColor="#12224a" />
              <Stop offset="34%" stopColor="#0e1d3e" />
              <Stop offset="78%" stopColor="#0a1526" />
              <Stop offset="100%" stopColor="#070f22" />
            </RadialGradient>
            <RadialGradient
              id="ageVig"
              cx={w * 0.5}
              cy={h * 0.44}
              rx={w * 0.9}
              ry={h * 0.6}
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="42%" stopColor="#060c1a" stopOpacity={0} />
              <Stop offset="100%" stopColor="#060c1a" stopOpacity={0.5} />
            </RadialGradient>
            {hex ? (
              <Pattern id="ageHex" width={46} height={40} patternUnits="userSpaceOnUse">
                <Path
                  d="M11.5 0 L34.5 0 L46 20 L34.5 40 L11.5 40 L0 20 Z"
                  fill="none"
                  stroke="rgba(120,170,230,0.14)"
                  strokeWidth={1}
                />
              </Pattern>
            ) : null}
          </Defs>
          <Rect x={0} y={0} width={w} height={h} fill="url(#ageBg)" />
          {hex ? <Rect x={0} y={0} width={w} height={h} fill="url(#ageHex)" opacity={0.5} /> : null}
          <Rect x={0} y={0} width={w} height={h} fill="url(#ageVig)" />
        </Svg>
      ) : null}
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
