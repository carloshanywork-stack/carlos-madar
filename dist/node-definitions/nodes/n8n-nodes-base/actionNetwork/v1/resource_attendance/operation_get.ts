/**
 * Action Network Node - Version 1
 * Discriminator: resource=attendance, operation=get
 */


interface Credentials {
  actionNetworkApi: CredentialReference;
}

export type ActionNetworkV1AttendanceGetParams = {
  resource: 'attendance';
  operation: 'get';
/**
 * ID of the event whose attendance to retrieve
 */
    eventId: string | Expression<string>;
/**
 * ID of the attendance to retrieve
 */
    attendanceId: string | Expression<string>;
/**
 * Whether to return a simplified version of the response instead of the raw data
 * @default true
 */
    simple?: boolean | Expression<boolean>;
};

export type ActionNetworkV1AttendanceGetNode = {
  type: 'n8n-nodes-base.actionNetwork';
  version: 1;
  config: NodeConfig<ActionNetworkV1AttendanceGetParams> & { credentials?: Credentials };
};