/**
 * Clockify Node - Version 1
 * Discriminator: resource=client, operation=getAll
 */


interface Credentials {
  clockifyApi: CredentialReference;
}

/** Get many clients */
export type ClockifyV1ClientGetAllParams = {
  resource: 'client';
  operation: 'getAll';
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod listWorkspaces
 * @default []
 */
    workspaceId?: string | Expression<string>;
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
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Archived
     * @default false
     */
    archived?: boolean | Expression<boolean>;
    /** If provided, clients will be filtered by name
     */
    name?: string | Expression<string>;
    /** Sort Order
     */
    'sort-order'?: 'ASCENDING' | 'DESCENDING' | Expression<string>;
  };
};

export type ClockifyV1ClientGetAllOutput = {
  archived?: boolean;
  currencyCode?: string;
  currencyId?: string;
  email?: null;
  id?: string;
  name?: string;
  workspaceId?: string;
};

export type ClockifyV1ClientGetAllNode = {
  type: 'n8n-nodes-base.clockify';
  version: 1;
  config: NodeConfig<ClockifyV1ClientGetAllParams> & { credentials?: Credentials };
  output?: Items<ClockifyV1ClientGetAllOutput>;
};