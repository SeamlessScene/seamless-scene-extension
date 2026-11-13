var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// (disabled):crypto
var require_crypto = __commonJS({
  "(disabled):crypto"() {
  }
});

// packet-core/client/browser-signout-channel.mjs
import { EXECUTING_BUILD as EXECUTING_BUILD2 } from "../../src/build-info.mjs";

// extension/src/build-identity.mjs
import { EXECUTING_BUILD } from "../../src/build-info.mjs";
function sameExecutingBuild(value, expected = EXECUTING_BUILD) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === "adapterVersion,id,mode,version" && ["version", "adapterVersion", "id", "mode"].every((key2) => value[key2] === expected[key2]);
}

// packet-core/client/browser-signout-channel.mjs
function subscribePrivateSignOut(runtime, cleanup) {
  const listener = (message2, sender, respond) => {
    if (message2?.kind !== "protected-signout") return;
    if (sender?.id !== runtime.id || sender.tab || !["background.mjs", "catalog-fixture-background.mjs"].some((p2) => sender.url === runtime.getURL(p2)) || Object.keys(message2).sort().join(",") !== "build,kind" || !sameExecutingBuild(message2.build)) return;
    Promise.resolve().then(cleanup).then(
      () => respond({ ok: true, build: EXECUTING_BUILD2 }),
      () => respond({ ok: false, code: "protected-signout-incomplete", build: EXECUTING_BUILD2 })
    );
    return true;
  };
  runtime.onMessage.addListener(listener);
  return () => runtime.onMessage.removeListener(listener);
}

// packet-core/node_modules/jose/dist/webapi/lib/buffer_utils.js
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var strictDecoder = new TextDecoder("utf-8", { fatal: true });
var MAX_INT32 = 2 ** 32;
function concat(...buffers) {
  const size = buffers.reduce((acc, { length }) => acc + length, 0), buf = new Uint8Array(size);
  let i2 = 0;
  for (const buffer of buffers)
    buf.set(buffer, i2), i2 += buffer.length;
  return buf;
}
function writeUInt32BE(buf, value, offset) {
  if (value < 0 || value >= MAX_INT32)
    throw new RangeError(`value must be >= 0 and <= ${MAX_INT32 - 1}. Received ${value}`);
  buf.set([value >>> 24, value >>> 16, value >>> 8, value & 255], offset);
}
function uint64be(value) {
  const high = Math.floor(value / MAX_INT32), low = value % MAX_INT32, buf = new Uint8Array(8);
  return writeUInt32BE(buf, high, 0), writeUInt32BE(buf, low, 4), buf;
}
function uint32be(value) {
  const buf = new Uint8Array(4);
  return writeUInt32BE(buf, value), buf;
}
var NON_ASCII = /[^\x00-\x7f]/;
function encode(string) {
  if (typeof string == "string" && string.length >= 128) {
    if (NON_ASCII.test(string))
      throw new TypeError("non-ASCII string encountered in encode()");
    return encoder.encode(string);
  }
  const bytes2 = new Uint8Array(string.length);
  for (let i2 = 0; i2 < string.length; i2++) {
    const code = string.charCodeAt(i2);
    if (code > 127)
      throw new TypeError("non-ASCII string encountered in encode()");
    bytes2[i2] = code;
  }
  return bytes2;
}
function encodeBase64(input, url = false) {
  if (Uint8Array.prototype.toBase64)
    return input.toBase64({ alphabet: url ? "base64url" : "base64", omitPadding: url });
  const CHUNK_SIZE = 32768, arr = [];
  for (let i2 = 0; i2 < input.length; i2 += CHUNK_SIZE)
    arr.push(String.fromCharCode.apply(null, input.subarray(i2, i2 + CHUNK_SIZE)));
  const encoded2 = btoa(arr.join(""));
  return url ? encoded2.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_") : encoded2;
}
function decodeBase64(encoded2, url = false) {
  if (Uint8Array.fromBase64)
    return Uint8Array.fromBase64(encoded2, { alphabet: url ? "base64url" : "base64" });
  if (url) {
    if (encoded2.includes("+") || encoded2.includes("/"))
      throw new TypeError("Invalid base64url");
    encoded2 = encoded2.replace(/-/g, "+").replace(/_/g, "/");
  }
  const binary = atob(encoded2), bytes2 = new Uint8Array(binary.length);
  for (let i2 = 0; i2 < binary.length; i2++)
    bytes2[i2] = binary.charCodeAt(i2);
  return bytes2;
}
async function digest(algorithm, data) {
  const subtleDigest = `SHA-${algorithm.slice(-3)}`;
  return new Uint8Array(await crypto.subtle.digest(subtleDigest, data));
}

// packet-core/node_modules/jose/dist/webapi/util/errors.js
var JOSEError = class extends Error {
  static code = "ERR_JOSE_GENERIC";
  code = "ERR_JOSE_GENERIC";
  constructor(message2, options) {
    super(message2, options), this.name = this.constructor.name, Error.captureStackTrace?.(this, this.constructor);
  }
};
var JWTClaimValidationFailed = class extends JOSEError {
  static code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } }), this.claim = claim, this.reason = reason, this.payload = payload;
  }
};
var JWTExpired = class extends JOSEError {
  static code = "ERR_JWT_EXPIRED";
  code = "ERR_JWT_EXPIRED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } }), this.claim = claim, this.reason = reason, this.payload = payload;
  }
};
var JOSEAlgNotAllowed = class extends JOSEError {
  static code = "ERR_JOSE_ALG_NOT_ALLOWED";
  code = "ERR_JOSE_ALG_NOT_ALLOWED";
};
var JOSENotSupported = class extends JOSEError {
  static code = "ERR_JOSE_NOT_SUPPORTED";
  code = "ERR_JOSE_NOT_SUPPORTED";
};
var JWEDecryptionFailed = class extends JOSEError {
  static code = "ERR_JWE_DECRYPTION_FAILED";
  code = "ERR_JWE_DECRYPTION_FAILED";
  constructor(message2 = "decryption operation failed", options) {
    super(message2, options);
  }
};
var JWEInvalid = class extends JOSEError {
  static code = "ERR_JWE_INVALID";
  code = "ERR_JWE_INVALID";
};
var JWSInvalid = class extends JOSEError {
  static code = "ERR_JWS_INVALID";
  code = "ERR_JWS_INVALID";
};
var JWTInvalid = class extends JOSEError {
  static code = "ERR_JWT_INVALID";
  code = "ERR_JWT_INVALID";
};
var JWKInvalid = class extends JOSEError {
  static code = "ERR_JWK_INVALID";
  code = "ERR_JWK_INVALID";
};
var JWSSignatureVerificationFailed = class extends JOSEError {
  static code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  constructor(message2 = "signature verification failed", options) {
    super(message2, options);
  }
};

// packet-core/node_modules/jose/dist/webapi/util/base64url.js
var base64url_exports = {};
__export(base64url_exports, {
  decode: () => decode,
  encode: () => encode2
});
var invalid = "The input to be decoded is not correctly encoded.";
function decode(input) {
  try {
    return decodeBase64(typeof input == "string" ? input : decoder.decode(input), true);
  } catch (cause) {
    throw new TypeError(invalid, { cause });
  }
}
function encode2(input) {
  return encodeBase64(typeof input == "string" ? encoder.encode(input) : input, true);
}

// packet-core/node_modules/jose/dist/webapi/lib/validate.js
function isObject(input) {
  if (typeof input != "object" || input === null || Object.prototype.toString.call(input) !== "[object Object]")
    return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}
function isDisjoint(...headers) {
  const parameters = /* @__PURE__ */ new Set();
  for (const header of headers)
    if (header)
      for (const parameter of Object.keys(header)) {
        if (parameters.has(parameter))
          return false;
        parameters.add(parameter);
      }
  return true;
}
function decodeBase64url(value, label, ErrorClass) {
  try {
    return decode(value);
  } catch {
    throw new ErrorClass(`Failed to base64url decode the ${label}`);
  }
}
function encodeBase64url(value, label, ErrorClass) {
  try {
    return encode(value);
  } catch {
    throw new ErrorClass(`The ${label} is not a valid base64url string`);
  }
}
function parseJoseHeader(b64, ErrorClass, message2) {
  let parsed;
  try {
    parsed = JSON.parse(strictDecoder.decode(decode(b64)));
  } catch {
    throw new ErrorClass(message2);
  }
  if (!isObject(parsed))
    throw new ErrorClass(message2);
  return parsed;
}
var JWS_RECOGNIZED = { __proto__: null, b64: true };
var JWE_RECOGNIZED = { __proto__: null };
function validateAlgorithms(option, algorithms) {
  if (algorithms !== void 0 && (!Array.isArray(algorithms) || algorithms.some((s2) => typeof s2 != "string")))
    throw new TypeError(`"${option}" option must be an array of strings`);
  return algorithms === void 0 ? void 0 : new Set(algorithms);
}
function validateCrit(Err, recognizedDefault, recognizedOption, protectedHeader, joseHeader) {
  if (joseHeader.crit !== void 0 && protectedHeader?.crit === void 0)
    throw new Err('"crit" (Critical) Header Parameter MUST be integrity protected');
  if (!protectedHeader || protectedHeader.crit === void 0)
    return [];
  if (!Array.isArray(protectedHeader.crit) || protectedHeader.crit.length === 0 || protectedHeader.crit.some((input) => typeof input != "string" || input.length === 0))
    throw new Err('"crit" (Critical) Header Parameter MUST be an array of non-empty strings when present');
  const recognized = recognizedOption === void 0 ? recognizedDefault : { __proto__: null, ...recognizedOption, ...recognizedDefault };
  for (const parameter of protectedHeader.crit) {
    if (!(parameter in recognized))
      throw new JOSENotSupported(`Extension Header Parameter "${parameter}" is not recognized`);
    if (!Object.hasOwn(joseHeader, parameter) || joseHeader[parameter] === void 0)
      throw new Err(`Extension Header Parameter "${parameter}" is missing`);
    if (recognized[parameter] && (!Object.hasOwn(protectedHeader, parameter) || protectedHeader[parameter] === void 0))
      throw new Err(`Extension Header Parameter "${parameter}" MUST be integrity protected`);
  }
  return protectedHeader.crit;
}
function validateB64(protectedHeader, extensions) {
  if (extensions.includes("b64")) {
    const b64 = protectedHeader.b64;
    if (typeof b64 != "boolean")
      throw new JWSInvalid('The "b64" (base64url-encode payload) Header Parameter must be a boolean');
    return b64;
  }
  return true;
}

// packet-core/node_modules/jose/dist/webapi/lib/key.js
var tag = (key2) => key2[Symbol.toStringTag];
var jwkMatchesOp = (entry, key2, usage) => {
  const { alg } = entry;
  if (key2.use !== void 0) {
    const expected = usage === "sign" || usage === "verify" ? "sig" : "enc";
    if (key2.use !== expected)
      throw new TypeError(`Invalid key for this operation, its "use" must be "${expected}" when present`);
  }
  if (key2.alg !== void 0 && key2.alg !== alg)
    throw new TypeError(`Invalid key for this operation, its "alg" must be "${alg}" when present`);
  if (Array.isArray(key2.key_ops)) {
    const expectedKeyOp = usage === "encrypt" || usage === "decrypt" ? entry.ops?.[usage === "encrypt" ? 0 : 1] : usage;
    if (expectedKeyOp && !key2.key_ops.includes(expectedKeyOp))
      throw new TypeError(`Invalid key for this operation, its "key_ops" must include "${expectedKeyOp}" when present`);
  }
};
async function prepareKey(entry, key2, usage) {
  const { alg, secret } = entry, privateKey = usage === "decrypt" || usage === "sign";
  if (secret && key2 instanceof Uint8Array)
    return key2;
  let normalized, keyObject;
  if (isObject(key2)) {
    if (normalized = normalizeJwk(key2), typeof normalized.kty != "string")
      throw invalidKeyType(alg, key2, secret);
    if (!(secret ? normalized.kty === "oct" && typeof normalized.k == "string" : normalized.kty !== "oct" && (privateKey ? normalized.kty === "AKP" && typeof normalized.priv == "string" || typeof normalized.d == "string" : normalized.d === void 0 && normalized.priv === void 0)))
      throw new TypeError(secret ? 'JSON Web Key for symmetric algorithms must have JWK "kty" (Key Type) equal to "oct" and the JWK "k" (Key Value) present' : `JSON Web Key for this operation must be a ${privateKey ? "private" : "public"} JWK`);
    if (jwkMatchesOp(entry, normalized, usage), normalized.kty === "oct")
      return decode(normalized.k);
    if (!Object.isFrozen(key2)) {
      const { key_ops } = key2;
      Array.isArray(key_ops) && Object.freeze(key_ops), Object.freeze(key2);
    }
  } else {
    if (!isKeyLike(key2))
      throw invalidKeyType(alg, key2, secret);
    const expectedType = secret ? "secret" : privateKey ? "private" : "public";
    if (key2.type !== expectedType && (secret || ["secret", "public", "private"].includes(key2.type)))
      throw new TypeError(`${tag(key2)} instances must be of type "${expectedType}" for the ${alg} algorithm`);
    if (isCryptoKey(key2))
      return key2;
    if (keyObject = key2, keyObject.type === "secret")
      return keyObject.export();
  }
  cache ||= /* @__PURE__ */ new WeakMap();
  const cacheKey = key2;
  let cached = cache.get(cacheKey);
  if (cached?.[alg])
    return cached[alg];
  if (cached || cache.set(cacheKey, cached = {}), keyObject && typeof keyObject.toCryptoKey == "function") {
    const isPublic = keyObject.type === "public", crv = nist[keyObject.asymmetricKeyDetails?.namedCurve], params = entry.resolve?.({ crv, asymmetricKeyType: keyObject.asymmetricKeyType }) ?? entry.subtle;
    return cached[alg] = keyObject.toCryptoKey(params, isPublic, entry.usages[isPublic ? 0 : 1]);
  }
  return normalized ??= keyObject.export({ format: "jwk" }), normalized.alg = alg, cached[alg] = await jwkToKey(entry, normalized);
}
var cache;
var nist = {
  __proto__: null,
  prime256v1: "P-256",
  secp384r1: "P-384",
  secp521r1: "P-521"
};
function assertCryptoKey(key2) {
  if (!isCryptoKey(key2))
    throw new Error("CryptoKey instance expected");
}
var isCryptoKey = (key2) => {
  if (key2?.[Symbol.toStringTag] === "CryptoKey")
    return true;
  try {
    return key2 instanceof CryptoKey;
  } catch {
    return false;
  }
};
var isKeyObject = (key2) => key2?.[Symbol.toStringTag] === "KeyObject";
var isKeyLike = (key2) => isCryptoKey(key2) || isKeyObject(key2);
function message(msg, actual, ...types) {
  if (types.length > 2) {
    const last = types.pop();
    msg += `one of type ${types.join(", ")}, or ${last}.`;
  } else types.length === 2 ? msg += `one of type ${types[0]} or ${types[1]}.` : msg += `of type ${types[0]}.`;
  return actual == null ? msg += ` Received ${actual}` : typeof actual == "function" && actual.name ? msg += ` Received function ${actual.name}` : typeof actual == "object" && actual != null && actual.constructor?.name && (msg += ` Received an instance of ${actual.constructor.name}`), msg;
}
var invalidKeyInput = (actual, ...types) => message("Key must be ", actual, ...types);
function invalidKeyType(alg, actual, secret) {
  const types = ["CryptoKey", "KeyObject", "JSON Web Key"];
  return secret && types.push("Uint8Array"), new TypeError(message(`Key for the ${alg} algorithm must be `, actual, ...types));
}
var unusable = (name, prop = "algorithm.name") => new TypeError(`CryptoKey does not support this operation, its ${prop} must be ${name}`);
function checkUsage(key2, usage) {
  if (usage && !key2.usages.includes(usage))
    throw new TypeError(`CryptoKey does not support this operation, its usages must include ${usage}.`);
}
function checkModulusLength(alg, key2) {
  const { modulusLength } = key2.algorithm;
  if (typeof modulusLength != "number" || modulusLength < 2048)
    throw new TypeError(`${alg} requires key modulusLength to be 2048 bits or larger`);
}
function checkCryptoKey(key2, expected, usage) {
  const algorithm = key2.algorithm;
  if (algorithm.name !== expected.name)
    throw unusable(expected.name);
  if (expected.hash && algorithm.hash?.name !== expected.hash)
    throw unusable(expected.hash, "algorithm.hash");
  if (expected.namedCurve && algorithm.namedCurve !== expected.namedCurve)
    throw unusable(expected.namedCurve, "algorithm.namedCurve");
  if (expected.length !== void 0 && algorithm.length !== expected.length)
    throw unusable(expected.length, "algorithm.length");
  checkUsage(key2, usage);
}
function snapshotJwk(jwk) {
  return { __proto__: null, ...jwk };
}
function normalizeJwk(jwk) {
  const normalized = snapshotJwk(jwk);
  if (normalized.ext !== void 0 && typeof normalized.ext != "boolean")
    throw new TypeError('"ext" (Extractable) Parameter must be a boolean');
  if (normalized.key_ops !== void 0) {
    const value = normalized.key_ops, keyOps = Array.isArray(value) ? [...value] : void 0;
    if (!keyOps || keyOps.some((operation) => typeof operation != "string") || new Set(keyOps).size !== keyOps.length)
      throw new TypeError('"key_ops" (Key Operations) Parameter must be an array of unique strings');
    normalized.key_ops = keyOps;
  }
  return normalized;
}
function validateExtractableOption(extractable) {
  if (extractable !== void 0 && typeof extractable != "boolean")
    throw new TypeError('"extractable" option must be a boolean');
  return extractable;
}
async function jwkToKey(entry, jwk, extractable) {
  if (!entry.kty.includes(jwk.kty))
    throw new JOSENotSupported('Invalid or unsupported JWK "alg" (Algorithm) Parameter value');
  const algorithm = entry.resolve?.({ kty: jwk.kty, crv: jwk.crv }) ?? entry.subtle, isPrivate = !!(jwk.d || jwk.priv), keyData = { ...jwk, ext: extractable ?? jwk.ext };
  return keyData.kty !== "AKP" && delete keyData.alg, delete keyData.use, crypto.subtle.importKey("jwk", keyData, algorithm, keyData.ext ?? !isPrivate, jwk.key_ops ?? entry.usages[isPrivate ? 1 : 0]);
}
async function rawKey(key2, expected, usage, extractable = false) {
  return key2 instanceof Uint8Array && (key2 = await crypto.subtle.importKey("raw", key2, expected, extractable, [usage])), checkCryptoKey(key2, expected, usage), key2;
}

// packet-core/node_modules/jose/dist/webapi/lib/content_encryption.js
var generateCek = (enc) => crypto.getRandomValues(new Uint8Array(enc.cekBits >> 3));
function checkCekLength(cek, expected) {
  const actual = cek.byteLength << 3;
  if (actual !== expected)
    throw new JWEInvalid(`Invalid Content Encryption Key length. Expected ${expected} bits, got ${actual} bits`);
}
function checkIvLength(enc, iv) {
  if (iv.length << 3 !== enc.ivBits)
    throw new JWEInvalid("Invalid Initialization Vector length");
}
async function cbcKeySetup(enc, cek, usage) {
  if (!(cek instanceof Uint8Array))
    throw new TypeError(invalidKeyInput(cek, "Uint8Array"));
  const keySize = enc.cekBits >> 1, encKey = await crypto.subtle.importKey("raw", cek.subarray(keySize >> 3), "AES-CBC", false, [usage]), macKey = await crypto.subtle.importKey("raw", cek.subarray(0, keySize >> 3), {
    hash: `SHA-${keySize << 1}`,
    name: "HMAC"
  }, false, ["sign"]);
  return [encKey, macKey, keySize];
}
async function cbcHmacTag(macKey, macData, keySize) {
  return new Uint8Array((await crypto.subtle.sign("HMAC", macKey, macData)).slice(0, keySize >> 3));
}
async function timingSafeEqual(a2, b2) {
  const algorithm = { name: "HMAC", hash: "SHA-256" }, key2 = await crypto.subtle.generateKey(algorithm, false, ["sign", "verify"]), aHmac = await crypto.subtle.sign(algorithm, key2, a2);
  return crypto.subtle.verify(algorithm, key2, aHmac, b2);
}
async function cbcDecrypt(enc, cek, ciphertext, iv, tag2, aad) {
  const [encKey, macKey, keySize] = await cbcKeySetup(enc, cek, "decrypt"), macData = concat(aad, iv, ciphertext, uint64be(aad.length * 8)), expectedTag = await cbcHmacTag(macKey, macData, keySize);
  try {
    if (await timingSafeEqual(tag2, expectedTag))
      return new Uint8Array(await crypto.subtle.decrypt({ iv, name: "AES-CBC" }, encKey, ciphertext));
  } catch {
  }
  throw new JWEDecryptionFailed();
}
async function decrypt(enc, cek, ciphertext, iv, tag2, aad) {
  if (!isCryptoKey(cek) && !(cek instanceof Uint8Array))
    throw new TypeError(invalidKeyInput(cek, "CryptoKey", "KeyObject", "Uint8Array", "JSON Web Key"));
  if (!iv)
    throw new JWEInvalid("JWE Initialization Vector missing");
  if (!tag2)
    throw new JWEInvalid("JWE Authentication Tag missing");
  if (!enc.cbc && tag2.length !== 16)
    throw new JWEInvalid("Invalid Authentication Tag length");
  if (checkIvLength(enc, iv), cek instanceof Uint8Array && checkCekLength(cek, enc.cekBits), enc.cbc)
    return cbcDecrypt(enc, cek, ciphertext, iv, tag2, aad);
  const encKey = await rawKey(cek, enc.subtle, "decrypt");
  try {
    return new Uint8Array(await crypto.subtle.decrypt({
      additionalData: aad,
      iv,
      name: "AES-GCM",
      tagLength: 128
    }, encKey, concat(ciphertext, tag2)));
  } catch {
    throw new JWEDecryptionFailed();
  }
}

// packet-core/node_modules/jose/dist/webapi/lib/key_descriptor.js
function table(entries) {
  const out = { __proto__: null };
  for (const alg in entries)
    out[alg] = { ...entries[alg], alg };
  return out;
}

// packet-core/node_modules/jose/dist/webapi/lib/jwe_algorithms.js
var wrap = [
  ["encrypt", "wrapKey"],
  ["decrypt", "unwrapKey"]
];
var derive = [[], ["deriveBits"]];
var none = [[], []];
function rsaes(bits) {
  return {
    kty: ["RSA"],
    mode: "key-encryption",
    subtle: { name: "RSA-OAEP", hash: `SHA-${bits}` },
    usages: wrap,
    ops: ["wrapKey", "unwrapKey"]
  };
}
function ecdh(mode) {
  return {
    kty: ["EC", "OKP"],
    mode,
    subtle: { name: "ECDH" },
    resolve: ({ kty, crv, asymmetricKeyType }) => {
      if (crv === "X25519" || asymmetricKeyType === "x25519")
        return { name: "X25519" };
      if (kty === "OKP")
        throw new JOSENotSupported('Invalid or unsupported JWK "alg" (Algorithm) Parameter value');
      return { name: "ECDH", namedCurve: crv };
    },
    usages: derive,
    ops: [void 0, "deriveBits"]
  };
}
function aeskw(bits, gcm = false) {
  return {
    kty: ["oct"],
    mode: "key-wrapping",
    secret: true,
    subtle: { name: gcm ? "AES-GCM" : "AES-KW", length: bits },
    usages: none,
    ops: gcm ? ["encrypt", "decrypt"] : ["wrapKey", "unwrapKey"]
  };
}
function pbes2() {
  return {
    kty: ["oct"],
    mode: "key-wrapping",
    secret: true,
    subtle: { name: "PBKDF2" },
    usages: none,
    ops: ["deriveBits", "deriveBits"]
  };
}
var JWE = table({
  dir: {
    kty: ["oct"],
    mode: "direct-encryption",
    secret: true,
    subtle: { name: "AES-GCM" },
    usages: none,
    ops: ["encrypt", "decrypt"]
  },
  "RSA-OAEP": rsaes(1),
  "RSA-OAEP-256": rsaes(256),
  "RSA-OAEP-384": rsaes(384),
  "RSA-OAEP-512": rsaes(512),
  "ECDH-ES": ecdh("direct-key-agreement"),
  "ECDH-ES+A128KW": ecdh("key-agreement-with-key-wrapping"),
  "ECDH-ES+A192KW": ecdh("key-agreement-with-key-wrapping"),
  "ECDH-ES+A256KW": ecdh("key-agreement-with-key-wrapping"),
  A128KW: aeskw(128),
  A192KW: aeskw(192),
  A256KW: aeskw(256),
  A128GCMKW: aeskw(128, true),
  A192GCMKW: aeskw(192, true),
  A256GCMKW: aeskw(256, true),
  "PBES2-HS256+A128KW": pbes2(),
  "PBES2-HS384+A192KW": pbes2(),
  "PBES2-HS512+A256KW": pbes2()
});
var contentOps = ["encrypt", "decrypt"];
function contentEncryption(bits, cbc = false) {
  return {
    kty: ["oct"],
    secret: true,
    subtle: { name: cbc ? "AES-CBC" : "AES-GCM", length: bits },
    usages: none,
    ops: contentOps,
    cekBits: bits,
    ivBits: cbc ? 128 : 96,
    cbc
  };
}
var ENC = table({
  A128GCM: contentEncryption(128),
  A192GCM: contentEncryption(192),
  A256GCM: contentEncryption(256),
  "A128CBC-HS256": contentEncryption(256, true),
  "A192CBC-HS384": contentEncryption(384, true),
  "A256CBC-HS512": contentEncryption(512, true)
});
function unsupported(parameter, name) {
  throw new JOSENotSupported(`Invalid or unsupported "${parameter}" (JWE ${name}) header value`);
}
function jweAlgorithm(alg) {
  return (typeof alg == "string" ? JWE[alg] : void 0) ?? unsupported("alg", "Algorithm");
}
function isJWECEKTransport(algorithm) {
  return algorithm.mode === "key-wrapping" || algorithm.mode === "key-encryption" || algorithm.mode === "key-agreement-with-key-wrapping";
}
function jweEncryption(enc) {
  return (typeof enc == "string" ? ENC[enc] : void 0) ?? unsupported("enc", "Encryption Algorithm");
}

// packet-core/node_modules/jose/dist/webapi/lib/key_management.js
function checkEcdhCryptoKey(key2, usage) {
  if (key2.algorithm.name !== "ECDH" && key2.algorithm.name !== "X25519")
    throw new TypeError("CryptoKey does not support this operation, its algorithm.name must be ECDH or X25519");
  checkUsage(key2, usage);
}
async function aeskwUnwrap(alg, key2, encryptedKey) {
  const cryptoKey = await rawKey(key2, jweAlgorithm(alg).subtle, "unwrapKey", true), cryptoKeyCek = await crypto.subtle.unwrapKey("raw", encryptedKey, cryptoKey, "AES-KW", { hash: "SHA-256", name: "HMAC" }, true, ["sign"]);
  return new Uint8Array(await crypto.subtle.exportKey("raw", cryptoKeyCek));
}
function checkRsaKey(alg, key2, usage) {
  checkCryptoKey(key2, jweAlgorithm(alg).subtle, usage), checkModulusLength(alg, key2);
}
async function deriveKey(p2s, alg, p2c, key2) {
  if (!(p2s instanceof Uint8Array) || p2s.length < 8)
    throw new JWEInvalid("PBES2 Salt Input must be 8 or more octets");
  if (!Number.isSafeInteger(p2c) || Math.sign(p2c) !== 1)
    throw new JWEInvalid("PBES2 Count Input must be a positive integer");
  const salt = concat(encode(alg), Uint8Array.of(0), p2s), keylen = parseInt(alg.slice(13, 16), 10), subtleAlg = {
    hash: `SHA-${alg.slice(8, 11)}`,
    iterations: p2c,
    name: "PBKDF2",
    salt
  }, cryptoKey = await rawKey(key2, jweAlgorithm(alg).subtle, "deriveBits");
  return new Uint8Array(await crypto.subtle.deriveBits(subtleAlg, cryptoKey, keylen));
}
function lengthAndInput(input) {
  return concat(uint32be(input.length), input);
}
async function concatKdf(Z2, L2, OtherInfo) {
  const dkLen = L2 >> 3, hashLen = 32, reps = Math.ceil(dkLen / hashLen), dk = new Uint8Array(reps * hashLen);
  for (let i2 = 1; i2 <= reps; i2++) {
    const hashResult = await digest("sha256", concat(uint32be(i2), Z2, OtherInfo));
    dk.set(hashResult, (i2 - 1) * hashLen);
  }
  return dk.slice(0, dkLen);
}
async function ecdhesDeriveKey(publicKey, privateKey, algorithm, keyLength, apu = new Uint8Array(), apv = new Uint8Array()) {
  checkEcdhCryptoKey(publicKey), checkEcdhCryptoKey(privateKey, "deriveBits");
  const otherInfo = concat(lengthAndInput(encode(algorithm)), lengthAndInput(apu), lengthAndInput(apv), uint32be(keyLength)), Z2 = new Uint8Array(await crypto.subtle.deriveBits({
    name: publicKey.algorithm.name,
    public: publicKey
  }, privateKey, publicKey.algorithm.name === "X25519" ? 256 : Math.ceil(parseInt(publicKey.algorithm.namedCurve.slice(-3), 10) / 8) << 3));
  return concatKdf(Z2, keyLength, otherInfo);
}
function assertEcdhKey(key2) {
  assertCryptoKey(key2);
  const curve = key2.algorithm.namedCurve;
  if (curve !== "P-256" && curve !== "P-384" && curve !== "P-521" && key2.algorithm.name !== "X25519")
    throw new JOSENotSupported("ECDH with the provided key is not allowed or not supported by your javascript runtime");
}
function partyInfo(joseHeader, name) {
  const value = joseHeader[name];
  if (value !== void 0) {
    if (typeof value != "string")
      throw new JWEInvalid(`JOSE Header "${name}" (Agreement Party${name === "apu" ? "U" : "V"}Info) invalid`);
    return decodeBase64url(value, name, JWEInvalid);
  }
}
function checkPartyInfo(apu, apv) {
  if (!(apu === void 0 || apv === void 0 || apu.byteLength !== apv.byteLength)) {
    for (let i2 = 0; i2 < apu.byteLength; i2++)
      if (apu[i2] !== apv[i2])
        return;
    throw new JWEInvalid('JOSE Header "apu" and "apv" values must be distinct');
  }
}
function assertEncryptedKey(encryptedKey) {
  if (encryptedKey === void 0)
    throw new JWEInvalid("JWE Encrypted Key missing");
}
function assertNoEncryptedKey(encryptedKey) {
  if (encryptedKey !== void 0)
    throw new JWEInvalid("Encountered unexpected JWE Encrypted Key");
}
function validateMaxPBES2Count(value) {
  if (value !== void 0 && value !== 1 / 0 && (!Number.isSafeInteger(value) || value < 1))
    throw new TypeError("maxPBES2Count must be a positive safe integer or Infinity");
}
async function decryptKeyManagement(entry, enc, key2, encryptedKey, joseHeader, maxPBES2Count) {
  const { alg } = entry, mode = entry.mode;
  if (mode === "direct-encryption")
    return assertNoEncryptedKey(encryptedKey), key2;
  const direct = mode === "direct-key-agreement";
  switch (direct ? assertNoEncryptedKey(encryptedKey) : assertEncryptedKey(encryptedKey), entry.subtle.name) {
    case "ECDH": {
      const { epk } = joseHeader;
      if (!isObject(epk) || ["d", "k", "p", "q", "dp", "dq", "qi", "oth", "priv"].some((parameter) => Object.hasOwn(epk, parameter)))
        throw new JWEInvalid('JOSE Header "epk" (Ephemeral Public Key) missing or invalid');
      assertEcdhKey(key2);
      const ephemeralPublicKey = await jwkToKey(entry, epk), partyUInfo = partyInfo(joseHeader, "apu"), partyVInfo = partyInfo(joseHeader, "apv");
      checkPartyInfo(partyUInfo, partyVInfo);
      const sharedSecret = await ecdhesDeriveKey(ephemeralPublicKey, key2, direct ? enc.alg : alg, direct ? enc.cekBits : parseInt(alg.slice(-5, -2), 10), partyUInfo, partyVInfo);
      if (direct)
        return sharedSecret;
      key2 = sharedSecret;
      break;
    }
    case "RSA-OAEP":
      return assertCryptoKey(key2), checkRsaKey(alg, key2, "decrypt"), new Uint8Array(await crypto.subtle.decrypt("RSA-OAEP", key2, encryptedKey));
    case "PBKDF2": {
      if (typeof joseHeader.p2c != "number")
        throw new JWEInvalid('JOSE Header "p2c" (PBES2 Count) missing or invalid');
      validateMaxPBES2Count(maxPBES2Count);
      const p2cLimit = maxPBES2Count ?? 1e4;
      if (joseHeader.p2c > p2cLimit)
        throw new JWEInvalid('JOSE Header "p2c" (PBES2 Count) out is of acceptable bounds');
      if (typeof joseHeader.p2s != "string")
        throw new JWEInvalid('JOSE Header "p2s" (PBES2 Salt) missing or invalid');
      const p2s = decodeBase64url(joseHeader.p2s, "p2s", JWEInvalid);
      key2 = await deriveKey(p2s, alg, joseHeader.p2c, key2);
      break;
    }
    case "AES-GCM": {
      if (typeof joseHeader.iv != "string")
        throw new JWEInvalid('JOSE Header "iv" (Initialization Vector) missing or invalid');
      if (typeof joseHeader.tag != "string")
        throw new JWEInvalid('JOSE Header "tag" (Authentication Tag) missing or invalid');
      const iv = decodeBase64url(joseHeader.iv, "iv", JWEInvalid), tag2 = decodeBase64url(joseHeader.tag, "tag", JWEInvalid);
      if (iv.byteLength !== 12)
        throw new JWEInvalid("Invalid Initialization Vector length");
      if (tag2.byteLength !== 16)
        throw new JWEInvalid("Invalid Authentication Tag length");
      return decrypt(jweEncryption(alg.slice(0, -2)), key2, encryptedKey, iv, tag2, new Uint8Array());
    }
  }
  return aeskwUnwrap(alg.slice(-6), key2, encryptedKey);
}

// packet-core/node_modules/jose/dist/webapi/lib/deflate.js
function validateZip(joseHeader, protectedHeader) {
  if (joseHeader.zip !== void 0 && joseHeader.zip !== "DEF")
    throw new JOSENotSupported('Unsupported JWE "zip" (Compression Algorithm) Header Parameter value.');
  if (joseHeader.zip !== void 0 && !protectedHeader?.zip)
    throw new JWEInvalid('JWE "zip" (Compression Algorithm) Header Parameter MUST be in a protected header.');
}
function supported(name) {
  if (typeof globalThis[name] > "u")
    throw new JOSENotSupported(`JWE "zip" (Compression Algorithm) Header Parameter requires the ${name} API.`);
}
async function transform(stream, input, maxLength = 1 / 0) {
  const writer = stream.writable.getWriter();
  writer.write(input).catch(() => {
  }), writer.close().catch(() => {
  });
  const chunks = [];
  let length = 0;
  const reader = stream.readable.getReader();
  for (; ; ) {
    const { value, done } = await reader.read();
    if (done)
      break;
    if (chunks.push(value), length += value.byteLength, maxLength !== 1 / 0 && length > maxLength)
      throw new JWEInvalid("Decompressed plaintext exceeded the configured limit");
  }
  return concat(...chunks);
}
async function decompress(input, maxLength) {
  return supported("DecompressionStream"), transform(new DecompressionStream("deflate-raw"), input, maxLength);
}

// packet-core/node_modules/jose/dist/webapi/lib/jwe_decrypt.js
function shareJWE(jwe) {
  const { protected: encodedProtected, ciphertext, iv, tag: tag2, aad } = jwe;
  let parsedProt;
  return encodedProtected !== void 0 && (parsedProt = parseJoseHeader(encodedProtected, JWEInvalid, "JWE Protected Header is invalid")), [
    parsedProt,
    decodeBase64url(ciphertext, "ciphertext", JWEInvalid),
    iv !== void 0 ? decodeBase64url(iv, "iv", JWEInvalid) : void 0,
    tag2 !== void 0 ? decodeBase64url(tag2, "tag", JWEInvalid) : void 0,
    encodeBase64url((encodedProtected ?? "") + (aad !== void 0 ? `.${aad}` : ""), "aad", JWEInvalid)
  ];
}
function prepareDecrypt(options) {
  return [
    options && validateAlgorithms("keyManagementAlgorithms", options.keyManagementAlgorithms),
    options && validateAlgorithms("contentEncryptionAlgorithms", options.contentEncryptionAlgorithms),
    options?.crit,
    options?.maxPBES2Count,
    options?.maxDecompressedLength
  ];
}
async function decryptJWE(jwe, shared, key2, token = shareJWE(jwe)) {
  const [parsedProt, ciphertext, iv, tag2, additionalData] = token, { header, unprotected, aad } = jwe;
  let joseHeader;
  if (header !== void 0 || unprotected !== void 0) {
    if (!isDisjoint(parsedProt, header, unprotected))
      throw new JWEInvalid("JWE Protected, JWE Unprotected Header, and JWE Per-Recipient Unprotected Header Parameter names must be disjoint");
    joseHeader = { ...parsedProt, ...header, ...unprotected };
  } else
    joseHeader = parsedProt ?? {};
  const [keyManagementAlgorithms, contentEncryptionAlgorithms, crit, maxPBES2Count, maxDecompressedLength] = shared, { encrypted_key: encodedKey } = jwe;
  validateCrit(JWEInvalid, JWE_RECOGNIZED, crit, parsedProt, joseHeader), validateZip(joseHeader, parsedProt);
  const { alg, enc } = joseHeader;
  if (typeof alg != "string" || !alg)
    throw new JWEInvalid("missing JWE Algorithm (alg) in JWE Header");
  const selected = JWE[alg];
  if (encodedKey === "" && (!selected || !isJWECEKTransport(selected)))
    throw new JWEInvalid("JWE Encrypted Key incorrect type");
  const integrated = selected?.mode === "integrated-encryption";
  if (!integrated && (typeof enc != "string" || !enc))
    throw new JWEInvalid("missing JWE Encryption Algorithm (enc) in JWE Header");
  if (keyManagementAlgorithms && !keyManagementAlgorithms.has(alg) || !keyManagementAlgorithms && alg.startsWith("PBES2"))
    throw new JOSEAlgNotAllowed('"alg" (Algorithm) Header Parameter value not allowed');
  let encEntry;
  if (integrated) {
    if (enc !== void 0)
      throw new JWEInvalid('JWE "enc" (Encryption Algorithm) Header Parameter must not be present for integrated encryption');
    if (iv?.byteLength)
      throw new JWEInvalid("JWE Initialization Vector must be empty for integrated encryption");
    if (tag2?.byteLength)
      throw new JWEInvalid("JWE Authentication Tag must be empty for integrated encryption");
  } else {
    if (contentEncryptionAlgorithms && !contentEncryptionAlgorithms.has(enc))
      throw new JOSEAlgNotAllowed('"enc" (Encryption Algorithm) Header Parameter value not allowed');
    encEntry = jweEncryption(enc);
  }
  let encryptedKey;
  if (encodedKey !== void 0)
    try {
      encryptedKey = decodeBase64url(encodedKey, "encrypted_key", JWEInvalid);
    } catch (error) {
      if (!selected || !isJWECEKTransport(selected))
        throw error;
      encryptedKey = new Uint8Array();
    }
  let resolvedKey = false;
  typeof key2 == "function" && (key2 = await key2(parsedProt, jwe), resolvedKey = true);
  const algEntry = selected ?? jweAlgorithm(alg);
  isJWECEKTransport(algEntry) && encryptedKey === void 0 && (encryptedKey = new Uint8Array());
  const k2 = await prepareKey(algEntry.mode === "direct-encryption" ? encEntry : algEntry, key2, "decrypt");
  let plaintext;
  if (algEntry.mode === "integrated-encryption")
    plaintext = await algEntry.decrypt(k2, encryptedKey, ciphertext, additionalData, parsedProt, joseHeader);
  else {
    const encryption = encEntry;
    let cek;
    try {
      cek = await decryptKeyManagement(algEntry, encryption, k2, encryptedKey, joseHeader, maxPBES2Count), isJWECEKTransport(algEntry) && cek instanceof Uint8Array && cek.byteLength << 3 !== encryption.cekBits && (cek = generateCek(encryption));
    } catch (err) {
      if (err instanceof TypeError || err instanceof JWEInvalid || err instanceof JOSENotSupported)
        throw err;
      cek = generateCek(encryption);
    }
    plaintext = await decrypt(encryption, cek, ciphertext, iv, tag2, additionalData);
  }
  if (joseHeader.zip === "DEF") {
    const decompressionLimit = maxDecompressedLength ?? 25e4;
    if (decompressionLimit === 0)
      throw new JOSENotSupported('JWE "zip" (Compression Algorithm) Header Parameter is not supported.');
    if (decompressionLimit !== 1 / 0 && (!Number.isSafeInteger(decompressionLimit) || decompressionLimit < 1))
      throw new TypeError("maxDecompressedLength must be 0, a positive safe integer, or Infinity");
    plaintext = await decompress(plaintext, decompressionLimit).catch((cause) => {
      throw cause instanceof JWEInvalid ? cause : new JWEInvalid("Failed to decompress plaintext", { cause });
    });
  }
  return {
    plaintext,
    ...parsedProt && { protectedHeader: parsedProt },
    ...aad !== void 0 && {
      additionalAuthenticatedData: decodeBase64url(aad, "aad", JWEInvalid)
    },
    ...unprotected && { sharedUnprotectedHeader: unprotected },
    ...header && { unprotectedHeader: header },
    ...resolvedKey && { key: k2 }
  };
}
async function decryptCompact(jwe, shared, key2) {
  if (jwe instanceof Uint8Array && (jwe = decoder.decode(jwe)), typeof jwe != "string")
    throw new JWEInvalid("Compact JWE must be a string or Uint8Array");
  const { 0: protectedHeader, 1: encryptedKey, 2: iv, 3: ciphertext, 4: tag2, length } = jwe.split(".");
  if (length !== 5)
    throw new JWEInvalid("Invalid Compact JWE");
  return decryptJWE({
    ciphertext,
    iv: iv || void 0,
    protected: protectedHeader,
    tag: tag2 || void 0,
    encrypted_key: encryptedKey || void 0
  }, shared, key2);
}

// packet-core/node_modules/jose/dist/webapi/jwe/compact/decrypt.js
async function compactDecrypt(jwe, key2, options) {
  return decryptCompact(jwe, prepareDecrypt(options), key2);
}

// packet-core/node_modules/jose/dist/webapi/lib/jws_algorithms.js
var sig = [["verify"], ["sign"]];
function hmac(bits) {
  const subtle = { name: "HMAC", hash: `SHA-${bits}` };
  return { kty: ["oct"], secret: true, subtle, signing: subtle, usages: sig };
}
function rsa(bits, saltLength) {
  const subtle = { name: saltLength ? "RSA-PSS" : "RSASSA-PKCS1-v1_5", hash: `SHA-${bits}` };
  return {
    kty: ["RSA"],
    subtle,
    signing: saltLength ? { ...subtle, saltLength } : subtle,
    usages: sig,
    minRsaBits: 2048
  };
}
function ecdsa(crv, bits) {
  return {
    kty: ["EC"],
    crv,
    subtle: { name: "ECDSA", namedCurve: crv },
    signing: { name: "ECDSA", hash: `SHA-${bits}` },
    usages: sig
  };
}
function eddsa() {
  const subtle = { name: "Ed25519" };
  return {
    kty: ["OKP"],
    crv: "Ed25519",
    subtle,
    signing: subtle,
    usages: sig
  };
}
function mldsa(bits) {
  const subtle = { name: `ML-DSA-${bits}` };
  return {
    kty: ["AKP"],
    subtle,
    signing: subtle,
    usages: sig
  };
}
var JWS = table({
  HS256: hmac(256),
  HS384: hmac(384),
  HS512: hmac(512),
  RS256: rsa(256),
  RS384: rsa(384),
  RS512: rsa(512),
  PS256: rsa(256, 32),
  PS384: rsa(384, 48),
  PS512: rsa(512, 64),
  ES256: ecdsa("P-256", 256),
  ES384: ecdsa("P-384", 384),
  ES512: ecdsa("P-521", 512),
  EdDSA: eddsa(),
  Ed25519: eddsa(),
  "ML-DSA-44": mldsa(44),
  "ML-DSA-65": mldsa(65),
  "ML-DSA-87": mldsa(87)
});
function jwsAlgorithm(alg) {
  const entry = typeof alg == "string" ? JWS[alg] : void 0;
  if (!entry)
    throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  return entry;
}

// packet-core/node_modules/jose/dist/webapi/lib/jws_verify.js
function prepareVerify(options) {
  return [options && validateAlgorithms("algorithms", options.algorithms), options?.crit];
}
function parseProtectedHeader(encodedProtected) {
  return encodedProtected === void 0 ? {} : parseJoseHeader(encodedProtected, JWSInvalid, "JWS Protected Header is invalid");
}
function encodeCompactUnencodedPayload(payload) {
  try {
    return encode(payload);
  } catch {
    throw new JWSInvalid("JWS Compact Serialization payload must use only ASCII characters");
  }
}
async function verifySignature(jws, shared, key2, encodeUnencodedPayload, parsedProtected) {
  const { protected: encodedProtected, header, payload: inputPayload } = jws, parsedProt = parsedProtected ?? parseProtectedHeader(encodedProtected);
  if (!isDisjoint(parsedProt, header))
    throw new JWSInvalid("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
  const joseHeader = { ...parsedProt, ...header }, b64 = validateB64(parsedProt, validateCrit(JWSInvalid, JWS_RECOGNIZED, shared[1], parsedProt, joseHeader)), { alg } = joseHeader;
  if (typeof alg != "string" || !alg)
    throw new JWSInvalid('JWS "alg" (Algorithm) Header Parameter missing or invalid');
  if (shared[0] && !shared[0].has(alg))
    throw new JOSEAlgNotAllowed('"alg" (Algorithm) Header Parameter value not allowed');
  if (b64) {
    if (typeof inputPayload != "string")
      throw new JWSInvalid("JWS Payload must be a string");
  } else if (typeof inputPayload != "string" && !(inputPayload instanceof Uint8Array))
    throw new JWSInvalid("JWS Payload must be a string or an Uint8Array instance");
  const signingPayload = b64 || typeof inputPayload != "string" ? inputPayload : encodeUnencodedPayload(inputPayload);
  let resolvedKey = false;
  typeof key2 == "function" && (key2 = await key2(parsedProt, jws), resolvedKey = true);
  const entry = jwsAlgorithm(alg), data = concat(encodedProtected !== void 0 ? encode(encodedProtected) : new Uint8Array(), encode("."), typeof signingPayload == "string" ? shared[2] ??= encodeBase64url(signingPayload, "payload", JWSInvalid) : signingPayload), signature = decodeBase64url(jws.signature, "signature", JWSInvalid), k2 = await prepareKey(entry, key2, "verify"), cryptoKey = await rawKey(k2, entry.subtle, "verify");
  entry.minRsaBits && checkModulusLength(entry.alg, cryptoKey);
  let verified2 = false;
  try {
    verified2 = await crypto.subtle.verify(entry.signing, cryptoKey, signature, data);
  } catch {
  }
  if (!verified2)
    throw new JWSSignatureVerificationFailed();
  const result = { payload: typeof signingPayload == "string" ? decodeBase64url(signingPayload, "payload", JWSInvalid) : signingPayload };
  return encodedProtected !== void 0 && (result.protectedHeader = parsedProt), header !== void 0 && (result.unprotectedHeader = header), resolvedKey ? [{ ...result, key: k2 }, b64] : [result, b64];
}
async function verifyCompact(jws, shared, key2) {
  if (jws instanceof Uint8Array && (jws = decoder.decode(jws)), typeof jws != "string")
    throw new JWSInvalid("Compact JWS must be a string or Uint8Array");
  const { 0: protectedHeader, 1: payload, 2: signature, length } = jws.split(".");
  if (length !== 3)
    throw new JWSInvalid("Invalid Compact JWS");
  return verifySignature({ payload, protected: protectedHeader, signature }, shared, key2, encodeCompactUnencodedPayload);
}

// packet-core/node_modules/jose/dist/webapi/jws/compact/verify.js
async function compactVerify(jws, key2, options) {
  const [result] = await verifyCompact(jws, prepareVerify(options), key2);
  return result;
}

// packet-core/node_modules/jose/dist/webapi/lib/jwt_claims_set.js
var epoch = (date) => Math.floor(date.getTime() / 1e3);
var multipliers = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
  y: 31557600
};
var REGEX = /^(\+|\-)? ?(\d+|\d+\.\d+) ?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)(?: (ago|from now))?$/i;
var checkFailed = "check_failed";
function invalidDuration() {
  throw new TypeError("Invalid time period format");
}
function secs(str) {
  typeof str != "string" && invalidDuration();
  const matched = REGEX.exec(str);
  (!matched || matched[4] && matched[1]) && invalidDuration();
  const value = parseFloat(matched[2]), numericDate2 = Math.round(value * multipliers[matched[3][0].toLowerCase()]);
  return Number.isFinite(numericDate2) || invalidDuration(), matched[1] === "-" || matched[4] === "ago" ? -numericDate2 : numericDate2;
}
function validateInput(label, input) {
  if (!Number.isFinite(input))
    throw new TypeError(`Invalid ${label} input`);
  return input;
}
var normalizeTyp = (value) => {
  const normalized = value.toLowerCase();
  return value.includes("/") ? normalized : `application/${normalized}`;
};
var checkAudiencePresence = (audPayload, audOption) => typeof audPayload == "string" ? audOption.includes(audPayload) : Array.isArray(audPayload) ? audOption.some((aud) => audPayload.includes(aud)) : false;
function validateNumericDate(payload, claim, required = false) {
  const value = payload[claim];
  if (!(value === void 0 && !required)) {
    if (typeof value != "number")
      throw new JWTClaimValidationFailed(`"${claim}" claim must be a number`, payload, claim, "invalid");
    return value;
  }
}
function unexpectedClaim(payload, claim) {
  throw new JWTClaimValidationFailed(`unexpected "${claim}" claim value`, payload, claim, checkFailed);
}
function validateClaimsSet(protectedHeader, encodedPayload, options = {}) {
  let payload;
  try {
    payload = JSON.parse(strictDecoder.decode(encodedPayload));
  } catch {
  }
  if (!isObject(payload))
    throw new JWTInvalid("JWT Claims Set must be a top-level JSON object");
  const { typ } = options;
  if (typ !== void 0 && (typeof protectedHeader.typ != "string" || normalizeTyp(protectedHeader.typ) !== normalizeTyp(typ)))
    throw new JWTClaimValidationFailed('unexpected "typ" JWT header value', payload, "typ", checkFailed);
  const { requiredClaims = [], issuer, subject, audience, maxTokenAge } = options, presenceCheck = [...requiredClaims];
  maxTokenAge !== void 0 && presenceCheck.push("iat"), audience !== void 0 && presenceCheck.push("aud"), subject !== void 0 && presenceCheck.push("sub"), issuer !== void 0 && presenceCheck.push("iss");
  for (const claim of new Set(presenceCheck.reverse()))
    if (!Object.hasOwn(payload, claim))
      throw new JWTClaimValidationFailed(`missing required "${claim}" claim`, payload, claim, "missing");
  issuer !== void 0 && !(Array.isArray(issuer) ? issuer : [issuer]).includes(payload.iss) && unexpectedClaim(payload, "iss"), subject !== void 0 && payload.sub !== subject && unexpectedClaim(payload, "sub"), audience !== void 0 && !checkAudiencePresence(payload.aud, typeof audience == "string" ? [audience] : audience) && unexpectedClaim(payload, "aud");
  const { clockTolerance } = options;
  let tolerance = 0;
  if (typeof clockTolerance == "string")
    tolerance = secs(clockTolerance);
  else if (clockTolerance !== void 0) {
    if (typeof clockTolerance != "number")
      throw new TypeError("Invalid clockTolerance option type");
    tolerance = clockTolerance;
  }
  validateInput("clockTolerance option", tolerance);
  const { currentDate } = options, now = validateInput("currentDate option", epoch(currentDate === void 0 ? /* @__PURE__ */ new Date() : currentDate)), iat = validateNumericDate(payload, "iat", maxTokenAge !== void 0), nbf = validateNumericDate(payload, "nbf");
  if (nbf !== void 0 && nbf > now + tolerance)
    throw new JWTClaimValidationFailed('"nbf" claim timestamp check failed', payload, "nbf", checkFailed);
  const exp = validateNumericDate(payload, "exp");
  if (exp !== void 0 && exp <= now - tolerance)
    throw new JWTExpired('"exp" claim timestamp check failed', payload, "exp", checkFailed);
  if (maxTokenAge !== void 0) {
    const age = now - iat, max = validateInput("maxTokenAge option", typeof maxTokenAge == "number" ? maxTokenAge : secs(maxTokenAge));
    if (age - tolerance > max)
      throw new JWTExpired('"iat" claim timestamp check failed (too far in the past)', payload, "iat", checkFailed);
    if (age < -tolerance)
      throw new JWTClaimValidationFailed('"iat" claim timestamp check failed (it should be in the past)', payload, "iat", checkFailed);
  }
  return payload;
}

// packet-core/node_modules/jose/dist/webapi/jwt/verify.js
async function jwtVerify(jwt, key2, options) {
  const [verified2, b64] = await verifyCompact(jwt, prepareVerify(options), key2);
  if (!b64)
    throw new JWTInvalid("JWTs MUST NOT use unencoded payload");
  const payload = validateClaimsSet(verified2.protectedHeader, verified2.payload, options);
  return { ...verified2, payload };
}

// packet-core/node_modules/jose/dist/webapi/lib/key_algorithm.js
function unsupportedAlg(source = 'JWK "alg" (Algorithm) Parameter') {
  throw new JOSENotSupported(`Invalid or unsupported ${source} value`);
}
function keyAlgorithm(alg, source) {
  return (typeof alg == "string" ? JWS[alg] ?? JWE[alg] : void 0) ?? unsupportedAlg(source);
}

// packet-core/node_modules/jose/dist/webapi/key/export.js
async function exportJWK(key2) {
  if (isKeyObject(key2))
    if (key2.type === "secret")
      key2 = key2.export();
    else
      return key2.export({ format: "jwk" });
  if (key2 instanceof Uint8Array)
    return {
      kty: "oct",
      k: encode2(key2)
    };
  if (!isCryptoKey(key2))
    throw new TypeError(invalidKeyInput(key2, "CryptoKey", "KeyObject", "Uint8Array"));
  if (!key2.extractable)
    throw new TypeError("non-extractable CryptoKey cannot be exported as a JWK");
  const jwk = await crypto.subtle.exportKey("jwk", key2);
  delete jwk.ext, delete jwk.key_ops, delete jwk.use, jwk.kty !== "AKP" && delete jwk.alg;
  for (const parameter of Object.keys(jwk))
    jwk[parameter] === void 0 && delete jwk[parameter];
  return jwk;
}

// packet-core/node_modules/jose/dist/webapi/jwk/thumbprint.js
var check = (value, description) => {
  if (typeof value != "string" || !value)
    throw new JWKInvalid(`${description} missing or invalid`);
};
async function calculateJwkThumbprint(key2, digestAlgorithm) {
  let jwk;
  if (isObject(key2)) {
    if (jwk = snapshotJwk(key2), typeof jwk.kty != "string")
      throw new TypeError(invalidKeyInput(key2, "CryptoKey", "KeyObject", "JSON Web Key"));
  } else if (isKeyLike(key2))
    jwk = snapshotJwk(await exportJWK(key2));
  else
    throw new TypeError(invalidKeyInput(key2, "CryptoKey", "KeyObject", "JSON Web Key"));
  if (digestAlgorithm ??= "sha256", digestAlgorithm !== "sha256" && digestAlgorithm !== "sha384" && digestAlgorithm !== "sha512")
    throw new TypeError('digestAlgorithm must one of "sha256", "sha384", or "sha512"');
  let components;
  switch (jwk.kty) {
    case "AKP":
      check(jwk.alg, '"alg" (Algorithm) Parameter'), check(jwk.pub, '"pub" (Public key) Parameter'), components = { alg: jwk.alg, kty: jwk.kty, pub: jwk.pub };
      break;
    case "EC":
      check(jwk.crv, '"crv" (Curve) Parameter'), check(jwk.x, '"x" (X Coordinate) Parameter'), check(jwk.y, '"y" (Y Coordinate) Parameter'), components = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
      break;
    case "OKP":
      check(jwk.crv, '"crv" (Subtype of Key Pair) Parameter'), check(jwk.x, '"x" (Public Key) Parameter'), components = { crv: jwk.crv, kty: jwk.kty, x: jwk.x };
      break;
    case "RSA":
      check(jwk.e, '"e" (Exponent) Parameter'), check(jwk.n, '"n" (Modulus) Parameter'), components = { e: jwk.e, kty: jwk.kty, n: jwk.n };
      break;
    case "oct":
      if (typeof jwk.k != "string")
        throw new JWKInvalid('"k" (Key Value) Parameter missing or invalid');
      components = { k: jwk.k, kty: jwk.kty };
      break;
    default:
      throw new JOSENotSupported('"kty" (Key Type) Parameter missing or unsupported');
  }
  const data = encode(JSON.stringify(components));
  return encode2(await digest(digestAlgorithm, data));
}

// packet-core/node_modules/jose/dist/webapi/jwks/remote.js
var USER_AGENT;
(typeof navigator > "u" || !navigator.userAgent?.startsWith?.("Mozilla/5.0 ")) && (USER_AGENT = "jose/v6.2.12");

// packet-core/node_modules/jose/dist/webapi/key/import.js
async function importJWK(jwk, alg, options) {
  if (!isObject(jwk))
    throw new TypeError("JWK must be an object");
  const normalized = normalizeJwk(jwk), extractable = validateExtractableOption(options?.extractable), { alg: jwkAlg } = normalized;
  if (alg ??= jwkAlg, normalized.kty !== "oct" && !alg)
    throw new TypeError('"alg" argument is required when "jwk.alg" is not present');
  switch (normalized.kty) {
    case "oct":
      if (typeof normalized.k != "string")
        throw new TypeError('missing "k" (Key Value) Parameter value');
      return decode(normalized.k);
    case "AKP": {
      if (typeof jwkAlg != "string" || !jwkAlg)
        throw new TypeError('missing "alg" (Algorithm) Parameter value');
      if (alg !== jwkAlg)
        throw new TypeError("JWK alg and alg option value mismatch");
      return jwkToKey(keyAlgorithm(alg), normalized, extractable);
    }
    case "RSA":
    case "EC":
    case "OKP":
      return jwkToKey(keyAlgorithm(alg), normalized, extractable);
    default:
      throw new JOSENotSupported('Unsupported "kty" (Key Type) Parameter value');
  }
}

// packet-core/client/installation-store.mjs
function createInstallationStore({
  indexedDB = globalThis.indexedDB,
  cryptoApi = globalThis.crypto,
  name = "seamless-protected-installation-candidate-1"
} = {}) {
  if (!indexedDB?.open || !cryptoApi?.subtle || !cryptoApi.randomUUID) throw Error("installation-storage-unavailable");
  let opening;
  let database;
  let closed = false;
  const active = () => {
    if (closed) throw Error("installation-store-closed");
  };
  async function open() {
    active();
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      let failed = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("private")) request.result.createObjectStore("private");
      };
      request.onerror = () => {
        failed = true;
        reject(Error("installation-storage-unavailable"));
      };
      request.onblocked = () => {
        failed = true;
        reject(Error("installation-storage-blocked"));
      };
      request.onsuccess = () => {
        if (failed || closed) {
          request.result.close();
          reject(Error("installation-store-closed"));
          return;
        }
        database = request.result;
        database.onversionchange = () => {
          closed = true;
          database.close();
        };
        resolve(database);
      };
    });
    return opening;
  }
  function valid(record) {
    if (!record || record.version !== 1 || typeof record.generation !== "string" || !/^[a-f0-9-]{36}$/.test(record.generation)) throw Error("installation-record-invalid");
    if (record.keys !== null) {
      const { publicKey, privateKey } = record.keys ?? {};
      if (!(publicKey instanceof CryptoKey) || !(privateKey instanceof CryptoKey) || publicKey.type !== "public" || privateKey.type !== "private" || publicKey.algorithm.name !== "ECDH" || privateKey.algorithm.name !== "ECDH" || publicKey.algorithm.namedCurve !== "P-256" || privateKey.algorithm.namedCurve !== "P-256" || privateKey.extractable || !publicKey.extractable || privateKey.usages.length !== 1 || privateKey.usages[0] !== "deriveBits") throw Error("installation-key-invalid");
    }
    return record;
  }
  async function transact2(update, discardInvalid = false) {
    const db = await open();
    active();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("private", "readwrite");
      const store = transaction.objectStore("private");
      let result;
      let error;
      const read = store.get("installation");
      read.onsuccess = () => {
        try {
          active();
          const current = read.result === void 0 ? null : discardInvalid ? read.result : valid(read.result);
          const next = update(current);
          result = next;
          if (next !== current) store.put(next, "installation");
        } catch (e) {
          error = e;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => {
        try {
          active();
          resolve(valid(result));
        } catch (e) {
          reject(e);
        }
      };
      transaction.onerror = () => {
      };
      transaction.onabort = () => reject(error ?? Error("installation-write-failed"));
    });
  }
  const empty = () => ({ version: 1, generation: cryptoApi.randomUUID(), keys: null });
  return Object.freeze({
    async getInstallation() {
      const initial = await transact2((current) => current ?? empty());
      if (initial.keys) return Object.freeze(initial.keys);
      const keys = await cryptoApi.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
      active();
      const committed = await transact2((current) => {
        if (!current || current.generation !== initial.generation) throw Error("installation-generation-changed");
        return current.keys ? current : { ...current, keys };
      });
      return Object.freeze(committed.keys);
    },
    async clear() {
      await transact2(() => empty(), true);
    },
    close() {
      closed = true;
      database?.close();
    }
  });
}

// packet-core/client/lease-cache.mjs
function createLeaseCache({
  indexedDB = globalThis.indexedDB,
  cryptoApi = globalThis.crypto,
  now = () => Date.now(),
  name = "seamless-protected-leases-candidate-1"
} = {}) {
  let db;
  let opening;
  let closed = false;
  const active = () => {
    if (closed) throw Error("lease-cache-closed");
  };
  function open() {
    active();
    return opening ??= new Promise((resolve, reject) => {
      const r2 = indexedDB.open(name, 1);
      let failed = false;
      r2.onupgradeneeded = () => r2.result.createObjectStore("private");
      r2.onerror = r2.onblocked = () => {
        failed = true;
        reject(Error("lease-cache-unavailable"));
      };
      r2.onsuccess = () => {
        if (failed || closed) {
          r2.result.close();
          reject(Error("lease-cache-closed"));
          return;
        }
        db = r2.result;
        db.onversionchange = () => {
          closed = true;
          db.close();
        };
        resolve(db);
      };
    });
  }
  const key2 = (account, digest3) => {
    if (typeof account !== "string" || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(account) || !/^[a-f0-9]{64}$/.test(digest3)) throw Error("lease-cache-identity");
    return `${account}:${digest3}`;
  };
  function valid(s2) {
    if (!s2 || s2.version !== 1 || typeof s2.generation !== "string" || !Number.isFinite(s2.floor) || s2.floor < 0 || !s2.entries || typeof s2.entries !== "object" || Array.isArray(s2.entries) || Object.keys(s2.entries).length > 32) throw Error("lease-cache-corrupt");
    for (const [id2, entry] of Object.entries(s2.entries)) {
      if (!/^[a-z0-9][a-z0-9._-]{0,127}:[a-f0-9]{64}$/.test(id2) || !entry || Object.keys(entry).sort().join(",") !== "expiresAt,token" || typeof entry.token !== "string" || entry.token.length > 128e3 || !Number.isFinite(entry.expiresAt) || entry.expiresAt < 0) throw Error("lease-cache-corrupt");
    }
    return s2;
  }
  async function transaction(operation, { clear = false, observedTime } = {}) {
    const database = await open();
    active();
    return new Promise((resolve, reject) => {
      const tx = database.transaction("private", "readwrite");
      const store = tx.objectStore("private");
      const read = store.get("state");
      let result;
      let error;
      read.onsuccess = () => {
        try {
          active();
          const time = observedTime === void 0 ? now() : observedTime;
          if (!Number.isFinite(time) || time < 0) throw Error("clock-invalid");
          const s2 = clear || read.result === void 0 ? { version: 1, generation: cryptoApi.randomUUID(), floor: time, entries: {} } : valid(read.result);
          if (time < s2.floor) throw Error("clock-regression-revalidate");
          s2.floor = time;
          result = operation(s2);
          store.put(s2, "state");
        } catch (e) {
          error = e;
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        try {
          active();
          resolve(result);
        } catch (e) {
          reject(e);
        }
      };
      tx.onerror = () => {
      };
      tx.onabort = () => reject(error ?? Error("lease-cache-write-failed"));
    });
  }
  return Object.freeze({
    async checkpoint(generation, observedTime) {
      return transaction((s2) => {
        if (generation !== void 0 && generation !== s2.generation) throw Error("lease-cache-generation-changed");
        return s2.generation;
      }, { observedTime });
    },
    async read(account, digest3) {
      const id2 = key2(account, digest3);
      return transaction((s2) => ({ generation: s2.generation, entry: structuredClone(s2.entries[id2] ?? null) }));
    },
    async save({ generation, account, descriptorSha256, token, expiresAt }) {
      const id2 = key2(account, descriptorSha256);
      if (typeof token !== "string" || token.length > 128e3 || !Number.isFinite(expiresAt)) throw Error("lease-cache-entry");
      return transaction((s2) => {
        if (s2.generation !== generation) throw Error("lease-cache-generation-changed");
        if (expiresAt <= s2.floor) throw Error("lease-cache-expired");
        for (const [k2, value] of Object.entries(s2.entries)) if (value.expiresAt <= s2.floor) delete s2.entries[k2];
        if (!s2.entries[id2] && Object.keys(s2.entries).length >= 32) throw Error("lease-cache-capacity");
        if (!s2.entries[id2] || s2.entries[id2].expiresAt <= expiresAt) s2.entries[id2] = { token, expiresAt };
      });
    },
    async clear() {
      await transaction(() => {
      }, { clear: true });
    },
    close() {
      closed = true;
      db?.close();
    }
  });
}

// packet-core/src/contract.mjs
var FORMAT = "seamless-protected-candidate-1";
var PROFILE = "secretstream-xchacha20poly1305-1m-v1";
var CHUNK = 1048576;
var LIMITS = Object.freeze({ descriptor: 128e3, packet: 2e6, asset: 25e7, total: 2002e6, objects: 201 });
var verified = /* @__PURE__ */ new WeakMap();
var encoder2 = new TextEncoder();
var bytes = (value) => encoder2.encode(value);
var jsonBytes = (value) => bytes(JSON.stringify(value));
function insist(condition, code) {
  if (!condition) throw new Error(code);
}
function exact(value, fields) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Object.keys(value).length === fields.length && fields.every((key2) => Object.hasOwn(value, key2));
}
var isHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
var isId = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value);
async function digest2(value) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", value))].map((x2) => x2.toString(16).padStart(2, "0")).join("");
}
function ciphertextSize(size) {
  return 24 + size + Math.ceil(size / CHUNK) * 17;
}
function validateDescriptor(input, { allowPrivateDesign = false } = {}) {
  const d2 = structuredClone(input);
  insist(exact(d2, ["format", "release_id", "key_access", "publication", "crypto_profile", "required_capabilities", "objects"]), "descriptor-shape");
  insist(d2.format === FORMAT && d2.crypto_profile === PROFILE && isId(d2.release_id), "descriptor-profile");
  insist(["platform-key", "creator-secret"].includes(d2.key_access), "key-access-unsupported");
  insist(d2.publication === (d2.key_access === "platform-key" ? "reviewed-catalog-v2" : "creator-private"), "publication-mode-conflict");
  insist(d2.key_access === "platform-key" || allowPrivateDesign, "creator-private-not-enabled");
  insist(Array.isArray(d2.required_capabilities) && d2.required_capabilities.length === 2 && d2.required_capabilities[0] === PROFILE && d2.required_capabilities[1] === d2.key_access, "required-capabilities-unsupported");
  insist(Array.isArray(d2.objects) && d2.objects.length >= 1 && d2.objects.length <= LIMITS.objects, "object-count");
  const names = /* @__PURE__ */ new Set();
  let total = 0;
  let mediaTotal = 0;
  let packets = 0;
  for (const o2 of d2.objects) {
    insist(exact(o2, ["object_id", "kind", "plaintext_bytes", "ciphertext_bytes", "ciphertext_sha256"]), "object-shape");
    insist(isId(o2.object_id) && !names.has(o2.object_id), "object-identity");
    names.add(o2.object_id);
    insist(o2.kind === "packet" || o2.kind === "media", "object-kind");
    if (o2.kind === "packet") packets++;
    const limit = o2.kind === "packet" ? LIMITS.packet : LIMITS.asset;
    insist(Number.isSafeInteger(o2.plaintext_bytes) && o2.plaintext_bytes > 0 && o2.plaintext_bytes <= limit, "plaintext-limit");
    insist(o2.ciphertext_bytes === ciphertextSize(o2.plaintext_bytes) && isHash(o2.ciphertext_sha256), "ciphertext-binding");
    total += o2.plaintext_bytes;
    if (o2.kind === "media") mediaTotal += o2.plaintext_bytes;
  }
  insist(packets === 1 && total <= LIMITS.total && mediaTotal <= 2e9, "aggregate-limit");
  insist(jsonBytes(d2).length <= LIMITS.descriptor, "descriptor-limit");
  return d2;
}
function objectAAD(d2, o2) {
  return jsonBytes([FORMAT, d2.release_id, d2.key_access, d2.publication, PROFILE, o2.object_id, o2.kind, o2.plaintext_bytes]);
}
async function verifyDescriptor(token, trustedKeys) {
  insist(typeof token === "string" && token.length <= 18e4, "descriptor-token-limit");
  let signingKey;
  const { payload, protectedHeader } = await compactVerify(token, (header) => {
    insist(exact(header, ["alg", "typ", "kid"]) && header.alg === "EdDSA" && header.typ === "seamless-protected-descriptor+jws", "descriptor-header");
    const record = trustedKeys.get(header.kid);
    insist(record?.status === "active", "descriptor-key-untrusted");
    signingKey = record.key;
    return signingKey;
  }, { algorithms: ["EdDSA"] });
  insist(payload.length <= LIMITS.descriptor, "descriptor-limit");
  const descriptor = validateDescriptor(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)));
  const handle = Object.freeze({ descriptor: deepFreeze(descriptor), sha256: await digest2(bytes(token)) });
  verified.set(handle, { token, trustedKeys, kid: protectedHeader.kid, key: signingKey });
  requireDescriptor(handle);
  return handle;
}
function requireDescriptor(handle) {
  const record = verified.get(handle);
  insist(record && record.trustedKeys.get(record.kid)?.status === "active" && record.trustedKeys.get(record.kid)?.key === record.key, "verified-descriptor-required");
  return handle.descriptor;
}
function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const v2 of Object.values(value)) deepFreeze(v2);
    Object.freeze(value);
  }
  return value;
}
function descriptorToken(handle) {
  requireDescriptor(handle);
  return verified.get(handle).token;
}

// packet-core/src/license.mjs
var LEASE_SECONDS = 7 * 24 * 60 * 60;
var REFRESH_SECONDS = 24 * 60 * 60;
var AUDIENCE = "seamless-desktop-chrome-protected-candidate";
var sessions = /* @__PURE__ */ new WeakMap();
var integer = (value) => Number.isSafeInteger(value) && value >= 0;
async function installationId(key2) {
  const jwk = await exportJWK(key2);
  insist(jwk.kty === "EC" && jwk.crv === "P-256" && !jwk.d, "installation-public-key-profile");
  return calculateJwkThumbprint(jwk);
}
async function openLicense(token, {
  descriptor,
  trustedKeys,
  installationPrivateKey,
  installationPublicKey,
  account,
  issuer,
  now = () => Date.now(),
  monotonic = () => performance.now()
}) {
  const d2 = requireDescriptor(descriptor);
  insist(isId(account) && typeof issuer === "string" && issuer.length > 0, "license-verifier-policy");
  insist(typeof token === "string" && token.length <= 128e3, "license-token-limit");
  const started = now();
  const startedMono = monotonic();
  insist(Number.isFinite(started) && started >= 0 && Number.isFinite(startedMono), "clock-invalid");
  let record;
  let kid;
  let signingKey;
  const { payload } = await jwtVerify(token, (header) => {
    insist(exact(header, ["alg", "typ", "kid"]) && header.alg === "EdDSA" && header.typ === "seamless-playback-license+jwt", "license-header");
    kid = header.kid;
    record = trustedKeys.get(kid);
    insist(record?.status === "active", "license-key-untrusted");
    signingKey = record.key;
    return signingKey;
  }, {
    algorithms: ["EdDSA"],
    issuer,
    audience: AUDIENCE,
    subject: account,
    typ: "seamless-playback-license+jwt",
    currentDate: new Date(started),
    clockTolerance: 0,
    requiredClaims: ["iat", "nbf", "exp", "jti", "sub", "iss", "aud"]
  });
  insist(exact(payload, ["descriptor_sha256", "installation_id", "keys_jwe", "iss", "aud", "sub", "jti", "iat", "nbf", "exp"]), "license-claims");
  insist([payload.iat, payload.nbf, payload.exp].every(integer) && payload.nbf === payload.iat && payload.exp - payload.iat === LEASE_SECONDS && payload.iat * 1e3 <= started && isId(payload.jti), "license-lifetime");
  insist(payload.descriptor_sha256 === descriptor.sha256 && isHash(payload.descriptor_sha256), "license-release");
  const installation = await installationId(installationPublicKey);
  insist(payload.installation_id === installation, "license-installation");
  insist(typeof payload.keys_jwe === "string" && payload.keys_jwe.length <= 1e5, "key-envelope-limit");
  const decrypted = await compactDecrypt(
    payload.keys_jwe,
    installationPrivateKey,
    { keyManagementAlgorithms: ["ECDH-ES"], contentEncryptionAlgorithms: ["A256GCM"] }
  );
  const keys = /* @__PURE__ */ new Map();
  try {
    insist(decrypted.protectedHeader.typ === "seamless-content-keys+jwe" && exact(decrypted.protectedHeader, ["alg", "enc", "typ", "epk"]) && decrypted.protectedHeader.epk?.kty === "EC" && decrypted.protectedHeader.epk?.crv === "P-256", "key-envelope-type");
    insist(decrypted.plaintext.length <= 64e3, "key-envelope-limit");
    const grant = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decrypted.plaintext));
    insist(exact(grant, ["descriptor_sha256", "installation_id", "keys"]) && grant.descriptor_sha256 === descriptor.sha256 && grant.installation_id === installation, "key-envelope-binding");
    insist(Array.isArray(grant.keys) && grant.keys.length === d2.objects.length, "key-set");
    const expected = new Set(d2.objects.map((o2) => o2.object_id));
    for (const entry of grant.keys) {
      insist(exact(entry, ["object_id", "key"]) && expected.delete(entry.object_id) && typeof entry.key === "string" && /^[A-Za-z0-9_-]{43}$/.test(entry.key), "key-set");
      const key2 = base64url_exports.decode(entry.key);
      insist(key2.length === 32 && base64url_exports.encode(key2) === entry.key, "key-set");
      keys.set(entry.object_id, key2);
    }
    const handle = Object.freeze({ expiresAt: payload.exp * 1e3, renewAfter: (payload.exp - REFRESH_SECONDS) * 1e3 });
    sessions.set(handle, {
      descriptor,
      keys,
      now,
      monotonic,
      started,
      startedMono,
      high: started,
      monoHigh: startedMono,
      closed: false,
      trustedKeys,
      kid,
      signingKey
    });
    try {
      assertLicense(handle, descriptor);
    } catch (error) {
      closeLicense(handle);
      throw error;
    }
    return handle;
  } catch (error) {
    for (const key2 of keys.values()) key2.fill(0);
    throw error;
  } finally {
    decrypted.plaintext.fill(0);
  }
}
function assertLicense(handle, descriptor) {
  const s2 = sessions.get(handle);
  try {
    insist(s2 && !s2.closed && s2.descriptor === descriptor, "license-session-required");
    requireDescriptor(descriptor);
    insist(s2.trustedKeys.get(s2.kid)?.status === "active" && s2.trustedKeys.get(s2.kid)?.key === s2.signingKey, "license-key-untrusted");
    const wall = s2.now();
    const mono = s2.monotonic();
    insist(Number.isFinite(wall) && Number.isFinite(mono) && wall >= s2.high && mono >= s2.monoHigh, "clock-regression");
    const effective = Math.max(wall, s2.started + mono - s2.startedMono);
    s2.high = wall;
    s2.monoHigh = mono;
    insist(effective < handle.expiresAt, "license-expired");
    return { renewalDue: effective >= handle.renewAfter };
  } catch (error) {
    closeLicense(handle);
    throw error;
  }
}
function copyObjectKey(handle, descriptor, id2) {
  assertLicense(handle, descriptor);
  const key2 = sessions.get(handle).keys.get(id2);
  insist(key2, "object-key-missing");
  return key2.slice();
}
function closeLicense(handle) {
  const s2 = sessions.get(handle);
  if (!s2) return;
  s2.closed = true;
  for (const key2 of s2.keys.values()) key2.fill(0);
  s2.keys.clear();
}

// packet-core/client/license-manager.mjs
function createLicenseManager({ cache: cache2, installationStore, client, licenseTrust, issuer, now = () => Date.now(), monotonic = () => performance.now() }) {
  let closed = false;
  const sessions2 = /* @__PURE__ */ new Set();
  const metadata = /* @__PURE__ */ new WeakMap();
  const pending = /* @__PURE__ */ new Map();
  const check2 = (signal) => {
    if (closed || signal?.aborted) throw Error("license-manager-closed");
  };
  async function register(license, descriptor, generation) {
    try {
      check2();
      if (sessions2.size >= 32) throw Error("license-session-capacity");
      await cache2.checkpoint(generation);
      check2();
      assertLicense(license, descriptor);
    } catch (e) {
      closeLicense(license);
      throw e;
    }
    sessions2.add(license);
    metadata.set(license, { descriptor, generation, wall: now(), mono: monotonic() });
    return license;
  }
  async function restore(descriptor, account) {
    check2();
    requireDescriptor(descriptor);
    const { generation, entry } = await cache2.read(account, descriptor.sha256);
    check2();
    if (!entry) return { generation, license: null };
    const keys = await installationStore.getInstallation();
    check2();
    const license = await openLicense(entry.token, {
      descriptor,
      trustedKeys: licenseTrust,
      installationPrivateKey: keys.privateKey,
      installationPublicKey: keys.publicKey,
      account,
      issuer,
      now,
      monotonic
    });
    if (license.expiresAt !== entry.expiresAt) {
      closeLicense(license);
      throw Error("lease-cache-expiry-mismatch");
    }
    return { generation, license: await register(license, descriptor, generation) };
  }
  async function guard(license) {
    const m2 = metadata.get(license);
    try {
      check2();
      if (!m2) throw Error("managed-license-required");
      const effective = Math.floor(Math.max(now(), m2.wall + monotonic() - m2.mono));
      const decision = assertLicense(license, m2.descriptor);
      await cache2.checkpoint(m2.generation, effective);
      check2();
      assertLicense(license, m2.descriptor);
      return decision;
    } catch (e) {
      closeLicense(license);
      sessions2.delete(license);
      throw e;
    }
  }
  async function obtain(descriptor, account, { online = true, signal } = {}) {
    check2(signal);
    let cached;
    let generation;
    try {
      ({ generation, license: cached } = await restore(descriptor, account));
    } catch (e) {
      if (!online || /clock|cache|generation|closed|capacity/.test(e.message)) throw e;
      generation = await cache2.checkpoint();
    }
    try {
      check2(signal);
    } catch (e) {
      if (cached) {
        closeLicense(cached);
        sessions2.delete(cached);
      }
      throw e;
    }
    if (cached && (!(await guard(cached)).renewalDue || !online)) return { license: cached, status: "cached" };
    if (!online) throw Error("offline-license-unavailable");
    let issued;
    try {
      const license = await client.license(descriptor, { signal, onVerifiedGrant: async (grant) => {
        check2(signal);
        if (grant.accountId !== account) throw Error("license-account-changed");
        await cache2.save({ generation, account, descriptorSha256: descriptor.sha256, token: grant.token, expiresAt: grant.expiresAt });
        check2(signal);
      } });
      issued = license;
      await register(license, descriptor, generation);
      check2(signal);
      if (cached) {
        closeLicense(cached);
        sessions2.delete(cached);
      }
      return { license, status: "renewed" };
    } catch (e) {
      if (issued) {
        closeLicense(issued);
        sessions2.delete(issued);
      }
      try {
        check2(signal);
      } catch (cancelled2) {
        if (cached) {
          closeLicense(cached);
          sessions2.delete(cached);
        }
        throw cancelled2;
      }
      if (/account-changed|paired-session-changed|client-cancelled|clock|cache|generation/.test(e.message)) {
        if (cached) {
          closeLicense(cached);
          sessions2.delete(cached);
        }
        throw e;
      }
      if (cached) {
        await guard(cached);
        return { license: cached, status: "renewal-deferred" };
      }
      throw e;
    }
  }
  return Object.freeze({
    obtain(descriptor, account, options = {}) {
      const id2 = `${account}:${descriptor.sha256}`;
      if (pending.has(id2)) return Promise.reject(Error("license-operation-busy"));
      const p2 = obtain(descriptor, account, options).finally(() => pending.delete(id2));
      pending.set(id2, p2);
      return p2;
    },
    guard,
    release(license) {
      closeLicense(license);
      sessions2.delete(license);
      metadata.delete(license);
    },
    async signOut() {
      closed = true;
      client.close();
      for (const s2 of sessions2) closeLicense(s2);
      sessions2.clear();
      const outcomes = await Promise.allSettled([cache2.clear(), installationStore.clear()]);
      if (outcomes.some((x2) => x2.status === "rejected")) throw Error("protected-signout-cleanup-failed");
    },
    close() {
      closed = true;
      client.close();
      for (const s2 of sessions2) closeLicense(s2);
      sessions2.clear();
    }
  });
}

// extension/src/device-link-client.mjs
function deviceLifetime(config) {
  if (config.deviceLinkLifetimeSeconds === void 0) return null;
  if (![86400, 2592e3].includes(config.deviceLinkLifetimeSeconds)) throw Error("device-policy-invalid");
  if (config.fixtureOnly === true && config.deviceLinkLifetimeSeconds !== 86400) throw Error("device-policy-invalid");
  if (new URL(config.pairingOrigin).protocol !== "https:") throw Error("device-policy-invalid");
  return config.deviceLinkLifetimeSeconds * 1e3;
}

// extension/src/device-credentials.mjs
import { EXECUTING_BUILD as EXECUTING_BUILD3 } from "../../src/build-info.mjs";
var uuid = (value) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
var credentialRefusals = Object.freeze({
  "device-sender-denied": "protected-renderer-not-authorized",
  "device-credentials-unavailable": "protected-link-check-interrupted",
  "device-state-changed": "protected-link-check-interrupted",
  "device-generation-changed": "protected-link-check-interrupted",
  "device-session-changed": "protected-link-check-interrupted",
  "device-busy": "protected-link-check-interrupted",
  "device-link-invalid": "catalog-protected-pairing-required",
  "device-link-unavailable": "protected-link-removed",
  "device-network-unavailable": "protected-link-check-offline",
  "device-subject-invalid": "protected-link-check-failed",
  "device-response-invalid": "protected-link-check-failed"
});
async function readProtectedPairingCredentials(config, { signal, now = () => Date.now(), runtime = globalThis.chrome?.runtime } = {}) {
  const lifetime = deviceLifetime(config);
  if (lifetime === null) throw Error("device-links-unconfigured");
  signal?.throwIfAborted();
  const reply = await runtime.sendMessage({ kind: "device-credentials-v1", build: EXECUTING_BUILD3 });
  signal?.throwIfAborted();
  const v2 = reply?.value;
  if (!reply) throw Error("protected-credentials-no-reply");
  if (!sameExecutingBuild(reply.build)) throw Error("extension-build-changed");
  if (!reply.ok) throw Error(credentialRefusals[reply.code] ?? "catalog-protected-pairing-required");
  if (!v2 || Object.keys(v2).sort().join(",") !== "accessToken,accountId,expiresAt,pairingId" || !uuid(v2.accountId) || !uuid(v2.pairingId) || !/^[a-f0-9]{64}$/.test(v2.accessToken) || !Number.isFinite(v2.expiresAt) || v2.expiresAt <= now() || v2.expiresAt > now() + lifetime) throw Error("catalog-protected-pairing-required");
  return Object.freeze(v2);
}

// extension/src/seamless-rules.mjs
var deepFreeze2 = (value) => {
  if (value && typeof value === "object") {
    for (const v2 of Object.values(value)) deepFreeze2(v2);
    Object.freeze(value);
  }
  return value;
};
var RULES = deepFreeze2({
  "rules_version": "1.3.0",
  "about": "Seamless Scene edit rules: the single source for the extension's and the website's edit checks. Generated outputs: the extension's src/seamless-rules.mjs, the website's edit-pack schema and rules/vectors/boundaries-v1.json (npm run build:rules; npm run check:rules compares). Profiles: local-user (.ss files, folders, edit packs), catalog-v2 (published catalog edits), mvp (legacy signed 1.0.0 manifests). A relaxation that older clients would refuse names the first extension version that accepts it (requires_client).",
  "clip": {
    "duration_ms": {
      "local-user": {
        "min": 1500,
        "max": 12e4
      },
      "catalog-v2": {
        "min": 1500,
        "max": 12e4
      },
      "mvp": {
        "min": 5e3,
        "max": 6e4
      }
    },
    "duration_tolerance_ms": 100,
    "dimensions": {
      "min": [
        320,
        180
      ],
      "max": [
        4096,
        2160
      ],
      "even": true
    },
    "bytes": {
      "local-user": 536870912,
      "catalog-v2": 25e7
    },
    "count": {
      "local-user": 1e3,
      "catalog-v2": 200
    }
  },
  "segments": {
    "local-user": 1e3,
    "catalog-v2": 200,
    "mvp": 1e3,
    "gain_db": [
      -24,
      6
    ],
    "chain_gap_ms": 50,
    "risky_gap_ms": [
      50,
      500
    ]
  },
  "source": {
    "service": "prime-video",
    "territory": "^[A-Z]{2}$",
    "tiers": [
      "ad-free",
      "ad-supported"
    ],
    "local_tiers": [
      "ad-free",
      "ad-supported",
      "unverified"
    ],
    "local_default_tier": "unverified",
    "local_unknown_territory": "ZZ",
    "version_tag": {
      "pattern": "^[a-z0-9][a-z0-9._-]*$",
      "max": 120
    },
    "season": [
      0,
      1e4
    ],
    "episode": [
      0,
      1e4
    ],
    "runtime_ms": [
      1e3,
      864e5
    ],
    "tolerance_ms": {
      "max": 5e3,
      "default": 3e3,
      "match_floor": 2500,
      "legacy_read_max": 1e4
    }
  },
  "relaxations": [
    {
      "id": "clip-under-5000",
      "profile": "local-user",
      "below_ms": 5e3,
      "requires_client": "0.64.2",
      "since_rules": "1.0.0"
    },
    {
      "id": "clip-under-5000",
      "profile": "catalog-v2",
      "below_ms": 5e3,
      "requires_client": "0.65.0",
      "since_rules": "1.1.0"
    },
    {
      "id": "season-or-episode-0",
      "profile": "local-user",
      "requires_client": "0.65.0",
      "since_rules": "1.1.0"
    }
  ],
  "listing": {
    "title": [
      3,
      120
    ],
    "description": [
      20,
      5e3
    ],
    "categories": {
      "casting-swap": "Casting Swap",
      "visual-fx-update": "Visual FX Update",
      "outfit-swap": "Outfit Swap",
      "parody": "Parody",
      "major-rewrite": "Major Rewrite",
      "extended-scene": "Extended Scene",
      "other": "Other"
    },
    "legacy_categories": [
      "restoration",
      "narrative-change",
      "removal-filter",
      "casting-character",
      "visual-treatment",
      "tone-localization"
    ],
    "tags": {
      "max": 5,
      "length": [
        1,
        40
      ]
    },
    "release_notes_max": 4e3,
    "imdb": {
      "pattern": "^https:\\/\\/(?:www\\.|m\\.)?imdb\\.com\\/title\\/tt\\d{7,10}\\/?(?:[?#].*)?$",
      "max": 300
    }
  },
  "archive": {
    "total_bytes": 2147483648,
    "json_bytes": 1048576,
    "details_bytes": 65536,
    "json_depth": 64,
    "ratio": {
      "clip": 50,
      "other": 200,
      "exempt_below": 1048576
    },
    "min_extension": "0.63.0"
  },
  "catalog": {
    "packet_schema": "2.0.0",
    "media_profile": "catalog-av-v2",
    "min_client": "0.42.0",
    "total_bytes": 2e9
  }
});
var RULES_VERSION = RULES.rules_version;
var parse = (value) => typeof value === "string" && value.length <= 32 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) ? value.split(".").map(Number) : null;
function versionAtLeast(actual, minimum) {
  const a2 = parse(actual), b2 = parse(minimum);
  if (!a2 || !b2) return false;
  for (let i2 = 0; i2 < 3; i2++) if (a2[i2] !== b2[i2]) return a2[i2] > b2[i2];
  return true;
}
var later = (a2, b2) => versionAtLeast(a2, b2) ? a2 : b2;
var clipDurationRule = (profile) => RULES.clip.duration_ms[profile] ?? RULES.clip.duration_ms.mvp;
function relaxationsUsed(manifest, profile) {
  const used = [], segments = Array.isArray(manifest?.segments) ? manifest.segments : [];
  for (const relaxation of RULES.relaxations) {
    if (relaxation.profile !== profile) continue;
    if (relaxation.id === "clip-under-5000" && segments.some((s2) => Number.isFinite(s2?.asset?.expected_duration_ms) && s2.asset.expected_duration_ms < relaxation.below_ms)) used.push(relaxation);
    if (relaxation.id === "season-or-episode-0" && (manifest?.source?.season === 0 || manifest?.source?.episode === 0)) used.push(relaxation);
  }
  return used;
}
function requiredClientFor(manifest, profile) {
  const base = profile === "catalog-v2" ? RULES.catalog.min_client : RULES.archive.min_extension;
  return relaxationsUsed(manifest, profile).reduce((version2, relaxation) => later(version2, relaxation.requires_client), base);
}

// extension/src/asset-duration-policy.mjs
var MIN_ASSET_DURATION_MS = RULES.clip.duration_ms.mvp.min;
var LOCAL_USER_MIN_ASSET_DURATION_MS = RULES.clip.duration_ms["local-user"].min;
var CATALOG_V2_MIN_ASSET_DURATION_MS = RULES.clip.duration_ms["catalog-v2"].min;
var CATALOG_MAX_ASSET_DURATION_MS = RULES.clip.duration_ms.mvp.max;
var LOCAL_USER_MAX_ASSET_DURATION_MS = RULES.clip.duration_ms["local-user"].max;
var CATALOG_V2_MAX_ASSET_DURATION_MS = RULES.clip.duration_ms["catalog-v2"].max;
function supportsBoundedAssetDimensions(width, height) {
  const { min, max, even } = RULES.clip.dimensions;
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width >= min[0] && height >= min[1] && width <= max[0] && height <= max[1] && (!even || width % 2 === 0 && height % 2 === 0);
}
function maximumAssetDurationMs(profileClass = "mvp") {
  return clipDurationRule(profileClass).max;
}
function minimumAssetDurationMs(profileClass = "mvp") {
  return clipDurationRule(profileClass).min;
}
function supportsAssetDuration(durationMs, profileClass = "mvp") {
  return Number.isFinite(durationMs) && durationMs >= minimumAssetDurationMs(profileClass) && durationMs <= maximumAssetDurationMs(profileClass);
}

// extension/src/manifest-security.mjs
var ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
var SHA256_HEX = /^[a-f0-9]{64}$/;
var BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
var SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
var SEMVER_MAX = /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?\.x$/;
var ACTIONS = /* @__PURE__ */ new Set(["REPLACE", "INSERT", "SKIP", "MUTE"]);
var TOP_LEVEL_KEYS = [
  "schema_version",
  "edit_id",
  "manifest_version",
  "status",
  "source",
  "compatibility",
  "segments",
  "feature_flags",
  "content",
  "signature"
];
var OPTIONAL_TOP_LEVEL_KEYS = ["rights"];
var ManifestSecurityError = class extends Error {
  constructor(code) {
    super(code);
    this.name = "ManifestSecurityError";
    this.code = code;
  }
};
function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function isIntegerIn(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
function isId2(value) {
  return typeof value === "string" && ID.test(value);
}
function stringLength(value) {
  return [...value].length;
}
function isTimestamp(value) {
  if (typeof value !== "string") return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})[tT](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[zZ]|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return false;
  const [, year, month, day, hour, minute, second, sign, zoneHour = "0", zoneMinute = "0"] = parts;
  const y2 = Number(year), m2 = Number(month), d2 = Number(day), h2 = Number(hour), min = Number(minute), s2 = Number(second);
  const leap = y2 % 4 === 0 && (y2 % 100 !== 0 || y2 % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m2 < 1 || m2 > 12 || d2 < 1 || d2 > days[m2 - 1] || h2 > 23 || min > 59 || s2 > 60 || Number(zoneHour) > 23 || Number(zoneMinute) > 59) return false;
  if (s2 < 60) return true;
  const offset = (Number(zoneHour) * 60 + Number(zoneMinute)) * (sign === "-" ? -1 : 1);
  return ((h2 * 60 + min - offset) % 1440 + 1440) % 1440 === 1439;
}
function parseSemver(value) {
  const match = typeof value === "string" ? SEMVER.exec(value) : null;
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}
function parseMaxVersion(value) {
  const exact3 = parseSemver(value);
  if (exact3) return { exact: exact3, exclusive: null };
  const wildcard = typeof value === "string" ? SEMVER_MAX.exec(value) : null;
  if (!wildcard) return null;
  const major = Number(wildcard[1]);
  const minor = wildcard[2] === void 0 ? null : Number(wildcard[2]);
  if (!Number.isSafeInteger(major) || minor !== null && !Number.isSafeInteger(minor)) return null;
  if (minor === null && !Number.isSafeInteger(major + 1) || minor !== null && !Number.isSafeInteger(minor + 1)) return null;
  return {
    exact: null,
    exclusive: minor === null ? [major + 1, 0, 0] : [major, minor + 1, 0]
  };
}
function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}
function push(errors, path, code) {
  errors.push(Object.freeze({ path, code }));
}
function exactKeys(value, required, path, errors, optional = []) {
  if (!isPlainObject(value)) {
    push(errors, path, "object-required");
    return false;
  }
  const allowedSet = /* @__PURE__ */ new Set([...required, ...optional]);
  for (const key2 of Object.keys(value)) {
    if (!allowedSet.has(key2)) push(errors, `${path}.${key2}`, "unknown-field");
  }
  for (const key2 of required) {
    if (!(key2 in value)) push(errors, `${path}.${key2}`, "required-field");
  }
  return true;
}
function validateAsset(asset, path, errors, profileClass) {
  if (!exactKeys(asset, [
    "sha256",
    "expected_duration_ms",
    "container",
    "video_codec",
    "audio_codec",
    "width",
    "height",
    "dynamic_range"
  ], path, errors)) return;
  if (typeof asset.sha256 !== "string" || !SHA256_HEX.test(asset.sha256)) push(errors, `${path}.sha256`, "invalid-sha256");
  if (!isIntegerIn(asset.expected_duration_ms, minimumAssetDurationMs(profileClass), maximumAssetDurationMs(profileClass))) push(errors, `${path}.expected_duration_ms`, "out-of-range");
  if (asset.container !== "video/mp4") push(errors, `${path}.container`, "unsupported-container");
  if (asset.video_codec !== "avc1") push(errors, `${path}.video_codec`, "unsupported-video-codec");
  if (asset.audio_codec !== "mp4a") push(errors, `${path}.audio_codec`, "unsupported-audio-codec");
  const validDimensions = profileClass === "catalog-v2" ? supportsBoundedAssetDimensions(asset.width, asset.height) : [1280, 1920].includes(asset.width) && [720, 1080].includes(asset.height) && asset.width * 9 === asset.height * 16;
  if (!validDimensions) {
    push(errors, path, "unsupported-dimensions");
  }
  if (asset.dynamic_range !== "sdr") push(errors, `${path}.dynamic_range`, "unsupported-dynamic-range");
}
function validateSegment(segment, index, runtimeMs, errors, profileClass) {
  const path = `$.segments[${index}]`;
  if (!exactKeys(segment, [
    "segment_id",
    "action",
    "trigger_time_ms",
    "resume_time_ms",
    "asset",
    "transition",
    "failure_policy"
  ], path, errors)) return;
  if (!isId2(segment.segment_id)) push(errors, `${path}.segment_id`, "invalid-id");
  if (!ACTIONS.has(segment.action)) push(errors, `${path}.action`, "unsupported-action");
  if (!isIntegerIn(segment.trigger_time_ms, 0, runtimeMs)) push(errors, `${path}.trigger_time_ms`, "out-of-runtime");
  if (!isIntegerIn(segment.resume_time_ms, 0, runtimeMs)) push(errors, `${path}.resume_time_ms`, "out-of-runtime");
  if (segment.resume_time_ms < segment.trigger_time_ms) push(errors, path, "negative-segment");
  if (segment.action === "INSERT") {
    if (segment.resume_time_ms !== segment.trigger_time_ms) push(errors, path, "insert-must-resume-at-trigger");
  } else if (segment.resume_time_ms <= segment.trigger_time_ms) {
    push(errors, path, "zero-duration-segment");
  }
  const needsAsset = segment.action === "REPLACE" || segment.action === "INSERT";
  if (needsAsset) validateAsset(segment.asset, `${path}.asset`, errors, profileClass);
  else if (segment.asset !== null) push(errors, `${path}.asset`, "asset-not-allowed");
  if (!exactKeys(segment.transition, ["type"], `${path}.transition`, errors, ["gain_db"])) return;
  if (segment.transition.type !== "hard_cut") push(errors, `${path}.transition.type`, "unsupported-transition");
  if ("gain_db" in segment.transition && !isIntegerIn(segment.transition.gain_db, -24, 6)) {
    push(errors, `${path}.transition.gain_db`, "out-of-range");
  }
  if (segment.failure_policy !== "continue_native") push(errors, `${path}.failure_policy`, "unsupported-failure-policy");
}
function validateManifestSchema(manifest, { profileClass = "mvp" } = {}) {
  const errors = [];
  if (!exactKeys(manifest, TOP_LEVEL_KEYS, "$", errors, OPTIONAL_TOP_LEVEL_KEYS)) {
    return Object.freeze({ ok: false, errors: Object.freeze(errors) });
  }
  if (manifest.schema_version !== (profileClass === "catalog-v2" ? "2.0.0" : "1.0.0")) push(errors, "$.schema_version", "unsupported-schema");
  if (!isId2(manifest.edit_id)) push(errors, "$.edit_id", "invalid-id");
  if (!isIntegerIn(manifest.manifest_version, 1, 2147483647)) push(errors, "$.manifest_version", "invalid-version");
  if (manifest.status !== "released") push(errors, "$.status", "unsupported-status");
  if (exactKeys(manifest.source, [
    "service",
    "territory",
    "service_content_id",
    "title",
    "season",
    "episode",
    "expected_runtime_ms",
    "runtime_tolerance_ms",
    "service_tier",
    "version_tag"
  ], "$.source", errors)) {
    if (!isId2(manifest.source.service)) push(errors, "$.source.service", "invalid-id");
    if (typeof manifest.source.territory !== "string" || manifest.source.territory !== "fixture" && !/^[A-Z]{2}$/.test(manifest.source.territory)) push(errors, "$.source.territory", "invalid-territory");
    if (typeof manifest.source.service_content_id !== "string" || stringLength(manifest.source.service_content_id) < 1 || stringLength(manifest.source.service_content_id) > 256) push(errors, "$.source.service_content_id", "invalid-content-id");
    if (typeof manifest.source.title !== "string" || stringLength(manifest.source.title) < 1 || stringLength(manifest.source.title) > 256) push(errors, "$.source.title", "invalid-title");
    for (const field of ["season", "episode"]) {
      if (manifest.source[field] !== null && !isIntegerIn(manifest.source[field], RULES.source[field][0], RULES.source[field][1])) push(errors, `$.source.${field}`, "invalid-coordinate");
    }
    if (manifest.source.season === null !== (manifest.source.episode === null)) push(errors, "$.source", "incomplete-episode-coordinates");
    if (!isIntegerIn(manifest.source.expected_runtime_ms, 1e3, 864e5)) push(errors, "$.source.expected_runtime_ms", "invalid-runtime");
    const toleranceMax = profileClass === "catalog-v2" ? RULES.source.tolerance_ms.max : RULES.source.tolerance_ms.legacy_read_max;
    if (!isIntegerIn(manifest.source.runtime_tolerance_ms, 0, toleranceMax)) push(errors, "$.source.runtime_tolerance_ms", "invalid-tolerance");
    if (!isId2(manifest.source.service_tier)) push(errors, "$.source.service_tier", "invalid-service-tier");
    if (manifest.source.version_tag !== null && !isId2(manifest.source.version_tag)) push(errors, "$.source.version_tag", "invalid-version-tag");
  }
  if (exactKeys(manifest.compatibility, ["min_adapter_version", "max_adapter_version", "verified_at"], "$.compatibility", errors)) {
    const minimum = parseSemver(manifest.compatibility.min_adapter_version);
    const maximum = parseMaxVersion(manifest.compatibility.max_adapter_version);
    if (!minimum || manifest.compatibility.min_adapter_version.length > 32) push(errors, "$.compatibility.min_adapter_version", "invalid-adapter-version");
    if (!maximum || manifest.compatibility.max_adapter_version.length > 32) push(errors, "$.compatibility.max_adapter_version", "invalid-adapter-version");
    if (minimum && maximum) {
      const rangeValid = maximum.exact ? compareVersions(minimum, maximum.exact) <= 0 : compareVersions(minimum, maximum.exclusive) < 0;
      if (!rangeValid) push(errors, "$.compatibility", "invalid-adapter-range");
    }
    if (!isTimestamp(manifest.compatibility.verified_at)) push(errors, "$.compatibility.verified_at", "invalid-timestamp");
  }
  if (!Array.isArray(manifest.segments) || manifest.segments.length < 1 || manifest.segments.length > (profileClass === "catalog-v2" ? 200 : 1e3)) {
    push(errors, "$.segments", "invalid-segment-count");
  } else {
    let previousResume = -1;
    const ids = /* @__PURE__ */ new Set();
    const insertions = /* @__PURE__ */ new Set();
    for (let index = 0; index < manifest.segments.length; index += 1) {
      const segment = manifest.segments[index];
      validateSegment(segment, index, manifest.source?.expected_runtime_ms ?? -1, errors, profileClass);
      if (profileClass === "catalog-v2" && segment?.action === "INSERT") {
        if (insertions.has(segment.trigger_time_ms)) push(errors, `$.segments[${index}]`, "duplicate-insertion-anchor");
        insertions.add(segment.trigger_time_ms);
      }
      if (segment?.trigger_time_ms < previousResume) push(errors, `$.segments[${index}]`, "overlapping-or-unsorted");
      previousResume = Math.max(previousResume, segment?.resume_time_ms ?? previousResume);
      if (ids.has(segment?.segment_id)) push(errors, `$.segments[${index}].segment_id`, "duplicate-id");
      ids.add(segment?.segment_id);
    }
  }
  if (exactKeys(manifest.feature_flags, [
    "replace_enabled",
    "insert_enabled",
    "skip_enabled",
    "mute_enabled",
    "emergency_disable"
  ], "$.feature_flags", errors)) {
    for (const [key2, value] of Object.entries(manifest.feature_flags)) {
      if (typeof value !== "boolean") push(errors, `$.feature_flags.${key2}`, "boolean-required");
    }
  }
  if (exactKeys(manifest.content, ["spoilers", "warnings"], "$.content", errors, ["synthetic_media", "real_person_likeness"])) {
    if (typeof manifest.content.spoilers !== "boolean") push(errors, "$.content.spoilers", "boolean-required");
    if (!Array.isArray(manifest.content.warnings) || manifest.content.warnings.length > 32 || manifest.content.warnings.some((value) => typeof value !== "string" || stringLength(value) > 128)) push(errors, "$.content.warnings", "invalid-warnings");
    if ("synthetic_media" in manifest.content && typeof manifest.content.synthetic_media !== "boolean") push(errors, "$.content.synthetic_media", "boolean-required");
    if ("real_person_likeness" in manifest.content && typeof manifest.content.real_person_likeness !== "boolean") push(errors, "$.content.real_person_likeness", "boolean-required");
  }
  if (manifest.rights !== void 0 && exactKeys(manifest.rights, ["classification", "approval_reference"], "$.rights", errors)) {
    if (!["cleared-test", "public-domain", "licensed"].includes(manifest.rights.classification)) push(errors, "$.rights.classification", "unsupported-rights-classification");
    if (!isId2(manifest.rights.approval_reference)) push(errors, "$.rights.approval_reference", "invalid-approval-reference");
  }
  if (exactKeys(manifest.signature, ["algorithm", "key_id", "value"], "$.signature", errors)) {
    if (manifest.signature.algorithm !== "Ed25519") push(errors, "$.signature.algorithm", "unsupported-signature-algorithm");
    if (!isId2(manifest.signature.key_id)) push(errors, "$.signature.key_id", "invalid-key-id");
    if (base64ByteLength(manifest.signature.value) !== 64) push(errors, "$.signature.value", "invalid-signature");
  }
  const enabledByAction = {
    REPLACE: manifest.feature_flags?.replace_enabled,
    INSERT: manifest.feature_flags?.insert_enabled,
    SKIP: manifest.feature_flags?.skip_enabled,
    MUTE: manifest.feature_flags?.mute_enabled
  };
  for (let index = 0; index < (Array.isArray(manifest.segments) ? manifest.segments.length : 0); index += 1) {
    const action = manifest.segments[index]?.action;
    if (ACTIONS.has(action) && enabledByAction[action] !== true) push(errors, `$.segments[${index}].action`, "action-disabled");
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
function canonical(value, path) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) throw new ManifestSecurityError("non-canonical-number");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry, index) => canonical(entry, `${path}[${index}]`)).join(",")}]`;
  if (!isPlainObject(value)) throw new ManifestSecurityError("non-canonical-value");
  const pairs = [];
  for (const key2 of Object.keys(value).sort()) {
    if (path === "$.signature" && key2 === "value") continue;
    pairs.push(`${JSON.stringify(key2)}:${canonical(value[key2], `${path}.${key2}`)}`);
  }
  return `{${pairs.join(",")}}`;
}
function canonicalizeManifest(manifest) {
  return canonical(manifest, "$");
}
function decodeBase642(value) {
  if (typeof value !== "string" || !BASE64.test(value)) throw new ManifestSecurityError("invalid-base64");
  if (typeof globalThis.atob === "function") {
    const decoded = globalThis.atob(value);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  }
  throw new ManifestSecurityError("base64-decoder-unavailable");
}
function base64ByteLength(value) {
  if (typeof value !== "string" || !BASE64.test(value)) return -1;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return value.length / 4 * 3 - padding;
}
async function verifyCatalogManifest(manifest, trustedKeys, cryptoApi = globalThis.crypto) {
  const schema = validateManifestSchema(manifest, { profileClass: "catalog-v2" });
  if (!schema.ok) return Object.freeze({ ok: false, code: "schema-invalid", errors: schema.errors });
  return verifyEd25519Document(manifest, trustedKeys, cryptoApi);
}
async function verifyEd25519Document(manifest, trustedKeys, cryptoApi = globalThis.crypto) {
  if (manifest?.signature?.algorithm !== "Ed25519" || !isId2(manifest.signature.key_id) || base64ByteLength(manifest.signature.value) !== 64) {
    return Object.freeze({ ok: false, code: "signature-invalid", errors: Object.freeze([]) });
  }
  const keyRecord = trustedKeys?.[manifest.signature.key_id];
  if (!keyRecord) return Object.freeze({ ok: false, code: "unknown-signing-key", errors: Object.freeze([]) });
  if (keyRecord.status === "revoked") return Object.freeze({ ok: false, code: "signing-key-revoked", errors: Object.freeze([]) });
  if (keyRecord.status !== "active") return Object.freeze({ ok: false, code: "signing-key-inactive", errors: Object.freeze([]) });
  if (!cryptoApi?.subtle) throw new ManifestSecurityError("webcrypto-unavailable");
  try {
    const publicKeyBytes = typeof keyRecord.publicKey === "string" ? decodeBase642(keyRecord.publicKey) : keyRecord.publicKey;
    if (!(publicKeyBytes instanceof Uint8Array) || publicKeyBytes.byteLength !== 32) {
      return Object.freeze({ ok: false, code: "invalid-public-key", errors: Object.freeze([]) });
    }
    const publicKey = await cryptoApi.subtle.importKey(
      "raw",
      publicKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    const verified2 = await cryptoApi.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      decodeBase642(manifest.signature.value),
      new TextEncoder().encode(canonicalizeManifest(manifest))
    );
    return Object.freeze({ ok: verified2, code: verified2 ? "verified" : "signature-invalid", errors: Object.freeze([]) });
  } catch (error) {
    if (error instanceof ManifestSecurityError) throw error;
    return Object.freeze({ ok: false, code: "signature-invalid", errors: Object.freeze([]) });
  }
}

// extension/src/catalog-packet.mjs
var CATALOG_PACKET_SCHEMA = RULES.catalog.packet_schema;
var CATALOG_MEDIA_PROFILE = RULES.catalog.media_profile;
var CATALOG_MIN_CLIENT_VERSION = RULES.catalog.min_client;
var CATALOG_SHORT_CLIP_MIN_CLIENT_VERSION = RULES.relaxations.find((r2) => r2.profile === "catalog-v2" && r2.id === "clip-under-5000").requires_client;
var CATALOG_PACKET_MAX_BYTES = 2e6;
var uuid2 = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
var hash = /^[a-f0-9]{64}$/;
var id = /^[a-z0-9][a-z0-9._-]{0,127}$/;
var verifiedPackets = /* @__PURE__ */ new WeakMap();
var failure = (code, errors = []) => Object.freeze({ ok: false, code, errors: Object.freeze(errors) });
function exact2(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Object.keys(value).length === keys.length && keys.every((key2) => Object.hasOwn(value, key2));
}
function version(value) {
  return typeof value === "string" && value.length <= 32 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) && value.split(".").every((part) => Number.isSafeInteger(Number(part))) ? value.split(".").map(Number) : null;
}
function atLeast(actual, minimum) {
  const a2 = version(actual), b2 = version(minimum);
  if (!a2 || !b2) return false;
  for (let i2 = 0; i2 < 3; i2++) {
    if (a2[i2] !== b2[i2]) return a2[i2] > b2[i2];
  }
  return true;
}
function isSafeCatalogMediaPath(value) {
  return typeof value === "string" && value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*\.mp4$/.test(value) && !/(^|\/)(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|\/|$)/i.test(value) && !/\.(\/|$)/.test(value);
}
function validateCatalogEnvelope(packet) {
  try {
    if (new TextEncoder().encode(JSON.stringify(packet)).length > CATALOG_PACKET_MAX_BYTES) return failure("packet-too-large");
  } catch {
    return failure("packet-invalid");
  }
  if (!exact2(packet, ["packet_schema_version", "packet_id", "purpose", "creative_edit_id", "source_variant_id", "media_profile", "required_client_version", "manifest", "asset_bindings", "signature"])) return failure("packet-invalid");
  if (packet.packet_schema_version !== CATALOG_PACKET_SCHEMA || packet.purpose !== "catalog-distribution" || packet.media_profile !== CATALOG_MEDIA_PROFILE) return failure("packet-schema-unsupported");
  if (![packet.packet_id, packet.creative_edit_id, packet.source_variant_id].every((value) => typeof value === "string" && uuid2.test(value)) || !atLeast(packet.required_client_version, CATALOG_MIN_CLIENT_VERSION)) return failure("packet-identity-invalid");
  return null;
}
function validateCatalogPacket(packet) {
  const envelope = validateCatalogEnvelope(packet);
  if (envelope) return envelope;
  const schema = validateManifestSchema(packet.manifest, { profileClass: "catalog-v2" });
  if (!schema.ok) return failure("manifest-invalid", schema.errors);
  if (!atLeast(packet.required_client_version, requiredClientFor(packet.manifest, "catalog-v2"))) return failure("packet-client-version-too-low");
  if (!uuid2.test(packet.manifest.edit_id)) return failure("playback-identity-invalid");
  const signature = packet.signature;
  if (!exact2(signature, ["algorithm", "key_id", "value"]) || signature.algorithm !== "Ed25519" || typeof signature.key_id !== "string" || !id.test(signature.key_id) || typeof signature.value !== "string" || !/^(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/.test(signature.value)) return failure("packet-signature-invalid");
  if (!Array.isArray(packet.asset_bindings) || packet.asset_bindings.length > 200) return failure("packet-bindings-invalid");
  const required = /* @__PURE__ */ new Map();
  for (const segment of packet.manifest.segments) {
    if (!segment.asset) continue;
    const previous = required.get(segment.asset.sha256);
    if (previous && canonicalizeManifest(previous) !== canonicalizeManifest(segment.asset)) return failure("asset-declaration-conflict");
    required.set(segment.asset.sha256, segment.asset);
  }
  const hashes = /* @__PURE__ */ new Set(), paths = /* @__PURE__ */ new Set();
  let bytes2 = 0;
  for (const binding of packet.asset_bindings) {
    if (!exact2(binding, ["sha256", "relative_path", "bytes"]) || !hash.test(binding.sha256) || !isSafeCatalogMediaPath(binding.relative_path) || !Number.isSafeInteger(binding.bytes) || binding.bytes < 1 || binding.bytes > 25e7) return failure("packet-binding-invalid");
    if (hashes.has(binding.sha256) || paths.has(binding.relative_path.toLowerCase()) || !required.has(binding.sha256)) return failure("packet-binding-conflict");
    hashes.add(binding.sha256);
    paths.add(binding.relative_path.toLowerCase());
    bytes2 += binding.bytes;
  }
  if (bytes2 > 2e9 || hashes.size !== required.size) return failure("packet-bindings-incomplete");
  return Object.freeze({ ok: true, code: "schema-valid", errors: Object.freeze([]) });
}
function catalogCapabilityDecision(packet, capabilities) {
  return atLeast(capabilities?.clientVersion, packet.required_client_version) && Array.isArray(capabilities.packetSchemas) && capabilities.packetSchemas.includes(CATALOG_PACKET_SCHEMA) && Array.isArray(capabilities.mediaProfiles) && capabilities.mediaProfiles.includes(CATALOG_MEDIA_PROFILE) ? { ok: true, code: "supported" } : { ok: false, code: "client-update-required" };
}
async function verifyCatalogPacket(packet, trustedKeys, { capabilities, cryptoApi = globalThis.crypto } = {}) {
  let snapshot;
  try {
    snapshot = structuredClone(packet);
  } catch {
    return failure("packet-invalid");
  }
  const shape = validateCatalogEnvelope(snapshot);
  if (shape) return shape;
  const capability = catalogCapabilityDecision(snapshot, capabilities);
  if (!capability.ok) return Object.freeze({ ok: false, code: capability.code, errors: Object.freeze([]), requiredClientVersion: snapshot.required_client_version });
  const schema = validateCatalogPacket(snapshot);
  if (!schema.ok) return schema;
  const envelope = await verifyEd25519Document(snapshot, trustedKeys, cryptoApi);
  if (!envelope.ok) return failure(envelope.code);
  const manifest = await verifyCatalogManifest(snapshot.manifest, trustedKeys, cryptoApi);
  if (!manifest.ok) return failure(manifest.code, manifest.errors);
  const result = Object.freeze({ ok: true, code: "verified", errors: Object.freeze([]) });
  verifiedPackets.set(result, { packet: snapshot, trustedKeys, cryptoApi });
  return result;
}

// extension/src/operation-context.mjs
function abortError(reason = "Operation cancelled") {
  return new DOMException(reason, "AbortError");
}
function assertActive(signal) {
  if (signal?.aborted) throw signal.reason ?? abortError();
}
function boundedOperation(operation, { signal, timeoutMs = 5e3, label = "operation" } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      error ? reject(error) : resolve(value);
    };
    const onAbort = () => finish(signal.reason ?? abortError());
    const timer = setTimeout(() => finish(new Error(`${label}-timeout`)), timeoutMs);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(() => {
      assertActive(signal);
      return operation();
    }).then(
      (value) => finish(null, value),
      (error) => finish(error)
    );
  });
}
var OperationContext = class {
  constructor() {
    this.generation = 0;
    this.controller = new AbortController();
  }
  capture() {
    const generation = this.generation, signal = this.controller.signal;
    return Object.freeze({ generation, signal, assertCurrent: () => {
      assertActive(signal);
      if (this.generation !== generation) throw abortError("Stale operation");
    } });
  }
  invalidate(reason = "Session changed") {
    this.controller.abort(abortError(reason));
    this.generation += 1;
    this.controller = new AbortController();
  }
};

// extension/src/catalog-control-updates.mjs
function catalogControlOrigin(value, { fixtureOnly = false } = {}) {
  if (value === void 0 || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 2048) throw Error("catalog-control-origin-invalid");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error("catalog-control-origin-invalid");
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || ![url.origin, url.origin + "/"].includes(value) || url.protocol !== "https:" && !(fixtureOnly && loopback && url.protocol === "http:") || !fixtureOnly && (loopback || url.hostname.endsWith(".localhost"))) throw Error("catalog-control-origin-invalid");
  return url.origin;
}

// packet-core/node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs
async function A(A3 = {}) {
  var I2, g2 = A3, C2 = !!globalThis.window, B2 = !!globalThis.WorkerGlobalScope, Q2 = (globalThis.process?.versions?.node && globalThis.process, import.meta.url);
  if (C2 || B2) {
    try {
      new URL(".", Q2).href;
    } catch {
    }
    B2 && (I2 = (A4) => {
      var I3 = new XMLHttpRequest();
      return I3.open("GET", A4, false), I3.responseType = "arraybuffer", I3.send(null), new Uint8Array(I3.response);
    });
  }
  (function() {
  }).bind();
  var E2, i2, D2, o2, y2, h2, w2, F2, c2, S2, a2, k2 = function() {
  }.bind(), M2 = false, G2 = false;
  function N2() {
    var A4 = e.buffer;
    w2 = new Int8Array(A4), y2 = new Int16Array(A4), g2.HEAPU8 = a2 = new Uint8Array(A4), new Uint16Array(A4), h2 = new Int32Array(A4), S2 = new Uint32Array(A4), F2 = new Float32Array(A4), c2 = new Float64Array(A4);
  }
  function J2(A4) {
    g2.onAbort?.(A4), k2(A4 = `Aborted(${A4})`), M2 = true, A4 += ". Build with -sASSERTIONS for more info.";
    var I3 = new WebAssembly.RuntimeError(A4);
    throw D2?.(I3), I3;
  }
  for (var U2 = (A4) => {
    for (; A4.length > 0; ) A4.shift()(g2);
  }, Y2 = [], K2 = (A4) => Y2.push(A4), H2 = [], s2 = (A4) => H2.push(A4), f2 = globalThis.TextDecoder && new TextDecoder(), t2 = (A4, I3, g3) => A4 ? ((A5, I4 = 0, g4, C3) => {
    var B3 = ((A6, I5, g5, C4) => {
      var B4 = I5 + g5;
      if (C4) return B4;
      for (; A6[I5] && !(I5 >= B4); ) ++I5;
      return I5;
    })(A5, I4, g4, C3);
    if (B3 - I4 > 16 && A5.buffer && f2) return f2.decode(A5.subarray(I4, B3));
    for (var Q3 = ""; I4 < B3; ) {
      var E3 = A5[I4++];
      if (128 & E3) {
        var i3 = 63 & A5[I4++];
        if (192 != (224 & E3)) {
          var D3 = 63 & A5[I4++];
          if ((E3 = 224 == (240 & E3) ? (15 & E3) << 12 | i3 << 6 | D3 : (7 & E3) << 18 | i3 << 12 | D3 << 6 | 63 & A5[I4++]) < 65536) Q3 += String.fromCharCode(E3);
          else {
            var o3 = E3 - 65536;
            Q3 += String.fromCharCode(55296 | o3 >> 10, 56320 | 1023 & o3);
          }
        } else Q3 += String.fromCharCode((31 & E3) << 6 | i3);
      } else Q3 += String.fromCharCode(E3);
    }
    return Q3;
  })(a2, A4, I3, g3) : "", p2 = [], L2 = (A4, I3) => Math.ceil(A4 / I3) * I3, r2 = (A4) => {
    var I3 = (A4 - e.buffer.byteLength + 65535) / 65536 | 0;
    try {
      return e.grow(I3), N2(), 1;
    } catch (A5) {
    }
  }, R2 = new Uint8Array(123), n2 = 25; n2 >= 0; --n2) R2[48 + n2] = 52 + n2, R2[65 + n2] = n2, R2[97 + n2] = 26 + n2;
  if (R2[43] = 62, R2[47] = 63, g2.noExitRuntime && g2.noExitRuntime, g2.print && g2.print, g2.printErr && (k2 = g2.printErr), g2.wasmBinary && (E2 = g2.wasmBinary), g2.arguments && g2.arguments, g2.thisProgram && g2.thisProgram, g2.preInit) for ("function" == typeof g2.preInit && (g2.preInit = [g2.preInit]); g2.preInit.length > 0; ) g2.preInit.shift()();
  g2.setValue = function(A4, I3, g3 = "i8") {
    switch (g3.endsWith("*") && (g3 = "*"), g3) {
      case "i1":
      case "i8":
        w2[A4] = I3;
        break;
      case "i16":
        y2[A4 >> 1] = I3;
        break;
      case "i32":
        h2[A4 >> 2] = I3;
        break;
      case "i64":
        J2("to do setValue(i64) use WASM_BIGINT");
      case "float":
        F2[A4 >> 2] = I3;
        break;
      case "double":
        c2[A4 >> 3] = I3;
        break;
      case "*":
        S2[A4 >> 2] = I3;
        break;
      default:
        J2(`invalid type for setValue: ${g3}`);
    }
  }, g2.getValue = function(A4, I3 = "i8") {
    switch (I3.endsWith("*") && (I3 = "*"), I3) {
      case "i1":
      case "i8":
        return w2[A4];
      case "i16":
        return y2[A4 >> 1];
      case "i32":
        return h2[A4 >> 2];
      case "i64":
        J2("to do getValue(i64) use WASM_BIGINT");
      case "float":
        return F2[A4 >> 2];
      case "double":
        return c2[A4 >> 3];
      case "*":
        return S2[A4 >> 2];
      default:
        J2(`invalid type for getValue: ${I3}`);
    }
  }, g2.UTF8ToString = t2;
  var e, _2, d2 = { 40712: () => g2.getRandomValue(), 40748: () => {
    if (void 0 === g2.getRandomValue) try {
      var A4 = "object" == typeof window ? window : self, I3 = void 0 !== A4.crypto ? A4.crypto : A4.msCrypto;
      I3 = void 0 === I3 ? B3 : I3;
      var C3 = function() {
        var A5 = new Uint32Array(1);
        return I3.getRandomValues(A5), A5[0] >>> 0;
      };
      C3(), g2.getRandomValue = C3;
    } catch (A5) {
      try {
        var B3 = require_crypto(), Q3 = function() {
          var A6 = B3.randomBytes(4);
          return (A6[0] << 24 | A6[1] << 16 | A6[2] << 8 | A6[3]) >>> 0;
        };
        Q3(), g2.getRandomValue = Q3;
      } catch (A6) {
        throw "No secure random number generator found";
      }
    }
  } }, q2 = { a: (A4, I3, g3, C3) => J2(`Assertion failed: ${t2(A4)}, at: ` + [I3 ? t2(I3) : "unknown filename", g3, C3 ? t2(C3) : "unknown function"]), c: () => J2(""), b: (A4, I3, g3) => ((A5, I4, g4) => {
    var C3 = ((A6, I5) => {
      var g5;
      for (p2.length = 0; g5 = a2[A6++]; ) {
        var C4 = 105 != g5;
        I5 += (C4 &= 112 != g5) && I5 % 8 ? 4 : 0, p2.push(112 == g5 ? S2[I5 >> 2] : 105 == g5 ? h2[I5 >> 2] : c2[I5 >> 3]), I5 += C4 ? 8 : 4;
      }
      return p2;
    })(I4, g4);
    return d2[A5](...C3);
  })(A4, I3, g3), d: (A4) => {
    var I3 = a2.length, g3 = 2147483648;
    if ((A4 >>>= 0) > g3) return false;
    for (var C3 = 1; C3 <= 4; C3 *= 2) {
      var B3 = I3 * (1 + 0.2 / C3);
      B3 = Math.min(B3, A4 + 100663296);
      var Q3 = Math.min(g3, L2(Math.max(A4, B3), 65536));
      if (r2(Q3)) return true;
    }
    return false;
  } };
  return _2 = await (async function() {
    function A4(A5, I3) {
      return (function(A6) {
        g2._crypto_aead_aegis128l_keybytes = A6.f, g2._crypto_aead_aegis128l_nsecbytes = A6.g, g2._crypto_aead_aegis128l_npubbytes = A6.h, g2._crypto_aead_aegis128l_abytes = A6.i, g2._crypto_aead_aegis128l_messagebytes_max = A6.j, g2._crypto_aead_aegis128l_keygen = A6.k, g2._crypto_aead_aegis128l_encrypt = A6.l, g2._crypto_aead_aegis128l_encrypt_detached = A6.m, g2._crypto_aead_aegis128l_decrypt = A6.n, g2._crypto_aead_aegis128l_decrypt_detached = A6.o, g2._crypto_aead_aegis256_keybytes = A6.p, g2._crypto_aead_aegis256_nsecbytes = A6.q, g2._crypto_aead_aegis256_npubbytes = A6.r, g2._crypto_aead_aegis256_abytes = A6.s, g2._crypto_aead_aegis256_messagebytes_max = A6.t, g2._crypto_aead_aegis256_keygen = A6.u, g2._crypto_aead_aegis256_encrypt = A6.v, g2._crypto_aead_aegis256_encrypt_detached = A6.w, g2._crypto_aead_aegis256_decrypt = A6.x, g2._crypto_aead_aegis256_decrypt_detached = A6.y, g2._crypto_aead_aes256gcm_is_available = A6.z, g2._crypto_aead_chacha20poly1305_encrypt_detached = A6.A, g2._crypto_aead_chacha20poly1305_encrypt = A6.B, g2._crypto_aead_chacha20poly1305_ietf_encrypt_detached = A6.C, g2._crypto_aead_chacha20poly1305_ietf_encrypt = A6.D, g2._crypto_aead_chacha20poly1305_decrypt_detached = A6.E, g2._crypto_aead_chacha20poly1305_decrypt = A6.F, g2._crypto_aead_chacha20poly1305_ietf_decrypt_detached = A6.G, g2._crypto_aead_chacha20poly1305_ietf_decrypt = A6.H, g2._crypto_aead_chacha20poly1305_ietf_keybytes = A6.I, g2._crypto_aead_chacha20poly1305_ietf_npubbytes = A6.J, g2._crypto_aead_chacha20poly1305_ietf_nsecbytes = A6.K, g2._crypto_aead_chacha20poly1305_ietf_abytes = A6.L, g2._crypto_aead_chacha20poly1305_ietf_messagebytes_max = A6.M, g2._crypto_aead_chacha20poly1305_ietf_keygen = A6.N, g2._crypto_aead_chacha20poly1305_keybytes = A6.O, g2._crypto_aead_chacha20poly1305_npubbytes = A6.P, g2._crypto_aead_chacha20poly1305_nsecbytes = A6.Q, g2._crypto_aead_chacha20poly1305_abytes = A6.R, g2._crypto_aead_chacha20poly1305_messagebytes_max = A6.S, g2._crypto_aead_chacha20poly1305_keygen = A6.T, g2._crypto_aead_xchacha20poly1305_ietf_encrypt_detached = A6.U, g2._crypto_aead_xchacha20poly1305_ietf_encrypt = A6.V, g2._crypto_aead_xchacha20poly1305_ietf_decrypt_detached = A6.W, g2._crypto_aead_xchacha20poly1305_ietf_decrypt = A6.X, g2._crypto_aead_xchacha20poly1305_ietf_keybytes = A6.Y, g2._crypto_aead_xchacha20poly1305_ietf_npubbytes = A6.Z, g2._crypto_aead_xchacha20poly1305_ietf_nsecbytes = A6._, g2._crypto_aead_xchacha20poly1305_ietf_abytes = A6.$, g2._crypto_aead_xchacha20poly1305_ietf_messagebytes_max = A6.aa, g2._crypto_aead_xchacha20poly1305_ietf_keygen = A6.ba, g2._crypto_auth_bytes = A6.ca, g2._crypto_auth_keybytes = A6.da, g2._crypto_auth_primitive = A6.ea, g2._crypto_auth = A6.fa, g2._crypto_auth_verify = A6.ga, g2._crypto_auth_keygen = A6.ha, g2._crypto_auth_hmacsha256_bytes = A6.ia, g2._crypto_auth_hmacsha256_keybytes = A6.ja, g2._crypto_auth_hmacsha256_statebytes = A6.ka, g2._crypto_auth_hmacsha256_keygen = A6.la, g2._crypto_auth_hmacsha256_init = A6.ma, g2._crypto_auth_hmacsha256_update = A6.na, g2._crypto_auth_hmacsha256_final = A6.oa, g2._crypto_auth_hmacsha256 = A6.pa, g2._crypto_auth_hmacsha256_verify = A6.qa, g2._crypto_auth_hmacsha512_bytes = A6.ra, g2._crypto_auth_hmacsha512_keybytes = A6.sa, g2._crypto_auth_hmacsha512_statebytes = A6.ta, g2._crypto_auth_hmacsha512_keygen = A6.ua, g2._crypto_auth_hmacsha512_init = A6.va, g2._crypto_auth_hmacsha512_update = A6.wa, g2._crypto_auth_hmacsha512_final = A6.xa, g2._crypto_auth_hmacsha512 = A6.ya, g2._crypto_auth_hmacsha512_verify = A6.za, g2._crypto_auth_hmacsha512256_bytes = A6.Aa, g2._crypto_auth_hmacsha512256_keybytes = A6.Ba, g2._crypto_auth_hmacsha512256_statebytes = A6.Ca, g2._crypto_auth_hmacsha512256_keygen = A6.Da, g2._crypto_auth_hmacsha512256_init = A6.Ea, g2._crypto_auth_hmacsha512256_update = A6.Fa, g2._crypto_auth_hmacsha512256_final = A6.Ga, g2._crypto_auth_hmacsha512256 = A6.Ha, g2._crypto_auth_hmacsha512256_verify = A6.Ia, g2._crypto_box_seedbytes = A6.Ja, g2._crypto_box_publickeybytes = A6.Ka, g2._crypto_box_secretkeybytes = A6.La, g2._crypto_box_beforenmbytes = A6.Ma, g2._crypto_box_noncebytes = A6.Na, g2._crypto_box_zerobytes = A6.Oa, g2._crypto_box_boxzerobytes = A6.Pa, g2._crypto_box_macbytes = A6.Qa, g2._crypto_box_messagebytes_max = A6.Ra, g2._crypto_box_primitive = A6.Sa, g2._crypto_box_seed_keypair = A6.Ta, g2._crypto_box_keypair = A6.Ua, g2._crypto_box_beforenm = A6.Va, g2._crypto_box_afternm = A6.Wa, g2._crypto_box_open_afternm = A6.Xa, g2._crypto_box = A6.Ya, g2._crypto_box_open = A6.Za, g2._crypto_box_detached_afternm = A6._a, g2._crypto_box_detached = A6.$a, g2._crypto_box_easy_afternm = A6.ab, g2._crypto_box_easy = A6.bb, g2._crypto_box_open_detached_afternm = A6.cb, g2._crypto_box_open_detached = A6.db, g2._crypto_box_open_easy_afternm = A6.eb, g2._crypto_box_open_easy = A6.fb, g2._crypto_box_seal = A6.gb, g2._crypto_box_seal_open = A6.hb, g2._crypto_box_sealbytes = A6.ib, g2._crypto_box_curve25519xsalsa20poly1305_seed_keypair = A6.jb, g2._crypto_box_curve25519xsalsa20poly1305_keypair = A6.kb, g2._crypto_box_curve25519xsalsa20poly1305_beforenm = A6.lb, g2._crypto_box_curve25519xsalsa20poly1305_afternm = A6.mb, g2._crypto_box_curve25519xsalsa20poly1305_open_afternm = A6.nb, g2._crypto_box_curve25519xsalsa20poly1305 = A6.ob, g2._crypto_box_curve25519xsalsa20poly1305_open = A6.pb, g2._crypto_box_curve25519xsalsa20poly1305_seedbytes = A6.qb, g2._crypto_box_curve25519xsalsa20poly1305_publickeybytes = A6.rb, g2._crypto_box_curve25519xsalsa20poly1305_secretkeybytes = A6.sb, g2._crypto_box_curve25519xsalsa20poly1305_beforenmbytes = A6.tb, g2._crypto_box_curve25519xsalsa20poly1305_noncebytes = A6.ub, g2._crypto_box_curve25519xsalsa20poly1305_zerobytes = A6.vb, g2._crypto_box_curve25519xsalsa20poly1305_boxzerobytes = A6.wb, g2._crypto_box_curve25519xsalsa20poly1305_macbytes = A6.xb, g2._crypto_box_curve25519xsalsa20poly1305_messagebytes_max = A6.yb, g2._crypto_core_hchacha20 = A6.zb, g2._crypto_core_hchacha20_outputbytes = A6.Ab, g2._crypto_core_hchacha20_inputbytes = A6.Bb, g2._crypto_core_hchacha20_keybytes = A6.Cb, g2._crypto_core_hchacha20_constbytes = A6.Db, g2._crypto_core_hsalsa20 = A6.Eb, g2._crypto_core_hsalsa20_outputbytes = A6.Fb, g2._crypto_core_hsalsa20_inputbytes = A6.Gb, g2._crypto_core_hsalsa20_keybytes = A6.Hb, g2._crypto_core_hsalsa20_constbytes = A6.Ib, g2._crypto_core_keccak1600_statebytes = A6.Jb, g2._crypto_core_keccak1600_init = A6.Kb, g2._crypto_core_keccak1600_xor_bytes = A6.Lb, g2._crypto_core_keccak1600_extract_bytes = A6.Mb, g2._crypto_core_keccak1600_permute_24 = A6.Nb, g2._crypto_core_keccak1600_permute_12 = A6.Ob, g2._crypto_core_salsa20 = A6.Pb, g2._crypto_core_salsa20_outputbytes = A6.Qb, g2._crypto_core_salsa20_inputbytes = A6.Rb, g2._crypto_core_salsa20_keybytes = A6.Sb, g2._crypto_core_salsa20_constbytes = A6.Tb, g2._crypto_core_salsa2012 = A6.Ub, g2._crypto_core_salsa2012_outputbytes = A6.Vb, g2._crypto_core_salsa2012_inputbytes = A6.Wb, g2._crypto_core_salsa2012_keybytes = A6.Xb, g2._crypto_core_salsa2012_constbytes = A6.Yb, g2._crypto_core_salsa208 = A6.Zb, g2._crypto_core_salsa208_outputbytes = A6._b, g2._crypto_core_salsa208_inputbytes = A6.$b, g2._crypto_core_salsa208_keybytes = A6.ac, g2._crypto_core_salsa208_constbytes = A6.bc, g2._crypto_generichash_bytes_min = A6.cc, g2._crypto_generichash_bytes_max = A6.dc, g2._crypto_generichash_bytes = A6.ec, g2._crypto_generichash_keybytes_min = A6.fc, g2._crypto_generichash_keybytes_max = A6.gc, g2._crypto_generichash_keybytes = A6.hc, g2._crypto_generichash_primitive = A6.ic, g2._crypto_generichash_statebytes = A6.jc, g2._crypto_generichash = A6.kc, g2._crypto_generichash_init = A6.lc, g2._crypto_generichash_update = A6.mc, g2._crypto_generichash_final = A6.nc, g2._crypto_generichash_keygen = A6.oc, g2._crypto_generichash_blake2b_bytes_min = A6.pc, g2._crypto_generichash_blake2b_bytes_max = A6.qc, g2._crypto_generichash_blake2b_bytes = A6.rc, g2._crypto_generichash_blake2b_keybytes_min = A6.sc, g2._crypto_generichash_blake2b_keybytes_max = A6.tc, g2._crypto_generichash_blake2b_keybytes = A6.uc, g2._crypto_generichash_blake2b_saltbytes = A6.vc, g2._crypto_generichash_blake2b_personalbytes = A6.wc, g2._crypto_generichash_blake2b_statebytes = A6.xc, g2._crypto_generichash_blake2b_keygen = A6.yc, g2._crypto_generichash_blake2b = A6.zc, g2._crypto_generichash_blake2b_salt_personal = A6.Ac, g2._crypto_generichash_blake2b_init = A6.Bc, g2._crypto_generichash_blake2b_init_salt_personal = A6.Cc, g2._crypto_generichash_blake2b_update = A6.Dc, g2._crypto_generichash_blake2b_final = A6.Ec, g2._crypto_hash_bytes = A6.Fc, g2._crypto_hash = A6.Gc, g2._crypto_hash_primitive = A6.Hc, g2._crypto_hash_sha256_bytes = A6.Ic, g2._crypto_hash_sha256_statebytes = A6.Jc, g2._crypto_hash_sha256_init = A6.Kc, g2._crypto_hash_sha256_update = A6.Lc, g2._crypto_hash_sha256_final = A6.Mc, g2._crypto_hash_sha256 = A6.Nc, g2._crypto_hash_sha512_bytes = A6.Oc, g2._crypto_hash_sha512_statebytes = A6.Pc, g2._crypto_hash_sha512_init = A6.Qc, g2._crypto_hash_sha512_update = A6.Rc, g2._crypto_hash_sha512_final = A6.Sc, g2._crypto_hash_sha512 = A6.Tc, g2._crypto_hash_sha3256_bytes = A6.Uc, g2._crypto_hash_sha3256_statebytes = A6.Vc, g2._crypto_hash_sha3256_init = A6.Wc, g2._crypto_hash_sha3256_update = A6.Xc, g2._crypto_hash_sha3256_final = A6.Yc, g2._crypto_hash_sha3256 = A6.Zc, g2._crypto_hash_sha3512_bytes = A6._c, g2._crypto_hash_sha3512_statebytes = A6.$c, g2._crypto_hash_sha3512_init = A6.ad, g2._crypto_hash_sha3512_update = A6.bd, g2._crypto_hash_sha3512_final = A6.cd, g2._crypto_hash_sha3512 = A6.dd, g2._crypto_ipcrypt_bytes = A6.ed, g2._crypto_ipcrypt_keybytes = A6.fd, g2._crypto_ipcrypt_nd_keybytes = A6.gd, g2._crypto_ipcrypt_nd_tweakbytes = A6.hd, g2._crypto_ipcrypt_nd_inputbytes = A6.id, g2._crypto_ipcrypt_nd_outputbytes = A6.jd, g2._crypto_ipcrypt_ndx_keybytes = A6.kd, g2._crypto_ipcrypt_ndx_tweakbytes = A6.ld, g2._crypto_ipcrypt_ndx_inputbytes = A6.md, g2._crypto_ipcrypt_ndx_outputbytes = A6.nd, g2._crypto_ipcrypt_pfx_keybytes = A6.od, g2._crypto_ipcrypt_pfx_bytes = A6.pd, g2._crypto_ipcrypt_keygen = A6.qd, g2._crypto_ipcrypt_nd_keygen = A6.rd, g2._crypto_ipcrypt_ndx_keygen = A6.sd, g2._crypto_ipcrypt_pfx_keygen = A6.td, g2._crypto_ipcrypt_encrypt = A6.ud, g2._crypto_ipcrypt_decrypt = A6.vd, g2._crypto_ipcrypt_nd_encrypt = A6.wd, g2._crypto_ipcrypt_nd_decrypt = A6.xd, g2._crypto_ipcrypt_ndx_encrypt = A6.yd, g2._crypto_ipcrypt_ndx_decrypt = A6.zd, g2._crypto_ipcrypt_pfx_encrypt = A6.Ad, g2._crypto_ipcrypt_pfx_decrypt = A6.Bd, g2._crypto_kdf_blake2b_bytes_min = A6.Cd, g2._crypto_kdf_blake2b_bytes_max = A6.Dd, g2._crypto_kdf_blake2b_contextbytes = A6.Ed, g2._crypto_kdf_blake2b_keybytes = A6.Fd, g2._crypto_kdf_blake2b_derive_from_key = A6.Gd, g2._crypto_kdf_primitive = A6.Hd, g2._crypto_kdf_bytes_min = A6.Id, g2._crypto_kdf_bytes_max = A6.Jd, g2._crypto_kdf_contextbytes = A6.Kd, g2._crypto_kdf_keybytes = A6.Ld, g2._crypto_kdf_derive_from_key = A6.Md, g2._crypto_kdf_keygen = A6.Nd, g2._crypto_kdf_hkdf_sha256_extract_init = A6.Od, g2._crypto_kdf_hkdf_sha256_extract_update = A6.Pd, g2._crypto_kdf_hkdf_sha256_extract_final = A6.Qd, g2._crypto_kdf_hkdf_sha256_extract = A6.Rd, g2._crypto_kdf_hkdf_sha256_keygen = A6.Sd, g2._crypto_kdf_hkdf_sha256_expand = A6.Td, g2._crypto_kdf_hkdf_sha256_keybytes = A6.Ud, g2._crypto_kdf_hkdf_sha256_bytes_min = A6.Vd, g2._crypto_kdf_hkdf_sha256_bytes_max = A6.Wd, g2._crypto_kdf_hkdf_sha256_statebytes = A6.Xd, g2._crypto_kdf_hkdf_sha512_extract_init = A6.Yd, g2._crypto_kdf_hkdf_sha512_extract_update = A6.Zd, g2._crypto_kdf_hkdf_sha512_extract_final = A6._d, g2._crypto_kdf_hkdf_sha512_extract = A6.$d, g2._crypto_kdf_hkdf_sha512_keygen = A6.ae, g2._crypto_kdf_hkdf_sha512_expand = A6.be, g2._crypto_kdf_hkdf_sha512_keybytes = A6.ce, g2._crypto_kdf_hkdf_sha512_bytes_min = A6.de, g2._crypto_kdf_hkdf_sha512_bytes_max = A6.ee, g2._crypto_kdf_hkdf_sha512_statebytes = A6.fe, g2._crypto_kem_publickeybytes = A6.ge, g2._crypto_kem_secretkeybytes = A6.he, g2._crypto_kem_ciphertextbytes = A6.ie, g2._crypto_kem_sharedsecretbytes = A6.je, g2._crypto_kem_seedbytes = A6.ke, g2._crypto_kem_primitive = A6.le, g2._crypto_kem_seed_keypair = A6.me, g2._crypto_kem_keypair = A6.ne, g2._crypto_kem_enc = A6.oe, g2._crypto_kem_dec = A6.pe, g2._crypto_kem_mlkem768_publickeybytes = A6.qe, g2._crypto_kem_mlkem768_secretkeybytes = A6.re, g2._crypto_kem_mlkem768_ciphertextbytes = A6.se, g2._crypto_kem_mlkem768_sharedsecretbytes = A6.te, g2._crypto_kem_mlkem768_seedbytes = A6.ue, g2._crypto_kem_mlkem768_seed_keypair = A6.ve, g2._crypto_kem_mlkem768_keypair = A6.we, g2._crypto_kem_mlkem768_enc = A6.xe, g2._crypto_kem_mlkem768_enc_deterministic = A6.ye, g2._crypto_kem_mlkem768_dec = A6.ze, g2._crypto_kem_xwing_publickeybytes = A6.Ae, g2._crypto_kem_xwing_secretkeybytes = A6.Be, g2._crypto_kem_xwing_ciphertextbytes = A6.Ce, g2._crypto_kem_xwing_sharedsecretbytes = A6.De, g2._crypto_kem_xwing_seedbytes = A6.Ee, g2._crypto_kem_xwing_seed_keypair = A6.Fe, g2._crypto_kem_xwing_keypair = A6.Ge, g2._crypto_kem_xwing_enc_deterministic = A6.He, g2._crypto_kem_xwing_enc = A6.Ie, g2._crypto_kem_xwing_dec = A6.Je, g2._crypto_kx_seed_keypair = A6.Ke, g2._crypto_kx_keypair = A6.Le, g2._crypto_kx_client_session_keys = A6.Me, g2._crypto_kx_server_session_keys = A6.Ne, g2._crypto_kx_publickeybytes = A6.Oe, g2._crypto_kx_secretkeybytes = A6.Pe, g2._crypto_kx_seedbytes = A6.Qe, g2._crypto_kx_sessionkeybytes = A6.Re, g2._crypto_kx_primitive = A6.Se, g2._crypto_onetimeauth_statebytes = A6.Te, g2._crypto_onetimeauth_bytes = A6.Ue, g2._crypto_onetimeauth_keybytes = A6.Ve, g2._crypto_onetimeauth = A6.We, g2._crypto_onetimeauth_verify = A6.Xe, g2._crypto_onetimeauth_init = A6.Ye, g2._crypto_onetimeauth_update = A6.Ze, g2._crypto_onetimeauth_final = A6._e, g2._crypto_onetimeauth_primitive = A6.$e, g2._crypto_onetimeauth_keygen = A6.af, g2._crypto_onetimeauth_poly1305 = A6.bf, g2._crypto_onetimeauth_poly1305_verify = A6.cf, g2._crypto_onetimeauth_poly1305_init = A6.df, g2._crypto_onetimeauth_poly1305_update = A6.ef, g2._crypto_onetimeauth_poly1305_final = A6.ff, g2._crypto_onetimeauth_poly1305_bytes = A6.gf, g2._crypto_onetimeauth_poly1305_keybytes = A6.hf, g2._crypto_onetimeauth_poly1305_statebytes = A6.jf, g2._crypto_onetimeauth_poly1305_keygen = A6.kf, g2._crypto_pwhash_argon2i_alg_argon2i13 = A6.lf, g2._crypto_pwhash_argon2i_bytes_min = A6.mf, g2._crypto_pwhash_argon2i_bytes_max = A6.nf, g2._crypto_pwhash_argon2i_passwd_min = A6.of, g2._crypto_pwhash_argon2i_passwd_max = A6.pf, g2._crypto_pwhash_argon2i_saltbytes = A6.qf, g2._crypto_pwhash_argon2i_strbytes = A6.rf, g2._crypto_pwhash_argon2i_strprefix = A6.sf, g2._crypto_pwhash_argon2i_opslimit_min = A6.tf, g2._crypto_pwhash_argon2i_opslimit_max = A6.uf, g2._crypto_pwhash_argon2i_memlimit_min = A6.vf, g2._crypto_pwhash_argon2i_memlimit_max = A6.wf, g2._crypto_pwhash_argon2i_opslimit_interactive = A6.xf, g2._crypto_pwhash_argon2i_memlimit_interactive = A6.yf, g2._crypto_pwhash_argon2i_opslimit_moderate = A6.zf, g2._crypto_pwhash_argon2i_memlimit_moderate = A6.Af, g2._crypto_pwhash_argon2i_opslimit_sensitive = A6.Bf, g2._crypto_pwhash_argon2i_memlimit_sensitive = A6.Cf, g2._crypto_pwhash_argon2i = A6.Df, g2._crypto_pwhash_argon2i_str = A6.Ef, g2._crypto_pwhash_argon2i_str_verify = A6.Ff, g2._crypto_pwhash_argon2i_str_needs_rehash = A6.Gf, g2._crypto_pwhash_argon2id_str_needs_rehash = A6.Hf, g2._crypto_pwhash_argon2id_alg_argon2id13 = A6.If, g2._crypto_pwhash_argon2id_bytes_min = A6.Jf, g2._crypto_pwhash_argon2id_bytes_max = A6.Kf, g2._crypto_pwhash_argon2id_passwd_min = A6.Lf, g2._crypto_pwhash_argon2id_passwd_max = A6.Mf, g2._crypto_pwhash_argon2id_saltbytes = A6.Nf, g2._crypto_pwhash_argon2id_strbytes = A6.Of, g2._crypto_pwhash_argon2id_strprefix = A6.Pf, g2._crypto_pwhash_argon2id_opslimit_min = A6.Qf, g2._crypto_pwhash_argon2id_opslimit_max = A6.Rf, g2._crypto_pwhash_argon2id_memlimit_min = A6.Sf, g2._crypto_pwhash_argon2id_memlimit_max = A6.Tf, g2._crypto_pwhash_argon2id_opslimit_interactive = A6.Uf, g2._crypto_pwhash_argon2id_memlimit_interactive = A6.Vf, g2._crypto_pwhash_argon2id_opslimit_moderate = A6.Wf, g2._crypto_pwhash_argon2id_memlimit_moderate = A6.Xf, g2._crypto_pwhash_argon2id_opslimit_sensitive = A6.Yf, g2._crypto_pwhash_argon2id_memlimit_sensitive = A6.Zf, g2._crypto_pwhash_argon2id = A6._f, g2._crypto_pwhash_argon2id_str = A6.$f, g2._crypto_pwhash_argon2id_str_verify = A6.ag, g2._crypto_pwhash_alg_argon2i13 = A6.bg, g2._crypto_pwhash_alg_argon2id13 = A6.cg, g2._crypto_pwhash_alg_default = A6.dg, g2._crypto_pwhash_bytes_min = A6.eg, g2._crypto_pwhash_bytes_max = A6.fg, g2._crypto_pwhash_passwd_min = A6.gg, g2._crypto_pwhash_passwd_max = A6.hg, g2._crypto_pwhash_saltbytes = A6.ig, g2._crypto_pwhash_strbytes = A6.jg, g2._crypto_pwhash_strprefix = A6.kg, g2._crypto_pwhash_opslimit_min = A6.lg, g2._crypto_pwhash_opslimit_max = A6.mg, g2._crypto_pwhash_memlimit_min = A6.ng, g2._crypto_pwhash_memlimit_max = A6.og, g2._crypto_pwhash_opslimit_interactive = A6.pg, g2._crypto_pwhash_memlimit_interactive = A6.qg, g2._crypto_pwhash_opslimit_moderate = A6.rg, g2._crypto_pwhash_memlimit_moderate = A6.sg, g2._crypto_pwhash_opslimit_sensitive = A6.tg, g2._crypto_pwhash_memlimit_sensitive = A6.ug, g2._crypto_pwhash = A6.vg, g2._crypto_pwhash_str = A6.wg, g2._crypto_pwhash_str_alg = A6.xg, g2._crypto_pwhash_str_verify = A6.yg, g2._crypto_pwhash_str_needs_rehash = A6.zg, g2._crypto_pwhash_primitive = A6.Ag, g2._crypto_scalarmult_primitive = A6.Bg, g2._crypto_scalarmult_base = A6.Cg, g2._crypto_scalarmult = A6.Dg, g2._crypto_scalarmult_bytes = A6.Eg, g2._crypto_scalarmult_scalarbytes = A6.Fg, g2._crypto_scalarmult_curve25519 = A6.Gg, g2._crypto_scalarmult_curve25519_base = A6.Hg, g2._crypto_scalarmult_curve25519_bytes = A6.Ig, g2._crypto_scalarmult_curve25519_scalarbytes = A6.Jg, g2._crypto_secretbox_keybytes = A6.Kg, g2._crypto_secretbox_noncebytes = A6.Lg, g2._crypto_secretbox_zerobytes = A6.Mg, g2._crypto_secretbox_boxzerobytes = A6.Ng, g2._crypto_secretbox_macbytes = A6.Og, g2._crypto_secretbox_messagebytes_max = A6.Pg, g2._crypto_secretbox_primitive = A6.Qg, g2._crypto_secretbox = A6.Rg, g2._crypto_secretbox_open = A6.Sg, g2._crypto_secretbox_keygen = A6.Tg, g2._crypto_secretbox_detached = A6.Ug, g2._crypto_secretbox_easy = A6.Vg, g2._crypto_secretbox_open_detached = A6.Wg, g2._crypto_secretbox_open_easy = A6.Xg, g2._crypto_secretbox_xsalsa20poly1305 = A6.Yg, g2._crypto_secretbox_xsalsa20poly1305_open = A6.Zg, g2._crypto_secretbox_xsalsa20poly1305_keybytes = A6._g, g2._crypto_secretbox_xsalsa20poly1305_noncebytes = A6.$g, g2._crypto_secretbox_xsalsa20poly1305_zerobytes = A6.ah, g2._crypto_secretbox_xsalsa20poly1305_boxzerobytes = A6.bh, g2._crypto_secretbox_xsalsa20poly1305_macbytes = A6.ch, g2._crypto_secretbox_xsalsa20poly1305_messagebytes_max = A6.dh, g2._crypto_secretbox_xsalsa20poly1305_keygen = A6.eh, g2._crypto_secretstream_xchacha20poly1305_keygen = A6.fh, g2._crypto_secretstream_xchacha20poly1305_init_push = A6.gh, g2._crypto_secretstream_xchacha20poly1305_init_pull = A6.hh, g2._crypto_secretstream_xchacha20poly1305_rekey = A6.ih, g2._crypto_secretstream_xchacha20poly1305_push = A6.jh, g2._crypto_secretstream_xchacha20poly1305_pull = A6.kh, g2._crypto_secretstream_xchacha20poly1305_statebytes = A6.lh, g2._crypto_secretstream_xchacha20poly1305_abytes = A6.mh, g2._crypto_secretstream_xchacha20poly1305_headerbytes = A6.nh, g2._crypto_secretstream_xchacha20poly1305_keybytes = A6.oh, g2._crypto_secretstream_xchacha20poly1305_messagebytes_max = A6.ph, g2._crypto_secretstream_xchacha20poly1305_tag_message = A6.qh, g2._crypto_secretstream_xchacha20poly1305_tag_push = A6.rh, g2._crypto_secretstream_xchacha20poly1305_tag_rekey = A6.sh, g2._crypto_secretstream_xchacha20poly1305_tag_final = A6.th, g2._crypto_shorthash_bytes = A6.uh, g2._crypto_shorthash_keybytes = A6.vh, g2._crypto_shorthash_primitive = A6.wh, g2._crypto_shorthash = A6.xh, g2._crypto_shorthash_keygen = A6.yh, g2._crypto_shorthash_siphash24_bytes = A6.zh, g2._crypto_shorthash_siphash24_keybytes = A6.Ah, g2._crypto_shorthash_siphash24 = A6.Bh, g2._crypto_sign_statebytes = A6.Ch, g2._crypto_sign_bytes = A6.Dh, g2._crypto_sign_seedbytes = A6.Eh, g2._crypto_sign_publickeybytes = A6.Fh, g2._crypto_sign_secretkeybytes = A6.Gh, g2._crypto_sign_messagebytes_max = A6.Hh, g2._crypto_sign_primitive = A6.Ih, g2._crypto_sign_seed_keypair = A6.Jh, g2._crypto_sign_keypair = A6.Kh, g2._crypto_sign = A6.Lh, g2._crypto_sign_open = A6.Mh, g2._crypto_sign_detached = A6.Nh, g2._crypto_sign_verify_detached = A6.Oh, g2._crypto_sign_init = A6.Ph, g2._crypto_sign_update = A6.Qh, g2._crypto_sign_final_create = A6.Rh, g2._crypto_sign_final_verify = A6.Sh, g2._crypto_sign_ed25519ph_statebytes = A6.Th, g2._crypto_sign_ed25519_bytes = A6.Uh, g2._crypto_sign_ed25519_seedbytes = A6.Vh, g2._crypto_sign_ed25519_publickeybytes = A6.Wh, g2._crypto_sign_ed25519_secretkeybytes = A6.Xh, g2._crypto_sign_ed25519_messagebytes_max = A6.Yh, g2._crypto_sign_ed25519_sk_to_seed = A6.Zh, g2._crypto_sign_ed25519_sk_to_pk = A6._h, g2._crypto_sign_ed25519ph_init = A6.$h, g2._crypto_sign_ed25519ph_update = A6.ai, g2._crypto_sign_ed25519ph_final_create = A6.bi, g2._crypto_sign_ed25519ph_final_verify = A6.ci, g2._crypto_sign_ed25519_seed_keypair = A6.di, g2._crypto_sign_ed25519_keypair = A6.ei, g2._crypto_sign_ed25519_pk_to_curve25519 = A6.fi, g2._crypto_sign_ed25519_sk_to_curve25519 = A6.gi, g2._crypto_sign_ed25519_verify_detached = A6.hi, g2._crypto_sign_ed25519_open = A6.ii, g2._crypto_sign_ed25519_detached = A6.ji, g2._crypto_sign_ed25519 = A6.ki, g2._crypto_stream_chacha20_keybytes = A6.li, g2._crypto_stream_chacha20_noncebytes = A6.mi, g2._crypto_stream_chacha20_messagebytes_max = A6.ni, g2._crypto_stream_chacha20_ietf_keybytes = A6.oi, g2._crypto_stream_chacha20_ietf_noncebytes = A6.pi, g2._crypto_stream_chacha20_ietf_messagebytes_max = A6.qi, g2._crypto_stream_chacha20 = A6.ri, g2._crypto_stream_chacha20_xor_ic = A6.si, g2._crypto_stream_chacha20_xor = A6.ti, g2._crypto_stream_chacha20_ietf = A6.ui, g2._crypto_stream_chacha20_ietf_xor_ic = A6.vi, g2._crypto_stream_chacha20_ietf_xor = A6.wi, g2._crypto_stream_chacha20_ietf_keygen = A6.xi, g2._crypto_stream_chacha20_keygen = A6.yi, g2._crypto_stream_keybytes = A6.zi, g2._crypto_stream_noncebytes = A6.Ai, g2._crypto_stream_messagebytes_max = A6.Bi, g2._crypto_stream_primitive = A6.Ci, g2._crypto_stream = A6.Di, g2._crypto_stream_xor = A6.Ei, g2._crypto_stream_keygen = A6.Fi, g2._crypto_stream_salsa20_keybytes = A6.Gi, g2._crypto_stream_salsa20_noncebytes = A6.Hi, g2._crypto_stream_salsa20_messagebytes_max = A6.Ii, g2._crypto_stream_salsa20 = A6.Ji, g2._crypto_stream_salsa20_xor_ic = A6.Ki, g2._crypto_stream_salsa20_xor = A6.Li, g2._crypto_stream_salsa20_keygen = A6.Mi, g2._crypto_stream_xsalsa20 = A6.Ni, g2._crypto_stream_xsalsa20_xor_ic = A6.Oi, g2._crypto_stream_xsalsa20_xor = A6.Pi, g2._crypto_stream_xsalsa20_keybytes = A6.Qi, g2._crypto_stream_xsalsa20_noncebytes = A6.Ri, g2._crypto_stream_xsalsa20_messagebytes_max = A6.Si, g2._crypto_stream_xsalsa20_keygen = A6.Ti, g2._crypto_verify_16_bytes = A6.Ui, g2._crypto_verify_32_bytes = A6.Vi, g2._crypto_verify_64_bytes = A6.Wi, g2._crypto_verify_16 = A6.Xi, g2._crypto_verify_32 = A6.Yi, g2._crypto_verify_64 = A6.Zi, g2._crypto_xof_shake128_blockbytes = A6._i, g2._crypto_xof_shake128_statebytes = A6.$i, g2._crypto_xof_shake128_domain_standard = A6.aj, g2._crypto_xof_shake128 = A6.bj, g2._crypto_xof_shake128_init = A6.cj, g2._crypto_xof_shake128_init_with_domain = A6.dj, g2._crypto_xof_shake128_update = A6.ej, g2._crypto_xof_shake128_squeeze = A6.fj, g2._crypto_xof_shake256_blockbytes = A6.gj, g2._crypto_xof_shake256_statebytes = A6.hj, g2._crypto_xof_shake256_domain_standard = A6.ij, g2._crypto_xof_shake256 = A6.jj, g2._crypto_xof_shake256_init = A6.kj, g2._crypto_xof_shake256_init_with_domain = A6.lj, g2._crypto_xof_shake256_update = A6.mj, g2._crypto_xof_shake256_squeeze = A6.nj, g2._crypto_xof_turboshake128_blockbytes = A6.oj, g2._crypto_xof_turboshake128_statebytes = A6.pj, g2._crypto_xof_turboshake128_domain_standard = A6.qj, g2._crypto_xof_turboshake128 = A6.rj, g2._crypto_xof_turboshake128_init = A6.sj, g2._crypto_xof_turboshake128_init_with_domain = A6.tj, g2._crypto_xof_turboshake128_update = A6.uj, g2._crypto_xof_turboshake128_squeeze = A6.vj, g2._crypto_xof_turboshake256_blockbytes = A6.wj, g2._crypto_xof_turboshake256_statebytes = A6.xj, g2._crypto_xof_turboshake256_domain_standard = A6.yj, g2._crypto_xof_turboshake256 = A6.zj, g2._crypto_xof_turboshake256_init = A6.Aj, g2._crypto_xof_turboshake256_init_with_domain = A6.Bj, g2._crypto_xof_turboshake256_update = A6.Cj, g2._crypto_xof_turboshake256_squeeze = A6.Dj, g2._randombytes_implementation_name = A6.Ej, g2._randombytes_random = A6.Fj, g2._randombytes_stir = A6.Gj, g2._randombytes_uniform = A6.Hj, g2._randombytes_buf = A6.Ij, g2._randombytes_buf_deterministic = A6.Jj, g2._randombytes_seedbytes = A6.Kj, g2._randombytes_close = A6.Lj, g2._randombytes = A6.Mj, g2._sodium_bin2hex = A6.Nj, g2._sodium_hex2bin = A6.Oj, g2._sodium_base64_encoded_len = A6.Pj, g2._sodium_bin2base64 = A6.Qj, g2._sodium_base642bin = A6.Rj, g2._sodium_ip2bin = A6.Sj, g2._sodium_bin2ip = A6.Tj, g2._sodium_init = A6.Uj, g2._sodium_pad = A6.Vj, g2._sodium_unpad = A6.Wj, g2._sodium_version_string = A6.Xj, g2._sodium_library_version_major = A6.Yj, g2._sodium_library_version_minor = A6.Zj, g2._sodium_library_minimal = A6._j, g2._crypto_box_curve25519xchacha20poly1305_seed_keypair = A6.$j, g2._crypto_box_curve25519xchacha20poly1305_keypair = A6.ak, g2._crypto_box_curve25519xchacha20poly1305_beforenm = A6.bk, g2._crypto_box_curve25519xchacha20poly1305_detached_afternm = A6.ck, g2._crypto_box_curve25519xchacha20poly1305_detached = A6.dk, g2._crypto_box_curve25519xchacha20poly1305_easy_afternm = A6.ek, g2._crypto_box_curve25519xchacha20poly1305_easy = A6.fk, g2._crypto_box_curve25519xchacha20poly1305_open_detached_afternm = A6.gk, g2._crypto_box_curve25519xchacha20poly1305_open_detached = A6.hk, g2._crypto_box_curve25519xchacha20poly1305_open_easy_afternm = A6.ik, g2._crypto_box_curve25519xchacha20poly1305_open_easy = A6.jk, g2._crypto_box_curve25519xchacha20poly1305_seedbytes = A6.kk, g2._crypto_box_curve25519xchacha20poly1305_publickeybytes = A6.lk, g2._crypto_box_curve25519xchacha20poly1305_secretkeybytes = A6.mk, g2._crypto_box_curve25519xchacha20poly1305_beforenmbytes = A6.nk, g2._crypto_box_curve25519xchacha20poly1305_noncebytes = A6.ok, g2._crypto_box_curve25519xchacha20poly1305_macbytes = A6.pk, g2._crypto_box_curve25519xchacha20poly1305_messagebytes_max = A6.qk, g2._crypto_box_curve25519xchacha20poly1305_seal = A6.rk, g2._crypto_box_curve25519xchacha20poly1305_seal_open = A6.sk, g2._crypto_box_curve25519xchacha20poly1305_sealbytes = A6.tk, g2._crypto_core_ed25519_is_valid_point = A6.uk, g2._crypto_core_ed25519_add = A6.vk, g2._crypto_core_ed25519_sub = A6.wk, g2._crypto_core_ed25519_from_uniform = A6.xk, g2._crypto_core_ed25519_from_hash = A6.yk, g2._crypto_core_ed25519_random = A6.zk, g2._crypto_core_ed25519_scalar_random = A6.Ak, g2._crypto_core_ed25519_scalar_invert = A6.Bk, g2._crypto_core_ed25519_scalar_negate = A6.Ck, g2._crypto_core_ed25519_scalar_complement = A6.Dk, g2._crypto_core_ed25519_scalar_add = A6.Ek, g2._crypto_core_ed25519_scalar_reduce = A6.Fk, g2._crypto_core_ed25519_scalar_sub = A6.Gk, g2._crypto_core_ed25519_scalar_mul = A6.Hk, g2._crypto_core_ed25519_bytes = A6.Ik, g2._crypto_core_ed25519_nonreducedscalarbytes = A6.Jk, g2._crypto_core_ed25519_uniformbytes = A6.Kk, g2._crypto_core_ed25519_hashbytes = A6.Lk, g2._crypto_core_ed25519_scalarbytes = A6.Mk, g2._crypto_core_ristretto255_is_valid_point = A6.Nk, g2._crypto_core_ristretto255_add = A6.Ok, g2._crypto_core_ristretto255_sub = A6.Pk, g2._crypto_core_ristretto255_from_hash = A6.Qk, g2._crypto_core_ristretto255_random = A6.Rk, g2._crypto_core_ristretto255_scalar_random = A6.Sk, g2._crypto_core_ristretto255_scalar_invert = A6.Tk, g2._crypto_core_ristretto255_scalar_negate = A6.Uk, g2._crypto_core_ristretto255_scalar_complement = A6.Vk, g2._crypto_core_ristretto255_scalar_add = A6.Wk, g2._crypto_core_ristretto255_scalar_sub = A6.Xk, g2._crypto_core_ristretto255_scalar_mul = A6.Yk, g2._crypto_core_ristretto255_scalar_reduce = A6.Zk, g2._crypto_core_ristretto255_bytes = A6._k, g2._crypto_core_ristretto255_nonreducedscalarbytes = A6.$k, g2._crypto_core_ristretto255_hashbytes = A6.al, g2._crypto_core_ristretto255_scalarbytes = A6.bl, g2._crypto_pwhash_scryptsalsa208sha256_ll = A6.cl, g2._crypto_pwhash_scryptsalsa208sha256_bytes_min = A6.dl, g2._crypto_pwhash_scryptsalsa208sha256_bytes_max = A6.el, g2._crypto_pwhash_scryptsalsa208sha256_passwd_min = A6.fl, g2._crypto_pwhash_scryptsalsa208sha256_passwd_max = A6.gl, g2._crypto_pwhash_scryptsalsa208sha256_saltbytes = A6.hl, g2._crypto_pwhash_scryptsalsa208sha256_strbytes = A6.il, g2._crypto_pwhash_scryptsalsa208sha256_strprefix = A6.jl, g2._crypto_pwhash_scryptsalsa208sha256_opslimit_min = A6.kl, g2._crypto_pwhash_scryptsalsa208sha256_opslimit_max = A6.ll, g2._crypto_pwhash_scryptsalsa208sha256_memlimit_min = A6.ml, g2._crypto_pwhash_scryptsalsa208sha256_memlimit_max = A6.nl, g2._crypto_pwhash_scryptsalsa208sha256_opslimit_interactive = A6.ol, g2._crypto_pwhash_scryptsalsa208sha256_memlimit_interactive = A6.pl, g2._crypto_pwhash_scryptsalsa208sha256_opslimit_sensitive = A6.ql, g2._crypto_pwhash_scryptsalsa208sha256_memlimit_sensitive = A6.rl, g2._crypto_pwhash_scryptsalsa208sha256 = A6.sl, g2._crypto_pwhash_scryptsalsa208sha256_str = A6.tl, g2._crypto_pwhash_scryptsalsa208sha256_str_verify = A6.ul, g2._crypto_pwhash_scryptsalsa208sha256_str_needs_rehash = A6.vl, g2._crypto_scalarmult_ed25519 = A6.wl, g2._crypto_scalarmult_ed25519_noclamp = A6.xl, g2._crypto_scalarmult_ed25519_base = A6.yl, g2._crypto_scalarmult_ed25519_base_noclamp = A6.zl, g2._crypto_scalarmult_ed25519_bytes = A6.Al, g2._crypto_scalarmult_ed25519_scalarbytes = A6.Bl, g2._crypto_scalarmult_ristretto255 = A6.Cl, g2._crypto_scalarmult_ristretto255_base = A6.Dl, g2._crypto_scalarmult_ristretto255_bytes = A6.El, g2._crypto_scalarmult_ristretto255_scalarbytes = A6.Fl, g2._crypto_secretbox_xchacha20poly1305_detached = A6.Gl, g2._crypto_secretbox_xchacha20poly1305_easy = A6.Hl, g2._crypto_secretbox_xchacha20poly1305_open_detached = A6.Il, g2._crypto_secretbox_xchacha20poly1305_open_easy = A6.Jl, g2._crypto_secretbox_xchacha20poly1305_keybytes = A6.Kl, g2._crypto_secretbox_xchacha20poly1305_noncebytes = A6.Ll, g2._crypto_secretbox_xchacha20poly1305_macbytes = A6.Ml, g2._crypto_secretbox_xchacha20poly1305_messagebytes_max = A6.Nl, g2._crypto_shorthash_siphashx24_bytes = A6.Ol, g2._crypto_shorthash_siphashx24_keybytes = A6.Pl, g2._crypto_shorthash_siphashx24 = A6.Ql, g2._crypto_sign_edwards25519sha512batch_keypair = A6.Rl, g2._crypto_sign_edwards25519sha512batch = A6.Sl, g2._crypto_sign_edwards25519sha512batch_open = A6.Tl, g2._crypto_stream_salsa2012 = A6.Ul, g2._crypto_stream_salsa2012_xor = A6.Vl, g2._crypto_stream_salsa2012_keybytes = A6.Wl, g2._crypto_stream_salsa2012_noncebytes = A6.Xl, g2._crypto_stream_salsa2012_messagebytes_max = A6.Yl, g2._crypto_stream_salsa2012_keygen = A6.Zl, g2._crypto_stream_salsa208 = A6._l, g2._crypto_stream_salsa208_xor = A6.$l, g2._crypto_stream_salsa208_keybytes = A6.am, g2._crypto_stream_salsa208_noncebytes = A6.bm, g2._crypto_stream_salsa208_messagebytes_max = A6.cm, g2._crypto_stream_salsa208_keygen = A6.dm, g2._crypto_stream_xchacha20_keybytes = A6.em, g2._crypto_stream_xchacha20_noncebytes = A6.fm, g2._crypto_stream_xchacha20_messagebytes_max = A6.gm, g2._crypto_stream_xchacha20 = A6.hm, g2._crypto_stream_xchacha20_xor_ic = A6.im, g2._crypto_stream_xchacha20_xor = A6.jm, g2._crypto_stream_xchacha20_keygen = A6.km, g2._malloc = A6.lm, g2._free = A6.mm, A6.dynCall_iiiji, A6.dynCall_iiij, A6.dynCall_iijii, A6.dynCall_iiijiji, A6.dynCall_iiijiii, e = A6.e, A6.__indirect_function_table;
      })(_2 = A5.exports), N2(), _2;
    }
    var C3 = { a: q2 };
    return g2.instantiateWasm ? new Promise((I3, B3) => {
      g2.instantiateWasm(C3, (g3, C4) => {
        I3(A4(g3));
      });
    }) : (o2 ??= ((A5) => {
      for (var I3, g3, C4 = 0, B3 = 0, Q3 = 379996, E3 = new Uint8Array(284997 - ("=" == A5[379994]) - ("=" == A5[379995])); C4 < Q3; C4 += 4, B3 += 3) I3 = R2[A5.charCodeAt(C4 + 1)], g3 = R2[A5.charCodeAt(C4 + 2)], E3[B3] = R2[A5.charCodeAt(C4)] << 2 | I3 >> 4, E3[B3 + 1] = I3 << 4 | g3 >> 2, E3[B3 + 2] = g3 << 6 | R2[A5.charCodeAt(C4 + 3)];
      return E3;
    })("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aQDkAQJmaQDNAwJnaQDMAwJoaQC0AQJpaQC2AQJqaQC1AQJraQC3AQJsaQAJAm1pACkCbmkAGQJvaQAJAnBpAJcCAnFpABkCcmkA0gICc2kA0QICdGkA0AICdWkAzwICdmkAzgICd2kAzQICeGkAEQJ5aQARAnppAAkCQWkAKAJCaQAZAkNpAM4DAkRpALMBAkVpALIBAkZpABECR2kACQJIaQApAklpABkCSmkAzAICS2kAywICTGkAygICTWkAEQJOaQCzAQJPaQDJAgJQaQCyAQJRaQAJAlJpACgCU2kAGQJUaQARAlVpAAoCVmkACQJXaQAUAlhpAEcCWWkARgJaaQDjAQJfaQCHAgIkaQA8AmFqAHUCYmoAyAICY2oAcwJkagByAmVqAMcCAmZqAOkDAmdqAIkCAmhqADwCaWoAdQJqagDGAgJragBzAmxqAHICbWoAxQICbmoA7AMCb2oAhwICcGoAPAJxagB1AnJqAMQCAnNqAHMCdGoAcgJ1agDDAgJ2agCQAwJ3agCJAgJ4agA8AnlqAHUCemoAwgICQWoAcwJCagByAkNqAMECAkRqAM8DAkVqAJ8EAkZqAJkEAkdqAJUCAkhqAJgEAklqABYCSmoAlwQCS2oACQJMagCWBAJNagDAAgJOagDbAwJPagDaAwJQagDZAwJRagCWAQJSagCVAQJTagDYAwJUagDXAwJVagClBAJWagCgBAJXagCaBAJYagCIAwJZagCHAwJaagBpAl9qACECJGoAjwECYWsATAJiawDQAwJjawCxAQJkawC/AgJlawC+AgJmawC9AgJnawCwAQJoawC8AgJpawCvAQJqawC7AgJrawAJAmxrAAkCbWsACQJuawAJAm9rACgCcGsACgJxawA3AnJrALoCAnNrALkCAnRrAN0BAnVrAI8EAnZrAI4EAndrAI0EAnhrAIwEAnlrAIsEAnprAIoEAkFrAJMCAkJrAJICAkNrAJECAkRrAJACAkVrAI8CAkZrAI4CAkdrAI0CAkhrAIwCAklrAAkCSmsAFAJLawAJAkxrABQCTWsACQJOawCJBAJPawCIBAJQawCHBAJRawCGBAJSawCFBAJTawCEBAJUawCDBAJVawCCBAJWawCBBAJXawCABAJYawD/AwJZawCMAgJaawD+AwJfawAJAiRrABQCYWwAFAJibAAJAmNs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fnwgCiAPfnwgEiAefnwgBiAffnwgDiAafnwgByAMfnwgBCAbfnwgBSAIfnwgKkETbKwgGH4gAyAJfnwgCiAhfnwgDyAZfnwgBiASfnwgFCAffnwgByAOfnwgDCAVfnwgBCAIfnwgBSAXfnwiIUKAgIAQfCImQhqHfCInQoCAgAh8IihCGYd8Ig8gD0KAgIAQfCIpQoCAgOAPg30+AgggACAGIAt+IAMgHn58IA0gGn58IAcgEH58IBEgG358IAggFn58IBwgIH58IAkgM6wiD358IAQgHX58IAUgCn58IBNCGod8IhMgE0KAgIAIfCITQoCAgPAPg30+AhwgACAIIAt+IAMgG358IA0gHH58IAkgEH58IBIgHX58IAogH358IA4gHn58IAYgDH58IAQgGn58IAUgB358IClCGod8IgQgBEKAgIAIfCIEQoCAgPAPg30+AgwgACALIBl+IAMgCn58IAYgDX58IBAgFH58IAcgEX58IBUgFn58IAggIH58IA8gF358IAkgNawiDH58IAUgGH58IBNCGYd8IgUgBUKAgIAQfCIFQoCAgOAPg30+AiAgACAkICVCgICA8A+DfSAiICNCgICAYIN9IARCGYd8IgRCgICAEHwiDkIaiHw+AhQgACAEIA5CgICA4A+DfT4CECAAIAogC34gAyAdfnwgDSAefnwgBiAQfnwgESAafnwgByAWfnwgGyAgfnwgCCAPfnwgDCAcfnwgCSACrH58IAVCGod8IgMgA0KAgIAIfCIDQoCAgPAPg30+AiQgACAnIChCgICA8A+DfSAhICZCgICAYIN9IANCGYdCE358IgNCgICAEHwiBkIaiHw+AgQgACADIAZCgICA4A+DfT4CAAvgAgEDfyAAIAIoAgAgASgCDCIDQRZ2QfwHcUHApAJqKAIAIAEoAggiBEEOdkH8B3FBwJwCaigCACABKAIEIgVBBnZB/AdxQcCUAmooAgAgASgCACIBQf8BcUECdEHAjAJqKAIAc3NzczYCACAAIAIoAgQgAUEWdkH8B3FBwKQCaigCACADQQ52QfwHcUHAnAJqKAIAIARBBnZB/AdxQcCUAmooAgAgBUH/AXFBAnRBwIwCaigCAHNzc3M2AgQgACACKAIIIAVBFnZB/AdxQcCkAmooAgAgAUEOdkH8B3FBwJwCaigCACADQQZ2QfwHcUHAlAJqKAIAIARB/wFxQQJ0QcCMAmooAgBzc3NzNgIIIAAgAigCDCAEQRZ2QfwHcUHApAJqKAIAIAVBDnZB/AdxQcCcAmooAgAgAUEGdkH8B3FBwJQCaigCACADQf8BcUECdEHAjAJqKAIAc3NzczYCDAvWAgEBfwJAIAFFDQAgAEEAOgAAIAAgAWoiAkEBa0EAOgAAIAFBA0kNACAAQQA6AAIgAEEAOgABIAJBA2tBADoAACACQQJrQQA6AAAgAUEHSQ0AIABBADoAAyACQQRrQQA6AAAgAUEJSQ0AIABBACAAa0EDcSICaiIAQQA2AgAgACABIAJrQXxxIgJqIgFBBGtBADYCACACQQlJDQAgAEEANgIIIABBADYCBCABQQhrQQA2AgAgAUEMa0EANgIAIAJBGUkNACAAQQA2AhggAEEANgIUIABBADYCECAAQQA2AgwgAUEQa0EANgIAIAFBFGtBADYCACABQRhrQQA2AgAgAUEca0EANgIAIAIgAEEEcUEYciICayIBQSBJDQAgACACaiEAA0AgAEIANwMYIABCADcDECAAQgA3AwggAEIANwMAIABBIGohACABQSBrIgFBH0sNAAsLC/EdAjZ+BX8gACACMwAAIAIxAAJCEIZCgID8AIOEIgUgASgAFyI6QQV2Qf///wBxrSIDfiABMwAVIAExABdCEIZCgID8AIOEIgQgAigAAiI5QQV2Qf///wBxrSILfnwgAjUAB0IHiEL///8AgyIIIAEoAA8iO0EGdkH///8Aca0iBn58IAEoAAoiPEEYdq0gATEADkIIhoQgATEAD0IQhoRCAYhC////AIMiDCACKAAKIj1BBHZB////AHGtIg1+fCA5QRh2rSACMQAGQgiGhCACMQAHQhCGhEICiEL///8AgyIOIDtBGHatIAExABNCCIaEIAExABRCEIaEQgOIIgl+fCACKAAPIjlBBnZB////AHGtIgcgATUAB0IHiEL///8AgyIPfnwgPUEYdq0gAjEADkIIhoQgAjEAD0IQhoRCAYhC////AIMiCiA8QQR2Qf///wBxrSIQfnwgOUEYdq0gAjEAE0IIhoQgAjEAFEIQhoRCA4giESABKAACIjlBGHatIAExAAZCCIaEIAExAAdCEIaEQgKIQv///wCDIhJ+fCACMwAVIAIxABdCEIZCgID8AIOEIhUgOUEF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A0IBhCIIIAR8p2ogASAIp2otAAA6AAAgCyADQgKEIgggBHynaiABIAinai0AADoAACALIANCA4QiCCAEfKdqIAEgCKdqLQAAOgAAIANCBHwhAyAJQgR8IgkgClINAAsgBlANAQsDQCALIAMgBHynaiABIAOnai0AADoAACADQgF8IQMgB0IBfCIHIAZSDQALCyAAIAsgDCAMQYAFaiINEHsgASAFp2ohASACIAV9IgJC/wBWBEADQCAAIAEgDCANEHsgAUGAAWohASACQoABfSICQv8AVg0ACwsCQCACUA0AIAJCA4MhBEIAIQdCACEDIAJCBFoEQCACQvwAgyEFQgAhAgNAIAsgA6ciAGogACABai0AADoAACALIABBAXIiDWogASANai0AADoAACALIABBAnIiDWogASANai0AADoAACALIABBA3IiAGogACABai0AADoAACADQgR8IQMgAkIEfCICIAVSDQALIARQDQELA0AgCyADpyIAaiAAIAFqLQAAOgAAIANCAXwhAyAHQgF8IgcgBFINAAsLIAxBwAUQBwwBCyACQgODIQVCACEDIAJCBFoEQCACQnyDIQIDQCALIAMgBHynaiABIAOnai0AADoAACALIANCAYQiBiAEfKdqIAEgBqdqLQAAOgAAIAsgA0IChCIGIAR8p2ogASAGp2otAAA6AAAgCyADQgOEIgYgBHynaiABIAanai0AADoAACADQgR8IQMgCUIEfCIJIAJSDQALIAVQDQELA0AgCyADIAR8p2ogASADp2otAAA6AAAgA0IBfCEDIAdCAXwiByAFUg0ACwsgDEHABWokAEEACwUAQcAAC+cDAQp/A0AgACAJQQN0IgRqIgYgCUEBdEGguwJqLgEAIgggAiAEQQJyIgNqIgcuAQAgASADaiIKLgEAbCIFQYCAhJh/bEEQdUH/ZWwgBWpBEHVsIgVBgICEmH9sQRB1Qf9lbCAFakEQdiIFOwEAIAYgBSACIARqIgYuAQAgASAEaiILLgEAbCIMQYCAhJh/bEEQdUH/ZWwgDGpBEHZqOwEAIAAgA2oiAyAHLgEAIAsuAQBsIgdBgICEmH9sQRB1Qf9lbCAHakEQdiIHOwEAIAMgBi4BACAKLgEAbCIDQYCAhJh/bEEQdUH/ZWwgA2pBEHYgB2o7AQAgACAEQQRyIgNqIgYgCCACIARB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Qg+IhDwADyAAIBFC////AIMgAkIVh3wiAUINiDwAFCAAIAFCBYg8ABMgACAMQv///wCDIAFCFYd8IgM8ABUgACABQgOGIAJCgIDwAINCEoiEPAASIAAgA0IIiDwAFiAAIA1C////AIMgA0IVh3wiAkILiDwAGSAAIAJCA4g8ABggACADQhCIQh+DIAJCBYaEPAAXIAAgD0L///8AgyACQhWHfCIBQgaIPAAbIAAgAUIChiACQoCA4ACDQhOIhDwAGiAAIAFCFYciAyAEQv///wCDfCICQhGIPAAfIAAgAkIJiDwAHiAAIAJCB4YgAUKAgP8Ag0IOiIQ8ABwgACADpyAEp2pBAXatPAAdC30BA38CQAJAIAAiAUEDcUUNACABLQAARQRAQQAPCwNAIAFBAWoiAUEDcUUNASABLQAADQALDAELA0AgASICQQRqIQFBgIKECCACKAIAIgNrIANyQYCBgoR4cUGAgYKEeEYNAAsDQCACIgFBAWohAiABLQAADQALCyABIABrCwQAQRgLBABBCAufAQEFfyACpyEFIAAtAOwBBH8gABAaIABBADYC4AEgAEEAOgDsAUF/BUEACyAFBEAgACgC4AEhAwNAIAAoAuQBIgQgA0YEQCAAEBogAEEANgLgASAAKALkASEEQQAhAwsgACABIAZqIAMgBCADayIDIAUgBmsiBCADIARJGyIEEBggACAAKALgASAEaiIDNgLgASAEIAZqIgYgBUkNAAsLCyMAIAJBgAJPBEBB3ApBhQpB6wBB4wgQAAALIAAgASACEJ8BCw0AIAAgASACEC0aQQAL7AUCCH4DfyMAQaACayIMJAACQCACUA0AIAAgACkDICIDIAJCA4Z8NwMgIABBKGohC0LAACADQgOIQj+DIgR9IgUgAlgEQCAFQgODIQZCACEDAkAgBEI/hUIDWgRAIAVC/ACDIQoDQCALIAMgBHynaiABIAOnai0AADoAACALIANCAYQiCCAEfKdqIAEgCKdqLQAAOgAAIAsgA0IChCIIIAR8p2ogASAIp2otAAA6AAAgCyADQgOEIgggBHynaiABIAinai0AADoAACADQgR8IQMgCUIEfCIJIApSDQALIAZQDQELA0AgCyADIAR8p2ogASADp2otAAA6AAAgA0IBfCEDIAdCAXwiByAGUg0ACwsgACALIAwgDEGAAmoi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AGsiAyQAAkACQCACQcEATwRAIAAQeBogACABIAKtEC0aIAAgAxA4GkEgIQIgAyEBDAELIAENACACDQELIAAQeBogA0K27Nix48aNmzY3A1ggA0K27Nix48aNmzY3A1AgA0K27Nix48aNmzY3A0ggA0K27Nix48aNmzY3A0AgA0K27Nix48aNmzY3AzggA0K27Nix48aNmzY3AzAgA0K27Nix48aNmzY3AyggA0K27Nix48aNmzY3AyACQCACRQ0AIAJBA3EhCSACQQRPBEAgAkH8AHEhBgNAIANBIGoiByAEaiIFIAUtAAAgASAEai0AAHM6AAAgByAEQQFyIgVqIgsgCy0AACABIAVqLQAAczoAACAHIARBAnIiBWoiCyALLQAAIAEgBWotAABzOgAAIAcgBEEDciIFaiIHIActAAAgASAFai0AAHM6AAAgBEEEaiEEIAhBBGoiCCAGRw0ACyAJRQ0BCwNAIANBIGogBGoiCCAILQAAIAEgBGotAABzOgAAIARBAWohBCAKQQFqIgogCUcNAAsLIAAgA0EgakLAABAtGiAAQegAaiIJEHgaIANC3Ljx4sWLl67cADcDWCADQty48eLFi5eu3AA3A1AgA0LcuPHixYuXrtwANwNIIANC3Ljx4sWLl67cADcDQCADQty48eLFi5eu3AA3AzggA0LcuPHixYuXrtwANwMwIANC3Ljx4sWLl67cADcDKCADQty48eLFi5eu3AA3AyACQCACRQ0AIAJBA3EhB0EAIQpBACEEIAJBBE8EQCACQfwAcSECQQAhCANAIANBIGoiACAEaiIGIAYtAAAgASAEai0AAHM6AAAgACAEQQFyIgZqIgUgBS0AACABIAZqLQAAczoAACAAIARBAnIiBmoiBSAFLQAAIAEgBmotAABzOgAAIAAgBEEDciIGaiIAIAAtAAAgASAGai0AAHM6AAAgBEEEaiEEIAhBBGoiCCACRw0ACyAHRQ0BCwNAIANBIGogBGoiACAALQAAIAEgBGotAABzOgAAIARBAWohBCAKQQFqIgogB0cNAAsLIAkgA0EgaiIAQsAAEC0aIABBwAAQByADQSAQByADQeAAaiQAQQAPCxAMAAs7AQF/IwBBQGoiAiQAIAAgAhAeGiAAQdABaiIAIAJCwAAQExogACABEB4aIAJBwAAQByACQUBrJABBAAuW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NgIUIAAgCUEAIAlrcyABcSAJczYCECAAIApBACAKa3MgAXEgCnM2AgwgACALQQAgC2tzIAFxIAtzNgIIIAAgDEEAIAxrcyABcSAMczYCBCAAIANBACADa3MgAXEgA3M2AgAgAEH4AGogACAXEAUgAkHAAmokACAEIA9yQQFrC8oIAQN/IwBBwAFrIgIkACACQZABaiIEIAEQBCACQeAAaiIDIAQQBCADIAMQBCADIAEgAxAFIAQgBCADEAUgAkEwaiIBIAQQBCADIAMgARAFIAEgAxAEIAEgARAEIAEgARAEIAEgARAEIAEgARAEIAMgASADEAUgASADEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABIAMQBSACIAEQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCABIAIgARAFIAEgARAEIAEgARAEIAEgARAEIAEgARAEIAEgARAEIAEgARAEIAEgARAEIAEgARAEIAEgARAEIAEgARAEIAMgASADEAUgASADEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABEAQgASABIAMQBSACIAEQBEEBIQEDQCACIAIQBCABQQFqIgFB5ABHDQALIAJBMGoiASACIAEQBSABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCABIAEQBCACQeAAaiIDIAEgAxAFIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAAgAyACQZABahAFIAJBwAFqJAALsQEBAX8jAEEQayICIAA2AgwgAiABNgIIQQAhACACQQA7AQYDQCACIAIvAQYgAigCDCAAai0AACACKAIIIABqLQAAc3I7AQYgAiACLwEGIABBAXIiASACKAIMai0AACACKAIIIAFqLQAAc3I7AQYgAEECaiIAQSBHDQALIAIgAi8BBjsBBiACIAIvAQZBAWs7AQYgAkHQyAIvAQBBAnYgAi8BBkEPdnM7AQYgAi8BBkEBawuVBAEBfyMAQRBrIgIgADYCDCACIAE2AgggAkEAOwEGIAIgAi8BBiACKAIMLQAAIAIoAggtAABzcjsBBiACIAIvAQYgAigCDC0AASACKAIILQABc3I7AQYgAiACLwEGIAIoAgwtAAIgAigCCC0AAnNyOwEGIAIgAi8BBiACKAIMLQADIAIoAggtAANzcjsBBiACIAIvAQYgAigCDC0ABCACKAIILQAEc3I7AQYgAiACLwEGIAIoAgwtAAUgAigCCC0ABXNyOwEGIAIgAi8BBiACKAIMLQAGIAIoAggtAAZzcjsBBiACIAIvAQYgAigCDC0AByACKAIILQAHc3I7AQYgAiACLwEGIAIoAgwtAAggAigCCC0ACHNyOwEGIAIgAi8BBiACKAIMLQAJIAIoAggtAAlzcjsBBiACIAIvAQYgAigCDC0ACiACKAIILQAKc3I7AQYgAiACLwEGIAIoAgwtAAsgAigCCC0AC3NyOwEGIAIgAi8BBiACKAIMLQAMIAIoAggtAAxzcjsB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cSIBBEAgAEEDcQRAA0AgAC0AACICRQ0FIAEgAkYNBSAAQQFqIgBBA3ENAAsLQYCChAggACgCACICayACckGAgYKEeHFBgIGChHhHDQEgAUGBgoQIbCEEA0BBgIKECCACIARzIgFrIAFyQYCBgoR4cUGAgYKEeEcNAiAAKAIEIQIgAEEEaiIBIQAgAkGAgoQIIAJrckGAgYKEeHFBgIGChHhGDQALDAILIAAQJyAAagwDCyAAIQELA0AgASIALQAAIgJFDQEgAEEBaiEBIAIgA0H/AXFHDQALCyAACyIAQQAgAC0AACADQf8BcUYbC2ABAn8gAkUEQEEADwsgAC0AACIDBH8CQANAIAMgAS0AACIERw0BIARFDQEgAkEBayICRQ0BIAFBAWohASAALQABIQMgAEEBaiEAIAMNAAtBACEDCyADBUEACyABLQAAaws5AQF/IwBBIGsiAiQAIAAgAhA4GiAAQegAaiIAIAJCIBAtGiAAIAEQOBogAkEgEAcgAkEgaiQAQQALVwIBfwF+AkBBoL0CKAIAIgGtIACtQgd8Qvj///8fg3wiAkL/////D1gEQCACpyIAPwBBEHRNDQEgABADDQELQcDEAkEwNgIAQX8PC0GgvQIgADYCACABCwQAQQILEQAgACABIAIgA0EIEIIBQQALEQAgACABIAIgA0EMEIIBQQALEQAgACABIAIgA0EUEIIBQQALohECLH8FfiMAQaAGayICJAAgAUEoaiIDKAIAIRYgASgCUCEMIAEoAiwhDSABKAJUIQ4gASgCMCEPIAEoAlghECABKAI0IREgASgCXCESIAEoAjghEyABKAJgIRQgASgCPCEFIAEoAmQhBiABQUBrIhUoAgAhByABKAJoIQggASgCRCEJIAEoAmwhBCABKAJIIQogASgCcCELIAIgASgCTCIXIAEoAnQiGGo2AsQCIAIgCiALajYCwAIgAiAEIAlqNgK8AiACIAcgCGo2ArgCIAIgBSAGajYCtAIgAiATIBRqNgKwAiACIBEgEmo2AqwCIAIgDyAQajYCqAIgAiANIA5qNgKkAiACIAwgFmo2AqACIAIgGCAXazYCJCACIAsgCms2AiAgAiAEIAlrNgIcIAIgCCAHazYCGCACIAYgBWs2AhQgAiAUIBNrNgIQIAIgEiARazYCDCACIBAgD2s2AgggAiAOIA1rNgIEIAIgDCAWazYCACACQaACaiIEIAQgAhAFIAJB8AFqIgYgASADEAUgAkHAAWoiBSAGEAQgBSAEIAUQBSACQgA3ArQDIAJCADcCvAMgAkIANwLEAyACQgA3AswDIAJBADYC1AMgAkEBNgKwAyACQcAEaiIHIAJBsANqIAUQgwEaIAJB0AVqIgUgByAEEAUgAkGgBWoiHyAHIAYQBSACQTBqIhogBSAfEAUgGiAaIAFB+ABqIhYQBSACQZAEaiABQfAMEAUgAkHgA2ogA0HwDBAFIAJB8ARqIAVBkBcQBSACQdACaiIEIBYgGhAFIAJBgANqIhkgBBAPIAItAIADIQQgAiABKQIgIi43A7ABIAIgASkCGCIvNwOoASACIAEpAhAiMDcDoAEgAiABKQIIIjE3A5gBIAIgASkCACIyNwOQASADKAIAIRYgASgCLCEMIAEoAjAhDSABKAI0IQ4gASgCOCEPIAEoAjwhECAVKAIAIREgASgCRCESIAEoAkghEyABKAJMIRQgAigC5AMhCiACKAKUASEFIAIoAuwDIQsgAigCnAEhBiACKAL0AyEVIAIoAqQBIQcgAigC/AMhFyACKAKsASEIIAIoAoQEIRggAigCtAEhCSACKALgAyEbIAIoAugDIRwgAigC8AMhHSACKAL4AyEeIAJBACAEQQFxayIDIC6nIgQgAigCgARzcSAEczYCsAEgAiAeIC+nIgRzIANxIARzNgKoASACIB0gMKciBHMgA3EgBHM2AqABIAIgHCAxpyIEcyADcSAEczYCmAEgAiAbIDKnIgRzIANxIARzNgKQASACIAkgCSAYcyADcXM2ArQBIAIgCCAIIBdzIANxczYCrAEgAiAHIAcgFXMgA3FzNgKkASACIAYgBiALcyADcXM2ApwBIAIgBSAFIApzIANxczYClAEgAigCkAQhFyACKAKUBCEYIAIoApgEIRsgAigCnAQhHCACKAKgBCEdIAIoAqQEIR4gAigCqAQhICACKAKsBCEhIAIoArAEISIgAigCtAQhIyACKAKgBSEFIAIoAvAEISQgAigCpAUhBiACKAL0BCElIAIoAqgFIQcgAigC+AQhJiACKAKsBSEIIAIoAvwEIScgAigCsAUhCSACKAKABSEoIAIoArQFIQQgAigChAUhKSACKAK4BSEKIAIoAogFISogAigCvAUhCyACKAKMBSErIAIoAsAFIRUgAigCkAUhLCACIAIoAsQFIi0gAigClAVzIANxIC1zNgLEBSACIBUgFSAscyADcXM2AsAFIAIgCyALICtzIANxczYCvAUgAiAKIAogKnMgA3FzNgK4BSACIAQgBCApcyADcXM2ArQFIAIgCSAJIChzIANxczYCsAUgAiAIIAggJ3MgA3FzNgKsBSACIAcgByAmcyADcXM2AqgFIAIgBiAGICVzIANxczYCpAUgAiAFIAUgJHMgA3FzNgKgBSACQeAAaiIEIAJBkAFqIBoQBSAZIAQQDyABKAJQIQUgASgCVCEGIAEoAlghByABKAJcIQggASgCYCEJIAEoAmQhBCABKAJoIQogASgCbCELIAEoAnAhFSACIAEoAnRBACACLQCAA0EBcWsiASAUIBQgI3MgA3FzIhRBACAUa3NxIBRzazYCpAMgAiAVIBMgEyAicyADcXMiE0EAIBNrcyABcSATc2s2AqADIAIgCyASIBIgIXMgA3FzIhJBACASa3MgAXEgEnNrNgKcAyACIAogESARICBzIANxcyIRQQAgEWtzIAFxIBFzazYCmAMgAiAEIBAgECAecyADcXMiEEEAIBBrcyABcSAQc2s2ApQDIAIgCSAPIA8gHXMgA3FzIg9BACAPa3MgAXEgD3NrNgKQAyACIAggDiAOIBxzIANxcyIOQQAgDmtzIAFxIA5zazYCjAMgAiAHIA0gDSAbcyADcXMiDUEAIA1rcyABcSANc2s2AogDIAIgBiAMIAwgGHMgA3FzIgxBACAMa3MgAXEgDHNrNgKEAyACIAUgASAWIBYgF3MgA3FzIgFBACABa3NxIAFzazYCgAMgGSAfIBkQBSACQYAGaiAZEA8gAkEAIAItAIAGQQFxayIBIAIoAoADIgNBACADa3NxIANzNgKAAyACIAIoAoQDIgNBACADa3MgAXEgA3M2AoQDIAIgAigCiAMiA0EAIANrcyABcSADczYCiAMgAiACKAKMAyIDQQAgA2tzIAFxIANzNgKMAyACIAIoApADIgNBACADa3MgAXEgA3M2ApADIAIgAigClAMiA0EAIANrcyABcSADczYClAMgAiACKAKYAyIDQQAgA2tzIAFxIANzNgKYAyACIAIoApwDIgNBACADa3MgAXEgA3M2ApwDIAIgAigCoAMiA0EAIANrcyABcSADczYCoAMgAiABIAIoAqQDIgFBACABa3NxIAFzNgKkAyAAIBkQDyACQaAGaiQAC8EFARx/IwBBwAJrIgEkACABQfABaiIDIAAQBCABQcABaiIEIABBKGoQBCABQZABaiICIABB0ABqEAQgASgC8AEhACABKALAASEFIAEoAvQBIQYgASgCxAEhByABKAL4ASEIIAEoAsgBIQkgASgC/AEhCiABKALMASELIAEoAoACIQwgASgC0AEhDSABKAKEAiEOIAEoAtQBIQ8gASgCiAIhECABKALYASERIAEoAowCIRIgASgC3AEhEyABKAKQAiEUIAEoAuABIRUgASABKALkASABKAKUAms2AlQgASAVIBRrNgJQIAEgEyASazYCTCABIBEgEGs2AkggASAPIA5rNgJEIAEgDSAMazYCQCABIAsgCms2AjwgASAJIAhrNgI4IAEgByAGazYCNCABIAUgAGs2AjAgAUEwaiIWIBYgAhAFIAEgAyAEEAUgASABQcAMEAUgAUHgAGogAhAEIAEoAjAhACABKAJgIQUgASgCACEGIAEoAjQhByABKAJkIQggASgCBCEJIAEoAjghCiABKAJoIQsgASgCCCEMIAEoAjwhDSABKAJsIQ4gASgCDCEPIAEoAkAhECABKAJwIREgASgCECESIAEoAkQhEyABKAJ0IRQgASgCFCEVIAEoAkghAiABKAJ4IQMgASgCGCEEIAEoAkwhFyABKAJ8IRggASgCHCEZIAEoAlAhGiABKAKAASEbIAEoAiAhHCABIAEoAlQgASgChAEgASgCJGprNgJUIAEgGiAbIBxqazYCUCABIBcgGCAZams2AkwgASACIAMgBGprNgJIIAEgEyAUIBVqazYCRCABIBAgESASams2AkAgASANIA4gD2prNgI8IAEgCiALIAxqazYCOCABIAcgCCAJams2AjQgASAAIAUgBmprNgIwIAFBoAJqIgAgFhAPIABBIBAbIAFBwAJqJAALpQMCA38BfiMAQeACayIGJAAgBiAEIAVBABA2GgJ/AkACQCAAIAJLIAMgACACa61WcUUEQCAAIAJPDQEgAyACIABrrVgNAQsgA6ciBQRAIAAgAiAF/AoAAAsgBkIANwM4IAZCADcDMCAGQgA3AyggBkIANwMgQiAgAyADQiBaGyEJIANCIFYhBSAAIQIM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dGohB0EAIQQDQCAHIARBA3QiBWogAUGAAWoiCCAFaikDADcDACAHIAVBCHIiCWogCCAJaikDADcDACAHIAVBEHIiCWogCCAJaikDADcDACAHIAVBGHIiBWogBSAIaikDADcDACAEQQRqIgRBgAFHDQALIAFBATYCcCAIQYAIIAFBMGpByAAQnQEgAygCACgCBCADKAIYIAJsQQp0akGACGohB0EAIQQDQCAHIARBA3QiBWogAUGAAWoiCCAFaikDADcDACAHIAVBCHIiCWogCCAJaikDADcDACAHIAVBEHIiCWogCCAJaikDADcDACAHIAVBGHIiBWogBSAIaikDADcDACAEQQRqIgRBgAFHDQALIAJBAWoiAiADKAIcSQ0ACwsgAUGAAWpBgAgQByABQTBqQcgAEAdBACECCyALJAAgAgsiAw0AIAYoAgwEQANAIwBB0ABrIgEkAAJAIAZBBGoiAkUNACACKAIcRQ0AIAFBADoASCABIAw2AkBBACEDA0AgAUEANgJMIAEgAzYCRCABIAEpAkA3AzAgASABKQJINwM4IAIgAUEwahBtIANBAWoiAyACKAIcIgRJDQALIAFBAToASCAERQ0AQQAhAwNAIAFBADYCTCABIAM2AkQgASABKQJANwMgIAEgASkCSDcDKCACIAFBIGoQbSADQQFqIgMgAigCHCIESQ0ACyABQQI6AEggBEUNAEEAIQMDQCABQQA2AkwgASADNgJEIAEgASkCQDcDECABIAEpAkg3AxggAiABQRBqEG0gA0EBaiIDIAIoAhwiBEkNAAsgAUEDOgBIIARFDQBBACEDA0AgAUEANgJMIAEgAzYCRCABIAEpAkA3AwAgASABKQJINwMIIAIgARBtIANBAWoiAyACKAIcSQ0ACwsgAUHQAGokACAMQQFqIgwgBigCDEkNAAsLIAZBBGohAyMAQYAQayIBJAACQCAARQ0AIANFDQAgAUGACGogAygCACgCBCADKAIYIgtBCnRqIgxBgAhrQYAI/AoAACADKAIcIglBAk8EQEEBIQcDQCAMIAcgC2xBCnRqQYAIayECQQAhBQNAIAVBA3QiBCABQYAIaiIIaiIKIAopAwAgAiAEaikDAIU3AwAgCCAEQQhyIgpqIg0gDSkDACACIApqKQMAhTcDACAIIARBEHIiCmoiDSANKQMAIAIgCmop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gBhqIAVBB3RqIgIgAikDOCITIAIpAxgiFnwgFkIBhkL+////H4MgE0L/////D4N+fCIWIAIpA3iFQiCJIhUgAikDWCIYfCAVQv////8PgyAYQgGGQv7///8fg358IhggE4VCKIkiEyAWfCATQv////8PgyAWQgGGQv7///8fg358IhYgFYVCMIkiFSACKQMoIhQgAikDCCIXfCAXQgGGQv7///8fgyAUQv////8Pg358IhcgAikDaIVCIIkiGyACKQNIIhx8IBtC/////w+DIBxCAYZC/v///x+DfnwiHCAUhUIoiSIUIBd8IBRC/////w+DIBdCAYZC/v///x+DfnwiFyAbhUIwiSIbIBx8IBtC/////w+DIBxCAYZC/v///x+DfnwiHCAUhUIBiSIUIAIpAyAiHyACKQMAIhp8IBpCAYZC/v///x+DIB9C/////w+DfnwiGiACKQNghUIgiSIgIAJBQGsiBikDACIjfCAgQv////8PgyAjQgGGQv7///8fg358IiMgH4VCKIkiHyAafCAfQv////8PgyAaQgGGQv7///8fg358Ihp8IBRC/////w+DIBpCAYZC/v///x+DfnwiGYVCIIkiJCACKQMwIiEgAikDECIdfCAdQgGGQv7///8fgyAhQv////8Pg358Ih0gAikDcIVCIIkiIiACKQNQIh58ICJC/////w+DIB5CAYZC/v///x+DfnwiHiAhhUIoiSIhIB18ICFC/////w+DIB1CAYZC/v///x+DfnwiHSAihUIwiSIiIB58ICJC/////w+DIB5CAYZC/v///x+DfnwiHnwgJEL/////D4MgHkIBhkL+////H4N+fCIlIBSFQiiJIhQgGXwgFEL/////D4MgGUIBhkL+////H4N+fCIZNwMAIAIgGSAkhUIwiSIZNwN4IAIgGSAlfCAZQv////8PgyAlQgGGQv7///8fg358Ihk3A1AgAiAUIBmFQgGJNwMoIAIgHiAhhUIBiSIUIBd8IBRC/////w+DIBdCAYZC/v///x+DfnwiFyAaICCFQjCJIhqFQiCJIiAgFSAYfCAVQv////8PgyAYQgGGQv7///8fg358IhV8ICBC/////w+DIBVCAYZC/v///x+DfnwiGCAUhUIoiSIUIBd8IBRC/////w+DIBdCAYZC/v///x+DfnwiGSAghUIwiSIXNwNgIAIgGTcDCCACIBcgGHwgF0L/////D4MgGEIBhkL+////H4N+fCIYNwNYIAIgFCAYhUIBiTcDMCACIBMgFYVCAYkiEyAdfCATQv////8PgyAdQgGGQv7///8fg358IhUgG4VCIIkiGCAaICN8IBpC/////w+DICNCAYZC/v///x+DfnwiFHwgGEL/////D4MgFEIBhkL+////H4N+fCIXIBOFQiiJIhMgFXwgE0L/////D4MgFUIBhkL+////H4N+fCIbIBiFQjCJIhU3A2ggAiAbNwMQIAYgFSAXfCAVQv////8PgyAXQgGGQv7///8fg358IhU3AwAgAiATIBWFQgGJNwM4IAIgFiAUIB+FQgGJIhN8IBZCAYZC/v///x+DIBNC/////w+DfnwiFiAihUIgiSIVIBx8IBVC/////w+DIBxCAYZC/v///x+DfnwiGCAThUIoiSITIBZ8IBNC/////w+DIBZCAYZC/v///x+DfnwiFCAVhUIwiSIWNwNwIAIgFDcDGCACIBYgGHwgFkL/////D4MgGEIBhkL+////H4N+fCIWNwNIIAIgEyAWhUIBiTcDICAFQQFqIgVBCEcNAAsDQCAEQYAYaiADQQR0aiICIAIpA4gDIhMgAikDiAEiFnwgFkIBhkL+////H4MgE0L/////D4N+fCIWIAIpA4gHhUIgiSIVIAIpA4gFIhh8IBVC/////w+DIBhCAYZC/v///x+DfnwiGCAThUIoiSITIBZ8IBNC/////w+DIBZCAYZC/v///x+DfnwiFiAVhUIwiSIVIAIpA4gCIhQgAikDCCIXfCAXQgGGQv7///8fgyAUQv////8Pg358IhcgAikDiAaFQiCJIhsgAikDiAQiHHwgG0L/////D4MgHEIBhkL+////H4N+fCIcIBSFQiiJIhQgF3wgFEL/////D4MgF0IBhkL+////H4N+fCIXIBuFQjCJIhsgHHwgG0L/////D4MgHEIBhkL+////H4N+fCIcIBSFQgGJIhQgAikDgAIiHyACKQMAIhp8IBpCAYZC/v///x+DIB9C/////w+DfnwiGiACKQOABoVCIIkiICACKQOABCIjfCAgQv////8PgyAjQgGGQv7///8fg358IiMgH4VCKIkiHyAafCAfQv////8PgyAaQgGGQv7///8fg358Ihp8IBRC/////w+DIBpCAYZC/v///x+DfnwiGYVCIIkiJCACKQOAAyIhIAIpA4ABIh18IB1CAYZC/v///x+DICFC/////w+DfnwiHSACKQOAB4VCIIkiIiACKQOABSIefCAiQv////8PgyAeQgGGQv7///8fg358Ih4gIYVCKIkiISAdfCAhQv////8PgyAdQgGGQv7///8fg358Ih0gIoVCMIkiIiAefCAiQv////8PgyAeQgGGQv7///8fg358Ih58ICRC/////w+DIB5CAYZC/v///x+DfnwiJSAUhUIoiSIUIBl8IBRC/////w+DIBlCAYZC/v///x+DfnwiGTcDACACIBkgJIVCMIkiGTcDiAcgAiAZICV8IBlC/////w+DICVCAYZC/v///x+DfnwiGTcDgAUgAiAUIBmFQgGJNwOIAiACIB4gIYVCAYkiFCAXfCAUQv////8PgyAXQgGGQv7///8fg358IhcgGiAghUIwiSIahUIgiSIgIBUgGHwgFUL/////D4MgGEIBhkL+////H4N+fCIVfCAgQv////8PgyAVQgGGQv7///8fg358IhggFIVCKIkiFCAXfCAUQv////8PgyAXQgGGQv7///8fg358IhkgIIVCMIkiFzcDgAYgAiAZNwMIIAIgFyAYfCAXQv////8PgyAYQgGGQv7///8fg358Ihg3A4gFIAIgFCAYhUIBiTcDgAMgAiATIBWFQgGJIhMgHXwgE0L/////D4MgHUIBhkL+////H4N+fCIVIBuFQiCJIhggGiAjfCAaQv////8PgyAjQgGGQv7///8fg358IhR8IBhC/////w+DIBRCAYZC/v///x+DfnwiFyAThUIoiSITIBV8IBNC/////w+DIBVCAYZC/v///x+DfnwiGyAYhUIwiSIVNwOIBiACIBs3A4ABIAIgFSAXfCAVQv////8PgyAXQgGGQv7///8fg358IhU3A4AEIAIgEyAVhUIBiTcDiAMgAiAWIBQgH4VCAYkiE3wgFkIBhkL+////H4MgE0L/////D4N+fCIWICKFQiCJIhUgHHwgFUL/////D4MgHEIBhkL+////H4N+fCIYIBOFQiiJIhMgFnwgE0L/////D4MgFkIBhkL+////H4N+fCIUIBWFQjCJIhY3A4AHIAIgFDcDiAEgAiAWIBh8IBZC/////w+DIBhCAYZC/v//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DiAoanM2AAggBSAWIAogKWpzNgAEIBIgE0EBaiITRWohEiADQsAAWARAIANCP1gEQCADpyEBQQAhBANAIAQgK2ogBCAFai0AADoAACAEQQFqIgQgAUkNAAsLIAAgEjYCNCAAIBM2AjAFIAFBQGshASAFQUBrIQIgA0JAfCEDDAELCwsIACAAQRAQFgvRBgEKfyMAQaACayICJAAgACgAHCEEIAAoABghBSAAKAAUIQYgACgAECEHIAAoAAQhCCAAKAAIIQkgACgADCEKIAAoAAAhCyACIAEpAng3A5gCIAIgASkCcDcDkAIgAiABKQJgNwPwASACIAEpAmg3A/gBIAIgASkCcDcD4AEgAiABKQJ4NwPoASACQYACaiIDIAJB8AFqIAJB4AFqEAYgASACKQKIAjcCeCABIAIpAoACNwJwIAIgASkCUDcD0AEgAiABKQJYNwPYASACIAEpAmA3A8ABIAIgASkCaDcDyAEgAyACQdABaiACQcABahAGIAEgAikCiAI3AmggASACKQKAAjcCYCACIAFBQGsiACkCADcDsAEgAiABKQJINwO4ASACIAEpAlA3A6ABIAIgASkCWDcDqAEgAyACQbABaiACQaABahAGIAEgAikCiAI3AlggASACKQKAAjcCUCACIAEpAjA3A5ABIAIgASkCODcDmAEgAiAAKQIANwOAASACIAEpAkg3A4gBIAMgAkGQAWogAkGAAWoQBiABIAIpAogCNwJIIAAgAikCgAI3AgAgAiABKQIgNwNwIAIgASkCKDcDeCACIAEpAjA3A2AgAiABKQI4NwNoIAMgAkHwAGogAkHgAGoQBiABIAIpAogCNwI4IAEgAikCgAI3AjAgAiABKQIQNwNQIAIgASkCGDcDWCACIAEpAiA3A0AgAiABKQIoNwNIIAMgAkHQAGogAkFAaxAGIAEgAikCiAI3AiggASACKQKAAjcCICACIAEpAgA3AzAgAiABKQIINwM4IAIgASkCEDcDICACIAEpAhg3AyggAyACQTBqIAJBIGoQBiABIAIpAogCNwIYIAEgAikCgAI3AhAgAiACKQOQAjcDECACIAIpA5gCNwMYIAIgASkCADcDACACIAEpAgg3AwggAyACQRBqIAIQBiABIAIpAogCNwIIIAEgAikCgAI3AgAgASAKIAEoAgxzNgIMIAEgCSABKAIIczYCCCABIAggASgCBHM2AgQgASALIAEoAgBzNgIAIAAgByAAKAIAczYCACABIAYgASgCRHM2AkQgASAFIAEoAkhzNgJIIAEgBCABKAJMczYCTCACQaACaiQAC7UEAQR/IAAoAhAQCyEBIAAoAhQQCyECIAAoAhgQCyEDIAAgACgCHBALNgIcIAAgAzYCGCAAIAI2AhQgACABNgIQIAAoAiAQCyEBIAAoAiQQCyECIAAoAigQCyEDIAAgACgCLBALNgIsIAAgAzYCKCAAIAI2AiQgACABNgIgIAAoAjAQCyEBIAAoAjQQCyECIAAoAjgQCyEDIAAgACgCPBALNgI8IAAgAzYCOCAAIAI2AjQgACABNgIwIABBQGsiASgCABALIQIgACgCRBALIQMgACgCSBALIQQgACAAKAJMEAs2AkwgACAENgJIIAAgAzYCRCABIAI2AgAgACgCUBALIQEgACgCVBALIQIgACgCWBALIQMgACAAKAJcEAs2AlwgACADNgJYIAAgAjYCVCAAIAE2AlAgACgCYBALIQEgACgCZBALIQIgACgCaBALIQMgACAAKAJsEAs2AmwgACADNgJoIAAgAjYCZCAAIAE2AmAgACgCcBALIQEgACgCdBALIQIgACgCeBALIQMgACAAKAJ8EAs2AnwgACADNgJ4IAAgAjYCdCAAIAE2AnAgACgCgAEQCyEBIAAoAoQBEAshAiAAKAKIARALIQMgACAAKAKMARALNgKMASAAIAM2AogBIAAgAjYChAEgACABNgKAASAAKAKQARALIQEgACgClAEQCyECIAAoApgBEAshAyAAIAAoApwBEAs2ApwBIAAgAzYCmAEgACACNgKUASAAIAE2ApABC9wFASJ/An8gA0UEQEHl8MGLBiEQQbLaiMsHIRFB7siBmQMhEkH0yoHZBgwBCyADKAAIIREgAygABCESIAMoAAAhECADKAAMCyEWIBAhAyACKAAAIhohCCACKAAEIhshCSACKAAIIhwhCiACKAAMIh0hCyASIQYgASgAACIeIQwgASgABCIfIQ0gASgACCIgIQ4gASgADCIhIRMgESEBIAIoABAiIiEFIBYhByACKAAcIiMhFCACKAAYIiQhDyACKAAUIiUhAgNAIAYgCGpBB3cgE3MiFSAGakEJdyAPcyIYIAIgA2pBB3cgC3MiCyADakEJ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dCIFIAAoApQBIgZrNgKUASAAIBtBAXQiByAAKAKQASIIazYCkAEgACAaQQF0IgkgACgCjAEiCms2AowBIAAgGUEBdCILIAAoAogBIgxrNgKIASAAIBhBAXQiDSAAKAKEASIOazYChAEgACAXQQF0Ig8gACgCgAEiEGs2AoABIAAgFkEBdCIRIAAoAnwiEms2AnwgACAVQQF0IhMgACgCeCIUazYCeCAAIAMgBGo2AnAgACAFIAZqNgJsIAAgByAIajYCaCAAIAkgCmo2AmQgACALIAxqNgJgIAAgDSAOajYCXCAAIA8gEGo2AlggACARIBJqNgJUIAAgEyAUajYCUCAAIAEgAmo2AnQLrggBA38jAEGQAWsiAyQAIANB4ABqIgQgARAEIANBMGoiAiAEEAQgAiACEAQgAiABIAIQBSAEIAQgAhAFIAQgBBAEIAQgAiAEEAUgAiAEEAQgAiACEAQgAiACEAQgAiACEAQgAiACEAQgBCACIAQQBSACIAQQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIgBBAFIAMgAhAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAIgAyACEAUgAiACEAQgAiACEAQgAiACEAQgAiACEAQgAiACEAQgAiACEAQgAiACEAQgAiACEAQgAiACEAQgAiACEAQgBCACIAQQBSACIAQQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIQBCACIAIgBBAFIAMgAhAEQQEhAgNAIAMgAxAEIAJBAWoiAkHkAEcNAAsgA0EwaiICIAMgAhAFIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIAIgAhAEIANB4ABqIgQgAiAEEAUgBCAEEAQgBCAEEAQgACAEIAEQBSADQZABaiQACxIAIAAgASACrSADrUIghoQQEwuiBAIOfgp/QQBBgICACCAALQBQGyEWIAAoAiQhEiAAKAIgIRMgACgCHCEUIAAoAhghFSAAKAIUIREgACgCECIXrSEPIAAoAgwiGK0hDSAAKAIIIhmtIQsgACgCBCIarSEJIBpBBWytIRAgGUEFbK0hDiAYQQVsrSEMIBdBBWytIQogADUCACEIA0AgASgAA0ECdkH///8fcSAVaq0iAyANfiABKAAAQf///x9xIBFqrSIEIA9+fCABKAAGQQR2Qf///x9xIBRqrSIFIAt+fCABKAAJQQZ2IBNqrSIGIAl+fCASIBZqIAEoAAxBCHZqrSIHIAh+fCADIAt+IAQgDX58IAUgCX58IAYgCH58IAcgCn58IAMgCX4gBCALfnwgBSAIfnwgBiAKfnwgByAMfnwgAyAIfiAEIAl+fCAFIAp+fCAGIAx+fCAHIA5+fCADIAp+IAQgCH58IAUgDH58IAYgDn58IAcgEH58IgNCGohC/////w+DfCIEQhqIQv////8Pg3wiBUIaiEL/////D4N8IgZCGohC/////w+DfCIHQhqIp0EFbCADp0H///8fcWoiEUEadiAEp0H///8fcWohFSAFp0H///8fcSEUIAanQf///x9xIRMgB6dB////H3EhEiARQf///x9xIREgAUEQaiEBIAJCEH0iAkIPVg0ACyAAIBI2AiQgACATNgIgIAAgFDYCHCAAIBU2AhggACARNgIUC5oGACAEQQg2AgAgAgJ/AkAgAgJ/AkBCgIACIAAgAEKAgAJYGyIAIAFBBXatWgRAIAFBgCBPDQFBAQwCCyADQQE2AgBBASAApyAEKAIAQQJ0biIDQQRJDQMaQQIgA0EISQ0DGiADQRBJBEAgAkEDNgIADwsgA0EgSQRAIAJBBDYCAA8LIANBwABJBEAgAkEFNgIADwsgA0GAAUkEQCACQQY2AgAPCyADQYACSQRAIAJBBzYCAA8LIANBgARJBEAgAkEINgIADwsgA0GACEkEQCACQQk2AgAPCyADQYAQSQRAIAJBCjYCAA8LIANBgCBJBEAgAkELNgIADwsgA0GAwABJBEAgAkEMNgIADwsgA0GAgAFJBEAgAkENNgIADwsgA0GAgAJJBEAgAkEONgIADwsgA0GAgARJBEAgAkEPNgIADwsgA0GAgAhJBEAgAkEQNgIADwsgA0GAgBBJBEAgAkERNgIADwsgA0GAgCBJBEAgAkESNgIADwsgA0GAgMAASQRAIAJBEzYCAA8LIANBgICAAUkEQCACQRQ2AgAPCyADQYCAgAJJBEAgAkEVNgIADwsgA0GAgIAESQRAIAJBFjYCAA8LIANBgICACEkEQCACQRc2AgAPCyADQYCAgBBPDQIgAkEYNgIADwtBAiABQYDAAEkNABpBAyABQYCAAUkNABpBBCABQYCAAkkNABpBBSABQYCABEkNABpBBiABQYCACEkNABpBByABQYCAEEkNABpBCCABQYCAIEkNABpBCSABQYCAwABJDQAaQQogAUGAgIABSQ0AGkELIAFBgICAAkkNABpBDCABQYCAgARJDQAaQQ0gAUGAgIAISQ0AGkEOIAFBgICAEEkNABpBDyABQYCAgCBJDQAaQRAgAUGAgIDAAEkNABpBESABQYCAgIABSQ0AGkESIAFBgICAgAJJDQAaQRMgAUGAgICABEkNABpBFEEVIAFBAE4bCyIBNgIAIANC/////wMgAEICiCABrYgiACAAQv////8DWhunIAQoAgBuNgIADwtBGUEaIANBgICAIEkbCzYC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IgUgB3wgBUL/////D4MgB0IBhkL+////H4N+fCIHIASFQjCJIgQgASkDKCIDIAEpAwgiCHwgCEIBhkL+////H4MgA0L/////D4N+fCIIIAEpA2iFQiCJIgsgASkDSCIMfCAMQgGGQv7///8fgyALQv////8Pg358IgwgA4VCKIkiAyAIfCADQv////8PgyAIQgGGQv7///8fg358IgggC4VCMIkiCyAMfCALQv////8PgyAMQgGGQv7///8fg358IgwgA4VCAYkiAyABKQMgIg8gASkDACIKfCAKQgGGQv7///8fgyAPQv////8Pg358IgogASkDYIVCIIkiECABQUBrIhYpAwAiE3wgE0IBhkL+////H4MgEEL/////D4N+fCITIA+FQiiJIg8gCnwgD0L/////D4MgCkIBhkL+////H4N+fCIKfCADQv////8PgyAKQgGGQv7///8fg358IgmFQiCJIhQgASkDMCIRIAEpAxAiDXwgDUIBhkL+////H4MgEUL/////D4N+fCINIAEpA3CFQiCJIhIgASkDUCIOfCAOQgGGQv7///8fgyASQv////8Pg358Ig4gEYVCKIkiESANfCARQv////8PgyANQgGGQv7///8fg358Ig0gEoVCMIkiEiAOfCASQv////8PgyAOQgGGQv7///8fg358Ig58IBRC/////w+DIA5CAYZC/v///x+DfnwiFSADhUIoiSIDIAl8IANC/////w+DIAlCAYZC/v///x+DfnwiCTcDACABIAkgFIVCMIkiCTcDeCABIAkgFXwgCUL/////D4MgFUIBhkL+////H4N+fCIJNwNQIAEgAyAJhUIBiTcDKCABIAQgBnwgBEL/////D4MgBkIBhkL+////H4N+fCIEIA4gEYVCAYkiBiAIfCAGQv////8PgyAIQgGGQv7///8fg358IgMgCiAQhUIwiSIIhUIgiSIKfCAEQgGGQv7///8fgyAKQv////8Pg358IhAgBoVCKIkiBiADfCAGQv////8PgyADQgGGQv7///8fg358IgkgCoVCMIkiAzcDYCABIAk3AwggASADIBB8IANC/////w+DIBBCAYZC/v///x+DfnwiAzcDWCABIAMgBoVCAYk3AzAgASAEIAWFQgGJIgUgDXwgBUL/////D4MgDUIBhkL+////H4N+fCIEIAuFQiCJIgYgCCATfCAIQv////8PgyATQgGGQv7///8fg358IgN8IAZC/////w+DIANCAYZC/v///x+DfnwiCCAFhUIoiSIFIAR8IAVC/////w+DIARCAYZC/v///x+DfnwiCyAGhUIwiSIENwNoIAEgCzcDECAWIAQgCHwgBEL/////D4MgCEIBhkL+////H4N+fCIENwMAIAEgBCAFhUIBiTcDOCABIAcgAyAPhUIBiSIFfCAHQgGGQv7///8fgyAFQv////8Pg358IgcgEoVCIIkiBCAMfCAEQv////8PgyAMQgGGQv7///8fg358IgYgBYVCKIkiBSAHfCAFQv////8PgyAHQgGGQv7///8fg358IgMgBIVCMIkiBzcDcCABIAM3AxggASAGIAd8IAdC/////w+DIAZCAYZC/v///x+DfnwiBzcDSCABIAUgB4VCAYk3AyAgAEEBaiIAQQhHDQALQQAhAANAIBhBgAhqIABBBHRqIgEgASkDiAMiBSABKQOIASIHfCAHQgGGQv7///8fgyAFQv////8Pg358IgcgASkDiAeFQiCJIgQgASkDiAUiBnwgBkIBhkL+////H4MgBEL/////D4N+fCIGIAWFQiiJIgUgB3wgBUL/////D4MgB0IBhkL+////H4N+fCIHIASFQjCJIgQgASkDiAIiAyABKQMIIgh8IAhCAYZC/v///x+DIANC/////w+DfnwiCCABKQOIBoVCIIkiCyABKQOIBCIMfCAMQgGGQv7///8fgyALQv////8Pg358IgwgA4VCKIkiAyAIfCADQv////8PgyAIQgGGQv7///8fg358IgggC4VCMIkiCyAMfCALQv////8PgyAMQgGGQv7///8fg358IgwgA4VCAYkiAyABKQOAAiIPIAEpAwAiCnwgCkIBhkL+////H4MgD0L/////D4N+fCIKIAEpA4AGhUIgiSIQIAEpA4AEIhN8IBNCAYZC/v///x+DIBBC/////w+DfnwiEyAPhUIoiSIPIAp8IA9C/////w+DIApCAYZC/v///x+DfnwiCnwgA0L/////D4MgCkIBhkL+////H4N+fCIJhUIgiSIUIAEpA4ADIhEgASkDgAEiDXwgDUIBhkL+////H4MgEUL/////D4N+fCINIAEpA4AHhUIgiSISIAEpA4AFIg58IA5CAYZC/v///x+DIBJC/////w+DfnwiDiARhUIoiSIRIA18IBFC/////w+DIA1CAYZC/v///x+DfnwiDSAShUIwiSISIA58IBJC/////w+DIA5CAYZC/v///x+DfnwiDnwgFEL/////D4MgDkIBhkL+////H4N+fCIVIAOFQiiJIgMgCXwgA0L/////D4MgCUIBhkL+////H4N+fCIJNwMAIAEgCSAUhUIwiSIJNwOIByABIAkgFXwgCUL/////D4MgFUIBhkL+////H4N+fCIJNwOABSABIAMgCYVCAYk3A4gCIAEgBCAGfCAEQv////8PgyAGQgGGQv7///8fg358IgQgDiARhUIBiSIGIAh8IAZC/////w+DIAhCAYZC/v///x+DfnwiAyAKIBCFQjCJIgiFQiCJIgp8IARCAYZC/v///x+DIApC/////w+DfnwiECAGhUIoiSIGIAN8IAZC/////w+DIANCAYZC/v///x+DfnwiCSAKhUIwiSIDNwOABiABIAk3AwggASADIBB8IANC/////w+DIBBCAYZC/v///x+DfnwiAzcDiAUgASADIAaFQgGJNwOAAyABIAQgBYVCAYkiBSANfCAFQv////8PgyANQgGGQv7///8fg358IgQgC4VCIIkiBiAIIBN8IAhC/////w+DIBNCAYZC/v///x+DfnwiA3wgBkL/////D4MgA0IBhkL+////H4N+fCIIIAWFQiiJIgUgBHwgBUL/////D4MgBEIBhkL+////H4N+fCILIAaFQjCJIgQ3A4gGIAEgCzcDgAEgASAEIAh8IARC/////w+DIAhCAYZC/v///x+DfnwiBDcDgAQgASAEIAWFQgGJNwOIAyABIAcgAyAPhUIBiSIFfCAHQgGGQv7///8fgyAFQv////8Pg358IgcgEoVCIIkiBCAMfCAEQv////8PgyAMQgGGQv7///8fg358IgYgBYVCKIkiBSAHfCAFQv////8PgyAHQgGGQv7///8fg358IgMgBIVCMIkiBzcDgAcgASADNwOIASABIAYgB3wgB0L/////D4MgBkIBhkL+////H4N+fCIHNwOIBCABIAUgB4VCAYk3A4ACIABBAWoiAEEIRw0ACyACIBhBgAj8CgAAQQAhAANAIAIgAEEDdCIBaiIWIBYpAwAgGEGACGoiGSABaikDAIU3AwAgAiABQQhy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AWs2AswDIAIgCkHEhv8CazYCyAMgAiALQeiumARrNgLEAyACIAxBqYAHajYCwAMgAiANQY+UqANqNgK8AyACIA5Bw6KqB2s2ArgDIAIgBUGF5c0GajYCtAMgAiAGQcqOmgVrNgKwAyACQcABaiIZIANBwAwQBSACQQAgAigC5AFrNgLkASACQQAgAigC4AFrNgLgASACQQAgAigC3AFrNgLcASACQQAgAigC2AFrNgLYASACQQAgAigC1AFrNgLUASACQQAgAigC0AFrNgLQASACQQAgAigCzAFrNgLMASACQQAgAigCyAFrNgLIASACQQAgAigCxAFrNgLEASACIAIoAsABQX9zNgLAASAZIBkgAkGwA2oQBSACQYADaiIiIAQgGRCDASEDIAJB0AJqIgQgIiABEAUgAkHABGoiJCAEEA8gAi0AwAQhJSACKAKkAyEaIAIoAvQCIQQgAigCoAMhGyACKALwAiEQIAIoApwDIRwgAigC7AIhESACKAKYAyEdIAIoAugCIRIgAigClAMhHiACKALkAiETIAIoApADIR8gAigC4AIhFCACKAKMAyEgIAIoAtwCIRUgAigCiAMhISACKALYAiEWIAIoAoQDIQ8gAigC1AIhFyACKAKAAyEjIAIoAtACIRggAiAHIANBAWsiAXE2AuQEIAIgASAIcTYC4AQgAiABIAlxNgLcBCACIAEgCnE2AtgEIAIgASALcTYC1AQgAiABIAxxNgLQBCACIAEgDXE2AswEIAIgASAOcTYCyAQgAiABIAVxNgLEBCACIAZBACADa3I2AsAEIAIgIyAjQQAgGEEAICVBAXFrIgMgGEEAIBhrc3Fza3MgAXFzIhg2AoADIAIgDyAPQQAgFyAXQQAgF2tzIANxc2tzIAFxcyIXNgKEAyACICEgIUEAIBYgFkEAIBZrcyADcXNrcyABcXMiFjYCiAMgAiAgICBBACAVIBVBACAVa3MgA3Fza3MgAXFzIhU2AowDIAIgHyAfQQAgFCAUQQAgFGtzIANxc2tzIAFxcyIUNgKQAyACIB4gHkEAIBMgE0EAIBNrcyADcXNrcyABcXMiEzYClAMgAiAdIB1BACASIBJBACASa3MgA3Fza3MgAXFzIhI2ApgDIAIgHCAcQQAgESARQQAgEWtzIANxc2tzIAFxcyIRNgKcAyACIBsgG0EAIBAgEEEAIBBrcyADcXNrcyABcXMiEDYCoAMgAiAaIBpBACAEIARBACAEa3MgA3Fza3MgAXFzIgE2AqQDIAIgBzYCtAQgAiAINgKwBCACIAk2AqwEIAIgCjYCqAQgAiALNgKkBCACIAw2AqAEIAIgDTYCnAQgAiAONgKYBCACIAU2ApQEIAIgBkEBazYCkAQgAkGQBGoiDyAPICQQBSAPIA9B8IkCEAUgAigCwAEhAyACKAKQBCEHIAIoAsQBIQggAigClAQhCSACKALIASEKIAIoApgEIQsgAigCzAEhDCACKAKcBCENIAIoAtABIQ4gAigCoAQhBSACKALUASEGIAIoAqQEIQQgAigC2AEhGiACKAKoBCEbIAIoAtwBIRwgAigCrAQhHSACKALgASEeIAIoArAEIR8gAigC5AEhICACKAK0BCEhIAIgAUEBdDYCtAEgAiAQQQF0NgKwASACIBFBAXQ2AqwBIAIgEkEBdDYCqAEgAiATQQF0NgKkASACIBRBAXQ2AqABIAIgFUEBdDYCnAEgAiAWQQF0NgKYASACIBdBAXQ2ApQBIAIgGEEBdDYCkAEgAiAhICBrNgK0BCACIB8gHms2ArAEIAIgHSAcazYCrAQgAiAbIBprNgKoBCACIAQgBms2AqQEIAIgBSAOazYCoAQgAiANIAxrNgKcBCACIAsgCms2ApgEIAIgCSAIazYClAQgAiAHIANrNgKQBCACQZABaiIFIAUgGRAFIAJB4ABqIgYgD0GgigIQBSACQaACaiAiEAQgAkEAIAIoAsQCIgFrNgJUIAJBACACKALAAiIDazYCUCACQQAgAigCvAIiB2s2AkwgAkEAIAIoArgCIghrNgJIIAJBACACKAK0AiIJazYCRCACQQAgAigCsAIiCms2AkAgAkEAIAIoAqwCIgtrNgI8IAJBACACKAKoAiIMazYCOCACQQAgAigCpAIiDWs2AjQgAkEBIAIoAqACIg5rNgIwIAIgATYCJCACIAM2AiAgAiAHNgIcIAIgCDYCGCACIAk2AhQgAiAKNgIQIAIgCzYCDCACIAw2AgggAiANNgIEIAIgDkEBajYCACAAIAUgAhAFIABBKGogAkEwaiIBIAYQBSAAQdAAaiAGIAIQBSAAQfgAaiAFIAEQBSACQfAEaiQAC6gBAQR/IwBBgAdrIgIkACACQdAGaiIDIAEQNSACQaAGaiIEIAFBIGoQNSACQcACaiIBIAMQpAEgAkGgAWoiAyAEEKQBIAJBgAVqIgQgAxAOIAJB4ANqIgMgASAEEBIgAiADIAJB2ARqIgEQBSACQShqIAJBiARqIgQgAkGwBGoiBRAFIAJB0ABqIAUgARAFIAJB+ABqIAMgBBAFIAAgAhBVIAJBgAdqJAALzhkCIH8MfiMAQcAHayIEJAAgBEGwAmoiAyABEK0BIAQgBCgCsAJBAWo2ArACIAMgAxBFQQAhASAEQQAgBDQC1AJChtodfiInICdCgICACHwiJ0KAgIDwD4N9IAQ0AtACQobaHX4gBDQCzAJChtodfiIjQoCAgAh8IiZCGYd8IiRCgICAEHwiJUIaiHynIgZrIgc2AqQCIARBACAkICVCgICA4A+DfaciCGsiCTYCoAIgBEEAICMgJkKAgIDwD4N9IAQ0AsgCQobaHX4gBDQCxAJChtodfiIjQoCAgAh8IiZCGYd8IiRCgICAEHwiJUIaiHynIgprIgs2ApwCIARBACAkICVCgICA4A+DfaciDGsiDTYCmAIgBEEAICMgJkKAgIDwD4N9IAQ0AsACQobaHX4gBDQCvAJChtodfiIjQoCAgAh8IiZCGYd8IiRCgICAEHwiJUIaiHynIg5rIhA2ApQCIARBACAkICVCgICA4A+DfaciEWsiEjYCkAIgBEEAICMgJkKAgIDwD4N9IAQ0ArgCQobaHX4gBDQCtAJChtodfiIjQoCAgAh8IiZCGYd8IiRCgICAEHwiJUIaiHynIhNrIhQ2AowCIARBACAkICVCgICA4A+DfaciFWsiFjYCiAIgBEEAICMgJkKAgIDwD4N9ICdCGYdCE34gBDQCsAJChtodfnwiJ0KAgIAQfCIjQhqIfKciF2siGDYChAIgBEEAICcgI0KAgIDgD4N9pyIZayIaNgKAAiAEQdABaiIDIARBgAJqIgUQBCAEQaABaiAFIAMQBSAEKALEASEDIAQoAqABIQUgBDQC0AEhJyAEKAKkASEPIAQoAqgBIRsgBDQC1AEhIyAENALYASEmIAQoAqwBIRwgBCgCsAEhHSAENALcASEkIAQ0AuABISUgBCgCtAEhHiAEKAK4ASEfIAQ0AuQBISggBDQC6AEhKSAEKAK8ASEgIAQoAsABISEgBCAENAL0AUKG2h1+IiogKkKAgIAIfCIqQoCAgPAPg30gBDQC8AFChtodfiAENALsAUKG2h1+IitCgICACHwiLEIZh3wiLUKAgIAQfCIuQhqIfKciIjYC9AEgBCADIAZrICJqNgKEAyAEIC0gLkKAgIDgD4N9pyIDNgLwASAEICEgCGsgA2o2AoADIAQgKyAsQoCAgPAPg30gKUKG2h1+IChChtodfiIoQoCAgAh8IilCGYd8IitCgICAEHwiLEIaiHynIgM2AuwBIAQgICAKayADajYC/AIgBCArICxCgICA4A+DfaciAzYC6AEgBCAfIAxrIANqNgL4AiAEICggKUKAgIDwD4N9ICVChtodfiAkQobaHX4iJEKAgIAIfCIlQhmHfCIoQoCAgBB8IilCGoh8pyIDNgLkASAEIB4gDmsgA2o2AvQCIAQgKCApQoCAgOAPg32nIgM2AuABIAQgHSARayADajYC8AIgBCAkICVCgICA8A+DfSAmQobaHX4gI0KG2h1+IiNCgICACHwiJkIZh3wiJEKAgIAQfCIlQhqIfKciAzYC3AEgBCAcIBNrIANqNgLsAiAEICQgJUKAgIDgD4N9pyIDNgLYASAEIBsgFWsgA2o2AugCIAQgIyAmQoCAgPAPg30gKkIZh0ITfiAnQobaHX58IidCgICAEHwiI0IaiHynIgM2AtQBIAQgDyAXayADajYC5AIgBCAnICNCgICA4A+DfaciAzYC0AEgBCAFIBlrIANqNgLgAiAEQfAEaiIFIARB4AJqIgMgAxAFIAQgAyAFEAUgBEGQBmoiAyAEEAQgAyADEAQgBEGQB2oiDyAEIAMQBSAEQcAEaiIFIA8QBCAFIAUQBCAFIAUQBCAFIAUQBCAEQZAEaiIDIA8gBRAFIAMgAxAEIAMgAxAEIAMgAyAEEAUgBCAEKQOwBDcDgAQgBCAEKQOoBDcD+AMgBCAEKQOgBDcD8AMgBCAEKQOYBDcD6AMgBCAEKQOQBDcD4AMgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADIARB4ANqIgUQBSADIAMQBCADIAMQBCADIAMQBCADIAMQBCADIAMQBCADIAMQBCADIAMQBCADIAMQBCADIAMQBCADIAMQBCADIAMgBRAFIAQgBCkDsAQ3A9ADIAQgBCkDqAQ3A8gDIAQgBCkDoAQ3A8ADIAQgBCkDmAQ3A7gDIAQgBCkDkAQ3A7ADIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAxAEIAMgAyAEQbADaiIFEAUgBCAEKQOwBDcD0AMgBCAEKQOoBDcDyAMgBCAEKQOgBDcDwAMgBCAEKQOYBDcDuAMgBCAEKQOQBDcDsAMgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADIAUQBSAEIAQpA7AENwPQAyAEIAQpA6gENwPIAyAEIAQpA6AENwPAAyAEIAQpA5gENwO4AyAEIAQpA5AENwOwAwNAIARBkARqIgMgAxAEIAFBAWoiAUH4AEcNAAsgAyADIARBsANqEAUgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADEAQgAyADIARB4ANqEAUgAyADEAQgAyADEAQgAyADEAQgAyADIAQQBSADIAMQBCAEQZADaiADEA8gBEEAIAQtAJEDQQFxayIBIAYgB3NxIAdzIgY2ApQFIAQgCCAJcyABcSAJcyIHNgKQBSAEIAogC3MgAXEgC3MiCDYCjAUgBCAMIA1zIAFxIA1zIgk2AogFIAQgDiAQcyABcSAQcyIKNgKEBSAEIBEgEnMgAXEgEnMiCzYCgAUgBCATIBRzIAFxIBRzIgw2AvwEIAQgFSAWcyABcSAWcyINNgL4BCAEIBcgGHMgAXEgGHMiDjYC9AQgBCAZIBpzIAFxIBpzIAFBhtodcWsiAUEBajYC8AQgBCAGNgK0BiAEIAc2ArAGIAQgCDYCrAYgBCAJNgKoBiAEIAo2AqQGIAQgCzYCoAYgBCAMNgKcBiAEIA02ApgGIAQgDjYClAYgBCABQQFrNgKQBiAEIARB8ARqEEUgBEGQB2oiASAEQZAGaiAEEAUgACABEA8gACAALQAfIAJyOgAfIAQgABBEBEAQqgEACyAEIAQpAiA3A7AGIAQgBCkCGDcDqAYgBCAEKQIQNwOgBiAEIAQpAgg3A5gGIAQgBCkCADcDkAYgBCAEKQIoNwO4BiAEIAQpAjA3A8AGIAQgBCkCODcDyAYgBCAEKQJANwPQBiAEIAQpAkg3A9gGIAQgBCkCcDcDgAcgBCAEKQJoNwP4BiAEIAQpAmA3A/AGIAQgBCkCWDcD6AYgBCAEKQJQNwPgBiAEQfAEaiIDIARBkAZqIgUQHCAFIAMgBEHoBWoiARAFIARBuAZqIgcgBEGYBWoiBiAEQcAFaiICEAUgBEHgBmoiCCACIAEQBSADIAUQHCAFIAMgARAFIAcgBiACEAUgCCACIAEQBSADIAUQHCAEIAMgARAFIARBKGoiByAGIAIQBSAEQdAAaiIIIAIgARAFIARB+ABqIAMgBhAFIAMgCBBFIAUgBCADEAUgBEGQB2oiASAHIAMQBSAAIAEQDyAEQcAEaiAFEA8gACAALQAfIAQtAMAEQQd0czoAHyAEQcAHaiQAC18BAX8jAEEwayICJAAgACABKQAYNwAYIAAgASkAEDcAECAAIAEpAAg3AAggACABKQAANwAAIAAgAC0AHyIBQf8AcToAHyACIAAQNSAAIAIgAUGAAXEQpgEgAkEwaiQAC4ABAQh/QSAhAUEBIQIDQCAAIAFBAmsiBGotAAAiBSAEQfAWai0AACIGa0EIdSABQQFrIgFB8BZqLQAAIgcgACABai0AACIIc0EBa0EIdSACcSIBcSAIIAdrQQh1IAJxIANyciEDIAUgBnNBAWtBCHUgAXEhAiAEIgENAAsgA0EARwv4HwI2fgR/IAAgAjMAFSACMQAXQhCGQoCA/ACDhCIFIAEoABxBB3atIgR+IAEoABciOkEYdq0gATEAG0IIhoQgATEAHEIQhoRCAohC////AIMiBiACKAAXIjtBBXZB////AHGtIgd+fCABMwAVIAExABdCEIZCgID8AIOEIhAgAigAHEEHdq0iCH58IDtBGHatIAIxABtCCIaEIAIxABxCEIaEQgKIQv///wCDIgkgOkEFdkH///8Aca0iCn58IAcgCn4gAigADyI6QRh2rSACMQATQgiGhCACMQAUQhCGhEIDiCILIAR+fCAFIAZ+fCABKAAPIjtBGHatIAExABNCCIaEIAExABRCEIaEQgOIIgwgCH58IAkgEH58Ig1CgIBAfSIOQhWIfCIRQoCAQH0iEkIViCAIIAp+IAQgB358IAYgCX58Ig8gD0KAgEB9Ig9CgICA/////wCDfXwiIUKY2hx+IAQgCX4gBiAIfnwgD0IViHwiDyAPQoCAQH0iHkKAgID/////AIN9IiJCk9gofnwgESASQoCAgH+DfSIjQuf2J358IA0gDkKAgIB/g30gBiALfiA6QQZ2Qf///wBxrSINIAR+fCAHIBB+fCAFIAp+fCAIIDtBBnZB////AHGtIg5+fCAJIAx+fCACKAAKIjpBGHatIAIxAA5CCIaEIAIxAA9CEIaEQgGIQv///wCDIhEgBH4gBiANfnwgCiALfnwgByAMfnwgBSAQfnwgASgACiI7QRh2rSABMQAOQgiGhCABMQAPQhCGhEIBiEL///8AgyISIAh+fCAJIA5+fCIfQoCAQH0iHUIViHwiIEKAgEB9IhNCFYh8IiRC04xDfnwgAygAFyI8QQV2Qf///wBxrSACMwAAIAIxAAJCEIZCgID8AIOEIg8gCn4gECACKAACIj1BBXZB////AHGtIhR+fCACNQAHQgeIQv///wCDIhUgDn58IBIgOkEEdkH///8Aca0iFn58ID1BGHatIAIxAAZCCIaEIAIxAAdCEIaEQgKIQv///wCDIhcgDH58IA0gATUAB0IHiEL///8AgyIYfnwgESA7QQR2Qf///wBxrSIZfnwgCyABKAACIgJBGHatIAExAAZCCIaEIAExAAdC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Aq0gA61CIIaEIAQQkwMLFQAgACABIAKtIAOtQiCGhCAEEJUDCxAAIAAgAUG0vQIoAgARAAALEAAgACABQay9AigCABEAAAvhAgECfyMAQZADayIIJAAgCEEANgIEIAhBEGoiCSAGIAdBABAfGiAIIAYpABA3AgggCEHQAGoiB0LAACAIQQRqIAkQQRogCEGQAWoiBiAHQay9AigCABEAABogB0HAABAHIAYgBCAFQbC9AigCABECABogBkGQvQJCACAFfUIPg0GwvQIoAgARAgAaIAYgASACQbC9AigCABECABogBkGQvQJCACACfUIPg0GwvQIoAgARAgAaIAggBTcDSCAGIAhByABqIgRCCEGwvQIoAgARAgAaIAggAjcDSCAGIARCCEGwvQIoAgARAgAaIAYgCEEwaiIEQbS9AigCABEAABogBkGAAhAHIAQgAxBHIQYgBEEQEAcCQCAARQ0AIAYEQCACpyIBBEAgAEEAIAH8CwALQX8hBgwBCyAAIAEgAiAIQQRqIAhBEGoQlgJBACEGCyAIQRBqQSAQByAIQZADaiQAIAYLrAIBA38jAEGAA2siCSQAIAlBADYCBCAJQRBqIgogByAIQQAQHxogCSAHKQAQNwIIIAlBQGsiCELAACAJQQRqIgsgChBBGiAJQYABaiIHIAhBrL0CKAIAEQAAGiAIQcAAEAcgByAFIAZBsL0CKAIAEQIAGiAHQZC9AkIAIAZ9Qg+DQbC9AigCABECABogACADIAQgCyAKEJYCIAcgACAEQbC9AigCABECABogB0GQvQJCACAEfUIPg0GwvQIoAgARAgAaIAkgBjcDOCAHIAlBOGoiAEIIQbC9AigCABECABogCSAENwM4IAcgAEIIQbC9AigCABECABogByABQbS9AigCABEAABogB0GAAhAHIAIEQCACQhA3AwALIAlBEGpBIBAHIAlBgANqJABBAAuBAgEFfyMAQRBrIgUkACAALQDkAUUEQCAFAn8CQAJAAkAgACgC4AEiA0GnAWsOAgABAgsgAC0A5QFBgH9zDAILIAAQJUEAIQMgAEEANgLgAQsgACAAQeUBaiADQQEQGEGAAQs6AA8gACAFQQ9qQacBQQEQGCAAECUgAEEBOgDkASAAQQA2AuABCyACBEAgACgC4AEhAwNAIANBqAFGBEAgABAlIABBADYC4AFBACEDC0GoASADayIEIAIgBmsiByAEIAdJGyIEBEAgASAGaiAAIANqIAT8CgAACyAAIAAoAuABIARqIgM2AuABIAQgBmoiBiACSQ0ACwsgBUEQaiQAQQALSgECfyMAQSBrIgYkAEF/IQcCQCACQhBUDQAgBiAEIAUQSw0AIAAgAUEQaiABIAJCEH0gAyAGEGshByAGQSAQBwsgBkEgaiQAIAcLTwECfyMAQSBrIgYkACACQvD///8PVARAQX8hByAGIAQgBRBLRQRAIABBEGogACABIAIgAyAGEFchByAGQSAQBwsgBkEgaiQAIAcPCxAMAAuZBwEHfyMAQdACayIDJAAgASgABCEEIAEoAAghBSABKAAMIQYgAigCBCEHIAIoAgghCCACKAIMIQkgACACKAIAIAEoAABzNgIAIAAgBiAJczYCDCAAIAUgCHM2AgggACAEIAdzNgIEIAMgACkCADcDsAIgAyAAKQIINwO4AiADIAIpAhA3A6ACIAMgAikCGDcDqAIgA0HAAmoiASADQbACaiADQaACahAGIAAgAykCyAI3AgggACADKQLAAjcCACADIAApAgA3A5ACIAMgACkCCDcDmAIgAyACKQIgNwOAAiADIAIpAig3A4gCIAEgA0GQAmogA0GAAmoQBiAAIAMpAsgCNwIIIAAgAykCwAI3AgAgAyAAKQIANwPwASADIAApAgg3A/gBIAMgAikCMDcD4AEgAyACKQI4NwPoASABIANB8AFqIANB4AFqEAYgACADKQLIAjcCCCAAIAMpAsACNwIAIAMgACkCADcD0AEgAyAAKQIINwPYASADIAJBQGspAgA3A8ABIAMgAikCSDcDyAEgASADQdABaiADQcABahAGIAAgAykCyAI3AgggACADKQLAAjcCACADIAApAgA3A7ABIAMgACkCCDcDuAEgAyACKQJQNwOgASADIAIpAlg3A6gBIAEgA0GwAWogA0GgAWoQBiAAIAMpAsgCNwIIIAAgAykCwAI3AgAgAyAAKQIANwOQASADIAApAgg3A5gBIAMgAikCYDcDgAEgAyACKQJoNwOIASABIANBkAFqIANBgAFqEAYgACADKQLIAjcCCCAAIAMpAsACNwIAIAMgACkCADcDcCADIAApAgg3A3ggAyACKQJwNwNgIAMgAikCeDcDaCABIANB8ABqIANB4ABqEAYgACADKQLIAjcCCCAAIAMpAsACNwIAIAMgACkCADcDUCADIAApAgg3A1ggAyACKQKAATcDQCADIAIpAogBNwNIIAEgA0HQAGogA0FAaxAGIAAgAykCyAI3AgggACADKQLAAjcCACADIAApAgA3AzAgAyAAKQIINwM4IAMgAikCkAE3AyAgAyACKQKYATcDKCABIANBMGogA0EgahAGIAAgAykCyAI3AgggACADKQLAAjcCACADIAApAgA3AxAgAyAAKQIINwMYIAMgAikCoAE3AwAgAyACKQKoATcDCCABIANBEGogAxBCIAAgAykCyAI3AgggACADKQLAAjcCACADQdACaiQAC+gEAQJ/IwBBoAFrIgQkACAAIAEtAAA6AAAgACABLQABOgABIAAgAS0AAjoAAiAAIAEtAAM6AAMgACABLQAEOgAEIAAgAS0ABToABSAAIAEtAAY6AAYgACABLQAHOgAHIAAgAS0ACDoACCAAIAEtAAk6AAkgACABLQAKOgAKIAAgAS0ACzoACyAAIAEtAAw6AAwgACABLQANOgANIAAgAS0ADjoADiAAIAEtAA86AA8gACABLQAQOgAQIAAgAS0AEToAESAAIAEtABI6ABIgACABLQATOgATIAAgAS0AFDoAFCAAIAEtABU6ABUgACABLQAWOgAWIAAgAS0AFzoAFyAAIAEtABg6ABggACABLQAZOgAZIAAgAS0AGjoAGiAAIAEtABs6ABsgACABLQAcOgAcIAAgAS0AHToAHSAAIAEtAB46AB4gAS0AHyEDIAAgAgR/IAAgAC0AAEH4AXE6AAAgA0HAAHIFIAMLQf8AcToAHyAEIAAQMCAAIAQQIkF/IQMgAC0AH0H/AHEgAC0AHiAALQAdIAAtABwgAC0AGyAALQAaIAAtABkgAC0AGCAALQAXIAAtABYgAC0AFSAALQAUIAAtABMgAC0AEiAALQARIAAtABAgAC0ADyAALQAOIAAtAA0gAC0ADCAALQALIAAtAAogAC0ACSAALQAIIAAtAAcgAC0ABiAALQAFIAAtAAQgAC0AAyAALQACIAAtAAEgAC0AAEEBc3JycnJycnJycnJycnJycnJycnJycnJycnJycnJycnJBAWtBgAJxRQRAQX9BACABQSAQGxshAwsgBEGgAWokACADC5AFAQJ/IwBBwAJrIgQkAEF/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IAw3AzggCCAONwMwIAggCzcDKCAIIA03AyAgCELx7fT4paf9p6V/NwMYIAhCq/DT9K/uvLc8NwMQIAhCu86qptjQ67O7fzcDCCAIIAGtQoiS95X/zPmE6gCFNwMACyADQgBSBEAgCEHgAGohBUGAAiAGayIErSILIANUBEAgCEHgAWohBwNAIAQEQCAFIAZqIAIgBPwKAAALIAggCCgC4AIgBGo2AuACIAggCCkDQCIMQoABfDcDQCAIIAgpA0ggDEL/flatfDcDSCAIIAUQXiAFIAdBgAH8CgAAIAggCCgC4AIiCUGAAWsiBjYC4AIgAiAEaiECIAMgC30iA0GAAyAJayIErSILVg0ACwsgA6ciBARAIAUgBmogAiAE/AoAAAsgCCAIKALgAiAEajYC4AILIAggACABEJ8BGiAKJABBAAwBCxAMAAshCAsgCAsKACAAIAEgAhAIC+YDAQJ/IwBBwAFrIgMkACADQgA3A4ABIANCADcDiAEgA0IANwOQASADQgA3A5gBIANCADcDYCADQgA3A2ggA0IANwNwIANCADcDeCADQZC3AikDADcDoAEgA0GYtwIpAwA3A6gBIANBoLcCKQMANwOwASADQai3AikDADcDuAEgAyACKQAANwNAIAMgAikACDcDSCADIAIpABA3A1AgAyACKQAYNwNYIANBgAFqIgIgA0FAayIEEKEBIAIQJiADIAMpA5gBNwMYIAMgAykDkAE3AxAgAyADKQOIATcDCCADIAMpA4ABNwMAIANCADcDeCADQgA3A3AgA0IANwNoIANCADcDYCADIAEpAAA3A0AgAyABKQAINwNIIAMgASkAEDcDUCADIAEpABg3A1ggA0IANwM4IANCADcDMCADQgA3AyggA0IANwMgIAQgAxCeAiADIAMpA3g3A7gBIAMgAykDcDcDsAEgAyADKQNoNwOoASADIAMpA2A3A6ABIAMgAykDWDcDmAEgAyADKQNQNwOQASADIAMpA0g3A4gBIAMgAykDQDcDgAEgAhAmIAAgAykDmAE3ABggACADKQOQATcAECAAIAMpA4gBNwAIIAAgAykDgAE3AAAgAkHAABAHIANBwAFqJAALlwEBAX8jAEFAaiICJAAgAiABKQA4NwM4IAIgASkAMDcDMCACIAEpACg3AyggAiABKQAgNwMgIAIgASkAGDcDGCACIAEpABA3AxAgAiABKQAINwMIIAIgASkAADcDACACECYgACACKQMYNwAYIAAgAikDEDcAECAAIAIpAwg3AAggACACKQMANwAAIAJBwAAQByACQUBrJAALvQIBAX8jAEHAAWsiAyQAIANCADcDYCADQgA3A2ggA0IANwNwIANCADcDeCADIAEpAAA3A0AgAyABKQAINwNIIAMgASkAEDcDUCADIAEpABg3A1ggA0IANwMgIANCADcDKCADQgA3AzAgA0IANwM4IAMgAikAADcDACADIAIpAAg3AwggAyACKQAQNwMQIAMgAikAGDcDGCADQUBrIAMQngIgAyADKQN4NwO4ASADIAMpA3A3A7ABIAMgAykDaDcDqAEgAyADKQNgNwOgASADIAMpA1g3A5gBIAMgAykDUDcDkAEgAyADKQNINwOIASADIAMpA0A3A4ABIANBgAFqIgEQJiAAIAMpA5gBNwAYIAAgAykDkAE3ABAgACADKQOIATcACCAAIAMpA4ABNwAAIAFBwAAQByADQcABaiQAC+UBAQF/IwBBgAFrIgIkACACQgA3A0AgAkIANwNIIAJCADcDUCACQgA3A1ggAkEBOgBAIAJCADcDICACQgA3AyggAkIANwMwIAJCADcDOCACQZC3AikDADcDYCACQZi3AikDADcDaCACQaC3AikDADcDcCACQai3AikDADcDeCACIAEpABg3AxggAiABKQAQNwMQIAIgASkACDcDCCACIAEpAAA3AwAgAkFAayIBIAIQoQEgARAmIAAgAikDWDcAGCAAIAIpA1A3ABAgACACKQNINwAIIAAgAikDQDcAACACQYABaiQAC94BAQF/IwBBgAFrIgIkACACQgA3A0AgAkIANwNIIAJCADcDUCACQgA3A1ggAkIANwMgIAJCADcDKCACQgA3AzAgAkIANwM4IAJBkLcCKQMANwNgIAJBmLcCKQMANwNoIAJBoLcCKQMANwNwIAJBqLcCKQMANwN4IAIgASkAADcDACACIAEpAAg3AwggAiABKQAQNwMQIAIgASkAGDcDGCACQUBrIgEgAhChASABECYgACACKQNYNwAYIAAgAikDUDcAECAAIAIpA0g3AAggACACKQNANwAAIAJBgAFqJAALzwsBC38jAEHgBWsiAiQAIAJBwAVqIgcgASABEAggAkHgAWoiBiABIAcQCCACQaAFaiIEIAEgBhAIIAJBgAVqIgUgBCAEEAggAkGgA2oiCSAHIAUQCCACQcACaiIHIAEgCRAIIAJB4ARqIgMgBSAFEAggAkGgAmoiBSAHIAcQCCACQcAEaiIIIAkgBRAIIAJBwANqIgwgAyAFEAggAkGgBGoiCiAIIAgQCCACQYADaiIIIAMgChAIIAJB4AJqIgsgBiAIEAggAkHAAWoiBiADIAsQCCACQaABaiIDIAQgBhAIIAJB4ABqIAQgAxAIIAJBgARqIgYgCiALEAggAkHgA2oiAyAEIAYQCCACQYACaiIGIAwgAxAIIAJBgAFqIAUgBhAIIAJBQGsiBSAIIAMQCCACQSBqIgMgBCAFEAggAiAJIAMQCCAAIAcgAhAIQQAhBANAIAAgACAAEAggBEEBaiIEQf4ARw0ACyAAIAAgAkHgAmoQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgAkHABWoQCCAAIAAgAhAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAJBoAFqEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAIQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAJBgAJqEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACACQUBrEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAJB4ABqEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAJBwAJqEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACACQYAEahAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAJBwAFqEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAJB4ANqEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgAhAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgAkGAAWoQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAAQCCAAIAAgABAIIAAgACAAEAggACAAIAJBIGoQCCACQeAFaiQAQQAgAUEgEBtrCygAA0AgAEEgEBYgACAALQAfQR9xOgAfIAAQqAFFDQAgAEEgEBsNAAsLCgAgACABIAIQOQsaAQF/EDpB3MgCKAIAKAIIIgAEQCAAERQACwsoACACQoCAgIAQWgRAEAwACyAAIAEgAiADQQEgBEHkvQIoAgAREQAaCwQAQQwLqwYBFH8jAEHgAWsiAyQAIAIoAhAhBCACQUBrIgUoAgAhBiACKAJQIQkgAigCICEKIAIoAjAhCyACKAIUIQcgAigCRCEMIAIoAlQhDSABKAAEIQ4gAigCJCEPIAIoAjQhECACKAIYIQggAigCSCERIAIoAlghEiABKAAIIRMgAigCKCEUIAIoAjghFSABKAAAIRYgACACKAIsIAIoAjxxIAIoAhwgAigCTCACKAJcIAEoAAxzc3NzIgE2AAwgACAUIBVxIAggESASIBNzc3NzIgg2AAggACAPIBBxIAcgDCAN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AhQhDSACKAJEIQ4gAigCVCEPIAIoAiQhECACKAI0IREgASgACCEHIAIoAhghEiACKAJIIRMgAigCWCEUIAIoAighFSACKAI4IRYgASgAACEIIAAgASgADCIBIAIoAiwgAigCPHEgAigCHCACKAJcIAIoAkxzc3NzNgAMIAAgByAVIBZxIBIgEyAUc3NzczYACCAAIAYgECARcSANIA4gD3Nzc3M2AAQgACAIIAsgDHEgBSAJIApzc3NzNgAAIAMgAikCWDcD2AEgAyACKQJQNwPQASADIAQpAgA3A7ABIAMgAikCSDcDuAEgAyACKQJQNwOgASADIAIpAlg3A6gBIANBwAFqIgAgA0GwAWogA0GgAWoQBiACIAMpAsgBNwJYIAIgAykCwAE3AlAgAyACKQIwNwOQASADIAIpAjg3A5gBIAMgBCkCADcDgAEgAyACKQJINwOIASAAIANBkAFqIANBgAFqEAYgAiADKQLIATcCSCAEIAMpAsABNwIAIAMgAikCIDcDcCADIAIpAig3A3ggAyACKQIwNwNgIAMgAikCODcDaCAAIANB8ABqIANB4ABqEAYgAiADKQLIATcCOCACIAMpAsABNwIwIAMgAikCEDcDUCADIAIpAhg3A1ggAyACKQIgNwNAIAMgAikCKDcDSCAAIANB0ABqIANBQGsQBiACIAMpAsgBNwIoIAIgAykCwAE3AiAgAyACKQIANwMwIAMgAikCCDcDOCADIAIpAhA3AyAgAyACKQIYNwMoIAAgA0EwaiADQSBqEAYgAiADKQLIATcCGCACIAMpAsABNwIQIAMgAykD0AE3AxAgAyADKQPYATcDGCADIAIpAgA3AwAgAyACKQIINwMIIAAgA0EQaiADEAYgAygCwAEhACADKALEASEEIAMoAsgBIQUgAiABIAMoAswBczYCDCACIAUgB3M2AgggAiAEIAZzNgIEIAIgACAIczYCACADQeABaiQAC6UJAQ1/IwBBoANrIgIkACAAKAAQIQYgACgAFCEHIAAoABghCCAAKAAcIQkgACgABCEEIAAoAAghBSAAKAAMIQogACgAACELIAIgASkCWDcDmAMgAiABKQJQNwOQAyACIAFBQGsiACkCADcD8AIgAiABKQJINwP4AiACIAEpAlA3A+ACIAIgASkCWDcD6AIgAkGAA2oiAyACQfACaiACQeACahAGIAEgAikCiAM3AlggASACKQKAAzcCUCACIAEpAjA3A9ACIAIgASkCODcD2AIgAiAAKQIANwPAAiACIAEpAkg3A8gCIAMgAkHQAmogAkHAAmoQBiABIAIpAogDNwJIIAAgAikCgAM3AgAgAiABKQIgNwOwAiACIAEpAig3A7gCIAIgASkCMDcDoAIgAiABKQI4NwOoAiADIAJBsAJqIAJBoAJqEAYgASACKQKIAzcCOCABIAIpAoADNwIwIAIgASkCEDcDkAIgAiABKQIYNwOYAiACIAEpAiA3A4ACIAIgASkCKDcDiAIgAyACQZACaiACQYACahAGIAEgAikCiAM3AiggASACKQKAAzcCICACIAEpAgA3A/ABIAIgASkCCDcD+AEgAiABKQIQNwPgASACIAEpAhg3A+gBIAMgAkHwAWogAkHgAWoQBiABIAIpAogDNwIYIAEgAikCgAM3AhAgAiACKQOQAzcD0AEgAiACKQOYAzcD2AEgAiABKQIANwPAASACIAEpAgg3A8gBIAMgAkHQAWogAkHAAWoQBiACKAKAAyEMIAIoAoQDIQ0gAigCiAMhDiABIAogAigCjANzNgIMIAEgBSAOczYCCCABIAQgDXM2AgQgASALIAxzNgIAIAIgASkCWDcDmAMgAiABKQJQNwOQAyACIAApAgA3A7ABIAIgASkCSDcDuAEgAiABKQJQNwOgASACIAEpAlg3A6gBIAMgAkGwAWogAkGgAWoQBiABIAIpAogDNwJYIAEgAikCgAM3AlAgAiABKQIwNwOQASACIAEpAjg3A5gBIAIgACkCADcDgAEgAiABKQJINwOIASADIAJBkAFqIAJBgAFqEAYgASACKQKIAzcCSCAAIAIpAoADNwIAIAIgASkCIDcDcCACIAEpAig3A3ggAiABKQIwNwNgIAIgASkCODcDaCADIAJB8ABqIAJB4ABqEAYgASACKQKIAzcCOCABIAIpAoADNwIwIAIgASkCEDcDUCACIAEpAhg3A1ggAiABKQIgNwNAIAIgASkCKDcDSCADIAJB0ABqIAJBQGsQBiABIAIpAogDNwIoIAEgAikCgAM3AiAgAiABKQIANwMwIAIgASkCCDcDOCACIAEpAhA3AyAgAiABKQIYNwMoIAMgAkEwaiACQSBqEAYgASACKQKIAzcCGCABIAIpAoADNwIQIAIgAikDkAM3AxAgAiACKQOYAzcDGCACIAEpAgA3AwAgAiABKQIINwMIIAMgAkEQaiACEAYgAigCgAMhACACKAKEAyEEIAIoAogDIQUgASAJIAIoAowDczYCDCABIAUgCHM2AgggASAEIAdzNgIEIAEgACAGczYCACACQaADaiQAC94UARV/IwBBoAZrIgMkACABKAAEIQggASgACCEJIAEoAAwhCiABKAAQIQsgASgAFCEMIAEoABghDSABKAAcIQ4gACgABCEPIAAoAAghECAAKAAMIREgACgAECESIAAoABQhEyAAKAAYIRQgACgAHCEVIAEoAAAhFiACQUBrIgEgACgAACIAQYCChBBzNgIAIAJClcTcyYWy+rziADcCOCACQoCChJCwoIGEDTcCMCACQqCixJG0rq2UXTcCKCACQtv74KjVzfCXcTcCICACIAAgFnMiFjYCACACIBVB8+qi6X1zNgJcIAIgFEGgosSRBHM2AlggAiATQe2Ev4l/czYCVCACIBJB2/vgqAVzNgJQIAIgEUGQ0+eTBnM2AkwgAiAQQZXE3MkFczYCSCACIA9Bg4qg6ABzNgJEIAIgDiAVcyIONgIcIAIgDSAUcyINNgIYIAIgDCATcyIMNgIUIAIgCyAScyILNgIQIAIgCiARcyIKNgIMIAIgCSAQcyIJNgIIIAIgCCAPcyIXNgIEQQAhCANAIAMgAikCWDcDmAYgAyACKQJQNwOQBiADIAEpAgA3A/AFIAMgASkCCDcD+AUgAyACKQJQNwPgBSADIAIpAlg3A+gFIANBgAZqIgQgA0HwBWogA0HgBWoQBiACIAMpAogGNwJYIAIgAykCgAY3AlAgAyACKQIwNwPQBSADIAIpAjg3A9gFIAMgASkCADcDwAUgAyABKQIINwPIBSAEIANB0AVqIANBwAVqEAYgASADKQKIBjcCCCABIAMpAoAGNwIAIAMgAikCIDcDsAUgAyACKQIoNwO4BSADIAIpAjA3A6AFIAMgAikCODcDqAUgBCADQbAFaiADQaAFahAGIAIgAykCiAY3AjggAiADKQKABjcCMCADIAIpAhA3A5AFIAMgAikCGDcDmAUgAyACKQIgNwOABSADIAIpAig3A4gFIAQgA0GQBWogA0GABWoQBiACIAMpAogGNwIoIAIgAykCgAY3AiAgAyACKQIANwPwBCADIAIpAgg3A/gEIAMgAikCEDcD4AQgAyACKQIYNwPoBCAEIANB8ARqIANB4ARqEAYgAiADKQKIBjcCGCACIAMpAoAGNwIQIAMgAykDkAY3A9AEIAMgAykDmAY3A9gEIAMgAikCADcDwAQgAyACKQIINwPIBCAEIANB0ARqIANBwARqEAYgAygCgAYhBSADKAKEBiEGIAMoAogGIQcgAiADKAKMBiARczYCDCACIAcgEHM2AgggAiAGIA9zNgIEIAIgACAFczYCACADIAIpAlg3A5gGIAMgAikCUDcDkAYgAyABKQIANwOwBCADIAEpAgg3A7gEIAMgAikCWDcDqAQgAyACKQJQNwOgBCAEIANBsARqIANBoARqEAYgAiADKQKIBjcCWCACIAMpAoAGNwJQIAMgAikCMDcDkAQgAyACKQI4NwOYBCADIAEpAgA3A4AEIAMgASkCCDcDiAQgBCADQZAEaiADQYAEahAGIAEgAykCiAY3AgggASADKQKABjcCACADIAIpAiA3A/ADIAMgAikCKDcD+AMgAyACKQIwNwPgAyADIAIpAjg3A+gDIAQgA0HwA2ogA0HgA2oQBiACIAMpAogGNwI4IAIgAykCgAY3AjAgAyACKQIQNwPQAyADIAIpAhg3A9gDIAMgAikCIDcDwAMgAyACKQIoNwPIAyAEIANB0ANqIANBwANqEAYgAiADKQKIBjcCKCACIAMpAoAGNwIgIAMgAikCADcDsAMgAyACKQIINwO4AyADIAIpAhA3A6ADIAMgAikCGDcDqAMgBCADQbADaiADQaADahAGIAIgAykCiAY3AhggAiADKQKABjcCECADIAMpA5AGNwOQAyADIAMpA5gGNwOYAyADIAIpAgA3A4ADIAMgAikCCDcDiAMgBCADQZADaiADQYADahAGIAMoAoAGIQUgAygChAYhBiADKAKIBiEHIAIgAygCjAYgFXM2AgwgAiAHIBRzNgIIIAIgBiATczYCBCACIAUgEnM2AgAgAyACKQJYNwOYBiADIAIpAlA3A5AGIAMgASkCADcD8AIgAyABKQIINwP4AiADIAIpAlg3A+gCIAMgAikCUDcD4AIgBCADQfACaiADQeACahAGIAIgAykCiAY3AlggAiADKQKABjcCUCADIAIpAjA3A9ACIAMgAikCODcD2AIgAyABKQIANwPAAiADIAEpAgg3A8gCIAQgA0HQAmogA0HAAmoQBiABIAMpAogGNwIIIAEgAykCgAY3AgAgAyACKQIgNwOwAiADIAIpAig3A7gCIAMgAikCMDcDoAIgAyACKQI4NwOoAiAEIANBsAJqIANBoAJqEAYgAiADKQKIBjcCOCACIAMpAoAGNwIwIAMgAikCEDcDkAIgAyACKQIYNwOYAiADIAIpAiA3A4ACIAMgAikCKDcDiAIgBCADQZACaiADQYACahAGIAIgAykCiAY3AiggAiADKQKABjcCICADIAIpAgA3A/ABIAMgAikCCDcD+AEgAyACKQIQNwPgASADIAIpAhg3A+gBIAQgA0HwAWogA0HgAWoQBiACIAMpAogGNwIYIAIgAykCgAY3AhAgAyADKQOQBjcD0AEgAyADKQOYBjcD2AEgAyACKQIANwPAASADIAIpAgg3A8gBIAQgA0HQAWogA0HAAWoQBiADKAKABiEFIAMoAoQGIQYgAygCiAYhByACIAMoAowGIApzNgIMIAIgByAJczYCCCACIAYgF3M2AgQgAiAFIBZzNgIAIAMgAikCWDcDmAYgAyACKQJQNwOQBiADIAEpAgA3A7ABIAMgASkCCDcDuAEgAyACKQJYNwOoASADIAIpAlA3A6ABIAQgA0GwAWogA0GgAWoQBiACIAMpAogGNwJYIAIgAykCgAY3AlAgAyACKQIwNwOQASADIAIpAjg3A5gBIAMgASkCADcDgAEgAyABKQIINwOIASAEIANBkAFqIANBgAFqEAYgASADKQKIBjcCCCABIAMpAoAGNwIAIAMgAikCIDcDcCADIAIpAig3A3ggAyACKQIwNwNgIAMgAikCODcDaCAEIANB8ABqIANB4ABqEAYgAiADKQKIBjcCOCACIAMpAoAGNwIwIAMgAikCEDcDUCADIAIpAhg3A1ggAyACKQIgNwNAIAMgAikCKDcDSCAEIANB0ABqIANBQGsQBiACIAMpAogGNwIoIAIgAykCgAY3AiAgAyACKQIANwMwIAMgAikCCDcDOCADIAIpAhA3AyAgAyACKQIYNwMoIAQgA0EwaiADQSBqEAYgAiADKQKIBjcCGCACIAMpAoAGNwIQIAMgAykDkAY3AxAgAyADKQOYBjcDGCADIAIpAgA3AwAgAyACKQIINwMIIAQgA0EQaiADEAYgAygCgAYhBSADKAKEBiEGIAMoAogGIQcgAiADKAKMBiAOczYCDCACIAcgDXM2AgggAiAGIAxzNgIEIAIgBSALczYCACAIQQFqIghBBEcNAAsgA0GgBmokAAsEAEFfC2MBBX8DQCAAIANqIgIgASADai0AACAEIAItAABqaiICOgAAIAAgA0EBciIEaiIGIAEgBGotAAAgBi0AACACQQh2amoiAjoAACACQQh2IQQgA0ECaiEDIAVBAmoiBUEgRw0ACwuRCQEefyMAQaACayIDJAAgAigCECEOIAIoAjAhDyACKAIUIRAgASgABCERIAIoAjQhEiACKAIYIRMgASgACCEUIAIoAjghFSACKAIcIQggASgADCEWIAIoAjwhFyACKAIgIQUgAigCUCEJIAEoABAhGCACKAJwIRkgAigCYCEEIAIoAiQhBiACKAJUIQogASgAFCEaIAIoAnQhGyACKAJkIQwgAigCKCEHIAIoAlghCyABKAAYIRwgAigCeCEdIAIoAmghDSABKAAAIR4gACACKAIsIh8gAigCbCIgIAIoAnxxIAIoAlwgASgAHHNzcyIBNgAcIAAgByANIB1xIAsgHHNzcyILNgAYIAAgBiAMIBtxIAogGnNzcyIKNgAUIAAgBSAEIBlxIAkgGHNzcyIJNgAQIAAgICAXIB9xIAggFnNzcyIINgAMIAAgDSAHIBVxIBMgFHNzcyIHNgAIIAAgDCAGIBJxIBAgEXNzcyIGNgAEIAAgBCAFIA9xIA4gHnNzcyIFNgAAIAMgAikCeDcDmAIgAyACKQJwNwOQAiADIAIpAmA3A/ABIAMgAikCaDcD+AEgAyACKQJwNwPgASADIAIpAng3A+gBIANBgAJqIgQgA0HwAWogA0HgAWoQBiACIAMpAogCNwJ4IAIgAykCgAI3AnAgAyACKQJQNwPQASADIAIpAlg3A9gBIAMgAikCYDcDwAEgAyACKQJoNwPIASAEIANB0AFqIANBwAFqEAYgAiADKQKIAjcCaCACIAMpAoACNwJgIAMgAkFAayIAKQIANwOwASADIAIpAkg3A7gBIAMgAikCUDcDoAEgAyACKQJYNwOoASAEIANBsAFqIANBoAFqEAYgAiADKQKIAjcCWCACIAMpAoACNwJQIAMgAikCMDcDkAEgAyACKQI4NwOYASADIAApAgA3A4ABIAMg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aCAEIANB8ABqIANB4ABqEAYgAiADKQKIAjcCOCACIAMpAoACNwIwIAMgAikCEDcDUCADIAIpAhg3A1ggAyACKQIgNwNAIAMgAikCKDcDSCAEIANB0ABqIANBQGsQBiACIAMpAogCNwIoIAIgAykCgAI3AiAgAyACKQIANwMwIAMgAikCCDcDOCADIAIpAhA3AyAgAyACKQIYNwMoIAQgA0EwaiADQSBqEAYgAiADKQKIAjcCGCACIAMpAoACNwIQIAMgAykDkAI3AxAgAyADKQOYAjcDGCADIAIpAgA3AwAgAyACKQIINwMIIAQgA0EQaiADEAYgAiADKQKIAjcCCCACIAMpAoACNwIAIAIgByACKAIMczYCDCACIAYgAigCCHM2AgggAiAFIAIoAgRzNgIEIAIgECACKAIAczYCACAAIAggACgCAHM2AgAgAiALIAIoAkRzNgJEIAIgDiACKAJIczYCSCACIAEgAigCTHM2AkwgA0GgAmokAAuZDQESfyMAQaAEayICJAAgACgAPCEEIAAoADghBSAAKAA0IQYgACgAMCEHIAAoACAhCCAAKAAkIQkgACgAKCEKIAAoACwhCyAAKAAcIQwgACgAGCENIAAoABQhDiAAKAAQIQ8gACgABCEQIAAoAAghESAAKAAMIRIgACgAACETIAIgASkCeDcDmAQgAiABKQJwNwOQBCACIAEpAmA3A/ADIAIgASkCaDcD+AMgAiABKQJwNwPgAyACIAEpAng3A+gDIAJBgARqIgMgAkHwA2ogAkHgA2oQBiABIAIpAogENwJ4IAEgAikCgAQ3AnAgAiABKQJQNwPQAyACIAEpAlg3A9gDIAIgASkCYDcDwAMgAiABKQJoNwPIAyADIAJB0ANqIAJBwANqEAYgASACKQKIBDcCaCABIAIpAoAENwJgIAIgAUFAayIAKQIANwOwAyACIAEpAkg3A7gDIAIgASkCUDcDoAMgAiABKQJYNwOoAyADIAJBsANqIAJBoANqEAYgASACKQKIBDcCWCABIAIpAoAENwJQIAIgASkCMDcDkAMgAiABKQI4NwOYAyACIAApAgA3A4ADIAIgASkCSDcDiAMgAyACQZADaiACQYADahAGIAEgAikCiAQ3AkggACACKQKABDcCACACIAEpAiA3A/ACIAIgASkCKDcD+AIgAiABKQIwNwPgAiACIAEpAjg3A+gCIAMgAkHwAmogAkHgAmoQBiABIAIpAogENwI4IAEgAikCgAQ3AjAgAiABKQIQNwPQAiACIAEpAhg3A9gCIAIgASkCIDcDwAIgAiABKQIoNwPIAiADIAJB0AJqIAJBwAJqEAYgASACKQKIBDcCKCABIAIpAoAENwIgIAIgASkCADcDsAIgAiABKQIINwO4AiACIAEpAhA3A6ACIAIgASkCGDcDqAIgAyACQbACaiACQaACahAGIAEgAikCiAQ3AhggASACKQKABDcCECACIAIpA5AENwOQAiACIAIpA5gENwOYAiACIAEpAgA3A4ACIAIgASkCCDcDiAIgAyACQZACaiACQYACahAGIAEgAikCiAQ3AgggASACKQKABDcCACABIBIgASgCDHM2AgwgASARIAEoAghzNgIIIAEgECABKAIEczYCBCABIBMgASgCAHM2AgAgACAPIAAoAgBzNgIAIAEgDiABKAJEczYCRCABIA0gASgCSHM2AkggASAMIAEoAkxzNgJMIAIgASkCeDcDmAQgAiABKQJwNwOQBCACIAEpAmA3A/ABIAIgASkCaDcD+AEgAiABKQJwNwPgASACIAEpAng3A+gBIAMgAkHwAWogAkHgAWoQBiABIAIpAogENwJ4IAEgAikCgAQ3AnAgAiABKQJQNwPQASACIAEpAlg3A9gBIAIgASkCYDcDwAEgAiABKQJoNwPIASADIAJB0AFqIAJBwAFqEAYgASACKQKIBDcCaCABIAIpAoAENwJgIAIgACkCADcDsAEgAiABKQJINwO4ASACIAEpAlA3A6ABIAIgASkCWDcDqAEgAyACQbABaiACQaABahAGIAEgAikCiAQ3AlggASACKQKABDcCUCACIAEpAjA3A5ABIAIgASkCODcDmAEgAiAAKQIANwOAASACIAEpAkg3A4gBIAMgAkGQAWogAkGAAWoQBiABIAIpAogENwJIIAAgAikCgAQ3AgAgAiABKQIgNwNwIAIgASkCKDcDeCACIAEpAjA3A2AgAiABKQI4NwNoIAMgAkHwAGogAkHgAGoQBiABIAIpAogENwI4IAEgAikCgAQ3AjAgAiABKQIQNwNQIAIgASkCGDcDWCACIAEpAiA3A0AgAiABKQIoNwNIIAMgAkHQAGogAkFAaxAGIAEgAikCiAQ3AiggASACKQKABDcCICACIAEpAgA3AzAgAiABKQIINwM4IAIgASkCEDcDICACIAEpAhg3AyggAyACQTBqIAJBIGoQBiABIAIpAogENwIYIAEgAikCgAQ3AhAgAiACKQOQBDcDECACIAIpA5gENwMYIAIgASkCADcDACACIAEpAgg3AwggAyACQRBqIAIQBiABIAIpAogENwIIIAEgAikCgAQ3AgAgASALIAEoAgxzNgIMIAEgCiABKAIIczYCCCABIAkgASgCBHM2AgQgASAIIAEoAgBzNgIAIAAgByAAKAIAczYCACABIAYgASgCRHM2AkQgASAFIAEoAkhzNgJIIAEgBCABKAJMczYCTCACQaAEaiQAC5wJAQt/IwBBoAJrIgMkACABKAAEIQogASgACCELIAEoAAwhDCAAKAAEIQYgACgACCEHIAAoAAwhCCABKAAAIQ0gAiAAKAAAIgFBgIKEEHMiADYCcCACIAFB2/vgqAVzNgJgIAIgADYCUCACQUBrIgAgASANcyIFNgIAIAJCoKLEkbSurZRdNwI4IAJC2/vgqNXN8JdxNwIwIAJClcTcyYWy+rziADcCKCACQoCChJCwoIGEDTcCICACQqCixJG0rq2UXTcCGCACQtv74KjVzfCXcTcCECACIAU2AgAgAiAIQZDT55MGcyIFNgJ8IAIgB0GVxNzJBXMiBDYCeCACIAZBg4qg6ABzIgk2AnQgAiAIQfPqoul9czYCbCACIAdBoKLEkQRzNgJoIAIgBkHthL+Jf3M2AmQgAiAFNgJcIAIgBDYCWCACIAk2AlQgAiAIIAxzIgU2AkwgAiAHIAtzIgQ2AkggAiAGIApzIgk2AkQgAiAFNgIMIAIgBDYCCCACIAk2AgRBACEFA0AgAyACKQJ4NwOYAiADIAIpAnA3A5ACIAMgAikCYDcD8AEgAyACKQJoNwP4ASADIAIpAnA3A+ABIAMgAikCeDcD6AEgA0GAAmoiBCADQfABaiADQeABahAGIAIgAykCiAI3AnggAiADKQKAAjcCcCADIAIpAlA3A9ABIAMgAikCWDcD2AEgAyACKQJgNwPAASADIAIpAmg3A8gBIAQgA0HQAWogA0HAAWoQBiACIAMpAogCNwJoIAIgAykCgAI3AmAgAyAAKQIANwOwASADIAApAgg3A7gBIAMgAikCUDcDoAEgAyACKQJYNwOoASAEIANBsAFqIANBoAFqEAYgAiADKQKIAjcCWCACIAMpAoACNwJQIAMgAikCMDcDkAEgAyACKQI4NwOYASADIAApAgA3A4ABIAMgACkCCDcDiAEgBCADQZABaiADQYABahAGIAAgAykCiAI3AgggACADKQKAAjcCACADIAIpAiA3A3AgAyACKQIoNwN4IAMgAikCMDcDYCADIAIpAjg3A2ggBCADQfAAaiADQeAAahAGIAIgAykCiAI3AjggAiADKQKAAjcCMCADIAIpAhA3A1AgAyACKQIYNwNYIAMgAikCIDcDQCADIAIpAig3A0ggBCADQdAAaiADQUBrEAYgAiADKQKIAjcCKCACIAMpAoACNwIgIAMgAikCADcDMCADIAIpAgg3AzggAyACKQIQNwMgIAMgAikCGDcDKCAEIANBMGogA0EgahAGIAIgAykCiAI3AhggAiADKQKAAjcCECADIAMpA5ACNwMQIAMgAykDmAI3AxggAyACKQIANwMAIAMgAikCCDcDCCAEIANBEGogAxAGIAIgAykCiAI3AgggAiADKQKAAjcCACACIAIoAgwgDHM2AgwgAiACKAIIIAtzNgIIIAIgAigCBCAKczYCBCACIAIoAgAgDXM2AgAgACAAKAIAIAFzNgIAIAIgAigCRCAGczYCRCACIAIoAkggB3M2AkggAiACKAJMIAhzNgJMIAVBAWoiBUEKRw0ACyADQaACaiQAC28BBH9BASECA0AgACADaiIBIAIgAS0AAGoiAjoAACABIAEtAAEgAkEIdmoiAjoAASABIAEtAAIgAkEIdmoiAjoAAiABIAEtAAMgAkEIdmoiAToAAyABQQh2IQIgA0EEaiEDIARBBGoiBEEERw0ACwvsBAEFfyMAQfAAayIGJAAgAkIAUgRAIAYgBSkAGDcDGCAGIAUpABA3AxAgBiAFKQAINwMIIAYgBSkAADcDACAGIAMpAAA3A2AgBiAEPABoIAYgBEI4iDwAbyAGIARCMIg8AG4gBiAEQiiIPABtIAYgBEIgiDwAbCAGIARCGIg8AGsgBiAEQhCIPABqIAYgBEIIiDwAaQJAIAJCwABaBEADQEEAIQUgBkEgaiAGQeAAaiAGQQAQVBoDQCAAIAVqIAZBIGoiByAFai0AACABIAVqLQAAczoAACAAIAVBAXIiA2ogAyAHai0AACABIANqLQAAczoAACAFQQJqIgVBwABHDQALIAYgBi0AaEEBaiIDOgBoIAYgBi0AaSADQQh2aiIDOgBpIAYgBi0AaiADQQh2aiIDOgBqIAYgBi0AayADQQh2aiIDOgBrIAYgBi0AbCADQQh2aiIDOgBsIAYgBi0AbSADQQh2aiIDOgBtIAYgBi0AbiADQQh2aiIDOgBuIAYgBi0AbyADQQh2ajoAbyABQUBrIQEgAEFAayEAIAJCQHwiAkI/Vg0ACyACUA0BC0EAIQUgBkEgaiAGQeAAaiAGQQAQVBogAkIBUgRAIAKnIgNBAXEgA0E+cSEJQQAhAwNAIAAgBWogBkEgaiIKIAVqLQAAIAEgBWotAABzOgAAIAAgBUEBciIHaiAHIApqLQAAIAEgB2otAABzOgAAIAVBAmohBSADQQJqIgMgCUcNAAtFDQELIAAgBWogBkEgaiAFai0AACABIAVqLQAAczoAAAsgBkEgakHAABAHIAZBIBAHCyAGQfAAaiQAQQALhAQCB38BfiMAQfAAayIEJAAgAUIAUgRAIAQgAykAGDcDGCAEIAMpABA3AxAgBCADKQAINwMIIAQgAykAADcDACACKQAAIQsgBEIANwNoIAQgCzcDYAJAIAFCwABaBEADQCAAIARB4ABqIARBABBUGiAEIAQtAGhBAWoiAjoAaCAEIAQtAGkgAkEIdmoiAjoAaSAEIAQtAGogAkEIdmoiAjoAaiAEIAQtAGsgAkEIdmoiAjoAayAEIAQtAGwgAkEIdmoiAjoAbCAEIAQtAG0gAkEIdmoiAjoAbSAEIAQtAG4gAkEIdmoiAjoAbiAEIAQtAG8gAkEIdmo6AG8gAEFAayEAIAFCQHwiAUI/Vg0ACyABUA0BC0EAIQIgBEEgaiAEQeAAaiAEQQAQVBogAaciBkEDcSEHQQAhAyABQgRaBEAgBkE8cSEIQQAhBgNAIAAgA2ogBEEgaiIJIgUgA2otAAA6AAAgACADQQFyIgpqIAUgCmotAAA6AAAgACADQQJyIgVqIAUgCWotAAA6AAAgACADQQNyIgVqIARBIGogBWotAAA6AAAgA0EEaiEDIAZBBGoiBiAIRw0ACyAHRQ0BCwNAIAAgA2ogBEEgaiADai0AADoAACADQQFqIQMgAkEBaiICIAdHDQALCyAEQSBqQcAAEAcgBEEgEAcLIARB8ABqJABBAAuGBgEUfyMAQbACayICJAAgACABLQAAOgAAIAAgAS0AAToAASAAIAEtAAI6AAIgACABLQADOgADIAAgAS0ABDoABCAAIAEtAAU6AAUgACABLQAGOgAGIAAgAS0ABzoAByAAIAEtAAg6AAggACABLQAJOgAJIAAgAS0ACjoACiAAIAEtAAs6AAsgACABLQAMOgAMIAAgAS0ADToADSAAIAEtAA46AA4gACABLQAPOgAPIAAgAS0AEDoAECAAIAEtABE6ABEgACABLQASOgASIAAgAS0AEzoAEyAAIAEtABQ6ABQgACABLQAVOgAVIAAgAS0AFjoAFiAAIAEtABc6ABcgACABLQAYOgAYIAAgAS0AGToAGSAAIAEtABo6ABogACABLQAbOgAbIAAgAS0AHDoAHCAAIAEtAB06AB0gACABLQAeOgAeIAEtAB8hASAAIAAtAABB+AFxOgAAIAAgAUE/cUHAAHI6AB8gAkEwaiAAEDAgAigCgAEhASACKAJYIQMgAigChAEhBCACKAJcIQUgAigCiAEhBiACKAJgIQcgAigCjAEhCCACKAJkIQkgAigCkAEhCiACKAJoIQsgAigClAEhDCACKAJsIQ0gAigCmAEhDiACKAJwIQ8gAigCnAEhECACKAJ0IREgAigCoAEhEiACKAJ4IRMgAiACKAJ8IhQgAigCpAEiFWo2AqQCIAIgEiATajYCoAIgAiAQIBFqNgKcAiACIA4gD2o2ApgCIAIgDCANajYClAIgAiAKIAtqNgKQAiACIAggCWo2AowCIAIgBiAHajYCiAIgAiAEIAVqNgKEAiACIAEgA2o2AoACIAIgFSAUazYC9AEgAiASIBNrNgLwASACIBAgEWs2AuwBIAIgDiAPazYC6AEgAiAMIA1rNgLkASACIAogC2s2AuABIAIgCCAJazYC3AEgAiAGIAdrNgLYASACIAQgBWs2AtQBIAIgASADazYC0AEgAkHQAWoiASABEEUgAiACQYACaiABEAUgACACEA8gAkGwAmokAEEAC/QbAj1/DX4jAEHwAmsiAyQAA0AgAiAWai0AACIEIBZB0IoCaiIFLQAAcyAMciEMIAQgBS0AwAFzIAZyIQYgBCAFLQCgAXMgCnIhCiAEIAUtAIABcyAHciEHIAQgBS0AYHMgCHIhCCAEIAVBQGstAABzIAlyIQkgBCAFLQAgcyALciELIBZBAWoiFkEfRw0AC0F/IQUgAi0AH0H/AHEiBCALckH/AXFBAWsgBCAMckH/AXFBAWtyIAQgCXJB/wFxQQFrciAEQdcAcyAIckH/AXFBAWtyIARB/wBzIgQgB3JB/wFxQQFrciAEIApyQf8BcUEBa3IgBCAGckH/AXFBAWtyQYACcUUEQCADIAEpAAAiQDcD0AIgAyABKQAYNwPoAiADIAEpABA3A+ACIAMgASkACDcD2AIgAyBAp0H4AXE6ANACIAMgAy0A7wJBP3FBwAByOgDvAiADQaACaiACEDUgA0IANwL0ASADQQE2AvABIANCADcC/AEgA0IANwKEAiADQgA3AowCIANBADYClAIgA0IANwPAASADQgA3A8gBIANCADcD0AEgA0IANwPYASADQgA3A+ABIAMgAykDoAI3A5ABIAMgAykDqAI3A5gBIAMgAykDsAI3A6ABIAMgAykDuAI3A6gBIAMgAykDwAI3A7ABIANCADcCZCADQQE2AmAgA0IANwJsIANCADcCdCADQgA3AnwgA0EANgKEAUH+ASECQQAhFgNAIAMoApABIQQgAygC8AEhBSADKAJgIQwgAygCwAEhBiADKAKUASEKIAMoAvQBIQcgAygCZCEIIAMoAsQBIQkgAygCmAEhCyADKAL4ASENIAMoAmghFyADKALIASEOIAMoApwBIQ8gAygC/AEhECADKAJsIRQgAygCzAEhESADKAKgASESIAMoAoACIRMgAygCcCEVIAMoAtABIRggAygCpAEhGiADKAKEAiEZIAMoAnQhGyADKALUASEcIAMoAqgBIR0gAygCiAIhHiADKAJ4ITIgAygC2AEhHyADKAKsASEgIAMoAowCISEgAygCfCEiIAMoAtwBISMgAygCsAEhJCADKAKQAiElIAMoAoABISYgAygC4AEhJyADQQAgFiADQdACaiIzIAIiAUEDdmotAAAgAkEHcXZBAXEiFnNrIgIgAygCtAEiKCADKAKUAiIpc3EiKiAocyIoIAMoAoQBIisgAygC5AEiLHMgAnEiLSArcyIrazYCVCADICQgJCAlcyACcSIucyIkICYgJiAncyACcSIvcyImazYCUCADICAgICAhcyACcSIwcyIgICIgIiAjcyACcSIxcyIiazYCTCADICkgKnMiKSAsIC1zIiprNgIkIAMgJSAucyIlICcgL3MiJ2s2AiAgAyAhIDBzIiEgIyAxcyIjazYCHCADIB4gHSAecyACcSIscyIeIB8gHyAycyACcSItcyIfazYCGCADIBkgGSAacyACcSIucyIZIBwgGyAccyACcSIvcyIcazYCFCADIBMgEiATcyACcSIwcyITIBggFSAYcyACcSIxcyIYazYCECADIBAgDyAQcyACcSI0cyIQIBEgESAUcyACcSI1cyIRazYCDCADIA0gCyANcyACcSI2cyINIA4gDiAXcyACcSI3cyIOazYCCCADIAcgByAKcyACcSI4cyI5IAkgCCAJcyACcSI6cyI7azYCBCADIAUgBCAFcyACcSI8cyI9IAYgBiAMcyACcSI+cyI/azYCACADIC0gMnMiAjYCeCADIB0gLHMiHSACazYCSCADIBsgL3MiBTYCdCADIBogLnMiGiAFazYCRCADIBUgMXMiBjYCcCADIBIgMHMiEiAGazYCQCADIBQgNXMiBzYCbCADIA8gNHMiDyAHazYCPCADIBcgN3MiCTYCaCADIAsgNnMiCyAJazYCOCADIAggOnMiCDYCZCADIAogOHMiCiAIazYCNCADIAwgPnMiDDYCYCADIAQgPHMiBCAMazYCMCADICkgKmo2ApQCIAMgJSAnajYCkAIgAyAhICNqNgKMAiADIB4gH2o2AogCIAMgGSAcajYChAIgAyATIBhqNgKAAiADIBAgEWo2AvwBIAMgDSAOajYC+AEgAyA5IDtqNgL0ASADID0gP2o2AvABIAMgKCArajYC5AEgAyAkICZqNgLgASADICAgImo2AtwBIAMgAiAdajYC2AEgAyAFIBpqNgLUASADIAYgEmo2AtABIAMgCSALajYCyAEgAyAIIApqNgLEASADIAQgDGo2AsABIAMgByAPajYCzAEgA0HgAGoiGiADQTBqIgwgA0HwAWoiBRAFIANBwAFqIgQgBCADEAUgDCADEAQgAyAFEAQgAygCwAEhAiADKAJgIQYgAygCxAEhCiADKAJkIQcgAygCyAEhCCADKAJoIQkgAygCzAEhCyADKAJsIQ0gAygC0AEhFyADKAJwIQ4gAygC1AEhDyADKAJ0IRAgAygC2AEhFCADKAJ4IREgAygC3AEhEiADKAJ8IRMgAygC4AEhFSADKAKAASEYIAMgAygC5AEiGSADKAKEASIbajYCtAEgAyAVIBhqNgKwASADIBIgE2o2AqwBIAMgESAUajYCqAEgAyAPIBBqNgKkASADIA4gF2o2AqABIAMgCyANajYCnAEgAyAIIAlqNgKYASADIAcgCmo2ApQBIAMgAiAGajYCkAEgAyAbIBlrNgLkASADIBggFWs2AuABIAMgEyASazYC3AEgAyARIBRrNgLYASADIBAgD2s2AtQBIAMgDiAXazYC0AEgAyANIAtrNgLMASADIAkgCGs2AsgBIAMgByAKazYCxAEgAyAGIAJrNgLAASAFIAMgDBAFIAMoAkghAiADKAIYIQ4gAygCRCEGIAMoAhQhDyADKAJAIQogAygCECEQIAMoAjwhByADKAIMIRQgAygCOCEIIAMoAgghESADKAI0IQkgAygCBCESIAMoAlQhCyADKAIkIRMgAygCMCENIAMoAgAhFSADKAJMIRcgAygCHCEYIAMgAygCICADKAJQIhlrIhs2AiAgAyAYIBdrIhg2AhwgAyAVIA1rIhU2AgAgAyATIAtrIhM2AiQgAyASIAlrIhI2AgQgAyARIAhrIhE2AgggAyAUIAdrIhQ2AgwgAyAQIAprIhA2AhAgAyAPIAZrIg82AhQgAyAOIAJrIg42AhggBCAEEAQgA0GQAWoiHCAcEAQgAyAZIBusQsK2B34gGKxCwrYHfiJAQoCAgAh8IkJCGYd8IkEgQUKAgIAQfCJBQoCAgOAPg32najYCUCADIAIgDqxCwrYHfiAPrELCtgd+IkZCgICACHwiR0IZh3wiQyBDQoCAgBB8IkNCgICA4A+DfadqNgJIIAMgCiAQrELCtgd+IBSsQsK2B34iSEKAgIAIfCJJQhmHfCJEIERCgICAEHwiREKAgIDgD4N9p2o2AkAgAyAIIBGsQsK2B34gEqxCwrYHfiJKQoCAgAh8IktCGYd8IkUgRUKAgIAQfCJFQoCAgOAPg32najYCOCADIAsgE6xCwrYHfiJMIEFCGoh8IExCgICACHwiQUKAgIDwD4N9p2o2AlQgAyAXIENCGoggQHwgQkKAgIDwD4N9p2o2AkwgAyAGIERCGoggRnwgR0KAgIDwD4N9p2o2AkQgAyAHIEVCGoggSHwgSUKAgIDwD4N9p2o2AjwgAyAJIEogS0KAgIDwD4N9IEFCGYdCE34gFaxCwrYHfnwiQEKAgIAQfCJCQhqIfKdqNgI0IAMgDSBAIEJCgICA4A+DfadqNgIwIAFBAWshAiAaIANBoAJqIAQQBSAEIAMgDBAFIAENAAsgAygCkAEhFyADKALwASECIAMoApQBIQ4gAygC9AEhDCADKAKYASEPIAMoAvgBIQYgAygCnAEhECADKAL8ASEKIAMoAqABIRQgAygCgAIhByADKAKkASERIAMoAoQCIQggAygCqAEhEiADKAKIAiEJIAMoAqwBIRMgAygCjAIhCyADKAKwASEVIAMoApACIQ0gA0EAIBZrIgEgAygClAIiFiADKAK0AXNxIBZzNgKUAiADIA0gDSAVcyABcXM2ApACIAMgCyALIBNzIAFxczYCjAIgAyAJIAkgEnMgAXFzNgKIAiADIAggCCARcyABcXM2AoQCIAMgByAHIBRzIAFxczYCgAIgAyAKIAogEHMgAXFzNgL8ASADIAYgBiAPcyABcXM2AvgBIAMgDCAMIA5zIAFxczYC9AEgAyACIAIgF3MgAXFzNgLwASADKALAASECIAMoAmAhDSADKALEASEWIAMoAmQhFyADKALIASEMIAMoAmghDiADKALMASEGIAMoAmwhDyADKALQASEKIAMoAnAhECADKALUASEHIAMoAnQhFCADKALYASEIIAMoAnghESADKALcASEJIAMoAnwhEiADKALgASELIAMoAoABIRMgAyADKALkASIVIAMoAoQBcyABcSAVczYC5AEgAyALIAsgE3MgAXFzNgLgASADIAkgCSAScyABcXM2AtwBIAMgCCAIIBFzIAFxczYC2AEgAyAHIAcgFHMgAXFzNgLUASADIAogCiAQcyABcXM2AtABIAMgBiAGIA9zIAFxczYCzAEgAyAMIAwgDnMgAXFzNgLIASADIBYgFiAXcyABcXM2AsQBIAMgAiACIA1zIAFxczYCwAEgBCAEEEUgBSAFIAQQBSAAIAUQDyAzQSAQB0EAIQULIANB8AJqJAAgBQs4AQF/IwBBIGsiBiQAIAYgBCAFQQAQHxogACABIAKtIAOtQiCGhCAEQRBqQgAgBhBJIAZBIGokAAtAAQF/IwBBIGsiCCQAIAggBCAHQQAQHxogACABIAKtIAOtQiCGhCAEQRBqIAWtIAatQiCGhCAIEEkgCEEgaiQACzQBAX8jAEEgayIFJAAgBSADIARBABAf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KQAQNwPwAiAFIAApAAg3A+gCIAUgACkAADcD4AIgBSAAKQAkNwOAAyAFQeACaiIBIAFCKCAJIAAQfBogACAFKQP4AjcAGCAAIAUpA/ACNwAQIAAgBSkD6AI3AAggACAFKQPgAjcAACAFKQOAAyEKIABBATYAICAAIAo3ACQLIAIEQCACIAs3AwALQQAhDSADRQ0AIAMgBzoAAAsgBUGQA2okACANDAELEAwACwvbBQECfgJ/IAStIAWtQiCGhCEKIAetIAitQiCGhCELIwBBgANrIgQkACACBEAgAkIANwMACyAKQu////8PVARAIARBEGoiCELAACAAQSBqIgcgABBBGiAEQdAAaiIFIAhBrL0CKAIAEQAAGiAIQcAAEAcgBSAGIAtBsL0CKAIAEQIAGiAFQbC3AkIAIAt9Qg+DQbC9AigCABECABogBEIANwMQIARCADcDSCAEQgA3A0AgBEIANwM4IARCADcDMCAEQgA3AyggBEIANwMgIARCADcDGCAEIAk6ABAgCCAIQsAAIAdBASAAEEgaIAUgCELAAEGwvQIoAgARAgAaIAEgBC0AEDoAACABQQFqIgEgAyAKIAdBAiAAEEgaIAUgASAKQbC9AigCABECABogBUGwtwIgCkIPg0GwvQIoAgARAgAaIAQgCzcDCCAFIARBCGoiA0IIQbC9AigCABECABogBCAKQkB9NwMIIAUgA0IIQbC9AigCABECABogBSABIAqnaiIBQbS9AigCABEAABogBUGAAhAHIAAgAC0AJCABLQAAczoAJCAAIAAtACUgAS0AAXM6ACUgACAALQAmIAEtAAJzOgAmIAAgAC0AJyABLQADczoAJyAAIAAtACggAS0ABHM6ACggACAALQApIAEtAAVzOgApIAAgAC0AKiABLQAGczoAKiAAIAAtACsgAS0AB3M6ACsgBxCkAgJAIAlBAnFFBEAgB0EEEBtFDQELIAQgACkAGDcD6AIgBCAAKQAQNwPgAiAEIAApAAg3A9gCIAQgACkAADcD0AIgBCAAKQAkNwPwAiAEQdACaiIBIAFCKCAHIAAQfBogACAEKQPoAjcAGCAAIAQpA+ACNwAQIAAgBCkD2AI3AAggACAEKQPQAjcAACAEKQPwAiELIAdBATYAACAAIAs3ACQLIAIEQCACIApCEXw3AwALIARBgANqJABBAAwB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EQ8AIQELIAELgAEBA34gB60gCK1CIIaEIQxBfyECAkAgBK0gBa1CIIaEIgtCIFQNACALQiB9Ig1C3////w9WDQAgDELf////D1YNACAAIAMgDacgAyALp2pBIGtBICAGIAynIAkgCkHUvQIoAgARDwAhAgsgAQRAIAFCACALQiB9IAIbNwMACyACC2ABAn4gBK0gBa1CIIaEIQwgB60gCK1CIIaEIQ0gAgRAIAJCIDcDAAsgDULg////D1QgDELf////D1hxRQRAEAwACyAAIAFBICADIAynIAYgDacgCiALQdC9AigCABEPAAt2AQJ+An8gBq0gB61CIIaEIQsCQCADrSAErUIghoQiDELg////D1oNACALQuD///8PWg0AIAAgACAMpyIDakEgIAIgAyAFIAunIAkgCkHQvQIoAgARDwAhACABBEAgAUIAIAxCIHwgABs3AwALIAAMAQsQDAALC1kBAn4gB60gCK1CIIaEIQtBfyEBAkAgA60gBK1CIIaEIgxC3////w9WDQAgC0Lf////D1YNACAAIAIgDKcgBUEgIAYgC6cgCSAKQcy9AigCABEPACEBCyABC4ABAQN+IAetIAitQiCGhCEMQX8hAgJAIAStIAWtQiCGhCILQiBUDQAgC0IgfSINQt////8PVg0AIAxC3////w9WDQAgACADIA2nIAMgC6dqQSBrQSAgBiAMpyAJIApBzL0CKAIAEQ8AIQILIAEEQCABQgAgC0IgfSACGzcDAAsgAgtgAQJ+IAStIAWtQiCGhCEMIAetIAitQiCGhCENIAIEQCACQiA3AwALIA1C4P///w9UIAxC3////w9YcUUEQBAMAAsgACABQSAgAyAMpyAGIA2nIAogC0HIvQIoAgARDwALdgECfgJ/IAatIAetQiCGhCELAkAgA60gBK1CIIaEIgxC4P///w9aDQAgC0Lg////D1oNACAAIAAgDKciA2pBICACIAMgBSALpyAJIApByL0CKAIAEQ8AIQAgAQRAIAFCACAMQiB8IAAbNwMACyAADAELEAwACwsFAEHoAAsEAEEaCwUAQYEMCwUAQboKC54GAQV/IwAiBSEJIAVBgARrQUBxIgUkACAAIAEgABsiBgRAQX8hByAFQeAAaiIIIAMgBBAgRQRAIAVBgAFqIgNBAEEAQcAAEC4aIAMgCEIgEA0aIAhB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TQRAQcDEAkEcNgIAQX8MAQsgACABQQBCACAEQSAgBSAFQRBqEIsCCyAFQSBqJAALEgAgACABIAJBhL4CKAIAEQQACxIAIAAgASACQYC+AigCABEEAAsSACAAIAEgAkH8vQIoAgARBAALFAAgACABIAIgA0H4vQIoAgARDQALEgAgACABIAJB9L0CKAIAEQQAC7QBAQF/IAAgASgAAEH///8fcTYCACAAIAEoAANBAnZBg/7/H3E2AgQgACABKAAGQQR2Qf+B/x9xNgIIIAAgASgACUEGdkH//8AfcTYCDCABKAAMIQIgAEIANwIUIABCADcCHCAAQQA2AiQgACACQQh2Qf//P3E2AhAgACABKAAQNgIoIAAgASgAFDYCLCAAIAEoABg2AjAgASgAHCEBIABBADoAUCAAQgA3AzggACABNgI0QQALFAAgACABIAIgA0HwvQIoAgARDQALEgAgACABIAJB7L0CKAIAEQQACxIAIAAgASACQei9AigCABEEAAv/FgIXfwJ+IwBBsAhrIgMkACADQYAHaiACEB0gA0HQBWoiBCACQRBqEB0gAyADKALQByADKAKgBnMiBTYCwAUgAyADKALUByADKAKkBnMiBjYCxAUgAyADKALYByADKAKoBnMiBzYCyAUgAyADKALcByADKAKsBnMiCDYCzAUgBUEIdiAFQRB2ciAFQRh2ciAGQQh2ciAGQRB2ciAGQRh2ciAHQQh2ciAHQRB2ciAHQRh2ciAIQQh2ciAIQRB2ciAIQRh2ciAFciAGciAHciAIckH/AXFFBEAgAyACLQAAQdoAczoAwAUgAyACLQABQdoAczoAwQUgAyACLQACQdoAczoAwgUgAyACLQADQdoAczoAwwUgAyACLQAEQdoAczoAxAUgAyACLQAFQdoAczoAxQUgAyACLQAGQdoAczoAxgUgAyACLQAHQdoAczoAxwUgAyACLQAIQdoAczoAyAUgAyACLQAJQdoAczoAyQUgAyACLQAKQdoAczoAygUgAyACLQALQdoAczoAywUgAyACLQAMQdoAczoAzAUgAyACLQANQdoAczoAzQUgAyACLQAOQdoAczoAzgUgAyACLQAPQdoAczoAzwUgBCADQcAFahAdCyABNQAIIRogASkAACEbIANCADcDuAUgA0IANwOwBQJ/IBsgGkKAgPz/D4WEQgBSBEBBACEFQQAhBkGAgIAIDAELIANB//8DOwG6BUEBIQZB4AAhBUGAgHwLIQIgA0GQCGohFCADQYAIaiEVIANBoAhqIRZBACEHQQAhCANAIAMgAygCjAcgAnM2AqwFIAMgDUH/AXEgE0EYdCIXIA9B/wFxQRB0ciAOQf8BcUEIdHJyIgQgAygCiAdzNgKoBSADIApB/wFxIBJBGHQiGCAMQf8BcUEQdHIgC0H/AXFBCHRyciIJIAMoAoQHczYCpAUgAyARQf8BcSAGQRh0IhkgCEH/AXFBEHRyIAdB/wFxQQh0cnIiECADKAKAB3M2AqAFIAMgAygC3AUgAnM2ApwFIAMgAygC2AUgBHM2ApgFIAMgAygC1AUgCXM2ApQFIAMgAygC0AUgEHM2ApAFIAMgAykDqAU3A/gEIAMgAykDoAU3A/AEIAMgAykCmAc3A+gEIAMgAykCkAc3A+AEIANBgAVqIgQgA0HwBGogA0HgBGoQBiADIAMpAogFNwOoBSADIAMpAoAFNwOgBSADIAMpA5AFNwPQBCADIAMpA5gFNwPYBCADIAMpAuAFNwPABCADIAMpAugFNwPIBCAEIANB0ARqIANBwARqEAYgAyADKQKIBTcDmAUgAyADKQKABTcDkAUgAyADKQOgBTcDsAQgAyADKQOoBTcDuAQgAyADKQKgBzcDoAQgAyADKQKoBzcDqAQgBCADQbAEaiADQaAEahAGIAMgAykCiAU3A6gFIAMgAykCgAU3A6AFIAMgAykDkAU3A5AEIAMgAykDmAU3A5gEIAMgAykC8AU3A4AEIAMgAykC+AU3A4gEIAQgA0GQBGogA0GABGoQBiADIAMpAogFNwOYBSADIAMpAoAFNwOQBSADIAMpA6AFNwPwAyADIAMpA6gFNwP4AyADIAMpArAHNwPgAyADIAMpArgHNwPoAyAEIANB8ANqIANB4ANqEAYgAyADKQKIBTcDqAUgAyADKQKABTcDoAUgAyADKQOQBTcD0AMgAyADKQOYBTcD2AMgAyADKQKABjcDwAMgAyADKQKIBjcDyAMgBCADQdADaiADQcADahAGIAMgAykCiAU3A5gFIAMgAykCgAU3A5AFIAMgAykDoAU3A7ADIAMgAykDqAU3A7gDIAMgAykCwAc3A6ADIAMgAykCyAc3A6gDIAQgA0GwA2ogA0GgA2oQBiADIAMpAogFNwOoBSADIAMpAoAFNwOgBSADIAMpA5AFNwOQAyADIAMpA5gFNwOYAyADIAMpApAGNwOAAyADIAMpApgGNwOIAyAEIANBkANqIANBgANqEAYgAyADKQKIBTcDmAUgAyADKQKABTcDkAUgAyADKQOgBTcD8AIgAyADKQOoBTcD+AIgAyADKQLQBzcD4AIgAyADKQLYBzcD6AIgBCADQfACaiADQeACahAGIAMgAykCiAU3A6gFIAMgAykCgAU3A6AFIAMgAykDkAU3A9ACIAMgAykDmAU3A9gCIAMgAykCoAY3A8ACIAMgAykCqAY3A8gCIAQgA0HQAmogA0HAAmoQBiADIAMpAogFNwOYBSADIAMpAoAFNwOQBSADIAMpA6AFNwOwAiADIAMpA6gFNwO4AiADIAMpAuAHNwOgAiADIAMpAugHNwOoAiAEIANBsAJqIANBoAJqEAYgAyADKQKIBTcDqAUgAyADKQKABTcDoAUgAyADKQOQBTcDkAIgAyADKQOYBTcDmAIgAyADKQKwBjcDgAIgAyADKQK4BjcDiAIgBCADQZACaiADQYACahAGIAMgAykCiAU3A5gFIAMgAykCgAU3A5AFIAMgAykDoAU3A/ABIAMgAykDqAU3A/gBIAMgAykC8Ac3A+ABIAMgAykC+Ac3A+gBIAQgA0HwAWogA0HgAWoQBiADIAMpAogFNwOoBSADIAMpAoAFNwOgBSADIAMpA5AFNwPQASADIAMpA5gFNwPYASADIAMpAsAGNwPAASADIAMpAsgGNwPIASAEIANB0AFqIANBwAFqEAYgAyADKQKIBTcDmAUgAyADKQKABTcDkAUgAyADKQOgBTcDsAEgAyADKQOoBTcDuAEgAyAVKQIANwOgASADIBUpAgg3A6gBIAQgA0GwAWogA0GgAWoQBiADIAMpAogFNwOoBSADIAMpAoAFNwOgBSADIAMpA5AFNwOQASADIAMpA5gFNwOYASADIAMpAtAGNwOAASADIAMpAtgGNwOIASAEIANBkAFqIANBgAFqEAYgAyADKQKIBTcDmAUgAyADKQKABTcDkAUgAyADKQOgBTcDcCADIAMpA6gFNwN4IAMgFCkCADcDYCADIBQpAgg3A2ggBCADQfAAaiADQeAAahAGIAMgAykCiAU3A6gFIAMgAykCgAU3A6AFIAMgAykD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A5AFIAMgAykDoAU3A/ADIAMgAykDqAU3A/gDIAMgAykCsAc3A+ADIAMgAykCuAc3A+gDIAQgA0HwA2ogA0HgA2oQBiADIAMpAogFNwOoBSADIAMpAoAFNwOgBSADIAMpA5AFNwPQAyADIAMpA5gFNwPYAyADIAMpAoAGNwPAAyADIAMpAogGNwPIAyAEIANB0ANqIANBwANqEAYgAyADKQKIBTcDmAUgAyADKQKABTcDkAUgAyADKQOgBTcDsAMgAyADKQOoBTcDuAMgAyADKQLABzcDoAMgAyADKQLIBzcDqAMgBCADQbADaiADQaADahAGIAMgAykCiAU3A6gFIAMgAykCgAU3A6AFIAMgAykDkAU3A5ADIAMgAykDmAU3A5gDIAMgAykCkAY3A4ADIAMgAykCmAY3A4gDIAQgA0GQA2ogA0GAA2oQBiADIAMpAogFNwOYBSADIAMpAoAFNwOQBSADIAMpA6AFNwPwAiADIAMpA6gFNwP4AiADIAMpAtAHNwPgAiADIAMpAtgHNwPoAiAEIANB8AJqIANB4AJqEAYgAyADKQKIBTcDqAUgAyADKQKABTcDoAUgAyADKQOQBTcD0AIgAyADKQOYBTcD2AIgAyADKQKgBjcDwAIgAyADKQKoBjcDyAIgBCADQdACaiADQcACahAGIAMgAykCiAU3A5gFIAMgAykCgAU3A5AFIAMgAykDoAU3A7ACIAMgAykDqAU3A7gCIAMgAykC4Ac3A6ACIAMgAykC6Ac3A6gCIAQgA0GwAmogA0GgAmoQBiADIAMpAogFNwOoBSADIAMpAoAFNwOgBSADIAMpA5AFNwOQAiADIAMpA5gFNwOYAiADIAMpArAGNwOAAiADIAMpArgGNwOIAiAEIANBkAJqIANBgAJqEAYgAyADKQKIBTcDmAUgAyADKQKABTcDkAUgAyADKQOgBTcD8AEgAyADKQOoBTcD+AEgAyADKQLwBzcD4AEgAyADKQL4BzcD6AEgBCADQfABaiADQeABahAGIAMgAykCiAU3A6gFIAMgAykCgAU3A6AFIAMgAykDkAU3A9ABIAMgAykDmAU3A9gBIAMgAykCwAY3A8ABIAMgAykCyAY3A8gBIAQgA0HQAWogA0HAAWoQBiADIAMpAogFNwOYBSADIAMpAoAFNwOQBSADIAMpA6AFNwOwASADIAMpA6gFNwO4ASADIBUpAgA3A6ABIAMgFSkCCDcDqAEgBCADQbABaiADQaABahAGIAMgAykCiAU3A6gFIAMgAykCgAU3A6AFIAMgAykDkAU3A5ABIAMgAykDmAU3A5gBIAMgAykC0AY3A4ABIAMgAykC2AY3A4gBIAQgA0GQAWogA0GAAWoQBiADIAMpAogFNwOYBSADIAMpAoAFNwOQBSADIAMpA6AFNwNwIAMgAykDqAU3A3ggAyAUKQIANwNgIAMgFCkCCDcDaCAEIANB8ABqIANB4ABqEAYgAyADKQKIBTcDqAUgAyADKQKABTcDoAUgAyADKQOQBTcDUCADIAMpA5gFNwNYIAMgAykC4AY3A0AgAyADKQLoBjcDSCAEIANB0ABqIANBQGsQBiADIAMpAogFNwOYBSADIAMpAoAFNwOQBSADIAMpA6AFNwMwIAMgAykDqAU3AzggAyAWKQIANwMgIAMgFikCCDcDKCAEIANBMGogA0EgahBCIAMgAykCiAU3A6gFIAMgAykCgAU3A6AFIAMgAykDkAU3AxAgAyADKQOYBTcDGCADIAMpAvAGNwMAIAMgAykC+AY3AwggBCADQRBqIAMQQiADIAMpAogFNwOYBSADIAMpAoAFNwOQBUEAIAFB/wAgBWsiBEEDdkEPcyIJai0AACAEQQdxIgR2IhMgAygCrAUgAygCnAVzQRh2c0EBcWshGiADQbAFaiAJciIJIBogCS0AACIJc0EBIAR0cSAJczoAACACQQF0IgRBgICAcHFBACATQQFxa0EBcUEYdHIgBCACQQ92IglBAXFyQf8BcSACQQd2IgRB/gFxIAJBF3ZBAXFyQQh0ciAJQf4BcSACQR92ckEQdHJyIQIgBEEBcSASQQF0ciESIA1BB3ZBAXEgEUEBdHIhESAKQQd2QQFxIAZBAXRyIQYgB0EHdkEBcSAQQQF0ciEQIAhBB3ZBAXEgB0EBdHIhByAIQQF0IBlBH3ZyIQggC0EHdkEBcSAKQQF0ciEKIAxBB3ZBAXEgC0EBdHIhCyAMQQF0IBhBH3ZyIQwgDkEHdkEBcSANQQF0ciENIA9BB3ZBAXEgDkEBdHIhDiAPQQF0IBdBH3ZyIQ8gBUEBaiIFQYABRw0ACyAAIAMpA7gFNwAIIAAgAykDsAU3AAAgA0GwCGokAAuGDAIGfwJ+IwBBoAdrIgMkACADQYAEaiACQRBqEB0gA0HQAmoiCCACEB0gAyADKALQBCADKAKgA3MiBDYCwAIgAyADKALUBCADKAKkA3MiBTYCxAIgAyADKALYBCADKAKoA3MiBjYCyAIgAyADKALcBCADKAKsA3MiBzYCzAIgBEEIdiAEQRB2ciAEQRh2ciAFQQh2ciAFQRB2ciAFQRh2ciAGQQh2ciAGQRB2ciAGQRh2ciAHQQh2ciAHQRB2ciAHQRh2ciAEciAFciAGciAHckH/AXFFBEAgAyACLQAAQdoAczoAwAIgAyACLQABQdoAczoAwQIgAyACLQACQdoAczoAwgIgAyACLQADQdoAczoAwwIgAyACLQAEQdoAczoAxAIgAyACLQAFQdoAczoAxQIgAyACLQAGQdoAczoAxgIgAyACLQAHQdoAczoAxwIgAyACLQAIQdoAczoAyAIgAyACLQAJQdoAczoAyQIgAyACLQAKQdoAczoAygIgAyACLQALQdoAczoAywIgAyACLQAMQdoAczoAzAIgAyACLQANQdoAczoAzQIgAyACLQAOQdoAczoAzgIgAyACLQAPQdoAczoAzwIgCCADQcACahAdCyADQeAFaiABIANBgARqENIBIANB8AVqIgIgA0HQAmpBsAH8CgAAIAIQgQEgASgAGCECIAEoABwhBCABKAAQIQUgAyADKALkBSIGIAEoABQgAygClAdzczYC1AUgAyADKALgBSIBIAUgAygCkAdzczYC0AUgAyADKALsBSIFIAQgAygCnAdzczYC3AUgAyADKALoBSIEIAIgAygCmAdzczYC2AUgAyADKQPQBTcDsAIgAyADKQPYBTcDuAIgAyADKQOABzcDoAIgAyADKQOIBzcDqAIgA0HABWoiAiADQbACaiADQaACahAQIAMgAykCyAUiCTcD2AUgAyADKQLABSIKNwPQBSADIAo3A5ACIAMgCTcDmAIgAyADKQPwBjcDgAIgAyADKQP4BjcDiAIgAiADQZACaiADQYACahAQIAMgAykCyAUiCTcD2AUgAyADKQLABSIKNwPQBSADIAo3A/ABIAMgCTcD+AEgAyADKQPgBjcD4AEgAyADKQPoBjcD6AEgAiADQfABaiADQeABahAQIAMgAykCyAUiCTcD2AUgAyADKQLABSIKNwPQBSADIAo3A9ABIAMgCTcD2AEgAyADKQPQBjcDwAEgAyADKQPYBjcDyAEgAiADQdABaiADQcABahAQIAMgAykCyAUiCTcD2AUgAyADKQLABSIKNwPQBSADIAo3A7ABIAMgCTcDuAEgAyADKQPABjcDoAEgAyADKQPIBjcDqAEgAiADQbABaiADQaABahAQIAMgAykCyAUiCTcD2AUgAyADKQLABSIKNwPQBSADIAo3A5ABIAMgCTcDmAEgAyADKQOwBjcDgAEgAyADKQO4BjcDiAEgAiADQZABaiADQYABahAQIAMgAykCyAUiCTcD2AUgAyADKQLABSIKNwPQBSADIAo3A3AgAyAJNwN4IAMgAykDoAY3A2AgAyADKQOoBjcDaCACIANB8ABqIANB4ABqEBAgAyADKQLIBSIJNwPYBSADIAMpAsAFIgo3A9AFIAMgCjcDUCADIAk3A1ggAyADKQOQBjcDQCADIAMpA5gGNwNIIAIgA0HQAGogA0FAaxAQIAMgAykCyAUiCTcD2AUgAyADKQLABSIKNwPQBSADIAo3AzAgAyAJNwM4IAMgAykDgAY3AyAgAyADKQOIBjcDKCACIANBMGogA0EgahAQIAMgBSADKAL8BXM2ArwFIAMgBCADKAL4BXM2ArgFIAMgBiADKAL0BXM2ArQFIAMgASADKALwBXM2ArAFIAMgAykCyAUiCTcD2AUgAyADKQLABSIKNwPQBSADIAo3AxAgAyAJNwMYIAMgAykCuAU3AwggAyADKQKwBTcDACACIANBEGogAxCiASADIAMpAsgFIgk3A9gFIAMgAykCwAUiCjcD0AUgACAJNwAIIAAgCjcAACADQaAHaiQAC/8LAgZ/An4jAEHwBWsiBCQAIARBgARqIANBEGoQHSAEQdACaiIJIAMQHSAEIAQoAtAEIAQoAqADcyIFNgLAAiAEIAQoAtQEIAQoAqQDcyIGNgLEAiAEIAQoAtgEIAQoAqgDcyIHNgLIAiAEIAQoAtwEIAQoAqwDcyIINgLMAiAFQQh2IAVBEHZyIAVBGHZyIAZBCHZyIAZBEHZyIAZBGHZyIAdBCHZyIAdBEHZyIAdBGHZyIAhBCHZyIAhBEHZyIAhBGHZyIAVyIAZyIAdyIAhyQf8BcUUEQCAEIAMtAABB2gBzOgDAAiAEIAMtAAFB2gBzOgDBAiAEIAMtAAJB2gBzOgDCAiAEIAMtAANB2gBzOgDDAiAEIAMtAARB2gBzOgDEAiAEIAMtAAVB2gBzOgDFAiAEIAMtAAZB2gBzOgDGAiAEIAMtAAdB2gBzOgDHAiAEIAMtAAhB2gBzOgDIAiAEIAMtAAlB2gBzOgDJAiAEIAMtAApB2gBzOgDKAiAEIAMtAAtB2gBzOgDLAiAEIAMtAAxB2gBzOgDMAiAEIAMtAA1B2gBzOgDNAiAEIAMtAA5B2gBzOgDOAiAEIAMtAA9B2gBzOgDPAiAJIARBwAJqEB0LIAAgAikACDcACCAAIAIpAAA3AAAgBEHgBWogAiAEQYAEahDSASABKAAIIQIgASgADCEDIAEoAAAhBSAEIAQoAuQFIgYgASgABCAEKALUAnNzNgLUBSAEIAQoAuAFIgEgBSAEKALQAnNzNgLQBSAEIAQoAuwFIgUgAyAEKALcAnNzNgLcBSAEIAQoAugFIgMgAiAEKALYAnNzNgLYBSAEIAQpA9AFNwOwAiAEIAQpA9gFNwO4AiAEIAQpA+gCNwOoAiAEIAQpA+ACNwOgAiAEQcAFaiICIARBsAJqIARBoAJqEAYgBCAEKQLIBSIKNwPYBSAEIAQpAsAFIgs3A9AFIAQgCzcDkAIgBCAKNwOYAiAEIAQpA/ACNwOAAiAEIAQpA/gCNwOIAiACIARBkAJqIARBgAJqEAYgBCAEKQLIBSIKNwPYBSAEIAQpAsAFIgs3A9AFIAQgCzcD8AEgBCAKNwP4ASAEIAQpA4ADNwPgASAEIAQpA4gDNwPoASACIARB8AFqIARB4AFqEAYgBCAEKQLIBSIKNwPYBSAEIAQpAsAFIgs3A9AFIAQgCzcD0AEgBCAKNwPYASAEIAQpA5ADNwPAASAEIAQpA5gDNwPIASACIARB0AFqIARBwAFqEAYgBCAEKQLIBSIKNwPYBSAEIAQpAsAFIgs3A9AFIAQgCzcDsAEgBCAKNwO4ASAEIAQpAqADNwOgASAEIAQpAqgDNwOoASACIARBsAFqIARBoAFqEAYgBCAEKQLIBSIKNwPYBSAEIAQpAsAFIgs3A9AFIAQgCzcDkAEgBCAKNwOYASAEIAQpA7ADNwOAASAEIAQpA7gDNwOIASACIARBkAFqIARBgAFqEAYgBCAEKQLIBSIKNwPYBSAEIAQpAsAFIgs3A9AFIAQgCzcDcCAEIAo3A3ggBCAEKQPAAzcDYCAEIAQpA8gDNwNoIAIgBEHwAGogBEHgAGoQBiAEIAQpAsgFIgo3A9gFIAQgBCkCwAUiCzcD0AUgBCALNwNQIAQgCjcDWCAEIAQpA9ADNwNAIAQgBCkD2AM3A0ggAiAEQdAAaiAEQUBrEAYgBCAEKQLIBSIKNwPYBSAEIAQpAsAFIgs3A9AFIAQgCzcDMCAEIAo3AzggBCAEKQPgAzcDICAEIAQpA+gDNwMoIAIgBEEwaiAEQSBqEAYgBCAFIAQoAvwDczYCvAUgBCADIAQoAvgDczYCuAUgBCAGIAQoAvQDczYCtAUgBCABIAQoAvADczYCsAUgBCAEKQLIBSIKNwPYBSAEIAQpAsAFIgs3A9AFIAQgCzcDECAEIAo3AxggBCAEKQK4BTcDCCAEIAQpArAFNwMAIAIgBEEQaiAEEEIgBCAEKQLIBSIKNwPYBSAEIAQpAsAFIgs3A9AFIAAgCjcAGCAAIAs3ABAgBEHwBWokAAvbDgIHfwJ+IwBBkAZrIgMkACADQdACaiIEIAIQHSADIAEvAAAiAjYC0AQgAyABLwACIgY2AtQEIAMgAS8ABCIHNgLYBCADIAEvAAYiCDYC3AQgAyADKQLQBDcDwAIgAyADKQLYBDcDyAIgAyADKALAAhALNgLABCADIAMoAsQCEAs2AsQEIAMgAygCyAIQCzYCyAQgAyADKALMAhALNgLMBCADQeAEaiIFIARBsAH8CgAAIAUQgQEgASgAECEEIAEoABQhBSABKAAIIQkgAyAGIAEoAAwgAygChAZzczYCtAQgAyACIAkgAygCgAZzczYCsAQgAyAIIAUgAygCjAZzczYCvAQgAyAHIAQgAygCiAZzczYCuAQgAyADKALEBCADKAL0BXM2ApQEIAMgAygCwAQgAygC8AVzNgKQBCADKAL4BSEBIAMoAsgEIQQgAyADKALMBCADKAL8BXM2ApwEIAMgASAEczYCmAQgAyADKQO4BDcDuAIgAyADKQOwBDcDsAIgAyADKQKYBDcDqAIgAyADKQKQBDcDoAIgA0GgBGoiASADQbACaiADQaACahAQIAMgAykCqAQiCjcDuAQgAyADKQKgBCILNwOwBCADIAMoAsQEIAMoAuQFczYClAQgAyADKALABCADKALgBXM2ApAEIAMgAygCzAQgAygC7AVzNgKcBCADIAMoAsgEIAMoAugFczYCmAQgAyAKNwOYAiADIAs3A5ACIAMgAykCmAQ3A4gCIAMgAykCkAQ3A4ACIAEgA0GQAmogA0GAAmoQECADIAMpAqgEIgo3A7gEIAMgAykCoAQiCzcDsAQgAyADKALEBCADKALUBXM2ApQEIAMgAygCwAQgAygC0AVzNgKQBCADIAMoAswEIAMoAtwFczYCnAQgAyADKALIBCADKALYBXM2ApgEIAMgCjcD+AEgAyALNwPwASADIAMpApgENwPoASADIAMpApAENwPgASABIANB8AFqIANB4AFqEBAgAyADKQKoBCIKNwO4BCADIAMpAqAEIgs3A7AEIAMgAygCxAQgAygCxAVzNgKUBCADIAMoAsAEIAMoAsAFczYCkAQgAyADKALMBCADKALMBXM2ApwEIAMgAygCyAQgAygCyAVzNgKYBCADIAo3A9gBIAMgCzcD0AEgAyADKQKYBDcDyAEgAyADKQKQBDcDwAEgASADQdABaiADQcABahAQIAMgAykCqAQiCjcDuAQgAyADKQKgBCILNwOwBCADIAMoAsQEIAMoArQFczYClAQgAyADKALABCADKAKwBXM2ApAEIAMgAygCzAQgAygCvAVzNgKcBCADIAMoAsgEIAMoArgFczYCmAQgAyAKNwO4ASADIAs3A7ABIAMgAykCmAQ3A6gBIAMgAykCkAQ3A6ABIAEgA0GwAWogA0GgAWoQECADIAMpAqgEIgo3A7gEIAMgAykCoAQiCzcDsAQgAyADKALEBCADKAKkBXM2ApQEIAMgAygCwAQgAygCoAVzNgKQBCADIAMoAswEIAMoAqwFczYCnAQgAyADKALIBCADKAKoBXM2ApgEIAMgCjcDmAEgAyALNwOQASADIAMpApgENwOIASADIAMpApAENwOAASABIANBkAFqIANBgAFqEBAgAyADKQKoBCIKNwO4BCADIAMpAqAEIgs3A7AEIAMgAygCxAQgAygClAVzNgKUBCADIAMoAsAEIAMoApAFczYCkAQgAyADKALMBCADKAKcBXM2ApwEIAMgAygCyAQgAygCmAVzNgKYBCADIAo3A3ggAyALNwNwIAMgAykCmAQ3A2ggAyADKQKQBDcDYCABIANB8ABqIANB4ABqEBAgAyADKQKoBCIKNwO4BCADIAMpAqAEIgs3A7AEIAMgAygCxAQgAygChAVzNgKU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IAEgAvwKAAALIABB4ABqIAZBgAH8CgAAIABBgAE2AOACIAZBgAEQByAGQYABaiQAQQAMAQsQDAALDQELQQAhBwsgBwsSACAAIAEQTxogAEHQARAHQQALCwAgACABIAKtECwLCgAgACABIAIQPgsEAEFuCwQAQRELBABBNAuVAQIBfwF+IwBBMGsiASQAIAEgACkAGDcDGCABIAApABA3AxAgASAAKQAINwMIIAEgACkAADcDACABIAApACQ3AyAgASABQiggAEEgaiAAEHwaIAAgASkDGDcAGCAAIAEpAxA3ABAgACABKQMINwAIIAAgASkDADcAACABKQMgIQIgAEEBNgAgIAAgAjcAJCABQTBqJAALLQEBfiAAIAEgAkEAEB8aIABBATYAICABKQAQIQMgAEIANwAsIAAgAzcAJEEACzMBAX4gAUEYEBYgACABIAJBABAfGiAAQQE2ACAgASkAECEDIABCADcALCAAIAM3ACRBAAsJACAAIAEQjgILCwAgACABIAIQjQILCwAgACABIAIQjwILCQAgACABEJACCwkAIAAgARCRAgsJACAAIAEQkgILBwAgABCTAgsiAQF/IwBBQGoiASQAIAFBwAAQFiAAIAEQpQEgAUFAayQACwsAIAAgARClAUEAC2UBA38jAEGgBmsiAyQAQX8hBAJAIANBgAVqIgUgARBKDQAgA0HgA2oiASACEEoNACADIAEQDiADQaABaiIBIAUgAxBgIANBwAJqIgIgARBhIAAgAhBVQQAhBAsgA0GgBmokACAEC2UBA38jAEGgBmsiAyQAQX8hBAJAIANBgAVqIgUgARBKDQAgA0HgA2oiASACEEoNACADIAEQDiADQaABaiIBIAUgAxASIANBwAJqIgIgARBhIAAgAhBVQQAhBAsgA0GgBmokACAECx0BAX8jAEGgAWsiASQAIAEgABBKIAFBoAFqJABFCyEBAX8jAEEgayIBJAAgAUEgEBYgACABEKcBIAFBIGokAAvvBAEMfyMAQaABayICJAAgAS0AACENA0AgAkGAAWoiBSADaiABIANrIgQtAD86AAAgAkHgAGoiBiADaiAELQAfOgAAIAUgA0EBciIHaiAELQA+OgAAIAYgB2ogBC0AHjoAACADQQJqIgNBIEcNAAsgAiACLQCfAUH/AHE6AJ8BIAIgAi0Af0H/AHE6AH8gAkEwaiIDIAUQNSACIAYQNSACIAIoAlAgAigCIEEmbGoiBCACKAJMIAIoAhxBJmxqIgUgAigCSCACKAIYQSZsaiIGIAIoAkQgAigCFEEmbGoiByACKAJAIAIoAhBBJmxqIgggAigCPCACKAIMQSZsaiIJIAIoAjggAigCCEEmbGoiCiACKAI0IAIoAgRBJmxqIgsgAigCMEHSyAItAABBAnYgAS0AIEEHdnNBE2xqIAIoAgBBJmxqIgwgAigCVCACKAIkQSZsaiIBQRNsQYCAgAhqQRl2akEadWpBGXVqQRp1akEZdWpBGnVqQRl1akEadWpBGXVqQRp1IAFqQRl1QRNsIAxqIgxB////H3E2AjAgAiAMQRp1IAtqIgtB////D3E2AjQgAiALQRl1IApqIgpB////H3E2AjggAiAKQRp1IAlqIglB////D3E2AjwgAiAJQRl1IAhqIghB////H3E2AkAgAiAIQRp1IAdqIgdB////D3E2AkQgAiAHQRl1IAZqIgZB////H3E2AkggAiAGQRp1IAVqIgVB////D3E2AkwgAiAFQRl1IARqIgRB////H3E2AlAgAiAEQRp1IAFqQf///w9xNgJUIAAgAyANQYABcRCmASACQaABaiQAQQALCwAgACABEKcBQQALcwEDfyMAQaAGayIDJABBfyEEAkAgA0GABWoiBSABEEQNACAFEFZFDQAgA0HgA2oiASACEEQNACABEFZFDQAgAyABEA4gA0GgAWoiASAFIAMQYCADQcACaiICIAEQYSAAIAIQIkEAIQQLIANBoAZqJAAgBAtzAQN/IwBBoAZrIgMkAEF/IQQCQCADQYAFaiIFIAEQRA0AIAUQVkUNACADQeADaiIBIAIQRA0AIAEQVkUNACADIAEQDiADQaABaiIBIAUgAxASIANBwAJqIgIgARBhIAAgAhAiQQAhBAsgA0GgBmokACAEC0IBAn8jAEGgAWsiASQAAkAgABCEAUUNACAAEEMNACABIAAQRA0AIAEQVkUNACABEIUBQQBHIQILIAFBoAFqJAAgAgsGAEHA/wALugICBH8BfiMAQfADayIFJAAgBUEBOgAPAn8gAUHA/wBNBEAgAUHAAE8EQCADrSEJQcAAIQYDQCAGIQcgBUHQAGoiBiAEQcAAEDkaIAgEQCAGIAAgCGpBQGpCwAAQLxoL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wAEhCCAKKALEASEHIAooAsgBIQEgCiALKAIsIAsoAjxxIAsoAhwgCygCTCALKAJcIAooAswBc3NzczYCzAEgCiAMIA1xICAgDiABIA9zc3NzNgLIASAKIB4gH3EgGyAcIAcgHXNzc3M2AsQBIAogGSAacSAWIBcgCCAYc3NzczYCwAEgFEUEQCARQQAgEvwLAAsgFUUEQCATIApBwAFqIAX8CgAACyAKKALAASEPIAooAsQBIQ0gCigCyAEhDCAKKALMASEIIAogCykCWDcD6AEgCiALKQJQNwPgASAKIBApAgA3A7ABIAogCykCSDcDuAEgCiALKQJQNwOgASAKIAspAlg3A6gBIApB0AFqIgEgCkGwAWogCkGgAWoQBiALIAopAtgBNwJYIAsgCikC0AE3AlAgCiALKQIwNwOQASAKIAspAjg3A5gBIAogECkCADcDgAEgCiALKQJINwOIASABIApBkAFqIApBgAFqEAYgCyAKKQLYATcCSCAQIAopAtABNwIAIAogCykCIDcDcCAKIAspAig3A3ggCiALKQIwNwNgIAogCykCODcDaCABIApB8ABqIApB4ABqEAYgCyAKKQLYATcCOCALIAopAtABNwIwIAogCykCEDcDUCAKIAspAhg3A1ggCiALKQIgNwNAIAogCykCKDcDSCABIApB0ABqIApBQGsQBiALIAopAtgBNwIoIAsgCikC0AE3AiAgCiALKQIANwMwIAogCykCCDcDOCAKIAspAhA3AyAgCiALKQIYNwMoIAEgCkEwaiAKQSBqEAYgCyAKKQLYATcCGCALIAopAtABNwIQIAogCikD4AE3AxAgCiAKKQPoATcDGCAKIAspAgA3AwAgCiALKQIINwMIIAEgCkEQaiAKEAYgCigC0AEhByAKKALUASEFIAooAtgBIQEgCyAIIAooAtwBczYCDCALIAEgDHM2AgggCyAFIA1zNgIEIAsgByAPczYCACAKQfABaiQACyAJQYADaiAEIAatIAKtIAlBsANqEJkCQX8hBwJAAkACQAJ/AkACQCAEQRBrDhEAAwMDAwMDAwMDAwMDAwMDAQMLIAlBgANqIAMQRwwBCyAJQYADaiADEEYLIgdFDQELIABFDQEgAkUNASAAQQAgAvwLAAwBC0EAIQcLIAlBoARqJAAgBwunDAIFfwJ+IwBBkARrIgkk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QCAEQR9xIgVFDQBBICAFayIIBEAgCUEgaiAFckEAIAj8CwALIAVFIghFBEAgCUEgaiADIAdqIAX8CgAACyAJIAlBIGogCUFAaxChAiAIDQAgACAHaiAJIAX8CgAACyABIAIgBq0gBK0gCUFAaxCgAiQAQQALC4ayAhEAQYAIC7AELi8wMTIzNDU2Nzg5QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5egBqcwByYW5kb21ieXRlcwBiNjRfcG9zIDw9IGI2NF9sZW4AY3J5cHRvX2dlbmVyaWNoYXNoX2JsYWtlMmJfZmluYWwAYXJnb24yaWQsYXJnb24yaQAkYXJnb24yaQB4d2luZwAkYXJnb24yaWQAcmFuZG9tYnl0ZXMvcmFuZG9tYnl0ZXMuYwBzb2RpdW0vY29kZWNzLmMAY3J5cHRvX2dlbmVyaWNoYXNoL2JsYWtlMmIvcmVmL2JsYWtlMmItcmVmLmMAY3J5cHRvX2dlbmVyaWNoYXNoL2JsYWtlMmIvcmVmL2dlbmVyaWNoYXNoX2JsYWtlMmIuYwB4MjU1MTlibGFrZTJiAGJ1Zl9sZW4gPD0gU0laRV9NQVgAb3V0bGVuIDw9IFVJTlQ4X01BWABTLT5idWZsZW4gPD0gQkxBS0UyQl9CTE9DS0JZVEVTACRhcmdvbjJpJHY9ACRhcmdvbjJpZCR2PQBjdXJ2ZTI1NTE5AGVkMjU1MTkAaG1hY3NoYTUxMjI1NgBjdXJ2ZTI1NTE5eHNhbHNhMjBwb2x5MTMwNQBzb2RpdW1fYmluMmJhc2U2NABzaXBoYXNoMjQAMS4wLjIyAHNoYTUxMgB4c2Fsc2EyMAAkYXJnb24yaSQAJGFyZ29uMmlkJAAkNyQAQcAMC1e2eFn/hXLTAL1uFf8PCmoAKcABAJjoef+8PKD/mXHO/wC34v60DUj/AAAAAAAAAACwoA7+08mG/54YjwB/aTUAYAy9AKfX+/+fTID+amXh/x78BACSDK4AQaANCydZ8bL+CuWm/3vdKv4eFNQAUoADADDR8wB3eUD/MuOc/wBuxQFnG5AAQdANC8AHhTuMAb3xJP/4JcMBYNw3ALdMPv/DQj0AMkykAeGkTP9MPaP/dT4fAFGRQP92QQ4AonPW/waKLgB85vT/CoqPADQawgC49EwAgY8pAb70E/97qnr/YoFEAHnVkwBWZR7/oWebAIxZQ//v5b4BQwu1AMbwif7uRbz/Q5fuABMqbP/lVXEBMkSH/xFqCQAyZwH/UAGoASOYHv8QqLkBOFno/2XS/AAp+kcAzKpP/w4u7/9QTe8AvdZL/xGN+QAmUEz/vlV1AFbkqgCc2NABw8+k/5ZCTP+v4RD/jVBiAUzb8gDGonIALtqYAJsr8f6boGj/M7ulAAIRrwBCVKAB9zoeACNBNf5F7L8ALYb1AaN73QAgbhT/NBelALrWRwDpsGAA8u82ATlZigBTAFT/iKBkAFyOeP5ofL4AtbE+//opVQCYgioBYPz2AJeXP/7vhT4AIDicAC2nvf+OhbMBg1bTALuzlv76qg7/0qNOACU0lwBjTRoA7pzV/9XA0QFJLlQAFEEpATbOTwDJg5L+qm8Y/7EhMv6rJsv/Tvd0ANHdmQCFgLIBOiwZAMknOwG9E/wAMeXSAXW7dQC1s7gBAHLbADBekwD1KTgAfQ3M/vStdwAs3SD+VOoUAPmgxgHsfur/L2Oo/qrimf9ms9gA4o16/3pCmf629YYA4+QZAdY56//YrTj/tefSAHeAnf+BX4j/bn4zAAKpt/8HgmL+RbBe/3QE4wHZ8pH/yq0fAWkBJ/8ur0UA5C86/9fgRf7POEX/EP6L/xfP1P/KFH7/X9Vg/wmwIQDIBc//8SqA/iMhwP/45cQBgRF4APtnl/8HNHD/jDhC/yji9f/ZRiX+rNYJ/0hDhgGSwNb/LCZwAES4S//OWvsAleuNALWqOgB09O8AXJ0CAGatYgDpiWABfzHLAAWblAAXlAn/03oMACKGGv/bzIgAhggp/+BTK/5VGfcAbX8A/qmIMADud9v/563VAM4S/v4Iugf/fgkHAW8qSABvNOz+YD+NAJO/f/7NTsD/DmrtAbvbTACv87v+aVmtAFUZWQGi85QAAnbR/iGeCQCLoy7/XUYoAGwqjv5v/I7/m9+QADPlp/9J/Jv/XnQM/5ig2v+c7iX/s+rP/8UAs/+apI0A4cRoAAojGf7R1PL/Yf3e/rhl5QDeEn8BpIiH/x7PjP6SYfMAgcAa/slUIf9vCk7/k1Gy/wQEGACh7tf/Bo0hADXXDv8ptdD/54udALPL3f//uXEAveKs/3FC1v/KPi3/ZkAI/06uEP6FdUT/AEGwFQsBAQBB0BULsAEm6JWPwrInsEXD9Iny75jw1d+sBdPGMzmxOAKIbVP8BccXanA9TdhPujwLdg0QZw8qIFP6LDnMxk7H/XeSrAN67P///////////////////////////////////////3/t////////////////////////////////////////f+7///////////////////////////////////////9/7dP1XBpjEljWnPei3vneFABBjxcLrPEBEP1AXQCgaj8AOdNX/gzSugBYvHT+QdgBAP/IPQHYQpT/APtcACSy4f8AAAAAAAAAAIU7jAG98ST/+CXDAWDcNwC3TD7/w0I9ADJMpAHhpEz/TD2j/3U+HwBRkUD/dkEOAKJz1v8Gii4AfOb0/wqKjwA0GsIAuPRMAIGPKQG+9BP/e6p6/2KBRAB51ZMAVmUe/6FnmwCMWUP/7+W+AUMLtQDG8In+7kW8/+pxPP8l/zn/RbK2/oDQswB2Gn3+AwfW//EyTf9Vy8X/04f6/xkwZP+71bT+EVhpAFPRngEFc2IABK48/qs3bv/ZtRH/FLyqAJKcZv5X1q7/cnqbAeksqgB/CO8B1uzqAK8F2wAxaj3/BkLQ/wJqbv9R6hP/12vA/0OX7gATKmz/5VVxATJEh/8RagkAMmcB/1ABqAEjmB7/EKi5AThZ6P9l0vwAKfpHAMyqT/8OLu//UE3vAL3WS/8RjfkAJlBM/75VdQBW5KoAnNjQAcPPpP+WQkz/r+EQ/41QYgFM2/IAxqJyAC7amACbK/H+m6Bo/7IJ/P5kbtQADgWnAOnvo/8cl50BZZIK//6eRv5H+eQAWB4yAEQ6oP+/GGgBgUKB/8AyVf8Is4r/JvrJAHNQoACD5nEAfViTAFpExwD9TJ4AHP92AHH6/gBCSy4A5torAOV4ugGURCsAiHzuAbtrxf9UNfb/M3T+/zO7pQACEa8AQlSgAfc6HgAjQTX+Rey/AC2G9QGje90AIG4U/zQXpQC61kcA6bBgAPLvNgE5WYoAUwBU/4igZABcjnj+aHy+ALWxPv/6KVUAmIIqAWD89gCXlz/+74U+ACA4nAAtp73/joWzAYNW0wC7s5b++qoO/0RxFf/eujv/QgfxAUUGSABWnGz+N6dZAG002/4NsBf/xCxq/++VR/+kjH3/n60BADMp5wCRPiEAim9d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/5AnAgH/+rIABRHs/osgLgDMvCb+9XM0/79xSf6/bEX/FkX1ARfLsgCqY6oAQfhvACVsmf9AJUUAAFg+/lmUkP+/ROAB8Sc1ACnL7f+RfsL/3Sr9/xljlwBh/d8BSnMx/wavSP87sMsAfLf5AeTkYwCBDM/+qMDD/8ywEP6Y6qsATSVV/yF4h/+OwuMBH9Y6ANW7ff/oLjz/vnQq/peyE/8zPu3+zOzBAMLoPACsIp3/vRC4/mcDX/+N6ST+KRkL/xXDpgB29S0AQ9WV/58MEv+7pOMBoBkFAAxOwwErxeEAMI4p/sSbPP/fxxIBkYicAPx1qf6R4u4A7xdrAG21vP/mcDH+Sart/+e34/9Q3BQAwmt/AX/NZQAuNMUB0qsk/1gDWv84l40AYLv//ypOyAD+RkYB9H2oAMxEigF810YAZkLI/hE05AB13I/+y/h7ADgSrv+6l6T/M+jQAaDkK//5HRkBRL4/AA0AAAAA/wAAAAD1AAAAAAAA+wAAAAAAAP0AAAAA8wAAAAAHAAAAAAADAAAAAPMAAAAABQAAAAAAAAAACwAAAAAACwAAAADzAAAAAAAA/QAAAAAA/wAAAAADAAAAAPUAAAAAAAAADwAAAAAA/wAAAAD/AAAAAAcAAAAABQBBvIkCCysBAAAAdsFfAGVwAv9Q/KH+8mrG/4UGsgDk33AA3+5V/jPzGgA+K4v+y0EKAEHwiQILVzNN7QCRqlb/NiYz//GAZf8peUr/7E6bAKmXaf6cKUgAwmav/86iZf8AAAAAAAAAABsuewESqP3/06+X/sPbYAA4dr7+/tH1/5lkfv7ogRX/Nbjy/8ek3QBB8IoCCwEBAEGQiwILgSvg63p8O0G4rhZW4/rxn8Rq2gmN65wysf2GYgUWX0m4AF+clbyjUIwksdCxVZyD71sERFzEWByOhtgiTt3QnxFX7P///////////////////////////////////////3/t////////////////////////////////////////f+7///////////////////////////////////////9/AAECBAgQIECAGzYAAAAAAMZjY6X4fHyE7nd3mfZ7e43/8vIN1mtrvd5vb7GRxcVUYDAwUAIBAQPOZ2epVisrfef+/hm119diTaur5ux2dpqPyspFH4KCnYnJyUD6fX2H7/r6FbJZWeuOR0fJ+/DwC0Gtreyz1NRnX6Ki/UWvr+ojnJy/U6Sk9+RycpabwMBbdbe3wuH9/Rw9k5OuTCYmamw2Nlp+Pz9B9ff3AoPMzE9oNDRcUaWl9NHl5TT58fEI4nFxk6vY2HNiMTFTKhUVPwgEBAyVx8dSRiMjZZ3Dw14wGBgoN5aWoQoFBQ8vmpq1DgcHCSQSEjYbgICb3+LiPc3r6yZOJydpf7Kyzep1dZ8SCQkbHYODnlgsLHQ0GhouNhsbLdxubrK0WlruW6Cg+6RSUvZ2OztNt9bWYX2zs85SKSl73ePjPl4vL3EThISXplNT9bnR0WgAAAAAwe3tLEAgIGDj/PwfebGxyLZbW+3Uamq+jcvLRme+vtlyOTlLlEpK3phMTNSwWFjohc/PSrvQ0GvF7+8qT6qq5e37+xaGQ0PFmk1N12YzM1URhYWUikVFz+n5+RAEAgIG/n9/gaBQUPB4PDxEJZ+fukuoqOOiUVHzXaOj/oBAQMAFj4+KP5KSrSGdnbxwODhI8fX1BGO8vN93trbBr9radUIhIWMgEBAw5f//Gv3z8w6/0tJtgc3NTBgMDBQmExM1w+zsL75fX+E1l5eiiEREzC4XFzmTxMRXVaen8vx+foJ6PT1HyGRkrLpdXecyGRkr5nNzlcBgYKAZgYGYnk9P0aPc3H9EIiJmVCoqfjuQkKsLiIiDjEZGysfu7ilruLjTKBQUPKfe3nm8Xl7iFgsLHa3b23bb4OA7ZDIyVnQ6Ok4UCgoekklJ2wwGBgpIJCRsuFxc5J/Cwl2909NuQ6ys78RiYqY5kZGoMZWVpNPk5DfyeXmL1efnMovIyENuNzdZ2m1ttwGNjYyx1dVknE5O0kmpqeDYbGy0rFZW+vP09AfP6uolymVlr/R6eo5Hrq7pEAgIGG+6utXweHiISiUlb1wuLnI4HBwkV6am8XO0tMeXxsZRy+joI6Hd3XzodHScPh8fIZZLS91hvb3cDYuLhg+KioXgcHCQfD4+QnG1tcTMZmaqkEhI2AYDAwX39vYBHA4OEsJhYaNqNTVfrldX+Wm5udAXhoaRmcHBWDodHScnnp652eHhOOv4+BMrmJizIhERM9Jpabup2dlwB46OiTOUlKctm5u2PB4eIhWHh5LJ6ekgh87OSapVVf9QKCh4pd/fegOMjI9ZoaH4CYmJgBoNDRdlv7/a1+bmMYRCQsbQaGi4gkFBwymZmbBaLS13Hg8PEXuwsMuoVFT8bbu71iwWFjqlxmNjhPh8fJnud3eN9nt7Df/y8r3Wa2ux3m9vVJHFxVBgMDADAgEBqc5nZ31WKysZ5/7+YrXX1+ZNq6ua7HZ2RY/Kyp0fgoJAicnJh/p9fRXv+vrrsllZyY5HRwv78PDsQa2tZ7PU1P1foqLqRa+vvyOcnPdTpKSW5HJyW5vAwMJ1t7cc4f39rj2Tk2pMJiZabDY2QX4/PwL19/dPg8zMXGg0NPRRpaU00eXlCPnx8ZPicXFzq9jYU2IxMT8qFRUMCAQEUpXHx2VGIyNencPDKDAYGKE3lpYPCgUFtS+amgkOBwc2JBISmxuAgD3f4uImzevraU4nJ81/srKf6nV1GxIJCZ4dg4N0WCwsLjQaGi02Gxuy3G5u7rRaWvtboKD2pFJSTXY7O2G31tbOfbOze1IpKT7d4+NxXi8vlxOEhPWmU1NoudHRAAAAACzB7e1gQCAgH+P8/Mh5sbHttltbvtRqakaNy8vZZ76+S3I5Od6USkrUmExM6LBYWEqFz89ru9DQKsXv7+VPqqoW7fv7xYZDQ9eaTU1VZjMzlBGFhc+KRUUQ6fn5BgQCAoH+f3/woFBQRHg8PLoln5/jS6io86JRUf5do6PAgEBAigWPj60/kpK8IZ2dSHA4OATx9fXfY7y8wXe2tnWv2tpjQiEhMCAQEBrl//8O/fPzbb/S0kyBzc0UGAwMNSYTEy/D7Ozhvl9fojWXl8yIREQ5LhcXV5PExPJVp6eC/H5+R3o9PazIZGTnul1dKzIZGZXmc3OgwGBgmBmBgdGeT09/o9zcZkQiIn5UKiqrO5CQgwuIiMqMRkYpx+7u02u4uDwoFBR5p97e4rxeXh0WCwt2rdvbO9vg4FZkMjJOdDo6HhQKCtuSSUkKDAYGbEgkJOS4XFxdn8LCbr3T0+9DrKymxGJiqDmRkaQxlZU30+Tki/J5eTLV5+dDi8jIWW43N7fabW2MAY2NZLHV1dKcTk7gSamptNhsbPqsVlYH8/T0Jc/q6q/KZWWO9Hp66UeurhgQCAjVb7q6iPB4eG9KJSVyXC4uJDgcHPFXpqbHc7S0UZfGxiPL6Oh8od3dnOh0dCE+Hx/dlktL3GG9vYYNi4uFD4qKkOBwcEJ8Pj7EcbW1qsxmZtiQSEgFBgMDAff29hIcDg6jwmFhX2o1NfmuV1fQabm5kReGhliZwcEnOh0duSeenjjZ4eET6/j4syuYmDMiERG70mlpcKnZ2YkHjo6nM5SUti2bmyI8Hh6SFYeHIMnp6UmHzs7/qlVVeFAoKHql39+PA4yM+FmhoYAJiYkXGg0N2mW/vzHX5ubGhEJCuNBoaMOCQUGwKZmZd1otLREeDw/Le7Cw/KhUVNZtu7s6LBYWY6XGY3yE+Hx3me53e432e/IN//JrvdZrb7Heb8VUkcUwUGAwAQMCAWepzmcrfVYr/hnn/tditder5k2rdprsdspFj8qCnR+CyUCJyX2H+n36Fe/6WeuyWUfJjkfwC/vwrexBrdRns9Si/V+ir+pFr5y/I5yk91OkcpbkcsBbm8C3wnW3/Rzh/ZOuPZMmakwmNlpsNj9Bfj/3AvX3zE+DzDRcaDSl9FGl5TTR5fEI+fFxk+Jx2HOr2DFTYjEVPyoVBAwIBMdSlccjZUYjw16dwxgoMBiWoTeWBQ8KBZq1L5oHCQ4HEjYkEoCbG4DiPd/i6ybN6ydpTieyzX+ydZ/qdQkbEgmDnh2DLHRYLBouNBobLTYbbrLcblrutFqg+1ugUvakUjtNdjvWYbfWs859syl7UinjPt3jL3FeL4SXE4RT9aZT0Wi50QAAAADtLMHtIGBAIPwf4/yxyHmxW+22W2q+1GrLRo3LvtlnvjlLcjlK3pRKTNSYTFjosFjPSoXP0Gu70O8qxe+q5U+q+xbt+0PFhkNN15pNM1VmM4WUEYVFz4pF+RDp+QIGBAJ/gf5/UPCgUDxEeDyfuiWfqONLqFHzolGj/l2jQMCAQI+KBY+SrT+SnbwhnThIcDj1BPH1vN9jvLbBd7bada/aIWNCIRAwIBD/GuX/8w7989Jtv9LNTIHNDBQYDBM1JhPsL8PsX+G+X5eiNZdEzIhEFzkuF8RXk8Sn8lWnfoL8fj1Hej1krMhkXee6XRkrMhlzleZzYKDAYIGYGYFP0Z5P3H+j3CJmRCIqflQqkKs7kIiDC4hGyoxG7inH7rjTa7gUPCgU3nmn3l7ivF4LHRYL23at2+A72+AyVmQyOk50OgoeFApJ25JJBgoMBiRsSCRc5Lhcwl2fwtNuvdOs70OsYqbEYpGoOZGVpDGV5DfT5HmL8nnnMtXnyEOLyDdZbjdtt9ptjYwBjdVksdVO0pxOqeBJqWy02GxW+qxW9Afz9Oolz+plr8pleo70eq7pR64IGBAIutVvuniI8Hglb0olLnJcLhwkOBym8VemtMdztMZRl8boI8vo3Xyh3XSc6HQfIT4fS92WS73cYb2Lhg2LioUPinCQ4HA+Qnw+tcRxtWaqzGZI2JBIAwUGA/YB9/YOEhwOYaPCYTVfajVX+a5XudBpuYaRF4bBWJnBHSc6HZ65J57hONnh+BPr+JizK5gRMyIRabvSadlwqdmOiQeOlKczlJu2LZseIjweh5IVh+kgyenOSYfOVf+qVSh4UCjfeqXfjI8DjKH4WaGJgAmJDRcaDb/aZb/mMdfmQsaEQmi40GhBw4JBmbApmS13Wi0PER4PsMt7sFT8qFS71m27FjosFmNjpcZ8fIT4d3eZ7nt7jfby8g3/a2u91m9vsd7FxVSRMDBQYAEBAwJnZ6nOKyt9Vv7+GefX12K1q6vmTXZ2muzKykWPgoKdH8nJQIl9fYf6+voV71lZ67JHR8mO8PAL+62t7EHU1GezoqL9X6+v6kWcnL8jpKT3U3JyluTAwFubt7fCdf39HOGTk649JiZqTDY2Wmw/P0F+9/cC9czMT4M0NFxopaX0UeXlNNHx8Qj5cXGT4tjYc6sxMVNiFRU/KgQEDAjHx1KVIyNlRsPDXp0YGCgwlpahNwUFDwqamrUvBwcJDhISNiSAgJsb4uI93+vrJs0nJ2lOsrLNf3V1n+oJCRsSg4OeHSwsdFgaGi40GxstNm5ustxaWu60oKD7W1JS9qQ7O0121tZht7Ozzn0pKXtS4+M+3S8vcV6EhJcTU1P1ptHRaLkAAAAA7e0swSAgYED8/B/jsbHIeVtb7bZqar7Uy8tGjb6+2Wc5OUtySkrelExM1JhYWOiwz89KhdDQa7vv7yrFqqrlT/v7Fu1DQ8WGTU3XmjMzVWaFhZQRRUXPivn5EOkCAgYEf3+B/lBQ8KA8PER4n5+6Jaio40tRUfOio6P+XUBAwICPj4oFkpKtP52dvCE4OEhw9fUE8by832O2tsF32tp1ryEhY0IQEDAg//8a5fPzDv3S0m2/zc1MgQwMFBgTEzUm7Owvw19f4b6Xl6I1RETMiBcXOS7ExFeTp6fyVX5+gvw9PUd6ZGSsyF1d57oZGSsyc3OV5mBgoMCBgZgZT0/Rntzcf6MiImZEKip+VJCQqzuIiIMLRkbKjO7uKce4uNNrFBQ8KN7eeadeXuK8CwsdFtvbdq3g4DvbMjJWZDo6TnQKCh4USUnbkgYGCgwkJGxIXFzkuMLCXZ/T0269rKzvQ2JipsSRkag5lZWkMeTkN9N5eYvy5+cy1cjIQ4s3N1lubW232o2NjAHV1WSxTk7SnKmp4ElsbLTYVlb6rPT0B/Pq6iXPZWWvynp6jvSurulHCAgYELq61W94eIjwJSVvSi4uclwcHCQ4pqbxV7S0x3PGxlGX6Ogjy93dfKF0dJzoHx8hPktL3Za9vdxhi4uGDYqKhQ9wcJDgPj5CfLW1xHFmZqrMSEjYkAMDBQb29gH3Dg4SHGFho8I1NV9qV1f5rrm50GmGhpEXwcFYmR0dJzqenrkn4eE42fj4E+uYmLMrEREzImlpu9LZ2XCpjo6JB5SUpzObm7YtHh4iPIeHkhXp6SDJzs5Jh1VV/6ooKHhQ3996pYyMjwOhofhZiYmACQ0NFxq/v9pl5uYx10JCxoRoaLjQQUHDgpmZsCktLXdaDw8RHrCwy3tUVPyou7vWbRYWOixSCWrVMDalOL9Ao56B89f7fOM5gpsv/4c0jkNExN7py1R7lDKmwiM97kyVC0L6w04ILqFmKNkksnZboklti9Elcvj2ZIZomBbUpFzMXWW2kmxwSFD97bnaXhVGV6eNnYSQ2KsAjLzTCvfkWAW4s0UG0Cwej8o/DwLBr70DAROKazqREUFPZ9zql/LPzvC05nOWrHQi5601heL5N+gcdd9uR/EacR0pxYlvt2IOqhi+G/xWPkvG0nkgmtvA/njNWvQf3agziAfHMbESEFkngOxfYFF/qRm1Sg0t5Xqfk8mc76DgO02uKvWwyOu7PINTmWEXKwR+unfWJuFpFGNVIQx9Y3x3e/Jrb8UwAWcr/terdsqCyX36WUfwrdSir5ykcsC3/ZMmNj/3zDSl5fFx2DEVBMcjwxiWBZoHEoDi6yeydQmDLBobblqgUjvWsynjL4RT0QDtIPyxW2rLvjlKTFjP0O+q+0NNM4VF+QJ/UDyfqFGjQI+SnTj1vLbaIRD/89LNDBPsX5dEF8Snfj1kXRlzYIFP3CIqkIhG7rgU3l4L2+AyOgpJBiRcwtOsYpGV5HnnyDdtjdVOqWxW9Opleq4IunglLhymtMbo3XQfS72LinA+tWZIA/YOYTVXuYbBHZ7h+JgRadmOlJseh+nOVSjfjKGJDb/mQmhBmS0PsFS7FkxpYnNvZGl1bURSRwAAAAAIybzzZ+YJajunyoSFrme7K/iU/nLzbjzxNh1fOvVPpdGC5q1/Ug5RH2w+K4xoBZtrvUH7q9mDH3khfhMZzeBbIq4o15gvikLNZe8jkUQ3cS87TezP+8C1vNuJgaXbtek4tUjzW8JWORnQBbbxEfFZm08Zr6SCP5IYgW3a1V4cq0ICA6OYqgfYvm9wRQFbgxKMsuROvoUxJOK0/9XDfQxVb4l78nRdvnKxlhY7/rHegDUSxyWnBtyblCZpz3Txm8HSSvGewWmb5OMlTziGR77vtdWMi8adwQ9lnKx3zKEMJHUCK1lvLOktg+SmbqqEdErU+0G93KmwXLVTEYPaiPl2q99m7lJRPpgQMrQtbcYxqD8h+5jIJwOw5A7vvsd/Wb/Cj6g98wvgxiWnCpNHkafVb4ID4FFjygZwbg4KZykpFPwv0kaFCrcnJskmXDghGy7tKsRa/G0sTd+zlZ0TDThT3mOvi1RzCmWosnc8uwpqduau7UcuycKBOzWCFIUscpJkA/FMoei/ogEwQrxLZhqokZf40HCLS8IwvlQGo1FsxxhS79YZ6JLREKllVSQGmdYqIHFXhTUO9LjRuzJwoGoQyNDSuBbBpBlTq0FRCGw3Hpnrjt9Md0gnqEib4bW8sDRjWsnFswwcOcuKQeNKqthOc+Njd0/KnFujuLLW828uaPyy713ugo90YC8XQ29jpXhyq/ChFHjIhOw5ZBoIAseMKB5jI/r/vpDpvYLe62xQpBV5xrL3o/m+K1Ny4/J4ccacYSbqzj4nygfCwCHHuIbRHuvgzdZ92up40W7uf0999bpvF3KqZ/AGppjIosV9YwquDfm+BJg/ERtHHBM1C3EbhH0EI/V32yiTJMdAe6vKMry+yRUKvp48TA0QnMRnHUO2Qj7LvtTFTCp+ZfycKX9Z7PrWOqtvy18XWEdKjBlEbIAAQZC3AgsQ7dP1XBpjEljWnPei3vneFABBr7cCCwEQAEHAtwILoQJn5glqha5nu3Lzbjw69U+lf1IOUYxoBZur2YMfGc3gW5gvikKRRDdxz/vAtaXbtelbwlY58RHxWaSCP5LVXhyrmKoH2AFbgxK+hTEkw30MVXRdvnL+sd6Apwbcm3Txm8HBaZvkhke+78adwQ/MoQwkbyzpLaqEdErcqbBc2oj5dlJRPphtxjGoyCcDsMd/Wb/zC+DGR5Gn1VFjygZnKSkUhQq3JzghGy78bSxNEw04U1RzCmW7Cmp2LsnCgYUscpKh6L+iS2YaqHCLS8KjUWzHGeiS0SQGmdaFNQ70cKBqEBbBpBkIbDceTHdIJ7W8sDSzDBw5SqrYTk/KnFvzby5o7oKPdG9jpXgUeMiECALHjPr/vpDrbFCk96P5vvJ4ccaAAEGgugILhgLtCAsKmgsUB9UFjgUfAcoAVgxuAikGtgDCA08IPwe8BT0C1AcIAX8BxAmyBb8GfwxYCvkD3AJgAvsGmwE0DN4GxwSMAtkK9wP0B9MF5wv5BgQC+QzBC2cKrwZ3CH4AvQWsCacM8gs+A2sAdAcKDEoJcwvBAx0HLArAAdgIpQIGCLIIrgErAksDHghnAw4GaQCmAUsCsQAWDN4LNQsmBnUGCwwKA4cEbgz4CcsFpwpfBMsGhAKZCV0BogFJAWUMtgwxA0kEWwJiAioF/AdIB4ABQgh5DMIEygeXCdwAXgiGBmAIBwcDCBoDGwerCZsJ3gGVDM0L5APfA74DTQfyBVwGXC4vL15cAEGwvAILIVNpZ0VkMjU1MTkgbm8gRWQyNTUxOSBjb2xsaXNpb25zAQBBoL0CC2WApAEAAQAAAAIAAAADAAAABAAAAAUAAAAGAAAABwAAAAgAAAAJAAAACgAAAAsAAAAMAAAADQAAAA4AAAAPAAAAEAAAABEAAAAWAAAAFwAAABgAAAAZAAAAGgAAABsAAAAcAAAAHQ=="), A4((await (async function(A5, g3, C4) {
      return (async function(A6, g4) {
        try {
          var C5 = await (async function(A7) {
            return (function(A8) {
              if (ArrayBuffer.isView(A8)) return A8;
              if (A8 == o2 && E2) return new Uint8Array(E2);
              if (I2) return I2(A8);
              throw "both async and sync fetching of the wasm failed";
            })(A7);
          })(A6);
          return await WebAssembly.instantiate(C5, g4);
        } catch (A7) {
          k2(`failed to asynchronously prepare wasm: ${A7}`), J2(A7);
        }
      })(g3, C4);
    })(0, o2, C3)).instance));
  })(), (function() {
    function A4() {
      g2.calledRun = true, M2 || (G2 = true, i2?.(g2), g2.onRuntimeInitialized?.(), (function() {
        if (g2.postRun) for ("function" == typeof g2.postRun && (g2.postRun = [g2.postRun]); g2.postRun.length; ) K2(g2.postRun.shift());
        U2(Y2);
      })());
    }
    !(function() {
      if (g2.preRun) for ("function" == typeof g2.preRun && (g2.preRun = [g2.preRun]); g2.preRun.length; ) s2(g2.preRun.shift());
      U2(H2);
    })(), g2.setStatus ? (g2.setStatus("Running..."), setTimeout(() => {
      setTimeout(() => g2.setStatus(""), 1), A4();
    }, 1)) : A4();
  })(), G2 ? g2 : new Promise((A4, I3) => {
    i2 = A4, D2 = I3;
  });
}
var libsodium_sumo_default = A;

// packet-core/node_modules/libsodium-wrappers-sumo/dist/modules-sumo-esm/libsodium-wrappers.mjs
var r;
var t = {};
if (void 0 === globalThis.crypto || "function" != typeof globalThis.crypto.getRandomValues) throw new Error("globalThis.crypto.getRandomValues is not available. The ESM build of libsodium requires a secure random source (available in all browsers and Node.js 19+).");
var a = "function" == typeof (_ = libsodium_sumo_default) ? _ : null != _ && "function" == typeof _.default ? _.default : null;
var _;
var n = (function(e) {
  return null != e && void 0 !== e.ready ? e : null != e && null != e.default && void 0 !== e.default.ready ? e.default : null;
})(libsodium_sumo_default);
var s = (null != a ? a({ getRandomValue: function() {
  var e = new Uint32Array(1);
  return globalThis.crypto.getRandomValues(e), e[0] >>> 0;
} }) : null != n ? n.ready.then(function() {
  return n;
}) : Promise.reject(new Error("Unsupported libsodium ESM export shape"))).then(function(e) {
  r = e, t.libsodium = r, (function() {
    if (r._sodium_init() < 0) throw new Error("libsodium was not correctly initialized.");
    for (var e2 = ["crypto_aead_aegis128l_decrypt", "crypto_aead_aegis128l_decrypt_detached", "crypto_aead_aegis128l_encrypt", "crypto_aead_aegis128l_encrypt_detached", "crypto_aead_aegis128l_keygen", "crypto_aead_aegis256_decrypt", "crypto_aead_aegis256_decrypt_detached", "crypto_aead_aegis256_encrypt", "crypto_aead_aegis256_encrypt_detached", "crypto_aead_aegis256_keygen", "crypto_aead_chacha20poly1305_decrypt", "crypto_aead_chacha20poly1305_decrypt_detached", "crypto_aead_chacha20poly1305_encrypt", "crypto_aead_chacha20poly1305_encrypt_detached", "crypto_aead_chacha20poly1305_ietf_decrypt", "crypto_aead_chacha20poly1305_ietf_decrypt_detached", "crypto_aead_chacha20poly1305_ietf_encrypt", "crypto_aead_chacha20poly1305_ietf_encrypt_detached", "crypto_aead_chacha20poly1305_ietf_keygen", "crypto_aead_chacha20poly1305_keygen", "crypto_aead_xchacha20poly1305_ietf_decrypt", "crypto_aead_xchacha20poly1305_ietf_decrypt_detached", "crypto_aead_xchacha20poly1305_ietf_encrypt", "crypto_aead_xchacha20poly1305_ietf_encrypt_detached", "crypto_aead_xchacha20poly1305_ietf_keygen", "crypto_auth", "crypto_auth_hmacsha256", "crypto_auth_hmacsha256_final", "crypto_auth_hmacsha256_init", "crypto_auth_hmacsha256_keygen", "crypto_auth_hmacsha256_update", "crypto_auth_hmacsha256_verify", "crypto_auth_hmacsha512", "crypto_auth_hmacsha512256", "crypto_auth_hmacsha512256_final", "crypto_auth_hmacsha512256_init", "crypto_auth_hmacsha512256_keygen", "crypto_auth_hmacsha512256_update", "crypto_auth_hmacsha512256_verify", "crypto_auth_hmacsha512_final", "crypto_auth_hmacsha512_init", "crypto_auth_hmacsha512_keygen", "crypto_auth_hmacsha512_update", "crypto_auth_hmacsha512_verify", "crypto_auth_keygen", "crypto_auth_verify", "crypto_box_beforenm", "crypto_box_curve25519xchacha20poly1305_beforenm", "crypto_box_curve25519xchacha20poly1305_detached", "crypto_box_curve25519xchacha20poly1305_detached_afternm", "crypto_box_curve25519xchacha20poly1305_easy", "crypto_box_curve25519xchacha20poly1305_easy_afternm", "crypto_box_curve25519xchacha20poly1305_keypair", "crypto_box_curve25519xchacha20poly1305_open_detached", "crypto_box_curve25519xchacha20poly1305_open_detached_afternm", "crypto_box_curve25519xchacha20poly1305_open_easy", "crypto_box_curve25519xchacha20poly1305_open_easy_afternm", "crypto_box_curve25519xchacha20poly1305_seal", "crypto_box_curve25519xchacha20poly1305_seal_open", "crypto_box_curve25519xchacha20poly1305_seed_keypair", "crypto_box_detached", "crypto_box_easy", "crypto_box_easy_afternm", "crypto_box_keypair", "crypto_box_open_detached", "crypto_box_open_easy", "crypto_box_open_easy_afternm", "crypto_box_seal", "crypto_box_seal_open", "crypto_box_seed_keypair", "crypto_core_ed25519_add", "crypto_core_ed25519_from_hash", "crypto_core_ed25519_from_uniform", "crypto_core_ed25519_is_valid_point", "crypto_core_ed25519_random", "crypto_core_ed25519_scalar_add", "crypto_core_ed25519_scalar_complement", "crypto_core_ed25519_scalar_invert", "crypto_core_ed25519_scalar_mul", "crypto_core_ed25519_scalar_negate", "crypto_core_ed25519_scalar_random", "crypto_core_ed25519_scalar_reduce", "crypto_core_ed25519_scalar_sub", "crypto_core_ed25519_sub", "crypto_core_hchacha20", "crypto_core_hsalsa20", "crypto_core_ristretto255_add", "crypto_core_ristretto255_from_hash", "crypto_core_ristretto255_is_valid_point", "crypto_core_ristretto255_random", "crypto_core_ristretto255_scalar_add", "crypto_core_ristretto255_scalar_complement", "crypto_core_ristretto255_scalar_invert", "crypto_core_ristretto255_scalar_mul", "crypto_core_ristretto255_scalar_negate", "crypto_core_ristretto255_scalar_random", "crypto_core_ristretto255_scalar_reduce", "crypto_core_ristretto255_scalar_sub", "crypto_core_ristretto255_sub", "crypto_generichash", "crypto_generichash_blake2b_salt_personal", "crypto_generichash_final", "crypto_generichash_init", "crypto_generichash_keygen", "crypto_generichash_update", "crypto_hash", "crypto_hash_sha256", "crypto_hash_sha256_final", "crypto_hash_sha256_init", "crypto_hash_sha256_update", "crypto_hash_sha3256", "crypto_hash_sha3256_final", "crypto_hash_sha3256_init", "crypto_hash_sha3256_update", "crypto_hash_sha3512", "crypto_hash_sha3512_final", "crypto_hash_sha3512_init", "crypto_hash_sha3512_update", "crypto_hash_sha512", "crypto_hash_sha512_final", "crypto_hash_sha512_init", "crypto_hash_sha512_update", "crypto_ipcrypt_decrypt", "crypto_ipcrypt_encrypt", "crypto_ipcrypt_keygen", "crypto_ipcrypt_nd_decrypt", "crypto_ipcrypt_nd_encrypt", "crypto_ipcrypt_nd_keygen", "crypto_ipcrypt_ndx_decrypt", "crypto_ipcrypt_ndx_encrypt", "crypto_ipcrypt_ndx_keygen", "crypto_ipcrypt_pfx_decrypt", "crypto_ipcrypt_pfx_encrypt", "crypto_ipcrypt_pfx_keygen", "crypto_kdf_derive_from_key", "crypto_kdf_keygen", "crypto_kem_dec", "crypto_kem_enc", "crypto_kem_keypair", "crypto_kem_mlkem768_dec", "crypto_kem_mlkem768_enc", "crypto_kem_mlkem768_enc_deterministic", "crypto_kem_mlkem768_keypair", "crypto_kem_mlkem768_seed_keypair", "crypto_kem_primitive", "crypto_kem_seed_keypair", "crypto_kem_xwing_dec", "crypto_kem_xwing_enc", "crypto_kem_xwing_enc_deterministic", "crypto_kem_xwing_keypair", "crypto_kem_xwing_seed_keypair", "crypto_kx_client_session_keys", "crypto_kx_keypair", "crypto_kx_seed_keypair", "crypto_kx_server_session_keys", "crypto_onetimeauth", "crypto_onetimeauth_final", "crypto_onetimeauth_init", "crypto_onetimeauth_keygen", "crypto_onetimeauth_update", "crypto_onetimeauth_verify", "crypto_pwhash", "crypto_pwhash_scryptsalsa208sha256", "crypto_pwhash_scryptsalsa208sha256_ll", "crypto_pwhash_scryptsalsa208sha256_str", "crypto_pwhash_scryptsalsa208sha256_str_verify", "crypto_pwhash_str", "crypto_pwhash_str_needs_rehash", "crypto_pwhash_str_verify", "crypto_scalarmult", "crypto_scalarmult_base", "crypto_scalarmult_ed25519", "crypto_scalarmult_ed25519_base", "crypto_scalarmult_ed25519_base_noclamp", "crypto_scalarmult_ed25519_noclamp", "crypto_scalarmult_ristretto255", "crypto_scalarmult_ristretto255_base", "crypto_secretbox_detached", "crypto_secretbox_easy", "crypto_secretbox_keygen", "crypto_secretbox_open_detached", "crypto_secretbox_open_easy", "crypto_secretstream_xchacha20poly1305_init_pull", "crypto_secretstream_xchacha20poly1305_init_push", "crypto_secretstream_xchacha20poly1305_keygen", "crypto_secretstream_xchacha20poly1305_pull", "crypto_secretstream_xchacha20poly1305_push", "crypto_secretstream_xchacha20poly1305_rekey", "crypto_shorthash", "crypto_shorthash_keygen", "crypto_shorthash_siphashx24", "crypto_sign", "crypto_sign_detached", "crypto_sign_ed25519_pk_to_curve25519", "crypto_sign_ed25519_sk_to_curve25519", "crypto_sign_ed25519_sk_to_pk", "crypto_sign_ed25519_sk_to_seed", "crypto_sign_final_create", "crypto_sign_final_verify", "crypto_sign_init", "crypto_sign_keypair", "crypto_sign_open", "crypto_sign_seed_keypair", "crypto_sign_update", "crypto_sign_verify_detached", "crypto_stream_chacha20", "crypto_stream_chacha20_ietf_xor", "crypto_stream_chacha20_ietf_xor_ic", "crypto_stream_chacha20_keygen", "crypto_stream_chacha20_xor", "crypto_stream_chacha20_xor_ic", "crypto_stream_keygen", "crypto_stream_xchacha20_keygen", "crypto_stream_xchacha20_xor", "crypto_stream_xchacha20_xor_ic", "crypto_xof_shake128", "crypto_xof_shake128_init", "crypto_xof_shake128_init_with_domain", "crypto_xof_shake128_squeeze", "crypto_xof_shake128_update", "crypto_xof_shake256", "crypto_xof_shake256_init", "crypto_xof_shake256_init_with_domain", "crypto_xof_shake256_squeeze", "crypto_xof_shake256_update", "crypto_xof_turboshake128", "crypto_xof_turboshake128_init", "crypto_xof_turboshake128_init_with_domain", "crypto_xof_turboshake128_squeeze", "crypto_xof_turboshake128_update", "crypto_xof_turboshake256", "crypto_xof_turboshake256_init", "crypto_xof_turboshake256_init_with_domain", "crypto_xof_turboshake256_squeeze", "crypto_xof_turboshake256_update", "randombytes_buf", "randombytes_buf_deterministic", "randombytes_close", "randombytes_random", "randombytes_set_implementation", "randombytes_stir", "randombytes_uniform", "sodium_bin2ip", "sodium_ip2bin", "sodium_version_string"], a3 = [C, R, P, X, D, G, F, V, q, H, z, W, j, J, Q, Z, $, ee, re, te, ae, _e, ne, se, ce, pe, oe, he, ye, ie, le, ue, de, ve, ge, be, fe, me, ke, xe, Ee, Te, Se, we, Ye, Be, Ke, Ae, Ie, Me, Ne, Le, Ue, Oe, Ce, Re, Pe, Xe, De, Ge, Fe, Ve, qe, He, ze, We, je, Je, Qe, Ze, $e, er, rr, tr, ar, _r, nr, sr, cr, pr, or, hr, yr, ir, lr, ur, dr, vr, gr, br, fr, mr, kr, xr, Er, Tr, Sr, wr, Yr, Br, Kr, Ar, Ir, Mr, Nr, Lr, Ur, Or, Cr, Rr, Pr, Xr, Dr, Gr, Fr, Vr, qr, Hr, zr, Wr, jr, Jr, Qr, Zr, $r, et, rt, tt, at, _t, nt, st, ct, pt, ot, ht, yt, it, lt, ut, dt, vt, gt, bt, ft, mt, kt, xt, Et, Tt, St, wt, Yt, Bt, Kt, At, It, Mt, Nt, Lt, Ut, Ot, Ct, Rt, Pt, Xt, Dt, Gt, Ft, Vt, qt, Ht, zt, Wt, jt, Jt, Qt, Zt, $t, ea, ra, ta, aa, _a, na, sa, ca, pa, oa, ha, ya, ia, la, ua, da, va, ga, ba, fa, ma, ka, xa, Ea, Ta, Sa, wa, Ya, Ba, Ka, Aa, Ia, Ma, Na, La, Ua, Oa, Ca, Ra, Pa, Xa, Da, Ga, Fa, Va, qa, Ha, za, Wa, ja, Ja, Qa, Za, $a, e_, r_, t_, a_, __, n_, s_, c_, p_, o_, h_, y_], _3 = 0; _3 < a3.length; _3++) "function" == typeof r["_" + e2[_3]] && (t[e2[_3]] = a3[_3]);
    var n3 = ["SODIUM_LIBRARY_VERSION_MAJOR", "SODIUM_LIBRARY_VERSION_MINOR", "crypto_aead_aegis128l_ABYTES", "crypto_aead_aegis128l_KEYBYTES", "crypto_aead_aegis128l_MESSAGEBYTES_MAX", "crypto_aead_aegis128l_NPUBBYTES", "crypto_aead_aegis128l_NSECBYTES", "crypto_aead_aegis256_ABYTES", "crypto_aead_aegis256_KEYBYTES", "crypto_aead_aegis256_MESSAGEBYTES_MAX", "crypto_aead_aegis256_NPUBBYTES", "crypto_aead_aegis256_NSECBYTES", "crypto_aead_aes256gcm_ABYTES", "crypto_aead_aes256gcm_KEYBYTES", "crypto_aead_aes256gcm_MESSAGEBYTES_MAX", "crypto_aead_aes256gcm_NPUBBYTES", "crypto_aead_aes256gcm_NSECBYTES", "crypto_aead_chacha20poly1305_ABYTES", "crypto_aead_chacha20poly1305_IETF_ABYTES", "crypto_aead_chacha20poly1305_IETF_KEYBYTES", "crypto_aead_chacha20poly1305_IETF_MESSAGEBYTES_MAX", "crypto_aead_chacha20poly1305_IETF_NPUBBYTES", "crypto_aead_chacha20poly1305_IETF_NSECBYTES", "crypto_aead_chacha20poly1305_KEYBYTES", "crypto_aead_chacha20poly1305_MESSAGEBYTES_MAX", "crypto_aead_chacha20poly1305_NPUBBYTES", "crypto_aead_chacha20poly1305_NSECBYTES", "crypto_aead_chacha20poly1305_ietf_ABYTES", "crypto_aead_chacha20poly1305_ietf_KEYBYTES", "crypto_aead_chacha20poly1305_ietf_MESSAGEBYTES_MAX", "crypto_aead_chacha20poly1305_ietf_NPUBBYTES", "crypto_aead_chacha20poly1305_ietf_NSECBYTES", "crypto_aead_xchacha20poly1305_IETF_ABYTES", "crypto_aead_xchacha20poly1305_IETF_KEYBYTES", "crypto_aead_xchacha20poly1305_IETF_MESSAGEBYTES_MAX", "crypto_aead_xchacha20poly1305_IETF_NPUBBYTES", "crypto_aead_xchacha20poly1305_IETF_NSECBYTES", "crypto_aead_xchacha20poly1305_ietf_ABYTES", "crypto_aead_xchacha20poly1305_ietf_KEYBYTES", "crypto_aead_xchacha20poly1305_ietf_MESSAGEBYTES_MAX", "crypto_aead_xchacha20poly1305_ietf_NPUBBYTES", "crypto_aead_xchacha20poly1305_ietf_NSECBYTES", "crypto_auth_BYTES", "crypto_auth_KEYBYTES", "crypto_auth_hmacsha256_BYTES", "crypto_auth_hmacsha256_KEYBYTES", "crypto_auth_hmacsha512256_BYTES", "crypto_auth_hmacsha512256_KEYBYTES", "crypto_auth_hmacsha512_BYTES", "crypto_auth_hmacsha512_KEYBYTES", "crypto_box_BEFORENMBYTES", "crypto_box_MACBYTES", "crypto_box_MESSAGEBYTES_MAX", "crypto_box_NONCEBYTES", "crypto_box_PUBLICKEYBYTES", "crypto_box_SEALBYTES", "crypto_box_SECRETKEYBYTES", "crypto_box_SEEDBYTES", "crypto_box_curve25519xchacha20poly1305_BEFORENMBYTES", "crypto_box_curve25519xchacha20poly1305_MACBYTES", "crypto_box_curve25519xchacha20poly1305_MESSAGEBYTES_MAX", "crypto_box_curve25519xchacha20poly1305_NONCEBYTES", "crypto_box_curve25519xchacha20poly1305_PUBLICKEYBYTES", "crypto_box_curve25519xchacha20poly1305_SEALBYTES", "crypto_box_curve25519xchacha20poly1305_SECRETKEYBYTES", "crypto_box_curve25519xchacha20poly1305_SEEDBYTES", "crypto_box_curve25519xsalsa20poly1305_BEFORENMBYTES", "crypto_box_curve25519xsalsa20poly1305_MACBYTES", "crypto_box_curve25519xsalsa20poly1305_MESSAGEBYTES_MAX", "crypto_box_curve25519xsalsa20poly1305_NONCEBYTES", "crypto_box_curve25519xsalsa20poly1305_PUBLICKEYBYTES", "crypto_box_curve25519xsalsa20poly1305_SECRETKEYBYTES", "crypto_box_curve25519xsalsa20poly1305_SEEDBYTES", "crypto_core_ed25519_BYTES", "crypto_core_ed25519_HASHBYTES", "crypto_core_ed25519_NONREDUCEDSCALARBYTES", "crypto_core_ed25519_SCALARBYTES", "crypto_core_ed25519_UNIFORMBYTES", "crypto_core_hchacha20_CONSTBYTES", "crypto_core_hchacha20_INPUTBYTES", "crypto_core_hchacha20_KEYBYTES", "crypto_core_hchacha20_OUTPUTBYTES", "crypto_core_hsalsa20_CONSTBYTES", "crypto_core_hsalsa20_INPUTBYTES", "crypto_core_hsalsa20_KEYBYTES", "crypto_core_hsalsa20_OUTPUTBYTES", "crypto_core_ristretto255_BYTES", "crypto_core_ristretto255_HASHBYTES", "crypto_core_ristretto255_NONREDUCEDSCALARBYTES", "crypto_core_ristretto255_SCALARBYTES", "crypto_core_salsa2012_CONSTBYTES", "crypto_core_salsa2012_INPUTBYTES", "crypto_core_salsa2012_KEYBYTES", "crypto_core_salsa2012_OUTPUTBYTES", "crypto_core_salsa208_CONSTBYTES", "crypto_core_salsa208_INPUTBYTES", "crypto_core_salsa208_KEYBYTES", "crypto_core_salsa208_OUTPUTBYTES", "crypto_core_salsa20_CONSTBYTES", "crypto_core_salsa20_INPUTBYTES", "crypto_core_salsa20_KEYBYTES", "crypto_core_salsa20_OUTPUTBYTES", "crypto_generichash_BYTES", "crypto_generichash_BYTES_MAX", "crypto_generichash_BYTES_MIN", "crypto_generichash_KEYBYTES", "crypto_generichash_KEYBYTES_MAX", "crypto_generichash_KEYBYTES_MIN", "crypto_generichash_blake2b_BYTES", "crypto_generichash_blake2b_BYTES_MAX", "crypto_generichash_blake2b_BYTES_MIN", "crypto_generichash_blake2b_KEYBYTES", "crypto_generichash_blake2b_KEYBYTES_MAX", "crypto_generichash_blake2b_KEYBYTES_MIN", "crypto_generichash_blake2b_PERSONALBYTES", "crypto_generichash_blake2b_SALTBYTES", "crypto_hash_BYTES", "crypto_hash_sha256_BYTES", "crypto_hash_sha3256_BYTES", "crypto_hash_sha3512_BYTES", "crypto_hash_sha512_BYTES", "crypto_ipcrypt_BYTES", "crypto_ipcrypt_KEYBYTES", "crypto_ipcrypt_NDX_INPUTBYTES", "crypto_ipcrypt_NDX_KEYBYTES", "crypto_ipcrypt_NDX_OUTPUTBYTES", "crypto_ipcrypt_NDX_TWEAKBYTES", "crypto_ipcrypt_ND_INPUTBYTES", "crypto_ipcrypt_ND_KEYBYTES", "crypto_ipcrypt_ND_OUTPUTBYTES", "crypto_ipcrypt_ND_TWEAKBYTES", "crypto_ipcrypt_PFX_BYTES", "crypto_ipcrypt_PFX_KEYBYTES", "crypto_kdf_BYTES_MAX", "crypto_kdf_BYTES_MIN", "crypto_kdf_CONTEXTBYTES", "crypto_kdf_KEYBYTES", "crypto_kdf_blake2b_BYTES_MAX", "crypto_kdf_blake2b_BYTES_MIN", "crypto_kdf_blake2b_CONTEXTBYTES", "crypto_kdf_blake2b_KEYBYTES", "crypto_kdf_hkdf_sha256_BYTES_MAX", "crypto_kdf_hkdf_sha256_BYTES_MIN", "crypto_kdf_hkdf_sha256_KEYBYTES", "crypto_kdf_hkdf_sha512_BYTES_MAX", "crypto_kdf_hkdf_sha512_BYTES_MIN", "crypto_kdf_hkdf_sha512_KEYBYTES", "crypto_kem_CIPHERTEXTBYTES", "crypto_kem_PUBLICKEYBYTES", "crypto_kem_SECRETKEYBYTES", "crypto_kem_SEEDBYTES", "crypto_kem_SHAREDSECRETBYTES", "crypto_kem_mlkem768_CIPHERTEXTBYTES", "crypto_kem_mlkem768_PUBLICKEYBYTES", "crypto_kem_mlkem768_SECRETKEYBYTES", "crypto_kem_mlkem768_SEEDBYTES", "crypto_kem_mlkem768_SHAREDSECRETBYTES", "crypto_kem_xwing_CIPHERTEXTBYTES", "crypto_kem_xwing_PUBLICKEYBYTES", "crypto_kem_xwing_SECRETKEYBYTES", "crypto_kem_xwing_SEEDBYTES", "crypto_kem_xwing_SHAREDSECRETBYTES", "crypto_kx_PUBLICKEYBYTES", "crypto_kx_SECRETKEYBYTES", "crypto_kx_SEEDBYTES", "crypto_kx_SESSIONKEYBYTES", "crypto_onetimeauth_BYTES", "crypto_onetimeauth_KEYBYTES", "crypto_onetimeauth_poly1305_BYTES", "crypto_onetimeauth_poly1305_KEYBYTES", "crypto_pwhash_ALG_ARGON2I13", "crypto_pwhash_ALG_ARGON2ID13", "crypto_pwhash_ALG_DEFAULT", "crypto_pwhash_BYTES_MAX", "crypto_pwhash_BYTES_MIN", "crypto_pwhash_MEMLIMIT_INTERACTIVE", "crypto_pwhash_MEMLIMIT_MAX", "crypto_pwhash_MEMLIMIT_MIN", "crypto_pwhash_MEMLIMIT_MODERATE", "crypto_pwhash_MEMLIMIT_SENSITIVE", "crypto_pwhash_OPSLIMIT_INTERACTIVE", "crypto_pwhash_OPSLIMIT_MAX", "crypto_pwhash_OPSLIMIT_MIN", "crypto_pwhash_OPSLIMIT_MODERATE", "crypto_pwhash_OPSLIMIT_SENSITIVE", "crypto_pwhash_PASSWD_MAX", "crypto_pwhash_PASSWD_MIN", "crypto_pwhash_SALTBYTES", "crypto_pwhash_STRBYTES", "crypto_pwhash_argon2i_BYTES_MAX", "crypto_pwhash_argon2i_BYTES_MIN", "crypto_pwhash_argon2i_MEMLIMIT_INTERACTIVE", "crypto_pwhash_argon2i_MEMLIMIT_MAX", "crypto_pwhash_argon2i_MEMLIMIT_MIN", "crypto_pwhash_argon2i_MEMLIMIT_MODERATE", "crypto_pwhash_argon2i_MEMLIMIT_SENSITIVE", "crypto_pwhash_argon2i_OPSLIMIT_INTERACTIVE", "crypto_pwhash_argon2i_OPSLIMIT_MAX", "crypto_pwhash_argon2i_OPSLIMIT_MIN", "crypto_pwhash_argon2i_OPSLIMIT_MODERATE", "crypto_pwhash_argon2i_OPSLIMIT_SENSITIVE", "crypto_pwhash_argon2i_PASSWD_MAX", "crypto_pwhash_argon2i_PASSWD_MIN", "crypto_pwhash_argon2i_SALTBYTES", "crypto_pwhash_argon2i_STRBYTES", "crypto_pwhash_argon2id_BYTES_MAX", "crypto_pwhash_argon2id_BYTES_MIN", "crypto_pwhash_argon2id_MEMLIMIT_INTERACTIVE", "crypto_pwhash_argon2id_MEMLIMIT_MAX", "crypto_pwhash_argon2id_MEMLIMIT_MIN", "crypto_pwhash_argon2id_MEMLIMIT_MODERATE", "crypto_pwhash_argon2id_MEMLIMIT_SENSITIVE", "crypto_pwhash_argon2id_OPSLIMIT_INTERACTIVE", "crypto_pwhash_argon2id_OPSLIMIT_MAX", "crypto_pwhash_argon2id_OPSLIMIT_MIN", "crypto_pwhash_argon2id_OPSLIMIT_MODERATE", "crypto_pwhash_argon2id_OPSLIMIT_SENSITIVE", "crypto_pwhash_argon2id_PASSWD_MAX", "crypto_pwhash_argon2id_PASSWD_MIN", "crypto_pwhash_argon2id_SALTBYTES", "crypto_pwhash_argon2id_STRBYTES", "crypto_pwhash_scryptsalsa208sha256_BYTES_MAX", "crypto_pwhash_scryptsalsa208sha256_BYTES_MIN", "crypto_pwhash_scryptsalsa208sha256_MEMLIMIT_INTERACTIVE", "crypto_pwhash_scryptsalsa208sha256_MEMLIMIT_MAX", "crypto_pwhash_scryptsalsa208sha256_MEMLIMIT_MIN", "crypto_pwhash_scryptsalsa208sha256_MEMLIMIT_SENSITIVE", "crypto_pwhash_scryptsalsa208sha256_OPSLIMIT_INTERACTIVE", "crypto_pwhash_scryptsalsa208sha256_OPSLIMIT_MAX", "crypto_pwhash_scryptsalsa208sha256_OPSLIMIT_MIN", "crypto_pwhash_scryptsalsa208sha256_OPSLIMIT_SENSITIVE", "crypto_pwhash_scryptsalsa208sha256_PASSWD_MAX", "crypto_pwhash_scryptsalsa208sha256_PASSWD_MIN", "crypto_pwhash_scryptsalsa208sha256_SALTBYTES", "crypto_pwhash_scryptsalsa208sha256_STRBYTES", "crypto_scalarmult_BYTES", "crypto_scalarmult_SCALARBYTES", "crypto_scalarmult_curve25519_BYTES", "crypto_scalarmult_curve25519_SCALARBYTES", "crypto_scalarmult_ed25519_BYTES", "crypto_scalarmult_ed25519_SCALARBYTES", "crypto_scalarmult_ristretto255_BYTES", "crypto_scalarmult_ristretto255_SCALARBYTES", "crypto_secretbox_KEYBYTES", "crypto_secretbox_MACBYTES", "crypto_secretbox_MESSAGEBYTES_MAX", "crypto_secretbox_NONCEBYTES", "crypto_secretbox_xchacha20poly1305_KEYBYTES", "crypto_secretbox_xchacha20poly1305_MACBYTES", "crypto_secretbox_xchacha20poly1305_MESSAGEBYTES_MAX", "crypto_secretbox_xchacha20poly1305_NONCEBYTES", "crypto_secretbox_xsalsa20poly1305_KEYBYTES", "crypto_secretbox_xsalsa20poly1305_MACBYTES", "crypto_secretbox_xsalsa20poly1305_MESSAGEBYTES_MAX", "crypto_secretbox_xsalsa20poly1305_NONCEBYTES", "crypto_secretstream_xchacha20poly1305_ABYTES", "crypto_secretstream_xchacha20poly1305_HEADERBYTES", "crypto_secretstream_xchacha20poly1305_KEYBYTES", "crypto_secretstream_xchacha20poly1305_MESSAGEBYTES_MAX", "crypto_secretstream_xchacha20poly1305_TAG_FINAL", "crypto_secretstream_xchacha20poly1305_TAG_MESSAGE", "crypto_secretstream_xchacha20poly1305_TAG_PUSH", "crypto_secretstream_xchacha20poly1305_TAG_REKEY", "crypto_shorthash_BYTES", "crypto_shorthash_KEYBYTES", "crypto_shorthash_siphash24_BYTES", "crypto_shorthash_siphash24_KEYBYTES", "crypto_shorthash_siphashx24_BYTES", "crypto_shorthash_siphashx24_KEYBYTES", "crypto_sign_BYTES", "crypto_sign_MESSAGEBYTES_MAX", "crypto_sign_PUBLICKEYBYTES", "crypto_sign_SECRETKEYBYTES", "crypto_sign_SEEDBYTES", "crypto_sign_ed25519_BYTES", "crypto_sign_ed25519_MESSAGEBYTES_MAX", "crypto_sign_ed25519_PUBLICKEYBYTES", "crypto_sign_ed25519_SECRETKEYBYTES", "crypto_sign_ed25519_SEEDBYTES", "crypto_stream_KEYBYTES", "crypto_stream_MESSAGEBYTES_MAX", "crypto_stream_NONCEBYTES", "crypto_stream_chacha20_IETF_KEYBYTES", "crypto_stream_chacha20_IETF_MESSAGEBYTES_MAX", "crypto_stream_chacha20_IETF_NONCEBYTES", "crypto_stream_chacha20_KEYBYTES", "crypto_stream_chacha20_MESSAGEBYTES_MAX", "crypto_stream_chacha20_NONCEBYTES", "crypto_stream_chacha20_ietf_KEYBYTES", "crypto_stream_chacha20_ietf_MESSAGEBYTES_MAX", "crypto_stream_chacha20_ietf_NONCEBYTES", "crypto_stream_salsa2012_KEYBYTES", "crypto_stream_salsa2012_MESSAGEBYTES_MAX", "crypto_stream_salsa2012_NONCEBYTES", "crypto_stream_salsa208_KEYBYTES", "crypto_stream_salsa208_MESSAGEBYTES_MAX", "crypto_stream_salsa208_NONCEBYTES", "crypto_stream_salsa20_KEYBYTES", "crypto_stream_salsa20_MESSAGEBYTES_MAX", "crypto_stream_salsa20_NONCEBYTES", "crypto_stream_xchacha20_KEYBYTES", "crypto_stream_xchacha20_MESSAGEBYTES_MAX", "crypto_stream_xchacha20_NONCEBYTES", "crypto_stream_xsalsa20_KEYBYTES", "crypto_stream_xsalsa20_MESSAGEBYTES_MAX", "crypto_stream_xsalsa20_NONCEBYTES", "crypto_verify_16_BYTES", "crypto_verify_32_BYTES", "crypto_verify_64_BYTES", "crypto_xof_shake128_BLOCKBYTES", "crypto_xof_shake128_STATEBYTES", "crypto_xof_shake256_BLOCKBYTES", "crypto_xof_shake256_STATEBYTES", "crypto_xof_turboshake128_BLOCKBYTES", "crypto_xof_turboshake128_STATEBYTES", "crypto_xof_turboshake256_BLOCKBYTES", "crypto_xof_turboshake256_STATEBYTES"];
    for (_3 = 0; _3 < n3.length; _3++) "function" == typeof (c3 = r["_" + n3[_3].toLowerCase()]) && (t[n3[_3]] = c3());
    var s3 = ["SODIUM_VERSION_STRING", "crypto_kem_PRIMITIVE", "crypto_pwhash_STRPREFIX", "crypto_pwhash_argon2i_STRPREFIX", "crypto_pwhash_argon2id_STRPREFIX", "crypto_pwhash_scryptsalsa208sha256_STRPREFIX"];
    for (_3 = 0; _3 < s3.length; _3++) {
      var c3;
      "function" == typeof (c3 = r["_" + s3[_3].toLowerCase()]) && (t[s3[_3]] = r.UTF8ToString(c3()));
    }
  })();
  var a2 = new Uint8Array([98, 97, 108, 108, 115]), _2 = t.randombytes_buf(t.crypto_secretbox_NONCEBYTES), n2 = t.randombytes_buf(t.crypto_secretbox_KEYBYTES), s2 = t.crypto_secretbox_easy(a2, _2, n2), c2 = t.crypto_secretbox_open_easy(s2, _2, n2);
  if (!t.memcmp(a2, c2)) throw new Error("Initialization self-test failed");
});
function c() {
  return Object.keys(t).sort();
}
function p(e) {
  if (!(e instanceof Uint8Array)) throw new TypeError("Only Uint8Array instances can be incremented");
  for (var r2 = 256, t2 = 0, a2 = e.length; t2 < a2; t2++) r2 >>= 8, r2 += e[t2], e[t2] = 255 & r2;
}
function o(e, r2) {
  if (!(e instanceof Uint8Array && r2 instanceof Uint8Array)) throw new TypeError("Only Uint8Array instances can be added");
  var t2 = e.length, a2 = 0, _2 = 0;
  if (r2.length !== e.length) throw new TypeError("Arguments must have the same length");
  for (_2 = 0; _2 < t2; _2++) a2 >>= 8, a2 += e[_2] + r2[_2], e[_2] = 255 & a2;
}
function h(e) {
  if (!(e instanceof Uint8Array)) throw new TypeError("Only Uint8Array instances can be checked");
  for (var r2 = 0, t2 = 0, a2 = e.length; t2 < a2; t2++) r2 |= e[t2];
  return 0 === r2;
}
function y(e) {
  if (!(e instanceof Uint8Array)) throw new TypeError("Only Uint8Array instances can be wiped");
  for (var r2 = 0, t2 = e.length; r2 < t2; r2++) e[r2] = 0;
}
function i(e, r2) {
  if (!(e instanceof Uint8Array && r2 instanceof Uint8Array)) throw new TypeError("Only Uint8Array instances can be compared");
  if (e.length !== r2.length) throw new TypeError("Only instances of identical length can be compared");
  for (var t2 = 0, a2 = 0, _2 = e.length; a2 < _2; a2++) t2 |= e[a2] ^ r2[a2];
  return 0 === t2;
}
function l(e, r2) {
  if (!(e instanceof Uint8Array && r2 instanceof Uint8Array)) throw new TypeError("Only Uint8Array instances can be compared");
  if (e.length !== r2.length) throw new TypeError("Only instances of identical length can be compared");
  for (var t2 = 0, a2 = 1, _2 = e.length; _2-- > 0; ) t2 |= r2[_2] - e[_2] >> 8 & a2, a2 &= (r2[_2] ^ e[_2]) - 1 >> 8;
  return t2 + t2 + a2 - 1;
}
function u(e, t2) {
  if (!(e instanceof Uint8Array)) throw new TypeError("buffer must be a Uint8Array");
  if ((t2 |= 0) <= 0) throw new Error("block size must be > 0");
  var a2, _2 = [], n2 = A2(4), s2 = 1, c2 = 0, p2 = 0 | e.length, o2 = new B(p2 + t2);
  _2.push(n2), _2.push(o2.address);
  for (var h2 = o2.address, y2 = o2.address + p2 + t2; h2 < y2; h2++) r.HEAPU8[h2] = e[c2], c2 += s2 = 1 & ~((65535 & ((p2 -= s2) >>> 48 | p2 >>> 32 | p2 >>> 16 | p2)) - 1 >> 16);
  return 0 !== r._sodium_pad(n2, o2.address, e.length, t2, o2.length) && N(_2, "internal error"), o2.length = r.getValue(n2, "i32"), a2 = o2.to_Uint8Array(), M(_2), a2;
}
function d(e, t2) {
  if (!(e instanceof Uint8Array)) throw new TypeError("buffer must be a Uint8Array");
  if ((t2 |= 0) <= 0) throw new Error("block size must be > 0");
  var a2 = [], _2 = K(e), n2 = A2(4);
  return a2.push(_2), a2.push(n2), 0 !== r._sodium_unpad(n2, _2, e.length, t2) && N(a2, "unsupported/invalid padding"), e = (e = new Uint8Array(e)).subarray(0, r.getValue(n2, "i32")), M(a2), e;
}
function v(e) {
  if ("function" == typeof TextEncoder) return new TextEncoder().encode(e);
  e = unescape(encodeURIComponent(e));
  for (var r2 = new Uint8Array(e.length), t2 = 0, a2 = e.length; t2 < a2; t2++) r2[t2] = e.charCodeAt(t2);
  return r2;
}
function g(e) {
  if ("function" == typeof TextDecoder) return new TextDecoder("utf-8", { fatal: true }).decode(e);
  var r2 = 8192, t2 = Math.ceil(e.length / r2);
  if (t2 <= 1) try {
    return decodeURIComponent(escape(String.fromCharCode.apply(null, e)));
  } catch (e2) {
    throw new TypeError("The encoded data was not valid.");
  }
  for (var a2 = "", _2 = 0, n2 = 0; n2 < t2; n2++) {
    var s2 = Array.prototype.slice.call(e, n2 * r2 + _2, (n2 + 1) * r2 + _2);
    if (0 !== s2.length) {
      var c2, p2 = s2.length, o2 = 0;
      do {
        var h2 = s2[--p2];
        h2 >= 240 ? (o2 = 4, c2 = true) : h2 >= 224 ? (o2 = 3, c2 = true) : h2 >= 192 ? (o2 = 2, c2 = true) : h2 < 128 && (o2 = 1, c2 = true);
      } while (!c2);
      for (var y2 = o2 - (s2.length - p2), i2 = 0; i2 < y2; i2++) _2--, s2.pop();
      a2 += g(s2);
    }
  }
  return a2;
}
function b(e) {
  var t2, a2 = [], _2 = new B((e = O(a2, e, "input")).length / 2), n2 = K(e), s2 = A2(4);
  return a2.push(n2), a2.push(_2.address), a2.push(s2), 0 !== r._sodium_hex2bin(_2.address, _2.length, n2, e.length, 0, 0, s2) && N(a2, "invalid input"), r.getValue(s2, "i32") - n2 !== e.length && N(a2, "incomplete input"), t2 = _2.to_Uint8Array(), M(a2), t2;
}
function f(e) {
  e = O(null, e, "input");
  for (var r2, t2, a2, _2 = "", n2 = 0; n2 < e.length; n2++) a2 = 87 + (t2 = 15 & e[n2]) + (t2 - 10 >> 8 & -39) << 8 | 87 + (r2 = e[n2] >>> 4) + (r2 - 10 >> 8 & -39), _2 += String.fromCharCode(255 & a2) + String.fromCharCode(a2 >>> 8);
  return _2;
}
var m = { ORIGINAL: 1, ORIGINAL_NO_PADDING: 3, URLSAFE: 5, URLSAFE_NO_PADDING: 7 };
function k(e) {
  if (void 0 === e) return m.URLSAFE_NO_PADDING;
  if (e !== m.ORIGINAL && e !== m.ORIGINAL_NO_PADDING && e !== m.URLSAFE && e !== m.URLSAFE_NO_PADDING) throw new Error("unsupported base64 variant");
  return e;
}
function x(e, t2) {
  t2 = k(t2);
  var a2, _2 = [], n2 = new B(3 * (e = O(_2, e, "input")).length / 4), s2 = K(e), c2 = A2(4), p2 = A2(4);
  return _2.push(s2), _2.push(n2.address), _2.push(c2), _2.push(p2), 0 !== r._sodium_base642bin(n2.address, n2.length, s2, e.length, 0, c2, p2, t2) && N(_2, "invalid input"), r.getValue(p2, "i32") - s2 !== e.length && N(_2, "incomplete input"), n2.length = r.getValue(c2, "i32"), a2 = n2.to_Uint8Array(), M(_2), a2;
}
function E(e, t2) {
  t2 = k(t2);
  var a2 = [];
  e = O(a2, e, "input");
  var _2, n2 = 0 | Math.floor(e.length / 3), s2 = e.length - 3 * n2, c2 = 4 * n2 + (0 !== s2 ? 2 & t2 ? 2 + (s2 >>> 1) : 4 : 0), p2 = new B(c2 + 1), o2 = K(e);
  return a2.push(o2), a2.push(p2.address), 0 === r._sodium_bin2base64(p2.address, p2.length, o2, e.length, t2) && N(a2, "conversion failed"), p2.length = c2, _2 = g(p2.to_Uint8Array()), M(a2), _2;
}
function T() {
  return ["uint8array", "text", "hex", "base64"];
}
function S(e, r2) {
  var t2 = r2 || "uint8array";
  if (!w(t2)) throw new Error(t2 + " output format is not available");
  if (e instanceof B) {
    if ("uint8array" === t2) return e.to_Uint8Array();
    if ("text" === t2) return g(e.to_Uint8Array());
    if ("hex" === t2) return f(e.to_Uint8Array());
    if ("base64" === t2) return E(e.to_Uint8Array(), m.URLSAFE_NO_PADDING);
    throw new Error('What is output format "' + t2 + '"?');
  }
  if ("object" == typeof e) {
    for (var a2 = Object.keys(e), _2 = {}, n2 = 0; n2 < a2.length; n2++) _2[a2[n2]] = S(e[a2[n2]], t2);
    return _2;
  }
  if ("string" == typeof e) return e;
  throw new TypeError("Cannot format output");
}
function w(e) {
  for (var r2 = ["uint8array", "text", "hex", "base64"], t2 = 0; t2 < r2.length; t2++) if (r2[t2] === e) return true;
  return false;
}
function Y(e) {
  if (e) {
    if ("string" != typeof e) throw new TypeError("When defined, the output format must be a string");
    if (!w(e)) throw new Error(e + " is not a supported output format");
  }
}
function B(e) {
  this.length = e, this.address = A2(e);
}
function K(e) {
  var t2 = A2(e.length);
  return r.HEAPU8.set(e, t2), t2;
}
function A2(e) {
  var t2 = r._malloc(e);
  if (0 === t2) throw { message: "_malloc() failed", length: e };
  return t2;
}
function I(e) {
  r._free(e);
}
function M(e) {
  if (e) for (var r2 = 0; r2 < e.length; r2++) I(e[r2]);
}
function N(e, r2) {
  throw M(e), new Error(r2);
}
function L(e, r2) {
  throw M(e), new TypeError(r2);
}
function U(e, r2, t2) {
  null == r2 && L(e, t2 + " cannot be null or undefined");
}
function O(e, r2, t2) {
  return U(e, r2, t2), r2 instanceof Uint8Array ? r2 : "string" == typeof r2 ? v(r2) : void L(e, "unsupported input type for " + t2);
}
function C(e, t2, a2, _2, n2, s2) {
  var c2 = [];
  Y(s2);
  var p2 = null;
  null != e && (p2 = K(e = O(c2, e, "secret_nonce")), e.length, c2.push(p2)), t2 = O(c2, t2, "ciphertext");
  var o2, h2 = r._crypto_aead_aegis128l_abytes(), y2 = t2.length;
  y2 < h2 && L(c2, "ciphertext is too short"), o2 = K(t2), c2.push(o2);
  var i2 = null, l2 = 0;
  null != a2 && (i2 = K(a2 = O(c2, a2, "additional_data")), l2 = a2.length, c2.push(i2)), _2 = O(c2, _2, "public_nonce");
  var u2, d2 = 0 | r._crypto_aead_aegis128l_npubbytes();
  _2.length !== d2 && L(c2, "invalid public_nonce length"), u2 = K(_2), c2.push(u2), n2 = O(c2, n2, "key");
  var v2, g2 = 0 | r._crypto_aead_aegis128l_keybytes();
  n2.length !== g2 && L(c2, "invalid key length"), v2 = K(n2), c2.push(v2);
  var b2 = new B(y2 - r._crypto_aead_aegis128l_abytes() | 0), f2 = b2.address;
  if (c2.push(f2), 0 === r._crypto_aead_aegis128l_decrypt(f2, null, p2, o2, y2, 0, i2, l2, 0, u2, v2)) {
    var m2 = S(b2, s2);
    return M(c2), m2;
  }
  N(c2, "ciphertext cannot be decrypted using that key");
}
function R(e, t2, a2, _2, n2, s2, c2) {
  var p2 = [];
  Y(c2);
  var o2 = null;
  null != e && (o2 = K(e = O(p2, e, "secret_nonce")), e.length, p2.push(o2));
  var h2 = K(t2 = O(p2, t2, "ciphertext")), y2 = t2.length;
  p2.push(h2), a2 = O(p2, a2, "mac");
  var i2, l2 = 0 | r._crypto_aead_aegis128l_abytes();
  a2.length !== l2 && L(p2, "invalid mac length"), i2 = K(a2), p2.push(i2);
  var u2 = null, d2 = 0;
  null != _2 && (u2 = K(_2 = O(p2, _2, "additional_data")), d2 = _2.length, p2.push(u2)), n2 = O(p2, n2, "public_nonce");
  var v2, g2 = 0 | r._crypto_aead_aegis128l_npubbytes();
  n2.length !== g2 && L(p2, "invalid public_nonce length"), v2 = K(n2), p2.push(v2), s2 = O(p2, s2, "key");
  var b2, f2 = 0 | r._crypto_aead_aegis128l_keybytes();
  s2.length !== f2 && L(p2, "invalid key length"), b2 = K(s2), p2.push(b2);
  var m2 = new B(0 | y2), k2 = m2.address;
  if (p2.push(k2), 0 === r._crypto_aead_aegis128l_decrypt_detached(k2, o2, h2, y2, 0, i2, u2, d2, 0, v2, b2)) {
    var x2 = S(m2, c2);
    return M(p2), x2;
  }
  N(p2, "ciphertext cannot be decrypted using that key");
}
function P(e, t2, a2, _2, n2, s2) {
  var c2 = [];
  Y(s2);
  var p2 = K(e = O(c2, e, "message")), o2 = e.length;
  c2.push(p2);
  var h2 = null, y2 = 0;
  null != t2 && (h2 = K(t2 = O(c2, t2, "additional_data")), y2 = t2.length, c2.push(h2));
  var i2 = null;
  null != a2 && (i2 = K(a2 = O(c2, a2, "secret_nonce")), a2.length, c2.push(i2)), _2 = O(c2, _2, "public_nonce");
  var l2, u2 = 0 | r._crypto_aead_aegis128l_npubbytes();
  _2.length !== u2 && L(c2, "invalid public_nonce length"), l2 = K(_2), c2.push(l2), n2 = O(c2, n2, "key");
  var d2, v2 = 0 | r._crypto_aead_aegis128l_keybytes();
  n2.length !== v2 && L(c2, "invalid key length"), d2 = K(n2), c2.push(d2);
  var g2 = new B(o2 + r._crypto_aead_aegis128l_abytes() | 0), b2 = g2.address;
  if (c2.push(b2), 0 === r._crypto_aead_aegis128l_encrypt(b2, null, p2, o2, 0, h2, y2, 0, i2, l2, d2)) {
    var f2 = S(g2, s2);
    return M(c2), f2;
  }
  N(c2, "invalid usage");
}
function X(e, t2, a2, _2, n2, s2) {
  var c2 = [];
  Y(s2);
  var p2 = K(e = O(c2, e, "message")), o2 = e.length;
  c2.push(p2);
  var h2 = null, y2 = 0;
  null != t2 && (h2 = K(t2 = O(c2, t2, "additional_data")), y2 = t2.length, c2.push(h2));
  var i2 = null;
  null != a2 && (i2 = K(a2 = O(c2, a2, "secret_nonce")), a2.length, c2.push(i2)), _2 = O(c2, _2, "public_nonce");
  var l2, u2 = 0 | r._crypto_aead_aegis128l_npubbytes();
  _2.length !== u2 && L(c2, "invalid public_nonce length"), l2 = K(_2), c2.push(l2), n2 = O(c2, n2, "key");
  var d2, v2 = 0 | r._crypto_aead_aegis128l_keybytes();
  n2.length !== v2 && L(c2, "invalid key length"), d2 = K(n2), c2.push(d2);
  var g2 = new B(0 | o2), b2 = g2.address;
  c2.push(b2);
  var f2 = new B(0 | r._crypto_aead_aegis128l_abytes()), m2 = f2.address;
  if (c2.push(m2), 0 === r._crypto_aead_aegis128l_encrypt_detached(b2, m2, null, p2, o2, 0, h2, y2, 0, i2, l2, d2)) {
    var k2 = S({ ciphertext: g2, mac: f2 }, s2);
    return M(c2), k2;
  }
  N(c2, "invalid usage");
}
function D(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_aead_aegis128l_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_aead_aegis128l_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function G(e, t2, a2, _2, n2, s2) {
  var c2 = [];
  Y(s2);
  var p2 = null;
  null != e && (p2 = K(e = O(c2, e, "secret_nonce")), e.length, c2.push(p2)), t2 = O(c2, t2, "ciphertext");
  var o2, h2 = r._crypto_aead_aegis256_abytes(), y2 = t2.length;
  y2 < h2 && L(c2, "ciphertext is too short"), o2 = K(t2), c2.push(o2);
  var i2 = null, l2 = 0;
  null != a2 && (i2 = K(a2 = O(c2, a2, "additional_data")), l2 = a2.length, c2.push(i2)), _2 = O(c2, _2, "public_nonce");
  var u2, d2 = 0 | r._crypto_aead_aegis256_npubbytes();
  _2.length !== d2 && L(c2, "invalid public_nonce length"), u2 = K(_2), c2.push(u2), n2 = O(c2, n2, "key");
  var v2, g2 = 0 | r._crypto_aead_aegis256_keybytes();
  n2.length !== g2 && L(c2, "invalid key length"), v2 = K(n2), c2.push(v2);
  var b2 = new B(y2 - r._crypto_aead_aegis256_abytes() | 0), f2 = b2.address;
  if (c2.push(f2), 0 === r._crypto_aead_aegis256_decrypt(f2, null, p2, o2, y2, 0, i2, l2, 0, u2, v2)) {
    var m2 = S(b2, s2);
    return M(c2), m2;
  }
  N(c2, "ciphertext cannot be decrypted using that key");
}
function F(e, t2, a2, _2, n2, s2, c2) {
  var p2 = [];
  Y(c2);
  var o2 = null;
  null != e && (o2 = K(e = O(p2, e, "secret_nonce")), e.length, p2.push(o2));
  var h2 = K(t2 = O(p2, t2, "ciphertext")), y2 = t2.length;
  p2.push(h2), a2 = O(p2, a2, "mac");
  var i2, l2 = 0 | r._crypto_aead_aegis256_abytes();
  a2.length !== l2 && L(p2, "invalid mac length"), i2 = K(a2), p2.push(i2);
  var u2 = null, d2 = 0;
  null != _2 && (u2 = K(_2 = O(p2, _2, "additional_data")), d2 = _2.length, p2.push(u2)), n2 = O(p2, n2, "public_nonce");
  var v2, g2 = 0 | r._crypto_aead_aegis256_npubbytes();
  n2.length !== g2 && L(p2, "invalid public_nonce length"), v2 = K(n2), p2.push(v2), s2 = O(p2, s2, "key");
  var b2, f2 = 0 | r._crypto_aead_aegis256_keybytes();
  s2.length !== f2 && L(p2, "invalid key length"), b2 = K(s2), p2.push(b2);
  var m2 = new B(0 | y2), k2 = m2.address;
  if (p2.push(k2), 0 === r._crypto_aead_aegis256_decrypt_detached(k2, o2, h2, y2, 0, i2, u2, d2, 0, v2, b2)) {
    var x2 = S(m2, c2);
    return M(p2), x2;
  }
  N(p2, "ciphertext cannot be decrypted using that key");
}
function V(e, t2, a2, _2, n2, s2) {
  var c2 = [];
  Y(s2);
  var p2 = K(e = O(c2, e, "message")), o2 = e.length;
  c2.push(p2);
  var h2 = null, y2 = 0;
  null != t2 && (h2 = K(t2 = O(c2, t2, "additional_data")), y2 = t2.length, c2.push(h2));
  var i2 = null;
  null != a2 && (i2 = K(a2 = O(c2, a2, "secret_nonce")), a2.length, c2.push(i2)), _2 = O(c2, _2, "public_nonce");
  var l2, u2 = 0 | r._crypto_aead_aegis256_npubbytes();
  _2.length !== u2 && L(c2, "invalid public_nonce length"), l2 = K(_2), c2.push(l2), n2 = O(c2, n2, "key");
  var d2, v2 = 0 | r._crypto_aead_aegis256_keybytes();
  n2.length !== v2 && L(c2, "invalid key length"), d2 = K(n2), c2.push(d2);
  var g2 = new B(o2 + r._crypto_aead_aegis256_abytes() | 0), b2 = g2.address;
  if (c2.push(b2), 0 === r._crypto_aead_aegis256_encrypt(b2, null, p2, o2, 0, h2, y2, 0, i2, l2, d2)) {
    var f2 = S(g2, s2);
    return M(c2), f2;
  }
  N(c2, "invalid usage");
}
function q(e, t2, a2, _2, n2, s2) {
  var c2 = [];
  Y(s2);
  var p2 = K(e = O(c2, e, "message")), o2 = e.length;
  c2.push(p2);
  var h2 = null, y2 = 0;
  null != t2 && (h2 = K(t2 = O(c2, t2, "additional_data")), y2 = t2.length, c2.push(h2));
  var i2 = null;
  null != a2 && (i2 = K(a2 = O(c2, a2, "secret_nonce")), a2.length, c2.push(i2)), _2 = O(c2, _2, "public_nonce");
  var l2, u2 = 0 | r._crypto_aead_aegis256_npubbytes();
  _2.length !== u2 && L(c2, "invalid public_nonce length"), l2 = K(_2), c2.push(l2), n2 = O(c2, n2, "key");
  var d2, v2 = 0 | r._crypto_aead_aegis256_keybytes();
  n2.length !== v2 && L(c2, "invalid key length"), d2 = K(n2), c2.push(d2);
  var g2 = new B(0 | o2), b2 = g2.address;
  c2.push(b2);
  var f2 = new B(0 | r._crypto_aead_aegis256_abytes()), m2 = f2.address;
  if (c2.push(m2), 0 === r._crypto_aead_aegis256_encrypt_detached(b2, m2, null, p2, o2, 0, h2, y2, 0, i2, l2, d2)) {
    var k2 = S({ ciphertext: g2, mac: f2 }, s2);
    return M(c2), k2;
  }
  N(c2, "invalid usage");
}
function H(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_aead_aegis256_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_aead_aegis256_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function z(e, t2, a2, _2, n2, s2) {
  var c2 = [];
  Y(s2);
  var p2 = null;
  null != e && (p2 = K(e = O(c2, e, "secret_nonce")), e.length, c2.push(p2)), t2 = O(c2, t2, "ciphertext");
  var o2, h2 = r._crypto_aead_chacha20poly1305_abytes(), y2 = t2.length;
  y2 < h2 && L(c2, "ciphertext is too short"), o2 = K(t2), c2.push(o2);
  var i2 = null, l2 = 0;
  null != a2 && (i2 = K(a2 = O(c2, a2, "additional_data")), l2 = a2.length, c2.push(i2)), _2 = O(c2, _2, "public_nonce");
  var u2, d2 = 0 | r._crypto_aead_chacha20poly1305_npubbytes();
  _2.length !== d2 && L(c2, "invalid public_nonce length"), u2 = K(_2), c2.push(u2), n2 = O(c2, n2, "key");
  var v2, g2 = 0 | r._crypto_aead_chacha20poly1305_keybytes();
  n2.length !== g2 && L(c2, "invalid key length"), v2 = K(n2), c2.push(v2);
  var b2 = new B(y2 - r._crypto_aead_chacha20poly1305_abytes() | 0), f2 = b2.address;
  if (c2.push(f2), 0 === r._crypto_aead_chacha20poly1305_decrypt(f2, null, p2, o2, y2, 0, i2, l2, 0, u2, v2)) {
    var m2 = S(b2, s2);
    return M(c2), m2;
  }
  N(c2, "ciphertext cannot be decrypted using that key");
}
function W(e, t2, a2, _2, n2, s2, c2) {
  var p2 = [];
  Y(c2);
  var o2 = null;
  null != e && (o2 = K(e = O(p2, e, "secret_nonce")), e.length, p2.push(o2));
  var h2 = K(t2 = O(p2, t2, "ciphertext")), y2 = t2.length;
  p2.push(h2), a2 = O(p2, a2, "mac");
  var i2, l2 = 0 | r._crypto_box_macbytes();
  a2.length !== l2 && L(p2, "invalid mac length"), i2 = K(a2), p2.push(i2);
  var u2 = null, d2 = 0;
  null != _2 && (u2 = K(_2 = O(p2, _2, "additional_data")), d2 = _2.length, p2.push(u2)), n2 = O(p2, n2, "public_nonce");
  var v2, g2 = 0 | r._crypto_aead_chacha20poly1305_npubbytes();
  n2.length !== g2 && L(p2, "invalid public_nonce length"), v2 = K(n2), p2.push(v2), s2 = O(p2, s2, "key");
  var b2, f2 = 0 | r._crypto_aead_chacha20poly1305_keybytes();
  s2.length !== f2 && L(p2, "invalid key length"), b2 = K(s2), p2.push(b2);
  var m2 = new B(0 | y2), k2 = m2.address;
  if (p2.push(k2), 0 === r._crypto_aead_chacha20poly1305_decrypt_detached(k2, o2, h2, y2, 0, i2, u2, d2, 0, v2, b2)) {
    var x2 = S(m2, c2);
    return M(p2), x2;
  }
  N(p2, "ciphertext cannot be decrypted using that key");
}
function j(e, t2, a2, _2, n2, s2) {
  var c2 = [];
  Y(s2);
  var p2 = K(e = O(c2, e, "message")), o2 = e.length;
  c2.push(p2);
  var h2 = null, y2 = 0;
  null != t2 && (h2 = K(t2 = O(c2, t2, "additional_data")), y2 = t2.length, c2.push(h2));
  var i2 = null;
  null != a2 && (i2 = K(a2 = O(c2, a2, "secret_nonce")), a2.length, c2.push(i2)), _2 = O(c2, _2, "public_nonce");
  var l2, u2 = 0 | r._crypto_aead_chacha20poly1305_npubbytes();
  _2.length !== u2 && L(c2, "invalid public_nonce length"), l2 = K(_2), c2.push(l2), n2 = O(c2, n2, "key");
  var d2, v2 = 0 | r._crypto_aead_chacha20poly1305_keybytes();
  n2.length !== v2 && L(c2, "invalid key length"), d2 = K(n2), c2.push(d2);
  var g2 = new B(o2 + r._crypto_aead_chacha20poly1305_abytes() | 0), b2 = g2.address;
  if (c2.push(b2), 0 === r._crypto_aead_chacha20poly1305_encrypt(b2, null, p2, o2, 0, h2, y2, 0, i2, l2, d2)) {
    var f2 = S(g2, s2);
    return M(c2), f2;
  }
  N(c2, "invalid usage");
}
function J(e, t2, a2, _2, n2, s2) {
  var c2 = [];
  Y(s2);
  var p2 = K(e = O(c2, e, "message")), o2 = e.length;
  c2.push(p2);
  var h2 = null, y2 = 0;
  null != t2 && (h2 = K(t2 = O(c2, t2, "additional_data")), y2 = t2.length, c2.push(h2));
  var i2 = null;
  null != a2 && (i2 = K(a2 = O(c2, a2, "secret_nonce")), a2.length, c2.push(i2)), _2 = O(c2, _2, "public_nonce");
  var l2, u2 = 0 | r._crypto_aead_chacha20poly1305_npubbytes();
  _2.length !== u2 && L(c2, "invalid public_nonce length"), l2 = K(_2), c2.push(l2), n2 = O(c2, n2, "key");
  var d2, v2 = 0 | r._crypto_aead_chacha20poly1305_keybytes();
  n2.length !== v2 && L(c2, "invalid key length"), d2 = K(n2), c2.push(d2);
  var g2 = new B(0 | o2), b2 = g2.address;
  c2.push(b2);
  var f2 = new B(0 | r._crypto_aead_chacha20poly1305_abytes()), m2 = f2.address;
  if (c2.push(m2), 0 === r._crypto_aead_chacha20poly1305_encrypt_detached(b2, m2, null, p2, o2, 0, h2, y2, 0, i2, l2, d2)) {
    var k2 = S({ ciphertext: g2, mac: f2 }, s2);
    return M(c2), k2;
  }
  N(c2, "invalid usage");
}
function Q(e, t2, a2, _2, n2, s2) {
  var c2 = [];
  Y(s2);
  var p2 = null;
  null != e && (p2 = K(e = O(c2, e, "secret_nonce")), e.length, c2.push(p2)), t2 = O(c2, t2, "ciphertext");
  var o2, h2 = r._crypto_aead_chacha20poly1305_ietf_abytes(), y2 = t2.length;
  y2 < h2 && L(c2, "ciphertext is too short"), o2 = K(t2), c2.push(o2);
  var i2 = null, l2 = 0;
  null != a2 && (i2 = K(a2 = O(c2, a2, "additional_data")), l2 = a2.length, c2.push(i2)), _2 = O(c2, _2, "public_nonce");
  var u2, d2 = 0 | r._crypto_aead_chacha20poly1305_ietf_npubbytes();
  _2.length !== d2 && L(c2, "invalid public_nonce length"), u2 = K(_2), c2.push(u2), n2 = O(c2, n2, "key");
  var v2, g2 = 0 | r._crypto_aead_chacha20poly1305_ietf_keybytes();
  n2.length !== g2 && L(c2, "invalid key length"), v2 = K(n2), c2.push(v2);
  var b2 = new B(y2 - r._crypto_aead_chacha20poly1305_ietf_abytes() | 0), f2 = b2.address;
  if (c2.push(f2), 0 === r._crypto_aead_chacha20poly1305_ietf_decrypt(f2, null, p2, o2, y2, 0, i2, l2, 0, u2, v2)) {
    var m2 = S(b2, s2);
    return M(c2), m2;
  }
  N(c2, "ciphertext cannot be decrypted using that key");
}
function Z(e, t2, a2, _2, n2, s2, c2) {
  var p2 = [];
  Y(c2);
  var o2 = null;
  null != e && (o2 = K(e = O(p2, e, "secret_nonce")), e.length, p2.push(o2));
  var h2 = K(t2 = O(p2, t2, "ciphertext")), y2 = t2.length;
  p2.push(h2), a2 = O(p2, a2, "mac");
  var i2, l2 = 0 | r._crypto_box_macbytes();
  a2.length !== l2 && L(p2, "invalid mac length"), i2 = K(a2), p2.push(i2);
  var u2 = null, d2 = 0;
  null != _2 && (u2 = K(_2 = O(p2, _2, "additional_data")), d2 = _2.length, p2.push(u2)), n2 = O(p2, n2, "public_nonce");
  var v2, g2 = 0 | r._crypto_aead_chacha20poly1305_ietf_npubbytes();
  n2.length !== g2 && L(p2, "invalid public_nonce length"), v2 = K(n2), p2.push(v2), s2 = O(p2, s2, "key");
  var b2, f2 = 0 | r._crypto_aead_chacha20poly1305_ietf_keybytes();
  s2.length !== f2 && L(p2, "invalid key length"), b2 = K(s2), p2.push(b2);
  var m2 = new B(0 | y2), k2 = m2.address;
  if (p2.push(k2), 0 === r._crypto_aead_chacha20poly1305_ietf_decrypt_detached(k2, o2, h2, y2, 0, i2, u2, d2, 0, v2, b2)) {
    var x2 = S(m2, c2);
    return M(p2), x2;
  }
  N(p2, "ciphertext cannot be decrypted using that key");
}
function $(e, t2, a2, _2, n2, s2) {
  var c2 = [];
  Y(s2);
  var p2 = K(e = O(c2, e, "message")), o2 = e.length;
  c2.push(p2);
  var h2 = null, y2 = 0;
  null != t2 && (h2 = K(t2 = O(c2, t2, "additional_data")), y2 = t2.length, c2.push(h2));
  var i2 = null;
  null != a2 && (i2 = K(a2 = O(c2, a2, "secret_nonce")), a2.length, c2.push(i2)), _2 = O(c2, _2, "public_nonce");
  var l2, u2 = 0 | r._crypto_aead_chacha20poly1305_ietf_npubbytes();
  _2.length !== u2 && L(c2, "invalid public_nonce length"), l2 = K(_2), c2.push(l2), n2 = O(c2, n2, "key");
  var d2, v2 = 0 | r._crypto_aead_chacha20poly1305_ietf_keybytes();
  n2.length !== v2 && L(c2, "invalid key length"), d2 = K(n2), c2.push(d2);
  var g2 = new B(o2 + r._crypto_aead_chacha20poly1305_ietf_abytes() | 0), b2 = g2.address;
  if (c2.push(b2), 0 === r._crypto_aead_chacha20poly1305_ietf_encrypt(b2, null, p2, o2, 0, h2, y2, 0, i2, l2, d2)) {
    var f2 = S(g2, s2);
    return M(c2), f2;
  }
  N(c2, "invalid usage");
}
function ee(e, t2, a2, _2, n2, s2) {
  var c2 = [];
  Y(s2);
  var p2 = K(e = O(c2, e, "message")), o2 = e.length;
  c2.push(p2);
  var h2 = null, y2 = 0;
  null != t2 && (h2 = K(t2 = O(c2, t2, "additional_data")), y2 = t2.length, c2.push(h2));
  var i2 = null;
  null != a2 && (i2 = K(a2 = O(c2, a2, "secret_nonce")), a2.length, c2.push(i2)), _2 = O(c2, _2, "public_nonce");
  var l2, u2 = 0 | r._crypto_aead_chacha20poly1305_ietf_npubbytes();
  _2.length !== u2 && L(c2, "invalid public_nonce length"), l2 = K(_2), c2.push(l2), n2 = O(c2, n2, "key");
  var d2, v2 = 0 | r._crypto_aead_chacha20poly1305_ietf_keybytes();
  n2.length !== v2 && L(c2, "invalid key length"), d2 = K(n2), c2.push(d2);
  var g2 = new B(0 | o2), b2 = g2.address;
  c2.push(b2);
  var f2 = new B(0 | r._crypto_aead_chacha20poly1305_ietf_abytes()), m2 = f2.address;
  if (c2.push(m2), 0 === r._crypto_aead_chacha20poly1305_ietf_encrypt_detached(b2, m2, null, p2, o2, 0, h2, y2, 0, i2, l2, d2)) {
    var k2 = S({ ciphertext: g2, mac: f2 }, s2);
    return M(c2), k2;
  }
  N(c2, "invalid usage");
}
function re(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_aead_chacha20poly1305_ietf_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_aead_chacha20poly1305_ietf_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function te(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_aead_chacha20poly1305_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_aead_chacha20poly1305_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function ae(e, t2, a2, _2, n2, s2) {
  var c2 = [];
  Y(s2);
  var p2 = null;
  null != e && (p2 = K(e = O(c2, e, "secret_nonce")), e.length, c2.push(p2)), t2 = O(c2, t2, "ciphertext");
  var o2, h2 = r._crypto_aead_xchacha20poly1305_ietf_abytes(), y2 = t2.length;
  y2 < h2 && L(c2, "ciphertext is too short"), o2 = K(t2), c2.push(o2);
  var i2 = null, l2 = 0;
  null != a2 && (i2 = K(a2 = O(c2, a2, "additional_data")), l2 = a2.length, c2.push(i2)), _2 = O(c2, _2, "public_nonce");
  var u2, d2 = 0 | r._crypto_aead_xchacha20poly1305_ietf_npubbytes();
  _2.length !== d2 && L(c2, "invalid public_nonce length"), u2 = K(_2), c2.push(u2), n2 = O(c2, n2, "key");
  var v2, g2 = 0 | r._crypto_aead_xchacha20poly1305_ietf_keybytes();
  n2.length !== g2 && L(c2, "invalid key length"), v2 = K(n2), c2.push(v2);
  var b2 = new B(y2 - r._crypto_aead_xchacha20poly1305_ietf_abytes() | 0), f2 = b2.address;
  if (c2.push(f2), 0 === r._crypto_aead_xchacha20poly1305_ietf_decrypt(f2, null, p2, o2, y2, 0, i2, l2, 0, u2, v2)) {
    var m2 = S(b2, s2);
    return M(c2), m2;
  }
  N(c2, "ciphertext cannot be decrypted using that key");
}
function _e(e, t2, a2, _2, n2, s2, c2) {
  var p2 = [];
  Y(c2);
  var o2 = null;
  null != e && (o2 = K(e = O(p2, e, "secret_nonce")), e.length, p2.push(o2));
  var h2 = K(t2 = O(p2, t2, "ciphertext")), y2 = t2.length;
  p2.push(h2), a2 = O(p2, a2, "mac");
  var i2, l2 = 0 | r._crypto_box_macbytes();
  a2.length !== l2 && L(p2, "invalid mac length"), i2 = K(a2), p2.push(i2);
  var u2 = null, d2 = 0;
  null != _2 && (u2 = K(_2 = O(p2, _2, "additional_data")), d2 = _2.length, p2.push(u2)), n2 = O(p2, n2, "public_nonce");
  var v2, g2 = 0 | r._crypto_aead_xchacha20poly1305_ietf_npubbytes();
  n2.length !== g2 && L(p2, "invalid public_nonce length"), v2 = K(n2), p2.push(v2), s2 = O(p2, s2, "key");
  var b2, f2 = 0 | r._crypto_aead_xchacha20poly1305_ietf_keybytes();
  s2.length !== f2 && L(p2, "invalid key length"), b2 = K(s2), p2.push(b2);
  var m2 = new B(0 | y2), k2 = m2.address;
  if (p2.push(k2), 0 === r._crypto_aead_xchacha20poly1305_ietf_decrypt_detached(k2, o2, h2, y2, 0, i2, u2, d2, 0, v2, b2)) {
    var x2 = S(m2, c2);
    return M(p2), x2;
  }
  N(p2, "ciphertext cannot be decrypted using that key");
}
function ne(e, t2, a2, _2, n2, s2) {
  var c2 = [];
  Y(s2);
  var p2 = K(e = O(c2, e, "message")), o2 = e.length;
  c2.push(p2);
  var h2 = null, y2 = 0;
  null != t2 && (h2 = K(t2 = O(c2, t2, "additional_data")), y2 = t2.length, c2.push(h2));
  var i2 = null;
  null != a2 && (i2 = K(a2 = O(c2, a2, "secret_nonce")), a2.length, c2.push(i2)), _2 = O(c2, _2, "public_nonce");
  var l2, u2 = 0 | r._crypto_aead_xchacha20poly1305_ietf_npubbytes();
  _2.length !== u2 && L(c2, "invalid public_nonce length"), l2 = K(_2), c2.push(l2), n2 = O(c2, n2, "key");
  var d2, v2 = 0 | r._crypto_aead_xchacha20poly1305_ietf_keybytes();
  n2.length !== v2 && L(c2, "invalid key length"), d2 = K(n2), c2.push(d2);
  var g2 = new B(o2 + r._crypto_aead_xchacha20poly1305_ietf_abytes() | 0), b2 = g2.address;
  if (c2.push(b2), 0 === r._crypto_aead_xchacha20poly1305_ietf_encrypt(b2, null, p2, o2, 0, h2, y2, 0, i2, l2, d2)) {
    var f2 = S(g2, s2);
    return M(c2), f2;
  }
  N(c2, "invalid usage");
}
function se(e, t2, a2, _2, n2, s2) {
  var c2 = [];
  Y(s2);
  var p2 = K(e = O(c2, e, "message")), o2 = e.length;
  c2.push(p2);
  var h2 = null, y2 = 0;
  null != t2 && (h2 = K(t2 = O(c2, t2, "additional_data")), y2 = t2.length, c2.push(h2));
  var i2 = null;
  null != a2 && (i2 = K(a2 = O(c2, a2, "secret_nonce")), a2.length, c2.push(i2)), _2 = O(c2, _2, "public_nonce");
  var l2, u2 = 0 | r._crypto_aead_xchacha20poly1305_ietf_npubbytes();
  _2.length !== u2 && L(c2, "invalid public_nonce length"), l2 = K(_2), c2.push(l2), n2 = O(c2, n2, "key");
  var d2, v2 = 0 | r._crypto_aead_xchacha20poly1305_ietf_keybytes();
  n2.length !== v2 && L(c2, "invalid key length"), d2 = K(n2), c2.push(d2);
  var g2 = new B(0 | o2), b2 = g2.address;
  c2.push(b2);
  var f2 = new B(0 | r._crypto_aead_xchacha20poly1305_ietf_abytes()), m2 = f2.address;
  if (c2.push(m2), 0 === r._crypto_aead_xchacha20poly1305_ietf_encrypt_detached(b2, m2, null, p2, o2, 0, h2, y2, 0, i2, l2, d2)) {
    var k2 = S({ ciphertext: g2, mac: f2 }, s2);
    return M(c2), k2;
  }
  N(c2, "invalid usage");
}
function ce(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_aead_xchacha20poly1305_ietf_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_aead_xchacha20poly1305_ietf_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function pe(e, t2, a2) {
  var _2 = [];
  Y(a2);
  var n2 = K(e = O(_2, e, "message")), s2 = e.length;
  _2.push(n2), t2 = O(_2, t2, "key");
  var c2, p2 = 0 | r._crypto_auth_keybytes();
  t2.length !== p2 && L(_2, "invalid key length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_auth_bytes()), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_auth(h2, n2, s2, 0, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "invalid usage");
}
function oe(e, t2, a2) {
  var _2 = [];
  Y(a2);
  var n2 = K(e = O(_2, e, "message")), s2 = e.length;
  _2.push(n2), t2 = O(_2, t2, "key");
  var c2, p2 = 0 | r._crypto_auth_hmacsha256_keybytes();
  t2.length !== p2 && L(_2, "invalid key length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_auth_hmacsha256_bytes()), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_auth_hmacsha256(h2, n2, s2, 0, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "invalid usage");
}
function he(e, t2) {
  var a2 = [];
  Y(t2), U(a2, e, "state_address");
  var _2 = new B(0 | r._crypto_auth_hmacsha256_bytes()), n2 = _2.address;
  if (a2.push(n2), !(0 | r._crypto_auth_hmacsha256_final(e, n2))) {
    var s2 = (r._free(e), S(_2, t2));
    return M(a2), s2;
  }
  N(a2, "invalid usage");
}
function ye(e, t2) {
  var a2 = [];
  Y(t2);
  var _2 = null, n2 = 0;
  null != e && (_2 = K(e = O(a2, e, "key")), n2 = e.length, a2.push(_2));
  var s2 = new B(208).address;
  if (!(0 | r._crypto_auth_hmacsha256_init(s2, _2, n2))) {
    var c2 = s2;
    return M(a2), c2;
  }
  N(a2, "invalid usage");
}
function ie(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_auth_hmacsha256_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_auth_hmacsha256_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function le(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "state_address");
  var n2 = K(t2 = O(_2, t2, "message_chunk")), s2 = t2.length;
  _2.push(n2), 0 | r._crypto_auth_hmacsha256_update(e, n2, s2) && N(_2, "invalid usage"), M(_2);
}
function ue(e, t2, a2) {
  var _2 = [];
  e = O(_2, e, "tag");
  var n2, s2 = 0 | r._crypto_auth_hmacsha256_bytes();
  e.length !== s2 && L(_2, "invalid tag length"), n2 = K(e), _2.push(n2);
  var c2 = K(t2 = O(_2, t2, "message")), p2 = t2.length;
  _2.push(c2), a2 = O(_2, a2, "key");
  var o2, h2 = 0 | r._crypto_auth_hmacsha256_keybytes();
  a2.length !== h2 && L(_2, "invalid key length"), o2 = K(a2), _2.push(o2);
  var y2 = !(0 | r._crypto_auth_hmacsha256_verify(n2, c2, p2, 0, o2));
  return M(_2), y2;
}
function de(e, t2, a2) {
  var _2 = [];
  Y(a2);
  var n2 = K(e = O(_2, e, "message")), s2 = e.length;
  _2.push(n2), t2 = O(_2, t2, "key");
  var c2, p2 = 0 | r._crypto_auth_hmacsha512_keybytes();
  t2.length !== p2 && L(_2, "invalid key length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_auth_hmacsha512_bytes()), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_auth_hmacsha512(h2, n2, s2, 0, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "invalid usage");
}
function ve(e, t2, a2) {
  var _2 = [];
  Y(a2);
  var n2 = K(e = O(_2, e, "message")), s2 = e.length;
  _2.push(n2), t2 = O(_2, t2, "key");
  var c2, p2 = 0 | r._crypto_auth_hmacsha512256_keybytes();
  t2.length !== p2 && L(_2, "invalid key length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_auth_hmacsha512256_bytes()), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_auth_hmacsha512256(h2, n2, s2, 0, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "invalid usage");
}
function ge(e, t2) {
  var a2 = [];
  Y(t2), U(a2, e, "state_address");
  var _2 = new B(0 | r._crypto_auth_hmacsha512256_bytes()), n2 = _2.address;
  if (a2.push(n2), !(0 | r._crypto_auth_hmacsha512256_final(e, n2))) {
    var s2 = (r._free(e), S(_2, t2));
    return M(a2), s2;
  }
  N(a2, "invalid usage");
}
function be(e, t2) {
  var a2 = [];
  Y(t2);
  var _2 = null, n2 = 0;
  null != e && (_2 = K(e = O(a2, e, "key")), n2 = e.length, a2.push(_2));
  var s2 = new B(416).address;
  if (!(0 | r._crypto_auth_hmacsha512256_init(s2, _2, n2))) {
    var c2 = s2;
    return M(a2), c2;
  }
  N(a2, "invalid usage");
}
function fe(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_auth_hmacsha512256_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_auth_hmacsha512256_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function me(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "state_address");
  var n2 = K(t2 = O(_2, t2, "message_chunk")), s2 = t2.length;
  _2.push(n2), 0 | r._crypto_auth_hmacsha512256_update(e, n2, s2) && N(_2, "invalid usage"), M(_2);
}
function ke(e, t2, a2) {
  var _2 = [];
  e = O(_2, e, "tag");
  var n2, s2 = 0 | r._crypto_auth_hmacsha512256_bytes();
  e.length !== s2 && L(_2, "invalid tag length"), n2 = K(e), _2.push(n2);
  var c2 = K(t2 = O(_2, t2, "message")), p2 = t2.length;
  _2.push(c2), a2 = O(_2, a2, "key");
  var o2, h2 = 0 | r._crypto_auth_hmacsha512256_keybytes();
  a2.length !== h2 && L(_2, "invalid key length"), o2 = K(a2), _2.push(o2);
  var y2 = !(0 | r._crypto_auth_hmacsha512256_verify(n2, c2, p2, 0, o2));
  return M(_2), y2;
}
function xe(e, t2) {
  var a2 = [];
  Y(t2), U(a2, e, "state_address");
  var _2 = new B(0 | r._crypto_auth_hmacsha512_bytes()), n2 = _2.address;
  if (a2.push(n2), !(0 | r._crypto_auth_hmacsha512_final(e, n2))) {
    var s2 = (r._free(e), S(_2, t2));
    return M(a2), s2;
  }
  N(a2, "invalid usage");
}
function Ee(e, t2) {
  var a2 = [];
  Y(t2);
  var _2 = null, n2 = 0;
  null != e && (_2 = K(e = O(a2, e, "key")), n2 = e.length, a2.push(_2));
  var s2 = new B(416).address;
  if (!(0 | r._crypto_auth_hmacsha512_init(s2, _2, n2))) {
    var c2 = s2;
    return M(a2), c2;
  }
  N(a2, "invalid usage");
}
function Te(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_auth_hmacsha512_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_auth_hmacsha512_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function Se(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "state_address");
  var n2 = K(t2 = O(_2, t2, "message_chunk")), s2 = t2.length;
  _2.push(n2), 0 | r._crypto_auth_hmacsha512_update(e, n2, s2) && N(_2, "invalid usage"), M(_2);
}
function we(e, t2, a2) {
  var _2 = [];
  e = O(_2, e, "tag");
  var n2, s2 = 0 | r._crypto_auth_hmacsha512_bytes();
  e.length !== s2 && L(_2, "invalid tag length"), n2 = K(e), _2.push(n2);
  var c2 = K(t2 = O(_2, t2, "message")), p2 = t2.length;
  _2.push(c2), a2 = O(_2, a2, "key");
  var o2, h2 = 0 | r._crypto_auth_hmacsha512_keybytes();
  a2.length !== h2 && L(_2, "invalid key length"), o2 = K(a2), _2.push(o2);
  var y2 = !(0 | r._crypto_auth_hmacsha512_verify(n2, c2, p2, 0, o2));
  return M(_2), y2;
}
function Ye(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_auth_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_auth_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function Be(e, t2, a2) {
  var _2 = [];
  e = O(_2, e, "tag");
  var n2, s2 = 0 | r._crypto_auth_bytes();
  e.length !== s2 && L(_2, "invalid tag length"), n2 = K(e), _2.push(n2);
  var c2 = K(t2 = O(_2, t2, "message")), p2 = t2.length;
  _2.push(c2), a2 = O(_2, a2, "key");
  var o2, h2 = 0 | r._crypto_auth_keybytes();
  a2.length !== h2 && L(_2, "invalid key length"), o2 = K(a2), _2.push(o2);
  var y2 = !(0 | r._crypto_auth_verify(n2, c2, p2, 0, o2));
  return M(_2), y2;
}
function Ke(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "publicKey");
  var n2, s2 = 0 | r._crypto_box_publickeybytes();
  e.length !== s2 && L(_2, "invalid publicKey length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "privateKey");
  var c2, p2 = 0 | r._crypto_box_secretkeybytes();
  t2.length !== p2 && L(_2, "invalid privateKey length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_box_beforenmbytes()), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_box_beforenm(h2, n2, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "invalid usage");
}
function Ae(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "publicKey");
  var n2, s2 = 0 | r._crypto_box_curve25519xchacha20poly1305_publickeybytes();
  e.length !== s2 && L(_2, "invalid publicKey length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "privateKey");
  var c2, p2 = 0 | r._crypto_box_curve25519xchacha20poly1305_secretkeybytes();
  t2.length !== p2 && L(_2, "invalid privateKey length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_box_curve25519xchacha20poly1305_beforenmbytes()), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_box_curve25519xchacha20poly1305_beforenm(h2, n2, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "invalid usage");
}
function Ie(e, t2, a2, _2, n2) {
  var s2 = [];
  Y(n2);
  var c2 = K(e = O(s2, e, "message")), p2 = e.length;
  s2.push(c2), t2 = O(s2, t2, "nonce");
  var o2, h2 = 0 | r._crypto_box_curve25519xchacha20poly1305_noncebytes();
  t2.length !== h2 && L(s2, "invalid nonce length"), o2 = K(t2), s2.push(o2), a2 = O(s2, a2, "publicKey");
  var y2, i2 = 0 | r._crypto_box_curve25519xchacha20poly1305_publickeybytes();
  a2.length !== i2 && L(s2, "invalid publicKey length"), y2 = K(a2), s2.push(y2), _2 = O(s2, _2, "privateKey");
  var l2, u2 = 0 | r._crypto_box_curve25519xchacha20poly1305_secretkeybytes();
  _2.length !== u2 && L(s2, "invalid privateKey length"), l2 = K(_2), s2.push(l2);
  var d2 = new B(0 | p2), v2 = d2.address;
  s2.push(v2);
  var g2 = new B(0 | r._crypto_box_curve25519xchacha20poly1305_macbytes()), b2 = g2.address;
  if (s2.push(b2), !(0 | r._crypto_box_curve25519xchacha20poly1305_detached(v2, b2, c2, p2, 0, o2, y2, l2))) {
    var f2 = S({ ciphertext: d2, mac: g2 }, n2);
    return M(s2), f2;
  }
  N(s2, "invalid usage");
}
function Me(e, t2, a2, _2) {
  var n2 = [];
  Y(_2);
  var s2 = K(e = O(n2, e, "message")), c2 = e.length;
  n2.push(s2), t2 = O(n2, t2, "nonce");
  var p2, o2 = 0 | r._crypto_box_curve25519xchacha20poly1305_noncebytes();
  t2.length !== o2 && L(n2, "invalid nonce length"), p2 = K(t2), n2.push(p2), a2 = O(n2, a2, "sharedKey");
  var h2, y2 = 0 | r._crypto_box_curve25519xchacha20poly1305_beforenmbytes();
  a2.length !== y2 && L(n2, "invalid sharedKey length"), h2 = K(a2), n2.push(h2);
  var i2 = new B(0 | c2), l2 = i2.address;
  n2.push(l2);
  var u2 = new B(0 | r._crypto_box_curve25519xchacha20poly1305_macbytes()), d2 = u2.address;
  if (n2.push(d2), !(0 | r._crypto_box_curve25519xchacha20poly1305_detached_afternm(l2, d2, s2, c2, 0, p2, h2))) {
    var v2 = S({ ciphertext: i2, mac: u2 }, _2);
    return M(n2), v2;
  }
  N(n2, "invalid usage");
}
function Ne(e, t2, a2, _2, n2) {
  var s2 = [];
  Y(n2);
  var c2 = K(e = O(s2, e, "message")), p2 = e.length;
  s2.push(c2), t2 = O(s2, t2, "nonce");
  var o2, h2 = 0 | r._crypto_box_curve25519xchacha20poly1305_noncebytes();
  t2.length !== h2 && L(s2, "invalid nonce length"), o2 = K(t2), s2.push(o2), a2 = O(s2, a2, "publicKey");
  var y2, i2 = 0 | r._crypto_box_curve25519xchacha20poly1305_publickeybytes();
  a2.length !== i2 && L(s2, "invalid publicKey length"), y2 = K(a2), s2.push(y2), _2 = O(s2, _2, "privateKey");
  var l2, u2 = 0 | r._crypto_box_curve25519xchacha20poly1305_secretkeybytes();
  _2.length !== u2 && L(s2, "invalid privateKey length"), l2 = K(_2), s2.push(l2);
  var d2 = new B(p2 + r._crypto_box_curve25519xchacha20poly1305_macbytes() | 0), v2 = d2.address;
  if (s2.push(v2), !(0 | r._crypto_box_curve25519xchacha20poly1305_easy(v2, c2, p2, 0, o2, y2, l2))) {
    var g2 = S(d2, n2);
    return M(s2), g2;
  }
  N(s2, "invalid usage");
}
function Le(e, t2, a2, _2) {
  var n2 = [];
  Y(_2);
  var s2 = K(e = O(n2, e, "message")), c2 = e.length;
  n2.push(s2), t2 = O(n2, t2, "nonce");
  var p2, o2 = 0 | r._crypto_box_curve25519xchacha20poly1305_noncebytes();
  t2.length !== o2 && L(n2, "invalid nonce length"), p2 = K(t2), n2.push(p2), a2 = O(n2, a2, "sharedKey");
  var h2, y2 = 0 | r._crypto_box_curve25519xchacha20poly1305_beforenmbytes();
  a2.length !== y2 && L(n2, "invalid sharedKey length"), h2 = K(a2), n2.push(h2);
  var i2 = new B(c2 + r._crypto_box_curve25519xchacha20poly1305_macbytes() | 0), l2 = i2.address;
  if (n2.push(l2), !(0 | r._crypto_box_curve25519xchacha20poly1305_easy_afternm(l2, s2, c2, 0, p2, h2))) {
    var u2 = S(i2, _2);
    return M(n2), u2;
  }
  N(n2, "invalid usage");
}
function Ue(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_box_curve25519xchacha20poly1305_publickeybytes()), _2 = a2.address;
  t2.push(_2);
  var n2 = new B(0 | r._crypto_box_curve25519xchacha20poly1305_secretkeybytes()), s2 = n2.address;
  t2.push(s2), r._crypto_box_curve25519xchacha20poly1305_keypair(_2, s2);
  var c2 = S({ publicKey: a2, privateKey: n2, keyType: "curve25519" }, e);
  return M(t2), c2;
}
function Oe(e, t2, a2, _2, n2, s2) {
  var c2 = [];
  Y(s2);
  var p2 = K(e = O(c2, e, "ciphertext")), o2 = e.length;
  c2.push(p2), t2 = O(c2, t2, "mac");
  var h2, y2 = 0 | r._crypto_box_curve25519xchacha20poly1305_macbytes();
  t2.length !== y2 && L(c2, "invalid mac length"), h2 = K(t2), c2.push(h2), a2 = O(c2, a2, "nonce");
  var i2, l2 = 0 | r._crypto_box_curve25519xchacha20poly1305_noncebytes();
  a2.length !== l2 && L(c2, "invalid nonce length"), i2 = K(a2), c2.push(i2), _2 = O(c2, _2, "publicKey");
  var u2, d2 = 0 | r._crypto_box_curve25519xchacha20poly1305_publickeybytes();
  _2.length !== d2 && L(c2, "invalid publicKey length"), u2 = K(_2), c2.push(u2), n2 = O(c2, n2, "privateKey");
  var v2, g2 = 0 | r._crypto_box_curve25519xchacha20poly1305_secretkeybytes();
  n2.length !== g2 && L(c2, "invalid privateKey length"), v2 = K(n2), c2.push(v2);
  var b2 = new B(0 | o2), f2 = b2.address;
  if (c2.push(f2), !(0 | r._crypto_box_curve25519xchacha20poly1305_open_detached(f2, p2, h2, o2, 0, i2, u2, v2))) {
    var m2 = S(b2, s2);
    return M(c2), m2;
  }
  N(c2, "incorrect key pair for the given ciphertext");
}
function Ce(e, t2, a2, _2, n2) {
  var s2 = [];
  Y(n2);
  var c2 = K(e = O(s2, e, "ciphertext")), p2 = e.length;
  s2.push(c2), t2 = O(s2, t2, "mac");
  var o2, h2 = 0 | r._crypto_box_curve25519xchacha20poly1305_macbytes();
  t2.length !== h2 && L(s2, "invalid mac length"), o2 = K(t2), s2.push(o2), a2 = O(s2, a2, "nonce");
  var y2, i2 = 0 | r._crypto_box_curve25519xchacha20poly1305_noncebytes();
  a2.length !== i2 && L(s2, "invalid nonce length"), y2 = K(a2), s2.push(y2), _2 = O(s2, _2, "sharedKey");
  var l2, u2 = 0 | r._crypto_box_curve25519xchacha20poly1305_beforenmbytes();
  _2.length !== u2 && L(s2, "invalid sharedKey length"), l2 = K(_2), s2.push(l2);
  var d2 = new B(0 | p2), v2 = d2.address;
  if (s2.push(v2), !(0 | r._crypto_box_curve25519xchacha20poly1305_open_detached_afternm(v2, c2, o2, p2, 0, y2, l2))) {
    var g2 = S(d2, n2);
    return M(s2), g2;
  }
  N(s2, "incorrect secret key for the given ciphertext");
}
function Re(e, t2, a2, _2, n2) {
  var s2 = [];
  Y(n2), e = O(s2, e, "ciphertext");
  var c2, p2 = r._crypto_box_curve25519xchacha20poly1305_macbytes(), o2 = e.length;
  o2 < p2 && L(s2, "ciphertext is too short"), c2 = K(e), s2.push(c2), t2 = O(s2, t2, "nonce");
  var h2, y2 = 0 | r._crypto_box_curve25519xchacha20poly1305_noncebytes();
  t2.length !== y2 && L(s2, "invalid nonce length"), h2 = K(t2), s2.push(h2), a2 = O(s2, a2, "publicKey");
  var i2, l2 = 0 | r._crypto_box_curve25519xchacha20poly1305_publickeybytes();
  a2.length !== l2 && L(s2, "invalid publicKey length"), i2 = K(a2), s2.push(i2), _2 = O(s2, _2, "privateKey");
  var u2, d2 = 0 | r._crypto_box_curve25519xchacha20poly1305_secretkeybytes();
  _2.length !== d2 && L(s2, "invalid privateKey length"), u2 = K(_2), s2.push(u2);
  var v2 = new B(o2 - r._crypto_box_curve25519xchacha20poly1305_macbytes() | 0), g2 = v2.address;
  if (s2.push(g2), !(0 | r._crypto_box_curve25519xchacha20poly1305_open_easy(g2, c2, o2, 0, h2, i2, u2))) {
    var b2 = S(v2, n2);
    return M(s2), b2;
  }
  N(s2, "incorrect key pair for the given ciphertext");
}
function Pe(e, t2, a2, _2) {
  var n2 = [];
  Y(_2);
  var s2 = K(e = O(n2, e, "ciphertext")), c2 = e.length;
  n2.push(s2), t2 = O(n2, t2, "nonce");
  var p2, o2 = 0 | r._crypto_box_curve25519xchacha20poly1305_noncebytes();
  t2.length !== o2 && L(n2, "invalid nonce length"), p2 = K(t2), n2.push(p2), a2 = O(n2, a2, "sharedKey");
  var h2, y2 = 0 | r._crypto_box_curve25519xchacha20poly1305_beforenmbytes();
  a2.length !== y2 && L(n2, "invalid sharedKey length"), h2 = K(a2), n2.push(h2);
  var i2 = new B(c2 - r._crypto_box_curve25519xchacha20poly1305_macbytes() | 0), l2 = i2.address;
  if (n2.push(l2), !(0 | r._crypto_box_curve25519xchacha20poly1305_open_easy_afternm(l2, s2, c2, 0, p2, h2))) {
    var u2 = S(i2, _2);
    return M(n2), u2;
  }
  N(n2, "incorrect secret key for the given ciphertext");
}
function Xe(e, t2, a2) {
  var _2 = [];
  Y(a2);
  var n2 = K(e = O(_2, e, "message")), s2 = e.length;
  _2.push(n2), t2 = O(_2, t2, "publicKey");
  var c2, p2 = 0 | r._crypto_box_curve25519xchacha20poly1305_publickeybytes();
  t2.length !== p2 && L(_2, "invalid publicKey length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(s2 + r._crypto_box_curve25519xchacha20poly1305_sealbytes() | 0), h2 = o2.address;
  _2.push(h2), r._crypto_box_curve25519xchacha20poly1305_seal(h2, n2, s2, 0, c2);
  var y2 = S(o2, a2);
  return M(_2), y2;
}
function De(e, t2, a2, _2) {
  var n2 = [];
  Y(_2), e = O(n2, e, "ciphertext");
  var s2, c2 = r._crypto_box_curve25519xchacha20poly1305_sealbytes(), p2 = e.length;
  p2 < c2 && L(n2, "ciphertext is too short"), s2 = K(e), n2.push(s2), t2 = O(n2, t2, "publicKey");
  var o2, h2 = 0 | r._crypto_box_curve25519xchacha20poly1305_publickeybytes();
  t2.length !== h2 && L(n2, "invalid publicKey length"), o2 = K(t2), n2.push(o2), a2 = O(n2, a2, "secretKey");
  var y2, i2 = 0 | r._crypto_box_curve25519xchacha20poly1305_secretkeybytes();
  a2.length !== i2 && L(n2, "invalid secretKey length"), y2 = K(a2), n2.push(y2);
  var l2 = new B(p2 - r._crypto_box_curve25519xchacha20poly1305_sealbytes() | 0), u2 = l2.address;
  n2.push(u2), r._crypto_box_curve25519xchacha20poly1305_seal_open(u2, s2, p2, 0, o2, y2);
  var d2 = S(l2, _2);
  return M(n2), d2;
}
function Ge(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "seed");
  var _2, n2 = 0 | r._crypto_box_curve25519xchacha20poly1305_seedbytes();
  e.length !== n2 && L(a2, "invalid seed length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_box_curve25519xchacha20poly1305_publickeybytes()), c2 = s2.address;
  a2.push(c2);
  var p2 = new B(0 | r._crypto_box_curve25519xchacha20poly1305_secretkeybytes()), o2 = p2.address;
  if (a2.push(o2), !(0 | r._crypto_box_curve25519xchacha20poly1305_seed_keypair(c2, o2, _2))) {
    var h2 = { publicKey: S(s2, t2), privateKey: S(p2, t2), keyType: "x25519" };
    return M(a2), h2;
  }
  N(a2, "invalid usage");
}
function Fe(e, t2, a2, _2, n2) {
  var s2 = [];
  Y(n2);
  var c2 = K(e = O(s2, e, "message")), p2 = e.length;
  s2.push(c2), t2 = O(s2, t2, "nonce");
  var o2, h2 = 0 | r._crypto_box_noncebytes();
  t2.length !== h2 && L(s2, "invalid nonce length"), o2 = K(t2), s2.push(o2), a2 = O(s2, a2, "publicKey");
  var y2, i2 = 0 | r._crypto_box_publickeybytes();
  a2.length !== i2 && L(s2, "invalid publicKey length"), y2 = K(a2), s2.push(y2), _2 = O(s2, _2, "privateKey");
  var l2, u2 = 0 | r._crypto_box_secretkeybytes();
  _2.length !== u2 && L(s2, "invalid privateKey length"), l2 = K(_2), s2.push(l2);
  var d2 = new B(0 | p2), v2 = d2.address;
  s2.push(v2);
  var g2 = new B(0 | r._crypto_box_macbytes()), b2 = g2.address;
  if (s2.push(b2), !(0 | r._crypto_box_detached(v2, b2, c2, p2, 0, o2, y2, l2))) {
    var f2 = S({ ciphertext: d2, mac: g2 }, n2);
    return M(s2), f2;
  }
  N(s2, "invalid usage");
}
function Ve(e, t2, a2, _2, n2) {
  var s2 = [];
  Y(n2);
  var c2 = K(e = O(s2, e, "message")), p2 = e.length;
  s2.push(c2), t2 = O(s2, t2, "nonce");
  var o2, h2 = 0 | r._crypto_box_noncebytes();
  t2.length !== h2 && L(s2, "invalid nonce length"), o2 = K(t2), s2.push(o2), a2 = O(s2, a2, "publicKey");
  var y2, i2 = 0 | r._crypto_box_publickeybytes();
  a2.length !== i2 && L(s2, "invalid publicKey length"), y2 = K(a2), s2.push(y2), _2 = O(s2, _2, "privateKey");
  var l2, u2 = 0 | r._crypto_box_secretkeybytes();
  _2.length !== u2 && L(s2, "invalid privateKey length"), l2 = K(_2), s2.push(l2);
  var d2 = new B(p2 + r._crypto_box_macbytes() | 0), v2 = d2.address;
  if (s2.push(v2), !(0 | r._crypto_box_easy(v2, c2, p2, 0, o2, y2, l2))) {
    var g2 = S(d2, n2);
    return M(s2), g2;
  }
  N(s2, "invalid usage");
}
function qe(e, t2, a2, _2) {
  var n2 = [];
  Y(_2);
  var s2 = K(e = O(n2, e, "message")), c2 = e.length;
  n2.push(s2), t2 = O(n2, t2, "nonce");
  var p2, o2 = 0 | r._crypto_box_noncebytes();
  t2.length !== o2 && L(n2, "invalid nonce length"), p2 = K(t2), n2.push(p2), a2 = O(n2, a2, "sharedKey");
  var h2, y2 = 0 | r._crypto_box_beforenmbytes();
  a2.length !== y2 && L(n2, "invalid sharedKey length"), h2 = K(a2), n2.push(h2);
  var i2 = new B(c2 + r._crypto_box_macbytes() | 0), l2 = i2.address;
  if (n2.push(l2), !(0 | r._crypto_box_easy_afternm(l2, s2, c2, 0, p2, h2))) {
    var u2 = S(i2, _2);
    return M(n2), u2;
  }
  N(n2, "invalid usage");
}
function He(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_box_publickeybytes()), _2 = a2.address;
  t2.push(_2);
  var n2 = new B(0 | r._crypto_box_secretkeybytes()), s2 = n2.address;
  if (t2.push(s2), !(0 | r._crypto_box_keypair(_2, s2))) {
    var c2 = { publicKey: S(a2, e), privateKey: S(n2, e), keyType: "x25519" };
    return M(t2), c2;
  }
  N(t2, "internal error");
}
function ze(e, t2, a2, _2, n2, s2) {
  var c2 = [];
  Y(s2);
  var p2 = K(e = O(c2, e, "ciphertext")), o2 = e.length;
  c2.push(p2), t2 = O(c2, t2, "mac");
  var h2, y2 = 0 | r._crypto_box_macbytes();
  t2.length !== y2 && L(c2, "invalid mac length"), h2 = K(t2), c2.push(h2), a2 = O(c2, a2, "nonce");
  var i2, l2 = 0 | r._crypto_box_noncebytes();
  a2.length !== l2 && L(c2, "invalid nonce length"), i2 = K(a2), c2.push(i2), _2 = O(c2, _2, "publicKey");
  var u2, d2 = 0 | r._crypto_box_publickeybytes();
  _2.length !== d2 && L(c2, "invalid publicKey length"), u2 = K(_2), c2.push(u2), n2 = O(c2, n2, "privateKey");
  var v2, g2 = 0 | r._crypto_box_secretkeybytes();
  n2.length !== g2 && L(c2, "invalid privateKey length"), v2 = K(n2), c2.push(v2);
  var b2 = new B(0 | o2), f2 = b2.address;
  if (c2.push(f2), !(0 | r._crypto_box_open_detached(f2, p2, h2, o2, 0, i2, u2, v2))) {
    var m2 = S(b2, s2);
    return M(c2), m2;
  }
  N(c2, "incorrect key pair for the given ciphertext");
}
function We(e, t2, a2, _2, n2) {
  var s2 = [];
  Y(n2), e = O(s2, e, "ciphertext");
  var c2, p2 = r._crypto_box_macbytes(), o2 = e.length;
  o2 < p2 && L(s2, "ciphertext is too short"), c2 = K(e), s2.push(c2), t2 = O(s2, t2, "nonce");
  var h2, y2 = 0 | r._crypto_box_noncebytes();
  t2.length !== y2 && L(s2, "invalid nonce length"), h2 = K(t2), s2.push(h2), a2 = O(s2, a2, "publicKey");
  var i2, l2 = 0 | r._crypto_box_publickeybytes();
  a2.length !== l2 && L(s2, "invalid publicKey length"), i2 = K(a2), s2.push(i2), _2 = O(s2, _2, "privateKey");
  var u2, d2 = 0 | r._crypto_box_secretkeybytes();
  _2.length !== d2 && L(s2, "invalid privateKey length"), u2 = K(_2), s2.push(u2);
  var v2 = new B(o2 - r._crypto_box_macbytes() | 0), g2 = v2.address;
  if (s2.push(g2), !(0 | r._crypto_box_open_easy(g2, c2, o2, 0, h2, i2, u2))) {
    var b2 = S(v2, n2);
    return M(s2), b2;
  }
  N(s2, "incorrect key pair for the given ciphertext");
}
function je(e, t2, a2, _2) {
  var n2 = [];
  Y(_2);
  var s2 = K(e = O(n2, e, "ciphertext")), c2 = e.length;
  n2.push(s2), t2 = O(n2, t2, "nonce");
  var p2, o2 = 0 | r._crypto_box_noncebytes();
  t2.length !== o2 && L(n2, "invalid nonce length"), p2 = K(t2), n2.push(p2), a2 = O(n2, a2, "sharedKey");
  var h2, y2 = 0 | r._crypto_box_beforenmbytes();
  a2.length !== y2 && L(n2, "invalid sharedKey length"), h2 = K(a2), n2.push(h2);
  var i2 = new B(c2 - r._crypto_box_macbytes() | 0), l2 = i2.address;
  if (n2.push(l2), !(0 | r._crypto_box_open_easy_afternm(l2, s2, c2, 0, p2, h2))) {
    var u2 = S(i2, _2);
    return M(n2), u2;
  }
  N(n2, "incorrect secret key for the given ciphertext");
}
function Je(e, t2, a2) {
  var _2 = [];
  Y(a2);
  var n2 = K(e = O(_2, e, "message")), s2 = e.length;
  _2.push(n2), t2 = O(_2, t2, "publicKey");
  var c2, p2 = 0 | r._crypto_box_publickeybytes();
  t2.length !== p2 && L(_2, "invalid publicKey length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(s2 + r._crypto_box_sealbytes() | 0), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_box_seal(h2, n2, s2, 0, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "invalid usage");
}
function Qe(e, t2, a2, _2) {
  var n2 = [];
  Y(_2), e = O(n2, e, "ciphertext");
  var s2, c2 = r._crypto_box_sealbytes(), p2 = e.length;
  p2 < c2 && L(n2, "ciphertext is too short"), s2 = K(e), n2.push(s2), t2 = O(n2, t2, "publicKey");
  var o2, h2 = 0 | r._crypto_box_publickeybytes();
  t2.length !== h2 && L(n2, "invalid publicKey length"), o2 = K(t2), n2.push(o2), a2 = O(n2, a2, "privateKey");
  var y2, i2 = 0 | r._crypto_box_secretkeybytes();
  a2.length !== i2 && L(n2, "invalid privateKey length"), y2 = K(a2), n2.push(y2);
  var l2 = new B(p2 - r._crypto_box_sealbytes() | 0), u2 = l2.address;
  if (n2.push(u2), !(0 | r._crypto_box_seal_open(u2, s2, p2, 0, o2, y2))) {
    var d2 = S(l2, _2);
    return M(n2), d2;
  }
  N(n2, "incorrect key pair for the given ciphertext");
}
function Ze(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "seed");
  var _2, n2 = 0 | r._crypto_box_seedbytes();
  e.length !== n2 && L(a2, "invalid seed length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_box_publickeybytes()), c2 = s2.address;
  a2.push(c2);
  var p2 = new B(0 | r._crypto_box_secretkeybytes()), o2 = p2.address;
  if (a2.push(o2), !(0 | r._crypto_box_seed_keypair(c2, o2, _2))) {
    var h2 = { publicKey: S(s2, t2), privateKey: S(p2, t2), keyType: "x25519" };
    return M(a2), h2;
  }
  N(a2, "invalid usage");
}
function $e(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "p");
  var n2, s2 = 0 | r._crypto_core_ed25519_bytes();
  e.length !== s2 && L(_2, "invalid p length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "q");
  var c2, p2 = 0 | r._crypto_core_ed25519_bytes();
  t2.length !== p2 && L(_2, "invalid q length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_core_ed25519_bytes()), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_core_ed25519_add(h2, n2, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "input is an invalid element");
}
function er(e, t2) {
  var a2 = [];
  Y(t2);
  var _2 = K(e = O(a2, e, "r"));
  e.length, a2.push(_2);
  var n2 = new B(0 | r._crypto_core_ed25519_bytes()), s2 = n2.address;
  if (a2.push(s2), !(0 | r._crypto_core_ed25519_from_hash(s2, _2))) {
    var c2 = S(n2, t2);
    return M(a2), c2;
  }
  N(a2, "invalid usage");
}
function rr(e, t2) {
  var a2 = [];
  Y(t2);
  var _2 = K(e = O(a2, e, "r"));
  e.length, a2.push(_2);
  var n2 = new B(0 | r._crypto_core_ed25519_bytes()), s2 = n2.address;
  if (a2.push(s2), !(0 | r._crypto_core_ed25519_from_uniform(s2, _2))) {
    var c2 = S(n2, t2);
    return M(a2), c2;
  }
  N(a2, "invalid usage");
}
function tr(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "repr");
  var _2, n2 = 0 | r._crypto_core_ed25519_bytes();
  e.length !== n2 && L(a2, "invalid repr length"), _2 = K(e), a2.push(_2);
  var s2 = 1 == (0 | r._crypto_core_ed25519_is_valid_point(_2));
  return M(a2), s2;
}
function ar(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_core_ed25519_bytes()), _2 = a2.address;
  t2.push(_2), r._crypto_core_ed25519_random(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function _r(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "x");
  var n2, s2 = 0 | r._crypto_core_ed25519_scalarbytes();
  e.length !== s2 && L(_2, "invalid x length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "y");
  var c2, p2 = 0 | r._crypto_core_ed25519_scalarbytes();
  t2.length !== p2 && L(_2, "invalid y length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_core_ed25519_scalarbytes()), h2 = o2.address;
  _2.push(h2), r._crypto_core_ed25519_scalar_add(h2, n2, c2);
  var y2 = S(o2, a2);
  return M(_2), y2;
}
function nr(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "s");
  var _2, n2 = 0 | r._crypto_core_ed25519_scalarbytes();
  e.length !== n2 && L(a2, "invalid s length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_core_ed25519_scalarbytes()), c2 = s2.address;
  a2.push(c2), r._crypto_core_ed25519_scalar_complement(c2, _2);
  var p2 = S(s2, t2);
  return M(a2), p2;
}
function sr(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "s");
  var _2, n2 = 0 | r._crypto_core_ed25519_scalarbytes();
  e.length !== n2 && L(a2, "invalid s length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_core_ed25519_scalarbytes()), c2 = s2.address;
  if (a2.push(c2), !(0 | r._crypto_core_ed25519_scalar_invert(c2, _2))) {
    var p2 = S(s2, t2);
    return M(a2), p2;
  }
  N(a2, "invalid reciprocate");
}
function cr(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "x");
  var n2, s2 = 0 | r._crypto_core_ed25519_scalarbytes();
  e.length !== s2 && L(_2, "invalid x length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "y");
  var c2, p2 = 0 | r._crypto_core_ed25519_scalarbytes();
  t2.length !== p2 && L(_2, "invalid y length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_core_ed25519_scalarbytes()), h2 = o2.address;
  _2.push(h2), r._crypto_core_ed25519_scalar_mul(h2, n2, c2);
  var y2 = S(o2, a2);
  return M(_2), y2;
}
function pr(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "s");
  var _2, n2 = 0 | r._crypto_core_ed25519_scalarbytes();
  e.length !== n2 && L(a2, "invalid s length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_core_ed25519_scalarbytes()), c2 = s2.address;
  a2.push(c2), r._crypto_core_ed25519_scalar_negate(c2, _2);
  var p2 = S(s2, t2);
  return M(a2), p2;
}
function or(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_core_ed25519_scalarbytes()), _2 = a2.address;
  t2.push(_2), r._crypto_core_ed25519_scalar_random(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function hr(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "sample");
  var _2, n2 = 0 | r._crypto_core_ed25519_nonreducedscalarbytes();
  e.length !== n2 && L(a2, "invalid sample length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_core_ed25519_scalarbytes()), c2 = s2.address;
  a2.push(c2), r._crypto_core_ed25519_scalar_reduce(c2, _2);
  var p2 = S(s2, t2);
  return M(a2), p2;
}
function yr(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "x");
  var n2, s2 = 0 | r._crypto_core_ed25519_scalarbytes();
  e.length !== s2 && L(_2, "invalid x length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "y");
  var c2, p2 = 0 | r._crypto_core_ed25519_scalarbytes();
  t2.length !== p2 && L(_2, "invalid y length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_core_ed25519_scalarbytes()), h2 = o2.address;
  _2.push(h2), r._crypto_core_ed25519_scalar_sub(h2, n2, c2);
  var y2 = S(o2, a2);
  return M(_2), y2;
}
function ir(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "p");
  var n2, s2 = 0 | r._crypto_core_ed25519_bytes();
  e.length !== s2 && L(_2, "invalid p length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "q");
  var c2, p2 = 0 | r._crypto_core_ed25519_bytes();
  t2.length !== p2 && L(_2, "invalid q length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_core_ed25519_bytes()), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_core_ed25519_sub(h2, n2, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "input is an invalid element");
}
function lr(e, t2, a2, _2) {
  var n2 = [];
  Y(_2), e = O(n2, e, "input");
  var s2, c2 = 0 | r._crypto_core_hchacha20_inputbytes();
  e.length !== c2 && L(n2, "invalid input length"), s2 = K(e), n2.push(s2), t2 = O(n2, t2, "privateKey");
  var p2, o2 = 0 | r._crypto_core_hchacha20_keybytes();
  t2.length !== o2 && L(n2, "invalid privateKey length"), p2 = K(t2), n2.push(p2);
  var h2 = null;
  null != a2 && (h2 = K(a2 = O(n2, a2, "constant")), a2.length, n2.push(h2));
  var y2 = new B(0 | r._crypto_core_hchacha20_outputbytes()), i2 = y2.address;
  if (n2.push(i2), !(0 | r._crypto_core_hchacha20(i2, s2, p2, h2))) {
    var l2 = S(y2, _2);
    return M(n2), l2;
  }
  N(n2, "invalid usage");
}
function ur(e, t2, a2, _2) {
  var n2 = [];
  Y(_2), e = O(n2, e, "input");
  var s2, c2 = 0 | r._crypto_core_hsalsa20_inputbytes();
  e.length !== c2 && L(n2, "invalid input length"), s2 = K(e), n2.push(s2), t2 = O(n2, t2, "privateKey");
  var p2, o2 = 0 | r._crypto_core_hsalsa20_keybytes();
  t2.length !== o2 && L(n2, "invalid privateKey length"), p2 = K(t2), n2.push(p2);
  var h2 = null;
  null != a2 && (h2 = K(a2 = O(n2, a2, "constant")), a2.length, n2.push(h2));
  var y2 = new B(0 | r._crypto_core_hsalsa20_outputbytes()), i2 = y2.address;
  if (n2.push(i2), !(0 | r._crypto_core_hsalsa20(i2, s2, p2, h2))) {
    var l2 = S(y2, _2);
    return M(n2), l2;
  }
  N(n2, "invalid usage");
}
function dr(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "p");
  var n2, s2 = 0 | r._crypto_core_ristretto255_bytes();
  e.length !== s2 && L(_2, "invalid p length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "q");
  var c2, p2 = 0 | r._crypto_core_ristretto255_bytes();
  t2.length !== p2 && L(_2, "invalid q length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_core_ristretto255_bytes()), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_core_ristretto255_add(h2, n2, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "input is an invalid element");
}
function vr(e, t2) {
  var a2 = [];
  Y(t2);
  var _2 = K(e = O(a2, e, "r"));
  e.length, a2.push(_2);
  var n2 = new B(0 | r._crypto_core_ristretto255_bytes()), s2 = n2.address;
  if (a2.push(s2), !(0 | r._crypto_core_ristretto255_from_hash(s2, _2))) {
    var c2 = S(n2, t2);
    return M(a2), c2;
  }
  N(a2, "invalid usage");
}
function gr(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "repr");
  var _2, n2 = 0 | r._crypto_core_ristretto255_bytes();
  e.length !== n2 && L(a2, "invalid repr length"), _2 = K(e), a2.push(_2);
  var s2 = 1 == (0 | r._crypto_core_ristretto255_is_valid_point(_2));
  return M(a2), s2;
}
function br(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_core_ristretto255_bytes()), _2 = a2.address;
  t2.push(_2), r._crypto_core_ristretto255_random(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function fr(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "x");
  var n2, s2 = 0 | r._crypto_core_ristretto255_scalarbytes();
  e.length !== s2 && L(_2, "invalid x length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "y");
  var c2, p2 = 0 | r._crypto_core_ristretto255_scalarbytes();
  t2.length !== p2 && L(_2, "invalid y length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_core_ristretto255_scalarbytes()), h2 = o2.address;
  _2.push(h2), r._crypto_core_ristretto255_scalar_add(h2, n2, c2);
  var y2 = S(o2, a2);
  return M(_2), y2;
}
function mr(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "s");
  var _2, n2 = 0 | r._crypto_core_ristretto255_scalarbytes();
  e.length !== n2 && L(a2, "invalid s length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_core_ristretto255_scalarbytes()), c2 = s2.address;
  a2.push(c2), r._crypto_core_ristretto255_scalar_complement(c2, _2);
  var p2 = S(s2, t2);
  return M(a2), p2;
}
function kr(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "s");
  var _2, n2 = 0 | r._crypto_core_ristretto255_scalarbytes();
  e.length !== n2 && L(a2, "invalid s length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_core_ristretto255_scalarbytes()), c2 = s2.address;
  if (a2.push(c2), !(0 | r._crypto_core_ristretto255_scalar_invert(c2, _2))) {
    var p2 = S(s2, t2);
    return M(a2), p2;
  }
  N(a2, "invalid reciprocate");
}
function xr(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "x");
  var n2, s2 = 0 | r._crypto_core_ristretto255_scalarbytes();
  e.length !== s2 && L(_2, "invalid x length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "y");
  var c2, p2 = 0 | r._crypto_core_ristretto255_scalarbytes();
  t2.length !== p2 && L(_2, "invalid y length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_core_ristretto255_scalarbytes()), h2 = o2.address;
  _2.push(h2), r._crypto_core_ristretto255_scalar_mul(h2, n2, c2);
  var y2 = S(o2, a2);
  return M(_2), y2;
}
function Er(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "s");
  var _2, n2 = 0 | r._crypto_core_ristretto255_scalarbytes();
  e.length !== n2 && L(a2, "invalid s length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_core_ristretto255_scalarbytes()), c2 = s2.address;
  a2.push(c2), r._crypto_core_ristretto255_scalar_negate(c2, _2);
  var p2 = S(s2, t2);
  return M(a2), p2;
}
function Tr(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_core_ristretto255_scalarbytes()), _2 = a2.address;
  t2.push(_2), r._crypto_core_ristretto255_scalar_random(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function Sr(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "sample");
  var _2, n2 = 0 | r._crypto_core_ristretto255_nonreducedscalarbytes();
  e.length !== n2 && L(a2, "invalid sample length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_core_ristretto255_scalarbytes()), c2 = s2.address;
  a2.push(c2), r._crypto_core_ristretto255_scalar_reduce(c2, _2);
  var p2 = S(s2, t2);
  return M(a2), p2;
}
function wr(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "x");
  var n2, s2 = 0 | r._crypto_core_ristretto255_scalarbytes();
  e.length !== s2 && L(_2, "invalid x length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "y");
  var c2, p2 = 0 | r._crypto_core_ristretto255_scalarbytes();
  t2.length !== p2 && L(_2, "invalid y length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_core_ristretto255_scalarbytes()), h2 = o2.address;
  _2.push(h2), r._crypto_core_ristretto255_scalar_sub(h2, n2, c2);
  var y2 = S(o2, a2);
  return M(_2), y2;
}
function Yr(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "p");
  var n2, s2 = 0 | r._crypto_core_ristretto255_bytes();
  e.length !== s2 && L(_2, "invalid p length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "q");
  var c2, p2 = 0 | r._crypto_core_ristretto255_bytes();
  t2.length !== p2 && L(_2, "invalid q length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_core_ristretto255_bytes()), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_core_ristretto255_sub(h2, n2, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "input is an invalid element");
}
function Br(e, t2, a2, _2) {
  var n2 = [];
  Y(_2), U(n2, e, "hash_length"), ("number" != typeof e || (0 | e) !== e || e < 0) && L(n2, "hash_length must be an unsigned integer");
  var s2 = K(t2 = O(n2, t2, "message")), c2 = t2.length;
  n2.push(s2);
  var p2 = null, o2 = 0;
  null != a2 && (p2 = K(a2 = O(n2, a2, "key")), o2 = a2.length, n2.push(p2));
  var h2 = new B(e |= 0), y2 = h2.address;
  if (n2.push(y2), !(0 | r._crypto_generichash(y2, e, s2, c2, 0, p2, o2))) {
    var i2 = S(h2, _2);
    return M(n2), i2;
  }
  N(n2, "invalid usage");
}
function Kr(e, t2, a2, _2, n2) {
  var s2 = [];
  Y(n2), U(s2, e, "subkey_len"), ("number" != typeof e || (0 | e) !== e || e < 0) && L(s2, "subkey_len must be an unsigned integer");
  var c2 = null, p2 = 0;
  null != t2 && (c2 = K(t2 = O(s2, t2, "key")), p2 = t2.length, s2.push(c2));
  var o2 = null, h2 = 0;
  null != a2 && (a2 = O(s2, a2, "id"), h2 = 0 | r._crypto_generichash_blake2b_saltbytes(), a2.length !== h2 && L(s2, "invalid id length"), o2 = K(a2), s2.push(o2));
  var y2 = null, i2 = 0;
  null != _2 && (_2 = O(s2, _2, "ctx"), i2 = 0 | r._crypto_generichash_blake2b_personalbytes(), _2.length !== i2 && L(s2, "invalid ctx length"), y2 = K(_2), s2.push(y2));
  var l2 = new B(0 | e), u2 = l2.address;
  if (s2.push(u2), !(0 | r._crypto_generichash_blake2b_salt_personal(u2, e, null, 0, 0, c2, p2, o2, y2))) {
    var d2 = S(l2, n2);
    return M(s2), d2;
  }
  N(s2, "invalid usage");
}
function Ar(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "state_address"), U(_2, t2, "hash_length"), ("number" != typeof t2 || (0 | t2) !== t2 || t2 < 0) && L(_2, "hash_length must be an unsigned integer");
  var n2 = new B(t2 |= 0), s2 = n2.address;
  if (_2.push(s2), !(0 | r._crypto_generichash_final(e, s2, t2))) {
    var c2 = (r._free(e), S(n2, a2));
    return M(_2), c2;
  }
  N(_2, "invalid usage");
}
function Ir(e, t2, a2) {
  var _2 = [];
  Y(a2);
  var n2 = null, s2 = 0;
  null != e && (n2 = K(e = O(_2, e, "key")), s2 = e.length, _2.push(n2)), U(_2, t2, "hash_length"), ("number" != typeof t2 || (0 | t2) !== t2 || t2 < 0) && L(_2, "hash_length must be an unsigned integer");
  var c2 = new B(357).address;
  if (!(0 | r._crypto_generichash_init(c2, n2, s2, t2))) {
    var p2 = c2;
    return M(_2), p2;
  }
  N(_2, "invalid usage");
}
function Mr(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_generichash_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_generichash_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function Nr(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "state_address");
  var n2 = K(t2 = O(_2, t2, "message_chunk")), s2 = t2.length;
  _2.push(n2), 0 | r._crypto_generichash_update(e, n2, s2) && N(_2, "invalid usage"), M(_2);
}
function Lr(e, t2) {
  var a2 = [];
  Y(t2);
  var _2 = K(e = O(a2, e, "message")), n2 = e.length;
  a2.push(_2);
  var s2 = new B(0 | r._crypto_hash_bytes()), c2 = s2.address;
  if (a2.push(c2), !(0 | r._crypto_hash(c2, _2, n2, 0))) {
    var p2 = S(s2, t2);
    return M(a2), p2;
  }
  N(a2, "invalid usage");
}
function Ur(e, t2) {
  var a2 = [];
  Y(t2);
  var _2 = K(e = O(a2, e, "message")), n2 = e.length;
  a2.push(_2);
  var s2 = new B(0 | r._crypto_hash_sha256_bytes()), c2 = s2.address;
  if (a2.push(c2), !(0 | r._crypto_hash_sha256(c2, _2, n2, 0))) {
    var p2 = S(s2, t2);
    return M(a2), p2;
  }
  N(a2, "invalid usage");
}
function Or(e, t2) {
  var a2 = [];
  Y(t2), U(a2, e, "state_address");
  var _2 = new B(0 | r._crypto_hash_sha256_bytes()), n2 = _2.address;
  if (a2.push(n2), !(0 | r._crypto_hash_sha256_final(e, n2))) {
    var s2 = (r._free(e), S(_2, t2));
    return M(a2), s2;
  }
  N(a2, "invalid usage");
}
function Cr(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(104).address;
  if (!(0 | r._crypto_hash_sha256_init(a2))) {
    var _2 = a2;
    return M(t2), _2;
  }
  N(t2, "invalid usage");
}
function Rr(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "state_address");
  var n2 = K(t2 = O(_2, t2, "message_chunk")), s2 = t2.length;
  _2.push(n2), 0 | r._crypto_hash_sha256_update(e, n2, s2) && N(_2, "invalid usage"), M(_2);
}
function Pr(e, t2) {
  var a2 = [];
  Y(t2);
  var _2 = K(e = O(a2, e, "message")), n2 = e.length;
  a2.push(_2);
  var s2 = new B(0 | r._crypto_hash_sha3256_bytes()), c2 = s2.address;
  if (a2.push(c2), !(0 | r._crypto_hash_sha3256(c2, _2, n2))) {
    var p2 = S(s2, t2);
    return M(a2), p2;
  }
  N(a2, "invalid usage");
}
function Xr(e, t2) {
  var a2 = [];
  Y(t2), U(a2, e, "state_address");
  var _2 = new B(0 | r._crypto_hash_sha3256_bytes()), n2 = _2.address;
  if (a2.push(n2), !(0 | r._crypto_hash_sha3256_final(e, n2))) {
    var s2 = (r._free(e), S(_2, t2));
    return M(a2), s2;
  }
  N(a2, "invalid usage");
}
function Dr(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(256).address;
  if (!(0 | r._crypto_hash_sha3256_init(a2))) {
    var _2 = a2;
    return M(t2), _2;
  }
  N(t2, "invalid usage");
}
function Gr(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "state_address");
  var n2 = K(t2 = O(_2, t2, "message_chunk")), s2 = t2.length;
  _2.push(n2), 0 | r._crypto_hash_sha3256_update(e, n2, s2) && N(_2, "invalid usage"), M(_2);
}
function Fr(e, t2) {
  var a2 = [];
  Y(t2);
  var _2 = K(e = O(a2, e, "message")), n2 = e.length;
  a2.push(_2);
  var s2 = new B(0 | r._crypto_hash_sha3512_bytes()), c2 = s2.address;
  if (a2.push(c2), !(0 | r._crypto_hash_sha3512(c2, _2, n2))) {
    var p2 = S(s2, t2);
    return M(a2), p2;
  }
  N(a2, "invalid usage");
}
function Vr(e, t2) {
  var a2 = [];
  Y(t2), U(a2, e, "state_address");
  var _2 = new B(0 | r._crypto_hash_sha3512_bytes()), n2 = _2.address;
  if (a2.push(n2), !(0 | r._crypto_hash_sha3512_final(e, n2))) {
    var s2 = (r._free(e), S(_2, t2));
    return M(a2), s2;
  }
  N(a2, "invalid usage");
}
function qr(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(256).address;
  if (!(0 | r._crypto_hash_sha3512_init(a2))) {
    var _2 = a2;
    return M(t2), _2;
  }
  N(t2, "invalid usage");
}
function Hr(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "state_address");
  var n2 = K(t2 = O(_2, t2, "message_chunk")), s2 = t2.length;
  _2.push(n2), 0 | r._crypto_hash_sha3512_update(e, n2, s2) && N(_2, "invalid usage"), M(_2);
}
function zr(e, t2) {
  var a2 = [];
  Y(t2);
  var _2 = K(e = O(a2, e, "message")), n2 = e.length;
  a2.push(_2);
  var s2 = new B(0 | r._crypto_hash_sha512_bytes()), c2 = s2.address;
  if (a2.push(c2), !(0 | r._crypto_hash_sha512(c2, _2, n2, 0))) {
    var p2 = S(s2, t2);
    return M(a2), p2;
  }
  N(a2, "invalid usage");
}
function Wr(e, t2) {
  var a2 = [];
  Y(t2), U(a2, e, "state_address");
  var _2 = new B(0 | r._crypto_hash_sha512_bytes()), n2 = _2.address;
  if (a2.push(n2), !(0 | r._crypto_hash_sha512_final(e, n2))) {
    var s2 = (r._free(e), S(_2, t2));
    return M(a2), s2;
  }
  N(a2, "invalid usage");
}
function jr(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(208).address;
  if (!(0 | r._crypto_hash_sha512_init(a2))) {
    var _2 = a2;
    return M(t2), _2;
  }
  N(t2, "invalid usage");
}
function Jr(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "state_address");
  var n2 = K(t2 = O(_2, t2, "message_chunk")), s2 = t2.length;
  _2.push(n2), 0 | r._crypto_hash_sha512_update(e, n2, s2) && N(_2, "invalid usage"), M(_2);
}
function Qr(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "input");
  var n2, s2 = 0 | r._crypto_ipcrypt_bytes();
  e.length !== s2 && L(_2, "invalid input length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "key");
  var c2, p2 = 0 | r._crypto_ipcrypt_keybytes();
  t2.length !== p2 && L(_2, "invalid key length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_ipcrypt_bytes()), h2 = o2.address;
  _2.push(h2), r._crypto_ipcrypt_decrypt(h2, n2, c2);
  var y2 = S(o2, a2);
  return M(_2), y2;
}
function Zr(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "input");
  var n2, s2 = 0 | r._crypto_ipcrypt_bytes();
  e.length !== s2 && L(_2, "invalid input length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "key");
  var c2, p2 = 0 | r._crypto_ipcrypt_keybytes();
  t2.length !== p2 && L(_2, "invalid key length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_ipcrypt_bytes()), h2 = o2.address;
  _2.push(h2), r._crypto_ipcrypt_encrypt(h2, n2, c2);
  var y2 = S(o2, a2);
  return M(_2), y2;
}
function $r(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_ipcrypt_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_ipcrypt_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function et(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "input");
  var n2, s2 = 0 | r._crypto_ipcrypt_nd_outputbytes();
  e.length !== s2 && L(_2, "invalid input length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "key");
  var c2, p2 = 0 | r._crypto_ipcrypt_nd_keybytes();
  t2.length !== p2 && L(_2, "invalid key length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_ipcrypt_nd_inputbytes()), h2 = o2.address;
  _2.push(h2), r._crypto_ipcrypt_nd_decrypt(h2, n2, c2);
  var y2 = S(o2, a2);
  return M(_2), y2;
}
function rt(e, t2, a2, _2) {
  var n2 = [];
  Y(_2), e = O(n2, e, "input");
  var s2, c2 = 0 | r._crypto_ipcrypt_nd_inputbytes();
  e.length !== c2 && L(n2, "invalid input length"), s2 = K(e), n2.push(s2), t2 = O(n2, t2, "tweak");
  var p2, o2 = 0 | r._crypto_ipcrypt_nd_tweakbytes();
  t2.length !== o2 && L(n2, "invalid tweak length"), p2 = K(t2), n2.push(p2), a2 = O(n2, a2, "key");
  var h2, y2 = 0 | r._crypto_ipcrypt_nd_keybytes();
  a2.length !== y2 && L(n2, "invalid key length"), h2 = K(a2), n2.push(h2);
  var i2 = new B(0 | r._crypto_ipcrypt_nd_outputbytes()), l2 = i2.address;
  n2.push(l2), r._crypto_ipcrypt_nd_encrypt(l2, s2, p2, h2);
  var u2 = S(i2, _2);
  return M(n2), u2;
}
function tt(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_ipcrypt_nd_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_ipcrypt_nd_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function at(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "input");
  var n2, s2 = 0 | r._crypto_ipcrypt_ndx_outputbytes();
  e.length !== s2 && L(_2, "invalid input length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "key");
  var c2, p2 = 0 | r._crypto_ipcrypt_ndx_keybytes();
  t2.length !== p2 && L(_2, "invalid key length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_ipcrypt_ndx_inputbytes()), h2 = o2.address;
  _2.push(h2), r._crypto_ipcrypt_ndx_decrypt(h2, n2, c2);
  var y2 = S(o2, a2);
  return M(_2), y2;
}
function _t(e, t2, a2, _2) {
  var n2 = [];
  Y(_2), e = O(n2, e, "input");
  var s2, c2 = 0 | r._crypto_ipcrypt_ndx_inputbytes();
  e.length !== c2 && L(n2, "invalid input length"), s2 = K(e), n2.push(s2), t2 = O(n2, t2, "tweak");
  var p2, o2 = 0 | r._crypto_ipcrypt_ndx_tweakbytes();
  t2.length !== o2 && L(n2, "invalid tweak length"), p2 = K(t2), n2.push(p2), a2 = O(n2, a2, "key");
  var h2, y2 = 0 | r._crypto_ipcrypt_ndx_keybytes();
  a2.length !== y2 && L(n2, "invalid key length"), h2 = K(a2), n2.push(h2);
  var i2 = new B(0 | r._crypto_ipcrypt_ndx_outputbytes()), l2 = i2.address;
  n2.push(l2), r._crypto_ipcrypt_ndx_encrypt(l2, s2, p2, h2);
  var u2 = S(i2, _2);
  return M(n2), u2;
}
function nt(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_ipcrypt_ndx_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_ipcrypt_ndx_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function st(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "input");
  var n2, s2 = 0 | r._crypto_ipcrypt_pfx_bytes();
  e.length !== s2 && L(_2, "invalid input length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "key");
  var c2, p2 = 0 | r._crypto_ipcrypt_pfx_keybytes();
  t2.length !== p2 && L(_2, "invalid key length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_ipcrypt_pfx_bytes()), h2 = o2.address;
  _2.push(h2), r._crypto_ipcrypt_pfx_decrypt(h2, n2, c2);
  var y2 = S(o2, a2);
  return M(_2), y2;
}
function ct(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "input");
  var n2, s2 = 0 | r._crypto_ipcrypt_pfx_bytes();
  e.length !== s2 && L(_2, "invalid input length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "key");
  var c2, p2 = 0 | r._crypto_ipcrypt_pfx_keybytes();
  t2.length !== p2 && L(_2, "invalid key length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_ipcrypt_pfx_bytes()), h2 = o2.address;
  _2.push(h2), r._crypto_ipcrypt_pfx_encrypt(h2, n2, c2);
  var y2 = S(o2, a2);
  return M(_2), y2;
}
function pt(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_ipcrypt_pfx_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_ipcrypt_pfx_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function ot(e, t2, a2, _2, n2) {
  var s2 = [];
  Y(n2), U(s2, e, "subkey_len"), ("number" != typeof e || (0 | e) !== e || e < 0) && L(s2, "subkey_len must be an unsigned integer"), U(s2, t2, "subkey_id");
  var c2, p2 = 0;
  if ("bigint" == typeof t2 && t2 >= BigInt(0)) {
    const e2 = t2 >> BigInt(32);
    e2 > BigInt(4294967295) && L(s2, "subkey_id cannot be more than 64 bits"), p2 = Number(e2), c2 = Number(t2 & BigInt(4294967295));
  } else "number" == typeof t2 && (0 | t2) === t2 && t2 >= 0 ? c2 = t2 : L(s2, "subkey_id must be an unsigned integer or bigint");
  "string" != typeof a2 && L(s2, "ctx must be a string"), (a2 = v(a2 + "\0")).length - 1 !== r._crypto_kdf_contextbytes() && L(s2, "invalid ctx length");
  var o2 = K(a2);
  a2.length, s2.push(o2), _2 = O(s2, _2, "key");
  var h2, y2 = 0 | r._crypto_kdf_keybytes();
  _2.length !== y2 && L(s2, "invalid key length"), h2 = K(_2), s2.push(h2);
  var i2 = new B(0 | e), l2 = i2.address;
  s2.push(l2), r._crypto_kdf_derive_from_key(l2, e, c2, p2, o2, h2);
  var u2 = S(i2, n2);
  return M(s2), u2;
}
function ht(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_kdf_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_kdf_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function yt(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "ciphertext");
  var n2, s2 = 0 | r._crypto_kem_ciphertextbytes();
  e.length !== s2 && L(_2, "invalid ciphertext length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "privateKey");
  var c2, p2 = 0 | r._crypto_kem_secretkeybytes();
  t2.length !== p2 && L(_2, "invalid privateKey length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_kem_sharedsecretbytes()), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_kem_dec(h2, n2, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "invalid usage");
}
function it(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "publicKey");
  var _2, n2 = 0 | r._crypto_kem_publickeybytes();
  e.length !== n2 && L(a2, "invalid publicKey length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_kem_ciphertextbytes()), c2 = s2.address;
  a2.push(c2);
  var p2 = new B(0 | r._crypto_kem_sharedsecretbytes()), o2 = p2.address;
  if (a2.push(o2), !(0 | r._crypto_kem_enc(c2, o2, _2))) {
    var h2 = S({ ciphertext: s2, sharedSecret: p2 }, t2);
    return M(a2), h2;
  }
  N(a2, "invalid usage");
}
function lt(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_kem_publickeybytes()), _2 = a2.address;
  t2.push(_2);
  var n2 = new B(0 | r._crypto_kem_secretkeybytes()), s2 = n2.address;
  if (t2.push(s2), !(0 | r._crypto_kem_keypair(_2, s2))) {
    var c2 = { publicKey: S(a2, e), privateKey: S(n2, e), keyType: "xwing" };
    return M(t2), c2;
  }
  N(t2, "internal error");
}
function ut(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "ciphertext");
  var n2, s2 = 0 | r._crypto_kem_mlkem768_ciphertextbytes();
  e.length !== s2 && L(_2, "invalid ciphertext length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "privateKey");
  var c2, p2 = 0 | r._crypto_kem_mlkem768_secretkeybytes();
  t2.length !== p2 && L(_2, "invalid privateKey length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_kem_mlkem768_sharedsecretbytes()), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_kem_mlkem768_dec(h2, n2, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "invalid usage");
}
function dt(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "publicKey");
  var _2, n2 = 0 | r._crypto_kem_mlkem768_publickeybytes();
  e.length !== n2 && L(a2, "invalid publicKey length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_kem_mlkem768_ciphertextbytes()), c2 = s2.address;
  a2.push(c2);
  var p2 = new B(0 | r._crypto_kem_mlkem768_sharedsecretbytes()), o2 = p2.address;
  if (a2.push(o2), !(0 | r._crypto_kem_mlkem768_enc(c2, o2, _2))) {
    var h2 = S({ ciphertext: s2, sharedSecret: p2 }, t2);
    return M(a2), h2;
  }
  N(a2, "invalid usage");
}
function vt(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "publicKey");
  var n2, s2, c2 = 0 | r._crypto_kem_mlkem768_publickeybytes();
  e.length !== c2 && L(_2, "invalid publicKey length"), n2 = K(e), _2.push(n2), 32 !== (t2 = O(_2, t2, "seed")).length && L(_2, "invalid seed length"), s2 = K(t2), _2.push(s2);
  var p2 = new B(0 | r._crypto_kem_mlkem768_ciphertextbytes()), o2 = p2.address;
  _2.push(o2);
  var h2 = new B(0 | r._crypto_kem_mlkem768_sharedsecretbytes()), y2 = h2.address;
  if (_2.push(y2), !(0 | r._crypto_kem_mlkem768_enc_deterministic(o2, y2, n2, s2))) {
    var i2 = S({ ciphertext: p2, sharedSecret: h2 }, a2);
    return M(_2), i2;
  }
  N(_2, "invalid usage");
}
function gt(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_kem_mlkem768_publickeybytes()), _2 = a2.address;
  t2.push(_2);
  var n2 = new B(0 | r._crypto_kem_mlkem768_secretkeybytes()), s2 = n2.address;
  if (t2.push(s2), !(0 | r._crypto_kem_mlkem768_keypair(_2, s2))) {
    var c2 = { publicKey: S(a2, e), privateKey: S(n2, e), keyType: "ml-kem-768" };
    return M(t2), c2;
  }
  N(t2, "internal error");
}
function bt(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "seed");
  var _2, n2 = 0 | r._crypto_kem_mlkem768_seedbytes();
  e.length !== n2 && L(a2, "invalid seed length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_kem_mlkem768_publickeybytes()), c2 = s2.address;
  a2.push(c2);
  var p2 = new B(0 | r._crypto_kem_mlkem768_secretkeybytes()), o2 = p2.address;
  if (a2.push(o2), !(0 | r._crypto_kem_mlkem768_seed_keypair(c2, o2, _2))) {
    var h2 = { publicKey: S(s2, t2), privateKey: S(p2, t2), keyType: "ml-kem-768" };
    return M(a2), h2;
  }
  N(a2, "invalid usage");
}
function ft() {
  var e = r._crypto_kem_primitive(), t2 = r.UTF8ToString(e);
  return M([]), t2;
}
function mt(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "seed");
  var _2, n2 = 0 | r._crypto_kem_seedbytes();
  e.length !== n2 && L(a2, "invalid seed length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_kem_publickeybytes()), c2 = s2.address;
  a2.push(c2);
  var p2 = new B(0 | r._crypto_kem_secretkeybytes()), o2 = p2.address;
  if (a2.push(o2), !(0 | r._crypto_kem_seed_keypair(c2, o2, _2))) {
    var h2 = { publicKey: S(s2, t2), privateKey: S(p2, t2), keyType: "xwing" };
    return M(a2), h2;
  }
  N(a2, "invalid usage");
}
function kt(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "ciphertext");
  var n2, s2 = 0 | r._crypto_kem_xwing_ciphertextbytes();
  e.length !== s2 && L(_2, "invalid ciphertext length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "privateKey");
  var c2, p2 = 0 | r._crypto_kem_xwing_secretkeybytes();
  t2.length !== p2 && L(_2, "invalid privateKey length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_kem_xwing_sharedsecretbytes()), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_kem_xwing_dec(h2, n2, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "invalid usage");
}
function xt(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "publicKey");
  var _2, n2 = 0 | r._crypto_kem_xwing_publickeybytes();
  e.length !== n2 && L(a2, "invalid publicKey length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_kem_xwing_ciphertextbytes()), c2 = s2.address;
  a2.push(c2);
  var p2 = new B(0 | r._crypto_kem_xwing_sharedsecretbytes()), o2 = p2.address;
  if (a2.push(o2), !(0 | r._crypto_kem_xwing_enc(c2, o2, _2))) {
    var h2 = S({ ciphertext: s2, sharedSecret: p2 }, t2);
    return M(a2), h2;
  }
  N(a2, "invalid usage");
}
function Et(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "publicKey");
  var n2, s2, c2 = 0 | r._crypto_kem_xwing_publickeybytes();
  e.length !== c2 && L(_2, "invalid publicKey length"), n2 = K(e), _2.push(n2), 64 !== (t2 = O(_2, t2, "seed")).length && L(_2, "invalid seed length"), s2 = K(t2), _2.push(s2);
  var p2 = new B(0 | r._crypto_kem_xwing_ciphertextbytes()), o2 = p2.address;
  _2.push(o2);
  var h2 = new B(0 | r._crypto_kem_xwing_sharedsecretbytes()), y2 = h2.address;
  if (_2.push(y2), !(0 | r._crypto_kem_xwing_enc_deterministic(o2, y2, n2, s2))) {
    var i2 = S({ ciphertext: p2, sharedSecret: h2 }, a2);
    return M(_2), i2;
  }
  N(_2, "invalid usage");
}
function Tt(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_kem_xwing_publickeybytes()), _2 = a2.address;
  t2.push(_2);
  var n2 = new B(0 | r._crypto_kem_xwing_secretkeybytes()), s2 = n2.address;
  if (t2.push(s2), !(0 | r._crypto_kem_xwing_keypair(_2, s2))) {
    var c2 = { publicKey: S(a2, e), privateKey: S(n2, e), keyType: "xwing" };
    return M(t2), c2;
  }
  N(t2, "internal error");
}
function St(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "seed");
  var _2, n2 = 0 | r._crypto_kem_xwing_seedbytes();
  e.length !== n2 && L(a2, "invalid seed length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_kem_xwing_publickeybytes()), c2 = s2.address;
  a2.push(c2);
  var p2 = new B(0 | r._crypto_kem_xwing_secretkeybytes()), o2 = p2.address;
  if (a2.push(o2), !(0 | r._crypto_kem_xwing_seed_keypair(c2, o2, _2))) {
    var h2 = { publicKey: S(s2, t2), privateKey: S(p2, t2), keyType: "xwing" };
    return M(a2), h2;
  }
  N(a2, "invalid usage");
}
function wt(e, t2, a2, _2) {
  var n2 = [];
  Y(_2), e = O(n2, e, "clientPublicKey");
  var s2, c2 = 0 | r._crypto_kx_publickeybytes();
  e.length !== c2 && L(n2, "invalid clientPublicKey length"), s2 = K(e), n2.push(s2), t2 = O(n2, t2, "clientSecretKey");
  var p2, o2 = 0 | r._crypto_kx_secretkeybytes();
  t2.length !== o2 && L(n2, "invalid clientSecretKey length"), p2 = K(t2), n2.push(p2), a2 = O(n2, a2, "serverPublicKey");
  var h2, y2 = 0 | r._crypto_kx_publickeybytes();
  a2.length !== y2 && L(n2, "invalid serverPublicKey length"), h2 = K(a2), n2.push(h2);
  var i2 = new B(0 | r._crypto_kx_sessionkeybytes()), l2 = i2.address;
  n2.push(l2);
  var u2 = new B(0 | r._crypto_kx_sessionkeybytes()), d2 = u2.address;
  if (n2.push(d2), !(0 | r._crypto_kx_client_session_keys(l2, d2, s2, p2, h2))) {
    var v2 = S({ sharedRx: i2, sharedTx: u2 }, _2);
    return M(n2), v2;
  }
  N(n2, "invalid usage");
}
function Yt(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_kx_publickeybytes()), _2 = a2.address;
  t2.push(_2);
  var n2 = new B(0 | r._crypto_kx_secretkeybytes()), s2 = n2.address;
  if (t2.push(s2), !(0 | r._crypto_kx_keypair(_2, s2))) {
    var c2 = { publicKey: S(a2, e), privateKey: S(n2, e), keyType: "x25519" };
    return M(t2), c2;
  }
  N(t2, "internal error");
}
function Bt(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "seed");
  var _2, n2 = 0 | r._crypto_kx_seedbytes();
  e.length !== n2 && L(a2, "invalid seed length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_kx_publickeybytes()), c2 = s2.address;
  a2.push(c2);
  var p2 = new B(0 | r._crypto_kx_secretkeybytes()), o2 = p2.address;
  if (a2.push(o2), !(0 | r._crypto_kx_seed_keypair(c2, o2, _2))) {
    var h2 = { publicKey: S(s2, t2), privateKey: S(p2, t2), keyType: "x25519" };
    return M(a2), h2;
  }
  N(a2, "internal error");
}
function Kt(e, t2, a2, _2) {
  var n2 = [];
  Y(_2), e = O(n2, e, "serverPublicKey");
  var s2, c2 = 0 | r._crypto_kx_publickeybytes();
  e.length !== c2 && L(n2, "invalid serverPublicKey length"), s2 = K(e), n2.push(s2), t2 = O(n2, t2, "serverSecretKey");
  var p2, o2 = 0 | r._crypto_kx_secretkeybytes();
  t2.length !== o2 && L(n2, "invalid serverSecretKey length"), p2 = K(t2), n2.push(p2), a2 = O(n2, a2, "clientPublicKey");
  var h2, y2 = 0 | r._crypto_kx_publickeybytes();
  a2.length !== y2 && L(n2, "invalid clientPublicKey length"), h2 = K(a2), n2.push(h2);
  var i2 = new B(0 | r._crypto_kx_sessionkeybytes()), l2 = i2.address;
  n2.push(l2);
  var u2 = new B(0 | r._crypto_kx_sessionkeybytes()), d2 = u2.address;
  if (n2.push(d2), !(0 | r._crypto_kx_server_session_keys(l2, d2, s2, p2, h2))) {
    var v2 = S({ sharedRx: i2, sharedTx: u2 }, _2);
    return M(n2), v2;
  }
  N(n2, "invalid usage");
}
function At(e, t2, a2) {
  var _2 = [];
  Y(a2);
  var n2 = K(e = O(_2, e, "message")), s2 = e.length;
  _2.push(n2), t2 = O(_2, t2, "key");
  var c2, p2 = 0 | r._crypto_onetimeauth_keybytes();
  t2.length !== p2 && L(_2, "invalid key length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_onetimeauth_bytes()), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_onetimeauth(h2, n2, s2, 0, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "invalid usage");
}
function It(e, t2) {
  var a2 = [];
  Y(t2), U(a2, e, "state_address");
  var _2 = new B(0 | r._crypto_onetimeauth_bytes()), n2 = _2.address;
  if (a2.push(n2), !(0 | r._crypto_onetimeauth_final(e, n2))) {
    var s2 = (r._free(e), S(_2, t2));
    return M(a2), s2;
  }
  N(a2, "invalid usage");
}
function Mt(e, t2) {
  var a2 = [];
  Y(t2);
  var _2 = null;
  null != e && (_2 = K(e = O(a2, e, "key")), e.length, a2.push(_2));
  var n2 = new B(144).address;
  if (!(0 | r._crypto_onetimeauth_init(n2, _2))) {
    var s2 = n2;
    return M(a2), s2;
  }
  N(a2, "invalid usage");
}
function Nt(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_onetimeauth_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_onetimeauth_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function Lt(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "state_address");
  var n2 = K(t2 = O(_2, t2, "message_chunk")), s2 = t2.length;
  _2.push(n2), 0 | r._crypto_onetimeauth_update(e, n2, s2) && N(_2, "invalid usage"), M(_2);
}
function Ut(e, t2, a2) {
  var _2 = [];
  e = O(_2, e, "hash");
  var n2, s2 = 0 | r._crypto_onetimeauth_bytes();
  e.length !== s2 && L(_2, "invalid hash length"), n2 = K(e), _2.push(n2);
  var c2 = K(t2 = O(_2, t2, "message")), p2 = t2.length;
  _2.push(c2), a2 = O(_2, a2, "key");
  var o2, h2 = 0 | r._crypto_onetimeauth_keybytes();
  a2.length !== h2 && L(_2, "invalid key length"), o2 = K(a2), _2.push(o2);
  var y2 = !(0 | r._crypto_onetimeauth_verify(n2, c2, p2, 0, o2));
  return M(_2), y2;
}
function Ot(e, t2, a2, _2, n2, s2, c2) {
  var p2 = [];
  Y(c2), U(p2, e, "keyLength"), ("number" != typeof e || (0 | e) !== e || e < 0) && L(p2, "keyLength must be an unsigned integer");
  var o2 = K(t2 = O(p2, t2, "password")), h2 = t2.length;
  p2.push(o2), a2 = O(p2, a2, "salt");
  var y2, i2 = 0 | r._crypto_pwhash_saltbytes();
  a2.length !== i2 && L(p2, "invalid salt length"), y2 = K(a2), p2.push(y2), U(p2, _2, "opsLimit"), ("number" != typeof _2 || (0 | _2) !== _2 || _2 < 0) && L(p2, "opsLimit must be an unsigned integer"), U(p2, n2, "memLimit"), ("number" != typeof n2 || (0 | n2) !== n2 || n2 < 0) && L(p2, "memLimit must be an unsigned integer"), U(p2, s2, "algorithm"), ("number" != typeof s2 || (0 | s2) !== s2 || s2 < 0) && L(p2, "algorithm must be an unsigned integer");
  var l2 = new B(0 | e), u2 = l2.address;
  if (p2.push(u2), !(0 | r._crypto_pwhash(u2, e, 0, o2, h2, 0, y2, _2, 0, n2, s2))) {
    var d2 = S(l2, c2);
    return M(p2), d2;
  }
  N(p2, "invalid usage");
}
function Ct(e, t2, a2, _2, n2, s2) {
  var c2 = [];
  Y(s2), U(c2, e, "keyLength"), ("number" != typeof e || (0 | e) !== e || e < 0) && L(c2, "keyLength must be an unsigned integer");
  var p2 = K(t2 = O(c2, t2, "password")), o2 = t2.length;
  c2.push(p2), a2 = O(c2, a2, "salt");
  var h2, y2 = 0 | r._crypto_pwhash_scryptsalsa208sha256_saltbytes();
  a2.length !== y2 && L(c2, "invalid salt length"), h2 = K(a2), c2.push(h2), U(c2, _2, "opsLimit"), ("number" != typeof _2 || (0 | _2) !== _2 || _2 < 0) && L(c2, "opsLimit must be an unsigned integer"), U(c2, n2, "memLimit"), ("number" != typeof n2 || (0 | n2) !== n2 || n2 < 0) && L(c2, "memLimit must be an unsigned integer");
  var i2 = new B(0 | e), l2 = i2.address;
  if (c2.push(l2), !(0 | r._crypto_pwhash_scryptsalsa208sha256(l2, e, 0, p2, o2, 0, h2, _2, 0, n2))) {
    var u2 = S(i2, s2);
    return M(c2), u2;
  }
  N(c2, "invalid usage");
}
function Rt(e, t2, a2, _2, n2, s2, c2) {
  var p2 = [];
  Y(c2);
  var o2 = K(e = O(p2, e, "password")), h2 = e.length;
  p2.push(o2);
  var y2 = K(t2 = O(p2, t2, "salt")), i2 = t2.length;
  p2.push(y2), U(p2, a2, "opsLimit"), ("number" != typeof a2 || (0 | a2) !== a2 || a2 < 0) && L(p2, "opsLimit must be an unsigned integer"), U(p2, _2, "r"), ("number" != typeof _2 || (0 | _2) !== _2 || _2 < 0) && L(p2, "r must be an unsigned integer"), U(p2, n2, "p"), ("number" != typeof n2 || (0 | n2) !== n2 || n2 < 0) && L(p2, "p must be an unsigned integer"), U(p2, s2, "keyLength"), ("number" != typeof s2 || (0 | s2) !== s2 || s2 < 0) && L(p2, "keyLength must be an unsigned integer");
  var l2 = new B(0 | s2), u2 = l2.address;
  if (p2.push(u2), !(0 | r._crypto_pwhash_scryptsalsa208sha256_ll(o2, h2, y2, i2, a2, 0, _2, n2, u2, s2))) {
    var d2 = S(l2, c2);
    return M(p2), d2;
  }
  N(p2, "invalid usage");
}
function Pt(e, t2, a2, _2) {
  var n2 = [];
  Y(_2);
  var s2 = K(e = O(n2, e, "password")), c2 = e.length;
  n2.push(s2), U(n2, t2, "opsLimit"), ("number" != typeof t2 || (0 | t2) !== t2 || t2 < 0) && L(n2, "opsLimit must be an unsigned integer"), U(n2, a2, "memLimit"), ("number" != typeof a2 || (0 | a2) !== a2 || a2 < 0) && L(n2, "memLimit must be an unsigned integer");
  var p2 = new B(0 | r._crypto_pwhash_scryptsalsa208sha256_strbytes()).address;
  if (n2.push(p2), !(0 | r._crypto_pwhash_scryptsalsa208sha256_str(p2, s2, c2, 0, t2, 0, a2))) {
    var o2 = r.UTF8ToString(p2);
    return M(n2), o2;
  }
  N(n2, "invalid usage");
}
function Xt(e, t2, a2) {
  var _2 = [];
  Y(a2), "string" != typeof e && L(_2, "hashed_password must be a string");
  var n2 = K(e = v(e + "\0"));
  e.length, _2.push(n2);
  var s2 = K(t2 = O(_2, t2, "password")), c2 = t2.length;
  _2.push(s2);
  var p2 = !(0 | r._crypto_pwhash_scryptsalsa208sha256_str_verify(n2, s2, c2, 0));
  return M(_2), p2;
}
function Dt(e, t2, a2, _2) {
  var n2 = [];
  Y(_2);
  var s2 = K(e = O(n2, e, "password")), c2 = e.length;
  n2.push(s2), U(n2, t2, "opsLimit"), ("number" != typeof t2 || (0 | t2) !== t2 || t2 < 0) && L(n2, "opsLimit must be an unsigned integer"), U(n2, a2, "memLimit"), ("number" != typeof a2 || (0 | a2) !== a2 || a2 < 0) && L(n2, "memLimit must be an unsigned integer");
  var p2 = new B(0 | r._crypto_pwhash_strbytes()).address;
  if (n2.push(p2), !(0 | r._crypto_pwhash_str(p2, s2, c2, 0, t2, 0, a2))) {
    var o2 = r.UTF8ToString(p2);
    return M(n2), o2;
  }
  N(n2, "invalid usage");
}
function Gt(e, t2, a2, _2) {
  var n2 = [];
  Y(_2), "string" != typeof e && L(n2, "hashed_password must be a string");
  var s2 = K(e = v(e + "\0"));
  e.length, n2.push(s2), U(n2, t2, "opsLimit"), ("number" != typeof t2 || (0 | t2) !== t2 || t2 < 0) && L(n2, "opsLimit must be an unsigned integer"), U(n2, a2, "memLimit"), ("number" != typeof a2 || (0 | a2) !== a2 || a2 < 0) && L(n2, "memLimit must be an unsigned integer");
  var c2 = !!(0 | r._crypto_pwhash_str_needs_rehash(s2, t2, 0, a2));
  return M(n2), c2;
}
function Ft(e, t2, a2) {
  var _2 = [];
  Y(a2), "string" != typeof e && L(_2, "hashed_password must be a string");
  var n2 = K(e = v(e + "\0"));
  e.length, _2.push(n2);
  var s2 = K(t2 = O(_2, t2, "password")), c2 = t2.length;
  _2.push(s2);
  var p2 = !(0 | r._crypto_pwhash_str_verify(n2, s2, c2, 0));
  return M(_2), p2;
}
function Vt(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "privateKey");
  var n2, s2 = 0 | r._crypto_scalarmult_scalarbytes();
  e.length !== s2 && L(_2, "invalid privateKey length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "publicKey");
  var c2, p2 = 0 | r._crypto_scalarmult_bytes();
  t2.length !== p2 && L(_2, "invalid publicKey length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_scalarmult_bytes()), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_scalarmult(h2, n2, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "weak public key");
}
function qt(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "privateKey");
  var _2, n2 = 0 | r._crypto_scalarmult_scalarbytes();
  e.length !== n2 && L(a2, "invalid privateKey length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_scalarmult_bytes()), c2 = s2.address;
  if (a2.push(c2), !(0 | r._crypto_scalarmult_base(c2, _2))) {
    var p2 = S(s2, t2);
    return M(a2), p2;
  }
  N(a2, "unknown error");
}
function Ht(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "n");
  var n2, s2 = 0 | r._crypto_scalarmult_ed25519_scalarbytes();
  e.length !== s2 && L(_2, "invalid n length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "p");
  var c2, p2 = 0 | r._crypto_scalarmult_ed25519_bytes();
  t2.length !== p2 && L(_2, "invalid p length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_scalarmult_ed25519_bytes()), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_scalarmult_ed25519(h2, n2, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "invalid point or scalar is 0");
}
function zt(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "scalar");
  var _2, n2 = 0 | r._crypto_scalarmult_ed25519_scalarbytes();
  e.length !== n2 && L(a2, "invalid scalar length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_scalarmult_ed25519_bytes()), c2 = s2.address;
  if (a2.push(c2), !(0 | r._crypto_scalarmult_ed25519_base(c2, _2))) {
    var p2 = S(s2, t2);
    return M(a2), p2;
  }
  N(a2, "scalar is 0");
}
function Wt(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "scalar");
  var _2, n2 = 0 | r._crypto_scalarmult_ed25519_scalarbytes();
  e.length !== n2 && L(a2, "invalid scalar length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_scalarmult_ed25519_bytes()), c2 = s2.address;
  if (a2.push(c2), !(0 | r._crypto_scalarmult_ed25519_base_noclamp(c2, _2))) {
    var p2 = S(s2, t2);
    return M(a2), p2;
  }
  N(a2, "scalar is 0");
}
function jt(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "n");
  var n2, s2 = 0 | r._crypto_scalarmult_ed25519_scalarbytes();
  e.length !== s2 && L(_2, "invalid n length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "p");
  var c2, p2 = 0 | r._crypto_scalarmult_ed25519_bytes();
  t2.length !== p2 && L(_2, "invalid p length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_scalarmult_ed25519_bytes()), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_scalarmult_ed25519_noclamp(h2, n2, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "invalid point or scalar is 0");
}
function Jt(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "scalar");
  var n2, s2 = 0 | r._crypto_scalarmult_ristretto255_scalarbytes();
  e.length !== s2 && L(_2, "invalid scalar length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "element");
  var c2, p2 = 0 | r._crypto_scalarmult_ristretto255_bytes();
  t2.length !== p2 && L(_2, "invalid element length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_scalarmult_ristretto255_bytes()), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_scalarmult_ristretto255(h2, n2, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "result is identity element");
}
function Qt(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "scalar");
  var _2, n2 = 0 | r._crypto_core_ristretto255_scalarbytes();
  e.length !== n2 && L(a2, "invalid scalar length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_core_ristretto255_bytes()), c2 = s2.address;
  if (a2.push(c2), !(0 | r._crypto_scalarmult_ristretto255_base(c2, _2))) {
    var p2 = S(s2, t2);
    return M(a2), p2;
  }
  N(a2, "scalar is 0");
}
function Zt(e, t2, a2, _2) {
  var n2 = [];
  Y(_2);
  var s2 = K(e = O(n2, e, "message")), c2 = e.length;
  n2.push(s2), t2 = O(n2, t2, "nonce");
  var p2, o2 = 0 | r._crypto_secretbox_noncebytes();
  t2.length !== o2 && L(n2, "invalid nonce length"), p2 = K(t2), n2.push(p2), a2 = O(n2, a2, "key");
  var h2, y2 = 0 | r._crypto_secretbox_keybytes();
  a2.length !== y2 && L(n2, "invalid key length"), h2 = K(a2), n2.push(h2);
  var i2 = new B(0 | c2), l2 = i2.address;
  n2.push(l2);
  var u2 = new B(0 | r._crypto_secretbox_macbytes()), d2 = u2.address;
  if (n2.push(d2), !(0 | r._crypto_secretbox_detached(l2, d2, s2, c2, 0, p2, h2))) {
    var v2 = S({ mac: u2, cipher: i2 }, _2);
    return M(n2), v2;
  }
  N(n2, "invalid usage");
}
function $t(e, t2, a2, _2) {
  var n2 = [];
  Y(_2);
  var s2 = K(e = O(n2, e, "message")), c2 = e.length;
  n2.push(s2), t2 = O(n2, t2, "nonce");
  var p2, o2 = 0 | r._crypto_secretbox_noncebytes();
  t2.length !== o2 && L(n2, "invalid nonce length"), p2 = K(t2), n2.push(p2), a2 = O(n2, a2, "key");
  var h2, y2 = 0 | r._crypto_secretbox_keybytes();
  a2.length !== y2 && L(n2, "invalid key length"), h2 = K(a2), n2.push(h2);
  var i2 = new B(c2 + r._crypto_secretbox_macbytes() | 0), l2 = i2.address;
  if (n2.push(l2), !(0 | r._crypto_secretbox_easy(l2, s2, c2, 0, p2, h2))) {
    var u2 = S(i2, _2);
    return M(n2), u2;
  }
  N(n2, "invalid usage");
}
function ea(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_secretbox_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_secretbox_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function ra(e, t2, a2, _2, n2) {
  var s2 = [];
  Y(n2);
  var c2 = K(e = O(s2, e, "ciphertext")), p2 = e.length;
  s2.push(c2), t2 = O(s2, t2, "mac");
  var o2, h2 = 0 | r._crypto_secretbox_macbytes();
  t2.length !== h2 && L(s2, "invalid mac length"), o2 = K(t2), s2.push(o2), a2 = O(s2, a2, "nonce");
  var y2, i2 = 0 | r._crypto_secretbox_noncebytes();
  a2.length !== i2 && L(s2, "invalid nonce length"), y2 = K(a2), s2.push(y2), _2 = O(s2, _2, "key");
  var l2, u2 = 0 | r._crypto_secretbox_keybytes();
  _2.length !== u2 && L(s2, "invalid key length"), l2 = K(_2), s2.push(l2);
  var d2 = new B(0 | p2), v2 = d2.address;
  if (s2.push(v2), !(0 | r._crypto_secretbox_open_detached(v2, c2, o2, p2, 0, y2, l2))) {
    var g2 = S(d2, n2);
    return M(s2), g2;
  }
  N(s2, "wrong secret key for the given ciphertext");
}
function ta(e, t2, a2, _2) {
  var n2 = [];
  Y(_2), e = O(n2, e, "ciphertext");
  var s2, c2 = r._crypto_secretbox_macbytes(), p2 = e.length;
  p2 < c2 && L(n2, "ciphertext is too short"), s2 = K(e), n2.push(s2), t2 = O(n2, t2, "nonce");
  var o2, h2 = 0 | r._crypto_secretbox_noncebytes();
  t2.length !== h2 && L(n2, "invalid nonce length"), o2 = K(t2), n2.push(o2), a2 = O(n2, a2, "key");
  var y2, i2 = 0 | r._crypto_secretbox_keybytes();
  a2.length !== i2 && L(n2, "invalid key length"), y2 = K(a2), n2.push(y2);
  var l2 = new B(p2 - r._crypto_secretbox_macbytes() | 0), u2 = l2.address;
  if (n2.push(u2), !(0 | r._crypto_secretbox_open_easy(u2, s2, p2, 0, o2, y2))) {
    var d2 = S(l2, _2);
    return M(n2), d2;
  }
  N(n2, "wrong secret key for the given ciphertext");
}
function aa(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "header");
  var n2, s2 = 0 | r._crypto_secretstream_xchacha20poly1305_headerbytes();
  e.length !== s2 && L(_2, "invalid header length"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "key");
  var c2, p2 = 0 | r._crypto_secretstream_xchacha20poly1305_keybytes();
  t2.length !== p2 && L(_2, "invalid key length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(52).address;
  if (!(0 | r._crypto_secretstream_xchacha20poly1305_init_pull(o2, n2, c2))) {
    var h2 = o2;
    return M(_2), h2;
  }
  N(_2, "invalid usage");
}
function _a(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "key");
  var _2, n2 = 0 | r._crypto_secretstream_xchacha20poly1305_keybytes();
  e.length !== n2 && L(a2, "invalid key length"), _2 = K(e), a2.push(_2);
  var s2 = new B(52).address, c2 = new B(0 | r._crypto_secretstream_xchacha20poly1305_headerbytes()), p2 = c2.address;
  if (a2.push(p2), !(0 | r._crypto_secretstream_xchacha20poly1305_init_push(s2, p2, _2))) {
    var o2 = { state: s2, header: S(c2, t2) };
    return M(a2), o2;
  }
  N(a2, "invalid usage");
}
function na(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_secretstream_xchacha20poly1305_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_secretstream_xchacha20poly1305_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function sa(e, t2, a2, _2) {
  var n2 = [];
  Y(_2), U(n2, e, "state_address"), t2 = O(n2, t2, "cipher");
  var s2, c2 = r._crypto_secretstream_xchacha20poly1305_abytes(), p2 = t2.length;
  p2 < c2 && L(n2, "cipher is too short"), s2 = K(t2), n2.push(s2);
  var o2 = null, h2 = 0;
  null != a2 && (o2 = K(a2 = O(n2, a2, "ad")), h2 = a2.length, n2.push(o2));
  var y2 = new B(p2 - r._crypto_secretstream_xchacha20poly1305_abytes() | 0), i2 = y2.address;
  n2.push(i2);
  var l2, u2 = (l2 = A2(1), n2.push(l2), (u2 = 0 === r._crypto_secretstream_xchacha20poly1305_pull(e, i2, 0, l2, s2, p2, 0, o2, h2) && { tag: r.HEAPU8[l2], message: y2 }) && { message: S(u2.message, _2), tag: u2.tag });
  return M(n2), u2;
}
function ca(e, t2, a2, _2, n2) {
  var s2 = [];
  Y(n2), U(s2, e, "state_address");
  var c2 = K(t2 = O(s2, t2, "message_chunk")), p2 = t2.length;
  s2.push(c2);
  var o2 = null, h2 = 0;
  null != a2 && (o2 = K(a2 = O(s2, a2, "ad")), h2 = a2.length, s2.push(o2)), U(s2, _2, "tag"), ("number" != typeof _2 || (0 | _2) !== _2 || _2 < 0) && L(s2, "tag must be an unsigned integer");
  var y2 = new B(p2 + r._crypto_secretstream_xchacha20poly1305_abytes() | 0), i2 = y2.address;
  if (s2.push(i2), !(0 | r._crypto_secretstream_xchacha20poly1305_push(e, i2, 0, c2, p2, 0, o2, h2, 0, _2))) {
    var l2 = S(y2, n2);
    return M(s2), l2;
  }
  N(s2, "invalid usage");
}
function pa(e, t2) {
  var a2 = [];
  return Y(t2), U(a2, e, "state_address"), r._crypto_secretstream_xchacha20poly1305_rekey(e), M(a2), true;
}
function oa(e, t2, a2) {
  var _2 = [];
  Y(a2);
  var n2 = K(e = O(_2, e, "message")), s2 = e.length;
  _2.push(n2), t2 = O(_2, t2, "key");
  var c2, p2 = 0 | r._crypto_shorthash_keybytes();
  t2.length !== p2 && L(_2, "invalid key length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_shorthash_bytes()), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_shorthash(h2, n2, s2, 0, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "invalid usage");
}
function ha(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_shorthash_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_shorthash_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function ya(e, t2, a2) {
  var _2 = [];
  Y(a2);
  var n2 = K(e = O(_2, e, "message")), s2 = e.length;
  _2.push(n2), t2 = O(_2, t2, "key");
  var c2, p2 = 0 | r._crypto_shorthash_siphashx24_keybytes();
  t2.length !== p2 && L(_2, "invalid key length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_shorthash_siphashx24_bytes()), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_shorthash_siphashx24(h2, n2, s2, 0, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "invalid usage");
}
function ia(e, t2, a2) {
  var _2 = [];
  Y(a2);
  var n2 = K(e = O(_2, e, "message")), s2 = e.length;
  _2.push(n2), t2 = O(_2, t2, "privateKey");
  var c2, p2 = 0 | r._crypto_sign_secretkeybytes();
  t2.length !== p2 && L(_2, "invalid privateKey length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(e.length + r._crypto_sign_bytes() | 0), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_sign(h2, null, n2, s2, 0, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "invalid usage");
}
function la(e, t2, a2) {
  var _2 = [];
  Y(a2);
  var n2 = K(e = O(_2, e, "message")), s2 = e.length;
  _2.push(n2), t2 = O(_2, t2, "privateKey");
  var c2, p2 = 0 | r._crypto_sign_secretkeybytes();
  t2.length !== p2 && L(_2, "invalid privateKey length"), c2 = K(t2), _2.push(c2);
  var o2 = new B(0 | r._crypto_sign_bytes()), h2 = o2.address;
  if (_2.push(h2), !(0 | r._crypto_sign_detached(h2, null, n2, s2, 0, c2))) {
    var y2 = S(o2, a2);
    return M(_2), y2;
  }
  N(_2, "invalid usage");
}
function ua(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "edPk");
  var _2, n2 = 0 | r._crypto_sign_publickeybytes();
  e.length !== n2 && L(a2, "invalid edPk length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_scalarmult_scalarbytes()), c2 = s2.address;
  if (a2.push(c2), !(0 | r._crypto_sign_ed25519_pk_to_curve25519(c2, _2))) {
    var p2 = S(s2, t2);
    return M(a2), p2;
  }
  N(a2, "invalid key");
}
function da(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "edSk");
  var _2, n2 = 0 | r._crypto_sign_secretkeybytes();
  e.length !== n2 && L(a2, "invalid edSk length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_scalarmult_scalarbytes()), c2 = s2.address;
  if (a2.push(c2), !(0 | r._crypto_sign_ed25519_sk_to_curve25519(c2, _2))) {
    var p2 = S(s2, t2);
    return M(a2), p2;
  }
  N(a2, "invalid key");
}
function va(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "privateKey");
  var _2, n2 = 0 | r._crypto_sign_secretkeybytes();
  e.length !== n2 && L(a2, "invalid privateKey length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_sign_publickeybytes()), c2 = s2.address;
  if (a2.push(c2), !(0 | r._crypto_sign_ed25519_sk_to_pk(c2, _2))) {
    var p2 = S(s2, t2);
    return M(a2), p2;
  }
  N(a2, "invalid key");
}
function ga(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "privateKey");
  var _2, n2 = 0 | r._crypto_sign_secretkeybytes();
  e.length !== n2 && L(a2, "invalid privateKey length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_sign_seedbytes()), c2 = s2.address;
  if (a2.push(c2), !(0 | r._crypto_sign_ed25519_sk_to_seed(c2, _2))) {
    var p2 = S(s2, t2);
    return M(a2), p2;
  }
  N(a2, "invalid key");
}
function ba(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "state_address"), t2 = O(_2, t2, "privateKey");
  var n2, s2 = 0 | r._crypto_sign_secretkeybytes();
  t2.length !== s2 && L(_2, "invalid privateKey length"), n2 = K(t2), _2.push(n2);
  var c2 = new B(0 | r._crypto_sign_bytes()), p2 = c2.address;
  if (_2.push(p2), !(0 | r._crypto_sign_final_create(e, p2, null, n2))) {
    var o2 = (r._free(e), S(c2, a2));
    return M(_2), o2;
  }
  N(_2, "invalid usage");
}
function fa(e, t2, a2, _2) {
  var n2 = [];
  Y(_2), U(n2, e, "state_address"), t2 = O(n2, t2, "signature");
  var s2, c2 = 0 | r._crypto_sign_bytes();
  t2.length !== c2 && L(n2, "invalid signature length"), s2 = K(t2), n2.push(s2), a2 = O(n2, a2, "publicKey");
  var p2, o2 = 0 | r._crypto_sign_publickeybytes();
  a2.length !== o2 && L(n2, "invalid publicKey length"), p2 = K(a2), n2.push(p2);
  var h2 = !(0 | r._crypto_sign_final_verify(e, s2, p2));
  return M(n2), h2;
}
function ma(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(208).address;
  if (!(0 | r._crypto_sign_init(a2))) {
    var _2 = a2;
    return M(t2), _2;
  }
  N(t2, "internal error");
}
function ka(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_sign_publickeybytes()), _2 = a2.address;
  t2.push(_2);
  var n2 = new B(0 | r._crypto_sign_secretkeybytes()), s2 = n2.address;
  if (t2.push(s2), !(0 | r._crypto_sign_keypair(_2, s2))) {
    var c2 = { publicKey: S(a2, e), privateKey: S(n2, e), keyType: "ed25519" };
    return M(t2), c2;
  }
  N(t2, "internal error");
}
function xa(e, t2, a2) {
  var _2 = [];
  Y(a2), e = O(_2, e, "signedMessage");
  var n2, s2 = r._crypto_sign_bytes(), c2 = e.length;
  c2 < s2 && L(_2, "signedMessage is too short"), n2 = K(e), _2.push(n2), t2 = O(_2, t2, "publicKey");
  var p2, o2 = 0 | r._crypto_sign_publickeybytes();
  t2.length !== o2 && L(_2, "invalid publicKey length"), p2 = K(t2), _2.push(p2);
  var h2 = new B(c2 - r._crypto_sign_bytes() | 0), y2 = h2.address;
  if (_2.push(y2), !(0 | r._crypto_sign_open(y2, null, n2, c2, 0, p2))) {
    var i2 = S(h2, a2);
    return M(_2), i2;
  }
  N(_2, "incorrect signature for the given public key");
}
function Ea(e, t2) {
  var a2 = [];
  Y(t2), e = O(a2, e, "seed");
  var _2, n2 = 0 | r._crypto_sign_seedbytes();
  e.length !== n2 && L(a2, "invalid seed length"), _2 = K(e), a2.push(_2);
  var s2 = new B(0 | r._crypto_sign_publickeybytes()), c2 = s2.address;
  a2.push(c2);
  var p2 = new B(0 | r._crypto_sign_secretkeybytes()), o2 = p2.address;
  if (a2.push(o2), !(0 | r._crypto_sign_seed_keypair(c2, o2, _2))) {
    var h2 = { publicKey: S(s2, t2), privateKey: S(p2, t2), keyType: "ed25519" };
    return M(a2), h2;
  }
  N(a2, "invalid usage");
}
function Ta(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "state_address");
  var n2 = K(t2 = O(_2, t2, "message_chunk")), s2 = t2.length;
  _2.push(n2), 0 | r._crypto_sign_update(e, n2, s2, 0) && N(_2, "invalid usage"), M(_2);
}
function Sa(e, t2, a2) {
  var _2 = [];
  e = O(_2, e, "signature");
  var n2, s2 = 0 | r._crypto_sign_bytes();
  e.length !== s2 && L(_2, "invalid signature length"), n2 = K(e), _2.push(n2);
  var c2 = K(t2 = O(_2, t2, "message")), p2 = t2.length;
  _2.push(c2), a2 = O(_2, a2, "publicKey");
  var o2, h2 = 0 | r._crypto_sign_publickeybytes();
  a2.length !== h2 && L(_2, "invalid publicKey length"), o2 = K(a2), _2.push(o2);
  var y2 = !(0 | r._crypto_sign_verify_detached(n2, c2, p2, 0, o2));
  return M(_2), y2;
}
function wa(e, t2, a2, _2) {
  var n2 = [];
  Y(_2), U(n2, e, "outLength"), ("number" != typeof e || (0 | e) !== e || e < 0) && L(n2, "outLength must be an unsigned integer"), t2 = O(n2, t2, "key");
  var s2, c2 = 0 | r._crypto_stream_chacha20_keybytes();
  t2.length !== c2 && L(n2, "invalid key length"), s2 = K(t2), n2.push(s2), a2 = O(n2, a2, "nonce");
  var p2, o2 = 0 | r._crypto_stream_chacha20_noncebytes();
  a2.length !== o2 && L(n2, "invalid nonce length"), p2 = K(a2), n2.push(p2);
  var h2 = new B(0 | e), y2 = h2.address;
  n2.push(y2), r._crypto_stream_chacha20(y2, e, 0, p2, s2);
  var i2 = S(h2, _2);
  return M(n2), i2;
}
function Ya(e, t2, a2, _2) {
  var n2 = [];
  Y(_2);
  var s2 = K(e = O(n2, e, "input_message")), c2 = e.length;
  n2.push(s2), t2 = O(n2, t2, "nonce");
  var p2, o2 = 0 | r._crypto_stream_chacha20_ietf_noncebytes();
  t2.length !== o2 && L(n2, "invalid nonce length"), p2 = K(t2), n2.push(p2), a2 = O(n2, a2, "key");
  var h2, y2 = 0 | r._crypto_stream_chacha20_ietf_keybytes();
  a2.length !== y2 && L(n2, "invalid key length"), h2 = K(a2), n2.push(h2);
  var i2 = new B(0 | c2), l2 = i2.address;
  if (n2.push(l2), 0 === r._crypto_stream_chacha20_ietf_xor(l2, s2, c2, 0, p2, h2)) {
    var u2 = S(i2, _2);
    return M(n2), u2;
  }
  N(n2, "invalid usage");
}
function Ba(e, t2, a2, _2, n2) {
  var s2 = [];
  Y(n2);
  var c2 = K(e = O(s2, e, "input_message")), p2 = e.length;
  s2.push(c2), t2 = O(s2, t2, "nonce");
  var o2, h2 = 0 | r._crypto_stream_chacha20_ietf_noncebytes();
  t2.length !== h2 && L(s2, "invalid nonce length"), o2 = K(t2), s2.push(o2), U(s2, a2, "nonce_increment"), ("number" != typeof a2 || (0 | a2) !== a2 || a2 < 0) && L(s2, "nonce_increment must be an unsigned integer"), _2 = O(s2, _2, "key");
  var y2, i2 = 0 | r._crypto_stream_chacha20_ietf_keybytes();
  _2.length !== i2 && L(s2, "invalid key length"), y2 = K(_2), s2.push(y2);
  var l2 = new B(0 | p2), u2 = l2.address;
  if (s2.push(u2), 0 === r._crypto_stream_chacha20_ietf_xor_ic(u2, c2, p2, 0, o2, a2, y2)) {
    var d2 = S(l2, n2);
    return M(s2), d2;
  }
  N(s2, "invalid usage");
}
function Ka(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_stream_chacha20_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_stream_chacha20_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function Aa(e, t2, a2, _2) {
  var n2 = [];
  Y(_2);
  var s2 = K(e = O(n2, e, "input_message")), c2 = e.length;
  n2.push(s2), t2 = O(n2, t2, "nonce");
  var p2, o2 = 0 | r._crypto_stream_chacha20_noncebytes();
  t2.length !== o2 && L(n2, "invalid nonce length"), p2 = K(t2), n2.push(p2), a2 = O(n2, a2, "key");
  var h2, y2 = 0 | r._crypto_stream_chacha20_keybytes();
  a2.length !== y2 && L(n2, "invalid key length"), h2 = K(a2), n2.push(h2);
  var i2 = new B(0 | c2), l2 = i2.address;
  if (n2.push(l2), 0 === r._crypto_stream_chacha20_xor(l2, s2, c2, 0, p2, h2)) {
    var u2 = S(i2, _2);
    return M(n2), u2;
  }
  N(n2, "invalid usage");
}
function Ia(e, t2, a2, _2, n2) {
  var s2 = [];
  Y(n2);
  var c2 = K(e = O(s2, e, "input_message")), p2 = e.length;
  s2.push(c2), t2 = O(s2, t2, "nonce");
  var o2, h2 = 0 | r._crypto_stream_chacha20_noncebytes();
  t2.length !== h2 && L(s2, "invalid nonce length"), o2 = K(t2), s2.push(o2), U(s2, a2, "nonce_increment"), ("number" != typeof a2 || (0 | a2) !== a2 || a2 < 0) && L(s2, "nonce_increment must be an unsigned integer"), _2 = O(s2, _2, "key");
  var y2, i2 = 0 | r._crypto_stream_chacha20_keybytes();
  _2.length !== i2 && L(s2, "invalid key length"), y2 = K(_2), s2.push(y2);
  var l2 = new B(0 | p2), u2 = l2.address;
  if (s2.push(u2), 0 === r._crypto_stream_chacha20_xor_ic(u2, c2, p2, 0, o2, a2, 0, y2)) {
    var d2 = S(l2, n2);
    return M(s2), d2;
  }
  N(s2, "invalid usage");
}
function Ma(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_stream_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_stream_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function Na(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(0 | r._crypto_stream_xchacha20_keybytes()), _2 = a2.address;
  t2.push(_2), r._crypto_stream_xchacha20_keygen(_2);
  var n2 = S(a2, e);
  return M(t2), n2;
}
function La(e, t2, a2, _2) {
  var n2 = [];
  Y(_2);
  var s2 = K(e = O(n2, e, "input_message")), c2 = e.length;
  n2.push(s2), t2 = O(n2, t2, "nonce");
  var p2, o2 = 0 | r._crypto_stream_xchacha20_noncebytes();
  t2.length !== o2 && L(n2, "invalid nonce length"), p2 = K(t2), n2.push(p2), a2 = O(n2, a2, "key");
  var h2, y2 = 0 | r._crypto_stream_xchacha20_keybytes();
  a2.length !== y2 && L(n2, "invalid key length"), h2 = K(a2), n2.push(h2);
  var i2 = new B(0 | c2), l2 = i2.address;
  if (n2.push(l2), 0 === r._crypto_stream_xchacha20_xor(l2, s2, c2, 0, p2, h2)) {
    var u2 = S(i2, _2);
    return M(n2), u2;
  }
  N(n2, "invalid usage");
}
function Ua(e, t2, a2, _2, n2) {
  var s2 = [];
  Y(n2);
  var c2 = K(e = O(s2, e, "input_message")), p2 = e.length;
  s2.push(c2), t2 = O(s2, t2, "nonce");
  var o2, h2 = 0 | r._crypto_stream_xchacha20_noncebytes();
  t2.length !== h2 && L(s2, "invalid nonce length"), o2 = K(t2), s2.push(o2), U(s2, a2, "nonce_increment"), ("number" != typeof a2 || (0 | a2) !== a2 || a2 < 0) && L(s2, "nonce_increment must be an unsigned integer"), _2 = O(s2, _2, "key");
  var y2, i2 = 0 | r._crypto_stream_xchacha20_keybytes();
  _2.length !== i2 && L(s2, "invalid key length"), y2 = K(_2), s2.push(y2);
  var l2 = new B(0 | p2), u2 = l2.address;
  if (s2.push(u2), 0 === r._crypto_stream_xchacha20_xor_ic(u2, c2, p2, 0, o2, a2, 0, y2)) {
    var d2 = S(l2, n2);
    return M(s2), d2;
  }
  N(s2, "invalid usage");
}
function Oa(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "out_length"), ("number" != typeof e || (0 | e) !== e || e < 0) && L(_2, "out_length must be an unsigned integer");
  var n2 = K(t2 = O(_2, t2, "message")), s2 = t2.length;
  _2.push(n2);
  var c2 = new B(e |= 0), p2 = c2.address;
  if (_2.push(p2), !(0 | r._crypto_xof_shake128(p2, e, n2, s2, 0))) {
    var o2 = S(c2, a2);
    return M(_2), o2;
  }
  N(_2, "invalid usage");
}
function Ca(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(256).address;
  if (!(0 | r._crypto_xof_shake128_init(a2))) {
    var _2 = a2;
    return M(t2), _2;
  }
  N(t2, "invalid usage");
}
function Ra(e, t2) {
  var a2 = [];
  Y(t2), U(a2, e, "domain"), ("number" != typeof e || (0 | e) !== e || e < 0) && L(a2, "domain must be an unsigned integer");
  var _2 = new B(256).address;
  if (!(0 | r._crypto_xof_shake128_init_with_domain(_2, e))) {
    var n2 = _2;
    return M(a2), n2;
  }
  N(a2, "invalid usage");
}
function Pa(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "state_address"), U(_2, t2, "out_length"), ("number" != typeof t2 || (0 | t2) !== t2 || t2 < 0) && L(_2, "out_length must be an unsigned integer");
  var n2 = new B(t2 |= 0), s2 = n2.address;
  if (_2.push(s2), !(0 | r._crypto_xof_shake128_squeeze(e, s2, t2))) {
    var c2 = S(n2, a2);
    return M(_2), c2;
  }
  N(_2, "invalid usage");
}
function Xa(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "state_address");
  var n2 = K(t2 = O(_2, t2, "message_chunk")), s2 = t2.length;
  _2.push(n2), 0 | r._crypto_xof_shake128_update(e, n2, s2, 0) && N(_2, "invalid usage"), M(_2);
}
function Da(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "out_length"), ("number" != typeof e || (0 | e) !== e || e < 0) && L(_2, "out_length must be an unsigned integer");
  var n2 = K(t2 = O(_2, t2, "message")), s2 = t2.length;
  _2.push(n2);
  var c2 = new B(e |= 0), p2 = c2.address;
  if (_2.push(p2), !(0 | r._crypto_xof_shake256(p2, e, n2, s2, 0))) {
    var o2 = S(c2, a2);
    return M(_2), o2;
  }
  N(_2, "invalid usage");
}
function Ga(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(256).address;
  if (!(0 | r._crypto_xof_shake256_init(a2))) {
    var _2 = a2;
    return M(t2), _2;
  }
  N(t2, "invalid usage");
}
function Fa(e, t2) {
  var a2 = [];
  Y(t2), U(a2, e, "domain"), ("number" != typeof e || (0 | e) !== e || e < 0) && L(a2, "domain must be an unsigned integer");
  var _2 = new B(256).address;
  if (!(0 | r._crypto_xof_shake256_init_with_domain(_2, e))) {
    var n2 = _2;
    return M(a2), n2;
  }
  N(a2, "invalid usage");
}
function Va(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "state_address"), U(_2, t2, "out_length"), ("number" != typeof t2 || (0 | t2) !== t2 || t2 < 0) && L(_2, "out_length must be an unsigned integer");
  var n2 = new B(t2 |= 0), s2 = n2.address;
  if (_2.push(s2), !(0 | r._crypto_xof_shake256_squeeze(e, s2, t2))) {
    var c2 = S(n2, a2);
    return M(_2), c2;
  }
  N(_2, "invalid usage");
}
function qa(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "state_address");
  var n2 = K(t2 = O(_2, t2, "message_chunk")), s2 = t2.length;
  _2.push(n2), 0 | r._crypto_xof_shake256_update(e, n2, s2, 0) && N(_2, "invalid usage"), M(_2);
}
function Ha(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "out_length"), ("number" != typeof e || (0 | e) !== e || e < 0) && L(_2, "out_length must be an unsigned integer");
  var n2 = K(t2 = O(_2, t2, "message")), s2 = t2.length;
  _2.push(n2);
  var c2 = new B(e |= 0), p2 = c2.address;
  if (_2.push(p2), !(0 | r._crypto_xof_turboshake128(p2, e, n2, s2, 0))) {
    var o2 = S(c2, a2);
    return M(_2), o2;
  }
  N(_2, "invalid usage");
}
function za(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(256).address;
  if (!(0 | r._crypto_xof_turboshake128_init(a2))) {
    var _2 = a2;
    return M(t2), _2;
  }
  N(t2, "invalid usage");
}
function Wa(e, t2) {
  var a2 = [];
  Y(t2), U(a2, e, "domain"), ("number" != typeof e || (0 | e) !== e || e < 0) && L(a2, "domain must be an unsigned integer");
  var _2 = new B(256).address;
  if (!(0 | r._crypto_xof_turboshake128_init_with_domain(_2, e))) {
    var n2 = _2;
    return M(a2), n2;
  }
  N(a2, "invalid usage");
}
function ja(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "state_address"), U(_2, t2, "out_length"), ("number" != typeof t2 || (0 | t2) !== t2 || t2 < 0) && L(_2, "out_length must be an unsigned integer");
  var n2 = new B(t2 |= 0), s2 = n2.address;
  if (_2.push(s2), !(0 | r._crypto_xof_turboshake128_squeeze(e, s2, t2))) {
    var c2 = S(n2, a2);
    return M(_2), c2;
  }
  N(_2, "invalid usage");
}
function Ja(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "state_address");
  var n2 = K(t2 = O(_2, t2, "message_chunk")), s2 = t2.length;
  _2.push(n2), 0 | r._crypto_xof_turboshake128_update(e, n2, s2, 0) && N(_2, "invalid usage"), M(_2);
}
function Qa(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "out_length"), ("number" != typeof e || (0 | e) !== e || e < 0) && L(_2, "out_length must be an unsigned integer");
  var n2 = K(t2 = O(_2, t2, "message")), s2 = t2.length;
  _2.push(n2);
  var c2 = new B(e |= 0), p2 = c2.address;
  if (_2.push(p2), !(0 | r._crypto_xof_turboshake256(p2, e, n2, s2, 0))) {
    var o2 = S(c2, a2);
    return M(_2), o2;
  }
  N(_2, "invalid usage");
}
function Za(e) {
  var t2 = [];
  Y(e);
  var a2 = new B(256).address;
  if (!(0 | r._crypto_xof_turboshake256_init(a2))) {
    var _2 = a2;
    return M(t2), _2;
  }
  N(t2, "invalid usage");
}
function $a(e, t2) {
  var a2 = [];
  Y(t2), U(a2, e, "domain"), ("number" != typeof e || (0 | e) !== e || e < 0) && L(a2, "domain must be an unsigned integer");
  var _2 = new B(256).address;
  if (!(0 | r._crypto_xof_turboshake256_init_with_domain(_2, e))) {
    var n2 = _2;
    return M(a2), n2;
  }
  N(a2, "invalid usage");
}
function e_(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "state_address"), U(_2, t2, "out_length"), ("number" != typeof t2 || (0 | t2) !== t2 || t2 < 0) && L(_2, "out_length must be an unsigned integer");
  var n2 = new B(t2 |= 0), s2 = n2.address;
  if (_2.push(s2), !(0 | r._crypto_xof_turboshake256_squeeze(e, s2, t2))) {
    var c2 = S(n2, a2);
    return M(_2), c2;
  }
  N(_2, "invalid usage");
}
function r_(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "state_address");
  var n2 = K(t2 = O(_2, t2, "message_chunk")), s2 = t2.length;
  _2.push(n2), 0 | r._crypto_xof_turboshake256_update(e, n2, s2, 0) && N(_2, "invalid usage"), M(_2);
}
function t_(e, t2) {
  var a2 = [];
  Y(t2), U(a2, e, "length"), ("number" != typeof e || (0 | e) !== e || e < 0) && L(a2, "length must be an unsigned integer");
  var _2 = new B(0 | e), n2 = _2.address;
  a2.push(n2), r._randombytes_buf(n2, e);
  var s2 = S(_2, t2);
  return M(a2), s2;
}
function a_(e, t2, a2) {
  var _2 = [];
  Y(a2), U(_2, e, "length"), ("number" != typeof e || (0 | e) !== e || e < 0) && L(_2, "length must be an unsigned integer"), t2 = O(_2, t2, "seed");
  var n2, s2 = 0 | r._randombytes_seedbytes();
  t2.length !== s2 && L(_2, "invalid seed length"), n2 = K(t2), _2.push(n2);
  var c2 = new B(0 | e), p2 = c2.address;
  _2.push(p2), r._randombytes_buf_deterministic(p2, e, n2);
  var o2 = S(c2, a2);
  return M(_2), o2;
}
function __(e) {
  Y(e), r._randombytes_close();
}
function n_(e) {
  Y(e);
  var t2 = r._randombytes_random() >>> 0;
  return M([]), t2;
}
function s_(e, t2) {
  var a2 = [];
  Y(t2);
  for (var _2 = r._malloc(24), n2 = 0; n2 < 6; n2++) r.setValue(_2 + 4 * n2, r.Runtime.addFunction(e[["implementation_name", "random", "stir", "uniform", "buf", "close"][n2]]), "i32");
  0 | r._randombytes_set_implementation(_2) && N(a2, "unsupported implementation"), M(a2);
}
function c_(e) {
  Y(e), r._randombytes_stir();
}
function p_(e, t2) {
  var a2 = [];
  Y(t2), U(a2, e, "upper_bound"), ("number" != typeof e || (0 | e) !== e || e < 0) && L(a2, "upper_bound must be an unsigned integer");
  var _2 = r._randombytes_uniform(e) >>> 0;
  return M(a2), _2;
}
function o_(e) {
  var t2, a2 = [];
  16 !== (e = O(a2, e, "bin")).length && L(a2, "invalid bin length"), t2 = K(e), a2.push(t2);
  var _2 = new B(46).address;
  if (a2.push(_2), 0 !== r._sodium_bin2ip(_2, 46, t2)) {
    var n2 = r.UTF8ToString(_2);
    return M(a2), n2;
  }
  N(a2, "conversion failed");
}
function h_(e, t2) {
  var a2 = [];
  Y(t2), "string" != typeof e && L(a2, "ip must be a string");
  var _2 = K(e = v(e + "\0")), n2 = e.length - 1;
  a2.push(_2);
  var s2 = new B(16), c2 = s2.address;
  if (a2.push(c2), !(0 | r._sodium_ip2bin(c2, _2, n2))) {
    var p2 = S(s2, t2);
    return M(a2), p2;
  }
  N(a2, "invalid IP address");
}
function y_() {
  var e = r._sodium_version_string(), t2 = r.UTF8ToString(e);
  return M([]), t2;
}
B.prototype.to_Uint8Array = function() {
  var e = new Uint8Array(this.length);
  return e.set(r.HEAPU8.subarray(this.address, this.address + this.length)), e;
}, t.add = o, t.base64_variants = m, t.compare = l, t.from_base64 = x, t.from_hex = b, t.from_string = v, t.increment = p, t.is_zero = h, t.memcmp = i, t.memzero = y, t.output_formats = T, t.pad = u, t.unpad = d, t.ready = s, t.symbols = c, t.to_base64 = E, t.to_hex = f, t.to_string = g;
var libsodium_wrappers_default = t;

// packet-core/src/files.mjs
function checkKey(key2) {
  insist(key2 instanceof Uint8Array && key2.length === 32, "content-key");
}
function cancelled(signal) {
  if (signal?.aborted) throw new Error("operation-cancelled");
}
function hashHex(state) {
  return libsodium_wrappers_default.to_hex(libsodium_wrappers_default.crypto_hash_sha256_final(state));
}
async function decryptObject(blob, key2, descriptor, object, writer, { signal, authorize = () => {
} } = {}) {
  await libsodium_wrappers_default.ready;
  checkKey(key2);
  insist(writer && ["write", "commit", "abort"].every((k2) => typeof writer[k2] === "function"), "transactional-writer-required");
  let hash2;
  let plainHash;
  try {
    insist(blob instanceof Blob && blob.size === object.ciphertext_bytes && blob.size === ciphertextSize(object.plaintext_bytes), "ciphertext-size");
    insist(object.plaintext_bytes > 0 && object.plaintext_bytes <= (object.kind === "packet" ? LIMITS.packet : LIMITS.asset), "plaintext-limit");
    cancelled(signal);
    authorize();
    const header = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
    const state = libsodium_wrappers_default.crypto_secretstream_xchacha20poly1305_init_pull(header, key2);
    insist(state !== false, "ciphertext-header");
    hash2 = libsodium_wrappers_default.crypto_hash_sha256_init();
    plainHash = libsodium_wrappers_default.crypto_hash_sha256_init();
    libsodium_wrappers_default.crypto_hash_sha256_update(hash2, header);
    const aad = objectAAD(descriptor, object);
    let offset = 24;
    for (let position = 0; position < object.plaintext_bytes; position += CHUNK) {
      cancelled(signal);
      authorize();
      const length = Math.min(CHUNK, object.plaintext_bytes - position);
      const encrypted = new Uint8Array(await blob.slice(offset, offset + length + 17).arrayBuffer());
      cancelled(signal);
      authorize();
      libsodium_wrappers_default.crypto_hash_sha256_update(hash2, encrypted);
      const result = libsodium_wrappers_default.crypto_secretstream_xchacha20poly1305_pull(state, encrypted, aad);
      insist(result !== false, "ciphertext-authentication");
      try {
        const final = position + length === object.plaintext_bytes;
        insist(result.message.length === length && result.tag === (final ? libsodium_wrappers_default.crypto_secretstream_xchacha20poly1305_TAG_FINAL : libsodium_wrappers_default.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE), "ciphertext-framing");
        libsodium_wrappers_default.crypto_hash_sha256_update(plainHash, result.message);
        await writer.write(result.message);
      } finally {
        libsodium_wrappers_default.memzero(result.message);
      }
      offset += length + 17;
    }
    insist(offset === blob.size && hashHex(hash2) === object.ciphertext_sha256, "ciphertext-digest");
    const sha256 = hashHex(plainHash);
    cancelled(signal);
    authorize();
    await writer.commit({ sha256, bytes: object.plaintext_bytes });
    cancelled(signal);
    authorize();
    return { sha256, bytes: object.plaintext_bytes };
  } catch (error) {
    await writer.abort();
    throw error;
  }
}

// packet-core/src/importer.mjs
function resolveObjects(descriptor, entries) {
  const d2 = requireDescriptor(descriptor);
  insist(Array.isArray(entries) && entries.length === d2.objects.length, "object-set");
  const expected = new Map(d2.objects.map((o2) => [o2.object_id, o2]));
  const objects = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    insist(Array.isArray(entry) && entry.length === 2, "object-entry");
    const [id2, blob] = entry;
    const binding = expected.get(id2);
    insist(binding && !objects.has(id2) && blob instanceof Blob && blob.size === binding.ciphertext_bytes, "object-set");
    objects.set(id2, blob);
  }
  return objects;
}
async function importProtectedObjects({ descriptor, license, entries, transaction, signal, onObject }) {
  const d2 = requireDescriptor(descriptor);
  insist(transaction && ["open", "commit", "abort"].every((k2) => typeof transaction[k2] === "function"), "import-transaction-required");
  try {
    assertLicense(license, descriptor);
    const objects = resolveObjects(descriptor, entries);
    const evidence = [];
    for (const binding of d2.objects) {
      const key2 = copyObjectKey(license, descriptor, binding.object_id);
      try {
        const writer = await transaction.open(binding);
        const result = await decryptObject(
          objects.get(binding.object_id),
          key2,
          d2,
          binding,
          writer,
          { signal, authorize: () => assertLicense(license, descriptor) }
        );
        evidence.push({ object_id: binding.object_id, ...result });
        try {
          onObject?.(evidence.length, d2.objects.length);
        } catch {
        }
      } finally {
        key2.fill(0);
      }
    }
    if (signal?.aborted) throw new Error("operation-cancelled");
    assertLicense(license, descriptor);
    await transaction.commit(evidence);
    if (signal?.aborted) throw new Error("operation-cancelled");
    assertLicense(license, descriptor);
    return Object.freeze({ status: "authenticated-quarantine", objects: Object.freeze(evidence.map(Object.freeze)) });
  } catch (error) {
    await transaction.abort();
    throw error;
  }
}

// packet-core/src/transport.mjs
var MAGIC = bytes("SSPC0001");
var decoder2 = new TextDecoder("utf-8", { fatal: true });
async function splitTransport(blob, trustedKeys) {
  insist(blob instanceof Blob && blob.size >= 12 && blob.size <= 2003e6, "combined-size");
  let offset = 0;
  async function take(length2) {
    insist(Number.isSafeInteger(length2) && length2 >= 0 && offset + length2 <= blob.size, "combined-truncated");
    const part = blob.slice(offset, offset + length2);
    offset += length2;
    return part;
  }
  async function readNumber() {
    return new DataView(await (await take(4)).arrayBuffer()).getUint32(0);
  }
  insist(decoder2.decode(await (await take(8)).arrayBuffer()) === "SSPC0001", "combined-magic");
  const length = await readNumber();
  insist(length > 0 && length <= 18e4, "descriptor-token-limit");
  const token = decoder2.decode(await (await take(length)).arrayBuffer());
  const descriptor = await verifyDescriptor(token, trustedKeys);
  const d2 = requireDescriptor(descriptor);
  const bindings = new Map(d2.objects.map((o2) => [o2.object_id, o2]));
  const entries = [];
  for (let i2 = 0; i2 < d2.objects.length; i2++) {
    const size = await readNumber();
    insist(size >= 1 && size <= 128, "combined-id");
    const id2 = decoder2.decode(await (await take(size)).arrayBuffer());
    const object = bindings.get(id2);
    insist(object && bindings.delete(id2), "combined-object");
    const ciphertextLength = await readNumber();
    insist(ciphertextLength === object.ciphertext_bytes, "combined-object-size");
    entries.push([id2, await take(ciphertextLength)]);
  }
  insist(offset === blob.size && bindings.size === 0, "combined-trailing");
  resolveObjects(descriptor, entries);
  return { descriptor, token, entries };
}

// packet-core/client/website-client.mjs
var uuid3 = (value) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
var decoder3 = new TextDecoder("utf-8", { fatal: true });
var integer2 = (value) => Number.isSafeInteger(value) && value >= 0;
var RETRIES = 4;
var BACKOFF_MS = 1e3;
var BACKOFF_MAX_MS = 16e3;
var RATE_RETRIES = 8;
var RETRY_AFTER_MAX_MS = 6e4;
var TRANSIENT = /* @__PURE__ */ new Set(["request-aborted", "protected-server-unavailable", "protected-rate-limited", "response-size", "response-body", "protected-range-unsupported", "request-paused", "protected-object-refused"]);
var REFUSED_RETRIES = 2;
var REFUSED_WAIT_MS = 3e4;
var strongTag = (value) => typeof value === "string" && /^"[\x21\x23-\x7e]{1,200}"$/.test(value) ? value : null;
var WRITE_MIN = 1048576;
var WRITE_MAX = 4194304;
var BUFFER_MAX = 16777216;
function retryAfterMs(value, now = Date.now()) {
  if (typeof value !== "string" || !value.trim()) return null;
  const text2 = value.trim();
  const ms = /^\d{1,6}$/.test(text2) ? Number(text2) * 1e3 : Date.parse(text2) - now;
  return Number.isFinite(ms) ? Math.min(RETRY_AFTER_MAX_MS, Math.max(0, ms)) : null;
}
var LIMIT_BODY_MAX = 2048;
var LIMIT_WAIT_MAX_S = 7 * 86400;
var limitSeconds = (value) => Number.isSafeInteger(value) && value > 0 ? Math.min(LIMIT_WAIT_MAX_S, value) : null;
async function downloadLimit(response) {
  let reader = null;
  try {
    if ((response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/json") return null;
    const length = response.headers.get("content-length");
    if (length !== null && !(/^\d{1,6}$/.test(length) && Number(length) <= LIMIT_BODY_MAX)) return null;
    if (!response.body) return null;
    reader = response.body.getReader();
    const parts = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > LIMIT_BODY_MAX) return null;
      parts.push(value);
    }
    const body = JSON.parse(decoder3.decode(concat2(parts, size)));
    if (body?.error?.code !== "PROTECTED_DOWNLOAD_LIMIT") return null;
    const header = response.headers.get("retry-after");
    return { retryAfterSeconds: limitSeconds(body.error.retryAfterSeconds) ?? (/^\d{1,7}$/.test(header?.trim() ?? "") ? limitSeconds(Number(header.trim())) : null) };
  } catch {
    return null;
  } finally {
    if (reader) {
      await reader.cancel().catch(() => {
      });
      reader.releaseLock();
    }
  }
}
var concat2 = (parts, size) => {
  const out = new Uint8Array(size);
  let at2 = 0;
  for (const part of parts) {
    out.set(part, at2);
    at2 += part.length;
  }
  return out;
};
var errorCode = (error) => typeof error?.message === "string" && /^[a-z0-9-]{1,60}$/.test(error.message) ? error.message : error?.name === "TypeError" ? "network-error" : "download-error";
var retryable = (error) => TRANSIENT.has(error?.message) || error?.name === "TypeError" || error?.name === "AbortError" && error?.message !== "client-cancelled";
var pause = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(Error("client-cancelled"));
    return;
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  const onAbort = () => {
    clearTimeout(timer);
    reject(Error("client-cancelled"));
  };
  signal?.addEventListener("abort", onAbort, { once: true });
});
var nonce = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) && base64url_exports.encode(base64url_exports.decode(value)) === value;
function createProtectedWebsiteClient({
  origin,
  issuer,
  descriptorTrust,
  licenseTrust,
  getCredentials,
  getInstallation,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  monotonic = () => performance.now(),
  timeoutMs = 3e4,
  retryBackoffMs = BACKOFF_MS,
  refusedWaitMs = REFUSED_WAIT_MS
}) {
  const configured = new URL(origin);
  insist(configured.protocol === "https:" && configured.origin === origin && !configured.username && !configured.password, "protected-origin");
  insist(typeof issuer === "string" && issuer.startsWith("https://") && typeof getCredentials === "function" && typeof getInstallation === "function", "client-policy");
  insist(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 6e4, "client-timeout");
  insist(Number.isSafeInteger(retryBackoffMs) && retryBackoffMs > 0 && retryBackoffMs <= BACKOFF_MS, "client-backoff");
  insist(Number.isSafeInteger(refusedWaitMs) && refusedWaitMs > 0 && refusedWaitMs <= REFUSED_WAIT_MS, "client-backoff");
  let closed = false;
  const pending = /* @__PURE__ */ new Set();
  const leases = /* @__PURE__ */ new Set();
  let rangeSupported = true;
  const checkOpen = (signal) => {
    insist(!closed && !signal?.aborted, "client-cancelled");
  };
  async function credentials(signal) {
    checkOpen(signal);
    const c2 = structuredClone(await getCredentials(signal));
    checkOpen(signal);
    insist(exact(c2, ["accountId", "pairingId", "accessToken", "expiresAt"]) && uuid3(c2.accountId) && uuid3(c2.pairingId) && typeof c2.accessToken === "string" && c2.accessToken.length > 0 && c2.accessToken.length <= 4096 && !/[\r\n]/.test(c2.accessToken) && Number.isFinite(c2.expiresAt) && c2.expiresAt > now(), "paired-session-required");
    return c2;
  }
  async function unchanged(c2, signal) {
    const current = await credentials(signal);
    insist(current.accountId === c2.accountId && current.pairingId === c2.pairingId && current.accessToken === c2.accessToken && current.expiresAt === c2.expiresAt, "paired-session-changed");
  }
  function path(releaseId, suffix) {
    insist(uuid3(releaseId), "release-id");
    return `${origin}/api/v1/protected-candidate/releases/${releaseId}/${suffix}`;
  }
  async function request(c2, url, {
    body,
    maximum,
    signal,
    json = false,
    exactBytes,
    sink,
    onBytes,
    descriptorRequest = false,
    resumeFrom = 0,
    keepSinkOnError = false,
    onRestart,
    pauseSignal,
    ifRange = null
  } = {}) {
    await unchanged(c2, signal);
    const controller = new AbortController();
    pending.add(controller);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    pauseSignal?.addEventListener("abort", abort, { once: true });
    let etag = null;
    let timer = setTimeout(abort, timeoutMs);
    const rearm = () => {
      clearTimeout(timer);
      timer = setTimeout(abort, timeoutMs);
    };
    const cap = setTimeout(abort, timeoutMs + Math.ceil((maximum ?? 0) / 32768) * 1e3);
    const ensure = () => {
      checkOpen(signal);
      insist(!controller.signal.aborted, "request-aborted");
    };
    let reader;
    let response;
    let written = resumeFrom;
    try {
      insist(Number.isSafeInteger(resumeFrom) && resumeFrom >= 0 && (resumeFrom === 0 || sink && !body && exactBytes !== void 0 && resumeFrom < exactBytes), "resume-policy");
      insist(!pauseSignal?.aborted, "request-paused");
      if (sink && resumeFrom === 0 && (sink.written ?? 0) > 0) await sink.reset();
      ensure();
      response = await fetchImpl(url, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${c2.accessToken}`,
          ...body ? { "Content-Type": "application/json" } : {},
          ...resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-`, ...strongTag(ifRange) ? { "If-Range": ifRange } : {} } : {}
        },
        ...body ? { body: JSON.stringify(body) } : {},
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: controller.signal
      });
      ensure();
      insist(!response.redirected && (!response.url || response.url === url), "protected-response");
      etag = strongTag(response.headers.get("etag"));
      insist(!descriptorRequest || response.status !== 404, "protected-release-unavailable");
      if (response.status === 403) {
        const limit = await downloadLimit(response);
        if (limit) throw Object.assign(Error("protected-download-limit"), limit.retryAfterSeconds ? { retryAfterSeconds: limit.retryAfterSeconds } : {});
        throw Error("protected-access-refused");
      }
      if (response.status === 429 || response.status >= 500) {
        const error = Error(response.status === 429 ? "protected-rate-limited" : "protected-server-unavailable");
        const wait = retryAfterMs(response.headers.get("retry-after"));
        if (wait !== null) error.retryAfterMs = wait;
        throw error;
      }
      if (resumeFrom > 0 && response.status === 400) {
        rangeSupported = false;
        throw Error("protected-range-unsupported");
      }
      const partial = resumeFrom > 0 && response.status === 206;
      insist(response.status === 200 || partial, "protected-response");
      if (partial) {
        if (response.headers.get("content-range") !== `bytes ${resumeFrom}-${exactBytes - 1}/${exactBytes}`) {
          rangeSupported = false;
          throw Error("protected-range-unsupported");
        }
      } else if (resumeFrom > 0) {
        rangeSupported = false;
        await sink.reset();
        written = 0;
        try {
          onRestart?.(resumeFrom);
        } catch {
        }
      }
      insist((response.headers.get("cache-control") ?? "").split(",").map((x2) => x2.trim().toLowerCase()).includes("no-store"), "private-response-required");
      if (json) insist((response.headers.get("content-type") ?? "").split(";")[0] === "application/json", "response-type");
      const length = response.headers.get("content-length");
      insist(length === null || /^\d+$/.test(length) && Number.isSafeInteger(Number(length)) && Number(length) + written <= maximum, "response-limit");
      insist(response.body, "response-body");
      reader = response.body.getReader();
      const chunks = [];
      let total = written;
      if (sink) {
        const queue = [];
        let buffered = 0, finished = false, readError = null, writeError = null, wakeWriter = null, wakeReader = null;
        const kick = (waiter) => {
          const wake = waiter === "writer" ? wakeWriter : wakeReader;
          if (waiter === "writer") wakeWriter = null;
          else wakeReader = null;
          wake?.();
        };
        const writer = (async () => {
          while (!writeError) {
            if (buffered < WRITE_MIN && !finished) {
              await new Promise((resolve) => {
                wakeWriter = resolve;
              });
              continue;
            }
            if (!buffered) return;
            const parts = [];
            let size = 0;
            while (queue.length && (size === 0 || size + queue[0].length <= WRITE_MAX)) {
              const part = queue.shift();
              parts.push(part);
              size += part.length;
            }
            checkOpen(signal);
            const batch = parts.length === 1 ? parts[0] : concat2(parts, size);
            for (let offset = 0; offset < batch.length; offset += WRITE_MAX) await sink.write(batch.subarray(offset, offset + WRITE_MAX));
            buffered -= size;
            written += size;
            rearm();
            kick("reader");
          }
        })().catch((error) => {
          writeError = error;
          kick("reader");
        });
        try {
          while (!writeError) {
            ensure();
            const { done, value } = await reader.read();
            ensure();
            if (done) break;
            total += value.length;
            insist(total <= maximum, "response-limit");
            rearm();
            onBytes?.(value.length);
            queue.push(value);
            buffered += value.length;
            if (buffered >= WRITE_MIN) kick("writer");
            while (buffered >= BUFFER_MAX && !writeError) await new Promise((resolve) => {
              wakeReader = resolve;
            });
            if (exactBytes !== void 0 && total === exactBytes) break;
          }
        } catch (error) {
          readError = error;
        }
        finished = true;
        kick("writer");
        await writer;
        if (writeError) throw writeError;
        if (readError) throw readError;
      } else {
        while (true) {
          ensure();
          const { done, value } = await reader.read();
          ensure();
          if (done) break;
          total += value.length;
          insist(total <= maximum, "response-limit");
          rearm();
          onBytes?.(value.length);
          chunks.push(value);
        }
      }
      insist(exactBytes === void 0 || total === exactBytes, "response-size");
      pauseSignal?.removeEventListener("abort", abort);
      clearTimeout(timer);
      clearTimeout(cap);
      await unchanged(c2, signal);
      checkOpen(signal);
      const blob = sink ? await sink.commit() : new Blob(chunks);
      await unchanged(c2, signal);
      checkOpen(signal);
      return json ? JSON.parse(decoder3.decode(await blob.arrayBuffer())) : blob;
    } catch (caught) {
      const error = pauseSignal?.aborted && !signal?.aborted && !closed && caught?.message !== "paired-session-changed" && caught?.message !== "paired-session-required" ? Error("request-paused") : caught;
      if (sink && keepSinkOnError) {
        try {
          error.written = written;
          if (etag) error.etag = etag;
        } catch {
        }
      } else if (sink) await sink.abort();
      throw error;
    } finally {
      clearTimeout(timer);
      clearTimeout(cap);
      signal?.removeEventListener("abort", abort);
      pauseSignal?.removeEventListener("abort", abort);
      pending.delete(controller);
      controller.abort();
      if (reader) {
        await reader.cancel().catch(() => {
        });
        reader.releaseLock();
      } else await response?.body?.cancel().catch(() => {
      });
    }
  }
  async function descriptor(c2, releaseId, signal) {
    const blob = await request(c2, path(releaseId, "descriptor"), { maximum: 18e4, signal, descriptorRequest: true });
    const handle = await verifyDescriptor(decoder3.decode(await blob.arrayBuffer()), descriptorTrust);
    insist(requireDescriptor(handle).release_id === releaseId, "descriptor-release");
    await unchanged(c2, signal);
    return handle;
  }
  function challengeBinding(value, expected) {
    insist(uuid3(value.id) && value.releaseId === expected.releaseId && value.descriptorSha256 === expected.descriptorSha256 && isHash(value.descriptorSha256) && value.installationId === expected.installationId && integer2(value.expiresAt) && value.expiresAt * 1e3 > now() && value.expiresAt * 1e3 <= now() + 6e4, "challenge-binding");
  }
  return Object.freeze({
    // `staging` is either a prepared area or a factory `(bytes) => area` called
    // once the verified descriptor states the exact ciphertext footprint, so a
    // quota check reserves what this release needs rather than the format maximum.
    // onProgress(receivedBytes, totalBytes) reports ciphertext received; the total is
    // known from the verified descriptor before any object is fetched.
    // E61 (0.62.20): each object is retried after a transient failure (silence timeout,
    // 5xx, 429, a dropped connection or short body), up to RETRIES times with exponential
    // backoff, resuming with HTTP Range from the bytes already staged. onRetry({ object,
    // attempt, code, written, delayMs }) reports each retry (telemetry only).
    // pause (0.62.21): { paused, signal(), resumed() } from the caller. While paused the
    // acquisition holds its staged objects and its place; Resume continues the current
    // object (with Range when the server supports it) and skips every finished object.
    async acquire(releaseId, { combined = false, signal, staging, onProgress, onRetry, pause: gate } = {}) {
      let area = typeof staging === "function" ? void 0 : staging;
      let received = 0, expectedTotal = 0;
      const progress = (n2) => {
        received += n2;
        try {
          onProgress?.(received, expectedTotal);
        } catch {
        }
      };
      const reserve = async (total) => {
        if (typeof staging === "function" && !area) {
          area = await staging(total);
          insist(area && typeof area.createSink === "function" && typeof area.abort === "function", "staging-area");
        }
        return area;
      };
      try {
        let c2 = await credentials(signal);
        const hold = async () => {
          if (!gate?.paused) return;
          await new Promise((resolve, reject) => {
            const onAbort = () => reject(Error("client-cancelled"));
            if (signal?.aborted) {
              onAbort();
              return;
            }
            signal?.addEventListener("abort", onAbort, { once: true });
            Promise.resolve(gate.resumed()).then(() => {
              signal?.removeEventListener("abort", onAbort);
              resolve();
            }, reject);
          });
          checkOpen(signal);
          const next = await credentials(signal);
          insist(next.accountId === c2.accountId && next.pairingId === c2.pairingId, "paired-session-changed");
          c2 = next;
        };
        if (combined) {
          const expected = await descriptor(c2, releaseId, signal);
          const size = 12 + bytes(descriptorToken(expected)).length + requireDescriptor(expected).objects.reduce((sum, o2) => sum + 8 + bytes(o2.object_id).length + o2.ciphertext_bytes, 0);
          const sink = await reserve(size) ? await area.createSink("combined", size, size) : void 0;
          expectedTotal = size;
          progress(0);
          const blob = await request(c2, path(releaseId, "combined"), { maximum: size, exactBytes: size, signal, sink, onBytes: progress });
          const result = await splitTransport(blob, descriptorTrust);
          insist(requireDescriptor(result.descriptor).release_id === releaseId && result.descriptor.sha256 === expected.sha256, "descriptor-release");
          await unchanged(c2, signal);
          return result;
        }
        const retrying = async (index, count, attempt, fn, { objectRequest = false } = {}) => {
          let tries = 0, rated = 0, refused = 0;
          while (true) {
            await hold();
            try {
              return await fn();
            } catch (caught) {
              let error = caught;
              if (objectRequest && error?.message === "protected-access-refused") error = Object.assign(Error("protected-object-refused"), { written: error.written, etag: error.etag });
              if (!retryable(error) || signal?.aborted || closed) throw error;
              const code = errorCode(error), rangeless = code === "protected-range-unsupported";
              if (code === "request-paused") {
                attempt(error);
                continue;
              }
              if (code === "protected-rate-limited") {
                if (rated >= RATE_RETRIES) throw error;
                rated += 1;
              } else if (code === "protected-object-refused") {
                if (refused >= REFUSED_RETRIES) throw error;
                refused += 1;
              } else if (!rangeless) {
                if (tries >= RETRIES) throw error;
                tries += 1;
              }
              const backoff = Math.min(BACKOFF_MAX_MS, retryBackoffMs * 2 ** Math.max(0, tries - 1));
              const delayMs = rangeless ? 0 : code === "protected-object-refused" ? Math.min(RETRY_AFTER_MAX_MS, refusedWaitMs * refused) : Number.isFinite(error.retryAfterMs) ? Math.max(error.retryAfterMs, code === "protected-rate-limited" ? 0 : backoff) : backoff;
              const written = attempt(error);
              try {
                onRetry?.({ object: index, objects: count, attempt: tries + rated + refused + (rangeless ? 1 : 0), code, written, delayMs });
              } catch {
              }
              if (delayMs) await pause(delayMs, signal);
              checkOpen(signal);
            }
          }
        };
        const handle = await retrying(0, 0, () => 0, () => descriptor(c2, releaseId, signal));
        const entries = [];
        const objects = requireDescriptor(handle).objects;
        expectedTotal = objects.reduce((sum, o2) => sum + o2.ciphertext_bytes, 0);
        await reserve(expectedTotal);
        progress(0);
        for (const [index, object] of objects.entries()) {
          const sink = area ? await area.createSink(object.object_id, object.ciphertext_bytes, object.ciphertext_bytes) : void 0;
          let counted = 0, staged = 0, etag = null;
          const objectBytes = (n2) => {
            counted += n2;
            progress(n2);
          };
          const blob = await retrying(index + 1, objects.length, (error) => {
            staged = sink && rangeSupported && Number.isSafeInteger(error.written) && error.written < object.ciphertext_bytes ? error.written : 0;
            etag = error.etag ?? etag;
            if (counted !== staged) {
              progress(staged - counted);
              counted = staged;
            }
            return staged;
          }, () => request(c2, path(releaseId, `objects/${object.object_id}`), {
            maximum: object.ciphertext_bytes,
            exactBytes: object.ciphertext_bytes,
            signal,
            sink,
            onBytes: objectBytes,
            resumeFrom: sink ? staged : 0,
            keepSinkOnError: Boolean(sink),
            pauseSignal: gate?.signal?.(),
            ifRange: etag,
            onRestart: (dropped) => {
              counted -= dropped;
              progress(-dropped);
            }
          }), { objectRequest: true });
          entries.push([object.object_id, blob]);
        }
        await unchanged(c2, signal);
        requireDescriptor(handle);
        return { descriptor: handle, entries };
      } catch (error) {
        if (area) await area.abort();
        throw error;
      }
    },
    async license(handle, { signal, onVerifiedGrant } = {}) {
      const c2 = await credentials(signal);
      const d2 = requireDescriptor(handle);
      insist(uuid3(d2.release_id), "release-id");
      const installation = await getInstallation();
      await unchanged(c2, signal);
      const exported = await exportJWK(installation.publicKey);
      const installationPublicKey = { kty: exported.kty, crv: exported.crv, x: exported.x, y: exported.y };
      const id2 = await installationId(installation.publicKey);
      const expected = { releaseId: d2.release_id, descriptorSha256: handle.sha256, installationId: id2 };
      const challenge = await request(c2, path(d2.release_id, "challenge"), { body: { releaseId: d2.release_id, installationPublicKey }, maximum: 8192, signal, json: true });
      insist(exact(challenge, ["id", "releaseId", "descriptorSha256", "installationId", "expiresAt", "proofJwe"]) && typeof challenge.proofJwe === "string" && challenge.proofJwe.length <= 4096, "challenge-shape");
      challengeBinding(challenge, expected);
      const opened = await compactDecrypt(challenge.proofJwe, installation.privateKey, { keyManagementAlgorithms: ["ECDH-ES"], contentEncryptionAlgorithms: ["A256GCM"] });
      let proof;
      try {
        const h2 = opened.protectedHeader;
        insist(exact(h2, ["alg", "enc", "typ", "epk"]) && h2.typ === "seamless-installation-challenge+jwe" && exact(h2.epk, ["kty", "crv", "x", "y"]) && h2.epk.kty === "EC" && h2.epk.crv === "P-256" && opened.plaintext.length <= 2048, "challenge-envelope");
        const inner = JSON.parse(decoder3.decode(opened.plaintext));
        insist(exact(inner, ["id", "releaseId", "descriptorSha256", "installationId", "expiresAt", "nonce"]), "challenge-payload");
        challengeBinding(inner, expected);
        insist(inner.id === challenge.id && inner.expiresAt === challenge.expiresAt && nonce(inner.nonce), "challenge-inner-binding");
        proof = inner.nonce;
      } finally {
        opened.plaintext.fill(0);
      }
      await unchanged(c2, signal);
      challengeBinding(challenge, expected);
      requireDescriptor(handle);
      const result = await request(c2, path(d2.release_id, "license"), { body: { releaseId: d2.release_id, challengeId: challenge.id, installationPublicKey, proof }, maximum: 128e3, signal, json: true });
      proof = void 0;
      insist(exact(result, ["token", "expiresAt", "installationId", "descriptorSha256"]) && result.installationId === id2 && result.descriptorSha256 === handle.sha256 && integer2(result.expiresAt), "license-response");
      const session = await openLicense(result.token, {
        descriptor: handle,
        trustedKeys: licenseTrust,
        installationPrivateKey: installation.privateKey,
        installationPublicKey: installation.publicKey,
        account: c2.accountId,
        issuer,
        now,
        monotonic
      });
      try {
        insist(session.expiresAt === result.expiresAt * 1e3, "license-response-expiry");
        await unchanged(c2, signal);
        if (onVerifiedGrant) await onVerifiedGrant(Object.freeze({ token: result.token, accountId: c2.accountId, expiresAt: session.expiresAt }));
        await unchanged(c2, signal);
        leases.add(session);
        return session;
      } catch (error) {
        closeLicense(session);
        throw error;
      }
    },
    close() {
      closed = true;
      for (const controller of pending) controller.abort();
      for (const lease of leases) closeLicense(lease);
      leases.clear();
    }
  });
}

// packet-core/client/paired-website-client.mjs
function createPairedProtectedWebsiteClient({
  pairingConfig,
  storage,
  locks,
  fetchImpl = globalThis.fetch,
  issuer,
  descriptorTrust,
  licenseTrust,
  getInstallation,
  now = () => Date.now(),
  monotonic,
  timeoutMs
}) {
  const origin = catalogControlOrigin(pairingConfig.pairingOrigin, { fixtureOnly: pairingConfig.fixtureOnly === true });
  return createProtectedWebsiteClient({
    origin,
    issuer,
    descriptorTrust,
    licenseTrust,
    getInstallation,
    fetchImpl,
    now,
    monotonic,
    timeoutMs,
    // Conservative candidate: refresh status for every authoritative credential
    // read. Cached optimization requires a reviewed invalidation/refresh policy.
    getCredentials: (signal) => readProtectedPairingCredentials(pairingConfig, { signal, now })
  });
}

// packet-core/client/disk-vault.mjs
var UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
var LIBRARY = "library";
var LEGACY = "saved";
async function createDiskVault({ root, descriptorTrust, assertOwner, signal, now = () => Date.now() }) {
  insist(typeof assertOwner === "function" && root?.entries, "vault-owner-required");
  const check2 = () => {
    assertOwner();
    if (signal?.aborted) throw Error("vault-cancelled");
  };
  async function remove(parent, name) {
    try {
      await parent.removeEntry(name, { recursive: true });
    } catch (e) {
      if (e.name !== "NotFoundError") throw e;
    }
  }
  async function directory(parent, name, create = false) {
    try {
      return await parent.getDirectoryHandle(name, { create });
    } catch (e) {
      if (e.name === "NotFoundError") return null;
      throw e;
    }
  }
  async function library(create = false) {
    return directory(root, LIBRARY, create);
  }
  async function write(dir, name, blob) {
    check2();
    const handle = await dir.getFileHandle(name, { create: true });
    const writer = await handle.createWritable();
    try {
      for (let n2 = 0; n2 < blob.size; n2 += 1048576) {
        check2();
        await writer.write(new Uint8Array(await blob.slice(n2, n2 + 1048576).arrayBuffer()));
      }
      check2();
      await writer.close();
    } catch (e) {
      await writer.abort().catch(() => {
      });
      throw e;
    }
    check2();
  }
  async function read(dir, releaseId) {
    const token = await (await dir.getFileHandle("receipt")).getFile();
    insist(token.size > 0 && token.size <= 18e4, "vault-receipt-size");
    const descriptor = await verifyDescriptor(await token.text(), descriptorTrust);
    check2();
    const d2 = requireDescriptor(descriptor);
    insist(releaseId === void 0 || d2.release_id === releaseId, "vault-release");
    const entries = [];
    for (let i2 = 0; i2 < d2.objects.length; i2++) {
      const blob = await (await dir.getFileHandle(`object-${i2}`)).getFile();
      check2();
      insist(blob.size === d2.objects[i2].ciphertext_bytes, "vault-object-size");
      entries.push([d2.objects[i2].object_id, blob]);
    }
    return { descriptor, entries };
  }
  async function lastUsed(dir) {
    try {
      const value = Number(await (await (await dir.getFileHandle("used")).getFile()).text());
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  }
  async function touch(dir) {
    try {
      await write(dir, "used", new Blob([String(now())]));
    } catch {
    }
  }
  async function legacyRelease() {
    const dir = await directory(root, LEGACY);
    if (!dir) return null;
    try {
      const { descriptor } = await read(dir);
      return { dir, releaseId: requireDescriptor(descriptor).release_id };
    } catch {
      return { dir, releaseId: null };
    }
  }
  async function cleanup() {
    check2();
    for await (const [name] of root.entries()) {
      check2();
      if (/^job-[a-f0-9-]{36}$/.test(name)) await remove(root, name);
      else if (name === LEGACY) {
        try {
          const d2 = await root.getDirectoryHandle(name);
          await d2.getFileHandle("receipt");
        } catch (e) {
          if (e.name !== "NotFoundError") throw e;
          await remove(root, name);
        }
      }
    }
    const lib = await library();
    if (lib) for await (const [name] of lib.entries()) {
      check2();
      if (!UUID.test(name)) {
        await remove(lib, name);
        continue;
      }
      try {
        await (await lib.getDirectoryHandle(name)).getFileHandle("receipt");
      } catch (e) {
        if (e.name !== "NotFoundError") throw e;
        await remove(lib, name);
      }
    }
    check2();
  }
  await cleanup();
  return Object.freeze({
    // Keep one more release; other kept releases are untouched.
    async save({ descriptor, entries }) {
      check2();
      const d2 = requireDescriptor(descriptor);
      const objects = new Map(entries);
      insist(UUID.test(d2.release_id) && objects.size === d2.objects.length, "vault-object-set");
      const lib = await library(true);
      await remove(lib, d2.release_id);
      const dir = await lib.getDirectoryHandle(d2.release_id, { create: true });
      try {
        for (let i2 = 0; i2 < d2.objects.length; i2++) {
          const binding = d2.objects[i2], blob = objects.get(binding.object_id);
          insist(blob instanceof Blob && blob.size === binding.ciphertext_bytes, "vault-object-size");
          await write(dir, `object-${i2}`, blob);
        }
        await touch(dir);
        await write(dir, "receipt", new Blob([descriptorToken(descriptor)]));
        check2();
      } catch (e) {
        await remove(lib, d2.release_id);
        throw e;
      }
      const legacy = await legacyRelease();
      if (legacy?.releaseId === d2.release_id) await remove(root, LEGACY);
    },
    async load(releaseId) {
      check2();
      insist(UUID.test(releaseId), "vault-release");
      const lib = await library(), dir = lib ? await directory(lib, releaseId) : null;
      if (dir) {
        const result = await read(dir, releaseId);
        await touch(dir);
        return result;
      }
      const legacy = await directory(root, LEGACY);
      insist(legacy, "vault-release");
      return read(legacy, releaseId);
    },
    // True when this release is kept and its receipt and object sizes verify.
    async has(releaseId) {
      check2();
      if (!UUID.test(releaseId)) return false;
      try {
        await this.load(releaseId);
        return true;
      } catch {
        return false;
      }
    },
    // Kept releases, newest use first. `problem` marks one that cannot be loaded.
    async list() {
      check2();
      const out = [];
      const lib = await library();
      if (lib) for await (const [name, handle] of lib.entries()) {
        check2();
        if (!UUID.test(name) || handle.kind !== "directory") continue;
        let bytes2 = 0;
        for await (const [, file] of handle.entries()) if (file.kind === "file") bytes2 += (await file.getFile()).size;
        const entry = { releaseId: name, bytes: bytes2, lastUsedAt: await lastUsed(handle), legacy: false, descriptorSha256: null, problem: null };
        try {
          const { descriptor } = await read(handle, name);
          entry.descriptorSha256 = descriptor.sha256;
        } catch (e) {
          entry.problem = e.message || "vault-unreadable";
        }
        out.push(entry);
      }
      const legacy = await legacyRelease();
      if (legacy?.releaseId && !out.some((e) => e.releaseId === legacy.releaseId)) {
        let bytes2 = 0;
        for await (const [, file] of legacy.dir.entries()) if (file.kind === "file") bytes2 += (await file.getFile()).size;
        const { descriptor } = await read(legacy.dir, legacy.releaseId);
        out.push({ releaseId: legacy.releaseId, bytes: bytes2, lastUsedAt: 0, legacy: true, descriptorSha256: descriptor.sha256, problem: null });
      }
      return out.sort((a2, b2) => b2.lastUsedAt - a2.lastUsedAt);
    },
    async remove(releaseId) {
      check2();
      insist(UUID.test(releaseId), "vault-release");
      const lib = await library();
      if (lib) await remove(lib, releaseId);
      const legacy = await legacyRelease();
      if (legacy?.releaseId === releaseId) await remove(root, LEGACY);
    },
    async clear() {
      assertOwner();
      await remove(root, LIBRARY);
      await remove(root, LEGACY);
    },
    cleanup
  });
}

// extension/src/mp4-format-probe.mjs
var MAX_METADATA = 8 * 1024 * 1024;
var MAX_BOXES = 1e4;
var text = (b2, p2) => String.fromCharCode(...b2.subarray(p2, p2 + 4));
var u32 = (b2, p2) => new DataView(b2.buffer, b2.byteOffset, b2.byteLength).getUint32(p2);
var fail = () => {
  throw Error("unsupported-or-malformed-mp4-format");
};
function boxes(b2, p2 = 0, end = b2.length) {
  const out = [];
  while (p2 < end) {
    if (out.length >= MAX_BOXES || end - p2 < 8) fail();
    let size = u32(b2, p2), header = 8;
    if (size === 1) {
      if (end - p2 < 16) fail();
      size = u32(b2, p2 + 8) * 2 ** 32 + u32(b2, p2 + 12);
      header = 16;
    }
    if (!size) size = end - p2;
    if (!Number.isSafeInteger(size) || size < header || p2 + size > end) fail();
    out.push({ type: text(b2, p2 + 4), payload: p2 + header, end: p2 + size });
    p2 += size;
  }
  return out;
}
function child(b2, parent, type) {
  const found = boxes(b2, parent.payload, parent.end).filter((box) => box.type === type);
  if (found.length !== 1) fail();
  return found[0];
}
var Bits = class {
  constructor(bytes2) {
    this.bytes = bytes2;
    this.p = 0;
  }
  read(n2) {
    if (n2 > 32 || this.p + n2 > this.bytes.length * 8) fail();
    let v2 = 0;
    for (let i2 = 0; i2 < n2; i2++, this.p++) v2 = v2 * 2 + (this.bytes[this.p >> 3] >> 7 - (this.p & 7) & 1);
    return v2;
  }
  ue() {
    let n2 = 0;
    while (!this.read(1)) {
      if (++n2 > 24) fail();
    }
    return 2 ** n2 - 1 + this.read(n2);
  }
  se() {
    const v2 = this.ue();
    return v2 % 2 ? (v2 + 1) / 2 : -v2 / 2;
  }
};
function spsTransfer(nal) {
  if (nal.length < 4 || nal[0] & 128 || (nal[0] & 31) !== 7) fail();
  const rbsp = [];
  for (let i2 = 1; i2 < nal.length; i2++) {
    if (i2 > 2 && nal[i2] === 3 && nal[i2 - 1] === 0 && nal[i2 - 2] === 0) continue;
    rbsp.push(nal[i2]);
  }
  const bits = new Bits(Uint8Array.from(rbsp)), profile = bits.read(8);
  if (![66, 77, 88, 100].includes(profile)) fail();
  bits.read(16);
  bits.ue();
  if (profile === 100) {
    const chroma = bits.ue();
    if (chroma > 3) fail();
    if (chroma === 3) bits.read(1);
    if (bits.ue() !== 0 || bits.ue() !== 0) fail();
    bits.read(1);
    if (bits.read(1)) for (let list = 0; list < (chroma === 3 ? 12 : 8); list++) {
      if (!bits.read(1)) continue;
      let last = 8, next = 8;
      for (let i2 = 0; i2 < (list < 6 ? 16 : 64); i2++) {
        if (next) next = (last + bits.se() + 256) % 256;
        last = next === 0 ? last : next;
      }
    }
  }
  bits.ue();
  const order = bits.ue();
  if (order === 0) bits.ue();
  else if (order === 1) {
    bits.read(1);
    bits.se();
    bits.se();
    const cycle = bits.ue();
    if (cycle > 255) fail();
    for (let i2 = 0; i2 < cycle; i2++) bits.se();
  } else if (order !== 2) fail();
  bits.ue();
  bits.read(1);
  bits.ue();
  bits.ue();
  if (!bits.read(1)) bits.read(1);
  bits.read(1);
  if (bits.read(1)) for (let i2 = 0; i2 < 4; i2++) bits.ue();
  if (bits.read(1)) {
    if (bits.read(1) && bits.read(8) === 255) {
      bits.read(16);
      bits.read(16);
    }
    if (bits.read(1)) bits.read(1);
    if (bits.read(1)) {
      bits.read(3);
      bits.read(1);
      if (bits.read(1)) {
        bits.read(8);
        const transfer = bits.read(8);
        bits.read(8);
        return transfer;
      }
    }
  }
  return null;
}
function avcFormat(b2, entry) {
  if (!["avc1", "avc3"].includes(entry.type) || entry.end - entry.payload < 78) fail();
  if (b2[entry.payload + 6] !== 0 || b2[entry.payload + 7] !== 1) fail();
  const children = boxes(b2, entry.payload + 78, entry.end), configurations = children.filter((box) => box.type === "avcC"), avcc = configurations[0];
  if (configurations.length !== 1) fail();
  if (!avcc || avcc.end - avcc.payload < 7 || b2[avcc.payload] !== 1) fail();
  if ((b2[avcc.payload + 4] & 252) !== 252 || (b2[avcc.payload + 4] & 3) === 2 || (b2[avcc.payload + 5] & 224) !== 224) fail();
  const count = b2[avcc.payload + 5] & 31;
  if (!count) fail();
  const transfers = [];
  let p2 = avcc.payload + 6;
  for (let i2 = 0; i2 < count; i2++) {
    if (p2 + 2 > avcc.end) fail();
    const length = b2[p2] * 256 + b2[p2 + 1];
    p2 += 2;
    if (!length || p2 + length > avcc.end) fail();
    transfers.push(spsTransfer(b2.subarray(p2, p2 + length)));
    p2 += length;
  }
  if (p2 >= avcc.end) fail();
  const ppsCount = b2[p2++];
  if (!ppsCount && entry.type === "avc1") fail();
  function parameterSets(count2, nalType) {
    for (let i2 = 0; i2 < count2; i2++) {
      if (p2 + 2 > avcc.end) fail();
      const length = b2[p2] * 256 + b2[p2 + 1];
      p2 += 2;
      if (length < 2 || p2 + length > avcc.end || b2[p2] & 128 || (b2[p2] & 31) !== nalType) fail();
      p2 += length;
    }
  }
  parameterSets(ppsCount, 8);
  if (p2 < avcc.end) {
    if (b2[avcc.payload + 1] !== 100 || avcc.end - p2 < 4 || (b2[p2] & 252) !== 252 || b2[p2 + 1] !== 248 || b2[p2 + 2] !== 248) fail();
    const extensions = b2[p2 + 3];
    p2 += 4;
    parameterSets(extensions, 13);
  }
  if (p2 !== avcc.end) fail();
  for (const colr of children.filter((box) => box.type === "colr")) {
    if (!["nclx", "nclc"].includes(text(b2, colr.payload)) || colr.end - colr.payload < 10) fail();
    transfers.push(b2[colr.payload + 6] * 256 + b2[colr.payload + 7]);
  }
  if (transfers.some((v2) => v2 !== null && ![1, 2, 4, 5, 6, 7, 13, 14, 15].includes(v2))) fail();
  return { videoCodec: "h264", bitDepth: 8, dynamicRange: "sdr", colorEvidence: transfers.some((v2) => v2 !== null && v2 !== 2) ? "sps-or-colr-sdr-transfer" : "8-bit-avc-no-hdr-signaling" };
}
function aacFormat(b2, entry) {
  if (entry.type !== "mp4a" || entry.end - entry.payload < 28 || b2[entry.payload + 8] || b2[entry.payload + 9]) fail();
  if (b2[entry.payload + 6] !== 0 || b2[entry.payload + 7] !== 1) fail();
  const configs = boxes(b2, entry.payload + 28, entry.end).filter((box) => box.type === "esds"), esds = configs[0];
  if (configs.length !== 1 || esds.end - esds.payload < 4 || u32(b2, esds.payload) !== 0) fail();
  let audioType = null, objectType = null, esCount = 0, descriptorCount = 0;
  function descriptors(p2, end, depth = 0) {
    if (depth > 4) fail();
    while (p2 < end) {
      if (++descriptorCount > 128) fail();
      const tag2 = b2[p2++];
      let length = 0, next, count = 0;
      do {
        if (p2 >= end || ++count > 4) fail();
        next = b2[p2++];
        length = length * 128 + (next & 127);
      } while (next & 128);
      const finish = p2 + length;
      if (finish > end) fail();
      if (tag2 === 3) {
        if (length < 3 || ++esCount !== 1 || depth !== 0) fail();
        const flags = b2[p2 + 2];
        let offset = p2 + 3;
        if (flags & 128) offset += 2;
        if (flags & 64) {
          if (offset >= finish) fail();
          offset += 1 + b2[offset];
        }
        if (flags & 32) offset += 2;
        if (offset > finish) fail();
        descriptors(offset, finish, depth + 1);
      } else if (tag2 === 4) {
        if (length < 13 || objectType !== null || depth !== 1 || b2[p2 + 1] >> 2 !== 5) fail();
        objectType = b2[p2];
        descriptors(p2 + 13, finish, depth + 1);
      } else if (tag2 === 5) {
        if (audioType !== null || depth !== 2) fail();
        const bits = new Bits(b2.subarray(p2, finish));
        audioType = bits.read(5);
        if (audioType === 31) audioType = 32 + bits.read(6);
      }
      p2 = finish;
    }
  }
  descriptors(esds.payload + 4, esds.end);
  if (objectType !== 64 || ![2, 5, 29].includes(audioType)) fail();
  return { audioCodec: "aac" };
}
function parseMp4Movie(b2) {
  const movie = boxes(b2).find((box) => box.type === "moov");
  if (!movie) fail();
  let video = null, audio = null, count = 0;
  for (const track of boxes(b2, movie.payload, movie.end).filter((box) => box.type === "trak")) {
    if (++count > 16) fail();
    const media = child(b2, track, "mdia"), handler = child(b2, media, "hdlr");
    if (handler.end - handler.payload < 12) fail();
    const type = text(b2, handler.payload + 8);
    if (!["vide", "soun"].includes(type)) continue;
    const information = child(b2, media, "minf"), references = child(b2, child(b2, information, "dinf"), "dref");
    if (references.end - references.payload < 8 || u32(b2, references.payload) !== 0 || u32(b2, references.payload + 4) !== 1) fail();
    const locations = boxes(b2, references.payload + 8, references.end);
    if (locations.length !== 1 || locations[0].type !== "url " || locations[0].end - locations[0].payload !== 4 || u32(b2, locations[0].payload) !== 1) fail();
    const description = child(b2, child(b2, information, "stbl"), "stsd");
    if (description.end - description.payload < 8 || u32(b2, description.payload + 4) !== 1) fail();
    const entries = boxes(b2, description.payload + 8, description.end);
    if (entries.length !== 1) fail();
    if (type === "vide") {
      if (video) fail();
      video = avcFormat(b2, entries[0]);
    } else {
      if (audio) fail();
      audio = aacFormat(b2, entries[0]);
    }
  }
  if (!video || !audio) fail();
  return Object.freeze({ container: "mp4", ...video, ...audio, formatProvenance: "bounded-iso-bmff-sample-descriptions" });
}
async function inspectMp4Format(file, { signal } = {}) {
  assertActive(signal);
  if (!Number.isSafeInteger(file?.size) || file.size < 16 || typeof file.slice !== "function") fail();
  const fileSize = file.size;
  async function read(start, end) {
    assertActive(signal);
    let buffer;
    try {
      buffer = await file.slice(start, end).arrayBuffer();
    } catch {
      assertActive(signal);
      fail();
    }
    assertActive(signal);
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== end - start || file.size !== fileSize) fail();
    return new Uint8Array(buffer);
  }
  const HEADER_CACHE_BYTES = 64 * 1024, SPECULATIVE_BYTES = 16e4;
  let cache2 = null, cacheStart = 0, speculativeBytes = 0, readAhead = false;
  async function header(start) {
    assertActive(signal);
    if (file.size !== fileSize) fail();
    const end = Math.min(fileSize, start + 16);
    if (cache2 && start >= cacheStart && end <= cacheStart + cache2.length) {
      return cache2.subarray(start - cacheStart, end - cacheStart);
    }
    const extra = readAhead ? Math.min(HEADER_CACHE_BYTES - (end - start), SPECULATIVE_BYTES - speculativeBytes, fileSize - end) : 0;
    cache2 = null;
    const bytes2 = await read(start, end + extra);
    speculativeBytes += extra;
    cacheStart = start;
    cache2 = bytes2;
    return bytes2.subarray(0, end - start);
  }
  let offset = 0, count = 0, movie = null, brand = false, fileTypeSeen = false;
  while (offset < fileSize) {
    if (++count > MAX_BOXES || fileSize - offset < 8) fail();
    const h2 = await header(offset);
    let size = u32(h2, 0), minimum = 8;
    const type = text(h2, 4);
    if (size === 1) {
      if (h2.length < 16) fail();
      size = u32(h2, 8) * 2 ** 32 + u32(h2, 12);
      minimum = 16;
    } else if (!size) size = fileSize - offset;
    if (!Number.isSafeInteger(size) || size < minimum || offset + size > fileSize) fail();
    if (type === "ftyp") {
      if (fileTypeSeen || size < minimum + 8 || size > 1024 || (size - minimum) % 4) fail();
      fileTypeSeen = true;
      const value = await read(offset, offset + size), supported2 = (value2) => /^(isom|iso[2-9]|mp4[12]|avc1)$/.test(value2);
      brand = supported2(text(value, minimum));
      for (let p2 = minimum + 8; p2 < size; p2 += 4) brand ||= supported2(text(value, p2));
    }
    if (type === "moov") {
      if (movie || size > MAX_METADATA) fail();
      movie = await read(offset, offset + size);
    }
    readAhead = size <= HEADER_CACHE_BYTES;
    offset += size;
  }
  assertActive(signal);
  if (!brand || !movie) fail();
  return parseMp4Movie(movie);
}

// extension/src/local-file-hash.mjs
var HASH_CHUNK_BYTES = 1024 * 1024;
var MAX_NATIVE_FILE_BYTES = 2147483648;
var MAX_LOCAL_ASSET_BYTES = 536870912;
var MAX_WORKERS = 2;
var activeWorkers = 0;
var createWorker = () => new Worker(new URL("../../local-hash-worker.mjs", import.meta.url), { type: "module" });
async function sha256Hex(blob, {
  signal,
  maxBytes = MAX_NATIVE_FILE_BYTES,
  timeoutMs = 3e4,
  workerFactory = createWorker,
  onProgress
} = {}) {
  assertActive(signal);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_NATIVE_FILE_BYTES || !Number.isSafeInteger(blob?.size) || blob.size < 0 || blob.size > maxBytes || typeof blob.slice !== "function") throw Error("local-hash-invalid-input");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12e4) throw Error("local-hash-invalid-deadline");
  if (activeWorkers >= MAX_WORKERS) throw Error("local-hash-busy");
  activeWorkers++;
  let worker;
  try {
    worker = workerFactory();
    return await new Promise((resolve, reject) => {
      let settled = false, processedBytes = 0;
      const finish = (error, hash2) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onFailure);
        worker.removeEventListener("messageerror", onFailure);
        error ? reject(error) : resolve(hash2);
      };
      const onAbort = () => finish(signal.reason ?? abortError());
      const onFailure = () => finish(Error("local-hash-worker-failed"));
      const onMessage = ({ data }) => {
        if (settled) return;
        if (!data || typeof data !== "object" || Array.isArray(data)) return onFailure();
        const keys = Object.keys(data).sort().join(",");
        if (data.type === "progress" && keys === "processedBytes,type" && Number.isSafeInteger(data.processedBytes) && data.processedBytes > processedBytes && data.processedBytes <= blob.size) {
          processedBytes = data.processedBytes;
          try {
            onProgress?.(processedBytes, blob.size);
          } catch {
            onFailure();
          }
        } else if (data.type === "done" && keys === "sha256,type" && typeof data.sha256 === "string" && /^[a-f0-9]{64}$/.test(data.sha256)) {
          finish(null, data.sha256);
        } else onFailure();
      };
      const timer = setTimeout(() => finish(Error("local-hash-timeout")), timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onFailure);
      worker.addEventListener("messageerror", onFailure);
      if (signal?.aborted) return onAbort();
      try {
        worker.postMessage({ blob: blob.slice(0, blob.size) });
      } catch {
        onFailure();
      }
    });
  } finally {
    try {
      worker?.terminate();
    } finally {
      activeWorkers--;
    }
  }
}

// extension/src/local-asset-validator.mjs
var SHA256_HEX2 = /^[a-f0-9]{64}$/;
var ALLOWED_RESOLUTIONS = /* @__PURE__ */ new Set(["1280x720", "1920x1080"]);
var LocalAssetValidationError = class extends Error {
  constructor(code) {
    super(code);
    this.name = "LocalAssetValidationError";
    this.code = code;
  }
};
function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function normalizeHex(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
function waitForMediaEvent(media, eventNames, { timeoutMs, signal, condition = () => true, pollCondition = null }) {
  return new Promise((resolve, reject) => {
    let polling = null, settled = false;
    const names = Array.isArray(eventNames) ? eventNames : [eventNames];
    const timeout = setTimeout(() => finish(new LocalAssetValidationError("decode-timeout")), timeoutMs);
    const listeners = names.map((name) => [name, () => {
      if (condition()) finish();
    }]);
    const onError = () => finish(new LocalAssetValidationError("decode-failed"));
    const onAbort = () => finish(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (polling !== null) clearInterval(polling);
      for (const [name, listener] of listeners) media.removeEventListener(name, listener);
      media.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    for (const [name, listener] of listeners) media.addEventListener(name, listener);
    media.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (pollCondition) polling = setInterval(() => {
      if (!settled && pollCondition()) finish();
    }, 10);
    if (signal?.aborted) onAbort();
  });
}
function localAudioPresence(video) {
  const tracks = video.audioTracks;
  return tracks && typeof tracks.length === "number" ? tracks.length > 0 : typeof video.webkitAudioDecodedByteCount === "number" ? video.webkitAudioDecodedByteCount > 0 : video.mozHasAudio === true ? true : null;
}
function validateAuthoredAssetProfile(expected, { profileClass = "mvp" } = {}) {
  const errors = [];
  const width = expected?.width;
  const height = expected?.height;
  const resolution = `${width}x${height}`;
  if (!SHA256_HEX2.test(normalizeHex(expected?.sha256))) errors.push("invalid-expected-sha256");
  if (!supportsAssetDuration(expected?.durationMs, profileClass)) {
    errors.push("invalid-expected-duration");
  }
  if (expected?.container !== "mp4") errors.push("unsupported-container");
  if (expected?.videoCodec !== "h264") errors.push("unsupported-video-codec");
  if (expected?.audioCodec !== "aac") errors.push("unsupported-audio-codec");
  const dimensionsAllowed = profileClass === "local-user" || profileClass === "catalog-v2" ? supportsBoundedAssetDimensions(width, height) : ALLOWED_RESOLUTIONS.has(resolution) && width * 9 === height * 16;
  if (!dimensionsAllowed) errors.push("unsupported-dimensions");
  if (expected?.dynamicRange !== "sdr") errors.push("unsupported-dynamic-range");
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
function validateMeasuredAsset(measured, expected, actualSha256, { profileClass = "mvp" } = {}) {
  const authored = validateAuthoredAssetProfile(expected, { profileClass });
  const errors = [...authored.errors];
  const toleranceMs = finiteNumber(expected?.durationToleranceMs) ? expected.durationToleranceMs : 100;
  if (measured?.mediaType !== "video/mp4") errors.push("not-mp4");
  if (normalizeHex(actualSha256) !== normalizeHex(expected?.sha256)) errors.push("sha256-mismatch");
  if (!finiteNumber(measured?.durationMs) || Math.abs(measured.durationMs - expected?.durationMs) > toleranceMs) {
    errors.push("duration-mismatch");
  }
  if (!supportsAssetDuration(measured?.durationMs, profileClass)) errors.push("measured-duration-out-of-range");
  if (measured?.width !== expected?.width || measured?.height !== expected?.height) errors.push("dimensions-mismatch");
  if (measured?.initialSampleDecoded !== true) errors.push("initial-decode-failed");
  if (measured?.audioPresent !== true) errors.push("audio-track-missing");
  for (const [key2, code] of [["container", "container"], ["videoCodec", "video-codec"], ["audioCodec", "audio-codec"], ["dynamicRange", "dynamic-range"]]) {
    if (measured?.[key2] !== expected?.[key2]) errors.push(`measured-${code}-mismatch`);
  }
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze([...new Set(errors)]),
    metadata: Object.freeze({
      sha256: normalizeHex(actualSha256),
      durationMs: finiteNumber(measured?.durationMs) ? Math.round(measured.durationMs) : null,
      width: finiteNumber(measured?.width) ? measured.width : null,
      height: finiteNumber(measured?.height) ? measured.height : null,
      container: measured?.container ?? null,
      videoCodec: measured?.videoCodec ?? null,
      audioCodec: measured?.audioCodec ?? null,
      dynamicRange: measured?.dynamicRange ?? null,
      formatProvenance: measured?.formatProvenance ?? null,
      colorEvidence: measured?.colorEvidence ?? null
    })
  });
}
async function inspectLocalMedia(file, {
  document = globalThis.document,
  urlApi = globalThis.URL,
  signal,
  timeoutMs = 5e3
} = {}) {
  if (!document?.createElement || !urlApi?.createObjectURL || !urlApi?.revokeObjectURL) {
    throw new LocalAssetValidationError("media-inspection-unavailable");
  }
  assertActive(signal);
  const video = document.createElement("video");
  const objectUrl = urlApi.createObjectURL(file);
  video.preload = "auto";
  video.playsInline = true;
  video.muted = true;
  try {
    video.src = objectUrl;
    video.load();
    if (video.readyState < 1) await waitForMediaEvent(video, "loadedmetadata", { timeoutMs, signal });
    if (video.readyState < 2) await waitForMediaEvent(video, ["loadeddata", "canplay"], { timeoutMs, signal });
    await boundedOperation(() => video.play(), { signal, timeoutMs, label: "initial-decode" }).catch(() => {
      throw new LocalAssetValidationError("initial-decode-failed");
    });
    if (video.currentTime < 0.02) {
      await waitForMediaEvent(video, ["timeupdate", "ended"], {
        timeoutMs,
        signal,
        condition: () => video.currentTime >= 0.02 || video.ended,
        pollCondition: () => video.readyState >= 2 && (video.currentTime >= 0.02 || video.ended) && localAudioPresence(video) === true
      });
    }
    video.pause();
    const audioPresent = localAudioPresence(video);
    return Object.freeze({
      mediaType: "video/mp4",
      durationMs: video.duration * 1e3,
      width: video.videoWidth,
      height: video.videoHeight,
      initialSampleDecoded: true,
      audioPresent
    });
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    urlApi.revokeObjectURL(objectUrl);
  }
}
async function validateLocalAsset(file, expected, {
  hash: hash2 = sha256Hex,
  inspect = inspectLocalMedia,
  inspectFormat = inspectMp4Format,
  signal,
  profileClass = "mvp"
} = {}) {
  const authored = validateAuthoredAssetProfile(expected, { profileClass });
  if (!authored.ok) return Object.freeze({ ok: false, errors: authored.errors, metadata: null });
  assertActive(signal);
  if (!Number.isSafeInteger(file?.size) || file.size < 0 || file.size > MAX_LOCAL_ASSET_BYTES) return Object.freeze({ ok: false, errors: ["local-asset-byte-budget-exceeded"], metadata: null });
  const actualSha256 = await hash2(file, { signal, maxBytes: MAX_LOCAL_ASSET_BYTES, timeoutMs: 3e4 });
  assertActive(signal);
  if (actualSha256 !== normalizeHex(expected.sha256)) {
    return Object.freeze({
      ok: false,
      errors: Object.freeze(["sha256-mismatch"]),
      metadata: null
    });
  }
  const format = await boundedOperation(() => inspectFormat(file, { signal }), { signal, timeoutMs: 5e3, label: "mp4-format" });
  assertActive(signal);
  const measured = { ...await inspect(file, { signal }), ...format };
  assertActive(signal);
  return validateMeasuredAsset(measured, expected, actualSha256, { profileClass });
}

// extension/src/system-files.mjs
var SYSTEM_FILE_NAMES = /* @__PURE__ */ new Set([".ds_store", "thumbs.db", "ehthumbs.db", "desktop.ini", ".localized", "icon\r"]);
var SYSTEM_FOLDER_NAMES = /* @__PURE__ */ new Set(["__macosx", ".spotlight-v100", ".trashes", ".fseventsd", ".temporaryitems", "$recycle.bin", "system volume information"]);
function isSystemFolderName(name) {
  return typeof name === "string" && SYSTEM_FOLDER_NAMES.has(name.toLowerCase());
}
function isSystemFileName(name) {
  if (typeof name !== "string") return false;
  const lower = name.toLowerCase();
  return SYSTEM_FILE_NAMES.has(lower) || lower.startsWith("._");
}
function isSystemFilePath(path) {
  if (typeof path !== "string") return false;
  const parts = path.replaceAll("\\", "/").split("/");
  return isSystemFileName(parts.at(-1)) || parts.slice(0, -1).some(isSystemFolderName);
}
function withoutSystemFiles(files) {
  return [...files].filter((file) => !isSystemFilePath(file?.webkitRelativePath || file?.name));
}

// extension/src/catalog-file-import.mjs
var sha256Text = async (text2) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", typeof text2 === "string" ? new TextEncoder().encode(text2) : text2))].map((b2) => b2.toString(16).padStart(2, "0")).join("");
async function loadCatalogPacket(selectedFiles, trustedKeys, { capabilities, expectedService, signal, validateAsset: validateAsset2 = validateLocalAsset, onAssetChecked } = {}) {
  const files = Array.isArray(selectedFiles) ? withoutSystemFiles(selectedFiles) : selectedFiles;
  if (!Array.isArray(files) || files.length < 1 || files.length > 201) throw new Error("catalog-file-count-invalid");
  const byName = /* @__PURE__ */ new Map();
  let total = 0;
  for (const file2 of files) {
    assertActive(signal);
    if (!Number.isSafeInteger(file2.size) || file2.size < 1 || file2.size > 25e7) throw new Error("catalog-file-size-invalid");
    const name2 = file2.webkitRelativePath || file2.name;
    if (typeof name2 !== "string" || name2.length > 512 || name2.includes("\\") || name2.startsWith("/") || name2.split("/").some((part) => !part || part === "." || part === "..") || byName.has(name2.toLowerCase())) throw new Error("catalog-file-path-invalid");
    byName.set(name2.toLowerCase(), { name: name2, file: file2 });
    total += file2.size;
    if (total > 2e9 + CATALOG_PACKET_MAX_BYTES) throw new Error("catalog-files-too-large");
  }
  const manifests = [...byName.values()].filter(({ name: name2 }) => name2.split("/").at(-1) === "edit-packet.json");
  if (manifests.length !== 1 || manifests[0].file.size > CATALOG_PACKET_MAX_BYTES) throw new Error("catalog-metadata-file-invalid");
  const { name, file } = manifests[0], bytes2 = await file.arrayBuffer();
  assertActive(signal);
  if (bytes2.byteLength !== file.size || bytes2.byteLength > CATALOG_PACKET_MAX_BYTES) throw new Error("catalog-metadata-size-mismatch");
  let text2;
  try {
    text2 = new TextDecoder("utf-8", { fatal: true }).decode(bytes2);
  } catch {
    throw new Error("catalog-metadata-encoding-invalid");
  }
  let packet;
  try {
    packet = JSON.parse(text2);
  } catch {
    throw new Error("catalog-metadata-json-invalid");
  }
  const verification = await verifyCatalogPacket(packet, trustedKeys, { capabilities });
  assertActive(signal);
  if (!verification.ok) throw new Error(verification.code);
  if (expectedService !== void 0 && packet.manifest.source.service !== expectedService) throw new Error("catalog-wrong-service");
  if (files.length !== packet.asset_bindings.length + 1) throw new Error("catalog-extra-or-missing-files");
  const prefix = name.slice(0, -"edit-packet.json".length), assets = new Map(packet.manifest.segments.filter((item) => item.asset).map((item) => [item.asset.sha256, item.asset])), validated = /* @__PURE__ */ new Map();
  const context = Object.freeze({
    releaseId: packet.packet_id,
    manifestVersion: packet.manifest.manifest_version,
    manifestSha256: await sha256Text(bytes2),
    assetSetSha256: await sha256Text(packet.asset_bindings.map((binding) => `${binding.sha256}:${binding.bytes}`).sort().join("\n"))
  });
  assertActive(signal);
  let checked = 0;
  for (const binding of packet.asset_bindings) {
    assertActive(signal);
    const selected = byName.get((prefix + binding.relative_path).toLowerCase()), asset = assets.get(binding.sha256);
    if (!selected || selected.file.size !== binding.bytes) throw new Error("catalog-bound-file-mismatch");
    const result = await validateAsset2(selected.file, {
      sha256: asset.sha256,
      durationMs: asset.expected_duration_ms,
      durationToleranceMs: 100,
      container: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      width: asset.width,
      height: asset.height,
      dynamicRange: asset.dynamic_range
    }, { profileClass: "catalog-v2", signal, context });
    assertActive(signal);
    if (!result.ok) throw new Error("catalog-local-media-invalid");
    validated.set(binding.sha256, selected.file);
    checked += 1;
    try {
      onAssetChecked?.(checked, packet.asset_bindings.length);
    } catch {
    }
  }
  return { packet, verification, files: validated };
}

// extension/src/catalog-activation-store.mjs
var MAX_RECORD_BYTES = 2e6;
function encoded(value) {
  return new TextEncoder().encode(JSON.stringify(value));
}
async function catalogRecordDigest(record, cryptoApi = globalThis.crypto) {
  if (!record || encoded(record).length > MAX_RECORD_BYTES) throw Error("catalog-cache-invalid");
  const bytes2 = new TextEncoder().encode(canonicalizeManifest(record));
  return Array.from(new Uint8Array(await cryptoApi.subtle.digest("SHA-256", bytes2)), (value) => value.toString(16).padStart(2, "0")).join("");
}

// extension/src/catalog-playback-session.mjs
var CatalogPlaybackSession = class {
  constructor({
    activationStore,
    readPolicy,
    expectedService,
    validateAsset: validateAsset2,
    createObjectURL = (file) => URL.createObjectURL(file),
    revokeObjectURL = (url) => URL.revokeObjectURL(url),
    prepareFiles = async (files) => files
  }) {
    if (!activationStore?.accept || !activationStore?.compile || typeof readPolicy !== "function" || typeof expectedService !== "string" || !expectedService) throw Error("catalog-session-configuration-invalid");
    this.store = activationStore;
    this.readPolicy = readPolicy;
    this.expectedService = expectedService;
    this.validateAsset = validateAsset2;
    this.createObjectURL = createObjectURL;
    this.revokeObjectURL = revokeObjectURL;
    this.prepareFiles = prepareFiles;
    this.operations = new OperationContext();
    this.current = null;
  }
  clear() {
    this.operations.invalidate("catalog-import-cleared");
    if (this.current) for (const url of this.current.urls.values()) this.revokeObjectURL(url);
    this.current = null;
  }
  async importFiles(files, { signal: callerSignal, onProgress } = {}) {
    assertActive(callerSignal);
    this.clear();
    const operation = this.operations.capture(), urls = /* @__PURE__ */ new Map();
    const signal = callerSignal ? AbortSignal.any([operation.signal, callerSignal]) : operation.signal;
    const assertCurrent = () => {
      assertActive(signal);
      operation.assertCurrent();
    };
    try {
      const policy = await this.readPolicy({ signal });
      assertCurrent();
      const loaded = await loadCatalogPacket(files, policy.trustedKeys, {
        capabilities: policy.capabilities,
        expectedService: this.expectedService,
        signal,
        validateAsset: this.validateAsset,
        onAssetChecked: onProgress
      });
      assertCurrent();
      const latest = await this.readPolicy({ signal });
      assertCurrent();
      const activation = await this.store.accept(loaded.packet, { ...latest, signal });
      assertCurrent();
      if (activation.status === "disabled") throw Error("catalog-playback-disabled");
      if (!/^[a-f0-9]{64}$/.test(activation.storageRevisionDigest ?? "")) throw Error("catalog-storage-revision-required");
      const playable = await this.prepareFiles(loaded.files, { signal });
      assertCurrent();
      for (const [hash2, file] of playable) urls.set(hash2, this.createObjectURL(file));
      this.current = { packet: structuredClone(loaded.packet), urls, storageRevisionDigest: activation.storageRevisionDigest };
      return Object.freeze({
        releaseId: loaded.packet.packet_id,
        playbackEditId: loaded.packet.manifest.edit_id,
        version: loaded.packet.manifest.manifest_version,
        actionCount: loaded.packet.manifest.segments.length,
        assetCount: urls.size
      });
    } catch (error) {
      for (const url of urls.values()) this.revokeObjectURL(url);
      throw error;
    }
  }
  async actions(observedSource, { signal: callerSignal } = {}) {
    assertActive(callerSignal);
    const operation = this.operations.capture(), current = this.current;
    const signal = callerSignal ? AbortSignal.any([operation.signal, callerSignal]) : operation.signal;
    const assertCurrent = () => {
      assertActive(signal);
      operation.assertCurrent();
    };
    if (!current) throw Error("catalog-import-required");
    const policy = await this.readPolicy({ signal });
    assertCurrent();
    const actions = await this.store.compile(current.packet, {
      ...policy,
      observedSource,
      signal,
      resolveAssetUrl: (hash2) => current.urls.has(hash2) ? `asset:${hash2}` : null
    });
    assertCurrent();
    return actions;
  }
  description() {
    if (!this.current) throw Error("catalog-import-required");
    return structuredClone({ packet_id: this.current.packet.packet_id, manifest: this.current.packet.manifest });
  }
  async storageChangeRequiresInvalidation(record) {
    const current = this.current;
    if (!current) return false;
    let revision = null;
    try {
      revision = await catalogRecordDigest(record);
    } catch {
    }
    return this.current === current && revision !== current.storageRevisionDigest;
  }
  // Only the private renderer may resolve an opaque scheduler reference.
  resolveAsset(reference) {
    if (typeof reference !== "string" || !/^asset:[a-f0-9]{64}$/.test(reference)) throw Error("catalog-asset-reference-invalid");
    const url = this.current?.urls.get(reference.slice(6));
    if (!url) throw Error("catalog-local-asset-unresolved");
    return url;
  }
};

// extension/src/staging-failure.mjs
var phases = /* @__PURE__ */ new Set(["prepare", "overlay-host", "overlay-mount", "overlay-show"]);
var kinds = /* @__PURE__ */ new Set(["timeout", "cancelled", "error"]);
function sanitizeStagingFailure(value) {
  return Object.freeze({
    phase: phases.has(value?.phase) ? value.phase : "unknown",
    kind: kinds.has(value?.kind) ? value.kind : "unknown"
  });
}
function stagingFailureFromError(error) {
  try {
    const name = error?.name;
    const typed = ["TransitionStepError", "TransitionTimeoutError"].includes(name);
    return sanitizeStagingFailure({
      phase: typed ? error.phase : null,
      kind: name === "AbortError" ? "cancelled" : name === "TransitionTimeoutError" ? "timeout" : typed ? "error" : null
    });
  } catch {
    return sanitizeStagingFailure(null);
  }
}

// extension/src/manifest-action-scheduler.mjs
var LOCAL_ACTIONS = /* @__PURE__ */ new Set(["REPLACE", "INSERT"]);
var MIN_ENTRY_REMAINING_MS = 1e3;
function boundedPlaybackState(state) {
  if (!Number.isFinite(state?.currentTimeMs) || state.currentTimeMs < 0) {
    throw new TypeError("A non-negative playback time is required");
  }
  if (typeof state.paused !== "boolean") throw new TypeError("A playback pause state is required");
  if (!["tick", "seek"].includes(state.event ?? "tick")) throw new TypeError("Unsupported playback event");
  return { currentTimeMs: state.currentTimeMs, paused: state.paused, event: state.event ?? "tick" };
}
var ManifestActionScheduler = class {
  constructor({ actions, executor, preloadWindowMs = 1e4, stageWindowMs = 1500, chainGapMs = null, enterReplacedOnSeek = false, onEvent = null }) {
    if (!Array.isArray(actions) || actions.length === 0) throw new TypeError("At least one action is required");
    this.actions = actions;
    this.executor = executor;
    if (!Number.isFinite(preloadWindowMs) || preloadWindowMs < 0 || preloadWindowMs > 6e4) {
      throw new TypeError("preloadWindowMs must be between 0 and 60000");
    }
    this.preloadWindowMs = preloadWindowMs;
    if (!Number.isFinite(stageWindowMs) || stageWindowMs < 0 || stageWindowMs > 6e4) {
      throw new TypeError("stageWindowMs must be between 0 and 60000");
    }
    this.stageWindowMs = Math.min(stageWindowMs, preloadWindowMs);
    this.stagedActionId = null;
    if (chainGapMs !== null && (!Number.isFinite(chainGapMs) || chainGapMs < 0 || chainGapMs > 1e3)) {
      throw new TypeError("chainGapMs must be null or between 0 and 1000");
    }
    this.chainGapMs = chainGapMs;
    this.nextPreloadActionId = null;
    this.enterReplacedOnSeek = enterReplacedOnSeek === true;
    this.entryActionId = null;
    this.statuses = new Map(actions.map((action) => [action.id, "pending"]));
    this.preflightStatuses = new Map(actions.filter((action) => LOCAL_ACTIONS.has(action.type)).map((action) => [action.id, "idle"]));
    this.preloadRunning = null;
    this.preloadingAction = null;
    this.previousTimeMs = null;
    this.activeMute = null;
    this.running = null;
    this.runningAction = null;
    this.cancelled = false;
    this.cancellation = null;
    this.events = [];
    this.onEvent = typeof onEvent === "function" ? onEvent : null;
    this.droppedEvents = 0;
    this.observerFailures = 0;
    this.generation = 0;
    this.seeking = null;
  }
  snapshot() {
    return Object.freeze({
      statuses: Object.freeze(Object.fromEntries(this.statuses)),
      preflightStatuses: Object.freeze(Object.fromEntries(this.preflightStatuses)),
      activeMuteId: this.activeMute?.id ?? null,
      runningActionId: this.runningAction?.id ?? null,
      retention: Object.freeze({ maximumEvents: 2e3, droppedEvents: this.droppedEvents, observerFailures: this.observerFailures }),
      events: Object.freeze(this.events.map((event) => Object.freeze({ ...event })))
    });
  }
  record(action, outcome, reason = null, failure2 = null) {
    const event = Object.freeze({
      actionId: action.id,
      type: action.type,
      outcome,
      reason,
      ...outcome === "stage-failed" && failure2 ? { failure: failure2 } : {}
    });
    this.events.push(event);
    if (this.events.length > 2e3) {
      this.events.shift();
      this.droppedEvents++;
    }
    try {
      const result = this.onEvent?.(event);
      if (result && typeof result.then === "function") {
        this.observerFailures++;
        void Promise.resolve(result).catch(() => {
        });
      }
    } catch {
      this.observerFailures++;
    }
  }
  startEligiblePreload(currentTimeMs, { allowAnchor = false } = {}) {
    if (this.cancelled || this.preloadRunning || this.running) return null;
    const action = this.actions.find(
      (candidate) => LOCAL_ACTIONS.has(candidate.type) && this.statuses.get(candidate.id) === "pending"
    );
    if (!action || this.preflightStatuses.get(action.id) !== "idle" || action.id !== this.entryActionId && (allowAnchor ? currentTimeMs > action.triggerMs : currentTimeMs >= action.triggerMs) || action.triggerMs - currentTimeMs > this.preloadWindowMs) return null;
    if (typeof this.executor.preloadLocal !== "function") {
      this.preflightStatuses.set(action.id, "failed");
      this.record(action, "preflight-failed", "preload-unavailable");
      return Promise.resolve(this.snapshot());
    }
    this.preloadingAction = action;
    this.preflightStatuses.set(action.id, "preloading");
    this.record(action, "preflight-started");
    const generation = this.generation;
    const task = Promise.resolve().then(() => {
      if (generation !== this.generation || this.cancelled) return;
      return this.executor.preloadLocal(action);
    }).then(() => {
      if (generation !== this.generation || this.cancelled) return;
      this.preflightStatuses.set(action.id, "ready");
      this.record(action, "preflight-ready");
    }).catch((error) => {
      if (generation !== this.generation || this.cancelled) return;
      const cancelled2 = error?.name === "AbortError";
      this.preflightStatuses.set(action.id, cancelled2 ? "idle" : "failed");
      this.record(action, cancelled2 ? "preflight-cancelled" : "preflight-failed", cancelled2 ? "cancelled" : "not-ready");
    }).finally(() => {
      if (this.preloadRunning === task) {
        this.preloadRunning = null;
        this.preloadingAction = null;
      }
    }).then(() => this.snapshot());
    this.preloadRunning = task;
    return task;
  }
  // The pending local actions that follow `action` closely enough to play inside
  // its cover: each must start within chainGapMs of the previous one's join.
  adjacentChain(action) {
    if (this.chainGapMs === null) return [];
    const chain = [];
    let previous = action;
    for (const candidate of this.pendingLocalAfter(action)) {
      const gap = candidate.triggerMs - previous.resumeMs;
      if (gap < 0 || gap > this.chainGapMs || chain.length >= 32) break;
      chain.push(candidate);
      previous = candidate;
    }
    return chain;
  }
  pendingLocalAfter(action) {
    return this.actions.filter((candidate) => candidate !== action && LOCAL_ACTIONS.has(candidate.type) && this.statuses.get(candidate.id) === "pending" && candidate.triggerMs >= action.triggerMs).sort((left, right) => left.triggerMs - right.triggerMs);
  }
  // While a clip plays, load the next local clip (after any chain) into the
  // standby decoder so a scene shortly after this one is ready at its trigger.
  startNextPreload() {
    const running = this.runningAction;
    if (!running || !LOCAL_ACTIONS.has(running.type) || typeof this.executor.preloadNextLocal !== "function") return;
    const chain = this.runningChain ?? [];
    if (chain.length && running !== chain.at(-1)) return;
    const last = chain.at(-1) ?? running;
    const next = this.pendingLocalAfter(last).find((candidate) => !chain.includes(candidate));
    if (!next || this.nextPreloadActionId === next.id || this.preflightStatuses.get(next.id) !== "idle") return;
    if (next.triggerMs - last.resumeMs > this.preloadWindowMs) return;
    this.nextPreloadActionId = next.id;
    const generation = this.generation;
    this.preflightStatuses.set(next.id, "preloading");
    this.record(next, "preflight-started", "during-previous");
    void Promise.resolve().then(() => this.executor.preloadNextLocal(next)).then(
      () => {
        if (generation === this.generation && !this.cancelled && this.preflightStatuses.get(next.id) === "preloading") {
          this.preflightStatuses.set(next.id, "ready");
          this.record(next, "preflight-ready", "during-previous");
        }
      },
      () => {
        if (generation === this.generation && !this.cancelled && this.preflightStatuses.get(next.id) === "preloading") {
          this.preflightStatuses.set(next.id, "idle");
          this.record(next, "preflight-failed", "during-previous");
        }
      }
    ).finally(() => {
      if (this.nextPreloadActionId === next.id) this.nextPreloadActionId = null;
    });
  }
  // Once the next local action is preloaded and its trigger is close, let the
  // executor stage it so the cut itself needs no renderer round trips. Staging
  // is an optimisation: failure is recorded and the action still runs unstaged.
  startEligibleStage(currentTimeMs) {
    if (this.cancelled || this.running || this.preloadRunning || typeof this.executor.stageLocal !== "function") return;
    const action = this.actions.find((candidate) => LOCAL_ACTIONS.has(candidate.type) && this.statuses.get(candidate.id) === "pending");
    if (!action || this.stagedActionId === action.id || this.preflightStatuses.get(action.id) !== "ready") return;
    const leadMs = action.triggerMs - currentTimeMs;
    if (leadMs < 0 || leadMs > this.stageWindowMs) return;
    this.stagedActionId = action.id;
    const generation = this.generation;
    this.record(action, "stage-started");
    void Promise.resolve().then(() => {
      if (generation !== this.generation || this.cancelled) return;
      return this.executor.stageLocal(action);
    }).then(
      (staged) => {
        if (generation === this.generation && !this.cancelled && staged) this.record(action, "staged");
      },
      (error) => {
        if (generation === this.generation && !this.cancelled) this.record(action, "stage-failed", "unstaged-fallback", stagingFailureFromError(error));
      }
    );
  }
  observe(playbackState) {
    const state = boundedPlaybackState(playbackState);
    if (this.cancelled) return null;
    if (state.event === "seek") return this.handleSeek(state.currentTimeMs, { playing: state.paused === false });
    if (this.seeking) return this.seeking;
    const previousTimeMs = this.previousTimeMs;
    this.previousTimeMs = state.currentTimeMs;
    if (this.running) {
      this.startNextPreload();
      return this.running;
    }
    if (previousTimeMs === null) {
      for (const action of this.actions) {
        if (action.triggerMs < state.currentTimeMs && this.statuses.get(action.id) === "pending") {
          this.statuses.set(action.id, "skipped");
          this.record(action, "skipped", "armed-after-trigger");
        }
      }
    }
    const preloadWork = this.startEligiblePreload(state.currentTimeMs);
    this.startEligibleStage(state.currentTimeMs);
    const work = [];
    if (this.activeMute && state.currentTimeMs >= this.activeMute.resumeMs) {
      work.push({ kind: "finish-mute", action: this.activeMute });
    }
    if (!state.paused && previousTimeMs !== null) {
      for (const action of this.actions) {
        if (this.statuses.get(action.id) === "pending" && state.currentTimeMs >= action.triggerMs) {
          if (action.id === this.entryActionId && this.preflightStatuses.get(action.id) !== "ready") {
            if (this.preflightStatuses.get(action.id) === "failed" || state.currentTimeMs >= action.resumeMs - MIN_ENTRY_REMAINING_MS) {
              this.entryActionId = null;
              this.statuses.set(action.id, "skipped");
              this.record(action, "skipped", "seek-entry-not-ready");
            }
            continue;
          }
          work.push({ kind: "start", action });
          break;
        }
      }
    }
    if (work.length === 0) return preloadWork;
    const generation = this.generation;
    const task = Promise.resolve().then(() => this.runWork(work, state.currentTimeMs, generation)).finally(() => {
      if (this.running === task) {
        this.running = null;
        this.runningAction = null;
        this.runningChain = null;
      }
    });
    this.running = task;
    return task;
  }
  async runWork(work, observedTimeMs, generation = this.generation) {
    for (const item of work) {
      if (this.cancelled || generation !== this.generation) break;
      const action = item.action;
      if (item.kind === "finish-mute") {
        if (this.activeMute?.id !== action.id) continue;
        await this.executor.finishMute(action);
        if (generation !== this.generation) break;
        this.activeMute = null;
        this.statuses.set(action.id, "completed");
        this.record(action, "completed");
        continue;
      }
      if (this.statuses.get(action.id) !== "pending") continue;
      if (LOCAL_ACTIONS.has(action.type) && action.type !== "INSERT" && observedTimeMs >= action.resumeMs) {
        this.statuses.set(action.id, "skipped");
        this.record(action, "skipped", "missed-interval");
        await this.cancelActivePreload("missed-interval");
        continue;
      }
      if (LOCAL_ACTIONS.has(action.type) && this.preflightStatuses.get(action.id) !== "ready" && !item.entry) {
        await this.cancelActivePreload("trigger-before-ready");
        if (generation !== this.generation || this.cancelled) break;
        this.statuses.set(action.id, "skipped");
        this.record(action, "skipped", "preflight-not-ready");
        continue;
      }
      this.runningAction = action;
      this.statuses.set(action.id, "running");
      this.record(action, "running");
      try {
        if (LOCAL_ACTIONS.has(action.type)) {
          const chain = this.adjacentChain(action);
          this.runningChain = chain;
          const onAdvance = (id2) => {
            const member = chain.find((candidate) => candidate.id === id2);
            if (!member || generation !== this.generation) return;
            this.statuses.set(this.runningAction.id, "completed");
            this.preflightStatuses.set(this.runningAction.id, "consumed");
            this.record(this.runningAction, "completed", "chained");
            this.runningAction = member;
            this.statuses.set(member.id, "running");
            this.record(member, "running", "chained");
          };
          const options = chain.length ? { chain, onAdvance } : {};
          if (action.id === this.entryActionId) {
            this.entryActionId = null;
            const fraction = (observedTimeMs - action.triggerMs) / (action.resumeMs - action.triggerMs);
            if (fraction > 0) options.entryFraction = Math.min(fraction, 0.99);
          }
          const result = Object.keys(options).length ? await this.executor.executeLocal(action, observedTimeMs, options) : await this.executor.executeLocal(action, observedTimeMs);
          if (generation !== this.generation || this.cancelled) break;
          const finished = this.runningAction ?? action;
          this.statuses.set(finished.id, "completed");
          this.preflightStatuses.set(finished.id, "consumed");
          this.previousTimeMs = finished.resumeMs;
          this.record(finished, "completed");
          for (const member of chain) if (!(result?.chained ?? []).includes(member.id) && this.statuses.get(member.id) === "pending") this.preflightStatuses.set(member.id, this.preflightStatuses.get(member.id) === "ready" ? "ready" : "idle");
        } else if (action.type === "SKIP") {
          await this.executor.executeSkip(action);
          if (generation !== this.generation || this.cancelled) break;
          this.statuses.set(action.id, "completed");
          this.previousTimeMs = action.resumeMs;
          this.record(action, "completed");
        } else if (action.type === "MUTE") {
          await this.executor.startMute(action);
          if (generation !== this.generation || this.cancelled) break;
          this.activeMute = action;
          this.statuses.set(action.id, "active");
          this.record(action, "started");
          if (observedTimeMs >= action.resumeMs) {
            await this.executor.finishMute(action);
            this.activeMute = null;
            this.statuses.set(action.id, "completed");
            this.record(action, "completed");
          }
        }
      } catch (error) {
        if (generation !== this.generation || this.cancelled) break;
        const cancelled2 = error?.name === "AbortError";
        const failed = LOCAL_ACTIONS.has(action.type) ? this.runningAction ?? action : action;
        this.statuses.set(failed.id, cancelled2 ? "cancelled" : "failed");
        this.record(failed, cancelled2 ? "cancelled" : "failed");
      }
    }
    return this.snapshot();
  }
  handleSeek(targetTimeMs, { playing = false } = {}) {
    if (this.cancelled) return Promise.resolve(this.snapshot());
    const generation = ++this.generation;
    this.stagedActionId = null;
    this.executor.invalidate?.("native-seek");
    const cancellation = this.running || this.seeking ? Promise.resolve(this.executor.cancel?.("native-seek")) : Promise.resolve();
    const previousSeek = this.seeking;
    const task = Promise.resolve().then(async () => {
      await cancellation;
      await previousSeek?.catch(() => {
      });
      if (generation !== this.generation || this.cancelled) return this.snapshot();
      const snapshot = await this.finishSeek(targetTimeMs, generation, { playing });
      if (this.immediateEntry && generation === this.generation && !this.cancelled) this.startImmediateEntry(generation);
      return snapshot;
    }).finally(() => {
      if (this.seeking === task) this.seeking = null;
    });
    this.seeking = task;
    return task;
  }
  // A playing viewer seeked into a replaced interval: enter now. The engine holds
  // and covers native before the clip loads, so waiting for a preload and the next
  // position sample would only leave the removed footage playing meanwhile.
  startImmediateEntry(generation) {
    const { action, targetTimeMs } = this.immediateEntry;
    this.immediateEntry = null;
    if (this.running || this.statuses.get(action.id) !== "pending") return;
    const task = Promise.resolve().then(() => this.runWork([{ kind: "start", action, entry: true }], targetTimeMs, generation)).finally(() => {
      if (this.running === task) {
        this.running = null;
        this.runningAction = null;
        this.runningChain = null;
      }
    });
    this.running = task;
    task.catch(() => {
    });
  }
  async finishSeek(targetTimeMs, generation, { playing = false } = {}) {
    this.immediateEntry = null;
    await this.cancelActivePreload("native-seek");
    if (this.running) {
      await this.executor.cancel?.("native-seek");
      await this.running.catch(() => {
      });
    }
    if (this.activeMute) {
      const action = this.activeMute;
      await this.executor.finishMute(action);
      this.activeMute = null;
      this.statuses.set(action.id, "cancelled");
      this.record(action, "cancelled-by-seek");
    }
    if (this.cancelled || generation !== this.generation) return this.snapshot();
    await this.executor.honorNativeSeek?.(targetTimeMs);
    if (this.cancelled || generation !== this.generation) return this.snapshot();
    this.entryActionId = null;
    for (const action of this.actions) {
      const beforeTrigger = targetTimeMs <= action.triggerMs;
      const inside = !beforeTrigger && this.enterReplacedOnSeek && this.entryActionId === null && action.type === "REPLACE" && action.resumeMs - targetTimeMs >= MIN_ENTRY_REMAINING_MS;
      if (inside) this.entryActionId = action.id;
      if (!beforeTrigger && !inside && targetTimeMs >= action.resumeMs && this.statuses.get(action.id) === "completed") continue;
      this.statuses.set(action.id, beforeTrigger || inside ? "pending" : "skipped");
      this.record(action, beforeTrigger || inside ? "reset-pending" : "skipped", beforeTrigger ? "seek-at-or-before-trigger" : inside ? "seek-into-replaced" : "seek-after-trigger");
      if (LOCAL_ACTIONS.has(action.type)) this.preflightStatuses.set(action.id, "idle");
    }
    this.previousTimeMs = targetTimeMs;
    if (playing && this.entryActionId !== null) {
      this.immediateEntry = { action: this.actions.find((action) => action.id === this.entryActionId), targetTimeMs };
      return this.snapshot();
    }
    await this.startEligiblePreload(targetTimeMs, { allowAnchor: true });
    return this.snapshot();
  }
  cancelAll(reason = "action-plan-cancelled") {
    if (this.cancellation) return this.cancellation;
    this.cancelled = true;
    this.generation += 1;
    this.executor.invalidate?.(reason);
    if (this.running || this.seeking) void Promise.resolve(this.executor.cancel?.(reason)).catch(() => {
    });
    for (const action of this.actions) {
      if (["pending", "running", "active"].includes(this.statuses.get(action.id))) {
        this.statuses.set(action.id, "cancelled");
        this.record(action, "cancelled", "plan-cancelled");
      }
    }
    this.cancellation = this.finishCancellation(reason);
    return this.cancellation;
  }
  async finishCancellation(reason) {
    await this.cancelActivePreload(reason);
    if (this.running) {
      await this.executor.cancel?.(reason);
      await this.running.catch(() => {
      });
    }
    if (this.activeMute) {
      const action = this.activeMute;
      await this.executor.finishMute(action);
      this.activeMute = null;
      this.statuses.set(action.id, "cancelled");
      this.record(action, "mute-stopped");
    }
    for (const action of this.actions) {
      if (["pending", "running", "active"].includes(this.statuses.get(action.id))) {
        this.statuses.set(action.id, "cancelled");
      }
    }
    this.previousTimeMs = null;
    return this.snapshot();
  }
  async cancelActivePreload(reason) {
    const task = this.preloadRunning;
    const prepared = [...this.preflightStatuses.values()].some((status) => status === "ready" || status === "preloading");
    if (!task && !prepared) return;
    await this.executor.cancelPreload?.(reason);
    await task?.catch(() => {
    });
    for (const [id2, status] of this.preflightStatuses) {
      if (status === "ready" || status === "preloading") this.preflightStatuses.set(id2, "idle");
    }
    this.stagedActionId = null;
  }
};

// extension/src/playback-session.mjs
function createGuardedExecutor(base, checkSource) {
  const context = new OperationContext();
  const guarded = (method) => async (...args) => {
    const operation = context.capture();
    await checkSource(operation);
    operation.assertCurrent();
    return base[method](...args);
  };
  const executeLocal = async (action, observedTimeMs, options = {}) => {
    if (options.entryFraction === void 0) return guarded("executeLocal")(action, observedTimeMs, options);
    const operation = context.capture();
    const check2 = Promise.resolve().then(() => checkSource(operation)).then(() => operation.assertCurrent());
    check2.catch(() => {
    });
    return base.executeLocal(action, observedTimeMs, { ...options, entryGate: options.entryGate ? Promise.all([options.entryGate, check2]) : check2 });
  };
  return {
    preloadLocal: guarded("preloadLocal"),
    executeLocal,
    ...typeof base.stageLocal === "function" ? { stageLocal: guarded("stageLocal") } : {},
    ...typeof base.preloadNextLocal === "function" ? { preloadNextLocal: guarded("preloadNextLocal") } : {},
    executeSkip: guarded("executeSkip"),
    startMute: guarded("startMute"),
    finishMute: (...args) => base.finishMute(...args),
    honorNativeSeek: (...args) => base.honorNativeSeek(...args),
    invalidate(reason) {
      context.invalidate(reason);
      base.invalidate?.(reason);
    },
    cancel(reason) {
      this.invalidate(reason);
      return base.cancel(reason);
    },
    cancelPreload(reason) {
      context.invalidate(reason);
      return base.cancelPreload(reason);
    }
  };
}

// packet-core/client/disk-staging.mjs
async function createDiskStaging({ root, budgetBytes, signal, authorize = () => {
}, estimate, cryptoApi = globalThis.crypto }) {
  insist(root?.getDirectoryHandle && root?.removeEntry && Number.isSafeInteger(budgetBytes) && budgetBytes > 0 && budgetBytes <= 401e7, "staging-policy");
  const check2 = () => {
    if (signal?.aborted) throw Error("staging-cancelled");
    authorize();
  };
  check2();
  if (estimate) {
    const quota = await estimate();
    check2();
    insist(Number.isFinite(quota.quota) && Number.isFinite(quota.usage) && quota.quota - quota.usage >= budgetBytes, "staging-quota");
  }
  const name = `job-${cryptoApi.randomUUID()}`;
  const directory = await root.getDirectoryHandle(name, { create: true });
  let closed = false;
  let reserved = 0;
  const files = /* @__PURE__ */ new Map();
  const pending = /* @__PURE__ */ new Set();
  const active = () => {
    check2();
    if (closed) throw Error("staging-closed");
  };
  function track(fn) {
    const p2 = Promise.resolve().then(fn);
    pending.add(p2);
    p2.finally(() => pending.delete(p2)).catch(() => {
    });
    return p2;
  }
  const area = {
    async createSink(id2, maximum, expected) {
      active();
      insist(isId(id2) && !files.has(id2) && Number.isSafeInteger(maximum) && maximum > 0 && (expected === void 0 || Number.isSafeInteger(expected) && expected > 0 && expected <= maximum) && reserved + maximum <= budgetBytes, "staging-reservation");
      reserved += maximum;
      const record = { handle: null, writer: null, state: "opening", written: 0, maximum, expected, tail: Promise.resolve() };
      files.set(id2, record);
      try {
        await track(async () => {
          record.handle = await directory.getFileHandle(id2, { create: true });
          active();
          record.writer = await record.handle.createWritable();
          active();
          record.state = "writing";
        });
      } catch (e) {
        await area.abort();
        throw e;
      }
      const serial = (operation) => {
        const p2 = record.tail.then(() => track(operation));
        record.tail = p2.catch(() => {
        });
        return p2;
      };
      return Object.freeze({
        write(value) {
          insist(!record.inFlight, "staging-write-busy");
          insist(value instanceof Uint8Array && value.byteLength <= 4194304, "staging-chunk");
          record.inFlight = true;
          const owned = value.slice();
          return serial(async () => {
            try {
              active();
              insist(record.state === "writing" && record.written + owned.length <= maximum, "staging-byte-limit");
              await record.writer.write(owned);
              record.written += owned.length;
              active();
            } finally {
              owned.fill(0);
              record.inFlight = false;
            }
          });
        },
        // E61 (0.62.20): an interrupted object restarts from byte 0 when the server ignores a
        // Range request; the area and its other objects are kept.
        reset() {
          return serial(async () => {
            active();
            insist(record.state === "writing", "staging-reset");
            await record.writer.truncate(0);
            await record.writer.seek?.(0);
            record.written = 0;
            active();
          });
        },
        get written() {
          return record.written;
        },
        commit() {
          return serial(async () => {
            active();
            insist(record.state === "writing" && record.written > 0 && (expected === void 0 || record.written === expected), "staging-incomplete");
            await record.writer.close();
            record.writer = null;
            active();
            const file = await record.handle.getFile();
            active();
            insist(file instanceof Blob && file.size === record.written, "staging-size");
            record.state = "committed";
            return file;
          });
        },
        async abort() {
          await area.abort();
        }
      });
    },
    async read(id2) {
      active();
      const record = files.get(id2);
      insist(record?.state === "committed", "staging-not-committed");
      const blob = await record.handle.getFile();
      active();
      insist(blob.size === record.written, "staging-size");
      return blob;
    },
    async abort() {
      closed = true;
      await Promise.allSettled([...pending]);
      await Promise.allSettled([...files.values()].map((r2) => r2.tail));
      const stopped = await Promise.allSettled([...files.values()].map(async (r2) => {
        if (r2.writer) {
          await r2.writer.abort();
          r2.writer = null;
        }
      }));
      try {
        await root.removeEntry(name, { recursive: true });
      } catch (e) {
        if (e.name !== "NotFoundError") throw Error("staging-cleanup-failed");
      }
      if (stopped.some((r2) => r2.status === "rejected")) throw Error("staging-writer-cleanup-failed");
    }
  };
  try {
    check2();
    return Object.freeze(area);
  } catch (e) {
    await area.abort();
    throw e;
  }
}
function createDiskQuarantine(descriptor, area) {
  const bindings = new Map(requireDescriptor(descriptor).objects.map((o2) => [o2.object_id, o2]));
  const opened = /* @__PURE__ */ new Set();
  const complete = /* @__PURE__ */ new Set();
  let committed = false;
  return Object.freeze({
    async open(binding) {
      const expected = bindings.get(binding.object_id);
      insist(expected && JSON.stringify(binding) === JSON.stringify(expected) && !opened.has(binding.object_id), "quarantine-object");
      opened.add(binding.object_id);
      const sink = await area.createSink(binding.object_id, binding.plaintext_bytes, binding.plaintext_bytes);
      return { write: (value) => sink.write(value), async commit(evidence) {
        insist(evidence.bytes === binding.plaintext_bytes, "quarantine-evidence");
        await sink.commit();
        complete.add(binding.object_id);
      }, abort: () => area.abort() };
    },
    async commit(evidence) {
      insist(complete.size === bindings.size && evidence.length === bindings.size, "quarantine-incomplete");
      committed = true;
    },
    async read(id2) {
      insist(committed && bindings.has(id2), "quarantine-not-committed");
      return area.read(id2);
    },
    async abort() {
      committed = false;
      await area.abort();
    }
  });
}

// packet-core/src/catalog.mjs
async function importProtectedCatalog({ descriptor, license, entries, store, catalogTrust, capabilities, signal, onObject }) {
  const d2 = requireDescriptor(descriptor);
  insist(typeof store?.read === "function", "quarantine-reader-required");
  try {
    const evidence = await importProtectedObjects({ descriptor, license, entries, transaction: store, signal, onObject });
    const packetObject = d2.objects.find((o2) => o2.kind === "packet");
    const packetBlob = await store.read(packetObject.object_id);
    insist(packetBlob instanceof Blob && packetBlob.size === packetObject.plaintext_bytes && packetBlob.size <= LIMITS.packet, "packet-quarantine");
    insist(await digest2(await packetBlob.arrayBuffer()) === evidence.objects.find((o2) => o2.object_id === packetObject.object_id).sha256, "packet-quarantine-digest");
    const packet = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await packetBlob.arrayBuffer()));
    const verification = await verifyCatalogPacket(packet, catalogTrust, { capabilities });
    insist(verification.ok, `inner-catalog-${verification.code}`);
    const media = evidence.objects.filter((o2) => o2.object_id !== packetObject.object_id);
    insist(media.length === packet.asset_bindings.length, "inner-media-set");
    const byHash = /* @__PURE__ */ new Map();
    for (const object of media) {
      insist(!byHash.has(object.sha256), "inner-media-duplicate");
      byHash.set(object.sha256, object);
    }
    for (const binding of packet.asset_bindings) {
      const object = byHash.get(binding.sha256);
      insist(object?.bytes === binding.bytes, "inner-media-binding");
    }
    if (signal?.aborted) throw new Error("operation-cancelled");
    assertLicense(license, descriptor);
    return Object.freeze({ status: "catalog-verified-quarantine", verification, media: evidence.objects });
  } catch (error) {
    await store.abort();
    throw error;
  }
}

// extension/src/protected-playback-session.mjs
function reportPhase(onPhase) {
  let last = null;
  return (name) => {
    if (name === last) return;
    last = name;
    try {
      onPhase?.(name);
    } catch {
    }
  };
}
function downloadProgress(onProgress, phase) {
  return (bytes2, total) => {
    phase("downloading");
    try {
      onProgress?.(bytes2, total);
    } catch {
    }
  };
}
var ProtectedPlaybackSession = class {
  constructor({
    client,
    manager,
    vault,
    root,
    account,
    catalogOptions,
    executor,
    readSource,
    refreshControl,
    estimate,
    storagePolicy = null,
    external = false,
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id2) => clearTimeout(id2)
  }) {
    insist(typeof account === "string" && typeof readSource === "function" && typeof refreshControl === "function" && typeof executor?.cancel === "function", "protected-owner-policy");
    this.catalog = new CatalogPlaybackSession(catalogOptions);
    Object.assign(this, { client, manager, vault, root, account, executor, readSource, refreshControl, estimate, storagePolicy, external, now, setTimer, clearTimer });
    this.externalActions = /* @__PURE__ */ new Map();
    this.externalActive = /* @__PURE__ */ new Set();
    this.generation = 0;
    this.closed = false;
    this.controller = new AbortController();
    this.state = "empty";
    this.retryAt = 0;
  }
  // The viewer's storage budget (Edits tab): make room for `bytes` more, evicting the
  // least recently used kept releases when allowed. Never the one being opened or
  // played, or `keep`.
  async makeRoom(bytes2, keep) {
    const policy = await this.storagePolicy?.();
    if (!policy || !Number.isSafeInteger(policy.budgetBytes) || policy.budgetBytes <= 0) return;
    const kept = await this.vault.list(), open = new Set([keep, this.openingRelease, this.descriptor && requireDescriptor(this.descriptor).release_id].filter(Boolean));
    let used = kept.filter((entry) => entry.releaseId !== keep).reduce((n2, entry) => n2 + entry.bytes, 0);
    if (used + bytes2 <= policy.budgetBytes) return;
    insist(policy.autoEvict !== false, "vault-budget-exceeded");
    for (const entry of [...kept].sort((a2, b2) => a2.lastUsedAt - b2.lastUsedAt)) {
      if (open.has(entry.releaseId)) continue;
      await this.vault.remove(entry.releaseId);
      used -= entry.bytes;
      if (used + bytes2 <= policy.budgetBytes) return;
    }
    insist(used + bytes2 <= policy.budgetBytes, "vault-budget-exceeded");
  }
  // Download and keep a release, and obtain its license, without decrypting or
  // playing it: "Watch this edit" and next-episode preparation. Returns sizes only.
  // onRetry (E61, 0.62.20): telemetry for each per-object download retry (see website-client).
  async acquireOnly(releaseId, { combined = false, onProgress, onPhase, onRetry, pause: pause2, signal: callerSignal } = {}) {
    this.check();
    const phase = reportPhase(onPhase);
    const signal = callerSignal ? AbortSignal.any([callerSignal, this.controller.signal]) : this.controller.signal;
    let ciphertext;
    try {
      if (!await this.vault.has(releaseId)) {
        const staging = async (total) => {
          insist(Number.isSafeInteger(total) && total > 0 && total <= 2005e6, "protected-release-size");
          this.check();
          await this.makeRoom(total, releaseId);
          this.check();
          ciphertext = await createDiskStaging({ root: this.root, budgetBytes: total, signal, estimate: this.estimate });
          return ciphertext;
        };
        phase("requesting");
        const acquired = await this.client.acquire(releaseId, { combined, signal, staging, onProgress: downloadProgress(onProgress, phase), onRetry, pause: pause2 });
        phase("saving");
        this.check();
        await this.vault.save(acquired);
        this.check();
        if (ciphertext) {
          await ciphertext.abort();
          ciphertext = null;
        }
      }
      const kept = await this.vault.load(releaseId);
      this.check();
      phase("licensing");
      await this.manager.obtain(kept.descriptor, this.account, { online: true, signal });
      this.check();
      return Object.freeze({ releaseId, bytes: kept.entries.reduce((n2, [, blob]) => n2 + blob.size, 0) });
    } catch (e) {
      if (ciphertext) await ciphertext.abort().catch(() => {
      });
      throw e;
    }
  }
  /**
   * 0.63.3: after a download, the same checks a first Watch runs (licence from the cache,
   * decrypt, signatures, then every clip's hash, probe and decode through catalogOptions.
   * validateAsset), so the validated cache is warm and the first Watch is fast. Nothing is
   * loaded for playback; the plaintext is removed at the end. Only on an idle owner.
   */
  async prepareOnly(releaseId, { onPhase, onCheck, signal: callerSignal } = {}) {
    this.check();
    insist(!this.pending && this.state === "empty", "protected-owner-busy");
    const phase = reportPhase(onPhase), check2 = (step) => (done, total) => {
      try {
        onCheck?.(step, done, total);
      } catch {
      }
    };
    const signal = callerSignal ? AbortSignal.any([callerSignal, this.controller.signal]) : this.controller.signal;
    let plaintext = null, license = null;
    const task = (async () => {
      const acquired = await this.vault.load(releaseId);
      this.check();
      phase("licensing");
      let issued;
      try {
        issued = await this.manager.obtain(acquired.descriptor, this.account, { online: false, signal });
      } catch {
        issued = await this.manager.obtain(acquired.descriptor, this.account, { online: true, signal });
      }
      license = issued.license;
      this.check();
      phase("verifying");
      const d2 = requireDescriptor(acquired.descriptor);
      plaintext = await createDiskStaging({ root: this.root, budgetBytes: d2.objects.reduce((n2, o2) => n2 + o2.plaintext_bytes, 0), signal, estimate: this.estimate });
      const quarantine = createDiskQuarantine(acquired.descriptor, plaintext);
      const policy = await this.catalog.readPolicy({ signal });
      this.check();
      const result = await importProtectedCatalog({
        ...acquired,
        license,
        store: quarantine,
        catalogTrust: policy.trustedKeys,
        capabilities: policy.capabilities,
        signal,
        onObject: check2("verifying")
      });
      const packetObject = d2.objects.find((o2) => o2.kind === "packet");
      const packetFile = await quarantine.read(packetObject.object_id);
      const packet = JSON.parse(await packetFile.text());
      insist(packet.packet_id === releaseId, "protected-inner-release");
      const files = [new File([packetFile], "edit-packet.json", { type: "application/json" })];
      for (const binding of packet.asset_bindings) {
        const object = result.media.find((o2) => o2.sha256 === binding.sha256);
        insist(object, "protected-media-binding");
        files.push(new File([await quarantine.read(object.object_id)], binding.relative_path, { type: "video/mp4" }));
      }
      phase("checking");
      await loadCatalogPacket(files, policy.trustedKeys, {
        capabilities: policy.capabilities,
        expectedService: this.catalog.expectedService,
        signal,
        validateAsset: this.catalog.validateAsset,
        onAssetChecked: check2("checking")
      });
      this.check();
      return Object.freeze({ releaseId, clips: packet.asset_bindings.length });
    })();
    this.pending = task;
    try {
      return await task;
    } finally {
      if (this.pending === task) this.pending = null;
      if (plaintext) await plaintext.abort().catch(() => {
      });
      if (license) {
        try {
          this.manager.release?.(license);
        } catch {
        }
      }
    }
  }
  async library() {
    this.check();
    return this.vault.list();
  }
  async removeRelease(releaseId) {
    this.check();
    insist(![this.openingRelease, this.descriptor && requireDescriptor(this.descriptor).release_id].includes(releaseId), "vault-release-open");
    await this.vault.remove(releaseId);
  }
  check(generation = this.generation) {
    insist(!this.closed && generation === this.generation && !this.controller.signal.aborted, "protected-owner-cancelled");
  }
  async guard(generation = this.generation) {
    this.check(generation);
    insist(this.license && this.state !== "expired", "protected-license-required");
    const result = await this.manager.guard(this.license);
    this.check(generation);
    return result;
  }
  // onCheck(step, done, total), optional (E60): 'verifying' per decrypted object, then
  // 'checking' per clip. Status only; a throwing observer never affects the load.
  async open(releaseId, { online = true, combined = false, onProgress, onPhase, onCheck, onRetry } = {}) {
    this.check();
    insist(!this.pending && this.state === "empty", "protected-owner-busy");
    const g2 = this.generation, signal = this.controller.signal;
    const task = this.load(releaseId, { online, combined, onProgress, onPhase, onCheck, onRetry, g: g2, signal });
    this.pending = task;
    try {
      return await task;
    } finally {
      if (this.pending === task) this.pending = null;
    }
  }
  async load(releaseId, { online, combined, onProgress, onPhase, onCheck, onRetry, pause: pause2, g: g2, signal }) {
    let ciphertext;
    const phase = reportPhase(onPhase);
    const check2 = (step) => (done, total) => {
      try {
        onCheck?.(step, done, total);
      } catch {
      }
    };
    try {
      this.state = "loading";
      this.openingRelease = releaseId;
      let acquired;
      if (online && await this.vault.has(releaseId)) {
        acquired = await this.vault.load(releaseId);
        this.check(g2);
      } else if (online) {
        const staging = async (total) => {
          insist(Number.isSafeInteger(total) && total > 0 && total <= 2005e6, "protected-release-size");
          this.check(g2);
          await this.makeRoom(total, releaseId);
          this.check(g2);
          ciphertext = await createDiskStaging({ root: this.root, budgetBytes: total, signal, estimate: this.estimate });
          return ciphertext;
        };
        phase("requesting");
        this.check(g2);
        acquired = await this.client.acquire(releaseId, { combined, signal, staging, onProgress: downloadProgress(onProgress, phase), onRetry, pause: pause2 });
        phase("saving");
        this.check(g2);
        await this.vault.save(acquired);
        this.check(g2);
        if (ciphertext) {
          await ciphertext.abort();
          ciphertext = null;
        }
        acquired = await this.vault.load(releaseId);
        this.check(g2);
      } else {
        acquired = await this.vault.load(releaseId);
        this.check(g2);
      }
      this.descriptor = acquired.descriptor;
      phase("licensing");
      const issued = await this.manager.obtain(this.descriptor, this.account, { online, signal });
      this.license = issued.license;
      this.check(g2);
      await this.guard(g2);
      phase("verifying");
      const d2 = requireDescriptor(this.descriptor);
      this.plaintext = await createDiskStaging({ root: this.root, budgetBytes: d2.objects.reduce((n2, o2) => n2 + o2.plaintext_bytes, 0), signal, estimate: this.estimate });
      this.check(g2);
      const quarantine = createDiskQuarantine(this.descriptor, this.plaintext);
      const policy = await this.catalog.readPolicy({ signal });
      this.check(g2);
      const result = await importProtectedCatalog({
        ...acquired,
        license: this.license,
        store: quarantine,
        catalogTrust: policy.trustedKeys,
        capabilities: policy.capabilities,
        signal,
        onObject: check2("verifying")
      });
      await this.guard(g2);
      const packetObject = d2.objects.find((o2) => o2.kind === "packet");
      const packetFile = await quarantine.read(packetObject.object_id);
      const packet = JSON.parse(await packetFile.text());
      insist(packet.packet_id === releaseId, "protected-inner-release");
      const files = [new File([packetFile], "edit-packet.json", { type: "application/json" })];
      for (const binding of packet.asset_bindings) {
        const object = result.media.find((o2) => o2.sha256 === binding.sha256);
        insist(object, "protected-media-binding");
        files.push(new File([await quarantine.read(object.object_id)], binding.relative_path, { type: "video/mp4" }));
      }
      await this.guard(g2);
      phase("checking");
      const summary = await this.catalog.importFiles(files, { signal, onProgress: check2("checking") });
      await this.guard(g2);
      this.state = "ready";
      this.schedule();
      return summary;
    } catch (e) {
      if (ciphertext) await ciphertext.abort();
      this.openingRelease = null;
      await this.releasePlaintext();
      this.state = "failed";
      throw e;
    }
  }
  // Private renderer adapter for the existing native scheduler. The only data
  // returned to its controller is the existing bounded hash-only action list.
  async actions(source, { signal } = {}) {
    insist(this.external, "protected-external-owner-required");
    const g2 = this.generation;
    await this.guard(g2);
    const actions = await this.catalog.actions(source, { signal });
    await this.guard(g2);
    this.externalActions = new Map(actions.map((action) => [action.id, action]));
    return actions;
  }
  async activity(id2, active) {
    insist(this.external, "protected-external-owner-required");
    if (active) {
      await this.guard();
      insist(this.externalActions.has(id2) && !this.externalActive.has(id2), "protected-action-identity");
      this.externalActive.add(id2);
    } else {
      this.externalActive.delete(id2);
    }
  }
  async resolveAsset(reference) {
    await this.guard();
    return this.catalog.resolveAsset(reference);
  }
  async beginLocal() {
    await this.guard();
    insist(this.externalActive.size > 0, "protected-action-required");
  }
  async arm() {
    const g2 = this.generation;
    await this.guard(g2);
    insist(!this.scheduler, "protected-already-armed");
    const source = await this.readSource();
    this.check(g2);
    const actions = await this.catalog.actions(source, { signal: this.controller.signal });
    await this.guard(g2);
    const valid = new Set(actions);
    const dispatch = (method) => async (action, ...args) => {
      insist(valid.has(action), "protected-action-identity");
      await this.guard(g2);
      await this.catalog.actions(await this.readSource(), { signal: this.controller.signal });
      await this.guard(g2);
      const actual = action.clipUrl ? { ...action, clipUrl: this.catalog.resolveAsset(action.clipUrl) } : action;
      return this.executor[method](actual, ...args);
    };
    const base = {
      preloadLocal: dispatch("preloadLocal"),
      executeLocal: dispatch("executeLocal"),
      executeSkip: dispatch("executeSkip"),
      startMute: dispatch("startMute"),
      // Completion/restoration intentionally do not require an unexpired lease.
      finishMute: (...args) => this.executor.finishMute(...args),
      honorNativeSeek: (...args) => this.executor.honorNativeSeek(...args),
      invalidate: (reason) => this.executor.invalidate?.(reason),
      cancel: (reason) => this.executor.cancel(reason),
      cancelPreload: (reason) => this.executor.cancelPreload?.(reason)
    };
    this.scheduler = new ManifestActionScheduler({ actions, executor: createGuardedExecutor(base, () => this.guard(g2)) });
    this.state = "armed";
    return Object.freeze({ actionCount: actions.length });
  }
  observe(state) {
    this.check();
    insist(this.scheduler, "protected-not-armed");
    return this.scheduler.observe(state);
  }
  schedule() {
    if (this.closed || this.timer !== void 0) return;
    this.timer = this.setTimer(() => {
      this.timer = void 0;
      void this.tick().catch(() => {
      }).finally(() => this.schedule());
    }, 1e3);
  }
  async tick() {
    if (this.ticking || this.closed || !this.license) return;
    this.ticking = true;
    const g2 = this.generation;
    try {
      if (this.now() >= (this.controlAt ?? 0) && this.catalog.current) {
        this.controlAt = this.now() + 3e4;
        try {
          const result = await this.refreshControl(this.catalog.description().manifest.edit_id, { signal: this.controller.signal });
          this.check(g2);
          if (result.status === "disabled") {
            await this.stop("catalog-playback-disabled");
            return;
          }
        } catch (e) {
          this.check(g2);
        }
      }
      if (this.scheduler) {
        try {
          await this.catalog.actions(await this.readSource(), { signal: this.controller.signal });
          this.check(g2);
        } catch (e) {
          await this.stop("protected-source-or-catalog-authority-lost");
          throw e;
        }
      }
      let decision;
      try {
        decision = await this.guard(g2);
      } catch (e) {
        if (e.message !== "license-expired" && this.state !== "expired") {
          await this.stop("protected-authority-lost");
          throw e;
        }
        this.state = "expired";
        if (!this.scheduler?.running && !this.scheduler?.activeMute && !this.externalActive.size) await this.stop("protected-expired");
        return;
      }
      if (decision.renewalDue && this.now() >= this.retryAt && !this.scheduler?.running && !this.scheduler?.preloadRunning && !this.externalActive.size) {
        const result = await this.manager.obtain(this.descriptor, this.account, { signal: this.controller.signal });
        this.check(g2);
        const previous = this.license;
        this.license = result.license;
        if (previous !== this.license) this.manager.release(previous);
        this.retryAt = this.now() + (result.status === "renewal-deferred" ? 6e4 : 1e3);
      }
    } catch (e) {
      if (!this.closed && /generation|clock|account-changed|paired-session-changed|cache/.test(e.message)) await this.stop("protected-authority-lost");
      this.retryAt = this.now() + 6e4;
      throw e;
    } finally {
      this.ticking = false;
    }
  }
  async storageChanged(record) {
    if (await this.catalog.storageChangeRequiresInvalidation(record)) await this.stop("catalog-storage-changed");
  }
  async releasePlaintext() {
    this.catalog.clear();
    if (this.license) {
      this.manager.release(this.license);
      this.license = null;
    }
    if (this.plaintext) {
      await this.plaintext.abort();
      this.plaintext = null;
    }
  }
  stop(reason = "protected-stopped", { signOut = false } = {}) {
    if (this.stopping) return this.stopping;
    this.closed = true;
    this.generation++;
    this.controller.abort();
    if (this.timer !== void 0) {
      this.clearTimer(this.timer);
      this.timer = void 0;
    }
    this.executor.invalidate?.(reason);
    this.stopping = (async () => {
      const results = await Promise.allSettled([
        this.scheduler ? this.scheduler.cancelAll(reason) : this.executor.cancel(reason),
        ...signOut ? [this.manager.signOut(), this.vault.clear()] : []
      ]);
      if (this.pending) await this.pending.catch(() => {
      });
      try {
        await this.releasePlaintext();
      } finally {
        this.manager.close();
        this.state = "closed";
      }
      if (results.some((r2) => r2.status === "rejected")) throw Error("protected-restoration-or-cleanup-failed");
    })();
    return this.stopping;
  }
  async signOut() {
    const results = await Promise.allSettled([this.stop("protected-signout"), this.manager.signOut()]);
    await this.vault.clear();
    if (results.some((r2) => r2.status === "rejected")) throw Error("protected-signout-cleanup-failed");
  }
};

// packet-core/client/browser-owner.mjs
async function createProtectedBrowserOwner({
  pairingConfig,
  issuer,
  descriptorTrust,
  licenseTrust,
  account,
  catalogOptions,
  executor,
  readSource,
  refreshControl,
  subscribeSignOut,
  external = false,
  storagePolicy = null,
  lockWaitMs = 0,
  chromeApi = globalThis.chrome,
  navigatorApi = globalThis.navigator,
  locationApi = globalThis.location,
  indexedDB = globalThis.indexedDB,
  fetchImpl = globalThis.fetch
}) {
  if (locationApi?.protocol !== "chrome-extension:" || locationApi.hostname !== chromeApi?.runtime?.id || locationApi.pathname !== "/local-playback-frame.html" || !navigatorApi?.locks?.request || !navigatorApi?.storage?.getDirectory || typeof subscribeSignOut !== "function") throw Error("protected-private-renderer-required");
  if (!Number.isSafeInteger(lockWaitMs) || lockWaitMs < 0 || lockWaitMs > 6e5) throw Error("protected-lock-wait");
  if (!(descriptorTrust instanceof Map) || !(licenseTrust instanceof Map) || !descriptorTrust.size || !licenseTrust.size)
    throw Error("protected-release-trust-required");
  let unlock, alive = true, ready, reject;
  const started = new Promise((a2, b2) => {
    ready = a2;
    reject = b2;
  });
  const held = new Promise((r2) => {
    unlock = r2;
  });
  const lockOptions = lockWaitMs > 0 ? { mode: "exclusive", signal: AbortSignal.timeout(lockWaitMs) } : { mode: "exclusive", ifAvailable: true };
  const task = navigatorApi.locks.request("seamless-protected-owner-candidate-1", lockOptions, async (lock) => {
    if (!lock) throw Error("protected-owner-busy");
    ready();
    await held;
  }).catch((error) => reject(error?.name === "TimeoutError" || error?.name === "AbortError" ? Error("protected-owner-busy") : error));
  await started;
  const installationStore = createInstallationStore({ indexedDB });
  const cache2 = createLeaseCache({ indexedDB });
  let owner, unsubscribe, listener, signingOut;
  const finish = async () => {
    if (!alive) return;
    alive = false;
    unsubscribe?.();
    if (listener) chromeApi.storage.onChanged.removeListener(listener);
    cache2.close();
    installationStore.close();
    unlock();
    await task;
  };
  try {
    const root = await (await navigatorApi.storage.getDirectory()).getDirectoryHandle("seamless-protected-candidate-1", { create: true });
    const vault = await createDiskVault({ root, descriptorTrust, assertOwner: () => {
      if (!alive) throw Error("protected-owner-closed");
    } });
    const contextualFetch = (url, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set("Origin", `chrome-extension://${chromeApi.runtime.id}`);
      return fetchImpl(url, { ...init, headers });
    };
    const client = createPairedProtectedWebsiteClient({
      pairingConfig,
      storage: chromeApi.storage.session,
      locks: navigatorApi.locks,
      fetchImpl: contextualFetch,
      issuer,
      descriptorTrust,
      licenseTrust,
      getInstallation: () => installationStore.getInstallation()
    });
    const manager = createLicenseManager({ cache: cache2, installationStore, client, licenseTrust, issuer });
    owner = new ProtectedPlaybackSession({
      client,
      manager,
      vault,
      root,
      account,
      catalogOptions,
      executor,
      readSource,
      refreshControl,
      external,
      storagePolicy,
      estimate: () => navigatorApi.storage.estimate()
    });
    const signOut = () => signingOut ??= (async () => {
      try {
        await owner.signOut();
      } finally {
        await finish();
      }
    })();
    unsubscribe = subscribeSignOut(signOut);
    listener = (changes, area) => {
      if (area !== "local" || !owner.catalog.current) return;
      const key2 = `catalogActivation.v2.${owner.catalog.description().manifest.edit_id}`;
      if (Object.hasOwn(changes, key2)) void owner.storageChanged(changes[key2].newValue).catch(() => {
      });
    };
    chromeApi.storage.onChanged.addListener(listener);
    return Object.freeze({
      open: (...args) => owner.open(...args),
      // Download-only ("Watch this edit", next episode) and kept-edit management
      // (sizes and ids only; no files or keys).
      acquire: (...args) => owner.acquireOnly(...args),
      // 0.63.3: the first-Watch checks right after a download (warms the validated cache).
      prepare: (...args) => owner.prepareOnly?.(...args),
      library: () => owner.library(),
      remove: (releaseId) => owner.removeRelease(releaseId),
      description: () => owner.catalog.description(),
      actions: (...args) => owner.actions(...args),
      activity: (...args) => owner.activity(...args),
      resolveAsset: (ref) => owner.resolveAsset(ref),
      beginLocal: () => owner.beginLocal(),
      arm: () => owner.arm(),
      observe: (state) => owner.observe(state),
      signOut,
      async close() {
        if (signingOut) return signingOut;
        try {
          await owner.stop();
        } finally {
          await finish();
        }
      }
    });
  } catch (e) {
    if (owner) await owner.stop().catch(() => {
    });
    await finish();
    throw e;
  }
}

// packet-core/client/vault-manager.mjs
async function openVaultManager({
  descriptorTrust,
  lockWaitMs = 5e3,
  navigatorApi = globalThis.navigator,
  chromeApi = globalThis.chrome,
  locationApi = globalThis.location
}) {
  if (locationApi?.protocol !== "chrome-extension:" || locationApi.hostname !== chromeApi?.runtime?.id || locationApi.pathname !== "/viewer-settings.html" || !navigatorApi?.locks?.request || !navigatorApi?.storage?.getDirectory) throw Error("protected-vault-page-required");
  if (!(descriptorTrust instanceof Map) || !descriptorTrust.size) throw Error("protected-release-trust-required");
  async function withVault(work) {
    return navigatorApi.locks.request("seamless-protected-owner-candidate-1", { mode: "exclusive", signal: AbortSignal.timeout(lockWaitMs) }, async () => {
      let open = true;
      const root = await (await navigatorApi.storage.getDirectory()).getDirectoryHandle("seamless-protected-candidate-1", { create: true });
      const vault = await createDiskVault({ root, descriptorTrust, assertOwner: () => {
        if (!open) throw Error("protected-vault-closed");
      } });
      try {
        return await work(vault);
      } finally {
        open = false;
      }
    }).catch((error) => {
      throw error?.name === "TimeoutError" || error?.name === "AbortError" ? Error("protected-owner-busy") : error;
    });
  }
  return Object.freeze({
    list: () => withVault((vault) => vault.list()),
    remove: (releaseId) => withVault((vault) => vault.remove(releaseId))
  });
}

// packet-core/client/browser-account.mjs
async function transact(operation, indexedDB = globalThis.indexedDB) {
  const db = await new Promise((resolve, reject) => {
    const r2 = indexedDB.open("seamless-protected-account-candidate-1", 1);
    r2.onupgradeneeded = () => r2.result.createObjectStore("private");
    r2.onsuccess = () => resolve(r2.result);
    r2.onerror = () => reject(Error("protected-account-storage"));
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("private", "readwrite"), store = tx.objectStore("private");
      let result, error;
      const epoch2 = store.get("generation");
      epoch2.onsuccess = () => {
        const generation = epoch2.result ?? crypto.randomUUID();
        if (!epoch2.result) store.put(generation, "generation");
        const read = store.get("account");
        read.onsuccess = () => {
          try {
            result = operation({ account: read.result ?? null, generation }, store);
          } catch (e) {
            error = e;
            tx.abort();
          }
        };
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(error ?? Error("protected-account-storage"));
    });
  } finally {
    db.close();
  }
}
var privateAccountState = (indexedDB) => transact((state) => state, indexedDB);
function selectPrivateAccount(account, generation, indexedDB) {
  return transact((state, store) => {
    if (state.generation !== generation) throw Error("protected-account-generation-changed");
    if (!/^[a-f0-9-]{36}$/.test(account) || state.account && state.account !== account) throw Error("protected-account-changed");
    store.put(account, "account");
    return account;
  }, indexedDB);
}
function rollbackPrivateAccount(account, generation, indexedDB) {
  return transact((state, store) => {
    if (state.generation === generation && state.account === account) store.delete("account");
  }, indexedDB);
}

// packet-core/client/browser-signout.mjs
import { EXECUTING_BUILD as EXECUTING_BUILD4 } from "../../src/build-info.mjs";
var SIGNOUT_KEY = "protectedSignout.candidate1";

// packet-core/client/browser-entry.mjs
var key = "protectedSignout.candidate1";
var publicKeys = async (entries) => new Map(await Promise.all(entries.map(async ({ kid, jwk }) => {
  if (typeof kid !== "string" || jwk?.kty !== "OKP" || jwk.crv !== "Ed25519" || jwk.d !== void 0) throw Error("protected-public-key-required");
  return [kid, { key: await importJWK(jwk, "EdDSA"), status: "active" }];
})));
async function createConfiguredVaultManager({ trust }) {
  if (!trust?.enabled || !Array.isArray(trust.descriptorKeys)) throw Error("protected-trust-unconfigured");
  return openVaultManager({ descriptorTrust: await publicKeys(trust.descriptorKeys) });
}
async function createConfiguredProtectedOwner({ trust, pairingConfig, online, ...options }) {
  if (!trust?.enabled || trust.fixtureOnly !== pairingConfig.fixtureOnly || !trust.issuer || !Array.isArray(trust.descriptorKeys) || !Array.isArray(trust.licenseKeys)) throw Error("protected-trust-unconfigured");
  const marker = (await chrome.storage.local.get(key))[key];
  const selected = await privateAccountState();
  const account = online ? (await readProtectedPairingCredentials(pairingConfig)).accountId : selected.account;
  if (!account) throw Error("protected-offline-account-unavailable");
  const load = publicKeys;
  let owner, selectedHere = false;
  try {
    owner = await createProtectedBrowserOwner({
      ...options,
      pairingConfig,
      issuer: trust.issuer,
      account,
      descriptorTrust: await load(trust.descriptorKeys),
      licenseTrust: await load(trust.licenseKeys),
      external: true,
      subscribeSignOut(callback) {
        return subscribePrivateSignOut(chrome.runtime, callback);
      }
    });
    if ((await chrome.storage.local.get(key))[key] !== marker) throw Error("protected-signout-race");
    await selectPrivateAccount(account, selected.generation);
    selectedHere = true;
    if ((await chrome.storage.local.get(key))[key] !== marker) throw Error("protected-signout-race");
    return owner;
  } catch (e) {
    try {
      if (selectedHere) await rollbackPrivateAccount(account, selected.generation);
    } finally {
      if (owner) await owner.close();
    }
    throw e;
  }
}
export {
  SIGNOUT_KEY,
  createConfiguredProtectedOwner,
  createConfiguredVaultManager
};
