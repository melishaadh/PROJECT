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
import { Mountain, Eye, EyeOff, ArrowLeft } from 'lucide-react-native';
import { router } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { C } from '@/constants/theme';
import { T } from '@/constants/testIDs';

export default function LoginScreen() {
  const { signIn } = useAuth();
  /** Either the account's email address or its username — the API accepts both. */
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Deep links have no history to pop, so fall back to the landing page. */
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/landing');
  };

  const handleLogin = async () => {
    if (!identifier.trim() || !password.trim()) return;
    setLoading(true);
    setError(null);
    const { error } = await signIn(identifier.trim(), password);
    setLoading(false);
    if (error) {
      setError(error);
      return;
    }
    router.replace('/(tabs)/foryou');
  };

  return (
    <View style={s.root} testID={T.login.screen}>
      <TouchableOpacity
        onPress={goBack}
        style={s.backBtn}
        testID={T.login.back}
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
              <Mountain size={26} color={C.brand} strokeWidth={2} />
            </View>
            <Text style={s.logoName}>TrekEasy</Text>
          </View>

          <Text style={s.heading}>Sign in to your account</Text>

          {error && (
            <View style={s.errorBox}>
              <Text style={s.errorText} testID={T.login.error}>{error}</Text>
            </View>
          )}

          <View style={s.fieldGroup}>
            <Text style={s.label}>Email or Username</Text>
            <TextInput
              style={s.input}
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="you@example.com or your username"
              placeholderTextColor={C.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={handleLogin}
              testID={T.login.email}
            />
          </View>

          <View style={s.fieldGroup}>
            <Text style={s.label}>Password</Text>
            <View style={s.passWrap}>
              <TextInput
                style={s.input}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={C.textFaint}
                secureTextEntry={!showPass}
                onSubmitEditing={handleLogin}
                testID={T.login.password}
              />
              <TouchableOpacity
                style={s.eyeBtn}
                onPress={() => setShowPass(p => !p)}
                testID={T.login.togglePassword}
                accessibilityRole="button"
                accessibilityLabel={showPass ? 'Hide password' : 'Show password'}>
                {showPass
                  ? <EyeOff size={16} color={C.textFaint} strokeWidth={2} />
                  : <Eye size={16} color={C.textFaint} strokeWidth={2} />}
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[s.loginBtn, loading && { opacity: 0.7 }]}
            onPress={handleLogin}
            testID={T.login.submit}
            accessibilityRole="button"
            accessibilityLabel="Sign In"
            accessibilityState={{ busy: loading }}
            disabled={loading || !identifier.trim() || !password.trim()}>
            {loading
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={s.loginBtnText}>Sign In</Text>}
          </TouchableOpacity>

          <View style={s.signupRow}>
            <Text style={s.signupText}>Don&apos;t have an account? </Text>
            <TouchableOpacity onPress={() => router.replace('/signup')} testID={T.login.gotoSignup}>
              <Text style={s.signupLink}>Create one</Text>
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
  logoIcon: {
    width: 46,
    height: 46,
    borderRadius: 13,
    backgroundColor: 'rgba(15,82,56,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(15,82,56,0.35)',
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
  label: { color: C.textSub, fontSize: 12, fontWeight: '600', marginBottom: 7, letterSpacing: 0.3 },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 12,
    borderColor: C.border,
    backgroundColor: C.surface,
    paddingHorizontal: 14,
    color: C.white,
    fontSize: 14,
  },
  passWrap: { position: 'relative' },
  eyeBtn: {
    position: 'absolute',
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  loginBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: C.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 20,
  },
  loginBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  signupRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  signupText: { color: C.textFaint, fontSize: 14 },
  signupLink: { color: C.green, fontSize: 14, fontWeight: '700' },
});
