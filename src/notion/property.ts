export const titleProp = (value: string): { title: Array<{ text: { content: string } }> } => ({
  title: [{ text: { content: value || "Untitled" } }],
});

export const richTextProp = (value: string): { rich_text: Array<{ text: { content: string } }> } => ({
  rich_text: value ? [{ text: { content: truncateForNotion(value) } }] : [],
});

export const urlProp = (value: string | null | undefined): { url: string | null } => ({
  url: value || null,
});

/**
 * Notion's `email` field caps at 100 chars; passing 101+ throws
 * `body failed validation: ... .email.length should be ≤ 100` and aborts the
 * write. Drop oversized values silently rather than poison the batch.
 */
export const emailProp = (value: string | null | undefined): { email: string | null } => ({
  email: value && value.length <= 100 ? value : null,
});

export const numberProp = (value: number | null | undefined): { number: number | null } => ({
  number: value ?? null,
});

export const selectProp = (value: string | null | undefined): { select: { name: string } | null } => ({
  select: value ? { name: value } : null,
});

export const multiSelectProp = (values: string[]): { multi_select: Array<{ name: string }> } => ({
  multi_select: values.filter(Boolean).map((name) => ({ name })),
});

export const checkboxProp = (value: boolean): { checkbox: boolean } => ({
  checkbox: value,
});

export const dateProp = (iso: string): { date: { start: string } } => ({
  date: { start: iso },
});

export const relationProp = (
  pageIdOrIds: string | string[] | null | undefined,
): { relation: Array<{ id: string }> } => {
  if (!pageIdOrIds) return { relation: [] };
  const ids = Array.isArray(pageIdOrIds) ? pageIdOrIds : [pageIdOrIds];
  return { relation: ids.filter(Boolean).map((id) => ({ id })) };
};

export const fileProp = (
  url: string | null | undefined,
): { files: Array<{ type: "external"; name: string; external: { url: string } }> } => ({
  files: url ? [{ type: "external", name: url.slice(0, 100), external: { url } }] : [],
});

export const truncateForNotion = (value: string, max = 2000): string => {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
};
