import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  deleteClanMessage,
  fetchClanMessages,
  OnlineError,
  sendClanMessage,
  subscribeClanMessages,
  useOnlineIds,
  type Clan,
  type ClanMessage,
} from '@/online';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';
import { ClanEmblemView } from './emblem';
import { memberRank } from './roles';

/** Yazma çubuğu ile alt tab arası doğal boşluk. */
const INPUT_GAP = 12;

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Klan sohbeti (klandayken varsayılan görünüm). Üst başlığa dokununca üye/yönetim
 *  ekranı açılır. Realtime; hafif moderasyon sunucuda. */
export function ClanChat({
  clan,
  myId,
  onOpenMembers,
}: {
  clan: Clan;
  myId: string;
  onOpenMembers: () => void;
}) {
  const [messages, setMessages] = useState<ClanMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<ScrollView>(null);
  const onlineIds = useOnlineIds();
  const onlineCount = clan.members.filter((m) => onlineIds.has(m.player)).length;

  const nameOf = useCallback(
    (player: string) => clan.members.find((m) => m.player === player)?.username ?? 'Ayrılan üye',
    [clan.members],
  );
  const accentOf = useCallback(
    (player: string) => {
      const m = clan.members.find((x) => x.player === player);
      return m ? memberRank(m).accent : colors.dim;
    },
    [clan.members],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchClanMessages(clan.id)
      .then((ms) => {
        if (alive) {
          setMessages(ms);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    const unsub = subscribeClanMessages(clan.id, {
      onInsert: (m) => setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m])),
      onDelete: (id) => setMessages((prev) => prev.filter((x) => x.id !== id)),
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [clan.id]);

  const scrollEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const send = async () => {
    const body = input.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const m = await sendClanMessage(body);
      setInput('');
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    } catch (e) {
      Alert.alert('Hata', e instanceof OnlineError ? e.message : 'Mesaj gönderilemedi.');
    } finally {
      setSending(false);
    }
  };

  const canModerate = clan.myRole === 'leader' || clan.myRole === 'coleader';
  const onBubbleLongPress = (m: ClanMessage) => {
    if (m.player !== myId && !canModerate) return;
    Alert.alert('Mesajı sil', m.body, [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteClanMessage(m.id);
            setMessages((prev) => prev.filter((x) => x.id !== m.id));
          } catch (e) {
            Alert.alert('Hata', e instanceof OnlineError ? e.message : 'Silinemedi.');
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.flex, { paddingBottom: INPUT_GAP }]}>
      {/* Üst başlık → üye/yönetim ekranı */}
      <Pressable onPress={onOpenMembers} style={styles.header}>
        <ClanEmblemView emblem={clan.emblem} size={40} glow={false} />
        <View style={styles.headerInfo}>
          <Text style={styles.headerName} numberOfLines={1}>
            {clan.name}
          </Text>
          <View style={styles.headerMetaRow}>
            <View style={styles.onlineDot} />
            <Text style={styles.headerMeta}>
              {onlineCount} çevrimiçi · {clan.memberCount} üye
            </Text>
          </View>
        </View>
        <Feather name="users" size={18} color={colors.cyan} />
      </Pressable>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.cyan} />
        </View>
      ) : (
        <ScrollView
          ref={listRef}
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          onContentSizeChange={scrollEnd}
          onScrollBeginDrag={() => Keyboard.dismiss()}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Pressable style={styles.msgArea} onPress={() => Keyboard.dismiss()}>
          {messages.length === 0 ? (
            <View style={styles.centered}>
              <Feather name="message-circle" size={24} color={colors.dim} />
              <Text style={styles.emptyText}>Henüz mesaj yok. İlk yazan sen ol!</Text>
            </View>
          ) : (
            messages.map((m) => {
              const mine = m.player === myId;
              return (
                <Pressable
                  key={m.id}
                  onLongPress={() => onBubbleLongPress(m)}
                  style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                    {!mine ? (
                      <Text style={[styles.author, { color: accentOf(m.player) }]}>{nameOf(m.player)}</Text>
                    ) : null}
                    <Text style={styles.body}>{m.body}</Text>
                    <Text style={styles.time}>{hhmm(m.createdAt)}</Text>
                  </View>
                </Pressable>
              );
            })
          )}
          </Pressable>
        </ScrollView>
      )}

      {/* Yazma çubuğu — gönder butonu input yüksekliğiyle aynı (stretch) */}
      <View style={styles.inputBar}>
        <TextInput
          value={input}
          onChangeText={(t) => setInput(t.slice(0, 300))}
          placeholder="Mesaj yaz…"
          placeholderTextColor={withAlpha(colors.dim, 0.6)}
          style={styles.input}
          multiline
          maxLength={300}
        />
        <Pressable
          onPress={send}
          disabled={sending || !input.trim()}
          style={[styles.sendBtn, (sending || !input.trim()) && styles.sendBtnOff]}>
          {sending ? (
            <ActivityIndicator color={colors.ice} size="small" />
          ) : (
            <Feather name="send" size={18} color={input.trim() ? colors.ice : colors.dim} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 16, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder, marginTop: 4,
  },
  headerInfo: { flex: 1, gap: 3 },
  headerName: { fontSize: 16, fontWeight: '800', color: colors.ice, fontFamily: mono },
  headerMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  headerMeta: { fontSize: 11, color: colors.dim, fontFamily: mono },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 40 },
  emptyText: { color: colors.dim, fontSize: 13, textAlign: 'center' },
  scrollContent: { flexGrow: 1 },
  msgArea: { flexGrow: 1, gap: 8, paddingVertical: 14 },
  bubbleRow: { flexDirection: 'row', maxWidth: '100%' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '82%', borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1 },
  bubbleOther: { backgroundColor: colors.glass, borderColor: colors.glassBorder, borderTopLeftRadius: 4 },
  bubbleMine: { backgroundColor: cyanAlpha(0.14), borderColor: cyanAlpha(0.34), borderTopRightRadius: 4 },
  author: { fontSize: 11, fontWeight: '800', fontFamily: mono, marginBottom: 2 },
  body: { fontSize: 14, color: colors.text, lineHeight: 19 },
  time: { fontSize: 9, color: withAlpha(colors.dim, 0.7), fontFamily: mono, alignSelf: 'flex-end', marginTop: 2 },
  inputBar: { flexDirection: 'row', alignItems: 'stretch', gap: 8, paddingTop: 8 },
  input: {
    flex: 1, minHeight: 46, maxHeight: 120, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1,
    borderColor: colors.glassBorder, borderRadius: 14, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12,
    color: colors.text, fontSize: 15,
  },
  sendBtn: {
    width: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: cyanAlpha(0.55), backgroundColor: cyanAlpha(0.2),
  },
  sendBtnOff: { borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.04)' },
});
