import { useSyncExternalStore } from 'react';
import { getLang, subscribeLang, type Lang } from './lang';

/** The current language, re-read when it changes (for the language picker and anything showing its name). */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, getLang);
}
