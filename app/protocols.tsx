import { ProtocolTreeScreen } from '@/online/ui';

/** Protokol ağacı route'u (/protocols). Tüm mantık ProtocolTreeScreen'de;
 *  durumlar Faz 2a sunucusundan (get_my_rank) türetilir. */
export default function ProtocolsRoute() {
  return <ProtocolTreeScreen />;
}
