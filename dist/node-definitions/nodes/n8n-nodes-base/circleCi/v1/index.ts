/**
 * CircleCI Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { CircleCiV1PipelineNode } from './resource_pipeline';

export * from './resource_pipeline';

export type CircleCiV1Node = CircleCiV1PipelineNode;