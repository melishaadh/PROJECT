import React from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';
import MyChatsScreen from '@/screens/MyChatsScreen';

export default function MyChatsRoute() {
  return (
    <ErrorBoundary label="my chats">
      <MyChatsScreen />
    </ErrorBoundary>
  );
}
