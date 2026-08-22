import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { X, Mountain, HeartPulse, Bone, Award } from 'lucide-react-native';
import { useAuth } from '@/context/AuthContext';
import { UserProfile } from '@/lib/recommendation';
import { C } from '@/constants/theme';
import { T, optionID } from '@/constants/testIDs';

/**
 * Trek preferences, edited in place.
 *
 * This exists so the For You feed can offer preference editing without
 * navigating anywhere. Sending the user to the onboarding route to change one
 * answer meant leaving the feed, watching a full-screen form push in, saving,
 * and being routed back — and the return path was a `router.replace` that
 * frequently landed on Explore rather than where they started. A sheet over the
 * feed has none of that: the feed stays mounted underneath, and saving re-ranks
 * it in place.
 *
 * The onboarding screen still exists for the initial pass, where a full-screen
 * form is the right shape. This is the *edit* affordance.
 */

interface Option {
  label: string;
  value: number;
}

const EXP_OPTIONS: Option[] = [
  { label: 'Beginner', value: 0 },
  { label: 'Intermediate', value: 1 },
  { label: 'Advanced', value: 2 },
  { label: 'Expert', value: 3 },
];

const ALT_OPTIONS: Option[] = [
  { label: 'None', value: 0 },
  { label: 'Basic', value: 1 },
  { label: 'Moderate', value: 2 },
  { label: 'Extensive', value: 3 },
];

const BINARY_OPTIONS: Option[] = [
  { label: 'Poor', value: 0 },
  { label: 'Good', value: 1 },
];

/**
 * A chip row for one scalar answer.
 *
 * It has no locked state: every answer on this form is freely editable. The one
 * value that is not (the peer bracket) is derived server-side from the date of
 * birth and is never shown or offered here.
 */
