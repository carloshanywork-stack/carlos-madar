"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CurrentsApi = void 0;
class CurrentsApi {
    name = 'currentsApi';
    displayName = 'Currents API';
    documentationUrl = 'https://docs.currents.dev/api';
    properties = [
        {
            displayName: 'API Key',
            name: 'apiKey',
            type: 'string',
            typeOptions: { password: true },
            default: '',
            required: true,
            description: 'API key from Currents Dashboard (Organization > API & Record Keys)',
        },
    ];
    authenticate = {
        type: 'generic',
        properties: {
            headers: {
                Authorization: '=Bearer {{$credentials.apiKey}}',
            },
        },
    };
    test = {
        request: {
            baseURL: 'https://api.currents.dev/v1',
            url: '/projects',
            method: 'GET',
        },
    };
}
exports.CurrentsApi = CurrentsApi;
//# sourceMappingURL=CurrentsApi.credentials.js.map