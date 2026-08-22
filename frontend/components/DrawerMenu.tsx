import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { X, User, LogIn, LogOut, ArrowLeft } from 'lucide-react-native';
import { router } from 'expo-router';
import Avatar from '@/components/Avatar';
import { useAuth } from '@/context/AuthContext';
import { setGuestMode } from '@/lib/guestMode';
import { C } from '@/constants/theme';

interface DrawerMenuProps {
  visible: boolean;
  onClose: () => void;
}

const { width } = Dimensions.get('window');
const DRAWER_WIDTH = width * 0.62;

export default function DrawerMenu({ visible, onClose }: DrawerMenuProps) {
  const { isLoggedIn, profile, signOut } = useAuth();

  const handleSignOut = async () => {
    onClose();
    await signOut();
    // signOut also drops guest mode, so the auth gate returns to the landing page.
    router.replace('/landing');
  };

  /** Close the drawer first so the destination is not covered by the modal. */
  const go = (path: string) => {
    onClose();
    router.push(path as any);
  };

  /**
   * Return an unauthenticated visitor to the landing page.
   *
   * Guest mode is cleared on the way out. It is the flag that tells the auth gate
   * a visitor without a session may browse the tabs, and leaving it set would
   * mean a visitor who has explicitly walked back out to the landing page is
   * still holding a pass into the app — so the next stray navigation lands them
   * back inside instead of at the sign-in they were heading for.
   */
  const backToLanding = () => {
    onClose();
    setGuestMode(false);
    router.replace('/landing');
  };

  const displayName = isLoggedIn
    ? (profile?.name || 'Member')
    : 'Guest';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={s.overlay}>
        <Pressable style={s.backdrop} onPress={onClose} />

        <View style={[s.drawer, { width: DRAWER_WIDTH }]}>
          <View style={s.content}>
            {/*
              Laid out in the flow rather than absolutely positioned.

              As an absolute element at `top: 52` it overlapped the identity
              block below it, and because that block is a later sibling it
              painted on top and swallowed most of the button's touch area —
              only a few pixels along the top edge actually closed the drawer,
              which read as the X being broken. A normal row cannot be covered
              by anything.
            */}
            <View style={s.closeRow}>
              <TouchableOpacity
                onPress={onClose}
                style={s.closeBtn}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close menu">
                <X size={18} color={C.white} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            {/* User identity block */}
            <View style={s.userBlock}>
              <Avatar uri={profile?.profilePicture} size={44} />
              <View style={s.userMeta}>
                <Text style={s.userName} numberOfLines={1}>
                  {displayName}
                </Text>
                <Text style={s.userStatus}>
                  {isLoggedIn ? 'Member' : 'Not signed in'}
                </Text>
              </View>
            </View>

            <Text style={s.sectionLabel}>Menu</Text>

            {!isLoggedIn ? (
              <>
                {/*
                  Back to the landing page.

                  Replaces what used to be an "About TrekEasy" entry pointing at
                  the same route. A guest arrives here *from* the landing page, so
                  the useful action is returning to it, not reading about the app
                  they are already inside — and phrasing it as a back affordance
                  with an arrow is what makes it obvious that is where it goes.

                  `replace`, not `push`: pushing would leave the guest tabs sitting
                  underneath in the history, so the device back gesture would drop
                  them straight back into the app they had just chosen to leave.
                */}
                <TouchableOpacity style={s.menuItem} onPress={backToLanding}>
                  <View style={s.iconWrap}>
                    <ArrowLeft size={20} color={C.brand} strokeWidth={2} />
                  </View>
                  <Text style={s.menuText}>Back to Home</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[s.menuItem, { marginTop: 10 }]}
                  onPress={() => go('/login')}>
                  <View style={s.iconWrap}>
                    <LogIn size={20} color={C.brand} strokeWidth={2} />
                  </View>
                  <Text style={s.menuText}>Sign In</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[s.menuItem, { marginTop: 10 }]}
                  onPress={() => go('/signup')}>
                  <View style={s.iconWrap}>
                    <User size={20} color={C.brand} strokeWidth={2} />
                  </View>
                  <Text style={s.menuText}>Create Account</Text>
                </TouchableOpacity>
              </>
            ) : (
              /*
                Members get a single action. Profile lives on its own tab and
                trek preferences are reached from the For You feed, so
                duplicating either here only added noise.
              */
              <TouchableOpacity
                style={[s.menuItem, { borderColor: 'rgba(239,68,68,0.25)', backgroundColor: 'rgba(239,68,68,0.08)' }]}
                onPress={handleSignOut}>
                <View style={[s.iconWrap, { backgroundColor: 'rgba(239,68,68,0.18)' }]}>
                  <LogOut size={20} color={C.red} strokeWidth={2} />
                </View>
                <Text style={[s.menuText, { color: C.red }]}>Sign Out</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, flexDirection: 'row' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  drawer: {
    height: '100%',
    /*
      Opaque, and painted by the panel itself.

      This used to have no background at all: a `BlurView` was laid over the
      whole drawer and was the only thing standing between the menu and the
      screen behind it. `expo-blur` does not render reliably on Android, and
      where it degrades there is nothing left to paint the panel — so the
      Explore feed showed straight through and the menu was unreadable. A flat
      surface cannot fail that way, and it matches every other panel in the app.
    */
    backgroundColor: C.bg,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    paddingTop: 52,
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  closeRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 12 },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 28,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  userMeta: { flex: 1 },
  userName: { color: C.white, fontSize: 15, fontWeight: '600' },
  userStatus: { color: C.textFaint, fontSize: 12, marginTop: 2 },
  sectionLabel: {
    color: C.green,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(15,82,56,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuText: { color: C.white, fontSize: 15, fontWeight: '500' },
});
