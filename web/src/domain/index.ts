import { COST_ROW_TYPES, type CostItem, type ProjectFile, type RowType } from './types';
import { recalculateItems } from './calculator';
import { ensureBtwLaagItem, synthesizeStaartItems } from './staartDefaults';

export * from './types';
export * from './calculator';
export { makeStaartItem } from './staartDefaults';
export const FILE_FORMAT_VERSION = '2.3.0';
export const FILE_CAPABILITIES = {
  native: { extensions: ['.ifcCalc', '.ocs', '.json'], import: true, export: true },
  wpcalc: { extensions: ['.calc'], import: true, export: 'converter-service' },
} as const;

export function createItem(partial: Partial<CostItem> & { rowType: RowType }): CostItem {
  return {
    id: crypto.randomUUID(), parentId: null, sortOrder: 0, code: '', description: '',
    unit: 'st', quantity: null, materialPrice: null, laborPrice: null, unitPrice: 0,
    total: 0, isCollapsed: false, depth: 0, notes: '', ifcGuid: '',
    staartPercentage: null, nr: '', normQuantity: null, normFactor: null,
    normDivisor: null, normUnitPrice: null, resourceType: null,
    resourceLibraryId: null, tariefGroep: null, verrekenbaar: null,
    ...partial,
  };
}

export function createProject(name = 'Nieuwe begroting'): ProjectFile {
  const now = new Date().toISOString();
  const project: ProjectFile = {
    version: FILE_FORMAT_VERSION,
    schedule: {
      id: crypto.randomUUID(), name, description: '', status: 'DRAFT', predefinedType: 'BUDGET',
      currency: 'EUR', projectName: name, projectNumber: '', client: '', author: '',
      ifcGuid: '', uitvoeringskosten: 0, algemeneKosten: 0, winstRisico: 0,
      tarieven: { A: 64, B: 43, C: 82 }, branches: [], branchesEnabled: false,
    },
    items: [], resourceLibrary: [],
    companyInfo: {
      name: '', postalAddress: '', postalCity: '', visitAddress: '', visitCity: '',
      phone: '', fax: '', email: '', logoLeft: '', logoRight: '',
    },
    spreadsheets: { sheets: [], activeSheetId: null }, createdAt: now, modifiedAt: now,
  };
  project.items = synthesizeStaartItems(project.schedule);
  return project;
}

const numericFields = ['quantity', 'materialPrice', 'laborPrice', 'unitPrice', 'total', 'sortOrder', 'depth',
  'normQuantity', 'normFactor', 'normDivisor', 'normUnitPrice', 'staartPercentage', 'staartVastBedrag',
  'staartDoelbedrag', 'staartAfrondingStap', 'staartBtwBasis'] as const;
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function finite(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e15;
}

