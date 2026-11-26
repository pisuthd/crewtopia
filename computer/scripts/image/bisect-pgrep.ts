/** Prove/deny the pkill-suicide theory WITHOUT killing anything:
 *  `pgrep -af serve` lists exactly what `pkill -f serve` would kill.
 *  Run: VMID=<microvm-id> npx tsx computer/scripts/image/bisect-pgrep.ts (repo root)
 */
import { CreateMicrovmAuthTokenCommand, GetMicrovmCommand } from '@aws-sdk/client-lambda-microvms';
import { mv } from './config.js';

const vmId = process.env.VMID ?? '';
if (!vmId) throw new Error('need VMID');
const got: any = await mv.send(new GetMicrovmCommand({ microvmIdentifier: vmId }));
const endpoint = got?.endpoint;
if (!endpoint) throw new Error('VM has no endpoint');
const tok: any = await mv.send(new CreateMicrovmAuthTokenCommand({ microvmIdentifier: vmId, allowedPorts: [{ port: 8080 }], expirationInMinutes: 15 }));
const token = tok?.authToken?.['X-aws-proxy-auth'] ?? '';
const r = await fetch(`https://${endpoint}/task`, {
  method: 'POST',
  headers: { 'X-aws-proxy-auth': token, 'content-type': 'application/json' },
  body: JSON.stringify({ text: 'Run in shell: pgrep -af "serve" || echo NONE. Reply with ONLY the command output, verbatim.', ownerId: 'bisect' }),
  signal: AbortSignal.timeout(120_000),
});
const j: any = await r.json().catch(() => ({}));
console.log('run:', r.status, JSON.stringify(j).slice(0, 200));
const runId = j?.runId ?? j?.run_id ?? j?.id;
if (runId) {
  for (let i = 0; i < 20; i++) {
    await new Promise((res) => setTimeout(res, 5000));
    const ev: any = await fetch(`https://${endpoint}/runs/${runId}/events?cursor=0`, { headers: { 'X-aws-proxy-auth': token } }).then((x) => x.json()).catch(() => null);
    if (ev?.done) {
      console.log('OUTPUT:', JSON.stringify(ev.events ?? ev).slice(0, 2000));
      break;
    }
  }
}
