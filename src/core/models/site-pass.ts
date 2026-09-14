/**
 * Moment Core: Site Pass (Post-Intervention Cooldown) Model
 * Pure domain model - zero browser dependencies.
 */

export type SitePassId = string;

export interface SitePass {
  readonly id: SitePassId;
  readonly tabId: number;
  readonly site: string; // Target website domain/scope (e.g. "reddit.com")
  readonly grantedAt: number; // Epoch ms
  readonly expiresAt: number; // Epoch ms
}
