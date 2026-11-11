/**
 * Bannerbear Node - Version 1
 * Discriminator: resource=image, operation=get
 */


interface Credentials {
  bannerbearApi: CredentialReference;
}

/** Get an image */
export type BannerbearV1ImageGetParams = {
  resource: 'image';
  operation: 'get';
/**
 * Unique identifier for the image
 */
    imageId: string | Expression<string>;
};

export type BannerbearV1ImageGetOutput = {
  created_at?: string;
  height?: number;
  metadata?: null;
  modifications?: Array<{
    name?: string;
  }>;
  pdf_url?: null;
  pdf_url_compressed?: null;
  render_pdf?: boolean;
  self?: string;
  status?: string;
  template?: string;
  template_name?: string;
  template_version?: null;
  transparent?: boolean;
  uid?: string;
  webhook_response_code?: null;
  webhook_url?: null;
  width?: number;
};

export type BannerbearV1ImageGetNode = {
  type: 'n8n-nodes-base.bannerbear';
  version: 1;
  config: NodeConfig<BannerbearV1ImageGetParams> & { credentials?: Credentials };
  output?: Items<BannerbearV1ImageGetOutput>;
};