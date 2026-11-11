/**
 * APITemplate.io Node - Version 1
 * Discriminator: resource=image, operation=create
 */


interface Credentials {
  apiTemplateIoApi: CredentialReference;
}

export type ApiTemplateIoV1ImageCreateParams = {
  resource: 'image';
  operation: 'create';
/**
 * ID of the image template to use. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getImageTemplates
 */
    imageTemplateId: string | Expression<string>;
/**
 * JSON Parameters
 * @default false
 */
    jsonParameters?: boolean | Expression<boolean>;
/**
 * Name of the binary property to which to write the data of the read file
 * @default false
 */
    download?: boolean | Expression<boolean>;
/**
 * Put Output File in Field
 * @hint The name of the output binary field to put the file in
 * @displayOptions.show { download: [true] }
 * @default data
 */
    binaryProperty?: string | Expression<string>;
/**
 * Overrides (JSON)
 * @displayOptions.show { jsonParameters: [true] }
 */
    overridesJson?: IDataObject | string | Expression<string>;
/**
 * Overrides
 * @displayOptions.show { jsonParameters: [false] }
 * @default {}
 */
    overridesUi?: {
        /** Override
     */
    overrideValues?: Array<{
      /** Properties
       * @default {}
       */
      propertiesUi?: {
        /** Property
     */
    propertyValues?: Array<{
      /** Name of the property
       */
      key?: string | Expression<string>;
      /** Value to the property
       */
      value?: string | Expression<string>;
    }>;
  };
    }>;
  };
/**
 * Options
 * @displayOptions.show { download: [true] }
 * @default {}
 */
    options?: {
    /** The name of the downloaded image/pdf. It has to include the extension. For example: report.pdf
     */
    fileName?: string | Expression<string>;
  };
};

export type ApiTemplateIoV1ImageCreateOutput = {
  download_url?: string;
  download_url_png?: string;
  status?: string;
  template_id?: string;
  transaction_ref?: string;
};

export type ApiTemplateIoV1ImageCreateNode = {
  type: 'n8n-nodes-base.apiTemplateIo';
  version: 1;
  config: NodeConfig<ApiTemplateIoV1ImageCreateParams> & { credentials?: Credentials };
  output?: Items<ApiTemplateIoV1ImageCreateOutput>;
};