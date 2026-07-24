import { Feather } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, cyanAlpha, mono, withAlpha } from './theme';

/** "Yenilikler" sürüm kimliği. Her güncellemede (gösterilecek not varsa) BUMP et →
 *  modal, o güncellemenin ana ekran ilk açılışında BİR KEZ görünür (AsyncStorage ile). */
export const WHATSNEW_ID = 'gizem-cagi-v3b-2026-07';

type Note = { icon: React.ComponentProps<typeof Feather>['name']; accent: string; title: string; body: string };

/** Bu sürümün notları (Gizem Çağı v3b — öğretici + kale kademeleri + cila). */
const NOTES: Note[] = [
  {
    icon: 'compass',
    accent: colors.violet,
    title: 'Maç öncesi öğretici',
    body: 'Gizem Çağı’na girmeden örnek harita üzerinde nasıl oynandığını öğren. Turnuva kartındaki “?” ile istediğin zaman tekrar aç.',
  },
  {
    icon: 'flag',
    accent: colors.gold,
    title: 'Kale kademeleri',
    body: 'Kaleler artık harf sayısına göre farklı görünüyor — 4 / 5 / 6 harf dışarıdan bir bakışta ayırt ediliyor.',
  },
  {
    icon: 'activity',
    accent: colors.cyan,
    title: 'Son Maçlar’da Gizem Çağı',
    body: 'Gizem Çağı maçları Son Maçlar sekmesine eklendi: kim kaç kale/kule aldı ve kaç puan topladı.',
  },
  {
    icon: 'zap',
    accent: colors.teal,
    title: 'Daha akıcı, daha net',
    body: 'Savunmada denemelerin geri bildirimiyle listeleniyor, kelimede klavye renkleniyor; süre sayacı, faz duyurusu ve oyuncu renkleri iyileştirildi.',
  },
];

/** Güncelleme sonrası ana ekran ilk açılışında BİR KEZ görünen "Yenilikler" notları:
 *  başlık + kısa madde listesi + sağ üstte kapatma ×. */
export function WhatsNewModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 14 }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.card}>
          <View style={styles.beam} />

          <Pressable onPress={onClose} hitSlop={12} style={styles.close}>
            <Feather name="x" size={16} color={colors.ice} />
          </Pressable>

          <View style={styles.head}>
            <Text style={styles.kicker}>GÜNCELLEME · GİZEM ÇAĞI</Text>
            <Text style={styles.title}>YENİLİKLER</Text>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listBody} showsVerticalScrollIndicator={false}>
            {NOTES.map((n) => (
              <View key={n.title} style={styles.note}>
                <View style={[styles.noteIcon, { borderColor: withAlpha(n.accent, 0.5), backgroundColor: withAlpha(n.accent, 0.14) }]}>
                  <Feather name={n.icon} size={16} color={n.accent} />
                </View>
                <View style={styles.noteText}>
                  <Text style={styles.noteTitle}>{n.title}</Text>
                  <Text style={styles.noteBody}>{n.body}</Text>
                </View>
              </View>
            ))}
          </ScrollView>

          <Pressable onPress={onClose} style={styles.cta}>
            <Text style={styles.ctaText}>Tamam</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(3,7,18,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '86%',
    backgroundColor: colors.bgMid,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: cyanAlpha(0.4),
    paddingTop: 20,
    paddingBottom: 16,
    paddingHorizontal: 16,
    overflow: 'hidden',
    boxShadow: `0 18px 48px rgba(0,0,0,0.55), 0 0 30px ${cyanAlpha(0.14)}`,
  },
  beam: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: colors.cyan,
    boxShadow: `0 0 18px ${colors.cyan}`,
  },
  close: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 5,
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  head: { alignItems: 'center', gap: 4, marginBottom: 14, paddingHorizontal: 30 },
  kicker: { fontFamily: mono, fontSize: 10, letterSpacing: 3, color: colors.cyan },
  title: {
    fontFamily: mono,
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 3,
    color: colors.ice,
    textShadowColor: cyanAlpha(0.7),
    textShadowRadius: 16,
    textAlign: 'center',
  },
  list: { flexGrow: 0, flexShrink: 1 },
  listBody: { gap: 12, paddingBottom: 4 },
  note: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  noteIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    marginTop: 1,
  },
  noteText: { flex: 1, gap: 3 },
  noteTitle: { fontFamily: mono, fontSize: 14, fontWeight: '800', color: colors.ice },
  noteBody: { fontFamily: 'Comfortaa', fontSize: 12.5, color: colors.dim, lineHeight: 18 },
  cta: {
    marginTop: 14,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: cyanAlpha(0.55),
    backgroundColor: cyanAlpha(0.16),
  },
  ctaText: { fontFamily: mono, fontSize: 13, fontWeight: '800', color: colors.ice, letterSpacing: 1 },
});
