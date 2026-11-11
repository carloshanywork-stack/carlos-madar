/**
 * Bannerbear Node - Version 1
 * Discriminator: resource=template, operation=get
 */


interface Credentials {
  bannerbearApi: CredentialReference;
}

/** Get an image */
export type BannerbearV1TemplateGetParams = {
  resource: 'template';
  operation: 'get';
/**
 * Unique identifier for the template
 */
    templateId: string | Expression<string>;
};

export type BannerbearV1TemplateGetOutput = {
  available_modifications?: Array<{
    background?: null;
    color?: null;
    image_url?: null;
    name?: string;
    text?: null;
  }>;
  created_at?: string;
  height?: number;
  metadata?: null;
  name?: string;
  preview_url?: string;
  self?: string;
  uid?: string;
  updated_at?: string;
  width?: number;
};

export type BannerbearV1TemplateGetNode = {
  type: 'n8n-nodes-base.bannerbear';
  version: 1;
  config: NodeConfig<BannerbearV1TemplateGetParams> & { credentials?: Credentials };
  output?: Items<BannerbearV1TemplateGetOutput>;
};