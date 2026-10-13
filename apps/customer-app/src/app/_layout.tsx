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
import { CatalogProvider } from '@/blynk/catalog/CatalogContext';
import { StoreProvider } from '@/blynk/store/StoreContext';
import { CartProvider } from '@/lib/cart';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold, Outfit_800ExtraBold,
    BowlbyOne_400Regular, Anton_400Regular,
  });
  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);
  if (!loaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <CartProvider>
          <StoreProvider>
            <CatalogProvider>
              <StatusBar style="auto" />
              <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#fff' } }}>
                <Stack.Screen name="index" options={{ animation: 'none' }} />
                <Stack.Screen name="home" options={{ animation: 'fade' }} />
                <Stack.Screen name="opening" options={{ animation: 'slide_from_right', animationDuration: 150 }} />
                <Stack.Screen name="store/[id]" options={{ animation: 'fade', animationDuration: 100 }} />
                <Stack.Screen name="search" options={{ animation: 'fade' }} />
                <Stack.Screen name="cart" options={{ animation: 'fade', animationDuration: 120 }} />
                <Stack.Screen name="otp" options={{ animation: 'none' }} />
                <Stack.Screen name="address" options={{ animation: 'fade', animationDuration: 110 }} />
                <Stack.Screen name="placed" options={{ animation: 'fade', gestureEnabled: false }} />
              </Stack>
            </CatalogProvider>
          </StoreProvider>
        </CartProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
