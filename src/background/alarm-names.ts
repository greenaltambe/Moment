/**
 * Pass-expiration alarm naming.
 * Format: pass_expire_<INTENT_PASS|SITE_PASS>_<tabId>_<expiresAt>
 * The pass type itself contains an underscore, so names must be parsed with a
 * regex rather than split('_').
 */

export type PassAlarmType = 'INTENT_PASS' | 'SITE_PASS';

const PASS_ALARM_PATTERN = /^pass_expire_(INTENT_PASS|SITE_PASS)_(-?\d+)_(\d+)$/;

export function buildPassAlarmName(passType: PassAlarmType, tabId: number, expiresAt: number): string {
  return `pass_expire_${passType}_${tabId}_${expiresAt}`;
}

export function parsePassAlarmName(
  name: string
): { passType: PassAlarmType; tabId: number; expiresAt: number } | null {
  const match = PASS_ALARM_PATTERN.exec(name);
  if (!match) return null;
  return {
    passType: match[1] as PassAlarmType,
    tabId: parseInt(match[2], 10),
    expiresAt: parseInt(match[3], 10),
  };
}

const PASS_WARN_ALARM_PATTERN = /^pass_warn_(INTENT_PASS|SITE_PASS)_(-?\d+)_(\d+)$/;

export function buildPassWarnAlarmName(passType: PassAlarmType, tabId: number, expiresAt: number): string {
  return `pass_warn_${passType}_${tabId}_${expiresAt}`;
}

export function parsePassWarnAlarmName(
  name: string
): { passType: PassAlarmType; tabId: number; expiresAt: number } | null {
  const match = PASS_WARN_ALARM_PATTERN.exec(name);
  if (!match) return null;
  return {
    passType: match[1] as PassAlarmType,
    tabId: parseInt(match[2], 10),
    expiresAt: parseInt(match[3], 10),
  };
}
