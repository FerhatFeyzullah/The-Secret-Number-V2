import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth';
import { isOnline } from '@/net';
import {
  enterTower,
  getTowerState,
  OnlineError,
  startTowerFloor,
  type TowerGuessOutcome,
  type TowerState,
} from '@/online';
import { getSeen, markSeen } from '@/storage';
import { InfoModal, type InfoSection } from '@/ui/info-modal';
import { Screen, TAB_EDGES } from '@/ui/screen';
import { colors, cyanAlpha, mono } from '@/ui/theme';
import { TowerFloor } from './tower-floor';
import { TowerLadder } from './tower-ladder';
import { TowerList } from './tower-list';
import { TowerResult } from './tower-result';

type View4 = 'list' | 'ladder' | 'floor' | 'result';

/** İlk kez giren için tanıtım (getSeen('towerIntro') ile bir kez gösterilir). */
const INTRO: InfoSection[] = [
  {
    icon: 'award',
    title: 'SÜRELİ KULE',
    body: "10 katlı kuleye tırman. Her kat, boss'un gizli kelimesini süre bitmeden çözmektir. Dönem 3 gün sürer.",
    accent: colors.gold,
  },
  {
    icon: 'heart',
    title: '3 CAN',
    body: 'Katı geçemezsen bir can gider ve kelime yenilenir. 3 can biterse elenirsin — o dönem kapanır, tekrar giriş yok.',
    accent: colors.danger,
  },
  {
    icon: 'eye-off',
    title: 'FANTASTİK GÜÇLER',
    body: 'Katlar zorlaştıkça sis, zaman hırsızı, kilit gibi güçler geri bildirimini bozar. Ama doğru tahmin asla bozulmaz.',
    accent: colors.violet,
  },
  {
    icon: 'gift',
    title: 'ÖDÜLLER',
    body: "Her kat Veri + Kupa kazandırır; art arda geçtikçe kupa artar (10, 12, 14…), kaybedince 10'a döner. Boss katları (5 & 10) özel protokol/sinyal verir.",
    accent: colors.amber,
  },
  {
    icon: 'log-in',
    title: 'GİRİŞ',
    body: 'Turnuvaya giriş 300 Veri. Elenene ya da tepeye ulaşana kadar tırman; ne kadar yükselirsen o kadar ödül.',
    accent: colors.cyan,
  },
];

