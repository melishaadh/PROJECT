import { Tabs } from 'expo-router';
import { View, StyleSheet, Platform } from 'react-native';
import { Compass, Heart, MessageSquare, User } from 'lucide-react-native';
import { C } from '@/constants/theme';
import { T } from '@/constants/testIDs';

/**
 * The floating tab bar's own surface.
 *
 * Solid, not blurred. This used to lay a `BlurView` over a `barWrap` that had
 * no background of its own, so on any device where `expo-blur` degrades — which
 * is most Android devices — the bar had nothing painting it and the feed showed
 * straight through the icons. See the matching note in `DrawerMenu`.
 */
function GlassTabBar() {
  return (
    <View style={s.barWrap} pointerEvents="none">
      <View style={s.barFill} />
      <View style={s.barOverlay} />
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.brand,
        tabBarInactiveTintColor: 'rgba(255,255,255,0.45)',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 2,
          marginBottom: 2,
        },
        tabBarIconStyle: {
          marginTop: 4,
        },
        tabBarStyle: {
          position: 'absolute',
          bottom: 20,
          left: 18,
          right: 18,
          height: 68,
          borderRadius: 34,
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.35,
          shadowRadius: 18,
          overflow: Platform.OS === 'ios' ? 'visible' : 'hidden',
        },
        tabBarBackground: () => <GlassTabBar />,
        tabBarItemStyle: {
          paddingVertical: 4,
        },
      }}>
      {/*
        `tabBarButtonTestID` is what makes each tab reachable from the
        end-to-end suite: the tab buttons are rendered by React Navigation, so a
        `testID` cannot be attached from here any other way. (It is
        `tabBarButtonTestID`, not `tabBarTestID` — bottom-tabs v7 renamed it.)
      */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Explore',
          tabBarButtonTestID: T.tabs.explore,
          tabBarIcon: ({ color, size }) => (
            <Compass size={size - 2} color={color} strokeWidth={2} />
          ),
        }}
      />
      <Tabs.Screen
        name="foryou"
        options={{
          title: 'For You',
          tabBarButtonTestID: T.tabs.forYou,
          tabBarIcon: ({ color, size }) => (
            <Heart size={size - 2} color={color} strokeWidth={2} />
          ),
        }}
      />
      <Tabs.Screen
        name="chatroom"
        options={{
          title: 'Chatroom',
          tabBarButtonTestID: T.tabs.chatroom,
          tabBarIcon: ({ color, size }) => (
            <MessageSquare size={size - 2} color={color} strokeWidth={2} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarButtonTestID: T.tabs.profile,
          tabBarIcon: ({ color, size }) => (
            <User size={size - 2} color={color} strokeWidth={2} />
          ),
        }}
      />
    </Tabs>
  );
}

const s = StyleSheet.create({
  barWrap: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 34,
    overflow: 'hidden',
  },
  barFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#161616',
    borderRadius: 34,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  barOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 34,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    backgroundColor: Platform.OS === 'web' ? 'transparent' : 'rgba(255,255,255,0.04)',
  },
});
