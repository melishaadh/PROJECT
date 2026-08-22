import React from 'react';
import { View, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, ViewStyle } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { C } from '@/constants/theme';

interface SearchBarProps {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  /** Shows a spinner in place of the clear button while a request is in flight. */
  busy?: boolean;
  autoFocus?: boolean;
  style?: ViewStyle;
  onSubmitEditing?: () => void;
  /**
   * Forwarded to the inner `TextInput`, not to the wrapper — the end-to-end
   * suite types into this component, and Detox can only type into the element
   * that actually holds the text.
   */
  testID?: string;
}

/**
 * The single search input used across Explore, For You and the profile
 * pickers. Owning it in one place is what guarantees the clear (X) affordance
 * exists — and actually clears — everywhere a search field appears.
 */
export default function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search...',
  busy,
  autoFocus,
  style,
  onSubmitEditing,
  testID,
}: SearchBarProps) {
  const hasValue = value.length > 0;

  return (
    <View style={[s.box, style]}>
      <Search size={18} color={C.textFaint} strokeWidth={2} />
      <TextInput
        style={s.input}
        placeholder={placeholder}
        placeholderTextColor={C.textFaint}
        value={value}
        onChangeText={onChangeText}
        autoCorrect={false}
        autoCapitalize="none"
        autoFocus={autoFocus}
        returnKeyType="search"
        onSubmitEditing={onSubmitEditing}
        testID={testID}
      />
      {busy ? (
        <ActivityIndicator size="small" color={C.brand} />
      ) : hasValue ? (
        <TouchableOpacity
          onPress={() => onChangeText('')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          style={s.clearBtn}>
          <X size={14} color={C.textSub} strokeWidth={2.5} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 46,
    borderWidth: 1,
    borderColor: C.border,
    gap: 10,
  },
  input: {
    flex: 1,
    color: C.white,
    fontSize: 14,
    padding: 0,
  },
  clearBtn: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
