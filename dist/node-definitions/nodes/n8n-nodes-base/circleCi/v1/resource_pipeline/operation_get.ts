/**
 * CircleCI Node - Version 1
 * Discriminator: resource=pipeline, operation=get
 */


interface Credentials {
  circleCiApi: CredentialReference;
}

/** Get a pipeline */
export type CircleCiV1PipelineGetParams = {
  resource: 'pipeline';
  operation: 'get';
/**
 * Source control system
 */
    vcs?: 'bitbucket' | 'github' | Expression<string>;
/**
 * Project slug in the form org-name/repo-name
 */
    projectSlug?: string | Expression<string>;
/**
 * The number of the pipeline
 * @default 1
 */
    pipelineNumber?: number | Expression<number>;
};

export type CircleCiV1PipelineGetNode = {
  type: 'n8n-nodes-base.circleCi';
  version: 1;
  config: NodeConfig<CircleCiV1PipelineGetParams> & { credentials?: Credentials };
};