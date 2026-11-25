// Probe: crew-thread skill wiring + validation paths (no chain, no AWS).
// Run: npx tsx scripts/api/7-crew-thread-shape.ts
// Asserts JSON-RPC error shapes for bad input and routing without TASKS_TABLE.
import { handler } from '../../backend-cdk/lambda/a2a/index';
import { handleThread } from '../../backend-cdk/lambda/a2a/thread';

const rpc = (skill: string, data: Record<string, unknown>) => ({
  httpMethod: 'POST',
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'message/send',
    params: { message: { parts: [{ kind: 'data', data: { skill, ...data } }] } },
  }),
});

async function main(): Promise<void> {
  // 1. Direct: missing task_id → -32602, no AWS touched.
  const r1 = (await handleThread(1, {})) as any;
  const b1 = JSON.parse(r1.body);
  console.log('missing task_id:', b1.error?.code, '-', b1.error?.message);
  if (b1.error?.code !== -32602) throw new Error('expected -32602');

  // 2. Router: unknown skill still rejected (dummy table so we reach routing).
  process.env.TASKS_TABLE = 'probe';
  const r2 = (await handler(rpc('nope', {}) as any)) as any;
  const b2 = JSON.parse(r2.body);
  console.log('unknown skill:', b2.error?.code, '-', b2.error?.message);
  if (b2.error?.code !== -32602) throw new Error('expected -32602');

  // 3. Router: crew-thread reaches the skill — bad binding fails auth
  // before any AWS call (auth-first ordering).
  const r3 = (await handler(
    rpc('crew-thread', { task_id: 'x', buyerAddress: '0x0', nonce: 'n', buyerSig: '0x00' }) as any,
  )) as any;
  const b3 = JSON.parse(r3.body);
  console.log('bad binding:', b3.error?.code, '-', String(b3.error?.message).slice(0, 60));
  if (b3.error?.code !== -32602) throw new Error('expected -32602');

  // 4. crew-extend: missing task_id → -32602.
  const r4 = (await handler(rpc('crew-extend', {}) as any)) as any;
  const b4 = JSON.parse(r4.body);
  console.log('extend missing task:', b4.error?.code, '-', b4.error?.message);
  if (b4.error?.code !== -32602) throw new Error('expected -32602');

  // 5. crew-end: bad binding fails auth before any AWS call.
  const r5 = (await handler(
    rpc('crew-end', { task_id: 'x', buyerAddress: '0x0', nonce: 'n', buyerSig: '0x00' }) as any,
  )) as any;
  const b5 = JSON.parse(r5.body);
  console.log('end bad binding:', b5.error?.code, '-', String(b5.error?.message).slice(0, 60));
  if (b5.error?.code !== -32602) throw new Error('expected -32602');

  console.log('crew-thread shape probe GREEN');
}

void main();
