/**
 * Moment Core: UI Rule, Collection, Schedule & Import Validation
 * Pure domain logic - zero browser dependencies.
 */
import { validateGlobPattern } from '../matching/glob.js';
import { CURRENT_SCHEMA_VERSION } from '../../storage/schema.js';
import { validateDailyLimit } from '../usage/accounting.js';
/**
 * Validates a collection name.
 * Requires 1 to 64 characters, trimmed, non-empty.
 */
export function validateCollectionName(rawName) {
    if (typeof rawName !== 'string') {
        return { valid: false, error: 'Collection name must be a string' };
    }
    const sanitized = rawName.trim();
    if (sanitized.length === 0) {
        return { valid: false, error: 'Collection name cannot be empty' };
    }
    if (sanitized.length > 64) {
        return { valid: false, error: 'Collection name cannot exceed 64 characters' };
    }
    return { valid: true, sanitized };
}
/**
 * Validates an optional custom block message (up to 250 characters).
 */
export function validateCustomBlockMessage(rawMsg) {
    if (rawMsg === null || rawMsg === undefined || rawMsg === '') {
        return { valid: true, sanitized: null };
    }
    if (typeof rawMsg !== 'string') {
        return { valid: false, error: 'Custom block message must be a string' };
    }
    const sanitized = rawMsg.trim();
    if (sanitized.length === 0) {
        return { valid: true, sanitized: null };
    }
    if (sanitized.length > 250) {
        return { valid: false, error: 'Custom block message cannot exceed 250 characters' };
    }
    return { valid: true, sanitized };
}
/**
 * Validates opening intervention messages and mode.
 */
export function validateOpeningMessages(rawMode, rawMsgs) {
    const validModes = ['NONE', 'CUSTOM', 'RANDOM'];
    const mode = typeof rawMode === 'string' && validModes.includes(rawMode)
        ? rawMode
        : 'NONE';
    const messages = [];
    if (Array.isArray(rawMsgs)) {
        for (const item of rawMsgs) {
            if (typeof item === 'string') {
                const trimmed = item.trim();
                if (trimmed.length > 0 && trimmed.length <= 250 && messages.length < 10) {
                    messages.push(trimmed);
                }
            }
        }
    }
    return { mode, messages };
}
/**
 * Validates whenAccessExpires setting.
 */
export function validateWhenAccessExpires(raw) {
    if (raw === 'NEXT_NAV') {
        return 'NEXT_NAV';
    }
    return 'IMMEDIATE';
}
/**
 * Parses and validates host and port from a target string.
 */
function parseHostAndPort(raw) {
    let text = raw;
    let port = null;
    const colonIdx = text.indexOf(':');
    if (colonIdx !== -1) {
        const portStr = text.slice(colonIdx + 1);
        text = text.slice(0, colonIdx);
        if (!/^\d+$/.test(portStr)) {
            return { host: text, port: null, error: 'Invalid port number' };
        }
        const portNum = parseInt(portStr, 10);
        if (portNum < 1 || portNum > 65535) {
            return { host: text, port: null, error: 'Port must be between 1 and 65535' };
        }
        port = portStr;
    }
    return { host: text, port };
}
/**
 * Validates and normalizes target patterns according to target rule types.
 */
