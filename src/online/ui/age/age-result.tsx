import { Feather } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { AgeState } from '@/online';
import { colors, mono, withAlpha } from '@/ui/theme';
import { AGE, ageColors } from './age-colors';
import { AgeCrown } from './age-icons';

const MEDAL = ['#f5c451', '#cdd6e4', '#d08a52'];
const MEDAL_DARK = ['#a9781c', '#8b96a8', '#8a5326'];
const ROMAN = ['I', 'II', 'III'];
const VERDICT: Record<number, { t: string; s: string }> = {
  1: { t: 'ÇAĞIN HÜKÜMDARI', s: 'Diyar senin oldu — üç hükümdardan son ayakta kalan sensin.' },
  2: { t: 'İKİNCİ SIRA', s: 'Taht elinden kaydı, ama savaşın onuru sende kaldı.' },
  3: { t: 'ÜÇÜNCÜ SIRA', s: 'Toprakların düştü. Bu çağ bir başkasının oldu.' },
};

/** Gizem Çağı sonuç ekranı: senin dereceni öne çıkarır + üç hükümdar sıralaması. */
export function AgeResult({
  state,
  onRequeue,
  onMenu,
}: {
  state: AgeState;
  onRequeue: () => void;
  onMenu: () => void;
}) {
  const colorMap = ageColors(state.players, state.me);
  const byId = Object.fromEntries(state.players.map((p) => [p.player, p]));
  const ranking = [...state.ranking].sort((a, b) => a.rank - b.rank);
  const mine = ranking.find((r) => r.player === state.me);
  const myRank = mine?.rank ?? 3;
  const meName = byId[state.me]?.username ?? 'Sen';
  const rankColor = MEDAL[myRank - 1];

  // Kale/kule sayısı: territories'ten sahip bazında.
  const holdings = (pid: string) => {
    const owned = state.territories.filter((t) => t.owner === pid);
    return {
      castles: owned.filter((t) => t.kind === 'castle').length,
      towers: owned.filter((t) => t.kind === 'tower').length,
    };
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <Text style={styles.cap}>GİZEM ÇAĞI · SONUÇ</Text>

      <View style={styles.hero}>
        {myRank === 1 ? <AgeCrown size={52} /> : null}
        <Text style={[styles.name, { color: colorMap[state.me] ?? AGE.blue }]} numberOfLines={1}>
          {meName}
        </Text>
        <Text style={[styles.verdict, { color: rankColor }]}>{VERDICT[myRank].t}</Text>
        <Text style={styles.sub}>{VERDICT[myRank].s}</Text>

        <View style={styles.reward}>
          <View style={[styles.rchip, { borderColor: withAlpha(mine && mine.kupaDelta >= 0 ? colors.gold : colors.danger, 0.4) }]}>
            <Feather name="award" size={14} color={mine && mine.kupaDelta >= 0 ? colors.gold : colors.danger} />
            <Text style={[styles.rchipText, { color: mine && mine.kupaDelta >= 0 ? colors.gold : colors.danger }]}>
              {mine && mine.kupaDelta >= 0 ? '+' : ''}{mine?.kupaDelta ?? 0} kupa
            </Text>
          </View>
          {mine && mine.veriDelta > 0 ? (
            <View style={[styles.rchip, { borderColor: withAlpha(colors.teal, 0.4) }]}>
              <Feather name="hexagon" size={14} color={colors.teal} />
              <Text style={[styles.rchipText, { color: colors.teal }]}>+{mine.veriDelta} Veri</Text>
            </View>
          ) : null}
        </View>
      </View>

      <Text style={styles.rankLab}>SIRALAMA</Text>
      <View style={styles.rows}>
        {ranking.map((r) => {
          const p = byId[r.player];
          const h = holdings(r.player);
          const c = colorMap[r.player] ?? AGE.gray;
          const you = r.player === state.me;
          return (
            <View key={r.player} style={[styles.row, you && styles.rowYou]}>
              <View style={[styles.medal, { backgroundColor: MEDAL[r.rank - 1], borderColor: MEDAL_DARK[r.rank - 1] }]}>
                <Text style={styles.medalText}>{ROMAN[r.rank - 1]}</Text>
              </View>
              <View style={[styles.crest, { backgroundColor: c }]}>
                <Text style={styles.crestText}>{(p?.username?.charAt(0) || '?').toUpperCase()}</Text>
              </View>
              <View style={styles.info}>
                <View style={styles.nameRow}>
                  <Text style={styles.rname} numberOfLines={1}>{p?.username ?? 'Oyuncu'}</Text>
                  {you ? <Text style={styles.youTag}>SEN</Text> : null}
                </View>
                <Text style={styles.hold}>{h.castles} kale · {h.towers} kule</Text>
              </View>
              <View style={styles.rrew}>
                <Text style={[styles.rk, { color: r.kupaDelta >= 0 ? colors.gold : colors.danger }]}>
                  {r.kupaDelta >= 0 ? '+' : ''}{r.kupaDelta}
                </Text>
                <Text style={[styles.rv, { color: r.veriDelta > 0 ? colors.teal : colors.dim }]}>◈ {r.veriDelta}</Text>
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.foot}>
        <Pressable onPress={onRequeue} style={[styles.btn, styles.btnPrimary]}>
          <Text style={styles.btnTextPrimary}>Yeniden Kuyruğa Gir</Text>
        </Pressable>
        <Pressable onPress={onMenu} style={styles.btn}>
          <Text style={styles.btnText}>Ana Menü</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingVertical: 24, paddingHorizontal: 18, gap: 4, flexGrow: 1 },
  cap: { fontFamily: mono, fontSize: 10, letterSpacing: 4, color: colors.dim, textAlign: 'center', textTransform: 'uppercase' },
  hero: { alignItems: 'center', gap: 6, marginTop: 10, marginBottom: 8 },
  name: { fontFamily: 'Comfortaa-SemiBold', fontSize: 32 },
  verdict: { fontFamily: mono, fontSize: 12, letterSpacing: 3, fontWeight: '800' },
  sub: { color: colors.dim, fontSize: 13, textAlign: 'center', lineHeight: 19, maxWidth: 300, marginTop: 4, fontFamily: 'Comfortaa' },
  reward: { flexDirection: 'row', gap: 10, marginTop: 14 },
  rchip: {
    flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 999, borderWidth: 1, backgroundColor: colors.glass,
  },
  rchipText: { fontFamily: mono, fontSize: 13, fontWeight: '800' },
  rankLab: { fontFamily: mono, fontSize: 10, letterSpacing: 2.5, color: colors.dim, marginTop: 22, marginBottom: 10 },
  rows: { gap: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 12,
    borderRadius: 14, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder,
  },
  rowYou: { borderColor: withAlpha(AGE.blue, 0.55), backgroundColor: withAlpha(AGE.blue, 0.08) },
  medal: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5,
  },
  medalText: { fontFamily: mono, fontSize: 11, fontWeight: '900', color: '#0a1526' },
  crest: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  crestText: { fontFamily: mono, fontSize: 15, fontWeight: '800', color: '#0a1526' },
  info: { flex: 1, minWidth: 0, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  rname: { fontFamily: mono, fontSize: 14, fontWeight: '700', color: colors.ice, flexShrink: 1 },
  youTag: {
    fontFamily: mono, fontSize: 9, letterSpacing: 1, color: AGE.blue,
    borderWidth: 1, borderColor: withAlpha(AGE.blue, 0.45), borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1,
  },
  hold: { fontFamily: mono, fontSize: 11, color: colors.dim },
  rrew: { alignItems: 'flex-end' },
  rk: { fontFamily: mono, fontSize: 13, fontWeight: '800' },
  rv: { fontFamily: mono, fontSize: 11 },
  foot: { flexDirection: 'row', gap: 10, marginTop: 'auto', paddingTop: 22 },
  btn: {
    flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 14, borderWidth: 1,
    borderColor: colors.glassBorder, backgroundColor: colors.glass,
  },
  btnText: { fontFamily: mono, fontSize: 12.5, fontWeight: '800', color: colors.text, letterSpacing: 0.5, textTransform: 'uppercase' },
  btnPrimary: { borderColor: withAlpha(AGE.blue, 0.55), backgroundColor: withAlpha(AGE.blue, 0.2) },
  btnTextPrimary: { fontFamily: mono, fontSize: 12.5, fontWeight: '800', color: colors.ice, letterSpacing: 0.5, textTransform: 'uppercase' },
});
