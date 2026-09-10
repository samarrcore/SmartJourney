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
| Commit | `fa9fca0` (working tree clean) |
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
| Notification channels | stage1 (imp 3), stage2 (imp 4, vibrate `[300,500]`), alarm (imp 4, no sound, `mBypassDnd=true`) — all three created by `initializeChannels()` |
| App renders | Yes — icon glyph nodes present, so the `useFonts` MaterialCommunityIcons fix works |
| Confidence display | Correctly showed `48% - Location uncertain. Alarm waits for confirmation.` (POOR) |
| Location providers | `location_mode=3` (high accuracy) |

## Scenario C — Doze survival

**Result: PASS.** Tracking survived 10 minutes of forced deep Doze while the app
was backgrounded.

| | |
|---|---|
| Journey | Kashmir (far destination, no alarm expected) |
| Window | 17:30:55 → 17:41:00 (11 samples at 60 s) |
| Method | `dumpsys battery unplug` + `dumpsys deviceidle force-idle` |

Every one of the 11 samples reported:

- `mState=IDLE mLightState=OVERRIDE` — deep Doze held for the whole window
- `LocationTaskService` present (`svc=ALIVE`, 11/11)
- `pid=5637` unchanged — the process never died or restarted
- `Journey Started` + `SmartJourney Tracking` notifications still posted (`journey=YES`, 11/11)
- No watchdog trip, no `Native tracking died`, no JS error, no fatal

Afterwards: `dumpsys deviceidle unforce` returned `mState=ACTIVE`, and the journey
was still active with both notifications intact.

### The run is self-validated

The claim "the app stayed backgrounded and nobody touched the phone" was verified
from the captured log rather than assumed:

| Validation check | Count |
|---|---|
| Physical (non-injected) input events during the window | **0** |
| Times `MainActivity` was brought to `state:RESUMED` | **0** |
| Watchdog trips / JS errors / fatal exceptions | **0** |

`isInjected=false` distinguishes a real key press from an adb-injected one, which
is what makes this check conclusive.

### Deviations to record honestly

- **The screen was not off.** The intended `input keyevent 26` did not take
  because the notification shade had focus; `mWakefulness` read `Awake` at soak
  start and `Dreaming` (AOD) at the end. So this validates *app backgrounded +
  Doze*, not *screen fully off + Doze*. Scenario B still needs a true
  screen-off run.
- **The device was USB-charging** for the whole run (`dumpsys battery unplug` only
  fakes the power source for Doze purposes). Battery drain therefore could not be
  measured, and Scenario F's drain figure is still outstanding.

## Run 1 — invalidated (documented for honesty)

An earlier soak (17:16:12 → 17:26:16) is **not usable**. At **17:18:22** the log
shows a real key press and unlock:

```
interceptKeyBeforeQueueing event=KeyEvent{ keyCode=KEYCODE_WAKEUP, isInjected=false, deviceId=4 }
KeyguardViewMediator: keyguardDone / handleHide
MTK_APPList: com.smartjourney.app/.MainActivity, state:RESUMED
```

That is a physical unlock, not an adb injection, and it brought the app to the
foreground and cancelled the journey. The background/screen-off/Doze portion of
that run was therefore only ~2 minutes, and for the remaining ~8 minutes the app
was in the foreground with no active journey. The "service alive, pid stable"
observation from it means nothing about background survival. Discarded.

## Scenario E1 — process-death recovery (observed, not formally run)

While preparing, the app was force-stopped and relaunched:
`am force-stop` → `am start`. Observed after relaunch:

- the active journey was restored with its destination and live stats
- the foreground service was running again under a **new** pid
- a fresh location request was registered at 17:13:43 under the new process

So journey state survived process death and native tracking was live again on
relaunch. **Not recorded as a formal pass**: the app navigated straight to
`LiveJourney`, so it was not captured whether the "Tracking was interrupted"
banner appeared or whether a Resume tap was required. E1 needs a deliberate rerun
that captures the Home screen.

## Findings

### F1 — Adaptive polling never engages while the phone is stationary

