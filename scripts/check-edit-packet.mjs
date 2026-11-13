import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fixtureTrustedManifestKeys } from "../packages/browser-extension/src/fixture-signed-manifest.mjs";
import { validateLocalUserEditPacket, verifyLocalEditPacket } from "../packages/browser-extension/src/local-edit-packet.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultPacket = path.join(projectRoot, "packages", "browser-extension", "media", "edit-packet.json");
const packetPath = path.resolve(process.argv[2] ?? defaultPacket);
const packetRoot = path.dirname(packetPath);
const failures = [];

let packet;
try {
  packet = JSON.parse(await readFile(packetPath, "utf8"));
} catch (error) {
  console.error(`Unable to read edit packet: ${error.message}`);
  process.exit(1);
}

const isLocalUserEdit = packet.purpose === "local-user-edit";
const verification = isLocalUserEdit
  ? { ...validateLocalUserEditPacket(packet), code: "invalid-local-user-edit" }
  : await verifyLocalEditPacket(packet, fixtureTrustedManifestKeys);
if (!verification.ok) {
  failures.push(`Packet/manifest verification failed: ${verification.code}`);
  for (const error of verification.errors ?? []) failures.push(`${error.path}: ${error.code}`);
}

const canonicalRoot = await realpath(packetRoot);
for (const binding of packet.asset_bindings ?? []) {
  const candidate = path.resolve(packetRoot, binding.relative_path ?? "");
  const relative = path.relative(packetRoot, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    failures.push(`Asset binding escapes packet folder: ${binding.relative_path}`);
    continue;
  }
  try {
    const fileInfo = await stat(candidate);
    if (!fileInfo.isFile()) {
      failures.push(`Bound asset is not a file: ${binding.relative_path}`);
      continue;
    }
    const canonicalFile = await realpath(candidate);
    const canonicalRelative = path.relative(canonicalRoot, canonicalFile);
    if (canonicalRelative.startsWith("..") || path.isAbsolute(canonicalRelative)) {
      failures.push(`Bound asset resolves outside packet folder: ${binding.relative_path}`);
      continue;
    }
    const actualHash = createHash("sha256").update(await readFile(canonicalFile)).digest("hex");
    if (actualHash !== binding.sha256) failures.push(`SHA-256 mismatch: ${binding.relative_path}`);
  } catch (error) {
    failures.push(`Unable to read bound asset ${binding.relative_path}: ${error.message}`);
  }
}

if (failures.length > 0) {
  console.error("Local edit packet validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`${isLocalUserEdit ? "User-imported local edit packet" : "Signed local edit packet"} verified: ${packet.packet_id}; ` +
    `${packet.manifest.segments.length} segments; ${packet.asset_bindings.length} unique local asset binding(s).`);
  if (isLocalUserEdit) console.log("This unsigned packet can arm only after an explicit local folder selection and live source match; it is not catalog-deliverable.");
  console.log("Browser decode, duration, dimensions, codecs, and audio still require the extension import preflight.");
}
