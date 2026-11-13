import { parentPort, workerData } from 'node:worker_threads';
const ready = [];
globalThis.addEventListener = (name, callback) => { if (name === 'message') ready.push(callback); };
globalThis.postMessage = value => parentPort.postMessage(value);
globalThis.close = () => parentPort.close();
await import(workerData?.moduleURL ?? '../../local-hash-worker.mjs');
parentPort.on('message', data => { for (const listener of ready) void listener({ data }); });
