import React, { useEffect, useState } from 'react';
import { View, Image, Text, StyleSheet, ViewStyle } from 'react-native';
import { User as UserIcon } from 'lucide-react-native';
import { C } from '@/constants/theme';
import { resolveImageUri } from '@/lib/apiConfig';

/** First letter of up to the first two words, e.g. "Tenzin Sherpa" → "TS". */
function initialsFor(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(word => word[0])
    .join('');
  return letters.toUpperCase();
}

interface AvatarProps {
  /**
   * The stored picture reference: an absolute URL, an inline `data:` URI, or a
   * server-relative `/uploads/...` path. Empty/undefined → fallback.
   */
  uri?: string | null;
  /**
   * A display name to derive a fallback from when there's no picture — a
   * member list reads as "who are these people" more easily from initials
   * than from a row of identical anonymous icons. Falls back to the generic
   * icon when omitted or empty, same as before this prop existed.
   */
  initials?: string | null;
  size?: number;
  /** Thicker ring, used for the large profile header. */
  bordered?: boolean;
  style?: ViewStyle;
}

/**
 * Renders a user's DP everywhere one is shown — profile header, drawer,
 * search results, chat member lists — falling back to the brand icon so a
 * user without a picture never renders a broken image.
 *
 * Every DP in the app goes through here, which is why URI resolution and load
 * failures are handled at this level rather than at each call site. See
 * `resolveImageUri`: a locally-stored upload arrives as a relative path that
 * `<Image>` cannot load on its own.
 */
export default function Avatar({ uri, initials, size = 40, bordered, style }: AvatarProps) {
  const dimension = { width: size, height: size, borderRadius: size / 2 };
  const source = resolveImageUri(uri);

  // A picture that 404s must fall back to the icon rather than leaving an empty
  // circle. Keyed off `source` so a newly uploaded picture always gets a fresh
  // attempt instead of inheriting the previous one's failure.
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [source]);

  const showImage = !!source && !failed;
  const fallbackInitials = !showImage && initials ? initialsFor(initials) : '';

  return (
    <View
      style={[
        s.wrap,
        dimension,
        bordered && { borderWidth: 2, borderColor: 'rgba(15,82,56,0.35)' },
        style,
      ]}>
      {showImage ? (
        <Image
          source={{ uri: source }}
          style={dimension}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : fallbackInitials ? (
        <Text style={[s.initials, { fontSize: Math.round(size * 0.4) }]}>{fallbackInitials}</Text>
      ) : (
        <UserIcon size={Math.round(size * 0.45)} color={C.brand} strokeWidth={2} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    backgroundColor: 'rgba(15,82,56,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initials: { color: C.green, fontWeight: '700' },
});
