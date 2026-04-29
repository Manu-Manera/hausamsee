# 🏠 Haus am See – Änderungsprotokoll
## Session vom 28./29. April 2026

---

## 📋 Übersicht der Änderungen

Diese Session hat den WhatsApp-Bot "Gustav" massiv erweitert mit:
- **Mehrsprachigkeit** (Deutsch, Englisch, Französisch)
- **Neue Persönlichkeit** (frech, witzig, positiv)
- **Wetter-Integration** (aktuelles Wetter + Vorhersage)
- **Intelligente Bewässerung** (automatischer Stopp bei Regen)
- **Regen-Alert aktiviert** (Benachrichtigung vor Niederschlag)

---

## 1. 🌍 Mehrsprachige Bot-Unterstützung

### Was wurde geändert?
Der Bot erkennt jetzt automatisch die Sprache des Benutzers und antwortet in derselben Sprache.

### Unterstützte Sprachen:
| Sprache | Erkennungswörter | Beispiel-Antwort |
|---------|------------------|------------------|
| 🇩🇪 Deutsch | hallo, hi, hilfe, was geht | "Hey hey! 🦆 Was geht ab?" |
| 🇬🇧 Englisch | hello, help, what's up | "Yo! 👋 Gustav here!" |
| 🇫🇷 Französisch | salut, bonjour, aide | "Salut mon ami! 🦆" |

### Befehle in allen Sprachen:
| Deutsch | English | Français |
|---------|---------|----------|
| `Hilfe` | `Help` | `Aide` |
| `Events` | `Events` | `Événements` |
| `Schäden` | `Damages` | `Dommages` |
| `Wer ist da?` | `Who's home?` | `Qui est là?` |
| `Bin da/weg` | `I'm home/away` | `Je suis là/absent` |
| `Ja/Nein [Event]` | `Yes/No [Event]` | `Oui/Non [Event]` |
| `Pumpe an/aus` | `Pump on/off` | `Pompe on/off` |
| `Lichterkette an` | `Lights on` | `Lumières on` |
| `Wer putzt?` | `Who's cleaning?` | `Qui nettoie?` |
| `Giesse die Blumen` | `Water the plants` | `Arrose les plantes` |
| `Wetter` | `Weather` | `Météo` |
| `Schaden erledigt: X` | `Damage done: X` | `Dommage réparé: X` |

### Technische Umsetzung:
- **Datei:** `functions/llmRouter.js`
- Das LLM (OpenAI GPT-4.1) erkennt die Sprache automatisch
- Commands bleiben immer auf Deutsch (für das Backend)
- Antworten (`antwort`) werden in der User-Sprache generiert

---

## 2. 🦆 Gustav's neue Persönlichkeit

### Vorher:
- Sachlich, neutral, etwas steif
- Keine Emojis
- Standard-Antworten

### Nachher:
- **Frech und witzig** – macht Sprüche und Wortspiele
- **Positiv und hilfsbereit** – nie genervt
- **Emojis** – 2-4 pro Nachricht, nicht übertrieben
- **Maskottchen** – 🦆 Ente ("Quaaak!")
- **Website-Link** – bei Begrüssung und Hilfe immer dabei

### Beispiel-Antworten:
```
"Hey hey! 🦆 Was geht ab? Brauchst du was oder wolltest du nur mal Hallo sagen? 😎"

"🦆 Quaaak! Ich bin Gustav, euer Haus-Bot! Hier was ich so drauf hab..."

"Alter, klar mach ich das! 🔥"

"Boah, schon wieder Putzplan? 😅"
```

### Technische Umsetzung:
- **Datei:** `functions/llmRouter.js`
- `SYSTEM_PROMPT` komplett überarbeitet
- `temperature: 0.4` (vorher 0.25) für mehr Kreativität
- Persönlichkeits-Anweisungen im Prompt

---

## 3. 🌦️ Neuer Wetter-Befehl

### Funktion:
Der Bot kann jetzt das aktuelle Wetter + Vorhersage für das Haus am See abrufen.

### Befehle:
- `Wetter` / `Wie ist das Wetter?` / `Regnet es?`
- `Weather` / `What's the weather?` / `Is it raining?`
- `Météo` / `Quel temps?`

