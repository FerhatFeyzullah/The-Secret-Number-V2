-- Gizli admin paneli: kelime havuzundan (secret_words) PIN korumalı SİLME.
--
-- admin_add_word (20260706000001) ile birebir aynı güvenlik deseni: PIN telefonda
-- değil SUNUCUDA doğrulanır (app_config'teki bcrypt hash). Girilen kelime havuzda
-- varsa silinir; yoksa 'not_found' döner (yıkıcı yan etki yok).

create or replace function public.admin_remove_word(p_word text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  h text;
  w text := lower(trim(coalesce(p_word, '')));
  n int;
begin
  select value into h from public.app_config where key = 'admin_pin_hash';
  if h is null or crypt(coalesce(p_pin, ''), h) <> h then
    raise exception 'wrong_pin';
  end if;
  delete from public.secret_words where word = w;
  get diagnostics n = row_count;
  return jsonb_build_object('status', case when n > 0 then 'removed' else 'not_found' end);
end;
$$;

revoke execute on function public.admin_remove_word(text, text) from public;
grant execute on function public.admin_remove_word(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
