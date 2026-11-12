import { FILM_PHOTOS, type FaceCrop, type Photo } from '../photos';

/** One person in the film: a photo plus the face to frame within it. */
export interface CastMember {
  photo: Photo;
  face: FaceCrop;
  name: string;
}

const { elena, marco } = FILM_PHOTOS;

export const ELENA: CastMember = { photo: elena, face: elena.face, name: elena.name };
export const MARCO: CastMember = { photo: marco, face: marco.face, name: marco.name };
