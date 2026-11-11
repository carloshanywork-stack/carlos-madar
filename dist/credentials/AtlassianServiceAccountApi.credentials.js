"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AtlassianServiceAccountApi = void 0;
exports.getAccessToken = getAccessToken;
const backend_network_1 = require("@n8n/backend-network");
const n8n_workflow_1 = require("n8n-workflow");
const token_request_1 = require("./common/token-request");
const TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
/**
 * Epoch-millisecond expiry for the minted token, stored alongside it so core can tell a live
 * token from one that has to be renewed when the gateway answers an ambiguous 403/404 (ENT-408).
 * An omitted or unusable `expires_in` yields '', which core reads as "unknown" and retries on.
 */
function expiresAtFrom(response) {
    const expiresIn = Number(response.expires_in);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0)
        return '';
    return String(Date.now() + expiresIn * 1000);
}
async function getAccessToken(credentials) {
    const stringOrEmpty = (value) => (typeof value === 'string' ? value.trim() : '');
    const clientId = stringOrEmpty(credentials.clientId);
    const clientSecret = stringOrEmpty(credentials.clientSecret);
    if (!clientId || !clientSecret) {
        throw new n8n_workflow_1.UserError('Atlassian service account credentials are incomplete');
    }
    // Atlassian rejects any `scope` value with invalid_scope
    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
    });
    let response;
    try {
        response = await (0, token_request_1.getTokenRequestClient)('fixed-vendor').request({
            url: TOKEN_URL,
            method: 'POST',
            body: body.toString(),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            json: true,
            timeout: token_request_1.TOKEN_REQUEST_TIMEOUT,
        });
    }
    catch (error) {
        // 400 is invalid_client for an unknown client; the message stays static so no response data leaks
        const status = (0, backend_network_1.httpStatusFromError)(error);
        if (status === 400 || status === 401 || status === 403) {
            throw new n8n_workflow_1.UserError('Atlassian rejected the service account credentials. Check the Client ID and Client Secret.');
        }
        throw error;
    }
    if (!(0, token_request_1.hasAccessToken)(response)) {
        throw new n8n_workflow_1.OperationalError('Atlassian authentication did not return an access token');
    }
    return { accessToken: response.access_token, n8n_expires_at: expiresAtFrom(response) };
}
class AtlassianServiceAccountApi {
    name = 'atlassianServiceAccountApi';
    displayName = 'Atlassian Service Account';
    documentationUrl = 'jira';
    icon = 'file:icons/Atlassian.svg';
    properties = [
        {
            displayName: 'Access Token',
            name: 'accessToken',
            type: 'hidden',
            typeOptions: {
                expirable: true,
            },
            default: '',
        },
        {
            // Written by `preAuthentication`, read by core's refresh-and-resend gate. Declared so it
            // survives `applyDefaultsAndOverwrites`, which drops undeclared credential fields.
            displayName: 'Access Token Expires At',
            name: 'n8n_expires_at',
            type: 'hidden',
            default: '',
        },
        {
            displayName: "The service account's scopes are chosen when its OAuth 2.0 credential is created in Atlassian administration and can't be changed afterwards. Product permissions still apply on top — grant the service account access to projects and spaces like any other user.",
            name: 'setupNotice',
            type: 'notice',
            default: '',
        },
        {
            displayName: 'Client ID',
            name: 'clientId',
            type: 'string',
            default: '',
            required: true,
            description: "The Client ID of the service account's OAuth 2.0 credential from Atlassian administration",
        },
        {
            displayName: 'Client Secret',
            name: 'clientSecret',
            type: 'string',
            typeOptions: {
                password: true,
            },
            default: '',
            required: true,
            description: "The Client Secret of the service account's OAuth 2.0 credential from Atlassian administration",
        },
    ];
    async preAuthentication(credentials) {
        return await getAccessToken(credentials);
    }
    async authenticate(credentials, requestOptions) {
        requestOptions.headers = {
            ...requestOptions.headers,
            Authorization: `Bearer ${credentials.accessToken}`,
        };
        return requestOptions;
    }
    test = {
        request: {
            baseURL: 'https://api.atlassian.com',
            url: '/oauth/token/accessible-resources',
            method: 'GET',
        },
    };
}
exports.AtlassianServiceAccountApi = AtlassianServiceAccountApi;
//# sourceMappingURL=AtlassianServiceAccountApi.credentials.js.map