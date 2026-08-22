import React, { useEffect, useState } from 'react';
import { Text, ScrollView, View, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { useFonts } from 'expo-font';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { useGuestMode } from '@/lib/guestMode';
import { C } from '@/constants/theme';

SplashScreen.preventAutoHideAsync();

/** Routes a signed-out visitor is allowed to sit on. */
const PUBLIC_ROUTES = new Set(['landing', 'login', 'signup']);

/**
 * Sends signed-out visitors to the public landing page by default, and keeps
 * signed-in members out of it. Guests who explicitly chose "browse as a guest"
 * are left alone so they can still explore the catalogue.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, loading } = useAuth();
  const guest = useGuestMode();
  const segments = useSegments();
  const router = useRouter();
  // `useRootNavigationState()` only gets a key once the navigator has mounted;
  // calling router.replace() before that is a no-op that would strand the user.
  const navigationState = useRootNavigationState();
  const navigatorReady = !!navigationState?.key;

  // The root route "/" resolves inside the (tabs) group, so segments can be
  // empty there. Treating empty as a non-public route is what makes a guest
  // landing on "/" get redirected rather than sit on a spinner forever.
  const route = segments[0] ?? '';
  const onPublicRoute = PUBLIC_ROUTES.has(route);

  useEffect(() => {
    if (loading || !navigatorReady) return;

    if (!isLoggedIn && !guest && !onPublicRoute) {
      router.replace('/landing');
    } else if (isLoggedIn && route === 'landing') {
      router.replace('/(tabs)');
    }
  }, [loading, navigatorReady, isLoggedIn, guest, onPublicRoute, route, router]);

  // Only the session restore blocks rendering. Redirects happen underneath the
  // rendered tree, so a slow navigator can never leave a permanent spinner.
  if (loading) {
    return (
      <View style={s.gateLoading}>
        <ActivityIndicator size="large" color={C.brand} />
      </View>
    );
  }

  return <>{children}</>;
}

/** Renders any render-time crash as visible text instead of a blank white screen. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <ScrollView
          style={{ flex: 1, backgroundColor: '#111' }}
          contentContainerStyle={{ padding: 24, paddingTop: 80 }}>
          <Text style={{ color: '#ff6b6b', fontSize: 18, fontWeight: '700', marginBottom: 12 }}>
            App crashed on startup
          </Text>
          <Text style={{ color: '#fff', fontSize: 13 }}>
            {this.state.error.message}
          </Text>
          <Text style={{ color: '#888', fontSize: 11, marginTop: 16 }}>
            {this.state.error.stack}
          </Text>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

export default function RootLayout() {
  useFrameworkReady();

  const [fontsLoaded, fontError] = useFonts({
    'Inter-Regular': Inter_400Regular,
    'Inter-Medium': Inter_500Medium,
    'Inter-SemiBold': Inter_600SemiBold,
    'Inter-Bold': Inter_700Bold,
  });

  // Fallback: never let a stalled font load hang the app on a blank screen.
  const [fontTimedOut, setFontTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFontTimedOut(true), 2500);
    return () => clearTimeout(t);
  }, []);

  const ready = fontsLoaded || !!fontError || fontTimedOut;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <RootErrorBoundary>
      <AuthProvider>
        <AuthGate>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="landing" options={{ headerShown: false, animation: 'fade' }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="signup" options={{ headerShown: false }} />
            <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
            {/* `app/trek/` owns its own stack (detail + itinerary), so the
                root registers the group rather than the single detail route. */}
            <Stack.Screen name="trek" options={{ headerShown: false, presentation: 'card' }} />
            <Stack.Screen name="chat" options={{ headerShown: false, presentation: 'card' }} />
            <Stack.Screen name="+not-found" />
          </Stack>
        </AuthGate>
        <StatusBar style="light" />
      </AuthProvider>
    </RootErrorBoundary>
  );
}

const s = StyleSheet.create({
  gateLoading: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
