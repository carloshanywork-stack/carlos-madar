/**
 * Webex by Cisco Trigger Node - Version 1
 * Starts the workflow when Cisco Webex events occur.
 */


export interface CiscoWebexTriggerV1Params {
  resource?: 'all' | 'attachmentAction' | 'meeting' | 'membership' | 'message' | 'recording' | 'room';
/**
 * Event
 * @displayOptions.show { resource: ["attachmentAction"] }
 * @required when the displayOptions conditions above match
 */
    event?: 'created' | 'deleted' | 'updated' | 'all' | Expression<string>;
/**
 * By default the response only contain a reference to the data the user inputed. If this option gets activated, it will resolve the data automatically.
 * @displayOptions.show { resource: ["attachmentAction"] }
 * @default true
 */
    resolveData?: boolean | Expression<boolean>;
  filters?: {
    /** Whether to limit to messages which contain file content attachments
     * @displayOptions.show { /resource: ["message"], /event: ["created", "deleted"] }
     * @default false
     */
    hasFiles?: boolean | Expression<boolean>;
    /** Whether to limit to rooms that are locked
     * @displayOptions.show { /resource: ["room"], /event: ["created", "updated"] }
     * @default false
     */
    isLocked?: boolean | Expression<boolean>;
    /** Whether to limit to moderators of a room
     * @displayOptions.show { /resource: ["membership"], /event: ["created", "updated", "deleted"] }
     * @default false
     */
    isModerator?: boolean | Expression<boolean>;
    /** Limit to messages which contain these mentioned people, by person ID; accepts me as a shorthand for your own person ID; separate multiple values with commas
     * @displayOptions.show { /resource: ["message"], /event: ["created", "deleted"] }
     */
    mentionedPeople?: string | Expression<string>;
    /** Limit to a particular message, by ID
     * @displayOptions.show { /resource: ["attachmentAction"], /event: ["created"] }
     */
    messageId?: string | Expression<string>;
    /** Owned By
     * @displayOptions.show { /resource: ["meeting"] }
     */
    ownedBy?: string | Expression<string>;
    /** Limit to a particular person, by email
     * @displayOptions.show { /resource: ["membership"], /event: ["created", "updated", "deleted"] }
     * @displayOptions.show { /resource: ["message"], /event: ["created", "deleted"] }
     */
    personEmail?: string | Expression<string>;
    /** Limit to a particular person, by ID
     * @displayOptions.show { /resource: ["attachmentAction"], /event: ["created"] }
     * @displayOptions.show { /resource: ["membership"], /event: ["created", "updated", "deleted"] }
     * @displayOptions.show { /resource: ["message"], /event: ["created", "deleted"] }
     */
    personId?: string | Expression<string>;
    /** Limit to a particular room, by ID
     * @displayOptions.show { /resource: ["attachmentAction"], /event: ["created"] }
     * @displayOptions.show { /resource: ["membership"], /event: ["created", "updated", "deleted"] }
     * @displayOptions.show { /resource: ["message"], /event: ["created", "updated"] }
     */
    roomId?: string | Expression<string>;
    /** Limit to a particular room type
     * @displayOptions.show { /resource: ["message"], /event: ["created", "deleted"] }
     */
    roomType?: 'direct' | 'group' | Expression<string>;
    /** Limit to a particular room type
     * @displayOptions.show { /resource: ["room"], /event: ["created", "updated"] }
     */
    type?: 'direct' | 'group' | Expression<string>;
  };
}

export interface CiscoWebexTriggerV1Credentials {
  ciscoWebexOAuth2Api: CredentialReference;
}

interface CiscoWebexTriggerV1NodeBase {
  type: 'n8n-nodes-base.ciscoWebexTrigger';
  version: 1;
  isTrigger: true;
}

export type CiscoWebexTriggerV1ParamsNode = CiscoWebexTriggerV1NodeBase & {
  config: NodeConfig<CiscoWebexTriggerV1Params> & { credentials?: CiscoWebexTriggerV1Credentials };
};

export type CiscoWebexTriggerV1Node = CiscoWebexTriggerV1ParamsNode;