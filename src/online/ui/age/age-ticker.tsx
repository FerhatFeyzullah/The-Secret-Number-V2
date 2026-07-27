import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import type { AgeState } from '@/online';
import { colors, display, withAlpha } from '@/ui/theme';
import { AGE, palette } from './age-colors';
import { AgeFlag, AgeShield, AgeSiege } from './age-icons';

/** Haritada olup biteni anlatan minik akış çipi. */
export type AgeEvent = {
  id: number;
  text: string;
  /** İlgili oyuncunun rengi (çipin aksanı). */ color: string;
  kind: 'conquer' | 'steal' | 'out';
};

/** Aynı anda ekranda tutulacak en fazla çip (üst üste yığılmasın). */
const MAX_VISIBLE = 2;

const VOWELS = 'aeıioöuü';

/** Türkçe tamlayan eki: son ünlüye göre -ın/-in/-un/-ün, ünlüyle bitiyorsa
 *  kaynaştırma n'si. "Derya" → Derya'nın · "Zeynep" → Zeynep'in. */
export function possessive(name: string): string {
  const lower = name.toLocaleLowerCase('tr');
  let lastVowel = '';
  for (const ch of lower) if (VOWELS.includes(ch)) lastVowel = ch;
  // NOT: lastVowel boşsa (ünlüsüz ad) `includes('')` her zaman true döner →
  // önce açıkça ele alınır, yoksa yanlışlıkla kalın eke düşer.
  const suffix = !lastVowel
    ? 'in'
    : 'aı'.includes(lastVowel)
      ? 'ın'
      : 'ou'.includes(lastVowel)
        ? 'un'
        : 'öü'.includes(lastVowel)
          ? 'ün'
          : 'in';
  const last = lower.slice(-1);
  const endsWithVowel = last !== '' && VOWELS.includes(last);
  return `${name}'${endsWithVowel ? 'n' : ''}${suffix}`;
}

/** Harita durumundaki değişimleri (fetih / el değiştirme / eleme) izleyip akış
 *  olaylarına çevirir. Sunucuda olay akışı yok → iki durum arasındaki FARKtan
 *  türetilir. İlk render'da olay üretmez (açılışta 20 çip patlamasın). */
export function useAgeEvents(state: AgeState, colorMap: Record<string, string>) {
  const [events, setEvents] = useState<AgeEvent[]>([]);
  const prevOwners = useRef(new Map<string, string | null>());
  const seenElim = useRef(new Set<string>());
  const first = useRef(true);
  const seq = useRef(0);

  const territories = state.territories;
  const players = state.players;
  const me = state.me;

  useEffect(() => {
    const nameOf = (pid: string) => {
      if (pid === me) return 'Sen';
      return players.find((p) => p.player === pid)?.username ?? 'Oyuncu';
    };
    const fresh: AgeEvent[] = [];

    for (const t of territories) {
      const before = prevOwners.current.get(t.id);
      prevOwners.current.set(t.id, t.owner);
      if (first.current || before === undefined || before === t.owner || t.owner == null) continue;

      const what = t.kind === 'castle' ? 'kale' : 'kule';
      const color = colorMap[t.owner] ?? AGE.gray;
      seq.current += 1;

      if (t.owner === me) {
        // benim kazancım
        fresh.push({ id: seq.current, text: `${what === 'kale' ? 'Kale' : 'Kule'} senin!`, color, kind: before ? 'steal' : 'conquer' });
      } else if (before === me) {
        // benim kaybım — saldıranın rengiyle, uyarı tonunda
        fresh.push({ id: seq.current, text: `${nameOf(t.owner)} ${what}ni ele geçirdi!`, color, kind: 'steal' });
      } else if (before == null) {
        fresh.push({ id: seq.current, text: `${nameOf(t.owner)} boş bir ${what} fethetti`, color, kind: 'conquer' });
      } else {
        fresh.push({
          id: seq.current,
          text: `${nameOf(t.owner)}, ${possessive(nameOf(before))} ${what}sini aldı`,
          color,
          kind: 'steal',
        });
      }
    }

    for (const p of players) {
      if (!p.eliminated || seenElim.current.has(p.player)) continue;
      seenElim.current.add(p.player);
      if (first.current) continue;
      seq.current += 1;
      fresh.push({
        id: seq.current,
        text: p.player === me ? 'Elendin' : `${nameOf(p.player)} elendi`,
        color: colorMap[p.player] ?? AGE.gray,
        kind: 'out',
      });
    }

    first.current = false;
    if (fresh.length) setEvents((cur) => [...cur, ...fresh].slice(-MAX_VISIBLE));
  }, [territories, players, me, colorMap]);

  const dismiss = useCallback((id: number) => setEvents((cur) => cur.filter((e) => e.id !== id)), []);
  return { events, dismiss };
}

/** Olay çipleri — sağdan kayarak girer, ~2 sn durur, süzülerek kaybolur.
 *  pointerEvents yok → altındaki harita düğümleri tıklanabilir kalır. */
export function AgeTicker({ events, onDone }: { events: AgeEvent[]; onDone: (id: number) => void }) {
  if (!events.length) return null;
  return (
    <View pointerEvents="none" style={styles.wrap}>
      {events.map((e) => (
        <TickerChip key={e.id} event={e} onDone={onDone} />
      ))}
    </View>
  );
}

function TickerChip({ event, onDone }: { event: AgeEvent; onDone: (id: number) => void }) {
  const anim = useRef(new Animated.Value(0)).current;
  const p = palette(event.color);

  useEffect(() => {
    const seqAnim = Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 260, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true }),
      Animated.delay(2000),
      Animated.timing(anim, { toValue: 2, duration: 280, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]);
    seqAnim.start(({ finished }) => {
      if (finished) onDone(event.id);
    });
    return () => seqAnim.stop();
  }, [anim, event.id, onDone]);

  const translateX = anim.interpolate({ inputRange: [0, 1, 2], outputRange: [70, 0, 26] });
  const opacity = anim.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 1, 0] });

  const Icon = event.kind === 'out' ? AgeShield : event.kind === 'steal' ? AgeSiege : AgeFlag;

  return (
    <Animated.View
      style={[
        styles.chip,
        { borderColor: withAlpha(event.color, 0.6), transform: [{ translateX }], opacity },
      ]}>
      <View style={[styles.chipBar, { backgroundColor: event.color }]} />
      <Icon size={13} color={p.light} />
      <Text style={styles.chipText} numberOfLines={1}>
        {event.text}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: 4, bottom: 6, alignItems: 'flex-end', gap: 6, maxWidth: '92%' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 6, paddingLeft: 8, paddingRight: 12,
    borderRadius: 12, borderWidth: 1.5, backgroundColor: 'rgba(8,15,32,0.94)', overflow: 'hidden',
  },
  chipBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  chipText: { fontFamily: display, fontSize: 11.5, color: colors.text, flexShrink: 1 },
});
