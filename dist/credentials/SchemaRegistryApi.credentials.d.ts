import type { ICredentialDataDecryptedObject, ICredentialTestRequest, ICredentialType, IHttpRequestOptions, INodeProperties } from 'n8n-workflow';
export declare class SchemaRegistryApi implements ICredentialType {
    name: string;
    displayName: string;
    documentationUrl: string;
    properties: INodeProperties[];
    /**
     * Backs the credential test request and generic HTTP reuse (e.g. the HTTP
     * Request node) only. The Kafka nodes authenticate against the registry
     * through the `SchemaRegistry` client constructor, not this function.
     */
    authenticate(credentials: ICredentialDataDecryptedObject, requestOptions: IHttpRequestOptions): Promise<IHttpRequestOptions>;
    test: ICredentialTestRequest;
}
//# sourceMappingURL=SchemaRegistryApi.credentials.d.ts.map