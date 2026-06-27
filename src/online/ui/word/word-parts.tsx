import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

/** Tasarımdaki "kelimeyi onayla" butonu: kelime tamamsa dolgun mavi gradyan
 *  hissi (düz renk + glow ile), değilse soluk. */
export function WordConfirmButton({
  enabled,
  busy,
  onPress,
  label = 'kelimeyi onayla',
}: {
  enabled: boolean;
  busy: boolean;
  onPress: () => void;
  label?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!enabled || busy}
      style={({ pressed }) => [
        styles.btn,
        enabled ? styles.btnEnabled : styles.btnDisabled,
        pressed && enabled && styles.btnPressed,
      ]}>
      {busy ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Feather name="check" size={16} color={enabled ? '#fff' : '#3A6080'} />
      )}
      <Text style={[styles.text, { color: enabled ? '#fff' : '#3A6080' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  btnEnabled: {
    backgroundColor: '#2FA8E0',
    borderColor: 'rgba(47,168,224,0.6)',
    boxShadow: '0 0 20px rgba(47,168,224,0.4)',
  },
  btnDisabled: {
    backgroundColor: 'rgba(47,168,224,0.1)',
    borderColor: 'rgba(47,168,224,0.2)',
  },
  btnPressed: {
    transform: [{ translateY: 1 }],
    backgroundColor: '#1D7DB5',
  },
  text: {
    fontWeight: '600',
    fontSize: 14,
    letterSpacing: 0.3,
  },
});
