/**
 * Bannerbear Node - Version 1
 * Discriminator: resource=template, operation=getAll
 */


interface Credentials {
  bannerbearApi: CredentialReference;
}

/** Get many templates */
export type BannerbearV1TemplateGetAllParams = {
  resource: 'template';
  operation: 'getAll';
};

export type BannerbearV1TemplateGetAllNode = {
  type: 'n8n-nodes-base.bannerbear';
  version: 1;
  config: NodeConfig<BannerbearV1TemplateGetAllParams> & { credentials?: Credentials };
};