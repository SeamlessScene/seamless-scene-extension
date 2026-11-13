import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionDiagnostics, disconnectNotice, validDisconnectNotice, safeConnectionReport } from '../src/connection-diagnostics.mjs';
import { validLocalMessage } from '../src/local-message-schema.mjs';

test('disconnect notices admit finite reason metadata and reject arbitrary or spoofed data', () => {
  const notice = disconnectNotice('renderer', 'lease-expired', {leaseAgeMs:8000.4,visibility:'hidden'});
  assert.equal(notice.leaseAgeMs,8000);assert(validLocalMessage(notice,'renderer'));
  assert(!validLocalMessage(notice,'controller'));
  assert(!validLocalMessage(disconnectNotice('relay','request-timeout'),'renderer'),'renderer cannot claim a relay-generated cause');
  let calls=0;
  for(const invalid of [{...notice,reason:'private/path'}, {...notice,component:'__proto__'}, {...notice,leaseAgeMs:Infinity},
    {...notice,leaseAgeMs:-1}, {...notice,leaseAgeMs:3600001}, {...notice,visibility:'file:///private'}, {...notice,challenge:'secret'},
    {...notice,[Symbol('secret')]:true}, {...notice,component:{toString(){calls++;return 'renderer';}}}, {...notice,get reason(){calls++;return 'lease-expired';}}]) assert.equal(validDisconnectNotice(invalid),false);
  assert.equal(calls,0);
  assert.equal(disconnectNotice('renderer','lease-expired',{leaseAgeMs:9e9}).leaseAgeMs,3600000);
});

test('journal remains bounded, reports loss and returns independent snapshots across resets', () => {
  let now=100;const journal=new ConnectionDiagnostics({now:()=>now});
  for(let i=0;i<21;i++){now+=10;journal.record(disconnectNotice('renderer','lease-expired'));}
  const report={...journal.snapshot(),state:'connected'};
  assert.equal(report.dropped,5);assert.equal(report.events.length,16);assert.equal(report.events[0].sequence,6);
  assert.equal(report.events.at(-1).elapsedMs,210);assert.deepEqual(safeConnectionReport(report),report);
  report.events[0].reason='mutated';assert.equal(journal.snapshot().events[0].reason,'lease-expired');
  assert.equal(safeConnectionReport(report),null);
});

test('export validation refuses extra fields, malformed counters and unbounded histories', () => {
  const journal=new ConnectionDiagnostics();journal.record(disconnectNotice('controller','port-closed'));
  const report={...journal.snapshot(),state:'disconnected'};
  for(const value of [{...report,token:'private'}, {...report,events:Array(17).fill(report.events[0])},
    {...report,dropped:1}, {...report,state:'file:///private'}, {...report,events:[{...report.events[0],message:'private'}]}])assert.equal(safeConnectionReport(value),null);
  let calls=0;assert.equal(safeConnectionReport({...report,get events(){calls++;return [];}}),null);assert.equal(calls,0);
});
