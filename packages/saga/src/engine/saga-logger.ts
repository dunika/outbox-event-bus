import type { RoutingSlip } from "../types/interfaces"

export class SagaLogger {
  public log(message: string, slip: RoutingSlip, extra: Record<string, unknown> = {}): void {
    // eslint-disable-next-line no-console
    console.info(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        sagaId: slip.id,
        message,
        status: slip.status,
        mode: slip.mode,
        ...extra,
      })
    )
  }
}
