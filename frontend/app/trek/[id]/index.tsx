import React from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';
import TrekDetailScreen from '@/screens/TrekDetailScreen';

export default function TrekDetailRoute() {
  return (
    <ErrorBoundary label="trek detail">
      <TrekDetailScreen />
    </ErrorBoundary>
  );
}
