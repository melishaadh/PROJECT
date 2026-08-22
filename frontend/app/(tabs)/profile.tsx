import React from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';
import ProfileScreen from '@/screens/ProfileScreen';

export default function ProfileTab() {
  return (
    <ErrorBoundary label="Profile">
      <ProfileScreen />
    </ErrorBoundary>
  );
}
