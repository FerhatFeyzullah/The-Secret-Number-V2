import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { useAuth, useProfile } from '@/auth';
import { getToggle, resetSeen, setToggle } from '@/storage';
import { GlassButton, GlassCard } from '@/ui/glass';
import { InfoModal } from '@/ui/info-modal';
import { Screen, ScreenHeader } from '@/ui/screen';
import { colors } from '@/ui/theme';
import { WELCOME_INTRO } from '@/ui/welcome-intro';

export default function SettingsScreen() {
  const router = useRouter();
  const { session, signOut } = useAuth();
  // Ad TEK kaynaktan: oturum açıkken profiles.username, kapalıyken yerel ad.
  const { name: profileName, updateName, isRemote } = useProfile();
  const [name, setName] = useState('');
  const [sound, setSound] = useState(true);
  const [haptics, setHaptics] = useState(true);
  // Karşılama/tanıtım modalını elle yeniden açma (seen bayrağından bağımsız).
  const [welcomeOpen, setWelcomeOpen] = useState(false);

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

  // Tüm bilgilendirme bayraklarını sil → tanıtım modalları yeniden ilk-kez gibi.
  const resetIntros = async () => {
    await resetSeen();
    Alert.alert('Bilgilendirmeler sıfırlandı', 'Tüm tanıtım modalları yeniden gösterilecek.');
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

        <GlassButton small label="Nasıl Oynanır" onPress={() => router.push('/how-to-play')} />
        <GlassButton small label="Tanıtımı Göster" onPress={() => setWelcomeOpen(true)} />
        <GlassButton small label="Bilgilendirmeleri Sıfırla" onPress={() => void resetIntros()} />

        <GlassCard>
          <Text style={styles.sectionTitle}>Hakkında</Text>
          <Text style={styles.about}>
            Gizemli Sayılar — sayı ve kelime tahmin düellosu.{'\n'}
            Sürüm v{Constants.expoConfig?.version ?? '2.2.0'}
          </Text>
        </GlassCard>
      </ScrollView>

      <InfoModal visible={welcomeOpen} onClose={() => setWelcomeOpen(false)} {...WELCOME_INTRO} />
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
  about: {
    color: colors.dim,
    lineHeight: 22,
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
