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

export interface ChatFilterState {
  difficulty: string;
  maxDuration: number;
  minOpenSpots: number;
}

export const DEFAULT_CHAT_FILTERS: ChatFilterState = {
  difficulty: 'All',
  maxDuration: 21,
  minOpenSpots: 0,
};

const DIFFICULTY_OPTIONS: ChipOption<string>[] = [
  { label: 'All', value: 'All' },
  { label: 'Easy', value: 'Easy' },
  { label: 'Moderate', value: 'Moderate' },
  { label: 'Hard', value: 'Hard' },
];

/** Mirrors the treks filter's duration bands — the catalogue runs to 20 days. */
const DURATION_OPTIONS: ChipOption<number>[] = [
  { label: 'Any', value: 21 },
  { label: '≤ 5d', value: 5 },
  { label: '≤ 10d', value: 10 },
  { label: '≤ 14d', value: 14 },
  { label: '≤ 20d', value: 20 },
];

const CAPACITY_OPTIONS: ChipOption<number>[] = [
  { label: 'Any', value: 0, hint: 'Include full groups' },
  { label: '1+ open', value: 1 },
  { label: '3+ open', value: 3 },
  { label: '5+ open', value: 5 },
];

interface ChatFilterModalProps {
  visible: boolean;
  onClose: () => void;
  onApply: (filters: ChatFilterState) => void;
  current: ChatFilterState;
}

export default function ChatFilterModal({ visible, onClose, onApply, current }: ChatFilterModalProps) {
  const [draft, setDraft] = useState<ChatFilterState>(current);

  // Re-seed the draft each time the sheet opens, so a dismissal without
  // applying doesn't leave stale selections showing next time it's opened.
  useEffect(() => {
    if (visible) setDraft(current);
  }, [visible, current]);

  const isDirty =
    draft.difficulty !== DEFAULT_CHAT_FILTERS.difficulty ||
    draft.maxDuration !== DEFAULT_CHAT_FILTERS.maxDuration ||
    draft.minOpenSpots !== DEFAULT_CHAT_FILTERS.minOpenSpots;

  const handleApply = () => {
    onApply(draft);
    onClose();
  };

  const handleReset = () => {
    setDraft(DEFAULT_CHAT_FILTERS);
    onApply(DEFAULT_CHAT_FILTERS);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.handle} />

          <View style={s.header}>
            <Text style={s.title}>Filter Groups</Text>
            <View style={s.headerActions}>
              {isDirty && (
                <TouchableOpacity
                  onPress={() => setDraft(DEFAULT_CHAT_FILTERS)}
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
              label="Trek Duration"
              segmented
              options={DURATION_OPTIONS}
              value={draft.maxDuration}
              onChange={maxDuration => setDraft(d => ({ ...d, maxDuration }))}
            />

            <OptionChips
              label="Capacity"
              segmented
              options={CAPACITY_OPTIONS}
              value={draft.minOpenSpots}
              onChange={minOpenSpots => setDraft(d => ({ ...d, minOpenSpots }))}
            />

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
