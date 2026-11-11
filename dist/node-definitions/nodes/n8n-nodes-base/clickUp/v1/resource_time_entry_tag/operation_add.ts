/**
 * ClickUp Node - Version 1
 * Discriminator: resource=timeEntryTag, operation=add
 */


interface Credentials {
  clickUpApi: CredentialReference;
  clickUpOAuth2Api: CredentialReference;
}

/** Add a tag to a task */
export type ClickUpV1TimeEntryTagAddParams = {
  resource: 'timeEntryTag';
  operation: 'add';
  authentication?: 'accessToken' | 'oAuth2' | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getTeams
 */
    team: string | Expression<string>;
/**
 * Time Entry IDs
 */
    timeEntryIds: string | Expression<string>;
/**
 * Tags
 * @default {}
 */
    tagsUi?: {
        /** Tag
     */
    tagsValues?: Array<{
      /** Name
       */
      name?: string | Expression<string>;
      /** Background Color
       * @default #ff0000
       */
      tag_bg?: string | Expression<string>;
      /** Foreground Color
       * @default #ff0000
       */
      tag_fg?: string | Expression<string>;
    }>;
  };
};

export type ClickUpV1TimeEntryTagAddNode = {
  type: 'n8n-nodes-base.clickUp';
  version: 1;
  config: NodeConfig<ClickUpV1TimeEntryTagAddParams> & { credentials?: Credentials };
};