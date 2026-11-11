/**
 * Action Network Node - Version 1
 * Discriminator: resource=attendance, operation=create
 */


interface Credentials {
  actionNetworkApi: CredentialReference;
}

export type ActionNetworkV1AttendanceCreateParams = {
  resource: 'attendance';
  operation: 'create';
/**
 * ID of the person to create an attendance for
 */
    personId: string | Expression<string>;
/**
 * ID of the event to create an attendance for
 */
    eventId: string | Expression<string>;
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @default true
 */
    simple?: boolean | Expression<boolean>;
};

export type ActionNetworkV1AttendanceCreateNode = {
  type: 'n8n-nodes-base.actionNetwork';
  version: 1;
  config: NodeConfig<ActionNetworkV1AttendanceCreateParams> & { credentials?: Credentials };
};