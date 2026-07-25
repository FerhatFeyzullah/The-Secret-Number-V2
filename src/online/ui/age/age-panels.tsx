import { Feather } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { LetterMark } from '@/game';
import type { AgeAttack, AgeDefenseStart, AgeGuess, AgeIncoming, AgeKind, AgeSabotageChoice } from '@/online';
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

/** Kelime tahmin geçmişinden klavye harf renkleri (G>Y>X) — kule-katı deseni. */
function keyStatesFromGuesses(guesses: AgeGuess[]): Record<string, LetterMark> {
  const rank: Record<LetterMark, number> = { X: 0, Y: 1, G: 2 };
  const map: Record<string, LetterMark> = {};
  for (const g of guesses) {
    if (!g.marks) continue;
    const letters = Array.from(g.guess.toLocaleLowerCase('tr'));
    const marks = Array.from(g.marks) as LetterMark[];
    for (let i = 0; i < letters.length; i++) {
      const mk = marks[i];
      if (mk !== 'G' && mk !== 'Y' && mk !== 'X') continue;
      const ch = letters[i];
      const cur = map[ch];
      if (cur === undefined || rank[mk] > rank[cur]) map[ch] = mk;
    }
  }
  return map;
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

/** Kelime girişi (kale/şifre): karolar + TrKeyboard + Onayla. letterStates verilirse
 *  (saldırıda) klavye tuşları Wordle renklerini alır. */
function WordEntry({
  length,
  entry,
  onKey,
  onDelete,
  onSubmit,
  busy,
  label = 'Onayla',
  letterStates,
}: {
  length: number;
  entry: string[];
  onKey: (k: string) => void;
  onDelete: () => void;
  onSubmit: () => void;
  busy: boolean;
  label?: string;
  letterStates?: Record<string, LetterMark>;
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
      <TrKeyboard large onKey={onKey} onDelete={onDelete} locked={busy} letterStates={letterStates} />
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
  const glRef = useRef<ScrollView>(null);
  const total = kind === 'tower' ? 90000 : 120000;
  const undefendedCastle = kind === 'castle' && !defended;
  // Kelime saldırısında klavye tuş renkleri (geçmiş tahminlerin işaretlerinden).
  const keyStates = useMemo(
    () => (kind === 'castle' ? keyStatesFromGuesses(attack?.guesses ?? []) : undefined),
    [kind, attack?.guesses],
  );
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
              {kind === 'tower' ? <AgeTower size={40} color={AGE.gray} /> : <AgeCastle size={44} color={AGE.gray} level={level} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.htitle}>{kind === 'tower' ? 'Nöbet Kulesi' : targetName ? `Kale · ${targetName}` : 'Kale'}</Text>
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
              {/* Tüm geçmiş sorgular; en fazla ~4 satır görünür, gerisi scroll
                  (modal dikeyde şişmesin). Yeni sorguda sona kayar. */}
              <ScrollView
                ref={glRef}
                style={{ maxHeight: kind === 'tower' ? 116 : 164 }}
                contentContainerStyle={styles.glist}
                showsVerticalScrollIndicator={false}
                onContentSizeChange={() => glRef.current?.scrollToEnd({ animated: true })}>
                {(attack?.guesses ?? []).map((g, i) =>
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
              </ScrollView>

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
                  letterStates={keyStates}
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
// Akış: (1) avantajı SEÇ → (2) 60 sn içinde botun sayısını çöz → çözersen avantaj
// otomatik uygulanır; süre dolarsa o savunma hakkı yanar. Toplam hak = 1 (ana kale,
// yalnız süre) + sahip olunan kule sayısı; premium (sis/hırsız) hakkı = kule sayısı.
export function DefensePanel({
  incoming,
  start,
  solvedCount,
  premiumLeft,
  veri,
  guesses,
  accent = AGE.you,
  busy,
  onSolve,
  onTimeout,
  onClose,
}: {
  incoming: AgeIncoming;
  start: AgeDefenseStart;
  solvedCount: number;
  premiumLeft: number;
  /** Kalan maç‑içi Sefer Verisi (undefined → bakiye/ücret kilidi kapalı). */
  veri?: number;
  /** Bu hakta çözülen botun sayısına dair kendi tahmin geçmişin (sayı + feedback). */
  guesses?: { guess: string; feedback: string }[];
  /** İzleyicinin kendi takım rengi (kale ikonu). */
  accent?: string;
  busy: boolean;
  onSolve: (value: string, sabotage: AgeSabotageChoice) => void;
  onTimeout: () => void;
  onClose: () => void;
}) {
  const slots = start.slots;
  const full = solvedCount >= slots;
  const poor = (c: number) => veri != null && veri < c;
  const [stage, setStage] = useState<'choose' | 'solve'>('choose');
  const [chosen, setChosen] = useState<AgeSabotageChoice | null>(null);
  const [entry, setEntry] = useState<string[]>([]);
  const [solveEndsAt, setSolveEndsAt] = useState<string | null>(null);
  const rem = useCountdown(solveEndsAt);
  const glRef = useRef<ScrollView>(null);
  const history = guesses ?? [];

  // Yeni hak (solvedCount değişince) → seçim aşamasına dön.
  useEffect(() => {
    setStage('choose');
    setChosen(null);
    setEntry([]);
    setSolveEndsAt(null);
  }, [solvedCount]);

  // 60 sn dolunca → bu savunma hakkı başarısız (yanar), sıradakine geç.
  useEffect(() => {
    if (stage === 'solve' && solveEndsAt && rem <= 0) {
      setSolveEndsAt(null);
      setStage('choose');
      setChosen(null);
      setEntry([]);
      onTimeout();
    }
  }, [stage, solveEndsAt, rem, onTimeout]);

  const pick = (sab: AgeSabotageChoice) => {
    setChosen(sab);
    setEntry([]);
    setStage('solve');
    setSolveEndsAt(new Date(Date.now() + 60000).toISOString());
  };
  const submit = () => {
    if (entry.length < 3 || !chosen) return;
    onSolve(entry.join(''), chosen);
    setEntry([]);
  };

  // MONOTON ibre: son tahmin DEĞİL, tutarlı best (yeşil öncelikli) → geri gitmez.
  const gp = incoming.bestGreen ?? 0;
  const yp = incoming.bestYellow ?? 0;
  const wlen =
    incoming.wordLength && incoming.wordLength > 0 ? incoming.wordLength : Math.max(gp + yp, 1);
  const gPct = Math.round((gp / wlen) * 100);
  const yPct = Math.round((yp / wlen) * 100);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <View style={styles.hicon}><AgeCastle size={44} color={accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.htitle}>Kaleni Savun</Text>
              <Text style={styles.hsub}>Sayıyı çöz → seçtiğin avantaj uygulanır</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.hx}>
              <Feather name="x" size={16} color={colors.dim} />
            </Pressable>
          </View>

          {/* Saldıranın ilerlemesi — Kelime Yarışı gauge'ı: artan ibre + miktar
              (harf sızmaz; yalnız tutarlı yeşil/sarı SAYI). */}
          <View style={styles.attacker}>
            <Feather name="alert-triangle" size={14} color={AGE.red} />
            {incoming.guessCount > 0 && (gp > 0 || yp > 0) ? (
              <View style={styles.gaugeWrap}>
                <View style={styles.gaugeRow}>
                  <Text style={styles.gaugeLabel}>
                    {gp}/{wlen} yeşil
                  </Text>
                  <View style={styles.gaugeTrack}>
                    <View
                      style={[
                        styles.gaugeFill,
                        { width: `${gPct}%` as `${number}%`, backgroundColor: '#22C55E' },
                      ]}
                    />
                  </View>
                </View>
                <View style={styles.gaugeRow}>
                  <Text style={styles.gaugeLabel}>
                    {yp}/{wlen} sarı
                  </Text>
                  <View style={styles.gaugeTrack}>
                    <View
                      style={[
                        styles.gaugeFill,
                        { width: `${yPct}%` as `${number}%`, backgroundColor: '#EAB308' },
                      ]}
                    />
                  </View>
                </View>
              </View>
            ) : (
              <Text style={styles.attackerText}>Saldırgan henüz ilerlemedi</Text>
            )}
          </View>

          {/* Savunma hakları */}
          <View style={styles.slots}>
            {Array.from({ length: slots }).map((_, i) => (
              <View key={i} style={[styles.slot, i < solvedCount && styles.slotOn]} />
            ))}
          </View>

          {veri != null ? (
            <View style={styles.veriLine}>
              <Feather name="hexagon" size={12} color={colors.teal} />
              <Text style={styles.veriLineText}>Sefer kesen · ◈ {veri}</Text>
            </View>
          ) : null}

          {full ? (
            <Text style={styles.freeNote}>Savunma hakların bitti.</Text>
          ) : stage === 'choose' ? (
            <>
              <Text style={styles.freeNote}>{slots - solvedCount} hakkın kaldı · çözünce uygulanacak avantajı seç</Text>
              <View style={styles.sabCol}>
                <Pressable onPress={() => pick('time')} disabled={busy} style={styles.sabPick}>
                  <View style={styles.sabTexts}>
                    <Text style={styles.sabTitle}>⏱ Süre −15 sn</Text>
                    <Text style={styles.sabDesc}>Saldırganın süresi azalır</Text>
                  </View>
                  <Text style={styles.sabCostFree}>ücretsiz</Text>
                </Pressable>
                <Pressable
                  onPress={() => pick('fog')}
                  disabled={busy || premiumLeft <= 0 || poor(50)}
                  style={[styles.sabPick, styles.sabFog, (premiumLeft <= 0 || poor(50)) && styles.sabOff]}>
                  <View style={styles.sabTexts}>
                    <Text style={styles.sabTitle}>🌫 Sis</Text>
                    <Text style={styles.sabDesc}>Saldırganın sonraki 3 tahmininde geri bildirim maskeli</Text>
                  </View>
                  <Text style={styles.sabCost}>◈ 50</Text>
                </Pressable>
                <Pressable
                  onPress={() => pick('thief')}
                  disabled={busy || premiumLeft <= 0 || poor(60)}
                  style={[styles.sabPick, styles.sabThief, (premiumLeft <= 0 || poor(60)) && styles.sabOff]}>
                  <View style={styles.sabTexts}>
                    <Text style={styles.sabTitle}>⌛ Zaman Hırsızı</Text>
                    <Text style={styles.sabDesc}>Gri harfler saldırganın süresini yer</Text>
                  </View>
                  <Text style={styles.sabCost}>◈ 60</Text>
                </Pressable>
              </View>
              {premiumLeft <= 0 ? (
                <Text style={styles.freeNote}>Sis/Hırsızı için kule hakkın yok — yalnız süre düşürme kullanılabilir.</Text>
              ) : veri != null && poor(50) ? (
                <Text style={styles.freeNote}>Sefer Verisi yetersiz — yalnız ücretsiz süre düşürme kullanılabilir.</Text>
              ) : null}
            </>
          ) : (
            <>
              <View style={styles.chosenRow}>
                <Pressable
                  onPress={() => {
                    setStage('choose');
                    setChosen(null);
                    setSolveEndsAt(null);
                  }}
                  hitSlop={8}>
                  <Feather name="chevron-left" size={18} color={colors.dim} />
                </Pressable>
                <Text style={styles.chosenChip}>
                  {chosen === 'time' ? '⏱ Süre −15' : chosen === 'fog' ? '🌫 Sis' : '⌛ Z.Hırsızı'}
                </Text>
                <Text style={styles.chosenClock}>0:{String(Math.ceil(rem / 1000)).padStart(2, '0')}</Text>
              </View>
              <TimerBar deadline={solveEndsAt} total={60000} />
              {history.length > 0 ? (
                <ScrollView
                  ref={glRef}
                  style={styles.defHist}
                  contentContainerStyle={styles.glist}
                  showsVerticalScrollIndicator={false}
                  onContentSizeChange={() => glRef.current?.scrollToEnd({ animated: true })}>
                  {history.map((g, i) => (
                    <View key={i} style={styles.grow}>
                      <Text style={styles.gdigits}>{g.guess}</Text>
                      <Text style={styles.gfb}>{numFeedback(g.feedback)}</Text>
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <Text style={styles.freeNote}>Botun 3 haneli sayısını çöz — denemelerin aşağıda listelenir.</Text>
              )}
              <NumPad
                entry={entry}
                locked={busy}
                onDigit={(d) => setEntry((g) => (g.length >= 3 || g.includes(d) ? g : [...g, d]))}
                onDelete={() => setEntry((g) => g.slice(0, -1))}
              />
              <Pressable onPress={submit} disabled={busy || entry.length < 3} style={[styles.confirm, (busy || entry.length < 3) && styles.confirmOff]}>
                <Text style={styles.confirmText}>Çöz → Uygula</Text>
              </Pressable>
            </>
          )}
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
  veri,
  accent = AGE.you,
  busy,
  onSet,
  onRandom,
  onClose,
}: {
  kind: AgeKind;
  level: number;
  deadline: string | null;
  mode: 'set' | 'refresh';
  /** Kalan maç‑içi Sefer Verisi (yalnız yenileme ücretlidir). */
  veri?: number;
  /** İzleyicinin kendi takım rengi (yenileme ikonu). */
  accent?: string;
  busy: boolean;
  onSet: (value: string) => void;
  onRandom: () => void;
  /** × / arka plan ile kapat (garantili çıkış). */
  onClose?: () => void;
}) {
  const [entry, setEntry] = useState<string[]>([]);
  const rem = useCountdown(deadline);
  useEffect(() => {
    if (deadline && rem <= 0) onRandom();
  }, [deadline, rem, onRandom]);
  const need = kind === 'tower' ? 3 : level;
  const refresh = mode === 'refresh';
  const refreshCost = kind === 'tower' ? 40 : 60;
  const cantAfford = refresh && veri != null && veri < refreshCost;
  // Fetih sonrası ŞİFRE KUR: kullanıcı fark etsin diye modal KIRMIZI vurgulu.
  const alert = !refresh;
  // Yenileme modunda ikon kendi rengin; şifre kurmada dikkat için kırmızı.
  const iconColor = alert ? AGE.red : accent;
  const submit = () => {
    if (entry.length < need || cantAfford) return;
    onSet(entry.join(''));
  };
  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        {onClose ? <Pressable style={StyleSheet.absoluteFill} onPress={onClose} /> : null}
        <View style={[styles.sheet, alert && styles.sheetAlert]}>
          <View style={[styles.beam, alert && styles.beamAlert]} />
          <View style={styles.head}>
            <View style={styles.hicon}>
              {kind === 'tower' ? <AgeTower size={40} color={iconColor} /> : <AgeCastle size={44} color={iconColor} level={level} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.kicker, alert && styles.kickerAlert]}>{refresh ? 'ŞİFRE YENİLEME' : 'FETHEDİLDİ · ŞİFRENİ KUR'}</Text>
              <Text style={styles.htitle}>{kind === 'tower' ? 'Nöbet Kulesi' : `Kale · ${level} harf`}</Text>
              <Text style={styles.hsub}>{refresh ? 'Kuşatmayı sıfırla' : 'Savunma şifreni kur'}</Text>
            </View>
            {deadline ? (
              <View style={styles.timerChip}>
                <Text style={[styles.timerText, alert && { color: AGE.red }]}>0:{String(Math.ceil(rem / 1000)).padStart(2, '0')}</Text>
              </View>
            ) : null}
            {onClose ? (
              <Pressable onPress={onClose} hitSlop={8} style={styles.hx}>
                <Feather name="x" size={16} color={colors.dim} />
              </Pressable>
            ) : null}
          </View>

          <Text style={styles.note}>
            {refresh
              ? `Yeni ${kind === 'tower' ? 'sayı' : 'kelime'} · ◈ ${refreshCost} Sefer Verisi · saldırganın biriktirdiği ipuçları silinir`
              : kind === 'tower'
                ? 'Rakip çözmeye çalışır · 3 farklı rakam · belirlemek ücretsiz'
                : 'Rakip çözmeye çalışır · geçerli kelime — girmezsen SAVUNMASIZ kalır · ücretsiz'}
          </Text>
          {refresh && veri != null ? (
            <View style={styles.veriLine}>
              <Feather name="hexagon" size={12} color={cantAfford ? colors.danger : colors.teal} />
              <Text style={[styles.veriLineText, cantAfford && { color: colors.danger }]}>
                {cantAfford ? `Yetersiz — kesende ◈ ${veri}` : `Sefer kesen · ◈ ${veri}`}
              </Text>
            </View>
          ) : null}

          {kind === 'tower' ? (
            <>
              <NumPad
                entry={entry}
                locked={busy}
                onDigit={(d) => setEntry((g) => (g.length >= 3 || g.includes(d) ? g : [...g, d]))}
                onDelete={() => setEntry((g) => g.slice(0, -1))}
              />
              <Pressable onPress={submit} disabled={busy || entry.length < 3 || cantAfford} style={[styles.confirm, (busy || entry.length < 3 || cantAfford) && styles.confirmOff]}>
                <Text style={styles.confirmText}>Şifreyi Kur</Text>
              </Pressable>
            </>
          ) : (
            <WordEntry
              length={level}
              entry={entry}
              busy={busy || cantAfford}
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
    paddingBottom: 26, gap: 12, overflow: 'hidden',
  },
  // Fetih sonrası "şifre kur" — dikkat çekmek için kırmızı çerçeve + üst şerit.
  sheetAlert: { borderColor: withAlpha(AGE.red, 0.7), borderTopWidth: 2 },
  beam: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 3,
    borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: AGE.blue,
  },
  beamAlert: { height: 4, backgroundColor: AGE.red, boxShadow: `0 0 16px ${AGE.red}` },
  kickerAlert: { color: AGE.red, fontWeight: '900' },
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
  defHist: { maxHeight: 92, alignSelf: 'stretch' },
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
  attackerText: { fontFamily: mono, fontSize: 11, color: colors.dim, flex: 1 },
  gaugeWrap: { flex: 1, gap: 6 },
  gaugeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  gaugeLabel: { fontFamily: mono, fontSize: 10, color: colors.dim, width: 58 },
  gaugeTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: withAlpha('#ffffff', 0.1),
    overflow: 'hidden',
  },
  gaugeFill: { height: '100%', borderRadius: 4 },
  slots: { flexDirection: 'row', gap: 6 },
  slot: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)' },
  slotOn: { backgroundColor: colors.amber },
  freeNote: { fontFamily: mono, fontSize: 10, color: colors.dim, textAlign: 'center', lineHeight: 15 },
  veriLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  veriLineText: { fontFamily: mono, fontSize: 11, fontWeight: '800', color: colors.teal },
  sabCol: { gap: 8 },
  sabPick: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 13,
    borderRadius: 12, backgroundColor: colors.glass, borderWidth: 1, borderColor: withAlpha(colors.success, 0.4),
  },
  sabTexts: { flex: 1, gap: 2 },
  sabFog: { borderColor: 'rgba(169,199,238,0.45)' },
  sabThief: { borderColor: withAlpha(colors.violet, 0.45) },
  sabOff: { opacity: 0.4 },
  sabTitle: { fontFamily: mono, fontSize: 12, fontWeight: '800', color: colors.ice },
  sabDesc: { fontFamily: mono, fontSize: 9.5, color: colors.dim, lineHeight: 13 },
  sabCost: { fontFamily: mono, fontSize: 11, fontWeight: '800', color: colors.teal },
  sabCostFree: { fontFamily: mono, fontSize: 11, fontWeight: '800', color: colors.success },
  chosenRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
  chosenChip: {
    flex: 1, fontFamily: mono, fontSize: 12, fontWeight: '800', color: colors.ice,
    paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1,
    borderColor: colors.glassBorder, backgroundColor: colors.glass, textAlign: 'center',
  },
  chosenClock: { fontFamily: mono, fontSize: 14, fontWeight: '800', color: colors.amber, minWidth: 42, textAlign: 'right' },
  randomBtn: { alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.glassBorder, backgroundColor: colors.glass },
  randomText: { fontFamily: mono, fontSize: 12, fontWeight: '700', color: colors.dim, letterSpacing: 0.5, textTransform: 'uppercase' },
});
