import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { isOnline } from '@/net';
import { ageFindMatch, OnlineError, type AgeKind, type AgePlayer, type AgeState, type AgeTerritory } from '@/online';
import { markSeen } from '@/storage';
import { colors, mono, withAlpha } from '@/ui/theme';
import { AgeBackground } from './age-bg';
import { AGE } from './age-colors';
import { AgeMap } from './age-map';

/* ── Örnek harita (statik; sunucu yok) — adımların işaret ettiği görseller ── */
const ME = 'me', RED = 'p2', GREEN = 'p3';
const PLAYERS: AgePlayer[] = [
  { player: ME, slot: 0, username: 'Sen', eliminated: false, territories: 0 },
  { player: RED, slot: 1, username: 'Bora', eliminated: false, territories: 0 },
  { player: GREEN, slot: 2, username: 'Derya', eliminated: false, territories: 0 },
];
type Seed = { id: string; kind: AgeKind; slotIndex: number; castleId: string | null; level: number; owner: string | null };
// 5 kale (sv 4,4,5,5,6) × 3 kule; karışık sahiplik → 4/5/6 kale kademeleri + üç renk
// + nötr gri birlikte görünür. c4 (taht) RED tarafından kuşatılıyor (kılıç işareti).
const SEED: Seed[] = [
  { id: 'c0', kind: 'castle', slotIndex: 0, castleId: null, level: 4, owner: ME },
  { id: 'c1', kind: 'castle', slotIndex: 1, castleId: null, level: 4, owner: RED },
  { id: 'c2', kind: 'castle', slotIndex: 2, castleId: null, level: 5, owner: GREEN },
  { id: 'c3', kind: 'castle', slotIndex: 3, castleId: null, level: 5, owner: null },
  { id: 'c4', kind: 'castle', slotIndex: 4, castleId: null, level: 6, owner: null },
  { id: 't101', kind: 'tower', slotIndex: 101, castleId: 'c0', level: 0, owner: ME },
  { id: 't102', kind: 'tower', slotIndex: 102, castleId: 'c0', level: 0, owner: null },
  { id: 't103', kind: 'tower', slotIndex: 103, castleId: 'c0', level: 0, owner: ME },
  { id: 't111', kind: 'tower', slotIndex: 111, castleId: 'c1', level: 0, owner: RED },
  { id: 't112', kind: 'tower', slotIndex: 112, castleId: 'c1', level: 0, owner: null },
  { id: 't113', kind: 'tower', slotIndex: 113, castleId: 'c1', level: 0, owner: ME },
  { id: 't121', kind: 'tower', slotIndex: 121, castleId: 'c2', level: 0, owner: GREEN },
  { id: 't122', kind: 'tower', slotIndex: 122, castleId: 'c2', level: 0, owner: GREEN },
  { id: 't123', kind: 'tower', slotIndex: 123, castleId: 'c2', level: 0, owner: null },
  { id: 't131', kind: 'tower', slotIndex: 131, castleId: 'c3', level: 0, owner: null },
  { id: 't132', kind: 'tower', slotIndex: 132, castleId: 'c3', level: 0, owner: ME },
  { id: 't133', kind: 'tower', slotIndex: 133, castleId: 'c3', level: 0, owner: null },
  { id: 't141', kind: 'tower', slotIndex: 141, castleId: 'c4', level: 0, owner: RED },
  { id: 't142', kind: 'tower', slotIndex: 142, castleId: 'c4', level: 0, owner: null },
  { id: 't143', kind: 'tower', slotIndex: 143, castleId: 'c4', level: 0, owner: GREEN },
];
const SAMPLE: AgeState = {
  matchId: 'learn',
  phase: 'war',
  prepEndsAt: null,
  warEndsAt: null,
  ranking: [],
  me: ME,
  myVeri: 200,
  players: PLAYERS,
  territories: SEED.map((s) => ({
    ...s,
    conquerCount: 0,
    codeDeadline: null,
    defended: s.kind === 'tower' ? true : s.owner != null,
  })) as AgeTerritory[],
  myAttacks: [],
  incoming: [{ attackId: 'atk', territoryId: 'c0', attacker: RED, guessCount: 2, lastGreen: 1, lastYellow: 0 }],
  attacksPublic: [{ territoryId: 'c4', attacker: RED }],
};

/* ── Adımlar (ekranın altında sırayla okunur) ── */
type Step = { icon: React.ComponentProps<typeof Feather>['name']; color: string; title: string; body: string };
const STEPS: Step[] = [
  { icon: 'map', color: AGE.blue, title: 'Diyar',
    body: 'Harita 5 kale ve her kalenin 3 nöbet kulesinden oluşur. Büyük düğüm = KALE (kelime), küçük = KULE (3 haneli sayı). Kale ne kadar büyükse harf sayısı o kadar çok (4/5/6).' },
  { icon: 'users', color: AGE.you, title: 'Renkler',
    body: 'Üç hükümdarın rengi sabittir (altın/kırmızı/yeşil). Gri düğüm henüz kimsenin değil. Üstteki kartlarda kimin kaç puanı olduğunu görürsün — "Sen" senin rengin.' },
  { icon: 'crosshair', color: AGE.green, title: 'Fethet',
    body: 'Hazırlıkta boş bölgeleri, savaşta rakiplerinkini al. Bir düğüme dokun, şifresini çöz. Bir KALEYE saldırmak için o kalenin en az bir kulesi sende olmalı (kapı kuralı).' },
  { icon: 'alert-triangle', color: AGE.red, title: 'Kuşatma işareti',
    body: 'Bir düğümün köşesindeki çapraz kılıç, oraya o an aktif bir saldırı olduğunu gösterir; rengi saldıranın rengidir. (Örnekte kırmızı, merkez tahtı kuşatıyor.)' },
  { icon: 'shield', color: '#d08a52', title: 'Kaleni savun',
    body: 'Kalene saldırı gelince üstte kırmızı alarm belirir. Savunmada önce avantajı seç, sonra botun sayısını çöz — süresini kısıp saldırganı yavaşlatabilirsin.' },
  { icon: 'award', color: colors.gold, title: 'Amaç',
    body: 'En çok puanı topla (kule 2 · kale seviye×5). Tüm toprağını kaybeden elenir; iki eleme olunca maç erken biter. Son ayakta kalan çağın hükümdarı olur.' },
];