/** Turnuva sekmesi (/cup) — Gizemli Kule. Merdiven ↔ oynanış ↔ sonuç. */
export function TowerScreen() {
  const router = useRouter();
  const { session } = useAuth();

  const [state, setState] = useState<TowerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View4>('list');
  const [result, setResult] = useState<TowerGuessOutcome | null>(null);
  const [showIntro, setShowIntro] = useState(false);

  const load = useCallback(
    async (spinner: boolean) => {
      if (!session) {
        setLoading(false);
        return;
      }
      if (spinner) setLoading(true);
      setError(null);
      try {
        setState(await getTowerState());
      } catch (e) {
        setError(e instanceof OnlineError ? e.message : 'Turnuva yüklenemedi.');
      } finally {
        if (spinner) setLoading(false);
      }
    },
    [session],
  );

  const loadedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!session) {
        setLoading(false);
        return;
      }
      // Oynarken/sonuçta sekmeye geri dönüşte state'i ezme (aktif kat saati bozulmasın).
      if (view === 'floor' || view === 'result') return;
      if (!loadedRef.current) {
        loadedRef.current = true;
        void load(true);
      } else {
        void load(false);
      }
    }, [session, load, view]),
  );

  const enter = useCallback(async () => {
    if (busy) return;
    // İlk giriş denemesinde önce tanıtım modalı (henüz Veri ödenmez). Okuyup
    // kapatınca "Giriş"e tekrar basınca gerçek giriş olur → saat boşa akmaz.
    if (!(await getSeen('towerIntro'))) {
      setShowIntro(true);
      return;
    }
    if (!(await isOnline())) {
      setError('Turnuva için internet bağlantısı gerekli.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const s = await enterTower();
      setState(s);
      setView('floor');
    } catch (e) {
      setError(e instanceof OnlineError ? e.message : 'Girilemedi.');
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const cont = useCallback(async () => {
    if (busy || !state) return;
    if (!(await isOnline())) {
      setError('Turnuva için internet bağlantısı gerekli.');
      return;
    }
    // Aktif kat varsa doğrudan oyna; yoksa (kat arası) sunucudan aç.
    if (state.active) {
      setView('floor');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const s = await startTowerFloor();
      setState(s);
      setView('floor');
    } catch (e) {
      setError(e instanceof OnlineError ? e.message : 'Kat açılamadı.');
    } finally {
      setBusy(false);
    }
  }, [busy, state]);

  const backToLadder = useCallback(() => {
    setView('ladder');
    void load(false);
  }, [load]);

  const onFinished = useCallback(
    (o: TowerGuessOutcome) => {
      setResult(o);
      setView('result');
      void load(false);
    },
    [load],
  );

  // ── Oturum kapısı ──
  if (!session) {
    return (
      <Screen edges={TAB_EDGES}>
        <View style={styles.gate}>
          <Feather name="lock" size={26} color={colors.dim} />
          <Text style={styles.gateText}>Turnuva hesabına bağlıdır.{'\n'}Görmek için giriş yapmalısın.</Text>
          <Pressable
            onPress={() => router.push({ pathname: '/auth', params: { next: '/' } })}
            style={styles.gateBtn}>
            <Text style={styles.gateBtnText}>Giriş Yap</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  // ── Oynanış ──
  if (view === 'floor' && state) {
    return (
      <Screen edges={TAB_EDGES} float="letters">
        <TowerFloor initialState={state} onExit={backToLadder} onFinished={onFinished} />
      </Screen>
    );
  }

  // ── Sonuç ──
  if (view === 'result' && result && state) {
    return (
      <Screen edges={TAB_EDGES} float="letters">
        <TowerResult outcome={result} state={state} onDone={backToLadder} />
      </Screen>
    );
  }

  // ── Merdiven (varsayılan) ──
  return (
    <Screen edges={TAB_EDGES} float="letters">
      {loading ? (
        <View style={styles.gate}>
          <ActivityIndicator color={colors.cyan} />
        </View>
      ) : error && !state ? (
        <View style={styles.gate}>
          <Feather name="alert-circle" size={24} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => void load(true)} style={styles.gateBtn}>
            <Text style={styles.gateBtnText}>Tekrar Dene</Text>
          </Pressable>
        </View>
      ) : state ? (
        <>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {view === 'ladder' ? (
            <TowerLadder
              state={state}
              busy={busy}
              onEnter={enter}
              onContinue={cont}
              onBack={() => setView('list')}
            />
          ) : (
            <TowerList state={state} onSelect={() => setView('ladder')} />
          )}
        </>
      ) : null}

      <InfoModal
        visible={showIntro}
        onClose={() => {
          setShowIntro(false);
          void markSeen('towerIntro');
        }}
        title="GİZEMLİ KULE"
        icon="award"
        accent={colors.gold}
        sections={INTRO}
        ctaLabel="Anladım"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 },
  gateText: { color: colors.dim, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  errorText: { color: colors.danger, fontSize: 13, textAlign: 'center', paddingVertical: 6 },
  gateBtn: {
    marginTop: 6, paddingVertical: 10, paddingHorizontal: 22, borderRadius: 12,
    borderWidth: 1, borderColor: cyanAlpha(0.4), backgroundColor: cyanAlpha(0.12),
  },
  gateBtnText: { color: colors.cyan, fontWeight: '800', fontFamily: mono, letterSpacing: 1 },
});
