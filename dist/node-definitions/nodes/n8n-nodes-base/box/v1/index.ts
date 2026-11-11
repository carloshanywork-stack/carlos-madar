/**
 * Box Node - Version 1
 * Re-exports all discriminator combinations.
 */

import type { BoxV1FileNode } from './resource_file';
import type { BoxV1FolderNode } from './resource_folder';

export * from './resource_file';
export * from './resource_folder';

export type BoxV1Node =
  | BoxV1FileNode
  | BoxV1FolderNode
  ;