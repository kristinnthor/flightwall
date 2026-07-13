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
1. Install **Tizen Studio CLI** from
   https://developer.tizen.org/development/tizen-studio/download — the
   `web-cli_…_windows-64.exe` installer (~300 MB) is enough; the full Studio
   isn't needed. The installer requires admin elevation. Add
   `<tizen-studio>\tools\ide\bin` and `<tizen-studio>\tools` to PATH.
2. The CLI install lacks the certificate GUI — add it (elevated):
   ```powershell
   package-manager\package-manager-cli.exe install Certificate-Manager --accept-license
   package-manager\package-manager-cli.exe install cert-add-on --accept-license
   ```
   (`cert-add-on` is the Samsung Certificate Extension.)
3. TV: open the full **Apps** screen and type **1 2 3 4 5**. Modern Frame
   remotes have no number keys — use the number pad in the **SmartThings**
   phone app's virtual remote, or plug a USB keyboard into the One Connect
   box. In the Developer Mode dialog: **On**, and set *Host PC IP* to this
   PC's exact LAN IP (it defaults to `0.0.0.0` — that must be replaced).
   Then fully restart the TV (unplug ~10 s, not just standby).
4. Find the TV's IP (Settings → General → Network → Network Status).
5. Connect: `sdb connect <TV_IP>:26101` then `sdb devices` (note the serial).
6. Certificate (Certificate Manager GUI, one time). **Go straight to a
   Samsung profile** — 2024+ TVs reject generic Tizen certificates, and the
   distributor cert bundled with older Studio versions is expired anyway:
   - **+** → **Samsung** → **TV** → name it `flightwall-samsung`.
   - Author certificate: create new, pick a password and keep it — every
     future update must be signed with this certificate.
   - Sign in to your (free) Samsung account when the browser opens.
   - Distributor step: with the TV connected, its **DUID** appears in the
     list automatically — keep it checked and **finish the whole wizard**
     (stopping after the author step is the classic mistake).
7. Push the install permit to the TV (one time):
   ```powershell
   sdb -s <SERIAL> push "$env:USERPROFILE\SamsungCertificate\flightwall-samsung\device-profile.xml" /home/owner/share/tmp/sdk_tools/device-profile.xml
   ```

### Build, package, install
```powershell
$env:TIZEN_PROFILE = 'flightwall-samsung'
npm run package:tizen                              # produces FlightWall.wgt
tizen install -n FlightWall.wgt -s <SERIAL>
tizen run -p FLTWLL2026.FlightWall -s <SERIAL>     # launch from the PC (optional)
```
The app appears on the TV home row. Launch it once; done.

### Updating later
Bump `version` in `tizen/config.xml`, re-run the build/install commands above.
Keep the same certificate profile — updates must be signed by the same author.
App storage (your location config) survives updates.

## Using the TV remote in the app

- **On the board:** press **OK/Enter** to open Settings. **BACK** exits the app.
- **In Settings:** up/down arrows move between fields, left/right move between
  the buttons (amber outline on fields, white ring on buttons shows focus).
  **OK** opens the on-screen keyboard on a field. Decimal commas are fine
  (`64,13` = `64.13`). **BACK** returns to the board without saving; START
  applies and returns to the board.

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
