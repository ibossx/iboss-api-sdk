/**
 * Default policy groups and reporting groups (cloud tier).
 *
 * Console: Secure Access Policies → Default Policies. The platform's wire
 * name for default policy groups is "filtering groups"; users, devices, and
 * connectors are assigned to them by groupNumber, and policy layers /
 * group-targeted policies reference them. See
 * docs/api/default-policy-groups.md.
 */
import { SubClient, type SuccessResponse } from "./base.js";

export interface FilteringGroup {
  accountSettingsId?: number;
  groupNumber: number;
  groupName: string;
  enableWebLogging?: boolean;
  enableLogging?: boolean;
  priority?: number;
  reportingGroupNumber?: number;
  parentGroupNumber?: number;
  overrideGroup?: boolean;
  overrideGroupTimeout?: number;
  note?: string;
  bypassSslMitm?: number;
  reservedGroup?: number;
  itemId?: number;
  [key: string]: unknown;
}

export interface ReportingGroup {
  accountSettingsId?: number;
  /** 15-char alphanumeric key assigned by the platform. */
  groupCloudReportingKey?: string;
  number: number;
  name: string;
  /** 0 = report generation enabled, 1 = disabled. */
  reportGenerationDisabled?: number;
  itemId?: number;
  [key: string]: unknown;
}

export class GroupsApi extends SubClient {
  async listFilteringGroups(filter?: {
    groupNumber?: number;
    groupName?: string;
    wildcard?: string;
  }): Promise<FilteringGroup[]> {
    return this.request("cloud", "GET", "/ibcloud/web/groups/filtering", {
      query: {
        groupNumber: filter?.groupNumber,
        groupName: filter?.groupName,
        wildcard: filter?.wildcard,
      },
    });
  }

  /**
   * Update a filtering group. Read the group first (listFilteringGroups) and
   * send it back with your changes — the endpoint expects the full object.
   */
  async updateFilteringGroup(group: FilteringGroup): Promise<SuccessResponse> {
    return this.request("cloud", "POST", "/ibcloud/web/groups/filtering", {
      body: {
        type: "com.phantom.common.ibcloud.data.AccountSettingsFilteringGroup",
        ...group,
      },
    });
  }

  /** Reserve a group number so the platform won't auto-assign it. */
  async reserveFilteringGroup(groupNumber: number): Promise<SuccessResponse> {
    return this.request("cloud", "PUT", "/ibcloud/web/groups/filtering/reserve", {
      body: { groupNumber },
    });
  }

  async unreserveFilteringGroup(groupNumber: number): Promise<SuccessResponse> {
    return this.request("cloud", "PUT", "/ibcloud/web/groups/filtering/unreserve", {
      body: { groupNumber },
    });
  }

  async listReportingGroups(): Promise<ReportingGroup[]> {
    return this.request("cloud", "GET", "/ibcloud/web/groups/reporting");
  }

  async createReportingGroup(group: {
    name: string;
    number: number;
    reportGenerationDisabled?: number;
  }): Promise<SuccessResponse> {
    return this.request("cloud", "POST", "/ibcloud/web/groups/reporting", {
      body: { reportGenerationDisabled: 0, ...group },
    });
  }

  async updateReportingGroup(group: {
    name: string;
    number: number;
    reportGenerationDisabled?: number;
  }): Promise<SuccessResponse> {
    return this.request("cloud", "PUT", "/ibcloud/web/groups/reporting", {
      body: { reportGenerationDisabled: 0, ...group },
    });
  }

  async deleteReportingGroup(groupNumber: number): Promise<SuccessResponse> {
    return this.request("cloud", "DELETE", "/ibcloud/web/groups/reporting", {
      query: { groupNumber },
    });
  }
}
