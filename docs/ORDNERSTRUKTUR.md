# Ordnerstruktur – Haus am See

Alles, was zum WG-Projekt gehört, liegt in **einem** privaten GitHub-Repo. Die öffentliche Website ist nur die Root-Dateien; Backend und interne Docs bleiben im gleichen Repo, sind aber privat.

```
Haus am See/
│
├── 🌐 Website (GitHub Pages, Root)
│   ├── index.html              Startseite + alle Sektionen
│   ├── app.js                  Frontend-Logik (Auth, Firestore, Festorga, Garten, …)
│   ├── styles.css              Design
│   ├── firebase-config.js      öffentliches Firebase-Web-Config (kein Secret)
│   ├── siri-kurzbefehle.html   Hilfeseite Siri-Kurzbefehle
│   ├── voice-catalog.json      Katalog für Sprach-/Kurzbefehle
│   └── .nojekyll               GitHub Pages: kein Jekyll
│
├── ☁️ Firebase
│   ├── firebase.json           Functions + Firestore-Rules
│   ├── firestore.rules         Sicherheitsregeln
│   └── .firebaserc             Projekt-ID haus-am-see-d91ef
│
├── 🦆 functions/               Gustav (WhatsApp) + Scheduler + Smart Home
│   ├── index.js                Webhook, Garten, Bewässerung, Erinnerungen
│   ├── festorga.js             Fest-Organisation
│   ├── llmRouter.js            natürliche Sprache → Befehle
│   ├── tuya.js / meross.js     Steckdosen / Ventile
│   ├── deinTag.js, birthdays.js, einkaufsliste.js, …
│   └── .env.example            Vorlage – echte .env nie committen
│
├── 📚 docs/
│   ├── README.md               Dokumentations-Index
│   ├── ORDNERSTRUKTUR.md       diese Datei
│   ├── CURSOR-HANDY.md         Cursor vom Handy (iOS / Web)
│   ├── TECHNICAL.md            APIs, Wetter, Tuya, …
│   └── …                       weitere Anleitungen
│
├── 📱 shortcuts/
│   ├── signed/                 fertige iOS-Kurzbefehle (.shortcut)
│   └── android/                curl-/Intent-Vorlagen
│
├── 🛠️ scripts/
│   ├── publish-website.sh      privaten Stand → öffentliches Pages-Repo
│   ├── build-voice-shortcuts.js
│   └── voice-catalog.js
│
├── 🔐 secrets/                 nur README + Vorlagen (echte Keys gitignored)
│
├── AGENTS.md                   Regeln für Cursor-Agents (Desktop + Handy)
└── README.md                   Projektüberblick
```

## Was öffentlich bleibt – und warum

Die **live Website** muss öffentlich sein (sonst können Gäste und Mitbewohner sie nicht öffnen). Deshalb gibt es zusätzlich das öffentliche Repo [hausamsee](https://github.com/Manu-Manera/hausamsee) nur für GitHub Pages.

Das **private** Repo `haus-am-see` ist die Quelle der Wahrheit: hier arbeitest du in Cursor (Mac + Handy).
