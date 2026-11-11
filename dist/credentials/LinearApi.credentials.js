"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LinearApi = void 0;
class LinearApi {
    name = 'linearApi';
    displayName = 'Linear API';
    documentationUrl = 'linear';
    properties = [
        {
            displayName: 'API Key',
            name: 'apiKey',
            type: 'string',
            typeOptions: { password: true },
            default: '',
        },
        {
            displayName: 'Signing Secret',
            name: 'signingSecret',
            type: 'string',
            typeOptions: { password: true },
            default: '',
            description: 'The signing secret is used to verify the authenticity of webhook requests sent by Linear.',
        },
    ];
    authenticate = {
        type: 'generic',
        properties: {
            headers: {
                Authorization: '={{$credentials.apiKey}}',
            },
        },
    };
}
exports.LinearApi = LinearApi;
//# sourceMappingURL=LinearApi.credentials.js.map