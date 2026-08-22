import React from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';
import ForYouScreen from '@/screens/ForYouScreen';

export default function ForYouTab() {
  return (
    <ErrorBoundary label="For You">
      <ForYouScreen />
    </ErrorBoundary>
  );
}
