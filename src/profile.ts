import { supabase } from './supabase';

// NOT: 'profiles' tablosu bir sonraki adımda kurulacak (TODO). Tablo henüz
// yokken bu yardımcılar hata fırlatmadan sessizce no-op kalır.

export type RemoteProfile = { name: string };

/** Oturum açık kullanıcının remote profilini getirir; yoksa/hata olursa null. */
export async function fetchProfile(): Promise<RemoteProfile | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return null;
    const { data: row, error } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', userId)
      .maybeSingle();
    if (error || !row?.name) return null;
    return { name: row.name };
  } catch {
    return null;
  }
}

/** Remote profil adını yazar/günceller; tablo yoksa sessizce geçer. */
export async function upsertProfile(name: string): Promise<void> {
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return;
    await supabase.from('profiles').upsert({ id: userId, name: name.trim() });
  } catch {
    // tablo henüz yok — sessiz geç
  }
}
