export type NotionPage = { id: string; properties: Record<string, unknown> } & Record<string, unknown>;

export const getTitle = (page: NotionPage, propertyName: string): string => {
  const prop = page.properties?.[propertyName] as { title?: Array<{ plain_text?: string }> } | undefined;
  return prop?.title?.map((p) => p.plain_text ?? "").join("").trim() ?? "";
};

export const getRichText = (page: NotionPage, propertyName: string): string => {
  const prop = page.properties?.[propertyName] as { rich_text?: Array<{ plain_text?: string }> } | undefined;
  return prop?.rich_text?.map((p) => p.plain_text ?? "").join("").trim() ?? "";
};

export const getUrl = (page: NotionPage, propertyName: string): string => {
  const prop = page.properties?.[propertyName] as { url?: string | null } | undefined;
  return prop?.url?.trim() ?? "";
};

export const getEmail = (page: NotionPage, propertyName: string): string => {
  const prop = page.properties?.[propertyName] as { email?: string | null } | undefined;
  return prop?.email?.trim() ?? "";
};

export const getSelect = (page: NotionPage, propertyName: string): string => {
  const prop = page.properties?.[propertyName] as { select?: { name?: string } | null } | undefined;
  return prop?.select?.name?.trim() ?? "";
};

export const getMultiSelect = (page: NotionPage, propertyName: string): string[] => {
  const prop = page.properties?.[propertyName] as { multi_select?: Array<{ name?: string }> } | undefined;
  return prop?.multi_select?.map((o) => o.name?.trim() ?? "").filter(Boolean) ?? [];
};

export const getDate = (page: NotionPage, propertyName: string): string => {
  const prop = page.properties?.[propertyName] as { date?: { start?: string } | null } | undefined;
  return prop?.date?.start?.trim() ?? "";
};

export const getNumber = (page: NotionPage, propertyName: string): number | null => {
  const prop = page.properties?.[propertyName] as { number?: number | null } | undefined;
  return prop?.number ?? null;
};

export const getCheckbox = (page: NotionPage, propertyName: string): boolean => {
  const prop = page.properties?.[propertyName] as { checkbox?: boolean } | undefined;
  return prop?.checkbox ?? false;
};

export const getRelationIds = (page: NotionPage, propertyName: string): string[] => {
  const prop = page.properties?.[propertyName] as { relation?: Array<{ id?: string }> } | undefined;
  return prop?.relation?.map((r) => r.id ?? "").filter(Boolean) ?? [];
};

/** Falls back through url, rich_text, title — useful when a field could hold any of these. */
export const getTextOrUrl = (page: NotionPage, propertyName: string): string => {
  const prop = page.properties?.[propertyName] as
    | {
        url?: string | null;
        rich_text?: Array<{ plain_text?: string }>;
        title?: Array<{ plain_text?: string }>;
      }
    | undefined;
  if (prop?.url) return prop.url.trim();
  if (prop?.rich_text?.length) return prop.rich_text.map((p) => p.plain_text ?? "").join("").trim();
  if (prop?.title?.length) return prop.title.map((p) => p.plain_text ?? "").join("").trim();
  return "";
};
