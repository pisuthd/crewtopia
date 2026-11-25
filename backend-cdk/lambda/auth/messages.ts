/** Canonical EIP-191 sign-in message (personal_sign / signMessage). */
export function signInMessage(address: string, nonce: string, issuedAt: string): string {
  return `Crewtopia sign-in v1\naddress: ${address}\nnonce: ${nonce}\nissuedAt: ${issuedAt}`;
}
