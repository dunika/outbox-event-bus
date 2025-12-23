export interface RoutingSlip<TVariables = Record<string, unknown>> {
  id: string;
  itinerary: ActivityDefinition[];
  log: ActivityLogEntry[];
  variables: TVariables;
  expiresAt: string;
  status: 'Pending' | 'Completed' | 'Compensating' | 'Faulted';
}

export interface ActivityDefinition {
  name: string;
  arguments: unknown;
}

export interface ActivityLogEntry {
  name: string;
  timestamp: string;
  compensationData: unknown;
}

export interface ActivityContext<TArguments = unknown, TVariables = Record<string, unknown>> {
  arguments: TArguments;
  variables: TVariables;
  routingSlipId: string;
}

export interface ExecutionResult<TLog = unknown, TVariables = Record<string, unknown>> {
  compensationData?: TLog;
  variables?: Partial<TVariables>;
}

export interface Activity<TArguments = unknown, TLog = unknown, TVariables = Record<string, unknown>> {
  execute(context: ActivityContext<TArguments, TVariables>): Promise<ExecutionResult<TLog, TVariables>>;
  compensate(log: TLog, context: ActivityContext<TArguments, TVariables>): Promise<void>;
}
