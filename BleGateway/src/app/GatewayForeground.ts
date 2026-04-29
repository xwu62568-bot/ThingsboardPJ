import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

type GatewayForegroundModule = {
  start?: () => Promise<boolean>;
  stop?: () => Promise<boolean>;
};

const nativeModule = NativeModules.GatewayForeground as GatewayForegroundModule | undefined;

export async function startGatewayForegroundService(): Promise<void> {
  if (Platform.OS !== 'android' || !nativeModule?.start) {
    return;
  }
  await requestNotificationPermission();
  await nativeModule.start();
}

export async function stopGatewayForegroundService(): Promise<void> {
  if (Platform.OS !== 'android' || !nativeModule?.stop) {
    return;
  }
  await nativeModule.stop();
}

async function requestNotificationPermission(): Promise<void> {
  if (Platform.OS !== 'android' || Platform.Version < 33) {
    return;
  }
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  const granted = await PermissionsAndroid.check(permission);
  if (granted) {
    return;
  }
  await PermissionsAndroid.request(permission);
}