export function validateTargetPattern(rawPattern, type) {
    if (typeof rawPattern !== 'string') {
        return { valid: false, error: 'Target pattern must be a string' };
    }
    let text = rawPattern.trim();
    if (text.length === 0) {
        return { valid: false, error: 'Target pattern cannot be empty' };
    }
    if (text.length > 256) {
        return { valid: false, error: 'Target pattern cannot exceed 256 characters' };
    }
    switch (type) {
        case 'WEBSITE': {
            // Strip protocol if present
            if (text.startsWith('http://'))
                text = text.slice(7);
            else if (text.startsWith('https://'))
                text = text.slice(8);
            text = text.trim();
            // Strip any trailing slashes cleanly
            text = text.replace(/\/+$/, '');
            if (text.includes('?') || text.includes('&')) {
                return { valid: false, error: 'Website patterns cannot contain query parameters' };
            }
            if (text.includes('/')) {
                return { valid: false, error: 'Website mode matches entire domains (e.g. example.com). To match specific paths, select Path Prefix or Exact Page.' };
            }
            if (text.includes('*')) {
                return { valid: false, error: 'Website patterns cannot contain wildcards. Use Glob mode instead.' };
            }
            const parsed = parseHostAndPort(text);
            if (parsed.error) {
                return { valid: false, error: parsed.error };
            }
            const host = parsed.host.toLowerCase().trim();
            if (host.length === 0) {
                return { valid: false, error: 'Website domain cannot be empty' };
            }
            // Check for domain validity (must have at least one dot unless localhost)
            if (host !== 'localhost' && !host.includes('.')) {
                return { valid: false, error: 'Please enter a valid website domain (e.g. example.com)' };
            }
            const sanitized = parsed.port ? `${host}:${parsed.port}` : host;
            return { valid: true, sanitized };
        }
        case 'EXACT_HOST': {
            if (text.startsWith('http://'))
                text = text.slice(7);
            else if (text.startsWith('https://'))
                text = text.slice(8);
            text = text.trim();
            // Strip any trailing slashes
            text = text.replace(/\/+$/, '');
            if (text.includes('?') || text.includes('&')) {
                return { valid: false, error: 'Exact host cannot contain query parameters' };
            }
            if (text.includes('/')) {
                return { valid: false, error: 'Exact host must be a clean hostname without paths. To match a path, select Path Prefix or Exact Page.' };
            }
            if (text.includes('*')) {
                return { valid: false, error: 'Exact host cannot contain wildcards. For wildcards, select Glob mode.' };
            }
            const parsed = parseHostAndPort(text);
            if (parsed.error) {
                return { valid: false, error: parsed.error };
            }
            const host = parsed.host.toLowerCase().trim();
            if (host.length === 0) {
                return { valid: false, error: 'Exact host cannot be empty' };
            }
            const sanitized = parsed.port ? `${host}:${parsed.port}` : host;
            return { valid: true, sanitized };
        }
        case 'PATH_PREFIX': {
            if (text.startsWith('http://'))
                text = text.slice(7);
            else if (text.startsWith('https://'))
                text = text.slice(8);
            text = text.trim();
            if (text.includes('?') || text.includes('&')) {
                return { valid: false, error: 'Path prefix patterns cannot contain query parameters. Use Exact Page or Glob mode instead.' };
            }
            const slashIdx = text.indexOf('/');
            if (slashIdx === -1) {
                return { valid: false, error: 'Path prefix must include a path (e.g. example.com/restricted)' };
            }
            const host = text.slice(0, slashIdx).toLowerCase().trim();
            const path = text.slice(slashIdx);
            if (!host || host.length === 0) {
                return { valid: false, error: 'Path prefix must include a valid domain (e.g. example.com/restricted)' };
            }
            if (!path || path.length === 0) {
                return { valid: false, error: 'Path prefix must include a path (e.g. example.com/restricted)' };
            }
            return { valid: true, sanitized: `${host}${path}` };
        }
        case 'EXACT_PAGE': {
            if (text.startsWith('http://'))
                text = text.slice(7);
            else if (text.startsWith('https://'))
                text = text.slice(8);
            text = text.trim();
            if (text.includes('*')) {
                return { valid: false, error: 'Exact page cannot contain wildcards. Use Glob mode instead.' };
            }
            const slashIdx = text.indexOf('/');
            if (slashIdx === -1) {
                return { valid: false, error: 'Exact page must include a page path (e.g. example.com/page.html)' };
            }
            const host = text.slice(0, slashIdx).toLowerCase().trim();
            const path = text.slice(slashIdx);
            if (!host || host.length === 0) {
                return { valid: false, error: 'Exact page must include a valid domain (e.g. example.com/page.html)' };
            }
            return { valid: true, sanitized: `${host}${path}` };
        }
        case 'GLOB': {
            const globCheck = validateGlobPattern(text);
            if (!globCheck.valid) {
                return { valid: false, error: globCheck.error || 'Invalid glob pattern' };
            }
            return { valid: true, sanitized: text };
        }
        default:
            return { valid: false, error: `Unsupported target rule type: ${type}` };
    }
}
/**
 * Formats minutes from midnight into 12-hour AM/PM format (e.g., 540 -> "9:00 AM", 1320 -> "10:00 PM").
 */
export function formatMinuteToTime12h(minute) {
    const normalized = ((minute % 1440) + 1440) % 1440;
    const hours24 = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    const period = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
    const minutesFormatted = String(minutes).padStart(2, '0');
    return `${hours12}:${minutesFormatted} ${period}`;
}
/**
 * Converts a ScheduleConfig into human-readable natural language.
 */
