/** Buyer-side escrow anchor for scripts: accept → createJob → registerJob →
 * setBudget → fund → crew-report-job. Buyer wallet is the job client, so only
 * the buyer key can run this (it cannot be the server key on someone's task).
 */
import type { ERC8183Client } from "@bnbagent/sdk";

export interface AnchorSend {
  (data: Record<string, unknown>): Promise<any>;
}

export async function anchorAndFund(opts: {
  send: AnchorSend;
  bind: (tag: string) => Promise<{ nonce: string; sig: string }>;
  buyerClient: ERC8183Client;
  buyerAddress: string;
  taskId: string;
  tag?: string;
}): Promise<{ jobId: string; totalWei: string }> {
  const tag = opts.tag ?? "acc";
  const b = await opts.bind(tag);
  const r = await opts.send({
    skill: "accept-web3-quote", task_id: opts.taskId,
    buyerAddress: opts.buyerAddress, nonce: b.nonce, buyerSig: b.sig,
  });
  const p = r?.result?.artifacts?.find((a: any) => a?.name === "escrow")?.parts?.[0]?.data;
  if (!p?.commerce || !p?.description || !p?.totalWei) {
    throw new Error("accept failed: " + JSON.stringify(r?.result ?? r?.error ?? r).slice(0, 200));
  }
  const created = await opts.buyerClient.createJob({
    provider: p.provider, expiredAt: BigInt(p.expiredAt), description: p.description,
  });
  if (created.jobId == null) throw new Error("createJob returned no jobId");
  const jobId = created.jobId.toString();
  await opts.buyerClient.registerJob(created.jobId, p.policy);
  await opts.buyerClient.setBudget(created.jobId, BigInt(p.totalWei));
  await opts.buyerClient.fund(created.jobId, BigInt(p.totalWei));
  const b2 = await opts.bind(`${tag}-rep`);
  const rr = await opts.send({
    skill: "crew-report-job", task_id: opts.taskId, job_id: jobId,
    buyerAddress: opts.buyerAddress, nonce: b2.nonce, buyerSig: b2.sig,
  });
  const ok = JSON.stringify(rr?.result ?? {}).includes("recorded");
  if (!ok) throw new Error("report failed: " + JSON.stringify(rr?.result ?? rr?.error ?? rr).slice(0, 200));
  return { jobId, totalWei: String(p.totalWei) };
}
