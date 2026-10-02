<template>
	<private-view :title="topic ? `Recipes · ${topic.title}` : 'Recipe editor'">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded icon secondary disabled>
				<v-icon name="lock_open" />
			</v-button>
		</template>

		<template #navigation>
			<nav class="topic-nav">
				<div v-if="!data" class="nav-loading"><v-progress-circular indeterminate small /></div>
				<div v-for="group in tierGroups" :key="group.tier.id" class="tier-group">
					<div class="tier-label">
						Tier {{ group.tier.ord }} · {{ group.tier.title }}
						<span v-if="group.tier.ord === 0" class="free">free</span>
					</div>
					<v-list nav>
						<v-list-item
							v-for="t in group.topics"
							:key="t.id"
							clickable
							:active="t.id === topicId"
							:to="`/recipe-editor/${t.id}`"
						>
							<v-list-item-icon>
								<span class="status-dot" :class="topicStatus[t.id]" />
							</v-list-item-icon>
							<v-list-item-content>
								<v-text-overflow :text="t.title" />
							</v-list-item-content>
							<span class="nav-count">{{ recipesOf(t.id).length }}</span>
						</v-list-item>
					</v-list>
				</div>
			</nav>
		</template>

		<template #actions>
			<v-button v-if="topic && dirty" v-tooltip.bottom="'Discard changes'" rounded icon secondary @click="discard">
				<v-icon name="undo" />
			</v-button>
			<v-button
				v-if="topic"
				v-tooltip.bottom="saveHint"
				rounded
				icon
				:disabled="!canSave"
				:loading="saving"
				@click="save"
			>
				<v-icon name="check" />
			</v-button>
		</template>

		<div class="recipe-editor">
			<v-notice v-if="loadError" type="danger" class="block">
				Could not load recipes: {{ loadError }}
				<v-button small secondary class="retry" @click="load">Retry</v-button>
			</v-notice>

			<div v-else-if="!data" class="loading"><v-progress-circular indeterminate /></div>

			<template v-else-if="!topic">
				<p class="intro">
					A topic in tier 1 or above unlocks when a learner spends <strong>any one</strong> of its recipes. Each item
					asks for a number of tokens of a topic, earned at a minimum difficulty or harder. Pick a topic to edit its
					recipes.
				</p>
				<table class="overview">
					<thead>
						<tr>
							<th>Tier</th>
							<th>Topic</th>
							<th>Recipes</th>
							<th>Cheapest</th>
							<th>Status</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="t in data.topics" :key="t.id" class="clickable" @click="router.push(`/recipe-editor/${t.id}`)">
							<td>{{ t.tierOrd }}</td>
							<td>{{ t.title }}</td>
							<td>{{ recipesOf(t.id).length }}</td>
							<td>{{ cheapestLabel(t.id) }}</td>
							<td><span class="status-dot" :class="topicStatus[t.id]" /> {{ statusText(t.id) }}</td>
						</tr>
					</tbody>
				</table>
			</template>

			<template v-else>
				<div class="topic-meta">
					<span class="pill">Tier {{ topic.tierOrd }}</span>
					<span class="slug">{{ topic.slug }}</span>
					<span v-if="data.supply" class="supply-note">
						Content pays out {{ describeSupply(topic.id) }} for this topic.
					</span>
				</div>

				<v-notice v-if="!data.canNestWrites" type="warning" class="block">
					Saving needs the topics → recipes → items relations of the content model. Run the
					<code>directus-config</code> service (see deploy/README.md), then reload.
				</v-notice>
				<v-notice v-if="!data.supply" type="info" class="block">
					Supply data is unavailable, so recipes are not checked against what the content pays out.
				</v-notice>
				<v-notice v-if="saveError" type="danger" class="block">Saving failed: {{ saveError }}</v-notice>
				<v-notice
					v-for="(issue, i) in topicIssues"
					:key="`topic-issue-${i}`"
					:type="issue.severity === 'error' ? 'danger' : 'warning'"
					class="block"
				>
					{{ issue.message }}
				</v-notice>

				<section
					v-for="(recipe, index) in draft"
					:key="recipe.key"
					class="recipe"
					:class="{ invalid: hasIssue(recipe.key, undefined, 'error') }"
				>
					<header class="recipe-head">
						<span class="ord">{{ index + 1 }}</span>
						<v-input
							:model-value="recipe.title"
							class="title-input"
							placeholder="Recipe title, e.g. “Scan, then search”"
							@update:model-value="recipe.title = String($event ?? '')"
						/>
						<span v-if="costOf(recipe.key)?.cheapest" v-tooltip="'What a learner with no tokens is pointed at'" class="pill cheapest">
							cheapest
						</span>
						<span
							v-if="costOf(recipe.key)?.affordable === false"
							v-tooltip="'Asks for more tokens than all published content pays out'"
							class="pill unaffordable"
						>
							not affordable
						</span>
						<span class="total">{{ tokens(costOf(recipe.key)?.totalTokens ?? 0) }}</span>
						<v-button v-tooltip="'Move up'" icon x-small secondary :disabled="index === 0" @click="move(index, -1)">
							<v-icon name="arrow_upward" />
						</v-button>
						<v-button
							v-tooltip="'Move down'"
							icon
							x-small
							secondary
							:disabled="index === draft.length - 1"
							@click="move(index, 1)"
						>
							<v-icon name="arrow_downward" />
						</v-button>
						<v-button v-tooltip="'Remove recipe'" icon x-small secondary kind="danger" @click="removeRecipe(index)">
							<v-icon name="delete" />
						</v-button>
					</header>

					<table class="items">
						<thead>
							<tr>
								<th class="token">Token topic</th>
								<th class="qty">Quantity</th>
								<th class="diff">Min difficulty</th>
								<th>Preview</th>
								<th class="del" />
							</tr>
						</thead>
						<tbody>
							<tr
								v-for="(item, itemIndex) in recipe.items"
								:key="item.key"
								:class="{ invalid: hasIssue(recipe.key, item.key, 'error') }"
							>
								<td class="token">
									<v-select
										:model-value="item.tokenTopicId"
										:items="tokenChoices"
										placeholder="Choose a topic…"
										@update:model-value="item.tokenTopicId = $event ?? null"
									/>
								</td>
								<td class="qty">
									<v-input
										:model-value="item.quantity"
										type="number"
										:min="1"
										:step="1"
										@update:model-value="item.quantity = toQuantity($event)"
									/>
								</td>
								<td class="diff">
									<v-select
										:model-value="item.minDifficulty"
										:items="difficultyChoices"
										@update:model-value="item.minDifficulty = $event ?? null"
									/>
								</td>
								<td class="preview">
									{{ lineOf(recipe.key, item.key)?.text }}
									<span v-if="lineOf(recipe.key, item.key)?.onOffer !== undefined" class="on-offer">
										· {{ lineOf(recipe.key, item.key)?.onOffer }} on offer
									</span>
								</td>
								<td class="del">
									<v-button v-tooltip="'Remove item'" icon x-small secondary @click="removeItem(recipe, itemIndex)">
										<v-icon name="close" />
									</v-button>
								</td>
							</tr>
						</tbody>
					</table>

					<div class="recipe-foot">
						<v-button small secondary @click="addItem(recipe)">
							<v-icon name="add" left />
							Add item
						</v-button>
						<span class="spend">{{ spendSentence(recipe.key) }}</span>
					</div>

					<ul v-if="recipeIssues(recipe.key).length" class="issues">
						<li v-for="(issue, i) in recipeIssues(recipe.key)" :key="i" :class="issue.severity">
							<v-icon :name="issue.severity === 'error' ? 'error' : 'warning'" small />
							{{ issue.message }}
						</li>
					</ul>
				</section>

				<div class="add-recipe">
					<v-button secondary @click="addRecipe">
						<v-icon name="add" left />
						Add recipe
					</v-button>
				</div>
			</template>
		</div>

		<template #sidebar>
			<sidebar-detail icon="info" title="How recipes work" close>
				<div class="sidebar-copy">
					<p>Spending any one recipe unlocks the topic (tier 1+, once its tier's gate is passed).</p>
					<p>
						An item needs <em>quantity</em> tokens of a topic earned at <em>min difficulty</em> or harder. Tokens are debited
						cheapest first (Easy → Medium → Hard).
					</p>
					<p>
						“Cheapest” marks the recipe a learner with no tokens is shown first: fewest tokens, then list order. “On offer”
						is what all published questions pay out.
					</p>
					<p>A save applies every change of the topic in one transaction.</p>
				</div>
			</sidebar-detail>
		</template>

		<v-dialog v-model="leaveDialog" @esc="leaveDialog = false">
			<v-card>
				<v-card-title>Discard unsaved changes?</v-card-title>
				<v-card-text>Your edits to the recipes of {{ topic?.title }} have not been saved.</v-card-text>
				<v-card-actions>
					<v-button secondary @click="leaveDialog = false">Keep editing</v-button>
					<v-button kind="danger" @click="confirmLeave">Discard</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</private-view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter, type RouteLocationRaw } from 'vue-router';