/** Gizem Çağı ÖĞRETİCİ ekranı: örnek harita (üstte) + adım adım okuma (altta).
 *  Maç öncesi — saat işlemez, hiçbir şeyle etkileşme yok. Bitince "Maça Başla"
 *  gerçek eşleşmeyi başlatır. Turnuva kartındaki "?" ile tekrar açılır. */
export function AgeLearnScreen() {
  const router = useRouter();
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void markSeen('ageIntro'); // öğreticiyi gördü → kart bir daha buraya yönlendirmez
    if (!(await isOnline())) {
      setError('Maça girmek için internet bağlantısı gerekli.');
      setBusy(false);
      return;
    }
    try {
      const { matchId } = await ageFindMatch();
      router.replace({ pathname: '/age/[id]', params: { id: matchId } });
    } catch (e) {
      setError(e instanceof OnlineError ? e.message : 'Kuyruğa girilemedi.');
      setBusy(false);
    }
  };

  return (
    <AgeBackground>
      <View style={styles.mapWrap} pointerEvents="none">
        <AgeMap state={SAMPLE} veri={200} coach onTapNode={() => {}} onDefend={() => {}} />
      </View>

      <View style={styles.panel}>
        <View style={styles.beam} />
        <View style={styles.headRow}>
          <View style={[styles.iconBox, { borderColor: withAlpha(step.color, 0.6), backgroundColor: withAlpha(step.color, 0.14) }]}>
            <Feather name={step.icon} size={18} color={step.color} />
          </View>
          <Text style={styles.kicker}>NASIL OYNANIR · {i + 1}/{STEPS.length}</Text>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.x}>
            <Feather name="x" size={16} color={colors.dim} />
          </Pressable>
        </View>

        <Text style={styles.title}>{step.title}</Text>
        <Text style={styles.body}>{step.body}</Text>

        <View style={styles.dots}>
          {STEPS.map((_, k) => (
            <View key={k} style={[styles.dot, k === i && { backgroundColor: step.color, width: 18 }]} />
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.foot}>
          {i > 0 ? (
            <Pressable onPress={() => setI((x) => x - 1)} hitSlop={8} style={styles.ghost}>
              <Feather name="chevron-left" size={18} color={colors.dim} />
              <Text style={styles.ghostText}>Geri</Text>
            </Pressable>
          ) : (
            <Pressable onPress={start} disabled={busy} hitSlop={8} style={styles.ghost}>
              <Text style={styles.ghostText}>Geç</Text>
            </Pressable>
          )}
          <Pressable
            onPress={last ? start : () => setI((x) => x + 1)}
            disabled={busy}
            style={[styles.primary, { borderColor: withAlpha(AGE.blue, 0.6), backgroundColor: withAlpha(AGE.blue, 0.2) }, busy && { opacity: 0.6 }]}>
            {busy ? (
              <ActivityIndicator color={colors.ice} size="small" />
            ) : (
              <>
                <Text style={styles.primaryText}>{last ? 'Maça Başla' : 'İleri'}</Text>
                <Feather name={last ? 'play' : 'chevron-right'} size={16} color={colors.ice} />
              </>
            )}
          </Pressable>
        </View>
      </View>
    </AgeBackground>
  );
}

const styles = StyleSheet.create({
  mapWrap: { flex: 1 },
  panel: {
    backgroundColor: colors.bgMid,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1.5,
    borderColor: withAlpha(AGE.blue, 0.4),
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
    gap: 10,
    overflow: 'hidden',
  },
  beam: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: AGE.blue },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBox: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  kicker: { flex: 1, fontFamily: mono, fontSize: 10, letterSpacing: 2.5, color: colors.dim, fontWeight: '800' },
  x: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder },
  title: { fontFamily: mono, fontSize: 18, fontWeight: '900', letterSpacing: 0.5, color: colors.ice },
  body: { fontFamily: 'Comfortaa', fontSize: 13.5, color: colors.text, lineHeight: 20, minHeight: 60 },
  dots: { flexDirection: 'row', gap: 6, marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: withAlpha(colors.ice, 0.18) },
  error: { fontFamily: mono, fontSize: 12, color: colors.danger, textAlign: 'center' },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  ghost: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 12, paddingHorizontal: 14 },
  ghostText: { fontFamily: mono, fontSize: 12, fontWeight: '700', color: colors.dim, textTransform: 'uppercase', letterSpacing: 0.5 },
  primary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, borderRadius: 13, borderWidth: 1.5 },
  primaryText: { fontFamily: mono, fontSize: 13, fontWeight: '800', color: colors.ice, letterSpacing: 0.5 },
});
