# Physical Device Reliability Protocol

Objective (roadmap §15): prove SmartJourney can reliably wake a sleeping traveler
during a long real-world journey while the phone is **locked** and the app is
**backgrounded**.

Emulator results are recorded separately in `docs/testing/simulator-results.md`.
An emulator cannot prove this objective: it does not Doze, does not have a real
battery optimizer, and does not have an OEM background-kill policy. Only hardware
does.

---

## 1. Test vehicle

Use a **release** build, not a debug build.

| | debug APK | release APK |
|---|---|---|
| JS source | Metro over `adb reverse` | bundle embedded in APK |
| `__DEV__` | `true` | `false` |
| Dev simulator screen | present | excluded |
| Doze behaviour | not representative | representative |

Rationale:

- There is **no `expo-dev-client`** in this project, so a debug APK loads its JS
  from Metro. If the Metro connection drops while the phone is asleep, the app
  dies — that would be an artefact of the test rig, not a product defect.
- The release APK embeds the Hermes bundle, so the app runs standalone with no
  host machine involved.
- `__DEV__` is `false`, so `DevSimulatorScreen` and its `__DEV__`-gated tile are
  absent. Only the real GPS pipeline runs.
- `android.enableMinifyInReleaseBuilds` defaults to **false**, so R8 does not
  strip anything — no reflection-stripping risk for notifee.

Both build types sign with `android/app/debug.keystore`, so the release APK
installs without extra signing setup.

