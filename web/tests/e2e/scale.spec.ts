import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createItem, createProject } from "../../src/domain";

test.describe("estimate scale", () => {
  for (const size of [2000, 20000]) {
    test(`${size} native rows remain editable and reachable`, async ({
      page,
    }) => {
      test.skip(!process.env.PEERCALC_OWNER_PASSWORD, "Run local setup first.");
      test.setTimeout(180_000);
      await page.goto("/");
      await page.locator("#username").fill("owner@peercalc.local");
      await page
        .locator("#password")
        .fill(process.env.PEERCALC_OWNER_PASSWORD!);
      await page.locator("#kc-login").click();
      await expect(
        page.getByRole("link", { name: "Uitloggen", exact: true }),
      ).toBeVisible();
      const project = createProject(`Scale ${size}`);
      const tails = project.items;
      const chapter = createItem({
        rowType: "chapter",
        description: "Scale chapter",
      });
      const dataRows = size - tails.length - 1;
      project.items = [
        chapter,
        ...Array.from({ length: dataRows }, (_, index) =>
          createItem({
            rowType: "regel",
            parentId: chapter.id,
            description: `Scale row ${index + 1}`,
            quantity: 1,
            unit: "st",
            normUnitPrice: 10,
          }),
        ),
        ...tails,
      ];
      const importedAt = performance.now();
      await page.locator("input[type=file]").setInputFiles({
        name: `scale-${size}.ocs`,
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(project)),
      });
      await expect(page.locator(".grid-footer")).toContainText(
        `${dataRows + 1} regels`,
      );
      await expect(page.locator(".workspace")).not.toHaveAttribute("inert", "");
      const importMs = Math.round(performance.now() - importedAt);
      const typingAt = performance.now();
      await page
        .getByLabel("Hoeveelheid: Scale row 1", { exact: true })
        .fill("2");
      await expect(page.locator(".summary-main strong")).toContainText(
        new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2 }).format(
          (dataRows + 1) * 10,
        ),
      );
      const typingMs = Math.round(performance.now() - typingAt);
      const metrics = await page
        .locator(".grid-scroll")
        .evaluate((element) => ({
          domInputs: element.querySelectorAll("input,select").length,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        }));
      console.log(
        JSON.stringify({ rows: size, importMs, typingMs, ...metrics }),
      );
      expect(metrics.domInputs).toBeLessThan(400);
      expect(metrics.scrollHeight).toBeGreaterThan((dataRows + 1) * 36);
      expect(typingMs).toBeLessThan(2000);
      await page.locator(".grid-scroll").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect(
        page.getByLabel("Hoeveelheid: Scale row 1", { exact: true }),
      ).toBeFocused();
      await expect(
        page.getByLabel(`Hoeveelheid: Scale row ${dataRows}`, { exact: true }),
      ).toBeVisible();
      await page
        .getByLabel(`Hoeveelheid: Scale row ${dataRows}`, { exact: true })
        .fill("3");
      await expect(page.locator(".summary-main strong")).toContainText(
        new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2 }).format(
          (dataRows + 3) * 10,
        ),
      );
      await page
        .getByLabel("Zoeken in begroting", { exact: true })
        .fill(`Scale row ${dataRows}`);
      await expect(page.locator(".grid-footer")).toContainText("1 regels");
      await expect(
        page.getByLabel(`Hoeveelheid: Scale row ${dataRows}`, { exact: true }),
      ).toBeInViewport();
      const download = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Bestand exporteren", exact: true })
        .click();
      const exported = JSON.parse(
        await readFile((await (await download).path())!, "utf8"),
      );
      expect(exported.items).toHaveLength(size);
      expect(
        exported.items.find(
          (item: { description: string }) =>
            item.description === `Scale row ${dataRows}`,
        ).quantity,
      ).toBe(3);
    });
  }
});
