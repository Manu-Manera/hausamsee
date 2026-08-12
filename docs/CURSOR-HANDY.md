# Cursor vom Handy – privates Haus-am-See-Repo

Damit du unterwegs am Projekt arbeiten kannst, muss Cursor dasselbe **private** GitHub-Repo sehen wie am Mac.

**Repo:** https://github.com/Manu-Manera/haus-am-see  
**Branch:** `main`

Vom Handy startest du **Cloud-Agents** (kein voller Code-Editor). Die Agents ändern Dateien, du prüfst den Diff und mergeest den Pull Request – alles auf dem Handy.

## 1. Einmalig am Mac / im Browser

1. Bei GitHub und Cursor mit dem **gleichen Account** (`Manu-Manera`) angemeldet sein.
2. GitHub mit Cursor verbinden: [Cursor Dashboard → Integrations → GitHub](https://cursor.com/dashboard?tab=integrations).
3. Die **Cursor GitHub App** installieren und explizit Zugriff auf **`haus-am-see`** geben (nicht nur öffentliche Repos).  
   Falls die App schon installiert ist: *Configure* → Repository `haus-am-see` ergänzen.
4. **Privacy Mode (Legacy) aus.** Cloud-Agents brauchen normalen Privacy Mode: [Cursor Dashboard → Settings](https://cursor.com/dashboard?tab=settings). Sonst siehst du das Repo, kannst aber keinen Branch wählen.

## 2. Auf dem Handy

### iPhone / iPad (iOS 26 / iPadOS 26)

1. App: [Cursor im App Store](https://apps.apple.com/app/cursor/id6767085653)
2. Mit deinem Cursor-Account anmelden.
3. Neuen Agent starten → Repository **`Manu-Manera/haus-am-see`** → Branch **`main`**.
4. Auftrag schreiben (z. B. «Festorga-Text auf der Website anpassen») und laufen lassen.
5. Diff prüfen, PR mergen oder am Mac weiterarbeiten.

### Android oder älteres iPhone

Keine native App nötig:

1. Im Handy-Browser öffnen: **https://cursor.com/agents**  
   (kannst du als PWA auf den Home-Bildschirm legen.)
2. Anmelden → gleiches Repo **`haus-am-see`** / Branch **`main`**.
3. Agent starten, Diff reviewen, mergen.

## 3. Mac eingeschaltet lassen (optional)

Wenn der Agent **deinen Mac** nutzen soll (Firebase-Deploy, lokale `.env`):

- Cursor Desktop ≥ 3.9.8, **Remote Control** unter Settings → Agents aktivieren.
- In einem Agent `/remote-control` ausführen, dann vom Handy weitermachen.
- Mac muss wach und online bleiben.

Für reine Website-/Code-Änderungen reicht ein **Cloud-Agent** – der Mac kann aus sein. Functions-Deploy mit Secrets geht zuverlässiger über Remote Control oder am Mac.

## 4. Website live schalten

Cloud-Agents pushen ins **private** Repo. Die öffentliche Seite (GitHub Pages) aktualisiert sich erst, wenn du (oder ein Agent am Mac) ausführst:

```bash
./scripts/publish-website.sh
```

Das pusht `main` zusätzlich nach `Manu-Manera/hausamsee`.

## Troubleshooting

| Problem | Lösung |
|---------|--------|
| Repo taucht in Cursor nicht auf | GitHub-App: Zugriff auf `haus-am-see` erlauben, Seite neu laden |
| Branch-Dropdown leer / disabled | Privacy Mode (Legacy) → auf Privacy Mode wechseln |
| Agent findet Firebase-Secrets nicht | `.env` liegt nur lokal; Deploy am Mac oder Remote Control |
| Website unverändert nach Merge | `./scripts/publish-website.sh` nicht vergessen |
