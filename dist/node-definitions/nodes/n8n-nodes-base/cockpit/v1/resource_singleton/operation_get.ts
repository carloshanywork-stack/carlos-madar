/**
 * Cockpit Node - Version 1
 * Discriminator: resource=singleton, operation=get
 */


interface Credentials {
  cockpitApi: CredentialReference;
}

/** Get a singleton */
export type CockpitV1SingletonGetParams = {
  resource: 'singleton';
  operation: 'get';
/**
 * Name of the singleton to operate on. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
 * @loadOptionsMethod getSingletons
 */
    singleton: string | Expression<string>;
};

export type CockpitV1SingletonGetNode = {
  type: 'n8n-nodes-base.cockpit';
  version: 1;
  config: NodeConfig<CockpitV1SingletonGetParams> & { credentials?: Credentials };
};