import type { MatchRatingAudit } from "./ratings.js";

export function matchRatingAuditValues(audit: MatchRatingAudit | null) {
  return {
    whiteEloBefore: audit?.whiteEloBefore ?? null,
    whiteEloAfter: audit?.whiteEloAfter ?? null,
    blackEloBefore: audit?.blackEloBefore ?? null,
    blackEloAfter: audit?.blackEloAfter ?? null,
    whiteGlickoRatingBefore: audit?.whiteGlickoBefore.rating ?? null,
    whiteGlickoRatingAfter: audit?.whiteGlickoAfter.rating ?? null,
    whiteGlickoRdBefore: audit?.whiteGlickoBefore.rd ?? null,
    whiteGlickoRdAfter: audit?.whiteGlickoAfter.rd ?? null,
    whiteGlickoVolBefore: audit?.whiteGlickoBefore.vol ?? null,
    whiteGlickoVolAfter: audit?.whiteGlickoAfter.vol ?? null,
    blackGlickoRatingBefore: audit?.blackGlickoBefore?.rating ?? null,
    blackGlickoRatingAfter: audit?.blackGlickoAfter?.rating ?? null,
    blackGlickoRdBefore: audit?.blackGlickoBefore?.rd ?? null,
    blackGlickoRdAfter: audit?.blackGlickoAfter?.rd ?? null,
    blackGlickoVolBefore: audit?.blackGlickoBefore?.vol ?? null,
    blackGlickoVolAfter: audit?.blackGlickoAfter?.vol ?? null,
    whiteLastPlayedBefore: audit?.whiteGlickoBefore.lastGameDate ?? null,
    blackLastPlayedBefore: audit?.blackGlickoBefore?.lastGameDate ?? null
  };
}
