@AGENTS.md

# Git Akışı

- PR'lar her zaman `development` branch'ine açılır, asla doğrudan `main`'e değil.
- Yeni iş: `development`'tan feature branch (`feat/...`, `fix/...`, `chore/...`) → commit → push → `gh pr create --base development` ile PR aç.
- `development` yoksa `main`'den oluştur.
- Conventional commits formatı kullan (`feat:`, `fix:`, `chore:`).
- `main`'e doğrudan commit/push YOK.
