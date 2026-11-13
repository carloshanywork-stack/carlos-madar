/**
 * Browser clients reuse the exact notification catalog persisted by the API.
 * Keep this re-export so existing imports keep working and the packaged APK
 * stays in sync with the server-generated message text.
 */
export { operationNotification } from '../../../shared/operation-notifications.js';
