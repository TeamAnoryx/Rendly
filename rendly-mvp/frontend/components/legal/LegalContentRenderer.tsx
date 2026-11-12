'use client';

import React from 'react';
import type { LegalSection } from '@/content/legalContent';

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

function linkify(text: string): React.ReactNode {
  const parts = text.split(URL_REGEX);
  return parts.map((part, i) =>
    part.match(URL_REGEX) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#f7f8f8] underline decoration-white/30 underline-offset-2 hover:decoration-white transition-colors duration-100 [overflow-wrap:anywhere]"
      >
        {part}
      </a>
    ) : (
      part
    )
  );
}

const headingClasses = {
  2: 'font-semibold tracking-[-0.015em] text-[#f7f8f8] text-base sm:text-[17px] mt-7 mb-3 first:mt-0',
  3: 'font-semibold tracking-[-0.01em] text-[#f7f8f8] text-[15px] mt-5 mb-2',
  4: 'font-medium text-[#d0d6e0] text-sm mt-4 mb-1',
};

export function LegalContentRenderer({ sections }: { sections: LegalSection[] }) {
  return (
    <div className="space-y-1 text-[#8a8f98] text-[13px] sm:text-sm leading-relaxed">
      {sections.map((section, idx) => (
        <section key={`${section.title}-${idx}`}>
          {section.level === 2 && (
            <h2 className={headingClasses[2]}>
              {section.title}
            </h2>
          )}
          {section.level === 3 && (
            <h3 className={headingClasses[3]}>
              {section.title}
            </h3>
          )}
          {section.level === 4 && (
            <h4 className={headingClasses[4]}>
              {section.title}
            </h4>
          )}
          {section.paragraphs?.map((p, i) => (
            <p key={i} className="mb-3">
              {linkify(p)}
            </p>
          ))}
          {section.list && section.list.length > 0 && (
            <ul className="list-disc pl-5 marker:text-[#62666d] mb-3 space-y-1">
              {section.list.map((item, i) => (
                <li key={i}>{linkify(item)}</li>
              ))}
            </ul>
          )}
          {section.numbered && section.numbered.length > 0 && (
            <ol className="list-decimal pl-5 marker:text-[#62666d] mb-3 space-y-1">
              {section.numbered.map((item, i) => (
                <li key={i}>{linkify(item)}</li>
              ))}
            </ol>
          )}
          {section.paragraphsAfterList?.map((p, i) => (
            <p key={i} className="mb-3">
              {linkify(p)}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}
