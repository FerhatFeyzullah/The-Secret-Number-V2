import { Feather } from '@expo/vector-icons';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  ageAbandonAttack,
  ageAttackGuess,
  ageDefenseGuess,
  ageFindMatch,
  ageLeave,
  ageRefreshCode,
  ageSetCode,
  ageStartAttack,
  ageStartDefense,
  OnlineError,
  useAgeMatch,
  type AgeDefenseStart,
  type AgeKind,
  type AgeSabotageChoice,
  type AgeTerritory,
} from '@/online';
import { colors, mono, withAlpha } from '@/ui/theme';
import { AgeBackground } from './age-bg';
import { AgeEliminated } from './age-eliminated';
import { AgeMap } from './age-map';
import { AgeQueue } from './age-queue';
import { AgeResult } from './age-result';
import { AttackPanel, DefensePanel, SetCodePanel } from './age-panels';

const errMsg = (e: unknown) =>
  e instanceof OnlineError ? e.message : 'Bağlantı hatası, lütfen tekrar dene.';

type Sheet =
  | { t: 'attack'; territoryId: string; kind: AgeKind; level: number; targetName: string; defended: boolean }
  | { t: 'defense'; attackId: string; territoryId: string; start: AgeDefenseStart; solvedCount: number }
  | { t: 'setcode'; territoryId: string; kind: AgeKind; level: number; deadline: string | null }
  | { t: 'refresh'; territoryId: string; kind: AgeKind; level: number }
  | null;

