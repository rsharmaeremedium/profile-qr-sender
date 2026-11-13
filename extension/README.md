# Medxplain Profile ID Finder (browser extension)

A small Chrome/Edge extension that looks up Medxplain profile IDs from your
**logged-in admin session** and pushes them into the Profile QR Sender app.

It removes the manual "open admin → copy URL → paste ID" step.

## Install (Chrome or Edge)

1. Download this repository (or just the `extension` folder).
2. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `extension` folder.
5. Pin the extension to the toolbar.

The extension is unpacked, so it stays installed until you remove it or delete the
folder. Browser updates do not affect it.

## Use it

1. Log in to the Medxplain admin in a normal tab.
2. Open the QR app: <https://rsharmaeremedium.github.io/profile-qr-sender/>
   and add your email list.
3. Click the extension icon.
4. Click **Use emails from QR app** (optional — fills the email box from the app).
5. Click **Find IDs**. It searches the admin one email at a time.
6. Click **Push IDs to QR app**. The app rows switch to **Ready** with their profile IDs.
7. In the app, click **Download all PNGs (.zip)** or share individually.

You can also paste emails directly into the extension, or use **Copy email,id** /
**CSV** if you prefer the app's bulk paste.

### If it says "Login required"

The admin session expired. Log in in the admin tab, then click **Find IDs** again.

### If it does not find IDs

1. Reload the admin tab after installing or updating the extension. Chrome keeps
   old content scripts in tabs that were already open.
2. Make sure the admin tab is logged in and shows the Django admin, not the normal
   Medxplain login page.
3. Click **Diagnose**. The report shows the admin index status, the detected search
   URL, whether the search redirected to login, and how many result rows and
   profile links came back. That usually pinpoints the problem.
4. If the detected search URL looks wrong, click **Reset admin URL** and run
   **Diagnose** again. The extension rediscovers the user-profile model from the
   admin index.

### If a result says "Multiple matches"

The search returned more than one user. Click the correct **Use ID …** button in
the extension before pushing.

## How it works

The extension has a content script on `https://medxplain.eremedium.in/admin/*`.
When you click **Find IDs**, the popup asks that tab to run the admin's user-profile
changelist search:

```
/admin/userprofile/usersprofile/?q=<email>
```

On first use it reads `/admin/` and discovers the real user-profile model URL, then
caches it, so a different admin layout does not break the lookup. The request runs
inside the page, so it uses your existing login cookie. It reads the result table,
matches the row that contains the email, and extracts the numeric ID from the
profile change link.

The same popup also talks to the QR app. It injects a tiny helper into the app's
own JavaScript world with `chrome.scripting` (main world), reads the app's email
list, and writes profile IDs back. Existing rows are updated, and emails that are
not in the app yet are added, so **Push IDs to QR app** always leaves the app
ready. If no app tab is open, it opens the app with a one-time `#import=` link
instead.

Nothing is uploaded. No credentials are read or stored. The only stored data is the
last email list, results and delay setting, kept in `chrome.storage.local`.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Remember the last email list and results. |
| `tabs` | Find/open the admin tab and the QR app tab. |
| `scripting` | Run the admin search and the app handoff helper in the page. |
| `clipboardWrite` | **Copy email,id** button. |
| `https://medxplain.eremedium.in/*` | Search the admin inside your session. |
| `https://rsharmaeremedium.github.io/profile-qr-sender/*` | Read emails / write IDs in the app. |
| `http://localhost/*`, `http://127.0.0.1/*` | Same, when running the app locally. |

## Limits

- It needs an admin tab and a logged-in session. If the admin layout changes
  (different table or field names), parsing may need an update.
- Searches run one at a time with a delay (default 700 ms) to avoid hammering the
  server. Change the delay in the popup.
- It does not send WhatsApp messages; it only fills the IDs. Use the QR app to
  download or share the PNGs.
- Very long URLs can exceed QR capacity at Quartile; the app reports that row.
