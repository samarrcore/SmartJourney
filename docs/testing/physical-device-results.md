# Physical Device Results — Nothing Phone (2a)

First hardware run of the restriction matrix in `physical-device-test-plan.md`.
Emulator results are in `simulator-results.md`; this file is hardware only.

## Build and device identity

| | |
|---|---|
| Device | Nothing Phone (2a), model `A142`, serial `00055349D002661` |
| OS | Android 16 (API 36), Nothing OS |
| ABI | `arm64-v8a` |
| App | `com.smartjourney.app`, release build, signed with the debug keystore |
| Build | `assembleRelease -PreactNativeArchitectures=arm64-v8a`, 39.4 MB, arm64-v8a only |
| Date | 2026-09-10 |

The build is a **release** APK by design: there is no `expo-dev-client` in this
project, so a debug build would load its JS from Metro over `adb reverse`, and a
dropped link would kill the app and masquerade as a product defect. `__DEV__` is
false, so the dev simulator screen does not exist and only the real GPS pipeline
runs.

## Preparation verification — all passed

| Check | Result |
|---|---|
| Install | `Success` (streamed) |
| `ACCESS_FINE_LOCATION` | `granted=true` (user 0) |
| `ACCESS_BACKGROUND_LOCATION` | `granted=true` (user 0) |
| `POST_NOTIFICATIONS` | `granted=true` |
| Doze whitelist | `user,com.smartjourney.app,10311` |
| DND bypass | `cmd notification allow_dnd` applied; alarm channel reports `mBypassDnd=true` |
| Foreground service | `LocationTaskService`, `isForeground=true`, `types=0x00000008` (LOCATION) |
| Notification channels | stage1 (imp 3), stage2 (imp 4, vibrate `[300,500]`), alarm (imp 4, no sound, `mBypassDnd=true`) |
| App renders | Yes — icon glyph nodes present, so the `useFonts` MaterialCommunityIcons fix works |
| Confidence display | Correctly showed POOR with "Alarm waits for confirmation." |
| Location providers | `location_mode=3` (high accuracy) |

## Scenario C — Doze survival: PASS

Tracking survived 10 minutes of forced deep Doze while the app was backgrounded.

| | |
|---|---|
| Journey | Kashmir (far destination, no alarm expected) |
| Window | 17:30:55 → 17:41:00 (11 samples at 60 s) |
| Method | `dumpsys battery unplug` + `dumpsys deviceidle force-idle` |

Every one of the 11 samples reported `mState=IDLE mLightState=OVERRIDE`, the
`LocationTaskService` present, `pid` unchanged, and both journey notifications
still posted. No watchdog trip, no JS error, no fatal. Afterwards
`dumpsys deviceidle unforce` returned `mState=ACTIVE` with the journey intact.

### The run is self-validated

"Nobody touched the phone" was verified from the captured log rather than assumed:

| Validation check | Count |
|---|---|
| Physical (non-injected) input events during the window | **0** |
| Times `MainActivity` reached `state:RESUMED` | **0** |
| Watchdog trips / JS errors / fatal exceptions | **0** |

`isInjected=false` distinguishes a real key press from an adb-injected one, which
is what makes this conclusive.

### Deviations

- **The screen was not off.** The intended `input keyevent 26` did not take
  because the notification shade had focus; `mWakefulness` read `Awake` at start
  and `Dreaming` (AOD) at the end. This validates *app backgrounded + Doze*, not
  *screen fully off + Doze*.
- **The device was USB-charging** throughout (`battery unplug` only fakes the
  source for Doze), so drain could not be measured; Scenario F is still outstanding.

## Scenario B — locked-screen arrival: PASS

This is the clause of §15 that had not yet been demonstrated: the alarm reaching a
phone that is **locked** as well as backgrounded.

Setup: journey to "Irungalur" (~1.1 km away) with the **default 2.0 km wake
distance** — a realistic configuration this time, not the artificial 20 km maximum
used elsewhere. Screen turned off and the keyguard confirmed showing *before* the
alarm, so nothing about the result depends on the app being visible.

