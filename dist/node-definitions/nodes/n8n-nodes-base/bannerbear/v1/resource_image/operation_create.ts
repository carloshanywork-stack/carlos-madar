/**
 * Bannerbear Node - Version 1
 * Discriminator: resource=image, operation=create
 */


interface Credentials {
  bannerbearApi: CredentialReference;
}

/** Create an image */
export type BannerbearV1ImageCreateParams = {
  resource: 'image';
  operation: 'create';
/**
 * The template ID you want to use. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getTemplates
 */
    templateId: string | Expression<string>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Metadata that you need to store e.g. ID of a record in your DB
     */
    metadata?: string | Expression<string>;
    /** Whether to wait for the image to be proccesed before returning. If after three tries the images is not ready, an error will be thrown. Number of tries can be increased by setting "Wait Max Tries".
     * @default false
     */
    waitForImage?: boolean | Expression<boolean>;
    /** How often it should check if the image is available before it fails
     * @displayOptions.show { waitForImage: [true] }
     * @default 3
     */
    waitForImageMaxTries?: number | Expression<number>;
    /** A URL to POST the Image object to upon rendering completed
     */
    webhookUrl?: string | Expression<string>;
  };
/**
 * Modifications
 * @default {}
 */
    modificationsUi?: {
        /** Modification
     */
    modificationsValues?: Array<{
      /** The name of the item you want to change. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
       * @loadOptionsMethod getModificationNames
       */
      name?: string | Expression<string>;
      /** Replacement text you want to use
       */
      text?: string | Expression<string>;
      /** Color hex of object
       */
      color?: string | Expression<string>;
      /** Color hex of text background
       */
      background?: string | Expression<string>;
      /** Replacement image URL you want to use (must be publicly viewable)
       */
      imageUrl?: string | Expression<string>;
    }>;
  };
};

export type BannerbearV1ImageCreateOutput = {
  created_at?: string;
  height?: number;
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

export type BannerbearV1ImageCreateNode = {
  type: 'n8n-nodes-base.bannerbear';
  version: 1;
  config: NodeConfig<BannerbearV1ImageCreateParams> & { credentials?: Credentials };
  output?: Items<BannerbearV1ImageCreateOutput>;
};