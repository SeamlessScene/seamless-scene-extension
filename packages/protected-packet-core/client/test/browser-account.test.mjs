import {test} from 'node:test';import assert from 'node:assert/strict';import {IDBFactory} from 'fake-indexeddb';
import {privateAccount,privateAccountState,selectPrivateAccount,rollbackPrivateAccount} from '../browser-account.mjs';
const a='50000000-0000-4000-8000-000000000001',b='50000000-0000-4000-8000-000000000002';
test('sign-out between initialization read and selection prevents stale subject persistence',async()=>{
 const db=new IDBFactory(),before=await privateAccountState(db);await privateAccount(null,db);
 await assert.rejects(selectPrivateAccount(a,before.generation,db),/generation/);assert.equal(await privateAccount(undefined,db),null);
});
test('stale startup rollback cannot erase a newer authorized subject generation',async()=>{
 const db=new IDBFactory(),before=await privateAccountState(db);await selectPrivateAccount(a,before.generation,db);await privateAccount(null,db);
 const next=await privateAccountState(db);await selectPrivateAccount(b,next.generation,db);await rollbackPrivateAccount(a,before.generation,db);
 assert.equal(await privateAccount(undefined,db),b);
});
