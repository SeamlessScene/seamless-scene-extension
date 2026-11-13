import { catalogTrustConfig } from './catalog-trust-config.mjs';
import { startAccountPage } from './catalog-account-page.mjs';
import { pageStorage, takeLinkIntent } from './src/link-intent.mjs';

startAccountPage({ document, chrome, catalogTrustConfig, linkIntent: takeLinkIntent(pageStorage()) });
