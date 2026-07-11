import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';

import { useAuth } from '@/auth';
import { GlassButton, GlassCard } from '@/ui/glass';
import { Screen, ScreenHeader } from '@/ui/screen';
import { colors } from '@/ui/theme';

// İki aşama: önce e-postaya kod iste, sonra kodu + yeni şifreyi doğrula.
type Phase = 'request' | 'verify';

export default function ResetPasswordScreen() {
  const router = useRouter();
  // Auth ekranından taşınan e-posta (varsa alanı önden doldurur).
  const { email: initialEmail } = useLocalSearchParams<{ email?: string }>();
  const { requestPasswordReset, confirmPasswordReset } = useAuth();

  const [phase, setPhase] = useState<Phase>('request');
  const [email, setEmail] = useState(initialEmail ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Kod gönderir (ilk istek ve "tekrar gönder" aynı akışı kullanır).
  const sendCode = async () => {
    if (!email.trim()) {
      setError('E-posta gerekli.');
      return;
    }
    setBusy(true);
    setError(null);
    const err = await requestPasswordReset(email);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setInfo('Kod e-postana gönderildi. Gelen kutunu (ve spam klasörünü) kontrol et.');
    setPhase('verify');
  };

  const confirm = async () => {
    if (!code.trim() || !password) {
      setError('Kod ve yeni şifre gerekli.');
      return;
    }
    setBusy(true);
    setError(null);
    const err = await confirmPasswordReset(email, code, password);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    // verifyOtp + updateUser başarılı → kullanıcı yeni şifresiyle giriş yapmış durumda.
    router.back();
  };

  return (
    <Screen>
      <ScreenHeader title="Şifre Sıfırla" />
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {phase === 'request' ? (
            <GlassCard>
              <Text style={styles.sectionTitle}>Şifremi Unuttum</Text>
              <Text style={styles.hint}>
                Hesabının e-postasını gir; sana 6 haneli bir sıfırlama kodu gönderelim.
              </Text>

              <Text style={[styles.label, styles.spaced]}>E-posta</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="ornek@eposta.com"
                placeholderTextColor={colors.dim}
                onSubmitEditing={sendCode}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}
            </GlassCard>
          ) : (
            <GlassCard>
              <Text style={styles.sectionTitle}>Kodu Gir</Text>
              {info ? <Text style={styles.info}>{info}</Text> : null}

              <Text style={[styles.label, styles.spaced]}>6 haneli kod</Text>
              <TextInput
                style={styles.input}
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="––––––"
                placeholderTextColor={colors.dim}
              />

              <Text style={[styles.label, styles.spaced]}>Yeni şifre</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                placeholder="En az 6 karakter"
                placeholderTextColor={colors.dim}
                onSubmitEditing={confirm}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}
            </GlassCard>
          )}

          {busy ? (
            <ActivityIndicator color={colors.cyan} size="large" />
          ) : phase === 'request' ? (
            <GlassButton label="Kod Gönder" onPress={sendCode} />
          ) : (
            <GlassButton label="Şifreyi Değiştir" onPress={confirm} />
          )}

          {phase === 'verify' && !busy ? (
            <Pressable onPress={sendCode} hitSlop={8}>
              <Text style={styles.switchText}>
                Kod gelmedi mi? <Text style={styles.switchLink}>Tekrar gönder</Text>
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  list: {
    gap: 16,
    paddingTop: 12,
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
  hint: {
    color: colors.dim,
    fontSize: 13,
    lineHeight: 19,
  },
  info: {
    color: colors.cyan,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 4,
  },
  label: {
    color: colors.dim,
    fontSize: 13,
    marginBottom: 6,
  },
  spaced: {
    marginTop: 14,
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
  error: {
    color: colors.danger,
    fontSize: 13,
    marginTop: 12,
    lineHeight: 18,
  },
  switchText: {
    color: colors.dim,
    textAlign: 'center',
    fontSize: 14,
  },
  switchLink: {
    color: colors.cyan,
    fontWeight: '700',
  },
});
