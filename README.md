# Haus am See · Pfäffikon ZH

Die Website unserer WG direkt am Pfäffikersee. Einfache Single-Page mit warmem, gemütlichem Design.

## Features

- 🏡 Vorstellung Haus & Bewohner
- 📸 Foto-Galerie mit Lightbox
- 🎉 Events mit RSVP (Zu-/Absagen)
- 🛏️ Übernachtungs-Anfragen für Gäste
- 🧹 Interner WG-Kalender: Putzplan, Termine, Anwesenheit
- 💌 Gästebuch
- 📍 Kontakt & Karte

## Lokal entwickeln

```bash
cd "Haus am See"
python3 -m http.server 8080
# Dann: http://localhost:8080
```

## Hosting

Kostenlos via GitHub Pages – wird automatisch deployt beim Push auf `main`.

## Daten-Backend

Firebase Firestore (Gratis-Tier). Config liegt in `firebase-config.js`.
Ohne Firebase-Config funktioniert die Seite auch – Daten bleiben dann lokal im Browser.
