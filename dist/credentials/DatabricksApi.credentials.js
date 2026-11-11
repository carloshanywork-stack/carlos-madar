"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabricksApi = void 0;
const constants_1 = require("../nodes/Databricks/constants");
class DatabricksApi {
    name = 'databricksApi';
    displayName = 'Databricks';
    documentationUrl = 'https://docs.databricks.com/dev-tools/api/latest/authentication.html';
    icon = 'file:icons/databricks.svg';
    properties = [
        {
            displayName: 'Host',
            name: 'host',
            type: 'string',
            default: '',
            placeholder: 'https://adb-xxxxx.xx.azure.databricks.com',
            required: true,
            description: 'Domain of your Databricks workspace',
        },
        {
            displayName: 'Personal Access Token',
            name: 'token',
            type: 'string',
            typeOptions: {
                password: true,
            },
            default: '',
            placeholder: 'dapixxxxxxxxxxxxxxxxxxxxxx',
            required: true,
            description: 'Databricks personal access token',
        },
    ];
    // The partner User-Agent is deliberately not set here: `authenticate` is bound
    // to the credential rather than to a host, so it would also apply to arbitrary
    // URLs called with the HTTP Request node. Node requests get it from
    // databricksApiRequest() instead.
    authenticate = {
        type: 'generic',
        properties: {
            headers: {
                Authorization: '=Bearer {{$credentials.token}}',
            },
        },
    };
    test = {
        request: {
            baseURL: '={{$credentials.host}}',
            url: '/api/2.0/preview/scim/v2/Me',
            method: 'GET',
            headers: { 'User-Agent': constants_1.DATABRICKS_PARTNER_USER_AGENT },
        },
    };
}
exports.DatabricksApi = DatabricksApi;
//# sourceMappingURL=DatabricksApi.credentials.js.map