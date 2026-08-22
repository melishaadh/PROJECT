import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Mountain, HeartPulse, Bone, Award } from 'lucide-react-native';
import { router } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { UserProfile } from '@/lib/recommendation';
import { C } from '@/constants/theme';
import { T, optionID } from '@/constants/testIDs';

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
 * A chip row for one scalar answer. No locked state — every answer on this form
 * is freely editable, and the one value that is not (the peer bracket) is
 * derived server-side and never rendered.
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
  /**
   * Namespace for the chips' testIDs — each chip becomes
   * `<prefix>-option-<value>`. Keyed by the numeric value rather than the label
   * so the end-to-end suite selects the answer the profile vector stores, not
   * the wording shown next to it.
   */
  testIDPrefix: string;
}) {
  return (
    <View style={s.group} testID={testIDPrefix}>
      <View style={s.groupHeader}>
        {icon}
        <Text style={s.groupTitle}>{title}</Text>
      </View>
      <View style={s.chipRow}>
        {options.map(o => (
          <TouchableOpacity
            key={o.value}
            onPress={() => onSelect(o.value)}
            testID={optionID(testIDPrefix, o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: selected === o.value }}
            accessibilityLabel={o.label}
            style={[s.chip, selected === o.value && s.chipActive]}
            activeOpacity={0.7}>
            {/*
              Pinned to a single line, so a label can never wrap and leave the
              row two chips tall. `adjustsFontSizeToFit` is the iOS-only safety
              net for a screen narrow enough that even the content-width layout
              runs out of room: it shrinks the offending label instead of
              truncating it.
            */}
            <Text
              style={[s.chipText, selected === o.value && s.chipTextActive]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}>
              {o.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

/**
 * First-run profile capture.
 *
 * This is now *only* the initial pass — a full screen is the right shape for a
 * form somebody has never filled in. Editing preferences afterwards happens in
 * `PreferencesSheet`, which opens over the For You feed, so a returning user
 * never leaves the tab they were on. That is why this screen no longer takes a
 * `returnTo` parameter: there is only one place to go from here, which is into
 * the app.
 */
export default function OnboardingScreen() {
  const { saveProfile, profile, isOnboarded } = useAuth();

  /**
   * Whether this is a return visit. Used only to word the heading — it stands in
   * for the old `ageGroupLocked` check, which leaked the existence of the
   * bracket into the copy.
   */
  const hasSavedProfile = isOnboarded;

  /**
   * Carried, never edited or rendered. The backend re-derives the peer bracket
   * from the account's date of birth on every save, so this is echoed back
   * purely to keep the payload shape intact.
   */
  const [ageGroup, setAgeGroup] = useState(profile?.ageGroup ?? 1);
  const [experienceLevel, setExperienceLevel] = useState(profile?.experienceLevel ?? 1);
  const [cardioFlag, setCardioFlag] = useState(profile?.cardioFlag ?? 1);
  const [jointFlag, setJointFlag] = useState(profile?.jointFlag ?? 1);
  const [altitudeHistory, setAltitudeHistory] = useState(profile?.altitudeHistory ?? 1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the form once the profile has been fetched. Without this, arriving
  // here before the profile resolves would show defaults and silently save
  // them over the user's real answers.
  useEffect(() => {
    if (!profile) return;
    setAgeGroup(profile.ageGroup);
    setExperienceLevel(profile.experienceLevel);
    setCardioFlag(profile.cardioFlag);
    setJointFlag(profile.jointFlag);
    setAltitudeHistory(profile.altitudeHistory);
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const p: UserProfile = {
      ageGroup: profile?.ageGroup ?? ageGroup,
      experienceLevel,
      cardioFlag,
      jointFlag,
      altitudeHistory,
    };
    const { error } = await saveProfile(p);
    setSaving(false);
    if (error) {
      setError(error);
      return;
    }
    // Straight into the app. `replace` rather than `push` so the back
    // gesture cannot return to a form the user has already completed.
    router.replace('/(tabs)');
  };

  return (
    <View style={s.root} testID={T.onboarding.screen}>
      <View style={s.header}>
        <View style={s.logoRow}>
          <View style={s.logoIcon}>
            <Mountain size={22} color={C.brand} strokeWidth={2} />
          </View>
          <Text style={s.logoName}>TrekEasy</Text>
        </View>
        <Text style={s.title}>
          {hasSavedProfile ? 'Update your trek preferences' : 'Complete your trek profile'}
        </Text>
        {/*
          Says nothing about age. The copy used to explain that the bracket was
          derived from the date of birth and locked, which told the user both
          that a cohort existed and that they had been sorted into one.
        */}
        <Text style={s.subtitle}>
          {hasSavedProfile
            ? 'Your preferences can be updated anytime.'
            : 'Answer a few quick questions so we can match you with the best treks for your fitness and experience.'}
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        testID={T.onboarding.scroll}>
        {/*
          No age control.

          The peer bracket still exists and still does the same work — it drives
          the cold-start pool and is the hard boundary the collaborative layer
          refuses to match across — but it is derived from the date of birth
          given at signup and never surfaced. The user is not shown which cohort
          they landed in, is not asked to pick one, and cannot see the ranges.
          `ageGroup` is still submitted below; the backend overwrites it with the
          DOB-derived value on every save, so this form is not the authority on
          it and has nothing to render.
        */}
        <OptionGroup
          icon={<Award size={18} color={C.brand} strokeWidth={2} />}
          title="Experience Level"
          options={EXP_OPTIONS}
          selected={experienceLevel}
          onSelect={setExperienceLevel}
          testIDPrefix={T.onboarding.experience}
        />
        <OptionGroup
          icon={<HeartPulse size={18} color={C.brand} strokeWidth={2} />}
          title="Cardio Fitness"
          options={BINARY_OPTIONS}
          selected={cardioFlag}
          onSelect={setCardioFlag}
          testIDPrefix={T.onboarding.cardio}
        />
        <OptionGroup
          icon={<Bone size={18} color={C.brand} strokeWidth={2} />}
          title="Joint Stability"
          options={BINARY_OPTIONS}
          selected={jointFlag}
          onSelect={setJointFlag}
          testIDPrefix={T.onboarding.joint}
        />
        <OptionGroup
          icon={<Mountain size={18} color={C.brand} strokeWidth={2} />}
          title="Altitude History"
          options={ALT_OPTIONS}
          selected={altitudeHistory}
          onSelect={setAltitudeHistory}
          testIDPrefix={T.onboarding.altitude}
        />

        {error && (
          <View style={s.errorBox}>
            <Text style={s.errorText} testID={T.onboarding.error}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          onPress={handleSave}
          style={[s.saveBtn, saving && { opacity: 0.7 }]}
          testID={T.onboarding.save}
          accessibilityRole="button"
          accessibilityLabel="Save and Continue"
          accessibilityState={{ busy: saving, disabled: saving }}
          disabled={saving}>
          {saving
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={s.saveText}>Save & Continue</Text>}
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 24, paddingTop: 64, paddingBottom: 16 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 24 },
  logoIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: 'rgba(15,82,56,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(15,82,56,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoName: { color: C.white, fontSize: 17, fontWeight: '700' },
  title: { color: C.white, fontSize: 24, fontWeight: '700', marginBottom: 8 },
  subtitle: { color: C.textFaint, fontSize: 14, lineHeight: 21 },
  scroll: { paddingHorizontal: 24, paddingTop: 8 },
  group: { marginBottom: 28 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  groupTitle: { color: C.white, fontSize: 15, fontWeight: '600', flex: 1 },
  // No `flexWrap`: the four experience options are meant to stay on one line.
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: {
    /*
      `flexGrow` rather than `flex: 1`, which would zero the basis and hand every
      chip an identical quarter of the row — too narrow for "Intermediate" once
      padding and borders come off it, while "Expert" sat in a box half empty.
      Growing from the content width instead means the long label keeps what it
      needs and the slack is shared out from there, so the row still fills the
      screen edge to edge.
    */
    flexGrow: 1,
    flexShrink: 1,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: C.brand, borderColor: C.brand },
  chipText: { color: C.textSub, fontSize: 12, fontWeight: '500', textAlign: 'center' },
  chipTextActive: { color: C.white, fontWeight: '700' },
  errorBox: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: { color: '#ef4444', fontSize: 13 },
  saveBtn: {
    backgroundColor: C.brand,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  saveText: { color: C.white, fontSize: 15, fontWeight: '700' },
});
