import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createItem, createProject } from "../../src/domain";

async function login(page: Page) {
  await page.goto("/");
  await page.locator("#username").fill("owner@peercalc.local");
  await page.locator("#password").fill(process.env.PEERCALC_OWNER_PASSWORD!);
  await page.locator("#kc-login").click();
  await expect(
    page.getByRole("link", { name: "Uitloggen", exact: true }),
  ).toBeVisible();
}

test("anonymous sessions cannot read or write stored estimates", async ({
  request,
}) => {
  expect((await request.get("/api/me")).status()).toBe(401);
  expect((await request.get("/api/projects")).status()).toBe(401);
  expect(
    (
      await request.get("/api/projects", {
        headers: {
          "oai-authenticated-user-id": "forged",
          "oai-authenticated-user-email": "owner@peercalc.local",
        },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post("/api/projects", { data: { name: "unauthorized" } })
    ).status(),
  ).toBe(401);
});

test("local estimate is usable on mobile without page overflow", async ({
  page,
}, testInfo) => {
  test.skip(!process.env.PEERCALC_OWNER_PASSWORD, "Run local setup first.");
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Renovatie woonhuis", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Opslaan", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("workspace-mobile-grid.png"),
  });
  await page.getByRole("button", { name: "Navigatie", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Nieuwe begroting", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Navigatie", exact: true }).click();
  await page
    .getByRole("button", { name: "Uren & staart", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Staartberekening", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("workspace-mobile.png") });
});

test("native variants, VAT and target rounding calculate in their visible scope", async ({
  page,
}) => {
  test.skip(!process.env.PEERCALC_OWNER_PASSWORD, "Run local setup first.");
  await login(page);
  const project = createProject("Variant acceptance");
  project.schedule.branchesEnabled = true;
  project.schedule.branches = [
    { id: "a", name: "Variant A", parentId: null },
    { id: "b", name: "Variant B", parentId: null },
  ];
  project.schedule.activeBranchId = "a";
  project.items = [
    createItem({
      rowType: "begrotingspost",
      description: "Gedeelde post",
      quantity: 1,
      materialPrice: 100,
    }),
    createItem({
      rowType: "begrotingspost",
      description: "Post variant A",
      branchId: "a",
      quantity: 1,
      materialPrice: 200,
    }),
    createItem({
      rowType: "begrotingspost",
      description: "Post variant B",
      branchId: "b",
      quantity: 1,
      materialPrice: 900,
    }),
    createItem({
      rowType: "staart_winst",
      description: "Winst",
      staartPercentage: 10,
    }),
    createItem({
      rowType: "staart_btw",
      description: "Btw hoog",
      staartPercentage: 21,
    }),
    createItem({
      rowType: "staart_btw_laag",
      description: "Btw laag",
      staartPercentage: 9,
      staartBtwBasis: 50,
    }),
    createItem({ rowType: "staart_afronding", description: "Afronding" }),
  ];
  await page.locator("input[type='file']").setInputFiles({
    name: "variants.ocs",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        ...project,
        opaqueAcceptanceField: { preserve: true },
      }),
    ),
  });
  await expect(page.locator(".summary-main strong")).toHaveText(/300,00/);
  await expect(
    page.getByLabel("Omschrijving regel 2", { exact: true }),
  ).toHaveValue("Post variant A");
  await page.getByLabel("Begrotingsvariant", { exact: true }).selectOption("b");
  await expect(page.locator(".summary-main strong")).toHaveText(/1\.000,00/);
  await expect(
    page.getByLabel("Omschrijving regel 2", { exact: true }),
  ).toHaveValue("Post variant B");
  await page
    .getByRole("button", { name: "Uren & staart", exact: true })
    .last()
    .click();
  await page
    .getByLabel("Afrondingsmethode", { exact: true })
    .selectOption("target");
  await page.getByLabel("Afrondingswaarde", { exact: true }).fill("1200");
  await expect(page.locator(".summary-grand strong")).toHaveText(/1\.200,00/);
  await page
    .getByLabel("Grondslag laag btw-tarief", { exact: true })
    .fill("200");
  await expect(page.locator(".tail-table tfoot")).toContainText(/1\.428,00/);
  await page.getByRole("button", { name: "Begroting", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Bestand exporteren", exact: true })
    .click();
  const exported = JSON.parse(
    await readFile((await (await downloaded).path())!, "utf8"),
  );
  expect(exported.opaqueAcceptanceField).toEqual({ preserve: true });
  expect(
    exported.items.some(
      (item: { description: string }) => item.description === "Post variant A",
    ),
  ).toBe(true);
  expect(
    exported.items.some(
      (item: { description: string }) => item.description === "Post variant B",
    ),
  ).toBe(true);
});

test("native files without a rate table keep their stored hourly prices", async ({ page }) => {
  test.skip(!process.env.PEERCALC_OWNER_PASSWORD, "Run local setup first.");
  await login(page);
  const project = createProject("Historical hourly price");
  delete project.schedule.tarieven;
  project.schedule.directCostsOnly = true;
  project.items = [createItem({ rowType: "regel", description: "Stored labor",
    quantity: 2, resourceType: "arbeid", normQuantity: 1, tariefGroep: "A",
    laborPrice: 70, normUnitPrice: 0 })];
  await page.locator("input[type='file']").setInputFiles({
    name: "historical-rate.ocs", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.locator(".summary-main strong")).toHaveText(/140,00/);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Bestand exporteren", exact: true }).click();
  const exported = JSON.parse(await readFile((await (await pending).path())!, "utf8"));
  expect(Object.hasOwn(exported.schedule, "tarieven")).toBe(false);
  expect(exported.items[0].laborPrice).toBe(70);
});

test("an uncalculated source row requires explicit activation before changing the quote", async ({
  page,
}) => {
  test.skip(!process.env.PEERCALC_OWNER_PASSWORD, "Run local setup first.");
  await login(page);
  const project = createProject("Source state acceptance");
  project.items.unshift(
    createItem({
      rowType: "regel",
      description: "Uncalculated source row",
      quantity: 2,
      normUnitPrice: 0,
      laborPrice: 0,
      wpcalcUncalculatedPrice: true,
      wpcalcOriginalPrice: 17.25,
      wpcalcOriginalQuantity: 2,
    }),
  );
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "source-state.ocs",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
  await expect(
    page.getByRole("img", { name: "Bronregel niet doorgerekend", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Hoeveelheid: Uncalculated source row", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Prijs: Uncalculated source row", { exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Omschrijving regel 1", { exact: true }).click();
  await page
    .getByRole("button", { name: "Regeleigenschappen", exact: true })
    .click();
  await expect(
    page.getByLabel("Oorspronkelijke bronprijs", { exact: true }),
  ).toHaveValue(/17,25/);
  await page
    .getByRole("button", { name: "Bronregel berekenen", exact: true })
    .click();
  await expect(
    page.getByLabel("Hoeveelheid: Uncalculated source row", { exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".summary-main strong")).toHaveText(/34,50/);
});

test("sign in, save, revise, restore, export genuine MDB and reimport it", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(
    !process.env.PEERCALC_OWNER_PASSWORD,
    "Run local setup to create a private owner password.",
  );
  const name = `Acceptance ${crypto.randomUUID()}`;
  let projectId: string | undefined;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => void dialog.accept());
  try {
    await login(page);
    await page.screenshot({
      path: testInfo.outputPath("workspace-desktop.png"),
    });
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
    expect(projectId).toBeTruthy();

    await page.getByRole("button", { name: "Begroting", exact: true }).click();
    const quantity = page
      .locator(
        ".estimate-grid tr:has(.row-type-dot.resource) input[aria-label^='Hoeveelheid:']",
      )
      .first();
    const initialQuantity = await quantity.inputValue();
    const initialTotal = await page.locator(".summary-main strong").innerText();
    await quantity.fill(String(Number(initialQuantity) + 1));
    await expect(page.locator(".summary-main strong")).not.toHaveText(
      initialTotal,
    );
    await page.getByRole("button", { name: "Opslaan", exact: true }).click();
    await expect(
      page.getByText("Opgeslagen als versie 2.", { exact: true }),
    ).toBeVisible();
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
    await expect(quantity).toHaveValue(initialQuantity);
    await expect(page.locator(".summary-main strong")).toHaveText(initialTotal);

    await page.getByLabel("Exportformaat", { exact: true }).selectOption("ocs");
    const nativeDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Bestand exporteren", exact: true })
      .click();
    const nativePath = await (await nativeDownload).path();
    const native = JSON.parse(await readFile(nativePath!, "utf8"));
    expect(native.schedule.name).toBe(name);
    expect(native.version).toMatch(/^2\./);
    expect(native.items.length).toBeGreaterThan(0);

    const { user: owner } = (await (
      await page.request.get("/api/me")
    ).json()) as { user: { userId: string; email: string } };
    const secondContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
    });
    try {
      const second = await secondContext.newPage();
      await second.goto("/");
      await second.locator("#kc-registration a").click();
      await second.locator("#firstName").fill("Acceptance");
      await second.locator("#lastName").fill("Isolation");
      await second
        .locator("#email")
        .fill(`acceptance-${crypto.randomUUID()}@peercalc.test`);
      const password = `${crypto.randomUUID()}Aa1!`;
      await second.locator("#password").fill(password);
      await second.locator("#password-confirm").fill(password);
      await second.locator("input[type='submit']").click();
      await expect(
        second.getByText("Opslag verbonden", { exact: true }),
      ).toBeVisible();
      const ownProjects = (await (
        await second.request.get("/api/projects")
      ).json()) as { projects: Array<{ id: string }> };
      expect(
        ownProjects.projects.some((project) => project.id === projectId),
      ).toBe(false);
      expect(
        (await second.request.get(`/api/projects/${projectId}`)).status(),
      ).toBe(404);
      expect(
        (
          await second.request.get(`/api/projects/${projectId}/versions`)
        ).status(),
      ).toBe(404);
      expect(
        (
          await second.request.put(`/api/projects/${projectId}`, {
            data: { name, document: native, expectedRevision: 3 },
          })
        ).status(),
      ).toBe(404);
      expect(
        (
          await second.request.get(`/api/projects/${projectId}`, {
            headers: {
              "oai-authenticated-user-id": owner.userId,
              "oai-authenticated-user-email": owner.email,
            },
          })
        ).status(),
      ).toBe(404);
    } finally {
      await secondContext.close();
    }

    await page
      .getByLabel("Exportformaat", { exact: true })
      .selectOption("calc");
    const calcDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Bestand exporteren", exact: true })
      .click();
    const calcFile = await calcDownload;
    expect(calcFile.suggestedFilename()).toMatch(/\.calc$/);
    const calcPath = await calcFile.path();
    const calc = await readFile(calcPath!);
    expect(calc.subarray(4, 19).toString("ascii")).toBe("Standard Jet DB");
    expect(calc.length).toBeGreaterThan(4096);
    await page.locator("input[type='file']").setInputFiles({
      name: "acceptance-roundtrip.calc",
      mimeType: "application/octet-stream",
      buffer: calc,
    });
    await expect(
      page.getByText(
        "acceptance-roundtrip.calc geimporteerd als nieuw concept.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.locator(".summary-main strong")).toHaveText(initialTotal);
    await page.getByRole("button", { name: "Rapport", exact: true }).click();
    await expect(page.locator(".report-page")).toBeVisible();
    await expect(page.locator(".report-table tbody tr")).toHaveCount(25);
    await page.screenshot({
      path: testInfo.outputPath("workspace-report.png"),
    });
    const pdf = await page.pdf({
      path: testInfo.outputPath("estimate-report.pdf"),
      format: "A4",
      landscape: true,
      printBackground: true,
    });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);
    expect(errors).toEqual([]);
  } finally {
    if (projectId) {
      const response = await page.request.get(`/api/projects/${projectId}`);
      if (response.ok()) {
        const { project } = (await response.json()) as {
          project: { revision: number };
        };
        await page.request.delete(`/api/projects/${projectId}`, {
          data: { expectedRevision: project.revision },
        });
      }
    }
  }
});
