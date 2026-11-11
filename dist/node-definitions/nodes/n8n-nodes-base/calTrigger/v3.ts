/**
 * Cal.com Trigger Node - Version 3
 * Handle Cal.com events via webhooks
 */


export interface CalTriggerV3Params {
  events: Array<'BOOKING_CANCELLED' | 'BOOKING_CREATED' | 'BOOKING_RESCHEDULED' | 'MEETING_ENDED'>;
  options?: {
    /** The EventType to monitor. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
     * @loadOptionsMethod getEventTypes
     */
    eventTypeId?: string | Expression<string>;
    /** Template to customize the webhook payload
     */
    payloadTemplate?: string | Expression<string>;
  };
}

export interface CalTriggerV3Credentials {
  calApi: CredentialReference;
}

interface CalTriggerV3NodeBase {
  type: 'n8n-nodes-base.calTrigger';
  version: 3;
  isTrigger: true;
}

export type CalTriggerV3ParamsNode = CalTriggerV3NodeBase & {
  config: NodeConfig<CalTriggerV3Params> & { credentials?: CalTriggerV3Credentials };
};

export type CalTriggerV3Node = CalTriggerV3ParamsNode;