import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { ArrowLeft, PlusCircle, AlertTriangle, CalendarDays, X } from 'lucide-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import LocationInput from '@/components/LocationInput';
import CalendarPickerModal from '@/components/CalendarPickerModal';
import { DESTINATIONS } from '@/data/destinations';
import { createChatRoom } from '@/lib/chatService';
import { C } from '@/constants/theme';

/** `YYYY-MM-DD`, in local time — not `toISOString()`, which shifts to UTC and can land on the wrong day. */
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** `Aug 4, 2026` for a date field's display value. */
function formatDisplayDate(d: Date): string {
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

/** Whole days spanned by a start/end pair, inclusive of both ends — matches how a trek's own `durationDays` counts. */
function spanDays(start: Date, end: Date): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
}

const DESTINATION_NAMES = DESTINATIONS.map(d => d.displayTitle || d.parentName);

export default function NewExpeditionScreen() {
  const { trekId: paramTrekId, trekName } = useLocalSearchParams<{
    trekId?: string;
    trekName?: string;
  }>();

  // Opened from a trek's own page: the destination is already known and
  // shouldn't be changed to a different route from this form.
  const destinationLocked = !!paramTrekId;

  const [name, setName] = useState(trekName ? `${trekName} Group` : '');
  const [destinationText, setDestinationText] = useState(trekName ?? '');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState<'start' | 'end' | null>(null);
  const [maxMembersText, setMaxMembersText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Resolved once, from whichever destination is currently selected — either
  // locked from the trek page, or matched by name against the catalogue.
  const resolvedTrek = useMemo(() => {
    if (paramTrekId) return DESTINATIONS.find(t => t.id === paramTrekId) ?? null;
    const q = destinationText.trim().toLowerCase();
    if (!q) return null;
    return (
      DESTINATIONS.find(
        t => (t.displayTitle || t.parentName).toLowerCase() === q,
      ) ?? null
    );
  }, [paramTrekId, destinationText]);

  // The itinerary/Explore pages already establish how many days this trek
  // actually takes — a group chat's date range shouldn't be settable to
  // anything shorter, since that's a real-world impossibility (a 10-day
  // trek cannot be planned for a single day) rather than a matter of taste.
  const requiredDays = resolvedTrek?.durationDays ?? 1;
  const minEndDate = startDate ? addDays(startDate, requiredDays - 1) : undefined;

  // A trek swap (or a start-date change) can leave a previously valid end
  // date now too soon — cleared rather than left to silently violate the
  // constraint until submit.
  useEffect(() => {
    if (startDate && endDate && spanDays(startDate, endDate) < requiredDays) {
      setEndDate(null);
    }
  }, [startDate, endDate, requiredDays]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/chatroom');
  };

  const handleSubmit = async () => {
    if (busy) return;
    setError('');

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Give the group a name.');
      return;
    }
    if (!resolvedTrek) {
      setError('Pick a destination from the list.');
      return;
    }
    const maxMembers = parseInt(maxMembersText, 10);
    if (!Number.isFinite(maxMembers) || maxMembers < 1) {
      setError('Total members expected must be at least 1.');
      return;
    }

    if ((startDate && !endDate) || (!startDate && endDate)) {
      setError('Pick both a start and end date, or leave them both unset.');
      return;
    }
    if (startDate && endDate && startDate > endDate) {
      setError('Start date must be before the end date.');
      return;
    }
    if (startDate && endDate && spanDays(startDate, endDate) < requiredDays) {
      setError(`This trek takes ${requiredDays} day${requiredDays === 1 ? '' : 's'} — pick a wider date range.`);
      return;
    }

    setBusy(true);
    const { room, error: createError } = await createChatRoom({
      trekId: resolvedTrek.id,
      roomName: trimmedName,
      maxMembers,
      startDate: startDate ? toIsoDate(startDate) : undefined,
      endDate: endDate ? toIsoDate(endDate) : undefined,
    });
    setBusy(false);

    if (room) router.replace(`/chat/${room.id}`);
    else setError(createError ?? 'Could not create the group.');
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <View style={s.header}>
        <TouchableOpacity
          onPress={goBack}
          hitSlop={10}
          style={s.headerBack}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <ArrowLeft size={20} color={C.white} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>New Expedition</Text>
      </View>

      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Text style={s.label}>Group Chat Name</Text>
        <TextInput
          style={s.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Peak Baggers 2024"
          placeholderTextColor={C.textFaint}
          maxLength={160}
        />

        {destinationLocked ? (
          <>
            <Text style={s.label}>Trekking Destination</Text>
            <View style={s.lockedField}>
              <Text style={s.lockedFieldText}>{trekName}</Text>
            </View>
          </>
        ) : (
          <LocationInput
            label="Trekking Destination"
            placeholder="Search location or trail..."
            value={destinationText}
            onChangeText={setDestinationText}
            locations={DESTINATION_NAMES}
          />
        )}

        <View style={s.row}>
          <View style={s.rowField}>
            <Text style={s.label}>Start Date</Text>
            <TouchableOpacity
              style={s.dateField}
              onPress={() => setDatePickerOpen('start')}
              accessibilityRole="button"
              accessibilityLabel={startDate ? `Start date: ${formatDisplayDate(startDate)}` : 'Pick a start date'}>
              <CalendarDays size={15} color={C.textFaint} strokeWidth={2} />
              <Text style={[s.dateFieldText, !startDate && s.dateFieldPlaceholder]} numberOfLines={1}>
                {startDate ? formatDisplayDate(startDate) : 'Optional'}
              </Text>
              {startDate && (
                <TouchableOpacity
                  onPress={() => setStartDate(null)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Clear start date">
                  <X size={13} color={C.textFaint} strokeWidth={2.5} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>
          <View style={s.rowField}>
            <Text style={s.label}>End Date</Text>
            <TouchableOpacity
              style={s.dateField}
              onPress={() => setDatePickerOpen('end')}
              accessibilityRole="button"
              accessibilityLabel={endDate ? `End date: ${formatDisplayDate(endDate)}` : 'Pick an end date'}>
              <CalendarDays size={15} color={C.textFaint} strokeWidth={2} />
              <Text style={[s.dateFieldText, !endDate && s.dateFieldPlaceholder]} numberOfLines={1}>
                {endDate ? formatDisplayDate(endDate) : 'Optional'}
              </Text>
              {endDate && (
                <TouchableOpacity
                  onPress={() => setEndDate(null)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Clear end date">
                  <X size={13} color={C.textFaint} strokeWidth={2.5} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>
        </View>
        {resolvedTrek && (
          <Text style={s.durationHint}>
            {resolvedTrek.displayTitle || resolvedTrek.parentName} takes {requiredDays} day
            {requiredDays === 1 ? '' : 's'} — the date range must span at least that.
          </Text>
        )}

        <Text style={s.label}>Total Members Expected</Text>
        <TextInput
          style={s.input}
          value={maxMembersText}
          onChangeText={t => setMaxMembersText(t.replace(/[^0-9]/g, ''))}
          placeholder="e.g. 4"
          placeholderTextColor={C.textFaint}
          keyboardType="number-pad"
          maxLength={3}
        />

        {error !== '' && (
          <View style={s.errorBox}>
            <AlertTriangle size={14} color={C.red} strokeWidth={2} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          onPress={handleSubmit}
          disabled={busy}
          style={[s.submitBtn, busy && s.submitBtnBusy]}
          accessibilityRole="button"
          accessibilityLabel="Create Group">
          {busy ? (
            <ActivityIndicator size="small" color={C.white} />
          ) : (
            <>
              <PlusCircle size={18} color={C.white} strokeWidth={2} />
              <Text style={s.submitBtnText}>Create Group</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>

      <CalendarPickerModal
        visible={datePickerOpen === 'start'}
        onClose={() => setDatePickerOpen(null)}
        value={startDate}
        onSelect={d => {
          setStartDate(d);
          // Pushing the start date past a chosen end date would silently make
          // the range invalid, so it's cleared rather than left to fail
          // validation on submit.
          if (endDate && d > endDate) setEndDate(null);
        }}
        title="Start Date"
      />
      <CalendarPickerModal
        visible={datePickerOpen === 'end'}
        onClose={() => setDatePickerOpen(null)}
        value={endDate}
        onSelect={setEndDate}
        title="End Date"
        minDate={minEndDate}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: Platform.OS === 'ios' ? 58 : 44,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerBack: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { color: C.white, fontSize: 17, fontWeight: '700' },

  body: { padding: 20, paddingBottom: 60 },

  label: {
    color: C.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  input: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 46,
    color: C.white,
    fontSize: 14,
    marginBottom: 16,
  },

  lockedField: {
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 46,
    justifyContent: 'center',
    marginBottom: 16,
  },
  lockedFieldText: { color: C.textSub, fontSize: 14 },

  row: { flexDirection: 'row', gap: 12 },
  rowField: { flex: 1 },
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 46,
    marginBottom: 16,
  },
  dateFieldText: { flex: 1, color: C.white, fontSize: 13 },
  dateFieldPlaceholder: { color: C.textFaint },
  durationHint: { color: C.textFaint, fontSize: 11, marginTop: -6, marginBottom: 16, lineHeight: 16 },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.30)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  errorText: { color: C.red, fontSize: 12, flex: 1, lineHeight: 18 },

  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.brand,
    paddingVertical: 15,
    borderRadius: 16,
    marginTop: 8,
  },
  submitBtnBusy: { opacity: 0.7 },
  submitBtnText: { color: C.white, fontSize: 15, fontWeight: '700' },
});
