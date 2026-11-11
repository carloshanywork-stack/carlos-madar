"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfluenceCloudOAuth2Api = void 0;
const atlassian_scopes_1 = require("./common/atlassian-scopes");
const defaultScopes = atlassian_scopes_1.confluenceDefaultScopes;
class ConfluenceCloudOAuth2Api {
    name = 'confluenceCloudOAuth2Api';
    extends = ['atlassianOAuth2Api'];
    displayName = 'Confluence Cloud OAuth2 API';
    documentationUrl = 'confluence';
    properties = [
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
exports.ConfluenceCloudOAuth2Api = ConfluenceCloudOAuth2Api;
//# sourceMappingURL=ConfluenceCloudOAuth2Api.credentials.js.map