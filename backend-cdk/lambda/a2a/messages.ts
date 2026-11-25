/** Canonical message a buyer signs to prove wallet ownership. */
export function bindMessage(buyerAddress: string, nonce: string): string {
  return `Crewtopia hire binding v1\nbuyer: ${buyerAddress}\nnonce: ${nonce}`;
}

/** Canonical message the team operator signs to authorize delivery. */
export function deliverMessage(taskId: string, action: string, nonce: string): string {
  return `Crewtopia deliver v1\ntask: ${taskId}\naction: ${action}\nnonce: ${nonce}`;
}

/** Canonical message a buyer signs to approve early settlement. */
export function approveMessage(taskId: string): string {
  return `Crewtopia approve v1\ntask: ${taskId}`;
}
