# Profile QR Sender (PWA)

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

## Why the admin lookup is assisted

The Medxplain admin is login-protected and on a different origin. A PWA cannot read
the HTML of another origin, so it cannot scrape the profile ID automatically.
Everything after the lookup — URL building, QR generation, naming, ZIP export,
sharing — happens locally.

A bookmarklet is included under **Admin helper** for one-click URL copying on the
admin list page after login.

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
```

## Limits

- Fully automatic admin scraping is not possible from a browser PWA.
- WhatsApp document delivery cannot be forced by a web app; the share sheet is the
  closest supported flow.
- Very long URLs can exceed QR capacity at Quartile; the app shows a QR error for
  that row.
- Data lives in `localStorage` on the device. Clearing site data clears the list.
