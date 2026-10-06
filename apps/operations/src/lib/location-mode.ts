import { isNativeApp } from '../api/native-client';
import { backgroundLocationPlugin } from './background-location-plugin';
import { browserGeolocationPlugin, type TrackingPlugin } from './geolocation-plugin';

/**
 * Which watcher shares the operator's location for the delivery on the road
 * (2026-10-02), behind the one `TrackingPlugin` interface DeliveryTracker
 * already uses - so the tracker, its throttle and tracker-session.ts's
 * lifecycle are unchanged:
 *
 *   - 'web'        : not the Android app (browser / dev build). The WebView-
 *                    free browser watcher, exactly as before. No prompt.
 *   - 'background' : Android app, the operator agreed on the explanation
 *                    screen and Android granted location. The native
 *                    foreground-service watcher (background-location-plugin.ts),
 *                    which keeps going with the screen locked.
 *   - 'foreground' : Android app, the operator said "Not now" on the
 *                    explanation screen (or Android refused). Foreground-only
 *                    WebView geolocation; the UI shows "Location stops when
 *                    your screen is off".
 *
 * The explanation screen is shown only when a delivery actually goes on the
 * road (tracking starts), never at launch, and only if Android has not
 * already granted location. "Not now" is remembered for this app run so the
 * operator is not asked again at every delivery; it is asked again next
 * launch.
 */
export type LocationMode = 'web' | 'background' | 'foreground';

/** Resolves true when the operator agrees to keep sharing with the screen off. */
export type BackgroundPrompter = () => Promise<boolean>;

let prompter: BackgroundPrompter | null = null;
let declinedThisRun = false;
let mode: LocationMode | null = null;
let running: TrackingPlugin | null = null;
const listeners = new Set<(m: LocationMode) => void>();

function setMode(next: LocationMode) {
  mode = next;
  for (const l of listeners) l(next);
}

function pluginFor(m: LocationMode): TrackingPlugin {
  return m === 'background' ? backgroundLocationPlugin : browserGeolocationPlugin;
}

/** The current mode; before any delivery started it is the platform's default. */
export function getLocationMode(): LocationMode {
  return mode ?? (isNativeApp() ? 'foreground' : 'web');
}

export function subscribeLocationMode(listener: (m: LocationMode) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The explanation screen (components/BackgroundLocationPrompt.tsx) registers itself here. */
export function setBackgroundPrompter(next: BackgroundPrompter | null): void {
  prompter = next;
}

export const deliveryLocationPlugin: TrackingPlugin = {
  checkPermission() {
    return pluginFor(getLocationMode()).checkPermission();
  },

  async requestPermission() {
    if (!isNativeApp()) {
      setMode('web');
      return browserGeolocationPlugin.requestPermission();
    }
    if ((await backgroundLocationPlugin.checkPermission()) === 'granted') {
      setMode('background');
      return 'granted';
    }
    if (!declinedThisRun) {
      // No explanation screen mounted (should not happen in the app) counts as "Not now".
      const agreed = prompter ? await prompter().catch(() => false) : false;
      if (agreed) {
        const result = await backgroundLocationPlugin.requestPermission();
        if (result === 'granted') {
          setMode('background');
          return 'granted';
        }
        // Android said no to location altogether: the WebView cannot do any
        // better, and asking again through it would only re-prompt.
        setMode('foreground');
        return result;
      }
      declinedThisRun = true;
    }
    setMode('foreground');
    return browserGeolocationPlugin.requestPermission();
  },

  async ensureNotifications() {
    // Only the native watcher shows a notification; the browser one has none to hide.
    const plugin = pluginFor(getLocationMode());
    return plugin.ensureNotifications ? plugin.ensureNotifications() : true;
  },

  async start(onPoint, onError) {
    const plugin = pluginFor(getLocationMode());
    await plugin.start(onPoint, onError);
    running = plugin;
  },

  async stop() {
    // Both watchers' stop() are no-ops when idle. `running` is cleared only
    // once the stop succeeded, so DeliveryTracker's retry hits the same watcher.
    await (running ?? pluginFor(getLocationMode())).stop();
    running = null;
  },
};

/** Test-only. */
export function __resetLocationModeForTests(): void {
  prompter = null;
  declinedThisRun = false;
  mode = null;
  running = null;
  listeners.clear();
}