/** Gizem Çağı maç ekranı — faz yönlendirme + panel etkileşimleri (orkestratör). */
export function AgeMatchScreen({ matchId }: { matchId: string }) {
  const router = useRouter();
  const navigation = useNavigation();
  const { state, loading, error, refresh } = useAgeMatch(matchId);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const leavingRef = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const me = state?.me ?? '';
  const meElim = !!state?.players.find((p) => p.player === me)?.eliminated;
  const byId = state ? Object.fromEntries(state.territories.map((t) => [t.id, t])) : {};
  const nameOf = (pid: string | null) =>
    (pid && state?.players.find((p) => p.player === pid)?.username) || 'Bot';

  // Elenince açık paneli kapat (artık etkileşim yok).
  useEffect(() => {
    if (meElim) setSheet(null);
  }, [meElim]);

  // Maç iptal → menüye.
  useEffect(() => {
    if (state?.phase === 'cancelled' && !leavingRef.current) {
      leavingRef.current = true;
      showToast('Maç iptal edildi.');
      router.back();
    }
  }, [state?.phase, router, showToast]);

  // Çıkış onayı (prep/war = elenirsin). Queue/finished serbest.
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e: { preventDefault: () => void; data: { action: unknown } }) => {
      if (leavingRef.current || meElim) return; // elenen serbest çıkar
      const ph = state?.phase;
      if (ph !== 'prep' && ph !== 'war') return; // serbest çıkış
      e.preventDefault();
      Alert.alert('Maçtan çık', 'Çıkarsan toprakların düşer ve son sıraya gidersin. Emin misin?', [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Çık',
          style: 'destructive',
          onPress: () => {
            leavingRef.current = true;
            void ageLeave(matchId).catch(() => {});
            navigation.dispatch(e.data.action as never);
          },
        },
      ]);
    });
    return sub;
  }, [navigation, state?.phase, matchId, meElim]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      try {
        await fn();
      } catch (e) {
        showToast(errMsg(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, showToast],
  );

  // ── Saldırı ──
  const onTapNode = (t: AgeTerritory) => {
    if (!state) return;
    if (t.owner === me) {
      // Fetih penceresi hâlâ açıksa şifre belirlemeye dön.
      if (t.codeDeadline && Date.parse(t.codeDeadline) > Date.now()) {
        setSheet({ t: 'setcode', territoryId: t.id, kind: t.kind, level: t.level, deadline: t.codeDeadline });
        return;
      }
      // Kendi toprağın: Veri ile şifre yenile (kuşatmayı sıfırla). Yalnız savaşta anlamlı.
      if (state.phase !== 'war') return;
      if (t.kind === 'castle') {
        setSheet({ t: 'refresh', territoryId: t.id, kind: 'castle', level: t.level });
      } else {
        Alert.alert('Kule şifresini yenile', 'Bu kulenin şifresini yenile? Saldırganın ilerlemesi sıfırlanır (40 Veri).', [
          { text: 'Vazgeç', style: 'cancel' },
          { text: 'Yenile', onPress: () => void run(async () => { await ageRefreshCode(t.id); showToast('Şifre yenilendi.'); await refresh(); }) },
        ]);
      }
      return;
    }
    if (state.phase === 'prep' && t.owner !== null) {
      showToast('Burası çoktan alınmış.');
      return;
    }
    if (t.kind === 'castle') {
      const towers = state.territories.filter((x) => x.castleId === t.id);
      if (!towers.some((x) => x.owner === me)) {
        showToast('Bu kaleye ait bir nöbet kulen olmalı.');
        return;
      }
    }
    void run(async () => {
      const info = await ageStartAttack(t.id);
      setSheet({ t: 'attack', territoryId: t.id, kind: info.kind, level: info.level, targetName: nameOf(t.owner), defended: t.defended });
      await refresh();
    });
  };

  const onAttackGuess = (value: string) => {
    if (sheet?.t !== 'attack') return;
    const tid = sheet.territoryId;
    void run(async () => {
      const out = await ageAttackGuess(tid, value);
      if (out.status === 'conquered') {
        const t = byId[tid];
        setSheet({ t: 'setcode', territoryId: tid, kind: t?.kind ?? 'tower', level: t?.level ?? 3, deadline: out.codeDeadline });
        showToast('Fethedildi!');
      } else if (out.status === 'lost_race') {
        setSheet(null);
        showToast('Kaçırdın — başkası aldı.');
      } else if (out.status === 'expired') {
        setSheet(null);
        showToast('Süre doldu.');
      } else if (out.status === 'expired_renewed') {
        showToast('Süre doldu — gizli yenilendi.');
      }
      await refresh();
    });
  };

  const closeAttack = () => {
    if (sheet?.t === 'attack') {
      const tid = sheet.territoryId;
      void ageAbandonAttack(tid).catch(() => {});
    }
    setSheet(null);
    void refresh();
  };

  // ── Savunma ──
  const onDefend = (attackId: string, territoryId: string) => {
    void run(async () => {
      const start = await ageStartDefense(attackId);
      setSheet({ t: 'defense', attackId, territoryId, start, solvedCount: start.solvedCount });
      await refresh();
    });
  };
  const onDefenseSolve = (value: string, sabotage: AgeSabotageChoice) => {
    if (sheet?.t !== 'defense') return;
    const aid = sheet.attackId;
    void run(async () => {
      const out = await ageDefenseGuess(aid, value, sabotage);
      if (out.status === 'solved') {
        setSheet((s) => (s?.t === 'defense' ? { ...s, solvedCount: out.solvedCount } : s));
        showToast(sabotage === 'time' ? 'Çözdün — saldırgan −15 sn!' : sabotage === 'fog' ? 'Sis uygulandı.' : 'Zaman Hırsızı uygulandı.');
      } else if (out.status === 'attack_gone') {
        setSheet(null);
        showToast('Saldırı bitti.');
      }
      await refresh();
    });
  };

  // ── Şifre belirleme ──
  const onSetCode = (value: string) => {
    if (sheet?.t !== 'setcode') return;
    const tid = sheet.territoryId;
    void run(async () => {
      await ageSetCode(tid, value);
      setSheet(null);
      showToast('Şifre kuruldu.');
      await refresh();
    });
  };
  const closeSetCode = () => {
    setSheet(null);
    void refresh();
  };
  // Kale şifresi Veri ile yenileme (refresh sheet'ten yeni kelime).
  const onRefreshCastle = (value: string) => {
    if (sheet?.t !== 'refresh') return;
    const tid = sheet.territoryId;
    void run(async () => {
      await ageRefreshCode(tid, value);
      setSheet(null);
      showToast('Şifre yenilendi.');
      await refresh();
    });
  };

  // ── Çıkış / yeniden ──
  const leaveToMenu = () => {
    leavingRef.current = true;
    void ageLeave(matchId).catch(() => {});
    router.back();
  };
  const requeue = () => {
    void run(async () => {
      const { matchId: mid } = await ageFindMatch();
      router.replace({ pathname: '/age/[id]', params: { id: mid } });
    });
  };

  // ── Render ──
  if (!state) {
    return (
      <AgeBackground>
        <View style={styles.center}>
          {loading ? <ActivityIndicator color={colors.violet} /> : <Text style={styles.note}>{error ?? 'Maç bulunamadı.'}</Text>}
          <Pressable onPress={() => router.back()} style={styles.exitBtn}>
            <Text style={styles.exitText}>Geri Dön</Text>
          </Pressable>
        </View>
      </AgeBackground>
    );
  }

  const activeAttack =
    sheet?.t === 'attack' ? state.myAttacks.find((a) => a.territoryId === sheet.territoryId) : undefined;
  const incoming =
    sheet?.t === 'defense' ? state.incoming.find((i) => i.attackId === sheet.attackId) : undefined;

  return (
    <AgeBackground>
      <View style={styles.wrap}>
        {state.phase === 'finished' ? (
          <AgeResult state={state} onRequeue={requeue} onMenu={() => router.back()} />
        ) : meElim ? (
          <AgeEliminated state={state} onMenu={leaveToMenu} />
        ) : state.phase === 'queue' ? (
          <AgeQueue players={state.players} onCancel={leaveToMenu} />
        ) : (
          <AgeMap state={state} onTapNode={onTapNode} onDefend={onDefend} />
        )}
      </View>

      {sheet?.t === 'attack' ? (
        <AttackPanel
          kind={sheet.kind}
          level={sheet.level}
          targetName={sheet.targetName}
          defended={sheet.defended}
          attack={activeAttack}
          busy={busy}
          onGuess={onAttackGuess}
          onClose={closeAttack}
        />
      ) : null}

      {sheet?.t === 'defense' && incoming ? (
        <DefensePanel
          incoming={incoming}
          start={sheet.start}
          solvedCount={sheet.solvedCount}
          busy={busy}
          onSolve={onDefenseSolve}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet?.t === 'setcode' ? (
        <SetCodePanel
          kind={sheet.kind}
          level={sheet.level}
          deadline={sheet.deadline}
          mode="set"
          busy={busy}
          onSet={onSetCode}
          onRandom={closeSetCode}
        />
      ) : null}

      {sheet?.t === 'refresh' ? (
        <SetCodePanel
          kind={sheet.kind}
          level={sheet.level}
          deadline={null}
          mode="refresh"
          busy={busy}
          onSet={onRefreshCastle}
          onRandom={() => setSheet(null)}
        />
      ) : null}

      {toast ? (
        <View style={styles.toastWrap} pointerEvents="none">
          <View style={styles.toast}>
            <Feather name="info" size={13} color={colors.amber} />
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </View>
      ) : null}
    </AgeBackground>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  note: { color: colors.dim, fontFamily: mono, fontSize: 13 },
  exitBtn: { paddingVertical: 10, paddingHorizontal: 22, borderRadius: 12, borderWidth: 1, borderColor: colors.glassBorder, backgroundColor: colors.glass },
  exitText: { color: colors.text, fontFamily: mono, fontWeight: '700' },
  toastWrap: { position: 'absolute', top: 60, left: 0, right: 0, alignItems: 'center', zIndex: 200 },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12,
    borderWidth: 1, borderColor: withAlpha(colors.amber, 0.4), backgroundColor: 'rgba(10,20,40,0.98)',
  },
  toastText: { fontFamily: mono, fontSize: 12, color: colors.amber },
});
