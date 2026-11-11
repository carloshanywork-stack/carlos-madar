"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleChatOAuth2Api = void 0;
const scopes = [
    'https://www.googleapis.com/auth/chat.spaces',
    'https://www.googleapis.com/auth/chat.messages',
    'https://www.googleapis.com/auth/chat.memberships',
];
class GoogleChatOAuth2Api {
    name = 'googleChatOAuth2Api';
    extends = ['googleOAuth2Api'];
    displayName = 'Chat OAuth2 API';
    documentationUrl = 'google/oauth-single-service';
    properties = [
        {
            displayName: 'Custom Scopes',
            name: 'customScopes',
            type: 'boolean',
            default: false,
            description: 'Define custom scopes',
        },
        {
            displayName: 'The default scopes needed for the node to work are already set, If you change these the node may not function correctly.',
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
            default: scopes.join(' '),
            description: 'Scopes that should be enabled',
        },
        {
            displayName: 'Scope',
            name: 'scope',
            type: 'hidden',
            default: '={{$self["customScopes"] ? $self["enabledScopes"] : "' + scopes.join(' ') + '"}}',
        },
    ];
}
exports.GoogleChatOAuth2Api = GoogleChatOAuth2Api;
//# sourceMappingURL=GoogleChatOAuth2Api.credentials.js.map