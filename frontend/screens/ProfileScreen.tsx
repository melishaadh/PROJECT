import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
} from 'react-native';
import {
  User as UserIcon,
  AtSign,
  Link2,
  Plus,
  Search,
  X,
  Trash2,
  Mountain,
  Users,
  Camera,
  ImageIcon,
  Check,
  ChevronRight,
  MessagesSquare,
} from 'lucide-react-native';
import { router, useFocusEffect } from 'expo-router';
import Header from '@/components/Header';
import DrawerMenu from '@/components/DrawerMenu';
import TrekCard from '@/components/TrekCard';
import SearchBar from '@/components/SearchBar';
import Avatar from '@/components/Avatar';
import UserProfileModal from '@/components/UserProfileModal';
import { useAuth } from '@/context/AuthContext';
import { DESTINATIONS } from '@/data/destinations';
import { pickProfilePicture } from '@/lib/profilePicture';
import { C, TAB_BAR_SPACE } from '@/constants/theme';
import { T, trekPickerItemID, userSearchResultID } from '@/constants/testIDs';
import { searchUsers, SearchUser } from '@/lib/userSearchService';
import {
  ChatRoom,
  listChatRooms,
  sendInvitation,
  listMyInvitations,
  getUnreadRoomCount,
  getPendingInviteRoomIds,
} from '@/lib/chatService';

