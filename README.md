# Remote Monitor Screen

Turns a spare Android phone (built for a OnePlus Nord AC2003, works on anything with Chrome) into an always-on desk display for this PC, and puts the Agents view on a Google TV or Android TV ([below](#google-tv--android-tv)):

- **System**: CPU % (Task Manager figure) with per-core bars and effective clock, GPU % (max engine, same as Task Manager) with VRAM, memory, network and disk throughput, 2-minute sparklines, clock and uptime.
- **Temperatures, fans, power**: CPU Tctl/Tdie, GPU core/hotspot, GPU power and fan, motherboard fans, via LibreHardwareMonitor (optional, see below).
- **Claude Code**: every active Claude Code session (VS Code extension and CLI), what each is doing right now (tool, file, command description), elapsed time, last prompt, to-do progress, context size, background subagents, plus a live activity feed. With the optional hook it also shows when a session is **waiting for your permission**, with a chime and vibration.
- **Agents view (office)**: each session and each subagent is a person at a desk, with desks grouped into pods by project. A chat bubble shows what each one is doing right now (tool and file, thinking, needs you, done). Sessions that stay quiet walk off to the break room for a nap, and idle people now and then wander over to the kitchen table. A session running two or more subagents gets a whiteboard (its task, to-do progress, a sticky note per subagent) and its subagents stand in front of it. The floor grows with the number of sessions: it scales down to a readable size, then scrolls (swipe), drifting through the office on its own and jumping to anyone who needs you. Tap a person to see the full session card. Long-press a person to pick them up: drop a session in the break room to stop it.

Read-only, with one exception: in the Agents view you can drag a session to the break room to stop it (see [Stopping a session from the phone](#stopping-a-session-from-the-phone); set `control: false` to turn that off). Nothing else on the phone can control the PC or Claude.

> **Prototype.** This was generated with AI assistance and has not been reviewed by a qualified person. Treat it as a personal prototype for a trusted home network, not a finished product.

## Quick start

Requires Node.js 20+ on Windows 10/11. No `npm install` needed (no dependencies).

```powershell
npm start            # foreground, prints the URL and a 6-digit pairing code
```

First run creates `config.local.json` with a random key (git-ignored).

1. **Allow it through the firewall** (one-off, needs admin; adds a rule for TCP 7865 on the *Private* profile from your *local subnet* only):
   ```powershell
   npm run firewall
   ```
2. On the phone, connect to the same network and open `http://<PC LAN IP>:7865` in Chrome (the console lists it, e.g. `http://10.0.100.10:7865`).
3. Enter the pairing code from the console. The phone stays paired (cookie, 1 year).

Lost the code, or running in the background? `npm run pair` prints the current code and a one-tap pairing link.

### Run in the background / at sign-in

```powershell
npm run start:bg     # hidden, logs to logs\server.log
npm run stop
npm run autostart    # Startup-folder shortcut (per-user, no admin). Remove: scripts\install-autostart.ps1 -Remove
```

## Android app (recommended)

A tiny kiosk app (`android/`, plain Java WebView, about 20 KB) that:

- shows the dashboard full screen in landscape and **keeps the screen on** by itself
- shows a **bundled clock** whenever the PC cannot be reached (off, asleep, network down), checks the PC every 10 seconds and switches back automatically
- recovers if the WebView crashes or is killed for memory
- vibrates on agent alerts
- the **back** gesture opens settings: dashboard address, reload, exit

Build (one-off toolchain download of about 500 MB into `%LOCALAPPDATA%
ms-android`; no admin, no Android Studio; accepts the Android SDK licence):

```powershell
npm run apk:setup                                  # JDK 17 + Android SDK command-line tools
npm run apk                                        # -> androiduildRemoteMonitor.apk
# different default address: .androiduild.ps1 -ServerUrl http://192.168.1.20:7865
```

Install, either way:

- **From the phone**: pair in Chrome first (see Quick start), then open `http://10.0.100.10:7865/app.apk`, allow Chrome to install unknown apps when asked, and install. Pair once more inside the app (it has its own cookie store).
- **USB**: enable USB debugging, then `%LOCALAPPDATA%
ms-androidsdkplatform-toolsadb.exe install -r androiduildRemoteMonitor.apk`.

**Keep Android System WebView updated** (Play Store → search "Android System WebView" → Update). The app renders with it, and an old WebView misses security fixes; the test Nord shipped with version 92 from 2021.

When the PC is off, Windows Firewall silently drops connections rather than refusing them, so the app checks the PC with a 3 second timeout before loading and falls back to the clock if a load stalls for 10 seconds.

The signing key is created on first build at `%LOCALAPPDATA%
ms-android
ms-signing.jks` (password beside it, outside the repo). Keep it: Android only installs updates signed with the same key.

The dashboard in a normal browser also switches to the clock when the PC goes offline, but only while the page stays open: if Chrome reloads the tab while the PC is off you get Chrome's error page. The app avoids that.

## Google TV / Android TV

The same APK runs on Android TV and Google TV (Chromecast with Google TV, Google TV Streamer, TVs with Google TV built in). It shows up in the TV's app row, opens straight into the **Agents** view, and keeps the TV from going to its screensaver while it is open. There is no Chrome on Google TV, so the app is the way to get the dashboard on it.

**Remote control:**

| Button | Does |
|---|---|
| ◀ ▲ ▶ ▼ | First press shows a focus ring; then moves it between people in the office and the view buttons at the top |
| OK | Opens (or closes) the focused person's session card; on a button, presses it. With a card open, moving to someone else shows their card |
| Back | Closes the card, then the ring; with nothing open, opens settings (dashboard address, reload, exit) |

After 20 seconds without a key press the ring and card go away and the office goes back to drifting on its own. Benching a session (drag to the break room) needs a touchscreen, so on the TV the office is view-only.

**Install** (sideloaded over the network with adb; the toolchain from `npm run apk:setup` includes it):

1. On the TV: Settings → System → About → select **Android TV OS build** 7 times to unlock developer options.
2. Settings → System → **Developer options**, then either:
   - **USB debugging** on (most Chromecast with Google TV and Android TV devices: adb then listens on port 5555), or
   - **Wireless debugging** on → *Pair device with pairing code* (newer Google TV devices): note the pairing address and code, and the address shown on the Wireless debugging screen.
3. Find the TV's IP (Settings → Network & Internet → your network), then on the PC:
   ```powershell
   npm run apk                                                       # if not built yet
   npm run apk:tv -- -Tv 192.168.1.50                                # USB debugging (port 5555)
   npm run apk:tv -- -Tv 192.168.1.50:41235 -Pair 192.168.1.50:37099 # Wireless debugging: asks for the pairing code
   ```
   Accept the *Allow debugging?* prompt on the TV the first time.
4. In the app on the TV: press **Back**, set the dashboard address (for example `http://10.0.100.10:7865`), **Save**, then pair: select the code box, press OK for the on-screen keyboard and enter the code from `npm run pair`.
5. **Turn debugging off again** (Developer options → USB/Wireless debugging off). While it is on, anything on your network that the TV has authorised can control it.

If the TV is on a different VLAN from the PC, it needs the same router and Windows firewall allowance as the phone (see [Troubleshooting](#troubleshooting)).

To try the TV layout in a desktop browser, open `http://localhost:7865/?tv` and use the arrow keys and Enter.

## Phone setup (browser or app)

1. Chrome → ⋮ → **Add to Home screen**. Launching from the icon opens full screen in landscape. Or tap ⛶ in the dashboard.
2. **Keep the screen on** (browser only; the app does this itself): Settings → About phone → tap *Build number* 7 times → Developer options → **Stay awake** (screen stays on while charging). Browser wake lock is not available over plain `http://` on a LAN IP, so this is the reliable route.
3. Settings → Battery → Chrome → **Don't optimise**, so Android does not kill the page.
4. If the phone will live on the charger, turn on **Optimised/Smart charging** to reduce battery wear.
5. Tap 🔔 once to enable the chime (browsers need one tap before they can play sound or vibrate).

**Burn-in**: the Nord has an AMOLED panel. The dashboard uses a true-black background, shifts the whole layout a few pixels every two minutes, and dims overnight (default 23:00 to 07:00, configurable). It brightens automatically if a Claude session needs you, or when tapped. Lowering phone brightness helps most.

**PC offline**: if no data arrives for 12 seconds the dashboard is covered by a large, slowly drifting clock showing when the PC was last seen; it disappears as soon as data resumes.

Views: **Split** (stats + agents), **System** (adds the sensor list), **Agents** (session grid + feed). Portrait also works (scrolls).

## Temperatures (LibreHardwareMonitor)

Windows has no unprivileged API for CPU/GPU temperatures, so this reads them from [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) (open source, MPL-2.0), which ships a signed kernel driver for sensor access.

1. Install from an **elevated** terminal (it also installs the signed PawnIO driver, whose installer fails with exit code 5 without admin): `winget install LibreHardwareMonitor.LibreHardwareMonitor`. It lands in `%LOCALAPPDATA%\Microsoft\WinGet\Packages\LibreHardwareMonitor.LibreHardwareMonitor_*`.
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
3. Run it **as Administrator** (needed for CPU temperatures). To keep it running after reboot, tick Options → **Run On Windows Startup** (LHM creates an elevated scheduled task, so there is no UAC prompt at sign-in).
4. **Do not add a firewall rule for port 8085** and decline any firewall prompt for LHM. In 0.9.6 the web server still listens on all interfaces despite `listenerIp`, and its page has no login. Windows' default inbound Block keeps it reachable from this PC only, which is all the dashboard needs.

The dashboard picks it up within ~10 seconds. Without LHM everything else still works; temperature readouts are hidden.

## Claude Code integration

No setup needed for the basics: the server tails Claude Code's own transcripts in `%USERPROFILE%\.claude\projects\**\*.jsonl` (the VS Code extension and the CLI both write there) and subagent files beside them. It never writes to them.

Session states:

| State | Meaning |
|---|---|
| **Working** | A tool is running (shows which, plus elapsed time), the model is thinking, or background subagents are still running |
| **Needs you** | Claude is waiting for a permission decision or an answer (needs the hook below) |
| **Done** | Turn finished, waiting for your next prompt |
| **Idle** | Nothing for a while without a clean finish (closed window, crash, or a very long tool) |

### Optional: "needs your permission" alerts

Transcripts cannot tell "running a slow command" from "waiting for you to click Allow". A small Claude Code hook fills that gap:

```powershell
npm run hooks:install     # adds Notification, Stop and PreToolUse hooks to %USERPROFILE%\.claude\settings.json (backs it up first)
npm run hooks:uninstall
```

The hook (`hooks/relay.mjs`) forwards only the session id, event name and notification message to `127.0.0.1`, authenticated with a key derived from `config.local.json`. It times out in under a second and always exits cleanly, so it cannot stall Claude even if the dashboard is not running. New sessions pick it up; restart open ones.

The `PreToolUse` hook runs before every tool call (about 0.1 s each on Windows) and is what makes the break room work. It prints nothing unless that session has been benched.

### Stopping a session from the phone

In the Agents view, long-press a person until they lift, then drag them:

- **Desk → break room**: benches the session. A toast gives you 4 seconds to **Undo**; then the dashboard tells the server, and the next time that session (or one of its subagents) tries to use a tool, the `PreToolUse` hook answers `continue: false` and Claude Code stops with "Sent to the break room from Remote Monitor Screen". The tool step already running finishes first; a reply being written is not cut off. The person shows "stopping…" on the sofa until the session goes quiet.
- **Break room → any desk area**: unbenches it (only for benched sessions; idle ones need a new prompt).
- Sending that session a **new prompt** in Claude Code also unbenches it.
- Subagents cannot be benched on their own; bench their session.

This needs the hooks installed (above) and `control: true` (the default).

## Configuration

`config.local.json` (created on first run):

| Key | Default | Notes |
|---|---|---|
| `port` | `7865` | Also `PORT` env var. Re-run `npm run firewall -- -Port <n>` if you change it |
| `host` | `0.0.0.0` | Set `127.0.0.1` to disable LAN access |
| `lhmUrl` | `http://127.0.0.1:8085/data.json` | LibreHardwareMonitor endpoint |
| `claude.enabled` | `true` | Turn the agent panel off entirely |
| `claude.detail` | `full` | `full`: prompts, reply snippets, command descriptions (secret-redacted). `minimal`: tool names and file names only |
| `claude.windowMinutes` | `240` | How far back sessions are shown |
| `allow` | loopback + private ranges | CIDR list of clients allowed to connect |
| `dim` | `23:00` to `07:00`, level `0.35` | Night dimming; `level` is remaining brightness |
| `control` | `true` | Allow stopping a session by dragging it to the office break room. `false` makes the dashboard fully read-only |
| `key` | random | Master secret. Delete to rotate (unpairs every device) |

## Security notes

Please read before running this on anything other than a trusted home network.

- **What is exposed**: system stats, and (in `full` mode) Claude Code project names, git branches, prompt snippets, assistant reply snippets and command descriptions. Use `claude.detail: "minimal"` if prompts may contain anything sensitive, or `claude.enabled: false` to remove the agent panel.
- **Plain HTTP**: traffic between PC and phone is unencrypted. Anyone who can sniff your LAN (for example, shared or guest Wi-Fi) could read the dashboard data and the session cookie. Only use on a network you trust.
- **Access control**: connections are limited to loopback and private address ranges, the firewall rule is limited to the Private profile and local subnet, and every non-localhost request needs a session cookie (HttpOnly, SameSite=Strict) obtained with a 6-digit pairing code (rate-limited: 5 failures per device per 10 minutes, code rotates after 20 failures overall) or the pairing link. A Host-header check blocks DNS-rebinding attacks from web pages. Browsers on the PC itself via `localhost` are trusted without pairing.
- **Secrets**: the master key lives only in `config.local.json` (git-ignored, never sent to the browser). The phone only receives a derived session token. The front end contains no secrets. The `npm run pair` link is equivalent to a password; do not share it. Transcript text is passed through a best-effort secret redactor (API keys, tokens, JWTs, `password=` style pairs, long hex/base64 blobs), which will not catch everything.
- **XSS**: all transcript-derived text is rendered with `textContent`, and a strict Content-Security-Policy (`default-src 'self'`, no inline script) is sent on every response.
- **Hook endpoint**: accepts requests from `127.0.0.1` only, with a key derived from the master secret.
- **Control (break room)**: a paired device can stop a Claude session, and nothing else: no prompts, no commands, no file access. `POST /api/office` needs the session cookie, a JSON body and a same-origin `Origin` header (so other web pages cannot trigger it), and every bench/unbench is logged with the client IP. Anyone holding a paired phone can interrupt your sessions; set `control: false` if that matters.
- **Not for the internet**: do not port-forward this or publish it on a public URL. If you ever want remote access, that needs an IT/security review first and a proper authenticated tunnel (for example, a zero-trust access proxy), not an open port.
- **Android app**: allows cleartext HTTP (needed for a LAN server without TLS), only navigates to the configured dashboard address and its bundled clock, and exposes only `vibrate` and two flags (`isApp`, `isTv`) to page JavaScript. It is signed with a locally generated key and sideloaded, so it has had no store review. `/app.apk` needs a paired session; `/api/ping` is public but returns an empty 204.
- **Router rule**: when allowing the phone VLAN through the Sophos, scope it to the phone (or Wi-Fi range) to the PC's IP on TCP 7865 only. If the Sophos is a managed or work network rather than a home one, get that change reviewed by IT/security first.
- **Third-party software**: LibreHardwareMonitor runs with admin rights and installs a kernel driver. Get it from the official GitHub releases or winget only.

## Tests

```powershell
npm test
```

Covers LHM parsing, perf-counter summarising, the transcript state machine (working, done, interrupted, stale, attention, subagents, incremental tailing of partial lines), secret redaction, CIDR checks and pairing rate limits.

## How it works

```
server/index.mjs              HTTP server, pairing, SSE stream (/api/stream), static files
server/collectors/sampler.ps1 long-lived PowerShell: Get-Counter for CPU utility, GPU engines, VRAM, disk, network
server/collectors/winperf.mjs supervises the sampler, picks the discrete GPU, filters virtual NICs
server/collectors/lhm.mjs     polls LibreHardwareMonitor's data.json, extracts headline sensors
server/collectors/system.mjs  merges os.cpus() (per-core), perf counters and LHM into one snapshot
server/collectors/claude.mjs  incremental tail of Claude Code transcripts + subagent meta, hook events
public/clock.*                offline clock (dashboard overlay + bundled in the APK)
android/                      kiosk app source (phone and Android/Google TV), toolchain setup and build scripts (no Gradle)
public/keys.js                remote-control (D-pad) and keyboard navigation for the TV
public/                       dashboard (vanilla JS, canvas sparklines), login page, PWA manifest
hooks/relay.mjs               optional Claude Code hook -> local server
scripts/                      firewall rule, background start/stop, autostart, pairing, hook installer
```

## Troubleshooting

- **Phone cannot connect**: if the phone's Wi-Fi is a different subnet/VLAN from the PC, the router firewall (Sophos etc.) needs a rule allowing phone to PC on TCP 7865 only, and the Windows rule needs that range too: `.scriptsallow-firewall.ps1 -RemoteAddress LocalSubnet,10.0.110.0/24`. Otherwise run `npm run firewall`; check the PC network is set to *Private* (Settings → Network → Ethernet/Wi-Fi → Network profile); make sure the phone is on the same network, not mobile data or guest Wi-Fi.
- **GPU shows `--`**: the perf-counter sampler takes a few seconds to warm up. If it persists, run `powershell -File server/collectors/sampler.ps1` and check for output.
- **No temperatures**: LHM must be running, as admin, with *Remote Web Server* enabled. Check `http://127.0.0.1:8085/data.json` in a browser on the PC.
- **Claude session missing**: sessions appear once the transcript has activity within `claude.windowMinutes`.
