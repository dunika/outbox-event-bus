# Data Model: Saga Routing Slip

## Entities

### RoutingSlip

The core envelope that carries the state of the saga.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` (UUID) | Unique identifier for the saga instance. |
| `mode` | `'forward' \| 'compensate'` | Current execution direction. |
| `itinerary` | `ActivityDefinition[]` | Stack of activities remaining to be executed. |
| `log` | `ActivityLogEntry[]` | Stack of completed activities (LIFO) for compensation. |
| `variables` | `Record<string, any>` | Shared data bag for the entire workflow. |
| `expiresAt` | `string` (ISO 8601) | Expiration timestamp for passive timeout check. |
| `status` | `string` | Current state: `Pending`, `Completed`, `Compensating`, `Faulted`. |

### ActivityDefinition

Defines a step in the itinerary.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | The unique name of the activity (used for dispatching). |
| `arguments` | `unknown` | Input data for the activity's `execute` method. |

### ActivityLogEntry

Recorded after an activity successfully executes.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | The name of the activity that was executed. |
| `timestamp` | `string` | When the activity completed. |
| `compensationData` | `unknown` | Data returned by `execute` to be passed to `compensate`. |

## State Transitions

### Forward Progress (`mode: 'forward'`)

1. Pop `ActivityDefinition` from `itinerary`.
2. Execute `Activity.execute(arguments, variables)`.
3. If success:
   - Push `ActivityLogEntry` to `log`.
   - Merge returned variables into `variables`.
   - If `itinerary` is empty, set status to `Completed`.
   - Else, emit next command with updated `RoutingSlip`.
4. If failure (after retries):
   - Switch `mode` to `'compensate'`.
   - Set status to `Compensating`.
   - Begin compensation.

### Compensation (`mode: 'compensate'`)

1. Pop `ActivityLogEntry` from `log`.
2. Execute `Activity.compensate(compensationData, variables)`.
3. If success:
   - If `log` is empty, set status to `Faulted` (fully compensated).
   - Else, emit next compensation command with updated `RoutingSlip`.
4. If failure:
   - Set status to `Faulted` (terminal failure).
   - Move to DLQ.

## Validation Rules

- `itinerary` must not be empty when creating a new slip.
- `expiresAt` must be in the future when creating a new slip.
- `name` in `ActivityDefinition` must map to a registered activity handler.
