# 🔐 Sicherheit – Haus am See

Dieses Dokument fasst die durchgeführten Härtungsmaßnahmen zusammen und listet
die **manuellen Schritte**, die nur du erledigen kannst (Secrets rotieren,
deployen, App Check aktivieren).

---

## 🚨 Sofort erledigen (kritisch)

### 1. Firestore-Regeln deployen
Die neuen, strengeren Regeln (`firestore.rules`) sind erst nach dem Deploy aktiv:

```bash
firebase deploy --only firestore:rules
```

Vorher testen (bricht nichts, prüft nur Syntax/Logik gegen den Emulator):
```bash
firebase emulators:start --only firestore
```

### 2. Alle Produktiv-Secrets rotieren
Der Siri-Schlüssel `HausAmSee2026Garten` liegt **im öffentlichen GitHub-Repo**
(`voice-catalog.json`, `scripts/voice-catalog.js`, `shortcuts/android/*.curl`).
Muss als kompromittiert gelten. Rotiere **alle** Secrets in `functions/.env`:

| Secret | Wo rotieren |
|--------|-------------|
| `SIRI_SECRET` | Neuen Zufallswert setzen (z. B. `openssl rand -hex 24`). Danach Kurzbefehle/Shortcuts neu generieren. |
| `WHATSAPP_TOKEN` | Meta → App → WhatsApp → neues Permanent Token |
| `OPENAI_API_KEY` | platform.openai.com → alten Key löschen, neuen erzeugen |
| `TUYA_ACCESS_SECRET` | iot.tuya.com → Cloud Project → Reset |
| `BLUERIIOT_PASSWORD` | Blue-Connect-App → Passwort ändern |
| WG-Login `hausamsee` | In der App (WG-Intern → Einstellungen) ein starkes Gruppenpasswort setzen |

Nach dem Rotieren neu deployen: `firebase deploy --only functions`.

