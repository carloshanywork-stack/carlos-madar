/**
 * Clockify Node - Version 1
 * Discriminator: resource=workspace, operation=getAll
 */


interface Credentials {
  clockifyApi: CredentialReference;
}

/** Get many clients */
export type ClockifyV1WorkspaceGetAllParams = {
  resource: 'workspace';
  operation: 'getAll';
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 100
 */
    limit?: number | Expression<number>;
};

export type ClockifyV1WorkspaceGetAllNode = {
  type: 'n8n-nodes-base.clockify';
  version: 1;
  config: NodeConfig<ClockifyV1WorkspaceGetAllParams> & { credentials?: Credentials };
};