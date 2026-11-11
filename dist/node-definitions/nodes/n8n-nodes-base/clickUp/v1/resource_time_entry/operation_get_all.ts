/**
 * ClickUp Node - Version 1
 * Discriminator: resource=timeEntry, operation=getAll
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Get many comments */
export type ClickUpV1TimeEntryGetAllParams = {
  resource: 'timeEntry';
  operation: 'getAll';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getTeams
 */
    team: string | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 5
 */
    limit?: number | Expression<number>;
/**
 * Filters
 * @default {}
 */
    filters?: {
    /** End Date
     */
    end_date?: string | Expression<string>;
    /** Start Date
     */
    start_date?: string | Expression<string>;
  };
};

export type ClickUpV1TimeEntryGetAllOutput = {
  approval_id?: null;
  at?: string;
  billable?: boolean;
  description?: string;
  duration?: string;
  end?: string;
  id?: string;
  is_locked?: boolean;
  source?: string;
  start?: string;
  tags?: Array<{
    creator?: number;
    name?: string;
    tag_bg?: string;
    tag_fg?: string;
  }>;
  task?: {
    id?: string;
    name?: string;
    status?: {
      color?: string;
      orderindex?: number;
      status?: string;
      type?: string;
    };
  };
  task_location?: {
    folder_id?: string;
    list_id?: string;
    space_id?: string;
  };
  task_url?: string;
  user?: {
    color?: string;
    email?: string;
    id?: number;
    initials?: string;
    username?: string;
  };
  wid?: string;
};

export type ClickUpV1TimeEntryGetAllNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1TimeEntryGetAllParams> & { credentials?: Credentials };
  output?: Items<ClickUpV1TimeEntryGetAllOutput>;
};