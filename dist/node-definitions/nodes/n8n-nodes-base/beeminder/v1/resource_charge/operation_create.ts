/**
 * Beeminder Node - Version 1
 * Discriminator: resource=charge, operation=create
 */


interface Credentials {
  beeminderApi: CredentialReference;
  beeminderOAuth2Api: CredentialReference;
}

/** Create a charge */
export type BeeminderV1ChargeCreateParams = {
  resource: 'charge';
  operation: 'create';
  authentication?: 'apiToken' | 'oAuth2' | Expression<string>;
/**
 * Charge amount in USD
 * @default 0
 */
    amount?: number | Expression<number>;
/**
 * Additional Fields
 * @default {}
 */
    additionalFields?: {
    /** Charge explanation
     */
    note?: string | Expression<string>;
    /** Whether to test charge creation without actually charging
     * @default false
     */
    dryrun?: boolean | Expression<boolean>;
  };
};

export type BeeminderV1ChargeCreateNode = {
  type: 'n8n-nodes-base.beeminder';
  version: 1;
  config: NodeConfig<BeeminderV1ChargeCreateParams> & { credentials?: Credentials };
};