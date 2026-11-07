import { useEffect } from 'react';
import { AppState } from 'react-native';

import { avatarBackendConfigured } from '@/services/avatarApi';

import { useWardrobe } from '../wardrobe/store';
import { canPrepare, isActive, useAvatar } from './store';

const POLL_MS = 3000;

/**
 * Keeps garment preparation moving in the background: resumes unfinished steps on launch and when
 * the app returns to the foreground, polls while the server is working, and restarts an item's
 * preparation when its photo or category changes. Mounted once, in the root layout.
 */
export function useAvatarSync(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !avatarBackendConfigured()) return;
    // Refresh the manifest once per launch (new signed URLs); cached images draw meanwhile.
    useAvatar.setState({ assetsStale: true });
    void useAvatar.getState().pump();

    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void useAvatar.getState().pump();
    });
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      if (Object.values(useAvatar.getState().byItem).some(isActive)) void useAvatar.getState().pump();
    }, POLL_MS);

    // A replaced photo (or a changed category) makes the prepared layer stale: prepare again.
    const unsub = useWardrobe.subscribe((state, prev) => {
      if (state.items === prev.items) return;
      const preps = useAvatar.getState().byItem;
      for (const item of state.items) {
        const prep = preps[item.id];
        if (!prep) continue;
        if (prep.photoPath !== item.photo.localPath || prep.category !== item.category) {
          if (canPrepare(item.category)) useAvatar.getState().start(item);
          else useAvatar.getState().forget(item.id);
        }
      }
    });

    return () => {
      sub.remove();
      clearInterval(timer);
      unsub();
    };
  }, [enabled]);
}
