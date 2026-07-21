import { Feather } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth';
import { OnlineError, setSignalDeck, useRank } from '@/online';
import { getSeen, markSeen } from '@/storage';
import { InfoModal, type InfoSection } from '@/ui/info-modal';
import { Screen, TAB_EDGES } from '@/ui/screen';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';

import { ProtocolTreePanel } from './protocol-tree-screen';
import { DECK_MAX, SignalDeckPanel } from './signal-deck-screen';

type Tab = 'emoji' | 'proto';

const DECK_INTRO: InfoSection[] = [
  {
    icon: 'grid',
    accent: colors.cyan,
    title: 'Deste Nedir?',
    body: 'Maç sırasında ve sonunda kullanacağın en çok 6 sinyali burada seçersin.',
  },
  {
    icon: 'lock',
    accent: colors.teal,
    title: 'Kalıcı',
    body: 'Deste kaydedilir; sen değiştirene kadar sabit kalır (maç başında sıfırlanmaz).',
  },
  {
    icon: 'shopping-bag',
    accent: colors.violet,
    title: 'Daha Fazlası',
    body: 'Yeni sinyalleri Mağaza’dan Veri ile alıp destene ekleyebilirsin.',
  },
];

const PROTO_INTRO: InfoSection[] = [
  {
    icon: 'cpu',
    accent: colors.cyan,
    title: 'Protokol Nedir?',
    body: 'Protokol Maçı’nda kullanabileceğin özel güçler. 4 kategori: Bilgi, Zaman, Sabotaj, Savunma.',
  },
  {
    icon: 'unlock',
    accent: colors.teal,
    title: 'Nasıl Açılır?',
    body: 'Her protokolün bir Seviye kapısı vardır. Seviyene ulaşınca Veri harcayarak açarsın (bazıları başta açıktır).',
  },
  {
    icon: 'layers',
    accent: colors.violet,
    title: 'Maçta Nasıl Kullanılır?',
    body: 'Açtığın protokoller Protokol Maçı başında “Kader Eli” ile karşına rastgele gelir; seçtiklerini düelloda alt şeritten kullanırsın.',
  },
  {
    icon: 'info',
    accent: colors.amber,
    title: 'Detay',
    body: 'Bir karta dokun → o protokolün tam açıklamasını, seviyesini ve Veri maliyetini gör.',
  },
];

const errMsg = (e: unknown) =>
  e instanceof OnlineError ? e.message : 'İşlem başarısız, tekrar dene.';
const fmtVeri = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const SUBTABS: { key: Tab; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'emoji', label: 'Emoji', icon: 'smile' },
  { key: 'proto', label: 'Protokoller', icon: 'cpu' },
];

/** Donanım sekmesi: Emoji (sinyal destesi) + Protokoller tek ekranda, iki alt-tab.
 *  Veri/sahiplik tek getMyRank'tan gelir; paneller saf. Odakta sessiz tazeleme. */