### Build

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-21.0.10'   # not the stale JAVA_HOME
$env:ANDROID_HOME = 'C:\Users\bsdk\AppData\Local\Android\Sdk'
cd 'C:\my folder\projects\gps alarm\SmartJourney\android'
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain
```

Output: `android\app\build\outputs\apk\release\app-release.apk`

`reactNativeArchitectures` in `gradle.properties` lists `armeabi-v7a,arm64-v8a,x86,x86_64`,
but the emulator APK was built `x86_64`-only. Restrict to `arm64-v8a` for the
phone; verify the device ABI first (below).

---

## 2. Preconditions

### Device visible to adb

```powershell
adb devices -l
```

Expect a line ending in `device`. If the list is empty or the state is
`unauthorized`:

- **`unauthorized`** — accept the "Allow USB debugging" prompt on the phone.
- **empty list** — USB debugging is off, or the cable is charge-only. On the
  phone: Settings → About phone → tap *Build number* 7×, then
  Settings → System → Developer options → **USB debugging** on. Set the USB mode
  to *File transfer / MTP* rather than *Charging only*.
- Wireless alternative: Developer options → **Wireless debugging** → *Pair device
  with pairing code*, then `adb pair <ip>:<port>` and `adb connect <ip>:<port>`.

> A phone with USB debugging off does **not** appear in `adb devices` at all, and
> leaves no ADB interface in the Windows device tree. Absence from the list plus
> absence of an `AndroidUsbDeviceClass` interface means debugging is off — not a
> driver fault.

### Confirm ABI

```powershell
adb shell getprop ro.product.cpu.abi
```

Expect `arm64-v8a`. If it returns `armeabi-v7a`, rebuild without the
`-PreactNativeArchitectures` override.

### Install

```powershell
adb install -r 'C:\my folder\projects\gps alarm\SmartJourney\android\app\build\outputs\apk\release\app-release.apk'
adb shell pm grant com.smartjourney.app android.permission.POST_NOTIFICATIONS
```

---

## 3. Permission and power setup

Open the app and use the in-app **Permissions Center**. It reports live status for
location services, foreground location, background location, notifications and
battery optimization. Every row must read ready.

Background location cannot be granted from adb on modern Android; it must be
granted from the UI. On Android 11+ the user must choose **Allow all the time** on
the location permission dialog.

Then check the alarm-readiness banner is green, and confirm battery optimization
exemption:

```powershell
adb shell dumpsys deviceidle whitelist | Select-String smartjourney
```

On aggressive OEM skins (Xiaomi/MIUI, Oppo/ColorOS, Vivo, Samsung) also enable
**Autostart** for SmartJourney. Battery-optimization exemption alone does not
survive those vendors' own background killers.

---

## 4. Behaviour under test (from source)

Arrival and escalation logic, as implemented:

- **Stage 2 fires at `1.5 × wakeDistance`**, once per journey
  (`LocationService.evaluateAlarms`, `hasTriggeredGentleAlert`).
- **Arrival at `distance ≤ wakeDistance`** → record history, stop tracking, fire
  Stage 3.
- With **POOR confidence**, arrival needs `LOW_CONFIDENCE_CONFIRMATIONS = 2`
  consecutive in-range readings before Stage 3 (false-positive guard).
- Escalation after Stage 3 is driven by JS timers inside `AlarmService`:
  - Stage 3 → 4 at **+90 s** (`ESCALATION_TO_MAX_MS`)
  - Stage 4 → 5 at **+180 s** (`ESCALATION_TO_EMERGENCY_MS`)
  - Stage 5 re-fires siren + vibration every **+60 s** (`EMERGENCY_REPEAT_MS`)
- Runtime watchdog checks native tracking liveness every **60 s**
  (`WATCHDOG_INTERVAL_MS`).

Wake distance is set in journey setup: **0.5–20 km in 0.5 km steps, default 2.0 km.**
Its minimum of 0.5 km is what makes desk testing possible — a destination within
500 m triggers arrival without moving.

### Notification signatures

| Stage | Notification id | Title | Channel |
|---|---|---|---|
| 1 | `smartjourney_reminder` | `Journey Started` | `smartjourney_stage1_channel` |
| 2 | `smartjourney_gentle` | `Approaching Destination` | `smartjourney_stage2_channel` |
| 3 | dynamic alarm id | `Wake Up!` | `smartjourney_alarm_channel` |
| 4 | *(same id — replaces 3)* | `MAXIMUM ALARM` | `smartjourney_alarm_channel` |
| 5 | *(same id — replaces 4)* | `EMERGENCY MODE` | `smartjourney_alarm_channel` |

**Stages 3, 4 and 5 reuse one notification id, so each overwrites the last.** A
`dumpsys notification` dump taken after the fact shows only the newest title. To
evidence the escalation you must **poll during the alarm**, not dump afterwards.
This is the single most important instrument detail in this protocol.

---

## 5. Scenarios

Each scenario lists its goal, setup, steps, expected result and the evidence to
capture. Record outcomes in §7.

### T1 — Alarm fires with screen locked and app backgrounded

*Goal: the baseline wake-up works at all under a locked screen.*

1. Search a destination **within 500 m** of your current position.
2. Start tracking with wake distance **0.5 km**.
3. Turn the screen off with the power button.
4. Wait. Do not touch the phone.

Expected: Stage 1 `Journey Started` posts at start; Stage 3 `Wake Up!` fires with
siren + vibration within a poll interval or two (≤ 30 s) of the first fix; the
screen wakes and shows the full-screen alarm.

Evidence:

```powershell
adb shell dumpsys notification --noredact | Select-String 'smartjourney|Wake Up|Journey Started'
adb shell dumpsys activity services com.smartjourney.app | Select-String 'ServiceRecord|isForeground'
```

### T2 — Escalation survives Doze *(headline scenario)*

*Goal: prove the §15 objective. This is the scenario the emulator cannot run.*

The escalation timers are JS `setTimeout`/`setInterval`. Under Doze the CPU is
suspended and JS timers do not advance. Whether Stage 3 → 4 → 5 still land on
schedule while the device is idle is exactly the open question.

1. Set up as T1 (destination within 500 m, wake distance 0.5 km) so arrival
   triggers quickly.
2. Confirm Stage 3 fired, then immediately force Doze:

```powershell
adb shell dumpsys battery unplug
adb shell dumpsys deviceidle force-idle
adb shell dumpsys deviceidle | Select-String 'mState'
```

3. Poll the notification every 15 s for 5 minutes, noting wall-clock time of each
   title change:

```powershell
1..20 | ForEach-Object {
  $t = Get-Date -Format 'HH:mm:ss'
  $n = (adb shell dumpsys notification --noredact | Select-String 'Wake Up!|MAXIMUM ALARM|EMERGENCY MODE' | Select-Object -First 1)
  "$t  $n"
  Start-Sleep -Seconds 15
}
```

4. When finished:

```powershell
adb shell dumpsys deviceidle unforce
adb shell dumpsys battery reset
```

Expected (target): `Wake Up!` at T+0, `MAXIMUM ALARM` at T+90 s (±15 s),
`EMERGENCY MODE` at T+180 s (±15 s), then continued siren re-fires every 60 s.

Pass criteria: the stage-4 title appears within **90 s + 30 s**, and stage 5
within **180 s + 30 s**, with the device in `mState=IDLE` throughout.

If the escalation stalls under Doze, that is a Phase-1 defect: JS timers are not a
valid escalation clock for a sleeping device, and the fix belongs in
`AlarmService` (for example `notifee` trigger notifications, or an
`AlarmManager`-backed native timer) rather than in a `setTimeout`.

### T3 — Long soak with no movement (Doze survival)

*Goal: tracking must not silently die during a long idle stretch.*

1. Search a destination **far away** (50 km+) so no alarm interferes.
2. Start tracking; wake distance any value.
3. Screen off, phone on a desk, untouched.

Expected: foreground service stays alive; the watchdog never reports interruption;
no `trackingInterrupted` banner appears on return. Adaptive polling should sit in
the `> 50 km` tier at 60 s / 1000 m.

Evidence after 30–60 min:

```powershell
adb shell dumpsys activity services com.smartjourney.app
adb shell dumpsys deviceidle | Select-String 'mState'
adb shell dumpsys notification --noredact | Select-String 'smartjourney'
```

Then open the app and confirm the Home screen shows **no** interrupted banner, and
that the live remaining distance is recent rather than stale.

### T4 — Battery saver / restricted background

*Goal: the alarm must work when Android is actively hostile.*

1. Turn on **Battery saver**, and set the app to **Restricted** under
   Settings → Apps → SmartJourney → Battery.
2. Repeat T1, then the T2 escalation poll.

Expected: same as T1/T2. Any degradation here is a real-world failure mode for a
traveler on a low battery, which is precisely when this app matters most.

### T5 — Approach alert fires and full alarm does not

*Goal: Stage 2 must warn without waking the whole carriage.*

1. Choose a destination **between 500 m and 750 m** away (inside `1.5 × 0.5 km`,
   outside the 0.5 km arrival radius).
2. Start tracking, wake distance 0.5 km, screen off.

Expected: `Approaching Destination` posts; vibration pattern `[300,500,300,800]`
fires; **no** `Wake Up!` notification, no siren.

Note: if the destination sits just outside 750 m the alert legitimately will not
fire — that is the designed threshold, not a bug.

### T6 — Interruption recovery

*Goal: a killed app must not lose the journey.*

1. Start a journey, then force-stop the app:

```powershell
adb shell am force-stop com.smartjourney.app
adb shell am start -n com.smartjourney.app/.MainActivity
```

2. Alternatively reboot the phone and relaunch.

Expected: Home screen shows the recovery banner; **Resume** restores tracking with
the original destination, wake distance and `startedAt`; **Discard** clears it and
records nothing.

Known gap to watch: `RECEIVE_BOOT_COMPLETED` is declared in `app.json` but no boot
receiver exists, so a reboot will **not** auto-resume tracking. Recovery after
reboot therefore only works once the user reopens the app. Confirm the banner
appears on manual relaunch and record whether auto-resume after reboot is
required.

### T7 — Real journey (the actual objective)

*Goal: the end-to-end claim in §15.*

Travel by train, bus or car with the phone **locked in a pocket or bag** for a real
journey. Destination set to the real stop, wake distance 0.5–2 km, transport mode
matching (Transit for rail/bus).

Expected: the phone wakes you before the stop, with the alarm loud enough to rouse
a sleeping traveler.

Record honestly: did you wake up, how many minutes before arrival the alarm fired,
and whether the escalation reached stage 4/5 because the first alarm did not wake
you. The staged escalation exists precisely to handle the case where stage 3 alone
fails to wake a deep sleeper — T7 is the only scenario that validates that design
intent.

---

## 6. Evidence capture cheat-sheet

```powershell
# device + build identity
adb devices -l
adb shell getprop ro.build.version.release
adb shell getprop ro.product.cpu.abi
adb shell dumpsys package com.smartjourney.app | Select-String versionName

