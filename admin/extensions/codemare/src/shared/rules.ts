/**
 * The web app's pure token rules (architecture §3), bundled in from web/lib —
 * not re-implemented — so the editor's cost preview and the supply endpoint
 * agree with what learners are charged and earn. See extension.config.js.
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
export { solveAward } from '@/lib/server/rules/scoring';
export { BASE_TOKENS, DIFFICULTIES, type Difficulty } from '@/lib/types';