export function formatScheduleNaturalLanguage(schedule) {
    if (!schedule || !schedule.enabled || !schedule.intervals || schedule.intervals.length === 0) {
        return 'Always active (24/7)';
    }
    const parts = [];
    for (const interval of schedule.intervals) {
        const { days, startMinute, endMinute } = interval;
        if (!days || days.length === 0)
            continue;
        // Days summary
        let daysSummary;
        const sortedDays = [...days].sort((a, b) => a - b);
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        if (sortedDays.length === 7) {
            daysSummary = 'Every day';
        }
        else if (sortedDays.length === 5 &&
            sortedDays[0] === 1 &&
            sortedDays[1] === 2 &&
            sortedDays[2] === 3 &&
            sortedDays[3] === 4 &&
            sortedDays[4] === 5) {
            daysSummary = 'Weekdays (Mon–Fri)';
        }
        else if (sortedDays.length === 2 && sortedDays[0] === 0 && sortedDays[1] === 6) {
            daysSummary = 'Weekends (Sat–Sun)';
        }
        else {
            daysSummary = sortedDays.map((d) => dayNames[d]).join(', ');
        }
        const startTime = formatMinuteToTime12h(startMinute);
        const endTime = formatMinuteToTime12h(endMinute);
        if (startMinute === endMinute) {
            parts.push(`${daysSummary} (all day)`);
        }
        else if (startMinute > endMinute) {
            parts.push(`${daysSummary} overnight from ${startTime} to ${endTime}`);
        }
        else {
            parts.push(`${daysSummary} from ${startTime} to ${endTime}`);
        }
    }
    return parts.length > 0 ? parts.join('; ') : 'Always active (24/7)';
}
/**
 * Deeply validates and sanitizes a BoundaryPolicy structure during import.
 */
function sanitizeImportedBoundary(raw) {
    const defaultBoundary = {
        schedule: { enabled: false, intervals: [] },
        limits: { dailyMinutes: null, sessionMinutes: null },
        pause: { type: 'BREATHE', durationSeconds: 10, requireIntentionText: false },
        action: { type: 'BLOCK_PAGE', redirectUrl: null },
        strictMode: false,
    };
    if (!raw || typeof raw !== 'object')
        return defaultBoundary;
    // Schedule
    let schedule = defaultBoundary.schedule;
    if (raw.schedule && typeof raw.schedule === 'object') {
        const enabled = Boolean(raw.schedule.enabled);
        const intervals = [];
        if (Array.isArray(raw.schedule.intervals)) {
            for (const inv of raw.schedule.intervals) {
                if (!inv || typeof inv !== 'object')
                    continue;
                const days = Array.isArray(inv.days)
                    ? inv.days.filter((d) => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)
                    : [];
                const startMinute = typeof inv.startMinute === 'number' && Number.isInteger(inv.startMinute)
                    ? Math.max(0, Math.min(1439, inv.startMinute))
                    : 0;
                const endMinute = typeof inv.endMinute === 'number' && Number.isInteger(inv.endMinute)
                    ? Math.max(0, Math.min(1439, inv.endMinute))
                    : 0;
                intervals.push({ days, startMinute, endMinute });
            }
        }
        schedule = { enabled, intervals };
    }
    // Pause
    let pause = defaultBoundary.pause;
    if (raw.pause && typeof raw.pause === 'object') {
        const validPauseTypes = ['NONE', 'BREATHE', 'TIMER', 'CONFIRM'];
        const type = validPauseTypes.includes(raw.pause.type) ? raw.pause.type : 'BREATHE';
        let durationSeconds = typeof raw.pause.durationSeconds === 'number'
            ? Math.max(0, Math.min(60, Math.floor(raw.pause.durationSeconds)))
            : 10;
        if (type === 'CONFIRM')
            durationSeconds = 0;
        pause = {
            type,
            durationSeconds,
            requireIntentionText: Boolean(raw.pause.requireIntentionText),
        };
    }
    // Limits
    let limits = defaultBoundary.limits;
    if (raw.limits && typeof raw.limits === 'object') {
        const dailyMinutes = typeof raw.limits.dailyMinutes === 'number' && raw.limits.dailyMinutes > 0 && raw.limits.dailyMinutes <= 1440
            ? Math.floor(raw.limits.dailyMinutes)
            : null;
        limits = {
            dailyMinutes,
            sessionMinutes: null,
        };
    }
    return {
        schedule,
        limits,
        pause,
        action: { type: 'BLOCK_PAGE', redirectUrl: null },
        strictMode: Boolean(raw.strictMode),
    };
}
/**
 * Validates and sanitizes imported JSON configuration data.
 */
