import { Feather } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  acceptClanRequest,
  disbandClan,
  kickClanMember,
  leaveClan,
  OnlineError,
  rejectClanRequest,
  setClanMemberRole,
  transferClanLeadership,
  type Clan,
  type ClanMember,
  type ClanRequest,
} from '@/online';
import { colors, mono, withAlpha } from '@/ui/theme';
import { Avatar } from '../parts';
import { ClanEmblemView } from './emblem';
import { joinModeLabel, memberRank } from './roles';

/** Klan ana ekranı (klandayken): başlık + istekler + üye listesi + yönetim. */
export function ClanHome({
  clan,
  myId,
  onReload,
  onExit,
  onLeaderboard,
}: {
  clan: Clan;
  myId: string;
  onReload: () => Promise<void>;
  onExit: () => void;
  onLeaderboard: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const iAmLeader = clan.myRole === 'leader';
  const iAmManager = iAmLeader || clan.myRole === 'coleader';

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      try {
        await fn();
      } catch (e) {
        Alert.alert('Hata', e instanceof OnlineError ? e.message : 'İşlem başarısız, tekrar dene.');
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const openMemberMenu = (m: ClanMember) => {
    if (!iAmManager || m.player === myId || m.role === 'leader') return;
    const rank = memberRank(m);
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [];
    if (iAmLeader) {
      if (m.role === 'coleader') {
        buttons.push({ text: 'Üyeliğe indir', onPress: () => void run(async () => { await setClanMemberRole(m.player, 'member'); await onReload(); }) });
      } else {
        buttons.push({ text: 'Şifreci yap', onPress: () => void run(async () => { await setClanMemberRole(m.player, 'coleader'); await onReload(); }) });
      }
      buttons.push({
        text: 'Liderliği devret',
        onPress: () =>
          Alert.alert('Liderliği devret', `${m.username} yeni Operatör olacak; sen Şifreci olacaksın.`, [
            { text: 'İptal', style: 'cancel' },
            { text: 'Devret', onPress: () => void run(async () => { await transferClanLeadership(m.player); await onReload(); }) },
          ]),
      });
    }
    buttons.push({
      text: 'Klandan at',
      style: 'destructive',
      onPress: () =>
        Alert.alert('Klandan at', `${m.username} klandan atılsın mı?`, [
          { text: 'İptal', style: 'cancel' },
          { text: 'At', style: 'destructive', onPress: () => void run(async () => { await kickClanMember(m.player); await onReload(); }) },
        ]),
    });
    buttons.push({ text: 'İptal', style: 'cancel' });
    Alert.alert(m.username, `${rank.label} · ${m.rating} kupa`, buttons);
  };

  const leaveOrDisband = () => {
    if (iAmLeader) {
      Alert.alert('Klanı dağıt', 'Klan tamamen silinecek ve tüm üyeler çıkarılacak. Emin misin?', [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Dağıt', style: 'destructive', onPress: () => void run(async () => { await disbandClan(); onExit(); }) },
      ]);
    } else {
      Alert.alert('Klandan ayrıl', 'Bu klandan ayrılmak istediğine emin misin?', [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Ayrıl', style: 'destructive', onPress: () => void run(async () => { await leaveClan(); onExit(); }) },
      ]);
    }
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
      {/* Başlık kartı */}
      <View style={styles.headerCard}>
        <ClanEmblemView emblem={clan.emblem} size={62} />
        <View style={styles.headerInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{clan.name}</Text>
            <Text style={styles.tag}>[{clan.tag}]</Text>
          </View>
          <View style={styles.metaRow}>
            <View style={styles.metaChip}>
              <Feather name="users" size={11} color={colors.cyan} />
              <Text style={styles.metaText}>{clan.memberCount}/30</Text>
            </View>
            <View style={styles.metaChip}>
              <Feather name="unlock" size={11} color={colors.dim} />
              <Text style={styles.metaText}>{joinModeLabel(clan.joinMode)}</Text>
            </View>
            {clan.minTrophies > 0 ? (
              <View style={styles.metaChip}>
                <Feather name="award" size={11} color={colors.amber} />
                <Text style={styles.metaText}>{clan.minTrophies}+</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
      {clan.description ? <Text style={styles.description}>{clan.description}</Text> : null}

      {/* Sıra + skor → lider tablosu */}
      <Pressable onPress={onLeaderboard} style={styles.rankBanner}>
        <Feather name="bar-chart-2" size={16} color={colors.amber} />
        <Text style={styles.rankText}>
          Sıra <Text style={styles.rankNum}>#{clan.rank}</Text> · {clan.score} skor
        </Text>
        <Feather name="chevron-right" size={16} color={colors.dim} />
      </Pressable>

      {/* Bekleyen istekler (yönetici) */}
      {iAmManager && clan.requests.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>KATILIM İSTEKLERİ · {clan.requests.length}</Text>
          {clan.requests.map((r) => (
            <RequestRow key={r.player} req={r} busy={busy} onAccept={() => void run(async () => { await acceptClanRequest(r.player); await onReload(); })} onReject={() => void run(async () => { await rejectClanRequest(r.player); await onReload(); })} />
          ))}
        </View>
      ) : null}

      {/* Üyeler */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>ÜYELER · {clan.memberCount}/30</Text>
        {clan.members.map((m) => {
          const rank = memberRank(m);
          const manageable = iAmManager && m.player !== myId && m.role !== 'leader';
          return (
            <Pressable
              key={m.player}
              onPress={() => openMemberMenu(m)}
              disabled={!manageable}
              style={({ pressed }) => [styles.memberRow, pressed && manageable && styles.memberPressed]}>
              <Avatar initial={m.username.charAt(0) || '?'} accent={rank.accent} size={38} />
              <View style={styles.memberInfo}>
                <Text style={styles.memberName} numberOfLines={1}>
                  {m.username}
                  {m.player === myId ? <Text style={styles.you}> (sen)</Text> : null}
                </Text>
                <Text style={[styles.memberRank, { color: rank.accent }]}>{rank.label}</Text>
              </View>
              <View style={styles.memberRight}>
                <Feather name="award" size={11} color={colors.amber} />
                <Text style={styles.memberRating}>{m.rating}</Text>
              </View>
              {manageable ? <Feather name="more-vertical" size={16} color={colors.dim} /> : null}
            </Pressable>
          );
        })}
      </View>

      {/* Ayrıl / Dağıt */}
      <Pressable onPress={leaveOrDisband} disabled={busy} style={styles.leaveBtn}>
        {busy ? (
          <ActivityIndicator color={colors.danger} size="small" />
        ) : (
          <>
            <Feather name={iAmLeader ? 'trash-2' : 'log-out'} size={15} color={colors.danger} />
            <Text style={styles.leaveText}>{iAmLeader ? 'Klanı Dağıt' : 'Klandan Ayrıl'}</Text>
          </>
        )}
      </Pressable>
    </ScrollView>
  );
}

function RequestRow({
  req,
  busy,
  onAccept,
  onReject,
}: {
  req: ClanRequest;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <View style={styles.requestRow}>
      <Avatar initial={req.username.charAt(0) || '?'} accent={colors.cyan} size={34} />
      <View style={styles.memberInfo}>
        <Text style={styles.memberName} numberOfLines={1}>{req.username}</Text>
        <Text style={styles.reqMeta}>{req.rating} kupa</Text>
      </View>
      <Pressable onPress={onReject} disabled={busy} hitSlop={6} style={[styles.reqBtn, styles.reqReject]}>
        <Feather name="x" size={16} color={colors.danger} />
      </Pressable>
      <Pressable onPress={onAccept} disabled={busy} hitSlop={6} style={[styles.reqBtn, styles.reqAccept]}>
        <Feather name="check" size={16} color={colors.success} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 28, gap: 14 },
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 20,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    marginTop: 4,
  },
  headerInfo: { flex: 1, gap: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  name: { flexShrink: 1, fontSize: 18, fontWeight: '800', color: colors.ice, fontFamily: mono },
  tag: { fontSize: 12, fontWeight: '800', color: colors.cyan, fontFamily: mono },
  metaRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 3, paddingHorizontal: 8, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  metaText: { fontSize: 10, fontWeight: '700', color: colors.text, fontFamily: mono },
  description: { fontSize: 13, color: colors.dim, lineHeight: 19, paddingHorizontal: 4 },
  rankBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 11, paddingHorizontal: 14, borderRadius: 14,
    backgroundColor: withAlpha(colors.amber, 0.08), borderWidth: 1, borderColor: withAlpha(colors.amber, 0.28),
  },
  rankText: { flex: 1, fontSize: 13, color: colors.text, fontFamily: mono, fontWeight: '700' },
  rankNum: { color: colors.amber, fontWeight: '900' },
  section: { gap: 8 },
  sectionLabel: { fontFamily: mono, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, color: colors.dim, marginBottom: 2 },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 9, paddingHorizontal: 12, borderRadius: 14,
    backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder,
  },
  memberPressed: { backgroundColor: 'rgba(255,255,255,0.06)' },
  memberInfo: { flex: 1, gap: 2 },
  memberName: { fontSize: 14, fontWeight: '700', color: colors.text },
  you: { color: colors.dim, fontWeight: '600', fontSize: 12 },
  memberRank: { fontSize: 11, fontWeight: '800', fontFamily: mono, letterSpacing: 0.5 },
  memberRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  memberRating: { fontSize: 12, fontWeight: '800', color: colors.amber, fontFamily: mono },
  requestRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14,
    backgroundColor: withAlpha(colors.cyan, 0.06), borderWidth: 1, borderColor: withAlpha(colors.cyan, 0.22),
  },
  reqMeta: { fontSize: 11, color: colors.dim, fontFamily: mono },
  reqBtn: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  reqReject: { backgroundColor: withAlpha(colors.danger, 0.1), borderColor: withAlpha(colors.danger, 0.35) },
  reqAccept: { backgroundColor: withAlpha(colors.success, 0.12), borderColor: withAlpha(colors.success, 0.4) },
  leaveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 6, paddingVertical: 13, borderRadius: 14,
    borderWidth: 1, borderColor: withAlpha(colors.danger, 0.4), backgroundColor: withAlpha(colors.danger, 0.08),
  },
  leaveText: { fontSize: 13, fontWeight: '800', color: colors.danger, fontFamily: mono, letterSpacing: 0.5 },
});
