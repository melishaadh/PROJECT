import React from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';
import ItineraryScreen from '@/screens/ItineraryScreen';

export default function ItineraryRoute() {
  return (
    <ErrorBoundary label="itinerary">
      <ItineraryScreen />
    </ErrorBoundary>
  );
}
