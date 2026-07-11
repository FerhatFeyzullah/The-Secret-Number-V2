import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { parseWord, upperTr } from '@/game';
import { OnlineError, setSecret, type MatchState } from '@/online';
import { colors, mono, withAlpha } from '@/ui/theme';

import { rememberMySecret } from './secret-memory';
import { TrKeyboard } from './tr-keyboard';
import { WordConfirmButton } from './word-parts';

/** Kelime belirleme penceresi 60 sn (sayıda 30; sunucu _start_protocol_setup /
 *  _advance_or_finish kelimede 60/68 sn verir — 68'in ilk ~8 sn'i skor arası). */
export const WORD_SETUP_MS = 60_000;
const LOW_MS = 10_000;

const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `0:${String(s).padStart(2, '0')}`;
};

/** Kalan görsel süre (totalMs'e kelepçeli). Saf: Date.now(). */
const remainingFor = (deadline: number | null, totalMs: number) =>
  deadline == null ? totalMs : Math.min(totalMs, Math.max(0, deadline - Date.now()));

/** Break (skor arası, yalnız round ≥ 2) durumu — kuantize (inBreak + saniye). */
function breakStateFor(
  deadline: number | null,
  isInterRound: boolean,
): { inBreak: boolean; breakSec: number } {
  if (deadline == null || !isInterRound) return { inBreak: false, breakSec: 0 };
  const raw = deadline - Date.now();
  return { inBreak: raw > WORD_SETUP_MS, breakSec: Math.ceil(Math.max(0, raw - WORD_SETUP_MS) / 1000) };
}

const errMsg = (e: unknown) => {
  if (e instanceof OnlineError) {
    // Sunucu sözlük/uzunluk reddi: sayı-metinli genel mesaj yerine kelimeye özel.
    if (e.code === 'invalid_digits') return 'Bu kelime listede yok — yaygın bir Türkçe kelime seç.';
    return e.message;
  }
  return 'Bağlantı hatası, lütfen tekrar dene.';
};

/** Kelime belirleme paneli (WordDuelSetup tasarımı birebir): rozet + başlık +
 *  "N harfli kelime" pili + tile'lar + TR klavye + onay + "kilitlendi" overlay'i.
 *  Hem ilk belirleme route'unda hem turlar arası (duello içi) kullanılır.
 *  Uzunluk DİNAMİK: o turun match.wordLength'i (sunucu her tur yeniden zarlar). */
