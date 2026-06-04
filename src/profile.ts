import { supabase } from './supabase';

export type RemoteProfile = { username: string };

async function currentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/** Oturum açık kullanıcının remote profilini getirir; oturum/satır yoksa null. */
export async function fetchProfile(): Promise<RemoteProfile | null> {
  if (!supabase) return null;
  const userId = await currentUserId();
  if (!userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return { username: data.username ?? '' };
}

/** Remote profil adını günceller; başarıda true döner.
 *  Satırı her zaman handle_new_user trigger'ı açar; RLS gereği istemci
 *  insert edemez, bu yüzden upsert değil kendi satırına UPDATE atılır. */
export async function upsertProfile(name: string): Promise<boolean> {
  if (!supabase) return false;
  const userId = await currentUserId();
  if (!userId) return false;
  const { error } = await supabase
    .from('profiles')
    .update({ username: name.trim() })
    .eq('id', userId);
  return !error;
}