### Beispiel-Antwort:
```
☀️ *Wetter am Haus am See*

🌡️ 18°C (gefühlt 16°C)
💧 Luftfeuchtigkeit: 72%
💨 Wind: 12 km/h

*Aktuell:* Teilweise bewölkt

*Nächste Stunden:*
15:00 ⛅ 19°C
16:00 🌧️ 17°C (45% Regen)
17:00 🌧️ 16°C (60% Regen)
18:00 ⛅ 15°C
```

### Technische Umsetzung:
- **Datei:** `functions/index.js`
- Neue Funktionen:
  - `isWetterCommand(raw)` – erkennt Wetter-Befehle (DE/EN/FR)
  - `wmoToWeather(code)` – WMO-Code zu Emoji + Text
  - `fetchCurrentWeather()` – Open-Meteo API Abfrage
  - `formatWeatherText(data, lang)` – Formatierung in 3 Sprachen
- Koordinaten: `47.3656, 8.7808` (Pfäffikon am See)
- API: Open-Meteo (kostenlos, kein API-Key nötig)

### WMO Weather Codes:
| Code | Wetter | Emoji |
|------|--------|-------|
| 0 | Klar | ☀️ |
| 1-2 | Überwiegend klar | 🌤️ ⛅ |
| 3 | Bewölkt | ☁️ |
| 45-48 | Nebel | 🌫️ |
| 51-55 | Nieselregen | 🌧️ |
| 61-65 | Regen | 🌧️ |
| 71-77 | Schnee | 🌨️ |
| 80-82 | Schauer | 🌦️ |
| 95-99 | Gewitter | ⛈️ |

---

## 4. 🌧️ Regen-Alert aktiviert

### Problem:
Der Regen-Alert (Benachrichtigung ~30 Min vor Regen) war nicht aktiviert.

### Lösung:
In `functions/.env` hinzugefügt:
```env
GARTEN_RAIN_ALERT=1
```

### Wie es funktioniert:
1. **Scheduler** `checkGartenRegenPolster` läuft alle 10 Minuten
2. Prüft Open-Meteo Wetterdaten
3. Wenn Regen in 20-42 Minuten erwartet wird → Alert
4. Nachricht an alle `WHATSAPP_GROUP_RECIPIENTS`

### Alert-Nachricht:
```
🌧️ *Achtung Regen!*

In ca. 30 Minuten wird es nass – bitte Gartenpolster reinholen!

Erwarteter Niederschlag: 2.5mm
```

---

## 5. 💧 Intelligente Bewässerung (Regen-Stopp)

### Neues Feature:
Die Bewässerung wird **automatisch gestoppt** wenn es regnet!

### Wie es funktioniert:

#### A) Laufende Bewässerung bei Regen:
1. `checkBewaesserung` Scheduler läuft jede Minute
2. Neue Funktion `isCurrentlyRaining()` prüft aktuelles Wetter
3. Bei Regen/Niesel → alle Pumpen-Tasks werden gestoppt
4. Benutzer bekommt Nachricht:
```
🌧️ *Pumpe* automatisch gestoppt – es regnet! 🦆💧

Kein Grund zu giessen wenn der Himmel das übernimmt!
```

#### B) Warnung beim Start bei Regen:
Wenn jemand "Pumpe an" schreibt während es regnet:
```
💧 *Pumpe* läuft. Automatisch aus in *30 Min* (15:30 Uhr).

🌧️ *Achtung:* Es regnet gerade! Die Bewässerung wird automatisch gestoppt falls der Regen anhält.
```

### Erkannte Regen-Bedingungen:
- WMO Codes 51-67 (Niesel/Regen)
- WMO Codes 80-82 (Schauer)
- WMO Codes 95-99 (Gewitter)
- Niederschlag > 0.1mm

### Technische Umsetzung:
- **Datei:** `functions/index.js`
- Neue Funktion: `isCurrentlyRaining()`
- `checkBewaesserung` Scheduler erweitert mit Regen-Check
- Pumpen-Start erweitert mit Regen-Warnung

---

## 6. 📁 Geänderte Dateien

### `functions/llmRouter.js`
- Komplett überarbeiteter `SYSTEM_PROMPT`
- Mehrsprachigkeit (DE/EN/FR)
- Neue Persönlichkeit
- Wetter-Befehl im Befehlskatalog
- `temperature: 0.4` für mehr Kreativität
- Website-Link bei Hilfe/Begrüssung

