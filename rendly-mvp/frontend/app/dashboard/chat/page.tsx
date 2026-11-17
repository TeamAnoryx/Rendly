'use client';

import React, { Suspense } from 'react';
import { ChatPageContent } from './ChatPageContent';
import './whispers.css';

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div
          className="chat-page chat-page-loading"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60vh',
            color: 'var(--text-muted, #6b7280)',
          }}
        >
          Loading chat…
        </div>
      }
    >
      {/* A call in Whispers renders into the dock (left, or on top on phones) beside the chat. */}
      <div className="chat-call-layout">
        <div id="rd-call-dock" className="chat-call-dock" />
        <div className="chat-call-main">
          <ChatPageContent />
        </div>
      </div>
    </Suspense>
  );
}
