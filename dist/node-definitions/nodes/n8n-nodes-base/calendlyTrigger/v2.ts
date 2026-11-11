/**
 * Calendly Trigger Node - Version 2
 * Starts the workflow when Calendly events occur
 */


export interface CalendlyTriggerV2Params {
  scope?: 'organization' | 'user' | Expression<string>;
  events: Array<'invitee.created' | 'invitee.canceled'>;
}

export interface CalendlyTriggerV2Credentials {
  calendlyOAuth2Api: CredentialReference;
}

interface CalendlyTriggerV2NodeBase {
  type: 'n8n-nodes-base.calendlyTrigger';
  version: 2;
  isTrigger: true;
}

export type CalendlyTriggerV2ParamsNode = CalendlyTriggerV2NodeBase & {
  config: NodeConfig<CalendlyTriggerV2Params> & { credentials?: CalendlyTriggerV2Credentials };
};

export type CalendlyTriggerV2Node = CalendlyTriggerV2ParamsNode;