/** Validates calculation-bearing fields without altering opaque native data. */
export function validateProject(value: unknown): asserts value is ProjectFile {
  if (!object(value) || !object(value.schedule) || !Array.isArray(value.items)) {
    throw new Error('Invalid project: schedule and items are required.');
  }
  if (typeof value.version !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(value.version)) {
    throw new Error('Invalid native file format version.');
  }
  const major = Number(value.version.split('.')[0]);
  if (major !== 2) throw new Error(`Unsupported file format ${value.version}; supported major version is 2.`);
  if (typeof value.schedule.name !== 'string' || value.schedule.name.length > 1000) {
    throw new Error('Invalid project name.');
  }
  for (const key of ['id', 'description', 'projectName', 'projectNumber', 'client', 'author', 'currency', 'ifcGuid']) {
    if (typeof value.schedule[key] !== 'string') throw new Error(`Invalid project field ${key}.`);
  }
  if (!/^[A-Z]{3}$/.test(value.schedule.currency as string)) throw new Error('Currency must be a three-letter ISO code.');
  if (!['DRAFT', 'FINAL', 'REVISED'].includes(value.schedule.status as string)) throw new Error('Invalid project status.');
  if (!['BUDGET', 'ESTIMATE', 'TENDER'].includes(value.schedule.predefinedType as string)) throw new Error('Invalid schedule type.');
  if (!object(value.companyInfo) || typeof value.createdAt !== 'string' || typeof value.modifiedAt !== 'string') {
    throw new Error('Invalid project metadata.');
  }
  if (value.spreadsheets !== undefined && (!object(value.spreadsheets) || !Array.isArray(value.spreadsheets.sheets))) {
    throw new Error('Invalid native spreadsheet data.');
  }
  if (value.items.length > 20_000) throw new Error('A project may contain at most 20,000 rows.');
  const rows = new Map<string, Record<string, unknown>>();
  for (const row of value.items) {
    if (!object(row) || typeof row.id !== 'string' || !row.id || rows.has(row.id)) {
      throw new Error('Every row must have a unique non-empty id.');
    }
    if (!COST_ROW_TYPES.includes(row.rowType as RowType)) throw new Error(`Unsupported row type: ${String(row.rowType)}.`);
    if (typeof row.description !== 'string' || typeof row.unit !== 'string' || typeof row.code !== 'string') {
      throw new Error(`Invalid text fields on row ${row.id}.`);
    }
    for (const key of ['notes', 'nr', 'ifcGuid']) {
      if (typeof row[key] !== 'string') throw new Error(`Invalid text field ${key} on row ${row.id}.`);
    }
    if (typeof row.isCollapsed !== 'boolean') throw new Error(`Invalid collapse state on row ${row.id}.`);
    if (row.parentId !== null && typeof row.parentId !== 'string') throw new Error(`Invalid parent on row ${row.id}.`);
    for (const key of numericFields) {
      if (row[key] != null && !finite(row[key])) throw new Error(`Invalid number ${key} on row ${row.id}.`);
    }
    if (typeof row.wpcalcQuantityFormula === 'string' && row.wpcalcQuantityFormula.trim() && row.quantity !== row.wpcalcOriginalQuantity) {
      throw new Error(`Row "${row.description}" has a WPCalc quantity formula. Edit that formula in WPCalc before changing the quantity.`);
    }
    if (row.wpcalcUncalculatedPrice === true && (row.normUnitPrice !== 0 || row.laborPrice !== 0 || row.tariefGroep !== null || row.quantity !== row.wpcalcOriginalQuantity)) {
      throw new Error('Activate the uncalculated source row explicitly before changing its quantity or price.');
    }
    if (row.staartBasis != null && row.staartBasis !== 'cumulatief' && row.staartBasis !== 'kostprijs') {
      throw new Error(`Invalid surcharge basis on row ${row.id}.`);
    }
    if (row.btwTarief != null && row.btwTarief !== 'hoog' && row.btwTarief !== 'laag') throw new Error('Invalid VAT classification.');
    if (row.resourceType != null && !['onderaannemer', 'materieel', 'materiaal', 'arbeid', 'overig'].includes(row.resourceType as string)) {
      throw new Error(`Unsupported resource classification on row ${row.id}.`);
    }
    rows.set(row.id, row);
  }
  for (const row of rows.values()) {
    const seen = new Set<unknown>([row.id]);
    let parentId = row.parentId;
    while (parentId !== null) {
      const parent = rows.get(parentId as string);
      if (!parent) throw new Error(`Row ${String(row.id)} references a missing parent.`);
      if (seen.has(parentId)) throw new Error('Cyclic row hierarchy.');
      if (seen.size >= 64) throw new Error('Row hierarchy exceeds 64 levels.');
      if (!['chapter', 'begrotingspost', 'bewakingspost'].includes(parent.rowType as string)) {
        throw new Error('Only chapters and posts can contain child rows.');
      }
      seen.add(parentId);
      parentId = parent.parentId;
    }
    if (String(row.rowType).startsWith('staart_') && row.parentId !== null) throw new Error('Surcharge rows must be top-level.');
  }
  if (value.schedule.tarieven !== undefined) {
    if (!object(value.schedule.tarieven) || Object.values(value.schedule.tarieven).some(v => !finite(v))) {
      throw new Error('Invalid labor rate table.');
    }
  }
  validateBranches(value as unknown as ProjectFile);
}

function validateBranches(project: ProjectFile): void {
  const { schedule } = project;
  if (schedule.branchesEnabled !== undefined && typeof schedule.branchesEnabled !== 'boolean') throw new Error('Invalid variant setting.');
  if (schedule.activeBranchId !== undefined && typeof schedule.activeBranchId !== 'string') throw new Error('Invalid active variant.');
  if (schedule.branches !== undefined && !Array.isArray(schedule.branches)) throw new Error('Invalid variants.');
  if ((schedule.branches?.length ?? 0) > 20_000) throw new Error('A project may contain at most 20,000 variants.');
  const branches = new Map<string, { id: string; name: string; parentId: string | null }>();
  for (const branch of schedule.branches ?? []) {
    if (!object(branch) || typeof branch.id !== 'string' || !branch.id || typeof branch.name !== 'string'
        || (branch.parentId !== null && typeof branch.parentId !== 'string') || branches.has(branch.id)) {
      throw new Error('Invalid variant metadata.');
    }
    branches.set(branch.id, branch);
  }
  for (const branch of branches.values()) {
    const seen = new Set<string>([branch.id]);
    let parent = branch.parentId;
    while (parent !== null) {
      if (seen.has(parent)) throw new Error('Cyclic variant hierarchy.');
      if (seen.size >= 64) throw new Error('Variant hierarchy exceeds 64 levels.');
      seen.add(parent);
      if (parent === 'main' && !branches.has('main')) break;
      const ancestor = branches.get(parent);
      if (!ancestor) throw new Error('Variant references a missing parent.');
      parent = ancestor.parentId;
    }
  }
  if (schedule.activeBranchId && schedule.activeBranchId !== 'main' && !branches.has(schedule.activeBranchId)) throw new Error('Active variant does not exist.');
  for (const item of project.items) {
    if (item.branchId != null && (typeof item.branchId !== 'string' || (item.branchId !== 'main' && !branches.has(item.branchId)))) {
      throw new Error(`Row ${item.id} references an unknown variant.`);
    }
  }
}

