import type { IAuthenticate, ICredentialType, INodeProperties, Icon } from 'n8n-workflow';
export declare class HttpTemplatedCustomAuth implements ICredentialType {
    name: string;
    displayName: string;
    genericAuth: boolean;
    icon: Icon;
    properties: INodeProperties[];
    authenticate: IAuthenticate;
}
//# sourceMappingURL=HttpTemplatedCustomAuth.credentials.d.ts.map