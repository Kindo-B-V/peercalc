import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import MDBReader from "mdb-reader";
import { expect, test, type Page } from "@playwright/test";

const sourceFile = process.env.PEERCALC_PRIVATE_CALC_FILE;
// Prevent failure artifacts from retaining a customer's accessible page snapshot.
if (sourceFile) process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
test.use({ screenshot: "off", trace: "off", video: "off" });

type RecordData = Record<string, unknown>;
const financialCaches = new Set([
  "kostprijs",
  "totaalexclbtw",
  "totaalinclbtw",
  "btw",
  "btwhoog",
  "btwlaag",
  "totaaluren",
  "totaalloon",
  "totaalmateriaal",
  "totaalmaterieel",
  "totaalstelposten",
  "totaalonderaanneming",
]);
const tailCaches = new Set([
  "loon",
  "materiaal",
  "materieel",
  "stelpost",
  "onderaanneming",
  "bedrag",
  "subtotaal",
  "totaal",
]);
const closeNumber = (a: number, b: number) =>
  Math.abs(a - b) <= Math.max(1e-8, Math.abs(a) * 1e-12);
const equalField = (a: unknown, b: unknown) =>
  typeof a === "number" && typeof b === "number"
    ? closeNumber(a, b)
    : isDeepStrictEqual(a, b);
const cents = (value: number) => Math.round(value * 100);
const parseMoney = (text: string) =>
  Number(
    text
      .replace(/[^0-9,.-]/g, "")
      .replaceAll(".", "")
      .replace(",", "."),
  );

function compareAllFields(source: MDBReader, exported: MDBReader) {
  const tableKinds = {
    normalTables: true,
    systemTables: true,
    linkedTables: true,
  };
  const tables = source.getTableNames(tableKinds).sort();
  expect(
    isDeepStrictEqual(tables, exported.getTableNames(tableKinds).sort()),
    "Private table set retained",
  ).toBe(true);
  let fields = 0,
    cacheChanges = 0,
    unexpected = 0;
  const differences: Record<string, number> = {};
  const differ = (schema: string) => {
    unexpected++;
    differences[schema] = (differences[schema] ?? 0) + 1;
  };
  for (const name of tables) {
    try {
      const beforeTable = source.getTable(name),
        afterTable = exported.getTable(name);
      const columns = beforeTable.getColumnNames();
      if (!isDeepStrictEqual(columns, afterTable.getColumnNames()))
        differ(`${name}.columns`);
      const beforeRows = beforeTable.getData(),
        afterRows = afterTable.getData();
      if (beforeRows.length !== afterRows.length) differ(`${name}.rowCount`);
      const rowKey =
        name === "tarieven"
          ? (row: RecordData) => JSON.stringify([row.docnr, row.tariefgroep])
          : columns.includes("recnr")
            ? (row: RecordData) => row.recnr
            : null;
      const byId: Map<unknown, RecordData> | null = rowKey
        ? new Map(afterRows.map((row) => [rowKey(row), row]))
        : null;
      if (byId && byId.size !== afterRows.length)
        differ(`${name}.duplicateKey`);
      for (let index = 0; index < beforeRows.length; index++) {
        const before: RecordData = beforeRows[index];
        const after: RecordData | undefined = byId
          ? byId.get(rowKey!(before))
          : afterRows[index];
        if (!after) {
          differ(`${name}.missingRow`);
          continue;
        }
        for (const key of columns) {
          fields++;
          if (equalField(before[key], after[key])) continue;
          const timestamp =
            name === "calculaties" &&
            key === "gewijzigd" &&
            after[key] instanceof Date;
          const headerCache =
            name === "calculaties" &&
            financialCaches.has(key) &&
            typeof after[key] === "number" &&
            Number.isFinite(after[key]);
          const tailCache =
            name === "staart" &&
            tailCaches.has(key) &&
            typeof after[key] === "number" &&
            Number.isFinite(after[key]);
          const hoursCache =
            name === "uren" &&
            ["aantal", "tarief", "bedrag"].includes(key) &&
            typeof after[key] === "number" &&
            Number.isFinite(after[key]);
          if (timestamp || headerCache || tailCache || hoursCache)
            cacheChanges++;
          else differ(`${name}.${key}`);
        }
      }
    } catch {
      differ(`${name}.unreadable`);
    }
  }
  return {
    tables: tables.length,
    fields,
    allowedDerivedChanges: cacheChanges,
    unexpected,
    differences,
  };
}

