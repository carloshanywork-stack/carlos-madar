/**
 * ClickUp Node - Version 1
 * Discriminator: resource=checklist, operation=create
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Create a checklist */
export type ClickUpV1ChecklistCreateParams = {
  resource: 'checklist';
  operation: 'create';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Task ID
 */
    task: string | Expression<string>;
/**
 * Name
 */
    name: string | Expression<string>;
};

export type ClickUpV1ChecklistCreateOutput = {
  id?: string;
  name?: string;
  orderindex?: number;
  resolved?: number;
  task_id?: string;
  unresolved?: number;
};

export type ClickUpV1ChecklistCreateNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1ChecklistCreateParams> & { credentials?: Credentials };
  output?: Items<ClickUpV1ChecklistCreateOutput>;
};