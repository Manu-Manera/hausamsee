# 🔧 Technische Dokumentation

Detaillierte technische Dokumentation für Entwickler.

---

## 📡 API Endpoints

### Firebase Cloud Functions

| Function | Trigger | URL/Schedule |
|----------|---------|--------------|
| `whatsappWebhook` | HTTP POST/GET | `https://whatsappwebhook-xxx-ew.a.run.app` |
| `onNewNachricht` | Firestore onCreate | Trigger bei neuer Nachricht |
| `checkBewaesserung` | Schedule | Jede Minute |
| `checkReminders` | Schedule | Jede Minute |
| `checkGartenRegenPolster` | Schedule | Alle 10 Minuten |
| `dailyDigest` | Schedule | Montags 08:00 |

### WhatsApp Webhook

**GET** – Verifizierung:
```
GET /?hub.mode=subscribe&hub.challenge=xxx&hub.verify_token=xxx
```

**POST** – Eingehende Nachrichten:
```json
{
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "from": "41791234567",
          "type": "text",
          "text": { "body": "Hilfe" }
        }]
      }
    }]
  }]
}
```

---

## 🧠 LLM Integration (OpenAI)

### Request an OpenAI

```javascript
POST https://api.openai.com/v1/chat/completions
{
  "model": "gpt-4.1",
  "temperature": 0.4,
  "max_tokens": 2800,
  "response_format": { "type": "json_object" },
  "messages": [
    { "role": "system", "content": SYSTEM_PROMPT },
    { "role": "user", "content": "User-Nachricht" }
  ]
}
```

### Response-Format

```json
{
  "command": "Events",        // Deutscher Befehl oder null
  "antwort": null            // Antwort-Text oder null
}
```

### Prioritäten-Logik

1. `command` gesetzt → regelbasierte Verarbeitung
2. `command: null, antwort` gesetzt → direkte Antwort vom LLM
3. Beides `null` → Fallback auf regelbasierte Erkennung

---

## 🌦️ Wetter-Integration (Open-Meteo)

### Aktuelles Wetter

```javascript
GET https://api.open-meteo.com/v1/forecast
?latitude=47.3656
&longitude=8.7808
&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m
&hourly=temperature_2m,precipitation_probability,weather_code
&timezone=Europe/Zurich
&forecast_days=2
```

### WMO Weather Codes

| Code | Bedeutung |
|------|-----------|
| 0 | Klar |
| 1 | Überwiegend klar |
| 2 | Teilweise bewölkt |
| 3 | Bewölkt |
| 45-48 | Nebel |
| 51-55 | Nieselregen |
| 56-57 | Gefrierender Niesel |
| 61-65 | Regen |
| 66-67 | Gefrierender Regen |
| 71-77 | Schnee |
| 80-82 | Regenschauer |
| 85-86 | Schneeschauer |
| 95-99 | Gewitter |

---

## 🔌 Smart-Plug-Steuerung (Tuya)

### Authentifizierung

```
Signatur = HMAC-SHA256(
  accessId + accessToken + timestamp + nonce + stringToSign,
  accessSecret
)
```

### Geräte auflisten

```javascript
GET /v1.0/users/{uid}/devices
```

### Gerät schalten

```javascript
POST /v1.0/devices/{deviceId}/commands
{
  "commands": [
    { "code": "switch_1", "value": true }
  ]
}
```

### Switch-Codes

| Code | Gerät |
|------|-------|
| `switch_1` | Standard-Plug |
| `switch` | Ältere Plugs |
| `switch_2` | Multi-Outlet (2. Steckdose) |

---

## 📊 Firestore Schemas

### events

```typescript
interface Event {
  title: string;
  date: Timestamp;
  description?: string;
  createdBy: string;      // "whatsapp:41791234567" oder "web"
  source: string;         // "whatsapp" oder "website"
  createdAt: Timestamp;
}
```

### schaeden

```typescript
interface Schaden {
  titel: string;
  ort?: string;
  beschreibung?: string;
  prio: "low" | "medium" | "high";
  status: "offen" | "erledigt";
  fotoUrl?: string;
  meldePerson: string;
  createdAt: Timestamp;
  erledigtAt?: Timestamp;
}
```

### bewaesserung_tasks

