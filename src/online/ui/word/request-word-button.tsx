import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { requestWord } from '@/online';
import { colors, mono, withAlpha } from '@/ui/theme';

type Status = 'idle' | 'sending' | 'submitted' | 'exists' | 'invalid' | 'error';

/**
 * "Sözlüğe öner" butonu — havuzda OLMAYAN bir kelimeyi admin onayına gönderir.
 * Yalnızca uyarıyı tetikleyen TAM kelime (4-6 harf) `word` olarak geçilir; ebeveyn
 * kelime değişince (harf ekle/sil) bunu koşullu render'la kaldırır → kısa/eksik
 * kelime önerilemez. Sunucu (request_word) biçimi ayrıca doğrular. Anon (offline
 * giriş yapmamış) da çağırabilir.
 */
export function RequestWordButton({ word, onSent }: { word: string; onSent?: () => void }) {
  const [status, setStatus] = useState<Status>('idle');

  // Yeni kelime → durumu sıfırla (aynı konumda bileşen yeniden kullanılırsa).
  useEffect(() => {
    setStatus('idle');
  }, [word]);

  const send = async () => {
    if (status === 'sending' || status === 'submitted') return;
    setStatus('sending');
    let result: Status = 'error';
    try {
      result = await requestWord(word); // 'submitted' | 'exists' | 'invalid'
    } catch {
      result = 'error';
    }
    // onSent verildiyse: öneri gönderildi → ebeveyn input'u temizler (buton kalkar).
    // Verilmediyse eski davranış: sonuç pill'ini göster.
    if (onSent) onSent();
    else setStatus(result);
  };

  if (status === 'submitted') {
    return (
      <View style={[styles.pill, styles.pillDone]}>
        <Feather name="check" size={13} color={colors.success} />
        <Text style={[styles.label, { color: colors.success }]}>Önerildi</Text>
      </View>
    );
  }
  if (status === 'exists' || status === 'invalid' || status === 'error') {
    const msg =
      status === 'exists'
        ? 'Zaten havuzda'
        : status === 'invalid'
          ? 'Geçersiz kelime'
          : 'Gönderilemedi';
    return (
      <View style={styles.pill}>
        <Text style={[styles.label, { color: colors.dim }]}>{msg}</Text>
      </View>
    );
  }
  return (
    <Pressable
      onPress={send}
      disabled={status === 'sending'}
      style={({ pressed }) => [styles.pill, styles.pillIdle, pressed && styles.pressed]}>
      <Feather name="plus" size={13} color={colors.cyan} />
      <Text style={[styles.label, { color: colors.cyan }]}>
        {status === 'sending' ? 'Gönderiliyor…' : 'Sözlüğe öner'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pillIdle: {
    borderColor: withAlpha(colors.cyan, 0.4),
    backgroundColor: withAlpha(colors.cyan, 0.1),
  },
  pillDone: {
    borderColor: withAlpha(colors.success, 0.4),
    backgroundColor: withAlpha(colors.success, 0.1),
  },
  pressed: {
    backgroundColor: withAlpha(colors.cyan, 0.2),
  },
  label: {
    fontFamily: mono,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
