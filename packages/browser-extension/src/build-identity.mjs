import { EXECUTING_BUILD } from './build-info.mjs';

// Compatibility metadata, not authentication. Chrome sender/port checks still
// establish the origin boundary. Unbuilt source cannot prove byte identity.
export function sameExecutingBuild(value, expected = EXECUTING_BUILD) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === 'adapterVersion,id,mode,version'
    && ['version', 'adapterVersion', 'id', 'mode'].every(key => value[key] === expected[key]);
}