The designed tier for a journey over 50 km is **60 s / 1000 m**
(`LocationService.adaptPollingInterval`). During a ~1800 km journey the app
**never once registered that tier**. Every registration for
`WorkSource{10311 com.smartjourney.app}` was either `@+10s0ms` (the initial
`DEFAULT_INTERVAL_MS`) or `@0`:

```
17:13:43  +registration @+10s0ms HIGH_ACCURACY   (first journey)
17:18:55  +registration @+10s0ms
17:19:57  +registration @0
17:30:20  +registration @+10s0ms HIGH_ACCURACY   (Kashmir journey)
17:31:20  +registration @0
17:32:50  +registration @0
17:34:20  +registration @0
17:35:51  +registration @0
17:37:21  +registration @0
17:38:51  +registration @0
17:40:21  +registration @0
```

Root cause, from code: `adaptPollingInterval` is called **only** from
`handleLocationUpdate`, i.e. only when a fix is delivered. The task is registered
with `distanceInterval = 10` (`DEFAULT_DISTANCE_M`), and per the Expo SDK 57 docs
`distanceInterval` means *"receive updates only when the location has changed by at
least this distance in meters"*. A stationary phone therefore receives no fixes at
all, so adaptation never runs, and the app keeps the initial 10 s
`HIGH_ACCURACY` registration — the OS still computes those fixes, so this is
battery spent for no data.

Impact: a phone sitting still on a long journey holds the most expensive location
configuration the app has, and the display freezes rather than degrading
gracefully.

### F2 — Arrival can never fire for a stationary phone already inside the radius

`evaluateAlarms` is likewise reachable only through `handleLocationUpdate`
(`LocationService.ts:97` task callback, `:496` simulator only). There is no
timer-driven re-evaluation: the watchdog (`:519`) only probes
`hasStartedLocationUpdatesAsync` for liveness and never re-checks distance.

Consequence: if tracking starts, or the phone becomes stationary, while already
within `wakeDistance` and the device then does not move ≥ 10 m, **no fix is
delivered, arrival is never evaluated, and the alarm never sounds**. For an app
whose entire purpose is to wake a sleeping traveller this is a credible failure
path — a phone resting at the destination, or a train stopped just short of it.

Also note the watchdog is a JS `setInterval` (`WATCHDOG_INTERVAL_MS = 60_000`), so
it shares the Doze exposure it exists to guard against.

### F3 — JS console output on this release build is unverified

The `ReactNativeJS` tag does reach logcat (native `Running "main"` lines were
observed), but **zero** JS console lines appeared in 10 minutes of captured log.
The app logs nothing in steady state, so this is expected and proves nothing
either way. Whether `console.error` output actually surfaces on a release build —
which the "Native tracking died mid-journey" watchdog evidence depends on — is
still unproven and needs a deliberately triggered sample.

Note the logcat ring buffer also cycles fast: an earlier `logcat -d` dump of ~7 MB
had already pushed the startup lines out. Watchdog evidence needs either a large
buffer (`logcat -G 16M`) or a dedicated filtered capture, not a post-hoc dump.

### O1 — ~90 s re-registration churn (unresolved)

Between 17:31:20 and 17:40:21 the app re-registered its location request every
~90 s, each time with `@0` (no interval constraint) — a value the app never passes
to `startLocationUpdatesAsync`. Combined with the `isForeground` flag flickering in
`dumpsys activity services`, something is repeatedly tearing down and rebuilding
the location request. Not diagnosed; recorded because it is both a battery concern
and a sign of unnecessary churn on the tracking path.

## Outstanding

- Scenario A / B — a real approach and a true screen-off locked-screen arrival
- Scenario C2 — Stage 3→4→5 escalation timing under Doze (the riskiest untested mechanism)
- Scenario D — battery saver / restricted background
- Scenario E1/E2 — deliberate process-death and OEM-kill runs
- Scenario F — battery drain with the device genuinely unplugged
- Scenario G — a real journey that actually wakes the traveller (§15 itself)