export function validateImportPayload(data) {
    if (!data || typeof data !== 'object') {
        return { valid: false, error: 'Import data must be a valid JSON object' };
    }
    const payload = data;
    if (typeof payload.schemaVersion !== 'number' ||
        !Number.isInteger(payload.schemaVersion) ||
        payload.schemaVersion < 1 ||
        payload.schemaVersion > CURRENT_SCHEMA_VERSION) {
        return {
            valid: false,
            error: `Unsupported or invalid schemaVersion: ${payload.schemaVersion} (supported: 1-${CURRENT_SCHEMA_VERSION})`,
        };
    }
    if (!payload.collections || typeof payload.collections !== 'object' || Array.isArray(payload.collections)) {
        return { valid: false, error: 'Import data missing collections dictionary' };
    }
    const sanitizedCollections = {};
    const seenCollectionIds = new Set();
    for (const [, rawCol] of Object.entries(payload.collections)) {
        if (!rawCol || typeof rawCol !== 'object')
            continue;
        const col = rawCol;
        if (typeof col.id !== 'string' || typeof col.name !== 'string')
            continue;
        let colId = col.id.trim();
        if (!colId || seenCollectionIds.has(colId)) {
            colId = `col_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        }
        seenCollectionIds.add(colId);
        const validTargets = [];
        const seenTargetIds = new Set();
        if (Array.isArray(col.targets)) {
            for (const t of col.targets) {
                if (!t || typeof t !== 'object')
                    continue;
                if (typeof t.pattern !== 'string' || typeof t.type !== 'string')
                    continue;
                const targetVal = validateTargetPattern(t.pattern, t.type);
                if (!targetVal.valid) {
                    return { valid: false, error: `Invalid target pattern '${t.pattern}' in collection '${col.name}': ${targetVal.error}` };
                }
                let targetId = typeof t.id === 'string' && t.id.trim().length > 0 ? t.id.trim() : null;
                if (!targetId || seenTargetIds.has(targetId)) {
                    targetId = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                }
                seenTargetIds.add(targetId);
                validTargets.push({
                    id: targetId,
                    pattern: targetVal.sanitized,
                    type: t.type,
                    isException: Boolean(t.isException),
                    createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now(),
                });
            }
        }
        const validatedLimit = col.dailyLimitMs !== undefined ? validateDailyLimit(col.dailyLimitMs) : null;
        const blockMsgVal = validateCustomBlockMessage(col.customBlockMessage);
        const openingVal = validateOpeningMessages(col.openingMessageMode, col.openingMessages);
        const whenExpires = validateWhenAccessExpires(col.whenAccessExpires);
        sanitizedCollections[colId] = {
            id: colId,
            name: col.name.trim() || 'Imported Collection',
            color: typeof col.color === 'string' ? col.color : '#2e7d32',
            icon: typeof col.icon === 'string' ? col.icon : 'shield',
            enabled: col.enabled !== false,
            createdAt: typeof col.createdAt === 'number' ? col.createdAt : Date.now(),
            updatedAt: typeof col.updatedAt === 'number' ? col.updatedAt : Date.now(),
            dailyLimitMs: validatedLimit,
            targets: validTargets,
            boundary: sanitizeImportedBoundary(col.boundary),
            customBlockMessage: blockMsgVal.valid ? blockMsgVal.sanitized ?? null : null,
            openingMessageMode: openingVal.mode,
            openingMessages: openingVal.messages,
            whenAccessExpires: whenExpires,
        };
    }
    const sanitizedSettings = {
        theme: ['system', 'light', 'dark', 'sepia'].includes(payload.settings?.theme)
            ? payload.settings.theme
            : 'system',
        timeFormat: ['12h', '24h'].includes(payload.settings?.timeFormat)
            ? payload.settings.timeFormat
            : '24h',
        reducedMotion: Boolean(payload.settings?.reducedMotion),
        allowPrivateBrowsing: Boolean(payload.settings?.allowPrivateBrowsing),
    };
    return {
        valid: true,
        sanitized: {
            schemaVersion: payload.schemaVersion,
            exportedAt: typeof payload.exportedAt === 'number' ? payload.exportedAt : Date.now(),
            collections: sanitizedCollections,
            settings: sanitizedSettings,
        },
    };
}
