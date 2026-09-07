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

## How band members get the page (from home)

Send them one public link. They do not need your Wi-Fi for this.

1. Put this project on GitHub and push `main` (the **Band page** Action publishes the player only — no stems).
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. After the Action finishes, the player is:

   `https://mehmethan-elif.github.io/dbk-stage-control/client`
4. Send that link in WhatsApp.
5. They open it on their own Wi-Fi → Share → **Add to Home Screen**.
6. You send a practice zip (WhatsApp or iCloud). They open **DBK** → **Import zip**.

The public page is only the player. Songs stay in the zip. Stems never go online.

You can still use the LAN address at rehearsal if you want (`http://<mac-ip>:5173/client` or `http://<ipad-ip>:8788/client`).

## How you send songs (WhatsApp)

Master **Preparation** → **Export practice zip**. That zip is charts plus `Master.mp3` / `Master.flac` only. Stems stay on your iPad.

1. You export / zip the practice folder and send it on WhatsApp.
2. They download the zip on the tablet.
3. They open the **DBK** home-screen icon.
4. They tap **Import zip** and pick the WhatsApp file.
   Or they unzip it in Files first, then tap **Use this folder** and pick that folder.

The zip is only the songs. Opening the unzipped folder in Files does not start DBK. They open DBK, then point it at the zip or folder. After that the songs stay in the player.

Add `Master.mp3` (or `.flac`) next to the stems in each `library/songs/<Song>/` folder when you prep a song.

## On stage

1. Master iPad: **This iPad is master**. Keep the app in the foreground.
2. Put every tablet on the same Wi-Fi or the master hotspot.
3. Band tablets: home-screen **DBK** → **SONGS** → **Join stage** (your iPad address).
4. Only playhead, selection, and setlist metadata go over LAN. They do not play backing stems.

**Update from master** on LAN pulls missing practice files over Wi-Fi (still no stems).

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