import { useApi, useStores } from '@directus/extensions-sdk';
import { DIFFICULTIES, qualifyingBalance } from '../shared/rules';
import {
	checkTopicRecipes,
	recipeCosts,
	type Issue,
	type RecipeDraft,
	type RecipeShape,
	type Severity,
} from '../shared/recipe-checks';
import { buildSavePayload, emptyItem, emptyRecipe, sameDraft, toDraft, type SavedRecipe } from './draft';
import { errorMessage, loadEditorData, saveTopicRecipes, type Api, type EditorData } from './data';

const props = defineProps<{ topicId?: string }>();

const api = useApi() as unknown as Api;
const { useNotificationsStore } = useStores();
const notifications = useNotificationsStore();
const router = useRouter();

const data = ref<EditorData | null>(null);
const loadError = ref<string | null>(null);
const draft = ref<RecipeDraft[]>([]);
const saving = ref(false);
const saveError = ref<string | null>(null);
const leaveDialog = ref(false);
const pendingRoute = ref<RouteLocationRaw | null>(null);

const topicId = computed(() => props.topicId ?? null);
const topic = computed(() => data.value?.topics.find((t) => t.id === topicId.value) ?? null);

const recipesByTopic = computed(() => {
	const map = new Map<string, SavedRecipe[]>();
	for (const r of data.value?.recipes ?? []) {
		const list = map.get(r.topic_id) ?? [];
		list.push(r);
		map.set(r.topic_id, list);
	}
	return map;
});
const recipesOf = (id: string) => recipesByTopic.value.get(id) ?? [];

