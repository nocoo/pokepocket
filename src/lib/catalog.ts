import data from '../data/editions.json' with { type: 'json' };
import type { GameSystem } from './rom-header.ts';

export interface PokemonEdition {
  id: string;
  name: string;
  english: string;
  system: GameSystem;
  generation: number;
  year: number;
  region: string;
  regionEn: string;
  mascot: string;
  mascotName: string;
  color: string;
  fileName: string;
  language: string;
  source: string;
}
export interface AvailableEdition {
  id: string;
  available: boolean;
  url: string | null;
}
export const EDITIONS = data as readonly PokemonEdition[];
const defaultEdition = EDITIONS.find((edition) => edition.id === 'emerald');
if (!defaultEdition) throw new Error('默认版本 emerald 未配置');
export const DEFAULT_EDITION = defaultEdition;
export const getEdition = (id: string | null | undefined) =>
  EDITIONS.find((edition) => edition.id === id);

/** Identify versions from cartridge bytes, never from the uploaded filename. */
export function identifyEdition(
  system: GameSystem,
  title: string,
  gameCode: string,
): string | null {
  if (system === 'GBA') {
    const prefixes: Record<string, string> = {
      AXV: 'ruby',
      AXP: 'sapphire',
      BPE: 'emerald',
      BPR: 'firered',
      BPG: 'leafgreen',
    };
    return prefixes[gameCode.slice(0, 3)] ?? null;
  }
  const names: [RegExp, string][] = [
    [/^POKEMON RED\b/, 'red'],
    [/^POKEMON GREEN\b/, 'green'],
    [/^POKEMON BLUE\b/, 'blue'],
    [/^POKEMON YELL/, 'yellow'],
    [/^POKEMON_GLD|^POKEMON GOLD/, 'gold'],
    [/^POKEMON_SLV|^POKEMON SILV/, 'silver'],
    [/^PM_CRYSTAL|^POKEMON CRY/, 'crystal'],
  ];
  return names.find(([pattern]) => pattern.test(title))?.[1] ?? null;
}
