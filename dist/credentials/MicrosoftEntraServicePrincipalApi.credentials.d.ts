import type { ICredentialDataDecryptedObject, ICredentialTestRequest, ICredentialType, IHttpRequestHelper, IHttpRequestOptions, INodeProperties, Icon } from 'n8n-workflow';
/**
 * Exchanges the application credentials for a Microsoft Graph access token via the
 * OAuth2 `client_credentials` grant and returns the raw `access_token`.
 *
 * Exported for unit testing. Validation runs before any network call.
 */
export declare function getAccessToken(credentials: ICredentialDataDecryptedObject): Promise<string>;
export declare class MicrosoftEntraServicePrincipalApi implements ICredentialType {
    name: string;
    displayName: string;
    documentationUrl: string;
    icon: Icon;
    properties: INodeProperties[];
    preAuthentication(this: IHttpRequestHelper, credentials: ICredentialDataDecryptedObject): Promise<{
        accessToken: string;
    }>;
    authenticate(credentials: ICredentialDataDecryptedObject, requestOptions: IHttpRequestOptions): Promise<IHttpRequestOptions>;
    test: ICredentialTestRequest;
}
//# sourceMappingURL=MicrosoftEntraServicePrincipalApi.credentials.d.ts.map