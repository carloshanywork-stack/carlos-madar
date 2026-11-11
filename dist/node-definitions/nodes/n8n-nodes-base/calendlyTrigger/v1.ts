/**
 * Calendly Trigger Node - Version 1
 * Starts the workflow when Calendly events occur
 */


export interface CalendlyTriggerV1Params {
  authentication?: 'oAuth2' | 'apiKey' | Expression<string>;
  scope?: 'organization' | 'user' | Expression<string>;
  events: Array<'invitee.created' | 'invitee.canceled'>;
}

export interface CalendlyTriggerV1Credentials {
  calendlyApi: CredentialReference;
  calendlyOAuth2Api: CredentialReference;
}

interface CalendlyTriggerV1NodeBase {
  type: 'n8n-nodes-base.calendlyTrigger';
  version: 1;
  isTrigger: true;
}

export type CalendlyTriggerV1ParamsNode = CalendlyTriggerV1NodeBase & {
  config: NodeConfig<CalendlyTriggerV1Params> & { credentials?: CalendlyTriggerV1Credentials };
};

export type CalendlyTriggerV1Node = CalendlyTriggerV1ParamsNode;