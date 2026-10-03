/* Section ids + labels for /dev/system. Plain module (not 'use client') so
 * the server page can map over it. */
export const SECTIONS = [
  ['colors', 'Color tokens'],
  ['contrast', 'Contrast'],
  ['type', 'Type scale'],
  ['radii', 'Radii & shadows'],
  ['page', 'Page header & difficulty'],
  ['marks', 'Avatar & language marks'],
  ['buttons', 'Buttons'],
  ['heights', 'Control heights'],
  ['pills', 'Pills & status'],
  ['chips', 'Chips'],
  ['inputs', 'Inputs & select'],
  ['tabs', 'Tabs & toggle'],
  ['overlays', 'Tooltip · modal · toast'],
  ['progress', 'Skeleton & progress'],
  ['kbd', 'Kbd & breadcrumb'],
  ['code', 'Code blocks'],
  ['callouts', 'Callouts & formula'],
  ['viz', 'Visualization'],
  ['icons', 'Icons'],
  ['states', 'States'],
] as const;

export type SectionKey = (typeof SECTIONS)[number][0];
