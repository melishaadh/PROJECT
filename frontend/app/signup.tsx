import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Mountain, Eye, EyeOff, ArrowLeft, AtSign, CalendarDays } from 'lucide-react-native';
import { router } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { MIN_BRACKET_AGE, calculateAge } from '@/lib/ageGroups';
import { C } from '@/constants/theme';
import { T } from '@/constants/testIDs';

export default function SignupScreen() {
  const { signUp } = useAuth();
  const [name, setname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Date of birth, captured as three numeric fields. Split inputs work
  // identically on web and native without pulling in a native date picker.
  const [dobDay, setDobDay] = useState('');
  const [dobMonth, setDobMonth] = useState('');
  const [dobYear, setDobYear] = useState('');

  const dobFilled = !!(dobDay && dobMonth && dobYear);
  const dobIso = dobFilled
    ? `${dobYear.padStart(4, '0')}-${dobMonth.padStart(2, '0')}-${dobDay.padStart(2, '0')}`
    : null;
  const dobAge = calculateAge(dobIso);

  /** Digits only, capped, so the fields cannot hold nonsense. */
  const numericField = (setter: (v: string) => void, maxLength: number) => (v: string) =>
    setter(v.replace(/[^0-9]/g, '').slice(0, maxLength));

  /** Deep links have no history to pop, so fall back to the landing page. */
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/landing');
  };

  const handleSignup = async () => {
    if (!name.trim()) {
      setError('Username is required');
      return;
    }
    if (!email.trim()) {
      setError('Email is required');
      return;
    }
    if (!password.trim()) {
      setError('Password is required');
      return;
    }
    if (!dobFilled) {
      setError('Date of birth is required');
      return;
    }
    if (dobAge === null) {
      setError('Please enter a valid date of birth');
      return;
    }
    // The peer brackets — and therefore the whole matching and recommendation
    // system — start at 18. An account below that floor has no cohort to be
    // clustered into, so it is rejected at the door rather than silently
    // clamped into the Gen-Z bracket alongside people up to six years older.
    if (dobAge < MIN_BRACKET_AGE) {
      setError(`You must be at least ${MIN_BRACKET_AGE} years old to sign up`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    setError(null);
    const { error } = await signUp(email.trim(), password, name.trim(), dobIso ?? undefined);
    setLoading(false);
    if (error) {
      setError(error);
      return;
    }
    router.replace('/onboarding');
  };

  return (
    <View style={s.root} testID={T.signup.screen}>
      <TouchableOpacity
        onPress={goBack}
        style={s.backBtn}
        testID={T.signup.back}
        accessibilityRole="button"
        accessibilityLabel="Go back">
        <ArrowLeft size={20} color={C.white} strokeWidth={2} />
      </TouchableOpacity>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={s.flex}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.logoRow}>
            <View style={s.logoIcon}>
              <Mountain size={26} color={C.white} strokeWidth={2} />
            </View>
            <Text style={s.logoName}>TrekEasy</Text>
          </View>

          <Text style={s.heading}>Create your account</Text>

          {error && (
            <View style={s.errorBox}>
              <Text style={s.errorText} testID={T.signup.error}>{error}</Text>
            </View>
          )}

          <View style={s.fieldGroup}>
            <Text style={s.label}>Username</Text>
            <View style={s.nameWrap}>
              <AtSign size={16} color={C.textFaint} strokeWidth={2} style={s.nameIcon} />
              <TextInput
                style={[s.input, s.nameInput]}
                value={name}
                onChangeText={setname}
                placeholder="Choose a unique username"
                placeholderTextColor={C.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={handleSignup}
                testID={T.signup.username}
              />
            </View>
          </View>

          <View style={s.fieldGroup}>
            <Text style={s.label}>Email</Text>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={C.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              onSubmitEditing={handleSignup}
              testID={T.signup.email}
            />
          </View>

          <View style={s.fieldGroup}>
            <Text style={s.label}>Date of Birth</Text>
            <View style={s.dobRow}>
              <View style={s.dobFieldWrap}>
                <CalendarDays size={16} color={C.textFaint} strokeWidth={2} style={s.dobIcon} />
                <TextInput
                  style={[s.input, s.dobInput, s.dobInputWithIcon]}
                  value={dobDay}
                  onChangeText={numericField(setDobDay, 2)}
                  placeholder="DD"
                  placeholderTextColor={C.textFaint}
                  keyboardType="number-pad"
                  maxLength={2}
                  accessibilityLabel="Day of birth"
                  testID={T.signup.dobDay}
                />
              </View>
              <TextInput
                style={[s.input, s.dobInput]}
                value={dobMonth}
                onChangeText={numericField(setDobMonth, 2)}
                placeholder="MM"
                placeholderTextColor={C.textFaint}
                keyboardType="number-pad"
                maxLength={2}
                accessibilityLabel="Month of birth"
                testID={T.signup.dobMonth}
              />
              <TextInput
                style={[s.input, s.dobInput, s.dobYear]}
                value={dobYear}
                onChangeText={numericField(setDobYear, 4)}
                placeholder="YYYY"
                placeholderTextColor={C.textFaint}
                keyboardType="number-pad"
                maxLength={4}
                accessibilityLabel="Year of birth"
                testID={T.signup.dobYear}
              />
            </View>
            {/*
              The eligibility rule only. No age, no cohort, no bracket range —
              the date of birth still drives peer clustering, but nothing about
              that classification is narrated back to the user. Rendered only
              when the entered date actually fails the check, so a valid date
              produces no chrome at all.
            */}
            {dobFilled && (dobAge === null || dobAge < MIN_BRACKET_AGE) ? (
              <Text style={s.dobHint} testID={T.signup.dobHint}>
                You must be {MIN_BRACKET_AGE} or older to sign up.
              </Text>
            ) : null}
          </View>

          <View style={s.fieldGroup}>
            <Text style={s.label}>Password</Text>
            <View style={s.passWrap}>
              <TextInput
                style={s.input}
                value={password}
                onChangeText={setPassword}
                placeholder="At least 6 characters"
                placeholderTextColor={C.textFaint}
                secureTextEntry={!showPass}
                onSubmitEditing={handleSignup}
                testID={T.signup.password}
              />
              <TouchableOpacity
                style={s.eyeBtn}
                onPress={() => setShowPass(p => !p)}
                testID={T.signup.togglePassword}
                accessibilityRole="button"
                accessibilityLabel={showPass ? 'Hide password' : 'Show password'}>
                {showPass
                  ? <EyeOff size={16} color={C.textFaint} strokeWidth={2} />
                  : <Eye size={16} color={C.textFaint} strokeWidth={2} />}
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.fieldGroup}>
            <Text style={s.label}>Confirm Password</Text>
            <TextInput
              style={s.input}
              value={confirm}
              onChangeText={setConfirm}
              placeholder="••••••••"
              placeholderTextColor={C.textFaint}
              secureTextEntry={!showPass}
              onSubmitEditing={handleSignup}
              testID={T.signup.confirmPassword}
            />
          </View>

          <TouchableOpacity
            style={[s.signupBtn, loading && { opacity: 0.7 }]}
            onPress={handleSignup}
            testID={T.signup.submit}
            accessibilityRole="button"
            accessibilityLabel="Create Account"
            accessibilityState={{ busy: loading }}
            /*
              Only the in-flight request disables this. Gating it on empty
              fields made an untouched Date of Birth silently kill the tap:
              the button looked identical either way, so the screen read as
              broken. `handleSignup` already names every missing field, so
              letting the press through is what surfaces the reason.
            */
            disabled={loading}>
            {loading
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={s.signupBtnText}>Create Account</Text>}
          </TouchableOpacity>

          <View style={s.loginRow}>
            <Text style={s.loginText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => router.replace('/login')} testID={T.signup.gotoLogin}>
              <Text style={s.loginLink}>Sign in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 28, paddingTop: 80, paddingBottom: 40 },
  backBtn: {
    position: 'absolute',
    top: 52,
    left: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 32 },
  /* Solid brand tile with a white mark — the dark-green-on-dark-green version
     was invisible against the page, exactly as it was on the landing hero. */
  logoIcon: {
    width: 46,
    height: 46,
    borderRadius: 13,
    backgroundColor: C.brand,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoName: { color: C.white, fontSize: 22, fontWeight: '700' },
  heading: { color: C.white, fontSize: 22, fontWeight: '700', marginBottom: 24 },
  errorBox: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: { color: '#ef4444', fontSize: 13 },
  fieldGroup: { marginBottom: 16 },
  label: { color: C.textSub, fontSize: 13, fontWeight: '600', marginBottom: 7, letterSpacing: 0.3 },
  input: {
    height: 52,
    borderWidth: 1,
    borderRadius: 12,
    borderColor: C.border,
    backgroundColor: C.surface,
    paddingHorizontal: 14,
    color: C.white,
    fontSize: 15,
  },
  nameWrap: { position: 'relative', flexDirection: 'row', alignItems: 'center' },
  nameIcon: { position: 'absolute', left: 14, zIndex: 1 },
  // `flex: 1, minWidth: 0` for the same reason the date fields carry it: inside
  // a flex row on web the <input> keeps its intrinsic ~20-character width
  // instead of filling the row, which is what left the username box visibly
  // narrower than every other field on the form.
  nameInput: { flex: 1, minWidth: 0, paddingLeft: 38 },
  dobRow: { flexDirection: 'row', gap: 10 },
  // `minWidth: 0` is load-bearing on web. A TextInput renders as an <input>,
  // which carries an intrinsic ~20-character width, and a flex item's default
  // `min-width: auto` refuses to shrink past it — so the three boxes overflowed
  // the row and pushed MM off the side of the screen, where it could never be
  // filled in. No-op on native, where flex items already shrink freely.
  dobFieldWrap: { flex: 1, minWidth: 0, position: 'relative', flexDirection: 'row', alignItems: 'center' },
  dobIcon: { position: 'absolute', left: 12, zIndex: 1 },
  dobInput: { flex: 1, minWidth: 0, textAlign: 'center' },
  dobInputWithIcon: { paddingLeft: 32, textAlign: 'right' },
  dobYear: { flex: 1.4 },
  dobHint: { color: C.textFaint, fontSize: 11, marginTop: 7, lineHeight: 16 },
  passWrap: { position: 'relative' },
  eyeBtn: {
    position: 'absolute',
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  signupBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: C.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 20,
  },
  signupBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  loginRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  loginText: { color: C.textFaint, fontSize: 14 },
  loginLink: { color: C.green, fontSize: 14, fontWeight: '700' },
});
