"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PeekalinkApi = void 0;
class PeekalinkApi {
    name = 'peekalinkApi';
    displayName = 'Peekalink API';
    documentationUrl = 'peekalink';
    properties = [
        {
            displayName: 'API Key',
            name: 'apiKey',
            type: 'string',
            typeOptions: { password: true },
            default: '',
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
            baseURL: 'https://api.peekalink.io',
            url: '/',
            method: 'POST',
            body: {
                link: 'https://www.example.com',
            },
        },
    };
}
exports.PeekalinkApi = PeekalinkApi;
//# sourceMappingURL=PeekalinkApi.credentials.js.map