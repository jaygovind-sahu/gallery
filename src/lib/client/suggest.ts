/** Browser side of AI suggestions: make the small copy of the photo that is sent, and call the admin API. */
import type { SuggestResult } from '../ai-pure';
import { api } from './http';
import { decode } from './metadata';

/** Long edge of the copy sent to the model: enough to recognise a subject, a fraction of the original's size. */
export const AI_IMAGE_EDGE = 1568;

/** Downscale any image the browser can decode to a JPEG, orientation applied, and return it as base64. */
export async function makeAiImage(source: Blob, maxEdge = AI_IMAGE_EDGE): Promise<{ image: string; mediaType: 'image/jpeg' }> {
  const decoded = await decode(source);
  try {
    const scale = Math.min(1, maxEdge / Math.max(decoded.width, decoded.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(decoded.element, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('Could not prepare the image.');
    return { image: await toBase64(blob), mediaType: 'image/jpeg' };
  } finally {
    decoded.release();
  }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error('Could not read the image.'));
    reader.readAsDataURL(blob);
  });
}

export interface SuggestRequestContext {
  subject: string | null;
  takenAt: string | null;
  locationId: string | null;
  categoryIds: string[];
  camera: string | null;
  lens: string | null;
  focalLengthMm: number | null;
  keywords: string[];
}

export async function requestSuggestions(source: Blob, context: SuggestRequestContext): Promise<SuggestResult> {
  const { image, mediaType } = await makeAiImage(source);
  return api<SuggestResult>('POST', '/api/admin/ai/suggest', { image, mediaType, ...context });
}

/** Tell the server which unlabeled set won a blind comparison. Losing a vote is harmless, so failures are ignored. */
export function recordVote(winner: string, loser: string): void {
  api('POST', '/api/admin/ai/votes', { winner, loser }).catch(() => undefined);
}
