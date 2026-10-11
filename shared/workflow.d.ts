export interface FlowData {name:string;account:string;source:string;sourceConsent:boolean;platform:string;distributor:string;destinations:string[];destinationConsent:boolean;days:number[];start:string;end:string;interval:number;dailyLimit:number;mode:string}
export interface OfferData {title:string;description:string;price:number;url:string}
export interface FlowCheck {code:string;label:string;passed:boolean;step:number|null}
export interface FlowInspection {ready:boolean;checks:FlowCheck[];pending:number}
export function inspectFlow(flow:FlowData):FlowInspection;
export function composeOffer(offer:OfferData):string;
