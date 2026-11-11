"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MicrosoftGraphSecurityOAuth2Api = void 0;
const defaultScopes = ['SecurityEvents.ReadWrite.All', 'offline_access'];
class MicrosoftGraphSecurityOAuth2Api {
    name = 'microsoftGraphSecurityOAuth2Api';
    displayName = 'Microsoft Graph Security OAuth2 API';
    extends = ['microsoftOAuth2Api'];
    documentationUrl = 'microsoft';
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
            default: defaultScopes.join(' '),
            description: 'Scopes that should be enabled',
        },
        {
            displayName: 'Scope',
            name: 'scope',
            type: 'hidden',
            default: '={{$self["customScopes"] ? $self["enabledScopes"] : "' + defaultScopes.join(' ') + '"}}',
        },
    ];
}
exports.MicrosoftGraphSecurityOAuth2Api = MicrosoftGraphSecurityOAuth2Api;
//# sourceMappingURL=MicrosoftGraphSecurityOAuth2Api.credentials.js.map