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

### 0.1 Build & install

Use a **release** build, not a debug one. There is no `expo-dev-client` in this
project, so a debug build loads its JS from Metro over `adb reverse`; if that link
drops while the phone sleeps, the app dies — an artefact of the test rig rather
than a product defect. A release APK embeds its Hermes bundle and runs standalone,
and `__DEV__` is false so the dev simulator screen does not exist.
`android.enableMinifyInReleaseBuilds` defaults to false, so R8 strip risk is nil.

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-21.0.10'   # the inherited JAVA_HOME points at a missing JDK
$env:ANDROID_HOME = 'C:\Users\bsdk\AppData\Local\Android\Sdk'
npx expo prebuild -p android --no-install   # app.json is the source of truth; android/ is gitignored
cd android
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain
cd ..
adb install -r android\app\build\outputs\apk\release\app-release.apk
```

`reactNativeArchitectures` defaults to all four ABIs (gradle.properties); pinning
`arm64-v8a` matches the reference device and roughly quarters native build time.
Confirm with `adb shell getprop ro.product.cpu.abi` first.

Known gap: the Maps key in `app.json` is the literal string
`PLACEHOLDER_REPLACE_WITH_REAL_GOOGLE_MAPS_API_KEY`, so `DestinationSearchScreen`
and `LiveJourneyScreen` render a blank map. Search, the results list and the live
stats all still work, so this does not block the scenarios below — but the alarm
app is not shippable until a real key is in place.

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

### 0.2b If the device is not visible to adb

`adb devices` showing an empty list is the usual first obstacle. Diagnose in this
order:

| Symptom | Cause | Fix |
|---|---|---|
| empty list | USB debugging off | About phone → tap *Build number* 7× → Developer options → **USB debugging** ON |
| empty list | charge-only cable/mode | set USB mode to *File transfer (MTP)* |
| `unauthorized` | host key not accepted | accept the *Allow USB debugging* prompt on the phone |
| empty list, no ADB interface | driver not bound | check for an `AndroidUsbDeviceClass` interface in the Windows device tree |

A phone with USB debugging OFF does not appear in `adb devices` **at all**, and
leaves no ADB interface behind. So an empty list plus the absence of any
`AndroidUsbDeviceClass` entry means debugging is off on the device — it is not a
host driver fault, and reinstalling drivers will not help.

Beware of misreading the USB tree: vendor IDs shared with phone ODMs (for example
`VID_0489` = Foxconn/FIH) are also used by unrelated peripherals. On this machine
`VID_0489&PID_E0F6&MI_00` is the host's own *MediaTek Bluetooth Adapter*, not a
phone. Confirm with the interface descriptor before concluding anything.

Wireless alternative when no cable is available: Developer options →
**Wireless debugging** → *Pair device with pairing code*, then
`adb pair <ip>:<port>` followed by `adb connect <ip>:<port>`. Verify reachability
with `adb mdns services`.

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
#   WARNING: stages 3, 4 and 5 all reuse ONE notification id (the dynamic alarm
#   id), so each title OVERWRITES the previous one. A dump taken after the fact
#   shows only the newest stage. To evidence the 90 s / 180 s escalation you must
#   POLL while the alarm is ringing, not dump afterwards.
adb shell dumpsys notification --noredact | Select-String "smartjourney|Wake Up|MAXIMUM|EMERGENCY" -Context 0,2

# Poll loop that timestamps each stage transition (the only valid escalation evidence)
1..20 | ForEach-Object {
  $t = Get-Date -Format HH:mm:ss
  $n = adb shell dumpsys notification --noredact | Select-String 'Wake Up!|MAXIMUM ALARM|EMERGENCY MODE' | Select-Object -First 1
  "$t  $n"
  Start-Sleep -Seconds 15
}

# Is the foreground service alive?
adb shell dumpsys activity services com.smartjourney.app

# Screenshot for the evidence folder
adb shell screencap -p /sdcard/sj.png; adb pull /sdcard/sj.png evidence-<name>.png
```

---

## Behaviour reference (read before interpreting any result)

Values below are read from source, so a scenario result can be judged against what
the code actually promises. This matters because several thresholds are
non-obvious — notably that Stage 2 fires at **1.5 ×** the wake distance.

**Wake distance** (`JourneySetupScreen`, `useJourneyStore`): 0.5–20 km in 0.5 km
steps, default **2.0 km**. The store default is 500 m, but journey setup always
overwrites it when *Start Tracking* is pressed, so the UI value is authoritative.

**Arrival decision** (`LocationService.evaluateAlarms`):

| Condition | Effect |
|---|---|
| `distance ≤ wakeDistance × 1.5` | Stage 2 gentle alert — **once** per journey (`hasTriggeredGentleAlert`) |
| `distance ≤ wakeDistance` | arrival: history recorded `completed`, tracking stops, Stage 3 fires |
| `distance ≤ wakeDistance` **and** confidence POOR | needs `LOW_CONFIDENCE_CONFIRMATIONS = 2` **consecutive** in-range readings before Stage 3 |

Falling back outside the radius resets the in-range counter, so a flapping fix near
the boundary delays the alarm by one poll per reset. Expect this near the
threshold — it is the false-positive guard working, not a stall.

**Confidence** (`ConfidenceEngine`): weighted sum — accuracy 50, speed sanity 20,
movement consistency 15, freshness 10, battery 5. Tiers: **GOOD ≥ 80**,
**DEGRADED ≥ 50**, **POOR < 50**. A physically impossible speed (> 2× the mode
ceiling, i.e. speed sanity scoring 0) caps the total at **40 → POOR**, so a GPS
glitch cannot masquerade as a clean fix.

