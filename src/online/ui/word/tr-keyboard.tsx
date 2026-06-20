import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import type { LetterMark } from '@/game';
import { mono } from '@/ui/theme';

/** Türkçe Q-klavye dizilimi (tasarımla birebir): q/w/x sönük + pasif
 *  (Türk alfabesinde yok; havuzlarda da geçmez). */
const ROW1 = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'ı', 'o', 'p', 'ğ', 'ü'];
const ROW2 = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ş', 'i'];
const ROW3 = ['z', 'x', 'c', 'v', 'b', 'n', 'm', 'ö', 'ç'];
const DIMMED = new Set(['q', 'w', 'x']);

/** Parmak dostu Türkçe klavye: 3. satır harfler + ⌫ (amber, SAĞ uçta).
 *  Onay/✓ tuşu YOK — onaylama klavyenin ÜSTÜNDEKİ aksiyon butonundan yapılır
 *  (bkz. WordConfirmButton: setup'ta "Kelimeyi Belirle", düelloda "Kelimeyi
 *  Onayla"). large: düello ekranı (30×46 tuş); değilse belirleme (26×40). */
export function TrKeyboard({
  onKey,
  onDelete,
  locked = false,
  large = false,
  letterStates,
}: {
  onKey: (letter: string) => void;
  onDelete: () => void;
  locked?: boolean;
  large?: boolean;
  /** KELİME modu Wordle tuş renkleri: harf → 'G' (yeşil) · 'Y' (sarı) · 'X'
   *  (denenmiş ama yok = GRİ). Verilmezse tüm tuşlar nötr (belirleme ekranı). */
  letterStates?: Record<string, LetterMark>;
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
    // Wordle tuş rengi (yalnız düelloda; belirlemede letterStates yok → nötr).
    const mark = dim ? undefined : letterStates?.[k];
    const colored = mark === 'G' || mark === 'Y';
    return (
      <Pressable
        key={k}
        disabled={locked || dim}
        onPress={() => onKey(k)}
        style={({ pressed }) => [
          styles.key,
          { width: keyW, height: keyH },
          mark === 'G' && styles.keyGreen,
          mark === 'Y' && styles.keyYellow,
          mark === 'X' && styles.keyGray,
          pressed && styles.keyPressed,
        ]}>
        <Text
          style={[
            styles.keyText,
            { fontSize },
            dim && styles.keyTextDim,
            colored && styles.keyTextOn,
            locked && !dim && !mark && styles.keyTextLocked,
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
        {ROW3.map(letterKey)}
        {/* ⌫ artık alt sıranın SAĞ ucunda (eski onay tuşunun yeri); onay tuşu yok. */}
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
  // Wordle tuş durumları (kelime düellosu). 'G'/'Y' renkli; 'X' = denenmiş ama
  // yok → GRİ (nötr/denenmemiş tuştan AYRI: tahmin satırındaki şeffaf 'yok'la
  // karışmaması bilinçli).
  keyGreen: {
    backgroundColor: 'rgba(34,197,94,0.9)',
    borderColor: 'rgba(34,197,94,1)',
  },
  keyYellow: {
    backgroundColor: 'rgba(234,179,8,0.92)',
    borderColor: 'rgba(234,179,8,1)',
  },
  keyGray: {
    backgroundColor: 'rgba(40,52,66,0.95)',
    borderColor: 'rgba(70,86,104,0.9)',
  },
  keyText: {
    color: '#C8DCF0',
    fontFamily: mono,
    fontWeight: '600',
  },
  keyTextOn: {
    color: '#0A1018',
    fontWeight: '800',
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
});
