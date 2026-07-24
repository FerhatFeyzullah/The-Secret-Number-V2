import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { AgeAttack, AgeDefenseStart, AgeIncoming, AgeKind, AgeSabotageChoice } from '@/online';
import { colors, mono, withAlpha } from '@/ui/theme';
import { TrKeyboard } from '../word/tr-keyboard';
import { AGE } from './age-colors';
import { AgeCastle, AgeTower } from './age-icons';

/* ── ortak yardımcılar ──────────────────────────────────────────────────── */
function numFeedback(fb: string): string {
  if (fb === 'win') return '✓ doğru';
  if (fb === 'digits_correct_wrong_order') return '3 doğru · yer yanlış';
  const n = fb.startsWith('partial:') ? fb.split(':')[1] : '0';
  return `${n} rakam doğru`;
}
function useCountdown(deadline: string | null): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const iv = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(iv);
  }, [deadline]);
  return deadline ? Math.max(0, Date.parse(deadline) - Date.now()) : 0;
}
function TimerBar({ deadline, total }: { deadline: string | null; total: number }) {
  const rem = useCountdown(deadline);
  if (!deadline) return null; // prep'te süresiz → çubuk yok
  const pct = total > 0 ? Math.max(0, Math.min(100, (rem / total) * 100)) : 0;
  return (
    <View style={styles.tbar}>
      <View style={[styles.tbarFill, { width: `${pct}%` }]} />
    </View>
  );
}

/** 3 haneli sayı girişi (kule/savunma). onSubmit'i dışarıdan tetiklenir. */
function NumPad({
  entry,
  onDigit,
  onDelete,
  locked,
}: {
  entry: string[];
  onDigit: (d: string) => void;
  onDelete: () => void;
  locked: boolean;
}) {
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.tiles}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.cell, entry[i] ? styles.cellCur : styles.cellEmpty]}>
            <Text style={styles.cellText}>{entry[i] ?? ''}</Text>
          </View>
        ))}
      </View>
      <View style={styles.pad}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Pressable
            key={d}
            disabled={locked}
            onPress={() => onDigit(d)}
            style={({ pressed }) => [styles.key, pressed && styles.keyDown]}>
            <Text style={styles.keyText}>{d}</Text>
          </Pressable>
        ))}
        <Pressable disabled={locked} onPress={onDelete} style={[styles.key, styles.keyWide]}>
          <Text style={[styles.keyText, { color: colors.dim }]}>⌫ Sil</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Kelime girişi (kale/şifre): karolar + TrKeyboard + Onayla. */
function WordEntry({
  length,
  entry,
  onKey,
  onDelete,
  onSubmit,
  busy,
  label = 'Onayla',
}: {
  length: number;
  entry: string[];
  onKey: (k: string) => void;
  onDelete: () => void;
  onSubmit: () => void;
  busy: boolean;
  label?: string;
}) {
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.tiles}>
        {Array.from({ length }).map((_, i) => (
          <View key={i} style={[styles.tile, entry[i] ? styles.tileFilled : styles.tileEmpty]}>
            <Text style={styles.tileText}>{(entry[i] ?? '').toLocaleUpperCase('tr')}</Text>
          </View>
        ))}
      </View>
      <Pressable
        onPress={onSubmit}
        disabled={busy || entry.length < length}
        style={[styles.confirm, (busy || entry.length < length) && styles.confirmOff]}>
        <Text style={styles.confirmText}>{label}</Text>
      </Pressable>
      <TrKeyboard large onKey={onKey} onDelete={onDelete} locked={busy} />
    </View>
  );
}

