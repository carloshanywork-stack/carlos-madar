/**
 * Webex by Cisco Node - Version 1
 * Discriminator: resource=meeting, operation=delete
 */


interface Credentials {
  ciscoWebexOAuth2Api: CredentialReference;
}

export type CiscoWebexV1MeetingDeleteParams = {
  resource: 'meeting';
  operation: 'delete';
/**
 * ID of the meeting
 */
    meetingId: string | Expression<string>;
/**
 * Options
 * @default {}
 */
    options?: {
    /** Email address for the meeting host. This parameter is only used if the user or application calling the API has the admin-level scopes.
     */
    hostEmail?: string | Expression<string>;
    /** Whether or not to send emails to host and invitees
     * @default true
     */
    sendEmail?: boolean | Expression<boolean>;
  };
};

export type CiscoWebexV1MeetingDeleteNode = {
  type: 'n8n-nodes-base.ciscoWebex';
  version: 1;
  config: NodeConfig<CiscoWebexV1MeetingDeleteParams> & { credentials?: Credentials };
};