export function DonanimScreen() {
  const router = useRouter();
  const { session } = useAuth();
  // Ortak rank store — TEK doğruluk kaynağı (bkz. RankProvider). Donanım kendi
  // kopyasını tutmaz: deste/satın alma patch'ler → tüm yüzeyler anında güncel.
  const { rank: data, error: rankError, refresh, patch } = useRank();
  const [tab, setTab] = useState<Tab>('emoji');

  // Deste uyarıları (dolu / en az 1 / kayıt hatası).
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2200);
  }, []);
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  // Route'a dönünce tazele (maç/ayar dönüşü). Pager swipe'ında zaten patch ile güncel.
  useFocusEffect(
    useCallback(() => {
      if (session) void refresh();
    }, [session, refresh]),
  );

  // Rank henüz gelmediyse: hata yoksa spinner, hata varsa tekrar-dene.
  const loading = session && !data && !rankError;
  const loadFailed = session && !data && rankError;

  // İlk-kez tanıtım: aktif sekmeye göre, YALNIZCA sekme odaktayken (lazy mount'ta
  // arka planda açılmasın). "?" butonu her zaman açar.
  const [introTab, setIntroTab] = useState<Tab | null>(null);
  const isFocused = useIsFocused();
  useEffect(() => {
    if (!isFocused || !session) return;
    let alive = true;
    const key = tab === 'emoji' ? 'signalDeck' : 'protocolsPage';
    void (async () => {
      const seen = await getSeen(key);
      if (alive && !seen) setIntroTab(tab);
    })();
    return () => {
      alive = false;
    };
  }, [isFocused, session, tab]);
  const openHelp = useCallback(() => setIntroTab(tab), [tab]);
  const closeIntro = useCallback(() => {
    const key = introTab === 'proto' ? 'protocolsPage' : 'signalDeck';
    setIntroTab(null);
    void markSeen(key);
  }, [introTab]);

  const veri = data?.veri ?? 0;
  const ownedSignals = data?.ownedSignals ?? [];
  const signalDeck = data?.signalDeck ?? [];
  const ownedProtocols = data?.owned ?? [];
  const level = data?.level ?? 1;

  // Deste düzenleme: optimistik güncelle + kalıcı kaydet (sunucu otoriteli); hata
  // olursa geri al + uyarı. En az 1, en çok 6 sinyal.
  const applyDeck = useCallback(
    async (next: string[]) => {
      const prev = data?.signalDeck ?? [];
      patch({ signalDeck: next });
      try {
        await setSignalDeck(next);
      } catch (e) {
        patch({ signalDeck: prev });
        flash(errMsg(e));
      }
    },
    [data, patch, flash],
  );
  const toggleSignal = useCallback(
    (id: string) => {
      const deck = data?.signalDeck ?? [];
      if (deck.includes(id)) {
        if (deck.length <= 1) {
          flash('Deste en az 1 sinyal içermeli.');
          return;
        }
        void applyDeck(deck.filter((x) => x !== id));
      } else {
        if (deck.length >= DECK_MAX) {
          flash('Deste dolu (6) — önce birini çıkar.');
          return;
        }
        void applyDeck([...deck, id]);
      }
    },
    [data, applyDeck, flash],
  );

  const onBought = useCallback(
    (v: number, owned: string[]) => {
      patch({ veri: v, owned });
    },
    [patch],
  );

  let body;
  if (!session) {
    body = (
      <View style={styles.centered}>
        <Feather name="lock" size={26} color={colors.dim} />
        <Text style={styles.centeredText}>
          Donanım hesabına bağlıdır.{'\n'}Görmek için giriş yapmalısın.
        </Text>
        <Pressable
          onPress={() => router.push({ pathname: '/auth', params: { next: '/gear' } })}
          style={styles.signInBtn}>
          <Text style={styles.signInText}>Giriş Yap</Text>
        </Pressable>
      </View>
    );
  } else if (loading) {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.cyan} />
      </View>
    );
  } else if (loadFailed) {
    body = (
      <View style={styles.centered}>
        <Feather name="alert-circle" size={24} color={colors.danger} />
        <Text style={styles.errorText}>Donanım yüklenemedi.</Text>
        <Pressable onPress={() => void refresh()} style={styles.signInBtn}>
          <Text style={styles.signInText}>Tekrar Dene</Text>
        </Pressable>
      </View>
    );
  } else if (tab === 'emoji') {
    body = <SignalDeckPanel owned={ownedSignals} deck={signalDeck} onToggle={toggleSignal} />;
  } else {
    body = (
      <ProtocolTreePanel owned={ownedProtocols} level={level} veri={veri} onBought={onBought} />
    );
  }

  return (
    <Screen edges={TAB_EDGES}>
      {/* Başlık: DONANIM + Veri + yardım (aktif sekmeye göre) */}
      <View style={styles.header}>
        <View style={styles.titleWrap}>
          <Feather name="layers" size={18} color={colors.cyan} />
          <Text style={styles.title}>DONANIM</Text>
        </View>
        <View style={styles.headerRight}>
          {session && data ? (
            <View style={styles.veriBalance}>
              <Feather name="hexagon" size={13} color={colors.teal} />
              <Text style={styles.veriText}>{fmtVeri(veri)}</Text>
            </View>
          ) : null}
          <Pressable onPress={openHelp} hitSlop={10} style={styles.help}>
            <Feather name="help-circle" size={17} color={colors.cyan} />
          </Pressable>
        </View>
      </View>

      {/* Alt-tab: Emoji / Protokoller */}
      <View style={styles.subtabs}>
        {SUBTABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.subtab, active && styles.subtabActive]}>
              <Feather name={t.icon} size={14} color={active ? colors.cyan : colors.dim} />
              <Text style={[styles.subtabText, active && styles.subtabTextActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {notice ? (
        <View style={styles.notice}>
          <Feather name="info" size={13} color={colors.amber} />
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      <View style={styles.body}>{body}</View>

      <InfoModal
        visible={introTab === 'emoji'}
        onClose={closeIntro}
        title="SİNYALLERİM"
        icon="grid"
        accent={colors.cyan}
        sections={DECK_INTRO}
      />
      <InfoModal
        visible={introTab === 'proto'}
        onClose={closeIntro}
        title="PROTOKOLLER"
        icon="cpu"
        accent={colors.cyan}
        sections={PROTO_INTRO}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 12,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 3,
    color: colors.ice,
    fontFamily: mono,
    textShadowColor: cyanAlpha(0.5),
    textShadowRadius: 10,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  help: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: withAlpha(colors.cyan, 0.4),
    alignItems: 'center',
    justifyContent: 'center',
  },
  veriBalance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: withAlpha(colors.teal, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(colors.teal, 0.4),
  },
  veriText: {
    color: colors.teal,
    fontSize: 12,
    fontWeight: '800',
    fontFamily: mono,
  },
  subtabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  subtab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glass,
  },
  subtabActive: {
    borderColor: cyanAlpha(0.5),
    backgroundColor: cyanAlpha(0.12),
  },
  subtabText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    color: colors.dim,
    fontFamily: mono,
  },
  subtabTextActive: {
    color: colors.cyan,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: withAlpha(colors.amber, 0.35),
    backgroundColor: withAlpha(colors.amber, 0.1),
  },
  noticeText: {
    flex: 1,
    fontSize: 12,
    color: colors.amber,
  },
  body: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  centeredText: {
    color: colors.dim,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
  },
  signInBtn: {
    marginTop: 6,
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: cyanAlpha(0.4),
    backgroundColor: cyanAlpha(0.12),
  },
  signInText: {
    color: colors.cyan,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 1,
  },
});
