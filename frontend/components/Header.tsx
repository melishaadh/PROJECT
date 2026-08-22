import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Menu, Mountain } from 'lucide-react-native';
import { router } from 'expo-router';
import { C } from '@/constants/theme';

interface HeaderProps {
  onMenuPress: () => void;
  /**
   * Renders in the left slot that otherwise sits empty for visual balance
   * against the menu button on the right. Optional and per-screen — most
   * screens keep the plain spacer; only the ones that need a second action
   * (currently just Profile's "My Chats") pass this.
   */
  leftAction?: {
    icon: React.ReactNode;
    onPress: () => void;
    accessibilityLabel: string;
  };
}

export default function Header({ onMenuPress, leftAction }: HeaderProps) {
  return (
    <View style={s.container}>
      {leftAction ? (
        <TouchableOpacity
          onPress={leftAction.onPress}
          style={s.leftActionBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={leftAction.accessibilityLabel}>
          {leftAction.icon}
        </TouchableOpacity>
      ) : (
        <View style={s.spacer} />
      )}

      {/* Tapping the wordmark returns to Explore, the app's home tab. */}
      <TouchableOpacity
        onPress={() => router.push('/')}
        style={s.titleRow}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Go to Explore">
        <Mountain size={22} color={C.brand} strokeWidth={2.5} />
        <Text style={s.title}>TrekEasy</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={onMenuPress}
        style={s.menuBtn}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Open menu">
        <Menu size={22} color={C.white} strokeWidth={2} />
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 14,
    backgroundColor: C.bg,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  spacer: { width: 36 },
  leftActionBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: C.white,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 1,
  },
  menuBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
