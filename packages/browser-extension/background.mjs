import { signOutProtected } from './vendor/protected/signout.mjs';
import { catalogTrustConfig } from './catalog-trust-config.mjs';
import { startBackground } from './background-services.mjs';

startBackground({ chrome, catalogTrustConfig, signOutProtected });
