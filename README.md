# Profile QR Sender (PWA)

**Live app:** https://rsharmaeremedium.github.io/profile-qr-sender/

Turns a list of email IDs into Medxplain profile QR codes named `email+profileId.png`,
ready to download as a ZIP or share to WhatsApp as a document.

Runs 100% in the browser. Nothing is uploaded.

## What it does

1. Paste email IDs (or load a `.txt` / `.csv`). Duplicates are removed.
2. For each email, click **Search admin** to open
   `https://medxplain.eremedium.in/admin/userprofile/usersprofile/?q=<email>`.
3. Find the user, then paste either:
   - the numeric profile ID (`12345`),
   - the admin URL (`.../usersprofile/12345/change/`),
   - the profile URL (`https://medxplain.eremedium.in/medxplain/12345/`),
   - or a pasted file name (`user@example.com+12345.png`).
4. The app builds `https://medxplain.eremedium.in/medxplain/<id>/`, renders the QR
   locally, and names the file `<email>+<id>.png`.
5. Download a single PNG, **Download ZIP** for all ready rows, or **Share** to send
   the file through the system share sheet (WhatsApp appears on mobile).

Bulk helpers:

- **Bulk paste → Email + ID / URL** — one `email, id/url` per line.
- **Bulk paste → IDs / URLs in order** — paste a column of IDs and fill the
  currently visible rows in order.
- **Export CSV** — `email, profile_id, qr_url, filename, sent`.

## Automatic ID lookup

The admin is login-protected, so the lookup has to run inside your logged-in admin
tab. There are two ways to do that; both fill the app with `email → profile ID`
without hand-copying URLs.

### Bookmarklet (no install)

1. In this app, open **Admin helper (bookmarklet)** and drag **Fetch IDs from admin**
   to your bookmarks bar.
2. Add your emails in step 1 and click **Copy emails**.
3. Open <https://medxplain.eremedium.in/admin/> and log in.
4. Click the bookmarklet on any admin page. It searches the admin for every email,
   opens this app with the IDs filled in, and leaves an `email, id` list on your
   clipboard.
5. Review the rows, then download or share the QR codes.

If the clipboard is empty it asks you to paste the emails. If the admin session has
expired it stops and tells you to log in first.

### Browser extension

A companion Chrome/Edge extension in [`extension/`](extension/) does the same from a
popup and can push IDs into an already-open app tab.

1. Open `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**.
2. Click **Load unpacked** and select the `extension` folder.
3. Log in to the Medxplain admin in a normal tab.
4. Open this app and add the emails. The **Admin helper** now shows a
   **Fetch IDs now (extension)** button; click it and every row is filled.
   (The popup flow still works: extension icon → **Use emails from QR app** →
   **Find IDs** → **Push IDs to QR app**.)
5. The QR codes are ready. New emails are added automatically.

Both methods run the admin searches with your existing browser session. They do not
store or send credentials anywhere.

## QR settings

Defaults mirror [QR-EREMEDIUM](https://rsharmaeremedium.github.io/QR-EREMEDIUM/)
exactly:

| Setting | Value |
| --- | --- |
| Module shape | Square |
| Error correction | Quartile (Q, 25%) |
| Quiet zone | 2 modules |
| PNG export size | 500 × 500 |
| Foreground | `#000000` |
| Background | `#ffffff` |

The renderer uses the same integer-module + nearest-neighbour upscale technique as
the reference site, so the output is the same crisp geometry. The QR encodes the
profile URL only.

## Run it

Service workers and installation need `localhost` or HTTPS, so do not open
`index.html` with `file://`.

From this folder:

```powershell
python -m http.server 4173
```

Then open <http://localhost:4173/>.

To install: Chrome/Edge → address-bar install icon (or **Install app** in the
header). On Android, use **Add to Home screen**.

## Deploy

Upload the whole `qr-pwa` folder to any static host (GitHub Pages, Netlify,
Cloudflare Pages, an internal web server). No build step, no server code.

If you host it under a sub-path, keep the folder structure intact; the manifest
and service worker use relative URLs.

## WhatsApp notes

- **Android / iPhone:** tap **Share** → WhatsApp → contact. WhatsApp sends the PNG
  as a document/photo depending on the app version.
- **Desktop:** a web page cannot attach a file to WhatsApp directly. Download the
  PNG and attach it in WhatsApp with **+ → Document**. The share dialog also has
  **Download PNG** and **Open WhatsApp** helpers.
- The **Sent** checkbox is only a local progress marker; it does not confirm
  delivery.

## Why the lookup needs the admin tab

The Medxplain admin is login-protected and on a different origin. A PWA cannot read
the HTML of another origin, so it cannot scrape the profile ID by itself. The lookup
therefore runs in the admin tab — through the bookmarklet or the extension — using
your existing login. Everything after the lookup — URL building, QR generation,
naming, ZIP export, sharing — happens locally in this app.

## Files

```
qr-pwa/
  index.html              UI
  manifest.webmanifest    PWA manifest
  sw.js                   offline app-shell cache
  css/app.css             styles (light + dark)
  js/app.js               app logic
  js/zip.js               minimal store-mode ZIP writer
  vendor/qrcode.js        qrcode-generator (MIT)
  icons/                  PWA + favicon icons
  tools/make-icons.ps1    regenerates the icons
  extension/              Chrome/Edge ID lookup extension
```

## Limits

- A browser PWA cannot read the login-protected admin by itself; use the bookmarklet
  (**Admin helper**) or the companion extension to run the lookup in the admin tab.
- WhatsApp document delivery cannot be forced by a web app; the share sheet is the
  closest supported flow.
- Very long URLs can exceed QR capacity at Quartile; the app shows a QR error for
  that row.
- Data lives in `localStorage` on the device. Clearing site data clears the list.
