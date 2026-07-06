import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { useAuth, useProfile } from '@/auth';
import { getToggle, setToggle } from '@/storage';
import { AdminWordPanel } from '@/ui/admin-word-panel';
import { appVersionLabel } from '@/ui/app-version';
import { GlassButton, GlassCard } from '@/ui/glass';
import { Screen, ScreenHeader } from '@/ui/screen';
import { colors } from '@/ui/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const { session, signOut } = useAuth();
  // Ad TEK kaynaktan: oturum açıkken profiles.username, kapalıyken yerel ad.
  const { name: profileName, updateName, isRemote } = useProfile();
  const [name, setName] = useState('');
  const [sound, setSound] = useState(true);
  const [haptics, setHaptics] = useState(true);
  // Gizli yönetici paneli: sürüm yazısına 5 kez art arda basınca açılır.
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
    // Offline ad eskisi gibi her tuşta yerel depoya yazılır;
    // oturum açıkken DB'ye yazım bitince tek seferde gidilir (commitName).
    if (!isRemote) updateName(value);
  };

  const commitName = () => {
    const trimmed = name.trim();
    if (isRemote && trimmed && trimmed !== profileName) updateName(trimmed);
  };

  // Hesabı değiştir: önce mevcut oturumu kapat, sonra giriş ekranına git.
  // Yeni hesapla girilince auth context profili çekip adı/avatarı tazeler.
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

  return (
    <Screen>
      <ScreenHeader title="Ayarlar" />
      <ScrollView contentContainerStyle={styles.list}>
        <GlassCard>
          <Text style={styles.sectionTitle}>Profil</Text>
          <Text style={styles.label}>Profil adı</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={changeName}
            onEndEditing={commitName}
            onSubmitEditing={commitName}
            maxLength={20}
            placeholder="Oyuncu"
            placeholderTextColor={colors.dim}
          />
          <Text style={styles.rowHint}>
            {isRemote
              ? 'Hesabında saklanır — tüm cihazlarında bu ad görünür.'
              : 'Bu cihazda saklanır.'}
          </Text>
        </GlassCard>

        <GlassCard>
          <Text style={styles.sectionTitle}>Oyun</Text>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Ses efektleri</Text>
              <Text style={styles.rowHint}>Tuş, tahmin ve kazanma sesleri</Text>
            </View>
            <Switch
              value={sound}
              onValueChange={changeSound}
              trackColor={{ true: colors.cyanDim }}
              thumbColor={sound ? colors.cyan : undefined}
            />
          </View>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Titreşim (haptik)</Text>
              <Text style={styles.rowHint}>Dokunsal geri bildirim — sesten bağımsız</Text>
            </View>
            <Switch
              value={haptics}
              onValueChange={changeHaptics}
              trackColor={{ true: colors.cyanDim }}
              thumbColor={haptics ? colors.cyan : undefined}
            />
          </View>
        </GlassCard>

        <GlassCard>
          <Text style={styles.sectionTitle}>Hesap</Text>
          {session ? (
            <>
              <Text style={styles.label}>Bağlı hesap</Text>
              <Text style={styles.email}>{session.user.email}</Text>
              <View style={styles.accountButtons}>
                <GlassButton small label="Hesabı Değiştir" onPress={switchAccount} />
                <GlassButton
                  small
                  label="Çıkış Yap"
                  accent={colors.danger}
                  onPress={() => signOut()}
                />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.accountHint}>
                Online modda oynamak için hesabını bağla. Offline mod hesapsız çalışmaya devam
                eder.
              </Text>
              <GlassButton
                small
                label="Hesabını Bağla / Giriş Yap"
                onPress={() => router.push('/auth')}
              />
            </>
          )}
        </GlassCard>

        <Pressable onPress={onVersionTap} hitSlop={8}>
          <Text style={styles.version}>{appVersionLabel()}</Text>
        </Pressable>
      </ScrollView>

      <AdminWordPanel visible={adminOpen} onClose={() => setAdminOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 16,
    paddingBottom: 24,
  },
  sectionTitle: {
    color: colors.amber,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  label: {
    color: colors.dim,
    fontSize: 13,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  rowText: {
    flex: 1,
    paddingRight: 12,
  },
  rowLabel: {
    color: colors.text,
    fontSize: 15,
  },
  rowHint: {
    color: colors.dim,
    fontSize: 12,
    marginTop: 2,
  },
  version: {
    textAlign: 'center',
    color: colors.dim,
    fontSize: 12,
    paddingVertical: 6,
  },
  email: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  accountButtons: {
    gap: 10,
    marginTop: 14,
  },
  accountHint: {
    color: colors.dim,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
});
