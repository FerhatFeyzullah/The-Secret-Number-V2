import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { TowerFloorConfig, TowerState } from '@/online';
import { Emblem } from '../parts';
import { colors, mono, withAlpha } from '@/ui/theme';
import { TowerLogo } from '@/ui/tower-logo';
import { TOWER_TWISTS, towerItemLabel } from './twists';

/** Dönemin kalan süresini "3g 4s" biçiminde. */
export function useCountdown(endsAt: string | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  if (!endsAt) return '';
  const ms = new Date(endsAt).getTime() - now;
  if (ms <= 0) return 'bitiyor';
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return d > 0 ? `${d}g ${h}s` : h > 0 ? `${h}s ${m}dk` : `${m}dk`;
}

function FloorRow({
  floor,
  currentFloor,
  cleared,
  active,
}: {
  floor: TowerFloorConfig;
  currentFloor: number | null;
  cleared: boolean;
  active: boolean;
}) {
  const isCurrent = currentFloor === floor.floorNo;
  const accent = floor.isBoss ? colors.gold : isCurrent ? colors.cyan : colors.dim;
  return (
    <View
      style={[
        styles.floorRow,
        { borderColor: withAlpha(accent, isCurrent ? 0.55 : 0.2) },
        isCurrent && active && { backgroundColor: withAlpha(colors.cyan, 0.08) },
        cleared && styles.floorCleared,
      ]}>
      <View style={[styles.floorNo, { borderColor: withAlpha(accent, 0.5), backgroundColor: withAlpha(accent, 0.12) }]}>
        {cleared ? (
          <Feather name="check" size={16} color={colors.success} />
        ) : (
          <Text style={[styles.floorNoText, { color: accent }]}>{floor.floorNo}</Text>
        )}
      </View>

      <View style={styles.floorMid}>
        <View style={styles.floorTitleRow}>
          <Text style={[styles.floorTitle, floor.isBoss && { color: colors.gold }]}>
            {floor.isBoss ? (floor.floorNo === 10 ? 'FİNAL BOSS' : 'BOSS') : `Kat ${floor.floorNo}`}
          </Text>
          <Text style={styles.floorLen}>{floor.wordLength} harf</Text>
        </View>
        <View style={styles.twistRow}>
          {floor.twists.length === 0 ? (
            <Text style={styles.noTwist}>— düz</Text>
          ) : (
            floor.twists.map((t, i) => {
              const meta = TOWER_TWISTS[t.kind];
              return (
                <Text key={i} style={styles.twistChip}>
                  {meta?.emoji} {meta?.name}
                </Text>
              );
            })
          )}
        </View>
      </View>

      <View style={styles.floorReward}>
        <Text style={styles.rewardVeri}>+{floor.veriReward}</Text>
        <Text style={styles.rewardVeriLabel}>Veri</Text>
        {floor.itemPreview ? (
          <Text style={styles.rewardItem} numberOfLines={1}>
            🎁 {towerItemLabel(floor.itemPreview.kind, floor.itemPreview.id)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Gizemli Kule merdiveni: dönem geri sayımı, canlar, 10 kat, giriş/devam CTA. */
export function TowerLadder({
  state,
  busy,
  onEnter,
  onContinue,
  onBack,
}: {
  state: TowerState;
  busy: boolean;
  onEnter: () => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const countdown = useCountdown(state.period.endsAt);
  const run = state.run;
  const active = run?.status === 'active';
  const floorsTop = [...state.floors].sort((a, b) => b.floorNo - a.floorNo); // 10 → 1

  // CTA durumu.
  let cta: { label: string; onPress?: () => void; accent: string; disabled?: boolean };
  if (active) {
    cta = { label: `Devam Et · Kat ${run!.currentFloor}`, onPress: onContinue, accent: colors.cyan };
  } else if (run?.status === 'cleared') {
    cta = { label: '🏆 Bu hafta tamamlandı', accent: colors.gold, disabled: true };
  } else if (run?.status === 'eliminated') {
    cta = { label: 'Bu hafta elendin — gelecek hafta', accent: colors.danger, disabled: true };
  } else {
    cta = { label: 'Giriş · 300 Veri', onPress: onEnter, accent: colors.amber };
  }

  return (
    <View style={styles.wrap}>
      <Pressable onPress={onBack} hitSlop={10} style={styles.backBtn}>
        <Feather name="chevron-left" size={18} color={colors.text} />
      </Pressable>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Emblem iconNode={<TowerLogo size={34} color={colors.gold} />} accent={colors.gold} size={64} />
          <Text style={styles.heroTitle}>GİZEMLİ KULE</Text>
          <Text style={styles.heroSub}>{'10 kat, 3 can. Boss’un gizli kelimesini süre bitmeden çöz.'}</Text>
        </View>

        <View style={styles.statsRow}>
          {countdown ? (
            <View style={styles.chip}>
              <Feather name="clock" size={13} color={colors.cyan} />
              <Text style={styles.chipText}>{countdown}</Text>
            </View>
          ) : null}
          {active ? (
            <View style={styles.hearts}>
              {[0, 1, 2].map((i) => (
                <Feather
                  key={i}
                  name="heart"
                  size={16}
                  color={i < run!.lives ? colors.danger : withAlpha(colors.dim, 0.3)}
                />
              ))}
            </View>
          ) : null}
        </View>

        {run ? (
          <View style={styles.progressWrap}>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${(run.floorsCleared / 10) * 100}%` }]} />
            </View>
            <Text style={styles.progressText}>{run.floorsCleared}/10 kat</Text>
          </View>
        ) : null}

        <View style={styles.ladder}>
          {floorsTop.map((f) => (
            <FloorRow
              key={f.floorNo}
              floor={f}
              currentFloor={run?.currentFloor ?? null}
              cleared={!!run && f.floorNo <= run.floorsCleared}
              active={active}
            />
          ))}
        </View>
      </ScrollView>

      <Pressable
        onPress={cta.onPress}
        disabled={cta.disabled || busy || !cta.onPress}
        style={[
          styles.cta,
          { borderColor: withAlpha(cta.accent, 0.5), backgroundColor: withAlpha(cta.accent, 0.14) },
          (cta.disabled || busy) && styles.ctaDisabled,
        ]}>
        <Text style={[styles.ctaText, { color: cta.accent }]}>{cta.label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  backBtn: {
    position: 'absolute', top: 2, left: 0, zIndex: 10,
    width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder,
  },
  scroll: { paddingBottom: 18, gap: 12 },
  hero: { alignItems: 'center', gap: 8, paddingTop: 10 },
  heroTitle: {
    fontFamily: mono, fontSize: 22, fontWeight: '900', letterSpacing: 3, color: colors.ice,
    textShadowColor: colors.gold, textShadowRadius: 14,
  },
  heroSub: { textAlign: 'center', color: colors.dim, fontSize: 12.5, lineHeight: 18, maxWidth: 290 },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 11,
    borderRadius: 999, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder,
  },
  chipText: { color: colors.text, fontFamily: mono, fontSize: 12, fontWeight: '700' },
  hearts: { flexDirection: 'row', gap: 3, alignItems: 'center' },
  progressWrap: { gap: 4 },
  progressBar: { height: 6, borderRadius: 3, backgroundColor: withAlpha(colors.dim, 0.18), overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: colors.success },
  progressText: { color: colors.dim, fontFamily: mono, fontSize: 10, textAlign: 'right' },
  ladder: { gap: 7 },
  floorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11, padding: 10, borderRadius: 14,
    borderWidth: 1, backgroundColor: colors.glass,
  },
  floorCleared: { opacity: 0.55 },
  floorNo: {
    width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  floorNoText: { fontFamily: mono, fontSize: 15, fontWeight: '900' },
  floorMid: { flex: 1, gap: 3 },
  floorTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  floorTitle: { color: colors.text, fontFamily: mono, fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  floorLen: { color: colors.dim, fontSize: 11, fontFamily: mono },
  twistRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  noTwist: { color: withAlpha(colors.dim, 0.6), fontSize: 11 },
  twistChip: { color: colors.violet, fontSize: 11, fontWeight: '600' },
  floorReward: { alignItems: 'flex-end', gap: 0, minWidth: 56 },
  rewardVeri: { color: colors.amber, fontFamily: mono, fontSize: 15, fontWeight: '900' },
  rewardVeriLabel: { color: withAlpha(colors.amber, 0.7), fontSize: 9, fontFamily: mono, marginTop: -2 },
  rewardItem: { color: colors.gold, fontSize: 10, maxWidth: 92, marginTop: 2 },
  cta: {
    marginTop: 8, paddingVertical: 15, borderRadius: 14, borderWidth: 1, alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { fontFamily: mono, fontSize: 15, fontWeight: '900', letterSpacing: 1 },
});
