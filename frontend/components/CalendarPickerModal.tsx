import React, { useState } from 'react';
import { View, Text, Modal, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import { C } from '@/constants/theme';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Every cell for the visible month's grid — leading/trailing days from adjacent months included, dimmed. */
function buildGrid(viewedMonth: Date): Date[] {
  const firstOfMonth = new Date(viewedMonth.getFullYear(), viewedMonth.getMonth(), 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

interface CalendarPickerModalProps {
  visible: boolean;
  onClose: () => void;
  /** Currently selected date, if any — highlighted in the grid. */
  value: Date | null;
  onSelect: (date: Date) => void;
  title?: string;
  /** Days before this are shown dimmed and cannot be tapped. */
  minDate?: Date;
}

/**
 * A tap-to-pick month-grid date picker, shared by every screen that needs a
 * real calendar instead of a typed date string — currently the "New
 * Expedition" form's start/end date fields.
 */
export default function CalendarPickerModal({
  visible,
  onClose,
  value,
  onSelect,
  title = 'Select a date',
  minDate,
}: CalendarPickerModalProps) {
  const [viewedMonth, setViewedMonth] = useState(() => startOfDay(value ?? new Date()));

  const today = startOfDay(new Date());
  const minBound = minDate ? startOfDay(minDate) : null;
  const grid = buildGrid(viewedMonth);

  const goPrevMonth = () => setViewedMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const goNextMonth = () => setViewedMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));

  const handlePick = (day: Date) => {
    if (minBound && day < minBound) return;
    onSelect(day);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.card} onPress={() => {}}>
          <View style={s.header}>
            <Text style={s.title}>{title}</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={8}
              style={s.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close date picker">
              <X size={16} color={C.textSub} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <View style={s.monthRow}>
            <TouchableOpacity
              onPress={goPrevMonth}
              hitSlop={8}
              style={s.monthNavBtn}
              accessibilityRole="button"
              accessibilityLabel="Previous month">
              <ChevronLeft size={18} color={C.textSub} strokeWidth={2} />
            </TouchableOpacity>
            <Text style={s.monthLabel}>
              {MONTH_LABELS[viewedMonth.getMonth()]} {viewedMonth.getFullYear()}
            </Text>
            <TouchableOpacity
              onPress={goNextMonth}
              hitSlop={8}
              style={s.monthNavBtn}
              accessibilityRole="button"
              accessibilityLabel="Next month">
              <ChevronRight size={18} color={C.textSub} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <View style={s.weekdayRow}>
            {WEEKDAY_LABELS.map((label, i) => (
              <Text key={i} style={s.weekdayLabel}>{label}</Text>
            ))}
          </View>

          <View style={s.grid}>
            {grid.map((day, i) => {
              const inMonth = day.getMonth() === viewedMonth.getMonth();
              const disabled = !!minBound && day < minBound;
              const selected = !!value && sameDay(day, value);
              const isToday = sameDay(day, today);
              return (
                <TouchableOpacity
                  key={i}
                  onPress={() => handlePick(day)}
                  disabled={disabled}
                  style={[s.dayCell, selected && s.dayCellSelected]}
                  accessibilityRole="button"
                  accessibilityLabel={day.toDateString()}>
                  <Text
                    style={[
                      s.dayText,
                      !inMonth && s.dayTextOutOfMonth,
                      disabled && s.dayTextDisabled,
                      isToday && !selected && s.dayTextToday,
                      selected && s.dayTextSelected,
                    ]}>
                    {day.getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    padding: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: { color: C.white, fontSize: 15, fontWeight: '700' },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  monthNavBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthLabel: { color: C.white, fontSize: 14, fontWeight: '700' },

  weekdayRow: { flexDirection: 'row', marginBottom: 4 },
  weekdayLabel: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    color: C.textFaint,
    fontSize: 11,
    fontWeight: '700',
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  dayCellSelected: { backgroundColor: C.brand },
  dayText: { color: C.white, fontSize: 13, fontWeight: '600' },
  dayTextOutOfMonth: { color: C.textFaint, fontWeight: '400' },
  dayTextDisabled: { color: C.textFaint, opacity: 0.4 },
  dayTextToday: { color: C.green, fontWeight: '800' },
  dayTextSelected: { color: C.white, fontWeight: '800' },
});
