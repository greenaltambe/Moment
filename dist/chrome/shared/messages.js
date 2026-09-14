/**
 * Moment Typed Message Protocol
 * Provides explicit request/response typing and runtime payload validation
 * for UI <-> Background communication.
 */
const VALID_TARGET_TYPES = new Set([
    'WEBSITE',
    'EXACT_HOST',
    'PATH_PREFIX',
    'EXACT_PAGE',
    'GLOB',
]);
/**
 * Validates incoming message shapes at runtime to prevent injection of malformed data.
 */
export function isValidMessage(msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
        return false;
    }
    switch (msg.type) {
        case 'GET_STATE':
        case 'GET_CURRENT_TAB':
        case 'GET_CAPABILITIES':
        case 'RESET_ALL_GRANTS_TEST':
        case 'GET_COLLECTIONS':
        case 'GET_SETTINGS':
        case 'EXPORT_DATA':
            return true;
        case 'GET_INTERVENTION':
            return (typeof msg.tabId === 'number' &&
                typeof msg.nonce === 'string' &&
                msg.nonce.length > 0);
        case 'UPDATE_INTERVENTION_STATUS':
            return (typeof msg.tabId === 'number' &&
                typeof msg.nonce === 'string' &&
                msg.nonce.length > 0 &&
                msg.status === 'IN_PROGRESS');
        case 'COMPLETE_INTERVENTION':
            return (typeof msg.tabId === 'number' &&
                typeof msg.targetUrl === 'string' &&
                msg.targetUrl.length > 0 &&
                typeof msg.nonce === 'string' &&
                msg.nonce.length > 0 &&
                (msg.intentionText === undefined || typeof msg.intentionText === 'string'));
        case 'CANCEL_INTERVENTION':
            return (typeof msg.tabId === 'number' &&
                typeof msg.nonce === 'string' &&
                msg.nonce.length > 0);
        case 'GET_TAB_USAGE':
        case 'GET_CURRENT_SITE_STATE':
            return msg.tabId === undefined || typeof msg.tabId === 'number';
        case 'GET_COLLECTION_USAGE':
            return typeof msg.collectionId === 'string' && msg.collectionId.length > 0;
        case 'CREATE_COLLECTION':
            return (typeof msg.name === 'string' &&
                msg.name.trim().length > 0 &&
                (msg.color === undefined || typeof msg.color === 'string') &&
                (msg.icon === undefined || typeof msg.icon === 'string') &&
                (msg.dailyLimitMs === undefined ||
                    msg.dailyLimitMs === null ||
                    (typeof msg.dailyLimitMs === 'number' && Number.isFinite(msg.dailyLimitMs))) &&
                (msg.boundary === undefined || typeof msg.boundary === 'object'));
        case 'UPDATE_COLLECTION':
            return (typeof msg.collectionId === 'string' &&
                msg.collectionId.length > 0 &&
                typeof msg.updates === 'object' &&
                msg.updates !== null);
        case 'DELETE_COLLECTION':
            return typeof msg.collectionId === 'string' && msg.collectionId.length > 0;
        case 'CREATE_RULE':
            return (typeof msg.collectionId === 'string' &&
                msg.collectionId.length > 0 &&
                typeof msg.pattern === 'string' &&
                msg.pattern.trim().length > 0 &&
                VALID_TARGET_TYPES.has(msg.ruleType) &&
                (msg.isException === undefined || typeof msg.isException === 'boolean'));
        case 'UPDATE_RULE':
            return (typeof msg.collectionId === 'string' &&
                msg.collectionId.length > 0 &&
                typeof msg.ruleId === 'string' &&
                msg.ruleId.length > 0 &&
                typeof msg.updates === 'object' &&
                msg.updates !== null);
        case 'DELETE_RULE':
            return (typeof msg.collectionId === 'string' &&
                msg.collectionId.length > 0 &&
                typeof msg.ruleId === 'string' &&
                msg.ruleId.length > 0);
        case 'UPDATE_SETTINGS':
            return typeof msg.settings === 'object' && msg.settings !== null;
        case 'IMPORT_DATA':
            return (msg.data !== undefined &&
                msg.data !== null &&
                (msg.mode === undefined || msg.mode === 'merge' || msg.mode === 'replace'));
        case 'REQUEST_INTENT_PASS':
            return ((msg.tabId === undefined || typeof msg.tabId === 'number') &&
                typeof msg.durationMs === 'number' &&
                Number.isFinite(msg.durationMs));
        case 'GET_INTENT_PASS_STATUS':
        case 'END_INTENT_PASS':
            return msg.tabId === undefined || typeof msg.tabId === 'number';
        case 'START_FOCUS_MODE':
            return ((msg.durationMs === undefined ||
                (typeof msg.durationMs === 'number' && Number.isFinite(msg.durationMs))) &&
                Array.isArray(msg.collectionIds));
        case 'GET_FOCUS_MODE_STATUS':
        case 'END_FOCUS_MODE':
            return true;
        default:
            return false;
    }
}
