/**
 * Clockify Node - Version 1
 * Discriminator: resource=project, operation=get
 */


interface Credentials {
  clockifyApi: CredentialReference;
}

/** Get a client */
export type ClockifyV1ProjectGetParams = {
  resource: 'project';
  operation: 'get';
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod listWorkspaces
 * @default []
 */
    workspaceId?: string | Expression<string>;
/**
 * Project ID
 */
    projectId: string | Expression<string>;
};

export type ClockifyV1ProjectGetOutput = {
  archived?: boolean;
  billable?: boolean;
  clientId?: string;
  clientName?: string;
  color?: string;
  costRate?: null;
  duration?: string;
  estimate?: {
    estimate?: string;
    type?: string;
  };
  hourlyRate?: {
    amount?: number;
    currency?: string;
  };
  id?: string;
  memberships?: Array<{
    costRate?: null;
    membershipStatus?: string;
    membershipType?: string;
    targetId?: string;
    userId?: string;
  }>;
  name?: string;
  public?: boolean;
  template?: boolean;
  timeEstimate?: {
    active?: boolean;
    estimate?: string;
    includeNonBillable?: boolean;
    type?: string;
  };
  workspaceId?: string;
};

export type ClockifyV1ProjectGetNode = {
  type: 'n8n-nodes-base.clockify';
  version: 1;
  config: NodeConfig<ClockifyV1ProjectGetParams> & { credentials?: Credentials };
  output?: Items<ClockifyV1ProjectGetOutput>;
};