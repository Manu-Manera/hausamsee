# secrets/

Hier liegen **nur lokale Geheimnisse**, die nicht auf GitHub dürfen.

| Datei | Hinweis |
|--------|---------|
| `openai-key-fuer-copilot.txt` | lokal, gitignored – nie committen |
| `*.TEMPLATE.txt` | Vorlagen ohne echte Keys, dürfen ins Repo |

Cloud-Functions-Secrets stehen in `functions/.env` (ebenfalls gitignored). Vorlage: `functions/.env.example`.
