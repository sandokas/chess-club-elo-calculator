// Single source of truth: re-export rating config from @chess-club/config.
// Do NOT add local copies of these constants. See AGENTS.md.
export {
  type RatingConfig,
  defaultRatingConfig,
  ratingConfig,
  loadRatingConfig
} from "@chess-club/config";
