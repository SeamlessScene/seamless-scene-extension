import { createConfiguredProtectedOwner } from './vendor/protected/owner.mjs';
import { protectedTrustConfig } from './protected-trust-config.mjs';
import { catalogTrustConfig } from './catalog-trust-config.mjs';
import { startPlaybackFrame } from './playback-frame-app.mjs';

startPlaybackFrame({ document, window, chrome, location, catalogTrustConfig, protectedTrustConfig, createConfiguredProtectedOwner });
