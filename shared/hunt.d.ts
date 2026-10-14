import type {OfferData} from './workflow.js';
export function keywordVariants(term: string): string[];
export interface MessageVariant {tone: string; label: string; text: string}
export function messageVariants(offer: OfferData): MessageVariant[];
