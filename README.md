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

## Standalone master iPad app

The native iPad app contains the existing master UI and reads the song library directly from its
Documents folder. After installation and copying the library, the master iPad can run a show with
no Mac and no internet connection.

### Build and install

Requirements:

- A Mac with Xcode
- An Apple ID configured in Xcode
- The iPad connected to the Mac

```bash
npm install
npm run build:ios
npm run ios:open
```

In Xcode:

1. Select the **App** project and its **App** target.
2. Under **Signing & Capabilities**, choose your development team.
3. Select the physical iPad as the run destination.
4. Press **Run** to install DBK Stage Control.

A free Apple ID can sign the app, but the installation normally expires after about seven days.
Install it again from Xcode when needed. A paid Apple Developer account provides longer-lived
signing.

### Copy the song library with Finder

The app exposes its Documents folder through Finder File Sharing:

1. Connect the iPad to the Mac.
2. Open Finder and select the iPad.
3. Open **Files**.
4. Select **DBK Stage Control**.
5. Copy the project’s complete `library` folder into the app.

The resulting iPad layout must be:

```text
Documents/
  library/
    songs/
      Biz/
        song.json
        settings.json
        nota.pdf
        ...audio stems...
      Another Song/
        ...
```

Each song folder may contain its packed `song.json`, optional `settings.json`, notation, lyrics, and
audio files. Shared song information—including play/start mode, key, tempo, duration, and page
notes—is stored in `song.json`. Legacy song information is migrated there automatically.
Score rectangles and mixer settings remain in `settings.json`.

To add or update songs later, copy the `library` folder again with Finder. Rebuilding the app is not
required for library-only changes.

### Use on stage

Open DBK Stage Control on the iPad and choose **This iPad is master**. The master UI, backing
tracks, click, lyrics, chords, drums, and scores work from the local Files library. Airplane mode is
fine when using only the master iPad.

Wi-Fi or the master iPad hotspot is needed only when other band tablets join the stage session.
Band tablets use the browser player and do **not** install the Xcode app.

## Ports

- `5173` — Mac Vite page (rehearsal)
- `8787` — library, practice API, and show WebSocket
- `8788` — iPad master serves the band page + practice files
