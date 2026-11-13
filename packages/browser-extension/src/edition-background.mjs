// Viewer edition of edition-background.mjs: no Creator tools, so no builder bridge and no side panel.
export function registerCreatorBuilderBridge() {}
export function registerCreatorPanelGate() { return { refresh: async () => {} }; }
