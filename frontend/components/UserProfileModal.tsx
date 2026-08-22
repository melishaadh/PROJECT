import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { ArrowLeft, ExternalLink, Mountain, MessageSquarePlus } from 'lucide-react-native';
import { router } from 'expo-router';
import Avatar from '@/components/Avatar';
import TrekCard from '@/components/TrekCard';
import { DESTINATIONS } from '@/data/destinations';
import { useLikes } from '@/hooks/useLikes';
import { SearchUser, fetchUserProfile } from '@/lib/userSearchService';
import { C } from '@/constants/theme';

interface UserProfileModalProps {
  /** The list item that was tapped; used to render immediately, then refreshed. */
  user: SearchUser | null;
  visible: boolean;
  onClose: () => void;
  /** Opens the group picker for this user. */
  onAddToChat: (user: SearchUser) => void;
}

/**
 * Another trekker's profile, full screen.
 *
 * Presented as `pageSheet`-less full-screen rather than the bottom sheet it
 * used to be: a sheet capped at 90% height left the underlying profile page
 * peeking through and gave the completed-trek list barely any room, so a user
 * with more than three or four logged treks was scrolling a list inside a
 * scrollable sheet. Full screen also makes the back affordance unambiguous —
 * there is one obvious way out, top-left, in the place a back button belongs.
 *
 * The completed treks use `TrekCard`, the same component the Explore feed
 * renders, so a trek looks identical wherever it appears. The hearts are
 * indicators only: there is no `onLike`, because liking from inside somebody
 * else's profile is not a thing this screen does.
 *
 * Nothing here shows the user's age. The public-profile endpoint does not
 * return it — age is confidential and exists only for the backend's KNN and
 * safety matrices.
 */
export default function UserProfileModal({
  user,
  visible,
  onClose,
  onAddToChat,
}: UserProfileModalProps) {
  const [full, setFull] = useState<SearchUser | null>(user);
  const [loading, setLoading] = useState(false);
  const { liked, countFor } = useLikes();

  useEffect(() => {
    setFull(user);
    if (!visible || !user) return;

    // Search results are a projection; re-fetch so the view always shows the
    // profile as it stands right now.
    let active = true;
    setLoading(true);
    fetchUserProfile(user.id)
      .then(p => {
        if (!active) return;
        if (p) setFull(p);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user, visible]);

  const profile = full ?? user;

  // Guarded twice over: the field may be absent on the payload, and an id may
  // reference a trek no longer in the catalogue.
  const completedTrekIds = Array.isArray(profile?.completedTrekIds)
    ? profile.completedTrekIds
    : [];
  const completedTreks = completedTrekIds
    .map(id => DESTINATIONS.find(d => d.id === id))
    .filter(Boolean) as typeof DESTINATIONS;

  const openSocial = () => {
    if (!profile?.socialMediaLink) return;
    const url = /^https?:\/\//i.test(profile.socialMediaLink)
      ? profile.socialMediaLink
      : `https://${profile.socialMediaLink}`;
    Linking.openURL(url).catch(() => {});
  };

  /** Leave this profile and open a trek. Close first so the route is visible. */
  const openTrek = (trekId: string) => {
    onClose();
    router.push(`/trek/${trekId}`);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}>
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />

        {/*
          Back to the user's own profile. Also wired to the hardware back
          button through `onRequestClose`, so both routes out behave the same.
        */}
        <View style={s.header}>
          <TouchableOpacity
            onPress={onClose}
            style={s.backBtn}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back to your profile">
            <ArrowLeft size={20} color={C.white} strokeWidth={2.2} />
          </TouchableOpacity>
          <Text style={s.headerTitle} numberOfLines={1}>
            {profile?.username ?? 'Profile'}
          </Text>
          {/* Balances the back button so the title stays optically centred. */}
          <View style={s.headerSpacer} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.body}>
          <View style={s.identity}>
            <Avatar uri={profile?.profilePicture} size={92} bordered />
            <Text style={s.username}>{profile?.username ?? 'Unknown'}</Text>
            {profile?.bio ? (
              <Text style={s.bio}>{profile.bio}</Text>
            ) : (
              <Text style={s.bioFaint}>No bio yet</Text>
            )}
            {loading && (
              <ActivityIndicator size="small" color={C.brand} style={{ marginTop: 12 }} />
            )}
          </View>

          {profile?.socialMediaLink ? (
            <TouchableOpacity
              onPress={openSocial}
              style={s.socialRow}
              accessibilityRole="link"
              accessibilityLabel={`Open ${profile.username ?? 'this user'}'s social link`}>
              <ExternalLink size={14} color={C.brandLight} strokeWidth={2} />
              <Text style={s.socialText} numberOfLines={1}>
                {profile.socialMediaLink}
              </Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            onPress={() => profile && onAddToChat(profile)}
            disabled={!profile}
            style={[s.addChatBtn, !profile && s.addChatBtnDisabled]}
            accessibilityRole="button"
            accessibilityLabel={`Add ${profile?.username ?? 'user'} to a group chat`}>
            <MessageSquarePlus size={17} color={C.white} strokeWidth={2} />
            <Text style={s.addChatText}>Add to Chat</Text>
          </TouchableOpacity>

          <View style={s.sectionHeader}>
            <Text style={s.sectionLabel}>Completed Treks</Text>
            <Text style={s.sectionCount}>
              {completedTreks.length} {completedTreks.length === 1 ? 'trek' : 'treks'}
            </Text>
          </View>

          {completedTreks.length === 0 ? (
            <View style={s.emptyTreks}>
              <Mountain size={28} color={C.textFaint} strokeWidth={1.5} />
              <Text style={s.emptyTreksText}>No completed treks logged yet</Text>
            </View>
          ) : (
            completedTreks.map(trek => (
              <TrekCard
                key={trek.id}
                trek={trek}
                isLiked={liked.has(trek.id)}
                likeCount={countFor(trek.id)}
                onPress={openTrek}
              />
            ))
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.bg,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    color: C.white,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginHorizontal: 12,
  },
  headerSpacer: { width: 38 },

  body: { paddingHorizontal: 20, paddingTop: 26 },

  identity: { alignItems: 'center', marginBottom: 22 },
  username: { color: C.white, fontSize: 22, fontWeight: '700', marginTop: 14 },
  bio: { color: C.textSub, fontSize: 14, marginTop: 8, textAlign: 'center', lineHeight: 20 },
  bioFaint: { color: C.textFaint, fontSize: 14, marginTop: 8, fontStyle: 'italic' },

  socialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 16,
  },
  socialText: { color: C.brandLight, fontSize: 13, flex: 1 },

  addChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: C.brand,
    paddingVertical: 15,
    borderRadius: 14,
    marginBottom: 30,
  },
  addChatBtnDisabled: { opacity: 0.5 },
  addChatText: { color: C.white, fontSize: 15, fontWeight: '700' },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionLabel: { color: C.white, fontSize: 16, fontWeight: '700' },
  sectionCount: { color: C.textFaint, fontSize: 12 },

  emptyTreks: {
    alignItems: 'center',
    paddingVertical: 34,
    gap: 10,
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  emptyTreksText: { color: C.textFaint, fontSize: 13 },
});
