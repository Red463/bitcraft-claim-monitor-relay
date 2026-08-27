export interface LegalOperator {
  controllerName: string;
  projectName: string;
  privacyEmail: string;
  controllerCountry: string;
  governingLaw: string;
  minimumAge: number;
  status: string;
}

export interface LegalSection {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface LegalProvider {
  key: string;
  name: string;
  role: string;
  data: string;
  location: string;
}

export interface RetentionRule {
  key: string;
  label: string;
  rule: string;
  days?: number;
  months?: number;
  maximumRows?: number;
}

export interface LegalDocument {
  title: string;
  sections: LegalSection[];
}

export interface LegalPolicy {
  version: string;
  effectiveDate: string;
  operator: LegalOperator;
  supportUrl: string;
  providers: LegalProvider[];
  retention: RetentionRule[];
  terms: LegalDocument;
  privacy: LegalDocument;
  notice: string;
}

export const LEGAL_VERSION: string;
export const LEGAL_EFFECTIVE_DATE: string;
export const defaultLegalOperator: Readonly<LegalOperator>;
export function legalPolicyForEnvironment(env?: Record<string, unknown>): LegalPolicy;

