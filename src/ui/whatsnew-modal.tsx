import { Feather } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, cyanAlpha, mono } from './theme';

/** "Yenilikler" sürüm kimliği. Her güncellemede (gösterilecek not varsa) BUMP et →
 *  modal, o güncellemenin ilk açılışında bir kez görünür (AsyncStorage ile). */
export const WHATSNEW_ID = 'mac-ici-emote';

type Note = { emoji: string; title: string; body: string };

const WHATSNEW_NOTES: Note[] = [
  {
    emoji: '😄',
    title: 'Maç içinde sinyal gönder',
    body: 'Artık maç sırasında rakibine sahip olduğun animasyonlu sinyalleri gönderebilirsin — kelime, hızlı ve protokol maçlarının hepsinde. Sinyal butonu tahmin/onay alanının hemen yanında.',
  },
  {
    emoji: '💬',
    title: '6 hazır mesaj',
    body: 'Sinyal tepsisinde hazır mesajlar da var: "İyi oyunlar!", "Kafanı kullan", "Hadi acele et" ve daha fazlası. Gönderdiğin sinyal ve mesajlar rakibin ekranında kısa süre belirir.',
  },
];

/** Güncelleme sonrası ilk açılışta BİR KEZ görünen "Yenilikler" modalı. */
export function WhatsNewModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 14 }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.card}>
          <View style={styles.head}>
            <View style={styles.headIcon}>
              <Feather name="gift" size={17} color={colors.cyan} />
            </View>
            <Text style={styles.title}>YENİLİKLER</Text>
            <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
              <Feather name="x" size={16} color={colors.dim} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {WHATSNEW_NOTES.map((n) => (
              <View key={n.title} style={styles.note}>
                <Text style={styles.noteEmoji}>{n.emoji}</Text>
                <View style={styles.noteText}>
                  <Text style={styles.noteTitle}>{n.title}</Text>
                  <Text style={styles.noteBody}>{n.body}</Text>
                </View>
              </View>
            ))}
          </ScrollView>

          <Pressable onPress={onClose} style={styles.cta}>
            <Text style={styles.ctaText}>Anladım</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(3,7,18,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    backgroundColor: colors.bgMid,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
  },
  headIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cyanAlpha(0.13),
    borderWidth: 1,
    borderColor: cyanAlpha(0.4),
  },
  title: { flex: 1, color: colors.ice, fontSize: 14, fontWeight: '800', letterSpacing: 2.5, fontFamily: mono },
  close: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, gap: 16 },
  note: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  noteEmoji: { fontSize: 22, lineHeight: 26 },
  noteText: { flex: 1, gap: 3 },
  noteTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  noteBody: { color: colors.dim, fontSize: 12.5, lineHeight: 18 },
  cta: {
    margin: 14,
    marginTop: 4,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: cyanAlpha(0.55),
    backgroundColor: cyanAlpha(0.2),
  },
  ctaText: { color: colors.ice, fontSize: 14, fontWeight: '800', letterSpacing: 1, fontFamily: mono },
});