export default function ProfileScreen() {
  const { isLoggedIn, profile, updateProfileFields, updateProfilePicture, deleteAccount, loading } =
    useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [socialLink, setSocialLink] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [showTrekPicker, setShowTrekPicker] = useState(false);
  const [trekSearch, setTrekSearch] = useState('');
  const [completedTreks, setCompletedTreks] = useState<string[]>([]);

  // Profile picture
  const [uploadingDp, setUploadingDp] = useState(false);
  const [showDpSheet, setShowDpSheet] = useState(false);

  // Account deletion
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // User search
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [viewingUser, setViewingUser] = useState<SearchUser | null>(null);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [selectedUser, setSelectedUser] = useState<SearchUser | null>(null);
  const [myGroups, setMyGroups] = useState<ChatRoom[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [addingToGroupId, setAddingToGroupId] = useState<string | null>(null);
  const [invitedRoomIds, setInvitedRoomIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [pendingInviteCount, setPendingInviteCount] = useState(0);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Action deferred until the picture sheet has finished dismissing. */
  const pendingDpAction = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (profile) {
      setUsername(profile.name ?? '');
      setBio(profile.bio ?? '');
      setSocialLink(profile.socialMediaLink ?? '');
      setCompletedTreks(Array.isArray(profile.completedTrekIds) ? profile.completedTrekIds : []);
    }
  }, [profile]);

  // Clear any pending timers if the screen unmounts mid-toast.
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  // Refreshed on every visit rather than pushed live — see `subscribeToInvitations`'s
  // doc comment in `lib/chatService.ts` for why a truly always-on badge would
  // need the chat socket to be app-wide rather than scoped to an open thread.
  // The badge combines two different things a trip to the inbox would
  // resolve — a pending invite and an unread conversation — into one count,
  // since there's only the one icon to show it on.
  useFocusEffect(
    useCallback(() => {
      if (!isLoggedIn) {
        setPendingInviteCount(0);
        return;
      }
      Promise.all([listMyInvitations(), getUnreadRoomCount()]).then(([invites, unreadRooms]) =>
        setPendingInviteCount(invites.length + unreadRooms),
      );
    }, [isLoggedIn]),
  );

  /** Debounced autocomplete. Stale responses are discarded, not rendered. */
  useEffect(() => {
    const q = userSearchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    let active = true;
    // The request is aborted as well as ignored, so a fast typist does not leave
    // a queue of superseded searches in flight.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const results = await searchUsers(q, controller.signal);
      if (!active) return;
      setSearchResults(
        (Array.isArray(results) ? results : []).filter(r => r.id !== profile?.id)
      );
      setSearching(false);
    }, 250);

    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [userSearchQuery, profile?.id]);

  const flashSave = (text: string, ok: boolean) => {
    setSaveMsg({ text, ok });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSaveMsg(null), 3000);
  };

  const flashToast = (text: string, ok: boolean) => {
    setToast({ text, ok });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const closeDeleteConfirm = () => {
    if (deleting) return;
    setShowDeleteConfirm(false);
    setDeletePassword('');
    setDeleteError(null);
  };

  const handleDeleteAccount = async () => {
    if (deleting) return;
    if (!deletePassword) {
      setDeleteError('Enter your password to confirm.');
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    const { error } = await deleteAccount(deletePassword);
    setDeleting(false);
    if (error) {
      setDeleteError(error);
      return;
    }
    setShowDeleteConfirm(false);
    setDeletePassword('');
    router.replace('/landing');
  };

  const handleSave = async () => {
    // Guard against a double-tap firing two saves; the button is also disabled.
    if (saving) return;
    if (!username.trim()) {
      flashSave('Username cannot be empty', false);
      return;
    }

    setSaving(true);
    try {
      const { error } = await updateProfileFields({
        name: username.trim(),
        bio: bio.trim(),
        socialMediaLink: socialLink.trim(),
      });
      flashSave(error ?? 'Profile saved successfully', !error);
    } catch {
      flashSave('Something went wrong. Please try again.', false);
    } finally {
      setSaving(false);
    }
  };

  // ─── Profile picture ───────────────────────────────────────────────────────

  /**
   * Close the action sheet, then run the chosen action once it has actually gone.
   *
   * This ordering is the fix for "Choose from library" doing nothing. Both
   * actions used to call `setShowDpSheet(false)` and immediately continue, which
   * on iOS means asking UIKit to present the photo picker while our own modal is
   * still mid-dismiss. UIKit refuses to present onto a controller that is being
   * dismissed — it logs and drops the request — so the sheet slid away and no
   * picker ever appeared, indistinguishable from a dead button. The action is
   * therefore parked here and fired from the modal's `onDismiss`, which runs
   * after the dismissal animation completes and the presenter is free.
   *
   * Android has no such restriction (the picker is a separate activity), and
   * `Modal` only supports `onDismiss` on iOS, so there the action runs straight
   * away rather than waiting for a callback that will never come.
   */
  const runDpAction = (action: () => void) => {
    pendingDpAction.current = action;
    setShowDpSheet(false);
    if (Platform.OS !== 'ios') flushPendingDpAction();
  };

  const flushPendingDpAction = () => {
    const action = pendingDpAction.current;
    pendingDpAction.current = null;
    action?.();
  };

  /**
   * Choose a picture from the library and upload it.
   *
   * The picker hands back a file URI, not base64 — the image is streamed as
   * multipart form data to object storage and only the resulting URL is stored
   * on the user document. `setUploadingDp` covers the whole flow, and the
   * avatar is disabled while it runs, so a second tap cannot start a
   * concurrent upload.
   */
  const handlePickPicture = async () => {
    if (uploadingDp) return;
    setUploadingDp(true);

    try {
      const result = await pickProfilePicture();

      if (result.cancelled) return;
      if (result.error || !result.file) {
        flashToast(result.error ?? 'Could not load that image.', false);
        return;
      }

      const { error } = await updateProfilePicture(result.file);
      flashToast(error ?? 'Profile picture updated', !error);
    } catch {
      flashToast('Could not update your picture. Please try again.', false);
    } finally {
      setUploadingDp(false);
    }
  };

  const handleRemovePicture = async () => {
    if (uploadingDp) return;
    setUploadingDp(true);
    try {
      const { error } = await updateProfilePicture(null);
      flashToast(error ?? 'Profile picture removed', !error);
    } catch {
      flashToast('Could not remove your picture. Please try again.', false);
    } finally {
      setUploadingDp(false);
    }
  };

  // ─── Completed treks ───────────────────────────────────────────────────────

  /**
   * Optimistic add.
   *
   * The list updates before the write lands so the sheet can close instantly,
   * and `previous` is captured up front rather than recomputed in the failure
   * branch — recomputing would roll back to whatever the state happens to be
   * *after* the failed write, which is not necessarily where it started.
   */
  const handleAddTrek = async (trekId: string) => {
    if (completedTreks.includes(trekId)) return;

    const previous = completedTreks;
    setCompletedTreks([...previous, trekId]);
    setShowTrekPicker(false);
    setTrekSearch('');

    try {
      const { error } = await updateProfileFields({ completedTrekIds: [...previous, trekId] });
      if (error) {
        setCompletedTreks(previous);
        flashToast(error, false);
      }
    } catch {
      setCompletedTreks(previous);
      flashToast('Could not save that trek. Please try again.', false);
    }
  };

  const handleRemoveTrek = async (trekId: string) => {
    const previous = completedTreks;
    const newIds = previous.filter(id => id !== trekId);
    setCompletedTreks(newIds);

    try {
      const { error } = await updateProfileFields({ completedTrekIds: newIds });
      if (error) {
        setCompletedTreks(previous);
        flashToast(error, false);
      }
    } catch {
      setCompletedTreks(previous);
      flashToast('Could not remove that trek. Please try again.', false);
    }
  };

  // ─── Add to chat ───────────────────────────────────────────────────────────

  /** Stable across renders, so the memoized `TrekCard`s do not re-render. */
  const openTrek = useCallback((trekId: string) => {
    router.push(`/trek/${trekId}`);
  }, []);

  /**
   * Opens the group picker and loads the groups you can actually invite
   * someone into — the ones you're already a member of. Tapping one below
   * sends an invitation rather than adding them outright, since a group can
   * be full or the invitee may simply decline.
   */
  const handleAddToChat = useCallback((user: SearchUser) => {
    setViewingUser(null);
    setSelectedUser(user);
    setShowGroupPicker(true);
    setInvitedRoomIds(new Set());
    setLoadingGroups(true);
    listChatRooms({ mine: true })
      .then(async groups => {
        setMyGroups(groups);
        const pending = await getPendingInviteRoomIds(groups.map(g => g.id), user.id);
        setInvitedRoomIds(pending);
      })
      .finally(() => setLoadingGroups(false));
  }, []);

  const closeGroupPicker = () => {
    setShowGroupPicker(false);
    setSelectedUser(null);
  };

  /**
   * Deliberately does not close the picker — the user asked to be able to
   * add someone to several groups in one sitting, with each row's own state
   * ("Invite sent") updating in place rather than the sheet vanishing after
   * the first tap.
   */
  const handleSelectGroup = async (group: ChatRoom) => {
    if (!selectedUser || addingToGroupId) return;
    setAddingToGroupId(group.id);
    try {
      const { ok, error } = await sendInvitation(group.id, selectedUser.id);
      if (ok) {
        setInvitedRoomIds(prev => new Set(prev).add(group.id));
        flashToast(`Invited ${selectedUser.username ?? 'them'} to "${group.roomName}"`, true);
      } else {
        flashToast(error ?? 'Could not send the invite.', false);
      }
    } catch {
      flashToast('Could not send the invite. Please try again.', false);
    } finally {
      setAddingToGroupId(null);
    }
  };

  // ─── Derived ───────────────────────────────────────────────────────────────

  const filteredTreks = DESTINATIONS.filter(t => {
    const q = trekSearch.toLowerCase();
    return (
      (!q ||
        t.displayTitle.toLowerCase().includes(q) ||
        t.parentName.toLowerCase().includes(q)) &&
      !completedTreks.includes(t.id)
    );
  });

  // An id may reference a trek that is no longer in the catalogue, so the
  // lookups are filtered rather than assumed to resolve.
  const completedTrekObjects = completedTreks
    .map(id => DESTINATIONS.find(d => d.id === id))
    .filter(Boolean) as typeof DESTINATIONS;

  if (!isLoggedIn) {
    return (
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <Header onMenuPress={() => setDrawerOpen(true)} />
        <View style={s.emptyState}>
          <View style={s.emptyIcon}>
            <UserIcon size={32} color={C.brand} strokeWidth={2} />
          </View>
          <Text style={s.emptyTitle}>Sign in to view your profile</Text>
          <Text style={s.emptySub}>
            Access your profile, completed treks, and personalized recommendations.
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/login')}
            style={s.ctaBtn}
            testID={T.profile.signedOutSignIn}>
            <Text style={s.ctaText}>Sign In</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/signup')}
            style={s.secondaryBtn}
            testID={T.profile.signedOutSignUp}>
            <Text style={s.secondaryText}>Create Account</Text>
          </TouchableOpacity>
        </View>
        <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </View>
    );
  }

  if (loading && !profile) {
    return (
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <Header onMenuPress={() => setDrawerOpen(true)} />
        <View style={s.centerState}>
          <ActivityIndicator size="large" color={C.brand} />
        </View>
        <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </View>
    );
  }
  

  return (
    <View style={s.root} testID={T.profile.screen}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <Header
        onMenuPress={() => setDrawerOpen(true)}
        leftAction={{
          icon: (
            <View>
              <MessagesSquare size={20} color={C.white} strokeWidth={2} />
              {pendingInviteCount > 0 && <View style={s.inviteBadge} />}
            </View>
          ),
          onPress: () => router.push('/chat/mine'),
          accessibilityLabel:
            pendingInviteCount > 0
              ? `My Chats — ${pendingInviteCount} pending invite${pendingInviteCount === 1 ? '' : 's'}`
              : 'My Chats',
        }}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scroll}
        testID={T.profile.scroll}
        keyboardShouldPersistTaps="handled">
        {/*
          Trekker search — first thing on the page.

          Moved above the profile header because finding another trekker is the
          one thing on this screen a member does repeatedly; editing their own bio
          is something they do once. It used to sit below the whole editable
          profile card, which meant scrolling past everything to reach it.

          The "Find Trekkers" section heading is gone: the field's own placeholder
          now says what it is for, so the label was a second line of chrome
          restating the input directly beneath it.
        */}
        <View style={s.searchCard}>
          <SearchBar
            value={userSearchQuery}
            onChangeText={setUserSearchQuery}
            placeholder="look for your friends"
            busy={searching}
            testID={T.profile.userSearch}
            style={s.userSearchBar}
          />

          {searchResults.length > 0 && (
            <View style={s.searchResults}>
              {searchResults.map(user => (
                <TouchableOpacity
                  key={user.id}
                  style={s.userRow}
                  activeOpacity={0.75}
                  testID={userSearchResultID(user.id)}
                  onPress={() => setViewingUser(user)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${user.username ?? 'user'}'s profile`}>
                  <Avatar uri={user.profilePicture} size={38} />
                  <Text style={s.userRowName} numberOfLines={1}>
                    {user.username ?? 'Unknown'}
                  </Text>
                  <ChevronRight size={16} color={C.textFaint} strokeWidth={2} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {userSearchQuery.trim().length > 0 && !searching && searchResults.length === 0 && (
            <Text style={s.noResults}>No trekkers found</Text>
          )}
        </View>

        {/* Profile Header + DP */}
        <View style={s.profileHeader}>
          <TouchableOpacity
            onPress={() => setShowDpSheet(true)}
            disabled={uploadingDp}
            activeOpacity={0.85}
            testID={T.profile.avatarButton}
            accessibilityRole="button"
            accessibilityLabel="Change profile picture"
            accessibilityState={{ busy: uploadingDp, disabled: uploadingDp }}
            style={s.avatarWrap}>
            <Avatar uri={profile?.profilePicture} size={92} bordered />
            <View style={s.avatarBadge}>
              {uploadingDp ? (
                <ActivityIndicator size="small" color={C.white} />
              ) : (
                <Camera size={14} color={C.white} strokeWidth={2.5} />
              )}
            </View>
          </TouchableOpacity>

          <Text style={s.profileName}>{profile?.name || 'Member'}</Text>
          {profile?.bio ? (
            <Text style={s.profileBio}>{profile.bio}</Text>
          ) : (
            <Text style={s.profileBioFaint}>No bio yet</Text>
          )}

          {/*
            Age is deliberately not rendered anywhere in the profile view. It is
            confidential: the backend derives the age bracket from the stored
            date of birth and uses it only inside the KNN and safety vectors.
          */}
        </View>

        {/*
          There is deliberately no second trekker search here.

          A duplicate "Find Trekkers" heading and search bar used to sit below the
          profile header, bound to the *same* `userSearchQuery` state as the bar at
          the top of the screen. Two inputs sharing one state is not two search
          bars — it is one search bar rendered twice, so typing in either echoed
          into the other and both result lists appeared at once, above and below
          the profile card. The top bar is the primary one and keeps the full
          search and filtering behaviour; this block is gone rather than rewired.
        */}

        {toast && (
          <View style={[s.toastBox, !toast.ok && s.toastBoxError]}>
            {toast.ok ? (
              <Check size={16} color={C.green} strokeWidth={2} />
            ) : (
              <X size={16} color={C.red} strokeWidth={2} />
            )}
            <Text style={[s.toastText, !toast.ok && s.toastTextError]} testID={T.profile.toast}>
              {toast.text}
            </Text>
            <TouchableOpacity
              onPress={() => setToast(null)}
              hitSlop={10}
              testID={T.profile.toastDismiss}
              accessibilityRole="button"
              accessibilityLabel="Dismiss message">
              <X size={14} color={C.textFaint} strokeWidth={2} />
            </TouchableOpacity>
          </View>
        )}



        {/* Profile Details */}
        <Text style={s.sectionLabel}>Profile Details</Text>
        <View style={s.card}>
          <View style={s.fieldGroup}>
            <Text style={s.label}>Username</Text>
            <View style={s.inputWrap}>
              <AtSign size={16} color={C.textFaint} strokeWidth={2} style={s.inputIcon} />
              <TextInput
                style={[s.input, s.inputWithIcon]}
                value={username}
                onChangeText={setUsername}
                placeholder="Your username"
                placeholderTextColor={C.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                testID={T.profile.usernameInput}
              />
              {username.length > 0 && (
                <TouchableOpacity
                  onPress={() => setUsername('')}
                  hitSlop={10}
                  testID={T.profile.usernameClear}
                  accessibilityRole="button"
                  accessibilityLabel="Clear username"
                  style={s.inputClear}>
                  <X size={13} color={C.textSub} strokeWidth={2.5} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={s.fieldGroup}>
            <Text style={s.label}>Bio</Text>
            <TextInput
              style={[s.input, s.bioInput]}
              value={bio}
              onChangeText={setBio}
              placeholder="Tell us about yourself..."
              placeholderTextColor={C.textFaint}
              multiline
              textAlignVertical="top"
              testID={T.profile.bioInput}
            />
          </View>

          <View style={s.fieldGroup}>
            <Text style={s.label}>Social Media Link</Text>
            <View style={s.inputWrap}>
              <Link2 size={16} color={C.textFaint} strokeWidth={2} style={s.inputIcon} />
              <TextInput
                style={[s.input, s.inputWithIcon]}
                value={socialLink}
                onChangeText={setSocialLink}
                placeholder="https://instagram.com/..."
                placeholderTextColor={C.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                testID={T.profile.socialInput}
              />
              {socialLink.length > 0 && (
                <TouchableOpacity
                  onPress={() => setSocialLink('')}
                  hitSlop={10}
                  testID={T.profile.socialClear}
                  accessibilityRole="button"
                  accessibilityLabel="Clear social media link"
                  style={s.inputClear}>
                  <X size={13} color={C.textSub} strokeWidth={2.5} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          <TouchableOpacity
            onPress={handleSave}
            style={[s.saveBtn, saving && { opacity: 0.7 }]}
            testID={T.profile.save}
            accessibilityRole="button"
            accessibilityLabel="Save Changes"
            accessibilityState={{ busy: saving, disabled: saving }}
            disabled={saving}>
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={s.saveBtnText}>Save Changes</Text>
            )}
          </TouchableOpacity>

          {saveMsg && (
            <Text
              style={[s.saveMsg, saveMsg.ok ? s.saveMsgOk : s.saveMsgError]}
              testID={T.profile.saveMessage}>
              {saveMsg.text}
            </Text>
          )}
        </View>

        {/*
          There is deliberately only one toast, above — this is where a second
          copy of it used to be.

          Both blocks were bound to the same `toast` state, so they were not two
          toasts but one toast rendered twice: every profile-picture or
          completed-trek message appeared simultaneously above and below the
          Profile Details card, and dismissing one left the other on screen. Same
          shape of bug as the duplicated trekker search that used to sit further
          down. The copy next to the avatar is the one that was kept, because
          picture feedback belongs next to the picture.
        */}

        {/* Completed Treks */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionLabel}>Completed Treks</Text>
          <TouchableOpacity
            onPress={() => setShowTrekPicker(true)}
            style={s.addBtn}
            testID={T.profile.addTrek}
            accessibilityRole="button"
            accessibilityLabel="Add a completed trek">
            <Plus size={18} color={C.brand} strokeWidth={2.5} />
            <Text style={s.addBtnText}>Add</Text>
          </TouchableOpacity>
        </View>

        {completedTrekObjects.length === 0 ? (
          <View style={s.emptyTreks}>
            <Mountain size={28} color={C.textFaint} strokeWidth={1.5} />
            <Text style={s.emptyTreksText}>No completed treks yet</Text>
            <Text style={s.emptyTreksSub}>Tap &quot;Add&quot; to log a trek you&apos;ve finished</Text>
          </View>
        ) : (
          <View>
            {completedTrekObjects.map(trek => (
              <View key={trek.id} style={s.completedCardWrap}>
                <TrekCard trek={trek} isLiked={false} onPress={openTrek} />
                <TouchableOpacity
                  onPress={() => handleRemoveTrek(trek.id)}
                  style={s.removeBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${trek.displayTitle} from completed treks`}>
                  <Trash2 size={16} color={C.red} strokeWidth={2} />
                  <Text style={s.removeBtnText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Danger Zone */}
        <View style={s.dangerZone}>
          <Text style={s.dangerZoneTitle}>Danger Zone</Text>
          <Text style={s.dangerZoneSub}>
            Permanently delete your account and all associated data. This cannot be undone.
          </Text>
          <TouchableOpacity
            onPress={() => setShowDeleteConfirm(true)}
            style={s.deleteAccountBtn}
            testID={T.profile.deleteAccountBtn}
            accessibilityRole="button"
            accessibilityLabel="Delete account">
            <Trash2 size={16} color={C.red} strokeWidth={2} />
            <Text style={s.deleteAccountBtnText}>Delete Account</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Profile picture action sheet */}
      <Modal
        visible={showDpSheet}
        transparent
        animationType="fade"
        // iOS only — see `runDpAction`. This is what lets the photo picker be
        // presented after this sheet is fully gone rather than during its
        // dismissal, when UIKit would silently drop the request.
        onDismiss={flushPendingDpAction}
        onRequestClose={() => setShowDpSheet(false)}>
        <Pressable style={s.pickerOverlay} onPress={() => setShowDpSheet(false)}>
          <Pressable style={s.dpSheet} onPress={() => {}} testID={T.profile.dpSheet}>
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>Profile Picture</Text>
              <TouchableOpacity
                onPress={() => setShowDpSheet(false)}
                style={s.pickerClose}
                testID={T.profile.dpClose}
                accessibilityRole="button"
                accessibilityLabel="Close">
                <X size={20} color={C.textFaint} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            {/* Gallery selection only — the in-app camera capture was removed. */}
            <TouchableOpacity
              style={s.dpAction}
              onPress={() => runDpAction(handlePickPicture)}
              testID={T.profile.dpChooseFromLibrary}
              accessibilityRole="button"
              accessibilityLabel="Choose from library">
              <View style={s.dpActionIcon}>
                <ImageIcon size={18} color={C.brand} strokeWidth={2} />
              </View>
              <Text style={s.dpActionText}>Choose from library</Text>
            </TouchableOpacity>

            {!!profile?.profilePicture && (
              <TouchableOpacity
                style={s.dpAction}
                onPress={() => runDpAction(handleRemovePicture)}
                testID={T.profile.dpRemove}
                accessibilityRole="button"
                accessibilityLabel="Remove current picture">
                <View style={[s.dpActionIcon, { backgroundColor: 'rgba(239,68,68,0.16)' }]}>
                  <Trash2 size={18} color={C.red} strokeWidth={2} />
                </View>
                <Text style={[s.dpActionText, { color: C.red }]}>Remove current picture</Text>
              </TouchableOpacity>
            )}

            <View style={{ height: 8 }} />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Trek Picker Modal */}
      <Modal
        visible={showTrekPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTrekPicker(false)}>
        <Pressable style={s.pickerOverlay} onPress={() => setShowTrekPicker(false)}>
          <Pressable style={s.pickerSheet} onPress={() => {}} testID={T.profile.trekPicker}>
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>Add a Completed Trek</Text>
              <TouchableOpacity
                onPress={() => setShowTrekPicker(false)}
                style={s.pickerClose}
                testID={T.profile.trekPickerClose}
                accessibilityRole="button"
                accessibilityLabel="Close trek picker">
                <X size={20} color={C.textFaint} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <View style={s.pickerSearchWrap}>
              <SearchBar
                value={trekSearch}
                onChangeText={setTrekSearch}
                placeholder="Search trek name..."
                testID={T.profile.trekPickerSearch}
              />
            </View>

            <ScrollView style={s.pickerList} keyboardShouldPersistTaps="handled">
              {filteredTreks.map(item => (
                <TouchableOpacity
                  key={item.id}
                  style={s.pickerItem}
                  testID={trekPickerItemID(item.id)}
                  onPress={() => handleAddTrek(item.id)}>
                  <View style={s.pickerItemIcon}>
                    <Mountain size={16} color={C.brand} strokeWidth={2} />
                  </View>
                  <Text style={s.pickerItemNameOnly} numberOfLines={1}>
                    {item.displayTitle}
                  </Text>
                </TouchableOpacity>
              ))}
              {filteredTreks.length === 0 && (
                <View style={s.pickerEmpty}>
                  <Search size={26} color={C.textFaint} strokeWidth={1.5} />
                  <Text style={s.pickerEmptyText}>No treks found</Text>
                </View>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Full profile view for a searched trekker */}
      <UserProfileModal
        user={viewingUser}
        visible={!!viewingUser}
        onClose={() => setViewingUser(null)}
        onAddToChat={handleAddToChat}
      />

      {/* Group Picker Modal */}
      <Modal
        visible={showGroupPicker}
        transparent
        animationType="fade"
        onRequestClose={closeGroupPicker}>
        <Pressable style={s.pickerOverlay} onPress={closeGroupPicker}>
          <Pressable style={s.pickerSheet} onPress={() => {}}>
            <View style={s.pickerHeader}>
              <View style={{ flex: 1 }}>
                <Text style={s.pickerTitle}>Add to Group Chat</Text>
                {selectedUser && (
                  <Text style={s.pickerSubtitle}>Adding {selectedUser.username ?? 'user'}</Text>
                )}
              </View>
              <TouchableOpacity
                onPress={closeGroupPicker}
                style={s.pickerClose}
                accessibilityRole="button"
                accessibilityLabel="Close group picker">
                <X size={20} color={C.textFaint} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            {loadingGroups ? (
              <View style={s.pickerLoading}>
                <ActivityIndicator size="large" color={C.brand} />
              </View>
            ) : (
              <ScrollView style={s.pickerList} keyboardShouldPersistTaps="handled">
                {myGroups.length === 0 ? (
                  <View style={s.pickerEmpty}>
                    <Users size={28} color={C.textFaint} strokeWidth={1.5} />
                    <Text style={s.pickerEmptyText}>You're not in any groups yet</Text>
                    <Text style={s.pickerEmptySub}>
                      Open a trek and tap "Create Group" to start one.
                    </Text>
                  </View>
                ) : (
                  myGroups.map(group => {
                    const added = !!selectedUser && group.members.some(m => m.id === selectedUser.id);
                    const invited = invitedRoomIds.has(group.id);
                    const full = group.is_full;
                    const busy = addingToGroupId === group.id;
                    const disabled = added || invited || full || busy;
                    return (
                      <TouchableOpacity
                        key={group.id}
                        style={[s.groupItem, disabled && s.groupItemDisabled]}
                        onPress={() => !disabled && handleSelectGroup(group)}
                        disabled={disabled}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={
                          added
                            ? `${selectedUser?.username ?? 'They'} are already in ${group.roomName}`
                            : invited
                              ? `Invite already sent to ${group.roomName}`
                              : full
                                ? `${group.roomName} is full`
                                : `Invite to ${group.roomName}`
                        }>
                        <View style={s.groupItemIcon}>
                          <Users size={17} color={C.brand} strokeWidth={2} />
                        </View>
                        <View style={s.groupItemInfo}>
                          <Text style={s.groupItemName} numberOfLines={1}>
                            {group.roomName}
                          </Text>
                          <Text style={s.groupItemSub} numberOfLines={1}>
                            {group.destinationName} · {group.member_count}/{group.maxMembers} members
                          </Text>
                        </View>
                        {busy ? (
                          <ActivityIndicator size="small" color={C.brand} />
                        ) : added ? (
                          <View style={s.groupItemFullTag}>
                            <Text style={s.groupItemFullTagText}>Added</Text>
                          </View>
                        ) : invited ? (
                          <View style={s.groupItemInviteTag}>
                            <Text style={s.groupItemInviteTagText}>Invite sent</Text>
                          </View>
                        ) : full ? (
                          <View style={s.groupItemFullTag}>
                            <Text style={s.groupItemFullTagText}>Full</Text>
                          </View>
                        ) : (
                          <ChevronRight size={18} color={C.textFaint} strokeWidth={2} />
                        )}
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Delete-account confirmation */}
      <Modal
        visible={showDeleteConfirm}
        transparent
        animationType="fade"
        onRequestClose={closeDeleteConfirm}>
        <Pressable style={s.pickerOverlay} onPress={closeDeleteConfirm}>
          <Pressable style={s.dpSheet} onPress={() => {}} testID={T.profile.deleteAccountSheet}>
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>Delete Account</Text>
              <TouchableOpacity
                onPress={closeDeleteConfirm}
                style={s.pickerClose}
                testID={T.profile.deleteAccountCancel}
                accessibilityRole="button"
                accessibilityLabel="Cancel">
                <X size={20} color={C.textFaint} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <Text style={s.dangerZoneSub}>
              This permanently deletes your profile, likes and completed treks. Enter your
              password to confirm — this cannot be undone.
            </Text>

            <TextInput
              style={[s.input, { marginTop: 14 }]}
              value={deletePassword}
              onChangeText={text => {
                setDeletePassword(text);
                if (deleteError) setDeleteError(null);
              }}
              placeholder="Password"
              placeholderTextColor={C.textFaint}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              testID={T.profile.deleteAccountPassword}
            />

            {deleteError && (
              <Text style={s.deleteErrorText} testID={T.profile.deleteAccountError}>
                {deleteError}
              </Text>
            )}

            <TouchableOpacity
              onPress={handleDeleteAccount}
              disabled={deleting}
              style={[s.confirmDeleteBtn, deleting && { opacity: 0.6 }]}
              testID={T.profile.deleteAccountConfirm}
              accessibilityRole="button"
              accessibilityLabel="Confirm account deletion">
              {deleting ? (
                <ActivityIndicator size="small" color={C.white} />
              ) : (
                <Text style={s.confirmDeleteBtnText}>Permanently Delete Account</Text>
              )}
            </TouchableOpacity>

            <View style={{ height: 8 }} />
          </Pressable>
        </Pressable>
      </Modal>

      <DrawerMenu visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  inviteBadge: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.red,
  },
  scroll: { paddingHorizontal: 20, paddingTop: 16 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  profileHeader: { alignItems: 'center', marginBottom: 20 },
  avatarWrap: { marginBottom: 14 },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: C.brand,
    borderWidth: 2,
    borderColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: { color: C.white, fontSize: 22, fontWeight: '700' },
  profileBio: { color: C.textSub, fontSize: 14, marginTop: 6, textAlign: 'center', lineHeight: 20 },
  profileBioFaint: { color: C.textFaint, fontSize: 14, marginTop: 6, fontStyle: 'italic' },

  sectionLabel: { color: C.white, fontSize: 16, fontWeight: '700', marginBottom: 14 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    marginTop: 32,
  },

  card: {
    backgroundColor: C.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
  },
  fieldGroup: { marginBottom: 18 },
  label: { color: C.textSub, fontSize: 12, fontWeight: '600', marginBottom: 8, letterSpacing: 0.3 },
  inputWrap: { position: 'relative', flexDirection: 'row', alignItems: 'center' },
  inputIcon: { position: 'absolute', left: 14, zIndex: 1 },
  inputClear: {
    position: 'absolute',
    right: 12,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderRadius: 12,
    borderColor: C.border,
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingHorizontal: 14,
    color: C.white,
    fontSize: 14,
  },
  inputWithIcon: { paddingLeft: 40, paddingRight: 38 },
  bioInput: { height: 80, paddingTop: 12, paddingBottom: 12, textAlignVertical: 'top' },
  saveBtn: {
    backgroundColor: C.brand,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnText: { color: C.white, fontSize: 15, fontWeight: '700' },
  saveMsg: { fontSize: 13, marginTop: 10, textAlign: 'center' },
  saveMsgOk: { color: C.green },
  saveMsgError: { color: C.red },

  // User search
  /**
   * Same surface as `card`, with a tighter pad and a bottom margin, because it
   * now leads the page rather than sitting in the middle of a labelled section.
   * The card treatment itself is unchanged — same radius, border and fill.
   */
  searchCard: {
    backgroundColor: C.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 24,
  },
  userSearchBar: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12 },
  searchResults: { marginTop: 14 },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginBottom: 8,
  },
  userRowName: { color: C.white, fontSize: 15, fontWeight: '600', flex: 1 },
  noResults: { color: C.textFaint, fontSize: 14, textAlign: 'center', paddingVertical: 20 },

  toastBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(16,185,129,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.3)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 14,
  },
  toastBoxError: {
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderColor: 'rgba(239,68,68,0.30)',
  },
  toastText: { color: C.green, fontSize: 13, fontWeight: '500', flex: 1 },
  toastTextError: { color: C.red },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(15,82,56,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(15,82,56,0.35)',
  },
  addBtnText: { color: C.green, fontSize: 13, fontWeight: '600' },

  emptyTreks: {
    alignItems: 'center',
    paddingVertical: 36,
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  emptyTreksText: { color: C.textSub, fontSize: 15, fontWeight: '600', marginTop: 12 },
  emptyTreksSub: { color: C.textFaint, fontSize: 13, marginTop: 4 },

  completedCardWrap: { marginBottom: 8 },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    alignSelf: 'center',
  },
  removeBtnText: { color: C.red, fontSize: 12, fontWeight: '500' },

  dangerZone: {
    marginTop: 32,
    marginHorizontal: 22,
    padding: 18,
    borderRadius: 16,
    backgroundColor: 'rgba(239,68,68,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.24)',
  },
  dangerZoneTitle: { color: C.red, fontSize: 15, fontWeight: '700', marginBottom: 6 },
  dangerZoneSub: { color: C.textSub, fontSize: 13, lineHeight: 19 },
  deleteAccountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.4)',
  },
  deleteAccountBtnText: { color: C.red, fontSize: 14, fontWeight: '700' },
  deleteErrorText: { color: C.red, fontSize: 12, marginTop: 10 },
  confirmDeleteBtn: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: C.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDeleteBtnText: { color: C.white, fontSize: 14, fontWeight: '700' },

  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  pickerSheet: {
    width: '100%',
    maxWidth: 500,
    maxHeight: '80%',
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  dpSheet: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
    paddingBottom: 8,
  },
  dpAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  dpActionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(15,82,56,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dpActionText: { color: C.white, fontSize: 15, fontWeight: '500' },

  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  pickerTitle: { color: C.white, fontSize: 16, fontWeight: '700' },
  pickerSubtitle: { color: C.textFaint, fontSize: 12, marginTop: 2 },
  pickerClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerSearchWrap: { flexDirection: 'row', margin: 16, marginBottom: 4 },
  pickerList: { paddingHorizontal: 16, paddingVertical: 12 },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginBottom: 8,
    gap: 12,
  },
  pickerItemIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(15,82,56,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerItemNameOnly: { color: C.white, fontSize: 14, fontWeight: '600', flex: 1 },
  pickerEmpty: { paddingVertical: 32, alignItems: 'center' },
  pickerEmptyText: { color: C.textFaint, fontSize: 14, textAlign: 'center', marginTop: 8 },
  pickerEmptySub: { color: C.textFaint, fontSize: 12, textAlign: 'center', marginTop: 4 },
  pickerLoading: { paddingVertical: 40, alignItems: 'center' },

  groupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 10,
    gap: 12,
  },
  groupItemDisabled: { opacity: 0.5 },
  groupItemIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.brandDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupItemInfo: { flex: 1 },
  groupItemName: { color: C.white, fontSize: 15, fontWeight: '700' },
  groupItemSub: { color: C.textFaint, fontSize: 12, marginTop: 3 },
  groupItemFullTag: {
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  groupItemFullTagText: { color: C.textFaint, fontSize: 11, fontWeight: '700' },
  groupItemInviteTag: {
    backgroundColor: C.brandDim,
    borderWidth: 1,
    borderColor: 'rgba(15,82,56,0.35)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  groupItemInviteTagText: { color: C.green, fontSize: 11, fontWeight: '700' },

  /* Centred in the space above the floating tab bar — see `TAB_BAR_SPACE`. */
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: TAB_BAR_SPACE,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(15,82,56,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  emptyTitle: { color: C.white, fontSize: 18, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  emptySub: { color: C.textFaint, fontSize: 14, lineHeight: 22, textAlign: 'center', marginBottom: 24 },
  ctaBtn: { backgroundColor: C.brand, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 14 },
  ctaText: { color: C.white, fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    marginTop: 12,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  secondaryText: { color: C.textSub, fontSize: 15, fontWeight: '600' },
});