/** Read the upstream native format, preserving fields not edited by PeerCalc. */
export function parseProject(text: string): ProjectFile {
  if (new TextEncoder().encode(text).length > 20 * 1024 * 1024) throw new Error('Project exceeds the 20 MB cloud document limit.');
  const raw: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (!object(raw) || !object(raw.schedule) || !Array.isArray(raw.items)) throw new Error('Invalid native project file.');
  const legacy = raw.version === undefined || (typeof raw.version === 'string' && raw.version.startsWith('1.'));
  if (!legacy && (typeof raw.version !== 'string' || !/^2\.\d+(?:\.\d+)?$/.test(raw.version))) {
    throw new Error(`Unsupported native file format ${String(raw.version)}.`);
  }
  const defaults = createProject();
  const project = {
    ...defaults, ...raw,
    version: legacy || /^2\.[012](?:\.|$)/.test(String(raw.version)) ? FILE_FORMAT_VERSION : raw.version,
    schedule: { ...defaults.schedule, ...raw.schedule },
    items: raw.items.map(row => {
      if (!object(row) || typeof row.id !== 'string') throw new Error('Invalid native row.');
      const rowType = legacy ? (row.isChapter ? 'chapter' : row.rowType === 'normal' ? 'begrotingspost' : row.rowType) : row.rowType;
      const normalized: Record<string, unknown> = { ...row };
      if (legacy) {
        const fallbacks = { code: '', description: '', unit: 'st', unitPrice: 0, total: 0,
          isCollapsed: false, depth: 0, notes: '', ifcGuid: '', nr: '' };
        for (const [key, fallback] of Object.entries(fallbacks)) if (normalized[key] == null) normalized[key] = fallback;
        normalized.verrekenbaar = rowType === 'chapter' ? row.verrekenbaar ?? 'V' : null;
      }
      return createItem({ ...normalized, rowType: rowType as RowType });
    }),
    spreadsheets: raw.spreadsheets ?? (Array.isArray(raw.subSheets)
      ? { sheets: raw.subSheets, activeSheetId: (raw.subSheets[0] as { id?: string } | undefined)?.id ?? null }
      : defaults.spreadsheets),
  };
  // New-project rates must not retroactively replace a native document's stored labor prices.
  if (!Object.hasOwn(raw.schedule, 'tarieven')) delete project.schedule.tarieven;
  validateProject(project);
  if (!project.items.some(row => row.rowType.startsWith('staart_'))
      && !project.schedule.directCostsOnly && !project.schedule.budgetExchange?.directCostsOnly) {
    project.items = [...project.items, ...synthesizeStaartItems(project.schedule)];
  }
  if (legacy || /^2\.[012](?:\.|$)/.test(String(raw.version))) project.items = ensureBtwLaagItem(project.items);
  return project;
}

export function stringifyProject(project: ProjectFile): string {
  validateProject(project);
  return JSON.stringify(project, null, 2);
}

export function calculateProject(project: ProjectFile): ProjectFile {
  const calculated = getCalculationItems(project);
  const byId = new Map(calculated.map(item => [item.id, item]));
  const result = { ...project, items: project.schedule.branchesEnabled
    ? project.items.map(item => byId.get(item.id) ?? item)
    : calculated };
  // Reject overflow before a save could turn non-finite results into JSON nulls.
  validateProject(result);
  return result;
}

/** Calculation/display projection; never use it as a replacement for the saved document. */
export function getCalculationItems(project: ProjectFile): CostItem[] {
  validateProject(project);
  const { schedule } = project;
  let items = project.items;
  if (schedule.branchesEnabled) {
    const branches = new Map((schedule.branches ?? []).map(branch => [branch.id, branch]));
    const allowed = new Set<string>(['main']);
    let id: string | null | undefined = schedule.activeBranchId || 'main';
    while (id && !allowed.has(id)) { allowed.add(id); id = branches.get(id)?.parentId; }
    const candidates = new Map(items.filter(item => allowed.has(item.branchId ?? 'main')).map(item => [item.id, item]));
    items = items.filter(item => {
      if (!candidates.has(item.id)) return false;
      let parentId = item.parentId;
      while (parentId !== null) {
        const parent = candidates.get(parentId);
        if (!parent) return false;
        parentId = parent.parentId;
      }
      return true;
    });
  }
  return recalculateItems(items, schedule.tarieven);
}

