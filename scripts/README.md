# scripts/

| Skript | Zweck |
|--------|--------|
| `publish-website.sh` | `main` des privaten Repos → öffentliches GitHub-Pages-Repo `hausamsee` |
| `build-voice-shortcuts.js` | Kurzbefehle aus `voice-catalog.json` bauen |
| `voice-catalog.js` | Hilfen zum Sprachkatalog |

Website live nach einem Merge im privaten Repo:

```bash
./scripts/publish-website.sh
```
