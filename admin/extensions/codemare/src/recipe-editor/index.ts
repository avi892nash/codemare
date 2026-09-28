/**
 * T4 — the recipe editor: pick a topic, see and edit the recipes that unlock
 * it (add, remove, reorder; items = token topic × quantity × minimum
 * difficulty), with live validation and a cost preview per recipe.
 * Route: /admin/recipe-editor[/<topic id>].
 */
import { defineModule } from '@directus/extensions-sdk';
import RecipeEditor from './RecipeEditor.vue';

type Access = { access?: string } | undefined;
type PermissionMap = Record<string, Record<string, Access> | undefined> | undefined;

const canRead = (permissions: PermissionMap, collection: string) =>
  ['partial', 'full'].includes(permissions?.[collection]?.read?.access ?? 'none');

export default defineModule({
  id: 'recipe-editor',
  name: 'Recipe editor',
  icon: 'lock_open',
  routes: [
    { name: 'recipe-editor', path: '', component: RecipeEditor },
    { name: 'recipe-editor-topic', path: ':topicId', component: RecipeEditor, props: true },
  ],
  preRegisterCheck(user, permissions) {
    if ((user as { admin_access?: boolean }).admin_access) return true;
    const p = permissions as unknown as PermissionMap;
    return canRead(p, 'unlock_recipes') && canRead(p, 'recipe_items') && canRead(p, 'topics');
  },
});