function OptionGroup({
  icon,
  title,
  options,
  selected,
  onSelect,
  testIDPrefix,
}: {
  icon: React.ReactNode;
  title: string;
  options: Option[];
  selected: number;
  onSelect: (v: number) => void;
  /** Namespace for the chips' testIDs — `<prefix>-option-<value>`. */
  testIDPrefix: string;
}) {
  return (
    <View style={s.group} testID={testIDPrefix}>
      <View style={s.groupHeader}>
        {icon}
        <Text style={s.groupTitle}>{title}</Text>
      </View>
      <View style={s.chipRow}>
        {options.map(o => {
          const active = selected === o.value;
          return (
            <TouchableOpacity
              key={o.value}
              onPress={() => onSelect(o.value)}
              activeOpacity={0.7}
              testID={optionID(testIDPrefix, o.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={o.label}
              style={[s.chip, active && s.chipActive]}>
              {/* One line always — see the matching note in `app/onboarding.tsx`. */}
              <Text
                style={[s.chipText, active && s.chipTextActive]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}>
                {o.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

interface PreferencesSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Fired after a successful save, so the caller can re-rank its feed. */
  onSaved?: () => void;
}

export default function PreferencesSheet({ visible, onClose, onSaved }: PreferencesSheetProps) {
  const { profile, saveProfile } = useAuth();

  const [ageGroup, setAgeGroup] = useState(profile?.ageGroup ?? 1);
  const [experienceLevel, setExperienceLevel] = useState(profile?.experienceLevel ?? 1);
  const [cardioFlag, setCardioFlag] = useState(profile?.cardioFlag ?? 1);
  const [jointFlag, setJointFlag] = useState(profile?.jointFlag ?? 1);
  const [altitudeHistory, setAltitudeHistory] = useState(profile?.altitudeHistory ?? 1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Re-seed the draft every time the sheet opens. Without this, editing,
   * dismissing without saving and reopening would show the abandoned edits as
   * though they had been applied.
   */
  useEffect(() => {
    if (!visible || !profile) return;
    setAgeGroup(profile.ageGroup);
    setExperienceLevel(profile.experienceLevel);
    setCardioFlag(profile.cardioFlag);
    setJointFlag(profile.jointFlag);
    setAltitudeHistory(profile.altitudeHistory);
    setError(null);
  }, [visible, profile]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);

    const payload: UserProfile = {
      // Echoed back untouched. The backend re-derives the peer bracket from the
      // date of birth, so this form is not the authority on it.
      ageGroup: profile?.ageGroup ?? ageGroup,
      experienceLevel,
      cardioFlag,
      jointFlag,
      altitudeHistory,
    };

    const { error: saveError } = await saveProfile(payload);
    setSaving(false);

    if (saveError) {
      // Stay open on failure so the edits are not silently lost.
      setError(saveError);
      return;
    }
    onSaved?.();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}} testID={T.preferences.sheet}>
          <View style={s.handle} />

          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Trek Preferences</Text>
              <Text style={s.subtitle}>Your feed re-ranks as soon as you save</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close preferences"
              testID={T.preferences.close}
              style={s.closeBtn}>
              <X size={18} color={C.textSub} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.body}
            testID={T.preferences.scroll}>
            {/*
              No age control — see the matching note in `app/onboarding.tsx`.
              The bracket is derived from the date of birth and never shown.
            */}
            <OptionGroup
              icon={<Award size={18} color={C.brand} strokeWidth={2} />}
              title="Experience Level"
              options={EXP_OPTIONS}
              selected={experienceLevel}
              onSelect={setExperienceLevel}
              testIDPrefix={T.preferences.experience}
            />
            <OptionGroup
              icon={<HeartPulse size={18} color={C.brand} strokeWidth={2} />}
              title="Cardio Fitness"
              options={BINARY_OPTIONS}
              selected={cardioFlag}
              onSelect={setCardioFlag}
              testIDPrefix={T.preferences.cardio}
            />
            <OptionGroup
              icon={<Bone size={18} color={C.brand} strokeWidth={2} />}
              title="Joint Stability"
              options={BINARY_OPTIONS}
              selected={jointFlag}
              onSelect={setJointFlag}
              testIDPrefix={T.preferences.joint}
            />
            <OptionGroup
              icon={<Mountain size={18} color={C.brand} strokeWidth={2} />}
              title="Altitude History"
              options={ALT_OPTIONS}
              selected={altitudeHistory}
              onSelect={setAltitudeHistory}
              testIDPrefix={T.preferences.altitude}
            />

            {error && (
              <View style={s.errorBox}>
                <Text style={s.errorText} testID={T.preferences.error}>{error}</Text>
              </View>
            )}

            {/* Disabled while in flight, so a double-tap cannot fire two saves. */}
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              style={[s.saveBtn, saving && s.saveBtnBusy]}
              accessibilityRole="button"
              accessibilityLabel="Save preferences"
              testID={T.preferences.save}
              accessibilityState={{ busy: saving, disabled: saving }}>
              {saving ? (
                <ActivityIndicator size="small" color={C.white} />
              ) : (
                <Text style={s.saveText}>Save Preferences</Text>
              )}
            </TouchableOpacity>

            <View style={{ height: 24 }} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 14,
    maxHeight: '90%',
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 22,
  },
  title: { color: C.white, fontSize: 19, fontWeight: '700' },
  subtitle: { color: C.textFaint, fontSize: 12, marginTop: 3 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { paddingBottom: 8 },

  group: { marginBottom: 24 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  groupTitle: { color: C.white, fontSize: 15, fontWeight: '600', flex: 1 },

  // No `flexWrap` — the four options stay on one line. See `app/onboarding.tsx`
  // for why the chips grow from their content width rather than splitting the
  // row into equal quarters.
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: {
    flexGrow: 1,
    flexShrink: 1,
    paddingHorizontal: 8,
    paddingVertical: 9,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: C.brand, borderColor: C.brand },
  chipText: { color: C.textSub, fontSize: 12, fontWeight: '500', textAlign: 'center' },
  chipTextActive: { color: C.white, fontWeight: '700' },

  errorBox: {
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.30)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  errorText: { color: C.red, fontSize: 13 },

  saveBtn: {
    backgroundColor: C.brand,
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  saveBtnBusy: { opacity: 0.7 },
  saveText: { color: C.white, fontSize: 15, fontWeight: '700' },
});
