/* Barrel re-export, kept so existing imports (`from '../ui/primitives'`)
 * continue to work without churn.
 *
 * NEW CODE: import each component from its own module
 * (`@/components/ui/Button`, `@/components/ui/Select`, …). webpack cannot
 * tree-shake this local barrel, so a client component that imports it ships
 * every module listed here. That is why it only carries the original set,
 * plus additions that live in those same files (ButtonLink, Textarea,
 * TabPanel, Toggle, verdict helpers) and therefore cost nothing extra. */

export { Button, ButtonLink, type ButtonVariant, type ButtonSize, type ButtonProps, type ButtonLinkProps } from './Button';
export { Kbd } from './Kbd';
export { Pill, type PillTone, type PillSize } from './Pill';
export { DifficultyPill, type Difficulty } from './DifficultyPill';
export {
  StatusPill, STATUS_META, VERDICTS, isStatusCode, statusLabel, type StatusCode, type Verdict,
} from './StatusPill';
export { MetricChip } from './MetricChip';
export { Input, Textarea, type InputProps, type TextareaProps } from './Input';
export { Tabs, TabPanel, type TabsProps, type TabItem } from './Tabs';
export { Avatar } from './Avatar';
export { Progress } from './Progress';
export { Switch, Toggle, type SwitchProps, type ToggleProps } from './Switch';
export { StatusDot, type ProblemStatus } from './StatusDot';
export { LangMark } from './LangMark';
export { Logomark } from './Logomark';
export { CodeBlock, type CodeToken, type CodeLine, type CodeBlockProps } from './CodeBlock';
export { BigMetric } from './BigMetric';
export { fmtTime, fmtMem } from './formatters';
