import test from 'node:test';
import assert from 'node:assert/strict';
import {assertLocalPacketService} from '../src/local-edit-packet.mjs';
test('Prime refuses a native-file packet even when its local media validates',()=>{
 assert.throws(()=>assertLocalPacketService({manifest:{source:{service:'local-native'}}},'prime-video'),/separately aligned/);
 assert.throws(()=>assertLocalPacketService({manifest:{source:{service:'netflix'}}},'prime-video'),/does not match/);
 assert.throws(()=>assertLocalPacketService({},'prime-video'),/does not match/);
 assert.doesNotThrow(()=>assertLocalPacketService({manifest:{source:{service:'prime-video'}}},'prime-video'));
});
