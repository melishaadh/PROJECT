import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  StyleSheet,
  Platform,
} from 'react-native';
import {
  ArrowLeft, ArrowRight, AlertTriangle, Mountain, Clock, Route, TrendingUp, RotateCcw,
  Lock, LogIn, SlidersHorizontal, Plane, Bus,
} from 'lucide-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import OptionChips, { ChipOption } from '@/components/OptionChips';
import LocationInput from '@/components/LocationInput';
import { DESTINATIONS } from '@/data/destinations';
import { useAuth } from '@/context/AuthContext';
import { C, DIFFICULTY_COLOR } from '@/constants/theme';
import {
  generate as generateItinerary,
  getLocations,
  ItineraryTimeoutError,
  ItineraryCancelledError,
  ItineraryPreferencesRequiredError,
  PersonalizedItinerary,
  ItineraryDay,
  ActivityDetail,
  TransferOption,
} from '@/lib/itineraryApi';

type Pace = 'slow' | 'normal' | 'fast';
type Fitness = 'beginner' | 'intermediate' | 'advanced' | 'expert';
type Experience = 'none' | 'basic' | 'moderate' | 'extensive';

const PACE_OPTIONS: ChipOption<Pace>[] = [
  { label: 'Slow', value: 'slow' },
  { label: 'Normal', value: 'normal' },
  { label: 'Fast', value: 'fast' },
];

const FITNESS_OPTIONS: ChipOption<Fitness>[] = [
  { label: 'Beginner', value: 'beginner' },
  { label: 'Intermediate', value: 'intermediate' },
  { label: 'Advanced', value: 'advanced' },
  { label: 'Expert', value: 'expert' },
];

const EXPERIENCE_OPTIONS: ChipOption<Experience>[] = [
  { label: 'None', value: 'none' },
  { label: 'Basic', value: 'basic' },
  { label: 'Moderate', value: 'moderate' },
  { label: 'Extensive', value: 'extensive' },
];

/** Human label per activity type, matching the engine's `ActivityDetail.type`. */
const ACTIVITY_LABEL: Record<string, string> = {
  road_travel: 'Drive',
  flight: 'Fly',
  trekking: 'Trek',
  rest: 'Rest',
  acclimatization: 'Acclimatize',
  checkpoint_stop: 'Stop',
  meal_break: 'Meal',
  recovery_break: 'Recover',
  sightseeing: 'Explore',
};

/** Reuses the palette's semantic colours rather than introducing new ones. */
const ACTIVITY_COLOR: Record<string, string> = {
  trekking: C.brandLight,
  rest: C.amber,
  acclimatization: C.amber,
  recovery_break: C.amber,
  road_travel: C.blue,
  flight: C.blue,
};

const SUITABILITY_COLOR: Record<string, string> = {
  High: C.green,
  Moderate: C.amber,
  Low: C.red,
};

interface Draft {
  pace: Pace;
  fitnessLevel: Fitness;
  trekkingExperience: Experience;
  targetDays: string;
  startLocation: string;
  finalDestination: string;
  age: string;
  weight: string;
  groupSize: string;
}

