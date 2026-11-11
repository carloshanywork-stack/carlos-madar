/**
 * Asana Node - Version 1
 * Discriminator: resource=task, operation=get
 */


interface Credentials {
  asanaApi: CredentialReference;
  asanaOAuth2Api: CredentialReference;
}

/** Get a task */
export type AsanaV1TaskGetParams = {
  resource: 'task';
  operation: 'get';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * The ID of the task to get the data of
 */
    id: string | Expression<string>;
};

export type AsanaV1TaskGetOutput = {
  assignee?: {
    gid?: string;
    name?: string;
    resource_type?: string;
  };
  assignee_status?: string;
  completed?: boolean;
  created_at?: string;
  custom_fields?: Array<{
    description?: string;
    enabled?: boolean;
    enum_options?: Array<{
      color?: string;
      enabled?: boolean;
      gid?: string;
      name?: string;
      resource_type?: string;
    }>;
    gid?: string;
    is_formula_field?: boolean;
    is_value_read_only?: boolean;
    multi_enum_values?: Array<{
      color?: string;
      enabled?: boolean;
      gid?: string;
      name?: string;
      resource_type?: string;
    }>;
    name?: string;
    precision?: number;
    resource_subtype?: string;
    resource_type?: string;
    type?: string;
  }>;
  due_at?: null;
  followers?: Array<{
    gid?: string;
    name?: string;
    resource_type?: string;
  }>;
  gid?: string;
  hearted?: boolean;
  liked?: boolean;
  memberships?: Array<{
    project?: {
      gid?: string;
      name?: string;
      resource_type?: string;
    };
    section?: {
      gid?: string;
      name?: string;
      resource_type?: string;
    };
  }>;
  modified_at?: string;
  name?: string;
  notes?: string;
  num_hearts?: number;
  num_likes?: number;
  permalink_url?: string;
  projects?: Array<{
    gid?: string;
    name?: string;
    resource_type?: string;
  }>;
  resource_subtype?: string;
  resource_type?: string;
  start_at?: null;
  tags?: Array<{
    gid?: string;
    name?: string;
    resource_type?: string;
  }>;
  workspace?: {
    gid?: string;
    name?: string;
    resource_type?: string;
  };
};

export type AsanaV1TaskGetNode = {
  type: 'n8n-nodes-base.asana';
  version: 1;
  config: NodeConfig<AsanaV1TaskGetParams> & { credentials?: Credentials };
  output?: Items<AsanaV1TaskGetOutput>;
};