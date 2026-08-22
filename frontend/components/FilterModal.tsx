import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { X, RotateCcw } from 'lucide-react-native';
import OptionChips, { ChipOption } from '@/components/OptionChips';
import { C } from '@/constants/theme';

export interface FilterState {
  difficulty: string;
  maxDuration: number;
  maxPrice: number;
}

export const DEFAULT_FILTERS: FilterState = {
  difficulty: 'All',
  maxDuration: 21,
  maxPrice: 300000,
};

const DIFFICULTY_OPTIONS: ChipOption<string>[] = [
  { label: 'All', value: 'All' },
  { label: 'Easy', value: 'Easy' },
  { label: 'Moderate', value: 'Moderate' },
  { label: 'Hard', value: 'Hard' },
];

/**
 * Duration and budget are exposed as named bands rather than a continuous
 * slider: every stop is a tap target with a readable label, which is both
 * easier on a phone and unambiguous about what was selected.
 *
 * The bands run to 20 days because the catalogue does. Capping the longest
 * option at 14d left the six routes of 16-20 days unreachable through the
 * filter — Kongma La, Manaslu/Tsum, Lower Dolpo, Damodar Kunda, Dhaulagiri
 * Hidden Valley, Dolpo-Jomsom and Makalu Sherpani Col — so the filter quietly
 * disagreed with the data behind it.
 */
const DURATION_OPTIONS: ChipOption<number>[] = [
  { label: 'Any', value: 21 },
  { label: '≤ 5d', value: 5 },
  { label: '≤ 10d', value: 10 },
  { label: '≤ 14d', value: 14 },
  { label: '≤ 20d', value: 20 },
];

const PRICE_OPTIONS: ChipOption<number>[] = [
  { label: 'Any', value: 300000, hint: 'No limit' },
  { label: 'Budget', value: 25000, hint: 'Under 25K' },
  { label: 'Mid', value: 80000, hint: 'Under 80K' },
  { label: 'Premium', value: 150000, hint: 'Under 150K' },
];

interface FilterModalProps {
  visible: boolean;
  onClose: () => void;
  onApply: (filters: FilterState) => void;
  current: FilterState;
}

export default function FilterModal({ visible, onClose, onApply, current }: FilterModalProps) {
  const [draft, setDraft] = useState<FilterState>(current);

  // Re-seed the draft each time the sheet opens. Without this, dismissing the
  // sheet without applying (or resetting the filters elsewhere) left stale
  // selections showing the next time it was opened.
  useEffect(() => {
    if (visible) setDraft(current);
  }, [visible, current]);

  const isDirty =
    draft.difficulty !== DEFAULT_FILTERS.difficulty ||
    draft.maxDuration !== DEFAULT_FILTERS.maxDuration ||
    draft.maxPrice !== DEFAULT_FILTERS.maxPrice;

  const handleApply = () => {
    onApply(draft);
    onClose();
  };

  const handleReset = () => {
    setDraft(DEFAULT_FILTERS);
    onApply(DEFAULT_FILTERS);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.handle} />

          {/* Header */}
          <View style={s.header}>
            <Text style={s.title}>Filter Treks</Text>
            <View style={s.headerActions}>
              {isDirty && (
                <TouchableOpacity
                  onPress={() => setDraft(DEFAULT_FILTERS)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Clear selections"
                  style={s.iconBtn}>
                  <RotateCcw size={16} color={C.textSub} strokeWidth={2} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={onClose}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close filters"
                style={s.iconBtn}>
                <X size={18} color={C.textSub} strokeWidth={2} />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <OptionChips
              label="Difficulty"
              options={DIFFICULTY_OPTIONS}
              value={draft.difficulty}
              onChange={difficulty => setDraft(d => ({ ...d, difficulty }))}
            />

            <OptionChips
              label="Duration"
              segmented
              options={DURATION_OPTIONS}
              value={draft.maxDuration}
              onChange={maxDuration => setDraft(d => ({ ...d, maxDuration }))}
            />

            <OptionChips
              label="Budget"
              segmented
              options={PRICE_OPTIONS}
              value={draft.maxPrice}
              onChange={maxPrice => setDraft(d => ({ ...d, maxPrice }))}
            />

            {/* Buttons */}
            <View style={s.btnRow}>
              <TouchableOpacity onPress={handleReset} style={s.resetBtn}>
                <Text style={s.resetText}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleApply} style={s.applyBtn}>
                <Text style={s.applyText}>Apply Filter</Text>
              </TouchableOpacity>
            </View>
            <View style={{ height: 24 }} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 14,
    maxHeight: '88%',
    borderTopWidth: 1,
    borderColor: C.border,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: 'center',
    marginBottom: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: C.white, fontSize: 19, fontWeight: '700' },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  resetBtn: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
  },
  resetText: { color: C.textSub, fontSize: 15, fontWeight: '600' },
  applyBtn: {
    flex: 2,
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: C.brand,
  },
  applyText: { color: C.white, fontSize: 15, fontWeight: '700' },
});
