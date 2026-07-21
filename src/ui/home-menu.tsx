import { Feather, Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth, useProfile } from '@/auth';
import { LeagueBadge } from '@/leagues/badge';
import { LeagueMapModal } from '@/leagues/league-map-modal';
import { SeasonResetModal } from '@/leagues/season-reset-modal';
import { isOnline } from '@/net';
import { useRank } from '@/online';
import { LeaderboardModal, LevelUpOverlay, ProfileStatsModal, RecentMatchesModal } from '@/online/ui';
import {
  getLastMode,
  getLastSeenLevel,
  getLastSeenSeason,
  getSeen,
  getSeenWhatsnew,
  markSeen,
  setLastMode,
  setLastSeenLevel,
  setLastSeenSeason,
  setSeenWhatsnew,
  type GameMode,
} from '@/storage';
import { appVersionLabel } from '@/ui/app-version';
import { InfoModal } from '@/ui/info-modal';
import { useIntroDone } from '@/ui/intro-context';
import { InfoTipBubble, TIPS, type TipId } from '@/ui/info-tip';
import { WELCOME_INTRO } from '@/ui/welcome-intro';
import { WhatsNewModal, WHATSNEW_ID } from '@/ui/whatsnew-modal';
import { ModeSegment } from '@/ui/mode-segment';
import { PlayButton } from '@/ui/play-button';
import { Screen, TAB_EDGES } from '@/ui/screen';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';

