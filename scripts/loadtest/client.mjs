// Supabase client fabrikası. Her sanal oyuncu KENDİ anon client'ını (kendi auth
// oturumu) alır; service_role client tekildir (seed/cleanup için).
import { createClient } from '@supabase/supabase-js';

const commonAuth = {
  persistSession: false, // Node'da kalıcı depo yok; her koşu temiz başlar
  autoRefreshToken: false, // kısa ömürlü oturumlar; yenilemeye gerek yok
  detectSessionInUrl: false,
};

/** Yeni, izole bir anon client — bir sanal oyuncu = bir client = bir oturum. */
export function newPlayerClient(cfg) {
  return createClient(cfg.url, cfg.anonKey, {
    auth: commonAuth,
    // Realtime'ı gerçek istemci gibi kur; olay hızını makul tut.
    realtime: { params: { eventsPerSecond: 10 } },
  });
}

let _service = null;
/** service_role client (RLS bypass) — seed ve cleanup için. Tekil. */
export function serviceClient(cfg) {
  if (!_service) {
    _service = createClient(cfg.url, cfg.serviceRoleKey, { auth: commonAuth });
  }
  return _service;
}

/** Bir test hesabının deterministik e-postası (index → aynı e-posta). */
export function accountEmail(cfg, i) {
  const n = String(i).padStart(4, '0');
  return `${cfg.accountPrefix}${n}@${cfg.accountDomain}`;
}
