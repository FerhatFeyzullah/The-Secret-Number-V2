import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getProtocol } from '@/protocols/catalog';
import { colors, mono, withAlpha } from '@/ui/theme';

import { PILLAR_COLOR, protocolIcon } from '../protocol-visuals';

/** Tile görsel durumu:
 *  ready    → tam renk + glow, basılabilir
 *  armed    → kurulu savunma (Kalkan/Yansıtma) — tam renk + glow, BEKLİYOR
 *  cooldown → kullanıldı/beklemede (soluk + kilit ve örn. "KULLANILDI")
 *  blocked  → şu an kullanılamaz (sıra sende değil / susturuldun; soluk) */
export type ProtocolTileStatus = 'ready' | 'armed' | 'cooldown' | 'blocked';

export type ProtocolTileState = {
  id: string;
  status: ProtocolTileStatus;
  /** Durum etiketi (örn. cooldown'da "1 TUR"); yoksa duruma göre varsayılan. */
  note?: string;
};

function statusLabel(t: ProtocolTileState): string {
  if (t.note) return t.note;
  if (t.status === 'ready') return 'HAZIR';
  if (t.status === 'armed') return 'AKTİF';
  if (t.status === 'cooldown') return 'BEKLEME';
  return 'KAPALI';
}

function Tile({ tile, onUse }: { tile: ProtocolTileState; onUse: (id: string) => void }) {
  const proto = getProtocol(tile.id);
  if (!proto) return null;
  const color = PILLAR_COLOR[proto.pillar];
  const ready = tile.status === 'ready';
  // Kurulu savunma: tam renk + güçlü glow, ama basılamaz (bekliyor).
  const lit = ready || tile.status === 'armed';

  return (
    <Pressable
      onPress={ready ? () => onUse(tile.id) : undefined}
      disabled={!ready}
      style={({ pressed }) => [styles.tile, !lit && styles.tileOff, pressed && ready && styles.tilePressed]}>
      <View
        style={[
          styles.tileIcon,
          {
            borderColor: withAlpha(color, lit ? 0.55 : 0.3),
            backgroundColor: withAlpha(color, lit ? 0.16 : 0.08),
            boxShadow: lit
              ? `0 0 ${tile.status === 'armed' ? 16 : 12}px ${withAlpha(color, tile.status === 'armed' ? 0.5 : 0.35)}`
              : undefined,
          },
        ]}>
        <Feather name={protocolIcon(tile.id)} size={17} color={lit ? color : colors.dim} />
        {proto.oneShot ? (
          <View style={styles.oneShot}>
            <Text style={styles.oneShotText}>1×</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.tileName} numberOfLines={1}>
        {proto.name}
      </Text>
      <View style={styles.tileStatus}>
        {tile.status === 'cooldown' ? (
          <Feather name="lock" size={7} color={colors.dim} />
        ) : (
          <View
            style={[
              styles.statusDot,
              { backgroundColor: lit ? color : colors.dim },
              lit && { boxShadow: `0 0 5px ${color}` },
            ]}
          />
        )}
        <Text style={[styles.statusText, { color: lit ? color : colors.dim }]}>
          {statusLabel(tile)}
        </Text>
      </View>
    </Pressable>
  );
}

/** Sürekli görünür protokol şeridi (düello altı): maç için KENDİ seçtiğin
 *  protokoller (≤3) — rakibinki asla gösterilmez. Basınca use_protocol RPC
 *  tetiklenir (etki sunucuda). silenced=true → "susturuldun" göstergesi. */
export function ProtocolStrip({
  tiles,
  onUse,
  silenced = false,
}: {
  tiles: ProtocolTileState[];
  onUse: (id: string) => void;
  silenced?: boolean;
}) {
  if (tiles.length === 0) return null;
  return (
    <View style={[styles.root, silenced && styles.rootSilenced]}>
      {silenced ? (
        <View style={styles.silenced}>
          <Feather name="volume-x" size={10} color={colors.danger} />
          <Text style={styles.silencedText}>SUSTURULDUN</Text>
        </View>
      ) : null}
      <View style={styles.row}>
        {tiles.map((t) => (
          <Tile key={t.id} tile={t} onUse={onUse} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 16,
    paddingVertical: 7,
    paddingHorizontal: 10,
    gap: 4,
  },
  rootSilenced: {
    borderColor: withAlpha(colors.danger, 0.4),
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  silenced: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  silencedText: {
    fontSize: 8,
    fontWeight: '800',
    color: colors.danger,
    fontFamily: mono,
    letterSpacing: 1.5,
  },
  tile: {
    flex: 1,
    maxWidth: 110,
    alignItems: 'center',
    gap: 3,
    borderRadius: 12,
    paddingVertical: 4,
  },
  tileOff: {
    opacity: 0.38,
  },
  tilePressed: {
    transform: [{ scale: 0.94 }],
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  tileIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  oneShot: {
    position: 'absolute',
    top: -5,
    right: -7,
    borderRadius: 6,
    paddingHorizontal: 3,
    paddingVertical: 1,
    backgroundColor: colors.bgTop,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  oneShotText: {
    fontSize: 7,
    fontWeight: '800',
    color: colors.ice,
    fontFamily: mono,
  },
  tileName: {
    fontSize: 8,
    fontWeight: '700',
    color: colors.ice,
    fontFamily: mono,
    letterSpacing: 0.3,
    maxWidth: 100,
  },
  tileStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  statusText: {
    fontSize: 7,
    fontWeight: '700',
    fontFamily: mono,
    letterSpacing: 0.8,
  },
});
