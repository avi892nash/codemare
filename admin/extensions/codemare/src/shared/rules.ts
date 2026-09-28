/**
 * The web app's pure rules (architecture §3), bundled in from web/lib — not
 * re-implemented — so the editor's cost preview and the hooks' checks agree
 * with what learners are charged and what the app accepts (token rules, the
 * component dependency graph). See extension.config.js.
 */
export {
  balancesFromRows,
  cheapestRecipe,
  difficultiesFrom,
  planDebits,
  qualifyingBalance,
  recipeProgress,
  type Balances,
  type RecipeInput,
  type RecipeProgress,
  type Requirement,
} from '@/lib/server/rules/recipes';
export { buildAward, solveAward } from '@/lib/server/rules/scoring';
export { findCycle, graphFromEdges } from '@/lib/server/rules/graph';
export { BASE_TOKENS, DIFFICULTIES, type Difficulty } from '@/lib/types';
