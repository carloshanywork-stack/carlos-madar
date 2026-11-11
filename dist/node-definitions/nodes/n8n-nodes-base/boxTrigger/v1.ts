/**
 * Box Trigger Node - Version 1
 * Starts the workflow when Box events occur
 */


export interface BoxTriggerV1Params {
/**
 * The events to listen to
 * @default []
 */
    events: Array<'COLLABORATION.ACCEPTED' | 'COLLABORATION.CREATED' | 'COLLABORATION.REJECTED' | 'COLLABORATION.REMOVED' | 'COLLABORATION.UPDATED' | 'COMMENT.CREATED' | 'COMMENT.DELETED' | 'COMMENT.UPDATED' | 'FILE.COPIED' | 'FILE.DELETED' | 'FILE.DOWNLOADED' | 'FILE.LOCKED' | 'FILE.MOVED' | 'FILE.PREVIEWED' | 'FILE.RENAMED' | 'FILE.RESTORED' | 'FILE.TRASHED' | 'FILE.UNLOCKED' | 'FILE.UPLOADED' | 'FOLDER.COPIED' | 'FOLDER.CREATED' | 'FOLDER.DELETED' | 'FOLDER.DOWNLOADED' | 'FOLDER.MOVED' | 'FOLDER.RENAMED' | 'FOLDER.RESTORED' | 'FOLDER.TRASHED' | 'METADATA_INSTANCE.CREATED' | 'METADATA_INSTANCE.DELETED' | 'METADATA_INSTANCE.UPDATED' | 'SHARED_LINK.CREATED' | 'SHARED_LINK.DELETED' | 'SHARED_LINK.UPDATED' | 'TASK_ASSIGNMENT.CREATED' | 'TASK_ASSIGNMENT.UPDATED' | 'WEBHOOK.DELETED'>;
/**
 * The type of item to trigger a webhook
 */
    targetType?: 'file' | 'folder' | Expression<string>;
/**
 * The ID of the item to trigger a webhook
 */
    targetId?: string | Expression<string>;
}

export interface BoxTriggerV1Credentials {
  boxOAuth2Api: CredentialReference;
}

interface BoxTriggerV1NodeBase {
  type: 'n8n-nodes-base.boxTrigger';
  version: 1;
  isTrigger: true;
}

export type BoxTriggerV1ParamsNode = BoxTriggerV1NodeBase & {
  config: NodeConfig<BoxTriggerV1Params> & { credentials?: BoxTriggerV1Credentials };
};

export type BoxTriggerV1Node = BoxTriggerV1ParamsNode;