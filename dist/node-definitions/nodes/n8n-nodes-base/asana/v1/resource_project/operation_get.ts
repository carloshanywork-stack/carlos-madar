/**
 * Asana Node - Version 1
 * Discriminator: resource=project, operation=get
 */


interface Credentials {
  asanaApi: CredentialReference;
  asanaOAuth2Api: CredentialReference;
}

/** Get a task */
export type AsanaV1ProjectGetParams = {
  resource: 'project';
  operation: 'get';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Project ID
 */
    id: string | Expression<string>;
};

export type AsanaV1ProjectGetOutput = {
  gid: string;
  archived: boolean;
  completed: boolean;
  completed_at: null;
  created_at: string;
  custom_fields: Array<{
    gid: string;
    enabled: boolean;
    enum_options?: Array<{
      gid: string;
      color: string;
      enabled: boolean;
      name: string;
      resource_type: string;
    }>;
    name: string;
    description: string;
    created_by: {
      gid: string;
      name: string;
      resource_type: string;
    };
    resource_subtype: string;
    resource_type: string;
    is_formula_field: boolean;
    is_value_read_only: boolean;
    type: string;
  }>;
  custom_field_settings?: Array<{
    gid: string;
    custom_field: {
      gid: string;
      enum_options?: Array<{
        gid: string;
        color: string;
        enabled: boolean;
        name: string;
        resource_type: string;
      }>;
      name: string;
      resource_subtype: string;
      resource_type: string;
      type: string;
      privacy_setting?: string;
      default_access_level?: string;
      is_formula_field: boolean;
      precision?: number;
    };
    is_important: boolean;
    parent: {
      gid: string;
      name: string;
      resource_type: string;
    };
    project: {
      gid: string;
      name: string;
      resource_type: string;
    };
    resource_type: string;
  }>;
  default_access_level: string;
  default_view: string;
  followers: Array<{
    gid: string;
    name: string;
    resource_type: string;
  }>;
  members: Array<{
    gid: string;
    name: string;
    resource_type: string;
  }>;
  minimum_access_level_for_customization: string;
  minimum_access_level_for_sharing: string;
  modified_at: string;
  name: string;
  notes: string;
  owner: {
    gid: string;
    name: string;
    resource_type: string;
  };
  permalink_url: string;
  privacy_setting: string;
  public: boolean;
  resource_type: string;
  team: {
    gid: string;
    name: string;
    resource_type: string;
  };
  workspace: {
    gid: string;
    name: string;
    resource_type: string;
  };
};

export type AsanaV1ProjectGetNode = {
  type: 'n8n-nodes-base.asana';
  version: 1;
  config: NodeConfig<AsanaV1ProjectGetParams> & { credentials?: Credentials };
  output?: Items<AsanaV1ProjectGetOutput>;
};