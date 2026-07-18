import { Feather } from '@expo/vector-icons';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Polygon } from 'react-native-svg';

import type { ClanEmblem } from '@/online';
import { colors, mono, withAlpha } from '@/ui/theme';
import { type FeatherName } from '../parts';

/** Amblem parçaları — hazır neon set (resim yükleme yok). */
export const EMBLEM_SHAPES = ['shield', 'hexagon', 'circle', 'diamond', 'pentagon'] as const;
export type EmblemShape = (typeof EMBLEM_SHAPES)[number];

export const EMBLEM_ICONS: FeatherName[] = [
  'hash', 'cpu', 'zap', 'shield', 'target', 'terminal',
  'radio', 'key', 'star', 'activity', 'lock', 'eye',
];

export const EMBLEM_COLORS: { id: string; hex: string }[] = [
  { id: 'cyan', hex: colors.cyan },
  { id: 'amber', hex: colors.amber },
  { id: 'teal', hex: colors.teal },
  { id: 'violet', hex: colors.violet },
  { id: 'ice', hex: colors.ice },
  { id: 'danger', hex: colors.danger },
  { id: 'success', hex: colors.success },
  { id: 'gold', hex: colors.gold },
];

export const DEFAULT_EMBLEM: ClanEmblem = { shape: 'shield', icon: 'hash', color: 'cyan' };

function colorHex(id: string): string {
  return EMBLEM_COLORS.find((c) => c.id === id)?.hex ?? colors.cyan;
}
function validShape(s: string): EmblemShape {
  return (EMBLEM_SHAPES as readonly string[]).includes(s) ? (s as EmblemShape) : 'shield';
}
function validIcon(i: string): FeatherName {
  return (EMBLEM_ICONS as string[]).includes(i) ? (i as FeatherName) : 'hash';
}

/** Amblem çerçevesi (SVG): vurgu renginde camsı dolgu + neon kenar. */
function ShapeSvg({ shape, hex, size }: { shape: EmblemShape; hex: string; size: number }) {
  const fill = withAlpha(hex, 0.16);
  const sw = 4;
  const common = { fill, stroke: hex, strokeWidth: sw, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {shape === 'circle' ? <Circle cx="50" cy="50" r="44" {...common} /> : null}
      {shape === 'hexagon' ? <Polygon points="50,5 91,27 91,73 50,95 9,73 9,27" {...common} /> : null}
      {shape === 'shield' ? (
        <Path d="M50 6 L88 19 V49 C88 76 50 93 50 93 C50 93 12 76 12 49 V19 Z" {...common} />
      ) : null}
      {shape === 'diamond' ? <Polygon points="50,5 95,50 50,95 5,50" {...common} /> : null}
      {shape === 'pentagon' ? <Polygon points="50,6 94,38 77,92 23,92 6,38" {...common} /> : null}
    </Svg>
  );
}

/** Klan amblemi — her yerde (kart, ana ekran, önizleme). */
export function ClanEmblemView({
  emblem,
  size = 64,
  glow = true,
}: {
  emblem: ClanEmblem | null;
  size?: number;
  glow?: boolean;
}) {
  const e = emblem ?? DEFAULT_EMBLEM;
  const hex = colorHex(e.color);
  return (
    <View
      style={[
        { width: size, height: size, alignItems: 'center', justifyContent: 'center' },
        glow ? { ...glowStyle(hex) } : null,
      ]}>
      <ShapeSvg shape={validShape(e.shape)} hex={hex} size={size} />
      <View style={styles.iconLayer} pointerEvents="none">
        <Feather name={validIcon(e.icon)} size={size * 0.38} color={hex} />
      </View>
    </View>
  );
}

function glowStyle(hex: string) {
  return Platform.select({
    ios: { shadowColor: hex, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
    default: {},
  });
}

/** Amblem oluşturucu: şekil + ikon + renk (canlı önizleme). */
export function EmblemBuilder({
  value,
  onChange,
}: {
  value: ClanEmblem;
  onChange: (e: ClanEmblem) => void;
}) {
  const hex = colorHex(value.color);
  return (
    <View style={styles.builder}>
      <ClanEmblemView emblem={value} size={92} />

      <Text style={styles.rowLabel}>ŞEKİL</Text>
      <View style={styles.row}>
        {EMBLEM_SHAPES.map((s) => (
          <Pressable
            key={s}
            onPress={() => onChange({ ...value, shape: s })}
            style={[styles.chip, value.shape === s && styles.chipActive]}>
            <ShapeSvg shape={s} hex={value.shape === s ? hex : colors.dim} size={26} />
          </Pressable>
        ))}
      </View>

      <Text style={styles.rowLabel}>İKON</Text>
      <View style={styles.rowWrap}>
        {EMBLEM_ICONS.map((ic) => (
          <Pressable
            key={ic}
            onPress={() => onChange({ ...value, icon: ic })}
            style={[styles.chip, value.icon === ic && styles.chipActive]}>
            <Feather name={ic} size={18} color={value.icon === ic ? hex : colors.dim} />
          </Pressable>
        ))}
      </View>

      <Text style={styles.rowLabel}>RENK</Text>
      <View style={styles.rowWrap}>
        {EMBLEM_COLORS.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => onChange({ ...value, color: c.id })}
            style={[
              styles.colorDot,
              { backgroundColor: withAlpha(c.hex, 0.9), borderColor: c.hex },
              value.color === c.id && styles.colorDotActive,
            ]}>
            {value.color === c.id ? <Feather name="check" size={14} color={colors.bgTop} /> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  iconLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  builder: {
    alignItems: 'center',
    gap: 10,
  },
  rowLabel: {
    alignSelf: 'flex-start',
    fontFamily: mono,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    color: colors.dim,
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    alignSelf: 'stretch',
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignSelf: 'stretch',
  },
  chip: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  chipActive: {
    borderColor: colors.cyan,
    backgroundColor: withAlpha(colors.cyan, 0.12),
  },
  colorDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  colorDotActive: {
    transform: [{ scale: 1.12 }],
  },
});
