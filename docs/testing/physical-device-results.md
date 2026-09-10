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

### F4 — a stale alarm notification survives process death

After force-stopping the app mid-alarm and relaunching, `dumpsys notification`
still lists the alarm notification (id `-1945937399`, `ONGOING_EVENT`). It could
not be cleared by the app, because `AlarmService.alarmNotificationId` is
in-memory only and is `null` in the new process, so `stopAll()` has nothing to
cancel. It was **not visible** in the notification shade, so this is latent rather
than user-facing here — but a wake-up app must never leave a stuck alarm
notification.

Recommended fix: give the alarm a fixed notification id
(`showAlarmNotification` already reuses one id across stages 3–5, so this makes
existing behaviour explicit) and cancel that id both in `stopAll()` and once at
startup, where any alarm is by definition stale.

### F5 — map-based destination selection is non-functional

`DestinationSearchScreen`'s map is centred on the user's position and `onPress`
sets a pinned destination, with a "Use Pinned Location" button. Tapping the map
centre produced **no change at all** (the UI dump was byte-identical), so the pin
flow cannot be used in this build. Almost certainly the placeholder Google Maps
key (`PLACEHOLDER_REPLACE_WITH_REAL_GOOGLE_MAPS_API_KEY`) prevents the map from
initialising. This removes the only way to pick an arbitrary nearby point, which
matters for testing and for the product.

### Scenario C2 — escalation timing not yet measured

The alarm fired and escalated this run, but the dedicated 5 s poll loop was killed
part-way so there are **no per-stage timestamps**. What is known: the siren started
at 17:56:09, the full-screen intent fired at 17:56:24, and the alarm was still
sounding ~5 minutes later when it was stopped — so escalation certainly continued,
but the +90 s / +180 s timings under Doze remain unmeasured. C2 needs a dedicated
run with the poll loop (§0.4) left to complete.

## Outstanding

- Scenario C2 — Stage 3→4→5 timings under Doze, with the poll loop running to completion
- Scenario A / B — a real approach, and a true screen-off locked-screen arrival
- Scenario D — battery saver / restricted background
- Scenario E1/E2 — deliberate process-death and OEM-kill runs capturing the banner
- Scenario F — battery drain with the device genuinely unplugged
- Scenario G — a real journey that actually wakes the traveller (§15 itself)
- F3, F4, F5 above
