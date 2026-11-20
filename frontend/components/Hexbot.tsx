'use client';

/**
 * Crewtopia Hexbot — deliberately distinct from the Wayfind blob mascot.
 *
 * Wayfind = soft blob + two separate dot eyes.
 * Crewtopia  = hard hexagon chassis + single dark visor + twin LED eyes.
 * Hexagon = chain block / honeycomb (swarm + BNB).
 *
 * Pure CSS/SVG, no image assets — fast for the 36h hackathon build.
 */

export type HexbotColor = 'honey' | 'lagoon' | 'blue' | 'grape' | 'coral' | 'carbon';
export type HexbotSize = 'xs' | 'sm' | 'md' | 'lg';
export type HexbotRole = 'pm' | 'ux' | 'frontend' | 'backend' | 'director' | 'stylist' | 'generator' | 'retoucher';
export type HexbotMotion = 'hover' | 'none';

export interface HexbotProps {
  color?: HexbotColor;
  size?: HexbotSize;
  role?: HexbotRole;
  motion?: HexbotMotion;
  blinkDelay?: string;
  className?: string;
  label?: string;
}

const bodyMap: Record<HexbotColor, string> = {
  honey: 'from-[#FFD84D] to-[#F0B90B]',
  lagoon: 'from-[#5EEAD4] to-[#14B8A6]',
  blue: 'from-[#60A5FA] to-[#2563EB]',
  grape: 'from-[#C4B5FD] to-[#8B5CF6]',
  coral: 'from-[#FDA4AF] to-[#E26D5A]',
  carbon: 'from-[#3F3F46] to-[#131210]',
};

const sizeMap: Record<HexbotSize, string> = {
  xs: 'h-8 w-7',
  sm: 'h-11 w-10',
  md: 'h-16 w-14',
  lg: 'h-24 w-[88px]',
};

const HEX_CLIP = 'polygon(25% 2%, 75% 2%, 98% 50%, 75% 98%, 25% 98%, 2% 50%)';

export default function Hexbot({
  color = 'honey',
  size = 'md',
  role = 'pm',
  motion = 'none',
  blinkDelay,
  className = '',
  label,
}: HexbotProps) {
  return (
    <span
      className={`relative inline-block ${motion === 'hover' ? 'animate-hexbot-hover' : ''}`}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <span
        className={`relative block bg-gradient-to-b ${bodyMap[color]} ${sizeMap[size]} ${className}`}
        style={{ clipPath: HEX_CLIP }}
      >
        {/* visor */}
        <span className="absolute left-[16%] right-[16%] top-[30%] h-[30%] rounded-[999px] bg-[#0B0E11]/90">
          <span
            className="animate-hexbot-blink absolute left-[22%] top-1/2 h-[46%] aspect-square -translate-y-1/2 rounded-full bg-[#F0B90B]"
            style={blinkDelay ? { animationDelay: blinkDelay } : undefined}
          />
          <span
            className="animate-hexbot-blink absolute right-[22%] top-1/2 h-[46%] aspect-square -translate-y-1/2 rounded-full bg-[#F0B90B]"
            style={blinkDelay ? { animationDelay: blinkDelay } : undefined}
          />
          {/* visor scanline */}
          <span className="animate-hexbot-scan absolute inset-y-[18%] left-[12%] w-[10%] rounded-full bg-white/25" />
        </span>
      </span>
    </span>
  );
}
