'use client';

/** Real people for the film's avatars: the POV portraits in /public/images. */

import React from 'react';
import { withBasePath } from '@/lib/basePath';

/** Portraits with one clear face, in the order the film hands them out. */
export const FACES = ['pov3', 'pov14', 'pov7', 'pov10', 'pov15', 'pov2', 'pov11', 'pov1', 'pov20', 'pov5', 'pov4', 'pov16', 'pov18'] as const;
export type FaceName = (typeof FACES)[number];

/** The i-th face, wrapping around the list. */
export const faceAt = (i: number): FaceName => FACES[((i % FACES.length) + FACES.length) % FACES.length];

interface FaceProps {
  name: FaceName;
  className?: string;
  /** object-position for the crop (faces sit high in most portraits). */
  focus?: string;
}

/** A round photo avatar. Decorative: the film describes people in its text alternative. */
export function Face({ name, className = '', focus = '50% 28%' }: FaceProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`fl-face ${className}`}
      src={withBasePath(`/images/${name}.jpg`)}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      style={{ objectPosition: focus }}
    />
  );
}
