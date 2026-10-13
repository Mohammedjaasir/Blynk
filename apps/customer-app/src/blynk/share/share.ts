import { Platform, Share } from 'react-native';

/*
 * The share sheet (Flutter share_plus). On the web the browser's own sheet (navigator.share)
 * when it has one; otherwise the text goes to the clipboard and the caller says "copied".
 */

type Nav = { share?: (d: { text?: string; title?: string }) => Promise<void>; clipboard?: { writeText: (t: string) => Promise<void> } };
const nav = (): Nav | null => (globalThis as { navigator?: Nav }).navigator ?? null;

/** Copies text. True when it was copied. */
export async function copyText(text: string): Promise<boolean> {
  try {
    const c = nav()?.clipboard;
    if (!c) return false;
    await c.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Opens the share sheet. 'shared' (or dismissed), 'copied' when only the clipboard was there, 'failed'. */
export async function shareText(message: string, title?: string): Promise<'shared' | 'copied' | 'failed'> {
  if (Platform.OS === 'web') {
    const n = nav();
    if (n?.share) {
      try {
        await n.share({ text: message, title });
        return 'shared';
      } catch (e) {
        // the customer closed the sheet: nothing to say
        if ((e as { name?: string })?.name === 'AbortError') return 'shared';
      }
    }
    return (await copyText(message)) ? 'copied' : 'failed';
  }
  try {
    await Share.share({ message, title });
    return 'shared';
  } catch {
    return 'failed';
  }
}
