'use client';

// Crewtopia is a standalone hackathon project (BNB Bangkok 2026).
// Single brand, no multi-site mode — kept as a module so Navbar/Footer
// share one source of truth.

export const BRAND = 'Crewtopia' as const;
export const TAGLINE = 'Your AI Web3 development team.' as const;

export function brandName(): string {
  return BRAND;
}
