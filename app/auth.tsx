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

type Mode = 'signin' | 'signup';

export default function AuthScreen() {
  const router = useRouter();
  // Girişten sonra gidilecek hedef (ör. ana menüden online'a basılınca).
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('E-posta ve şifre gerekli.');
      return;
    }
    setBusy(true);
    setError(null);
    const err = mode === 'signin' ? await signIn(email, password) : await signUp(email, password);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    if (next) {
      router.replace(next as never);
    } else {
      router.back();
    }
  };

  const toggleMode = () => {
    setMode(mode === 'signin' ? 'signup' : 'signin');
    setError(null);
  };

  return (
    <Screen>
      <ScreenHeader title="Hesap" />
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          <GlassCard>
            <Text style={styles.sectionTitle}>
              {mode === 'signin' ? 'Giriş Yap' : 'Kayıt Ol'}
            </Text>

            <Text style={styles.label}>E-posta</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="ornek@eposta.com"
              placeholderTextColor={colors.dim}
            />

            <Text style={[styles.label, styles.spaced]}>Şifre</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              placeholder="En az 6 karakter"
              placeholderTextColor={colors.dim}
              onSubmitEditing={submit}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </GlassCard>

          {busy ? (
            <ActivityIndicator color={colors.cyan} size="large" />
          ) : (
            <GlassButton
              label={mode === 'signin' ? 'Giriş Yap' : 'Kayıt Ol'}
              onPress={submit}
            />
          )}

          {mode === 'signin' ? (
            <Pressable
              onPress={() =>
                router.push({ pathname: '/reset-password', params: { email: email.trim() } })
              }
              hitSlop={8}>
              <Text style={styles.forgotText}>Şifremi unuttum?</Text>
            </Pressable>
          ) : null}

          <Pressable onPress={toggleMode} hitSlop={8}>
            <Text style={styles.switchText}>
              {mode === 'signin' ? 'Hesabın yok mu? ' : 'Zaten hesabın var mı? '}
              <Text style={styles.switchLink}>
                {mode === 'signin' ? 'Kayıt ol' : 'Giriş yap'}
              </Text>
            </Text>
          </Pressable>
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
  forgotText: {
    color: colors.cyan,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
  },
  switchLink: {
    color: colors.cyan,
    fontWeight: '700',
  },
});
