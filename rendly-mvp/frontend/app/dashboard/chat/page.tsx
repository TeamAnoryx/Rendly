'use client';

import React, { Suspense, useRef } from 'react';
import { ChatPageContent } from './ChatPageContent';
import { setCallChatOpen, setCallDock, useCallChatOpen } from '@/components/call/callDock';
import { Icon } from '@/components/shell/Icon';
import './whispers.css';

/** How far the chat sheet must be dragged down (px) before letting go closes it. */
const SHEET_CLOSE_DRAG_PX = 80;

/**
 * On phones during a video call the chat is a sheet that slides up over your own video.
 * Its grab bar closes it on a downward swipe; the button closes it on a tap.
 */
function ChatSheetHandle() {
  const startY = useRef<number | null>(null);
  const dragY = useRef(0);

  const moveSheet = (el: HTMLElement, dy: number) => {
    const sheet = el.parentElement;
    if (sheet) sheet.style.transform = dy ? `translateY(${dy}px)` : '';
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    startY.current = e.clientY;
    dragY.current = 0;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (startY.current == null) return;
    dragY.current = Math.max(0, e.clientY - startY.current);
    moveSheet(e.currentTarget, dragY.current);
  };
  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (startY.current == null) return;
    startY.current = null;
    moveSheet(e.currentTarget, 0);
    if (dragY.current > SHEET_CLOSE_DRAG_PX) setCallChatOpen(false);
    dragY.current = 0;
  };

  return (
    <div
      className="chat-call-sheet-handle"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <span className="chat-call-sheet-grip" aria-hidden />
      <button
        type="button"
        className="chat-call-sheet-close"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setCallChatOpen(false)}
        aria-label="Close chat"
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

export default function ChatPage() {
  const chatOpen = useCallChatOpen();
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
      <div className={`chat-call-layout${chatOpen ? ' chat-call-layout--chat-open' : ''}`}>
        <div id="rd-call-dock" className="chat-call-dock" ref={setCallDock} />
        <div className="chat-call-main">
          <ChatSheetHandle />
          <ChatPageContent />
        </div>
      </div>
    </Suspense>
  );
}
