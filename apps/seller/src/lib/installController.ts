import { browserInstallEnv, createInstallController } from './install';

/** The app's one install controller. main.tsx starts it at load, so the browser's one-off install event is never missed. */
export const installController = createInstallController(browserInstallEnv());