const savedShapes = computed(() => {
	const map = new Map<string, RecipeShape[]>();
	for (const [id, recipes] of recipesByTopic.value) {
		map.set(
			id,
			recipes.map((r) => ({ items: r.items.map((it) => ({ tokenTopicId: it.token_topic_id })) }))
		);
	}
	return map;
});

const tierGroups = computed(() =>
	(data.value?.tiers ?? []).map((tier) => ({
		tier,
		topics: (data.value?.topics ?? []).filter((t) => t.tierId === tier.id),
	}))
);

const tokenChoices = computed(() =>
	(data.value?.topics ?? []).map((t) => ({
		text: `T${t.tierOrd} · ${t.title}`,
		value: t.id,
		disabled: t.id === topicId.value,
	}))
);
const difficultyChoices = DIFFICULTIES.map((d) => ({
	text: d === 'Easy' ? 'Easy (any)' : `${d}+`,
	value: d,
}));

function issuesFor(id: string, recipes: RecipeDraft[]): Issue[] {
	const d = data.value;
	const t = d?.topics.find((x) => x.id === id);
	if (!d || !t) return [];
	return checkTopicRecipes({
		topic: t,
		draft: recipes,
		topics: d.topics,
		saved: savedShapes.value,
		supply: d.supply?.supply,
	});
}

const issues = computed(() => (topic.value ? issuesFor(topic.value.id, draft.value) : []));
const errors = computed(() => issues.value.filter((i) => i.severity === 'error'));
const topicIssues = computed(() => issues.value.filter((i) => !i.recipeKey));
const recipeIssues = (key: string) => issues.value.filter((i) => i.recipeKey === key);
const hasIssue = (recipeKey: string, itemKey: string | undefined, severity: Severity) =>
	issues.value.some(
		(i) => i.recipeKey === recipeKey && (itemKey === undefined || i.itemKey === itemKey) && i.severity === severity
	);

const costs = computed(() =>
	data.value && topic.value ? recipeCosts(draft.value, data.value.topics, data.value.supply?.supply) : []
);
const costOf = (key: string) => costs.value.find((c) => c.recipeKey === key);
const lineOf = (recipeKey: string, itemKey: string) => costOf(recipeKey)?.lines.find((l) => l.itemKey === itemKey);

