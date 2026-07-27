import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { List, Switch, Divider } from 'react-native-paper';

export function SettingsScreen() {
  const [darkTheme, setDarkTheme] = React.useState(false);
  const [notifications, setNotifications] = React.useState(true);
  const [vibrate, setVibrate] = React.useState(true);
  const [highAccuracy, setHighAccuracy] = React.useState(true);

  return (
    <ScrollView className="flex-1 bg-slate-50">
      <View className="p-6 pb-2">
        <Text className="text-3xl font-extrabold text-slate-800">Settings</Text>
      </View>

      <List.Section>
        <List.Subheader className="text-indigo-600 font-bold uppercase tracking-wider">Appearance</List.Subheader>
        <List.Item
          title="Dark Theme"
          description="Use dark colors for the UI"
          titleStyle={{ color: '#1e293b', fontWeight: '600' }}
          left={props => <List.Icon {...props} icon="theme-light-dark" color="#64748b" />}
          right={() => <Switch value={darkTheme} onValueChange={setDarkTheme} color="#4f46e5" />}
        />
      </List.Section>

      <Divider className="bg-slate-200 mx-4" />

      <List.Section>
        <List.Subheader className="text-indigo-600 font-bold uppercase tracking-wider">Alarm & Notifications</List.Subheader>
        <List.Item
          title="Enable Notifications"
          description="Show alerts when approaching"
          titleStyle={{ color: '#1e293b', fontWeight: '600' }}
          left={props => <List.Icon {...props} icon="bell-ring" color="#64748b" />}
          right={() => <Switch value={notifications} onValueChange={setNotifications} color="#4f46e5" />}
        />
        <List.Item
          title="Vibrate on Alarm"
          titleStyle={{ color: '#1e293b', fontWeight: '600' }}
          left={props => <List.Icon {...props} icon="vibrate" color="#64748b" />}
          right={() => <Switch value={vibrate} onValueChange={setVibrate} color="#4f46e5" />}
        />
      </List.Section>

      <Divider className="bg-slate-200 mx-4" />

      <List.Section>
        <List.Subheader className="text-indigo-600 font-bold uppercase tracking-wider">Location Tracking</List.Subheader>
        <List.Item
          title="High Accuracy Mode"
          description="Uses more battery but ensures precision"
          titleStyle={{ color: '#1e293b', fontWeight: '600' }}
          left={props => <List.Icon {...props} icon="crosshairs-gps" color="#64748b" />}
          right={() => <Switch value={highAccuracy} onValueChange={setHighAccuracy} color="#4f46e5" />}
        />
      </List.Section>
    </ScrollView>
  );
}
