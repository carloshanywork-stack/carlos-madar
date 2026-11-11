"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleApi = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const moment_timezone_1 = __importDefault(require("moment-timezone"));
const regions_1 = require("./common/google/regions");
const token_request_1 = require("./common/token-request");
class GoogleApi {
    name = 'googleApi';
    displayName = 'Google Service Account API';
    documentationUrl = 'google/service-account';
    icon = 'file:icons/Google.svg';
    properties = [
        {
            displayName: 'Region',
            name: 'region',
            type: 'options',
            options: [
                // Newer Gemini models (e.g. Gemini 3.x) are only served from `global` or the
                // `eu`/`us` multi-region locations, not individual regions, so list them first.
                { name: 'Global (multi-region) - global', value: 'global' },
                { name: 'EU (multi-region) - eu', value: 'eu' },
                { name: 'US (multi-region) - us', value: 'us' },
                ...regions_1.regions.map((r) => ({
                    name: `${r.displayName} (${r.location}) - ${r.name}`,
                    value: r.name,
                })),
            ],
            // Global is the only location that serves both Gemini 2.x and 3.x models.
            default: 'global',
            description: 'The region where the Google Cloud service is located. This applies only to specific nodes, like the Google Vertex Chat Model',
        },
        {
            displayName: 'Service Account Email',
            name: 'email',
            type: 'string',
            placeholder: 'name@email.com',
            default: '',
            description: 'The Google Service account similar to user-808@project.iam.gserviceaccount.com',
            required: true,
        },
        {
            displayName: 'Private Key',
            name: 'privateKey',
            type: 'string',
            default: '',
            placeholder: '-----BEGIN PRIVATE KEY-----\nXIYEvQIBADANBg<...>0IhA7TMoGYPQc=\n-----END PRIVATE KEY-----\n',
            description: 'Enter the private key located in the JSON file downloaded from Google Cloud Console',
            required: true,
            typeOptions: {
                password: true,
            },
        },
        {
            displayName: 'Impersonate a User',
            name: 'inpersonate',
            type: 'boolean',
            default: false,
        },
        {
            displayName: 'Email',
            name: 'delegatedEmail',
            type: 'string',
            default: '',
            displayOptions: {
                show: {
                    inpersonate: [true],
                },
            },
            description: 'The email address of the user for which the application is requesting delegated access',
        },
        {
            displayName: 'Set up for use in HTTP Request node',
            name: 'httpNode',
            type: 'boolean',
            default: false,
        },
        {
            displayName: "When using the HTTP Request node, you must specify the scopes you want to send. In other nodes, they're added automatically",
            name: 'httpWarning',
            type: 'notice',
            default: '',
            displayOptions: {
                show: {
                    httpNode: [true],
                },
            },
        },
        {
            displayName: 'Scope(s)',
            name: 'scopes',
            type: 'string',
            default: '',
            description: 'You can find the scopes for services <a href="https://developers.google.com/identity/protocols/oauth2/scopes" target="_blank">here</a>',
            displayOptions: {
                show: {
                    httpNode: [true],
                },
            },
        },
    ];
    async authenticate(credentials, requestOptions) {
        if (!credentials.httpNode)
            return requestOptions;
        const privateKey = credentials.privateKey.replace(/\\n/g, '\n').trim();
        const credentialsScopes = credentials.scopes.replace(/\\n/g, '\n').trim();
        credentials.email = credentials.email.trim();
        const regex = /[,\s\n]+/;
        const scopes = credentialsScopes
            .split(regex)
            .filter((scope) => scope)
            .join(' ');
        const now = (0, moment_timezone_1.default)().unix();
        const signature = jsonwebtoken_1.default.sign({
            iss: credentials.email,
            sub: credentials.delegatedEmail || credentials.email,
            scope: scopes,
            aud: 'https://oauth2.googleapis.com/token',
            iat: now,
            exp: now + 3600,
        }, privateKey, {
            algorithm: 'RS256',
            header: {
                typ: 'JWT',
                alg: 'RS256',
            },
        });
        // Fixed Google vendor host, independent of any n8n config, so SSRF protection is opted out.
        const http = (0, token_request_1.getTokenRequestClient)('fixed-vendor');
        const { access_token } = (await http.request({
            url: 'https://oauth2.googleapis.com/token',
            method: 'POST',
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: signature,
            }).toString(),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            json: true,
            timeout: token_request_1.TOKEN_REQUEST_TIMEOUT,
        }));
        const requestOptionsWithAuth = {
            ...requestOptions,
            headers: {
                ...requestOptions.headers,
                Authorization: `Bearer ${access_token}`,
            },
        };
        return requestOptionsWithAuth;
    }
}
exports.GoogleApi = GoogleApi;
//# sourceMappingURL=GoogleApi.credentials.js.map