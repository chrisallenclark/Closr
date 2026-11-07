import type { ItemPrep } from './types';

export type PrepTone = 'idle' | 'working' | 'action' | 'done' | 'problem';

/** One line of status for an item's mannequin layer, as the app shows it. */
export function prepStatus(prep: ItemPrep | undefined): { label: string; detail: string; tone: PrepTone } {
  switch (prep?.stage) {
    case undefined:
      return { label: 'Not on the mannequin yet', detail: 'Prepare it once to wear it in Build Outfit.', tone: 'idle' };
    case 'upload':
    case 'analyze':
      return { label: 'Reading your photo', detail: 'Checking the category and fit.', tone: 'working' };
    case 'confirm':
      return { label: 'Confirm the fit', detail: 'A quick check before preparing.', tone: 'action' };
    case 'request':
    case 'waiting':
      return { label: 'Waiting', detail: 'Queued for preparation.', tone: 'working' };
    case 'preparing':
      return { label: 'Preparing', detail: 'Fitting it to the mannequin. This takes a minute or two.', tone: 'working' };
    case 'ready_for_review':
      return { label: 'Ready for review', detail: 'Check it looks like your garment.', tone: 'action' };
    case 'approved':
      return { label: 'On your mannequin', detail: 'Ready in Build Outfit.', tone: 'done' };
    case 'rejected':
      return { label: 'Correction requested', detail: 'Preparing a new version.', tone: 'working' };
    case 'failed':
    case 'error':
      return {
        label: prep.needsPhoto ? 'Needs another photo' : 'Failed',
        detail: prep.message ?? 'This garment could not be prepared.',
        tone: 'problem',
      };
  }
}
