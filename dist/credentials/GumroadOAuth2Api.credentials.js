"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GumroadOAuth2Api = exports.defaultScopes = void 0;
// https://gumroad.com/api#oauth
exports.defaultScopes = ['view_sales'];
class GumroadOAuth2Api {
    name = 'gumroadOAuth2Api';
    extends = ['oAuth2Api'];
    displayName = 'Gumroad OAuth2 API';
    documentationUrl = 'gumroad';
    properties = [
        {
            displayName: 'Grant Type',
            name: 'grantType',
            type: 'hidden',
            default: 'authorizationCode',
        },
        {
            displayName: 'Authorization URL',
            name: 'authUrl',
            type: 'hidden',
            default: 'https://gumroad.com/oauth/authorize',
            required: true,
        },
        {
            displayName: 'Access Token URL',
            name: 'accessTokenUrl',
            type: 'hidden',
            default: 'https://gumroad.com/oauth/token',
            required: true,
        },
        {
            displayName: 'Auth URI Query Parameters',
            name: 'authQueryParameters',
            type: 'hidden',
            default: '',
        },
        {
            displayName: 'Authentication',
            name: 'authentication',
            type: 'hidden',
            default: 'body',
        },
        {
            displayName: 'Custom Scopes',
            name: 'customScopes',
            type: 'boolean',
            default: false,
            description: 'Define custom scopes',
        },
        {
            displayName: 'The default scopes needed for the node to work are already set. If you change these the node may not function correctly.',
            name: 'customScopesNotice',
            type: 'notice',
            default: '',
            displayOptions: {
                show: {
                    customScopes: [true],
                },
            },
        },
        {
            displayName: 'Enabled Scopes',
            name: 'enabledScopes',
            type: 'string',
            displayOptions: {
                show: {
                    customScopes: [true],
                },
            },
            default: exports.defaultScopes.join(' '),
            description: 'Space-separated list of scopes that should be enabled',
        },
        {
            displayName: 'Scope',
            name: 'scope',
            type: 'hidden',
            default: '={{$self["customScopes"] ? $self["enabledScopes"] : "' + exports.defaultScopes.join(' ') + '"}}',
        },
    ];
}
exports.GumroadOAuth2Api = GumroadOAuth2Api;
//# sourceMappingURL=GumroadOAuth2Api.credentials.js.map