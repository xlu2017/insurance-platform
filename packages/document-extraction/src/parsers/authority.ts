import type { AuthorityLevel, ExtractedFactAssertion } from "../types.ts";

const AUTHORITY_RANK: Record<string, number> = {
  coverage_summary: 0,
  insurance_certificate: 1,
  active_endorsement: 2,
  endorsement: 2,
  invoice: 3,
  renewal_overview: 4,
  notice: 5,
  informational_notice: 5,
  policy_wording: 5,
  header_footer: 6,
  unknown: 7,
};

export function authorityRank(authority: AuthorityLevel | string): number {
  return AUTHORITY_RANK[authority] ?? AUTHORITY_RANK.unknown;
}

export function compareAssertionAuthority(
  a: ExtractedFactAssertion,
  b: ExtractedFactAssertion,
): number {
  return authorityRank(a.authority) - authorityRank(b.authority);
}
