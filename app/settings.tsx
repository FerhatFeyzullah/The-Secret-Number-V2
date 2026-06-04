import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { getProfileName, getToggle, setProfileName, setToggle } from '@/storage';
import { GlassButton, GlassCard } from '@/ui/glass';
import { Screen, ScreenHeader } from '@/ui/screen';
import { colors } from '@/ui/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [sound, setSound] = useState(true);
  const [haptics, setHaptics] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([getProfileName(), getToggle('sound'), getToggle('haptics')]).then(
      ([savedName, savedSound, savedHaptics]) => {
        setName(savedName);
        setSound(savedSound);
        setHaptics(savedHaptics);
        setLoaded(true);
      },
    );
  }, []);

  const changeName = (value: string) => {
    setName(value);
    setProfileName(value);
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
            editable={loaded}
            maxLength={20}
            placeholder="Oyuncu"
            placeholderTextColor={colors.dim}
          />
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

        <GlassButton small label="Nasıl Oynanır" onPress={() => router.push('/how-to-play')} />

        <GlassCard>
          <Text style={styles.sectionTitle}>Hakkında</Text>
          <Text style={styles.about}>
            Gizemli Sayılar — 3 haneli sayı tahmin oyunu.{'\n'}
            Sürüm v{Constants.expoConfig?.version ?? '1.0.0'}
          </Text>
        </GlassCard>
      </ScrollView>
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
});
