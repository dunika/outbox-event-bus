import type { RoutingSlip } from "./interfaces.js"

export const SAGA_EVENT_TYPES = {
  ROUTING_SLIP_CREATED: "saga.routing-slip.created",
  ROUTING_SLIP_COMPLETED: "saga.routing-slip.completed",
  ROUTING_SLIP_FAULTED: "saga.routing-slip.faulted",
  ACTIVITY_FAULTED: "saga.activity.faulted",
} as const

export interface RoutingSlipCreatedEvent {
  type: typeof SAGA_EVENT_TYPES.ROUTING_SLIP_CREATED
  payload: RoutingSlip
}

export interface RoutingSlipCompletedEvent {
  type: typeof SAGA_EVENT_TYPES.ROUTING_SLIP_COMPLETED
  payload: RoutingSlip
}

export interface RoutingSlipFaultedEvent {
  type: typeof SAGA_EVENT_TYPES.ROUTING_SLIP_FAULTED
  payload: RoutingSlip
  reason: string
}

export interface ActivityFaultedEvent {
  type: typeof SAGA_EVENT_TYPES.ACTIVITY_FAULTED
  payload: {
    slipId: string
    activityName: string
    error: string
  }
}
