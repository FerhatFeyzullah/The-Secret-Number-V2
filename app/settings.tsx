import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth, useProfile } from '@/auth';
import { getToggle, setToggle } from '@/storage';
import { useUpdateCheck } from '@/updates/use-update-check';
import { AdminWordPanel } from '@/ui/admin-word-panel';
import { appVersionLabel } from '@/ui/app-version';
import { mono, withAlpha } from '@/ui/theme';

// ─── DECODE teması (yerel palet — deneme; beğenilirse ortak temaya taşınır) ───
const C = {
  signal: '#22D3EE',
  energy: '#FF4D8D',
  reward: '#A3E635',
  canvas: '#0A0A16',
  surface: 'rgba(21,21,44,0.85)',
  tile: 'rgba(255,255,255,0.05)',
  border: 'rgba(255,255,255,0.08)',
  divider: 'rgba(255,255,255,0.05)',
  textPrimary: '#F5F7FF',
  textSecondary: '#A6A8C4',
  textMuted: '#6B6E8E',
};

// ─── Gradient toggle (cyan glow + animasyonlu topuz) ──────────────────────────
function DecodeToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: value ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [value, anim]);
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [2, 22] });
  return (
    <Pressable onPress={() => onChange(!value)} hitSlop={8} accessibilityRole="switch">
      <View style={[styles.track, value ? styles.trackOn : styles.trackOff]}>
        <Animated.View style={[styles.knob, { transform: [{ translateX }] }]} />
      </View>
    </Pressable>
  );
}

// ─── Bölüm (üst yazı + camsı kart) ────────────────────────────────────────────
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>{label}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

