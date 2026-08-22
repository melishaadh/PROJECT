import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  Platform,
  Keyboard,
  StyleSheet,
} from 'react-native';
import { MapPin } from 'lucide-react-native';
import { C } from '@/constants/theme';

interface LocationInputProps {
  label?: string;
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  locations: string[];
  testID?: string;
}

const IS_WEB = Platform.OS === 'web';

/**
 * Text input with a filtering suggestion dropdown, styled on the app's shared
 * palette so it reads as a sibling of `SearchBar` rather than its own widget.
 *
 * The tricky part is that tapping a suggestion first *blurs the input*, and a
 * naive implementation closes the dropdown on blur — unmounting the row before
 * the press can land, so the tap does nothing at all. Three things together
 * make the selection reliable:
 *
 *  1. `pressArmed` — set on press-in, it makes the blur handler leave the list
 *     open. The value is still only committed on `onPress` (a *completed* tap),
 *     so dragging to scroll the list cannot select a row by accident.
 *  2. `keyboardShouldPersistTaps="always"` — otherwise the first tap while the
 *     keyboard is up is swallowed just to dismiss it.
 *  3. `onMouseDown` + `preventDefault` on web, where mousedown moves focus and
 *     cancels the click before React Native Web turns it into a press.
 */
export default function LocationInput({
  label,
  placeholder,
  value,
  onChangeText,
  locations,
  testID,
}: LocationInputProps) {
  const [focused, setFocused] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);
  // Set the moment a suggestion is committed. Keeps the list closed until the
  // user types again, so the dropdown can't flash back open while the parent's
  // controlled `value` is still catching up.
  const committedRef = useRef<string | null>(null);
  // True between press-in and press-out on a row: a blur during that window is
  // the input losing focus *to the row*, and must not close the list.
  const pressArmed = useRef(false);

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (q.length === 0) return [];
    if (committedRef.current !== null && committedRef.current.toLowerCase() === q) return [];
    return locations.filter(l => l.toLowerCase().includes(q) && l.toLowerCase() !== q).slice(0, 8);
  }, [value, locations]);

  const cancelBlurTimer = useCallback(() => {
    if (blurTimer.current) {
      clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
  }, []);

  const handleFocus = useCallback(() => {
    cancelBlurTimer();
    setFocused(true);
  }, [cancelBlurTimer]);

  const handleBlur = useCallback(() => {
    // A press is underway on a suggestion — this blur is that press stealing
    // focus, so keep the list open long enough for onPress to fire.
    if (pressArmed.current) return;
    cancelBlurTimer();
    blurTimer.current = setTimeout(() => setFocused(false), 150);
  }, [cancelBlurTimer]);

  useEffect(() => cancelBlurTimer, [cancelBlurTimer]);

  const handleChangeText = useCallback((text: string) => {
    // Typing invalidates the previous selection, so suggestions come back.
    committedRef.current = null;
    onChangeText(text);
  }, [onChangeText]);

  const handleSelect = useCallback((loc: string) => {
    pressArmed.current = false;
    cancelBlurTimer();

    committedRef.current = loc;
    onChangeText(loc);
    setFocused(false);
    inputRef.current?.blur();
    if (!IS_WEB) Keyboard.dismiss();
  }, [onChangeText, cancelBlurTimer]);

  // Press released without completing (dragged off the row, or a scroll):
  // re-arm the normal blur behaviour so the list still closes on tap-away.
  const handlePressOut = useCallback(() => {
    if (!pressArmed.current) return;
    pressArmed.current = false;
    if (!inputRef.current?.isFocused?.()) handleBlur();
  }, [handleBlur]);

  // On web the input blurs on mousedown, which cancels the click before it
  // lands on the row. Swallowing mousedown on the dropdown keeps focus put.
  const webKeepFocus = IS_WEB
    ? { onMouseDown: (e: any) => e?.preventDefault?.() }
    : {};

  const open = focused && suggestions.length > 0;

  return (
    <View style={[s.wrap, open && s.wrapOpen]} collapsable={false}>
      {label ? <Text style={s.label}>{label}</Text> : null}

      <View style={[s.box, focused && s.boxFocused]}>
        <MapPin size={16} color={C.textFaint} strokeWidth={2} />
        <TextInput
          ref={inputRef}
          style={s.input}
          placeholder={placeholder}
          placeholderTextColor={C.textFaint}
          value={value}
          onChangeText={handleChangeText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          autoCorrect={false}
          autoCapitalize="words"
          underlineColorAndroid="transparent"
          selectionColor={C.brand}
          testID={testID}
        />
      </View>

      {open && (
        <View collapsable={false} {...webKeepFocus} style={s.dropdown}>
          <ScrollView style={s.dropdownScroll} keyboardShouldPersistTaps="always" nestedScrollEnabled>
            {suggestions.map((loc, i) => (
              <Pressable
                key={loc}
                onPressIn={() => { pressArmed.current = true; }}
                onPress={() => handleSelect(loc)}
                onPressOut={handlePressOut}
                accessibilityRole="button"
                accessibilityLabel={loc}
                style={({ pressed }) => [
                  s.row,
                  i < suggestions.length - 1 && s.rowDivider,
                  pressed && s.rowPressed,
                ]}>
                <Text style={s.rowText}>{loc}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'relative', marginBottom: 16, zIndex: 1 },
  // Lifts the open dropdown above the fields beneath it.
  wrapOpen: { zIndex: 100 },
  label: {
    color: C.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 46,
    borderWidth: 1,
    borderColor: C.border,
  },
  boxFocused: { borderColor: C.brand },
  input: { flex: 1, color: C.white, fontSize: 14, padding: 0 },

  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 6,
    backgroundColor: C.elevated,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
    zIndex: 200,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  dropdownScroll: { maxHeight: 220 },
  row: { paddingHorizontal: 14, paddingVertical: 12 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: C.border },
  rowPressed: { backgroundColor: C.brandDim },
  rowText: { color: C.textSub, fontSize: 14 },
});
