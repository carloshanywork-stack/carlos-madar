/**
 * ClickUp Node - Version 1
 * Discriminator: resource=list, operation=customFields
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Retrieve list's custom fields */
export type ClickUpV1ListCustomFieldsParams = {
  resource: 'list';
  operation: 'customFields';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getTeams
 */
    team: string | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getSpaces
 */
    space: string | Expression<string>;
/**
 * Folderless List
 * @default false
 */
    folderless?: boolean | Expression<boolean>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getFolders
 * @displayOptions.show { folderless: [false] }
 * @required when the displayOptions conditions above match
 */
    folder?: string | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getFolderlessLists
 * @displayOptions.show { folderless: [true] }
 * @required when the displayOptions conditions above match
 */
    list?: string | Expression<string>;
};

export type ClickUpV1ListCustomFieldsOutput = {
  date_created?: string;
  hide_from_guests?: boolean;
  id?: string;
  name?: string;
  required?: boolean;
  type?: string;
  type_config?: {
    options?: Array<{
      id?: string;
      name?: string;
      orderindex?: number;
    }>;
    sorting?: string;
  };
};

export type ClickUpV1ListCustomFieldsNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1ListCustomFieldsParams> & { credentials?: Credentials };
  output?: Items<ClickUpV1ListCustomFieldsOutput>;
};