// ─── Satır (ikon karesi + etiket + sağ içerik/chevron) ────────────────────────
function Row({
  icon,
  label,
  right,
  onPress,
  last = false,
  danger = false,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
  danger?: boolean;
}) {
  const accent = danger ? C.energy : C.signal;
  const body = (
    <View style={[styles.row, !last && styles.rowDivider]}>
      <View style={[styles.iconTile, { borderColor: withAlpha(accent, 0.3) }]}>
        <Feather name={icon} size={16} color={accent} />
      </View>
      <Text style={[styles.rowLabel, danger && { color: C.energy }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.rowRight}>
        {right ?? (onPress ? <Feather name="chevron-right" size={18} color={C.textMuted} /> : null)}
      </View>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      {body}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { session, signOut } = useAuth();
  // Ad TEK kaynaktan: oturum açıkken profiles.username, kapalıyken yerel ad.
  const { name: profileName, updateName, isRemote } = useProfile();
  const [name, setName] = useState('');
  const [sound, setSound] = useState(true);
  const [haptics, setHaptics] = useState(true);
  const { status, progress, check } = useUpdateCheck();

  // Gizli yönetici paneli: sürüm satırına 5 kez art arda basınca açılır.
  const [adminOpen, setAdminOpen] = useState(false);
  const tapRef = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onVersionTap = () => {
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapRef.current += 1;
    if (tapRef.current >= 5) {
      tapRef.current = 0;
      setAdminOpen(true);
      return;
    }
    tapTimer.current = setTimeout(() => {
      tapRef.current = 0;
    }, 1500);
  };

  // Kaynaktaki ad değişince (giriş/çıkış, sunucu teyidi) inputu eşitle.
  useEffect(() => {
    setName(profileName);
  }, [profileName]);

  useEffect(() => {
    Promise.all([getToggle('sound'), getToggle('haptics')]).then(([savedSound, savedHaptics]) => {
      setSound(savedSound);
      setHaptics(savedHaptics);
    });
  }, []);

  const changeName = (value: string) => {
    setName(value);
    // Offline ad her tuşta yerel depoya; oturum açıkken DB'ye tek seferde (commitName).
    if (!isRemote) updateName(value);
  };
  const commitName = () => {
    const trimmed = name.trim();
    if (isRemote && trimmed && trimmed !== profileName) updateName(trimmed);
  };

  // Hesabı değiştir: mevcut oturumu kapat → giriş ekranı.
  const switchAccount = async () => {
    await signOut();
    router.push('/auth');
  };
  const changeSound = (value: boolean) => {
    setSound(value);
    setToggle('sound', value);
  };
  const changeHaptics = (value: boolean) => {
    setHaptics(value);
    setToggle('haptics', value);
  };

  // Güncelleme satırı (davranış use-update-check ile aynı; görünüm DECODE satırı).
  const updBusy = status === 'checking' || status === 'downloading' || status === 'restarting';
  const pct = progress != null ? Math.round(progress * 100) : null;
  const updLabel =
    status === 'checking'
      ? 'Denetleniyor…'
      : status === 'downloading'
        ? pct != null
          ? `İndiriliyor… %${pct}`
          : 'İndiriliyor…'
        : status === 'restarting'
          ? 'Yeniden başlatılıyor…'
          : 'Güncellemeleri Denetle';
  const updHint =
    status === 'uptodate'
      ? 'En güncel sürümü kullanıyorsun.'
      : status === 'error'
        ? 'Denetlenemedi. Bağlantını kontrol edip tekrar dene.'
        : status === 'unsupported'
          ? 'Güncelleme yalnızca yayınlanan sürümde çalışır.'
          : null;

  return (
    <View style={styles.canvas}>
      {/* Üst sinyal glow (radyalimsi): cyan→magenta→saydam */}
      <LinearGradient
        colors={[withAlpha(C.signal, 0.1), withAlpha(C.energy, 0.05), 'transparent']}
        locations={[0, 0.5, 1]}
        style={styles.topGlow}
        pointerEvents="none"
      />
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        {/* Başlık */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
            <Feather name="arrow-left" size={20} color={C.signal} />
          </Pressable>
          <Text style={styles.title}>Ayarlar</Text>
          <View style={styles.back} />
        </View>

        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {/* PROFİL */}
          <Section label="PROFİL">
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Profil adı</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={changeName}
                onEndEditing={commitName}
                onSubmitEditing={commitName}
                maxLength={20}
                placeholder="Oyuncu"
                placeholderTextColor={C.textMuted}
              />
              <Text style={styles.fieldHint}>
                {isRemote
                  ? 'Hesabında saklanır — tüm cihazlarında bu ad görünür.'
                  : 'Bu cihazda saklanır.'}
              </Text>
            </View>
          </Section>

          {/* OYUN */}
          <Section label="OYUN">
            <Row
              icon="volume-2"
              label="Ses efektleri"
              right={<DecodeToggle value={sound} onChange={changeSound} />}
            />
            <Row
              icon="smartphone"
              label="Titreşim"
              right={<DecodeToggle value={haptics} onChange={changeHaptics} />}
              last
            />
          </Section>

          {/* HESAP */}
          <Section label="HESAP">
            {session ? (
              <>
                <Row
                  icon="mail"
                  label="Bağlı hesap"
                  right={
                    <Text style={styles.rowValue} numberOfLines={1}>
                      {session.user.email}
                    </Text>
                  }
                />
                <Row icon="repeat" label="Hesabı Değiştir" onPress={switchAccount} />
                <Row icon="log-out" label="Çıkış Yap" danger onPress={() => signOut()} last />
              </>
            ) : (
              <>
                <View style={styles.field}>
                  <Text style={styles.fieldHint}>
                    Online modda oynamak için hesabını bağla. Offline mod hesapsız çalışmaya devam
                    eder.
                  </Text>
                </View>
                <Row
                  icon="log-in"
                  label="Hesabını Bağla / Giriş Yap"
                  onPress={() => router.push('/auth')}
                  last
                />
              </>
            )}
          </Section>

          {/* UYGULAMA */}
          <Section label="UYGULAMA">
            <Row
              icon="download-cloud"
              label={updLabel}
              onPress={updBusy || status === 'unsupported' ? undefined : check}
              right={
                updBusy ? (
                  <ActivityIndicator size="small" color={C.signal} />
                ) : status === 'uptodate' ? (
                  <Text style={[styles.rowValue, { color: C.reward }]}>Güncel</Text>
                ) : (
                  <Feather name="chevron-right" size={18} color={C.textMuted} />
                )
              }
            />
            <Pressable onPress={onVersionTap} style={({ pressed }) => pressed && styles.pressed}>
              <View style={styles.row}>
                <View style={[styles.iconTile, { borderColor: withAlpha(C.signal, 0.3) }]}>
                  <Feather name="tag" size={16} color={C.signal} />
                </View>
                <Text style={styles.rowLabel}>Sürüm</Text>
                <View style={styles.rowRight}>
                  <Text style={[styles.rowValue, { fontFamily: mono }]}>{appVersionLabel()}</Text>
                </View>
              </View>
            </Pressable>
          </Section>
          {updHint ? <Text style={styles.updHint}>{updHint}</Text> : null}
        </ScrollView>
      </SafeAreaView>

      <AdminWordPanel visible={adminOpen} onClose={() => setAdminOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: C.canvas },
  topGlow: { position: 'absolute', top: 0, left: 0, right: 0, height: 280 },
  safe: { flex: 1, paddingHorizontal: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 8,
  },
  back: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.tile,
    borderWidth: 1,
    borderColor: C.border,
  },
  title: {
    flex: 1,
    color: C.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  list: { paddingTop: 8, paddingBottom: 48 },
  section: { marginBottom: 20 },
  eyebrow: {
    color: C.textMuted,
    fontSize: 11,
    fontFamily: mono,
    letterSpacing: 2,
    marginBottom: 8,
    marginLeft: 6,
  },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    overflow: 'hidden',
  },
  // Satır
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: C.divider },
  iconTile: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.tile,
    borderWidth: 1,
  },
  rowLabel: { flex: 1, color: C.textPrimary, fontSize: 15, fontWeight: '600' },
  rowRight: { flexShrink: 0, maxWidth: 190, alignItems: 'flex-end' },
  rowValue: { color: C.textMuted, fontSize: 13 },
  pressed: { opacity: 0.6 },
  // Alan (profil adı / hesap ipucu)
  field: { paddingHorizontal: 14, paddingVertical: 14, gap: 8 },
  fieldLabel: { color: C.textSecondary, fontSize: 12, letterSpacing: 0.5 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: C.textPrimary,
    fontSize: 16,
  },
  fieldHint: { color: C.textMuted, fontSize: 12, lineHeight: 17 },
  updHint: { color: C.textMuted, fontSize: 12, marginTop: -8, marginLeft: 6, marginBottom: 8 },
  // Toggle
  track: { width: 46, height: 26, borderRadius: 13, justifyContent: 'center' },
  trackOn: { backgroundColor: C.signal, boxShadow: `0 0 10px ${withAlpha(C.signal, 0.5)}` },
  trackOff: { backgroundColor: 'rgba(255,255,255,0.12)' },
  knob: {
    position: 'absolute',
    left: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#F5F7FF',
    boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
  },
});
