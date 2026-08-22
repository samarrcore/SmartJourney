import { Vibration } from 'react-native';
import notifee, {
  AndroidImportance,
  AndroidVisibility,
  AndroidCategory,
  EventType,
} from '@notifee/react-native';
import { createAudioPlayer, AudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useSettingsStore } from '../store/useSettingsStore';

export enum AlarmStage {
  NONE = 0,
  JOURNEY_REMINDER = 1,
  GENTLE_VIBRATION = 2,
  ALARM = 3,
  MAXIMUM_ALARM = 4,
  EMERGENCY_MODE = 5,
}

const ALARM_SOUND = require('../../assets/sounds/alarm.wav');

class AlarmService {
  private static STAGE_1_CHANNEL_ID = 'smartjourney_stage1_channel';
  private static STAGE_2_CHANNEL_ID = 'smartjourney_stage2_channel';
  private static ALARM_CHANNEL_ID = 'smartjourney_alarm_channel';

  /** Stage 3 escalates to Stage 4 (maximum alarm) after this long unacknowledged. */
  static readonly ESCALATION_TO_MAX_MS = 90_000;
  /** Stage 4 escalates to Stage 5 (emergency mode) after this long unacknowledged. */
  static readonly ESCALATION_TO_EMERGENCY_MS = 180_000;
  /** Stage 5 re-fires the alarm at this interval until the user stops it. */
  static readonly EMERGENCY_REPEAT_MS = 60_000;

  private static stage: AlarmStage = AlarmStage.NONE;
  private static player: AudioPlayer | null = null;
  private static escalationTimer: ReturnType<typeof setTimeout> | null = null;
  private static emergencyRepeatTimer: ReturnType<typeof setTimeout> | null = null;
  private static alarmNotificationId: string | null = null;

  static get currentStage(): AlarmStage {
    return this.stage;
  }

  static get isAlarmActive(): boolean {
    return this.stage >= AlarmStage.ALARM;
  }

  /**
   * Initialize notification channels required for the multi-stage alarm system.
   * Should be called when the app starts.
   */
  static async initializeChannels(): Promise<void> {
    // Stage 1: Journey reminder (informational)
    await notifee.createChannel({
      id: this.STAGE_1_CHANNEL_ID,
      name: 'Journey Reminders',
      description: 'Reminders that tracking is active during your journey',
      importance: AndroidImportance.DEFAULT,
      visibility: AndroidVisibility.PUBLIC,
    });

    // Stage 2: Gentle vibration when approaching the wake distance
    await notifee.createChannel({
      id: this.STAGE_2_CHANNEL_ID,
      name: 'Approach Notifications',
      description: 'Gentle alerts when approaching your destination',
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      vibration: true,
      vibrationPattern: [300, 500],
      sound: 'default',
    });

    // Stages 3-5: Full alarm. Sound is played by the app itself, so the
    // channel has no sound - only high priority, DND bypass and full-screen.
    await notifee.createChannel({
      id: this.ALARM_CHANNEL_ID,
      name: 'Wake Up Alarms',
      description: 'Loud alarms when reaching your destination',
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      bypassDnd: true,
    });
  }

  /**
   * Registers foreground + background event handlers so the "Stop Alarm"
   * button works whether or not the app is in the foreground.
   * Must be called once at app startup.
   */
  static registerEventListeners(): void {
    notifee.onForegroundEvent(({ type, detail }) => {
      this.handleNotifeeEvent(type, detail).catch(console.error);
    });
    notifee.onBackgroundEvent(async ({ type, detail }) => {
      await this.handleNotifeeEvent(type, detail);
    });
  }

  private static async handleNotifeeEvent(
    type: EventType,
    detail: { pressAction?: { id: string }; notification?: { id?: string } }
  ): Promise<void> {
    if (type === EventType.ACTION_PRESS && detail.pressAction?.id === 'stop_alarm') {
      await this.stopAll();
    }
    if (type === EventType.DISMISSED && detail.notification?.id === this.alarmNotificationId) {
      // Swiping the alarm away also silences it.
      await this.stopAll();
    }
  }

  // ---------------------------------------------------------------------
  // Stage triggers
  // ---------------------------------------------------------------------

  /** Stage 1: Journey reminder - informational notification when tracking starts. */
  static async triggerJourneyReminder(destinationName?: string): Promise<void> {
    if (!useSettingsStore.getState().notificationsEnabled) return;
    if (this.stage >= AlarmStage.JOURNEY_REMINDER && this.stage < AlarmStage.GENTLE_VIBRATION) {
      return; // Already reminded for this journey.
    }
    this.stage = AlarmStage.JOURNEY_REMINDER;

    await notifee.displayNotification({
      id: 'smartjourney_reminder',
      title: 'Journey Started',
      body: `Tracking active. We will wake you up before ${destinationName || 'your destination'}.`,
      android: {
        channelId: this.STAGE_1_CHANNEL_ID,
        pressAction: { id: 'default' },
      },
    });
  }

  /** Stage 2: Gentle vibration + heads-up notification when nearing wake distance. */
  static async triggerGentleAlert(): Promise<void> {
    if (this.stage >= AlarmStage.GENTLE_VIBRATION) return;
    this.stage = AlarmStage.GENTLE_VIBRATION;

    const { notificationsEnabled, vibrateEnabled } = useSettingsStore.getState();
    if (vibrateEnabled) {
      Vibration.vibrate([300, 500, 300, 800], false);
    }
    if (!notificationsEnabled) return;

    await notifee.displayNotification({
      id: 'smartjourney_gentle',
      title: 'Approaching Destination',
      body: 'Get ready - you are almost there.',
      android: {
        channelId: this.STAGE_2_CHANNEL_ID,
        pressAction: { id: 'default' },
      },
    });
  }

