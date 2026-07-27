import notifee, { AndroidImportance, AndroidVisibility, AndroidCategory, EventType } from '@notifee/react-native';

class AlarmService {
  private static STAGE_1_CHANNEL_ID = 'smartjourney_stage1_channel';
  private static STAGE_2_CHANNEL_ID = 'smartjourney_stage2_channel';

  /**
   * Initialize notification channels required for the 2-stage alarm system.
   * Should be called when the app starts.
   */
  static async initializeChannels(): Promise<void> {
    // Stage 1: Gentle notification (vibration, less intrusive)
    await notifee.createChannel({
      id: this.STAGE_1_CHANNEL_ID,
      name: 'Approach Notifications',
      description: 'Gentle alerts when approaching your destination',
      importance: AndroidImportance.DEFAULT,
      visibility: AndroidVisibility.PUBLIC,
      vibration: true,
      vibrationPattern: [300, 500], // Gentle short vibration
      sound: 'default',
    });

    // Stage 2: Full alarm (loud sound, continuous vibration, high priority)
    await notifee.createChannel({
      id: this.STAGE_2_CHANNEL_ID,
      name: 'Wake Up Alarms',
      description: 'Loud alarms when reaching your destination',
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      vibration: true,
      vibrationPattern: [1000, 500, 1000, 500, 1000, 500, 1000], // Aggressive vibration pattern
      bypassDnd: true, // Bypass Do Not Disturb for full alarm
    });
  }

  /**
   * Trigger Stage 1: Gentle notification/vibration when approaching wake distance (e.g., 1.5x)
   */
  static async triggerStage1(title: string, body: string, data?: any): Promise<string> {
    const notificationId = await notifee.displayNotification({
      title,
      body,
      data,
      android: {
        channelId: this.STAGE_1_CHANNEL_ID,
        pressAction: {
          id: 'default',
        },
      },
    });
    return notificationId;
  }

  /**
   * Trigger Stage 2: Full alarm (sound + continuous vibration) when reaching wake distance
   */
  static async triggerStage2(title: string, body: string, data?: any): Promise<string> {
    const notificationId = await notifee.displayNotification({
      title,
      body,
      data,
      android: {
        channelId: this.STAGE_2_CHANNEL_ID,
        ongoing: true, // Cannot be swiped away easily
        category: AndroidCategory.ALARM,
        pressAction: {
          id: 'default',
        },
        actions: [
          {
            title: 'Stop Alarm',
            pressAction: {
              id: 'stop_alarm',
            },
          },
        ],
        fullScreenAction: {
          id: 'default',
        },
      },
    });
    return notificationId;
  }

  /**
   * Cancel a specific alarm by its notification ID
   */
  static async cancelAlarm(notificationId: string): Promise<void> {
    await notifee.cancelNotification(notificationId);
  }

  /**
   * Cancel all SmartJourney alarms
   */
  static async cancelAllAlarms(): Promise<void> {
    await notifee.cancelAllNotifications();
  }
}

export default AlarmService;
