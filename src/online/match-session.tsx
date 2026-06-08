import { usePathname } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

import { leaveMatch } from './matchService';

/** Aktif maçın "kim sahibi" olduğu: lobi (arama/VS, /online) ya da maç ekranı
 *  (belirleme/seçim/düello). Merkezi izleyici hangi route'larda maçın canlı
 *  kalmasının MEŞRU olduğunu buna göre belirler. */
type Owner = 'lobby' | 'match';

type MatchSessionApi = {
  /** Canlı maçı sahiplen (lobi eşleşince 'lobby'; maç ekranı mount'ta 'match'). */
  claim: (matchId: string, owner: Owner) => void;
  /** Yereldeki sahipliği bırak — leave ÇAĞIRMADAN (maç bitti/iptal oldu, ya da
   *  zaten ayrıldık). */
  release: () => void;
  /** Maçı sunucuda kapat + yerel sahipliği bırak (idempotent, yarışsız). */
  leave: () => void;
};

const Ctx = createContext<MatchSessionApi | null>(null);

/** Bir route'un "maç ekranı" olup olmadığı (intra-maç geçişlerinde yanlış leave
 *  olmaması için /match/[id] prefix'i dahil). */
function isMatchRoute(path: string): boolean {
  return path === '/match-setup' || path === '/protocol-select' || path.startsWith('/match/');
}

/** TEK merkezi "aktif maç sahibi". Dağınık per-ekran beforeRemove/unmount leave
 *  net'leri yerine: maç ekranları/lobi maçı claim eder; route maç kümesinin
 *  (lobi için /online + maç route'ları; maç için yalnız maç route'ları) DIŞINA
 *  çıkınca tek bir leave_match tetiklenir. Geri/swipe/programatik/açılış-başka-
 *  yere'yi tek mantıkla yakalar. (Çökme/kill → Katman 2 sunucu heartbeat-reap.) */
export function MatchSessionProvider({ children }: { children: ReactNode }) {
  const idRef = useRef<string | null>(null);
  const ownerRef = useRef<Owner>('match');
  const leavingRef = useRef(false);
  const pathname = usePathname();

  const claim = useCallback((matchId: string, owner: Owner) => {
    idRef.current = matchId;
    ownerRef.current = owner;
    leavingRef.current = false;
  }, []);

  const release = useCallback(() => {
    idRef.current = null;
    leavingRef.current = false;
  }, []);

  const leave = useCallback(() => {
    const id = idRef.current;
    if (!id || leavingRef.current) return; // idempotent / yarışsız
    leavingRef.current = true;
    idRef.current = null;
    void leaveMatch(id).catch(() => {});
  }, []);

  // Merkezi izleyici: aktif maç varken route, sahibinin MEŞRU kümesi dışına
  // çıktıysa maçı kapat. Intra-maç geçişleri (protocol-select→setup→duel, tur
  // arası) küme içi kaldığı için TETİKLENMEZ. Lobi maçı /online + maç
  // route'larında meşru; maç-sahibi maçı yalnız maç route'larında meşru.
  useEffect(() => {
    if (!idRef.current) return;
    const onMatch = isMatchRoute(pathname);
    const allowed = ownerRef.current === 'lobby' ? pathname === '/online' || onMatch : onMatch;
    if (!allowed) leave();
  }, [pathname, leave]);

  // Sabit kimlik (pathname değişince provider yeniden render olsa da tüketici
  // effect'leri gereksiz tetiklenmesin).
  const api = useMemo(() => ({ claim, release, leave }), [claim, release, leave]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useMatchSession(): MatchSessionApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMatchSession must be used within MatchSessionProvider');
  return v;
}
