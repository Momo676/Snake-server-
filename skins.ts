import type { SkinDefinition } from './types';

export const PRESET_SKINS: SkinDefinition[] = [
  {
    id: 'volt-viper',
    name: 'Volt Viper',
    colors: ['#A3E635', '#22C55E', '#14532D'],
    pattern: 'striped',
    eyeStyle: 'fierce',
    trait: 'Electric lime scales',
  },
  {
    id: 'crimson-koi',
    name: 'Crimson Koi',
    colors: ['#F43F5E', '#FB923C', '#FFF1F2'],
    pattern: 'spotted',
    eyeStyle: 'wide',
    trait: 'Vermilion & pearl bands',
  },
  {
    id: 'cobalt-bolt',
    name: 'Cobalt Bolt',
    colors: ['#38BDF8', '#2563EB', '#E0F2FE'],
    pattern: 'gradient',
    eyeStyle: 'cyber',
    trait: 'Arctic blue gradient',
  },
  {
    id: 'amber-wasp',
    name: 'Amber Wasp',
    colors: ['#FBBF24', '#1E293B', '#F59E0B'],
    pattern: 'ringed',
    eyeStyle: 'fierce',
    trait: 'High-contrast hazard rings',
  },
  {
    id: 'obsidian-coral',
    name: 'Coral Reef',
    colors: ['#FB7185', '#F472B6', '#FDE047'],
    pattern: 'striped',
    eyeStyle: 'cute',
    trait: 'Warm reef palette',
  },
  {
    id: 'mint-frost',
    name: 'Mint Frost',
    colors: ['#2DD4BF', '#0EA5E9', '#CCFBF1'],
    pattern: 'gradient',
    eyeStyle: 'cyber',
    trait: 'Teal cryo sheen',
  },
];

export function getSegmentColor(
  skin: SkinDefinition,
  segmentIndex: number,
  totalSegments: number,
): string {
  const palette = skin.colors.length > 0 ? skin.colors : ['#A3E635'];
  const count = palette.length;

  switch (skin.pattern) {
    case 'solid':
      return palette[0];
    case 'striped': {
      const band = Math.floor(segmentIndex / 2) % count;
      return palette[band];
    }
    case 'ringed': {
      return segmentIndex % 3 === 0 ? palette[1 % count] : palette[0];
    }
    case 'spotted': {
      if (segmentIndex % 4 === 1 && count > 1) return palette[1];
      if (segmentIndex % 6 === 3 && count > 2) return palette[2];
      return palette[0];
    }
    case 'gradient': {
      if (count === 1 || totalSegments <= 1) return palette[0];
      const t = (segmentIndex / Math.max(1, totalSegments - 1)) * (count - 1);
      const idx = Math.min(count - 1, Math.round(t));
      return palette[idx];
    }
    default:
      return palette[segmentIndex % count];
  }
}
