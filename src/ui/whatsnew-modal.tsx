import { Feather } from '@expo/vector-icons';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, cyanAlpha, mono } from './theme';

/** "Yenilikler" sürüm kimliği. Her güncellemede (gösterilecek duyuru varsa) BUMP et →
 *  modal, o güncellemenin ana ekran ilk açılışında BİR KEZ görünür (AsyncStorage ile). */
export const WHATSNEW_ID = 'gizem-cagi-mod-2026-07';

/** Güncelleme sonrası ana ekran ilk açılışında BİR KEZ görünen duyuru pankartı:
 *  başlık + tam görsel (çerçeveli) + sağ üstte kapatma ×. Sadece yeni mod duyurusu. */
export function WhatsNewModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 14 }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.card}>
          {/* üst enerji şeridi */}
          <View style={styles.beam} />

          <Pressable onPress={onClose} hitSlop={12} style={styles.close}>
            <Feather name="x" size={16} color={colors.ice} />
          </Pressable>

          <View style={styles.head}>
            <Text style={styles.kicker}>YENİ MOD</Text>
            <Text style={styles.title}>GİZEM ÇAĞI</Text>
            <Text style={styles.tag}>Üç hükümdar, tek diyar.</Text>
          </View>

          <View style={styles.frame}>
            <Image
              source={require('../../assets/images/whatsnew-gizem-cagi.png')}
              style={styles.img}
              resizeMode="cover"
            />
          </View>
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
    backgroundColor: colors.bgMid,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: cyanAlpha(0.4),
    paddingTop: 20,
    paddingBottom: 18,
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
  kicker: { fontFamily: mono, fontSize: 10, letterSpacing: 4, color: colors.cyan },
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
  tag: { fontSize: 12.5, color: colors.dim, textAlign: 'center' },
  frame: {
    width: '100%',
    aspectRatio: 1376 / 768,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: cyanAlpha(0.35),
    backgroundColor: '#0a1220',
  },
  img: { width: '100%', height: '100%' },
});