async function download(page: Page, format: string) {
  await page.getByLabel("Exportformaat", { exact: true }).selectOption(format);
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Bestand exporteren", exact: true })
    .click();
  const file = await pending;
  return readFile((await file.path())!);
}

test("opt-in private source survives the authenticated browser and every MDB table", async ({
  page,
}) => {
  test.skip(
    !sourceFile || !process.env.PEERCALC_OWNER_PASSWORD,
    "Set the private fixture path and local owner credentials to opt in.",
  );
  test.setTimeout(120_000);
  const name = `Private acceptance ${crypto.randomUUID()}`;
  const output = new URL("../../outputs/private-acceptance/", import.meta.url);
  let projectId: string | undefined;
  let stage = "source-read";
  page.on("dialog", (dialog) => void dialog.accept());
  try {
    const bytes = await readFile(sourceFile!);
    const original = new MDBReader(bytes);
    const sourceHeader = original.getTable("calculaties").getData()[0];
    const direct = original
      .getTable("data")
      .getData()
      .filter((row) => row.rectype === 0)
      .reduce(
        (sum, row) => sum + Number(row.aantal ?? 0) * Number(row.kosteneh ?? 0),
        0,
      );
    const excluding = Number(sourceHeader.totaalexclbtw),
      including = Number(sourceHeader.totaalinclbtw);
    expect(
      [direct, excluding, including].every(Number.isFinite),
      "Private financial cache available",
    ).toBe(true);
    stage = "authentication";
    await page.goto("/");
    await page.locator("#username").fill("owner@peercalc.local");
    await page.locator("#password").fill(process.env.PEERCALC_OWNER_PASSWORD!);
    await page.locator("#kc-login").click();
    await expect(
      page.getByRole("link", { name: "Uitloggen", exact: true }),
    ).toBeVisible();
    stage = "browser-import-and-source-totals";
    await page.locator("input[type=file]").setInputFiles({
      name: "private-acceptance.calc",
      mimeType: "application/octet-stream",
      buffer: bytes,
    });
    await expect(page.locator(".notice")).toContainText(
      "private-acceptance.calc geimporteerd als nieuw concept.",
    );
    await expect(page.locator(".workspace")).not.toHaveAttribute("inert", "");
    expect(
      cents(
        parseMoney(await page.locator(".summary-main strong").innerText()),
      ) === cents(direct),
      "Private direct total matches source",
    ).toBe(true);
    expect(
      cents(
        parseMoney(await page.locator(".summary-grand strong").innerText()),
      ) === cents(excluding),
      "Private excluding-VAT total matches source",
    ).toBe(true);
    await page
      .getByRole("button", { name: "Uren & staart", exact: true })
      .last()
      .click();
    expect(
      cents(
        parseMoney(
          await page.locator(".tail-table tfoot .numeric").innerText(),
        ),
      ) === cents(including),
      "Private including-VAT total matches source",
    ).toBe(true);
    await page.getByRole("button", { name: "Begroting", exact: true }).click();
    stage = "native-export-original-bytes";
    const nativeBytes = await download(page, "ocs");
    const native = JSON.parse(nativeBytes.toString("utf8"));
    expect(
      Buffer.from(native.wpcalcSource.data, "base64").equals(bytes),
      "Original MDB bytes retained in native document",
    ).toBe(true);
    await mkdir(output, { recursive: true, mode: 0o700 });
    await chmod(output, 0o700);
    await writeFile(new URL("native.ocs", output), nativeBytes, {
      mode: 0o600,
    });
    stage = "save-and-version-edit";
    await page
      .getByRole("button", { name: "Projectgegevens", exact: true })
      .click();
    await page.getByLabel("Naam begroting", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Opslaan", exact: true }).click();
    await expect(
      page.getByText("Opgeslagen als versie 1.", { exact: true }),
    ).toBeVisible();
    const listed = (await (await page.request.get("/api/projects")).json()) as {
      projects: Array<{ id: string; name: string }>;
    };
    projectId = listed.projects.find((project) => project.name === name)?.id;
    expect(!!projectId, "Private acceptance project created").toBe(true);
    await page
      .getByLabel("Opgesteld door", { exact: true })
      .fill("Private acceptance revision");
    await page.getByRole("button", { name: "Opslaan", exact: true }).click();
    await expect(
      page.getByText("Opgeslagen als versie 2.", { exact: true }),
    ).toBeVisible();
    stage = "version-restore-and-reload";
    await page
      .getByRole("button", { name: "Versiegeschiedenis", exact: true })
      .click();
    await page
      .locator(".version-row")
      .filter({ hasText: "Versie 1" })
      .getByRole("button", { name: "Herstellen", exact: true })
      .click();
    await expect(
      page.getByText("Versie 1 hersteld als versie 3.", { exact: true }),
    ).toBeVisible();
    await page.locator(".project-link").filter({ hasText: name }).click();
    const loadedResponse = await page.request.get(`/api/projects/${projectId}`);
    expect(loadedResponse.ok(), "Private saved document reload succeeds").toBe(
      true,
    );
    const loaded = (await loadedResponse.json()) as {
      project: {
        revision: number;
        document: { wpcalcSource: { data: string } };
      };
    };
    expect(
      loaded.project.revision === 3 &&
        Buffer.from(loaded.project.document.wpcalcSource.data, "base64").equals(
          bytes,
        ),
      "Private original bytes persist through version restore",
    ).toBe(true);
    stage = "mdb-export-and-independent-full-field-comparison";
    await page.getByRole("button", { name: "Begroting", exact: true }).click();
    const calc = await download(page, "calc");
    expect(
      calc.subarray(4, 19).toString("ascii") === "Standard Jet DB",
      "Export is genuine Access MDB",
    ).toBe(true);
    await writeFile(new URL("roundtrip.calc", output), calc, { mode: 0o600 });
    const reopened = new MDBReader(calc);
    const report = compareAllFields(original, reopened);
    await writeFile(
      new URL("verification.json", output),
      JSON.stringify(report, null, 2),
      { mode: 0o600 },
    );
    expect(
      report.unexpected === 0,
      "All private source fields retained outside documented derived caches",
    ).toBe(true);
    const exportedHeader = reopened.getTable("calculaties").getData()[0];
    expect(
      cents(Number(exportedHeader.totaalexclbtw)) === cents(excluding) &&
        cents(Number(exportedHeader.totaalinclbtw)) === cents(including),
      "Exported source financial totals remain equal",
    ).toBe(true);
    stage = "browser-reimport";
    await page.locator("input[type=file]").setInputFiles({
      name: "private-roundtrip.calc",
      mimeType: "application/octet-stream",
      buffer: calc,
    });
    await expect(page.locator(".notice")).toContainText(
      "private-roundtrip.calc geimporteerd als nieuw concept.",
    );
    await expect(page.locator(".workspace")).not.toHaveAttribute("inert", "");
    expect(
      cents(
        parseMoney(await page.locator(".summary-main strong").innerText()),
      ) === cents(direct) &&
        cents(
          parseMoney(await page.locator(".summary-grand strong").innerText()),
        ) === cents(excluding),
      "Browser reimport retains source financial totals",
    ).toBe(true);
    console.log(
      `Private browser acceptance passed: ${report.tables} tables and ${report.fields} fields compared; source values and page snapshots not logged.`,
    );
  } catch {
    throw new Error(
      `Private browser acceptance failed at ${stage}; customer values and page snapshots are not retained in test output.`,
    );
  } finally {
    if (projectId) {
      try {
        const response = await page.request.get(`/api/projects/${projectId}`);
        if (response.ok()) {
          const { project } = (await response.json()) as {
            project: { revision: number };
          };
          await page.request.delete(`/api/projects/${projectId}`, {
            data: { expectedRevision: project.revision },
          });
        }
      } catch {
        /* Cleanup must not expose a private response in failure output. */
      }
    }
    await page.close();
  }
});
