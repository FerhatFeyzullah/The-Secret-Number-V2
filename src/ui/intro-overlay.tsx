import { useCallback, useEffect, useRef } from 'react';
import { Image, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/** Yayıncı (Vavizof Games) açılış intro'su — native splash sonrası bir kez gösterilir,
 *  ~2.5 sn'de menüye devreder. Logo zarifçe belirir (fade + hafif scale), kısa durur,
 *  sonra tüm overlay fade-out olup `onDone` çağrılır (menü altta hazır → sarsıntısız).
 *  Dokununca atlanır. Zemin logonun koyu charcoal'ı (#191A1B) → kenar/kutu görünmez,
 *  safe-area dahil tam kaplar. Navigasyon yığınını KİRLETMEZ (route değil, overlay). */
const LOGO = require('../../assets/images/vavizof-logo.png');
const BG = '#191A1B';
const HOLD_MS = 2300; // logo girişinden sonra bu süre + fade-out

/** Logo en-boy oranı (asset 1540×541). */
const LOGO_RATIO = 541 / 1540;

export function IntroOverlay({ onDone }: { onDone: () => void }) {
  // KESİN boyut: hem width HEM height verilir (sadece width+aspectRatio değil) →
  // Image asla intrinsic boyuta (1540px) düşüp ekranı taşamaz. Kutu = logonun
  // en-boy oranında; resizeMode contain → tam sığar, kesilmez, bozulmaz.
  const { width, height } = useWindowDimensions();
  const boxW = Math.min(width * 0.72, 400);
  const boxH = Math.min(boxW * LOGO_RATIO, height * 0.3);

  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue(0.92);
  const rootOpacity = useSharedValue(1);
  const finishedRef = useRef(false);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    rootOpacity.value = withTiming(0, { duration: 450, easing: Easing.in(Easing.cubic) }, (done) => {
      if (done) runOnJS(onDone)();
    });
  }, [onDone, rootOpacity]);

  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: 720, easing: Easing.out(Easing.cubic) });
    logoScale.value = withTiming(1, { duration: 820, easing: Easing.out(Easing.cubic) });
    const t = setTimeout(finish, HOLD_MS);
    return () => clearTimeout(t);
  }, [finish, logoOpacity, logoScale]);

  const rootStyle = useAnimatedStyle(() => ({ opacity: rootOpacity.value }));
  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));

  return (
    <Animated.View style={[styles.root, rootStyle]}>
      {/* Dokun → atla */}
      <Pressable style={StyleSheet.absoluteFill} onPress={finish} />
      <Animated.View style={logoStyle} pointerEvents="none">
        <Image source={LOGO} style={{ width: boxW, height: boxH }} resizeMode="contain" />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    elevation: 1000,
  },
});
