import { describe, expect, it } from "vitest";

import { page } from "./pagination";

const rows = [1, 2, 3, 4, 5];

describe("page", () => {
  it("returns everything when no limit is asked for", () => {
    expect(page(rows)).toEqual(rows);
    expect(page(rows, { offset: 2 })).toEqual(rows);
  });

  it("windows from the offset", () => {
    expect(page(rows, { limit: 2 })).toEqual([1, 2]);
    expect(page(rows, { limit: 2, offset: 2 })).toEqual([3, 4]);
  });

  it("runs off the end rather than wrapping", () => {
    expect(page(rows, { limit: 2, offset: 4 })).toEqual([5]);
    expect(page(rows, { limit: 2, offset: 99 })).toEqual([]);
  });

  it("treats a negative offset as the first page", () => {
    // `Number(searchParams.page) - 1` is where the offset comes from, and a
    // hand-edited `?page=0` must not slice from the end of the array.
    expect(page(rows, { limit: 2, offset: -10 })).toEqual([1, 2]);
  });

  it("copies rather than aliasing the caller's array", () => {
    const out = page(rows);
    out.push(6);
    expect(rows).toHaveLength(5);
  });
});
