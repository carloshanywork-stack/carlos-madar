"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UptimeRobotApi = void 0;
class UptimeRobotApi {
    name = 'uptimeRobotApi';
    displayName = 'Uptime Robot API';
    documentationUrl = 'uptimerobot';
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
            body: {
                api_key: '={{$credentials.apiKey}}',
            },
        },
    };
    test = {
        request: {
            baseURL: 'https://api.uptimerobot.com',
            url: '/v2/getAccountDetails',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        },
    };
}
exports.UptimeRobotApi = UptimeRobotApi;
//# sourceMappingURL=UptimeRobotApi.credentials.js.map