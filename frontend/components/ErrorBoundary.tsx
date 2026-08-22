import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { AlertTriangle, RotateCcw } from 'lucide-react-native';
import { C } from '@/constants/theme';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Shown in the fallback so the user knows which area failed. */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Screen-level error boundary.
 *
 * The root layout already has one, but a throw anywhere under it replaces the
 * *entire* app with the crash screen. Wrapping each screen means a render error
 * in one tab degrades to a retry card in that tab while navigation and every
 * other screen keep working.
 *
 * "Try again" remounts the subtree by clearing the captured error, which is
 * enough to recover from a transient failure (a malformed record that has since
 * been refetched, for instance) without restarting the app.
 */
export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Left visible in the dev console; there is no crash reporter wired up yet.
    console.error(`[${this.props.label ?? 'screen'}] render error:`, error);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={s.root}>
        <View style={s.iconWrap}>
          <AlertTriangle size={30} color={C.amber} strokeWidth={2} />
        </View>
        <Text style={s.title}>Something went wrong</Text>
        <Text style={s.body}>
          {this.props.label
            ? `The ${this.props.label} screen could not be displayed.`
            : 'This screen could not be displayed.'}
        </Text>
        <TouchableOpacity
          onPress={this.reset}
          style={s.retryBtn}
          accessibilityRole="button"
          accessibilityLabel="Try again">
          <RotateCcw size={16} color={C.white} strokeWidth={2.5} />
          <Text style={s.retryText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  iconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: { color: C.white, fontSize: 18, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  body: {
    color: C.textFaint,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 24,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.brand,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
  },
  retryText: { color: C.white, fontSize: 15, fontWeight: '700' },
});
