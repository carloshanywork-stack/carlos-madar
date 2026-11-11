/**
 * Webex by Cisco Node - Version 1
 * Discriminator: resource=meeting, operation=getAll
 */


interface Credentials {
  ciscoWebexOAuth2Api: CredentialReference;
}

export type CiscoWebexV1MeetingGetAllParams = {
  resource: 'meeting';
  operation: 'getAll';
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 50
 */
    limit?: number | Expression<number>;
/**
 * Filters
 * @default {}
 */
    filters?: {
    /** Start date and time (inclusive) for the meeting. Acceptable &lt;a href="https://datatracker.ietf.org/doc/html/rfc2445"&gt; format&lt;/a&gt;.
     */
    from?: string | Expression<string>;
    /** Email address for the meeting host
     */
    hostEmail?: string | Expression<string>;
    /** External tag created by another application, e.g. Zendesk ticket ID or Jira ID
     */
    integrationTag?: string | Expression<string>;
    /** Whether to return just the current meeting or all meetings
     * @default true
     */
    current?: boolean | Expression<boolean>;
    /** Meeting number for the meeting objects being requested
     */
    meetingNumber?: string | Expression<string>;
    /** Meeting Type
     * @default meetingSeries
     */
    meetingType?: 'meetingSeries' | 'scheduledMeeting' | 'meeting' | Expression<string>;
    /** Email of a person that must be a meeting participant
     */
    participantEmail?: string | Expression<string>;
    /** URL of the Webex site which the API lists meetings from. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getSites
     */
    siteUrl?: string | Expression<string>;
    /** Meeting state for the meeting objects being requested
     */
    state?: 'active' | 'ended' | 'expired' | 'inProgress' | 'lobby' | 'missed' | 'ready' | 'scheduled' | Expression<string>;
    /** End date and time (inclusive) for the meeting. Acceptable &lt;a href="https://datatracker.ietf.org/doc/html/rfc2445"&gt; format&lt;/a&gt;.
     */
    to?: string | Expression<string>;
    /** URL encoded link to information page for the meeting objects being requested
     */
    webLink?: string | Expression<string>;
  };
};

export type CiscoWebexV1MeetingGetAllNode = {
  type: 'n8n-nodes-base.ciscoWebex';
  version: 1;
  config: NodeConfig<CiscoWebexV1MeetingGetAllParams> & { credentials?: Credentials };
};