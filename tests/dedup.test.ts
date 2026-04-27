import { describe, it, expect } from "vitest";
import {
  scoreRecord,
  defaultPersonScoringRubric,
  groupByKey,
  linkedinUrlKey,
  planMerge,
  isFalsy,
  unionArrays,
  dedupByKey,
  type ScoringRubric,
  type MergeSpec,
} from "../src/index.js";

type Person = {
  id: string;
  apolloPersonId?: string;
  workEmails?: string;
  linkedinUrl?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  headline?: string;
  evidenceSummary?: string;
  archived?: boolean;
  campaignIds?: string[];
};

// ─── scoreRecord ───

describe("scoreRecord", () => {
  it("sums points from matching rules", () => {
    const rubric: ScoringRubric<Person> = [
      { label: "has email", match: (r) => Boolean(r.workEmails), points: 8 },
      { label: "has linkedin", match: (r) => Boolean(r.linkedinUrl), points: 5 },
    ];
    const record: Person = { id: "1", workEmails: "x@y.com", linkedinUrl: "https://linkedin.com/in/x" };
    expect(scoreRecord(record, rubric)).toBe(13);
  });

  it("returns 0 when no rules match", () => {
    const rubric: ScoringRubric<Person> = [
      { label: "has email", match: (r) => Boolean(r.workEmails), points: 8 },
    ];
    expect(scoreRecord({ id: "1" }, rubric)).toBe(0);
  });
});

describe("defaultPersonScoringRubric", () => {
  it("scores a fully-populated record higher than a sparse one", () => {
    const rubric = defaultPersonScoringRubric<Person>();
    const full: Person = {
      id: "1",
      apolloPersonId: "ap1",
      workEmails: "j@acme.com",
      linkedinUrl: "https://linkedin.com/in/j",
      firstName: "Jane",
      lastName: "Doe",
      jobTitle: "VP",
      headline: "VP @ Acme",
      evidenceSummary: "lots of evidence here",
    };
    const sparse: Person = { id: "2", firstName: "John" };
    expect(scoreRecord(full, rubric)).toBeGreaterThan(scoreRecord(sparse, rubric));
  });

  it("treats 'not found' LinkedIn URL as missing", () => {
    const rubric = defaultPersonScoringRubric<Person>();
    const withReal: Person = { id: "1", linkedinUrl: "https://linkedin.com/in/j" };
    const withMarker: Person = { id: "2", linkedinUrl: "not found" };
    expect(scoreRecord(withReal, rubric)).toBeGreaterThan(scoreRecord(withMarker, rubric));
  });

  it("penalizes archived records", () => {
    const rubric = defaultPersonScoringRubric<Person>();
    const active: Person = { id: "1", firstName: "A", lastName: "B", archived: false };
    const archived: Person = { id: "2", firstName: "A", lastName: "B", archived: true };
    expect(scoreRecord(active, rubric)).toBeGreaterThan(scoreRecord(archived, rubric));
  });
});

// ─── groupByKey ───

describe("groupByKey", () => {
  it("groups records by string key", () => {
    const groups = groupByKey([{ id: "1", k: "a" }, { id: "2", k: "a" }, { id: "3", k: "b" }], (r) => r.k);
    expect(groups.size).toBe(2);
    expect(groups.get("a")).toHaveLength(2);
    expect(groups.get("b")).toHaveLength(1);
  });

  it("skips records with null or empty keys", () => {
    const groups = groupByKey(
      [{ id: "1", k: "" }, { id: "2", k: null as string | null }, { id: "3", k: "ok" }],
      (r) => r.k,
    );
    expect(groups.size).toBe(1);
    expect(groups.get("ok")).toHaveLength(1);
  });
});

describe("linkedinUrlKey", () => {
  it("normalizes protocol, www, casing, trailing slash", () => {
    expect(linkedinUrlKey("HTTPS://www.LinkedIn.com/in/Jane-Doe/"))
      .toBe("linkedin.com/in/jane-doe");
  });

  it("returns null for empty / 'not found'", () => {
    expect(linkedinUrlKey("")).toBeNull();
    expect(linkedinUrlKey("not found")).toBeNull();
    expect(linkedinUrlKey("Not Found")).toBeNull();
    expect(linkedinUrlKey(null)).toBeNull();
    expect(linkedinUrlKey(undefined)).toBeNull();
  });

  it("strips query strings and fragments", () => {
    expect(linkedinUrlKey("https://linkedin.com/in/jane?utm=x#x"))
      .toBe("linkedin.com/in/jane");
  });
});

// ─── isFalsy + planMerge ───

describe("isFalsy", () => {
  it("treats null/undefined/empty-string/empty-array as falsy", () => {
    expect(isFalsy(null)).toBe(true);
    expect(isFalsy(undefined)).toBe(true);
    expect(isFalsy("")).toBe(true);
    expect(isFalsy("   ")).toBe(true);
    expect(isFalsy([])).toBe(true);
  });

  it("treats non-empty values as truthy", () => {
    expect(isFalsy("x")).toBe(false);
    expect(isFalsy(0)).toBe(false); // numbers count as truthy unless rule overrides
    expect(isFalsy(["a"])).toBe(false);
  });
});

