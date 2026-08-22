import React, { useCallback } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { Heart, Clock, Sparkles } from 'lucide-react-native';
import { Destination } from '@/data/destinations';
import { TrekSurface, trekCardID, trekLikeID } from '@/constants/testIDs';
import { C, DIFFICULTY_COLOR } from '@/constants/theme';

const { width } = Dimensions.get('window');

interface TrekCardProps {
  trek: Destination;
  /**
   * Receives the trek id rather than closing over it.
   *
   * This is what makes `React.memo` on this component actually do something: a
   * parent can hoist one `useCallback` handler for the whole list instead of
   * minting a fresh `() => handle(item.id)` arrow per row on every render, which
   * failed the props comparison every time and re-rendered all thirty cards on
   * any state change.
   */
  onPress: (trekId: string) => void;
  /** Omit to render the heart as a non-interactive indicator. */
  onLike?: (trekId: string) => void;
  isLiked: boolean;
  /**
   * Server-aggregated count of unique user likes. Renders as 0 until the live
   * counts have loaded; the catalogue's static `likes` seed is deliberately not
   * used as a fallback, because swapping a fabricated seed for the real
   * aggregate on first like is what made the count appear to reset.
   */
  likeCount?: number;
  /** True while this trek's like/unlike request is in flight. */
  likePending?: boolean;
  compact?: boolean;
  /**
   * Which screen is rendering this card, which namespaces its testIDs.
   *
   * Omitted on the surfaces the end-to-end suite does not drive — the completed
   * treks on a profile and in the trekker modal — so those render no testIDs at
   * all rather than duplicating the ids of the feed cards for the same route.
   */
  surface?: TrekSurface;
  /**
   * One short line on why the recommendation engine surfaced this trek, shown
   * as a chip under the title. Only the For You feed supplies it; every other
   * surface renders the card without one.
   */
  reason?: string;
}

