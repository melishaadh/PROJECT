import React from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';
import ExploreChatsScreen from '@/screens/ExploreChatsScreen';

export default function ChatroomTab() {
  return (
    <ErrorBoundary label="Chatroom">
      <ExploreChatsScreen />
    </ErrorBoundary>
  );
}
