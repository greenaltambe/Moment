/**
 * Moment Core: Collection (Blocklist) Model
 * Pure domain model - zero browser dependencies.
 */

import { Target } from './target.js';
import { BoundaryPolicy } from './boundary.js';

export type CollectionId = string;

export type WhenAccessExpires = 'IMMEDIATE' | 'NEXT_NAV';
export type OpeningMessageMode = 'NONE' | 'CUSTOM' | 'RANDOM' | 'MOMENT_LIBRARY';
export type MessageIntensity = 'MILD' | 'SARCASTIC' | 'SPICY' | 'BRUTAL';

export interface Collection {
  readonly id: CollectionId;
  readonly name: string;
  readonly color: string;
  readonly icon: string;
  readonly enabled: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly targets: readonly Target[];
  readonly boundary: BoundaryPolicy;
  readonly dailyLimitMs?: number | null;
  readonly customBlockMessage?: string | null;
  readonly openingMessageMode?: OpeningMessageMode;
  readonly messageIntensity?: MessageIntensity;
  readonly openingMessages?: readonly string[];
  readonly whenAccessExpires?: WhenAccessExpires;
}
