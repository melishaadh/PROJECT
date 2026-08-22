import React from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';
import NewExpeditionScreen from '@/screens/NewExpeditionScreen';

export default function NewExpeditionRoute() {
  return (
    <ErrorBoundary label="new expedition">
      <NewExpeditionScreen />
    </ErrorBoundary>
  );
}