| Time | Event |
|---|---|
| 18:19:33 | Start Tracking; screen off, `mWakefulness=Dozing`, `isKeyguardShowing=true` |
| 18:19:39 | Stage 3 `Wake Up!` fired while still `Dozing` with the keyguard showing |
| 18:19:42 | `PowerManagerService: Waking up from Dozing (reason=WAKE_REASON_APPLICATION, details=com.android.systemui:full_screen_intent)` |
| 18:19:42+ | Screen `Awake` with the keyguard still up; the alarm surfaced over the lock screen |
| 18:20:15 | A second full-screen wake, from a re-post of the alarm notification |

The full-screen intent is what defeats the lock screen, and it works from deep
Doze. The alarm notification was visible on the lock screen itself
(`SmartJourney · now` in the lock-screen notification list).

`USE_FULL_SCREEN_INTENT` reads `default` with a `rejectTime`, which is expected
rather than a problem: Android suppresses full-screen intents while the screen is
already interactive, so only the locked / screen-off wake matters and that is the
one that worked.

This closes the last untested clause of §15's wording. What remains for §15 is
Scenario G — an actual journey that wakes an actual sleeping traveller.

## Run 1 — invalidated (recorded for honesty)

An earlier soak (17:16:12 → 17:26:16) is **not usable**. At 17:18:22 the log shows
a real key press and unlock:

```
interceptKeyBeforeQueueing event=KeyEvent{ keyCode=KEYCODE_WAKEUP, isInjected=false, deviceId=4 }
KeyguardViewMediator: keyguardDone / handleHide
MTK_APPList: com.smartjourney.app/.MainActivity, state:RESUMED
```

That is a physical unlock, not an injection; it brought the app to the foreground
and cancelled the journeys. Only ~2 minutes were backgrounded. Discarded.

## F2 fix — implemented and verified on hardware

### The defect

`evaluateAlarms` (and therefore `adaptPollingInterval`) is reachable **only**
through `handleLocationUpdate`, which fires only when a fix is delivered
(`LocationService.ts:97`; `:496` is simulator-only). The task was registered with
`distanceInterval: 10`, and expo-location maps that option to
`LocationRequest.setMinUpdateDistanceMeters`, which withholds updates until the
device has moved that far.

Consequence: on a **stationary** phone no fix is ever delivered, so arrival is
never evaluated. If tracking starts — or the phone comes to rest — while already
inside `wakeDistance`, **the alarm can never fire**. For a wake-up alarm this is
the worst possible failure.

### The fix

`applyTrackingConfig` now passes `distanceInterval: 0` (an explicit zero), leaving
updates purely time-driven so every interval re-checks the distance. The adaptive
tiers now differ only by interval (5/15/30/60 s).

**The first attempt at this fix was wrong and had to be redone.** Omitting
`distanceInterval` entirely does *not* mean "no filter": expo-location derives it
from the accuracy level
(`buildLocationParamsForAccuracy`: 50 m for `Accuracy.High`, 100 m for `Balanced`).
Omitting it silently replaced a 10 m gate with a 50 m one. This was caught on
hardware, not by review — see the before/after below.

### Verification (stationary phone, controlled configuration)

Destination = "Irungalur" (found by text search), wake distance raised to the
**20.0 km maximum** so that arrival must trigger without any movement. This is a
deliberately artificial configuration used to make the mechanism testable while
stationary; it is not a realistic user setting. The phone sat still on a desk
throughout, verified by the absence of input events.

| | Before fix (omitted `distanceInterval`) | After fix (`distanceInterval: 0`) |
|---|---|---|
| Tracking started | 17:53:13 | install + relaunch 17:56:09 |
| First fix delivered | **never** — screen read `-- km` / "Waiting for first location fix..." for 65 s+ | immediately |
| Polling tier selected | none | **`+5s0ms`** at 17:56:09.763 — the ≤2 km tier |
| Arrival | never | **yes** |
| Alarm | none | alarm notification on `smartjourney_alarm_channel`, siren AudioTrack started (uid 10311) |
| Full-screen intent | n/a | `notifee.core.NotificationReceiverActivity` launched 17:56:24 over `com.android.searchlauncher.SearchLauncher` |
| History | n/a | `Irungalur · 10 Sept, 17:53 · 3 min · 20.0 km · **Completed**` |

The `+5s0ms` registration is the crux: it can only be produced by
`adaptPollingInterval` running with `distance <= 2000 m`, which requires a
delivered fix on a motionless phone. That, plus the `Completed` history row
written by `triggerArrivalFlow`, and the full-screen intent firing while the app
was **backgrounded**, together prove the fix end-to-end.

