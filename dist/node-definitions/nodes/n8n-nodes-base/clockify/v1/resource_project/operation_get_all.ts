/**
 * Clockify Node - Version 1
 * Discriminator: resource=project, operation=getAll
 */


interface Credentials {
  clockifyApi: CredentialReference;
}

/** Get many clients */
export type ClockifyV1ProjectGetAllParams = {
  resource: 'project';
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
     * @default true
     */
    archived?: boolean | Expression<boolean>;
    /** Billable
     * @default true
     */
    billable?: boolean | Expression<boolean>;
    /** Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod loadClientsForWorkspace
     * @default []
     */
    clients?: string[];
    /** Whether to return only projects having a client
     * @default false
     */
    'contains-client'?: boolean | Expression<boolean>;
    /** If provided, projects will be filtered by whether they have a client
     */
    'client-status'?: 'ACTIVE' | 'ARCHIVED' | Expression<string>;
    /** Whether to return only projects having users
     * @default false
     */
    'contains-user'?: boolean | Expression<boolean>;
    /** Whether to return only projects as templates
     * @default false
     */
    'is-template'?: boolean | Expression<boolean>;
    /** Name
     */
    name?: string | Expression<string>;
    /** Sort Column
     */
    'sort-column'?: 'NAME' | 'CLIENT_NAME' | 'DURATION' | Expression<string>;
    /** Sort Order
     */
    'sort-order'?: 'ASCENDING' | 'DESCENDING' | Expression<string>;
    /** Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod loadUsersForWorkspace
     */
    users?: string | Expression<string>;
    /** If provided, projects will be filtered by whether they have a client
     */
    'user-status'?: 'ACTIVE' | 'ARCHIVED' | Expression<string>;
  };
};

export type ClockifyV1ProjectGetAllOutput = {
  archived?: boolean;
  billable?: boolean;
  clientId?: string;
  clientName?: string;
  color?: string;
  estimate?: {
    estimate?: string;
    type?: string;
  };
  estimateReset?: null;
  hourlyRate?: {
    amount?: number;
    currency?: string;
  };
  id?: string;
  memberships?: Array<{
    costRate?: null;
    hourlyRate?: null;
    membershipStatus?: string;
    membershipType?: string;
    targetId?: string;
    userId?: string;
  }>;
  name?: string;
  note?: string;
  public?: boolean;
  template?: boolean;
  timeEstimate?: {
    active?: boolean;
    estimate?: string;
    includeNonBillable?: boolean;
    resetOption?: null;
    type?: string;
  };
  workspaceId?: string;
};

export type ClockifyV1ProjectGetAllNode = {
  type: 'n8n-nodes-base.clockify';
  version: 1;
  config: NodeConfig<ClockifyV1ProjectGetAllParams> & { credentials?: Credentials };
  output?: Items<ClockifyV1ProjectGetAllOutput>;
};