/**
 * Cal.com Trigger Node - Version 1
 * Handle Cal.com events via webhooks
 */


export interface CalTriggerV1Params {
  events: Array<'BOOKING_CANCELLED' | 'BOOKING_CREATED' | 'BOOKING_RESCHEDULED' | 'MEETING_ENDED'>;
/**
 * API Version
 * @default 1
 */
    version?: 1 | 2 | Expression<number>;
  options?: {
    /** The ID of the App to monitor
     */
    appId?: string | Expression<string>;
    /** The EventType to monitor. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getEventTypes
     */
    eventTypeId?: string | Expression<string>;
    /** Template to customize the webhook payload
     */
    payloadTemplate?: string | Expression<string>;
  };
}

export interface CalTriggerV1Credentials {
  calApi: CredentialReference;
}

interface CalTriggerV1NodeBase {
  type: 'n8n-nodes-base.calTrigger';
  version: 1;
  isTrigger: true;
}

export type CalTriggerV1ParamsNode = CalTriggerV1NodeBase & {
  config: NodeConfig<CalTriggerV1Params> & { credentials?: CalTriggerV1Credentials };
};

export type CalTriggerV1Node = CalTriggerV1ParamsNode;