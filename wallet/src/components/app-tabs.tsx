import { NativeTabs } from 'expo-router/unstable-native-tabs';

export default function AppTabs() {
  return (
    <NativeTabs backgroundColor="#FFFFFF" labelStyle={{ selected: { color: '#000000' } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="policies">
        <NativeTabs.Trigger.Label>Policies</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'checkmark.shield', selected: 'checkmark.shield.fill' }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
