/**
 * Chargebee Node - Version 1
 * Discriminator: resource=invoice, operation=list
 */


interface Credentials {
  chargebeeApi: CredentialReference;
}

/** Return the invoices */
export type ChargebeeV1InvoiceListParams = {
  resource: 'invoice';
  operation: 'list';
/**
 * Max. amount of results to return(&lt; 100).
 * @default 10
 */
    maxResults?: number | Expression<number>;
/**
 * Filter for invoices
 * @default {}
 */
    filters?: {
        /** Invoice Date
     */
    date?: Array<{
      /** Operation to decide where the data should be mapped to
       * @default after
       */
      operation?: 'is' | 'is_not' | 'after' | 'before';
      /** Query date
       */
      value?: string | Expression<string>;
    }>;
        /** Invoice Amount
     */
    total?: Array<{
      /** Operation to decide where the data should be mapped to
       * @default gt
       */
      operation?: 'gte' | 'gt' | 'is' | 'is_not' | 'lte' | 'lt';
      /** Query amount
       * @default 0
       */
      value?: number | Expression<number>;
    }>;
  };
};

export type ChargebeeV1InvoiceListNode = {
  type: 'n8n-nodes-base.chargebee';
  version: 1;
  config: NodeConfig<ChargebeeV1InvoiceListParams> & { credentials?: Credentials };
};