# notifications (per-stage titles)
adb shell dumpsys notification --noredact | Select-String 'smartjourney|Wake Up|MAXIMUM|EMERGENCY|Approaching|Journey Started'

# tracking foreground service
adb shell dumpsys activity services com.smartjourney.app

# Doze state
adb shell dumpsys deviceidle | Select-String 'mState'

# battery optimization exemption
adb shell dumpsys deviceidle whitelist | Select-String smartjourney

# battery saver state
adb shell settings get global low_power

# crash / native noise
adb logcat -d -t 400 | Select-String 'smartjourney|AndroidRuntime|FATAL|notifee|ReactNativeJS'
```

Screenshots at the moment of the alarm are the most convincing single artefact:

```powershell
adb exec-out screencap -p > "$env:USERPROFILE\Desktop\sj-alarm-stage3.png"
```

On a release build `ReactNativeJS` console output may be absent; rely on
notifications, the foreground service dump, and the visible UI instead.

---

## 7. Results

Fill this in as scenarios complete. Record the device model and Android version,
since Doze and OEM kill policy vary enormously by vendor.

Device: `________________`  Android: `________`  ABI: `________`

| Scenario | Goal | Result | Notes / measured timings |
|---|---|---|---|
| T1 | alarm with screen locked, app backgrounded | ☐ pass ☐ fail | |
| T2 | escalation under forced Doze | ☐ pass ☐ fail | stage 4 at +___s, stage 5 at +___s |
| T3 | 30–60 min Doze soak, tracking survives | ☐ pass ☐ fail | |
| T4 | battery saver / restricted background | ☐ pass ☐ fail | |
| T5 | approach alert without full alarm | ☐ pass ☐ fail | |
| T6 | force-stop / reboot recovery | ☐ pass ☐ fail | |
| T7 | real journey — traveler actually woken | ☐ pass ☐ fail | woke ___ min before arrival |

§15 is satisfied only when T2, T3 and **T7** pass on hardware. T7 is the claim
being made; the rest are the mechanisms that make it true.