### `functions/index.js`
- **Neue Funktionen:**
  - `isWetterCommand(raw)` – Wetter-Befehl erkennen
  - `wmoToWeather(code)` – WMO zu Emoji/Text
  - `fetchCurrentWeather()` – Wetter-API
  - `formatWeatherText(data, lang)` – Formatierung
  - `isCurrentlyRaining()` – Regen-Check
  - `detectLanguage(text)` – Spracherkennung (Fallback)
  - `getHelpText(lang)` – Hilfetext nach Sprache

- **Erweiterte Funktionen:**
  - `isListEventsCommand` – + EN/FR
  - `isSchadenListCommand` – + EN/FR
  - `isAnwesenheitListCommand` – + EN/FR
  - `isPutzListCommand` – + EN/FR
  - `isPumpListCommand` – + EN/FR
  - `parseAnwesenheit` – + EN/FR
  - `parseRSVPMessage` – + Oui/Non (FR)
  - `parseRSVPListCommand` – + EN/FR
  - `parseSchadenMessage` – + EN/FR
  - `parseSchadenErledigtMessage` – + EN/FR
  - `parseBewaesserungMessage` – + lights/pump/pompe
  - `parseGiessenUmgang` – + water plants/arrose
  - `checkBewaesserung` – + Regen-Check

### `functions/.env`
- Hinzugefügt: `GARTEN_RAIN_ALERT=1`

---

## 7. 🔧 Technische Details

### API-Endpunkte:
| Service | URL | Verwendung |
|---------|-----|------------|
| Open-Meteo | `api.open-meteo.com/v1/forecast` | Wetter |
| OpenAI | `api.openai.com/v1/chat/completions` | LLM |
| WhatsApp | `graph.facebook.com/v20.0` | Nachrichten |
| Tuya | Smart Life API | Steckdosen |

### Firebase Functions:
| Funktion | Trigger | Beschreibung |
|----------|---------|--------------|
| `whatsappWebhook` | HTTP | Eingehende Nachrichten |
| `checkBewaesserung` | every 1 min | Timer + Regen-Check |
| `checkGartenRegenPolster` | every 10 min | Regen-Alert |
| `checkReminders` | every 1 min | Erinnerungen |
| `dailyDigest` | Mo 8:00 | Wöchentliche Zusammenfassung |

### Koordinaten (Haus am See):
- **Latitude:** 47.3656
- **Longitude:** 8.7808
- **Timezone:** Europe/Zurich

---

## 8. 📱 Beispiel-Interaktionen

### Deutsch:
```
User: hallo
Gustav: Hey hey! 🦆 Was geht ab? Brauchst du was oder wolltest 
        du nur mal Hallo sagen? 😎
        
        Schau auch mal vorbei: https://manu-manera.github.io/hausamsee

User: wie ist das wetter?
Gustav: ☀️ *Wetter am Haus am See*
        
        🌡️ 18°C (gefühlt 16°C)
        💧 Luftfeuchtigkeit: 72%
        ...
```

### English:
```
User: help
Gustav: 🦆 Quaaack! I'm *Gustav*, your house bot! 
        Here's what I can do:
        
        📅 *Events:* Events | New event: Title Date
        🧹 *Cleaning:* Who's cleaning?
        ...
        
        🌐 https://manu-manera.github.io/hausamsee
```

### Français:
```
User: salut
Gustav: Salut mon ami! 🦆 Comment ça va? 
        Qu'est-ce que je peux faire pour toi? 😎
        
        Visite aussi: https://manu-manera.github.io/hausamsee
```

---

## 9. ✅ Zusammenfassung

| Feature | Status |
|---------|--------|
| Mehrsprachigkeit (DE/EN/FR) | ✅ Implementiert |
| Neue Persönlichkeit | ✅ Implementiert |
| Wetter-Befehl | ✅ Implementiert |
| Regen-Alert | ✅ Aktiviert |
| Bewässerung Regen-Stopp | ✅ Implementiert |
| Website-Link bei Hilfe | ✅ Implementiert |
| Emojis & Sprüche | ✅ Implementiert |

---

## 10. 🚀 Deployment

Alle Änderungen wurden deployed am **29. April 2026, ca. 00:00 Uhr**:

```bash
firebase deploy --only functions
```

**Function URL:** 
`https://whatsappwebhook-dcl7qtm3uq-ew.a.run.app`

---

*Dokumentation erstellt am 29. April 2026*
*Haus am See – WG Bot "Gustav" 🦆*
