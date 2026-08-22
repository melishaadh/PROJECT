import React from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';
import ExploreScreen from '@/screens/ExploreScreen';

/**
 * Each tab owns its own boundary, so a render error here degrades to a retry
 * card in this tab instead of replacing the whole app with the root crash screen.
 */
export default function ExploreTab() {
  return (
    <ErrorBoundary label="Explore">
      <ExploreScreen />
    </ErrorBoundary>
  );
}
