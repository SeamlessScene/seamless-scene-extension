function boundedDimension(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 16_384 ? value : null;
}

export function assessLocalQualityContinuity(assets, nativeProfile, { minimumLinearRatio = 0.8 } = {}) {
  if (!Array.isArray(assets) || assets.length === 0) throw new TypeError("At least one local asset is required");
  if (!Number.isFinite(minimumLinearRatio) || minimumLinearRatio <= 0 || minimumLinearRatio > 1) {
    throw new TypeError("minimumLinearRatio must be greater than 0 and at most 1");
  }
  const nativeWidth = boundedDimension(nativeProfile?.width);
  const nativeHeight = boundedDimension(nativeProfile?.height);
  if (nativeWidth === null || nativeHeight === null) {
    return Object.freeze({
      status: "unknown",
      native: null,
      warnings: Object.freeze([]),
      unassessed: Object.freeze(["native-resolution", "bitrate", "frame-rate"])
    });
  }

  const warnings = [];
  for (const asset of assets) {
    const width = boundedDimension(asset?.width);
    const height = boundedDimension(asset?.height);
    if (width === null || height === null) {
      warnings.push(Object.freeze({ assetId: asset?.assetId ?? null, code: "local-resolution-unavailable" }));
      continue;
    }
    const linearRatio = Math.min(width / nativeWidth, height / nativeHeight);
    if (linearRatio < minimumLinearRatio) {
      warnings.push(Object.freeze({
        assetId: asset?.assetId ?? null,
        code: "materially-lower-resolution",
        localWidth: width,
        localHeight: height,
        nativeWidth,
        nativeHeight,
        linearRatio: Math.round(linearRatio * 1000) / 1000
      }));
    }
    const localAspect = width / height;
    const nativeAspect = nativeWidth / nativeHeight;
    if (Math.abs(localAspect / nativeAspect - 1) > 0.02) {
      warnings.push(Object.freeze({
        assetId: asset?.assetId ?? null,
        code: "aspect-ratio-mismatch",
        localWidth: width,
        localHeight: height,
        nativeWidth,
        nativeHeight
      }));
    }
  }
  return Object.freeze({
    status: warnings.length ? "warning" : "compatible-resolution",
    native: Object.freeze({ width: nativeWidth, height: nativeHeight }),
    warnings: Object.freeze(warnings),
    unassessed: Object.freeze(["bitrate", "frame-rate"])
  });
}
