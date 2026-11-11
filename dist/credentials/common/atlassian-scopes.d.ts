/**
 * Default OAuth2 scopes for the Atlassian product credentials — only scopes the
 * nodes actually use, since Atlassian rejects any requested scope that isn't
 * enabled on the OAuth app.
 *
 * https://developer.atlassian.com/cloud/jira/platform/scopes-for-oauth-2-3LO-and-forge-apps/
 * https://developer.atlassian.com/cloud/confluence/scopes-for-oauth-2-3LO-and-forge-apps/
 */
export declare const offlineAccessScope = "offline_access";
export declare const jiraDefaultScopes: string[];
export declare const confluenceDefaultScopes: string[];
//# sourceMappingURL=atlassian-scopes.d.ts.map