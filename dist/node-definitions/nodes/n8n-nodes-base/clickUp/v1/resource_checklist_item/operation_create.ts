/**
 * ClickUp Node - Version 1
 * Discriminator: resource=checklistItem, operation=create
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Create a checklist */
export type ClickUpV1ChecklistItemCreateParams = {
  resource: 'checklistItem';
  operation: 'create';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Checklist ID
 */
    checklist: string | Expression<string>;
/**
 * Name
 */
    name: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Assignee ID
     */
    assignee?: string | Expression<string>;
  };
};

export type ClickUpV1ChecklistItemCreateOutput = {
  creator?: number;
  date_created?: string;
  id?: string;
  items?: Array<{
    assignee?: null;
    date_created?: string;
    due_date?: null;
    due_date_time?: boolean;
    group_assignee?: null;
    id?: string;
    parent?: null;
    resolved?: boolean;
    sent_due_date_notif?: null;
    start_date?: null;
    start_date_time?: boolean;
  }>;
  name?: string;
  orderindex?: number;
  resolved?: number;
  task_id?: string;
  unresolved?: number;
};

export type ClickUpV1ChecklistItemCreateNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1ChecklistItemCreateParams> & { credentials?: Credentials };
  output?: Items<ClickUpV1ChecklistItemCreateOutput>;
};