  /** Stage 3: Full alarm - looping siren, repeating vibration, full-screen notification. */
  static async triggerAlarm(): Promise<void> {
    if (this.stage >= AlarmStage.ALARM) return;
    this.stage = AlarmStage.ALARM;

    await this.startSiren(1.0);
    this.startRepeatingVibration();
    await this.showAlarmNotification('Wake Up!', 'You have reached your destination.');
    this.scheduleEscalation();
  }

  /** Stage 4: Maximum alarm - siren at max volume, stronger vibration pattern. */
  static async triggerMaximumAlarm(): Promise<void> {
    if (this.stage >= AlarmStage.MAXIMUM_ALARM) return;
    this.stage = AlarmStage.MAXIMUM_ALARM;

    await this.startSiren(1.0);
    Vibration.vibrate([1500, 500, 1500, 500, 1500, 1000], true);
    await this.showAlarmNotification(
      'MAXIMUM ALARM',
      'Wake up now! You are arriving at your destination.'
    );
    this.scheduleEscalation();
  }

  /** Stage 5: Emergency mode - re-fires the alarm every minute until stopped. */
  static async triggerEmergencyMode(): Promise<void> {
    if (this.stage >= AlarmStage.EMERGENCY_MODE) return;
    this.stage = AlarmStage.EMERGENCY_MODE;

    await this.showAlarmNotification(
      'EMERGENCY MODE',
      'Repeated alarms until you wake up. Tap Stop Alarm to silence.'
    );
    this.scheduleEmergencyRepeat();
  }

  /**
   * Silences everything: sound, vibration, escalation timers and notifications.
   */
  static async stopAll(): Promise<void> {
    this.stage = AlarmStage.NONE;
    this.clearTimers();
    this.stopSiren();
    Vibration.cancel();

    const idsToCancel = ['smartjourney_reminder', 'smartjourney_gentle'];
    if (this.alarmNotificationId) idsToCancel.push(this.alarmNotificationId);
    await notifee.cancelDisplayedNotifications(idsToCancel);
    this.alarmNotificationId = null;
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private static scheduleEscalation() {
    this.clearEscalationTimer();
    this.escalationTimer = setTimeout(async () => {
      this.escalationTimer = null;
      if (this.stage === AlarmStage.ALARM) {
        await this.triggerMaximumAlarm();
      } else if (this.stage === AlarmStage.MAXIMUM_ALARM) {
        await this.triggerEmergencyMode();
      }
    }, this.stage === AlarmStage.ALARM ? this.ESCALATION_TO_MAX_MS : this.ESCALATION_TO_EMERGENCY_MS);
  }

  private static scheduleEmergencyRepeat() {
    this.clearEmergencyRepeatTimer();
    this.emergencyRepeatTimer = setInterval(async () => {
      if (this.stage !== AlarmStage.EMERGENCY_MODE) {
        this.clearEmergencyRepeatTimer();
        return;
      }
      // Re-fire siren + vibration in case the OS or user silenced them.
      await this.startSiren(1.0);
      this.startRepeatingVibration();
    }, this.EMERGENCY_REPEAT_MS);
  }

  private static startRepeatingVibration() {
    if (!useSettingsStore.getState().vibrateEnabled) return;
    Vibration.vibrate([1000, 500, 1000, 500, 1000, 1500], true);
  }

  private static async showAlarmNotification(title: string, body: string): Promise<void> {
    if (!useSettingsStore.getState().notificationsEnabled) return;

    const id = await notifee.displayNotification({
      id: this.alarmNotificationId ?? undefined,
      title,
      body,
      android: {
        channelId: this.ALARM_CHANNEL_ID,
        ongoing: true,
        category: AndroidCategory.ALARM,
        pressAction: { id: 'default' },
        actions: [
          {
            title: 'Stop Alarm',
            pressAction: { id: 'stop_alarm' },
          },
        ],
        fullScreenAction: { id: 'default' },
      },
    });
    if (!this.alarmNotificationId) {
      this.alarmNotificationId = id;
    }
  }

  private static async startSiren(volume: number): Promise<void> {
    try {
      if (!this.player) {
        this.player = createAudioPlayer(ALARM_SOUND);
        this.player.loop = true;
      }
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix',
      });
      this.player.volume = volume;
      this.player.seekTo(0);
      this.player.play();
    } catch (error) {
      console.error('Failed to start alarm sound:', error);
    }
  }

  private static stopSiren(): void {
    try {
      if (this.player) {
        this.player.pause();
      }
    } catch (error) {
      console.error('Failed to stop alarm sound:', error);
    }
  }

  private static clearEscalationTimer(): void {
    if (this.escalationTimer) {
      clearTimeout(this.escalationTimer);
      this.escalationTimer = null;
    }
  }

  private static clearEmergencyRepeatTimer(): void {
    if (this.emergencyRepeatTimer) {
      clearInterval(this.emergencyRepeatTimer);
      this.emergencyRepeatTimer = null;
    }
  }

  private static clearTimers(): void {
    this.clearEscalationTimer();
    this.clearEmergencyRepeatTimer();
  }
}

export default AlarmService;
