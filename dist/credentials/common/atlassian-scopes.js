"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.confluenceDefaultScopes = exports.jiraDefaultScopes = exports.offlineAccessScope = void 0;
/**
 * Default OAuth2 scopes for the Atlassian product credentials — only scopes the
 * nodes actually use, since Atlassian rejects any requested scope that isn't
 * enabled on the OAuth app.
 *
 * https://developer.atlassian.com/cloud/jira/platform/scopes-for-oauth-2-3LO-and-forge-apps/
 * https://developer.atlassian.com/cloud/confluence/scopes-for-oauth-2-3LO-and-forge-apps/
 */
exports.offlineAccessScope = 'offline_access';
// Omits the previously shipped `manage:jira-user`: retired from Atlassian's catalog
// and silently dropped at consent, so no token ever carried it.
exports.jiraDefaultScopes = [
    'read:jira-user',
    'read:jira-work',
    'write:jira-work',
    'manage:jira-webhook',
    exports.offlineAccessScope,
];
// Granular scopes only: the Confluence v2 REST API rejects classic scopes, and the
// v1 endpoints the node still uses accept granular ones too.
exports.confluenceDefaultScopes = [
    'read:page:confluence',
    'write:page:confluence',
    'read:hierarchical-content:confluence',
    'read:space:confluence',
    'read:attachment:confluence',
    'read:comment:confluence',
    'read:label:confluence',
    'read:content-details:confluence',
    'write:attachment:confluence',
    'delete:attachment:confluence',
    'write:comment:confluence',
    'delete:comment:confluence',
    'write:label:confluence',
    'delete:page:confluence',
    exports.offlineAccessScope,
];
//# sourceMappingURL=atlassian-scopes.js.map