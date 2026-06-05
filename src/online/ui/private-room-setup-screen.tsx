import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { FirstTurnMode } from '@/online';
import { GlassButton } from '@/ui/glass';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';
import { LobbyHeader } from './parts';

const TIMES: { ms: number; big: string }[] = [
  { ms: 60000, big: '1' },
  { ms: 90000, big: '1.5' },
  { ms: 120000, big: '2' },
];
const TIME_TXT: Record<number, string> = { 60000: '1 dakika', 90000: '1.5 dakika', 120000: '2 dakika' };

const TURNS: { mode: FirstTurnMode; icon: 'grid' | 'user'; nm: string; sub: string }[] = [
  { mode: 'random', icon: 'grid', nm: 'Rastgele', sub: 'Sistem seçer' },
  { mode: 'creator', icon: 'user', nm: 'Ben başlarım', sub: 'Oda kuran' },
];

/** Özel oda ayar ekranı: maç süresi (kişi başı) + ilk tahmin sırası.
 *  "ODA KUR" → onConfirm(clockMs, firstTurnMode). Varsayılan: 1 dk / Rastgele. */
export function PrivateRoomSetupScreen({
  busy,
  onConfirm,
  onBack,
}: {
  busy?: boolean;
  onConfirm: (clockMs: number, firstTurnMode: FirstTurnMode) => void;
  onBack: () => void;
}) {
  const [clockMs, setClockMs] = useState(60000);
  const [turn, setTurn] = useState<FirstTurnMode>('random');

  return (
    <View style={styles.root}>
      <LobbyHeader title="ÖZEL ODA" onBack={onBack} />

      <View style={styles.body}>
        {/* Süre */}
        <View style={styles.sec}>
          <View style={styles.lbl}>
            <Feather name="clock" size={14} color={colors.cyan} />
            <Text style={styles.lblText}>MAÇ SÜRESİ · KİŞİ BAŞI</Text>
          </View>
          <View style={styles.row}>
            {TIMES.map((t) => {
              const on = clockMs === t.ms;
              return (
                <Pressable
                  key={t.ms}
                  onPress={() => setClockMs(t.ms)}
                  style={[styles.timeCard, on && styles.timeCardOn]}>
                  {on ? <View style={styles.timeDot} /> : null}
                  <Text style={[styles.timeBig, on && styles.timeBigOn]}>{t.big}</Text>
                  <Text style={[styles.timeUnit, on && styles.timeUnitOn]}>DAKİKA</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* İlk sıra */}
        <View style={styles.sec}>
          <View style={styles.lbl}>
            <Feather name="refresh-cw" size={14} color={colors.cyan} />
            <Text style={styles.lblText}>İLK TAHMİN SIRASI</Text>
          </View>
          <View style={styles.row}>
            {TURNS.map((t) => {
              const on = turn === t.mode;
              return (
                <Pressable
                  key={t.mode}
                  onPress={() => setTurn(t.mode)}
                  style={[styles.turnCard, on && styles.turnCardOn]}>
                  <View style={[styles.turnEmb, on && styles.turnEmbOn]}>
                    <Feather name={t.icon} size={22} color={on ? colors.amber : colors.dim} />
                  </View>
                  <Text style={[styles.turnNm, on && styles.turnNmOn]}>{t.nm}</Text>
                  <Text style={styles.turnSub}>{t.sub}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Canlı özet */}
        <View style={styles.summary}>
          <Feather name="info" size={16} color={colors.cyan} />
          <Text style={styles.summaryText}>
            Her oyuncuya <Text style={styles.summaryB}>{TIME_TXT[clockMs]}</Text>, ilk sırayı{' '}
            <Text style={styles.summaryB}>{turn === 'random' ? 'sistem' : 'sen'}</Text> belirleyecek.
            Kodları kilitleyince maç başlar.
          </Text>
        </View>

        <View style={styles.spacer} />

        <GlassButton
          label={busy ? 'Oda kuruluyor…' : 'ODA KUR'}
          accent={colors.cyan}
          variant="fill"
          disabled={busy}
          icon={<Feather name="plus" size={16} color={colors.ice} />}
          onPress={() => onConfirm(clockMs, turn)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  body: {
    flex: 1,
    paddingTop: 6,
  },
  sec: {
    marginBottom: 24,
  },
  lbl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  lblText: {
    fontSize: 11,
    letterSpacing: 2,
    color: colors.dim,
    fontFamily: mono,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  // Süre kartları
  timeCard: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    backgroundColor: colors.glass,
    borderWidth: 1.5,
    borderColor: colors.glassBorder,
  },
  timeCardOn: {
    borderColor: colors.cyan,
    backgroundColor: cyanAlpha(0.16),
    boxShadow: `0 0 20px ${cyanAlpha(0.25)}`,
  },
  timeDot: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.cyan,
    boxShadow: `0 0 8px ${colors.cyan}`,
  },
  timeBig: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    fontFamily: mono,
  },
  timeBigOn: {
    color: colors.cyan,
    textShadowColor: cyanAlpha(0.6),
    textShadowRadius: 14,
  },
  timeUnit: {
    fontSize: 10,
    letterSpacing: 1,
    color: colors.dim,
    fontFamily: mono,
    marginTop: 6,
  },
  timeUnitOn: {
    color: colors.text,
  },
  // İlk sıra kartları
  turnCard: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.glass,
    borderWidth: 1.5,
    borderColor: colors.glassBorder,
  },
  turnCardOn: {
    borderColor: colors.amber,
    backgroundColor: withAlpha(colors.amber, 0.16),
    boxShadow: `0 0 18px ${withAlpha(colors.amber, 0.2)}`,
  },
  turnEmb: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  turnEmbOn: {
    borderColor: colors.amber,
    backgroundColor: withAlpha(colors.amber, 0.1),
    boxShadow: `0 0 12px ${withAlpha(colors.amber, 0.3)}`,
  },
  turnNm: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
    fontFamily: mono,
  },
  turnNmOn: {
    color: colors.amber,
  },
  turnSub: {
    fontSize: 9,
    color: colors.dim,
    fontFamily: mono,
    textAlign: 'center',
  },
  // Özet
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  summaryText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 17,
    color: colors.dim,
  },
  summaryB: {
    color: colors.ice,
    fontWeight: '700',
  },
  spacer: {
    flex: 1,
  },
});
