import { describe, expect, it, vi } from "vitest";
import { copyTsv, toTsv } from "./csv";

interface Row {
  name: string;
  score: number | null;
  notes: string | undefined;
}

const columns = [
  { key: "name", label: "Name" },
  { key: "score", label: "Score" },
  { key: "notes", label: "Notes" },
];

const rows: Row[] = [
  { name: "Alice", score: 90, notes: "ok" },
  { name: "Bob", score: null, notes: undefined },
  { name: "Cat\nDog", score: 5, notes: "a\tb,c" },
];

describe("toTsv", () => {
  it("produces header row first, columns separated by tabs, rows separated by CRLF", () => {
    const output = toTsv(columns, rows);
    expect(output).toBe("Name\tScore\tNotes\r\nAlice\t90\tok\r\nBob\t\t\r\nCat Dog\t5\ta b,c");
  });

  it("treats null/undefined cells as empty strings", () => {
    const output = toTsv([{ key: "score", label: "Score" }], [{ score: null }, { score: undefined }]);
    expect(output).toBe("Score\r\n\r\n");
  });

  it("collapses tabs/newlines inside cells to a single space", () => {
    const output = toTsv(columns, rows);
    const lastLine = output.split("\r\n").pop();
    expect(lastLine).toBe("Cat Dog\t5\ta b,c");
  });

  it("returns only the header when there are no rows", () => {
    const output = toTsv(columns, []);
    expect(output).toBe("Name\tScore\tNotes");
  });
});

describe("copyTsv", () => {
  it("writes the TSV string to navigator.clipboard", async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { writable: true, value: { writeText } });

    await copyTsv(columns, rows);
    expect(writeText).toHaveBeenCalledWith("Name\tScore\tNotes\r\nAlice\t90\tok\r\nBob\t\t\r\nCat Dog\t5\ta b,c");
  });

  it("never throws when clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", { writable: true, value: undefined });
    await expect(copyTsv(columns, rows)).resolves.toBeUndefined();
  });

  it("does nothing when there are no rows", async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { writable: true, value: { writeText } });
    await copyTsv(columns, []);
    expect(writeText).not.toHaveBeenCalled();
  });
});
