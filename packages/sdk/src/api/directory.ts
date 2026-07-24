/**
 * Static proxy users and devices (gateway tier).
 */
import { SubClient, type EntriesResponse, type SuccessResponse } from "./base.js";

export interface ProxyUser {
  id?: number;
  userName: string;
  firstName?: string;
  lastName?: string;
  note?: string;
  userType?: number;
  userTypeName?: string;
  policyGroup?: number;
  policyGroupName?: string;
  forceLdapAuth?: number;
  sessionTimeout?: number;
  [key: string]: unknown;
}

export interface ProxyDevice {
  id?: number;
  computerName: string;
  ipAddress: string;
  note?: string;
  /** Policy group; -1 = default. */
  groupNumber?: number;
  ipBasedNode?: number;
  [key: string]: unknown;
}

const USER_DEFAULTS = {
  userType: 0,
  userTypeName: "User",
  policyGroup: 0,
  policyGroupName: "Default",
  forceLdapAuth: 0,
  sessionTimeout: 300,
  monTimeLimit: "86400",
  tuesTimeLimit: "86400",
  wedTimeLimit: "86400",
  thursTimeLimit: "86400",
  friTimeLimit: "86400",
  satTimeLimit: "86400",
  sunTimeLimit: "86400",
  message: "",
};

export class DirectoryApi extends SubClient {
  async listUsers(): Promise<ProxyUser[]> {
    const result = await this.request<EntriesResponse<ProxyUser>>("gateway", "GET", "/json/users");
    return result?.entries ?? [];
  }

  async addUser(user: ProxyUser): Promise<SuccessResponse> {
    return this.request("gateway", "PUT", "/json/users", {
      body: { ...USER_DEFAULTS, ...user },
    });
  }

  /** Requires user.id. Send the full user object with your changes. */
  async updateUser(user: ProxyUser & { id: number }): Promise<SuccessResponse> {
    return this.request("gateway", "POST", "/json/users", {
      body: { ...USER_DEFAULTS, ...user },
    });
  }

  async updateUserPassword(
    user: ProxyUser & { id: number },
    newPassword: string,
  ): Promise<SuccessResponse> {
    return this.request("gateway", "POST", "/json/users", {
      body: { ...USER_DEFAULTS, ...user, password: newPassword, updatePassword: 1 },
    });
  }

  async deleteUser(id: number): Promise<SuccessResponse> {
    return this.request("gateway", "DELETE", "/json/users", { query: { id } });
  }

  async listDevices(opts?: {
    currentRow?: number;
    groupNumberFilter?: number;
  }): Promise<ProxyDevice[]> {
    const result = await this.request<EntriesResponse<ProxyDevice>>(
      "gateway",
      "GET",
      "/json/computers/static",
      {
        query: {
          currentRow: opts?.currentRow ?? 0,
          groupNumberFilter: opts?.groupNumberFilter ?? -1,
          highRiskFilter: 0,
          loggedInFilter: 0,
        },
      },
    );
    return result?.entries ?? [];
  }

  async addDevice(device: ProxyDevice): Promise<SuccessResponse> {
    return this.request("gateway", "PUT", "/json/computer", {
      body: {
        groupNumber: -1,
        ipBasedNode: 1,
        dataRedirectorEnabled: 0,
        computerPolicyOverridesUserPolicy: 1,
        isLocalProxy: 0,
        numberOfIpAddresses: 1,
        ...device,
      },
    });
  }

  /** Requires device.id. Send the full device object with your changes. */
  async updateDevice(device: ProxyDevice & { id: number }): Promise<SuccessResponse> {
    return this.request("gateway", "POST", "/json/computer", { body: device });
  }

  async deleteDevice(id: number): Promise<SuccessResponse> {
    return this.request("gateway", "DELETE", "/json/computers/static", { query: { id } });
  }
}
