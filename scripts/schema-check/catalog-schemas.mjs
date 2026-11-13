import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// Development verification only: schemas are checked-in trusted inputs. No
// runtime code generation, Ajv dependency or remote schema fetching in Chrome.
export async function loadCatalogSchemas() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
  addFormats(ajv, { mode: 'full', formats: ['date-time'] });
  const validators = {};
  for (const name of ['manifest-v1', 'manifest-v2', 'catalog-packet-v2']) {
    const schema = JSON.parse(await readFile(new URL(`../../packages/browser-extension/schemas/${name}.schema.json`, import.meta.url)));
    ajv.addSchema(schema); validators[name] = ajv.getSchema(schema.$id);
  }
  return validators;
}
