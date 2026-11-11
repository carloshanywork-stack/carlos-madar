/**
 * Webex by Cisco Node - Version 1
 * Discriminator: resource=meeting, operation=create
 */


interface Credentials {
  ciscoWebexOAuth2Api: CredentialReference;
}

export type CiscoWebexV1MeetingCreateParams = {
  resource: 'meeting';
  operation: 'create';
/**
 * Meeting title. The title can be a maximum of 128 characters long.
 */
    title: string | Expression<string>;
/**
 * Date and time for the start of the meeting. Acceptable &lt;a href="https://datatracker.ietf.org/doc/html/rfc2445"&gt; format&lt;/a&gt;.
 */
    start: string | Expression<string>;
/**
 * Date and time for the end of the meeting. Acceptable &lt;a href="https://datatracker.ietf.org/doc/html/rfc2445"&gt; format&lt;/a&gt;.
 */
    end: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Meeting agenda. The agenda can be a maximum of 1300 characters long.
     */
    agenda?: string | Expression<string>;
    /** Whether or not to allow any attendee with a host account on the target site to become a co-host when joining the meeting
     * @default false
     */
    allowAnyUserToBeCoHost?: boolean | Expression<boolean>;
    /** Whether or not to allow authenticated video devices in the meeting's organization to start or join the meeting without a prompt
     * @default false
     */
    allowAuthenticatedDevices?: boolean | Expression<boolean>;
    /** Whether or not to allow the first attendee of the meeting with a host account on the target site to become a co-host
     * @default false
     */
    allowFirstUserToBeCoHost?: boolean | Expression<boolean>;
    /** Whether or not meeting registration request is accepted automatically
     * @default false
     */
    autoAcceptRequest?: boolean | Expression<boolean>;
    /** Whether or not to allow any attendee to connect audio in the meeting before the host joins the meeting
     * @default false
     */
    enableConnectAudioBeforeHost?: boolean | Expression<boolean>;
    /** Whether or not meeting is recorded automatically
     * @default false
     */
    enabledAutoRecordMeeting?: boolean | Expression<boolean>;
    /** Whether or not to allow any attendee to join the meeting before the host joins the meeting
     * @default false
     */
    enabledJoinBeforeHost?: boolean | Expression<boolean>;
    /** Whether or not to exclude password from the meeting email invitation
     * @default false
     */
    excludePassword?: boolean | Expression<boolean>;
    /** Email address for the meeting host. Can only be set if you're an admin.
     */
    hostEmail?: string | Expression<string>;
    /** External keys created by an integration application in its own domain. They could be Zendesk ticket IDs, Jira IDs, Salesforce Opportunity IDs, etc.
     */
    integrationTags?: string | Expression<string>;
    /** Invitees
     * @default {}
     */
    inviteesUi?: {
        /** Invitee
     */
    inviteeValues?: Array<{
      /** Email address of meeting invitee
       */
      email?: string | Expression<string>;
      /** Display name of meeting invitee
       */
      displayName?: string | Expression<string>;
      /** Whether or not invitee is allowed to be a co-host for the meeting
       * @default false
       */
      coHost?: boolean | Expression<boolean>;
    }>;
  };
    /** The number of minutes an attendee can join the meeting before the meeting start time and the host joins
     * @default 0
     */
    joinBeforeHostMinutes?: 0 | 5 | 10 | 15 | Expression<number>;
    /** Whether or not to allow the meeting to be listed on the public calendar
     * @default false
     */
    publicMeeting?: boolean | Expression<boolean>;
    /** Rule for how the meeting should recur. Acceptable &lt;a href="https://datatracker.ietf.org/doc/html/rfc2445"&gt; format&lt;/a&gt;.
     */
    recurrence?: string | Expression<string>;
    /** Data required for meeting registration
     * @default []
     */
    requireRegistrationInfo?: Array<'requireFirstName' | 'requireLastName' | 'requireEmail' | 'requireJobTitle' | 'requireCompanyName' | 'requireAddress1' | 'requireAddress2' | 'requireCity' | 'requireState' | 'requireZipCode' | 'requireCountryRegion' | 'requireWorkPhone' | 'requireFax'>;
    /** The number of minutes before the meeting begins, for sending an email reminder to the host
     * @default 1
     */
    reminderTime?: number | Expression<number>;
    /** Whether or not to send emails to host and invitees
     * @default true
     */
    sendEmail?: boolean | Expression<boolean>;
    /** URL of the Webex site which the meeting is created on. If not specified, the meeting is created on user's preferred site. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getSites
     */
    siteUrl?: string | Expression<string>;
  };
};

export type CiscoWebexV1MeetingCreateNode = {
  type: 'n8n-nodes-base.ciscoWebex';
  version: 1;
  config: NodeConfig<CiscoWebexV1MeetingCreateParams> & { credentials?: Credentials };
};