A second, independent observation: adaptation also became correct. Across the
whole session the app's own tracking request had been registered four times and
**never once** at the designed 60 s tier (always `+10s0ms`); after the fix the
tier adapted within seconds of the first fix.

### Corrected note on the `@0` registrations (was O1)

An earlier draft of this file flagged ~90 s re-registration churn with interval
`0` as an unresolved app-level concern. That was wrong. Those requests come from
expo-location itself: `LocationModule.startHeadingUpdate()` builds
`LocationRequest.Builder(PRIORITY_HIGH_ACCURACY, 0L).setMaxUpdates(1)` to compute
the geomagnetic field for heading. They are one-shot module internals, not the
tracking task, and not app-level churn. `dumpsys location` wraps long lines, which
is what made them look like the app's own registrations.

## Scenario E1 — process-death recovery (observed)

After `am force-stop` + `am start`, the app restored the active journey with its
destination and live stats and ran the foreground service again under a **new**
pid. On a later reinstall the same path took the `recovered` branch
(`hasStartedLocationUpdatesAsync` still true), cleared the interrupted flag, and
returned to Home with the journey `ACTIVE`.

Not recorded as a formal pass: the app navigated straight to `LiveJourney` /
`Home`, so it was never captured whether the "Tracking was interrupted" banner
appeared or whether a Resume tap was needed. E1 needs a deliberate rerun.

## Other findings

### F3 — JS console output on a release build is still unverified

The `ReactNativeJS` tag does reach logcat (native `Running "main"` lines were
seen), but **zero** JS console lines appeared in any captured window. The app logs
nothing on the happy path, so this proves nothing either way. Whether
`console.error` surfaces on release — which the "Native tracking died mid-journey"
watchdog evidence depends on — remains unproven and needs a triggered sample.

The logcat ring buffer also cycles fast (~7 MB in 10 minutes pushed the startup
lines out), so watchdog evidence needs `logcat -G 16M` or a dedicated filtered
capture, not a post-hoc dump.

### F4 — the alarm notification's identity is fragile

Two observations, both about the same weakness: the alarm notification is tracked
by an id that notifee *generates*, captured from the first `displayNotification`
return value and kept in memory only.

1. **After process death** it cannot be cleared at all. Force-stopping mid-alarm
   and relaunching left `dumpsys notification` still listing the alarm
   notification (`-1945937399`, `ONGOING_EVENT`), because `alarmNotificationId` is
   `null` in the new process so `stopAll()` has nothing to cancel.
2. **The generated id does not round-trip to the posted notification.**
   `stopAll()` logged `Removing notification with id LirxNhJYmyEbDZr3cs6o`, yet the
   live alarm notification was posted under numeric id `532892981`. Cancelling the
   generated string therefore matches nothing.

In both cases the **user-visible outcome was still correct** — the siren stopped
and the alarm vanished from the notification shade; only a stale
`StatusBarNotification` record lingered in dumpsys. So this is latent rather than
user-facing today. It is recorded because the mechanism is unsound for a wake-up
app: reliably cancelling the alarm should not depend on a generated id surviving a
round-trip.

Fix: give the alarm a **fixed, explicit id** (e.g. `smartjourney_alarm`) when
displaying it — `showAlarmNotification` already reuses one id across stages 3–5, so
this only makes existing behaviour explicit — and cancel that id in `stopAll()` and
once at startup, where any alarm is by definition stale. This also closes F6's
stale-notification half.

### F5 — map-based destination selection is non-functional

`DestinationSearchScreen`'s map is centred on the user's position and `onPress`
sets a pinned destination, with a "Use Pinned Location" button. Tapping the map
centre produced **no change at all** (the UI dump was byte-identical), so the pin
flow cannot be used in this build. Almost certainly the placeholder Google Maps
key (`PLACEHOLDER_REPLACE_WITH_REAL_GOOGLE_MAPS_API_KEY`) prevents the map from
initialising. This removes the only way to pick an arbitrary nearby point, which
matters for testing and for the product.

### F6 — escalation lives only in memory (robustness gap, not an observed system kill)

**Correction.** An earlier version of this file called this "critical" and implied
the app had died on its own. It had not. The user confirmed they **physically
killed the app by mistake** during Run A, and the log corroborates that exactly:

