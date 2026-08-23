# Simulator Reliability Results

Evidence gathered with the dev-only Journey Simulator on the `Medium_Phone`
emulator (API level per SDK 57 tooling), driving synthetic fixes through the
real pipeline: ConfidenceEngine -> PredictionEngine -> evaluateAlarms ->
AlarmService. Format follows the project testing process (scenario / setup /
expected / actual / result).

## Matrix

| # | Scenario | Setup | Expected | Actual | Result |
|---|----------|-------|----------|--------|--------|
| 1 | Highway Approach | 5 km @ ~80 km/h, 8 m GPS accuracy, wake 500 m | Gentle alert near 750 m, alarm inside wake radius, notification posted, escalation after 90 s | ALARM fired at 0.38 km remaining, confidence GOOD 100%, polling adapted 10 s -> 5 s; "Wake Up!" notification posted; MAXIMUM ALARM escalation observed at +89 s; notification title updated in place; Stop & Reset returned stage to Silent and cancelled all notifications; history recorded "Completed" | PASS |
| 2 | Degraded GPS Approach | Same journey, 45 m accuracy | Confidence DEGRADED, alarm fires without confirmation gate | DEGRADED tier observed; ALARM fired at 0.38 km remaining | PASS |
| 3 | GPS Drift Near Arrival | Accuracy collapses to 250 m with speed unavailable within 1.5 km of destination | Confidence drops POOR (<50); double-confirmation guard holds first in-range fix but alarm still fires | CONFIDENCE (POOR) 40% observed; guard held one reading; ALARM fired at 0.30 km remaining on the confirming fix | PASS |
| 4 | GPS Blackout + Recovery | Fixes vanish for 12 ticks once within 3 km while vehicle keeps moving | Tracking survives gap without crash; alarm evaluates on first recovered fix | Pipeline silent during gap, resumed cleanly; ALARM fired immediately on recovery (vehicle had passed wake point during outage - correct degradation behavior) | PASS |
| 5 | Stationary Vehicle | Vehicle freezes (speed 0) for 15 ticks within last kilometre, then resumes | Speed shows 0, ETA pauses, confidence holds, alarm only after movement resumes | Freeze observed (speed 0, ETA --); ALARM fired after resume | PASS |

## Notes

- Stage-5 (emergency repeat) shares the same timer path proven by the
  Stage-3 -> Stage-4 transition and was not separately awaited.
- These runs exercise JS-side logic with synthetic input; they do NOT prove
  native background-location behavior under Doze/OEM restrictions. Physical
  device matrix remains open.
- Run date: emulator session, same working day as commit history.

## Reproducing

Launch the app build (debug), open `Dev: Journey Simulator` from Home
(visible in `__DEV__` builds only), select a scenario, choose wake distance,
tap Start Simulation. Observe the Pipeline State card and Android
notifications (`adb shell dumpsys notification --noredact`).
