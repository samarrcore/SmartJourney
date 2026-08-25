# Physical Device Test Plan — Restriction Matrix

Covers the last open Phase 1 objective: locked-screen, Doze, battery-saver and
OEM process-death behavior on real hardware. Scenario numbering continues the
spirit of `simulator-results.md`; every scenario here uses the REAL native
location stack (no simulator — it does not exist in release builds anyway).

Reference device: Nothing Phone (2a) (model `A142`), Nothing OS / Android 16
(API 36), serial `00055349D002661`. Commands are PowerShell + adb from repo
root. Nothing OS is near-stock; the OEM-specific knobs are per-app battery
mode and the Android 15+ "pause app activity if unused" toggle (§0.3).

---

## 0. One-time device preparation

### 0.1 Build & install (already done by prep script if APK is fresh)

```powershell
.\gradlew.bat assembleRelease --console=plain
adb install -r android\app\build\outputs\apk\release\app-release.apk
```

### 0.2 Permissions & OS grants

```powershell
adb shell pm grant com.smartjourney.app android.permission.ACCESS_FINE_LOCATION
adb shell pm grant com.smartjourney.app android.permission.ACCESS_COARSE_LOCATION
adb shell pm grant com.smartjourney.app android.permission.ACCESS_BACKGROUND_LOCATION
adb shell pm grant com.smartjourney.app android.permission.POST_NOTIFICATIONS
adb shell cmd notification allow_dnd com.smartjourney.app   # Stage 3+ bypasses Do Not Disturb
adb shell dumpsys deviceidle whitelist +com.smartjourney.app # exempt from Doze (Scenario C re-tests WITHOUT this)
```

Then open the app once and confirm in **Permissions Center** that every card
reads Granted/Active. The live reliability center is itself a test instrument
during the scenarios below.

### 0.3 Nothing OS OEM settings (manual, ~2 minutes)

Nothing Phone (2a) runs near-stock Android; the aggressive paths are per-app
battery restriction and the unused-app pausing toggles. For the "friendly"
baseline scenarios, relax all of them first; Scenario E re-tightens them one
at a time.

| Setting | Path (Nothing OS / Android 16) | Set to |
|---|---|---|
| App battery usage | Settings › Apps › See all apps › SmartJourney › App battery usage | **Unrestricted** |
| Remove permissions if unused | same screen › (under App battery usage) | **Off** |
| Pause app activity if unused | same screen (if the toggle exists on this OS build) | **Off** |
| Adaptive battery / battery saver | Settings › Battery | Off during baseline |
| Do Not Disturb | quick settings | Off during baseline |

### 0.4 Evidence capture helpers

```powershell
# Start a filtered logcat capture for the whole session (run in a 2nd terminal)
adb logcat -c; adb logcat -v time ReactNativeJS:V LocationService:V *:S > evidence-logcat.txt
#   ^ also grep the full buffer after each scenario instead:
adb logcat -d | Select-String "Native tracking died|Background Location Task Error|FATAL|ReactNativeJS"

# Notification state (which stage is posted?)
adb shell dumpsys notification --noredact | Select-String "smartjourney|Wake Up|MAXIMUM|EMERGENCY" -Context 0,2

# Is the foreground service alive?
adb shell dumpsys activity services com.smartjourney.app

# Screenshot for the evidence folder
adb shell screencap -p /sdcard/sj.png; adb pull /sdcard/sj.png evidence-<name>.png
```

---

## Scenario A — Baseline real-GPS journey (control)

**Goal:** prove the full pipeline works on real GPS before stressing it.

1. Outdoors or near a window. Start journey to a real place **800 m–1.5 km**
   away (search by name, or drop a pin on the map). Wake distance: **500 m**.
2. Confirm: tracking notification "SmartJourney Tracking" appears; Live
   Journey shows remaining distance converging and confidence ≥ 80 %.
3. Walk/drive toward the destination.
   - At ≤ 750 m: **Stage 2 gentle alert** notification (once).
   - At ≤ 500 m: **Stage 3 ALARM** — full-screen notification over anything
     on screen, looping siren audible, vibration on.
   - Wait 90 s untouched: title escalates to **MAXIMUM ALARM** (Stage 4).
4. Tap **Stop Alarm**. Verify History shows a **Completed** entry.

**Pass:** all four stages observed in order; no crash; history recorded.
**Evidence:** `dumpsys notification` output at stage 2/3/4 + screenshot of
history row.

---

## Scenario B — Locked screen arrival

**Goal:** the alarm must defeat the lock screen.

1. Repeat Scenario A but **lock the phone (power button) as soon as gentle
   alert fires** (screen OFF, not just locked app view).
2. Keep moving to within 500 m.
3. Expected: full-screen alarm intent lights the screen OVER the lockscreen,
   siren plays with screen off, vibration continuous.

**Pass:** screen turns on by itself showing the alarm; siren audible; Stop
Alarm button reachable on the lock screen.
**Evidence:** photo/screen-recording of lockscreen alarm + logcat line showing
`triggerAlarm` (ReactNativeJS) while screen was off (`dumpsys power | Select-String "mHoldingDisplay"` before/after).

