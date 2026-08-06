// Equivalent to the Subagent interface in internal/subagent/registry.go: a
// focused agent the root can delegate to, exposed to it as a callable tool
// (see ./delegate.ts). Same shape as a tool - takes a task, returns text -
// but backed by its own Agent instance and context window underneath.

export interface Subagent {
  readonly name: string;
  readonly description: string;
  run(task: string): Promise<string>;
}
