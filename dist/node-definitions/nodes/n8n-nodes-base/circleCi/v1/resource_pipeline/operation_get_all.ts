/**
 * CircleCI Node - Version 1
 * Discriminator: resource=pipeline, operation=getAll
 */


interface Credentials {
  circleCiApi: CredentialReference;
}

/** Get many pipelines */
export type CircleCiV1PipelineGetAllParams = {
  resource: 'pipeline';
  operation: 'getAll';
/**
 * Source control system
 */
    vcs?: 'bitbucket' | 'github' | Expression<string>;
/**
 * Project slug in the form org-name/repo-name
 */
    projectSlug?: string | Expression<string>;
/**
 * Whether to return all results or only up to a given limit
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false] }
 * @default 100
 */
    limit?: number | Expression<number>;
/**
 * Filters
 * @default {}
 */
    filters?: {
    /** The name of a vcs branch
     */
    branch?: string | Expression<string>;
  };
};

export type CircleCiV1PipelineGetAllNode = {
  type: 'n8n-nodes-base.circleCi';
  version: 1;
  config: NodeConfig<CircleCiV1PipelineGetAllParams> & { credentials?: Credentials };
};