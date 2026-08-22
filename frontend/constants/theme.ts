export const C = {
  bg: '#121212',
  surface: '#1E1E1E',
  elevated: '#2A2A2A',
  border: '#333333',
  brand: '#0f5238',
  brandLight: '#197a53',
  brandDim: 'rgba(15,82,56,0.15)',
  white: '#FFFFFF',
  text: '#FFFFFF',
  textSub: '#D1D5DB',
  textMuted: '#9CA3AF',
  textFaint: '#6B7280',
  red: '#EF4444',
  amber: '#F59E0B',
  blue: '#3B82F6',
  purple: '#8B5CF6',
  green: '#10B981',
};

export const DIFFICULTY_COLOR: Record<string, string> = {
  Easy: '#10b981',
  Moderate: '#f59e0b',
  Hard: '#ef4444',
};

/**
 * Vertical space the floating tab bar occupies at the bottom of every tab screen
 * — its 68pt height plus the 20pt it is inset from the bottom edge.
 *
 * Needed by any full-height centred layout. A container that is `flex: 1` with
 * `justifyContent: 'center'` centres within the *whole* screen, including the
 * region the tab bar floats over, so its content lands visibly below the true
 * optical centre. Reserving this as bottom padding is what makes the
 * signed-out placeholder states sit centred in the space the user can actually
 * see. Keep in sync with `tabBarStyle` in `app/(tabs)/_layout.tsx`.
 */
export const TAB_BAR_SPACE = 68 + 20;
