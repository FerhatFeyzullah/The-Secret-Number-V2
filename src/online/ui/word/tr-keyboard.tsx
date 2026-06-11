import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { mono } from '@/ui/theme';

/** Türkçe Q-klavye dizilimi (tasarımla birebir): q/w/x sönük + pasif
 *  (Türk alfabesinde yok; havuzlarda da geçmez). */
const ROW1 = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'ı', 'o', 'p', 'ğ', 'ü'];
const ROW2 = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ş', 'i'];
const ROW3 = ['z', 'x', 'c', 'v', 'b', 'n', 'm', 'ö', 'ç'];
const DIMMED = new Set(['q', 'w', 'x']);

/** Parmak dostu Türkçe klavye: 3. satır ⌫ (amber) + harfler + ✓ (yeşil).
 *  large: düello ekranı (30×46 tuş); değilse belirleme (26×40, tasarım). */
export function TrKeyboard({
  onKey,
  onDelete,
  onSubmit,
  locked = false,
  submitEnabled = true,
  large = false,
  hideSubmit = false,
}: {
  onKey: (letter: string) => void;
  onDelete: () => void;
  onSubmit: () => void;
  locked?: boolean;
  /** ✓ tuşunun basılabilirliği (kelime tamamlanmadan sönük). */
  submitEnabled?: boolean;
  large?: boolean;
  /** true → ✓ tuşu gizlenir; yerine denge spacer'ı konur (düello onay butonu var). */
  hideSubmit?: boolean;
}) {
  // Tuş genişliği EKRANA göre: en geniş satır 12 sütun + 11 boşluk; dar
  // cihazda taşmaz, geniş cihazda büyür (parmak dostu üst sınır 34).
  const { width } = useWindowDimensions();
  const keyW = Math.min(34, Math.floor((width - 12 - 11 * 5) / 12));
  const keyH = large ? 50 : 46;
  const actW = Math.round(keyW * 1.5);
  const fontSize = large ? 16 : 15;

  const letterKey = (k: string) => {
    const dim = DIMMED.has(k);
    return (
      <Pressable
        key={k}
        disabled={locked || dim}
        onPress={() => onKey(k)}
        style={({ pressed }) => [
          styles.key,
          { width: keyW, height: keyH },
          pressed && styles.keyPressed,
        ]}>
        <Text
          style={[
            styles.keyText,
            { fontSize },
            dim && styles.keyTextDim,
            locked && !dim && styles.keyTextLocked,
          ]}>
          {k}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.row}>{ROW1.map(letterKey)}</View>
      <View style={[styles.row, styles.row2]}>{ROW2.map(letterKey)}</View>
      <View style={styles.row}>
        <Pressable
          disabled={locked}
          onPress={onDelete}
          style={({ pressed }) => [
            styles.key,
            styles.keyBack,
            { width: actW, height: keyH },
            pressed && styles.keyPressed,
          ]}>
          <Feather name="delete" size={large ? 16 : 14} color="#FBBF24" />
        </Pressable>
        {ROW3.map(letterKey)}
        {hideSubmit ? (
          <View style={{ width: actW, height: keyH }} />
        ) : (
          <Pressable
            disabled={locked || !submitEnabled}
            onPress={onSubmit}
            style={({ pressed }) => [
              styles.key,
              styles.keyEnter,
              { width: actW, height: keyH },
              !submitEnabled && styles.keyEnterDisabled,
              pressed && styles.keyPressed,
            ]}>
            <Feather name="check" size={large ? 16 : 14} color={submitEnabled ? '#4ADE80' : 'rgba(74,222,128,0.35)'} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
  },
  row2: {
    paddingHorizontal: 14,
  },
  key: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  keyPressed: {
    backgroundColor: 'rgba(47,168,224,0.2)',
    borderColor: 'rgba(47,168,224,0.45)',
    transform: [{ scale: 0.95 }],
  },
  keyText: {
    color: '#C8DCF0',
    fontFamily: mono,
    fontWeight: '600',
  },
  keyTextDim: {
    color: 'rgba(255,255,255,0.2)',
  },
  keyTextLocked: {
    color: 'rgba(200,220,240,0.35)',
  },
  keyBack: {
    backgroundColor: 'rgba(251,191,36,0.15)',
    borderColor: 'rgba(251,191,36,0.3)',
  },
  keyEnter: {
    backgroundColor: 'rgba(74,222,128,0.2)',
    borderColor: 'rgba(74,222,128,0.35)',
  },
  keyEnterDisabled: {
    backgroundColor: 'rgba(74,222,128,0.08)',
    borderColor: 'rgba(74,222,128,0.15)',
  },
});
