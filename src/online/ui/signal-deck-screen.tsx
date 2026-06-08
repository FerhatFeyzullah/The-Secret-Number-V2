import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth';
import { getMyRank, OnlineError, setSignalDeck } from '@/online';
import { getSignal } from '@/signals/catalog';
import { getSeen, markSeen } from '@/storage';
import { InfoModal, type InfoSection } from '@/ui/info-modal';
import { Screen } from '@/ui/screen';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';

const DECK_MAX = 6;

const DECK_INTRO: InfoSection[] = [
  {
    icon: 'grid',
    accent: colors.cyan,
    title: 'Deste Nedir?',
    body: 'Maç sonunda kullanacağın en çok 6 sinyali burada seçersin.',
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

const errMsg = (e: unknown) =>
  e instanceof OnlineError ? e.message : 'Kaydedilemedi, tekrar dene.';

/** Sinyallerim / Deste düzenleyici: sahip olunan sinyallerden ≤6'lık kalıcı deste
 *  (set_signal_deck — sunucu otoriteli). Anlık kayıt, en az 1 sinyal korunur. */
export function SignalDeckScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [deck, setDeck] = useState<string[]>([]);
  const [owned, setOwned] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2200);
  }, []);
  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const r = await getMyRank();
      setOwned(r.ownedSignals);
      setDeck(r.signalDeck);
    } catch (e) {
      setError(e instanceof OnlineError ? e.message : 'Yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) void load();
    else setLoading(false);
  }, [session, load]);

  // İlk-kez tanıtım (flicker-safe).
  const [introVisible, setIntroVisible] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const seen = await getSeen('signalDeck');
      if (alive && !seen) setIntroVisible(true);
    })();
    return () => {
      alive = false;
    };
  }, []);
  const openIntro = useCallback(() => setIntroVisible(true), []);
  const closeIntro = useCallback(() => {
    setIntroVisible(false);
    void markSeen('signalDeck');
  }, []);

  // Anlık kayıt: optimistik güncelle, hata olursa geri al + mesaj.
  const apply = useCallback(
    async (next: string[]) => {
      const prev = deck;
      setDeck(next);
      try {
        await setSignalDeck(next);
      } catch (e) {
        setDeck(prev);
        flash(errMsg(e));
      }
    },
    [deck, flash],
  );

  const toggle = useCallback(
    (id: string) => {
      if (deck.includes(id)) {
        if (deck.length <= 1) {
          flash('Deste en az 1 sinyal içermeli.');
          return;
        }
        void apply(deck.filter((x) => x !== id));
      } else {
        if (deck.length >= DECK_MAX) {
          flash('Deste dolu (6) — önce birini çıkar.');
          return;
        }
        void apply([...deck, id]);
      }
    },
    [deck, apply, flash],
  );

  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
        <Feather name="arrow-left" size={18} color={colors.text} />
      </Pressable>
      <Text style={styles.title}>SİNYALLERİM</Text>
      <Pressable onPress={openIntro} hitSlop={10} style={styles.help}>
        <Feather name="help-circle" size={17} color={colors.cyan} />
      </Pressable>
    </View>
  );

  let body;
  if (!session) {
    body = (
      <View style={styles.centered}>
        <Feather name="lock" size={26} color={colors.dim} />
        <Text style={styles.centeredText}>Deste hesabına bağlıdır.{'\n'}Görmek için giriş yapmalısın.</Text>
        <Pressable
          onPress={() => router.push({ pathname: '/auth', params: { next: '/signal-deck' } })}
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
  } else if (error) {
    body = (
      <View style={styles.centered}>
        <Feather name="alert-circle" size={24} color={colors.danger} />
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={() => void load()} style={styles.signInBtn}>
          <Text style={styles.signInText}>Tekrar Dene</Text>
        </Pressable>
      </View>
    );
  } else {
    const extras = owned.filter((id) => !deck.includes(id));
    body = (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* DESTEM */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionLabel}>DESTEM</Text>
          <Text style={styles.count}>
            <Text style={{ color: colors.cyan }}>{deck.length}</Text>
            <Text style={{ color: colors.dim }}> / {DECK_MAX}</Text>
          </Text>
        </View>
        <View style={styles.slots}>
          {Array.from({ length: DECK_MAX }).map((_, i) => {
            const id = deck[i];
            const sig = id ? getSignal(id) : undefined;
            if (sig) {
              const Icon = sig.component;
              return (
                <Pressable key={i} onPress={() => toggle(sig.id)} style={[styles.slot, styles.slotFull]}>
                  <Icon size={42} animated />
                  <View style={styles.slotRemove}>
                    <Feather name="x" size={10} color={colors.bgTop} />
                  </View>
                </Pressable>
              );
            }
            return (
              <View key={i} style={[styles.slot, styles.slotEmpty]}>
                <Feather name="plus" size={18} color={withAlpha(colors.dim, 0.5)} />
              </View>
            );
          })}
        </View>
        <Text style={styles.hint}>Slottaki sinyale dokun → desteden çıkar</Text>

        {/* SAHİP OLDUKLARIM */}
        <View style={[styles.sectionHead, { marginTop: 20 }]}>
          <Text style={styles.sectionLabel}>SAHİP OLDUKLARIM</Text>
          <Text style={styles.count}>
            <Text style={{ color: colors.teal }}>{owned.length}</Text>
          </Text>
        </View>
        <View style={styles.grid}>
          {owned.map((id) => {
            const sig = getSignal(id);
            if (!sig) return null;
            const Icon = sig.component;
            const inDeck = deck.includes(id);
            return (
              <Pressable
                key={id}
                onPress={() => toggle(id)}
                style={({ pressed }) => [styles.card, inDeck && styles.cardInDeck, pressed && styles.cardPressed]}>
                <View style={inDeck ? styles.dimIcon : undefined}>
                  <Icon size={52} animated={false} />
                </View>
                <Text style={styles.cardName} numberOfLines={1}>
                  {sig.name}
                </Text>
                {inDeck ? (
                  <View style={styles.deckTag}>
                    <Feather name="check" size={10} color={colors.cyan} />
                    <Text style={styles.deckTagText}>Destede</Text>
                  </View>
                ) : (
                  <Text style={styles.addText}>+ Ekle</Text>
                )}
              </Pressable>
            );
          })}
        </View>

        {extras.length === 0 ? (
          <Pressable onPress={() => router.push('/store')} style={styles.shopHint}>
            <Feather name="shopping-bag" size={13} color={colors.cyan} />
            <Text style={styles.shopHintText}>Daha fazla sinyal için Mağaza’ya git</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    );
  }

  return (
    <Screen>
      {header}
      {notice ? (
        <View style={styles.notice}>
          <Feather name="info" size={13} color={colors.amber} />
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}
      {body}

      <InfoModal
        visible={introVisible}
        onClose={closeIntro}
        title="SİNYALLERİM"
        icon="grid"
        accent={colors.cyan}
        sections={DECK_INTRO}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
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
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 3,
    color: colors.ice,
    fontFamily: mono,
    textShadowColor: cyanAlpha(0.5),
    textShadowRadius: 10,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
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
  scroll: {
    paddingBottom: 28,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 2,
    color: colors.dim,
    fontFamily: mono,
    fontWeight: '800',
  },
  count: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: mono,
  },
  slots: {
    flexDirection: 'row',
    gap: 8,
  },
  slot: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotFull: {
    backgroundColor: cyanAlpha(0.1),
    borderWidth: 1.5,
    borderColor: cyanAlpha(0.5),
  },
  slotEmpty: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.14)',
  },
  slotRemove: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    fontSize: 9,
    color: withAlpha(colors.dim, 0.7),
    fontFamily: mono,
    textAlign: 'center',
    marginTop: 8,
    letterSpacing: 0.3,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    // Sabit genişlik + flexGrow YOK → tek kalan kart iki kart enine yayılmaz;
    // satır eksikse soldan hizalı kalır (grid justify default flex-start).
    // %30 + 10px gap dar ekranda da 3 sütunu güvenle sığdırır (sarmaz).
    width: '30%',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  cardInDeck: {
    borderColor: cyanAlpha(0.4),
    backgroundColor: cyanAlpha(0.08),
  },
  cardPressed: {
    transform: [{ scale: 0.97 }],
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  dimIcon: {
    opacity: 0.5,
  },
  cardName: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  deckTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 20,
    backgroundColor: cyanAlpha(0.12),
    borderWidth: 1,
    borderColor: cyanAlpha(0.32),
  },
  deckTagText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.cyan,
    fontFamily: mono,
    letterSpacing: 0.3,
  },
  addText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.dim,
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  shopHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 18,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: cyanAlpha(0.3),
    backgroundColor: cyanAlpha(0.08),
  },
  shopHintText: {
    fontSize: 12,
    color: colors.cyan,
    fontFamily: mono,
    letterSpacing: 0.3,
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
