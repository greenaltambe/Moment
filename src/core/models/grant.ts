/**
 * Moment Core: Temporary Access Grant (Intent Pass) Model
 * Pure domain model - zero browser dependencies.
 */

export type GrantId = string;

export interface TemporaryAccessGrant {
  readonly id: GrantId;
  readonly tabId: number;
  readonly target: string; // Target hostname or canonical prefix
  readonly grantedAt: number; // Epoch ms
  readonly expiresAt: number; // Epoch ms
  readonly nonce: string; // Nonce used to validate origin request
  readonly singleUse: boolean;
}
