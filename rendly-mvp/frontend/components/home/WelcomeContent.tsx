'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import ProceedButton from '@/components/common/ProceedButton';
import { withBasePath } from '@/lib/basePath';

const LOGO_ANIMATION_DURATION_MS = 2000;

export default function WelcomeContent() {
  const [showButton, setShowButton] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShowButton(true), LOGO_ANIMATION_DURATION_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="h-screen max-h-screen w-full flex flex-col items-center justify-center bg-background overflow-hidden">
      <div className="absolute inset-0 bg-gradient-light pointer-events-none" />

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-40 -left-40 w-80 h-80 rounded-full mix-blend-multiply filter blur-3xl opacity-10 bg-space_indigo"
          style={{ animation: 'blobPulse1 8s ease-in-out infinite' }}
        />
        <div
          className="absolute -bottom-40 -right-40 w-80 h-80 rounded-full mix-blend-multiply filter blur-3xl opacity-10 bg-glaucous"
          style={{ animation: 'blobPulse2 8s ease-in-out infinite 1s' }}
        />
      </div>

      <div className="relative z-10 w-full h-full min-h-0 flex flex-col items-center justify-start overflow-hidden px-4 sm:px-6 md:px-8 pt-2 sm:pt-4 md:pt-6 pb-12">
        <div className="relative flex items-center justify-center w-full flex-1 min-h-0 overflow-visible -mt-12 sm:-mt-16 md:-mt-20">
          <div className="relative flex flex-col items-center justify-center gap-6 sm:gap-8 md:gap-10">
            <div
              className="relative flex items-center justify-center z-0 lg:-mb-32 lg:-translate-y-[270px]"
              style={{ animation: 'logoZoomIn 2s ease-out forwards' }}
            >
              <div
                className="relative w-[min(92vw,560px)] h-[min(92vw,560px)] sm:w-[min(88vw,640px)] sm:h-[min(88vw,640px)] md:w-[min(85vw,720px)] md:h-[min(85vw,720px)] lg:w-[min(92vw,960px)] lg:h-[min(92vw,960px)]"
                style={{ animation: 'logoPulse 3.5s ease-in-out infinite 2s' }}
              >
                <Image
                  src={withBasePath('/images/logo.svg')}
                  alt="Rendly"
                  fill
                  className="object-contain"
                  priority
                  sizes="(max-width: 768px) 92vw, (max-width: 1024px) 720px, 960px"
                />
              </div>
            </div>

            <p className="tagline-home relative z-10 text-center font-semibold tracking-wide opacity-0 w-full max-w-[90vw] sm:max-w-xl md:max-w-2xl lg:max-w-3xl px-3 sm:px-4 pb-0 lg:pb-[100px] lg:top-[-200px] text-lg min-[380px]:text-xl sm:text-2xl md:text-3xl lg:text-4xl xl:text-[2.5rem]">
              Know Your Why, Find Your Who
            </p>

            <div
              className="relative z-10 flex justify-center items-center pointer-events-none min-h-[52px] lg:top-[-200px]"
              style={{ pointerEvents: showButton ? 'auto' : 'none' }}
            >
              <div className="pointer-events-auto shrink-0">
                <ProceedButton shouldShow={showButton} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className="absolute bottom-8 left-1/2 -translate-x-1/2 transition-opacity duration-500"
        style={{
          opacity: showButton ? 0 : 0.6,
          animation: showButton ? 'none' : 'scrollBounce 1.5s ease-in-out infinite',
        }}
      >
        <svg
          className="w-6 h-6 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </div>
    </div>
  );
}
