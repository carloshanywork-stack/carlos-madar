"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrbitApi = void 0;
class OrbitApi {
    name = 'orbitApi';
    displayName = 'Orbit API';
    documentationUrl = 'orbit';
    properties = [
        {
            displayName: 'Orbit has been shutdown and will no longer function from July 11th, You can read more <a target="_blank" href="https://blog.postman.com/announcing-postman-has-acquired-orbit/">here</a>.',
            name: 'deprecated',
            type: 'notice',
            default: '',
        },
        {
            displayName: 'API Token',
            name: 'accessToken',
            type: 'string',
            typeOptions: { password: true },
            default: '',
        },
    ];
}
exports.OrbitApi = OrbitApi;
//# sourceMappingURL=OrbitApi.credentials.js.map