import type { ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';
export declare class DatabricksOAuth2Api implements ICredentialType {
    name: string;
    extends: string[];
    displayName: string;
    documentationUrl: string;
    icon: 'file:icons/databricks.svg';
    properties: INodeProperties[];
    test: ICredentialTestRequest;
}
//# sourceMappingURL=DatabricksOAuth2Api.credentials.d.ts.map