/* ── SALDIRI paneli ─────────────────────────────────────────────────────── */
export function AttackPanel({
  kind,
  level,
  targetName,
  defended,
  attack,
  busy,
  onGuess,
  onClose,
}: {
  kind: AgeKind;
  level: number;
  targetName: string;
  defended: boolean;
  attack: AgeAttack | undefined;
  busy: boolean;
  onGuess: (value: string) => void;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState<string[]>([]);
  const total = kind === 'tower' ? 90000 : 120000;
  const undefendedCastle = kind === 'castle' && !defended;
  const submit = () => {
    const need = kind === 'tower' ? 3 : level;
    if (entry.length < need) return;
    onGuess(entry.join(''));
    setEntry([]);
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <View style={styles.hicon}>
              {kind === 'tower' ? <AgeTower size={40} color={AGE.gray} /> : <AgeCastle size={44} color={AGE.gray} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.htitle}>{kind === 'tower' ? 'Nöbet Kulesi' : `Kale · ${targetName}`}</Text>
              <Text style={styles.hsub}>
                {undefendedCastle ? 'SAVUNMASIZ' : kind === 'tower' ? '3 haneli şifre' : `${level} harfli kelime`}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.hx}>
              <Feather name="x" size={16} color={colors.dim} />
            </Pressable>
          </View>

          {undefendedCastle ? (
            <>
              <Text style={styles.note}>Bu kaleye kelime konmamış — doğrudan ele geçirebilirsin.</Text>
              <Pressable onPress={() => onGuess('AL')} disabled={busy} style={[styles.confirm, busy && styles.confirmOff]}>
                <Text style={styles.confirmText}>Ele Geçir</Text>
              </Pressable>
            </>
          ) : (
            <>
              <TimerBar deadline={attack?.deadline ?? null} total={total} />
              <View style={styles.glist}>
                {(attack?.guesses ?? []).slice(-4).map((g, i) =>
                  kind === 'tower' ? (
                    <View key={i} style={styles.grow}>
                      <Text style={styles.gdigits}>{g.guess}</Text>
                      <Text style={styles.gfb}>{numFeedback(g.feedback)}</Text>
                    </View>
                  ) : (
                    <View key={i} style={styles.wrow}>
                      {g.guess.split('').map((ch, j) => {
                        const mk = g.marks?.[j] ?? 'X';
                        return (
                          <View key={j} style={[styles.wmini, mk === 'G' ? styles.wG : mk === 'Y' ? styles.wY : styles.wX]}>
                            <Text style={styles.wminiText}>{ch.toLocaleUpperCase('tr')}</Text>
                          </View>
                        );
                      })}
                    </View>
                  ),
                )}
              </View>

              {kind === 'tower' ? (
                <>
                  <NumPad
                    entry={entry}
                    locked={busy}
                    onDigit={(d) => setEntry((g) => (g.length >= 3 || g.includes(d) ? g : [...g, d]))}
                    onDelete={() => setEntry((g) => g.slice(0, -1))}
                  />
                  <Pressable onPress={submit} disabled={busy || entry.length < 3} style={[styles.confirm, (busy || entry.length < 3) && styles.confirmOff]}>
                    <Text style={styles.confirmText}>Dene</Text>
                  </Pressable>
                </>
              ) : (
                <WordEntry
                  length={level}
                  entry={entry}
                  busy={busy}
                  label="Dene"
                  onKey={(k) => setEntry((g) => (g.length >= level ? g : [...g, k]))}
                  onDelete={() => setEntry((g) => g.slice(0, -1))}
                  onSubmit={submit}
                />
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

/* ── SAVUNMA paneli ─────────────────────────────────────────────────────── */
export function DefensePanel({
  incoming,
  start,
  solvedCount,
  busy,
  onSolve,
  onClose,
}: {
  incoming: AgeIncoming;
  start: AgeDefenseStart;
  solvedCount: number;
  busy: boolean;
  onSolve: (value: string, sabotage: AgeSabotageChoice) => void;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState<string[]>([]);
  const slots = start.slots;
  const full = solvedCount >= slots;
  const fire = (sab: AgeSabotageChoice) => {
    if (entry.length < 3 || full) return;
    onSolve(entry.join(''), sab);
    setEntry([]);
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <View style={styles.hicon}><AgeCastle size={44} color={AGE.blue} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.htitle}>Kaleni Savun</Text>
              <Text style={styles.hsub}>Botun sayısını çöz → dezavantaj uygula</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.hx}>
              <Feather name="x" size={16} color={colors.dim} />
            </Pressable>
          </View>

          <View style={styles.attacker}>
            <Feather name="alert-triangle" size={14} color={AGE.red} />
            <Text style={styles.attackerText}>
              Saldırgan · {incoming.guessCount} tahmin
              {incoming.lastGreen != null ? ` · son ${incoming.lastGreen} doğru yerde` : ''}
            </Text>
          </View>

          <View style={styles.slots}>
            {Array.from({ length: slots }).map((_, i) => (
              <View key={i} style={[styles.slot, i < solvedCount && styles.slotOn]} />
            ))}
          </View>
          <Text style={styles.freeNote}>{slots - solvedCount} hakkın kaldı · sayıyı çöz, dezavantaj seç</Text>

          <NumPad
            entry={entry}
            locked={busy || full}
            onDigit={(d) => setEntry((g) => (g.length >= 3 || g.includes(d) ? g : [...g, d]))}
            onDelete={() => setEntry((g) => g.slice(0, -1))}
          />

          <View style={styles.sabRow}>
            <Pressable onPress={() => fire('time')} disabled={busy || full || entry.length < 3} style={[styles.sab, (busy || full || entry.length < 3) && styles.sabOff]}>
              <Text style={styles.sabTitle}>⏱ Süre −15</Text>
              <Text style={styles.sabCostFree}>ücretsiz</Text>
            </Pressable>
            <Pressable onPress={() => fire('fog')} disabled={busy || full || entry.length < 3} style={[styles.sab, styles.sabFog, (busy || full || entry.length < 3) && styles.sabOff]}>
              <Text style={styles.sabTitle}>🌫 Sis</Text>
              <Text style={styles.sabCost}>◈ 50</Text>
            </Pressable>
            <Pressable onPress={() => fire('thief')} disabled={busy || full || entry.length < 3} style={[styles.sab, styles.sabThief, (busy || full || entry.length < 3) && styles.sabOff]}>
              <Text style={styles.sabTitle}>⌛ Z.Hırsızı</Text>
              <Text style={styles.sabCost}>◈ 60</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ── ŞİFRE paneli (fetih sonrası belirleme VE Veri ile yenileme) ─────────── */
export function SetCodePanel({
  kind,
  level,
  deadline,
  mode,
  busy,
  onSet,
  onRandom,
}: {
  kind: AgeKind;
  level: number;
  deadline: string | null;
  mode: 'set' | 'refresh';
  busy: boolean;
  onSet: (value: string) => void;
  onRandom: () => void;
}) {
  const [entry, setEntry] = useState<string[]>([]);
  const rem = useCountdown(deadline);
  useEffect(() => {
    if (deadline && rem <= 0) onRandom();
  }, [deadline, rem, onRandom]);
  const need = kind === 'tower' ? 3 : level;
  const submit = () => {
    if (entry.length < need) return;
    onSet(entry.join(''));
  };
  const refresh = mode === 'refresh';
  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent>
      <View style={styles.root}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <View style={styles.hicon}>
              {kind === 'tower' ? <AgeTower size={40} color={AGE.blue} /> : <AgeCastle size={44} color={AGE.blue} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.kicker}>{refresh ? 'ŞİFRE YENİLEME' : 'FETHEDİLDİ · SENİN'}</Text>
              <Text style={styles.htitle}>{kind === 'tower' ? 'Nöbet Kulesi' : `Kale · ${level} harf`}</Text>
              <Text style={styles.hsub}>{refresh ? 'Kuşatmayı sıfırla' : 'Savunma şifreni kur'}</Text>
            </View>
            {deadline ? (
              <View style={styles.timerChip}>
                <Text style={styles.timerText}>0:{String(Math.ceil(rem / 1000)).padStart(2, '0')}</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.note}>
            {refresh
              ? `Yeni ${kind === 'tower' ? 'sayı' : 'kelime'} · saldırganın biriktirdiği ipuçları silinir`
              : kind === 'tower'
                ? 'Rakip çözmeye çalışır · 3 farklı rakam'
                : 'Rakip çözmeye çalışır · geçerli kelime — girmezsen SAVUNMASIZ kalır'}
          </Text>

          {kind === 'tower' ? (
            <>
              <NumPad
                entry={entry}
                locked={busy}
                onDigit={(d) => setEntry((g) => (g.length >= 3 || g.includes(d) ? g : [...g, d]))}
                onDelete={() => setEntry((g) => g.slice(0, -1))}
              />
              <Pressable onPress={submit} disabled={busy || entry.length < 3} style={[styles.confirm, (busy || entry.length < 3) && styles.confirmOff]}>
                <Text style={styles.confirmText}>Şifreyi Kur</Text>
              </Pressable>
            </>
          ) : (
            <WordEntry
              length={level}
              entry={entry}
              busy={busy}
              label="Şifreyi Kur"
              onKey={(k) => setEntry((g) => (g.length >= level ? g : [...g, k]))}
              onDelete={() => setEntry((g) => g.slice(0, -1))}
              onSubmit={submit}
            />
          )}

          {refresh ? null : (
            <Pressable onPress={onRandom} disabled={busy} style={styles.randomBtn}>
              <Text style={styles.randomText}>{kind === 'tower' ? 'Rastgele Bırak' : 'Boş Bırak → Savunmasız'}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(4,8,18,0.6)' },
  sheet: {
    backgroundColor: colors.bgMid, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderColor: withAlpha(AGE.blue, 0.4), paddingHorizontal: 18, paddingTop: 14,
    paddingBottom: 26, gap: 12,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hicon: { width: 46, alignItems: 'center' },
  kicker: { fontFamily: mono, fontSize: 9, letterSpacing: 2, color: AGE.blue },
  htitle: { fontFamily: mono, fontSize: 16, fontWeight: '800', color: colors.ice },
  hsub: { fontFamily: mono, fontSize: 10, color: colors.dim, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  hx: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder },
  timerChip: { alignItems: 'center' },
  timerText: { fontFamily: mono, fontSize: 15, fontWeight: '800', color: colors.amber },
  note: { fontFamily: mono, fontSize: 11, color: colors.dim, textAlign: 'center', lineHeight: 16 },
  tbar: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  tbarFill: { height: '100%', borderRadius: 3, backgroundColor: colors.amber },
  glist: { gap: 6 },
  grow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  gdigits: { fontFamily: mono, fontSize: 18, fontWeight: '800', color: colors.ice, letterSpacing: 4 },
  gfb: { fontFamily: mono, fontSize: 11, color: colors.amber },
  wrow: { flexDirection: 'row', gap: 5, justifyContent: 'center' },
  wmini: { width: 30, height: 32, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  wminiText: { fontFamily: mono, fontSize: 15, fontWeight: '800', color: colors.ice },
  wG: { backgroundColor: '#2f9d57' },
  wY: { backgroundColor: '#c8952a' },
  wX: { backgroundColor: '#1a2540' },
  tiles: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  cell: { width: 44, height: 50, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  cellEmpty: { borderStyle: 'dashed', borderColor: colors.glassBorder },
  cellCur: { borderColor: AGE.blue, backgroundColor: colors.glass },
  cellText: { fontFamily: mono, fontSize: 22, fontWeight: '800', color: colors.ice },
  tile: { width: 44, height: 50, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  tileEmpty: { borderStyle: 'dashed', borderColor: colors.glassBorder },
  tileFilled: { borderColor: AGE.blue, backgroundColor: colors.glass },
  tileText: { fontFamily: mono, fontSize: 22, fontWeight: '800', color: colors.ice },
  pad: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, justifyContent: 'center' },
  key: {
    width: '30%', paddingVertical: 12, borderRadius: 12, alignItems: 'center',
    backgroundColor: '#1e2f52', borderWidth: 1, borderColor: colors.glassBorder,
  },
  keyWide: { width: '62%' },
  keyDown: { opacity: 0.7 },
  keyText: { fontFamily: mono, fontSize: 19, fontWeight: '700', color: colors.ice },
  confirm: { alignItems: 'center', paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: withAlpha(AGE.blue, 0.55), backgroundColor: withAlpha(AGE.blue, 0.2) },
  confirmOff: { opacity: 0.5 },
  confirmText: { fontFamily: mono, fontSize: 14, fontWeight: '800', color: colors.ice, letterSpacing: 0.5 },
  attacker: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, backgroundColor: colors.glass, borderWidth: 1, borderColor: withAlpha(AGE.red, 0.35) },
  attackerText: { fontFamily: mono, fontSize: 11, color: colors.ice, flex: 1 },
  slots: { flexDirection: 'row', gap: 6 },
  slot: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)' },
  slotOn: { backgroundColor: colors.amber },
  freeNote: { fontFamily: mono, fontSize: 10, color: colors.dim, textAlign: 'center' },
  sabRow: { flexDirection: 'row', gap: 8 },
  sab: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 11, borderRadius: 12, backgroundColor: colors.glass, borderWidth: 1, borderColor: withAlpha(colors.success, 0.35) },
  sabFog: { borderColor: 'rgba(169,199,238,0.4)' },
  sabThief: { borderColor: withAlpha(colors.violet, 0.4) },
  sabOff: { opacity: 0.4 },
  sabTitle: { fontFamily: mono, fontSize: 11, fontWeight: '800', color: colors.ice },
  sabCost: { fontFamily: mono, fontSize: 10, color: colors.teal },
  sabCostFree: { fontFamily: mono, fontSize: 10, color: colors.success },
  randomBtn: { alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.glassBorder, backgroundColor: colors.glass },
  randomText: { fontFamily: mono, fontSize: 12, fontWeight: '700', color: colors.dim, letterSpacing: 0.5, textTransform: 'uppercase' },
});