function TrekCard({
  trek,
  onPress,
  onLike,
  isLiked,
  likeCount,
  likePending,
  compact,
  surface,
  reason,
}: TrekCardProps) {
  // Bound to this card's id once, so the touchables receive a stable handler
  // even though the parent's callback is shared across every row.
  const handlePress = useCallback(() => onPress(trek.id), [onPress, trek.id]);
  const handleLike = useCallback(() => onLike?.(trek.id), [onLike, trek.id]);

  const diffColor = DIFFICULTY_COLOR[trek.difficulty] ?? C.textFaint;
  // The server aggregate only. Falling back to `trek.likes` (a static catalogue
  // seed) is what made the count jump from a fabricated number to the real one
  // on the first like.
  const likes = likeCount ?? 0;
  const title = trek.displayTitle || trek.parentName || 'Trek';
  const likeLabel = isLiked ? `Unlike ${title}` : `Like ${title}`;
  // Disabled while a like is in flight, so a double-tap cannot fire a like and
  // an unlike that race each other.
  const likeDisabled = !onLike || likePending;

  // Undefined on the surfaces that opt out, which React Native treats as "no
  // testID attribute" rather than rendering an empty one.
  const cardTestID = surface ? trekCardID(surface, trek.id) : undefined;
  const likeTestID = surface ? trekLikeID(surface, trek.id, isLiked) : undefined;

  if (compact) {
    return (
      <TouchableOpacity
        onPress={handlePress}
        style={s.compact}
        activeOpacity={0.85}
        testID={cardTestID}>
        <Image source={trek.image} style={s.compactImage} resizeMode="cover" />
        <View style={[s.diffBadge, { backgroundColor: diffColor }]}>
          <Text style={s.diffBadgeText}>{trek.difficulty}</Text>
        </View>
        <View style={s.compactBody}>
          <Text style={s.compactName} numberOfLines={1}>{title}</Text>
          <View style={s.compactRow}>
            <TouchableOpacity
              onPress={handleLike}
              disabled={likeDisabled}
              hitSlop={6}
              testID={likeTestID}
              style={[s.likeBtn, likePending && s.likeBusy]}
              accessibilityRole="button"
              accessibilityLabel={likeLabel}
              accessibilityState={{ selected: isLiked, busy: likePending, disabled: likeDisabled }}>
              <Heart
                size={14}
                color={isLiked ? C.red : C.textFaint}
                fill={isLiked ? C.red : 'transparent'}
                strokeWidth={2}
              />
              <Text style={s.compactLikes}>{likes}</Text>
            </TouchableOpacity>
            <Text style={s.compactPrice}>
              {Math.round((trek.priceNPR ?? 0) / 1000)}K
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      style={s.card}
      activeOpacity={0.88}
      testID={cardTestID}>
      <Image source={trek.image} style={s.cardImage} resizeMode="cover" />

      <TouchableOpacity
        onPress={handleLike}
        disabled={likeDisabled}
        testID={likeTestID}
        style={[s.likeOverlay, likePending && s.likeBusy]}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={likeLabel}
        accessibilityState={{ selected: isLiked, busy: likePending, disabled: likeDisabled }}>
        <Heart
          size={18}
          color={isLiked ? C.red : C.white}
          fill={isLiked ? C.red : 'transparent'}
          strokeWidth={2}
        />
      </TouchableOpacity>

      <View style={[s.diffBadge, { backgroundColor: diffColor }]}>
        <Text style={s.diffBadgeText}>{trek.difficulty}</Text>
      </View>

      <View style={s.cardBody}>
        <Text style={s.cardName} numberOfLines={1}>{title}</Text>
        <Text style={s.cardParent} numberOfLines={1}>{trek.parentName}</Text>
        {/*
          Why this trek was surfaced. Deliberately understated — it explains the
          feed without competing with the trek's own name, and is omitted
          entirely when the engine had nothing specific to say rather than
          padded with a generic line.
        */}
        {reason ? (
          <View style={s.reasonChip}>
            <Sparkles size={10} color={C.brandLight} strokeWidth={2.5} />
            <Text style={s.reasonText} numberOfLines={1}>{reason}</Text>
          </View>
        ) : null}
        <View style={s.cardFooter}>
          <View style={s.cardMeta}>
            <Clock size={13} color={C.brand} strokeWidth={2} />
            <Text style={s.cardMetaText}>{trek.durationDays}d</Text>
            <Heart
              size={13}
              color={isLiked ? C.red : C.textFaint}
              fill={isLiked ? C.red : 'transparent'}
              strokeWidth={2}
            />
            <Text style={s.cardMetaText}>{likes}</Text>
          </View>
          <Text style={s.cardPrice}>NPR {(trek.priceNPR ?? 0).toLocaleString()}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

/**
 * Memoized.
 *
 * Every list that renders these is driven by shared like state, so without this
 * a single heart tap re-rendered all thirty cards — each one re-reading a
 * `require`d image and re-laying out its body. The props are all primitives, the
 * `trek` object is a stable reference out of the catalogue, and the two handlers
 * are hoisted `useCallback`s at each call site, so the default shallow
 * comparison is sufficient and correct; a custom comparator would only be a
 * place for a newly added prop to be silently forgotten.
 */
export default React.memo(TrekCard);

const s = StyleSheet.create({
  /* Full card */
  card: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 14,
  },
  cardImage: { width: '100%', height: 190 },
  likeOverlay: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Subtle dim while the like request is in flight. */
  likeBusy: { opacity: 0.55 },
  diffBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  diffBadgeText: { color: C.white, fontSize: 11, fontWeight: '700' },
  cardBody: { padding: 14 },
  cardName: { color: C.white, fontSize: 15, fontWeight: '600' },
  cardParent: { color: C.textFaint, fontSize: 12, marginTop: 2 },
  reasonChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: C.brandDim,
    borderWidth: 1,
    borderColor: 'rgba(25,122,83,0.28)',
    maxWidth: '100%',
  },
  reasonText: { color: C.brandLight, fontSize: 10, fontWeight: '600', flexShrink: 1 },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardMetaText: { color: C.textSub, fontSize: 12 },
  cardPrice: { color: C.green, fontSize: 13, fontWeight: '700' },

  /* Compact card */
  compact: {
    width: width * 0.58,
    marginRight: 12,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  compactImage: { width: '100%', height: 130 },
  compactBody: { padding: 12 },
  compactName: { color: C.white, fontSize: 13, fontWeight: '600' },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  likeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  compactLikes: { color: C.textFaint, fontSize: 12 },
  compactPrice: { color: C.green, fontSize: 13, fontWeight: '700' },
});
