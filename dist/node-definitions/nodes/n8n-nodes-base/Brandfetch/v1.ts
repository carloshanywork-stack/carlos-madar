/**
 * Brandfetch Node - Version 1
 * Consume Brandfetch API
 */


export interface BrandfetchV1Params {
  operation?: 'color' | 'company' | 'font' | 'industry' | 'logo';
/**
 * The domain name of the company
 */
    domain: string | Expression<string>;
/**
 * Name of the binary property to which to write the data of the read file
 * @displayOptions.show { operation: ["logo"] }
 * @default false
 */
    download?: boolean | Expression<boolean>;
/**
 * Image Type
 * @displayOptions.show { operation: ["logo"], download: [true] }
 * @default ["logo","icon"]
 */
    imageTypes?: Array<'icon' | 'logo'>;
/**
 * The image format in which the logo should be returned as
 * @displayOptions.show { operation: ["logo"], download: [true] }
 * @default ["png"]
 */
    imageFormats?: Array<'png' | 'svg'>;
}

export interface BrandfetchV1Credentials {
  brandfetchApi: CredentialReference;
}

interface BrandfetchV1NodeBase {
  type: 'n8n-nodes-base.Brandfetch';
  version: 1;
}

export type BrandfetchV1ParamsNode = BrandfetchV1NodeBase & {
  config: NodeConfig<BrandfetchV1Params> & { credentials?: BrandfetchV1Credentials };
};

export type BrandfetchV1Node = BrandfetchV1ParamsNode;