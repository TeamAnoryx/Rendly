'use client';

/**
 * Chat message text with clickable links. Ordinary links open in a new tab; Rendly Huddle invite
 * links are highlighted as a "Join Huddle" chip (same tab when they point at this site).
 */
import { useMemo } from 'react';
import { linkify } from '@/lib/linkify';
import './linkified-text.css';

interface LinkifiedTextProps {
  text: string;
}

function isSameOrigin(href: string): boolean {
  try {
    return typeof window !== 'undefined' && new URL(href).origin === window.location.origin;
  } catch {
    return false;
  }
}

export default function LinkifiedText({ text }: LinkifiedTextProps) {
  const tokens = useMemo(() => linkify(text), [text]);
  return (
    <>
      {tokens.map((token, i) => {
        if (token.kind === 'text') return <span key={i}>{token.text}</span>;
        if (token.kind === 'huddle') {
          const external = !isSameOrigin(token.href);
          return (
            <a
              key={i}
              href={token.href}
              className="chat-link chat-link--huddle"
              title={token.href}
              {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="chat-link-huddle-dot" aria-hidden />
              Huddle invite · Join
            </a>
          );
        }
        return (
          <a
            key={i}
            href={token.href}
            className="chat-link"
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={(e) => e.stopPropagation()}
          >
            {token.text}
          </a>
        );
      })}
    </>
  );
}
