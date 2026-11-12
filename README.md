# Remote Monitor Screen

Remote Monitor Screen turns a spare Android phone into an always-on desk display for your Windows PC. A small Node.js server on the PC serves a live dashboard over your local network. The dashboard shows system stats and what your Claude Code sessions are doing. The Agents view also runs on a Google TV or Android TV.

It is read-only, with one exception: in the Agents view you can drag a session to the break room to stop it (see [Stopping a session from the phone](#stopping-a-session-from-the-phone)). Set `control: false` to turn that off.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Optional extras](#optional-extras)
  - [Run in the background and at sign-in](#run-in-the-background-and-at-sign-in)
  - [Firewall and other networks](#firewall-and-other-networks)
  - [Android app (recommended for phones)](#android-app-recommended-for-phones)
  - [Google TV / Android TV](#google-tv--android-tv)
  - [Phone setup](#phone-setup)
  - [Temperatures (LibreHardwareMonitor)](#temperatures-librehardwaremonitor)
  - [Claude Code hooks and the Agents office](#claude-code-hooks-and-the-agents-office)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)
- [Tests](#tests)
- [Project layout](#project-layout)
- [License](#license)

## Features

- **System**: CPU % (the Task Manager figure) with per-core bars and effective clock. GPU % (busiest engine, as in Task Manager) with VRAM. Memory, network and disk throughput, 2-minute sparklines, clock and uptime.
- **Temperatures, fans, power**: CPU Tctl/Tdie, GPU core/hotspot, GPU power and fan, motherboard fans. Needs LibreHardwareMonitor (optional).
- **Claude Code sessions**: every active session (VS Code extension and CLI). For each one you see the current tool, file or command description, elapsed time, last prompt, to-do progress, context size and background subagents, plus a live activity feed. With the optional hook it also shows when a session is **waiting for your permission**, with a chime and vibration.
- **Agents view (office)**: each session and each subagent is a person at a desk, grouped into pods by project.
  - A chat bubble shows what each one is doing (tool and file, thinking, needs you, done).
  - Quiet sessions walk to the break room for a nap. Idle people sometimes wander to the kitchen table.
  - A session with two or more subagents gets a whiteboard (its task, to-do progress, one sticky note per subagent).
  - The floor scales down to a readable size, then scrolls. It drifts on its own and jumps to anyone who needs you.
  - Tap a person for the full session card. Long-press to pick them up, and drop them in the break room to stop that session.
- **Views**: **Split** (stats and agents), **System** (adds the sensor list), **Agents** (session grid and feed). Portrait works too and scrolls.
- **Offline clock**: if no data arrives for 12 seconds, a large, slowly drifting clock shows when the PC was last seen. It disappears when data resumes.
- **Burn-in protection**: true-black background, the layout shifts a few pixels every two minutes, and the screen dims overnight (default 23:00 to 07:00, configurable). It brightens when a Claude session needs you, or when tapped. Lowering the phone's brightness helps most.

## Requirements

- Windows 10 or 11 on the PC
- Node.js 20 or newer
- A phone with Chrome, or an Android phone/TV for the optional app, on the same network as the PC
- No `npm install` needed (the project has no dependencies)
- Optional: [LibreHardwareMonitor](#temperatures-librehardwaremonitor) for temperatures, and the [Claude Code hooks](#claude-code-hooks-and-the-agents-office) for permission alerts and the break-room stop

## Getting started

This gets the dashboard onto a phone in Chrome. Everything after step 4 is optional. In the examples, `<your-pc-ip>` is your PC's address on the local network (for example `192.168.1.50`), and 7865 is the default port.

1. **Install Node.js 20 or newer** on the Windows PC if you do not have it. Check with:
   ```powershell
   node --version
   ```
   You should see `v20.x.x` or higher.

2. **Get the code** and open a terminal in the project folder. There is no `npm install` step, because the project has no dependencies.
   ```powershell
   git clone <repository-url>
   cd Remote-Monitor-Screen
   ```

3. **Start the server** in the foreground:
   ```powershell
   npm start
   ```
   You should now see the phone URL(s) and a 6-digit pairing code in the console. The first run also creates `config.local.json` with default settings and a random key. That file is git-ignored, and there is no template to copy. Leave this terminal open.

4. **Allow the phone through Windows Firewall.** Open a second terminal and run this once. It shows a UAC (admin) prompt and adds a rule for the server's port on the *Private* profile, from your *local subnet* only:
   ```powershell
   npm run firewall
   ```
   You should now see the rule created and no errors. If the phone will be on a different subnet or VLAN, see [Firewall and other networks](#firewall-and-other-networks).

5. **Pair the phone.** Join the phone to the same Wi-Fi as the PC, open the URL printed in step 3 in Chrome, and enter the pairing code:
   ```
   http://<your-pc-ip>:7865
   ```
   You should now see the live dashboard. The phone stays paired for a year (cookie).

   Lost the code, or running the server in the background? With the server running, print the current code and a one-tap pairing link:
   ```powershell
   npm run pair
   ```

Next, if you want them:

- **Keep it running** without a terminal window, and start it at sign-in: [Run in the background and at sign-in](#run-in-the-background-and-at-sign-in).
- **Temperatures and fans**: install LibreHardwareMonitor, see [Temperatures (LibreHardwareMonitor)](#temperatures-librehardwaremonitor). The server runs fine without it.
- **Claude Code permission alerts and the break-room stop**: run `npm run hooks:install`, see [Claude Code hooks and the Agents office](#claude-code-hooks-and-the-agents-office).
- **A kiosk app instead of Chrome** (recommended for phones): [Android app](#android-app-recommended-for-phones).
- **Google TV or Android TV**: [Google TV / Android TV](#google-tv--android-tv).
- **Phone settings** for keeping the screen on: [Phone setup](#phone-setup).

To rotate the key and unpair every device, stop the server, delete `config.local.json` and start it again.

## Configuration

Settings live in `config.local.json` (created on first run, see [Getting started](#getting-started)). You can edit it by hand, for example `port`, `lhmUrl`, `allow`, `dim`, `control` and `claude.detail`. Restart the server after changing it.

| Key | Default | Notes |
|---|---|---|
| `port` | `7865` | Also the `PORT` env var. Re-run `npm run firewall` after changing it (it reads the port from this file) |
| `host` | `0.0.0.0` | Also the `HOST` env var. Set `127.0.0.1` to disable LAN access |
| `lhmUrl` | `http://127.0.0.1:8085/data.json` | LibreHardwareMonitor endpoint |
| `claude.enabled` | `true` | Turn the agent panel off entirely |
| `claude.detail` | `full` | `full`: prompts, reply snippets, command descriptions (secret-redacted). `minimal`: tool names and file names only |
| `claude.windowMinutes` | `240` | How far back sessions are shown |
| `allow` | loopback + private ranges | CIDR list of clients allowed to connect |
| `dim` | `23:00` to `07:00`, level `0.35` | Night dimming. `level` is the remaining brightness |
| `control` | `true` | Allow stopping a session by dragging it to the break room. `false` makes the dashboard fully read-only |
| `key` | random | Master secret. Delete it to rotate (this unpairs every device) |

## Optional extras

### Run in the background and at sign-in

```powershell
npm run start:bg     # hidden, logs to logs\server.log
npm run stop         # stop the background server
npm run autostart    # Startup-folder shortcut (per user, no admin)
```

To remove the autostart shortcut:

```powershell
.\scripts\install-autostart.ps1 -Remove
```

### Firewall and other networks

`npm run firewall` allows only your local subnet. The port defaults to the `port` in `config.local.json` (7865 if there is none), so you normally do not pass it.

If the phone is on a different subnet or VLAN, you need two things:

1. A router/firewall rule that allows the phone to reach the PC on the server's port (7865 by default) only.
2. The same range in the Windows rule. This example adds the `192.168.20.0/24` subnet next to your local one, so replace it with the phone's subnet:
   ```powershell
   .\scripts\allow-firewall.ps1 -RemoteAddress LocalSubnet,192.168.20.0/24
   ```

To remove the Windows rule:

```powershell
.\scripts\allow-firewall.ps1 -Remove
```

### Android app (recommended for phones)

A tiny kiosk app (`android/`, plain Java WebView, about 20 KB). It:

- shows the dashboard full screen in landscape and keeps the screen on by itself
- shows a bundled clock whenever the PC cannot be reached (off, asleep, network down), checks the PC every 10 seconds and switches back automatically
- recovers if the WebView crashes or is killed for memory
- vibrates on agent alerts
- opens settings (dashboard address, reload, exit) on the **back** gesture

**Build it.** The first step downloads a toolchain of about 500 MB into `%LOCALAPPDATA%\rms-android`. It needs no admin rights and no Android Studio, and it accepts the Android SDK licence.

1. Download JDK 17 and the Android SDK command-line tools:
   ```powershell
   npm run apk:setup
   ```
2. Build the APK (output: `android\build\RemoteMonitor.apk`):
   ```powershell
   npm run apk
   ```
   You do not need to give it an address. The build finds this PC's LAN IPv4 address and uses `http://<that-address>:<port>` as the app's starting dashboard address. The port comes from `config.local.json`, or 7865 if there is none, so run the server once first (see [Getting started](#getting-started)) if you use a custom port.

   The detection only looks at adapters that are up, and skips loopback and `169.254.x.x` link-local addresses. It ranks virtual and VPN adapters (such as vEthernet, WSL, Docker, Tailscale, ZeroTier, WireGuard) lower, and prefers the adapter that has a default gateway. The build prints the address it baked in, which adapter it came from, any other candidates, and how to override it. If it picks the wrong one, or finds nothing, pass the address yourself:
   ```powershell
   npm run apk -- -ServerUrl http://<your-pc-ip>:7865
   ```
   You can also run `.\android\build.ps1 -ServerUrl http://<your-pc-ip>:7865` directly. This address is only the app's default. You can change it later inside the app (open settings with the **back** gesture), so a wrong guess does not need a rebuild.

**Install it**, either way:

- **From the phone**: pair in Chrome first (see [Getting started](#getting-started)). Then open `http://<your-pc-ip>:7865/app.apk`, allow Chrome to install unknown apps when asked, and install. Pair once more inside the app, because it has its own cookie store.
- **Over USB**: enable USB debugging, then run:
  ```powershell
  & "$env:LOCALAPPDATA\rms-android\sdk\platform-tools\adb.exe" install -r android\build\RemoteMonitor.apk
  ```

Notes:

- **Keep Android System WebView updated** (Play Store, search "Android System WebView", Update). The app renders with it, and an old WebView misses security fixes. The test phone shipped with version 92 from 2021.
- When the PC is off, Windows Firewall silently drops connections instead of refusing them. So the app checks the PC with a 3-second timeout before loading, and falls back to the clock if a load stalls for 10 seconds.
- The signing key is created on first build at `%LOCALAPPDATA%\rms-android\rms-signing.jks`, with its password beside it, outside the repo. Keep it: Android only installs updates signed with the same key.
- In a normal browser the dashboard also switches to the clock when the PC goes offline, but only while the page stays open. If Chrome reloads the tab while the PC is off, you get Chrome's error page. The app avoids that.

### Google TV / Android TV

The same APK runs on Android TV and Google TV (Chromecast with Google TV, Google TV Streamer, TVs with Google TV built in). It appears in the TV's app row, opens straight into the **Agents** view, and keeps the TV out of its screensaver while open. Google TV has no Chrome, so the app is the way to get the dashboard on it.

**Remote control**

| Button | Does |
|---|---|
| D-pad (up, down, left, right) | First press shows a focus ring. Then it moves between people in the office and the view buttons at the top |
| OK | Opens or closes the focused person's session card. On a button, presses it. With a card open, moving to someone else shows their card |
| Back | Closes the card, then the ring. With nothing open, opens settings (dashboard address, reload, exit) |

After 20 seconds without a key press, the ring and card go away and the office drifts on its own again. Benching a session (drag to the break room) needs a touchscreen, so the TV office is view-only.

**Install** (sideloaded over the network with adb; the toolchain from `npm run apk:setup` includes it)

1. On the TV: Settings, System, About. Select **Android TV OS build** 7 times to unlock developer options.
2. Settings, System, **Developer options**. Then turn on one of these:
   - **USB debugging** (most Chromecast with Google TV and Android TV devices). adb then listens on port 5555.
   - **Wireless debugging**, then *Pair device with pairing code* (newer Google TV devices). Note the pairing address and code, and the address shown on the Wireless debugging screen.
3. Find the TV's IP (Settings, Network & Internet, your network).
4. On the PC, build the APK if you have not yet, then install it:
   ```powershell
   npm run apk
   ```
   With USB debugging (port 5555):
   ```powershell
   npm run apk:tv -- -Tv <tv-ip>
   ```
   With Wireless debugging (asks for the pairing code):
   ```powershell
   npm run apk:tv -- -Tv <tv-ip>:<debug-port> -Pair <tv-ip>:<pairing-port>
   ```
   Accept the *Allow debugging?* prompt on the TV the first time.
5. In the app on the TV, press **Back**, set the dashboard address (`http://<your-pc-ip>:7865`) and press **Save**. Then pair: select the code box, press OK for the on-screen keyboard, and enter the code from `npm run pair`.
6. **Turn debugging off again** (Developer options, USB/Wireless debugging off). While it is on, anything on your network that the TV has authorised can control it.

If the TV is on a different VLAN from the PC, it needs the same router and Windows firewall allowance as a phone (see [Firewall and other networks](#firewall-and-other-networks)).

To try the TV layout in a desktop browser, open `http://localhost:7865/?tv` and use the arrow keys and Enter.

### Phone setup

For the browser or the app.

1. In Chrome, open the menu and choose **Add to Home screen**. Launching from the icon opens full screen in landscape. You can also tap the fullscreen button in the dashboard.
2. **Keep the screen on** (browser only; the app does this itself). Settings, About phone, tap *Build number* 7 times. Then Developer options, **Stay awake** (screen stays on while charging). The browser wake lock does not work over plain `http://` on a LAN IP, so this is the reliable route.
3. Settings, Battery, Chrome, **Don't optimise**, so Android does not kill the page.
4. If the phone will live on the charger, turn on **Optimised/Smart charging** to reduce battery wear.
5. Tap the bell icon once to enable the chime. Browsers need one tap before they can play sound or vibrate.

### Temperatures (LibreHardwareMonitor)

Windows has no unprivileged API for CPU/GPU temperatures. The server reads them from [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) (open source, MPL-2.0), which ships a signed kernel driver for sensor access. Without it everything else still works and the temperature readouts are hidden.

1. Install it from an **elevated** terminal. This also installs the signed PawnIO driver, whose installer fails with exit code 5 without admin:
   ```powershell
   winget install LibreHardwareMonitor.LibreHardwareMonitor
   ```
   It lands in `%LOCALAPPDATA%\Microsoft\WinGet\Packages\LibreHardwareMonitor.LibreHardwareMonitor_*`.
2. Create `LibreHardwareMonitor.config` next to the exe (or set the same options from its Options menu):
   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <configuration>
     <appSettings>
       <add key="runWebServerMenuItem" value="true" />
       <add key="listenerIp" value="127.0.0.1" />
       <add key="listenerPort" value="8085" />
       <add key="startMinMenuItem" value="true" />
       <add key="minTrayMenuItem" value="true" />
       <add key="minCloseMenuItem" value="true" />
     </appSettings>
   </configuration>
   ```
3. Run it **as Administrator** (needed for CPU temperatures). To keep it running after reboot, tick Options, **Run On Windows Startup**. LibreHardwareMonitor creates an elevated scheduled task, so there is no UAC prompt at sign-in.
4. **Do not add a firewall rule for port 8085**, and decline any firewall prompt for it. In version 0.9.6 the web server still listens on all interfaces despite `listenerIp`, and its page has no login. Windows' default inbound block keeps it reachable from this PC only, which is all the dashboard needs.

The dashboard picks it up within about 10 seconds.

### Claude Code hooks and the Agents office

**Basics need no setup.** The server tails Claude Code's own transcripts in `%USERPROFILE%\.claude\projects\**\*.jsonl` (the VS Code extension and the CLI both write there), plus subagent files beside them. It never writes to them.

| State | Meaning |
|---|---|
| **Working** | A tool is running (shown with elapsed time), the model is thinking, or background subagents are still running |
| **Needs you** | Claude is waiting for a permission decision or an answer (needs the hook below) |
| **Done** | Turn finished, waiting for your next prompt |
| **Idle** | Nothing for a while without a clean finish (closed window, crash, or a very long tool) |

**Optional hook for "needs your permission" alerts.** Transcripts cannot tell "running a slow command" from "waiting for you to click Allow". A small Claude Code hook fills that gap:

```powershell
npm run hooks:install     # adds Notification, Stop and PreToolUse hooks to %USERPROFILE%\.claude\settings.json (backs it up first)
npm run hooks:uninstall   # removes them
```

- The hook (`hooks/relay.mjs`) forwards only the session id, event name and notification message to `127.0.0.1`. It authenticates with a key derived from `config.local.json`.
- It times out in under a second and always exits cleanly, so it cannot stall Claude even if the dashboard is not running.
- New sessions pick it up. Restart sessions that are already open.
- The `PreToolUse` hook runs before every tool call (about 0.1 s each on Windows) and is what makes the break room work. It prints nothing unless that session has been benched.

#### Stopping a session from the phone

In the Agents view, long-press a person until they lift, then drag them.

- **Desk to break room** benches the session.
  - A toast gives you 4 seconds to **Undo**. After that the dashboard tells the server.
  - The next time that session (or one of its subagents) tries to use a tool, the `PreToolUse` hook answers `continue: false`. Claude Code then stops with "Sent to the break room from Remote Monitor Screen".
  - The tool step already running finishes first, and a reply being written is not cut off. The person shows "stopping..." on the sofa until the session goes quiet.
- **Break room to any desk area** unbenches it. This works only for benched sessions. Idle ones need a new prompt.
- Sending that session a **new prompt** in Claude Code also unbenches it.
- Subagents cannot be benched on their own. Bench their session.

This needs the hooks installed and `control: true` (the default).

## Security notes

Read these before running this on anything other than a trusted home network.

- **What is exposed**: system stats and, in `full` mode, Claude Code project names, git branches, prompt snippets, assistant reply snippets and command descriptions. Set `claude.detail: "minimal"` if prompts may contain anything sensitive, or `claude.enabled: false` to remove the agent panel.
- **Plain HTTP**: traffic between PC and phone is unencrypted. Anyone who can sniff your LAN (for example on shared or guest Wi-Fi) could read the dashboard data and the session cookie. Use it only on a network you trust.
- **Access control**:
  - Connections are limited to loopback and private address ranges.
  - The firewall rule is limited to the Private profile and local subnet.
  - Every non-localhost request needs a session cookie (HttpOnly, SameSite=Strict). You get it with the 6-digit pairing code or the pairing link.
  - Pairing is rate-limited: 5 failures per device per 10 minutes, and the code rotates after 20 failures overall.
  - A Host-header check blocks DNS-rebinding attacks from web pages.
  - Browsers on the PC itself via `localhost` are trusted without pairing.
- **Secrets**: the master key lives only in `config.local.json` (git-ignored, never sent to the browser). The phone only receives a derived session token, and the front end contains no secrets. The `npm run pair` link is equivalent to a password, so do not share it. Transcript text goes through a best-effort secret redactor (API keys, tokens, JWTs, `password=` style pairs, long hex/base64 blobs). It will not catch everything.
- **XSS**: all transcript-derived text is rendered with `textContent`, and a strict Content-Security-Policy (`default-src 'self'`, no inline script) is sent on every response.
- **Hook endpoint**: accepts requests from `127.0.0.1` only, with a key derived from the master secret.
- **Control (break room)**: a paired device can stop a Claude session and nothing else. It cannot send prompts, run commands or read files. `POST /api/office` needs the session cookie, a JSON body and a same-origin `Origin` header, so other web pages cannot trigger it. Every bench and unbench is logged with the client IP. Anyone holding a paired phone can interrupt your sessions, so set `control: false` if that matters.
- **Not for the internet**: do not port-forward this or publish it on a public URL. Remote access would need a security review and a proper authenticated tunnel (for example, a zero-trust access proxy), not an open port.
- **Android app**: it allows cleartext HTTP (needed for a LAN server without TLS). It only navigates to the configured dashboard address and its bundled clock, and exposes only `vibrate` and two flags (`isApp`, `isTv`) to page JavaScript. It is signed with a locally generated key and sideloaded, so it has had no store review. `/app.apk` needs a paired session. `/api/ping` is public but returns an empty 204.
- **Router rules**: when you allow a phone VLAN through your router, scope the rule to the phone (or Wi-Fi range) to the PC's IP on TCP 7865 only. On a managed or work network, get that change reviewed by IT/security first.
- **Third-party software**: LibreHardwareMonitor runs with admin rights and installs a kernel driver. Get it only from the official GitHub releases or winget.

## Troubleshooting

- **Phone cannot connect**
  - Run `npm run firewall` if you have not.
  - Check the PC network is set to *Private* (Settings, Network, Ethernet/Wi-Fi, Network profile).
  - Make sure the phone is on the same network, not mobile data or guest Wi-Fi.
  - If the phone is on a different subnet or VLAN, see [Firewall and other networks](#firewall-and-other-networks).
- **GPU shows `--`**: the perf-counter sampler takes a few seconds to warm up. If it persists, run this and check for output:
  ```powershell
  powershell -File server/collectors/sampler.ps1
  ```
- **No temperatures**: LibreHardwareMonitor must be running as admin with its remote web server enabled. Open `http://127.0.0.1:8085/data.json` in a browser on the PC to check.
- **Claude session missing**: sessions appear once the transcript has activity within `claude.windowMinutes`.

## Tests

```powershell
npm test
```

The tests cover LibreHardwareMonitor parsing, perf-counter summarising, the transcript state machine (working, done, interrupted, stale, attention, subagents, incremental tailing of partial lines), secret redaction, CIDR checks and pairing rate limits.

## Project layout

```
server/index.mjs              HTTP server, pairing, SSE stream (/api/stream), static files
server/collectors/sampler.ps1 long-lived PowerShell: Get-Counter for CPU, GPU engines, VRAM, disk, network
server/collectors/winperf.mjs supervises the sampler, picks the discrete GPU, filters virtual NICs
server/collectors/lhm.mjs     polls LibreHardwareMonitor's data.json, extracts headline sensors
server/collectors/system.mjs  merges os.cpus() (per-core), perf counters and LHM into one snapshot
server/collectors/claude.mjs  incremental tail of Claude Code transcripts + subagent meta, hook events
public/                       dashboard (vanilla JS, canvas sparklines), login page, PWA manifest
public/clock.*                offline clock (dashboard overlay, also bundled in the APK)
public/keys.js                remote-control (D-pad) and keyboard navigation for the TV
android/                      kiosk app source (phone and Android/Google TV), toolchain setup and build scripts (no Gradle)
hooks/relay.mjs               optional Claude Code hook -> local server
scripts/                      firewall rule, background start/stop, autostart, pairing, hook installer, TV installer
```

## License

MIT, see [LICENSE](LICENSE).

---

This README.md has been summarised and adjusted by Claude
