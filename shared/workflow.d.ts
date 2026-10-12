export interface FlowData {name:string;account:string;source:string;sourceConsent:boolean;platform:string;distributor:string;destinations:string[];destinationConsent:boolean;days:number[];start:string;end:string;interval:number;dailyLimit:number;mode:string}
export interface OfferData {title:string;description:string;price:number;url:string;imageUrl?:string}
export interface FlowCheck {code:string;label:string;passed:boolean;step:number|null}
export interface FlowInspection {ready:boolean;checks:FlowCheck[];pending:number}
export interface FlowIntegrations {whatsapp?:boolean;affiliate?:boolean;permissions?:boolean}
export function inspectFlow(flow:FlowData,integrations?:FlowIntegrations):FlowInspection;
export function composeOffer(offer:OfferData):string;
