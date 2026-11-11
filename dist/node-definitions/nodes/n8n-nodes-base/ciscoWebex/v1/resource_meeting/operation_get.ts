/**
 * Webex by Cisco Node - Version 1
 * Discriminator: resource=meeting, operation=get
 */


interface Credentials {
  ciscoWebexOAuth2Api: CredentialReference;
}

export type CiscoWebexV1MeetingGetParams = {
  resource: 'meeting';
  operation: 'get';
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
    /** Meeting password. It's required when the meeting is protected by a password and the current user is not privileged to view it if they are not a host, co-host or invitee of the meeting.
     */
    password?: string | Expression<string>;
    /** Whether or not to send emails to host and invitees. It is an optional field and default value is true.
     * @default true
     */
    sendEmail?: boolean | Expression<boolean>;
  };
};

export type CiscoWebexV1MeetingGetNode = {
  type: 'n8n-nodes-base.ciscoWebex';
  version: 1;
  config: NodeConfig<CiscoWebexV1MeetingGetParams> & { credentials?: Credentials };
};