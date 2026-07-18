import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { createClan, OnlineError, type Clan, type ClanEmblem, type ClanJoinMode } from '@/online';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';
import { DEFAULT_EMBLEM, EmblemBuilder } from './emblem';

const MIN_TROPHY_PRESETS = [0, 500, 1000, 1500];
const CREATE_COST = 1000;

/** Klan kurma: amblem oluşturucu + ad/açıklama + mod + min kupa. */
export function ClanCreate({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (clan: Clan) => void;
}) {
  const [emblem, setEmblem] = useState<ClanEmblem>(DEFAULT_EMBLEM);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [joinMode, setJoinMode] = useState<ClanJoinMode>('open');
  const [minTrophies, setMinTrophies] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length >= 3 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const clan = await createClan({
        name: name.trim(),
        description: description.trim(),
        emblem,
        joinMode,
        minTrophies,
      });
      onCreated(clan);
    } catch (e) {
      setError(e instanceof OnlineError ? e.message : 'Klan kurulamadı, tekrar dene.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.scroll}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={10} style={styles.backBtn}>
          <Feather name="arrow-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>KLAN KUR</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.card}>
        <EmblemBuilder value={emblem} onChange={setEmblem} />
      </View>

      <Text style={styles.label}>KLAN ADI</Text>
      <TextInput
        value={name}
        onChangeText={(t) => setName(t.slice(0, 20))}
        placeholder="Şifre Kırıcılar"
        placeholderTextColor={withAlpha(colors.dim, 0.6)}
        style={styles.input}
        maxLength={20}
      />

      <Text style={styles.label}>AÇIKLAMA (İSTEĞE BAĞLI)</Text>
      <TextInput
        value={description}
        onChangeText={(t) => setDescription(t.slice(0, 120))}
        placeholder="Klanının kısa tanımı…"
        placeholderTextColor={withAlpha(colors.dim, 0.6)}
        style={[styles.input, styles.multiline]}
        multiline
        maxLength={120}
      />

      <Text style={styles.label}>KATILIM</Text>
      <View style={styles.segment}>
        {([['open', 'Açık', 'unlock'], ['approval', 'Onaylı', 'user-check']] as const).map(([m, lbl, ic]) => {
          const active = joinMode === m;
          return (
            <Pressable key={m} onPress={() => setJoinMode(m)} style={[styles.segItem, active && styles.segActive]}>
              <Feather name={ic} size={14} color={active ? colors.cyan : colors.dim} />
              <Text style={[styles.segText, active && styles.segTextActive]}>{lbl}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>MİN. KUPA ŞARTI</Text>
      <View style={styles.chips}>
        {MIN_TROPHY_PRESETS.map((v) => {
          const active = minTrophies === v;
          return (
            <Pressable key={v} onPress={() => setMinTrophies(v)} style={[styles.trophyChip, active && styles.trophyChipActive]}>
              <Text style={[styles.trophyChipText, active && { color: colors.cyan }]}>{v === 0 ? 'Yok' : v}</Text>
            </Pressable>
          );
        })}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.reqNote}>Kurmak için: Seviye 3+ ve {CREATE_COST} Veri</Text>
      <Pressable onPress={submit} disabled={!canSubmit} style={[styles.submit, !canSubmit && styles.submitOff]}>
        {busy ? (
          <ActivityIndicator color={colors.ice} size="small" />
        ) : (
          <>
            <Feather name="flag" size={15} color={canSubmit ? colors.ice : colors.dim} />
            <Text style={[styles.submitText, !canSubmit && { color: colors.dim }]}>Klan Kur · {CREATE_COST} Veri</Text>
          </>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 32, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10, marginBottom: 4 },
  backBtn: {
    width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder,
  },
  title: {
    flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '800', letterSpacing: 3,
    color: colors.ice, fontFamily: mono, textShadowColor: cyanAlpha(0.5), textShadowRadius: 10,
  },
  card: {
    padding: 16, borderRadius: 20, backgroundColor: colors.glass,
    borderWidth: 1, borderColor: colors.glassBorder, marginBottom: 6,
  },
  label: { fontFamily: mono, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: colors.dim, marginTop: 10, marginBottom: 4 },
  input: {
    backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: colors.glassBorder,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: colors.text, fontSize: 15,
  },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
  segment: {
    flexDirection: 'row', gap: 8, backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 14, padding: 5, borderWidth: 1, borderColor: colors.glassBorder,
  },
  segItem: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: 'transparent',
  },
  segActive: { borderColor: colors.cyan, backgroundColor: cyanAlpha(0.14) },
  segText: { fontSize: 13, fontWeight: '700', color: colors.dim, fontFamily: mono },
  segTextActive: { color: colors.cyan },
  chips: { flexDirection: 'row', gap: 8 },
  trophyChip: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12,
    backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder,
  },
  trophyChipActive: { borderColor: colors.cyan, backgroundColor: cyanAlpha(0.12) },
  trophyChipText: { fontSize: 12, fontWeight: '800', color: colors.dim, fontFamily: mono },
  error: { color: colors.danger, fontSize: 12, textAlign: 'center', marginTop: 10 },
  reqNote: { color: colors.dim, fontSize: 11, textAlign: 'center', marginTop: 14, fontFamily: mono },
  submit: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    marginTop: 8, paddingVertical: 15, borderRadius: 14, borderWidth: 1.5,
    borderColor: cyanAlpha(0.55), backgroundColor: cyanAlpha(0.2),
  },
  submitOff: { borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.04)' },
  submitText: { fontSize: 14, fontWeight: '800', letterSpacing: 0.5, color: colors.ice, fontFamily: mono },
});
