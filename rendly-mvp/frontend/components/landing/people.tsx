import React from 'react';
import { faceCrop, type Photo } from './photos';

/**
 * Photo primitives for the marketing pages. The data lives in ./photos.ts,
 * a per-section registry where no image is used twice.
 */
export type { Photo } from './photos';

interface PhotoProps {
  photo: Photo;
  className?: string;
  /**
   * Crop tightly on the face (photo.face) for a box of this aspect
   * (width / height). Without it, the photo is cover-fitted around `focus`.
   */
  cropAspect?: number;
  /** Empty alt when the name is already printed next to the photo. */
  decorative?: boolean;
  loading?: 'lazy' | 'eager';
}

function altFor(photo: Photo, decorative: boolean): string {
  if (decorative) return '';
  if (photo.alt !== undefined) return photo.alt;
  if (photo.name === 'You') return 'Your camera';
  return photo.name ?? '';
}

/** A portrait: cover-fitted around its focus, or tightly cropped on one face. */
export function PersonPhoto({ photo, className = '', cropAspect, decorative = false, loading = 'lazy' }: PhotoProps) {
  const crop = cropAspect && photo.face ? faceCrop(photo.face, photo.ratio, cropAspect) : null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static, pre-sized marketing photos
    <img
      src={photo.src}
      alt={altFor(photo, decorative)}
      className={`ld-photo${crop ? ' ld-photo--crop' : ''} ${className}`}
      loading={loading}
      decoding="async"
      draggable={false}
      style={
        crop
          ? { width: `${crop.width}%`, left: `${crop.left}%`, top: `${crop.top}%` }
          : { objectPosition: photo.focus }
      }
    />
  );
}

interface AvatarProps {
  photo: Photo;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  online?: boolean;
  className?: string;
}

/** Circular avatar cropped on the face; keeps the online dot outside the clip. */
export function PersonAvatar({ photo, size = 'sm', online = false, className = '' }: AvatarProps) {
  return (
    <span className={`ld-avatar ld-avatar--${size} ld-avatar--photo ${className}`}>
      <span className="ld-avatar-clip">
        <PersonPhoto photo={photo} cropAspect={1} decorative />
      </span>
      {online && <span className="ld-online" />}
    </span>
  );
}