/** Same uren formula as Open Calc Studio's totalUrenAll, including mixed-price rows. */
export function getLaborHours(items: CostItem[]): number {
  return items.reduce((sum, row) => row.rowType === 'regel'
    ? sum + (row.quantity ?? 0) * (row.normQuantity ?? 0) / (row.normFactor || 1)
    : sum, 0);
}

export function createSampleProject(): ProjectFile {
  const project = createProject('Renovatie woonhuis');
  project.schedule.projectNumber = 'PC-2026-001';
  project.schedule.client = 'Particuliere opdrachtgever';
  const groups: { code: string; name: string; post: string; rows: Partial<CostItem>[] }[] = [
    { code: '10', name: 'Sloopwerk', post: 'Bestaande situatie vrijmaken', rows: [
      { description: 'Binnenwanden verwijderen', resourceType: 'arbeid', quantity: 48, unit: 'm²', normQuantity: 0.45, tariefGroep: 'A' },
      { description: 'Afvalcontainer 10 m³', resourceType: 'materieel', quantity: 2, unit: 'st', normUnitPrice: 425 },
      { description: 'Afvoer en stortkosten', resourceType: 'onderaannemer', quantity: 1, unit: 'post', normUnitPrice: 680 },
    ] },
    { code: '21', name: 'Betonwerk', post: 'Fundering en begane grond', rows: [
      { description: 'Beton C25/30', resourceType: 'materiaal', quantity: 24, unit: 'm³', normUnitPrice: 145 },
      { description: 'Wapening aanbrengen', resourceType: 'materiaal', quantity: 1850, unit: 'kg', normUnitPrice: 1.85, normQuantity: 0.02, tariefGroep: 'A' },
      { description: 'Betonpomp', resourceType: 'materieel', quantity: 1, unit: 'post', normUnitPrice: 850 },
    ] },
    { code: '30', name: 'Kozijnen en deuren', post: 'Gevel en binnenkozijnen', rows: [
      { description: 'Hardhouten buitenkozijn HR++', resourceType: 'onderaannemer', quantity: 6, unit: 'st', normUnitPrice: 980 },
      { description: 'Binnendeur inclusief beslag', resourceType: 'materiaal', quantity: 8, unit: 'st', normUnitPrice: 215, normQuantity: 1.5, tariefGroep: 'B' },
      { description: 'Aftimmeren en kitwerk', resourceType: 'arbeid', quantity: 1, unit: 'post', normQuantity: 24, tariefGroep: 'A' },
    ] },
    { code: '40', name: 'Afbouw', post: 'Binnenafwerking', rows: [
      { description: 'Stucwerk wanden', resourceType: 'onderaannemer', quantity: 185, unit: 'm²', normUnitPrice: 23.5 },
      { description: 'Tegelwerk badkamer', resourceType: 'materiaal', quantity: 32, unit: 'm²', normUnitPrice: 48, normQuantity: 0.65, tariefGroep: 'A' },
      { description: 'Stelpost vloerafwerking', resourceType: 'overig', quantity: 1, unit: 'post', normUnitPrice: 3500 },
    ] },
    { code: '50', name: 'Installaties', post: 'Elektrotechniek en werktuigbouw', rows: [
      { description: 'Elektrische installatie aanpassen', resourceType: 'onderaannemer', quantity: 1, unit: 'post', normUnitPrice: 4250 },
      { description: 'Vloerverwarming begane grond', resourceType: 'onderaannemer', quantity: 85, unit: 'm²', normUnitPrice: 62.5 },
      { description: 'Sanitair montage', resourceType: 'arbeid', quantity: 1, unit: 'post', normQuantity: 32, tariefGroep: 'C' },
    ] },
  ];
  const rows: CostItem[] = [];
  for (const group of groups) {
    const chapter = createItem({ rowType: 'chapter', code: group.code, description: group.name });
    const post = createItem({ rowType: 'begrotingspost', parentId: chapter.id, code: `${group.code}.10`, description: group.post, quantity: 1, unit: 'post' });
    rows.push(chapter, post, ...group.rows.map(row => createItem({ rowType: 'regel', parentId: post.id, ...row })));
  }
  project.items.unshift(...rows);
  return calculateProject(project);
}
