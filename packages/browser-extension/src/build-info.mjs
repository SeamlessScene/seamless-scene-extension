// The build command replaces this module in its output, never in the checkout.
export const EXTENSION_VERSION = "0.66.2";
export const ADAPTER_VERSION = EXTENSION_VERSION;
export const BUILD_ID = null;
// "full" carries Creator tools; "viewer" is the store edition without them.
export const EDITION = "full";
export const EXECUTING_BUILD = Object.freeze({ version: EXTENSION_VERSION, adapterVersion: ADAPTER_VERSION, id: BUILD_ID, mode: "unbuilt-source" });
