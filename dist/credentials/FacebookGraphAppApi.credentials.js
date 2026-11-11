"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FacebookGraphAppApi = void 0;
class FacebookGraphAppApi {
    name = 'facebookGraphAppApi';
    displayName = 'Facebook Graph API (App)';
    documentationUrl = 'facebookapp';
    extends = ['facebookGraphApi'];
    properties = [
        {
            displayName: 'App Secret',
            name: 'appSecret',
            type: 'string',
            typeOptions: { password: true },
            default: '',
            description: '(Optional) When set, the node will sign API calls and verify incoming webhook payloads for added security',
        },
    ];
}
exports.FacebookGraphAppApi = FacebookGraphAppApi;
//# sourceMappingURL=FacebookGraphAppApi.credentials.js.map