"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClearbitApi = void 0;
class ClearbitApi {
    name = 'clearbitApi';
    displayName = 'Clearbit API';
    documentationUrl = 'clearbit';
    properties = [
        {
            displayName: 'API Key',
            name: 'apiKey',
            type: 'string',
            typeOptions: { password: true },
            required: true,
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
            baseURL: 'https://company.clearbit.com',
            url: '/v2/companies/find',
            qs: {
                domain: 'clearbit.com',
            },
        },
    };
}
exports.ClearbitApi = ClearbitApi;
//# sourceMappingURL=ClearbitApi.credentials.js.map