/** A labelled numeric field, styled like the rest of the app's inputs. */
function NumberField({
  label, placeholder, value, onChangeText,
}: {
  label: string; placeholder: string; value: string; onChangeText: (t: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={s.fieldWrap}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={[s.fieldBox, focused && s.fieldBoxFocused]}>
        <TextInput
          style={s.fieldInput}
          placeholder={placeholder}
          placeholderTextColor={C.textFaint}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          underlineColorAndroid="transparent"
          selectionColor={C.brand}
        />
      </View>
    </View>
  );
}

function StatTile({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <View style={s.statTile}>
      {icon}
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

/**
 * The ways a transfer leg can be made.
 *
 * Getting from a city to a trailhead is often a real choice — the flight to
 * Pokhara saves the better part of a day, the bus costs a fraction and does not
 * get grounded by cloud — so the plan shows both rather than picking silently.
 * The engine still costs the day against one of them; that one is marked, and
 * the rest are the traveller's to take instead.
 */
function TransferOptions({ options }: { options: TransferOption[] }) {
  return (
    <View style={s.optWrap}>
      {options.length > 1 && (
        <Text style={s.optHeading}>{options.length} ways to make this leg</Text>
      )}

      {options.map((o, i) => {
        const isFlight = o.mode === 'flight';
        return (
          <View key={`${o.mode}-${i}`} style={[s.optCard, o.recommended && s.optCardPicked]}>
            <View style={s.optHeader}>
              {isFlight
                ? <Plane size={13} color={C.blue} strokeWidth={2} />
                : <Bus size={13} color={C.green} strokeWidth={2} />}
              <Text style={s.optMode}>{isFlight ? 'Fly' : 'By road'}</Text>
              <Text style={s.optTime}>{formatHours(o.durationHours)}</Text>
              {o.distanceKm > 0 && <Text style={s.optDist}>{o.distanceKm} km</Text>}
              {options.length > 1 && o.recommended && (
                <Text style={s.optBadge}>In this plan</Text>
              )}
            </View>
            <Text style={s.optDetail}>{o.detail}</Text>
            {!!o.caution && (
              <View style={s.optCaution}>
                <AlertTriangle size={11} color={C.amber} strokeWidth={2} />
                <Text style={s.optCautionText}>{o.caution}</Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

/** "1.9h" reads as a decimal nobody thinks in; "1 h 55 m" is the same fact. */
function formatHours(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function ActivityRow({ activity, isLast }: { activity: ActivityDetail; isLast: boolean }) {
  const color = ACTIVITY_COLOR[activity.type] ?? C.textFaint;
  const label = ACTIVITY_LABEL[activity.type] ?? activity.type;
  const options = activity.options ?? [];
  // The option cards restate the leg in full, so the engine's one-line
  // description ("Fly from Kathmandu to Pokhara") would only be noise.
  const showDescription =
    !!activity.description
    && options.length === 0
    && activity.type !== 'rest'
    && activity.type !== 'acclimatization';

  return (
    <View style={s.actRow}>
      <View style={s.actGutter}>
        <View style={[s.actDot, { backgroundColor: color }]} />
        {!isLast && <View style={s.actLine} />}
      </View>
      <View style={s.actBody}>
        <View style={s.actHeader}>
          {/*
            A leg with a real choice is a "Transfer", not a "Fly" — naming it
            after one mode while offering two reads as a decision already made.
          */}
          <Text style={[s.actType, { color }]}>
            {options.length > 1 ? 'Transfer' : label}
          </Text>
          {/* Suppressed when options render: they carry the same figures. */}
          {options.length === 0 && activity.durationHours > 0 && (
            <Text style={s.actMeta}>{activity.durationHours.toFixed(1)}h</Text>
          )}
          {options.length === 0 && activity.distance > 0 && (
            <Text style={s.actMeta}>{activity.distance.toFixed(1)} km</Text>
          )}
        </View>
        <Text style={s.actRoute}>
          {activity.from === activity.to ? activity.from : `${activity.from} → ${activity.to}`}
        </Text>
        {showDescription && <Text style={s.actDesc}>{activity.description}</Text>}
        {options.length > 0 && <TransferOptions options={options} />}
      </View>
    </View>
  );
}

/**
 * One day card. Mirrors the static itinerary rows on the trek detail screen —
 * numbered dot on the left, card on the right — so a generated plan reads as
 * the same object as the published one.
 */
function DayCard({ day }: { day: ItineraryDay }) {
  const isRestDay = day.activities.every(
    a => a.type === 'rest' || a.type === 'acclimatization',
  );

  return (
    <View style={s.dayRow}>
      <View style={s.dayGutter}>
        <View style={[s.dayDot, isRestDay && s.dayDotRest]}>
          <Text style={s.dayDotText}>{day.day}</Text>
        </View>
        <View style={s.dayLine} />
      </View>

      <View style={s.dayCard}>
        <Text style={s.dayTitle}>
          {isRestDay
            ? day.overnightLocation || 'Rest day'
            : `${day.activities[0]?.from ?? ''} → ${day.overnightLocation || ''}`}
        </Text>

        <View style={s.dayMetaRow}>
          {day.totalHours > 0 && <Text style={s.dayMeta}>{day.totalHours.toFixed(1)}h</Text>}
          {day.totalDistance > 0 && (
            <Text style={s.dayMeta}>{day.totalDistance.toFixed(1)} km</Text>
          )}
          {day.totalElevationGain > 0 && (
            <Text style={[s.dayMeta, s.dayMetaGain]}>
              +{Math.round(day.totalElevationGain)}m
            </Text>
          )}
        </View>

        <View style={s.dayActivities}>
          {day.activities.map((a, i) => (
            <ActivityRow key={`${a.type}-${i}`} activity={a} isLast={i === day.activities.length - 1} />
          ))}
        </View>

        {day.notes.map((note, i) => (
          <View key={i} style={s.dayNote}>
            <AlertTriangle size={13} color={C.amber} strokeWidth={2} />
            <Text style={s.dayNoteText}>{note}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Full-screen access guard. Used for both the signed-out and the
 * preferences-not-set cases so the two read as the same kind of stop.
 */
function ItineraryGate({
  icon, title, message, onBack, primary, secondary,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
  onBack: () => void;
  primary: { label: string; onPress: () => void; icon?: React.ReactNode };
  secondary?: { label: string; onPress: () => void };
}) {
  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.header}>
        <TouchableOpacity
          onPress={onBack}
          hitSlop={10}
          style={s.headerBack}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <ArrowLeft size={20} color={C.white} strokeWidth={2} />
        </TouchableOpacity>
        <View style={s.headerTitleWrap}>
          <Text style={s.headerTitle}>Itinerary</Text>
        </View>
      </View>

      <View style={s.gateState}>
        <View style={s.gateIcon}>{icon}</View>
        <Text style={s.gateTitle}>{title}</Text>
        <Text style={s.gateSub}>{message}</Text>
        <TouchableOpacity
          onPress={primary.onPress}
          style={s.gateCta}
          accessibilityRole="button"
          accessibilityLabel={primary.label}>
          {primary.icon}
          <Text style={s.gateCtaText}>{primary.label}</Text>
        </TouchableOpacity>
        {secondary && (
          <TouchableOpacity
            onPress={secondary.onPress}
            style={s.gateSecondary}
            accessibilityRole="button"
            accessibilityLabel={secondary.label}>
            <Text style={s.gateSecondaryText}>{secondary.label}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

export default function ItineraryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trekId = Array.isArray(id) ? id[0] : id;
  const { isLoggedIn, isOnboarded } = useAuth();

  // The trek's published length comes from the app's own catalogue rather than
  // a deep-link query param, so the planner is seeded correctly however it was
  // reached and the two can never disagree.
  const trek = useMemo(() => DESTINATIONS.find(t => t.id === trekId), [trekId]);

  const [data, setData] = useState<PersonalizedItinerary | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [locations, setLocations] = useState<string[]>([]);

  // Request lifecycle. `requestSeq` orders generates so a slow earlier response
  // can be discarded; `inFlight` lets a new generate abort the previous fetch;
  // `mounted` stops a late response writing state into a screen the user left.
  const requestSeq = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const scrollRef = useRef<ScrollView>(null);

  const [draft, setDraft] = useState<Draft>({
    pace: 'normal',
    fitnessLevel: 'beginner',
    trekkingExperience: 'none',
    targetDays: trek ? String(trek.durationDays) : '',
    startLocation: '',
    finalDestination: '',
    age: '',
    weight: '',
    groupSize: '',
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      inFlight.current?.abort();
    };
  }, []);

  useEffect(() => {
    let active = true;
    getLocations().then(list => { if (active) setLocations(list); });
    return () => { active = false; };
  }, []);

  // Opening the planner for a different trek re-seeds the duration and clears
  // the previous plan, so a stale itinerary can't sit under a new trek's header.
  useEffect(() => {
    inFlight.current?.abort();
    requestSeq.current++;
    setData(null);
    setError('');
    setBusy(false);
    setDraft(prev => ({ ...prev, targetDays: trek ? String(trek.durationDays) : '' }));
  }, [trekId, trek]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft(prev => ({ ...prev, [key]: value }));

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  const handleGenerate = useCallback(async () => {
    if (!trekId) return;

    // Supersede any generate still in flight. Without this, two taps race and
    // whichever response lands *last* wins — so a slow earlier request could
    // overwrite the newer plan with day cards for preferences already changed.
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const seq = ++requestSeq.current;
    const isCurrent = () => seq === requestSeq.current && mounted.current;

    setBusy(true);
    setError('');
    setData(null);

    try {
      const result = await generateItinerary(trekId, {
        pace: draft.pace,
        fitnessLevel: draft.fitnessLevel,
        trekkingExperience: draft.trekkingExperience,
        targetDays: draft.targetDays ? parseInt(draft.targetDays, 10) : undefined,
        age: draft.age ? parseInt(draft.age, 10) : undefined,
        weight: draft.weight ? parseInt(draft.weight, 10) : undefined,
        groupSize: draft.groupSize ? parseInt(draft.groupSize, 10) : undefined,
        startLocation: draft.startLocation.trim() || undefined,
        finalDestination: draft.finalDestination.trim() || draft.startLocation.trim() || undefined,
      }, controller.signal);

      if (!isCurrent()) return;
      setData(result);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    } catch (e) {
      // A cancelled request was replaced on purpose — the newer one owns the UI
      // now, so saying nothing is correct.
      if (e instanceof ItineraryCancelledError || !isCurrent()) return;
      // The server's own preferences gate. Reaching it means the local
      // `isOnboarded` was stale (saved on another device, say), so send the
      // user to the form rather than showing a retry that cannot succeed.
      if (e instanceof ItineraryPreferencesRequiredError) {
        setError('');
        router.push('/onboarding');
        return;
      }
      setError(
        e instanceof ItineraryTimeoutError
          ? 'This is taking longer than expected. Complex treks can be slow to plan — please try again.'
          : 'Could not generate your itinerary. Check your connection and try again.',
      );
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }, [trekId, draft]);

  /*
    Access gates, checked before anything itinerary-shaped can render.

    Order matters: authentication first, because a guest has no preferences to
    have set. Both sit above the `!trek` check too — an unauthenticated visitor
    should be told to sign in, not told the trek id was bad.

    The backend enforces both of these independently (`ItineraryService`), so
    these are the courteous explanation, not the security boundary.
  */
  if (!isLoggedIn) {
    return (
      <ItineraryGate
        icon={<Lock size={30} color={C.brand} strokeWidth={2} />}
        title="Sign in required"
        message="Please login or create an account to view the itinerary."
        onBack={goBack}
        primary={{
          label: 'Sign In',
          onPress: () => router.push('/login'),
          icon: <LogIn size={16} color={C.white} strokeWidth={2} />,
        }}
        secondary={{ label: 'Create Account', onPress: () => router.push('/signup') }}
      />
    );
  }

  if (!isOnboarded) {
    return (
      <ItineraryGate
        icon={<SlidersHorizontal size={30} color={C.brand} strokeWidth={2} />}
        title="Set your preferences first"
        message="Your itinerary is built around your fitness, experience and altitude history. Save your trek preferences and we'll plan this route around them."
        onBack={goBack}
        primary={{ label: 'Set Preferences', onPress: () => router.push('/onboarding') }}
      />
    );
  }

  if (!trek) {
    return (
      <View style={s.notFound}>
        <Text style={s.notFoundText}>Trek not found.</Text>
        <TouchableOpacity onPress={goBack} style={s.backBtn}>
          <Text style={s.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const diffColor = DIFFICULTY_COLOR[trek.difficulty] ?? C.textFaint;
  const rejected = !!data?.rejectionReason;

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={goBack}
          hitSlop={10}
          style={s.headerBack}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <ArrowLeft size={20} color={C.white} strokeWidth={2} />
        </TouchableOpacity>
        <View style={s.headerTitleWrap}>
          <Text style={s.headerTitle} numberOfLines={1}>{trek.displayTitle}</Text>
          <Text style={[s.headerSub, { color: diffColor }]}>
            {trek.difficulty} · {trek.durationDays} days
          </Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={s.scrollBody}>

        {/* ─── Result ─────────────────────────────────────────────────── */}
        {data && !rejected && (
          <View style={s.resultWrap}>
            <View style={s.statRow}>
              <StatTile
                icon={<Clock size={16} color={C.brandLight} strokeWidth={2} />}
                value={`${data.totalDays}`}
                label={data.totalDays === 1 ? 'Day' : 'Days'}
              />
              <StatTile
                icon={<Route size={16} color={C.brandLight} strokeWidth={2} />}
                value={`${Math.round(data.totalDistance)}`}
                label="km"
              />
              {/*
                The highest point the route reaches, not the climbing done to
                get there — `maxAltitude` is a running `Math.max` over the days.
                It was labelled "m ascent", which named a different figure
                entirely (cumulative gain) and made a plausible number wrong.
              */}
              <StatTile
                icon={<Mountain size={16} color={C.brandLight} strokeWidth={2} />}
                value={`${Math.round(data.maxAltitude)}`}
                label="m peak"
              />
              {/*
                How well the plan suits *this* trekker — the engine weighs their
                recovery, age and weight against the route's difficulty. Labelled
                "Fit" it read as a fitness score of the user, and "High Fit" is
                not a phrase anyone says; "Match" is what the number means.
              */}
              <StatTile
                icon={
                  <TrendingUp
                    size={16}
                    color={SUITABILITY_COLOR[data.suitability] ?? C.textFaint}
                    strokeWidth={2}
                  />
                }
                value={data.suitability}
                label="Match"
              />
            </View>

            {/*
              The engine can prepend a drive or a flight when the user's start
              or finish differs from the route's own endpoints, so the resolved
              origin and destination are worth showing back — they are how the
              user sees that those transport legs were added.
            */}
            {/*
              Each end is named rather than left to a bare "A → B". When the
              start and the finish are the same place — which is the common
              case, since most trips return to the city they set out from —
              "Kathmandu → Kathmandu" reads as a mistake unless something says
              which one is which.
            */}
            <View style={s.routeStrip}>
              <View style={s.routeEnd}>
                <Text style={s.routeLabel}>Starting Point</Text>
                <Text style={s.routePlace} numberOfLines={1}>{data.origin}</Text>
              </View>
              <ArrowRight size={16} color={C.textFaint} strokeWidth={2} />
              <View style={[s.routeEnd, s.routeEndRight]}>
                <Text style={s.routeLabel}>Ending Point</Text>
                <Text style={s.routePlace} numberOfLines={1}>{data.finalDestination}</Text>
              </View>
            </View>

            {data.cautions.length > 0 && (
              <View style={s.cautionCard}>
                {data.cautions.map((c, i) => (
                  <View key={i} style={s.cautionRow}>
                    <AlertTriangle size={14} color={C.amber} strokeWidth={2} />
                    <Text style={s.cautionText}>{c}</Text>
                  </View>
                ))}
              </View>
            )}

            <Text style={s.heading}>Your Plan — {data.totalDays} Days</Text>
            {data.days.map(day => <DayCard key={day.day} day={day} />)}

            <TouchableOpacity
              onPress={() => setData(null)}
              style={s.secondaryBtn}
              accessibilityRole="button"
              accessibilityLabel="Adjust preferences">
              <RotateCcw size={16} color={C.textSub} strokeWidth={2} />
              <Text style={s.secondaryBtnText}>Adjust Preferences</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ─── Rejection ───────────────────────────────────────────────── */}
        {rejected && (
          <View style={s.noticeCard}>
            <AlertTriangle size={22} color={C.amber} strokeWidth={2} />
            <Text style={s.noticeTitle}>This plan isn&apos;t safe</Text>
            <Text style={s.noticeBody}>{data?.rejectionReason}</Text>
            {!!data?.minimumSafeDays && (
              <Text style={s.noticeMeta}>Minimum safe duration: {data.minimumSafeDays} days</Text>
            )}
            {!!data?.recommendedDays && (
              <Text style={s.noticeMeta}>Recommended: {data.recommendedDays} days</Text>
            )}
            <TouchableOpacity
              onPress={() => setData(null)}
              style={s.primaryBtn}
              accessibilityRole="button"
              accessibilityLabel="Adjust preferences">
              <Text style={s.primaryBtnText}>Adjust Preferences</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ─── Preferences form ────────────────────────────────────────── */}
        {!data && (
          <View>
            <OptionChips label="Pace" options={PACE_OPTIONS} value={draft.pace}
              onChange={v => set('pace', v)} segmented />
            <OptionChips label="Fitness" options={FITNESS_OPTIONS} value={draft.fitnessLevel}
              onChange={v => set('fitnessLevel', v)} segmented />
            <OptionChips label="Trekking Experience" options={EXPERIENCE_OPTIONS}
              value={draft.trekkingExperience} onChange={v => set('trekkingExperience', v)} segmented />

            <LocationInput
              label="Starting From"
              placeholder="e.g. Kathmandu"
              value={draft.startLocation}
              onChangeText={v => set('startLocation', v)}
              locations={locations}
            />
            <LocationInput
              label="Finishing At"
              placeholder="Same as start"
              value={draft.finalDestination}
              onChangeText={v => set('finalDestination', v)}
              locations={locations}
            />

            <View style={s.fieldGrid}>
              <NumberField label="Duration (days)" placeholder={String(trek.durationDays)}
                value={draft.targetDays} onChangeText={v => set('targetDays', v)} />
              <NumberField label="Group Size" placeholder="1"
                value={draft.groupSize} onChangeText={v => set('groupSize', v)} />
            </View>
            <View style={s.fieldGrid}>
              <NumberField label="Age" placeholder="Optional"
                value={draft.age} onChangeText={v => set('age', v)} />
              <NumberField label="Weight (kg)" placeholder="Optional"
                value={draft.weight} onChangeText={v => set('weight', v)} />
            </View>

            {!!error && (
              <View style={s.errorCard}>
                <AlertTriangle size={14} color={C.red} strokeWidth={2} />
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            <TouchableOpacity
              onPress={handleGenerate}
              disabled={busy}
              style={[s.primaryBtn, busy && s.primaryBtnBusy]}
              accessibilityRole="button"
              accessibilityLabel="Generate itinerary">
              {busy ? (
                <>
                  <ActivityIndicator size="small" color={C.white} />
                  <Text style={s.primaryBtnText}>Building your plan…</Text>
                </>
              ) : (
                <Text style={s.primaryBtnText}>Generate Itinerary</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  notFound: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  notFoundText: { color: C.white, fontSize: 18, marginBottom: 16 },
  backBtn: {
    backgroundColor: C.brand, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12,
  },
  backBtnText: { color: C.white, fontWeight: '600' },

  /* Header */
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
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitleWrap: { flex: 1 },
  headerTitle: { color: C.white, fontSize: 17, fontWeight: '700' },
  headerSub: { fontSize: 12, fontWeight: '600', marginTop: 2 },

  /* Access gates — same shape as the For You signed-out state. */
  gateState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 60,
  },
  gateIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: C.brandDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  gateTitle: {
    color: C.white, fontSize: 19, fontWeight: '700', marginBottom: 10, textAlign: 'center',
  },
  gateSub: {
    color: C.textSub, fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 26,
  },
  gateCta: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.brand, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14,
  },
  gateCtaText: { color: C.white, fontSize: 15, fontWeight: '700' },
  gateSecondary: { marginTop: 14, paddingVertical: 8, paddingHorizontal: 16 },
  gateSecondaryText: { color: C.textSub, fontSize: 14, fontWeight: '600' },

  scrollBody: { padding: 22, paddingBottom: 60 },
  heading: {
    color: C.white, fontSize: 18, fontWeight: '700', marginBottom: 14, marginTop: 4,
  },

  /* Numeric fields */
  fieldGrid: { flexDirection: 'row', gap: 12 },
  fieldWrap: { flex: 1, marginBottom: 16 },
  fieldLabel: {
    color: C.textFaint, fontSize: 11, fontWeight: '700',
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10,
  },
  fieldBox: {
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, height: 46, justifyContent: 'center',
  },
  fieldBoxFocused: { borderColor: C.brand },
  fieldInput: { color: C.white, fontSize: 14, padding: 0 },
  // Keeps a lone field at half width so it lines up with the grid rows above.
  fieldSpacer: { flex: 1 },

  routeStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 18,
  },
  // Equal halves, so the arrow sits centred between them however long the two
  // place names are.
  routeEnd: { flex: 1, gap: 3 },
  routeEndRight: { alignItems: 'flex-end' },
  routeLabel: {
    color: C.textFaint, fontSize: 9, fontWeight: '700',
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  routePlace: { color: C.textSub, fontSize: 13, fontWeight: '600' },

  /* Buttons */
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: C.brand, paddingVertical: 16, borderRadius: 16, marginTop: 10,
  },
  primaryBtnBusy: { opacity: 0.7 },
  primaryBtnText: { color: C.white, fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    paddingVertical: 14, borderRadius: 16, marginTop: 8,
  },
  secondaryBtnText: { color: C.textSub, fontSize: 14, fontWeight: '600' },

  /* Notices */
  errorCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(239,68,68,0.10)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.30)',
    borderRadius: 12, padding: 12, marginBottom: 6,
  },
  errorText: { color: C.textSub, fontSize: 13, flex: 1, lineHeight: 19 },
  noticeCard: {
    alignItems: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: 16, padding: 24,
  },
  noticeTitle: { color: C.white, fontSize: 17, fontWeight: '700', marginTop: 12 },
  noticeBody: {
    color: C.textSub, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8,
  },
  noticeMeta: { color: C.textFaint, fontSize: 12, marginTop: 6 },

  /* Result summary */
  resultWrap: { marginBottom: 8 },
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  statTile: {
    flex: 1, alignItems: 'center', gap: 4,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: 14, paddingVertical: 14, paddingHorizontal: 4,
  },
  statValue: { color: C.white, fontSize: 16, fontWeight: '700' },
  statLabel: { color: C.textFaint, fontSize: 10 },

  cautionCard: {
    gap: 10, backgroundColor: 'rgba(245,158,11,0.08)',
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)',
    borderRadius: 14, padding: 14, marginBottom: 20,
  },
  cautionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cautionText: { color: C.textSub, fontSize: 13, lineHeight: 19, flex: 1 },

  /* Day cards — mirrors the trek detail itinerary rows */
  dayRow: { flexDirection: 'row', marginBottom: 8 },
  dayGutter: { width: 36, alignItems: 'center', marginRight: 12 },
  dayDot: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: C.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  dayDotRest: { backgroundColor: C.amber },
  dayDotText: { color: C.white, fontSize: 12, fontWeight: '700' },
  dayLine: { width: 2, flex: 1, backgroundColor: C.border, marginTop: 4, minHeight: 12 },
  dayCard: {
    flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: 14, padding: 14, marginBottom: 8,
  },
  dayTitle: { color: C.white, fontSize: 15, fontWeight: '600' },
  dayMetaRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  dayMeta: { color: C.textFaint, fontSize: 11 },
  dayMetaGain: { color: C.brandLight, fontWeight: '600' },
  dayActivities: { marginTop: 12 },
  dayNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 10,
  },
  dayNoteText: { color: C.textFaint, fontSize: 11, lineHeight: 17, flex: 1 },

  /* Activity timeline inside a day card */
  actRow: { flexDirection: 'row' },
  actGutter: { width: 16, alignItems: 'center', paddingTop: 5 },
  actDot: { width: 7, height: 7, borderRadius: 4 },
  actLine: { width: 1, flex: 1, backgroundColor: C.border, marginTop: 3 },
  actBody: { flex: 1, paddingLeft: 8, paddingBottom: 10 },
  actHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actType: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase',
  },
  actMeta: { color: C.textFaint, fontSize: 10 },
  actRoute: { color: C.textSub, fontSize: 13, marginTop: 2 },
  actDesc: { color: C.textFaint, fontSize: 11, lineHeight: 16, marginTop: 2 },

  /* Transfer options — the drive-or-fly choice on a connecting leg */
  optWrap: { marginTop: 8, gap: 6 },
  optHeading: {
    color: C.textFaint, fontSize: 10, fontWeight: '700',
    letterSpacing: 1, textTransform: 'uppercase',
  },
  optCard: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, gap: 3,
  },
  // The option the day's own hours are costed against.
  optCardPicked: { borderColor: C.brand },
  optHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  optMode: { color: C.white, fontSize: 12, fontWeight: '700' },
  optTime: { color: C.textSub, fontSize: 12 },
  optDist: { color: C.textFaint, fontSize: 11 },
  optBadge: {
    color: C.brandLight, fontSize: 9, fontWeight: '700',
    letterSpacing: 0.5, textTransform: 'uppercase', marginLeft: 'auto',
  },
  optDetail: { color: C.textFaint, fontSize: 11, lineHeight: 16 },
  optCaution: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 2 },
  optCautionText: { color: C.amber, fontSize: 10, lineHeight: 15, flex: 1 },
});