export function WordSetupPanel({
  matchId,
  match,
  active,
  lastRound,
  reveal,
}: {
  matchId: string;
  match: MatchState;
  /** Sayaç başladı mı (iki taraf present)? Değilse giriş pasif. */
  active: boolean;
  /** Biten turun sonucu (round ≥ 2 skor arası için); round 1'de null. */
  lastRound?: { winnerIsMe: boolean; reason: 'win' | 'timeout' } | null;
  /** Biten turun iki gizli kelimesi (break ekranında gösterilir); yoksa null. */
  reveal?: { mine: string | null; opponent: string | null } | null;
}) {
  const { width } = useWindowDimensions();
  const wordLength = match.wordLength ?? 5;

  const [typed, setTyped] = useState<string[]>([]);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Yeni tur: giriş/kilit sıfırla (uzunluk da değişmiş olabilir).
  useEffect(() => {
    setTyped([]);
    setLocked(false);
    setError(null);
  }, [match.currentRound, wordLength]);

  const p1 = match.myRole === 'player1';
  const myWins = p1 ? match.p1RoundWins : match.p2RoundWins;
  const oppWins = p1 ? match.p2RoundWins : match.p1RoundWins;
  const oppReady = p1 ? match.player2Ready : match.player1Ready;

  const deadline = match.setupDeadline ? Date.parse(match.setupDeadline) : null;
  // Break fazı (tur arası, round ≥ 2) KUANTİZE state — yalnız saniye/branch
  // değişince render. Sayaç pili ise kendi içinde tikleyen SetupTimer'da → panel
  // gövdesi (klavye/tile) 4×/sn render OLMAZ.
  const isInterRound = match.currentRound > 1;
  const [breakState, setBreakState] = useState(() => breakStateFor(deadline, isInterRound));
  useEffect(() => {
    const tick = () =>
      setBreakState((prev) => {
        const next = breakStateFor(deadline, isInterRound);
        return prev.inBreak === next.inBreak && prev.breakSec === next.breakSec ? prev : next;
      });
    tick();
    const iv = setInterval(tick, 250);
    return () => clearInterval(iv);
  }, [deadline, isInterRound]);
  const { inBreak, breakSec } = breakState;

  const complete = typed.length === wordLength;

  const handleKey = useCallback(
    (k: string) => {
      if (locked || !active) return;
      setError(null);
      setTyped((p) => (p.length < wordLength ? [...p, k] : p));
    },
    [locked, active, wordLength],
  );
  const handleDelete = useCallback(() => {
    if (locked) return;
    setTyped((p) => p.slice(0, -1));
  }, [locked]);

  const confirm = useCallback(async () => {
    if (locked || busy || !complete || !active) return;
    const word = typed.join('');
    const parsed = parseWord(word);
    if (!parsed.ok) {
      setError('Yalnız Türkçe harfler kullanılabilir.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setSecret(matchId, parsed.word, 'word');
      rememberMySecret(matchId, match.currentRound, parsed.word);
      setLocked(true);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [locked, busy, complete, active, typed, matchId, match.currentRound]);

  // ── Tur arası skor ekranı (round ≥ 2, ilk ~8 sn) ────────────────
  const resultText = !lastRound
    ? null
    : lastRound.reason === 'win'
      ? lastRound.winnerIsMe
        ? 'Rakibin kelimesini buldun! 🎯'
        : 'Rakip senin kelimeni buldu'
      : lastRound.winnerIsMe
        ? 'Rakibin süresi doldu'
        : 'Süren doldu';

  if (inBreak) {
    return (
      <View style={styles.breakCenter}>
        {resultText ? (
          <Text style={[styles.resultText, lastRound?.winnerIsMe && styles.resultWin]}>{resultText}</Text>
        ) : null}
        <View style={styles.score}>
          <Text style={styles.scoreLabel}>TUR {match.currentRound}</Text>
          <Text style={styles.scoreVal}>
            <Text style={{ color: colors.cyan }}>{myWins}</Text>
            <Text style={{ color: colors.dim }}> – </Text>
            <Text style={{ color: colors.amber }}>{oppWins}</Text>
          </Text>
        </View>

        {/* Biten turun İKİ kelimesi (result-overlay ifşa düzeni yansıtılır). */}
        <View style={styles.reveal}>
          <View style={styles.revealCol}>
            <Text style={styles.revealLabel}>SENİN KELİMEN</Text>
            <Text numberOfLines={1} style={[styles.revealWord, { color: colors.cyan }]}>
              {reveal?.mine?.toUpperCase() ?? '—'}
            </Text>
          </View>
          <View style={styles.revealDivider} />
          <View style={styles.revealCol}>
            <Text style={styles.revealLabel}>RAKİBİN KELİMESİ</Text>
            <Text numberOfLines={1} style={[styles.revealWord, { color: colors.amber }]}>
              {reveal?.opponent?.toUpperCase() ?? '—'}
            </Text>
          </View>
        </View>

        <Text style={styles.breakNext}>Tur {match.currentRound} başlıyor…</Text>
        <Text style={styles.breakCount}>{breakSec}</Text>
      </View>
    );
  }

  // Tile genişliği dinamik: 6 harf dar ekrana sığsın (tasarım 5 harf @56px).
  const tileW = Math.min(56, Math.floor((width - 40 - (wordLength - 1) * 10) / wordLength));
  const tileH = Math.round(tileW * (60 / 56));

  return (
    <View style={styles.root}>
      {/* Üst: maç rozeti + (sayaç) */}
      <View style={styles.badgeRow}>
        <View style={styles.badge}>
          <View style={styles.badgeDot} />
          <Text style={styles.badgeText}>1v1 düello</Text>
        </View>
        {active ? (
          <SetupTimer deadline={deadline} totalMs={WORD_SETUP_MS} lowMs={LOW_MS} />
        ) : (
          <Text style={styles.waitingText}>rakip bekleniyor…</Text>
        )}
      </View>

      <Text style={styles.h1}>Gizli kelimeni seç</Text>
      <Text style={styles.sub}>Rakibinin tahmin edeceği kelimeyi gir</Text>

      {/* Uzunluk pili — o TURUN random uzunluğu */}
      <View style={styles.pillRow}>
        <View style={styles.pill}>
          <Text style={styles.pillText}>{wordLength} harfli kelime</Text>
        </View>
        {match.winTarget > 1 ? (
          <Text style={styles.roundNote}>
            tur {match.currentRound} · {myWins}–{oppWins}
          </Text>
        ) : null}
      </View>

      {/* Harf tile'ları */}
      <View style={styles.tiles}>
        {Array.from({ length: wordLength }).map((_, i) => {
          const letter = typed[i];
          const isFilled = letter !== undefined;
          const isActive = i === typed.length && active && !locked;
          return (
            <View
              key={i}
              style={[
                styles.tile,
                { width: tileW, height: tileH },
                isFilled && styles.tileFilled,
                !isFilled && isActive && styles.tileActive,
              ]}>
              {isFilled ? <Text style={styles.tileLetter}>{upperTr(letter)}</Text> : null}
            </View>
          );
        })}
      </View>

      {/* Yönlendirme metni */}
      <Text style={styles.instruction}>
        {!active
          ? 'Rakip hazır olunca süre başlar'
          : typed.length === 0
            ? 'Klavyeden kelimeni yazmaya başla'
            : !complete
              ? `${wordLength - typed.length} harf daha`
              : 'Klavye üstündeki "Kelimeyi Belirle" butonuna dokun'}
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* Rakip durumu */}
      <View style={[styles.opp, oppReady && styles.oppReady]}>
        <View style={[styles.oppDot, { backgroundColor: oppReady ? colors.success : colors.amber }]} />
        <Text style={[styles.oppText, { color: oppReady ? colors.success : colors.amber }]}>
          {oppReady ? '✓ Rakip hazır' : 'Rakip kelimesini seçiyor…'}
        </Text>
      </View>

      <View style={styles.spacer} />

      {/* Klavye bloğu (tasarım: onay butonu klavyenin ÜSTÜNDE, koyu zemin).
          Onay tuşu klavyeden çıktı; tek aksiyon butonu burada. */}
      <View style={styles.kbWrap}>
        <WordConfirmButton
          label="Kelimeyi Belirle"
          enabled={complete && active && !locked}
          busy={busy}
          onPress={confirm}
        />
        <TrKeyboard onKey={handleKey} onDelete={handleDelete} locked={locked || !active} />
      </View>

      {/* Kilitlendi overlay'i */}
      {locked ? (
        <View style={styles.confirmedOverlay}>
          <View style={styles.confirmedCircle}>
            <Feather name="check" size={28} color="#4ADE80" />
          </View>
          <Text style={styles.confirmedTitle}>Kelime kilitlendi!</Text>
          <Text style={styles.confirmedSub}>{oppReady ? 'Düello başlıyor…' : 'Rakip bekleniyor…'}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Kendi içinde tikleyen sayaç pili — panelin geri kalanını 250 ms'de yenilemez. */
function SetupTimer({
  deadline,
  totalMs,
  lowMs,
}: {
  deadline: number | null;
  totalMs: number;
  lowMs: number;
}) {
  const [remaining, setRemaining] = useState(() => remainingFor(deadline, totalMs));
  useEffect(() => {
    if (deadline == null) {
      setRemaining(totalMs);
      return;
    }
    const tick = () => setRemaining(remainingFor(deadline, totalMs));
    tick();
    const iv = setInterval(tick, 250);
    return () => clearInterval(iv);
  }, [deadline, totalMs]);
  const low = remaining <= lowMs;
  return (
    <View style={[styles.timerChip, low && styles.timerChipLow]}>
      <Feather name="clock" size={11} color={low ? '#fca5a5' : colors.cyan} />
      <Text style={[styles.timerText, low && styles.timerTextLow]}>{fmtClock(remaining)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4ADE80',
    boxShadow: '0 0 8px #4ADE80',
  },
  badgeText: {
    color: '#4ADE80',
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontFamily: mono,
  },
  timerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 20,
    backgroundColor: 'rgba(47,168,224,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(47,168,224,0.3)',
  },
  timerChipLow: {
    backgroundColor: withAlpha(colors.danger, 0.12),
    borderColor: withAlpha(colors.danger, 0.45),
  },
  timerText: {
    color: colors.cyan,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: mono,
  },
  timerTextLow: {
    color: '#fca5a5',
  },
  waitingText: {
    color: colors.amber,
    fontSize: 11,
    fontFamily: mono,
  },
  h1: {
    color: '#E8F0FF',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    lineHeight: 26,
    marginBottom: 4,
  },
  sub: {
    color: '#6B8CAE',
    fontSize: 14,
    marginBottom: 16,
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  pill: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(47,168,224,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(47,168,224,0.25)',
  },
  pillText: {
    color: '#2FA8E0',
    fontFamily: mono,
    fontSize: 12,
    fontWeight: '600',
  },
  roundNote: {
    color: '#6B8CAE',
    fontSize: 11,
    fontFamily: mono,
  },
  tiles: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 20,
  },
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  tileActive: {
    borderColor: 'rgba(47,168,224,0.45)',
    boxShadow: '0 0 8px rgba(47,168,224,0.2)',
  },
  tileFilled: {
    backgroundColor: 'rgba(47,168,224,0.18)',
    borderColor: 'rgba(47,168,224,0.8)',
    boxShadow: '0 0 14px rgba(47,168,224,0.35)',
  },
  tileLetter: {
    fontFamily: mono,
    fontSize: 24,
    fontWeight: '700',
    color: '#E8F0FF',
  },
  instruction: {
    color: '#4B6B8A',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
    minHeight: 18,
  },
  error: {
    color: colors.danger,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 8,
  },
  opp: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  oppReady: {
    borderColor: withAlpha(colors.success, 0.4),
  },
  oppDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  oppText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  spacer: {
    flex: 1,
  },
  kbWrap: {
    // Screen yatay padding'i 20 — backdrop kenarlara KADAR uzanır (tam genişlik).
    marginHorizontal: -20,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    backgroundColor: 'rgba(6,12,26,0.7)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
    gap: 10,
  },
  confirmedOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    // Screen'in 20px yatay padding'ini aş — kbWrap'in marginHorizontal: -20 deseniyle aynı.
    left: -20,
    right: -20,
    zIndex: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(6,12,26,0.92)',
  },
  confirmedCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    backgroundColor: 'rgba(74,222,128,0.2)',
    borderWidth: 2,
    borderColor: '#4ADE80',
    boxShadow: '0 0 30px rgba(74,222,128,0.4)',
  },
  confirmedTitle: {
    color: '#4ADE80',
    fontWeight: '700',
    fontSize: 18,
  },
  confirmedSub: {
    marginTop: 8,
    fontSize: 13,
    color: '#6B8CAE',
  },
  breakCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  resultText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.amber,
  },
  resultWin: {
    color: colors.success,
  },
  score: {
    alignItems: 'center',
    gap: 4,
  },
  scoreLabel: {
    fontSize: 10,
    letterSpacing: 2,
    color: colors.dim,
    fontFamily: mono,
  },
  scoreVal: {
    fontSize: 28,
    fontWeight: '800',
    fontFamily: mono,
  },
  reveal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    alignSelf: 'stretch',
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  revealCol: {
    alignItems: 'center',
    flex: 1,
  },
  revealLabel: {
    fontSize: 8,
    color: colors.dim,
    fontFamily: mono,
    letterSpacing: 1,
    marginBottom: 6,
  },
  revealWord: {
    fontSize: 22,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 2,
    textShadowRadius: 14,
  },
  revealDivider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  breakNext: {
    fontSize: 12,
    color: colors.dim,
    fontFamily: mono,
    letterSpacing: 1,
  },
  breakCount: {
    fontSize: 34,
    fontWeight: '800',
    color: colors.cyan,
    fontFamily: mono,
    textShadowColor: 'rgba(47,168,224,0.6)',
    textShadowRadius: 12,
  },
});
