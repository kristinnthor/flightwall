# FlightWall on a Samsung Frame TV (2022+)

Two routes. Route 1 works in 5 minutes; Route 2 makes it a real app tile.

## Route 1 — TV browser (quick)

1. Open the Internet app on the TV.
2. Enter your configured URL (build it on the settings screen from your phone):
   `https://kristinnthor.github.io/flightwall/#lat=…&lon=…&r=…&label=…`
3. Browser menu → **Set as home page** (survives browser restarts).
4. Do the **TV settings checklist** below.

Limits: the browser shows its top bar and is the least stable surface for
24/7 use. Route 2 is better.

## Route 2 — real Tizen app (recommended)

### One-time PC setup
1. Install **Tizen Studio** (with CLI) from
   https://developer.tizen.org/development/tizen-studio/download
   During install add the **TV Extension** and **Samsung Certificate Extension**
   via Package Manager. Add `<tizen-studio>\tools\ide\bin` and
   `<tizen-studio>\tools` to PATH.
2. TV: **Apps → press 1 2 3 4 5 on the remote → Developer mode ON**, set
   *Host PC IP* to this PC's LAN IP, reboot the TV.
3. Find the TV's IP (Settings → Connection → Network → Network Status).
4. Connect: `sdb connect <TV_IP>:26101` then `sdb devices` (note the device name).
5. Certificate (Certificate Manager GUI, one time):
   - Try **Tizen** profile first (name it `flightwall`): simplest, no account.
   - If install later fails with a cert error, create a **Samsung** profile
     instead: needs a free Samsung account; the TV's DUID appears automatically
     while `sdb` is connected. Then also run:
     `tizen install-permit -t <DEVICE_NAME>`.

### Build, package, install
```powershell
npm run package:tizen        # produces FlightWall.wgt (profile: flightwall,
                             # override with $env:TIZEN_PROFILE)
tizen install -n FlightWall.wgt -t <DEVICE_NAME>
```
The app appears on the TV home row. Launch it once; done.

### Updating later
Bump `version` in `tizen/config.xml`, re-run the two commands above.
Keep the same certificate profile — updates must be signed by the same author.

## TV settings checklist (set-and-forget)

| Setting | Value | Why |
|---|---|---|
| Power and Energy Saving → Auto Power Off | **Off** | default kills the TV after 4 h idle |
| System Manager → Auto Protection Time (screensaver) | **Off** | else screensaver covers the board |
| Support → Software Update → Auto Update | **Off** | firmware updates are known to delete sideloaded apps |
| Smart Features → Auto Run Last App | **On** | power button from Art Mode drops straight back into FlightWall |

Notes:
- Power button toggles TV ↔ Art Mode; with Auto Run Last App on, one press
  brings the wall back.
- An expired dev certificate blocks *re*-installs, never the installed app.
- If a firmware update ever removes the app: re-enable Developer Mode and
  re-run the install commands.
