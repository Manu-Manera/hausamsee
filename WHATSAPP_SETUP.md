# WhatsApp-Chatbot – Setup-Anleitung (Option A)

Diese Anleitung richtet den WhatsApp-Bot für "Haus am See" ein. Er kann:

1. **Events per WhatsApp anlegen** – Du schreibst z. B. `Neues Event: Sommerfest 15.8. 18 Uhr | Grillen am See` an die Bot-Nummer, er legt es automatisch im Kalender an.
2. **Kontaktformular-Nachrichten weiterleiten** – Jede neue Nachricht (und Bewerbung aufs Zimmer) landet markiert in der WG-WhatsApp.

## Kurz zu Signal

**Signal geht nicht offiziell.** Signal hat bewusst keine Business-API. Es gibt inoffizielle Tools (`signal-cli`), aber die laufen auf einem eigenen Server und sind instabil. Wenn Signal wichtig ist, wäre **Telegram** eine gute Alternative – da ist ein Bot in 5 Minuten aufgesetzt. Sag Bescheid wenn du umschwenken willst.

---

## Voraussetzungen (einmalig)

- Firebase-Plan auf **Blaze (Pay-as-you-go)** heben. Cloud Functions erfordern das, aber bei eurer Nutzung bleibt ihr praktisch bei 0 CHF (Gratis-Kontingent).
  Firebase Console → ⚙️ → **Nutzung und Abrechnung** → Plan ändern → Blaze.
- Auf deinem Mac `node --version` ≥ 20 und `firebase --version` installiert.

## Schritt 1 – Meta/WhatsApp-App erstellen (gratis)

1. Gehe zu https://developers.facebook.com und melde dich mit deinem Facebook-Account an.
2. **My Apps** → **Create App** → Typ **Business** → Name z. B. "Haus am See Bot".
3. In der App im linken Menü: **Add product** → **WhatsApp** → *Setup*.
4. Meta erstellt automatisch:
   - eine **Test-Telefonnummer** (gratis, Sandbox)
   - eine **App ID** und einen temporären Token (24 h)
   Das reicht zum Anfangen. Für Dauerbetrieb später: "System User Token" erstellen (permanent, kostenfrei).
5. Auf der Setup-Seite siehst du:
   - **Phone number ID** (z. B. `123456789012345`) → wird `WHATSAPP_PHONE_ID`
   - **Temporary access token** → wird `WHATSAPP_TOKEN`
6. Füge unter **To** deine eigene Handynummer (die der WG-Mitglieder) als **Empfänger** hinzu – in der Sandbox darfst du nur an verifizierte Nummern senden.

## Schritt 2 – Cloud Functions deployen

```bash
cd "/Users/manumanera/Haus am See/functions"
npm install
```

Dann Secrets als Environment-Variablen setzen (Firebase v2 nutzt `.env`-Dateien):

```bash
cp .env.example .env
```

`.env` öffnen und ausfüllen:

```
WHATSAPP_TOKEN=EAA...
WHATSAPP_PHONE_ID=123456789012345
WHATSAPP_VERIFY_TOKEN=hausamseegeheim2026
WHATSAPP_GROUP_RECIPIENTS=41791112233,41794445566,...
```

**Wichtig:**
- `WHATSAPP_VERIFY_TOKEN` wählst du frei – du brauchst denselben String in Schritt 3.
- `WHATSAPP_GROUP_RECIPIENTS` sind die Nummern, an die der Kontaktformular-Inhalt weitergeleitet wird – Format international **ohne +**: `41791112233`, keine Leerzeichen, mehrere mit Komma.

Deploy:

```bash
cd ..
firebase use haus-am-see-d91ef      # falls nicht schon aktiv
firebase deploy --only functions
```

Nach dem Deploy zeigt die Konsole zwei URLs – wichtig ist:

```
whatsappWebhook: https://europe-west1-haus-am-see-d91ef.cloudfunctions.net/whatsappWebhook
```

Diese URL kopieren.

## Schritt 3 – Webhook in Meta konfigurieren

1. In deiner Meta-App → **WhatsApp** → **Configuration** (manchmal "Webhooks").
2. **Callback URL** = die kopierte Function-URL.
3. **Verify Token** = genau derselbe String wie `WHATSAPP_VERIFY_TOKEN` in `.env`.
4. Auf **Verify and Save** klicken. Wenn alles stimmt: grüner Haken.
5. Dann **Webhook fields** → **messages** abonnieren.

## Schritt 4 – Testen

- Schick von deinem Handy (das in Meta als Empfänger hinterlegt ist) eine WhatsApp an die Meta-Test-Nummer:
  ```
  Neues Event: Sommerfest 15.8. 18 Uhr | Grillen am See
  ```
- Du solltest innert Sekunden eine Bestätigung zurück bekommen und das Event in `#events` auf der Website sehen.
- Gehe auf die Website, füll das Kontaktformular aus → alle WG-Nummern kriegen die Nachricht in WhatsApp.

## Schritt 5 (später, für Produktion) – Permanenter Token

Der Sandbox-Token läuft nach 24 h ab. Für Dauerbetrieb:

1. Meta Business Suite → **Settings** → **System Users** → neuer System User "hausamsee-bot".
2. Diesem User deine WhatsApp-App assignen (Permissions: `whatsapp_business_messaging`, `whatsapp_business_management`).
3. **Generate Token** → permanenter Token. In `.env` ersetzen und `firebase deploy --only functions`.

## Kosten

- Meta: die ersten **1'000 Service-Conversations / Monat sind gratis**. Für eine WG reicht das locker.
- Firebase Functions: im Gratis-Kontingent (2 Mio. Invocations/Monat) – kostet bei euch 0 CHF.

## Erweiterungen (später)

Im `functions/index.js` kannst du die NLP-Erkennung erweitern, z. B. `Putzplan-Update`, `Schaden: ...`, `Frage: ...`. Sag Bescheid wenn du was zusätzliches willst.

## Troubleshooting

- **"Verify token mismatch"** beim Webhook-Setup → `WHATSAPP_VERIFY_TOKEN` in `.env` ≠ dem in Meta. Beides identisch machen, neu deployen.
- **Bot antwortet nicht** → in Firebase Console → Functions → Logs gucken:
  ```bash
  firebase functions:log --only whatsappWebhook
  ```
- **WhatsApp send failed 401** → Token abgelaufen (Sandbox 24 h) oder falsch. Neu generieren.
- **WhatsApp send failed 131030** → Empfänger nicht verifiziert (Sandbox-Limit). In Meta-App die Nummer als Test-Empfänger zufügen.
