import type { ICredentialDataDecryptedObject, ICredentialTestRequest, ICredentialType, IHttpRequestHelper, IHttpRequestOptions, INodeProperties } from 'n8n-workflow';
export declare class SalesforceJwtApi implements ICredentialType {
    name: string;
    displayName: string;
    documentationUrl: string;
    properties: INodeProperties[];
    preAuthentication(this: IHttpRequestHelper, credentials: ICredentialDataDecryptedObject): Promise<{
        accessToken: string;
        instanceUrl: string;
    }>;
    authenticate(credentials: ICredentialDataDecryptedObject, requestOptions: IHttpRequestOptions): Promise<IHttpRequestOptions>;
    test: ICredentialTestRequest;
}
export declare function resolveAuthUrl(credentials: ICredentialDataDecryptedObject): string;
//# sourceMappingURL=SalesforceJwtApi.credentials.d.ts.map