import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { GlassButton } from '@/ui/glass';
import { colors } from '@/ui/theme';

import { useUpdateCheck } from './use-update-check';

/**
 * Ayarlardaki "Güncellemeleri Denetle" butonu. Tap → denetle → varsa indir →
 * otomatik yeniden başlat (bkz. use-update-check). Sonucu (güncel / indiriliyor /
 * hata / dev'de kullanılamaz) buton altında kısa bir ipucuyla gösterir.
 */
export function UpdateCheckButton() {
  const { status, progress, check } = useUpdateCheck();

  const busy = status === 'checking' || status === 'downloading' || status === 'restarting';
  const pct = progress != null ? Math.round(progress * 100) : null;

  const label =
    status === 'checking'
      ? 'Denetleniyor…'
      : status === 'downloading'
        ? pct != null
          ? `İndiriliyor… %${pct}`
          : 'İndiriliyor…'
        : status === 'restarting'
          ? 'Yeniden başlatılıyor…'
          : 'Güncellemeleri Denetle';

  const accent =
    status === 'error' ? colors.danger : status === 'uptodate' ? colors.success : colors.cyan;

  const hint =
    status === 'uptodate'
      ? 'En güncel sürümü kullanıyorsun.'
      : status === 'error'
        ? 'Denetlenemedi. Bağlantını kontrol edip tekrar dene.'
        : status === 'unsupported'
          ? 'Güncelleme yalnızca yayınlanan sürümde çalışır.'
          : status === 'idle'
            ? 'Yeni içerik ve modları hemen indir.'
            : null;

  const hintColor =
    status === 'uptodate' ? colors.success : status === 'error' ? colors.danger : colors.dim;

  return (
    <View>
      <GlassButton
        small
        label={label}
        accent={accent}
        disabled={busy || status === 'unsupported'}
        onPress={check}
        icon={
          busy ? (
            <ActivityIndicator size="small" color={colors.cyan} />
          ) : (
            <Feather name="download-cloud" size={16} color={colors.cyan} />
          )
        }
      />
      {hint ? <Text style={[styles.hint, { color: hintColor }]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 8,
  },
});
