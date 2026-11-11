/**
 * Action Network Node - Version 1
 * Discriminator: resource=personTag, operation=remove
 */


interface Credentials {
  actionNetworkApi: CredentialReference;
}

export type ActionNetworkV1PersonTagRemoveParams = {
  resource: 'personTag';
  operation: 'remove';
/**
 * ID of the tag whose tagging to delete. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getTags
 * @default []
 */
    tagId?: string | Expression<string>;
/**
 * ID of the tagging to remove. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getTaggings
 * @default []
 */
    taggingId?: string | Expression<string>;
};

export type ActionNetworkV1PersonTagRemoveNode = {
  type: 'n8n-nodes-base.actionNetwork';
  version: 1;
  config: NodeConfig<ActionNetworkV1PersonTagRemoveParams> & { credentials?: Credentials };
};