`MAX_PLAUSIBLE_SPEED` (m/s): walking 3, cycling 20, driving 70, transit 90. Set the
transport mode to match how you are actually travelling — an understated ceiling
turns legitimate motion into "impossible" and forces POOR confidence.

Only **transit** and **driving** are selectable in journey setup.

**Adaptive polling** (`LocationService.adaptPollingInterval`):

| Remaining distance | Interval | Distance filter |
|---|---|---|
| > 50 km | 60 s | 1000 m |
| > 10 km | 30 s | 500 m |
| > 2 km | 15 s | 100 m |
| ≤ 2 km | 5 s | 10 m |

So a long journey legitimately produces sparse updates (one fix a minute); a
"stale-looking" Live Journey screen at 60 km out is by design, not a defect.

**Watchdog**: `WATCHDOG_INTERVAL_MS = 60_000` — native tracking liveness is
re-checked every 60 s.

**Notification signatures:**

| Stage | Notification id | Title | Channel |
|---|---|---|---|
| 1 | `smartjourney_reminder` | `Journey Started` | `smartjourney_stage1_channel` |
| 2 | `smartjourney_gentle` | `Approaching Destination` | `smartjourney_stage2_channel` |
| 3 | dynamic alarm id | `Wake Up!` | `smartjourney_alarm_channel` |
| 4 | *same id — replaces 3* | `MAXIMUM ALARM` | `smartjourney_alarm_channel` |
| 5 | *same id — replaces 4* | `EMERGENCY MODE` | `smartjourney_alarm_channel` |

Stages 3–5 sharing one id is why escalation must be polled live (§0.4).

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

   > The watchdog reports via `console.error` (`LocationService.ts:541`). On a
   > **release** build JS console output may not reach logcat at all, so treat
   > logcat as a bonus signal and the **Interrupted banner** as authoritative.
   > Establish early whether `ReactNativeJS` lines appear in logcat on this build;
   > if they do not, do not fail a scenario merely because the log line is absent.
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

## Scenario C2 — Escalation clock under Doze (the §15 risk)

**Goal:** prove the 90 s / 180 s escalation still fires while the device is idle.

`AlarmService` drives stages 3 → 4 → 5 with plain JS `setTimeout` / `setInterval`
(`ESCALATION_TO_MAX_MS = 90_000`, `ESCALATION_TO_EMERGENCY_MS = 180_000`,
`EMERGENCY_REPEAT_MS = 60_000`). Doze suspends the CPU and JS timers do not
advance while it does. Whether escalation survives Doze is the most important open
question in Phase 1, and no emulator run can answer it.

Scenario C asks *"did tracking survive Doze?"* — a different question. Run both.

1. Get Stage 3 ringing, then force Doze **while the alarm sounds**:

   ```powershell
   adb shell dumpsys battery unplug
   adb shell dumpsys deviceidle force-idle
   adb shell dumpsys deviceidle | Select-String "mState"
   ```

2. Poll the notification title every 15 s for 5 minutes using the loop in §0.4,
   recording the wall-clock time of each transition. **Polling is mandatory** —
   stages 3/4/5 share one notification id, so a post-hoc dump proves nothing.

3. Restore:

   ```powershell
   adb shell dumpsys deviceidle unforce
   adb shell dumpsys battery reset
   ```

**Pass:** `MAXIMUM ALARM` within 90 s + 30 s of `Wake Up!`, and `EMERGENCY MODE`
within 180 s + 30 s, with `mState=IDLE` throughout.

**Fail = Phase 1 defect.** If escalation stalls under Doze, a JS timer is not a
valid escalation clock for a sleeping device; the fix belongs in `AlarmService`
(notifee trigger notifications, or an `AlarmManager`-backed native timer), not in
a longer `setTimeout`. Record actual timings either way — this is the measurement
`simulator-results.md` explicitly could not provide.

**Evidence:** timestamped poll log, `mState` dumps, screenshot of each stage title.

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

## Scenario G — Real journey (the actual §15 claim)

**Goal:** the end-to-end claim itself — wake a sleeping traveler on a real trip.

Every scenario above is a mechanism test run at a desk. None of them is the
objective. §15 says *"reliably wake a sleeping traveler during a long real-world
journey while the phone is locked and the application is backgrounded"*, and that
sentence is only proven by actually travelling.

1. Travel by train, bus or car with the phone **locked in a pocket or bag** for a
   real journey. Not on a desk, not on a charger.
2. Destination = the real stop. Wake distance 0.5–2 km. Transport mode matching
   (Transit for rail/bus) so `MAX_PLAUSIBLE_SPEED` and speed-sanity scoring are
   calibrated for the right mode.
3. Do not interact with the phone. If you are testing whether it can wake a
   *sleeping* person, actually sleep, or at minimum do not pre-empt the alarm.

**Pass:** the phone wakes you before the stop, loudly enough to rouse you.

Record honestly:

- Did it wake you at all?
- How many minutes before arrival did the first alarm fire?
- Did escalation reach Stage 4/5 because Stage 3 alone failed to wake you?

That last point is the design intent of the staged escalation — Stage 3 is a
best-effort wake, and Stages 4–5 exist precisely for when it is not enough. A run
where you slept through Stage 3 but were woken by Stage 4 is a **pass for the
product and a data point about Stage 3**, not a failure. Capture the stage timings
with the §0.4 poll loop running on a second device or afterwards from the
notification dump.

**Evidence:** notification poll log, battery delta, and a note of which stage
actually woke you.

---

## Results log template

Append one row per run to `docs/testing/physical-device-results.md`:

| # | Scenario | Build/commit | Setting under test | Expected | Actual | Result | Evidence file |
|---|----------|--------------|--------------------|----------|--------|--------|---------------|
| A1 | Baseline |  | — |  |  |  |  |
