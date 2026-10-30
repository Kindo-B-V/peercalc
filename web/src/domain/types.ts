// Native Open Calc Studio 2.3 fields; opaque extension fields are retained verbatim.
export const COST_ROW_TYPES = ['chapter', 'begrotingspost', 'bewakingspost', 'regel', 'tekstregel', 'witregel',
  'staart_ukk', 'staart_ak', 'staart_wr', 'staart_afronding', 'staart_ak_oa', 'staart_abk', 'staart_garanties',
  'staart_wvpm', 'staart_risico', 'staart_winst', 'staart_verzekering', 'staart_btw', 'staart_btw_laag'] as const;
export type RowType = typeof COST_ROW_TYPES[number];
export type ResourceType = 'onderaannemer' | 'materieel' | 'materiaal' | 'arbeid' | 'overig';
export type CostUnit = string;
export interface CostItem {
  [key: string]: unknown;
  id: string;
  parentId: string | null;
  sortOrder: number;
  code: string;
  description: string;
  unit: CostUnit;
  quantity: number | null;
  materialPrice: number | null;
  laborPrice: number | null;
  unitPrice: number;
  total: number;
  isCollapsed: boolean;
  depth: number;
  notes: string;
  ifcGuid: string;
  rowType: RowType;
  staartPercentage: number | null;
  nr: string;
  normQuantity: number | null;
  normFactor: number | null;
  normDivisor: number | null;
  normUnitPrice: number | null;
  resourceType: ResourceType | null;
  resourceLibraryId: string | null;
  tariefGroep: 'A' | 'B' | 'C' | null;
  verrekenbaar: 'V' | 'A' | 'N' | 'F' | null;
  staartBasis?: 'cumulatief' | 'kostprijs' | null;
  staartVastBedrag?: number | null;
  staartDoelbedrag?: number | null;
  staartAfrondingStap?: number | null;
  staartBtwBasis?: number | null;
  btwTarief?: 'hoog' | 'laag' | null;
  staartItemBreakdown?: StaartItemBreakdown;
  branchId?: string | null;
}
export interface StaartItemBreakdown {
  loon: number;
  materiaal: number;
  materieel: number;
  stelpost: number;
  onderaanneming: number;
  bedrag: number;
  subtotaal: number;
  totaal: number;
}
export interface CostSchedule {
  [key: string]: unknown;
  id: string;
  name: string;
  description: string;
  status: 'DRAFT' | 'FINAL' | 'REVISED';
  predefinedType: 'BUDGET' | 'ESTIMATE' | 'TENDER';
  currency: string;
  projectName: string;
  projectNumber: string;
  client: string;
  author: string;
  ifcGuid: string;
  uitvoeringskosten: number;
  algemeneKosten: number;
  winstRisico: number;
  tarieven?: Record<string, number>;
  directCostsOnly?: boolean;
  budgetExchange?: { directCostsOnly?: boolean; [key: string]: unknown };
  branches?: { id: string; name: string; parentId: string | null; color?: string }[];
  branchesEnabled?: boolean;
  activeBranchId?: string;
}
export interface CompanyInfo {
  [key: string]: unknown;
  name: string;
  postalAddress: string;
  postalCity: string;
  visitAddress: string;
  visitCity: string;
  phone: string;
  fax: string;
  email: string;
  logoLeft: string;
  logoRight: string;
}
export interface StagartRow {
  label: string;
  percentage: number | null;
  loon: number | null;
  materiaal: number | null;
  materieel: number | null;
  stelpost: number | null;
  onderaanneming: number | null;
  bedrag: number | null;
  subtotaal: number | null;
  totaal: number | null;
  itemtype: number;
}
export interface ProjectFile {
  [key: string]: unknown;
  version: string;
  schedule: CostSchedule;
  items: CostItem[];
  companyInfo: CompanyInfo;
  resourceLibrary?: unknown[];
  spreadsheets?: { sheets: unknown[]; activeSheetId: string | null; [key: string]: unknown };
  createdAt: string;
  modifiedAt: string;
}
export function isStagartRowType(rowType: RowType): boolean {
  return rowType.startsWith('staart_');
}
