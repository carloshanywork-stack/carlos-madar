/**
 * ActiveCampaign Trigger Node - Version 1
 * Handle ActiveCampaign events via webhooks
 */


export interface ActiveCampaignTriggerV1Params {
/**
 * Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getEvents
 * @default []
 */
    events?: string[];
  sources?: Array<'public' | 'admin' | 'api' | 'system'>;
}

export interface ActiveCampaignTriggerV1Credentials {
  activeCampaignApi: CredentialReference;
}

interface ActiveCampaignTriggerV1NodeBase {
  type: 'n8n-nodes-base.activeCampaignTrigger';
  version: 1;
  isTrigger: true;
}

export type ActiveCampaignTriggerV1ParamsNode = ActiveCampaignTriggerV1NodeBase & {
  config: NodeConfig<ActiveCampaignTriggerV1Params> & { credentials?: ActiveCampaignTriggerV1Credentials };
};

export type ActiveCampaignTriggerV1Node = ActiveCampaignTriggerV1ParamsNode;