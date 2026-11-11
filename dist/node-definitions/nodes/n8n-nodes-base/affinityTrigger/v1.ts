/**
 * Affinity Trigger Node - Version 1
 * Handle Affinity events via webhooks
 */


export interface AffinityTriggerV1Params {
/**
 * Webhook events that will be enabled for that endpoint
 * @default []
 */
    events: Array<'field_value.created' | 'field_value.deleted' | 'field_value.updated' | 'field.created' | 'field.deleted' | 'field.updated' | 'file.created' | 'file.deleted' | 'list_entry.created' | 'list_entry.deleted' | 'list.created' | 'list.deleted' | 'list.updated' | 'note.created' | 'note.deleted' | 'note.updated' | 'opportunity.created' | 'opportunity.deleted' | 'opportunity.updated' | 'organization.created' | 'organization.deleted' | 'organization.updated' | 'person.created' | 'person.deleted' | 'person.updated'>;
}

export interface AffinityTriggerV1Credentials {
  affinityApi: CredentialReference;
}

interface AffinityTriggerV1NodeBase {
  type: 'n8n-nodes-base.affinityTrigger';
  version: 1;
  isTrigger: true;
}

export type AffinityTriggerV1ParamsNode = AffinityTriggerV1NodeBase & {
  config: NodeConfig<AffinityTriggerV1Params> & { credentials?: AffinityTriggerV1Credentials };
};

export type AffinityTriggerV1Node = AffinityTriggerV1ParamsNode;