### 3. WhatsApp App Secret setzen
Neue Env-Variable `WHATSAPP_APP_SECRET` (Meta → App → Einstellungen →
Grundlegendes → „App-Geheimnis"). Ohne diese Variable läuft der Bot zwar, aber
**ohne** Signaturprüfung – dann kann ein gefälschter POST den Bot auslösen.

```env
WHATSAPP_APP_SECRET=das_app_geheimnis_aus_meta
```

### 4. Firebase App Check aktivieren (wichtigster struktureller Schutz)
Die Website hat **kein echtes Server-Login** – das Passwort wird nur im Browser
geprüft. Firestore-Regeln können „Mitglied" deshalb nicht von „Angreifer"
unterscheiden. Der einzige robuste Schutz gegen anonyme Schreibzugriffe aus dem
Internet ist **App Check** (reCAPTCHA v3 für die Web-App):

1. Firebase Console → **App Check** → Web-App registrieren (reCAPTCHA v3).
2. Im Frontend App Check initialisieren (nach `initializeApp`).
3. In der Console **Enforcement** für Firestore aktivieren.

Danach werden Zugriffe ohne gültiges App-Check-Token abgelehnt – Skripte/curl
von Fremden kommen dann nicht mehr an die Datenbank.

---

## ✅ Bereits umgesetzt (im Code)

### Firestore-Regeln (`firestore.rules`)
- Standard ist jetzt **verweigern** (`match /{document=**} → if false`) statt alles offen.
- Nur-Server-Collections für Clients gesperrt: `whatsapp_debug`, `polls`,
  `erinnerungen`, `bewaesserung_tasks`, `gustavChatHistory`, `gustavCalendarLinks`,
  `gustavRemindPending`. (Cloud Functions greifen per Admin SDK zu und umgehen die Regeln.)
- `garten_commands` (Smart Home): nur **Anlegen** + eigenes Ergebnis lesen,
  kein Massen-Auslesen/Ändern/Löschen.
- Öffentliche Schreib-Collections (`gaestebuch`, `nachrichten`, `anmeldungen`)
  mit Feld-/Größen-Validierung gegen Spam & Daten-Bomben.
- Bild-/Audio-Felder auf ~4 MB begrenzt.

### WhatsApp-Webhook (`functions/index.js`)
- **Signaturprüfung** `X-Hub-Signature-256` (HMAC über Roh-Body mit
  `WHATSAPP_APP_SECRET`, zeitkonstanter Vergleich).
- **Absender-Whitelist**: nur bekannte WG-Nummern (aus `WHATSAPP_GROUP_RECIPIENTS`
  + Telefonbuch) lösen Gustav aus. Fremde Nummern werden verworfen.

### Siri- / Test-Endpunkte (`functions/index.js`)
- Schwaches Default-Secret `"hausamsee2026"` entfernt: Ohne gesetztes
  `SIRI_SECRET` sind die Endpunkte **deaktiviert**.
- Bypass behoben, bei dem Test-Endpunkte ohne gesetztes Secret durchliefen.
- Zeitkonstanter Secret-Vergleich; Secret kann jetzt per Header
  `x-siri-secret` gesendet werden (landet nicht in Logs/URL).

### Frontend gegen XSS (`app.js`)
- Emoji-Felder (Gästebuch, Events) werden escaped.
- Schaden-Foto-`src` und Gästebuch-Link-`href` laufen über neue `safeUrl()`,
  die nur `http(s):`, `mailto:`, `tel:` und Bild-/Audio-Data-URLs zulässt
  (blockt `javascript:`-Links).

---

## ✅ Server-Login (Passwort-Hashes versteckt) – umgesetzt & deployt

- Neue Cloud Function **`authApi`** (`functions/auth.js`) prüft Passwörter
  serverseitig und gibt ein kurzlebiges **Session-Token** aus. Aktionen:
  `login`, `guestLogin`, `changePassword`, `changeShared`, `setGroupDefault`,
  `clearPersonal`, `createGuest`, `deleteGuest`, `logout`.
- Frontend (`app.js`) prüft **keine Passwörter mehr im Browser**, sondern ruft
  `authApi` auf und speichert das Token in der Session.
- Firestore-Regeln: **`config/auth` und `config/memberPasswords` sind jetzt
  weder les- noch schreibbar** (nur die Function via Admin SDK). Gäste-Hashes
  liegen in `guestAuth` (gesperrt); `guests` enthält nur noch Namen.
  `config/authMeta` (nur Namen, wer ein persönliches Passwort hat) bleibt
  öffentlich lesbar für die UI.
- Rate-Limiting: 20 Fehlversuche pro 10 Min. (pro IP+Name) in `authThrottle`.
- Einmal-Migration gelaufen (Legacy-Gast-Hash verschoben, `authMeta` angelegt).
- Live getestet: Login (richtig/falsch), Token in Session, gesperrte Hash-Docs
  liefern `403`, privilegierte Aktionen ohne gültiges Token → abgewiesen.

**Hinweis:** Die SHA-256-Hashes sind weiterhin ungesalzen (Format beibehalten,
damit bestehende Passwörter gelten). Da sie jetzt nicht mehr öffentlich sind, ist
das unkritisch – ein starkes Gruppenpasswort statt `hausamsee` bleibt trotzdem
empfehlenswert.

## 🔭 Empfohlen (mittelfristig)

- **WLAN-Passwort** nicht im Klartext per WhatsApp/QR verschicken.
- **Rate Limiting** auf den Webhooks (z. B. pro Nummer/IP).
- **Repo privat** machen oder generierte Shortcut-Dateien mit Secret nicht
  committen (`.gitignore`).
- **Test-Endpunkte** (`testNachrichtAlert`, `fixPhoneNumbers`, `debugPhoneMap` …)
  nach dem Debugging entfernen oder per IAM auf privat stellen.
