"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaserowApi = void 0;
// https://api.baserow.io/api/redoc/#section/Authentication
class BaserowApi {
    name = 'baserowApi';
    displayName = 'Baserow API';
    documentationUrl = 'baserow';
    properties = [
        {
            displayName: "This type of connection (Username & Password) is deprecated. Please create a new credential of type 'Baserow Token API' instead.",
            name: 'deprecated',
            type: 'notice',
            default: '',
        },
        {
            displayName: 'Host',
            name: 'host',
            type: 'string',
            default: 'https://api.baserow.io',
        },
        {
            displayName: 'Session Token',
            name: 'jwtToken',
            type: 'hidden',
            typeOptions: {
                expirable: true,
            },
            default: '',
        },
        {
            displayName: 'Username',
            name: 'username',
            type: 'string',
            default: '',
            description: 'Email address you use to login to Baserow',
        },
        {
            displayName: 'Password',
            name: 'password',
            type: 'string',
            default: '',
            typeOptions: {
                password: true,
            },
        },
    ];
    async preAuthentication(credentials) {
        const host = credentials.host.replace(/\/$/, '');
        const { token } = (await this.helpers.httpRequest({
            method: 'POST',
            url: `${host}/api/user/token-auth/`,
            body: {
                username: credentials.username,
                password: credentials.password,
            },
        }));
        return { jwtToken: token };
    }
    authenticate = {
        type: 'generic',
        properties: {
            headers: {
                Authorization: '=JWT {{$credentials.jwtToken}}',
            },
        },
    };
    test = {
        request: {
            baseURL: '={{$credentials.host}}',
            url: '/api/applications/',
        },
    };
}
exports.BaserowApi = BaserowApi;
//# sourceMappingURL=BaserowApi.credentials.js.map