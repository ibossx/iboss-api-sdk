/**
 * Reporting, incident settings, drill-down reports, and URL event logs
 * (reporter tier).
 */
import { SubClient, type EntriesResponse, type SuccessResponse } from "./base.js";

export interface DrillDownReport {
  reportId: number;
  reportName?: string;
  startDate?: string;
  endDate?: string;
  reportType?: string;
  [key: string]: unknown;
}

export interface TopNOptions {
  currentRowNumber?: number;
  maxItemsToReturn?: number;
  startDate?: string;
  endDate?: string;
}

export interface UrlLogEntry {
  timestamp?: string;
  userName?: string;
  sourceIp?: string;
  destinationUrl?: string;
  category?: string;
  action?: string;
  bytesTransferred?: number;
  [key: string]: unknown;
}

export class ReportingApi extends SubClient {
  // --- Incident capture settings -------------------------------------------

  async getIncidentSettings(): Promise<Record<string, unknown>> {
    return this.request("reporter", "GET", "/ibreports/web/zerotrust/incident/settings");
  }

  async saveIncidentSettings(settings: Record<string, unknown>): Promise<SuccessResponse> {
    return this.request("reporter", "POST", "/ibreports/web/zerotrust/incident/settings", {
      body: settings,
    });
  }

  // --- Drill-down reports ---------------------------------------------------

  async listReports(opts?: {
    month?: number;
    year?: number;
    reportingGroupId?: number;
  }): Promise<DrillDownReport[]> {
    const now = new Date();
    return this.request("reporter", "GET", "/ibreports/web/reports/lite", {
      query: {
        dailyReport: -1,
        month: opts?.month ?? now.getMonth() + 1,
        year: opts?.year ?? now.getFullYear(),
        reportingGroupId: opts?.reportingGroupId ?? -1,
      },
    });
  }

  async topCategoryHits(reportId: number, opts?: TopNOptions): Promise<EntriesResponse<Record<string, unknown>>> {
    return this.topN(reportId, "topCategoryHits", opts);
  }

  async topBlockedDomains(reportId: number, opts?: TopNOptions): Promise<EntriesResponse<Record<string, unknown>>> {
    return this.topN(reportId, "topBlockedDomains", opts);
  }

  async topVisitedDomains(reportId: number, opts?: TopNOptions): Promise<EntriesResponse<Record<string, unknown>>> {
    return this.topN(reportId, "topVisitedDomains", opts);
  }

  async topUsersByHits(reportId: number, opts?: TopNOptions): Promise<EntriesResponse<Record<string, unknown>>> {
    return this.topN(reportId, "topUsersOverallWebHits", opts);
  }

  async topUsersByTime(reportId: number, opts?: TopNOptions): Promise<EntriesResponse<Record<string, unknown>>> {
    return this.topN(reportId, "topUsersOverallTime", opts);
  }

  private topN(
    reportId: number,
    metric: string,
    opts?: TopNOptions,
  ): Promise<EntriesResponse<Record<string, unknown>>> {
    return this.request("reporter", "GET", `/ibreports/web/reports/${reportId}/web/${metric}`, {
      query: {
        currentRowNumber: opts?.currentRowNumber ?? 1,
        maxItemsToReturn: opts?.maxItemsToReturn ?? 10,
        startDate: opts?.startDate,
        endDate: opts?.endDate,
      },
    });
  }

  // --- URL event logs --------------------------------------------------------

  async listUrlLogArchives(): Promise<EntriesResponse<Record<string, unknown>>> {
    return this.request("reporter", "GET", "/ibreports/web/log/url/archives", {
      query: { includeAllRecord: false },
    });
  }

  async listUrlLogEntries(opts?: {
    startDate?: string;
    endDate?: string;
    currentRowNumber?: number;
    maxItemsToReturn?: number;
  }): Promise<EntriesResponse<UrlLogEntry>> {
    return this.request("reporter", "GET", "/ibreports/web/log/url/entries", {
      query: {
        startDate: opts?.startDate,
        endDate: opts?.endDate,
        currentRowNumber: opts?.currentRowNumber ?? 1,
        maxItemsToReturn: opts?.maxItemsToReturn ?? 100,
      },
    });
  }
}