```
18:02:29   ActivityManager: Killing 16484:com.smartjourney.app/u0a311 (adj 905): remove task
18:02:29   AS.AudioDeviceBroker: Communication client died        <- siren dies with the process
18:02:30   ReactNativeJS: Running "main"   (pid 18772)            <- fresh JS context
```

`remove task` is what a Recents swipe produces, and the app was at adj 905
(cached) when it happened. So this was a deliberate user action. **Nothing in this
run shows the app dying unexpectedly**, and it should not be read as evidence of an
OEM or low-memory kill, nor as a failure of the watchdog.

What remains true, stated without overstating it:

- `AlarmService.stage`, `escalationTimer` and the siren player are `static`
  in-memory state, so if the process dies during an alarm the escalation ladder
  ends permanently.
- The notifee notification is posted natively and outlives the process, so it kept
  reading `Wake Up!` while nothing was escalating and no siren was playing — a
  phantom alarm.
- Observed consequence: no `MAXIMUM ALARM` or `EMERGENCY MODE` for the 5+ minutes
  of polling in Run A, versus correct **+91 s / +178 s** in Run B where the process
  survived.

Severity: **low on this device.** No spontaneous kill was observed, and the
foreground service makes one unlikely on near-stock Nothing OS (the app held
`isForeground=true` with `types=0x00000008` throughout the Doze soak). It would
matter more on aggressive OEM skins. The phantom-notification behaviour is
arguably wrong regardless of trigger — after a task removal the alarm should
either keep ringing or stop cleanly and visibly, not leave a silent notification
claiming an alarm is active.

Fix, if it is ever wanted: drive stages 4–5 from something the OS restores rather
than a process-resident `setTimeout` (notifee `TimestampTrigger`, or an
`AlarmManager`-backed alarm), and give the alarm a fixed notification id so a fresh
process can cancel it (which also closes F4).

### Scenario C2 — escalation timing: measured and correct

Run B kept the app in the **foreground** so the process survived, and polled the
notification title (the only discriminator — stages 3–5 share one notification id)
every 3 s:

| Stage | Observed | Delta from previous | Design constant |
|---|---|---|---|
| 3 `Wake Up!` | 18:09:38 | — | fired 7 s after Start Tracking |
| 4 `MAXIMUM ALARM` | 18:11:09 | **+91 s** | `ESCALATION_TO_MAX_MS` = 90 s |
| 5 `EMERGENCY MODE` | 18:14:07 | **+178 s** | `ESCALATION_TO_EMERGENCY_MS` = 180 s |

`pid` stayed `19622` throughout. Both deltas are within 1–2 s, i.e. inside the 3 s
polling resolution — **escalation timing is accurate**. Combined with F6, the
picture is unambiguous: the ladder is correct when the process lives, and is lost
completely when it does not.

Measurement detail: the journey was set to a destination only **1.1 km** away with
wake distance at the 20 km maximum, and confidence read **48% (POOR)** — so
arrival additionally exercised the `LOW_CONFIDENCE_CONFIRMATIONS = 2` guard, and
still fired.

**C2 under forced Doze is not measurable, and that is fine.** Attempting it showed
`mState` returning to `ACTIVE` 19 s after the alarm began: the alarm's full-screen
intent wakes the device, which is precisely the intended behaviour. Doze cannot
persist through an alarm that successfully takes over the screen, so the
"escalation clock under Doze" worry is largely moot *provided the full-screen
intent works*. It did — `notifee.core.NotificationReceiverActivity` launched over
the launcher in the earlier run.

## Outstanding

- Scenario A — a real approach with the app backgrounded
- Scenario D — battery saver / restricted background
- Scenario E1/E2 — deliberate process-death and OEM-kill runs capturing the banner
- Scenario F — battery drain with the device genuinely unplugged
- Scenario G — **a real journey that actually wakes the traveller.** This is the
  only remaining piece of §15; every mechanism under it has now been measured on
  hardware.
- F3 (JS console on release unproven), F4 (fragile alarm notification id),
  F5 (map selection blocked by the placeholder Maps key), F6 (low severity —
  escalation is in-memory only)
- Scenario C2 under Doze is not measurable and does not need to be: the alarm's
  full-screen intent exits Doze by design.
