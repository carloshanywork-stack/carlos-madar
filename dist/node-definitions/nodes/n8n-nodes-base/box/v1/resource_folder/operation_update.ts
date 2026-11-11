/**
 * Box Node - Version 1
 * Discriminator: resource=folder, operation=update
 */


interface Credentials {
  boxOAuth2Api: CredentialReference;
}

/** Update folder */
export type BoxV1FolderUpdateParams = {
  resource: 'folder';
  operation: 'update';
/**
 * Folder ID
 */
    folderId: string | Expression<string>;
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
    /** Whether users who are not the owner of the folder can invite new collaborators to the folder
     * @default false
     */
    can_non_owners_invite?: boolean | Expression<boolean>;
    /** Whether to restrict collaborators who are not the owner of this folder from viewing other collaborations on this folder
     * @default false
     */
    can_non_owners_view_collaborators?: boolean | Expression<boolean>;
    /** The optional description of this folder
     */
    description?: string | Expression<string>;
    /** A comma-separated list of attributes to include in the response. This can be used to request fields that are not normally returned in a standard response.
     */
    fields?: string | Expression<string>;
    /** Whether new invites to this folder are restricted to users within the enterprise. This does not affect existing collaborations.
     * @default false
     */
    is_collaboration_restricted_to_enterprise?: boolean | Expression<boolean>;
    /** The optional new name for this folder
     */
    name?: string | Expression<string>;
    /** The parent folder for this folder. Use this to move the folder or to restore it out of the trash.
     */
    parentId?: string | Expression<string>;
    /** Share link information
     * @default {}
     */
    shared_link?: {
    /** Access
     * @default open
     */
    access?: 'collaborators' | 'company' | 'open' | Expression<string>;
    /** The password required to access the shared link. Set the password to null to remove it.
     * @displayOptions.show { access: ["open"] }
     */
    password?: string | Expression<string>;
    /** Permissions
     * @default {}
     */
    permissions?: {
    /** Whether the shared link allows for downloading of files
     * @default false
     */
    can_download?: boolean | Expression<boolean>;
    /** The timestamp at which this shared link will expire
     */
    unshared_at?: string | Expression<string>;
    /** Defines a custom vanity name to use in the shared link URL, for example https://app.box.com/v/my-shared-link
     */
    vanity_name?: string | Expression<string>;
  };
    /** The tags for this item. These tags are shown in the Box web app and mobile apps next to an item.
     */
    tags?: string | Expression<string>;
  };
  };
};

export type BoxV1FolderUpdateNode = {
  type: 'n8n-nodes-base.box';
  version: 1;
  config: NodeConfig<BoxV1FolderUpdateParams> & { credentials?: Credentials };
};