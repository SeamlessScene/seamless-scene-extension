(() => {
  const moduleUrl = new URL(chrome.runtime.getURL("src/main.mjs"));
  moduleUrl.searchParams.set("build", chrome.runtime.getManifest().version);

  void import(moduleUrl.href)
    .then(({ initializeSceneSubstitutionSpike }) => initializeSceneSubstitutionSpike({ replacePassivePanel: true }))
    .catch((error) => {
      console.error("Scene substitution spike failed to initialize", error);
    });
})();
