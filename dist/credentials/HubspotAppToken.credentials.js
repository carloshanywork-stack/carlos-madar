"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HubspotAppToken = void 0;
class HubspotAppToken {
    name = 'hubspotAppToken';
    displayName = 'HubSpot Service Key';
    documentationUrl = 'hubspot';
    properties = [
        {
            displayName: 'Service Key',
            name: 'appToken',
            type: 'string',
            typeOptions: { password: true },
            default: '',
        },
    ];
    authenticate = {
        type: 'generic',
        properties: {
            headers: {
                Authorization: '=Bearer {{$credentials.appToken}}',
            },
        },
    };
    test = {
        request: {
            baseURL: 'https://api.hubapi.com',
            url: '/account-info/v3/details',
        },
    };
}
exports.HubspotAppToken = HubspotAppToken;
//# sourceMappingURL=HubspotAppToken.credentials.js.map