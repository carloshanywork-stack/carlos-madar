/**
 * Clockify Node - Version 1
 * Discriminator: resource=project, operation=update
 */


interface Credentials {
  clockifyApi: CredentialReference;
}

/** Update a client */
export type ClockifyV1ProjectUpdateParams = {
  resource: 'project';
  operation: 'update';
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
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
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
     * @default false
     */
    isPublic?: boolean | Expression<boolean>;
    /** Name
     */
    name?: string | Expression<string>;
    /** Note about the project
     */
    note?: string | Expression<string>;
  };
};

export type ClockifyV1ProjectUpdateNode = {
  type: 'n8n-nodes-base.clockify';
  version: 1;
  config: NodeConfig<ClockifyV1ProjectUpdateParams> & { credentials?: Credentials };
};