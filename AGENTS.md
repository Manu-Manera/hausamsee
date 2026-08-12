# Haus am See – Hinweise für Cursor (Desktop + Handy)

Privates WG-Projekt: Website, WhatsApp-Bot **Gustav**, Firebase, Garten-Bewässerung.

## Repos

| Remote | Repo | Sichtbarkeit | Zweck |
|--------|------|--------------|--------|
| `origin` | [Manu-Manera/haus-am-see](https://github.com/Manu-Manera/haus-am-see) | **privat** | Arbeitsrepo (Cursor Desktop + Handy) |
| `website` | [Manu-Manera/hausamsee](https://github.com/Manu-Manera/hausamsee) | öffentlich | GitHub Pages: https://manu-manera.github.io/hausamsee/ |

Nach Website-Änderungen (`index.html`, `app.js`, `styles.css`, …) zusätzlich veröffentlichen:

```bash
./scripts/publish-website.sh
```

Antworten an Manu immer auf **Deutsch**.

## Ordnerkarte

```
Haus am See/
├── index.html, app.js, styles.css   # öffentliche Website (Root = GitHub Pages)
├── firebase-config.js, firebase.json, firestore.rules, .firebaserc
├── functions/                       # Gustav + Cloud Functions (Node 20)
├── docs/                            # Dokumentation
├── shortcuts/                       # Siri + Android Kurzbefehle
├── scripts/                         # Build-Hilfen + Website-Publish
├── secrets/                         # nur Vorlagen – echte Keys nie committen
├── siri-kurzbefehle.html, voice-catalog.json
└── AGENTS.md, README.md
```

Details: [docs/ORDNERSTRUKTUR.md](docs/ORDNERSTRUKTUR.md) · Handy: [docs/CURSOR-HANDY.md](docs/CURSOR-HANDY.md)

## Wichtige Regeln

- **Keine Secrets committen:** `functions/.env`, `secrets/openai-key-fuer-copilot.txt`, API-Tokens.
- **Website-Dateien bleiben im Repo-Root** (`index.html`, `app.js`, `styles.css`) – GitHub Pages deployed von `/` auf `main`.
- Cache-Buster in `index.html` (`?v=…` bei CSS und `app.js`) nach Frontend-Änderungen erhöhen.
- Firebase-Projekt: `haus-am-see-d91ef`, Region `europe-west1`, Zeitzone `Europe/Zurich`.
- Functions deployen z. B. mit `npx firebase-tools deploy --only functions --project haus-am-see-d91ef`.

## Typische Einstiegspunkte

| Thema | Dateien |
|--------|---------|
| Website UI | `index.html`, `styles.css`, `app.js` |
| Gustav / WhatsApp | `functions/index.js`, `functions/llmRouter.js`, `functions/festorga.js` |
| Bewässerung / Gartenplan | `functions/index.js` (`runGartenPlanTick`, `checkBewaesserung`, `checkGartenRegenVorhersage`) |
| Festorga | `functions/festorga.js` + Intern-Tab in `index.html` / `app.js` |
| Firestore-Regeln | `firestore.rules` |
