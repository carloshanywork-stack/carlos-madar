export declare const AWS_CHINA_DOMAIN = "amazonaws.com.cn";
export declare const AWS_GLOBAL_DOMAIN = "amazonaws.com";
type RegionData = {
    name: string;
    displayName: string;
    location: string;
    domain?: string;
};
export declare const regions: RegionData[];
export type AWSRegion = (typeof regions)[number]['name'];
/**
 * Gets the AWS domain for a specific region.
 *
 * @param region - The AWS region to get the domain for
 * @returns The AWS domain for the region, or the global domain if region not found
 */
export declare function getAwsDomain(region: AWSRegion): string;
export {};
//# sourceMappingURL=regions.d.ts.map