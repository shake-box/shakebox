# Shakebox 🎱

A magic 8-ball for your family's own toys. Shake the device (or tap the ball),
the suspense builds, and Shakebox picks one toy from your family's list to go
play with. The toy list is one tap away behind the "Toys" button, and anyone can
manage it.

Shakebox is a tiny web app that runs entirely in the browser. **There is no
account, no server, and nothing leaves the device.** After the first visit it
works with no internet at all, and it can be installed to the home screen like a
normal app.

---

## How it works

**Shaking (the home screen)**
- The ball breathes gently. Tap it — or shake the phone — and it rattles, then
  reveals a random toy from your list.
- "Go play" returns home; "Shake again" (or another shake of the phone) picks
  another.
- If the toy list is empty it invites you to *"Add some toys to get started."*
- On iPhone/iPad, tapping the ball always works. Physical shaking needs Apple's
  one-time-per-visit permission, so there's a small **"Turn on phone shake"**
  button on the home screen — tap it once each session if you want to shake.
  (Apple resets that permission every time the app is reopened; that's an iOS
  rule, not something the app can change.)

**The toy list (tap "Toys" in the top-left corner)**
- **Toy vault** — add, rename, pause, or delete toys. Paused toys stay in the
  list but won't be picked.
- **Add a toy** — tap toys from the starter pack, or type your own; Shakebox
  guesses a matching emoji.
- **Settings** — turn sound on/off, optionally lock the toy list, and back up or
  restore it.

Anyone can shake *and* manage the list — there's no separate "kid" and "grown-up"
setup. If you'd rather keep the list from being changed, turn on the optional
lock (below).

---

## Where your data lives (important)

Your toy list is stored **only in this browser, on this one device**, using the
browser's `localStorage`. That means:

- Nothing is uploaded anywhere. There is no cloud copy.
- Clearing the browser's data, "resetting" the device, switching browsers, or
  uninstalling the app **will erase the toy list**.
- The list does not sync between devices. Each device has its own.

**So: back up after you've done a lot of adding.** In *Settings → Download
backup*, Shakebox saves a small file named like `shakebox-backup-2026-07-06.json`
to your device. Keep it somewhere safe (email it to yourself, drop it in a
photos/files folder). To bring a list back — new phone, wiped browser, or a
mistake — use *Settings → Restore backup* and pick that file. Shakebox will tell
you how many toys it restored.

The optional **toy-list lock** (Settings → "Lock the toy list") requires a PIN
to open the list, for families who'd rather it not be changed. It's off by
default, and it's a speed bump, not real security. If you forget the PIN, press
and hold *"Forgot PIN"* for 5 seconds and type `RESET`; that clears the PIN only
and never touches your toys.

---

## Installing it on a phone or tablet

Open the site in the browser, then:

- **iPhone / iPad (Safari):** Share → *Add to Home Screen*.
- **Android (Chrome):** menu (⋮) → *Install app* / *Add to Home screen*.

It then opens full-screen like a normal app and works offline.

---

## Changing the app later (you don't need to be a programmer)

This app was built with **Claude Code**. The easiest way to change it is to open
this folder in Claude Code and describe what you want in plain English, for
example:

- *"Add a category called 'Musical instruments' with 8 starter toys."*
- *"Make the shake take a little longer before it reveals."*
- *"Change the reveal color from blue to green."*

Two files are friendly to edit by hand if you'd rather:

- **`seed-toys.js`** — the starter-pack toys and the emoji guesses. The top of
  the file explains exactly how to add or remove entries. This is the safest file
  to tinker with.
- **`README.md`** — this file.

The look and feel (colors, fonts, animations) live in **`styles.css`**, and the
behavior lives in **`app.js`**. If you edit `app.js` or `sw.js`, bump the
`CACHE` version string near the top of **`sw.js`** (e.g. `shakebox-v1` →
`shakebox-v2`) so devices pick up the new version instead of the cached old one.

---

## How it's hosted (Cloudflare)

The app is a set of plain files — no build step. It's hosted on **Cloudflare**
as a **Workers Static Assets** project, connected to this project's GitHub
repository. (Cloudflare's "Connect to Git" flow uses Workers for static sites;
for a zero-build app like this it serves the files straight from the edge, and
static requests are free.)

The whole configuration is the small [`wrangler.jsonc`](wrangler.jsonc) file:
it just tells Cloudflare to serve every file in the repository root
(`"assets": { "directory": "." }`). There is no build command and no server
code.

Every time you push a change to the `main` branch on GitHub, Cloudflare
redeploys the site automatically within a minute or so. To publish a change made
in Claude Code, commit and push it; that's it. The live address is
`https://shakebox.shakebox-admin.workers.dev/` (you can also attach your own
custom domain from the Cloudflare dashboard).

---

## Running it on your own computer (optional)

Because of browser security rules, opening `index.html` directly with a
`file://` path won't let the offline/service-worker part work. Serve the folder
over a local web address instead. From inside this folder:

```
python3 -m http.server 4599
```

Then open `http://localhost:4599` in your browser.

---

## What's in the folder

| File | What it is |
|------|------------|
| `index.html` | The page shell. |
| `styles.css` | All the visuals, fonts, and animations. |
| `app.js` | All the behavior (shake, reveal, toy vault, settings, backups). |
| `seed-toys.js` | The starter-pack toys + emoji guesses. **Safe to edit.** |
| `manifest.json` | Makes it installable as an app. |
| `sw.js` | The service worker — makes it work offline. |
| `wrangler.jsonc` | Tells Cloudflare to serve the files. Not part of the app itself. |
| `fonts/` | The two fonts, stored locally (nothing loaded from the internet). |
| `icons/` | The app icons. |

No frameworks, no dependencies, no npm. Just these files.
