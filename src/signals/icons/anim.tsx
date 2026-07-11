import { useEffect, useId, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

/** Sinyal hareketi türü — karaktere uygun, hafif/döngüsel. Tümü View seviyesinde
 *  (reanimated, native thread) → SVG içi animasyon yok, performanslı. */
export type Motion =
  | 'none'
  | 'pulse' // nabız (ölçek) — zafer/hedef
  | 'breathe' // yumuşak nefes (ölçek) — varsayılan
  | 'sway' // hafif sağa-sola dönme — kahkaha/şanslı
  | 'shake' // titreme — sinirli/şoke
  | 'rotate' // yavaş tam dönüş — kar tanesi
  | 'flicker' // alev titreşimi (scaleY) — ateş
  | 'bob' // hafif yukarı-aşağı
  | 'blink' // opaklık açıl-kapan — düşünce "?"/ampul
  | 'tear' // damla düşüşü (aşağı + sönme, döngü)
  | 'clapL' // alkış sol el (merkeze)
  | 'clapR'; // alkış sağ el (merkeze)

const DUR: Record<Motion, number> = {
  none: 0,
  pulse: 1500,
  breathe: 2600,
  sway: 2400,
  shake: 820,
  rotate: 9000,
  flicker: 760,
  bob: 2200,
  blink: 1500,
  tear: 1700,
  clapL: 560,
  clapR: 560,
};

// Sürekli (yoyo olmayan) hareketler — dönüş ve damla baştan başlar.
const ONE_WAY: Motion[] = ['rotate', 'tear'];

function useMotionStyle(kind: Motion, animated: boolean) {
  const v = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(v);
    v.value = 0;
    if (!animated || kind === 'none') return;
    const easing = kind === 'rotate' || kind === 'tear' ? Easing.linear : Easing.inOut(Easing.ease);
    v.value = withRepeat(withTiming(1, { duration: DUR[kind] || 2000, easing }), -1, !ONE_WAY.includes(kind));
    return () => cancelAnimation(v);
  }, [animated, kind, v]);

  return useAnimatedStyle(() => {
    switch (kind) {
      case 'pulse':
        return { transform: [{ scale: 0.97 + v.value * 0.08 }] };
      case 'breathe':
        return { transform: [{ scale: 0.97 + v.value * 0.05 }] };
      case 'sway':
        return { transform: [{ rotate: `${v.value * 8 - 4}deg` }] };
      case 'shake':
        return { transform: [{ translateX: v.value * 8 - 4 }, { rotate: `${v.value * 4 - 2}deg` }] };
      case 'rotate':
        return { transform: [{ rotate: `${v.value * 360}deg` }] };
      case 'flicker':
        return { transform: [{ scaleY: 0.9 + v.value * 0.16 }, { translateY: 3 - v.value * 6 }] };
      case 'bob':
        return { transform: [{ translateY: v.value * 6 - 3 }] };
      case 'blink':
        return { opacity: 0.25 + v.value * 0.75 };
      case 'tear':
        return { transform: [{ translateY: v.value * 48 }], opacity: v.value < 0.75 ? 1 : 1 - (v.value - 0.75) / 0.25 };
      case 'clapL':
        return { transform: [{ translateX: v.value * 9 }] };
      case 'clapR':
        return { transform: [{ translateX: -v.value * 9 }] };
      default:
        return {};
    }
  });
}

/** Statik katman: reanimated hook'ları HİÇ çalışmaz. Mağaza gibi ~30 statik ikon
 *  render eden ekranlarda katman başına birkaç shared value + animated style
 *  kurulumundan kaçınır (açılış takılması azalır). */
function StillLayer({ size, children }: { size: number; children: ReactNode }) {
  return (
    <View style={{ position: 'absolute', width: size, height: size }} pointerEvents="none">
      <Svg width={size} height={size} viewBox="0 0 256 256" fill="none">
        {children}
      </Svg>
    </View>
  );
}

/** Hareketli katman: reanimated shared value + animated style yalnız BURADA. */
function MotionLayer({ size, motion, children }: { size: number; motion: Motion; children: ReactNode }) {
  const style = useMotionStyle(motion, true);
  return (
    <Animated.View style={[{ position: 'absolute', width: size, height: size }, style]} pointerEvents="none">
      <Svg width={size} height={size} viewBox="0 0 256 256" fill="none">
        {children}
      </Svg>
    </Animated.View>
  );
}

/** Tek bir SVG katmanı (256 viewBox). Statikse (animated=false ya da motion='none')
 *  hook'suz StillLayer; aksi halde View seviyesinde animasyonlu MotionLayer.
 *  Katmanlar üst üste (absolute) bindirilip kayıt korunur. */
export function Layer({
  size = 64,
  animated = false,
  motion = 'none',
  children,
}: {
  size?: number;
  animated?: boolean;
  motion?: Motion;
  children: ReactNode;
}) {
  if (!animated || motion === 'none') return <StillLayer size={size}>{children}</StillLayer>;
  return (
    <MotionLayer size={size} motion={motion}>
      {children}
    </MotionLayer>
  );
}

/** Halo radyal gradyanı (SVG) — statik/hareketli iki Glow da bunu kullanır. */
function GlowSvg({ size, color }: { size: number; color: string }) {
  const rid = useId().replace(/:/g, '');
  return (
    <Svg width={size} height={size} viewBox="0 0 256 256">
      <Defs>
        <RadialGradient id={`glow${rid}`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity="0.6" />
          <Stop offset="0.6" stopColor={color} stopOpacity="0.18" />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx="128" cy="128" r="124" fill={`url(#glow${rid})`} />
    </Svg>
  );
}

/** Statik halo: reanimated hook'ları YOK (sabit opaklık 0.55). */
function StillGlow({ size, color }: { size: number; color: string }) {
  return (
    <View style={{ position: 'absolute', width: size, height: size, opacity: 0.55 }} pointerEvents="none">
      <GlowSvg size={size} color={color} />
    </View>
  );
}

/** Hareketli halo: nabız (opaklık + ölçek); shared value + animated style burada. */
function MotionGlow({ size, color }: { size: number; color: string }) {
  const v = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(v);
    v.value = 0;
    v.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(v);
  }, [v]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.45 + v.value * 0.4,
    transform: [{ scale: 0.92 + v.value * 0.16 }],
  }));
  return (
    <Animated.View style={[{ position: 'absolute', width: size, height: size }, style]} pointerEvents="none">
      <GlowSvg size={size} color={color} />
    </Animated.View>
  );
}

/** Neon halo (radyal gradyan) — derinlik + parlama. animated iken nabız atar;
 *  statikken hook'suz StillGlow (mağazada ~30 statik ikon için tasarruf). */
export function Glow({ size = 64, color, animated = false }: { size?: number; color: string; animated?: boolean }) {
  return animated ? (
    <MotionGlow size={size} color={color} />
  ) : (
    <StillGlow size={size} color={color} />
  );
}

/** İkon kabı: glow + katmanları size kutusunda üst üste bindirir. */
export function Shell({ size = 64, children }: { size?: number; children: ReactNode }) {
  return <View style={{ width: size, height: size }}>{children}</View>;
}