---

## Scenario C — Doze

**Goal:** verify watchdog + reconciliation handle Doze-induced tracking death.

> Run this with the app **removed** from the doze whitelist to make Doze
> aggressive: `adb shell dumpsys deviceidle whitelist -com.smartjourney.app`

1. Start a journey to a destination ~3 km away (wake 500 m). Screen ON.
2. Force the device into Doze and let it dwell:
   ```powershell
   adb shell dumpsys battery unplug
   adb shell dumpsys deviceidle force-idle
   adb shell dumpsys deviceidle          # confirm state = IDLE
   ```
3. Leave it 5 minutes (screen off helps). Then check whether tracking died:
   ```powershell
   adb shell dumpsys activity services com.smartjourney.app
   adb logcat -d | Select-String "Native tracking died mid-journey"
   ```
4. Exit Doze and restore power reporting:
   ```powershell
   adb shell dumpsys deviceidle unforce
   adb shell dumpsys battery reset
   ```

**Pass (either acceptable, record which):**
- Tracking **survived** Doze (foreground service still listed), OR
- Watchdog flagged it within ~60 s of death: logcat shows
  `Native tracking died mid-journey`, and opening the app shows the
  **Interrupted banner** with Resume/Discard.
5. If interrupted: press **Resume Tracking**, confirm banner clears,
   `dumpsys activity services` shows the service again, and distance updates.

**Evidence:** deviceidle state dumps before/after, logcat watchdog line,
screenshot of banner (if shown).

---

## Scenario D — Battery saver

**Goal:** alarm still fires with power restrictions active.

```powershell
adb shell settings put global low_power 1     # enable battery saver
adb shell dumpsys power | Select-String "low_power"   # verify true
```

1. With battery saver ON, repeat the Scenario A approach (screen unlocked).
2. Watch polling behavior degrade gracefully (updates slower) but the alarm
   chain still completes: gentle → alarm → escalation.
3. Restore: `adb shell settings put global low_power 0`

**Pass:** alarm fired under battery saver; no crash; confidence tier visible
and not stuck on "Waiting for fix" for > 5 minutes of movement.
**Evidence:** notification dump + Live Journey screenshot showing stats while
saver was on.

---

## Scenario E — OEM process death (the real killer)

**Goal:** prove the reconciliation + Resume/Discard flow survives murder.

### E1. adb process kill (deterministic proxy)

1. Start a journey (any destination ≥ 2 km). Verify service alive.
2. Send the app to the background (home button).
3. Kill the process:
   ```powershell
   adb shell am kill com.smartjourney.app          # graceful-ish
   # or the harsher variant:
   adb shell am force-stop com.smartjourney.app
   ```
4. Relaunch the app from the launcher.
5. Expected on launch: startup reconciliation detects
   `isTrackingActive=true` + native tracking dead → **Interrupted banner**
   with Resume / Discard on Home; Permissions Center shows
   "Interrupted - resume from Home".

**Pass:** banner shown; **Resume Tracking** restarts the native service
(`dumpsys activity services` lists it again) and clears the banner;
**Discard** (test on a second run) clears journey state and history records a
**Cancelled** entry.

### E2. Nothing OS / Android-native kill (manual)

1. Start a journey, lock the phone, wait 10 minutes with battery mode back to
   **Optimized** (undo §0.3 rows one at a time across runs to isolate the
   culprit — start with "Unrestricted → Optimized", then try "Pause app
   activity if unused" ON).
2. Unlock and check: service alive? If dead, did the Interrupted banner
   appear on next launch? Record which setting killed it.
3. Repeat with **Unrestricted** battery — service must survive ≥ 30 min
   screen-off.
4. Worst case, set App battery usage to **Restricted** and repeat the 10 min
   screen-off soak — this is the closest analogue to the harshest OEM
   behavior on this device.

**Pass:** every death path ends in a visible Interrupted banner, never in a
silently-dead journey (that is the watchdog contract).

---

## Scenario F — Screen-off soak (compressed overnight proxy)

**Goal:** battery + survival under realistic overnight conditions.

1. Note battery %: `adb shell dumpsys battery | Select-String level`
2. Start journey to a far destination (no alarm expected), lock phone, leave
   **30 minutes** (overnight proxy; scale results ×16 for 8 h).
3. Unlock; check battery delta, service alive, no errors:
   ```powershell
   adb shell dumpsys battery | Select-String level
   adb logcat -d | Select-String "FATAL|Background Location Task Error"
   ```
   (For a precise app-only figure: `adb shell dumpsys batterystats --reset`
   before, `--charged com.smartjourney.app` after.)

**Pass:** service alive, crash-free log, projected 8 h drain < ~10 %
(6 % PRD target is the stretch goal; record the number either way).

---

## Results log template

Append one row per run to `docs/testing/physical-device-results.md`:

| # | Scenario | Build/commit | Setting under test | Expected | Actual | Result | Evidence file |
|---|----------|--------------|--------------------|----------|--------|--------|---------------|
| A1 | Baseline |  | — |  |  |  |  |
