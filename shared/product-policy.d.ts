export const productDomains:string[];
export const imageDomains:string[];
export const autoImportPlatforms:string[];
export const manualOnlyPlatforms:string[];
export function supportsAutoImport(platform:string):boolean;
export function supportedProductUrl(value:string):boolean;
export function allowedImageUrl(value:unknown):boolean;
