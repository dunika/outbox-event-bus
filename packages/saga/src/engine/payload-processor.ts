import type { BusEvent } from "outbox-event-bus"
import type { RoutingSlip, SagaStoreAdapter } from "../types/interfaces"
import { compress, decompress } from "../utils/compression"

export const DEFAULT_COMPRESSION_THRESHOLD = 10000 // 10KB
export const DEFAULT_CLAIM_CHECK_THRESHOLD = 200000 // 200KB

export interface PayloadProcessorConfig {
  compressionThreshold?: number
  claimCheckStore?: SagaStoreAdapter
  claimCheckThreshold?: number
}

type ClaimCheckPayload = { _claimCheck: string; _compressed: boolean }
type CompressedPayload = { _compressed: true; data: string }

export class PayloadProcessor {
  private compressionThreshold: number
  private claimCheckStore: SagaStoreAdapter | undefined
  private claimCheckThreshold: number

  constructor(config: PayloadProcessorConfig) {
    this.compressionThreshold = config.compressionThreshold ?? DEFAULT_COMPRESSION_THRESHOLD
    this.claimCheckStore = config.claimCheckStore
    this.claimCheckThreshold = config.claimCheckThreshold ?? DEFAULT_CLAIM_CHECK_THRESHOLD
  }

  public async processForEmission(slip: RoutingSlip): Promise<unknown> {
    let payloadStr = JSON.stringify(slip)
    let isCompressed = false

    if (payloadStr.length > this.compressionThreshold) {
      payloadStr = await compress(payloadStr)
      isCompressed = true
    }

    if (this.claimCheckStore && payloadStr.length > this.claimCheckThreshold) {
      const claimId = `slip-${slip.id}-${Date.now()}`
      await this.claimCheckStore.put(claimId, Buffer.from(payloadStr), new Date(slip.expiresAt))
      return { _claimCheck: claimId, _compressed: isCompressed } as ClaimCheckPayload
    }

    if (isCompressed) {
      return { _compressed: true, data: payloadStr } as CompressedPayload
    }

    return slip
  }

  public async resolve(event: BusEvent): Promise<unknown> {
    const { payload } = event
    if (!payload) return payload

    if (this.isClaimCheckPayload(payload)) {
      if (!this.claimCheckStore) {
        throw new Error("Claim check detected but no claimCheckStore configured")
      }
      const { _claimCheck, _compressed } = payload
      const data = await this.claimCheckStore.get(_claimCheck)
      let payloadStr = data.toString()
      if (_compressed) {
        payloadStr = await decompress(payloadStr)
      }
      return JSON.parse(payloadStr)
    }

    if (this.isCompressedPayload(payload)) {
      const { data } = payload
      const decompressedData = await decompress(data)
      return JSON.parse(decompressedData)
    }

    return payload
  }

  // Type guard helpers
  private isClaimCheckPayload(payload: unknown): payload is ClaimCheckPayload {
    return (
      typeof payload === "object" &&
      payload !== null &&
      "_claimCheck" in payload &&
      typeof (payload as ClaimCheckPayload)._claimCheck === "string"
    )
  }

  private isCompressedPayload(payload: unknown): payload is CompressedPayload {
    return (
      typeof payload === "object" &&
      payload !== null &&
      "_compressed" in payload &&
      (payload as CompressedPayload)._compressed === true &&
      "data" in payload &&
      typeof (payload as CompressedPayload).data === "string"
    )
  }

  public isRoutingSlip(payload: unknown): payload is RoutingSlip {
    return (
      typeof payload === "object" &&
      payload !== null &&
      "itinerary" in payload &&
      Array.isArray((payload as RoutingSlip).itinerary)
    )
  }
}
