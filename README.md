# 🏠 Haus am See – WG-Portal mit WhatsApp-Bot

Eine vollständige WG-Management-Lösung mit:
- **Statische Website** (GitHub Pages) für Events, Galerie, Bewohner
- **WhatsApp-Bot "Gustav"** 🦆 mit KI (OpenAI) und Smart-Home-Steuerung
- **Firebase Backend** (Firestore + Cloud Functions)

---

## 📋 Inhaltsverzeichnis

1. [Features](#-features)
2. [Architektur](#-architektur)
3. [Voraussetzungen](#-voraussetzungen)
4. [Installation](#-installation)
5. [Konfiguration](#-konfiguration)
6. [Deployment](#-deployment)
7. [Firestore Struktur](#-firestore-struktur)
8. [Bot-Befehle](#-bot-befehle)
9. [Website anpassen](#-website-anpassen)
10. [Erweiterung](#-erweiterung)
11. [Troubleshooting](#-troubleshooting)
12. [Kosten](#-kosten)

---

## ✨ Features

### Website (Frontend)
- 🏠 **Hero mit Wetter-Widget** (Open-Meteo API)
- 👥 **Bewohner-Übersicht** mit Profilbildern
- 📸 **Galerie** mit Lightbox
- 🎵 **Soundtrack-Player** (YouTube, Spotify, SoundCloud)
- 📅 **Events & Kalender** mit RSVP
- 🔧 **Schäden-Tracker**
- 📖 **Gästebuch**
- 🚪 **"Zimmer frei"-Anzeige** mit Social Sharing
- 🔐 **Login-System** (Bewohner-Dropdown)

### WhatsApp-Bot "Gustav" 🦆
- 🌍 **Mehrsprachig** (Deutsch, Englisch, Französisch)
- 🤖 **KI-gestützt** (OpenAI GPT-4) – versteht natürliche Sprache
- 😎 **Persönlichkeit** – frech, witzig, positiv
- 📅 Events anlegen/löschen/auflisten
- 🧹 Putzplan verwalten
- 🏠 Anwesenheit tracken
- 🔧 Schäden melden & erledigen
- 📸 Fotos hochladen (Galerie, Events, Bewerber)
- ⏰ Erinnerungen setzen
- 🌦️ **Wetter abfragen** (aktuell + Vorhersage)
- 💡 **Smart Home** (Lichterkette, Pumpe via Tuya)
- 💧 **Intelligente Bewässerung** (stoppt bei Regen!)
- 🌧️ **Regen-Alert** (~30 min vor Niederschlag)

---

## 🏗️ Architektur

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   GitHub Pages  │     │  WhatsApp User  │     │   Smart Life    │
│   (index.html)  │     │   (Handy-App)   │     │   (Tuya Cloud)  │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │ HTTPS                 │ Webhook               │ API
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Firebase (Google Cloud)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  Firestore   │  │   Functions  │  │  Scheduled Jobs      │   │
│  │  (Datenbank) │◄─┤  (Node.js)   │◄─┤  • checkBewaesserung │   │
│  │              │  │              │  │  • checkReminders    │   │
│  │  • events    │  │  • Webhook   │  │  • dailyDigest       │   │
│  │  • schaeden  │  │  • LLM-Route │  │  • regenAlert        │   │
│  │  • galerie   │  │  • Tuya API  │  │                      │   │
│  │  • ...       │  │  • Open-Meteo│  │                      │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ API
                              ▼
                    ┌─────────────────┐
                    │   OpenAI API    │
                    │   (GPT-4.1)     │
                    └─────────────────┘
```

### Dateien-Struktur

```
Haus am See/
├── index.html           # Website (Single Page App)
├── app.js               # Frontend JavaScript
├── styles.css           # Styling
├── firebase.json        # Firebase Konfiguration
├── firestore.rules      # Sicherheitsregeln
├── .firebaserc          # Projekt-ID
│
└── functions/           # Backend (Cloud Functions)
    ├── index.js         # Hauptlogik (Bot, Scheduler, Webhooks)
    ├── llmRouter.js     # OpenAI Integration (Gustav's Gehirn)
    ├── tuya.js          # Smart-Plug-Steuerung (Tuya/Smart Life)
    ├── meross.js        # Alternative: Meross/Refoss Plugs
    ├── package.json     # Node.js Dependencies
    ├── .env             # Secrets (NICHT committen!)
    └── .env.example     # Vorlage für Secrets
```

---

## 📦 Voraussetzungen

### Accounts (alle kostenlos)
1. **Firebase** (Google) – https://console.firebase.google.com
2. **Meta for Developers** – https://developers.facebook.com
3. **OpenAI** (optional) – https://platform.openai.com
4. **Tuya IoT** (optional) – https://iot.tuya.com
5. **GitHub** – für Website-Hosting

### Software
- **Node.js 20+** – `node --version`
- **Firebase CLI** – `npm install -g firebase-tools`
- **Git** – für Deployment

---

## 🚀 Installation

### 1. Repository klonen

```bash
git clone https://github.com/manu-manera/hausamsee.git
cd "Haus am See"
```

### 2. Firebase Projekt erstellen

1. https://console.firebase.google.com → **Projekt hinzufügen**
2. Name: z.B. "haus-am-see"
3. **Firestore Database** aktivieren:
   - Firestore Database → Create → **Testmodus** → Region: `europe-west6` (Zürich)
4. **Plan auf Blaze** upgraden (Pay-as-you-go, aber praktisch kostenlos):
   - Einstellungen → Nutzung und Abrechnung → Plan ändern → Blaze

### 3. Firebase CLI einloggen

```bash
firebase login
firebase use --add
# Projekt auswählen → Alias: "default"
```

### 4. Dependencies installieren

```bash
cd functions
npm install
cd ..
```

### 5. Secrets konfigurieren

```bash
cd functions
cp .env.example .env
```

`.env` bearbeiten (siehe [Konfiguration](#-konfiguration)).

### 6. Firestore-Regeln deployen

```bash
firebase deploy --only firestore:rules
```

### 7. Functions deployen

```bash
firebase deploy --only functions
```

Nach dem Deploy erscheint die Webhook-URL:
```
whatsappWebhook: https://whatsappwebhook-xxx-ew.a.run.app
```

---

## ⚙️ Konfiguration

### `.env` Datei (functions/.env)

```env
# ===================================================================
# WhatsApp Business API (Meta)
# ===================================================================
WHATSAPP_TOKEN=EAA...                    # Access Token aus Meta
WHATSAPP_PHONE_ID=123456789012345        # Phone Number ID
WHATSAPP_VERIFY_TOKEN=meinGeheimesToken  # Selbst gewählt, für Webhook
WHATSAPP_GROUP_RECIPIENTS=41791234567,41799876543  # Empfänger (ohne +)

# ===================================================================
# Smart Plugs (optional)
# ===================================================================
PLUG_PROVIDER=tuya                       # tuya oder meross

# Tuya (Smart Life App)
TUYA_ACCESS_ID=abc123                    # Aus iot.tuya.com
TUYA_ACCESS_SECRET=xyz789                # Aus iot.tuya.com
TUYA_UID=eu1234567890                    # User-ID
TUYA_REGION=eu                           # eu, us, cn, in

# ===================================================================
# OpenAI (optional, für KI-Features)
# ===================================================================
OPENAI_API_KEY=sk-proj-...               # API Key von openai.com
OPENAI_MODEL=gpt-4.1                     # Optional, Default: gpt-4.1

# ===================================================================
# Regen-Alert (optional)
# ===================================================================
GARTEN_RAIN_ALERT=1                      # 1 = aktiviert
```

### WhatsApp einrichten (Meta)

1. https://developers.facebook.com → **My Apps** → **Create App**
2. Typ: **Business** → Name: "Haus am See Bot"
3. **WhatsApp** hinzufügen → Setup
4. Notieren:
   - **Phone number ID** → `WHATSAPP_PHONE_ID`
   - **Access Token** → `WHATSAPP_TOKEN`
5. **Webhook konfigurieren**:
   - Callback URL: `https://whatsappwebhook-xxx-ew.a.run.app` (aus Deploy)
   - Verify Token: gleicher Wert wie `WHATSAPP_VERIFY_TOKEN`
   - Webhook fields: **messages** abonnieren
6. **Testnummern** hinzufügen (Sandbox erlaubt nur verifizierte Nummern)

### Tuya einrichten (Smart Life)

1. https://iot.tuya.com → Account erstellen (kostenlos)
2. **Cloud** → **Development** → **Create Cloud Project**
   - Region: Central Europe Data Center
3. Im Projekt:
   - **Service API** → "IoT Core" + "Authorization Token Management" aktivieren
   - **Devices** → **Link Tuya App Account** → QR-Code mit Smart Life App scannen
4. Werte in `.env` eintragen

### OpenAI einrichten

1. https://platform.openai.com → Account erstellen
2. **API Keys** → **Create new secret key**
3. Key in `.env` als `OPENAI_API_KEY` eintragen
4. Guthaben aufladen (Pay-as-you-go, ~$5 reicht für Monate)

---

## 📤 Deployment

### Backend (Firebase Functions)

```bash
firebase deploy --only functions
```

### Website (GitHub Pages)

1. Repository auf GitHub erstellen
2. `index.html`, `app.js`, `styles.css` pushen
3. **Settings** → **Pages** → Source: `main` Branch → Save
4. URL: `https://username.github.io/repository-name`

### Website-Konfiguration (app.js)

In `app.js` die Firebase-Konfiguration anpassen:

```javascript
const FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "haus-am-see.firebaseapp.com",
  projectId: "haus-am-see",
  storageBucket: "haus-am-see.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

Diese Werte findest du in Firebase Console → Projekteinstellungen → Web-App.

---

## 🗄️ Firestore Struktur

| Collection | Beschreibung | Wichtige Felder |
|------------|--------------|-----------------|
| `events` | Veranstaltungen | `title`, `date`, `description`, `createdBy` |
| `anmeldungen` | RSVPs zu Events | `eventId`, `name`, `createdAt` |
| `putzplan` | Putzaufgaben | `who`, `when`, `task`, `done` |
| `anwesenheit` | Wochenend-Status | `weekKey`, `data: {Name: "da"/"weg"}` |
| `schaeden` | Schadensmeldungen | `titel`, `ort`, `prio`, `status`, `fotoUrl` |
| `galerie` | Foto-Uploads | `url`, `caption`, `uploadedAt` |
| `gaestebuch` | Einträge | `text`, `name`, `createdAt` |
| `musik` | Soundtrack | `url`, `kind` (youtube/spotify/soundcloud) |
| `kandidaten` | Zimmer-Bewerber | `name`, `alter`, `info`, `tel` |
| `erinnerungen` | Timer | `text`, `dueAt`, `recipient`, `sent` |
| `bewaesserung_tasks` | Pumpen-Timer | `device`, `offAt`, `done`, `reason` |
| `config` | Einstellungen | `roomOffer`, `gartenPolsterRainAlert` |
| `nachrichten` | Kontaktformular | `name`, `email`, `text` |
| `whatsapp_debug` | Debug-Logs | `kind`, `data`, `at` |

---

## 🤖 Bot-Befehle

### Deutsch / English / Français

| Funktion | DE | EN | FR |
|----------|----|----|-----|
| **Hilfe** | Hilfe | Help | Aide |
| **Events** | Events | Events | Événements |
| **Neues Event** | Neues Event: Titel 15.8. 18h | New event: Title 15.8. 6pm | Nouvel événement: Titre 15.8. 18h |
| **Event löschen** | Event löschen: Titel | Delete event: Title | Supprimer événement: Titre |
| **Putzplan** | Wer putzt? | Who's cleaning? | Qui nettoie? |
| **Putz eintragen** | Putz: Name 20.4. Küche | Cleaning: Name 20.4. Kitchen | Ménage: Nom 20.4. Cuisine |
| **Anwesenheit** | Wer ist da? | Who's home? | Qui est là? |
| **Da sein** | Bin da | I'm here | Je suis là |
| **Weg sein** | Bin weg | I'm away | Je suis absent |
| **Schäden** | Schäden | Damages | Dommages |
| **Schaden melden** | Schaden: Was \| Wo \| hoch | Damage: What \| Where \| high | Dommage: Quoi \| Où \| élevé |
| **Schaden erledigt** | Schaden erledigt: Titel | Damage done: Title | Dommage réparé: Titre |
| **RSVP Ja** | Ja Eventname | Yes Eventname | Oui Événement |
| **RSVP Nein** | Nein Eventname | No Eventname | Non Événement |
| **Wetter** | Wetter | Weather | Météo |
| **Pumpe an** | Pumpe an / 20 min | Pump on / 20 min | Pompe on / 20 min |
| **Pumpe aus** | Pumpe aus | Pump off | Pompe off |
| **Licht an** | Lichterkette an | Lights on | Lumières on |
| **Licht aus** | Lichterkette aus | Lights off | Lumières off |
| **Gästebuch** | Gästebuch: Text | Guestbook: Text | Livre d'or: Texte |
| **Erinnerung** | Erinner mich 30.4. 8h an: Text | Remind me 30.4. 8am: Text | Rappelle-moi 30.4. 8h: Texte |

### Smart Home Features

- **Automatischer Timer**: Pumpe schaltet nach X Minuten aus (Default: 30)
- **Regen-Stopp**: Bewässerung wird bei Regen automatisch gestoppt
- **Regen-Alert**: ~30 Min vor Niederschlag kommt eine Warnung
- **Kein Timer für Licht**: Lichterkette bleibt an bis manuell aus

---

## 🎨 Website anpassen

### Bewohner ändern (index.js)

In `functions/index.js`:
```javascript
const BEWOHNER = ["Corina", "Jasmin", "Dino", "Andy", "Manu", "Hugues", "Fanny", "Elliot", "Oscar"];
const KIDS = new Set(["Elliot", "Oscar"]);
```

### Koordinaten (Wetter)

In `functions/index.js`:
```javascript
const WEATHER_LAT = 47.3656;  // Breitengrad
const WEATHER_LON = 8.7808;   // Längengrad
```

### Website-URL

In `functions/index.js` und `functions/llmRouter.js`:
```javascript
const WEBSITE_URL = "https://manu-manera.github.io/hausamsee";
```

### Bot-Persönlichkeit

In `functions/llmRouter.js` den `SYSTEM_PROMPT` anpassen:
```javascript
const SYSTEM_PROMPT = `Du bist *Gustav* 🦆, der leicht verrueckte aber liebenswerte WhatsApp-Bot...`;
```

---

## 🔧 Erweiterung

### Neuen Bot-Befehl hinzufügen

1. **Parser-Funktion** in `functions/index.js`:
```javascript
function parseNeuerBefehl(raw) {
  const m = String(raw).match(/^neuer befehl:\s*(.+)$/i);
  return m ? { data: m[1].trim() } : null;
}
```

2. **In `dispatch()` einbauen**:
```javascript
const neuerBefehl = parseNeuerBefehl(rawInput);
if (neuerBefehl) {
  // Aktion ausführen
  await reply(`✅ Befehl ausgeführt: ${neuerBefehl.data}`);
  return true;
}
```

3. **LLM-Prompt erweitern** in `functions/llmRouter.js`:
```javascript
// Im Befehlskatalog hinzufügen:
- *Neuer Befehl: Text*
```

### Neue Firestore Collection

1. In `firestore.rules` hinzufügen:
```
match /neueCollection/{document=**} {
  allow read, write: if true;
}
```

2. Deploy: `firebase deploy --only firestore:rules`

---

## 🐛 Troubleshooting

### Bot antwortet nicht

```bash
# Logs prüfen
firebase functions:log --only whatsappWebhook
```

### "Verify token mismatch"

`WHATSAPP_VERIFY_TOKEN` in `.env` ≠ Meta-Webhook-Config. Beide angleichen, neu deployen.

### WhatsApp send failed 401

Token abgelaufen (Sandbox: 24h). Neuen Token generieren.

### WhatsApp send failed 131030

Empfänger nicht in Sandbox verifiziert. In Meta-App als Testnummer hinzufügen.

### Smart Plug reagiert nicht

1. Plug im gleichen WLAN?
2. In Smart Life App erreichbar?
3. `TUYA_UID` korrekt? (User-ID, nicht Device-ID)

### OpenAI Fehler

```bash
# API-Key prüfen
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

---

## 💰 Kosten

| Service | Kosten |
|---------|--------|
| **Firebase** | Gratis (Blaze Free Tier: 2M Invocations/Monat) |
| **WhatsApp** | Gratis (1000 Service-Conversations/Monat) |
| **OpenAI** | ~$0.002 pro Nachricht (GPT-4.1) |
| **GitHub Pages** | Gratis |
| **Tuya IoT** | Gratis |

**Typische Monatskosten für eine WG: $0 – $2**

---

## 📄 Lizenz

MIT License – frei zur Nutzung und Anpassung.

---

## 🙏 Credits

- **Open-Meteo** – Kostenlose Wetter-API
- **Firebase** – Backend-as-a-Service
- **Meta WhatsApp Business API** – Bot-Plattform
- **OpenAI** – GPT-4 für natürliche Sprache
- **Tuya** – Smart-Home-API

---

*Erstellt mit ❤️ für das Haus am See 🏠*
