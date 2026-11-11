/**
 * Autopilot Trigger Node - Version 1
 * Handle Autopilot events via webhooks
 */


export interface AutopilotTriggerV1Params {
  event: 'contactAdded' | 'contactAddedToList' | 'contactEnteredSegment' | 'contactLeftSegment' | 'contactRemovedFromList' | 'contactUnsubscribed' | 'contactUpdated' | Expression<string>;
}

export interface AutopilotTriggerV1Credentials {
  autopilotApi: CredentialReference;
}

interface AutopilotTriggerV1NodeBase {
  type: 'n8n-nodes-base.autopilotTrigger';
  version: 1;
  isTrigger: true;
}

export type AutopilotTriggerV1ParamsNode = AutopilotTriggerV1NodeBase & {
  config: NodeConfig<AutopilotTriggerV1Params> & { credentials?: AutopilotTriggerV1Credentials };
};

export type AutopilotTriggerV1Node = AutopilotTriggerV1ParamsNode;