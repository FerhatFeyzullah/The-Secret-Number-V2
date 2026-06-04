import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { GlassButton, GlassCard } from '@/ui/glass';
import { Screen, ScreenHeader } from '@/ui/screen';
import { colors, mono } from '@/ui/theme';

const guessOptions = [5, 7, 10, 12];
const timeOptions = [
  { label: '30 sn', value: 30 },
  { label: '1 dk', value: 60 },
  { label: '2 dk', value: 120 },
];

export default function OfflineSetupScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<'guesses' | 'timed'>('guesses');
  const [guessLimit, setGuessLimit] = useState(7);
  const [timeChoice, setTimeChoice] = useState<number | 'custom'>(60);
  const [customSec, setCustomSec] = useState('');

  const customValue = Number(customSec);
  const customValid = Number.isInteger(customValue) && customValue >= 10 && customValue <= 600;
  const limit = mode === 'guesses' ? guessLimit : timeChoice === 'custom' ? customValue : timeChoice;
  const canStart = mode === 'guesses' || timeChoice !== 'custom' || customValid;

  const start = () => {
    router.push({ pathname: '/offline', params: { mode, limit: String(limit) } });
  };

  return (
    <Screen>
      <ScreenHeader title="Oyun Kurulumu" />
      <ScrollView contentContainerStyle={styles.list}>
        <Pressable onPress={() => setMode('guesses')}>
          <GlassCard style={mode === 'guesses' ? styles.cardActive : styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons
                name="keypad-outline"
                size={22}
                color={mode === 'guesses' ? colors.cyan : colors.dim}
              />
              <Text style={mode === 'guesses' ? styles.cardTitleActive : styles.cardTitle}>
                Tahmin Hakkı
              </Text>
            </View>
            <Text style={styles.cardDesc}>
              Sınırlı tahmin kredisi — biterse kaybedersin. Daha az hak = daha zor.
            </Text>
            {mode === 'guesses' && (
              <View style={styles.chips}>
                {guessOptions.map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => setGuessLimit(n)}
                    style={[styles.chip, guessLimit === n && styles.chipActive]}>
                    <Text style={[styles.chipText, guessLimit === n && styles.chipTextActive]}>
                      {n} hak
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </GlassCard>
        </Pressable>

        <Pressable onPress={() => setMode('timed')}>
          <GlassCard style={mode === 'timed' ? styles.cardActive : styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons
                name="timer-outline"
                size={22}
                color={mode === 'timed' ? colors.cyan : colors.dim}
              />
              <Text style={mode === 'timed' ? styles.cardTitleActive : styles.cardTitle}>
                Süreli
              </Text>
            </View>
            <Text style={styles.cardDesc}>
              Geri sayan sayaca karşı oyna — süre dolarsa kaybedersin.
            </Text>
            {mode === 'timed' && (
              <>
                <View style={styles.chips}>
                  {timeOptions.map((opt) => (
                    <Pressable
                      key={opt.value}
                      onPress={() => setTimeChoice(opt.value)}
                      style={[styles.chip, timeChoice === opt.value && styles.chipActive]}>
                      <Text
                        style={[
                          styles.chipText,
                          timeChoice === opt.value && styles.chipTextActive,
                        ]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  ))}
                  <Pressable
                    onPress={() => setTimeChoice('custom')}
                    style={[styles.chip, timeChoice === 'custom' && styles.chipActive]}>
                    <Text
                      style={[styles.chipText, timeChoice === 'custom' && styles.chipTextActive]}>
                      Özel
                    </Text>
                  </Pressable>
                </View>
                {timeChoice === 'custom' && (
                  <View style={styles.customRow}>
                    <TextInput
                      style={styles.customInput}
                      value={customSec}
                      onChangeText={setCustomSec}
                      keyboardType="number-pad"
                      maxLength={3}
                      placeholder="90"
                      placeholderTextColor={colors.dim}
                    />
                    <Text style={styles.customUnit}>saniye (10-600)</Text>
                    {customSec !== '' && !customValid && (
                      <Text style={styles.customError}>geçersiz</Text>
                    )}
                  </View>
                )}
              </>
            )}
          </GlassCard>
        </Pressable>

        {canStart ? (
          <GlassButton label="Başla" accent={colors.amber} onPress={start} />
        ) : (
          <GlassButton label="Başla" accent={colors.dim} onPress={() => {}} />
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 16,
    paddingBottom: 24,
  },
  card: {
    opacity: 0.65,
  },
  cardActive: {
    borderColor: colors.cyan,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  cardTitle: {
    color: colors.dim,
    fontSize: 18,
    fontWeight: '700',
  },
  cardTitleActive: {
    color: colors.cyan,
    fontSize: 18,
    fontWeight: '700',
  },
  cardDesc: {
    color: colors.dim,
    fontSize: 13,
    lineHeight: 19,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  chipActive: {
    borderColor: colors.amber,
    backgroundColor: 'rgba(255, 200, 87, 0.12)',
  },
  chipText: {
    color: colors.dim,
    fontWeight: '600',
    fontFamily: mono,
  },
  chipTextActive: {
    color: colors.amber,
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
  },
  customInput: {
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    color: colors.cyan,
    fontSize: 18,
    fontFamily: mono,
    width: 80,
    textAlign: 'center',
  },
  customUnit: {
    color: colors.dim,
    fontSize: 13,
  },
  customError: {
    color: colors.danger,
    fontSize: 13,
  },
});
