/**
 * Clockify Node - Version 1
 * Discriminator: resource=project, operation=create
 */


interface Credentials {
  clockifyApi: CredentialReference;
}

/** Create a client */
export type ClockifyV1ProjectCreateParams = {
  resource: 'project';
  operation: 'create';
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod listWorkspaces
 * @default []
 */
    workspaceId?: string | Expression<string>;
/**
 * Name of project being created
 */
    name: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Billable
     * @default true
     */
    billable?: boolean | Expression<boolean>;
    /** Color
     * @default #0000FF
     */
    color?: string | Expression<string>;
    /** Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod loadClientsForWorkspace
     */
    clientId?: string | Expression<string>;
    /** Estimate
     * @default {}
     */
    estimateUi?: {
        /** Estimate
     */
    estimateValues?: {
      /** Estimate
       * @default 0
       */
      estimate?: number | Expression<number>;
      /** Type
       * @default AUTO
       */
      type?: 'AUTO' | 'MANUAL' | Expression<string>;
    };
  };
    /** Is Public
     * @default true
     */
    isPublic?: boolean | Expression<boolean>;
    /** Note about the project
     */
    note?: string | Expression<string>;
  };
};

export type ClockifyV1ProjectCreateNode = {
  type: 'n8n-nodes-base.clockify';
  version: 1;
  config: NodeConfig<ClockifyV1ProjectCreateParams> & { credentials?: Credentials };
};