const topicStatus = computed<Record<string, Severity | 'ok'>>(() => {
	const out: Record<string, Severity | 'ok'> = {};
	for (const t of data.value?.topics ?? []) {
		const list = t.id === topicId.value ? issues.value : issuesFor(t.id, toDraft(recipesOf(t.id)));
		out[t.id] = list.some((i) => i.severity === 'error')
			? 'error'
			: list.some((i) => i.severity === 'warning')
				? 'warning'
				: 'ok';
	}
	return out;
});

function statusText(id: string): string {
	const s = topicStatus.value[id];
	return s === 'error' ? 'needs attention' : s === 'warning' ? 'warnings' : 'ok';
}

const tokens = (n: number) => `${n} token${n === 1 ? '' : 's'}`;

function cheapestLabel(id: string): string {
	const t = data.value?.topics.find((x) => x.id === id);
	if (!t || t.tierOrd === 0) return 'free tier';
	const c = recipeCosts(toDraft(recipesOf(id)), data.value?.topics ?? []).find((x) => x.cheapest);
	return c ? tokens(c.totalTokens) : '—';
}

function describeSupply(id: string): string {
	const s = data.value?.supply;
	if (!s) return '';
	const parts = DIFFICULTIES.map((d) => `${s.supply[id]?.[d] ?? 0} ${d}`);
	const total = qualifyingBalance(s.supply, id, 'Easy');
	const c = s.counts[id] ?? { questions: 0 };
	return `${total} tokens (${parts.join(' / ')}) from ${c.questions} question${c.questions === 1 ? '' : 's'}`;
}

function spendSentence(key: string): string {
	const c = costOf(key);
	if (!c || c.lines.length === 0) return '';
	return `Spends ${c.lines.map((l) => l.text).join(' + ')}.`;
}

const savedDraft = computed(() => (topicId.value ? toDraft(recipesOf(topicId.value)) : []));
const dirty = computed(() => !!topic.value && !sameDraft(draft.value, savedDraft.value));
const canSave = computed(
	() => dirty.value && errors.value.length === 0 && !saving.value && !!data.value?.canNestWrites
);
const saveHint = computed(() => {
	if (!dirty.value) return 'No changes';
	if (errors.value.length) return `Fix ${errors.value.length} error${errors.value.length > 1 ? 's' : ''} first`;
	if (!data.value?.canNestWrites) return 'Content model not applied';
	return 'Save';
});

function resetDraft() {
	draft.value = savedDraft.value.map((r) => ({ ...r, items: r.items.map((it) => ({ ...it })) }));
	saveError.value = null;
}

async function load() {
	loadError.value = null;
	try {
		data.value = await loadEditorData(api);
		resetDraft();
	} catch (error) {
		loadError.value = errorMessage(error);
	}
}

function toQuantity(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

function addRecipe() {
	draft.value.push(emptyRecipe());
}

function removeRecipe(index: number) {
	draft.value.splice(index, 1);
}

function move(index: number, delta: number) {
	const target = index + delta;
	if (target < 0 || target >= draft.value.length) return;
	const list = draft.value;
	[list[index], list[target]] = [list[target]!, list[index]!];
}

function addItem(recipe: RecipeDraft) {
	recipe.items.push(emptyItem());
}

function removeItem(recipe: RecipeDraft, index: number) {
	recipe.items.splice(index, 1);
}

function discard() {
	resetDraft();
}

async function save() {
	if (!topic.value || !canSave.value) return;
	const payload = buildSavePayload(recipesOf(topic.value.id), draft.value);
	if (!payload) return;
	saving.value = true;
	saveError.value = null;
	try {
		await saveTopicRecipes(api, topic.value.id, payload);
		notifications.add({ title: `Saved the recipes of ${topic.value.title}`, type: 'success' });
		await load();
	} catch (error) {
		saveError.value = errorMessage(error);
	} finally {
		saving.value = false;
	}
}

function guard(to: RouteLocationRaw) {
	if (!dirty.value) return true;
	pendingRoute.value = to;
	leaveDialog.value = true;
	return false;
}
onBeforeRouteUpdate((to) => guard(to.fullPath));
onBeforeRouteLeave((to) => guard(to.fullPath));

function confirmLeave() {
	resetDraft();
	leaveDialog.value = false;
	const to = pendingRoute.value;
	pendingRoute.value = null;
	if (to) router.push(to);
}

watch(topicId, () => resetDraft());
onMounted(load);
</script>

<style scoped>
.recipe-editor {
	padding: 0 var(--content-padding, 32px) var(--content-padding-bottom, 132px);
	max-width: 1100px;
}

.loading {
	display: flex;
	justify-content: center;
	padding: 64px 0;
}

.intro {
	margin: 8px 0 24px;
	color: var(--theme--foreground-subdued);
	line-height: 1.6;
	max-width: 70ch;
}

.block {
	margin-bottom: 16px;
}

.retry {
	margin-left: 12px;
}

.topic-nav {
	padding: 12px 0;
}

.nav-loading {
	display: flex;
	justify-content: center;
	padding: 24px 0;
}

.tier-group + .tier-group {
	margin-top: 12px;
}

.tier-label {
	padding: 4px 20px;
	font-size: 12px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--theme--foreground-subdued);
}