```typescript
interface BewaesserungTask {
  device: string;         // "Pumpe"
  offAt: string;          // ISO timestamp
  requestedBy: string;    // WhatsApp-Nummer
  done: boolean;
  reason?: "rain" | "timer" | "manual";
  createdAt: Timestamp;
  cancelledAt?: Timestamp;
  offDoneAt?: Timestamp;
}
```

### erinnerungen

```typescript
interface Erinnerung {
  text: string;
  dueAt: Timestamp;
  recipient: string;      // WhatsApp-Nummer
  sent: boolean;
  createdAt: Timestamp;
  sentAt?: Timestamp;
}
```

### anwesenheit

```typescript
interface Anwesenheit {
  // Document ID = weekKey (z.B. "2026-W18")
  data: {
    [name: string]: "da" | "weg" | null;
  };
  updatedAt: Timestamp;
}
```

---

## 🔄 Scheduler-Jobs

### checkBewaesserung (jede Minute)

```
1. Regen-Check
   └─ Wenn Regen + aktive Pumpen-Tasks:
      └─ Alle Pumpen stoppen
      └─ Tasks als "done" markieren (reason: "rain")
      └─ Benutzer benachrichtigen

2. Timer-Check
   └─ Tasks mit offAt < now und done == false:
      └─ Pumpe ausschalten
      └─ Task als "done" markieren
      └─ Benutzer benachrichtigen

3. Wochenplan-Check (optional)
   └─ Geplante Bewässerung laut config/gartenPlan
```

### checkGartenRegenPolster (alle 10 Minuten)

```
1. Regen in 20-42 Minuten erwartet?
2. Wurde für diesen Slot schon gewarnt? (lastRainSlotUnix)
3. Wenn nein:
   └─ Alert an alle WHATSAPP_GROUP_RECIPIENTS
   └─ lastRainSlotUnix speichern
```

### dailyDigest (Montag 08:00)

```
1. Events der Woche laden
2. Putzplan der Woche laden
3. Anwesenheit laden
4. Offene Schäden laden
5. Formatierte Zusammenfassung an alle senden
```

---

## 🔐 Sicherheit

### Firestore Rules

Aktuell: Alle Operationen erlaubt (für WG-Nutzung akzeptabel).

Für Produktion empfohlen:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Nur lesend für Gäste
    match /events/{doc} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    // Nur für Bewohner
    match /schaeden/{doc} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### Umgebungsvariablen

**Niemals committen:**
- `.env`
- Tokens, API-Keys, Secrets

**In `.gitignore`:**
```
functions/.env
functions/.env.*
!functions/.env.example
```

---

## 🐞 Debugging

### Logs anzeigen

```bash
# Alle Logs
firebase functions:log

# Nur WhatsApp-Webhook
firebase functions:log --only whatsappWebhook

# Live-Stream
firebase functions:log --only whatsappWebhook -f
```

### Debug-Collection

Alle WhatsApp-Interaktionen werden in `whatsapp_debug` geloggt:

```javascript
{
  kind: "incoming" | "send_ok" | "send_failed" | "llm_response",
  at: Timestamp,
  // ... weitere Daten
}
```

### Lokales Testen

```bash
cd functions
npm run serve
# Startet Emulator auf localhost:5001
```

---

## 📈 Performance

### Optimierungen

1. **Token-Caching** (Tuya): Access-Token wird gecached (7200s)
2. **Wetter-Caching**: 15 Minuten TTL
3. **Parallel Requests**: `Promise.all()` für unabhängige Operationen
4. **Firestore Indexing**: Nur `done == false` Filter (kein Composite-Index nötig)

### Cold Start

Firebase Functions (2nd Gen) haben ~500ms Cold Start. Für schnellere Antworten:
- `minInstances: 1` setzen (kostet ~$6/Monat)

---

## 🔄 Backup & Recovery

### Firestore Export

```bash
gcloud firestore export gs://haus-am-see-backup
```

### Firestore Import

```bash
gcloud firestore import gs://haus-am-see-backup/2026-04-29
```

---

## 📚 Referenzen

- [Firebase Cloud Functions v2](https://firebase.google.com/docs/functions)
- [WhatsApp Business Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat)
- [Open-Meteo API](https://open-meteo.com/en/docs)
- [Tuya Open API](https://developer.tuya.com/en/docs/cloud/)

---

*Technische Dokumentation – Stand: April 2026*
