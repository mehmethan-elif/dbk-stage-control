# DBK Stage Control

Local-first live-performance playback, setlist, and stage control.

Your two iPads run the **master** app (Xcode). Everyone else uses a **webpage** in Safari or Chrome — no APK, no TestFlight.

## Rehearsal on a Mac

```bash
npm install
npm run fixtures
npm test
npm run dev
```

- Master: http://127.0.0.1:5173/master
- Band page: http://127.0.0.1:5173/client (or `http://<your-mac-lan-ip>:5173/client`)

The Mac host on port 8787 serves the song library, practice files, and WebSocket sync.

## How band members get songs

Send them one public link. They do not need your Wi-Fi for this.

1. Add `Master.mp3` (or `.flac`) next to the stems in each `library/songs/<Song>/` folder.
2. On the Mac master: **Preparation → Publish band library**.
3. Push `main`. The Band page Action publishes the player plus charts, Master mix, settings, and setlists — never stems.
4. After the Action finishes, the player is:

   `https://mehmethan-elif.github.io/dbk-stage-control/client`
5. Send that link in WhatsApp.
6. They open it on their own Wi-Fi → Share → **Add to Home Screen**.

The first open downloads **DBK Stage Control** into the page. Later opens only fetch new or changed files. No zip.

The repo is public, so anyone with the link can get the Master mix and charts. Stems stay on your Mac/iPads.

## How you publish updates

1. Add or change songs on the Mac (charts, `song.json`, `settings.json`, `Master.mp3`).
2. Build the setlist you want the band to see.
3. **Publish band library** (or `npm run publish:library`).
4. Push `main`.
5. Band tablets open DBK — or tap **SONGS → Check for updates**.

## On stage

1. Master iPad: **This iPad is master**. Keep the app in the foreground.
2. Put every tablet on the same Wi-Fi or the master hotspot.
3. Band tablets: home-screen **DBK** → **SONGS** → **Join stage** (your iPad address).
4. Only playhead, selection, and setlist metadata go over LAN. They do not play backing stems.

## Master iPad app (you)

```bash
npm install
npm run ios
npm run ios:open
```

In Xcode, run on your master iPads. Copy the full `library` folder (with stems) into the app with Finder File Sharing so the master can play the show.

Band tablets do **not** install this Xcode app.

## Ports

- `5173` — Mac Vite page (rehearsal)
- `8787` — library, practice API, and show WebSocket
- `8788` — iPad master serves the band page + practice files
