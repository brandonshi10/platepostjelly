import {
  type RewardAttemptRequest,
  type PartnerRewardOutcome,
  parseRewardAttemptResponse,
} from "./rewardContracts";

export interface JellyRewardTransport {
  sendAttempt(
    rewardIntentId: string,
    request: RewardAttemptRequest,
  ): Promise<{ status: number; body: unknown }>;

  lookupIntent(
    rewardIntentId: string,
  ): Promise<{ status: number; body: unknown }>;
}

export class JellyRewardClient {
  constructor(private readonly transport: JellyRewardTransport) {}

  async executeAttempt(
    rewardIntentId: string,
    request: RewardAttemptRequest,
  ): Promise<PartnerRewardOutcome> {
    try {
      const response = await this.transport.sendAttempt(rewardIntentId, request);
      return parseRewardAttemptResponse(response.status, response.body);
    } catch {
      return { status: "uncertain", reasonCode: "transport_error" };
    }
  }

  async lookupIntentStatus(
    rewardIntentId: string,
  ): Promise<PartnerRewardOutcome | null> {
    try {
      const response = await this.transport.lookupIntent(rewardIntentId);
      if (response.status === 404) return null;
      return parseRewardAttemptResponse(response.status, response.body);
    } catch {
      return { status: "uncertain", reasonCode: "lookup_transport_error" };
    }
  }
}