.tier-label .free {
	margin-left: 4px;
	text-transform: none;
	font-weight: 500;
	color: var(--theme--success, #2ecda7);
}

.nav-count {
	margin-left: auto;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.status-dot {
	display: inline-block;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background-color: var(--theme--success, #2ecda7);
}

.status-dot.warning {
	background-color: var(--theme--warning, #ffa439);
}

.status-dot.error {
	background-color: var(--theme--danger, #e35169);
}

.overview,
.items {
	width: 100%;
	border-collapse: collapse;
}

.overview th,
.overview td,
.items th,
.items td {
	padding: 8px 10px;
	text-align: left;
	border-bottom: var(--theme--border-width, 1px) solid var(--theme--border-color-subdued);
	vertical-align: middle;
}

.overview th,
.items th {
	font-size: 12px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
}

.overview tr.clickable {
	cursor: pointer;
}

.overview tr.clickable:hover {
	background-color: var(--theme--background-subdued);
}

.topic-meta {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 12px;
	margin: 4px 0 20px;
	color: var(--theme--foreground-subdued);
}

.slug {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 13px;
}

.supply-note {
	font-size: 13px;
}

.pill {
	display: inline-flex;
	align-items: center;
	padding: 2px 8px;
	border-radius: 999px;
	font-size: 12px;
	font-weight: 600;
	background-color: var(--theme--background-normal);
	color: var(--theme--foreground);
}

.pill.cheapest {
	background-color: var(--theme--primary-background, var(--theme--background-normal));
	color: var(--theme--primary);
}

.pill.unaffordable {
	color: var(--theme--warning, #ffa439);
}

.recipe {
	margin-bottom: 20px;
	padding: 16px;
	border: var(--theme--border-width, 1px) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius, 6px);
	background-color: var(--theme--background);
}

.recipe.invalid {
	border-color: var(--theme--danger, #e35169);
}

.recipe-head {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 12px;
}

.recipe-head .ord {
	min-width: 24px;
	font-weight: 700;
	color: var(--theme--foreground-subdued);
}

.recipe-head .title-input {
	flex: 1;
}

.recipe-head .total {
	margin: 0 8px;
	font-weight: 600;
	white-space: nowrap;
}

.items .token {
	width: 34%;
	min-width: 220px;
}

.items .qty {
	width: 120px;
}

.items .diff {
	width: 170px;
}

.items .del {
	width: 48px;
	text-align: right;
}

.items tr.invalid td {
	background-color: var(--theme--danger-background, rgba(227, 81, 105, 0.08));
}

.items .preview {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
}

.on-offer {
	white-space: nowrap;
}

.recipe-foot {
	display: flex;
	align-items: center;
	gap: 16px;
	margin-top: 12px;
}

.spend {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
}

.issues {
	margin: 12px 0 0;
	padding: 0;
	list-style: none;
	font-size: 13px;
}

.issues li {
	display: flex;
	align-items: flex-start;
	gap: 6px;
	padding: 2px 0;
}

.issues li.error {
	color: var(--theme--danger, #e35169);
}

.issues li.warning {
	color: var(--theme--warning, #ffa439);
}

.add-recipe {
	margin-top: 8px;
}

.sidebar-copy {
	padding: 0 4px;
	line-height: 1.6;
	color: var(--theme--foreground-subdued);
}

.sidebar-copy p + p {
	margin-top: 8px;
}
</style>
