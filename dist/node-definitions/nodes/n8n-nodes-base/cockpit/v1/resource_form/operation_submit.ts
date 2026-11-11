/**
 * Cockpit Node - Version 1
 * Discriminator: resource=form, operation=submit
 */


interface Credentials {
  cockpitApi: CredentialReference;
}

/** Store data from a form submission */
export type CockpitV1FormSubmitParams = {
  resource: 'form';
  operation: 'submit';
/**
 * Name of the form to operate on
 */
    form: string | Expression<string>;
/**
 * Whether form fields should be set via the value-key pair UI or JSON
 * @default false
 */
    jsonDataFields?: boolean | Expression<boolean>;
/**
 * Form data to send as JSON
 * @displayOptions.show { jsonDataFields: [true] }
 */
    dataFieldsJson?: IDataObject | string | Expression<string>;
/**
 * Form data to send
 * @displayOptions.show { jsonDataFields: [false] }
 * @default {}
 */
    dataFieldsUi?: {
        /** Field
     */
    field?: Array<{
      /** Name of the field
       */
      name?: string | Expression<string>;
      /** Value of the field
       */
      value?: string | Expression<string>;
    }>;
  };
};

export type CockpitV1FormSubmitNode = {
  type: 'n8n-nodes-base.cockpit';
  version: 1;
  config: NodeConfig<CockpitV1FormSubmitParams> & { credentials?: Credentials };
};