describe("planMerge", () => {
  it("fills empty winner fields from first non-empty loser", () => {
    const winner: Person = { id: "1", firstName: "Jane" };
    const losers: Person[] = [
      { id: "2", firstName: "Jane", workEmails: "jane@acme.com" },
      { id: "3", firstName: "Jane", workEmails: "different@acme.com" },
    ];
    const spec: MergeSpec<Person> = [
      { field: "workEmails" },
      { field: "lastName" },
    ];
    const updates = planMerge(winner, losers, spec);
    expect(updates.workEmails).toBe("jane@acme.com");
    expect(updates.lastName).toBeUndefined();
  });

  it("does not overwrite winner fields that are already populated", () => {
    const winner: Person = { id: "1", workEmails: "winner@a.com" };
    const losers: Person[] = [{ id: "2", workEmails: "loser@a.com" }];
    const spec: MergeSpec<Person> = [{ field: "workEmails" }];
    expect(planMerge(winner, losers, spec)).toEqual({});
  });

  it("uses combine() for union-style merges", () => {
    const winner: Person = { id: "1", campaignIds: ["c1"] };
    const losers: Person[] = [
      { id: "2", campaignIds: ["c1", "c2"] },
      { id: "3", campaignIds: ["c3"] },
    ];
    const spec: MergeSpec<Person> = [
      { field: "campaignIds", combine: unionArrays },
    ];
    const updates = planMerge(winner, losers, spec);
    expect(updates.campaignIds).toEqual(["c1", "c2", "c3"]);
  });

  it("supports custom isEmpty for domain-specific empty markers", () => {
    const winner: Person = { id: "1", linkedinUrl: "not found" };
    const losers: Person[] = [{ id: "2", linkedinUrl: "https://linkedin.com/in/j" }];
    const spec: MergeSpec<Person> = [
      {
        field: "linkedinUrl",
        isEmpty: (v) => !v || (typeof v === "string" && v.trim().toLowerCase() === "not found"),
      },
    ];
    expect(planMerge(winner, losers, spec)).toEqual({
      linkedinUrl: "https://linkedin.com/in/j",
    });
  });
});

// ─── dedupByKey end-to-end ───

describe("dedupByKey", () => {
  it("returns one result per duplicate group", () => {
    const people: Person[] = [
      { id: "1", apolloPersonId: "a", firstName: "Jane", workEmails: "" },
      { id: "2", apolloPersonId: "a", firstName: "Jane", workEmails: "j@a.com" },
      { id: "3", apolloPersonId: "b", firstName: "John" },
      { id: "4", apolloPersonId: "c", firstName: "K" },
    ];

    const results = dedupByKey(people, {
      keyFn: (r) => r.apolloPersonId ?? null,
      rubric: defaultPersonScoringRubric<Person>(),
      mergeSpec: [{ field: "workEmails" }],
    });

    expect(results).toHaveLength(1);
    expect(results[0].winner.id).toBe("2"); // higher-scored (has email)
    expect(results[0].losers.map((l) => l.id)).toEqual(["1"]);
    expect(results[0].updates).toEqual({}); // winner already has email
    expect(results[0].groupSize).toBe(2);
  });

  it("merges fields from loser into winner when winner has empty slot", () => {
    const people: Person[] = [
      { id: "1", apolloPersonId: "a", firstName: "Jane", workEmails: "j@a.com", lastName: "" },
      { id: "2", apolloPersonId: "a", firstName: "Jane", lastName: "Doe" },
    ];

    const results = dedupByKey(people, {
      keyFn: (r) => r.apolloPersonId ?? null,
      rubric: defaultPersonScoringRubric<Person>(),
      mergeSpec: [{ field: "lastName" }, { field: "workEmails" }],
    });

    expect(results).toHaveLength(1);
    // Person 2 wins (10 pts for first+last vs Person 1's 8 pts for email).
    expect(results[0].winner.id).toBe("2");
    // Winner already has lastName, so no update for that field.
    expect(results[0].updates.lastName).toBeUndefined();
    // Winner had no email — pulled from loser.
    expect(results[0].updates.workEmails).toBe("j@a.com");
  });

  it("skips singleton groups", () => {
    const people: Person[] = [{ id: "1", apolloPersonId: "a" }];
    const results = dedupByKey(people, {
      keyFn: (r) => r.apolloPersonId ?? null,
      rubric: defaultPersonScoringRubric<Person>(),
      mergeSpec: [],
    });
    expect(results).toHaveLength(0);
  });

  it("dedups by LinkedIn URL using linkedinUrlKey helper", () => {
    const people: Person[] = [
      { id: "1", linkedinUrl: "https://www.linkedin.com/in/jane/" },
      { id: "2", linkedinUrl: "linkedin.com/in/jane" },
      { id: "3", linkedinUrl: "not found" }, // skipped
      { id: "4", linkedinUrl: "" },          // skipped
    ];

    const results = dedupByKey(people, {
      keyFn: (r) => linkedinUrlKey(r.linkedinUrl),
      rubric: defaultPersonScoringRubric<Person>(),
      mergeSpec: [],
    });

    expect(results).toHaveLength(1);
    expect(results[0].groupSize).toBe(2);
  });
});
