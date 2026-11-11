"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostHogApi = void 0;
class PostHogApi {
    name = 'postHogApi';
    displayName = 'PostHog API';
    documentationUrl = 'posthog';
    properties = [
        {
            displayName: 'URL',
            name: 'url',
            type: 'string',
            default: 'https://app.posthog.com',
        },
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
            body: {
                api_key: '={{$credentials.apiKey}}',
            },
        },
    };
    test = {
        request: {
            baseURL: '={{$credentials.url}}',
            url: '/decide/',
            method: 'POST',
            body: {
                distinct_id: 'test',
            },
        },
    };
}
exports.PostHogApi = PostHogApi;
//# sourceMappingURL=PostHogApi.credentials.js.map