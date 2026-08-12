# functions/ – Gustav & Firebase Cloud Functions

Node 20, Firebase Projekt `haus-am-see-d91ef` (`europe-west1`).

## Dateien

| Datei | Rolle |
|--------|--------|
| `index.js` | WhatsApp-Webhook, Garten/Bewässerung, Scheduler, Festorga-Routing |
| `festorga.js` | Fest-Organisation (Templates, Erinnerungen, Budget) |
| `llmRouter.js` | natürliche Sprache → Gustav-Befehle |
| `tuya.js` / `meross.js` | Smart Plugs & Ventile |
| `deinTag.js` | persönliche Morgen-Zusammenfassung |
| `birthdays.js` | Geburtstags-Erinnerungen |
| `einkaufsliste.js` | Einkaufsliste |
| `chatHistory.js` | Gustav-Gesprächsverlauf |
| `calendarIcs.js` | ICS-Kalender für Aufgaben |
| `hausWiki.js` | Haus-Wiki / WLAN-QR |
| `blueriiot.js` | Jacuzzi Blue Connect |
| `gustavExtras.js` | Zusatz-Helfer |
| `bewaesserungAnnounce.js` | Bewässerungs-Ankündigungen |
| `tasksOverview.js` | Aufgaben-Überblick |
| `wifiQr.js` | WLAN-QR |
| `.env.example` | Vorlage für lokale Secrets |
| `scripts/` | Einmal-Skripte (z. B. WhatsApp-Announce) |

## Lokal

```bash
cp .env.example .env   # Werte eintragen, nie committen
cd .. && npx firebase-tools deploy --only functions --project haus-am-see-d91ef
```

`.env` und `node_modules/` sind gitignored.
