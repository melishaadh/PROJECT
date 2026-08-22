import React from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';
import ChatThreadScreen from '@/screens/ChatThreadScreen';

export default function ChatRoomRoute() {
  return (
    <ErrorBoundary label="chat">
      <ChatThreadScreen />
    </ErrorBoundary>
  );
}
