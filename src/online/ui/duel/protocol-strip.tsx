import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getProtocol, PILLAR_LABELS } from '@/protocols/catalog';
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

function Tile({
  tile,
  onUse,
  onInfoOpen,
  onInfoClose,
}: {
  tile: ProtocolTileState;
  onUse: (id: string) => void;
  onInfoOpen: (id: string) => void;
  onInfoClose: () => void;
}) {
  const proto = getProtocol(tile.id);
  if (!proto) return null;
  const color = PILLAR_COLOR[proto.pillar];
  const ready = tile.status === 'ready';
  // Kurulu savunma: tam renk + güçlü glow, ama basılamaz (bekliyor).
  const lit = ready || tile.status === 'armed';

  return (
    <Pressable
      // Normal dokunuş = kullan (yalnız ready). Basılı tutma = bilgi balonu
      // (kullanım TETİKLENMEZ — RN, onLongPress sonrası onPress'i çağırmaz).
      onPress={() => {
        if (ready) onUse(tile.id);
      }}
      onLongPress={() => onInfoOpen(tile.id)}
      onPressOut={onInfoClose}
      delayLongPress={300}
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

/** Basılı-tut bilgi balonu (tile'ın üstünde). Konum, tile sayısına/index'ine
 *  göre hizalanır → ekran kenarına taşmaz. Camsı, küçük, temaya uygun. */
function InfoTooltip({ id, index, count }: { id: string; index: number; count: number }) {
  const proto = getProtocol(id);
  if (!proto) return null;
  const color = PILLAR_COLOR[proto.pillar];
  const align = index === 0 ? 'flex-start' : index === count - 1 ? 'flex-end' : 'center';
  return (
    <View style={[styles.tooltipLayer, { alignItems: align }]} pointerEvents="none">
      <View style={[styles.tooltip, { borderColor: withAlpha(color, 0.5) }]}>
        <View style={styles.tooltipHead}>
          <Feather name={protocolIcon(id)} size={12} color={color} />
          <Text style={styles.tooltipName} numberOfLines={1}>
            {proto.name}
          </Text>
          <View
            style={[
              styles.tooltipTag,
              { borderColor: withAlpha(color, 0.4), backgroundColor: withAlpha(color, 0.14) },
            ]}>
            <Text style={[styles.tooltipTagText, { color }]}>{PILLAR_LABELS[proto.pillar]}</Text>
          </View>
        </View>
        <Text style={styles.tooltipEffect}>{proto.effect}</Text>
      </View>
    </View>
  );
}

/** Sürekli görünür protokol şeridi (düello altı): maç için KENDİ seçtiğin
 *  protokoller (≤3) — rakibinki asla gösterilmez. Basınca use_protocol RPC
 *  tetiklenir (etki sunucuda). Basılı tutunca bilgi balonu açılır (kullanım
 *  TETİKLENMEZ). silenced=true → "susturuldun" göstergesi. */
export function ProtocolStrip({
  tiles,
  onUse,
  silenced = false,
}: {
  tiles: ProtocolTileState[];
  onUse: (id: string) => void;
  silenced?: boolean;
}) {
  const [infoId, setInfoId] = useState<string | null>(null);
  if (tiles.length === 0) return null;
  const infoIndex = infoId ? tiles.findIndex((t) => t.id === infoId) : -1;
  return (
    <View style={[styles.root, silenced && styles.rootSilenced]}>
      {silenced ? (
        <View style={styles.silenced}>
          <Feather name="volume-x" size={10} color={colors.danger} />
          <Text style={styles.silencedText}>SUSTURULDUN</Text>
        </View>
      ) : null}
      {infoId && infoIndex >= 0 ? (
        <InfoTooltip id={infoId} index={infoIndex} count={tiles.length} />
      ) : null}
      <View style={styles.row}>
        {tiles.map((t) => (
          <Tile
            key={t.id}
            tile={t}
            onUse={onUse}
            onInfoOpen={setInfoId}
            onInfoClose={() => setInfoId(null)}
          />
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
  // Basılı-tut bilgi balonu — şeridin hemen üstünde, kenara taşmadan.
  tooltipLayer: {
    position: 'absolute',
    bottom: '100%',
    left: 8,
    right: 8,
    marginBottom: 8,
    zIndex: 40,
  },
  tooltip: {
    maxWidth: 240,
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 13,
    borderWidth: 1,
    backgroundColor: 'rgba(8,15,30,0.96)',
    boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
  },
  tooltipHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  tooltipName: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '800',
    color: colors.ice,
    fontFamily: mono,
    letterSpacing: 0.3,
  },
  tooltipTag: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  tooltipTagText: {
    fontSize: 8,
    fontWeight: '700',
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  tooltipEffect: {
    fontSize: 10,
    color: colors.dim,
    lineHeight: 14,
  },
});
