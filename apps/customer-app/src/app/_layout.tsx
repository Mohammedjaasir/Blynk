import { Anton_400Regular } from '@expo-google-fonts/anton';
import { BowlbyOne_400Regular } from '@expo-google-fonts/bowlby-one';
import {
  Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold, Outfit_800ExtraBold,
} from '@expo-google-fonts/outfit';
import { useFonts } from 'expo-font';
import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionEffects } from '@/blynk/account/SessionEffects';
import { CatalogProvider } from '@/blynk/catalog/CatalogContext';
import { configProblem } from '@/blynk/lib/config';
import { installConnectivity } from '@/blynk/lib/connectivity';
// reads ?ref= and #/p/<id> from the page address before the router moves it on
import { ShareStartup } from '@/blynk/share/ShareStartup';
import { StoreProvider } from '@/blynk/store/StoreContext';
import { SizePickerHost } from '@/components/SizePicker';
import { ConfigProblemScreen } from '@/components/ConfigProblem';
import { DEMO } from '@/demo/mode';
import { CartProvider } from '@/lib/cart';

SplashScreen.preventAutoHideAsync();
// the offline banner learns from every API call from the first one on
installConnectivity();

/** A release build with no usable API address shows the config problem screen (Flutter ConfigErrorApp). */
const CONFIG_PROBLEM = configProblem({
  // Expo inlines EXPO_PUBLIC_* at build time: read it as a plain property
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
  dev: typeof __DEV__ !== 'undefined' && __DEV__,
  pageHost: typeof window !== 'undefined' && window.location ? window.location.hostname : null,
  demo: DEMO,
});

/**
 * On a computer the page's phones-only gate (public/index.html, carried over from the
 * Flutter shop) shows "Blynk is a phone app" instead; the app then does not start at all.
 */
export default function RootLayout() {
  const gated = typeof window !== 'undefined' && (window as { blynkDesktopGate?: boolean }).blynkDesktopGate === true;
  return gated ? null : <AppShell />;
}

function AppShell() {
  const [loaded] = useFonts({
    Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold, Outfit_800ExtraBold,
    BowlbyOne_400Regular, Anton_400Regular,
  });
  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);
  if (!loaded) return null;
  if (CONFIG_PROBLEM) return <SafeAreaProvider><ConfigProblemScreen problem={CONFIG_PROBLEM} /></SafeAreaProvider>;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <CartProvider>
          <StoreProvider>
            <CatalogProvider>
              <StatusBar style="auto" />
              <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#fff' } }}>
                <Stack.Screen name="index" options={{ animation: 'none' }} />
                {/* Shop / Orders / Help / Profile (src/app/(tabs)); everything else pushes over them */}
                <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
                <Stack.Screen name="opening" options={{ animation: 'slide_from_right', animationDuration: 150 }} />
                <Stack.Screen name="store/[id]" options={{ animation: 'fade', animationDuration: 100 }} />
                <Stack.Screen name="search" options={{ animation: 'fade' }} />
                <Stack.Screen name="cart" options={{ animation: 'fade', animationDuration: 120 }} />
                <Stack.Screen name="otp" options={{ animation: 'none' }} />
                {/* first sign-in: no way back out of registration */}
                <Stack.Screen name="register" options={{ animation: 'fade', animationDuration: 120, gestureEnabled: false }} />
                <Stack.Screen name="birthday" options={{ animation: 'fade', animationDuration: 120, gestureEnabled: false }} />
                <Stack.Screen name="address" options={{ animation: 'fade', animationDuration: 110 }} />
                <Stack.Screen name="placed" options={{ animation: 'fade', gestureEnabled: false }} />
              </Stack>
              {/* session end cleanup, web push, the app-wide notice (src/blynk/account) */}
              <SessionEffects />
              <ShareStartup />
              {/* the size picker for products sold in sizes (migration 045) */}
              <SizePickerHost />
            </CatalogProvider>
          </StoreProvider>
        </CartProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
