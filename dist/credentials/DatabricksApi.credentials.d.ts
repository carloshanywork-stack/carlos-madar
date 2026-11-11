import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';
export declare class DatabricksApi implements ICredentialType {
    name: string;
    displayName: string;
    documentationUrl: string;
    icon: 'file:icons/databricks.svg';
    properties: INodeProperties[];
    authenticate: IAuthenticateGeneric;
    test: ICredentialTestRequest;
}
//# sourceMappingURL=DatabricksApi.credentials.d.ts.map