export function HomeMenu() {
  const router = useRouter();
  const { session } = useAuth();
  // Görünen ad TEK kaynaktan (ayarlarla aynı hook):
  // oturum açıkken profiles.username, kapalıyken yerel ad.
  const { name, refresh: refreshName } = useProfile();
  const [mode, setMode] = useState<GameMode>('solo');
  // Kupa puanı + Veri: ortak rank store'dan (TEK doğruluk kaynağı). Mağaza/donanım
  // satın alması bu store'u patch'lediği için burada ANINDA güncellenir — pager
  // sekmesi arasında bayat kalmaz. Oturum yoksa rank null → Kupa/Veri gizli.
  const { rank, refresh: refreshRank } = useRank();
  const rating = rank?.rating ?? null;
  const veri = rank?.veri ?? null;
  const [boardOpen, setBoardOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  // Seviye atladıysa kutlanacak seviye (null = kutlama yok).
  const [levelUp, setLevelUp] = useState<number | null>(null);
  // Yeni sezon algılandıysa sezon-sıfırlama modalı açık (Kupa'dan lig türetir).
  const [seasonResetOpen, setSeasonResetOpen] = useState(false);
  // Lig haritası modalı (tüm kademeler + mevcut konum) — lig rozetine dokununca.
  const [leagueMapOpen, setLeagueMapOpen] = useState(false);
  // Basılı-tut bilgi balonu (rozetler); null = kapalı. Normal dokunuş davranışı
  // (kupa → lider tablosu) korunur; uzun basış yalnız tooltip gösterir. Parmak
  // kalkınca hemen değil, 3 sn sonra kapanır.
  const [tip, setTip] = useState<TipId | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTip = useCallback((id: TipId) => {
    if (tipTimer.current) clearTimeout(tipTimer.current); // basılı tutarken açık kalsın
    setTip(id);
  }, []);
  const scheduleTipClose = useCallback(() => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    tipTimer.current = setTimeout(() => setTip(null), 3000);
  }, []);
  useEffect(() => () => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
  }, []);

  // Son seçilen modu hatırla (yereldir, profil verisi değil).
  useEffect(() => {
    getLastMode().then(setMode);
  }, []);

  // Karşılama modalı (flicker-safe): bayrak yüklenene kadar AÇILMAZ; ilk açılışsa
  // (görülmediyse) açılır. ÖNEMLİ: yalnız Vavizof intro'su BİTİNCE (introDone)
  // tetiklenir — yoksa native <Modal>, hâlâ ekranda olan JS-overlay intro'nun
  // ÜSTÜNE çizilip önüne geçer. Sıra: splash → intro → menü → welcome.
  const introDone = useIntroDone();
  const [welcomeVisible, setWelcomeVisible] = useState(false);
  const [whatsnewVisible, setWhatsnewVisible] = useState(false);
  useEffect(() => {
    if (!introDone) return;
    let alive = true;
    void (async () => {
      const welcomeSeen = await getSeen('welcome');
      if (!welcomeSeen) {
        // Yeni kurulum: karşılamayı göster; "Yenilikler"i de görüldü say (yeni
        // kullanıcı zaten her şeyi ilk kez görüyor, güncelleme modalı gereksiz).
        if (alive) setWelcomeVisible(true);
        void setSeenWhatsnew(WHATSNEW_ID);
        return;
      }
      // Mevcut kullanıcı: güncelleme yeniliklerini bu sürüm için bir kez göster.
      const seenId = await getSeenWhatsnew();
      if (alive && seenId !== WHATSNEW_ID) setWhatsnewVisible(true);
    })();
    return () => {
      alive = false;
    };
  }, [introDone]);
  const closeWelcome = useCallback(() => {
    setWelcomeVisible(false);
    void markSeen('welcome');
  }, []);
  const closeWhatsnew = useCallback(() => {
    setWhatsnewVisible(false);
    void setSeenWhatsnew(WHATSNEW_ID);
  }, []);

  const selectMode = (next: GameMode) => {
    setMode(next);
    setLastMode(next);
  };

  // Ayarlardan veya oyundan dönünce profil adını ve kupa puanını tazele.
  useFocusEffect(
    useCallback(() => {
      refreshName();
      // Oturum yoksa kupa + veri gizli (online'a bağlı; rank zaten null).
      if (!session) return;
      let alive = true;
      // Ortak store'u tazele (maçtan/ayardan dönüş); getirilen değerle seviye/sezon tespiti.
      void refreshRank().then(async (r) => {
        if (!alive || !r) return;
        // Seviye atlama: kayıtlı eski seviyeyle karşılaştır (maç sonrası, tek sefer).
        const prev = await getLastSeenLevel();
        if (alive && prev != null && r.level > prev) setLevelUp(r.level);
        await setLastSeenLevel(r.level);
        // Sezon sıfırlama: yeni season_id görülürse tek sefer modal (flicker-safe:
        // hem get_my_rank hem kayıtlı sezon çözülmeden gösterilmez). İlk kayıtta
        // (prev null) sessizce ilkler — yeni kullanıcıya "kupan çekildi" denmez.
        if (r.seasonId != null) {
          const prevSeason = await getLastSeenSeason();
          if (alive && prevSeason != null && r.seasonId > prevSeason) setSeasonResetOpen(true);
          await setLastSeenSeason(r.seasonId);
        }
      });
      return () => {
        alive = false;
      };
    }, [refreshName, session, refreshRank]),
  );

  // Online yalnızca burada oturum ister; oturum yoksa giriş ekranına yönlendir.
  // Önce proaktif internet kontrolü: çevrimdışıysa net uyarı, boşuna yönlendirme yok.
  const goOnline = async () => {
    if (!(await isOnline())) {
      Alert.alert(
        'İnternet gerekli',
        'Çok oyunculu mod için internet bağlantısı gerekiyor. Bağlantını kontrol edip tekrar dene.',
      );
      return;
    }
    if (session) {
      router.push('/online');
    } else {
      router.push({ pathname: '/auth', params: { next: '/online' } });
    }
  };

  // OYNA: solo → mod seçim hub'ı (Sayı / Kelime); online → mevcut davranış.
  const play = () => {
    if (mode === 'solo') {
      router.push('/solo');
    } else {
      void goOnline();
    }
  };

  return (
    <Screen edges={TAB_EDGES}>
      {/* Üst bar: avatar + ad (tıkla → istatistik modalı), kupa (→ lider
          tablosu), sağda ayarlar. Offline istatistik chip'leri kaldırıldı. */}
      <View style={styles.topRow}>
        <Pressable
          onPress={() => setStatsOpen(true)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Profil istatistikleri"
          style={({ pressed }) => [styles.profilePress, pressed && styles.profilePressed]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.identity}>
            <Text style={styles.profileName} numberOfLines={1}>
              {name}
            </Text>
            {session ? (
              <View style={styles.badges}>
                {rating != null ? (
                  // Lig rozeti (Kupa'dan türetilir) → dokunuş lig haritası modalı.
                  <Pressable
                    onPress={() => setLeagueMapOpen(true)}
                    hitSlop={6}
                    accessibilityLabel="Lig haritası"
                    style={styles.leagueChip}>
                    <LeagueBadge rating={rating} size={28} showName={false} animated />
                  </Pressable>
                ) : null}
                {rating != null ? (
                  // Dokunuş = lider tablosu (korunur); basılı tut = bilgi balonu.
                  <Pressable
                    onPress={() => setBoardOpen(true)}
                    onLongPress={() => openTip('rating')}
                    onPressOut={scheduleTipClose}
                    delayLongPress={300}
                    hitSlop={6}
                    accessibilityLabel="Kupa puanı"
                    style={styles.trophy}>
                    <Feather name="award" size={13} color={colors.amber} />
                    <Text style={styles.trophyText}>{rating}</Text>
                  </Pressable>
                ) : null}
                {veri != null ? (
                  // Veri rozeti artık modal AÇMAZ (dokunuş yutulur); basılı tut =
                  // bilgi balonu. Pressable olması, dokunuşun profil modalını açan
                  // dış Pressable'a sızmasını engeller.
                  <Pressable
                    onPress={() => {}}
                    onLongPress={() => openTip('veri')}
                    onPressOut={scheduleTipClose}
                    delayLongPress={300}
                    hitSlop={6}
                    accessibilityLabel="Veri"
                    style={styles.veriBadge}>
                    <Feather name="database" size={13} color={colors.cyan} />
                    <Text style={styles.veriBadgeText}>{veri}</Text>
                  </Pressable>
                ) : null}
                {tip ? (
                  <View style={styles.tipLayer} pointerEvents="none">
                    <InfoTipBubble
                      title={TIPS[tip].title}
                      body={TIPS[tip].body}
                      accent={TIPS[tip].accent}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </Pressable>
        {/* Sağ üst: Son Maçlar + Ayarlar. Mağaza/Protokol/Emoji ikonları alt
            sekme çubuğuna taşındığı için buradan kaldırıldı. */}
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => setRecentOpen(true)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Son Maçlar"
            style={styles.headerBtn}>
            <Feather name="activity" size={20} color={colors.cyan} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/settings')}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Ayarlar"
            style={styles.headerBtn}>
            <Ionicons name="settings-outline" size={22} color={colors.cyan} />
          </Pressable>
        </View>
      </View>

      {/* Orta blok: istatistik kartları kalkınca logo + menü dikeyde ortalanır */}
      <View style={styles.body}>
        {/* Logo: GİZEMLİ / SAYILAR + üç haneli "?" motifi */}
        <View style={styles.hero}>
          <Text style={styles.logoTop}>GİZEMLİ</Text>
          <Text style={styles.logoBottom}>SAYILAR</Text>
          <View style={styles.secretBoxes}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.secretBox}>
                <Text style={styles.secretBoxText}>?</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Menü: mod seçici + OYNA + Nasıl Oynanır */}
        <View style={styles.menu}>
          <ModeSegment value={mode} onChange={selectMode} />
          <PlayButton mode={mode} onPress={play} />
          <Pressable
            onPress={() => router.push('/how-to-play')}
            hitSlop={8}
            style={styles.howToPlay}>
            <Ionicons name="help-circle-outline" size={16} color={colors.dim} />
            <Text style={styles.howToPlayText}>Nasıl Oynanır</Text>
          </Pressable>
        </View>
      </View>

      {/* Alt: yalnızca sürüm (istatistik kartları kaldırıldı — online'da modal) */}
      <View style={styles.footer}>
        <Text style={styles.version}>{appVersionLabel()}</Text>
      </View>

      <LeaderboardModal visible={boardOpen} onClose={() => setBoardOpen(false)} />
      <RecentMatchesModal visible={recentOpen} onClose={() => setRecentOpen(false)} />
      <ProfileStatsModal
        visible={statsOpen}
        name={name}
        signedIn={Boolean(session)}
        onClose={() => setStatsOpen(false)}
      />
      <LevelUpOverlay
        visible={levelUp != null}
        level={levelUp ?? 1}
        onClose={() => setLevelUp(null)}
      />
      <InfoModal visible={welcomeVisible} onClose={closeWelcome} {...WELCOME_INTRO} />
      <WhatsNewModal visible={whatsnewVisible} onClose={closeWhatsnew} />
      {/* Haftalık sezon sıfırlandığında bir kez (yeni season_id). */}
      <SeasonResetModal
        visible={seasonResetOpen}
        rating={rating ?? 1000}
        onClose={() => setSeasonResetOpen(false)}
      />
      {/* Lig haritası — lig rozetine dokununca tüm kademeler + mevcut konum. */}
      <LeagueMapModal
        visible={leagueMapOpen}
        rating={rating}
        onClose={() => setLeagueMapOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    // Sağ kontroller dikey sütun olduğundan üstten hizala: profil sol-üstte,
    // ikon sütunu sağ-üstten aşağı iner (çakışma olmaz).
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
  },
  profilePress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 1,
  },
  profilePressed: {
    opacity: 0.75,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.glass,
    borderWidth: 1.5,
    borderColor: colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.cyan,
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  avatarText: {
    color: colors.cyan,
    fontSize: 20,
    fontWeight: '800',
    fontFamily: mono,
  },
  identity: {
    flexShrink: 1,
    alignItems: 'flex-start',
    gap: 5,
  },
  profileName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // Bilgi balonu rozetlerin hemen altında, sol kenara hizalı → ekran dışına
  // taşmaz (rozetler ekranın sol tarafında).
  tipLayer: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 8,
    zIndex: 50,
  },
  leagueChip: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  trophy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 20,
    backgroundColor: withAlpha(colors.amber, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(colors.amber, 0.32),
  },
  trophyText: {
    color: colors.amber,
    fontSize: 12,
    fontWeight: '800',
    fontFamily: mono,
  },
  veriBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 20,
    backgroundColor: withAlpha(colors.cyan, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(colors.cyan, 0.32),
  },
  veriBadgeText: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: '800',
    fontFamily: mono,
  },
  // Sağ üst aksiyonlar (Son Maçlar + Ayarlar), profil satırının sağına yaslı.
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: 'auto',
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    // Kartlar kalkınca oluşan boşluğu dengele: logo+menü bloğu dikeyde ortada.
    flex: 1,
    justifyContent: 'center',
  },
  hero: {
    alignItems: 'center',
    marginBottom: 34,
  },
  logoTop: {
    color: colors.dim,
    fontSize: 22,
    fontWeight: '300',
    fontFamily: mono,
    letterSpacing: 12,
    marginLeft: 12, // letterSpacing'in sağdaki boşluğunu dengele
  },
  logoBottom: {
    color: colors.ice, // beyazımsı metin + mavi glow = "ışıldayan beyaz neon"
    fontSize: 46,
    fontWeight: '900',
    fontFamily: mono,
    letterSpacing: 6,
    marginLeft: 6,
    marginTop: 2,
    textShadowColor: colors.cyan,
    textShadowRadius: 18,
  },
  secretBoxes: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  secretBox: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: cyanAlpha(0.06),
    borderWidth: 1,
    borderColor: cyanAlpha(0.28),
    alignItems: 'center',
    justifyContent: 'center',
  },
  secretBoxText: {
    color: colors.cyan,
    fontSize: 18,
    fontWeight: '800',
    fontFamily: mono,
  },
  menu: {
    gap: 16,
  },
  howToPlay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  howToPlayText: {
    color: colors.dim,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  footer: {
    paddingBottom: 4,
  },
  version: {
    textAlign: 'center',
    color: colors.dim,
    fontSize: 12,
    paddingVertical: 6,
  },
});
