import type { ICredentialDataDecryptedObject, ICredentialTestRequest, ICredentialType, IHttpRequestHelper, IHttpRequestOptions, INodeProperties, Icon } from 'n8n-workflow';
export declare function getAccessToken(credentials: ICredentialDataDecryptedObject): Promise<{
    accessToken: string;
    n8n_expires_at: string;
}>;
export declare class AtlassianServiceAccountApi implements ICredentialType {
    name: string;
    displayName: string;
    documentationUrl: string;
    icon: Icon;
    properties: INodeProperties[];
    preAuthentication(this: IHttpRequestHelper, credentials: ICredentialDataDecryptedObject): Promise<{
        accessToken: string;
        n8n_expires_at: string;
    }>;
    authenticate(credentials: ICredentialDataDecryptedObject, requestOptions: IHttpRequestOptions): Promise<IHttpRequestOptions>;
    test: ICredentialTestRequest;
}
//# sourceMappingURL=AtlassianServiceAccountApi.credentials.d.ts.map