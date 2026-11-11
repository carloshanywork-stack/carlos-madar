"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CiscoSecureEndpointApi = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const token_request_1 = require("./common/token-request");
// `region` is interpolated into the token-exchange host, so the stored value must stay
// inside this fixed set. The options field and the runtime check both read it from here.
const REGION_OPTIONS = [
    { name: 'Asia Pacific, Japan, and China', value: 'apjc.amp' },
    { name: 'Europe', value: 'eu.amp' },
    { name: 'North America', value: 'amp' },
];
function assertSupportedRegion(region) {
    if (typeof region !== 'string' || !REGION_OPTIONS.some((option) => option.value === region)) {
        throw new n8n_workflow_1.UserError('Unsupported Cisco Secure Endpoint region');
    }
}
class CiscoSecureEndpointApi {
    name = 'ciscoSecureEndpointApi';
    displayName = 'Cisco Secure Endpoint (AMP) API';
    documentationUrl = 'ciscosecureendpoint';
    icon = { light: 'file:icons/Cisco.svg', dark: 'file:icons/Cisco.dark.svg' };
    httpRequestNode = {
        name: 'Cisco Secure Endpoint',
        docsUrl: 'https://developer.cisco.com/docs/secure-endpoint/',
        apiBaseUrl: '',
    };
    properties = [
        {
            displayName: 'Region',
            name: 'region',
            type: 'options',
            options: [...REGION_OPTIONS],
            default: 'amp',
        },
        {
            displayName: 'Client ID',
            name: 'clientId',
            type: 'string',
            default: '',
            required: true,
        },
        {
            displayName: 'Client Secret',
            name: 'clientSecret',
            type: 'string',
            typeOptions: {
                password: true,
            },
            default: '',
            required: true,
        },
    ];
    async authenticate(credentials, requestOptions) {
        const clientId = credentials.clientId;
        const clientSecret = credentials.clientSecret;
        const region = credentials.region;
        assertSupportedRegion(region);
        // `region` is interpolated into the request host, so gate the token POSTs on SSRF protection.
        const http = (0, token_request_1.getTokenRequestClient)('user-controlled');
        // Apply the credential's own allow-list to the token requests it issues.
        const allowedDomains = (0, n8n_workflow_1.getCredentialOwnRequestAllowedDomains)(credentials);
        const secureXToken = (await http.request({
            url: `https://visibility.${region}.cisco.com/iroh/oauth2/token`,
            method: 'POST',
            auth: {
                username: clientId,
                password: clientSecret,
            },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
            }).toString(),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            json: true,
            timeout: token_request_1.TOKEN_REQUEST_TIMEOUT,
            allowedDomains,
        }));
        const secureEndpointToken = (await http.request({
            url: `https://api.${region}.cisco.com/v3/access_tokens`,
            method: 'POST',
            body: new URLSearchParams({
                grant_type: 'client_credentials',
            }).toString(),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
                Authorization: `Bearer ${secureXToken.access_token}`,
            },
            json: true,
            timeout: token_request_1.TOKEN_REQUEST_TIMEOUT,
            allowedDomains,
        }));
        const requestOptionsWithAuth = {
            ...requestOptions,
            headers: {
                ...requestOptions.headers,
                Authorization: `Bearer ${secureEndpointToken.access_token}`,
            },
        };
        return requestOptionsWithAuth;
    }
    test = {
        request: {
            baseURL: '=https://api.{{$credentials.region}}.cisco.com',
            url: '/v3/organizations',
            qs: {
                size: 10,
            },
        },
    };
}
exports.CiscoSecureEndpointApi = CiscoSecureEndpointApi;
//# sourceMappingURL=CiscoSecureEndpointApi.credentials.js.map