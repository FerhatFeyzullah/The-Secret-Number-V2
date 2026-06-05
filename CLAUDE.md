@AGENTS.md

# Git Akışı

## Önce uygula, onaydan sonra commit

- Bir görevde kod değişikliklerini yap ama commit ETME, branch açma, push etme, PR açma — değişiklikleri çalışma alanında bırak.
- İş bitince sadece kısa özet + değişen dosya listesi ver ve "test edip onayını bekliyorum" de.
- Yalnızca kullanıcı açıkça "commit'le" / "commit + PR" dediğinde: uygun bir feature branch (`feat/...`) aç, anlamlı commit(ler), push, `gh pr create --base development` ile PR aç.
- Kullanıcı "geri al" derse: commit'lenmemiş değişiklikleri geri al (`git restore` / `git checkout`), temiz duruma dön.

## Branch ve PR kuralları

- PR tabanı her zaman `development`, asla doğrudan `main` değil.
- Feature branch'ler `development`'tan açılır (`feat/...`, `fix/...`, `chore/...`).
- `development` yoksa `main`'den oluştur.
- Conventional commits formatı kullan (`feat:`, `fix:`, `chore:`).
- `main`'e doğrudan commit/push YOK.
