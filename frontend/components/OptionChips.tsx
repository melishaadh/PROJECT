import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { C } from '@/constants/theme';

export interface ChipOption<T> {
  label: string;
  value: T;
  /** Optional second line, e.g. the NPR range a tier covers. */
  hint?: string;
}

interface OptionChipsProps<T> {
  label?: string;
  options: ChipOption<T>[];
  value: T;
  onChange: (v: T) => void;
  /** Renders the options as one flush segmented control instead of loose pills. */
  segmented?: boolean;
  disabled?: boolean;
}

/**
 * Toggle-pill / segmented-control selector. This is the replacement for the
 * drag sliders: a slider forces a fiddly one-pixel-at-a-time gesture to land
 * on a value, whereas every choice here is a single tap with a visible label,
 * which behaves identically on touch and on the web.
 */
export default function OptionChips<T extends string | number>({
  label,
  options,
  value,
  onChange,
  segmented,
  disabled,
}: OptionChipsProps<T>) {
  return (
    <View style={s.wrap}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <View style={segmented ? s.segmentRow : s.chipRow}>
        {options.map((o, i) => {
          const active = o.value === value;
          return (
            <TouchableOpacity
              key={String(o.value)}
              onPress={() => !disabled && onChange(o.value)}
              activeOpacity={disabled ? 1 : 0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: !!disabled }}
              accessibilityLabel={o.label}
              style={[
                segmented ? s.segment : s.chip,
                segmented && i === 0 && s.segmentFirst,
                segmented && i === options.length - 1 && s.segmentLast,
                active && (segmented ? s.segmentActive : s.chipActive),
                disabled && s.disabled,
              ]}>
              <Text
                numberOfLines={1}
                style={[s.chipText, active && s.chipTextActive, disabled && s.chipTextDisabled]}>
                {o.label}
              </Text>
              {o.hint ? (
                <Text numberOfLines={1} style={[s.chipHint, active && s.chipHintActive]}>
                  {o.hint}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 24 },
  label: {
    color: C.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.elevated,
    alignItems: 'center',
  },
  chipActive: { backgroundColor: C.brand, borderColor: C.brand },

  segmentRow: {
    flexDirection: 'row',
    backgroundColor: C.elevated,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentFirst: { borderTopLeftRadius: 13, borderBottomLeftRadius: 13 },
  segmentLast: { borderTopRightRadius: 13, borderBottomRightRadius: 13 },
  segmentActive: { backgroundColor: C.brand },

  chipText: { color: C.textSub, fontSize: 13, fontWeight: '500' },
  chipTextActive: { color: C.white, fontWeight: '700' },
  chipHint: { color: C.textFaint, fontSize: 10, marginTop: 2 },
  chipHintActive: { color: 'rgba(255,255,255,0.75)' },
  disabled: { opacity: 0.45 },
  chipTextDisabled: { color: C.textFaint },
});
